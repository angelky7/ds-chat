import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import {
  IconCheckedOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconDataOutline16,
  IconGlobeLanguageOutline14,
  IconLightOutline16,
  IconMicOutline16,
  IconPaletteOutline16,
  IconPromptOutline16,
  IconServerOutline16,
} from '../base/icons.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useEscapeLayer } from '../base/Modal.js'
import { setLocale, setThemePreference, setTtsVoice, useSettings } from '../../services/settings.js'
import { AppearanceSettings } from './AppearanceSettings.js'
import { DataSettings } from './DataSettings.js'
import { LocationSelects } from './LocationSetting.js'
import { PromptsSettings } from './PromptsSettings.js'
import { ProviderSettings } from './ProviderSettings.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './MobileSettings.module.css'

/** 移动端设置的页面：根列表 + 各个二级页 */
type Page = 'root' | 'language' | 'theme' | 'appearance' | 'prompts' | 'provider' | 'voice' | 'data'

const TITLES: Record<Page, TranslationKey> = {
  root: 'settings',
  language: 'settingsLanguageRegion',
  theme: 'avatarMenuSettingsDialogThemeItemLabel',
  appearance: 'settingDialogAsideAppearanceOptionLabel',
  prompts: 'settingDialogAsidePromptOptionLabel',
  provider: 'settingDialogAsideProviderOptionLabel',
  voice: 'settingsTtsVoice',
  data: 'settingDialogAsideDataOptionLabel',
}

/** 从侧边栏或「没有 Key」的提示进来时，直接落到对应二级页 */
const initialPage = (section: SettingsSection): Page => {
  switch (section) {
    case 'prompts':
    case 'provider':
    case 'appearance':
    case 'data':
      return section
    default:
      return 'root'
  }
}

/** 版本号由构建注入到 meta，读不到就不显示这一行 */
const appVersion = () =>
  document.querySelector('meta[name="application-version"]')?.getAttribute('content') ?? ''

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className={styles.group}>
    <h2 className={styles.groupTitle}>{title}</h2>
    <div className={styles.card}>{children}</div>
  </section>
)

/** 可点的设置行：左侧图标 + 标题，右侧数值与箭头；没有 onClick 时只展示 */
const Row = ({
  icon,
  label,
  value,
  indent,
  onClick,
}: {
  icon?: ReactNode
  label: string
  value?: string
  /** 没有图标时把文字缩进到与有图标的行对齐 */
  indent?: boolean
  onClick?: () => void
}) => {
  const content = (
    <>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.rowLabel}>{label}</span>
      {value ? <span className={styles.rowValue}>{value}</span> : null}
      {onClick ? (
        <span className={styles.chevron}>
          <IconChevronRightOutline14 />
        </span>
      ) : null}
    </>
  )
  return onClick ? (
    <button
      type="button"
      className={clsx(styles.row, !icon && styles.rowNoIcon, indent && styles.rowIndent)}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className={clsx(styles.row, !icon && styles.rowNoIcon, indent && styles.rowIndent)}>
      {content}
    </div>
  )
}

/** 单选项列表页：语言、主题、音色 */
const OptionPage = <T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { value: T; label: string }[]
  value: T
  onSelect: (value: T) => void
}) => (
  <div className={styles.card}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        className={clsx(styles.row, styles.optionRow)}
        onClick={() => onSelect(option.value)}
      >
        <span className={styles.rowLabel}>{option.label}</span>
        {value === option.value ? (
          <span className={styles.check}>
            <IconCheckedOutline14 />
          </span>
        ) : null}
      </button>
    ))}
  </div>
)

