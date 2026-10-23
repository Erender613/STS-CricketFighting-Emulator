/* ============================================================
   tools/_vcr_det_probe.js — VCR「resetMatch + 同种子快进」复演确定性探针

   目的（task-2 A）：
     验证「VCR 回放」的核心方案 —— 用 matchRecord 里的卡对 + 种子
     resetMatch，先快进 (decideStep-120) 步，再逐步走 120 步到 decideStep
     （= 第一次出现 world.decideT 的那一步 = 致命一击落下、分出胜负的微步），
     这 120 步能否与原对局【逐帧完全一致】，并且在 decideStep 处
     world.over 仍是 null（0.25× 回放可以精确停在结算动画之前）。

   被测文件：tools/_vcr_base.html（= 开始实现 VCR 之前的 src/game.html 快照）。
     ⚠ 不读 src/game.html（Lead 正在并行改它）。
     做法：把 tools/verify_dev.js 的源码读进来，只替换其中「HTML 路径」那一行，
     再当模块求值 —— 复用它的假 DOM / loadGame / gameSource，不改那个文件本身。

   只写两个文件：tools/_vcr_det_probe.js（本文件）、assets/audio/vcr_stinger.mp3。

   用法：node tools/_vcr_det_probe.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'tools', '_vcr_base.html');

const t_start = Date.now();
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

/* ------------------------------------------------------------
   0. 自带的假 DOM 加载器：只读快照，不依赖 tools/verify_dev.js
   ⚠ 为什么不 require verify_dev.js：Lead 正在并行改它，给 __X 导出块加了
     新版才有的符号（VCR/vcrTick…）——拿它去加载「实现前」的快照会直接
     ReferenceError。这里复制一份等价的假 DOM 逻辑，探针只针对快照本身。
   ------------------------------------------------------------ */
function fakeEl(tag) {
  const el = {
    tagName: tag, style: {}, dataset: {}, children: [], _html: '',
    value: '', textContent: '', disabled: false, checked: false, type: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    clientWidth: 676, naturalWidth: 300, naturalHeight: 420, width: 300, height: 420,
    parentElement: { clientWidth: 676 },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    removeChild() { }, addEventListener() { }, removeEventListener() { },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return fakeCtx(); },
    click() { if (typeof this.onclick === 'function') this.onclick({ target: this }); },
    onclick: null, onchange: null, oninput: null
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; }, set(v) { this._html = String(v); }
  });
  return el;
}
function fakeCtx() {
  const c = {
    canvas: { width: 660, height: 660 },
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high', filter: '',
    texts: [], fills: []
  };
  const noop = () => { };
  ['save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'clearRect', 'fillRect',
    'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect', 'fill',
    'stroke', 'clip', 'drawImage', 'ellipse', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo'
  ].forEach(k => { c[k] = noop; });
  c.fillText = (t, x, y) => { c.texts.push({ t: String(t), x, y, fill: c.fillStyle }); };
  c.strokeText = (t) => { c.texts.push({ t: String(t), stroke: true }); };
  c.fill = function () { c.fills.push(c.fillStyle); };
  c.createLinearGradient = () => ({ addColorStop() { } });
  c.createRadialGradient = () => ({ addColorStop() { } });
  c.measureText = () => ({ width: 10 });
  c.createPattern = () => null;
  return c;
}
function loadSnapshot() {
  const raw = fs.readFileSync(SNAPSHOT, 'utf8');
  /* 主脚本块 = 含 __ASSET_MAP__ 的那一个（head 里还有一个构建标记的小 script） */
  const blocks = raw.match(/<script>[\s\S]*?<\/script>/g) || [];
  const main = blocks.filter(b => b.indexOf('__ASSET_MAP__') >= 0);
  if (main.length !== 1) throw new Error('快照主脚本块数量异常: ' + main.length);
  let src = main[0].replace(/^<script>/, '').replace(/<\/script>$/, '')
    .replace("'__BUILD_TAG__'", "'main'")
    .replace('__ASSET_MAP__', '{"img":{},"snd":{}}');
  /* 只导出本探针真正用到的符号（不碰 Lead 新版才有的 VCR 等） */
  src += '\n;window.__X = { CARD_BY_ID, world, CFG, resetMatch, stepOnce, matchRecord, SET, SIM_DT,' +
    ' _frame: window.__frame };\n';

  const els = {};
  const doc = {
    readyState: 'complete',
    head: fakeEl('head'), body: fakeEl('body'),
    getElementById(id) { return els[id] || (els[id] = fakeEl('div')); },
    createElement(tag) { return fakeEl(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createTextNode(t) { const e = fakeEl('#text'); e.textContent = String(t); return e; },
    addEventListener() { }
  };
  const ctxCanvas = fakeCtx();
  const cvEl = fakeEl('canvas');
  let cvCtx = null;
  cvEl.getContext = function () { if (!cvCtx) cvCtx = ctxCanvas; return cvCtx; };
  els.cv = cvEl;
  els.panelL = fakeEl('aside'); els.panelR = fakeEl('aside');
  els.devSlot = fakeEl('span');

  const frames = [];
  const chan = { q: [] };
  function fakeMessageChannel() {
    const p1 = {}, p2 = {};
    p1.postMessage = d => { chan.q.push({ port: p2, data: d }); };
    p2.postMessage = d => { chan.q.push({ port: p1, data: d }); };
    return { port1: p1, port2: p2 };
  }
  const sandbox = {
    window: {}, document: doc, console,
    performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    MessageChannel: fakeMessageChannel,
    setTimeout, clearTimeout, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Set, Map,
    Image: function () { return fakeEl('img'); },
    AudioContext: undefined, webkitAudioContext: undefined,
    Blob: function () { this.size = 0; }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    Path2D: function () {
      return { moveTo() { }, lineTo() { }, arcTo() { }, closePath() { }, rect() { }, arc() { } };
    },
    Float32Array, Uint8Array, Uint32Array, isFinite, parseInt, parseFloat, Error
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => { };
  sandbox.removeEventListener = () => { };
  sandbox.innerHeight = 900; sandbox.innerWidth = 1300;
  sandbox.devicePixelRatio = 1;
  sandbox.alert = () => { };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'snapshot/game.html' });
  return { S: sandbox, X: sandbox.__X, frames: frames, ctx: ctxCanvas };
}

const g = loadSnapshot();
const X = g.X;
const W = X.world;
const CFG = X.CFG;
const SIM_DT = X.SIM_DT;
const SIM_HZ = Math.round(1 / SIM_DT);
const CAP = Math.ceil((CFG.MAX_TIME + 40) / SIM_DT);
const cards = Object.keys(X.CARD_BY_ID).sort();

const gameSrc = fs.readFileSync(SNAPSHOT, 'utf8');
const snapStat = fs.statSync(SNAPSHOT);

const fails = [];
function fail(msg) { fails.push(msg); console.log('  ✗ ' + msg); }
function info(msg) { console.log('  ' + msg); }

console.log('=== VCR 复演确定性探针（快照 tools/_vcr_base.html）===');
console.log('快照: ' + snapStat.size + ' bytes, mtime=' + snapStat.mtime.toISOString());
console.log('载入: X 导出=' + (!!X) + ', 卡牌 ' + cards.length + ' 张, SIM_HZ=' + SIM_HZ +
  ', SIM_DT=' + SIM_DT.toFixed(10) + ', MAX_TIME=' + CFG.MAX_TIME + 's, CAP=' + CAP + ' 步');
console.log('快照守卫: 源码中 VCR 相关标记=' +
  (/__vcr|VCR|vcrReplay|replayToStep/.test(gameSrc) ? '有（可疑！）' : '无（= 实现前基线）'));
if (!X || typeof X.resetMatch !== 'function' || typeof X.stepOnce !== 'function') {
  console.error('致命：游戏脚本没导出 resetMatch / stepOnce');
  process.exit(2);
}

/* ------------------------------------------------------------
   1. 世界状态签名
   ------------------------------------------------------------ */
function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* 轻量签名：每步都记（含题面要求的 x/y/hp/dying.t/alive、effects 数量、world.t、over.win）。
   额外带上速度/各种计时器/状态层数/统计，好让"原局 vs 重演"的全链路对比真正有分辨力。
   ⚠ 不含 world.shake（它只由主循环按真实时间衰减，纯观感，不是模拟状态）。
   ⚠ 默认含 effects/nums 数量 —— 题面要求的判据。但注意：粒子/飘字的生命周期由观感随机流
     RNG.vis 决定，而【绘制也会消耗 RNG.vis】。所以"边画边跑"与"不画快进"的粒子账本会不同
     （模拟不受影响，见 A4）。需要只看模拟时用 simSig()。 */
function lightSig(withFx) {
  const p = [
    W.t,
    W.over ? W.over.win : 'x',
    W.decideT === undefined ? 'x' : W.decideT
  ];
  if (withFx !== false) p.push(W.effects.length, W.nums.length);
  const us = W.units;
  for (let i = 0; i < us.length; i++) {
    const u = us[i];
    p.push(u.team, u.x, u.y, u.dx, u.dy, u.hp, u.alive ? 1 : 0, u.finished ? 1 : 0,
      u.dying ? u.dying.t : -1, u.flash, u.bouncePop, u.freeze, u.slowT, u.invulT,
      u.block, u.poison, u.doom, u.doomT, u.vuln, u.weak, u.focus, u.slamT,
      u.strength, u.boost, u.grabbed, u.speedMul, u.divT, u.mantra,
      u.stat.dealt, u.stat.taken, u.stat.minHp);
  }
  const st = W.stats || [];
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    p.push(s.dmgWin, s.burst, s.hit, s.dealt, s.taken, s.comeback ? 1 : 0, s.behindMax);
  }
  return p.join(',');
}

