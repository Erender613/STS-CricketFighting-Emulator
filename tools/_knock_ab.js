/* 受控 A/B：只改电流相生的「电球击退」参数，跑同一批种子，
   看增强击退到底是变强还是变弱，并拆开"电球伤害"与"环绕灼烧命中"。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
}
const SEED = 20260922;
const MathSeeded = Object.create(Math);
MathSeeded.random = mulberry32(SEED);

const HTML = path.join(__dirname, '..', '杀戮尖塔小球对决.html');
let src =(()=>{const b=(String(fs.readFileSync(HTML, 'utf8')).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})();
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, CARDS, stepPhysics, resetMatch, Unit, Zap };\n`;

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
const DT = 1 / 60;
const CAP = 240, N = 100;

/* --- 埋点：电球伤害（走 damage）与环绕命中（每个 Zap 只记一次） --- */
let SHOT_DMG = 0, SHOT_HIT = 0, ORBIT_HIT = 0;
const UP = T.Unit.prototype, od = UP.damage;
UP.damage = function (amount, kind, src) {
  const b = this.hp;
  const r = od.call(this, amount, kind, src);
  if (src && src.card && src.card.id === 'voltaic') {
    SHOT_DMG += Math.max(0, b - this.hp);
    SHOT_HIT++;
  }
  return r;
};
const zu = T.Zap.prototype.update;
T.Zap.prototype.update = function (dt) {
  if (!this.__cnt) { this.__cnt = 1; ORBIT_HIT++; }
  return zu.call(this, dt);
};

function play(aId, bId) {
  T.resetMatch(T.CARD_BY_ID[aId], T.CARD_BY_ID[bId]);
  T.world.running = true;
  let steps = 0;
  const capSteps = Math.ceil(CAP / DT) + 5;
  while (!T.world.over && T.world.t < CAP && steps < capSteps) {
    T.world.t += DT; T.stepPhysics(DT); steps++;
  }
  if (T.world.over) {
    if (T.world.over.win === 0) return 'L';
    if (T.world.over.win === 1) return 'R';
    return 'D';
  }
  return 'D';
}

const ids = T.CARDS.map(c => c.id);
const focus = 'voltaic';
const CONFIGS = [
  { tag: '10/60   原始    ', knock: 10, cap: 60 },
  { tag: '30/180  上一轮  ', knock: 30, cap: 180 },
  { tag: '45/270  本轮    ', knock: 45, cap: 270 },
];
const res = [];
for (const cfg of CONFIGS) {
  MathSeeded.random = mulberry32(SEED);          // 每组重置到同一随机序列
  T.CARD_BY_ID[focus].p.shotKnock = cfg.knock;
  T.CARD_BY_ID[focus].p.shotKnockCap = cfg.cap;
  SHOT_DMG = 0; SHOT_HIT = 0; ORBIT_HIT = 0;
  let w = 0, l = 0, d = 0, tsum = 0, games = 0;
  const per = {};
  for (const foe of ids) {
    if (foe === focus) continue;
    let fw = 0;
    for (let k = 0; k < N; k++) {
      const left = k < N / 2;
      const r = left ? play(focus, foe) : play(foe, focus);
      games++;
      if (r === 'D') d++;
      else if ((left && r === 'L') || (!left && r === 'R')) { w++; fw++; }
      else l++;
    }
    per[T.CARD_BY_ID[foe].name] = fw / N;
  }
  res.push({ cfg, w, l, d, games, per, shotDmg: SHOT_DMG / games, shotHit: SHOT_HIT / games, orbitHit: ORBIT_HIT / games });
}

console.log('电流相生 · 只改电球击退参数的受控 A/B（种子 ' + SEED + '，每张对手 ' + N + ' 局）\n');
console.log('  配置             总胜率      电球伤害/局   电球命中/局   环绕命中/局');
console.log('  ' + '-'.repeat(66));
for (const r of res) {
  const wr = r.w / r.games * 100;
  console.log('  ' + r.cfg.tag + (wr).toFixed(1).padStart(8) + '%' +
    r.shotDmg.toFixed(1).padStart(13) + r.shotHit.toFixed(1).padStart(14) + r.orbitHit.toFixed(1).padStart(14));
}
console.log('\n  逐对手胜率（%）');
const foes = Object.keys(res[0].per);
console.log('    ' + '对手'.padEnd(12) + CONFIGS.map(c => c.knock + '/' + c.cap).map(s => s.padStart(9)).join(''));
foes.forEach(f => {
  console.log('    ' + f.padEnd(12) + res.map(r => (r.per[f] * 100).toFixed(0).padStart(9)).join(''));
});
