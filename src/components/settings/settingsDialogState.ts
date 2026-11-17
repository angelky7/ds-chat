import { create } from 'zustand'
import { activeApiKey } from '../../services/providers.js'
import { closeMobileSider } from '../sider/mobileSiderState.js'

/** 设置弹窗的分组：通用设置 / 提示词 / 模型服务 / 外观 / 数据管理 */
export type SettingsSection = 'general' | 'prompts' | 'provider' | 'appearance' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) => {
  // 移动端设置是整页，先把抽屉收起来，关闭设置后回到对话而不是抽屉
  closeMobileSider()
  useSettingsDialog.setState({ open: true, section })
}

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 当前服务商没有 Key 时打开设置并选中「模型服务」，返回是否已有 Key */
export const ensureApiKey = () => {
  if (activeApiKey()) {
    return true
  }
  openSettings('provider')
  return false
}
