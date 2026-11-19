import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 站点品牌：默认官方 DeepSeek，可切到自用的 DeepSleep 标识 */
export type Brand = 'deepseek' | 'deepsleep'

/** 历史附件重发方式：once 只带一次（默认），every-turn 每轮都回传 */
export type FileResend = 'once' | 'every-turn'

/** 文件解析深度：text 只提取文字（快、省），layout 走版面解析（能读表格与图片） */
export type ParseDepth = 'text' | 'layout'

/** 处理模式：fast / expert 是预设，custom 表示细项被单独改过 */
export type FileMode = 'fast' | 'expert' | 'custom'

/** 本机设置，存 localStorage：语言、主题、品牌、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、是否保留被撤回的回答、采样温度、上下文轮次上限、附件重发方式 */
type Settings = {
  locale: Locale
  themePreference: ThemePreference
  /** 站点品牌，影响标题、左上角文字与 logo */
  brand: Brand
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 模型判定不能回答、撤回已输出内容时，是否仍把这些内容留在对话里展示 */
  keepRefusedAnswer: boolean
  /** 采样温度 0~2，官方默认 1；只在非思考模式下生效，思考模式固定 1.0 */
  temperature: number
  /** 请求里保留的历史轮次上限；0 表示不限制 */
  contextLimit: number
  /** 历史附件是否每轮重发；默认只在那一轮发一次 */
  fileResend: FileResend
  /** 文件解析深度；快速模式只提文字，专家模式走版面解析 */
  parseDepth: ParseDepth
  /** 是否自定义压缩阈值；关闭时固定按默认阈值触发 */
  customThresholdEnabled: boolean
  /** 压缩触发阈值，按窗口的百分比记（20~90）；整数存储避免浮点误差 */
  compactThreshold: number
  /** 固定保留开场若干轮原文不参与压缩（0~10，默认 3） */
  pinnedRounds: number
}

/** 温度取值范围与默认值，与 DeepSeek 官方一致 */
export const MIN_TEMPERATURE = 0
export const MAX_TEMPERATURE = 2
export const DEFAULT_TEMPERATURE = 1

/** 上下文轮次上限：0 表示无限，其余落在 1~50 轮 */
export const CONTEXT_LIMIT_UNLIMITED = 0
export const MIN_CONTEXT_LIMIT = 1
export const MAX_CONTEXT_LIMIT = 50

/** 压缩触发阈值：按窗口百分比，整数存储；达到阈值即压缩（永远生效，开关只决定是否自定义） */
export const MIN_COMPACT_THRESHOLD = 20
export const MAX_COMPACT_THRESHOLD = 90
export const DEFAULT_COMPACT_THRESHOLD = 85

/** 开场保留轮数：固定原文发送、不进入摘要 */
export const MIN_PINNED_ROUNDS = 0
export const MAX_PINNED_ROUNDS = 10
export const DEFAULT_PINNED_ROUNDS = 3

/**
 * 处理模式预设：一次写入「高级」里的全部细项。
 * 快速面向新手：只提文字、附件只发一次；
 * 专家面向读文档：版面解析 + 每轮重发。
 * 压缩永远生效（85% 触发），两种模式的轮次上限都是无限。
 */
type FileModeValues = {
  parseDepth: ParseDepth
  fileResend: FileResend
  compactThreshold: number
  pinnedRounds: number
  contextLimit: number
}

export const FILE_MODE_PRESETS: Record<'fast' | 'expert', FileModeValues> = {
  fast: {
    parseDepth: 'text',
    fileResend: 'once',
    compactThreshold: DEFAULT_COMPACT_THRESHOLD,
    pinnedRounds: DEFAULT_PINNED_ROUNDS,
    contextLimit: CONTEXT_LIMIT_UNLIMITED,
  },
  expert: {
    parseDepth: 'layout',
    fileResend: 'every-turn',
    compactThreshold: DEFAULT_COMPACT_THRESHOLD,
    pinnedRounds: DEFAULT_PINNED_ROUNDS,
    contextLimit: CONTEXT_LIMIT_UNLIMITED,
  },
}

/** 预设覆盖的字段，派生模式时逐个比对 */
const FILE_MODE_FIELDS = [
  'parseDepth',
  'fileResend',
  'compactThreshold',
  'pinnedRounds',
  'contextLimit',
] as const

