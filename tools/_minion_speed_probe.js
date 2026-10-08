/* ⚠ 已作废（2026-09-23 晚）：冲锋仆从 AI 已被"完全重构"——整个状态机（idle/seek/ram/rest）、
 *   mSpd 定速冲撞、ghostOn 冲撞穿透全部删除，仆从现在只是"普通单位 + 索敌范围内加一发冲撞速度"。
 *   本探针读的 mSpd / state==='ram' / mech.ghostOn 都已不存在 → 报表必然失去意义。
 *   新 AI 的验收请用 tools/_minion_ai_check.js。
 *
 * 定向验证（2026-09-23）：冲锋仆从的两处手感改动
 *
 *  1) 冲撞命中瞬间的【真实速度】—— 用户反馈"撞得太快"，参数 mSpd 430 → 360。
 *     引擎的 ram 状态直接以 baseSpeed = mSpd 推进，所以命中速度应 ≈ 参数值；
 *     这里实测命中那一帧的 curSpeed()，确认改动真的落到"撞上去那一下"。
 *  2) 冲撞（ram）期间与【友方】（自家本体 / 同伴仆从）接触是否真的穿透
 *     （MinionBrain.ghostOn 现在 ram 期间对友方一律返回 true）。
 *     判据：穿透 → 两球中心距会继续缩小到明显小于 mR+对手半径（比值 < 1）；
 *           实心 → 距离被顶回 ≈ 半径和（比值 ≈ 1）。
 *  3) 反向对照：非 ram 期间的友方接触必须仍然实心（比值 ≈ 1，ghostOn 为 false）。
 *
 * 用法：node tools/_minion_speed_probe.js [html路径] [对局] [秒数]
 *   对局形如 charge:charge，默认跑一组内战/对局各 60 秒。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const PAIRS = (process.argv[3] || 'charge:charge,charge:end_of_days,charge:voltaic,charge:darkness')
  .split(',').map(s => s.split(':'));
const SECS = Number(process.argv[4] || 60);

const html = fs.readFileSync(HTML, 'utf8');
const _blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = _blocks.sort((a, b) => b.length - a.length)[0];
if (!src) { console.error('找不到 script'); process.exit(1); }
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, MinionBrain };\n`;

function stubEl() {
  const el = {
    style: {}, dataset: {}, children: [], disabled: false, textContent: '', title: '',
    clientWidth: 700, clientHeight: 700, innerHTML: '',
    classList: { add() { }, remove() { }, toggle() { } },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { width: 700, height: 700, top: 0, left: 0 }; },
    setAttribute() { }, getAttribute() { return null; },
    getContext() { return ctx2d(); }, closest() { return null; }, parentElement: null,
  };
  el.parentElement = el; el.parentElement.clientWidth = 700;
  return el;
}
const grad = () => ({ addColorStop() { } });
function ctx2d() {
  const t = { createLinearGradient: grad, createRadialGradient: grad, createPattern: () => null, measureText: () => ({ width: 10 }) };
  return new Proxy(t, { get(o, k) { return (k in o) ? o[k] : () => { }; }, set(o, k, v) { o[k] = v; return true; }, has() { return true; } });
}
class Path2DStub { moveTo() { } lineTo() { } arcTo() { } closePath() { } rect() { } arc() { } }
class ImageStub { constructor() { this.naturalWidth = 300; this.naturalHeight = 423; } }
/* mulberry32 必须返回 [0,1)：曾因少一层括号返回 [-0.5,0.5) 把整张平衡表跑废 */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
}
const _selfT = mulberry32(12345);
{ const v = []; for (let i = 0; i < 1000; i++) v.push(_selfT());
  if (Math.min(...v) < 0 || Math.max(...v) >= 1) throw new Error('mulberry32 自检失败：值域不在 [0,1)'); }

const seededMath = Object.create(Math);
seededMath.random = mulberry32(20260922);
const els = {};
const sandbox = {
  document: {
    getElementById(id) { return els[id] || (els[id] = stubEl()); },
    createElement() { return stubEl(); },
    createTextNode(t) { return { nodeValue: t, textContent: t }; },
    addEventListener() { }, removeEventListener() { }, querySelector() { return null; },
  },
  window: { addEventListener() { }, devicePixelRatio: 1, innerHeight: 900, innerWidth: 1400 },
  Image: ImageStub, Path2D: Path2DStub,
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => { },
  atob: (s) => Buffer.from(s, 'base64').toString('base64'),
  setTimeout, clearTimeout, console, Math: seededMath, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });

const T = sandbox.__T, W = T.world, CFG = T.CFG;
const DT = 1 / 60;
const byId = (id) => T.CARD_BY_ID[id];
const rOf = (u) => (u.minion && u.p && u.p.mR) ? u.p.mR : CFG.R;

let FRAME = 0;
const idMap = new WeakMap(); let idSeq = 0;
const idOf = (u) => { let v = idMap.get(u); if (!v) idMap.set(u, v = 'U' + (++idSeq)); return v; };

const hits = [];              // 撞击（命中敌方本体）瞬间的速度
const segs = [];              // 友方接触段
const active = new Map();     // key -> seg
/* 逐帧（= 逐次 onUnitHit 调用）统计 ghostOn 的判定 —— 比"段"精确：
   段会跨状态（先 idle 贴着、随后转 ram），按段归类会把口径弄脏。 */
let ramContact = 0, ramGhost = 0, nonRamContact = 0, nonRamGhost = 0;

const origUpdate = T.MinionBrain.prototype.update;
const origHit = T.MinionBrain.prototype.onUnitHit;

