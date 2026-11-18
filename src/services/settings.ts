import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、是否保留被撤回的回答、采样温度 */
type Settings = {
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 模型判定不能回答、撤回已输出内容时，是否仍把这些内容留在对话里展示 */
  keepRefusedAnswer: boolean
  /** 采样温度 0~2，官方默认 1；只在非思考模式下生效，思考模式固定 1.0 */
  temperature: number
}

/** 温度取值范围与默认值，与 DeepSeek 官方一致 */
export const MIN_TEMPERATURE = 0
export const MAX_TEMPERATURE = 2
export const DEFAULT_TEMPERATURE = 1

const KEYS = {
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  temperature: 'chat-demo:temperature',
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

export const useSettings = create<Settings>(() => ({
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  keepRefusedAnswer: read(KEYS.keepRefusedAnswer) === 'true',
  temperature: initialTemperature(),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
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
