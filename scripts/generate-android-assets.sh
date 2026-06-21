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

# 3. Adaptive icon foreground（Android 8+，108dp = 432px on xxhdpi）
#    XML 在 mipmap-anydpi-v26/ 引用 @mipmap/ic_launcher_foreground，所以 foreground PNG 必须放在 mipmap-{density}/
echo ""
echo "=== 生成 adaptive icon foreground（Android 8+，放在 mipmap-{density}）==="
for i in 0 1 2 3 4; do
  density=${DENSITIES[$i]}
  out="android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png"
  sips -z $ADAPTIVE_FG_SIZE $ADAPTIVE_FG_SIZE "$ICON_SRC" --out "$out" > /dev/null
  echo "  ✓ $out (${ADAPTIVE_FG_SIZE}x${ADAPTIVE_FG_SIZE})"
done

# 4. 启动屏（drawable-*/splash.png + drawable/splash.png）
echo ""
echo "=== 生成启动屏 splash 各密度 ==="
# drawable 里放主版本
sips -z ${SPLASH_SIZES[4]} ${SPLASH_SIZES[4]} "$SPLASH_SRC" --out android/app/src/main/res/drawable/splash.png > /dev/null
echo "  ✓ drawable/splash.png (${SPLASH_SIZES[4]}x${SPLASH_SIZES[4]})"

# 各种密度也放（drawable-mdpi 等）
for i in 0 1 2 3 4; do
  density=${DENSITIES[$i]}
  size=${SPLASH_SIZES[$i]}
  out="android/app/src/main/res/drawable-${density}/splash.png"
  sips -z $size $size "$SPLASH_SRC" --out "$out" > /dev/null
  echo "  ✓ drawable-${density}/splash.png (${size}x${size})"
done

echo ""
echo "=== 完成！==="
echo "图标：mipmap-*/ic_launcher.png (5 个密度)"
echo "圆形图标：mipmap-*/ic_launcher_round.png (5 个密度)"
echo "Adaptive foreground：mipmap-anydpi-v26/ + drawable/ic_launcher_foreground.png"
echo "启动屏：drawable-*/splash.png (6 个密度)"
