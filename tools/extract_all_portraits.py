"""
STS2 卡图全量提取（阶段 1·源图抽取）：把反编译工程里【全部正式立绘】抽成 PNG。

    输入  <反编译>/pck-extracted/images/packed/card_portraits/<角色>/<卡名>.png.import
    输出  tools/_sts2/card_portraits/<角色>__<卡名>.png + manifest.csv

要点（与 tools/extract_assets.py 同一条链路，已验证过 22 张在用卡）：
  * 目录里只有 *.png.import 元数据，真图在 <反编译>/pck-extracted/.godot/imported/*.ctex，
    由 .import 的 path= 指过去（不猜 hash，元数据是权威来源）；
  * .ctex 是 Godot 的 GST2 容器，内嵌一份无损 WebP（RIFF....WEBP），切出来即可被 PIL 解码。
    ⚠ 章节布景那种 VRAM 压缩的 .ctex 没内嵌图，probe 会返回 None —— 但立绘全部有内嵌图。

  * <角色>/beta/ 子目录是【占位/草图立绘】（低分辨率、量化色 24~50、有的是亮色占位框），
    根目录下的 beta.png / ancient_beta.png 同理，一律跳过（--with-beta 才抽）。
  * 中文卡名从 <反编译>/pck-extracted/localization/zhs/cards.json 的 <卡名大写>.title 取。
  * "本项目已用" 标记从 tools/extract_assets*.py 的 JOBS 表解析，避免与真源脱节。

用法：
    python tools/extract_all_portraits.py                 # 默认路径，抽 623 张左右
    python tools/extract_all_portraits.py --out D:/xxx    # 换输出目录
    python tools/extract_all_portraits.py --sts <pck-extracted 路径>
    python tools/extract_all_portraits.py --with-beta     # 连 beta 占位图一起抽
"""
import csv
import glob
import io
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_STS = os.path.join("C:" + os.sep, "Users", "shenl", "Desktop",
                           "\u9879\u76ee", "STS2-Decompiled", "pck-extracted")
DEFAULT_OUT = os.path.join(ROOT, "tools", "_sts2", "card_portraits")

PORTRAITS_REL = "images/packed/card_portraits"
MANIFEST = "manifest.csv"

# 与 extract_assets.py 一致：.import 里 path="res://..." 指到真资源
REMAP_RE = re.compile(r'^path="res://([^"]+)"', re.M)


# ---------------------------------------------------------------- 基础件

def find_sts(explicit):
    """定位 pck-extracted：给了路径就用，否则在桌面下（含一层子目录）找。"""
    if explicit:
        base = os.path.abspath(explicit)
        return base if os.path.isdir(os.path.join(base, PORTRAITS_REL.replace("/", os.sep))) else None
    desk = os.path.join(os.path.expanduser("~"), "Desktop")
    for pat in (os.path.join(desk, "*"), os.path.join(desk, "*", "*")):
        for d in sorted(glob.glob(pat)):
            if os.path.isdir(os.path.join(d, "pck-extracted")):
                return os.path.join(d, "pck-extracted")
    return None


def resolve_ctexs(sts, rel):
    """源资源名（可省扩展名）→ .import → .ctex 绝对路径列表。与 extract_assets.resolve_ctex 同逻辑。"""
    base = os.path.join(sts, rel.replace("/", os.sep))
    imp = None
    for cand in (base + ".import", base + ".png.import", base, base + ".png"):
        if cand.endswith(".import") and os.path.isfile(cand):
            imp = cand
            break
    if not imp:
        return []
    txt = open(imp, "r", encoding="utf-8").read()
    return [os.path.join(sts, m.group(1).replace("/", os.sep)) for m in REMAP_RE.finditer(txt)]


def probe_image(ctex_path):
    """从 GST2 容器里切出内嵌 RIFF(WebP) 并解码。失败返回 None（含 VRAM 压缩贴图）。"""
    try:
        raw = open(ctex_path, "rb").read()
    except OSError:
        return None
    if raw[:4] != b"GST2":
        return None
    idx = raw.find(b"RIFF")
    if idx < 0:
        return None
    try:
        im = Image.open(io.BytesIO(raw[idx:]))
        im.load()
        return im.convert("RGBA")
    except Exception:
        return None


