import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { CompactionError, contextWindowOf, estimateContextTokens } from '../../services/chat/compact.js'
import { clearCompaction, compactSession, useChatStore } from '../../services/chat/store.js'
import { activeProvider } from '../../services/providers.js'
import { Button } from '../base/Button.js'
import { SettingCell, type SettingStatus } from './SettingCell.js'
import styles from './CompactionSetting.module.css'

/** 千分位，避免一长串数字难读 */
const formatCount = (value: number) => value.toLocaleString()

/**
 * 上下文压缩：把较早的轮次压成一张结构化检查点，后续请求用摘要替代那些轮次。
 * 原文仍留在本地，随时可以「恢复完整历史」；摘要失败时不写入任何内容。
 */
export const CompactionSetting = () => {
  const t = useTranslate()
  const activeId = useChatStore((state) => state.activeId)
  const compaction = useChatStore((state) =>
    state.activeId ? state.sessionCache[state.activeId]?.compaction : undefined
  )
  const busy = useChatStore((state) =>
    state.activeId ? Boolean(state.compacting[state.activeId]) : false
  )
  // 估算当前上下文压力：只统计会进请求的轮次，附件按每个 64 token 粗计
  const pressure = useChatStore((state) => {
    const session = state.activeId ? state.sessionCache[state.activeId] : undefined
    return session ? estimateContextTokens(getVisibleMessages(session)) : 0
  })
  const window = contextWindowOf(activeProvider().model)
  const percent = window > 0 ? (pressure / window) * 100 : 0
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<SettingStatus>(null)

  const run = async () => {
    if (!activeId) {
      setStatus({ key: 'settingsCompactNoSession', error: true })
      return
    }
    setStatus(null)
    try {
      const result = await compactSession(activeId)
      setStatus({
        key: 'settingsCompactDone',
        params: { rounds: result.rounds, tokens: formatCount(result.tokens) },
      })
      setOpen(false)
    } catch (error) {
      if (error instanceof CompactionError) {
        setStatus(
          error.reason === 'nothing-to-compact'
            ? { key: 'settingsCompactEmpty' }
            : error.reason === 'aborted'
              ? null
              : { key: 'settingsCompactFailed', error: true }
        )
        return
      }
      setStatus({ key: 'settingsCompactFailed', error: true })
    }
  }

  const reset = () => {
    if (activeId) {
      clearCompaction(activeId)
    }
    setOpen(false)
    setStatus({ key: 'settingsCompactCleared' })
  }

  return (
    <>
      <SettingCell
        label={t('settingsCompactNow')}
        description={t('settingsCompactDescription')}
        status={
          status ??
          (compaction
            ? {
                key: 'settingsCompacted',
                params: { rounds: compaction.rounds, tokens: formatCount(compaction.tokens) },
              }
            : null)
        }
        action={
          <div className={styles.actions}>
            {compaction ? (
              <Button variant="outlined" size="s" onClick={() => setOpen((value) => !value)}>
                {t(open ? 'settingsCompactHide' : 'settingsCompactView')}
              </Button>
            ) : null}
            <Button
              variant="outlined"
              size="s"
              disabled={busy || !activeId}
              onClick={() => void run()}
            >
              {t(busy ? 'settingsCompactRunning' : 'settingsCompactGo')}
            </Button>
          </div>
        }
      />
      {open && compaction ? (
        <div className={styles.panel}>
          <pre className={styles.summary}>{compaction.summary}</pre>
          <div className={styles.panelFoot}>
            <span className={styles.meta}>
              {t('settingsCompactModelNote', { model: compaction.model })}
            </span>
            <Button variant="dangerOutlined" size="s" onClick={reset}>
              {t('settingsCompactClear')}
            </Button>
          </div>
        </div>
      ) : null}
      {pressure > 0 ? (
        <div className={clsx(styles.pressure, percent >= 80 && styles.pressureHigh)}>
          {t('settingsContextPressure', {
            tokens: formatCount(pressure),
            percent: percent.toFixed(1),
          })}
        </div>
      ) : null}
    </>
  )
}
