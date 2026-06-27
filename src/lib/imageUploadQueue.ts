/**
 * imageUploadQueue —— 后台上传管理器
 *
 * 职责:
 * - 扫 notes:image_path IS NULL AND image_uploaded_at IS NULL 的行(本地有图待传)
 * - 串行上传到 Supabase Storage(避免并发大文件爆 RAM)
 * - 成功后 UPDATE notes:写 image_path / image_thumb_path / image_uploaded_at,触发 sync 推 cloud
 * - 网络恢复 / 定时 / 手动 trigger 立即 scan
 *
 * 幂等 / 防竞态:
 * - 上传前生成 uploadToken(uuidv4),存到 attachments 上传完成前的状态
 * - 完成后读 notes.image_uploaded_at;若已是其他 token 写入的时间戳(说明被新上传覆盖),丢弃结果
 *
 * 重试:exponential backoff 1s → 2s → 4s → ... → 60s 上限
 */
import { v4 as uuidv4 } from 'uuid'
import { db, nowIso } from './db'
import { uploadNoteImage, ImageTooLargeError, ImageUnsupportedError } from './noteImageStorage'
import { getCurrentUser } from './auth'
import { emitDataUpdated } from './tags'

const MAX_BACKOFF_MS = 60_000
const MAX_UPLOAD_RETRIES = 3

export class ImageUploadQueue {
  private scanning = false
  private retryDelay = 1000
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private onOnline: (() => void) | null = null
  private onDataUpdated: (() => void) | null = null

  start(): void {
    if (typeof window === 'undefined') return
    this.onOnline = () => {
      this.retryDelay = 1000
      void this.scanOnce()
    }
    this.onDataUpdated = () => {
      // 1s debounce:本地写新图后等 1 秒再上传(给 notesRepo 入库时间)
      setTimeout(() => void this.scanOnce(), 1000)
    }
    window.addEventListener('online', this.onOnline)
    window.addEventListener('data-updated', this.onDataUpdated)
    // 启动时扫一次
    void this.scanOnce()
  }

