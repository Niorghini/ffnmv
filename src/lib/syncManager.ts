/**
 * SyncManager —— 同步核心
 * 严格按 PRD §5 实现，可注入 db/supabase/deviceId/clock 用于测试
 *
 * 主要改造（相对 PRD 模板）：
 * 1. 构造函数接受所有依赖，便于测试
 * 2. LWW 严格按 PRD 5.3（version → updated_at → device_id）
 * 3. note_tags 复合主键 onConflict: 'note_id,tag_id'
 * 4. Realtime 订阅加 user_id 过滤
 * 5. window.dispatchEvent('data-updated') 触发 UI 刷新
 * 6. online 事件触发全量同步 + 重置退避
 * 7. visibilitychange 触发全量同步
 * 8. 指数退避 1s→2s→4s→...→32s
 * 9. 批量 100 条
 * 10. 'data-updated' 事件触发即时同步（debounced 1s）
 */
import { v4 as uuidv4 } from 'uuid'
import { pickWinner } from './conflict'
import { useSyncStore } from '@/stores/useSyncStore'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Note, Tag, NoteTag,
  EntityType, SyncQueueItem, SyncQueueStatus, SyncEngineStatus, ConflictRecord,
} from '@/types'
import type { FfnDb } from './db'
import type { Database } from '@/types/api/database'

const ENTITIES: EntityType[] = ['notes', 'tags', 'note_tags']

// 联合实体类型（cloud / local 行都可能）
type SyncEntity = Note | Tag | NoteTag

// pkOf 输入是联合类型，输出是 id 字符串或 [string, string]
const pkOf = (entity: EntityType, row: SyncEntity): string | [string, string] => {
  if (entity === 'note_tags') {
    const r = row as NoteTag
    return [r.note_id, r.tag_id]
  }
  return (row as Note | Tag).id
}

const nowIso = (clock: () => number): string => new Date(clock()).toISOString()

// ─── SyncManager 公开类型 ────────────────────────────────────────────────
export interface SyncStateChange {
  status?: SyncEngineStatus
  lastSyncAt?: number
  error?: string | null
  pending?: number
  online?: boolean
}

export interface ConflictEvent {
  entityType: EntityType
  local: SyncEntity
  cloud: SyncEntity
  winner: SyncEntity
  conflictId: string
}

// 实际从 supabase Realtime 收到的 payload
interface RealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

export interface SyncManagerDeps {
  db: FfnDb
  supabase: SupabaseClient<Database>
  deviceId: string
  clock?: () => number
  onLocalChange?: ((entity: EntityType) => void) | null
  onSyncStateChange?: ((partial: SyncStateChange) => void) | null
  onConflict?: ((event: ConflictEvent) => void) | null
}

export class SyncManager {
  private db: FfnDb
  private supabase: SupabaseClient<Database>
  private deviceId: string
  private clock: () => number
  // 公开回调（syncInstance.ts 直接赋值）
  public onLocalChange: ((entity: EntityType) => void) | null
  public onSyncStateChange: ((partial: SyncStateChange) => void) | null
  public onConflict: ((event: ConflictEvent) => void) | null
  private isSyncing = false
  // public: 测试需要直接读写 realtimeChannel 来验证订阅状态
  public realtimeChannel: ReturnType<SupabaseClient<Database>['channel']> | null = null
  private _pollTimer: ReturnType<typeof setTimeout> | null = null
  // 自适应轮询基线 60s,空闲 3 次后翻倍,上限 5min。Realtime 已覆盖实时场景,
  // 这里只是兜底,所以可以激进拉长以省电/省带宽。
  private minPollInterval = 60000
  private maxPollInterval = 300000
  private pollInterval = this.minPollInterval
  private consecutiveEmpty = 0
  // public: 测试需要直接读写 retryDelay 来验证退避序列
  public retryDelay = 1000
  private maxRetryDelay = 32000
  private batchSize = 100
  // public: 测试需要直接读写 userId 来注入状态（绕过 start() 流程）
  public userId: string | null = null
  public _retryTimer: ReturnType<typeof setTimeout> | null = null
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _onOnline: (() => void) | null = null
  private _onOffline: (() => void) | null = null
  private _onVisibility: (() => void) | null = null
  private _onDataUpdated: (() => void) | null = null
  private _immediateSyncTimer: ReturnType<typeof setTimeout> | null = null
  private _onDbReset: (() => void) | null = null

