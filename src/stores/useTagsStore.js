/**
 * 标签 store
 * - 缓存 tags + 每个 tag 的笔记数
 * - 监听 data-updated: 优先增量(rows),否则全量 reload(50ms debounce)
 */
import { create } from 'zustand'
import { tagsRepo } from '@/repositories/tagsRepo'

let _reloadTimer = null
const scheduleReload = (load) => {
  if (_reloadTimer) return
  _reloadTimer = setTimeout(() => {
    _reloadTimer = null
    load()
  }, 50)
}

const applyIncremental = (set, get, detail) => {
  const { entityType, rows, removed } = detail
  if (entityType !== 'tags') return false
  if (!rows?.length && !removed?.length) return false
  set((s) => {
    const byId = new Map(s.tags.map((t) => [t.id, t]))
    if (rows) {
      for (const t of rows) byId.set(t.id, t)
    }
    if (removed) {
      const removedSet = removed instanceof Set ? removed : new Set(removed)
      for (const id of removedSet) byId.delete(id)
    }
    const sorted = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    return { tags: sorted }
  })
  return true
}

if (typeof window !== 'undefined') {
  window.addEventListener('data-updated', (event) => {
    const detail = event.detail || {}
    const ok = applyIncremental(useTagsStore.setState, useTagsStore.getState, detail)
    if (!ok) scheduleReload(useTagsStore.getState().load)
  })
}

export const useTagsStore = create((set, get) => ({
  tags: [],
  counts: new Map(),
  loaded: false,

  load: async () => {
    const [tags, counts] = await Promise.all([
      tagsRepo.getAll(),
      tagsRepo.countsByTag(),
    ])
    set({ tags, counts, loaded: true })
  },
}))
