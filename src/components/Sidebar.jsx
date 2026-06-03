/**
 * Sidebar —— 右栏：状态筛选 + 标签 + 操作
 * 风格对齐 v0.7.0：白底卡片、rounded-lg/shadow-sm、space-y-4
 * （同步/账号入口已迁至顶部 UserMenu）
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, Settings, Hash, Tag, Search, X, ListFilter, Circle, CheckCircle2, Rows3 } from 'lucide-react'
import { useTagsStore } from '@/stores/useTagsStore'
import { useNotesStore } from '@/stores/useNotesStore'

const Sidebar = () => {
  const { tags, counts, load: loadTags } = useTagsStore()
  const { activeTagId, setActiveTagId, notes, setStatusFilter, statusFilter, load: loadNotes } = useNotesStore()
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
      {/* 状态筛选 */}
      <section className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <ListFilter size={14} className="text-gray-500" />
          <h3 className="text-sm font-medium text-gray-700">筛选</h3>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill
            icon={<Circle size={14} />}
            label="未处理"
            count={pendingCount}
            active={statusFilter === 'pending'}
            onClick={() => setStatusFilter('pending')}
          />
          <StatusPill
            icon={<CheckCircle2 size={14} />}
            label="已处理"
            count={completedCount}
            active={statusFilter === 'completed'}
            onClick={() => setStatusFilter('completed')}
          />
          <StatusPill
            icon={<Rows3 size={14} />}
            label="全部"
            count={totalCount}
            active={statusFilter === 'all' && !activeTagId}
            onClick={() => { setStatusFilter('all'); setActiveTagId(null) }}
          />
        </div>
      </section>

      {/* 标签：只显示有活跃 link 的（即至少被一条笔记引用） */}
      <section className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Tag size={14} className="text-gray-500" />
            <h3 className="text-sm font-medium text-gray-700">标签</h3>
          </div>
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

const StatusPill = ({ icon, label, count, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors ${
      active
        ? 'bg-[#0077B6] text-white'
        : 'bg-blue-50 text-[#0077B6] hover:bg-blue-100'
    }`}
  >
    {icon}
    <span className="whitespace-nowrap">{label}</span>
    <span className={active ? 'text-white/70' : 'text-[#0077B6]/60'}>{count}</span>
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

export default Sidebar
