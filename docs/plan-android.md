# 计划：ffnmv 转 Android 应用（Capacitor 6 方案） — **v3**

> **目标**：把现有 React + Vite + Supabase 笔记应用打包成一个 Android 原生 APK / AAB，复用现有 web 资产，最小化代码改动。
> **基线**：`ffnmv v1.3.1`（main 分支，2026-06-20 状态）。
> **v3 修订**：在 v2 基础上整合第二批紧急必要优化（8 项，全部"必改"级）。详见末尾「附录 A：v1→v2 变更日志」+「附录 B：v2→v3 变更日志」。原版保留在 [`plan-android-v1.md`](./plan-android-v1.md) 和 [`plan-android-v2.md`](./plan-android-v2.md)。
> **读者**：ffnmv 开发者。假设你已经熟悉 `npm run build`、Supabase、Dexie 和当前的部署管线。

---

## 0. 现状速览（来自 src/ 实际结构）

| 维度 | 现状 | Android 影响 |
|---|---|---|
| 框架 | React 18 + Vite 5 | 直接可打包 |
| 路由 | react-router-dom 6 (**BrowserRouter** — HTML5 history API) | **🆕 v3 必改：WebView 内 history API 行为异常，外部链接回退 / 直开 deep link 全部 404；改用平台条件路由（见 §2 Phase 2.1）** |
| 本地存储 | Dexie (IndexedDB) + localStorage | 完全可用（Android WebView 支持 IndexedDB / localStorage） |
| 状态 | Zustand | 兼容 |
| Supabase | `@supabase/supabase-js` 2.45（fetch + WebSocket Realtime） | 兼容，但需配 `server.androidScheme: 'https'` |
| 同步 | 自写 SyncManager（polling + Realtime + 退避） | 兼容 |
| Auth | 邮箱 + 密码；token 默认存 localStorage | 需迁到 Android Keystore 加密存储（安全提升） |
| **🆕 登出清理** | 仅 `supabase.auth.signOut()` + Zustand reset | **v3 必改：Dexie / deviceId / legacy marker 全部残留，多账号切换有隐私合规风险**（见 §2 Phase 3.5） |
| **🆕 网络异常兜底** | 仅 `navigator.onLine` + 同步层感知 | **v3 必改：首次打开无网络时页面空白卡死**（见 §2 Phase 4.6） |
| **🆕 单元测试 mock** | 测试计划提"注入 fake SecureStorage"但**无具体 mock 实现** | **v3 必改：补 `src/test/fakes/secureStorage.js`**（见 §2 Phase 5.5） |
| **🆕 CI/CD** | 全手动本地构建 | **v3 必改：加 GitHub Actions 自动化 lint + test + build 校验**（见 §2 Phase 9） |
| **🆕 .gitignore / .env.example** | .env 已 gitignore；**缺 .env.example**、**缺 android/keystore 规则** | **v3 必改：补 .gitignore + .env.example**（见 §2 Phase 1.5） |
| **🆕 签名密钥 / 回滚 SOP** | 计划里有"运维文档"占位 | **v3 必改：写出完整 SOP**（见附录 C） |
| **🆕 Google Play Data Safety** | 仅提"隐私政策链接" | **v3 必改：补完整 Data Safety 申报模板**（见附录 D） |
| UI | Tailwind + lucide-react | 兼容 |
| 导出 | Blob + `<a download>` | WebView 可用；如需「分享给其他 App」再接 `@capacitor/share` |
| 平台 API | 仅用 `navigator.onLine` / `document.visibilityState` / IndexedDB | 加 `@capacitor/network` + `@capacitor/app` 更准 |

**结论**：技术栈层面零冲突，主要工作是：① 引入 Capacitor 包装；② token 改用 SecureStorage；③ 调 Android 构建配置（签名 / 图标 / 网络白名单 / 启动屏）；④ **🆕 修复 8 个运行/合规/CI 漏洞**（v3 全部纳入）。

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

### Phase 1.5 — 🆕 v3 必改：环境变量与 .gitignore 规范（0.25 天）

**问题诊断**：
- 当前 `.gitignore` 已包含 `.env / .env.local / .env.*.local / .env.production / .env.test / .env.canary`，anon key **不会**误提交
- 但缺两件事：① **没有 `.env.example` 模板**，新人 onboarding 不知道要配哪些变量；② **没有 android keystore 规则**，未来生成 `ffnmv-release.keystore` 时可能误提交

**`.gitignore` 补充**：

```gitignore
# 已有（节选）
.env
.env.local
.env.*.local
.env.production
.env.test
.env.canary

# 🆕 v3 新增：android 签名密钥
android/keystore/
*.keystore
*.jks
key.properties
android/app/build/
android/build/
android/.gradle/
android/local.properties
android/capacitor-cordova-android-plugins/
```

**新增 `.env.example`**（**提交到仓库**，作为模板）：

