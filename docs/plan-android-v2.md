# 计划：ffnmv 转 Android 应用（Capacitor 6 方案） — **v2**

> **目标**：把现有 React + Vite + Supabase 笔记应用打包成一个 Android 原生 APK / AAB，复用现有 web 资产，最小化代码改动。
> **基线**：`ffnmv v1.3.1`（main 分支，2026-06-20 状态）。
> **v2 修订**：根据外部评审 `plan-android-suggestion.md`（2026-06-20）整合采纳项；详见末尾「附录 A：v1→v2 变更日志」。原版保留在 [`plan-android-v1.md`](./plan-android-v1.md)。
> **读者**：ffnmv 开发者。假设你已经熟悉 `npm run build`、Supabase、Dexie 和当前的部署管线。

---

## 0. 现状速览（来自 src/ 实际结构）

| 维度 | 现状 | Android 影响 |
|---|---|---|
| 框架 | React 18 + Vite 5 | 直接可打包 |
| 路由 | react-router-dom 6 (BrowserRouter) | 改为 `HashRouter` 或 Capacitor 路由；WebView 不需要服务端 fallback |
| 本地存储 | Dexie (IndexedDB) + localStorage | **完全可用**（Android WebView 支持 IndexedDB / localStorage） |
| 状态 | Zustand | 兼容 |
| Supabase | `@supabase/supabase-js` 2.45（fetch + WebSocket Realtime） | 兼容，但需配 `server.androidScheme: 'https'` |
| 同步 | 自写 SyncManager（polling + Realtime + 退避） | 兼容 |
| Auth | 邮箱 + 密码；token 默认存 localStorage | **需迁到 Android Keystore 加密存储**（安全提升） |
| UI | Tailwind + lucide-react | 兼容 |
| 导出 | Blob + `<a download>` | WebView 可用；如需「分享给其他 App」再接 `@capacitor/share` |
| 平台 API | 仅用 `navigator.onLine` / `document.visibilityState` / IndexedDB | 加 `@capacitor/network` + `@capacitor/app` 更准 |

**结论**：技术栈层面零冲突，主要工作是：① 引入 Capacitor 包装；② token 改用 SecureStorage；③ 调 Android 构建配置（签名 / 图标 / 网络白名单 / 启动屏）。

---

## 1. 技术选型与备选

| 方案 | 复用现有代码 | 体验 | 包体积 | 维护成本 | 决定 |
|---|---|---|---|---|---|
| **Capacitor 6 + Android** | ★★★★★（dist 直接塞进 WebView） | 中（WebView 渲染） | ~5–8MB（首版） | 低 | **采用** |
| TWA（Trusted Web Activity） | ★★★★★ | 中 | ~1MB | 极低 | 备选（如果你想最小化，但无法用 Keystore 存 token） |
| React Native 重写 | ★☆☆☆☆ | 高 | ~20MB+ | 极高 | 排除（6+ 周重写） |
| Cordova | ★★★★ | 中 | 同 Capacitor | 中（生态老） | 排除 |
| Tauri 2 + Android | ★★★（需重写 Vite 资产加载） | 高 | 极小 | 中 | 远期可选 |

**选 Capacitor 6 的理由**：
- 官方对 Vite 友好（`webDir: 'dist'`），构建链路几乎不变
- 插件体系覆盖 Supabase 落地所需的全部能力（网络、应用生命周期、安全存储、分享、文件）
- 同一份代码未来可加 iOS（Capacitor 同一套）
- 不引入 Rust / 原生重写

---

## 2. 实施步骤（按天可执行）

### Phase 1 — Capacitor 接入（0.5 天）

```bash
# 1. 安装依赖（锁版本避免兼容性问题）
npm install @capacitor/core@^6 @capacitor/cli@^6 @capacitor/android@^6
npm install @capacitor/app @capacitor/network @capacitor/status-bar \
            @capacitor/splash-screen @capacitor/share @capacitor/filesystem \
            @capacitor/preferences @capacitor/haptics \
            @capacitor/screen-orientation
npm install @capacitor-community/secure-storage

# 2. 初始化（appId 用反向域名，包名会成为 APK id）
npx cap init "ffnmv" "com.aicyber.ffnmv" --web-dir dist
```

