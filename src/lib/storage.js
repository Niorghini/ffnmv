/**
 * Web 端 supabase-js storage adapter
 * - 包一层 localStorage，匹配 supabase-js 的 storage 接口
 * - 异常静默（quota 满 / storage 被禁 / 隐私模式）
 */
export const storage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // quota 满或 storage 被禁，supabase auth token 写入失败
      // 让上层感知不到；下一次启动用户需重新登录
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  },
}
