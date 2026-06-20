# 计划：ffnmv 转微信小程序（Taro 4 方案） — **v2**

> **目标**：把现有 React + Vite + Supabase 笔记应用编译成可在微信内运行的微信小程序，触达微信生态用户。
> **基线**：`ffnmv v1.3.1`（main 分支，2026-06-20 状态）。
> **v2 修订**：将 Android 计划评审中的可移植项（详见 `docs/plan-android-suggestion.md` + `docs/plan-android.md` 附录 A）适配到小程序环境。详见末尾「附录 A：v1→v2 变更日志」。原版保留在 [`plan-wechat-miniprogram-v1.md`](./plan-wechat-miniprogram-v1.md)。
> **读者**：ffnmv 开发者。**重要前提**：微信小程序 ≠ 浏览器 webview，技术约束差异巨大，请先读完 §1 决策与 §2 限制再排期。

---

## 0. 一句话总结

**用 Taro 4 重写前端（React 语法保留），后端 Supabase 不动；前端需要替换：Dexie → wx.storage 适配层、react-router → @tarojs/router、lucide-react → iconfont、Supabase Realtime → 降级为 HTTP 轮询；预计 10.5–12.5 人天；上线需 ICP + 类目审核。**

---

## 1. 方案决策（三个候选）

| 方案 | 复用代码 | 体验 | 限制 | 决定 |
|---|---|---|---|---|
| **Taro 4 + React 模板** | ★★★★（React 语法、JSX、Zustand 可复用） | 中（双线程模型） | 主包 2MB / 总体 20MB；无 DOM；无 localStorage；无 WebSocket 同 API | **采用** |
| 原生 wxml/wxss/js | ★★（UI 全部重写） | 高（贴近原生） | 同上 | 备选（仅当 Taro 编译坑太多时回退） |
| uni-app（Vue） | ★★（重写 React→Vue） | 中 | 同 | 不建议（额外语言切换） |
| H5 内嵌 web-view | ★★★★★ | 低（受限 30+ API） | 不能用 Supabase Realtime；性能差 | 排除（体验不可接受） |

**为什么 Taro 4**：
- 同一份 React + JSX + Zustand 代码可同时输出「微信小程序 / H5 / 支付宝小程序 / RN」，未来加抖音小程序零成本
- 与 Vite 生态兼容，迁移工具链成本最低
- 自带 `@tarojs/components` 提供 `View/Text/ScrollView`，和 React Native / 小程序的双向映射
- 社区活跃（美团系，京东也用）

---

## 2. 微信小程序的硬约束（必须事先理解）

| 约束 | 当前 ffnmv 用的 | 影响 | 应对 |
|---|---|---|---|
| 无 DOM / 无 `window` | React DOM、BrowserRouter、ResizeObserver、`<a download>` | 编译期 Taro 会替换；运行时部分 API 没了 | Taro 组件替代 `View/Text`；用 `Taro.openDocument` / `Taro.saveFileToAlbum` 替代下载 |
| 无 `localStorage` | supabase-js 默认存储、设备 ID | 编译过，运行抛错 | 适配层统一用 `Taro.getStorageSync/setStorageSync` |
| 无 IndexedDB | Dexie | 不能用 | **重写为 `wx.storage` 适配层**（10MB 总配额 / key 1MB） |
| 无 fetch / XHR 自由 | supabase-js 内部 fetch | 微信要求「业务域名白名单」 | 微信公众平台 → 开发管理 → 服务器域名 配置 `ffn.aicyber.chat` + `supabase.aicyber.chat`（**必须 HTTPS，有 ICP 备案**） |
| WebSocket API 不同 | Supabase Realtime | `new WebSocket()` 在小程序不直接可用 | 用 `Taro.connectSocket`，写 supabase-js 适配层；或**退化为 HTTP 轮询**（推荐，详见 §4 Phase 4） |
| 主包 ≤ 2MB | 整包 668KB，未压缩 ~2MB+ | 必须分包 | §3 Phase 5 拆 subpackages |
| 总体 ≤ 20MB | n/a | 安全 | 图片/资源用 CDN |
| 需 ICP 备案 + 类目审核 | n/a | 业务域 `ffn.aicyber.chat` 已备案（推断） | 申请类目「效率 → 笔记」或「工具 → 办公」 |
| 登录方式受限 | 邮箱密码 | 小程序没有「邮箱密码」表单惯例 | **改为：微信一键登录 + Supabase 邮箱 OTP 兜底**（详见 §3 Phase 2.3） |
| 无 `<input type="file">` | JSON 导入 | 改用 `Taro.chooseMessageFile` |
| 无 `URL.createObjectURL` | 导出预览 | 改用 `Taro.downloadFile` + `Taro.openDocument` 或上传到临时云存储 |
| 后台限制 | n/a | 小程序后台 5s 断 socket | 退后台即停同步；回前台补全 |
| 锁屏方向 | n/a | 横屏布局错乱 | `app.config.ts` 设 `pageOrientation: 'portrait'`（🆕 v2 采纳） |
| 🆕 网络异常无超时 | supabase fetch 默认无超时 | 弱网/服务器无响应时请求挂死 | `Taro.request` 加 `timeout: 10000`（§3 Phase 2.2） |
| 🆕 切网不重连 | n/a | WiFi↔4G 切换后不知道要立即同步 | `Taro.onNetworkStatusChange` 监听 connect 事件 → 触发 `fullSync`（§3 Phase 4.5） |
| 🆕 小程序版本更新 | n/a | 上线后用户不更新 = 永远跑旧代码 | `wx.getUpdateManager` 检查并提示升级（§3 Phase 6.4） |

