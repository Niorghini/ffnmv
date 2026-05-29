/**
 * IndexedDB 封装 (Dexie.js + Dexie Cloud)
 * 本地优先，云端同步
 */

import Dexie from 'dexie'
import dexieCloud from 'dexie-cloud-addon'

// 注册 Cloud addon（全局）
Dexie.addons.push(dexieCloud)

const db = new Dexie('ffn_db')
db.version(1).stores({
  memos: 'id, createdAt, updatedAt, status',
})

// Dexie Cloud 配置
db.cloud.configure({
  databaseUrl: 'https://zxfj1v7fg.dexie.cloud',
  nameSuffix: true,
})

// 触发 Dexie Cloud 认证弹窗（首次加载时调用）
export const triggerCloudAuth = () => {
  db.cloud.login().catch(() => {})
}

// 主动触发云端数据同步
export const syncCloudData = () => {
  return db.cloud.sync({ purpose: 'pull', wait: true }).catch(() => {})
}

// 获取云端用户信息（BehaviorSubject）
export const getCloudUser = () => db.cloud.currentUser

// 登出
export const logoutCloud = () => db.cloud.logout().catch(() => {})

// 生成唯一 ID
export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

// 解析标签：#标签名
export const parseTags = (content) => {
  const tagRegex = /#[\w一-龥-]+/g
  return content.match(tagRegex) || []
}

// 获取所有 memos（支持分页）
export const getAllMemos = async (options = {}) => {
  const { offset = 0, limit = 100 } = options
  const all = await db.memos.orderBy('createdAt').reverse().offset(offset).limit(limit).toArray()
  return all
}

// 获取 memos 总数
export const getMemosCount = async () => {
  return db.memos.count()
}

// 获取符合条件的所有 memos（用于搜索、标签筛选，不分页但限制结果数）
export const getFilteredMemos = async (filterFn, options = {}) => {
  const { limit = 500 } = options
  const all = await db.memos.toArray()
  return all.filter(filterFn).slice(0, limit)
}

// 创建新 memo
export const createMemo = async (content, images = []) => {
  const now = new Date().toISOString()
  const newMemo = {
    id: generateId(),
    content,
    tags: parseTags(content),
    images,
    status: 'unprocessed',
    processedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.memos.add(newMemo)
  return newMemo
}

// 更新 memo（保留图片）
export const updateMemo = async (id, content) => {
  const memo = await db.memos.get(id)
  if (!memo) return null
  await db.memos.update(id, {
    content,
    tags: parseTags(content),
    updatedAt: new Date().toISOString(),
  })
  return db.memos.get(id)
}

// 删除 memo
export const deleteMemo = async (id) => {
  await db.memos.delete(id)
  return true
}

// 更新处理状态
export const updateMemoStatus = async (id, status) => {
  const now = new Date().toISOString()
  const update = {
    status,
    processedAt: status === 'processed' ? now : null,
    updatedAt: now,
  }
  await db.memos.update(id, update)
  return db.memos.get(id)
}

// 批量更新处理状态
export const batchUpdateMemoStatus = async (ids, status) => {
  const now = new Date().toISOString()
  const update = {
    status,
    processedAt: status === 'processed' ? now : null,
    updatedAt: now,
  }
  await db.memos.where('id').anyOf(ids).modify(update)
  return ids.length
}

// 获取处理状态统计
export const getStatusStats = async () => {
  const all = await db.memos.toArray()
  let processed = 0
  let unprocessed = 0
  for (const m of all) {
    if (m.status === 'processed') processed++
    else unprocessed++
  }
  return { processed, unprocessed }
}

// 获取所有标签（带计数）
export const getAllTags = async () => {
  const all = await db.memos.toArray()
  const tagMap = {}

  for (const memo of all) {
    const createdAt = memo.createdAt
    for (const tag of (memo.tags || [])) {
      if (!tagMap[tag]) {
        tagMap[tag] = { count: 0, lastAt: createdAt }
      }
      tagMap[tag].count++
      if (createdAt > tagMap[tag].lastAt) {
        tagMap[tag].lastAt = createdAt
      }
    }
  }

  return Object.entries(tagMap).map(([tag, { count, lastAt }]) => ({ tag, count, lastAt }))
}

// 搜索 memos
export const searchMemos = async (query) => {
  const lowerQuery = query.toLowerCase()
  const all = await db.memos.toArray()
  return all.filter(memo =>
    memo.content.toLowerCase().includes(lowerQuery) ||
    (memo.tags || []).some(tag => tag.toLowerCase().includes(lowerQuery))
  )
}

// 按日期筛选
export const getMemosByDate = async (dateStr) => {
  const all = await db.memos.toArray()
  return all.filter(memo => memo.createdAt.startsWith(dateStr))
}

// 获取热力图数据
export const getHeatmapData = async () => {
  const all = await db.memos.toArray()
  const data = {}
  for (const memo of all) {
    const date = memo.createdAt.split('T')[0]
    data[date] = (data[date] || 0) + 1
  }
  return data
}

// 获取统计数据
export const getStats = async () => {
  const [total, heatmapData] = await Promise.all([
    getMemosCount(),
    getHeatmapData()
  ])

  const today = new Date().toISOString().split('T')[0]
  const thisMonth = new Date().getMonth()
  const thisYear = new Date().getFullYear()

  let todayCount = 0
  let thisMonthCount = 0

  for (const [date, count] of Object.entries(heatmapData)) {
    if (date === today) todayCount = count
    const d = new Date(date)
    if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
      thisMonthCount += count
    }
  }

  return { total, today: todayCount, thisMonth: thisMonthCount }
}

// 获取存储使用情况（字节）
export const getStorageEstimate = async () => {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate()
    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0,
      percentage: estimate.quota ? ((estimate.usage || 0) / estimate.quota * 100).toFixed(2) : 0
    }
  }
  return { used: 0, quota: 0, percentage: 0 }
}

// 导出所有数据（用于备份）
export const exportAllMemos = async () => {
  return db.memos.orderBy('createdAt').reverse().toArray()
}

// 导入数据（覆盖模式）
export const importMemos = async (memos) => {
  await db.memos.clear()
  await db.memos.bulkAdd(memos)
  return memos.length
}

export default db