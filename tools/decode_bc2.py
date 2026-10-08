# -*- coding: utf-8 -*-
"""
第二批 BC 压缩贴图解码（10 张新卡的机制贴图）。
S3TC/bptc 格式的 .ctex 没有内嵌 WebP，必须用 Godot headless 解。
做法与 decode_bc.py 相同：复制进临时 Godot 工程 -> load()+decompress() -> PNG。
输出直接落 assets/src/，并改成游戏用的短名。
用法: python tools/decode_bc2.py
"""
import os
import re
import shutil
import subprocess

STS = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted"
ROOT = r"C:\Users\shenl\Desktop\new"
BAKE = os.path.join(ROOT, "tools", "bake")
VRAM = os.path.join(BAKE, "vram")
OUT = os.path.join(BAKE, "out")
SRC = os.path.join(ROOT, "assets", "src")

# (源资源路径, 输出文件名)
WANT = [
    ("images/powers/vulnerable_power",                 "pw_vulnerable"),
    ("images/powers/weak_power",                       "pw_weak"),
    ("images/powers/doom_power",                       "pw_doom"),
    ("images/powers/focus_power",                      "pw_focus"),
    ("images/powers/poison_power",                     "pw_poison"),
    ("images/vfx/hyperbeam/hyperbeam_laser_line",      "sp_beam_line"),
    ("images/vfx/hyperbeam/hyperbeam_laser_overlay",   "sp_beam_overlay"),
]
GODOT_CANDIDATES = [
    r"C:\Users\shenl\Desktop\Godot4.7.1\Godot_v4.7.1-stable_win64_console.exe",
    r"C:\Users\shenl\Desktop\Godot4.6.2\Godot_v4.6.2-stable_win64_console.exe",
    r"C:\Program Files\Godot\Godot_v4.7.1-stable_win64_console.exe",
]
REMAP_RE = re.compile(r'^path(?:\.\w+)?="res://([^"]+)"', re.M)

GD = '''extends SceneTree
func _init():
	var d := DirAccess.open("res://vram")
	if d == null:
		print("ERR no vram"); quit(1); return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://out"))
	var n := 0
	for f in d.get_files():
		if not f.ends_with(".ctex"): continue
		var t = load("res://vram/" + f)
		if t == null: print("FAIL load ", f); continue
		var img: Image = t.get_image()
		if img == null: print("FAIL image ", f); continue
		if img.is_compressed(): img.decompress()
		var err := img.save_png("res://out/" + f.get_basename() + ".png")
		print(("OK  " if err == OK else "ERR ") + f + "  " + str(img.get_width()) + "x" + str(img.get_height()))
		n += 1
	print("decoded ", n)
	quit(0)
'''


def resolve_ctex(src_rel):
    base = os.path.join(STS, src_rel.replace("/", os.sep))
    imp = base + ".import"
    if not os.path.isfile(imp):
        for ext in (".png", ".tres"):
            if os.path.isfile(base + ext + ".import"):
                imp = base + ext + ".import"
                break
    if not os.path.isfile(imp):
        return []
    txt = open(imp, "r", encoding="utf-8").read()
    return [os.path.join(STS, m.group(1).replace("/", os.sep)) for m in REMAP_RE.finditer(txt)]


def find_godot():
    for c in GODOT_CANDIDATES:
        if os.path.isfile(c):
            return c
    return None


def main():
    gd = find_godot()
    if not gd:
        print("!! 没找到 Godot 可执行文件，请把路径加进 GODOT_CANDIDATES")
        return 1
    os.makedirs(VRAM, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SRC, exist_ok=True)
    for f in os.listdir(VRAM):
        os.remove(os.path.join(VRAM, f))
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))

    n = 0
    for rel, _ in WANT:
        for c in resolve_ctex(rel):
            if os.path.isfile(c):
                shutil.copy2(c, os.path.join(VRAM, os.path.basename(c)))
                print("  准备:", os.path.basename(c))
                n += 1
    if not n:
        print("!! 没有可复制的 .ctex")
        return 1

    with open(os.path.join(BAKE, "godot_decode.gd"), "w", encoding="utf-8", newline="\n") as f:
        f.write(GD)
    if not os.path.isfile(os.path.join(BAKE, "project.godot")):
        with open(os.path.join(BAKE, "project.godot"), "w", encoding="utf-8", newline="\n") as f:
            f.write('config_version=5\n\n[application]\nconfig/name="bake"\n')

    r = subprocess.run([gd, "--headless", "--path", BAKE, "--script", "godot_decode.gd"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    for line in (r.stdout or "").splitlines():
        if line.strip():
            print("  " + line)

    # 解出来的文件名是 "<源名>.png-<hash>.png"，按 WANT 顺序改短名搬进 assets/src
    made = os.listdir(OUT)
    ok = 0
    for rel, name in WANT:
        base = os.path.basename(rel)
        hit = [f for f in made if f.startswith(base)]
        if not hit:
            print("!! 没解出", base)
            continue
        src = os.path.join(OUT, hit[0])
        dst = os.path.join(SRC, name + ".png")
        shutil.copy2(src, dst)
        print("[OK] %-18s <- %s" % (name, hit[0]))
        ok += 1
    print("\n完成 %d/%d" % (ok, len(WANT)))
    return 0 if ok == len(WANT) else 1


if __name__ == "__main__":
    raise SystemExit(main())
