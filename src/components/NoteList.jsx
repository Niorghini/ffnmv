/**
 * NoteList —— 笔记卡片列表
 * - 卡片样式: 内容(带 tag inline 在原位置) + 时间 + hover 揭示图标
 * - 状态过滤 + 标签过滤 + 搜索过滤
 * - 行内 tag chip 可点击筛选
 * - **整页自然滚动**（不再有 maxHeight，列表按内容自然增长）
 */
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, Trash2, Pencil } from 'lucide-react'
import { useNotesStore } from '@/stores/useNotesStore'
import { useTagsStore } from '@/stores/useTagsStore'
import { notesRepo } from '@/repositories/notesRepo'
import { db } from '@/lib/db'

const TAG_RE = /#([\w一-鿿-]+)/g

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

  const handleEdit = (e, n) => {
    e.stopPropagation()
    // TODO 编辑功能下一步实现；现在跟点行一样：选笔记载入编辑区
    onSelect(n.id)
  }

  const tagByName = useMemo(() => {
    const m = new Map()
    for (const t of tags) m.set(t.name, t)
    return m
  }, [tags])

  return (
    <section className="space-y-2">
      {(statusFilter !== 'all' || searchQuery || activeTagId) && (
        <div className="px-3 py-2 text-xs text-gray-500 bg-white rounded-lg shadow-sm flex items-center justify-between">
          <span>共 {filtered.length} 条</span>
          <button onClick={resetFilters} className="text-[#0077B6] hover:underline">
            清除筛选
          </button>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-lg shadow-sm text-gray-400 text-sm">
          {notes.length === 0 ? '还没有笔记，从上方写下第一条' : '没有匹配的笔记'}
        </div>
      ) : (
        filtered.map((n) => (
          <NoteRow
            key={n.id}
            note={n}
            active={activeId === n.id}
            onClick={() => onSelect(n.id)}
            onToggleStatus={(e) => handleToggleStatus(e, n)}
            onEdit={(e) => handleEdit(e, n)}
            onDelete={(e) => handleDelete(e, n)}
            onTagClick={onTagClick}
            tagByName={tagByName}
            tagIds={linkMap.get(n.id) || []}
          />
        ))
      )}
    </section>
  )
}

const NoteRow = ({
  note,
  active,
  onClick,
  onToggleStatus,
  onEdit,
  onDelete,
  onTagClick,
  tagByName,
  tagIds,
}) => (
  <div
    onClick={onClick}
    className={`group relative bg-white rounded-lg shadow-sm px-4 py-3 cursor-pointer transition-colors border ${
      active ? 'border-[#0077B6]' : 'border-transparent hover:border-gray-200'
    }`}
  >
    <div
      className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${
        note.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800'
      }`}
    >
      {renderContentWithTags(note.content, tagByName, onTagClick)}
    </div>
    <div className="flex items-end justify-between mt-3">
      <span className="text-xs text-gray-400">{formatTime(note.created_at)}</span>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onToggleStatus}
          className="text-gray-400 hover:text-[#0077B6] transition-colors"
          aria-label="切换状态"
          title="切换状态"
        >
          {note.status === 'completed' ? (
            <CheckCircle2 size={16} className="text-green-500" />
          ) : (
            <Circle size={16} />
          )}
        </button>
        <button
          onClick={onEdit}
          className="text-gray-400 hover:text-[#0077B6] transition-colors"
          aria-label="编辑"
          title="编辑（下一步实现）"
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={onDelete}
          className="text-gray-400 hover:text-red-500 transition-colors"
          aria-label="删除"
          title="删除"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  </div>
)

/**
 * 渲染内容，tag chip 保留在原文位置（不脱出来）
 * @param {string} content 原文
 * @param {Map<string, {color: string}>} tagByName 名字→tag 实体映射
 * @param {(e, tagId) => void} onTagClick chip 点击回调
 */
const renderContentWithTags = (content, tagByName, onTagClick) => {
  const parts = []
  let lastIndex = 0
  let match
  TAG_RE.lastIndex = 0
  while ((match = TAG_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>)
    }
    const name = match[1]
    const tag = tagByName.get(name)
    const color = tag?.color || '#9CA3AF'
    parts.push(
      <button
        key={`tag-${match.index}`}
        onClick={(e) => {
          e.stopPropagation()
          if (tag) onTagClick?.(e, tag.id)
        }}
        className="inline-flex items-center text-xs px-1.5 py-0.5 rounded mx-0.5 transition-colors hover:opacity-80"
        style={{ background: `${color}20`, color }}
        title={tag ? `筛选 #${name}` : `#${name}（本地无实体）`}
      >
        #{name}
      </button>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) {
    parts.push(<span key="t-end">{content.slice(lastIndex)}</span>)
  }
  return parts
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
