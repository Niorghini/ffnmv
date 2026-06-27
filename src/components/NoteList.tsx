/**
 * NoteList —— 笔记卡片列表
 * - 卡片样式: 内容(带 tag inline 在原位置) + 时间 + hover 揭示图标
 * - 状态过滤 + 标签过滤 + 搜索过滤
 * - 行内 tag chip 可点击筛选
 * - **就地编辑**：点 Pencil → 卡片内出 textarea + 保存/取消
 * - 整页自然滚动
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { CheckCircle2, Circle, Trash2, Pencil, X as XIcon } from 'lucide-react'
import { useNotesStore } from '@/stores/useNotesStore'
import { useTagsStore } from '@/stores/useTagsStore'
import { notesRepo } from '@/repositories/notesRepo'
import { extractTagNames } from '@/lib/tags'
import { db } from '@/lib/db'
import { useIntersectionVisible } from '@/hooks/useIntersectionVisible'
import { enqueue } from '@/lib/imageDownloadQueue'
import type { Note, Tag } from '@/types'
import NoteImage from './NoteImage'
import Lightbox from './Lightbox'

const TAG_RE = /#([\w一-鿿-]+)/g

export interface NoteListProps {
  activeId: string | null
  onSelect: (id: string) => void
  onTagClick?: (e: MouseEvent, tagId: string) => void
}

const NoteList = ({ activeId, onSelect, onTagClick }: NoteListProps) => {
  const { notes, statusFilter, searchQuery, activeTagId, load, resetFilters } = useNotesStore()
  const { tags, load: loadTags } = useTagsStore()
  // 当前在「就地编辑」的笔记 id
  const [editingId, setEditingId] = useState<string | null>(null)
  // lightbox 显示哪条 note
  const [lightboxNoteId, setLightboxNoteId] = useState<string | null>(null)

  useEffect(() => {
    void load()
    void loadTags()
  }, [load, loadTags])

  const filtered = useMemo(() => {
    return notes
      .filter((n) => {
        if (statusFilter !== 'all' && n.status !== statusFilter) return false
        if (searchQuery && !n.content.toLowerCase().includes(searchQuery.toLowerCase())) return false
        return true
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [notes, statusFilter, searchQuery])

  const [linkMap, setLinkMap] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    let cancelled = false
    const loadLinks = async () => {
      const links = await db.note_tags.filter((l) => !l.deleted_at).toArray()
      if (cancelled) return
      const map = new Map<string, string[]>()
      for (const l of links) {
        const arr = map.get(l.note_id) ?? []
        arr.push(l.tag_id)
        map.set(l.note_id, arr)
      }
      setLinkMap(map)
    }
    void loadLinks()
    const handler = (): void => void loadLinks()
    window.addEventListener('data-updated', handler)
    return (): void => {
      cancelled = true
      window.removeEventListener('data-updated', handler)
    }
  }, [notes, tags])

  const handleToggleStatus = async (e: MouseEvent, n: Note) => {
    e.stopPropagation()
    if (editingId === n.id) return
    const next = n.status === 'completed' ? 'pending' : 'completed'
    await notesRepo.setStatus(n.id, next)
  }

  const handleDelete = async (e: MouseEvent, n: Note) => {
    e.stopPropagation()
    if (editingId === n.id) return
    if (!confirm('确定删除？30 天内可在回收站恢复。')) return
    await notesRepo.softDelete(n.id)
  }

  const handleEdit = (e: MouseEvent, n: Note) => {
    e.stopPropagation()
    onSelect(n.id)
    setEditingId(n.id)
  }

  const handleSave = async (n: Note, newContent: string) => {
    const trimmed = newContent.trim()
    if (!trimmed) {
      alert('内容不能为空')
      return
    }
    try {
      // 一次性更新：内容 + tag 关联同步（在 update 内部完成）
      await notesRepo.update(n.id, { content: newContent })
      setEditingId(null)
    } catch (e) {
      alert('保存失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handleCancel = (_n: Note, originalContent: string, currentContent: string) => {
    if (currentContent !== originalContent) {
      if (!confirm('有未保存的修改，确定取消？')) return
    }
    setEditingId(null)
  }

  const tagByName = useMemo(() => {
    const m = new Map<string, Tag>()
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
            editing={editingId === n.id}
            onClick={() => onSelect(n.id)}
            onImageClick={() => setLightboxNoteId(n.id)}
            onToggleStatus={(e) => handleToggleStatus(e, n)}
            onEdit={(e) => handleEdit(e, n)}
            onDelete={(e) => handleDelete(e, n)}
            onSave={(content) => handleSave(n, content)}
            onCancel={(original, current) => handleCancel(n, original, current)}
            onTagClick={onTagClick}
            tagByName={tagByName}
            tagIds={linkMap.get(n.id) || []}
          />
        ))
      )}
      {lightboxNoteId && (() => {
        const n = notes.find((x) => x.id === lightboxNoteId)
        return n ? <Lightbox note={n} onClose={() => setLightboxNoteId(null)} /> : null
      })()}
    </section>
  )
}

interface NoteRowProps {
  note: Note
  active: boolean
  editing: boolean
  onClick: () => void
  onImageClick: () => void
  onToggleStatus: (e: MouseEvent) => void
  onEdit: (e: MouseEvent) => void
  onDelete: (e: MouseEvent) => void
  onSave: (content: string) => Promise<void> | void
  onCancel: (original: string, current: string) => void
  onTagClick?: (e: MouseEvent, tagId: string) => void
  tagByName: Map<string, Tag>
  tagIds: string[]
}

const NoteRow = ({
  note,
  active,
  editing,
  onClick,
  onImageClick,
  onToggleStatus,
  onEdit,
  onDelete,
  onSave,
  onCancel,
  onTagClick,
  tagByName,
  tagIds: _tagIds,
}: NoteRowProps) => {
  if (editing) {
    return (
      <NoteRowEditor
        note={note}
        onSave={onSave}
        onCancel={onCancel}
        tagByName={tagByName}
      />
    )
  }
  return (
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
      {note.image_size != null && (
        <div className="mt-2">
          <NoteRowImage note={note} onImageClick={onImageClick} />
        </div>
      )}
      <div className="flex items-end justify-between mt-3">
        <span className="text-xs text-gray-400">{formatTime(note.created_at)}</span>
        <div className="note-row-actions flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
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
            title="编辑"
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
}

/**
 * 就地编辑模式 —— 卡片内嵌入 textarea + 保存/取消
 */
