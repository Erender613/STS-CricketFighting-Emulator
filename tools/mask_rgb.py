# -*- coding: utf-8 -*-
"""看 outline / shine 两张不透明遮罩的 RGB 分布，判断怎么转成 alpha。"""
import os
from PIL import Image

SRC = r"C:\Users\shenl\Desktop\new\assets\src"
out = []
for n in ("sp_sb_outline", "sp_sb_shine"):
    im = Image.open(os.path.join(SRC, n + ".png")).convert("RGBA")
    g = im.convert("L")
    h = g.histogram()
    tot = sum(h)
    out.append("== %s  %s" % (n, im.size))
    lv = 0
    for i in range(0, 256, 16):
        bucket = sum(h[i:i + 16])
        lv += bucket
        out.append("   L %3d-%3d : %6.2f%%   累计 %6.2f%%" % (i, i + 15, 100.0 * bucket / tot, 100.0 * lv / tot))
    px = im.load()
    W, H = im.size
    out.append("   采样行：")
    for y in range(0, H, max(1, H // 10)):
        row = [px[x, y] for x in range(0, W, max(1, W // 12))]
        out.append("     y=%4d  " % y + " ".join("#%02x%02x%02x" % (c[0], c[1], c[2]) for c in row[:12]))
open(r"C:\Users\shenl\Desktop\new\tools\_mask_rgb.txt", "w", encoding="utf-8").write("\n".join(out))
