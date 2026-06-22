/**
 * 同步管理器单例
 * - 在 auth 成功后 start()
 * - 在 logout / unmount 时 stop()
 */
import { createSyncManager, type SyncManager } from './syncManager'
import { supabase } from './supabase'
import { db, type FfnDb } from './db'
import { getDeviceId } from './device'
import { useSyncStore } from '@/stores/useSyncStore'
import { useConflictsStore } from '@/stores/useConflictsStore'

let instance: SyncManager | null = null
let started = false

const bindStoreUpdates = (sm: SyncManager): void => {
  // 直接赋值公开属性（SyncManager.onSyncStateChange / onConflict 已是 public）
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

export const getSyncManager = (): SyncManager => {
  if (instance) return instance
  instance = createSyncManager({
    db: db as FfnDb,
    supabase,
    deviceId: getDeviceId(),
  })
  bindStoreUpdates(instance)
  return instance
}

export const startSync = async (): Promise<boolean> => {
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

export const stopSync = async (): Promise<void> => {
  if (!started) return
  const sm = getSyncManager()
  await sm.stop()
  started = false
}

export const isSyncStarted = (): boolean => started

/**
 * 清 syncManager 单例（登出后调用，确保下次 startSync 重新创建）
 * - 不主动 stop（已 stop 的话是 no-op）
 * - 重置 instance 和 started 标志
 */
export const resetSyncInstance = (): void => {
  instance = null
  started = false
}