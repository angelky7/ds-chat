import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/**
 * mdui 组件以 Web Components 注册，React 18 的内置 JSX 类型里没有它们。
 * 项目只用到滑块，这里补一条声明；属性按 mdui 的 attribute 名称书写。
 */
declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        'mdui-slider': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
          min?: number
          max?: number
          step?: number
          value?: number
          disabled?: boolean | ''
        }
      }
    }
  }
}
