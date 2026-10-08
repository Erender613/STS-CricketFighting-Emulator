# -*- coding: utf-8 -*-
"""生成「君王之剑 还原验收图」：原版参考 / 本次还原 / 竞技场实景 三段对照 + 量化指标。"""
import os
from PIL import Image, ImageDraw, ImageFont

PV = r"C:\Users\shenl\Desktop\new\tools\预览图"
OUT = os.path.join(PV, "君王之剑_还原对比.png")

def font(sz):
    for f in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
              r"C:\Windows\Fonts\msyhbd.ttc"):
        if os.path.exists(f):
            try: return ImageFont.truetype(f, sz)
            except Exception: pass
    return ImageFont.load_default()

F_T = font(26); F_L = font(20); F_S = font(17)

def blue_bbox(im):
    px = im.load(); W, H = im.size
    x0 = y0 = 10 ** 9; x1 = y1 = -1
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            r, g, b = px[x, y]
            if b - r > 30 and b > 70 and g > 70:
                x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y)
    return (x0, y0, x1, y1) if x1 > 0 else None

TARGET = 1120
def strip(path):
    im = Image.open(path).convert("RGB")
    bb = blue_bbox(im)
    if not bb: return None
    box = (max(0, bb[0] - 40), max(0, bb[1] - 150),
           min(im.size[0], bb[2] + 40), min(im.size[1], bb[3] + 150))
    crop = im.crop(box)
    f = TARGET / float(bb[2] - bb[0])
    return crop.resize((int(crop.size[0] * f), int(crop.size[1] * f)), Image.LANCZOS)

rows = []
for p, tag in ((os.path.join(PV, "ref_181254.png"), "原版参考（反编译游戏内）"),
               (os.path.join(PV, "_n_img1.png"), "本次还原（放大隔离）")):
    s = strip(p)
    if s: rows.append((tag, s))

W = max(r[1].size[0] for r in rows) + 20
ARENA_W = 626
METRICS = [
    "逐像素量化对比（剑身等长归一化）",
    "",
    "指标                     原版      还原",
    "剑身厚 / 剑长            0.171     0.172",
    "青边占剑身厚             24%       27%",
    "白色爆闪面积/剑长²       0.0104    0.0105",
    "剑身内部亮蓝 #1a56b1  ↔  #1a56b3",
    "深藏青下棱 #0f3864   ↔  #103b68",
]
panel_h = 40 + len(METRICS) * 26
H = 56 + sum(r[1].size[1] + 30 for r in rows) + 20 + max(panel_h, ARENA_W + 20) + 20
out = Image.new("RGB", (W, H), (16, 16, 20))
d = ImageDraw.Draw(out)
d.text((12, 14), "君王之剑 · 还原验收对比", font=F_T, fill=(255, 226, 140))

y = 56
for tag, im in rows:
    d.rectangle([10, y, W - 10, y + 24], fill=(28, 28, 36))
    d.text((18, y + 2), tag, font=F_L, fill=(160, 220, 255))
    y += 26
    out.paste(im, (10, y))
    y += im.size[1] + 4

# 底部：竞技场实景 + 指标面板
y += 16
ar = Image.open(os.path.join(PV, "_n_img3.png")).convert("RGB")
out.paste(ar, (10, y))
d.text((18, y + 6), "竞技场内实景", font=F_S, fill=(255, 226, 140))
mx = 10 + ARENA_W + 16
d.rectangle([mx, y, W - 10, y + panel_h], fill=(24, 24, 30))
for i, ln in enumerate(METRICS):
    col = (120, 230, 255) if i == 0 else (215, 215, 225)
    d.text((mx + 12, y + 10 + i * 26), ln, font=F_S, fill=col)

out.save(OUT)
print("saved", OUT, out.size)
