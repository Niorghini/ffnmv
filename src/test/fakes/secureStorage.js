/**
 * capacitor-secure-storage-plugin 的内存 fake
 * - 用 Map 存键值
 * - get 返回 { value } 形态（与真插件对齐）
 * - __resetSecureStorageForTests 给每个 test 调一次，避免状态泄漏
 */
const _store = new Map()

export const SecureStoragePlugin = {
  get: async ({ key }) => ({ value: _store.get(key) ?? null }),
  set: async ({ key, value }) => { _store.set(key, value) },
  remove: async ({ key }) => { _store.delete(key) },
  keys: async () => ({ keys: [..._store.keys()] }),
  clear: async () => { _store.clear() },
}

export const __resetSecureStorageForTests = () => _store.clear()
