/**
 * 同步队列与同步状态类型（src/lib/db.js 的 sync_queue / sync_metadata 表）
 */

/** sync_queue.entity_type 取值 */
export type EntityType = 'notes' | 'tags' | 'note_tags'

/** sync_queue.type 取值（src/lib/notesRepo.js 的 PRIORITY + tagsRepo / noteTagsRepo 的 type） */
export type SyncOpType =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'tag_attach'
  | 'tag_detach'

/** 主实体 sync_status 取值（Note/Tag/NoteTag.sync_status） */
export type SyncStatus = 'pending' | 'synced' | 'failed'

/** sync_queue.status 取值（仅 pending → done 流转；failed 不入 sync_queue） */
export type SyncQueueStatus = 'pending' | 'done'

/**
 * sync_queue 行
 * - id 自增主键（`++id`），add 时不指定，put 时可选
 * - priority 仅使用 1/3/5/8 四个值（notesRepo.PRIORITY + tag_* 默认 5）
 */
export interface SyncQueueItem {
  id?: number
  type: SyncOpType
  entity_type: EntityType
  entity_id: string
  priority: 1 | 3 | 5 | 8
  status: SyncQueueStatus
  created_at: string
}

/** sync_metadata 行（key-value，value 可为字符串或数字，autoArchive 存 number） */
export interface SyncMetadata {
  key: string
  value: string | number
}

/** useSyncStore.status 取值（与 src/lib/syncManager.js 的状态机一致） */
export type SyncEngineStatus = 'idle' | 'syncing' | 'error' | 'offline'