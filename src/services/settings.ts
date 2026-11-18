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
}

/** 温度取值范围与默认值，与 DeepSeek 官方一致 */
export const MIN_TEMPERATURE = 0
export const MAX_TEMPERATURE = 2
export const DEFAULT_TEMPERATURE = 1

/** 上下文轮次上限：0 表示无限，其余落在 1~50 轮 */
export const CONTEXT_LIMIT_UNLIMITED = 0
export const MIN_CONTEXT_LIMIT = 1
export const MAX_CONTEXT_LIMIT = 50

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
