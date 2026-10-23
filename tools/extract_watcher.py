"""
从 Watcher.pck（GDPC v3）+ 本体 pck-extracted 抽取「观者」全部素材，落盘到 assets/src/。

输入（只读）：
  D:\\SteamLibrary\\steamapps\\workshop\\content\\2868840\\3747492505\\Watcher.pck
  C:\\Users\\shenl\\Desktop\\项目\\STS2-Decompiled\\pck-extracted        （本体反编译资源）

PCK v3 结构（本脚本按 tools/_watcher_review/watcher_pck.txt 核对过）：
  header 40B：magic "GDPC" | pack_version=3 | ver major/minor/patch | flags |
               file_base@0x18(u64) | dir_offset@0x20(u64)
  dir：u32 count，随后逐条
       u32 path_len（含结尾 \\0 与 4 字节对齐 padding） + path
       u64 ofs + u64 size + 16B md5 + u32 flags
  数据绝对偏移 = file_base + ofs。

真图不在 PCK 的源路径里，只有 .import 元数据；按 .import 的
  path="res://.godot/imported/<名>.png-<hash>.ctex"
去 .godot/imported 拿 ctex。ctex 是 Godot GST2 容器，内嵌一份无损 RIFF WebP，
切出来 PIL 直接解码（与 tools/extract_all_portraits.py 的 probe_image 同一范式）。

产出（文件名固定，Lead 的 tools/build.py 依赖）：
  assets/src/art_<id>.png   9 张：1000x760（等比缩放 + 居中裁切）
      talk_to_the_hand / alpha / beta / omega / wish / prostrate /
      become_almighty / fame_and_fortune / live_forever
  assets/src/pw_*.png       6 个 power 图标（PNG 带透明，保留原始分辨率）
  assets/src/sp_*.png       4 个 VFX：
      sp_eye_anim（7 帧横排整条，不拆）/ sp_big_blur / sp_glow_spark / sp_coin

用法：
  python tools/extract_watcher.py             # 全量抽取
  python tools/extract_watcher.py --list eye  # 只列出 PCK 中匹配关键字的条目
"""
import io
import os
import re
import struct
import sys

from PIL import Image

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_SRC = os.path.join(ROOT, "assets", "src")
REPORT = os.path.join(ROOT, "tools", "_watcher_review", "extract_watcher_report.txt")

WATCHER_PCK = r"D:\SteamLibrary\steamapps\workshop\content\2868840\3747492505\Watcher.pck"
BASE_DIR = r"C:\Users\shenl\Desktop\项目\STS2-Decompiled\pck-extracted"

ART_SIZE = (1000, 760)

# ---- 9 张卡图（id, 源 .import 在 PCK 里的路径）----
# wish 的源图叫 wish_watcher.png；beta/omega 是阿尔法卡的衍生单位卡，mod 里有独立立绘。
ART_JOBS = [
    ("talk_to_the_hand",   "Watcher/images/card_portraits/talk_to_the_hand.png.import"),
    ("alpha",              "Watcher/images/card_portraits/alpha.png.import"),
    ("beta",               "Watcher/images/card_portraits/beta.png.import"),
    ("omega",              "Watcher/images/card_portraits/omega.png.import"),
    ("wish",               "Watcher/images/card_portraits/wish_watcher.png.import"),
    ("prostrate",          "Watcher/images/card_portraits/prostrate.png.import"),
    ("become_almighty",    "Watcher/images/card_portraits/become_almighty.png.import"),
    ("fame_and_fortune",   "Watcher/images/card_portraits/fame_and_fortune.png.import"),
    ("live_forever",       "Watcher/images/card_portraits/live_forever.png.import"),
]

# ---- 6 个 Power/姿态图标（输出名, 来源("pck"|"base"), 源 .import 相对路径）----
POWER_JOBS = [
    ("pw_block_return", "pck", "Watcher/images/powers/block_return_power.png.import"),
    ("pw_mantra",       "pck", "Watcher/images/powers/mantra_power.png.import"),
    ("pw_plated_armor", "pck", "Watcher/images/powers/plated_armor_power.png.import"),
    ("pw_divinity",     "pck", "Watcher/images/powers/divinity_stance.png.import"),
    ("pw_omega",        "pck", "Watcher/images/powers/omega_power.png.import"),
    # 力量图标本体反编译里就有（观者「力大无穷」直接复用）
    ("pw_strength",     "base", "images/powers/strength_power.png.import"),
]

