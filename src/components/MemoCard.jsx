import React, { useState, useRef, useEffect } from 'react'
import { Edit2, Trash2, Check, X, Hash, CheckCircle2, Circle, Image, ZoomIn } from 'lucide-react'
import { useMemos } from '../hooks/useMemos'
import { parseTags } from '../utils/db'

export default function MemoCard({ memo }) {
  const { editMemo, removeMemo, toggleMemoStatus, filterByTag } = useMemos()
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(memo.content)
  const [lightboxImage, setLightboxImage] = useState(null)
  const editTextareaRef = useRef(null)
  const MAX_LINES = 20
  const LINE_HEIGHT = 28
  const EDIT_MIN_ROWS = 4

  const isProcessed = memo.status === 'processed'
  const images = memo.images || []

  const handleSave = async () => {
    if (!editContent.trim()) return
    await editMemo(memo.id, editContent)
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditContent(memo.content)
    setIsEditing(false)
  }

  const handleDelete = async () => {
    if (confirm('确定删除这条记录？')) {
      await removeMemo(memo.id)
    }
  }

  const handleToggleStatus = async () => {
    await toggleMemoStatus(memo.id)
  }

  const formatDate = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now - date

    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    if (diff < 172800000) return '昨天'

    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const adjustEditHeight = () => {
    const ta = editTextareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const minHeight = EDIT_MIN_ROWS * LINE_HEIGHT
    const maxHeight = MAX_LINES * LINE_HEIGHT
    const scrollHeight = ta.scrollHeight
    if (scrollHeight > maxHeight) {
      ta.style.height = maxHeight + 'px'
      ta.style.overflowY = 'auto'
    } else {
      ta.style.height = Math.max(scrollHeight, minHeight) + 'px'
      ta.style.overflowY = 'hidden'
    }
  }

  useEffect(() => {
    if (isEditing) {
      setEditContent(memo.content)
      setTimeout(() => adjustEditHeight(), 50)
    }
  }, [isEditing])

  const renderContent = (text) => {
    const parts = text.split(/(#[\w一-龥-]+)/g)

    return parts.map((part, i) => {
      if (part.match(/^#[\w一-龥-]+$/)) {
        return (
          <span
            key={i}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-sm rounded-full cursor-pointer transition-colors ${isProcessed ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-[#0077B6] hover:bg-blue-100'}`}
            onClick={(e) => {
              e.stopPropagation()
              filterByTag(part)
            }}
          >
            <Hash size={10} />
            {part.slice(1)}
          </span>
        )
      }
      return <span key={i} className={isProcessed ? 'line-through text-gray-400' : 'text-gray-800'}>{part}</span>
    })
  }

  return (
    <>
      <div className={`bg-white rounded-2xl p-4 shadow-sm border transition-all duration-200 group hover:shadow-md ${isProcessed ? 'border-gray-200 opacity-70' : 'border-gray-100'} ${memo.isFading ? 'opacity-0 scale-95 transition-all duration-700' : ''}`}>
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              ref={editTextareaRef}
              value={editContent}
              onChange={(e) => { setEditContent(e.target.value); adjustEditHeight() }}
              className="w-full resize-none border border-[#0077B6] rounded-xl p-3 text-gray-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30"
              style={{ outline: 'none', height: 'auto', overflowY: 'hidden' }}
              rows={4}
              autoFocus
            />
            <div className="flex items-center justify-between gap-2">
              {(() => {
                const tags = parseTags(editContent)
                if (tags.length > 0) {
                  return (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-[#0077B6] text-xs rounded-lg">
                          <Hash size={10} />
                          {tag.slice(1)}
                        </span>
                      ))}
                    </div>
                  )
                }
                return <div />
              })()}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-3 py-1.5 text-gray-500 hover:text-gray-700 text-sm"
                >
                  <X size={14} />
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#0077B6] text-white rounded-lg text-sm hover:bg-[#005f8c]"
                >
                  <Check size={14} />
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 图片展示 */}
            {images.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {images.map((img, i) => (
                  <div
                    key={i}
                    className="relative group/image cursor-pointer"
                    onClick={() => setLightboxImage(img)}
                  >
                    <img
                      src={img}
                      alt=""
                      className="w-20 h-20 object-cover rounded-lg border border-gray-100"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover/image:bg-black/20 rounded-lg flex items-center justify-center transition-colors">
                      <ZoomIn size={16} className="text-white opacity-0 group-hover/image:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 文字内容 */}
            <div className="mb-2">
              <p className="leading-relaxed whitespace-pre-wrap break-words">
                {renderContent(memo.content)}
              </p>
            </div>

            <div className="flex items-center justify-between">
              <span className={`text-xs ${isProcessed ? 'text-green-500' : 'text-gray-400'}`}>{formatDate(memo.createdAt)}</span>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {isProcessed && memo.processedAt && (
                  <span className="text-xs text-green-500">{formatDate(memo.processedAt)}</span>
                )}
                <button
                  onClick={handleToggleStatus}
                  className={`p-1.5 rounded-lg transition-colors ${isProcessed ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:text-green-500 hover:bg-green-50'}`}
                  title={isProcessed ? '标记为未处理' : '标记为已处理'}
                >
                  {isProcessed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-1.5 text-gray-400 hover:text-primary hover:bg-green-50 rounded-lg transition-colors"
                  title="编辑"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Lightbox 预览 */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            onClick={() => setLightboxImage(null)}
          >
            <X size={24} />
          </button>
          <img
            src={lightboxImage}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}