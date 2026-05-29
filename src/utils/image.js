/**
 * 图片压缩工具
 */

const MAX_WIDTH = 800
const MAX_HEIGHT = 800
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

/**
 * 压缩并转换为 base64
 * @param {File} file
 * @returns {Promise<string>} base64 data url
 */
export const compressImageToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        // 计算缩放比例
        let { width, height } = img
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height, 1)

        width = Math.round(width * ratio)
        height = Math.round(height * ratio)

        // 压缩到 canvas
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        // 输出 base64（质量 0.8）
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
        resolve(dataUrl)
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = e.target.result
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * 验证文件是否为图片
 */
export const isImageFile = (file) => {
  return file.type.startsWith('image/')
}

/**
 * 验证文件大小
 */
export const validateImageFile = (file) => {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `图片大小不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB` }
  }
  return { valid: true }
}