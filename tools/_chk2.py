# -*- coding: utf-8 -*-
import subprocess, sys, os
TOOLS = r"C:\Users\shenl\Desktop\new\tools"
PY = sys.executable
NODE = r"C:\Users\shenl\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
out = []
p = subprocess.run([PY, os.path.join(TOOLS, "build.py")], cwd=TOOLS,
                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
t = p.stdout.decode("utf-8", "replace")
out.append("BUILD exit=%d\n%s" % (p.returncode, "\n".join(t.strip().splitlines()[-4:])))
p = subprocess.run([NODE, os.path.join(TOOLS, "simcheck.js")], cwd=TOOLS,
                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
t = p.stdout.decode("utf-8", "replace")
out.append("\nSIM exit=%d\n%s" % (p.returncode, "\n".join(t.strip().splitlines()[-12:])))
open(os.path.join(TOOLS, "_chk2.txt"), "w", encoding="utf-8").write("\n".join(out))
print("done")
