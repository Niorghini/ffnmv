/// <reference types="vite/client" />

/**
 * Vite 环境变量类型（与 .env.* 配合）
 * - VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 是 Supabase 客户端必需
 * - 仅以 VITE_ 开头的变量会暴露给前端代码
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * 全局 Window 类型扩展
 * - 项目原生通信全部走 @capacitor/* 官方插件
 * - 无自定义 window.android JSBridge，无需扩展 Window.android
 * - 自定义事件（data-updated / db-reset）在 src/types/db/events.ts 中已扩展 WindowEventMap
 *
 * 如果未来需要扩展 Window，新增属性声明到此 interface 即可。
 */
// （当前无扩展；保留注释以便后续补充）