**`capacitor.config.ts` 关键项**：

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.aicyber.ffnmv',
  appName: '发法牛',
  webDir: 'dist',
  // 关键：让 Supabase fetch / WebSocket 在 WebView 里走 https
  server: {
    androidScheme: 'https',
    // ⚠️ 不要设 cacheControl: 'no-cache'——会禁用 WebView 对带 hash 文件名资产的缓存，
    // 每次冷启动重下 500KB bundle。Vite 已经给所有资产打 content-hash，
    // 升级时旧 hash 自动失效，无需禁缓存。index.html 可单独处理（见 Phase 4.3）。
  },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#ffffff' },  // launchShowDuration: 0 → 等代码手动 hide
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff',
      overlaysWebView: true,           // 沉浸式；CSS 必须配 env(safe-area-inset-top)
    },
    ScreenOrientation: { orientation: 'portrait' },   // 锁竖屏；需装 @capacitor/screen-orientation
  },
  android: {
    allowMixedContent: false,         // 禁明文
    captureInput: true,
    webContentsDebuggingEnabled: false // release 关掉
  }
}
export default config
```

```bash
# 3. 加 Android 平台
npx cap add android

# 4. 每次 web 构建完同步资产（用 Phase 4.5 的脚本自动化）
npm run build && npx cap sync android
```

### Phase 2 — Vite 适配（0.5 天）

**`vite.config.js` 调整**：

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',                        // ★ 关键：相对路径，否则 APK 内资源 404
  plugins: [react()],
  build: {
    // ★ Android 7.0 WebView 最低支持 es2020，避免 esnext 语法在低端机报语法错
    target: 'es2020',
    assetsDir: 'assets',
    chunkFileNames: 'assets/[name].js',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          dexie: ['dexie'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
})
```

**`index.html` viewport 适配**（Android 触摸规范 + 无障碍）：

```html
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <meta name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes" />
  <!-- ★ 不要设 user-scalable=no：违反 WCAG 1.4.4（视障用户无法放大） -->
  <title>发法牛 v1.3.1 - 轻量化多端同步笔记</title>
</head>
```

**`src/main.jsx` 调整**（splash 等 React 渲染完再 hide + Android 返回键接管 + 沉浸式状态栏 padding）：

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { App as CapApp } from '@capacitor/app'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)

// ★ 渲染完成后才隐藏启动屏，避免冷启动时 WebView 加载 + JS 解析期间的闪白
if (Capacitor.isNativePlatform()) {
  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (!canGoBack) CapApp.exitApp()
    else window.history.back()
  })
  // 沉浸式状态栏：App 根节点要预留顶部安全区
  document.documentElement.style.setProperty(
    '--safe-top',
    'env(safe-area-inset-top, 0px)',
  )
}

// 第一次 React 渲染提交后再 hide splash
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    if (Capacitor.isNativePlatform()) SplashScreen.hide()
  })
})
```

**`src/index.css` 全局最小触摸尺寸**（Material/HIG）：

```css
/* ★ Android 触摸规范：最小 48dp ≈ 44px 物理尺寸 */
@layer base {
  button, a, input, textarea, select, [role="button"] {
    min-height: 44px;
  }
  button, a, [role="button"] {
    min-width: 44px;
  }
}

/* 沉浸式状态栏补白：根容器用 env(safe-area-inset-top) 留出顶部空间 */
body {
  padding-top: var(--safe-top, 0px);
}
```

### Phase 3 — Supabase 安全 & 网络加固（1.5 天，**安全关键**）

**改造点**：① token 改 Keystore；② 全局 fetch 加 10s 超时；③ 网络切换自动重连 Realtime。

```bash
# 已有：@capacitor-community/secure-storage
# 新增：@capacitor/network（已装在 Phase 1）
```

**`src/lib/supabase.js` 改造**：

```js
import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'                 // ★ 路径修正（在 network 包）
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'

