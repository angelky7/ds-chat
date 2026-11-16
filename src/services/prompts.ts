import { create } from 'zustand'
import type { TranslationKey, TranslationParams } from '../i18n/index.js'
import { formatDate } from '../utils/format.js'
import { createId } from '../utils/id.js'
import { locationName } from './chat/latestReminder.js'
import { useSettings } from './settings.js'

/** DeepSeek 官方默认系统提示词；未设置自定义提示词时使用 */
export const DEEPSEEK_DEFAULT_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 内置预设的 id；不可删除，名称随界面语言显示 */
export const DEFAULT_PRESET_ID = 'deepseek-default'

/** 开场消息：新对话建立时带上的示例对话，按顺序进入消息列表与请求上下文 */
export type OpeningMessage = {
  id: string
  role: 'user' | 'assistant'
  /** 支持 {{变量}} */
  content: string
}

export type PromptPreset = {
  id: string
  /** 用户可见名称，允许重名 */
  name: string
  /** 系统提示词，支持 {{变量}} */
  system: string
  /** 开场 user / assistant 对话，可为空 */
  opening: OpeningMessage[]
  /** 内置预设不可删除、不可改名 */
  builtin: boolean
}

type PromptsState = {
  presets: PromptPreset[]
  activeId: string
}

const KEY = 'chat-demo:prompts'

const builtinPreset = (): PromptPreset => ({
  id: DEFAULT_PRESET_ID,
  name: 'DeepSeek 默认',
  system: DEEPSEEK_DEFAULT_PROMPT,
  opening: [],
  builtin: true,
})

const toText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

/** 开场消息逐项校验：角色只接受 user / assistant，内容为空的行丢弃 */
const parseOpening = (value: unknown): OpeningMessage[] => {
  if (!Array.isArray(value)) {
    return []
  }
  const messages: OpeningMessage[] = []
  for (const item of value) {
    const message = (item ?? {}) as Partial<Record<keyof OpeningMessage, unknown>>
    const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : null
    const content = toText(message.content)
    if (!role || !content.trim()) {
      continue
    }
    messages.push({ id: toText(message.id) || createId(), role, content })
    if (messages.length >= 20) {
      break
    }
  }
  return messages
}

/** 保存的数据可能来自旧版本或被手动改动，逐项校验；内置预设始终存在 */
const parsePrompts = (value: unknown): PromptsState => {
  const source = (value ?? {}) as Partial<Record<keyof PromptsState, unknown>>
  const presets: PromptPreset[] = []
  if (Array.isArray(source.presets)) {
    for (const item of source.presets) {
      const preset = (item ?? {}) as Partial<Record<keyof PromptPreset, unknown>>
      const id = toText(preset.id)
      if (!id || id === DEFAULT_PRESET_ID || presets.some((entry) => entry.id === id)) {
        continue
      }
      presets.push({
        id,
        name: toText(preset.name).slice(0, 40),
        system: toText(preset.system),
        opening: parseOpening(preset.opening),
        builtin: false,
      })
    }
  }
  const all = [builtinPreset(), ...presets]
  const activeId = toText(source.activeId)
  return { presets: all, activeId: all.some((item) => item.id === activeId) ? activeId : DEFAULT_PRESET_ID }
}

