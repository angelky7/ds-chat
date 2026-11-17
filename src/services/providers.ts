import { create } from 'zustand'
import { createId } from '../utils/id.js'
import { API_ORIGIN } from './api/origin.js'

/**
 * 协议：Anthropic 兼容（/v1/messages）或 OpenAI 兼容（/chat/completions）。
 * 内部消息与流事件都按 Anthropic 组织，OpenAI 通道只用于没有 Anthropic 入口的服务商。
 */
export type ProviderProtocol = 'anthropic' | 'openai'

/** 内置预设用固定 id，自定义服务商用 `custom-` 前缀的随机 id */
export type ProviderId = string

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
  /** 申请 Key 的地址；自定义服务商没有 */
  keysUrl: string
  /**
   * 实测不允许浏览器跨域直连的协议（预检没有 Access-Control-Allow-Origin）。
   * 这些协议在纯静态部署下会被浏览器拦截，只能走自建反代。
   */
  corsBlocked?: ProviderProtocol[]
  /** 用户自定义，可删除 */
  custom?: boolean
}

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

/** 自定义服务商只保证最通用的能力，不猜对方有没有 Files API 或语音 */
const customCapabilities = (protocol: ProviderProtocol): ProviderCapabilities => ({
  files: false,
  images: true,
  search: false,
  speech: false,
  prefill: false,
  serverTitle: false,
  thinking: protocol === 'anthropic',
})

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
    // /anthropic 的预检响应不带 Access-Control-Allow-Origin，浏览器读不到响应；
    // OpenAI 兼容接口（/v1）预检正常，因此默认走这里。
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-latest',
    models: ['kimi-latest', 'kimi-k2-turbo-preview', 'kimi-k2-thinking'],
    capabilities: { ...chatOnlyCapabilities, thinking: false },
    keysUrl: 'https://platform.moonshot.cn/console/api-keys',
    corsBlocked: ['anthropic'],
  },
  {
    id: 'glm',
    label: 'GLM',
    // 两个接口的预检都没有 Access-Control-Allow-Origin，纯静态页面无法直连，
    // 需要在「接口地址」里填自建反向代理；保留官方地址便于反代转发。
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.6',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
    capabilities: { ...chatOnlyCapabilities, thinking: false },
    keysUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    corsBlocked: ['anthropic', 'openai'],
  },
  {
    id: 'mimo',
    label: 'MiMo',
    // 预检返回 Access-Control-Allow-Origin: *，两种协议都可直连
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
    // /apps/anthropic 对 OPTIONS 预检直接回 401，浏览器必然失败；
    // OpenAI 兼容接口预检正常。
    protocol: 'openai',
    baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen3-max', 'qwen3-coder-plus'],
    capabilities: { ...chatOnlyCapabilities, thinking: false },
    keysUrl: 'https://bailian.console.aliyun.com',
    corsBlocked: ['anthropic'],
  },
  {
    id: 'volcengine',
    label: '火山引擎',
    // 方舟的 OpenAI 兼容入口；/api/v3/models 未开放，Key 校验按「无法校验」放行
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260915',
    models: [
      'doubao-seed-2-1-pro-260915',
      'doubao-seed-2-1-turbo-260915',
      'doubao-seed-1-6-250615',
      'doubao-pro-32k',
    ],
    capabilities: { ...chatOnlyCapabilities, thinking: false },
    keysUrl: 'https://ark.volcengine.com/region:cn-beijing/apikey',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    // 预检返回 Access-Control-Allow-Origin: *，纯静态页面可直连；
    // /v1/models 需要鉴权但确实存在，所以 Key 能在保存时校验
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3.2',
    models: [
      'deepseek-ai/DeepSeek-V3.2',
      'deepseek-ai/DeepSeek-V4-Pro',
      'deepseek-ai/DeepSeek-R1',
      'Pro/moonshotai/Kimi-K2.6',
      'Pro/zai-org/GLM-5.1',
      'Qwen/Qwen3-8B',
    ],
    capabilities: { ...chatOnlyCapabilities, thinking: false },
    keysUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    // 只提供 OpenAI 兼容入口，预检允许跨域
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/auto',
    models: ['openrouter/auto', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
    capabilities: { ...chatOnlyCapabilities, thinking: false },
    keysUrl: 'https://openrouter.ai/keys',
  },
]