const isNative = Capacitor.isNativePlatform()

// ① token 落 Android Keystore（替代 localStorage）
const keystoneStorage = {
  getItem: async (key) => isNative
    ? (await SecureStoragePlugin.get({ key })).value ?? null
    : localStorage.getItem(key),
  setItem: async (key, value) => isNative
    ? SecureStoragePlugin.set({ key, value })
    : localStorage.setItem(key, value),
  removeItem: async (key) => isNative
    ? SecureStoragePlugin.remove({ key })
    : localStorage.removeItem(key),
}

// ② 全局 fetch 包一层 10s 超时，防止弱网/服务器无响应时请求挂死
const fetchWithTimeout = (url, options = {}) =>
  fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10000),
  })

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: keystoneStorage,         // ①
      storageKey: 'ffn-sb-session',
    },
    global: { fetch: fetchWithTimeout },  // ②
  },
)

// ③ 监听网络切换，自动重连 Realtime（断网时主动 disconnect，联网时重连）
if (isNative) {
  Network.addListener('networkStatusChange', (status) => {
    if (status.connected) {
      supabase.realtime.connect()
    } else {
      supabase.realtime.disconnect()
    }
  })
}
```

**迁移策略**（同 v1）：
1. 首次启动时检测 `localStorage` 是否有旧 session
2. 有 → 读出后写入 Keystore，再清掉 localStorage
3. 之后完全走 Keystore
4. 保留 1 个版本（v1.3.x）做迁移，v1.4.0 之后删除迁移代码

### Phase 4 — Android 工程配置（1 天）

#### 4.1 应用 ID / 权限

`android/app/build.gradle`：
```gradle
android {
  namespace "com.aicyber.ffnmv"
  defaultConfig {
    applicationId "com.aicyber.ffnmv"
    minSdkVersion 24        // Android 7.0，覆盖 ~98% 设备
    targetSdkVersion 34
    versionCode 1
    versionName "1.3.1"
  }
  signingConfigs {
    release {
      storeFile file('../keystore/ffnmv-release.keystore')
      storePassword System.getenv("KEYSTORE_PASSWORD")
      keyAlias 'ffnmv'
      keyPassword System.getenv("KEY_PASSWORD")
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
      minifyEnabled true
      shrinkResources true
    }
  }
}
```

`android/app/src/main/AndroidManifest.xml`：
- 显式 `android:allowBackup="false"`（防 adb backup 偷数据）
- `android:usesCleartextTraffic="false"`
- 权限：仅 `INTERNET`
- ⚠️ **不加** `READ_MEDIA_IMAGES` / `WRITE_EXTERNAL_STORAGE` / `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`——YAGNI 且后两者是 Play 审核高危权限

#### 4.2 网络安全配置

`android/app/src/main/res/xml/network_security_config.xml`：
```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <!-- 可选：cert pinning。生产环境强烈建议加（见 §3 安全） -->
  <!--
  <domain-config>
    <domain includeSubdomains="true">ffn.aicyber.chat</domain>
    <pin-set>
      <pin digest="SHA-256">…公钥指纹…</pin>
    </pin-set>
  </domain-config>
  -->
</network-security-config>
```

Manifest 引用：`android:networkSecurityConfig="@xml/network_security_config"`

#### 4.3 资产缓存策略（替代 v1 的 no-cache）

**不要在 `capacitor.config.server.cacheControl` 设 `no-cache`**——会让带 hash 的 chunk 也每次重下，冷启动多 200–400ms。

正确做法：
- Vite 默认给所有资产打 `[name]-[hash].js`（如 `MainApp-Dg7Wz9RE.js`）
- 升级时 `index.html` 引用新 hash，旧的自动无人引用
- WebView 对带 hash 的资产默认长缓存（无过期头时）→ **最优**

需要单独处理的只有 `index.html`：在 `android/app/src/main/assets/public/index.html` 不存在（Vite 输出后会被 `cap sync` 拷贝到 `android/app/src/main/assets/public/index.html`），可以加一个 `nginx`-style 的 meta 标签或用 Capacitor 的 `server.url` 重写。

简化方案：接受 WebView 默认缓存行为。如果未来出现"升级后用户看到旧页面"问题，再考虑：
- `index.html` 加 `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">`
- 或用 Service Worker 拦截 `index.html` 强制 revalidate

