"""把 STS2 原版战斗曲解出来 -> 叠加多轨 -> 取中段做「无缝循环」-> 转 Ogg Vorbis。

为什么要取中段 + 交叉淡化：
  原曲（章节主战）有 4 分钟，而我们把它内联进单文件 HTML，全长度会让产物爆到 30MB+。
  做法是每首只取 ~45 秒，并在头部把「后面本该接上的那 3 秒」交叉混进来，
  这样 Web Audio 的 loop=true 播放时接缝是连续波形，听不出断点。

改长度 / 质量只动下面 N_SEG / XFADE / VORBIS_Q 三个常量。

产出：assets/bgm/<id>.ogg
"""
import os
import struct
import subprocess
import wave

import numpy as np
import pyvgmstream as v

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r"C:\Users\shenl\Desktop\new"
BANK_DIR = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted\banks\desktop"
CACHE = os.path.join(HERE, "banks")
OUT_DIR = os.path.join(ROOT, "assets", "bgm")
TMP = os.path.join(HERE, "_tmp_bgm")

N_SEG = 50.0        # 每首循环片段的长度（秒）
XFADE = 3.0         # 接缝交叉淡化长度（秒）
VORBIS_Q = 0        # ffmpeg libvorbis -q:a 0 ≈ 64kbps

FFMPEG = r"C:\Users\shenl\AppData\Local\Programs\Python\Python311\Scripts\ffmpeg.exe"

# id: (显示名, [(bank, 曲目名), ...])   —— 多个曲目名 = 同时发声的层，相加还原完整混音
TRACKS = [
    # ---- 章节主战曲（单曲，直接可用） ----
    ("combat_overgrowth_a", "翠蔓林地 · 主战一", [("act1_a1.bank", "STS2_Overgrowth_1-A_Combat_v2")]),
    ("combat_overgrowth_b", "翠蔓林地 · 主战二", [("act1_a2.bank", "STS2_Overgrowth_1-B_Combat_v2")]),
    ("combat_underdocks", "下城区 · 主战", [("act1_b1.bank", "STS2_Underdocks_1b-A_Combat_v2-2")]),
    ("combat_hive_a", "蜂巢 · 主战一", [("act2_a1.bank", "STS2_Hive_2-A_Combat_v4")]),
    ("combat_hive_b", "蜂巢 · 主战二", [("act2_a2.bank", "STS2_Hive_2-A2_Combat_v5")]),
    ("combat_glory_a", "荣光 · 主战一", [("act3_a1.bank", "STS2_Glory_3-A_Combat_v1")]),
    ("combat_glory_b", "荣光 · 主战二", [("act3_a2.bank", "STS2_Glory_3-B_v2_Combat")]),

    # ---- 精英战曲 ----
    ("elite_overgrowth", "翠蔓林地 · 精英", [("act1_a1.bank", "STS2_Overgrowth_Elite_v2")]),
    ("elite_underdocks", "下城区 · 精英", [("act1_b1.bank", "sts2_1b_elite_v3")]),
    ("elite_hive", "蜂巢 · 精英", [("act2_a1.bank", "STS2_Hive_Elite_v1")]),
    ("elite_glory", "荣光 · 精英", [("act3_a2.bank", "STS2_Glory_Elite_Scientists_v1")]),

    # ---- Boss 曲 ----
    # 仪式巨兽：A1/B1/C1 是三段先后段，取第一段
    ("boss_ceremonial_beast", "仪式巨兽",
     [("act1_a1.bank", "STS2_A1_Boss_CeremonialBeast_A1_v2")]),
    # 族群：主曲 + 鼓组两层同长叠回完整混音
    ("boss_the_kin", "族群",
     [("act1_a1.bank", "STS2_Overgrowth_Boss_Kin_v2"),
      ("act1_a1.bank", "STS2_Overgrowth_Boss_Kin_Drums_v2")]),
    # 范托姆：A2/A3/A4 是先后段，取最长的 A3
    ("boss_vantom", "范托姆", [("act1_a1.bank", "STS2_A1_Boss_Vantom_A3_v4")]),
    ("boss_soul_fysh", "灵魂鱼", [("act1_b1.bank", "STS2_Underdocks_SoulFysh_v4_full")]),
    # 瀑布巨人：7 层同长竖切层，去掉 KO（战败）层后相加
    ("boss_waterfall_giant", "瀑布巨人",
     [("act1_b1.bank", "STS2_Underdocks_Boss_WaterfallGiant_v3_Layer1_base"),
      ("act1_b1.bank", "STS2_Underdocks_Boss_WaterfallGiant_v3_Layer2_choir"),
      ("act1_b1.bank", "STS2_Underdocks_Boss_WaterfallGiant_v3_Layer3"),
      ("act1_b1.bank", "STS2_Underdocks_Boss_WaterfallGiant_v3_Layer4"),
      ("act1_b1.bank", "STS2_Underdocks_Boss_WaterfallGiant_v3_Layer5"),
      ("act1_b1.bank", "STS2_Underdocks_Boss_WaterfallGiant_v3_Layer6"),
      ("act1_b1.bank", "STS2_Underdocks_Boss_WaterfallGiant_v3_Layer_ChoirHigh")]),
    # 帝王蟹：phase1 的 centre/left/right 三层是同一段的三路拆分，相加即完整；phase2 是狂暴版不取
    ("boss_kaiser_crab", "帝王蟹",
     [("act2_a1.bank", "STS2_Hive_Boss_KaiserCrab_v9_phase1_centre"),
      ("act2_a1.bank", "STS2_Hive_Boss_KaiserCrab_v9_phase1_left"),
      ("act2_a1.bank", "STS2_Hive_Boss_KaiserCrab_v9_phase1_right")]),
    ("boss_knowledge_demon", "知识恶魔",
     [("act2_a1.bank", "STS2_A2_Boss_KnowledgeDemon_v2_CombatLayer"),
      ("act2_a1.bank", "STS2_A2_Boss_KnowledgeDemon_v4_SubLayer")]),
    ("boss_the_insatiable", "饕餮",
     [("act2_a1.bank", "STS2_Hive_Boss_Insaitable_v2_Layer1"),
      ("act2_a1.bank", "STS2_Hive_Boss_Insaitable_v2_Layer2"),
      ("act2_a1.bank", "STS2_Hive_Boss_Insaitable_v2_Layer3"),
      ("act2_a1.bank", "STS2_Hive_Boss_Insaitable_v2_Layer4"),
      ("act2_a1.bank", "STS2_Hive_Boss_Insaitable_v2_Layer5")]),
    # 女王：A1/B1 是先后段，取 A1
    ("boss_the_queen", "女王", [("act3_a1.bank", "STS2_A3_Boss_TheQueen_A1_v1")]),
    # 实验体：A1/B1/C1 是先后段，取 A1
    ("boss_test_subject", "实验体", [("act3_a1.bank", "STS2_Glory_TestSubject_v1_A1")]),
]


