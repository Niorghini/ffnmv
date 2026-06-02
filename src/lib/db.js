/**
 * Dexie 数据库（v1.2 / PRD 3.1）
 * - 7 个 store：notes / tags / note_tags / sync_queue / sync_metadata / conflicts / cache
 * - 字段 snake_case（PRD 规范）
 * - v0.7.0 兼容：升级时自动删除旧的 'memos' store（用户确认丢弃旧数据）
 */

import Dexie from 'dexie'

const DB_NAME = 'ffn_db'
const DB_VERSION = 4

export const db = new Dexie(DB_NAME)

db.version(DB_VERSION)
  .stores({
    notes: 'id, status, created_at, updated_at, sync_status, deleted_at',
    tags: 'id, name, sync_status, deleted_at',
    note_tags: '[note_id+tag_id], note_id, tag_id, deleted_at, sync_status',
    sync_queue: '++id, type, entity_type, entity_id, created_at, priority, status',
    sync_metadata: 'key',
    conflicts: 'id, entity_type, entity_id, created_at',
    cache: 'key, expires_at',
  })
  .upgrade(async (tx) => {
    // v0.7.0 → v1.2：旧 'memos' store 不在 schema 中，升级时显式删除
    if (tx.db.objectStoreNames.contains('memos')) {
      tx.db.deleteObjectStore('memos')
    }
  })

// 诊断：让外部知道 v0.7.0 数据是否被清理过（一次性）
const LEGACY_FLAG_KEY = 'ffn_v07_legacy_cleaned'

const safeStorage = {
  getItem(k) {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null
    } catch {
      return null
    }
  },
  setItem(k, v) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(k, v)
    } catch {
      // 某些环境下 localStorage 是只读快照，忽略
    }
  },
}

export const wasLegacyCleaned = () => safeStorage.getItem(LEGACY_FLAG_KEY) === '1'
export const markLegacyCleaned = () => safeStorage.setItem(LEGACY_FLAG_KEY, '1')

// 启动时清旧 DB（如果存在但没被 upgrade 命中——防御性）
// 仅在初次打开后才会运行 upgrade；如果浏览器残留了 v0.7.0 的 ffn_db
// 但用户没打开过新 App,这条检测不触发。upgrade 才是真正的清理点。
export const detectAndPurgeLegacy = async () => {
  if (!indexedDB.databases) return false
  const dbs = await indexedDB.databases()
  const legacy = dbs.find((d) => d.name === DB_NAME && d.version === 1)
  if (!legacy) return false
  // 强制删除后由新版 Dexie 重建
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = resolve
    req.onerror = reject
    req.onblocked = () => reject(new Error('旧版数据库被其他标签页占用，请关闭其他标签后刷新'))
  })
  markLegacyCleaned()
  return true
}

/**
 * 打开数据库并确保 schema 就绪
 * - 首次开失败（schema 不兼容 / 卡在 broken 状态）→ 自动清掉 DB 重开一次
 */
const deleteDb = () =>
  new Promise((resolve, reject) => {
    if (db.isOpen()) db.close()
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB 删除被其他标签页阻塞，请关闭其他标签后刷新'))
  })

export const openDb = async () => {
  await detectAndPurgeLegacy()
  if (db.isOpen()) return db
  try {
    await db.open()
    return db
  } catch (err) {
    // 自愈：清掉旧 DB 后重建（v3→v4 升级失败 / 中间状态卡住 / 字段索引错乱）
    console.warn('[db] open failed, purging and retrying:', err)
    await deleteDb()
    await db.open()
    return db
  }
}

// 辅助：当前时间 ISO 字符串
export const nowIso = () => new Date().toISOString()