```bash
# 复制为 .env.local / .env.test / .env.canary / .env.production 后填入实际值
# Supabase 项目的 URL 和 anon key 公开安全（anon key 配合 RLS 工作）
# anon key 见你的 Supabase Dashboard → Settings → API → Project API keys → anon public
# 不同环境用不同的项目（test/canary/prod 各自的 Supabase 实例）

VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...  # 仅填 anon public，**绝不**填 service_role
```

**验收**：
- `git check-ignore -v android/keystore/ffnmv-release.keystore` → 命中规则
- `git status` 在 `android/keystore/` 出现新文件时**不应** untracked 提示

### Phase 2 — Vite 适配 + 🆕 平台条件路由（1 天）

**`vite.config.js` 调整**：

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',                        // ★ 关键：相对路径，否则 APK 内资源 404
  plugins: [react()],
  build: {
    target: 'es2020',                // Android 7.0 WebView 最低
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
  <title>发法牛 v1.3.1 - 轻量化多端同步笔记</title>
</head>
```

#### 2.1 🆕 v3 必改：平台条件路由（修复 WebView 路由丢失）

**问题**：`BrowserRouter` 用 HTML5 history API（`pushState/replaceState/popstate`），在 Android WebView 里：
- 用户点击微信/邮件里的 `https://ffn.aicyber.chat/notes/123` → WebView 拦截到本地 → `pushState` 改 URL → **真实 URL 不变** → 刷新或外部唤起时丢失
- OAuth 回调 / deep link 找不到路径 → 白屏
- Android 物理返回键 `App.backButton` 触发 `window.history.back()` 时，与 `BrowserRouter` 内部 history 状态机不一致

**修复**：

```jsx
// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'   // 🆕 加 HashRouter
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { App as CapApp } from '@capacitor/app'
import App from './App'
import { OfflineBoundary } from './components/OfflineBoundary' // 🆕 v3
import './index.css'

// 🆕 v3 关键：原生平台用 HashRouter（URL 走 #/notes/123 形式，刷新/外部唤起均稳定）
const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(
  <Router>
    <OfflineBoundary>
      <App />
    </OfflineBoundary>
  </Router>,
)

if (Capacitor.isNativePlatform()) {
  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (!canGoBack) CapApp.exitApp()
    else window.history.back()
  })
  document.documentElement.style.setProperty('--safe-top', 'env(safe-area-inset-top, 0px)')
}

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    if (Capacitor.isNativePlatform()) SplashScreen.hide()
  })
})
```

**注意**：
- `HashRouter` 的 URL 会变成 `https://ffn.aicyber.chat/#/notes/123` —— **只在原生平台**，web 端保持 `BrowserRouter` 不变
- 现有 `<Link to="/trash">` 不用改，react-router 内部兼容
- 内部导航 API（`useNavigate` / `useParams`）零差异

**`src/index.css` 全局最小触摸尺寸**：

```css
@layer base {
  button, a, input, textarea, select, [role="button"] {
    min-height: 44px;
  }
  button, a, [role="button"] {
    min-width: 44px;
  }
}
body {
  padding-top: var(--safe-top, 0px);
}
```

### Phase 3 — Supabase 安全 & 网络加固（1.5 天，**安全关键**）

```js
// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'
import { storage } from './storage'                // 🆕 v3：跨平台 storage 抽象
import { secureStorageAdapter } from './secureStorageAdapter' // 🆕 v3

const isNative = Capacitor.isNativePlatform()

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: isNative ? secureStorageAdapter : storage,  // 🆕 v3：原生用 Keystore
      storageKey: 'ffn-sb-session',
    },
    global: { fetch: (url, options = {}) =>
      fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(10000) })
    },
  },
)

if (isNative) {
  Network.addListener('networkStatusChange', (status) => {
    if (status.connected) supabase.realtime.connect()
    else supabase.realtime.disconnect()
  })
}
```

**`src/lib/secureStorageAdapter.js`（🆕 v3 新增）**：

```js
// 把 @capacitor-community/secure-storage-plugin 包成 supabase-js storage 接口
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'

export const secureStorageAdapter = {
  getItem: async (key) => {
    try { return (await SecureStoragePlugin.get({ key })).value ?? null }
    catch { return null }
  },
  setItem: async (key, value) => {
    await SecureStoragePlugin.set({ key, value })
  },
  removeItem: async (key) => {
    try { await SecureStoragePlugin.remove({ key }) }
    catch { /* key 不存在时 remove 抛错，吞掉 */ }
  },
}
```

### Phase 3.5 — 🆕 v3 必改：登出全量本地清理（0.5 天，**合规关键**）

**问题**：当前 `supabase.auth.signOut()` 只清 supabase session；Dexie 里的笔记/标签/conflicts、`localStorage` 里的 deviceId / legacy marker、sync_metadata **全部残留**。多账号切换或设备移交时，**前一个用户的数据本地可读**，违反 GDPR / 个保法。

**新增 `src/lib/auth.js` 的 `purgeAllLocalData()`**：

```js
// src/lib/auth.js
import { db } from './db'
import { supabase } from './supabase'
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'
import { Capacitor } from '@capacitor/core'
import { getDeviceId, resetDeviceId } from './device'

/**
 * 完整清除本地所有用户数据。
 * 触发时机：登出、切换账号、Factory Reset、卸载前的最后一次写。
 * 注意：必须先 signOut 再清本地，否则 supabase 的 onAuthStateChange 会写回 session。
 */
export async function purgeAllLocalData() {
  const isNative = Capacitor.isNativePlatform()

  // 1. signOut（supabase 内部清自己 storage）
  try { await supabase.auth.signOut() } catch (e) { console.warn('[auth] signOut err:', e) }

  // 2. 清 Dexie 全部业务表
  await db.transaction('rw', db.notes, db.tags, db.note_tags,
    db.sync_queue, db.sync_metadata, db.conflicts, db.cache, async () => {
    await Promise.all([
      db.notes.clear(), db.tags.clear(), db.note_tags.clear(),
      db.sync_queue.clear(), db.sync_metadata.clear(),
      db.conflicts.clear(), db.cache.clear(),
    ])
  })

  // 3. 清 Keystore 里所有 ffn:* 键
  if (isNative) {
    try {
      const keys = (await SecureStoragePlugin.keys()).keys ?? []
      await Promise.all(keys.map((k) => SecureStoragePlugin.remove({ key: k })))
    } catch (e) { console.warn('[auth] clear keystore err:', e) }
  }

  // 4. 清 localStorage 业务键（保留 vite/devtools 等系统键）
  const lsKeys = Object.keys(localStorage).filter((k) => k.startsWith('ffn:') || k === 'ffn-device-id' || k === 'ffn-legacy-marker')
  lsKeys.forEach((k) => localStorage.removeItem(k))

  // 5. 重置 deviceId（下次 startSync 时会重新生成）
  if (isNative) await resetDeviceId()
  else localStorage.removeItem('ffn-device-id')

  // 6. 清 syncManager 内存态（如果有暴露的方法）
  // syncManager._reset?.()  // 由 syncManager 提供的 reset 方法
}

// 修改 signOut 调用点
export async function signOut() {
  await purgeAllLocalData()
  // useAuthStore 的 reset 在 store 内部完成
}
```

**验收**：
- 登出后 `adb shell run-as com.aicyber.ffnmv ls shared_prefs/` 不含 ffn 相关
- 重新登录另一个账号，**看不到上一个用户的笔记**（除非已同步到云端且 RLS 放行——RLS 已经按 user_id 隔离）
- Factory Reset 也走同一个 `purgeAllLocalData()`

### Phase 4 — Android 工程配置（1 天）

#### 4.1 应用 ID / 权限

`android/app/build.gradle`：
```gradle
android {
  namespace "com.aicyber.ffnmv"
  defaultConfig {
    applicationId "com.aicyber.ffnmv"
    minSdkVersion 24
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
- 显式 `android:allowBackup="false"`
- `android:usesCleartextTraffic="false"`
- 权限：仅 `INTERNET`

#### 4.2 网络安全配置

`android/app/src/main/res/xml/network_security_config.xml`：
```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
```

Manifest 引用：`android:networkSecurityConfig="@xml/network_security_config"`

#### 4.3 资产缓存策略

**不要在 `capacitor.config.server.cacheControl` 设 `no-cache`**。Vite content-hash + WebView 默认长缓存是最优组合。

#### 4.4 图标 / 启动屏

```bash
npm install -D @capacitor/assets
# 准备 1024x1024 的 icon.png 和 2732x2732 的 splash.png 到 resources/
npx capacitor-assets generate --android
```

### Phase 4.5 — 自动化构建脚本（0.25 天）

`package.json` 新增脚本：

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

### Phase 4.6 — 🆕 v3 必改：网络异常全局兜底（0.5 天）

**问题**：首次打开（无任何缓存）时如果没网：① Splash 隐藏 → App 渲染 → `useAuthStore.init()` 调 `supabase.auth.getSession()` 失败 → Login 页的 `signIn` 调 `signInWithPassword` 失败 → 整个页面卡住或白屏。

**新增 `src/components/OfflineBoundary.jsx`**：

```jsx
import { useEffect, useState } from 'react'
import { Network } from '@capacitor/network'
import { Capacitor } from '@capacitor/core'
import { WifiOff } from 'lucide-react'
import { db } from '@/lib/db'

export function OfflineBoundary({ children }) {
  const [online, setOnline] = useState(true)
  const [hasCache, setHasCache] = useState(true)

  useEffect(() => {
    let mounted = true
    const check = async () => {
      if (!Capacitor.isNativePlatform()) return
      const status = await Network.getStatus()
      const noteCount = await db.notes.count()
      if (!mounted) return
      setOnline(status.connected)
      setHasCache(noteCount > 0)
    }
    check()
    if (Capacitor.isNativePlatform()) {
      const handler = (s) => setOnline(s.connected)
      Network.addListener('networkStatusChange', handler)
      return () => {
        mounted = false
        Network.removeListener('networkStatusChange', handler)
      }
    }
    return () => { mounted = false }
  }, [])

  // 首次打开 + 离线 + 无缓存：完全兜底页
  if (!online && !hasCache) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-6 text-center bg-white">
        <WifiOff size={48} className="text-gray-400 mb-4" />
        <h2 className="text-lg font-medium text-gray-700">无网络连接</h2>
        <p className="text-sm text-gray-500 mt-2 max-w-xs">
          请检查 WiFi 或移动数据后重试。首次打开需要网络以验证账号。
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-4 py-2 bg-[#0077B6] text-white rounded-lg text-sm"
        >
          重试
        </button>
      </div>
    )
  }

  // 离线 + 有缓存：顶部条幅 + 正常 App
  return (
    <>
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-100 text-amber-800 text-xs text-center py-1">
          离线模式 · 新增内容将在恢复网络后同步
        </div>
      )}
      {children}
    </>
  )
}
```

**Web 端**：保留 `navigator.onLine` 简单处理（`src/main.jsx` 内已有），不必用 `OfflineBoundary`（web 在 `Login` 页有自己的错误提示）。但组件本身做平台判断，web 端 `useEffect` 不挂载网络监听，所以 `online` 始终是 `true`，等于透传 children。

### Phase 5 — 构建 & 签名（0.5 天）

```bash
# 1. 准备签名
keytool -genkey -v -keystore android/keystore/ffnmv-release.keystore \
  -alias ffnmv -keyalg RSA -keysize 2048 -validity 10000
