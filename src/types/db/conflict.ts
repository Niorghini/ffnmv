/**
 * 冲突实体（src/lib/db.js 的 conflicts 表 + src/lib/syncManager.js._handleConflict）
 * - 判别联合：cloud_data / local_data 类型随 entity_type 自动收窄
 */
import type { Note } from './note'
import type { Tag } from './tag'
import type { NoteTag } from './noteTag'

export type ConflictRecord =
  | {
      id: string
      entity_type: 'notes'
      entity_id: string
      local_data: Note
      cloud_data: Note
      created_at: string
    }
  | {
      id: string
      entity_type: 'tags'
      entity_id: string
      local_data: Tag
      cloud_data: Tag
      created_at: string
    }
  | {
      id: string
      entity_type: 'note_tags'
      entity_id: string
      local_data: NoteTag
      cloud_data: NoteTag
      created_at: string
    }