interface NoteRowEditorProps {
  note: Note
  onSave: (content: string) => Promise<void> | void
  onCancel: (original: string, current: string) => void
  tagByName: Map<string, Tag>
}

const NoteRowEditor = ({ note, onSave, onCancel, tagByName: _tagByName }: NoteRowEditorProps) => {
  const [content, setContent] = useState(note.content)
  const [saving, setSaving] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
    // 光标移到末尾
    const ta = taRef.current
    if (ta) {
      const len = ta.value.length
      ta.setSelectionRange(len, len)
    }
  }, [])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(content)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    onCancel(note.content, content)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void handleSave()
    }
  }

  const tags = extractTagNames(content)

  return (
    <div className="bg-white rounded-lg shadow-sm px-4 py-3 border border-[#0077B6]">
      <textarea
        ref={taRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKey}
        onClick={(e) => e.stopPropagation()}
        rows={Math.min(20, Math.max(3, content.split('\n').length))}
        className="w-full resize-none outline-none text-sm leading-relaxed whitespace-pre-wrap break-words border-0 p-0 bg-transparent placeholder:text-gray-400 focus:ring-0 max-h-[30rem] overflow-y-auto"
      />
      <div className="flex flex-wrap gap-1 mt-2 min-h-[20px]">
        {tags.map((t) => {
          return (
            <span
              key={t}
              className="text-xs px-2 py-0.5 rounded-full font-medium bg-tag-bg text-tag"
            >
              #{t}
            </span>
          )
        })}
      </div>
      <div className="flex items-end justify-between mt-3">
        <span className="text-xs text-gray-400">{content.length} 字</span>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); handleCancel() }}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <XIcon size={12} />
            取消
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); void handleSave() }}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#0077B6] text-white rounded-lg hover:bg-[#005f8c] disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 size={12} />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 列表场景的 NoteImage 包装
 * - 默认用 thumb-sm(256px,列表场景最适合)
 * - 接 IntersectionObserver:进入视口把 queue priority 提到 'visible',离开 1s 降级回 'prefetch'
 */
