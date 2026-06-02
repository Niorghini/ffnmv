/**
 * 设备 ID：每个浏览器一个，持久化在 localStorage
 * - 登出/换账号不重新生成（PRD 5.1：设备 ID 跨会话稳定）
 * - 用于 LWW 冲突判定的最后一道兜底（PRD 5.3）
 */
import { v4 as uuidv4 } from 'uuid'

const KEY = 'ffn_device_id'

export const getDeviceId = () => {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = uuidv4()
    localStorage.setItem(KEY, id)
  }
  return id
}

export const resetDeviceId = () => {
  localStorage.removeItem(KEY)
  return getDeviceId()
}