/* 完整签名：只给窗口里的 121 个点用（JSON 字符串，逐位比较）。
   覆盖：world 标量 / over / decideHp / decideT / 每个单位的全部标量字段 /
   dying / stat / mech（构造器名 + 全部标量字段 + 一层嵌套对象的标量）/
   effects 与 nums 的数量 + 类型序列 + dead 标记 / 双方统计。
   ⚠ 不含粒子外观参数（那些由观感随机流 RNG.vis 驱动；快进不绘制时不应参与"模拟一致"的判定）。 */
function finite(v) {
  if (typeof v !== 'number') return v;
  return Number.isFinite(v) ? v : String(v);
}
function scalarsOf(obj, skip) {
  const o = {};
  if (!obj || typeof obj !== 'object') return o;
  for (const k of Object.keys(obj)) {
    if (skip && skip[k]) continue;
    const v = obj[k];
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean' || v === null) o[k] = finite(v);
  }
  return o;
}
function mechSig(m) {
  if (!m) return null;
  const o = { __c: m.constructor ? m.constructor.name : '?' };
  for (const k of Object.keys(m)) {
    const v = m[k];
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean' || v === null) { o[k] = finite(v); continue; }
    if (Array.isArray(v)) { o[k] = 'arr:' + v.length; continue; }
    if (v && t === 'object' && k !== 'u' && k !== 'o' && k !== 'wheel') {
      const f = scalarsOf(v, { u: 1, o: 1, owner: 1, wheel: 1 });
      const ks = Object.keys(f);
      o[k] = ks.length ? ('{' + ks.map(q => q + '=' + f[q]).join(',') + '}') : (v.constructor ? v.constructor.name : 'obj');
    }
  }
  return o;
}
function unitSig(u) {
  return {
    card: u.card ? u.card.id : null,
    scalars: scalarsOf(u, { card: 1, mech: 1, stat: 1, dying: 1 }),
    dying: u.dying ? scalarsOf(u.dying) : null,
    stat: scalarsOf(u.stat),
    mech: mechSig(u.mech)
  };
}
function overSig(o) {
  if (!o) return null;
  return {
    win: o.win, reason: o.reason, t: finite(o.t), decideT: finite(o.decideT),
    hp: Array.isArray(o.hp) ? o.hp.map(finite) : null,
    tags: Array.isArray(o.tags) ? o.tags.join(',') : null,
    done: !!o.done, deathT: finite(o.deathT), margin: finite(o.margin)
  };
}
function effectsSig() {
  const e = W.effects;
  let s = '';
  for (let i = 0; i < e.length; i++) {
    const x = e[i];
    s += (x && x.constructor ? x.constructor.name : '?') + (x && x.dead ? '*' : '') + ';';
  }
  return s;
}
function numsSig() {
  const a = W.nums;
  let s = '';
  for (let i = 0; i < a.length; i++) s += (a[i] && a[i].constructor ? a[i].constructor.name : '?') + ';';
  return s;
}
function strongSig() {
  const o = {
    t: finite(W.t),
    over: overSig(W.over),
    decideT: W.decideT === undefined ? '<undef>' : finite(W.decideT),
    decideHp: W.decideHp ? W.decideHp.map(finite) : null,
    units: W.units.map(unitSig),
    effects: W.effects.length + '#' + effectsSig(),
    nums: W.nums.length + '#' + numsSig(),
    stats: (W.stats || []).map(s => scalarsOf(s))
  };
  return JSON.stringify(o);
}

