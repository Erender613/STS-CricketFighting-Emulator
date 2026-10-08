# -*- coding: utf-8 -*-
"""君王之剑 v2 校验：用「蓝/青特征掩膜」自动定位剑身，再做形态+配色对比。"""
import os, io, sys, traceback
from PIL import Image, ImageChops

ROOT = r"C:\Users\shenl\Desktop\new"
PV = os.path.join(ROOT, "tools", "预览图")
BUF = io.StringIO()

def P(*a):
    t = " ".join(str(x) for x in a)
    BUF.write(t + "\n")

def is_blue(r, g, b):
    """剑身蓝：蓝显著高于红，且不是灰白"""
    return b - r > 30 and b > 70

def is_cyan(r, g, b):
    """描边青：绿蓝都高、红低（有点像发光边）"""
    return g > 170 and b > 180 and r < 170 and (g - r) > 40

def is_orange(r, g, b):
    return r - b > 45 and r > 120 and g > 60

def mask_bbox(im, fn, step=1):
    px = im.load(); W, H = im.size
    x0 = y0 = 10 ** 9; x1 = y1 = -1; n = 0
    sr = sg = sb = 0
    for y in range(0, H, step):
        for x in range(0, W, step):
            r, g, b = px[x, y]
            if fn(r, g, b):
                n += 1
                sr += r; sg += g; sb += b
                if x < x0: x0 = x
                if y < y0: y0 = y
                if x > x1: x1 = x
                if y > y1: y1 = y
    if n == 0:
        return None
    return dict(n=n, box=(x0, y0, x1 + 1, y1 + 1),
                w=x1 - x0 + 1, h=y1 - y0 + 1,
                mean=(sr // n, sg // n, sb // n), px_total=W * H)

def report(name, im):
    if im is None:
        P("  %-26s (缺图)" % name); return None
    W, H = im.size
    P("  %-26s 图幅 %dx%d" % (name, W, H))
    res = {}
    for label, fn in (("蓝(剑身)", is_blue), ("青(描边)", is_cyan), ("橙(装饰)", is_orange)):
        m = mask_bbox(im, fn, step=1)
        if m is None:
            P("      %s : 无" % label); continue
        res[label] = m
        P("      %-7s 像素%6d (占%.2f%%)  框 %dx%d  长宽比%.2f  均色 RGB%s" %
          (label, m["n"], 100.0 * m["n"] / m["px_total"], m["w"], m["h"],
           m["h"] / max(m["w"], 1), m["mean"]))
    return res

P("=" * 70)
P("A. 原版参考截图（真实游戏画面）")
P("=" * 70)
ref = Image.open(os.path.join(PV, "ref_181254.png")).convert("RGB")
rr = report("ref_181254", ref)
# 顺带看另一张
ref2 = Image.open(os.path.join(PV, "ref_181203.png")).convert("RGB")
rr2 = report("ref_181203", ref2)

P("")
P("=" * 70)
P("B. 本次实现渲染")
P("=" * 70)
for n in ("sb_x3.png", "sb_x1.png", "sb_ingame_zoom.png",
          "probe_shot.png", "arena_k17.png"):
    p = os.path.join(PV, n)
    if os.path.exists(p):
        report(n, Image.open(p).convert("RGB"))

# ---------------------------------------------------------------- 关键：把原版参考里的剑身裁出来
P("")
P("=" * 70)
P("C. 裁出原版剑身特写（供肉眼/后续比对）")
P("=" * 70)
if rr and "蓝(剑身)" in rr:
    b = rr["蓝(剑身)"]["box"]
    pad = 30
    box = (max(0, b[0] - pad), max(0, b[1] - pad),
           min(ref.size[0], b[2] + pad), min(ref.size[1], b[3] + pad))
    crop = ref.crop(box)
    out = os.path.join(PV, "ref_sword_crop.png")
    crop.save(out)
    P("  原版剑身外接框 %s → 加边裁切 %s  输出 %s (%dx%d)" %
      (str(b), str(box), os.path.basename(out), crop.size[0], crop.size[1]))
    # 剑身中轴竖向采样：每 5% 高度取一条水平线的中位色
    px = crop.load(); W, H = crop.size
    P("  中轴竖向色带（每 10%% 高度取一行中位色）:")
    for k in range(1, 10):
        y = H * k // 10
        row = sorted((px[x, y][0] + px[x, y][1] + px[x, y][2], px[x, y]) for x in range(W))
        med = row[len(row) // 2][1]
        mid = px[W // 2, y]
        P("     y=%3d(%.0f%%)  行中位%s  中线%s" % (y, k * 10, str(med), str(mid)))

# ---------------------------------------------------------------- 两侧并排对照图
P("")
P("=" * 70)
P("D. 生成并排对照图 ref_vs_mine.png")
P("=" * 70)
try:
    if rr and "蓝(剑身)" in rr:
        b = rr["蓝(剑身)"]["box"]
        pad = 40
        refc = ref.crop((max(0, b[0] - pad), max(0, b[1] - pad),
                         min(ref.size[0], b[2] + pad), min(ref.size[1], b[3] + pad)))
        mine = Image.open(os.path.join(PV, "sb_x3.png")).convert("RGB")
        H = 620
        a = refc.resize((max(1, int(refc.size[0] * H / refc.size[1])), H), Image.LANCZOS)
        b2 = mine.resize((max(1, int(mine.size[0] * H / mine.size[1])), H), Image.LANCZOS)
        out = Image.new("RGB", (a.size[0] + b2.size[0] + 16, H), (245, 246, 248))
        out.paste(a, (0, 0)); out.paste(b2, (a.size[0] + 16, 0))
        op = os.path.join(PV, "ref_vs_mine.png")
        out.save(op)
        P("  左=原版参考  右=本次渲染  输出 %s  %dx%d" % (os.path.basename(op), out.size[0], out.size[1]))
except Exception:
    P("  生成失败:\n" + traceback.format_exc())

with open(os.path.join(ROOT, "tools", "_sb_check2.txt"), "w", encoding="utf-8") as f:
    f.write(BUF.getvalue())
