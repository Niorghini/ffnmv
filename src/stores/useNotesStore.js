/**
 * 笔记列表 store
 * - 缓存当前过滤后的 notes
 * - 监听 data-updated: 优先增量(rows/removed),否则全量 reload(50ms debounce)
 *   EFF-002: 增量路径省掉 1w 笔记全表 reload
 */
import { create } from 'zustand'
import { notesRepo } from '@/repositories/notesRepo'

let _reloadTimer = null
const scheduleReload = (load) => {
  if (_reloadTimer) return
  _reloadTimer = setTimeout(() => {
    _reloadTimer = null
    load()
  }, 50)
}

const noteMatchesView = (note, state) => {
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

const sortNotes = (notes) =>
  [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

const applyIncremental = (set, get, detail) => {
  const { entityType, rows, removed } = detail
  const state = get()
  // tag 过滤激活时,note_tags 变化会让 join 结果变 → 不能纯增量
  if (state.activeTagId) return false
  if (entityType === 'note_tags') return false
  if (entityType !== 'notes') return false
  if (!rows?.length && !removed?.length) return false

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
    const detail = event.detail || {}
    // 试增量;不行就 fallback 全量
    const ok = applyIncremental(useNotesStore.setState, useNotesStore.getState, detail)
    if (!ok) scheduleReload(useNotesStore.getState().load)
  })
}

export const useNotesStore = create((set, get) => ({
  notes: [],
  loaded: false,
  activeId: null, // 选中的笔记 id（编辑右栏用）
  activeTagId: null, // null = 全部
  statusFilter: 'all', // all | pending | completed
  searchQuery: '',

  load: async () => {
    const { activeTagId } = get()
    let notes
    if (activeTagId) {
      notes = await notesRepo.getByTag(activeTagId)
    } else {
      notes = await notesRepo.getAll()
    }
    set({ notes: sortNotes(notes), loaded: true })
  },

  setActiveId: (id) => set({ activeId: id }),

  setActiveTagId: (id) => {
    set({ activeTagId: id, loaded: false })
    get().load()
  },

  setStatusFilter: (s) => set({ statusFilter: s }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  resetFilters: () => {
    set({ activeTagId: null, statusFilter: 'all', searchQuery: '' })
    get().load()
  },
}))