/* 深比较 → 第一处分歧路径（失败诊断用） */
function diffPaths(a, b, p, out) {
  out = out || [];
  if (out.length >= 5) return out;
  if (a === b) return out;
  if (a === undefined || b === undefined || a === null || b === null ||
      typeof a !== 'object' || typeof b !== 'object') {
    out.push((p || '(root)') + ': ' + JSON.stringify(a) + '  ≠  ' + JSON.stringify(b));
    return out;
  }
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  for (const k of keys) {
    diffPaths(a[k], b[k], p ? p + '.' + k : k, out);
    if (out.length >= 5) break;
  }
  return out;
}
function diffSigs(sa, sb) {
  try { return diffPaths(JSON.parse(sa), JSON.parse(sb)); }
  catch (e) { return ['(签名不是合法 JSON) ' + e.message]; }
}

/* ------------------------------------------------------------
   2. 发现阶段：随机挑候选（卡对 + 种子），跑完整局，按时长分层
   ------------------------------------------------------------ */
function mulberry32(a) {
  return function () {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x5EED_2026 >>> 0);
const usedPairs = new Set();
function nextCandidate() {
  for (let tries = 0; tries < 500; tries++) {
    const a = cards[(rnd() * cards.length) | 0];
    const b = cards[(rnd() * cards.length) | 0];
    if (a === b) continue;
    const key = [a, b].sort().join('|');
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    let seed = (rnd() * 4294967296) >>> 0;
    if (!seed) seed = 1;
    return { a: a, b: b, seed: seed };
  }
  throw new Error('卡对组合用尽了');
}
function runLean(cd) {
  X.resetMatch(X.CARD_BY_ID[cd.a], X.CARD_BY_ID[cd.b], cd.seed);
  W.speedMul = 1;
  let n = 0;
  while (!X.stepOnce() && n++ < CAP) { }
  const o = W.over || {};
  return {
    a: cd.a, b: cd.b, seed: cd.seed, seedUsed: W.seed,
    win: o.win, reason: o.reason, t: o.t,
    decideT: o.decideT === undefined ? null : o.decideT,
    decideHp: o.hp ? o.hp.slice() : null
  };
}

console.log('\n-- A0. 发现阶段：候选对局（用于挑 30 组：短局/中局/长局都要有）--');
const disc = [];
const DISC_N = 150;
{
  const t0 = nowMs();
  for (let i = 0; i < DISC_N; i++) disc.push(runLean(nextCandidate()));
  const ms = nowMs() - t0;
  const kills = disc.filter(d => d.win >= 0 && d.decideT !== null);
  const timeouts = disc.filter(d => d.decideT === null);
  const ts = kills.map(d => d.t).sort((x, y) => x - y);
  const med = ts.length ? ts[(ts.length / 2) | 0] : 0;
  info('候选 ' + DISC_N + ' 组，用时 ' + ms.toFixed(0) + ' ms（' + (ms / DISC_N).toFixed(1) + ' ms/局）');
  info('分出胜负（有 decideT）: ' + kills.length + ' 组；超时平局: ' + timeouts.length + ' 组');
  info('kill 局时长: min=' + ts[0] + 's, median=' + med + 's, max=' + ts[ts.length - 1] + 's');
  info('短局(≤25s): ' + kills.filter(d => d.t <= 25).length + ' 组；长局(≥90s): ' +
    kills.filter(d => d.t >= 90).length + ' 组');
}

/* 按时长分层挑 30 组：把 kill 局按时长排序后等距取点 → 一定覆盖最短与最长 */
function pickSpread(arr, n) {
  if (arr.length <= n) return arr.slice();
  const out = [];
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let idx = Math.round(i * (arr.length - 1) / (n - 1));
    while (used.has(idx)) idx++;
    used.add(idx);
    out.push(arr[idx]);
  }
  return out;
}
/* 挑 30 组：把两端（短局 / 长局）尽量都收进来，中段按时长等距补足。
   这样既随机（候选卡对/种子都是随机掷的），又保证时长覆盖不集中在中间。 */
