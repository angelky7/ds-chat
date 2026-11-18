import { useEffect, useRef } from 'react'
import 'mdui/components/slider/index.js'
import 'mdui/mdui.css'
import styles from './MduiSlider.module.css'

type MduiSliderElement = HTMLElement & {
  value: number
  /** mdui 自带的提示文本格式化钩子，只能通过 property 设置 */
  labelFormatter: (value: number) => string
}

/**
 * 原生 range 按 step 累加会带出二进制误差（0.1 × 14 = 1.4000000000000001），
 * 显示前统一收敛到 4 位小数再去掉末尾的 0。
 */
const trimFloat = (value: number): string => String(Number(value.toFixed(4)))

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
  formatValue,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  /** 无障碍名称；mdui 不自带可见标签 */
  label: string
  disabled?: boolean
  /** 拖动时气泡里的文本；默认收敛浮点误差 */
  formatValue?: (value: number) => string
  onChange: (value: number) => void
}) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const formatRef = useRef(formatValue)
  formatRef.current = formatValue

  useEffect(() => {
    const element = hostRef.current?.querySelector<MduiSliderElement>('mdui-slider')
    if (!element) {
      return
    }
    const handleInput = () => onChangeRef.current(element.value)
    element.addEventListener('input', handleInput)
    // 组件内部的 value 由 position 反算，会重新变成 1.4000000000000001，
    // 所以只能改它用来显示的函数，不能在外部把 value 写干净。
    element.labelFormatter = (current) => (formatRef.current ?? trimFloat)(current)
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
