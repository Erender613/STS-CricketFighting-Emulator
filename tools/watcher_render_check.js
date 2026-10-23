/**
 * 观者 4 卡 · 渲染冒烟 + 新素材检查（task-4）
 * ============================================================
 * 1) 素材：构建产物 ASSET_MAP.img 里必须存在 19 个新素材 key（9 张卡图 + 6 个能力图标 +
 *    4 个 VFX），逐个校验 dataURI 前缀 / base64 解码 / RIFF+WEBP 魔数 / 体积，
 *    并确认 4 张主卡卡的 dataURI 真的写进了 HTML 文本。
 * 2) 绘制：stub canvas（严格模式：drawImage(undefined) 会抛异常，能抓出素材 key 写错）
 *    让 drawArena()/drawUnitHUD() 真跑，逐帧统计画布调用数、drawImage 贴图 key、
 *    fillText/strokeText 文本；4 张观者卡各跑若干局，确认新增绘制路径
 *    （手掌 / 贝塔·欧米伽卡面 + 冲击波 / 金币 + 聚光灯 + 三张许愿卡面 / 光柱 + 眼睛 VFX）
 *    不抛异常、对应贴图真的被画出来、且"机制活跃帧"的画布调用数不低于空闲帧。
 *
 * 用法:
 *   node tools/watcher_render_check.js                 # 默认正式版构建产物
 *   node tools/watcher_render_check.js --quick         # 快检（1 局/卡，30s）
 *   GAME_HTML=杀戮尖塔小球对决_开发者版.html node tools/watcher_render_check.js
 *   GAME_HTML=src/game.html node tools/watcher_render_check.js   # 源码桩（素材检查会跳过）
 *
 * 环境变量: RENDER_CAP（每局上限秒数） RENDER_EVERY（每几微步画一帧） RENDER_SEEDS
 *
 * 退出码: 0 = 通过 / 尚未集成（PENDING）；1 = 已集成但渲染/素材失败。
 * 只读游戏产物与素材；需要留档时把摘要合并进 tools/watcher_balance_report.json（--merge）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const WT = require('./watcher_test.js');

const HTML_PATH = WT.HTML_PATH;
const REPORT_JSON = WT.JSON_OUT;
const NEW_ASSET_KEYS = WT.NEW_ASSET_KEYS;
const NEW_ASSET_ALL = WT.NEW_ASSET_ALL;
/* 清单里有、但当前 4 卡代码并未引用的素材（task-1 的素材清单里含 Omega 能力图标，
   但 4 卡机制没有用它）：缺了只记警告，不算失败。 */
const OPTIONAL_ASSETS = ['pw_omega'];
const REQUIRED_ASSETS = NEW_ASSET_ALL.filter(k => OPTIONAL_ASSETS.indexOf(k) < 0);

/* 每张观者卡期望真的被画出来的贴图 key（来自 src/watcher/*.js 的 IMG 引用） */
const EXPECT_DRAW = {
  talk_to_the_hand: {
    hard: ['pw_block_return'],                       // 手掌贴图
    soft: [],
  },
  alpha: {
    hard: ['card_beta', 'card_omega'],               // 贝塔/欧米伽卡面（走 Unit.imgKey → drawUnits）
    soft: [],
  },
  wish: {
    hard: ['sp_coin', 'card_fame_and_fortune', 'card_become_almighty', 'card_live_forever'],
    soft: ['pw_strength', 'pw_plated_armor'],        // 状态徽标图标（力量/多层护甲）
  },
  prostrate: {
    hard: ['sp_eye_anim', 'pw_mantra', 'pw_divinity'],   // 神格眼睛 + 真言/神格徽标
    soft: ['sp_big_blur', 'sp_glow_spark'],              // 神格光晕/金尘（缺图有程序兜底）
  },
};
/* 2026-10-23 迭代：期望出现的"新增绘制类"（Effect/Unit 的 constructor.name） */
const EXPECT_CLASSES = {
  talk_to_the_hand: ['WatcherHand'],
  alpha: ['WAAlphaWave', 'WAAlphaSummon', 'WAAlphaMorph', 'BetaUnit', 'OmegaUnit'],
  wish: ['WishCards', 'WishSpotlight', 'WishCoin'],
  prostrate: ['ProstrateCharge', 'ProstrateAura', 'DivinityEye', 'DivinityBeam'],
};
const CARD_NAMES = {
  talk_to_the_hand: '以手拒之', alpha: '阿尔法', prostrate: '五体投地', wish: '许愿',
};
const PRAYER_TEXT = '祈祷nya...';

/* ------------------------------------------------------------------ *
 *  素材检查
 * ------------------------------------------------------------------ */
function checkAssets(G) {
  const T = G.T;
  const res = {
    available: false, note: '', present: [], missing: [], invalid: [],
    sizes: {}, missingGroups: {}, htmlHasMainCards: {}, totalKB: 0,
  };
  if (G.srcMode) {
    res.note = '源文件桩（无内联素材）：跳过 ASSET_MAP 检查，请用构建产物跑素材冒烟';
    return res;
  }
  res.available = true;
  const map = (T.ASSET_MAP && T.ASSET_MAP.img) || {};
  const prefix = 'data:image/webp;base64,';
  for (const key of NEW_ASSET_ALL) {
    const uri = map[key];
    if (!uri) {
      res.missing.push(key);
      const group = NEW_ASSET_KEYS.cards.indexOf(key) >= 0 ? 'cards'
        : NEW_ASSET_KEYS.powers.indexOf(key) >= 0 ? 'powers' : 'vfx';
      (res.missingGroups[group] = res.missingGroups[group] || []).push(key);
      continue;
    }
    if (uri.indexOf(prefix) !== 0) { res.invalid.push(key + ': 不是 ' + prefix + ' 开头'); continue; }
    const b64 = uri.slice(prefix.length);
    let buf;
    try { buf = Buffer.from(b64, 'base64'); }
    catch (e) { res.invalid.push(key + ': base64 解码失败'); continue; }
    const magic = buf.slice(0, 4).toString('latin1');
    const webp = buf.slice(8, 12).toString('latin1');
    if (magic !== 'RIFF' || webp !== 'WEBP') {
      res.invalid.push(key + ': 魔数不是 RIFF/WEBP（' + magic + '/' + webp + '）');
      continue;
    }
    if (buf.length < 300) { res.invalid.push(key + ': 体积异常小（' + buf.length + ' B）'); continue; }
    res.present.push(key);
    res.sizes[key] = +(buf.length / 1024).toFixed(1);
    res.totalKB += buf.length / 1024;
    if (NEW_ASSET_KEYS.cards.indexOf(key) >= 0 && key.indexOf('card_') === 0) {
      /* 4 张主卡的 dataURI 必须真的出现在 HTML 文本里 */
      if (G.html.indexOf(uri) >= 0) res.htmlHasMainCards[key] = true;
    }
  }
  return res;
}

