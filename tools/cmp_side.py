# -*- coding: utf-8 -*-
"""把原版参考与本次渲染按「剑身等长」对齐，上下拼成一张对照图。"""
import os
from PIL import Image, ImageDraw

PV = r"C:\Users\shenl\Desktop\new\tools\预览图"
OUT = os.path.join(PV, "cmp_side.png")

def blue_mask_bbox(im):
    px = im.load(); W, H = im.size
    x0 = y0 = 10 ** 9; x1 = y1 = -1
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            r, g, b = px[x, y]
            if b - r > 30 and b > 70 and g > 70:
                if x < x0: x0 = x
                if y < y0: y0 = y
                if x > x1: x1 = x
                if y > y1: y1 = y
    return (x0, y0, x1, y1) if x1 > 0 else None

def prep(path, tag):
    im = Image.open(path).convert("RGB")
    bb = blue_mask_bbox(im)
    if not bb:
        return None
    pad = 40
    box = (max(0, bb[0] - pad), max(0, bb[1] - 150),
           min(im.size[0], bb[2] + pad), min(im.size[1], bb[3] + 150))
    crop = im.crop(box)
    bladeLen = bb[2] - bb[0]
    return crop, bladeLen, bb, box

TARGET = 1200            # 统一到剑身 1200px
rows = []
for p, tag in ((os.path.join(PV, "ref_181254.png"), "原版参考"),
               (os.path.join(PV, "_n_img1.png"), "本次渲染")):
    r = prep(p, tag)
    if not r:
        rows.append((tag, None)); continue
    crop, bl, bb, box = r
    f = TARGET / float(bl)
    nw, nh = int(crop.size[0] * f), int(crop.size[1] * f)
    rows.append((tag, crop.resize((nw, nh), Image.LANCZOS)))
    print(tag, "剑身长", bl, "裁切", box, "->", (nw, nh))

W = max(r[1].size[0] for r in rows if r[1])
H = sum(r[1].size[1] for r in rows if r[1]) + 26 * len(rows)
out = Image.new("RGB", (W, H), (18, 18, 22))
d = ImageDraw.Draw(out)
y = 0
for tag, im in rows:
    if im is None:
        continue
    d.rectangle([0, y, W, y + 25], fill=(10, 10, 14))
    d.text((8, y + 7), tag + "   (剑身已对齐到 %dpx)" % TARGET, fill=(255, 225, 130))
    y += 26
    out.paste(im, (0, y))
    y += im.size[1]
out.save(OUT)
print("saved", OUT, out.size)