# ⚠️ 见附录 C：密钥丢失 / 版本回滚 SOP

# 2. 配 ~/.gradle/gradle.properties
KEYSTORE_PASSWORD=...
KEY_PASSWORD=...

# 3. 出 AAB
npm run build:android && npm run android:bundle
```

### Phase 5.5 — 🆕 v3 必改：SecureStorage 测试 mock（0.25 天）

**问题**：v2 测试计划提"注入 fake SecureStorage"，但**没有可用的 mock 实现**，导致 `useAuthStore` / `syncManager` 的安全相关测试**无法跑**。

**新增 `src/test/fakes/secureStorage.js`**：

```js
// 用 happy-dom / vitest 跑 useAuthStore 时注入这个 fake 替代真实 SecureStoragePlugin
const _store = new Map()

export const SecureStoragePlugin = {
  get: async ({ key }) => ({ value: _store.get(key) ?? null }),
  set: async ({ key, value }) => { _store.set(key, value) },
  remove: async ({ key }) => { _store.delete(key) },
  keys: async () => ({ keys: [..._store.keys()] }),
  clear: async () => { _store.clear() },
}

// 给每个测试 case 调用，重置 fake 状态
export const __resetSecureStorageForTests = () => _store.clear()
```

**`src/test/setup.js` 补**：

```js
import { vi } from 'vitest'

