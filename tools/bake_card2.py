"""
按《杀戮尖塔2》反编译工程的真实资源与节点布局，合成 5 张稀有卡。

依据（全部来自反编译工程）：
  scenes/cards/card.tscn        —— 各图层在卡面上的坐标/尺寸/拉伸模式
  Core/Models/CardModel.cs      —— 各图层用哪张图、哪个材质
  materials/cards/frames/*.tres —— 卡框配色（按角色）
  materials/cards/banners/card_banner_rare_mat.tres —— 缎带/铭牌/卡图内框配色（按稀有度）
  shaders/hsv.gdshader          —— 配色算法（YIQ 空间线性变换，逐像素复刻）

坐标系：card.tscn 里的 offset 以卡面中心为原点、单位是"场景单位"。
卡框 Frame 矩形 = 300 x 422 场景单位，其贴图 card_frame_* 为 598 x 844 px，
故 场景单位 -> 贴图像素 的缩放 = (598/300, 844/422)。

用法: python tools/bake_card2.py
"""
import io
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = r"C:\Users\shenl\Desktop\new"
BAKE = os.path.join(ROOT, "tools", "bake")
SRC = os.path.join(ROOT, "assets", "src")
OUT = os.path.join(ROOT, "assets", "baked")
PREVIEW = os.path.join(ROOT, "tools", "预览图")

ATLAS0 = os.path.join(BAKE, "atlas0.png")
ATLAS1 = os.path.join(BAKE, "atlas1.png")

# ---- 图集切片（取自 images/atlases/ui_atlas.sprites/card/*.tres 的 region） ----
FRAME_REGION = {
    "attack": (ATLAS0, (1320, 83, 598, 844)),
    "skill": (ATLAS0, (1221, 929, 598, 844)),
    "power": (ATLAS0, (621, 929, 598, 844)),
}
BORDER_REGION = {
    "attack": (ATLAS1, (1329, 1, 551, 420)),
    "skill": (ATLAS1, (1313, 423, 551, 420)),
    "power": (ATLAS1, (674, 148, 551, 420)),
}
BANNER_REGION = (ATLAS1, (674, 1, 653, 145))

# ---- 配色（materials/cards/frames/*_mat.tres 的 h/s/v） ----
FRAME_HSV = {
    "red": (0.025, 0.85, 1.0),
    "green": (0.32, 0.45, 1.2),
    "orange": (0.12, 1.5, 1.2),
    "pink": (0.965, 0.55, 1.2),
    "blue": (0.55, 0.9, 1.0),
    "colorless": (1.0, 0.0, 1.2),   # 无色/衍生 token 卡（card_frame_colorless_mat.tres）
}
# card_banner_rare_mat.tres / uncommon / common（按稀有度）
RARE_HSV = (0.563, 1.198, 1.14)
UNCOMMON_HSV = (1.0, 1.0, 1.0)        # 原色（蓝）
COMMON_HSV = (1.0, 0.0, 0.85)         # 去饱和（灰）
RARITY_HSV = {"rare": RARE_HSV, "uncommon": UNCOMMON_HSV, "common": COMMON_HSV}

# ---- card.tscn 布局：以卡面中心为原点的场景单位矩形 (l, t, r, b) ----
SCENE_W, SCENE_H = 300.0, 422.0
CANVAS_W, CANVAS_H = 598, 844
SX = CANVAS_W / SCENE_W          # 1.99333
SY = CANVAS_H / SCENE_H          # 2.0
CX, CY = CANVAS_W / 2.0, CANVAS_H / 2.0

LAYOUT = {
    "portrait":       (-125.0, -168.0, 125.0, 22.0),
    "portraitBorder": (-137.5, -164.0, 137.5, 46.0),
    "banner":         (-163.0, -207.0, 164.0, -124.0),
    "title":          (-105.0, -204.0, 105.0, -150.0),
    "plaque":         (-30.5, 1.0, 30.5, 38.0),
}

