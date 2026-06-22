/**
 * 标签实体（src/lib/db.js 的 tags 表 + src/repositories/tagsRepo.js）
 */
export interface Tag {
  id: string
  name: string
  color: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  version: number
  sync_status: 'pending' | 'synced' | 'failed'
  last_synced_at: string | null
  /** 仅 sync push/pull 后存在 */
  last_sync_device?: string
  /** 仅 cloud 行有，sync 拉取时 stripUserId 后丢弃 */
  user_id?: string
}