// mock capacitor-community/secure-storage-plugin
vi.mock('capacitor-secure-storage-plugin', async () => {
  const { SecureStoragePlugin, __resetSecureStorageForTests } = await import('./fakes/secureStorage')
  return { SecureStoragePlugin, __resetSecureStorageForTests }
})

// mock @capacitor/core 的 isNativePlatform（测试时返回 false，走 web 路径）
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}))

// mock @capacitor/network
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn().mockResolvedValue({ connected: true }),
    addListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
    removeListener: vi.fn(),
  },
}))
```

**新增测试用例 `src/stores/__tests__/useAuthStore.secure.test.js`**：

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/stores/useAuthStore'
import { SecureStoragePlugin, __resetSecureStorageForTests } from '@/test/fakes/secureStorage'

describe('useAuthStore 安全存储迁移', () => {
  beforeEach(() => {
    __resetSecureStorageForTests()
    localStorage.clear()
  })

  it('登录后 token 落 SecureStorage 而非 localStorage', async () => {
    await useAuthStore.getState().signIn('user@test.com', 'password123')
    const ksKeys = (await SecureStoragePlugin.keys()).keys
    expect(ksKeys).toContain('ffn-sb-session')
    expect(localStorage.getItem('ffn-sb-session')).toBeNull()
  })

  it('登出后 SecureStorage 内 session 被清', async () => {
    await useAuthStore.getState().signIn('user@test.com', 'password123')
    await useAuthStore.getState().signOut()
    const ksKeys = (await SecureStoragePlugin.keys()).keys
    expect(ksKeys).not.toContain('ffn-sb-session')
  })
})
```

### Phase 6 — 内部测试 & 上架（1.5–2 天）

1. Google Play Console 建应用（首次上架 25 美元）
2. 内部测试轨道 → 上传 AAB → 加测试账号
3. 通过后升「正式版」
4. 准备商店资料：
   - 截图 ≥2 张
   - 应用图标
   - 隐私政策链接（**必填**）
   - **🆕 v3 必填：Data Safety 表单**（见附录 D 模板）
   - 应用分类「效率」

### Phase 9 — 🆕 v3 必改：CI/CD 自动化校验（0.75 天）

**问题**：全程本地手动构建，PR 不跑测试，漏 sync、漏跑测试的"人为事故"无任何拦截。

**新增 `.github/workflows/android-ci.yml`**：

