/**
 * 快速探针：看两张出问题的卡的内部状态机。
 *   node tools/_probe_two.js <cardId> [opp]
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
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch };\n`;
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

const card = process.argv[2] || 'meteor_strike';
const opp = process.argv[3] || 'perfect';

T.resetMatch(T.CARD_BY_ID[card], T.CARD_BY_ID[opp]);
T.world.running = true;
const A = T.world.units[0], B = T.world.units[1];
const mech = A.mech;
console.log(`=== ${card}(${A.card.name}) vs ${opp}(${B.card.name}) ===`);
const dt = 1 / 60;
let next = 0, lastState = mech.state, prevHpB = B.hp;
const lines = [];
while (T.world.t < 150 && !T.world.over && T.world.t < 90) {
  T.world.t += dt; T.stepPhysics(dt);
  if (mech.state !== lastState) {
    lines.push(`  ${T.world.t.toFixed(2)}s  ${lastState} -> ${mech.state}   A=${Math.round(A.hp)} B=${Math.round(B.hp)}`);
    lastState = mech.state;
  }
  if (T.world.t >= next) {
    next += 3;
    let extra = '';
    if (card === 'meteor_strike') {
      const o = mech.liveOrbs().map(x => `${x.state}|d=${Math.round(Math.hypot(x.x - A.x, x.y - A.y))}`);
      extra = `orbs=${mech.liveOrbs().length} orbit=${mech.orbitOrbs().length} [${o.join(' ')}]`;
    } else if (card === 'tracking') {
      const b = mech.blade;
      extra = b ? `blade=${b.state} tip=(${Math.round(b.x)},${Math.round(b.y)}) target=(${Math.round(b.tx)},${Math.round(b.ty)}) hits=${b.hitSet.size}` : 'blade=null';
    }
    lines.push(`  [${T.world.t.toFixed(1)}s] A=${Math.round(A.hp)} B=${Math.round(B.hp)} ${extra}`);
  }
}
console.log(lines.slice(0, 60).join('\n'));
console.log(`结果: ${T.world.over ? (T.world.over.win === 0 ? card + '胜' : T.world.over.win === 1 ? card + '负' : '平') : '未结束'} t=${T.world.t.toFixed(1)}s A=${Math.round(A.hp)} B=${Math.round(B.hp)}`);
