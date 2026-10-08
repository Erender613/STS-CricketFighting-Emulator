# -*- coding: utf-8 -*-
"""量化对比：剑身尺寸、剑柄比例、青边厚度、爆闪白色面积。"""
import os
from PIL import Image

PV = r"C:\Users\shenl\Desktop\new\tools\预览图"

def analyze(path, tag):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    px = im.load()
    lin = []
    blue = []; orange = []; white = []
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            if b - r > 30 and b > 70 and g > 70:
                blue.append((x, y))
            if r - b > 45 and r > 95:
                orange.append((x, y))
            if min(r, g, b) > 215:
                white.append((x, y))
    def bbox(l):
        if not l: return None
        xs = [p[0] for p in l]; ys = [p[1] for p in l]
        return (min(xs), min(ys), max(xs), max(ys))

    bb = bbox(blue); ob = bbox(orange); wb = bbox(white)
    bladeLen = bb[2] - bb[0]
    # 剑身厚度：取剑长 45% 处的蓝色列高
    xm = int(bb[0] + bladeLen * 0.45)
    ys = [y for y in range(H) if (lambda c: c[2] - c[0] > 30 and c[2] > 70 and c[1] > 70)(px[xm, y])]
    thick = (max(ys) - min(ys) + 1) if ys else 0
    # 青边厚度：在该列上数「近乎纯青」的像素
    cy = 0
    for y in ys:
        r, g, b = px[xm, y]
        if g > 200 and b > 200 and r < 175:
            cy += 1
    lin.append("%s  %dx%d" % (tag, W, H))
    lin.append("  蓝(剑身+光)框 %s   剑长 %d" % (str(bb), bladeLen))
    lin.append("  45%% 处厚度 %d  其中青边像素 %d (%.0f%%)" % (thick, cy, 100.0 * cy / max(thick, 1)))
    lin.append("  橙(剑柄+装饰)框 %s" % str(ob))
    if ob and bb:
        lin.append("  剑柄横跨 %d  = 剑长 %.2f  / 剑身厚 %.2f" %
                   (ob[3] - ob[1], (ob[3] - ob[1]) / float(bladeLen), (ob[3] - ob[1]) / float(thick)))
        lin.append("  剑柄纵向 %d  = 剑长 %.2f" % (ob[2] - ob[0], (ob[2] - ob[0]) / float(bladeLen)))
    lin.append("  白(爆闪/火花)框 %s  面积 %d = 剑长²的 %.4f" %
               (str(wb), len(white), len(white) / float(bladeLen ** 2)))
    lin.append("  剑身厚/剑长 = %.3f" % (thick / float(bladeLen)))
    return "\n".join(lin)

out = []
out.append(analyze(os.path.join(PV, "ref_181254.png"), "原版参考"))
out.append("")
out.append(analyze(os.path.join(PV, "_n_img1.png"), "本次渲染"))
open(os.path.join(PV, "_quant.txt"), "w", encoding="utf-8").write("\n".join(out))
