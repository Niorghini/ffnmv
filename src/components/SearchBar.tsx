/**
 * SearchBar —— 搜索笔记
 * - 默认: 浅灰底 bg-bg-main + 透明边（避免布局抖动）
 * - hover / focus-within: 切到白底 + 蓝边 + 轻阴影（跟 Editor 输入框聚焦态一致）
 * - placeholder 颜色 #9ba1a6
 */
import { Search, X } from 'lucide-react'

export interface SearchBarProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export default function SearchBar({ value, onChange, placeholder = '搜索笔记...' }: SearchBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-bg-main border border-transparent rounded-lg hover:bg-white hover:border-[#0077B6] hover:shadow-sm focus-within:bg-white focus-within:border-[#0077B6] focus-within:shadow-sm transition-colors">
      <Search size={14} className="text-gray-400 shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 outline-none text-sm bg-transparent placeholder:text-gray-400"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
          aria-label="清除"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}