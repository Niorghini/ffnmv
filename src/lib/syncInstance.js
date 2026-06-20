/**
 * 同步管理器单例
 * - 在 auth 成功后 start()
 * - 在 logout / unmount 时 stop()
 */
import { createSyncManager } from './syncManager'
import { supabase } from './supabase'
import { db } from './db'
import { getDeviceId } from './device'
import { useSyncStore } from '@/stores/useSyncStore'
import { useConflictsStore } from '@/stores/useConflictsStore'

let instance = null
let started = false

const bindStoreUpdates = (sm) => {
  sm.onSyncStateChange = (partial) => {
    useSyncStore.getState().setPartial(partial)
    if (partial.lastSyncAt) {
      useSyncStore.getState().recordSyncTime(partial.lastSyncAt)
    }
  }
  sm.onConflict = () => {
    useConflictsStore.getState().load()
  }
}

export const getSyncManager = () => {
  if (instance) return instance
  instance = createSyncManager({
    db,
    supabase,
    deviceId: getDeviceId(),
  })
  bindStoreUpdates(instance)
  return instance
}

export const startSync = async () => {
  if (started) return true
  const sm = getSyncManager()
  const ok = await sm.start()
  if (ok) {
    started = true
    // 启动后刷一次待同步计数
    useSyncStore.getState().refreshPending()
    useConflictsStore.getState().load()
  }
  return ok
}

export const stopSync = async () => {
  if (!started) return
  const sm = getSyncManager()
  await sm.stop()
  started = false
}

export const isSyncStarted = () => started
