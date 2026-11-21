import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { IconDownloadOutline16, IconUploadOutline14 } from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { SettingCell, type SettingStatus } from './SettingCell.js'
import styles from './Settings.module.css'

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = SettingStatus

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(file)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      // 旧浏览器缺少新内置方法时会抛英文 TypeError，别把它原样展示给用户。
      const outdated = /is not a function|is not defined|undefined\)/i.test(reason)
      // 设备存储空间不足 / IndexedDB 配额超限等本地写入失败，同样给出可操作的提示。
      const storageFull = /quota|storage|object store|dataerror|constraint/i.test(reason)
      setStatus(
        error instanceof BackupError
          ? { key: 'historyImportFailedReason', reason: error.key, error: true }
          : outdated
            ? { key: 'historyImportOutdated', error: true }
            : storageFull
              ? { key: 'historyImportStorageFull', error: true }
              : { key: 'historyImportFailedReason', params: { message: reason }, error: true }
      )
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

const useHistoryDelete = (onBusyChange?: (busy: boolean) => void) => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

/**
 * 备份包固定是 ZIP。这里显式列出类型而不是留空：
 * 部分安卓浏览器的选择器在 accept 为空时只给相机/相册入口，选不到下载目录里的备份。
 */
const IMPORT_ACCEPT = '.zip,application/zip,application/x-zip-compressed,application/octet-stream'

/** 触屏设备上补一句备用路径：安卓内核的选择器行为不受我们控制。 */
const useCoarsePointer = () => {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)')
    setCoarse(query.matches)
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return coarse
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const coarse = useCoarsePointer()

  return (
    <SettingCell
      label={t('historyImport')}
      description={
        coarse
          ? `${t('historyImportDescription')}${t('historyImportMobileHint')}`
          : t('historyImportDescription')
      }
      status={historyImport.status}
      action={
        <span className={styles.importButton}>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton, styles.importButtonFace)}
            disabled={disabled}
            aria-busy={disabled || undefined}
            aria-hidden
            tabIndex={-1}
          >
            <IconUploadOutline14 />
            {disabled ? t('historyImporting') : t('upload')}
          </Button>
          {/*
            接住点击的是盖在按钮上的原生 input：手指直接触发选择器，不走 programmatic click ——
            部分安卓浏览器会把脚本触发的 hidden input 降级成只能拍照/选相册。
            同时显式写 accept：accept 为空时个别内核（如 ColorOS 浏览器）同样只给媒体入口。
            文件类型仍由 checkArchiveFormat 校验，不依赖选择器的过滤。
          */}
          <input
            type="file"
            accept={IMPORT_ACCEPT}
            aria-label={disabled ? t('historyImporting') : t('upload')}
            disabled={disabled}
            className={styles.fileInput}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </span>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}

/** 数据管理：导入、导出与清空历史，桌面弹窗与移动端设置页共用 */
export const DataSettings = ({
  onBusyChange,
  className,
}: {
  /** 切换忙碌状态时通知外层，用于关闭前的确认 */
  onBusyChange?: (busy: boolean) => void
  className?: string
}) => {
  const t = useTranslate()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete(onBusyChange)
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const busy = historyImport.busy || historyDelete.busy || replacingHistory

  return (
    <div className={className}>
      <ImportHistory historyImport={historyImport} disabled={busy} />
      <ExportHistory disabled={busy} />
      <SettingCell
        label={t('deleteAllSessions')}
        status={null}
        action={
          <Button
            variant="dangerOutlined"
            size="m"
            className={styles.cellButton}
            disabled={busy}
            onClick={historyDelete.open}
          >
            {t('delete')}
          </Button>
        }
      />
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </div>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}
