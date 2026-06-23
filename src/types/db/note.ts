/**
 * 笔记实体（src/lib/db.js 的 notes 表 + src/repositories/notesRepo.js）
 * - 严格匹配实际 Dexie 行 shape
 * - 软删除：deleted_at 为 string（时间戳）；未删：null
 * - last_sync_device / user_id 仅 sync 后存在，本地新建笔记不应有
 */
export interface Note {
  id: string
  content: string
  status: 'pending' | 'completed'
  created_at: string
  updated_at: string
  deleted_at: string | null
  archived_at: string | null
  version: number
  sync_status: 'pending' | 'synced' | 'failed'
  last_synced_at: string | null
  /** 仅 sync push/pull 后存在；本地新建的 note 没有此字段 */
  last_sync_device?: string
  /** 仅 cloud 行有，sync 拉取时 stripUserId 后丢弃；本地写入不应有 */
  user_id?: string
}