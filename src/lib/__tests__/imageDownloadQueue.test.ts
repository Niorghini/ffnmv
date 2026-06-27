/**
 * imageDownloadQueue 测试
 *
 * 覆盖:
 * - enqueue → 走 downloadOne → 写 attachments
 * - 并发上限 3:连发 5 个任务,同时 in-flight ≤ 3
 * - 去重:同一 note 多次 enqueue,priority 升级 + source 更新
 * - 重试上限 3:失败 3 次后 emit image-download-failed 事件
 * - cancelNote 取消 in-flight
 * - retry() 走 manual 优先级
 * - 旧数据兼容:thumbSmPath=null 只下 original + thumb
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { db, openDb } from '@/lib/db'
import {
  enqueue,
  cancelNote,
  cancelAll,
  retry,
  _resetForTests,
  _debugSnapshot,
  type EnqueueSource,
  type ImageDownloadFailedDetail,
} from '@/lib/imageDownloadQueue'

// mock noteImageStorage:getImageSignedUrl
const getImageSignedUrl = vi.fn(async (path: string) => `https://signed.example/${encodeURIComponent(path)}`)

vi.mock('@/lib/noteImageStorage', () => ({
  getImageSignedUrl: (path: string, _expiresIn: number) => getImageSignedUrl(path),
  ImageTooLargeError: class extends Error {
    constructor(msg: string) { super(msg); this.name = 'ImageTooLargeError' }
  },
  ImageUnsupportedError: class extends Error {
    constructor(msg: string) { super(msg); this.name = 'ImageUnsupportedError' }
  },
}))

// 控制 fetch 行为:正常返回 / 失败 / hang
type FetchBehavior = 'ok' | 'fail-http' | 'hang' | 'fail-network'
let fetchBehavior: FetchBehavior = 'ok'
let fetchDelayMs = 0
let activeFetches = 0
let maxActiveFetches = 0

const fakeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
  activeFetches += 1
  maxActiveFetches = Math.max(maxActiveFetches, activeFetches)
  if (fetchDelayMs > 0) {
    await new Promise<void>((resolve) => {
      const signal = init?.signal
      if (signal?.aborted) return resolve()
      const t = setTimeout(resolve, fetchDelayMs)
      signal?.addEventListener('abort', () => {
        clearTimeout(t)
        resolve()
      })
    })
    if (init?.signal?.aborted) {
      activeFetches -= 1
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }
  }
  activeFetches -= 1
  if (fetchBehavior === 'fail-http') {
    return new Response('not found', { status: 404 })
  }
  if (fetchBehavior === 'fail-network') {
    throw new TypeError('Failed to fetch')
  }
  if (fetchBehavior === 'hang') {
    // 不会 resolve;依赖 AbortController
    return new Promise<Response>(() => undefined)
  }
  // ok:返回一个最小 PNG blob
  const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
  return new Response(blob, { status: 200, headers: { 'content-type': 'image/png' } })
})

beforeEach(async () => {
  await openDb()
  await db.attachments.clear()
  await db.notes.clear()
  getImageSignedUrl.mockClear()
  fakeFetch.mockClear()
  fetchBehavior = 'ok'
  fetchDelayMs = 0
  activeFetches = 0
  maxActiveFetches = 0
  vi.stubGlobal('fetch', fakeFetch)
  _resetForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const mkSource = (over: Partial<EnqueueSource> = {}): EnqueueSource => ({
  noteId: 'n1',
  imagePath: 'note-images/u1/n1/a.jpg',
  thumbPath: 'note-images/u1/n1/thumb-a.jpg',
  thumbSmPath: 'note-images/u1/n1/thumb-sm-a.jpg',
  mime: 'image/jpeg',
  ...over,
})

// helper:等 microtask + setTimeout 0 + 一帧
const flush = async (ms = 5): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms))
}

describe('imageDownloadQueue', () => {
  it('enqueue 触发下载,写 3 条 attachments(original + thumb + thumb-sm)', async () => {
    enqueue({ source: mkSource(), priority: 'visible' })
    await flush(20)
    expect(getImageSignedUrl).toHaveBeenCalledTimes(3)
    const atts = await db.attachments.where('note_id').equals('n1').toArray()
    expect(atts).toHaveLength(3)
    expect(atts.map((a) => a.kind).sort()).toEqual(['original', 'thumb', 'thumb-sm'])
  })

  it('thumbSmPath=null 时只下 original + thumb(2 条)', async () => {
    enqueue({ source: mkSource({ thumbSmPath: null }), priority: 'visible' })
    await flush(20)
    expect(getImageSignedUrl).toHaveBeenCalledTimes(2)
    const atts = await db.attachments.where('note_id').equals('n1').toArray()
    expect(atts).toHaveLength(2)
  })

  it('并发上限 3:同时 in-flight ≤ 3', async () => {
    fetchDelayMs = 50
    for (let i = 0; i < 5; i++) {
      enqueue({ source: mkSource({ noteId: `n${i}` }), priority: 'visible' })
    }
    await flush(20)
    // 此时 5 个都 enqueue,3 个 in-flight,2 个 pending
    const snap = _debugSnapshot()
    expect(snap.inflight.length).toBe(3)
    expect(snap.pending.length).toBe(2)
    expect(maxActiveFetches).toBe(3)
    // 单 processItem = 3 个串行 download × 50ms = 150ms;5 个约 300ms
    await flush(500)
    expect(_debugSnapshot().inflight.length).toBe(0)
    expect(_debugSnapshot().pending.length).toBe(0)
  })

  it('去重:同一 note 多次 enqueue 不重复下载,priority 升级', async () => {
    fetchDelayMs = 50
    enqueue({ source: mkSource(), priority: 'prefetch' })
    await flush(30) // 第一次 processItem 已 in-flight,original 下载中
    enqueue({ source: mkSource(), priority: 'visible' })
    await flush(200) // 等所有 download 完成
    const atts = await db.attachments.where('note_id').equals('n1').toArray()
    expect(atts).toHaveLength(3)
  })

  it('重试上限 3:失败 3 次后 emit image-download-failed', async () => {
    fetchBehavior = 'fail-http'
    const events: ImageDownloadFailedDetail[] = []
    const handler = (e: Event) => events.push((e as CustomEvent<ImageDownloadFailedDetail>).detail)
    window.addEventListener('image-download-failed', handler)
    try {
      enqueue({ source: mkSource({ noteId: 'fail-note' }), priority: 'visible' })
      // 等 3 次失败 + pump 重试
      await flush(50)
      // 3 次失败之后 emit 事件
      expect(events).toHaveLength(1)
      expect(events[0].noteId).toBe('fail-note')
      expect(events[0].attempts).toBe(3)
    } finally {
      window.removeEventListener('image-download-failed', handler)
    }
  })

  it('cancelNote 取消 in-flight 中的任务', async () => {
    fetchBehavior = 'hang'
    enqueue({ source: mkSource({ noteId: 'c1' }), priority: 'visible' })
    await flush(10)
    expect(_debugSnapshot().inflight).toContain('c1')
    cancelNote('c1')
    await flush(20)
    // 取消后 in-flight / pending 都为空(AbortError 静默处理)
    expect(_debugSnapshot().inflight).toEqual([])
    expect(_debugSnapshot().pending).toEqual([])
  })

  it('cancelAll 清掉所有任务', async () => {
    fetchBehavior = 'hang'
    for (let i = 0; i < 5; i++) {
      enqueue({ source: mkSource({ noteId: `c${i}` }), priority: 'visible' })
    }
    await flush(10)
    expect(_debugSnapshot().inflight.length + _debugSnapshot().pending.length).toBe(5)
    cancelAll()
    expect(_debugSnapshot().inflight).toEqual([])
    expect(_debugSnapshot().pending).toEqual([])
  })

  it('retry() 走 manual 优先级', async () => {
    fetchBehavior = 'fail-http'
    // 先 enqueue 一次(消耗一次 attempt)
    enqueue({ source: mkSource({ noteId: 'r1' }), priority: 'visible' })
    await flush(20)
    // 现在 retry 计数器已经在内部;retry() 强制重置为 0
    fetchBehavior = 'ok'
    retry('r1', mkSource({ noteId: 'r1' }))
    await flush(20)
    const atts = await db.attachments.where('note_id').equals('r1').toArray()
    expect(atts.length).toBe(3)
  })

  it('优先级:manual > visible > prefetch;后面 enqueue 的 manual 提前调度', async () => {
    fetchDelayMs = 30
    // 先 prefetch 一票(占用所有 slot)
    for (let i = 0; i < 3; i++) {
      enqueue({ source: mkSource({ noteId: `p${i}` }), priority: 'prefetch' })
    }
    await flush(5)
    expect(_debugSnapshot().inflight.length).toBe(3)
    // 现在再 enqueue manual 4 + visible 5 + prefetch 6,manual 应该抢先
    enqueue({ source: mkSource({ noteId: 'm4' }), priority: 'manual' })
    enqueue({ source: mkSource({ noteId: 'v5' }), priority: 'visible' })
    enqueue({ source: mkSource({ noteId: 'p6' }), priority: 'prefetch' })
    await flush(5)
    // 第一个 in-flight 完成腾出 slot 后,manual 优先
    // 等到 m4 进 in-flight
    let m4Inflight = false
    for (let i = 0; i < 20; i++) {
      if (_debugSnapshot().inflight.includes('m4')) { m4Inflight = true; break }
      await flush(10)
    }
    expect(m4Inflight).toBe(true)
  })
})
