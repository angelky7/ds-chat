import type {
  AssistantBlockParam,
  Base64ImageBlockParam,
  FileBlockParam,
  MessageParam,
  MessageStreamEvent,
  OutputBlockStart,
  TextBlockParam,
} from '../api/types.js'
import { useSettings } from '../settings.js'
import type {
  AssistantMessage,
  FileAttachment,
  Message,
  ReplyBlock,
  ReplyStatus,
  UserMessage,
} from './types.js'

/** 内联图片：第三方服务商没有 Files API，图片按 base64 放进请求体 */
export type InlineImage = { mediaType: string; data: string }

/** 按附件 id 取内联图片；返回 undefined 的附件不进入请求 */
export type ImageResolver = (fileId: string) => InlineImage | undefined

/**
 * 不支持联网工具的模型偶尔会把服务端注入的搜索提示原样输出。
 * 展示层会替换成提示文案；请求层直接丢弃，避免它继续污染上下文。
 */
export const RAW_SEARCH_PROMPT = /<search_results>[\s\S]*?CITATION FORMAT[\s\S]*?<\/search_results>/gi

/**
 * 文件按 Files API 的 file_id（附件的 serverId）引用：图片用 image 块，其余用 document 块。
 * 发送前 streamReply 会先补齐 serverId；仍为 null 的是本地没有原件的附件，不进入请求。
 * 传入 images 时不使用 Files API：图片改为内联 base64，
 * 带本地解析文字（text）的文档注入 <document> 文本块，其余附件不进入请求。
 */
const toFileBlocks = (
  files: FileAttachment[],
  images?: ImageResolver
): (FileBlockParam | Base64ImageBlockParam | TextBlockParam)[] =>
  files.flatMap(({ id, serverId, isImage, name, text }): (
    | FileBlockParam
    | Base64ImageBlockParam
    | TextBlockParam
  )[] => {
    if (images) {
      const inline = isImage ? images(id) : undefined
      if (inline) {
        return [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: inline.mediaType,
              data: inline.data,
            },
          },
        ]
      }
      if (!isImage && text?.trim()) {
        // 文件名进标签属性，引号去掉避免破坏结构；正文原样注入
        return [
          {
            type: 'text',
            text: `<document name="${name.replace(/"/g, '')}">\n${text.trim()}\n</document>`,
          },
        ]
      }
      return []
    }
    if (serverId) {
      return [
        {
          type: isImage ? 'image' : 'document',
          source: { type: 'file', file_id: serverId },
        },
      ]
    }
    // 服务端解析不可用时改在本地读出的文字：直接按文本块发送，内容不至于丢掉
    if (!isImage && text?.trim()) {
      return [
        {
          type: 'text',
          text: `<document name="${name.replace(/"/g, '')}">\n${text.trim()}\n</document>`,
        },
      ]
    }
    return []
  })

const toReplyBlock = (block: OutputBlockStart, now: number): ReplyBlock | null => {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text, citations: block.citations ?? [] }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature,
        startedAt: now,
      }
    case 'server_tool_use':
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
      return block
    default:
      return null
  }
}

const updateBlock = (
  reply: AssistantMessage,
  index: number,
  update: (block: ReplyBlock) => ReplyBlock
): AssistantMessage => {
  const block = reply.blocks[index]
  if (!block) {
    return reply
  }
  const blocks = [...reply.blocks]
  blocks[index] = update(block)
  return { ...reply, blocks }
}

/**
 * 把一个流式事件合并进回复：只追加可识别的内容块，用本次请求的临时索引映射处理增量。
 * 跳过的块不占位；续写直接追加到已有内容之后，message_delta 更新结束原因与累计用量。
 */
