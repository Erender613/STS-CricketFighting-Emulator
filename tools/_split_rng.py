# -*- coding: utf-8 -*-
"""一次性重构：把"纯观感"的 rand() 调用点换成 vrand()（观感随机流）。

对战随机流（rand）只保留真正影响输赢的调用点：
  初速方向、各机制的间隔/相位/落点、撞墙卡死的偏转角。
其余（粒子、飘字抖动、音高微扰、特效参数）全部走 vrand，渲染时机不再影响对战。

本脚本按下表的行号 + 出现次数逐个替换（"rand(" → "vrand("），
若某行对不上就整批中止、不写盘 —— 避免静默改错。

用法: python tools/_split_rng.py            # 预演
      python tools/_split_rng.py --apply    # 落盘
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "game.html")

# 行号 -> 该行要替换的 rand( 个数
SITES = {
    869: 1, 914: 1, 921: 1, 936: 1, 977: 1,             # 音效音高微扰
    1296: 1, 1297: 1, 1298: 1, 1299: 1, 1301: 1,        # SbMote 光尘
    1328: 1, 1329: 1, 1333: 1,                          # 光尘落点
    1413: 1, 1427: 1, 1492: 1, 1516: 1, 1519: 1,        # 音效 / 飘字抖动
    1606: 1,                                            # 尘埃粒子
    1704: 2,                                            # Zap 折线抖动
    1770: 1, 1784: 1, 1934: 1,                          # 音效
    2299: 2,                                            # 星屑粒子
    2672: 2, 2673: 2,                                   # 暗黑球拖尾粒子
    2730: 1, 2736: 1,                                   # 音效
    2869: 1, 2896: 2, 2897: 2, 2898: 1,                 # 星屑自转 / 粒子
    3149: 1, 3189: 1, 3232: 1,                          # 音效
    3716: 2, 3717: 1, 3718: 1, 3719: 2, 3721: 2, 3725: 1,  # WristMote 粒子
    3771: 1, 3772: 1, 3775: 1, 3776: 1, 3777: 1,        # 腕口粒子
}
# 明确【保留】为对战随机的调用点（脚本会校验它们没被误改）
KEEP = (532, 1682, 1942, 2353, 2505, 2515, 2518, 2545, 2618, 2619, 2620,
        2622, 2713, 2950, 2957, 2960, 3062, 3141)


def main():
    apply = "--apply" in sys.argv
    with io.open(SRC, "r", encoding="utf-8") as f:
        lines = f.readlines()

    bad, n = [], 0
    for ln, cnt in sorted(SITES.items()):
        i = ln - 1
        s = lines[i]
        out = s
        for _ in range(cnt):
            k = out.find("rand(")
            while k > 0 and out[k - 1].isalnum():       # 跳过 vrand( / srand( 之类
                k = out.find("rand(", k + 1)
            if k < 0:
                bad.append((ln, "还差 %d 个 rand( 没找到" % cnt))
                break
            out = out[:k] + "v" + out[k:]
            n += 1
        lines[i] = out

    for ln in KEEP:                                     # 抽查保留点仍然存在
        if "rand(" not in lines[ln - 1]:
            bad.append((ln, "本应保留 rand( 却找不到"))

    if bad:
        for ln, why in bad:
            print("!! 行 %d: %s" % (ln, why))
        print("中止，未写盘")
        return 1

    print("替换 %d 处；保留 %d 处对战随机" % (n, len(KEEP)))
    if apply:
        with io.open(SRC, "w", encoding="utf-8", newline="") as f:
            f.writelines(lines)
        print("已写回", SRC)
    else:
        print("（预演，未落盘；加 --apply 生效）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
