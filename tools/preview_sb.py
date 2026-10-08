"""
按原版 sovereign_blade.tscn 的节点布局，在 PIL 里把「君王之剑」重新拼一遍，
用于目视确认各部件位置关系（对应 ScaleContainer 局部坐标系）。
另外生成一张原始部件对照图。
"""
import os

from PIL import Image

SRC = r"C:\Users\shenl\Desktop\new\assets\src"
OUT = r"C:\Users\shenl\Desktop\new\tools\预览图"


def load(name):
    p = os.path.join(SRC, name + ".png")
    return Image.open(p).convert("RGBA") if os.path.isfile(p) else None


def paste(base, im, cx, cy, w, h, alpha=1.0, tint=None, additive=False):
    """把 im 缩放到 (w,h)，中心落在 (cx,cy)。"""
    if im is None:
        return
    if w <= 0 or h <= 0:
        return
    s = im.resize((max(1, int(round(w))), max(1, int(round(h)))), Image.LANCZOS)
    if tint:
        r, g, b, a = s.split()
        a = a.point(lambda v: int(v * alpha))
        a = Image.merge("L", (a,)).point(lambda v: v)
        s = Image.merge("RGBA", (
            r.point(lambda v, t=tint[0]: int(v * t)),
            g.point(lambda v, t=tint[1]: int(v * t)),
            b.point(lambda v, t=tint[2]: int(v * t)),
            a,
        ))
    elif alpha < 1.0:
        r, g, b, a = s.split()
        s = Image.merge("RGBA", (r, g, b, a.point(lambda v: int(v * alpha))))
    bx, by = int(round(cx - w / 2)), int(round(cy - h / 2))
    if additive:
        region = base.crop((bx, by, bx + s.width, by + s.height))
        base.paste(Image.alpha_composite(region, s), (bx, by))
    else:
        base.alpha_composite(s, (bx, by))


# ---------------- 1. 原版布局拼装 ----------------
# ScaleContainer 局部坐标：剑尖朝 -y。
K = 0.55                     # 预览缩放（原版场景内 ScaleContainer scale = 0.2）
W, H = 900, 1500
OX, OY = 380, 1100           # 局部 (0,0) 在画布上的位置
img = Image.new("RGBA", (W, H), (18, 24, 34, 255))

blade = load("sp_sb_blade")
shine = load("sp_sb_shine")
outline = load("sp_sb_outline")
deco = load("sp_sb_deco")
glow = load("sp_sb_glow")
hilt = load("sp_sb_hilt")
hilt2 = load("sp_sb_hilt2")
star = load("sp_sb_star")
star2 = load("sp_sb_star2")
spike = load("sp_sb_spike")


def P(lx, ly):
    """局部 -> 画布（预览坐标）"""
    return OX + lx * K, OY + ly * K


def S(v):
    return v * K


# Blade: pos (0,-535) scale 4  -> 50x236 * 4
paste(img, blade, *P(0, -535), S(200), S(944), alpha=0.4706)
# Blade2 (shine) pos(-48,-497.3) scale 4 -> 24x236*4, additive 蓝
paste(img, shine, *P(-48, -497.3), S(96), S(944), alpha=0.25098,
      tint=(0.141, 0.337, 1.0), additive=True)
# BladeOutline2 : x -160..166, y -1025..-66
paste(img, outline, *P((166 - 160) / 2, (-1025 - 66) / 2), S(326), S(959),
      alpha=0.85, tint=(0.35, 0.75, 1.0), additive=True)
# Detail: center (0,-780.5) size 104x199 scale .8
paste(img, deco, *P(0, -780.5), S(104 * 0.8), S(199 * 0.8))
# BladeGlow: pos(3,-550) scale(4.2,4.05) 90x245, 橙 additive
paste(img, glow, *P(3, -550), S(90 * 4.2), S(245 * 4.05), alpha=1.0,
      tint=(1.0, 0.45, 0.0), additive=True)
# SpikeCircle / SpikeCircle2 粒子近似
paste(img, star, *P(0, -145.5), S(80 * 5), S(80 * 5), alpha=0.55, additive=True)
paste(img, star2, *P(-5, -75), S(80 * 4), S(80 * 4), alpha=0.5, additive=True)
# Spike 粒子近似
paste(img, spike, *P(-4, -156.5), S(28 * 2), S(248 * 2), alpha=0.7, additive=True)
# Hilt: 450x360 @ scale 1.1, center (6,60)
paste(img, hilt, *P(6, 60), S(450 * 1.1), S(360 * 1.1))
# Hilt2: 555x637 @ scale .761, center (1.5,-6.5)
paste(img, hilt2, *P(1.5, -6.5), S(555 * 0.761), S(637 * 0.761))

os.makedirs(OUT, exist_ok=True)
img.save(os.path.join(OUT, "sb_assembled.png"))
print("assembled ->", os.path.join(OUT, "sb_assembled.png"))

# ---------------- 2. 部件对照图 ----------------
names = [("sp_sb_blade", 1), ("sp_sb_glow", 1), ("sp_sb_shine", 1), ("sp_sb_outline", 1),
         ("sp_sb_deco", 1), ("sp_sb_hilt", 1), ("sp_sb_hilt2", 1),
         ("sp_sb_spike", 1), ("sp_sb_spike2", 1), ("sp_sb_star", 1), ("sp_sb_star2", 1),
         ("sp_sb_trail", 1)]
CELL = 260
COLS = 4
rows = (len(names) + COLS - 1) // COLS
sheet = Image.new("RGBA", (CELL * COLS, CELL * rows), (20, 20, 26, 255))
for i, (n, _) in enumerate(names):
    im = load(n)
    cx = (i % COLS) * CELL
    cy = (i // COLS) * CELL
    if im is None:
        continue
    sc = min((CELL - 24) / im.width, (CELL - 24) / im.height, 3.0)
    w, h = max(1, int(im.width * sc)), max(1, int(im.height * sc))
    paste(sheet, im, cx + CELL / 2, cy + CELL / 2, w, h)
sheet.save(os.path.join(OUT, "sb_parts.png"))
print("parts ->", os.path.join(OUT, "sb_parts.png"))
