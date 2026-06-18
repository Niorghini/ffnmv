/**
 * Login 组件测试
 * - 错误内联显示
 * - signin/signup 模式切换
 * - 加载态禁用按钮
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAuthStore } from '@/stores/useAuthStore'

// 必须在 useAuthStore 引入前 stub supabase，避免连接真实后端
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
  },
  isSupabaseConfigured: () => true,
}))

import Login from '@/pages/Login'

describe('Login', () => {
  beforeEach(() => {
    useAuthStore.setState({ error: null, loading: false, user: null })
  })

  it('默认显示登录模式', () => {
    render(<Login />)
    expect(screen.getByText('登录')).toBeInTheDocument()
  })

  it('点击切换到注册', async () => {
    render(<Login />)
    const switchBtn = screen.getByText('注册')
    await userEvent.setup().click(switchBtn)
    expect(screen.getByText('注册')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument()
  })

  it('signIn 失败时显示错误', async () => {
    const { signIn } = useAuthStore.getState()
    useAuthStore.setState({ error: 'Invalid login credentials' })
    render(<Login />)
    expect(screen.getByText('Invalid login credentials')).toBeInTheDocument()
  })

  it('email + password 必填', () => {
    render(<Login />)
    const email = screen.getByPlaceholderText('you@example.com')
    const password = screen.getByPlaceholderText('••••••••')
    expect(email).toBeRequired()
    expect(password).toBeRequired()
  })
})
