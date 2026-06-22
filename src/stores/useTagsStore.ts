/**
 * 标签 store
 * - 缓存 tags + 每个 tag 的笔记数
 * - 监听 data-updated: 优先增量(rows),否则全量 reload(50ms debounce)
 */
import { create } from 'zustand'
import { tagsRepo } from '@/repositories/tagsRepo'
import type { Tag, DataUpdatedDetail } from '@/types'

interface TagsState {
  tags: Tag[]
  counts: Map<string, number>
  loaded: boolean
}

interface TagsActions {
  load: () => Promise<void>
}

type TagsStore = TagsState & TagsActions

let _reloadTimer: ReturnType<typeof setTimeout> | null = null
const scheduleReload = (load: () => Promise<void>): void => {
  if (_reloadTimer) return
  _reloadTimer = setTimeout(() => {
    _reloadTimer = null
    load()
  }, 50)
}

const applyIncremental = (
  set: (fn: (s: TagsState) => Partial<TagsState>) => void,
  _get: () => TagsStore,
  detail: DataUpdatedDetail,
): boolean => {
  const entityType = detail.entityType
  const rows = detail.rows as Tag[] | undefined
  const removed = detail.removed
  if (entityType !== 'tags') return false
  const hasRows = (rows?.length ?? 0) > 0
  const removedSize = removed instanceof Set ? removed.size : (removed?.length ?? 0)
  if (!hasRows && removedSize === 0) return false
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
    const detail = (event as CustomEvent<DataUpdatedDetail>).detail || ({} as DataUpdatedDetail)
    const ok = applyIncremental(
      useTagsStore.setState as unknown as (fn: (s: TagsState) => Partial<TagsState>) => void,
      useTagsStore.getState,
      detail,
    )
    if (!ok) scheduleReload(useTagsStore.getState().load)
  })
}

export const useTagsStore = create<TagsStore>()((set) => ({
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