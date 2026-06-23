/**
 * capacitor-secure-storage-plugin 的内存 fake
 * - 用 Map 存键值
 * - get 返回 { value } 形态（与真插件对齐）
 * - __resetSecureStorageForTests 给每个 test 调一次，避免状态泄漏
 */
const _store = new Map<string, string>()

export interface SecureStorageGetResult {
  value: string | null
}

export const SecureStoragePlugin = {
  get: async ({ key }: { key: string }): Promise<SecureStorageGetResult> => ({
    value: _store.get(key) ?? null,
  }),
  set: async ({ key, value }: { key: string; value: string }): Promise<void> => {
    _store.set(key, value)
  },
  remove: async ({ key }: { key: string }): Promise<void> => {
    _store.delete(key)
  },
  keys: async (): Promise<{ keys: string[] }> => ({ keys: [..._store.keys()] }),
  clear: async (): Promise<void> => {
    _store.clear()
  },
}

export const __resetSecureStorageForTests = (): void => _store.clear()