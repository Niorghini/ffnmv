import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  getAllMemos,
  getAllTags,
  searchMemos,
  getHeatmapData,
  getStats,
  getMemosCount,
  getFilteredMemos,
  createMemo as dbCreateMemo,
  updateMemo as dbUpdateMemo,
  deleteMemo as dbDeleteMemo,
  updateMemoStatus,
  batchUpdateMemoStatus,
  getStatusStats,
  getStorageEstimate,
  exportAllMemos,
  importMemos,
  triggerCloudAuth,
  syncCloudData,
  getCloudUser,
} from '../utils/db'

const MemosContext = createContext(null)
const MIGRATION_KEY = 'ffn_migration_v1'
const LEGACY_KEY = 'ffn_memos'

const PAGE_SIZE = 50

// 从 localStorage 读取旧数据
const getLegacyMemos = () => {
  try {
    const data = localStorage.getItem(LEGACY_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

// 检查是否需要迁移
const needsMigration = () => {
  const migrated = localStorage.getItem(MIGRATION_KEY)
  const hasLegacy = localStorage.getItem(LEGACY_KEY)
  return !migrated && hasLegacy
}

export function MemosProvider({ children }) {
  const [memos, setMemos] = useState([])
  const [tags, setTags] = useState([])
  const [heatmapData, setHeatmapData] = useState({})
  const [selectedTag, setSelectedTag] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [stats, setStats] = useState({ total: 0, today: 0, thisMonth: 0 })
  const [storageInfo, setStorageInfo] = useState({ used: 0, quota: 0, percentage: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [isMigrating, setIsMigrating] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState({ current: 0, total: 0 })
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'unprocessed' | 'processed'
  const [statusStats, setStatusStats] = useState({ processed: 0, unprocessed: 0 })
  const [isSyncing, setIsSyncing] = useState(false)

  // 监听云端登录，自动同步数据
  useEffect(() => {
    const user = getCloudUser()
    const subscription = user.subscribe(async (u) => {
      if (u && u.userId && u.isLoggedIn && !u.isLoading) {
        setIsSyncing(true)
        await loadInitialData()
        setIsSyncing(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // 迁移旧数据
  const migrateLegacyData = useCallback(async () => {
    const legacy = getLegacyMemos()
    if (legacy.length === 0) {
      localStorage.setItem(MIGRATION_KEY, 'done')
      return
    }

    setIsMigrating(true)
    setMigrationProgress({ current: 0, total: legacy.length })

    try {
      for (let i = 0; i < legacy.length; i++) {
        const memo = legacy[i]
        await dbCreateMemo(memo.content)
        setMigrationProgress({ current: i + 1, total: legacy.length })
      }
      localStorage.setItem(MIGRATION_KEY, 'done')
    } catch (e) {
      console.error('Migration failed:', e)
    } finally {
      setIsMigrating(false)
    }
  }, [])

  // 初始加载
  useEffect(() => {
    const init = async () => {
      // 检查迁移
      if (needsMigration()) {
        await migrateLegacyData()
      }

      // 触发 Dexie Cloud 认证弹窗
      triggerCloudAuth()

      setIsLoading(true)
      try {
        const [memosData, tagsData, heatmap, statsData, count, statusStatsData] = await Promise.all([
          getAllMemos({ limit: PAGE_SIZE }),
          getAllTags(),
          getHeatmapData(),
          getStats(),
          getMemosCount(),
          getStatusStats(),
        ])

        setMemos(memosData)
        setTags(tagsData)
        setHeatmapData(heatmap)
        setStats(statsData)
        setStatusStats(statusStatsData)
        setTotalCount(count)
        setHasMore(memosData.length < count)
      } catch (e) {
        console.error('Failed to load data:', e)
      } finally {
        setIsLoading(false)
      }
    }

    init()
    loadStorageInfo()
  }, [migrateLegacyData])

  const loadStorageInfo = async () => {
    try {
      const info = await getStorageEstimate()
      setStorageInfo(info)
    } catch (e) {
      console.error('Failed to get storage info:', e)
    }
  }

  const refreshSidebarData = async () => {
    const [tagsData, heatmap, statsData, statusStatsData] = await Promise.all([
      getAllTags(),
      getHeatmapData(),
      getStats(),
      getStatusStats(),
    ])
    setTags(tagsData)
    setHeatmapData(heatmap)
    setStats(statsData)
    setStatusStats(statusStatsData)
    await loadStorageInfo()
  }

  // 加载更多（分页）
  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return

    try {
      const newMemos = await getAllMemos({
        offset: memos.length,
        limit: PAGE_SIZE,
      })

      if (newMemos.length > 0) {
        setMemos(prev => [...prev, ...newMemos])
        setHasMore(newMemos.length === PAGE_SIZE)
      } else {
        setHasMore(false)
      }
    } catch (e) {
      console.error('Failed to load more:', e)
    }
  }, [isLoading, hasMore, memos.length])

  // 创建 memo
  const addMemo = useCallback(async (content, images = []) => {
    if (!content.trim() && images.length === 0) return null
    try {
      await dbCreateMemo(content, images)
      await loadInitialData()
      return true
    } catch (e) {
      console.error('Failed to create memo:', e)
      return null
    }
  }, [])

  // 更新 memo
  const editMemo = useCallback(async (id, content) => {
    try {
      await dbUpdateMemo(id, content)
      await loadInitialData()
      return true
    } catch (e) {
      console.error('Failed to update memo:', e)
      return null
    }
  }, [])

  // 删除 memo
  const removeMemo = useCallback(async (id) => {
    try {
      await dbDeleteMemo(id)
      // 直接更新本地 state，避免 loadInitialData 闭包问题
      setMemos(prev => prev.filter(m => m.id !== id))
      await refreshSidebarData()
      return true
    } catch (e) {
      console.error('Failed to delete memo:', e)
      return null
    }
  }, [])

  // 切换单条处理状态
  const toggleMemoStatus = useCallback(async (id) => {
    try {
      const memo = memos.find(m => m.id === id)
      if (!memo) return null
      const newStatus = memo.status === 'processed' ? 'unprocessed' : 'processed'
      const now = new Date().toISOString()

      const willHide = statusFilter !== 'all' &&
        ((statusFilter === 'unprocessed' && newStatus === 'processed') ||
         (statusFilter === 'processed' && newStatus === 'unprocessed'))

      if (willHide) {
        // 标记为渐隐，不走全量 reload
        setMemos(prev => prev.map(m =>
          m.id === id ? { ...m, status: newStatus, processedAt: newStatus === 'processed' ? now : null, isFading: true } : m
        ))
        setStatusStats(prev => ({
          processed: prev.processed + (newStatus === 'processed' ? 1 : -1),
          unprocessed: prev.unprocessed + (newStatus === 'processed' ? -1 : 1),
        }))
        // 动画结束后从列表移除
        setTimeout(() => {
          setMemos(prev => prev.filter(m => m.id !== id))
        }, 700)
      } else {
        setMemos(prev => prev.map(m =>
          m.id === id
            ? { ...m, status: newStatus, processedAt: newStatus === 'processed' ? now : null }
            : m
        ))
        setStatusStats(prev => ({
          processed: prev.processed + (newStatus === 'processed' ? 1 : -1),
          unprocessed: prev.unprocessed + (newStatus === 'processed' ? -1 : 1),
        }))
      }

      await updateMemoStatus(id, newStatus)
      return true
    } catch (e) {
      console.error('Failed to toggle memo status:', e)
      return null
    }
  }, [memos, statusFilter])

  // 一键全部标记为已处理
  const markAllAsProcessed = useCallback(async () => {
    try {
      const unprocessedMemos = memos.filter(m => m.status !== 'processed')
      if (unprocessedMemos.length === 0) return 0
      const ids = unprocessedMemos.map(m => m.id)
      await batchUpdateMemoStatus(ids, 'processed')
      await loadInitialData()
      return ids.length
    } catch (e) {
      console.error('Failed to mark all as processed:', e)
      return null
    }
  }, [memos])

  // 搜索
  const search = useCallback(async (query) => {
    setSearchQuery(query)
    setSelectedTag(null)
    setIsLoading(true)

    try {
      if (query.trim()) {
        const results = await searchMemos(query)
        const filtered = statusFilter === 'all'
          ? results
          : results.filter(m => m.status === statusFilter)
        setMemos(filtered)
        setHasMore(false)
      } else {
        await loadInitialData()
      }
    } catch (e) {
      console.error('Failed to search:', e)
    } finally {
      setIsLoading(false)
    }
  }, [statusFilter])

  // 按标签筛选
  const filterByTag = useCallback(async (tag) => {
    setIsLoading(true)
    try {
      if (selectedTag === tag) {
        // 先清空标签，再重新加载（避免闭包问题）
        setSelectedTag(null)
        setSearchQuery('')
        const [memosData, tagsData, statsData, statusStatsData] = await Promise.all([
          getAllMemos({ limit: PAGE_SIZE }),
          getAllTags(),
          getStats(),
          getStatusStats(),
        ])
        let filtered = memosData
        if (statusFilter === 'processed') {
          filtered = memosData.filter(m => m.status === 'processed')
        } else if (statusFilter === 'unprocessed') {
          filtered = memosData.filter(m => m.status !== 'processed')
        }
        setMemos(filtered)
        setTags(tagsData)
        setStats(statsData)
        setStatusStats(statusStatsData)
      } else {
        setSelectedTag(tag)
        setSearchQuery('')
        const results = await getFilteredMemos(m => m.tags.includes(tag))
        const filtered = statusFilter === 'all'
          ? results
          : results.filter(m => m.status === statusFilter)
        setMemos(filtered)
        setHasMore(false)
      }
    } catch (e) {
      console.error('Failed to filter by tag:', e)
    } finally {
      setIsLoading(false)
    }
  }, [selectedTag, statusFilter])

  // 按状态筛选
  const filterByStatus = useCallback(async (filter) => {
    setStatusFilter(filter)
    setIsLoading(true)
    setSelectedTag(null)
    setSearchQuery('')
    try {
      const [memosData, statusStatsData] = await Promise.all([
        getAllMemos({ limit: PAGE_SIZE }),
        getStatusStats(),
      ])

      let filtered = memosData
      if (filter === 'processed') {
        filtered = memosData.filter(m => m.status === 'processed')
      } else if (filter === 'unprocessed') {
        filtered = memosData.filter(m => m.status !== 'processed')
      }

      setMemos(filtered)
      setStatusStats(statusStatsData)
      setHasMore(filtered.length < (statusStatsData.processed + statusStatsData.unprocessed) && filter === 'all')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 清除筛选
  const clearFilter = useCallback(async () => {
    setSelectedTag(null)
    setSearchQuery('')
    setStatusFilter('all')
    await loadInitialData()
  }, [])

  // 导出数据
  const exportData = useCallback(async () => {
    try {
      const data = await exportAllMemos()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ffn-backup-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
      return true
    } catch (e) {
      console.error('Failed to export:', e)
      return null
    }
  }, [])

  // 导入数据
  const importData = useCallback(async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result)
          if (!Array.isArray(data)) {
            reject(new Error('Invalid format'))
            return
          }
          const count = await importMemos(data)
          await loadInitialData()
          resolve(count)
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    })
  }, [])

  // 加载初始数据（复用逻辑）
  const loadInitialData = useCallback(async () => {
    const [memosData, tagsData, heatmap, statsData, count, statusStatsData] = await Promise.all([
      getAllMemos({ limit: PAGE_SIZE }),
      getAllTags(),
      getHeatmapData(),
      getStats(),
      getMemosCount(),
      getStatusStats(),
    ])

    // 保留标签筛选
    let filtered = memosData
    if (selectedTag) {
      filtered = filtered.filter(m => m.tags.includes(selectedTag))
    }
    if (statusFilter === 'processed') {
      filtered = filtered.filter(m => m.status === 'processed')
    } else if (statusFilter === 'unprocessed') {
      filtered = filtered.filter(m => m.status !== 'processed')
    }

    setMemos(filtered)
    setTags(tagsData)
    setHeatmapData(heatmap)
    setStats(statsData)
    setTotalCount(count)
    setStatusStats(statusStatsData)
    setHasMore(filtered.length < count && statusFilter === 'unprocessed')
  }, [statusFilter, selectedTag])

  const value = {
    memos,
    tags,
    heatmapData,
    selectedTag,
    searchQuery,
    stats,
    storageInfo,
    statusStats,
    statusFilter,
    isLoading,
    hasMore,
    totalCount,
    isMigrating,
    migrationProgress,
    isSyncing,
    addMemo,
    editMemo,
    removeMemo,
    toggleMemoStatus,
    markAllAsProcessed,
    search,
    filterByTag,
    filterByStatus,
    clearFilter,
    loadMore,
    exportData,
    importData,
  }

  return (
    <MemosContext.Provider value={value}>
      {children}
    </MemosContext.Provider>
  )
}

export function useMemos() {
  const context = useContext(MemosContext)
  if (!context) {
    throw new Error('useMemos must be used within a MemosProvider')
  }
  return context
}