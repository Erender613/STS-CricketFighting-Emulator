# -*- coding: utf-8 -*-
"""
第二版探针：显式指定 --window-size 并等待 boot 完成，量
  视口 / DPR / 画布 backing，
从而定出「启动器该用什么参数开窗口」。
用法：python tools/_launch_probe2.py
"""
import os, sys, json, time, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
from _launch_probe import cdp_eval, http_json, kill_chrome

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, '杀戮尖塔小球对决_开发者版.html')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9223
USERDIR = os.path.join(ROOT, 'tools', '_obs', '_chrome_probe2')

PROBE = """(function(){
  var out = {iw: innerWidth, ih: innerHeight, dpr: window.devicePixelRatio,
             oh: outerWidth + 'x' + outerHeight,
             avail: screen.availWidth + 'x' + screen.availHeight,
             rec: typeof window.__rec, frame: typeof window.__frame,
             cv: !!document.getElementById('cv'),
             badge: (document.getElementById('buildBadge')||{}).textContent || null};
  if (window.__rec && document.getElementById('cv')) {
    window.__rec.apply(true);
    var cv = document.getElementById('cv');
    var b = cv.getBoundingClientRect();
    out.arenaCSS = Math.round(b.width);
    out.backing = cv.width + 'x' + cv.height;
    out.gapTop = Math.round(b.top);
    out.gapBot = Math.round(innerHeight - b.bottom);
    out.cards = [Math.round(document.querySelector('.sideL .bigcard').getBoundingClientRect().width),
                 Math.round(document.querySelector('.sideR .bigcard').getBoundingClientRect().width)];
    window.__rec.apply(false);
  }
  return out;
})()"""

# (标签, 额外参数)  —— 窗口尺寸按【逻辑像素】给（150% 缩放下逻辑屏是 1707x1067）
CONFIGS = [
    ('A 裸开，窗口=逻辑屏', [], ['--window-size=1707,1067']),
    ('B dsf=1，窗口=逻辑屏', ['--force-device-scale-factor=1'], ['--window-size=1707,1067']),
    ('C dsf=2，窗口=逻辑屏/2', ['--force-device-scale-factor=2'], ['--window-size=854,534']),
    ('D dsf=1，窗口=1707x1019', ['--force-device-scale-factor=1'], ['--window-size=1707,1019']),
]


def run(args, wait_boot=True):
    subprocess.Popen(args)
    target = None
    for _ in range(60):
        time.sleep(1)
        try:
            for t in http_json('/json/list'):
                if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                    target = t['webSocketDebuggerUrl']
            if target:
                break
        except Exception:
            pass
    if not target:
        return 'CDP 连不上'
    last = None
    for _ in range(45):
        try:
            last = cdp_eval(target, PROBE)
            if last and last.get('rec') == 'object':
                return last
        except Exception as e:
            last = {'err': str(e)[:200]}
        time.sleep(1)
    return last


def main():
    url = 'file:///' + GAME.replace('\\', '/')
    rows = []
    for label, extra, win in CONFIGS:
        kill_chrome()
        args = ([CHROME, f'--remote-debugging-port={PORT}', f'--user-data-dir={USERDIR}',
                 '--no-first-run', '--no-default-browser-check',
                 '--allow-file-access-from-files', '--window-position=0,0']
                + extra + win + [f'--app={url}'])
        rows.append((label, run(args)))

    kill_chrome()
    print()
    for label, r in rows:
        print('===', label)
        print('   ', json.dumps(r, ensure_ascii=False))
    print()


if __name__ == '__main__':
    main()
