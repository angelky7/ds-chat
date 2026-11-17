import clsx from 'clsx'
import styles from './Switch.module.css'

/** 开关：40×22 的胶囊，打开时滑块右移并填充品牌色 */
export const Switch = ({
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
