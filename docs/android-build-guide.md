# ffnmv Android 首次出包指南

> 范围：在 macOS / Linux 本机从源码出第一个能装的 release APK
> 关联：`docs/android-maintain.md`（日常运维 + 故障排查）、`docs/plan-android.md`（迁移计划）
> 读者：开发者（首次执行可能需要 30-60 分钟，含下载时间）

---

## 0. 适用场景

**你不需要 Google Play**，只想直接分发 APK 给用户（侧载 / 文件传输 / 自己的下载页）。

最终产物：
- `android/app/build/outputs/apk/release/app-release.apk` —— **这个就是给你的用户的文件**

---

## 1. 前置条件（一次性）

### 1.1 JDK 17

Capacitor 8 + Android Gradle Plugin 8.x 需要 JDK 17。

**macOS**（用 Homebrew）：
```bash
brew install --cask temurin@17
# 验证
/usr/libexec/java_home -v 17
# 应该输出类似：/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
```

**Linux**（Ubuntu/Debian）：
```bash
sudo apt update
sudo apt install openjdk-17-jdk
java -version   # 应显示 17.x
```

### 1.2 Android SDK

**macOS**（两种方式选一种）：

**方式 A：brew（最简单）**
```bash
brew install --cask android-commandlinetools

# ⚠️ brew 把 SDK 装在 /opt/homebrew/share/android-commandlinetools/，**不是** ~/Library/Android/sdk
# 用下面的命令自动探测真实路径：
SDK_ROOT=$(brew --prefix android-commandlinetools)
echo "SDK 装在: $SDK_ROOT"

# 设环境变量（追加到 ~/.zshrc）
export ANDROID_HOME="$SDK_ROOT"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
export JAVA_HOME=$(/usr/libexec/java_home -v 17)

source ~/.zshrc
```

**方式 B：手动下载（标准路径 `~/Library/Android/sdk`）**
```bash
# 1. 创建目录
mkdir -p $HOME/Library/Android/sdk/cmdline-tools
cd /tmp
# 见 https://developer.android.com/studio#command-line-tools-only 获取最新 URL
curl -O https://dl.google.com/android/repository/commandlinetools-mac-13114758_latest.zip
unzip commandlinetools-mac-*.zip
mv cmdline-tools $HOME/Library/Android/sdk/cmdline-tools/latest
rm commandlinetools-mac-*.zip

# 2. 设环境变量
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
export JAVA_HOME=$(/usr/libexec/java_home -v 17)

source ~/.zshrc
```

**安装 SDK 组件**（两种方式都跑这个）：
```bash
# 接受 license
yes | sdkmanager --licenses

# 装 platforms;android-36（Capacitor 8 默认 target SDK）+ build-tools + platform-tools（adb 在这里）
sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"
```

**Linux**：
```bash
# 下载 cmdline-tools
mkdir -p $HOME/android-sdk/cmdline-tools
cd $HOME/android-sdk/cmdline-tools
# 见 https://developer.android.com/studio#command-line-tools-only 获取最新 URL
curl -O https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip
unzip commandlinetools-mac-*.zip
mv cmdline-tools latest
rm commandlinetools-mac-*.zip

export ANDROID_HOME="$HOME/android-sdk"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# 同上装组件
yes | sdkmanager --licenses
sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"
```

### 1.3 验证环境

```bash
node -v        # ≥ 18
java -version  # 17.x
echo $ANDROID_HOME   # 应该是 brew 路径或 ~/Library/Android/sdk（看 §1.2 选的哪种）
which adb            # 应输出 $ANDROID_HOME/platform-tools/adb
adb version          # Android Debug Bridge Version 1.0.x
sdkmanager --list_installed  # 应含 platforms;android-36、build-tools;36.0.0、platform-tools
```

**如果 `which adb` 找不到**：ANDROID_HOME 设错了。回 §1.2 看是 brew 方式还是手动方式，路径对不上导致 platform-tools 找不到。

---

## 2. 生成签名密钥（一次性，灾难级重要）

```bash
cd /Users/niorghini/ffnapp/ffnmv  # 项目根目录

# 生成 keystore
keytool -genkey -v \
  -keystore android/keystore/ffnmv-release.keystore \
  -alias ffnmv \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

**期间会问**：
- `Enter keystore password: ` — **记到 1Password**（之后叫 `KEYSTORE_PASSWORD`）
- `Re-enter new password: ` — 再输入一次
- `What is your first and last name?` — 随便填
- ... 后面几项证书信息都随便填
- `Enter key password for <ffnmv>: ` — **可与 keystore 密码相同**（之后叫 `KEY_PASSWORD`），记到 1Password

### 备份 keystore（立刻做！）

`ffnmv-release.keystore` 丢失 = 灾难。你必须**立刻**备份到至少 3 处：

1. **1Password** "ffnmv-prod" vault —— 上传 .keystore 文件 + 记两个密码
2. **加密 USB** —— 拷贝 .keystore 文件，物理隔离保管
3. **Google Cloud Secret Manager** 或同类 KMS —— 加密托管

每处都记录：keystore 文件 + `KEYSTORE_PASSWORD` + `KEY_ALIAS=ffnmv` + `KEY_PASSWORD`。

---

## 3. 配本地环境变量

`~/.gradle/gradle.properties`（**不是项目内**，是用户目录的 gradle 全局配置）：

```bash
mkdir -p ~/.gradle
cat >> ~/.gradle/gradle.properties <<'EOF'
KEYSTORE_PASSWORD=<从 1Password 取>
KEY_PASSWORD=<从 1Password 取>
EOF
```

> ⚠️ 不要把这个文件 commit 到 git。它在用户目录 `~/.gradle/`，不在项目里。

---

## 4. 出 release APK

回到项目根目录：

```bash
cd /Users/niorghini/ffnapp/ffnmv