# ---- 缎带摆放（以官方截图实测拟合为准；card.tscn 的矩形与截图有出入） ----
BANNER = {"x": -1, "y": 26, "w": 598, "h": 128}

# ---- 卡名微调（画布px，负 = 上移） ----
# 用户口径（第 4 轮）：缎带尺寸与官方有出入，不必强行对齐墨迹中心，按手感调。
#   -7（原位）→ -14（"往上挪一点"）→ 偏高 → 回调到 -10
TITLE_DY = -10.0
TITLE_SIZE = 48         # 原 52，用户口径：字号调小一点点
TITLE_OUTLINE = 6       # 用户口径：字要细，但深色描边要更粗（细字 + 厚边）

# ---- 类型铭牌文字 ----
# 实测（官方截图，598x844 坐标系）：
#   官方 墨迹高 28.2px、墨迹/牌面积 0.102
#   我方 墨迹高 37.0px、墨迹/牌面积 0.347  -> 明显偏大偏粗
# 故而：字号 44 -> 34，字重由 黑体粗 降为 常规。
TYPE_SIZE = 34

# ---- 卡面描述文字（用户提供的新文案，替换掉原先那两句"意境"介绍） ----
# 位置不靠猜：以官方卡面截图实测为准（tools/measure_desc.py）：
#   官方「描述文字」墨迹框  x 126..443（宽 317）  y 592..660（高 68，2 行）
#   文字色 meanRGB(218,210,194) ≈ #dad2c2 ；底色 meanRGB(87,68,73) → 暗底浅字
# 故文字区取「横向以卡面中心 299 居中、宽 440（≈11 字/行）」，
# 纵向块中心对准官方实测的 cy = 626。
# 换行位置是「人工定好的」：\n 处必然断行，避免自动折行把词切开（如"闪/电球"）。
# 字号 40 时一行约放得下 10 个汉字。
DESC = {
    "dark_embrace":    "在场地边缘生成恶魔之手\n拖拽敌人。",
    "knife_trap":      "相撞时引导所有未命中的\n匕首攻击敌人。",
    "beat_into_shape": "每次反弹时铸造君王之剑\n以提升伤害。",
    "end_of_days":     "召唤陨石随机攻击，\n留下陨石坑施加灾厄。",
    "voltaic":         "召唤并发射数量翻倍的\n闪电球充能球。",
    # ---- 新 10 张 ----
    "pillage":          "蓄力撞击命中时立即\n释放下一击，前摇与\n伤害提高。",
    "expose":           "发射光束造成伤害和\n易伤，反射的光束\n效力减弱。",
    "charge":           "消耗生命召唤仆从作战，\n本体状态越差\n仆从越英勇。",
    "sleight_of_flesh": "根据转盘方向在撞击时\n施加负面效果。",
    "darkness":         "召唤暗黑充能球攻击，\n成长并激发已有\n充能球。",
    "perfected_strike": "以黄金夹角137.5度\n相撞时造成巨额暴击。",
    "snakebite":        "蛰伏在墙上积蓄毒液，\n扑击时施放剧毒。",
    "guiding_star":     "吸引辉星造成伤害、\n治疗自身。",
    "defy":             "撞击边缘时释放\n附带虚弱的冲击。",
    "lightning_rod":    "召唤雷电命中较高单位，\n闪电给予自身集中，\n增加伤害和攻速。",
    # ---- token 衍生卡 ----
    "minion_dive":      "造成50点伤害。",
    # ---- 5 张测试版新卡（设置里开「测试版卡牌」才显示） ----
    "offering":       "献祭大量生命，召唤一张\n随机卡牌作为友军作战。",
    # 余像：第 7 轮用户改的文案（格挡改成"每次分身重置为 20"、且自身受伤时分身失效）
    "afterimage":     "惩罚击中分身的敌人，\n自身受伤时分身失效。",
    "tracking":       "撞击边缘时引导君王之剑\n向碰撞点冲刺。",
    "soul_storm":     "召唤脆弱的灵魂，\n灵魂消亡后引发\n并加强风暴。",
    "meteor_strike":  "收集三颗等离子球，\n降下巨型陨石轰击\n敌人。",
    # ---- 召唤物/衍生卡（不进选卡界面，游戏内小单位外观） ----
    # 灵魂：灵魂风暴召出来的小单位。**必须带卡框+缎带**（用户明确要求），
    # 所以走和其它卡一样的完整六层合成，只是做成 token 配色 + 普通（灰）稀有度。
    "soul":           "迅速消亡，碰撞敌人时\n造成少量伤害\n直接消亡。",
    "plasma":         "被收集后降下陨石。",
}
DESC_BOX = (79.0, 505.0, 519.0, 747.0)   # 文字区（正好夹在类型铭牌与卡底之间）
DESC_SIZE = 40                            # 起始字号（放不下会自动收）
DESC_LINE_RATIO = 1.30                    # 行距 = 字号 × 该值
DESC_COLOR = (222, 214, 198, 255)
DESC_OUTLINE = (30, 22, 36, 200)
DESC_OUTLINE_W = 3                        # 加一圈深色描边，暗底上也清楚
DESC_MAX_LINES = 3

