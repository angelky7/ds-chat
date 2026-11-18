import deepseekLogo from '../assets/deepseek-logo.png'
import deepsleepLogo from '../assets/logo.png'
import { useSettings, type Brand } from '../services/settings.js'

/** 品牌名中英文一致，不参与翻译 */
const BRAND_NAMES: Record<Brand, string> = {
  deepseek: 'DeepSeek',
  deepsleep: 'DeepSleep',
}

const BRAND_LOGOS: Record<Brand, string> = {
  deepseek: deepseekLogo,
  deepsleep: deepsleepLogo,
}

export const brandName = (brand: Brand): string => BRAND_NAMES[brand]

export const brandLogo = (brand: Brand): string => BRAND_LOGOS[brand]

/** 组件里订阅品牌，切换后立即重渲染 */
export const useBrand = (): Brand => useSettings((state) => state.brand)

/**
 * 品牌切换是纯前端设置，标题与标签页图标需要在运行时改写。
 * 首屏由 index.html 的静态 title / favicon 兜底（默认 DeepSeek），这里只负责切换后的同步。
 */
const syncBrand = () => {
  const brand = useSettings.getState().brand
  document.title = BRAND_NAMES[brand]
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (icon) {
    icon.href = BRAND_LOGOS[brand]
  }
}

/** 首次渲染前同步一次，之后随品牌设置变化更新 */
export const setupBrand = () => {
  syncBrand()
  useSettings.subscribe(syncBrand)
}
