# 待办事宜

> 更新于 2026-06-21，Android v1.0 首发后

---

## 一、CI/CD

| # | 事项 | 优先级 | 说明 |
|---|---|---|---|
| 1 | **GitHub Actions 自动出 APK** | 中 | push tag 时自动跑 `gradle assembleRelease`，上传 APK 到 Release。需 CI 装 JDK 21 + Android SDK（~2GB），GitHub Actions 公开仓库免费分钟数够用。建议只打 tag 时触发（`on: push: tags: v*`） |
| 2 | **自动版本号** | 低 | `versionCode` 用 CI build number 自增，`versionName` 读 `package.json`。当前手动维护两处（`package.json` + `build.gradle`） |

---

## 二、效率验证（真机测试，plan §4 指标）

| # | 指标 | 目标 | 当前状态 | 验证方式 |
|---|---|---|---|---|
| 3 | 冷启到首屏 | ≤ 1.8s | 未测 | `adb logcat` 计时 |
| 4 | 1000 条笔记列表 | 60fps | 未测 | WebView 滚动 Profile |
| 5 | 后台 5min 回前台 | 30s 内全量同步 | 未测 | 手动建笔记 → 切后台 → 回前台 |
| 6 | 4G 100 条 push | ≤ 8s | 未测 | Charles 网络模拟 |
| 7 | 升级 APK | 首启无旧页面残留 | 未测 | 新 versionCode 覆盖安装 |

---

## 三、已完成的 plan 项目（备查）

| Phase | 内容 | 状态 |
|---|---|---|
| Phase 1 | Capacitor 接入 | ✅ |
| Phase 1.5 | .gitignore + .env.example | ✅ |
| Phase 2 | Vite 适配 | ✅ |
| Phase 2.1 | HashRouter for native | ✅ |
| Phase 3 | Supabase 安全 & 网络 | ✅ |
| Phase 3.5 | 登出全量清理 | ✅ |
| Phase 4 | Android 工程配置 | ✅ |
| Phase 4.5 | 构建脚本 | ✅ |
| Phase 4.6 | OfflineBoundary | ✅ |
| Phase 5 | keystore + 签名 | ✅ |
| Phase 5.5 | SecureStorage mock | ✅ |
| Phase 9 | CI/CD 基础 | ✅ |
| Phase 10 | 运维文档 | ✅ |
| Phase 6 | Google Play 上架 | ❌ 跳过（用户不需要） |

---

## 四、远期路线（plan §8，不在本次范围）

- iOS：`npx cap add ios` + Apple Developer
- 离线优先：迁移到 PowerSync
- App Widget：Android 桌面快速记录入口
- 推送：FCM
- 热更新
- 平板自适应
- 防截屏 `FLAG_SECURE`