# 折行时的标点规则：不让这些标点跑到行首 / 行尾
_NO_LINE_START = "。，、；：！？）」』》…,.!?;:)]}%"
_NO_LINE_END = "（「『《(【["

# ---- 卡图窗（由卡框贴图的透明连通区实测得来；原画正好铺满） ----
# 见 tools/probe_window.py：attack/skill 为 500x380，power 为 496x376
WINDOW = {
    "attack": (47, 84, 500, 380),
    "skill": (47, 84, 500, 380),
    "power": (49, 86, 496, 376),
}

# ---- 卡图内框（金色环）摆放 ----
# 可见外沿的宽度以官方截图实测为准（x 28.5..565.7 -> 宽 537.2）；
# 纵向沿用 card.tscn 的换算结果（可见顶边 y≈98）。
RING = {"vis_x": 28.5, "vis_y": 98.0, "vis_w": 537.2}

# ---- 15 张卡（选卡界面从左到右、从上到下的顺序，即三行各 5 张）----
# 稀有度：第一排稀有（金）、第二排罕见（蓝/原色）、第三排普通（灰）
CARDS = [
    # id, 名称, 类型中文, 帧类型, 角色配色, 稀有度, 原画文件
    # -- 第一行（老 5 张）--
    ("dark_embrace",   "黑暗之拥", "能力", "power",  "red",    "rare",     "art_dark_embrace.png"),
    ("knife_trap",     "刀刃陷阱", "技能", "skill",  "green",  "rare",     "art_knife_trap.png"),
    ("beat_into_shape", "锻打成型", "攻击", "attack", "orange", "rare",     "art_beat_into_shape.png"),
    ("end_of_days",    "末日降临", "技能", "skill",  "pink",   "rare",     "art_end_of_days.png"),
    ("voltaic",        "电流相生", "技能", "skill",  "blue",   "rare",     "art_voltaic.png"),
    # -- 第二行（新 5 张，罕见）--
    ("pillage",         "劫掠",     "攻击", "attack", "red",    "uncommon", "art_pillage.png"),
    ("expose",          "暴露",     "技能", "skill",  "green",  "uncommon", "art_expose.png"),
    ("charge",          "冲锋！！",  "技能", "skill",  "orange", "uncommon", "art_charge.png"),
    ("sleight_of_flesh", "血肉戏法", "能力", "power",  "pink",   "uncommon", "art_sleight_of_flesh.png"),
    ("darkness",        "漆黑",     "技能", "skill",  "blue",   "uncommon", "art_darkness.png"),
    # -- 第三行（新 5 张，普通）--
    ("perfected_strike", "完美打击", "攻击", "attack", "red",    "common",   "art_perfected_strike.png"),
    ("snakebite",       "蛇咬",     "技能", "skill",  "green",  "common",   "art_snakebite.png"),
    ("guiding_star",    "引导之星", "攻击", "attack", "orange", "common",   "art_guiding_star.png"),
    ("defy",            "违逆",     "技能", "skill",  "pink",   "common",   "art_defy.png"),
    ("lightning_rod",   "引雷针",   "技能", "skill",  "blue",   "common",   "art_lightning_rod.png"),
    # -- 第四行（测试版新 5 张，稀有；设置里开「测试版卡牌」才出现在选卡界面）--
    ("offering",        "祭品",     "技能", "skill",  "red",    "rare",     "art_offering.png"),
    ("afterimage",      "余像",     "能力", "power",  "green",  "rare",     "art_afterimage.png"),
    # ⚠ 追踪之刃 = SeekingEdge（Regent/橙/能力），不是 Silent 的 Tracking（「跟踪」）
    ("tracking",        "追踪之刃", "能力", "power",  "orange", "rare",     "art_seeking_edge.png"),
    ("soul_storm",      "灵魂风暴", "攻击", "attack", "pink",   "rare",     "art_soul_storm.png"),
    ("meteor_strike",   "陨石打击", "攻击", "attack", "blue",   "rare",     "art_meteor_strike.png"),
]

