# -*- coding: utf-8 -*-
"""对探针放大图 _A.png 做像素诊断：找黑矩形来源 + 量剑身横截面层次。"""
import os, io
from PIL import Image

PV = r"C:\Users\shenl\Desktop\new\tools\预览图"
im = Image.open(os.path.join(PV, "_A.png")).convert("RGB")
W, H = im.size
px = im.load()
BUF = io.StringIO()
def P(*a): BUF.write(" ".join(str(x) for x in a) + "\n")

P("图幅 %dx%d" % (W, H))

def line(y, x0, x1, step=4):
    P("  y=%d 横向扫描 x=%d..%d:" % (y, x0, x1))
    prev = None; run = 0
    for x in range(x0, x1, step):
        c = px[x, y]
        key = (c[0] // 14, c[1] // 14, c[2] // 14)
        if key == prev:
            run += 1
        else:
            if prev is not None:
                P("     x%4d..%4d  #%02x%02x%02x  (%dpx)" % (xs, x - step, pc[0], pc[1], pc[2], run * step))
            prev = key; pc = c; xs = x; run = 1
    P("     x%4d..%4d  #%02x%02x%02x  (%dpx)" % (xs, x1, pc[0], pc[1], pc[2], run * step))

P("")
P("=" * 70)
P("A. 找那块「黑矩形」的边界")
P("=" * 70)
for y in (60, 100, 150, 200, 240, 300):
    line(y, 0, 460, 6)

P("")
P("=" * 70)
P("B. 剑身横截面（垂直扫描，取剑身中段几条竖线）")
P("=" * 70)
# 先粗找剑身的 x 范围（找青色像素）
def cyanish(c):
    r, g, b = c
    return b > 120 and g > 90 and (b - r) > 40
xs = []
for x in range(W):
    for y in range(0, H, 2):
        if cyanish(px[x, y]):
            xs.append(x); break
P("  青色像素出现在 x %d..%d" % (min(xs), max(xs)) if xs else "  无青色")

for xm in (200, 260, 320):
    P("")
    P("  竖线 x=%d:" % xm)
    prev = None
    for y in range(0, H):
        c = px[xm, y]
        k = (c[0] // 16, c[1] // 16, c[2] // 16)
        if k != prev:
            P("     y=%3d  #%02x%02x%02x  lum=%3.0f" % (y, c[0], c[1], c[2],
              0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]))
            prev = k

P("")
P("=" * 70)
P("C. 剑柄/剑身的横向范围（找橙色 + 青色）")
P("=" * 70)
def orangeish(c):
    r, g, b = c
    return r - b > 45 and r > 95
ox = []; oy = []
for y in range(0, H, 2):
    for x in range(0, 700, 2):
        if orangeish(px[x, y]):
            ox.append(x); oy.append(y)
if ox:
    P("  橙色范围 x %d..%d (宽%d)  y %d..%d (高%d)" %
      (min(ox), max(ox), max(ox) - min(ox) + 1, min(oy), max(oy), max(oy) - min(oy) + 1))

with open(os.path.join(PV, "_diag.txt"), "w", encoding="utf-8") as f:
    f.write(BUF.getvalue())
