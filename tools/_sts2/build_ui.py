# -*- coding: utf-8 -*-
"""
从反编译的《杀戮尖塔 2》里提取「原版按钮」贴图，并按原版 hsv 着色器烘出各个状态。

素材出处（项目外的参考目录，不在仓库里）：
  · pck-extracted/images/ui/reward_screen/reward_item_button.png
      —— 按钮底图，无损内嵌 WebP，直接抽（910×196，青灰色圆角矩形 + 顶部亮青高光线）
  · pck-extracted/shaders/hsv.gdshader
      —— 原版用这个着色器给同一个底图调出所有按钮的明暗
  · scenes/pause_menu/pause_menu_button.tscn（NPauseMenuButton.cs）
      —— 常态 s=0.8 / v=0.9；悬停 s=1.1 / v=1.1；按下 y 下移 6px
  · MegaCrit.Sts2.Core.Helpers/StsColors.cs
      —— 文字常态 cream #FFF6E2，悬停 gold #EFC851，禁用 modulate gray(0.5)

原版所有按钮的 shader_parameter/h 都是 1.0（色相不转），只在 s/v 上分档 ——
所以这里**不另造颜色**，只烘两个明暗档。

输出：assets/ui/btn_rest.png（静置）、assets/ui/btn_bright.png（悬停 / 主按钮）
"""
import io
import os
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
NEW = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(NEW, "assets", "ui")

CTEX = (r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted\.godot\imported"
        r"\reward_item_button.png-adc233c23dd0ab43ad79b9b3840ec683.ctex")

# ---- hsv.gdshader 的数学（照抄，别自己推） ----
# YIQ = M @ rgb。着色器写的是 mat3(c0,c1,c2)（列优先），换算成行主序就是下面这个。
M = np.array([[0.2989, 0.5870, 0.1140],
              [0.5959, -0.2774, -0.3216],
              [0.2115, -0.5229, 0.3114]], dtype=np.float64)
MINV = np.linalg.inv(M)


def hsv_tint(rgb, h=1.0, s=1.0, v=1.0):
    """rgb: (...,3) float 0..1 → 同尺寸。等价于原版 shaders/hsv.gdshader。"""
    c = rgb @ M.T                                   # RGB_to_YIQ * col
    hue = (1.0 - h) * (2.0 * np.pi)
    sh, ch = np.sin(hue), np.cos(hue)
    # ⚠ 着色器里 hue_shift 是【右乘】(col.rgb *= hue_shift)，
    #   而 sat_shift 是【左乘】—— 两者在 GLSL 里对列向量/行向量的解释不同，
    #   直接照抄成 numpy 会把旋转方向搞反（红会被算成蓝）。这里按右乘展开：
    #   out_0 = Y ; out_1 = ch*I + sh*Q ; out_2 = -sh*I + ch*Q
    y, i, q = c[..., 0], c[..., 1], c[..., 2]
    c = np.stack([y, ch * i + sh * q, -sh * i + ch * q], axis=-1)
    c = c * np.array([1.0, s, s], dtype=np.float64)          # sat_shift
    c = c * v                                                # mix(vec3(0), col, v)
    return np.clip(c @ MINV.T, 0.0, 1.0)                     # inverse(RGB_to_YIQ)


def load_base():
    raw = open(CTEX, "rb").read()
    assert raw[:4] == b"GST2", "不是 GST2 的 ctex: " + CTEX
    i = raw.find(b"RIFF")
    assert i > 0, "这张 ctex 没有内嵌 WebP（可能是 GPU 压缩图，要走 Godot 解）"
    fd, tmp = tempfile.mkstemp(suffix=".webp")
    os.close(fd)
    try:
        with open(tmp, "wb") as f:
            f.write(raw[i:])
        im = Image.open(tmp)
        im.load()
        return im.convert("RGBA")
    finally:
        os.remove(tmp)


def bake(im, name, **kw):
    a = np.asarray(im, dtype=np.uint8).astype(np.float64) / 255.0
    a[..., :3] = hsv_tint(a[..., :3], **kw)
    out = Image.fromarray((a * 255.0 + 0.5).astype(np.uint8), "RGBA")
    p = os.path.join(OUT_DIR, name + ".png")
    out.save(p)
    print("  %-14s %s  %s  (%.1f KB)" % (name, im.size,
                                         " ".join("%s=%g" % kv for kv in kw.items()),
                                         os.path.getsize(p) / 1024))
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    base = load_base()
    print("底图: reward_item_button.png  %dx%d" % base.size)
    # 原版暂停菜单按钮：常态 s=0.8/v=0.9，悬停 s=1.1/v=1.1
    bake(base, "btn_rest", h=1.0, s=0.8, v=0.9)
    bake(base, "btn_bright", h=1.0, s=1.1, v=1.1)
    print("输出目录: %s" % OUT_DIR)


if __name__ == "__main__":
    main()
