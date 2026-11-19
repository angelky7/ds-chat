import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconPaletteOutline16,
  IconPromptOutline16,
  IconServerOutline16,
  IconSettingsOutline16,
} from '../base/icons.js'
import {
  appVersion,
  setKeepRefusedAnswer,
  setLocale,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { AppearanceSettings } from './AppearanceSettings.js'
import { CompactionSetting } from './CompactionSetting.js'
import { DataSettings } from './DataSettings.js'
import { FileModeSetting } from './FileModeSetting.js'
import { LocationSetting } from './LocationSetting.js'
import { MobileSettings } from './MobileSettings.js'
import { PromptsSettings } from './PromptsSettings.js'
import { ProviderSettings } from './ProviderSettings.js'
import { SettingCell } from './SettingCell.js'
import { TemperatureSlider } from './TemperatureSlider.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import { ForceRefreshDialog, useVersionTap } from './VersionRefresh.js'
import refreshStyles from './VersionRefresh.module.css'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）、「提示词」、「模型服务」（服务商与 Key）、
 * 「外观」与「数据管理」（导入、导出、删除）。桌面端为居中弹窗、左侧导航；移动端为全屏列表页。
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  const isMobile = useIsMobile()
  if (!open) {
    return null
  }
  return isMobile ? <MobileSettings /> : <SettingsContent />
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  {
    value: 'prompts',
    label: 'settingDialogAsidePromptOptionLabel',
    icon: <IconPromptOutline16 />,
  },
  {
    value: 'provider',
    label: 'settingDialogAsideProviderOptionLabel',
    icon: <IconServerOutline16 />,
  },
  {
    value: 'appearance',
    label: 'settingDialogAsideAppearanceOptionLabel',
    icon: <IconPaletteOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  const [historyBusy, setHistoryBusy] = useState(false)
  const tall = section === 'prompts' || section === 'appearance'
  const taller = section === 'provider'
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={clsx(styles.dialog, tall && styles.dialogTall, taller && styles.dialogTaller)}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyBusy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => {
                // 记到 store 里，窗口变窄切到整页设置时还停在同一分组
                useSettingsDialog.setState({ section: item.value })
                setSection(item.value)
              }}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <KeepRefusedSetting />
              <TemperatureSlider />
              <FileModeSetting />
              <CompactionSetting />
              <LocationSetting />
              <VersionSetting />
            </>
          ) : section === 'prompts' ? (
            <PromptsSettings />
          ) : section === 'provider' ? (
            <ProviderSettings />
          ) : section === 'appearance' ? (
            <AppearanceSettings />
          ) : (
            <DataSettings onBusyChange={setHistoryBusy} />
          )}
        </div>
      </Modal>
    </>
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 被撤回的回答是否保留展示：关闭时按协议丢弃，开启后保留并标注「已撤回」 */
const KeepRefusedSetting = () => {
  const t = useTranslate()
  const keepRefusedAnswer = useSettings((state) => state.keepRefusedAnswer)
  return (
    <SettingCell
      label={t('settingsKeepRefused')}
      description={t('settingsKeepRefusedDescription')}
      status={null}
      action={
        <Switch
          checked={keepRefusedAnswer}
          label={t('settingsKeepRefused')}
          onChange={setKeepRefusedAnswer}
        />
      }
    />
  )
}

/** 版本号：桌面端「通用设置」末尾展示，与移动端「关于」分组一致。连点 5 次可强制刷新。 */
const VersionSetting = () => {
  const t = useTranslate()
  const version = appVersion()
  const { open, onTap, close } = useVersionTap()
  if (!version) {
    return null
  }
  return (
    <>
      <SettingCell
        label={t('settingsVersion')}
        status={null}
        action={
          <button type="button" className={refreshStyles.tap} onClick={onTap}>
            {version}
          </button>
        }
      />
      {open ? <ForceRefreshDialog onClose={close} /> : null}
    </>
  )
}
