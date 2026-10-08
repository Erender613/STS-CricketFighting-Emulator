"""从卡框贴图的 alpha 里找出"卡图窗"的真实范围（透明连通区）。

card.tscn 里 Portrait 节点的矩形与卡框透明窗口并不完全重合，
这里以卡框自身为准，让原画正好填满窗口。
"""
import os
from collections import deque

import numpy as np
from PIL import Image

ROOT = r"C:\Users\shenl\Desktop\new"
BAKE = os.path.join(ROOT, "tools", "bake")
FRAME = {
    "attack": (os.path.join(BAKE, "atlas0.png"), (1320, 83, 598, 844)),
    "skill": (os.path.join(BAKE, "atlas0.png"), (1221, 929, 598, 844)),
    "power": (os.path.join(BAKE, "atlas0.png"), (621, 929, 598, 844)),
}

for name, (path, (x, y, w, h)) in FRAME.items():
    im = Image.open(path).convert("RGBA").crop((x, y, x + w, y + h))
    a = np.asarray(im.getchannel("A"))
    tr = a < 128
    opaque = a >= 128
    ys, xs = np.where(opaque)
    print("=== %s ===" % name)
    print("  整体实心 bbox = (%d,%d)-(%d,%d)  尺寸 %dx%d" % (
        xs.min(), ys.min(), xs.max(), ys.max(), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1))

    # 从窗口中心泛洪，找被卡框围住的那块透明区
    H, W = tr.shape
    seen = np.zeros_like(tr, dtype=bool)
    start = (H // 3, W // 2)          # 卡图窗上部中央
    assert tr[start], "起点不在透明区"
    q = deque([start]); seen[start] = True
    while q:
        cy, cx = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < H and 0 <= nx < W and tr[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    ys, xs = np.where(seen)
    print("  卡图窗  bbox = (%d,%d)-(%d,%d)  尺寸 %dx%d" % (
        xs.min(), ys.min(), xs.max(), ys.max(), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1))
    print("  -> 宽高比 %.4f（原画 1000x760 = 1.3158）" % (
        (xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1)))
    # 窗口每行左右边界（看底部的尖角形状）
    for yy in range(ys.min(), ys.max() + 1, max(1, (ys.max() - ys.min()) // 8)):
        row = np.where(seen[yy])[0]
        if len(row):
            print("     y=%3d  x=%3d..%3d" % (yy, row.min(), row.max()))
    Image.fromarray((seen * 255).astype(np.uint8)).save(
        os.path.join(ROOT, "tools", "预览图", "winmask_%s.png" % name))