const load = (): PromptsState => {
  try {
    return parsePrompts(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return { presets: [builtinPreset()], activeId: DEFAULT_PRESET_ID }
  }
}

/** 提示词配置存 localStorage；写入失败（如超出配额）返回 false，由调用方提示 */
const save = (state: PromptsState): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export const usePrompts = create<PromptsState>(() => load())

const commit = (next: PromptsState): boolean => {
  usePrompts.setState(next)
  return save(next)
}

export const setActivePrompt = (activeId: string): boolean => {
  const state = usePrompts.getState()
  if (!state.presets.some((preset) => preset.id === activeId)) {
    return false
  }
  return commit({ ...state, activeId })
}

export const findPrompt = (id: string): PromptPreset | undefined =>
  usePrompts.getState().presets.find((preset) => preset.id === id)

export const updatePrompt = (
  id: string,
  patch: Partial<Pick<PromptPreset, 'name' | 'system' | 'opening'>>
): boolean => {
  const state = usePrompts.getState()
  const target = state.presets.find((preset) => preset.id === id)
  if (!target) {
    return false
  }
  // 内置预设只允许改内容，名称随界面语言固定
  const next = { ...target, ...patch, name: target.builtin ? target.name : (patch.name ?? target.name) }
  return commit({
    ...state,
    presets: state.presets.map((preset) => (preset.id === id ? next : preset)),
  })
}

/** 新增一套提示词并切换过去，返回新预设的 id */
export const createPrompt = (name: string, system = '', opening: OpeningMessage[] = []): string => {
  const state = usePrompts.getState()
  const preset: PromptPreset = { id: createId(), name, system, opening, builtin: false }
  commit({ presets: [...state.presets, preset], activeId: preset.id })
  return preset.id
}

/** 复制现有预设，便于在同一套内容上做变体 */
export const duplicatePrompt = (id: string, name: string): string | null => {
  const source = findPrompt(id)
  if (!source) {
    return null
  }
  return createPrompt(name, source.system, source.opening.map((message) => ({ ...message, id: createId() })))
}

/** 内置预设不可删除；删除正在使用的预设时切回默认 */
export const removePrompt = (id: string): boolean => {
  const state = usePrompts.getState()
  const target = state.presets.find((preset) => preset.id === id)
  if (!target || target.builtin) {
    return false
  }
  return commit({
    presets: state.presets.filter((preset) => preset.id !== id),
    activeId: state.activeId === id ? DEFAULT_PRESET_ID : state.activeId,
  })
}

/** 内置预设恢复官方原文；自定义预设没有「默认内容」，不做重置 */
export const resetPrompt = (id: string): boolean => {
  const state = usePrompts.getState()
  const target = state.presets.find((preset) => preset.id === id)
  if (!target?.builtin) {
    return false
  }
  return commit({
    ...state,
    presets: state.presets.map((preset) =>
      preset.id === id ? { ...preset, system: DEEPSEEK_DEFAULT_PROMPT } : preset
    ),
  })
}

/** 新增一条开场消息：默认接着上一条的角色交替，列表为空时从 user 开始 */
export const addOpeningMessage = (id: string): boolean => {
  const preset = findPrompt(id)
  if (!preset || preset.opening.length >= 20) {
    return false
  }
  const role = preset.opening.at(-1)?.role === 'assistant' ? 'user' : 'assistant'
  const message: OpeningMessage = { id: createId(), role, content: '' }
  return updatePrompt(id, { opening: [...preset.opening, message] })
}

export const updateOpeningMessage = (
  id: string,
  messageId: string,
  patch: Partial<Pick<OpeningMessage, 'role' | 'content'>>
): boolean => {
  const preset = findPrompt(id)
  if (!preset) {
    return false
  }
  return updatePrompt(id, {
    opening: preset.opening.map((message) =>
      message.id === messageId ? { ...message, ...patch } : message
    ),
  })
}

export const removeOpeningMessage = (id: string, messageId: string): boolean => {
  const preset = findPrompt(id)
  if (!preset) {
    return false
  }
  return updatePrompt(id, {
    opening: preset.opening.filter((message) => message.id !== messageId),
  })
}

/** 内置预设的内容被改过，可「恢复默认」 */
export const canRestorePrompt = (preset: PromptPreset): boolean =>
  preset.builtin && preset.system !== DEEPSEEK_DEFAULT_PROMPT

/** 当前可用的模板变量，键同时用于文案与插入的占位符 */
export const PROMPT_VARIABLES = [
  'cur_date',
  'cur_time',
  'cur_weekday',
  'model_name',
  'locale',
  'location',
] as const

export type PromptVariable = (typeof PROMPT_VARIABLES)[number]

const pad = (value: number) => String(value).padStart(2, '0')

/** 替换 {{变量}}；未知变量原样保留，便于用户发现拼写错误 */
export const renderPrompt = (system: string, model: string): string => {
  const { locale, location } = useSettings.getState()
  const now = new Date()
  const values: Record<PromptVariable, string> = {
    cur_date: formatDate(now) ?? '',
    cur_time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    cur_weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now),
    model_name: model,
    locale,
    location: locationName(location, locale),
  }
  return system.replace(/\{\{\s*(\w+)\s*\}\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? values[name as PromptVariable] : placeholder
  )
}

/** 每次请求使用的系统提示词；预设内容为空时回落到 DeepSeek 默认 */
export const resolveActiveSystemPrompt = (model: string): string => {
  const { presets, activeId } = usePrompts.getState()
  const preset = presets.find((item) => item.id === activeId)
  const system = preset?.system.trim() ? preset.system : DEEPSEEK_DEFAULT_PROMPT
  return renderPrompt(system, model)
}

/**
 * 当前预设的开场消息：内容做变量替换后返回，空行丢弃。
 * 新对话建立时按顺序写入消息列表，既显示在界面上，也进入后续请求的上下文。
 */
export const resolveActiveOpening = (model: string): OpeningMessage[] => {
  const { presets, activeId } = usePrompts.getState()
  const preset = presets.find((item) => item.id === activeId)
  return (preset?.opening ?? [])
    .filter((message) => message.content.trim())
    .map((message) => ({ ...message, content: renderPrompt(message.content, model) }))
}

/** 展示名：内置预设跟随界面语言，自定义预设用用户输入的名称 */
export const presetDisplayName = (
  preset: PromptPreset,
  t: (key: TranslationKey, params?: TranslationParams) => string
): string => (preset.builtin || !preset.name ? t('promptPresetDefault') : preset.name)
