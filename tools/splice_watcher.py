"""
把 src/watcher/*.js 的观者机制片段拼进 src/game.html 的自动生成区。

背景：游戏是单文件 HTML（引擎/卡表/机制全在一个巨大的 <script> 里），
观者 4 卡的机制类由多名作者并行编写、各自放在 src/watcher/ 下的独立文件里。
本脚本把 src/watcher/*.js 按文件名排序后拼接到 src/game.html 的
    /* WATCHER_MECHS_START */ … /* WATCHER_MECHS_END */
之间（每次整段替换，幂等）。片段里的类/函数直接运行在游戏主脚本的顶层作用域，
可以直接引用 Unit / Effect / world / IMG / rand 等全局对象。

用法：
    python tools/splice_watcher.py          # 拼接（会重写 src/game.html）
    python tools/splice_watcher.py --check  # 只检查标记是否存在、片段是否为空
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_HTML = os.path.join(ROOT, "src", "game.html")
WATCH_DIR = os.path.join(ROOT, "src", "watcher")
START = "/* WATCHER_MECHS_START */"
END = "/* WATCHER_MECHS_END */"

HEADER = """/* ------------------------------------------------------------------
   以下为自动生成区（tools/splice_watcher.py）。改机制请改 src/watcher/*.js，
   然后重新运行 python tools/splice_watcher.py，不要直接编辑这里。
   ------------------------------------------------------------------ */"""


def collect():
    """按文件名排序读取片段；跳过空文件与下划线开头的草稿。"""
    if not os.path.isdir(WATCH_DIR):
        return [], []
    names = sorted(f for f in os.listdir(WATCH_DIR)
                   if f.endswith(".js") and not f.startswith("_"))
    parts = []
    for f in names:
        p = os.path.join(WATCH_DIR, f)
        with open(p, "r", encoding="utf-8") as fh:
            txt = fh.read().strip("\n")
        parts.append("/* ===== src/watcher/%s ===== */\n%s" % (f, txt))
    return names, parts


def main():
    check = "--check" in sys.argv
    names, parts = collect()
    if not names:
        print("!! src/watcher/ 下没有可拼接的 .js 片段")
        return 1
    if not os.path.isfile(SRC_HTML):
        print("!! 找不到 %s" % SRC_HTML)
        return 1
    html = open(SRC_HTML, "r", encoding="utf-8").read()
    if START not in html or END not in html:
        print("!! src/game.html 里找不到 WATCHER_MECHS 标记（START or END）")
        return 1
    i = html.index(START) + len(START)
    j = html.index(END, i)
    body = "\n\n" + HEADER + "\n\n" + "\n\n".join(parts) + "\n\n"
    out = html[:i] + body + html[j:]
    head = ""
    for n in names:
        head += "   %-26s %6.1f KB\n" % (n, os.path.getsize(os.path.join(WATCH_DIR, n)) / 1024)
    print("拼接片段 (%d 个):\n%s" % (len(names), head.rstrip()))
    if check:
        print("--check：只检查，不写盘。")
        return 0
    if out == html:
        print("内容未变化，无需写盘。")
        return 0
    with open(SRC_HTML, "w", encoding="utf-8", newline="\n") as f:
        f.write(out)
    print("已写入 %s（+%.1f KB）" % (SRC_HTML, (len(out) - len(html)) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
