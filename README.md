# 发法牛 - 发布的想法都很牛！

📝 一款简洁高效的本地优先笔记应用，让记录想法变得轻松自如。**v1.2 起支持多端实时同步**。当前 Web 版本 **v1.3.1**，Android 版本 **v1.0**。

> 域名体系（2026-06-20 起域名化）：
> - 生产：[https://ffn.aicyber.chat](https://ffn.aicyber.chat)（`118.89.118.126` · Tencent Lighthouse）
> - 预发布：[https://ffn-pre.aicyber.chat](https://ffn-pre.aicyber.chat)（`163.7.3.215`）
> - 测试：[https://ffn-test.aicyber.chat](https://ffn-test.aicyber.chat)（`163.7.3.215`）

---

## ✨ 核心功能

### 📝 笔记记录
- 快速记录想法，纯文本输入（v1.2 移除富文本/图片）
- 停止输入 300ms 自动保存
- `Ctrl+Enter` 快捷创建
- 软删除（30 天可恢复）+ 自动归档（已处理 7/30 天/永不）
- 🆕 v1.3.1 笔记时间显示到时分：今天 `H:MM` / 今年 `M月D日 HH:MM` / 跨年 `YYYY/M/D HH:MM`

### 🏷️ 标签系统
- `#标签名` 自动识别
- 标签独立实体（UUID + 颜色 + 笔记数）
- 点击筛选 + AND/OR 组合
- 标签管理：合并、颜色、计数

### ✅ 状态管理
- 已处理/未处理状态切换
- 状态筛选 + 处理时间自动记录
- 已处理笔记按策略自动归档

### ☁️ 多端同步
- Supabase 云端（自建 6 容器最小栈） + 本地 IndexedDB 离线优先
- 邮箱 + 密码认证；生产环境已关闭邮箱确认
- Realtime 跨设备实时更新 + 30s 自适应轮询（60→300s）
- 联网/切回前台自动同步 + 指数退避重试（1→32s）+ 离线队列
- LWW 冲突解决（version → updated_at → device_id）+ 手动冲突 UI
- 跨设备硬删除传播
- 🆕 v1.3.1 同步按钮 hover 浮层显示最近 10 次成功同步时间

### 🔍 检索与数据
- 全文搜索（content 字段）
- 标签筛选 + 状态筛选
- 笔记列表虚拟滚动（手写 `useVirtualizer`，1w 条 ~50ms 渲染）
- JSON 导入/导出（`src/lib/dataIO.js`）
- 🆕 工厂重置：彻底清空本地 + 云端

---

## 🚀 快速开始（v1.3.x）

### 1. 启动本地 Supabase

需要 Docker Desktop 和 Supabase CLI（项目自带）。

```bash
cd /Users/niorghini/ffnapp/ffnmv
supabase start    # 首次会拉镜像（~3min），之后秒启
supabase status   # 查 URL + anon key
```

把 `status` 里的 API URL 和 `Publishable` key 写到 `.env.local`：

```bash
# .env.local（已存在，确认值与 supabase status 一致）
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

## 🌍 三环境构建

```bash
# 全部已 gitignore；实际值在 .env.local / .env.test / .env.canary / .env.production
# 模板参考 .env.example（提交到仓库）
```

| 命令 | 用途 | Supabase URL | 输出目录 |
|---|---|---|---|
| `npm run build:test` | 测试环境构建 | `https://ffn-test.aicyber.chat` | `dist/` → 部署到 163.7.3.215 `/opt/ffn-test/dist/` |
| `npm run build:canary` | 预发布构建 | `https://ffn-pre.aicyber.chat` | `dist/` → 部署到 163.7.3.215 `/opt/ffn-pre/dist/` |
| `npm run build:prod` / `npm run build` | 生产构建 | `https://ffn.aicyber.chat` | `dist/` → 部署到 118.89.118.126 `/var/www/ffnmv/dist/` |

构建均带 Vite manualChunks（react / supabase / dexie / icons），首屏 gzip ~180KB。

---

## 🛠 部署管线

```
dev-* 分支 ──→ ffn-pre.aicyber.chat (163.7.3.215)  ←  feature canary
              │
              ↓ merge to main
              │
main 分支  ──→ ffn.aicyber.chat (118.89.118.126)   ←  生产
              ↑
              │ （历史：先 ffn-test.aicyber.chat 集成测试）
```

**所有 prod 操作（118.89.118.126 / ffn.aicyber.chat）需要显式确认。** 详细服务器清单、域名白名单、SSL、备份策略见各记忆文件与 `ops/README.md`。

---

## 🛠 技术栈

- **前端**: React 18 + Vite 5 + Tailwind CSS 3
- **路由**: react-router-dom v6（懒加载 `MainApp / Trash / Settings`）
- **状态**: Zustand（6 个 store）
- **本地数据库**: Dexie.js 4.x（IndexedDB 封装，7-store schema）
- **云端**: Supabase（Postgres + RLS + Realtime；生产自建 6 容器最小栈）
- **测试**: Vitest 2 + @testing-library/react + fake-indexeddb + happy-dom（166 tests）
- **Android**: Capacitor 8 + WebView + Gradle 8（`captureInput=false`, allowBackup=false, minSdk=24, targetSdk=36）
- **图标**: Lucide React
- **后端部署**: 腾讯云轻量应用服务器 + Docker 29 + nginx 1.24（自托管 Supabase）

---

## 📦 版本信息

| 平台 | 版本 | 备注 |
|---|---|---|
| Web (HTML5) | v1.3.1 | `package.json`，main 分支部署 |
| Android | v1.0 | `android/app/build.gradle` `versionCode=1`，dev-android 分支 |

### Web v1.3.1（2026-06-20）
- 🆕 同步按钮 hover 浮层显示最近 10 次完成时间
- 🆕 笔记时间显示到时分（三级时间格式）
- 完整 changelog：4b1ebb7 / a9ec97a / 007e02c

### v1.3.0
- nginx HTTPS + HSTS 启用（`ops/nginx.conf`）
- 3 环境构建配置（`.env.test / .env.canary / .env.production`，去路径前缀、域名化）
- 嵌套 location 块 add_header 补 6 个安全头
- nginx 加 Cache-Control 头防部署后用户缓存旧 hash
- 关闭 prod 邮箱确认
- 同步状态指示器重构

### v1.2.x → v1.3.0 主要变化
- ✨ 接入 Supabase 云端同步（多端实时）
- ✨ 邮箱密码认证
- ✨ 标签升级为独立实体
- ✨ 软删除（30 天可恢复）+ 自动归档
- ✨ 冲突解决 UI（LWW + 手动选择）
- ✨ 虚拟滚动（1w 条笔记流畅）
- 🗑 移除图片上传、富文本（PRD 改为纯文本）
- 🗑 **v0.7.0 本地数据不再兼容**

完整历史：`git log --oneline` · `git log --grep="release"`

---

## 🧪 测试

```bash
npm test             # 一次性跑全套（160 个测试）
npm run test:watch   # watch 模式
```

当前 **16 个 test 文件 / 166 个测试**，覆盖：

- Dexie 7-store 创建/索引/CRUD
- 仓库层 `create/update/softDelete/restore/merge/version bump/sync_queue` 入队
- LWW `pickWinner` 四种分支
- `SyncManager` 推/拉/冲突/退避/Realtime 过滤/网络监听/硬删传播
- `autoArchive`（7/30/永不 三策略）
- `cleanup`（30 天硬删）
- `Editor` debounce 自动保存、Ctrl+Enter 创建、状态切换
- `Login` 模式切换、错误显示
- `useVirtualizer` 滚动计算
- `UserMenu` 渲染 + 登入登出

---

## 🏗 项目结构

```
ffnmv/
├── docs/                          # 迁移计划 / 评审 / SOP
│   ├── plan-android.md            # v3（Capacitor 6 方案，9.75–10.75 人天）
│   ├── plan-android-v1.md         # 历史
│   ├── plan-android-v2.md         # 历史
│   ├── plan-wechat-miniprogram.md # v2（Taro 4 方案，10.5–12.5 人天）
│   └── plan-wechat-miniprogram-v1.md  # 历史
├── ops/                           # 运维脚本（部署到生产服务器用）
│   ├── deploy-nginx.sh
│   ├── deploy-disable-email.sh
│   ├── deploy-password.sh
│   ├── deploy-rate-limit.sh
│   ├── nginx.conf                 # 生产 nginx 配置（HTTPS + HSTS + 6 个安全头）
│   ├── rate-limit.conf
│   ├── README.md
│   └── snippets/                  # 可复用的 nginx 配置片段
├── supabase/                      # 自托管 Supabase 配置 + migrations
├── public/
├── src/
│   ├── App.jsx                    # BrowserRouter + 懒加载路由
│   ├── main.jsx
│   ├── index.css
│   ├── assets/
│   ├── components/                # UI 组件
│   │   ├── Editor.jsx
│   │   ├── NoteList.jsx           # 虚拟滚动
│   │   ├── Sidebar.jsx
│   │   ├── SearchBar.jsx
│   │   ├── UserMenu.jsx           # 同步状态 + hover 浮层 + 登出入口
│   │   ├── Toast.jsx
│   │   └── ConflictDialog.jsx     # 含 ConflictBanner
│   ├── pages/                     # 路由页面
│   │   ├── MainApp.jsx            # 三栏主界面
│   │   ├── Login.jsx
│   │   ├── Settings.jsx           # 导出/导入/工厂重置/改密
│   │   └── Trash.jsx
│   ├── stores/                    # Zustand stores（6 个）
│   │   ├── useAuthStore.js
│   │   ├── useNotesStore.js
│   │   ├── useTagsStore.js
│   │   ├── useTrashStore.js
│   │   ├── useSyncStore.js        # 含 lastSyncTimes 数组（v1.3.1 新增）
│   │   └── useConflictsStore.js
│   ├── repositories/              # 仓库层（写操作唯一入口）
│   │   ├── notesRepo.js
│   │   ├── tagsRepo.js
│   │   └── noteTagsRepo.js
│   ├── lib/                       # 数据 + 同步底层
│   │   ├── db.js                  # Dexie 7-store
│   │   ├── supabase.js            # Supabase client 单例
│   │   ├── auth.js
│   │   ├── syncManager.js         # 同步核心（490 行）
│   │   ├── syncInstance.js        # 单例 + store 绑定
│   │   ├── conflict.js            # LWW pickWinner
│   │   ├── tags.js                # 标签解析 + 颜色
│   │   ├── device.js              # 设备 ID（多设备同步去重）
│   │   ├── autoArchive.js
│   │   ├── cleanup.js
│   │   ├── dataIO.js              # JSON 导入/导出
│   │   └── factoryReset.js
│   ├── hooks/
│   │   └── useVirtualizer.js      # 虚拟滚动（手动实现）
│   └── test/
│       ├── setup.js
│       └── fakes/                 # 测试 mock（clock, supabase）
├── index.html
├── package.json                   # version: 1.3.1
├── vite.config.js                 # manualChunks + Vitest 配置
├── tailwind.config.js
├── postcss.config.js
├── .env.example                   # 环境变量模板（提交到仓库）
├── .env.local                     # 本地开发（gitignore）
├── .env.test                      # 测试环境（gitignore）
├── .env.canary                    # 预发布环境（gitignore）
└── .env.production                # 生产环境（gitignore）
```

---

## 🔄 同步五大流程

| 流程 | 触发 | 实现 |
|---|---|---|
| 初始化同步 | 登录 | `SyncManager.start()` → `fullSync()` → 水印 + Realtime + 轮询 + 监听 |
| 本地推云端 | 仓库层写操作 | `_pushLocalChanges()` 批量 upsert（100 条/批），失败指数退避 |
| 云端拉本地 | 30s 轮询 + Realtime + 切前台 | `_syncEntity()` + `_handleRealtimeChange()`，LWW 合并 |
| 跨设备硬删 | 每次 fullSync 的 1.5 步 | `_cleanupRemoteHardDeletions()` 拉全量 cloud id，删本地有但云端没的 |
| 多设备 | Realtime 跨设备推送 | `user_id=eq.${userId}` 过滤的 channel 订阅 |

---

## 📱 移动端

| 平台 | 方案 | 计划文档 | 状态 |
|---|---|---|---|
| **Android** | Capacitor 8 包装现有 Web（`npm run android:apk:release` 出包） | [`docs/plan-android.md`](./docs/plan-android.md) v3 | ✅ 已完成（v1.0, 2026-06-21） |
| 微信小程序 | Taro 4 重写前端 | [`docs/plan-wechat-miniprogram.md`](./docs/plan-wechat-miniprogram.md) v2 | 待启动 |

### Android 构建（首次 ~30min，后续 ~2min）

```bash
# 前置：JDK 21 + Android SDK（见 docs/android-build-guide.md）
# 首次生成 keystore 并备份到 1Password（见 docs/android-maintain.md）

npm run build:android          # web 构建 + cap sync
npm run android:apk:release    # 出 release APK（~2.6MB）
# APK → android/app/build/outputs/apk/release/app-release.apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

详见：
- [`docs/android-build-guide.md`](./docs/android-build-guide.md) — 首次出包完整指南（JDK/SDK/keystore/踩坑）
- [`docs/android-maintain.md`](./docs/android-maintain.md) — 日常运维 SOP（签名备份/回滚/版本号/Pre-commit Hook）

---

## 🐛 已知限制 / 后续

- 标签拖拽排序未实现
- 每日自动备份未做
- 微信小程序计划已制定但未实施
- `ffn-pre` 数据同步偶发空拉（`data-updated` 事件触发逻辑，待修复，2026-06-20 暂缓）
- Android WebView 部分机型的 launcher 图标适配（vivo OriginOS 已适配 `#F2F2F2` 底色 + cow 40% 居中）

---

## 🔒 隐私与安全

- 笔记内容仅以纯文本存储/传输（无富文本 → 无 XSS 注入面）
- Supabase RLS 全表级强制（`anon key + user_id` 过滤）
- 生产环境 `ffn.aicyber.chat` 强制 HTTPS + HSTS
- 工厂重置：彻底清空本地 IndexedDB + Supabase 云端记录
- Android / 微信小程序后续计划中均设计 Keystore / 沙箱存储 Token
- Android v1.0 已采用 `capacitor-secure-storage-plugin`（Keystore）+ `captureInput=false` + `allowBackup=false`

---

## 📄 许可证

MIT License

---

## 💡 致敬 Flomo

发法牛的诞生，源于对 [Flomo](https://flomoapp.com/) 的深深敬意——「记录即是进步」。受其启发，加上「已处理/未处理 + 软删除 + 跨设备同步 + 自建 Supabase」等自己的思考，形成发法牛 v1.3.x。

---

🤖 Maintained with [Claude Code](https://claude.com/claude-code)