export const applyEvent = (
  reply: AssistantMessage,
  event: MessageStreamEvent,
  now: number,
  blockIndexes: Map<number, number>
): AssistantMessage => {
  const next: AssistantMessage =
    reply.status === 'streaming' ? reply : { ...reply, status: 'streaming' }
  switch (event.type) {
    case 'message_start':
      return { ...next, usage: event.message.usage ?? next.usage }
    case 'content_block_start': {
      blockIndexes.delete(event.index)
      const block = toReplyBlock(event.content_block, now)
      if (!block) {
        // 客户端工具内容不保存；未完成的工具往返也不能作为续写前缀。
        return event.content_block.type === 'tool_use' ? { ...next, prefix: false } : next
      }
      blockIndexes.set(event.index, next.blocks.length)
      return { ...next, blocks: [...next.blocks, block] }
    }
    case 'content_block_delta': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      const { delta } = event
      return updateBlock(next, index, (block) => {
        if (block.type === 'text' && delta.type === 'text_delta') {
          return { ...block, text: block.text + delta.text }
        }
        if (block.type === 'thinking' && delta.type === 'thinking_delta') {
          return { ...block, thinking: block.thinking + delta.thinking }
        }
        if (block.type === 'thinking' && delta.type === 'signature_delta') {
          return { ...block, signature: (block.signature ?? '') + delta.signature }
        }
        if (block.type === 'text' && delta.type === 'citations_delta') {
          return { ...block, citations: [...(block.citations ?? []), delta.citation] }
        }
        return block
      })
    }
    case 'content_block_stop': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      blockIndexes.delete(event.index)
      return updateBlock(next, index, (block) =>
        block.type === 'thinking' && block.startedAt !== undefined && block.endedAt === undefined
          ? { ...block, endedAt: now }
          : block
      )
    }
    case 'message_delta':
      return {
        ...next,
        stopReason: event.delta.stop_reason,
        stopDetails: event.delta.stop_details,
        usage: event.usage ?? next.usage,
      }
    default:
      return next
  }
}

/**
 * 回复结束：未结束的思考块以当前时间收尾。
 * 安全拒绝（stop_reason: refusal）时已下发的思考与正文不能撤回，按协议要求由客户端丢弃，只保留工具块。
 * 用户打开「保留被撤回的回答」后不再丢弃，内容留在对话里展示（但不会进入后续上下文）。
 */
export const settleReply = (
  reply: AssistantMessage,
  status: Extract<ReplyStatus, 'done' | 'stopped' | 'error'>,
  now: number,
  error?: AssistantMessage['error']
): AssistantMessage => {
  const dropRefused = reply.stopReason === 'refusal' && !useSettings.getState().keepRefusedAnswer
  return {
    ...reply,
    status,
    error,
    blocks: reply.blocks.flatMap((block): ReplyBlock[] => {
      if (dropRefused && (block.type === 'thinking' || block.type === 'text')) {
        return []
      }
      return block.type === 'thinking' && block.startedAt !== undefined && block.endedAt === undefined
        ? [{ ...block, endedAt: now }]
        : [block]
    }),
  }
}

/** 回复里所有文本块拼起来，用于复制与判断是否有回答（已滤掉泄漏的搜索提示） */
export const getReplyText = (reply: AssistantMessage) =>
  reply.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .replace(RAW_SEARCH_PROMPT, '')

/**
 * 只有正常达到输出上限或被停止的回复可续写，报错回复不能续写。
 * 末条限制由调用方判断，拒绝和客户端工具调用不能续写。
 * 本轮含服务端工具调用或结果（含 READ_LINK 和孤立结果块）的回复不能续写。
 * 服务端模板提示不能作为续写前缀。
 */
export const canContinueReply = (reply: AssistantMessage): boolean => {
  if (
    !reply.prefix ||
    reply.stopReason === 'refusal' ||
    reply.stopReason === 'tool_use' ||
    reply.blocks.some(
      (block) =>
        block.type === 'server_tool_use' ||
        block.type === 'web_search_tool_result' ||
        block.type === 'web_fetch_tool_result' ||
        (block.type === 'text' && block.isTemplate)
    )
  ) {
    return false
  }
  return (
    reply.status === 'stopped' ||
    (reply.status === 'done' && reply.stopReason === 'max_tokens')
  )
}

/**
 * 已结束或停止且有回答文本的回复才放进上下文；被安全拒绝的轮次不回传。
 * 服务端模板提示不进入上下文。
 */
