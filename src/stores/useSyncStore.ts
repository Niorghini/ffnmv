/**
 * 同步状态 store
 * - status: 'idle' | 'syncing' | 'error' | 'offline'
 * - lastSyncAt: 上次成功时间
 * - pending: 待同步条目数
 * - online: navigator.onLine
 */
import { create } from 'zustand'
import { db } from '@/lib/db'
import type { SyncEngineStatus, EntityType } from '@/types'

interface SyncState {
  status: SyncEngineStatus
  lastSyncAt: number | null
  error: string | null
  pending: number
  online: boolean
  lastSyncTimes: number[]
}

interface SyncActions {
  setPartial: (partial: Partial<SyncState>) => void
  recordSyncTime: (ts: number) => void
  setOnline: (online: boolean) => void
  refreshPending: () => Promise<void>
}

type SyncStore = SyncState & SyncActions

export const useSyncStore = create<SyncStore>()((set, get) => ({
  status: 'idle',
  lastSyncAt: null,
  error: null,
  pending: 0,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  lastSyncTimes: [],

  setPartial: (partial: Partial<SyncState>) => set(partial),

  recordSyncTime: (ts: number) =>
    set((state) => ({
      lastSyncTimes: [ts, ...state.lastSyncTimes.filter((t) => t !== ts)].slice(0, 10),
    })),

  setOnline: (online: boolean) => {
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

// 抑制 unused 警告：EntityType 在 SyncEngineStatus 关联类型中已使用
void (null as EntityType | null)