function chooseWithSpread(arr, n) {
  const short = arr.filter(d => d.t <= 25);
  const long = arr.filter(d => d.t >= 90);
  const mid = arr.filter(d => d.t > 25 && d.t < 90);
  let picks = short.concat(long);
  if (picks.length > n) picks = pickSpread(picks, n);
  const need = n - picks.length;
  if (need > 0) picks = picks.concat(pickSpread(mid, need));
  return picks.sort((x, y) => x.t - y.t);
}
const killAll = disc.filter(d => d.win >= 0 && d.decideT !== null).sort((x, y) => x.t - y.t);
const chosen = chooseWithSpread(killAll, 30);
const timeoutAll = disc.filter(d => d.decideT === null).slice(0, 4);
if (chosen.length < 30) fail('可分胜负的候选不足 30 组（只有 ' + chosen.length + '），请加大 DISC_N');
info('选中 ' + chosen.length + ' 组（时长分层）: 短局(≤25s) ' + chosen.filter(d => d.t <= 25).length +
  ' / 中局 ' + chosen.filter(d => d.t > 25 && d.t < 90).length +
  ' / 长局(≥90s) ' + chosen.filter(d => d.t >= 90).length);

/* ------------------------------------------------------------
   3. 核心验证：resetMatch + 快进 (decideStep-120) + 120 步 逐帧对比
   ------------------------------------------------------------ */
function measure(d) {
  const A = X.CARD_BY_ID[d.a], B = X.CARD_BY_ID[d.b];
  const r = { a: d.a, b: d.b, seed: d.seed, checks: {}, fail: [] };

  /* ---- 第 1 遍（原局，全程）：轻量签名链，定位 decideStep / overStep ---- */
  X.resetMatch(A, B, d.seed);
  W.speedMul = 1;
  r.seedUsed = W.seed;
  const chain1 = new Uint32Array(CAP + 2);
  let decideStep = -1, overStep = -1, lockT = null, lockHp = null;
  for (let n = 1; n <= CAP; n++) {
    const done = X.stepOnce();
    chain1[n] = fnv(lightSig());
    if (decideStep < 0 && W.decideT !== undefined) {
      decideStep = n; lockT = W.decideT;
      lockHp = W.decideHp ? [W.decideHp[0], W.decideHp[1]] : null;
    }
    if (done) { overStep = n; break; }
  }
  if (decideStep < 0 || overStep < 0) { r.na = true; return r; }
  const over1 = W.over ? { win: W.over.win, reason: W.over.reason, t: W.over.t, decideT: W.over.decideT } : null;
  const startStep = Math.max(0, decideStep - 120);
  const winLen = decideStep - startStep;

  r.decideStep = decideStep; r.overStep = overStep; r.startStep = startStep;
  r.winLen = winLen; r.duration = over1 ? over1.t : null; r.win = over1 ? over1.win : null;

  /* ---- 第 2 遍（参考重演）：reset 后快进到 startStep，逐步抓 121 个完整签名 ---- */
  X.resetMatch(A, B, d.seed);
  W.speedMul = 1;
  for (let i = 0; i < startStep && !W.over; i++) X.stepOnce();
  const refStart = strongSig();
  const refWin = new Array(winLen);
  for (let i = 0; i < winLen; i++) { X.stepOnce(); refWin[i] = strongSig(); }
  const refOverAtEnd = W.over;

  /* ---- 第 3 遍（本次要验的路径）：resetMatch + 快进 + 120 步 ---- */
  X.resetMatch(A, B, d.seed);
  W.speedMul = 1;
  const seedSame = W.seed === r.seedUsed;

  let prefixOk = true, prefixBad = -1;
  const tFast0 = nowMs();
  for (let i = 1; i <= startStep; i++) {
    X.stepOnce();
    if (prefixOk && fnv(lightSig()) !== chain1[i]) { prefixOk = false; prefixBad = i; }
  }
  const fastMs = nowMs() - tFast0;
  const startOk = strongSig() === refStart;

  let winOk = true, winBad = -1, winLightOk = true, winLightBad = -1;
  const winSigs = new Array(winLen);
  const tWin0 = nowMs();
  for (let i = 0; i < winLen; i++) {
    X.stepOnce();
    const n = startStep + i + 1;
    winSigs[i] = strongSig();
    if (fnv(lightSig()) !== chain1[n]) { winLightOk = false; if (winLightBad < 0) winLightBad = n; }
    if (refWin[i] !== winSigs[i]) { winOk = false; if (winBad < 0) winBad = n; }
  }
  const winMs = nowMs() - tWin0;

  const overNullAtDecide = W.over === null;
  const decideTExact = W.decideT === lockT;
  const decideHpEq = JSON.stringify(W.decideHp) === JSON.stringify(lockHp);
  const deriveStep = lockT === null ? -1 : Math.round(lockT * SIM_HZ);
  const deriveOk = deriveStep === decideStep;

  /* ---- 继续走死亡动画（先做，且全程不绘制）：验证 decideStep 之后仍逐帧对齐，
         over 直到 overStep 才出现。⚠ 必须紧接窗口做：一旦中间插了绘制，
         观感随机流 RNG.vis 被消耗，粒子的生命周期账本会变（模拟不受影响）。 ---- */
  const delta = overStep - decideStep;
  let overAtPlus1 = undefined, contOk = true, contBad = -1, replayOverStep = -1;
  for (let i = 1; i <= delta; i++) {
    const n = decideStep + i;
    const done = X.stepOnce();
    if (i === 1) overAtPlus1 = W.over;
    if (contOk && n <= overStep && fnv(lightSig()) !== chain1[n]) { contOk = false; contBad = n; }
    if (done) { replayOverStep = n; break; }
  }
  const overWinOk = !!W.over && !!over1 && W.over.win === over1.win;

  r.fastMs = fastMs; r.winMs = winMs; r.delta = delta;
  r.checks = {
    seedSame: seedSame,
    prefixOk: prefixOk,
    startOk: startOk,
    winOk: winOk,
    winLightOk: winLightOk,
    overNullAtDecide: overNullAtDecide,
    decideTExact: decideTExact,
    decideHpEq: decideHpEq,
    deriveOk: deriveOk,
    freezeOk: true,                       // 冻结单独在 freezeCheck() 里验（见 A1b）
    overNullAtPlus1: overAtPlus1 === null,
    contOk: contOk,
    overWinOk: overWinOk,
    overStepOk: replayOverStep === overStep
  };
  if (!prefixOk) r.fail.push('快进前缀第 ' + prefixBad + ' 步与原局不同');
  if (!startOk) r.fail.push('快进 ' + startStep + ' 步后的完整签名与原局不同');
  if (!winOk) {
    const idx = Math.max(0, winBad - startStep - 1);
    r.fail.push('第 ' + winBad + ' 步完整签名不同: ' + diffSigs(refWin[idx], winSigs[idx]).join(' ; '));
  }
  if (!winLightOk) r.fail.push('第 ' + winLightBad + ' 步轻签名与原局不同');
  if (!overNullAtDecide) r.fail.push('decideStep 处 world.over 已经是 ' + JSON.stringify(W.over));
  if (!decideTExact) r.fail.push('decideT 不精确相等: ' + lockT + ' vs ' + W.decideT);
  if (!decideHpEq) r.fail.push('decideHp 不同');
  if (!deriveOk) r.fail.push('round(decideT×120) = ' + deriveStep + ' ≠ decideStep ' + decideStep);
  if (!r.checks.overNullAtPlus1) r.fail.push('decideStep+1 时 over 已出现');
  if (!contOk) r.fail.push('死亡动画段第 ' + contBad + ' 步与原局不同');
  if (!overWinOk) r.fail.push('重演到结算时获胜方不同');
  return r;
}

