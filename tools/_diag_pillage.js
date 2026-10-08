/* 诊断：劫掠第一次突进到底跑了多少帧、方向和速度怎么走的。
   （_verify_patch 的「突进位移 > 600px」失败，要判断是真回归还是探针场景被随机数流影响） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', '杀戮尖塔小球对决.html');
let src =(()=>{const b=(String(fs.readFileSync(HTML, 'utf8')).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})();
src += '\nglobalThis.__T={world,CFG,CARD_BY_ID,stepPhysics,resetMatch};';

function stubEl() {
  const el = { style: {}, dataset: {}, children: [], disabled: false, textContent: '', title: '',
    clientWidth: 700, clientHeight: 700, innerHTML: '',
    classList: { add() { }, remove() { }, toggle() { } }, appendChild(c) { this.children.push(c); return c; },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { width: 700, height: 700, top: 0, left: 0 }; },
    setAttribute() { }, getAttribute() { return null; }, getContext() { return ctx2d(); },
    closest() { return null; }, parentElement: null };
  el.parentElement = el; el.parentElement.clientWidth = 700; return el;
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
  document: { getElementById(id) { return els[id] || (els[id] = stubEl()); }, createElement() { return stubEl(); },
    createTextNode(t) { return { nodeValue: t, textContent: t }; }, addEventListener() { }, removeEventListener() { }, querySelector() { return null; } },
  window: { addEventListener() { }, devicePixelRatio: 1, innerHeight: 900, innerWidth: 1400 },
  Image: ImageStub, Path2D: Path2DStub, requestAnimationFrame: () => 0, cancelAnimationFrame: () => { },
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  setTimeout, clearTimeout, console, Math: seededMath, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T, W = T.world, CFG = T.CFG, DT = 1 / 60;
const byId = (id) => T.CARD_BY_ID[id];
const step = (n) => { for (let i = 0; i < n; i++) { W.t += DT; T.stepPhysics(DT); } };
const park = (u) => { u.mech.update = () => { }; u.baseSpeed = 0; u.boost = 0; u.freeze = 1e9; };

T.resetMatch(byId('darkness'), byId('pillage'));
W.running = true;
const foe = W.units[0], pl = W.units[1];
const p = byId('pillage').p;
park(foe); foe.x = 10; foe.y = 10;

let t0 = -1, chargeFrame = -1;
for (let i = 0; i < 60 * 8; i++) {
  step(1);
  if (pl.mech.state === 'charge') { t0 = pl.mech.timer; chargeFrame = i; pl.x = 620; pl.y = 620; break; }
}
console.log(`蓄力检出：第 ${chargeFrame} 帧，timer=${t0.toFixed(3)}，此时 pl=(${pl.x},${pl.y}) dx=${pl.dx.toFixed(2)} dy=${pl.dy.toFixed(2)}`);
console.log(`对手在 (${foe.x},${foe.y})；场 660×660；起点离右/下墙各 40px`);

let model = 0, frames = 0, peak = 0, firstLine = null, lastLine = null;
let n = 0;
while (n < 60 * 5) {
  const wasDash = pl.mech.state === 'dash';
  step(1); n++;
  if (pl.mech.state === 'dash') {
    model += pl.curSpeed() * DT; frames++;
    peak = Math.max(peak, pl.curSpeed());
    const line = `  帧${String(frames).padStart(3)} pos=(${pl.x.toFixed(0).padStart(3)},${pl.y.toFixed(0).padStart(3)}) spd=${pl.curSpeed().toFixed(0).padStart(3)} dir=(${pl.dx.toFixed(2)},${pl.dy.toFixed(2)}) 累计=${model.toFixed(0)}`;
    if (frames <= 6) firstLine = (firstLine || '') + line + '\n';
    lastLine = line;
  } else if (wasDash) break;
}
console.log('突进前 6 帧：\n' + (firstLine || '(没进 dash)'));
console.log('最后 1 帧：\n' + (lastLine || ''));
console.log(`\n合计：dash 帧数 ${frames}（${(frames * DT).toFixed(2)}s），峰值速度 ${peak.toFixed(0)}，积分位移 ${model.toFixed(0)} px`);
console.log(`实到位移 起点(620,620) → 终点(${pl.x.toFixed(0)},${pl.y.toFixed(0)}) = ${Math.hypot(pl.x - 620, pl.y - 620).toFixed(0)} px`);
console.log(`结束状态=${pl.mech.state}  spdCap=${pl.spdCap}`);
