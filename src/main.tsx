import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { SplashScreen } from '@capacitor/splash-screen'
import App from './App'
import './index.css'

// 根据部署路径设置浏览器 tab 标题(同步执行,避免闪一下旧标题)
if (typeof window !== 'undefined') {
  const p = window.location.pathname
  if (p.startsWith('/ffn-pre')) {
    document.title = '发法牛v1.3.1 - 轻量化多端同步笔记'
  }
}

// 原生平台走 HashRouter：URL 用 #/notes/123 形式，刷新/外部唤起均稳定
// Web 端保持 BrowserRouter：URL 干净，SEO 友好
const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Router future={ROUTER_FUTURE}>
    <App />
  </Router>,
)

if (Capacitor.isNativePlatform()) {
  // Android 物理返回键：优先 history.back()，不能回退就退出 App
  void CapApp.addListener('backButton', ({ canGoBack }) => {
    if (!canGoBack) void CapApp.exitApp()
    else window.history.back()
  })
  // 沉浸式状态栏：CSS 里 body { padding-top: var(--safe-top) } 留出刘海位置
  document.documentElement.style.setProperty('--safe-top', 'env(safe-area-inset-top, 0px)')
  // 双 rAF 等首帧渲染完再隐藏 splash，避免白闪
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void SplashScreen.hide()
    })
  })
}