# ---- VFX（输出名, 源 .import）----
VFX_JOBS = [
    ("sp_eye_anim",   "Watcher/images/vfx/eye_anim.png.import"),
    ("sp_big_blur",   "Watcher/images/vfx/big_blur.png.import"),
    ("sp_glow_spark", "Watcher/images/vfx/glow_spark.png.import"),
]

# ---- 金币（许愿「名利双收」的抛物金币；挑一枚最清楚的，裁掉透明留白）----
COIN_CANDIDATES = [
    "images/vfx/vfx_coin_explosion/coin_explosion_coin.png.import",
    "images/packed/vfx/coin_flip_anim.png.import",
    "images/relics/old_coin.png.import",
]

# .import 里可能是 path= / path.s3tc= / path.bptc= / path.etc2_astc= 多条，全部收进来按序试
REMAP_RE = re.compile(r'^path(?:\.[A-Za-z0-9_]+)?="res://([^"]+)"', re.M)


# ====================================================================== PCK

class Pck:
    """GDPC v3 包：只读解析目录 + 按路径取文件字节。"""

    def __init__(self, path):
        self.path = path
        self.raw = open(path, "rb").read()
        magic, ver, vmaj, vmin, vpatch, flags = struct.unpack_from("<4sIIIII", self.raw, 0)
        if magic != b"GDPC":
            raise ValueError("不是 GDPC 包: %s (magic=%r)" % (path, magic))
        if ver != 3:
            raise ValueError("只支持 GDPC v3，实际 v%d: %s" % (ver, path))
        self.version = (vmaj, vmin, vpatch)
        self.flags = flags
        self.file_base = struct.unpack_from("<Q", self.raw, 0x18)[0]
        self.dir_off = struct.unpack_from("<Q", self.raw, 0x20)[0]
        self.entries = {}          # path -> (abs_offset, size)
        self._parse_dir()

    def _parse_dir(self):
        n = struct.unpack_from("<I", self.raw, self.dir_off)[0]
        pos = self.dir_off + 4
        for _ in range(n):
            plen = struct.unpack_from("<I", self.raw, pos)[0]
            if not (0 < plen < 4096):
                raise ValueError("目录损坏：path_len=%d @%d" % (plen, pos))
            name = self.raw[pos + 4:pos + 4 + plen].split(b"\x00", 1)[0].decode("utf-8")
            pos += 4 + plen
            ofs, size = struct.unpack_from("<QQ", self.raw, pos)
            pos += 16 + 16 + 4          # u64 ofs + u64 size + md5(16) + u32 flags
            self.entries[name] = (self.file_base + ofs, size)

    def read(self, name):
        off, size = self.entries[name]
        return self.raw[off:off + size]

    def find(self, needle):
        return sorted(n for n in self.entries if needle in n)


# ====================================================================== ctex

def decode_ctex(blob):
    """GST2 容器 -> 内嵌 RIFF(WebP/PNG) -> PIL RGBA；失败返回 None。"""
    if not blob:
        return None
    if blob[:4] == b"GST2":
        idx = blob.find(b"RIFF")
        if idx < 0:
            return None
        blob = blob[idx:]
    if blob[:4] != b"RIFF" and blob[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    try:
        im = Image.open(io.BytesIO(blob))
        im.load()
        return im.convert("RGBA")
    except Exception:
        return None


def _stem_of_import(import_path):
    """".../talk_to_the_hand.png.import" -> "talk_to_the_hand"。"""
    base = os.path.basename(import_path)
    if base.endswith(".import"):
        base = base[:-len(".import")]
    return os.path.splitext(base)[0]


# ---- VRAM 压缩 ctex 的纯 Python 解码（S3TC/BC1-BC3） ----
# VRAM 压缩贴图没有内嵌 RIFF，块数据直接跟在 52 字节头后面。
# 头部实测（Godot 4.5 导入产物）：
#   GST2 | u32 ver@4 | u32 w@8 | u32 h@12 | ... | u32 format@48 | 块数据@52
# format（Godot Image::Format）：17=DXT1(BC1) 18=DXT3(BC2) 19=DXT5(BC3)
# 已与 tools/bake/out 里 Godot headless 解出的 focus_power 逐像素核对：最大误差 1。
_VRAM_HEADER = 52
_VRAM_FORMATS = {17: ("BC1", 8), 18: ("BC2", 16), 19: ("BC3", 16)}


def _rgb565(v):
    r = (v >> 11) & 0x1F
    g = (v >> 5) & 0x3F
    b = v & 0x1F
    return ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2))


