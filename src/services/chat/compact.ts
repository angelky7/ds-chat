import { streamMessage } from '../api/client.js'
import { streamChatCompletion, toChatCompletion } from '../api/openai.js'
import type { CreateMessageRequest, MessageParam } from '../api/types.js'
import type { ActiveProvider } from '../providers.js'
import { getContextRounds, toCompactionReplay, type CompactionRound } from './reply.js'
import type { AssistantMessage, Message, UserMessage } from './types.js'

/**
 * 上下文压缩：把较早的「提问 + 回答」轮次压成一段结构化摘要，后续请求用摘要替代这些轮次。
 * 原文仍保留在会话里（只是不再发送），摘要生成失败时一律不落地，退回原有的轮次截断逻辑。
 *
 * 策略与提示词结构参考 DeepSeek Harness（MIT）的 packages/compaction/compaction-basic：
 * 达到阈值（默认 85% 窗口）即压缩、保留最近 16% 原文与开场 N 轮、摘要在输出被截断时视为失败；
 * 与上游不同的是原文始终留在本地，只影响发送内容，不删数据。
 */
export const COMPACT_RETAIN_RATIO = 0.16
/**
 * 摘要请求的输出上限，与对话请求一致；超出说明摘要被截断，按失败处理。
 * 早期是 2048：几万 token 的历史压出的检查点很容易超限，整段作废导致「压缩失败」。
 */
const SUMMARY_MAX_TOKENS = 8192
/** 至少要能覆盖两轮才值得压缩，否则省不下多少还会丢掉细节 */
const MIN_COVERED_ROUNDS = 2
/**
 * 单次摘要请求的重放预算（占窗口比例）：导入的超长会话可能比窗口还大，
 * 整段重放必然被上游拒绝。超过预算时把被压缩区间切成多次摘要调用，
 * 前一段的摘要并进下一段的指令里逐段合并，最终仍是一份完整检查点。
 */
const REPLAY_BUDGET_RATIO = 0.5

/**
 * 模型上下文窗口；未知模型按 200k 保守处理，宁可早压也不要把请求顶爆。
 * 第三方服务商按 OpenRouter `/api/v1/models` 的 context_length 登记，其余走 200k 默认值。
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
  // OpenRouter：Nemotron 系免费模型声明 1,000,000
  'nvidia/nemotron-3.5-super-vl:free': 1_000_000,
  'nvidia/nemotron-3-ultra-550b-a55b:free': 1_000_000,
  // OpenRouter：DeepSeek V4 系列声明 1,048,576（1M tokens）
  'deepseek/deepseek-v4-pro-0813': 1_048_576,
  'deepseek/deepseek-v4.1-flash-1017': 1_048_576,
}

export const contextWindowOf = (model: string): number => CONTEXT_WINDOWS[model] ?? 200_000

const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g

/**
 * 粗估 token：中日韩字符约 1 token / 字，其余按 3.6 字符 / token。
 * 项目里没有 tokenizer，压缩只是要一个量级判断，配合 20% 的余量足够。
 */
export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  const cjk = text.match(CJK)?.length ?? 0
  return Math.ceil(cjk * 1.05 + (text.length - cjk) / 3.6)
}

/** 回答里只有正文会进请求，思考块与工具块不计入 */
const replyText = (reply: AssistantMessage): string =>
  reply.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')

const roundTokens = ([user, reply]: [UserMessage, AssistantMessage]): number =>
  estimateTokens(user.content) +
  estimateTokens(replyText(reply)) +
  // 内联文档带本地解析出的正文，按实际文字估算；其余附件按每个 64 token 粗计
  user.files.reduce((sum, file) => sum + (file.text ? estimateTokens(file.text) : 64), 0)

