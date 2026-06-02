/**
 * NoteList —— v0.7.0 风格笔记卡片列表
 * - 在左栏 Editor 下方
 * - 状态过滤 + 标签过滤 + 搜索过滤（来自 useNotesStore）
 * - 状态切换 + 软删 按钮
 * - 用 useVirtualizer 但 v0.7.0 的卡片更高 + 间距更大
 */
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, Trash2 } from 'lucide-react'
import { useNotesStore } from '@/stores/useNotesStore'
import { useTagsStore } from '@/stores/useTagsStore'
import { notesRepo } from '@/repositories/notesRepo'
import { useVirtualizer } from '@/hooks/useVirtualizer'

const ROW_HEIGHT = 96

const NoteList = ({ activeId, onSelect, refreshKey }) => {
  const { notes, statusFilter, searchQuery, activeTagId, setStatusFilter, setSearchQuery, load, resetFilters } = useNotesStore()
  const { tags, load: loadTags } = useTagsStore()
  const [, setTick] = useState(0)

  useEffect(() => {
    load()
    loadTags()
  }, [load, loadTags])

  useEffect(() => {
    const handler = () => {
      load()
      loadTags()
      setTick((k) => k + 1)
    }
    window.addEventListener('data-updated', handler)
    return () => window.removeEventListener('data-updated', handler)
  }, [load, loadTags])

  const filtered = useMemo(() => {
    return notes
      .filter((n) => {
        if (statusFilter !== 'all' && n.status !== statusFilter) return false
        if (searchQuery && !n.content.toLowerCase().includes(searchQuery.toLowerCase())) return false
        return true
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [notes, statusFilter, searchQuery])

  const { containerRef, totalHeight, visible, offsetY } = useVirtualizer({
    count: filtered.length,
    rowHeight: ROW_HEIGHT,
  })

  const handleToggleStatus = async (e, n) => {
    e.stopPropagation()
    const next = n.status === 'completed' ? 'pending' : 'completed'
    await notesRepo.setStatus(n.id, next)
  }

  const handleDelete = async (e, n) => {
    e.stopPropagation()
    if (!confirm('确定删除？30 天内可在回收站恢复。')) return
    await notesRepo.softDelete(n.id)
  }

  return (
    <section className="bg-white rounded-lg shadow-sm overflow-hidden">
      {(statusFilter !== 'all' || searchQuery || activeTagId) && (
        <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100 flex items-center justify-between">
          <span>共 {filtered.length} 条</span>
          <button onClick={resetFilters} className="text-[#0077B6] hover:underline">
            清除筛选
          </button>
        </div>
      )}
      <div ref={containerRef} className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            {notes.length === 0 ? '还没有笔记，从上方写下第一条' : '没有匹配的笔记'}
          </div>
        ) : (
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
              {visible.map((i) => {
                const n = filtered[i]
                return (
                  <NoteRow
                    key={n.id}
                    note={n}
                    active={activeId === n.id}
                    onClick={() => onSelect(n.id)}
                    onToggleStatus={(e) => handleToggleStatus(e, n)}
                    onDelete={(e) => handleDelete(e, n)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

const NoteRow = ({ note, active, onClick, onToggleStatus, onDelete }) => {
  const preview = note.content.replace(/#[\w一-鿿-]+/g, '').trim().slice(0, 100) || note.content.slice(0, 100)
  return (
    <div
      onClick={onClick}
      style={{ height: ROW_HEIGHT }}
      className={`flex items-start gap-2 px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors hover:bg-gray-50 ${
        active ? 'bg-blue-50/50' : ''
      }`}
    >
      <button
        onClick={onToggleStatus}
        className="mt-0.5 text-gray-400 hover:text-[#0077B6] transition-colors"
        aria-label="切换状态"
      >
        {note.status === 'completed' ? (
          <CheckCircle2 size={18} className="text-green-500" />
        ) : (
          <Circle size={18} />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm leading-relaxed line-clamp-2 break-words ${
            note.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-700'
          }`}
        >
          {preview}
        </div>
        <div className="text-xs text-gray-400 mt-1">{formatTime(note.created_at)}</div>
      </div>
      <button
        onClick={onDelete}
        className="text-gray-300 hover:text-red-500 transition-colors"
        aria-label="删除"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

const formatTime = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export default NoteList
