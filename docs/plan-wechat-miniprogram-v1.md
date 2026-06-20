# 计划：ffnmv 转微信小程序（Taro 4 方案）

> **目标**：把现有 React + Vite + Supabase 笔记应用编译成可在微信内运行的微信小程序，触达微信生态用户。
> **基线**：`ffnmv v1.3.1`（main 分支，2026-06-20 状态）。
> **读者**：ffnmv 开发者。**重要前提**：微信小程序 ≠ 浏览器 webview，技术约束差异巨大，请先读完 §1 决策与 §2 限制再排期。

---

## 0. 一句话总结

**用 Taro 4 重写前端（React 语法保留），后端 Supabase 不动；前端需要替换：Dexie → wx.storage 适配层、react-router → @tarojs/router、lucide-react → iconfont、Supabase Realtime → 降级为 HTTP 轮询；预计 10–14 人天；上线需 ICP + 类目审核。**

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
| WebSocket API 不同 | Supabase Realtime | `new WebSocket()` 在小程序不直接可用 | 用 `Taro.connectSocket`，写 supabase-js 适配层；或**退化为 HTTP 轮询**（推荐，详见 §4.2） |
| 主包 ≤ 2MB | 整包 668KB，未压缩 ~2MB+ | 必须分包 | §5 拆 subpackages |
| 总体 ≤ 20MB | n/a | 安全 | 图片/资源用 CDN |
| 需 ICP 备案 + 类目审核 | n/a | 业务域 `ffn.aicyber.chat` 已备案（推断） | 申请类目「效率 → 笔记」或「工具 → 办公」 |
| 登录方式受限 | 邮箱密码 | 小程序没有「邮箱密码」表单惯例 | **改为：微信一键登录 + Supabase 邮箱 OTP 兜底**（详见 §3.3） |
| 无 `<input type="file">` | JSON 导入 | 改用 `Taro.chooseMessageFile` |
| 无 `URL.createObjectURL` | 导出预览 | 改用 `Taro.downloadFile` + `Taro.openDocument` 或上传到临时云存储 |
| 后台限制 | n/a | 小程序后台 5s 断 socket | 退后台即停同步；回前台补全 |

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
│   │   ├── supabase.ts          # 见 §3.2
│   │   ├── storage.ts           # 见 §3.1
│   │   └── syncManager.ts       # 改 Realtime → poll
│   └── hooks/
│       └── useVirtualList.ts    # 用 @tarojs/virtual-list 替代
└── project.config.json
```

**`app.config.ts`**：
```ts
export default defineAppConfig({
  pages: ['pages/login/index', 'pages/index/index', 'pages/trash/index', 'pages/settings/index'],
  window: {
    navigationBarTitleText: '发法牛',
    navigationBarBackgroundColor: '#ffffff',
    backgroundColor: '#f5f5f5',
  },
  // 注意：subpackages 必须在分包就位后才能填（见 §5）
  subpackages: [],
  requiredPrivateInfos: [],   // 用到 wx.getLocation / chooseLocation 才需要
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

#### 3.2 `src/lib/supabase.ts`（HTTP 适配 + 移除 Realtime）

```ts
import { createClient } from '@supabase/supabase-js'
import Taro from '@tarojs/taro'
import { storage } from './storage'

// 关键：supabase-js 在小程序里 fetch 走得通，但要禁用 WebSocket Realtime
// 用自定义 fetch 走 Taro.request（自动处理业务域名白名单）
const taroFetch: typeof fetch = async (url, init) => {
  const res = await Taro.request({
    url: String(url),
    method: (init?.method as any) || 'GET',
    data: init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : undefined,
    header: init?.headers as any,
    // timeout: 30000,
  })
  return new Response(JSON.stringify(res.data), {
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
  itemSize={64}            // 固定行高
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
# config/index.js:
plugins: ['taro-plugin-tailwindcss']
```

### Phase 4 — 同步层改造（1.5 天）

把 `syncManager.js` 复制过来，改两处：

```ts
// 1. Realtime 不可用，删除 setupRealtime() 调用
// 2. 轮询频率移动端调密
this.minPollInterval = 30000      // 30s（web 是 60s）
this.maxPollInterval = 180000     // 3min

// 3. 加 appStateChange 监听（Taro 提供）
Taro.onAppShow(() => this.fullSync())
Taro.onAppHide(() => this._pausePolling())
```

**事件总线** `window.dispatchEvent` 在小程序里不能直接用，改 `Taro.eventCenter`：
```ts
Taro.eventCenter.on('data-updated', this._onDataUpdated)
```

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

### Phase 6 — 配置业务域名 + 上传审核（1–3 天等待）

1. 微信公众平台 → 开发管理 → 开发设置 → 服务器域名：
   - request 合法域名：`https://ffn.aicyber.chat`、`https://supabase.aicyber.chat`（生产 supabase 实例的域名）
   - uploadFile / downloadFile 同上
   - **前提**：`ffn.aicyber.chat` 已 ICP 备案；SSL 已是正式证书（ZeroSSL 即可）
2. 微信公众平台 → 设置 → 基本设置 → 微信认证（300 元/年，个人主体不可用支付/部分类目）
3. 类目选择：效率 → 笔记（需要「笔记类目」资质）或 工具 → 办公
4. 提交审核：填应用名称、简介、图标、截图（5 张 1284×2778）、隐私政策
5. 审核 1–7 天

---

## 4. 安全性评估 + 执行步骤

> 对比：web（基线）/ Android（见另一份计划）/ 微信小程序（本节）

| 风险 | Web | 小程序 | 步骤 |
|---|---|---|---|
| **Token 落 wx.storage** | localStorage | wx.storage（沙箱内，**不加密**） | 用 `@tarojs/taro` 的 `setStorageSync` 配合 Supabase JWT 短 TTL（默认 1h）+ autoRefresh；可接受；高敏场景用 `Taro.setStorage` 的加密接口（小程序基础库 2.21+ 提供 `setStorage` 加密选项） |
| **匿名 key 在小程序包里** | 可接受 | 同 | 无需改，Supabase 设计如此 |
| **业务域名白名单** | n/a | **必须配**，否则请求被微信拦截 | §3 Phase 6 |
| **wx.login code 泄露** | n/a | code 5 分钟内有效 | 直接发到自建 Edge Function；不上日志 |
| **中间人** | TLS + Cert | TLS（微信强制） | 配 Cert Pinning（`@tarojs/taro` 暂未提供，需自实现 `request` 拦截） |
| **XSS** | 全文本 | 全文本 | 保持现状；小程序 wxml 也不能用 `dangerouslySetInnerHTML`，用 `<Text>{content}</Text>` 转义 |
| **小程序代码被反编译** | n/a | 微信上传代码会做混淆，但**仍可还原逻辑** | 关键逻辑（如果未来有）放 Edge Function；前端只放展示 |
| **黑产刷登录** | n/a | 调 Edge Function 频率限制 | Edge Function 端：按 IP+code 限速（10/min）；用 `WX_AUTH_CODE_CACHE` 短 TTL 缓存 |
| **设备丢失** | 浏览器登录态 | wx.storage 与微信号绑 | token 失效 = 重新 wx.login 即可，无需做生物锁 |
| **类目审核不过** | n/a | 「账号 + 云存储 + 笔记」可能被打回 | 提前看类目准入要求；准备 ICP 截图、隐私协议 URL |

**安全验收 checklist**：
- [ ] Edge Function `wechat-login` 限速 + 日志无敏感字段
- [ ] 小程序代码扫描无 hard-coded secret
- [ ] RLS 在 Supabase 端不变
- [ ] `Taro.getStorageInfoSync()` 检查：单 key < 1MB；总数 < 8MB

---

## 5. 效率评估 + 执行步骤

| 指标 | Web | 小程序 | 步骤 |
|---|---|---|---|
| 首屏 JS 体积 | ~500KB（gzip 180KB） | 主包限 2MB | 分包；iconfont 替代 lucide；supabase tree-shake；最终主包 < 1.5MB |
| 启动耗时 | ~1.2s | ~1.5s（小程序框架启动 + 首屏渲染） | `lazyCodeLoading: 'requiredComponents'`；首页用 skeleton |
| 列表 1000 条滚动 | 60fps (useVirtualizer) | 60fps (`@tarojs/virtual-list`) | 固定行高 64rpx；overscan 3 |
| 同步频率 | 60s–300s + Realtime | 30s–180s 轮询（**无 Realtime**） | 退后台即停；前台立即补一次；用户手动刷新按钮 |
| 存储读写 | IndexedDB 快 | wx.storage 同步 API（~ms 级） | 大量数据全表加载 + 内存索引；避免循环 `setStorage` |
| 后台限制 | n/a | 5s 后断 socket，但**无 socket 也无所谓**（我们没 Realtime） | 退后台：`fullSync` 取消；回前台：再 `fullSync` |
| 网络 | HTTP/2 | 微信代理（HTTP/1.1） | 无优化空间；接口尽量合批 |
| 电量 | n/a | 轮询耗电比 Realtime 多 | 把 `minPollInterval` 调到 45s；非充电状态降频 |
| 包体积 | n/a | 主包 + 分包总计 ≤ 20MB | 资源走 CDN（`ffn.aicyber.chat/static/...`） |

**效率验收 checklist**：
- [ ] `taro build --type weapp` 主包 < 1.5MB
- [ ] iPhone 8 / 华为 P30 等老设备首屏 ≤ 2.5s
- [ ] 1000 条笔记滚动稳定 60fps（微信开发者工具 Performance 面板）
- [ ] 100 条笔记 push 在 4G 下 ≤ 10s
- [ ] 退后台 30s 回前台，5s 内完成一次同步

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

---

## 7. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 主包超 2MB | 高 | 编译失败 | 提前 §5 拆包；用 `webpack-bundle-analyzer` 查体积 |
| supabase Realtime 隐藏调用 | 中 | 启动报 `wxss WebSocket` 错 | grep `realtime` / `subscribe` 全删 |
| wx.storage 配额爆 | 中 | 写入失败 | 监控 `getStorageInfo`；超 8MB 提示用户清回收站 |
| Taro 编译 JSX 边界 case | 中 | 运行时错 | 跑过 `taro build --type weapp --watch`，逐页验 |
| 类目审核被拒 | 中 | 上架延期 | 提前查「笔记」类目准入条件；备「办公」类目 |
| 微信认证失败（个人主体） | 中 | 部分功能受限（不可支付/分享朋友圈） | 注册企业主体（已有「aicyber」可走） |
| `Taro.request` 与 supabase fetch 语义差异 | 中 | headers / body 编码错 | 写一个 supabase-js 集成测试，跑关键 RPC |
| 小程序后台限频（用户日活上来后） | 低 | 高 | 上 Edge Function 做调用聚合；用 Redis 限速 |

---

## 8. 工作量估算

| 阶段 | 人天 |
|---|---|
| Phase 1 Taro 脚手架 | 1 |
| Phase 2 适配层（storage / supabase / 登录） | 2 |
| Phase 3 UI 替换 | 2 |
| Phase 4 同步层改造 | 1.5 |
| Phase 5 分包 | 1 |
| Phase 6 业务域名 + 审核 | 1（不含等待） |
| Edge Function: `wechat-login` | 1 |
| 安全 & 效率验收 | 0.5 |
| **合计** | **10–11 人天 + 审核 1–7 天** |

---

## 9. 三平台横向总览（决策辅助）

| 维度 | Web（当前） | Android（Capacitor） | 微信小程序（Taro） |
|---|---|---|---|
| 开发成本 | — | 5–6 人天 | 10–11 人天 |
| 用户触达 | 浏览器/链接 | Play Store | 微信生态（12 亿+） |
| 离线能力 | ★★★★★（Dexie） | ★★★★★（同） | ★★★（wx.storage 弱） |
| 实时同步 | ★★★★★（Realtime） | ★★★★★ | ★★★（仅轮询） |
| 性能 | ★★★★ | ★★★（WebView） | ★★★（双线程） |
| 安全可控 | ★★★ | ★★★★（Keystore） | ★★★★（沙箱） |
| 商店审核 | 无 | 严（Google） | 严（微信类目） |
| 适合 | 主力跨端 | 重度用户 | 微信生态获客 |

**建议顺序**：
1. **先 Android**（5–6 天，回馈快，技术栈复用高）
2. **后小程序**（10–11 天，需新建项目并行维护）

如果只能二选一，按「触达 + 商业价值」算，**小程序 > Android**（微信生态用户多）；按「开发效率 + 用户体验」算，**Android > 小程序**。取决于目标用户是「愿意装 App」还是「已经在微信里随手记」。

---

## 10. 不在本次计划内

- 支付宝 / 抖音 / 百度小程序（Taro 同一份代码可输出）
- 小程序云开发（用腾讯 CloudBase 替代 Supabase，**不建议**，会引入数据双写）
- 小游戏版（`@tarojs/taro-game`）
- 鸿蒙 / iOS（Capacitor 一并出）
