# -*- coding: utf-8 -*-
"""分析 spooky_hand.png（夜魇之手）的朝向与几何：
 - 逐行统计"不透明像素数"和"连通块数"：指尖端 = 多个窄块（分离的手指），腕端 = 单个宽块。
 - 判定期望：据此决定贴图该以哪一端为"根部"锚在黑洞上。
"""
import os
import numpy as np
from PIL import Image

SRC = r"C:\Users\shenl\Desktop\new\assets\vfx\spooky_hand.png"
im = Image.open(SRC).convert("RGBA")
bb = im.getbbox()
im = im.crop(bb)
a = np.asarray(im)
alpha = a[..., 3]
h, w = alpha.shape
print("裁掉留白后尺寸: %dx%d" % (w, h))

mask = alpha > 40


def runs(row):
    """返回该行不透明区间的个数。"""
    idx = np.nonzero(row)[0]
    if len(idx) == 0:
        return 0
    return 1 + int(np.sum(np.diff(idx) > 2))


print("\n 行号  占比   不透明宽   块数   |  横向跨度(x0..x1)")
step = max(1, h // 26)
for y in range(0, h, step):
    row = mask[y]
    n = int(row.sum())
    if n == 0:
        print("  %4d  %5.2f     0        0" % (y, y / h))
        continue
    idx = np.nonzero(row)[0]
    print("  %4d  %5.2f   %5d     %3d   |  %d..%d" % (y, y / h, n, runs(row), idx[0], idx[-1]))

# 上半 / 下半 的平均块数与平均宽度
def region_stats(y0, y1):
    tot = 0
    cnt = 0
    width = 0
    for y in range(y0, y1):
        row = mask[y]
        n = int(row.sum())
        if n:
            tot += runs(row)
            width += n
            cnt += 1
    return (tot / cnt, width / cnt, cnt) if cnt else (0, 0, 0)

t = region_stats(0, h // 3)
b = region_stats(h * 2 // 3, h)
print("\n上 1/3: 平均块数 %.2f  平均不透明宽 %.1f  (有效行 %d)" % t)
print("下 1/3: 平均块数 %.2f  平均不透明宽 %.1f  (有效行 %d)" % b)
print("\n判据: 块数多、宽度小的一端 = 指尖；块数少、宽度大的一端 = 腕/掌。")
print("结论: 指尖在【%s】" % ("上端 (y 小)" if t[0] > b[0] else "下端 (y 大)"))

# 不透明区平均色 & 峰值色
sel = a[alpha > 40]
print("\n不透明像素 %d 个，平均 RGBA = (%d,%d,%d,%d)"
      % (len(sel), sel[:, 0].mean(), sel[:, 1].mean(), sel[:, 2].mean(), sel[:, 3].mean()))
print("RGBA 最大值 =", sel.max(axis=0))
