/**
 * 逐帧跟踪一趟飞刺：剑身在哪儿、敌人到剑身的距离是多少、hitSet 里有什么。
 *   node tools/_probe_blade2.js [opp] [passIndex]
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
const wantPass = +(process.argv[3] || 6);
T.resetMatch(T.CARD_BY_ID.tracking, T.CARD_BY_ID[opp]);
T.world.running = true;
const A = T.world.units[0], B = T.world.units[1];
const mech = A.mech;
const dt = 1 / 60;
let passes = 0, lastState = null, prevHp = B.hp;
let logging = false;
const out = [];
while (T.world.t < 90 && !T.world.over) {
  T.world.t += dt; T.stepPhysics(dt);
  const b = mech.blade;
  if (B.hp < prevHp - 0.001) { out.push(`  掉血 t=${T.world.t.toFixed(2)}s -${Math.round(prevHp - B.hp)}`); prevHp = B.hp; }
  if (!b) continue;
  if (b.state !== lastState) {
    if (lastState === 'fly2') passes++;
    if (b.state === 'fly2') { passes++; logging = (passes === wantPass); if (logging) out.push(`--- 第 ${passes} 趟飞刺开始 t=${T.world.t.toFixed(2)}s 敌(${Math.round(B.x)},${Math.round(B.y)}) 目标(${Math.round(b.tx)},${Math.round(b.ty)}) hitSet=${b.hitSet.size} 阈值=${(B.minion && B.rBody ? B.rBody : T.CFG.R) + b.p.bladeHalf}`); }
    lastState = b.state;
  }
  if (logging && (b.state === 'fly2' || b.state === 'spin' || b.state === 'rise')) {
    const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
    const ax = b.x - ca * T.SB_TIP_OFF, ay = b.y - sa * T.SB_TIP_OFF;
    const d = T.segDist(B.x, B.y, ax, ay, b.x, b.y);
    const D = x => (x * 180 / Math.PI).toFixed(0);
    out.push(`    t=${T.world.t.toFixed(2)} ${b.state} 剑尖(${Math.round(b.x)},${Math.round(b.y)}) ang=${D(b.ang)}° want=${b.wantAng === undefined ? '-' : D(b.wantAng)}° 距离=${d.toFixed(1)} hitSet=${b.hitSet.size} 敌HP=${Math.round(B.hp)}`);
  }
}
console.log(`=== tracking vs ${opp} === 结果 ${T.world.over ? (T.world.over.win === 0 ? '胜' : T.world.over.win === 1 ? '负' : '平') : '未结束'} t=${T.world.t.toFixed(1)}s A=${Math.round(A.hp)} B=${Math.round(B.hp)} 总趟数=${passes}`);
console.log(out.slice(0, 70).join('\n'));
