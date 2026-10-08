"""
把 src/game.html 与 assets/ 打成一个自包含的单文件 HTML。
- 图片：转 WebP 后内联为 dataURI
- 音频：原始 base64 内联（运行时用 Web Audio 解码）

产出两份（内容同源，只差开发者面板 + 系列赛）：
  杀戮尖塔小球对决.html            —— 正式版（BUILD=main，无「系列赛」入口，也没有系列赛代码）
  杀戮尖塔小球对决_开发者版.html   —— 开发者版（BUILD=dev，额外内联 src/dev.js，含完整系列赛）

用法: python tools/build.py            # 两份都出
      python tools/build.py --main     # 只出正式版
      python tools/build.py --dev      # 只出开发者版
"""
import base64
import io
import json
import os
import re
import sys

from PIL import Image

ROOT = r"C:\Users\shenl\Desktop\new"
SRC_HTML = os.path.join(ROOT, "src", "game.html")
SRC_DEV = os.path.join(ROOT, "src", "dev.js")
BAKED = os.path.join(ROOT, "assets", "baked")
AUDIO = os.path.join(ROOT, "assets", "audio")
OUT_MAIN = os.path.join(ROOT, "杀戮尖塔小球对决.html")
OUT_DEV = os.path.join(ROOT, "杀戮尖塔小球对决_开发者版.html")
# 系列赛入口按钮：源码里用 <!--SERIES_BTN_START-->...<!--SERIES_BTN_END--> 包住，
# 正式版构建时整块删掉（系列赛暂时不对玩家开放），开发者版保留。
# 想恢复正式版入口：注释掉 render() 里那行 SERIES_BTN_RE.sub 即可。
SERIES_BTN_RE = re.compile(r"[ \t]*<!--SERIES_BTN_START-->.*?<!--SERIES_BTN_END-->[ \t]*\n?", re.S)

# 系列赛【逻辑】：正式版整块剔除（开发者版原样保留）。源码里用成对注释标记包住：
#   /* SERIES_LOGIC_START */ … /* SERIES_LOGIC_END */  系列赛逻辑（两处：10.4 主体 + 文件末尾 __series 句柄）
#   /* SERIES_HOOK_START  */ … /* SERIES_HOOK_END  */  主循环里那行 seriesFrame() 调用
#   /* SERIES_BGM_START   */ … /* SERIES_BGM_END   */  系列赛专用 BGM 辅助函数
# 剔除后引擎里散布的 if (SERIES.on) 检查会找不到 SERIES，所以下面补一行恒假常量兜住
#   （SERIES_STUB_ANCHOR 是源码里的锚点，替换点在资源注入之前，必须先做）。
# 想恢复正式版逻辑：注释掉 render() 里那段 “if not dev:” 里的循环即可。
SERIES_TAGS = ["SERIES_LOGIC", "SERIES_HOOK", "SERIES_BGM"]
SERIES_STUB_ANCHOR = "const ASSET_MAP = __ASSET_MAP__;"
SERIES_STUB_DECL = ("var SERIES = { on: false };\n"
                    "/* ↑ 正式版：系列赛逻辑已在构建期整体剔除，这里只留一个恒假开关，\n"
                    "     让引擎里散布的 if (SERIES.on) 检查短路（开发者版见「10.4 系列赛」）。 */\n")
# 系列赛 AI 的内置胜率数据（tools/bake_winrate.js 烘焙）→ 注入 game.html 的 __WR_DATA__
WR_FILE = os.path.join(ROOT, "tools", "bake", "winrate_500.json")

# 图片：卡牌成品 + 游戏用到的精灵
CARD_IDS = ["dark_embrace", "knife_trap", "beat_into_shape", "end_of_days", "voltaic",
            # 新 10 张（第二行 + 第三行，顺序与 CARDS 数组一致）
            "pillage", "expose", "charge", "sleight_of_flesh", "darkness",
            "perfected_strike", "snakebite", "guiding_star", "defy", "lightning_rod",
            # 测试版 5 张（第四行；设置里开「测试版卡牌」才进选卡界面）
            "offering", "afterimage", "tracking", "soul_storm", "meteor_strike",
            # token 衍生卡（不进选卡界面，游戏内召唤物外观）
            "minion_dive",
            # 灵魂：灵魂风暴召出的小单位，和主卡一样带卡框/缎带（用户明确要求）
            "soul"]
