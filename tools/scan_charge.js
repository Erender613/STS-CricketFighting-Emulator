/**
 * 单人胜率扫描：只让【冲锋！！】对另外 14 张卡各打 N 局（左右站位各半），
 * 用于"只改了这一张卡"时的定点复验，不必跑全表。
 *
 * 用法: node tools/scan_charge.js          # 默认 N=100、CAP=240、步长 1/120（= 游戏 SIM_DT）
 *       N=50 node tools/scan_charge.js     # 缩小样本
 *       CARD=charge node tools/scan_charge.js   # 换主角
 *
 * 口径与 tools/balance120.js 完全一致（同种子、同步长、同超时、同左右各半），
 * 所以本表里的数值可以和 tools/_balance120.json 的同组数字直接比（但注意样本量不同：
 * 这里 100 局、那边 300 局，标准误 ≈3.2pt vs ≈1.9pt）。
 * 输出: tools/_scan_charge.json + 控制台表格
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
const SEED = parseInt(process.env.SIMSEED || process.env.SEED || '20260922', 10);
let N = parseInt(process.env.N || '100', 10);
if (N % 2) { N--; console.log(`  （N 必须是偶数，自动收敛为 ${N}）`); }
const CAP = +(process.env.CAP || 240);
const HZ = +(process.env.HZ || 120);
const DT = 1 / HZ;
const HERO = process.env.CARD || 'charge';
const MathSeeded = Object.create(Math);
MathSeeded.random = mulberry32(SEED);
{
  const chk = mulberry32(12345);
  for (let i = 0; i < 500; i++) {
    const v = chk();
    if (!(v >= 0 && v < 1)) { console.error(`× 种子随机数返回了 ${v}`); process.exit(2); }
  }
}

const HTML = process.env.GAME_HTML
  ? path.resolve(process.env.GAME_HTML)
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
const _blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = _blocks.sort((a, b) => b.length - a.length)[0];
if (!src) { console.error('找不到 script'); process.exit(1); }
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
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  setTimeout, clearTimeout, console, Math: MathSeeded, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T;
const CARDS = T.CARDS.map(c => ({ id: c.id, name: c.name }));
const hero = CARDS.find(c => c.id === HERO);
if (!hero) { console.error('没有这张卡：' + HERO); process.exit(1); }
console.log(`— 载入 OK，${CARDS.length} 张卡；主角 ${hero.name}，每对 ${N} 场（左右各半），`
  + `步长 1/${HZ}s，超时 ${CAP}s 判平，种子 ${SEED}`);

function play(aId, bId) {
  T.resetMatch(T.CARD_BY_ID[aId], T.CARD_BY_ID[bId]);
  T.world.running = true;
  let steps = 0;
  const cap = Math.ceil(CAP / DT) + 5;
  while (!T.world.over && T.world.t < CAP && steps < cap) { T.world.t += DT; T.stepPhysics(DT); steps++; }
  const t = T.world.t;
  if (T.world.over) {
    if (T.world.over.win === 0) return { r: 'L', t };
    if (T.world.over.win === 1) return { r: 'R', t };
    return { r: 'D', t };
  }
  return { r: 'D', t };
}

const half = N / 2;
const rows = [];
const t0 = Date.now();
for (const o of CARDS) {
  if (o.id === hero.id) continue;
  let w = 0, l = 0, d = 0, ts = 0;
  for (let k = 0; k < half; k++) {              // 主角在左
    const g = play(hero.id, o.id); ts += g.t;
    if (g.r === 'D') d++; else if (g.r === 'L') w++; else l++;
  }
  for (let k = 0; k < half; k++) {              // 主角在右
    const g = play(o.id, hero.id); ts += g.t;
    if (g.r === 'D') d++; else if (g.r === 'R') w++; else l++;
  }
  const rate = (w + 0.5 * d) / N;
  rows.push({ id: o.id, name: o.name, games: N, win: w, lose: l, draw: d, winRate: rate, avgTime: ts / N });
  console.log(`  ${hero.name} vs ${o.name.padEnd(6)} ${String(w).padStart(3)}-${String(l).padStart(3)}`
    + `${d ? ' 平' + d : ''}  胜率 ${(rate * 100).toFixed(0)}%   均时 ${(ts / N).toFixed(1)}s`);
}
rows.sort((a, b) => b.winRate - a.winRate);
const overallW = rows.reduce((s, r) => s + r.win, 0), overallD = rows.reduce((s, r) => s + r.draw, 0);
const overallN = rows.length * N;

const W = 8;
function pad(s, wd) {
  let len = 0;
  for (const ch of s) len += /[\u4e00-\u9fff\uff01]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, wd - len));
}
console.log(`\n=== ${hero.name} 对全角色（每对 ${N} 局，按胜率降序）===`);
console.log(pad('对手', 10) + pad('胜', 5) + pad('负', 5) + pad('平', 5) + pad('胜率', 7) + '均时');
for (const r of rows) {
  console.log(pad(r.name, 10) + pad(String(r.win), 5) + pad(String(r.lose), 5) + pad(String(r.draw), 5)
    + pad((r.winRate * 100).toFixed(0) + '%', 7) + r.avgTime.toFixed(1) + 's');
}
const rate = (overallW + 0.5 * overallD) / overallN;
console.log(`\n总胜率 ${(rate * 100).toFixed(1)}%（${overallW} 胜 / ${overallN - overallW - overallD} 负`
  + `${overallD ? ' / ' + overallD + ' 平' : ''}，共 ${overallN} 场，均时 ${(rows.reduce((s, r) => s + r.avgTime * N, 0) / overallN).toFixed(1)}s）`);
console.log(`用时 ${((Date.now() - t0) / 1000).toFixed(0)}s；N=${N} 时标准误 ≈±${(100 * Math.sqrt(0.25 / N)).toFixed(1)}pt`);
const json = { seed: SEED, hz: HZ, capSec: CAP, gamesPerPair: N, hero: hero.id, heroName: hero.name,
  rows, overall: { games: overallN, win: overallW, draw: overallD, winRate: rate } };
fs.writeFileSync(path.join(__dirname, `_scan_${hero.id}.json`), JSON.stringify(json, null, 1), 'utf8');
console.log(`已写出 tools/_scan_${hero.id}.json`);
