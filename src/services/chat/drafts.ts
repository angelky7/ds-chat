import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import { prepareImageFile } from '../../utils/image.js'
import {
  cancelUpload,
  getExtension,
  isImage,
  resolveMimeType,
  uploadAttachment,
  useUploads,
  validateFiles,
  type UploadTask,
} from '../attachments.js'
import { extractDocumentText } from '../extract.js'
import type { FileAttachment } from './types.js'

export type DraftAttachment = {
  /** 本地标识，也是 IndexedDB 原件与上传任务的 key */
  id: string
  file: File
  isImage: boolean
  previewUrl: string | null
  /** 不经过 Files API 的附件：发送时直接内联，没有上传任务 */
  local?: boolean
  /** 内联文档本地解析出的文字；解析完成后才有，发送时随提问注入 */
  text?: string
}

type Draft = { text: string; attachments: DraftAttachment[] }

export const EMPTY_DRAFT: Draft = { text: '', attachments: [] }

/** 草稿只保存在本次页面的内存中，独立于会话详情缓存；null 是新对话的草稿。 */
export const useDrafts = create<{ drafts: Map<string | null, Draft> }>(() => ({
  drafts: new Map(),
}))

export const getDraft = (sessionId: string | null): Draft =>
  useDrafts.getState().drafts.get(sessionId) ?? EMPTY_DRAFT

const updateDraft = (sessionId: string | null, update: (draft: Draft) => Draft) =>
  useDrafts.setState((state) => {
    const draft = update(state.drafts.get(sessionId) ?? EMPTY_DRAFT)
    const drafts = new Map(state.drafts)
    if (draft.text || draft.attachments.length > 0) {
      drafts.set(sessionId, draft)
    } else {
      drafts.delete(sessionId)
    }
    return { drafts }
  })

export const setDraftText = (sessionId: string | null, text: string) =>
  updateDraft(sessionId, (draft) => ({ ...draft, text }))

const upload = (attachment: DraftAttachment, apiKey: string) => {
  // 上传任务负责记录错误，输入框的附件卡片展示失败及重试入口。
  void uploadAttachment(
    apiKey,
    attachment.id,
    attachment.file,
    attachment.file.name,
    attachment.isImage
  ).catch(() => {})
}

/** 把解析出的文字写回草稿附件；同一附件 id 可能被重试覆盖多次 */
const setAttachmentText = (sessionId: string | null, id: string, text: string) =>
  useDrafts.setState((state) => {
    const draft = state.drafts.get(sessionId)
    if (!draft?.attachments.some((item) => item.id === id)) {
      return state
    }
    const drafts = new Map(state.drafts)
    drafts.set(sessionId, {
      ...draft,
      attachments: draft.attachments.map((item) => (item.id === id ? { ...item, text } : item)),
    })
    return { drafts }
  })

/**
 * 内联文档的本地解析走上传任务的状态位：卡片显示「解析中」，失败可重试。
 * 成功后清掉任务（卡片回到就绪态），文字保存在草稿附件上。
 */
const extract = (sessionId: string | null, attachment: DraftAttachment) => {
  useUploads.setState((state) => ({
    tasks: { ...state.tasks, [attachment.id]: { status: 'extracting' } },
  }))
  void extractDocumentText(attachment.file)
    .then(({ text }) => {
      setAttachmentText(sessionId, attachment.id, text)
      useUploads.setState((state) => ({
        tasks: Object.fromEntries(
          Object.entries(state.tasks).filter(([key]) => key !== attachment.id)
        ),
      }))
    })
    .catch((error: TranslationMessage) => {
      useUploads.setState((state) => ({
        tasks: {
          ...state.tasks,
          [attachment.id]: { status: 'error', error, retryable: true },
        },
      }))
    })
}