SPRITES = ["sp_knife_thrown", "sp_lightning_orb",
           # 恶魔之手：反编译里「夜魇」屏幕特效用的 spooky_hand.png
           "sp_demon_hand",
           # 君王之剑：按反编译 sovereign_blade.tscn 的层级逐个拼装
           "sp_sb_blade", "sp_sb_glow", "sp_sb_shine", "sp_sb_outline",
           "sp_sb_deco", "sp_sb_hilt", "sp_sb_hilt2", "sp_sb_spike",
           # 新 10 张的机制贴图
           "sp_dark_orb",        # 漆黑：暗黑充能球
           "sp_star_small",      # 引导之星：辉星
           "sp_starry_core",     # 引导之星：撞击核心
           "sp_beam_line",       # 暴露：超光束激光线
           "sp_lightning_strike",  # 引雷针：大雷击
           "sp_minion",          # 冲锋：仆从（原版「仆从俯冲」卡面原画）
           # 测试版 5 张的机制贴图
           "sp_plasma_orb",      # 陨石打击：等离子充能球（原版 defect 等离子球）
           "sp_meteor_rock",     # 陨石打击：陨石本体（原版落石特效里那颗岩石）
           "sp_meteor_smoke",    # 陨石打击：轰击烟尘（原版落石特效翻页图）
           "sp_block",           # 余像：格挡护罩
           "pw_vulnerable", "pw_weak", "pw_doom", "pw_focus", "pw_poison",
           "pw_block",           # 能力图标（转盘/徽标/格挡）
           # 角色系统：五个角色的选人头像与计分条小图标
           # （提取自 STS2 选人界面：STS2-ModDev\美术参考\角色\界面图_*\char_select_*.png）
           "char_ironclad", "char_silent", "char_regent", "char_necrobinder", "char_defect",
           "char_icon_ironclad", "char_icon_silent", "char_icon_regent",
           "char_icon_necrobinder", "char_icon_defect"]

# 音频
SOUNDS = [
    "battle_start_1", "blunt_attack", "heavy_attack", "slash_attack", "dagger_throw",
    "card_smith", "card_select", "card_deal", "card_exhaust", "dark_orb_channel",
    "dark_orb_evoke", "doom_apply", "lightning_orb_channel", "lightning_orb_evoke",
    "lightning_orb_passive", "victory", "deny",
    # 测试版新卡：等离子球（陨石打击）与格挡（余像）都有原版真音效
    "plasma_orb_channel", "plasma_orb_evoke", "frost_orb_passive",
]

# 整页战斗背景布景（设置里选）：assets/bg/<名>.png -> ASSET_MAP.bg[名]
# 素材由 tools/_sts2/stage_bg.py + godot_decode 从反编译的 ctex 解出，见 README_开发者版.md
BG_DIR = os.path.join(ROOT, "assets", "bg")
BGS = ["bg_overgrowth", "bg_underdocks", "bg_hive", "bg_glory"]

# 战斗背景音乐（设置里选）：assets/bgm/<id>.ogg -> ASSET_MAP.bgm[id]
# 素材由 tools/_sts2/build_bgm.py 生成（含无缝循环处理），id 必须与 game.html 的 BGM_GROUPS 一致
# 例外：boss_the_heart（1代《The Heart》）为全曲直出，2026-10-08 用户要求，不经 build_bgm.py
BGM_DIR = os.path.join(ROOT, "assets", "bgm")

WEBP_Q = {"card": 86, "sprite": 92, "bg": 78, "ui": 90}

