"""
君王之剑渲染原型 v5（定稿）。
按原版 sovereign_blade.tscn 的层级 + 反编译贴图的实际像素结构复刻。

局部坐标（ScaleContainer）：剑尖朝 -y，锚点 = 剑格 y=-60
  blade   x[-100,100]   y[-1007, -63]    暗蓝剑身实体
  glow    x[-186,192]   y[-1046, -54]    柔光核心（加法·淡）
  shine   x[ -96,  0]   y[ -969, -25]    上半部蓝色高光（加法，原版 modulate 0.141/0.337/1 @0.251）
  outline x[-160,166]   y[-1025, -66]    青色描边（加法）
  deco    x[-41.6,41.6] y[-860,-701]     橙色四芒星
  hilt    x[-241,254]   y[-138, 258]     剑柄
  hilt2   x[-210,213]   y[-249, 236]     剑柄外圈
"""
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC = r"C:\Users\shenl\Desktop\new\assets\src"
OUT = r"C:\Users\shenl\Desktop\new\tools\预览图"

PARTS = {
    "blade":   (-100, -1007, 100, -63),
    "glow":    (-186, -1046, 192, -54),
    "shine":   (-96, -969, 0, -25),
    "outline": (-160, -1025, 166, -66),
    "deco":    (-41.6, -860.1, 41.6, -700.9),
    "hilt":    (-241.5, -138, 253.5, 258),
    "hilt2":   (-209.7, -248.9, 212.7, 235.9),
}
ANCHOR_Y = -60.0
TIP_Y, TAIL_Y = -1007.0, 258.0
TOTAL = TAIL_Y - TIP_Y          # 1265

C_BLADE = (0.82, 0.87, 0.89)
C_GLOW = (0.34, 0.66, 1.00)
A_GLOW = 0.06
C_SHINE = (0.141, 0.337, 1.00)
A_SHINE = 0.251
C_RIM = (0.47, 1.00, 1.00)

_C = {}


def part(n):
    k = "sp_sb_" + n
    if k not in _C:
        p = os.path.join(SRC, k + ".png")
        _C[k] = Image.open(p).convert("RGBA") if os.path.isfile(p) else None
    return _C[k]


def scale_to(im, w, h):
    return im.resize((max(1, int(round(w))), max(1, int(round(h)))), Image.LANCZOS)


def tint(img, rgb, alpha=1.0):
    r, g, b, a = img.split()
    return Image.merge("RGBA", (
        r.point(lambda v: min(255, int(v * alpha * rgb[0]))),
        g.point(lambda v: min(255, int(v * alpha * rgb[1]))),
        b.point(lambda v: min(255, int(v * alpha * rgb[2]))),
        a))


def add_onto(base, s, px, py):
    if s.width <= 0 or s.height <= 0:
        return
    x0, y0 = int(px), int(py)
    x1, y1 = x0 + s.width, y0 + s.height
    cx0, cy0 = max(0, x0), max(0, y0)
    cx1, cy1 = min(base.width, x1), min(base.height, y1)
    if cx1 <= cx0 or cy1 <= cy0:
        return
    s = s.crop((cx0 - x0, cy0 - y0, cx1 - x0, cy1 - y0))
    reg = base.crop((cx0, cy0, cx1, cy1))
    sa = s.split()[3]
    pm = Image.merge("RGB", [ImageChops.multiply(ch, sa) for ch in s.convert("RGB").split()])
    out = ImageChops.add(reg.convert("RGB"), pm)
    base.paste(Image.merge("RGBA", (*out.split(), reg.split()[3])), (cx0, cy0))


def over_onto(base, s, px, py):
    base.alpha_composite(s, (int(round(px)), int(round(py))))


def disc(size, rgb, power=2.0, a=255):
    size = max(2, int(size))
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = im.load()
    c = (size - 1) / 2.0
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - c, y - c) / c
            if d >= 1:
                continue
            v = max(0.0, 1.0 - d) ** power
            px[x, y] = (int(rgb[0] * v), int(rgb[1] * v), int(rgb[2] * v), int(a * v))
    return im


def star(size, inner=0.09, color=(255, 255, 255), a=255, arms=4, ang=0.0):
    """四芒星：inner = 腰宽 / 全长"""
    size = max(3, int(size))
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2.0
    w = S * inner / 2.0
    L = S / 2.0
    for i in range(arms):
        th = ang + i * (math.pi * 2 / arms)
        ct, st = math.cos(th), math.sin(th)
        nx, ny = -st, ct
        d.polygon([(c + nx * w, c + ny * w), (c + ct * L, c + st * L),
                   (c - nx * w, c - ny * w), (c - ct * L, c - st * L)],
                  fill=(color[0], color[1], color[2], a))
    return im.resize((size, size), Image.LANCZOS)


