/**
 * NoteList —— v0.7.0 风格笔记卡片列表
 * - 在左栏 Editor 下方
 * - 状态过滤 + 标签过滤 + 搜索过滤（来自 useNotesStore）
 * - 状态切换 + 软删 按钮
 * - 行内显示 tag chips（最多 2 个 + "…N"）
 * - 用 useVirtualizer 但 v0.7.0 的卡片更高 + 间距更大
 */
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, Trash2, Hash } from 'lucide-react'
import { useNotesStore } from '@/stores/useNotesStore'
import { useTagsStore } from '@/stores/useTagsStore'
import { notesRepo } from '@/repositories/notesRepo'
import { useVirtualizer } from '@/hooks/useVirtualizer'
import { db } from '@/lib/db'

const ROW_HEIGHT = 116

const NoteList = ({ activeId, onSelect, refreshKey, onTagClick }) => {
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

  // 算每个笔记的活跃 tag（活跃 = link.deleted_at 为 null）
  const noteToTags = useMemo(() => {
    const map = new Map()
    if (tags.length === 0) return map
    const tagById = new Map(tags.map((t) => [t.id, t]))
    let links = []
    // 同步读 + 在 effect 里 cache
    return map
  }, [tags])

  // 异步算 note→tags（需要 await db.note_tags）
  const [linkMap, setLinkMap] = useState(new Map())
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const links = await db.note_tags.filter((l) => !l.deleted_at).toArray()
      if (cancelled) return
      const map = new Map()
      for (const l of links) {
        if (!map.has(l.note_id)) map.set(l.note_id, [])
        map.get(l.note_id).push(l.tag_id)
      }
      setLinkMap(map)
    }
    load()
    const handler = () => load()
    window.addEventListener('data-updated', handler)
    return () => {
      cancelled = true
      window.removeEventListener('data-updated', handler)
    }
  }, [notes, tags])

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

  const handleChipClick = (e, tagId) => {
    e.stopPropagation()
    onTagClick?.(tagId)
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
                const tagIds = linkMap.get(n.id) || []
                const noteTags = tagIds
                  .map((id) => tags.find((t) => t.id === id))
                  .filter(Boolean)
                return (
                  <NoteRow
                    key={n.id}
                    note={n}
                    active={activeId === n.id}
                    onClick={() => onSelect(n.id)}
                    onToggleStatus={(e) => handleToggleStatus(e, n)}
                    onDelete={(e) => handleDelete(e, n)}
                    onTagClick={handleChipClick}
                    noteTags={noteTags}
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

const NoteRow = ({ note, active, onClick, onToggleStatus, onDelete, onTagClick, noteTags = [] }) => {
  const preview = note.content.replace(/#[\w一-鿿-]+/g, '').trim().slice(0, 80) || note.content.slice(0, 80)
  const visible = noteTags.slice(0, 2)
  const hidden = noteTags.length - visible.length
  return (
    <div
      onClick={onClick}
      style={{ height: ROW_HEIGHT }}
      className={`flex items-start gap-2 px-4 py-2.5 border-b border-gray-100 cursor-pointer transition-colors hover:bg-gray-50 ${
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
          className={`text-sm leading-snug line-clamp-2 break-words ${
            note.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-700'
          }`}
        >
          {preview}
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {visible.map((t) => (
            <button
              key={t.id}
              onClick={(e) => onTagClick?.(e, t.id)}
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded text-gray-600 hover:text-[#0077B6] transition-colors"
              style={{ background: `${t.color}20` }}
              title={`筛选 #${t.name}`}
            >
              <Hash size={9} style={{ color: t.color }} />
              {t.name}
            </button>
          ))}
          {hidden > 0 && (
            <span className="text-[10px] text-gray-400">+{hidden}</span>
          )}
          <span className="text-xs text-gray-400 ml-auto">{formatTime(note.created_at)}</span>
        </div>
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
