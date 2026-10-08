from PIL import Image
for p in [r"C:\Users\shenl\Desktop\new\tools\预览图\sheet_cards_v2.png",
          r"C:\Users\shenl\Desktop\new\tools\_probe\arena_zoom.png",
          r"C:\Users\shenl\Desktop\new\tools\_probe\arena_hand.png"]:
    try:
        im = Image.open(p).convert("RGB")
        print("%-46s %s  colors=%d" % (p.split("\\")[-1], im.size, len(im.getcolors(3000000) or [])))
    except Exception as e:
        print(p, "ERR", e)
