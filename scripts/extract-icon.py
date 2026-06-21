#!/usr/bin/env python3
"""
从 logo PNG 自动裁切出 cow，去掉深灰圆环 + 多余白边，输出方形居中 PNG。

算法：
1. 读 PNG 转 RGB
2. 识别 cow 像素：非白 + 非深灰（深灰是设计者画的圆环，launcher 自己也加 mask 不要）
3. 找 cow 的 bounding box
4. 加 8% padding 留出安全区
5. 输出 2048x2048 白色背景 + cow 居中

用法：python3 scripts/extract-icon.py <input.png> <output.png> [size]
"""
import sys
from PIL import Image


def is_cow_pixel(r, g, b):
    """cow = 非白 AND 非深灰"""
    # 非白
    if r > 240 and g > 240 and b > 240:
        return False
    # 非深灰（r/g/b 都低且差值小）
    if r < 100 and g < 100 and b < 100:
        if abs(r - g) < 30 and abs(g - b) < 30:
            return False
    return True


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    src = sys.argv[1]
    dst = sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 2048

    img = Image.open(src).convert('RGB')
    w, h = img.size
    print(f"源图: {w}x{h}")

    # 扫描找 cow bbox（用 PIL 的 getdata 慢但可靠）
    pixels = img.load()
    xmin, ymin, xmax, ymax = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            if is_cow_pixel(r, g, b):
                if x < xmin: xmin = x
                if x > xmax: xmax = x
                if y < ymin: ymin = y
                if y > ymax: ymax = y

    if xmax < xmin:
        print("❌ 没找到 cow 像素")
        sys.exit(1)

    cow_w = xmax - xmin + 1
    cow_h = ymax - ymin + 1
    print(f"cow bbox: x=[{xmin},{xmax}] y=[{ymin},{ymax}] → {cow_w}x{cow_h}")

    # 8% padding
    pad_pct = 0.08
    pad_w = int(cow_w * pad_pct)
    pad_h = int(cow_h * pad_pct)
    crop_x0 = max(0, xmin - pad_w)
    crop_y0 = max(0, ymin - pad_h)
    crop_x1 = min(w, xmax + pad_w + 1)
    crop_y1 = min(h, ymax + pad_h + 1)
    print(f"crop（含 padding）: ({crop_x0},{crop_y0})→({crop_x1},{crop_y1})")

    cropped = img.crop((crop_x0, crop_y0, crop_x1, crop_y1))
    cw, ch = cropped.size
    print(f"裁后: {cw}x{ch}")

    # pad 成方形（用较短边为基准，添加白边）
    side = max(cw, ch)
    square = Image.new('RGB', (side, side), (255, 255, 255))
    square.paste(cropped, ((side - cw) // 2, (side - ch) // 2))

    # resize 到目标 size
    if side != size:
        square = square.resize((size, size), Image.LANCZOS)
    square.save(dst, 'PNG')
    print(f"✅ 输出: {dst} ({size}x{size})")


if __name__ == '__main__':
    main()