---

## 3. 实施步骤

### Phase 1 — Taro 脚手架与目录规划（1 天）

```bash
# 1. 装 CLI
npm install -g @tarojs/cli       # 或 npx
taro init ffnmv-mp                # 选 React + TypeScript + 微信小程序

# 2. 目录约定（建议从 src/ 拷过来但加 mp/ 前缀）
ffnmv-mp/
├── src/
│   ├── app.tsx                  # App 入口
│   ├── app.config.ts            # 小程序 pages / window / tabBar 配置
│   ├── pages/
│   │   ├── index/               # 原 MainApp
│   │   ├── trash/               # 原 Trash
│   │   ├── settings/            # 原 Settings
│   │   └── login/               # 原 Login
│   ├── components/              # Editor / NoteList / Sidebar / ...（Taro 重命名）
│   ├── stores/                  # Zustand 照搬
│   ├── repositories/            # 改写：用 wxStorage
│   ├── lib/
│   │   ├── supabase.ts          # 见 §3 Phase 2.2
│   │   ├── storage.ts           # 见 §3 Phase 2.1
│   │   └── syncManager.ts       # 改 Realtime → poll
│   └── hooks/
│       └── useVirtualList.ts    # 用 @tarojs/virtual-list 替代
└── project.config.json
```

**`config/index.ts`（Taro 构建配置）**：

```ts
import { defineConfig } from '@tarojs/cli'

export default defineConfig(async (merge, { command, mode }) => {
  const baseConfig = {
    projectName: 'ffnmv-mp',
    date: '2026-6-20',
    designWidth: 750,        // 设计稿基准宽度
    deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2, 375: 2 / 1 },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: ['@tarojs/plugin-framework-react', 'taro-plugin-tailwindcss'],
    defineConstants: {},
    copy: { patterns: [], options: {} },
    framework: 'react',
    compilerOptions: {
      // 🆕 v2 采纳：Taro 编译器自己处理 es2020+ 语法降级
      // weapp target 内部已做 polyfill；不需要额外 es2020 配置
      typeRoots: ['node_modules/@types'],
    },
    cache: { enable: true },
  }

  // H5 / 小程序差异配置走 merge
  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, { h5: { devServer: { port: 10086 } } })
  }
  return baseConfig
})
```

**`src/app.config.ts`（小程序配置）**：

```ts
export default defineAppConfig({
  pages: ['pages/login/index', 'pages/index/index', 'pages/trash/index', 'pages/settings/index'],
  window: {
    navigationBarTitleText: '发法牛',
    navigationBarBackgroundColor: '#ffffff',
    backgroundColor: '#f5f5f5',
  },
  // 🆕 v2 采纳：锁竖屏，避免横屏布局错乱
  pageOrientation: 'portrait',
  // 注意：subpackages 必须在分包就位后才能填（见 §3 Phase 5）
  subpackages: [],
  requiredPrivateInfos: [],   // ⚠️ 用到 wx.getLocation / chooseLocation 才需要；当前不需要
  permission: {},
  lazyCodeLoading: 'requiredComponents',   // ★ 启动优化
})
```

### Phase 2 — 适配层（2 天，三个核心文件）

#### 3.1 `src/lib/storage.ts`（替换 Dexie + localStorage）

```ts
import Taro from '@tarojs/taro'

const NAMESPACE = 'ffn:'

export const storage = {
  async getItem(key) {
    try { return Taro.getStorageSync({ key: NAMESPACE + key }).data ?? null }
    catch { return null }
  },
  async setItem(key, value) {
    if (typeof value !== 'string') value = JSON.stringify(value)
    return Taro.setStorageSync({ key: NAMESPACE + key, data: value })
  },
  async removeItem(key) {
    return Taro.removeStorageSync({ key: NAMESPACE + key })
  },
}

// notes/tags/note_tags 的查询接口（重写 notesRepo 等）
// 关键差异：Dexie 的 .where().anyOf().count() → storage 只能全表扫
// 缓解：notes 量级 < 5k 时，setStorageSync({ key: 'notes:all', data: [...] }) 单 key 存全表
//       加内存索引（Map<id, note>）加速查询
```

