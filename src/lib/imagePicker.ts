/**
 * imagePicker —— 跨平台统一选图 API
 *
 * | source     | Web                | Capacitor native                       |
 * |------------|--------------------|----------------------------------------|
 * | gallery    | (降级到 file)      | Camera.getPhoto({source:'PHOTOS'})     |
 * | camera     | getUserMedia?      | Camera.getPhoto({source:'CAMERA'})     |
 * | file       | <input type=file>  | (降级到 gallery)                        |
 * | clipboard  | navigator.clipboard.read() | (暂不支持)                     |
 *
 * 统一返回 { blob, mime, width, height, source }
 */
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import type { ImageMime } from '@/types'

export type ImageSource = 'gallery' | 'camera' | 'file' | 'clipboard'

export interface PickedImage {
  blob: Blob
  mime: ImageMime
  width: number   // 0 = 未知(剪贴板场景)
  height: number
  source: ImageSource
  sourcePath?: string  // 调试用
}

const isNative = (): boolean => Capacitor.isNativePlatform()

/**
 * 选图入口(平台分支)
 * - 失败 / 用户取消返回 null(不抛)
 * - 大小 / MIME 校验由 processImage 做,这里只负责取 blob
 */
export async function pickImage(source: ImageSource): Promise<PickedImage | null> {
  try {
    if (isNative()) return await pickNative(source)
    return await pickWeb(source)
  } catch (e) {
    if (isCancelError(e)) return null
    throw e
  }
}

/* ─── Web ────────────────────────────────────────────────────────────────── */

async function pickWeb(source: ImageSource): Promise<PickedImage | null> {
  if (source === 'clipboard') return pickWebClipboard()
  if (source === 'camera') {
    // Web 上 camera 通常走 <input capture="environment">,降级到 file picker
    return pickWebFile({ capture: 'environment' })
  }
  // gallery / file 在 web 上是同一个 <input type=file>
  return pickWebFile({})
}

function pickWebFile(opts: { capture?: 'environment' | 'user' }): Promise<PickedImage | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp'
    if (opts.capture) input.setAttribute('capture', opts.capture)
    input.style.position = 'fixed'
    input.style.top = '-9999px'

    let resolved = false
    const cleanup = () => {
      if (input.parentElement) input.parentElement.removeChild(input)
    }

    input.onchange = async () => {
      if (resolved) return
      resolved = true
      const file = input.files?.[0]
      cleanup()
      if (!file) {
        resolve(null)
        return
      }
      try {
        const picked = await blobToPicked(file, 'file')
        resolve(picked)
      } catch (e) {
        reject(e)
      }
    }
    document.body.appendChild(input)
    input.click()

    // 兜底:某些浏览器关掉 picker 不触发 change,给个超时
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        resolve(null)
      }
    }, 60_000)
  })
}

async function pickWebClipboard(): Promise<PickedImage | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.read) {
    throw new Error('当前环境不支持剪贴板图片读取')
  }
  const items = await navigator.clipboard.read()
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith('image/'))
    if (!imageType) continue
    const blob = await item.getType(imageType)
    return await blobToPicked(blob, 'clipboard')
  }
  return null
}

/* ─── Capacitor Native ───────────────────────────────────────────────────── */

async function pickNative(source: ImageSource): Promise<PickedImage | null> {
  if (source === 'clipboard') {
    throw new Error('native 端剪贴板图片读取暂未实现')
  }
  if (source === 'file') {
    // native 上 file 没有合适的 picker,降级到 gallery
    return pickNativeWithSource(CameraSource.Photos)
  }
  const camSource = source === 'camera' ? CameraSource.Camera : CameraSource.Photos
  return pickNativeWithSource(camSource)
}

async function pickNativeWithSource(camSource: CameraSource): Promise<PickedImage | null> {
  const photo = await Camera.getPhoto({
    source: camSource,
    resultType: CameraResultType.Uri,  // 'uri' 走 file:// 不爆内存
    quality: 92,
    allowEditing: false,
    correctOrientation: true,  // 自带 EXIF 旋转
  })

  const path = photo.path ?? photo.webPath
  if (!path) {
    throw new Error('Camera.getPhoto 未返回路径')
  }

  // Capacitor WebView 拦截 fetch(file://),可以直接拿 Blob
  const resp = await fetch(path)
  const blob = await resp.blob()

  // photo.format 是 'jpeg' / 'png' 这种简写;映射到完整 MIME
  const fmt = (photo.format ?? 'jpeg').toLowerCase()
  const mime: ImageMime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg'

  const dims = await readImageDimensions(blob)
  return {
    blob,
    mime,
    width: dims.width,
    height: dims.height,
    source: 'gallery',
    sourcePath: path,
  }
}

/* ─── 辅助 ───────────────────────────────────────────────────────────────── */

async function blobToPicked(blob: Blob, source: ImageSource): Promise<PickedImage> {
  const mime = blob.type.toLowerCase() as ImageMime
  const dims = await readImageDimensions(blob)
  return { blob, mime, width: dims.width, height: dims.height, source }
}

async function readImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    const w = bitmap.width
    const h = bitmap.height
    bitmap.close()
    return { width: w, height: h }
  } catch {
    return { width: 0, height: 0 }
  }
}

function isCancelError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  // 优先取 .message;再回退到 .name;都不是字符串就当不是 cancel 错误(避免 [object Object])
  const messageField = (e as { message?: unknown }).message
  const nameField = (e as { name?: unknown }).name
  const msg =
    typeof messageField === 'string'
      ? messageField
      : typeof nameField === 'string'
        ? nameField
        : null
  return msg != null && (/cancel/i.test(msg) || /abort/i.test(msg))
}
