/**
 * App 根组件
 * - 初始化 IndexedDB + auth
 * - 根据 auth 状态显示 Login 或主路由
 * - 启动/停止 sync
 * - 启动 auto-archive scheduler
 * - 启动 cleanup
 */
import { useEffect, useState, lazy, Suspense, type ReactElement } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { openDb, wasLegacyCleaned, markLegacyCleaned } from '@/lib/db'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSyncStore } from '@/stores/useSyncStore'
import { startSync, stopSync } from '@/lib/syncInstance'
import { startArchiveScheduler, stopArchiveScheduler } from '@/lib/autoArchive'
import { runCleanup } from '@/lib/cleanup'
import Login from '@/pages/Login'
import Toast from '@/components/Toast'
import { OfflineBoundary } from '@/components/OfflineBoundary'

// 路由级 code splitting (EFF-003)
// 90% 用户只进 / (MainApp),Trash / Settings 单独 chunk 按需加载。
const MainApp = lazy(() => import('@/pages/MainApp'))
const Trash = lazy(() => import('@/pages/Trash'))
const Settings = lazy(() => import('@/pages/Settings'))

const PageFallback = (): ReactElement => (
  <div className="flex items-center justify-center h-screen text-gray-500 text-sm">加载中...</div>
)

function AuthedRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

function App(): ReactElement {
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
    // 原生平台：navigator.onLine 不可靠，用 @capacitor/network 重读一次
    if (Capacitor.isNativePlatform()) {
      Network.getStatus().then((status) => {
        useSyncStore.getState().setOnline(status.connected)
      })
    }
  }, [init])

  // 登录态切换
  useEffect(() => {
    if (!user) {
      void stopSync()
      stopArchiveScheduler()
      return
    }
    void startSync().catch((err: unknown) => console.error('Sync start failed:', err))
    startArchiveScheduler()
    runCleanup().catch((err: unknown) => console.warn('Cleanup failed:', err))
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
    <>
      {user ? (
        <OfflineBoundary>
          <AuthedRoutes />
        </OfflineBoundary>
      ) : (
        <Login />
      )}
      {showLegacyToast && (
        <Toast
          message="检测到 v0.7.0 本地数据，已自动清理。新版数据采用新结构。"
          duration={6000}
          onClose={() => setShowLegacyToast(false)}
        />
      )}
    </>
  )
}

export default App