**注意配额**：
- 单 key ≤ 1MB（压缩前）
- 总 ≤ 10MB（小游戏）/ 微信 50MB+（实际很大但单 key 别超）
- 超过触发 `exceed quarantine` 报错

**改造点**（在 `repositories/notesRepo.ts` 等）：
- `db.notes.where('sync_status').anyOf([...]).count()` → 内存 filter
- `db.notes.get(id)` → `Map.get(id)`
- `db.transaction(...)` → 用 mutex（自实现简单 async 锁），因为 wx.storage 无事务

#### 3.2 `src/lib/supabase.ts`（HTTP 适配 + 移除 Realtime + **🆕 网络加固**）

```ts
import { createClient } from '@supabase/supabase-js'
import Taro from '@tarojs/taro'
import { storage } from './storage'

// 关键①：用 Taro.request 替换 fetch（自动处理业务域名白名单）
// 关键②（🆕 v2 采纳）：所有请求加 10s 超时，防止弱网/服务器无响应挂死
const taroFetch: typeof fetch = async (url, init) => {
  const res = await Taro.request({
    url: String(url),
    method: (init?.method as any) || 'GET',
    data: init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : undefined,
    header: init?.headers as any,
    timeout: 10000,             // 🆕 10s 超时
  })
  // supabase-js 期望的标准 fetch 行为：4xx/5xx 不抛，要返回 Response
  return new Response(typeof res.data === 'string' ? res.data : JSON.stringify(res.data), {
    status: res.statusCode,
    headers: res.header as any,
  })
}

export const supabase = createClient(
  process.env.TARO_APP_SUPABASE_URL!,
  process.env.TARO_APP_SUPABASE_ANON_KEY!,
  {
    fetch: taroFetch,             // ★ 关键
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage,                    // 用 wx.storage
      storageKey: 'ffn-sb-session',
    },
    // 关键：禁 Realtime（小程序无原生 WebSocket API，强行用会失败）
    realtime: { params: { eventsPerSecond: 0 } },
  }
)
```

**关于超时**：`Taro.request` 的 `timeout` 是微信原生支持的，触发后会 reject `RequestError`；supabase-js 内部会捕获并走错误重试逻辑。**注意**：supabase-js 的自动重试会在内部 fetch 上再包一层，所以最坏情况是 10s × 3 次 ≈ 30s 后才报错。生产环境如果嫌长可改 `retryAttempts: { auth: 0, rest: 1 }`。

#### 3.3 登录方式改造（**重要**）

小程序登录最自然的是「微信一键登录」，但 Supabase Auth 不直接支持 openid。需要一个**桥接方案**：

**推荐方案：微信 code → 后端 Edge Function 换 Supabase session**

```ts
// 登录页：Taro.login 拿 code
const { code } = await Taro.login()
// 调 Supabase Edge Function: /functions/v1/wechat-login
//  Edge Function 内：code → 微信 server 换 openid+session_key
//                     → 查/建 ffnmv 账号（用 openid 作为映射）
//                     → 用 service_role key 给前端签发 Supabase session
//  返回 { access_token, refresh_token, user }
const { data } = await supabase.functions.invoke('wechat-login', { body: { code } })
await supabase.auth.setSession({
  access_token: data.access_token,
  refresh_token: data.refresh_token,
})
```

**保留兜底**：登录页提供「用邮箱 + 密码」入口（直接调 `signInWithPassword`，在 supabase-js + taroFetch 下可行），覆盖未绑定微信的存量用户。

**账号绑定**：首次微信登录成功后，弹窗让用户填邮箱，把 openid 写入 `auth.users.app_metadata`（Edge Function 内做）。

#### 3.4 路由 / 图标 / 虚拟列表

```ts
// 路由：用 @tarojs/router
import { useRouter } from '@tarojs/taro'  // 或 Taro.navigateTo
// 替代 react-router-dom 的 useNavigate() / <Link>

// 图标：lucide-react 不能用（依赖 React DOM + SVG attrs）
// 方案 A：转成 iconfont（IcoMoon / fontmin）
// 方案 B：内联 SVG 组件（写 30+ 常用图标）
// 推荐方案 A：体积小，<View className="icon icon-note" />

// 虚拟列表：
import { VirtualList } from '@tarojs/components'   // 或 @tarojs/virtual-list
<VirtualList
  height={Taro.getSystemInfoSync().windowHeight}
  itemData={notes}
  itemCount={notes.length}
  itemSize={64}            // 固定行高（rpx）
  renderItem={({ index }) => <NoteRow note={notes[index]} />}
/>
```

### Phase 3 — UI 组件替换（2 天）

把所有 `<div>` → `<View>`、`<span>` → `<Text>`、`<input>` → `<Input>`、`<button>` → `<Button>`。

