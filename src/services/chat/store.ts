import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { isSupportedImageType, prepareImageFile } from '../../utils/image.js'
import { ApiError, streamMessage } from '../api/client.js'
import { streamChatCompletion, toChatCompletion } from '../api/openai.js'
import type { ChatModel, CreateMessageRequest } from '../api/types.js'
import { extractFileIds, getFileErrorCode, isRetryableApiError } from '../api/errors.js'
import { cancelUpload, describeUploadError, uploadAttachment, useUploads } from '../attachments.js'
import { translate } from '../../i18n/index.js'
import { showToast } from '../../components/base/toastState.js'
import { DEFAULT_TEMPERATURE, DEFAULT_COMPACT_THRESHOLD, useSettings } from '../settings.js'
import {
  DEEPSEEK_DEFAULT_PROMPT,
  resolveActiveOpening,
  resolveActiveSystemPrompt,
  type OpeningMessage,
} from '../prompts.js'
import { activeApiKey, activeProvider, type ActiveProvider } from '../providers.js'
import { appendBranch, getVisibleMessages, normalizeSession, selectVersion } from './branches.js'
import * as db from './db.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  loadMessageDraft,
  prepareDraftMessage,
  setDraft,
  snapshotDraft,
  type Draft,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import {
  COMPACT_RETAIN_RATIO,
  CompactionError,
  compactConversation,
  contextWindowOf,
  estimateContextTokens,
  estimateTokens,
  savedTokensOf,
  selectCompactionPlan,
} from './compact.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  settleReply,
  toRequestMessages,
  type ImageResolver,
  type InlineImage,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type Compaction,
  type FileAttachment,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** deepseek-flash 同时支持深度思考与图片输入 */
const MODEL: ChatModel = 'deepseek-flash'
/** 第三方 Anthropic 兼容网关要求显式给出输出上限 */
const MAX_OUTPUT_TOKENS = 8192

/** 发送时以输入框右下角选中的模型为准；会话里记录的 model 只用于展示 */
const resolveModel = (_initial: ChatModel | null | undefined, provider: ActiveProvider): string =>
  provider.model

/**
 * 开场消息转成真实消息：用户消息直接展示，助手消息视为已完成的回答，
 * 因此会进入后续请求的上下文，相当于给模型一段示例对话。
 */
const openingMessages = (opening: OpeningMessage[]): Message[] => {
  const now = Date.now()
  return opening.map((item, index) => {
    const createdAt = now - (opening.length - index) * 1000
    return item.role === 'user'
      ? { id: createId(), role: 'user', content: item.content, files: [], createdAt }
      : {
          id: createId(),
          role: 'assistant',
          createdAt,
          model: activeProvider().model,
          thinking: false,
          search: false,
          prefix: false,
          status: 'done',
          stopReason: 'end_turn',
          blocks: [{ type: 'text', text: item.content, citations: [] }],
        }
  })
}

/** 没有服务端标题时用首句兜底，最多 30 个字符 */
const localTitle = ({ content }: UserMessage): string =>
  content.trim().replace(/\s+/g, ' ').slice(0, 30)
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 安全审核固定开启，所有请求都走扩展模式 */
const SAFETY_CHECK = { level: 'high' } as const
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
  /** 正在压缩上下文的会话，用于按钮与提示的忙碌态 */
  compacting: Record<string, boolean>
  /** 正在编辑的消息：内容与附件已载入输入框，发送后作为新版本 */
  editingMessage: { sessionId: string; messageId: string } | null
  /** 搜索结果要求定位的消息：会话渲染后滚动到它并清除 */
  pendingMessageId: string | null
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
  compacting: {},
  editingMessage: null,
  pendingMessageId: null,
}))

const { getState: get, setState: set } = useChatStore

/** 置顶在前，其余按更新时间倒序；置顶会话收到新消息也不会掉出置顶组 */
const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt
  )

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title &&
  a.createdAt === b.createdAt &&
  a.updatedAt === b.updatedAt &&
  Boolean(a.pinned) === Boolean(b.pinned)

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
/** 压缩止损：记录上次「压不动」时的最后一条消息 id，内容没变化就不再重复尝试 */
const compactionFloorAt = new Map<string, string>()
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

