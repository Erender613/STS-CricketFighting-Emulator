# -*- coding: utf-8 -*-
"""检查每张贴图是不是「不透明黑底」——这决定能否直接 drawImage。"""
import os, glob
from PIL import Image

SRC = r"C:\Users\shenl\Desktop\new\assets\src"
out = []
for p in sorted(glob.glob(os.path.join(SRC, "sp_sb_*.png"))):
    im = Image.open(p).convert("RGBA")
    a = im.getchannel("A")
    lo, hi = a.getextrema()
    hist = a.histogram()
    tot = im.size[0] * im.size[1]
    opaque = hist[255] / float(tot)
    trans = hist[0] / float(tot)
    r, g, b = im.getchannel("R"), im.getchannel("G"), im.getchannel("B")
    # 完全不透明区域的平均色
    px = im.load()
    sr = sg = sb = n = 0
    for y in range(0, im.size[1], 2):
        for x in range(0, im.size[0], 2):
            rr, gg, bb, aa = px[x, y]
            if aa > 250:
                sr += rr; sg += gg; sb += bb; n += 1
    mean = (sr // n, sg // n, sb // n) if n else (0, 0, 0)
    out.append("%-20s a:[%3d..%3d] 全透明%5.1f%%  全不透明%5.1f%%  不透明区均色%s" %
               (os.path.basename(p), lo, hi, trans * 100, opaque * 100, str(mean)))
open(r"C:\Users\shenl\Desktop\new\tools\_sb_alpha.txt", "w", encoding="utf-8").write("\n".join(out))
