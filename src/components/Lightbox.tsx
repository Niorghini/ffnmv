/**
 * Lightbox —— 全屏图片预览
 *
 * 触发:NoteImage 缩略图被点击
 * 行为:全屏覆盖显示原图,关闭(背景点击 / Esc / X 按钮)后释放
 *
 * 加载策略:
 * - 打开时:优先显示已有 thumb-sm(本地)作为 placeholder,秒渲染
 * - 入队 imageDownloadQueue 下载 original(priority=manual)
 * - 收到 image-thumb-ready 事件后,NoteImage(在列表)已经在显示 thumb,
 *   但 lightbox 自己也要追踪:若 thumb 还没下好,fallback 显示 spinner
 * - original 下载完成 → 切到原图渲染
 *
 * 注意:
 * - 用 imageDownloadQueue.retry(retry),而不是 enqueue —— retry 优先级 manual,
 *   抢带宽;enqueue(visible)会被同 note 已有的 prefetch/visible 任务 dedup,
 *   可能不及时下载 original。
 * - original 失败时显示重试按钮,复用 imageDownloadQueue.retry 路径。
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, X, RefreshCw } from 'lucide-react'
import { db } from '@/lib/db'
import {
  enqueue,
  retry as queueRetry,
  type ImageDownloadFailedDetail,
} from '@/lib/imageDownloadQueue'
import type { Note } from '@/types'

export interface LightboxProps {
  note: Note
  onClose: () => void
}

type Phase = 'placeholder' | 'downloading' | 'ready' | 'failed'

const Lightbox = ({ note, onClose }: LightboxProps) => {
  const [phase, setPhase] = useState<Phase>('placeholder')
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [fullUrl, setFullUrl] = useState<string | null>(null)
  const thumbUrlRef = useRef<string | null>(null)
  const fullUrlRef = useRef<string | null>(null)

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 监听 image-download-failed:切换到 failed 态显示重试按钮
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ImageDownloadFailedDetail>).detail
      if (detail.noteId === note.id) setPhase('failed')
    }
    window.addEventListener('image-download-failed', handler)
    return () => window.removeEventListener('image-download-failed', handler)
  }, [note.id])

  // 加载 thumb-sm 当 placeholder + 入队 original 下载
  useEffect(() => {
    let cancelled = false
    if (!note.image_path || !note.image_mime) {
      // 没图不应该打开 lightbox,但兜底直接关掉
      onClose()
      return
    }

    void (async () => {
      // 1. 读 thumb / thumb-sm 当 placeholder
      const atts = await db.attachments.where('note_id').equals(note.id).toArray()
      if (cancelled) return
      const thumbAtt = atts.find((a) => a.kind === 'thumb-sm') ?? atts.find((a) => a.kind === 'thumb')
      if (thumbAtt) {
        const u = URL.createObjectURL(thumbAtt.blob)
        thumbUrlRef.current = u
        setThumbUrl(u)
      }

      // 2. 看 original 是不是已经在本地(同设备打开的图)
      const originalAtt = atts.find((a) => a.kind === 'original')
      if (originalAtt) {
        const u = URL.createObjectURL(originalAtt.blob)
        fullUrlRef.current = u
        setFullUrl(u)
        setPhase('ready')
        return
      }

      // 3. 入队下载 original —— 用 enqueue 而非 retry:retry 只设 priority=manual,
      //    但 enqueue 走完整路径(去重 + 优先级调度)
      setPhase('downloading')
      enqueue({
        source: {
          noteId: note.id,
          imagePath: note.image_path!,
          thumbPath: note.image_thumb_path,
          thumbSmPath: note.image_thumb_sm_path,
          mime: note.image_mime!,
        },
        priority: 'manual',
      })

      // 4. 轮询 attachments 表等 original 落库
      const poll = async (attempt: number): Promise<void> => {
        if (cancelled || attempt > 100) return
        await new Promise((r) => setTimeout(r, 100))
        if (cancelled) return
        const fresh = await db.attachments.where('note_id').equals(note.id).toArray()
        if (cancelled) return
        const full = fresh.find((a) => a.kind === 'original')
        if (full) {
          const u = URL.createObjectURL(full.blob)
          fullUrlRef.current = u
          setFullUrl(u)
          setPhase('ready')
        } else {
          void poll(attempt + 1)
        }
      }
      void poll(0)
    })()

    return () => {
      cancelled = true
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current)
      if (fullUrlRef.current) URL.revokeObjectURL(fullUrlRef.current)
      thumbUrlRef.current = null
      fullUrlRef.current = null
    }
  }, [note.id, note.image_path, note.image_thumb_path, note.image_thumb_sm_path, note.image_mime, onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* 顶部关闭按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10"
        aria-label="关闭"
      >
        <X size={22} />
      </button>

      {/* 图片区 */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {fullUrl ? (
          <img
            src={fullUrl}
            alt={note.content.slice(0, 60)}
            className="max-w-full max-h-[85vh] object-contain rounded-md"
            decoding="async"
          />
        ) : thumbUrl ? (
          // 占位:已经有 thumb 时显示模糊的 thumb,等 original 切上来
          <img
            src={thumbUrl}
            alt={note.content.slice(0, 60)}
            className="max-w-full max-h-[85vh] object-contain rounded-md blur-sm"
            decoding="async"
          />
        ) : null}

        {(phase === 'downloading' || phase === 'placeholder') && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black/50 rounded-full p-4">
              <Loader2 size={32} className="animate-spin text-white" />
            </div>
          </div>
        )}

        {phase === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 rounded-md">
            <span className="text-white text-sm">原图加载失败</span>
            <button
              type="button"
              onClick={() => {
                if (!note.image_path || !note.image_mime) return
                setPhase('downloading')
                queueRetry(note.id, {
                  noteId: note.id,
                  imagePath: note.image_path,
                  thumbPath: note.image_thumb_path,
                  thumbSmPath: note.image_thumb_sm_path,
                  mime: note.image_mime,
                })
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-gray-800 text-sm rounded-md hover:bg-gray-100 transition-colors"
            >
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        )}

        {/* 底部 note 内容摘要 */}
        {note.content && (
          <div className="mt-3 max-w-full text-white/80 text-xs text-center line-clamp-3 px-4">
            {note.content}
          </div>
        )}
      </div>
    </div>
  )
}

export default Lightbox