**注意**：
- 小程序 CSS 仅支持 `rpx`（响应式像素，750rpx = 屏幕宽）和 `px`
- 不支持 `:has()`、复杂选择器；Tailwind 的 `space-y-*` 等需要用 plugin 编译到小程序 wxml
- **安装 `taro-plugin-tailwindcss`**：自动处理 class 转换

```bash
npm install -D tailwindcss postcss taro-plugin-tailwindcss
# config/index.ts:
plugins: ['@tarojs/plugin-framework-react', 'taro-plugin-tailwindcss']
```

**🆕 v2 采纳：全局最小触摸目标（移动端规范）**

在 `src/app.css` 加：

```css
/* 88rpx ≈ 44px（375pt 屏），在 750 设计稿下是 88rpx，物理尺寸约 44–49px */
@layer base {
  button, a, input, textarea, select, [role="button"] {
    min-height: 88rpx;
  }
  button, a, [role="button"] {
    min-width: 88rpx;
  }
}
```

**🆕 v2 采纳：首屏 skeleton（替代 splash 概念）**

小程序无原生 splash；冷启动时的「白屏」本质是 wxml 解析 + 数据加载的等待。优化方案：

```tsx
// pages/index/index.tsx
import { Skeleton } from '@tarojs/components'

export default function Index() {
  const { notes, loaded } = useNotesStore()

  if (!loaded) {
    return (
      <View className="p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} className="h-20 bg-gray-100 animate-pulse rounded-lg" />
        ))}
      </View>
    )
  }
  return <NoteList notes={notes} />
}
```

### Phase 4 — 同步层改造（1.5 天）

把 `syncManager.js` 复制过来，改三处：

```ts
// 1. Realtime 不可用，删除 setupRealtime() 调用
// 2. 轮询频率移动端调密
this.minPollInterval = 30000      // 30s（web 是 60s）
this.maxPollInterval = 180000     // 3min

// 3. 🆕 v2 采纳：加 appStateChange 监听（退后台停 polling；回前台立即补一次）
Taro.onAppShow(() => this.fullSync())
Taro.onAppHide(() => this._pausePolling())
```

**事件总线** `window.dispatchEvent` 在小程序里不能直接用，改 `Taro.eventCenter`：
```ts
Taro.eventCenter.on('data-updated', this._onDataUpdated)
```

### Phase 4.5 — 🆕 网络监听与立即重连（0.25 天）

Android 评审里 `Network.addListener` 那条同样适用于小程序，做法是 `Taro.onNetworkStatusChange`：

```ts
// src/lib/syncManager.ts（init 时注册一次）
import Taro from '@tarojs/taro'

Taro.onNetworkStatusChange((res) => {
  if (res.isConnected) {
    // 联网：取消暂停、立即补一次全量同步
    syncManager._resumePolling()
    syncManager.fullSync()
  } else {
    // 断网：暂停轮询，节省电量和流量
    syncManager._pausePolling()
  }
})
```

**为什么需要**：
- 用户在地铁/电梯里丢信号恢复后，常规 polling 要等 30s 才会触发
- 显式监听可以让恢复即同步，体感更"实时"
- 弱网/断网期间停 polling，省电

### Phase 5 — 分包加载（1 天）

主包 2MB 限制：把首屏（login + index）放主包，其他放分包。

```ts
// app.config.ts
export default defineAppConfig({
  pages: ['pages/login/index', 'pages/index/index'],
  subpackages: [
    {
      root: 'packageTrash',
      name: 'trash',
      pages: ['pages/trash/index'],
      independent: false,
    },
    {
      root: 'packageSettings',
      name: 'settings',
      pages: ['pages/settings/index'],
      independent: false,
    },
  ],
  preloadRule: {
    'pages/index/index': { network: 'all', packages: ['settings'] },  // 预加载
  },
})
```

**体积瘦身 checklist**：
- [ ] supabase 全量 import → 改为 tree-shake（已支持但要确认）
- [ ] lucide-react 删除（改 iconfont 后）
- [ ] Dexie 删除（改 wx.storage 后）
- [ ] react-router-dom 改成 `@tarojs/router`（轻）
- [ ] moment/dayjs 仅在用到时引入
- [ ] 跑 `taro build --type weapp --watch` 看 `dist/` 大小

### Phase 6 — 业务域名 + 上传审核 + 🆕 版本更新机制（1–3 天等待）

#### 6.1 业务域名（必须）

1. 微信公众平台 → 开发管理 → 开发设置 → 服务器域名：
   - request 合法域名：`https://ffn.aicyber.chat`、`https://supabase.aicyber.chat`（生产 supabase 实例的域名）
   - uploadFile / downloadFile 同上
   - **前提**：`ffn.aicyber.chat` 已 ICP 备案；SSL 已是正式证书（ZeroSSL 即可）

#### 6.2 微信认证 + 类目

