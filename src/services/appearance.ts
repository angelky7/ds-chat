import { create } from 'zustand'

/** 深色 / 浅色主题各自保存一套外观，避免互相冲突 */
export type AppearanceTheme = 'light' | 'dark'

export type BackgroundKind = 'none' | 'color' | 'gradient' | 'image'

/** 单个主题下的外观：气泡颜色与背景 */
export type ThemeAppearance = {
  /** null 表示沿用内置样式 */
  assistantBubble: string | null
  userBubble: string | null
  backgroundKind: BackgroundKind
  /** 纯色背景色 / 渐变起始色 */
  backgroundFrom: string
  /** 渐变结束色 */
  backgroundTo: string
  /** 自定义背景图（data URL） */
  backgroundImage: string | null
  /** 图片遮罩强度 0-100，越高文字越清晰 */
  backgroundOverlay: number
}

export type Appearance = {
  /** 是否在消息旁显示头像；关闭后恢复官方默认布局 */
  showAvatars: boolean
  assistantAvatar: string | null
  userAvatar: string | null
  themes: Record<AppearanceTheme, ThemeAppearance>
}

const KEY = 'chat-demo:appearance'
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const OVERLAY_DEFAULT = 55

const defaultTheme = (): ThemeAppearance => ({
  assistantBubble: null,
  userBubble: null,
  backgroundKind: 'none',
  backgroundFrom: '#e8f0ff',
  backgroundTo: '#f7ecff',
  backgroundImage: null,
  backgroundOverlay: OVERLAY_DEFAULT,
})

export const defaultAppearance = (): Appearance => ({
  showAvatars: true,
  assistantAvatar: null,
  userAvatar: null,
  themes: { light: defaultTheme(), dark: defaultTheme() },
})

/** 保存过的数据可能来自旧版本或被手动改动，逐字段校验后再使用 */
const toColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback

const toOptionalColor = (value: unknown): string | null =>
  typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : null

const toImage = (value: unknown): string | null =>
  typeof value === 'string' && value.startsWith('data:image/') ? value : null

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const toOverlay = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : OVERLAY_DEFAULT

const toKind = (value: unknown): BackgroundKind => {
  if (value === 'color' || value === 'gradient' || value === 'image') {
    return value
  }
  return 'none'
}

const toThemeAppearance = (value: unknown): ThemeAppearance => {
  const source = (value ?? {}) as Partial<Record<keyof ThemeAppearance, unknown>>
  const fallback = defaultTheme()
  return {
    assistantBubble: toOptionalColor(source.assistantBubble),
    userBubble: toOptionalColor(source.userBubble),
    backgroundKind: toKind(source.backgroundKind),
    backgroundFrom: toColor(source.backgroundFrom, fallback.backgroundFrom),
    backgroundTo: toColor(source.backgroundTo, fallback.backgroundTo),
    backgroundImage: toImage(source.backgroundImage),
    backgroundOverlay: toOverlay(source.backgroundOverlay),
  }
}

const parseAppearance = (value: unknown): Appearance => {
  const source = (value ?? {}) as Partial<Record<keyof Appearance, unknown>>
  const themes = (source.themes ?? {}) as Partial<Record<AppearanceTheme, unknown>>
  return {
    showAvatars: toBoolean(source.showAvatars, true),
    assistantAvatar: toImage(source.assistantAvatar),
    userAvatar: toImage(source.userAvatar),
    themes: {
      light: toThemeAppearance(themes.light),
      dark: toThemeAppearance(themes.dark),
    },
  }
}

const load = (): Appearance => {
  try {
    return parseAppearance(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return defaultAppearance()
  }
}

/** 本机外观设置，存 localStorage；写入失败（如超出配额）返回 false，由调用方提示 */
const save = (appearance: Appearance): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance))
    return true
  } catch {
    return false
  }
}

export const useAppearance = create<Appearance>(() => load())

const commit = (next: Appearance): boolean => {
  useAppearance.setState(next)
  return save(next)
}

export const setShowAvatars = (showAvatars: boolean) =>
  commit({ ...useAppearance.getState(), showAvatars })

