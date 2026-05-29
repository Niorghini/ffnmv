import React, { useState, useRef, useEffect } from 'react'
import { Send, Hash, X, Image, Loader2, Sparkles, ChevronDown, CheckCircle2 } from 'lucide-react'
import { useMemos } from '../hooks/useMemos'
import { compressImageToBase64, isImageFile, validateImageFile } from '../utils/image'
import { getFilteredSuggestions } from '../utils/autoTag'

const MAX_IMAGES = 9
const DRAFT_KEY = 'ffn_draft'

export default function Editor() {
  const { addMemo } = useMemos()
  const [content, setContent] = useState('')
  const [images, setImages] = useState([])
  const [isFocused, setIsFocused] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [suggestedTags, setSuggestedTags] = useState([])
  const [selectedTags, setSelectedTags] = useState([])
  const [isSuggestionExpanded, setIsSuggestionExpanded] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const MAX_LINES = 20
  const LINE_HEIGHT = 28

  // 草稿恢复
  useEffect(() => {
    const draft = localStorage.getItem(DRAFT_KEY)
    const draftImages = localStorage.getItem(DRAFT_KEY + '_images')
    if (draft) {
      setContent(draft)
      setTimeout(() => adjustHeight(), 50)
    }
    if (draftImages) {
      try {
        setImages(JSON.parse(draftImages))
      } catch {}
    }
  }, [])

  // 草稿自动保存
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, content)
    if (images.length > 0) {
      localStorage.setItem(DRAFT_KEY + '_images', JSON.stringify(images))
    } else {
      localStorage.removeItem(DRAFT_KEY + '_images')
    }
  }, [content, images])

  // 自动拉长 textarea
  const adjustHeight = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const scrollHeight = textarea.scrollHeight
    const maxHeight = MAX_LINES * LINE_HEIGHT
    if (scrollHeight > maxHeight) {
      textarea.style.height = maxHeight + 'px'
      textarea.style.overflowY = 'auto'
    } else {
      textarea.style.height = scrollHeight + 'px'
      textarea.style.overflowY = 'hidden'
    }
  }

  useEffect(() => {
    adjustHeight()
  }, [content, images, selectedTags, suggestedTags])

  // 监听内容变化，自动生成标签建议
  useEffect(() => {
    const suggestions = getFilteredSuggestions(content)
    setSuggestedTags(suggestions)
    if (suggestions.length > 0) {
      setIsSuggestionExpanded(true)
    }
  }, [content])

  const handleImageSelect = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) {
      alert(`最多只能添加 ${MAX_IMAGES} 张图片`)
      return
    }

    const toProcess = files.slice(0, remaining)
    const newImages = []

    for (const file of toProcess) {
      if (!isImageFile(file)) {
        alert('请选择图片文件')
        continue
      }
      const validation = validateImageFile(file)
      if (!validation.valid) {
        alert(validation.error)
        continue
      }

      try {
        const base64 = await compressImageToBase64(file)
        newImages.push(base64)
      } catch (err) {
        console.error('Failed to compress image:', err)
        alert('图片处理失败')
      }
    }

    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages])
    }

    e.target.value = ''
  }

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  const toggleSuggestedTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const handleSubmit = async () => {
    if (!content.trim() && images.length === 0) return
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      let finalContent = content
      selectedTags.forEach(tag => {
        if (!content.includes(`#${tag}`)) {
          finalContent += ` #${tag}`
        }
      })
      await addMemo(finalContent, images)

      localStorage.removeItem(DRAFT_KEY)
      localStorage.removeItem(DRAFT_KEY + '_images')

      setContent('')
      setImages([])
      setSelectedTags([])
      setSuggestedTags([])

      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 1500)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  const canSubmit = (content.trim() || images.length > 0) && !isSubmitting
  const charCount = content.length
  const inlineTags = content.match(/#[\w一-龥-]+/g) || []
  const unselectedSuggestions = suggestedTags.filter(t => !selectedTags.includes(t))

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border transition-all duration-200 ${isFocused ? 'border-[#0077B6] shadow-md' : 'border-gray-100'}`}
    >
      {/* 输入区域 */}
      <div className="p-4">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => { setContent(e.target.value); adjustHeight() }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="记录想法...（#标签 格式添加标签，Ctrl+Enter 发送）"
            rows={2}
            className="w-full resize-none border-0 focus:ring-0 text-base leading-relaxed text-gray-800 placeholder-gray-400 p-0"
            style={{ outline: 'none', height: 'auto', overflowY: 'hidden' }}
          />
        </div>

        {/* 图片预览 */}
        {images.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-100" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 标签建议 */}
      {suggestedTags.length > 0 && (
        <div className="px-4 pb-2 min-h-[32px] flex items-center">
          {isSuggestionExpanded ? (
            <div className="flex items-center gap-2 text-sm text-[#0077B6] w-full">
              <button
                onClick={() => setIsSuggestionExpanded(false)}
                className="flex items-center gap-1.5 text-[#0077B6] hover:text-[#005f8c]"
              >
                <Sparkles size={14} />
                <span>建议标签：</span>
              </button>
              <div className="flex flex-wrap gap-2">
                {selectedTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => toggleSuggestedTag(tag)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0077B6] text-white text-xs rounded-lg"
                  >
                    <Hash size={10} />
                    {tag}
                    <X size={10} />
                  </button>
                ))}
                {unselectedSuggestions.map(tag => (
                  <button
                    key={tag}
                    onClick={() => toggleSuggestedTag(tag)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-[#0077B6] text-xs rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <Hash size={10} />
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center w-full">
              <button
                onClick={() => setIsSuggestionExpanded(true)}
                className="text-gray-400 hover:text-gray-600"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 底部工具栏 */}
      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={images.length >= MAX_IMAGES}
            className={`flex items-center gap-1 ${images.length >= MAX_IMAGES ? 'opacity-40 cursor-not-allowed' : 'hover:text-[#0077B6]'}`}
            title={`添加图片（最多 ${MAX_IMAGES} 张）`}
          >
            <Image size={14} />
            <span>图片 {images.length}/{MAX_IMAGES}</span>
          </button>
        </div>

        {/* 字数统计 + 发送按钮 */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-300">{charCount} 字</span>
          {showSuccess ? (
            <div className="flex items-center gap-1.5 px-4 py-2 bg-green-50 text-green-600 rounded-xl text-sm font-medium">
              <CheckCircle2 size={16} />
              已发送
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium transition-all duration-200 ${canSubmit ? 'bg-[#0077B6] hover:bg-[#005f8c] active:scale-95' : 'bg-gray-200 cursor-not-allowed'}`}
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              发送
            </button>
          )}
        </div>
      </div>

      {/* 标签预览（手动输入的标签） */}
      {inlineTags.length > 0 && (
        <div className="px-4 pb-3">
          <div className="flex flex-wrap gap-2">
            {inlineTags.map((tag, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-[#0077B6] text-xs rounded-lg">
                <Hash size={12} />
                {tag.slice(1)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}