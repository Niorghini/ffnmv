/**
 * LWW 冲突解决测试
 * 覆盖 PRD 5.3 四种分支
 */
import { describe, it, expect } from 'vitest'
import { pickWinner } from '@/lib/conflict'

const mk = (over) => ({
  id: 'n1',
  content: '',
  version: 1,
  updated_at: '2026-01-01T00:00:00.000Z',
  last_sync_device: 'dev-a',
  ...over,
})

describe('pickWinner', () => {
  it('cloud.version > local.version → cloud 胜', () => {
    const local = mk({ version: 1, updated_at: '2026-01-02T00:00:00.000Z' })
    const cloud = mk({ version: 2, updated_at: '2026-01-01T00:00:00.000Z' })
    expect(pickWinner(local, cloud)).toBe(cloud)
  })

  it('cloud.version < local.version → local 胜', () => {
    const local = mk({ version: 5, updated_at: '2026-01-01T00:00:00.000Z' })
    const cloud = mk({ version: 3, updated_at: '2026-01-02T00:00:00.000Z' })
    expect(pickWinner(local, cloud)).toBe(local)
  })

  it('version 相等 + cloud 时间晚 → cloud 胜', () => {
    const local = mk({ version: 1, updated_at: '2026-01-01T00:00:00.000Z' })
    const cloud = mk({ version: 1, updated_at: '2026-01-02T00:00:00.000Z' })
    expect(pickWinner(local, cloud)).toBe(cloud)
  })

  it('version 相等 + local 时间晚 → local 胜', () => {
    const local = mk({ version: 1, updated_at: '2026-01-02T00:00:00.000Z' })
    const cloud = mk({ version: 1, updated_at: '2026-01-01T00:00:00.000Z' })
    expect(pickWinner(local, cloud)).toBe(local)
  })

  it('version+时间都相等 + cloud.device 大 → cloud 胜', () => {
    const local = mk({ version: 1, updated_at: '2026-01-01T00:00:00.000Z', last_sync_device: 'dev-a' })
    const cloud = mk({ version: 1, updated_at: '2026-01-01T00:00:00.000Z', last_sync_device: 'dev-z' })
    expect(pickWinner(local, cloud)).toBe(cloud)
  })

  it('version+时间都相等 + local.device 大 → local 胜', () => {
    const local = mk({ version: 1, updated_at: '2026-01-01T00:00:00.000Z', last_sync_device: 'dev-z' })
    const cloud = mk({ version: 1, updated_at: '2026-01-01T00:00:00.000Z', last_sync_device: 'dev-a' })
    expect(pickWinner(local, cloud)).toBe(local)
  })

  it('忽略 user_id 字段差异', () => {
    const local = mk({ version: 1, user_id: undefined })
    const cloud = mk({ version: 2, user_id: 'user-1' })
    expect(pickWinner(local, cloud)).toBe(cloud)
  })
})
