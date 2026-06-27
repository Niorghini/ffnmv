/**
 * Note 实体（src/lib/db.ts 的 notes 表 + src/repositories/notesRepo.ts）
 * - 严格匹配实际 Dexie 行 shape
 * - 软删除：deleted_at 为 string（时间戳）；未删：null
 * - last_sync_device / user_id 仅 sync 后存在，本地新建笔记不应有
 *
 * 图片附件字段（v1.3.2 起）：
 * - image_path: 已上传到 Supabase Storage 的路径;null = 本地无图
 * - image_mime / image_size / image_width / image_height: 选图时由 imageProcessor 写入
 * - image_thumb_path: 缩略图 Storage 路径(原图缩到 512px JPEG 0.82)
 * - image_uploaded_at: 上传完成时间;null = 本地有 blob 但还没传完(同步只推非空字段)
 */
export interface Note {
  id: string
  content: string
  status: 'pending' | 'completed'
  created_at: string
  updated_at: string
  deleted_at: string | null
  archived_at: string | null
  version: number
  sync_status: 'pending' | 'synced' | 'failed'
  last_synced_at: string | null
  /** 仅 sync push/pull 后存在；本地新建的 note 没有此字段 */
  last_sync_device?: string
  /** 仅 cloud 行有，sync 拉取时 stripUserId 后丢弃；本地写入不应有 */
  user_id?: string

  // ─── 图片附件 ───
  /** Storage 路径:note-images/{user_id}/{note_id}/{uuid}.{ext};null = 无图 */
  image_path: string | null
  /** MIME 白名单:image/jpeg | image/png | image/webp */
  image_mime: 'image/jpeg' | 'image/png' | 'image/webp' | null
  /** 原图字节数;CHECK 约束 ≤ 20MiB */
  image_size: number | null
  /** 原图宽(像素);缩略图固定 512px */
  image_width: number | null
  /** 原图高(像素) */
  image_height: number | null
  /** 缩略图 Storage 路径(512px JPEG 0.82,详情页用) */
  image_thumb_path: string | null
  /** 小缩略图 Storage 路径(256px JPEG 0.80,列表页用);新上传才有,旧数据为 null */
  image_thumb_sm_path: string | null
  /** 上传完成时间;null = 本地有 blob 未传完 */
  image_uploaded_at: string | null
}

/** 上传中的图片占位元数据(传给 imageUploadQueue 用于 token 校验) */
export interface PendingImageUpload {
  /** 本次上传的 token;upload 完成后校验 notes 行 image_uploaded_at 还是 null 才是自己的 */
  upload_id: string
  note_id: string
  /** 原图 + 缩略图 Blob,本地 attachments 存的就是这俩 */
  original_blob: Blob
  thumb_blob: Blob
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  size: number
  width: number
  height: number
}
