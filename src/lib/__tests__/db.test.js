/**
 * Dexie db 层基础测试
 * - 7 个 store 创建
 * - 索引存在
 * - 基础 CRUD
 * - v0.7.0 升级逻辑
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db, openDb, detectAndPurgeLegacy, wasLegacyCleaned, markLegacyCleaned, DB_NAME } from '@/lib/db'

describe('db', () => {
  beforeEach(async () => {
    // setup.js 已经在 afterEach 删库；这里确保打开
    await openDb()
  })

  it('创建 7 个 store', () => {
    const names = [...db.tables].map((t) => t.name).sort()
    expect(names).toEqual([
      'cache',
      'conflicts',
      'note_tags',
      'notes',
      'sync_metadata',
      'sync_queue',
      'tags',
    ])
  })

  it('notes 索引齐全', () => {
    const table = db.notes
    const indexNames = table.schema.indexes.map((i) => i.name)
    // 主键 'id' 在 primKey 里，不在 indexes 里
    expect(indexNames).toEqual(
      expect.arrayContaining(['status', 'created_at', 'updated_at', 'sync_status', 'deleted_at']),
    )
  })

  it('note_tags 复合主键', () => {
    const table = db.note_tags
    expect(table.schema.primKey.keyPath).toEqual(['note_id', 'tag_id'])
  })

  it('sync_queue 自增主键', () => {
    expect(db.sync_queue.schema.primKey.auto).toBe(true)
  })

  it('notes 基础 CRUD', async () => {
    const note = {
      id: 'n1',
      content: 'hello',
      status: 'pending',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
      version: 1,
      sync_status: 'pending',
      last_synced_at: null,
    }
    await db.notes.add(note)
    const got = await db.notes.get('n1')
    expect(got).toMatchObject({ id: 'n1', content: 'hello' })
    await db.notes.delete('n1')
    expect(await db.notes.get('n1')).toBeUndefined()
  })

  it('notes 按 created_at 倒序遍历', async () => {
    await db.notes.bulkAdd([
      { id: 'a', content: 'first', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', status: 'pending', sync_status: 'pending', version: 1, deleted_at: null },
      { id: 'b', content: 'second', created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z', status: 'pending', sync_status: 'pending', version: 1, deleted_at: null },
      { id: 'c', content: 'third', created_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z', status: 'pending', sync_status: 'pending', version: 1, deleted_at: null },
    ])
    const ordered = await db.notes.orderBy('created_at').reverse().toArray()
    expect(ordered.map((n) => n.id)).toEqual(['c', 'b', 'a'])
  })

  it('legacy 标记位默认 false', () => {
    expect(wasLegacyCleaned()).toBe(false)
  })

  it('markLegacyCleaned 持久化', () => {
    markLegacyCleaned()
    expect(wasLegacyCleaned()).toBe(true)
  })

  it('detectAndPurgeLegacy 在无 legacy 时返回 false', async () => {
    const purged = await detectAndPurgeLegacy()
    expect(purged).toBe(false)
  })
})