```yaml
name: Android CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install
        run: npm ci

      - name: Lint
        run: npm run lint
        continue-on-error: false

      - name: Test (incl. SecureStorage mock)
        run: npm run test

      - name: Build test bundle
        run: npm run build:android:test

      - name: Verify cap sync dry-run
        run: |
          npx cap sync android --dry-run || (
            echo "::error::cap sync would change files. Run 'npm run build:android:test' locally and commit." &&
            exit 1
          )

      - name: Upload test bundle artifact
        if: github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@v4
        with:
          name: android-test-bundle
          path: dist/
          retention-days: 7
```

**保护规则**：
- PR 必须通过 CI（lint + test + build:test + cap sync dry-run）才能合并
- `cap sync --dry-run` 在 CI 上如果"需要 sync 但没做"会失败，强制开发者本地先 sync 再 commit

**可选（远期）**：
- 加 `npm audit --audit-level=high` 跑依赖漏洞扫描
- 加 `gradle build` 跑完整 Android 编译（需装 JDK 17 + Android SDK，CI 镜像体积大，按需）

### Phase 10 — 🆕 v3 必改：运维文档 `docs/android-maintain.md`（0.5 天，**含完整 SOP**）

**问题**：v2 仅占位，v3 写完整内容。详见附录 C。

---

## 3. 安全性评估 + 执行步骤

| 风险 | Web 当前 | Android 风险 | 执行步骤 |
|---|---|---|---|
| **Token 落 localStorage** | 高 | 迁移到 Keystore | Phase 3 |
| **APK 内 anon key 可见** | 可接受 | 同 | 无需改 |
| **WebView 文件访问** | n/a | file:// 可读 APK 资源 | `allowMixedContent: false` |
| **adb backup 偷数据** | n/a | 默认 allowBackup=true | `allowBackup="false"` |
| **cleartext HTTP** | 已禁 | 需双保险 | Manifest + network_security_config |
| **第三方键盘 / 录屏** | n/a | 笔记内容可能被录 | 可选 `FLAG_SECURE` |
| **Root 设备** | n/a | Keystore 可被绕 | 选做 root 检测 |
| **WSS / TLS 降级** | 受 Supabase CDN | 同 | 选做 cert pinning |
| **JS 注入 / XSS** | 无 `dangerouslySetInnerHTML` | 风险增加 | 保持现状 + CSP |
| **设备丢失** | 浏览器登录态 | token 在 Keystore | 可选 PIN / 生物锁 |
| **网络异常请求挂死** | n/a | 弱网/服务器无响应 | Phase 3：10s AbortSignal.timeout |
| **Realtime 切网不重连** | n/a | 切 4G/WiFi 后不重连 | Phase 3：Network 监听 |
| 🆕 **登出后数据残留** | n/a | **多账号切换/设备移交有隐私合规风险** | Phase 3.5：purgeAllLocalData |
| 🆕 **首次无网络白屏** | n/a | 兜底页缺失 | Phase 4.6：OfflineBoundary |
| 🆕 **BrowserRouter WebView 路由丢失** | n/a | **直开 deep link / OAuth 回调 404** | Phase 2.1：HashRouter |
| 🆕 **keystore 丢失无法发布** | n/a | **致命** | 附录 C 完整 SOP |
| 🆕 **Data Safety 漏报被驳回** | n/a | 上架延期 | 附录 D 模板 |
| 🆕 **.env 误提交** | 已 gitignore 但**缺 .env.example** | 新人 onboarding 风险 | Phase 1.5 |
| 🆕 **本地构建无 CI 校验** | n/a | 漏 sync / 漏测试无人拦截 | Phase 9：GitHub Actions |

**安全验收 checklist**：
- [ ] Token 完全脱离 localStorage
- [ ] release APK 关闭 `webContentsDebuggingEnabled`
- [ ] ProGuard / R8 已开
- [ ] `allowBackup="false"`
- [ ] cleartext 拒绝
- [ ] RLS 不变
- [ ] 弱网/断网请求 10s 内返回超时
- [ ] 网络切换 5 次后 Realtime 仍能重连
- [ ] 🆕 登出后 `adb shell run-as com.aicyber.ffnmv ls shared_prefs/` 无 ffn 相关
- [ ] 🆕 首次无网络显示兜底页 + 重试按钮
- [ ] 🆕 外部 deep link `https://ffn.aicyber.chat/notes/xxx` 在 WebView 内能正常打开
- [ ] 🆕 `git status` 不显示 keystore 文件

---

## 4. 效率评估 + 执行步骤

| 指标 | Web 现状 | Android 目标 | 执行步骤 |
|---|---|---|---|
| 首屏 JS 体积 | ~500KB gzip ~180KB | APK 启动多 100–300ms | splash 等渲染完再 hide |
| 列表渲染 | useVirtualizer 1000 条顺滑 | 同 | overscan 3 |
| 同步频率 | 60s–300s | 同 | 退后台暂停 |
| 内存 | Tab ~150MB | WebView 类似 | 路由 lazy |
| APK 体积 | n/a | ~6–8MB | shrinkResources + R8 + ABI splits |
| 网络 | HTTP/2 | 同 | WiFi 全量 / 4G 限 50 条/批 |
| 启动到可交互 | ~1.2s | ~1.5s | Dexie 缓存直出 |
| 后台被杀恢复 | n/a | Low Memory Killer | appStateChange → fullSync |
| 电量 | n/a | WebView 持续 poll | 后台 pause |
| 资产缓存 | 浏览器长缓存 | WebView 不应每次重下 | **不要设 no-cache** |

