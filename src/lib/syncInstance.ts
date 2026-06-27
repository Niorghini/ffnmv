/**
 * 同步管理器单例
 * - 在 auth 成功后 start()
 * - 在 logout / unmount 时 stop()
 */
import { createSyncManager, type SyncManager } from './syncManager'
import { supabase } from './supabase'
import { db } from './db'
import { getDeviceId } from './device'
import { useSyncStore } from '@/stores/useSyncStore'
import { useConflictsStore } from '@/stores/useConflictsStore'
import { imageUploadQueue } from './imageUploadQueue'
import { enqueue as imageEnqueue, cancelAll as cancelAllImageDownloads } from './imageDownloadQueue'

let instance: SyncManager | null = null
let started = false
let imageQueueStarted = false

const bindStoreUpdates = (sm: SyncManager): void => {
  // 直接赋值公开属性（SyncManager.onSyncStateChange / onConflict 已是 public）
  sm.onSyncStateChange = (partial) => {
    useSyncStore.getState().setPartial(partial)
    if (partial.lastSyncAt) {
      useSyncStore.getState().recordSyncTime(partial.lastSyncAt)
    }
  }
  sm.onConflict = () => {
    void useConflictsStore.getState().load()
  }
}

export const getSyncManager = (): SyncManager => {
  if (instance) return instance
  instance = createSyncManager({
    db: db,
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
    void useSyncStore.getState().refreshPending()
    void useConflictsStore.getState().load()
    // 同时启动图片上传队列(v1.3.2+):监听 data-updated 事件扫待传行
    if (!imageQueueStarted) {
      imageUploadQueue.start()
      imageQueueStarted = true
    }
    // 登录后预下载所有缺失的本地图片(刷新页面 / 切账号后补回 blob)
    // 走 imageDownloadQueue(并发 3 + 弱网自适应超时),替代旧 syncAllImages 串行慢路径
    const notesWithImage = await db.notes
      .filter((n) => n.image_path != null && n.deleted_at == null)
      .limit(50)
      .toArray()
    for (const n of notesWithImage) {
      if (!n.image_path || !n.image_mime) continue
      const hasOriginal = await db.attachments.where('[note_id+kind]').equals([n.id, 'original']).first()
      if (!hasOriginal) {
        imageEnqueue({
          source: {
            noteId: n.id,
            imagePath: n.image_path,
            thumbPath: n.image_thumb_path,
            thumbSmPath: n.image_thumb_sm_path,
            mime: n.image_mime,
          },
          priority: 'prefetch',
        })
      }
    }
  }
  return ok
}

export const stopSync = async (): Promise<void> => {
  if (!started) return
  // 先 cancel 所有在飞的图片下载,避免 db 表清空后 fetch 落写
  cancelAllImageDownloads()
  const sm = getSyncManager()
  await sm.stop()
  if (imageQueueStarted) {
    imageUploadQueue.stop()
    imageQueueStarted = false
  }
  started = false
}

export const isSyncStarted = (): boolean => started

/**
 * 清 syncManager 单例（登出后调用，确保下次 startSync 重新创建）
 * - 不主动 stop（已 stop 的话是 no-op）
 * - 重置 instance 和 started 标志
 */
export const resetSyncInstance = (): void => {
  cancelAllImageDownloads()
  instance = null
  started = false
  if (imageQueueStarted) {
    imageUploadQueue.stop()
    imageQueueStarted = false
  }
}