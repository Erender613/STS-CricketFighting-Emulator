# -*- coding: utf-8 -*-
"""跑完整 simcheck 并把全部输出写成可读文本（check_engine.py 只保留末尾几行，不够看平衡表）。"""
import subprocess, os

TOOLS = r"C:\Users\shenl\Desktop\new\tools"
NODE = r"C:\Users\shenl\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
p = subprocess.run([NODE, os.path.join(TOOLS, "simcheck.js")], cwd=TOOLS,
                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
txt = p.stdout.decode("utf-8", "replace")
open(os.path.join(TOOLS, "_sim_full.txt"), "w", encoding="utf-8").write(txt)
print("exit", p.returncode)
