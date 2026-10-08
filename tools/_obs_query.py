# -*- coding: utf-8 -*-
"""查 OBS 当前状态：输出名、音频输入、编码器参数回读。用法：python tools/_obs_query.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
from _obs_setup import WS, WS_CFG

with open(WS_CFG, encoding='utf-8') as f:
    cfg = json.load(f)

ws = WS(port=cfg['server_port'], password=cfg['server_password'])
out = {}
for t, data in (
    ('GetProfileList', None),
    ('GetSceneCollectionList', None),
    ('GetSceneList', None),
    ('GetVideoSettings', None),
    ('GetInputList', None),
    ('GetSpecialInputs', None),
    ('GetRecordDirectory', None),
):
    try:
        out[t] = ws.call(t, data)
    except Exception as e:
        out[t] = f'ERR {e}'

# 输出设置要带 outputName，先把输出名列出来
try:
    outs = ws.call('GetOutputList')
    out['GetOutputList'] = outs
    for o in outs.get('outputs', []):
        try:
            out['settings:' + o['outputName']] = ws.call('GetOutputSettings',
                                                         {'outputName': o['outputName']})
        except Exception as e:
            out['settings:' + o['outputName']] = f'ERR {e}'
except Exception as e:
    out['GetOutputList'] = f'ERR {e}'

# 编码器参数回读（确认 CQP 等真的写进去了）
for cat, name in (('AdvOut', 'RecEncoder'), ('AdvOut', 'RecFormat2'), ('AdvOut', 'RecFilePath'),
                  ('AdvOut', 'Encoder'), ('AdvOut', 'RecType')):
    try:
        out[f'{cat}.{name}'] = ws.call('GetProfileParameter',
                                       {'parameterCategory': cat, 'parameterName': name})
    except Exception as e:
        out[f'{cat}.{name}'] = f'ERR {e}'

ws.close()
print(json.dumps(out, ensure_ascii=False, indent=2))
