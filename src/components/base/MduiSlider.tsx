import { useEffect, useRef } from 'react'
import 'mdui/components/slider/index.js'
import 'mdui/mdui.css'
import styles from './MduiSlider.module.css'

type MduiSliderElement = HTMLElement & { value: number }

/**
 * mdui 的滑块是 Web Component：属性走 attribute，事件只能 addEventListener。
 * React 18 不会代理自定义元素的事件，所以这里手动订阅 input（拖动过程中持续触发），
 * 并用 property 写回受控值，避免 attribute 字符串与 number 来回转换。
 */
export const MduiSlider = ({
  value,
  min,
  max,
  step,
  label,
  disabled = false,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  /** 无障碍名称；mdui 不自带可见标签 */
  label: string
  disabled?: boolean
  onChange: (value: number) => void
}) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const element = hostRef.current?.querySelector<MduiSliderElement>('mdui-slider')
    if (!element) {
      return
    }
    const handleInput = () => onChangeRef.current(element.value)
    element.addEventListener('input', handleInput)
    return () => element.removeEventListener('input', handleInput)
  }, [])

  useEffect(() => {
    const element = hostRef.current?.querySelector<MduiSliderElement>('mdui-slider')
    if (element && element.value !== value) {
      element.value = value
    }
  }, [value])

  return (
    <div className={styles.host} ref={hostRef}>
      <mdui-slider
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        className={styles.slider}
        {...(disabled ? { disabled: true } : {})}
      />
    </div>
  )
}
