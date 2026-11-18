import { streamMessage } from '../api/client.js'
import { streamChatCompletion, toChatCompletion } from '../api/openai.js'
import type { CreateMessageRequest, MessageParam } from '../api/types.js'
import type { ActiveProvider } from '../providers.js'
import { getContextRounds, toCompactionReplay } from './reply.js'
import type { AssistantMessage, Message, UserMessage } from './types.js'

/**
 * 上下文压缩：把较早的「提问 + 回答」轮次压成一段结构化摘要，后续请求用摘要替代这些轮次。
 * 原文仍保留在会话里（只是不再发送），摘要生成失败时一律不落地，退回原有的轮次截断逻辑。
 *
 * 策略与提示词结构参考 DeepSeek Harness（MIT）的 packages/compaction/compaction-basic：
 * 阈值可配（默认 80% 窗口）、保留最近 16% 原文、摘要在输出被截断时视为失败；
 * 与上游不同的是原文始终留在本地，只影响发送内容，不删数据。
 */
export const COMPACT_RETAIN_RATIO = 0.16
/** 摘要请求的输出上限；超出说明摘要被截断，按失败处理 */
const SUMMARY_MAX_TOKENS = 2048
/** 至少要能覆盖两轮才值得压缩，否则省不下多少还会丢掉细节 */
const MIN_COVERED_ROUNDS = 2

/** 模型上下文窗口；未知模型按 200k 保守处理，宁可早压也不要把请求顶爆 */
const CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
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
  estimateTokens(user.content) + estimateTokens(replyText(reply)) + user.files.length * 64

/** 一轮对话的估算用量，供界面展示当前上下文压力 */
export const estimateContextTokens = (history: Message[]): number =>
  getContextRounds(history).reduce((sum, round) => sum + roundTokens(round), 0)

export type CompactionPlan = {
  /** 被覆盖的最后一轮提问 id */
  coveredUntil: string
  /** 被覆盖的轮数 */
  rounds: number
  /** 被覆盖轮次的估算 token */
  tokens: number
}

/**
 * 选择可压缩区间：从尾部往前累计，攒够 retainTokens 就停，前面剩下的整段作为压缩对象。
 * 只在轮次边界上切分，不会切出孤立的提问或回答。
 * force 用于手动压缩：短对话根本攒不到窗口的 16%，此时保留最近两轮，其余全部压掉。
 */
export const selectCompactionPlan = (
  history: Message[],
  retainTokens: number,
  force = false
): CompactionPlan | null => {
  const rounds = getContextRounds(history)
  if (rounds.length < MIN_COVERED_ROUNDS + 1) {
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
  if (force && keepFrom < MIN_COVERED_ROUNDS) {
    keepFrom = Math.max(MIN_COVERED_ROUNDS, rounds.length - 2)
  }
  if (keepFrom < MIN_COVERED_ROUNDS) {
    return null
  }
  const covered = rounds.slice(0, keepFrom)
  return {
    coveredUntil: covered[covered.length - 1][0].id,
    rounds: covered.length,
    tokens: covered.reduce((sum, round) => sum + roundTokens(round), 0),
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
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text; do not call any tool.',
  '- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint: merge it into the',
  '  new one, keep what is still true, drop what is stale, and never copy it forward verbatim.',
].join('\n')

export type CompactionOutcome = {
  summary: string
  coveredUntil: string
  rounds: number
  tokens: number
  model: string
}

export type CompactionInput = {
  history: Message[]
  /** 上一次压缩的产物：先前的检查点会并入新摘要，避免反复压缩丢掉更早的结论 */
  previous?: { summary: string }
  provider: ActiveProvider
  model: string
  /** 当前生效的系统提示词；重放时带上，尽量贴近真实请求 */
  system: string
  /** 手动压缩：不受 16% 保留比例限制，只留最近两轮 */
  force?: boolean
  signal: AbortSignal
}

/** 压缩不可用的原因：没有可压缩区间 / 摘要失败。界面按 key 映射文案。 */
export class CompactionError extends Error {
  constructor(readonly reason: 'nothing-to-compact' | 'summarize-failed' | 'aborted') {
    super(reason)
    this.name = 'CompactionError'
  }
}

/**
 * 执行一次压缩：选区间 → 重放该区间的文字 → 追加指令请求摘要 → 校验结果。
 * 摘要被输出上限截断或为空都视为失败，绝不写入半截检查点。
 */
export const compactConversation = async ({
  history,
  previous,
  provider,
  model,
  system,
  force = false,
  signal,
}: CompactionInput): Promise<CompactionOutcome> => {
  const window = contextWindowOf(model)
  const plan = selectCompactionPlan(history, Math.round(window * COMPACT_RETAIN_RATIO), force)
  if (!plan) {
    throw new CompactionError('nothing-to-compact')
  }
  const replay = toCompactionReplay(history, plan.coveredUntil)
  // 旧检查点并进指令消息里，而不是单发一条 user：连续两条 user 会被部分服务商判为非法
  const instruction = previous?.summary.trim()
    ? [
        'A prior checkpoint covering even earlier history follows. Merge its still-true facts into the new',
        'summary, drop what is stale, and do not copy it forward verbatim.',
        '',
        '<compacted-summary>',
        previous.summary.trim(),
        '</compacted-summary>',
        '',
        COMPACTION_INSTRUCTION,
      ].join('\n')
    : COMPACTION_INSTRUCTION
  const messages: MessageParam[] = [...replay, { role: 'user', content: instruction }]
  const body: CreateMessageRequest = {
    model,
    ...(system.trim() ? { system } : {}),
    messages,
    max_tokens: SUMMARY_MAX_TOKENS,
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
    throw error instanceof CompactionError ? error : new CompactionError('summarize-failed')
  }
  if (signal.aborted) {
    throw new CompactionError('aborted')
  }
  // 被输出上限截断的摘要会缺章节，宁可整段作废也不要写进上下文
  if (stopReason === 'max_tokens' || !text.trim()) {
    throw new CompactionError('summarize-failed')
  }

  return {
    summary: text.trim(),
    coveredUntil: plan.coveredUntil,
    rounds: plan.rounds,
    tokens: plan.tokens,
    model,
  }
}