#### 4.4 图标 / 启动屏

```bash
npm install -D @capacitor/assets
# 准备 1024x1024 的 icon.png 和 2732x2732 的 splash.png 到 resources/
npx capacitor-assets generate --android
```

### Phase 4.5 — 自动化构建脚本（0.25 天）

**`package.json` 新增脚本**（避免人工漏 sync）：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:test": "vite build --mode test",
    "build:canary": "vite build --mode canary",
    "build:prod": "vite build --mode production",

    "// android": "--- 以下为 v2 新增 android 构建脚本 ---",
    "build:android": "vite build --mode production && npx cap sync android",
    "build:android:test": "vite build --mode test && npx cap sync android",
    "android:bundle": "cd android && ./gradlew bundleRelease",
    "android:apk": "cd android && ./gradlew assembleDebug"
  }
}
```

工作流：
- `npm run build:android:test` → 构建 test bundle + sync Android 工程 → 后续用 `npx cap open android` 在 Android Studio 中 run
- `npm run build:android` + `npm run android:bundle` → 生产 AAB 上架

### Phase 5 — 构建 & 签名（0.5 天）

```bash
# 1. 准备签名（生产密钥务必离线保管，不要进 git）
keytool -genkey -v -keystore android/keystore/ffnmv-release.keystore \
  -alias ffnmv -keyalg RSA -keysize 2048 -validity 10000

# 2. 在 ~/.gradle/gradle.properties 配
KEYSTORE_PASSWORD=...
KEY_PASSWORD=...

# 3. 走脚本出 AAB
npm run build:android && npm run android:bundle
# 产物：android/app/build/outputs/bundle/release/app-release.aab

# 4. 调试 APK
npm run android:apk
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

### Phase 6 — 内部测试 & 上架（1.5–2 天）

1. Google Play Console 建应用（包名 `com.aicyber.ffnmv`，首次上架需 25 美元注册费）
2. 内部测试轨道 → 上传 AAB → 加测试账号邮箱
3. 通过后升「正式版」
4. 准备商店资料：截图（≥2 张）、应用图标、隐私政策链接（**必填**，因为有账号系统 + 笔记内容）、应用分类「效率」

---

## 3. 安全性评估 + 执行步骤

> 三平台横向对比：当前 web（基线）/ Android（目标）/ 微信小程序（见 `plan-wechat-miniprogram.md`）。

| 风险 | Web 当前 | Android 风险 | 执行步骤 |
|---|---|---|---|
| **Token 落 localStorage** | 高 | 迁移到 Keystore | Phase 3 ① |
| **APK 内 anon key 可见** | 可接受 | 同（Supabase 设计如此） | 无需改，anon key 配合 RLS 仍是安全的 |
| **WebView 文件访问** | n/a | 默认允许 `file://` 时可读 APK 资源 | `capacitor.config` 设 `allowMixedContent: false`；不引入 `CapacitorCookies` 之外的本地文件访问 |
| **adb backup 偷数据** | n/a | 默认 allowBackup=true | AndroidManifest 显式 `allowBackup="false"` |
| **cleartext HTTP** | 已禁（nginx 强制 https） | 需双保险 | Manifest `usesCleartextTraffic="false"` + network_security_config |
| **第三方键盘 / 录屏** | n/a | 笔记内容可能被录 | 可选：Phase 7 加 `FLAG_SECURE`（防截屏） |
| **Root 设备** | n/a | Keystore 在 root 设备上可被绕 | 选做：加 root 检测（`@capacitor-community/safety-net`），检测到 root 提示风险而非阻断 |
| **WSS / TLS 降级** | 受 Supabase CDN | 同 | 选做：cert pinning（见 4.2） |
| **JS 注入 / XSS** | 无 `dangerouslySetInnerHTML`，内容全文本 | 风险增加 | 保持现状；CSP 头通过 nginx 注入 |
| **设备丢失** | 浏览器登录态靠 Supabase TTL | token 在 Keystore，其他 App 拿不到 | 应用启动可加可选 PIN / 生物锁（`@capacitor-community/biometric`） |
| **网络异常请求挂死** | n/a | 弱网/服务器无响应时 fetch 不超时 | Phase 3 ②：10s AbortSignal.timeout |
| **Realtime 切网不重连** | n/a | 切 4G/WiFi 后 supabase realtime 不知道要重连 | Phase 3 ③：Network 监听 connect/disconnect |

