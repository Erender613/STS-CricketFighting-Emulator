/**
 * 对战胜率统计（游戏真实步长版）：所有不同角色两两配对，每对打 N 场（左右站位各半），
 * 统计每对之间的胜率并输出 15×15 胜率矩阵（Markdown + CSV + JSON）。
 *
 * 用法: node tools/balance120.js
 *       N=300 CAP=240 node tools/balance120.js     # 官方口径：每对 300 局、按游戏真实 240s 超时
 *
 * 与 tools/balance.js 的唯一实质差别：【步长】。
 * balance.js 用 1/60 秒推进（历史遗留，为了跑得快），而游戏引擎真实步长是 SIM_DT = 1/120
 * （见 杀戮尖塔小球对决.html 的 SIM_HZ）。
 *
 * 【实测：这个差别有多大】同构建、同种子、各 300 局/对（105 组）对照：
 *   平均 |Δ| = 2.3 个百分点，中位 2.0，最大 13.3（黑暗之拥 vs 违逆 60% → 47%）；
 *   胜负关系跨过 50% 的只有 3/105 组；总胜率排名几乎不动（每张卡 |Δ| ≤ 1.8）。
 *   N=300 时 p=0.5 的采样标准误本身就有 ±2.9 个百分点 —— 也就是说 60Hz 口径
 *   在这个样本量下大体够用，但 1/60 的粗步长确实会改变少数对局的碰撞/冷却判定时机，
 *   所以正式结论仍然采用与游戏一致的 1/120s。
 *   （注意：不要拿 tools/_balance.json 做这个对照 —— 它生成于卡牌改动之前的旧构建，
 *     冲锋！！ 等卡的胜率差异主要来自内容改动，不是步长。）
 *
 * 输出: tools/平衡矩阵_120.md / tools/平衡矩阵_120.csv / tools/_balance120.json
 *       （_balance120.json 交给 tools/make_report.js 渲染 → 对战胜率表_120.html）
 *
 * 想跑同口径的 60Hz 对照（只用于量化步长本身带来的偏差，别拿它当结论）：
 *   HZ=60 N=300 node tools/balance120.js
 * 产物会自动带 _60 后缀，不会覆盖正式产物。
 *
 * 【公平性】每对前一半 A 在左、后一半 B 在左 —— 开局左右站位带来的系统性优势不会被算进角色强度。
 * 【超时】CAP 秒内没分出胜负 = 平局（0.5 胜）。CAP=240 与游戏内 CFG.MAX_TIME 一致。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    /* 注意括号：必须先 >>> 0 把 t 变成无符号，再除以 2^32。
       写成 (t ^ (t >>> 7) >>> 0) / 2^32 的话（>>> 优先级高于 ^），
       ^ 的结果仍是带符号 int32，返回范围会变成 [-0.5, 0.5) —— 一半是负数，
       所有 rand(a,b) 都会偏向下半区间，模拟结果整体失效。 */
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
}
const SEED = parseInt(process.env.SIMSEED || process.env.SEED || '20260922', 10);
let N = parseInt(process.env.N || process.env.GAMES || '300', 10);
if (N % 2) { N--; console.log(`  （N 必须是偶数，自动收敛为 ${N}）`); }
const CAP = +(process.env.CAP || 240);
const HZ = +(process.env.HZ || 120);       // 与游戏 SIM_HZ 一致
const DT = 1 / HZ;
/* 产物名后缀：官方口径（120Hz）用 _120；跑对照口径（HZ=60 等）自动换成 _60，
   免得对照跑把正式产物覆盖掉。 */
const SUF = HZ === 120 ? '_120' : `_${HZ}`;
const MathSeeded = Object.create(Math);
MathSeeded.random = mulberry32(SEED);
/* 自检（用独立的生成器实例，不消耗主序列）：随机数必须落在 [0,1)。 */
{
  const chk = mulberry32(12345);
  for (let i = 0; i < 500; i++) {
    const v = chk();
    if (!(v >= 0 && v < 1)) {
      console.error(`× 种子随机数返回了 ${v}，不在 [0,1) 里 —— 检查 mulberry32 的括号。`);
      process.exit(2);
    }
  }
}

