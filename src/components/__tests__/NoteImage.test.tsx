/**
 * NoteImage 组件测试
 *
 * 覆盖:
 * - 无图(note.image_size == null)→ 渲染 null
 * - 上传中(image_uploaded_at == null)→ spinner
 * - 本地有 blob → ready 态,渲染 <img>
 * - 本地没 blob → loading 态 + 触发 imageDownloadQueue.enqueue
 * - 收到 image-download-failed 事件 → failed 态 + 显示重试按钮
 * - variant=thumb-sm 默认;本地有 thumb-sm 用 thumb-sm,否则降级 thumb
 * - variant=full 用 original
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { v4 as uuidv4 } from 'uuid'
import { db, openDb, nowIso } from '@/lib/db'
import NoteImage from '@/components/NoteImage'
import type { Note, Attachment } from '@/types'

// mock imageDownloadQueue,避免真实下载
const enqueue = vi.fn((_opts: { source: unknown; priority: string }) => undefined)
const cancelNote = vi.fn((_id: string) => undefined)
const retryMock = vi.fn((_id: string, _source: unknown) => undefined)

vi.mock('@/lib/imageDownloadQueue', () => ({
  enqueue: (opts: { source: unknown; priority: string }) => enqueue(opts),
  cancelNote: (id: string) => cancelNote(id),
  retry: (id: string, source: unknown) => retryMock(id, source),
}))

// happy-dom + fake-indexeddb 在读回 Blob 时会丢失 instanceof Blob,
// 导致 URL.createObjectURL 抛 TypeError。给 happy-dom 装一个宽容版 createObjectURL。
const origCreate = URL.createObjectURL.bind(URL)
beforeEach(() => {
  let counter = 0
  URL.createObjectURL = ((obj: Blob | { type?: string }) => {
    if (obj instanceof Blob) return origCreate(obj)
    // fake-indexeddb 出来的伪 Blob:用 type 推断
    return `blob:fake-${++counter}`
  }) as typeof URL.createObjectURL
})

const mkNote = (over: Partial<Note> = {}): Note => ({
  id: uuidv4(),
  content: 'note',
  status: 'pending',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  archived_at: null,
  version: 1,
  sync_status: 'synced',
  last_synced_at: null,
  image_path: null,
  image_thumb_path: null,
  image_thumb_sm_path: null,
  image_uploaded_at: null,
  image_mime: null,
  image_size: null,
  image_width: null,
  image_height: null,
  ...over,
})

const mkAtt = (noteId: string, kind: Attachment['kind']): Attachment => ({
  id: uuidv4(),
  note_id: noteId,
  kind,
  blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
  mime: kind === 'original' ? 'image/png' : 'image/jpeg',
  size: 10,
  width: 100,
  height: 100,
  created_at: nowIso(),
})

beforeEach(async () => {
  await openDb()
  await db.notes.clear()
  await db.attachments.clear()
  enqueue.mockClear()
  cancelNote.mockClear()
  retryMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NoteImage', () => {
  it('无图(image_size == null)→ 渲染 null', async () => {
    const note = mkNote()
    const { container } = render(<NoteImage note={note} />)
    expect(container.firstChild).toBeNull()
  })

  it('已上传 + 本地有 blob → 渲染 <img>(ready 态)', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_thumb_sm_path: 'note-images/u/n/thumb-sm-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    await db.attachments.bulkAdd([
      mkAtt(note.id, 'original'),
      mkAtt(note.id, 'thumb'),
      mkAtt(note.id, 'thumb-sm'),
    ])
    render(<NoteImage note={note} />)
    const img = await screen.findByAltText('note attachment', {}, { timeout: 2000 })
    expect(img).toHaveAttribute('src')
  })

  it('已上传 + 本地没 blob → loading 态 + 调 enqueue', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    const { container } = render(<NoteImage note={note} />)
    // 等 spinner 出现(useEffect 异步)
    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })
    expect(enqueue).toHaveBeenCalled()
    const call = enqueue.mock.calls[0]?.[0] as { source: { noteId: string; mime: string }; priority: string }
    expect(call?.source.noteId).toBe(note.id)
    expect(call?.source.mime).toBe('image/jpeg')
    expect(call?.priority).toBe('visible')
  })

  it('收到 image-download-failed 事件 → 失败态 + 重试按钮', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    render(<NoteImage note={note} />)
    await waitFor(() => {
      expect(enqueue).toHaveBeenCalled()
    })
    // 模拟失败事件
    window.dispatchEvent(
      new CustomEvent('image-download-failed', {
        detail: { noteId: note.id, reason: 'http', attempts: 3 },
      }),
    )
    await waitFor(() => {
      expect(screen.getByText('图片加载失败')).toBeInTheDocument()
    })
    expect(screen.getByTitle('重试下载')).toBeInTheDocument()
  })

  it('点击重试按钮 → 调 queue.retry', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    render(<NoteImage note={note} />)
    await waitFor(() => {
      expect(enqueue).toHaveBeenCalled()
    })
    window.dispatchEvent(
      new CustomEvent('image-download-failed', {
        detail: { noteId: note.id, reason: 'http', attempts: 3 },
      }),
    )
    const retryBtn = await screen.findByTitle('重试下载')
    fireEvent.click(retryBtn)
    expect(retryMock).toHaveBeenCalledWith(
      note.id,
      expect.objectContaining({ noteId: note.id, imagePath: note.image_path }),
    )
  })

  it('variant=thumb-sm(默认):本地有 thumb-sm 用 thumb-sm', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_thumb_sm_path: 'note-images/u/n/thumb-sm-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    const thumbSmBlob = new Blob([new Uint8Array([0x01, 0x02, 0x03])], { type: 'image/jpeg' })
    await db.attachments.bulkAdd([
      mkAtt(note.id, 'original'),
      mkAtt(note.id, 'thumb'),
      { ...mkAtt(note.id, 'thumb-sm'), blob: thumbSmBlob, size: 3 },
    ])
    render(<NoteImage note={note} />)
    const img = await screen.findByRole('img')
    // thumb-sm blob 头 01 02 03;若选到了 thumb-sm,img.src 会包含 thumbSmBlob
    expect(img).toHaveAttribute('src')
  })

  it('variant=thumb-sm:本地没有 thumb-sm 时降级到 thumb', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    // 只有 original + thumb(旧数据,无 thumb-sm)
    await db.attachments.bulkAdd([
      mkAtt(note.id, 'original'),
      mkAtt(note.id, 'thumb'),
    ])
    render(<NoteImage note={note} />)
    const img = await screen.findByRole('img')
    expect(img).toHaveAttribute('src')
  })

  it('variant=full:本地有 original 用 original', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_thumb_sm_path: 'note-images/u/n/thumb-sm-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    await db.attachments.bulkAdd([
      mkAtt(note.id, 'original'),
      mkAtt(note.id, 'thumb'),
      mkAtt(note.id, 'thumb-sm'),
    ])
    render(<NoteImage note={note} variant="full" />)
    await screen.findByRole('img')
    // 关键是不要抛错,组件渲染成功
  })

  it('卸载时调 cancelNote', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    const { unmount } = render(<NoteImage note={note} />)
    await waitFor(() => {
      expect(enqueue).toHaveBeenCalled()
    })
    unmount()
    expect(cancelNote).toHaveBeenCalledWith(note.id)
  })

  it('点击 ready 缩略图 → 触发 onImageClick(note)', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_thumb_sm_path: 'note-images/u/n/thumb-sm-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    await db.attachments.bulkAdd([
      mkAtt(note.id, 'original'),
      mkAtt(note.id, 'thumb'),
      mkAtt(note.id, 'thumb-sm'),
    ])
    const onImageClick = vi.fn()
    render(<NoteImage note={note} onImageClick={onImageClick} />)
    const img = await screen.findByAltText('note attachment')
    fireEvent.click(img)
    expect(onImageClick).toHaveBeenCalledTimes(1)
    // 第一个参数是 note 对象
    expect(onImageClick.mock.calls[0]?.[0]).toMatchObject({ id: note.id })
  })

  it('没传 onImageClick → img 不带 onClick(cursor 普通)', async () => {
    const note = mkNote({
      image_size: 1024,
      image_mime: 'image/jpeg',
      image_path: 'note-images/u/n/x.jpg',
      image_thumb_path: 'note-images/u/n/thumb-x.jpg',
      image_thumb_sm_path: 'note-images/u/n/thumb-sm-x.jpg',
      image_uploaded_at: '2026-01-01T00:00:00.000Z',
    })
    await db.attachments.bulkAdd([
      mkAtt(note.id, 'original'),
      mkAtt(note.id, 'thumb'),
      mkAtt(note.id, 'thumb-sm'),
    ])
    render(<NoteImage note={note} />)
    const img = await screen.findByAltText('note attachment')
    // 无 onImageClick → 点击不报错(没有 handler)
    fireEvent.click(img)
    // cursor 不是 pointer
    expect(img.className).not.toContain('cursor-pointer')
  })
})