/** 一轮对话的估算用量，供界面展示当前上下文压力 */
export const estimateContextTokens = (
  history: Message[],
  compaction?: { coveredUntil: string; summary: string },
  pinnedRounds = 0
): number => {
  const rounds = getContextRounds(history)
  const untilIndex = compaction
    ? rounds.findIndex(([user]) => user.id === compaction.coveredUntil)
    : -1
  // 覆盖区间不在当前消息链上（切分支/切换版本）：回退为全量历史估算，不报错
  if (!compaction || untilIndex < 0) {
    return rounds.reduce((sum, round) => sum + roundTokens(round), 0)
  }
  // 有效上下文 = 摘要 + 开场保留轮次原文 + 覆盖区之后的轮次；
  // 开场轮次与旧覆盖区重叠时只按原文计一次。
  const pinned = Math.min(pinnedRounds, rounds.length)
  let total = estimateTokens(compaction.summary)
  for (let index = 0; index < rounds.length; index += 1) {
    if (index < pinned || index > untilIndex) {
      total += roundTokens(rounds[index])
    }
  }
  return total
}

/**
 * 省下的 token = 被覆盖轮次的估算量 - 摘要自身占用的量。
 * 摘要偶尔比原文还长，此时按 0 处理，界面另有「这次没省下」的说法。
 */
export const savedTokensOf = (compaction: { tokens: number; summary: string }): number =>
  Math.max(0, compaction.tokens - estimateTokens(compaction.summary))

export type CompactionPlan = {
  /** 被覆盖的第一轮提问 id */
  coveredFrom: string
  /** 被覆盖的最后一轮提问 id */
  coveredUntil: string
  /** 被覆盖的轮数 */
  rounds: number
  /** 被覆盖轮次的估算 token */
  tokens: number
  /** 被覆盖的轮次内容，供分片重放 */
  covered: CompactionRound[]
}

/**
 * 选择可压缩区间：从尾部往前累计，攒够 retainTokens 就停，前面剩下的整段作为压缩对象。
 * 只在轮次边界上切分，不会切出孤立的提问或回答。
 * 开场 pinnedRounds 轮原文固定保留（不进入摘要，也不计入覆盖区）。
 * 已生效的检查点覆盖到 coveredUntil，那次之前的轮次不再重放，只压缩新增区间并把旧摘要合并进来。
 * force 用于手动压缩：不受 16% 保留比例限制，只留最近两轮（开场轮次除外）。
 */
export const selectCompactionPlan = (
  history: Message[],
  retainTokens: number,
  force = false,
  pinnedRounds = 0,
  previous?: { coveredFrom: string; coveredUntil: string; tokens?: number }
): CompactionPlan | null => {
  const rounds = getContextRounds(history)
  const pinned = Math.min(pinnedRounds, rounds.length)
  // 旧检查点覆盖到哪一轮；找不到（切分支、消息被删）时按未压缩处理
  const untilIndex = previous
    ? rounds.findIndex(([user]) => user.id === previous.coveredUntil)
    : -1
  const start = Math.max(pinned, untilIndex >= 0 ? untilIndex + 1 : 0)
  if (rounds.length < start + MIN_COVERED_ROUNDS + 1) {
    return null
  }
  let accumulated = 0
  let keepFrom = rounds.length
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    accumulated += roundTokens(rounds[index])
    keepFrom = index
    if (accumulated >= retainTokens) {
      break
    }
  }
  if (force) {
    keepFrom = Math.max(start + MIN_COVERED_ROUNDS, rounds.length - 2)
  }
  // 已覆盖区间不因尾部保留而回缩：否则会出现「压完反而少覆盖」的抖动
  keepFrom = Math.min(rounds.length, Math.max(keepFrom, start))
  // 开场轮次与旧覆盖区之外没有足够的新轮次：没有可压缩的内容
  if (keepFrom - start < MIN_COVERED_ROUNDS) {
    return null
  }
  const covered = rounds.slice(start, keepFrom)
  return {
    coveredFrom:
      untilIndex >= 0 ? (previous?.coveredFrom ?? rounds[untilIndex][0].id) : covered[0][0].id,
    coveredUntil: covered[covered.length - 1][0].id,
    rounds: covered.length,
    tokens:
      covered.reduce((sum, round) => sum + roundTokens(round), 0) +
      (untilIndex >= 0 ? (previous?.tokens ?? 0) : 0),
    covered,
  }
}

/**
 * 摘要指令：沿用 dsh 的结构化检查点格式，但要求跟随对话语言，
 * 免得中文对话被压成英文摘要、后续回答跟着串语言。
 */
