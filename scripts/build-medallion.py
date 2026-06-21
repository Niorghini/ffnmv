#!/usr/bin/env python3
"""
把 cow logo 做成"奖章"风格图标：
- 米黄背景
- 外圈黄色光环
- cow 居中

输出 2048x2048 PNG，cow 部分透明（白底 → 透明），这样后续 generate-android-assets.sh
能直接用。

用法：python3 scripts/build-medallion.py <input.png> <output.png> [size]
"""
import sys
from PIL import Image, ImageDraw


# 配色（参考 Image #7 的效果）
CREAM = (255, 245, 220)   # 米黄背景 #FFF5DC
RING = (255, 200, 60)     # 金黄光环 #FFC83C
RING_THICKNESS = 70        # 环粗细
RING_INSET = 110           # 环距边距离
COW_INNER_PAD = 0          # cow 距内边的 padding（0 = cow 填满内圈）


def make_white_transparent(cow_rgba):
    """cow PNG 的白底改成透明（不然叠加到米黄上会出现白边）"""
    pixels = cow_rgba.load()
    w, h = cow_rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if r > 240 and g > 240 and b > 240:
                pixels[x, y] = (255, 255, 255, 0)
    return cow_rgba


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    src = sys.argv[1]
    dst = sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 2048

    # 1. 加载 cow（白底）
    cow = Image.open(src).convert('RGBA')
    cow = make_white_transparent(cow)

    # 2. 画米黄底
    canvas = Image.new('RGBA', (size, size), CREAM + (255,))

    # 3. 画黄色环
    draw = ImageDraw.Draw(canvas)
    draw.ellipse(
        [RING_INSET, RING_INSET, size - RING_INSET, size - RING_INSET],
        outline=RING + (255,),
        width=RING_THICKNESS,
    )

    # 4. cow 居中（缩到环内）
    inner_size = size - 2 * (RING_INSET + RING_THICKNESS + COW_INNER_PAD)
    cow_resized = cow.resize((inner_size, inner_size), Image.LANCZOS)
    ox = (size - cow_resized.width) // 2
    oy = (size - cow_resized.height) // 2
    canvas.paste(cow_resized, (ox, oy), cow_resized)

    # 5. 输出（转 RGB，去 alpha —— launchers 期望 RGB）
    canvas.convert('RGB').save(dst, 'PNG')
    print(f"✅ 输出: {dst} ({size}x{size})")
    print(f"   配色: 背景 #{CREAM[0]:02X}{CREAM[1]:02X}{CREAM[2]:02X}, 环 #{RING[0]:02X}{RING[1]:02X}{RING[2]:02X}")


if __name__ == '__main__':
    main()
