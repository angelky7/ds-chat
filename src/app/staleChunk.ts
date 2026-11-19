import { showToast } from '../components/base/toastState.js'

/**
 * 发版后旧页面继续引用的异步 chunk 已被新构建替换（文件名带哈希，旧文件 404），
 * 用户点某个按需加载的功能就会看到「Loading chunk 6061 failed」这类原始报错。
 * 这里统一接住：自动刷新一次拿到新构建；冷却期内再次失败则提示手动刷新，避免刷新死循环。
 */
const RELOAD_KEY = 'chat-demo:chunk-reload-at'
/** 刷新冷却：20 秒内不再自动刷新，防止网络故障时无限重载 */
const RELOAD_COOLDOWN = 20_000

const CHUNK_ERROR =
  /Loading chunk \d+ failed|Loading CSS chunk|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i

const isChunkError = (error: unknown): boolean => {
  if (typeof error === 'string') {
    return CHUNK_ERROR.test(error)
  }
  return error instanceof Error ? CHUNK_ERROR.test(error.message) : false
}

export const installStaleChunkGuard = () => {
  window.addEventListener('unhandledrejection', (event) => {
    if (!isChunkError(event.reason)) {
      return
    }
    // 已经不是「业务错误」，不再往控制台抛原始堆栈
    event.preventDefault()
    let last = 0
    try {
      last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0)
    } catch {
      // 隐私模式下 sessionStorage 可能不可用，按「没刷过」处理
    }
    if (Date.now() - last < RELOAD_COOLDOWN) {
      showToast({ key: 'staleChunkReloadFailed' })
      return
    }
    try {
      window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch {
      // 存不进去也能刷新，只是失去冷却保护
    }
    window.location.reload()
  })
}