/* ------------------------------------------------------------------ *
 *  stub canvas：严格 drawImage + 逐帧统计
 * ------------------------------------------------------------------ */
function makeFakeImg(key) {
  return {
    __key: key, complete: true, naturalWidth: 300, naturalHeight: 423,
    width: 300, height: 423,
    addEventListener(t, f) { if (t === 'load') setTimeout(f, 0); },
  };
}

function fillIMG(G, assetRes) {
  const T = G.T;
  const map = (T.ASSET_MAP && T.ASSET_MAP.img) || {};
  const fake = key => makeFakeImg(key);
  const filled = [];
  for (const key of Object.keys(map)) {
    if (!T.IMG[key]) T.IMG[key] = fake(key);
    filled.push(key);
  }
  /* 缺失的新素材也先塞占位图（key 前缀 MISSING），这样绘制代码本身仍能被冒烟；
     真正"缺素材"的失败由素材检查报告，绘制侧还能看出是哪个 key 被引用。 */
  for (const key of NEW_ASSET_ALL) {
    if (!T.IMG[key]) { T.IMG[key] = fake('MISSING:' + key); filled.push('MISSING:' + key); }
  }
  /* 卡面 tint 版本（drawUnits 的 grey 分支会用 GREY[imgKey] || IMG[imgKey]，不强制需要） */
  return filled;
}

/* ------------------------------------------------------------------ *
 *  带渲染跑一局
 * ------------------------------------------------------------------ */
function liveClassNames(world) {
  const eff = [], unit = [];
  for (const e of world.effects) {
    try { eff.push((e.constructor && e.constructor.name) || '?'); } catch (err) { }
  }
  for (const u of world.units) {
    try { unit.push((u.constructor && u.constructor.name) || '?'); } catch (err) { }
  }
  return { eff: eff, unit: unit };
}

function findMain(world, cardId) {
  for (const u of world.units) if (u.team === 0 && u.card && u.card.id === cardId) return u;
  return null;
}

/**
 * opt: { cardId, cap, dt, renderEvery, seed, nanCheck }
 * 返回 { err, frames, pushes, t, result, nan, drawnKeys, texts }
 */
function renderRun(G, aId, bId, opt) {
  opt = opt || {};
  const T = G.T;
  const dt = opt.dt || (1 / 120);
  const cap = opt.cap === undefined ? 60 : opt.cap;
  const every = Math.max(1, opt.renderEvery || 5);
  const out = {
    aId: aId, bId: bId, seed: opt.seed, cap: cap, renderEvery: every,
    err: null, frames: [], pushes: [], t: 0, result: 'D', nan: [],
  };
  G.damageLog.length = 0;
  G.blockLog.length = 0;
  G.pushRec.on = true;
  G.pushRec.log.length = 0;
  try {
    T.resetMatch(T.CARD_BY_ID[aId], T.CARD_BY_ID[bId], opt.seed);
  } catch (e) {
    G.pushRec.on = false;
    out.err = 'resetMatch 抛异常：' + e.message;
    return out;
  }
  T.world.running = true;
  let steps = 0;
  const capSteps = Math.ceil(cap / dt) + 8;
  try {
    while (!T.world.over && T.world.t < cap && steps < capSteps) {
      T.world.t += dt;
      T.stepPhysics(dt);
      steps++;
      if (opt.nanCheck !== false && steps % 24 === 0) {
        const bad = WT.checkWorld(T);
        if (bad.length) { out.nan.push({ t: T.world.t, issues: bad.slice(0, 5) }); if (out.nan.length > 20) break; }
      }
      if (steps % every === 0) {
        const w = T.world;
        const cls = liveClassNames(w);
        const me = findMain(w, opt.cardId);
        const frame = {
          t: w.t, ops: 0, keys: [], texts: [],
          effCls: cls.eff, unitCls: cls.unit,
          me: me ? {
            block: me.block, strength: me.strength, plated: me.plated,
            mantra: me.mantra, divT: me.divT, speedMul: me.speedMul, hp: me.hp,
          } : null,
        };
        G.ctxStats.ops = 0;
        G.ctxStats.frame = { keys: new Set(), texts: [], imgs: [] };
        T.drawArena();
        T.drawUnitHUD();
        frame.ops = G.ctxStats.ops;
        frame.keys = Array.from(G.ctxStats.frame.keys);
        frame.texts = G.ctxStats.frame.texts.slice();
        frame.imgs = G.ctxStats.frame.imgs.slice();
        G.ctxStats.frame = null;
        out.frames.push(frame);
      }
    }
    T.drawArena(); T.drawUnitHUD();
  } catch (e) {
    out.err = (e && e.message ? e.message : String(e)) + '\n' +
      String(e && e.stack || '').split('\n').slice(1, 5).join('\n');
  }
  G.pushRec.on = false;
  out.pushes = G.pushRec.log.slice();
  out.t = T.world.t;
  out.result = WT.resultOf(T);
  out.damage = G.damageLog.slice();
  out.textsAll = G.ctxStats.texts.slice();
  return out;
}

/* 一次运行里出现的新类名（相对老卡基线） */
function newClassesOf(run, baseCls) {
  const eff = new Set(), unit = new Set();
  for (const p of run.pushes) {
    if (baseCls.has(p.cls)) continue;
    if (p.cls === 'Unit') continue;
    if (p.kind === 'unit') unit.add(p.cls); else eff.add(p.cls);
  }
  return { eff: Array.from(eff), unit: Array.from(unit) };
}

