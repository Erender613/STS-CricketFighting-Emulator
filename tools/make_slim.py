# -*- coding: utf-8 -*-
"""
生成一个"瘦身版"页面 tools/_game_slim.html：逻辑与 src/game.html 完全相同，
但把 __ASSET_MAP__ 换成空表（不内联 7.5MB 的 BGM 和所有贴图）。

用途：真·无头 Chrome 探针。完整产物 12.4MB 会让无头 Chrome 在
--dump-dom 时直接退出（exit=21，DOM 为空）；逻辑验证用瘦身版就够，
贴图相关的绘制在无贴图时会走各处的 else 兜底分支，不会抛异常。

用法: python tools/make_slim.py
"""
import io
import os

ROOT = r"C:\Users\shenl\Desktop\new"
tpl_path = os.path.join(ROOT, "src", "game.html")
out_path = os.path.join(ROOT, "tools", "_game_slim.html")

EMPTY = '{"img":{},"snd":{},"bg":{},"bgm":{},"ui":{}}'

with io.open(tpl_path, encoding="utf-8") as f:
    html = f.read()

html = (html.replace("__ASSET_MAP__", EMPTY)
            .replace("__BUILD_TAG__", "slim")
            .replace("__BUILD_BADGE__", "")
            .replace("__DEV_UI__", ""))

with io.open(out_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(html)

print("生成 tools/_game_slim.html  %.0f KB" % (len(html.encode("utf-8")) / 1024))
