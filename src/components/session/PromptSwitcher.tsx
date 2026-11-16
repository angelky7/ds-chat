import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import {
  DEEPSEEK_DEFAULT_PROMPT,
  presetDisplayName,
  setActivePrompt,
  usePrompts,
} from '../../services/prompts.js'
import { useActiveProvider } from '../../services/providers.js'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconPromptOutline16,
  IconSettingsOutline16,
} from '../base/icons.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './PromptSwitcher.module.css'

/** 会话顶栏的提示词切换：列出全部预设，末尾进入管理 */
export const PromptSwitcher = () => {
  const t = useTranslate()
  const presets = usePrompts((state) => state.presets)
  const activeId = usePrompts((state) => state.activeId)
  const active = presets.find((preset) => preset.id === activeId) ?? presets[0]
  const provider = useActiveProvider()
  // 其他服务商下不会发送内置的 DeepSeek 默认提示词，此时不展示胶囊，避免误导
  const system = active.system.trim() || DEEPSEEK_DEFAULT_PROMPT
  const hidden = provider.id !== 'deepseek' && system === DEEPSEEK_DEFAULT_PROMPT
  const options: MenuOption[] = [
    ...presets.map((preset) => ({
      key: preset.id,
      label: presetDisplayName(preset, t),
      icon:
        preset.id === activeId ? <IconCheckOutline16 /> : <span className={styles.blankIcon} />,
      onSelect: () => setActivePrompt(preset.id),
    })),
    {
      key: 'manage',
      label: t('promptManage'),
      icon: <IconSettingsOutline16 />,
      onSelect: () => openSettings('prompts'),
    },
  ]

  if (hidden) {
    return null
  }

  return (
    <Menu options={options}>
      {({ open, toggle }) => (
        <button
          type="button"
          className={clsx(styles.trigger, open && styles.triggerOpen)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('promptSwitchLabel')}
          title={`${t('promptSwitchLabel')}：${presetDisplayName(active, t)}`}
          onClick={toggle}
        >
          <IconPromptOutline16 />
          <span className={styles.name}>{presetDisplayName(active, t)}</span>
          <IconChevronDownOutline14 />
        </button>
      )}
    </Menu>
  )
}
