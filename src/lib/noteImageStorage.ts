/**
 * noteImageStorage —— Supabase Storage 桶 note-images 封装
 * 使用 supabase-js storage client 处理 auth 和 multi-tenant 路径。
 */
import { v4 as uuidv4 } from 'uuid'
import { supabase } from './supabase'
import type { ImageMime } from '@/types'

const BUCKET = 'note-images'
const MAX_BYTES = 20 * 1024 * 1024
const QUOTA_BYTES = 500 * 1024 * 1024

export interface UploadResult {
  path: string
  thumbPath: string
  /** 256px 缩略图 Storage 路径;新上传一定有(为列表场景优化);旧数据可能为 null */
  thumbSmPath: string | null
  size: number
}

export interface QuotaStatus {
  used: number
  limit: number
  ok: boolean
}

const extFor = (mime: ImageMime): string =>
  mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'

export async function uploadNoteImage(
  userId: string,
  noteId: string,
  original: Blob,
  thumb: Blob,
  mime: ImageMime,
  /** 256px 缩略图;可选,旧调用方未传则跳过(后续 imageSync 兜底补) */
  thumbSm?: Blob,
): Promise<UploadResult> {
  if (original.size > MAX_BYTES) {
    throw new ImageTooLargeError(`原图 ${original.size} bytes 超过 ${MAX_BYTES}`)
  }
  if (thumb.size > MAX_BYTES) {
    throw new ImageTooLargeError(`缩略图 ${thumb.size} bytes 超过 ${MAX_BYTES}`)
  }
  if (thumbSm && thumbSm.size > MAX_BYTES) {
    throw new ImageTooLargeError(`小缩略图 ${thumbSm.size} bytes 超过 ${MAX_BYTES}`)
  }

  const ext = extFor(mime)
  const id = uuidv4()
  const objectKey = `${userId}/${noteId}/${id}.${ext}`
  const thumbKey = `${userId}/${noteId}/thumb-${id}.${ext}`
  const thumbSmKey = `${userId}/${noteId}/thumb-sm-${id}.jpg`

  const bucket = supabase.storage.from(BUCKET)

  // 三文件串行上传,分开追踪各个耗时
  const uploadSingle = async (
    key: string,
    blob: Blob,
    contentType: string,
    label: string,
  ): Promise<{ error: unknown }> => {
    const start = performance.now()
    try {
      const result = await bucket.upload(key, blob, { upsert: false, contentType })
      const elapsed = Math.round(performance.now() - start)
      if (result.error) {
        console.warn(`[imageUpload] ${label} failed after ${elapsed}ms`)
      }
      return result
    } catch (e) {
      const elapsed = Math.round(performance.now() - start)
      console.warn(`[imageUpload] ${label} threw after ${elapsed}ms:`, e instanceof Error ? e.message : e)
      throw e
    }
  }

  // ❗️ 先传 thumb-sm(几 KB)→ thumb(30-80KB)→ original(5-20MB)
  // 小的先跑完,list 端在几秒内就能看到缩略图,不用等原图传完
  const thumbSmResult = thumbSm
    ? await uploadSingle(thumbSmKey, thumbSm, 'image/jpeg', 'thumb-sm')
    : null
  const thumbResult = await uploadSingle(thumbKey, thumb, 'image/jpeg', 'thumb')
  const origResult = await uploadSingle(objectKey, original, mime, 'original')

  if (origResult.error) {
    throw new Error(`original upload failed: ${(origResult.error as { message?: string }).message ?? 'unknown'}`)
  }
  if (thumbResult.error) {
    throw new Error(`thumb upload failed: ${(thumbResult.error as { message?: string }).message ?? 'unknown'}`)
  }
  // thumb-sm 失败仅 warn(列表有 thumb 降级可用)
  let thumbSmPath: string | null = null
  if (thumbSmResult && !thumbSmResult.error) {
    thumbSmPath = `${BUCKET}/${thumbSmKey}`
  } else if (thumbSm) {
    console.warn('[noteImageStorage] thumb-sm upload failed, list will fall back to 512px thumb')
  }

  return {
    path: `${BUCKET}/${objectKey}`,
    thumbPath: `${BUCKET}/${thumbKey}`,
    thumbSmPath,
    size: original.size,
  }
}

export async function deleteNoteImage(
  path: string,
  thumbPath: string,
  thumbSmPath?: string | null,
): Promise<void> {
  const bucket = supabase.storage.from(BUCKET)
  const jobs: Array<Promise<unknown>> = [
    bucket.remove([stripBucket(path)]).catch((e: unknown) => {
      console.warn('[noteImageStorage] delete original failed:', e)
    }),
    bucket.remove([stripBucket(thumbPath)]).catch((e: unknown) => {
      console.warn('[noteImageStorage] delete thumb failed:', e)
    }),
  ]
  if (thumbSmPath) {
    jobs.push(
      bucket.remove([stripBucket(thumbSmPath)]).catch((e: unknown) => {
        console.warn('[noteImageStorage] delete thumb-sm failed:', e)
      }),
    )
  }
  await Promise.all(jobs)
}

export async function getImageSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  const bucket = supabase.storage.from(BUCKET)
  const { data, error } = await bucket.createSignedUrl(stripBucket(path), expiresIn)
  if (error) throw new Error(`signed url failed: ${error.message}`)
  if (!data?.signedUrl) throw new Error('signed url: empty response')
  return data.signedUrl
}

export async function checkQuota(userId: string, additionalBytes: number): Promise<QuotaStatus> {
  const { data, error } = await supabase.rpc(
    'ffn_user_image_quota_bytes' as never,
    { p_user: userId } as never,
  )
  if (error) {
    console.warn('[noteImageStorage] quota check failed, allowing upload:', error.message)
    return { used: 0, limit: QUOTA_BYTES, ok: true }
  }
  const used = typeof data === 'number' ? data : 0
  return { used, limit: QUOTA_BYTES, ok: used + additionalBytes <= QUOTA_BYTES }
}

function stripBucket(path: string): string {
  const prefix = `${BUCKET}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

export class ImageTooLargeError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'ImageTooLargeError'
  }
}

export class ImageUnsupportedError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'ImageUnsupportedError'
  }
}
