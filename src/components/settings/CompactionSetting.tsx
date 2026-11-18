import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { CompactionError } from '../../services/chat/compact.js'
import { clearCompaction, compactSession, useChatStore } from '../../services/chat/store.js'
import { setAutoCompact, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Switch } from '../base/Switch.js'
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
  const autoCompact = useSettings((state) => state.autoCompact)
  const activeId = useChatStore((state) => state.activeId)
  const compaction = useChatStore((state) =>
    state.activeId ? state.sessionCache[state.activeId]?.compaction : undefined
  )
  const busy = useChatStore((state) =>
    state.activeId ? Boolean(state.compacting[state.activeId]) : false
  )
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
        label={t('settingsAutoCompact')}
        description={t('settingsAutoCompactDescription')}
        status={null}
        action={
          <Switch
            checked={autoCompact}
            label={t('settingsAutoCompact')}
            onChange={setAutoCompact}
          />
        }
      />
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
    </>
  )
}
