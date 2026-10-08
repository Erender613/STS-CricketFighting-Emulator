/* 追踪单只仆从的完整时间线，看清"反复对着敌人进退"到底长什么样。
 *
 * 用法：node tools/_minion_trace_probe.js [html路径] [对局] [追踪秒数]
 *   对局形如 charge:voltaic（默认 charge:charge）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const PAIR = (process.argv[3] || 'charge:charge').split(':');
const SECS = Number(process.argv[4] || 40);

const html = fs.readFileSync(HTML, 'utf8');
let src =(()=>{const b=(String(html).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})();
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
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
}
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
const T = sandbox.__T, W = T.world;
const DT = 1 / 60;
const byId = (id) => T.CARD_BY_ID[id];

/* 挂钩：本帧碰撞调用 + 撞谁 */
const calls = [];
let FRAME = 0;
const origHit = T.MinionBrain.prototype.onUnitHit;
T.MinionBrain.prototype.onUnitHit = function (e) {
  const hp0 = e ? e.hp : 0;
  const snap = { m: this.m, f: FRAME, state: this.m.state, hitCd: this.hitCd, eIsMinion: !!(e && e.minion), dmg: 0 };
  origHit.call(this, e);
  snap.dmg = hp0 - (e ? e.hp : 0);
  calls.push(snap);
};
/* 本体撞人 → 命令仆从冲撞（orderRam）：这条也会强行改写方向 */
const orderCalls = [];
const origOrder = T.MinionBrain.prototype.orderRam;
T.MinionBrain.prototype.orderRam = function (t) {
  orderCalls.push({ m: this.m, f: FRAME, leashing: this.leashing });
  return origOrder.call(this, t);
};

T.resetMatch(byId(PAIR[0]), byId(PAIR[1]));
W.running = true;

const frames = Math.round(SECS / DT);
const trace = [];      // 每帧所有仆从的快照
for (let f = 0; f < frames; f++) {
  FRAME = f;
  calls.length = 0; orderCalls.length = 0;
  W.t += DT;
  T.stepPhysics(DT);
  for (const m of W.units.filter(u => u.minion)) {
    let foe = null, fd = Infinity;
    for (const u of W.units) {
      if (u.team === m.team || u.minion || !u.alive || u.dying) continue;
      const d = Math.hypot(u.x - m.x, u.y - m.y);
      if (d < fd) { fd = d; foe = u; }
    }
    const c = calls.filter(x => x.m === m);
    trace.push({
      f, id: m.__id || (m.__id = 'M' + Math.random().toFixed(4)),
      x: m.x, y: m.y, dx: m.dx, dy: m.dy, foe,
      fx: foe ? foe.x : 0, fy: foe ? foe.y : 0,
      st: m.state, hitCd: m.mech ? m.mech.hitCd : 0, spd: m.curSpeed(),
      boost: m.boost, fd, own: Math.hypot(m.o.x - m.x, m.o.y - m.y),
      leashing: !!(m.mech && m.mech.leashing),
      dmg: c.reduce((s, x) => s + x.dmg, 0),
      hitMinion: c.some(x => x.eIsMinion),
      hitBody: c.some(x => !x.eIsMinion),
      stateAtHit: c.length ? c[0].state : null,
      cdAtHit: c.length ? c[0].hitCd : null,
      ordered: orderCalls.some(x => x.m === m),
    });
  }
  if (!W.units.some(u => u.alive && !u.minion && !u.dying)) break;
}

