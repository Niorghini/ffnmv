/**
 * 通用缓存实体（src/lib/db.js 的 cache 表）
 * - 当前项目代码里仅在 purgeAllLocalData / factoryReset 时 .clear()
 * - 无读写逻辑保留（不引入不存在的方法）
 */
export interface CacheEntry {
  key: string
  value: string
  expires_at: string
}