**效率验收 checklist**：
- [ ] release APK ≤ 8MB（arm64-v8a）
- [ ] 冷启到首屏 ≤ 1.8s
- [ ] 1000 条笔记列表 60fps
- [ ] 后台 5min 回前台 30s 内全量同步
- [ ] 4G 100 条 push ≤ 8s
- [ ] 升级 APK 后首启无旧页面残留

---

## 5. 测试计划

| 阶段 | 工具 | 重点 |
|---|---|---|
| 单元 | 现有 vitest | 改 storage adapter 后跑 useAuthStore / syncManager |
| WebView 集成 | Android Studio Emulator + Chrome inspect | H5 调试 |
| 真机 | Android 7 / 11 / 14 | 系统 WebView 差异 |
| 同步边界 | 飞行模式 × 50 | 退避 + 增量恢复 |
| 登录态保留 | kill app / 重启 | Keystore 持久化 |
| 包大小 | apkanalyzer | 体积 + 启动报告 |
| 隐私 | Play Data safety form | 见附录 D |
| 🆕 Token 过期自动刷新 | 篡改 Keystore JWT | 静默刷新 |
| 🆕 断网增量同步 | 飞行模式改笔记 → 恢复 | 30s 内同步 |
| 🆕 版本升级数据迁移 | 旧版登录 → 升新版 | Dexie + Keystore 完整保留 |
| 🆕 低内存后台回收 | 多应用占内存 | 回 App 自动同步 |
| 🆕 网络切换 Realtime | WiFi↔4G × 10 | 不断不丢 |
| 🆕 弱网超时 | Charles 1KB/s | 10s 内 AbortError |
| 🆕 **登出后无残留** | 登出 → adb ls shared_prefs | 无 ffn 键 |
| 🆕 **首次无网络兜底** | 飞行模式启动 App | 显示兜底页 + 重试按钮 |
| 🆕 **外部 deep link** | 微信/邮件点 `https://ffn.aicyber.chat/notes/123` | WebView 内正确打开 |
| 🆕 **HashRouter 路由稳定** | 多个页面间切换 + 杀进程重启 | 路由状态正确 |
| 🆕 **CI 校验** | 故意提交不 sync 的 dist 改动 | CI 失败 |

---

## 6. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Capacitor 6 与 AGP 8 / Gradle 8 兼容坑 | 中 | 中 | 锁版本 + Gradle 8.7 |
| Supabase Realtime 后台被掐 | 中 | 中 | 退前台 fullSync |
| 腾讯云 Lighthouse TLS 协商失败 | 低 | 高 | 3 家厂商机连测 |
| Play Store 审核隐私合规 | 中 | 中 | 隐私政策 + Data Safety 模板 |
| Keystore 丢失 | 低 | **灾难** | 附录 C 完整 SOP + 1Password 团队库 + 异地备份 |
| `build.target: 'es2020'` 与 npm 包不兼容 | 低 | 低 | 锁版本 + CI build 验证 |
| 沉浸式状态栏与现有布局冲突 | 中 | 中 | 全局 padding-top + Login/Settings 单调 |
| 锁竖屏后平板用户体验差 | 低 | 中 | 远期 tablet 自适应 |
| 🆕 **HashRouter 改动影响 web 端 SEO** | 低 | 中 | web 端仍用 BrowserRouter（条件分支） |
| 🆕 **purgeAllLocalData 与 syncManager 内存态不同步** | 中 | 中 | 在 signOut 流程里最后调 syncManager._reset() |
| 🆕 **CI 跑 Android build 镜像太重** | 中 | 中 | CI 只跑 `cap sync --dry-run` + dist 校验，**不跑 gradle build** |
| 🆕 **GitHub Actions 私有仓库分钟数耗尽** | 低 | 中 | 公共仓库无限 |

---

## 7. 工作量估算

