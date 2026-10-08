/* 量「一颗弹幕对同一只仆从到底结算了几次伤害」。
 *
 * 背景：弹幕穿仆从（不吞弹）本该是「穿过 + 只打 1 次」，
 * 但若去重检查写在伤害之后（或干脆漏写），弹幕与仆从重叠的每一帧都会再打一次。
 *
 * 用法：node tools/_minion_onehit_probe.js [html路径]
 *   默认读构建产物 杀戮尖塔小球对决.html；可传路径指到别处的产物做前后对比。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
let src =(()=>{const b=(String(html).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})();
src += `
globalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch,
  Knife, Orb, DarkOrb, Star, Minion };
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
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  setTimeout, clearTimeout, console, Math: seededMath, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T, W = T.world, CFG = T.CFG;
const DT = 1 / 60;
const byId = (id) => T.CARD_BY_ID[id];
function step(n) { for (let i = 0; i < n; i++) { W.t += DT; T.stepPhysics(DT); } }

/* 两方本体都停摆并挪出弹道，只留我们手搓的仆从在场上 */
function arena(a, b) {
  T.resetMatch(byId(a), byId(b));
  W.running = true;
  const A = W.units[0], B = W.units[1];
  for (const u of [A, B]) { u.mech.update = () => { }; u.baseSpeed = 0; u.boost = 0; u.freeze = 1e9; }
  A.x = 60; A.y = 60; B.x = 60; B.y = 640;
  return { A, B };
}
/* 血厚到打不死的木桩仆从（用血量差反推挨了几下） */
function dummyMinion(owner, x, y) {
  const m = new T.Minion(owner, x, y, owner.card.p);
  m.mech.update = () => { };
  m.baseSpeed = 0; m.boost = 0; m.freeze = 1e9;
  m.maxHp = 1e6; m.hp = 1e6;
  W.units.push(m);
  return m;
}

let bad = 0;
const HP0 = 1e6;
/* hits(m) = 这只木桩挨了几下。判定：被扫到的每只都必须恰好 1 下，
   且整轮至少要扫到 1 只（否则说明场景没搭上，等于白测）。 */
function report(tag, dmgPerHit, ms, extra) {
  const hits = ms.map(m => Math.round((HP0 - m.hp) / dmgPerHit));
  const touched = hits.filter(h => h > 0);
  const ok = touched.length > 0 && touched.every(h => h === 1);
  if (!ok) bad++;
  console.log((ok ? '  [OK]  ' : '  [BAD] ') + tag
    + `  被扫到的木桩挨打次数 [${touched.join(', ')}]（共 ${touched.length} 只被扫到）`
    + (extra ? '  ' + extra : '')
    + (ok ? '' : touched.length === 0 ? '   ← 一只都没扫到，场景没搭上！' : '   ← 一颗弹打同一只仆从超过 1 次！'));
}

console.log('探针目标：' + HTML);
console.log('（每句 = 一颗弹幕扫过两只木桩仆从，正确结果是各挨 1 下）\n');

/* ---------- ① 电流相生 · 电球 ---------- */
console.log('【电流相生 · 电球】');
{
  const { A, B } = arena('voltaic', 'charge');
  const VP = byId('voltaic').p;
  const m1 = dummyMinion(B, 250, 330), m2 = dummyMinion(B, 450, 330);
  const svSpd = VP.shotSpd, svBoost = VP.shotBoost;
  VP.shotSpd = 200; VP.shotBoost = 0;          // 放慢：把重叠窗口拉到几十帧，漏判就会很明显
  const o = new T.Orb(A, 0, VP);
  o.state = 'fire'; o.launched = true; o.life = 0; o.aim = 0; o.delay = 0;
  o.x = 120; o.y = 330;
  W.effects.push(o);
  let n = 0; while (!o.dead && n < 600) { step(1); n++; }
  VP.shotSpd = svSpd; VP.shotBoost = svBoost;
  report('电球穿两只仆从', VP.shotDmg, [m1, m2],
    `穿过 ${o.hitMinions.size} 只（=2 说明弹幕没被吞掉）`);
}

/* ---------- ② 漆黑 · 暗黑充能球 ---------- */
console.log('\n【漆黑 · 暗黑充能球】');
{
  const { A, B } = arena('darkness', 'charge');
  const DP = byId('darkness').p;
  const m1 = dummyMinion(B, 250, 330), m2 = dummyMinion(B, 450, 330);
  const svSpd = DP.seekSpd;
  DP.seekSpd = 200;
  const d = new T.DarkOrb(A, DP);
  d.state = 'seek'; d.vx = 1; d.vy = 0; d.x = 120; d.y = 330; d.seekT = 0;
  W.effects.push(d);
  let n = 0; while (!d.dead && n < 900) { step(1); n++; }
  DP.seekSpd = svSpd;
  report('暗黑球穿两只仆从', DP.dmg, [m1, m2],
    `穿过 ${d.hitMinions.size} 只`);
}

/* ---------- ③ 引导之星 · 辉星 ---------- */
console.log('\n【引导之星 · 辉星】');
{
  const { A, B } = arena('guiding_star', 'charge');
  const GP = byId('guiding_star').p;
  /* 辉星是「固定 1.5rad/s 螺旋 + 半径按 spd 收缩」扑回本体的，没法走直线，
     所以在它必经的那个半径上摆一圈木桩 —— 螺旋每跨过一个半径就扫过整圈一次。 */
  A.x = 330; A.y = 330;
  const RING = 200, N = 16;
  const ms = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    ms.push(dummyMinion(B, A.x + Math.cos(a) * RING, A.y + Math.sin(a) * RING));
  }
  const svSpd = GP.spd;
  GP.spd = 60;                                  // 放慢收半径速度 → 沿圈扫过时重叠更久
  const st = new T.Star(A, A.x + RING + 40, A.y, 0, GP, 1);
  W.effects.push(st);
  let n = 0; while (!st.dead && n < 900) { step(1); n++; }
  GP.spd = svSpd;
  report('辉星扫过一圈木桩', GP.dmg, ms,
    `穿过 ${st.hitMinions.size} 只`);
}

console.log('\n===== ' + (bad ? bad + ' 项异常：弹幕对同一只仆从重复结算' : '全部通过：一颗弹对同一只仆从恰好 1 下') + ' =====');
process.exit(bad ? 1 : 0);