/* 按仆从分组，找"贴近事件"（与敌人距离的局部极小，且 < 140px） */
console.log(`CFG.R=${T.CFG.R}  对局 ${PAIR.join(' vs ')}  共 ${trace.length} 帧快照`);
const byId2 = {};
for (const r of trace) (byId2[r.id] = byId2[r.id] || []).push(r);
for (const [mid, rows] of Object.entries(byId2)) {
  const close = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const r = rows[i];
    if (r.fd < 140 && r.fd <= rows[i - 1].fd && r.fd <= rows[i + 1].fd) close.push(r);
  }
  if (close.length < 2) continue;
  console.log(`\n===== 仆从 ${mid}：${close.length} 次贴近，${rows[0].f}~${rows[rows.length - 1].f} 帧 =====`);
  for (let k = 0; k < close.length; k++) {
    const r = close[k];
    const gap = k ? ((r.f - close[k - 1].f) * DT).toFixed(2) + 's' : '-';
    /* 这次贴近前后 0.25s 内有没有打出伤害 */
    const win = rows.filter(x => Math.abs(x.f - r.f) <= 15);
    const dmg = win.reduce((s, x) => s + x.dmg, 0);
    const touched = r.hitBody ? '本体' : (r.hitMinion ? '仆从' : '无');
    console.log(`  #${k} 帧${String(r.f).padStart(5)} 距敌${r.fd.toFixed(0).padStart(4)}px ` +
      `state=${r.st.padEnd(5)} hitCd=${r.hitCd.toFixed(2)} 速度=${r.spd.toFixed(0).padStart(3)} ` +
      `boost=${r.boost.toFixed(0).padStart(3)} 距本体=${r.own.toFixed(0).padStart(4)} ` +
      `拴绳=${r.leashing ? 'Y' : 'n'}${r.ordered ? ' 被下令' : ''} | 接触=${touched} ` +
      `(撞时state=${r.stateAtHit || '-'},cd=${r.cdAtHit === null || r.cdAtHit === undefined ? '-' : r.cdAtHit.toFixed(2)}) ` +
      `| 距上次 ${gap.padStart(6)} | 伤害 ${dmg}`);
  }
}

/* 全局归因：所有"贴近但没打出伤害"的事件，到底卡在哪一关 */
{
  const g = { 有伤害: 0, 撞仆从: 0, 撞本体非ram: 0, 撞本体冷却中: 0, 未接触: 0 };
  for (const r of trace) {
    if (r.fd > 100) continue;                     // 只在"快贴上"的帧里统计
    if (r.dmg > 0) { g.有伤害++; continue; }
    if (r.hitMinion) g.撞仆从++;
    else if (r.hitBody && r.stateAtHit !== 'ram') g.撞本体非ram++;
    else if (r.hitBody && r.cdAtHit > 0) g.撞本体冷却中++;
    else if (!r.hitBody && !r.hitMinion) g.未接触++;
  }
  console.log('\n===== 贴近帧（≤100px）归因 =====');
  for (const [k, v] of Object.entries(g)) console.log(`  ${k.padEnd(12)} ${v}`);
}

/* 抓一次"白弹"（rest 期间贴上本体、被弹开却零伤害），逐帧看几何 */
{
  const bad = trace.find(r => r.hitBody && r.dmg === 0 && r.fd <= 100 && r.st !== 'ram');
  if (bad) {
    const rows = byId2[bad.id].filter(r => r.f >= bad.f - 30 && r.f <= bad.f + 25);
    console.log(`\n===== 白弹现场：${bad.id} 帧 ${bad.f} 前后逐帧 =====`);
    console.log('   帧  state  hitCd   speed  boost   仆从(x,y)            敌人(x,y)         距敌  距本体  接触  方向角');
    for (const r of rows) {
      const ang = (Math.atan2(r.dy, r.dx) * 180 / Math.PI).toFixed(0);
      const touch = r.hitBody ? '本体' : (r.hitMinion ? '仆从' : '');
      console.log(`${String(r.f).padStart(5)} ${r.st.padEnd(5)} ${r.hitCd.toFixed(2).padStart(6)} ` +
        `${r.spd.toFixed(0).padStart(6)} ${r.boost.toFixed(0).padStart(6)}  ` +
        `(${r.x.toFixed(0).padStart(3)},${r.y.toFixed(0).padStart(3)})`.padEnd(22) +
        `(${r.fx.toFixed(0).padStart(3)},${r.fy.toFixed(0).padStart(3)})`.padEnd(19) +
        `${r.fd.toFixed(0).padStart(5)} ${r.own.toFixed(0).padStart(6)}  ${touch.padEnd(4)} ${ang.padStart(5)}`);
    }
  } else {
    console.log('\n（本次对局没抓到"白弹"事件）');
  }
}
