/**
 * useIntersectionVisible —— 视口可见性 hook
 *
 * 用途:
 * - 列表场景:NoteImage 元素进入视口才把 imageDownloadQueue 的 priority 提到 'visible'
 * - 离开视口 N ms 后降级到 'prefetch',避免快速滚过时拉一票
 *
 * 设计:
 * - rootMargin: '100px' 提前 100px 触发可见,让图片在用户真看到时已经就位
 * - threshold: 0 表示任何像素进入就算可见
 * - 支持 SSR / 不支持 IntersectionObserver 的环境,默认返回 visible=false
 */
import { useEffect, useRef, useState } from 'react'

export interface UseIntersectionVisibleOptions {
  /** rootMargin 字符串,传给 IntersectionObserver;默认 '100px' */
  rootMargin?: string
  /** 一进入视口就算 visible;不要求占比 */
  threshold?: number | number[]
  /** 不可用 IntersectionObserver 时是否默认算可见(测试用) */
  fallbackVisible?: boolean
}

export interface UseIntersectionVisibleResult<T extends Element = HTMLDivElement> {
  ref: (el: T | null) => void
  visible: boolean
  /** 元素是否曾进入过视口;卸载时仍保留 true(防止图片反复卸载/挂载) */
  hasBeenVisible: boolean
}

export function useIntersectionVisible<T extends Element = HTMLDivElement>(
  options: UseIntersectionVisibleOptions = {},
): UseIntersectionVisibleResult<T> {
  const { rootMargin = '100px', threshold = 0, fallbackVisible = false } = options
  const [visible, setVisible] = useState<boolean>(fallbackVisible)
  const [hasBeenVisible, setHasBeenVisible] = useState<boolean>(fallbackVisible)
  const elRef = useRef<T | null>(null)
  const setRef = (el: T | null) => {
    elRef.current = el
  }

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const el = elRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true)
            setHasBeenVisible(true)
          } else {
            setVisible(false)
          }
        }
      },
      { rootMargin, threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin, threshold])

  return { ref: setRef, visible, hasBeenVisible }
}