def fetch(sts, rel):
    """抽一张源图，多个 ctex 变体时取面积最大的（与 extract_assets.fetch 同口径）。"""
    found = []
    for c in resolve_ctexs(sts, rel):
        if not os.path.isfile(c):
            continue
        im = probe_image(c)
        if im is not None:
            found.append((im.size[0] * im.size[1], im, os.path.basename(c)))
    if not found:
        return None
    found.sort(key=lambda r: r[0], reverse=True)
    _, im, name = found[0]
    return im, name


# ---------------------------------------------------------------- 辅助信息

def load_titles(sts):
    """本地化里的 <ID>.title → {ID: 中文名}；文件不在就返回空表（不报错）。"""
    out = {}
    for rel in ("localization/zhs/cards.json", "localization/zhs/cards.zhs.json"):
        p = os.path.join(sts, rel.replace("/", os.sep))
        if not os.path.isfile(p):
            continue
        try:
            data = json.load(open(p, "r", encoding="utf-8"))
        except Exception as e:
            print("  !! 本地化解析失败 %s: %s" % (rel, e))
            continue
        for k, v in data.items():
            if k.endswith(".title") and isinstance(v, str):
                out[k[:-6].upper()] = v
        if out:
            break
    return out


def used_sources():
    """从 tools/extract_assets*.py 的 JOBS 表里解析本项目已抽过的 card_portraits 源路径。

    返回 {(规范化源路径, 产物名)}；源路径统一去掉结尾的 ".png"（磁盘上是 <卡名>.png.import，
    而 JOBS 表写的是不带扩展名的 <卡名>）。"""
    def norm(s):
        return s[:-4] if s.endswith(".png") else s

    used = set()
    for p in sorted(glob.glob(os.path.join(ROOT, "tools", "extract_assets*.py"))):
        txt = open(p, "r", encoding="utf-8").read()
        for m in re.finditer(r'\(\s*"(images/packed/card_portraits/[^"]+)"\s*,\s*"([^"]+)"\s*\)', txt):
            used.add((norm(m.group(1)).lower(), m.group(2)))
    return used


def is_beta(parts):
    """beta/占位图判定：任一路段叫 beta、以 _beta 结尾，或就叫 beta。

    ⚠ 段尾可能带着 ".png"（磁盘上是 <卡名>.png.import），所以先剥掉再比。
    根目录的 beta.png / ancient_beta.png、以及各角色目录下直接躺着的 beta.png
    都是同类占位图（本地化里查不到 BETA 这张卡），一并跳过。"""
    for seg in parts:
        s = seg[:-len(".png")] if seg.endswith(".png") else seg
        if s == "beta" or s.endswith("_beta"):
            return True
    return False


def norm_src(s):
    """源路径归一：磁盘上是 <卡名>.png.import，JOBS 表里是不带扩展名的 <卡名>。"""
    return s[:-4] if s.endswith(".png") else s


# ---------------------------------------------------------------- 主流程

