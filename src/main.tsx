import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupBrand } from './app/brand.js'
import { stripReloadBust } from './app/reload.js'
import { installStaleChunkGuard } from './app/staleChunk.js'
import { setupTheme } from './app/theme.js'
import { requestPersistentStorage } from './services/chat/db.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

// 强刷参数只用于绕过 index.html 缓存，进入页面后立刻从地址栏清掉
stripReloadBust()
// 申请持久化存储，降低浏览器在磁盘紧张时清空本地对话的概率
requestPersistentStorage()
// 发版后旧页面引用的异步 chunk 会 404：自动刷新一次，而不是丢原始报错给用户
installStaleChunkGuard()
ensureKatex()
setupTheme()
setupBrand()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