const isUsableReply = (message: Message): message is AssistantMessage =>
  message.role === 'assistant' &&
  (message.status === 'done' || message.status === 'stopped') &&
  message.stopReason !== 'refusal' &&
  !message.blocks.some((block) => block.type === 'text' && block.isTemplate) &&
  getReplyText(message) !== ''

/**
 * 有文件时用内容块数组：先文件后文本，文件按 Files API 的 file_id 引用或内联 base64。
 * files 由调用方先筛过：历史轮次的文档不进请求时直接传空数组。
 */
const toUserParam = (
  { content, files }: UserMessage,
  images?: ImageResolver
): MessageParam => {
  const blocks = toFileBlocks(files, images)
  return blocks.length === 0
    ? { role: 'user', content }
    : {
        role: 'user',
        content: [...blocks, ...(content ? [{ type: 'text' as const, text: content }] : [])],
      }
}

/**
 * assistant 的内容块按历史与续写场景转换：
 * - 历史思考及其签名不回传；开启思考时续写只保留本轮非空白思考及其签名；
 * - 文本块去掉 citations（服务端忽略）。相邻文本直接拼接，被思考或工具隔开的文本用空行连接；
 *   省略历史思考后仍保留其前后正文的空行；
 * - 工具调用和结果只保留 kind 为 read_link 的块，其他历史工具块不回传；
 * - 阅读链接结果原样回传，保留 signature：服务端解密后将页面拼回该轮提问末尾；
 */
const toAssistantParam = (
  { blocks }: AssistantMessage,
  prefix = false,
  thinking = false
): Extract<MessageParam, { role: 'assistant' }> => {
  const content: AssistantBlockParam[] = []
  // 成功阅读的网页靠签名恢复正文；缺少有效签名时，调用与结果都不回传。
  const unsignedReadLinks = new Set(
    blocks.flatMap((block) =>
      block.type === 'web_fetch_tool_result' &&
      block.kind === 'read_link' &&
      block.content.type === 'web_fetch_result' &&
      !block.signature?.trim()
        ? [block.tool_use_id]
        : []
    )
  )
  /** 正在拼接的文本块；遇到任何非文本块（含不回传的思考块）就结束 */
  let text: TextBlockParam | null = null
  for (const block of blocks) {
    // 空思考不改变续写位置，也不应把两段正文隔开，导致后端额外插入空行。
    if (prefix && block.type === 'thinking' && !block.thinking.trim()) {
      continue
    }
    if (block.type === 'text') {
      // 模型偶尔把服务端注入的搜索提示原样输出；不把它带回后续请求的上下文。
      const cleaned = block.text.replace(RAW_SEARCH_PROMPT, '')
      if (!cleaned) {
        continue
      }
      if (text) {
        text.text += cleaned
      } else {
        const previous = content.at(-1)
        text = {
          type: 'text',
          text: `${previous?.type === 'text' ? '\n\n' : ''}${cleaned}`,
        }
        content.push(text)
      }
      continue
    }
    text = null
    if (prefix && thinking && block.type === 'thinking') {
      // 续写保留本轮思考，历史轮次的思考省略。
      const { type, thinking, signature } = block
      content.push({ type, thinking, signature: signature ?? '' })
    } else if (
      block.type === 'server_tool_use' &&
      block.kind === 'read_link' &&
      !unsignedReadLinks.has(block.id)
    ) {
      const { type, id, name, input, kind } = block
      content.push({ type, id, name, input, kind })
    } else if (
      block.type === 'web_fetch_tool_result' &&
      block.kind === 'read_link' &&
      !unsignedReadLinks.has(block.tool_use_id)
    ) {
      content.push(block)
    }
  }
  return {
    role: 'assistant',
    content: content.filter((block) => block.type !== 'text' || block.text !== ''),
  }
}

/** 历史中会进入请求上下文的轮次：提问后紧跟可用回答的才保留 */
export const getContextRounds = (history: Message[]): [UserMessage, AssistantMessage][] => {
  const rounds: [UserMessage, AssistantMessage][] = []
  for (let i = 0; i + 1 < history.length; i++) {
    const [user, reply] = [history[i], history[i + 1]]
    if (user.role === 'user' && isUsableReply(reply)) {
      rounds.push([user, reply])
      i++
    }
  }
  return rounds
}

