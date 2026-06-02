/**
 * Vitest 全局 setup
 * - 加载 fake-indexeddb（每个测试一个全新 IDB）
 * - 加载 jest-dom matchers
 * - 内存版 localStorage（happy-dom 20 的 localStorage 是空对象）
 */
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'

class MemoryStorage {
  constructor() {
    this._store = new Map()
  }
  get length() {
    return this._store.size
  }
  key(i) {
    return [...this._store.keys()][i] ?? null
  }
  getItem(k) {
    return this._store.has(k) ? this._store.get(k) : null
  }
  setItem(k, v) {
    this._store.set(String(k), String(v))
  }
  removeItem(k) {
    this._store.delete(k)
  }
  clear() {
    this._store.clear()
  }
}

const installMemoryStorage = () => {
  // 每次都强制装一个全新的 MemoryStorage，避免不同 beforeEach 看到不一致的实例
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      writable: true,
      configurable: true,
    })
  } catch {
    globalThis.localStorage = new MemoryStorage()
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
          new Promise((resolve) => {
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