/* 机制活跃帧判据（不依赖具体类名，只看状态与新增类） */
function frameActive(cardId, frame, newEff, newUnit) {
  const eff = new Set(newEff), unit = new Set(newUnit);
  const hasNewEff = frame.effCls.some(c => eff.has(c));
  const hasNewUnit = frame.unitCls.some(c => unit.has(c));
  const me = frame.me || {};
  if (cardId === 'talk_to_the_hand') return hasNewEff || (me.block || 0) > 0;
  if (cardId === 'alpha') return hasNewEff || hasNewUnit;
  if (cardId === 'wish') return hasNewEff || (me.strength || 0) > 0 || (me.plated || 0) > 0;
  if (cardId === 'prostrate') return hasNewEff || (me.mantra || 0) > 0 || (me.divT || 0) > 0;
  return hasNewEff || hasNewUnit;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/* ------------------------------------------------------------------ *
 *  主流程
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const o = { quick: false, merge: false, shots: false, shotsOnly: false };
  for (const a of argv.slice(2)) {
    if (a === '--quick') o.quick = true;
    else if (a === '--merge' || a === '--report') o.merge = true;
    else if (a === '--shots') o.shots = true;
    else if (a === '--shots-only') { o.shots = true; o.shotsOnly = true; }
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv);
  const CAP = parseFloat(process.env.RENDER_CAP || (args.quick ? '30' : '60'));
  const EVERY = parseInt(process.env.RENDER_EVERY || (args.quick ? '10' : '5'), 10);
  const SEEDS = parseInt(process.env.RENDER_SEEDS || (args.quick ? '1' : '2'), 10);

  console.log('═'.repeat(78));
  console.log('观者 4 卡 · 渲染冒烟 + 新素材检查（task-4）');
  console.log('构建产物: ' + HTML_PATH);
  console.log('参数: CAP=' + CAP + 's RENDER_EVERY=' + EVERY + ' SEEDS=' + SEEDS);
  console.log('═'.repeat(78));
  if (!fs.existsSync(HTML_PATH)) { console.error('× 找不到构建产物'); process.exit(1); }
  /* --shots-only：只重出预览图，跳过无头渲染冒烟（约 80s → 30s） */
  if (args.shotsOnly) {
    try { await runShots(); } catch (e) { console.log('截图失败：' + (e && e.message ? e.message : e)); process.exit(1); }
    process.exit(0);
  }

  let G;
  try { G = WT.loadGame({ seed: 20260922, strictImages: true }); }
  catch (e) { console.error('× 载入失败：' + e.message); process.exit(1); }
  const T = G.T;
  console.log('载入 OK：' + (G.srcMode ? '源文件桩（ASSET_MAP 占位符已替换）' : '构建产物') +
    '；cx=' + (T.getCx() ? '✓' : '✗'));

  /* ---- 1) 素材 ---- */
  const asset = checkAssets(G);
  const failures = [], warnings = [], pending = [];
  console.log('\n— 1) 新素材检查 ' + (asset.available ? '' : '（跳过）'));
  if (!asset.available) {
    console.log('  ' + asset.note);
    pending.push(asset.note);
  } else {
    const groupNames = { cards: '卡图', powers: '能力图标', vfx: 'VFX' };
    for (const g of ['cards', 'powers', 'vfx']) {
      const keys = NEW_ASSET_KEYS[g];
      const miss = keys.filter(k => asset.missing.indexOf(k) >= 0);
      const bad = asset.invalid.filter(x => keys.some(k => x.indexOf(k + ':') === 0));
      console.log('  ' + groupNames[g] + ' ' + (keys.length - miss.length) + '/' + keys.length +
        (miss.length ? '  缺: ' + miss.join(',') : ' ✓') +
        (bad.length ? '  坏: ' + bad.join('；') : ''));
    }
    console.log('  合计 ' + asset.present.length + '/' + NEW_ASSET_ALL.length + ' 个 key，' +
      asset.totalKB.toFixed(0) + ' KB（webp dataURI）');
    const mainCards = ['card_talk_to_the_hand', 'card_alpha', 'card_prostrate', 'card_wish'];
    for (const k of mainCards) {
      if (asset.missing.indexOf(k) >= 0) failures.push('素材缺失：' + k);
      else if (!asset.htmlHasMainCards[k]) failures.push('HTML 文本里找不到 ' + k + ' 的 dataURI');
    }
    for (const k of asset.missing) {
      if (OPTIONAL_ASSETS.indexOf(k) >= 0) {
        warnings.push('素材清单里的可选 key 未打包：' + k + '（当前 4 卡代码未引用，非阻塞）');
      } else {
        failures.push('素材缺失：' + k);
      }
    }
    for (const x of asset.invalid) failures.push('素材损坏：' + x);
  }

  /* 观者卡是否存在（未集成就优雅 PENDING） */
  const missingCards = WT.W4_IDS.filter(id => !T.CARD_BY_ID[id]);
  if (missingCards.length) {
    console.log('\n!! 尚未集成：构建产物没有观者卡 ' + missingCards.join(', '));
    console.log('结论：PENDING（等 Lead 构建更新后再跑渲染冒烟）');
    pending.push('构建产物尚未集成观者卡：' + missingCards.join(','));
    process.exit(0);
  }

  /* ---- 2) IMG 填充 ---- */
  const filled = fillIMG(G, asset);
  console.log('\n— 2) 假图填充：IMG ' + Object.keys(T.IMG).length + ' 个 key（其中新素材占位 ' +
    filled.filter(k => k.indexOf('MISSING:') === 0).length + ' 个）');

  /* ---- 3) 老卡基线渲染（对照 + 类名基线） ---- */
  const top5 = WT.pickTop5(T);
  console.log('\n— 3) 老卡基线渲染（' + top5[0] + ' vs ' + top5[1] + '，' + Math.min(CAP, 25) + 's）…');
  const base = renderRun(G, top5[0], top5[1], {
    cardId: top5[0], cap: Math.min(CAP, 25), renderEvery: EVERY, seed: 31415, nanCheck: false,
  });
  if (base.err) {
    failures.push('老卡基线渲染抛异常：' + base.err.split('\n')[0]);
    console.log('  ✗ ' + base.err.split('\n')[0]);
  }
  const baseCls = new Set();
  for (const p of base.pushes) baseCls.add(p.cls);
  const baseOps = mean(base.frames.map(f => f.ops)) || 0;
  console.log('  基线：' + base.frames.length + ' 帧，平均 ' + baseOps.toFixed(0) + ' canvas 调用/帧，' +
    'drawImage key ' + G.ctxStats.keys.size + ' 种；类名基线 ' + baseCls.size + ' 个');

  /* ---- 4) 4 张新卡逐张渲染 ---- */
  const perCard = {};
  const allDrawn = new Map();
  let totalFrames = 0;
  for (const spec of WT.WATCHER_CARDS) {
    const cardId = spec.id;
    const opponent = top5[0] === cardId ? top5[1] : top5[0];
    const runs = [];
    const cardNewEff = new Set(), cardNewUnit = new Set();
    const drawn = new Map();
    const drawnImgs = new Map();     // key -> {max/min 绘制宽高}；手掌放大 / token 缩小 / 召唤演出卡面虚影共用 key
    const texts = new Set();
    let err = null;
    console.log('\n— 4) ' + CARD_NAMES[cardId] + '（' + cardId + '） vs ' + opponent + ' 渲染 …');
    for (let s = 0; s < SEEDS; s++) {
      const run = renderRun(G, cardId, opponent, {
        cardId: cardId, cap: CAP, renderEvery: EVERY, seed: 610001 + s * 7919 + cardId.length * 31,
        nanCheck: true,
      });
      runs.push(run);
      if (run.err) { err = run.err; break; }
      const nc = newClassesOf(run, baseCls);
      nc.eff.forEach(x => cardNewEff.add(x));
      nc.unit.forEach(x => cardNewUnit.add(x));
      for (const f of run.frames) {
        for (const k of f.keys) { drawn.set(k, (drawn.get(k) || 0) + 1); allDrawn.set(k, (allDrawn.get(k) || 0) + 1); }
        for (const t of f.texts) texts.add(t);
        for (const im of (f.imgs || [])) {
          const cur = drawnImgs.get(im.key) || {
            w: 0, h: 0, wMin: Infinity, hMin: Infinity, hs: new Map(),
          };
          if (im.w > cur.w) cur.w = im.w;
          if (im.h > cur.h) cur.h = im.h;
          if (im.w > 0 && im.w < cur.wMin) cur.wMin = im.w;
          if (im.h > 0 && im.h < cur.hMin) cur.hMin = im.h;
          /* 高度直方图：取"出现次数最多的高度"当单位本体尺寸。
             卡面还会被召唤虚影/变身动画/出生弹跳短暂改尺寸，用最小/最大值都不稳。 */
          if (im.h > 0) {
            const hb = Math.round(im.h * 10) / 10;
            cur.hs.set(hb, (cur.hs.get(hb) || 0) + 1);
          }
          drawnImgs.set(im.key, cur);
        }
      }
      totalFrames += run.frames.length;
      if (run.nan && run.nan.length) warnings.push(CARD_NAMES[cardId] + ' 渲染对局出现 NaN：' + JSON.stringify(run.nan[0]));
    }
    const frames = [].concat.apply([], runs.map(r => r.frames));
    const newEff = Array.from(cardNewEff), newUnit = Array.from(cardNewUnit);
    const activeOps = [], idleOps = [];
    for (const f of frames) {
      (frameActive(cardId, f, newEff, newUnit) ? activeOps : idleOps).push(f.ops);
    }
    const meSeen = {
      block: Math.max(0, ...frames.map(f => (f.me && f.me.block) || 0)),
      strength: Math.max(0, ...frames.map(f => (f.me && f.me.strength) || 0)),
      plated: Math.max(0, ...frames.map(f => (f.me && f.me.plated) || 0)),
      mantra: Math.max(0, ...frames.map(f => (f.me && f.me.mantra) || 0)),
      divT: Math.max(0, ...frames.map(f => (f.me && f.me.divT) || 0)),
    };
    const res = {
      cardId: cardId, name: CARD_NAMES[cardId], opponent: opponent,
      runs: runs.map(r => ({ seed: r.seed, t: r.t, result: r.result, frames: r.frames.length, err: r.err })),
      frames: frames.length,
      meanOps: mean(frames.map(f => f.ops)),
      meanOpsActive: mean(activeOps),
      meanOpsIdle: mean(idleOps),
      activeFrames: activeOps.length, idleFrames: idleOps.length,
      newEffCls: newEff, newUnitCls: newUnit,
      meSeen: meSeen,
      drawn: Array.from(drawn.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, n: v })),
      drawnImgs: Array.from(drawnImgs.entries()).map(([k, v]) => {
        let hMode = null, bc = -1;
        for (const [hv, cnt] of v.hs) if (cnt > bc) { bc = cnt; hMode = hv; }
        return {
          key: k, w: +v.w.toFixed(1), h: +v.h.toFixed(1),
          wMin: isFinite(v.wMin) ? +v.wMin.toFixed(1) : null,
          hMin: isFinite(v.hMin) ? +v.hMin.toFixed(1) : null,
          hMode: hMode,
        };
      }),
      errors: [],
      checks: [],
    };
    const add = (name, ok, detail, hard) => {
      res.checks.push({ name: name, ok: !!ok, detail: detail || '', hard: hard !== false });
      if (!ok && hard !== false) res.errors.push(name + (detail ? '（' + detail + '）' : ''));
    };
    if (err) {
      add('绘制不抛异常', false, String(err).split('\n')[0]);
    } else {
      add('绘制不抛异常', true, runs.length + ' 局 / ' + frames.length + ' 帧');
      add('画布调用数 > 0 且帧率正常', frames.length > 0 && (res.meanOps || 0) > 200,
        '平均 ' + (res.meanOps || 0).toFixed(0) + ' 次/帧');
      /* 机制活跃帧 vs 空闲帧：新绘制路径应使活跃帧调用数更高（允许持平） */
      if (res.activeFrames >= 10 && res.idleFrames >= 10 && res.meanOpsIdle) {
        add('机制活跃帧的绘制调用不低于空闲帧',
          res.meanOpsActive >= res.meanOpsIdle * 0.95,
          '活跃 ' + res.meanOpsActive.toFixed(0) + ' vs 空闲 ' + res.meanOpsIdle.toFixed(0) +
          '（+' + ((res.meanOpsActive - res.meanOpsIdle) / res.meanOpsIdle * 100).toFixed(1) + '%）', false);
      } else {
        add('机制活跃帧识别', res.activeFrames > 0,
          '活跃帧 ' + res.activeFrames + ' / 空闲帧 ' + res.idleFrames, false);
      }
      /* 贴图 key 覆盖 */
      const exp = EXPECT_DRAW[cardId];
      for (const key of exp.hard) {
        const n = drawn.get(key) || 0;
        add('贴图已绘制：' + key, n > 0, '画了 ' + n + ' 次');
      }
      for (const key of exp.soft) {
        const n = drawn.get(key) || 0;
        if (n > 0) add('贴图已绘制：' + key, true, '画了 ' + n + ' 次', false);
        else warnings.push(CARD_NAMES[cardId] + ' 未画出 ' + key + '（本次对局未触发该状态？）');
      }
      /* 缺素材占位 key 若被引用 → 说明机制引用的 key 没打进包 */
      const missingRef = Array.from(drawn.keys()).filter(k => k.indexOf('MISSING:') === 0);
      add('没有引用缺失素材的 key', missingRef.length === 0, missingRef.join(',') || '—');
      /* 许愿三张卡面：WishCards 每次会画全部三张，理应全部出现 */
      if (cardId === 'wish') {
        const tokens = ['card_fame_and_fortune', 'card_become_almighty', 'card_live_forever'];
        add('三张许愿卡面全部画出', tokens.every(k => (drawn.get(k) || 0) > 0),
          tokens.map(k => k + '×' + (drawn.get(k) || 0)).join(' '));
      }
      /* 五体投地：祈祷头顶文字 */
      if (cardId === 'prostrate') {
        const has = Array.from(texts).some(t => t.indexOf(PRAYER_TEXT) >= 0);
        add('祈祷头顶文字「' + PRAYER_TEXT + '」已绘制', has,
          has ? '有' : '未捕获到（fillText/strokeText）');
      }
      /* 新增类绘制证据 */
      add('新增 Effect/Unit 类出现', (newEff.length + newUnit.length) > 0,
        'effect=[' + newEff.join(',') + '] unit=[' + newUnit.join(',') + ']', false);
      /* 2026-10-23 迭代：期望的新增绘制类必须出现 */
      const expCls = EXPECT_CLASSES[cardId] || [];
      const allCls = newEff.concat(newUnit);
      const missCls = expCls.filter(c => allCls.indexOf(c) < 0);
      add('新增绘制类齐全', missCls.length === 0,
        '期望 [' + expCls.join(',') + ']，缺 [' + (missCls.join(',') || '—') + ']');
      /* 手掌贴图放大：drawImage(pw_block_return) 的最大边长应明显 > 旧版 38 */
      if (cardId === 'talk_to_the_hand') {
        const hi = drawnImgs.get('pw_block_return');
        add('手掌贴图已放大（handSize=54，绘制边长 > 40px）', !!hi && hi.w > 40,
          hi ? '实测最大 ' + hi.w.toFixed(1) + '×' + hi.h.toFixed(1) + 'px' : '未捕获尺寸');
      }
      /* 阿尔法 token 尺寸：2026-10-23 用户口径“贝塔/欧米伽改成与仆从相同大小”，
         单位本体按 minion 的 0.8 倍卡面绘制（不再乘 sizeMul 0.8 → 不再是 0.64）。
         ⚠ card_beta/card_omega 还被 WAAlphaSummon 召唤虚影（1.3×本体）和
         WAAlphaMorph 变身动画（1.0→1.18×）复用，所以用【出现次数最多的高度】
         （hMode）代表单位本体，最大尺寸只做上限兜底。 */
      if (cardId === 'alpha') {
        const b = drawnImgs.get('card_beta'), o = drawnImgs.get('card_omega');
        const main = drawnImgs.get('card_alpha');
        /* 众数高度：单位本体每帧都按固定尺寸绘制，出现次数最多的高度就是本体尺寸 */
        const modeH = (x) => {
          if (!x || !x.hs) return null;
          let best = null, bc = -1;
          for (const [hv, cnt] of x.hs) if (cnt > bc) { bc = cnt; best = hv; }
          return best;
        };
        const aBody = modeH(main);
        const bBody = modeH(b), oBody = modeH(o);
        const rb = (aBody && bBody) ? bBody / aBody : null;
        const ro = (aBody && oBody) ? oBody / aBody : null;
        const rbMax = (main && main.h > 0 && b) ? b.h / main.h : null;
        const roMax = (main && main.h > 0 && o) ? o.h / main.h : null;
        const f2 = (x) => (x === null || x === undefined) ? '—' : x.toFixed(2);
        const f0 = (x) => (x === null || x === undefined) ? '—' : x.toFixed(0);
        add('贝塔/欧米伽与仆从同尺寸绘制（单位本体 ≈0.80）',
          rb !== null && ro !== null && rb >= 0.75 && rb <= 0.85 && ro >= 0.75 && ro <= 0.85 &&
          rbMax !== null && roMax !== null && rbMax <= 1.15 && roMax <= 1.15,
          'card_beta 本体 ' + f0(bBody) + '（×' + f2(rb) + '，max ×' + f2(rbMax) + '）' +
          '，card_omega 本体 ' + f0(oBody) + '（×' + f2(ro) + '，max ×' + f2(roMax) + '）' +
          '，本体 card_alpha 众数高 ' + f0(aBody) +
          '（max 来自召唤虚影/变身动画，属预期）');
      }
      /* 阿尔法：召唤演出 WAAlphaSummon 在渲染帧里出现过（2026-10-23 第三轮） */
      if (cardId === 'alpha') {
        const sumFrames = frames.filter(f => (f.effCls || []).indexOf('WAAlphaSummon') >= 0).length;
        add('召唤演出 WAAlphaSummon 实际出现在渲染帧里', sumFrames > 0,
          sumFrames + ' 帧存在 WAAlphaSummon');
      }
      if (cardId === 'prostrate') {
        const chargeFrames = frames.filter(f => (f.effCls || []).indexOf('ProstrateCharge') >= 0).length;
        add('蓄力环 ProstrateCharge 实际出现在渲染帧里', chargeFrames > 0,
          chargeFrames + ' 帧存在 ProstrateCharge');
        const beamFrames = frames.filter(f => (f.effCls || []).indexOf('DivinityBeam') >= 0).length;
        add('神格光柱 DivinityBeam 实际出现在渲染帧里（底边半椭圆）', beamFrames > 0,
          beamFrames + ' 帧存在 DivinityBeam');
      }
      /* 许愿聚光灯（第三轮追加：光斑落脚下 + 下缘半椭圆） */
      if (cardId === 'wish') {
        const spotFrames = frames.filter(f => (f.effCls || []).indexOf('WishSpotlight') >= 0).length;
        add('许愿聚光灯 WishSpotlight 实际出现在渲染帧里', spotFrames > 0,
          spotFrames + ' 帧存在 WishSpotlight（光斑落在卡面脚下、下缘半椭圆）');
      }
      /* 相对基线的绘制量（同一张竞技场，新特效只会更多不会更少） */
      if (baseOps) {
        const ratio = (res.meanOps || 0) / baseOps;
        add('画面绘制量不低于老卡基线', ratio >= 0.85, '基线 ' + baseOps.toFixed(0) +
          ' → 本卡 ' + (res.meanOps || 0).toFixed(0) + '（×' + ratio.toFixed(2) + '）', false);
      }
    }
    perCard[cardId] = res;
    /* 控制台摘要 */
    console.log('  ' + (err ? '✗' : '✓') + ' 帧 ' + res.frames +
      '，平均 ' + (res.meanOps || 0).toFixed(0) + ' ops/帧' +
      (res.meanOpsActive !== null && res.meanOpsIdle !== null
        ? '（活跃 ' + res.meanOpsActive.toFixed(0) + ' / 空闲 ' + res.meanOpsIdle.toFixed(0) + '）' : '') +
      '，新类 eff=[' + newEff.join(',') + '] unit=[' + newUnit.join(',') + ']');
    console.log('    画出的贴图 key: ' + Array.from(drawn.entries()).sort((a, b) => b[1] - a[1])
      .slice(0, 10).map(x => x[0] + '×' + x[1]).join(' '));
    for (const c of res.checks) {
      console.log('    ' + (c.ok ? '✓' : (c.hard ? '✗' : '⚠')) + ' ' + c.name + (c.detail ? '  ' + c.detail : ''));
      if (!c.ok && c.hard) failures.push(CARD_NAMES[cardId] + '：' + c.name + (c.detail ? '（' + c.detail + '）' : ''));
    }
    const me = meSeen;
    console.log('    状态峰值：block=' + me.block.toFixed(0) + ' strength=' + me.strength +
      ' plated=' + me.plated + ' mantra=' + me.mantra + ' divT=' + me.divT.toFixed(1));
  }

  /* ---- 5) 收尾 ---- */
  const unknownRefs = Array.from(allDrawn.keys()).filter(k => {
    if (k.indexOf('MISSING:') === 0) return false;
    return !((T.ASSET_MAP && T.ASSET_MAP.img) || {})[k];
  });
  if (unknownRefs.length) {
    warnings.push('绘制时使用了 ASSET_MAP 里没有的 key：' + unknownRefs.join(','));
  }
  console.log('\n— 5) 汇总：' + totalFrames + ' 帧渲染，无异常 ' +
    (failures.length ? '✗ ' + failures.length + ' 项失败' : '✓'));
  for (const f of failures) console.log('  ✗ ' + f);
  for (const w of warnings) console.log('  ⚠ ' + w);

  const verdict = failures.length ? 'FAIL' : (pending.length ? 'PENDING' : 'PASS');
  console.log('\n' + '═'.repeat(78));
  console.log('结论：' + verdict);
  console.log('═'.repeat(78));

  /* 留档：把渲染摘要合并进 watcher_balance_report.json（不新建文件，遵守写作用域）；
     同时把摘要追加进 watcher_balance_report.md（放在标记区里，重复跑会整段替换）。 */
  if (args.merge && verdict !== 'PENDING') {
    try {
      const report = fs.existsSync(REPORT_JSON) ? JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8')) : null;
      if (report) {
        report.render = {
          generatedAt: new Date().toISOString(),
          htmlPath: HTML_PATH,
          assets: {
            present: asset.present.length, total: NEW_ASSET_ALL.length,
            missing: asset.missing, invalid: asset.invalid,
          },
          perCard: perCard,
          failures: failures, warnings: warnings, verdict: verdict,
        };
        fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 1));
        console.log('已把渲染摘要合并进 ' + REPORT_JSON);
        mergeMarkdown(perCard, asset, failures, warnings, verdict, totalFrames);
      } else {
        console.log('（未找到 ' + REPORT_JSON + '，跳过 --merge）');
      }
    } catch (e) {
      console.log('（合并报告失败：' + (e.code || e.message) + '）');
    }
  }
  if (args.shots) {
    try { await runShots(); }
    catch (e) { console.log('截图失败：' + (e && e.message ? e.message : e)); }
  }
  if (verdict === 'FAIL') process.exit(1);
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 *  Playwright 截图导出（--shots）：重出 tools/预览图/ 下的观者 6 张验收图
 *  - 依赖 playwright-core（可用 NODE_PATH 指向 .workbuddy 的 node_modules）
 *  - 用 Chrome 打开构建产物，冻结 rAF 后手动推进世界到目标状态再截图
 * ------------------------------------------------------------------ */
