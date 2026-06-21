#!/usr/bin/env bash
# 用 sips 生成所有 Android 密度变体的图标和启动屏
# 要求：resources/icon.png 1024x1024、resources/splash.png 2732x2732

set -e

ICON_SRC="resources/icon.png"
SPLASH_SRC="resources/splash.png"

# Android 密度与图标尺寸（顺序：mdpi hdpi xhdpi xxhdpi xxxhdpi）
DENSITIES=(mdpi hdpi xhdpi xxhdpi xxxhdpi)
ICON_SIZES=(48 72 96 144 192)
SPLASH_SIZES=(320 480 720 960 1280)
ADAPTIVE_FG_SIZE=432

if [ ! -f "$ICON_SRC" ] || [ ! -f "$SPLASH_SRC" ]; then
  echo "❌ 需要先有 $ICON_SRC (1024x1024) 和 $SPLASH_SRC (2732x2732)"
  exit 1
fi

# 1. ic_launcher.png 各密度
echo "=== 生成 ic_launcher.png 各密度 ==="
for i in 0 1 2 3 4; do
  density=${DENSITIES[$i]}
  size=${ICON_SIZES[$i]}
  out="android/app/src/main/res/mipmap-${density}/ic_launcher.png"
  sips -z $size $size "$ICON_SRC" --out "$out" > /dev/null
  echo "  ✓ mipmap-${density}/ic_launcher.png (${size}x${size})"
done

# 2. ic_launcher_round.png 各密度
echo ""
echo "=== 生成 ic_launcher_round.png 各密度 ==="
for i in 0 1 2 3 4; do
  density=${DENSITIES[$i]}
  size=${ICON_SIZES[$i]}
  out="android/app/src/main/res/mipmap-${density}/ic_launcher_round.png"
  sips -z $size $size "$ICON_SRC" --out "$out" > /dev/null
  echo "  ✓ mipmap-${density}/ic_launcher_round.png (${size}x${size})"
done

# 3. Adaptive icon foreground（Android 8+）
#    只在 mipmap-xxhdpi/ 生成 432x432 1 张，Android 系统自动缩放给低密度
#    之前 5 张完全一样浪费 0.9MB
echo ""
echo "=== 生成 adaptive icon foreground（只 xxhdpi 1 张）==="
out="android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png"
sips -z $ADAPTIVE_FG_SIZE $ADAPTIVE_FG_SIZE "$ICON_SRC" --out "$out" > /dev/null
echo "  ✓ $out (${ADAPTIVE_FG_SIZE}x${ADAPTIVE_FG_SIZE})"

# 清理其他密度的 foreground（防御性）
for density in mdpi hdpi xhdpi xxxhdpi; do
  rm -f "android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png" 2>/dev/null
done

# 4. 启动屏（drawable-*/splash.png + drawable/splash.png）
echo ""
echo "=== 生成启动屏 splash ==="
# 先删掉可能存在的"drawable-{density}"错文件（之前 sips 误把斜杠名当文件名）
for density in "${DENSITIES[@]}"; do
  rm -f "android/app/src/main/res/drawable-${density}" 2>/dev/null
done

# drawable 里放主版本（这个是 styles.xml 实际引用的）
mkdir -p android/app/src/main/res
sips -z ${SPLASH_SIZES[4]} ${SPLASH_SIZES[4]} "$SPLASH_SRC" --out android/app/src/main/res/drawable/splash.png > /dev/null
echo "  ✓ drawable/splash.png (${SPLASH_SIZES[4]}x${SPLASH_SIZES[4]})"

# 只生成最大密度的 splash（drawable-xxxhdpi，1280x1280）—— Android 系统会自动缩放
# 之前 6 张全生成浪费 ~2MB
out_dir="android/app/src/main/res/drawable-xxxhdpi"
mkdir -p "$out_dir"
sips -z ${SPLASH_SIZES[4]} ${SPLASH_SIZES[4]} "$SPLASH_SRC" --out "$out_dir/splash.png" > /dev/null
echo "  ✓ drawable-xxxhdpi/splash.png (${SPLASH_SIZES[4]}x${SPLASH_SIZES[4]})"

echo ""
echo "=== 完成！==="
echo "图标：mipmap-*/ic_launcher.png (5 个密度)"
echo "圆形图标：mipmap-*/ic_launcher_round.png (5 个密度)"
echo "Adaptive foreground：mipmap-anydpi-v26/ + drawable/ic_launcher_foreground.png"
echo "启动屏：drawable-*/splash.png (6 个密度)"
