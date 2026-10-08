/* 验收：刀刃陷阱小刀 × 仆从的三条行为（2026-09-23 用户要求）：
 *   1) 引导目标 = 【和刀刃陷阱相撞的那个敌人】（onUnitHit 传入），不再是"离小刀最近的敌人"；
 *      友方单位撞上来不得设置目标（onUnitHit 会收到友方，必须按队伍拦掉）。
 *   2) 刀（引导中）给仆从造成一次伤害后，按【原方向】直线穿过去 —— 不再贴着仆从飞；
 *      之后照样能钉在墙上（state='stuck'，且钉的位置在仆从之外）。
 *   3) 未引导的普通刀打仆从也照旧：穿过、只打一次。
 *
 * 用法：node tools/_knife_minion_check.js [html路径]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
/* 取最大的 script 块 = 游戏逻辑（产物里还有 __BUILD__ 小标记块，不能用贪婪正则） */
const _blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = _blocks.sort((a, b) => b.length - a.length)[0];
if (!src) { console.error('找不到 script'); process.exit(1); }
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, Knife, Minion, MinionBrain, Unit };\n`;

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
  const fn = () => { };
  return new Proxy({
    createLinearGradient: grad, createRadialGradient: grad,
    measureText: () => ({ width: 10 }), getImageData: () => ({ data: [] }),
    canvas: { width: 700, height: 700 },
  }, { get: (t, k) => (k in t ? t[k] : fn), set: () => true });
}
class ImageStub {
  constructor() { this.naturalWidth = 64; this.naturalHeight = 64; this.width = 64; this.height = 64; }
  addEventListener() { }
}
class Path2DStub { moveTo() { } lineTo() { } arc() { } closePath() { } rect() { } }

/* 确定性随机流（种子只是固定场景，不追求和 balance 同流） */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
{ const v = []; const f = mulberry32(1); for (let i = 0; i < 1000; i++) v.push(f());
  if (Math.min(...v) < 0 || Math.max(...v) >= 1) throw new Error('mulberry32 自检失败'); }
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
const byId = id => T.CARD_BY_ID[id];

const checks = [];
const ok = (name, cond, detail) => { checks.push(cond); console.log(`  ${cond ? '✓' : '✗'} ${name}  ${detail || ''}`); };

function freezeAll() {
  W.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
}

/* ---------- 场景 1：引导刀打仆从 → 一次伤害、原方向穿过、钉在墙上 ---------- */
console.log('=== 1. 引导刀给仆从一次伤害后按原方向穿过、继续钉墙 ===');
{
  T.resetMatch(byId('knife_trap'), byId('charge'));
  W.running = true;
  freezeAll();
  const A = W.units[0], B = W.units[1];          // A=刀刃陷阱本体, B=冲锋本体（敌队）
  const kp = byId('knife_trap').p, cp = byId('charge').p;
  /* 几何：B 挪到 y=540 别挡路；仆从摆在刀的飞行路径上（y=200，x=430）并冻结。
     刀从 x=150 朝正右飞 → 命中仆从 → 穿过 → 钉在右墙 x=651。 */
  B.x = 495; B.y = 540;
  const mi = new T.Minion(B, 430, 200, cp);
  W.units.push(mi);
  mi.freeze = 1e9;                               // 仆从也要冻住，别让它自己漂出弹道
  const k = new T.Knife(A, 150, 200, 0, kp);
  k.state = 'recover'; k.delay = 0; k.target = mi;   // 模拟"被引导向（相撞的）仆从"
  W.effects.push(k);

  const hp0 = mi.hp;
  const angAfterHit = new Set();                 // 【命中之后】的角度（命中前的引导微调是合法的）
  let hitFrame = -1, maxKnifeX = 0, stuckFrame = -1;
  for (let f = 0; f < 60 * 5 && stuckFrame < 0; f++) {
    W.t += DT; T.stepPhysics(DT);
    if (hitFrame >= 0) angAfterHit.add(Math.round(k.ang * 1000) / 1000);
    maxKnifeX = Math.max(maxKnifeX, k.x);
    if (hitFrame < 0 && mi.hp < hp0) hitFrame = f;
    if (k.state === 'stuck') stuckFrame = f;
    if (k.dead) break;
  }
  const dealt = hp0 - mi.hp;
  const guidedDmg = kp.dmg * kp.guideMul;
  ok('仆从只吃一次引导伤害（27）', hitFrame >= 0 && Math.round(dealt) === Math.round(guidedDmg),
    `扣血 ${dealt}（设定 dmg${kp.dmg}×guideMul${kp.guideMul}=${guidedDmg}，第 ${hitFrame} 帧命中）`);
  ok('穿过时方向一点没变（原方向直飞）', angAfterHit.size === 1 && [...angAfterHit][0] === 0,
    `命中后出现过的角度：${[...angAfterHit].join(', ') || '(无)'}（应只有 0）`);
  ok('没有卡在仆从身上（飞过了仆从）', maxKnifeX > 430 + 30,
    `刀最远到 x=${maxKnifeX.toFixed(0)}，仆从在 x=430（半径 26）`);
  ok('最终钉在墙上', k.state === 'stuck' && stuckFrame >= 0,
    `state=${k.state}${stuckFrame >= 0 ? `，第 ${stuckFrame} 帧钉住（x=${k.x.toFixed(0)}, y=${k.y.toFixed(0)}）` : ''}`);
}

/* ---------- 场景 2：引导目标 = 相撞的那个敌人，不是最近的 ---------- */
console.log('\n=== 2. 引导目标 = 相撞的敌人（onUnitHit 传入），友方不设置目标 ===');
{
  T.resetMatch(byId('knife_trap'), byId('charge'));
  W.running = true;
  freezeAll();
  const A = W.units[0], B = W.units[1];
  const cp = byId('charge').p;
  const mech = A.mech;
  const k = new T.Knife(A, A.x, A.y, 0, mech.p);
  k.state = 'stuck';
  mech.knives.push(k);
  /* 敌方【仆从】撞上来（它离刀更近 / 就是相撞者）：目标必须是它，而不是"最近的敌人" */
  const minion = new T.Minion(B, 500, 330, cp);
  W.units.push(minion);
  W.units.forEach(u => { if (u.minion) u.freeze = 1e9; });
  mech.onUnitHit(minion);
  ok('相撞的敌方仆从成为引导目标', k.target === minion,
    k.target === minion ? 'target === 撞上来的仆从' : `target=${k.target && k.target.minion ? '(别的目标)' : String(k.target)}`);
  ok('刀进入引导状态', k.state === 'recover', `state=${k.state}`);

  /* 友方撞上来：目标不得被改写（onUnitHit 会收到友方，必须按队伍拦掉） */
  const friendMinion = new T.Minion(A, 300, 330, byId('knife_trap').p);
  W.units.push(friendMinion);
  const before = k.target;
  mech.cd2 = 0;                                  // 解除冷却再试一次
  mech.onUnitHit(friendMinion);
  ok('友方撞上来不改目标', k.target === before, `target ${k.target === before ? '没变' : '被改了!'}`);
}

/* ---------- 场景 3：普通飞行刀打仆从照旧穿过（只打一次） ---------- */
console.log('\n=== 3. 普通刀打仆从：一次伤害 + 穿过 ===');
{
  T.resetMatch(byId('knife_trap'), byId('charge'));
  W.running = true;
  freezeAll();
  const A = W.units[0], B = W.units[1];
  const cp = byId('charge').p;
  B.x = 495; B.y = 540;                          // 本体别挡在弹道上
  const mi = new T.Minion(B, 430, 200, cp);
  W.units.push(mi);
  mi.freeze = 1e9;
  const k = new T.Knife(A, 150, 200, 0, byId('knife_trap').p);   // 默认 fly
  W.effects.push(k);
  const hp0 = mi.hp;
  let maxKnifeX = 0, stuck = false;
  for (let f = 0; f < 60 * 5; f++) {
    W.t += DT; T.stepPhysics(DT);
    maxKnifeX = Math.max(maxKnifeX, k.x);
    if (k.state === 'stuck') { stuck = true; break; }
    if (k.dead) break;
  }
  ok('仆从只吃一次普通伤害（18）', Math.round(hp0 - mi.hp) === byId('knife_trap').p.dmg,
    `扣血 ${hp0 - mi.hp}（dmg=${byId('knife_trap').p.dmg}）`);
  ok('穿过仆从并钉在墙上', stuck && maxKnifeX > 460, `最远 x=${maxKnifeX.toFixed(0)}，最终 ${k.state}`);
}

const fail = checks.filter(c => !c).length;
console.log('\n' + (fail ? `✗ 失败 ${fail} 项` : '✓ 全部通过：引导目标=相撞者 / 穿过仆从 / 照常钉墙'));
process.exit(fail ? 1 : 0);
