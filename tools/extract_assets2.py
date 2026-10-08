# -*- coding: utf-8 -*-
"""
第二批素材提取（10 张新卡）：复用 extract_assets.py 的 .ctex -> PNG 流水线。
卡面原画 -> assets/src/art_*.png（供 bake_card2.py 烘卡面用）
机制贴图  -> assets/src/sp_*.png / pw_*.png（供 build.py 打包 + 游戏绘制用）
用法: python tools/extract_assets2.py
"""
import os
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)

# extract_assets.py import 时就会跑 JOBS？不会 —— 抽取逻辑在 fetch()/JOBS 里，
# main 只在 __main__ 里执行，这里安全复用它的 STS/OUT/fetch。
from extract_assets import fetch, OUT  # noqa: E402

JOBS = [
    # ---- 10 张新卡的卡面原画（官方卡图，直接烘进卡框） ----
    ("images/packed/card_portraits/ironclad/perfected_strike",  "art_perfected_strike"),
    ("images/packed/card_portraits/ironclad/pillage",           "art_pillage"),
    ("images/packed/card_portraits/silent/snakebite",           "art_snakebite"),
    ("images/packed/card_portraits/silent/expose",              "art_expose"),
    ("images/packed/card_portraits/regent/guiding_star",        "art_guiding_star"),
    ("images/packed/card_portraits/regent/charge",              "art_charge"),
    ("images/packed/card_portraits/necrobinder/defy",           "art_defy"),
    ("images/packed/card_portraits/necrobinder/sleight_of_flesh", "art_sleight_of_flesh"),
    ("images/packed/card_portraits/defect/lightning_rod",       "art_lightning_rod"),
    ("images/packed/card_portraits/defect/darkness",            "art_darkness"),
    # ---- 机制贴图 ----
    # 血肉戏法转盘三图标 + 引雷针「集中」图标（原版能力图标）
    ("images/powers/vulnerable_power", "pw_vulnerable"),
    ("images/powers/weak_power",       "pw_weak"),
    ("images/powers/doom_power",       "pw_doom"),
    ("images/powers/focus_power",      "pw_focus"),
    ("images/powers/poison_power",     "pw_poison"),
    # 漆黑：暗黑充能球本体（原版 defect 的暗球）
    ("images/orbs/dark_orb",           "sp_dark_orb"),
    # 引导之星：辉星本体 + 撞击核心（原版 regent 星辰特效）
    ("images/vfx/starry_impact/starry_impact_small_star", "sp_star_small"),
    ("images/vfx/starry_impact/starry_impact_core",       "sp_starry_core"),
    # 暴露：超光束激光（原版 hyperbeam 的激光线/叠层）
    ("images/vfx/hyperbeam/hyperbeam_laser_line",    "sp_beam_line"),
    ("images/vfx/hyperbeam/hyperbeam_laser_overlay", "sp_beam_overlay"),
    # 引雷针：大雷击（原版 vfx_lightning 翻页帧）
    ("images/vfx/vfx_lightning/vfx_lightning_00_crop", "sp_lightning_strike"),
    # 冲锋：仆从（原版 token 卡「仆从俯冲」的卡面原画，游戏里裁成圆形当小单位）
    ("images/packed/card_portraits/token/minion_dive_bomb", "art_minion_dive"),
]

if __name__ == "__main__":
    print("输出目录:", OUT)
    ok = sum(1 for rel, name in JOBS if fetch(rel, name))
    # 后处理：加法混合特效贴图（黑=透明）在 .ctex 解码时会丢 alpha，
    # 变成不透明黑底方块。按亮度反解 alpha 并反预乘颜色还原。
    import numpy as np
    from PIL import Image
    for name in ("sp_star_small",):          # 本次批次里唯一中招的
        p = os.path.join(OUT, name + ".png")
        if not os.path.isfile(p):
            continue
        a = np.array(Image.open(p).convert("RGBA")).astype(np.float32)
        rgb, alpha = a[..., :3], a[..., 3]
        lum = rgb.max(axis=2)
        out_a = np.clip(lum * (alpha / 255.0), 0, 255)
        # 用户口径：辉星外围的圆形光晕不要 —— 阈值 90 + 线性抬升，
        # 只留明亮星芒本体（halo 亮度 30~80 全部切掉）
        out_a = np.clip((out_a - 90.0) * (255.0 / (255.0 - 90.0)), 0, 255)
        safe = np.maximum(out_a, 1)[..., None]
        out_rgb = np.clip(rgb * 255.0 / safe, 0, 255)
        Image.fromarray(
            np.dstack([out_rgb, out_a[..., None]]).astype(np.uint8), "RGBA").save(p)
        print("黑底转alpha:", p)
    print(f"\n完成 {ok}/{len(JOBS)}")
    sys.exit(0 if ok == len(JOBS) else 1)
