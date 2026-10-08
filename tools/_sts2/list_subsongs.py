"""列出所有 bank 里每个子流的 名字 + 时长，用于挑曲。

产出：tools/_sts2/_subsongs.txt
"""
import os
import struct
import sys

import pyvgmstream as v

HERE = os.path.dirname(os.path.abspath(__file__))
BANK_DIR = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted\banks\desktop"
BANKS = ["act1_a1.bank", "act1_a2.bank", "act1_b1.bank",
         "act2_a1.bank", "act2_a2.bank", "act3_a1.bank", "act3_a2.bank"]
CACHE = os.path.join(HERE, "banks")


def slice_fsb(path):
    d = open(path, "rb").read()
    i = d.find(b"FSB5")
    _, num, shdr, namesz, datasz, _ = struct.unpack("<IIIIII", d[i + 4:i + 28])
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, os.path.basename(path) + ".fsb")
    if not os.path.exists(out):
        open(out, "wb").write(d[i:i + 60 + shdr + namesz + datasz])
    return out


def fsb_names(path):
    d = open(path, "rb").read()
    num, shdr = struct.unpack("<II", d[8:16])
    p = 60 + shdr
    offs = struct.unpack("<%dI" % num, d[p:p + 4 * num])
    out = []
    for o in offs:
        s = p + o
        out.append(d[s:d.index(b"\0", s)].decode("utf-8", "replace"))
    return out


rows = []
for bank in BANKS:
    f = slice_fsb(os.path.join(BANK_DIR, bank))
    names = fsb_names(f)
    for i, n in enumerate(names):
        try:
            info = v.probe(f, subsong=i + 1)
            dur = info.duration_seconds
        except Exception as e:  # noqa
            dur = -1
        rows.append((bank, i + 1, n, dur))
        sys.stderr.write(".")
    sys.stderr.write("\n")

rows.sort(key=lambda r: (r[0], -r[3]))
with open(os.path.join(HERE, "_subsongs.txt"), "w", encoding="utf-8") as fh:
    cur = None
    for bank, idx, n, dur in rows:
        if bank != cur:
            cur = bank
            fh.write("\n=== %s ===\n" % bank)
        fh.write("%3d  %7.1fs  %s\n" % (idx, dur, n))
print("done", len(rows))
