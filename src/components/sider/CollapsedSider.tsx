import clsx from 'clsx'
import logoUrl from '../../assets/logo.png'
import { IconPanelLeftOutline16, NewChatIcon } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import styles from './Sider.module.css'

/** 收起侧边栏后的左上角控件：标志、展开与新对话，按普通行内布局摆放 */
export const CollapsedSider = ({ className }: { className?: string }) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.collapsed, className)}>
      <button
        type="button"
        className={styles.collapsedLogo}
        aria-label={t('expandSiderbarButton')}
        onClick={() => setSiderCollapsed(false)}
      >
        <img className={styles.logo} src={logoUrl} alt="" draggable={false} />
      </button>
      <div className={styles.collapsedGroup}>
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          onClick={newChat}
        />
      </div>
    </div>
  )
}