**安全验收 checklist**：
- [ ] Token 完全脱离 localStorage（`adb shell run-as com.aicyber.ffnmv cat shared_prefs/` 拿不到）
- [ ] release APK 关闭 `webContentsDebuggingEnabled`（Chrome `chrome://inspect` 看不到 WebView）
- [ ] ProGuard / R8 已开（`minifyEnabled true`），APK 中类名混淆
- [ ] `allowBackup="false"` 验证：`adb backup` 拿不出数据
- [ ] cleartext 拒绝：用 `curl http://ffn.aicyber.chat` 在 App 内被拦
- [ ] RLS 不变：Supabase 侧 anon key 仍走 RLS（已是生产配置）
- [ ] 弱网/断网请求 10s 内必返回超时
- [ ] 网络切换飞行模式 5 次后，Realtime 仍能自动重连

---

## 4. 效率评估 + 执行步骤

| 指标 | Web 现状 | Android 目标 | 执行步骤 |
|---|---|---|---|
| 首屏 JS 体积 | 211KB (supabase) + 162KB (react) + 96KB (dexie) + 31KB (index) ≈ **500KB gzip ~180KB** | APK 启动多 100–300ms WebView 冷启 | 启动屏（splash 等 React 渲染完再 hide，Phase 2） |
| 列表渲染 | `useVirtualizer` 1000 条顺滑 | 同 WebView 性能 | 无需改；可加 `overscan: 3`（省电） |
| 同步频率 | 自适应 60s–300s | 同 | 移动端后台时 `App.addListener('appStateChange')` → 退到后台立即暂停轮询（已有 `visibilitychange`） |
| 内存 | 浏览器 Tab ~150MB | WebView 类似，Android 杀进程阈值更早 | 切到后台时清掉 Editor 草稿（已自动）；路由走 `React.lazy` 减少常驻 |
| APK 体积 | n/a | 基线 ~6–8MB | 启用 `shrinkResources true` + R8 混淆；按需 `splits { abi { enable true } }` 出 4 个 ABI（armv7/arm64/x86/x64），用户下 ~2MB |
| 网络 | HTTP/2 (nginx) | 同 | `@capacitor/network` 检测网络类型；WiFi 推全量，移动数据只推 50 条/批（修改 `syncManager.js` 的 `batchSize`） |
| 启动到可交互 | ~1.2s（无缓存） | +300ms WebView 冷启 ≈ 1.5s | 启动时立即 `localStorage.getItem('ffn-cached-notes')` → Dexie 已存 → 首屏直出 |
| 后台被杀恢复 | n/a | Android Low Memory Killer | 监听 `appStateChange`，从后台回到前台立即 `syncManager.fullSync()` |
| 电量 | n/a | WebView 持续 poll 耗电 | 后台 pause 轮询（AppState），realtime WebSocket 保留（事件少） |
| **目标**：资产缓存 | 浏览器长缓存 | WebView 不应每次重下带 hash 的 bundle | **不要设 `cacheControl: no-cache`**（见 Phase 4.3） |

**效率验收 checklist**：
- [ ] release APK ≤ 8MB（arm64-v8a 单 ABI）
- [ ] 冷启到首屏 ≤ 1.8s（中端机：骁龙 7 系）
- [ ] 1000 条笔记列表滚动 60fps（DevTools Performance / Android Studio Profiler）
- [ ] 后台 5 分钟后回前台，30s 内完成一次全量同步
- [ ] 4G 移动数据下，100 条笔记 push ≤ 8s
- [ ] 升级 APK 后首启无旧页面残留（Vite content-hash 自动生效）

