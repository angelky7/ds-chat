import clsx from 'clsx'
import { useEffect, useRef, useState, type AnimationEvent, type ReactNode } from 'react'
import {
  IconCheckedOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconDataOutline16,
  IconGlobeLanguageOutline14,
  IconInfoOutline16,
  IconLightOutline16,
  IconMicOutline16,
  IconPaletteOutline16,
  IconPromptOutline16,
  IconServerOutline16,
  IconSettingsOutline16,
  IconThinkOutline16,
} from '../base/icons.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useEscapeLayer } from '../base/Modal.js'
import { Switch } from '../base/Switch.js'
import {
  appVersion,
  setKeepRefusedAnswer,
  setLocale,
  setThemePreference,
  setTtsVoice,
  useSettings,
} from '../../services/settings.js'
import { AppearanceSettings } from './AppearanceSettings.js'
import { CompactionSetting } from './CompactionSetting.js'
import { ContextLimitSlider } from './ContextLimitSlider.js'
import { DataSettings } from './DataSettings.js'
import { FileResendSetting } from './FileResendSetting.js'
import { LocationSelects } from './LocationSetting.js'
import { PromptsSettings } from './PromptsSettings.js'
import { ProviderSettings } from './ProviderSettings.js'
import { TemperatureSlider } from './TemperatureSlider.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './MobileSettings.module.css'

/** 移动端设置的页面：根列表 + 各个二级页 */
type Page =
  | 'root'
  | 'language'
  | 'theme'
  | 'appearance'
  | 'prompts'
  | 'provider'
  | 'temperature'
  | 'context'
  | 'voice'
  | 'data'