def _bc_color(block, allow_cut):
    """8 字节颜色块 -> (rgb(4,4,3) float, alpha(4,4) float)。"""
    c0 = int(block[0]) | (int(block[1]) << 8)
    c1 = int(block[2]) | (int(block[3]) << 8)
    bits = int.from_bytes(bytes(block[4:8]), "little")
    p0 = np.array(_rgb565(c0), np.float32)
    p1 = np.array(_rgb565(c1), np.float32)
    if allow_cut and c0 <= c1:      # BC1 三色 + 透明模式
        pal = np.stack([p0, p1, (p0 + p1) / 2.0, np.zeros(3, np.float32)])
        avals = np.array([255, 255, 255, 0], np.float32)
    else:                            # DXT3/DXT5 颜色块恒为四色插值
        pal = np.stack([p0, p1, (2 * p0 + p1) / 3.0, (p0 + 2 * p1) / 3.0])
        avals = np.full(4, 255.0, np.float32)
    idx = np.array([(bits >> (2 * k)) & 3 for k in range(16)], np.int32)
    return pal[idx].reshape(4, 4, 3), avals[idx].reshape(4, 4)


def _bc3_alpha(block):
    a0, a1 = int(block[0]), int(block[1])
    bits = int.from_bytes(bytes(block[2:8]), "little")
    if a0 > a1:
        vals = [a0, a1] + [((7 - k) * a0 + k * a1) / 7.0 for k in range(1, 7)]
    else:
        vals = ([a0, a1] + [((5 - k) * a0 + k * a1) / 5.0 for k in range(1, 5)]
                + [0.0, 255.0])
    vals = np.array(vals, np.float32)
    idx = np.array([(bits >> (3 * k)) & 7 for k in range(16)], np.int32)
    return vals[idx].reshape(4, 4)


