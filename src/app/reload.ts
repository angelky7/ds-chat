/**
 * 用户在设置里要求「强制刷新」时用：index.html 会被浏览器缓存（GitHub Pages 10 分钟），
 * 普通 reload 有可能还是旧页面，带上一次性查询参数才能拿到新构建。
 * 静态资源文件名带哈希，不需要额外处理。
 */
const BUST_PARAM = 'v'

export const forceReload = () => {
  const url = new URL(window.location.href)
  url.searchParams.set(BUST_PARAM, String(Date.now()))
  window.location.replace(url.toString())
}

/** 启动时清掉强刷参数，避免它留在地址栏或被复制进分享链接 */
export const stripReloadBust = () => {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(BUST_PARAM)) {
    return
  }
  url.searchParams.delete(BUST_PARAM)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}
