/**
 * Sidebar —— 右栏：sync + 状态筛选 + 标签 + 账号操作
 * 风格对齐 v0.7.0：白底卡片、rounded-lg/shadow-sm、space-y-4
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Trash2, Settings, LogOut, Hash, Inbox, Tag as TagIcon, Search, X } from 'lucide-react'
import { useTagsStore } from '@/stores/useTagsStore'
import { useNotesStore } from '@/stores/useNotesStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSyncStore } from '@/stores/useSyncStore'
import { db } from '@/lib/db'

const Sidebar = ({ onSync }) => {
  const { user, signOut } = useAuthStore()
  const { tags, counts, load: loadTags } = useTagsStore()
  const { activeTagId, setActiveTagId, notes, setStatusFilter, statusFilter, load: loadNotes } = useNotesStore()
  const { status, pending, online, lastSyncAt } = useSyncStore()
  const [tagQuery, setTagQuery] = useState('')

  useEffect(() => {
    loadTags()
    loadNotes()
  }, [loadTags, loadNotes])

  useEffect(() => {
    const handler = () => {
      loadTags()
      loadNotes()
    }
    window.addEventListener('data-updated', handler)
    return () => window.removeEventListener('data-updated', handler)
  }, [loadTags, loadNotes])

  const filteredTags = tags.filter((t) => t.name.toLowerCase().includes(tagQuery.toLowerCase()))
  // 只显示有活跃 link 的 tag（counts.get(t.id) > 0）
  const activeTags = filteredTags.filter((t) => (counts.get(t.id) || 0) > 0)
  const filteredActiveTags = activeTags
  const totalCount = notes.length
  const pendingCount = notes.filter((n) => n.status === 'pending' && !n.archived_at).length
  const completedCount = notes.filter((n) => n.status === 'completed' && !n.archived_at).length

  return (
    <>
      {/* 同步状态卡片 */}
      <section className="bg-white rounded-lg shadow-sm p-3">
        <SyncCard
          status={status}
          pending={pending}
          online={online}
          lastSyncAt={lastSyncAt}
          onSync={onSync}
          onSignOut={signOut}
          email={user?.email}
        />
      </section>

      {/* 状态筛选 + 统计 */}
      <section className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">状态</h3>
        <div className="space-y-1">
          <StatRow
            label="全部"
            count={totalCount}
            active={statusFilter === 'all' && !activeTagId}
            onClick={() => { setStatusFilter('all'); setActiveTagId(null) }}
          />
          <StatRow
            label="未处理"
            count={pendingCount}
            active={statusFilter === 'pending'}
            onClick={() => setStatusFilter('pending')}
            color="text-amber-600"
          />
          <StatRow
            label="已处理"
            count={completedCount}
            active={statusFilter === 'completed'}
            onClick={() => setStatusFilter('completed')}
            color="text-green-600"
          />
        </div>
      </section>

      {/* 标签：只显示有活跃 link 的（即至少被一条笔记引用） */}
      <section className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-700">标签</h3>
          <span className="text-xs text-gray-400">{activeTags.length}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-main rounded mb-2">
          <Search size={12} className="text-gray-400" />
          <input
            type="text"
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder="搜索标签..."
            className="flex-1 outline-none text-xs bg-transparent placeholder:text-gray-400"
          />
          {tagQuery && (
            <button onClick={() => setTagQuery('')} className="text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {activeTags.length === 0 ? (
            <p className="text-xs text-gray-400 py-3 text-center">
              {tags.length === 0
                ? <>在笔记中使用 <code className="text-[#0077B6]">#标签</code> 创建</>
                : '暂无在用标签，去「设置」清理未用标签'}
            </p>
          ) : (
            filteredActiveTags.map((t) => (
              <TagRow
                key={t.id}
                tag={t}
                count={counts.get(t.id) || 0}
                active={activeTagId === t.id}
                onClick={() => setActiveTagId(t.id === activeTagId ? null : t.id)}
              />
            ))
          )}
        </div>
      </section>

      {/* 操作 */}
      <section className="bg-white rounded-lg shadow-sm p-2 divide-y divide-gray-100">
        <Link
          to="/trash"
          className="w-full flex items-center gap-2 px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded"
        >
          <Trash2 size={14} />
          回收站
        </Link>
        <Link
          to="/settings"
          className="w-full flex items-center gap-2 px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded"
        >
          <Settings size={14} />
          设置
        </Link>
      </section>
    </>
  )
}

const StatRow = ({ label, count, active, onClick, color = 'text-gray-500' }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors ${
      active ? 'bg-blue-50 text-[#0077B6] font-medium' : 'hover:bg-gray-50 text-gray-700'
    }`}
  >
    <span>{label}</span>
    <span className={`text-xs ${active ? 'text-[#0077B6]' : color}`}>{count}</span>
  </button>
)

const TagRow = ({ tag, count, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
      active ? 'bg-blue-50 text-[#0077B6] font-medium' : 'hover:bg-gray-50 text-gray-700'
    }`}
  >
    <Hash size={12} style={{ color: tag.color || '#9CA3AF' }} />
    <span className="flex-1 text-left truncate">{tag.name}</span>
    <span className="text-xs text-gray-400">{count}</span>
  </button>
)

const SyncCard = ({ status, pending, online, lastSyncAt, onSync, onSignOut, email }) => {
  const badge = (() => {
    if (!online) return { dot: 'bg-gray-300', text: '离线', color: 'text-gray-500' }
    if (status === 'syncing') return { dot: 'bg-[#0077B6] animate-pulse', text: '同步中', color: 'text-[#0077B6]' }
    if (status === 'error') return { dot: 'bg-red-500', text: '同步失败', color: 'text-red-500' }
    if (pending > 0) return { dot: 'bg-amber-500', text: `${pending} 条待同步`, color: 'text-amber-600' }
    return { dot: 'bg-green-500', text: '已同步', color: 'text-green-600' }
  })()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${badge.dot}`} />
          <span className={`text-xs ${badge.color}`}>{badge.text}</span>
          {lastSyncAt && online && status !== 'syncing' && (
            <span className="text-xs text-gray-400 truncate">
              · {new Date(lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <button
          onClick={onSync}
          className="p-1 text-gray-400 hover:text-[#0077B6] transition-colors"
          title="立即同步"
          aria-label="立即同步"
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <span className="text-xs text-gray-500 truncate">{email}</span>
        <button
          onClick={onSignOut}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
        >
          <LogOut size={12} />
          登出
        </button>
      </div>
    </div>
  )
}

export default Sidebar