---

## 5. 测试计划

| 阶段 | 工具 | 重点 |
|---|---|---|
| 单元 | 现有 vitest | 改 storage adapter 后跑 `useAuthStore` / syncManager 测试（注入 fake SecureStorage） |
| WebView 集成 | Android Studio Emulator + Chrome `chrome://inspect` | 调试 H5 层 |
| 真机 | 至少 3 台：Android 7 / 11 / 14 | 系统 WebView 版本差异 |
| 同步边界 | 飞行模式切换 50 次 | 验退避 + 增量恢复 |
| 登录态保留 | kill app / 重启 / 清后台 | Keystore 持久化 |
| 包大小 | `apkanalyzer` / Play Console pre-launch | 体积 + 启动报告 |
| 隐私 | Play Data safety form | 「账号 / 笔记内容 / 设备 ID」三类收集的披露 |
| **🆕 Token 过期自动刷新** | 手动篡改 Keystore 内 JWT 为过期值，重启 App | 静默刷新会话，无登出、无报错弹窗 |
| **🆕 断网增量同步** | 飞行模式修改多条笔记，恢复网络 | 30 秒内完成增量同步，无数据丢失、重复 |
| **🆕 版本升级数据迁移** | 安装旧版写入笔记、登录，升级新版 APK | Dexie 本地笔记、Keystore 登录态完整保留 |
| **🆕 低内存后台回收** | 多应用占用内存触发系统杀进程 | 返回 App 自动同步，无需重新登录 |
| **🆕 网络切换 Realtime** | WiFi ↔ 4G 反复切 10 次 | Realtime 不断；upsert 事件不丢 |
| **🆕 弱网超时** | Charles 限速 1KB/s + 触发同步 | 10s 内所有请求 AbortError，不卡死 |

---

## 6. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Capacitor 6 与 AGP 8 / Gradle 8 兼容坑 | 中 | 中 | 锁版本 `capacitor 6.1.x` + Gradle 8.7；遇坑回退到 Capacitor 5 |
| Supabase Realtime 在 WebView 后台被掐 | 中 | 中 | 退前台触发 fullSync；可接受偶发延迟 |
| 腾讯云 Lighthouse 反代对 APK 内嵌 `ffn.aicyber.chat` 的 HSTS / TLS 协商失败 | 低 | 高 | 预 release 在 3 家厂商机（华米 ov）跑网络连测 |
| Play Store 审核因「账号系统」被要求隐私合规材料 | 中 | 中 | 提前准备隐私政策页（可挂 `ffn.aicyber.chat/privacy`）+ 数据安全说明 |
| Keystore 丢失 | 低 | 灾难 | 密钥用 1Password 团队库 + 异地备份，文档化恢复流程（见 `docs/android-maintain.md`） |
| `build.target: 'es2020'` 与某些 npm 包不兼容 | 低 | 低 | 锁死 Vite + 关键 lib 版本；CI 跑 build 验证 |
| 🆕 沉浸式状态栏与现有布局冲突 | 中 | 中 | 全局 padding-top + 关键页（Login/Settings）单独调 |
| 🆕 锁竖屏后平板用户体验差 | 低 | 中 | 远期考虑平板自适应（`@capacitor/screen-orientation` 也支持 lock-unlock） |

---

## 7. 工作量估算

| 阶段 | v1 估算 | v2 估算 | 增量 |
|---|---|---|---|
| Phase 1 Capacitor 接入 | 0.5 | 0.5 | — |
| Phase 2 Vite 适配 | 0.5 | 1.0 | +0.5（viewport、splash 渲染后 hide、44px 触摸、safe-area CSS） |
| Phase 3 Supabase 安全 & 网络 | 1.0 | 1.5 | +0.5（fetch timeout、Network 监听） |
| Phase 4 Android 工程配置 | 1.0 | 1.0 | — |
| Phase 4.5 自动化构建脚本 | — | 0.25 | +0.25（新增） |
| Phase 5 构建 & 签名 | 0.5 | 0.5 | — |
| Phase 6 测试 & 上架 | 1.0–2.0 | 1.5–2.0 | +0.5（4 个新测试场景） |
| 安全 & 效率验收 | 0.5 | 0.5 | — |
| 运维文档 `android-maintain.md` | — | 0.5 | +0.5（新增） |
| **合计** | **5–6 人天** | **6.75–7.75 人天** | **+1.5–2 人天** |

