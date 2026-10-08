"""FSB5 名字表解析：只读 uint32 偏移表 + 空结尾字符串。"""
import struct
import sys
import os
import glob

def parse(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'FSB5', d[:4]
    version, num, shdr, namesz, datasz, mode = struct.unpack('<IIIIII', d[4:28])
    p_name = 60 + shdr
    names = []
    if namesz:
        offs = struct.unpack('<%dI' % num, d[p_name:p_name + 4 * num])
        for o in offs:
            s = p_name + o
            e = d.index(b'\0', s)
            names.append(d[s:e].decode('utf-8', 'replace'))
    return dict(version=version, num=num, shdr=shdr, namesz=namesz,
                datasz=datasz, mode=mode, names=names,
                data_off=60 + shdr + namesz)

if __name__ == '__main__':
    for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), '*.fsb'))):
        info = parse(f)
        print('== %s  num=%d mode=%d datasz=%d' % (os.path.basename(f), info['num'], info['mode'], info['datasz']))
        for n in info['names']:
            print('   ', n)
