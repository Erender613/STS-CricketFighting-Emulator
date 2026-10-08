# -*- coding: utf-8 -*-
"""把探针用的临时 Chrome 配置、烘焙缓存从版本库里移出（只动索引，磁盘文件不动）。用完可删。"""
import io
import os
import subprocess

ROOT = r"C:\Users\shenl\Desktop\new"
out = []


def run(*args):
    r = subprocess.run(["git", "-C", ROOT] + list(args), capture_output=True, text=True)
    out.append("$ git {}\n{}{}".format(" ".join(args), r.stdout[-3000:], r.stderr[-2000:]))
    return r


gi = os.path.join(ROOT, ".gitignore")
txt = io.open(gi, "r", encoding="utf-8").read()
add = []
for pat in ("tools/_chrome*/", "tools/bake/vram/", "*.log"):
    if pat not in txt:
        add.append(pat)
if add:
    io.open(gi, "w", encoding="utf-8", newline="\n").write(
        txt.rstrip("\n") + "\n\n# 探针用的临时 Chrome 配置 / 烘焙缓存（Chrome 每次跑都会重写，别入库）\n"
        + "\n".join(add) + "\n")
    out.append(".gitignore += " + ", ".join(add))

for p in ("tools/_chrome", "tools/_chrome2", "tools/_chrome_profile", "tools/bake/vram"):
    if os.path.exists(os.path.join(ROOT, p)):
        run("rm", "-r", "--cached", "-q", p)

run("add", "-A")
run("commit", "-q", "-m", "清理：把探针临时 Chrome 配置、烘焙缓存移出版本库（文件仍在磁盘）")
run("log", "--oneline", "-3")
r = subprocess.run(["git", "-C", ROOT, "status", "--short"], capture_output=True, text=True)
out.append("status: " + (r.stdout.strip() or "(clean)"))
n = subprocess.run(["git", "-C", ROOT, "ls-files"], capture_output=True, text=True).stdout.count("\n")
out.append("已跟踪文件数 = {}".format(n))

io.open(r"C:\Users\shenl\Desktop\new\tools\_git.txt", "w", encoding="utf-8").write("\n".join(out))
print("ok")
