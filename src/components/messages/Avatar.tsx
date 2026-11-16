import clsx from 'clsx'
import styles from './Avatar.module.css'

/** 内置 AI 标识：四角星 */
const AssistantMark = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M8 1.4c.34 2.9 1.9 4.46 4.8 4.8-2.9.34-4.46 1.9-4.8 4.8-.34-2.9-1.9-4.46-4.8-4.8 2.9-.34 4.46-1.9 4.8-4.8Z"
      fill="currentColor"
    />
    <path
      d="M12.4 10.2c.17 1.45.95 2.23 2.4 2.4-1.45.17-2.23.95-2.4 2.4-.17-1.45-.95-2.23-2.4-2.4 1.45-.17 2.23-.95 2.4-2.4Z"
      fill="currentColor"
      opacity={0.72}
    />
  </svg>
)

/** 内置用户标识：人形剪影 */
const UserMark = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx={8} cy={5.2} r={2.7} fill="currentColor" />
    <path
      d="M8 9.1c2.7 0 4.6 1.6 4.9 3.9.04.32-.22.6-.54.6H3.64c-.32 0-.58-.28-.54-.6C3.4 10.7 5.3 9.1 8 9.1Z"
      fill="currentColor"
    />
  </svg>
)

/** 消息头像：配置过图片时显示图片，否则用内置标识 */
export const Avatar = ({
  role,
  src,
  className,
}: {
  role: 'assistant' | 'user'
  src: string | null
  className?: string
}) => (
  <div className={clsx(styles.avatar, styles[role], className)} aria-hidden="true">
    {src ? (
      <img className={styles.image} src={src} alt="" draggable={false} />
    ) : role === 'assistant' ? (
      <AssistantMark />
    ) : (
      <UserMark />
    )}
  </div>
)