---

## 8. 后续路线（不在本次计划内）

- **iOS**：Capacitor 加 `npx cap add ios` + Apple Developer 账号（$99/年）
- **离线优先**：考虑迁移到 PowerSync（替代自写 SyncManager）
- **App Widget**：Android 桌面快速记录入口
- **推送**：FCM（Supabase Edge Function 触发）
- **🆕 热更新应急**：`@capacitor-updater` —— 推迟到 v1.4.x 评估。Play Store 政策严格（"核心功能"不能热更），需配 CDN + 签名 + 回滚机制，估 +3 人天
- **🆕 平板自适应**：移除竖屏锁，做 tablet 布局
- **🆕 防截屏**：在 `MainActivity.onCreate` 加 `getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE)`

---

## 附录 A：v1 → v2 变更日志

来源：外部评审 `plan-android-suggestion.md`（2026-06-20）

### ✅ 采纳（10 项）
1. Vite `build.target: 'es2020'` —— 解决低端 WebView 语法兼容
2. Supabase `global.fetch` 加 `AbortSignal.timeout(10000)` —— 弱网请求不卡死
3. `Network.addListener('networkStatusChange')` 自动重连 Realtime
4. `StatusBar.overlaysWebView: true` + CSS `env(safe-area-inset-top)` —— 沉浸式
5. `ScreenOrientation` 锁竖屏 —— 笔记 App 横屏无意义
6. `package.json` 加 4 个 android 构建脚本 —— 自动化杜绝漏 sync
7. 4 个异常测试用例（Token 过期 / 断网 / 升级 / 低内存回收）
8. 启动屏等 React 渲染完再 hide —— 消除冷启动闪白
9. 全局 44px 最小触摸目标 —— 移动端规范
10. 写 `docs/android-maintain.md` 运维文档

### ⚠️ 谨慎采纳（3 项，反馈原版有风险，本版修正后采纳）
1. **viewport meta**（2.1）：原建议 `user-scalable=no` 违反 WCAG 无障碍，**改为 `user-scalable=yes, maximum-scale=5.0`**
2. **资产缓存策略**（2.3）：原建议 `cacheControl: 'no-cache'` 会拖慢冷启动，**改为：Vite content-hash 自然失效 + 不设 cacheControl**
3. **@capacitor-updater 热更新**（2.6）：原建议直接引入，**改为：推迟到 v1.4.x 评估**（Play Store 政策风险 + 估 +3 人天）

### ❌ 不采纳（4 项）
1. **READ_MEDIA_IMAGES 权限**（2.3）：YAGNI——当前 app 不读媒体
2. **WRITE_EXTERNAL_STORAGE 权限**（2.3）：YAGNI——导出走 WebView Blob
3. **REQUEST_IGNORE_BATTERY_OPTIMIZATIONS**（2.3）：Play 审核高危权限，原设计"退后台停 sync"已足够
4. **manualChunks 重组**（2.1）：现有 4 块（react/supabase/dexie/icons）合理，重组无收益

### 🔧 反馈原文的小 bug（本版已修正）
- 2.2 `import { Capacitor, Network } from '@capacitor/core'` 路径错——`Network` 在 `@capacitor/network` 包
- 2.3 `ScreenOrientation` 需先 `npm install @capacitor/screen-orientation`
- 2.6 `@capacitor-updater` 还需配 `capacitor.config.ts` 的 `plugins.LiveUpdates`

### 📊 净影响
- 安全验收：+2 项（fetch timeout、Realtime 重连）
- 效率验收：+1 项（不设 no-cache 反而让冷启动变快）
- 工作量：+1.5–2 人天（5–6 → 6.75–7.75）
