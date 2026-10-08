# -*- coding: utf-8 -*-
"""跑无头 Chrome → dump-dom → 从 DOM 里取出探针导出的 base64 PNG 解码存盘。
用法: shotpng.py <page.html[#mode]> <outdir> [前缀]
      page 里可以带 #mode，会原样拼到 URL 末尾（探针靠 location.hash 选分支）。
【为什么不用 --screenshot】无头截图会被缩放，量像素不可信；
本脚本走 canvas.toDataURL()，1:1 位图。"""
import base64
import os
import re
import subprocess
import sys
import urllib.parse

ROOT = r"C:\Users\shenl\Desktop\new"
TOOLS = os.path.join(ROOT, "tools")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UD = os.path.join(TOOLS, "_chrome_profile")
PV = os.path.join(TOOLS, "预览图")

page_arg = sys.argv[1] if len(sys.argv) > 1 else os.path.join(TOOLS, "_probe_sb.html")
outdir = sys.argv[2] if len(sys.argv) > 2 else PV
prefix = sys.argv[3] if len(sys.argv) > 3 else "_n"

page, _, frag = page_arg.partition("#")
url = "file:///" + urllib.parse.quote(os.path.abspath(page).replace("\\", "/"))
if frag:
    url += "#" + frag
dom = os.path.join(TOOLS, "_dom.txt")

cmd = [CHROME, "--headless=new", "--user-data-dir=" + UD, "--no-sandbox",
       "--enable-unsafe-swiftshader", "--window-size=1400,1000",
       "--virtual-time-budget=25000", "--dump-dom", url]
p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
html = p.stdout or ""
open(dom, "w", encoding="utf-8").write(html)

log = []
m = re.search(r'id="err"[^>]*>(.*?)</div>', html, re.S)
log.append("ERRBOX: " + (m.group(1).strip() if m else "(未找到 #err)"))

for name in ("img1", "img2", "img3"):
    mm = re.search(r'id="%s"[^>]*>data:image/png;base64,([A-Za-z0-9+/=]+)<' % name, html, re.S)
    if not mm:
        log.append("  %s: (未找到)" % name)
        continue
    raw = base64.b64decode(mm.group(1))
    path = os.path.join(outdir, "%s_%s.png" % (prefix, name))
    with open(path, "wb") as f:
        f.write(raw)
    log.append("  %s -> %s  %d bytes" % (name, os.path.basename(path), len(raw)))

open(os.path.join(TOOLS, "_shot_log.txt"), "w", encoding="utf-8").write("\n".join(log))