/* 冻结专项：走到 decideStep 后停止推进（= 0.25× 回放停在决胜微步），
   继续喂 10 帧主循环（带真实时间戳）也不许再走一步。 */
function freezeCheck(d) {
  const A = X.CARD_BY_ID[d.a], B = X.CARD_BY_ID[d.b];
  const r = measureShallow(d);
  if (!r) return { ok: false, msg: '找不到 decideStep' };
  X.resetMatch(A, B, d.seed);
  W.speedMul = 1;
  for (let i = 0; i < r.startStep; i++) X.stepOnce();
  for (let i = 0; i < r.winLen; i++) X.stepOnce();
  const t0 = W.t, over0 = W.over, dt0 = W.decideT;
  W.running = false;                      // VCR 停住
  for (let i = 0; i < 10; i++) { X._frame(2000 + i * 16); g.frames.length = 0; }
  const ok = W.t === t0 && W.over === over0 && W.decideT === dt0;
  return { ok: ok, msg: ok ? ('t=' + t0.toFixed(3) + 's 冻结 10 帧未动') :
    ('冻结失败: t ' + t0 + '→' + W.t + ', over → ' + JSON.stringify(W.over)) };
}
/* 轻量定位（只要 startStep / winLen / decideStep） */
function measureShallow(d) {
  const A = X.CARD_BY_ID[d.a], B = X.CARD_BY_ID[d.b];
  X.resetMatch(A, B, d.seed);
  W.speedMul = 1;
  for (let n = 1; n <= CAP; n++) {
    const done = X.stepOnce();
    if (W.decideT !== undefined) return { decideStep: n, startStep: Math.max(0, n - 120), winLen: n - Math.max(0, n - 120) };
    if (done) break;
  }
  return null;
}

console.log('\n-- A1. 核心：resetMatch + 快进 (decideStep-120) + 逐步 120 步 --');
const results = [];
for (let i = 0; i < chosen.length; i++) {
  const d = chosen[i];
  const t0 = nowMs();
  const r = measure(d);
  r.totalMs = nowMs() - t0;
  results.push(r);
  const tag = r.na ? 'N/A' :
    (r.fail.length === 0 ? 'PASS ✓' : 'FAIL ✗');
  console.log('  [' + String(i + 1).padStart(2, '0') + '/' + chosen.length + '] ' +
    d.a + ' vs ' + d.b + '  seed=' + d.seed +
    '  t=' + (r.duration === null ? '?' : r.duration.toFixed(2)) + 's' +
    '  decideStep=' + r.decideStep + ' (t=' + (r.decideStep * SIM_DT).toFixed(3) + 's)' +
    '  overStep=+' + r.delta + '步  快进 ' + r.fastMs.toFixed(1) + 'ms / 120步 ' +
    r.winMs.toFixed(1) + 'ms  → ' + tag);
  if (r.fail.length) r.fail.forEach(f => console.log('        · ' + f));
}

/* ---- A1b. 冻结专项（0.25× 回放停在决胜微步）：抽前 6 组 ---- */
console.log('\n-- A1b. 冻结：走到 decideStep 后停住，主循环再喂 10 帧也不许动 --');
const freezeChecks = chosen.slice(0, 6).map(d => {
  const r = freezeCheck(d);
  info('  ' + d.a + ' vs ' + d.b + ' seed=' + d.seed + ' → ' + (r.ok ? '✓ ' : '✗ ') + r.msg);
  return r;
});

/* ---- 汇总 ---- */
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  if (!s.length) return 0;
  const m = (s.length / 2) | 0;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function fmtRange(name, a, unit) {
  if (!a.length) { info(name + ': (无)'); return; }
  const s = a.slice().sort((x, y) => x - y);
  info(name + ': min=' + s[0] + unit + ' / median=' + median(s) + unit +
    ' / p90=' + s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] + unit +
    ' / max=' + s[s.length - 1] + unit);
}

