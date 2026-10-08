# -*- coding: utf-8 -*-
"""量测 sp_demon_hand.png 的"前臂"几何：质心 u、半宽。
作用：drawWristDust 的粒子云要以"前臂轴线"为中心，
     而轴线是贴图里 u = U_C 那条线（不是画图原点的 U0）。"""
import numpy as np
from PIL import Image

P = r"C:\Users\shenl\Desktop\new\assets\baked\sp_demon_hand.png"
im = Image.open(P).convert("RGBA")
a = np.asarray(im).astype(float)
al = a[..., 3] / 255.0
H, W = al.shape
print("贴图 %dx%d" % (W, H))

print("按 v（前臂 root=0 → 指尖）分段：")
for k0, k1 in [(0.00, 0.06), (0.06, 0.12), (0.12, 0.20), (0.20, 0.30), (0.30, 0.45)]:
    y0, y1 = int(k0 * H), max(int(k1 * H), int(k0 * H) + 1)
    sub = al[y0:y1]
    col = sub.sum(axis=0)              # 每列的总 alpha
    tot = col.sum()
    if tot <= 0:
        continue
    cu = float((col * np.arange(W)).sum() / tot)
    rows = [r for r in range(sub.shape[0]) if (sub[r] > 0.4).any()]
    hws = []
    for r in rows:
        nz = np.nonzero(sub[r] > 0.4)[0]
        hws.append((nz.max() - nz.min() + 1) / 2.0)
    print("  v %4d..%-4d  质心 u=%.1f   墨迹行数=%d   平均半宽=%.1f"
          % (y0, y1, cu, len(rows), (sum(hws) / len(hws)) if hws else -1))
