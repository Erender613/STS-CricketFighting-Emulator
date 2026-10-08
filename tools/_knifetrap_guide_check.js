/**
 * 【刀刃陷阱引导回归探针】直接读 src/game.html，验 2026-09-30 口径：
 *   1) 友方单位撞上刀刃陷阱 → 不触发引导（插墙刀原地不动、不消耗引导冷却）；
 *      典型场景：祭品撞上自己召出来的刀刃陷阱。
 *   2) 敌方单位撞上 → 照常引导，全部插墙刀 recover 且瞄准该敌人。
 *
 * 用法: node tools/_knifetrap_guide_check.js
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
MathSeeded.random = mulberry32(20260930);

const HTML = path.join(__dirname, '..', 'src', 'game.html');
const raw = fs.readFileSync(HTML, 'utf8');
const blocks = raw.match(/<script>([\s\S]*?)<\/script>/g) || [];
let src = blocks.map(s => s.slice(8, -9)).sort((a, b) => b.length - a.length)[0];
src = src.replace("'__BUILD_TAG__'", "'probe'").replace('__ASSET_MAP__', '{"img":{},"snd":{}}');
src += '\nglobalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, Unit, Knife };\n';

function stubEl() {
  return {
    style: {}, dataset: {}, children: [], disabled: false, textContent: '', title: '',
    clientWidth: 700, clientHeight: 700, innerHTML: '', value: '', checked: false,
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, removeChild() { },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { width: 700, height: 700, top: 0, left: 0 }; },
    setAttribute() { }, getAttribute() { return null; },
    getContext() { return ctx2d(); }, closest() { return null; },
    parentElement: { clientWidth: 700 }, querySelector() { return null; },
    querySelectorAll() { return []; }, click() { },
  };
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
  document: {
    getElementById(id) { return els[id] || (els[id] = stubEl()); },
    createElement() { return stubEl(); },
    createTextNode(t) { return { nodeValue: t, textContent: t }; },
    addEventListener() { }, removeEventListener() { }, querySelector() { return null; },
  },
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

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + extra)); }
}

/* 给机制塞两把"插在墙上"的刀，直接测 onUnitHit 的分流逻辑 */
function addStuckKnives(mech, u, n) {
  mech.knives.length = 0;
  for (let i = 0; i < n; i++) {
    const k = new T.Knife(u, u.x, u.y, i * 1.5, u.card.p);
    k.state = 'stuck';
    mech.knives.push(k);
  }
}

console.log('\n== 刀刃陷阱引导：友方不触发 / 敌方照常触发 ==');
{
  T.resetMatch(T.CARD_BY_ID['knife_trap'], T.CARD_BY_ID['dark_embrace'], 20260930);
  const world = T.world, kt = world.units[0], foe = world.units[1];
  const mech = kt.mech;
  ok('机制就绪', !!(mech && mech.onUnitHit));
  mech.cd2 = 0;

  addStuckKnives(mech, kt, 2);
  const buddy = new T.Unit(T.CARD_BY_ID['dark_embrace'], kt.team);   // 友方（同队）
  buddy.alive = true;
  mech.onUnitHit(buddy);
  ok('友方相撞：插墙刀不进入引导', mech.knives.every(k => k.state === 'stuck'),
     mech.knives.map(k => k.state).join(','));
  ok('友方相撞：不消耗引导冷却', mech.cd2 === 0, 'cd2=' + mech.cd2);

  mech.onUnitHit(null);                                              // 无效参数同样不触发
  ok('无效相撞：插墙刀不进入引导', mech.knives.every(k => k.state === 'stuck'));

  mech.onUnitHit(foe);                                               // 敌方本体
  ok('敌方相撞：全部插墙刀转为引导', mech.knives.every(k => k.state === 'recover'),
     mech.knives.map(k => k.state).join(','));
  ok('引导目标 = 撞上来的那个敌人', mech.knives.every(k => k.target === foe));
  ok('敌方相撞：消耗引导冷却', mech.cd2 > 0, 'cd2=' + mech.cd2);
}

console.log('\n' + (fail === 0 ? '✓ 全部通过' : '✗ 有失败') + '：通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
process.exit(fail === 0 ? 0 : 1);