def fsb_of(bank):
    """原始 bank 是 RIFF/FEV 包着 FSB5，切出裸 FSB5 缓存起来。"""
    d = open(os.path.join(BANK_DIR, bank), "rb").read()
    i = d.find(b"FSB5")
    _, num, shdr, namesz, datasz, _ = struct.unpack("<IIIIII", d[i + 4:i + 28])
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, bank + ".fsb")
    if not os.path.exists(out):
        open(out, "wb").write(d[i:i + 60 + shdr + namesz + datasz])
    return out


_names_cache = {}


def names_of(fsb):
    if fsb not in _names_cache:
        d = open(fsb, "rb").read()
        num, shdr = struct.unpack("<II", d[8:16])
        p = 60 + shdr
        offs = struct.unpack("<%dI" % num, d[p:p + 4 * num])
        out = []
        for o in offs:
            s = p + o
            out.append(d[s:d.index(b"\0", s)].decode("utf-8", "replace"))
        _names_cache[fsb] = out
    return _names_cache[fsb]


def render(fsb, name):
    """解一层为 float32 [n, ch]。"""
    idx = names_of(fsb).index(name) + 1
    st = v.open_stream(fsb, subsong=idx,
                       config=v.DecodeConfig(sample_format=v.SampleFormat.FLOAT))
    ch, sr = st.channels, st.sample_rate
    chunks = []
    while not st.done:
        b = st.read_frames(65536)
        if b:
            chunks.append(np.frombuffer(b, dtype="<f4"))
    st.close()
    a = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    a = a[:len(a) // ch * ch].reshape(-1, ch)
    return a, sr, ch


def mix(layers):
    """把同长多层相加；长度不一致时按最短对齐。声道数不同则单声道复制成双声道。"""
    arrs = []
    for bank, name in layers:
        a, sr, ch = render(fsb_of(bank), name)
        if ch == 1:
            a = np.repeat(a, 2, axis=1)
        arrs.append(a)
    n = min(len(a) for a in arrs)
    out = np.zeros((n, arrs[0].shape[1]), dtype=np.float64)
    for a in arrs:
        # 多轨叠加容易爆表，按层数等比降增益
        out += a[:n] / max(1.0, len(arrs) ** 0.5)
    return out.astype(np.float32), arrs[0].shape[1], sr


def seamless_loop(x, sr, n_seg, xfade):
    """取中段 + 首尾交叉淡化，得到可无缝循环的一段。"""
    n = int(n_seg * sr)
    nx = int(xfade * sr)
    total = len(x)
    if total <= n + nx + 1:
        return x
    start = int(min(max(5.0 * sr, total * 0.25), total - n - nx - 1))
    seg = x[start:start + n].astype(np.float64).copy()
    nxt = x[start + n:start + n + nx].astype(np.float64)
    # 用「等功率」交叉淡化而不是线性：接缝两侧的音乐基本不相关，
    # 线性淡化会在接缝处凹一个 -6dB 的坑，等功率（sin/cos）才是听感上等响的。
    t = np.linspace(0.0, 1.0, nx, dtype=np.float64)[:, None]
    g_in = np.sin(t * np.pi / 2)
    g_out = np.cos(t * np.pi / 2)
    seg[:nx] = nxt * g_out + seg[:nx] * g_in
    return seg.astype(np.float32)


def write_wav(path, x, sr):
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak > 1e-9:
        x = x * (0.97 / peak)
    pcm = np.clip(x * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    total = 0
    for tid, label, layers in TRACKS:
        x, ch, sr = mix(layers)
        seg = seamless_loop(x, sr, N_SEG, XFADE)
        wav = os.path.join(TMP, tid + ".wav")
        write_wav(wav, seg, sr)
        ogg = os.path.join(OUT_DIR, tid + ".ogg")
        subprocess.run([FFMPEG, "-y", "-v", "error", "-i", wav,
                        "-c:a", "libvorbis", "-q:a", str(VORBIS_Q), ogg], check=True)
        size = os.path.getsize(ogg)
        total += size
        print("  %-22s %-14s %4.1fs -> %6.1f KB   (%d 层 %dch %dHz)" % (
            tid, label, len(seg) / sr, size / 1024, len(layers), ch, sr))
    print("\n合计 %.2f MB / %d 首" % (total / 1048576, len(TRACKS)))


if __name__ == "__main__":
    main()
