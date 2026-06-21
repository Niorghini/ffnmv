#!/usr/bin/env python3
"""
vivo-compatible 图标生成器：
- 纯色背景（#F2F2F2 浅灰，匹配 vivo 默认）
- cow 居中，缩放到 25% 安全区域
- 输出 1024x1024 直接当 launcher icon

用法：python3 scripts/build-vivo-icon.py
"""
from PIL import Image, ImageDraw

SRC = '/Users/niorghini/Downloads/logo-appicon-v1.png'
DST = '/tmp/vivo-icon.png'
SIZE = 1024
BG_COLOR = (242, 242, 242)  # vivo 系统默认浅灰

# 1. 抠 cow（用饱和度检测，去白底 + 水印）
img = Image.open(SRC).convert('RGBA')
pixels = img.load()
w, h = img.size

xmin, ymin, xmax, ymax = w, h, 0, 0
for y in range(h):
    for x in range(w):
        r, g, b = pixels[x, y][:3]
        is_blue = b > 100 and r < 100 and g < 150
        is_yellow = r > 200 and g > 150 and b < 100
        if is_blue or is_yellow:
            xmin = min(xmin, x); xmax = max(xmax, x)
            ymin = min(ymin, y); ymax = max(ymax, y)

# crop cow（不加 margin，只要精确边界内的 cow）
cow = img.crop((xmin, ymin, xmax + 1, ymax + 1))
cw, ch = cow.size
cp = cow.load()
for y in range(ch):
    for x in range(cw):
        r, g, b, a = cp[x, y]
        # 饱和度检测 → 非 cow 像素透明
        if max(r, g, b) - min(r, g, b) < 100:
            cp[x, y] = (255, 255, 255, 0)

print(f"cow 原始: {cw}x{ch}")

# 2. cow 缩放到画布的 25%（vivo 安全区约 25-30%）
#    vivo 的 launcher icon 实际显示器范围约 72dp（out of 108dp = 66%）
#    cow 占 72dp 的 35% = 25dp → 画布 108dp 占比 23%
TARGET_COW_PCT = 0.40
cow_target_px = int(SIZE * TARGET_COW_PCT)
cow_resized = cow.resize((cow_target_px, cow_target_px), Image.LANCZOS)

# 3. 浅灰底 + cow 居中
bg = Image.new('RGBA', (SIZE, SIZE), BG_COLOR + (255,))
ox = (SIZE - cow_resized.width) // 2
oy = (SIZE - cow_resized.height) // 2
bg.paste(cow_resized, (ox, oy), cow_resized)

# 4. 输出
bg.save(DST)
print(f"输出: {DST} ({SIZE}x{SIZE}, BG=#{BG_COLOR[0]:02X}{BG_COLOR[1]:02X}{BG_COLOR[2]:02X})")
