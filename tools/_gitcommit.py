# -*- coding: utf-8 -*-
"""小提交：把记忆笔记、技能整理、探针小工具留档。用完可删。"""
import io
import subprocess

MSG = "笔记/技能：腕口粒子本轮记录 + 探针共用 helper 与验证套路写进技能"

out = []
r = subprocess.run(["git", "-C", r"C:\Users\shenl\Desktop\new", "add", "-A"],
                   capture_output=True, text=True)
out.append(r.stdout + r.stderr)
for args in (["commit", "-q", "-m", MSG], ["log", "--oneline", "-3"], ["status", "--short"]):
    r = subprocess.run(["git", "-C", r"C:\Users\shenl\Desktop\new"] + args,
                       capture_output=True, text=True)
    out.append("$ git {}\n{}{}".format(" ".join(args), r.stdout, r.stderr))

io.open(r"C:\Users\shenl\Desktop\new\tools\_git.txt", "w", encoding="utf-8").write("\n".join(out))
print("ok")
