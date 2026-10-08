/**
 * 调试探针：祭品的实际产出（布阵次数 / 召唤物 / 自己挨了多少）。
 * 用法: node tools/_probe_offering.js
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

function run(aId, bId) {
  T.resetMatch(T.CARD_BY_ID[aId], T.CARD_BY_ID[bId]);
  T.world.running = true;
  const A = T.world.units[0], B = T.world.units[1];
  const mech = A.mech;
  const dt = 1 / 60;
  const log = [];
  let next = 0, casts = 0, selfHp = 1000, summons = [];
  let lastState = mech.state;
  let minionDmg = 0;
  const md = new Map();
  // 包一层：统计召唤物打出的伤害
  const origDamage = B.damage.bind(B);
  B.damage = function (amount, kind, src) {
    const v = origDamage(amount, kind, src);
    if (src && src.summoned) minionDmg += (v || 0); if (src && src.o && src.o.card && src.o.card.id === 'offering') minionDmg += 0;
    return v;
  };
  while (T.world.t < 150 && !T.world.over) {
    T.world.t += dt; T.stepPhysics(dt);
    if (mech.state === 'cast' && lastState !== 'cast') { casts++; selfHp = A.hp; }
    lastState = mech.state;
    if (T.world.t >= next) {
      next += 6;
      const live = T.world.units.filter(u => u.summoned && u.alive && !u.dying);
      const d0 = live[0];
      const extra = d0 ? ` | mech=${d0.mech.constructor.name} sword=${d0.mech.sword ? d0.mech.sword.dmg : '-'} state=${d0.mech.state === undefined ? '-' : d0.mech.state} hp=${Math.round(d0.hp)}` : '';
      log.push(`${T.world.t.toFixed(0)}s 本体=${Math.round(A.hp)} 敌=${Math.round(B.hp)} 召唤物=${live.length}${live.length ? '(' + live[0].realCard.name + ' ' + Math.round(live[0].hp) + ')' : ''} 布阵=${casts} 召唤物总伤=${Math.round(minionDmg)}${extra}`);
    }
  }
  return { over: T.world.over, t: T.world.t, A, B, bySrc: { minion: Math.round(minionDmg) }, log, casts };
}

for (const opp of ['voltaic', 'charge', 'perfected_strike']) {
  const r = run('offering', opp);
  console.log(`\n=== 祭品 vs ${opp} === 结果 ${r.over ? (r.over.win === 0 ? '祭品胜' : r.over.win === 1 ? '祭品负' : '平') : '未结束'} t=${r.t.toFixed(1)}s A=${Math.round(r.A.hp)} B=${Math.round(r.B.hp)} 布阵=${r.casts} 召唤物输出=${r.bySrc.minion}`);
  r.log.slice(0, 12).forEach(l => console.log('   ', l));
}
