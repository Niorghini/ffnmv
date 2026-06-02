/**
 * LWW (Last-Write-Wins) 冲突解决
 * 严格按 PRD 5.3 优先级：
 *   1. version 高者胜
 *   2. 同 version 时 updated_at 晚者胜
 *   3. 同时间时 last_sync_device 字符串大者胜（兜底）
 *
 * 输入可以是本地行（无 user_id）或云端行（含 user_id）——统一剥掉 user_id 后比较。
 */

const stripUserId = (row) => {
  if (!row) return row
  const { user_id, ...rest } = row
  return rest
}

const time = (row) => new Date(row.updated_at).getTime()

const deviceKey = (row) => row.last_sync_device || row.device_id || row.id || ''

export const pickWinner = (local, cloud) => {
  const l = stripUserId(local)
  const c = stripUserId(cloud)
  if (c.version > l.version) return cloud
  if (c.version < l.version) return local
  const tc = time(c)
  const tl = time(l)
  if (tc > tl) return cloud
  if (tc < tl) return local
  // 同 version + 同时间：last_sync_device 字符串大者胜
  return deviceKey(c) > deviceKey(l) ? cloud : local
}

export const isSameRow = (a, b) => a && b && a.id === b.id
