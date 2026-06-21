# ffnmv Android 运维文档

> 维护者：team lead
> 范围：ffnmv Android 应用（com.aicyber.ffnmv）的签名、版本、回滚、CI 等运维 SOP
> 关联：`docs/plan-android.md` 附录 C，附录 D（Data Safety 模板）

---

## 1. 签名密钥保管

### 1.1 生成 keystore

```bash
# 本地一次性生成
keytool -genkey -v -keystore android/keystore/ffnmv-release.keystore \
  -alias ffnmv -keyalg RSA -keysize 2048 -validity 10000
```

期间会提示输入：
- keystore 密码（`KEYSTORE_PASSWORD`）
- key 密码（`KEY_PASSWORD`，可与 keystore 密码相同）

**不要 commit 这个文件**。`android/keystore/` 已被 `.gitignore` 挡掉。

### 1.2 三处异地备份

生成后必须立刻备份到三处，缺一不可：

1. **1Password 团队库**（"ffnmv-prod" vault）—— 日常登录用
2. **加密 USB**（线下保管，物理隔离）—— 灾难恢复
3. **Google Cloud Secret Manager**（或同类 KMS）—— CI 注入

每处都要记录：
- keystore 文件本体
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS` = `ffnmv`
- `KEY_PASSWORD`

只有 team lead 有读权限。

### 1.3 注入到 build

**本地开发**（`~/.gradle/gradle.properties`）：

```properties
KEYSTORE_PASSWORD=<from 1Password>
KEY_PASSWORD=<from 1Password>
```

**CI**（GitHub Actions Secrets）：
- `KEYSTORE_PASSWORD`
- `KEY_PASSWORD`
- 暂未启用：keystore 文件本身（建议未来改用 base64 编码的 keystore + decode in CI step）

---

## 2. 密钥丢失应急

### 2.1 Play Console 操作路径

1. Play Console → Setup → App signing
2. **如果启用了 Google Play App Signing**（推荐）：可以 reset **upload key**（一次性，需 Play Support 审核）
3. **如果用的是自有密钥**：**无 reset 路径**——只能发布新 app（不同包名），老用户无法更新

### 2.2 强烈建议

**第一版上线时立刻启用 Google Play App Signing**。之后：
- 你用 upload key 签 release AAB
- Google 内部用 app signing key 签最终 APK
- upload key 丢失可 reset
- app signing key 由 Google 保管

启用方法：Play Console 上传第一个 AAB 时会引导。

---

## 3. 版本回滚 SOP

### 3.1 场景 A：刚发布，发现严重 bug，灰度 5% 中

1. Play Console → Release management → Releases
2. 选中当前 release → **Halt rollout**
3. 修 bug → 发新版（`versionCode` +1）→ 重新灰度

### 3.2 场景 B：已 100% 发布，发现严重 bug

1. Play Console → Release management → Releases → 选上一稳定版
2. **Roll back to this version**（Play Console 提供"回滚到任一已发布版本"功能）
3. 紧急修复后另发新版

### 3.3 场景 C：紧急情况，需要让所有用户立即失效某版本

没办法直接让用户卸载。只能：
1. Halt 当前 release
2. 发新版（最低 `minSdkVersion` 可调高踢掉部分老设备）
3. 配合 in-app 提示用户更新

---

## 4. 版本号规范

### 4.1 字段定义

- `versionCode`：整数，每次发版 +1（**强制**递增，Play Store 用它判断是否更新）
- `versionName`：用户可见，"X.Y.Z"（SemVer）

### 4.2 SemVer 规则

- **X（major）**：不兼容大改（如 v1 web → v2 API 不向后兼容）
- **Y（minor）**：新功能
- **Z（patch）**：bug 修复

### 4.3 维护位置

`versionCode` / `versionName` 在两处：
- `package.json`（顶层 `"version"`）
- `android/app/build.gradle`（`defaultConfig.versionCode` + `defaultConfig.versionName`）

**同步方式**：手动同步两处（或者未来加 npm script `npm run sync-version` 自动从 package.json 写入 build.gradle）。

当前 ffnmv 状态：`1.3.1`（versionCode=1）

---

## 5. 常用命令速查

### 5.1 本地构建

```bash
# web 构建（无 cap sync）
npm run build

# web 构建 + cap sync（修改了 capacitor.config 或 web 资产后必跑）
npm run build:android

# web 构建 + cap sync，mode=test（连 ffn-test.aicyber.chat）
npm run build:android:test

# 出 debug APK（开发时本地用）
npm run android:apk

# 出 release AAB（Play Store 上传用，需 keystore）
npm run android:bundle
```

### 5.2 调试

```bash
# 查看 keystore 是否在
git check-ignore -v android/keystore/ffnmv-release.keystore

# 模拟器/真机调试
npx cap run android
```

### 5.3 CI 验证

`.github/workflows/android-ci.yml` 自动跑：
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run build:android:test` + 检查 `android/app/src/main/assets/` 是否与 dist/ 一致

PR 不通过 CI 不能 merge。

---

## 6. 安全检查清单（每次发版前自检）

- [ ] keystore 文件**未**进 git（`git status` 看不到）
- [ ] `~/.gradle/gradle.properties` 含 `KEYSTORE_PASSWORD` 和 `KEY_PASSWORD`
- [ ] `android/app/build.gradle` 的 `signingConfigs.release` 引用 `KEYSTORE_PASSWORD` / `KEY_PASSWORD` 环境变量
- [ ] `versionCode` 比上一版 +1
- [ ] `versionName` 与 package.json 同步
- [ ] CI 在 main + dev-android 触发，全绿
- [ ] release AAB 由 `bundleRelease` 出（不是 `assembleDebug`）
- [ ] `assembleRelease` 后用 apkanalyzer 检查 APK 大小（arm64-v8a ≤ 8MB）
- [ ] 第一版上线时启用 Google Play App Signing

---

## 7. 故障排查

### 7.1 Android 启动白屏

1. `adb logcat | grep -i "chromium\|webview"` 看 console 错误
2. 确认 `dist/index.html` 资源路径都是 `./`（相对）
3. 确认 `cap sync` 跑过（dist/ 已复制到 `android/app/src/main/assets/public/`）

### 7.2 Realtime 连不上

用 `scripts/diag-realtime.sh`（仓库根目录）：

```bash
DOMAIN=ffn.aicyber.chat bash scripts/diag-realtime.sh
```

排查：A 网络 / B 协议（WebSocket upgrade 101）/ C 反向代理 / D 服务 / E 直连。

### 7.3 登出后数据残留

按 plan §3 验收：
```bash
adb shell run-as com.aicyber.ffnmv ls shared_prefs/
```
应不含 ffn 相关。

如果还有残留：检查 `src/lib/auth.js` 的 `purgeAllLocalData` 是否在 `signOutAndCleanup` 链路里被调用。

---

## 8. 相关文档

- `docs/plan-android.md` —— Android v3 迁移计划
- `scripts/diag-realtime.sh` —— Realtime 链路排查脚本
- `docs/android-maintain.md` —— 本文档
- 附录 D（Data Safety 模板）见 `docs/plan-android.md` 末尾，Play Console 上架时填
