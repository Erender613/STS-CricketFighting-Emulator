/* 量「仆从回弹」：在真实对局里抓出仆从速度剧烈反向的事件，并分类原因。
 *
 * 背景：碰撞处（单位×单位 / 单位×仆从两段）的物理弹开是【无条件】执行的，
 * 而伤害判定有三道闸门（state === 'ram'、hitCd > 0、撞到的是仆从）。
 * 于是存在「被弹开但没打出伤害」的路径 —— 观感就是"还没撞到就弹回去了"。
 *
 * 用法：node tools/_minion_recoil_probe.js [html路径] [对局数] [每局秒数]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const RUNS = Number(process.argv[3] || 2);
const SECS = Number(process.argv[4] || 120);
const html = fs.readFileSync(HTML, 'utf8');
let src =(()=>{const b=(String(html).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})();
src += `
globalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, MinionBrain };
`;

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

/* ---- 在真实引擎上挂钩子：记录每一次 onUnitHit 的真实判定结果 ---- */
const hitCalls = [];            // 本帧调用（每帧清空）
const origHit = T.MinionBrain.prototype.onUnitHit;
T.MinionBrain.prototype.onUnitHit = function (e) {
  const m = this.m;
  const before = {
    m, e, eIsMinion: !!(e && e.minion),
    state: m.state, hitCd: this.hitCd, leashing: this.leashing, ordered: this.ordered,
    dmg: 0,
  };
  const hp0 = e ? e.hp : 0;
  origHit.call(this, e);
  before.dmg = hp0 - (e ? e.hp : 0);
  hitCalls.push(before);
};

/* orderRam（本体下令冲撞）也会强行改向，单独记一笔 */
let FRAME = 0;
const orderCalls = [];
const origOrder = T.MinionBrain.prototype.orderRam;
T.MinionBrain.prototype.orderRam = function (t) {
  orderCalls.push({ m: this.m });
  return origOrder.call(this, t);
};

/* 每只仆从上一帧的速度方向 */
const prev = new Map();
const results = { A: 0, B: 0, C: 0, D1拴绳: 0, D2被下令: 0, D3索敌转向: 0, D4其他: 0 };
const samples = [];

function frame() {
  FRAME++;
  hitCalls.length = 0; orderCalls.length = 0;
  W.t += DT;
  T.stepPhysics(DT);
  const minions = W.units.filter(u => u.minion);
  for (const m of minions) {
    const sp = m.curSpeed();
    const d = Math.hypot(m.dx, m.dy) || 1;
    const ux = m.dx / d, uy = m.dy / d;
    const p = prev.get(m);
    if (p && sp > 120 && p.sp > 120 && (ux * p.ux + uy * p.uy) < -0.17) {   // 夹角 > 100°
      /* 本帧该仆从身上的命中调用 */
      const calls = hitCalls.filter(c => c.m === m);
      const realHit = calls.some(c => c.dmg > 0);
      const onMinion = calls.some(c => c.eIsMinion);
      const leashing = !!(m.mech && m.mech.leashing);
      let kind;
      if (realHit) kind = 'A';                              // 正常撞击（有伤害）
      else if (onMinion) kind = 'B';                        // 被对方仆从弹开
      else if (calls.length) kind = 'C';                    // 撞到本体但闸门没过
      else if (leashing) kind = 'D1拴绳';
      else if (orderCalls.some(x => x.m === m)) kind = 'D2被下令';
      else if (m.state === 'idle') kind = 'D3索敌转向';
      else kind = 'D4其他';
      results[kind]++;
      if (kind !== 'A' && samples.length < 16) {
        const c = calls[0];
        samples.push({
          kind, run: RUN_TAG,
          state: c ? c.state : m.state, hitCd: c ? c.hitCd.toFixed(2) : '-',
          leashing, ordered: orderCalls.some(x => x.m === m),
          hitsAt: calls.map(x => `${x.state}/cd${x.hitCd.toFixed(2)}${x.eIsMinion ? '/仆从' : '/本体'}`).join(',') || '无',
          spd: sp.toFixed(0), prevSpd: p.sp.toFixed(0),
          distToFoe: foeDist(m).toFixed(0),
          distToOwn: Math.hypot(m.o.x - m.x, m.o.y - m.y).toFixed(0),
        });
      }
    }
    prev.set(m, { ux, uy, sp });
  }
  for (const m of [...prev.keys()]) if (!W.units.includes(m)) prev.delete(m);
}
function foeDist(m) {
  let best = Infinity;
  for (const u of W.units) {
    if (u.team === m.team || u.minion || !u.alive || u.dying) continue;
    best = Math.min(best, Math.hypot(u.x - m.x, u.y - m.y));
  }
  return best;
}

/* ---- 跑对局 ---- */
let RUN_TAG = '';
const PAIRS = [['charge', 'charge'], ['charge', 'voltaic'], ['charge', 'darkness'], ['charge', 'knife_trap']];
for (const [a, b] of PAIRS) {
  if (!byId(a) || !byId(b)) { console.log(`  !! 跳过 ${a} vs ${b}（卡不存在）`); continue; }
  for (let r = 0; r < RUNS; r++) {
    RUN_TAG = `${a}vs${b}#${r}`;
    T.resetMatch(byId(a), byId(b));
    W.running = true;
    prev.clear();
    const frames = Math.round(SECS / DT);
    for (let i = 0; i < frames; i++) {
      frame();
      if (!W.units.some(u => u.alive && !u.minion && !u.dying)) break;   // 一方本体倒下
    }
  }
}

let total = 0;
console.log('\n========== 仆从"回弹"事件分类（真实对局） ==========');
for (const [k, v] of Object.entries(results)) { total += v; }
console.log(`A  正常撞击（有伤害）       ${results.A}`);
console.log(`B  被【对方仆从】挡下弹开    ${results.B}   ← 撞的不是目标，白弹`);
console.log(`C  撞到本体但闸门没过        ${results.C}   ← 状态/冷却不允许，白弹`);
console.log(`   白弹小计（B+C）          ${results.B + results.C}`);
console.log(`D1 拴绳掉头回家             ${results['D1拴绳']}   ← 设计内（离本体 400px）`);
console.log(`D2 本体下令改向             ${results['D2被下令']}   ← 设计内`);
console.log(`D3 索敌圈内转向             ${results['D3索敌转向']}   ← 设计内`);
console.log(`D4 其他                     ${results['D4其他']}   ← 待查`);
console.log(`总计 ${total} 次`);
console.log('\n--- 非正常事件样本 ---');
for (const s of samples) {
  console.log(`[${s.kind}] ${s.run}  state=${s.state}  hitCd=${s.hitCd}  拴绳=${s.leashing ? 'Y' : 'n'}` +
    `${s.ordered ? ' 被下令' : ''}  命中调用=[${s.hitsAt}]  帧前速度 ${s.prevSpd} → 帧后 ${s.spd}` +
    `  离敌人 ${s.distToFoe}px  离本体 ${s.distToOwn}px`);
}