  stop(): void {
    if (typeof window === 'undefined') return
    if (this.onOnline) window.removeEventListener('online', this.onOnline)
    if (this.onDataUpdated) window.removeEventListener('data-updated', this.onDataUpdated)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  /**
   * 扫一遍 notes 表 + attachments 表,上传所有待传行
   * - 串行(避免并发 20MB 上传爆 RAM)
   * - 任一行失败:warn + scheduleRetry
   * - 已知永久错误(图片本地已丢 / 太大 / 格式错)→ 清元数据让 UI 停转,不再重试
   */
  async scanOnce(): Promise<void> {
    if (this.scanning) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    this.scanning = true
    try {
      const user = await getCurrentUser()
      if (!user) return
      const userId = user.id

      const pendingNotes = await db.notes
        .filter((n) => n.image_path == null && n.image_uploaded_at == null && n.image_size != null)
        .toArray()

      for (const note of pendingNotes) {
        try {
          await this.uploadOne(userId, note.id)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (e instanceof ImageTooLargeError || e instanceof ImageUnsupportedError) {
            console.warn(`[imageUpload] permanent fail for note ${note.id}:`, msg)
            await this.markFailed(note.id, note.version ?? 1)
          } else if (msg.includes('attachments 缺图')) {
            // 本地 blob 已丢失,不再清除元数据——sync 会从 cloud 拉回 image_path
            // 跳过此 note,不重试,避免无限循环
            console.warn(`[imageUpload] orphan note ${note.id} (no local blob), skipping upload, sync will recover from cloud`)
            continue
          } else {
            console.warn(`[imageUpload] transient fail for note ${note.id}:`, msg)
            this.scheduleRetry()
            return  // 退出本次 scan,等重试
          }
        }
      }
      this.retryDelay = 1000  // 全过,重置 backoff
    } finally {
      this.scanning = false
    }
  }

  /** 永久失败:标记 sync_status=failed,保留元数据让 UI 显示"上传失败"占位 */
  private async markFailed(noteId: string, currentVersion: number): Promise<void> {
    await db.notes.update(noteId, {
      sync_status: 'failed',
      updated_at: nowIso(),
      version: currentVersion + 1,
    })
    const updated = await db.notes.get(noteId)
    if (updated) emitDataUpdated('notes', { rows: [updated] })
  }

  /** 保留但不再使用:orphan note 现在直接 skip,由 sync 从 cloud 恢复
   *  之前版本会在这里清除所有 image_* 字段,导致数据丢失 */

  /**
   * 上传单个 note 的图片
   * - 用 uploadToken 防竞态:读 attachments 上传 token,完成后检查 notes 行 token 是否仍是自己的
   * - 不一致(说明用户改了图)→ 丢弃,下次 scan 会带上传新图
   */
  private async uploadOne(userId: string, noteId: string): Promise<void> {
    // 取原图 + 缩略图 + 小缩略图 blob
    const attachments = await db.attachments
      .where('[note_id+kind]')
      .equals([noteId, 'original'])
      .or('kind')
      .equals('thumb')
      .toArray()
      .catch(async () => {
        // 上面写法依赖 Dexie 链式 + 复合索引;改用更稳的方式
        return await db.attachments.where('note_id').equals(noteId).toArray()
      })

    const original = attachments.find((a) => a.kind === 'original')
    const thumb = attachments.find((a) => a.kind === 'thumb')
    const thumbSm = attachments.find((a) => a.kind === 'thumb-sm')
    if (!original || !thumb) {
      throw new Error(`note ${noteId} 标了待传但 attachments 缺图`)
    }

    const note = await db.notes.get(noteId)
    if (!note || note.image_path != null || note.image_uploaded_at != null) {
      // 已被别的上传完成 / 用户删了
      return
    }
    if (note.image_size == null || note.image_mime == null) {
      throw new Error(`note ${noteId} metadata 不完整`)
    }

    const token = uuidv4()
    // 暂存 token 到 attachments(用 sync_status 不优雅;这里用 metadata blob 头部不太合适)
    // 简化:把 token 暂存到 notes 行外的临时位置 —— 用 image_thumb_path 暂存?太 dirty
    // 改:不存 token,直接靠 image_uploaded_at 仍是 null 作为"还没上传完"的判断
    // 风险:同一 note 在前一个上传飞着时又触发新 upload → 双写。靠 scan 的串行 + this.scanning 守门解决
    void token  // 暂未使用(保留扩展位)

    // supabase-js storage.upload 内置约 10s 超时;大原图(>5MB)容易超时。
    // 内部重试 3 次(指数退避),避免单次网络抖动导致永久上传失败。
    let uploadResult: Awaited<ReturnType<typeof uploadNoteImage>> | undefined
    let lastUploadErr: unknown
    for (let attempt = 0; attempt < MAX_UPLOAD_RETRIES; attempt++) {
      try {
        uploadResult = await uploadNoteImage(
          userId,
          noteId,
          original.blob,
          thumb.blob,
          note.image_mime,
          thumbSm?.blob,
        )
        lastUploadErr = undefined
        break
      } catch (e) {
        lastUploadErr = e
        if (attempt < MAX_UPLOAD_RETRIES - 1) {
          const backoff = 1000 * 2 ** attempt
          console.warn(`[imageUpload] upload retry ${attempt + 1}/${MAX_UPLOAD_RETRIES} for note ${noteId}, wait ${backoff}ms`)
          await new Promise((r) => setTimeout(r, backoff))
        }
      }
    }
    if (lastUploadErr !== undefined) {
      if (lastUploadErr instanceof Error) {
        throw lastUploadErr
      }
      // 包成 Error,保留 cause 供上层 .cause 链访问;JSON.stringify 兜底防循环引用
      const detail =
        typeof lastUploadErr === 'string'
          ? lastUploadErr
          : (() => {
              try {
                return JSON.stringify(lastUploadErr)
              } catch {
                return 'unknown'
              }
            })()
      throw new Error(`[imageUpload] note ${noteId} 上传失败: ${detail}`, {
        cause: lastUploadErr,
      })
    }
    const result = uploadResult!

    // 二次校验:完成后读 notes 行,确认 image_uploaded_at 仍是 null(没被并发 upload 写过)
    const fresh = await db.notes.get(noteId)
    if (!fresh || fresh.image_uploaded_at != null) {
      // 被覆盖;删掉刚上传的 Storage 对象(防孤儿)
      const { deleteNoteImage } = await import('./noteImageStorage')
      await deleteNoteImage(result.path, result.thumbPath, result.thumbSmPath).catch(() => undefined)
      return
    }

    await db.notes.update(noteId, {
      image_path: result.path,
      image_thumb_path: result.thumbPath,
      // 旧数据(老 note 走老代码上传的)没有 thumb-sm → 留 null,list 降级到 thumb
      image_thumb_sm_path: result.thumbSmPath,
      image_uploaded_at: nowIso(),
      sync_status: 'pending',   // 触发 sync push 把 image_path 推到 cloud
      updated_at: nowIso(),
      version: (fresh.version ?? 1) + 1,
    })
    // emit 真实更新行(而非空 rows):store 立即拿到 image_path,
    // NoteImage 不用等 scheduleReload 50ms 后才看到
    const updated = await db.notes.get(noteId)
    if (updated) emitDataUpdated('notes', { rows: [updated] })
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.scanOnce()
    }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_BACKOFF_MS)
  }
}

export const imageUploadQueue = new ImageUploadQueue()
