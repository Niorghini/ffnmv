/**
 * 笔记列表 store
 * - 缓存当前过滤后的 notes
 * - 监听 data-updated 自动刷新（50ms debounce）
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

if (typeof window !== 'undefined') {
  window.addEventListener('data-updated', () => {
    scheduleReload(useNotesStore.getState().load)
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
    set({ notes, loaded: true })
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
