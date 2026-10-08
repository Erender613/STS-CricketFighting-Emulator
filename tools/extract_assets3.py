# -*- coding: utf-8 -*-
"""
第三批素材提取（5 张测试版新卡）：复用 extract_assets.py 的 .ctex -> PNG 流水线。

新增 5 张卡（祭品/余像/追踪之刃/灵魂风暴/陨石打击）用到的：
  卡面原画  -> assets/src/art_*.png（供 bake_card2.py 烘卡面用）
  机制贴图  -> assets/src/sp_*.png / pw_*.png（供 build.py 打包 + 游戏绘制用）

用法: python tools/extract_assets3.py
"""
import os
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)

# extract_assets.py import 时不会跑抽取（逻辑在 fetch()/JOBS 里，main 只在 __main__ 执行）
from extract_assets import fetch, OUT  # noqa: E402

JOBS = [
    # ---- 5 张新卡的卡面原画（官方卡图，直接烘进卡框） ----
    ("images/packed/card_portraits/ironclad/offering",      "art_offering"),      # 祭品
    ("images/packed/card_portraits/silent/afterimage",      "art_afterimage"),    # 余像
    # ⚠ 追踪之刃 = **SeekingEdge**（zhs 卡名「追踪之刃」，Regent/橙），
    #   不是 Silent 的 Tracking（那张的中文名是「跟踪」）—— 一开始拿错了，卡面已换。
    ("images/packed/card_portraits/regent/seeking_edge",    "art_seeking_edge"),  # 追踪之刃
    ("images/packed/card_portraits/necrobinder/soul_storm", "art_soul_storm"),    # 灵魂风暴
    ("images/packed/card_portraits/defect/meteor_strike",   "art_meteor_strike"), # 陨石打击

    # ---- 机制贴图 ----
    # 灵魂风暴：灵魂卡（原版 token「灵魂」的卡面原画 → 拿去烘一张带卡框缎带的迷你卡）
    ("images/packed/card_portraits/token/soul",              "art_soul"),
    # 陨石打击：等离子充能球（原版 defect 等离子球本体；原版没有"等离子"卡，
    # 所以这颗球就用球体精灵本身，不上卡框）
    ("images/orbs/plasma_orb",                               "sp_plasma_orb"),
    # 陨石：原版巨石/落石特效（砸地碎石 + 巨石本体）
    ("images/vfx/vfx_rock_shatter/vfx_rock_shatter_rock",    "sp_meteor_rock"),
    ("images/vfx/vfx_rock_shatter/vfx_rock_shatter_smoke",   "sp_meteor_smoke"),
    # 余像：格挡特效（原版 block 翻页帧，取第一帧做「格挡护罩」图标/描边）
    ("images/vfx/vfx_block/vfx_block_00",                    "sp_block"),
    # 格挡能力图标（原版战斗 HUD 上的那块盾牌，十字血条上方的格挡徽标用它）
    ("images/ui/combat/block",                               "pw_block"),
]


if __name__ == "__main__":
    print("输出目录:", OUT)
    ok = sum(1 for rel, name in JOBS if fetch(rel, name))
    print(f"\n完成 {ok}/{len(JOBS)}")
    sys.exit(0 if ok == len(JOBS) else 1)
