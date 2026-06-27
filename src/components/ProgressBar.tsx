/**
 * ProgressBar —— 通用细线进度条 + 可选取消按钮
 *
 * 设计:
 * - 细线默认 2px 高(单图);4px 高(全局 / lightbox)
 * - 进度用 transition 200ms 平滑过渡,避免抖动
 * - 取消按钮内嵌在右侧,hover 才显示
 * - 完全无依赖:只接 ratio 0-1,不耦合 imageDownloadQueue
 */
import type { CSSProperties } from 'react'
import { X as XIcon } from 'lucide-react'

export interface ProgressBarProps {
  /** 0-1;超出范围会被 clamp */
  ratio: number
  /** 取消回调;不传则不显示 × */
  onCancel?: () => void
  /** 容器额外 className */
  className?: string
  /** 条高,默认 2px */
  height?: number
  /** 是否显示右侧 × 取消按钮;需 onCancel 才有意义 */
  showCancel?: boolean
  /** 进度文字(可选):如 "1.2MB / 5MB";不传则不显示 */
  label?: string
}

const ProgressBar = ({
  ratio,
  onCancel,
  className = '',
  height = 2,
  showCancel = false,
  label,
}: ProgressBarProps) => {
  const pct = Math.max(0, Math.min(100, ratio * 100))
  const trackStyle: CSSProperties = { height: `${height}px` }
  const fillStyle: CSSProperties = {
    width: `${pct}%`,
    height: `${height}px`,
  }

  // 有 label 时整体高一些,容纳文字
  const containerStyle: CSSProperties = label ? { minHeight: `${height + 16}px` } : trackStyle

  return (
    <div
      className={`relative w-full bg-gray-200/60 rounded overflow-hidden ${className}`}
      style={containerStyle}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="absolute inset-y-0 left-0 bg-[#0077B6] transition-[width] duration-100 ease-out" style={fillStyle} />
      {showCancel && onCancel && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCancel()
          }}
          className="absolute top-1/2 -translate-y-1/2 right-1 flex items-center justify-center w-5 h-5 rounded-full bg-white/80 text-gray-600 hover:bg-white hover:text-red-600 transition-colors shadow-sm"
          aria-label="取消下载"
          title="取消下载"
        >
          <XIcon size={12} />
        </button>
      )}
      {label && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px] text-gray-500 pointer-events-none">
          {label}
        </div>
      )}
    </div>
  )
}

export default ProgressBar