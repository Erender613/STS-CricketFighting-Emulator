/* 仆从撞击的【击退方向】对不对？
 *
 * 假设：onUnitHit 里 e.knock(m.dx, m.dy, ...) 用的 m.dx/m.dy 已被引擎反射成"弹开方向"，
 * 于是敌人被推向【和仆从同侧】→ 两者同向滑行 → 仆从追上去反复贴脸 → 白弹。
 *
 * 正确几何：仆从应当弹回，敌人应当被推向仆从来时的方向，两者【反向分离】。
 *
 * 用法：node tools/_minion_knock_probe.js [html路径]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
let src =(()=>{const b=(String(html).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})();
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, Minion, MinionBrain };\n`;

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
const root = new Proxy({}, { get: () => () => { } });
Object.assign(root, { random: () => 0.5 });
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

let pass = 0, fail = 0;
const chk = (name, ok, extra) => {
  console.log((ok ? '  [OK]  ' : '  [BAD] ') + name + (extra ? '   ' + extra : ''));
  ok ? pass++ : fail++;
};

/* 一帧内记录撞击前后双方方向 */
let hitLog = null;
const orig = T.MinionBrain.prototype.onUnitHit;
T.MinionBrain.prototype.onUnitHit = function (e) {
  const m = this.m;
  const log = (!hitLog && m.state === 'ram' && this.hitCd <= 0)
    ? { mdx: m.dx, mdy: m.dy, mx: m.x, my: m.y, ex: e.x, ey: e.y }   // 反射后、knock 前
    : null;
  const r = orig.call(this, e);
  if (log) {
    log.edx = e.dx; log.edy = e.dy;               // knock 之后敌人的真实方向
    log.mSpd = m.curSpeed(); log.eSpd = e.curSpeed();
    hitLog = log;
  }
  return r;
};

/* 场景：仆从在左，本体在右，仆从朝 +x 冲过去 */
T.resetMatch(byId('charge'), byId('voltaic'));
W.running = true;
const [A, B] = W.units;                        // A=charge（仆从的主人）, B=voltaic
B.mech.update = () => { };                     // 关掉对手机制，避免电球干扰
A.mech.update = () => { };                     // 也关掉召唤，仆从手搓
A.x = 100; A.y = 330; A.baseSpeed = 0; A.boost = 0; A.dx = 0; A.dy = 0;
B.x = 500; B.y = 330; B.baseSpeed = 0; B.boost = 0; B.dx = 0; B.dy = 0;

const m = new T.Minion(A, 200, 330, byId('charge').p);
W.units.push(m);
m.state = 'ram'; m.timer = 2.0;
m.dx = 1; m.dy = 0; m.baseSpeed = 430;
m.mech.hitCd = 0;

const trail = [];
for (let i = 0; i < 240; i++) {
  W.t += DT; T.stepPhysics(DT);
  trail.push({ f: i, mx: m.x, my: m.y, mdx: m.dx, mdy: m.dy, ms: m.curSpeed(),
    ex: B.x, ey: B.y, edx: B.dx, edy: B.dy, es: B.curSpeed(), st: m.state, cd: m.mech.hitCd });
  if (hitLog && i > hitLog.__f + 60) break;
  if (hitLog && hitLog.__f === undefined) hitLog.__f = i;
}

console.log(`CFG.R=${CFG.R}  本体验=54  仆从 mR=${byId('charge').p.mR}  接触距离=${CFG.R + byId('charge').p.mR}`);
if (!hitLog) {
  chk('仆从撞到了本体（场景成立）', false, '240 帧内没有发生撞击');
} else {
  const h = hitLog;
  chk('仆从撞到了本体（场景成立）', true,
    `撞点 仆从(${h.mx.toFixed(0)},${h.my.toFixed(0)}) 敌人(${h.ex.toFixed(0)},${h.ey.toFixed(0)})`);
  /* 撞前仆从朝 +x（撞向敌人）→ 撞后仆从应朝 -x（弹回） */
  chk('仆从被弹回（dx 变负）', h.mdx < -0.5, `撞后 仆从 dx=${h.mdx.toFixed(2)} dy=${h.mdy.toFixed(2)}`);
  /* 敌人应被推向 +x（远离仆从的来向） */
  chk('敌人被推向远离仆从的方向（dx 为正）', h.edx > 0.5,
    `撞后 敌人 dx=${h.edx.toFixed(2)} dy=${h.edy.toFixed(2)}`);
  /* 核心：两者不该同向 */
  const dot = h.mdx * h.edx + h.mdy * h.edy;
  chk('两者运动方向【不同向】（dot < 0）', dot < 0,
    `dot=${dot.toFixed(2)}（+1=完全同向，-1=反向分离）`);

  console.log('\n  --- 撞击前后 12 帧 ---');
  const i0 = h.__f;
  for (const r of trail.filter(x => x.f >= i0 - 4 && x.f <= i0 + 10)) {
    console.log(`   帧${String(r.f).padStart(3)} ${r.st.padEnd(5)} ${i0 === r.f ? '★撞' : '   '}` +
      ` 仆从(${r.mx.toFixed(0).padStart(3)},${r.my.toFixed(0).padStart(3)}) dx=${r.mdx.toFixed(2).padStart(5)} spd=${r.ms.toFixed(0).padStart(3)}` +
      ` | 敌人(${r.ex.toFixed(0).padStart(3)},${r.ey.toFixed(0).padStart(3)}) dx=${r.edx.toFixed(2).padStart(5)} spd=${r.es.toFixed(0).padStart(3)}`);
  }
  const gap0 = Math.abs(h.ex - h.mx);
  const last = trail[trail.length - 1];
  console.log(`\n  撞击时间距 ${gap0.toFixed(0)}px → 60 帧后间距 ${Math.abs(last.ex - last.mx).toFixed(0)}px` +
    `（${Math.abs(last.ex - last.mx) > gap0 ? '分离' : '没分开/又贴上'}）`);
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