2. 微信公众平台 → 设置 → 基本设置 → 微信认证（300 元/年，个人主体不可用支付/部分类目）
3. 类目选择：效率 → 笔记（需要「笔记类目」资质）或 工具 → 办公

#### 6.3 提交审核

4. 提交审核：填应用名称、简介、图标、截图（5 张 1284×2778）、隐私政策
5. 审核 1–7 天

#### 6.4 🆕 v2 采纳：版本更新机制（**替代 Android 评审里的 `@capacitor-updater` 方案**）

微信小程序**有原生热更新机制** `wx.getUpdateManager`（同步 + 异步），无需第三方插件。在 `app.tsx` 启动时检查：

```tsx
// src/app.tsx
import Taro from '@tarojs/taro'

export class App extends Component {
  componentDidMount() {
    if (Taro.canIUse('getUpdateManager')) {
      const updateManager = Taro.getUpdateManager()
      updateManager.onCheckForUpdate((res) => {
        console.log('[mp] hasUpdate:', res.hasUpdate)
      })
      updateManager.onUpdateReady(() => {
        Taro.showModal({
          title: '更新提示',
          content: '新版本已准备好，是否重启应用？',
          success: (res) => {
            if (res.confirm) updateManager.applyUpdate()
          },
        })
      })
      updateManager.onUpdateFailed(() => {
        Taro.showModal({
          title: '更新失败',
          content: '请检查网络后重试。',
          showCancel: false,
        })
      })
    }
  }
  // ...
}
```

**关键差别 vs `@capacitor-updater`**：
- ✅ 平台原生、零成本、零依赖、零安全风险
- ❌ 仅支持「全量静默下载 + 提示用户重启」，不能增量热更
- ❌ 不绕过微信审核（合规反而更好）

**发布策略**：
- 体验版（5–10 个微信号）→ 灰度发布（5% → 20% → 100%）→ 全量
- 紧急修复：发布后用户**首次冷启动**时（不是热启动）会触发 `onCheckForUpdate`；强制重启可通过 `applyUpdate` 完成

### Phase 7 — 🆕 自动化构建脚本（0.25 天）

**`ffnmv-mp/package.json` 新增脚本**（避免人工漏 sync / 漏切环境）：

```json
{
  "scripts": {
    "dev": "taro build --type weapp --watch",
    "build": "taro build --type weapp",
    "build:test": "cross-env TARO_APP_ENV=test taro build --type weapp",
    "build:canary": "cross-env TARO_APP_ENV=canary taro build --type weapp",
    "build:prod": "cross-env TARO_APP_ENV=production taro build --type weapp",
    "// preview": "在微信开发者工具里打开 dist/ 目录",
    "preview": "echo '请用微信开发者工具打开 dist/ 目录'"
  }
}
```

配套：`npm install -D cross-env`

### Phase 8 — 🆕 运维文档 `docs/mp-maintain.md`（0.5 天）

新增运维文档，记录：
- **类目审核**：每年续费微信认证、类目资质变更流程
- **微信认证**：企业主体资质清单、续费提醒
- **域名白名单**：新增 supabase 实例时如何加白名单；调试期「开发版不校验域名」开关
- **版本发布流程**：开发者工具上传体验版 → 后台提交审核 → 灰度发布
- **紧急修复流程**：`wx.getUpdateManager` 触发全量重下 + 强制 `applyUpdate`
- **监控**：微信公众平台 → 统计 → 性能数据（启动耗时、错误率）

---

## 4. 安全性评估 + 执行步骤

> 对比：web（基线）/ Android（见 `plan-android.md`）/ 微信小程序（本节）

| 风险 | Web | 小程序 | 步骤 |
|---|---|---|---|
| **Token 落 wx.storage** | localStorage | wx.storage（沙箱内，**不加密**） | 用 `@tarojs/taro` 的 `setStorageSync` 配合 Supabase JWT 短 TTL（默认 1h）+ autoRefresh；可接受；高敏场景用 `Taro.setStorage` 的加密接口（小程序基础库 2.21+ 提供 `setStorage` 加密选项） |
| **匿名 key 在小程序包里** | 可接受 | 同 | 无需改，Supabase 设计如此 |
| **业务域名白名单** | n/a | **必须配**，否则请求被微信拦截 | §3 Phase 6.1 |
| **wx.login code 泄露** | n/a | code 5 分钟内有效 | 直接发到自建 Edge Function；不上日志 |
| **中间人** | TLS + Cert | TLS（微信强制） | 配 Cert Pinning（`@tarojs/taro` 暂未提供，需自实现 `request` 拦截） |
| **XSS** | 全文本 | 全文本 | 保持现状；小程序 wxml 也不能用 `dangerouslySetInnerHTML`，用 `<Text>{content}</Text>` 转义 |
| **小程序代码被反编译** | n/a | 微信上传代码会做混淆，但**仍可还原逻辑** | 关键逻辑（如果未来有）放 Edge Function；前端只放展示 |
| **黑产刷登录** | n/a | 调 Edge Function 频率限制 | Edge Function 端：按 IP+code 限速（10/min）；用 `WX_AUTH_CODE_CACHE` 短 TTL 缓存 |
| **设备丢失** | 浏览器登录态 | wx.storage 与微信号绑 | token 失效 = 重新 wx.login 即可，无需做生物锁 |
| **类目审核不过** | n/a | 「账号 + 云存储 + 笔记」可能被打回 | 提前看类目准入要求；准备 ICP 截图、隐私协议 URL |
| 🆕 **网络异常请求挂死** | n/a | 弱网/服务器无响应时 fetch 不超时 | `Taro.request({ timeout: 10000 })`（§3 Phase 2.2） |
| 🆕 **切网不重连** | n/a | WiFi↔4G 切换后不知道要立即同步 | `Taro.onNetworkStatusChange` 监听 connect → 触发 `fullSync`（§3 Phase 4.5） |
| 🆕 **旧版本小程序不更新** | n/a | 用户跑旧代码，新功能/修复不生效 | `wx.getUpdateManager` 冷启动检查（§3 Phase 6.4） |

