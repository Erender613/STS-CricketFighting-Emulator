# -*- coding: utf-8 -*-
"""算出把 spooky_hand.png 摆进游戏所需的精确几何参数。

做法：先求「前臂轴线」——在 v=0（贴图顶端断面）处量出前臂的中心 u0；
再求前臂的自然倾斜角 ROT（v=0 与 v=105 两处中心连线相对 +v 的夹角）；
把贴图绕「断面中心」旋转 -ROT 后，前臂就落在水平轴线上，可直接接一条直手臂。

输出：
  U0    断面处的 u 中心
  ROT   需要补的旋转（弧度）
  TIPX  旋转后，「沿轴线最远的实心像素」距断面的距离（贴图单位）
  RW    断面处前臂的 y 半宽（贴图单位）——决定手臂画多粗
"""
import numpy as np
from PIL import Image

p = r"C:\Users\shenl\Desktop\new\assets\src\sp_demon_hand.png"
im = Image.open(p).convert("RGBA")
im = im.crop(im.getbbox())
a = np.asarray(im)
h, w = a.shape[:2]
mask = a[..., 3] > 40
print("贴图 %dx%d" % (w, h))


def center_at(v, band=3):
    rows = mask[v:v + band]
    cols = np.nonzero(rows.any(axis=0))[0]
    return (cols[0] + cols[-1]) / 2.0 if len(cols) else None


c0 = center_at(0)
c1 = center_at(105)
print("v=0   前臂中心 u = %.1f" % c0)
print("v=105 前臂中心 u = %.1f" % c1)

du, dv = c1 - c0, 105.0
ROT = np.arctan2(du, dv)          # 前臂相对 +v 的倾角
print("前臂倾角 = %.2f°  (需要把贴图转 -%.4f rad)" % (np.degrees(ROT), ROT))

# 绕断面中心 (U0, 0) 施加的最终映射：canvas = R(psi)·(du,dv)，psi = ROT - pi/2
# （等价于 canvas 里 ctx.rotate(-PI/2); ctx.rotate(ROT)）
U0 = c0
psi = ROT - np.pi / 2
ys, xs = np.nonzero(mask)
ddu = xs - U0
ddv = ys.astype(float)

rx = ddu * np.cos(psi) - ddv * np.sin(psi)
ry = ddu * np.sin(psi) + ddv * np.cos(psi)
print("\n代入 psi = %.4f rad（= ROT - 90°）后：" % psi)
print("  沿轴最远实心像素 TIPX = %.1f（贴图单位）" % rx.max())
print("  轴向起点（应为 ≈0）    = %.1f" % rx.min())
print("  断面处 y 半宽 RW      = %.1f" % (np.abs(ry[ddv < 3]).max()))
print("  整体 y 范围           = %.1f .. %.1f" % (ry.min(), ry.max()))

# 掌心与指尖的落点（用于校验抓取点）
for name, (uu, vv) in {"掌心": (107, 145), "指尖束中心": (92, 250)}.items():
    dx, dy = uu - U0, vv
    print("  %s 旋转后 = (%.1f, %.1f)" % (name, dx * np.cos(psi) - dy * np.sin(psi), dx * np.sin(psi) + dy * np.cos(psi)))

print("\n=== 直接可用的常数 ===")
print("U0   = %.1f" % U0)
print("ROT  = %.5f   (rad)  → canvas 里 ctx.rotate(-PI/2) 之后再 ctx.rotate(ROT)" % ROT)
print("TIPX = %.1f  （沿轴最远实心像素，贴图单位）" % rx.max())
print("X0   = %.1f  （轴向最近实心像素）" % rx.min())
print("YLO/YHI = %.1f / %.1f" % (ry.min(), ry.max()))
base_rows = ry[ddv < 3]
print("断面处 y 范围 = %.1f .. %.1f  (半宽 %.1f，中心 %.1f)"
      % (base_rows.min(), base_rows.max(), (base_rows.max() - base_rows.min()) / 2,
         (base_rows.max() + base_rows.min()) / 2))
for S in (0.70, 0.78, 0.86, 0.94):
    print("  缩放 S=%.2f -> 手长 %.0f px，手横向 %.0f px，接手臂处半宽 %.0f px"
          % (S, rx.max() * S, (ry.max() - ry.min()) * S, (base_rows.max() - base_rows.min()) / 2 * S))