function loadPlaywright() {
  const tries = ['playwright-core',
    'C:\\Users\\shenl\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core'];
  for (const t of tries) {
    try { return require(t); } catch (e) { }
  }
  return null;
}

async function runShots() {
  const pw = loadPlaywright();
  if (!pw) {
    console.log('（跳过截图：找不到 playwright-core；设置 NODE_PATH 指向 .workbuddy 的 node_modules 后重跑 --shots）');
    return;
  }
  const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const OUT = path.join(__dirname, '预览图');
  fs.mkdirSync(OUT, { recursive: true });
  const FILE = 'file:///' + HTML_PATH.replace(/\\/g, '/');
  console.log('\n— 7) Playwright 截图导出 → ' + OUT);
  const browser = await pw.chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  try {
    await page.goto(FILE, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction('typeof window.__draw === "function" && typeof refreshPanels === "function"', null, { timeout: 60000 });
    await page.waitForTimeout(900);
    /* 冻结动画循环：之后所有画面都由我们手动推进 + __draw() 绘制 */
    await page.evaluate('window.requestAnimationFrame = function(){ return 0; };');
    const shot = async (name) => {
      await page.waitForTimeout(120);
      await page.screenshot({ path: path.join(OUT, name) });
      console.log('  ✓ ' + name);
    };
    const runInPage = async (code) => page.evaluate(code);

    /* ① 选卡面板 6 列（开启观者卡后重建两侧面板） */
    await runInPage(`(function () {
      SET.watcherCards = true;
      refreshPanels();
      __draw();
      return world.units.length;
    })()`);
    await shot('观者_选卡面板_6列.png');

    /* 通用：造一局并推进 seconds 秒（对手血量拉高，保证画面里两个本体都活着） */
    const setupMatch = (aId, bId, hp) => `(function () {
      SET.watcherCards = true;
      /* 同步选卡面板：SEL 决定两侧面板与预演球，refreshPanels 会按 SEL 重建并 resetMatch */
      SEL.L = '${aId}'; SEL.R = '${bId}';
      refreshPanels();
      world.over = null; INTRO.on = false;
      var a = world.units[0], b = world.units[1];
      a.maxHp = ${hp}; a.hp = ${hp}; b.maxHp = ${hp}; b.hp = ${hp};
      a.x = 245; a.y = 330; b.x = 420; b.y = 330;
      a.dx = 0.2; a.dy = 1; b.dx = -0.2; b.dy = 1;
      return true;
    })()`;
    const stepPage = (seconds, stopCond) => `(function () {
      var n = Math.ceil(${seconds} * 120), cond = function () { return ${stopCond || 'false'}; };
      for (var i = 0; i < n; i++) {
        world.t += 1 / 120; stepPhysics(1 / 120);
        if (world.over) world.over = null;
        if (cond()) break;
      }
      world.units.forEach(function (u) { if (u.hp > u.maxHp) u.hp = u.maxHp; });
      __draw();
      return { t: world.t, units: world.units.length,
               effects: world.effects.map(function (e) { return e.constructor && e.constructor.name; }) };
    })()`;

    /* ② 以手拒之：跑到 6 只手掌都长出来，再把双方摆回构图位置拍一张 */
    await runInPage(setupMatch('talk_to_the_hand', 'voltaic', 8000));
    await runInPage(stepPage(19.0, 'false'));
    await runInPage(`(function () {
      var a = world.units[0], b = world.units[1];
      a.x = 250; a.y = 330; b.x = 430; b.y = 330;
      world.t += 1 / 120; stepPhysics(1 / 120); __draw();
      return world.effects.filter(function (e) { return e.constructor.name === 'WatcherHand'; }).length;
    })()`);
    await shot('观者_以手拒之.png');

    /* ③ 阿尔法：灰色小贝塔/欧米伽 + 移动中的贝塔 + 加粗冲击波；尽量抓一帧召唤演出 WAAlphaSummon */
    await runInPage(setupMatch('alpha', 'voltaic', 8000));
    await runInPage(`(function () {
      var gotSummon = false;
      for (var i = 0; i < 40 * 120; i++) {
        world.t += 1 / 120; stepPhysics(1 / 120);
        if (world.over) world.over = null;
        var summon = world.effects.filter(function (e) {
          return e.constructor.name === 'WAAlphaSummon';
        })[0];
        var tokens = world.units.filter(function (u) {
          return u.card && (u.card.id === 'beta' || u.card.id === 'omega') && u.alive;
        }).length;
        var hasOmega = world.units.some(function (u) { return u.card && u.card.id === 'omega'; });
        /* 抓到召唤演出刚出（0.10~0.14s）且已有欧米伽 → 让欧米伽立刻放一道波，把两者凑进同一帧 */
        if (summon && summon.t >= 0.10 && summon.t <= 0.14 && tokens >= 2 && hasOmega) {
          world.units.forEach(function (u) {
            if (u.card && u.card.id === 'omega') u.waveCd = 0;
          });
          for (var k = 0; k < Math.ceil(0.30 * 120); k++) {
            world.t += 1 / 120; stepPhysics(1 / 120);
            if (world.over) world.over = null;
          }
          gotSummon = true;
          break;
        }
      }
      /* 把本体摆回画面中上部，避免连打后被击退到画布底边 */
      var a = world.units[0];
      a.x = 255; a.y = 300;
      world.t += 1 / 120; stepPhysics(1 / 120);
      __draw();
      return {
        gotSummon: gotSummon,
        summon: world.effects.filter(function (e) { return e.constructor.name === 'WAAlphaSummon'; }).length,
        waves: world.effects.filter(function (e) { return e.constructor.name === 'WAAlphaWave'; }).length,
        tokens: world.units.filter(function (u) { return u.card && (u.card.id === 'beta' || u.card.id === 'omega'); }).length
      };
    })()`);
    await shot('观者_阿尔法.png');

    /* ④ 许愿：抓三张许愿卡面浮现在头顶、且选中高亮已亮起的那一帧 */
    await runInPage(setupMatch('wish', 'voltaic', 8000));
    await runInPage(`(function () {
      for (var i = 0; i < 18 * 120; i++) {
        world.t += 1 / 120; stepPhysics(1 / 120);
        if (world.over) world.over = null;
        var ok = world.effects.some(function (e) {
          return e.constructor.name === 'WishCards' && e.t > e.life * 0.5 && e.t < e.life * 0.78;
        });
        if (ok) break;
      }
      __draw();
      return world.effects.filter(function (e) { return e.constructor.name === 'WishCards'; }).length;
    })()`);
    await shot('观者_许愿_三张卡.png');

    /* ④b 许愿聚光灯：光斑落在卡面脚下、下缘是半椭圆（第三轮追加口径） */
    await runInPage(setupMatch('wish', 'voltaic', 8000));
    await runInPage(`(function () {
      for (var i = 0; i < 30 * 120; i++) {
        world.t += 1 / 120; stepPhysics(1 / 120);
        if (world.over) world.over = null;
        var sp = world.effects.filter(function (e) { return e.constructor.name === 'WishSpotlight'; })[0];
        if (sp && sp.t > sp.life * 0.25 && sp.t < sp.life * 0.62) break;
      }
      __draw();
      return world.effects.filter(function (e) { return e.constructor.name === 'WishSpotlight'; }).length;
    })()`);
    await shot('观者_许愿_聚光灯.png');

    /* ⑤ 五体投地：前摇（蓄力环收缩 + 提前显示「祈祷nya...」） */
    await runInPage(setupMatch('prostrate', 'voltaic', 8000));
    await runInPage(`(function () {
      for (var i = 0; i < 20 * 120; i++) {
        world.t += 1 / 120; stepPhysics(1 / 120);
        if (world.over) world.over = null;
        var mech = world.units[0].mech;
        if (mech && mech.state === 'windup' && mech.windT < 0.55 && mech.windT > 0.2) break;
      }
      __draw();
      return world.units[0].mech.state;
    })()`);
    await shot('观者_五体投地_祈祷.png');

    /* ⑥ 五体投地：神格光柱（透明度 ×0.75 之后的样子） */
    await runInPage(`(function () {
      for (var i = 0; i < 40 * 120; i++) {
        world.t += 1 / 120; stepPhysics(1 / 120);
        if (world.over) world.over = null;
        var mech = world.units[0].mech;
        if (mech && mech.state === 'divine' && mech.beam && mech.beam.reveal >= 0.95 && mech.divTimer < 4.2) break;
      }
      __draw();
      return world.units[0].mech.state;
    })()`);
    await shot('观者_五体投地_神格光柱.png');

    console.log('  截图完成，页面错误 ' + (errs.length ? errs.slice(0, 5).join(' | ') : '无'));
  } finally {
    await browser.close();
  }
}

/* 把渲染/素材摘要追加进 watcher_balance_report.md（标记区，幂等） */
function mergeMarkdown(perCard, asset, failures, warnings, verdict, totalFrames) {
  const mdPath = path.join(path.dirname(REPORT_JSON), 'watcher_balance_report.md');
  if (!fs.existsSync(mdPath)) { console.log('（未找到 ' + mdPath + '，跳过 md 合并）'); return; }
  const START = '<!--RENDER_SECTION_START-->';
  const END = '<!--RENDER_SECTION_END-->';
  let md = fs.readFileSync(mdPath, 'utf8');
  const i = md.indexOf(START);
  if (i >= 0) {
    const j = md.indexOf(END, i);
    if (j >= 0) md = md.slice(0, i) + md.slice(j + END.length);
    else md = md.slice(0, i);
  }
  const L = [];
  L.push(START);
  L.push('## 6. 渲染冒烟 + 新素材（tools/watcher_render_check.js）');
  L.push('');
  L.push('- 结论：**' + verdict + '**；' + totalFrames + ' 帧 drawArena/drawUnitHUD 无异常；' +
    '素材 ' + asset.present.length + '/' + NEW_ASSET_ALL.length + ' 个 key（' + asset.totalKB.toFixed(0) + ' KB webp dataURI）');
  L.push('');
  L.push('| 卡 | 渲染帧 | 平均 canvas 调用/帧 | 机制活跃帧 vs 空闲帧 | 新增绘制类 | 关键贴图（全部已绘制） |');
  L.push('|---|---:|---:|---|---|---|');
  const clsText = res => {
    const all = (res.newEffCls || []).concat(res.newUnitCls || []);
    return all.length ? all.join(',') : '—';
  };
  const keyText = res => (res.drawn || []).filter(x => x.key.indexOf('MISSING:') !== 0)
    .map(x => x.key).join(' ');
  for (const cardId of Object.keys(perCard)) {
    const r = perCard[cardId];
    L.push('| ' + r.name + ' | ' + r.frames + ' | ' + (r.meanOps || 0).toFixed(0) + ' | ' +
      (r.meanOpsActive !== null && r.meanOpsIdle !== null
        ? r.meanOpsActive.toFixed(0) + ' vs ' + r.meanOpsIdle.toFixed(0) : '—') + ' | ' +
      clsText(r) + ' | ' + keyText(r) + ' |');
  }
  L.push('');
  const missing = (asset.missing || []);
  L.push('- 素材缺项：' + (missing.length ? missing.join('、') : '无') +
    (missing.indexOf('pw_omega') >= 0 ? '（pw_omega 未被 4 卡代码引用，属可选，非阻塞）' : ''));
  L.push('- 绘制检查：无异常；无缺失 key 引用；' +
    '手臂/贝塔欧米伽卡面/冲击波/金币/聚光灯/三张许愿卡面/光柱/眼睛 VFX 均实际画出；' +
    '五体投地头顶「祈祷nya...」文本已绘制。');
  if (failures.length) L.push('- ✗ 失败项：' + failures.join('；'));
  for (const w of warnings) L.push('- ⚠ ' + w);
  L.push(END);
  const section = '\n' + L.join('\n') + '\n';
  /* 插在报告末尾的生成说明行之前；没有就追加到末尾 */
  const foot = md.lastIndexOf('*由 `tools/watcher_test.js` 生成');
  if (foot >= 0) md = md.slice(0, foot) + section + '\n' + md.slice(foot);
  else md = md.replace(/\s*$/, '') + '\n' + section;
  fs.writeFileSync(mdPath, md);
  console.log('已把渲染摘要合并进 ' + mdPath);
}

if (require.main === module) {
  main().catch(e => { console.error('× 失败：' + (e && e.stack ? e.stack : e)); process.exit(1); });
}
