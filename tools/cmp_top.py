"""生成 1:1 的上半部对比图（左官方 / 右我方），便于逐像素看缎带与卡图内框。"""
import os
import sys

from PIL import Image

ROOT = r"C:\Users\shenl\Desktop\new"
PREVIEW = os.path.join(ROOT, "tools", "预览图")
OUT = os.path.join(ROOT, "assets", "baked")
SHOT = r"C:\Users\shenl\Pictures\Screenshots\屏幕截图 2026-07-22 201251.png"
REF_BOX = (5, 30, 320, 475)
W, H = 598, 844

mine_id = sys.argv[1] if len(sys.argv) > 1 else "end_of_days"
y1 = int(sys.argv[2]) if len(sys.argv) > 2 else 470

ref = Image.open(SHOT).convert("RGBA").crop(REF_BOX).resize((W, H), Image.LANCZOS)
mine = Image.open(os.path.join(OUT, "card_%s.png" % mine_id)).convert("RGBA")

cv = Image.new("RGBA", (W * 2 + 12, y1), (255, 0, 255, 255))
cv.alpha_composite(ref.crop((0, 0, W, y1)), (0, 0))
cv.alpha_composite(mine.crop((0, 0, W, y1)), (W + 12, 0))
dst = os.path.join(PREVIEW, "compare_top_%s.png" % mine_id)
cv.save(dst)
print(dst, cv.size)
