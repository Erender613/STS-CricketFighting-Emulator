# -*- coding: utf-8 -*-
"""从原版参考截图里量出君剑的：几何比例 + 剑身横截面层次配色。"""
import os, io
from PIL import Image

PV = r"C:\Users\shenl\Desktop\new\tools\预览图"
BUF = io.StringIO()
def P(*a): BUF.write(" ".join(str(x) for x in a) + "\n")

def luma(c): return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

def analyze(fn, tag):
    im = Image.open(os.path.join(PV, fn)).convert("RGB")
    W, H = im.size
    px = im.load()
    P("=" * 78)
    P("%s   %s   %dx%d" % (tag, fn, W, H))
    P("=" * 78)

    def blue(c):
        r, g, b = c
        return b - r > 22 and b > 55

    # 每列的蓝色像素 y 范围 → 描出剑身剪影
    cols = []
    for x in range(W):
        ys = [y for y in range(H) if blue(px[x, y])]
        if ys:
            cols.append((x, min(ys), max(ys), len(ys)))
    if not cols:
        P("  未找到蓝色剑身"); return
    x0 = cols[0][0]; x1 = cols[-1][0]
    P("  剑身横向跨度 x: %d..%d  (长 %d px = 图宽%.0f%%)" % (x0, x1, x1 - x0 + 1, 100.0 * (x1 - x0 + 1) / W))

    # 逐列高度（每 5% 长度采一次）
    P("  沿剑长的『厚度』轮廓（每 5%% 采一次）: ")
    prof = []
    for k in range(0, 21):
        x = int(x0 + (x1 - x0) * k / 20)
        hit = [c for c in cols if c[0] == x]
        if not hit:
            prof.append((k * 5, None, None)); continue
        _, ymin, ymax, n = hit[0]
        prof.append((k * 5, ymax - ymin + 1, ymin))
    line = "    "
    for pct, h, ymin in prof:
        line += "%3d%%:%3s  " % (pct, "-" if h is None else h)
        if pct % 25 == 0 and pct:
            P(line); line = "    "
    P(line)

    hs = [h for _, h, _ in prof if h]
    P("  厚度: 最大 %d, 最小 %d" % (max(hs), min(hs)))

    # 取一条在剑身中段的横截面，逐像素打印色带
    xm = int(x0 + (x1 - x0) * 0.45)
    ys = [y for y in range(H) if blue(px[xm, y])]
    ya, yb = min(ys), max(ys)
    P("")
    P("  横截面 x=%d（距剑格 %.0f%%）y=%d..%d 逐行颜色:" % (xm, 45, ya, yb))
    prev = None
    for y in range(ya, yb + 1):
        c = px[xm, y]
        P("     y=%4d  RGB%-16s  #%02x%02x%02x  lum=%5.0f" % (y, str(c), c[0], c[1], c[2], luma(c)))

    # 纵向（沿剑长）中线颜色渐变
    yc = (ya + yb) // 2
    P("")
    P("  沿剑长中线 y=%d 的颜色（每 10%%）:" % yc)
    for k in range(0, 11):
        x = int(x0 + (x1 - x0) * k / 10)
        c = px[x, yc]
        P("     x=%4d (%3d%%)  RGB%-16s lum=%5.0f" % (x, k * 10, str(c), luma(c)))

    # 橙色部分（剑柄/装饰）
    def orange(c):
        r, g, b = c
        return r - b > 40 and r > 100
    oxs = []; oys = []
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            if orange(px[x, y]):
                oxs.append(x); oys.append(y)
    if oxs:
        P("")
        P("  橙色（剑柄/装饰）范围 x %d..%d (宽%d)  y %d..%d (高%d)" %
          (min(oxs), max(oxs), max(oxs) - min(oxs) + 1,
           min(oys), max(oys), max(oys) - min(oys) + 1))
        P("  → 剑柄高 : 剑身长 = %.2f" % ((max(oys) - min(oys) + 1) / float(x1 - x0 + 1)))
        P("  → 剑柄宽 : 剑身长 = %.2f" % ((max(oxs) - min(oxs) + 1) / float(x1 - x0 + 1)))
    # 白色高光/爆闪
    def white(c):
        return min(c) > 205
    wxs = []; wys = []
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            if white(px[x, y]):
                wxs.append(x); wys.append(y)
    if wxs:
        P("  高光（白）范围 x %d..%d  y %d..%d   像素数(抽样) %d" %
          (min(wxs), max(wxs), min(wys), max(wys), len(wxs)))

analyze("ref_181254.png", "原版参考 A")
P("")
analyze("ref_181203.png", "原版参考 B")

with open(r"C:\Users\shenl\Desktop\new\tools\_ref_geom.txt", "w", encoding="utf-8") as f:
    f.write(BUF.getvalue())
print("ok")
