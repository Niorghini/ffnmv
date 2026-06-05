/**
 * App 根组件
 * - 初始化 IndexedDB + auth
 * - 根据 auth 状态显示 Login 或主路由
 * - 启动/停止 sync
 * - 启动 auto-archive scheduler
 * - 启动 cleanup
 */
import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { openDb, wasLegacyCleaned, markLegacyCleaned } from '@/lib/db'
import { useAuthStore } from '@/stores/useAuthStore'
import { startSync, stopSync } from '@/lib/syncInstance'
import { startArchiveScheduler, stopArchiveScheduler } from '@/lib/autoArchive'
import { runCleanup } from '@/lib/cleanup'
import Login from '@/pages/Login'
import MainApp from '@/pages/MainApp'
import Trash from '@/pages/Trash'
import Settings from '@/pages/Settings'
import Toast from '@/components/Toast'

function AuthedRoutes() {
  return (
    <Routes>
      <Route path="/" element={<MainApp />} />
      <Route path="/trash" element={<Trash />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  const { user, initialized, init } = useAuthStore()
  const [dbReady, setDbReady] = useState(false)
  const [showLegacyToast, setShowLegacyToast] = useState(false)

  useEffect(() => {
    openDb()
      .then(() => {
        if (!wasLegacyCleaned()) {
          setShowLegacyToast(true)
          markLegacyCleaned()
        }
        setDbReady(true)
      })
      .catch((err) => {
        console.error('DB open failed:', err)
        setDbReady(true)
      })
    init()
  }, [init])

  // 登录态切换
  useEffect(() => {
    if (!user) {
      stopSync()
      stopArchiveScheduler()
      return
    }
    startSync().catch((err) => console.error('Sync start failed:', err))
    startArchiveScheduler()
    runCleanup().catch((err) => console.warn('Cleanup failed:', err))
    return () => {
      stopArchiveScheduler()
    }
  }, [user])

  if (!dbReady || !initialized) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500 text-sm">
        加载中...
      </div>
    )
  }

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {user ? <AuthedRoutes /> : <Login />}
      {showLegacyToast && (
        <Toast
          message="检测到 v0.7.0 本地数据，已自动清理。新版数据采用新结构。"
          duration={6000}
          onClose={() => setShowLegacyToast(false)}
        />
      )}
    </BrowserRouter>
  )
}

export default App
