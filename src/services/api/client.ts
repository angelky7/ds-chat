import { translate, type TranslationMessage } from '../../i18n/index.js'
import { messagesEndpoint, modelsEndpoint, type ActiveProvider } from '../providers.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import { API_ORIGIN } from './origin.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

export { API_ORIGIN }
/** DeepSeek 的 Anthropic 兼容接口前缀：作为 Files API 的默认入口 */
const ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string): Record<string, string> => ({
  // 官方只认 x-api-key；第三方中转/自建反代有的只认 Bearer，两者同时给出。
  'x-api-key': apiKey,
  Authorization: `Bearer ${apiKey}`,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  'anthropic-beta': FILES_BETA,
})

/**
 * Files API 的基地址：跟随服务商配置的 Anthropic 入口，不写死官方域名。
 * 把 DeepSeek 的地址换成中转或自建反代后，聊天走配置地址、上传却打官方域名，
 * 用第三方 Key 必然 401，表现就是「能聊天、一传文件就失败」。
 */
const filesEndpoint = (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/v1/files`

/**
 * 对话请求的鉴权头：两种写法同时给出。官方只认 x-api-key，
 * 第三方兼容网关有的只接受 Bearer，同时携带对两边都无副作用。
 */
const providerHeaders = (provider: ActiveProvider, beta: boolean): Record<string, string> => ({
  'x-api-key': provider.apiKey,
  Authorization: `Bearer ${provider.apiKey}`,
  ...(provider.id === 'deepseek'
    ? beta
      ? { 'anthropic-beta': FILES_BETA }
      : {}
    : { 'anthropic-version': '2023-06-01' }),
})

/**
 * 用 GET /models 校验 API Key（不产生费用）。
 * 部分第三方网关没有该端点，返回 404/405/501 时视为无法校验、放行；
 * 401/403 仍然判为 Key 无效。
 */
export const verifyApiKey = async (
  provider: ActiveProvider,
  signal?: AbortSignal
): Promise<void> => {
  // 只带该协议需要的鉴权头：多的头会让预检把 x-api-key 也算进去，
  // 少数网关不认这个头就会整条预检失败，看起来像「网络不通」。
  const authHeaders: Record<string, string> =
    provider.protocol === 'anthropic'
      ? { 'x-api-key': provider.apiKey, Authorization: `Bearer ${provider.apiKey}` }
      : { Authorization: `Bearer ${provider.apiKey}` }
  try {
    await request(modelsEndpoint(provider), {
      method: 'GET',
      headers: authHeaders,
      signal,
    })
  } catch (error) {
    const unverifiable =
      error instanceof ApiError &&
      error.status !== undefined &&
      (error.status === 404 || error.status === 405 || error.status === 501)
    if (!unverifiable) {
      throw error
    }
  }
}

/**
 * POST {baseUrl}/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 * baseUrl 取自当前服务商，留空时回落到官方入口。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal,
  baseUrl: string = ANTHROPIC_BASE_URL
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(filesEndpoint(baseUrl), {
    method: 'POST',
    headers: anthropicHeaders(apiKey),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE {baseUrl}/v1/files/{file_id} */
export const deleteFile = async (
  apiKey: string,
  fileId: string,
  baseUrl: string = ANTHROPIC_BASE_URL
): Promise<void> => {
  await request(`${filesEndpoint(baseUrl)}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST {baseUrl}/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  provider: ActiveProvider,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(messagesEndpoint(provider), {
    method: 'POST',
    headers: {
      ...providerHeaders(provider, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