def _bc2_alpha(block):
    vals = np.array([(int(block[k // 2]) >> (4 * (k % 2))) & 0xF
                     for k in range(16)], np.float32) * 17.0
    return vals.reshape(4, 4)


def decode_vram_ctex(blob):
    """VRAM 压缩 ctex -> RGBA；不支持的格式（如 BPTC/BC7）返回 None。"""
    if not blob or blob[:4] != b"GST2" or len(blob) < _VRAM_HEADER + 8:
        return None
    w, h = struct.unpack_from("<II", blob, 8)
    fmt = struct.unpack_from("<I", blob, 48)[0]
    if fmt not in _VRAM_FORMATS or not (w and h):
        return None
    kind, bsize = _VRAM_FORMATS[fmt]
    bx, by = (w + 3) // 4, (h + 3) // 4
    if len(blob) < _VRAM_HEADER + bx * by * bsize:
        return None
    data = np.frombuffer(blob, dtype=np.uint8, count=bx * by * bsize,
                         offset=_VRAM_HEADER).reshape(by * bx, bsize)
    out = np.zeros((by * 4, bx * 4, 4), np.float32)
    for n in range(by * bx):
        blk = data[n]
        j, i = divmod(n, bx)
        if kind == "BC1":
            rgb, a = _bc_color(blk[:8], True)
        elif kind == "BC2":
            rgb, _ = _bc_color(blk[8:16], False)
            a = _bc2_alpha(blk[:8])
        else:
            rgb, _ = _bc_color(blk[8:16], False)
            a = _bc3_alpha(blk[:8])
        out[j * 4:j * 4 + 4, i * 4:i * 4 + 4, :3] = rgb
        out[j * 4:j * 4 + 4, i * 4:i * 4 + 4, 3] = a
    im = Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), "RGBA")
    return im.crop((0, 0, w, h))


def decode_any(blob):
    """先试内嵌 RIFF（无损导入），失败再试 S3TC 块解码。"""
    im = decode_ctex(blob)
    if im is not None:
        return im
    return decode_vram_ctex(blob)


def pck_image(pck, import_path):
    """按 PCK 内 .import 的 remap 路径取 ctex 并解码。返回 (image, ctex_name, note)。"""
    notes = []
    txt = ""
    if import_path in pck.entries:
        txt = pck.read(import_path).decode("utf-8", "replace")
    else:
        notes.append("PCK 无 %s" % import_path)

    cands = [m.group(1).replace("res://", "", 1) for m in REMAP_RE.finditer(txt)]
    # 兜底：按源图基名在 .godot/imported 里找（防止 remap 行缺失/换 hash）
    stem = _stem_of_import(import_path)
    pat = re.compile(r"(^|/)%s\.(png|jpg|jpeg|webp)-[0-9a-f]+\.ctex$"
                     % re.escape(stem))
    cands += [n for n in sorted(pck.entries) if pat.search(n)]
    seen = set()
    for c in cands:
        if c in seen or c not in pck.entries:
            continue
        seen.add(c)
        im = decode_any(pck.read(c))
        if im is not None:
            return im, c, "; ".join(notes)
        notes.append("ctex 解码失败 %s" % c)
    return None, None, "; ".join(notes) or "未找到 ctex"


def disk_image(base_dir, import_rel):
    """本体 pck-extracted：读磁盘 .import -> .godot/imported/*.ctex 解码。"""
    imp = os.path.join(base_dir, import_rel.replace("/", os.sep))
    if not os.path.isfile(imp):
        return None, None, "缺 .import: %s" % imp
    txt = open(imp, "r", encoding="utf-8", errors="replace").read()
    notes = []
    cands = [os.path.join(base_dir, m.group(1).replace("res://", "", 1)
                          .replace("/", os.sep))
             for m in REMAP_RE.finditer(txt)]
    stem = _stem_of_import(import_rel)
    imp_dir = os.path.join(base_dir, ".godot", "imported")
    if os.path.isdir(imp_dir):
        pat = re.compile(r"^%s\.(png|jpg|jpeg|webp)-[0-9a-f]+\.ctex$" % re.escape(stem))
        cands += [os.path.join(imp_dir, f) for f in sorted(os.listdir(imp_dir))
                  if pat.match(f)]
    for c in cands:
        if not os.path.isfile(c):
            notes.append("缺 ctex: %s" % c)
            continue
        im = decode_any(open(c, "rb").read())
        if im is not None:
            return im, c, "; ".join(notes)
        notes.append("ctex 解码失败 %s" % os.path.basename(c))
    return None, None, "; ".join(notes) or "未找到 ctex"


# ====================================================================== 图像处理

def fit_cover(im, size):
    """等比缩放至完全覆盖 size，再居中裁切（KEEP_ASPECT_COVERED）。"""
    tw, th = size
    k = max(tw / im.width, th / im.height)
    nw, nh = max(tw, int(round(im.width * k))), max(th, int(round(im.height * k)))
    im2 = im.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - tw) // 2, (nh - th) // 2
    return im2.crop((left, top, left + tw, top + th))


def pick_coin_frame(im):
    """金币图可能是单枚，也可能是横排动画条：按 4:3 以内的格子切，挑可见面积最大的
    一帧（翻转动画里刀刃朝前那几帧细长，正对镜头那帧最圆最清楚），再裁透明留白。"""
    w, h = im.size
    frames = []
    n = max(1, int(round(w / float(h)))) if h else 1
    if n >= 2 and 2 <= n <= 16:
        fw = w / float(n)
        for i in range(n):
            frames.append(im.crop((int(round(i * fw)), 0,
                                   int(round((i + 1) * fw)), h)))
    else:
        frames = [im]
    best, best_score = None, -1
    for f in frames:
        bb = f.getchannel("A").getbbox()
        if not bb:
            continue
        score = (bb[2] - bb[0]) * (bb[3] - bb[1])   # 可见面积
        if score > best_score:
            best, best_score = f, score
    if best is None:
        return None, len(frames)
    bb = best.getchannel("A").getbbox()
    return best.crop(bb), len(frames)


# ====================================================================== 主流程

