import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// 根据部署路径设置浏览器 tab 标题(同步执行,避免闪一下旧标题)
if (typeof window !== 'undefined') {
  const p = window.location.pathname
  if (p.startsWith('/ffn-pre')) {
    document.title = '发法牛v1.3.1 - 轻量化多端同步笔记'
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)