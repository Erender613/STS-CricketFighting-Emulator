/**
 * 观者 4 卡 · 无头验证 + 对顶行五卡平衡测试（task-4）
 * ============================================================
 * 覆盖：
 *   1) 静态集成：CARD_BY_ID / 名字 / p 参数 / watcher 标记 / CARDS 顺序（右列 5/11/17/23）
 *                  / MECHS 注册
 *   2) 设置闸门：SET.watcherCards=false/true 时选卡列表（testList）的差集
 *   3) 祭品召唤池闸门：直接调 MechOffering.summon() 拦截 world.units.push，统计 400 次抽卡
 *   4) 机制触发：talk_to_the_hand / alpha / prostrate / wish 各跑若干局（1/120 步长，60s 上限），
 *      用「世界数组 push 记录器 + Unit.damage 钩子」断言产出（手/格挡、贝塔→欧米伽→冲击波、
 *      力量/多层护甲/金币伤害、真言→神格→光柱伤害），并逐微步检查 NaN。
 *   5) 平衡：4 张新卡 × 顶行 5 卡，每对 N=100 局（左右各半，CAP=120s，种子 20260922，
 *      步长 1/120 = 游戏 SIM_DT），产出 tools/watcher_balance_report.md / .json
 *
 * 用法:
 *   node tools/watcher_test.js                  # 全量（N=100）
 *   node tools/watcher_test.js --quick          # 快检（N=20、机制局 30s）
 *   node tools/watcher_test.js --no-balance     # 只跑集成/闸门/机制
 *   node tools/watcher_test.js --only=static,gate,offering
 *   GAME_HTML=src/game.html node tools/watcher_test.js   # 构建前拿源码当桩（ASSET_MAP 占位符自动替换）
 *   GAME_HTML=杀戮尖塔小球对决_开发者版.html node tools/watcher_test.js
 *
 * 可调环境变量: N CAP HZ SEED MECH_CAP MECH_RUNS PAIRS
 *
 * 退出码: 0 = 通过 / 尚未集成（PENDING）；1 = 已集成但断言失败。
 *
 * ⚠ 只读 src/game.html、构建产物、assets；只写 tools/watcher_balance_report.{md,json}。
 * 本文件同时导出 loadGame() 等工具函数，供 tools/watcher_render_check.js 复用（require 本文件不会执行 main）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEFAULT_HTML = path.join(ROOT, '杀戮尖塔小球对决.html');
const HTML_PATH = process.env.GAME_HTML ? path.resolve(ROOT, process.env.GAME_HTML) : DEFAULT_HTML;
const MD_OUT = path.join(__dirname, 'watcher_balance_report.md');
const JSON_OUT = path.join(__dirname, 'watcher_balance_report.json');

/* ------------------------------------------------------------------ *
 *  常量：4 张观者卡 / 顶行五卡 / 各卡预期 p 键 / 新素材键
 * ------------------------------------------------------------------ */
const WATCHER_CARDS = [
  {
    id: 'talk_to_the_hand', name: '以手拒之', en: 'TALK TO THE HAND', idx: 11,
    p: ['first', 'handIv', 'handShrink', 'handMax', 'orbitR', 'orbitSpin', 'handSize',
      'slapRange', 'slapCd', 'handWake', 'slapDmg', 'blockGain', 'blockDur'],
  },
  {
    id: 'alpha', name: '阿尔法', en: 'ALPHA', idx: 5,
    p: ['first', 'betaIv', 'betaMax', 'betaHp', 'betaR', 'betaSpeed', 'betaGrow',
      'omegaMax', 'omegaHp', 'omegaR', 'omegaWaveCd', 'omegaFirst', 'omegaWaveDmg',
      'omegaWaveR', 'waveSpd', 'spawnDist', 'spawnAvoid'],
  },
  {
    id: 'prostrate', name: '五体投地', en: 'PROSTRATE', idx: 17,
    p: ['first', 'ivMin', 'ivMax', 'prayWindT', 'mantraOnEnter', 'blockGain', 'blockDur',
      'prayerSlow', 'mantra0', 'mantraAccel', 'mantraMin', 'mantraMax', 'divT', 'beamDelay',
      'beamR', 'beamTick', 'beamDmg', 'beamFollowSpd'],
  },
  {
    id: 'wish', name: '许愿', en: 'WISH', idx: 23,
    p: ['first', 'ivMin', 'ivMax', 'showT', 'slowDownT', 'slowUpT', 'slowMin',
      'goldP', 'strAdd', 'platedAdd', 'blockDur', 'coins', 'coinDmg', 'coinR',
      'coinSpdMin', 'coinSpdMax', 'coinG', 'coinLife', 'coinHitR', 'coinBounce'],
  },
];
const W4_IDS = WATCHER_CARDS.map(c => c.id);
const TOP5_EXPECTED = ['dark_embrace', 'knife_trap', 'beat_into_shape', 'end_of_days', 'voltaic'];
const HIST_JSON = path.join(__dirname, '_balance120.json');
const COLUMNS = 6;                       // 选卡面板：有观者卡时是 6 列（见 makePanel 的 gridTemplateColumns）

/* 新素材 key（与 task-1 交付清单一致；构建产物 ASSET_MAP.img 里必须有）
   9 张卡图 + 6 个能力图标 + 4 个 VFX = 19 个 key */
const NEW_ASSET_KEYS = {
  cards: [
    'card_talk_to_the_hand', 'card_alpha', 'card_beta', 'card_omega', 'card_prostrate',
    'card_wish', 'card_become_almighty', 'card_fame_and_fortune', 'card_live_forever',
  ],
  powers: ['pw_block_return', 'pw_mantra', 'pw_plated_armor', 'pw_divinity', 'pw_strength', 'pw_omega'],
  vfx: ['sp_eye_anim', 'sp_big_blur', 'sp_glow_spark', 'sp_coin'],
};
const NEW_ASSET_ALL = [].concat(NEW_ASSET_KEYS.cards, NEW_ASSET_KEYS.powers, NEW_ASSET_KEYS.vfx);

/* ------------------------------------------------------------------ *
 *  用户设定文档【写死】的数值 —— 不许按平衡理由改。
 *  平衡调参只能动「间隔、冷却、范围、位置、实现结构」类参数（Lead 2026-10-23 口径）。
 *  static 检查会核对写死值有没有被误改；调参建议会自动过滤掉这些键。
 * ------------------------------------------------------------------ */
const FIXED_PARAMS = {
  talk_to_the_hand: { slapDmg: 50, blockGain: 20, blockDur: 5, handMax: 6 },
  alpha: {
    betaHp: 100, betaMax: 2, betaGrow: 7, omegaHp: 100, omegaMax: 3,
    omegaWaveCd: 2.5, omegaWaveDmg: 150,
  },
  wish: { goldP: 0.5, coins: 5, coinDmg: 25, strAdd: 5, platedAdd: 8, blockDur: 5 },
  prostrate: { blockGain: 30, mantraMax: 10, divT: 5, beamTick: 6, beamDmg: 25 },
};
/* 可调参数（间隔/冷却/范围/位置/实现结构）—— 供报告与调参建议展示 */
const TUNABLE_PARAMS = {
  talk_to_the_hand: ['first', 'handIv', 'handShrink', 'slapCd', 'handWake',
    'slapRange', 'orbitR', 'orbitSpin', 'handSize'],
  alpha: ['first', 'betaIv', 'betaSpeed', 'omegaFirst', 'omegaWaveR', 'waveSpd',
    'spawnDist', 'spawnAvoid', 'betaR', 'omegaR'],
  wish: ['first', 'ivMin', 'ivMax', 'showT', 'slowDownT', 'slowUpT', 'slowMin',
    'coinHitR', 'coinBounce', 'coinLife', 'coinSpdMin', 'coinSpdMax', 'coinG', 'coinR'],
  prostrate: ['first', 'ivMin', 'ivMax', 'prayWindT', 'prayerSlow', 'mantra0', 'mantraAccel',
    'mantraMin', 'beamDelay', 'beamR', 'beamFollowSpd'],
};

/* ------------------------------------------------------------------ *
 *  小工具
 * ------------------------------------------------------------------ */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
}
const fmtPct = v => (v * 100).toFixed(1) + '%';
const fmtSec = v => (v === null || v === undefined || !isFinite(v)) ? '—' : v.toFixed(1) + 's';
const pad = (s, n) => String(s).padEnd(n);
const uniq = arr => Array.from(new Set(arr));
/* 本地时间 "YYYY-MM-DD HH:mm:ss"（报告里给人看的构建 mtime；ISO 是 UTC，容易和本地 09:59 对不上） */
function fmtLocalDateTime(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* ------------------------------------------------------------------ *
 *  1. 载入构建产物（vm + stub DOM）—— render check 也复用这里
 * ------------------------------------------------------------------ */
function makeStubEl(kind) {
  const el = {
    kind: kind || 'div',
    style: {}, dataset: {}, children: [], disabled: false, checked: false,
    textContent: '', title: '', value: '', innerHTML: '',
    clientWidth: 700, clientHeight: 700,
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { width: 700, height: 700, top: 0, left: 0 }; },
    setAttribute() { }, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, focus() { }, click() { },
    parentElement: null,
  };
  el.parentElement = { clientWidth: 716, clientHeight: 700, style: {} };
  return el;
}

/* 2D 上下文：一个"什么方法都有、且能计数"的 Proxy。
   - ctxStats.ops        总调用/取属性次数
   - ctxStats.keys        drawImage 画过的贴图 key -> 次数
   - ctxStats.texts      fillText/strokeText 的文本（+方法前缀）
   - ctxStats.calls      方法名 -> 次数
   ctxStats 被外层脚本与沙箱共享。 */
function createCtx2d(ctxStats, opts) {
  opts = opts || {};
  const strictImages = !!opts.strictImages;
  const grad = () => ({ addColorStop() { } });
  const target = {
    canvas: { width: 666, height: 666 },
    globalAlpha: 1, lineWidth: 1, shadowBlur: 0, shadowColor: '#000',
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    fillStyle: '#000', strokeStyle: '#000', globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: false, imageSmoothingQuality: 'high', filter: 'none',
  };
  const stack = [];
  return new Proxy(target, {
    get(o, k) {
      ctxStats.ops++;
      if (k === 'then') return undefined;
      if (k in o) return o[k];
      const f = function () {
        ctxStats.ops++;
        const name = String(k);
        ctxStats.calls[name] = (ctxStats.calls[name] || 0) + 1;
        if (name === 'drawImage') {
          const img = arguments[0];
          if (img == null) {
            /* 真 canvas 对 undefined 会抛 TypeError；冒烟测试里也抛，才能抓出"IMG 键写错/素材没打进包" */
            if (strictImages) throw new TypeError('drawImage(undefined)：IMG 里没有这个贴图 key（渲染冒烟）');
            return undefined;
          }
          if (img && img.__key) {
            ctxStats.keys.set(img.__key, (ctxStats.keys.get(img.__key) || 0) + 1);
            if (ctxStats.frame) {
              ctxStats.frame.keys.add(img.__key);
              /* 记录绘制尺寸：渲染冒烟要验证"手掌贴图放大到 handSize=54 / 贝塔缩小 0.8" */
              const w = +arguments[3], h = +arguments[4];
              if (isFinite(w) && isFinite(h)) ctxStats.frame.imgs.push({ key: img.__key, w: w, h: h });
            }
          }
          return undefined;
        }
        if (name === 'fillText' || name === 'strokeText') {
          const t = String(arguments[0]);
          if (ctxStats.texts.length < 60000) ctxStats.texts.push(name === 'fillText' ? 'F:' + t : 'S:' + t);
          if (ctxStats.frame && ctxStats.frame.texts.length < 500) ctxStats.frame.texts.push(name + ':' + t);
          return undefined;
        }
        if (name === 'measureText') return { width: 30 };
        if (name === 'getImageData') return { data: [], width: 1, height: 1 };
        if (name === 'createLinearGradient' || name === 'createRadialGradient' ||
            name === 'createConicGradient' || name === 'createPattern') return grad();
        if (name === 'save') { stack.push(o.globalAlpha); return undefined; }
        if (name === 'restore') { if (stack.length) o.globalAlpha = stack.pop(); return undefined; }
        return undefined;
      };
      return f;
    },
    set(o, k, v) { ctxStats.ops++; o[k] = v; return true; },
    has() { return true; },
  });
}

class ImageStub {
  constructor() { this.naturalWidth = 300; this.naturalHeight = 423; this.width = 300; this.height = 423; this.complete = true; }
  addEventListener(t, f) { if (t === 'load') setTimeout(f, 0); }
  removeEventListener() { }
}
class Path2DStub {
  moveTo() { } lineTo() { } arcTo() { } closePath() { } rect() { } arc() { } bezierCurveTo() { } quadraticCurveTo() { }
}

/* 追加到游戏脚本尾部的导出壳（在脚本作用域内执行，能拿到所有顶层 const/let/class）。
   注意：这里生成的字符串会在 vm 里执行，只能用 ES5 写法 + eval 探针。 */
function buildHarness() {
  const lines = [
    '',
    '/* ===== watcher_test harness（由 tools/watcher_test.js 注入；不改游戏逻辑）===== */',
    ';globalThis.__WT = (function () {',
    '  function G(n) { try { return eval(n); } catch (e) { return undefined; } }',
    '  var T = { __G: G };',
    '  ["world","CFG","CARD_BY_ID","CARDS","SET","MECHS","testList","selectableList",',
    '   "cardList","getSelectable","selList","stepPhysics","resetMatch","drawArena",',
    '   "drawUnitHUD","fit","loadAll","IMG","ASSET_MAP","makeSeed","setSimSeed","SEL",',
    '   "Unit","Effect","pushRec","WatcherHand","MechWish","MechProstrate",',
    '   "ProstrateCharge","DivinityBeam","BetaUnit","OmegaUnit"].forEach(function (n) { T[n] = (n === "pushRec") ? undefined : G(n); });',
    '  T.setCtx = function (c) { try { cx = c; } catch (e) { } };',
    '  T.setCv = function (c) { try { cv = c; } catch (e) { } };',
    '  T.setScale = function (s) { try { SCALE = s; } catch (e) { } };',
    '  T.getScale = function () { return (typeof SCALE !== "undefined") ? SCALE : null; };',
    '  T.getCv = function () { return (typeof cv !== "undefined") ? cv : null; };',
    '  T.getCx = function () { return (typeof cx !== "undefined") ? cx : null; };',
    '  /* 世界数组 push 记录器：效果/单位实例化登记（constructor.name + card.id）。',
    '     候选机制类名未知，所以用"注册即记录"而不是写死类名。 */',
    '  globalThis.__PUSH = { on: false, log: [], cap: 60000 };',
    '  (function () {',
    '    var orig = Array.prototype.push;',
    '    Array.prototype.push = function () {',
    '      var R = globalThis.__PUSH;',
    '      if (R && R.on) {',
    '        var W = globalThis.__WT && globalThis.__WT.world;',
    '        if (W && (this === W.effects || this === W.units)) {',
    '          var kind = (this === W.units) ? "unit" : "effect";',
    '          for (var i = 0; i < arguments.length; i++) {',
    '            var o = arguments[i], cls = "?", cardId = null;',
    '            try { cls = (o && o.constructor && o.constructor.name) || "?"; } catch (e) { }',
    '            try { cardId = (o && o.card && o.card.id) || null; } catch (e) { }',
    '            if (R.log.length < R.cap) R.log.push({ t: W.t, kind: kind, cls: cls, card: cardId,',
    '              team: (o && o.team !== undefined) ? o.team : null,',
    '              minion: !!(o && o.minion), summoned: !!(o && o.summoned) });',
    '          }',
    '        }',
    '      }',
    '      return orig.apply(this, arguments);',
    '    };',
    '  })();',
    '  return T;',
    '})();',
  ];
  return lines.join('\n');
}

/**
 * 载入一局游戏宿主。
 * opts.seed   —— Math.random 的种子（决定 makeSeed 序列；机制/平衡测试另传显式 seed）
 * 返回 G = { T, sandbox, html, srcMode, ctxStats, pushRec, damageLog, blockLog, ... }
 */
function loadGame(opts) {
  opts = opts || {};
  const seed = opts.seed === undefined ? 20260922 : opts.seed;
  if (!fs.existsSync(HTML_PATH)) throw new Error('找不到构建产物：' + HTML_PATH);
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  const blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
  let src = blocks.sort((a, b) => b.length - a.length)[0];
  if (!src) throw new Error('找不到游戏主体 <script>：' + HTML_PATH);

  /* 直接用 src/game.html 当桩时：替换构建期占位符（ASSET_MAP / WR_DATA）。 */
  const srcMode = src.indexOf('__ASSET_MAP__') >= 0;
  if (srcMode) {
    src = src.replace('__ASSET_MAP__',
      JSON.stringify({ img: {}, snd: {}, bg: {}, bgm: {}, ui: {} }))
      .replace('__WR_DATA__', 'null');
  }
  src += buildHarness();

  const ctxStats = {
    ops: 0, keys: new Map(), texts: [], calls: Object.create(null),
  };
  const ctx = createCtx2d(ctxStats, { strictImages: !!opts.strictImages });
  const els = Object.create(null);
  function getEl(id) {
    if (!els[id]) {
      els[id] = makeStubEl(id === 'cv' ? 'canvas' : 'div');
      if (id === 'cv') {
        els[id].width = 666; els[id].height = 666;
        els[id].getContext = function () { return ctx; };
      }
    }
    return els[id];
  }

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    Image: ImageStub,
    Path2D: Path2DStub,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => { },
    document: {
      getElementById: getEl,
      createElement: () => { const el = makeStubEl('div'); el.getContext = function () { return ctx; }; return el; },
      createTextNode: t => ({ nodeValue: t, textContent: t }),
      addEventListener() { }, removeEventListener() { },
      querySelector() { return null; }, querySelectorAll() { return []; },
      documentElement: { clientWidth: 1400, clientHeight: 900, style: { setProperty() { } } },
      body: makeStubEl('body'),
    },
    window: {
      addEventListener() { }, removeEventListener() { },
      devicePixelRatio: 1, innerWidth: 1400, innerHeight: 900,
      matchMedia: () => ({ matches: false, addEventListener() { }, removeEventListener() { } }),
      AudioContext: undefined, webkitAudioContext: undefined,
    },
    localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
  };
  /* 只覆盖 Math.random（可种子化），其余内建/原型沿用沙箱 realm 自己的，
     这样 Array.prototype.push 的注入不会污染外层脚本。 */
  const MathSeeded = Object.create(Math);
  MathSeeded.random = mulberry32(seed);
  sandbox.Math = MathSeeded;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  try {
    vm.runInContext(src, sandbox, { filename: path.basename(HTML_PATH) });
  } catch (e) {
    const err = new Error('载入游戏脚本失败：' + e.message + '\n' +
      String(e.stack || '').split('\n').slice(0, 6).join('\n'));
    err.cause = e;
    throw err;
  }

  const T = sandbox.__WT;
  if (!T || !T.world) throw new Error('导出句柄 __WT 缺失（脚本尾部结构被改？）');
  const G = {
    T, sandbox, html, srcMode, seed, ctxStats,
    pushRec: sandbox.__PUSH,
    damageLog: [],
    blockLog: [],
    handSlaps: [],
    hooks: null,
  };
  installRuntimeHooks(G);
  installMechHooks(G);
  return G;
}

