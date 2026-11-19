import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo } from 'react'
import { IconEditOutline16 } from '../base/icons.js'
import { retryUpload, startEditingMessage } from '../../services/chat/store.js'
import type { UserMessage as UserMessageType } from '../../services/chat/types.js'
import { useAppearance } from '../../services/appearance.js'
import { IconButton } from '../base/IconButton.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import { Avatar } from './Avatar.js'
import { MessageFile } from './MessageFile.js'
import { CopyButton } from './CopyButton.js'
import styles from './UserMessage.module.css'

export const UserMessage = memo(function UserMessage({
  sessionId,
  message,
  retryUploadId,
  isFirst,
  isLast,
  busy,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: UserMessageType
  /** 回答因补传附件失败可重试时为该回答 id */
  retryUploadId: string | null
  isFirst: boolean
  isLast: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  const showAvatars = useAppearance((state) => state.showAvatars)
  const avatar = useAppearance((state) => state.userAvatar)

  return (
    <div
      className={clsx(styles.container, isFirst && styles.isFirst)}
      data-message-id={message.id}
    >
      <div className={styles.body}>
        {message.files.length > 0 ? (
          <div
            className={clsx(
              styles.files,
              message.files.some((file) => !file.isImage) && styles.filesWithDocuments
            )}
          >
            {message.files.map((file) => (
              <MessageFile
                key={file.id}
                file={file}
                onRetry={retryUploadId ? () => retryUpload(sessionId, retryUploadId) : null}
              />
            ))}
          </div>
        ) : null}
        {message.content ? <div className={styles.bubble}>{message.content}</div> : null}
        <div className={styles.bottom}>
          <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
            {message.content ? <CopyButton text={message.content} /> : null}
            <IconButton
              icon={<IconEditOutline16 />}
              tooltip={t('editMessage')}
              tooltipPlacement="bottom"
              disabled={busy}
              /* 编辑会把文字与附件载入输入框，在那里增删附件后再发送 */
              onClick={() => void startEditingMessage(sessionId, message.id)}
            />
          </div>
          <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
        </div>
      </div>
      {showAvatars ? <Avatar role="user" src={avatar} className={styles.avatar} /> : null}
    </div>
  )
})