const KEYS = {
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  brand: 'chat-demo:brand',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  temperature: 'chat-demo:temperature',
  contextLimit: 'chat-demo:context-limit',
  fileResend: 'chat-demo:file-resend',
  parseDepth: 'chat-demo:parse-depth',
  customThreshold: 'chat-demo:custom-threshold',
  compactThreshold: 'chat-demo:compact-threshold',
  pinnedRounds: 'chat-demo:pinned-rounds',
  keepRefusedAnswer: 'chat-demo:keep-refused-answer',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

/** 版本号由构建注入到 meta，读不到就返回空串。横竖屏设置都从这里取。 */
export const appVersion = (): string =>
  document.querySelector('meta[name="application-version"]')?.getAttribute('content') ?? ''

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 默认官方品牌；只有明确存过 deepsleep 才切换 */
const initialBrand = (): Brand => (read(KEYS.brand) === 'deepsleep' ? 'deepsleep' : 'deepseek')

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过或存了非法值时回到默认温度 */
const initialTemperature = (): number => {
  const raw = read(KEYS.temperature)
  if (raw === null || raw.trim() === '') {
    return DEFAULT_TEMPERATURE
  }
  const value = Number(raw)
  return Number.isFinite(value) && value >= MIN_TEMPERATURE && value <= MAX_TEMPERATURE
    ? Math.round(value * 10) / 10
    : DEFAULT_TEMPERATURE
}

/** 默认不限制轮次；存了非法值也回到不限制 */
const initialContextLimit = (): number => {
  const raw = read(KEYS.contextLimit)
  if (raw === null || raw.trim() === '') {
    return CONTEXT_LIMIT_UNLIMITED
  }
  const value = Math.round(Number(raw))
  return Number.isFinite(value) && value >= MIN_CONTEXT_LIMIT && value <= MAX_CONTEXT_LIMIT
    ? value
    : CONTEXT_LIMIT_UNLIMITED
}

/** 默认只在发送附件的那一轮带文件 */
const initialFileResend = (): FileResend =>
  read(KEYS.fileResend) === 'every-turn' ? 'every-turn' : 'once'

/** 默认快速模式：只提取文字，最省额度 */
const initialParseDepth = (): ParseDepth => (read(KEYS.parseDepth) === 'layout' ? 'layout' : 'text')

/**
 * 阈值收敛规则：超过 90% 收敛为 90（留出发送余量），低于 20% 收敛为 20，
 * 非法值回退默认 85%。
 */
const initialCompactThreshold = (): number => {
  const raw = read(KEYS.compactThreshold)
  if (raw === null || raw.trim() === '') {
    return DEFAULT_COMPACT_THRESHOLD
  }
  const value = Math.round(Number(raw))
  if (!Number.isFinite(value)) {
    return DEFAULT_COMPACT_THRESHOLD
  }
  return Math.min(MAX_COMPACT_THRESHOLD, Math.max(MIN_COMPACT_THRESHOLD, value))
}

/** 非法值回退 3 */
const initialPinnedRounds = (): number => {
  const raw = read(KEYS.pinnedRounds)
  if (raw === null || raw.trim() === '') {
    return DEFAULT_PINNED_ROUNDS
  }
  const value = Math.round(Number(raw))
  return Number.isFinite(value) && value >= MIN_PINNED_ROUNDS && value <= MAX_PINNED_ROUNDS
    ? value
    : DEFAULT_PINNED_ROUNDS
}

const initialCustomThresholdEnabled = (): boolean => read(KEYS.customThreshold) === 'true'

export const useSettings = create<Settings>(() => ({
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  brand: initialBrand(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  keepRefusedAnswer: read(KEYS.keepRefusedAnswer) === 'true',
  temperature: initialTemperature(),
  contextLimit: initialContextLimit(),
  fileResend: initialFileResend(),
  parseDepth: initialParseDepth(),
  customThresholdEnabled: initialCustomThresholdEnabled(),
  compactThreshold: initialCompactThreshold(),
  pinnedRounds: initialPinnedRounds(),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setBrand = (brand: Brand) => {
  write(KEYS.brand, brand)
  useSettings.setState({ brand })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setKeepRefusedAnswer = (keepRefusedAnswer: boolean) => {
  write(KEYS.keepRefusedAnswer, String(keepRefusedAnswer))
  useSettings.setState({ keepRefusedAnswer })
}

/** 温度按 0.1 步进保存；越界时夹到合法区间 */
export const setTemperature = (value: number) => {
  const clamped = Math.min(
    MAX_TEMPERATURE,
    Math.max(MIN_TEMPERATURE, Math.round(value * 10) / 10)
  )
  write(KEYS.temperature, String(clamped))
  useSettings.setState({ temperature: clamped })
}

export const resetTemperature = () => setTemperature(DEFAULT_TEMPERATURE)

/** 轮次上限按整数保存；0 表示不限制，其余夹在 1~50 */
export const setContextLimit = (value: number) => {
  const rounded = Math.round(value)
  const clamped =
    rounded <= CONTEXT_LIMIT_UNLIMITED
      ? CONTEXT_LIMIT_UNLIMITED
      : Math.min(MAX_CONTEXT_LIMIT, Math.max(MIN_CONTEXT_LIMIT, rounded))
  write(KEYS.contextLimit, String(clamped))
  useSettings.setState({ contextLimit: clamped })
}

export const resetContextLimit = () => setContextLimit(CONTEXT_LIMIT_UNLIMITED)

export const setFileResend = (fileResend: FileResend) => {
  write(KEYS.fileResend, fileResend)
  useSettings.setState({ fileResend })
}

export const setCustomThresholdEnabled = (enabled: boolean) => {
  write(KEYS.customThreshold, String(enabled))
  useSettings.setState({ customThresholdEnabled: enabled })
}

export const setParseDepth = (parseDepth: ParseDepth) => {
  write(KEYS.parseDepth, parseDepth)
  useSettings.setState({ parseDepth })
}

/** 阈值按整数百分比保存；越界夹到 20~90 */
export const setCompactThreshold = (value: number) => {
  const clamped = Math.min(
    MAX_COMPACT_THRESHOLD,
    Math.max(MIN_COMPACT_THRESHOLD, Math.round(value))
  )
  write(KEYS.compactThreshold, String(clamped))
  useSettings.setState({ compactThreshold: clamped })
}

/** 开场保留轮数按整数保存；越界夹到 0~10 */
export const setPinnedRounds = (value: number) => {
  const clamped = Math.min(
    MAX_PINNED_ROUNDS,
    Math.max(MIN_PINNED_ROUNDS, Math.round(value))
  )
  write(KEYS.pinnedRounds, String(clamped))
  useSettings.setState({ pinnedRounds: clamped })
}

/**
 * 一次性把预设写进全部细项。模式本身不落盘，由细项反推，
 * 这样就不会出现「显示专家、实际只发一次」这种两个数据源打架的情况。
 */
export const applyFileMode = (mode: 'fast' | 'expert') => {
  const preset = FILE_MODE_PRESETS[mode]
  write(KEYS.parseDepth, preset.parseDepth)
  write(KEYS.fileResend, preset.fileResend)
  write(KEYS.compactThreshold, String(preset.compactThreshold))
  write(KEYS.pinnedRounds, String(preset.pinnedRounds))
  write(KEYS.contextLimit, String(preset.contextLimit))
  useSettings.setState(preset)
}

const diffFrom = (state: FileModeValues, preset: FileModeValues): number =>
  FILE_MODE_FIELDS.reduce((count, field) => (state[field] === preset[field] ? count : count + 1), 0)

/** 与某个预设完全一致就算该模式，否则为自定义 */
export const activeFileMode = (state: FileModeValues): FileMode =>
  diffFrom(state, FILE_MODE_PRESETS.fast) === 0
    ? 'fast'
    : diffFrom(state, FILE_MODE_PRESETS.expert) === 0
      ? 'expert'
      : 'custom'

/** 自定义时与最近预设相差的项数，供「已自定义 N 项」提示 */
export const fileModeChanged = (state: FileModeValues): number =>
  Math.min(diffFrom(state, FILE_MODE_PRESETS.fast), diffFrom(state, FILE_MODE_PRESETS.expert))
