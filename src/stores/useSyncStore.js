/**
 * 同步状态 store
 * - status: 'idle' | 'syncing' | 'error' | 'offline'
 * - lastSyncAt: 上次成功时间
 * - pending: 待同步条目数
 * - online: navigator.onLine
 */
import { create } from 'zustand'
import { db } from '@/lib/db'

export const useSyncStore = create((set, get) => ({
  status: 'idle',
  lastSyncAt: null,
  error: null,
  pending: 0,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  lastSyncTimes: [],

  setPartial: (partial) => set(partial),

  recordSyncTime: (ts) =>
    set((state) => ({
      lastSyncTimes: [ts, ...state.lastSyncTimes.filter((t) => t !== ts)].slice(0, 10),
    })),

  setOnline: (online) => {
    set({ online })
    if (online && get().status === 'offline') set({ status: 'idle' })
  },

  refreshPending: async () => {
    const notes = await db.notes.where('sync_status').anyOf(['pending', 'failed']).count()
    const tags = await db.tags.where('sync_status').anyOf(['pending', 'failed']).count()
    const links = await db.note_tags.where('sync_status').anyOf(['pending', 'failed']).count()
    set({ pending: notes + tags + links })
  },
}))
