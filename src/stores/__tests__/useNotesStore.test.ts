/**
 * useNotesStore 增量更新测试 (EFF-002)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@/lib/db'
import { useNotesStore } from '@/stores/useNotesStore'
import { notesRepo } from '@/repositories/notesRepo'
import type { Note } from '@/types'

const mkNote = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  content: 'hello',
  status: 'pending',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  archived_at: null,
  version: 1,
  sync_status: 'pending',
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

describe('useNotesStore 增量更新 (EFF-002)', () => {
  beforeEach(async () => {
    await db.notes.clear()
    await db.note_tags.clear()
    useNotesStore.setState({ notes: [], loaded: false })
  })

  it('rows 新增单条 → store 直接 add,不调 notesRepo.getAll', async () => {
    const spy = vi.spyOn(notesRepo, 'getAll')
    const note = mkNote({ content: 'hello' })
    useNotesStore.setState({ notes: [], loaded: true })
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { entityType: 'notes', rows: [note] },
    }))
    expect(useNotesStore.getState().notes.find((n) => n.id === 'n1')).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('rows 软删(deleted_at 非空)→ store 移除', async () => {
    const active = mkNote({ content: 'a', sync_status: 'synced' })
    useNotesStore.setState({ notes: [active], loaded: true })
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: {
        entityType: 'notes',
        rows: [{ ...active, deleted_at: '2026-02-01T00:00:00.000Z', version: 2 }],
      },
    }))
    expect(useNotesStore.getState().notes).toEqual([])
  })

  it('removed 物理删 → store 移除', async () => {
    const a = mkNote({ id: 'n1', content: 'a', sync_status: 'synced' })
    const b = mkNote({ id: 'n2', content: 'b', created_at: '2026-01-02T00:00:00.000Z', sync_status: 'synced' })
    useNotesStore.setState({ notes: [a, b], loaded: true })
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { entityType: 'notes', removed: ['n1'] },
    }))
    expect(useNotesStore.getState().notes).toEqual([b])
  })

  it('activeTagId 激活 → 不走增量(noop 等待 reload)', async () => {
    useNotesStore.setState({ activeTagId: 'tag-1', notes: [], loaded: true })
    const before = useNotesStore.getState().notes
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { entityType: 'notes', rows: [mkNote({ content: 'x', sync_status: 'synced' })] },
    }))
    expect(useNotesStore.getState().notes).toBe(before)
  })

  it('searchQuery 过滤时,不匹配的 row 被剔出视图', async () => {
    useNotesStore.setState({ searchQuery: 'foo', notes: [], loaded: true })
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { entityType: 'notes', rows: [mkNote({ content: 'bar baz', sync_status: 'synced' })] },
    }))
    expect(useNotesStore.getState().notes).toEqual([])
  })
})