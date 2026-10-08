# -*- coding: utf-8 -*-
"""一次性排查：哪些仓库里有本项目的提交（特别是基线 cc676f1）。用完可删。"""
import io
import subprocess

ROOTS = [
    r"C:\Users\shenl\Desktop\MC对决模拟器",
    r"C:\Users\shenl\Desktop\my-game_dsh",
    r"C:\Users\shenl\Desktop\备份版本\new-game测试",
    r"C:\Users\shenl\Desktop\new",
]

out = []
for p in ROOTS:
    r = subprocess.run(["git", "-C", p, "log", "--oneline", "-3"],
                       capture_output=True, text=True)
    out.append("=== {} ===\n{}{}".format(p, r.stdout, r.stderr))
    r2 = subprocess.run(["git", "-C", p, "log", "--oneline", "--all", "--grep", "cc676f1"],
                        capture_output=True, text=True)
    out.append("  grep cc676f1 -> {}".format(r2.stdout.strip() or "(no)"))

io.open(r"C:\Users\shenl\Desktop\new\tools\_git.txt", "w", encoding="utf-8").write("\n".join(out))
print("\n".join(out))
