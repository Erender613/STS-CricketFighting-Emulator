# -*- coding: utf-8 -*-
"""无头 Chrome 截探针页：--screenshot 到 tools/预览图/_shot.png，并把 #err 文本导出。"""
import os, re, subprocess, sys, urllib.parse

ROOT = r"C:\Users\shenl\Desktop\new"
TOOLS = os.path.join(ROOT, "tools")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UD = os.path.join(TOOLS, "_chrome_profile")

page = sys.argv[1] if len(sys.argv) > 1 else os.path.join(TOOLS, "_probe_sb.html")
shot = sys.argv[2] if len(sys.argv) > 2 else os.path.join(TOOLS, "预览图", "_shot.png")
W = sys.argv[3] if len(sys.argv) > 3 else "1120"
H = sys.argv[4] if len(sys.argv) > 4 else "900"

url = "file:///" + urllib.parse.quote(os.path.abspath(page).replace("\\", "/"))
dom = os.path.join(TOOLS, "_dom.txt")

if os.path.exists(shot):
    os.remove(shot)

cmd = [CHROME, "--headless=new", "--user-data-dir=" + UD, "--no-sandbox",
       "--enable-unsafe-swiftshader", "--disable-gpu-sandbox",
       "--window-size=%s,%s" % (W, H), "--virtual-time-budget=20000",
       "--screenshot=" + shot, "--dump-dom", url]
p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
open(dom, "w", encoding="utf-8").write(p.stdout or "")

m = re.search(r'id="err"[^>]*>(.*?)</div>', p.stdout or "", re.S)
lines = ["ERRBOX: " + (m.group(1).strip()[:900] if m else "(未找到 #err)"),
         "SHOT: %s exists=%s size=%s" % (shot, os.path.exists(shot),
                                         os.path.getsize(shot) if os.path.exists(shot) else 0)]
open(os.path.join(TOOLS, "_shot_log.txt"), "w", encoding="utf-8").write("\n".join(lines))