**安全验收 checklist**：
- [ ] Edge Function `wechat-login` 限速 + 日志无敏感字段
- [ ] 小程序代码扫描无 hard-coded secret
- [ ] RLS 在 Supabase 端不变
- [ ] `Taro.getStorageInfoSync()` 检查：单 key < 1MB；总数 < 8MB
- [ ] 🆕 弱网下所有请求 10s 内必返回超时
- [ ] 🆕 WiFi↔4G 切 10 次后仍能自动同步
- [ ] 🆕 用户冷启动时如有新版本必弹窗提示

---

## 5. 效率评估 + 执行步骤

| 指标 | Web | 小程序 | 步骤 |
|---|---|---|---|
| 首屏 JS 体积 | ~500KB（gzip 180KB） | 主包限 2MB | 分包；iconfont 替代 lucide；supabase tree-shake；最终主包 < 1.5MB |
| 启动耗时 | ~1.2s | ~1.5s（小程序框架启动 + 首屏渲染） | `lazyCodeLoading: 'requiredComponents'`；首页用 **skeleton**（v2 替代 splash 概念） |
| 列表 1000 条滚动 | 60fps (useVirtualizer) | 60fps (`@tarojs/virtual-list`) | 固定行高 64rpx；overscan 3 |
| 同步频率 | 60s–300s + Realtime | 30s–180s 轮询（**无 Realtime**） | 退后台即停；前台立即补一次；用户手动刷新按钮 |
| 存储读写 | IndexedDB 快 | wx.storage 同步 API（~ms 级） | 大量数据全表加载 + 内存索引；避免循环 `setStorage` |
| 后台限制 | n/a | 5s 后断 socket，但**无 socket 也无所谓**（我们没 Realtime） | 退后台：`fullSync` 取消；回前台：再 `fullSync` |
| 网络 | HTTP/2 | 微信代理（HTTP/1.1） | 无优化空间；接口尽量合批 |
| 电量 | n/a | 轮询耗电比 Realtime 多 | 把 `minPollInterval` 调到 45s；非充电状态降频 |
| 包体积 | n/a | 主包 + 分包总计 ≤ 20MB | 资源走 CDN（`ffn.aicyber.chat/static/...`） |
| 🆕 缓存策略 | 浏览器长缓存 | MP 包首次全量下载到客户端，之后增量 | Taro 编译产物自带 content-hash；升级自动失效；**不要禁缓存**（会让每次启动重下） |

**效率验收 checklist**：
- [ ] `taro build --type weapp` 主包 < 1.5MB
- [ ] iPhone 8 / 华为 P30 等老设备首屏 ≤ 2.5s
- [ ] 1000 条笔记滚动稳定 60fps（微信开发者工具 Performance 面板）
- [ ] 100 条笔记 push 在 4G 下 ≤ 10s
- [ ] 退后台 30s 回前台，5s 内完成一次同步
- [ ] 🆕 切网（WiFi→4G）后 5s 内触发一次全量同步
- [ ] 🆕 弱网 1KB/s 时所有请求 10s 内必返回（不卡死）

---

## 6. 测试计划