# 测试版新卡（不进正式选卡列表，除非设置里开了「测试版卡牌」）
TEST_CARD_IDS = ["offering", "afterimage", "tracking", "soul_storm", "meteor_strike"]

# ---- 游戏内的衍生小单位/召唤物卡面（不进选卡界面）----
# 和主卡一样走完整的六层合成 —— 用户明确要求灵魂"要装上对应的卡框、缎带之类的"。
TOKENS = [
    # id, 名称, 类型中文, 帧类型, 帧配色, 稀有度, 原画文件
    # 灵魂：Necrobinder 是粉，但 token 卡在原版里用「无色」卡框（灰白）+ 普通稀有度
    ("soul",   "灵魂",   "技能", "skill", "colorless", "common", "art_soul.png"),
]
# 冲锋的「仆从俯冲」早就在用（老 token），一并放在这里统一烘
ALL_TOKENS = TOKENS + [
    ("minion_dive", "仆从俯冲", "攻击", "attack", "colorless", "common", "art_minion_dive.png"),
]

# 字体：标题用粗体黑体系；类型铭牌用常规字重（官方铭牌字明显更细）
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\Dengb.ttf",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simsun.ttc",
]
# 常规字重（越靠前越细）：微软雅黑常规 -> 等线 -> 宋体
FONT_REGULAR_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\Deng.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]


def pick_font(cands=FONT_CANDIDATES):
    for p in cands:
        if os.path.isfile(p):
            return p
    return None


def scene_rect(key):
    """场景矩形 -> 画布像素矩形 (x0, y0, x1, y1)，浮点。"""
    l, t, r, b = LAYOUT[key]
    return (CX + l * SX, CY + t * SY, CX + r * SX, CY + b * SY)


def region(path, box):
    """box 为图集 region = (x, y, w, h)。"""
    x, y, w, h = box
    return Image.open(path).convert("RGBA").crop((x, y, x + w, y + h))


# ------------------------------------------------------------------
# hsv.gdshader 的逐像素复刻
# ------------------------------------------------------------------
_M_YIQ = np.array([[0.2989, 0.5870, 0.1140],
                   [0.5959, -0.2774, -0.3216],
                   [0.2115, -0.5229, 0.3114]], dtype=np.float64)
_M_YIQ_INV = np.linalg.inv(_M_YIQ)