| 阶段 | v1 | v2 | v3 | 增量 v2→v3 |
|---|---|---|---|---|
| Phase 1 Capacitor 接入 | 0.5 | 0.5 | 0.5 | — |
| Phase 1.5 .gitignore + .env.example | — | — | 0.25 | +0.25 |
| Phase 2 Vite 适配 + 平台路由 | 0.5 | 1.0 | 1.0 | （含 HashRouter） |
| Phase 2.1 🆕 平台条件路由 | — | — | 0.25 | +0.25 |
| Phase 3 Supabase 安全 & 网络 | 1.0 | 1.5 | 1.5 | — |
| Phase 3.5 🆕 登出全量清理 | — | — | 0.5 | +0.5 |
| Phase 4 Android 工程配置 | 1.0 | 1.0 | 1.0 | — |
| Phase 4.5 自动化构建脚本 | — | 0.25 | 0.25 | — |
| Phase 4.6 🆕 网络异常兜底 | — | — | 0.5 | +0.5 |
| Phase 5 构建 & 签名 | 0.5 | 0.5 | 0.5 | — |
| Phase 5.5 🆕 SecureStorage mock | — | — | 0.25 | +0.25 |
| Phase 6 测试 & 上架 | 1.0–2.0 | 1.5–2.0 | 1.5–2.0 | — |
| Phase 9 🆕 CI/CD | — | — | 0.75 | +0.75 |
| Phase 10 🆕 运维文档 | — | 0.5 | 0.5 | （v3 写完整） |
| 安全 & 效率验收 | 0.5 | 0.5 | 0.5 | — |
| **合计** | **5–6 人天** | **6.75–7.75 人天** | **9.75–10.75 人天** | **+3 人天** |

---

## 8. 后续路线（不在本次计划内）

- iOS：Capacitor `npx cap add ios` + Apple Developer 账号
- 离线优先：考虑迁移到 PowerSync
- App Widget：Android 桌面快速记录入口
- 推送：FCM
- 热更新：v1.4.x 评估（Play Store 政策 + 估 +3 人天）
- 平板自适应
- 防截屏 `FLAG_SECURE`

---

## 附录 A：v1 → v2 变更日志

（参考 [`plan-android-v2.md` 附录 A](./plan-android-v2.md)）

---

## 附录 B：v2 → v3 变更日志

来源：第二批紧急必要优化（2026-06-20 用户反馈，8 项）

### 🆕 全部纳入（8 项，皆"必改"级）

| # | 反馈项 | 计划内落点 | 估时 |
|---|---|---|---|
| 1 | **缺失平台路由自动切换** | Phase 2.1：`HashRouter` for native，`BrowserRouter` for web | 0.25d |
| 2 | **.gitignore + .env.example 规范** | Phase 1.5：补 android/keystore 规则 + 新增 `.env.example` | 0.25d |
| 3 | **Google Play Data Safety 模板** | 附录 D：完整数据类别申报 | 0.5d |
| 4 | **签名密钥 / 版本回滚 SOP** | 附录 C：完整处置流程 | 0.5d（v2 已是占位，v3 写完整） |
| 5 | **登出全量本地清理** | Phase 3.5：`purgeAllLocalData()` 函数 | 0.5d |
| 6 | **网络异常全局兜底** | Phase 4.6：`OfflineBoundary` 组件 | 0.5d |
| 7 | **SecureStorage mock 可用代码** | Phase 5.5：`src/test/fakes/secureStorage.js` + setup.js + 测试用例 | 0.25d |
| 8 | **CI/CD 自动化校验** | Phase 9：GitHub Actions workflow | 0.75d |
| **合计** | | | **+3.0 人天** |

### 📊 净影响
- 安全验收：+5 项（登出残留、首次无网络、deep link、keystore、Data Safety）
- 效率验收：+1 项（首次无网络兜底）
- 测试用例：+4 项（登出残留、首次无网络、deep link、CI 校验）
- 风险登记：+4 项
- **工作量：+3 人天（6.75–7.75 → 9.75–10.75）**

### ⚠️ 重要修正
- 反馈原文 #2"敏感密钥极易提交仓库" — **当前 `.env*` 已 gitignore**（验证：`.gitignore:7-9, 15-17`）；v3 补的是 `android/keystore/` 规则 + `.env.example` 模板（缺这两件才是真问题）
- 反馈原文 #5"Keystore/Dexie 残留" — Dexie 残留确实是真问题，但 Keystore 本身由 Android 沙箱隔离，**残留风险在于应用自己的 Keystore 键值**，不是泄露到 Keystore 之外

---

## 附录 C：🆕 v3 完整版 — 签名密钥丢失 / 版本回滚 SOP

> 直接拷到 `docs/android-maintain.md` 即可。

### C.1 签名密钥保管

**生成时**：
- 用 `keytool -genkey` 生成 `ffnmv-release.keystore`
- **必须**异地备份 3 份：
  1. 1Password 团队库（"ffnmv-prod" vault）
  2. 加密 USB（线下保管）
  3. Google Cloud Secret Manager（或同类 KMS）
- 三处都需记录：`keystore 密码` + `keyAlias` + `key 密码`
- 文档化在 `docs/android-maintain.md`，仅 team lead 有读权限

**每次发布**：
- CI 不应该直接持有 keystore 密码（除非用 GitHub Actions Secrets + 团队批准）
- 当前推荐：本地 `~/.gradle/gradle.properties` 持有 + 一次性 build
- 远期：迁移到 Google Play App Signing（Google 帮你保管签名密钥，只持有 upload key）

### C.2 密钥丢失应急

**Play Console 操作路径**：
1. Play Console → Setup → App signing
2. 如果用了 **Google Play App Signing**：你可以 reset **upload key**（一次性，且 Play Support 审核）
3. 如果用的是 **自有密钥**：**无 reset 路径**——只能发布新 app（不同包名），老用户无法更新