/** 用户自己添加的服务商：填名称、地址、协议与模型即可接入任意兼容网关 */
export type CustomProvider = {
  id: ProviderId
  label: string
  protocol: ProviderProtocol
  baseUrl: string
  /** 默认模型，取 models[0] */
  model: string
  models: string[]
}

const toPreset = (item: CustomProvider): ProviderPreset => ({
  id: item.id,
  label: item.label,
  protocol: item.protocol,
  baseUrl: item.baseUrl,
  model: item.model,
  models: item.models,
  capabilities: customCapabilities(item.protocol),
  keysUrl: '',
  custom: true,
})

export type ProviderConfig = {
  apiKey: string
  /** 留空时使用预设地址 */
  baseUrl: string
  /** 该 Key 下要用的模型列表；为空时使用预设列表，一个 Key 可以挂多个模型 */
  models: string[]
  /** 留空时跟随预设协议 */
  protocol: ProviderProtocol | ''
}

/** 当前选中的「服务商 + 模型」；多个服务商可以同时保存 Key，随时切换 */
export type ModelSelection = { providerId: ProviderId; model: string }

type ProvidersState = {
  items: Record<ProviderId, ProviderConfig>
  /** 自定义服务商的定义；内置预设不在这里 */
  custom: CustomProvider[]
  /** null 表示尚未选择，回落到 DeepSeek 的预设模型 */
  selection: ModelSelection | null
}

const KEY = 'chat-demo:providers'

const emptyConfig = (): ProviderConfig => ({ apiKey: '', baseUrl: '', models: [], protocol: '' })

const emptyItems = (): Record<ProviderId, ProviderConfig> =>
  Object.fromEntries(PROVIDERS.map((preset) => [preset.id, emptyConfig()]))

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

const parseModels = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 30)
    : []

/** 自定义服务商的持久化校验：id 不能与内置预设冲突，地址必须是 http(s) */
const parseCustom = (value: unknown): CustomProvider[] => {
  if (!Array.isArray(value)) {
    return []
  }
  const list: CustomProvider[] = []
  const seen = new Set(PROVIDERS.map((preset) => preset.id))
  for (const item of value) {
    const source = (item ?? {}) as Record<string, unknown>
    const id = typeof source.id === 'string' ? source.id : ''
    const label = typeof source.label === 'string' ? source.label.trim() : ''
    const baseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : ''
    if (!id || !label || !/^https?:\/\//i.test(baseUrl) || seen.has(id)) {
      continue
    }
    const models = parseModels(source.models)
    const model = typeof source.model === 'string' && source.model.trim() ? source.model.trim() : models[0]
    if (!model) {
      continue
    }
    seen.add(id)
    list.push({
      id,
      label: label.slice(0, 30),
      protocol: isProtocol(source.protocol) ? source.protocol : 'openai',
      baseUrl: baseUrl.replace(/\/+$/, ''),
      model,
      models: models.length > 0 ? models : [model],
    })
    if (list.length >= 20) {
      break
    }
  }
  return list
}

/** 保存的数据可能来自旧版本或被手动改动，逐项校验后再使用 */
const parseProviders = (value: unknown): ProvidersState => {
  const source = (value ?? {}) as Partial<Record<string, unknown>>
  const stored = (source.items ?? {}) as Record<string, unknown>
  const custom = parseCustom(source.custom)
  const items = emptyItems()
  for (const provider of [...PROVIDERS, ...custom.map(toPreset)]) {
    const config = (stored[provider.id] ?? {}) as Record<string, unknown>
    const text = (key: 'apiKey' | 'baseUrl') =>
      typeof config[key] === 'string' ? (config[key] as string) : ''
    // 旧版只有单个 model 字段，迁移成模型列表
    const legacyModel = typeof config.model === 'string' ? config.model.trim() : ''
    const models = parseModels(config.models)
    items[provider.id] = {
      apiKey: text('apiKey'),
      baseUrl: text('baseUrl'),
      models: models.length > 0 ? models : legacyModel ? [legacyModel] : [],
      protocol: isProtocol(config.protocol) ? config.protocol : '',
    }
  }
  const known = new Set(Object.keys(items))
  const legacySelection = (source.selection ?? {}) as Partial<Record<keyof ModelSelection, unknown>>
  let selection: ModelSelection | null = null
  if (
    typeof legacySelection.providerId === 'string' &&
    known.has(legacySelection.providerId) &&
    typeof legacySelection.model === 'string'
  ) {
    selection = { providerId: legacySelection.providerId, model: legacySelection.model }
  } else if (typeof source.activeId === 'string' && known.has(source.activeId)) {
    // 旧版只有「当前服务商」，模型取该服务商配置里的第一个
    const model = items[source.activeId].models[0] ?? findProvider(source.activeId).model
    selection = { providerId: source.activeId, model }
  }
  return { items, custom, selection }
}

