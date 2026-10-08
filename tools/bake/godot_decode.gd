extends SceneTree
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
