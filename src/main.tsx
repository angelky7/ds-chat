import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupBrand } from './app/brand.js'
import { installStaleChunkGuard } from './app/staleChunk.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

// 发版后旧页面引用的异步 chunk 会 404：自动刷新一次，而不是丢原始报错给用户
installStaleChunkGuard()
ensureKatex()
setupTheme()
setupBrand()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