const load = (): ProvidersState => {
  let state: ProvidersState
  try {
    const raw = localStorage.getItem(KEY)
    state = raw
      ? parseProviders(JSON.parse(raw))
      : { items: emptyItems(), custom: [], selection: null }
  } catch {
    state = { items: emptyItems(), custom: [], selection: null }
  }
  if (!state.items.deepseek?.apiKey) {
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

/** 全部可选服务商：内置预设在前，自定义在后 */
export const allProviders = (): ProviderPreset[] => [
  ...PROVIDERS,
  ...useProviders.getState().custom.map(toPreset),
]

export const findProvider = (id: ProviderId): ProviderPreset =>
  allProviders().find((item) => item.id === id) ?? PROVIDERS[0]

export const isCustomProvider = (id: ProviderId): boolean =>
  useProviders.getState().custom.some((item) => item.id === id)

const configOf = (id: ProviderId): ProviderConfig =>
  useProviders.getState().items[id] ?? emptyConfig()

export const updateProviderConfig = (id: ProviderId, patch: Partial<ProviderConfig>): boolean => {
  const state = useProviders.getState()
  const config = { ...configOf(id), ...patch }
  let { selection } = state
  // 正在使用的模型被从列表里删掉时，回落到列表第一个，避免继续请求一个已删除的模型
  if (patch.models && selection?.providerId === id && !patch.models.includes(selection.model)) {
    selection = { providerId: id, model: patch.models[0] ?? findProvider(id).model }
  }
  return commit({
    ...state,
    items: { ...state.items, [id]: config },
    selection,
  })
}

/** 地址、模型与协议回到预设值，已保存的 Key 保留；自定义服务商回到它自己的定义 */
export const resetProviderConfig = (id: ProviderId): boolean => {
  const state = useProviders.getState()
  return commit({
    ...state,
    items: {
      ...state.items,
      [id]: { ...configOf(id), baseUrl: '', models: [], protocol: '' },
    },
  })
}

/** 该服务商是否已挂载（保存了 Key） */
export const isMounted = (id: ProviderId): boolean => configOf(id).apiKey.trim() !== ''

/** 该服务商可选的模型列表：自定义优先，否则用预设 */
export const effectiveModels = (id: ProviderId): string[] => {
  const preset = findProvider(id)
  const custom = configOf(id).models
  const models = custom.length > 0 ? custom : preset.models
  return models.length > 0 ? models : preset.model ? [preset.model] : []
}

export type ActiveProvider = {
  preset: ProviderPreset
  config: ProviderConfig
  id: ProviderId
  apiKey: string
  baseUrl: string
  model: string
  /** 当前可选的模型列表 */
  models: string[]
  protocol: ProviderProtocol
  capabilities: ProviderCapabilities
}

/** 覆盖成另一种协议后，DeepSeek 专属能力一律关闭 */
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

/** 组装某个服务商的生效配置；model 缺省时用列表第一个 */
export const resolveProvider = (id: ProviderId, model?: string): ActiveProvider => {
  const preset = findProvider(id)
  const config = configOf(id)
  const protocol = config.protocol || preset.protocol
  const models = effectiveModels(id)
  return {
    preset,
    config,
    id,
    apiKey: config.apiKey.trim(),
    baseUrl: (config.baseUrl.trim() || preset.baseUrl).replace(/\/+$/, ''),
    model: model?.trim() || models[0] || preset.model,
    models,
    protocol,
    capabilities: capabilitiesFor(preset, protocol),
  }
}

/** 当前选中的服务商与模型 */
export const activeProvider = (): ActiveProvider => {
  const { selection } = useProviders.getState()
  return resolveProvider(selection?.providerId ?? 'deepseek', selection?.model)
}

export const activeApiKey = (): string => activeProvider().apiKey

/** 所有已挂载的服务商，用于模型选择器分组展示 */
export const mountedProviders = (): ActiveProvider[] =>
  allProviders()
    .filter((preset) => isMounted(preset.id))
    .map((preset) => resolveProvider(preset.id))

/** 切换当前模型；可以指向任何已挂载服务商的任意模型 */
export const setSelection = (providerId: ProviderId, model: string): boolean => {
  const state = useProviders.getState()
  return commit({ ...state, selection: { providerId, model } })
}

export type CustomProviderInput = {
  label: string
  baseUrl: string
  protocol: ProviderProtocol
  models: string[]
}

/** 新增自定义服务商，同名不阻止；返回新 id，参数不合法时返回 null */
export const addCustomProvider = (input: CustomProviderInput): ProviderId | null => {
  const label = input.label.trim()
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  const models = input.models.map((item) => item.trim()).filter(Boolean).slice(0, 30)
  if (!label || !/^https?:\/\//i.test(baseUrl) || models.length === 0) {
    return null
  }
  const state = useProviders.getState()
  if (state.custom.length >= 20) {
    return null
  }
  const item: CustomProvider = {
    id: `custom-${createId()}`,
    label: label.slice(0, 30),
    protocol: input.protocol,
    baseUrl,
    model: models[0],
    models,
  }
  const ok = commit({
    ...state,
    custom: [...state.custom, item],
    items: { ...state.items, [item.id]: emptyConfig() },
    selection: { providerId: item.id, model: item.model },
  })
  return ok ? item.id : null
}

export const updateCustomProvider = (
  id: ProviderId,
  patch: Partial<CustomProviderInput>
): boolean => {
  const state = useProviders.getState()
  const target = state.custom.find((item) => item.id === id)
  if (!target) {
    return false
  }
  const label = patch.label?.trim() ?? target.label
  const baseUrl = (patch.baseUrl?.trim() ?? target.baseUrl).replace(/\/+$/, '')
  const models = patch.models ? patch.models.map((item) => item.trim()).filter(Boolean) : target.models
  if (!label || !/^https?:\/\//i.test(baseUrl) || models.length === 0) {
    return false
  }
  const next: CustomProvider = {
    ...target,
    label: label.slice(0, 30),
    baseUrl,
    models: models.slice(0, 30),
    model: models[0],
    protocol: patch.protocol ?? target.protocol,
  }
  return commit({
    ...state,
    custom: state.custom.map((item) => (item.id === id ? next : item)),
  })
}

/** 删除自定义服务商，连同它的 Key 与选中项一起清掉 */
export const removeCustomProvider = (id: ProviderId): boolean => {
  const state = useProviders.getState()
  if (!state.custom.some((item) => item.id === id)) {
    return false
  }
  const items = Object.fromEntries(
    Object.entries(state.items).filter(([providerId]) => providerId !== id)
  )
  return commit({
    ...state,
    custom: state.custom.filter((item) => item.id !== id),
    items,
    selection:
      state.selection?.providerId === id
        ? { providerId: 'deepseek', model: PROVIDERS[0].model }
        : state.selection,
  })
}

/** 当前协议是否被实测判定为浏览器无法直连（需要自建反代或换协议） */
export const isCorsBlocked = (provider: ActiveProvider): boolean =>
  provider.preset.corsBlocked?.includes(provider.protocol) ?? false

/** 组件里订阅：选中项或任意服务商配置变化都会触发重新渲染 */
export const useActiveProvider = (): ActiveProvider => {
  useProviders((state) => state.selection)
  useProviders((state) => state.items)
  useProviders((state) => state.custom)
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
