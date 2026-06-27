/**
 * ImagePickerButton —— 选图按钮(跨平台)
 *
 * - Web:点击 → 隐藏 input[type=file] 触发
 * - Capacitor native:点击 → 下拉菜单(gallery / camera)
 * - 长按 / 右键 → 剪贴板粘贴(Web only,带 hint)
 *
 * 用法:
 *   <ImagePickerButton onPick={(p) => handlePick(p)} disabled={hasImage} />
 */
import { useRef, useState } from 'react'
import { ImagePlus, Camera, FolderOpen, ClipboardPaste } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { pickImage, type PickedImage, type ImageSource } from '@/lib/imagePicker'

const isNative = (): boolean => Capacitor.isNativePlatform()

export interface ImagePickerButtonProps {
  onPick: (picked: PickedImage) => void | Promise<void>
  disabled?: boolean
}

const ImagePickerButton = ({ onPick, disabled }: ImagePickerButtonProps) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const handlePick = async (source: ImageSource) => {
    if (disabled || busy) return
    setBusy(true)
    setMenuOpen(false)
    try {
      const picked = await pickImage(source)
      if (picked) await onPick(picked)
    } catch (e) {
      console.warn('[ImagePicker] pick failed:', e instanceof Error ? e.message : e)
    } finally {
      setBusy(false)
    }
  }

  // native 端:点按钮直接弹菜单(gallery / camera)
  if (isNative()) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={disabled || busy}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-[#0077B6] disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
          title="添加图片"
        >
          <ImagePlus size={14} />
          图片
        </button>
        {menuOpen && (
          <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[140px]">
            <button
              type="button"
              onClick={() => void handlePick('gallery')}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              <FolderOpen size={14} /> 相册
            </button>
            <button
              type="button"
              onClick={() => void handlePick('camera')}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              <Camera size={14} /> 拍照
            </button>
          </div>
        )}
      </div>
    )
  }

  // Web 端:点击直接触发文件选择(相册 / 文件 picker 一回事)
  // 提供剪贴板粘贴入口(Chrome / Edge 支持)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void handlePick('file')}
        disabled={disabled || busy}
        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-[#0077B6] disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
        title="添加图片"
      >
        <ImagePlus size={14} />
        图片
      </button>
      {typeof navigator !== 'undefined' && !!navigator.clipboard?.read && (
        <button
          type="button"
          onClick={() => void handlePick('clipboard')}
          disabled={disabled || busy}
          className="ml-1 text-gray-400 hover:text-[#0077B6] disabled:text-gray-300"
          title="从剪贴板粘贴"
        >
          <ClipboardPaste size={14} />
        </button>
      )}
    </div>
  )
}

export default ImagePickerButton
