/**
 * 调试探针：陨石打击 vs 电流相生 —— 看它到底有没有把陨石砸出去、砸了多少。
 * 用法: node tools/_probe_meteor.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

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

const HTML = path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
const blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = blocks.sort((a, b) => b.length - a.length)[0];
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, CARDS, stepPhysics, resetMatch };\n`;

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
class P2 { moveTo() { } lineTo() { } arcTo() { } closePath() { } rect() { } arc() { } }
class Im { constructor() { this.naturalWidth = 300; this.naturalHeight = 423; } }
const els = {};
const sandbox = {
  document: { getElementById(id) { return els[id] || (els[id] = stubEl()); }, createElement() { return stubEl(); }, createTextNode(t) { return { nodeValue: t }; }, addEventListener() { }, querySelector() { return null; } },
  window: { addEventListener() { }, devicePixelRatio: 1, innerHeight: 900, innerWidth: 1400 },
  Image: Im, Path2D: P2, requestAnimationFrame: () => 0, cancelAnimationFrame() { },
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  setTimeout, clearTimeout, console, Math: MathSeeded, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T;

function run(aId, bId, seconds) {
  T.resetMatch(T.CARD_BY_ID[aId], T.CARD_BY_ID[bId]);
  T.world.running = true;
  const dt = 1 / 60;
  const log = [];
  let steps = 0;
  const A = T.world.units[0], B = T.world.units[1];
  const mech = A.mech;
  let lastState = mech.state;
  let impacts = 0, launched = 0, orbsDone = 0;
  let minDist = 1e9;
  let nextSample = 0;
  let preHp = 0, ammo = { x: 0, y: 0 };
  const hits = [];
  while (T.world.t < seconds && !T.world.over && steps < seconds * 60 + 5) {
    T.world.t += dt;
    T.stepPhysics(dt);
    steps++;
    if (mech.state !== lastState) {
      log.push(`${T.world.t.toFixed(2)}s  ${lastState} -> ${mech.state}  (HP ${Math.round(A.hp)}/${Math.round(B.hp)})`);
      if (mech.state === 'recover') launched++;
      lastState = mech.state;
    }
    if (T.world.t >= nextSample) {
      nextSample += 2;
      const o = mech.all.filter(x => !x.dead).map(x => `${x.state}@${Math.round(Math.hypot(x.x - A.x, x.y - A.y))}`);
      log.push(`   [${T.world.t.toFixed(1)}s] state=${mech.state} orbs=${mech.all.filter(x => !x.dead).length} orbit=${mech.orbitOrbs().length} :: ${o.join(' ')}`);
    }
    for (const e of T.world.effects) {
      if (e.constructor.name === 'MeteorSmoke' && !e.__c) { e.__c = 1; impacts++; }
    }
    /* 陨石发射瞬间记一次敌方 HP，落地后再记一次 → 直接看出"砸中多少" */
    if (mech.state === 'cast' && !mech.__pre) { mech.__pre = true; preHp = B.hp; ammo = { x: mech.aim.x, y: mech.aim.y }; }
    if (mech.state === 'recover' && !mech.__post) {
      mech.__post = true;
      hits.push({ t: +T.world.t.toFixed(2), pre: Math.round(preHp), post: Math.round(B.hp), d: Math.round(Math.hypot(B.x - ammo.x, B.y - ammo.y)) });
    }
    if (mech.state === 'collect') { mech.__pre = false; mech.__post = false; }
    if (A.alive && B.alive) minDist = Math.min(minDist, Math.hypot(A.x - B.x, A.y - B.y));
  }
  return { log, impacts, launched, hits, over: T.world.over, t: T.world.t, tA: T.world.units[0].hp, tB: T.world.units[1].hp, minDist };
}

for (const opp of ['voltaic', 'dark_embrace', 'knife_trap']) {
  const r = run('meteor_strike', opp, 150);
  console.log(`\n=== 陨石打击 vs ${opp} ===  结果 ${r.over ? (r.over.win === 0 ? '陨石胜' : r.over.win === 1 ? '陨石负' : '平') : '未结束'}  t=${r.t.toFixed(1)}s  陨石HP=${Math.round(r.tA)} 敌HP=${Math.round(r.tB)}`);
  console.log(`  陨石发射次数=${r.launched}  落地次数=${r.impacts}  最近距离=${r.minDist.toFixed(0)}px`);
  console.log('  每次陨石: ' + r.hits.map(h => `t=${h.t} HP ${h.pre}->${h.post} 偏离=${h.d}px`).join(' | '));
  for (const l of r.log.slice(0, 26)) console.log('   ', l);
}
