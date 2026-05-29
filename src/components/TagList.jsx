import React, { useState, useMemo } from 'react'
import { Hash, Tag, ArrowUpDown, Search, X } from 'lucide-react'
import { useMemos } from '../hooks/useMemos'

const SORT_OPTIONS = [
  { key: 'count', label: '按数量' },
  { key: 'recent', label: '按时间' },
  { key: 'name', label: '按名称' },
]

export default function TagList() {
  const { tags, selectedTag, filterByTag } = useMemos()
  const [sortBy, setSortBy] = useState('count')
  const [sortDir, setSortDir] = useState('desc')
  const [search, setSearch] = useState('')

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    let list = [...tags]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t => t.tag.toLowerCase().includes(q))
    }
    if (sortBy === 'count') {
      list.sort((a, b) => sortDir === 'desc' ? b.count - a.count : a.count - b.count)
    } else if (sortBy === 'recent') {
      list.sort((a, b) => sortDir === 'desc'
        ? (b.lastAt || '').localeCompare(a.lastAt || '')
        : (a.lastAt || '').localeCompare(b.lastAt || ''))
    } else if (sortBy === 'name') {
      list.sort((a, b) => sortDir === 'desc'
        ? b.tag.slice(1).localeCompare(a.tag.slice(1))
        : a.tag.slice(1).localeCompare(b.tag.slice(1)))
    }
    return list
  }, [tags, sortBy, sortDir, search])

  if (tags.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <h3 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
          <Tag size={16} className="text-gray-400" />
          标签
        </h3>
        <p className="text-sm text-gray-400 text-center py-4">
          使用 #标签 记录想法
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-800 flex items-center gap-2">
          <Tag size={16} className="text-gray-400" />
          标签
        </h3>
        <span className="text-xs text-gray-400">{tags.length} 个</span>
      </div>

      {/* 搜索框 */}
      <div className="relative mb-3">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索标签"
          className="w-full pl-7 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#0077B6]"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* 排序选择 */}
      <div className="flex items-center gap-1.5 mb-3">
        <ArrowUpDown size={12} className="text-gray-400" />
        <div className="flex gap-1">
          {SORT_OPTIONS.map(opt => {
            const isActive = sortBy === opt.key
            const isDesc = sortDir === 'desc'
            return (
              <button
                key={opt.key}
                onClick={() => handleSort(opt.key)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md transition-colors ${
                  isActive
                    ? 'bg-[#0077B6] text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {opt.label}
                {isActive && (
                  <span className="text-[10px] font-bold">{isDesc ? '↓' : '↑'}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* 标签列表 */}
      {sorted.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {sorted.map(({ tag, count }) => (
            <button
              key={tag}
              onClick={() => filterByTag(tag)}
              className={`
                inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm transition-all
                ${selectedTag === tag
                  ? 'bg-[#0077B6] text-white'
                  : 'bg-blue-50 text-[#0077B6] hover:bg-blue-100'
                }
              `}
            >
              <Hash size={12} />
              <span>{tag.slice(1)}</span>
              <span className={`
                text-xs ml-1
                ${selectedTag === tag ? 'text-white/70' : 'text-gray-400'}
              `}>
                {count}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-3">没有找到匹配的标签</p>
      )}
    </div>
  )
}