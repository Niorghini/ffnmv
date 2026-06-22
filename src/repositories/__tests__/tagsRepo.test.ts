/**
 * tagsRepo 测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, openDb } from '@/lib/db'
import { tagsRepo } from '@/repositories/tagsRepo'
import { notesRepo } from '@/repositories/notesRepo'
import type { SyncQueueItem } from '@/types'

describe('tagsRepo', () => {
  beforeEach(async () => {
    await openDb()
    await db.tags.clear()
    await db.notes.clear()
    await db.note_tags.clear()
    await db.sync_queue.clear()
  })

  it('findOrCreate 空数组返回空', async () => {
    expect(await tagsRepo.findOrCreate([])).toEqual([])
  })

  it('findOrCreate 创建新标签 + 颜色稳定', async () => {
    const [t] = await tagsRepo.findOrCreate(['foo'])
    expect(t.name).toBe('foo')
    expect(t.id).toBeTruthy()
    expect(t.color).toBeTruthy()
    expect(t.version).toBe(1)
    expect(t.sync_status).toBe('pending')
  })

  it('findOrCreate 同名复用', async () => {
    const a = await tagsRepo.findOrCreate(['foo'])
    const b = await tagsRepo.findOrCreate(['foo', 'bar'])
    expect(b).toHaveLength(2)
    const foo = b.find((t) => t.name === 'foo')
    expect(foo?.id).toBe(a[0]?.id)
    expect(foo?.color).toBe(a[0]?.color) // 稳定
  })

  it('findOrCreate 多个标签 + 入队', async () => {
    const tags = await tagsRepo.findOrCreate(['a', 'b', 'c'])
    expect(tags).toHaveLength(3)
    const queue = await db.sync_queue.toArray()
    expect(queue).toHaveLength(3)
    expect(queue.every((q) => q.type === 'create' && q.entity_type === 'tags')).toBe(true)
  })

  it('updateName 重命名 + 冲突检测', async () => {
    const [a] = await tagsRepo.findOrCreate(['a'])
    const [b] = await tagsRepo.findOrCreate(['b'])
    const updated = await tagsRepo.updateName(a.id, 'renamed')
    expect(updated.name).toBe('renamed')
    await expect(tagsRepo.updateName(b.id, 'renamed')).rejects.toThrow(/already exists/)
  })

  it('updateName 冲突标签名抛错', async () => {
    const [a] = await tagsRepo.findOrCreate(['a'])
    await tagsRepo.findOrCreate(['b'])
    await expect(tagsRepo.updateName(a.id, 'b')).rejects.toThrow(/already exists/)
  })

  it('softDelete 设 deleted_at + 软删关联', async () => {
    const [t] = await tagsRepo.findOrCreate(['x'])
    const note = await notesRepo.create({ content: 'hi #x', tagIds: [t.id] })
    await tagsRepo.softDelete(t.id)
    const tRow = await db.tags.get(t.id)
    expect(tRow?.deleted_at).toBeTruthy()
    const link = await db.note_tags.get([note.id, t.id])
    expect(link?.deleted_at).toBeTruthy()
  })

  it('merge 关联改向 + source 软删', async () => {
    const [src] = await tagsRepo.findOrCreate(['src'])
    const [dst] = await tagsRepo.findOrCreate(['dst'])
    const n1 = await notesRepo.create({ content: 'a', tagIds: [src.id] })
    const n2 = await notesRepo.create({ content: 'b', tagIds: [src.id] })
    const n3 = await notesRepo.create({ content: 'c', tagIds: [src.id, dst.id] }) // 已含 dst

    await tagsRepo.merge(src.id, dst.id)

    const srcRow = await db.tags.get(src.id)
    expect(srcRow?.deleted_at).toBeTruthy()
    const linksN1 = await db.note_tags.get([n1.id, dst.id])
    const linksN1Src = await db.note_tags.get([n1.id, src.id])
    expect(linksN1).toBeTruthy()
    expect(linksN1Src?.deleted_at).toBeTruthy()

    const linksN2 = await db.note_tags.get([n2.id, dst.id])
    expect(linksN2).toBeTruthy()

    const linksN3Dst = await db.note_tags.get([n3.id, dst.id])
    expect(linksN3Dst).toBeTruthy()
    const linksN3Src = await db.note_tags.get([n3.id, src.id])
    expect(linksN3Src?.deleted_at).toBeTruthy()
  })

  it('merge 自身抛错', async () => {
    const [t] = await tagsRepo.findOrCreate(['x'])
    await expect(tagsRepo.merge(t.id, t.id)).rejects.toThrow()
  })

  it('countsByTag 只数未删', async () => {
    const [t1] = await tagsRepo.findOrCreate(['t1'])
    const [t2] = await tagsRepo.findOrCreate(['t2'])
    const _n1 = await notesRepo.create({ content: 'a', tagIds: [t1.id] })
    const _n2 = await notesRepo.create({ content: 'b', tagIds: [t1.id, t2.id] })
    const n3 = await notesRepo.create({ content: 'c', tagIds: [t1.id] })
    await notesRepo.softDelete(n3.id) // 不应计入 t1
    const counts = await tagsRepo.countsByTag()
    expect(counts.get(t1.id)).toBe(2)
    expect(counts.get(t2.id)).toBe(1)
  })

  it('findUnused 返回没有活跃 note_tags 链接的 tag', async () => {
    const [used] = await tagsRepo.findOrCreate(['used'])
    const [unused] = await tagsRepo.findOrCreate(['unused'])
    const _n = await notesRepo.create({ content: 'x', tagIds: [used.id] })
    const unusedList = await tagsRepo.findUnused()
    const ids = unusedList.map((t) => t.id)
    expect(ids).toContain(unused.id)
    expect(ids).not.toContain(used.id)
  })

  it('findUnused 不算 link.deleted_at 已设的（软删 link 视为未用）', async () => {
    const [t] = await tagsRepo.findOrCreate(['once'])
    const n = await notesRepo.create({ content: 'x', tagIds: [t.id] })
    const links = await db.note_tags.where({ note_id: n.id, tag_id: t.id }).toArray()
    await db.note_tags.put({ ...links[0]!, deleted_at: '2026-01-01T00:00:00.000Z' })
    const unusedList = await tagsRepo.findUnused()
    expect(unusedList.map((x) => x.id)).toContain(t.id)
  })

  it('findUnused 软删的 tag 也算未用（默认 includeSoftDeleted=true）', async () => {
    const [t] = await tagsRepo.findOrCreate(['soft'])
    await tagsRepo.softDelete(t.id)
    const unusedList = await tagsRepo.findUnused()
    expect(unusedList.map((x) => x.id)).toContain(t.id)
  })

  it('findUnused includeSoftDeleted=false 排除软删 tag', async () => {
    const [t] = await tagsRepo.findOrCreate(['soft'])
    await tagsRepo.softDelete(t.id)
    const unusedList = await tagsRepo.findUnused({ includeSoftDeleted: false })
    expect(unusedList.map((x) => x.id)).not.toContain(t.id)
  })

  it('hardDelete 物理删 tag + 清 sync_queue 残留', async () => {
    const [t] = await tagsRepo.findOrCreate(['t'])
    await db.sync_queue.add({
      type: 'update',
      entity_type: 'tags',
      entity_id: t.id,
      priority: 5,
      status: 'pending',
      created_at: '2026-01-01T00:00:00.000Z',
    } as SyncQueueItem)
    expect(await db.tags.get(t.id)).toBeTruthy()
    await tagsRepo.hardDelete(t.id)
    expect(await db.tags.get(t.id)).toBeUndefined()
    const residual = await db.sync_queue.where('entity_id').equals(t.id).toArray()
    expect(residual).toHaveLength(0)
  })

  it('hardDeleteUnused 批量删未用 tag 跳过有引用的', async () => {
    const [used] = await tagsRepo.findOrCreate(['used'])
    const [u1] = await tagsRepo.findOrCreate(['u1'])
    const [u2] = await tagsRepo.findOrCreate(['u2'])
    await notesRepo.create({ content: 'x', tagIds: [used.id] })
    const count = await tagsRepo.hardDeleteUnused()
    expect(count).toBe(2)
    expect(await db.tags.get(u1.id)).toBeUndefined()
    expect(await db.tags.get(u2.id)).toBeUndefined()
    expect(await db.tags.get(used.id)).toBeTruthy()
  })
})