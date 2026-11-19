import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Message } from '../../services/chat/types.js'
import { revealMessage } from '../../services/chat/store.js'
import styles from './RoundOutline.module.css'

/** 摘要取提问开头这么多个字符，超出加省略号（一行放得下的量） */
const SUMMARY_LENGTH = 13

/**
 * 对话内的轮次导航：只列出每一轮的用户提问，点一条跳到那一轮。
 * 当前轮按消息在视口里的位置判定，滚动时跟着变。
 * 移动端先不显示（屏幕窄，浮层会压住正文）。
 */
export const RoundOutline = ({
  sessionId,
  messages,
}: {
  sessionId: string
  messages: Message[]
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  const rounds = useMemo(() => messages.filter((item) => item.role === 'user'), [messages])

  const summaries = useMemo(
    () =>
      rounds.map((message) => {
        const oneLine = message.content.replace(/\s+/g, ' ').trim()
        if (!oneLine) {
          return message.files.length > 0 ? t('roundOutlineAttachment') : '—'
        }
        return oneLine.length > SUMMARY_LENGTH
          ? `${oneLine.slice(0, SUMMARY_LENGTH)}…`
          : oneLine
      }),
    [rounds, t]
  )

  // 当前轮：取进入视口中部的那条用户消息
  useEffect(() => {
    if (!open || typeof IntersectionObserver === 'undefined' || rounds.length === 0) {
      return
    }
    const nodes = rounds
      .map((message) => document.querySelector(`[data-message-id="${message.id}"]`))
      .filter((node): node is Element => node !== null)
    if (nodes.length === 0) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).at(-1)
        const id = visible?.target.getAttribute('data-message-id')
        if (id) {
          setActiveId(id)
        }
      },
      { rootMargin: '-12% 0px -58% 0px', threshold: 0 }
    )
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [open, rounds])

  if (isMobile || rounds.length < 2) {
    return null
  }

  return (
    <div className={clsx(styles.root, open && styles.expanded)}>
      <button
        type="button"
        className={styles.toggle}
        aria-label={t('roundOutline')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span />
        <span />
        <span />
      </button>
      {open ? (
        <div className={styles.panel}>
          {rounds.map((message, index) => (
            <button
              key={message.id}
              type="button"
              className={clsx(styles.item, activeId === message.id && styles.active)}
              title={message.content.trim() || summaries[index]}
              onClick={() => {
                revealMessage(sessionId, message.id)
                setActiveId(message.id)
              }}
            >
              <span className={styles.label}>{summaries[index]}</span>
              <span className={styles.bar} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