# 1. web 构建 + 同步到 android/
npm run build:android

# 2. 出 release APK
npm run android:apk:release
```

第一次跑会下载 Gradle 8.x + Android Gradle Plugin 依赖，约 2-5 分钟（取决于网速）。之后会缓存。

### 出包位置

```
android/app/build/outputs/apk/release/
├── app-release.apk              ← 这个就是给用户的
├── app-release.apk.sha256       ← 校验和
└── output-metadata.json
```

### 验证 APK

```bash
# 查 APK 信息（用 build-tools 里的 aapt）
$ANDROID_HOME/build-tools/36.0.0/aapt dump badging android/app/build/outputs/apk/release/app-release.apk | head -20

# 期望看到：
# package: name='com.aicyber.ffnmv' versionCode='1' versionName='1.3.1'
# application-label:'发法牛'
# sdkVersion:'24'  (minSdk)
# targetSdkVersion:'36'
```

### 安装到手机

**方式 A：USB 调试**
```bash
# 手机开 USB 调试（开发者选项），连电脑
adb devices  # 确认设备显示
adb install android/app/build/outputs/apk/release/app-release.apk
```

**方式 B：直接发文件**
把 `app-release.apk` 上传到网盘 / 通过 AirDrop / 微信文件传输助手发给用户。用户下载后：
- Android 默认会拦截，需要"允许来自此来源的应用"（设置里允许）
- 点击 APK 安装
- 桌面上出现"发法牛"图标

---

## 5. 常用命令速查

```bash
# 出 debug APK（开发用，体积大、自签、未压缩）
npm run android:apk

# 出 release APK（用户用，体积小、R8 压缩、用你的 keystore 签）
npm run android:apk:release

# 出 release AAB（Google Play 用，**你不是用这个**）
npm run android:bundle

# 出 test 模式 APK（连 ffn-test.aicyber.chat 后端）
npm run build:android:test && npm run android:apk:release
# 然后手机装这个 APK，登录后同步会打到 test 后端

# 清理 build 产物
cd android && ./gradlew clean
```

---

## 6. 故障排查

### 6.1 `adb: command not found`

`platform-tools` 没装或 `ANDROID_HOME` 设错路径。两种修法：

```bash
# 修法 A：ANDROID_HOME 路径错（brew 用户最常见）
# brew 把 SDK 装在 /opt/homebrew/share/，不是 ~/Library/Android/sdk
SDK_ROOT=$(brew --prefix android-commandlinetools)
echo "真实路径: $SDK_ROOT"
export ANDROID_HOME="$SDK_ROOT"
export PATH="$PATH:$ANDROID_HOME/platform-tools"
source ~/.zshrc
adb version   # 应该工作了

# 修法 B：platform-tools 真的没装
sdkmanager "platform-tools"
# 然后确认 ANDROID_HOME 路径里能找到
ls $ANDROID_HOME/platform-tools/adb
```

### 6.2 `SDK location not found`

`ANDROID_HOME` 没设或路径错：
```bash
echo $ANDROID_HOME
# 应输出你的 SDK 路径
```

### 6.3 `Could not find tools.jar`

JDK 装了 11 但 Capacitor 8 要 17。检查 `java -version`，重装 17。

### 6.4 `Keystore was tampered with, or password was incorrect`

`~/.gradle/gradle.properties` 里的密码与生成 keystore 时设的不一致。重新设：
```bash
cat ~/.gradle/gradle.properties
# 确认 KEYSTORE_PASSWORD / KEY_PASSWORD 与 1Password 里的匹配
```

### 6.5 gradle build 报网络错误

可能 SDK 组件没下完。重新跑：
```bash
sdkmanager --list_installed
# 缺什么装什么
sdkmanager "platforms;android-36" "build-tools;36.0.0"
```

### 6.6 APK 装上但启动白屏

```bash
# 1. 看 console 错误
adb logcat | grep -iE "chromium|webview|console"

# 2. 确认 cap sync 跑过
ls android/app/src/main/assets/public/
# 应有 index.html 和 assets/ 目录

# 3. 重新跑
npm run build:android
npm run android:apk:release
```

### 6.7 APK 装上但 Realtime 连不上

```bash
DOMAIN=ffn.aicyber.chat bash scripts/diag-realtime.sh
```
按脚本输出逐项排查（WebSocket upgrade 101 / nginx / supabase 容器）。

---

## 7. 下次再出包（升级版）

修改代码后：

```bash
# 1. 改 src/ 下的代码
# 2. 改 android/app/build.gradle 的 versionCode +1 和 versionName
# 3. 提交 + push
git add -A
git commit -m "release: 1.3.2 - 修复 xx bug"
git push origin dev-android

# 4. 出新包
npm run build:android
npm run android:apk:release

# 5. 分发给用户（覆盖安装，versionCode 必须 +1 否则装不上）
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

---

## 8. 关联文档

- `docs/plan-android.md` —— 完整迁移计划
- `docs/android-maintain.md` —— 日常运维（签名备份 / 回滚 / 版本号 / Data Safety）
- `scripts/diag-realtime.sh` —— Realtime 链路排查
