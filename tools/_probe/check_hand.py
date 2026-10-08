# -*- coding: utf-8 -*-
"""从探针截图里验证「夜魇之手」画得对不对：
   1) 打印截图真实尺寸（--screenshot 有可能被缩放，先确认）
   2) 把已绘制手的区域降采样成 ASCII 剪影 —— 无图形界面下"目视"朝向/形状
   3) 统计手部像素的颜色，确认是淡紫加法混合而不是黑块/空图
   4) 量黑洞椭圆的宽高比，确认是"竖裂缝"椭圆
"""
import os
import numpy as np
from PIL import Image

PV = r"C:\Users\shenl\Desktop\new\tools\_probe"
BG = np.array([0x15, 0x11, 0x24], dtype=np.int16)   # 探针画布底色 #151124


def load(name):
    p = os.path.join(PV, name)
    im = Image.open(p).convert("RGB")
    print("%-16s %s" % (name, im.size))
    return np.asarray(im).astype(np.int16)


def silhouette(a, x0, y0, x1, y1, cw=76, ch=26, thr=10, label=""):
    sub = a[y0:y1, x0:x1]
    d = np.abs(sub - BG).sum(axis=2)
    print("\n--- %s  区域 x %d..%d  y %d..%d（阈值 %d）---" % (label, x0, x1, y0, y1, thr))
    h, w = d.shape
    rows = []
    for cy in range(ch):
        ya, yb = int(cy * h / ch), max(int(cy * h / ch) + 1, int((cy + 1) * h / ch))
        line = ""
        for cx in range(cw):
            xa, xb = int(cx * w / cw), max(int(cx * w / cw) + 1, int((cx + 1) * w / cw))
            blk = d[ya:yb, xa:xb]
            m = blk.mean()
            if m < thr:
                line += " "
            else:
                px = sub[ya:yb, xa:xb].reshape(-1, 3)[blk.reshape(-1) > thr]
                line += "#" if px.mean() > 110 else ("+" if px.mean() > 50 else ".")
        rows.append(line)
    print("+" + "-" * cw + "+")
    for i, l in enumerate(rows):
        print("|" + l + "| y=%4d" % (y0 + i * h // ch))
    print("+" + "-" * cw + "+")


def stats(a, x0, y0, x1, y1, thr=10, label=""):
    sub = a[y0:y1, x0:x1]
    d = np.abs(sub - BG).sum(axis=2)
    m = d > thr
    n = int(m.sum())
    print("\n--- %s 统计 ---" % label)
    print("  非底色像素 %d（占 %.1f%%）" % (n, 100.0 * n / m.size))
    if not n:
        return None
    px = sub[m]
    print("  均值 RGB = (%d, %d, %d)   最大 = %s"
          % (px[:, 0].mean(), px[:, 1].mean(), px[:, 2].mean(), px.max(axis=0)))
    ys, xs = np.nonzero(m)
    print("  bbox = x %d..%d (%d)  y %d..%d (%d)"
          % (x0 + xs.min(), x0 + xs.max(), xs.max() - xs.min(),
             y0 + ys.min(), y0 + ys.max(), ys.max() - ys.min()))
    return px


def main():
    z = load("arena_zoom.png")
    h = load("arena_hand.png")

    # zoom：第 1 只手画在 (30,130)，len=420 → 手臂 30..240，手 240..450
    silhouette(z, 20, 40, 470, 240, label="zoom 第1只手（len=420：手臂+手）")
    stats(z, 240, 40, 470, 240, label="zoom 手部（贴图区）")
    stats(z, 34, 60, 238, 200, label="zoom 手臂区")

    # 黑洞：画在 (30,130)，椭圆 scale(0.42,1) 半长轴 54 → y 半 54、x 半 22.7
    print("\n--- 黑洞椭圆量测（在 x=30 附近找最暗核心的范围）---")
    band = z[40:230, 0:70]
    dark = (band.sum(axis=2) < 30)
    if dark.any():
        ys, xs = np.nonzero(dark)
        print("  近黑像素 bbox = x %d..%d (宽 %d)  y %d..%d (高 %d)  高/宽 = %.2f"
              % (xs.min(), xs.max(), xs.max() - xs.min() + 1,
                 ys.min() + 40, ys.max() + 40, ys.max() - ys.min() + 1,
                 (ys.max() - ys.min() + 1) / max(1, xs.max() - xs.min() + 1)))
    else:
        print("  !! 没找到近黑像素")

    # arena 实景：整场扫一遍紫色（手）像素
    print("\n--- 竞技场实景：找淡紫色（手）像素 ---")
    r, g, b = h[..., 0], h[..., 1], h[..., 2]
    violet = (b > r + 8) & (r > g + 8) & (b > 40)
    print("  偏紫像素 %d 个" % int(violet.sum()))
    if violet.any():
        px = h[violet]
        print("  均值 RGB = (%d, %d, %d)" % (px[:, 0].mean(), px[:, 1].mean(), px[:, 2].mean()))
        ys, xs = np.nonzero(violet)
        print("  bbox = x %d..%d  y %d..%d" % (xs.min(), xs.max(), ys.min(), ys.max()))


if __name__ == "__main__":
    main()
