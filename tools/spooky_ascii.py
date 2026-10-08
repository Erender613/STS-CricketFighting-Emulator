# -*- coding: utf-8 -*-
"""把 spooky_hand.png 的 alpha 掩码降采样成 ASCII 字符画，便于无图形界面下"目视"确认形状朝向。"""
import numpy as np
from PIL import Image

p = r"C:\Users\shenl\Desktop\new\assets\vfx\spooky_hand.png"
im = Image.open(p).convert("RGBA")
im = im.crop(im.getbbox())
a = np.asarray(im)
h, w = a.shape[:2]
print("尺寸 %dx%d" % (w, h))

CW, CH = 74, 42
out = []
for cy in range(CH):
    y0, y1 = int(cy * h / CH), max(int(cy * h / CH) + 1, int((cy + 1) * h / CH))
    line = ""
    for cx in range(CW):
        x0, x1 = int(cx * w / CW), max(int(cx * w / CW) + 1, int((cx + 1) * w / CW))
        blk = a[y0:y1, x0:x1]
        m = blk[..., 3].mean()
        if m < 12:
            line += " "
        else:
            v = blk[blk[..., 3] > 40]
            lum = v[..., :3].mean() if len(v) else 0
            line += "#" if lum > 210 else ("+" if lum > 150 else ".")
    out.append(line)
print("+" + "-" * CW + "+")
for i, l in enumerate(out):
    print("|" + l + "|  y=%3d" % int(i * h / CH))
print("+" + "-" * CW + "+")
print("      x=0" + " " * (CW - 22) + "x=%d" % w)
