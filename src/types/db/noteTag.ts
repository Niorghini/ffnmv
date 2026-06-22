/**
 * 笔记-标签关联实体（src/lib/db.js 的 note_tags 表）
 * - 复合主键 [note_id+tag_id]，没有 id 字段
 * - Dexie .delete() / .get() 接受 [note_id, tag_id] 数组
 */
export interface NoteTag {
  note_id: string
  tag_id: string
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

/** Dexie note_tags 表的复合主键类型 */
export type NoteTagKey = [note_id: string, tag_id: string]