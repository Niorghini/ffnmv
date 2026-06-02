/**
 * SearchBar —— v0.7.0 风格搜索框
 * - 浅灰底 bg-bg-main + 圆角
 * - placeholder 颜色 #9ba1a6
 */
import { Search, X } from 'lucide-react'

const SearchBar = ({ value, onChange, placeholder = '搜索笔记...' }) => (
  <div className="flex items-center gap-2 px-3 py-2 bg-bg-main rounded-lg">
    <Search size={14} className="text-gray-400" />
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
        className="text-gray-400 hover:text-gray-600 transition-colors"
      >
        <X size={14} />
      </button>
    )}
  </div>
)

export default SearchBar
