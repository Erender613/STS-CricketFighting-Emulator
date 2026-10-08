import os, shutil, subprocess, io

NEW = r"C:\Users\shenl\Desktop\new"
log = []

# 1. 删掉本次截图用的临时副本与临时 Chrome 配置（不进版本库）
for p in (os.path.join(NEW, "tools", "_bundle_page.html"),
          os.path.join(NEW, "tools", "_chrome_profile2")):
    if os.path.isdir(p):
        shutil.rmtree(p, ignore_errors=True)
        log.append("rmdir " + p)
    elif os.path.exists(p):
        os.remove(p)
        log.append("rm " + p)

# 2. 看一眼 .gitignore
gi = os.path.join(NEW, ".gitignore")
log.append("--- .gitignore ---")
log.append(io.open(gi, encoding="utf-8", errors="replace").read() if os.path.exists(gi) else "(no .gitignore)")


def run(*a):
    return subprocess.run(["git", "-C", NEW] + list(a), capture_output=True, text=True)


run("add", "-A")
r = run("commit", "-q", "-m", "界面文案：去掉页头两行副标题与侧栏说明段（规则/血条）")
log.append("commit rc=" + str(r.returncode) + " " + r.stdout.strip() + r.stderr.strip())
log.append("--- log ---\n" + run("log", "--oneline", "-3").stdout)
log.append("--- status ---\n" + (run("status", "--porcelain").stdout.strip() or "(clean)"))

io.open(os.path.join(NEW, "tools", "_gi.txt"), "w", encoding="utf-8").write("\n".join(log))
