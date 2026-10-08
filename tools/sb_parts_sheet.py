# -*- coding: utf-8 -*-
"""把君剑各部件贴在棋盘格上，带名字/尺寸，生成一张对照表供肉眼确认每个部件长啥样。"""
import os
from PIL import Image, ImageDraw

SRC = r"C:\Users\shenl\Desktop\new\assets\src"
OUT = r"C:\Users\shenl\Desktop\new\tools\预览图\sb_parts_sheet.png"

PARTS = ["sp_sb_blade", "sp_sb_shine", "sp_sb_outline", "sp_sb_glow",
         "sp_sb_deco", "sp_sb_hilt", "sp_sb_hilt2", "sp_sb_spike", "sp_sb_spike2",
         "sp_sb_star_center", "sp_sb_star2"]

def checker(w, h, s=12):
    im = Image.new("RGB", (w, h), (150, 150, 155))
    d = ImageDraw.Draw(im)
    light = (200, 200, 205)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if ((x // s) + (y // s)) % 2 == 0:
                d.rectangle([x, y, x + s - 1, y + s - 1], fill=light)
    return im

cells = []
for name in PARTS:
    p = os.path.join(SRC, name + ".png")
    if not os.path.exists(p):
        cells.append((name, None)); continue
    im = Image.open(p).convert("RGBA")
    cells.append((name, im))

CW, CH = 300, 300
cols = 4
rows = (len(cells) + cols - 1) // cols
sheet = Image.new("RGB", (cols * CW, rows * CH), (30, 30, 36))
d0 = ImageDraw.Draw(sheet)

for i, (name, im) in enumerate(cells):
    cx = (i % cols) * CW; cy = (i // cols) * CH
    bg = checker(CW, CH)
    if im is not None:
        w, h = im.size
        f = min((CW - 60) / w, (CH - 60) / h, 1.0)
        nw, nh = max(1, int(w * f)), max(1, int(h * f))
        r = im.resize((nw, nh), Image.NEAREST)
        bg.paste(r, ((CW - nw) // 2, (CH - nh) // 2 + 10), r)
    sheet.paste(bg, (cx, cy))
    d0.rectangle([cx, cy, cx + CW - 1, cy + CH - 1], outline=(90, 90, 100))
    label = name if im is None else "%s  %dx%d" % (name, im.size[0], im.size[1])
    d0.rectangle([cx, cy, cx + CW - 1, cy + 26], fill=(12, 12, 18))
    d0.text((cx + 6, cy + 8), label, fill=(255, 230, 140))
    if im is None:
        d0.text((cx + 6, cy + CH // 2), "MISSING", fill=(255, 90, 90))

sheet.save(OUT)
print("saved", OUT, sheet.size)
for name, im in cells:
    print("  %-22s %s" % (name, "MISSING" if im is None else im.size))
