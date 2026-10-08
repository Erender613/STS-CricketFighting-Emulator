/**
 * 【整数伤害审计】用户口径："不要出现非整数伤害机制"。
 *
 * 检查两件事（每帧都查）：
 *   ① 每个单位的 hp / block / vuln / weak / poison 必须始终是整数
 *      （doom 是"持续累积的斩杀阈值"，本来就允许小数，只要求是有限数）；
 *   ② 屏幕上弹出的伤害数字必须是整数（hit / light / poison / heal / hurt / block）。
 *
 * 覆盖：每张卡轮换 3 个对手各跑一局（默认 45 秒），尽量把各种伤害路径都跑到。
 * 用法: node tools/_int_damage_check.js [每局秒数，默认 45]
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
const HTML = process.env.GAME_HTML
  ? path.resolve(process.env.GAME_HTML)
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const blocks = (fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = blocks.sort((a, b) => b.length - a.length)[0];
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, CARDS, stepPhysics, resetMatch };\n`;
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

const SECONDS = +(process.argv[2] || 45);
const IDS = T.CARDS.map(c => c.id);
const OPPS = ['voltaic', 'expose', 'knife_trap', 'perfected_strike', 'sleight_of_flesh', 'end_of_days'];
const NUMKIND = new Set(['hit', 'light', 'poison', 'heal', 'hurt', 'block', 'doom']);
const bad = [];
const seenNums = new Set();

function unitTag(u) {
  const card = u.realCard ? u.realCard.name : (u.card ? (u.card.name || u.card.id) : '?');
  const role = u.replica ? '分身' : u.soul ? '灵魂' : u.minion ? '仆从' : '本体';
  return `${card}(${role})`;
}
function report(what, pair) {
  const key = what + '|' + pair;
  if (!bad.some(b => b.key === key)) { bad.push({ key, what, pair }); }
}

let matches = 0, steps = 0;
for (let i = 0; i < IDS.length; i++) {
  for (let k = 0; k < 3; k++) {
    const a = IDS[i], b = OPPS[(i + k) % OPPS.length];
    T.resetMatch(T.CARD_BY_ID[a], T.CARD_BY_ID[b]);
    T.world.running = true;
    matches++;
    const dt = 1 / 60, n = Math.round(SECONDS * 60);
    for (let s = 0; s < n; s++) {
      T.world.t += dt; T.stepPhysics(dt); steps++;
      for (const u of T.world.units) {
        if (u.finished) continue;
        for (const f of ['hp', 'block', 'vuln', 'weak', 'poison']) {
          if (!Number.isInteger(u[f])) report(`${unitTag(u)}.${f}=${u[f]}`, `${a} vs ${b}`);
        }
        if (!Number.isFinite(u.doom)) report(`${unitTag(u)}.doom=${u.doom}`, `${a} vs ${b}`);
      }
      for (const num of T.world.nums) {
        if (!NUMKIND.has(num.kind)) continue;
        seenNums.add(num.kind);
        /* 飘字可能带前缀标签（"毒 50" / "格挡+50" / "激发"）——
           把里面的每个数字 token 都抠出来，逐个要求是整数：
           "37.5" 这种 token 会直接被判失败，纯标签（"激发"）没有 token 就跳过。 */
        const toks = String(num.v).match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || [];
        for (const tk of toks) {
          if (!/^-?\d+$/.test(tk)) report(`飘字 "${num.v}"(${num.kind}) 里的 ${tk}`, `${a} vs ${b}`);
        }
      }
    }
  }
}
console.log(`整数伤害审计：${matches} 局 × ${SECONDS}s（每卡 3 个对手），共 ${steps} 步`);
console.log(`  见过的飘字类型: ${[...seenNums].join(', ')}`);
if (bad.length) {
  console.log(`!! 发现 ${bad.length} 类非整数问题：`);
  for (const b of bad.slice(0, 20)) console.log(`   ✗ ${b.what}   例：${b.pair}`);
  process.exit(1);
}
console.log('✓ 全程没有非整数伤害：hp/格挡/易伤/虚弱/毒素 恒为整数，伤害飘字恒为整数');
