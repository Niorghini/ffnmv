import React, { useEffect, useRef } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import MemoCard from './MemoCard'
import { useMemos } from '../hooks/useMemos'

export default function MemoList() {
  const { memos, selectedTag, searchQuery, clearFilter, isLoading, hasMore, loadMore, totalCount } = useMemos()
  const observerRef = useRef(null)
  const sentinelRef = useRef(null)

  const hasFilter = selectedTag || searchQuery

  // Infinite scroll
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    if (!hasMore || hasFilter) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current)
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [hasMore, isLoading, hasFilter, loadMore])

  return (
    <div className="space-y-3">
      {/* 筛选提示 */}
      {hasFilter && (
        <div className="flex items-center justify-between bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100">
          <span className="text-sm text-gray-500">
            {searchQuery ? (
              <>搜索结果: <span className="text-gray-800 font-medium">"{searchQuery}"</span></>
            ) : selectedTag ? (
              <>标签筛选: <span className="text-[#0077B6] font-medium">{selectedTag}</span></>
            ) : null}
            <span className="text-gray-400 ml-2">({memos.length} 条)</span>
          </span>
          <button
            onClick={clearFilter}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
            清除
          </button>
        </div>
      )}

      {/* 空状态 */}
      {memos.length === 0 && !isLoading ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📝</div>
          <p className="text-gray-400 mb-2">
            {hasFilter ? '没有找到符合条件的记录' : '还没有任何记录'}
          </p>
          <p className="text-sm text-gray-300">
            {hasFilter ? '试试其他关键词或清除筛选' : '在顶部输入框记录你的第一个想法'}
          </p>
        </div>
      ) : (
        <>
          {memos.map((memo) => <MemoCard key={memo.id} memo={memo} />)}

          {/* 加载状态 / 加载更多触发器 */}
          {hasMore && !hasFilter && (
            <div ref={sentinelRef} className="py-4 flex justify-center">
              {isLoading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 size={16} className="animate-spin" />
                  加载中...
                </div>
              ) : (
                <button
                  onClick={loadMore}
                  className="text-sm text-gray-400 hover:text-gray-600"
                >
                  加载更多
                </button>
              )}
            </div>
          )}

          {/* 没有更多了 */}
          {!hasMore && memos.length > 0 && !hasFilter && (
            <div className="py-4 text-center text-sm text-gray-300">
              已显示全部 {totalCount} 条记录
            </div>
          )}
        </>
      )}
    </div>
  )
}