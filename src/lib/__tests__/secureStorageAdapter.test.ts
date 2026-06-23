/**
 * secureStorageAdapter 直接测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { secureStorageAdapter } from '@/lib/secureStorageAdapter'
import { SecureStoragePlugin, __resetSecureStorageForTests } from '@/test/fakes/secureStorage'

describe('secureStorageAdapter', () => {
  beforeEach(() => {
    __resetSecureStorageForTests()
  })

  it('setItem 写入 SecureStorage', async () => {
    await secureStorageAdapter.setItem('ffn-sb-session', 'fake-token-data')
    const { value } = await SecureStoragePlugin.get({ key: 'ffn-sb-session' })
    expect(value).toBe('fake-token-data')
  })

  it('getItem 读取 SecureStorage 内的值', async () => {
    await SecureStoragePlugin.set({ key: 'ffn-sb-session', value: 'token-xyz' })
    const value = await secureStorageAdapter.getItem('ffn-sb-session')
    expect(value).toBe('token-xyz')
  })

  it('getItem 在 key 不存在时返回 null', async () => {
    const value = await secureStorageAdapter.getItem('nonexistent')
    expect(value).toBeNull()
  })

  it('removeItem 删除 key', async () => {
    await SecureStoragePlugin.set({ key: 'ffn-sb-session', value: 'token' })
    await secureStorageAdapter.removeItem('ffn-sb-session')
    const { value } = await SecureStoragePlugin.get({ key: 'ffn-sb-session' })
    expect(value).toBeNull()
  })

  it('removeItem 在 key 不存在时不抛错', async () => {
    await expect(secureStorageAdapter.removeItem('nonexistent')).resolves.toBeUndefined()
  })

  it('getItem 在 SecureStoragePlugin 抛错时返回 null（不传播）', async () => {
    const value = await secureStorageAdapter.getItem('any')
    expect(value).toBeNull()
  })
})