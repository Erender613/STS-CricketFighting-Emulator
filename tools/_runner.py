# -*- coding: utf-8 -*-
import io, os, sys, traceback
ROOT = r"C:\Users\shenl\Desktop\new"
OUT = os.path.join(ROOT, "tools", "_run_out.txt")
buf = io.StringIO()
try:
    src = open(os.path.join(ROOT, "tools", "verify_sb.py"), encoding="utf-8").read()
    g = {"__name__": "__main__", "__file__": os.path.join(ROOT, "tools", "verify_sb.py")}
    import contextlib
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        exec(compile(src, "verify_sb.py", "exec"), g)
    buf.write("\n[[ 脚本正常结束 ]]\n")
except Exception:
    buf.write("\n[[ 异常 ]]\n" + traceback.format_exc())
finally:
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(buf.getvalue())
