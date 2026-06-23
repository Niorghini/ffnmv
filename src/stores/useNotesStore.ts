/**
 * 笔记列表 store
 * - 缓存当前过滤后的 notes
 * - 监听 data-updated: 优先增量(rows/removed),否则全量 reload(50ms debounce)
 *   EFF-002: 增量路径省掉 1w 笔记全表 reload
 */
import { create } from 'zustand'
import { notesRepo } from '@/repositories/notesRepo'
import type { Note, DataUpdatedDetail } from '@/types'

type StatusFilter = 'all' | 'pending' | 'completed'

interface NotesState {
  notes: Note[]
  loaded: boolean
  activeId: string | null // 选中的笔记 id（编辑右栏用）
  activeTagId: string | null // null = 全部
  statusFilter: StatusFilter // all | pending | completed
  searchQuery: string
}

interface NotesActions {
  load: () => Promise<void>
  setActiveId: (id: string | null) => void
  setActiveTagId: (id: string | null) => void
  setStatusFilter: (s: StatusFilter) => void
  setSearchQuery: (q: string) => void
  resetFilters: () => void
}

type NotesStore = NotesState & NotesActions

let _reloadTimer: ReturnType<typeof setTimeout> | null = null
const scheduleReload = (load: () => Promise<void>): void => {
  if (_reloadTimer) return
  _reloadTimer = setTimeout(() => {
    _reloadTimer = null
    void load()
  }, 50)
}

const noteMatchesView = (note: Note, state: NotesState): boolean => {
  // 当前 notes store 的视图约束: 活跃 + (可选 statusFilter) + (可选 searchQuery)
  // tag 过滤在 load() 里走 getByTag,这里命中不到 → 走全量 reload
  if (note.deleted_at) return false
  if (note.archived_at) return false
  if (state.statusFilter !== 'all' && note.status !== state.statusFilter) return false
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase()
    if (!note.content.toLowerCase().includes(q)) return false
  }
  return true
}

const sortNotes = (notes: Note[]): Note[] =>
  [...notes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

const applyIncremental = (
  set: (fn: (s: NotesState) => Partial<NotesState>) => void,
  get: () => NotesStore,
  detail: DataUpdatedDetail,
): boolean => {
  const entityType = detail.entityType
  const rows = detail.rows as Note[] | undefined
  const removed = detail.removed
  const state = get()
  // tag 过滤激活时,note_tags 变化会让 join 结果变 → 不能纯增量
  if (state.activeTagId) return false
  if (entityType === 'note_tags') return false
  if (entityType !== 'notes') return false
  const hasRows = (rows?.length ?? 0) > 0
  const removedSize = removed instanceof Set ? removed.size : (removed?.length ?? 0)
  if (!hasRows && removedSize === 0) return false

  set((s) => {
    const byId = new Map(s.notes.map((n) => [n.id, n]))
    if (rows) {
      for (const row of rows) {
        if (noteMatchesView(row, s)) byId.set(row.id, row)
        else byId.delete(row.id)
      }
    }
    if (removed) {
      const removedSet = removed instanceof Set ? removed : new Set(removed)
      for (const id of removedSet) byId.delete(id)
    }
    return { notes: sortNotes([...byId.values()]) }
  })
  return true
}

if (typeof window !== 'undefined') {
  window.addEventListener('data-updated', (event) => {
    const detail = (event as CustomEvent<DataUpdatedDetail>).detail || ({} as DataUpdatedDetail)
    // 试增量;不行就 fallback 全量
    const ok = applyIncremental(
      useNotesStore.setState,
      useNotesStore.getState,
      detail,
    )
    if (!ok) scheduleReload(useNotesStore.getState().load)
  })
}

export const useNotesStore = create<NotesStore>()((set, get) => ({
  notes: [],
  loaded: false,
  activeId: null,
  activeTagId: null,
  statusFilter: 'all',
  searchQuery: '',

  load: async () => {
    const { activeTagId } = get()
    let notes: Note[]
    if (activeTagId) {
      notes = await notesRepo.getByTag(activeTagId)
    } else {
      notes = await notesRepo.getAll()
    }
    set({ notes: sortNotes(notes), loaded: true })
  },

  setActiveId: (id: string | null) => set({ activeId: id }),

  setActiveTagId: (id: string | null) => {
    set({ activeTagId: id, loaded: false })
    void get().load()
  },

  setStatusFilter: (s: StatusFilter) => set({ statusFilter: s }),
  setSearchQuery: (q: string) => set({ searchQuery: q }),

  resetFilters: () => {
    set({ activeTagId: null, statusFilter: 'all', searchQuery: '' })
    void get().load()
  },
}))