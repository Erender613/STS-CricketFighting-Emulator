"""
STS2 素材烘焙（阶段 2）
1) 复刻官方 hsv.gdshader 的 YIQ 色相旋转数学，给卡框/横幅上色（不手绘）。
2) 合成卡牌单位 = 真卡框（上色） + 真卡面（填进透明画窗）。
3) 精灵裁剪留白。
输出到 assets/baked/
"""
import os
import json
from glob import glob

import numpy as np
from PIL import Image

ROOT = r"C:\Users\shenl\Desktop\new"
SRC = os.path.join(ROOT, "assets", "src")
ATLAS = os.path.join(ROOT, "tools", "bake", "out")
OUT = os.path.join(ROOT, "assets", "baked")
os.makedirs(OUT, exist_ok=True)

# ---- 官方 hsv.gdshader 的精确复刻 ----
M_YIQ = np.array([
    [0.2989, 0.5870, 0.1140],
    [0.5959, -0.2774, -0.3216],
    [0.2115, -0.5229, 0.3114],
], dtype=np.float64)
M_YIQ_INV = np.linalg.inv(M_YIQ)


def hsv_tint(img: Image.Image, h: float, s: float, v: float) -> Image.Image:
    """完全按 hsv.gdshader 的算法给整张图上色。"""
    a = np.asarray(img.convert("RGBA"), dtype=np.float64) / 255.0
    rgb = a[..., :3]
    alpha = a[..., 3:]
    yiq = rgb @ M_YIQ.T                      # 正变换
    hue = (1.0 - h) * 2.0 * np.pi
    sh, ch = np.sin(hue), np.cos(hue)
    # 与 hsv.gdshader 中 mat3(vec3(1,0,0), vec3(0,c,-s), vec3(0,s,c)) 的列向量语义一致
    rot = np.array([[1.0, 0.0, 0.0],
                    [0.0, ch, -sh],
                    [0.0, sh, ch]])
    yiq = yiq @ rot.T
    yiq = yiq @ np.diag([1.0, s, s])
    yiq = yiq * v
    out = yiq @ M_YIQ_INV.T
    out = np.clip(out, 0.0, 1.0)
    res = np.concatenate([out, alpha], axis=-1)
    return Image.fromarray((res * 255.0 + 0.5).astype(np.uint8), "RGBA")


# ---- 从图集取切片 ----
ATLAS_REGION = {
    "frame_attack": ("0", (1320, 83, 598, 844)),
    "frame_skill": ("0", (1221, 929, 598, 844)),
    "frame_power": ("0", (621, 929, 598, 844)),
    "banner": ("1", (674, 1, 653, 145)),
    "plaque": ("0", (197, 1948, 123, 75)),
}
ART_WINDOW = (48, 85, 499, 378)      # 卡框中部透明画窗


def atlas_img(n):
    return Image.open(sorted(glob(os.path.join(ATLAS, "ui_atlas_" + n + "*")))[0]).convert("RGBA")


def slice_atlas(key):
    n, (x, y, w, h) = ATLAS_REGION[key]
    return atlas_img(n).crop((x, y, x + w, y + h))


# ---- 五张卡的配置 ----
FRAME_MAT = {
    "red":    (0.025, 0.85, 1.0),
    "green":  (0.320, 0.45, 1.2),
    "orange": (0.120, 1.50, 1.2),
    "pink":   (0.965, 0.55, 1.2),
    "blue":   (0.550, 0.90, 1.0),
}
BANNER_RARE = (0.563, 1.198, 1.14)

CARDS = [
    ("dark_embrace",    "art_dark_embrace",    "frame_power", "red"),
    ("knife_trap",      "art_knife_trap",      "frame_skill", "green"),
    ("beat_into_shape", "art_beat_into_shape", "frame_attack", "orange"),
    ("end_of_days",     "art_end_of_days",     "frame_skill", "pink"),
    ("voltaic",         "art_voltaic",         "frame_skill", "blue"),
]


def cover_resize(im, w, h):
    """按 cover 语义缩放：铺满 w×h，超出部分居中裁掉。"""
    sw, sh = im.size
    k = max(w / sw, h / sh)
    nw, nh = max(1, round(sw * k)), max(1, round(sh * k))
    im = im.resize((nw, nh), Image.LANCZOS)
    l = (nw - w) // 2
    t = (nh - h) // 2
    return im.crop((l, t, l + w, t + h))


def bake_card(cid, art_name, frame_key, color):
    frame = hsv_tint(slice_atlas(frame_key), *FRAME_MAT[color])
    art = Image.open(os.path.join(SRC, art_name + ".png")).convert("RGBA")
    card = Image.new("RGBA", (598, 844), (0, 0, 0, 0))
    wx, wy, ww, wh = ART_WINDOW
    card.paste(cover_resize(art, ww, wh), (wx, wy))
    card.alpha_composite(frame)
    return card


if __name__ == "__main__":
    manifest = {"cards": {}, "frames": {}}

    # 1) 卡框上色（五色 × 三型，供卡面/调试用）
    for fkey in ("frame_attack", "frame_skill", "frame_power"):
        base = slice_atlas(fkey)
        for cname, params in FRAME_MAT.items():
            im = hsv_tint(base, *params)
            p = os.path.join(OUT, f"{fkey}_{cname}.png")
            im.save(p)
            manifest["frames"][f"{fkey}_{cname}"] = os.path.basename(p)
    print("卡框上色:", len(manifest["frames"]))

    # 2) 稀有横幅
    banner = hsv_tint(slice_atlas("banner"), *BANNER_RARE)
    banner.save(os.path.join(OUT, "banner_rare.png"))
    print("稀有横幅 OK")

    # 3) 合成五张卡
    for cid, art, fkey, color in CARDS:
        card = bake_card(cid, art, fkey, color)
        card.save(os.path.join(OUT, f"card_{cid}.png"))
        thumb = card.resize((300, 423), Image.LANCZOS)
        thumb.save(os.path.join(OUT, f"card_{cid}_300.png"))
        manifest["cards"][cid] = f"card_{cid}_300.png"
        print(f"卡牌 {cid:16s} <- {fkey}+{color}")

    # 4) 精灵裁剪（去透明留白）
    #    【例外】君王之剑各部件靠 sovereign_blade.tscn 里的 TextureRect/Sprite2D
    #    矩形精确对位（贴图整幅映射到场景矩形），裁掉留白会让位置全错 —— 原样输出。
    NO_CROP = {
        "sp_sb_blade", "sp_sb_glow", "sp_sb_shine", "sp_sb_outline",
        "sp_sb_deco", "sp_sb_hilt", "sp_sb_hilt2", "sp_sb_spike",
    }
    for f in sorted(glob(os.path.join(SRC, "sp_*.png"))):
        name = os.path.splitext(os.path.basename(f))[0]
        im = Image.open(f).convert("RGBA")
        if name not in NO_CROP:
            bb = im.getbbox()
            if bb:
                im = im.crop(bb)
        im.save(os.path.join(OUT, name + ".png"))
    print("精灵处理完成")

    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    print("manifest 写出")
