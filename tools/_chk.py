from PIL import Image
p = r"C:\Users\shenl\Desktop\new\tools\预览图\君王之剑_还原对比.png"
im = Image.open(p).convert("RGB")
print(im.size, "colors:", len(im.getcolors(2000000) or []))
