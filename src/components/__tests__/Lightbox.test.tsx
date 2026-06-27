/**
 * Lightbox 组件测试
 *
 * 覆盖:
 * - 打开后渲染 phase='placeholder' 或 'downloading'(没本地 blob 时)
 * - 本地有 original → phase='ready' 渲染原图
 * - 本地有 thumb → 当 placeholder 显示(模糊的 thumb)
 * - Esc 关闭 → 调 onClose
 * - 点击背景关闭 → 调 onClose
 * - X 按钮关闭 → 调 onClose,但 stopPropagation 不触发背景关闭
 * - 收到 image-download-failed → phase='failed' 显示重试按钮
 * - 重试按钮 → 调 queue.retry
 * - 没图的 note 直接 onClose(兜底)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { v4 as uuidv4 } from 'uuid'
import { db, openDb, nowIso } from '@/lib/db'
import Lightbox from '@/components/Lightbox'
import type { Note, Attachment } from '@/types'

const enqueue = vi.fn((_opts: { source: unknown; priority: string }) => undefined)
const retryMock = vi.fn((_id: string, _source: unknown) => undefined)

vi.mock('@/lib/imageDownloadQueue', () => ({
  enqueue: (opts: { source: unknown; priority: string }) => enqueue(opts),
  cancelNote: () => undefined,
  retry: (id: string, source: unknown) => retryMock(id, source),
}))

// happy-dom + fake-indexeddb 的 Blob 在读回时丢 instanceof Blob,
// createObjectURL 抛 TypeError。给宽容版。
const origCreate = URL.createObjectURL.bind(URL)
beforeEach(async () => {
  await openDb()
  await db.notes.clear()
  await db.attachments.clear()
  enqueue.mockClear()
  retryMock.mockClear()
  let counter = 0
  URL.createObjectURL = ((obj: Blob | { type?: string }) => {
    if (obj instanceof Blob) return origCreate(obj)
    return `blob:fake-${++counter}`
  }) as typeof URL.createObjectURL
})

const mkNote = (over: Partial<Note> = {}): Note => ({
  id: uuidv4(),
  content: 'note content',
  status: 'pending',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  archived_at: null,
  version: 1,
  sync_status: 'synced',
  last_synced_at: null,
  image_path: 'note-images/u/n/x.jpg',
  image_thumb_path: 'note-images/u/n/thumb-x.jpg',
  image_thumb_sm_path: 'note-images/u/n/thumb-sm-x.jpg',
  image_uploaded_at: '2026-01-01T00:00:00.000Z',
  image_mime: 'image/jpeg',
  image_size: 1024,
  image_width: 800,
  image_height: 600,
  ...over,
})

const mkAtt = (noteId: string, kind: Attachment['kind']): Attachment => ({
  id: uuidv4(),
  note_id: noteId,
  kind,
  blob: new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/jpeg' }),
  mime: 'image/jpeg',
  size: 2,
  width: 100,
  height: 100,
  created_at: nowIso(),
})

describe('Lightbox', () => {
  it('打开后入队 enqueue 下载 original', async () => {
    const note = mkNote()
    render(<Lightbox note={note} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(enqueue).toHaveBeenCalled()
    })
    const call = enqueue.mock.calls[0]?.[0] as { source: { noteId: string; mime: string }; priority: string }
    expect(call.priority).toBe('manual')
    expect(call.source.noteId).toBe(note.id)
  })

  it('本地有 original → 直接 ready 态,不调 enqueue', async () => {
    const note = mkNote()
    await db.attachments.add(mkAtt(note.id, 'original'))
    render(<Lightbox note={note} onClose={vi.fn()} />)
    // 等效:能查到 img 标签 (有 blob URL)
    await waitFor(() => {
      expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(1)
    })
    // enqueue 不应被调(已经有 original)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('没图(note.image_path == null)→ 立刻 onClose', async () => {
    const note = mkNote({ image_path: null, image_thumb_path: null, image_thumb_sm_path: null, image_uploaded_at: null })
    const onClose = vi.fn()
    render(<Lightbox note={note} onClose={onClose} />)
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('Esc 按下 → onClose', async () => {
    const note = mkNote()
    const onClose = vi.fn()
    render(<Lightbox note={note} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('点击背景 → onClose', async () => {
    const note = mkNote()
    const onClose = vi.fn()
    const { container } = render(<Lightbox note={note} onClose={onClose} />)
    // 背景层(最外层 div)被点击
    const backdrop = container.firstChild as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('点击 X 按钮 → onClose(stopPropagation 不再触发背景关闭)', async () => {
    const note = mkNote()
    const onClose = vi.fn()
    render(<Lightbox note={note} onClose={onClose} />)
    const closeBtn = screen.getByLabelText('关闭')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('本地有 thumb 但没 original → placeholder 用 thumb(模糊)', async () => {
    const note = mkNote()
    await db.attachments.add(mkAtt(note.id, 'thumb'))
    // 不放 original → 应进入 downloading 态,但 thumb 在 db 可被读到
    render(<Lightbox note={note} onClose={vi.fn()} />)
    await waitFor(() => {
      // 会读到 thumb 作为 placeholder(blur 样式)
      expect(document.querySelector('img.blur-sm')).toBeInTheDocument()
    })
    // 同时 enqueue 被调以下载 original
    expect(enqueue).toHaveBeenCalled()
  })

  it('收到 image-download-failed → phase=failed,显示重试按钮', async () => {
    const note = mkNote()
    render(<Lightbox note={note} onClose={vi.fn()} />)
    await waitFor(() => expect(enqueue).toHaveBeenCalled())
    window.dispatchEvent(
      new CustomEvent('image-download-failed', {
        detail: { noteId: note.id, reason: 'http', attempts: 3 },
      }),
    )
    await waitFor(() => {
      expect(screen.getByText('原图加载失败')).toBeInTheDocument()
    })
  })

  it('点击重试按钮 → 调 queue.retry', async () => {
    const note = mkNote()
    render(<Lightbox note={note} onClose={vi.fn()} />)
    await waitFor(() => expect(enqueue).toHaveBeenCalled())
    window.dispatchEvent(
      new CustomEvent('image-download-failed', {
        detail: { noteId: note.id, reason: 'http', attempts: 3 },
      }),
    )
    const retryBtn = await screen.findByRole('button', { name: /重试/ })
    fireEvent.click(retryBtn)
    expect(retryMock).toHaveBeenCalledWith(
      note.id,
      expect.objectContaining({ noteId: note.id, imagePath: note.image_path }),
    )
  })
})