  constructor({
    db,
    supabase,
    deviceId,
    clock = () => Date.now(),
    onLocalChange = null,
    onSyncStateChange = null,
    onConflict = null,
  }: SyncManagerDeps) {
    this.db = db
    this.supabase = supabase
    this.deviceId = deviceId
    this.clock = clock
    this.onLocalChange = onLocalChange
    this.onSyncStateChange = onSyncStateChange
    this.onConflict = onConflict
  }

  // 暴露 setter（syncInstance.ts 用来绑定 store）
  setOnSyncStateChange(fn: ((p: SyncStateChange) => void) | null): void { this.onSyncStateChange = fn }
  setOnConflict(fn: ((e: ConflictEvent) => void) | null): void { this.onConflict = fn }
  setOnLocalChange(fn: ((e: EntityType) => void) | null): void { this.onLocalChange = fn }
  // 直接赋值属性（向后兼容 syncInstance.ts 中 `sm.onSyncStateChange = ...` 的写法）

  async start(): Promise<boolean> {
    const u = await this.supabase.auth.getUser()
    const user = u?.data?.user
    if (!user) return false
    this.userId = user.id
    await this.fullSync()
    this.setupRealtime()
    this.startPolling()
    this.setupListeners()
    return true
  }

  async stop(): Promise<void> {
    if (this.realtimeChannel) {
      await this.supabase.removeChannel(this.realtimeChannel)
      this.realtimeChannel = null
    }
    if (this._pollTimer) {
      clearTimeout(this._pollTimer)
      this._pollTimer = null
    }
    this.removeListeners()
    if (this._retryTimer) clearTimeout(this._retryTimer)
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    if (this._immediateSyncTimer) clearTimeout(this._immediateSyncTimer)
  }

  // ─── 全量增量同步 ───────────────────────────────────────────────────
  async fullSync(): Promise<boolean> {
    if (this.isSyncing) return false
    if (!this.userId) {
      const u = await this.supabase.auth.getUser()
      const user = u?.data?.user
      if (!user) return false
      this.userId = user.id
    }
    this.isSyncing = true
    this._setState({ status: 'syncing' })
    let totalPulled = 0
    let totalPushed = 0
    try {
      for (const entity of ENTITIES) {
        const { pulled, pushed } = await this._syncEntity(entity)
        totalPulled += pulled
        totalPushed += pushed
      }
      this.retryDelay = 1000
      this._setState({ status: 'idle', lastSyncAt: this.clock() })
      return totalPulled > 0 || totalPushed > 0
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this._setState({ status: 'error', error: msg })
      this.scheduleRetry()
      return false
    } finally {
      this.isSyncing = false
    }
  }

