/**
 * 追踪之刃专用探针：剑飞刺时，敌人到【剑身线段】的最短距离到底是多少？
 * 顺便统计"剑有没有真的打中"。
 *   node tools/_probe_blade.js [opp]
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
const blocks = (fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = blocks.sort((a, b) => b.length - a.length)[0];
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, segDist, SB_TIP_OFF };\n`;
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

const opp = process.argv[2] || 'perfected_strike';
T.resetMatch(T.CARD_BY_ID.tracking, T.CARD_BY_ID[opp]);
T.world.running = true;
const A = T.world.units[0], B = T.world.units[1];
const mech = A.mech;
const dt = 1 / 60;
let passes = 0, hits = 0, lastState = null;
let minD = 1e9, passMinD = 1e9, msg = [];
let prevHpB = B.hp;
let prevHpB2 = B.hp;
while (T.world.t < 90 && !T.world.over) {
  T.world.t += dt; T.stepPhysics(dt);
  if (B.hp < prevHpB2 - 0.001) {
    const lost = Math.round(prevHpB2 - B.hp);
    hits++;
    msg.push(`  掉血 t=${T.world.t.toFixed(1)}s  -${lost}  → B=${Math.round(B.hp)}`);
    prevHpB2 = B.hp;
  }
  const b = mech.blade;
  if (b) {
    const st = b.state;
    if (st !== lastState) {
      if (lastState === 'fly2') { passes++; msg.push(`  第${passes}趟飞刺: 最近距离=${passMinD.toFixed(0)}px (阈值 ${(B.minion && B.rBody ? B.rBody : T.CFG.R) + b.p.bladeHalf})`); }
      if (st === 'fly2') { passMinD = 1e9; }
      lastState = st;
    }
    if (st === 'fly' || st === 'fly2') {
      const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
      const ax = b.x - ca * T.SB_TIP_OFF, ay = b.y - sa * T.SB_TIP_OFF;
      const d = T.segDist(B.x, B.y, ax, ay, b.x, b.y);
      if (d < passMinD) passMinD = d;
      if (d < minD) minD = d;
    }
  }
  if (B.hp < prevHpB) prevHpB = B.hp;
}
console.log(`=== tracking vs ${opp} === 结果 ${T.world.over ? (T.world.over.win === 0 ? '胜' : T.world.over.win === 1 ? '负' : '平') : '未结束'} t=${T.world.t.toFixed(1)}s A=${Math.round(A.hp)} B=${Math.round(B.hp)}`);
console.log(`飞刺趟数=${passes}  敌人掉血事件=${hits}  全场敌人到剑身的最小距离=${minD.toFixed(1)}px`);
msg.slice(0, 26).forEach(m => console.log(m));
