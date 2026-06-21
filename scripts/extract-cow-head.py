#!/usr/bin/env python3
"""
从 logo 抠纯牛头（透明底 + 安全边距），输出多尺寸 + 圆/圆角变体。

输出:
  /tmp/icons/cow-{size}-transparent.png   纯牛头（透明底）
  /tmp/icons/cow-{size}-rounded.png      iOS 22% 圆角方
  /tmp/icons/cow-{size}-circle.png       圆形

尺寸: 1024, 512, 256, 192, 128, 64, 48
"""
import os
from PIL import Image, ImageDraw

SRC = '/Users/niorghini/Downloads/logo-appicon-v1.png'
OUT_DIR = '/tmp/icons'
SIZES = [1024, 512, 256, 192, 128, 64, 48]
MARGIN_PCT = 0.35          # 35% 边距（cow 更小，留白更多）
CORNER_RADIUS_PCT = 0.22   # iOS 风格圆角

os.makedirs(OUT_DIR, exist_ok=True)

# 1. Load source
img = Image.open(SRC).convert('RGBA')
src_w, src_h = img.size
pixels = img.load()

# 2. Find cow bounding box（用颜色识别：蓝 #0066CC~#1E5BC6 + 黄 #FFD700）
#    排除白色背景 + 灰色"豆包AI"水印
xmin, ymin, xmax, ymax = src_w, src_h, 0, 0
for y in range(src_h):
    for x in range(src_w):
        r, g, b = pixels[x, y][:3]
        # 蓝: b 高 + r 低
        is_blue = b > 100 and r < 100 and g < 150
        # 黄: r 高 + g 高 + b 低
        is_yellow = r > 200 and g > 150 and b < 100
        if is_blue or is_yellow:
            xmin = min(xmin, x)
            xmax = max(xmax, x)
            ymin = min(ymin, y)
            ymax = max(ymax, y)

print(f"cow bbox in source: ({xmin},{ymin})→({xmax},{ymax})  size={xmax-xmin}x{ymax-ymin}")

# 3. Crop with safe margin
cow_w = xmax - xmin
cow_h = ymax - ymin
margin = int(max(cow_w, cow_h) * MARGIN_PCT)
new_box = (
    max(0, xmin - margin),
    max(0, ymin - margin),
    min(src_w, xmax + margin + 1),
    min(src_h, ymax + margin + 1),
)
cow = img.crop(new_box)
cw, ch = cow.size
print(f"after margin: {cw}x{ch}")

# 4. Crop 出来的图可能还有白边 / 灰色水印 → 透明化
#    策略：cow 是蓝/黄高饱和度色，背景（白/灰/水印）是不饱和的
#    任何 max(rgb) - min(rgb) < 100 的像素都视为背景 → 透明
cow_pixels = cow.load()
for y in range(ch):
    for x in range(cw):
        r, g, b, a = cow_pixels[x, y]
        if max(r, g, b) - min(r, g, b) < 100:
            cow_pixels[x, y] = (255, 255, 255, 0)

# 5. Output
for size in SIZES:
    # Resize cow to fit
    cow_resized = cow.resize((size, size), Image.LANCZOS)

    # 透明底（牛头本身）
    cow_resized.save(f'{OUT_DIR}/cow-{size}-transparent.png')

    # 圆角方（iOS 22% 圆角）
    radius = int(size * CORNER_RADIUS_PCT)
    rounded_mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(rounded_mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=radius, fill=255
    )
    rounded_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    rounded_img.paste(cow_resized, (0, 0), rounded_mask)
    rounded_img.save(f'{OUT_DIR}/cow-{size}-rounded.png')

    # 圆形
    circle_mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(circle_mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    circle_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    circle_img.paste(cow_resized, (0, 0), circle_mask)
    circle_img.save(f'{OUT_DIR}/cow-{size}-circle.png')

print(f"\nGenerated {len(SIZES) * 3} files in {OUT_DIR}/")
print("Sizes:", SIZES)
print("Shapes: transparent, rounded, circle")
