/**
 * UserMenu —— 顶部右上角：邮箱入口（点击下拉显示登出）+ 同步三件套
 * 风格与 v0.7.0 一致：bg-white rounded-lg shadow-sm，text-xs
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, RefreshCw } from 'lucide-react'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSyncStore } from '@/stores/useSyncStore'

const UserMenu = ({ onSync }) => {
  const { user, signOut } = useAuthStore()
  const { status, pending, online, lastSyncAt, error } = useSyncStore()
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!user) return null

  const handleSignOut = async () => {
    setOpen(false)
    await signOut()
  }

  const badge = (() => {
    if (!online) return { dot: 'bg-gray-300', text: '离线', color: 'text-gray-500' }
    if (status === 'syncing') return { dot: 'bg-[#0077B6] animate-pulse', text: '同步中', color: 'text-[#0077B6]' }
    if (status === 'error') return { dot: 'bg-red-500', text: '同步失败', color: 'text-red-500' }
    if (pending > 0) return { dot: 'bg-amber-500', text: `${pending} 条待同步`, color: 'text-amber-600' }
    return { dot: 'bg-green-500', text: '已同步', color: 'text-green-600' }
  })()

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg shadow-sm text-xs text-gray-700 hover:bg-gray-50 transition-colors"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span>{user.email}</span>
          <ChevronDown
            size={12}
            className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-10 min-w-[120px] bg-white rounded-lg shadow-md border border-gray-100 py-1 animate-fadeInScale origin-top-right"
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <LogOut size={12} />
              登出
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${badge.dot}`} />
          <span className={badge.color}>{badge.text}</span>
          {status === 'error' && error && (
            <span
              className="text-red-500 max-w-md truncate"
              title={error}
            >
              · {error}
            </span>
          )}
          {lastSyncAt && online && status !== 'syncing' && (
            <span className="text-gray-400">
              · {new Date(lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onSync}
          className="p-1 text-gray-400 hover:text-[#0077B6] transition-colors"
          title="立即同步"
          aria-label="立即同步"
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  )
}

export default UserMenu
