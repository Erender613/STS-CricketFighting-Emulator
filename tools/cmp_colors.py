"""把官方截图与我的合成卡在若干关键位置取平均色做对比。"""
import os

from PIL import Image

ROOT = r"C:\Users\shenl\Desktop\new"
PREVIEW = os.path.join(ROOT, "tools", "预览图")
OUT = os.path.join(ROOT, "assets", "baked")
REF_SHOT = r"C:\Users\shenl\Pictures\Screenshots\屏幕截图 2026-07-22 201251.png"
REF_CARD_BOX = (5, 30, 320, 475)
W, H = 598, 844

ref = Image.open(REF_SHOT).convert("RGBA").crop(REF_CARD_BOX).resize((W, H), Image.LANCZOS)
mine = Image.open(os.path.join(OUT, "card_end_of_days.png")).convert("RGBA")

# 采样点（归一化坐标）
SPOTS = {
    "卡框-左边框":   (0.012, 0.45),
    "卡框-上边框":   (0.5, 0.006),
    "卡框-右下边框": (0.988, 0.90),
    "文字区-中央":   (0.5, 0.72),
    "文字区-左上":   (0.10, 0.62),
    "缎带-中央":     (0.5, 0.06),
    "缎带-左端":     (0.12, 0.09),
    "卡图内框-左侧": (0.055, 0.30),
    "铭牌-中央":     (0.5, 0.565),
}


def sample(im, nx, ny, r=4):
    x, y = int(nx * W), int(ny * H)
    x = max(r, min(W - r - 1, x)); y = max(r, min(H - r - 1, y))
    box = im.crop((x - r, y - r, x + r + 1, y + r + 1)).convert("RGBA")
    px = list(box.getdata())
    n = len(px)
    return tuple(round(sum(p[i] for p in px) / n) for i in range(4))


print("%-16s %-26s %-26s" % ("采样点", "官方截图", "我方合成"))
for k, (nx, ny) in SPOTS.items():
    a = sample(ref, nx, ny)
    b = sample(mine, nx, ny)
    d = max(abs(a[i] - b[i]) for i in range(3))
    print("%-16s %-26s %-26s  Δmax=%d" % (k, a, b, d))
