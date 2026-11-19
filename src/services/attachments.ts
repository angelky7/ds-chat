import { create } from 'zustand'
import type { LinkedMessage, TranslationMessage } from '../i18n/index.js'
import { uploadFile } from './api/client.js'
import { classifyApiError, getUploadErrorInfo, isRetryableApiError } from './api/errors.js'
import type { FilePurpose } from './api/types.js'
import { useSettings, type ParseDepth } from './settings.js'
import { ACCEPT_FILE_EXTS } from './uploadExts.js'

/** 允许上传的扩展名，按扩展名白名单过滤，清单见 uploadExts.ts */
export const ACCEPTED_EXTS = ACCEPT_FILE_EXTS
/** 选择文件对话框的过滤条件 */
export const ACCEPT = ACCEPTED_EXTS.map((ext) => `.${ext}`).join(',')
/** 单文件大小上限与 Files API 一致 */
export const MAX_SIZE_MB = 64
/** 按 user_data 上传的文件（纯文本、代码、表格、电子书）原文件上限更小 */
export const MAX_USER_DATA_SIZE_MB = 32
export const MAX_COUNT = 50
/** 同时上传的文件数 */
const MAX_CONCURRENT = 3

/** 文件扩展名（小写，不含点）；没有扩展名时为空 */
export const getFileExt = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isAcceptedExt = (name: string) => ACCEPTED_EXTS.includes(getFileExt(name))

/** 需要服务端做版面解析的文档；其余非图片文件（纯文本、代码、表格、电子书）无需解析 */
const LAYOUT_RECOGNITION_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx'])

/** 上传时的 purpose：图片不传，按解析深度决定文档是否做版面解析，其余按 user_data 上传 */
export const getUploadPurpose = (
  name: string,
  isImage: boolean,
  depth: ParseDepth = 'layout'
): FilePurpose | null => {
  if (isImage) {
    return null
  }
  if (!LAYOUT_RECOGNITION_EXTS.has(getFileExt(name))) {
    return 'user_data'
  }
  // 快速模式只做文字识别：更快、更省，但读不出表格与图片里的内容
  return depth === 'text' ? 'text_recognition' : 'rich_layout_recognition'
}

/** 文件允许的最大体积（MB），按上传时的 purpose 区分 */
const getMaxSizeMB = (file: File) =>
  getUploadPurpose(file.name, isImage(resolveMimeType(file))) === 'user_data'
    ? MAX_USER_DATA_SIZE_MB
    : MAX_SIZE_MB

/** 添加前校验：格式 → 大小 → 数量，任一不满足即整批不添加 */
export const validateFiles = (files: File[], currentCount: number): TranslationMessage | null => {
  if (files.some((file) => !isAcceptedExt(file.name))) {
    return { key: 'uploadUnsupportedFormat' }
  }
  const oversized = files.find((file) => file.size > getMaxSizeMB(file) * 1024 * 1024)
  if (oversized) {
    return { key: 'uploadMaxMBSize', params: { size: getMaxSizeMB(oversized) } }
  }
  if (currentCount + files.length > MAX_COUNT) {
    return { key: 'uploadMaxFiles', params: { count: MAX_COUNT } }
  }
  return null
}

/** 上传超时：官方规定上传 120s + 解析 120s，同步等待，这里留足余量 */
const UPLOAD_TIMEOUT_MS = 300_000
/** 服务端繁忙后重试前的等待，避开瞬时高峰 */
const RETRY_DELAY_MS = 2000

/** 超时不是服务端返回的错误，单独标记：文案与「上传失败」不同，且值得重试 */
class UploadTimeoutError extends Error {
  constructor() {
    super('upload timeout')
  }
}

/**
 * 上传失败在附件上显示的文案：与设计稿状态对应的用具体原因，其余统一「上传失败」。
 * 服务端原文多为英文且较长，不直接展示。
 */
export const describeUploadError = (error: unknown): TranslationMessage => {
  if (error instanceof UploadTimeoutError) {
    return { key: 'uploadTimeout' }
  }
  if (classifyApiError(error) === 'serverBusy') {
    return { key: 'uploadServerBusy' }
  }
  if (getUploadErrorInfo(error)?.code === 'parseFailed') {
    return { key: 'uploadParseFailed' }
  }
  return { key: 'uploadFileStatusFailed' }
}

type NoticeListener = (notice: LinkedMessage) => void
const noticeListeners = new Set<NoticeListener>()

/** 订阅需要额外提示的上传失败（配额达到上限），由界面层转成 toast */
export const onUploadNotice = (listener: NoticeListener) => {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}

/** 删除已上传文件的接口文档 */
const DELETE_FILE_DOCS_URL = 'https://api-docs.deepseek.com/api/delete-file'

/** 文件数或存储空间达到上限：附件上只放得下「上传失败」，原因另用 toast 说明并引导删除旧文件 */
export const describeUploadQuota = (error: unknown): LinkedMessage | undefined => {
  const info = getUploadErrorInfo(error)
  const link = { key: 'uploadDeleteFiles', href: DELETE_FILE_DOCS_URL } as const
  if (info?.code === 'fileCountLimit') {
    return { type: 'error', key: 'uploadFileCountLimit', params: { limit: info.limit ?? '' }, link }
  }
  if (info?.code === 'storageLimit') {
    return { type: 'error', key: 'uploadStorageLimit', params: { limit: info.limit ?? '' }, link }
  }
  return undefined
}

type Job = () => Promise<void>
const queue: Job[] = []
let running = 0

