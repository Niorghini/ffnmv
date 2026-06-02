/**
 * 登录/注册页（v0.7.0 风格）
 * - 居中卡片
 * - 蓝色主色
 */
import { useState } from 'react'
import { useAuthStore } from '@/stores/useAuthStore'
import { isSupabaseConfigured } from '@/lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { signIn, signUp, loading, error, clearError } = useAuthStore()
  const configured = isSupabaseConfigured()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) return
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
      }
    } catch {
      // error stored in store
    }
  }

  const switchMode = () => {
    clearError()
    setMode(mode === 'signin' ? 'signup' : 'signin')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-main p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-[#0077B6] mb-1">发法牛</h1>
          <p className="text-sm text-gray-500">v1.2 · 轻量化多端同步笔记</p>
        </div>

        {!configured && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg">
            未检测到 Supabase 配置。请在 <code>.env.local</code> 中设置
            <code className="mx-1">VITE_SUPABASE_URL</code> 和
            <code className="mx-1">VITE_SUPABASE_ANON_KEY</code>，然后重启 dev server。
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">密码（至少 6 位）</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20"
              placeholder="••••••"
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !configured}
            className="w-full py-2 bg-[#0077B6] text-white rounded-lg text-sm font-medium hover:bg-[#005f8c] disabled:opacity-50 transition-colors"
          >
            {loading ? '处理中...' : mode === 'signin' ? '登录' : '注册'}
          </button>

          <div className="text-center text-xs text-gray-500">
            {mode === 'signin' ? '还没有账号？' : '已有账号？'}
            <button
              type="button"
              onClick={switchMode}
              className="ml-1 text-[#0077B6] hover:underline"
            >
              {mode === 'signin' ? '注册' : '登录'}
            </button>
          </div>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          本地优先 + 离线可用 + 多端同步
        </p>
      </div>
    </div>
  )
}
