/**
 * 回收站 store
 * - 缓存软删除的 notes（deleted_at != null）
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
    scheduleReload(useTrashStore.getState().load)
  })
}

export const useTrashStore = create((set) => ({
  notes: [],
  loaded: false,

  load: async () => {
    const all = await notesRepo.getAll({ includeDeleted: true })
    set({ notes: all.filter((n) => n.deleted_at), loaded: true })
  },
}))
