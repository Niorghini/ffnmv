/**
 * cleanup 测试
 * - 30 天前 deleted 的硬删
 * - 30 天内的保留
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, openDb } from '@/lib/db'
import { runCleanup } from '@/lib/cleanup'
import type { Note, Tag, NoteTag, ConflictRecord } from '@/types'

const NOW = new Date('2026-06-02T00:00:00.000Z').getTime()
const daysAgo = (n: number): string => new Date(NOW - n * 86400000).toISOString()

describe('cleanup', () => {
  beforeEach(async () => {
    await openDb()
    await db.notes.clear()
    await db.tags.clear()
    await db.note_tags.clear()
    await db.sync_queue.clear()
    await db.conflicts.clear()
  })

  it('超过 30 天的软删笔记硬删', async () => {
    await db.notes.add({
      id: 'old', content: '', status: 'pending',
      created_at: daysAgo(60), updated_at: daysAgo(60),
      deleted_at: daysAgo(31), version: 1, sync_status: 'synced',
      archived_at: null, last_synced_at: null,
    } as Note)
    await db.notes.add({
      id: 'new', content: '', status: 'pending',
      created_at: daysAgo(10), updated_at: daysAgo(10),
      deleted_at: daysAgo(5), version: 1, sync_status: 'synced',
      archived_at: null, last_synced_at: null,
    } as Note)
    const stats = await runCleanup({ now: NOW })
    expect(stats.notes).toBe(1)
    expect(await db.notes.get('old')).toBeUndefined()
    expect(await db.notes.get('new')).toBeTruthy()
  })

  it('关联 note_tags 一起清', async () => {
    await db.notes.add({
      id: 'old', content: '', status: 'pending',
      created_at: daysAgo(60), updated_at: daysAgo(60),
      deleted_at: daysAgo(31), version: 1, sync_status: 'synced',
      archived_at: null, last_synced_at: null,
    } as Note)
    await db.note_tags.add({
      note_id: 'old', tag_id: 't1', created_at: daysAgo(60),
      updated_at: daysAgo(60), deleted_at: daysAgo(31), version: 1, sync_status: 'synced',
      last_synced_at: null,
    } as NoteTag)
    const stats = await runCleanup({ now: NOW })
    expect(stats.note_tags).toBe(1)
    expect(await db.note_tags.get(['old', 't1'])).toBeUndefined()
  })

  it('关联 tags 一起清', async () => {
    await db.tags.add({
      id: 't1', name: 'foo', color: '#000',
      created_at: daysAgo(60), updated_at: daysAgo(60),
      deleted_at: daysAgo(31), version: 1, sync_status: 'synced',
      last_synced_at: null,
    } as Tag)
    const stats = await runCleanup({ now: NOW })
    expect(stats.tags).toBe(1)
    expect(await db.tags.get('t1')).toBeUndefined()
  })

  it('老的 conflicts 也清', async () => {
    await db.conflicts.add({
      id: 'c1', entity_type: 'notes', entity_id: 'n1',
      local_data: {} as Note, cloud_data: {} as Note, created_at: daysAgo(31),
    } as ConflictRecord)
    const stats = await runCleanup({ now: NOW })
    expect(stats.conflicts).toBe(1)
    expect(await db.conflicts.get('c1')).toBeUndefined()
  })

  it('无过期 → stats 全 0', async () => {
    await db.notes.add({
      id: 'recent', content: '', status: 'pending',
      created_at: daysAgo(5), updated_at: daysAgo(5),
      deleted_at: daysAgo(5), version: 1, sync_status: 'synced',
      archived_at: null, last_synced_at: null,
    } as Note)
    const stats = await runCleanup({ now: NOW })
    expect(stats.notes).toBe(0)
  })
})