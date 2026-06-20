# 计划：ffnmv 转 Android 应用（Capacitor 6 方案）

> **目标**：把现有 React + Vite + Supabase 笔记应用打包成一个 Android 原生 APK / AAB，复用现有 web 资产，最小化代码改动。
> **基线**：本计划基于 `ffnmv v1.3.1`（main 分支，2026-06-20 状态）。
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
            @capacitor/preferences @capacitor/haptics
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
    // 开发期可指向本地 dev server；正式构建必须删掉这一段
    // url: 'http://10.0.2.2:5173',
    // cleartext: false,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 500, backgroundColor: '#ffffff' },
    StatusBar: { style: 'DARK', backgroundColor: '#ffffff' },
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

# 4. 每次 web 构建完同步资产
npm run build && npx cap sync android
```

### Phase 2 — Vite 适配（0.5 天）

**`vite.config.js` 调整**：

```js
export default defineConfig({
  base: './',                        // ★ 关键：相对路径，否则 APK 内资源 404
  // ... 保留原有 manualChunks
})
```

**`src/main.jsx` 调整**（解决 index.html 标题覆盖逻辑）：

```js
// 原代码用 location.pathname.startsWith('/ffn-pre') 判断
// 在 Android WebView 里 path 永远是 / 或 /index.html，需要补一个 Capacitor 平台判断
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'   // 处理 Android 返回键

if (Capacitor.isNativePlatform()) {
  document.title = '发法牛 v1.3.1 - 轻量化多端同步笔记'
  // 接管 Android 物理返回：未登录回退到桌面，登录后路由内返回
  App.addListener('backButton', ({ canGoBack }) => {
    if (!canGoBack) App.exitApp()
    else window.history.back()
  })
}
```

### Phase 3 — Supabase token 落 Android Keystore（1 天，**安全关键**）

**问题**：当前 `supabase-js` 默认把 JWT / refresh token 存 `localStorage`，在 WebView 里只要 XSS（虽然当前无 `dangerouslySetInnerHTML`，但 WebView 上第三方 JS 注入面更大）就能被读。Android Keystore 是硬件级加密，token 不应离开设备。

**改造**：

```bash
# 已有：@capacitor-community/secure-storage
# 它把数据加密存在 EncryptedSharedPreferences（Android Keystore 派生密钥）
```

**`src/lib/supabase.js` 改造**：

```js
import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin' // 或 @capacitor-community/secure-storage

const isNative = Capacitor.isNativePlatform()

// 自定义 storage 适配器：把 supabase-js 的 getItem/setItem/removeItem 路由到 Keystore
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

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: keystoneStorage,         // ★ 关键
      storageKey: 'ffn-sb-session',
    },
  }
)
```

**迁移策略**：
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
- 删除 `android:allowBackup="true"`（默认就是 true，但要在源码显式 false 防数据被 adb backup 偷走）
- 加 `android:usesCleartextTraffic="false"`
- 权限：仅 `INTERNET`（不需要存储/相机/通讯录等）

#### 4.2 网络安全配置（cert pinning 可选）

`android/app/src/main/res/xml/network_security_config.xml`：
```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <!-- 可选：cert pinning。生产环境强烈建议加（见 §4 安全） -->
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

#### 4.3 图标 / 启动屏

```bash
# 用 @capacitor/assets 一键生成所有分辨率
npm install -D @capacitor/assets
# 准备 1024x1024 的 icon.png 和 2732x2732 的 splash.png 到 resources/
npx capacitor-assets generate --android
```

### Phase 5 — 构建 & 签名（0.5 天）

