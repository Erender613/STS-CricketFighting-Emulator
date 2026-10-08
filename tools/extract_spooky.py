# -*- coding: utf-8 -*-
"""从 STS2 反编译工程抽取「夜魇之手」特效贴图 spooky_hand.png。

源资源: pck-extracted/images/packed/vfx/combat/spooky_hand.png（只剩 .import）
映射  : 读同目录 .import 里 path="res://.godot/imported/xxx.ctex"
抽取  : .ctex 头部 GST2，内嵌 WebP（RIFF 起）→ 直接切片
"""
import os, re, tempfile
from PIL import Image

# 注意：.import 里的 res:// 是相对**工程根**的，本工程根 = pck-extracted
ROOT = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted"
IMP = os.path.join(ROOT, r"images\packed\vfx\combat\spooky_hand.png.import")
OUT = r"C:\Users\shenl\Desktop\new\assets\vfx\spooky_hand.png"

raw = open(IMP, "rb").read()
txt = raw.decode("utf-8", "ignore")
paths = re.findall(r'^path(?:\.\w+)?="res://([^"]+)"', txt, re.M)
print("import 文件声明的产物路径:")
for p in paths:
    print("   ", p)

found = None
for p in paths:
    full = os.path.join(ROOT, p.replace("/", os.sep))
    if os.path.exists(full):
        found = full
        print("命中:", full, os.path.getsize(full), "bytes")
        break
if not found:
    raise SystemExit("没找到 .ctex，检查 .godot/imported 是否被解包出来")

data = open(found, "rb").read()
print("魔数:", data[:4])
assert data[:4] == b"GST2", "不是 GST2，可能是压缩格式，需走 Godot 解码"
i = data.find(b"RIFF")
print("RIFF 偏移:", i)
assert i > 0, "未内嵌 WebP"

fd, tmp = tempfile.mkstemp(suffix=".webp")
os.close(fd)
open(tmp, "wb").write(data[i:])
im = Image.open(tmp)
im.load()
im = im.convert("RGBA")
print("尺寸:", im.size, " 模式:", im.mode)
bb = im.getbbox()
print("不透明区 bbox:", bb, "→", (bb[2]-bb[0], bb[3]-bb[1]))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
im.save(OUT, "PNG")
print("已写出:", OUT, os.path.getsize(OUT), "bytes")

# 顺手看看贴图的色彩分布（判定是"浅色实体手"还是"白形遮罩"）
px = im.load()
w, h = im.size
opaque = 0
rs = gs = bs = 0
for y in range(0, h, 3):
    for x in range(0, w, 3):
        r, g, b, a = px[x, y]
        if a > 32:
            opaque += 1
            rs += r; gs += g; bs += b
print("采样不透明像素:", opaque)
if opaque:
    print("平均色 (不透明区): (%d,%d,%d)" % (rs//opaque, gs//opaque, bs//opaque))
# 四角像素（看背景是否透明）
print("四角 RGBA:", px[0, 0], px[w-1, 0], px[0, h-1], px[w-1, h-1])
