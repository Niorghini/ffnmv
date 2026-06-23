/**
 * Vitest 全局 setup
 * - 加载 fake-indexeddb（每个测试一个全新 IDB）
 * - 加载 jest-dom matchers
 * - 内存版 localStorage（happy-dom 20 的 localStorage 是空对象）
 * - mock Capacitor 相关包（避免测试环境访问原生平台）
 */
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { vi, afterEach, beforeEach } from 'vitest'

// mock capacitor-secure-storage-plugin：用 src/test/fakes/secureStorage.ts 的内存 fake
vi.mock('capacitor-secure-storage-plugin', async () => {
  const { SecureStoragePlugin, __resetSecureStorageForTests } = await import('./fakes/secureStorage')
  return { SecureStoragePlugin, __resetSecureStorageForTests }
})

// mock @capacitor/core：测试环境无原生平台，默认 web
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}))

// mock @capacitor/network：默认在线，addListener 返回可移除的 handle
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn().mockResolvedValue({ connected: true }),
    addListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
    removeListener: vi.fn(),
  },
}))

class MemoryStorage {
  private _store = new Map<string, string>()
  get length(): number {
    return this._store.size
  }
  key(i: number): string | null {
    return [...this._store.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this._store.has(k) ? this._store.get(k) ?? null : null
  }
  setItem(k: string, v: string): void {
    this._store.set(String(k), String(v))
  }
  removeItem(k: string): void {
    this._store.delete(k)
  }
  clear(): void {
    this._store.clear()
  }
}

const installMemoryStorage = (): void => {
  // 每次都强制装一个全新的 MemoryStorage，避免不同 beforeEach 看到不一致的实例
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      writable: true,
      configurable: true,
    })
  } catch {
    ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
  }
}

beforeEach(() => {
  installMemoryStorage()
})

afterEach(async () => {
  if (typeof indexedDB === 'undefined' || !indexedDB.databases) return
  try {
    const dbs = await indexedDB.databases()
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise<void>((resolve) => {
            if (!db.name) return resolve()
            const req = indexedDB.deleteDatabase(db.name)
            req.onsuccess = req.onerror = req.onblocked = () => resolve()
          }),
      ),
    )
  } catch {
    // ignore
  }
})