const HTML = process.env.GAME_HTML
  ? path.resolve(process.env.GAME_HTML)
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
/* 取【最大】的 script 块 = 游戏逻辑本体。 */
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
    getContext() { return ctx2d(); },
    closest() { return null; },
    parentElement: null,
  };
  el.parentElement = el;
  el.parentElement.clientWidth = 700;
  return el;
}
const grad = () => ({ addColorStop() { } });
function ctx2d() {
  const target = {
    createLinearGradient: grad, createRadialGradient: grad,
    createPattern: () => null, measureText: () => ({ width: 10 }),
  };
  return new Proxy(target, {
    get(t, k) { return (k in t) ? t[k] : () => { }; },
    set(t, k, v) { t[k] = v; return true; },
    has() { return true; },
  });
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
console.log('— 载入脚本 …');
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T;
const CARDS = T.CARDS.map(c => ({ id: c.id, name: c.name }));
console.log(`  OK，${CARDS.length} 张卡；种子 ${SEED}，每对 ${N} 场（左右各半），`
  + `步长 1/${HZ}s（= 游戏 SIM_DT），超时 ${CAP}s 判平`);

/* 单场：返回 { r: 'L' | 'R' | 'D', t: 用时 }
   'L' = 左位（units[0]）胜、'R' = 右位（units[1]）胜、'D' = 平局。按位置命名，别按卡名。 */
function play(aId, bId, capSec) {
  T.resetMatch(T.CARD_BY_ID[aId], T.CARD_BY_ID[bId]);
  T.world.running = true;
  let steps = 0;
  const capSteps = Math.ceil(capSec / DT) + 5;
  while (!T.world.over && T.world.t < capSec && steps < capSteps) {
    T.world.t += DT;
    T.stepPhysics(DT);
    steps++;
  }
  const t = T.world.t;
  if (T.world.over) {
    if (T.world.over.win === 0) return { r: 'L', t };
    if (T.world.over.win === 1) return { r: 'R', t };
    return { r: 'D', t };                       // win === -1：同归于尽 / 超时
  }
  return { r: 'D', t };                         // 到 CAP 还是双活 = 超时平局
}

const half = N / 2;
const wins = {};          // wins[id][oppId] = 累计胜场（含 0.5）
CARDS.forEach(c => wins[c.id] = {});
for (const c of CARDS) for (const d of CARDS) if (c.id !== d.id) wins[c.id][d.id] = 0;
const overall = {};
CARDS.forEach(c => overall[c.id] = { id: c.id, win: 0, lose: 0, draw: 0, games: 0, pts: 0 });

const pairs = [];
for (let i = 0; i < CARDS.length; i++)
  for (let j = i + 1; j < CARDS.length; j++) pairs.push([CARDS[i], CARDS[j]]);

const t0 = Date.now();
let done = 0, totalT = 0, totalGames = 0, drawGames = 0;
const pairStat = [];
for (const [A, B] of pairs) {
  const rec = { a: A.id, b: B.id, games: N, aWin: 0, bWin: 0, draw: 0, timeSum: 0, longest: 0 };
  const bump = (isA) => {                 // isA = 这一场 A 赢了
    if (isA) { rec.aWin++; overall[A.id].win++; overall[B.id].lose++; }
    else { rec.bWin++; overall[B.id].win++; overall[A.id].lose++; }
  };
  const bumpDraw = () => { rec.draw++; overall[A.id].draw++; overall[B.id].draw++; drawGames++; };
  for (let k = 0; k < half; k++) {        // 前一半：A 在左
    const g = play(A.id, B.id, CAP);
    if (g.r === 'D') bumpDraw(); else bump(g.r === 'L');
    rec.timeSum += g.t; totalT += g.t; totalGames++;
    if (g.t > rec.longest) rec.longest = g.t;
  }
  for (let k = 0; k < half; k++) {        // 后一半：B 在左
    const g = play(B.id, A.id, CAP);
    if (g.r === 'D') bumpDraw(); else bump(g.r === 'R');   // B 在左 → 右位赢才算 A 赢
    rec.timeSum += g.t; totalT += g.t; totalGames++;
    if (g.t > rec.longest) rec.longest = g.t;
  }
  const aWinPts = rec.aWin + 0.5 * rec.draw;
  wins[A.id][B.id] += aWinPts;
  wins[B.id][A.id] += N - aWinPts;
  overall[A.id].games += N; overall[B.id].games += N;
  rec.winRate = aWinPts / N;                 // A 视角胜率
  rec.avgTime = rec.timeSum / N;
  pairStat.push(rec);
  done++;
  console.log(`[${String(done).padStart(3)}/${pairs.length}] ${A.name} vs ${B.name}  `
    + `${rec.aWin}-${rec.bWin}${rec.draw ? ' 平' + rec.draw : ''}  →  ${A.name} `
    + `${Math.round(rec.winRate * 100)}%   ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const sec = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n共 ${pairs.length * N} 场，用时 ${sec}s`);

const nameOf = id => CARDS.find(c => c.id === id).name;
const ids = CARDS.map(c => c.id);
CARDS.forEach(c => {
  const o = overall[c.id];
  o.pts = o.win + 0.5 * o.draw;
  o.winRate = o.pts / o.games;
});

/* ---------- 输出矩阵 ---------- */
let md = `# 平衡矩阵（每对不同角色 ${N} 场，左右站位各半，步长 1/${HZ}s，超时 ${CAP}s 判平，种子 ${SEED}）\n\n`;
md += `数值 = 行角色对列角色的胜率（%，四舍五入，已含 0.5×平局）。灰格为自己。\n\n`;
md += `| | ${ids.map(id => nameOf(id)).join(' | ')} | 平均 |\n`;
md += `|---|${ids.map(() => '---:').join('|')}|---:|\n`;
const avg = {};
for (const r of ids) {
  let sum = 0, cnt = 0;
  const cells = ids.map(c => {
    if (c === r) return '—';
    const p = Math.round(wins[r][c] / N * 100);
    sum += p; cnt++;
    return String(p);
  });
  avg[r] = (sum / cnt).toFixed(1);
  md += `| **${nameOf(r)}** | ${cells.join(' | ')} | ${avg[r]} |\n`;
}
md += `\n## 综合排名（平均胜率，降序）\n\n`;
md += [...ids].sort((a, b) => avg[b] - avg[a]).map((id, i) =>
  `${i + 1}. **${nameOf(id)}** — ${avg[id]}%`).join('\n');
md += `\n\n> 以上是「行内 ${ids.length - 1} 组对手胜率的算术平均」；`
  + `按参赛场次加权的总胜率见 tools/_balance${SUF}.json / 对战胜率表${SUF}.html。\n`;
md += `> 步长口径：与游戏引擎一致（SIM_DT = 1/${HZ}s）；`
  + `旧脚本 tools/balance.js 用 1/60s，结论不可直接混用。\n`;

const _failed = [];
function writeOut(file, data) {
  try { fs.writeFileSync(path.join(__dirname, file), data); return true; }
  catch (e) { _failed.push(`${file}(${e.code || e.message})`); return false; }
}
writeOut('平衡矩阵' + SUF + '.md', md);

let csv = ',' + ids.map(id => nameOf(id)).join(',') + ',平均\n';
for (const r of ids) {
  const cells = ids.map(c => c === r ? '' : Math.round(wins[r][c] / N * 100));
  csv += nameOf(r) + ',' + cells.join(',') + ',' + avg[r] + '\n';
}
writeOut('平衡矩阵' + SUF + '.csv', csv);

/* ---------- JSON（给 tools/make_report.js 渲染可视化表用） ---------- */
const json = {
  seed: SEED, gamesPerPair: N, capSec: CAP, maxTime: CAP, hz: HZ,
  cardCount: ids.length, pairCount: pairs.length,
  totalGames, drawGames,
  avgTime: totalT / totalGames,
  ids, names: ids.map(nameOf),
  overall, ranking: [...ids].sort((a, b) => overall[b].winRate - overall[a].winRate),
  pairs: pairStat,
};
writeOut('_balance' + SUF + '.json', JSON.stringify(json, null, 1));

const rank = json.ranking;
console.log('\n综合排名: ' + rank.map(id => `${nameOf(id)} ${(overall[id].winRate * 100).toFixed(1)}%`).join('  >  '));
console.log(`平均时长 ${(totalT / totalGames).toFixed(1)}s，平局 ${drawGames} 场`);
if (_failed.length) console.error(`× 写不出去（文件被占用？关掉再重跑）：${_failed.join('、')}`);
console.log(`想看可视化表格：BAL=_balance${SUF}.json OUT=对战胜率表${SUF}.html node tools/make_report.js`);
