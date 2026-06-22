/**
 * Supabase client 单例
 * - URL + anon key 从 .env.local 读
 * - 单例导出
 * - 原生平台：token 落 Keystore（secureStorageAdapter）
 * - Web 端：token 落 localStorage（storage）
 * - 全局 fetch 10s 超时（AbortSignal.timeout），避免弱网挂死
 * - 原生平台：Network 监听网络变化，自动 connect/disconnect Realtime
 */
import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { storage } from './storage'
import { secureStorageAdapter } from './secureStorageAdapter'
import type { Database } from '@/types/api/database'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // 不抛错，方便 UI 阶段先看到登录页
  console.warn('Supabase env not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local')
}

const isNative = Capacitor.isNativePlatform()

export const supabase = createClient<Database>(url || 'http://localhost', anonKey || 'placeholder', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: isNative ? secureStorageAdapter : storage,
    storageKey: 'ffn-sb-session',
  },
  global: {
    fetch: (input, init = {}) =>
      fetch(input, { ...init, signal: init.signal || AbortSignal.timeout(10000) }),
  },
})

export const isSupabaseConfigured = (): boolean => Boolean(url && anonKey)

if (isNative) {
  // 切网（WiFi↔4G）后自动重连 Realtime
  Network.addListener('networkStatusChange', (status) => {
    if (status.connected) supabase.realtime.connect()
    else supabase.realtime.disconnect()
  })
}