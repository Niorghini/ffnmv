/**
 * Native 端 supabase-js storage adapter
 * - 把 capacitor-secure-storage-plugin 包成 supabase-js storage 接口
 * - Android 端落到 Keystore（系统级加密，root 设备可绕但不泄到文件系统）
 * - get 失败返回 null（与 supabase-js 期望一致）
 */
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'

export const secureStorageAdapter = {
  getItem: async (key) => {
    try {
      const { value } = await SecureStoragePlugin.get({ key })
      return value ?? null
    } catch {
      return null
    }
  },
  setItem: async (key, value) => {
    await SecureStoragePlugin.set({ key, value })
  },
  removeItem: async (key) => {
    try {
      await SecureStoragePlugin.remove({ key })
    } catch {
      // key 不存在时 remove 抛错，吞掉
    }
  },
}