def hsv_shader(im, h=1.0, s=1.0, v=1.0):
    """完全按 shaders/hsv.gdshader 的算法给整图着色（含 alpha 保留）。"""
    arr = np.asarray(im.convert("RGBA"), dtype=np.float64) / 255.0
    rgb = arr[..., :3]

    yiq = rgb @ _M_YIQ.T                       # col.rgb = RGB_to_YIQ * col.rgb

    hue = (1.0 - h) * 2.0 * math.pi
    ch, sh = math.cos(hue), math.sin(hue)
    # GLSL mat3(vec3(1,0,0), vec3(0,cos,-sin), vec3(0,sin,cos)) 是列主序，
    # 且 v * M 等价于 M^T * v，两次转置后作用矩阵为：
    rot = np.array([[1.0, 0.0, 0.0],
                    [0.0, ch, -sh],
                    [0.0, sh, ch]], dtype=np.float64)
    yiq = yiq @ rot.T

    yiq = yiq * np.array([1.0, s, s])           # sat_shift
    yiq = yiq * v                               # mix(black, rgb, v)

    rgb = yiq @ _M_YIQ_INV.T

    out = np.empty_like(arr)
    out[..., :3] = np.clip(rgb, 0.0, 1.0)
    out[..., 3] = arr[..., 3]
    return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGBA")


def paste(canvas, im, box, cover=False):
    """把 im 按 box 归一化后贴到 canvas 上。

    cover=False -> 等比缩放至完全放入（KEEP_ASPECT_CENTERED），其余留空
    cover=True  -> 等比缩放至完全覆盖后居中裁切（KEEP_ASPECT_COVERED）
    返回实际贴合矩形。
    """
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    bw, bh = x1 - x0, y1 - y0
    iw, ih = im.size
    if cover:
        k = max(bw / iw, bh / ih)
    else:
        k = min(bw / iw, bh / ih)
    nw, nh = max(1, int(round(iw * k))), max(1, int(round(ih * k)))
    im2 = im.resize((nw, nh), Image.LANCZOS)
    ox = x0 + (bw - nw) // 2
    oy = y0 + (bh - nh) // 2
    canvas.alpha_composite(im2, (ox, oy))
    return (ox, oy, nw, nh)


def draw_center_text(canvas, text, box, font_path, size, fill,
                     outline=None, outline_w=0, shadow=None, shadow_off=(0, 0),
                     pad=0):
    """在 box 中央绘制一行文本（自动按 box 宽度收缩字号）。"""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    avail_w = max(1, (x1 - x0) - pad * 2)
    f = None
    for sz in range(int(size), 6, -1):
        cand = ImageFont.truetype(font_path, sz)
        tw = cand.getbbox(text)[2] - cand.getbbox(text)[0]
        if tw <= avail_w:
            f = cand
            break
    if f is None:
        f = ImageFont.truetype(font_path, 8)

    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    bb = d.textbbox((0, 0), text, font=f, stroke_width=outline_w or 0)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    tx = (x0 + x1) / 2.0 - tw / 2.0 - bb[0]
    ty = (y0 + y1) / 2.0 - th / 2.0 - bb[1]

    if shadow is not None:
        d.text((tx + shadow_off[0], ty + shadow_off[1]), text, font=f,
               fill=shadow)
    if outline is not None and outline_w:
        d.text((tx, ty), text, font=f, fill=fill, stroke_width=outline_w,
               stroke_fill=outline)
    else:
        d.text((tx, ty), text, font=f, fill=fill)
    canvas.alpha_composite(layer)
    return tx, ty, tw, th


def text_w(font, s):
    if not s:
        return 0
    bb = font.getbbox(s)
    return bb[2] - bb[0]


def wrap_cn(text, font, max_w):
    """折行：先按文案里人工写好的 \\n 断行；某一段仍超宽时再按像素自动折行
    （优先断在标点之后，且不让标点落在行首）。"""
    lines = []
    for para in text.split("\n"):
        cur = ""
        for ch in para:
            if cur and text_w(font, cur + ch) > max_w:
                cut = len(cur)
                # 行内偏后处若有标点，优先断在标点之后（读起来更自然）
                for i in range(len(cur) - 1, max(0, int(len(cur) * 0.55)) - 1, -1):
                    if cur[i] in "。，、；：！？":
                        cut = i + 1
                        break
                while cut < len(cur) and cur[cut] in _NO_LINE_START:
                    cut += 1
                while cut > 1 and cur[cut - 1] in _NO_LINE_END:
                    cut -= 1
                lines.append(cur[:cut])
                cur = cur[cut:]
            cur += ch
        if cur:
            lines.append(cur)
    return [l for l in lines if l]