export const setAvatar = (role: 'assistant' | 'user', src: string | null) => {
  const state = useAppearance.getState()
  return commit(
    role === 'assistant' ? { ...state, assistantAvatar: src } : { ...state, userAvatar: src }
  )
}

export const patchThemeAppearance = (
  theme: AppearanceTheme,
  patch: Partial<ThemeAppearance>
): boolean => {
  const state = useAppearance.getState()
  return commit({
    ...state,
    themes: { ...state.themes, [theme]: { ...state.themes[theme], ...patch } },
  })
}

export const resetAppearance = () => commit(defaultAppearance())

/** 相对亮度，用于给气泡自动挑选可读的文字色 */
const linear = (value: number) => {
  const channel = value / 255
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string): number => {
  const value = Number.parseInt(hex.slice(1), 16)
  return (
    0.2126 * linear((value >> 16) & 0xff) +
    0.7152 * linear((value >> 8) & 0xff) +
    0.0722 * linear(value & 0xff)
  )
}

/** 亮色气泡配深字，暗色气泡配白字 */
export const readableTextColor = (hex: string): string =>
  luminance(hex) > 0.22 ? '#1b1b1c' : '#ffffff'

const backgroundImage = (value: ThemeAppearance, theme: AppearanceTheme): string | null => {
  if (value.backgroundKind === 'gradient') {
    return `linear-gradient(135deg, ${value.backgroundFrom}, ${value.backgroundTo})`
  }
  if (value.backgroundKind === 'image' && value.backgroundImage) {
    const alpha = (value.backgroundOverlay / 100).toFixed(2)
    const overlay = theme === 'dark' ? `rgba(0, 0, 0, ${alpha})` : `rgba(255, 255, 255, ${alpha})`
    return `linear-gradient(${overlay}, ${overlay}), url("${value.backgroundImage}")`
  }
  return null
}

/**
 * 把外观设置写进 CSS 变量：气泡与背景由样式表直接消费，
 * 深浅色切换时按当前主题重新计算，无需重新渲染组件。
 */
export const applyAppearance = (appearance: Appearance, theme: AppearanceTheme) => {
  const value = appearance.themes[theme]
  const style = document.body.style
  style.setProperty('--app-user-bubble', value.userBubble ?? 'var(--dsw-specific-bubble)')
  style.setProperty(
    '--app-user-bubble-text',
    value.userBubble ? readableTextColor(value.userBubble) : 'var(--dsw-alias-label-primary)'
  )
  style.setProperty('--app-assistant-bubble', value.assistantBubble ?? 'transparent')
  style.setProperty(
    '--app-assistant-bubble-text',
    value.assistantBubble
      ? readableTextColor(value.assistantBubble)
      : 'var(--dsw-alias-label-primary)'
  )
  const image = backgroundImage(value, theme)
  const custom = image !== null || value.backgroundKind === 'color'
  style.setProperty('--app-chat-bg-image', image ?? 'none')
  style.setProperty(
    '--app-chat-bg-color',
    value.backgroundKind === 'color' ? value.backgroundFrom : 'var(--dsw-alias-bg-base)'
  )
  // 自定义背景时，标题栏与输入区改用半透明底色，让背景透出来；
  // 直接用 rgba 而非 color-mix，兼容较旧的浏览器内核
  style.setProperty(
    '--app-surface-bg',
    custom
      ? theme === 'dark'
        ? 'rgba(21, 21, 23, 0.78)'
        : 'rgba(255, 255, 255, 0.78)'
      : 'var(--dsw-alias-bg-base)'
  )
  document.documentElement.style.backgroundColor = getComputedStyle(document.body).backgroundColor
}

/** 读取本地图片并压缩为 data URL：头像 160px，背景 1600px */
export const toImageDataUrl = async (file: File, maxEdge: number): Promise<string> => {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('canvas unavailable')
    }
    const keepAlpha = file.type === 'image/png' && maxEdge <= 200
    if (!keepAlpha) {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(bitmap, 0, 0, width, height)
    return keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86)
  } finally {
    bitmap.close()
  }
}
