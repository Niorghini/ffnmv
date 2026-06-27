/**
 * imageProcessor —— 客户端图像处理
 * - 校验 MIME 白名单 + 大小上限
 * - createImageBitmap 自动应用 EXIF orientation(iPhone HEIC 的旋转问题在这里规避)
 * - canvas 缩到最长边 512px 出 JPEG 0.82 缩略图(thumb,给详情)
 * - canvas 缩到最长边 128px 出 JPEG 0.75 缩略图(thumb-sm,给列表 + lightbox placeholder)
 * - 原图不压缩,直接 blob 透传
 */
import { IMAGE_MIME_TYPES, type ImageMime } from '@/types'
import { ImageTooLargeError, ImageUnsupportedError } from './noteImageStorage'

const MAX_BYTES = 20 * 1024 * 1024
/** 详情页缩略图(原图清晰度的 1/4 ~ 1/8) */
export const THUMB_MAX_DIM = 512
const THUMB_QUALITY = 0.82
/** 列表缩略图 + lightbox placeholder:128px → ~6-10KB,Retina 屏略糊但可接受 */
export const THUMB_SM_MAX_DIM = 128
const THUMB_SM_QUALITY = 0.75

export interface ProcessedImage {
  original: Blob
  /** 512px JPEG 0.82 —— 详情页用 */
  thumb: Blob
  /** 256px JPEG 0.80 —— 列表页用(体积 ≈ thumb 的 1/3) */
  thumbSm: Blob
  width: number
  height: number
  mime: ImageMime
  size: number
}

/**
 * 主入口:把任意 Blob 处理成 ProcessedImage
 * - 校验 size ≤ 20MiB
 * - 校验 MIME ∈ {image/jpeg, image/png, image/webp}
 * - 用 createImageBitmap 自动套 EXIF rotation
 * - 原图 blob 透传(浏览器解析正确的话 size 不变);若原图是 HEIC / SVG 已被 MIME 校验拒
 */
export async function processImage(blob: Blob): Promise<ProcessedImage> {
  if (blob.size > MAX_BYTES) {
    throw new ImageTooLargeError(`图片 ${blob.size} bytes 超过 ${MAX_BYTES} (20 MiB)`)
  }
  const mime = validateMime(blob)

  // createImageBitmap 同步处理 EXIF orientation(若浏览器支持)
  // 不支持的浏览器(canvas 自身)也能跑,只是 EXIF 不被尊重
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    // 两级缩略图串行出:thumb-sm 256 优先,因为它体积小、列表场景最常用
    const thumbSm = await renderAtDim(bitmap, THUMB_SM_MAX_DIM, THUMB_SM_QUALITY)
    const thumb = await renderAtDim(bitmap, THUMB_MAX_DIM, THUMB_QUALITY)
    return {
      original: blob,
      thumb,
      thumbSm,
      width: bitmap.width,
      height: bitmap.height,
      mime,
      size: blob.size,
    }
  } finally {
    bitmap.close()
  }
}

function validateMime(blob: Blob): ImageMime {
  const m = blob.type.toLowerCase()
  if (!m) throw new ImageUnsupportedError('图片 MIME 未知')
  // 显式拒 HEIC(MIME 可能是 image/heic 或空)
  if (m.includes('heic') || m.includes('heif')) {
    throw new ImageUnsupportedError('暂不支持 HEIC/HEIF 格式')
  }
  // 显式拒 SVG(防 XSS)
  if (m.includes('svg')) {
    throw new ImageUnsupportedError('不接受 SVG(安全策略)')
  }
  if (!IMAGE_MIME_TYPES.includes(m as ImageMime)) {
    throw new ImageUnsupportedError(`不支持的 MIME: ${m};仅接受 JPEG/PNG/WebP`)
  }
  return m as ImageMime
}

async function renderAtDim(
  bitmap: ImageBitmap,
  maxDim: number,
  quality: number,
): Promise<Blob> {
  const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * ratio))
  const h = Math.max(1, Math.round(bitmap.height * ratio))

  // OffscreenCanvas 在 worker 也能跑,优先用;否则 fallback 到 HTMLCanvasElement
  type DrawableContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

  const drawAndExport = async (
    ctx: DrawableContext,
    canvas: { width: number; height: number; convertToBlob?: (opts: { type: string; quality?: number }) => Promise<Blob> },
  ): Promise<Blob> => {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    if (canvas.convertToBlob) {
      return await canvas.convertToBlob({ type: 'image/jpeg', quality })
    }
    return new Promise<Blob>((resolve, reject) => {
      ;(canvas as unknown as HTMLCanvasElement).toBlob(
        (b) => b ? resolve(b) : reject(new Error('canvas.toBlob 返回 null')),
        'image/jpeg',
        quality,
      )
    })
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('OffscreenCanvas 2d context 不可用')
    return await drawAndExport(ctx, canvas)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context 不可用')
  return await drawAndExport(ctx, canvas)
}
