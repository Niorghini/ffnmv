/**
 * 自动归档（PRD 4.1）
 * - 已处理（completed）笔记超过 N 天自动设 archived_at
 * - 启动时跑一次 + 每天 0 点跑一次
 * - N 来自 sync_metadata key 'archive_after_days'，默认 30
 *   合法值：7 | 30 | -1（永不）
 */
import { db, nowIso } from '@/lib/db'
import { emitDataUpdated } from '@/lib/tags'
import type { Note } from '@/types'

const KEY = 'archive_after_days'
const DEFAULT = 30
const VALID = new Set([7, 30, -1])

export const getArchiveAfterDays = async (): Promise<number> => {
  const row = await db.sync_metadata.get(KEY)
  if (!row) return DEFAULT
  const v = Number(row.value)
  return VALID.has(v) ? v : DEFAULT
}

export const setArchiveAfterDays = async (v: number): Promise<void> => {
  if (!VALID.has(v)) throw new Error(`Invalid archive_after_days: ${v}`)
  await db.sync_metadata.put({ key: KEY, value: v })
}

/**
 * 跑一次归档
 * - N = -1：直接返回，不归档
 * - 否则：把 updated_at < now - N*86400000 的 completed 笔记打上 archived_at
 * - 同时清 archived_at（反向撤销）：如果 N 缩短了，已归档的需要回滚
 *   简单起见：如果 archived_at < now - N*86400000，保持归档；
 *             否则不动（避免误操作）
 */
export const runArchive = async ({ now = Date.now() }: { now?: number } = {}): Promise<number> => {
  const days = await getArchiveAfterDays()
  if (days === -1) return 0
  const cutoff = new Date(now - days * 86400000).toISOString()
  const ts = nowIso()
  let count = 0
  await db.transaction('rw', db.notes, db.sync_queue, async () => {
    const candidates = await db.notes
      .where('status').equals('completed')
      .and((n: Note) => !n.deleted_at && !n.archived_at && n.updated_at < cutoff)
      .toArray()
    for (const n of candidates) {
      await db.notes.put({
        ...n,
        archived_at: ts,
        updated_at: ts,
        version: n.version + 1,
        sync_status: 'pending',
      })
      await db.sync_queue.add({
        type: 'update',
        entity_type: 'notes',
        entity_id: n.id,
        priority: 5,
        status: 'pending',
        created_at: ts,
      })
      count++
    }
  })
  if (count > 0) emitDataUpdated('notes')
  return count
}

let timer: ReturnType<typeof setTimeout> | null = null
export const startArchiveScheduler = (): void => {
  if (timer) return
  // 立即跑一次
  runArchive().catch((e: unknown) => console.warn('archive initial run failed', e))
  // 计算到下一个 0 点的 ms
  const now = new Date()
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  const ms = next.getTime() - now.getTime()
  timer = setTimeout(function tick() {
    runArchive().catch((e: unknown) => console.warn('archive tick failed', e))
    timer = setTimeout(tick, 86400000)
  }, ms)
}

export const stopArchiveScheduler = (): void => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}