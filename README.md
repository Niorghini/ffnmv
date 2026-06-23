# 发法牛 - 发布的想法都很牛！

> 简洁高效的本地优先笔记应用 | Web + Android 多端同步

| | |
|---|---|
| 🌐 **生产** | https://ffn.aicyber.chat |
| 🧪 **测试** | https://ffn-test.aicyber.chat |
| 📦 **Releases** | https://github.com/Niorghini/ffnmv/releases |
| 📱 **Android APK** | [v1.0 (2.4 MB)](https://github.com/Niorghini/ffnmv/releases/download/v1.3.1/app-release.apk) |

**v1.3.1** — 当前最新。v1.2 起支持多端实时同步。

---

## ✨ 核心功能

### 📝 笔记
- 快速记录想法，纯文本输入（v1.2 移除富文本/图片）
- 停止输入 300ms 自动保存
- `Ctrl+Enter` 快捷创建
- 软删除（30 天可恢复）+ 自动归档（已处理 7/30 天/永不）
- 🆕 v1.3.1 笔记时间显示到时分（今天 `H:MM` / 今年 `M月D日` / 跨年 `YYYY/M/D`）

### 🏷️ 标签
- `#标签名` 自动识别
- 标签独立实体（UUID + 颜色 + 笔记数）
- 点击筛选 + AND/OR 组合
- 标签管理：合并、颜色、计数

### ☁️ 多端同步
- Supabase 自建 6 容器最小栈 + IndexedDB 离线优先
- 邮箱 + 密码认证（生产环境已关闭邮箱确认）
- Realtime 跨设备实时更新 + 30s 自适应轮询（60→300s）
- 联网/切前台自动同步 + 指数退避（1→32s）+ 离线队列
- LWW 冲突解决（version → updated_at → device_id）+ 手动冲突 UI
- 跨设备硬删除传播
- 🆕 v1.3.1 同步按钮 hover 浮层显示最近 10 次成功同步时间

### 🔍 检索与数据
- 全文搜索（content 字段）
- 标签筛选 + 状态筛选
- 笔记列表虚拟滚动（手写 `useVirtualizer`，1w 条 ~50ms 渲染）
- JSON 导入/导出
- 🆕 工厂重置：彻底清空本地 + 云端

### 📱 移动端
- **Android v1.0**：Capacitor 8 包装 Web，接 ffn.aicyber.chat 后端
- 微信小程序：计划中（Taro 4 方案）

---

## 🆕 v1.3.1 更新亮点

### JavaScript → TypeScript 全量迁移（Phase 0~8）
- `lib` / `repositories` / `stores` / `hooks` / `components` / `pages` / `test` 全部迁完
- 开启 strict 模式 + type-checked ESLint
- 主 bundle 拆分，首屏 gzip ~180KB

### Android v1.0 发布
- Capacitor 8 + HashRouter + safe-area + 44px 触屏命中区
- 适配 launcher icon（vivo OriginOS `#F2F2F2` 底 + cow 40% 居中）
- APK 2.4 MB，minSdk 24 / targetSdk 36

### 🐛 Bug 修复
- **标签过大修复**：移除 `index.css` 全局 `min-height: 44px` 规则。安卓适配 commit 加的 `@layer base { button, a, ... } min-height: 44px` 影响了所有 `<button>`，导致 Sidebar TagRow / NoteList 可点击标签都被强制 44px 高。删掉后 web + APK 都恢复紧凑胶囊（~20px）

### 🚀 性能 / 安全
- syncManager 增量 `data-updated` 事件 + Dexie 加 `archived_at` 索引（EFF-001/002）
- 路由 lazy load（EFF-003）
- nginx 6 个安全头 + HSTS
- 登录限速双层（nginx limit_req 10r/m + Supabase GOTRUE_RATE_LIMIT_*）
- 密码最小长度后端对齐 8 位（SEC-003）

完整 changelog：[GitHub Releases](https://github.com/Niorghini/ffnmv/releases/tag/v1.3.1)

---

## 🚀 快速开始

### 前置
- Node.js 20+
- Docker Desktop（本地 Supabase 依赖）
- Supabase CLI（项目自带）

### 1. 启动本地 Supabase

```bash
supabase start    # 首次拉镜像 ~3min，之后秒启
supabase status   # 查 API URL + anon key
```

把 `status` 输出写入 `.env.local`：

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

### 2. 安装依赖 + 启动 dev

```bash
npm install
npm run dev
# 打开 http://localhost:5173
```

### 3. 注册并使用

第一次打开是登录页，切到「注册」用任意 email + 6+ 字符密码（本地 Supabase 默认关闭 email confirmation，不需要真实邮箱）。

### 4. 测试同步

打开两个浏览器窗口（一个普通 + 一个无痕），都登录同一账号。一个窗口建/改笔记，另一个应 1 秒内看到（Realtime）。

---

## 🌍 多环境

| 环境 | URL | 服务器 | 用途 |
|---|---|---|---|
| **生产** | https://ffn.aicyber.chat | 118.89.118.126（Tencent Lighthouse） | `main` 分支 |
| **测试** | https://ffn-test.aicyber.chat | 163.7.3.215 | `dev-*` 分支 + ad-hoc test |

> ⚠️ 2026-06-23 起 `ffn-pre` 已下线，所有 dev-* 分支和 test 构建统一部署到 `ffn-test`（`/opt/ffn/dist/` 单一槽位），部署前确认不会互相覆盖。

### 构建命令

| 命令 | 用途 | 输出 |
|---|---|---|
| `npm run build:test` | 测试环境构建（连 ffn-test 后端） | `dist/` |
| `npm run build:prod` | 生产构建（连 ffn.aicyber.chat 后端） | `dist/` |
| `npm run build:canary` | 同 test（历史预发布，保留兼容） | `dist/` |
| `npm run build:android` | web + cap sync（Android 前置） | `dist/` + `android/` |
| `npm run android:apk:release` | 出 release APK | `android/app/build/outputs/apk/release/app-release.apk` |

### 部署

```bash
# 测试服务器
rsync -av --delete dist/ root@163.7.3.215:/opt/ffn/dist/
ssh root@163.7.3.215 "nginx -t && nginx -s reload"

# 生产服务器（需要显式确认）
rsync -av --delete dist/ root@118.89.118.126:/var/www/ffnmv/dist/
ssh root@118.89.118.126 "nginx -t && nginx -s reload"
```

---

## 📱 Android 构建

首次出包 ~30min，后续 ~2min。

```bash
# 前置：JDK 21 + Android SDK（详见 docs/android-build-guide.md）
# 首次生成 keystore 并备份到 1Password（详见 docs/android-maintain.md）

npm run build:android          # web 构建 + cap sync
npm run android:apk:release    # 出 release APK（~2.4MB）

# 装机
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

详细：
- [`docs/android-build-guide.md`](./docs/android-build-guide.md) — 首次出包完整指南（JDK/SDK/keystore/踩坑）
- [`docs/android-maintain.md`](./docs/android-maintain.md) — 日常运维 SOP（签名备份/回滚/版本号）

---

## 🛠 技术栈

- **前端**：React 18 + Vite 5 + Tailwind CSS 3 + **TypeScript**（strict）
- **路由**：react-router-dom v6（懒加载 `MainApp / Trash / Settings`）
- **状态**：Zustand（6 个 store）
- **本地 DB**：Dexie.js 4.x（IndexedDB 封装，7-store schema）
- **云端**：Supabase（Postgres + RLS + Realtime；生产自建 6 容器最小栈）
- **测试**：Vitest + @testing-library/react + fake-indexeddb + happy-dom
- **Android**：Capacitor 8 + WebView + Gradle 8
- **图标**：Lucide React
- **部署**：Tencent Lighthouse + Docker + nginx 1.24

---

## 🏗 项目结构

```
ffnmv/
├── docs/                          # 迁移计划 / 评审 / SOP
│   ├── android-build-guide.md
│   ├── android-maintain.md
│   ├── plan-android.md            # Android v3 (Capacitor 8)
│   ├── plan-wechat-miniprogram.md # 微信小程序 v2 (Taro 4)
│   └── TODO.md
├── ops/                           # 运维脚本（部署到生产服务器）
│   ├── deploy-nginx.sh
│   ├── deploy-rate-limit.sh
│   ├── deploy-disable-email.sh
│   ├── deploy-password.sh
│   ├── nginx.conf                 # 生产 nginx（HTTPS + HSTS + 6 个安全头）
│   └── snippets/
├── supabase/                      # 自托管 Supabase 配置 + migrations
├── android/                       # Capacitor Android 项目
├── src/
│   ├── App.tsx                    # 路由根
│   ├── main.tsx                   # 入口（Capacitor 平台条件路由）
│   ├── index.css
│   ├── components/                # UI 组件（9 个）
│   │   ├── Editor.tsx
│   │   ├── NoteList.tsx           # 虚拟滚动
│   │   ├── Sidebar.tsx
│   │   ├── SearchBar.tsx
│   │   ├── UserMenu.tsx           # 同步状态 + hover 浮层 + 登出入口
│   │   ├── Toast.tsx
│   │   ├── ConflictDialog.tsx
│   │   ├── OfflineBoundary.tsx
│   │   └── __tests__/             # Editor / UserMenu
│   ├── pages/                     # 路由页面（4 个）
│   │   ├── MainApp.tsx            # 三栏主界面
│   │   ├── Login.tsx
│   │   ├── Settings.tsx           # 导出/导入/工厂重置/改密
│   │   └── Trash.tsx
│   ├── stores/                    # Zustand stores（6 个）
│   │   ├── useAuthStore.ts
│   │   ├── useNotesStore.ts
│   │   ├── useTagsStore.ts
│   │   ├── useTrashStore.ts
│   │   ├── useSyncStore.ts        # 含 lastSyncTimes（v1.3.1 新增）
│   │   └── useConflictsStore.ts
│   ├── repositories/              # 仓库层（写操作唯一入口）
│   │   ├── notesRepo.ts
│   │   ├── tagsRepo.ts
│   │   └── noteTagsRepo.ts
│   ├── lib/                       # 数据 + 同步底层（13 个模块）
│   │   ├── db.ts                  # Dexie 7-store
│   │   ├── supabase.ts
│   │   ├── auth.ts
│   │   ├── syncManager.ts         # 同步核心
│   │   ├── syncInstance.ts
│   │   ├── conflict.ts            # LWW pickWinner
│   │   ├── tags.ts
│   │   ├── device.ts              # 多设备同步去重
│   │   ├── autoArchive.ts
│   │   ├── cleanup.ts
│   │   ├── dataIO.ts              # JSON 导入/导出
│   │   ├── factoryReset.ts
│   │   └── secureStorageAdapter.ts
│   ├── hooks/
│   │   └── useVirtualizer.ts      # 手写虚拟滚动
│   ├── types/                     # TypeScript 类型定义
│   │   ├── api/database.ts
│   │   ├── base/env.d.ts
│   │   ├── db/                    # cache / conflict / events / note / noteTag / sync / tag
│   │   └── index.ts
│   └── test/
│       ├── setup.ts
│       └── fakes/                 # clock / supabase / secureStorage
├── tsconfig.json                  # TS 配置（strict）
├── tsconfig.strict.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── .env.example                   # 环境变量模板（提交到仓库）
├── .env.local                     # 本地（gitignore）
├── .env.test                      # 测试（gitignore）
├── .env.production                # 生产（gitignore）
└── package.json                   # version: 1.3.1
```

---

## 🔄 同步五大流程

| 流程 | 触发 | 实现 |
|---|---|---|
| 初始化同步 | 登录 | `SyncManager.start()` → fullSync → 水印 + Realtime + 轮询 |
| 本地推云端 | 仓库层写操作 | `_pushLocalChanges()` 批量 upsert（100 条/批），失败指数退避 |
| 云端拉本地 | 30s 轮询 + Realtime + 切前台 | `_syncEntity()` + `_handleRealtimeChange()`，LWW 合并 |
| 跨设备硬删 | fullSync 的 1.5 步 | `_cleanupRemoteHardDeletions()` 拉全量 cloud id，删本地有但云端没的 |
| 多设备实时 | Realtime 推送 | `user_id=eq.${userId}` 频道订阅 |

---

## 🧪 测试

```bash
npm test             # 一次性跑全套（166 个测试 / 23 describe 块）
npm run test:watch   # watch 模式
```

覆盖：Dexie 7-store 创建/索引/CRUD / 仓库层 create·update·softDelete·restore·merge·version bump·sync_queue / LWW `pickWinner` 四种分支 / `SyncManager` 推/拉/冲突/退避/Realtime 过滤/网络监听/硬删传播 / `autoArchive`（7/30/永不 三策略）/ `cleanup`（30 天硬删）/ `Editor` debounce 自动保存 + Ctrl+Enter 创建 / `Login` 模式切换 / `useVirtualizer` 滚动计算 / `UserMenu` 渲染 + 登入登出 / 各 Zustand store。

---

## 🔒 隐私与安全

- 笔记内容仅以纯文本存储/传输（无富文本 → 无 XSS 注入面）
- Supabase RLS 全表级强制（`anon key + user_id` 过滤）
- 生产环境 `ffn.aicyber.chat` 强制 HTTPS + HSTS
- 工厂重置：彻底清空本地 IndexedDB + Supabase 云端记录
- Android `capacitor-secure-storage-plugin`（Android Keystore 存 Token） + `captureInput=false` + `allowBackup=false`

---

## 📦 版本信息

| 平台 | 版本 | 备注 |
|---|---|---|
| Web (HTML5) | **v1.3.1** | `package.json`，main 分支部署 |
| Android | **v1.0**（versionCode 1） | `android/app/build.gradle` |

历史 changelog 见 [GitHub Releases](https://github.com/Niorghini/ffnmv/releases)。

### 主要变化时间线

- **v1.3.1**（2026-06-23）— JS→TS 全量迁移 + Android v1.0 + 标签修复
- **v1.3.0**（2026-06-20）— nginx HTTPS + HSTS + 6 安全头 / 3 环境构建 / 关闭 prod 邮箱确认 / EFF-001/002/003
- **v1.2**（2026-06-03）— 接入 Supabase 云端同步 / 标签独立实体 / 软删除 + 自动归档 / 冲突解决 UI / 虚拟滚动 / 移除 v0.7 本地数据兼容
- **v0.7.0** — 纯本地 IndexedDB，不再维护

---

## 🐛 已知限制 / 后续

- 标签拖拽排序未实现
- 每日自动备份未做
- 微信小程序计划已制定但未实施
- 旧版预发布 `ffn-pre.aicyber.chat` 已下线（2026-06-23）

---

## 📄 许可证

MIT License

---

## 💡 致敬 Flomo

发法牛源于对 [Flomo](https://flomoapp.com/) 的深深敬意——「记录即是进步」。受其启发，加上「已处理/未处理 + 软删除 + 跨设备同步 + 自建 Supabase」等自己的思考，形成发法牛 v1.3.x。

---

🤖 Maintained with [Claude Code](https://claude.com/claude-code)