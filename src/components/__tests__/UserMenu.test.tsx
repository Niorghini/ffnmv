/**
 * UserMenu 组件测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import type { User } from '@supabase/supabase-js'

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('@/stores/useSyncStore', () => ({
  useSyncStore: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  signOutAndCleanup: vi.fn(),
}))

import { useAuthStore } from '@/stores/useAuthStore'
import { useSyncStore } from '@/stores/useSyncStore'
import { signOutAndCleanup } from '@/lib/auth'
import UserMenu from '@/components/UserMenu'

const mockUser = { email: 'niorghini.test@gmail.com' } as unknown as User

const setupStores = ({ user = mockUser, sync = {} }: { user?: User | null; sync?: Record<string, unknown> } = {}): void => {
  ;(useAuthStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ user }))
  ;(useSyncStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    status: 'idle',
    pending: 0,
    online: true,
    lastSyncAt: null,
    ...sync,
  }))
}

const renderWithRouter = (ui: ReactElement): ReturnType<typeof render> =>
  render(<MemoryRouter>{ui}</MemoryRouter>)

describe('UserMenu', () => {
  beforeEach(() => {
    ;(signOutAndCleanup as ReturnType<typeof vi.fn>).mockClear()
  })

  it('未登录时返回 null', () => {
    setupStores({ user: null })
    const { container } = renderWithRouter(<UserMenu onSync={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('完整显示邮箱', () => {
    setupStores()
    renderWithRouter(<UserMenu onSync={() => {}} />)
    expect(screen.getByText('niorghini.test@gmail.com')).toBeInTheDocument()
  })

  it('渲染同步三件套：状态点 + 状态文字 + 同步按钮', () => {
    setupStores({ sync: { status: 'idle', pending: 0, online: true, lastSyncAt: new Date('2026-06-03T10:30:00') } })
    renderWithRouter(<UserMenu onSync={() => {}} />)
    expect(screen.getByText('已同步')).toBeInTheDocument()
    expect(screen.getByLabelText('立即同步')).toBeInTheDocument()
    expect(screen.getByText(/10:30/)).toBeInTheDocument()
  })

  it('离线时显示「离线」', () => {
    setupStores({ sync: { online: false } })
    renderWithRouter(<UserMenu onSync={() => {}} />)
    expect(screen.getByText('离线')).toBeInTheDocument()
  })

  it('同步失败时显示「同步失败」', () => {
    setupStores({ sync: { status: 'error' } })
    renderWithRouter(<UserMenu onSync={() => {}} />)
    expect(screen.getByText('同步失败')).toBeInTheDocument()
  })

  it('有 pending 时显示「N 条待同步」', () => {
    setupStores({ sync: { pending: 3 } })
    renderWithRouter(<UserMenu onSync={() => {}} />)
    expect(screen.getByText('3 条待同步')).toBeInTheDocument()
  })

  it('点击邮箱按钮展开下拉，点击外部收起', async () => {
    setupStores()
    renderWithRouter(
      <div>
        <div data-testid="outside">outside</div>
        <UserMenu onSync={() => {}} />
      </div>,
    )
    const emailBtn = screen.getByRole('button', { name: /niorghini.test@gmail.com/ })
    expect(screen.queryByText('登出')).not.toBeInTheDocument()
    fireEvent.click(emailBtn)
    expect(await screen.findByText('登出')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByTestId('outside'))
    await waitFor(() => {
      expect(screen.queryByText('登出')).not.toBeInTheDocument()
    })
  })

  it('点击登出调用 signOutAndCleanup', async () => {
    setupStores()
    renderWithRouter(<UserMenu onSync={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /niorghini.test@gmail.com/ }))
    const signOutBtn = await screen.findByText('登出')
    fireEvent.click(signOutBtn)
    expect(signOutAndCleanup).toHaveBeenCalledTimes(1)
  })

  it('点击同步按钮调用 onSync', () => {
    const onSync = vi.fn()
    setupStores()
    renderWithRouter(<UserMenu onSync={onSync} />)
    fireEvent.click(screen.getByLabelText('立即同步'))
    expect(onSync).toHaveBeenCalledTimes(1)
  })
})