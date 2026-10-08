"""从 STS2 的 FMOD bank（FSB5 / Custom Vorbis）里解出各章节战斗 BGM。

依赖：pyvgmstream（自带 libvorbis）。
用法：python extract_bgm.py
产出：tools/_sts2/bgm/*.wav  （48kHz 立体声 PCM16）
"""
import os
import struct
import wave

import pyvgmstream as v

HERE = os.path.dirname(os.path.abspath(__file__))
BANK_DIR = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted\banks\desktop"
OUT = os.path.join(HERE, "bgm")

# (bank 文件, FSB 内曲目名, 输出名)
TARGETS = [
    ("act1_a1.bank", "STS2_Overgrowth_1-A_Combat_v2", "bgm_overgrowth"),
    ("act1_b1.bank", "STS2_Underdocks_1b-A_Combat_v2-2", "bgm_underdocks"),
    ("act2_a1.bank", "STS2_Hive_2-A_Combat_v4", "bgm_hive"),
    ("act3_a1.bank", "STS2_Glory_3-A_Combat_v1", "bgm_glory"),
]

# 原始 bank 是 RIFF/FEV 包着 FSB5，直接扫 FSB5 魔数取偏移（见 fsb5names.py 的前置步骤）。
def slice_fsb(path, cache_dir):
    d = open(path, "rb").read()
    i = d.find(b"FSB5")
    assert i >= 0, path
    _, num, shdr, namesz, datasz, _ = struct.unpack("<IIIIII", d[i + 4:i + 28])
    os.makedirs(cache_dir, exist_ok=True)
    out = os.path.join(cache_dir, os.path.basename(path) + ".fsb")
    if not os.path.exists(out):
        open(out, "wb").write(d[i:i + 60 + shdr + namesz + datasz])
    return out


def fsb_names(path):
    """按 FSB5 名字表顺序取名字（顺序 == 子流序号 1..N）。"""
    d = open(path, "rb").read()
    assert d[:4] == b"FSB5"
    num, shdr, namesz = struct.unpack("<III", d[8:20])
    p = 60 + shdr
    offs = struct.unpack("<%dI" % num, d[p:p + 4 * num])
    out = []
    for o in offs:
        s = p + o
        e = d.index(b"\0", s)
        out.append(d[s:e].decode("utf-8", "replace"))
    return out


def dump_wav(stream, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ch = stream.channels
    sr = stream.sample_rate
    with wave.open(path, "wb") as w:
        w.setnchannels(ch)
        w.setsampwidth(2)
        w.setframerate(sr)
        while not stream.done:
            pcm = stream.read_pcm16(65536)
            if pcm:
                w.writeframes(pcm)


def main():
    os.makedirs(OUT, exist_ok=True)
    for bank, name, outname in TARGETS:
        bpath = slice_fsb(os.path.join(BANK_DIR, bank), HERE)
        names = fsb_names(bpath)
        if name not in names:
            print("[skip] %s 里找不到 %s" % (bank, name))
            continue
        idx = names.index(name) + 1
        # pyvgmstream 直接读 .bank 也行（它会找到里面的 FSB5）
        info = v.probe(bpath, subsong=idx)
        print("%-46s -> %s  %.1fs  %dch  %dHz  loop=%s[%s,%s]" % (
            name, outname, info.duration_seconds, info.channels,
            info.sample_rate, info.loop_flag, info.loop_start, info.loop_end))
        st = v.open_stream(bpath, subsong=idx,
                           config=v.DecodeConfig(sample_format=v.SampleFormat.PCM16))
        dump_wav(st, os.path.join(OUT, outname + ".wav"))
        st.close()
        print("    -> %s.wav  %.1f MB" % (
            outname, os.path.getsize(os.path.join(OUT, outname + ".wav")) / 1e6))


if __name__ == "__main__":
    main()
