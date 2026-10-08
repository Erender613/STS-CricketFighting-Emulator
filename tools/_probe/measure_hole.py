# -*- coding: utf-8 -*-
"""量测 zoom 探针里黑洞的椭圆比例：应当「宽 > 高」（和末日降临 DoomHole 的 ctx.scale(1,0.42) 同形）。
背景 zoom 画布是 #151124（亮度和 74），黑洞核心近黑，直接阈值切。"""
import numpy as np
from PIL import Image

P = r"C:\Users\shenl\Desktop\new\tools\_probe\_z_img1.png"
im = Image.open(P).convert("RGB")
a = np.asarray(im).astype(np.int16)
lum = a.sum(axis=2)
print("zoom 位图 %dx%d   背景亮度和中位数 = %d" % (a.shape[1], a.shape[0], np.median(lum)))

DARK = lum < 48          # 明显比背景暗 => 黑洞核心

# 探针里放黑洞的坐标（one(x,y,...) 的 x,y 就是洞心）
HOLES = [("行1 左墙 k=0.8", 30, 150), ("行2 左墙 k=1", 30, 400),
         ("行3 左墙 k=1", 30, 650), ("行4 右区 k=1", 620, 150),
         ("行5 右区 k=0.45", 620, 400)]

print("\n洞心        裁窗内暗像素   宽x高        宽/高")
for name, hx, hy in HOLES:
    x0, x1 = max(0, hx - 90), min(a.shape[1], hx + 90)
    y0, y1 = max(0, hy - 70), min(a.shape[0], hy + 70)
    sub = DARK[y0:y1, x0:x1]
    n = int(sub.sum())
    if n == 0:
        print("  %-16s %6d      --          --" % (name, n))
        continue
    ys, xs = np.nonzero(sub)
    w = xs.max() - xs.min() + 1
    h = ys.max() - ys.min() + 1
    clipx = "  (左被裁)" if hx - 90 < 0 else ("  (右被裁)" if hx + 90 > a.shape[1] else "")
    print("  %-16s %6d      %3dx%-3d      %.2f%s" % (name, n, w, h, w / float(h), clipx))

# 顺带把 4 只手的紫色像素再确认一次（贴图还在）
r, g, b = a[..., 0], a[..., 1], a[..., 2]
violet = (b - g > 35) & (r - g > 15) & (b > 45)
print("\n偏紫像素（手）= %d 个" % int(violet.sum()))
if violet.any():
    px = a[violet]
    print("  均值 RGB = (%d, %d, %d)" % (px[:, 0].mean(), px[:, 1].mean(), px[:, 2].mean()))