/**
 * 历史轮次的附件策略：附件正文在每次请求里都会重新计入输入长度，
 * 同一份文档留在上下文里越久，越容易把整段对话顶出模型上限。
 * - once：文档一律不回传，图片保留最近一轮（追问画面细节仍需要原图）；
 * - every-turn：上下文窗口内的每一轮都重新带上文档与图片——Files 模式按 file_id，
 *   内联模式带 <document> 文本与 base64 图片；代价是 token 随轮次线性增长，
 *   换来的是文件不会被"忘掉"。
 */
const HISTORIC_IMAGE_ROUNDS = 1

/**
 * 该轮只发了附件没写文字时用占位文本：既保住这一轮问答，也让模型知道
 * 当时的附件正文已不在上下文里，不必假装看过。
 */
const OMITTED_ATTACHMENTS = '[Attached files in this round are no longer available in the context.]'

/** 生成请求时的截断与附件策略；两个字段都有默认值，调用方只需传需要改的那个 */
export type RequestOptions = {
  /** 保留的历史轮次上限；0 或省略表示不限制 */
  contextLimit?: number
  /** 历史附件重发方式；默认 once */
  fileResend?: 'once' | 'every-turn'
  /** 已生效的上下文压缩：用摘要替换 coveredFrom 到 coveredUntil 之间的轮次 */
  compaction?: { summary: string; coveredUntil: string }
  /** 开场保留轮数：这些轮次的原文固定发送，不参与压缩 */
  pinnedRounds?: number
}

/** 摘要提示词里的包裹说明（无开场保留时）：把它当作已确立的背景，不要复述，也不要提到压缩本身 */
const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. ' +
  'Treat it as established background, build on it without restating it, and continue the task directly from the ' +
  'messages that follow. Do not mention this checkpoint.'

/** 有开场保留轮次时的包裹说明：检查点只代表开场轮次与最近消息之间的「中段」历史 */
const CHECKPOINT_PREAMBLE_PINNED =
  'The conversation above this block consists of the opening rounds, preserved verbatim because they contain ' +
  'setup and constraints referenced throughout. The following checkpoint summarizes the MIDDLE portion of the ' +
  'history — everything between those opening rounds and the most recent messages. It replaces those middle ' +
  'turns, not the entire early history. Treat the opening rounds as fully authoritative, this checkpoint as ' +
  'a faithful condensation of what came after them, and the messages following this block as the latest turns.'

/**
 * 把会话转成请求的 messages：只保留「提问 + 有回答的回复」成对的轮次，最后接上本轮提问。
 * 失败或没有回答的轮次不进上下文。续写时末尾再带上本轮 assistant。
 */
