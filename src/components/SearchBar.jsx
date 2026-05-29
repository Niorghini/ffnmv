import React, { useState } from 'react'
import { Search, X } from 'lucide-react'
import { useMemos } from '../hooks/useMemos'

export default function SearchBar() {
  const { search, searchQuery } = useMemos()
  const [localQuery, setLocalQuery] = useState(searchQuery)

  const handleSubmit = (e) => {
    e.preventDefault()
    search(localQuery)
  }

  const handleClear = () => {
    setLocalQuery('')
    search('')
  }

  const handleChange = (e) => {
    setLocalQuery(e.target.value)
  }

  const handleBlur = () => {
    if (localQuery) search(localQuery)
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <Search
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
      />
      <input
        type="text"
        value={localQuery}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="搜索想法..."
        className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20 transition-all"
      />
      {localQuery && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      )}
    </form>
  )
}