/**
 * useVirtualizer 测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, renderHook, act } from '@testing-library/react'
import { useVirtualizer } from '@/hooks/useVirtualizer'

describe('useVirtualizer', () => {
  beforeEach(() => {
    // 模拟容器高度
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 400,
    })
  })

  it('返回 totalHeight = count * rowHeight', () => {
    const { result } = renderHook(() =>
      useVirtualizer({ count: 100, rowHeight: 56 }),
    )
    expect(result.current.totalHeight).toBe(5600)
  })

  it('未滚动时 visible = 前 viewport/rowHeight + overscan 个', () => {
    const { result } = renderHook(() =>
      useVirtualizer({ count: 100, rowHeight: 56, overscan: 2 }),
    )
    expect(result.current.visible.length).toBeGreaterThan(0)
    expect(result.current.visible[0]).toBe(0)
  })

  it('offsetY 随 scrollTop 推进', () => {
    let api: ReturnType<typeof useVirtualizer> | undefined
    function Wrapper() {
      api = useVirtualizer({ count: 100, rowHeight: 56, overscan: 5 })
      return (
        <div data-testid="scroll-container" ref={api.containerRef} style={{ height: 400 }}>
          <div style={{ height: api.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${api.offsetY}px)` }} />
          </div>
        </div>
      )
    }
    render(<Wrapper />)
    expect(api?.offsetY).toBe(0)
    act(() => {
      const el = screen.getByTestId('scroll-container')
      el.scrollTop = 560
      el.dispatchEvent(new Event('scroll'))
    })
    expect(api?.offsetY).toBeGreaterThan(0)
  })
})