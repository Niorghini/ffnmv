/**
 * Toast —— 一次性 v0.7.0 数据清理提示
 * 用法：
 *   <Toast message="..." onClose={() => setShow(false)} />
 *   或 <Toast message="..." duration={3000} /> 自动消失
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'

export interface ToastProps {
  message: string
  duration?: number
  onClose?: () => void
}

export default function Toast({ message, duration = 0, onClose }: ToastProps) {
  useEffect(() => {
    if (!duration || !onClose) return
    const t = setTimeout(onClose, duration)
    return () => clearTimeout(t)
  }, [duration, onClose])

  return (
    <div className="fixed top-4 right-4 z-50 bg-warning-bg border border-warning text-warning px-4 py-3 rounded-lg shadow-md flex items-start gap-3 max-w-md">
      <span className="text-sm flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="text-warning hover:opacity-70" aria-label="关闭">
          <X size={16} />
        </button>
      )}
    </div>
  )
}