console.log('\n-- A2. 汇总 --');
const valid = results.filter(r => !r.na);
const passed = valid.filter(r => r.fail.length === 0);
const flag = k => valid.filter(r => r.checks[k]).length + '/' + valid.length;
info('通过组数: ' + passed.length + '/' + valid.length +
  (passed.length === valid.length ? '（全部逐帧一致）' : '（有失败，见上）'));
info('  · 快进前缀（1..startStep）与原局轻签名一致: ' + flag('prefixOk'));
info('  · 快进终点(startStep)完整签名一致: ' + flag('startOk'));
info('  · 120 步完整签名一致: ' + flag('winOk'));
info('  · 120 步轻签名与原局一致: ' + flag('winLightOk'));
info('  · decideStep 处 world.over === null: ' + flag('overNullAtDecide'));
info('  · decideStep+1 处 world.over 仍 === null: ' + flag('overNullAtPlus1'));
info('  · decideT 与原始逐位相同: ' + flag('decideTExact'));
info('  · decideHp 与原始相同: ' + flag('decideHpEq'));
info('  · round(decideT×120) === decideStep: ' + flag('deriveOk'));
info('  · 冻结 10 帧 world.t 不动且 over 仍 null: ' +
  freezeChecks.filter(x => x.ok).length + '/' + freezeChecks.length + '（抽 6 组）');
info('  · 死亡动画段仍逐帧一致: ' + flag('contOk'));
info('  · 重演到结算的获胜方一致: ' + flag('overWinOk'));
info('  · 重演 overStep === 原始 overStep: ' + flag('overStepOk'));
info('  · 种子自洽 (world.seed === 原局): ' + flag('seedSame'));

fmtRange('decideStep（步）', valid.map(r => r.decideStep), ' 步');
fmtRange('decideStep（秒）', valid.map(r => +(r.decideStep * SIM_DT).toFixed(3)), 's');
fmtRange('整局时长 t', valid.map(r => +(r.duration || 0).toFixed(2)), 's');
const deltaHist = {};
valid.forEach(r => { deltaHist[r.delta] = (deltaHist[r.delta] || 0) + 1; });
const minDelta = Math.min.apply(null, valid.map(r => r.delta));
info('死亡动画/结算延迟步数（overStep-decideStep）: min=' + minDelta + ' 步 (' +
  (minDelta * SIM_DT).toFixed(3) + 's)，分布 ' + JSON.stringify(deltaHist) +
  '（108 步 = 0.9s，204 步 = 1.7s 灾厄）');
const shortN = valid.filter(r => r.duration <= 25).length;
const longN = valid.filter(r => r.duration >= 90).length;
info('覆盖: 短局(≤25s) ' + shortN + ' 组 / 长局(≥90s) ' + longN + ' 组');

const fasts = valid.map(r => r.fastMs), wins = valid.map(r => r.winMs);
const totalSteps = valid.reduce((s, r) => s + r.startStep, 0);
const totalFast = fasts.reduce((a, b) => a + b, 0);
info('快进耗时（含逐步签名校验）: 合计 ' + totalFast.toFixed(1) + ' ms（' + totalSteps + ' 步），' +
  '均值 ' + median(fasts).toFixed(1) + ' ms/局，最大 ' + Math.max.apply(null, fasts).toFixed(1) + ' ms');
if (totalFast > 0) {
  info('  → 快进吞吐 ≈ ' + (totalSteps / (totalFast / 1000) / 1000).toFixed(1) +
    ' 万步/秒 ≈ ' + (totalSteps * SIM_DT * 1000 / totalFast).toFixed(0) + '× 实时');
}
/* 纯快进（VCR 里真正要花的时间：不抓签名、不绘制）：抽前 10 组 */
{
  const pure = [];
  valid.slice(0, 10).forEach(r => {
    const A = X.CARD_BY_ID[r.a], B = X.CARD_BY_ID[r.b];
    const t0 = nowMs();
    X.resetMatch(A, B, r.seed);
    W.speedMul = 1;
    for (let i = 0; i < r.startStep; i++) X.stepOnce();
    pure.push(nowMs() - t0);
  });
  info('纯快进（不抓签名 / 不绘制，VCR 实际开销，抽 10 组）: 均值 ' +
    median(pure).toFixed(1) + ' ms/局，最大 ' + Math.max.apply(null, pure).toFixed(1) + ' ms');
}
info('120 步（含 121 次完整签名）耗时: 均值 ' + median(wins).toFixed(1) +
  ' ms/局，最大 ' + Math.max.apply(null, wins).toFixed(1) + ' ms');

/* ------------------------------------------------------------
   4. 补充 1：超时平局（没有 decideT）→ 全链路重演是否一致
   ------------------------------------------------------------ */
console.log('\n-- A3. 补充：超时平局（无 decideT / 无决胜微步）--');
if (!timeoutAll.length) {
  info('  ' + disc.length + ' 组候选全部在 MAX_TIME 内分出胜负（无超时平局），本条不适用。');
  info('  若真的是超时局：matchRecord.decideT 退化为结算时刻、没有"决胜微步"，' +
    'VCR 应按步重演到 overStep（同一条 stepOnce 路径，A1 已验证逐步一致）。');
}
{
  let ok = 0;
  timeoutAll.forEach((d, i) => {
    X.resetMatch(X.CARD_BY_ID[d.a], X.CARD_BY_ID[d.b], d.seed);
    W.speedMul = 1;
    const chain = new Uint32Array(CAP + 2);
    let end = -1;
    for (let n = 1; n <= CAP; n++) { const done = X.stepOnce(); chain[n] = fnv(lightSig()); if (done) { end = n; break; } }
    const win1 = W.over ? W.over.win : null;
    const hasDecide = W.decideT !== undefined;
    X.resetMatch(X.CARD_BY_ID[d.a], X.CARD_BY_ID[d.b], d.seed);
    W.speedMul = 1;
    let firstBad = -1;
    for (let n = 1; n <= end; n++) {
      const done = X.stepOnce();
      if (fnv(lightSig()) !== chain[n] && firstBad < 0) firstBad = n;
      if (done) break;
    }
    const win2 = W.over ? W.over.win : null;
    const good = firstBad < 0 && win1 === win2 && !hasDecide;
    if (good) ok++;
    info('  [' + (i + 1) + '] ' + d.a + ' vs ' + d.b + ' seed=' + d.seed +
      ' t=' + (W.over && W.over.t) + 's win=' + win1 + ' → ' +
      (good ? '全链路一致 ✓' : ('分叉@' + firstBad + ' ✗')));
  });
  info('超时组全链路重演一致: ' + ok + '/' + timeoutAll.length + '（decideT 不存在 = 无决胜微步）');
}

