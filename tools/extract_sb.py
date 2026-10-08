"""
补充提取「君王之剑」剩余部件（原版共 12 件，之前只提了 7 件）。
复用 extract_assets.py 的 .import -> .ctex -> 内嵌 WebP 逻辑。
"""
import os
import re
import sys
import tempfile

from PIL import Image

STS = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted"
OUT = r"C:\Users\shenl\Desktop\new\assets\src"
os.makedirs(OUT, exist_ok=True)

REMAP_RE = re.compile(r'^path(?:\.\w+)?="res://([^"]+)"', re.M)
EXTS = [".png", ".tres", ".tga", ".webp", ".jpg", ".exr"]


def resolve_ctex(src_rel):
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
        return im.convert("RGBA")
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
        print(f"[MISS import] {src_rel}")
        return None
    found = []
    for c in ctexs:
        if not os.path.isfile(c):
            continue
        im = probe_image(c)
        if im:
            found.append((im.size[0] * im.size[1], im, os.path.basename(c)))
    if not found:
        print(f"[FAIL decode] {src_rel}")
        return None
    found.sort(key=lambda r: r[0], reverse=largest)
    _, im, name = found[0]
    im.save(os.path.join(OUT, dst_name + ".png"), "PNG")
    print(f"[OK] {dst_name:26s} {im.size[0]:5d}x{im.size[1]:<5d} <- {name}")
    return im


JOBS = [
    ("images/vfx/sovereign_blade/sovereign_blade_blade_shine", "sp_sb_shine"),
    ("images/vfx/sovereign_blade/sovereign_blade_hilt_2", "sp_sb_hilt2"),
    ("images/vfx/sovereign_blade/sovereign_blade_spike_2", "sp_sb_spike2"),
    ("images/vfx/sovereign_blade/sovereign_blade_star_center2", "sp_sb_star2"),
    ("images/vfx/sovereign_blade/sovereign_blade_outline_mask", "sp_sb_outline"),
]

if __name__ == "__main__":
    ok = sum(1 for rel, name in JOBS if fetch(rel, name))
    print(f"\n完成 {ok}/{len(JOBS)}")