/**
 * 每个会话的保存串行化：saveSession 要先把附件转成 ArrayBuffer，带附件的保存会慢于后一次保存，
 * 两次保存乱序提交时旧快照会把新内容盖掉（表现为刷新后最后几条消息或回答消失）。
 * 按调用顺序排队，保证最后一次调用对应的快照最终落盘。
 */
const saveQueues = new Map<string, Promise<void>>()

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  unsavedSessions.add(sessionId)
  if (deletingSessions.has(sessionId)) {
    return
  }
  const epoch = historyEpoch
  const files = pendingFiles.get(sessionId)
  const task = (saveQueues.get(sessionId) ?? Promise.resolve())
    .then(() => {
      // 整库替换（导入/清空）之后，排队中的旧快照不再写回，避免把已删除的会话复活
      if (epoch !== historyEpoch) {
        return
      }
      return db.saveSession(session, files)
    })
    .then(() => {
      if (epoch !== historyEpoch || !getSession(sessionId)) {
        return
      }
      if (pendingFiles.get(sessionId) === files) {
        pendingFiles.delete(sessionId)
      }
      if (getSession(sessionId) === session) {
        unsavedSessions.delete(sessionId)
        set((state) => ({
          sessionSaveErrors: Object.fromEntries(
            Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
          ),
        }))
        trimSessionCache()
      }
    })
    .catch((error: unknown) => {
      db.reportStorageError('save session')(error)
      if (epoch === historyEpoch && getSession(sessionId)) {
        set((state) => ({
          sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
        }))
      }
    })
  saveQueues.set(sessionId, task)
  // 队列跑完就释放，避免长时间使用后 Map 里堆积无用的 Promise
  void task.finally(() => {
    if (saveQueues.get(sessionId) === task) {
      saveQueues.delete(sessionId)
    }
  })
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (): AssistantMessage => {
  const { thinking, search } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: activeProvider().model,
    thinking,
    search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const summaries = await db.loadSessionSummaries()
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    saveQueues.clear()
    compactionFloorAt.clear()
    clearAllDrafts()
    editingBackups.clear()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
      // 整库替换后原来的编辑目标可能已不存在
      editingMessage: null,
    })
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

/**
 * 切换对话前退出编辑态：编辑内容占着当前会话的草稿，直接切走会把用户原来没发出去的内容挤掉，
 * 所以先还原成编辑前的草稿。
 */
const leaveEditing = (target: string | null) => {
  const editing = get().editingMessage
  if (editing && editing.sessionId !== target) {
    cancelEditingMessage()
  }
}

