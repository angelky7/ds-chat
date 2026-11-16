import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useTheme } from '../../app/theme.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  patchThemeAppearance,
  resetAppearance,
  setAvatar,
  setShowAvatars,
  toImageDataUrl,
  useAppearance,
  type BackgroundKind,
  type ThemeAppearance,
} from '../../services/appearance.js'
import { Avatar } from '../messages/Avatar.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { IconUploadOutline14 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { SettingCell } from './SettingCell.js'
import settingsStyles from './Settings.module.css'
import styles from './Appearance.module.css'

const BUBBLE_PRESETS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#64748b']

const AVATAR_MAX_EDGE = 160
const BACKGROUND_MAX_EDGE = 1600

const notifySaveFailed = () => showToast({ key: 'appearanceStorageFull', type: 'error' })

/** 外观设置：头像、气泡颜色与背景，颜色按深色 / 浅色分别保存 */
export const AppearanceSettings = () => {
  const t = useTranslate()
  const theme = useTheme()
  const appearance = useAppearance()
  const value = appearance.themes[theme]
  const [resetOpened, setResetOpened] = useState(false)

  const patch = (next: Partial<ThemeAppearance>) => {
    if (!patchThemeAppearance(theme, next)) {
      notifySaveFailed()
    }
  }

  return (
    <>
      <div className={styles.hint}>
        {t('appearanceThemeHint', {
          theme: t(theme === 'dark' ? 'appearanceThemeDark' : 'appearanceThemeLight'),
        })}
      </div>
      <SettingCell
        label={t('appearanceShowAvatars')}
        description={t('appearanceShowAvatarsDescription')}
        status={null}
        action={
          <Switch
            checked={appearance.showAvatars}
            label={t('appearanceShowAvatars')}
            onChange={setShowAvatars}
          />
        }
      />
      <AvatarSetting
        role="assistant"
        label={t('appearanceAssistantAvatar')}
        description={t('appearanceAvatarDescription')}
      />
      <AvatarSetting role="user" label={t('appearanceUserAvatar')} />
      <BubbleColorSetting
        label={t('appearanceAssistantBubble')}
        description={t('appearanceAssistantBubbleDescription')}
        value={value.assistantBubble}
        onChange={(assistantBubble) => patch({ assistantBubble })}
      />
      <BubbleColorSetting
        label={t('appearanceUserBubble')}
        description={t('appearanceUserBubbleDescription')}
        value={value.userBubble}
        onChange={(userBubble) => patch({ userBubble })}
      />
      <BackgroundSetting value={value} onPatch={patch} />
      <div className={styles.footer}>
        <button type="button" className={styles.linkButton} onClick={() => setResetOpened(true)}>
          {t('appearanceResetAll')}
        </button>
      </div>
      {resetOpened ? (
        <Modal
          title={t('appearanceResetAllConfirmTitle')}
          className={styles.resetConfirm}
          onClose={() => setResetOpened(false)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setResetOpened(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="dangerOutlined"
                size="m"
                onClick={() => {
                  resetAppearance()
                  setResetOpened(false)
                }}
              >
                {t('appearanceReset')}
              </Button>
            </>
          }
        >
          <div>{t('appearanceResetAllConfirmDescription')}</div>
        </Modal>
      ) : null}
    </>
  )
}

const Switch = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={clsx(styles.switch, checked && styles.switchOn)}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.knob} />
  </button>
)

/** 读取图片、压缩为 data URL 后交给调用方保存；失败时提示换一张 */
const useImagePicker = (maxEdge: number, onPicked: (src: string) => void) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File | undefined) => {
    if (!file) {
      return
    }
    setBusy(true)
    try {
      onPicked(await toImageDataUrl(file, maxEdge))
    } catch {
      showToast({ key: 'appearanceImageFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        void onFile(file)
      }}
    />
  )

  return { busy, open: () => inputRef.current?.click(), input }
}

const AvatarSetting = ({
  role,
  label,
  description,
}: {
  role: 'assistant' | 'user'
  label: string
  description?: string
}) => {
  const t = useTranslate()
  const src = useAppearance((state) =>
    role === 'assistant' ? state.assistantAvatar : state.userAvatar
  )
  const picker = useImagePicker(AVATAR_MAX_EDGE, (next) => {
    if (!setAvatar(role, next)) {
      notifySaveFailed()
    }
  })

  return (
    <SettingCell
      label={label}
      description={description}
      status={null}
      action={
        <div className={styles.avatarActions}>
          <Avatar role={role} src={src} />
          <Button
            variant="outlined"
            size="m"
            className={settingsStyles.cellButton}
            disabled={picker.busy}
            onClick={picker.open}
          >
            {t('appearanceUploadAvatar')}
          </Button>
          {src ? (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setAvatar(role, null)}
            >
              {t('appearanceResetAvatar')}
            </button>
          ) : null}
          {picker.input}
        </div>
      }
    />
  )
}

