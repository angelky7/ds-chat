import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  activeFileMode,
  applyFileMode,
  fileModeChanged,
  MAX_COMPACT_THRESHOLD,
  MIN_COMPACT_THRESHOLD,
  setAutoCompact,
  setCompactThreshold,
  setParseDepth,
  useSettings,
  type ParseDepth,
} from '../../services/settings.js'
import { MduiSlider } from '../base/MduiSlider.js'
import { Switch } from '../base/Switch.js'
import { ContextLimitSlider } from './ContextLimitSlider.js'
import { FileResendSetting } from './FileResendSetting.js'
import { SettingCell } from './SettingCell.js'
import sliderStyles from './SliderField.module.css'
import styles from './FileModeSetting.module.css'

/** 二选一的分段控件：选项少且互斥，用按钮比下拉更快 */
const Segmented = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) => (
  <div className={styles.segmented} role="radiogroup" aria-label={label}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        className={clsx(styles.segment, value === option.value && styles.segmentActive)}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
)

/** 自动压缩阈值：窗口占用达到该百分比时触发，整数存储 */
const ThresholdSlider = ({ value }: { value: number }) => {
  const t = useTranslate()
  return (
    <div className={sliderStyles.wrap}>
      <div className={sliderStyles.head}>
        <span className={sliderStyles.label}>{t('settingsCompactThreshold')}</span>
        <span className={sliderStyles.value}>{value}%</span>
      </div>
      <MduiSlider
        value={value}
        min={MIN_COMPACT_THRESHOLD}
        max={MAX_COMPACT_THRESHOLD}
        step={5}
        label={t('settingsCompactThreshold')}
        formatValue={(next) => `${Math.round(next)}%`}
        onChange={setCompactThreshold}
      />
      <div className={sliderStyles.foot}>
        <span className={sliderStyles.hint}>{t('settingsCompactThresholdDescription')}</span>
      </div>
    </div>
  )
}

/**
 * 处理模式：快速 / 专家两个预设，一次写好解析深度、附件重发、自动压缩与阈值、轮次上限。
 * 模式本身不存储，由细项反推；改动任一细项后自动显示「自定义」，避免两个数据源打架。
 */
export const FileModeSetting = () => {
  const t = useTranslate()
  const mode = useSettings(activeFileMode)
  const changed = useSettings(fileModeChanged)
  const parseDepth = useSettings((state) => state.parseDepth)
  const autoCompact = useSettings((state) => state.autoCompact)
  const threshold = useSettings((state) => state.compactThreshold)
  const [open, setOpen] = useState(false)

  const description =
    mode === 'custom'
      ? t('settingsFileModeCustomHint', { count: changed })
      : t(mode === 'expert' ? 'settingsFileModeExpertHint' : 'settingsFileModeFastHint')

  return (
    <>
      <div className={styles.mode}>
        <div className={styles.modeHead}>
          <span className={styles.modeLabel}>{t('settingsFileMode')}</span>
        </div>
        <Segmented
          label={t('settingsFileMode')}
          // 自定义时两个选项都不高亮：避免显示成「快速」却按专家参数在跑
          value={mode}
          options={[
            { value: 'fast', label: t('settingsFileModeFast') },
            { value: 'expert', label: t('settingsFileModeExpert') },
          ]}
          onChange={(next) => applyFileMode(next === 'expert' ? 'expert' : 'fast')}
        />
        <div className={styles.modeHint}>{description}</div>
      </div>

      <button
        type="button"
        className={clsx(styles.advanced, open && styles.advancedOpen)}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.advancedLabel}>{t('settingsAdvanced')}</span>
        {mode === 'custom' ? (
          <span className={styles.advancedMeta}>
            {t('settingsAdvancedCustom', { count: changed })}
          </span>
        ) : null}
        <span className={styles.chevron} aria-hidden="true" />
      </button>

      {open ? (
        <div className={styles.panel}>
          <SettingCell
            label={t('settingsParseDepth')}
            description={t('settingsParseDepthDescription')}
            status={null}
            action={
              <Segmented
                label={t('settingsParseDepth')}
                value={parseDepth}
                options={[
                  { value: 'text', label: t('settingsParseDepthText') },
                  { value: 'layout', label: t('settingsParseDepthLayout') },
                ]}
                onChange={(next) => setParseDepth(next as ParseDepth)}
              />
            }
          />
          <FileResendSetting />
          <SettingCell
            label={t('settingsAutoCompact')}
            description={t('settingsAutoCompactDescription')}
            status={null}
            action={
              <Switch
                checked={autoCompact}
                label={t('settingsAutoCompact')}
                onChange={setAutoCompact}
              />
            }
          />
          {autoCompact ? <ThresholdSlider value={threshold} /> : null}
          <ContextLimitSlider />
        </div>
      ) : null}
    </>
  )
}
