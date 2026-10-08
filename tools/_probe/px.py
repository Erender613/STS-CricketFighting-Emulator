import numpy as np
from PIL import Image

im = Image.open(r"C:\Users\shenl\Desktop\new\tools\_probe\_s_img1.png").convert("RGB")
a = np.asarray(im).astype(int)
print("size", im.size)

# 行2（正常一刀 137°）第 4 格：单位在 (890, 520)，扇面半径 62..148、角 -1.2..1.2
def px(x, y):
    return tuple(a[y, x])

# 扇面内的点（半径 ~110，角 0）
print("fan  in   (1000, 520):", px(1000, 520))
print("fan  in   (960, 440) :", px(960, 440))
# 同样半径、但角度在扇面外（角 -2.5 → 左下方）
print("fan  out  (830, 630) :", px(830, 630))
# 远处干净背景
print("bg        (600, 690) :", px(600, 690))
