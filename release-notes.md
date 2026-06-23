## v1.3.1 — JS/TS 全量迁移 + 安卓适配 + 标签修复

### 🎉 重大变更
- **JS → TS 全量迁移（Phase 0~8）**：lib / repos / stores / hooks / components / pages / test 全部迁完，开启 strict 模式 + type-checked ESLint
- **安卓适配**：Capacitor + HashRouter + safe-area + 44px 触屏命中区（vite base + capacitor init 完整接入）
- **标签样式统一**：UI 标签 chip 统一为 `py-0.5 rounded-full` 蓝胶囊

### 🐛 Bug 修复
- **标签过大修复**（`01bd74f`）：移除 `index.css` 全局 `min-height: 44px` 规则。安卓适配 commit 23c6906 加的 `@layer base { button, a, ... } min-height: 44px` 影响了所有 `<button>`，导致 Sidebar TagRow / NoteList 可点击标签都被强制 44px 高。删掉后 web + APK 都恢复紧凑胶囊（~20px）

### 🚀 性能 / 体验
- TypeScript 严格模式 + 类型检查 ESLint，主 bundle 拆分 chunk，首屏加载更快
- syncManager 增量 data-updated 事件（EFF-002），Dexie 加 archived_at 索引（EFF-001），路由 lazy load（EFF-003）

### 🔐 安全
- prod nginx 加 6 个安全头（X-Frame-Options / CSP / HSTS / X-Content-Type-Options / Referrer-Policy / Permissions-Policy）
- 登录限速双层（nginx limit_req 10r/m + Supabase GOTRUE_RATE_LIMIT_*）
- 密码最小长度后端对齐 8 位（SEC-003）

### 📦 产物
- `app-release.apk`（2.4 MB）— 适配 Android 7.0+，接 ffn.aicyber.chat 后端