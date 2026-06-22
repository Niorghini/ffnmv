/**
 * LWW (Last-Write-Wins) 冲突解决
 * 严格按 PRD 5.3 优先级：
 *   1. version 高者胜
 *   2. 同 version 时 updated_at 晚者胜
 *   3. 同时间时 last_sync_device 字符串大者胜（兜底）
 *
 * 输入可以是本地行（无 user_id）或云端行（含 user_id）——统一剥掉 user_id 后比较。
 */

const stripUserId = <T extends object>(row: T): T => {
  if (!row) return row
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { user_id, ...rest } = row as T & { user_id?: unknown }
  return rest as T
}

const time = (row: { updated_at: string }): number =>
  new Date(row.updated_at).getTime()

const deviceKey = (row: Record<string, unknown>): string => {
  const v = row.last_sync_device ?? row.device_id ?? row.id
  return typeof v === 'string' ? v : ''
}

export interface ConflictInput {
  version: number
  updated_at: string
  last_sync_device?: string
  device_id?: string
  id?: string
}

/**
 * LWW 判定胜者
 * - local / cloud 任一为空时，返回非空的那个（保底）
 */
export const pickWinner = <T extends ConflictInput>(
  local: T,
  cloud: T,
): T => {
  if (!local) return cloud
  if (!cloud) return local
  const l = stripUserId(local)
  const c = stripUserId(cloud)
  if (c.version > l.version) return cloud
  if (c.version < l.version) return local
  const tc = time(c)
  const tl = time(l)
  if (tc > tl) return cloud
  if (tc < tl) return local
  // 同 version + 同时间：last_sync_device 字符串大者胜
  return deviceKey(c as unknown as Record<string, unknown>) >
    deviceKey(l as unknown as Record<string, unknown>)
    ? cloud
    : local
}

export const isSameRow = (
  a: { id?: string } | null | undefined,
  b: { id?: string } | null | undefined,
): boolean => Boolean(a && b && a.id === b.id)