/**
 * Dexie 数据库（v1.2 / PRD 3.1）
 * - 7 个 store：notes / tags / note_tags / sync_queue / sync_metadata / conflicts / cache
 * - 字段 snake_case（PRD 规范）
 * - v0.7.0 兼容：升级时自动删除旧的 'memos' store（用户确认丢弃旧数据）
 */

import Dexie from 'dexie'

const DB_NAME = 'ffn_db'
const DB_VERSION = 5
// v4 → v5: notes 加 archived_at 索引 + 规范化 undefined → null
// v3 → v4: ...
// v0.7.0 → v1.2: 旧 'memos' store 升级时显式删除

export const db = new Dexie(DB_NAME)

db.version(DB_VERSION)
  .stores({
    notes: 'id, status, created_at, updated_at, sync_status, deleted_at, archived_at',
    tags: 'id, name, sync_status, deleted_at',
    note_tags: '[note_id+tag_id], note_id, tag_id, deleted_at, sync_status',
    sync_queue: '++id, type, entity_type, entity_id, created_at, priority, status',
    sync_metadata: 'key',
    conflicts: 'id, entity_type, entity_id, created_at',
    cache: 'key, expires_at',
  })
  .upgrade(async (tx) => {
    // v0.7.0 → v1.2:旧 'memos' store 不在 schema 中,升级时显式删除
    // 2026-06-20 防御:某些浏览器/Dexie 边界下 tx.db.objectStoreNames 是 undefined,
    // 包 try/catch + 限定 oldVersion<2 才需要清(只有 v0.7.0 v1 才有 memos)
    if (tx.oldVersion < 2) {
      try {
        if (tx.db?.objectStoreNames?.contains('memos')) {
          tx.db.deleteObjectStore('memos')
        }
      } catch (e) {
        console.warn('[db] legacy memos cleanup skipped:', e?.message || e)
      }
    }
    // v4 → v5: 规范化 archived_at 字段(undefined → null),保证新索引覆盖全表
    if (tx.oldVersion < 5) {
      await tx.table('notes').toCollection().modify((n) => {
        if (n.archived_at === undefined) n.archived_at = null
      })
    }
  })

// 诊断：让外部知道 v0.7.0 数据是否被清理过（一次性）
const LEGACY_FLAG_KEY = 'ffn_v07_legacy_cleaned'
// 性能：让 openDb 跳过重复的 indexedDB.databases() 扫描（detect 已经跑过且没遗留）
const LEGACY_CHECKED_KEY = 'ffn_v07_legacy_checked'

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
// 用单独的"已检查"标志,不影响 wasLegacyCleaned 的语义(那标志控制 toast)
const wasLegacyChecked = () => safeStorage.getItem(LEGACY_CHECKED_KEY) === '1'
const markLegacyChecked = () => safeStorage.setItem(LEGACY_CHECKED_KEY, '1')

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
 * - 失败时清掉 DB 后**用全新的 Dexie 实例**重开（同一个实例复用会带坏内部状态）
 * - 重试 2 次
 * - 都失败就抛出（App.jsx 的 catch 会处理 UI）
 */
const deleteDb = () =>
  new Promise((resolve) => {
    try {
      if (db.isOpen()) db.close()
    } catch {
      // isOpen 可能抛错（db 状态异常），忽略让后续 reset 走完
    }
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve() // 失败也继续，让 open 失败再处理
    req.onblocked = () => resolve() // 同上
  })

const makeFreshDb = () => {
  // 新 Dexie 实例，避开旧实例的 internal state 污染
  const fresh = new Dexie(DB_NAME)
  fresh.version(DB_VERSION).stores({
    notes: 'id, status, created_at, updated_at, sync_status, deleted_at, archived_at',
    tags: 'id, name, sync_status, deleted_at',
    note_tags: '[note_id+tag_id], note_id, tag_id, deleted_at, sync_status',
    sync_queue: '++id, type, entity_type, entity_id, created_at, priority, status',
    sync_metadata: 'key',
    conflicts: 'id, entity_type, entity_id, created_at',
    cache: 'key, expires_at',
  }).upgrade(async (tx) => {
    if (tx.oldVersion < 2) {
      try {
        if (tx.db?.objectStoreNames?.contains('memos')) {
          tx.db.deleteObjectStore('memos')
        }
      } catch (e) {
        console.warn('[db] legacy memos cleanup skipped:', e?.message || e)
      }
    }
    if (tx.oldVersion < 5) {
      await tx.table('notes').toCollection().modify((n) => {
        if (n.archived_at === undefined) n.archived_at = null
      })
    }
  })
  return fresh
}

export const openDb = async () => {
  // 性能：只在第一次启动时跑 indexedDB.databases() 扫描(50~200ms 视浏览器)。
  // 后续启动直接 db.open(),不再做冗余扫描。
  if (!wasLegacyChecked()) {
    await detectAndPurgeLegacy()
    markLegacyChecked()
  }
  if (db.isOpen()) return db
  // 第一次尝试：用 module-level db
  try {
    await db.open()
    return db
  } catch (err) {
    // 关键安全检查:只有真正的 schema/version 冲突才允许 wipe 自愈。
    // 其他 transient 失败(quota exceeded / write lock / InvalidState / browser quirk)
    // 不要清空用户数据 —— 让上层(App.jsx catch)处理 UI 提示。
    // 旧逻辑是任何失败都 deleteDatabase(),这就是"打开页面没数据"的根因:
    // 偶发失败 → DB 被清 → 同步还没拉回来 → UI 空。
    const msg = err?.message || ''
    const isVersionConflict =
      err?.name === 'VersionError' ||
      err?.inner?.name === 'VersionError' ||
      err?.name === 'OpenFailedError' && /version/i.test(msg) ||
      /version/i.test(msg) && /(less than|greater than|requested|existing)/i.test(msg)
    if (!isVersionConflict) {
      throw err
    }
    console.warn('[db] schema version conflict, self-healing:', msg)
  }
  // 自愈路径:删 DB + 全新实例
  await deleteDb()
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const fresh = makeFreshDb()
      await fresh.open()
      Object.assign(db, fresh)
      console.info(`[db] self-healed on attempt ${attempt}`)
      // 关键:通知 sync 立即从云端全量重拉,补回 wipe 期间空掉的窗口。
      // 不发这个事件,用户得等下一次 polling(60s+)才看到数据。
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('db-reset'))
      }
      return db
    } catch (err) {
      console.warn(`[db] self-heal attempt ${attempt} failed:`, err?.message)
      await deleteDb()
    }
  }
  throw new Error('数据库无法打开。请清除浏览器站点数据后重试。')
}

// 辅助：当前时间 ISO 字符串
export const nowIso = () => new Date().toISOString()
