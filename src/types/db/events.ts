/**
 * 自定义事件 detail 类型
 * - data-updated: src/lib/tags.js emitDataUpdated 派发，stores 监听做增量/全量更新
 * - db-reset: src/lib/db.js self-heal 后派发，SyncManager 立即全量重拉
 */
import type { Note } from './note'
import type { Tag } from './tag'
import type { NoteTag } from './noteTag'

/** data-updated event detail（增量更新事件） */
export type DataUpdatedDetail =
  | {
      entityType: 'notes'
      source?: 'pull' | 'push' | 'cleanup' | 'realtime' | 'local'
      rows?: Note[]
      removed?: string[] | Set<string>
    }
  | {
      entityType: 'tags'
      source?: 'pull' | 'push' | 'cleanup' | 'realtime' | 'local'
      rows?: Tag[]
      removed?: string[] | Set<string>
    }
  | {
      entityType: 'note_tags'
      source?: 'pull' | 'push' | 'cleanup' | 'realtime' | 'local'
      rows?: NoteTag[]
      removed?: string[] | Set<string>
    }
  | {
      entityType: string
      source?: 'pull' | 'push' | 'cleanup' | 'realtime' | 'local'
      rows?: undefined
      removed?: undefined
    }

/** data-updated CustomEvent 类型 */
export interface DataUpdatedEvent extends CustomEvent {
  detail: DataUpdatedDetail
}

/** db-reset CustomEvent 类型（无 detail） */
export type DbResetEvent = CustomEvent<undefined>

// Window event map 扩展（保留 CustomEvent 默认行为，类型断言时更安全）
declare global {
  interface WindowEventMap {
    'data-updated': DataUpdatedEvent
    'db-reset': DbResetEvent
  }
}