import { v4 as uuidv4 } from 'uuid'

const KEY = 'ffn_device_id'

export const getDeviceId = (): string => {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = uuidv4()
    localStorage.setItem(KEY, id)
  }
  return id
}

export const resetDeviceId = (): string => {
  localStorage.removeItem(KEY)
  return getDeviceId()
}