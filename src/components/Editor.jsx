/**
 * Editor —— v0.7.0 风格单列编辑器
 * - 位于左栏顶部
 * - 新建：placeholder 提示 + Ctrl+Enter 提交
 * - 编辑：300ms debounce 自动保存 + 小状态提示
 * - 标签识别 + chip 预览
 */
import { useEffect, useRef, useState } from 'react'
import { notesRepo } from '@/repositories/notesRepo'
import { tagsRepo } from '@/repositories/tagsRepo'
import { extractTagNames } from '@/lib/tags'

const DEBOUNCE_MS = 300

const Editor = ({ note, onSaved, onCancel }) => {
  const [content, setContent] = useState(note?.content ?? '')
  const [tags, setTags] = useState([])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    setContent(note?.content ?? '')
    setSavedAt(null)
  }, [note?.id])

  useEffect(() => {
    setTags(extractTagNames(content))
  }, [content])

  const scheduleAutoSave = (next) => {
    if (!note?.id) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        await notesRepo.update(note.id, { content: next })
        setSavedAt(new Date())
        onSaved?.()
      } finally {
        setSaving(false)
      }
    }, DEBOUNCE_MS)
  }

  const handleChange = (e) => {
    const v = e.target.value
    setContent(v)
    if (note?.id) scheduleAutoSave(v)
  }

  const handleSubmit = async () => {
    if (!content.trim()) return
    const tagRecords = await tagsRepo.findOrCreate(extractTagNames(content))
    await notesRepo.create({ content, tagIds: tagRecords.map((t) => t.id) })
    setContent('')
    onSaved?.()
  }

  const handleKeyDown = (e) => {
    if (!note && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const statusLine = note
    ? saving
      ? '保存中...'
      : savedAt
      ? `已保存 ${formatTime(savedAt)}`
      : ''
    : content
    ? 'Ctrl+Enter 提交'
    : ''

  return (
    <section className="bg-white rounded-lg shadow-sm p-4">
      <textarea
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={note ? '编辑内容...' : '写下你的想法...（Ctrl+Enter 提交）'}
        className="w-full resize-none outline-none text-base leading-relaxed placeholder:text-[#9ba1a6] focus:ring-0 border-0"
        rows={4}
        autoFocus={!note}
      />
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <div className="flex flex-wrap gap-1 min-h-[20px]">
          {tags.map((t) => (
            <span
              key={t}
              className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-[#0077B6] rounded"
            >
              #{t}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          {statusLine}
          {!note && content.trim() && (
            <button
              onClick={handleSubmit}
              className="ml-2 px-2 py-0.5 text-xs bg-[#0077B6] text-white rounded hover:bg-[#005f8c] transition-colors"
            >
              提交
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

const formatTime = (d) => {
  const x = typeof d === 'string' ? new Date(d) : d
  const h = x.getHours().toString().padStart(2, '0')
  const m = x.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

export default Editor
