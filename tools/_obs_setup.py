# -*- coding: utf-8 -*-
"""
把本机 OBS Studio 配置成「录《杀戮尖塔小球对决》网页」的专用状态。
全程走 OBS 自带的 obs-websocket，不装任何第三方包（只用到标准库 socket）。

做这些事：
  1. 打开 obs-websocket（端口 4455，沿用已生成的密码），重启 OBS 让它生效
  2. 把默认配置文件改名为「小球对决录制」（不动别的配置）
  3. 画面 2560x1600@60fps；录像编码 NVENC HEVC、CQP 18（画质优先）
  4. 建场景 + 显示器采集(2560x1600 满屏不缩放) + 桌面音频；录像目录改到 D 盘
最后把 profile / 场景集合落盘，并回读验证。

用法：python tools/_obs_setup.py
"""
import os, sys, json, time, base64, hashlib, socket, struct, secrets, subprocess

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

OBS_EXE     = r"D:\obs-studio\bin\64bit\obs64.exe"
OBS_APPDATA = os.path.join(os.environ['APPDATA'], 'obs-studio')
WS_CFG      = os.path.join(OBS_APPDATA, 'plugin_config', 'obs-websocket', 'config.json')
PROFILE     = '小球对决录制'
SCENE_COLL  = '小球对决录制'
SCENE       = '录屏'
SRC_DISPLAY = '游戏画面'
REC_DIR     = r'D:\录像_小球对决'

CANVAS_W, CANVAS_H = 2560, 1600
FPS = 60
HEVC_ENCODER = 'obs_nvenc_hevc_tex'      # 不存在会自动退回 H.264 NVENC
H264_ENCODER = 'obs_nvenc_h264_tex'


