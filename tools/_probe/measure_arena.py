# -*- coding: utf-8 -*-
"""量测「竞技场实景」导出位图里的恶魔之手：位置、颜色、可见度。
配合 mkprobe.py 的 hand 模式（4 只手分别放在左/上/右/左墙）。
"""
import numpy as np
from PIL import Image

P = r"C:\Users\shenl\Desktop\new\tools\_probe\_h_img2.png"
im = Image.open(P).convert("RGB")
a = np.asarray(im).astype(np.int16)
H, W = a.shape[:2]
print("竞技场位图 %dx%d" % (W, H))

# 找紫色像素（手 = 加法混合的淡紫；蓝显著高于绿）
r, g, b = a[..., 0], a[..., 1], a[..., 2]
violet = (b - g > 35) & (r - g > 15) & (b > 45)
print("偏紫像素 %d 个（%.2f%%）" % (int(violet.sum()), 100.0 * violet.sum() / violet.size))
if violet.any():
    px = a[violet]
    print("  均值 RGB = (%d, %d, %d)  最亮 = %s"
          % (px[:, 0].mean(), px[:, 1].mean(), px[:, 2].mean(), px.max(axis=0)))
    ys, xs = np.nonzero(violet)
    print("  bbox x %d..%d  y %d..%d" % (xs.min(), xs.max(), ys.min(), ys.max()))

# 逐块（4 个象限）报告，确认 4 只手都画出来了
print("\n按 2x2 分块统计偏紫像素：")
for name, (y0, y1, x0, x1) in {
    "左上": (0, H // 2, 0, W // 2), "右上": (0, H // 2, W // 2, W),
    "左下": (H // 2, H, 0, W // 2), "右下": (H // 2, H, W // 2, W)}.items():
    sub = violet[y0:y1, x0:x1]
    n = int(sub.sum())
    extra = ""
    if n:
        ys, xs = np.nonzero(sub)
        extra = "  bbox x %d..%d  y %d..%d" % (x0 + xs.min(), x0 + xs.max(), y0 + ys.min(), y0 + ys.max())
    print("  %s  %6d 个%s" % (name, n, extra))

# 整图降采样，看构图
BGISH = int(np.median(a.reshape(-1, 3).sum(axis=1)))
print("\n底色近似亮度合计 = %d" % BGISH)
CW, CH = 96, 34
out = []
for cy in range(CH):
    ya, yb = int(cy * H / CH), max(int(cy * H / CH) + 1, int((cy + 1) * H / CH))
    line = ""
    for cx in range(CW):
        xa, xb = int(cx * W / CW), max(int(cx * W / CW) + 1, int((cx + 1) * W / CW))
        v = violet[ya:yb, xa:xb].mean()
        blk = a[ya:yb, xa:xb]
        lum = blk.sum(axis=2).mean()
        if v > 0.25:
            line += "#"
        elif lum > BGISH + 90:
            line += "+"
        elif lum < BGISH - 90:
            line += "."
        else:
            line += " "
    out.append(line)
print("+" + "-" * CW + "+")
for i, l in enumerate(out):
    print("|" + l + "| y=%4d" % int(i * H / CH))
print("+" + "-" * CW + "+")
print("  # = 偏紫(手/洞)   + = 比底色亮   . = 比底色暗")
