/**
 * 全局类型统一导出
 * - 业务代码统一从 '@/types' 导入，避免散落
 * - 新增类型请在 src/types/{base,db,api,store,capacitor}/ 下分门别类
 */

// 环境类型（侧效：自动 import .d.ts 扩展）
export type {} from './base/env'

// 数据库实体类型
export type { Note, PendingImageUpload } from './db/note'
export type { Tag } from './db/tag'
export type { NoteTag, NoteTagKey } from './db/noteTag'
export type { Attachment, AttachmentKind } from './db/attachment'
export type { ImageMime } from './db/attachment'
export { IMAGE_MIME_TYPES } from './db/attachment'
export type {
  EntityType,
  SyncOpType,
  SyncStatus,
  SyncQueueStatus,
  SyncQueueItem,
  SyncMetadata,
  SyncEngineStatus,
} from './db/sync'
export type { ConflictRecord } from './db/conflict'
export type { CacheEntry } from './db/cache'

// 自定义事件类型（侧效：扩展全局 WindowEventMap）
export type { DataUpdatedDetail, DataUpdatedEvent, DbResetEvent } from './db/events'