/**
 * 回归探针：引导之星"每命中一颗辉星就多召唤一颗"的机制已被删除（2026-09-23 用户要求）。
 *
 * 判据：
 *  ① MechGuiding 上不再有 hitBonus 字段（旧实现靠它跨波累积）；
 *  ② 连续多波的辉星数**恒等于 p.n**（12），不随命中数增长 —— 这是核心判据。
 *     为了让命中数足够大（旧实现下第 2 波就该 >12），把敌人摆在贴身位置：
 *     辉星是从场外螺旋收回本体的，路径必然扫过贴在本体旁的敌人。
 *  ③ 辉星打满血敌人时伤害仍然是 p.dmg（删除的只是"召唤数"，伤害/治疗不动）。
 * 用法: node tools\_star_wave_check.js
 */
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
const MathSeeded = Object.create(Math);
MathSeeded.random = mulberry32(20260922);

const HTML = process.env.GAME_HTML
  ? path.resolve(process.env.GAME_HTML)
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
const blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = blocks.sort((a, b) => b.length - a.length)[0];
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, CARDS, stepPhysics, resetMatch, Star };\n`;

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
  el.parentElement = el;
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
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  setTimeout, clearTimeout, console, Math: MathSeeded, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T;
const byId = id => T.CARD_BY_ID[id];
const P = byId('guiding_star').p;
const DT = 1 / 120;
const checks = [];
const chk = (name, cond, detail) => { checks.push(cond); console.log(`  ${cond ? '✓' : '✗'} ${name}  ${detail}`); };

console.log(`引导之星参数：n=${P.n} dmg=${P.dmg} heal=${P.heal} gap=${P.gapMin}~${P.gapMax}s`);

/* 玩家在左、敌人（冲锋！！）在右；把敌人钉在玩家身边，保证辉星每波都能扫到它 */
T.resetMatch(byId('guiding_star'), byId('charge'));
T.world.running = true;
const A = T.world.units[0], B = T.world.units[1];
A.hp = A.maxHp = 1e9; B.hp = B.maxHp = 1e9;      // 都不许死，跑满 6 波
const mech = A.mech;

chk('① MechGuiding 上已无 hitBonus 字段',
  mech.hitBonus === undefined, `mech.hitBonus = ${mech.hitBonus}`);

/* 逐帧：统计每波新生成的辉星数 + 这一波的命中次数 */
const seen = new WeakSet();
let wave = [], waveHits = 0, waves = [];
const hitsThisWave = new Set();
for (let i = 0; i < 120 * 40; i++) {
  /* 敌人钉在玩家右侧贴身位置（辉星螺旋收回必然扫过），每帧回位防止被推开 */
  B.x = A.x + 40; B.y = A.y; B.dx = 0; B.dy = -1;
  const hp0 = B.hp;
  T.world.t += DT;
  T.stepPhysics(DT);
  if (B.hp < hp0) waveHits++;
  for (const e of T.world.effects) {
    if (e instanceof T.Star && !seen.has(e)) { seen.add(e); wave.push(e); }
  }
  /* 一波结束 = 场上再没有活着的辉星（全归位或全命中），且有新一波生成 */
  const alive = T.world.effects.filter(e => e instanceof T.Star && !e.dead).length;
  if (wave.length && alive === 0) {
    waves.push({ n: wave.length, hits: waveHits });
    wave = []; waveHits = 0;
    if (waves.length >= 5) break;
  }
}
console.log(`\n  实测每波辉星数 / 该波命中次数：`);
for (let i = 0; i < waves.length; i++) console.log(`    第 ${i + 1} 波：${waves[i].n} 颗，命中 ${waves[i].hits} 次`);
const ns = waves.map(w => w.n);
const allN = ns.length > 0 && ns.every(n => n === P.n);
chk('② 每一波的辉星数都 = p.n（不随命中增长）', allN,
  `${ns.join(' / ')}（p.n=${P.n}）`);
const maxHits = Math.max(0, ...waves.map(w => w.hits));
chk('   命中确实发生了（否则这条回归没被真正验证）', maxHits > 0,
  `单波最高命中 ${maxHits} 次`);
/* 关键反证：旧实现下"下一波 = p.n + 上一波命中数"。逐波把旧公式算出来跟实测比 ——
   只要有一波命中数 > 0，旧公式的结果就一定大于实测值。 */
const oldPred = waves.map((w, i) => i === 0 ? P.n : P.n + waves[i - 1].hits);
const differs = waves.every((w, i) => oldPred[i] > w.n || waves[i - 1] === undefined || waves[i - 1].hits === 0);
chk('   实测值 < 旧公式值（命中数>0 的下一波）', differs,
  `实测 ${ns.join('/')}  vs 旧公式 ${oldPred.join('/')}`);

/* ③ 单颗辉星的伤害仍是 p.dmg（打满血敌人，不会被斩杀截断） */
const hp0 = B.hp;
const s = new T.Star(A, B.x + 300, B.y, 0, P, 1);
s.r = 300; s.ang = 0;                                   // 直接给个起始极坐标，跳过首帧初始化
T.world.effects.push(s);
for (let i = 0; i < 120 * 3 && !s.dead; i++) { B.x = A.x + 40; B.y = A.y; T.world.t += DT; T.stepPhysics(DT); }
const dealt = hp0 - B.hp;
chk('③ 单颗辉星命中伤害仍 = p.dmg', Math.abs(dealt - P.dmg) < 0.51, `实测 ${dealt.toFixed(0)}（设定 ${P.dmg}）`);

const pass = checks.every(Boolean);
console.log(`\n${pass ? '✓ 全部通过' : '✗ 有失败项'}（${checks.filter(Boolean).length}/${checks.length}）`);
process.exit(pass ? 0 : 1);
