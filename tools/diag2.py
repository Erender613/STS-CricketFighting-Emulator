# -*- coding: utf-8 -*-
"""诊断 _n_img1.png：定位黑矩形边界 + 量剑身横截面层次。"""
import os, io
from PIL import Image

PV = r"C:\Users\shenl\Desktop\new\tools\预览图"
im = Image.open(os.path.join(PV, "_n_img1.png")).convert("RGB")
W, H = im.size
px = im.load()
BUF = io.StringIO()
def P(*a): BUF.write(" ".join(str(x) for x in a) + "\n")
P("图幅 %dx%d" % (W, H))

def verydark(c): return c[0] < 25 and c[1] < 28 and c[2] < 34

# 黑矩形：找连续的很暗区域
ys, xs = [], []
for y in range(0, H, 2):
    for x in range(0, W, 2):
        if verydark(px[x, y]):
            xs.append(x); ys.append(y)
if xs:
    P("「近黑」像素范围 x %d..%d (宽%d)   y %d..%d (高%d)  抽样数 %d" %
      (min(xs), max(xs), max(xs) - min(xs) + 1, min(ys), max(ys), max(ys) - min(ys) + 1, len(xs)))
# 逐行看黑区左右边界，确认是不是矩形
P("")
P("  黑区逐行左右边界（每 40 行）:")
for y in range(100, 500, 40):
    row = [x for x in range(0, W) if verydark(px[x, y])]
    if row:
        P("     y=%3d  x %4d..%4d   (断点处:%s)" % (y, min(row), max(row),
          "有" if max(row) - min(row) + 1 != len(row) else "无"))

P("")
P("  沿 x 的水平扫描（剑身中段）:")
for y in (185, 250, 320, 385):
    P("  --- y=%d" % y)
    prev = None
    for x in range(280, 1100, 2):
        c = px[x, y]
        k = (c[0] // 18, c[1] // 18, c[2] // 18)
        if k != prev:
            P("     x=%4d  #%02x%02x%02x" % (x, c[0], c[1], c[2]))
            prev = k

P("")
P("  垂直扫描（剑身横截面）:")
for x in (700, 900):
    P("  --- x=%d" % x)
    prev = None
    for y in range(100, 470, 1):
        c = px[x, y]
        k = (c[0] // 18, c[1] // 18, c[2] // 18)
        if k != prev:
            P("     y=%3d  #%02x%02x%02x  lum=%3.0f" % (y, c[0], c[1], c[2],
              0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]))
            prev = k

with open(os.path.join(PV, "_diag2.txt"), "w", encoding="utf-8") as f:
    f.write(BUF.getvalue())
