/**
 * 图片归一化：模型接口只接受 JPEG / PNG / GIF / WebP。
 * 附件白名单里还有 svg、bmp、tiff、avif、psd 等格式，
 * 直接透传会被服务端判为「unsupported image」，所以上传前先转成 JPEG。
 */

/** 各家接口都认的图片类型 */
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
/** 长边超过这个值就等比缩小，避免 base64 体积过大被拒 */
const MAX_EDGE = 2048
/** 超过这个体积也重新编码一次 */
const MAX_BYTES = 4 * 1024 * 1024
/** JPEG 质量：视觉上几乎无损，体积约为 PNG 的 1/5 */
const JPEG_QUALITY = 0.9

export const isSupportedImageType = (mimeType: string): boolean =>
  SUPPORTED_TYPES.has(mimeType.toLowerCase())

/** 按扩展名判断是不是图片：归档或旧数据缺 isImage 标记、又拿不到 MIME 时兜底 */
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|svgz?|ico|heic|heif)$/i

export const looksLikeImageName = (name: string): boolean => IMAGE_NAME.test(name)

const decode = async (file: File): Promise<ImageBitmap | HTMLImageElement | null> => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // 部分浏览器对某些格式会直接抛错，继续走 <img> 兜底
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

const renameToJpg = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`
}

/** 文件名扩展名（小写，不含点），用于 MIME 缺失时识别伪装成 .jpg 的图片 */
const getExt = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * 把图片转成接口支持的格式。已经是 JPEG/PNG/GIF/WebP 且体积正常时原样返回；
 * 无法解码（如 TIFF、PSD、SVG 的部分情况）时返回 null，由调用方提示用户。
 */
export const prepareImageFile = async (file: File): Promise<File | null> => {
  const type = (file.type || '').toLowerCase()
  const ext = getExt(file.name)
  const isJpeg = type === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg'
  // 部分来源（剪贴板、安卓文件选择器、重命名过的文件）给不出 MIME，
  // 只按 type 判断会让 gif/png/webp 走进 canvas 转码，动图因此丢帧甚至解码失败。
  const isGif = type === 'image/gif' || ext === 'gif'
  const isPng = type === 'image/png' || ext === 'png'
  const isWebp = type === 'image/webp' || ext === 'webp'
  // DeepSeek 按「文件内容」而非扩展名判断格式：iPhone 照片常是 CMYK、渐进式或 HEIC
  // 伪装成 .jpg，原样上传会在发消息时被判「unsupported image」。因此 JPEG 一律重编码。
  // PNG/GIF/WebP 本身格式固定，原样保留以免破坏动画与透明通道。
  if (!isJpeg && (isGif || isPng || isWebp) && file.size <= MAX_BYTES) {
    return file
  }
  const source = await decode(file)
  if (!source) {
    return null
  }
  const width = 'width' in source ? source.width : 0
  const height = 'height' in source ? source.height : 0
  if (!width || !height) {
    return null
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  // JPEG 没有透明通道，先铺白底，避免透明区域变黑
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height)
  if ('close' in source && typeof source.close === 'function') {
    source.close()
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  )
  if (!blob) {
    return null
  }
  return new File([blob], renameToJpg(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  })
}