T.MinionBrain.prototype.onUnitHit = function (e) {
  const m = this.m;
  const wasRam = m.state === 'ram';
  /* ---- 撞击速度：必须在 origHit 之前取（命中后 state 立刻被改成 rest）---- */
  let shot = null;
  if (wasRam && e && !e.minion && e.team !== m.team) {
    shot = { f: FRAME, spd: m.curSpeed(), base: m.baseSpeed, boost: m.boost,
             mSpd: (m.p && m.p.mSpd) || null };
  }
  /* ---- 友方接触：逐帧记 ghostOn 的判定（也必须在 origHit 之前，状态未被改写）---- */
  if (e && e.team === m.team && e.alive && m.alive) {
    const g = !!this.ghostOn(e);
    if (wasRam) { ramContact++; if (g) ramGhost++; } else { nonRamContact++; if (g) nonRamGhost++; }
    const key = idOf(m) + '>' + idOf(e);
    let seg = active.get(key);
    if (!seg) {
      seg = { key, isMinion: !!e.minion, ramFrames: 0, nonRamFrames: 0, t0: FRAME, last: FRAME,
              minRatio: 1, minion: m, other: e };
      active.set(key, seg); segs.push(seg);
    }
    seg.last = FRAME;
    if (wasRam) seg.ramFrames++; else seg.nonRamFrames++;
  }
  const r = origHit.call(this, e);
  if (shot) hits.push(shot);
  return r;
};
T.MinionBrain.prototype.update = origUpdate;

/* 每帧采样：友方接触段在 20 帧内的最小中心距 / 半径和 */
function tickSampling() {
  for (const seg of active.values()) {
    const a = seg.minion, b = seg.other;
    if (!a.alive || !b.alive) { seg.done = true; continue; }
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const minD = rOf(a) + rOf(b);
    if (minD > 0) seg.minRatio = Math.min(seg.minRatio, d / minD);
    if (FRAME - seg.last > 3 || FRAME - seg.t0 > 20) seg.done = true;
  }
  for (const [k, seg] of active) if (seg.done) active.delete(k);
}

const med = (arr) => { if (!arr.length) return NaN; const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const avg = (arr) => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : NaN;

for (const [A, B] of PAIRS) {
  T.resetMatch(byId(A), byId(B));
  W.running = true;
  const frames = Math.round(SECS / DT);
  for (let f = 0; f < frames; f++) {
    FRAME = f;
    W.t += DT;
    T.stepPhysics(DT);
    tickSampling();
    if (W.over) break;
  }
}

const p = byId('charge').p;
console.log(`\n===== 冲锋仆从 · 速度与穿透 定向验证 =====`);
console.log(`对局：${PAIRS.map(x => x.join(':')).join('  ')}   每局 ${SECS}s`);
console.log(`当前参数：mSpd=${p.mSpd}  bounce=${p.bounce}/${p.bounceCap}  seekSpd=${p.seekSpd}  leashSpd=${p.leashSpd}`);

console.log(`\n--- 一、冲撞命中敌方本体瞬间的速度 ---`);
console.log(`  命中次数 ${hits.length}`);
if (hits.length) {
  console.log(`  实测速度 curSpeed()  平均 ${avg(hits.map(h => h.spd)).toFixed(1)} px/s` +
    `   区间 ${Math.min(...hits.map(h => h.spd)).toFixed(0)} ~ ${Math.max(...hits.map(h => h.spd)).toFixed(0)}`);
  console.log(`  其中 baseSpeed 平均 ${avg(hits.map(h => h.base)).toFixed(1)}   boost 平均 ${avg(hits.map(h => h.boost)).toFixed(1)}`);
  console.log(`  卡片参数 mSpd = ${p.mSpd}   ← 命中速度应当落在它附近（未叠加冲量时几乎相等）`);
}

console.log(`\n--- 二、冲撞(ram)期间的友方接触：应当【全部穿透】---`);
console.log(`  逐帧接触 ${ramContact} 次   其中 ghostOn=true 的 ${ramGhost} 次` +
  (ramContact ? `（${(ramGhost / ramContact * 100).toFixed(1)}%）` : ''));
console.log(`  ↑ 期望 100%：ram 期间对友方一律穿透（自家本体 / 同伴仆从都不挡道）`);
const ramSegs = segs.filter(s => s.ramFrames > 0);
if (ramSegs.length) {
  console.log(`  接触段 ${ramSegs.length} 段，段内最小中心距 / 半径和  中位数 ${med(ramSegs.map(s => s.minRatio)).toFixed(2)}` +
    `  ← <1 说明真的穿进去了（实心会被顶在 ≈1）`);
  console.log(`  分布： <0.5 的 ${ramSegs.filter(s => s.minRatio < 0.5).length}` +
    ` 段   0.5~0.9 的 ${ramSegs.filter(s => s.minRatio >= 0.5 && s.minRatio < 0.9).length} 段` +
    `   ≥0.9 的 ${ramSegs.filter(s => s.minRatio >= 0.9).length} 段`);
}

console.log(`\n--- 三、对照：非 ram 期间的友方接触：应当【仍然实心】---`);
console.log(`  逐帧接触 ${nonRamContact} 次   其中 ghostOn=true 的 ${nonRamGhost} 次   ← 应为 0`);
const restSegs = segs.filter(s => s.ramFrames === 0);
if (restSegs.length) {
  console.log(`  接触段 ${restSegs.length} 段，段内最小中心距 / 半径和  中位数 ${med(restSegs.map(s => s.minRatio)).toFixed(2)}   ← 应 ≈ 1（被顶开）`);
}
console.log('');
