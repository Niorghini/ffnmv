/**
 * imageDownloadQueue —— 并发 + 优先级 + 重试的图片下载队列
 *
 * 取代 NoteImage 直接调 ensureLocalImage 的方案,解决:
 * - 列表 mount 时 N 个 fetch 同时打爆 Supabase Storage
 * - 失败无重试入口 / 无超时分级
 *
 * 核心能力:
 * - 并发上限 MAX_CONCURRENT=3(避免打爆 RPS)
 * - 去重:同一 note 多次 enqueue 只触发一次 download
 * - 优先级:visible(列表视口内)> prefetch(列表预取)> manual(重试按钮)
 * - 超时分级:慢网 60s,正常 30s,重试后 60s
 * - 失败重试上限 3 次;失败 emit 自定义事件让 NoteImage 显示重试按钮
 * - 完成 emit('data-updated','attachments',{rows:[...]}) 让 store 增量刷新
 *
 * 不耦合 React:可以独立 init / cancelAll
 */
import { v4 as uuidv4 } from 'uuid'
import { db, nowIso } from './db'
import { getImageSignedUrl } from './noteImageStorage'
import { emitDataUpdated } from './tags'
import { isSlowNetwork } from './networkProfile'
import type { ImageMime, Attachment } from '@/types'

const MAX_CONCURRENT = 3
const TIMEOUT_BASE_MS = 30_000
const TIMEOUT_SLOW_MS = 60_000
const TIMEOUT_RETRY_MS = 60_000
const MAX_RETRY = 3

export type Priority = 'visible' | 'prefetch' | 'manual'

export interface EnqueueSource {
  noteId: string
  imagePath: string
  /** 256px 小缩略图 Storage 路径;可选,旧数据为 null(下载时降级到 thumb) */
  thumbSmPath: string | null
  thumbPath: string | null
  mime: ImageMime
}

interface QueueItem {
  source: EnqueueSource
  priority: Priority
  /** enqueue 时的版本号;enqueue 新值会更新版本,处理中的旧值会被丢弃 */
  version: number
  /** 已重试次数 */
  retry: number
  /** AbortController for current in-flight fetch */
  controller: AbortController
}

export interface ImageDownloadFailedDetail {
  noteId: string
  reason: 'timeout' | 'http' | 'network' | 'unknown'
  attempts: number
}

declare global {
  interface WindowEventMap {
    'image-download-failed': CustomEvent<ImageDownloadFailedDetail>
  }
}

// 给 NoteImage 的进度事件:thumb 先到就立刻渲染,不等 original
export interface ImageThumbReadyDetail { noteId: string }
declare global {
  interface WindowEventMap {
    'image-thumb-ready': CustomEvent<ImageThumbReadyDetail>
  }
}

/** 单 note 当前 in-flight 任务;不区分 original / thumb / thumb-sm,统一并发 */
const inflight = new Map<string, QueueItem>()
/** 等待中的 note(去重用);priority 提升时更新 version */
const pending = new Map<string, QueueItem>()

function timeoutFor(item: QueueItem): number {
  if (item.retry > 0) return TIMEOUT_RETRY_MS
  return isSlowNetwork() ? TIMEOUT_SLOW_MS : TIMEOUT_BASE_MS
}

function isCancelled(item: QueueItem): boolean {
  if (item.controller.signal.aborted) return true
  // 版本不匹配:enqueue 新值时已自增 version,旧任务视为取消
  const current = inflight.get(item.source.noteId) ?? pending.get(item.source.noteId)
  return current !== item
}

async function downloadOne(
  noteId: string,
  path: string,
  kind: 'original' | 'thumb' | 'thumb-sm',
  mime: ImageMime,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Attachment | null> {
  const url = await getImageSignedUrl(path, 3600)
  // 自带超时 + 外部 controller 都触发 abort
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combined = AbortSignal.any([signal, timeoutSignal])
  const resp = await fetch(url, { signal: combined })
  if (!resp.ok) {
    throw Object.assign(new Error(`HTTP ${resp.status}`), { code: 'http' as const })
  }
  const blob = await resp.blob()
  const realMime: ImageMime = kind === 'thumb' || kind === 'thumb-sm' ? 'image/jpeg' : mime
  let width = 0
  let height = 0
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    width = bitmap.width
    height = bitmap.height
    bitmap.close()
  } catch {
    // 读不到尺寸不阻塞写入
  }

  return {
    id: uuidv4(),
    note_id: noteId,
    kind,
    blob,
    mime: realMime,
    size: blob.size,
    width,
    height,
    created_at: nowIso(),
  }
}

