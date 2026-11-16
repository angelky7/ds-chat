import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { resolveActiveOpening, usePrompts } from '../../services/prompts.js'
import { useActiveProvider } from '../../services/providers.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 欢迎页最多预览的开场消息条数 */
const PREVIEW_LIMIT = 3

/** 新对话：问候语 + 开场消息预览 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 订阅预设变化：编辑开场消息后欢迎页立即更新
  usePrompts()
  const provider = useActiveProvider()
  const opening = resolveActiveOpening(provider.model).slice(0, PREVIEW_LIMIT)
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        {opening.length > 0 ? (
          <div className={styles.opening}>
            <div className={styles.openingHint}>{t('welcomeOpeningHint')}</div>
            {opening.map((message) => (
              <div key={message.id} className={styles.openingRow}>
                <span className={styles.openingRole}>
                  {t(message.role === 'user' ? 'promptOpeningUser' : 'promptOpeningAssistant')}
                </span>
                <span className={styles.openingText}>{message.content}</span>
              </div>
            ))}
          </div>
        ) : null}
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
