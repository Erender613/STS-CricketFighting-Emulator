# -*- coding: utf-8 -*-
"""把渲染出来的手部剪影，跟"按同一套变换公式预测出来的贴图剪影"做 IoU 比对。

这是最硬的验证：如果旋转方向/锚点/缩放任一环节错了，IoU 会立刻掉下来，
而且能顺带确认"指尖朝向 +x"（预测剪影本身就是按 +x 算的）。
"""
import numpy as np
from PIL import Image

SPR = r"C:\Users\shenl\Desktop\new\assets\baked\sp_demon_hand.png"
BMP = r"C:\Users\shenl\Desktop\new\tools\_probe\_z_img1.png"

# 与 game.html 里 DH 一致
IW, IH, U0 = 184, 254, 157.0
ROT = -0.20654
TIPX, LEN = 262.6, 210.0
S = LEN / TIPX

# 样本：mkprobe.py 的 one(30,650,420,...)  → base = len - TIPX*S
BASE_X, BASE_Y, LEN_ARG = 30.0, 650.0, 420.0
k = S
base = LEN_ARG - TIPX * k

psi = ROT - np.pi / 2
cp, sp = np.cos(psi), np.sin(psi)

# --- 预测剪影 ---
sp_img = np.asarray(Image.open(SPR).convert("RGBA"))
al = sp_img[..., 3]
ys, xs = np.nonzero(al > 40)
du = xs - U0
dv = ys.astype(float)
px = base + (du * cp - dv * sp) * k + BASE_X
py = (du * sp + dv * cp) * k + BASE_Y
print("预测剪影：%d 个不透明像素" % len(px))
print("  预测 bbox x %.1f..%.1f  y %.1f..%.1f" % (px.min(), px.max(), py.min(), py.max()))

# --- 实测掩码 ---
a = np.asarray(Image.open(BMP).convert("RGB")).astype(np.int16)
BG = np.array([0x15, 0x11, 0x24], dtype=np.int16)
dev = np.abs(a - BG).sum(axis=2)
obs = dev > 10

X0, X1 = 246, 480          # 避开手臂（手臂到 x=240）与洞口
Y0, Y1 = 585, 755
w, h = X1 - X0, Y1 - Y0
print("\n比对窗口 x %d..%d  y %d..%d  (%dx%d)" % (X0, X1, Y0, Y1, w, h))

pred = np.zeros((h, w), bool)
for x, y in zip(px, py):
    ix, iy = int(round(x)) - X0, int(round(y)) - Y0
    if 0 <= ix < w and 0 <= iy < h:
        pred[iy, ix] = True
# 预测掩码膨胀 1px，抵掉抗锯齿边缘
pad = pred.copy()
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        pad |= np.roll(np.roll(pred, dy, 0), dx, 1)
pred = pad

o = obs[Y0:Y1, X0:X1]
inter = int((pred & o).sum())
union = int((pred | o).sum())
print("\n预测 %d  实测 %d  交集 %d  并集 %d" % (int(pred.sum()), int(o.sum()), inter, union))
print("IoU = %.3f" % (inter / max(1, union)))
print("覆盖率（预测被实测覆盖的比例）= %.3f" % (inter / max(1, int(pred.sum()))))
print("精确率（实测里落在预测内的比例）= %.3f" % (inter / max(1, int(o.sum()))))

# 实测手部的 bbox 与均值色
ys2, xs2 = np.nonzero(o)
print("\n实测手部 bbox: x %d..%d (宽 %d)  y %d..%d (高 %d)"
      % (X0 + xs2.min(), X0 + xs2.max(), xs2.max() - xs2.min() + 1,
         Y0 + ys2.min(), Y0 + ys2.max(), ys2.max() - ys2.min() + 1))
px2 = a[Y0:Y1, X0:X1][o]
print("实测手部均值 RGB = (%d, %d, %d)  最亮 = %s" % (px2[:, 0].mean(), px2[:, 1].mean(),
                                                    px2[:, 2].mean(), px2.max(axis=0)))
print("底色 RGB = (21,17,36)  → 手在底色上的增量约 (%d,%d,%d)"
      % (px2[:, 0].mean() - 21, px2[:, 1].mean() - 17, px2[:, 2].mean() - 36))
