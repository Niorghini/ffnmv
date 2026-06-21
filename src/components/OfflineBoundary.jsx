/**
 * 网络异常全局兜底（仅 native 平台生效）
 * - 首次打开 + 离线 + 无缓存：完全兜底页 + 重试按钮
 * - 离线 + 有缓存：顶部条幅 + 正常 App
 * - 在线：透传 children（web 端恒为在线，等价透传）
 *
 * 位置：App.jsx 里包在 <AuthedRoutes> 外，Login 页豁免
 */
import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { db } from '@/lib/db'

export function OfflineBoundary({ children }) {
  const [online, setOnline] = useState(true)
  const [hasCache, setHasCache] = useState(true)

  useEffect(() => {
    let mounted = true
    const check = async () => {
      // Web 端不挂载：用 navigator.onLine 处理（在 syncManager 和 useSyncStore 里）
      if (!Capacitor.isNativePlatform()) return
      const status = await Network.getStatus()
      const noteCount = await db.notes.count()
      if (!mounted) return
      setOnline(status.connected)
      setHasCache(noteCount > 0)
    }
    check()
    if (Capacitor.isNativePlatform()) {
      const handler = (s) => setOnline(s.connected)
      const handle = Network.addListener('networkStatusChange', handler)
      return () => {
        mounted = false
        handle.remove()
      }
    }
    return () => { mounted = false }
  }, [])

  // 首次打开 + 离线 + 无缓存：完全兜底页
  if (!online && !hasCache) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-6 text-center bg-white">
        <WifiOff size={48} className="text-gray-400 mb-4" />
        <h2 className="text-lg font-medium text-gray-700">无网络连接</h2>
        <p className="text-sm text-gray-500 mt-2 max-w-xs">
          请检查 WiFi 或移动数据后重试。首次打开需要网络以验证账号。
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-4 py-2 bg-[#0077B6] text-white rounded-lg text-sm"
        >
          重试
        </button>
      </div>
    )
  }

  // 离线 + 有缓存：顶部条幅 + 正常 App
  return (
    <>
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-100 text-amber-800 text-xs text-center py-1">
          离线模式 · 新增内容将在恢复网络后同步
        </div>
      )}
      {children}
    </>
  )
}
