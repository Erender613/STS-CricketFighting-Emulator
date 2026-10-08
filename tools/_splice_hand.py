# -*- coding: utf-8 -*-
"""把 game.html 里「恶魔之手」的整段绘制代码（旧矢量版）换成 tools/_newhand.js 的新版。

用锚点定位而不是行号，避免行号漂移；替换完打印新旧长度以便核对。
"""
import io, os, sys

SRC = r"C:\Users\shenl\Desktop\new\src\game.html"
NEW = r"C:\Users\shenl\Desktop\new\tools\_newhand.js"

START = "/* ---------- 恶魔之手：全矢量绘制（墙面裂隙 + 手臂 + 五指骨爪），无 emoji / 无外部位图 ---------- */"
END = "function drawOverlayBanner() {"

html = io.open(SRC, "r", encoding="utf-8", newline="").read()
new = io.open(NEW, "r", encoding="utf-8", newline="").read()
assert not new.startswith("\ufeff")
new = new.replace("\r\n", "\n")
if not new.endswith("\n"):
    new += "\n"

i = html.find(START)
j = html.find(END)
assert i > 0, "找不到起点锚"
assert j > i, "找不到终点锚"

old = html[i:j]
print("旧段落 %d 字符（%d 行）" % (len(old), old.count("\n")))
print("新段落 %d 字符（%d 行）" % (len(new), new.count("\n")))
assert "drawDemonFinger" not in new, "新段里不该再出现 drawDemonFinger"
assert "drawDemonFinger" in old, "旧段里应当有 drawDemonFinger"

html = html[:i] + new + "\n" + html[j:]
io.open(SRC, "w", encoding="utf-8", newline="").write(html)
print("已写回 %s（现在 %d 字符）" % (SRC, len(html)))