const COMPACTION_INSTRUCTION = [
  'You are acting as a compaction engine. Condense the conversation ABOVE into a structured checkpoint that lets',
  'another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below, keeping every section in order. Use terse bullets, not paragraphs.',
  'Write "(none)" for an empty section — never drop a section. Write in the same language as the conversation.',
  '',
  '## 主要诉求 Primary Request and Intent',
  '- [the original and evolving goals; quote verbatim where the exact wording matters]',
  '',
  '## 关键概念 Key Concepts',
  '- [technologies, terms, conventions and constraints in play]',
  '',
  '## 文件与代码 Files and Code',
  '- [exact path or name: why it matters, key changes or values]',
  '',
  '## 问题与解决 Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## 尚未完成 Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## 当前进展 Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## 下一步 Next Step',
  '- [the single next action, or "(none)"]',
  '',
  '## 关键上下文 Critical Context',
  '- [decisions and their rationale, preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Preserve exact file paths, commands, error strings, identifiers and numbers.',
  '- Capture user corrections and explicit instructions faithfully.',
  '- Condense ONLY the rounds replayed above. If any verbatim opening messages precede them, they are kept',
  '  elsewhere in full — do not restate, summarize or duplicate their content in the checkpoint.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text; do not call any tool.',
  '- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint: merge it into the',
  '  new one, keep what is still true, drop what is stale, and never copy it forward verbatim.',
].join('\n')

export type CompactionOutcome = {
  summary: string
  /** 被覆盖的第一轮提问 id */
  coveredFrom: string
  coveredUntil: string
  rounds: number
  tokens: number
  model: string
}

export type CompactionInput = {
  history: Message[]
  /**
   * 上一次压缩的产物：已覆盖的轮次不再重放，只压新增区间并把旧摘要合并进来，
   * 避免每次压缩都重读全部历史（又慢又贵）。
   */
  previous?: { summary: string; coveredFrom: string; coveredUntil: string; tokens: number }
  provider: ActiveProvider
  model: string
  /** 当前生效的系统提示词；重放时带上，尽量贴近真实请求 */
  system: string
  /** 手动压缩：不受 16% 保留比例限制，只留最近两轮 */
  force?: boolean
  /** 开场保留轮数：这些轮次的原文固定发送，不进入摘要 */
  pinnedRounds?: number
  signal: AbortSignal
}

/** 压缩不可用的原因：没有可压缩区间 / 摘要失败。界面按 key 映射文案。 */
export class CompactionError extends Error {
  /**
   * @param detail 失败细节：'truncated'（摘要超输出上限）/ 'empty'（摘要为空）；
   * 缺省时 message 是 reason 本身，界面只显示笼统文案。
   */
  constructor(
    readonly reason: 'nothing-to-compact' | 'summarize-failed' | 'aborted',
    detail?: string
  ) {
    super(detail ?? reason)
    this.name = 'CompactionError'
  }
}

/** 重试时给推理模型更多输出余量（思考会占用输出预算）；Anthropic 侧保持 8192 */
const RETRY_MAX_TOKENS = 16384

/** 跑一次摘要请求并校验结果；截断或空摘要都视为失败，绝不写入半截检查点 */
const summarize = async (
  replay: MessageParam[],
  instruction: string,
  {
    provider,
    model,
    system,
    signal,
  }: Pick<CompactionInput, 'provider' | 'model' | 'system' | 'signal'>,
  maxTokens: number
): Promise<string> => {
  const messages: MessageParam[] = [...replay, { role: 'user', content: instruction }]
  const body: CreateMessageRequest = {
    model,
    ...(system.trim() ? { system } : {}),
    messages,
    max_tokens: maxTokens,
    // 摘要不需要思考：既省 token，也避免思考占满输出上限导致检查点被截断
    ...(provider.capabilities.files ? { thinking: { type: 'disabled' as const } } : {}),
  }

  let text = ''
  let stopReason: string | null = null
  try {
    const events =
      provider.protocol === 'anthropic'
        ? streamMessage(provider, body, signal)
        : streamChatCompletion(provider, toChatCompletion(body, model), signal)
    for await (const event of events) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      } else if (event.type === 'message_delta') {
        stopReason = event.delta.stop_reason ?? stopReason
      }
    }
  } catch (error) {
    if (signal.aborted) {
      throw new CompactionError('aborted')
    }
    // 非 CompactionError 的原始错误（网络、协议、上游 4xx/5xx）直接抛出，
    // 让界面能展示上游的具体原因，而不是笼统的「摘要没有生成」
    throw error
  }
  if (signal.aborted) {
    throw new CompactionError('aborted')
  }
  // 被输出上限截断的摘要会缺章节，宁可整段作废也不要写进上下文
  if (stopReason === 'max_tokens') {
    throw new CompactionError('summarize-failed', 'truncated')
  }
  if (!text.trim()) {
    throw new CompactionError('summarize-failed', 'empty')
  }
  return text.trim()
}

