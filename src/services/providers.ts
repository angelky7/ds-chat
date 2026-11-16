import { create } from 'zustand'
import { API_ORIGIN } from './api/origin.js'

/**
 * 协议：Anthropic 兼容（/v1/messages）或 OpenAI 兼容（/chat/completions）。
 * 内部消息与流事件都按 Anthropic 组织，OpenAI 通道只用于没有 Anthropic 入口的服务商。
 */
export type ProviderProtocol = 'anthropic' | 'openai'

export type ProviderId = 'deepseek' | 'kimi' | 'glm' | 'mimo' | 'qwen' | 'openrouter'

/** 该服务商能做的事；不支持的功能在界面上隐藏，或在发送前拦下 */
export type ProviderCapabilities = {
  /** Files API 上传附件（服务端文档解析、file_id 引用图片） */
  files: boolean
  /** 图片输入 */
  images: boolean
  /** 联网搜索与链接阅读 */
  search: boolean
  /** 语音转写与朗读 */
  speech: boolean
  /** 续写（assistant 预填） */
  prefill: boolean
  /** 服务端生成会话标题 */
  serverTitle: boolean
  /** 深度思考开关 */
  thinking: boolean
}

export type ProviderPreset = {
  id: ProviderId
  /** 品牌名，中英文一致，不做翻译 */
  label: string
  protocol: ProviderProtocol
  /** Anthropic 协议填到 /v1/messages 之前；OpenAI 协议填到 /chat/completions 之前 */
  baseUrl: string
  model: string
  /** 常用模型，仅作输入提示，不限制用户填写 */
  models: string[]
  capabilities: ProviderCapabilities
  /** 申请 Key 的地址 */
  keysUrl: string
}

export type ProviderConfig = {
  apiKey: string
  /** 留空时使用预设地址 */
  baseUrl: string
  /** 留空时使用预设模型 */
  model: string
  /** 留空时跟随预设协议 */
  protocol: ProviderProtocol | ''
}

type ProvidersState = {
  activeId: ProviderId
  items: Record<ProviderId, ProviderConfig>
}

const KEY = 'chat-demo:providers'

const fullCapabilities: ProviderCapabilities = {
  files: true,
  images: true,
  search: true,
  speech: true,
  prefill: true,
  serverTitle: true,
  thinking: true,
}

/** 只有对话通道的第三方服务商：文本、图片与思考，其余能力关闭 */
const chatOnlyCapabilities: ProviderCapabilities = {
  files: false,
  images: true,
  search: false,
  speech: false,
  prefill: false,
  serverTitle: false,
  thinking: true,
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'anthropic',
    // 官方 Anthropic 兼容入口，另带 Files API、联网搜索与语音工具
    baseUrl: `${API_ORIGIN}/anthropic`,
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    capabilities: fullCapabilities,
    keysUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    protocol: 'anthropic',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    model: 'kimi-k2.5',
    models: ['kimi-k2.5', 'kimi-k2-turbo-preview', 'kimi-k2-thinking'],
    capabilities: chatOnlyCapabilities,
    keysUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'glm',
    label: 'GLM',
    protocol: 'anthropic',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-4.6',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
    capabilities: chatOnlyCapabilities,
    keysUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'mimo',
    label: 'MiMo',
    protocol: 'anthropic',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    model: 'mimo-v2.5-pro',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    capabilities: chatOnlyCapabilities,
    keysUrl: 'https://api.xiaomimimo.com',
  },
  {
    id: 'qwen',
    label: '通义千问',
    protocol: 'anthropic',
    baseUrl: 'https://maas.qianwenaiapi.com/apps/anthropic',
    model: 'qwen3-max',
    models: ['qwen3-max', 'qwen-plus', 'qwen3-coder-plus'],
    capabilities: chatOnlyCapabilities,
    keysUrl: 'https://bailian.console.aliyun.com',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    // 只提供 OpenAI 兼容入口
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/auto',
    models: ['openrouter/auto', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
    capabilities: { ...chatOnlyCapabilities, thinking: false },
    keysUrl: 'https://openrouter.ai/keys',
  },
]

export const findProvider = (id: ProviderId): ProviderPreset =>
  PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[0]

const emptyConfig = (): ProviderConfig => ({ apiKey: '', baseUrl: '', model: '', protocol: '' })

const emptyItems = (): Record<ProviderId, ProviderConfig> => ({
  deepseek: emptyConfig(),
  kimi: emptyConfig(),
  glm: emptyConfig(),
  mimo: emptyConfig(),
  qwen: emptyConfig(),
  openrouter: emptyConfig(),
})

const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && PROVIDERS.some((item) => item.id === value)

const isProtocol = (value: unknown): value is ProviderProtocol =>
  value === 'anthropic' || value === 'openai'

/** 旧版本只有一个全局 API Key，首次读取时迁移到 DeepSeek 名下 */
const readLegacyApiKey = (): string => {
  try {
    return localStorage.getItem('chat-demo:api-key') ?? ''
  } catch {
    return ''
  }
}

