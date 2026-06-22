/**
 * Editor —— 圆角描边卡片 + focus 蓝边 + 实时字数 + 发布按钮
 * - 位于左栏顶部
 * - 新建：placeholder 提示 + Ctrl+Enter / 点发布按钮提交
 * - 编辑：300ms debounce 自动保存 + 小状态提示
 * - 标签识别 + chip 预览
 */
import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { notesRepo } from '@/repositories/notesRepo'
import { tagsRepo } from '@/repositories/tagsRepo'
import { extractTagNames } from '@/lib/tags'
import type { Note } from '@/types'

const DEBOUNCE_MS = 300
const MAX_CHARS = 10000 // PRD 3.2.1：content 最大 10000 字符

export interface EditorProps {
  note?: Note
  onSaved?: () => void
  onCancel?: () => void
}

const Editor = ({ note, onSaved, onCancel: _onCancel }: EditorProps) => {
  const [content, setContent] = useState(note?.content ?? '')
  const [tags, setTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [focused, setFocused] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setContent(note?.content ?? '')
    setSavedAt(null)
  }, [note?.id])

  useEffect(() => {
    setTags(extractTagNames(content))
  }, [content])

  const scheduleAutoSave = (next: string) => {
    if (!note?.id) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setContent(v)
    if (note?.id) scheduleAutoSave(v)
  }

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed) return
    const tagRecords = await tagsRepo.findOrCreate(extractTagNames(content))
    await notesRepo.create({ content, tagIds: tagRecords.map((t) => t.id) })
    setContent('')
    onSaved?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!note && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const charCount = content.length
  const canSend = !note && content.trim().length > 0 && charCount <= MAX_CHARS
  const overLimit = charCount > MAX_CHARS

  // 编辑模式：底部状态行
  const statusLine = note
    ? saving
      ? '保存中...'
      : savedAt
      ? `已保存 ${formatTime(savedAt)}`
      : ''
    : ''

  return (
    <section
      className={`bg-white rounded-lg border transition-colors p-4 ${
        focused ? 'border-[#0077B6] shadow-sm' : 'border-gray-200'
      } ${overLimit ? 'border-red-500' : ''}`}
    >
      <textarea
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={
          note
            ? '编辑内容...'
            : '记录想法... （#标签 格式添加标签，Ctrl+Enter 发布）'
        }
        maxLength={note ? undefined : MAX_CHARS}
        rows={Math.min(20, Math.max(3, content.split('\n').length))}
        className="w-full resize-none outline-none text-base leading-relaxed placeholder:text-[#9ba1a6] focus:ring-0 border-0 bg-transparent max-h-[40rem] overflow-y-auto"
        autoFocus={!note}
      />
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 gap-2">
        <div className="flex flex-wrap gap-1 min-h-[20px] flex-1 min-w-0">
          {tags.map((t) => (
            <span
              key={t}
              className="text-xs px-2 py-px leading-none rounded-full font-medium bg-tag-bg text-tag"
            >
              #{t}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {note && statusLine && (
            <span className="text-[10px] text-gray-400">{statusLine}</span>
          )}
          {!note && (
            <>
              <span
                className={`text-xs tabular-nums ${
                  overLimit ? 'text-red-500' : 'text-gray-400'
                }`}
              >
                {charCount} 字
              </span>
              <button
                onClick={() => void handleSubmit()}
                disabled={!canSend}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#0077B6] text-white text-sm rounded-md hover:bg-[#005f8c] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={14} />
                发布
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

const formatTime = (d: Date | string): string => {
  const x = typeof d === 'string' ? new Date(d) : d
  const h = x.getHours().toString().padStart(2, '0')
  const m = x.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

export default Editor