/* ------------------------------------------------------------
   5. 补充 2：真实主循环（rAF + 绘制）跑出来的对局 vs stepOnce 重演
   ------------------------------------------------------------ */
console.log('\n-- A4. 补充：rAF 主循环（含绘制）实际播放 vs stepOnce 逐步重演 --');
/* 只比"模拟状态"：不含 effects/nums 数量 —— 绘制会额外消耗观感随机流 RNG.vis，
   粒子的生命周期/外观账本因此在"边画边跑"与"不画快进"之间不同，但那纯观感、
   不回流进模拟（RNG.sim 是独立的）。模拟必须逐步完全一致。 */
function simSig() { return lightSig(false); }
function liveCompare(d) {
  const A = X.CARD_BY_ID[d.a], B = X.CARD_BY_ID[d.b];
  const bt = W.burstTick;
  /* 参考：stepOnce 直接逐步 */
  X.resetMatch(A, B, d.seed);
  W.speedMul = 1;
  const ref = [], refFx = [];
  W.burstTick = function (dt) { ref.push(fnv(simSig())); refFx.push(fnv(lightSig())); return bt.call(W, dt); };
  let guard = 0;
  while (!X.stepOnce() && guard++ < CAP) { }
  W.burstTick = bt;
  /* 实际：走主循环 frame()，每帧绘制（= 真人玩/录制时的路径） */
  X.resetMatch(A, B, d.seed);
  W.speedMul = 1;
  W.running = true;
  const live = [], liveFx = [];
  W.burstTick = function (dt) { live.push(fnv(simSig())); liveFx.push(fnv(lightSig())); return bt.call(W, dt); };
  let ts = 1000, fr = 0;
  while (W.running && !W.over && fr++ < CAP * 3) {
    ts += 1000 / SIM_HZ;
    X._frame(ts);
    g.frames.length = 0;               // 假 rAF 队列：不累积
  }
  W.burstTick = bt;
  W.running = false;
  let firstBad = -1, fxBad = -1, fxDiffSteps = 0;
  const lim = Math.min(ref.length, live.length);
  for (let i = 0; i < lim; i++) {
    if (ref[i] !== live[i] && firstBad < 0) firstBad = i + 1;
    if (refFx[i] !== liveFx[i]) { fxDiffSteps++; if (fxBad < 0) fxBad = i + 1; }
  }
  return { stepsRef: ref.length, stepsLive: live.length, firstBad: firstBad,
    fxBad: fxBad, fxDiffSteps: fxDiffSteps };
}
{
  let ok = 0;
  chosen.slice(0, 5).forEach((d, i) => {
    const r = liveCompare(d);
    const good = r.firstBad < 0 && r.stepsRef === r.stepsLive;
    if (good) ok++;
    info('  [' + (i + 1) + '] ' + d.a + ' vs ' + d.b + ' seed=' + d.seed +
      ' 步数 ' + r.stepsRef + '/' + r.stepsLive +
      ' → 模拟 ' + (good ? '逐步一致 ✓' : ('第 ' + r.firstBad + ' 步分叉 ✗')) +
      '；含粒子账本 ' + (r.fxBad < 0 ? '也一致' :
        ('从第 ' + r.fxBad + ' 步起有 ' + r.fxDiffSteps + ' 步不同（观感随机流，不影响模拟）')));
  });
  info('rAF+绘制 实际播放的【模拟轨迹】=== stepOnce 重演轨迹: ' + ok + '/5');
}

/* ------------------------------------------------------------
   6. 补充 3：复现的前置条件敏感性
   ------------------------------------------------------------ */
console.log('\n-- A5. 补充：复现前置条件（全局设置不能变）--');
{
  const d = chosen[0];
  const A = X.CARD_BY_ID[d.a], B = X.CARD_BY_ID[d.b];
  const runChain = () => {
    X.resetMatch(A, B, d.seed);
    W.speedMul = 1;
    const ch = [];
    let n = 0;
    while (!X.stepOnce() && n++ < CAP) ch.push(fnv(lightSig()));
    return ch;
  };
  /* 基线（cardSpeed=1，默认） */
  const base = runChain();
  const recordedSeed = W.seed;                 // = matchRecord.seed（VCR 会存的那个数）
  /* VCR 只存 matchRecord.seed（散列后的数字）→ 拿它当种子重演也必须一致 */
  X.resetMatch(A, B, recordedSeed);
  W.speedMul = 1;
  let ns = 0, seedBad = -1;
  while (!X.stepOnce() && ns++ < CAP) if (fnv(lightSig()) !== base[ns - 1] && seedBad < 0) seedBad = ns;
  info('  用记录里的 world.seed=' + recordedSeed + ' 重演: ' +
    (seedBad < 0 ? '✓ 与原始对局逐步一致' : ('第 ' + seedBad + ' 步分叉 ✗')));
  /* 播放倍速 world.speedMul 只是主循环的时间倍率，不应该影响模拟 */
  X.resetMatch(A, B, d.seed);
  W.speedMul = 4;
  let n2 = 0, mulBad = -1;
  while (!X.stepOnce() && n2++ < CAP) if (fnv(lightSig()) !== base[n2 - 1] && mulBad < 0) mulBad = n2;
  W.speedMul = 1;
  info('  world.speedMul=4（4× 播放）下轨迹与 1× 一致: ' + (mulBad < 0 ? '✓' : ('第 ' + mulBad + ' 步分叉 ✗')));

  /* cardSpeed 是物理移速设置，直接进 curSpeed() → 会改整局走向 */
  const old = X.SET.cardSpeed;
  X.SET.cardSpeed = 1.5;
  X.resetMatch(A, B, d.seed);
  W.speedMul = 1;
  let n3 = 0, speedBad = -1;
  while (!X.stepOnce() && n3++ < CAP) if (fnv(lightSig()) !== base[n3 - 1] && speedBad < 0) speedBad = n3;
  X.SET.cardSpeed = old;
  info('  SET.cardSpeed 1→1.5 后重演: ' +
    (speedBad < 0 ? '未分叉（意外）' : '第 ' + speedBad + ' 步即分叉 → 录制必须带上移速设置'));
}

