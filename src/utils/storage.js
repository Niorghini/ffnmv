/**
 * localStorage 封装
 * 提供 memo 数据存储的 CRUD 操作
 */

const STORAGE_KEY = 'ffn_memos'

// 生成唯一 ID
export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

// 从 localStorage 获取所有 memos
export const getAllMemos = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch (e) {
    console.error('Failed to read memos:', e)
    return []
  }
}

// 保存 memos 到 localStorage
export const saveMemos = (memos) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memos))
    return true
  } catch (e) {
    console.error('Failed to save memos:', e)
    return false
  }
}

// 创建新 memo
export const createMemo = (content) => {
  const memos = getAllMemos()
  const now = new Date().toISOString()

  // 解析标签：#标签名
  const tagRegex = /#[\w一-龥-]+/g
  const tags = content.match(tagRegex) || []

  const newMemo = {
    id: generateId(),
    content,
    tags,
    createdAt: now,
    updatedAt: now,
  }

  memos.unshift(newMemo) // 新创建的放在最前面
  saveMemos(memos)

  return newMemo
}

// 更新 memo
export const updateMemo = (id, content) => {
  const memos = getAllMemos()
  const index = memos.findIndex(m => m.id === id)

  if (index === -1) return null

  // 重新解析标签
  const tagRegex = /#[\w一-龥-]+/g
  const tags = content.match(tagRegex) || []

  memos[index] = {
    ...memos[index],
    content,
    tags,
    updatedAt: new Date().toISOString(),
  }

  saveMemos(memos)
  return memos[index]
}

// 删除 memo
export const deleteMemo = (id) => {
  const memos = getAllMemos()
  const filtered = memos.filter(m => m.id !== id)
  saveMemos(filtered)
  return true
}

// 获取所有标签
export const getAllTags = () => {
  const memos = getAllMemos()
  const tagMap = {}

  memos.forEach(memo => {
    memo.tags.forEach(tag => {
      tagMap[tag] = (tagMap[tag] || 0) + 1
    })
  })

  // 按使用次数排序
  return Object.entries(tagMap)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }))
}

// 搜索 memos
export const searchMemos = (query) => {
  const memos = getAllMemos()
  const lowerQuery = query.toLowerCase()

  return memos.filter(memo =>
    memo.content.toLowerCase().includes(lowerQuery) ||
    memo.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  )
}

// 获取热力图数据
export const getHeatmapData = () => {
  const memos = getAllMemos()
  const data = {}

  memos.forEach(memo => {
    const date = memo.createdAt.split('T')[0] // YYYY-MM-DD
    data[date] = (data[date] || 0) + 1
  })

  return data
}

// 按日期筛选 memos
export const getMemosByDate = (dateStr) => {
  const memos = getAllMemos()
  return memos.filter(memo => memo.createdAt.startsWith(dateStr))
}