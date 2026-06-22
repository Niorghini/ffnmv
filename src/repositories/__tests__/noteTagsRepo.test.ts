/**
 * noteTagsRepo 测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, openDb } from '@/lib/db'
import { noteTagsRepo } from '@/repositories/noteTagsRepo'

describe('noteTagsRepo', () => {
  beforeEach(async () => {
    await openDb()
    await db.note_tags.clear()
    await db.sync_queue.clear()
  })

  it('attach 新增关联 + 入队', async () => {
    const attached = await noteTagsRepo.attach('n1', ['t1', 't2'])
    expect(attached.sort()).toEqual(['t1', 't2'])
    const links = await db.note_tags.toArray()
    expect(links).toHaveLength(2)
    const queue = await db.sync_queue.toArray()
    expect(queue.filter((q) => q.type === 'tag_attach')).toHaveLength(2)
  })

  it('attach 已存在的跳过', async () => {
    await noteTagsRepo.attach('n1', ['t1'])
    await db.sync_queue.clear()
    const attached = await noteTagsRepo.attach('n1', ['t1', 't2'])
    expect(attached).toEqual(['t2']) // t1 已存在
    const queue = await db.sync_queue.toArray()
    expect(queue).toHaveLength(1)
  })

  it('detach 软删除 + 入队', async () => {
    await noteTagsRepo.attach('n1', ['t1', 't2'])
    await db.sync_queue.clear()
    const detached = await noteTagsRepo.detach('n1', ['t1'])
    expect(detached).toEqual(['t1'])
    const row = await db.note_tags.get(['n1', 't1'])
    expect(row?.deleted_at).toBeTruthy()
    const queue = await db.sync_queue.toArray()
    expect(queue.filter((q) => q.type === 'tag_detach')).toHaveLength(1)
  })

  it('replaceAll diff 正确', async () => {
    await noteTagsRepo.attach('n1', ['t1', 't2', 't3'])
    await db.sync_queue.clear()
    await noteTagsRepo.replaceAll('n1', ['t2', 't4'])
    const active = await noteTagsRepo.getByNote('n1')
    expect(active.map((l) => l.tag_id).sort()).toEqual(['t2', 't4'])
    // 入队：1 attach (t4) + 2 detach (t1, t3) = 3 条
    const queue = await db.sync_queue.toArray()
    expect(queue.filter((q) => q.type === 'tag_attach')).toHaveLength(1)
    expect(queue.filter((q) => q.type === 'tag_detach')).toHaveLength(2)
  })

  it('getByNote 排除软删', async () => {
    await noteTagsRepo.attach('n1', ['t1', 't2'])
    await noteTagsRepo.detach('n1', ['t1'])
    const active = await noteTagsRepo.getByNote('n1')
    expect(active.map((l) => l.tag_id)).toEqual(['t2'])
  })
})