import type { ActiveProvider } from '../providers.js'
import { request } from './client.js'

/** DeepSeek 账户余额：官方按币种返回，一般只有一项 */
export type BalanceInfo = {
  /** 官方判定余额是否够调用（false 时请求会失败） */
  available: boolean
  currency: string
  total: string
  granted: string
  toppedUp: string
}

/** 查询余额只需要 Key 与地址；地址取服务商配置，未改过时用预设值 */
export type BalanceTarget = { apiKey: string; baseUrl: string }

type BalanceBody = {
  is_available?: boolean
  balance_infos?: {
    currency?: string
    total_balance?: string
    granted_balance?: string
    topped_up_balance?: string
  }[]
}

/**
 * 余额接口挂在 API 根路径下，而对话走的是 /anthropic 前缀。
 * 用户填了自建反代时按同样的规则剥掉末尾的 /anthropic、/v1。
 */
export const balanceEndpoint = ({ baseUrl }: BalanceTarget): string =>
  `${baseUrl.replace(/\/+$/, '').replace(/\/(?:anthropic|v1)$/i, '')}/user/balance`

/** 服务商能否查余额：只有官方 DeepSeek 有该接口 */
export const supportsBalance = (provider: ActiveProvider): boolean => provider.id === 'deepseek'

/** 余额变化不频繁，同一份 Key 一分钟内复用结果，避免来回切设置页反复请求 */
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; value: BalanceInfo }>()

const parseBalance = (body: BalanceBody): BalanceInfo => {
  const infos = body.balance_infos ?? []
  // 国内账户正常只有 CNY；出现多项时优先展示人民币
  const info = infos.find((item) => item.currency === 'CNY') ?? infos[0]
  return {
    available: body.is_available !== false,
    currency: info?.currency ?? 'CNY',
    total: info?.total_balance ?? '',
    granted: info?.granted_balance ?? '',
    toppedUp: info?.topped_up_balance ?? '',
  }
}

export const fetchBalance = async (
  target: BalanceTarget,
  options: { force?: boolean; signal?: AbortSignal } = {}
): Promise<BalanceInfo> => {
  const url = balanceEndpoint(target)
  const key = `${url}\n${target.apiKey}`
  const cached = cache.get(key)
  if (!options.force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value
  }
  const response = await request(url, {
    method: 'GET',
    // 余额接口只认 Bearer，不接受 x-api-key
    headers: { Authorization: `Bearer ${target.apiKey}` },
    signal: options.signal,
  })
  const value = parseBalance((await response.json()) as BalanceBody)
  cache.set(key, { at: Date.now(), value })
  return value
}

/** 金额展示：人民币用 ¥，美元用 $，其他币种带上代码 */
export const formatBalance = (amount: string, currency: string): string => {
  if (!amount) {
    return ''
  }
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
  return symbol ? `${symbol}${amount}` : `${amount} ${currency}`
}