const next = () => {
  while (running < MAX_CONCURRENT) {
    const job = queue.shift()
    if (!job) {
      return
    }
    running++
    void job().finally(() => {
      running--
      next()
    })
  }
}

/**
 * 排队上传，最多同时上传 MAX_CONCURRENT 个；排队期间中止的任务不会发出请求。
 *
 * 官方 Files API 在同一个请求里同步等解析完成（上传 120s + 解析 120s），
 * 因此每次尝试都带自己的超时，并且在「服务端繁忙 / 超时」时自动重试一次：
 * 版面解析（rich）最重、最容易撞上繁忙，重试时改用纯文本解析（text），
 * 代价是文档里的图不会发给模型，成功后提示一次。
 */
const enqueueUpload = (
  apiKey: string,
  file: Blob,
  name: string,
  isImage: boolean,
  signal: AbortSignal
) =>
  new Promise<string>((resolve, reject) => {
    queue.push(async () => {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      const body = file instanceof File ? file : new File([file], name, { type: file.type })
      const purpose = getUploadPurpose(name, isImage, useSettings.getState().parseDepth)

      /** 单次尝试：合并外部取消与本次超时，超时单独标记以便走重试 */
      const attempt = async (parsePurpose: FilePurpose | null) => {
        const controller = new AbortController()
        let timedOut = false
        const onAbort = () => controller.abort(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, UPLOAD_TIMEOUT_MS)
        try {
          return await uploadFile(apiKey, body, parsePurpose, controller.signal)
        } catch (error) {
          throw timedOut && !signal.aborted ? new UploadTimeoutError() : error
        } finally {
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
        }
      }

      try {
        try {
          resolve((await attempt(purpose)).id)
        } catch (error) {
          if (signal.aborted) {
            throw error
          }
          // 版面解析会额外裁切文档里的图片，个别 docx/ppt 会因此解析失败；
          // 自动退回纯文本解析，仍失败才把原始错误交给界面提示。
          if (
            purpose === 'rich_layout_recognition' &&
            getUploadErrorInfo(error)?.code === 'parseFailed'
          ) {
            resolve((await attempt('text_recognition')).id)
            return
          }
          // 服务端繁忙或超时：等一会儿重试一次；版面解析改用更轻的纯文本解析
          if (isRetryableApiError(error)) {
            await new Promise((done) => setTimeout(done, RETRY_DELAY_MS))
            if (signal.aborted) {
              throw error
            }
            const retryPurpose = purpose === 'rich_layout_recognition' ? 'text_recognition' : purpose
            const uploaded = await attempt(retryPurpose)
            if (retryPurpose !== purpose) {
              for (const listener of noticeListeners) {
                listener({ key: 'uploadDowngradedToText' })
              }
            }
            resolve(uploaded.id)
            return
          }
          throw error
        }
      } catch (error) {
        reject(error)
      }
    })
    next()
  })

/**
 * 上传任务按附件的本地 id 登记：输入框选中即开始上传，全部成功后携带 serverId 发送，
 * 不会重复上传；导入的历史附件没有任务，发送前按本地原件补传。
 * 任务只在内存里，历史附件补传未完成时，刷新后会在下次请求前重新上传。
 */
export type UploadTask =
  | { status: 'uploading' }
  | { status: 'extracting' }
  | { status: 'done'; serverId: string }
  | { status: 'error'; error: TranslationMessage; retryable: boolean }

type UploadState = { tasks: Record<string, UploadTask> }

export const useUploads = create<UploadState>(() => ({ tasks: {} }))

const setTask = (id: string, task: UploadTask | null) =>
  useUploads.setState((state) => ({
    tasks: task
      ? { ...state.tasks, [id]: task }
      : Object.fromEntries(Object.entries(state.tasks).filter(([key]) => key !== id)),
  }))

const pending = new Map<string, { promise: Promise<string>; controller: AbortController }>()

/** 开始（或复用进行中的）上传，返回服务端 file_id；失败时任务记为 error 并抛出原错误 */
export const uploadAttachment = (
  apiKey: string,
  id: string,
  blob: Blob,
  name: string,
  isImage: boolean
): Promise<string> => {
  const current = pending.get(id)
  if (current) {
    return current.promise
  }
  const controller = new AbortController()
  setTask(id, { status: 'uploading' })
  const promise = enqueueUpload(apiKey, blob, name, isImage, controller.signal)
    .then((serverId) => {
      setTask(id, { status: 'done', serverId })
      return serverId
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        setTask(id, null)
      } else {
        setTask(id, {
          status: 'error',
          error: describeUploadError(error),
          retryable: isRetryableApiError(error),
        })
        const notice = describeUploadQuota(error)
        if (notice) {
          for (const listener of noticeListeners) {
            listener(notice)
          }
        } else if (getUploadErrorInfo(error)?.code === 'parseFailed') {
          for (const listener of noticeListeners) {
            listener({ type: 'error', key: 'uploadParseFailedHint' })
          }
        }
      }
      throw error
    })
    .finally(() => pending.delete(id))
  pending.set(id, { promise, controller })
  return promise
}

export const cancelUpload = (id: string) => {
  pending.get(id)?.controller.abort()
  setTask(id, null)
}

/** 各扩展名对应的 MIME：部分系统（如 Windows）给不出 file.type，按扩展名补齐 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** 取文件的 MIME：优先用浏览器给出的类型，缺失时按扩展名推断 */
export const resolveMimeType = (file: File) => file.type || MIME_BY_EXT[getFileExt(file.name)] || ''

export const isImage = (mimeType: string) => mimeType.startsWith('image/')

/** 文件扩展名（大写），用于卡片元信息 */
export const getExtension = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : ''
}

export const formatSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
