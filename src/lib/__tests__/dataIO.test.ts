/**
 * dataIO 测试
 * - export: 包含所有 notes/tags/note_tags
 * - validate: 拒绝非对象、错版本、缺字段
 * - import: 按主键 upsert（新增 vs 覆盖计数正确）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, openDb } from '@/lib/db'
import { exportData, importData, validateImport } from '@/lib/dataIO'
import type { Note, Tag, NoteTag } from '@/types'

const mkNote = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  content: 'a',
  status: 'pending',
  created_at: '2026-06-01',
  updated_at: '2026-06-01',
  deleted_at: null,
  archived_at: null,
  version: 1,
  sync_status: 'synced',
  last_synced_at: null,
  image_path: null,
  image_thumb_path: null,
  image_thumb_sm_path: null,
  image_uploaded_at: null,
  image_mime: null,
  image_size: null,
  image_width: null,
  image_height: null,
  ...over,
})

const mkTag = (over: Partial<Tag> = {}): Tag => ({
  id: 't1',
  name: 'work',
  color: '#000',
  created_at: '2026-06-01',
  updated_at: '2026-06-01',
  deleted_at: null,
  version: 1,
  sync_status: 'synced',
  last_synced_at: null,
  ...over,
})

const mkLink = (over: Partial<NoteTag> = {}): NoteTag => ({
  note_id: 'n1',
  tag_id: 't1',
  created_at: '2026-06-01',
  updated_at: '2026-06-01',
  deleted_at: null,
  version: 1,
  sync_status: 'synced',
  last_synced_at: null,
  ...over,
})

describe('dataIO', () => {
  beforeEach(async () => {
    await openDb()
    await db.notes.clear()
    await db.tags.clear()
    await db.note_tags.clear()
    await db.sync_queue.clear()
  })

  describe('exportData', () => {
    it('空数据库导出：notes/tags/noteTags 都是空数组', async () => {
      const data = await exportData()
      expect(data.version).toBe(1)
      expect(typeof data.exportedAt).toBe('string')
      expect(data.notes).toEqual([])
      expect(data.tags).toEqual([])
      expect(data.noteTags).toEqual([])
    })

    it('包含所有已写入的 notes/tags/note_tags', async () => {
      const note = mkNote()
      const tag = mkTag()
      const link = mkLink()
      await db.notes.add(note)
      await db.tags.add(tag)
      await db.note_tags.add(link)
      const data = await exportData()
      expect(data.notes).toEqual([note])
      expect(data.tags).toEqual([tag])
      expect(data.noteTags).toEqual([link])
    })

    it('包含软删记录', async () => {
      const note = mkNote({ deleted_at: '2026-06-02T00:00:00Z' })
      await db.notes.add(note)
      const data = await exportData()
      expect(data.notes[0]?.deleted_at).toBe('2026-06-02T00:00:00Z')
    })
  })

  describe('validateImport', () => {
    it('拒绝非对象', () => {
      expect(validateImport(null).ok).toBe(false)
      expect(validateImport('x').ok).toBe(false)
      expect(validateImport([] as unknown).ok).toBe(false)
    })
    it('拒绝错版本', () => {
      expect(validateImport({ version: 99, notes: [], tags: [], noteTags: [] }).ok).toBe(false)
    })
    it('拒绝缺字段', () => {
      expect(validateImport({ version: 1, notes: [], tags: [] }).ok).toBe(false)
    })
    it('拒绝非数组字段', () => {
      expect(validateImport({ version: 1, notes: 'x', tags: [], noteTags: [] }).ok).toBe(false)
    })
    it('通过合法结构', () => {
      expect(validateImport({ version: 1, notes: [], tags: [], noteTags: [] }).ok).toBe(true)
    })
  })

  describe('importData', () => {
    const makePayload = (notes: Note[], tags: Tag[], noteTags: NoteTag[]) => ({
      version: 1,
      exportedAt: '2026-06-03T00:00:00Z',
      notes,
      tags,
      noteTags,
    })

    it('空导入不报错', async () => {
      const stats = await importData(makePayload([], [], []))
      expect(stats.notes.added).toBe(0)
      expect(stats.notes.updated).toBe(0)
    })

    it('新增：正确统计 added', async () => {
      const stats = await importData(makePayload([mkNote()], [], []))
      expect(stats.notes.added).toBe(1)
      expect(stats.notes.updated).toBe(0)
      const all = await db.notes.toArray()
      expect(all).toHaveLength(1)
    })

    it('覆盖：同 id 不同内容 → 更新本地', async () => {
      await db.notes.add(mkNote({ content: 'old' }))
      const stats = await importData(makePayload(
        [mkNote({ content: 'new', status: 'completed', updated_at: '2026-06-02', version: 2 })],
        [],
        [],
      ))
      expect(stats.notes.updated).toBe(1)
      const n = await db.notes.get('n1')
      expect(n?.content).toBe('new')
      expect(n?.status).toBe('completed')
    })

    it('混合：部分新增部分覆盖', async () => {
      await db.notes.add(mkNote({ content: 'old' }))
      const stats = await importData(makePayload(
        [
          mkNote({ content: 'updated', updated_at: '2026-06-02', version: 2 }),
          mkNote({ id: 'n2', content: 'fresh', created_at: '2026-06-03', updated_at: '2026-06-03' }),
        ],
        [],
        [],
      ))
      expect(stats.notes.added).toBe(1)
      expect(stats.notes.updated).toBe(1)
      expect(await db.notes.count()).toBe(2)
    })

    it('导入后 sync_status 强制 pending', async () => {
      await importData(makePayload([mkNote()], [], []))
      const n = await db.notes.get('n1')
      expect(n?.sync_status).toBe('pending')
    })

    it('noteTags 用 [note_id+tag_id] 去重', async () => {
      await db.notes.add(mkNote())
      await db.tags.add(mkTag())
      await db.note_tags.add(mkLink())
      const stats = await importData(makePayload(
        [],
        [],
        [mkLink({ updated_at: '2026-06-02', version: 2 })],
      ))
      expect(stats.noteTags.updated).toBe(1)
      expect(await db.note_tags.count()).toBe(1)
    })

    it('保留软删记录（deleted_at 非空）', async () => {
      await importData(makePayload(
        [mkNote({ content: 'in trash', deleted_at: '2026-06-02T00:00:00Z' })],
        [],
        [],
      ))
      const n = await db.notes.get('n1')
      expect(n?.deleted_at).toBe('2026-06-02T00:00:00Z')
    })

    it('拒绝错版本文件', async () => {
      await expect(importData({ version: 99, notes: [], tags: [], noteTags: [] })).rejects.toThrow(/不支持的版本/)
    })

    it('拒绝非对象', async () => {
      await expect(importData(null)).rejects.toThrow()
      await expect(importData('x')).rejects.toThrow()
    })
  })
})