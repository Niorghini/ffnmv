/**
 * M1 临时笔记列表：极简版，纯列表 + 状态切换 + 软删
 * M5 会重写为三栏中栏 + 虚拟滚动
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Trash2 } from 'lucide-react'
import { notesRepo } from '@/repositories/notesRepo'

export default function NoteList({ activeId, onSelect, refreshKey }) {
  const [notes, setNotes] = useState([])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const all = await notesRepo.getAll()
      if (mounted) setNotes(all)
    }
    load()
    const handler = () => load()
    window.addEventListener('data-updated', handler)
    return () => {
      mounted = false
      window.removeEventListener('data-updated', handler)
    }
  }, [refreshKey])

  const handleToggleStatus = async (e, n) => {
    e.stopPropagation()
    const next = n.status === 'completed' ? 'pending' : 'completed'
    await notesRepo.setStatus(n.id, next)
    window.dispatchEvent(new CustomEvent('data-updated'))
  }

  const handleDelete = async (e, n) => {
    e.stopPropagation()
    if (!confirm('确定删除？')) return
    await notesRepo.softDelete(n.id)
    window.dispatchEvent(new CustomEvent('data-updated'))
  }

  return (
    <div className="overflow-y-auto h-full">
      {notes.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">还没有笔记，从右侧编辑器开始</div>
      ) : (
        notes.map((n) => (
          <div
            key={n.id}
            onClick={() => onSelect(n.id)}
            className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
              activeId === n.id ? 'bg-primary/5' : ''
            }`}
          >
            <div className="flex items-start gap-2">
              <button
                onClick={(e) => handleToggleStatus(e, n)}
                className="mt-0.5 text-gray-400 hover:text-primary"
                aria-label="切换状态"
              >
                {n.status === 'completed' ? (
                  <CheckCircle2 size={18} className="text-primary" />
                ) : (
                  <Circle size={18} />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm whitespace-pre-wrap break-words ${
                    n.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800'
                  }`}
                >
                  {n.content.slice(0, 80)}
                </div>
                <div className="text-xs text-gray-400 mt-1">{formatTime(n.created_at)}</div>
              </div>
              <button
                onClick={(e) => handleDelete(e, n)}
                className="text-gray-300 hover:text-danger"
                aria-label="删除"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))
      )}
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