class Blade:
    """K = 像素 / 原版局部单位"""

    def __init__(self, K):
        self.K = K

    def xf(self, ax, ay, ang, lx, ly, k=1.0):
        dx = lx * self.K * k
        dy = (ly - ANCHOR_Y) * self.K * k
        th = ang + math.pi / 2
        ct, st = math.cos(th), math.sin(th)
        return ax + dx * ct - dy * st, ay + dx * st + dy * ct

    def layer(self, base, name, ax, ay, ang, rgb=None, alpha=1.0, additive=False,
              k=1.0, blur=0.0, grow=1.0):
        K = self.K * k
        l, t, r, b = PARTS[name]
        im = part(name)
        if im is None:
            return
        ux0, uy0 = l * K, (t - ANCHOR_Y) * K
        ux1, uy1 = r * K, (b - ANCHOR_Y) * K
        s = scale_to(im, (ux1 - ux0) * grow, (uy1 - uy0) * grow)
        s = s.rotate(-math.degrees(ang) - 90.0, expand=True, resample=Image.BICUBIC)
        if rgb:
            s = tint(s, rgb, alpha)
        elif alpha < 1.0:
            rr, gg, bb, aa = s.split()
            s = Image.merge("RGBA", (rr, gg, bb, aa.point(lambda v: int(v * alpha))))
        if blur > 0.3:
            s = s.filter(ImageFilter.GaussianBlur(blur))
        ucx, ucy = (ux0 + ux1) / 2, (uy0 + uy1) / 2
        th = ang + math.pi / 2
        ct, st = math.cos(th), math.sin(th)
        px = ax + ucx * ct - ucy * st - s.width / 2
        py = ay + ucx * st + ucy * ct - s.height / 2
        (add_onto if additive else over_onto)(base, s, px, py)

    def draw(self, base, ax, ay, ang, t=0.0, k=1.0, spark=True):
        K = self.K * k
        # 1 剑身外发光（放大+模糊的剑身剪影）
        self.layer(base, "blade", ax, ay, ang, rgb=(0.20, 0.52, 0.95), alpha=0.26,
                   additive=True, k=k, grow=1.16, blur=7.0 * K)
        # 2 剑身实体
        self.layer(base, "blade", ax, ay, ang, rgb=C_BLADE, k=k)
        # 3 核心柔光
        self.layer(base, "glow", ax, ay, ang, rgb=C_GLOW, alpha=A_GLOW, additive=True, k=k)
        # 4 上半部蓝色高光
        self.layer(base, "shine", ax, ay, ang, rgb=C_SHINE, alpha=A_SHINE, additive=True, k=k)
        # 5 青色描边（模糊底 + 锐利层）
        self.layer(base, "outline", ax, ay, ang, rgb=(0.18, 0.60, 0.95), alpha=0.55,
                   additive=True, k=k, blur=3.0 * K)
        self.layer(base, "outline", ax, ay, ang, rgb=C_RIM, alpha=0.92, additive=True, k=k)
        # 6 剑身四芒星
        self.layer(base, "deco", ax, ay, ang, k=k)
        # 7 剑柄
        self.layer(base, "hilt", ax, ay, ang, k=k)
        self.layer(base, "hilt2", ax, ay, ang, k=k)

        # 8 剑格爆闪
        jx, jy = self.xf(ax, ay, ang, 0, -70, k)
        R = 74 * K
        for size, rgb, pw, a in ((R * 2.7, (110, 190, 255), 2.6, 190),
                                 (R * 0.95, (255, 255, 255), 1.6, 255)):
            g = disc(size, rgb, pw, a)
            add_onto(base, g, jx - g.width / 2, jy - g.height / 2)
        st = star(int(R * 2.3), inner=0.055, ang=math.radians(90))
        add_onto(base, st, jx - st.width / 2, jy - st.height / 2)
        for ln, wd, rot_deg, al in ((R * 4.4, 0.030, 0.0, 200),
                                    (R * 5.4, 0.024, 90.0, 175),
                                    (R * 3.1, 0.028, 45.0, 120),
                                    (R * 3.1, 0.028, -45.0, 120)):
            ray = star(int(ln), inner=wd, a=al, ang=math.radians(rot_deg))
            add_onto(base, ray, jx - ray.width / 2, jy - ray.height / 2)

        if not spark:
            return
        # 9 剑身内金点（原版 YellowDots）
        gold = [(30, -350, 1.5), (52, -390, 1.1), (74, -300, 1.0), (18, -520, 1.3),
                (60, -600, 1.0), (30, -660, 1.5), (70, -760, 1.1), (-30, -430, 1.2),
                (-52, -700, 1.0), (10, -830, 1.2)]
        for i, (lx, ly, sz) in enumerate(gold):
            tw = 0.45 + 0.55 * math.sin(t * 2.1 + i * 1.7)
            px, py = self.xf(ax, ay, ang, lx, ly, k)
            gr = disc(sz * 5.6 * K, (255, 208, 60), 2.0, int(185 * tw))
            add_onto(base, gr, px - gr.width / 2, py - gr.height / 2)
        # 10 剑身辉点（原版 SlashParticles / ForgeSparks）
        sp = [(-118, -250, 0.90, 0.00), (140, -430, 1.25, 0.34), (-96, -640, 0.85, 0.62),
              (120, -830, 1.05, 0.16), (198, -560, 1.55, 0.78), (-152, -980, 0.95, 0.45),
              (88, -180, 0.75, 0.88), (-192, -420, 1.15, 0.25)]
        for (lx, ly, sz, ph) in sp:
            tw = max(0.0, math.sin(((t * 0.45 + ph) % 1.0) * math.pi)) ** 1.7
            if tw < 0.05:
                continue
            s = int(sz * 50 * K * (0.55 + 0.75 * tw))
            if s < 3:
                continue
            px, py = self.xf(ax, ay, ang, lx, ly, k)
            hg = disc(s * 2.2, (130, 195, 255), 2.4, int(105 * tw))
            add_onto(base, hg, px - hg.width / 2, py - hg.height / 2)
            stx = star(s, inner=0.105, a=int(238 * tw))
            add_onto(base, stx, px - stx.width / 2, py - stx.height / 2)


