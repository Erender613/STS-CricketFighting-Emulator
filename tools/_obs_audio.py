# -*- coding: utf-8 -*-
"""补齐音频：OBS 新建配置文件时不会自带「桌面音频」，不带就录成哑的。"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
from _obs_setup import WS, WS_CFG

with open(WS_CFG, encoding='utf-8') as f:
    cfg = json.load(f)
ws = WS(port=cfg['server_port'], password=cfg['server_password'])

DESK = '桌面音频'

def names():
    return [i['inputName'] for i in ws.call('GetInputList').get('inputs', [])]

print('现有输入:', names())

if DESK not in names():
    ws.call('CreateInput', {
        'sceneName': ws.call('GetCurrentProgramScene')['currentProgramSceneName'],
        'inputName': DESK,
        'inputKind': 'wasapi_output_capture',
        'inputSettings': {'device_id': 'default'},
        'sceneItemEnabled': True,
    })
    print(f'已创建「{DESK}」')
else:
    print(f'「{DESK}」已存在')

# 显示器采集那条在桌面音频之上/下都无所谓，但把音频放下面更符合直觉：
# 只是顺序，不影响录制，跳过。

print('现在输入:', names())
try:
    sp = ws.call('GetSpecialInputs')
    print('GetSpecialInputs:', json.dumps(sp, ensure_ascii=False))
except Exception as e:
    print('GetSpecialInputs err', e)

for n in names():
    try:
        st = ws.call('GetInputSettings', {'inputName': n})
        if 'wasapi' in st.get('inputKind', ''):
            print(f'  {n} kind={st["inputKind"]} settings={json.dumps(st["inputSettings"], ensure_ascii=False)}')
            print(f'    mute={ws.call("GetInputMute", {"inputName": n})["inputMuted"]} '
                  f'vol={ws.call("GetInputVolume", {"inputName": n})["inputVolumeDb"]}dB')
    except Exception as e:
        print('  查询失败', n, e)

ws.close()
print('完成')
