import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import {
  CompactionError,
  contextWindowOf,
  estimateContextTokens,
  estimateTokens,
} from '../../services/chat/compact.js'
import { clearCompaction, compactSession, useChatStore } from '../../services/chat/store.js'
import { activeProvider } from '../../services/providers.js'
import { Button } from '../base/Button.js'
import { SettingCell, type SettingStatus } from './SettingCell.js'
import styles from './CompactionSetting.module.css'

/** 千分位，避免一长串数字难读 */
const formatCount = (value: number) => value.toLocaleString()

/** 省下的 token = 被覆盖轮次的估算量 - 摘要自身占用的量 */
const savedTokens = (compaction: { tokens: number; summary: string }): number =>
  Math.max(0, compaction.tokens - estimateTokens(compaction.summary))

/** 结果文案：省下量为 0 说明摘要比原文还长，直说「这次没省」而不是显示 0 tokens */
const compactStatus = (compaction: {
  rounds: number
  tokens: number
  summary: string
}): SettingStatus => {
  const saved = savedTokens(compaction)
  return saved > 0
    ? {
        key: 'settingsCompacted',
        params: { rounds: compaction.rounds, tokens: formatCount(saved) },
      }
    : { key: 'settingsCompactTight', params: { rounds: compaction.rounds } }
}

/**
 * 上下文压缩：把较早的轮次压成检查点，后续请求用摘要替代那些轮次。
 * 摘要本身不对外展示——它是给模型的中间产物，只回报「压了几轮、省了多少」；
 * 原文仍留在本地，随时可以「恢复完整历史」。
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
  const [status, setStatus] = useState<SettingStatus>(null)

  const run = async () => {
    if (!activeId) {
      setStatus({ key: 'settingsCompactNoSession', error: true })
      return
    }
    setStatus(null)
    try {
      setStatus(compactStatus(await compactSession(activeId)))
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
    setStatus({ key: 'settingsCompactCleared' })
  }

  return (
    <>
      <SettingCell
        label={t('settingsCompactNow')}
        description={t('settingsCompactDescription')}
        status={status ?? (compaction ? compactStatus(compaction) : null)}
        action={
          <div className={styles.actions}>
            {compaction ? (
              <button type="button" className={styles.link} onClick={reset}>
                {t('settingsCompactClear')}
              </button>
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
