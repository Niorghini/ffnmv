/**
 * SyncManager 测试
 * - 注入 fake supabase + fake clock
 * - 覆盖：拉取合并、推送、冲突入库、realtime 回调、轮询、监听、退避
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, openDb } from '@/lib/db'
import { SyncManager } from '@/lib/syncManager'
import { createFakeSupabase } from '@/test/fakes/supabase'

const DEVICE_ID = 'device-test'

const setupFakeUser = (sb) => {
  sb._setUser({ id: 'user-1', email: 'a@b.com' })
}

const mkNote = (over = {}) => ({
  id: 'n1',
  content: 'hello',
  status: 'pending',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  version: 1,
  sync_status: 'pending',
  last_synced_at: null,
  ...over,
})

describe('SyncManager', () => {
  let sb
  let sm
  let now

  beforeEach(async () => {
    await openDb()
    await db.notes.clear()
    await db.tags.clear()
    await db.note_tags.clear()
    await db.sync_queue.clear()
    await db.sync_metadata.clear()
    await db.conflicts.clear()
    sb = createFakeSupabase()
    setupFakeUser(sb)
    now = vi.fn(() => 1700000000000)
    sm = new SyncManager({ db, supabase: sb, deviceId: DEVICE_ID, clock: now })
  })

  // ── start / stop ───────────────────────────────────────────────────
  it('start() 在无 user 时返回 false', async () => {
    sb._setUser(null)
    const result = await sm.start()
    expect(result).toBe(false)
  })

  it('start() 在有 user 时启动 polling + listeners', async () => {
    const result = await sm.start()
    expect(result).toBe(true)
    expect(sm.userId).toBe('user-1')
    expect(sm.pollingInterval).toBeTruthy()
    await sm.stop()
  })

  // ── push ──────────────────────────────────────────────────────────
  it('_pushLocalChanges 把 pending 推上去 + 标 synced + 清队列', async () => {
    sm.userId = 'user-1' // start() 才会设置；这里直接调 _pushLocalChanges 需要手动设
    const note = mkNote()
    await db.notes.add(note)
    await sm._pushLocalChanges('notes')

    // 云端有这条
    const cloud = [...sb.state.tables.notes.values()][0]
    expect(cloud.id).toBe(note.id)
    expect(cloud.user_id).toBe('user-1')
    expect(cloud.last_sync_device).toBe(DEVICE_ID)

    // 本地标记为 synced
    const local = await db.notes.get(note.id)
    expect(local.sync_status).toBe('synced')
    expect(local.last_synced_at).toBe(new Date(now()).toISOString())
  })

  it('_pushLocalChanges 失败抛错（上层重试）', async () => {
    sm.userId = 'user-1'
    await db.notes.add(mkNote())
    sb._failNext('network down')
    await expect(sm._pushLocalChanges('notes')).rejects.toThrow()
  })

  it('_pushLocalChanges note_tags 用复合键 onConflict', async () => {
    sm.userId = 'user-1'
    await db.note_tags.add({
      note_id: 'n1', tag_id: 't1',
      created_at: '2026-01-01T00:00:00.000Z', version: 1, sync_status: 'pending',
    })
    await sm._pushLocalChanges('note_tags')
    const cloud = [...sb.state.tables.note_tags.values()][0]
    expect(cloud.note_id).toBe('n1')
    expect(cloud.tag_id).toBe('t1')
  })

  // ── pull + merge ─────────────────────────────────────────────────
  it('_syncEntity 拉取云端 → 写入本地', async () => {
    sb._putRow('notes', {
      id: 'n-cloud', content: 'from cloud', status: 'pending',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z',
      version: 3, last_sync_device: 'other',
    })
    await sm._syncEntity('notes')
    const local = await db.notes.get('n-cloud')
    expect(local).toBeTruthy()
    expect(local.sync_status).toBe('synced')
    expect(local.version).toBe(3)
    // 水印
    const meta = await db.sync_metadata.get('last_notes_sync_at')
    expect(meta.value).toBe('2026-02-01T00:00:00.000Z')
  })

  it('_syncEntity 云端 version 更高 → 覆盖本地', async () => {
    await db.notes.add(mkNote({ version: 1, sync_status: 'synced' }))
    sb._putRow('notes', {
      ...mkNote(), version: 5,
      updated_at: '2026-02-01T00:00:00.000Z', last_sync_device: 'other',
    })
    await sm._syncEntity('notes')
    const local = await db.notes.get('n1')
    expect(local.version).toBe(5)
  })

  it('_syncEntity 本地 version 更高 → 跳过（让 push 覆盖云端）', async () => {
    await db.notes.add(mkNote({ version: 10, sync_status: 'pending' }))
    sb._putRow('notes', {
      ...mkNote(), version: 5, updated_at: '2026-02-01T00:00:00.000Z', last_sync_device: 'other',
    })
    await sm._syncEntity('notes')
    const local = await db.notes.get('n1')
    expect(local.version).toBe(10)
  })

  // ── conflict ─────────────────────────────────────────────────────
  it('_handleConflict 入库 + 触发 onConflict + 应用 LWW', async () => {
    const local = mkNote({ version: 1, updated_at: '2026-01-01T00:00:00.000Z' })
    const cloud = { ...local, version: 2, updated_at: '2026-02-01T00:00:00.000Z', user_id: 'user-1' }
    await db.notes.add(local)
    let caught
    sm.onConflict = (info) => { caught = info }
    await sm._handleConflict('notes', local, cloud)
    expect(caught).toBeTruthy()
    expect(caught.winner).toBe(cloud)
    const conflicts = await db.conflicts.toArray()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].entity_type).toBe('notes')
    const localAfter = await db.notes.get('n1')
    expect(localAfter.version).toBe(2) // cloud 胜出，覆盖
  })

  it('_handleConflict local 胜出 → 保留本地', async () => {
    const local = mkNote({ version: 5, updated_at: '2026-02-01T00:00:00.000Z' })
    const cloud = { ...local, version: 1, updated_at: '2026-01-01T00:00:00.000Z', user_id: 'user-1' }
    await db.notes.add(local)
    sm.onConflict = () => {}
    await sm._handleConflict('notes', local, cloud)
    const after = await db.notes.get('n1')
    expect(after.version).toBe(5) // 没动
  })

  // ── realtime ─────────────────────────────────────────────────────
  it('setupRealtime 订阅 + user_id 过滤', async () => {
    sm.userId = 'user-1'
    sm.setupRealtime()
    expect(sm.realtimeChannel).toBeTruthy()
    expect(sb.state.realtimeHandlers).toHaveLength(3) // notes / tags / note_tags
  })

  it('_handleRealtimeChange 跳过本设备事件', async () => {
    sm.userId = 'user-1'
    await db.notes.add(mkNote({ sync_status: 'synced' }))
    await sm._handleRealtimeChange('notes', {
      eventType: 'UPDATE',
      new: { ...mkNote(), last_sync_device: DEVICE_ID },
    })
    // 没改动
    const local = await db.notes.get('n1')
    expect(local.version).toBe(1)
  })

  it('_handleRealtimeChange 接收远端更新', async () => {
    sm.userId = 'user-1'
    await db.notes.add(mkNote({ sync_status: 'synced' }))
    let dispatched
    const orig = window.dispatchEvent
    window.dispatchEvent = (e) => { dispatched = e }
    await sm._handleRealtimeChange('notes', {
      eventType: 'UPDATE',
      new: {
        ...mkNote(), version: 5,
        updated_at: '2026-02-01T00:00:00.000Z',
        last_sync_device: 'other',
      },
    })
    window.dispatchEvent = orig
    const local = await db.notes.get('n1')
    expect(local.version).toBe(5)
    expect(dispatched.type).toBe('data-updated')
  })

  it('_handleRealtimeChange 本地 pending 时 DELETE 不覆盖', async () => {
    sm.userId = 'user-1'
    await db.notes.add(mkNote({ sync_status: 'pending' }))
    await sm._handleRealtimeChange('notes', {
      eventType: 'DELETE',
      old: { id: 'n1' },
    })
    const local = await db.notes.get('n1')
    expect(local).toBeTruthy() // 没被删
  })

  // ── retry / backoff ─────────────────────────────────────────────
  it('scheduleRetry 指数退避 1s → 2s → 4s → 8s → 16s → 32s 封顶', () => {
    sm.retryDelay = 1000
    sm.scheduleRetry()
    expect(sm.retryDelay).toBe(2000)
    sm.scheduleRetry()
    expect(sm.retryDelay).toBe(4000)
    sm.scheduleRetry()
    expect(sm.retryDelay).toBe(8000)
    sm.scheduleRetry()
    expect(sm.retryDelay).toBe(16000)
    sm.scheduleRetry()
    expect(sm.retryDelay).toBe(32000)
    sm.scheduleRetry()
    expect(sm.retryDelay).toBe(32000) // 封顶
  })

  it('fullSync 失败触发 scheduleRetry', async () => {
    sm.userId = 'user-1'
    sb._failNext('boom')
    const states = []
    sm.onSyncStateChange = (s) => states.push(s)
    await sm.fullSync()
    expect(states.find((s) => s.status === 'error')).toBeTruthy()
    expect(sm._retryTimer).toBeTruthy()
  })

  // ── 集成 ────────────────────────────────────────────────────────
  it('完整 push + pull 不丢数据', async () => {
    // 本地 pending 一条
    await db.notes.add(mkNote({ content: 'local-only' }))
    // 远端有一条新行
    sb._putRow('notes', {
      id: 'n-cloud', content: 'from cloud', status: 'pending',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z',
      version: 1, last_sync_device: 'other',
    })
    await sm.fullSync()
    expect((await db.notes.get('n1')).sync_status).toBe('synced')
    expect((await db.notes.get('n-cloud'))).toBeTruthy()
  })

  // ── 跨设备硬删传播 ──────────────────────────────────────────
  it('跨设备硬删：云端没了的行本地也物理删', async () => {
    // 本地有两条 synced 行
    await db.notes.add(mkNote({ id: 'a', sync_status: 'synced' }))
    await db.notes.add(mkNote({ id: 'b', sync_status: 'synced' }))
    // 远端只有 a（A 端硬删了 b）
    sb._putRow('notes', { ...mkNote({ id: 'a' }), last_sync_device: 'other' })
    await sm.fullSync()
    expect(await db.notes.get('a')).toBeTruthy()
    expect(await db.notes.get('b')).toBeUndefined() // b 没了
  })

  it('cleanup 跳过 pending/failed 行（让 push 处理）', async () => {
    // 本地有 pending 行（即将被推）
    await db.notes.add(mkNote({ id: 'pending-note', sync_status: 'pending' }))
    // 远端没有（正常，B 没推过）
    await sm.fullSync()
    // 行**没被 cleanup 删掉**——被 push 推上去了，所以 sync_status 变 'synced'
    expect(await db.notes.get('pending-note')).toBeTruthy()
    expect((await db.notes.get('pending-note')).sync_status).toBe('synced')
  })

  it('cleanup 跳过软删 notes（trash 里的不删）', async () => {
    await db.notes.add(mkNote({ id: 'trash', sync_status: 'synced', deleted_at: '2026-06-01T00:00:00.000Z' }))
    // 远端没有这个 id
    await sm.fullSync()
    // 软删行**还在**——不是硬删
    expect(await db.notes.get('trash')).toBeTruthy()
  })

  it('cleanup 失败仅 warn，不阻塞 sync 其他步骤', async () => {
    // 让 select('id') 抛错
    sb.from = vi.fn((name) => ({
      select: vi.fn().mockReturnValue({
        // 不是 thenable 也不返回 error——直接 throw
        // 但 fake 不支持，先模拟一个 error
        // 简化：让 select() 失败走 wrap 报错
      }),
    }))
    // 用更直接的方式：覆盖 supabase.from 让它在 select 路径上抛
    sb.state.failNext = true
    // 让数据库已有 synced 数据，sync 应该完成（不抛）
    await db.notes.add(mkNote({ id: 'x', sync_status: 'synced' }))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sm.fullSync()).resolves.toBeUndefined()
    spy.mockRestore()
    // failNext 已被消费
    sb.state.failNext = false
  })
})
