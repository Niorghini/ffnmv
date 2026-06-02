/**
 * notesRepo —— 笔记表 CRUD + sync_queue 入队
 * 规则：
 *   - 写操作必须在事务内完成（notes + sync_queue 同一事务，失败一起回滚）
 *   - 每次修改 version 自增、updated_at 更新、sync_status=pending
 *   - 软删除：deleted_at 设值，不真删
 *   - 同步优先级：create=1, update=5, delete=8, restore=3
 */
import { v4 as uuidv4 } from 'uuid'
import { db, nowIso } from '@/lib/db'
import { noteTagsRepo } from './noteTagsRepo'

const PRIORITY = { create: 1, restore: 3, update: 5, delete: 8 }

const enqueue = (type, entityId) =>
  db.sync_queue.add({
    type,
    entity_type: 'notes',
    entity_id: entityId,
    priority: PRIORITY[type] ?? 5,
    status: 'pending',
    created_at: nowIso(),
  })

export const notesRepo = {
  /**
   * 创建笔记
   * @param {{ content: string, tagIds?: string[] }} input
   * @returns {Promise<object>} 创建后的笔记
   */
  async create({ content, tagIds = [] }) {
    const id = uuidv4()
    const ts = nowIso()
    const note = {
      id,
      content: content || '',
      status: 'pending',
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
      version: 1,
      sync_status: 'pending',
      last_synced_at: null,
      archived_at: null,
    }
    await db.transaction('rw', db.notes, db.sync_queue, db.note_tags, async () => {
      await db.notes.add(note)
      await enqueue('create', id)
      for (const tagId of tagIds) {
        await db.note_tags.add({
          note_id: id,
          tag_id: tagId,
          created_at: ts,
          version: 1,
          sync_status: 'pending',
          last_synced_at: null,
        })
        await enqueueTagAttach(id, tagId)
      }
    })
    return note
  },

  /**
   * 更新内容（bump version）
   */
  async update(id, { content }) {
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.notes, db.sync_queue, async () => {
      const existing = await db.notes.get(id)
      if (!existing) throw new Error(`Note ${id} not found`)
      if (existing.deleted_at) throw new Error('Cannot update a deleted note')
      updated = {
        ...existing,
        content,
        updated_at: ts,
        version: existing.version + 1,
        sync_status: 'pending',
      }
      await db.notes.put(updated)
      await enqueue('update', id)
    })
    return updated
  },

  /**
   * 设置状态（pending/completed）
   */
  async setStatus(id, status) {
    if (status !== 'pending' && status !== 'completed') {
      throw new Error(`Invalid status: ${status}`)
    }
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.notes, db.sync_queue, async () => {
      const existing = await db.notes.get(id)
      if (!existing) throw new Error(`Note ${id} not found`)
      if (existing.deleted_at) throw new Error('Cannot update a deleted note')
      if (existing.status === status) {
        updated = existing
        return
      }
      updated = {
        ...existing,
        status,
        updated_at: ts,
        version: existing.version + 1,
        sync_status: 'pending',
      }
      await db.notes.put(updated)
      await enqueue('update', id)
    })
    return updated
  },

  /**
   * 软删除（30 天可恢复）
   */
  async softDelete(id) {
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.notes, db.sync_queue, async () => {
      const existing = await db.notes.get(id)
      if (!existing) throw new Error(`Note ${id} not found`)
      if (existing.deleted_at) {
        updated = existing
        return
      }
      updated = {
        ...existing,
        deleted_at: ts,
        updated_at: ts,
        version: existing.version + 1,
        sync_status: 'pending',
      }
      await db.notes.put(updated)
      await enqueue('delete', id)
    })
    return updated
  },

  /**
   * 恢复软删除
   */
  async restore(id) {
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.notes, db.sync_queue, async () => {
      const existing = await db.notes.get(id)
      if (!existing) throw new Error(`Note ${id} not found`)
      if (!existing.deleted_at) {
        updated = existing
        return
      }
      updated = {
        ...existing,
        deleted_at: null,
        updated_at: ts,
        version: existing.version + 1,
        sync_status: 'pending',
      }
      await db.notes.put(updated)
      await enqueue('restore', id)
    })
    return updated
  },

  /**
   * 标记归档（自动归档使用）
   */
  async setArchived(id, archived) {
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.notes, db.sync_queue, async () => {
      const existing = await db.notes.get(id)
      if (!existing) throw new Error(`Note ${id} not found`)
      const wantArchived = !!archived
      const hasArchived = !!existing.archived_at
      if (wantArchived === hasArchived) {
        updated = existing
        return
      }
      updated = {
        ...existing,
        archived_at: wantArchived ? ts : null,
        updated_at: ts,
        version: existing.version + 1,
        sync_status: 'pending',
      }
      await db.notes.put(updated)
      await enqueue('update', id)
    })
    return updated
  },

  /**
   * 直接 put 一条（同步层在合并云端数据时使用，绕过入队——同步层会自己处理 sync_status）
   */
  async _putDirect(note) {
    await db.notes.put(note)
  },

  /**
   * 查询
   */
  async getById(id) {
    return db.notes.get(id)
  },

  async getAll({ includeDeleted = false, includeArchived = false } = {}) {
    let collection = db.notes.orderBy('created_at').reverse()
    const rows = await collection.toArray()
    return rows.filter((n) => {
      if (!includeDeleted && n.deleted_at) return false
      if (!includeArchived && n.archived_at) return false
      return true
    })
  },

  async getByTag(tagId, { includeDeleted = false } = {}) {
    const links = await db.note_tags.where('tag_id').equals(tagId).toArray()
    const noteIds = links.map((l) => l.note_id)
    if (noteIds.length === 0) return []
    const notes = await db.notes.where('id').anyOf(noteIds).toArray()
    return notes
      .filter((n) => (includeDeleted ? true : !n.deleted_at))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  },

  async getPendingSync() {
    return db.notes.where('sync_status').anyOf(['pending', 'failed']).toArray()
  },
}

const enqueueTagAttach = (noteId, tagId) =>
  db.sync_queue.add({
    type: 'tag_attach',
    entity_type: 'note_tags',
    entity_id: `${noteId}:${tagId}`,
    priority: 5,
    status: 'pending',
    created_at: nowIso(),
  })
