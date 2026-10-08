# -*- coding: utf-8 -*-
"""把整张探针截图降采样成 ASCII，先看"东西到底画在哪"。"""
import numpy as np
from PIL import Image

BG = np.array([0x15, 0x11, 0x24], dtype=np.int16)
p = r"C:\Users\shenl\Desktop\new\tools\_probe\arena_zoom.png"
im = Image.open(p).convert("RGB")
a = np.asarray(im).astype(np.int16)
H, W = a.shape[:2]
print("尺寸 %dx%d" % (W, H))

CW, CH = 100, 40
d = np.abs(a - BG).sum(axis=2)
for cy in range(CH):
    ya, yb = int(cy * H / CH), max(int(cy * H / CH) + 1, int((cy + 1) * H / CH))
    line = ""
    for cx in range(CW):
        xa, xb = int(cx * W / CW), max(int(cx * W / CW) + 1, int((cx + 1) * W / CW))
        blk = d[ya:yb, xa:xb]
        m = blk.mean()
        if m < 10:
            line += " "
        else:
            px = a[ya:yb, xa:xb].reshape(-1, 3)[blk.reshape(-1) > 10]
            mm = px.mean()
            line += "#" if mm > 110 else ("+" if mm > 50 else ".")
    print("|" + line + "| y=%4d  (每列 %.0f px)" % (ya, W / CW))
print(" x: 0" + " " * 46 + "550" + " " * 44 + str(W))
