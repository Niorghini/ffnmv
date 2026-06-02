/**
 * notesRepo 测试
 * - create: 写入 + sync_queue 入队 + version=1
 * - update: bump version + updated_at + sync_status=pending + 入队
 * - softDelete: 设 deleted_at + bump + 入队
 * - restore: 清 deleted_at + bump + 入队
 * - getAll: 排除 deleted
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, openDb } from '@/lib/db'
import { notesRepo } from '@/repositories/notesRepo'

describe('notesRepo', () => {
  beforeEach(async () => {
    await openDb()
    await db.notes.clear()
    await db.sync_queue.clear()
    await db.note_tags.clear()
  })

  it('create 写入笔记 + 入队 + 默认字段', async () => {
    const note = await notesRepo.create({ content: 'hello' })
    expect(note.id).toBeTruthy()
    expect(note.content).toBe('hello')
    expect(note.status).toBe('pending')
    expect(note.version).toBe(1)
    expect(note.deleted_at).toBeNull()
    expect(note.sync_status).toBe('pending')
    const queue = await db.sync_queue.toArray()
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ type: 'create', entity_type: 'notes', priority: 1 })
  })

  it('create 接受 tagIds 并写入 note_tags', async () => {
    const note = await notesRepo.create({ content: '#foo #bar', tagIds: ['t1', 't2'] })
    const links = await db.note_tags.where('note_id').equals(note.id).toArray()
    expect(links).toHaveLength(2)
    expect(links.map((l) => l.tag_id).sort()).toEqual(['t1', 't2'])
    // 1 note + 2 tag_attach 入队
    const queue = await db.sync_queue.toArray()
    expect(queue).toHaveLength(3)
    expect(queue.filter((q) => q.type === 'tag_attach')).toHaveLength(2)
  })

  it('update bump version + updated_at + sync_status=pending', async () => {
    const note = await notesRepo.create({ content: 'v1' })
    const originalVersion = note.version
    const originalUpdated = note.updated_at
    // 等待 1ms 保证 updated_at 不同
    await new Promise((r) => setTimeout(r, 5))
    const updated = await notesRepo.update(note.id, { content: 'v2' })
    expect(updated.version).toBe(originalVersion + 1)
    expect(updated.content).toBe('v2')
    expect(updated.updated_at).not.toBe(originalUpdated)
    expect(updated.sync_status).toBe('pending')
  })

  it('update 不存在的笔记抛错', async () => {
    await expect(notesRepo.update('nonexistent', { content: 'x' })).rejects.toThrow()
  })

  it('setStatus 合法值', async () => {
    const note = await notesRepo.create({ content: 'x' })
    const completed = await notesRepo.setStatus(note.id, 'completed')
    expect(completed.status).toBe('completed')
    expect(completed.version).toBe(note.version + 1)
  })

  it('setStatus 拒绝非法值', async () => {
    const note = await notesRepo.create({ content: 'x' })
    await expect(notesRepo.setStatus(note.id, 'invalid')).rejects.toThrow()
  })

  it('setStatus 同值不动', async () => {
    const note = await notesRepo.create({ content: 'x' })
    const before = await db.sync_queue.count()
    const again = await notesRepo.setStatus(note.id, 'pending')
    expect(again.version).toBe(note.version)
    const after = await db.sync_queue.count()
    expect(after).toBe(before)
  })

  it('softDelete 设 deleted_at + bump', async () => {
    const note = await notesRepo.create({ content: 'x' })
    const deleted = await notesRepo.notesRepo ? null : await notesRepo.softDelete(note.id)
    expect(deleted.deleted_at).toBeTruthy()
    expect(deleted.version).toBe(note.version + 1)
    const queue = await db.sync_queue.toArray()
    expect(queue.find((q) => q.type === 'delete' && q.entity_id === note.id)).toBeTruthy()
  })

  it('restore 清 deleted_at + bump', async () => {
    const note = await notesRepo.create({ content: 'x' })
    await notesRepo.softDelete(note.id)
    const restored = await notesRepo.restore(note.id)
    expect(restored.deleted_at).toBeNull()
    expect(restored.version).toBe(note.version + 2)
  })

  it('getAll 默认排除 deleted', async () => {
    const a = await notesRepo.create({ content: 'a' })
    const b = await notesRepo.create({ content: 'b' })
    await notesRepo.softDelete(b.id)
    const all = await notesRepo.getAll()
    expect(all.map((n) => n.id)).toEqual([b.id, a.id].filter((id) => id === a.id))
  })

  it('getAll includeDeleted 看到全部', async () => {
    const a = await notesRepo.create({ content: 'a' })
    const b = await notesRepo.create({ content: 'b' })
    await notesRepo.softDelete(b.id)
    const all = await notesRepo.getAll({ includeDeleted: true })
    expect(all).toHaveLength(2)
  })

  it('update 软删除后的笔记抛错', async () => {
    const note = await notesRepo.create({ content: 'x' })
    await notesRepo.softDelete(note.id)
    await expect(notesRepo.update(note.id, { content: 'y' })).rejects.toThrow()
  })
})