async function ensureAttachment(
  item: QueueItem,
  kind: 'original' | 'thumb' | 'thumb-sm',
  path: string,
  mime: ImageMime,
  inserted: Attachment[],
): Promise<void> {
  if (isCancelled(item)) return
  const existing = await db.attachments
    .where('[note_id+kind]')
    .equals([item.source.noteId, kind])
    .first()
  if (existing) return
  if (isCancelled(item)) return
  const att = await downloadOne(item.source.noteId, path, kind, mime, item.controller.signal, timeoutFor(item))
  if (isCancelled(item)) return
  if (att) {
    await db.attachments.add(att)
    inserted.push(att)
  }
}

/** 单 note 全流程:拉到 thumb-sm → thumb → original(列表优先) */
async function processItem(item: QueueItem): Promise<void> {
  const { noteId, imagePath, thumbPath, thumbSmPath, mime } = item.source
  const inserted: Attachment[] = []
  let lastError: { code: ImageDownloadFailedDetail['reason']; err: unknown } | null = null
  try {
    // ❗️ 先拉 thumb-sm → thumb(小体量,几十 KB),列表立即可渲染;
    // 再拉 original(5-20MB,耗时),background 延迟交付。
    if (thumbSmPath) await ensureAttachment(item, 'thumb-sm', thumbSmPath, mime, inserted)
    if (isCancelled(item)) return
    if (thumbPath) await ensureAttachment(item, 'thumb', thumbPath, mime, inserted)
    // thumb 级下载完成,立即通知 UI 渲染(不等 original)
    if (inserted.length > 0 && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<ImageThumbReadyDetail>('image-thumb-ready', {
          detail: { noteId },
        }),
      )
    }
    if (isCancelled(item)) return
    await ensureAttachment(item, 'original', imagePath, mime, inserted)
    if (inserted.length > 0) {
      emitDataUpdated('attachments', { rows: inserted, source: 'pull' })
    }
  } catch (e) {
    // AbortError 一律视为 cancel(用户 cancel / 版本更新 / retry 清旧 in-flight)
    // 不重试,也不计数
    if (e instanceof Error && e.name === 'AbortError') {
      return
    }
    const code =
      e && typeof e === 'object' && 'code' in e
        ? ((e as { code?: string }).code as ImageDownloadFailedDetail['reason'])
        : 'unknown'
    lastError = { code, err: e }
  } finally {
    // 成功 + 取消 + 失败都清 inflight(失败走重试路径会重新塞回 pending)
    inflight.delete(noteId)
    // 释放 slot 后立刻 pump,让 pending 顶上
    pump()
  }
  // 走到这里说明没被 cancel,有错
  if (lastError && item.retry + 1 < MAX_RETRY) {
    item.retry += 1
    item.controller = new AbortController()  // 新 controller,旧 signal 已被 abort
    pending.set(noteId, item)
    pump()
    return
  }
  if (lastError) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<ImageDownloadFailedDetail>('image-download-failed', {
          detail: { noteId, reason: lastError.code, attempts: item.retry + 1 },
        }),
      )
    }
  }
}

/** 调度器:有 slot 就有 running,有 pending 就 pull 一个出来 */
let pumping = false
function pump(): void {
  if (pumping) return
  pumping = true
  setTimeout(() => {
    pumping = false
    void tick()
  }, 0)
}