# 原版按钮贴图（游戏内 UI，不是画布内容）：assets/ui/<名>.png -> ASSET_MAP.ui[名]
# 素材由 tools/_sts2/build_ui.py 从反编译的 reward_item_button.png + hsv.gdshader 烘出
UI_DIR = os.path.join(ROOT, "assets", "ui")
UIS = ["btn_rest", "btn_bright"]


def webp_data_uri(path, quality):
    im = Image.open(path).convert("RGBA")
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    b = buf.getvalue()
    return "data:image/webp;base64," + base64.b64encode(b).decode("ascii"), len(b)


DEV_BADGE = ('<style>#buildBadge{margin:0 0 10px;padding:5px 10px;border-radius:8px;'
             'background:#2b2140;border:1px solid #5b5080;color:#c9b6ff;font-size:11px}</style>\n'
             '<div id="buildBadge">开发者版 · 右上角「开发者模式」= 指定种子 / 批量预演 / 标签筛选 / 种子重现 / 水印</div>')


def render(tpl, payload, dev):
    """把 asset 映射 + 构建标记（+ 开发者面板）填进模板。"""
    html = tpl
    if "__ASSET_MAP__" not in html:
        print("!! 模板里找不到 __ASSET_MAP__ 占位")
        return None
    # 正式版：剔除系列赛（逻辑整块 + 主循环钩子 + 专用 BGM + 入口按钮），并补一个恒假 SERIES。
    # 必须在 __ASSET_MAP__ 替换之前做 —— 兜底常量的锚点就是那一行。
    if not dev:
        if SERIES_STUB_ANCHOR not in html:
            print("!! 找不到系列赛兜底锚点（%s），正式版可能因缺 SERIES 而报错" % SERIES_STUB_ANCHOR)
        else:
            html = html.replace(SERIES_STUB_ANCHOR, SERIES_STUB_DECL + SERIES_STUB_ANCHOR)
        for tag in SERIES_TAGS:
            pat = r"[ \t]*/\* %s_START \*/.*?/\* %s_END \*/[ \t]*\n?" % (tag, tag)
            html, n = re.subn(pat, "", html, flags=re.S)
            if n == 0:
                print("!! 系列赛标记 %s 没匹配到（源码标记被改名？）" % tag)
            else:
                print("   剔除系列赛代码块 %-14s ×%d" % (tag, n))
        html = SERIES_BTN_RE.sub("", html)
    html = html.replace("__ASSET_MAP__", payload)
    # 内置胜率数据（系列赛 AI 的"公认常识"，玩家不可见）。缺文件就注入 null：
    # 游戏照样能跑，AI 退化成不看数据（wrRate 一律 0.5）。
    if os.path.isfile(WR_FILE):
        with open(WR_FILE, "r", encoding="utf-8") as f:
            wr = f.read().strip()
    else:
        wr = "null"
        print("!! 缺胜率数据 %s —— AI 将不使用胜率常识（跑 node tools/bake_winrate.js 生成）" % WR_FILE)
    html = html.replace("__WR_DATA__", wr)
    html = html.replace("__BUILD_TAG__", "dev" if dev else "main")
    html = html.replace("__BUILD_BADGE__", DEV_BADGE if dev else "")
    if "__DEV_UI__" in html:
        if dev:
            with open(SRC_DEV, "r", encoding="utf-8") as f:
                js = f.read()
            html = html.replace("__DEV_UI__", "<script>\n" + js + "\n</script>")
        else:
            html = html.replace("__DEV_UI__", "")
    return html


def write(path, html):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    print("输出: %s  (%.2f MB)" % (path, os.path.getsize(path) / 1048576))


