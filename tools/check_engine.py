# -*- coding: utf-8 -*-
"""打包 + 引擎冒烟测试，输出可读日志。

用法: python tools/check_engine.py
产出: tools/_check_engine.txt   两步的末尾摘要（快速看结论）
      tools/_sim_full.txt       simcheck 的完整输出（含 25 组对局表与平衡表）

分工:
  * 只改逻辑 / 数值 / 音频这类「不看画面就能验」的改动 -> 跑本脚本即可。
  * 改动涉及渲染 -> 再跑 tools/_pipeline.py（会做无头截图与逐像素量测）。
"""
import os
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
NODE = r"C:\Users\shenl\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"


def run(cmd):
    # 子进程强制 UTF-8 输出：否则它按 GBK 控制台编码写字节，父进程按 UTF-8 解出来
    # 全是 U+FFFD，日志里中文全花掉。
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    p = subprocess.run(cmd, cwd=TOOLS, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    return p.returncode, p.stdout.decode("utf-8", "replace")


def tail(text, n):
    return "\n".join(text.strip().splitlines()[-n:])


def main():
    out = []
    rc_build, t = run([PY, os.path.join(TOOLS, "build.py")])
    out.append("=== build.py  exit=%d ===\n%s" % (rc_build, tail(t, 4)))

    rc_sim, t = run([NODE, os.path.join(TOOLS, "simcheck.js")])
    open(os.path.join(TOOLS, "_sim_full.txt"), "w", encoding="utf-8").write(t)
    out.append("\n=== simcheck.js  exit=%d （完整输出见 _sim_full.txt）===" % rc_sim)
    # 平衡表 + 各回归段
    lines = t.splitlines()
    for i, ln in enumerate(lines):
        if "卡牌胜率" in ln:
            out.append("\n".join(lines[i:i + 8]))
            break
    out.append("\n".join(lines[-8:]))

    txt = "\n".join(out)
    open(os.path.join(TOOLS, "_check_engine.txt"), "w", encoding="utf-8").write(txt)
    # 控制台可能是 GBK，直接 print 会在最后一个字符上 UnicodeEncodeError 崩掉
    # （文件其实已经写好，但进程退出码变成 1 —— 白白把验收信号搞脏）。
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    print(txt)
    # 子步骤的失败必须传出去：以前这里恒 return 0，simcheck 红着也叫"通过"。
    # simcheck 的退出码语义：0=全过、2=有 SKIP（不算失败）、1=有 FAIL/异常。
    if rc_build != 0:
        return rc_build
    return 1 if rc_sim not in (0, 2) else 0


if __name__ == "__main__":
    raise SystemExit(main())
