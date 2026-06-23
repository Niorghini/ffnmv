/**
 * 冲突 store
 * - conflicts: 未解决冲突列表
 * - unread: 未读数
 */
import { create } from 'zustand'
import { db } from '@/lib/db'
import type { ConflictRecord } from '@/types'

interface ConflictsState {
  conflicts: ConflictRecord[]
  unread: number
}

interface ConflictsActions {
  load: () => Promise<void>
  clear: () => Promise<void>
  markRead: () => void
}

type ConflictsStore = ConflictsState & ConflictsActions

export const useConflictsStore = create<ConflictsStore>()((set) => ({
  conflicts: [],
  unread: 0,

  load: async () => {
    const all = await db.conflicts.toArray()
    set({ conflicts: all, unread: all.length })
  },

  clear: async () => {
    await db.conflicts.clear()
    set({ conflicts: [], unread: 0 })
  },

  markRead: () => set({ unread: 0 }),
}))