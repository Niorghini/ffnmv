/**
 * useNotesStore 增量更新测试 (EFF-002)
 * - 验证 data-updated 带 rows/removed 时走增量(不调 notesRepo.getAll)
 * - 验证 activeTagId / note_tags 事件时 fallback 全量
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@/lib/db'
import { useNotesStore } from '@/stores/useNotesStore'
import { notesRepo } from '@/repositories/notesRepo'

describe('useNotesStore 增量更新 (EFF-002)', () => {
  beforeEach(async () => {
    // 清表
    await db.notes.clear()
    await db.note_tags.clear()
    // 监听器已自动注册,直接 reset store
    useNotesStore.setState({ notes: [], loaded: false })
  })

  it('rows 新增单条 → store 直接 add,不调 notesRepo.getAll', async () => {
    const spy = vi.spyOn(notesRepo, 'getAll')
    const note = {
      id: 'n1', content: 'hello', status: 'pending', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, archived_at: null,
      version: 1, sync_status: 'pending', last_synced_at: null,
    }
    // 先 seed 一条让 store 有内容
    useNotesStore.setState({ notes: [], loaded: true })
    // 直接派发事件
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { entityType: 'notes', rows: [note] },
    }))
    // 等一帧(setState 是同步的,但走 zustand 不需要 await)
    expect(useNotesStore.getState().notes.find((n) => n.id === 'n1')).toBeTruthy()
    // getAll 没被调用
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('rows 软删(deleted_at 非空)→ store 移除', async () => {
    const active = {
      id: 'n1', content: 'a', status: 'pending', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, archived_at: null,
      version: 1, sync_status: 'synced', last_synced_at: null,
    }
    useNotesStore.setState({ notes: [active], loaded: true })
    // 派发软删
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: {
        entityType: 'notes',
        rows: [{ ...active, deleted_at: '2026-02-01T00:00:00.000Z', version: 2 }],
      },
    }))
    // store 把它移走(deleted_at 非空 → matchesView false → delete)
    expect(useNotesStore.getState().notes).toEqual([])
  })

  it('removed 物理删 → store 移除', async () => {
    const a = { id: 'n1', content: 'a', status: 'pending', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, archived_at: null,
      version: 1, sync_status: 'synced', last_synced_at: null }
    const b = { id: 'n2', content: 'b', status: 'pending', created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z', deleted_at: null, archived_at: null,
      version: 1, sync_status: 'synced', last_synced_at: null }
    useNotesStore.setState({ notes: [a, b], loaded: true })
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { entityType: 'notes', removed: ['n1'] },
    }))
    expect(useNotesStore.getState().notes).toEqual([b])
  })

  it('activeTagId 激活 → 不走增量(noop 等待 reload)', async () => {
    useNotesStore.setState({ activeTagId: 'tag-1', notes: [], loaded: true })
    // 监听器会返回 false,内部 schedule reload(我们不测 reload,只测 store 不被错改)
    const before = useNotesStore.getState().notes
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { entityType: 'notes', rows: [{
        id: 'n1', content: 'x', status: 'pending', created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, archived_at: null,
        version: 1, sync_status: 'synced', last_synced_at: null,
      }] },
    }))
    // 增量的 no-op 路径,notes 数组不增
    expect(useNotesStore.getState().notes).toBe(before)
  })

  it('searchQuery 过滤时,不匹配的 row 被剔出视图', async () => {
    useNotesStore.setState({ searchQuery: 'foo', notes: [], loaded: true })
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { entityType: 'notes', rows: [{
        id: 'n1', content: 'bar baz', status: 'pending', created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, archived_at: null,
        version: 1, sync_status: 'synced', last_synced_at: null,
      }] },
    }))
    expect(useNotesStore.getState().notes).toEqual([])
  })
})
