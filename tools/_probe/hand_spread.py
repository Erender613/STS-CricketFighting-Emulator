# -*- coding: utf-8 -*-
"""恶魔之手「张开时手指外撇角」的解析核算。

按 drawDemonHand / drawDemonFinger 的公式算，不是量图：
  指尖角 = 基础角 × splay + curl × 1.62
  （curl 的分段累加 = curl*(0.30+0.54+0.78) = curl*1.62）

注：曾试图直接在探针截图里量「指尖区纵向跨度」，但手是暗紫、画布是暗底，
    对比度低于阈值 -> 量出来的是噪声，不可用。故这里只保留解析核算。
"""
import numpy as np

# (标签, 最外指基础角, splay, curlAmt)   —— openK=1 / grip=0.15 的张开态
CASES = [
    ("原设计", 0.26, 0.34 + 0.66 * 1.00, 0.28 + 0.15 * 1.00),
    ("现设计", 0.18, 0.30 + 0.56 * 1.00, 0.21 + 0.15 * 1.07),
]


def tip(base_a, splay, curl):
    return base_a * splay + curl * 1.62


def main():
    print("张开态（openK=1, grip=0.15）最外指的指尖外撇角：")
    vals = []
    for tag, ba, sp, ca in CASES:
        t = tip(ba, sp, ca)
        vals.append(t)
        print("  %s  基础角%.2f×splay%.2f + curl%.3f×1.62 = %.3f rad = %.1f°"
              % (tag, ba, sp, ca, t, np.degrees(t)))
    d = vals[0] - vals[1]
    print("  → 单侧收拢 %.1f°；外侧两指夹角 %.1f° → %.1f°（合计窄 %.1f°）"
          % (np.degrees(d), np.degrees(2 * vals[0]), np.degrees(2 * vals[1]), np.degrees(2 * d)))
    print()
    print("抓握态（grip=1）合计弯曲：原 %.2f / 现 %.2f  —— 保持不变，攥爪样子不受影响。"
          % (0.28 + 1.00, 0.21 + 1.07))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