/* 给具体机制类套观测钩子（2026-10-23 迭代：每只手独立拍击冷却需要精确到 slot 的证据）。
   WatcherHand.waImpact 每次真正拍中时触发 → 记录 {t, slot}，比"猜 cd 跳变"可靠。 */
function installMechHooks(G) {
  const T = G.T;
  const WH = T.__G ? T.__G('WatcherHand') : null;
  if (!WH || !WH.prototype) return;
  if (typeof WH.prototype.waImpact === 'function' && !WH.prototype.__wtHookedImpact) {
    const orig = WH.prototype.waImpact;
    WH.prototype.waImpact = function () {
      try { G.handSlaps.push({ t: T.world.t, slot: this.slot }); } catch (e) { }
      return orig.apply(this, arguments);
    };
    WH.prototype.__wtHookedImpact = true;
  }
}

/* 给 Unit.prototype.damage / addTimedBlock 套计数钩子（只读观测，不改变行为）。
   damage 钩子能拿到 (amount, kind, src)，是"机制真的造成伤害了"最直接的证据。 */
function installRuntimeHooks(G) {
  const T = G.T;
  const world = T.world;
  /* Unit 类：优先用导出的 Unit；拿不到就从现有单位的原型链上找。 */
  let UnitCls = T.Unit;
  if (!UnitCls) {
    const u = (world.units || [])[0];
    if (u) {
      let p = Object.getPrototypeOf(u);
      while (p && typeof p.damage !== 'function') p = Object.getPrototypeOf(p);
      if (p) UnitCls = p.constructor;
    }
  }
  const out = { unitClass: UnitCls ? UnitCls.name : null, damage: false, addTimedBlock: false };
  if (UnitCls && UnitCls.prototype) {
    const proto = UnitCls.prototype;
    if (typeof proto.damage === 'function' && !proto.__wtHookedDamage) {
      const orig = proto.damage;
      proto.damage = function (amount, kind, src) {
        try {
          G.damageLog.push({
            t: T.world.t,
            amount: amount,
            kind: kind || null,
            srcId: (src && src.card && src.card.id) || null,
            srcTeam: (src && src.team !== undefined) ? src.team : null,
            srcCls: (src && src.constructor && src.constructor.name) || null,
            targetId: (this.card && this.card.id) || null,
            targetTeam: this.team,
            targetMinion: !!this.minion,
          });
        } catch (e) { /* 观测不能影响游戏 */ }
        return orig.apply(this, arguments);
      };
      proto.__wtHookedDamage = true;
      out.damage = true;
    }
    if (typeof proto.addTimedBlock === 'function' && !proto.__wtHookedAtb) {
      const orig = proto.addTimedBlock;
      proto.addTimedBlock = function (v, dur) {
        try {
          G.blockLog.push({ t: T.world.t, v: v, dur: dur, id: (this.card && this.card.id) || null, team: this.team,
            plated: (typeof this.plated === 'number') ? this.plated : null });
        } catch (e) { }
        return orig.apply(this, arguments);
      };
      proto.__wtHookedAtb = true;
      out.addTimedBlock = true;
    }
  }
  G.hooks = out;
  return out;
}

/* ------------------------------------------------------------------ *
 *  2. 对局/采样工具
 * ------------------------------------------------------------------ */
const UNIT_NUM_FIELDS = ['x', 'y', 'dx', 'dy', 'hp', 'maxHp', 'block', 'baseSpeed',
  'freeze', 'boost', 'doom', 'doomT', 'poison', 'vuln', 'weak', 'focus', 'strength',
  'plated', 'mantra', 'divT', 'speedMul', 'slamT', 'invulT', 'flash', 'bouncePop'];

function checkWorld(T) {
  const bad = [];
  const w = T.world;
  if (!Number.isFinite(w.t)) bad.push({ where: 'world.t', v: w.t });
  for (let i = 0; i < w.units.length; i++) {
    const u = w.units[i];
    const tag = 'units[' + i + ']' + ((u.card && u.card.id) ? '(' + u.card.id + ')' : '');
    for (const f of UNIT_NUM_FIELDS) {
      const v = u[f];
      if (typeof v === 'number' && !Number.isFinite(v)) bad.push({ where: tag + '.' + f, v: v });
    }
  }
  for (let i = 0; i < w.effects.length; i++) {
    const e = w.effects[i];
    const tag = 'effects[' + i + '](' + ((e && e.constructor && e.constructor.name) || '?') + ')';
    for (const f of ['x', 'y', 'r', 'life', 't', 'age', 'k']) {
      const v = e && e[f];
      if (typeof v === 'number' && !Number.isFinite(v)) bad.push({ where: tag + '.' + f, v: v });
    }
  }
  return bad;
}

function resultOf(T) {
  if (!T.world.over) return 'D';
  const win = T.world.over.win;
  if (win === 0) return 'L';
  if (win === 1) return 'R';
  return 'D';
}

function applyGate(T, v) {
  if (!T.SET || !('watcherCards' in T.SET)) return false;
  const old = T.SET.watcherCards;
  T.SET.watcherCards = v;
  return old;
}

/**
 * 跑一局。aId 在左（team 0）。
 * opt: { cap, dt, seed, observe, sampleEvery, nanCheck, nanEvery, onStep }
 * 返回 { result, t, steps, err, nan, samples, seed, over }
 */
function runMatch(G, aId, bId, opt) {
  opt = opt || {};
  const T = G.T;
  const dt = opt.dt || (1 / 120);
  const cap = opt.cap === undefined ? 120 : opt.cap;
  const sampleEvery = opt.sampleEvery || 0;
  const nanEvery = opt.nanEvery || 6;
  if (!T.CARD_BY_ID[aId]) return { result: 'D', t: 0, steps: 0, err: new Error('没有卡 ' + aId), nan: [], samples: [] };
  if (!T.CARD_BY_ID[bId]) return { result: 'D', t: 0, steps: 0, err: new Error('没有卡 ' + bId), nan: [], samples: [] };

  G.damageLog.length = 0;
  G.blockLog.length = 0;
  G.pushRec.on = !!opt.observe;
  G.pushRec.log.length = 0;

  const seed = opt.seed;
  let err = null;
  try {
    T.resetMatch(T.CARD_BY_ID[aId], T.CARD_BY_ID[bId], seed);
    installRuntimeHooks(G);          // resetMatch 后 new 出来的单位共享同一原型，这里只是保险
  } catch (e) {
    G.pushRec.on = false;
    return { result: 'D', t: 0, steps: 0, err: e, nan: [], samples: [], seed: seed };
  }
  T.world.running = true;

  const samples = [];
  const nan = [];
  let steps = 0;
  const capSteps = Math.ceil(cap / dt) + 8;
  try {
    while (!T.world.over && T.world.t < cap && steps < capSteps) {
      T.world.t += dt;
      T.stepPhysics(dt);
      steps++;
      if (opt.onStep) opt.onStep(T.world, steps, G);
      if (sampleEvery && steps % sampleEvery === 0) samples.push(sampleState(G));
      if (opt.nanCheck !== false && steps % nanEvery === 0) {
        const bad = checkWorld(T);
        if (bad.length) {
          nan.push({ t: T.world.t, issues: bad.slice(0, 6) });
          if (nan.length >= 20) break;
        }
      }
    }
  } catch (e) {
    err = e;
  }
  const out = {
    result: resultOf(T), t: T.world.t, steps: steps, err: err, nan: nan,
    samples: samples, seed: seed,
    over: T.world.over ? { win: T.world.over.win, reason: T.world.over.reason || null } : null,
  };
  if (opt.observe) { out.pushes = G.pushRec.log.slice(); }
  G.pushRec.on = false;
  return out;
}

function sampleState(G) {
  const T = G.T;
  const w = T.world;
  const effCls = Object.create(null);
  for (const e of w.effects) {
    const k = (e && e.constructor && e.constructor.name) || '?';
    effCls[k] = (effCls[k] || 0) + 1;
  }
  const units = [];
  const unitCls = Object.create(null);
  for (const u of w.units) {
    const cls = (u && u.constructor && u.constructor.name) || '?';
    unitCls[cls] = (unitCls[cls] || 0) + 1;
    let spd = null;
    try { if (typeof u.curSpeed === 'function') spd = +u.curSpeed().toFixed(2); } catch (e) { }
    units.push({
      id: (u.card && u.card.id) || null, cls: cls, team: u.team,
      x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, block: u.block,
      strength: u.strength, plated: u.plated, mantra: u.mantra, divT: u.divT,
      speedMul: u.speedMul, freeze: u.freeze, sizeMul: u.sizeMul, spd: spd,
      grabbed: u.grabbed, minion: !!u.minion, summoned: !!u.summoned,
      alive: !!u.alive, dying: !!u.dying, finished: !!u.finished,
    });
  }
  return { t: w.t, effCls: effCls, unitCls: unitCls, units: units };
}

/* ------------------------------------------------------------------ *
 *  3. 静态集成检查
 * ------------------------------------------------------------------ */
function checkStatic(G) {
  const T = G.T;
  const issues = [];
  const warnings = [];
  const pending = [];
  const cards = [];
  const mechOk = {};

  for (const spec of WATCHER_CARDS) {
    const c = T.CARD_BY_ID[spec.id];
    const rec = { id: spec.id, name: spec.name, en: spec.en, exists: !!c };
    if (!c) {
      /* 构建产物还没集成 = PENDING（不是失败）：优雅提示，不中断其它检查 */
      pending.push('构建产物尚未集成 ' + spec.id + '（' + spec.name + '）');
      cards.push(rec);
      mechOk[spec.id] = false;
      continue;
    }
    rec.actualName = c.name;
    rec.actualEn = c.en;
    rec.hp = c.hp;
    rec.speed = c.speed;
    rec.mech = c.mech;
    rec.p = c.p || null;
    rec.pKeys = Object.keys(c.p || {});
    rec.missingPKeys = spec.p.filter(k => !(c.p && (k in c.p)));
    rec.watcherFlag = (c.watcher === true) ? 'watcher:true'
      : (c.watcher !== undefined ? 'watcher=' + JSON.stringify(c.watcher)
        : (c.test ? '仅 test:true（缺 watcher 标记）' : '无 watcher 标记'));
    rec.mechRegistered = !!(c.mech && typeof T.MECHS[c.mech] === 'function');
    mechOk[spec.id] = rec.mechRegistered;
    rec.idx = T.CARDS.indexOf(c);
    rec.expectedIdx = spec.idx;
    rec.column = rec.idx >= 0 ? (rec.idx % COLUMNS) : null;

    if (!c.name) issues.push(spec.id + '.name 为空');
    if (!c.mech) issues.push(spec.id + '.mech 缺失');
    if (!rec.mechRegistered) pending.push('MECHS.' + (c.mech || '?') + ' 未注册（机制片段尚未拼接）');
    if (!c.p || typeof c.p !== 'object') issues.push(spec.id + '.p 缺失（数值全部从 p 读）');
    else if (rec.missingPKeys.length) warnings.push(spec.id + '.p 缺键: ' + rec.missingPKeys.join(', '));
    if (c.watcher !== true) issues.push(spec.id + ' 缺 card.watcher === true 标记（闸门/祭品池依赖它）');
    if (c.test === true) warnings.push(spec.id + ' 同时带 test:true（观者卡不应再挂测试标记）');
    if (!Number.isFinite(c.hp) || c.hp <= 0) issues.push(spec.id + '.hp 非正数');
    if (!Number.isFinite(c.speed) || c.speed <= 0) issues.push(spec.id + '.speed 非正数');
    /* 用户设定文档里【写死】的数值：被误改只警告（不是集成失败），但报告会点名 */
    const fixed = FIXED_PARAMS[spec.id] || {};
    rec.fixedMismatch = [];
    for (const k of Object.keys(fixed)) {
      if (!c.p || !(k in c.p)) { rec.fixedMismatch.push(k + ' 缺失'); continue; }
      const got = c.p[k], want = fixed[k];
      if (typeof got !== 'number' || Math.abs(got - want) > 1e-9) {
        rec.fixedMismatch.push(k + '=' + got + '（写死 ' + want + '）');
      }
    }
    if (rec.fixedMismatch.length) {
      warnings.push(spec.id + ' 用户写死值被改动：' + rec.fixedMismatch.join('；'));
    }
    rec.tunable = TUNABLE_PARAMS[spec.id] || [];
    cards.push(rec);
  }

  /* 2026-10-23 口径的源码级检查：许愿不再用 u.freeze 硬停顿（pauseT 参数删除） */
  {
    const srcText = G.html || '';
    const iWish = srcText.indexOf('class MechWish');
    const iNext = srcText.indexOf('class ProstrateAura');
    if (iWish >= 0 && iNext > iWish) {
      const block = srcText.slice(iWish, iNext);
      if (/\.freeze\s*=/.test(block)) issues.push('MechWish 源码里仍有 freeze 赋值（2026-10-23 口径已删除硬停顿）');
      if (/pauseT/.test(block)) warnings.push('MechWish 源码里仍出现 pauseT（已删除的参数）');
    }
    const wishC = T.CARD_BY_ID['wish'];
    if (wishC && wishC.p && Object.prototype.hasOwnProperty.call(wishC.p, 'pauseT')) {
      warnings.push('wish.p 仍保留 pauseT（2026-10-23 口径已删除，应为 slowDownT/slowUpT/slowMin）');
    }
  }

  /* 2026-10-23 第三轮：贝塔/欧米伽改为无色（灰框）—— 核对 bake_card2.py 的 ALL_TOKENS */
  let bakeColor = null;
  {
    const bakePath = path.join(__dirname, 'bake_card2.py');
    try {
      const bake = fs.readFileSync(bakePath, 'utf8');
      const lineOf = (id) => {
        const re = new RegExp('\\(\\s*"' + id + '"[^\\n]*?\\)');
        const m = bake.match(re);
        return m ? m[0] : null;
      };
      const betaLine = lineOf('beta');
      const omegaLine = lineOf('omega');
      const okBeta = !!betaLine && /"colorless"/.test(betaLine) && !/"purple"/.test(betaLine);
      const okOmega = !!omegaLine && /"colorless"/.test(omegaLine) && !/"purple"/.test(omegaLine);
      if (!okBeta) issues.push('bake_card2.py 里 card_beta 不是 colorless（灰色卡框）');
      if (!okOmega) issues.push('bake_card2.py 里 card_omega 不是 colorless（灰色卡框）');
      bakeColor = { beta: okBeta, omega: okOmega };
    } catch (e) {
      warnings.push('读 tools/bake_card2.py 失败，跳过灰框检查：' + e.message);
    }
  }

  /* CARDS 顺序 / 最右列（缺卡时只记录为待集成，不算失败）。
     任务只要求 4 张卡落在 0 基 {5,11,17,23}（6 列布局的最右一列），
     具体哪张卡在哪一行由整合顺序决定 —— 每卡映射不符只记警告。 */
  const actualIdx = W4_IDS.map(id => T.CARDS.findIndex(c => c.id === id));
  const expectedIdx = WATCHER_CARDS.map(c => c.idx);
  const allExist = actualIdx.every(v => v >= 0);
  const POS_SET = [5, 11, 17, 23];
  const actualSorted = actualIdx.slice().sort((a, b) => a - b);
  const posSetOk = JSON.stringify(actualSorted) === JSON.stringify(POS_SET);
  const mappingOk = actualIdx.every((v, i) => v === expectedIdx[i]);
  const cols = actualIdx.map(v => v >= 0 ? v % COLUMNS : null);
  const rightColOk = cols.every(v => v === COLUMNS - 1);
  const orderOk = allExist && posSetOk;
  if (allExist && !posSetOk) {
    issues.push('CARDS 位置不符：期望 0 基集合 [' + POS_SET.join(',') + ']，实际 [' +
      actualSorted.join(',') + ']');
  }
  if (allExist && !rightColOk) {
    issues.push('CARDS 位置不是最右一列：' + COLUMNS + ' 列布局下应均为第 ' +
      COLUMNS + ' 列（idx % ' + COLUMNS + ' === ' + (COLUMNS - 1) + '），实际 ' + cols.join(','));
  }
  if (allExist && posSetOk && !mappingOk) {
    warnings.push('各卡行号与当前预期不同（实际 [' + actualIdx.join(',') + ']，预期 [' +
      expectedIdx.join(',') + ']）——只影响面板行位，位置集合正确');
  }
  const cardCount = T.CARDS.length;
  if (allExist && cardCount !== 24) warnings.push('CARDS 共 ' + cardCount + ' 张（期望 20 老卡 + 4 观者 = 24）');
  const top5 = T.CARDS.slice(0, 5).map(c => c.id);
  const top5Ok = JSON.stringify(top5) === JSON.stringify(TOP5_EXPECTED);
  if (!top5Ok) warnings.push('CARDS 前五张 = [' + top5.join(',') + ']，与预期顶行五卡不一致（平衡基准仍按实际前五张跑，请确认不是无意的重排）');

  return {
    cards, order: { actual: actualIdx, expected: expectedIdx, ok: orderOk, allExist: allExist, cols: cols, rightColumn: rightColOk },
    cardCount, top5, top5Ok, issues, warnings, pending, bakeColor,
    integrated: issues.length === 0 && pending.length === 0,
  };
}

/* ------------------------------------------------------------------ *
 *  4. 设置闸门 + 祭品召唤池闸门
 * ------------------------------------------------------------------ */
function checkGates(G) {
  const T = G.T;
  const issues = [];
  const res = {
    setKeyExists: !!(T.SET && ('watcherCards' in T.SET)),
    defaultValue: T.SET ? T.SET.watcherCards : undefined,
    listFn: null, off: null, on: null, issues: issues,
  };
  const candidates = ['testList', 'selectableList', 'cardList', 'getSelectable', 'selList', 'pool'];
  for (const name of candidates) {
    const fn = T.__G(name);
    if (typeof fn === 'function') { res.listFn = name; break; }
  }
  if (!res.listFn) {
    issues.push('找不到选卡列表函数（试过 ' + candidates.join('/') + '）');
    return res;
  }
  if (!res.setKeyExists) {
    issues.push('SET.watcherCards 不存在（观者卡闸门缺失）');
    return res;
  }
  const old = T.SET.watcherCards;
  const idsOf = () => {
    const fn = T.__G(res.listFn);
    const out = fn();
    return (out || []).map(x => (x && x.id) || x);
  };
  try {
    T.SET.watcherCards = false;
    res.off = idsOf();
    T.SET.watcherCards = true;
    res.on = idsOf();
  } finally {
    T.SET.watcherCards = old;
  }
  res.offHasWatcher = res.off.filter(id => W4_IDS.indexOf(id) >= 0);
  res.onHasWatcher = res.on.filter(id => W4_IDS.indexOf(id) >= 0);
  if (res.offHasWatcher.length) issues.push('闸门关时选卡列表仍含观者卡：' + res.offHasWatcher.join(', '));
  const missing = W4_IDS.filter(id => res.onHasWatcher.indexOf(id) < 0);
  if (missing.length) issues.push('闸门开时选卡列表缺观者卡：' + missing.join(', '));
  const availableWatchers = W4_IDS.filter(id => T.CARD_BY_ID[id]).length;
  if (res.on.length !== res.off.length + availableWatchers) {
    issues.push('开/关列表数量差不等于 4（关 ' + res.off.length + ' / 开 ' + res.on.length + '），可能有其它过滤串扰');
  }
  return res;
}

