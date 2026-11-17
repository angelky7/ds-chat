/**
 * 新版本检测：纯静态托管下浏览器（尤其 iOS Safari）可能长期缓存入口 HTML 与旧 JS，
 * 用户切换 App 再回来不会重新加载。这里在页面空闲时用 no-store 重新取一次入口 HTML，
 * 比对构建注入的版本号，发现不一致就通知界面提示刷新，避免一直用旧代码踩已修复的问题。
 */

const currentVersion = (): string =>
  document.querySelector('meta[name="application-version"]')?.getAttribute('content') ?? ''

/** 入口 HTML 与当前页面同源同目录；子路径部署时也能取到 */
const entryUrl = (): string => new URL('index.html', window.location.href).href

export const checkForUpdate = (onUpdate: () => void): (() => void) => {
  let cancelled = false

  const run = async () => {
    const current = currentVersion()
    if (!current) {
      return
    }
    try {
      const response = await fetch(entryUrl(), { cache: 'no-store', credentials: 'omit' })
      if (!response.ok) {
        return
      }
      const html = await response.text()
      // HtmlRspackPlugin 输出的属性顺序可能是 content 在前或 name 在前，两种都匹配。
      const meta = html.match(
        /<meta[^>]*application-version[^>]*>/i
      )?.[0]
      const latest = meta?.match(/content=["']([^"']*)["']/i)?.[1] ?? ''
      if (!cancelled && latest && latest !== current) {
        onUpdate()
      }
    } catch {
      // 离线或网络异常时静默，不影响使用。
    }
  }

  // 首屏加载完成后再检查，避免抢占登录/发消息等关键请求。
  const start = window.setTimeout(run, 1500)
  return () => {
    cancelled = true
    window.clearTimeout(start)
  }
}
