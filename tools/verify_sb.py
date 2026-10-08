# -*- coding: utf-8 -*-
"""君王之剑（Sovereign Blade）最终验收：
1) 确认 src/game.html 与 打包产物 的关键改动都在
2) 对 in-game 渲染截图做像素采样，与反编译原版参考图对比色带
"""
import os, re, json, io, sys
from PIL import Image

_REPORT = io.StringIO()
def print(*a, **k):  # noqa: A001 —— 结果同时落盘，便于控制台无回显时读取
    txt = " ".join(str(x) for x in a)
    _REPORT.write(txt + "\n")
    try:
        sys.__stdout__.write(txt + "\n")
    except Exception:
        pass

ROOT = r"C:\Users\shenl\Desktop\new"
SRC  = os.path.join(ROOT, "src", "game.html")
DIST = os.path.join(ROOT, "杀戮尖塔小球对决.html")
PV   = os.path.join(ROOT, "tools", "预览图")

def hr(t):
    print("\n" + "=" * 62)
    print(t)
    print("=" * 62)

# ---------------------------------------------------------------- 1. 源码/产物核对
hr("1. 改动核对")
for p in (SRC, DIST):
    if os.path.exists(p):
        st = os.stat(p)
        print("  %-28s %9d bytes   %s" % (os.path.basename(p), st.st_size,
              __import__("time").strftime("%H:%M:%S", __import__("time").localtime(st.st_mtime))))
    else:
        print("  !! MISSING", p)

src = open(SRC, encoding="utf-8").read()
dist = open(DIST, encoding="utf-8").read()

checks = [
    ("源码 bonusPerBounce: 15",   re.search(r"bonusPerBounce:\s*15\b", src)),
    ("源码 bonusPerBounce 旧值25清除", not re.search(r"bonusPerBounce:\s*25\b", src)),
    ("源码 反弹播 card_smith",     re.search(r"card_smith', 0\.62", src)),
    ("源码 铸入播 card_smith",     re.search(r"card_smith', 1\.0", src)),
    ("源码 SB 配置块",            "const SB" in src or "SB = {" in src),
    ("源码 drawSovereignBlade",   "drawSovereignBlade" in src),
    ("源码 6+ 剑部件贴图键",       all(k in src for k in
        ["sp_sb_blade", "sp_sb_shine", "sp_sb_outline", "sp_sb_glow", "sp_sb_hilt", "sp_sb_hilt2"])),
]
for name, ok in checks:
    print("  [%s] %s" % ("OK " if ok else "FAIL", name))

# 打包产物里贴图是否真的内联了（dataURI 或已经在 asset map 里）
hr("2. 打包产物内联核对")
for k in ["sp_sb_blade", "sp_sb_shine", "sp_sb_outline", "sp_sb_glow",
          "sp_sb_hilt", "sp_sb_hilt2", "sp_sb_deco"]:
    print("  [%s] %s 出现在打包文件" % ("OK " if k in dist else "FAIL", k))
print("  [%s] card_smith 音效键出现" % ("OK " if "card_smith" in dist else "FAIL"))
print("  [%s] bonusPerBounce:15 生效" % ("OK " if re.search(r"bonusPerBounce:\s*15\b", dist) else "FAIL"))
print("  打包体积 %.2f MB" % (len(dist.encode("utf-8")) / 1048576.0))

# ---------------------------------------------------------------- 3. 像素采样对比
def load(n):
    p = os.path.join(PV, n)
    return Image.open(p).convert("RGB") if os.path.exists(p) else None

def sword_box(im, bgtol=14):
    """找出画面里非背景内容的最小外接矩形（背景取四角中位数色）"""
    px = im.load(); W, H = im.size
    corners = [px[2, 2], px[W - 3, 2], px[2, H - 3], px[W - 3, H - 3]]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    xs, ys = [], []
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            r, g, b = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > bgtol * 3:
                xs.append(x); ys.append(y)
    if not xs:
        return None, bg
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1), bg

def profile(im, box, n=9):
    """沿外接矩形宽度等分 n 段，给出每段的平均色 → 用于色带对比"""
    px = im.load()
    x0, y0, x1, y1 = box
    out = []
    for i in range(n):
        a = x0 + (x1 - x0) * i // n
        b = x0 + (x1 - x0) * (i + 1) // n
        sr = sg = sb = cnt = 0
        for y in range(y0, y1, 2):
            for x in range(a, max(a + 1, b), 2):
                r, g, bl = px[x, y]
                sr += r; sg += g; sb += bl; cnt += 1
        out.append((sr // max(cnt, 1), sg // max(cnt, 1), sb // max(cnt, 1)))
    return out

hr("3. 渲染结果 vs 原版参考（色带采样）")
ref = load("ref_181254.png")
mine = load("sb_x3.png")
mine1 = load("sb_x1.png")
ingame = load("sb_ingame_zoom.png")

for tag, im in [("原版参考 ref_181254", ref), ("本次渲染 sb_x3(3x)", mine),
                ("本次渲染 sb_x1(1x)", mine1), ("游戏内 sb_ingame_zoom", ingame)]:
    if im is None:
        print("  %-24s (缺图)" % tag); continue
    box, bg = sword_box(im)
    if box is None:
        print("  %-24s 无可识别内容" % tag); continue
    w = box[2] - box[0]; h = box[3] - box[1]
    print("  %-24s 尺寸%dx%d  内容框 %dx%d  长宽比 %.2f" %
          (tag, im.size[0], im.size[1], w, h, h / max(w, 1)))

def dominant(im, box):
    """统计剑身范围内的主色：偏蓝? 偏青? 偏橙?"""
    px = im.load()
    x0, y0, x1, y1 = box
    blue = cyan = orange = white = tot = 0
    bs = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if r + g + b < 40:
                continue
            tot += 1
            bs.append(b - r)
            if b > r + 25 and b > 60 and g < b + 10:
                if g > b - 45 and r < 140:
                    cyan += 1
                else:
                    blue += 1
            elif r > b + 35 and r > 110:
                orange += 1
            elif r > 200 and g > 200 and b > 200:
                white += 1
    if not tot:
        return None
    bs.sort()
    return dict(tot=tot, blue=blue / tot, cyan=cyan / tot,
                orange=orange / tot, white=white / tot,
                medBlueMinusRed=bs[len(bs) // 2])

hr("4. 色相分布（剑身区域）")
for tag, im in [("原版参考 ref_181254", ref), ("本次渲染 sb_x3(3x)", mine),
                ("游戏内 sb_ingame_zoom", ingame)]:
    if im is None:
        continue
    box, _ = sword_box(im)
    if box is None:
        continue
    d = dominant(im, box)
    if d is None:
        print("  %-24s 空" % tag); continue
    print("  %-24s 蓝%.0f%%  青%.0f%%  橙%.0f%%  白%.0f%%  | 中位(B-R)=%d" %
          (tag, d["blue"] * 100, d["cyan"] * 100, d["orange"] * 100,
           d["white"] * 100, d["medBlueMinusRed"]))
print("\n  说明：原版剑身为蓝色系、边缘青色描边、橙色仅作装饰星芒点缀。")
print("        若本次渲染蓝+青占比与原版同量级、橙色占比低，即判定还原成功。")

with open(os.path.join(ROOT, "tools", "_verify_out.txt"), "w", encoding="utf-8") as f:
    f.write(_REPORT.getvalue())
