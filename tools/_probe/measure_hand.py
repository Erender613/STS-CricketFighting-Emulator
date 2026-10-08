# -*- coding: utf-8 -*-
"""量测 zoom 探针导出的 1:1 位图：手的位置/朝向/颜色 + 黑洞椭圆比例。
布局（mkprobe.py 里的 5 个样本）：
  (30,150, len=60)  刚探出      (30,400, len=190) 半伸出
  (30,650, len=420) 完全伸出    (620,150, len=420, grip=1) 攥紧
  (620,400, len=420, 退场 shrink=0.72 alpha=0.55 hole=0.45)
"""
import numpy as np
from PIL import Image

P = r"C:\Users\shenl\Desktop\new\tools\_probe\_z_img1.png"
BG = np.array([0x15, 0x11, 0x24], dtype=np.int16)
a = np.asarray(Image.open(P).convert("RGB")).astype(np.int16)
H, W = a.shape[:2]
print("位图 %dx%d" % (W, H))
d = np.abs(a - BG).sum(axis=2)
nz = d > 10
print("非底色像素 %d（%.1f%%）" % (int(nz.sum()), 100.0 * nz.sum() / nz.size))


def ascii_win(x0, y0, x1, y1, cw=86, ch=30, tag=""):
    sub = d[y0:y1, x0:x1]
    rgb = a[y0:y1, x0:x1]
    h, w = sub.shape
    print("\n--- %s  x %d..%d  y %d..%d ---" % (tag, x0, x1, y0, y1))
    print("    +" + "-" * cw + "+")
    for cy in range(ch):
        ya, yb = int(cy * h / ch), max(int(cy * h / ch) + 1, int((cy + 1) * h / ch))
        line = ""
        for cx in range(cw):
            xa, xb = int(cx * w / cw), max(int(cx * w / cw) + 1, int((cx + 1) * w / cw))
            m = sub[ya:yb, xa:xb] > 10
            if m.mean() < 0.12:
                line += " "
            else:
                px = rgb[ya:yb, xa:xb][m]
                mm = px.mean(axis=0)
                if mm.sum() < 90:
                    line += "."            # 近黑 = 黑洞内核
                elif mm[2] - mm[1] > 40:
                    line += "#"            # 明显偏紫 = 手/手臂/紫环
                else:
                    line += "+"
        print("    |" + line + "| y=%4d" % (y0 + ya))
    print("    +" + "-" * cw + "+")


def region(x0, y0, x1, y1, tag=""):
    sub = a[y0:y1, x0:x1]
    dd = d[y0:y1, x0:x1]
    m = dd > 10
    n = int(m.sum())
    print("\n[%s] 区域 x%d..%d y%d..%d  非底色 %d 个" % (tag, x0, x1, y0, y1, n))
    if not n:
        return
    px = sub[m]
    print("   均值 RGB=(%d,%d,%d)  最大亮度=%d" % (px[:, 0].mean(), px[:, 1].mean(), px[:, 2].mean(), px.max()))
    ys, xs = np.nonzero(m)
    print("   bbox x %d..%d (宽 %d)  y %d..%d (高 %d)"
          % (x0 + xs.min(), x0 + xs.max(), xs.max() - xs.min() + 1,
             y0 + ys.min(), y0 + ys.max(), ys.max() - ys.min() + 1))
    violet = m & (sub[..., 2] - sub[..., 1] > 40)
    print("   其中偏紫（手/臂/紫环）%d 个，均值 RGB=(%d,%d,%d)"
          % (int(violet.sum()),
             sub[violet][:, 0].mean() if violet.any() else 0,
             sub[violet][:, 1].mean() if violet.any() else 0,
             sub[violet][:, 2].mean() if violet.any() else 0))


ascii_win(0, 90, 520, 230, 86, 18, "样本1 len=60（刚探出）")
ascii_win(0, 330, 600, 480, 90, 20, "样本3 len=190（半伸出）")
ascii_win(0, 560, 520, 760, 86, 24, "样本5 len=420（完全伸出）")
region(30, 150, 40, 160, "洞口核心")
region(0, 95, 320, 225, "样本1 全身")
region(0, 340, 640, 470, "样本2 全身")

# 黑洞椭圆：在 len 很小时，靠洞口那一块应当是一竖条椭圆
print("\n--- 黑洞椭圆量测（样本1 洞口附近找近黑核心）---")
win = a[95:230, 0:80]
dk = (win.sum(axis=2) < 40)
if dk.any():
    ys, xs = np.nonzero(dk)
    print("   近黑 bbox x %d..%d (宽 %d)  y %d..%d (高 %d)  高/宽=%.2f"
          % (xs.min(), xs.max(), xs.max() - xs.min() + 1,
             ys.min() + 95, ys.max() + 95, ys.max() - ys.min() + 1,
             (ys.max() - ys.min() + 1) / max(1, xs.max() - xs.min() + 1)))
else:
    print("   !! 没找到近黑像素")