**强烈建议**：第一版上线时立刻启用 **Google Play App Signing**（Play Console 引导流程）。这之后你的 release 用 upload key 签，Google 内部用 app signing key 签。**upload key 丢失可 reset，app signing key 由 Google 保管**。

### C.3 版本回滚 SOP

**场景 A：刚发布，发现严重 bug，灰度 5% 中**
1. Play Console → Release management → Releases
2. 选中当前 release → **Halt rollout**
3. 修 bug → 发新版（versionCode +1）→ 重新灰度

**场景 B：已 100% 发布，发现严重 bug**
1. Play Console → Release management → Releases → 选上一稳定版
2. **Roll back to this version**（Play Console 提供"回滚到任一已发布版本"功能）
3. 紧急修复后另发新版

**场景 C：紧急情况，需要让所有用户立即失效某版本**
- 没办法直接让用户卸载。只能：
  1. Halt 当前 release
  2. 发新版（最低 minSdkVersion 可调高踢掉部分老设备）
  3. 配合 in-app 提示用户更新

### C.4 版本号规范

- `versionCode`：整数，每次发版 +1（强制）
- `versionName`：用户可见，"X.Y.Z"（SemVer）
  - X：不兼容大改
  - Y：新功能
  - Z：bug 修复
- 在 `package.json` 和 `android/app/build.gradle` 同时维护，由 `npm version` 脚本同步

---

## 附录 D：🆕 v3 完整版 — Google Play Data Safety 申报模板

> Play Console → Policy → App content → Data safety

### D.1 数据收集声明（按类别）

| 数据类别 | 是否收集 | 用途 | 是否必需 | 加密传输 | 加密存储 | 用户可控 |
|---|---|---|---|---|---|---|
| 账号信息（邮箱） | ✅ | 登录 | 必需 | 是（HTTPS） | 是（Supabase at-rest） | 是（注销） |
| 账号信息（密码 hash） | ✅ | 登录 | 必需 | 是 | 是 | 是（修改） |
| 用户内容（笔记、标签） | ✅ | 核心功能 | 必需 | 是 | 是 | 是（删除） |
| 设备 ID（uuid v4） | ✅ | 多设备同步去重 | 必需 | 是 | 是 | 是（factory reset） |
| 应用活动（同步时间戳） | ✅ | 同步状态展示 | 必需 | 是 | 是 | 是（登出清空） |
| 崩溃日志 | ❌ | — | — | — | — | — |
| 位置 | ❌ | — | — | — | — | — |
| 通讯录 | ❌ | — | — | — | — | — |
| 媒体（图片/视频/音频） | ❌ | — | — | — | — | — |
| 健康 / 财务 | ❌ | — | — | — | — | — |
| 浏览历史 | ❌ | — | — | — | — | — |

### D.2 数据使用方式

- **应用功能**：是（必需）
- **分析**：否
- **个性化 / 推荐**：否
- **开发者通讯**：否
- **数据出售 / 共享给第三方**：否

### D.3 用户控制

- **账号删除**：Settings → Factory Reset（已有，**双确认**）
- **数据导出**：Settings → 导出 JSON（已有）
- **登出后本地数据**：Phase 3.5 `purgeAllLocalData` 全清（v3 新增）

### D.4 隐私政策 URL

`https://ffn.aicyber.chat/privacy`（需在生产部署后实际可访问）

### D.5 Play Console 填写步骤

1. 登录 Play Console → 选 app
2. Policy → App content → **Data safety**
3. 开始问卷：
   - "Does your app collect or share any of the required user data types?" → **Yes**
   - 按 D.1 表格勾选
4. 提交后等 Play 审核（一般 1–3 天，Data Safety 与版本审核并行）

---

## 附录 E：微信小程序 v2 是否需要类似更新？

**结论**：需要但程度不同。

- **路由切换**：MP 没有 BrowserRouter 概念（Taro 自带 `@tarojs/router`），**不适用**
- **.gitignore / .env.example**：同样建议补，Taro 项目新建时也容易缺
- **Data Safety**：MP 是微信审核，无 Data Safety 概念，但有「用户隐私保护指引」需在 MP 后台填——**单独处理**
- **签名密钥 / 回滚**：MP 的"密钥"是 AppSecret + 小程序 AppID，丢失可在微信公众平台重置；回滚靠「分阶段发布」+「wx.getUpdateManager」——v2 已覆盖
- **登出全量清理**：同样需要（`purgeAllLocalData` 函数 MP 版清 `wx.storage`）
- **网络异常兜底**：v2 §3 Phase 4.5 + 5 的 skeleton 已部分覆盖
- **CI mock**：Taro 测试用 vitest，**SecureStorage → wx.storage mock** 同样需要补
- **CI/CD**：Taro 项目的 GitHub Actions 配置方式相同

**建议**：如要保持两份计划对齐，可在 `docs/plan-wechat-miniprogram.md` 下次迭代时补一个 v3，纳入上述对应项。**本轮先不动 MP 计划**。
