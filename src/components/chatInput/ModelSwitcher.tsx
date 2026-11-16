import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import {
  activeProvider,
  mountedProviders,
  setSelection,
  useProviders,
} from '../../services/providers.js'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconSettingsOutline16,
} from '../base/icons.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './ModelSwitcher.module.css'

/**
 * 输入框右下角的模型选择器：列出所有已挂载服务商的模型，
 * 一个 Key 下的多个模型平铺展示，选中项带勾；末尾进入模型服务管理。
 */
export const ModelSwitcher = () => {
  const t = useTranslate()
  // 订阅整份配置：挂载新 Key、增删模型都要立刻反映到菜单里
  useProviders()
  const provider = activeProvider()
  const mounted = mountedProviders()

  const options: MenuOption[] = [
    ...mounted.flatMap((item) =>
      item.models.map((model) => ({
        key: `${item.id}:${model}`,
        label: `${item.preset.label} · ${model}`,
        icon:
          item.id === provider.id && model === provider.model ? (
            <IconCheckOutline16 />
          ) : (
            <span className={styles.blankIcon} />
          ),
        onSelect: () => setSelection(item.id, model),
      }))
    ),
    {
      key: 'manage',
      label: t('modelManage'),
      icon: <IconSettingsOutline16 />,
      onSelect: () => openSettings('provider'),
    },
  ]

  return (
    <Menu options={options}>
      {({ open, toggle }) => (
        <button
          type="button"
          className={clsx(styles.trigger, open && styles.triggerOpen)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('modelSwitchLabel')}
          title={`${provider.preset.label} · ${provider.model}`}
          onClick={toggle}
        >
          <span className={styles.name}>{provider.model}</span>
          <IconChevronDownOutline14 />
        </button>
      )}
    </Menu>
  )
}