def main():
    args = sys.argv[1:]
    explicit_sts = None
    out_dir = DEFAULT_OUT
    with_beta = False
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--sts":
            i += 1
            explicit_sts = args[i]
        elif a == "--out":
            i += 1
            out_dir = os.path.abspath(args[i])
        elif a == "--with-beta":
            with_beta = True
        else:
            print("未知参数: %s" % a)
            print(__doc__)
            return 2
        i += 1

    sts = find_sts(explicit_sts)
    if not sts:
        print("!! 找不到 pck-extracted（试过 --sts 与桌面扫描）：%s" % explicit_sts)
        return 1
    port_root = os.path.join(sts, PORTRAITS_REL.replace("/", os.sep))
    out_dir = out_dir if os.path.isabs(out_dir) else os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    print("反编译目录: %s" % sts)
    print("立绘目录  : %s" % port_root)
    print("输出目录  : %s" % out_dir)
    print("beta 占位图: %s\n" % ("抽取" if with_beta else "跳过"))

    titles = load_titles(sts)
    used = used_sources()
    if titles:
        print("本地化卡名: %d 条" % len(titles))
    if used:
        print("本项目已用: %d 个源路径（来自 tools/extract_assets*.py）\n" % len(used))

    # 枚举：一级目录（角色）下的 *.png.import；根目录下的散文件角色记作 "root"
    jobs = []
    for dirpath, _dirnames, filenames in os.walk(port_root):
        for fn in filenames:
            if not fn.endswith(".png.import"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, sts).replace(os.sep, "/")[:-len(".import")]
            parts = rel[len(PORTRAITS_REL) + 1:].split("/")
            group = parts[0] if len(parts) > 1 else "root"
            card = parts[-1][:-len(".png")]
            jobs.append((rel, group, card))

    total = len(jobs)
    skipped = 0
    rows = []
    fails = []
    written = set()
    nbytes = 0

    for n, (rel, group, card) in enumerate(sorted(jobs), 1):
        if not with_beta and is_beta(rel.split("/")):
            skipped += 1
            continue
        got = fetch(sts, rel)
        if got is None:
            fails.append(rel)
            print("[FAIL] %s" % rel)
            continue
        im, ctex_name = got
        dst_name = "%s__%s" % (group, card)
        dst = os.path.join(out_dir, dst_name + ".png")
        try:
            im.save(dst, "PNG")
        except OSError as e:
            fails.append(rel)
            print("[FAIL 写盘] %s: %s" % (dst, e))
            continue
        size = os.path.getsize(dst)
        nbytes += size
        written.add(dst_name + ".png")
        rows.append({
            "file": dst_name + ".png",
            "group": group,
            "card": card,
            "title_zhs": titles.get(card.upper(), ""),
            "used": "yes" if any(norm_src(rel).lower() == s for s, _a in used) else "",
            "width": im.size[0],
            "height": im.size[1],
            "bytes": size,
            "ctex": ctex_name,
            "src": rel,
        })
        if n % 100 == 0 or n == total:
            print("  ... %d/%d  （已写入 %d 张）" % (n, total, len(rows)))

    # 清理上一次留下的残留（改了过滤规则、或源目录删了图时，输出目录不会凭空少文件）
    stale = []
    for p in sorted(glob.glob(os.path.join(out_dir, "*.png"))):
        if os.path.basename(p) not in written:
            stale.append(os.path.basename(p))
            os.remove(p)
    if stale:
        print("清理残留 PNG: %d 个（%s%s）" % (len(stale), ", ".join(stale[:8]),
                                            " …" if len(stale) > 8 else ""))

    # manifest.csv：utf-8-sig，Excel/WPS 直接打开中文不乱码
    mf = os.path.join(out_dir, MANIFEST)
    with open(mf, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["file", "group", "card", "title_zhs", "used",
                                          "width", "height", "bytes", "ctex", "src"])
        w.writeheader()
        w.writerows(rows)

    print("\n===== 汇总 =====")
    print("发现 .import : %d（其中 beta/占位 %d，%s）" % (total, skipped, "跳过" if not with_beta else "已抽"))
    print("成功抽出    : %d 张" % len(rows))
    print("失败        : %d" % len(fails))
    for r in fails:
        print("   FAIL %s" % r)
    print("manifest    : %s（%d 行）" % (mf, len(rows)))
    print("总体积      : %.1f MB" % (nbytes / 1048576.0))
    sizes = {}
    for r in rows:
        sizes["%dx%d" % (r["width"], r["height"])] = sizes.get("%dx%d" % (r["width"], r["height"]), 0) + 1
    print("尺寸分布    : %s" % ", ".join("%s ×%d" % (k, v) for k, v in sorted(sizes.items(), key=lambda kv: -kv[1])))
    groups = {}
    for r in rows:
        groups[r["group"]] = groups.get(r["group"], 0) + 1
    print("分组        : %s" % ", ".join("%s %d" % (k, v) for k, v in sorted(groups.items(), key=lambda kv: -kv[1])))
    print("本项目已用  : %d 张" % sum(1 for r in rows if r["used"] == "yes"))
    print("有中文卡名  : %d 张" % sum(1 for r in rows if r["title_zhs"]))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