export const newChat = () => {
  if (!get().importingHistory) {
    leaveEditing(null)
    set({ activeId: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    leaveEditing(id)
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

/**
 * 从搜索结果跳转：打开该会话，并标记要滚动到的消息。
 * 消息可能还没渲染，由消息列表在渲染后消费并清除标记。
 */
export const revealMessage = (sessionId: string, messageId: string | null) => {
  selectSession(sessionId)
  set({ pendingMessageId: messageId })
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 置顶 / 取消置顶。已打开的会话走内存更新（随后由 persist 一并落盘），
 * 未打开的会话直接改库，避免为了一个布尔字段把整段消息读进内存。
 */
export const setSessionPinned = (id: string, pinned: boolean) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, pinned }))
    persist(id)
    return
  }
  set((state) => ({
    sessions: sortSessions(
      state.sessions.map((session) => (session.id === id ? { ...session, pinned } : session))
    ),
  }))
  void db.setSessionPinned(id, pinned).catch((error: unknown) => {
    db.reportStorageError('pin session')(error)
    // 写库失败时回滚列表，避免界面显示成已置顶但刷新后回落
    set((state) => ({
      sessions: sortSessions(
        state.sessions.map((session) =>
          session.id === id ? { ...session, pinned: !pinned } : session
        )
      ),
    }))
  })
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    editingBackups.delete(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
      // 正在编辑的就是这个会话时一并退出编辑态
      editingMessage: state.editingMessage?.sessionId === id ? null : state.editingMessage,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

const setCompacting = (sessionId: string, busy: boolean) =>
  // 置 false 而不是删除键：动态 delete 会拖慢对象形状，也过不了 lint
  set((state) => ({ compacting: { ...state.compacting, [sessionId]: busy } }))

/**
 * 跑一次压缩并写回会话。失败时把 CompactionError 抛给调用方，
 * 由自动流程吞掉、由手动流程展示原因；两种情况下已有检查点都保持不变。
 */
const runCompaction = async (
  sessionId: string,
  history: Message[],
  signal: AbortSignal,
  force = false,
  pinnedRounds = 0
): Promise<Compaction> => {
  const session = getSession(sessionId)
  if (!session) {
    throw new Error('session missing')
  }
  const provider = activeProvider()
  const model = resolveModel(null, provider)
  setCompacting(sessionId, true)
  try {
    const outcome = await compactConversation({
      history,
      ...(session.compaction ? { previous: session.compaction } : {}),
      provider,
      model,
      system: resolveActiveSystemPrompt(model),
      force,
      pinnedRounds,
      signal,
    })
    const compaction: Compaction = { ...outcome, at: Date.now() }
    updateSession(sessionId, (current) => ({
      ...current,
      compaction,
      updatedAt: Date.now(),
    }))
    persist(sessionId)
    return compaction
  } finally {
    setCompacting(sessionId, false)
  }
}

/** 手动压缩当前会话；没有说话内容、正在生成或没有可压缩区间时抛错由界面提示 */
export const compactSession = async (sessionId: string): Promise<Compaction> => {
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    throw new Error('session busy')
  }
  const history = getVisibleMessages(session)
  const controller = new AbortController()
  // 手动压缩不受窗口比例限制：压掉除开场保留轮次与最近两轮外的全部内容
  return runCompaction(
    sessionId,
    history,
    controller.signal,
    true,
    useSettings.getState().pinnedRounds
  )
}

/** 丢弃检查点，恢复发送完整历史；原文一直在本地，不需要重建 */
export const clearCompaction = (sessionId: string) => {
  compactionFloorAt.delete(sessionId)
  updateSession(sessionId, (session) => {
    if (!session.compaction) {
      return session
    }
    const next: Session = { ...session, updatedAt: Date.now() }
    delete next.compaction
    return next
  })
  persist(sessionId)
}

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(
    getDraft(targetSessionId),
    useUploads.getState().tasks,
    !activeProvider().capabilities.files
  )
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  // 防线一：单条消息本身超过模型窗口时请求必然失败，直接拒发并说明原因
  const messageTokens =
    estimateTokens(text) +
    files.reduce((sum, file) => sum + (file.text ? estimateTokens(file.text) : 64), 0)
  if (messageTokens >= contextWindowOf(activeProvider().model)) {
    showToast({ key: 'chatMessageOverWindow' })
    return false
  }
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    // 新对话先铺开放场消息，首次提问接在它们之后
    const seed = openingMessages(resolveActiveOpening(activeProvider().model))
    const session: Session = appendBranch(
      {
        id: createId(),
        title: '',
        createdAt: now,
        updatedAt: now,
        messages: [],
        rootMessageId: null,
      },
      null,
      seed
    )
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    // 内联文档的本地解析文字随附件一起保存，历史轮次按重发策略决定是否带上
    files: files.map(({ id, serverId, name, size, isImage, mimeType, text }) => ({
      id,
      serverId,
      name,
      size,
      isImage,
      mimeType,
      ...(text ? { text } : {}),
    })),
    createdAt: now,
  }
  const reply = createReply()
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }))
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(targetSessionId)
  void streamReply(sessionId, reply, {
    history,
    question,
    blobs: new Map<string, Blob>(
      files.map((file): [string, Blob] => [file.id, file.blob])
    ),
  })
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question })
}

