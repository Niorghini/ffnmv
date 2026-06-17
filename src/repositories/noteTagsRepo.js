/**
 * noteTagsRepo —— 笔记-标签关联表
 * - 复合主键 [note_id+tag_id]
 * - attach / detach / replaceAll 都包在事务里，同步入队 sync_queue
 */
import { db, nowIso } from '@/lib/db'
import { emitDataUpdated } from '@/lib/tags'

const enqueueAttach = (noteId, tagId) =>
  db.sync_queue.add({
    type: 'tag_attach',
    entity_type: 'note_tags',
    entity_id: `${noteId}:${tagId}`,
    priority: 5,
    status: 'pending',
    created_at: nowIso(),
  })

const enqueueDetach = (noteId, tagId) =>
  db.sync_queue.add({
    type: 'tag_detach',
    entity_type: 'note_tags',
    entity_id: `${noteId}:${tagId}`,
    priority: 5,
    status: 'pending',
    created_at: nowIso(),
  })

export const noteTagsRepo = {
  /**
   * 追加关联（已存在则跳过）
   */
  async attach(noteId, tagIds) {
    if (!tagIds || tagIds.length === 0) return []
    const ts = nowIso()
    const attached = []
    await db.transaction('rw', db.note_tags, db.sync_queue, async () => {
      for (const tagId of tagIds) {
        const key = [noteId, tagId]
        const exists = await db.note_tags.get(key)
        if (exists && !exists.deleted_at) continue
        const row = {
          note_id: noteId,
          tag_id: tagId,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
          version: 1,
          sync_status: 'pending',
          last_synced_at: null,
        }
        await db.note_tags.put(row)
        await enqueueAttach(noteId, tagId)
        attached.push(tagId)
      }
    })
    if (attached.length > 0) emitDataUpdated('note_tags')
    return attached
  },

  /**
   * 删除关联（软删除）
   */
  async detach(noteId, tagIds) {
    if (!tagIds || tagIds.length === 0) return []
    const ts = nowIso()
    const detached = []
    await db.transaction('rw', db.note_tags, db.sync_queue, async () => {
      for (const tagId of tagIds) {
        const existing = await db.note_tags.get([noteId, tagId])
        if (!existing || existing.deleted_at) continue
        await db.note_tags.put({
          ...existing,
          deleted_at: ts,
          updated_at: ts,
          version: existing.version + 1,
          sync_status: 'pending',
        })
        await enqueueDetach(noteId, tagId)
        detached.push(tagId)
      }
    })
    if (detached.length > 0) emitDataUpdated('note_tags')
    return detached
  },

  /**
   * 替换为给定 tagIds 列表
   * 旧的全部 detach（软删除），新的全部 attach
   */
  async replaceAll(noteId, tagIds) {
    const ts = nowIso()
    const desired = new Set(tagIds)
    let changes = 0
    await db.transaction('rw', db.note_tags, db.sync_queue, async () => {
      const existing = await db.note_tags.where('note_id').equals(noteId).toArray()
      const current = new Set(existing.filter((e) => !e.deleted_at).map((e) => e.tag_id))
      const toAdd = [...desired].filter((id) => !current.has(id))
      const toRemove = [...current].filter((id) => !desired.has(id))
      for (const tagId of toAdd) {
        await db.note_tags.put({
          note_id: noteId,
          tag_id: tagId,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
          version: 1,
          sync_status: 'pending',
          last_synced_at: null,
        })
        await enqueueAttach(noteId, tagId)
        changes++
      }
      for (const tagId of toRemove) {
        const row = existing.find((e) => e.tag_id === tagId)
        if (!row) continue
        await db.note_tags.put({
          ...row,
          deleted_at: ts,
          updated_at: ts,
          version: row.version + 1,
          sync_status: 'pending',
        })
        await enqueueDetach(noteId, tagId)
        changes++
      }
    })
    if (changes > 0) emitDataUpdated('note_tags')
  },

  async getByNote(noteId) {
    const links = await db.note_tags.where('note_id').equals(noteId).toArray()
    return links.filter((l) => !l.deleted_at)
  },

  async getByTag(tagId) {
    const links = await db.note_tags.where('tag_id').equals(tagId).toArray()
    return links.filter((l) => !l.deleted_at)
  },

  /**
   * 同步层直接 put（绕过入队）
   */
  async _putDirect(row) {
    await db.note_tags.put(row)
  },
}