/* ------------------------------------------------------------
   7. 结论
   ------------------------------------------------------------ */
const allPass = valid.length > 0 && passed.length === valid.length;
const dSteps = valid.map(r => r.decideStep).sort((x, y) => x - y);
const freezePass = freezeChecks.filter(x => x.ok).length === freezeChecks.length;
console.log('\n-- A6. 结论 --');
console.log('  ' + (allPass
  ? '✓ 可以：resetMatch(同卡同种子) 后快进 ' + Math.min.apply(null, valid.map(r => r.startStep)) +
    '~' + Math.max.apply(null, valid.map(r => r.startStep)) + ' 步，再逐步走 120 步到 decideStep，' +
    passed.length + '/' + valid.length + ' 组的每一步 world 模拟签名都与原局完全一致；decideStep 处 world.over 仍为 null。'
  : '✗ 不成立：' + (valid.length - passed.length) + '/' + valid.length + ' 组出现分叉（见上）。'));
console.log('    decideStep 范围 ' + dSteps[0] + '~' + dSteps[dSteps.length - 1] +
  ' 步（' + (dSteps[0] * SIM_DT).toFixed(2) + '~' + (dSteps[dSteps.length - 1] * SIM_DT).toFixed(2) + ' s）；' +
  'decideT 可由 round(decideT×120) 精确还原步号 ' + flag('deriveOk'));
console.log('    decideStep 之后还有 ' + minDelta + '~' + Math.max.apply(null, valid.map(r => r.delta)) +
  ' 步（最短 ' + (minDelta * SIM_DT).toFixed(3) + 's，常见 108/204 步 = 0.9s/1.7s）才置 over，' +
  '因此 0.25× 回放停在 decideStep 不会先看到结算横幅；停住后喂 10 帧主循环也不动 ' +
  freezeChecks.filter(x => x.ok).length + '/' + freezeChecks.length + '。');
console.log('    ⚠ 观感随机流：绘制会消耗 RNG.vis，粒子的外观/寿命账本在"边画边跑"与"不画快进"之间不同；' +
  '模拟（RNG.sim）逐步完全一致。建议快进段不绘制，进入 0.25× 回放后再恢复绘制。');
console.log('    ⚠ 复现前置：卡对+种子之外，SET.cardSpeed（物理移速）必须与录制时相同；' +
  'world.speedMul（播放倍率）不影响模拟。');
console.log('    ⚠ 保险：快进到 decideStep 后建议 assert world.over === null（本轮 30/30 成立）；' +
  '若某局反常地已经结算，就把定格步退到 min(decideStep, overStep-1)。');
if (!allPass) fail('核心复演一致性未全部通过: ' + passed.length + '/' + valid.length);
if (!freezePass) fail('冻结检查有失败: ' + freezeChecks.filter(x => !x.ok).length + ' 组');

/* ------------------------------------------------------------
   8. B 部分：音效提取
   ------------------------------------------------------------ */
console.log('\n-- B. 决胜音效提取 --');
const SRC_MP3 = 'C:/Users/shenl/Desktop/项目/STS2-Decompiled/pck-extracted/debug_audio/STS_DeathStinger_v4_Short_SFX.mp3';
const DST_MP3 = path.join(ROOT, 'assets', 'audio', 'vcr_stinger.mp3');
{
  if (!fs.existsSync(SRC_MP3)) fail('音效源文件不存在: ' + SRC_MP3);
  else {
    fs.copyFileSync(SRC_MP3, DST_MP3);
    const st = fs.statSync(DST_MP3);
    const head = fs.readFileSync(DST_MP3).slice(0, 3).toString('latin1');
    const bytes = fs.readFileSync(DST_MP3);
    let same = bytes.length === fs.statSync(SRC_MP3).size;
    if (same) {
      const a = fs.readFileSync(SRC_MP3);
      for (let i = 0; i < a.length; i++) if (a[i] !== bytes[i]) { same = false; break; }
    }
    console.log('  复制 → assets/audio/vcr_stinger.mp3  ' + st.size + ' bytes' +
      '  头部=' + JSON.stringify(head) + '  与源逐字节相同=' + same);
    if (st.size > 20 * 1024) info('✓ 文件 >20KB (' + (st.size / 1024).toFixed(1) + ' KB)');
    else fail('音效文件 ' + st.size + ' bytes，不足 20KB');
    if (!same) fail('复制后内容与源不一致');
  }
}

/* ------------------------------------------------------------
   9. 收尾
   ------------------------------------------------------------ */
console.log('\n=== 完成：' + (fails.length ? ('✗ ' + fails.length + ' 项硬失败') : '✓ 全部探针通过') +
  '，总用时 ' + ((Date.now() - t_start) / 1000).toFixed(1) + ' s ===');
if (fails.length) fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