/** 整批校验通过后才创建预览和开始上传。 */
export const addDraftFiles = async (
  sessionId: string | null,
  files: File[],
  apiKey: string,
  local = false
): Promise<TranslationMessage | null> => {
  if (files.length === 0) {
    return null
  }
  const error = validateFiles(files, getDraft(sessionId).attachments.length)
  if (error) {
    return error
  }
  // 接口只认 JPEG/PNG/GIF/WebP，其余图片（bmp、tiff、avif、svg…）先转成 JPEG，
  // 否则会在发送时被服务端判为「unsupported image」
  const prepared: File[] = []
  const failed: string[] = []
  for (const file of files) {
    if (!isImage(resolveMimeType(file))) {
      prepared.push(file)
      continue
    }
    const converted = await prepareImageFile(file)
    if (converted) {
      prepared.push(converted)
    } else {
      failed.push(getExtension(file.name) || 'IMAGE')
    }
  }
  const added = prepared.map((file): DraftAttachment => {
    const image = isImage(resolveMimeType(file))
    return {
      id: createId(),
      file,
      isImage: image,
      previewUrl: image ? URL.createObjectURL(file) : null,
      local,
    }
  })
  if (added.length > 0) {
    updateDraft(sessionId, (draft) => ({
      ...draft,
      attachments: [...draft.attachments, ...added],
    }))
    if (!local) {
      added.forEach((attachment) => upload(attachment, apiKey))
    } else {
      // 内联模式没有 Files API：文档在本地抽文字，图片直接就绪
      added.filter((attachment) => !attachment.isImage).forEach((attachment) => {
        extract(sessionId, attachment)
      })
    }
  }
  return failed.length > 0
    ? { key: 'uploadImageConvertFailed', params: { ext: [...new Set(failed)].join('、') } }
    : null
}

export const retryDraftAttachment = (
  sessionId: string | null,
  attachmentId: string,
  apiKey: string
) => {
  const attachment = getDraft(sessionId).attachments.find((item) => item.id === attachmentId)
  if (!attachment) {
    return
  }
  if (attachment.local) {
    // 内联文档重试就是重新解析一次；解析失败多半是文件本身的问题
    if (!attachment.isImage) {
      extract(sessionId, attachment)
    }
    return
  }
  upload(attachment, apiKey)
}

/**
 * 发送按钮和实际提交共用规则：有内容，且附件就绪。
 * Files API 通道要求全部附件上传成功；内联通道只看图片本身。
 */
export const prepareDraftMessage = (
  draft: Draft,
  tasks: Record<string, UploadTask>,
  local = false
) => {
  const text = draft.text.trim()
  if (!text && draft.attachments.length === 0) {
    return null
  }
  const files: (FileAttachment & { serverId: string; blob: Blob })[] = []
  for (const attachment of draft.attachments) {
    const mimeType = resolveMimeType(attachment.file)
    if (local) {
      // 图片直接内联；文档必须在本地解析出文字后才能发送
      if (!attachment.isImage) {
        if (!attachment.text?.trim()) {
          return null
        }
        files.push({
          id: attachment.id,
          serverId: '',
          name: attachment.file.name,
          size: attachment.file.size,
          isImage: false,
          mimeType,
          text: attachment.text,
          blob: attachment.file,
        })
        continue
      }
      files.push({
        id: attachment.id,
        serverId: '',
        name: attachment.file.name,
        size: attachment.file.size,
        isImage: true,
        mimeType,
        blob: attachment.file,
      })
      continue
    }
    const task = tasks[attachment.id]
    if (task?.status !== 'done' || !task.serverId) {
      return null
    }
    files.push({
      id: attachment.id,
      serverId: task.serverId,
      name: attachment.file.name,
      size: attachment.file.size,
      isImage: attachment.isImage,
      mimeType,
      blob: attachment.file,
    })
  }
  return { text, files }
}

const releaseAttachment = (attachment: DraftAttachment, cancel: boolean) => {
  if (cancel) {
    cancelUpload(attachment.id)
  }
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}

export const removeDraftAttachment = (sessionId: string | null, attachmentId: string) => {
  const attachment = getDraft(sessionId).attachments.find((item) => item.id === attachmentId)
  if (!attachment) {
    return
  }
  releaseAttachment(attachment, true)
  updateDraft(sessionId, (draft) => ({
    ...draft,
    attachments: draft.attachments.filter((item) => item.id !== attachmentId),
  }))
}

/** 发送成功后原件与 serverId 已交给会话，释放预览但保留上传完成态。 */
export const clearSentDraft = (sessionId: string | null) => {
  getDraft(sessionId).attachments.forEach((attachment) => releaseAttachment(attachment, false))
  updateDraft(sessionId, () => EMPTY_DRAFT)
}

/** 删除会话或替换历史成功后，释放尚未发送的草稿及上传任务。 */
export const clearDraft = (sessionId: string | null) => {
  getDraft(sessionId).attachments.forEach((attachment) => releaseAttachment(attachment, true))
  updateDraft(sessionId, () => EMPTY_DRAFT)
}

export const clearAllDrafts = () => {
  for (const draft of useDrafts.getState().drafts.values()) {
    draft.attachments.forEach((attachment) => releaseAttachment(attachment, true))
  }
  useDrafts.setState({ drafts: new Map() })
}
