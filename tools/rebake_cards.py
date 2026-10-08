"""
只重烘指定的卡面（不碰其它卡面与精灵）。

背景：tools/bake_card2.py 的 main() 会把 20 张卡 + token 卡 + 精灵 + 官方参考对比
全部重写一遍。只改了一两张卡的描述文案时，没必要（也不该）整批重跑 ——
本脚本复用 bake_card2 的 build_card，只重建指定 id 的
    assets/baked/card_<id>.png
    assets/baked/card_<id>_300.png
最后照常刷新拼版 tools/预览图/sheet_cards_v2.png（用的还是磁盘上现成的 300 宽图）。

⚠ 模板/文案的【唯一真源】仍是 bake_card2.py 的 DESC / CARDS；本脚本只是执行器。

用法: python tools/rebake_cards.py lightning_rod tracking
      python tools/rebake_cards.py            # 默认 = 最后改过文案的那两张
"""
import os
import sys

import bake_card2 as B


DEFAULT_IDS = ["lightning_rod", "tracking"]


def main(argv):
    ids = argv[1:] or DEFAULT_IDS
    font_path = B.pick_font()
    font_type = B.pick_font(B.FONT_REGULAR_CANDIDATES)
    print("常规字重(卡名+铭牌用):", font_type or "!! 未找到常规字重字体")
    print("兜底字体:", font_path or "!! 未找到中文字体")
    if not font_path:
        return 1

    by_id = {c[0]: c for c in B.CARDS}
    missing = [cid for cid in ids if cid not in by_id]
    if missing:
        print("!! CARDS 里没有这些 id:", ", ".join(missing))
        return 1

    os.makedirs(B.OUT, exist_ok=True)
    for cid in ids:
        cid, name, type_cn, ftype, color, rarity, art_file = by_id[cid]
        card = B.build_card(cid, name, type_cn, ftype, color, rarity, art_file,
                            font_path, font_type=font_type)
        full = os.path.join(B.OUT, "card_%s.png" % cid)
        card.save(full)
        small = card.resize((300, int(round(300 * B.CANVAS_H / B.CANVAS_W))),
                            B.Image.LANCZOS)
        small.save(os.path.join(B.OUT, "card_%s_300.png" % cid))
        print("  %-18s %s -> %s / 300宽" % (cid, card.size, full))

    # 刷新拼版（与 bake_card2.main 里的写法一致，每行 5 张）
    per_row = 5
    rows = (len(B.CARDS) + per_row - 1) // per_row
    sheet = B.Image.new("RGBA", (300 * per_row + 40, 424 * rows), (18, 16, 24, 255))
    for i, (cid, *_rest) in enumerate(B.CARDS):
        im = B.Image.open(os.path.join(B.OUT, "card_%s_300.png" % cid))
        sheet.alpha_composite(im, ((i % per_row) * 308 + 8, (i // per_row) * 424))
    dst = os.path.join(B.PREVIEW, "sheet_cards_v2.png")
    sheet.save(dst)
    print("拼版:", dst)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
