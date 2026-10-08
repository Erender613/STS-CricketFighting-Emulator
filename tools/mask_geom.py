# -*- coding: utf-8 -*-
"""量出剑身/描边两张贴图里『实体形状』的真实范围（用于算局部坐标）。"""
import os, io
from PIL import Image

SRC = r"C:\Users\shenl\Desktop\new\assets\src"
BUF = io.StringIO()
def P(*a): BUF.write(" ".join(str(x) for x in a) + "\n")

def probe(name, thresh):
    p = os.path.join(SRC, name + ".png")
    im = Image.open(p).convert("RGBA")
    W, H = im.size
    px = im.load()
    P("=" * 70)
    P("%s   %dx%d" % (name, W, H))
    P("=" * 70)
    # 用 alpha 或 亮度 判断实体
    def solid(x, y):
        r, g, b, a = px[x, y]
        return (a > 128) and (0.299 * r + 0.587 * g + 0.114 * b) > thresh
    # 每行实体 x 范围（每 5% 高度采样）
    P("  行   y     实体 x 范围       宽")
    for k in range(0, 21):
        y = min(H - 1, int(H * k / 20))
        xs = [x for x in range(W) if solid(x, y)]
        if xs:
            P("   %3d%% y=%4d   x %3d..%3d      %3d" % (k * 5, y, min(xs), max(xs), max(xs) - min(xs) + 1))
        else:
            P("   %3d%% y=%4d   --" % (k * 5, y))
    # 整体 bbox
    xs = []; ys = []
    for y in range(H):
        for x in range(W):
            if solid(x, y):
                xs.append(x); ys.append(y)
    P("  实体 bbox: x %d..%d (宽%d)   y %d..%d (高%d)" %
      (min(xs), max(xs), max(xs) - min(xs) + 1, min(ys), max(ys), max(ys) - min(ys) + 1))
    P("  实体 bbox 相对画布: 左%+.1f%%  右%+.1f%%  上%+.1f%%  下%+.1f%%" %
      (100.0 * min(xs) / W, -100.0 * (W - 1 - max(xs)) / W,
       100.0 * min(ys) / H, -100.0 * (H - 1 - max(ys)) / H))
    # 关键：中线那一条（剑身最宽处）实体范围
    midy = (min(ys) + max(ys)) // 2
    xs2 = [x for x in range(W) if solid(x, midy)]
    if xs2:
        P("  中段 y=%d 实体 x %d..%d 宽 %d  → 占画布宽 %.1f%%" %
          (midy, min(xs2), max(xs2), max(xs2) - min(xs2) + 1, 100.0 * (max(xs2) - min(xs2) + 1) / W))
    P("")

probe("sp_sb_blade", 40)
probe("sp_sb_outline", 180)
probe("sp_sb_shine", 180)
probe("sp_sb_glow", 40)

with open(r"C:\Users\shenl\Desktop\new\tools\_mask_geom.txt", "w", encoding="utf-8") as f:
    f.write(BUF.getvalue())
print("ok")