def main():
    only_main = "--main" in sys.argv
    only_dev = "--dev" in sys.argv

    imgs, snds, bgs, bgms, uis = {}, {}, {}, {}, {}
    total_img = 0
    for cid in CARD_IDS:
        p = os.path.join(BAKED, "card_%s_300.png" % cid)
        uri, n = webp_data_uri(p, WEBP_Q["card"])
        imgs["card_" + cid] = uri
        total_img += n
        print("  图 %-24s %6.1f KB -> webp %5.1f KB" % ("card_" + cid, os.path.getsize(p) / 1024, n / 1024))
    for s in SPRITES:
        # baked 优先（经过裁剪/加工的成品）；没有就退回 assets/src（extract_assets2/decode_bc2 的原始输出）
        p = os.path.join(BAKED, s + ".png")
        if not os.path.isfile(p):
            p = os.path.join(ROOT, "assets", "src", s + ".png")
        uri, n = webp_data_uri(p, WEBP_Q["sprite"])
        imgs[s] = uri
        total_img += n
        print("  图 %-24s %6.1f KB -> webp %5.1f KB" % (s, os.path.getsize(p) / 1024, n / 1024))

    # 整页战斗背景布景（键去掉 bg_ 前缀，和 game.html 的 BG_LIST 对应）
    total_bg = 0
    for s in BGS:
        p = os.path.join(BG_DIR, s + ".png")
        if not os.path.isfile(p):
            print("  !! 缺背景:", s)
            continue
        uri, n = webp_data_uri(p, WEBP_Q["bg"])
        bgs[s[3:]] = uri
        total_bg += n
        print("  景 %-24s %6.1f KB -> webp %5.1f KB" % (s, os.path.getsize(p) / 1024, n / 1024))

    # 战斗背景音乐：整个 assets/bgm 目录（文件名即 id，和 game.html 的 BGM_GROUPS 对应）
    total_bgm = 0
    bgm_files = sorted(f for f in os.listdir(BGM_DIR) if f.endswith(".ogg")) \
        if os.path.isdir(BGM_DIR) else []
    for f in bgm_files:
        p = os.path.join(BGM_DIR, f)
        with open(p, "rb") as fh:
            b = fh.read()
        bgms[f[:-4]] = base64.b64encode(b).decode("ascii")
        total_bgm += len(b)
        print("  乐 %-24s %6.1f KB" % (f, len(b) / 1024))

    total_snd = 0
    for s in SOUNDS:
        cand = None
        for ext in (".mp3", ".wav"):
            p = os.path.join(AUDIO, s + ext)
            if os.path.isfile(p):
                cand = p
                break
        if not cand:
            print("  !! 缺音效:", s)
            continue
        with open(cand, "rb") as f:
            b = f.read()
        snds[s] = base64.b64encode(b).decode("ascii")
        total_snd += len(b)
        print("  音 %-24s %6.1f KB" % (s, len(b) / 1024))

    # 原版按钮贴图（给 CSS 当 border-image 用，所以单独一组，不混进 IMG 预加载循环）
    total_ui = 0
    for s in UIS:
        p = os.path.join(UI_DIR, s + ".png")
        if not os.path.isfile(p):
            print("  !! 缺按钮贴图:", s)
            continue
        uri, n = webp_data_uri(p, WEBP_Q["ui"])
        uis[s] = uri
        total_ui += n
        print("  钮 %-24s %6.1f KB -> webp %5.1f KB" % (s, os.path.getsize(p) / 1024, n / 1024))

    with open(SRC_HTML, "r", encoding="utf-8") as f:
        tpl = f.read()

    payload = json.dumps({"img": imgs, "snd": snds, "bg": bgs, "bgm": bgms, "ui": uis},
                         ensure_ascii=False, separators=(",", ":"))
    print("\n图片合计 %.1f KB / 音效合计 %.1f KB / 背景 %.1f KB / 背景音乐 %.2f MB / 按钮 %.1f KB" % (
        total_img / 1024, total_snd / 1024, total_bg / 1024, total_bgm / 1048576, total_ui / 1024))

    if not only_dev:
        html = render(tpl, payload, False)
        if html is None:
            return 1
        write(OUT_MAIN, html)
    if not only_main:
        html = render(tpl, payload, True)
        if html is None:
            return 1
        write(OUT_DEV, html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
