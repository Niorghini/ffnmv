/**
 * 认证封装
 * - signUp / signIn / signOut (cleanup 版)
 * - getCurrentUser / getCurrentSession
 * - onAuthStateChange 订阅
 * - purgeAllLocalData / signOutAndCleanup（v3 必改：登出全量清理）
 */
import { supabase } from './supabase'
import { db } from './db'
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'
import { Capacitor } from '@capacitor/core'
import { resetDeviceId } from './device'
import { stopSync, resetSyncInstance } from './syncInstance'

const isNative = Capacitor.isNativePlatform()

export const signUp = async (email, password) => {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export const getCurrentUser = async () => {
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user
}

export const getCurrentSession = async () => {
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session
}

export const onAuthStateChange = (handler) => {
  return supabase.auth.onAuthStateChange((event, session) => {
    handler(event, session)
  })
}

/**
 * 清本地所有数据
 * 触发时机：登出、切换账号、Factory Reset
 * 注意：必须先 signOut 再清本地，否则 supabase 的 onAuthStateChange 会写回 session
 */
export const purgeAllLocalData = async () => {
  // 1. signOut（supabase 内部清自己的 session storage）
  try {
    await supabase.auth.signOut()
  } catch (e) {
    console.warn('[auth] signOut err:', e)
  }

  // 2. 清 Dexie 全部业务表
  await db.transaction(
    'rw',
    db.notes, db.tags, db.note_tags,
    db.sync_queue, db.sync_metadata, db.conflicts, db.cache,
    async () => {
      await Promise.all([
        db.notes.clear(), db.tags.clear(), db.note_tags.clear(),
        db.sync_queue.clear(), db.sync_metadata.clear(),
        db.conflicts.clear(), db.cache.clear(),
      ])
    },
  )

  // 3. 清 Keystore 所有键（native only）
  if (isNative) {
    try {
      const { keys = [] } = await SecureStoragePlugin.keys()
      await Promise.all(keys.map((k) => SecureStoragePlugin.remove({ key: k })))
    } catch (e) {
      console.warn('[auth] clear keystore err:', e)
    }
  }

  // 4. 清 localStorage 业务键
  const lsKeys = Object.keys(localStorage).filter((k) =>
    k.startsWith('ffn:') ||
    k === 'ffn-device-id' ||
    k === 'ffn_device_id' ||
    k === 'ffn-v07-legacy-cleaned' ||
    k === 'ffn-v07-legacy-checked',
  )
  lsKeys.forEach((k) => localStorage.removeItem(k))

  // 5. 重置 deviceId（web 端直接删，native 用 resetDeviceId 也重新生成）
  if (isNative) await resetDeviceId()
  else localStorage.removeItem('ffn_device_id')
}

/**
 * 完整登出：停 sync → 完整本地清理 → 清单例
 * - 必须先停 sync，避免清理期间被 sync 写回
 * - useAuthStore 的 user/session 由 supabase onAuthStateChange 自动清空
 * - UI 直接调用本函数即可，不需走 useAuthStore.signOut
 */
export const signOutAndCleanup = async () => {
  try {
    await stopSync()
  } catch (e) {
    console.warn('[auth] stopSync err:', e)
  }
  await purgeAllLocalData()
  resetSyncInstance()
}

// 向后兼容：useAuthStore.signOut 仍可用，内部走 signOutAndCleanup
export const signOut = signOutAndCleanup