def fit_desc(text, font_path, max_w, size_max):
    """从 size_max 往下试字号，取第一个能折成 <= DESC_MAX_LINES 行的。"""
    for sz in range(int(size_max), 18, -1):
        f = ImageFont.truetype(font_path, sz)
        ls = wrap_cn(text, f, max_w)
        if len(ls) <= DESC_MAX_LINES:
            return f, ls
    f = ImageFont.truetype(font_path, 19)
    return f, wrap_cn(text, f, max_w)


def draw_desc(canvas, text, box, font_path, size, fill, outline, ow):
    """把描述文字折行后「整体居中」画进 box（水平居中 + 块中心与 box 中心重合）。"""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    f, ls = fit_desc(text, font_path, x1 - x0, size)
    lh = max(f.size + 4, int(round(f.size * DESC_LINE_RATIO)))
    total = lh * len(ls)
    cy = (y0 + y1) / 2.0

    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i, ln in enumerate(ls):
        bb = d.textbbox((0, 0), ln, font=f, stroke_width=ow or 0)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        slot = cy - total / 2.0 + i * lh            # 本行所在槽位的顶边
        tx = (x0 + x1) / 2.0 - tw / 2.0 - bb[0]
        ty = slot + lh / 2.0 - th / 2.0 - bb[1]
        d.text((tx, ty), ln, font=f, fill=fill,
               stroke_width=ow or 0, stroke_fill=outline)
    canvas.alpha_composite(layer)
    return ls


def build_card(cid, name, type_cn, ftype, color, rarity, art_file, font_path,
               font_type=None, draw_title=True, draw_type=True):
    rar_hsv = RARITY_HSV[rarity]
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))

    # 1) 卡面原画：正好铺满卡框上的透明卡图窗（窗的宽高比 = 原画宽高比）
    art = Image.open(os.path.join(SRC, art_file)).convert("RGBA")
    wx, wy, ww, wh = WINDOW[ftype]
    canvas.alpha_composite(art.resize((ww, wh), Image.LANCZOS), (wx, wy))

    # 2) 卡框（含下半部文字区底）：按角色配色
    fp, fbox = FRAME_REGION[ftype]
    frame = hsv_shader(region(fp, fbox), *FRAME_HSV[color])
    canvas.alpha_composite(frame, (0, 0))

    # 3) 卡图内边框（按稀有度）：按"可见外沿"对齐，自动扣掉贴图透明留白
    bp, bbox = BORDER_REGION[ftype]
    border = hsv_shader(region(bp, bbox), *rar_hsv)
    ab = border.getchannel("A").getbbox()
    vis_w, vis_h = ab[2] - ab[0], ab[3] - ab[1]
    k = RING["vis_w"] / vis_w
    border = border.resize((max(1, round(border.size[0] * k)),
                            max(1, round(border.size[1] * k))), Image.LANCZOS)
    canvas.alpha_composite(border, (round(RING["vis_x"] - ab[0] * k),
                                    round(RING["vis_y"] - ab[1] * k)))

    # 4) 标题缎带（按稀有度）
    #    位置/尺寸以用户给的官方截图实测拟合（见 tools/measure_banner2.py）：
    #    缎带整条横跨卡宽 598、顶边落在 y=26、高 128。
    #    card.tscn 里 TitleBanner 的矩形(327x83 场景单位 + KEEP_ASPECT_COVERED)
    #    与截图实测不符，这里以截图为准。
    rp, rbox = BANNER_REGION
    banner = hsv_shader(region(rp, rbox), *rar_hsv)
    canvas.alpha_composite(banner.resize((BANNER["w"], BANNER["h"]), Image.LANCZOS),
                           (BANNER["x"], BANNER["y"]))

    # 5) 类型铭牌（按稀有度）+ 类型文字
    plaque = hsv_shader(
        Image.open(os.path.join(SRC, "plaque2.png")).convert("RGBA"), *rar_hsv)
    paste(canvas, plaque, scene_rect("plaque"), cover=False)
    if draw_type:
        draw_center_text(canvas, type_cn, scene_rect("plaque"),
                         font_type or font_path, size=TYPE_SIZE,
                         fill=(58, 40, 16, 255), pad=4)

    # 6) 卡名（奶油色 + 深色描边）；用常规字重 + 上移 TITLE_DY
    if draw_title:
        tb = scene_rect("title")
        tb = (tb[0], tb[1] + TITLE_DY, tb[2], tb[3] + TITLE_DY)
        draw_center_text(canvas, name, tb, font_type or font_path,
                         size=TITLE_SIZE, fill=(255, 246, 226, 255),
                         outline=(77, 75, 64, 255), outline_w=TITLE_OUTLINE,
                         shadow=(0, 0, 0, 70), shadow_off=(2, 3))

    # 7) 卡牌描述文字：填进卡面下半部的空白文字区（居中、自动折行）
    txt = DESC.get(cid)
    if txt:
        lines = draw_desc(canvas, txt, DESC_BOX, font_type or font_path,
                          DESC_SIZE, DESC_COLOR, DESC_OUTLINE, DESC_OUTLINE_W)
        print("      描述 %d 行: %s" % (len(lines), " / ".join(lines)))
    return canvas


