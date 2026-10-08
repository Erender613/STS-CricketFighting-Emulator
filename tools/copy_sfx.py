# -*- coding: utf-8 -*-
"""
从反编译工程把原版真音效拷进 assets/audio（build.py 会内联进单文件）。

之前每次加音效都是手抄一条 Copy-Item，容易漏、也没留下"这个音效是哪来的"。
这里把清单固定下来：文件名即 ASSET_MAP.snd 的键，必须与 build.py 的 SOUNDS 一致。

用法: python tools/copy_sfx.py
"""
import os
import shutil
import sys

SRC = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted\debug_audio"
DST = r"C:\Users\shenl\Desktop\new\assets\audio"

# build.py 的 SOUNDS 全量清单（含后续新增的测试版卡音效）
FILES = [
    "battle_start_1", "blunt_attack", "heavy_attack", "slash_attack", "dagger_throw",
    "card_smith", "card_select", "card_deal", "card_exhaust", "dark_orb_channel",
    "dark_orb_evoke", "doom_apply", "lightning_orb_channel", "lightning_orb_evoke",
    "lightning_orb_passive", "victory", "deny",
    # 测试版新卡：陨石打击（等离子球）/ 余像（格挡）
    "plasma_orb_channel", "plasma_orb_evoke", "frost_orb_passive",
]

if __name__ == "__main__":
    os.makedirs(DST, exist_ok=True)
    miss = []
    for name in FILES:
        for ext in (".mp3", ".wav"):
            p = os.path.join(SRC, name + ext)
            if os.path.isfile(p):
                shutil.copy2(p, os.path.join(DST, name + ext))
                print("  %-24s %s" % (name, ext))
                break
        else:
            miss.append(name)
            print("  !! 缺: %s" % name)
    print("\n完成 %d/%d" % (len(FILES) - len(miss), len(FILES)))
    sys.exit(0 if not miss else 1)
