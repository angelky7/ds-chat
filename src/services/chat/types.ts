import type { TranslationMessage } from '../../i18n/index.js'
import type { ApiErrorKind } from '../api/client.js'
import type {
  ChatModel,
  MessageUsage,
  ServerToolBlock,
  StopDetails,
  StopReason,
  TextCitation,
} from '../api/types.js'

/**
 * 消息附件。id 是本地标识（IndexedDB files 表的主键，原件按它存储，所有引用同一 id 的消息共用一份），
 * 导入的附件沿用导出产物里的文件 ID；本地没有原件的附件只展示文件名，不进入请求。
 * serverId 是 Files API 返回的 file_id，导入的数据或尚未上传成功的文件为 null，发送前补传。
 */
export type FileAttachment = {
  id: string
  serverId: string | null
  name: string
  size: number
  /** 附件类别；导入时沿用归档的 is_image，不由 MIME 识别结果决定。 */
  isImage: boolean
  /** 具体 MIME；导入时没有原件或无法识别的为空字符串，不影响图片身份。 */
  mimeType: string
  /**
   * 本地解析出的文档文字：没有 Files API 的服务商用不了 file_id，
   * 文档在浏览器里抽成文本随提问注入；历史轮次按重发策略决定是否带上。
   */
  text?: string
  /**
   * 只在本机可用的附件：图片上传失败改走 base64 内联、文档解析失败改成本地读出的文字。
   * 发送前不再补传到 Files API，否则会重新撞上同一个失败，把已经就绪的消息卡在发送上。
   */
  local?: boolean
}

/** 本地消息的分支关系；字段缺省时按线性消息列表处理。 */
type MessageBranch = {
  parentId?: string | null
  /** 当前选中的下一条消息；切换版本时保留每条分支原有的选择。 */
  selectedChildId?: string
}

export type UserMessage = MessageBranch & {
  id: string
  role: 'user'
  content: string
  files: FileAttachment[]
  createdAt: number
}

/** 思考块：thinking_delta 累积，签名随 signature_delta 到达；历史轮次的思考服务端会丢弃，不回传 */
export type ThinkingPart = {
  type: 'thinking'
  thinking: string
  signature?: string
  /** content_block_start 的时间；没有事件时间的历史块缺省 */
  startedAt?: number
  /** content_block_stop（或回复结束）的时间 */
  endedAt?: number
  /** 仅有耗时、没有事件时间时保存秒数。 */
  elapsedSeconds?: number
}

/** 文本块：text_delta 累积，citations_delta 追加引用 */
export type TextPart = {
  type: 'text'
  text: string
  citations?: TextCitation[]
  /** 服务端提示文案，仅用于展示，不作为模型回答参与上下文或续写。 */
  isTemplate?: boolean
}

/** 服务端工具调用与结果块按协议原样保存；历史请求只回传 read_link 调用与结果 */
export type ReplyBlock = ThinkingPart | TextPart | ServerToolBlock

/**
 * pending：已发出请求，还没收到事件；streaming：正在接收；
 * done：收到 message_stop；stopped：用户停止或页面关闭；error：请求或流出错
 */
export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

export type AssistantMessage = MessageBranch & {
  id: string
  role: 'assistant'
  createdAt: number
  /** 未记录模型时为 null，续写使用当前默认模型。 */
  model: ChatModel | null
  /** 请求时是否开启深度思考 */
  thinking?: boolean
  /** 请求时是否声明 deepseek_web_search；关闭时仍声明 deepseek_read_url */
  search?: boolean
  /** 本轮请求的系统信息快照；各回答版本独立保存，续写沿用。历史消息中缺省的快照保持为空。 */
  latestReminder?: string
  /** 是否允许作为续写前缀；仍需满足回复状态与内容限制。 */
  prefix: boolean
  status: ReplyStatus
  /** 可识别的内容块按接收顺序排列；续写产生的块追加在已有块之后 */
  blocks: ReplyBlock[]
  stopReason?: StopReason
  stopDetails?: StopDetails
  /** 最近一次请求的用量，续写后更新 */
  usage?: MessageUsage
  error?: {
    /** upload：发送前补传附件失败，请求没有发出 */
    kind: ApiErrorKind | 'upload'
    message: string
    status?: number
    localMessage?: TranslationMessage
    /** 仅 upload：重新上传是否可能成功（网络、限流、服务端繁忙）；过大、格式不支持为 false */
    retryable?: boolean
  }
}

export type Message = UserMessage | AssistantMessage

/**
 * 上下文压缩产物：把「提问 + 回答」较早的一段压成摘要，后续请求用摘要替代那些轮次。
 * 原文仍然留在会话里，只是不再发出去；coveredFrom 到 coveredUntil 之间的轮次（含两端提问）视为已覆盖。
 */
export type Compaction = {
  /** 模型生成的检查点正文（Markdown），已去掉包裹标签 */
  summary: string
  /** 被覆盖的第一轮提问的消息 id；找不到该轮时按未压缩处理 */
  coveredFrom: string
  /** 被覆盖的最后一轮提问的消息 id；找不到该轮时检查点失效，按未压缩处理 */
  coveredUntil: string
  /** 被覆盖的轮数，仅用于界面展示 */
  rounds: number
  /** 被覆盖轮次的估算 token，仅用于界面展示与成本提示 */
  tokens: number
  /** 生成摘要时使用的模型 */
  model: string
  at: number
}

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 置顶：侧边栏固定在最上方；缺省视为未置顶 */
  pinned?: boolean
  /** 包含所有分支的消息，按创建顺序存储。 */
  messages: Message[]
  /** undefined 表示线性消息列表；null 表示空会话。 */
  rootMessageId?: string | null
  /** 最近一次上下文压缩；缺省表示未压缩 */
  compaction?: Compaction
}


/** 会话列表元数据；消息只在打开会话时加载。 */
export type SessionSummary = Pick<
  Session,
  'id' | 'title' | 'createdAt' | 'updatedAt' | 'pinned'
>

/** 显式提取字段，避免将完整会话的消息带进列表。 */
export const toSessionSummary = (session: SessionSummary): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  // 只在置顶时写出字段，未置顶的摘要保持与旧数据一致的形状
  ...(session.pinned ? { pinned: true } : {}),
})