| 阶段 | 工具 | 重点 |
|---|---|---|
| 单元 | 现有 vitest（直接迁过来） | repositories 重写后必跑 |
| 编译 | `taro build --type weapp` | 主包大小告警 |
| 模拟器 | 微信开发者工具 | 调试、wxml 检查 |
| 真机预览 | 开发者工具「预览」扫码 | iOS + Android 真机差异 |
| 真机调试 | 开发者工具「真机调试」 | 性能瓶颈定位 |
| 体验版 | 提交审核前先发「体验版」 | 给 5–10 个微信号体验 |
| 灰度 | 审核通过后「分阶段发布」 | 5% → 20% → 100% |
| 🆕 **Token 过期自动刷新** | 手动篡改 wx.storage 内 JWT 为过期值，重启小程序 | 静默刷新会话，无登出、无报错弹窗 |
| 🆕 **断网增量同步** | 飞行模式修改多条笔记，恢复网络 | 30 秒内完成增量同步，无数据丢失、重复 |
| 🆕 **小程序版本更新** | 后台发新版 → 体验者冷启动 | 弹窗提示「重启应用」，applyUpdate 后 wxml 是新版 |
| 🆕 **切前后台** | 修改笔记 → 切到微信聊天 1 分钟 → 切回 | 5s 内触发一次全量同步（Phase 4.5） |
| 🆕 **网络切换同步** | WiFi↔4G 反复切 10 次 | polling 不断；不丢事件（轮询补齐） |
| 🆕 **弱网超时** | Charles 限速 1KB/s + 触发同步 | 10s 内所有请求 AbortError，不卡死 |

---

## 7. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 主包超 2MB | 高 | 编译失败 | 提前 §3 Phase 5 拆包；用 `webpack-bundle-analyzer` 查体积 |
| supabase Realtime 隐藏调用 | 中 | 启动报 `wxss WebSocket` 错 | grep `realtime` / `subscribe` 全删 |
| wx.storage 配额爆 | 中 | 写入失败 | 监控 `getStorageInfo`；超 8MB 提示用户清回收站 |
| Taro 编译 JSX 边界 case | 中 | 运行时错 | 跑过 `taro build --type weapp --watch`，逐页验 |
| 类目审核被拒 | 中 | 上架延期 | 提前查「笔记」类目准入条件；备「办公」类目 |
| 微信认证失败（个人主体） | 中 | 部分功能受限（不可支付/分享朋友圈） | 注册企业主体（已有「aicyber」可走） |
| `Taro.request` 与 supabase fetch 语义差异 | 中 | headers / body 编码错 | 写一个 supabase-js 集成测试，跑关键 RPC |
| 小程序后台限频（用户日活上来后） | 低 | 高 | 上 Edge Function 做调用聚合；用 Redis 限速 |
| 🆕 沉浸式顶栏（自定义 navigationBar）与现有布局冲突 | 中 | 中 | 统一用默认 navigationBar；个别页面需要时单独配 `navigationStyle: 'custom'` |
| 🆕 锁竖屏后平板用户体验差 | 低 | 中 | 远期考虑平板自适应（`pageOrientation: 'auto'`） |
| 🆕 `wx.getUpdateManager` 异步下载期间用户操作旧版 | 低 | 低 | 弹窗 `onUpdateReady` 时 disable 当前页交互，强制 `applyUpdate` 后重启 |
| 🆕 切网频繁（地铁/电梯）触发 fullSync 风暴 | 中 | 中 | 加防抖：connect 后 3s 内只触发一次 fullSync |

---

## 8. 工作量估算

| 阶段 | v1 估算 | v2 估算 | 增量 |
|---|---|---|---|
| Phase 1 Taro 脚手架 | 1 | 1 | — |
| Phase 2 适配层（storage / supabase / 登录） | 2 | 2 | —（含 `taroFetch` 内部加 timeout） |
| Phase 3 UI 替换 | 2 | 2.5 | +0.5（44rpx 触摸目标 + 首屏 skeleton） |
| Phase 4 同步层改造 | 1.5 | 1.5 | — |
| Phase 4.5 网络监听与重连 | — | 0.25 | +0.25（新增） |
| Phase 5 分包 | 1 | 1 | — |
| Phase 6 业务域名 + 审核 + 版本更新 | 1 | 1.5 | +0.5（`wx.getUpdateManager` 集成） |
| Phase 7 自动化构建脚本 | — | 0.25 | +0.25（新增） |
| Phase 8 运维文档 `mp-maintain.md` | — | 0.5 | +0.5（新增） |
| Edge Function: `wechat-login` | 1 | 1 | — |
| 安全 & 效率验收 | 0.5 | 0.5 | — |
| **合计** | **10–11 人天** | **10.5–12.5 人天 + 审核 1–7 天** | **+0.5–1.5 人天** |

---

## 9. 三平台横向总览（决策辅助）

