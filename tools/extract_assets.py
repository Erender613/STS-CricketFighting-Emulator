"""
STS2 素材提取流水线（阶段 1：源图抽取）
把 pck-extracted 里的 .ctex 内嵌无损 WebP 抽出来，得到真 PNG。
映射关系从各 *.png.import 文件里读取（权威来源，不靠猜 hash）。
"""
import os
import re
import tempfile

from PIL import Image

STS = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted"
OUT = r"C:\Users\shenl\Desktop\new\assets\src"
os.makedirs(OUT, exist_ok=True)

REMAP_RE = re.compile(r'^path(?:\.\w+)?="res://([^"]+)"', re.M)
EXTS = [".png", ".tres", ".tga", ".webp", ".jpg", ".exr"]


def resolve_ctex(src_rel):
    """从源资源名（可省扩展名）找到 .import，解析出 .ctex 绝对路径列表。"""
    base = os.path.join(STS, src_rel.replace("/", os.sep))
    cand = [base + ".import", base]
    for ext in EXTS:
        cand.append(base + ext + ".import")
    imp = None
    for c in cand:
        if os.path.isfile(c) and c.endswith(".import"):
            imp = c
            break
    if not imp:
        return []
    txt = open(imp, "r", encoding="utf-8").read()
    return [os.path.join(STS, m.group(1).replace("/", os.sep))
            for m in REMAP_RE.finditer(txt)]


def probe_image(ctex_path):
    """尝试从 .ctex 容器抽出内嵌图像（WebP 等）。返回 PIL.Image 或 None。"""
    raw = open(ctex_path, "rb").read()
    if raw[:4] != b"GST2":
        return None
    idx = raw.find(b"RIFF")
    if idx < 0:
        return None
    fd, tmp = tempfile.mkstemp(suffix=".webp")
    os.close(fd)
    try:
        with open(tmp, "wb") as f:
            f.write(raw[idx:])
        im = Image.open(tmp)
        im.load()
        im = im.convert("RGBA")
        return im
    except Exception:
        return None
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def fetch(src_rel, dst_name, largest=True):
    ctexs = resolve_ctex(src_rel)
    if not ctexs:
        print(f"[MISS import] {src_rel}  (在 {STS} 下找不到 .import 或源文件)")
        return None
    found = []
    for c in ctexs:
        if not os.path.isfile(c):
            continue
        im = probe_image(c)
        if im:
            found.append((im.size[0] * im.size[1], im, os.path.basename(c)))
    if not found:
        print(f"[FAIL decode] {src_rel}  -> {[os.path.basename(c) for c in ctexs]}")
        return None
    found.sort(key=lambda r: r[0], reverse=largest)
    _, im, name = found[0]
    dst = os.path.join(OUT, dst_name + ".png")
    im.save(dst, "PNG")
    print(f"[OK] {dst_name:26s} {im.size[0]:5d}x{im.size[1]:<5d} <- {name}")
    return im


JOBS = [
    ("images/packed/card_portraits/ironclad/dark_embrace", "art_dark_embrace"),
    ("images/packed/card_portraits/silent/knife_trap", "art_knife_trap"),
    ("images/packed/card_portraits/regent/beat_into_shape", "art_beat_into_shape"),
    ("images/packed/card_portraits/necrobinder/end_of_days", "art_end_of_days"),
    ("images/packed/card_portraits/defect/voltaic", "art_voltaic"),
    ("images/vfx/vfx_dagger_throw/knife", "sp_knife_thrown"),
    ("images/vfx/vfx_dagger_spray/knife", "sp_knife_spray"),
    ("images/vfx/vfx_shiv/shiv_simple", "sp_shiv"),
    ("images/vfx/sovereign_blade/sovereign_blade_blade", "sp_sb_blade"),
    ("images/vfx/sovereign_blade/sovereign_blade_blade_glow", "sp_sb_glow"),
    ("images/vfx/sovereign_blade/sovereign_blade_hilt", "sp_sb_hilt"),
    ("images/vfx/sovereign_blade/sovereign_blade_spike", "sp_sb_spike"),
    ("images/vfx/sovereign_blade/sovereign_blade_star_center", "sp_sb_star"),
    ("images/vfx/sovereign_blade/sovereign_blade_trail", "sp_sb_trail"),
    ("images/vfx/sovereign_blade/sovereign_blade_decoration", "sp_sb_deco"),
    ("images/orbs/lightning_orb", "sp_lightning_orb"),
    ("images/vfx/vfx_doom/doom_hole_bottom", "sp_doom_hole"),
    ("images/vfx/vfx_doom/doom_glow", "sp_doom_glow"),
    ("images/vfx/vfx_doom/doom_flame", "sp_doom_flame"),
    # 通用特效
    ("images/vfx/common/common_glow", "sp_glow"),
    ("images/vfx/common/common_circle", "sp_circle"),
    ("images/vfx/common/common_ray", "sp_ray"),
    ("images/vfx/common/common_blunt_impact_core", "sp_impact"),
    ("images/vfx/common/common_outward_streaks", "sp_streaks"),
    ("images/vfx/slash/slash_quick_flat", "sp_slash"),
    ("images/vfx/dagger/dagger_spray_single", "sp_dagger"),
    ("images/vfx/orbs/lightning_orb_particle", "sp_lightning_particle"),
    ("images/vfx/lightning/lightning_flipbook_1", "sp_lightning_bolt"),
    ("images/vfx/vfx_doom/doom_spear_particle", "sp_doom_spear"),
]

if __name__ == "__main__":
    ok = sum(1 for rel, name in JOBS if fetch(rel, name))
    print(f"\n完成 {ok}/{len(JOBS)}")