/** 移动端设置：全屏分组列表，二级页沿用已有的设置组件 */
export const MobileSettings = () => {
  const t = useTranslate()
  const [page, setPage] = useState<Page>(() => initialPage(useSettingsDialog.getState().section))
  const locale = useSettings((state) => state.locale)
  const themePreference = useSettings((state) => state.themePreference)
  const ttsVoice = useSettings((state) => state.ttsVoice)
  const version = appVersion()

  const themeLabel =
    themePreference === 'light'
      ? t('avatarMenuSettingsDialogThemeSelectLightOption')
      : themePreference === 'dark'
        ? t('avatarMenuSettingsDialogThemeSelectDarkOption')
        : t('avatarMenuSettingsDialogThemeSelectSystemOption')

  const close = () => closeSettings()
  // Esc 先退回列表，再关掉整页；和弹窗一样只由最上层响应
  useEscapeLayer(() => (page === 'root' ? close() : setPage('root')))

  const body =
    page === 'root' ? (
      <>
        <Group title={t('settingsGroupApp')}>
          <Row
            icon={<IconGlobeLanguageOutline14 />}
            label={t('settingsLanguageRegion')}
            value={t(locale === 'zh-CN' ? 'settingsLocaleZhCN' : 'settingsLocaleEnUS')}
            onClick={() => setPage('language')}
          />
          <Row
            icon={<IconLightOutline16 />}
            label={t('avatarMenuSettingsDialogThemeItemLabel')}
            value={themeLabel}
            onClick={() => setPage('theme')}
          />
          <Row
            icon={<IconPaletteOutline16 />}
            label={t('settingDialogAsideAppearanceOptionLabel')}
            onClick={() => setPage('appearance')}
          />
        </Group>
        <Group title={t('settingsGroupChat')}>
          <Row
            icon={<IconPromptOutline16 />}
            label={t('settingDialogAsidePromptOptionLabel')}
            onClick={() => setPage('prompts')}
          />
          <Row
            icon={<IconServerOutline16 />}
            label={t('settingDialogAsideProviderOptionLabel')}
            onClick={() => setPage('provider')}
          />
        </Group>
        <Group title={t('settingsGroupVoice')}>
          <Row
            icon={<IconMicOutline16 />}
            label={t('settingsTtsVoice')}
            value={t(ttsVoice === 'tide' ? 'settingsTtsVoiceTide' : 'settingsTtsVoiceStella')}
            onClick={() => setPage('voice')}
          />
        </Group>
        <Group title={t('settingsGroupData')}>
          <Row
            icon={<IconDataOutline16 />}
            label={t('settingDialogAsideDataOptionLabel')}
            onClick={() => setPage('data')}
          />
        </Group>
        {version ? (
          <Group title={t('settingsGroupAbout')}>
            <Row label={t('settingsVersion')} value={version} indent />
          </Group>
        ) : null}
      </>
    ) : page === 'language' ? (
      <>
        <Group title={t('settingsLocalePreference')}>
          <OptionPage
            value={locale}
            onSelect={setLocale}
            options={[
              { value: 'zh-CN', label: t('settingsLocaleZhCN') },
              { value: 'en-US', label: t('settingsLocaleEnUS') },
            ]}
          />
        </Group>
        <Group title={t('settingsLocation')}>
          <div className={styles.selects}>
            <LocationSelects className={styles.locationSelects} />
          </div>
        </Group>
      </>
    ) : page === 'theme' ? (
      <OptionPage
        value={themePreference}
        onSelect={setThemePreference}
        options={[
          { value: 'light', label: t('avatarMenuSettingsDialogThemeSelectLightOption') },
          { value: 'dark', label: t('avatarMenuSettingsDialogThemeSelectDarkOption') },
          { value: 'system', label: t('avatarMenuSettingsDialogThemeSelectSystemOption') },
        ]}
      />
    ) : page === 'voice' ? (
      <OptionPage
        value={ttsVoice}
        onSelect={setTtsVoice}
        options={[
          { value: 'stella', label: t('settingsTtsVoiceStella') },
          { value: 'tide', label: t('settingsTtsVoiceTide') },
        ]}
      />
    ) : page === 'appearance' ? (
      <div className={styles.padded}>
        <AppearanceSettings />
      </div>
    ) : page === 'prompts' ? (
      <div className={styles.padded}>
        <PromptsSettings />
      </div>
    ) : page === 'provider' ? (
      <div className={styles.padded}>
        <ProviderSettings />
      </div>
    ) : (
      <div className={styles.padded}>
        <DataSettings />
      </div>
    )

  return (
    <div className={styles.page} role="dialog" aria-modal="true" aria-label={t(TITLES[page])}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.headerButton}
          aria-label={page === 'root' ? t('close') : t('settingsBack')}
          onClick={() => {
            if (page === 'root') {
              close()
            } else {
              setPage('root')
            }
          }}
        >
          {page === 'root' ? (
            <IconCloseOutline16 />
          ) : (
            <span className={styles.backIcon}>
              <IconChevronRightOutline14 />
            </span>
          )}
        </button>
        <div className={styles.title}>{t(TITLES[page])}</div>
        <span className={styles.headerSpacer} aria-hidden="true" />
      </header>
      <div className={styles.body}>{body}</div>
    </div>
  )
}
