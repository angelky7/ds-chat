import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { forceReload } from '../../app/reload.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './VersionRefresh.module.css'

/** 连点次数与间隔：版本号上连点 5 次（相邻两次间隔 <1.2s）才弹窗，误触不会触发 */
const TAPS_REQUIRED = 5
const TAP_WINDOW = 1200

/**
 * 版本号上的隐藏手势。页面是纯前端 SPA，发版后旧页面不会自己更新，
 * 留一个不占 UI 的入口让用户主动强刷，比新增按钮更省地方。
 */
export const useVersionTap = () => {
  const [open, setOpen] = useState(false)
  const taps = useRef(0)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onTap = useCallback(() => {
    window.clearTimeout(timer.current)
    taps.current += 1
    if (taps.current >= TAPS_REQUIRED) {
      taps.current = 0
      setOpen(true)
      return
    }
    // 停顿超过 1.2 秒就重新计数，避免一天里零散点几次也凑满
    timer.current = window.setTimeout(() => {
      taps.current = 0
    }, TAP_WINDOW)
  }, [])

  const close = useCallback(() => setOpen(false), [])
  return { open, onTap, close }
}

/** 强制刷新确认弹窗：可关闭、可 Esc、点遮罩也能退出 */
export const ForceRefreshDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('settingsVersionRefreshTitle')}
      closable
      onClose={onClose}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button size="m" onClick={forceReload}>
            {t('settingsVersionRefreshAction')}
          </Button>
        </>
      }
    >
      <p className={styles.body}>{t('settingsVersionRefreshBody')}</p>
    </Modal>
  )
}
