# -*- coding: utf-8 -*-
"""量测卡面「下半部文字区」的位置与行距（以官方截图为准）。

目的：我们原来把 DescriptionLabel 留空了，现在要往里放一行/两行中文描述。
      与其猜坐标，不如直接从官方卡面截图里量出「那段描述文字」占用的矩形与行距。

判据：描述文字是奶白/浅色的（低饱和 + 高亮度），底是深色卡框 —— 与 measure_text.py 里
      卡名的判据一致。搜索区限制在卡面下半部（避开类型铭牌与卡框边缘）。

坐标：卡面 598x844（= 卡框贴图分辨率）。
"""
import os

import numpy as np
from PIL import Image

ROOT = r"C:\Users\shenl\Desktop\new"
OUT = os.path.join(ROOT, "assets", "baked")
PREVIEW = os.path.join(ROOT, "tools", "预览图")
REF_SHOT = r"C:\Users\shenl\Pictures\Screenshots\屏幕截图 2026-07-22 201251.png"
REF_CARD_BOX = (5, 30, 320, 475)
W, H = 598, 844
MINE_ID = "end_of_days"

# 文字区搜索范围：横向上留出卡框左右边饰，纵向从铭牌下方到卡底上方
SEARCH = (70, 505, 528, 800)


def ink_mask(a):
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    return (sat < 0.38) & (mx > 0.60)


def lines_of(mask, oy, frac=0.06):
    """按行投影切出「文字行」，返回 [(y0, y1, 墨迹数), ...]。"""
    row = mask.sum(axis=1)
    thr = max(2, int(row.max() * frac))
    on = row > thr
    out, s = [], None
    for y, v in enumerate(on):
        if v and s is None:
            s = y
        elif not v and s is not None:
            out.append((s + oy, y - 1 + oy, int(row[s:y].sum())))
            s = None
    if s is not None:
        out.append((s + oy, len(on) - 1 + oy, int(row[s:].sum())))
    return [l for l in out if l[1] - l[0] >= 4]


def analyse(path, tag):
    im = Image.open(path).convert("RGBA").resize((W, H), Image.LANCZOS)
    a = np.asarray(im.convert("RGB"), dtype=np.float64) / 255.0
    x0, y0, x1, y1 = SEARCH
    m = ink_mask(a)[y0:y1, x0:x1]
    ys, xs = np.nonzero(m)
    print("== %s ==" % tag)
    if len(ys) < 40:
        print("  文字区内墨迹过少(%d)，可能没有描述文字" % len(ys))
        return None
    q = lambda arr, p: float(np.percentile(arr, p))
    box = (q(xs, 0.5) + x0, q(ys, 0.3) + y0, q(xs, 99.7) + x0, q(ys, 99.7) + y0)
    print("  墨迹框  x %.1f..%.1f (宽 %.1f)   y %.1f..%.1f (高 %.1f)"
          % (box[0], box[2], box[2] - box[0], box[1], box[3], box[3] - box[1]))
    print("  中心     cx %.1f  cy %.1f" % ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2))
    for frac in (0.03, 0.06, 0.10):
        ls = lines_of(m, y0, frac)
        print("  行切分(阈值%.2f) -> %d 行: %s" % (
            frac, len(ls), " | ".join("y%d..%d(高%d)" % (a0, b0, b0 - a0) for a0, b0, _ in ls)))
    # 文字/底色取样
    rgb = np.asarray(im.convert("RGB"), dtype=np.float64)[y0:y1, x0:x1]
    sel = m
    print("  文字色 meanRGB %s" % np.round(rgb[sel].mean(axis=0)).astype(int))
    bg = rgb[~sel]
    bright = bg[(bg.max(axis=1) > 0.20)]
    print("  底色   meanRGB %s (n=%d)" % (np.round(bright.mean(axis=0)).astype(int) if len(bright) else "-", len(bright)))
    return box


def main():
    print("搜索区 (x0,y0,x1,y1) =", SEARCH)
    r = analyse(REF_SHOT and os.path.join(REF_SHOT) if False else REF_SHOT, "官方截图")
    analyse(os.path.join(OUT, "card_%s.png" % MINE_ID), "我方 card_%s" % MINE_ID)
    if r:
        print("\n建议文字区矩形（留 6px 余量）: (%d, %d, %d, %d)"
              % (r[0] - 6, r[1] - 6, r[2] + 6, r[3] + 6))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
