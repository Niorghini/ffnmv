/**
 * tagsRepo —— 标签表 CRUD
 * - findOrCreate 输入 name 数组，返回 tag 实体（含 id/name/color）
 * - 颜色由 name 哈希稳定生成（colorFromName）
 * - merge 把 source 的关联改到 target，然后删 source
 */
import { v4 as uuidv4 } from 'uuid'
import { db, nowIso } from '@/lib/db'
import { colorFromName } from '@/lib/tags'

const enqueue = (type, tagId) =>
  db.sync_queue.add({
    type,
    entity_type: 'tags',
    entity_id: tagId,
    priority: 5,
    status: 'pending',
    created_at: nowIso(),
  })

const enqueueTagDetach = (noteId, tagId) =>
  db.sync_queue.add({
    type: 'tag_detach',
    entity_type: 'note_tags',
    entity_id: `${noteId}:${tagId}`,
    priority: 5,
    status: 'pending',
    created_at: nowIso(),
  })

export const tagsRepo = {
  /**
   * 输入 name 数组，返回已存在/新建的 tag 实体列表
   * 同名去重（按 name）
   */
  async findOrCreate(names) {
    if (!names || names.length === 0) return []
    const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
    if (cleaned.length === 0) return []

    const result = []
    const toCreate = []

    await db.transaction('rw', db.tags, db.sync_queue, async () => {
      const existing = await db.tags.where('name').anyOf(cleaned).toArray()
      const existingByName = new Map(existing.map((t) => [t.name, t]))
      for (const name of cleaned) {
        const found = existingByName.get(name)
        if (found) {
          result.push(found)
        } else {
          toCreate.push(name)
        }
      }
      for (const name of toCreate) {
        const tag = {
          id: uuidv4(),
          name,
          color: colorFromName(name),
          created_at: nowIso(),
          updated_at: nowIso(),
          deleted_at: null,
          version: 1,
          sync_status: 'pending',
          last_synced_at: null,
        }
        await db.tags.add(tag)
        await enqueue('create', tag.id)
        result.push(tag)
      }
    })
    return result
  },

  async getById(id) {
    return db.tags.get(id)
  },

  async getByIds(ids) {
    if (!ids || ids.length === 0) return []
    return db.tags.where('id').anyOf(ids).toArray()
  },

  async getByName(name) {
    return db.tags.where('name').equals(name).first()
  },

  async getAll({ includeDeleted = false } = {}) {
    const rows = await db.tags.toArray()
    return rows
      .filter((t) => (includeDeleted ? true : !t.deleted_at))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  },

  async updateName(id, newName) {
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.tags, db.sync_queue, async () => {
      const existing = await db.tags.get(id)
      if (!existing) throw new Error(`Tag ${id} not found`)
      if (existing.deleted_at) throw new Error('Cannot update a deleted tag')
      const conflict = await db.tags.where('name').equals(newName).first()
      if (conflict && conflict.id !== id) {
        throw new Error(`Tag name "${newName}" already exists`)
      }
      updated = {
        ...existing,
        name: newName,
        updated_at: ts,
        version: existing.version + 1,
        sync_status: 'pending',
      }
      await db.tags.put(updated)
      await enqueue('update', id)
    })
    return updated
  },

  async setColor(id, color) {
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.tags, db.sync_queue, async () => {
      const existing = await db.tags.get(id)
      if (!existing) throw new Error(`Tag ${id} not found`)
      if (existing.color === color) {
        updated = existing
        return
      }
      updated = {
        ...existing,
        color,
        updated_at: ts,
        version: existing.version + 1,
        sync_status: 'pending',
      }
      await db.tags.put(updated)
      await enqueue('update', id)
    })
    return updated
  },

  async softDelete(id) {
    const ts = nowIso()
    let updated
    await db.transaction('rw', db.tags, db.sync_queue, db.note_tags, async () => {
      const existing = await db.tags.get(id)
      if (!existing) throw new Error(`Tag ${id} not found`)
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
      await db.tags.put(updated)
      await enqueue('delete', id)
      // 软删除 tag 时也软删除所有 note_tags 关联
      const links = await db.note_tags.where('tag_id').equals(id).toArray()
      for (const link of links) {
        await db.note_tags.put({
          ...link,
          deleted_at: ts,
          version: link.version + 1,
          sync_status: 'pending',
        })
        await enqueueTagDetach(link.note_id, id)
      }
    })
    return updated
  },

  /**
   * 合并 source → target
   * 1. 把所有 (note_id, source_id) 关联改到 (note_id, target_id)（去重）
   *    - 若 (note_id, target_id) 已活跃：软删 source 端
   *    - 若 (note_id, target_id) 不存在 / 已软删：软删 source 端 + 复活/新建 target 端
   * 2. 软删除 source tag
   */
  async merge(sourceId, targetId) {
    if (sourceId === targetId) throw new Error('Cannot merge a tag into itself')
    const ts = nowIso()
    let source
    let target
    await db.transaction('rw', db.tags, db.note_tags, db.sync_queue, async () => {
      source = await db.tags.get(sourceId)
      target = await db.tags.get(targetId)
      if (!source || !target) throw new Error('Source or target tag not found')
      const links = await db.note_tags.where('tag_id').equals(sourceId).toArray()
      for (const link of links) {
        if (link.deleted_at) continue
        const targetLink = await db.note_tags.get([link.note_id, targetId])
        if (targetLink && !targetLink.deleted_at) {
          // 已有 (note_id, target) 活跃 → 软删 source 端
          await db.note_tags.put({
            ...link,
            deleted_at: ts,
            version: link.version + 1,
            sync_status: 'pending',
          })
          await enqueueTagDetach(link.note_id, sourceId)
        } else {
          // 软删 source 端
          await db.note_tags.put({
            ...link,
            deleted_at: ts,
            version: link.version + 1,
            sync_status: 'pending',
          })
          await enqueueTagDetach(link.note_id, sourceId)
          // 复活或新建 target 端
          if (targetLink) {
            await db.note_tags.put({
              ...targetLink,
              deleted_at: null,
              version: targetLink.version + 1,
              sync_status: 'pending',
            })
          } else {
            await db.note_tags.put({
              note_id: link.note_id,
              tag_id: targetId,
              created_at: link.created_at,
              deleted_at: null,
              version: 1,
              sync_status: 'pending',
              last_synced_at: null,
            })
          }
          await db.sync_queue.add({
            type: 'tag_attach',
            entity_type: 'note_tags',
            entity_id: `${link.note_id}:${targetId}`,
            priority: 5,
            status: 'pending',
            created_at: ts,
          })
        }
      }
      // 软删除 source
      const updated = {
        ...source,
        deleted_at: ts,
        updated_at: ts,
        version: source.version + 1,
        sync_status: 'pending',
      }
      await db.tags.put(updated)
      await enqueue('delete', sourceId)
    })
    return { source, target }
  },

  /**
   * 给同步层直接 put（绕过入队）
   */
  async _putDirect(tag) {
    await db.tags.put(tag)
  },

  /**
   * 统计每个 tag 的笔记数（未软删的）
   */
  async countsByTag({ includeDeleted = false } = {}) {
    const links = await db.note_tags.toArray()
    const visibleLinks = includeDeleted ? links : links.filter((l) => !l.deleted_at)
    const noteIds = [...new Set(visibleLinks.map((l) => l.note_id))]
    if (noteIds.length === 0) return new Map()
    const notes = await db.notes.where('id').anyOf(noteIds).toArray()
    const visibleNotes = new Set(
      notes.filter((n) => !n.deleted_at).map((n) => n.id),
    )
    const counts = new Map()
    for (const l of visibleLinks) {
      if (!visibleNotes.has(l.note_id)) continue
      counts.set(l.tag_id, (counts.get(l.tag_id) || 0) + 1)
    }
    return counts
  },
}