/** 编辑前的草稿备份：取消编辑时原样恢复，按会话存 */
const editingBackups = new Map<string, Draft>()

/**
 * 载入一条已发送消息进入编辑态：文字与附件回到输入框，附件可增可删。
 * 附件原件从 IndexedDB 取；需要时重新上传或重新解析，取消时全部还原。
 */
export const startEditingMessage = async (
  sessionId: string,
  messageId: string
): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(sessionId) || getStreamController(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session) {
    return false
  }
  const target = getVisibleMessages(session).find((message) => message.id === messageId)
  if (target?.role !== 'user') {
    return false
  }
  // 先备份用户正在输入的内容，取消编辑时原样还回去
  editingBackups.set(sessionId, snapshotDraft(sessionId))
  const missing = await loadMessageDraft(
    sessionId,
    target.content,
    target.files,
    activeApiKey(),
    !activeProvider().capabilities.files
  )
  set({ editingMessage: { sessionId, messageId } })
  if (missing > 0) {
    // 归档可能只带文件信息、没有原件；这类附件无法随编辑一起重发
    showToast({ key: 'chatEditMissingFiles', params: { count: missing } })
  }
  return true
}

/** 放弃编辑：释放编辑态附件的预览与上传，恢复编辑前的草稿 */
export const cancelEditingMessage = () => {
  const editing = get().editingMessage
  if (!editing) {
    return
  }
  const { sessionId } = editing
  clearDraft(sessionId)
  const backup = editingBackups.get(sessionId)
  editingBackups.delete(sessionId)
  if (backup) {
    setDraft(sessionId, backup)
  }
  set({ editingMessage: null })
}

/**
 * 提交编辑：按输入框当前内容（含增删后的附件）生成一条新提问，接在原提问的父节点下，
 * 作为该轮的新版本；旧提问及其回答仍可切回，不会被删除。
 */