  private async _syncEntity(entity: EntityType): Promise<{ pulled: number; pushed: number }> {
    const lastKey = `last_${entity}_sync_at`
    const meta = await this.db.sync_metadata.get(lastKey)
    const lastSyncAt = meta?.value || '1970-01-01T00:00:00.000Z'

    // 1. 拉云端增量
    const { data: cloudRows, error } = await this.supabase
      .from(entity)
      .select('*')
      .gt('updated_at', lastSyncAt)
      .order('updated_at', { ascending: true })

    if (error) throw error

    if (cloudRows && cloudRows.length > 0) {
      const localRows: SyncEntity[] = []
      const ts = nowIso(this.clock)
      await this.db.transaction('rw', this.db[entity], async () => {
        for (const cloudRowRaw of cloudRows as Record<string, unknown>[]) {
          const localRow = stripUserId(cloudRowRaw) as unknown as SyncEntity
          localRows.push(localRow)
          const pk = pkOf(entity, localRow)
          const existing = (await this.db[entity].get(pk as never)) as SyncEntity | undefined
          if (!existing) {
            await this.db[entity].put({
              ...(localRow as unknown as Record<string, unknown>),
              sync_status: 'synced',
              last_synced_at: ts,
            } as never)
          } else if (localRow.version > existing.version) {
            await this.db[entity].put({
              ...(localRow as unknown as Record<string, unknown>),
              sync_status: 'synced',
              last_synced_at: ts,
            } as never)
          } else if (localRow.version === existing.version && existing.sync_status === 'pending') {
            await this._handleConflict(entity, existing, localRow)
          }
          // 同 version 已同步：跳过；本地 version 更高：本地胜，留待推送
        }
      })
      const maxUpdatedAt = cloudRows
        .map((r) => (r as { updated_at: string }).updated_at)
        .reduce((m, t) => (t > m ? t : m), lastSyncAt)
      await this.db.sync_metadata.put({ key: lastKey, value: maxUpdatedAt })
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('data-updated', {
          detail: { entityType: entity, source: 'pull', rows: localRows }
        }))
      }
    }

    // 1.5 跨设备硬删除传播：拉全量 cloud ids，删本地有但云端没有的
    // 必须在 push 之前跑——否则 push 会把云端已删的 X upsert 回来，cleanup 就查不到了
    await this._cleanupRemoteHardDeletions(entity)

    // 2. 推送本地待同步
    const pushed = await this._pushLocalChanges(entity)
    return { pulled: cloudRows?.length || 0, pushed }
  }

  /**
   * 跨设备硬删除传播
   * - 拉云端当前 user 的全量 ids
   * - 跟本地所有行比对，删「云端没有但本地还有」的
   * - 让 hardDelete 在 A 端的效果传播到所有其他设备
   * - 跳过 pending/failed 行（即将被 push，删了会丢本地未同步的改动）
   * - 跳过软删 notes（deleted_at != null 是 trash 里的，不是硬删）
   * - 网络错 → warn 不阻塞 sync 其他步骤
   */
  private async _cleanupRemoteHardDeletions(entity: EntityType): Promise<void> {
    if (!['notes', 'tags', 'note_tags'].includes(entity)) return
    // note_tags 没 id 列（复合主键 note_id+tag_id），用 note_id 当唯一键
    const idCol = entity === 'note_tags' ? 'note_id' : 'id'
    try {
      const { data: cloudList, error } = await this.supabase
        .from(entity)
        .select(idCol)
      if (error) throw error
      const cloudIds = new Set(((cloudList || []) as Record<string, unknown>[]).map((r) => r[idCol] as string))

      const localRows = (await this.db[entity].toArray()) as SyncEntity[]
      const removedIds: string[] = []
      for (const local of localRows) {
        const id = (local as unknown as Record<string, unknown>)[idCol]
        if (cloudIds.has(id as string)) continue
        // pending/failed：让 push 处理，删了会丢本地未同步改动
        if (local.sync_status === 'pending' || local.sync_status === 'failed') continue
        // 真硬删：物理删本地（notes 的 trash 副本也一并清——A 端已硬删，trash 留着没意义）
        let pkStr: string
        if (entity === 'note_tags') {
          const l = local as NoteTag
          await this.db.note_tags.delete([l.note_id, l.tag_id])
          pkStr = `${l.note_id}:${l.tag_id}`
        } else {
          const l = local as Note | Tag
          await this.db[entity].delete(l.id)
          pkStr = l.id
        }
        removedIds.push(pkStr)
      }
      if (removedIds.length > 0) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('data-updated', {
            detail: { entityType: entity, source: 'cleanup', removed: removedIds }
          }))
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[sync] remote-delete cleanup for ${entity} failed:`, msg)
    }
  }

  // ─── 推送本地变更 ───────────────────────────────────────────────────
  private async _pushLocalChanges(entity: EntityType): Promise<number> {
    const table = this.db[entity]
    const pending = (await table
      .filter((row: SyncEntity) => row.sync_status === 'pending' || row.sync_status === 'failed')
      .limit(this.batchSize)
      .toArray()) as SyncEntity[]

    if (pending.length === 0) return 0

    const items = pending.map((row) => ({
      ...(row as unknown as Record<string, unknown>),
      user_id: this.userId,
      last_sync_device: (row as { last_sync_device?: string }).last_sync_device || this.deviceId,
      // 兜底:note_tags 老数据可能没 updated_at,撞云端 NOT NULL 约束。
      // 这里兜底补上,新数据由 repo 层正确写入。
      updated_at: row.updated_at || nowIso(this.clock),
    }))

    const onConflict = entity === 'note_tags' ? 'note_id,tag_id' : 'id'
    const { error } = await this.supabase
      .from(entity)
      .upsert(items as never[], { onConflict })

    if (error) throw error

    const ts = nowIso(this.clock)
    await this.db.transaction('rw', table, async () => {
      for (const row of pending) {
        const pk = pkOf(entity, row)
        const existing = (await table.get(pk as never)) as SyncEntity | undefined
        if (existing) {
          await table.put({
            ...(existing as unknown as Record<string, unknown>),
            sync_status: 'synced',
            last_synced_at: ts,
          } as never)
        }
      }
    })

    // 把对应的 sync_queue 条目标记为 done
    const queueItems = await this.db.sync_queue
      .where('entity_type')
      .equals(entity)
      .and((q: SyncQueueItem) => q.status === 'pending')
      .toArray()
    for (const q of queueItems) {
      if (q.id != null) await this.db.sync_queue.update(q.id, { status: 'done' satisfies SyncQueueStatus })
    }
    return pending.length
  }

  // ─── 冲突处理 ───────────────────────────────────────────────────────
  private async _handleConflict(entity: EntityType, local: SyncEntity, cloud: SyncEntity): Promise<void> {
    const winner = pickWinner<SyncEntity>(local, cloud)
    const conflictId = uuidv4()
    const pk = pkOf(entity, local)
    const localData = local as unknown as Record<string, unknown>
    const cloudData = cloud as unknown as Record<string, unknown>
    const record: ConflictRecord = entity === 'notes'
      ? { id: conflictId, entity_type: 'notes', entity_id: typeof pk === 'object' ? `${pk[0]}:${pk[1]}` : pk, local_data: localData as unknown as Note, cloud_data: cloudData as unknown as Note, created_at: nowIso(this.clock) }
      : entity === 'tags'
        ? { id: conflictId, entity_type: 'tags', entity_id: typeof pk === 'object' ? `${pk[0]}:${pk[1]}` : pk, local_data: localData as unknown as Tag, cloud_data: cloudData as unknown as Tag, created_at: nowIso(this.clock) }
        : { id: conflictId, entity_type: 'note_tags', entity_id: typeof pk === 'object' ? `${pk[0]}:${pk[1]}` : pk, local_data: localData as unknown as NoteTag, cloud_data: cloudData as unknown as NoteTag, created_at: nowIso(this.clock) }
    await this.db.conflicts.add(record)
    this.onConflict?.({ entityType: entity, local, cloud, winner, conflictId })
    if (winner === cloud) {
      const localCloud = stripUserId(cloud as unknown as Record<string, unknown>) as unknown as SyncEntity
      await this.db[entity].put({
        ...(localCloud as unknown as Record<string, unknown>),
        sync_status: 'synced',
        last_synced_at: nowIso(this.clock),
      } as never)
    }
  }

  // ─── Realtime ───────────────────────────────────────────────────────
  // public: 测试直接调用
  setupRealtime(): void {
    if (this.realtimeChannel) return
    const ch = this.supabase
      .channel('ffn-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${this.userId}` },
        (p: RealtimePayload) => this._handleRealtimeChange('notes', p),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tags', filter: `user_id=eq.${this.userId}` },
        (p: RealtimePayload) => this._handleRealtimeChange('tags', p),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'note_tags', filter: `user_id=eq.${this.userId}` },
        (p: RealtimePayload) => this._handleRealtimeChange('note_tags', p),
      )
      .subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.scheduleRealtimeReconnect()
        }
      })
    this.realtimeChannel = ch
  }

  // public: 测试直接调用
  async _handleRealtimeChange(entity: EntityType, payload: RealtimePayload): Promise<void> {
    const { eventType, new: newRow, old: oldRow } = payload
    if (newRow?.last_sync_device === this.deviceId) return

    const ts = nowIso(this.clock)
    let dispatchDetail: Record<string, unknown> = { entityType: entity, source: 'realtime' }
    await this.db.transaction('rw', this.db[entity], async () => {
      if (eventType === 'DELETE') {
        const pk = pkOf(entity, oldRow as unknown as SyncEntity)
        const existing = (await this.db[entity].get(pk as never)) as SyncEntity | undefined
        if (existing && existing.sync_status === 'pending') return
        await this.db[entity].delete(pk as never)
        const pkStr = Array.isArray(pk) ? pk.join(':') : pk
        dispatchDetail = { ...dispatchDetail, removed: [pkStr] }
      } else {
        const localRow = stripUserId(newRow) as unknown as SyncEntity
        const pk = pkOf(entity, localRow)
        const existing = (await this.db[entity].get(pk as never)) as SyncEntity | undefined
        if (!existing) {
          await this.db[entity].put({
            ...(localRow as unknown as Record<string, unknown>),
            sync_status: 'synced',
            last_synced_at: ts,
          } as never)
          dispatchDetail = { ...dispatchDetail, rows: [localRow] }
        } else if (localRow.version > existing.version) {
          if (existing.sync_status === 'pending') {
            await this._handleConflict(entity, existing, localRow)
          } else {
            await this.db[entity].put({
              ...(localRow as unknown as Record<string, unknown>),
              sync_status: 'synced',
              last_synced_at: ts,
            } as never)
            dispatchDetail = { ...dispatchDetail, rows: [localRow] }
          }
        }
        // 同/低 version：跳过
      }
    })

    this.onLocalChange?.(entity)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('data-updated', { detail: dispatchDetail }))
    }
  }

  private scheduleRealtimeReconnect(): void {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this.setupRealtime()
    }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay)
  }

  // ─── 轮询 + 监听 ───────────────────────────────────────────────────
  private startPolling(): void {
    if (this._pollTimer) return
    this._schedulePoll()
  }

  // 自适应轮询:基线 60s,连续 3 次空 sync(无拉无推)翻倍间隔,上限 5min。
  // 任何本地写入会触发 1s debounced 立即同步,如果有变更就把间隔重置回基线。
  private _schedulePoll(): void {
    this._pollTimer = setTimeout(async () => {
      this._pollTimer = null
      // 跳过条件:正在 sync / 离线 / tab 在后台——但仍要 reschedule 别丢失
      if (this.isSyncing
        || (typeof navigator !== 'undefined' && !navigator.onLine)
        || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) {
        this._schedulePoll()
        return
      }
      let hadChanges = false
      try {
        hadChanges = await this.fullSync()
      } catch {
        // fullSync 内部已经 setState('error'),这里吞掉不让定时器链断
      }
      this._adaptPollInterval(hadChanges)
      this._schedulePoll()
    }, this.pollInterval)
  }

  private _adaptPollInterval(hadChanges: boolean): void {
    if (hadChanges) {
      this.consecutiveEmpty = 0
      this.pollInterval = this.minPollInterval
    } else {
      this.consecutiveEmpty++
      if (this.consecutiveEmpty >= 3) {
        this.pollInterval = Math.min(this.pollInterval * 2, this.maxPollInterval)
      }
    }
  }

  private setupListeners(): void {
    if (typeof window === 'undefined') return
    this._onOnline = () => {
      this.retryDelay = 1000
      this.batchSize = 100
      useSyncStore.getState().setOnline(true)
      this.fullSync()
    }
    this._onOffline = () => {
      this.batchSize = 20
      this._setState({ status: 'offline' })
      useSyncStore.getState().setOnline(false)
    }
    this._onVisibility = () => {
      if (document.visibilityState === 'visible') this.fullSync()
    }
    this._onDataUpdated = () => {
      // 1s debounce：合并密集写入
      if (this._immediateSyncTimer) clearTimeout(this._immediateSyncTimer)
      this._immediateSyncTimer = setTimeout(() => {
        this._immediateSyncTimer = null
        if (!this.isSyncing) this.fullSync()
      }, 1000)
    }
    // 本地 DB 被 db.js self-heal 清空重建后,立即全量重拉补回数据。
    // 否则用户得等下一次 polling(60s+)才看到笔记回来,期间 UI 是空的。
    this._onDbReset = () => {
      console.info('[sync] db-reset detected, immediate full sync to recover local data')
      this.fullSync()
    }
    window.addEventListener('online', this._onOnline)
    window.addEventListener('offline', this._onOffline)
    document.addEventListener('visibilitychange', this._onVisibility)
    window.addEventListener('data-updated', this._onDataUpdated)
    window.addEventListener('db-reset', this._onDbReset)
  }

  private removeListeners(): void {
    if (typeof window === 'undefined') return
    if (this._onOnline) window.removeEventListener('online', this._onOnline)
    if (this._onOffline) window.removeEventListener('offline', this._onOffline)
    if (this._onDataUpdated) window.removeEventListener('data-updated', this._onDataUpdated)
    if (this._onDbReset) window.removeEventListener('db-reset', this._onDbReset)
    if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility)
  }

  // public: 测试直接调用
  scheduleRetry(): void {
    if (this._retryTimer) clearTimeout(this._retryTimer)
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null
      this.fullSync()
    }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay)
  }

  private _setState(partial: SyncStateChange): void {
    this.onSyncStateChange?.(partial)
  }
}

const stripUserId = (row: Record<string, unknown>): Record<string, unknown> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { user_id, ...rest } = row
  return rest
}

export const createSyncManager = (deps: SyncManagerDeps): SyncManager => new SyncManager(deps)