```bash
# 1. 准备签名（生产密钥务必离线保管，不要进 git）
keytool -genkey -v -keystore android/keystore/ffnmv-release.keystore \
  -alias ffnmv -keyalg RSA -keysize 2048 -validity 10000

# 2. 在 ~/.gradle/gradle.properties 配
KEYSTORE_PASSWORD=...
KEY_PASSWORD=...

# 3. 打 AAB（Play Store 要求）
cd android && ./gradlew bundleRelease
# 产物：android/app/build/outputs/bundle/release/app-release.aab

# 4. 调试 APK（内部测试用）
./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

### Phase 6 — 内部测试 & 上架（1–2 天）

1. Google Play Console 建应用（包名 `com.aicyber.ffnmv`，首次上架需 25 美元注册费）
2. 内部测试轨道 → 上传 AAB → 加测试账号邮箱
3. 通过后升「正式版」
4. 准备商店资料：截图（≥2 张）、应用图标、隐私政策链接（**必填**，因为有账号系统 + 笔记内容）、应用分类「效率」

---

## 3. 安全性评估 + 执行步骤

> 三平台横向对比：当前 web（基线）/ Android（目标）/ 微信小程序（见另一份计划）。

| 风险 | Web 当前 | Android 风险 | 执行步骤 |
|---|---|---|---|
| **Token 落 localStorage** | 高 | 迁移到 Keystore | Phase 3 全部 |
| **APK 内 anon key 可见** | 可接受 | 同（Supabase 设计如此） | 无需改，anon key 配合 RLS 仍是安全的 |
| **WebView 文件访问** | n/a | 默认允许 `file://` 时可读 APK 资源 | `capacitor.config` 设 `allowMixedContent: false`；不引入 `CapacitorCookies` 之外的本地文件访问 |
| **adb backup 偷数据** | n/a | 默认 allowBackup=true | AndroidManifest 显式 `allowBackup="false"` |
| **cleartext HTTP** | 已禁（nginx 强制 https） | 需双保险 | Manifest `usesCleartextTraffic="false"` + network_security_config |
| **第三方键盘 / 录屏** | n/a | 笔记内容可能被录 | 可选：加 FLAG_SECURE（防截屏），Phase 7 加 `@capacitor-community/screen-orientation` 同作者的 `safe-area` |
| **Root 设备** | n/a | Keystore 在 root 设备上可被绕 | 选做：加 root 检测（`@capacitor-community/safety-net`），检测到 root 提示风险而非阻断 |
| **WSS / TLS 降级** | 受 Supabase CDN | 同 | 选做：cert pinning（见 4.2）；先用 Let's Encrypt 自动化轮换 |
| **JS 注入 / XSS** | 无 `dangerouslySetInnerHTML`，内容全文本 | 风险增加 | 保持现状；CSP 头通过 nginx 注入：`script-src 'self' 'unsafe-inline'`（Vite 需要 inline）→ 生产改为 nonce-based（Capacitor 内 `default-src 'self'; script-src 'self'`，WebView 端不需 server 配合） |
| **设备丢失** | 浏览器登录态靠 Supabase TTL | token 在 Keystore，其他 App 拿不到 | 应用启动可加可选 PIN / 生物锁（`@capacitor-community/biometric`） |

**安全验收 checklist**：
- [ ] Token 完全脱离 localStorage（在 Keystore 看到，`adb shell run-as com.aicyber.ffnmv cat shared_prefs/` 拿不到）
- [ ] release APK 关闭 `webContentsDebuggingEnabled`（Chrome `chrome://inspect` 看不到 WebView）
- [ ] ProGuard / R8 已开（`minifyEnabled true`），APK 中类名混淆
- [ ] `allowBackup="false"` 验证：`adb backup` 拿不出数据
- [ ] cleartext 拒绝：用 `curl http://ffn.aicyber.chat` 在 App 内被拦
- [ ] RLS 不变：Supabase 侧 anon key 仍走 RLS（已是生产配置）

---

## 4. 效率评估 + 执行步骤