def main():
    font_path = pick_font()
    font_type = pick_font(FONT_REGULAR_CANDIDATES)
    print("常规字重(卡名+铭牌用):", font_type or "!! 未找到常规字重字体")
    print("兜底字体:", font_path or "!! 未找到中文字体")
    if not font_path:
        return 1
    os.makedirs(OUT, exist_ok=True)

    for cid, name, type_cn, ftype, color, rarity, art_file in CARDS:
        card = build_card(cid, name, type_cn, ftype, color, rarity, art_file,
                          font_path, font_type=font_type)
        full = os.path.join(OUT, "card_%s.png" % cid)
        card.save(full)
        small = card.resize((300, int(round(300 * CANVAS_H / CANVAS_W))),
                            Image.LANCZOS)
        small.save(os.path.join(OUT, "card_%s_300.png" % cid))
        print("  %-18s %s -> %s / 300宽" % (cid, card.size, full))

    # token 衍生卡（不进选卡界面，只做游戏内召唤物小单位的外观）。
    # 定义在文件上方 TOKENS；和主卡走完全相同的六层合成。
    for cid, name, type_cn, ftype, color, rarity, art_file in ALL_TOKENS:
        card = build_card(cid, name, type_cn, ftype, color, rarity, art_file,
                          font_path, font_type=font_type)
        full = os.path.join(OUT, "card_%s.png" % cid)
        card.save(full)
        small = card.resize((300, int(round(300 * CANVAS_H / CANVAS_W))),
                            Image.LANCZOS)
        small.save(os.path.join(OUT, "card_%s_300.png" % cid))
        print("  token %-12s %s -> %s / 300宽" % (cid, card.size, full))

    # 供目视比对的拼版（每行 5 张，自动铺满所有卡）
    per_row = 5
    rows = (len(CARDS) + per_row - 1) // per_row
    sheet = Image.new("RGBA", (300 * per_row + 40, 424 * rows), (18, 16, 24, 255))
    for i, (cid, *_rest) in enumerate(CARDS):
        im = Image.open(os.path.join(OUT, "card_%s_300.png" % cid))
        sheet.alpha_composite(im, ((i % per_row) * 308 + 8, (i // per_row) * 424))
    sheet.save(os.path.join(PREVIEW, "sheet_cards_v2.png"))
    print("拼版:", os.path.join(PREVIEW, "sheet_cards_v2.png"))

    bake_sprites()
    compare_with_reference()
    return 0


# 需要裁掉透明留白后内联的精灵（源 assets/src/sp_*.png -> assets/baked/sp_*.png）
# 【坑】别去跑早期的 tools/bake_assets.py 来补精灵：那个脚本会顺手把卡面按老版
# （没有描述文字）重新写一遍，把这里刚生成的卡面覆盖掉。精灵就在这个脚本里一起出。
SPRITE_CROP = ("sp_demon_hand",)

# 直接拷贝（不裁剪）：冲锋卡的「仆从」用原版 token 卡「仆从俯冲」的卡面原画，
# 游戏里会按圆形裁切绘制。
# （灵魂以前也走这里，但用户要求灵魂必须带卡框/缎带 → 已改走 TOKENS 的完整合成，
#   见 assets/baked/card_soul_300.png）
SPRITE_COPY = [("art_minion_dive", "sp_minion")]


def slice_meteor_rock():
    """vfx_rock_shatter_rock.png 是「4 颗由小到大的岩石横排」的一张图（296x74）。
    取【第 2 大】的那颗（第 3 格）烘成单颗，陨石打击用它当陨石本体。"""
    p = os.path.join(SRC, "sp_meteor_rock.png")
    if not os.path.isfile(p):
        print("!! 缺精灵源:", p)
        return
    im = Image.open(p).convert("RGBA")
    w = im.size[0] // 4
    cell = im.crop((w * 2, 0, w * 3, im.size[1]))
    bb = cell.getbbox()
    if bb:
        cell = cell.crop(bb)
    dst = os.path.join(OUT, "sp_meteor_rock.png")
    cell.save(dst)
    print("  精灵 %-16s %s -> %s" % ("sp_meteor_rock", cell.size, dst))


def bake_sprites():
    for name in SPRITE_CROP:
        p = os.path.join(SRC, name + ".png")
        if not os.path.isfile(p):
            print("!! 缺精灵源:", p)
            continue
        im = Image.open(p).convert("RGBA")
        bb = im.getbbox()
        if bb:
            im = im.crop(bb)
        dst = os.path.join(OUT, name + ".png")
        im.save(dst)
        print("  精灵 %-16s %s -> %s" % (name, im.size, dst))
    for src_name, dst_name in SPRITE_COPY:
        p = os.path.join(SRC, src_name + ".png")
        if not os.path.isfile(p):
            print("!! 缺精灵源:", p)
            continue
        dst = os.path.join(OUT, dst_name + ".png")
        Image.open(p).convert("RGBA").save(dst)
        print("  精灵 %-16s (拷贝) -> %s" % (dst_name, dst))
    slice_meteor_rock()


REF_SHOT = r"C:\Users\shenl\Pictures\Screenshots\屏幕截图 2026-07-22 201251.png"
# 截图里卡框的像素范围（量出来的）与卡面长宽比 598:844
REF_CARD_BOX = (5, 30, 320, 475)


def compare_with_reference(mine="end_of_days"):
    """把用户给的官方截图裁到卡框，与我方同尺寸卡面并排，方便逐像素比对。"""
    if not os.path.isfile(REF_SHOT):
        print("!! 找不到参考截图")
        return
    ref = Image.open(REF_SHOT).convert("RGBA").crop(REF_CARD_BOX)
    ref = ref.resize((CANVAS_W, CANVAS_H), Image.LANCZOS)
    mine_im = Image.open(os.path.join(OUT, "card_%s.png" % mine))

    bg = Image.new("RGBA", (CANVAS_W * 2 + 24, CANVAS_H), (18, 16, 24, 255))
    bg.alpha_composite(ref, (0, 0))
    bg.alpha_composite(mine_im, (CANVAS_W + 24, 0))
    dst = os.path.join(PREVIEW, "compare_ref_%s.png" % mine)
    bg.resize(((CANVAS_W * 2 + 24) * 2 // 3, CANVAS_H * 2 // 3),
              Image.LANCZOS).save(dst)
    print("参考对比:", dst, " (左=官方截图, 右=我方 %s)" % mine)


if __name__ == "__main__":
    raise SystemExit(main())