def main():
    args = sys.argv[1:]
    if args and args[0] == "--list":
        pck = Pck(WATCHER_PCK)
        needle = args[1] if len(args) > 1 else ""
        for n in pck.find(needle):
            print("%8d  %s" % (pck.entries[n][1], n))
        print("共 %d 条 / 匹配 %s = %d" % (len(pck.entries), repr(needle),
                                           len(pck.find(needle))))
        return 0

    os.makedirs(OUT_SRC, exist_ok=True)
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    report = []

    def log(s):
        print(s)
        report.append(s)

    log("== Watcher.pck ==")
    pck = Pck(WATCHER_PCK)
    log("pck: %s  godot %d.%d.%d  flags=%d  file_base=%d  dir_off=%d  条目=%d"
        % (WATCHER_PCK, pck.version[0], pck.version[1], pck.version[2],
           pck.flags, pck.file_base, pck.dir_off, len(pck.entries)))

    # ---------- 1) 9 张卡图 ----------
    log("\n== art_*.png（%dx%d）==" % ART_SIZE)
    art_fail = []
    for cid, imp_path in ART_JOBS:
        im, ctex_name, note = pck_image(pck, imp_path)
        if im is None:
            log("[FAIL] art_%s  源=%s  %s" % (cid, imp_path, note))
            art_fail.append(cid)
            continue
        src_size = im.size
        out = fit_cover(im, ART_SIZE)
        dst = os.path.join(OUT_SRC, "art_%s.png" % cid)
        out.save(dst)
        log("  art_%-20s src=%-9s -> %s  %s   (%s)"
            % (cid, "%dx%d" % src_size, out.size, os.path.basename(dst), ctex_name))
        if note:
            log("        备注: %s" % note)

    # ---------- 2) 6 个 power 图标 ----------
    log("\n== pw_*.png（Power 图标，PNG+Alpha）==")
    pw_fail = []
    for name, whence, rel in POWER_JOBS:
        if whence == "pck":
            im, src_name, note = pck_image(pck, rel)
        else:
            im, src_name, note = disk_image(BASE_DIR, rel)
        if im is None:
            log("[FAIL] %s  源=%s  %s" % (name, rel, note))
            pw_fail.append(name)
            continue
        dst = os.path.join(OUT_SRC, name + ".png")
        im.save(dst)
        log("  %-16s src=%-9s -> %s   (%s)"
            % (name, "%dx%d" % im.size, os.path.basename(dst),
               os.path.basename(src_name or "")))

    # ---------- 3) VFX 精灵 ----------
    log("\n== sp_*.png（VFX）==")
    sp_fail = []
    for name, rel in VFX_JOBS:
        im, src_name, note = pck_image(pck, rel)
        if im is None:
            log("[FAIL] %s  源=%s  %s" % (name, rel, note))
            sp_fail.append(name)
            continue
        dst = os.path.join(OUT_SRC, name + ".png")
        im.save(dst)
        log("  %-16s src=%-9s -> %s   (%s)"
            % (name, "%dx%d" % im.size, os.path.basename(dst),
               os.path.basename(src_name or "")))

    # 金币：优先 coin_explosion_coin；失败逐个退到候选
    coin_done = False
    for rel in COIN_CANDIDATES:
        im, src_name, note = disk_image(BASE_DIR, rel)
        if im is None:
            log("  金币候选不可用 %-55s %s" % (rel, note))
            continue
        coin, nframes = pick_coin_frame(im)
        if coin is None:
            log("  金币候选全透明 %s" % rel)
            continue
        dst = os.path.join(OUT_SRC, "sp_coin.png")
        coin.save(dst)
        log("  sp_coin          源=%s  帧数=%d 裁切后=%dx%d -> sp_coin.png   (%s)"
            % ("%dx%d" % im.size, nframes, coin.size[0], coin.size[1],
               os.path.basename(src_name or "")))
        coin_done = True
        break
    if not coin_done:
        log("[FAIL] sp_coin  所有候选都不可用")
        sp_fail.append("sp_coin")

    # ---------- 汇总 ----------
    log("\n== 汇总 ==")
    log("art: %d/9%s" % (len(ART_JOBS) - len(art_fail),
                        ("  失败: " + ", ".join(art_fail)) if art_fail else ""))
    log("pw : %d/6%s" % (len(POWER_JOBS) - len(pw_fail),
                        ("  失败: " + ", ".join(pw_fail)) if pw_fail else ""))
    log("sp : %d/4%s" % (3 - len([x for x in sp_fail if x != "sp_coin"])
                        + (1 if coin_done else 0),
                        ("  失败: " + ", ".join(sp_fail)) if sp_fail else ""))
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n报告: %s" % REPORT)

    fails = art_fail + pw_fail + sp_fail
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
