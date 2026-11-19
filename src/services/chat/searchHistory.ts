import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import type { Session, SessionSummary } from './types.js'

/** 一条搜索命中：标题命中时 messageId 为空；内容命中时带片段与消息 id */
export type SearchHit = {
  sessionId: string
  title: string
  /** 命中位置附近的文字，标题命中时为空 */
  snippet: string
  messageId: string | null
  role: 'user' | 'assistant' | null
  updatedAt: number
}

export type SearchResult = {
  titleHits: SearchHit[]
  contentHits: SearchHit[]
  /** 内容匹配的会话过多或结果已满时给出提示 */
  truncated: boolean
}

/** 单条命中片段前后保留的字符数 */
const SNIPPET_PAD = 40
/** 同一个会话最多列出几处内容命中，避免一个长会话占满整屏 */
const HITS_PER_SESSION = 3
/** 内容命中总数上限 */
const MAX_CONTENT_HITS = 40

const EMPTY: SearchResult = { titleHits: [], contentHits: [], truncated: false }

/** 可搜索的一条文本：消息 id、说话角色与正文 */
type TextEntry = { id: string; role: 'user' | 'assistant'; text: string }

/** 从可见消息里抽出可搜索文本：提问正文 + 回答的文本块（跳过思考、工具与占位提示） */
const textEntries = (session: Session): TextEntry[] =>
  getVisibleMessages(session).flatMap((message): TextEntry[] => {
    if (message.role === 'user') {
      return message.content ? [{ id: message.id, role: 'user', text: message.content }] : []
    }
    const text = message.blocks
      .flatMap((block) => (block.type === 'text' && !block.isTemplate ? [block.text] : []))
      .join('\n')
      .trim()
    return text ? [{ id: message.id, role: 'assistant', text }] : []
  })

/** 截取命中位置附近的片段，首尾加省略号；空白折叠成单个空格，便于单行展示 */
const snippetOf = (text: string, index: number, length: number): string => {
  const start = Math.max(0, index - SNIPPET_PAD)
  const end = Math.min(text.length, index + length + SNIPPET_PAD)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

/**
 * 同时搜索会话标题与对话内容。
 * 标题用列表元数据匹配（快）；内容需要逐条读取会话正文，用游标遍历并在结果满时提前结束。
 */
export const searchHistory = async (query: string): Promise<SearchResult> => {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return EMPTY
  }
  const summaries = await db.loadSessionSummaries()
  const byId = new Map<string, SessionSummary>(summaries.map((item) => [item.id, item]))
  const titleHits: SearchHit[] = summaries
    .filter((summary) => (summary.title || '').toLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((summary) => ({
      sessionId: summary.id,
      title: summary.title,
      snippet: '',
      messageId: null,
      role: null,
      updatedAt: summary.updatedAt,
    }))

  const contentHits: SearchHit[] = []
  let truncated = false
  await db.forEachSession((session) => {
    const summary = byId.get(session.id)
    if (!summary) {
      return
    }
    let perSession = 0
    for (const entry of textEntries(session)) {
      const index = entry.text.toLowerCase().indexOf(needle)
      if (index < 0) {
        continue
      }
      contentHits.push({
        sessionId: session.id,
        title: summary.title,
        snippet: snippetOf(entry.text, index, needle.length),
        messageId: entry.id,
        role: entry.role,
        updatedAt: summary.updatedAt,
      })
      perSession += 1
      if (perSession >= HITS_PER_SESSION) {
        break
      }
    }
    if (contentHits.length >= MAX_CONTENT_HITS) {
      truncated = true
      return false
    }
    return undefined
  })
  contentHits.sort((a, b) => b.updatedAt - a.updatedAt)
  return { titleHits, contentHits, truncated }
}