async function tick(): Promise<void> {
  // 一次 tick 把能填的 slot 全填满(连续多 enqueue 不会留下空 slot)
  while (inflight.size < MAX_CONCURRENT && pending.size > 0) {
    // 优先级:manual > visible > prefetch
    const priorityRank: Record<Priority, number> = { manual: 0, visible: 1, prefetch: 2 }
    let bestKey: string | null = null
    let bestItem: QueueItem | null = null
    for (const [key, item] of pending.entries()) {
      if (!bestItem) {
        bestKey = key
        bestItem = item
        continue
      }
      if (priorityRank[item.priority] < priorityRank[bestItem.priority]) {
        bestKey = key
        bestItem = item
      }
    }
    if (!bestKey || !bestItem) break
    pending.delete(bestKey)
    inflight.set(bestKey, bestItem)
    // 不 await,让 processItem 在后台跑,完成后 finally 会再调 pump
    void processItem(bestItem)
  }
}

/**
 * 入队一个 note 的图片下载
 * - 已 in-flight:升级 priority(影响调度顺序),不重复触发
 * - 已 pending:升级 priority,更新 version(让在跑的旧版本被 cancel)
 */
export function enqueue(opts: {
  source: EnqueueSource
  priority: Priority
}): void {
  const { source, priority } = opts
  const existing = inflight.get(source.noteId) ?? pending.get(source.noteId)
  if (existing) {
    // 升级 priority + 自增 version(让旧 downloadOne 走 isCancelled 早退)
    const rank: Record<Priority, number> = { manual: 0, visible: 1, prefetch: 2 }
    if (rank[priority] < rank[existing.priority]) {
      existing.priority = priority
    }
    existing.version += 1
    // 更新源(可能用户替换了图)
    existing.source = source
    if (inflight.has(source.noteId)) {
      // 在飞任务:abort 旧 controller(旧 processItem 走 AbortError 早退),
      // 然后把 item 重新塞回 pending,新 processItem 会用同一个新 controller
      // (因为 processItem finally 会清 inflight;我们在 abort 后把 item 转 pending)
      // 用 setTimeout 0 把转 pending 推到 in-flight 清空之后,避免竞态
      existing.controller.abort()
      const itemToReschedule = existing
      setTimeout(() => {
        // 此时旧 processItem 已走 AbortError 返回并 finally 清了 inflight
        // 但 item 本身还在 map 的 inflight 位置已被清;现在安全放回 pending
        if (pending.has(source.noteId) || inflight.has(source.noteId)) return
        itemToReschedule.controller = new AbortController()
        itemToReschedule.retry = 0
        pending.set(source.noteId, itemToReschedule)
        pump()
      }, 0)
    }
    return
  }

  const controller = new AbortController()
  const item: QueueItem = {
    source,
    priority,
    version: 1,
    retry: 0,
    controller,
  }
  pending.set(source.noteId, item)
  pump()
}

/** 取消某 note 的下载(列表 unmount 时调) */
export function cancelNote(noteId: string): void {
  const item = inflight.get(noteId) ?? pending.get(noteId)
  if (!item) return
  item.controller.abort()
  inflight.delete(noteId)
  pending.delete(noteId)
}

/** 取消所有 in-flight / pending(用户登出 / sync 停止时调) */
export function cancelAll(): void {
  for (const item of inflight.values()) item.controller.abort()
  for (const item of pending.values()) item.controller.abort()
  inflight.clear()
  pending.clear()
}

/** 手动重试(占位"重试"按钮) */
export function retry(noteId: string, source: EnqueueSource): void {
  // 先清掉 in-flight 中的旧任务(若有)
  const existing = inflight.get(noteId)
  if (existing) existing.controller.abort()
  inflight.delete(noteId)
  pending.delete(noteId)

  const controller = new AbortController()
  const item: QueueItem = { source, priority: 'manual', version: 1, retry: 0, controller }
  pending.set(noteId, item)
  pump()
}

/** 调试 / 测试用:当前状态快照 */
export function _debugSnapshot(): { inflight: string[]; pending: string[] } {
  return {
    inflight: [...inflight.keys()],
    pending: [...pending.keys()],
  }
}

/** 测试用:重置内部状态 */
export function _resetForTests(): void {
  cancelAll()
}
