# -*- coding: utf-8 -*-
"""
实测 Chrome 在不同启动参数下的 innerHeight / devicePixelRatio / 画布 backing，
用来决定「怎么开窗口才能让 OBS 采到的游戏像素最清晰」。

注意：游戏里 canvas backing = min(2, devicePixelRatio) × (窗口高 − 32)。
物理屏幕 2560x1600、系统 150% 缩放 → 逻辑 1707x1067。
本探针就是验证"力 device-scale-factor"能不能消掉缩放带来的模糊。

用法：python tools/_launch_probe.py
"""
import os, sys, json, time, socket, subprocess, base64, hashlib, secrets, struct

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, '杀戮尖塔小球对决_开发者版.html')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9222
USERDIR = os.path.join(ROOT, 'tools', '_obs', '_chrome_probe')


def ws_connect(url, timeout=20):
    """极简 CDP 用 WebSocket 客户端（复用 _obs_setup 的手写实现不划算，这里单独写一份）。"""
    from urllib.parse import urlparse
    u = urlparse(url)
    s = socket.create_connection((u.hostname, u.port), timeout=timeout)
    s.settimeout(timeout)
    key = base64.b64encode(secrets.token_bytes(16)).decode()
    req = (f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n"
           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
    s.sendall(req.encode())
    buf = b''
    while b'\r\n\r\n' not in buf:
        buf += s.recv(65536)
    head, buf = buf.split(b'\r\n\r\n', 1)
    if b'101' not in head.split(b'\r\n')[0]:
        raise RuntimeError('ws 握手失败')
    return s, buf


def ws_send(s, obj):
    payload = json.dumps(obj).encode()
    hdr = bytes([0x81])
    n = len(payload)
    if n < 126:
        hdr += bytes([0x80 | n])
    elif n < 65536:
        hdr += bytes([0x80 | 126]) + struct.pack('>H', n)
    else:
        hdr += bytes([0x80 | 127]) + struct.pack('>Q', n)
    mask = secrets.token_bytes(4)
    s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))


def ws_recv(s, buf):
    while True:
        while len(buf) < 2:
            buf += s.recv(65536)
        op, n = buf[0] & 0x0F, buf[1] & 0x7F
        pos = 2
        if n == 126:
            while len(buf) < 4:
                buf += s.recv(65536)
            n = struct.unpack('>H', buf[2:4])[0]; pos = 4
        elif n == 127:
            while len(buf) < 10:
                buf += s.recv(65536)
            n = struct.unpack('>Q', buf[2:10])[0]; pos = 10
        while len(buf) < pos + n:
            buf += s.recv(65536)
        payload, buf = buf[pos:pos + n], buf[pos + n:]
        if op == 0x9:
            s.sendall(bytes([0x8A, 0x80]) + secrets.token_bytes(4)); continue
        if op in (0x1, 0x2):
            return json.loads(payload.decode()), buf


def cdp_eval(ws_url, expr, rid=1):
    s, buf = ws_connect(ws_url)
    ws_send(s, {'id': rid, 'method': 'Runtime.evaluate',
                'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}})
    while True:
        msg, buf = ws_recv(s, buf)
        if msg.get('id') == rid:
            s.close()
            r = msg.get('result', {})
            if 'exceptionDetails' in r:
                raise RuntimeError(json.dumps(r['exceptionDetails'], ensure_ascii=False)[:300])
            return r.get('result', {}).get('value')


def http_json(path):
    import urllib.request
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}{path}', timeout=10) as r:
        return json.loads(r.read().decode())


CONFIGS = [
    ('A 系统缩放(150%)，裸开', []),
    ('B 强制 device-scale-factor=1', ['--force-device-scale-factor=1']),
    ('C 强制 device-scale-factor=2', ['--force-device-scale-factor=2']),
    ('D 强制 device-scale-factor=1.5', ['--force-device-scale-factor=1.5']),
]

MEASURE = """(function(){
  var o = {iw: innerWidth, ih: innerHeight,
           dpr: window.devicePixelRatio,
           scr: [screen.width, screen.height],
           avail: [screen.availWidth, screen.availHeight],
           booted: (typeof window.__rec === 'object')};
  try {
    var cv = document.getElementById('cv');
    if (cv && window.__rec) {
      window.__rec.apply(true);
      var b = cv.getBoundingClientRect();
      window.__rec.apply(false);
      o.backing = [cv.width, cv.height];
      o.cssH = Math.round(b.height);
    }
    if (window.__rec) {
      o.arenaIfFull = Math.round(Math.min(2, window.devicePixelRatio||1) * (innerHeight - 32));
    }
  } catch (e) { o.measErr = String(e); }
  return o;
})()"""


def kill_chrome():
    subprocess.run(['taskkill', '/IM', 'chrome.exe', '/F'], capture_output=True)
    time.sleep(2)


def main():
    url = 'file:///' + GAME.replace('\\', '/')
    results = []
    for label, extra in CONFIGS:
        kill_chrome()
        args = [CHROME, f'--remote-debugging-port={PORT}',
                f'--user-data-dir={USERDIR}',
                '--no-first-run', '--no-default-browser-check',
                '--disable-features=Translate', '--allow-file-access-from-files',
                '--window-position=0,0'] + extra + [f'--app={url}']
        subprocess.Popen(args)
        # 等 CDP 起来 + 页面加载完
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
            results.append((label, 'CDP 连不上'))
            continue
        got = None
        for _ in range(30):
            try:
                got = cdp_eval(target, MEASURE)
                if got and got.get('ih'):
                    break
            except Exception:
                pass
            time.sleep(1)
        results.append((label, got))

    kill_chrome()
    print()
    print(f"{'配置':28} | 视口(逻辑)   | DPR | 满屏时画布 backing | 说明")
    print('-' * 100)
    for label, r in results:
        if not isinstance(r, dict) or 'iw' not in r:
            print(f'{label:28} | 异常: {r}')
            continue
        backing = r.get('backing') or [0, 0]
        print(f"{label:28} | {r['iw']:>5}x{r['ih']:<5} | {r['dpr']:<3} | "
              f"{r.get('arenaIfFull')}x{r.get('arenaIfFull')} (当前窗口 {backing[0]}x{backing[1]}) | "
              f"screen={r['scr']} avail={r['avail']}")


if __name__ == '__main__':
    main()