/** 旧检查点并进指令消息里，而不是单发一条 user：连续两条 user 会被部分服务商判为非法 */
const mergeInstruction = (previous: string | undefined): string =>
  previous?.trim()
    ? [
        'A prior checkpoint covering an even earlier portion of the history follows. Merge its still-true facts',
        'into the new summary, drop what is stale, and do not copy it forward verbatim.',
        '',
        '<compacted-summary>',
        previous.trim(),
        '</compacted-summary>',
        '',
        COMPACTION_INSTRUCTION,
      ].join('\n')
    : COMPACTION_INSTRUCTION

/**
 * 递归压缩一组轮次：摘要被截断或为空（推理模型把输出预算烧在思考上）时，
 * 对半拆开分别压缩再合并——输入越短、推理越短，总能收敛到能放下的大小。
 * 拆到单轮仍失败就放弃，把原始错误交给界面。
 */
const summarizeRounds = async (
  rounds: CompactionRound[],
  previous: string,
  ctx: Pick<CompactionInput, 'provider' | 'model' | 'system' | 'signal'>,
  maxTokens: number = SUMMARY_MAX_TOKENS
): Promise<string> => {
  try {
    return await summarize(toCompactionReplay(rounds), mergeInstruction(previous), ctx, maxTokens)
  } catch (error) {
    const retryable =
      error instanceof CompactionError && (error.message === 'truncated' || error.message === 'empty')
    if (!retryable || rounds.length <= 1) {
      throw error
    }
    const retryMax = ctx.provider.protocol === 'openai' ? RETRY_MAX_TOKENS : maxTokens
    const mid = Math.floor(rounds.length / 2)
    const first = await summarizeRounds(rounds.slice(0, mid), previous, ctx, retryMax)
    return await summarizeRounds(rounds.slice(mid), first, ctx, retryMax)
  }
}

/**
 * 执行一次压缩：选区间 → 把被覆盖轮次按窗口预算切成若干片 → 逐片重放并请求摘要，
 * 前一片的摘要并进后一片的指令里，最终合并成一份完整检查点。
 * 单片能装下时与原来的行为一致；导入的超长会话（重放超窗口）也能压出来。
 */
export const compactConversation = async ({
  history,
  previous,
  provider,
  model,
  system,
  force = false,
  pinnedRounds = 0,
  signal,
}: CompactionInput): Promise<CompactionOutcome> => {
  const window = contextWindowOf(model)
  const plan = selectCompactionPlan(
    history,
    Math.round(window * COMPACT_RETAIN_RATIO),
    force,
    pinnedRounds,
    previous
  )
  if (!plan) {
    throw new CompactionError('nothing-to-compact')
  }
  // 按估算 token 切片：每片不超过窗口的一半，至少包含一轮
  const budget = Math.max(1, Math.round(window * REPLAY_BUDGET_RATIO))
  const chunks: CompactionRound[][] = []
  let current: CompactionRound[] = []
  let currentTokens = 0
  for (const round of plan.covered) {
    const tokens = roundTokens(round)
    if (current.length > 0 && currentTokens + tokens > budget) {
      chunks.push(current)
      current = []
      currentTokens = 0
    }
    current.push(round)
    currentTokens += tokens
  }
  if (current.length > 0) {
    chunks.push(current)
  }

  let summary = previous?.summary.trim() || ''
  for (const chunk of chunks) {
    summary = await summarizeRounds(chunk, summary, { provider, model, system, signal })
  }

  return {
    summary,
    coveredFrom: plan.coveredFrom,
    coveredUntil: plan.coveredUntil,
    rounds: plan.rounds,
    tokens: plan.tokens,
    model,
  }
}
