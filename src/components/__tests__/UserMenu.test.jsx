/**
 * UserMenu 组件测试
 * - 渲染：完整邮箱 + 同步三件套
 * - 交互：点击邮箱展开下拉（登出），点击外部收起
 * - 登出：点击登出触发 signOut
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('@/stores/useSyncStore', () => ({
  useSyncStore: vi.fn(),
}))

import { useAuthStore } from '@/stores/useAuthStore'
import { useSyncStore } from '@/stores/useSyncStore'
import UserMenu from '@/components/UserMenu'

const mockUser = { email: 'niorghini.test@gmail.com' }
const mockSignOut = vi.fn()

const setupStores = ({ user = mockUser, signOut = mockSignOut, sync = {} } = {}) => {
  useAuthStore.mockImplementation(() => ({ user, signOut }))
  useSyncStore.mockImplementation(() => ({
    status: 'idle',
    pending: 0,
    online: true,
    lastSyncAt: null,
    ...sync,
  }))
}

const renderWithRouter = (ui, options) =>
  render(<MemoryRouter>{ui}</MemoryRouter>, options)

describe('UserMenu', () => {
  beforeEach(() => {
    mockSignOut.mockClear()
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
    // 同步时间存在（lastSyncAt + online + 非 syncing）
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
    // 初始无 登出
    expect(screen.queryByText('登出')).not.toBeInTheDocument()
    // 点击邮箱
    fireEvent.click(emailBtn)
    expect(await screen.findByText('登出')).toBeInTheDocument()
    // 点击外部
    fireEvent.mouseDown(screen.getByTestId('outside'))
    await waitFor(() => {
      expect(screen.queryByText('登出')).not.toBeInTheDocument()
    })
  })

  it('点击登出调用 signOut', async () => {
    setupStores()
    renderWithRouter(<UserMenu onSync={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /niorghini.test@gmail.com/ }))
    const signOutBtn = await screen.findByText('登出')
    fireEvent.click(signOutBtn)
    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })

  it('点击同步按钮调用 onSync', () => {
    const onSync = vi.fn()
    setupStores()
    renderWithRouter(<UserMenu onSync={onSync} />)
    fireEvent.click(screen.getByLabelText('立即同步'))
    expect(onSync).toHaveBeenCalledTimes(1)
  })
})