def measure(cv, x_list, label):
    rgb = cv.convert("RGB")
    print("--- %s ---" % label)
    for x in x_list:
        runs, prev, st = [], None, None
        for y in range(cv.height):
            c = rgb.getpixel((x, y))
            key = (c[0] // 26, c[1] // 26, c[2] // 26)
            if key != prev:
                if prev is not None:
                    runs.append((st, y - 1, rgb.getpixel((x, (st + y - 1) // 2))))
                prev, st = key, y
        runs.append((st, cv.height - 1, rgb.getpixel((x, (st + cv.height - 1) // 2))))
        print("  x=%3d  %s" % (x, "  ".join("%d-%d(%d)%s" % (a, b, b - a + 1, c)
                                            for a, b, c in runs if b - a >= 1)))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    K = 0.39
    cv = Image.new("RGBA", (620, 230), (20, 34, 24, 255))
    Blade(K).draw(cv, 140, 115, 0.0, t=0.35)
    measure(cv, (250, 320, 430), "自绘 K=0.39")
    ref = Image.open(r"C:\Users\shenl\Pictures\Screenshots\屏幕截图 2026-09-21 181254.png").convert("RGB")
    cmp = Image.new("RGB", (565, 430), (10, 10, 14))
    cmp.paste(ref.crop((0, 0, 565, 206)), (0, 0))
    cmp.paste(cv.convert("RGB").crop((0, 0, 565, 206)), (0, 220))
    cmp.resize((565 * 2, 430 * 2), Image.LANCZOS).save(os.path.join(OUT, "cmp_ref_sword.png"))
    print("cmp_ref_sword.png")
    for KK, nm in ((0.13, "arena_k13.png"), (0.166, "arena_k17.png"), (0.20, "arena_k20.png")):
        sz = 660
        a = Image.new("RGBA", (sz, sz), (20, 18, 30, 255))
        card = Image.open(r"C:\Users\shenl\Desktop\new\assets\baked\card_beat_into_shape_300.png").convert("RGBA")
        ch = 150
        cw = int(card.width * ch / card.height)
        a.alpha_composite(card.resize((cw, ch), Image.LANCZOS), (int(sz / 2 - cw / 2), int(sz / 2 - ch / 2)))
        Blade(KK).draw(a, sz / 2 + 96, sz / 2, 0.0, t=0.35)
        a.convert("RGB").save(os.path.join(OUT, nm))
        print(nm, "全长=%.0f 厚=%.0f 柄宽=%.0f" % (TOTAL * KK, 200 * KK, 495 * KK))
