import { ApiError, request } from './client.js'
import { readServerSentEvents } from './sse.js'
import type { CreateMessageRequest, MessageParam, MessageStreamEvent, MessageUsage } from './types.js'
import { messagesEndpoint, type ActiveProvider } from '../providers.js'

/** OpenAI 兼容接口的请求体片段；图片用 data URL 内联 */
export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAIContentPart[]
}

export type ChatCompletionRequest = {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  temperature?: number
  /**
   * OpenRouter 的推理开关：开启用 enabled，关闭必须用 effort: 'none'
   * （enabled: false 在该接口上没有明确定义）。
   */
  reasoning?: { enabled: true } | { effort: 'none' }
}

/** Anthropic 内容块 → OpenAI 文本片段；图片按 data URL 内联，其余块丢弃 */
const toOpenAIContent = (
  content: string | { type: string; [key: string]: unknown }[]
): string | OpenAIContentPart[] => {
  if (typeof content === 'string') {
    return content
  }
  const parts: OpenAIContentPart[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push({ type: 'text', text: block.text })
      continue
    }
    const source = block.source as
      | { type?: string; media_type?: string; data?: string }
      | undefined
    if (block.type === 'image' && source?.type === 'base64' && source.data) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${source.media_type ?? 'image/png'};base64,${source.data}` },
      })
    }
  }
  return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts
}

/**
 * 内部请求体转 OpenAI 消息数组：
 * system 提到首条系统消息，latest_reminder 属于 DeepSeek 扩展角色、这里丢弃，
 * assistant 的思考与工具块不回传，只保留正文。
 */
export const toChatCompletion = (
  body: CreateMessageRequest,
  model: string
): ChatCompletionRequest => {
  const messages: OpenAIMessage[] = []
  if (body.system?.trim()) {
    messages.push({ role: 'system', content: body.system })
  }
  for (const message of body.messages as MessageParam[]) {
    if (message.role === 'latest_reminder') {
      continue
    }
    if (message.role === 'user') {
      messages.push({ role: 'user', content: toOpenAIContent(message.content) })
      continue
    }
    const text = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()
    if (text) {
      messages.push({ role: 'assistant', content: text })
    }
  }
  return {
    model,
    messages,
    ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    // 思考开关：Anthropic 的 thinking 在 OpenAI 兼容接口里对应 reasoning
    ...(body.thinking
      ? { reasoning: body.thinking.type === 'enabled' ? { enabled: true as const } : { effort: 'none' as const } }
      : {}),
  }
}

type ChunkPayload = {
  id?: unknown
  model?: unknown
  choices?: unknown
  usage?: unknown
  error?: { message?: unknown }
}

const chunkText = (value: unknown): string => (typeof value === 'string' ? value : '')

const readUsage = (value: unknown): MessageUsage | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const usage = value as Record<string, unknown>
  const num = (key: string) => (typeof usage[key] === 'number' ? (usage[key] as number) : 0)
  return {
    input_tokens: num('prompt_tokens'),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: num('completion_tokens'),
  }
}

/** finish_reason → 内部停止原因；未知值按正常结束处理 */
const readStopReason = (value: unknown): 'end_turn' | 'max_tokens' =>
  value === 'length' ? 'max_tokens' : 'end_turn'

/** 200 但不是 SSE：多半是网关返回的 JSON 错误，尽量取出里面的 message */
const readProtocolError = async (response: Response): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const message = chunkText(body.error?.message) || chunkText(body.message)
    if (message) {
      return new ApiError('protocol', message)
    }
  } catch {
    // 非 JSON 直接展示原文
  }
  return new ApiError('protocol', text)
}

/**
 * POST {baseUrl}/chat/completions（stream: true），把 OpenAI 的增量流转换成内部事件流：
 * content 映射为文本块，reasoning_content / reasoning 映射为思考块，块切换时补发开始与停止事件。
 * 结束时补发 message_delta 与 message_stop，供上层沿用同一套归并逻辑。
 */
export async function* streamChatCompletion(
  provider: ActiveProvider,
  body: ChatCompletionRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const openrouter = provider.preset.id === 'openrouter'
  const response = await request(messagesEndpoint(provider), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      // OpenRouter 用这两个头做调用来源统计，缺失也能用
      ...(openrouter && typeof location !== 'undefined'
        ? { 'HTTP-Referer': location.origin, 'X-Title': 'chat-demo' }
        : {}),
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readProtocolError(response)
  }

  let started = false
  let nextIndex = 0
  let openKind: 'thinking' | 'text' | null = null
  let openIndex = -1
  let stopReason: 'end_turn' | 'max_tokens' | null = null
  let usage: MessageUsage | undefined
  const id = `chatcmpl-${Date.now()}`
  let model = body.model

  const start = (): MessageStreamEvent => {
    started = true
    return {
      type: 'message_start',
      message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null },
    } as MessageStreamEvent
  }

  const closeBlock = (): MessageStreamEvent | null => {
    if (openKind === null) {
      return null
    }
    const event = {
      type: 'content_block_stop',
      index: openIndex,
    } as MessageStreamEvent
    openKind = null
    openIndex = -1
    return event
  }

  const openBlock = (kind: 'thinking' | 'text'): MessageStreamEvent => {
    openKind = kind
    openIndex = nextIndex++
    return {
      type: 'content_block_start',
      index: openIndex,
      content_block: kind === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' },
    } as MessageStreamEvent
  }

  const delta = (text: string): MessageStreamEvent => ({
    type: 'content_block_delta',
    index: openIndex,
    delta:
      openKind === 'thinking'
        ? { type: 'thinking_delta', thinking: text }
        : { type: 'text_delta', text },
  }) as MessageStreamEvent

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      break
    }
    let payload: ChunkPayload
    try {
      payload = JSON.parse(data) as ChunkPayload
    } catch {
      continue
    }
    const failure = chunkText(payload.error?.message)
    if (failure) {
      throw new ApiError('stream', failure)
    }
    if (typeof payload.model === 'string' && payload.model) {
      model = payload.model
    }
    usage = readUsage(payload.usage) ?? usage

    const choice = Array.isArray(payload.choices) ? (payload.choices[0] as Record<string, unknown>) : undefined
    if (!choice) {
      continue
    }
    if (!started) {
      yield start()
    }
    const deltaPayload = (choice.delta ?? {}) as Record<string, unknown>
    const reasoning =
      chunkText(deltaPayload.reasoning_content) ||
      chunkText(deltaPayload.reasoning) ||
      // OpenRouter 也可能只给结构化数组：取其中的 reasoning.text 片段
      (Array.isArray(deltaPayload.reasoning_details)
        ? deltaPayload.reasoning_details
            .map((item) =>
              item && typeof item === 'object' && (item as { type?: string }).type === 'reasoning.text'
                ? chunkText((item as { text?: unknown }).text)
                : ''
            )
            .join('')
        : '')
    if (reasoning) {
      if (openKind !== 'thinking') {
        const closed = closeBlock()
        if (closed) {
          yield closed
        }
        yield openBlock('thinking')
      }
      yield delta(reasoning)
    }
    const content = chunkText(deltaPayload.content)
    if (content) {
      if (openKind !== 'text') {
        const closed = closeBlock()
        if (closed) {
          yield closed
        }
        yield openBlock('text')
      }
      yield delta(content)
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      stopReason = readStopReason(choice.finish_reason)
    }
  }

  if (!started) {
    yield start()
  }
  const closed = closeBlock()
  if (closed) {
    yield closed
  }
  if (stopReason === null) {
    // 流在 finish_reason 之前结束，按断流处理，避免把不完整回答当成成功
    throw new ApiError('interrupted', '')
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason },
    usage,
  } as MessageStreamEvent
  yield { type: 'message_stop' } as MessageStreamEvent
}
