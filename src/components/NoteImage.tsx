/**
 * NoteImage —— 笔记图片渲染
 *
 * 渲染分支(按 note + 状态):
 * - 无图(image_size == null) → 不渲染
 * - 上传中(image_uploaded_at == null) → 灰底 + spinner
 * - 已上传,本地有 blob → 按 variant 选 blob kind(列表 thumb-sm / 详情 thumb / 原图)
 * - 已上传,本地没 blob → 触发 imageDownloadQueue.enqueue 下载
 * - 已下载失败(收到 image-download-failed 事件)→ 显示重试按钮
 *
 * 性能:
 * - variant=thumb-sm (默认):列表场景,256px JPEG,体积 ≈ thumb 的 1/3
 * - variant=thumb:详情页快速加载占位,512px
 * - variant=full:原图
 *
 * 并发:接 imageDownloadQueue,3 并发上限 + 优先级 + 重试
 * 视口:`onVisibleChange` 让父组件把 priority 提到 visible
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, ImageOff, RefreshCw } from 'lucide-react'
import { db } from '@/lib/db'
import {
  enqueue,
  cancelNote,
  retry as queueRetry,
  type EnqueueSource,
  type ImageDownloadFailedDetail,
  type ImageDownloadProgressDetail,
} from '@/lib/imageDownloadQueue'
import ProgressBar from './ProgressBar'
import type { Note } from '@/types'

/** 进度条显示阈值:总字节 < 此值不显示(thumb-sm ~20KB,太快了) */
const PROGRESS_MIN_BYTES = 50_000

export interface NoteImageProps {
  note: Note
  /**
   * 渲染哪一级缩略图
   * - 'thumb-sm'(默认):列表场景,128px;本地没有就降级到 thumb
   * - 'thumb':详情页快速加载,512px
   * - 'full':详情页原图
   */
  variant?: 'thumb-sm' | 'thumb' | 'full'
  className?: string
  /**
   * 元素可见性变化(配合 IntersectionObserver)
   * visible=true 时父组件把 queue priority 提到 'visible'
   */
  onVisibleChange?: (visible: boolean) => void
  /**
   * 点击缩略图时触发(打开 lightbox)
   * 父组件负责 stopPropagation 避免和整行 onClick 冲突
   */
  onImageClick?: (note: Note) => void
}

type LoadState = 'idle' | 'loading' | 'ready' | 'missing' | 'failed'

