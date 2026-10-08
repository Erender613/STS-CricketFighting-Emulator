/* 仆从"到底打出了多少伤害"——重构前后直接对量（与具体 AI 实现无关）。
 *
 * 只挂钩 MinionBrain.prototype.onUnitHit，统计"敌方单位实际掉的血"，
 * 所以对【新旧两份产物都能跑】：老 AI 走 state==='ram'+hitCd，新 AI 走 this.ram。
 *
 * 用法：node tools/_minion_dmg_cmp.js [html路径] [秒数]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮小球对决.html');
const SECS = Number(process.argv[3] || 120);
const OPPONENTS = ['end_of_days', 'darkness', 'lightning_rod', 'defy', 'snakebite', 'pillage'];

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
const T = sandbox.__T, W = T.world, CFG = T.CFG;
const DT = 1 / 60;
const byId = (id) => T.CARD_BY_ID[id];

/* 只在"这次伤害来自仆从"时计数 */
let dmg = 0, hits = 0;
const origHit = T.MinionBrain.prototype.onUnitHit;
T.MinionBrain.prototype.onUnitHit = function (e) {
  const before = (e && typeof e.hp === 'number') ? e.hp : null;
  origHit.call(this, e);
  if (e && before !== null && e.hp < before && e.team !== this.m.team) {
    dmg += before - e.hp; hits++;
  }
};

console.log(`产物：${path.basename(HTML)}   每对 ${SECS}s×6\n`);
const pad = (s, n) => String(s).padEnd(n, ' ');
const rp = (s, n) => String(s).padStart(n, ' ');
console.log(pad('对手', 16) + rp('仆从伤害', 10) + rp('命中', 7) + rp('仆从存活', 10) +
  rp('对局时长', 10) + rp('本体承伤', 10));
console.log('-'.repeat(64));
let totD = 0, totT = 0, totS = 0, totTaken = 0;
for (const opp of OPPONENTS) {
  dmg = 0; hits = 0;
  T.resetMatch(byId('charge'), byId(opp));
  W.running = true;
  const frames = Math.round(SECS / DT);
  let alive = 0, elapsed = 0;
  for (let f = 0; f < frames; f++) {
    W.t += DT; T.stepPhysics(DT); elapsed += DT;
    alive += W.units.filter(u => u.minion && u.alive && !u.dying).length;
    if (!W.units.some(u => u.alive && !u.minion && !u.dying)) break;
  }
  const owner = W.units[0];                      // units[0] 恒为冲锋本体
  const taken = owner.stat ? owner.stat.taken : 0;
  totD += dmg; totT += elapsed; totS += alive * DT; totTaken += taken;
  console.log(pad(opp, 16) + rp(dmg.toFixed(0), 10) + rp(hits, 7) + rp((alive * DT).toFixed(0) + 's', 10) +
    rp(elapsed.toFixed(0) + 's', 10) + rp(taken.toFixed(0), 10));
}
console.log('-'.repeat(64));
console.log(pad('合计/均值', 16) + rp(totD.toFixed(0), 10) + rp('', 7) + rp(totS.toFixed(0) + 's', 10) +
  rp((totT / OPPONENTS.length).toFixed(0) + 's', 10) + rp((totTaken / OPPONENTS.length).toFixed(0), 10));
console.log(`\n仆从总伤害 ${totD.toFixed(0)} 点 / 总对局时长 ${totT.toFixed(0)}s ` +
  `→ ${(totD / (totT / 60)).toFixed(0)} 点/分钟（按对局分钟）`);
console.log(`仆从单位时间输出 ${(totD / totS).toFixed(1)} 点/仆从每秒（存活 ${totS.toFixed(0)} 仆从·秒）`);
console.log(`本体平均每局承受伤害 ${(totTaken / OPPONENTS.length).toFixed(0)} 点（本体总血 1000）`);
