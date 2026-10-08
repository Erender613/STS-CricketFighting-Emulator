/**
 * 【环绕灼烧回归探针】直接读 src/game.html，验两条口径：
 *   1) 电流相生的【环绕状态】电球灼烧到「余像的分身」→ 分身当场碎裂并放出反伤斩击
 *      （修复前：直扣 hp 绕过 disperse，分身既不碎也不反，只能被 3 点/次 磨死）；
 *   2) 环绕灼烧触到「灵魂风暴的灵魂」→ 灵魂当场消散
 *      （修复前：直扣 hp，80 血要烧 2.7 秒，违背"受任何攻击波及直接死亡"口径）。
 *
 * 用法: node tools/_orbitburn_check.js
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
src += '\nglobalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, Unit, Orb, WhitePierce };\n';

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
const DT = 1 / 60;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + extra)); }
}
function place(u, x, y) { u.x = x; u.y = y; u.dx = 0; u.dy = 0; u.boost = 0; }

/* 造一颗手动环绕电球挂在 owner 身上（绕开本体机制自身的节奏，保证确定性） */
function makeOrb(owner) {
  const orb = new T.Orb(owner, 0, owner.card.p);
  orb.hold = false;
  T.world.effects.push(orb);   // 引擎统一 update effects
  return orb;
}
/* 把目标钉在电球当前位置，步进数帧 → 环绕灼烧必然判定接触 */
function burnForFrames(orb, target, frames) {
  for (let i = 0; i < frames; i++) {
    if (target.dying || !target.alive) return;
    place(target, orb.x, orb.y);
    T.world.t += DT; T.stepPhysics(DT);
  }
}

console.log('\n== 1. 环绕灼烧 → 余像的分身当场碎裂并反伤 ==');
{
  T.resetMatch(T.CARD_BY_ID['afterimage'], T.CARD_BY_ID['voltaic'], 20260930);
  const world = T.world, ai = world.units[0], foe = world.units[1];
  /* 等分身长出来（MechAfterimage.cd 初值 0.25 → 约 15 帧） */
  let clone = null;
  for (let i = 0; i < 40 && !clone; i++) { world.t += DT; T.stepPhysics(DT); clone = ai.mech && ai.mech.clone; }
  ok('分身已生成', !!clone && !clone.dying);
  foe.hp = foe.maxHp = 100000;                 // 撑住本体，专看反伤数字
  const orb = makeOrb(foe);
  T.world.t += DT; T.stepPhysics(DT);          // 让球先落到环绕位置
  const hp0 = foe.hp, eff0 = world.effects.length;
  burnForFrames(orb, clone, 6);
  ok('分身被灼烧触发碎裂', clone.cDispersed === true);
  ok('放出了反伤斩击白线', world.effects.slice(eff0).some(e => e instanceof T.WhitePierce));
  ok('反伤打了电流相生本体 150', hp0 - foe.hp === 150, 'Δ' + (hp0 - foe.hp));
  ok('分身没有再吃直扣血（碎裂即止）', clone.hp === clone.maxHp, 'hp=' + clone.hp);
}

console.log('\n== 2. 环绕灼烧 → 灵魂当场消散 ==');
{
  T.resetMatch(T.CARD_BY_ID['voltaic'], T.CARD_BY_ID['soul_storm'], 777);
  const world = T.world, foe = world.units[1];   // 灵魂归 soul_storm（蓝方）
  /* 等第一颗灵魂出生（首发 1.4s） */
  let soul = null;
  for (let i = 0; i < 140 && !soul; i++) {
    world.t += DT; T.stepPhysics(DT);
    soul = world.units.find(u => u.soul && u.alive && !u.dying);
  }
  ok('灵魂已出生', !!soul);
  const orb = makeOrb(world.units[0]);
  world.t += DT; T.stepPhysics(DT);
  burnForFrames(orb, soul, 6);
  ok('灵魂被灼烧当场消散（一触即死，不是磨血）', !!soul.dying || !soul.alive,
     soul.alive ? '还活着 hp=' + soul.hp : '');
}

console.log('\n' + (fail === 0 ? '✓ 全部通过' : '✗ 有失败') + '：通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
process.exit(fail === 0 ? 0 : 1);