const NoteImage = ({
  note,
  variant = 'thumb-sm',
  className = '',
  onVisibleChange,
  onImageClick,
}: NoteImageProps) => {
  const [state, setState] = useState<LoadState>('idle')
  const [url, setUrl] = useState<string | null>(null)
  /** 当前下载进度;state=loading 时使用;ready/failed 时清空 */
  const [progress, setProgress] = useState<{ received: number; total: number; ratio: number } | null>(null)
  const urlRef = useRef<string | null>(null)

  const hasImage = note.image_size != null
  const uploaded = note.image_path != null && note.image_uploaded_at != null

  // 监听 image-download-failed 事件,失败时切到 failed 态并展示重试按钮
  useEffect(() => {
    if (!hasImage) return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ImageDownloadFailedDetail>).detail
      if (detail.noteId === note.id) {
        setState('failed')
        setProgress(null)
      }
    }
    window.addEventListener('image-download-failed', handler)
    return () => window.removeEventListener('image-download-failed', handler)
  }, [note.id, hasImage])

  // 监听 image-download-progress:更新本 note 的进度条
  useEffect(() => {
    if (!hasImage) return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ImageDownloadProgressDetail>).detail
      if (detail.noteId !== note.id) return
      // ratio=0 + total=0 是 cancel 信号;清掉进度
      if (detail.total === 0 && detail.received === 0) {
        setProgress(null)
        return
      }
      // 100% 完成:让 loading → ready 的轮询逻辑接管,这里只 set null
      if (detail.ratio >= 1) {
        setProgress(null)
        return
      }
      setProgress({
        received: detail.received,
        total: detail.total,
        ratio: detail.ratio,
      })
    }
    window.addEventListener('image-download-progress', handler)
    return () => {
      window.removeEventListener('image-download-progress', handler)
      setProgress(null)
    }
  }, [note.id, hasImage])
  // 监听 image-thumb-ready:小缩略图刚下完,不等 poll 100ms 轮询,立即重新查 attachments 渲染
  useEffect(() => {
    if (!hasImage) return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ noteId: string }>).detail
      if (detail.noteId !== note.id) return
      // 切到 'loading' 然后重新读 attachments(触发下面 useEffect 重跑)
      // 不直接设置 state='ready' 避免 double set
      void (async () => {
        const atts = await db.attachments.where('note_id').equals(note.id).toArray()
        const kind: 'thumb-sm' | 'thumb' | 'original' =
          variant === 'full'
            ? 'original'
            : variant === 'thumb'
              ? 'thumb'
              : atts.some((a) => a.kind === 'thumb-sm')
                ? 'thumb-sm'
                : 'thumb'
        const att = atts.find((a) => a.kind === kind)
        if (att) {
          if (urlRef.current) URL.revokeObjectURL(urlRef.current)
          const u = URL.createObjectURL(att.blob)
          urlRef.current = u
          setUrl(u)
          setState('ready')
        }
      })()
    }
    window.addEventListener('image-thumb-ready', handler)
    return () => window.removeEventListener('image-thumb-ready', handler)
  }, [note.id, variant, hasImage])
  // 加载 + 入队 — 拆两个 effect:
  // 1. unmount 时 cancelNote(只注一次,空 deps)
  // 2. note 关键字段变化时,重新查本地 attachments 并更新 UI;不 abort 在飞的下载
  //    (新字段通常表示上传完成或 sync 拉回,附件可能还没下载,但已经在 inflight 中,不该 abort)
  useEffect(() => {
    return () => {
      cancelNote(note.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setUrl(null)

    if (!hasImage) {
      setState('idle')
      return
    }

    void (async () => {
      try {
        const atts = await db.attachments.where('note_id').equals(note.id).toArray()
        if (cancelled) return
        const kind: 'thumb-sm' | 'thumb' | 'original' =
          variant === 'full'
            ? 'original'
            : variant === 'thumb'
              ? 'thumb'
              : atts.some((a) => a.kind === 'thumb-sm')
                ? 'thumb-sm'
                : 'thumb'
        const att = atts.find((a) => a.kind === kind)
        if (att) {
          const u = URL.createObjectURL(att.blob)
          urlRef.current = u
          setUrl(u)
          setState('ready')
          return
        }
        if (uploaded && note.image_path) {
          setState('loading')
          const source: EnqueueSource = {
            noteId: note.id,
            imagePath: note.image_path,
            thumbPath: note.image_thumb_path,
            thumbSmPath: note.image_thumb_sm_path,
            mime: note.image_mime ?? 'image/jpeg',
          }
          enqueue({ source, priority: 'visible' })
          // 轮询 attachments 表,等 queue 写入完成
          const poll = async (attempt: number): Promise<void> => {
            if (cancelled || attempt > 50) return
            await new Promise((r) => setTimeout(r, 100))
            if (cancelled) return
            const fresh = await db.attachments.where('note_id').equals(note.id).toArray()
            if (cancelled) return
            const target =
              fresh.find((a) => a.kind === (variant === 'full' ? 'original' : variant === 'thumb' ? 'thumb' : 'thumb-sm'))
              ?? fresh.find((a) => a.kind === 'thumb')
              ?? fresh.find((a) => a.kind === 'original')
            if (target) {
              const u = URL.createObjectURL(target.blob)
              urlRef.current = u
              setUrl(u)
              setState('ready')
            } else {
              void poll(attempt + 1)
            }
          }
          void poll(0)
          return
        }
        // 未上传完成(本地有 blob 但 cloud 还没收到)→ 等 imageUploadQueue
        setState('loading')
      } catch {
        if (!cancelled) setState('failed')
      }
    })()

    return () => {
      cancelled = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      // 注:cancelNote 不在这里调 — 移到上面那个 unmount-only 的 effect,避免
      // image_uploaded_at 等字段变化时把自己刚 enqueue 的下载 abort 掉。
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.image_path, note.image_thumb_path, note.image_thumb_sm_path, note.image_uploaded_at, variant])

  // 视口变化转发
  useEffect(() => {
    onVisibleChange?.(state === 'loading' || state === 'ready')
  }, [state, onVisibleChange])

  if (!hasImage) return null

  if (state === 'loading') {
    // 仅在"较大的图"显示进度条(< 50KB 的 thumb-sm 直接显示 spinner,闪一下进度条没意义)
    const showProgress =
      progress !== null && progress.total >= PROGRESS_MIN_BYTES
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gray-100 rounded-md ${className}`}
        style={{ minHeight: 120 }}
      >
        <Loader2 size={20} className="animate-spin text-gray-400 mb-1" />
        <span className="text-[10px] text-gray-400 mb-1">图片加载中</span>
        {showProgress && (
          <div className="w-3/4 max-w-[200px]">
            <ProgressBar
              ratio={progress.ratio}
              height={2}
              label={`${formatBytes(progress.received)} / ${formatBytes(progress.total)}`}
            />
          </div>
        )}
      </div>
    )
  }

  if (state === 'missing' || state === 'failed') {
    return (
      <div
        className={`flex items-center justify-center gap-2 bg-gray-50 rounded-md border border-dashed border-gray-200 ${className}`}
        style={{ minHeight: 80 }}
      >
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <ImageOff size={14} />
          {state === 'missing' ? '图片待下载' : '图片加载失败'}
        </span>
        <button
          type="button"
          onClick={() => {
            if (!note.image_path || !note.image_mime) return
            setState('loading')
            queueRetry(note.id, {
              noteId: note.id,
              imagePath: note.image_path,
              thumbPath: note.image_thumb_path,
              thumbSmPath: note.image_thumb_sm_path,
              mime: note.image_mime,
            })
          }}
          className="flex items-center gap-1 px-2 py-0.5 text-xs text-[#0077B6] hover:text-[#005f8c] hover:bg-blue-50 rounded transition-colors"
          title="重试下载"
        >
          <RefreshCw size={12} />
          重试
        </button>
      </div>
    )
  }

  if (state === 'ready' && url) {
    const dims =
      variant === 'thumb-sm'
        ? { w: 160, h: 120 }
        : { w: undefined, h: undefined }
    const clickable = !!onImageClick
    return (
      <img
        src={url}
        alt="note attachment"
        width={dims.w}
        height={dims.h}
        loading={variant === 'full' ? 'lazy' : 'eager'}
        fetchPriority={variant === 'full' ? 'auto' : 'high'}
        decoding="async"
        // eslint-disable-next-line react/forbid-dom-props
        onClick={onImageClick ? (e) => {
          e.stopPropagation()
          onImageClick(note)
        } : undefined}
        className={`rounded-md max-h-96 object-contain bg-gray-50 ${clickable ? 'cursor-pointer hover:opacity-95 transition-opacity' : ''} ${className}`}
      />
    )
  }

  return null
}

/** 字节 → 人类可读(KB / MB) */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export default NoteImage