/** 保存的数据可能来自旧版本或被手动改动，逐项校验后再使用 */
const parseProviders = (value: unknown): ProvidersState => {
  const source = (value ?? {}) as Partial<Record<keyof ProvidersState, unknown>>
  const stored = (source.items ?? {}) as Partial<Record<ProviderId, unknown>>
  const items = emptyItems()
  for (const preset of PROVIDERS) {
    const config = (stored[preset.id] ?? {}) as Partial<Record<keyof ProviderConfig, unknown>>
    const text = (key: 'apiKey' | 'baseUrl' | 'model') =>
      typeof config[key] === 'string' ? (config[key] as string) : ''
    items[preset.id] = {
      apiKey: text('apiKey'),
      baseUrl: text('baseUrl'),
      model: text('model'),
      protocol: isProtocol(config.protocol) ? config.protocol : '',
    }
  }
  return { activeId: isProviderId(source.activeId) ? source.activeId : 'deepseek', items }
}

const load = (): ProvidersState => {
  let state: ProvidersState
  try {
    const raw = localStorage.getItem(KEY)
    state = raw ? parseProviders(JSON.parse(raw)) : { activeId: 'deepseek', items: emptyItems() }
  } catch {
    state = { activeId: 'deepseek', items: emptyItems() }
  }
  if (!state.items.deepseek.apiKey) {
    const legacy = readLegacyApiKey()
    if (legacy) {
      state = {
        ...state,
        items: { ...state.items, deepseek: { ...state.items.deepseek, apiKey: legacy } },
      }
    }
  }
  return state
}

const save = (state: ProvidersState): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export const useProviders = create<ProvidersState>(() => load())

const commit = (next: ProvidersState): boolean => {
  useProviders.setState(next)
  return save(next)
}

export const setActiveProvider = (activeId: ProviderId) => {
  const state = useProviders.getState()
  if (activeId !== state.activeId) {
    commit({ ...state, activeId })
  }
}

export const updateProviderConfig = (id: ProviderId, patch: Partial<ProviderConfig>): boolean => {
  const state = useProviders.getState()
  return commit({
    ...state,
    items: { ...state.items, [id]: { ...state.items[id], ...patch } },
  })
}

/** 地址、模型与协议留空即回到预设值，已保存的 Key 保留 */
export const resetProviderConfig = (id: ProviderId): boolean => {
  const state = useProviders.getState()
  return commit({
    ...state,
    items: { ...state.items, [id]: { ...state.items[id], baseUrl: '', model: '', protocol: '' } },
  })
}

export type ActiveProvider = {
  preset: ProviderPreset
  config: ProviderConfig
  id: ProviderId
  apiKey: string
  baseUrl: string
  model: string
  protocol: ProviderProtocol
  capabilities: ProviderCapabilities
}

/** 覆盖成 OpenAI 协议后，DeepSeek 专属能力一律关闭 */
const capabilitiesFor = (
  preset: ProviderPreset,
  protocol: ProviderProtocol
): ProviderCapabilities =>
  protocol === preset.protocol
    ? preset.capabilities
    : {
        files: false,
        images: preset.capabilities.images,
        search: false,
        speech: false,
        prefill: false,
        serverTitle: false,
        thinking: protocol === 'anthropic',
      }

/** 当前生效的服务商配置，地址、模型与协议缺省时回落到预设值 */
export const activeProvider = (): ActiveProvider => {
  const { activeId, items } = useProviders.getState()
  const preset = findProvider(activeId)
  const config = items[preset.id]
  const protocol = config.protocol || preset.protocol
  return {
    preset,
    config,
    id: preset.id,
    apiKey: config.apiKey.trim(),
    baseUrl: (config.baseUrl.trim() || preset.baseUrl).replace(/\/+$/, ''),
    model: config.model.trim() || preset.model,
    protocol,
    capabilities: capabilitiesFor(preset, protocol),
  }
}

export const activeApiKey = (): string => activeProvider().apiKey

/** 组件里订阅当前服务商配置：服务商、Key、地址、模型、协议任一变化都触发重新渲染 */
export const useActiveProvider = (): ActiveProvider => {
  useProviders((state) => state.activeId)
  useProviders((state) => state.items[state.activeId])
  return activeProvider()
}

/** 对话请求地址：Anthropic 走 /v1/messages，OpenAI 兼容走 /chat/completions */
export const messagesEndpoint = (provider: ActiveProvider): string =>
  provider.protocol === 'anthropic'
    ? `${provider.baseUrl}/v1/messages`
    : `${provider.baseUrl}/chat/completions`

/** 校验 Key 用的只读地址；DeepSeek 的 /models 挂在根路径下 */
export const modelsEndpoint = (provider: ActiveProvider): string =>
  provider.id === 'deepseek'
    ? `${API_ORIGIN}/models`
    : provider.protocol === 'anthropic'
      ? `${provider.baseUrl}/v1/models`
      : `${provider.baseUrl}/models`
