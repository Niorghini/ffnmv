/**
 * autoArchive 测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, openDb } from '@/lib/db'
import { notesRepo } from '@/repositories/notesRepo'
import {
  runArchive,
  getArchiveAfterDays,
  setArchiveAfterDays,
  startArchiveScheduler,
  stopArchiveScheduler,
} from '@/lib/autoArchive'

const NOW = new Date('2026-06-02T00:00:00.000Z').getTime()
const daysAgo = (n: number): string => new Date(NOW - n * 86400000).toISOString()

describe('autoArchive', () => {
  beforeEach(async () => {
    await openDb()
    await db.notes.clear()
    await db.sync_queue.clear()
    await db.sync_metadata.clear()
  })

  it('getArchiveAfterDays 默认 30', async () => {
    expect(await getArchiveAfterDays()).toBe(30)
  })

  it('setArchiveAfterDays 拒绝非法值', async () => {
    await expect(setArchiveAfterDays(15)).rejects.toThrow()
  })

  it('setArchiveAfterDays 接受 7 / 30 / -1', async () => {
    await setArchiveAfterDays(7)
    expect(await getArchiveAfterDays()).toBe(7)
    await setArchiveAfterDays(-1)
    expect(await getArchiveAfterDays()).toBe(-1)
  })

  it('-1（永不）直接返回 0', async () => {
    await setArchiveAfterDays(-1)
    await notesRepo.create({ content: 'old completed' })
    const all = await db.notes.toArray()
    await db.notes.update(all[0].id, {
      status: 'completed',
      updated_at: daysAgo(100),
    })
    const count = await runArchive({ now: NOW })
    expect(count).toBe(0)
  })

  it('30 天策略：已处理 30 天前的归档', async () => {
    await setArchiveAfterDays(30)
    const old = await notesRepo.create({ content: 'old' })
    await db.notes.update(old.id, { status: 'completed', updated_at: daysAgo(31) })
    const recent = await notesRepo.create({ content: 'recent' })
    await db.notes.update(recent.id, { status: 'completed', updated_at: daysAgo(5) })
    const count = await runArchive({ now: NOW })
    expect(count).toBe(1)
    const oldAfter = await db.notes.get(old.id)
    expect(oldAfter?.archived_at).toBeTruthy()
    const recentAfter = await db.notes.get(recent.id)
    expect(recentAfter?.archived_at).toBeNull()
  })

  it('7 天策略', async () => {
    await setArchiveAfterDays(7)
    const old = await notesRepo.create({ content: 'a' })
    await db.notes.update(old.id, { status: 'completed', updated_at: daysAgo(8) })
    const fresh = await notesRepo.create({ content: 'b' })
    await db.notes.update(fresh.id, { status: 'completed', updated_at: daysAgo(2) })
    const count = await runArchive({ now: NOW })
    expect(count).toBe(1)
    expect((await db.notes.get(old.id))?.archived_at).toBeTruthy()
    expect((await db.notes.get(fresh.id))?.archived_at).toBeNull()
  })

  it('pending 笔记不归档', async () => {
    await setArchiveAfterDays(30)
    const n = await notesRepo.create({ content: 'x' })
    await db.notes.update(n.id, { updated_at: daysAgo(100) }) // 保持 pending
    const count = await runArchive({ now: NOW })
    expect(count).toBe(0)
  })

  it('startArchiveScheduler / stopArchiveScheduler 不重复启动', () => {
    startArchiveScheduler()
    startArchiveScheduler() // 第二次 no-op
    stopArchiveScheduler()
  })
})