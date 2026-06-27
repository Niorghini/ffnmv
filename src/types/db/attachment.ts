/**
 * 本地图片附件实体（src/lib/db.ts 的 attachments 表）
 *
 * - 笔记每张图对应 3 行(kind='original'|'thumb'|'thumb-sm')
 * - thumb-sm (256px) 给列表用,thumb (512px) 给详情用,original 透传原图
 * - 旧数据(只有 original + thumb)由 NoteImage 渲染时降级到 thumb
 * - 仅本地存储;cloud 在 Supabase Storage,通过 notes.image_path / image_thumb_path 引用
 * - 跨设备同步:Realtime 收到 notes.image_path 变更后,imageDownloadQueue 拉到 blob 写入本表
 * - 删除图片:notesRepo.removeImage 先删本表,再异步删 Storage 对象
 *
 * 复合索引 [note_id+kind] 用于按笔记快速查原图 / 缩略图(避免跨设备下载重复)
 */

export type AttachmentKind = 'original' | 'thumb' | 'thumb-sm'

/** 允许的图片 MIME 白名单(与 supabase migration 一致) */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number] /* eslint-disable-line @typescript-eslint/no-redeclare */

export interface Attachment {
  /** 本地唯一 uuid(也是 attachments 主键) */
  id: string
  /** 外键 → notes.id */
  note_id: string
  /** 'original' = 原图; 'thumb' = 512px 缩略图(详情); 'thumb-sm' = 256px 缩略图(列表) */
  kind: AttachmentKind
  /** 二进制;web 用 Blob,native 同 Blob(底层走 IndexedDB) */
  blob: Blob
  /** MIME;白名单内 */
  mime: ImageMime
  /** 字节数 */
  size: number
  /** 原图宽(像素);thumb 也记原图宽,方便 layout 计算 */
  width: number
  /** 原图高 */
  height: number
  /** ISO 时间戳;用于 LRU 缓存清理(暂未实现) */
  created_at: string
}
