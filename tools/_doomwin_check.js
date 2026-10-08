/* 临时探针：复现「蛇咬 vs 末日降临」种子 1587360793 的灾厄直击斩杀 / 毒杀结算顺序。
   用真实 120Hz 步进 stepOnce（不是 simcheck 的 60Hz），逐帧记录双方进入 dying 的时刻、
   死亡动画时长、endCheck 看到的状态，以及最终 world.over.win。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MathSeeded = Object.create(Math);
MathSeeded.random = mulberry32(20260921);

const HTML = process.env.GAME_HTML
  ? path.resolve(process.env.GAME_HTML)
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
const _blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = _blocks.sort((a, b) => b.length - a.length)[0];
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, resetMatch, stepOnce, stepPhysics, SIM_DT, DOOM_CHANNEL, finalizeMatch };\n`;

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
  el.parentElement = el; el.parentElement.clientWidth = 700; return el;
}
const grad = () => ({ addColorStop() { } });
function ctx2d() {
  const target = { createLinearGradient: grad, createRadialGradient: grad, createPattern: () => null, measureText: () => ({ width: 10 }) };
  return new Proxy(target, { get(t, k) { return (k in t) ? t[k] : () => { }; }, set(t, k, v) { t[k] = v; return true; }, has() { return true; } });
}
class Path2DStub { moveTo() { } lineTo() { } arcTo() { } closePath() { } rect() { } arc() { } }
class ImageStub { constructor() { this.naturalWidth = 300; this.naturalHeight = 423; } }
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
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  setTimeout, clearTimeout, console, Math: MathSeeded, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T;
const w = T.world;

const A = T.CARD_BY_ID['snakebite'];      // units[0] 左
const B = T.CARD_BY_ID['end_of_days'];    // units[1] 右
T.resetMatch(A, B, 1587360793);
console.log('seed =', w.seed, '| units =', w.units.map(u => u.card.name).join(' vs '));

const names = ['蛇咬', '末日降临'];
const dyingAt = [null, null];
const finishAt = [null, null];
const events = [];
let prevDying = [null, null];
let prevAlive = [true, true];
const cap = 240 * 120 + 200;
for (let i = 0; i < cap; i++) {
  if (T.stepOnce()) break;
  for (let k = 0; k < 2; k++) {
    const u = w.units[k];
    const dk = u.dying ? (u.dying.doom ? 'doom' : 'kill') : null;
    if (dk !== prevDying[k]) {
      if (dk) {
        dyingAt[k] = w.t;
        events.push(`t=${w.t.toFixed(4)} ${names[k]} 进入 dying(${dk})  hp=${u.hp.toFixed(1)} doom=${u.doom.toFixed(1)} poison=${u.poison.toFixed(1)}`);
      }
      prevDying[k] = dk;
    }
    if (!u.alive && prevAlive[k]) {
      finishAt[k] = w.t;
      events.push(`t=${w.t.toFixed(4)} ${names[k]} 死亡动画播完 alive=false  hp=${u.hp.toFixed(1)}`);
      prevAlive[k] = false;
    }
  }
}
console.log('--- 事件 ---');
for (const e of events) console.log(' ', e);
for (let k = 0; k < 2; k++) {
  const u = w.units[k];
  console.log(`--- ${names[k]}: dieT=${u.dieT===undefined?'-':u.dieT.toFixed(4)} dying=${!!u.dying} alive=${u.alive} doom=${u.doom.toFixed(1)} hp=${u.hp.toFixed(1)} poison=${u.poison.toFixed(1)}`);
}
console.log('--- world.over =', JSON.stringify(w.over));
console.log('--- decideHp =', JSON.stringify(w.decideHp), 'decideT =', w.decideT);
console.log('--- 结论：胜者 =', w.over.win < 0 ? '平局' : names[w.over.win], '| reason =', w.over.reason, '| t =', w.over.t);

/* ---------- 逻辑分支断言（合成状态，直接打 endCheck） ---------- */
function synthetic(label, setup) {
  T.resetMatch(A, B, 12345);
  const [u0, u1] = T.world.units;
  setup(u0, u1);
  T.stepPhysics(1 / 120);          // 死亡结算段会调 endCheck
  const win = T.world.over ? T.world.over.win : null;
  return { label, win };
}
const cases = [];
/* 只有末日降临(units[1])死 → 蛇咬(units[0])胜 */
cases.push(synthetic('仅 units[1] 死', (u0, u1) => {
  u0.dieT = null; u0.dying = null; u0.alive = true;
  u1.dieT = 5; u1.dying = { t: 9, doom: false }; u1.alive = true;
}));
/* 只有蛇咬(units[0])死 → 末日降临(units[1])胜 */
cases.push(synthetic('仅 units[0] 死', (u0, u1) => {
  u0.dieT = 5; u0.dying = { t: 9, doom: false }; u0.alive = true;
  u1.dieT = null; u1.dying = null; u1.alive = true;
}));
/* 同一微步双死 → 平局 */
cases.push(synthetic('同一微步双死', (u0, u1) => {
  u0.dieT = 5; u0.dying = { t: 9, doom: true }; u0.alive = true;
  u1.dieT = 5; u1.dying = { t: 9, doom: false }; u1.alive = true;
}));
/* units[1] 先死、units[0]（灾厄，动画更长）后死 → units[0] 胜 */
cases.push(synthetic('units[1] 先死 units[0] 后死', (u0, u1) => {
  u0.dieT = 5.5; u0.dying = { t: 9, doom: true }; u0.alive = true;
  u1.dieT = 5.0; u1.dying = { t: 9, doom: false }; u1.alive = true;
}));
const want = ['仅 units[1] 死→0', '仅 units[0] 死→1', '同一微步双死→-1', 'units[1]先死→units[0]胜(0)'];
const expect = [0, 1, -1, 0];
let allOk = true;
cases.forEach((c, i) => {
  const ok = c.win === expect[i];
  if (!ok) allOk = false;
  console.log(`  [${ok ? 'OK' : '××'}] ${c.label}: win=${c.win}（期望 ${expect[i]}，${want[i]}）`);
});
console.log('--- 分支断言:', allOk ? '全部通过' : '有失败');
