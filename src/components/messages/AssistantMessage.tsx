import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo } from 'react'
import { IconRefreshOutline16, IconWarningOutline16 } from '../base/icons.js'
import { useTheme } from '../../app/theme.js'
import { useAppearance } from '../../services/appearance.js'
import { useActiveProvider } from '../../services/providers.js'
import { describeReply } from '../../services/chat/describe.js'
import { canContinueReply } from '../../services/chat/reply.js'
import { continueReply, regenerateReply } from '../../services/chat/store.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import type { AssistantMessage as AssistantMessageType } from '../../services/chat/types.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { IconButton } from '../base/IconButton.js'
import { Button } from '../base/Button.js'
import { Markdown } from '../markdown/Markdown.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { Avatar } from './Avatar.js'
import { ReadAloudButton } from './ReadAloudButton.js'
import { CopyButton } from './CopyButton.js'
import { ReplyArea } from './ReplyArea.js'
import { useReplyView } from './useReplyView.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import styles from './AssistantMessage.module.css'

const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

export const AssistantMessage = memo(function AssistantMessage({
  sessionId,
  message,
  isLast,
  streaming,
  busy,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: AssistantMessageType
  isLast: boolean
  streaming: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  const provider = useActiveProvider()
  const view = useReplyView(message, streaming)
  const panelEntry = useSearchPanel((state) => state.entry)
  const showAvatars = useAppearance((state) => state.showAvatars)
  const avatar = useAppearance((state) => state.assistantAvatar)
  const theme = useTheme()
  // 只有设置过 AI 气泡颜色时才套气泡，否则保持官方无气泡排版
  const bubble = useAppearance((state) => state.themes[theme].assistantBubble !== null)
  // 安全拒绝：默认丢弃已下发的思考与正文，只显示模板答复；
  // 打开「保留被撤回的回答」后内容还在，就不再显示模板，改成一句撤回说明。
  const refused = message.stopReason === 'refusal'
  const keptRefusal =
    refused && message.blocks.some((block) => block.type === 'text' || block.type === 'thinking')
  const notice = streaming || keptRefusal ? null : describeReply(message)
  const answer = refused && !keptRefusal ? null : view.answer
  const responseText = [answer?.text, notice?.presentation === 'response' ? notice.text : null]
    .filter(Boolean)
    .join('\n\n')
  const copyText = responseText || notice?.text
  const waiting = streaming && view.steps.length === 0 && !view.answer && !message.thinking
  const summaryEntry = `${message.id}-summary`
  return (
    <div className={styles.message}>
      {showAvatars ? <Avatar role="assistant" src={avatar} className={styles.avatar} /> : null}
      <div className={styles.body}>
        <div className={clsx(styles.content, bubble && styles.contentBubble)}>
          {refused && !keptRefusal ? null : (
            <ReplyArea
              message={message}
              view={view}
              streaming={streaming}
              hasResponse={!!responseText}
            />
          )}
          {answer ? (
            <Markdown
              className="ds-assistant-message-main-content"
              content={answer.markdown}
              loading={streaming}
              cacheKey={message.id}
              disableLink={false}
              sources={view.sources}
            />
          ) : null}
          {keptRefusal ? (
            <div className={styles.refusalNotice}>
              <IconWarningOutline16 />
              <span>{t('replyRefusedKept')}</span>
            </div>
          ) : null}
          {waiting ? (
            <div className={styles.waiting}>
              {[0, 1, 2].map((index) => (
                <span key={index} className={styles.waitingDot} />
              ))}
            </div>
          ) : null}
          {notice?.presentation === 'response' ? (
            <Markdown
              className="ds-assistant-message-main-content"
              content={notice.text}
              loading={false}
              cacheKey={`${message.id}-template`}
              disableLink={false}
            />
          ) : notice ? (
            <div className={styles.notice}>
              <IconWarningOutline16 />
              <span>
                {notice.text}
                {notice.action === 'apiKey' ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className={styles.noticeAction}
                      onClick={() => openSettings('provider')}
                    >
                      {t('changeApiKey')}
                    </button>
                  </>
                ) : null}
                {notice.action === 'topUp' && provider.id === 'deepseek' ? (
                  <>
                    {' '}
                    <a
                      className={styles.noticeAction}
                      href={TOP_UP_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('topUp')}
                    </a>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}
          {!streaming && !refused && view.searchResults.length > 0 ? (
            <div
              className={clsx(styles.summary, panelEntry === summaryEntry && styles.summaryActive)}
              onClick={() => toggleSearchPanel(summaryEntry, view.searchResults)}
            >
              <SiteThumbnails sources={view.searchResults} />
              <span>
                {t(
                  view.searchResults.length === 1
                    ? 'messageSearchSummary'
                    : 'messageSearchSummaries',
                  { count: view.searchResults.length }
                )}
              </span>
            </div>
          ) : null}
        </div>
        {streaming ? null : (
          <div className={styles.bottom}>
            <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
            <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
              {copyText ? <CopyButton text={copyText} /> : null}
              {responseText && !refused && provider.capabilities.speech ? (
                <ReadAloudButton messageId={message.id} text={responseText} />
              ) : null}
              <IconButton
                icon={<IconRefreshOutline16 />}
                tooltip={t('regenerate')}
                tooltipPlacement="bottom"
                disabled={busy || refused}
                onClick={() => {
                  stopReadAloud()
                  regenerateReply(sessionId, message.id)
                }}
              />
            </div>
            {isLast && canContinueReply(message) ? (
              <Button
                variant="outlined"
                size="s"
                className={styles.continueButton}
                disabled={busy}
                onClick={() => {
                  stopReadAloud()
                  continueReply(sessionId, message.id)
                }}
              >
                {t('continueGenerating')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
})