/* 直接拦 world.units.push，反复调 MechOffering.summon() 统计抽到的卡 id。 */
function drawOfferingPool(G, oppId, times) {
  const T = G.T;
  const out = { error: null, picks: [], watcher: [], invalid: [], offeringPicked: 0, oppPicked: 0 };
  if (!T.CARD_BY_ID['offering']) { out.error = '没有 offering 卡'; return out; }
  if (!T.CARD_BY_ID[oppId]) { out.error = '没有对照卡 ' + oppId; return out; }
  try {
    T.resetMatch(T.CARD_BY_ID['offering'], T.CARD_BY_ID[oppId], 424242);
  } catch (e) { out.error = 'resetMatch 失败：' + e.message; return out; }
  const w = T.world;
  const u = w.units.filter(x => x && x.card && x.card.id === 'offering')[0];
  if (!u || !u.mech || typeof u.mech.summon !== 'function') {
    out.error = 'offering 的 mech.summon 不可用';
    return out;
  }
  const arr = w.units;
  const origPush = arr.push;
  arr.push = function (m) {
    if (m && (m.realCard || m.summoned)) {
      const id = (m.realCard && m.realCard.id) || (m.card && m.card.id) || '?';
      out.picks.push(id);
      if (W4_IDS.indexOf(id) >= 0) out.watcher.push(id);
      if (id === 'offering') out.offeringPicked++;
      if (id === oppId) out.oppPicked++;
      if (!T.CARD_BY_ID[id]) out.invalid.push(id);
    }
    return 0;                       // 不真的进场 —— 避免 hasFoe() 挡住后续召唤
  };
  try {
    for (let i = 0; i < times; i++) u.mech.summon();
  } catch (e) {
    out.error = 'summon 抛异常：' + e.message;
  } finally {
    arr.push = origPush;
  }
  const uniqPicks = uniq(out.picks);
  out.distinct = uniqPicks.length;
  out.watcherDistinct = uniq(out.watcher);
  return out;
}

function checkOffering(G) {
  const T = G.T;
  const res = { available: false, issues: [], off: null, on: null };
  if (!T.CARD_BY_ID['offering'] || !T.CARD_BY_ID['dark_embrace']) {
    res.issues.push('缺少 offering 或对照卡，跳过祭品池检查');
    return res;
  }
  if (!T.SET || !('watcherCards' in T.SET)) {
    res.issues.push('SET.watcherCards 缺失，祭品池闸门无从测试');
    return res;
  }
  res.available = true;
  const old = T.SET.watcherCards;
  try {
    T.SET.watcherCards = false;
    res.off = drawOfferingPool(G, 'dark_embrace', 400);
    T.SET.watcherCards = true;
    res.on = drawOfferingPool(G, 'dark_embrace', 400);
  } finally {
    T.SET.watcherCards = old;
  }
  for (const side of ['off', 'on']) {
    if (res[side] && res[side].error) res.issues.push('祭品池(' + side + ')：' + res[side].error);
  }
  if (res.off && !res.off.error) {
    if (res.off.watcherDistinct.length) {
      res.issues.push('闸门关时祭品仍能召到观者卡：' + res.off.watcherDistinct.join(', '));
    }
    if (res.off.offeringPicked) res.issues.push('祭品池混入了自己（offering ×' + res.off.offeringPicked + '）');
    if (res.off.oppPicked) res.issues.push('祭品池混入了对手本体（×' + res.off.oppPicked + '）');
    if (res.off.invalid.length) res.issues.push('祭品池抽到未知卡 id：' + uniq(res.off.invalid).join(', '));
  }
  if (res.on && !res.on.error) {
    const missing = W4_IDS.filter(id => res.on.watcherDistinct.indexOf(id) < 0);
    if (missing.length) res.issues.push('闸门开时 400 次召唤没抽到观者卡：' + missing.join(', '));
  }
  return res;
}

/* ------------------------------------------------------------------ *
 *  5. 机制触发断言
 * ------------------------------------------------------------------ */
/* 老卡基线类名集合：用来把"只在观者对局里出现"的 Effect/Unit 类挑出来 */
function collectBaselineClasses(G, capSec) {
  const T = G.T;
  const cls = new Set();
  const pairs = [];
  const t5 = pickTop5(T);
  for (let i = 0; i < t5.length; i++) {
    for (let j = i + 1; j < t5.length; j++) pairs.push([t5[i], t5[j]]);
  }
  for (const [a, b] of pairs) {
    const run = runMatch(G, a, b, { cap: capSec || 25, observe: true, seed: 770001 + a.length, nanCheck: false });
    for (const rec of (run.pushes || [])) cls.add(rec.cls);
    if (run.err) { /* 基线对局异常与观者无关，忽略 */ }
  }
  return cls;
}

function pickTop5(T) {
  const first = T.CARDS.slice(0, 5).map(c => c.id);
  const ok = first.every(id => W4_IDS.indexOf(id) < 0);
  if (ok) return first;
  return T.CARDS.filter(c => W4_IDS.indexOf(c.id) < 0).slice(0, 5).map(c => c.id);
}

const OBS = {
  talk_to_the_hand: { opponent: 'dark_embrace', cap: 60, runs: 2, key: 'hand' },
  alpha: { opponent: 'dark_embrace', cap: 75, runs: 2, key: 'alpha' },
  /* 许愿的「永生不死」概率 = 0.5×(1-hp比例)，血高时几乎抽不到 → 多跑几个种子（Lead 口径 MECH_RUNS≥6） */
  wish: { opponent: 'dark_embrace', cap: 75, runs: 6, key: 'wish' },
  prostrate: { opponent: 'dark_embrace', cap: 80, runs: 2, key: 'prostrate' },
};

function observeCard(G, cardId, baseCls, opt) {
  const T = G.T;
  opt = opt || {};
  const cfg = OBS[cardId];
  const oppCandidates = pickTop5(T).filter(id => id !== cardId);
  const opponent = cfg.opponent && oppCandidates.indexOf(cfg.opponent) >= 0 ? cfg.opponent : oppCandidates[0];
  const runs = (opt.runs === undefined || opt.runs === null) ? cfg.runs : opt.runs;
  const cap = (opt.cap === undefined || opt.cap === null) ? cfg.cap : opt.cap;
  const STEP_DT = 1 / 120;
  const obs = {
    cardId: cardId, opponent: opponent, cap: cap, runsPlanned: runs,
    runs: [], err: null,
    newEffCls: new Map(), newUnitCls: new Map(),
    maxBlock: 0, maxStrength: 0, maxPlated: 0, maxMantra: 0, maxDivT: 0,
    minPrayerSpeedMul: 1, prayerFrames: 0,
    events: [], incoming: [], blockEvents: [],
    divWindows: [], coinDamage: 0, goldDamage: 0, lightDamage: 0,
    coinsFired: 0, wishShows: 0, waveFirstDelay: null, waveCount: 0,
    betaFirstT: null, omegaFirstT: null,
    /* 2026-10-23 迭代新增观测字段 */
    handSpawnsPerRun: [], handSlapEvents: [], mechHasSlapCd: null,
    handSlapSameSecMulti: 0, handMaxLive: 0,
    betaStats: null, omegaStats: null, spawnCdAfterMorph: [],
    waSummonCount: 0, betaSpawnCount: 0, waSummonMatched: 0,
    wishShowPts: [], wishRecPts: [], wishMaxFreeze: 0, wishRecovered: false, wishEndSpeedMul: null,
    proWindupWindows: [], proWindupCycles: [], proWindupExitBad: 0, proWindupSpeedPts: [], proWindupTexts: [],
    proPrayEnterMantra: [], proBeamDelay: null, proBeamSpeedMax: 0, proChargeCount: 0,
    proWindupHits: 0,
    enemyHpDrops: 0,
  };
  const isIntegrated = !!T.CARD_BY_ID[cardId] && mechRegistered(T, cardId);
  if (!isIntegrated) {
    obs.err = '机制未集成（MECHS.' + ((T.CARD_BY_ID[cardId] || {}).mech || '?') + ' 未注册）';
    return obs;
  }
  for (let r = 0; r < runs; r++) {
    const t0 = Date.now();
    const step = {
      maxBlock: 0, maxStrength: 0, maxPlated: 0, maxMantra: 0, maxDivT: 0,
      minPrayerSpeedMul: 1, prayerFrames: 0, lastMantra: 0, divWindows: [],
      /* talk：按 slot 记录每只手自己的 cd，cd 从 ~0 跳回 slapCd 即视为该手拍了一次 */
      handCd: new Map(), handSlapTimes: [], mechHasSlapCd: null,
      /* alpha：用对象身份跟踪贝塔/欧米伽的位移与属性 */
      betaMap: new Map(), omegaMap: new Map(), spawnCdAfterMorph: [], omPrev: 0,
      /* wish：show/recover 两段 speedMul 序列 + freeze 峰值 */
      wishShow: [], wishRec: [], wishMaxFreeze: 0, wishRecovered: false, wishEndSpeedMul: null,
      /* prostrate：状态机/前摇窗口/光柱底座位置 */
      proState: null, windupStart: null, windupWindows: [], windupCycles: [], windupExitBad: 0,
      windupSpeed: [], windupTexts: [], prayEnterMantra: [],
      divStart: null, beamDelay: null, beamSpeedMax: 0, prevBeam: null,
    };
    const onStep = (w) => {
      let me = null;
      for (const u of w.units) {
        if (u.team === 0 && u.card && u.card.id === cardId) { me = u; break; }
      }
      if (!me) return;
      if (me.block > step.maxBlock) step.maxBlock = me.block;
      if (me.strength > step.maxStrength) step.maxStrength = me.strength;
      if (me.plated > step.maxPlated) step.maxPlated = me.plated;
      if (me.mantra > step.maxMantra) step.maxMantra = me.mantra;
      if (me.divT > step.maxDivT) step.maxDivT = me.divT;
      if (me.mantra > step.lastMantra) {
        step.prayerFrames++;
        if (me.speedMul < step.minPrayerSpeedMul) step.minPrayerSpeedMul = me.speedMul;
      }
      step.lastMantra = me.mantra;
      if (me.divT > 0) {
        const last = step.divWindows[step.divWindows.length - 1];
        if (last && w.t - last[1] < 0.2) last[1] = w.t;
        else step.divWindows.push([w.t, w.t]);
      }
      const m = me.mech || null;
      /* ---------- 以手拒之：生成曲线 / 每只手独立冷却 ---------- */
      if (cardId === 'talk_to_the_hand' && m) {
        step.mechHasSlapCd = Object.prototype.hasOwnProperty.call(m, 'slapCd');
        const hands = m.hands || [];
        if (hands.length > obs.handMaxLive) obs.handMaxLive = hands.length;
        for (const h of hands) {
          const slot = h.slot;
          const prev = step.handCd.get(slot);
          const cd = h.cd;
          if (prev !== undefined && cd > prev + 1.0) {
            step.handCd.set(slot, cd);
            step.handSlapTimes.push({ slot: slot, t: w.t });
            continue;
          }
          step.handCd.set(slot, cd);
        }
      }
      /* ---------- 阿尔法：贝塔（移动）/欧米伽（原地）位移与属性 ---------- */
      if (cardId === 'alpha') {
        for (const u of w.units) {
          const id = (u.card && u.card.id) || '';
          if (id !== 'beta' && id !== 'omega') continue;
          const map = id === 'beta' ? step.betaMap : step.omegaMap;
          let e = map.get(u);
          if (!e) {
            e = { x0: u.x, y0: u.y, maxDisp: 0, spd: null, sizeMul: u.sizeMul,
                  ghost: !!u.ghost, appearMin: 9 };
            map.set(u, e);
          } else {
            const d = Math.hypot(u.x - e.x0, u.y - e.y0);
            if (d > e.maxDisp) e.maxDisp = d;
            try { if (typeof u.curSpeed === 'function') e.spd = +u.curSpeed().toFixed(1); } catch (err) { }
            if (u.sizeMul !== undefined) e.sizeMul = u.sizeMul;
            if (u.ghost) e.ghost = true;
          }
          /* 欧米伽变身缩放动画：记录 appearScale 的最小值（应从 0.55 涨到 1） */
          if (id === 'omega' && typeof u.appearScale === 'function') {
            const ap = u.appearScale();
            if (ap < e.appearMin) e.appearMin = ap;
          }
        }
        /* 贝塔→欧米伽转化后：仅当场上还有另一只贝塔时，阿尔法的召唤冷却重置为 betaIv */
        if (m && m.omegas) {
          const n = m.omegas.filter(o => o.alive && !o.dying && !o.finished).length;
          if (n > (step.omPrev || 0) && typeof m.spawnCd === 'number') {
            const left = (m.betas || []).filter(o => o.alive && !o.dying && !o.finished).length;
            step.spawnCdAfterMorph.push({ cd: m.spawnCd, left: left });
          }
          step.omPrev = n;
        }
      }
      /* ---------- 许愿：show/recover 线性减速 + freeze 恒 0 ---------- */
      if (cardId === 'wish') {
        /* 只看存活期：引擎在 u.dying 时会强制 freeze=1 播死亡动画（与许愿机制无关） */
        if (me.alive && !me.dying && typeof me.freeze === 'number' && me.freeze > step.wishMaxFreeze) {
          step.wishMaxFreeze = me.freeze;
        }
        if (m && m.state === 'show') {
          step.wishShow.push({ t: w.t, sm: me.speedMul, elapsed: m.elapsed, freeze: me.freeze });
        } else if (m && m.state === 'recover') {
          step.wishRec.push({ t: w.t, sm: me.speedMul, recT: m.recT, freeze: me.freeze });
        } else if (m && m.state === 'idle' && step.wishRec.length) {
          step.wishRecovered = true;
          step.wishEndSpeedMul = me.speedMul;
        }
      }
      /* ---------- 五体投地：windup/pray/divine 状态机与光柱底座 ---------- */
      if (cardId === 'prostrate' && m) {
        const st = m.state || null;
        if (st === 'windup') {
          if (step.proState !== 'windup') {
            step.windupStart = w.t; step.windupSpeed = []; step.windupTexts = [];
          }
          step.windupSpeed.push({ t: w.t, sm: me.speedMul });
          let txt = null;
          try { txt = (typeof m.statusText === 'function') ? m.statusText() : null; } catch (err) { }
          if (txt && txt.t) step.windupTexts.push(String(txt.t));
        } else if (step.proState === 'windup') {
          step.windupWindows.push({ t0: step.windupStart, t1: w.t, dur: w.t - step.windupStart });
          step.windupCycles.push({
            pts: step.windupSpeed.slice(),
            dur: w.t - step.windupStart,
            exitTo: st,
          });
          if (st !== 'pray') step.windupExitBad++;
          step.windupStart = null;
        }
        if (st === 'pray' && step.proState !== 'pray') step.prayEnterMantra.push(me.mantra);
        if (st === 'divine') {
          if (step.divStart === null) step.divStart = w.t;
          if (m.beam) {
            if (step.beamDelay === null) step.beamDelay = w.t - step.divStart;
            const b = m.beam;
            if (step.prevBeam && typeof b.bx === 'number') {
              const d = Math.hypot(b.bx - step.prevBeam.x, b.by - step.prevBeam.y);
              const v = d / STEP_DT;
              if (v > step.beamSpeedMax) step.beamSpeedMax = v;
            }
            if (typeof b.bx === 'number') step.prevBeam = { x: b.bx, y: b.by };
          } else step.prevBeam = null;
        } else { step.divStart = null; step.prevBeam = null; }
        step.proState = st;
      }
    };
    G.handSlaps.length = 0;
    const run = runMatch(G, cardId, opponent, {
      cap: cap, dt: STEP_DT, seed: 900001 + r * 7919 + cardId.length * 13,
      observe: true, sampleEvery: 12, nanCheck: true, onStep: onStep,
    });
    const slaps = G.handSlaps.slice();
    /* 合并逐微步峰值 + 神格窗口 */
    if (step.maxBlock > obs.maxBlock) obs.maxBlock = step.maxBlock;
    if (step.maxStrength > obs.maxStrength) obs.maxStrength = step.maxStrength;
    if (step.maxPlated > obs.maxPlated) obs.maxPlated = step.maxPlated;
    if (step.maxMantra > obs.maxMantra) obs.maxMantra = step.maxMantra;
    if (step.maxDivT > obs.maxDivT) obs.maxDivT = step.maxDivT;
    if (step.minPrayerSpeedMul < obs.minPrayerSpeedMul) obs.minPrayerSpeedMul = step.minPrayerSpeedMul;
    obs.prayerFrames += step.prayerFrames;
    obs.divWindows = obs.divWindows.concat(step.divWindows);
    /* 新迭代观测合并 */
    if (cardId === 'talk_to_the_hand') {
      if (step.mechHasSlapCd !== null) obs.mechHasSlapCd = step.mechHasSlapCd;
      /* 优先用 WatcherHand.waImpact 钩子（精确到 slot）；没有钩子时退回 cd 跳变检测 */
      const slapEvents = slaps.length ? slaps : step.handSlapTimes;
      /* 同一秒里由不同手拍出的次数（独立冷却的证据；旧全局节流不可能出现） */
      for (let i = 0; i < slapEvents.length; i++) {
        const t0s = slapEvents[i].t;
        const slots = new Set();
        for (const e of slapEvents) if (e.t >= t0s && e.t < t0s + 1.0) slots.add(e.slot);
        if (slots.size >= 2) { obs.handSlapSameSecMulti++; break; }
      }
      obs.handSlapEvents = obs.handSlapEvents.concat(slapEvents.map(e => ({ t: e.t, slot: e.slot, run: r })));
      /* 生成时刻来自 push 记录（WatcherHand 的创建；对手的 DemonHand 不算） */
      const handTimes = (run.pushes || [])
        .filter(p => p.kind === 'effect' && (/watcherhand/i.test(p.cls) || (!baseCls.has(p.cls) && /hand/i.test(p.cls))))
        .map(p => p.t).sort((a, b) => a - b);
      if (handTimes.length) obs.handSpawnsPerRun.push({ seed: 900001 + r * 7919 + cardId.length * 13, times: handTimes });
    }
    if (cardId === 'alpha') {
      const aggBeta = { maxDisp: 0, spd: null, sizeMul: null, ghostN: 0, count: 0 };
      for (const e of step.betaMap.values()) {
        aggBeta.count++;
        if (e.maxDisp > aggBeta.maxDisp) aggBeta.maxDisp = e.maxDisp;
        if (e.spd !== null) aggBeta.spd = e.spd;
        if (e.sizeMul !== undefined && e.sizeMul !== null) aggBeta.sizeMul = e.sizeMul;
        if (e.ghost) aggBeta.ghostN++;
      }
      const aggOmega = { maxDisp: 0, spd: null, sizeMul: null, ghostN: 0, appearMin: 9, count: 0 };
      for (const e of step.omegaMap.values()) {
        aggOmega.count++;
        if (e.maxDisp > aggOmega.maxDisp) aggOmega.maxDisp = e.maxDisp;
        if (e.spd !== null) aggOmega.spd = e.spd;
        if (e.sizeMul !== undefined && e.sizeMul !== null) aggOmega.sizeMul = e.sizeMul;
        if (e.ghost) aggOmega.ghostN++;
        if (e.appearMin < aggOmega.appearMin) aggOmega.appearMin = e.appearMin;
      }
      obs.betaStats = mergeStat(obs.betaStats, aggBeta);
      obs.omegaStats = mergeStat(obs.omegaStats, aggOmega);
      obs.spawnCdAfterMorph = obs.spawnCdAfterMorph.concat(step.spawnCdAfterMorph);
    }
    if (cardId === 'wish') {
      obs.wishShowPts = obs.wishShowPts.concat(step.wishShow);
      obs.wishRecPts = obs.wishRecPts.concat(step.wishRec);
      if (step.wishMaxFreeze > obs.wishMaxFreeze) obs.wishMaxFreeze = step.wishMaxFreeze;
      if (step.wishRecovered) obs.wishRecovered = true;
      if (step.wishEndSpeedMul !== null) obs.wishEndSpeedMul = step.wishEndSpeedMul;
    }
    if (cardId === 'prostrate') {
      obs.proWindupWindows = obs.proWindupWindows.concat(step.windupWindows);
      obs.proWindupCycles = obs.proWindupCycles.concat(step.windupCycles);
      obs.proWindupExitBad += step.windupExitBad;
      obs.proWindupSpeedPts = obs.proWindupSpeedPts.concat(step.windupSpeed);
      obs.proWindupTexts = obs.proWindupTexts.concat(step.windupTexts);
      obs.proPrayEnterMantra = obs.proPrayEnterMantra.concat(step.prayEnterMantra);
      if (step.beamDelay !== null && (obs.proBeamDelay === null || step.beamDelay < obs.proBeamDelay)) {
        obs.proBeamDelay = step.beamDelay;
      }
      if (step.beamSpeedMax > obs.proBeamSpeedMax) obs.proBeamSpeedMax = step.beamSpeedMax;
    }
    const rec = {
      seed: 900001 + r * 7919 + cardId.length * 13,
      result: run.result, t: run.t, err: run.err ? (run.err.message || String(run.err)) : null,
      nan: run.nan, pushes: run.pushes || [],
      damage: G.damageLog.slice(), blocks: G.blockLog.slice(),
      ms: Date.now() - t0,
    };
    obs.runs.push(rec);
    if (run.err) obs.err = '对局抛异常：' + rec.err;
    if (run.nan && run.nan.length) obs.nan = (obs.nan || []).concat(run.nan);

    /* —— 来自 push 记录器的新增 Effect/Unit 类 + 许愿金币统计 —— */
    for (const p of rec.pushes) {
      if (p.kind === 'effect' && /coin/i.test(p.cls)) obs.coinsFired++;
      if (p.kind === 'effect' && /wishcards/i.test(p.cls)) obs.wishShows++;
      if (p.kind === 'effect' && /prostratecharge/i.test(p.cls)) obs.proChargeCount++;
      const map = p.kind === 'unit' ? obs.newUnitCls : obs.newEffCls;
      if (baseCls.has(p.cls)) continue;
      if (p.kind === 'unit' && p.cls === 'Unit') continue;
      if (!map.has(p.cls)) map.set(p.cls, { cls: p.cls, count: 0, firstT: p.t, cards: new Set() });
      const e = map.get(p.cls);
      e.count++;
      if (p.t < e.firstT) e.firstT = p.t;
      if (p.card) e.cards.add(p.card);
    }
    /* 阿尔法：每次种贝塔都应创建 1 个 WAAlphaSummon（2026-10-23 第三轮召唤演出） */
    if (cardId === 'alpha') {
      const betaTimes = [], summonTimes = [];
      for (const p of rec.pushes) {
        if (p.kind === 'unit' && /beta/i.test(p.cls + '|' + (p.card || ''))) betaTimes.push(p.t);
        if (p.kind === 'effect' && /WAAlphaSummon/i.test(p.cls)) summonTimes.push(p.t);
      }
      betaTimes.sort((a, b) => a - b);
      summonTimes.sort((a, b) => a - b);
      obs.betaSpawnCount += betaTimes.length;
      obs.waSummonCount += summonTimes.length;
      for (const bt of betaTimes) {
        if (summonTimes.some(st => Math.abs(st - bt) <= 0.2)) obs.waSummonMatched++;
      }
    }
    /* —— 每步状态采样（观测峰值/祈祷窗口） —— */
    let lastMantra = 0;
    for (const s of run.samples) {
      const me = s.units.filter(u => u.team === 0 && u.id === cardId)[0];
      if (me) {
        if (me.block > obs.maxBlock) obs.maxBlock = me.block;
        if (me.strength > obs.maxStrength) obs.maxStrength = me.strength;
        if (me.plated > obs.maxPlated) obs.maxPlated = me.plated;
        if (me.mantra > obs.maxMantra) obs.maxMantra = me.mantra;
        if (me.divT > obs.maxDivT) obs.maxDivT = me.divT;
        if (me.mantra > lastMantra) {
          obs.prayerFrames++;
          if (me.speedMul < obs.minPrayerSpeedMul) obs.minPrayerSpeedMul = me.speedMul;
        }
        lastMantra = me.mantra;
        if (me.divT > 0) {
          const last = obs.divWindows[obs.divWindows.length - 1];
          if (last && s.t - last[1] < 0.2) last[1] = s.t;
          else obs.divWindows.push([s.t, s.t]);
        }
      }
    }
    /* —— 伤害/格挡事件（本卡在左，team 0 -> team 1） —— */
    for (const ev of rec.damage) {
      const fromCardSide = ev.targetTeam === 1 &&
        (ev.srcTeam === 0 || ev.srcTeam === null || ev.srcTeam === undefined);
      if (fromCardSide) {
        obs.events.push({ t: ev.t, amount: ev.amount, kind: ev.kind, targetId: ev.targetId, srcTeam: ev.srcTeam });
        if (ev.kind === 'light') obs.lightDamage++;
        if (ev.kind === 'gold') obs.goldDamage++;
        if (typeof ev.amount === 'number' && ev.amount <= 40) obs.coinDamage++;
      } else if (ev.srcTeam === 1 && ev.targetTeam === 0) {
        obs.incoming.push({ t: ev.t, amount: ev.amount, kind: ev.kind });
        /* 前摇期间挨打次数（前摇不可打断的证据：这些伤害落在 windup 窗口里） */
        if (cardId === 'prostrate') {
          for (const w of step.windupWindows) {
            if (ev.t >= w.t0 && ev.t <= w.t1) { obs.proWindupHits++; break; }
          }
        }
      }
    }
    for (const b of rec.blocks) if (b.team === 0) obs.blockEvents.push(b);
  }
  /* 光柱伤害的兜底口径：所有落在神格窗口内的本卡伤害都算光柱命中 */
  for (const ev of obs.events) {
    for (const w of obs.divWindows) {
      if (ev.t >= w[0] - 0.05 && ev.t <= w[1] + 0.25) { obs.beamWindowDamage = (obs.beamWindowDamage || 0) + 1; break; }
    }
  }
  /* beta / omega 首次出现时间 + 阿尔法首波创建时刻（按 Effect 创建，不按命中） */
  for (const rec of obs.runs) {
    const seenTimes = [];
    for (const p of rec.pushes) {
      if (p.kind !== 'unit') continue;
      if (baseCls.has(p.cls) || p.cls === 'Unit') continue;
      const tag = (p.cls + '|' + (p.card || '')).toLowerCase();
      if (/beta|贝塔|花苞/.test(tag)) { if (obs.betaFirstT === null || p.t < obs.betaFirstT) obs.betaFirstT = p.t; }
      if (/omega|欧米/.test(tag)) { if (obs.omegaFirstT === null || p.t < obs.omegaFirstT) obs.omegaFirstT = p.t; }
      if (!seenTimes.length || p.t - seenTimes[seenTimes.length - 1] > 0.5) seenTimes.push(p.t);
    }
    obs.unitCreationTimes = (obs.unitCreationTimes || []).concat(seenTimes);
    if (obs.cardId === 'alpha') {
      const omegas = rec.pushes
        .filter(p => p.kind === 'unit' && /omega|欧米/i.test(p.cls + '|' + (p.card || '')))
        .map(p => p.t).sort((a, b) => a - b);
      const effNewT = rec.pushes
        .filter(p => p.kind === 'effect' && !baseCls.has(p.cls))
        .map(p => p.t).sort((a, b) => a - b);
      obs.waveCount += effNewT.length;
      if (omegas.length) {
        const after = effNewT.filter(t => t >= omegas[0] - 1e-6);
        if (after.length) {
          const d = after[0] - omegas[0];
          if (obs.waveFirstDelay === null || d < obs.waveFirstDelay) obs.waveFirstDelay = d;
        }
      }
    }
  }
  if (obs.betaFirstT === null && obs.newUnitCls.size >= 2) {
    const times = Array.from(obs.newUnitCls.values()).map(v => v.firstT).sort((a, b) => a - b);
    obs.betaFirstT = times[0];
    obs.omegaFirstT = times[1];
  }
  return obs;
}

