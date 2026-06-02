/**
 * Settings 页面：账号、同步、自动归档、登出
 * v0.7.0 风格：白底卡片、圆角
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, RefreshCw, LogOut, Eraser } from 'lucide-react'
import { getArchiveAfterDays, setArchiveAfterDays, runArchive } from '@/lib/autoArchive'
import { tagsRepo } from '@/repositories/tagsRepo'
import { useAuthStore } from '@/stores/useAuthStore'
import { getSyncManager } from '@/lib/syncInstance'
import { useSyncStore } from '@/stores/useSyncStore'

const OPTIONS = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天（推荐）' },
  { value: -1, label: '永不' },
]

const Settings = () => {
  const { user, signOut } = useAuthStore()
  const { lastSyncAt } = useSyncStore()
  const [days, setDays] = useState(30)
  const [saved, setSaved] = useState(false)
  const [unusedCount, setUnusedCount] = useState(null)
  const [cleaning, setCleaning] = useState(false)
  const [cleanedMsg, setCleanedMsg] = useState('')

  useEffect(() => {
    getArchiveAfterDays().then(setDays)
    tagsRepo.findUnused().then((u) => setUnusedCount(u.length))
  }, [])

  const handleChange = async (v) => {
    setDays(v)
    await setArchiveAfterDays(v)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleRunArchive = async () => {
    const count = await runArchive()
    alert(`本次归档 ${count} 条笔记`)
  }

  const handleSync = async () => {
    await getSyncManager().fullSync()
  }

  const handleHardDeleteUnused = async () => {
    if (cleaning) return
    if (unusedCount === 0) {
      alert('没有未使用的标签')
      return
    }
    if (!confirm(`将物理删除 ${unusedCount} 个未使用的标签（本地 + 云端）。\n此操作不可恢复，继续？`)) {
      return
    }
    setCleaning(true)
    try {
      const count = await tagsRepo.hardDeleteUnused()
      setUnusedCount(0)
      setCleanedMsg(`已删除 ${count} 个未用标签`)
      setTimeout(() => setCleanedMsg(''), 3000)
    } catch (e) {
      alert('删除失败：' + e.message)
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-main">
      <header className="px-4 py-3 bg-white border-b border-gray-200 flex items-center gap-3">
        <Link to="/" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg font-semibold">设置</h1>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <section className="bg-white rounded-lg shadow-sm p-4 space-y-2">
          <h2 className="text-sm font-medium text-gray-800">账号</h2>
          <div className="text-sm text-gray-600">{user?.email}</div>
          <div className="text-xs text-gray-400">
            {lastSyncAt && `上次同步 ${new Date(lastSyncAt).toLocaleString('zh-CN')}`}
          </div>
        </section>

        <section className="bg-white rounded-lg shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">同步</h2>
          <button
            onClick={handleSync}
            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={14} />
            立即同步
          </button>
        </section>

        <section className="bg-white rounded-lg shadow-sm p-4 space-y-3">
          <div>
            <h2 className="text-sm font-medium text-gray-800">自动归档</h2>
            <p className="text-xs text-gray-500 mt-1">已处理笔记超过指定天数后自动归档（仍可恢复）</p>
          </div>
          <div className="space-y-2">
            {OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="archive-days"
                  checked={days === opt.value}
                  onChange={() => handleChange(opt.value)}
                  className="text-[#0077B6] focus:ring-[#0077B6]"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
          {saved && <div className="text-xs text-[#0077B6]">已保存</div>}
          <button
            onClick={handleRunArchive}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
          >
            立即执行一次归档
          </button>
        </section>

        <section className="bg-white rounded-lg shadow-sm p-4">
          <h2 className="text-sm font-medium text-gray-800 mb-2">数据</h2>
          <div className="space-y-3">
            <Link to="/trash" className="text-sm text-[#0077B6] hover:underline block">
              回收站（30 天内可恢复）
            </Link>
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">未使用标签</span>
                <span className="text-xs text-gray-400">
                  {unusedCount === null ? '加载中...' : `${unusedCount} 个`}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                没有任何笔记引用的标签。会从本地和云端同时删除。
              </p>
              <button
                onClick={handleHardDeleteUnused}
                disabled={cleaning || unusedCount === 0}
                className="text-xs px-3 py-1.5 border border-red-500 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
              >
                <Eraser size={12} />
                {cleaning ? '清理中...' : '硬删除未用标签'}
              </button>
              {cleanedMsg && <div className="text-xs text-[#0077B6] mt-2">{cleanedMsg}</div>}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-lg shadow-sm p-4">
          <h2 className="text-sm font-medium text-red-600 mb-3">危险操作</h2>
          <button
            onClick={signOut}
            className="text-sm px-3 py-1.5 border border-red-500 text-red-600 rounded-lg hover:bg-red-50 flex items-center gap-1.5 transition-colors"
          >
            <LogOut size={14} />
            退出登录
          </button>
        </section>

        <div className="text-center text-xs text-gray-400 pt-2">发法牛 v1.2</div>
      </div>
    </div>
  )
}

export default Settings