export const toRequestMessages = (
  history: Message[],
  question: UserMessage,
  prefix?: AssistantMessage,
  thinking = prefix?.thinking ?? false,
  latestReminder?: string,
  images?: ImageResolver,
  options: RequestOptions = {}
): MessageParam[] => {
  const messages: MessageParam[] = []
  let previousReminder: string | undefined
  const appendReminder = (reminder: string | undefined) => {
    // 仅在当前分支首次出现或内容变化时插入快照；缺少快照的消息保持原有内容。
    if (reminder && reminder !== previousReminder) {
      messages.push({ role: 'latest_reminder', content: reminder })
      previousReminder = reminder
    }
  }
  const contextRounds = getContextRounds(history)
  // 发送顺序：开场 N 轮原文 → 检查点 → 未覆盖轮次。
  // 开场轮次原文照发；压缩只作用于开场轮次之后的区间。
  const pinnedCount = Math.min(options.pinnedRounds ?? 0, contextRounds.length)
  const opening = contextRounds.slice(0, pinnedCount)
  let rest = contextRounds.slice(pinnedCount)
  /**
   * 检查点不单独占一条 user 消息：它会和后面第一条提问连成两条 user，
   * 严格的 Anthropic 兼容服务商会判为非法。这里把它并进第一条未覆盖的提问。
   */
  let checkpoint = ''
  if (options.compaction) {
    // coveredUntil 找不到对应轮次（切分支、消息被删、N 调大后覆盖区落入开场）时按未压缩处理
    const coveredIndex = rest.findIndex(([user]) => user.id === options.compaction?.coveredUntil)
    if (coveredIndex >= 0) {
      rest = rest.slice(coveredIndex + 1)
      const preamble = pinnedCount > 0 ? CHECKPOINT_PREAMBLE_PINNED : CHECKPOINT_PREAMBLE
      checkpoint = `${preamble}\n\n<compacted-summary>\n${options.compaction.summary.trim()}\n</compacted-summary>`
    }
  }
  const limit = options.contextLimit ?? 0
  if (limit > 0 && rest.length > limit) {
    rest = rest.slice(-limit)
  }
  // every-turn 对两种模式都生效：内联文档是文本块、历史图片可从 IndexedDB 取原件
  const everyTurn = options.fileResend === 'every-turn'
  const rounds = [...opening, ...rest]
  const checkpointIndex = checkpoint && rest.length > 0 ? opening.length : -1
  rounds.forEach(([user, reply], index) => {
    const keepImages = index >= rounds.length - HISTORIC_IMAGE_ROUNDS
    const files = everyTurn ? user.files : keepImages ? user.files.filter((file) => file.isImage) : []
    const blocks = toFileBlocks(files, images)
    // 附件没能进请求（文档不回传、已超出上下文、或本地已没有原件）时补一句说明，
    // 既保住这一轮问答，也避免模型假装读过原文。
    const content = [
      // 检查点并入第一条未覆盖的提问：既保住摘要，也不会出现连续两条 user
      index === checkpointIndex ? checkpoint : '',
      user.content,
      user.files.length > 0 && blocks.length === 0 ? OMITTED_ATTACHMENTS : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    // 历史提问没有文字、附件也都没有可用内容时，提问为空，连同回答一起省略。
    if (!content) {
      return
    }
    appendReminder(reply.latestReminder)
    messages.push(
      // 没有可用块的附件不再传给 toUserParam，避免二次解析
      toUserParam({ ...user, content, files: blocks.length > 0 ? files : [] }, images),
      toAssistantParam(reply)
    )
  })
  appendReminder(latestReminder)
  // 未覆盖轮次为空时没有可并入的提问，只能把检查点并进本轮提问
  messages.push(
    toUserParam(
      checkpoint && rest.length === 0
        ? { ...question, content: [checkpoint, question.content].filter(Boolean).join('\n\n') }
        : question,
      images
    )
  )
  if (prefix?.prefix) {
    const assistant = toAssistantParam(prefix, true, thinking)
    // 没有非空白正文或有效思考时直接重发原问题，避免服务端拒绝空 Prefill。
    if (
      assistant.content.some(
        (block) =>
          (block.type === 'text' && block.text.trim()) ||
          (block.type === 'thinking' && block.thinking.trim())
      )
    ) {
      messages.push(assistant)
    }
  }
  return messages
}

/** 会进入请求的一轮问答；压缩分片与上下文估算都以它为单位 */
export type CompactionRound = [UserMessage, AssistantMessage]

/**
 * 压缩时重放指定区间：只带文字，不带附件正文。
 * 摘要要保住的是结论、决策和未决问题，把这些轮次的文档正文重新读一遍既贵，
 * 也容易让摘要请求本身超限——附件被略过的轮次补占位说明，避免模型以为还有原文。
 */
export const toCompactionReplay = (rounds: CompactionRound[]): MessageParam[] => {
  const messages: MessageParam[] = []
  for (const [user, reply] of rounds) {
    if (!user.content && user.files.length === 0) {
      continue
    }
    messages.push({
      role: 'user',
      content: user.content || OMITTED_ATTACHMENTS,
    })
    messages.push(toAssistantParam(reply))
  }
  return messages
}

/** 思考用时（秒），至少 1 秒 */export const getThinkingSeconds = (startedAt: number, endedAt: number) =>
  Math.max(1, Math.round((endedAt - startedAt) / 1000))
