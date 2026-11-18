import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import {
  DEFAULT_TEMPERATURE,
  MAX_TEMPERATURE,
  MIN_TEMPERATURE,
  resetTemperature,
  setTemperature,
  useSettings,
} from '../../services/settings.js'
import styles from './TemperatureSlider.module.css'

/**
 * 采样温度滑块：0~2，默认 1。
 * 只在非思考模式下生效——思考模式服务端固定 1.0，提示文案里已说明，避免用户以为调了没用。
 */
export const TemperatureSlider = ({ className }: { className?: string }) => {
  const t = useTranslate()
  const temperature = useSettings((state) => state.temperature)
  return (
    <div className={clsx(styles.wrap, className)}>
      <div className={styles.head}>
        <span className={styles.label}>{t('settingsTemperature')}</span>
        <span className={styles.value}>{temperature.toFixed(1)}</span>
      </div>
      <input
        className={styles.range}
        type="range"
        min={MIN_TEMPERATURE}
        max={MAX_TEMPERATURE}
        step={0.1}
        value={temperature}
        aria-label={t('settingsTemperature')}
        aria-valuetext={temperature.toFixed(1)}
        onChange={(event) => setTemperature(Number(event.target.value))}
      />
      <div className={styles.foot}>
        <span className={styles.hint}>{t('settingsTemperatureDescription')}</span>
        {temperature === DEFAULT_TEMPERATURE ? null : (
          <button type="button" className={styles.reset} onClick={resetTemperature}>
            {t('settingsTemperatureReset')}
          </button>
        )}
      </div>
    </div>
  )
}
