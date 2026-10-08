# -*- coding: utf-8 -*-
"""一次性脚本：给 C:\\Users\\shenl\\Desktop\\new 重建 git 留档（用户已授权自动 commit）。
安全护栏：先量体积，超大就不 init，只报告。用完可删。"""
import io
import os
import subprocess

ROOT = r"C:\Users\shenl\Desktop\new"
LOG = r"C:\Users\shenl\Desktop\new\tools\_git.txt"
out = []


def run(*args):
    r = subprocess.run(["git", "-C", ROOT] + list(args), capture_output=True, text=True)
    out.append("$ git {}\n{}{}".format(" ".join(args), r.stdout, r.stderr))
    return r


# 1) 量体积
total = 0
big = []
nfile = 0
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d != ".git"]
    for f in filenames:
        p = os.path.join(dirpath, f)
        try:
            s = os.path.getsize(p)
        except OSError:
            continue
        nfile += 1
        total += s
        if s > 2 * 1024 * 1024:
            big.append((s, p))
big.sort(reverse=True)
out.append("文件数={} 合计={:.1f} MB".format(nfile, total / 1048576.0))
for s, p in big[:12]:
    out.append("  大文件 {:.1f} MB  {}".format(s / 1048576.0, p))

if total > 200 * 1048576:
    out.append("!! 总体积过大，跳过 git init（交给用户决定）")
else:
    gitdir = os.path.join(ROOT, ".git")
    if os.path.exists(gitdir):
        out.append("已存在 .git，跳过 init")
    else:
        run("init", "-q")
        run("config", "user.name", "shenl")
        run("config", "user.email", "shenl@local")
        run("config", "core.quotepath", "false")
        gi = os.path.join(ROOT, ".gitignore")
        if not os.path.exists(gi):
            io.open(gi, "w", encoding="utf-8", newline="\n").write(
                "# 探针/构建的临时产物，不入库\n"
                "tools/_*.txt\n"
                "tools/_probe/_*.png\n"
                "tools/_probe/p_*.html\n"
                "__pycache__/\n"
                "*.pyc\n")
            out.append(".gitignore 已创建")
    run("add", "-A")
    r = run("commit", "-q", "-m",
            "黑暗之拥：恶魔之手贴图换成夜魇 spooky_hand；黑洞改椭圆；腕口粒子改成世界坐标不跟手")
    run("log", "--oneline", "-3")
    r2 = subprocess.run(["git", "-C", ROOT, "status", "--short"], capture_output=True, text=True)
    out.append("status:\n" + (r2.stdout or "(clean)"))

io.open(LOG, "w", encoding="utf-8").write("\n".join(out))
print("ok")
