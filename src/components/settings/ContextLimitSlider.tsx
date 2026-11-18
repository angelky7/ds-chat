import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import {
  CONTEXT_LIMIT_UNLIMITED,
  MAX_CONTEXT_LIMIT,
  MIN_CONTEXT_LIMIT,
  resetContextLimit,
  setContextLimit,
  useSettings,
} from '../../services/settings.js'
import { MduiSlider } from '../base/MduiSlider.js'
import styles from './SliderField.module.css'

/** 滑块最右一档表示「不限制」，比最大轮次多一格 */
const UNLIMITED_STOP = MAX_CONTEXT_LIMIT + 1

/** 气泡文本：最右一档显示 ∞，其余是整数轮次 */
const formatContextLimit = (value: number) =>
  value >= UNLIMITED_STOP ? '∞' : String(Math.round(value))

/**
 * 上下文轮次上限：按「提问 + 回答」成对的轮次截断，默认不限制。
 * 滑到最右显示 ∞，对应存储值 0；其余按 1~50 轮保存。
 */
export const ContextLimitSlider = ({ className }: { className?: string }) => {
  const t = useTranslate()
  const contextLimit = useSettings((state) => state.contextLimit)
  const unlimited = contextLimit === CONTEXT_LIMIT_UNLIMITED
  return (
    <div className={clsx(styles.wrap, className)}>
      <div className={styles.head}>
        <span className={styles.label}>{t('settingsContextLimit')}</span>
        <span className={styles.value}>
          {unlimited ? t('settingsContextLimitUnlimited') : contextLimit}
        </span>
      </div>
      <MduiSlider
        value={unlimited ? UNLIMITED_STOP : contextLimit}
        min={MIN_CONTEXT_LIMIT}
        max={UNLIMITED_STOP}
        step={1}
        label={t('settingsContextLimit')}
        formatValue={formatContextLimit}
        onChange={(value) =>
          setContextLimit(value >= UNLIMITED_STOP ? CONTEXT_LIMIT_UNLIMITED : value)
        }
      />
      <div className={styles.foot}>
        <span className={styles.hint}>{t('settingsContextLimitDescription')}</span>
        {unlimited ? null : (
          <button type="button" className={styles.reset} onClick={resetContextLimit}>
            {t('settingsTemperatureReset')}
          </button>
        )}
      </div>
    </div>
  )
}
