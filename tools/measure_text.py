"""量测卡面上文字的尺寸与位置（我方合成 vs 官方截图），并输出带标尺的放大对比图。

1) 卡名：顶部缎带上的奶白字 —— 判据 = 低饱和 + 高亮度
2) 类型铭牌字：中下部金色小牌上的深色字 —— 先用"列/行计数"法定位金牌，再在其内查深色像素

官方基准 = 用户提供的游戏截图；我方 = assets/baked/card_<id>.png
坐标系：卡面 598x844（卡框贴图分辨率）。
"""
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = r"C:\Users\shenl\Desktop\new"
OUT = os.path.join(ROOT, "assets", "baked")
PREVIEW = os.path.join(ROOT, "tools", "预览图")
REF_SHOT = r"C:\Users\shenl\Pictures\Screenshots\屏幕截图 2026-07-22 201251.png"
REF_CARD_BOX = (5, 30, 320, 475)
W, H = 598, 844
MINE_ID = "end_of_days"

TITLE_BOX = (150, 0, 470, 200)      # 卡名搜索区（避开左上费用宝石）
PLAQUE_BOX = (225, 412, 375, 505)   # 类型铭牌搜索区


def stats(mask, ox, oy):
    """mask 的墨迹统计；ox/oy 为该 mask 在卡面坐标里的原点。"""
    ys, xs = np.nonzero(mask)
    if len(ys) < 12:
        return None
    q = lambda a, p: float(np.percentile(a, p))
    return {"n": int(len(ys)), "ink": float(mask.mean()),
            "top": q(ys, 0.5) + oy, "bot": q(ys, 99.5) + oy,
            "lft": q(xs, 0.5) + ox, "rgt": q(xs, 99.5) + ox,
            "cy": float(ys.mean()) + oy, "cx": float(xs.mean()) + ox}


def title_stats(a):
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    x0, y0, x1, y1 = TITLE_BOX
    return stats(((sat < 0.28) & (mx > 0.62))[y0:y1, x0:x1], x0, y0)


def gold_rect(a):
    """在铭牌搜索区里定位金牌（列/行计数法，滤掉卡框上只有几像素高的金色饰线）。"""
    x0, y0, x1, y1 = PLAQUE_BOX
    sub = a[y0:y1, x0:x1]
    g = (sub[..., 0] > 0.72) & (sub[..., 1] > 0.55) & ((sub[..., 0] - sub[..., 2]) > 0.20)
    col, row = g.sum(axis=0), g.sum(axis=1)
    cols = np.nonzero(col >= max(8, int(col.max() * 0.55)))[0]
    rows = np.nonzero(row >= max(8, int(row.max() * 0.35)))[0]
    if not len(cols) or not len(rows):
        return None
    return (int(cols.min() + x0), int(rows.min() + y0), int(cols.max() + x0), int(rows.max() + y0))


def plaque_stats(im, a):
    g = gold_rect(a)
    if g is None:
        return None, None
    e = 4
    x0, y0 = g[0] + e, g[1] + e
    m = a[y0:g[3] - e, x0:g[2] - e].max(axis=2) < 0.58
    return g, stats(m, x0, y0)


def report(tag, r, m, extra=""):
    print("[%s] 官方 %s" % (tag, r))
    print("[%s] 我方 %s" % (tag, m))
    if r and m:
        print("   Δ中心y=%+.1f  Δ中心x=%+.1f  Δ字高=%+.1f (官方%.1f / 我方%.1f)  %s" % (
            m["cy"] - r["cy"], m["cx"] - r["cx"],
            (m["bot"] - m["top"]) - (r["bot"] - r["top"]),
            r["bot"] - r["top"], m["bot"] - m["top"], extra))


def panel(ref, mine, box, zoom, dst_name, rs, ms, cy_only=False):
    x0, y0, x1, y1 = box
    cw, chh = int((x1 - x0) * zoom), int((y1 - y0) * zoom)
    cv = Image.new("RGBA", (cw * 2 + 10, chh), (24, 22, 32, 255))
    cv.alpha_composite(ref.crop(box).resize((cw, chh), Image.LANCZOS), (0, 0))
    cv.alpha_composite(mine.crop(box).resize((cw, chh), Image.LANCZOS), (cw + 10, 0))
    d = ImageDraw.Draw(cv)
    for ox, t in ((0, rs), (cw + 10, ms)):
        if not t:
            continue
        keys = ("cy",) if cy_only else ("top", "cy", "bot")
        for k in keys:
            yy = (t[k] - y0) * zoom
            d.line([(ox, yy), (ox + cw, yy)],
                   fill=(255, 0, 255) if k == "cy" else (0, 255, 255), width=1)
    dst = os.path.join(PREVIEW, dst_name)
    cv.save(dst)
    print("   对比图:", dst)


def main():
    ref = Image.open(REF_SHOT).convert("RGBA").crop(REF_CARD_BOX).resize((W, H), Image.LANCZOS)
    mine = Image.open(os.path.join(OUT, "card_%s.png" % MINE_ID)).convert("RGBA")
    ar = np.asarray(ref.convert("RGB"), dtype=np.float64) / 255.0
    am = np.asarray(mine.convert("RGB"), dtype=np.float64) / 255.0

    # --- 卡名 ---
    rt, mt = title_stats(ar), title_stats(am)
    report("卡名", rt, mt)
    panel(ref, mine, TITLE_BOX, 1.6, "cmp_title.png", rt, mt)

    # --- 类型铭牌 ---
    gr, tr = plaque_stats(ref, ar)
    gm, tmx = plaque_stats(mine, am)
    print("[铭牌] 官方金底 %s 尺寸 %dx%d" % (gr, gr[2] - gr[0] + 1, gr[3] - gr[1] + 1))
    print("[铭牌] 我方金底 %s 尺寸 %dx%d" % (gm, gm[2] - gm[0] + 1, gm[3] - gm[1] + 1))
    report("铭牌字", tr, tmx, extra="墨迹比 官方%.3f 我方%.3f" % (tr["ink"], tmx["ink"]))
    panel(ref, mine, PLAQUE_BOX, 3.0, "cmp_plaque.png", tr, tmx)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
