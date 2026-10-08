# -*- coding: utf-8 -*-
"""用无头 Chrome 给探针页截图（目视验证用；量像素请走 toDataURL 那套）。
用法: python tools/_probe/shoot.py [mode ...]
生成: tools/_probe/arena_<mode>.png
"""
import os
import subprocess
import sys
import urllib.parse

ROOT = r"C:\Users\shenl\Desktop\new"
OUTDIR = os.path.join(ROOT, "tools", "_probe")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UD = os.path.join(ROOT, "tools", "_chrome_profile")

SIZE = {"zoom": "1100,880", "hand": "1400,1000", "hud": "1400,1000",
        "voltaic": "1400,1000", "doom": "1400,1000", "hp": "820,430"}


def main():
    modes = sys.argv[1:] or ["zoom", "hand", "voltaic"]
    for m in modes:
        page = os.path.join(OUTDIR, "p_%s.html" % m)
        if not os.path.isfile(page):
            print("!! 跳过（没有探针页）", page)
            continue
        dst = os.path.join(OUTDIR, "arena_%s.png" % m)
        url = "file:///" + urllib.parse.quote(page.replace("\\", "/")) + "#" + m
        cmd = [CHROME, "--headless=new", "--user-data-dir=" + UD, "--no-sandbox",
               "--enable-unsafe-swiftshader", "--hide-scrollbars",
               "--window-size=" + SIZE.get(m, "1400,1000"),
               "--virtual-time-budget=22000", "--screenshot=" + dst, url]
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        ok = os.path.isfile(dst)
        print("  %-8s -> %s  %s" % (m, os.path.basename(dst), "OK" if ok else "失败"))


if __name__ == "__main__":
    main()