export const sendEditedMessage = (): boolean => {
  const editing = get().editingMessage
  if (!editing || get().importingHistory || !get().ready) {
    return false
  }
  const { sessionId, messageId } = editing
  if (deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const prepared = prepareDraftMessage(
    getDraft(sessionId),
    useUploads.getState().tasks,
    !activeProvider().capabilities.files
  )
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  const messageTokens =
    estimateTokens(text) +
    files.reduce((sum, file) => sum + (file.text ? estimateTokens(file.text) : 64), 0)
  if (messageTokens >= contextWindowOf(activeProvider().model)) {
    showToast({ key: 'chatMessageOverWindow' })
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  if (index < 0 || path[index]?.role !== 'user') {
    return false
  }
  const history = path.slice(0, index)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, serverId, name, size, isImage, mimeType, text: documentText }) => ({
      id,
      serverId,
      name,
      size,
      isImage,
      mimeType,
      ...(documentText ? { text: documentText } : {}),
    })),
    createdAt: Date.now(),
  }
  const reply = createReply()
  updateSession(sessionId, (current) => ({
    ...appendBranch(current, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(sessionId)
  editingBackups.delete(sessionId)
  set({ editingMessage: null })
  void streamReply(sessionId, reply, {
    history,
    question,
    blobs: new Map<string, Blob>(files.map((file): [string, Blob] => [file.id, file.blob])),
  })
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用默认模型和当前开关。
    model: previous.model ?? MODEL,
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = {
  history: Message[]
  question: UserMessage
  prefix?: AssistantMessage
  /** 本轮提问的原件，尚未落盘时也能直接内联，避免读取 IndexedDB 的时序问题 */
  blobs?: Map<string, Blob>
}

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (file: FileAttachment): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  // 上传失败后改走内联的附件：再传一次只会重复撞上同一个失败
  if (file.local) {
    return null
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  // 导入或旧版本存下的图片可能是不被支持的格式（HEIC 伪装成 jpg、CMYK、渐进式 JPEG）。
  // 一律先过 prepareImageFile：它会对 JPEG 重新编码、对 PNG/GIF/WebP 原样保留。
  if (file.isImage) {
    const converted = await prepareImageFile(
      new File([blob], file.name || 'image', { type: blob.type || file.mimeType || '' })
    )
    if (converted) {
      return uploadAttachment(activeApiKey(), file.id, converted, converted.name, true)
    }
    // 无法解码时仍用原件补传，由服务端决定是否接受，避免直接丢失附件。
  }
  return uploadAttachment(activeApiKey(), file.id, blob, file.name, file.isImage)
}

/** Blob 转 base64（不含 data URL 前缀） */
const readBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // 分块拼接，避免超长参数导致的调用栈溢出
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** 上下文里出现过的全部附件，最近的提问在前 */
const collectFiles = (request: Request): FileAttachment[] => [
  ...request.question.files,
  ...getContextRounds(request.history).flatMap(([user]) => user.files),
]

/**
 * 第三方服务商没有 Files API：图片按 base64 内联，文档附件无法解析。
 * 本轮提问带文档时直接报错拦下；历史里的文档静默跳过，不影响继续对话。
 */
const inlineImages = async (
  request: Request,
  signal: AbortSignal,
  blobs?: Map<string, Blob>
): Promise<ImageResolver> => {
  const map = new Map<string, InlineImage>()
  for (const file of collectFiles(request)) {
    if (!file.isImage || map.has(file.id)) {
      continue
    }
    signal.throwIfAborted()
    const blob = blobs?.get(file.id) ?? (await db.loadFile(file.id))
    if (!blob) {
      continue
    }
    let source = blob
    let mediaType = blob.type || file.mimeType || 'image/png'
    // 历史附件可能是早期版本存下的 bmp/tiff 等格式，内联前再兜一次转换
    if (!isSupportedImageType(mediaType)) {
      const converted = await prepareImageFile(
        new File([blob], file.name || 'image', { type: mediaType })
      )
      if (converted) {
        source = converted
        mediaType = 'image/jpeg'
      }
    }
    map.set(file.id, {
      mediaType,
      data: await readBase64(source),
    })
  }
  return (id) => map.get(id)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
    blobs: request.blobs,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const serverIds = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const serverId = await ensureServerId(file)
      if (serverId) {
        serverIds.set(file.id, serverId)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  // 只看会进入请求的轮次：被上下文上限截掉的轮次不必再上传附件
  const contextLimit = useSettings.getState().contextLimit
  const contextRounds = getContextRounds(request.history)
  const visibleRounds =
    contextLimit > 0 && contextRounds.length > contextLimit
      ? contextRounds.slice(-contextLimit)
      : contextRounds
  // 不用 toReversed：旧版 iOS Safari 没有这个方法，补传历史附件时会抛错。
  for (const [user] of [...visibleRounds].reverse()) {
    for (const file of user.files) {
      if (!file.serverId && !file.local && !serverIds.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const serverId = await Promise.race([ensureServerId(file), aborted])
      if (serverId) {
        serverIds.set(file.id, serverId)
        saveServerIds(sessionId, new Map([[file.id, serverId]]))
      }
    } catch {
      signal.throwIfAborted()
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
    blobs: request.blobs,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  // 只统计还在上下文窗口内的轮次，被截掉的附件即便失效也不必重传
  const contextLimit = useSettings.getState().contextLimit
  const rounds = getContextRounds(request.history)
  const visibleRounds =
    contextLimit > 0 && rounds.length > contextLimit ? rounds.slice(-contextLimit) : rounds
  for (const [user] of visibleRounds) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const provider = activeProvider()
  const controller = new AbortController()
  // 标题优先由 DeepSeek 服务端生成；其他服务商用首句本地兜底
  const wantsServerTitle = !getSession(sessionId)?.title && provider.capabilities.serverTitle
  if (wantsServerTitle) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = initial
  let frame = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)

  try {
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      try {
        // 压缩永远生效：有效上下文（未覆盖轮次 + 摘要 + 开场保留轮次）达到阈值即压缩。
        // 压缩失败只记在控制台，继续按原有方式发送，绝不因压缩问题挡住消息。
        const autoModel = resolveModel(initial.model, provider)
        const pressureWindow = contextWindowOf(autoModel)
        const {
          customThresholdEnabled,
          compactThreshold: thresholdSetting,
          pinnedRounds,
        } = useSettings.getState()
        const threshold =
          (customThresholdEnabled ? thresholdSetting : DEFAULT_COMPACT_THRESHOLD) / 100
        const pressure = estimateContextTokens(
          request.history,
          getSession(sessionId)?.compaction,
          pinnedRounds
        )
        if (pressure >= pressureWindow * threshold) {
          // 上次「压不动」时的最后一条消息：内容没变化就不再重复尝试，新增轮次后允许重试
          const floorKey = request.history[request.history.length - 1]?.id ?? ''
          const floored = floorKey !== '' && compactionFloorAt.get(sessionId) === floorKey
          if (!floored) {
            const existing = getSession(sessionId)?.compaction
            // 防线二：开场保留轮次与旧检查点之外已没有足够的新轮次 → 止损，不再反复尝试
            const plan = selectCompactionPlan(
              request.history,
              Math.round(pressureWindow * COMPACT_RETAIN_RATIO),
              false,
              pinnedRounds,
              existing
            )
            if (!plan) {
              // 没有可压区间，或旧检查点之后没有足够的新轮次（压了也不会有进展）
              compactionFloorAt.set(sessionId, floorKey)
              showToast({ key: 'settingsCompactFloor' })
            } else {
              const done = await runCompaction(
                sessionId,
                request.history,
                controller.signal,
                false,
                pinnedRounds
              ).catch((error: unknown) => {
                // 没有可压内容或用户中断都不必打扰；只有摘要真的失败才提示
                const silent =
                  error instanceof CompactionError &&
                  (error.reason === 'nothing-to-compact' || error.reason === 'aborted')
                if (error instanceof CompactionError && error.reason === 'nothing-to-compact') {
                  // 选区间与实际执行之间出现竞态：同样记为「压不动」，避免下次重复尝试
                  compactionFloorAt.set(sessionId, floorKey)
                }
                if (!silent) {
                  // 自动压缩失败在界面上只有一句提示，详细原因打到控制台便于排查
                  // eslint-disable-next-line no-console
                  console.warn('[auto-compact] failed:', error)
                  showToast({ key: 'settingsAutoCompactFailed' })
                }
                return null
              })
              if (done) {
                // 防线三：有效上下文降幅不足 10% 且压力仍超阈值 → 无进展，提示并停止后续重试
                const after = estimateContextTokens(request.history, done, pinnedRounds)
                const reduction = (pressure - after) / Math.max(pressure, 1)
                if (reduction < 0.1 && after >= pressureWindow * threshold) {
                  compactionFloorAt.set(sessionId, floorKey)
                  showToast({ key: 'settingsCompactFloor' })
                } else {
                  const saved = savedTokensOf(done)
                  showToast(
                    saved > 0
                      ? {
                          key: 'settingsAutoCompactDone',
                          params: { tokens: saved.toLocaleString() },
                        }
                      : { key: 'settingsAutoCompactDoneTight' }
                  )
                }
              }
            }
          }
        }
        const prepared = provider.capabilities.files
          ? await prepareFiles(sessionId, request, controller.signal)
          : request
        preparing = false
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const latestReminder = prepared.prefix
          ? prepared.prefix.latestReminder
          : createLatestReminder(useSettings.getState())
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        const model = resolveModel(initial.model, provider)
        // 非 Flash / 非 DeepSeek 模型没有 Files API；不支持视觉时连内联图片也不发。
        // 有 Files API 的服务商平时只用 file_id，仅当有图片上传失败（没有 serverId）时才读本地原件内联。
        const needsInline = collectFiles(prepared).some((file) => file.isImage && !file.serverId)
        const images = provider.capabilities.files
          ? needsInline
            ? await inlineImages(prepared, controller.signal, request.blobs)
            : undefined
          : provider.capabilities.images
            ? await inlineImages(prepared, controller.signal, request.blobs)
            : () => undefined
        // latest_reminder 是 DeepSeek Flash 的扩展角色，其他模型与服务商都不接受
        const supportsReminder = provider.capabilities.files
        const { contextLimit, fileResend } = useSettings.getState()
        // 压缩可能刚在本次发送前完成，这里读最新值而不是起始快照
        const compaction = getSession(sessionId)?.compaction
        const messages = toRequestMessages(
          prepared.history,
          prepared.question,
          prepared.prefix,
          initial.thinking ?? false,
          supportsReminder ? latestReminder : undefined,
          images,
          {
            contextLimit,
            // 内联文档靠文本注入，every-turn 对第三方服务商同样生效
            fileResend,
            // 开场 N 轮原文固定发送、不参与压缩
            pinnedRounds,
            ...(compaction
              ? { compaction: { summary: compaction.summary, coveredUntil: compaction.coveredUntil } }
              : {}),
          }
        ).filter((message) => supportsReminder || message.role !== 'latest_reminder')
        // 内置默认提示词声明的是 DeepSeek 身份，别的服务商下留空更合适
        const system = resolveActiveSystemPrompt(model)
        const trimmedSystem =
          provider.id === 'deepseek' || system.trim() !== DEEPSEEK_DEFAULT_PROMPT ? system : ''
        // 默认温度不发送，交给服务端；思考模式下服务端本身固定 1.0
        const temperature = useSettings.getState().temperature
        // 思考开关：DeepSeek 与 OpenAI 兼容服务商默认可能开启推理，关闭时必须显式传；
        // Anthropic 兼容的第三方（MiMo 等）默认关闭，只在开启时传，避免不认识 disabled。
        const explicitThinking = provider.id === 'deepseek' || provider.protocol === 'openai'
        const thinkingParam = provider.capabilities.thinking
          ? explicitThinking || initial.thinking
            ? { thinking: { type: initial.thinking ? ('enabled' as const) : ('disabled' as const) } }
            : {}
          : {}
        const body: CreateMessageRequest = {
          model,
          ...(trimmedSystem.trim() ? { system: trimmedSystem } : {}),
          messages,
          ...(temperature === DEFAULT_TEMPERATURE ? {} : { temperature }),
          ...(provider.capabilities.files
            ? {
                thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
                safety_check: SAFETY_CHECK,
                tools: serverTools(initial.search ?? false),
              }
            : {
                max_tokens: MAX_OUTPUT_TOKENS,
                ...thinkingParam,
              }),
          ...(wantsServerTitle ? { title: { enabled: true } } : {}),
        }
        // 服务端生成标题只在 DeepSeek 下可用，其他服务商用首句兜底
        if (!provider.capabilities.serverTitle && !getSession(sessionId)?.title) {
          const title = localTitle(prepared.question)
          if (title) {
            updateSession(sessionId, (session) =>
              session.title ? session : { ...session, title }
            )
          }
        }
        const events =
          provider.protocol === 'anthropic'
            ? streamMessage(provider, body, controller.signal)
            : streamChatCompletion(provider, toChatCompletion(body, model), controller.signal)
        const blockIndexes = new Map<number, number>()
        for await (const event of events) {
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          if (document.visibilityState === 'hidden') {
            flush()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        reply = settleReply(reply, 'done', Date.now())
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        if (preparing) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'upload',
            message: '',
            localMessage: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now())
        } else if (error instanceof ApiError) {
          const networkHint =
            error.kind === 'network'
              ? ` ${translate('providerNetworkHint', { name: provider.preset.label })}`
              : ''
          reply = settleReply(reply, 'error', Date.now(), {
            kind: error.kind,
            message: `${error.message}${networkHint}`,
            status: error.status,
            localMessage: error.localMessage,
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
  }
}
