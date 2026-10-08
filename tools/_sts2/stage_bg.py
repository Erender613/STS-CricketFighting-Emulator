"""从 STS2 的 .import 里找出各章节战斗背景底图（_00 层）的 .ctex，拷进临时 Godot 工程待解。

产出：tools/_sts2/godotproj/vram/*.ctex
"""
import os
import re
import shutil

ROOT = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted"
HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.join(HERE, "godotproj")
AREAS = ["overgrowth", "underdocks", "hive", "glory"]

os.makedirs(os.path.join(PROJ, "vram"), exist_ok=True)
open(os.path.join(PROJ, "project.godot"), "w", encoding="utf-8").write(
    'config_version=5\n\n[application]\n\nconfig/name="ctex_decode"\n')

pat = re.compile(rb'path(?:\.\w+)?="res://([^"]+)"')
for a in AREAS:
    imp = os.path.join(ROOT, "images", "rooms", a, a + "_00.png.import")
    paths = pat.findall(open(imp, "rb").read())
    rel = [p.decode() for p in paths]
    bptc = [p for p in rel if "bptc" in p or "s3tc" in p] or rel
    if not bptc:
        print("[miss]", a, rel)
        continue
    src = os.path.join(ROOT, *bptc[0].split("/"))
    dst = os.path.join(PROJ, "vram", a + ".ctex")
    shutil.copyfile(src, dst)
    print("%-12s %-70s -> %s (%.1f MB)" % (a, bptc[0], os.path.basename(dst),
                                           os.path.getsize(dst) / 1e6))
