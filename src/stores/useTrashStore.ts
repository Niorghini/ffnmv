/**
 * 回收站 store
 * - 缓存软删除的 notes (deleted_at != null)
 * - 监听 data-updated: 优先增量,否则全量 reload(50ms debounce)
 *   - rows: 软删的进来(deleted_at 非空),恢复的出去
 *   - removed: 物理删 / 永久清空 → 直接移除
 */
import { create } from 'zustand'
import { notesRepo } from '@/repositories/notesRepo'
import type { Note, DataUpdatedDetail } from '@/types'

interface TrashState {
  notes: Note[]
  loaded: boolean
}

interface TrashActions {
  load: () => Promise<void>
}

type TrashStore = TrashState & TrashActions

let _reloadTimer: ReturnType<typeof setTimeout> | null = null
const scheduleReload = (load: () => Promise<void>): void => {
  if (_reloadTimer) return
  _reloadTimer = setTimeout(() => {
    _reloadTimer = null
    load()
  }, 50)
}

const sortTrash = (notes: Note[]): Note[] =>
  [...notes].sort((a, b) =>
    new Date(b.deleted_at ?? 0).getTime() - new Date(a.deleted_at ?? 0).getTime(),
  )

const applyIncremental = (
  set: (fn: (s: TrashState) => Partial<TrashState>) => void,
  _get: () => TrashStore,
  detail: DataUpdatedDetail,
): boolean => {
  const entityType = detail.entityType
  const rows = detail.rows as Note[] | undefined
  const removed = detail.removed
  if (entityType !== 'notes') return false
  const hasRows = (rows?.length ?? 0) > 0
  const removedSize = removed instanceof Set ? removed.size : (removed?.length ?? 0)
  if (!hasRows && removedSize === 0) return false

  set((s) => {
    const byId = new Map(s.notes.map((n) => [n.id, n]))
    if (rows) {
      for (const row of rows) {
        if (row.deleted_at) byId.set(row.id, row) // 进回收站
        else byId.delete(row.id) // 恢复 / 物理删 / 状态变更 → 离开
      }
    }
    if (removed) {
      const removedSet = removed instanceof Set ? removed : new Set(removed)
      for (const id of removedSet) byId.delete(id)
    }
    return { notes: sortTrash([...byId.values()]) }
  })
  return true
}

if (typeof window !== 'undefined') {
  window.addEventListener('data-updated', (event) => {
    const detail = (event as CustomEvent<DataUpdatedDetail>).detail || ({} as DataUpdatedDetail)
    const ok = applyIncremental(
      useTrashStore.setState as unknown as (fn: (s: TrashState) => Partial<TrashState>) => void,
      useTrashStore.getState,
      detail,
    )
    if (!ok) scheduleReload(useTrashStore.getState().load)
  })
}

export const useTrashStore = create<TrashStore>()((set) => ({
  notes: [],
  loaded: false,

  load: async () => {
    const all = await notesRepo.getAll({ includeDeleted: true })
    set({ notes: sortTrash(all.filter((n) => n.deleted_at)), loaded: true })
  },
}))