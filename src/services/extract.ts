import { strFromU8, unzipSync } from 'fflate'
import type { TranslationMessage } from '../i18n/index.js'
import { getFileExt } from './attachments.js'

/**
 * 本地文档解析：没有 Files API 的服务商无法引用 file_id，
 * 文档附件在浏览器里抽成纯文本，随提问以 <document> 块注入对话。
 * 只追求「能读出内容」：docx/pptx/xlsx 解包 XML，PDF 用 pdf.js 抽文字层；
 * 扫描件没有文字层、旧版二进制 Office（doc/ppt/xls）读不了，按失败处理。
 */

/** 注入请求的文本上限（字符）；超出截断并附说明，避免单文件顶爆上下文 */
const MAX_EXTRACT_CHARS = 400_000
/** 纯文本最多读取的字节数，够 400k 字符还有余量 */
const MAX_TEXT_BYTES = 8 * 1024 * 1024
/** 截断说明：英文写给模型看，不参与界面文案 */
const TRUNCATION_NOTE = `\n\n[Document truncated after ${MAX_EXTRACT_CHARS} characters.]`

export type ExtractResult = {
  text: string
  /** 文本被截断过；界面不需要，仅供调试与估算参考 */
  truncated: boolean
}

const truncate = (text: string): ExtractResult =>
  text.length <= MAX_EXTRACT_CHARS
    ? { text, truncated: false }
    : { text: text.slice(0, MAX_EXTRACT_CHARS) + TRUNCATION_NOTE, truncated: true }

/** XML 实体还原；w:t / a:t 里的内容只可能是实体转义，不会出现裸的 < > */
const decodeXmlEntities = (text: string) =>
  text.replace(
    /&(?:amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g,
    (entity) =>
      entity === '&amp;'
        ? '&'
        : entity === '&lt;'
          ? '<'
          : entity === '&gt;'
            ? '>'
            : entity === '&quot;'
              ? '"'
              : entity === '&apos;'
                ? "'"
                : String.fromCodePoint(parseInt(entity.slice(2, -1), entity[2] === 'x' ? 16 : 10))
  )

const matchAll = (xml: string, pattern: RegExp): string[] =>
  [...xml.matchAll(pattern)].map((match) => decodeXmlEntities(match[1]))

/** docx：按 </w:p> 分段，段内拼接所有 w:t 文本 */
const extractDocx = (bytes: Uint8Array): string => {
  const xml = strFromU8(unzipSync(bytes)['word/document.xml'] ?? new Uint8Array())
  if (!xml) {
    throw new Error('missing word/document.xml')
  }
  return xml
    .split('</w:p>')
    .map((paragraph) => matchAll(paragraph, /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g).join(''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** pptx：幻灯片按文件名序号排序，页内拼 a:t，页间空行分隔 */
const extractPptx = (bytes: Uint8Array): string => {
  const entries = unzipSync(bytes)
  const slides = Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => (Number(a.match(/\d+/)?.[0]) || 0) - (Number(b.match(/\d+/)?.[0]) || 0))
  if (slides.length === 0) {
    throw new Error('missing ppt/slides')
  }
  return slides
    .map((name) =>
      matchAll(strFromU8(entries[name]), /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)
        .join('')
        .trim()
    )
    .filter(Boolean)
    .join('\n\n')
}

/** xlsx：抽共享字符串表；数字单元格跳过，文字够模型理解表格大意 */
const extractXlsx = (bytes: Uint8Array): string => {
  const entries = unzipSync(bytes)
  const shared = entries['xl/sharedStrings.xml']
  if (!shared) {
    throw new Error('missing xl/sharedStrings.xml')
  }
  return matchAll(strFromU8(shared), /<si>([\s\S]*?)<\/si>/g)
    .map((item) => matchAll(item, /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g).join(''))
    .filter(Boolean)
    .join('\n')
}

let workerPort: Worker | undefined

/** 首次解析 PDF 时才加载 pdf.js 与 worker chunk，主包不背这个体积 */
const loadPdfjs = async () => {
  const pdfjs = await import('pdfjs-dist')
  if (!workerPort) {
    workerPort = new Worker(new URL('./pdfWorker.ts', import.meta.url), { type: 'module' })
    pdfjs.GlobalWorkerOptions.workerPort = workerPort
  }
  return pdfjs
}

const extractPdf = async (file: File): Promise<string> => {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  try {
    const pages: string[] = []
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str
          if (item.hasEOL) {
            text += '\n'
          }
        }
      }
      pages.push(text.trim())
    }
    return pages.filter(Boolean).join('\n\n')
  } finally {
    await doc.cleanup()
  }
}

/** 剩余扩展名按纯文本读取；先嗅探再解码，避免把二进制文件读成乱码灌进对话 */
const extractPlain = async (file: File): Promise<string> => {
  const sample = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  const zeros = sample.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0)
  if (zeros > sample.length * 0.04) {
    throw new Error('looks binary')
  }
  const bytes = new Uint8Array(await file.slice(0, MAX_TEXT_BYTES).arrayBuffer())
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/**
 * 抽取文档文字；结果为空或文件读不了时抛出界面可直接展示的错误文案。
 * 任何单个解析器的异常都归为「无法读取」：本地解析没有重试能改变结果，
 * 但保留重试入口，个别损坏文件值得再试一次。
 */
export const extractDocumentText = async (file: File): Promise<ExtractResult> => {
  const ext = getFileExt(file.name)
  let text = ''
  try {
    if (ext === 'pdf') {
      text = await extractPdf(file)
    } else if (ext === 'docx') {
      text = extractDocx(new Uint8Array(await file.arrayBuffer()))
    } else if (ext === 'pptx') {
      text = extractPptx(new Uint8Array(await file.arrayBuffer()))
    } else if (ext === 'xlsx') {
      text = extractXlsx(new Uint8Array(await file.arrayBuffer()))
    } else {
      text = await extractPlain(file)
    }
  } catch {
    // 解包失败、worker 加载失败、二进制嗅探不过……统一按「读不出内容」处理
    throw extractEmpty
  }
  if (!text.trim()) {
    throw extractEmpty
  }
  return truncate(text)
}

/** 解析失败的界面文案（可点击重试后再解析一次） */
export const extractEmpty: TranslationMessage = { key: 'uploadExtractEmpty' }