const TITLES: Record<Page, TranslationKey> = {
  root: 'settings',
  language: 'settingsLanguageRegion',
  theme: 'avatarMenuSettingsDialogThemeItemLabel',
  appearance: 'settingDialogAsideAppearanceOptionLabel',
  prompts: 'settingDialogAsidePromptOptionLabel',
  provider: 'settingDialogAsideProviderOptionLabel',
  temperature: 'settingsTemperature',
  context: 'settingsContextGroup',
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
  trailing,
  onClick,
}: {
  icon: ReactNode
  label: string
  value?: string
  /** 右侧放开关之类的控件，此时不显示箭头 */
  trailing?: ReactNode
  onClick?: () => void
}) => {
  const content = (
    <>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.rowLabel}>{label}</span>
      {value ? <span className={styles.rowValue}>{value}</span> : null}
      {trailing ??
        (onClick ? (
          <span className={styles.chevron}>
            <IconChevronRightOutline14 />
          </span>
        ) : null)}
    </>
  )
  return onClick ? (
    <button type="button" className={styles.row} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={styles.row}>{content}</div>
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

/** 二级页对应的桌面分组：窗口变宽后弹窗能停在同一处 */
const SECTION_OF: Partial<Record<Page, SettingsSection>> = {
  appearance: 'appearance',
  prompts: 'prompts',
  provider: 'provider',
  data: 'data',
}

/** 移动端设置：全屏分组列表，二级页沿用已有的设置组件 */
export const MobileSettings = () => {
  const t = useTranslate()
  const [page, setPage] = useState<Page>(() => initialPage(useSettingsDialog.getState().section))
  const [closing, setClosing] = useState(false)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const locale = useSettings((state) => state.locale)
  const themePreference = useSettings((state) => state.themePreference)
  const ttsVoice = useSettings((state) => state.ttsVoice)
  const keepRefusedAnswer = useSettings((state) => state.keepRefusedAnswer)
  const temperature = useSettings((state) => state.temperature)
  const version = appVersion()

  const themeLabel =
    themePreference === 'light'
      ? t('avatarMenuSettingsDialogThemeSelectLightOption')
      : themePreference === 'dark'
        ? t('avatarMenuSettingsDialogThemeSelectDarkOption')
        : t('avatarMenuSettingsDialogThemeSelectSystemOption')

  /** 切页时同步给弹窗状态，窗口变宽后仍停在同一分组 */
  const go = (next: Page) => {
    setDirection(next === 'root' ? 'back' : 'forward')
    useSettingsDialog.setState({ section: SECTION_OF[next] ?? 'general' })
    setPage(next)
  }
  // 关闭先播放淡出，动画结束再真正卸载；Esc 与顶部按钮走同一条路径。
  // 不能只靠 animationend：部分平板开启「减弱动态效果」后动画被禁用（animation:none），
  // 事件永不触发会导致点了关闭却卡在页面里。加一个超时兜底，保证任何情况下都能关掉。
  const closeTimer = useRef<number | undefined>(undefined)
  const finishClose = () => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = undefined
    }
    closeSettings()
  }
  const close = () => {
    if (closing) {
      return
    }
    // 系统开启「减弱动态效果」时没有淡出动画，直接关闭，避免等待兜底计时器造成卡顿感。
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      closeSettings()
      return
    }
    setClosing(true)
    closeTimer.current = window.setTimeout(finishClose, 240)
  }
  useEffect(
    () => () => {
      if (closeTimer.current !== undefined) {
        window.clearTimeout(closeTimer.current)
      }
    },
    []
  )
  const onPageAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (closing && event.target === event.currentTarget) {
      finishClose()
    }
  }
  useEscapeLayer(() => (page === 'root' ? close() : go('root')))

  const body =
    page === 'root' ? (
      <>
        <Group title={t('settingsGroupApp')}>
          <Row
            icon={<IconGlobeLanguageOutline14 />}
            label={t('settingsLanguageRegion')}
            value={t(locale === 'zh-CN' ? 'settingsLocaleZhCN' : 'settingsLocaleEnUS')}
            onClick={() => go('language')}
          />
          <Row
            icon={<IconLightOutline16 />}
            label={t('avatarMenuSettingsDialogThemeItemLabel')}
            value={themeLabel}
            onClick={() => go('theme')}
          />
          <Row
            icon={<IconPaletteOutline16 />}
            label={t('settingDialogAsideAppearanceOptionLabel')}
            onClick={() => go('appearance')}
          />
        </Group>
        <Group title={t('settingsGroupChat')}>
          <Row
            icon={<IconPromptOutline16 />}
            label={t('settingDialogAsidePromptOptionLabel')}
            onClick={() => go('prompts')}
          />
          <Row
            icon={<IconServerOutline16 />}
            label={t('settingDialogAsideProviderOptionLabel')}
            onClick={() => go('provider')}
          />
          <Row
            icon={<IconSettingsOutline16 />}
            label={t('settingsTemperature')}
            value={temperature.toFixed(1)}
            onClick={() => go('temperature')}
          />
          <Row
            icon={<IconDataOutline16 />}
            label={t('settingsContextGroup')}
            onClick={() => go('context')}
          />
          <Row
            icon={<IconThinkOutline16 />}
            label={t('settingsKeepRefused')}
            trailing={
              <Switch
                checked={keepRefusedAnswer}
                label={t('settingsKeepRefused')}
                onChange={setKeepRefusedAnswer}
              />
            }
          />
        </Group>
        <div className={styles.groupHint}>{t('settingsKeepRefusedDescription')}</div>
        <Group title={t('settingsGroupVoice')}>
          <Row
            icon={<IconMicOutline16 />}
            label={t('settingsTtsVoice')}
            value={t(ttsVoice === 'tide' ? 'settingsTtsVoiceTide' : 'settingsTtsVoiceStella')}
            onClick={() => go('voice')}
          />
        </Group>
        <Group title={t('settingsGroupData')}>
          <Row
            icon={<IconDataOutline16 />}
            label={t('settingDialogAsideDataOptionLabel')}
            onClick={() => go('data')}
          />
        </Group>
        {version ? (
          <Group title={t('settingsGroupAbout')}>
            <Row
              icon={<IconInfoOutline16 />}
              label={t('settingsVersion')}
              value={version}
            />
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
    ) : page === 'temperature' ? (
      // 顶部标题已是「模型温度」，卡片里不再重复分组标题
      <div className={styles.padded}>
        <TemperatureSlider />
      </div>
    ) : page === 'context' ? (
      <>
        <div className={styles.padded}>
          <ContextLimitSlider />
        </div>
        <div className={styles.padded}>
          <FileResendSetting />
        </div>
        <div className={styles.padded}>
          <CompactionSetting />
        </div>
      </>
    ) : (
      <div className={styles.padded}>
        <DataSettings />
      </div>
    )

  return (
    <div
      className={clsx(styles.page, closing && styles.closing)}
      role="dialog"
      aria-modal="true"
      aria-label={t(TITLES[page])}
      onAnimationEnd={onPageAnimationEnd}
    >
      <header className={styles.header}>
        <button
          type="button"
          className={styles.headerButton}
          aria-label={page === 'root' ? t('close') : t('settingsBack')}
          onClick={() => {
            if (page === 'root') {
              close()
            } else {
              go('root')
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
      <div
        key={page}
        className={clsx(styles.body, direction === 'back' ? styles.bodyBack : styles.bodyForward)}
      >
        {body}
      </div>
    </div>
  )
}