function mergeStat(prev, cur) {
  const g = x => (x === undefined || x === null ? 0 : x);
  if (!prev) {
    return {
      maxDisp: cur.maxDisp, spd: cur.spd, sizeMul: cur.sizeMul,
      ghostN: g(cur.ghostN), appearMin: cur.appearMin === undefined ? 9 : cur.appearMin, count: cur.count,
    };
  }
  return {
    maxDisp: Math.max(prev.maxDisp, cur.maxDisp),
    spd: cur.spd !== null ? cur.spd : prev.spd,
    sizeMul: cur.sizeMul !== undefined && cur.sizeMul !== null ? cur.sizeMul : prev.sizeMul,
    ghostN: g(prev.ghostN) + g(cur.ghostN),
    appearMin: Math.min(prev.appearMin === undefined ? 9 : prev.appearMin,
      cur.appearMin === undefined ? 9 : cur.appearMin),
    count: prev.count + cur.count,
  };
}

function mechRegistered(T, cardId) {
  const c = T.CARD_BY_ID[cardId];
  return !!(c && c.mech && typeof T.MECHS[c.mech] === 'function');
}

/* 每张卡的断言（全部可观测，不依赖具体类名） */
function judgeMechanism(G, obs) {
  const T = G.T;
  const c = T.CARD_BY_ID[obs.cardId] || {};
  const p = c.p || {};
  const asserts = [];
  const add = (name, ok, detail) => asserts.push({ name: name, ok: !!ok, detail: detail || '' });
  const newEff = Array.from(obs.newEffCls.keys());
  const newUnit = Array.from(obs.newUnitCls.keys());
  const dmgN = obs.events.length;
  const dmgSum = obs.events.reduce((a, e) => a + (Number(e.amount) || 0), 0);
  const hasClass = re => newEff.concat(newUnit).some(k => re.test(k));
  /* 线性拟合相关系数 r（用于"线性减速/加速"断言） */
  const pearson = pts => {
    const n = pts.length;
    if (n < 3) return null;
    const mx = pts.reduce((a, q) => a + q[0], 0) / n;
    const my = pts.reduce((a, q) => a + q[1], 0) / n;
    let sx = 0, sy = 0, sxy = 0;
    for (const [x, y] of pts) { const dx = x - mx, dy = y - my; sx += dx * dx; sy += dy * dy; sxy += dx * dy; }
    if (sx < 1e-12 || sy < 1e-12) return null;
    return sxy / Math.sqrt(sx * sy);
  };
  /* 按时间断层把同一状态的连续采样切成"每一次 show / recover / windup"的独立段 */
  const splitCycles = (pts, key) => {
    const out = [];
    let cur = [];
    for (const q of pts) {
      const prev = cur[cur.length - 1];
      const broken = prev && (q.t < prev.t || q.t - prev.t > 0.5 ||
        (key && q[key] !== undefined && prev[key] !== undefined && q[key] < prev[key] - 1e-6));
      if (broken) { if (cur.length) out.push(cur); cur = []; }
      cur.push(q);
    }
    if (cur.length) out.push(cur);
    return out;
  };

  if (obs.err) {
    add('运行无异常', false, obs.err);
    return asserts;
  }
  add('运行无异常', true, obs.runs.length + ' 局 / 种子 ' + obs.runs.map(r => r.seed).join(','));
  add('无 NaN / 非有限数', !(obs.nan && obs.nan.length), (obs.nan && obs.nan.length) ? JSON.stringify(obs.nan[0]) : 'x/y/hp/block/... 全部有限');
  add('产生了新增 Effect/Unit 类', (newEff.length + newUnit.length) > 0,
    'effect=[' + newEff.slice(0, 8).join(',') + '] unit=[' + newUnit.slice(0, 6).join(',') + ']');

  if (obs.cardId === 'talk_to_the_hand') {
    add('手掌存在（新增 Effect 类）', newEff.length > 0 || hasClass(/hand|palm|slap/i), newEff.join(','));
    add('限时格挡生效（addTimedBlock 或 block>0）', obs.blockEvents.length > 0 || obs.maxBlock > 0,
      'addTimedBlock×' + obs.blockEvents.length + '，峰值格挡 ' + obs.maxBlock.toFixed(1));
    add('拍击造成伤害', dmgN > 0, '伤害事件 ' + dmgN + ' 次，合计 ' + dmgSum.toFixed(0));
    /* ① 生成成长曲线：first 1.8s，之后间隔 6.0/5.28/4.65/4.09/3.60（×handShrink），约 25.4s 长满 6 只 */
    const spawns = obs.handSpawnsPerRun.slice().sort((a, b) => b.times.length - a.times.length)[0];
    const shrink = p.handShrink === undefined ? 0.88 : p.handShrink;
    const handIv0 = p.handIv === undefined ? 6.0 : p.handIv;
    if (spawns) {
      const times = spawns.times;
      const gaps = [];
      for (let i = 1; i < times.length; i++) gaps.push(+(times[i] - times[i - 1]).toFixed(2));
      const expectGaps = [];
      let iv = handIv0;
      for (let i = 0; i < 5; i++) { expectGaps.push(+iv.toFixed(2)); iv *= shrink; }
      /* 抓取/击退会暂停召唤计时，所以容差放宽到 0.4s（实测与理论差） */
      const gapOk = gaps.slice(0, 5).every((g, i) => i < expectGaps.length && Math.abs(g - expectGaps[i]) <= 0.4);
      const decreasing = gaps.every((g, i) => i === 0 || g <= gaps[i - 1] + 0.4);
      const fullT = expectGaps.reduce((a, x) => a + x, 0) + (p.first === undefined ? 1.8 : p.first);
      const fullOk = times.length >= 6 && Math.abs(times[5] - fullT) <= 2.0;
      add('手掌成长曲线：满 6 只、间隔 6.0/5.28/4.65/4.09/3.60（±0.4s）',
        times.length >= 6 && gapOk && decreasing && fullOk,
        '生成时刻 [' + times.slice(0, 6).map(t => t.toFixed(2)).join(', ') + ']，间隔 [' +
        gaps.slice(0, 5).join(', ') + ']（理论 [' + expectGaps.join(', ') + ']；满 6 只 ' +
        (times.length >= 6 ? times[5].toFixed(1) + 's（理论≈' + fullT.toFixed(1) + 's）' : '未满') + '）');
    } else {
      add('手掌成长曲线：满 6 只、间隔 6.0/5.28/4.65/4.09/3.60（±0.4s）', false, '未观测到 WatcherHand 生成记录');
    }
    /* ② 每只手独立冷却：同一 slot 两次拍击间隔 ≥ slapCd-0.05；mech.slapCd 已删除。
       注意按 (run, slot) 分组 —— 不同对局的 t 会重新从 0 开始。 */
    const bySlot = {};
    for (const e of obs.handSlapEvents) (bySlot[e.run + ':' + e.slot] = bySlot[e.run + ':' + e.slot] || []).push(e.t);
    let minInterval = Infinity, repeatedSlots = 0, intervalOk = true;
    for (const slot of Object.keys(bySlot)) {
      const ts = bySlot[slot].sort((a, b) => a - b);
      if (ts.length >= 2) repeatedSlots++;
      for (let i = 1; i < ts.length; i++) {
        const dt = ts[i] - ts[i - 1];
        if (dt < minInterval) minInterval = dt;
        if (dt < (p.slapCd || 11.5) - 0.05) intervalOk = false;
      }
    }
    const cd = p.slapCd === undefined ? 11.5 : p.slapCd;
    add('每只手独立拍击冷却（同 slot 间隔 ≥ ' + cd + 's-0.05）',
      intervalOk && repeatedSlots > 0,
      '有 ≥2 次拍击的手 ' + repeatedSlots + ' 只，最短同手间隔 ' +
      (minInterval === Infinity ? '—' : minInterval.toFixed(2) + 's') +
      '；总拍击 ' + obs.handSlapEvents.length + ' 次');
    add('MechTalkToTheHand 已无全局 slapCd 字段', obs.mechHasSlapCd === false,
      'mech.slapCd = ' + (obs.mechHasSlapCd ? '存在（旧全局节流）' : 'undefined ✓'));
    add('独立冷却证据：同 1 秒内多只手拍击', obs.handSlapSameSecMulti > 0,
      '观测到 ' + obs.handSlapSameSecMulti + ' 次「同一秒多只手拍击」（旧全局节流不可能出现）');
    add('手掌数量上限 handMax', obs.handMaxLive === (p.handMax || 6),
      '实测同时在场上限 ' + obs.handMaxLive + '（handMax=' + (p.handMax || 6) + '）');
    add('手掌贴图尺寸 handSize=54（放大）', (p.handSize || 0) >= 50, 'p.handSize=' + p.handSize);
  } else if (obs.cardId === 'alpha') {
    add('贝塔/欧米伽单位出现', (obs.betaFirstT !== null) || (obs.omegaFirstT !== null) || newUnit.length >= 2,
      'newUnit=[' + newUnit.join(',') + '] betaT=' + fmtSec(obs.betaFirstT) + ' omegaT=' + fmtSec(obs.omegaFirstT));
    add('欧米伽出现（贝塔→欧米伽转化）', obs.omegaFirstT !== null || newUnit.length >= 2,
      'omegaT=' + fmtSec(obs.omegaFirstT));
    if (obs.betaFirstT !== null && obs.omegaFirstT !== null) {
      const need = Math.max(4.5, (p.betaGrow || 7) * 0.8);
      add('贝塔→欧米伽延迟 ≥ betaGrow 量级(' + (p.betaGrow || 7) + 's)', (obs.omegaFirstT - obs.betaFirstT) >= need,
        '首次贝塔→首次欧米伽 ' + (obs.omegaFirstT - obs.betaFirstT).toFixed(2) + 's' +
        '（首只贝塔被对手打掉时会明显 >7s，属机制正常）');
    }
    add('冲击波造成伤害', dmgN > 0, '伤害事件 ' + dmgN + ' 次，合计 ' + dmgSum.toFixed(0));
    if (obs.waveFirstDelay !== null) {
      const wf = p.omegaFirst === undefined ? 3 : p.omegaFirst;
      add('欧米伽首波提前（按冲击波创建时刻，omegaFirst=' + wf + 's）', obs.waveFirstDelay <= wf + 0.3,
        '欧米伽出现后 ' + obs.waveFirstDelay.toFixed(2) + 's 创建第一道冲击波（阈值 ' + (wf + 0.3).toFixed(2) +
        's；旧版要等 omegaWaveCd=' + (p.omegaWaveCd === undefined ? 3 : p.omegaWaveCd) + 's）');
    } else {
      add('欧米伽首波提前（按冲击波创建时刻）', false, '没有观测到欧米伽 + 新增冲击波 Effect');
    }
    add('冲击波命中统计（信息）', true, '创建冲击波 ' + obs.waveCount + ' 道 / 命中 ' + dmgN + ' 次' +
      '（半径 ' + (p.omegaWaveR === undefined ? '?' : p.omegaWaveR) + '，敌人不在圈里时首波不掉血属正常）');
    /* 2026-10-23 第四轮：尺寸=仆从 / 敌我碰撞 / 变身缩放 / 数值节奏 */
    const bs = obs.betaStats || { maxDisp: 0, spd: null, sizeMul: null, ghostN: 0, count: 0 };
    const os = obs.omegaStats || { maxDisp: 0, spd: null, sizeMul: null, ghostN: 0, appearMin: 9, count: 0 };
    const betaSpeed = p.betaSpeed === undefined ? 120 : p.betaSpeed;
    add('贝塔实际在移动（10s 位移 > 300px）', bs.maxDisp > 300,
      '观测到 ' + bs.count + ' 只贝塔，最大位移 ' + bs.maxDisp.toFixed(0) + 'px');
    add('贝塔 curSpeed ≈ ' + betaSpeed + '（正常 150 的 0.8）',
      bs.spd !== null && Math.abs(bs.spd - betaSpeed) <= 5, '实测 ' + bs.spd + '（p.betaSpeed=' + p.betaSpeed + '）');
    add('欧米伽自身不移动（curSpeed=0）', os.count === 0 || (os.spd !== null && Math.abs(os.spd) <= 0.5),
      'curSpeed=' + os.spd + '；被击退/碰撞位移累计 ' + os.maxDisp.toFixed(1) +
      'px（实体单位会被撞开，不算自身移动）');
    add('贝塔/欧米伽尺寸=仆从（无 sizeMul 额外缩小）',
      bs.sizeMul === null && os.sizeMul === null,
      'beta sizeMul=' + bs.sizeMul + '，omega sizeMul=' + os.sizeMul + '（应为 null → 走 minion 的 0.8 倍卡面）');
    add('贝塔/欧米伽对敌我双方有碰撞（非 ghost）',
      bs.ghostN === 0 && os.ghostN === 0,
      'beta ghost 次数=' + bs.ghostN + '，omega ghost 次数=' + os.ghostN + '（都应为 0）');
    /* 直接构造重叠单位验证引擎真的会弹开（只读引擎行为，不改数值） */
    {
      T.resetMatch(T.CARD_BY_ID['alpha'], T.CARD_BY_ID['dark_embrace'], 20261023);
      const w = T.world, ap = T.CARD_BY_ID['alpha'].p;
      const oL = w.units[0], oR = w.units[1];
      w.over = null; w.running = true;
      /* 友方对：两只同队贝塔重叠在 (200,200) */
      const f1 = new T.BetaUnit(oL, ap, 200, 200), f2 = new T.BetaUnit(oL, ap, 200, 200);
      w.units.push(f1, f2);
      for (let i = 0; i < 8; i++) T.stepPhysics(1 / 120);
      const df = Math.hypot(f2.x - f1.x, f2.y - f1.y);
      /* 敌方对：友方贝塔 vs 敌方欧米伽重叠在 (420,420) */
      const b1 = new T.BetaUnit(oL, ap, 420, 420), m1 = new T.OmegaUnit(oR, ap, 420, 420);
      w.units.push(b1, m1);
      for (let i = 0; i < 8; i++) T.stepPhysics(1 / 120);
      const de = Math.hypot(m1.x - b1.x, m1.y - b1.y);
      const needF = ap.betaR + ap.betaR, needE = ap.betaR + ap.omegaR;
      add('重叠的贝塔/欧米伽会被物理弹开（友方+敌方）',
        df >= needF * 0.9 && de >= needE * 0.9 &&
        !f1.ghost && !f2.ghost && !b1.ghost && !m1.ghost,
        '同队贝塔间距 ' + df.toFixed(1) + 'px（半径和 ' + needF + '）；跨队 贝塔×欧米伽 ' + de.toFixed(1) +
        'px（半径和 ' + needE + '）');
    }
    /* 贝塔→欧米伽：欧米伽出场缩放动画（0.55 → 1.0） */
    add('贝塔→欧米伽有缩放动画（欧米伽 appearScale 从小到大）',
      os.count === 0 || (os.appearMin < 0.9 && os.appearMin >= 0.5),
      '欧米伽出现期间缩放下限 ' + os.appearMin + '（应 < 0.9，起始 0.55）');
    /* 转化后阿尔法召唤冷却重置：仅当场上还有另一只贝塔时触发（2026-10-23 修订口径） */
    const betaIv = p.betaIv === undefined ? 4.0 : p.betaIv;
    const morphSamples = obs.spawnCdAfterMorph;
    add('贝塔→欧米伽后阿尔法召唤冷却重置：仅“还有另一只贝塔”时触发',
      morphSamples.length === 0 || morphSamples.every(s =>
        s.left > 0 ? Math.abs(s.cd - betaIv) <= 0.2 : s.cd <= betaIv + 0.05),
      '转化样本（cd/剩余贝塔）=[' +
      morphSamples.map(s => s.cd.toFixed(2) + '/' + s.left).join(', ') +
      ']（有剩余贝塔时应 ≈ ' + betaIv + '）');
    add('omegaWaveDmg=150（欧米伽伤害提升）', p.omegaWaveDmg === 150,
      'p.omegaWaveDmg=' + p.omegaWaveDmg);
    add('omegaHp=100 / omegaMax=3（第四轮数值）', p.omegaHp === 100 && p.omegaMax === 3,
      'p.omegaHp=' + p.omegaHp + '，p.omegaMax=' + p.omegaMax);
    add('betaHp=100（贝塔生命下调）', p.betaHp === 100, 'p.betaHp=' + p.betaHp);
    /* 欧米伽继承贝塔当前生命（用户 2026-10-23 口径） */
    {
      T.resetMatch(T.CARD_BY_ID['alpha'], T.CARD_BY_ID['dark_embrace'], 20261024);
      const w = T.world, ap = T.CARD_BY_ID['alpha'].p;
      const owner = w.units[0], mech = owner.mech;
      w.over = null; w.running = true;
      const b = new T.BetaUnit(owner, ap, 300, 300);
      b.hp = 37;
      w.units.push(b); mech.betas.push(b);
      mech.waGrowOmega(b);
      const om = mech.omegas[mech.omegas.length - 1];
      add('转化的欧米伽继承贝塔当前生命（37 → 37）', !!om && om.hp === 37,
        '贝塔 37 血 → 欧米伽 ' + (om ? om.hp + '/' + om.maxHp : '—'));
    }
    /* 变身重置读条：仅当场上还有另一只贝塔时触发（2026-10-23 修订口径） */
    {
      T.resetMatch(T.CARD_BY_ID['alpha'], T.CARD_BY_ID['dark_embrace'], 20261025);
      const w = T.world, ap = T.CARD_BY_ID['alpha'].p, bIv = ap.betaIv;
      const owner = w.units[0], mech = owner.mech;
      w.over = null; w.running = true;
      /* ① 两只贝塔：转化其中一只 → 另一只还在 → 倒计时应被压回 betaIv */
      const b1 = new T.BetaUnit(owner, ap, 280, 300), b2 = new T.BetaUnit(owner, ap, 360, 300);
      w.units.push(b1, b2); mech.betas.push(b1, b2);
      mech.spawnCd = 0.5;
      mech.waGrowOmega(b1);
      const cdWithOther = mech.spawnCd;
      /* ② 只剩一只：转化它 → 没有另一只了 → 倒计时保持原值（不重置） */
      for (const t of mech.betas) if (t !== b2) { t.alive = false; t.finished = true; }
      mech.spawnCd = 0.5;
      mech.waGrowOmega(b2);
      const cdAlone = mech.spawnCd;
      add('变身重置读条仅在“还有另一只贝塔”时触发',
        Math.abs(cdWithOther - bIv) < 1e-9 && Math.abs(cdAlone - 0.5) < 1e-9,
        '还有另一只时 spawnCd=' + cdWithOther + '（应=' + bIv + '）；最后一只时 spawnCd=' +
        cdAlone + '（应保持 0.5 不重置）');
    }
    const waveR = p.omegaWaveR === undefined ? 200 : p.omegaWaveR;
    const waveSpd = p.waveSpd === undefined ? 320 : p.waveSpd;
    const waveLife = waveR / waveSpd * 1.12;
    add('omegaWaveR=200 / waveSpd=320（life≈0.70s）',
      p.omegaWaveR === 200 && p.waveSpd === 320 && Math.abs(waveLife - 0.70) <= 0.03,
      'p.omegaWaveR=' + p.omegaWaveR + '，p.waveSpd=' + p.waveSpd + '，理论 life=' + waveLife.toFixed(2) + 's');
    add('每次种贝塔都有召唤演出 WAAlphaSummon',
      obs.betaSpawnCount > 0 && obs.waSummonCount >= obs.betaSpawnCount &&
      obs.waSummonMatched === obs.betaSpawnCount && hasClass(/WAAlphaSummon/),
      '贝塔 spawn ' + obs.betaSpawnCount + ' 次 / WAAlphaSummon ' + obs.waSummonCount +
      ' 个 / 逐次匹配 ' + obs.waSummonMatched + '；新增类=[' + newEff.join(',') + ']');
  } else if (obs.cardId === 'wish') {
    add('许愿产生力量', obs.maxStrength > 0, '力量峰值 ' + obs.maxStrength);
    add('许愿产生多层护甲', obs.maxPlated > 0, 'plated 峰值 ' + obs.maxPlated);
    const coinHitRate = obs.coinsFired > 0 ? obs.goldDamage / obs.coinsFired : null;
    add('金币造成伤害', obs.goldDamage > 0 || (dmgN > 0 && obs.coinDamage > 0),
      'gold 伤害 ' + obs.goldDamage + ' 次；≤40 伤害 ' + obs.coinDamage + ' 次；伤害合计 ' + dmgSum.toFixed(0));
    add('金币反弹命中率（统计）', coinHitRate === null || (coinHitRate > 0 && coinHitRate <= 1.02),
      obs.coinsFired > 0
        ? '发射 ' + obs.coinsFired + ' 枚 / 命中 ' + obs.goldDamage + ' 次 = ' + (coinHitRate * 100).toFixed(1) + '%'
          + '（' + obs.wishShows + ' 次许愿演出，其中 gold 祝福 ' + Math.round(obs.coinsFired / (p.coins || 5)) + ' 次）'
        : '本批对局没有发射金币（未抽到名利双收？）');
    /* 2026-10-23 第三轮追加：永生不死的格挡按【加上本次之后】的 plated 总层数给（首刷 8，之后 16/24…） */
    const wishBlocks = obs.blockEvents.filter(b => b.id === 'wish');
    const blockMatch = wishBlocks.filter(b =>
      b.v > 0 && b.v % 8 === 0 && b.plated !== null && Math.abs(b.v - b.plated) < 1e-6);
    const hasFirst8 = wishBlocks.some(b => Math.abs(b.v - 8) < 1e-6);
    const hasOldZero = wishBlocks.some(b => b.v === 0);
    add('永生不死格挡 = 加层后 plated 总层数（首刷 8、之后 16/24…）',
      wishBlocks.length > 0 && blockMatch.length === wishBlocks.length && hasFirst8 && !hasOldZero,
      'addTimedBlock×' + wishBlocks.length + '，v=[' + wishBlocks.map(b => b.v).join(',') + ']，' +
      '当时 plated=[' + wishBlocks.map(b => b.plated).join(',') + ']；' +
      '首刷 8=' + hasFirst8 + '，旧口径 v=0 出现=' + hasOldZero);
    /* 2026-10-23：去掉 freeze，改为 show 线性减速 / recover 线性加速 */
    add('存活期无 freeze 硬停顿', obs.wishMaxFreeze === 0,
      '存活期 freeze 峰值 ' + obs.wishMaxFreeze + '（u.dying 时引擎会强制 freeze=1 播死亡动画，不算）');
    const slowDownT = p.slowDownT === undefined ? 0.45 : p.slowDownT;
    const slowMin = p.slowMin === undefined ? 0.5 : p.slowMin;
    const slowUpT = p.slowUpT === undefined ? 0.55 : p.slowUpT;
    /* —— show 段：每一轮独立拟合，避免把多轮采样拼成一条长线 —— */
    const showCycles = splitCycles(obs.wishShowPts, 'elapsed')
      .map(cy => {
        const pts = cy.filter(q => q.elapsed <= slowDownT + 0.08 && q.elapsed >= -0.01);
        if (pts.length < 3) return null;
        const r = pearson(pts.map(q => [q.elapsed, q.sm]));
        return {
          r: r,
          start: pts[0].sm,
          end: pts[pts.length - 1].sm,
          dur: pts[pts.length - 1].elapsed - pts[0].elapsed,
          freezeDrift: Math.max.apply(null, pts.map(q => Math.abs(q.freeze - pts[0].freeze))),
        };
      }).filter(Boolean);
    const showOk = showCycles.filter(c => c.r !== null && c.r < -0.99 &&
      c.start >= 0.95 && c.end <= slowMin + 0.06 && Math.abs(c.dur - slowDownT) <= 0.18);
    const showBest = showOk[0] || showCycles.slice().sort((a, b) => (a.r || 0) - (b.r || 0))[0] || null;
    add('许愿 show 期线性减速到 ' + slowMin, showOk.length > 0,
      '合格 ' + showOk.length + '/' + showCycles.length + ' 轮；最佳 r=' +
      (showBest && showBest.r !== null ? showBest.r.toFixed(4) : '—') + '，speedMul ' +
      (showBest ? showBest.start.toFixed(2) + '→' + showBest.end.toFixed(2) : '—') +
      '，时长 ' + (showBest ? showBest.dur.toFixed(2) : '—') + 's（理论 ' + slowDownT + 's）');
    /* —— recover 段 —— */
    const recCycles = splitCycles(obs.wishRecPts, 'recT')
      .map(cy => {
        if (cy.length < 3) return null;
        const r = pearson(cy.map(q => [q.recT, q.sm]));
        return { r: r, start: cy[0].sm, end: cy[cy.length - 1].sm, dur: cy[cy.length - 1].recT - cy[0].recT };
      }).filter(Boolean);
    const recOk = recCycles.filter(c => c.r !== null && c.r > 0.99 &&
      c.start <= slowMin + 0.08 && c.end >= 0.95 && Math.abs(c.dur - slowUpT) <= 0.2);
    const recBest = recOk[0] || recCycles.slice().sort((a, b) => (b.r || 0) - (a.r || 0))[0] || null;
    add('许愿 recover 期线性加速回 1', obs.wishRecovered && recOk.length > 0,
      '合格 ' + recOk.length + '/' + recCycles.length + ' 轮；最佳 r=' +
      (recBest && recBest.r !== null ? recBest.r.toFixed(4) : '—') + '，speedMul ' +
      (recBest ? recBest.start.toFixed(2) + '→' + recBest.end.toFixed(2) : '—') +
      '，时长 ' + (recBest ? recBest.dur.toFixed(2) : '—') + 's（理论 ' + slowUpT + 's）' +
      '，回满=' + obs.wishRecovered);
    /* —— 运行期无 freeze：wish 自己的 show 段里 freeze 不应被机制改动 —— */
    const freezeDrift = showCycles.length ? Math.max.apply(null, showCycles.map(c => c.freezeDrift)) : 0;
    add('show 期未设 freeze（机制不改 freeze）', freezeDrift < 1e-6,
      'show 段内 freeze 最大漂移 ' + freezeDrift.toFixed(4) + '（"运行期 freeze 恒 0"由静态源码检查兜底）');
  } else if (obs.cardId === 'prostrate') {
    add('真言递增', obs.maxMantra > 0, '真言峰值 ' + obs.maxMantra);
    add('真言满 ' + (p.mantraMax || 10) + ' 进入神格', obs.maxDivT > 0,
      '真言峰值 ' + obs.maxMantra + '（满层瞬间会清零，以神格出现为准）/ 神格峰值 ' + obs.maxDivT.toFixed(1) + 's');
    add('祈祷期间移速大幅下降', obs.prayerFrames === 0 || obs.minPrayerSpeedMul <= 0.5,
      '祈祷时 speedMul 最小 ' + obs.minPrayerSpeedMul.toFixed(2));
    add('光柱造成伤害', obs.lightDamage > 0 || (obs.beamWindowDamage || 0) > 0 || dmgN > 0,
      'light 伤害 ' + obs.lightDamage + ' 次；神格窗口内伤害 ' + (obs.beamWindowDamage || 0) + ' 次；伤害合计 ' + dmgSum.toFixed(0));
    /* 2026-10-23：windup 前摇 0.9s / 提前提示 / 线性减速 / 不可打断 / mantraOnEnter / 光柱追踪变慢 */
    const windWindows = obs.proWindupWindows;
    const wDur = p.prayWindT === undefined ? 0.9 : p.prayWindT;
    const avgDur = windWindows.length ? windWindows.reduce((a, x) => a + x.dur, 0) / windWindows.length : null;
    add('前摇 windup 存在且时长≈' + wDur + 's', windWindows.length > 0 && avgDur !== null && Math.abs(avgDur - wDur) <= 0.18,
      '观测 ' + windWindows.length + ' 次前摇，平均时长 ' + (avgDur === null ? '—' : avgDur.toFixed(2) + 's'));
    add('新 Effect 类 ProstrateCharge（蓄力环）', obs.proChargeCount > 0 && hasClass(/ProstrateCharge/),
      '创建 ' + obs.proChargeCount + ' 个 ProstrateCharge');
    /* 每次前摇单独拟合（绝对时间拼在一起会被"下一轮重新从 1 开始"破坏线性） */
    const slowTarget = p.prayerSlow === undefined ? 0.12 : p.prayerSlow;
    const wCycles = (obs.proWindupCycles || []).map(cy => {
      const pts = cy.pts || [];
      if (pts.length < 3) return null;
      const t0 = pts[0].t;
      const xs = pts.map(q => [q.t - t0, q.sm]);
      return {
        r: pearson(xs), start: pts[0].sm,
        end: pts[pts.length - 1].sm,
        min: Math.min.apply(null, pts.map(q => q.sm)),
        max: Math.max.apply(null, pts.map(q => q.sm)),
        dur: cy.dur, exitTo: cy.exitTo,
      };
    }).filter(Boolean);
    const wOk = wCycles.filter(c => c.r !== null && c.r < -0.99 && c.max >= 0.95 &&
      c.min <= slowTarget + 0.06 && Math.abs(c.dur - wDur) <= 0.18);
    const wBest = wOk[0] || wCycles[0] || null;
    add('前摇期 speedMul 线性 1→' + slowTarget, wOk.length > 0,
      '合格 ' + wOk.length + '/' + wCycles.length + ' 轮；最佳 r=' +
      (wBest && wBest.r !== null ? wBest.r.toFixed(4) : '—') + '，speedMul ' +
      (wBest ? wBest.max.toFixed(2) + '→' + wBest.min.toFixed(2) : '—') +
      '，时长 ' + (wBest ? wBest.dur.toFixed(2) : '—') + 's');
    const hasPrayerText = obs.proWindupTexts.some(t => t.indexOf('祈祷') >= 0 || t.indexOf('nya') >= 0);
    add('前摇期 statusText 提前显示「祈祷nya...」', hasPrayerText,
      '前摇期采样文本 ' + uniq(obs.proWindupTexts).join('/'));
    add('进入 pray 瞬间先送 mantraOnEnter 层真言', obs.proPrayEnterMantra.length > 0 &&
      obs.proPrayEnterMantra.some(m => m >= (p.mantraOnEnter === undefined ? 1 : p.mantraOnEnter)),
      '进入 pray 时真言 = [' + obs.proPrayEnterMantra.join(',') + ']（mantraOnEnter=' +
      (p.mantraOnEnter === undefined ? 1 : p.mantraOnEnter) + '）');
    add('前摇不可打断（windup→非 pray 退出 = 0）', obs.proWindupExitBad === 0,
      '异常退出 ' + obs.proWindupExitBad + ' 次；前摇期间挨打 ' + obs.proWindupHits + ' 次仍照常进入 pray');
    add('光柱底座追踪速度 ≤ beamFollowSpd+1', obs.proBeamSpeedMax <= (p.beamFollowSpd === undefined ? 250 : p.beamFollowSpd) + 1,
      '实测底座最大速度 ' + obs.proBeamSpeedMax.toFixed(1) + ' px/s（beamFollowSpd=' +
      (p.beamFollowSpd === undefined ? 250 : p.beamFollowSpd) + '）');
    add('光柱落下延迟 ≈ beamDelay=' + (p.beamDelay === undefined ? 0.7 : p.beamDelay) + 's',
      obs.proBeamDelay !== null && Math.abs(obs.proBeamDelay - (p.beamDelay === undefined ? 0.7 : p.beamDelay)) <= 0.2,
      '实测 ' + (obs.proBeamDelay === null ? '—' : obs.proBeamDelay.toFixed(2) + 's'));
  }
  return asserts;
}

