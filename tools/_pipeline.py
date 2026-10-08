# -*- coding: utf-8 -*-
"""顺序跑 build -> probe -> shotpng -> cmp_side -> quant，把每步 stdout/stderr 收集成纯文本日志。"""
import subprocess, sys, os

TOOLS = r"C:\Users\shenl\Desktop\new\tools"
PY = sys.executable
STEPS = ["build.py", "make_probe.py", "shotpng.py", "cmp_side.py", "quant.py"]

lines = []
for s in STEPS:
    lines.append("===== %s =====" % s)
    try:
        p = subprocess.run([PY, os.path.join(TOOLS, s)], cwd=TOOLS,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        txt = p.stdout.decode("utf-8", "replace")
        lines.append(txt.strip())
        lines.append("[exit %d]" % p.returncode)
    except Exception as e:
        lines.append("EXCEPTION: %r" % e)
    lines.append("")

open(os.path.join(TOOLS, "_pipeline_out.txt"), "w", encoding="utf-8").write("\n".join(lines))
print("OK")