| 维度 | Web（当前） | Android（Capacitor） | 微信小程序（Taro） |
|---|---|---|---|
| 开发成本 | — | 6.75–7.75 人天（v2） | 10.5–12.5 人天（v2） |
| 用户触达 | 浏览器/链接 | Play Store | 微信生态（12 亿+） |
| 离线能力 | ★★★★★（Dexie） | ★★★★★（同） | ★★★（wx.storage 弱） |
| 实时同步 | ★★★★★（Realtime） | ★★★★★ | ★★★（仅轮询） |
| 性能 | ★★★★ | ★★★（WebView） | ★★★（双线程） |
| 安全可控 | ★★★ | ★★★★（Keystore） | ★★★★（沙箱） |
| 商店审核 | 无 | 严（Google） | 严（微信类目） |
| 热更新 | 部署即更新 | v1.4.x 评估（@capacitor-updater） | **原生 `wx.getUpdateManager`** ✅ |
| 适合 | 主力跨端 | 重度用户 | 微信生态获客 |

**建议顺序**：
1. **先 Android**（v2 6.75–7.75 天，回馈快，技术栈复用高）
2. **后小程序**（v2 10.5–12.5 天，需新建项目并行维护）

如果只能二选一，按「触达 + 商业价值」算，**小程序 > Android**（微信生态用户多）；按「开发效率 + 用户体验」算，**Android > 小程序**。取决于目标用户是「愿意装 App」还是「已经在微信里随手记」。

---

## 10. 不在本次计划内

- 支付宝 / 抖音 / 百度小程序（Taro 同一份代码可输出）
- 小程序云开发（用腾讯 CloudBase 替代 Supabase，**不建议**，会引入数据双写）
- 小游戏版（`@tarojs/taro-game`）
- 鸿蒙 / iOS（Capacitor 一并出）
- 🆕 平板自适应布局（先锁竖屏上线，后续按数据再决定）

---

## 附录 A：v1 → v2 变更日志

来源：Android 计划评审 `plan-android-suggestion.md`（2026-06-20），适配到小程序环境。

### ✅ 采纳（6 项，可直接移植）
1. **Vite `build.target: 'es2020'`** → Taro 编译器自带 ES 降级，**`config/index.ts` 不需额外配置**；在 §3 Phase 1 加注释说明
2. **Supabase `global.fetch` 加 10s 超时** → `Taro.request({ timeout: 10000 })`，§3 Phase 2.2 代码已加
3. **Network 监听器自动重连 Realtime** → 适配为 `Taro.onNetworkStatusChange` 触发 `fullSync`（因 MP 无 Realtime，触发的是 polling），新增 §3 Phase 4.5
4. **锁竖屏** → `app.config.ts` 加 `pageOrientation: 'portrait'`，§3 Phase 1 已加
5. **package.json 构建脚本** → 适配为 Taro：`dev / build / build:test / build:canary / build:prod`，新增 §3 Phase 7
6. **运维文档** → 新增 `docs/mp-maintain.md`（类目、域名白名单、版本发布），§3 Phase 8

### ⚠️ 谨慎采纳（4 项，反馈原版有风险，本版修正后采纳或换实现）
1. **viewport meta**（2.1）→ MP 无 `<meta viewport>` 概念（小程序没有浏览器渲染）；**不适用**，在 §2 硬约束表加一行说明
2. **`cacheControl: 'no-cache'`**（2.3）→ MP 包是首次全量下载到微信客户端，**不要禁缓存**；§5 效率评估加一行说明
3. **`@capacitor-updater` 热更新**（2.6）→ **替换为 MP 原生 `wx.getUpdateManager`**（更安全、零依赖、零成本），新增 §3 Phase 6.4
4. **沉浸式状态栏**（2.3）→ MP 用 `navigationStyle: 'custom'` 替代，**列为风险登记**（§7）但不主动改

### ✅ 移动端通用项采纳（v1 缺，v2 补，3 项）
1. **首屏 skeleton**（替代 splash 概念）→ §3 Phase 3 加代码
2. **88rpx 最小触摸目标**（44px 等价）→ §3 Phase 3 加 CSS
3. **异常测试用例**（Token 过期 / 断网 / 弱网超时 / 切前后台 / 网络切换 / 版本更新）→ §6 加 6 个新场景

### ❌ 不采纳（4 项，MP 不适用或换实现）
1. **READ_MEDIA_IMAGES / WRITE_EXTERNAL_STORAGE** → MP 等价是 `wx.chooseMedia` 等；**YAGNI**，当前不访问媒体
2. **REQUEST_IGNORE_BATTERY_OPTIMIZATIONS** → MP 已有「5s 断 socket」限制，原设计"退后台停 sync"已足够
3. **WebView 调试开关 `webContentsDebuggingEnabled`** → MP 编译产物是 wxml 不是 WebView，不适用
4. **Android Keystore** → MP 用 wx.storage 沙箱（**本身就是 Keystore 级别的隔离**），不需要 SecureStorage 插件

### 📊 净影响
- 安全验收：+3 项（fetch timeout、网络切换、版本更新）
- 效率验收：+2 项（切网同步、弱网超时）
- 工作量：+0.5–1.5 人天（10–11 → 10.5–12.5）
- **热更新方案从"未来评估"变成"v2 已采纳"**（用 wx.getUpdateManager）
