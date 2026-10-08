# -*- coding: utf-8 -*-
"""裁局部看 1:1（Read 看图会被缩放）。用完可删。"""
import sys

from PIL import Image

src = sys.argv[1]
box = tuple(int(v) for v in sys.argv[2:6])
out = sys.argv[6]
im = Image.open(src).convert("RGBA")
print("src size", im.size)
im.crop(box).save(out)
print("saved", out, im.crop(box).size)