const NoteRowImage = ({ note, onImageClick }: { note: Note; onImageClick: () => void }) => {
  const { ref, visible, hasBeenVisible } = useIntersectionVisible<HTMLDivElement>({
    rootMargin: '200px',
  })
  const lastPriority = useRef<'visible' | 'prefetch' | null>(null)
  const downgradedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!hasBeenVisible) return
    if (!note.image_path || !note.image_mime) return
    // 进入视口:提 visible
    if (visible) {
      if (downgradedTimer.current) {
        clearTimeout(downgradedTimer.current)
        downgradedTimer.current = null
      }
      if (lastPriority.current !== 'visible') {
        lastPriority.current = 'visible'
        enqueue({
          source: {
            noteId: note.id,
            imagePath: note.image_path!,
            thumbPath: note.image_thumb_path,
            thumbSmPath: note.image_thumb_sm_path,
            mime: note.image_mime ?? 'image/jpeg',
          },
          priority: 'visible',
        })
      }
    } else {
      // 离开视口:1s 后降级到 prefetch(避免快速滚过反复触发)
      if (lastPriority.current === 'visible') {
        if (downgradedTimer.current) clearTimeout(downgradedTimer.current)
        downgradedTimer.current = setTimeout(() => {
          lastPriority.current = 'prefetch'
          enqueue({
            source: {
              noteId: note.id,
              imagePath: note.image_path!,
              thumbPath: note.image_thumb_path,
              thumbSmPath: note.image_thumb_sm_path,
              mime: note.image_mime ?? 'image/jpeg',
            },
            priority: 'prefetch',
          })
        }, 1000)
      }
    }
  }, [visible, hasBeenVisible, note.id, note.image_path, note.image_thumb_path, note.image_thumb_sm_path, note.image_mime])

  useEffect(() => {
    return () => {
      if (downgradedTimer.current) clearTimeout(downgradedTimer.current)
    }
  }, [])

  return (
    <div ref={ref}>
      <NoteImage note={note} variant="thumb-sm" onImageClick={onImageClick} />
    </div>
  )
}

/**
 * 渲染内容，tag chip 保留在原文位置（不脱出来）
 */
const renderContentWithTags = (
  content: string,
  tagByName: Map<string, Tag>,
  onTagClick?: (e: MouseEvent, tagId: string) => void,
) => {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((match = TAG_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>)
    }
    const name = match[1]
    const tag = tagByName.get(name)
    parts.push(
      <button
        key={`tag-${match.index}`}
        onClick={(e) => {
          e.stopPropagation()
          if (tag && onTagClick) onTagClick(e, tag.id)
        }}
        className="inline-flex items-center text-xs px-2 py-0.5 mx-px rounded-full font-medium bg-tag-bg text-tag transition-colors hover:bg-tag-bg-hover"
        title={tag ? `筛选 #${name}` : `#${name}（本地无实体）`}
      >
        #{name}
      </button>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) {
    parts.push(<span key="t-end">{content.slice(lastIndex)}</span>)
  }
  return parts
}

const formatTime = (iso: string): string => {
  const d = new Date(iso)
  const now = new Date()
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours()}:${mm}`
  }
  if (d.getFullYear() !== now.getFullYear()) {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
  }
  return `${d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${hh}:${mm}`
}

export default NoteList