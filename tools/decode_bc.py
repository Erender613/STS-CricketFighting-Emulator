"""
Godot .ctex 解码（BC/bptc 压缩贴图）
有些贴图（如 ui_atlas）是 GPU 压缩格式，没有内嵌 WebP，必须用 Godot 解开。
做法：把目标 .ctex 复制进一个临时 Godot 工程，用 load()+Image.decompress() 存成 PNG。
需要本机有 Godot 4.x 可执行文件（脚本会自动在常见位置找）。
用法: python tools/decode_bc.py
"""
import os
import re
import shutil
import subprocess
import sys

STS = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted"
ROOT = r"C:\Users\shenl\Desktop\new"
BAKE = os.path.join(ROOT, "tools", "bake")
VRAM = os.path.join(BAKE, "vram")
OUT = os.path.join(BAKE, "out")

# 需要 BC 解码的贴图（源资源路径，可省扩展名）
WANT = [
    "images/atlases/ui_atlas_0",
    "images/atlases/ui_atlas_1",
]
# Godot 常见位置
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
    for f in os.listdir(VRAM):
        os.remove(os.path.join(VRAM, f))

    n = 0
    for rel in WANT:
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
    ok = os.path.isfile(os.path.join(OUT, "ui_atlas_0.png-6893c117f9abf21d272811d76e4693a4.bptc.png"))
    made = os.listdir(OUT)
    print("\n输出 %d 个 PNG 到 %s: %s" % (len(made), OUT, ", ".join(made)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
