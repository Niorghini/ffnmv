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
import { emitDataUpdated, extractTagNames } from '@/lib/tags'
import { noteTagsRepo } from './noteTagsRepo'
import { tagsRepo } from './tagsRepo'
import { supabase } from '@/lib/supabase'

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
    emitDataUpdated('notes')
    return note
  },

  /**
   * 更新内容（bump version）
   * 同时根据新 content 同步 tag 关联：
   *   - 解析 #tag 名字，findOrCreate 进 tag 库
   *   - 与当前活跃 link 集合求 diff：
   *     · 新出现的 tag  → 创建 link
   *     · 消失的 tag    → 软删 link（保留历史可恢复）
   *   - 全部入 sync_queue，等 sync 推到云端
   */
  async update(id, { content }) {
    const ts = nowIso()
    let updated
    // 先在事务外 findOrCreate（不要求在事务内，但 link 写入需要在事务里）
    const desiredNames = [...new Set(extractTagNames(content))]
    const desiredTags = await tagsRepo.findOrCreate(desiredNames)
    const desiredTagIds = new Set(desiredTags.map((t) => t.id))

    await db.transaction('rw', db.notes, db.sync_queue, db.note_tags, async () => {
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

      // 同步 tag 关联
      const currentLinks = await db.note_tags.where('note_id').equals(id).toArray()
      const activeCurrentTagIds = new Set(
        currentLinks.filter((l) => !l.deleted_at).map((l) => l.tag_id),
      )
      const toAdd = [...desiredTagIds].filter((tid) => !activeCurrentTagIds.has(tid))
      const toRemove = [...activeCurrentTagIds].filter((tid) => !desiredTagIds.has(tid))

      for (const tagId of toAdd) {
        await db.note_tags.put({
          note_id: id,
          tag_id: tagId,
          created_at: ts,
          deleted_at: null,
          version: 1,
          sync_status: 'pending',
          last_synced_at: null,
        })
        await db.sync_queue.add({
          type: 'tag_attach',
          entity_type: 'note_tags',
          entity_id: `${id}:${tagId}`,
          priority: 5,
          status: 'pending',
          created_at: ts,
        })
      }
      for (const tagId of toRemove) {
        const link = currentLinks.find((l) => l.tag_id === tagId && !l.deleted_at)
        if (!link) continue
        await db.note_tags.put({
          ...link,
          deleted_at: ts,
          version: link.version + 1,
          sync_status: 'pending',
        })
        await db.sync_queue.add({
          type: 'tag_detach',
          entity_type: 'note_tags',
          entity_id: `${id}:${tagId}`,
          priority: 5,
          status: 'pending',
          created_at: ts,
        })
      }
    })
    emitDataUpdated('notes')
    emitDataUpdated('note_tags')
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
    emitDataUpdated('notes')
    return updated
  },

  /**
   * 软删除（30 天可恢复）
   * - 同时软删该笔记的所有活跃 note_tags 链接（避免 orphan）
   */
  async softDelete(id) {
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.notes, db.sync_queue, db.note_tags, async () => {
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
      // 软删该笔记的活跃 link
      const links = await db.note_tags.where('note_id').equals(id).toArray()
      for (const link of links) {
        if (link.deleted_at) continue
        await db.note_tags.put({
          ...link,
          deleted_at: ts,
          version: link.version + 1,
          sync_status: 'pending',
        })
        await db.sync_queue.add({
          type: 'tag_detach',
          entity_type: 'note_tags',
          entity_id: `${link.note_id}:${link.tag_id}`,
          priority: 5,
          status: 'pending',
          created_at: ts,
        })
      }
    })
    emitDataUpdated('notes')
    emitDataUpdated('note_tags')
    return updated
  },

  /**
   * 恢复软删除
   * - 同时复活被 softDelete 软删的 note_tags links
   */
  async restore(id) {
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.notes, db.sync_queue, db.note_tags, async () => {
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
      // 复活被本次 softDelete 软删的 link（用 updated_at 匹配时间戳）
      const links = await db.note_tags.where('note_id').equals(id).toArray()
      for (const link of links) {
        if (!link.deleted_at) continue
        if (link.deleted_at !== existing.deleted_at) continue // 只复活被 softDelete 软删的
        await db.note_tags.put({
          ...link,
          deleted_at: null,
          version: link.version + 1,
          sync_status: 'pending',
        })
        await db.sync_queue.add({
          type: 'tag_attach',
          entity_type: 'note_tags',
          entity_id: `${link.note_id}:${link.tag_id}`,
          priority: 5,
          status: 'pending',
          created_at: ts,
        })
      }
    })
    emitDataUpdated('notes')
    emitDataUpdated('note_tags')
    return updated
  },

  /**
   * 物理删除（不可恢复）
   * - 删 note 行
   * - 删该 note 的所有 note_tags 链接（避免 orphan）
   * - 清残留 sync_queue entries
   * - **同步删云端**：note 行 + note_tags 链接都从 supabase 物理删（best effort，
   *   云端失败不阻塞本地——下次 sync 不会让云端软删行「复活」回本地）
   * - **自动清理因此变成未用的 tag**（独占此 note 的 tag）：
   *     对这个 note 引用过的每个 tag，检查删完之后还有没有活跃 link，
   *     没有 → hardDelete（本地+云端）
   */
  async hardDelete(id) {
    // 先收一下这个 note 引用了哪些 tag（用来决定哪些 tag 变孤儿）
    const linksBefore = await db.note_tags.where('note_id').equals(id).toArray()
    const tagIdsToCheck = [...new Set(linksBefore.filter((l) => !l.deleted_at).map((l) => l.tag_id))]

    // 1. 云端同步删（先做；云端失败只 warn，不阻塞本地——避免让云端软删行「复活」回本地）
    try {
      const { data: userData } = await supabase.auth.getUser()
      if (userData?.user) {
        // 删云端 note_tags 链接（必须先删，否则会留 orphan 链接）
        const { error: linkErr } = await supabase
          .from('note_tags')
          .delete()
          .eq('note_id', id)
        if (linkErr) throw linkErr
        // 删云端 note 行
        const { error: noteErr } = await supabase
          .from('notes')
          .delete()
          .eq('id', id)
        if (noteErr) throw noteErr
      }
    } catch (e) {
      console.warn(`[hardDelete] 云端删除失败 (note=${id}):`, e?.message || e)
      // 继续本地删除
    }

    // 2. 本地事务：删 note + 它的所有 link + 清 sync_queue 残留
    await db.transaction('rw', db.notes, db.note_tags, db.sync_queue, async () => {
      const existing = await db.notes.get(id)
      if (!existing) return
      const links = await db.note_tags.where('note_id').equals(id).toArray()
      for (const link of links) {
        await db.note_tags.delete([link.note_id, link.tag_id])
      }
      const queueItems = await db.sync_queue
        .where('entity_id').equals(id)
        .and((q) => q.entity_type === 'notes')
        .toArray()
      for (const q of queueItems) {
        await db.sync_queue.delete(q.id)
      }
      await db.notes.delete(id)
    })
    emitDataUpdated('notes')
    emitDataUpdated('note_tags')

    // 3. 自动清理：扫一下「这个 note 用过」的 tag，如果现在没有任何活跃 link + 没软删，hardDelete
    if (tagIdsToCheck.length > 0) {
      const allLinks = await db.note_tags.toArray()
      const activeLinkTagIds = new Set(
        allLinks.filter((l) => !l.deleted_at).map((l) => l.tag_id),
      )
      const orphanTagIds = tagIdsToCheck.filter((tid) => !activeLinkTagIds.has(tid))
      for (const tid of orphanTagIds) {
        const tag = await db.tags.get(tid)
        if (!tag || tag.deleted_at) continue
        await tagsRepo.hardDelete(tid).catch((e) => {
          console.warn(`[hardDelete] auto-clean tag ${tag.name} failed:`, e)
        })
      }
      if (orphanTagIds.length > 0) emitDataUpdated('tags')
    }
  },

  /**
   * 清理 orphan note_tags（note_id 在 db.notes 里不存在的链接）
   * @returns 被清理的 link 数
   */
  async cleanOrphanNoteTags() {
    const allLinks = await db.note_tags.toArray()
    if (allLinks.length === 0) return 0
    const noteIds = [...new Set(allLinks.map((l) => l.note_id))]
    const existingNotes = await db.notes.where('id').anyOf(noteIds).toArray()
    const existingIds = new Set(existingNotes.map((n) => n.id))
    const orphanLinks = allLinks.filter((l) => !existingIds.has(l.note_id))
    for (const link of orphanLinks) {
      await db.note_tags.delete([link.note_id, link.tag_id])
    }
    if (orphanLinks.length > 0) emitDataUpdated('note_tags')
    return orphanLinks.length
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
    emitDataUpdated('notes')
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
    // sort 由 created_at 索引推下去,deleted/archived 过滤在 cursor 里
    // 跑（IO 仍是全表,但省掉 toArray 中间数组 + 一次额外 JS pass）
    return db.notes
      .orderBy('created_at')
      .reverse()
      .filter((n) => {
        if (!includeDeleted && n.deleted_at) return false
        if (!includeArchived && n.archived_at) return false
        return true
      })
      .toArray()
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

  /**
   * 数据统计：返回每个表的 active / deleted / total + orphan 计数
   */
  async getStats() {
    const [allNotes, allTags, allLinks] = await Promise.all([
      db.notes.toArray(),
      db.tags.toArray(),
      db.note_tags.toArray(),
    ])
    const noteIds = new Set(allNotes.map((n) => n.id))
    const orphanLinks = allLinks.filter((l) => !noteIds.has(l.note_id))
    return {
      notes: {
        total: allNotes.length,
        active: allNotes.filter((n) => !n.deleted_at).length,
        deleted: allNotes.filter((n) => !!n.deleted_at).length,
        archived: allNotes.filter((n) => !!n.archived_at).length,
      },
      tags: {
        total: allTags.length,
        active: allTags.filter((t) => !t.deleted_at).length,
        deleted: allTags.filter((t) => !!t.deleted_at).length,
      },
      noteTags: {
        total: allLinks.length,
        active: allLinks.filter((l) => !l.deleted_at).length,
        deleted: allLinks.filter((l) => !!l.deleted_at).length,
        orphan: orphanLinks.length,
      },
    }
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