# ────────────────────────── 极简 WebSocket 客户端（RFC6455，够用就行） ──────────────────────────
class WS:
    """obs-websocket 5.x 的最小客户端：握手 + 认证 + op6 请求。"""

    def __init__(self, host='127.0.0.1', port=4455, password=None, timeout=25):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self.buf = b''
        self.rid = 0
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        req = (
            f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        head, self.buf = self._until(b'\r\n\r\n')
        if b'101' not in head.split(b'\r\n')[0]:
            raise RuntimeError('WebSocket 握手失败: ' + head.decode('utf-8', 'replace')[:200])
        hello = json.loads(self._recv())['d']          # op=0 hello
        auth = {'rpcVersion': 1}
        if hello.get('authentication') and password:
            a = hello['authentication']
            secret = base64.b64encode(
                hashlib.sha256((password + a['salt']).encode()).digest()).decode()
            auth['authentication'] = base64.b64encode(
                hashlib.sha256((secret + a['challenge']).encode()).digest()).decode()
        self._send(1, {'op': 1, 'd': auth})
        ident = json.loads(self._recv())['d']          # op=2 identified
        assert ident.get('negotiatedRpcVersion'), ident
        self.ident = ident

    # ---- 帧收发 ----
    def _until(self, sep):
        while sep not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError('连接被关闭')
            self.buf += chunk
        i = self.buf.index(sep) + len(sep)
        return self.buf[:i], self.buf[i:]

    def _send(self, opcode, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode()
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack('>H', n)
        else:
            header += bytes([0x80 | 127]) + struct.pack('>Q', n)
        mask = secrets.token_bytes(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def _recv(self):
        while True:
            while len(self.buf) < 2:
                self.buf += self.sock.recv(65536)
            b0, b1 = self.buf[0], self.buf[1]
            opcode, n = b0 & 0x0F, b1 & 0x7F
            pos = 2
            if n == 126:
                while len(self.buf) < 4:
                    self.buf += self.sock.recv(65536)
                n = struct.unpack('>H', self.buf[2:4])[0]
                pos = 4
            elif n == 127:
                while len(self.buf) < 10:
                    self.buf += self.sock.recv(65536)
                n = struct.unpack('>Q', self.buf[2:10])[0]
                pos = 10
            while len(self.buf) < pos + n:
                self.buf += self.sock.recv(65536)
            payload = self.buf[pos:pos + n]
            self.buf = self.buf[pos + n:]
            if opcode == 0x9:                                  # ping → pong
                self.sock.sendall(bytes([0x8A, 0x80]) + secrets.token_bytes(4))
                continue
            if opcode == 0x8:
                raise RuntimeError('服务端关闭了连接')
            if opcode in (0x1, 0x2):
                return payload.decode('utf-8', 'replace')

    # ---- RPC ----
    def call(self, requestType, data=None, retries=60):
        """发一个 op6 请求；207（OBS 前端还没加载完）自动等待重试。"""
        for attempt in range(retries + 1):
            self.rid += 1
            rid = str(self.rid)
            d = {'requestType': requestType, 'requestId': rid}
            if data:
                d['requestData'] = data
            self._send(1, {'op': 6, 'd': d})
            while True:
                resp = json.loads(self._recv()).get('d', {})
                if resp.get('requestId') != rid:
                    continue
                st = resp.get('requestStatus', {})
                if st.get('result'):
                    return resp.get('responseData', {})
                if st.get('code') == 207 and attempt < retries:
                    time.sleep(0.5)
                    break                       # 跳出内层，重发同一个请求
                raise RuntimeError(f"{requestType} 失败: {st.get('code')} {st.get('comment')}")
        raise RuntimeError(f'{requestType} 一直没准备好')

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


# ────────────────────────── 步骤 ──────────────────────────
def log(*a):
    print(*a, flush=True)


def stop_obs():
    r = subprocess.run(['taskkill', '/IM', 'obs64.exe'], capture_output=True, text=True)
    if r.returncode == 0:
        log('  已停止正在运行的 OBS')
        time.sleep(3)
    else:
        log('  OBS 本来就没在运行')


def enable_websocket():
    log('[1/6] 打开 obs-websocket')
    cfg = {}
    if os.path.exists(WS_CFG):
        with open(WS_CFG, encoding='utf-8') as f:
            cfg = json.load(f)
    cfg.setdefault('server_port', 4455)
    cfg.setdefault('server_password', secrets.token_urlsafe(12))
    cfg['server_enabled'] = True
    cfg['auth_required'] = True
    cfg['alerts_enabled'] = False
    os.makedirs(os.path.dirname(WS_CFG), exist_ok=True)
    with open(WS_CFG, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=4)
    log(f"  端口 {cfg['server_port']}，认证已开启")
    return cfg['server_port'], cfg['server_password']


def start_obs():
    log('[2/6] 启动 OBS')
    subprocess.Popen([OBS_EXE], cwd=os.path.dirname(OBS_EXE),
                     creationflags=subprocess.DETACHED_PROCESS)
    for i in range(60):
        time.sleep(1)
        try:
            s = socket.create_connection(('127.0.0.1', 4455), timeout=1)
            s.close()
            log(f'  端口已监听（{i + 1}s），等前端加载完成…')
            time.sleep(4)
            return
        except OSError:
            pass
    raise RuntimeError('OBS 启动超时')


def make_profile(ws):
    """建一个专用配置文件（CreateProfile 会顺带切过去）。
    不动用户原来的「未命名」，录像设置全隔离在这一份里。"""
    log('[3/6] 准备专用配置文件')
    pl = ws.call('GetProfileList')
    known, cur = pl.get('profiles', []), pl.get('currentProfileName')
    log(f'  OBS 已知配置: {known}（当前 {cur}）')
    if PROFILE in known:
        ws.call('SetCurrentProfile', {'profileName': PROFILE})
        log(f'  「{PROFILE}」已存在，切过去')
    else:
        ws.call('CreateProfile', {'profileName': PROFILE})
        log(f'  已新建并切到「{PROFILE}」')
    time.sleep(1.5)


def configure(ws):
    log('[4/6] 设置画面与编码')
    ws.call('SetVideoSettings', {
        'baseWidth': CANVAS_W, 'baseHeight': CANVAS_H,
        'outputWidth': CANVAS_W, 'outputHeight': CANVAS_H,
        'fpsNumerator': FPS, 'fpsDenominator': 1,
        'scaleType': 'bicubic', 'colorFormat': 'NV12',
        'colorSpace': 'Rec709', 'colorRange': 'Partial',
    })

    # 编码器 id 是从 obs-nvenc.dll 里抽出来的权威值（obs-websocket 没有列举编码器的接口）
    encoder = HEVC_ENCODER
    log(f'  编码器: {encoder}')

    def prof(cat, name, val):
        ws.call('SetProfileParameter',
                {'parameterCategory': cat, 'parameterName': name, 'parameterValue': str(val)})

    prof('AdvOut', 'Encoder', encoder)
    prof('AdvOut', 'RecEncoder', encoder)
    prof('AdvOut', 'RecType', 'Standard')
    prof('AdvOut', 'RecFilePath', REC_DIR)
    prof('AdvOut', 'RecFormat2', 'hybrid_mp4')
    prof('AdvOut', 'RecUseRescale', 'false')
    prof('AdvOut', 'RecTracks', '1')
    # 画质优先：CQP 18、p5 预设、lookahead + AQ、心理视觉调优
    for k, v in (('rate_control', 'CQP'), ('cqp', '18'), ('preset', 'p5'),
                 ('tuning', 'hq'), ('multipass', 'qres'), ('lookahead', 'true'),
                 ('adaptive_quantization', 'true'), ('psycho_aq', 'true'),
                 ('keyint_sec', '2'), ('repeat_headers', 'true')):
        try:
            prof(encoder, k, v)
        except RuntimeError as e:
            log(f'    (跳过 {k}: {e})')
    # 简单模式也同步，免得界面里切换时数值对不上
    for cat, k, v in (('SimpleOutput', 'RecEncoder', encoder),
                      ('SimpleOutput', 'RecQuality', 'Stream'),
                      ('SimpleOutput', 'RecFormat2', 'hybrid_mp4'),
                      ('SimpleOutput', 'FilePath', REC_DIR)):
        try:
            prof(cat, k, v)
        except RuntimeError as e:
            log(f'    (跳过 {cat}.{k}: {e})')
    try:
        ws.call('SetRecordDirectory', {'recordDirectory': REC_DIR})
    except RuntimeError as e:
        log(f'    (SetRecordDirectory: {e})')
    log(f'  画布 {CANVAS_W}x{CANVAS_H} @ {FPS}fps，输出同尺寸（不缩放）')


def build_scene(ws):
    log('[5/6] 搭建场景')
    cols = ws.call('GetSceneCollectionList')
    if SCENE_COLL not in cols.get('sceneCollections', []):
        ws.call('CreateSceneCollection', {'sceneCollectionName': SCENE_COLL})
    else:
        ws.call('SetCurrentSceneCollection', {'sceneCollectionName': SCENE_COLL})
    time.sleep(2)

    scenes = [s['sceneName'] for s in ws.call('GetSceneList').get('scenes', [])]
    if SCENE not in scenes:
        ws.call('CreateScene', {'sceneName': SCENE})
    ws.call('SetCurrentProgramScene', {'sceneName': SCENE})

    inputs = {i['inputName'] for i in ws.call('GetInputList').get('inputs', [])}
    if SRC_DISPLAY not in inputs:
        try:                                   # method 2 = Windows 10/11 新采集方式
            ws.call('CreateInput', {'sceneName': SCENE, 'inputName': SRC_DISPLAY,
                                    'inputKind': 'monitor_capture',
                                    'inputSettings': {'method': 2},
                                    'sceneItemEnabled': True})
        except RuntimeError:
            ws.call('CreateInput', {'sceneName': SCENE, 'inputName': SRC_DISPLAY,
                                    'inputKind': 'monitor_capture',
                                    'inputSettings': {}, 'sceneItemEnabled': True})
        log(f'  已加显示器采集「{SRC_DISPLAY}」')
    else:
        log(f'  「{SRC_DISPLAY}」已存在')

    items = ws.call('GetSceneItemList', {'sceneName': SCENE}).get('sceneItems', [])
    it = next(i for i in items if i['sourceName'] == SRC_DISPLAY)
    ws.call('SetSceneItemTransform', {
        'sceneName': SCENE, 'sceneItemId': it['sceneItemId'],
        'sceneItemTransform': {'positionX': 0.0, 'positionY': 0.0,
                               'boundsType': 'OBS_BOUNDS_STRETCH', 'boundsAlignment': 0,
                               'boundsWidth': float(CANVAS_W),
                               'boundsHeight': float(CANVAS_H)},
    })
    log(f'  铺满 {CANVAS_W}x{CANVAS_H}，无缩放')

    try:
        sp = ws.call('GetSpecialInputs')
        log(f"  桌面音频: {sp.get('desktopAudio')} / 麦克风: {sp.get('mic1')}")
    except RuntimeError:
        pass


def finalize(ws):
    log('[6/6] 回读验证')
    os.makedirs(REC_DIR, exist_ok=True)

    v = ws.call('GetVideoSettings')
    adv = ws.call('GetOutputSettings').get('outputSettings', {})
    info = {
        'profile': ws.call('GetProfileList').get('currentProfileName'),
        'sceneCollection': ws.call('GetSceneCollectionList').get('currentSceneCollectionName'),
        'currentScene': ws.call('GetCurrentProgramScene').get('currentProgramSceneName'),
        'video': {k: v.get(k) for k in ('baseWidth', 'baseHeight', 'outputWidth',
                                        'outputHeight', 'fpsNumerator', 'fpsDenominator')},
        'encoder': adv.get('RecEncoder'),
        'recFormat': adv.get('RecFormat2'),
        'recPath': adv.get('RecFilePath'),
        'inputs': [i['inputName'] for i in ws.call('GetInputList').get('inputs', [])],
    }
    log('')
    log('===== 配置结果 =====')
    log(json.dumps(info, ensure_ascii=False, indent=2))
    return info


def main():
    port, pw = enable_websocket()
    stop_obs()
    start_obs()
    ws = WS(port=port, password=pw)
    try:
        make_profile(ws)
        configure(ws)
        build_scene(ws)
        finalize(ws)
    finally:
        ws.close()
    log('\n完成。')


if __name__ == '__main__':
    main()
