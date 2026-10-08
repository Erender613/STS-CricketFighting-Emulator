# -*- coding: utf-8 -*-
"""真·浏览器验证：用无头 Chrome 打开**构建产物**（不是源文件），检查

  1) 主版本：标题是否全白；结算横幅是否【纯白】且写的是获胜卡牌名；
     真开一局跑几十帧后让红方战死，验证主循环的结算通路
  2) 开发者版：驱动面板全流程 —— 指定种子 → 批量预演 30 局 → 标签筛选（交集）
     → 点一行用该种子重现 → 打完自动停 → 「用该种子开战」

这些东西没法在 Node 假 DOM 里证明（真实渲染、真实点按、画布像素），所以单走 Chrome。
做法：把 tools/_probe/devpanel_*.js 注入到构建产物的**副本**里
（tools/_probe/_v_*_probe.html），构建产物本身不动。

用法: python tools/verify_browser.py
输出: tools/_probe/_v_main2.png / _v_dev.png / tools/_v_report.txt
"""
import io
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

# 控制台可能是 GBK：中文/符号直接写终端会炸，这里强制 UTF-8 + 替换不可编码字符
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = r"C:\Users\shenl\Desktop\new"
PROBEDIR = os.path.join(ROOT, "tools", "_probe")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
MAIN = os.path.join(ROOT, "杀戮尖塔小球对决.html")
DEV = os.path.join(ROOT, "杀戮尖塔小球对决_开发者版.html")
TMP_UD = os.path.join(ROOT, "tools", "_chrome_vprobe")     # 一次性 profile，避免缓存旧探针


def run_chrome(page, png, size, budget):
    url = "file:///" + urllib.parse.quote(os.path.abspath(page).replace("\\", "/"))
    if os.path.exists(png):
        os.remove(png)
    cmd = [CHROME, "--headless=new", "--user-data-dir=" + TMP_UD, "--no-sandbox",
           "--enable-unsafe-swiftshader", "--hide-scrollbars", "--disable-gpu-sandbox",
           "--window-size=" + size, "--virtual-time-budget=%d" % budget,
           "--screenshot=" + png, "--dump-dom", url]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.stdout or ""


def inject(src_html, js_path, dst):
    """把探针注入构建产物副本（不动构建产物本身）"""
    js = io.open(js_path, "r", encoding="utf-8").read()
    html = io.open(src_html, "r", encoding="utf-8").read()
    html = html.replace("</body>", "<script>\n" + js + "\n</script>\n</body>", 1)
    io.open(dst, "w", encoding="utf-8", newline="\n").write(html)
    return dst


def verdict_of(dom):
    m = re.search(r'id="verdict"[^>]*>(.*?)</div>', dom, re.S)
    return m.group(1).strip() if m else "(未拿到 verdict)"


def main():
    if not os.path.isfile(CHROME):
        print("!! 找不到 Chrome:", CHROME)
        return 1
    if os.path.isdir(TMP_UD):
        shutil.rmtree(TMP_UD, ignore_errors=True)
    rep = []

    print("== 主版本：标题 + 白字横幅像素 + 结算通路 ==")
    pm = inject(MAIN, os.path.join(PROBEDIR, "devpanel_main.js"),
                os.path.join(PROBEDIR, "_v_main_probe.html"))
    v = verdict_of(run_chrome(pm, os.path.join(PROBEDIR, "_v_main2.png"), "1300,1000", 60000))
    rep.append("[主版本]\n" + v)
    print(v)

    print("\n== 开发者版：面板全流程 ==")
    pd = inject(DEV, os.path.join(PROBEDIR, "devpanel_dev.js"),
                os.path.join(PROBEDIR, "_v_dev_probe.html"))
    v2 = verdict_of(run_chrome(pd, os.path.join(PROBEDIR, "_v_dev.png"), "1500,1080", 180000))
    rep.append("[开发者版]\n" + v2)
    print(v2)

    out = os.path.join(ROOT, "tools", "_v_report.txt")
    io.open(out, "w", encoding="utf-8").write("\n\n".join(rep))
    print("\n报告: " + out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
