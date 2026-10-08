# -*- coding: utf-8 -*-
"""原版参考 vs 本次渲染：沿剑身 45% / 70% 处取横截面，按百分比位置逐段对比颜色。"""
import os
from PIL import Image

PV = r"C:\Users\shenl\Desktop\new\tools\预览图"

def blade_span(im):
    px = im.load(); W, H = im.size
    cols = []
    for x in range(W):
        ys = [y for y in range(H)
              if (lambda c: c[2] - c[0] > 30 and c[2] > 70 and c[1] > 70)(px[x, y])]
        if ys:
            cols.append((x, min(ys), max(ys)))
    if not cols:
        return None
    return cols

def section(im, pct):
    cols = blade_span(im)
    if not cols:
        return []
    x0 = cols[0][0]; x1 = cols[-1][0]
    x = int(x0 + (x1 - x0) * pct)
    near = [c for c in cols if abs(c[0] - x) <= 2]
    if not near:
        return []
    _, ya, yb = near[len(near) // 2]
    px = im.load()
    out = []
    for k in range(21):
        y = ya + int((yb - ya) * k / 20)
        c = px[x, y]
        out.append((k * 5, c))
    return out

A = Image.open(os.path.join(PV, "ref_181254.png")).convert("RGB")
B = Image.open(os.path.join(PV, "_n_img1.png")).convert("RGB")

lines = []
for pct in (0.45, 0.72):
    sa = section(A, pct)
    sb = section(B, pct)
    lines.append("=" * 74)
    lines.append("横截面 @ 剑长 %d%%      左=原版参考      右=本次渲染" % (pct * 100))
    lines.append("=" * 74)
    lines.append("  位置   原版 RGB           #hex      本次 RGB           #hex")
    for i in range(max(len(sa), len(sb))):
        la = sa[i] if i < len(sa) else (None, None)
        lb = sb[i] if i < len(sb) else (None, None)
        f = lambda t: ("RGB%-16s #%02x%02x%02x" % (str(t[1]), t[1][0], t[1][1], t[1][2])) if t[1] else " " * 26
        lines.append("  %3s%%   %s   %s" % (la[0] if la[0] is not None else "--", f(la), f(lb)))
    lines.append("")

open(os.path.join(PV, "_band_cmp.txt"), "w", encoding="utf-8").write("\n".join(lines))
