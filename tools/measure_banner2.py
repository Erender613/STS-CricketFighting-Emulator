"""量出官方截图里缎带的可见包围盒。

污染区（暖色但不是缎带）：
  卡图窗   画布 x 47..546, y 84..463   （原画本身是暖色）
  金色内框 画布 x 28.5..565.7, y ~94..514
  铭牌     画布 x ~238..360, y ~424..498
因此只用两块"干净区"：
  A) y < 84           —— 卡图窗上沿以上，只有缎带
  B) x < 26 或 x > 572 —— 金框左右之外，只有缎带垂尾
"""
import os

from PIL import Image

ROOT = r"C:\Users\shenl\Desktop\new"
BAKE = os.path.join(ROOT, "tools", "bake")
SHOT = r"C:\Users\shenl\Pictures\Screenshots\屏幕截图 2026-07-22 201251.png"
REF_BOX = (5, 30, 320, 475)
W, H = 598, 844

im = Image.open(SHOT).convert("RGB")
px = im.load()
X0, Y0, X1, Y1 = REF_BOX
CW, CH = X1 - X0, Y1 - Y0
sx, sy = W / CW, H / CH


def warm(p):
    r, g, b = p
    return r > 170 and (r - b) > 80 and (r - g) > 30


pts = []
for ys in range(Y0, Y1 + 1):
    for xs in range(X0, X1 + 1):
        xc, yc = (xs - X0) * sx, (ys - Y0) * sy
        zoneA = yc < 84.0
        zoneB = (xc < 26.0 or xc > 572.0) and 84.0 <= yc < 320.0
        if (zoneA or zoneB) and warm(px[xs, ys]):
            pts.append((xc, yc))

l = min(p[0] for p in pts); r_ = max(p[0] for p in pts)
t = min(p[1] for p in pts); b_ = max(p[1] for p in pts)
print("官方缎带可见 bbox（画布px）: x %.1f..%.1f  y %.1f..%.1f   宽%.1f 高%.1f" % (
    l, r_, t, b_, r_ - l, b_ - t))
print("  占卡宽比 %.3f   水平中心 %.1f (卡中心 299)" % ((r_ - l) / W, (l + r_) / 2))

txt = Image.open(os.path.join(BAKE, "atlas1.png")).convert("RGBA").crop(
    (674, 1, 674 + 653, 1 + 145))
bb = txt.getchannel("A").getbbox()
print("贴图 alpha bbox = %s  (贴图 %s)" % (bb, txt.size))
sw, sh = bb[2] - bb[0], bb[3] - bb[1]
k_x = (r_ - l) / sw
k_y = (b_ - t) / sh
print("拟合：sx=%.4f  sy=%.4f  ->  贴图(整张 %dx%d) 缩放后 %dx%d，落点 (%.1f, %.1f)" % (
    k_x, k_y, txt.size[0], txt.size[1],
    round(txt.size[0] * k_x), round(txt.size[1] * k_y),
    l - bb[0] * k_x, t - bb[1] * k_y))
