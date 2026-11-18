import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupBrand } from './app/brand.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
setupBrand()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
