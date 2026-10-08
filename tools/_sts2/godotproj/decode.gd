extends SceneTree

# 把 res://vram/*.ctex 解成 res://out/*.png
# 跑法： godot --headless --path <本目录> --script decode.gd
func _init():
	var d := DirAccess.open("res://vram")
	if d == null:
		push_error("no res://vram")
		quit(1)
		return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://out"))
	for f in d.get_files():
		if not f.ends_with(".ctex"):
			continue
		var t = load("res://vram/" + f)
		if t == null:
			print("[fail] load ", f)
			continue
		var img: Image = t.get_image()
		if img == null:
			print("[fail] get_image ", f)
			continue
		if img.is_compressed():
			img.decompress()
		var out := "res://out/" + f.get_basename() + ".png"
		var err = img.save_png(out)
		print("[ok] ", f, "  ", img.get_width(), "x", img.get_height(),
			" fmt=", img.get_format(), " err=", err)
	quit(0)