| 指标 | Web 现状 | Android 目标 | 执行步骤 |
|---|---|---|---|
| 首屏 JS 体积 | 211KB (supabase) + 162KB (react) + 96KB (dexie) + 31KB (index) ≈ **500KB gzip ~180KB** | APK 启动多 100–300ms WebView 冷启 | 启动屏（SplashScreen）遮 500ms；后续 WebView 命中磁盘缓存 |
| 列表渲染 | `useVirtualizer` 1000 条顺滑 | 同 WebView 性能 | 无需改；可加 `overscan: 3`（省电） |
| 同步频率 | 自适应 60s–300s | 同 | 移动端后台时 `App.addListener('appStateChange')` → 退到后台立即暂停轮询（已有 `visibilitychange`） |
| 内存 | 浏览器 Tab ~150MB | WebView 类似，Android 杀进程阈值更早 | 切到后台时清掉 Editor 草稿（已自动）；路由走 `React.lazy` 减少常驻 |
| APK 体积 | n/a | 基线 ~6–8MB | 启用 `shrinkResources true` + R8 混淆；按需 `splits { abi { enable true } }` 出 4 个 ABI（armv7/arm64/x86/x64），用户下 ~2MB |
| 网络 | HTTP/2 (nginx) | 同 | `@capacitor/network` 检测网络类型；WiFi 推全量，移动数据只推 50 条/批（修改 `syncManager.js` 的 `batchSize`） |
| 启动到可交互 | ~1.2s（无缓存） | +300ms WebView 冷启 ≈ 1.5s | 启动时立即 `localStorage.getItem('ffn-cached-notes')` → Dexie 已存 → 首屏直出 |
| 后台被杀恢复 | n/a | Android Low Memory Killer | 监听 `appStateChange`，从后台回到前台立即 `syncManager.fullSync()` |
| 电量 | n/a | WebView 持续 poll 耗电 | 后台 pause 轮询（AppState），realtime WebSocket 保留（事件少） |

**效率验收 checklist**：
- [ ] release APK ≤ 8MB（arm64-v8a 单 ABI）
- [ ] 冷启到首屏 ≤ 1.8s（中端机：骁龙 7 系）
- [ ] 1000 条笔记列表滚动 60fps（DevTools Performance / Android Studio Profiler）
- [ ] 后台 5 分钟后回前台，30s 内完成一次全量同步
- [ ] 4G 移动数据下，100 条笔记 push ≤ 8s

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

---

## 6. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Capacitor 6 与 AGP 8 / Gradle 8 兼容坑 | 中 | 中 | 锁版本 `capacitor 6.1.x` + Gradle 8.7；遇坑回退到 Capacitor 5 |
| Supabase Realtime 在 WebView 后台被掐 | 中 | 中 | 退前台触发 fullSync；可接受偶发延迟 |
| 腾讯云 Lighthouse 反代对 APK 内嵌 `ffn.aicyber.chat` 的 HSTS / TLS 协商失败 | 低 | 高 | 预 release 在 3 家厂商机（华米 ov）跑网络连测 |
| Play Store 审核因「账号系统」被要求隐私合规材料 | 中 | 中 | 提前准备隐私政策页（可挂 `ffn.aicyber.chat/privacy`）+ 数据安全说明 |
| Keystore 丢失 | 低 | 灾难 | 密钥用 1Password 团队库 + 异地备份，文档化恢复流程 |

---

## 7. 工作量估算

| 阶段 | 人天 |
|---|---|
| Phase 1 Capacitor 接入 | 0.5 |
| Phase 2 Vite 适配 | 0.5 |
| Phase 3 Supabase Keystore（**安全关键**） | 1 |
| Phase 4 Android 工程配置 | 1 |
| Phase 5 构建 & 签名 | 0.5 |
| Phase 6 内部测试 & 上架 | 1–2 |
| 安全 & 效率验收 | 0.5 |
| **合计** | **5–6 人天**（不含上架审核等待 1–3 天） |

---

## 8. 后续路线（不在本次计划内）

- iOS：Capacitor 加 `npx cap add ios` + Apple Developer 账号（$99/年）
- 离线优先：考虑迁移到 PowerSync（替代自写 SyncManager）
- App Widget：Android 桌面快速记录入口
- 推送：FCM（Supabase Edge Function 触发）