/* ------------------------------------------------------------------ *
 *  6. 平衡：新 4 卡 × 顶行 5 卡
 * ------------------------------------------------------------------ */
function loadHistorical() {
  const out = { path: HIST_JSON, ok: false, top5: [], top5Avg: null, source: null };
  try {
    const j = JSON.parse(fs.readFileSync(HIST_JSON, 'utf8'));
    out.ok = true;
    out.source = { seed: j.seed, gamesPerPair: j.gamesPerPair, capSec: j.capSec, hz: j.hz, cardCount: j.cardCount };
    const overall = j.overall || {};
    out.top5 = TOP5_EXPECTED.map(id => ({
      id: id,
      name: (j.names && j.ids ? j.names[j.ids.indexOf(id)] : id) || id,
      winRate: overall[id] ? overall[id].winRate : null,
    })).filter(x => x.winRate !== null);
    if (out.top5.length) out.top5Avg = out.top5.reduce((a, x) => a + x.winRate, 0) / out.top5.length;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

function balanceVerdict(avgWinRate, high, low) {
  if (avgWinRate === null || avgWinRate === undefined) return 'UNKNOWN';
  if (avgWinRate > high) return 'OP';
  if (avgWinRate < low) return 'WEAK';
  return 'OK';
}
const VERDICT_CN = { OP: '明显超模', WEAK: '明显弱势', OK: '区间内', UNKNOWN: '数据不足' };

function runBalance(G, opt) {
  opt = opt || {};
  const T = G.T;
  const N = opt.N || 100;
  const cap = opt.CAP || 120;
  const hz = opt.HZ || 120;
  const dt = 1 / hz;
  const seed = opt.SEED || 20260922;
  const high = opt.high === undefined ? 0.65 : opt.high;
  const low = opt.low === undefined ? 0.35 : opt.low;
  const top5Ids = pickTop5(T);
  const top5Names = top5Ids.map(id => (T.CARD_BY_ID[id] || {}).name || id);
  const half = Math.floor(N / 2);
  const games = half * 2;
  const oldGate = T.SET ? T.SET.watcherCards : undefined;
  applyGate(T, true);           // 平衡口径 = 观者卡开启（与正式可玩状态一致）
  /* 每局不传 seed 时 resetMatch 走 makeSeed() -> Math.random()。
     沙箱里的 Math.random 已在 loadGame 用 mulberry32(SEED) 接管，所以整批对局
     可复现（与 balance120.js 的做法一致），这里不需要再替换。 */

  const planned = [];
  for (const spec of WATCHER_CARDS) {
    for (const oppId of top5Ids) planned.push([spec.id, oppId]);
  }
  const t0 = Date.now();
  let done = 0, totalGames = 0, drawGames = 0, timeSum = 0, longestAll = 0;
  const nanIssues = [];
  const pairResults = [];
  for (const [newId, oppId] of planned) {
    const rec = {
      newId: newId, oppId: oppId, games: games,
      wins: 0, losses: 0, draws: 0, winPts: 0, timeSum: 0, longest: 0,
      errors: 0, firstError: null,
    };
    for (let k = 0; k < games; k++) {
      const newLeft = k < half;
      let run;
      try {
        run = runMatch(G, newLeft ? newId : oppId, newLeft ? oppId : newId, {
          cap: cap, dt: dt, nanCheck: true, nanEvery: 240,
        });
      } catch (e) {
        run = { result: 'D', t: 0, err: e, nan: [], samples: [] };
      }
      /* 对局抛异常 = 这一场的结果不可信（会伪装成平局）。计数并在主流程里报 FAIL，
         免得"机制中间态抛异常"被当成 0 胜率的假平局混进平衡结论。 */
      if (run.err) {
        rec.errors++;
        if (!rec.firstError) rec.firstError = run.err.message || String(run.err);
      }
      if (run.nan && run.nan.length) nanIssues.push({ pair: newId + ' vs ' + oppId, issue: run.nan[0] });
      totalGames++; rec.timeSum += run.t; timeSum += run.t;
      if (run.t > rec.longest) rec.longest = run.t;
      if (run.t > longestAll) longestAll = run.t;
      const newWon = newLeft ? (run.result === 'L') : (run.result === 'R');
      const drew = run.result === 'D';
      if (drew) { rec.draws++; rec.winPts += 0.5; drawGames++; }
      else if (newWon) { rec.wins++; rec.winPts += 1; }
      else rec.losses++;
    }
    rec.winRate = rec.winPts / games;
    rec.avgTime = rec.timeSum / games;
    pairResults.push(rec);
    done++;
    console.log('  [' + String(done).padStart(2) + '/' + planned.length + '] ' +
      pad((T.CARD_BY_ID[newId] || {}).name || newId, 8) + ' vs ' +
      pad((T.CARD_BY_ID[oppId] || {}).name || oppId, 8) + '  ' +
      rec.wins + '-' + rec.losses + (rec.draws ? ' 平' + rec.draws : '') +
      '  → ' + fmtPct(rec.winRate) +
      (rec.errors ? '  ⚠异常' + rec.errors + '场' : '') +
      '   ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  if (T.SET && oldGate !== undefined) T.SET.watcherCards = oldGate;

  /* 按新卡聚合 */
  const perCard = [];
  for (const spec of WATCHER_CARDS) {
    const rows = pairResults.filter(r => r.newId === spec.id);
    const avg = rows.length ? rows.reduce((a, r) => a + r.winRate, 0) / rows.length : null;
    const wins = rows.reduce((a, r) => a + r.wins, 0);
    const losses = rows.reduce((a, r) => a + r.losses, 0);
    const draws = rows.reduce((a, r) => a + r.draws, 0);
    const g = rows.reduce((a, r) => a + r.games, 0);
    perCard.push({
      id: spec.id, name: spec.name, avgWinRate: avg,
      overallWinRate: g ? (wins + 0.5 * draws) / g : null,
      wins: wins, losses: losses, draws: draws, games: g,
      avgTime: rows.reduce((a, r) => a + r.avgTime * r.games, 0) / (g || 1),
      longest: rows.reduce((a, r) => Math.max(a, r.longest), 0),
      verdict: balanceVerdict(avg, high, low),
      vs: rows.map(r => ({ oppId: r.oppId, winRate: r.winRate })),
    });
  }
  return {
    seed: seed, N: games, capSec: cap, hz: hz, dt: dt,
    gamesPerPair: games, totalGames: totalGames, drawGames: drawGames,
    avgTime: timeSum / (totalGames || 1), longest: longestAll,
    top5: top5Ids, top5Names: top5Names,
    high: high, low: low,
    pairs: pairResults,
    perCard: perCard,
    nanIssues: nanIssues,
    errors: pairResults.filter(r => r.errors).map(r => ({
      newId: r.newId, oppId: r.oppId, count: r.errors, firstError: r.firstError,
    })),
    elapsedSec: (Date.now() - t0) / 1000,
  };
}

/* ------------------------------------------------------------------ *
 *  6b. 总体胜率：4 张新卡 × 全部老卡（Lead 2026-10-23 要求补进报告）
 *  用户以顶行五卡为参考；但顶行五卡是老卡里最强的一档（历史平均 62.7%），
 *  只看对顶行会显得新卡偏弱。这里再对【全部老卡】跑一遍总体胜率作交叉参考。
 * ------------------------------------------------------------------ */
function runOverall(G, opt) {
  opt = opt || {};
  const T = G.T;
  const N = opt.N || 40;
  const cap = opt.CAP || 120;
  const hz = opt.HZ || 120;
  const dt = 1 / hz;
  const seed = opt.SEED || 20260922;
  const oldCards = T.CARDS.filter(c => W4_IDS.indexOf(c.id) < 0).map(c => c.id);
  /* 老卡里 15 张有 _balance120.json 历史数据，另外 5 张是测试版转正卡；
     拆开统计能解释"总体胜率 vs 20 张"和"vs 有历史数据的 15 张"的差异。 */
  let histIds = [];
  try { histIds = JSON.parse(fs.readFileSync(HIST_JSON, 'utf8')).ids || []; } catch (e) { }
  const histSet = new Set(histIds);
  const half = Math.floor(N / 2);
  const oldGate = T.SET ? T.SET.watcherCards : undefined;
  applyGate(T, true);
  const t0 = Date.now();
  const pairs = [];
  const errors = [];
  const perCard = [];
  for (const spec of WATCHER_CARDS) {
    const agg = { id: spec.id, name: spec.name, wins: 0, losses: 0, draws: 0, games: 0, timeSum: 0, longest: 0, opponents: 0, pairs: 0 };
    for (const oppId of oldCards) {
      if (oppId === spec.id) continue;
      const rec = {
        newId: spec.id, oppId: oppId, games: N, wins: 0, losses: 0, draws: 0,
        timeSum: 0, longest: 0, errors: 0, firstError: null,
      };
      for (let k = 0; k < N; k++) {
        const newLeft = k < half;
        let run;
        try {
          run = runMatch(G, newLeft ? spec.id : oppId, newLeft ? oppId : spec.id, {
            cap: cap, dt: dt, nanCheck: true, nanEvery: 300,
          });
        } catch (e) {
          run = { result: 'D', t: 0, err: e, nan: [], samples: [] };
        }
        if (run.err) {
          rec.errors++;
          if (!rec.firstError) rec.firstError = run.err.message || String(run.err);
        }
        rec.timeSum += run.t;
        if (run.t > rec.longest) rec.longest = run.t;
        const newWon = newLeft ? (run.result === 'L') : (run.result === 'R');
        if (run.result === 'D') rec.draws++;
        else if (newWon) rec.wins++;
        else rec.losses++;
      }
      rec.winRate = (rec.wins + 0.5 * rec.draws) / rec.games;
      rec.avgTime = rec.timeSum / rec.games;
      pairs.push(rec);
      agg.wins += rec.wins; agg.losses += rec.losses; agg.draws += rec.draws;
      agg.games += rec.games; agg.timeSum += rec.timeSum; agg.opponents++; agg.pairs++;
      if (rec.longest > agg.longest) agg.longest = rec.longest;
      if (rec.errors) errors.push({ pair: spec.id + ' vs ' + oppId, count: rec.errors, firstError: rec.firstError });
      if (agg.opponents % 5 === 0) {
        console.log('    ' + pad(spec.name, 8) + ' 总体进度 ' + agg.opponents + '/' + oldCards.length +
          ' 张老卡   ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
      }
    }
    agg.winRate = agg.games ? (agg.wins + 0.5 * agg.draws) / agg.games : null;
    agg.avgTime = agg.games ? agg.timeSum / agg.games : null;
    const cardPairs = pairs.filter(p => p.newId === spec.id);
    const weighted = rows => {
      const g = rows.reduce((a, r) => a + r.games, 0);
      return g ? rows.reduce((a, r) => a + r.winRate * r.games, 0) / g : null;
    };
    agg.histWinRate = weighted(cardPairs.filter(p => histSet.has(p.oppId)));
    agg.testWinRate = weighted(cardPairs.filter(p => !histSet.has(p.oppId)));
    agg.histOppCount = new Set(cardPairs.filter(p => histSet.has(p.oppId)).map(p => p.oppId)).size;
    agg.testOppCount = new Set(cardPairs.filter(p => !histSet.has(p.oppId)).map(p => p.oppId)).size;
    perCard.push(agg);
    console.log('  ' + pad(spec.name, 8) + ' 总体 vs ' + agg.opponents + ' 张老卡：' +
      fmtPct(agg.winRate) + '   平均时长 ' + fmtSec(agg.avgTime) + '   ' +
      (agg.wins + '-' + agg.losses + (agg.draws ? ' 平' + agg.draws : '')) +
      '  ｜ 15 张历史卡 ' + fmtPct(agg.histWinRate) + ' / 5 张测试转正 ' + fmtPct(agg.testWinRate));
  }
  if (T.SET && oldGate !== undefined) T.SET.watcherCards = oldGate;
  return {
    seed: seed, N: N, capSec: cap, hz: hz, gamesPerPair: N,
    opponentCount: oldCards.length, opponents: oldCards,
    totalGames: perCard.reduce((a, x) => a + x.games, 0),
    perCard: perCard, pairs: pairs, errors: errors,
    elapsedSec: (Date.now() - t0) / 1000,
  };
}

/* ------------------------------------------------------------------ *
 *  7. 报告（md + json）
 * ------------------------------------------------------------------ */
function buildSuggestions(report) {
  const out = [];
  if (!report.balance) return out;
  /* 只给"可调参数"（间隔/冷却/范围/位置/实现结构）的建议；
     用户设定文档写死的数值（FIXED_PARAMS）一律不列为建议。 */
  const MAP = {
    talk_to_the_hand: {
      nerf: [
        { key: 'slapCd', text: 'slapCd ↑（8.0 → 9.0~10.0s；每只手独立冷却）' },
        { key: 'slapRange', text: 'slapRange ↓（170 → 140~150）' },
        { key: 'handIv', text: 'handIv ↑（6.0 → 7~8s，手掌生成更慢）' },
        { key: 'first', text: 'first ↑（1.8 → 2.4~3.0s）' },
      ],
      buff: [
        { key: 'slapCd', text: 'slapCd ↓（8.0 → 6.8~7.3s）' },
        { key: 'slapRange', text: 'slapRange ↑（170 → 185~200）' },
        { key: 'handIv', text: 'handIv ↓（6.0 → 4.8~5.2s）' },
        { key: 'handWake', text: 'handWake ↓（0.30 → 0.20，新手起手更快）' },
      ],
    },
    alpha: {
      nerf: [
        { key: 'betaIv', text: 'betaIv ↑（4.0 → 4.6~5.0s，种贝塔更慢）' },
        { key: 'omegaFirst', text: 'omegaFirst ↑（0.35 → 0.8~1.0s）' },
        { key: 'omegaWaveR', text: 'omegaWaveR ↓（200 → 180~190）' },
        { key: 'waveSpd', text: 'waveSpd ↓（320 → 260~290，波前扫得更慢）' },
      ],
      buff: [
        { key: 'betaIv', text: 'betaIv ↓（4.0 → 3.2~3.6s）' },
        { key: 'betaSpeed', text: 'betaSpeed ↑（120 → 135~145，贝塔更快贴脸）' },
        { key: 'omegaFirst', text: 'omegaFirst ↓（0.35 → 0.2s）' },
        { key: 'spawnAvoid', text: 'spawnAvoid ↑（190 → 240~280，种得离敌人更远）' },
        { key: 'waveSpd', text: 'waveSpd ↑（320 → 380~450，波前更快扫到人）' },
        { key: 'omegaWaveR', text: 'omegaWaveR ↑（200 → 215~230）' },
      ],
    },
    prostrate: {
      nerf: [
        { key: 'ivMin', text: 'ivMin/ivMax ↑（7~9 → 8~10.5s，祈祷更稀疏）' },
        { key: 'mantraAccel', text: 'mantraAccel ↓（0.1 → 0.06，真言叠得更慢）' },
        { key: 'beamR', text: 'beamR ↓（42 → 36~39）' },
      ],
      buff: [
        { key: 'ivMin', text: 'ivMin/ivMax ↓（7~9 → 6~7.5s，祈祷更频繁）' },
        { key: 'mantraMin', text: 'mantraMin ↓（0.28 → 0.22~0.24）' },
        { key: 'beamR', text: 'beamR ↑（42 → 48~54）' },
        { key: 'beamDelay', text: 'beamDelay ↓（1.0 → 0.75~0.85s）' },
        { key: 'beamFollowSpd', text: 'beamFollowSpd ↑（900 → 1100~1400，底座跟得更紧）' },
      ],
    },
    wish: {
      nerf: [
        { key: 'ivMin', text: 'ivMin/ivMax ↑（2.0/2.6 → 2.4/3.1，许愿更稀疏）' },
        { key: 'coinHitR', text: 'coinHitR ↓（60 → 48~52）' },
        { key: 'coinBounce', text: 'coinBounce ↓（3 → 2）' },
      ],
      buff: [
        { key: 'ivMin', text: 'ivMin/ivMax ↓（2.0/2.6 → 1.6/2.1，许愿更频繁）' },
        { key: 'coinHitR', text: 'coinHitR ↑（60 → 70~80）' },
        { key: 'coinBounce', text: 'coinBounce ↑（3 → 4，多弹几次更容易命中）' },
        { key: 'pauseT', text: 'pauseT ↓（0.4 → 0.25，停顿更短）' },
        { key: 'showT', text: 'showT ↓（0.75 → 0.55，演出更短）' },
      ],
    },
  };
  /* 已知游戏最终口径（供建议文本使用） */
  const KNOWN = {
    coinHitR: 60, coinBounce: 3, slapCd: 8.0, slapRange: 170, handIv: 6.0,
    omegaFirst: 0.35, betaIv: 4.0, betaSpeed: 120, omegaWaveR: 200, waveSpd: 320,
  };
  const ovMap = {};
  if (report.overall && report.overall.perCard) {
    for (const x of report.overall.perCard) ovMap[x.id] = x.winRate;
  }
  for (const c of report.balance.perCard) {
    if (c.verdict === 'OK') continue;
    const m = MAP[c.id];
    if (!m) continue;
    const ov = ovMap[c.id];
    /* 对顶行偏弱但总体胜率已在顶行历史均值(62.7%)同档 → 是"克制面窄"而非整体弱势，不建议整体加强 */
    if (c.verdict === 'WEAK' && ov !== undefined && ov >= 0.55) {
      out.push({
        id: c.id, name: c.name, verdict: c.verdict, keys: [], droppedFixed: [],
        overallWinRate: ov,
        note: '对顶行偏弱但总体胜率 ' + fmtPct(ov) + '（vs 全部老卡）已达顶行历史均值 62.7% 同档，' +
          '属"对顶行克制面窄"而非整体弱势，不建议按整体加强处理；如需改善对顶行体验，只动范围/节奏类参数。',
      });
      continue;
    }
    const fixed = FIXED_PARAMS[c.id] || {};
    const raw = (c.verdict === 'OP' ? m.nerf : m.buff);
    const dropped = [];
    const keys = raw.filter(s => {
      if (fixed[s.key]) { dropped.push(s.key); return false; }   // 写死值不得建议修改
      return true;
    });
    out.push({ id: c.id, name: c.name, verdict: c.verdict, keys: keys, droppedFixed: dropped });
  }
  return out;
}

function buildMarkdown(report) {
  const R = report;
  const L = [];
  L.push('# 观者 4 卡 · 验证与平衡报告（task-4）');
  L.push('');
  L.push('- 生成时间：' + R.meta.generatedAt);
  L.push('- 构建产物：`' + R.meta.htmlPath + '`（' + R.meta.htmlMB + ' MB，mtime ' +
    R.meta.htmlMtime + (R.meta.htmlMtimeLocal ? ' = 本地 ' + R.meta.htmlMtimeLocal : '') + '）');
  L.push('- 结论：**' + R.verdict + '**' + (R.verdict === 'PENDING' ? '（尚未集成完成，本报告为预检）' : ''));
  L.push('- 参数：N=' + (R.balance ? R.balance.N : '—') + '/对，CAP=' + (R.balance ? R.balance.capSec : '—') +
    's，步长 1/' + (R.balance ? R.balance.hz : 120) + 's，种子 ' + (R.balance ? R.balance.seed : '—'));
  L.push('');
  if (R.failures.length) {
    L.push('## ❌ 失败项');
    L.push('');
    for (const f of R.failures) L.push('- ' + f);
    L.push('');
  }
  if (R.pending.length) {
    L.push('## ⏳ 待集成项');
    L.push('');
    for (const p of R.pending) L.push('- ' + p);
    L.push('');
  }
  if (!R.static) return L.join('\n');

  /* 1. 静态 */
  L.push('## 1. 静态集成检查');
  L.push('');
  L.push('| 卡 | CARD_BY_ID | 名称 | mech | MECHS 注册 | watcher 标记 | CARDS 位置(0基) | 列(idx%6) | p 键 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of R.static.cards) {
    L.push('| ' + c.id + ' | ' + (c.exists ? '✓' : '✗') + ' | ' + (c.actualName || '—') + ' | ' +
      (c.mech || '—') + ' | ' + (c.mechRegistered ? '✓' : '✗') + ' | ' + (c.watcherFlag || '—') + ' | ' +
      (c.idx === undefined ? '—' : c.idx) + ' | ' + (c.column === null || c.column === undefined ? '—' : c.column) + ' | ' +
      (c.pKeys ? c.pKeys.length + ' 个' + (c.missingPKeys && c.missingPKeys.length ? '（缺 ' + c.missingPKeys.join('/') + '）' : '') : '—') + ' |');
  }
  L.push('');
  L.push('- CARDS 顺序：期望 `' + R.static.order.expected.join(' / ') + '`，实际 `' +
    R.static.order.actual.map(v => v < 0 ? '缺失' : v).join(' / ') + '` → ' +
    (R.static.order.ok ? '✓' : '✗'));
  L.push('- 最右列（' + COLUMNS + ' 列布局）：' + (R.static.order.rightColumn ? '✓' : '✗') +
    '，列号 ' + R.static.order.cols.map(v => v === null ? '—' : v).join('/'));
  L.push('- CARDS 总数：' + R.static.cardCount + '；顶行五卡：`' + R.static.top5.join(' / ') + '`' + (R.static.top5Ok ? ' ✓' : '（与预期不同）'));
  if (R.static.bakeColor) {
    L.push('- 灰框 token（tools/bake_card2.py）：card_beta = ' + (R.static.bakeColor.beta ? 'colorless ✓' : '✗') +
      '，card_omega = ' + (R.static.bakeColor.omega ? 'colorless ✓' : '✗') + '（第三轮口径：紫→灰）');
  }
  if (R.static.warnings.length) {
    L.push('');
    L.push('> 警告：' + R.static.warnings.join('；'));
  }
  L.push('');

  /* 2. 闸门 */
  if (R.gates) {
    L.push('## 2. 设置闸门（SET.watcherCards）');
    L.push('');
    if (R.gates.listFn) {
      L.push('- 选卡列表函数：`' + R.gates.listFn + '()`（适配实际函数名）');
      L.push('- 默认值：`SET.watcherCards = ' + JSON.stringify(R.gates.defaultValue) + '`');
      if (R.gates.off) L.push('- 闸门关：列表 ' + R.gates.off.length + ' 张，含观者卡 ' + R.gates.offHasWatcher.length + ' 张' + (R.gates.offHasWatcher.length ? '（**失败**：' + R.gates.offHasWatcher.join(',') + '）' : ' ✓'));
      if (R.gates.on) L.push('- 闸门开：列表 ' + R.gates.on.length + ' 张，含观者卡 ' + R.gates.onHasWatcher.length + '/4 张' + (R.gates.onHasWatcher.length === 4 ? ' ✓' : '（**失败**）'));
    } else {
      L.push('- ❌ ' + (R.gates.issues || []).join('；'));
    }
    L.push('');
  }

  /* 3. 祭品池 */
  if (R.offering) {
    L.push('## 3. 祭品召唤池闸门');
    L.push('');
    if (!R.offering.available) {
      L.push('- 跳过：' + (R.offering.issues || []).join('；'));
    } else {
      const d = side => side && !side.error
        ? '抽 ' + side.picks.length + ' 次 / 不同卡 ' + side.distinct + ' 张 / 观者卡 ' + side.watcherDistinct.length + ' 张' +
        (side.watcherDistinct.length ? '（' + side.watcherDistinct.join(',') + '）' : '')
        : ('异常：' + (side && side.error));
      L.push('- 闸门关：' + d(R.offering.off));
      L.push('- 闸门开：' + d(R.offering.on));
      L.push('- 结论：' + (R.offering.issues.length ? '❌ ' + R.offering.issues.join('；') : '✓ 关闭时不含观者卡，开启时能召到 4 张观者卡'));
    }
    L.push('');
  }

  /* 4. 机制 */
  if (R.mechanics) {
    L.push('## 4. 机制触发断言');
    L.push('');
    for (const spec of WATCHER_CARDS) {
      const m = R.mechanics.perCard[spec.id];
      if (!m) continue;
      L.push('### ' + spec.name + '（' + spec.id + '）');
      L.push('');
      if (m.obs && m.obs.runs && m.obs.runs.length) {
        L.push('- 观测：' + m.obs.runs.length + ' 局 × ≤' + m.obs.cap + 's，对手 ' + m.obs.opponent +
          '；新 Effect 类 `' + m.obs.newEffCls.map(x => x.cls).slice(0, 8).join(',') + '`' +
          '；新 Unit 类 `' + m.obs.newUnitCls.map(x => x.cls).slice(0, 8).join(',') + '`');
        L.push('- 状态峰值：block=' + m.obs.maxBlock.toFixed(0) + ' strength=' + m.obs.maxStrength +
          ' plated=' + m.obs.maxPlated + ' mantra=' + m.obs.maxMantra + ' divT=' + m.obs.maxDivT.toFixed(1) +
          '；伤害事件 ' + m.obs.events + ' 次 / gold ' + (m.obs.goldDamage || 0) +
          ' 次 / light ' + m.obs.lightDamage + ' 次 / ≤40 伤害 ' + m.obs.coinDamage + ' 次');
        if (m.obs.coinsFired) {
          L.push('- 金币统计：发射 ' + m.obs.coinsFired + ' 枚 / 命中 ' + m.obs.goldDamage + ' 次 = **' +
            (m.obs.coinHitRate * 100).toFixed(1) + '%** 反弹命中率；' + m.obs.wishShows + ' 次许愿演出');
        }
        if (m.obs.waveCount) {
          L.push('- 冲击波统计：创建 ' + m.obs.waveCount + ' 道 / 命中 ' + m.obs.events + ' 次；首道在欧米伽出现后 ' +
            (m.obs.waveFirstDelay === null ? '—' : m.obs.waveFirstDelay.toFixed(2) + 's') + ' 创建（按 Effect 创建时刻）');
        }
      }
      for (const a of m.asserts) L.push('- ' + (a.ok ? '✅' : '❌') + ' ' + a.name + (a.detail ? ' —— ' + a.detail : ''));
      L.push('');
    }
  }

  /* 5. 平衡 */
  if (R.balance) {
    const B = R.balance;
    L.push('## 5. 平衡：新 4 卡 × 顶行五卡');
    L.push('');
    L.push('- 每对 ' + B.gamesPerPair + ' 局（左右各半），共 ' + B.totalGames + ' 局；CAP=' + B.capSec +
      's；步长 1/' + B.hz + 's；种子 ' + B.seed + '；用时 ' + B.elapsedSec.toFixed(0) + 's');
    L.push('- 历史参照（tools/_balance120.json）：顶行五卡历史平均胜率 **62.7%**（对全体老卡）。' +
      '由此推算，一个"老卡平均水平"的角色对顶行五卡大致只能拿 **≈37%**；' +
      '所以对顶行 50% ≈ 已进入/超过顶行档，35%~65% 视为未明显偏离，>65% / <35% 才标超模/弱势。');
    L.push('');
    L.push('> 判定阈值：对顶行平均胜率 > ' + fmtPct(B.high) + ' 判「明显超模」，< ' + fmtPct(B.low) + ' 判「明显弱势」。');
    L.push('');
    L.push('| 新卡 | ' + B.top5Names.join(' | ') + ' | 对顶行平均 | 加权胜率 | 判定 | 平均时长 | 最长 |');
    L.push('|---|' + B.top5.map(() => '---:').join('|') + '|---:|---:|---|---:|---:|');
    for (const c of B.perCard) {
      const cells = B.top5.map(opp => {
        const r = c.vs.filter(v => v.oppId === opp)[0];
        return r ? Math.round(r.winRate * 100) + '%' : '—';
      });
      L.push('| **' + c.name + '** | ' + cells.join(' | ') + ' | **' + fmtPct(c.avgWinRate) + '** | ' +
        fmtPct(c.overallWinRate) + ' | ' + VERDICT_CN[c.verdict] + ' | ' + fmtSec(c.avgTime) + ' | ' + fmtSec(c.longest) + ' |');
    }
    L.push('');
    L.push('- 对局平均时长 ' + fmtSec(B.avgTime) + '，最长 ' + fmtSec(B.longest) + '，平局 ' + B.drawGames + ' 场');
    if (B.nanIssues && B.nanIssues.length) L.push('- ⚠ 平衡对局中出现 NaN：' + JSON.stringify(B.nanIssues.slice(0, 3)));
    if (B.errors && B.errors.length) {
      L.push('- ⚠ **平衡对局抛异常**（异常场按平局计，结论不可信）：' +
        B.errors.map(e => e.newId + ' vs ' + e.oppId + ' ×' + e.count + '（' + e.firstError + '）').join('；'));
    }
    L.push('');

    L.push('');
    if (R.overall) {
      const O = R.overall;
      L.push('### 总体胜率（vs 全部老卡，交叉参考）');
      L.push('');
      L.push('- 口径：4 新卡 × 全部 ' + O.opponentCount + ' 张老卡，每对 ' + O.N +
        ' 局（左右各半），CAP=' + O.capSec + 's，步长 1/' + O.hz + 's，种子 ' + O.seed +
        '，共 ' + O.totalGames + ' 局 / ' + O.elapsedSec.toFixed(0) + 's');
      L.push('- 说明：用户要求以**顶行五卡**为平衡参考；但顶行五卡本身是老卡里最强的一档（历史平均 62.7%），' +
        '只看对顶行会显得新卡偏弱。本表用全部老卡做交叉参考。');
      L.push('');
      L.push('| 新卡 | 对顶行五卡平均 | 总体 vs ' + O.opponentCount + ' 张老卡 | 其中 vs 15 张历史卡 | vs 5 张测试转正 | 差值 | 解读 |');
      L.push('|---|---:|---:|---:|---:|---:|---|');
      for (const c of O.perCard) {
        const top = (B.perCard.filter(x => x.id === c.id)[0] || {}).avgWinRate;
        const diff = (top !== null && top !== undefined && c.winRate !== null) ? c.winRate - top : null;
        let read = '';
        if (top !== null && top !== undefined && c.winRate !== null) {
          if (top < 0.35 && c.winRate >= 0.55) read = '对顶行克制面窄，但总体与顶行历史均值同档 → 不建议整体加强';
          else if (top < 0.35) read = '对顶行偏弱；总体 ' + fmtPct(c.winRate) + '（vs 15 历史卡 ' +
            fmtPct(c.histWinRate) + '）仍低于顶行档，可在可调参数上小幅补强';
          else if (top > 0.65 && c.winRate <= 0.65) read = '对顶行超模但总体未超档 → 优先收窄对顶行的机制优势';
          else if (top > 0.65) read = '对顶行与总体均超模，建议收节奏/范围';
          else if (c.histWinRate !== null && c.histWinRate !== undefined && c.histWinRate > 0.65) {
            read = '对顶行在阈值内，但总体（vs 15 张历史卡 ' + fmtPct(c.histWinRate) +
              '）高于顶行历史均值 62.7% → 总体强度偏高，建议留观；若要收紧只动 slapCd/slapRange/handIv 类';
          } else if (c.winRate >= 0.65) read = '对顶行在区间内，但总体偏高（被 5 张测试转正卡拉高）→ 可留观';
          else read = '对顶行与总体均在区间内';
        }
        L.push('| **' + c.name + '** | ' + fmtPct(top) + ' | **' + fmtPct(c.winRate) + '** | ' +
          fmtPct(c.histWinRate) + ' | ' + fmtPct(c.testWinRate) + ' | ' +
          (diff === null ? '—' : (diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + 'pp') + ' | ' + read + ' |');
      }
      L.push('');
      L.push('> 参考档位：顶行五卡历史总胜率 **62.7%**（_balance120.json，15 卡口径）。本次 20 张老卡' +
        '含 5 张测试版转正卡（offering/afterimage/tracking/soul_storm/meteor_strike，整体弱于历史 15 卡），' +
        '所以「总体 vs 20 张」会被这 5 张拉高；**vs 15 张历史卡**一列与 62.7% 口径可比。');
      L.push('');
      if (O.errors && O.errors.length) {
        L.push('- ⚠ **总体胜率对局抛异常**（结果不可信）：' +
          O.errors.map(e => e.pair + ' ×' + e.count + '（' + e.firstError + '）').join('；'));
        L.push('');
      }
    }

    /* 调参约束：写死值不可改，只列可调键（来自 Lead 2026-10-23 约束） */
    L.push('### 调参约束（用户设定文档写死的数值，不得按平衡理由修改）');
    L.push('');
    L.push('| 卡 | 写死参数（不可改） | 可调参数（间隔/冷却/范围/位置/实现结构） |');
    L.push('|---|---|---|');
    for (const spec of WATCHER_CARDS) {
      const fx = FIXED_PARAMS[spec.id] || {};
      const rec = (R.static.cards || []).filter(x => x.id === spec.id)[0] || {};
      const fxText = Object.keys(fx).map(k => k + '=' + fx[k]).join('、');
      const tunText = (rec.tunable || TUNABLE_PARAMS[spec.id] || []).join('、');
      L.push('| ' + spec.name + ' | ' + fxText + ' | ' + tunText + ' |');
    }
    L.push('');
    if (R.static.warnings && R.static.warnings.some(w => w.indexOf('写死值') >= 0)) {
      L.push('> ⚠ 静态检查发现写死值被改动：' +
        R.static.warnings.filter(w => w.indexOf('写死值') >= 0).join('；') + '（请与设定文档核对）');
      L.push('');
    }

    if (R.suggestions && R.suggestions.length) {
      L.push('### 调参建议（仅建议，未改动源码；已过滤写死参数）');
      L.push('');
      for (const s of R.suggestions) {
        if (s.keys && s.keys.length) {
          L.push('- **' + s.name + '（' + VERDICT_CN[s.verdict] + '）**：' + s.keys.map(k => k.text).join('；'));
        } else {
          L.push('- **' + s.name + '（' + VERDICT_CN[s.verdict] + '）**：' + (s.note || '暂无建议'));
          continue;
        }
        if (s.note) L.push('  - ' + s.note);
        if (s.droppedFixed && s.droppedFixed.length) {
          L.push('  - （已自动排除写死参数：' + s.droppedFixed.join('、') + '）');
        }
      }
      L.push('');
    }
  }
  L.push('');
  L.push('---');
  L.push('*由 `tools/watcher_test.js` 生成；`tools/watcher_render_check.js` 负责渲染/素材冒烟。*');
  return L.join('\n');
}

function writeSafe(file, data) {
  try { fs.writeFileSync(file, data); return true; }
  catch (e) { console.error('× 写不出去：' + file + '（' + (e.code || e.message) + '）'); return false; }
}

/* ------------------------------------------------------------------ *
 *  8. main
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const o = { only: null, noBalance: false, quick: false, report: false, strictPending: false };
  for (const a of argv.slice(2)) {
    if (a === '--no-balance') o.noBalance = true;
    else if (a === '--quick') o.quick = true;
    else if (a === '--report') o.report = true;
    else if (a === '--strict-pending') o.strictPending = true;
    else if (a.indexOf('--only=') === 0) o.only = a.slice(7).split(',').map(s => s.trim()).filter(Boolean);
  }
  return o;
}

function want(only, name) { return !only || only.indexOf(name) >= 0; }

function main() {
  const args = parseArgs(process.argv);
  const N = parseInt(process.env.N || (args.quick ? '20' : '100'), 10);
  const CAP = parseFloat(process.env.CAP || '120');
  const HZ = parseFloat(process.env.HZ || '120');
  const SEED = parseInt(process.env.SEED || '20260922', 10);
  /* 机制段：不传环境变量时用每卡的默认 runs/cap（见 OBS）；--quick 缩短。 */
  const MECH_CAP = process.env.MECH_CAP ? parseFloat(process.env.MECH_CAP) : (args.quick ? 45 : undefined);
  const MECH_RUNS = process.env.MECH_RUNS ? parseInt(process.env.MECH_RUNS, 10) : (args.quick ? 1 : undefined);

  console.log('═'.repeat(78));
  console.log('观者 4 卡 · 无头验证 + 平衡测试（task-4）');
  console.log('构建产物: ' + HTML_PATH + (fs.existsSync(HTML_PATH) ? '' : '  ✗ 不存在'));
  console.log('参数: N=' + N + ' CAP=' + CAP + 's HZ=' + HZ + ' SEED=' + SEED +
    ' MECH_CAP=' + MECH_CAP + ' MECH_RUNS=' + MECH_RUNS);
  console.log('═'.repeat(78));
  if (!fs.existsSync(HTML_PATH)) {
    console.error('× 找不到构建产物，退出。');
    process.exit(1);
  }

  let G;
  try {
    G = loadGame({ seed: SEED });
  } catch (e) {
    console.error('× 载入失败：' + e.message);
    process.exit(1);
  }
  console.log('载入 OK：' + (G.srcMode ? '源文件桩（ASSET_MAP 占位符已替换，无内联素材）' : '构建产物'));
  console.log('钩子：Unit.damage ' + (G.hooks.damage ? '✓' : '✗') +
    '，Unit.addTimedBlock ' + (G.hooks.addTimedBlock ? '✓' : '✗') +
    '，Unit 类=' + (G.hooks.unitClass || '?'));
  const T = G.T;

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      htmlPath: HTML_PATH,
      htmlMB: (fs.statSync(HTML_PATH).size / 1048576).toFixed(2),
      htmlMtime: fs.statSync(HTML_PATH).mtime.toISOString(),
      htmlMtimeLocal: fmtLocalDateTime(fs.statSync(HTML_PATH).mtime),
      srcMode: G.srcMode,
      args: { N: N, CAP: CAP, HZ: HZ, SEED: SEED, MECH_CAP: MECH_CAP, MECH_RUNS: MECH_RUNS },
    },
    verdict: 'PENDING',
    failures: [], warnings: [], pending: [],
    static: null, gates: null, offering: null, mechanics: null, balance: null,
    history: null, suggestions: [],
  };
  const fail = msg => { report.failures.push(msg); };
  const warn = msg => { report.warnings.push(msg); };

  /* --- 静态（总是跑：后面的闸门/机制/平衡都依赖它） --- */
  {
    console.log('\n— 1) 静态集成检查 …');
    const st = checkStatic(G);
    report.static = st;
    report.pending = report.pending.concat(st.pending);
    report.warnings = report.warnings.concat(st.warnings);
    for (const i of st.issues) fail(i);
    for (const c of st.cards) {
      console.log('  ' + pad(c.id, 20) + ' exists=' + (c.exists ? '✓' : '✗') +
        ' name=' + pad(c.actualName || '—', 8) + ' mech=' + pad(c.mech || '—', 16) +
        ' registered=' + (c.mechRegistered ? '✓' : '✗') +
        ' watcher=' + (c.watcherFlag || '—') +
        (c.idx === undefined ? '' : ' idx=' + c.idx + '(期望 ' + c.expectedIdx + ')'));
    }
    console.log('  CARDS 顺序 ' + (st.order.ok ? '✓' : (st.order.allExist ? '✗' : '⏳')) +
      ' 实际 [' + st.order.actual.map(v => v < 0 ? '缺失' : v).join(',') + ']');
    console.log('  最右列 ' + (st.order.rightColumn ? '✓' : (st.order.allExist ? '✗' : '⏳')) +
      '  列号 [' + st.order.cols.map(v => v === null ? '—' : v).join(',') + ']  总数 ' + st.cardCount);
    if (st.bakeColor) {
      console.log('  灰框 token（bake_card2.py）：beta ' + (st.bakeColor.beta ? 'colorless✓' : '✗') +
        '，omega ' + (st.bakeColor.omega ? 'colorless✓' : '✗'));
    }
    if (st.warnings.length) console.log('  ⚠ ' + st.warnings.join('；'));
    if (st.issues.length) st.issues.forEach(i => console.log('  ✗ ' + i));
    if (st.pending.length) st.pending.forEach(i => console.log('  ⏳ ' + i));
  }

  /* --- 闸门 --- */
  if (want(args.only, 'gate') && report.static && report.static.cards.some(c => c.exists)) {
    console.log('\n— 2) 设置闸门 SET.watcherCards …');
    const g = checkGates(G);
    report.gates = g;
    g.issues.forEach(i => { fail(i); console.log('  ✗ ' + i); });
    if (g.listFn) {
      console.log('  列表函数 ' + g.listFn + '()  默认=' + JSON.stringify(g.defaultValue));
      if (g.off) console.log('  关：' + g.off.length + ' 张，含观者 ' + g.offHasWatcher.length + '（应为 0）');
      if (g.on) console.log('  开：' + g.on.length + ' 张，含观者 ' + g.onHasWatcher.length + '/4（应为 4）');
      if (!g.issues.length) console.log('  ✓ 闸门开/关差集正确');
    }
  }

  /* --- 祭品池 --- */
  if (want(args.only, 'offering') && report.static && report.static.cards.every(c => c.exists)) {
    console.log('\n— 3) 祭品召唤池闸门 …');
    const o = checkOffering(G);
    report.offering = o;
    o.issues.forEach(i => { fail(i); console.log('  ✗ ' + i); });
    if (o.available) {
      const fmt = s => s && !s.error
        ? s.picks.length + ' 抽 / ' + s.distinct + ' 张不同 / 观者 ' + s.watcherDistinct.length + ' 张' +
        (s.watcherDistinct.length ? ' [' + s.watcherDistinct.join(',') + ']' : '')
        : '异常：' + (s && s.error);
      console.log('  闸门关：' + fmt(o.off));
      console.log('  闸门开：' + fmt(o.on));
      if (!o.issues.length) console.log('  ✓ 祭品池闸门正确');
    } else {
      console.log('  (跳过) ' + o.issues.join('；'));
    }
  }

  /* --- 机制 --- */
  if (want(args.only, 'mech')) {
    const st = report.static || checkStatic(G);
    const allCards = st.cards.every(c => c.exists);
    const allMech = st.cards.every(c => c.mechRegistered);
    if (!allCards || !allMech) {
      console.log('\n— 4) 机制触发断言：跳过（观者卡尚未全部集成）');
      if (!report.pending.length) {
        report.pending.push('机制未拼接：' + st.cards.filter(c => !c.mechRegistered).map(c => c.id).join(', '));
      }
    } else {
      console.log('\n— 4) 机制触发断言 …');
      const t0 = Date.now();
      const baseCls = collectBaselineClasses(G, Math.min(25, MECH_CAP));
      console.log('  老卡基线 Effect/Unit 类 ' + baseCls.size + ' 个（' + Array.from(baseCls).slice(0, 10).join(',') + ' …）');
      report.mechanics = { baselineClasses: Array.from(baseCls), perCard: {} };
      for (const spec of WATCHER_CARDS) {
        const obs = observeCard(G, spec.id, baseCls, { runs: MECH_RUNS, cap: MECH_CAP });
        const asserts = judgeMechanism(G, obs);
        report.mechanics.perCard[spec.id] = { obs: serializeObs(obs), asserts: asserts };
        if (obs.nan && obs.nan.length) {
          fail(spec.id + ' 出现 NaN：' + JSON.stringify(obs.nan[0]));
        }
        console.log('  ' + spec.name + '：');
        for (const a of asserts) {
          console.log('    ' + (a.ok ? '✓' : '✗') + ' ' + a.name + (a.detail ? '  ' + a.detail : ''));
          if (!a.ok) fail(spec.name + ' 机制断言失败：' + a.name + (a.detail ? '（' + a.detail + '）' : ''));
        }
      }
      console.log('  机制段用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    }
  }

  /* --- 平衡 --- */
  const integrated = report.static && report.static.integrated;
  if (want(args.only, 'balance') && !args.noBalance) {
    if (!integrated) {
      console.log('\n— 5) 平衡：跳过（观者卡尚未全部集成）');
    } else {
      console.log('\n— 5) 平衡：4 新卡 × 顶行五卡，每对 ' + N + ' 局 …');
      report.history = loadHistorical();
      if (report.history.ok) {
        console.log('  历史参照（_balance120.json，' + report.history.source.gamesPerPair + ' 局/对）：顶行五卡平均胜率 ' +
          fmtPct(report.history.top5Avg) + '（' + report.history.top5.map(t => t.name + ' ' + fmtPct(t.winRate)).join(' / ') + '）');
      } else {
        console.log('  ⚠ 历史数据读取失败：' + report.history.error);
      }
      report.balance = runBalance(G, { N: N, CAP: CAP, HZ: HZ, SEED: SEED });
      const B = report.balance;
      for (const c of B.perCard) {
        console.log('  ' + pad(c.name, 8) + ' 对顶行平均 ' + pad(fmtPct(c.avgWinRate), 7) +
          ' 加权 ' + pad(fmtPct(c.overallWinRate), 7) + ' ' + VERDICT_CN[c.verdict] +
          '  平均时长 ' + fmtSec(c.avgTime) + ' 最长 ' + fmtSec(c.longest));
        for (const v of c.vs) {
          const r = B.pairs.filter(p => p.newId === c.id && p.oppId === v.oppId)[0];
          console.log('      vs ' + pad((T.CARD_BY_ID[v.oppId] || {}).name || v.oppId, 8) +
            fmtPct(v.winRate) + '  ' + (r ? r.wins + '-' + r.losses + (r.draws ? ' 平' + r.draws : '') : ''));
        }
        if (c.verdict === 'OP') warn(c.name + ' 对顶行平均胜率 ' + fmtPct(c.avgWinRate) + ' > ' + fmtPct(B.high) + '（明显超模）');
        if (c.verdict === 'WEAK') warn(c.name + ' 对顶行平均胜率 ' + fmtPct(c.avgWinRate) + ' < ' + fmtPct(B.low) + '（明显弱势）');
      }
      /* 5b) 总体胜率（vs 全部老卡）：用户以顶行五卡为参考，但顶行是最强一档，需交叉参考 */
      const OVERALL_N = parseInt(process.env.OVERALL_N || '40', 10);
      if (process.env.OVERALL !== '0') {
        console.log('\n— 5b) 总体胜率：4 新卡 × 全部老卡，每对 ' + OVERALL_N + ' 局 …');
        report.overall = runOverall(G, { N: OVERALL_N, CAP: CAP, HZ: HZ, SEED: SEED });
        const O = report.overall;
        for (const c of O.perCard) {
          console.log('  ' + pad(c.name, 8) + ' 总体 vs ' + O.opponentCount + ' 张老卡：' + pad(fmtPct(c.winRate), 7) +
            '  平均时长 ' + fmtSec(c.avgTime) + '  对顶行参考 ' +
            fmtPct((B.perCard.filter(x => x.id === c.id)[0] || {}).avgWinRate));
        }
        if (O.errors.length) {
          const totalErr = O.errors.reduce((a, e) => a + e.count, 0);
          fail('总体胜率对局抛异常 ' + totalErr + ' 场（该部分按平局计，结果不可信）：' +
            O.errors.slice(0, 3).map(e => e.pair + ' ×' + e.count + '（' + e.firstError + '）').join('；'));
        }
      } else {
        console.log('\n— 5b) 总体胜率：已跳过（OVERALL=0）');
      }
      report.suggestions = buildSuggestions(report);
      if (B.nanIssues.length) fail('平衡对局出现 NaN：' + JSON.stringify(B.nanIssues.slice(0, 3)));
      if (B.errors && B.errors.length) {
        const totalErr = B.errors.reduce((a, e) => a + e.count, 0);
        fail('平衡对局抛异常 ' + totalErr + ' 场（该部分结果按平局计，**不平衡结论不可信**）：' +
          B.errors.slice(0, 4).map(e => e.newId + ' vs ' + e.oppId + ' ×' + e.count + '（' + e.firstError + '）').join('；'));
      }
    }
  } else if (want(args.only, 'balance') && !args.noBalance && args.only) {
    console.log('\n— 5) 平衡：--only 模式下跳过（要跑平衡别传 --only，或用 --only=balance）');
  }

  /* --- 收尾 --- */
  const hasFail = report.failures.length > 0;
  if (hasFail) report.verdict = 'FAIL';
  else if (report.pending.length) report.verdict = 'PENDING';
  else report.verdict = 'PASS';

  console.log('\n' + '═'.repeat(78));
  console.log('结论：' + report.verdict +
    (report.verdict === 'PENDING' ? '（尚未集成完成——等 Lead 构建更新后再跑正式验证）' : ''));
  if (report.failures.length) {
    console.log('失败项 ' + report.failures.length + '：');
    report.failures.slice(0, 20).forEach(f => console.log('  ✗ ' + f));
  }
  if (report.pending.length) {
    console.log('待集成 ' + report.pending.length + '：');
    report.pending.forEach(p => console.log('  ⏳ ' + p));
  }
  if (report.warnings.length) {
    console.log('警告 ' + report.warnings.length + '：');
    report.warnings.slice(0, 12).forEach(w => console.log('  ⚠ ' + w));
  }
  console.log('═'.repeat(78));

  const shouldWrite = report.verdict !== 'PENDING' || args.report;
  if (shouldWrite) {
    const jsonOut = {
      meta: report.meta, verdict: report.verdict, failures: report.failures,
      warnings: report.warnings, pending: report.pending,
      static: report.static, gates: report.gates, offering: report.offering,
      mechanics: report.mechanics, balance: report.balance, overall: report.overall,
      history: report.history,
      suggestions: report.suggestions,
    };
    if (writeSafe(MD_OUT, buildMarkdown(report))) console.log('报告: ' + MD_OUT);
    if (writeSafe(JSON_OUT, JSON.stringify(jsonOut, replacer, 1))) console.log('数据: ' + JSON_OUT);
  } else {
    console.log('（PENDING 状态默认不写报告；需要留档加 --report）');
  }

  if (report.verdict === 'FAIL') process.exit(1);
  if (report.verdict === 'PENDING' && args.strictPending) process.exit(1);
  process.exit(0);
}

function replacer(k, v) {
  if (v instanceof Map) return Array.from(v.entries());
  if (v instanceof Set) return Array.from(v.values());
  return v;
}

function serializeObs(obs) {
  return {
    cardId: obs.cardId, opponent: obs.opponent, cap: obs.cap, err: obs.err,
    runs: obs.runs.map(r => ({ seed: r.seed, result: r.result, t: r.t, err: r.err, nan: r.nan, ms: r.ms })),
    newEffCls: Array.from(obs.newEffCls.entries()).map(([k, v]) => ({ cls: k, count: v.count, firstT: v.firstT, cards: Array.from(v.cards) })),
    newUnitCls: Array.from(obs.newUnitCls.entries()).map(([k, v]) => ({ cls: k, count: v.count, firstT: v.firstT, cards: Array.from(v.cards) })),
    maxBlock: obs.maxBlock, maxStrength: obs.maxStrength, maxPlated: obs.maxPlated,
    maxMantra: obs.maxMantra, maxDivT: obs.maxDivT, minPrayerSpeedMul: obs.minPrayerSpeedMul,
    events: obs.events.length, incoming: obs.incoming.length, blockEvents: obs.blockEvents.length,
    coinDamage: obs.coinDamage, goldDamage: obs.goldDamage, lightDamage: obs.lightDamage,
    coinsFired: obs.coinsFired, wishShows: obs.wishShows, waveFirstDelay: obs.waveFirstDelay, waveCount: obs.waveCount,
    coinHitRate: obs.coinsFired > 0 ? obs.goldDamage / obs.coinsFired : null,
    betaFirstT: obs.betaFirstT, omegaFirstT: obs.omegaFirstT,
    divWindows: obs.divWindows, nan: obs.nan || null,
    /* 2026-10-23 迭代观测 */
    handSpawnsPerRun: obs.handSpawnsPerRun,
    handSlapSameSecMulti: obs.handSlapSameSecMulti, mechHasSlapCd: obs.mechHasSlapCd,
    handSlapCount: obs.handSlapEvents.length, handMaxLive: obs.handMaxLive,
    betaStats: obs.betaStats, omegaStats: obs.omegaStats,
    wishMaxFreeze: obs.wishMaxFreeze, wishShowPts: obs.wishShowPts.length,
    wishRecPts: obs.wishRecPts.length, wishRecovered: obs.wishRecovered,
    proWindupWindows: obs.proWindupWindows, proWindupExitBad: obs.proWindupExitBad,
    proWindupHits: obs.proWindupHits, proPrayEnterMantra: obs.proPrayEnterMantra,
    proBeamDelay: obs.proBeamDelay, proBeamSpeedMax: obs.proBeamSpeedMax,
    proChargeCount: obs.proChargeCount,
    waSummonCount: obs.waSummonCount, betaSpawnCount: obs.betaSpawnCount,
    waSummonMatched: obs.waSummonMatched,
  };
}

/* 导出给 watcher_render_check.js 复用 */
module.exports = {
  ROOT,
  HTML_PATH,
  WATCHER_CARDS,
  W4_IDS,
  TOP5_EXPECTED,
  NEW_ASSET_KEYS,
  NEW_ASSET_ALL,
  createCtx2d,
  makeStubEl,
  ImageStub,
  loadGame,
  installRuntimeHooks,
  runMatch,
  sampleState,
  checkWorld,
  resultOf,
  applyGate,
  checkStatic,
  checkGates,
  checkOffering,
  drawOfferingPool,
  collectBaselineClasses,
  observeCard,
  judgeMechanism,
  runOverall,
  pickTop5,
  fmtPct,
  fmtSec,
  mulberry32,
  buildMarkdown,
  buildSuggestions,
  MD_OUT,
  JSON_OUT,
};

if (require.main === module) main();
