/**
 * 认证 store
 * - user / session
 * - 监听 supabase.auth.onAuthStateChange 自动刷新
 */
import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import {
  signIn as svcSignIn,
  signUp as svcSignUp,
  signOut as svcSignOut,
  getCurrentSession,
  onAuthStateChange,
} from '@/lib/auth'

interface AuthState {
  user: User | null
  session: Session | null
  initialized: boolean
  error: string | null
  loading: boolean
}

interface AuthActions {
  init: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

type AuthStore = AuthState & AuthActions

export const useAuthStore = create<AuthStore>()((set, get) => ({
  user: null,
  session: null,
  initialized: false,
  error: null,
  loading: false,

  init: async () => {
    if (get().initialized) return
    const session = await getCurrentSession()
    set({ user: session?.user ?? null, session, initialized: true })
    onAuthStateChange((_event: string, session: Session | null) => {
      set({ user: session?.user ?? null, session })
    })
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true, error: null })
    try {
      const { session } = await svcSignIn(email, password)
      set({ session, user: session?.user ?? null, loading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ error: msg, loading: false })
      throw e
    }
  },

  signUp: async (email: string, password: string) => {
    set({ loading: true, error: null })
    try {
      const { session } = await svcSignUp(email, password)
      set({ session, user: session?.user ?? null, loading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ error: msg, loading: false })
      throw e
    }
  },

  signOut: async () => {
    await svcSignOut()
    set({ user: null, session: null })
  },

  clearError: () => set({ error: null }),
}))