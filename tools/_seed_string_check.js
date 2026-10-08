/* 探针：预演记录的"点行重现"与"把这条种子抄进种子框播放"必须是同一局。
   根因（2026-09-24 修复前）：记录里存的是散列后的 32 位【数字】种子；
   抄进种子框后按【数字字符串】传给 setSimSeed → 旧 seedHash 对字符串一律走
   FNV → 同一个 "123456789" 当数字与当字符串散列出两个不同种子 → 两局完全不同。
   修法：seedHash 把纯数字串（可带负号）与数字走同一条路（直接取整）。
   假 DOM 复用 verify_dev.js 的方案（fakeEl / fakeCtx / loadGame 思路一致）。 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
function gameSource(withExports) {
  const raw = fs.readFileSync(path.join(ROOT, 'src', 'game.html'), 'utf8');
  const blocks = raw.match(/<script>[\s\S]*?<\/script>/g) || [];
  const main = blocks.filter(b => b.indexOf('__ASSET_MAP__') >= 0);
  if (main.length !== 1) throw new Error('主脚本块数量异常: ' + main.length);
  let src = main[0].replace(/^<script>/, '').replace(/<\/script>$/, '')
    .replace("'__BUILD_TAG__'", "'main'")
    .replace('__ASSET_MAP__', '{"img":{},"snd":{}}');
  if (withExports) {
    src += '\n;window.__X = { CARD_BY_ID, resetMatch, runFullMatch, matchRecord, seedHash, setSimSeed };\n';
  }
  return src;
}
function fakeCtx() {
  const c = {
    canvas: { width: 660, height: 660 },
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high', filter: ''
  };
  const noop = () => { };
  ['save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'clearRect', 'fillRect',
    'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect', 'fill',
    'stroke', 'clip', 'drawImage', 'ellipse', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo'
  ].forEach(k => { c[k] = noop; });
  c.createLinearGradient = () => ({ addColorStop() { } });
  c.createRadialGradient = () => ({ addColorStop() { } });
  c.measureText = () => ({ width: 10 });
  return c;
}
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
function loadGame() {
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
  const cvEl = fakeEl('canvas');
  let cvCtx = null;
  cvEl.getContext = function () { if (!cvCtx) cvCtx = fakeCtx(); return cvCtx; };
  els.cv = cvEl;
  els.panelL = fakeEl('aside'); els.panelR = fakeEl('aside');
  const sandbox = {
    window: {}, document: doc, console,
    performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
    requestAnimationFrame() { return 0; },
    setTimeout, clearTimeout, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Set, Map,
    Image: function () { return fakeEl('img'); },
    webkitAudioContext: undefined,
    Blob: function () { this.size = 0; }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    Path2D: function () { return { moveTo() { }, lineTo() { }, arcTo() { }, closePath() { }, rect() { }, arc() { } }; },
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
  vm.runInContext(gameSource(true), sandbox, { filename: 'game.html' });
  return sandbox;
}

const X = loadGame().__X;

let fail = 0;
function ok(cond, msg, extra) {
  console.log((cond ? '  OK   ' : '  FAIL ') + msg + (cond ? '' : '  → ' + extra));
  if (!cond) fail++;
}

/* --- 1. seedHash 口径 --- */
ok(X.seedHash('123456789') === 123456789, '数字字符串按数字取整（不再 FNV）', X.seedHash('123456789'));
ok(X.seedHash(123456789) === 123456789, '数字照旧直接取整', X.seedHash(123456789));
ok(X.seedHash('  42 ') === 42, '数字串带空白也认', X.seedHash('  42 '));
ok(X.seedHash('-5') === (Math.floor(-5) >>> 0), '负号数字串与数字路径一致', X.seedHash('-5'));
ok(X.seedHash('abc') === X.seedHash('abc'), '文本种子仍走 FNV（自洽）');
ok(X.seedHash('abc') !== 0, 'FNV 结果仍非 0');
ok(X.seedHash('abc#3') === X.seedHash('abc#3'), '批量派生串（abc#3）不受影响');
/* 派生路径自洽：批量预演用 seedHash(+base+done)，抄回去的字符串应得同一个数 */
ok(X.seedHash(String(X.seedHash(7000000 + 3))) === X.seedHash(7000000 + 3),
  '记录种子（数字）↔ 抄回的字符串 同一条种子', X.seedHash(String(X.seedHash(7000003))) + ' vs ' + X.seedHash(7000003));

/* --- 2. 全链路：批量那局 vs 抄种子重跑那局，逐字段一致 --- */
const pairs = [['dark_embrace', 'defy'], ['meteor_strike', 'offering'], ['tracking', 'voltaic']];
const seeds = [1, 7000003, 4294967295, '900001'];
for (const [a, b] of pairs) {
  for (const s0 of seeds) {
    /* 批量预演口径：数字种子跑一局，记录 r.seed = world.seed（散列后数字） */
    X.runFullMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], s0);
    const rec = X.matchRecord(s0);
    /* 路径 A（点记录行）：传记录里的数字种子 */
    X.runFullMatch(X.CARD_BY_ID[rec.a], X.CARD_BY_ID[rec.b], rec.seed);
    const byNum = X.matchRecord(rec.seed);
    /* 路径 B（抄进种子框）：把记录里的数字转成字符串再传 */
    X.runFullMatch(X.CARD_BY_ID[rec.a], X.CARD_BY_ID[rec.b], String(rec.seed));
    const byStr = X.matchRecord(String(rec.seed));
    const same = (r1, r2) => r1.win === r2.win && r1.t === r2.t &&
      r1.hp[0] === r2.hp[0] && r1.hp[1] === r2.hp[1] &&
      r1.dealt[0] === r2.dealt[0] && r1.dealt[1] === r2.dealt[1];
    ok(rec.seed === byNum.seed && same(rec, byNum), `${a} vs ${b} seed=${s0} 点行重现 = 原局`, `t ${rec.t} vs ${byNum.t}`);
    ok(byNum.seed === byStr.seed && same(byNum, byStr), `${a} vs ${b} seed=${s0} 抄种子播放 = 点行重现`, `t ${byNum.t} vs ${byStr.t}`);
  }
}

console.log(fail ? `✗ ${fail} 项失败` : '✓ 全部通过');
process.exit(fail ? 1 : 0);
