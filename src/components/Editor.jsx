/**
 * M1 临时编辑器：极简版，纯文本输入 + 标签识别 + 创建/更新
 * M5 会重写为正式三栏布局的右栏
 */
import { useEffect, useRef, useState } from 'react'
import { notesRepo } from '@/repositories/notesRepo'
import { tagsRepo } from '@/repositories/tagsRepo'
import { extractTagNames } from '@/lib/tags'

const DEBOUNCE_MS = 300

export default function Editor({ note, onSaved }) {
  const [content, setContent] = useState(note?.content ?? '')
  const [tags, setTags] = useState([])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const debounceRef = useRef(null)
  const tagDebounceRef = useRef(null)

  useEffect(() => {
    setContent(note?.content ?? '')
    setSavedAt(null)
  }, [note?.id])

  // 标签异步识别 + 创建
  useEffect(() => {
    clearTimeout(tagDebounceRef.current)
    tagDebounceRef.current = setTimeout(async () => {
      const names = extractTagNames(content)
      setTags(names)
    }, DEBOUNCE_MS)
    return () => clearTimeout(tagDebounceRef.current)
  }, [content])

  // 笔记存在则 debounce 自动保存；不存在则 Ctrl+Enter 提交
  const scheduleAutoSave = (nextContent) => {
    if (!note?.id) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSaving(true)
      await notesRepo.update(note.id, { content: nextContent })
      setSaving(false)
      setSavedAt(new Date())
      onSaved?.()
    }, DEBOUNCE_MS)
  }

  const handleChange = (e) => {
    const v = e.target.value
    setContent(v)
    scheduleAutoSave(v)
  }

  const handleSubmit = async () => {
    if (!content.trim()) return
    const tagRecords = await tagsRepo.findOrCreate(extractTagNames(content))
    const tagIds = tagRecords.map((t) => t.id)
    const created = await notesRepo.create({ content, tagIds })
    onSaved?.(created)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <textarea
        value={content}
        onChange={handleChange}
        onKeyDown={note ? undefined : handleKeyDown}
        placeholder={note ? '编辑笔记...（自动保存）' : '写下你的想法...（Ctrl+Enter 提交）'}
        className="flex-1 w-full p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-primary text-base"
        rows={6}
      />
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="px-2 py-0.5 bg-gray-100 rounded text-gray-600">
              #{t}
            </span>
          ))}
        </div>
        <div>
          {saving && '保存中...'}
          {!saving && savedAt && `已保存 ${formatTime(savedAt)}`}
          {!saving && !savedAt && !note && (
            <button
              onClick={handleSubmit}
              disabled={!content.trim()}
              className="px-3 py-1 bg-primary text-white rounded disabled:opacity-50"
            >
              创建
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const formatTime = (d) => {
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}
