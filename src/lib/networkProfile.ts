/**
 * networkProfile —— 网络质量探测
 *
 * 用途:
 * - imageDownloadQueue 用来决定 fetch 超时(慢网放宽到 60s)
 * - 后续 upload 端也可参考(慢网选更小的原图上传)
 *
 * 实现:
 * - 优先读 navigator.connection.effectiveType(Chromium / 部分 Safari)
 * - 不可用时返回 '4g' 保守默认值
 * - SSR-safe:typeof navigator 守护
 *
 * 关键:不需要非常精确,只要能区分 "现在明显是慢网" 和 "正常" 两种状态
 */

export type EffectiveType = '4g' | '3g' | '2g' | 'slow-2g'

/** 读取当前 effectiveType;不可用时返回 '4g' 保守默认 */
export function getEffectiveType(): EffectiveType {
  if (typeof navigator === 'undefined') return '4g'
  // NavigatorConnection 是非标准 API,Chromium / Edge / 部分 Safari 支持
  const conn = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean }
  }).connection
  if (!conn) return '4g'
  const et = (conn.effectiveType ?? '').toLowerCase()
  if (et === 'slow-2g' || et === '2g' || et === '3g' || et === '4g') {
    return et
  }
  return '4g'
}

/** 是否处于慢网(2g / slow-2g);配合 Save-Data 标记 */
export function isSlowNetwork(): boolean {
  if (typeof navigator === 'undefined') return false
  const conn = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean }
  }).connection
  if (!conn) return false
  if (conn.saveData) return true
  const et = (conn.effectiveType ?? '').toLowerCase()
  return et === '2g' || et === 'slow-2g'
}

/** 监听网络质量变化(可选,供 queue 在网络变好后立刻 retry) */
export function watchNetworkChange(handler: (slow: boolean) => void): () => void {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return () => undefined
  }
  const conn = (navigator as Navigator & {
    connection?: {
      effectiveType?: string
      saveData?: boolean
      addEventListener?: (type: 'change', cb: () => void) => void
      removeEventListener?: (type: 'change', cb: () => void) => void
    }
  }).connection
  if (!conn?.addEventListener) {
    return () => undefined
  }
  const listener = () => handler(isSlowNetwork())
  conn.addEventListener('change', listener)
  return () => conn.removeEventListener?.('change', listener)
}