const BubbleColorSetting = ({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: string | null
  onChange: (value: string | null) => void
}) => {
  const t = useTranslate()
  return (
    <SettingCell
      label={label}
      description={description}
      status={null}
      action={
        <div className={styles.colorRow}>
          <ColorSwatch
            value={value ?? BUBBLE_PRESETS[0]}
            empty={value === null}
            label={t('appearanceBubbleCustom')}
            onChange={onChange}
          />
          <div role="group" aria-label={t('appearanceBubblePreset')} className={styles.presets}>
            {BUBBLE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={preset}
                aria-pressed={preset === value}
                className={clsx(styles.preset, preset === value && styles.presetActive)}
                style={{ backgroundColor: preset }}
                onClick={() => onChange(preset)}
              />
            ))}
          </div>
          {value === null ? null : (
            <button type="button" className={styles.linkButton} onClick={() => onChange(null)}>
              {t('appearanceBubbleUseDefault')}
            </button>
          )}
        </div>
      }
    />
  )
}

/** 原生取色器做成色块；empty 时用斜线表示「沿用默认」 */
const ColorSwatch = ({
  value,
  empty = false,
  label,
  onChange,
}: {
  value: string
  empty?: boolean
  label: string
  onChange: (value: string) => void
}) => (
  <label className={clsx(styles.swatch, empty && styles.swatchEmpty)} title={label}>
    <span className={styles.swatchFill} style={{ backgroundColor: value }} />
    <input
      type="color"
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
)

const backgroundKinds: { value: BackgroundKind; label: TranslationKey }[] = [
  { value: 'none', label: 'appearanceBackgroundNone' },
  { value: 'color', label: 'appearanceBackgroundColor' },
  { value: 'gradient', label: 'appearanceBackgroundGradient' },
  { value: 'image', label: 'appearanceBackgroundImage' },
]

const BackgroundSetting = ({
  value,
  onPatch,
}: {
  value: ThemeAppearance
  onPatch: (next: Partial<ThemeAppearance>) => void
}) => {
  const t = useTranslate()
  const picker = useImagePicker(BACKGROUND_MAX_EDGE, (backgroundImage) =>
    onPatch({ backgroundImage, backgroundKind: 'image' })
  )

  return (
    <div className={clsx(settingsStyles.cell, styles.backgroundCell)}>
      <div className={styles.backgroundHeader}>
        <div className={settingsStyles.text}>
          <div className={settingsStyles.label}>{t('appearanceBackground')}</div>
          <div className={settingsStyles.description}>{t('appearanceBackgroundDescription')}</div>
        </div>
        <Select
          value={value.backgroundKind}
          ariaLabel={t('appearanceBackgroundKind')}
          options={backgroundKinds.map((item) => ({ value: item.value, label: t(item.label) }))}
          onChange={(backgroundKind) => onPatch({ backgroundKind })}
        />
      </div>
      {value.backgroundKind === 'color' ? (
        <div className={styles.backgroundRow}>
          <span className={styles.controlLabel}>{t('appearanceBackgroundFrom')}</span>
          <ColorSwatch
            value={value.backgroundFrom}
            label={t('appearanceBackgroundFrom')}
            onChange={(backgroundFrom) => onPatch({ backgroundFrom })}
          />
        </div>
      ) : null}
      {value.backgroundKind === 'gradient' ? (
        <div className={styles.backgroundRow}>
          <span className={styles.controlLabel}>{t('appearanceBackgroundFrom')}</span>
          <ColorSwatch
            value={value.backgroundFrom}
            label={t('appearanceBackgroundFrom')}
            onChange={(backgroundFrom) => onPatch({ backgroundFrom })}
          />
          <span className={styles.controlLabel}>{t('appearanceBackgroundTo')}</span>
          <ColorSwatch
            value={value.backgroundTo}
            label={t('appearanceBackgroundTo')}
            onChange={(backgroundTo) => onPatch({ backgroundTo })}
          />
        </div>
      ) : null}
      {value.backgroundKind === 'image' ? (
        <>
          <div className={styles.backgroundRow}>
            {value.backgroundImage ? (
              <img className={styles.backgroundThumb} src={value.backgroundImage} alt="" />
            ) : null}
            <Button
              variant="outlined"
              size="m"
              className={settingsStyles.cellButton}
              disabled={picker.busy}
              onClick={picker.open}
            >
              <IconUploadOutline14 />
              {t(
                value.backgroundImage ? 'appearanceBackgroundReplace' : 'appearanceBackgroundUpload'
              )}
            </Button>
            {value.backgroundImage ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => onPatch({ backgroundImage: null })}
              >
                {t('appearanceBackgroundRemove')}
              </button>
            ) : null}
            {picker.input}
          </div>
          <div className={styles.backgroundRow}>
            <span className={styles.controlLabel}>{t('appearanceBackgroundOverlay')}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={value.backgroundOverlay}
              aria-label={t('appearanceBackgroundOverlay')}
              className={styles.range}
              onChange={(event) => onPatch({ backgroundOverlay: Number(event.target.value) })}
            />
            <span className={styles.rangeValue}>{value.backgroundOverlay}%</span>
          </div>
        </>
      ) : null}
    </div>
  )
}
