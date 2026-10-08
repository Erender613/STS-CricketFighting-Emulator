/**
 * 内置胜率数据烘焙：给系列赛 AI 当"公认常识"用（玩家不可见）。
 *
 * 产出 tools/bake/winrate_500.json：全部 C(20,2)=231 个无序卡对，每对 500 场
 * （左右站位各半），只存整数胜场（win = 字典序靠前那一方的胜场数）。
 * 运行时查 wr(x,y) 任意方向都能取：反向 = games - 正向；胜率现算不落盘浮点。
 *
 * 【口径】与 tools/balance120.js 一致：步长 1/120s（= 游戏 SIM_DT）、
 * CAP=240s（= CFG.MAX_TIME）、固定主种子可复现。
 *
 * 【重掷】与系列赛正式对局同一条规矩：超时平局或同归于尽平局 → 换种子重打，
 * 直到分出胜负。JSON 里因此没有 draw；重掷场不进胜率分母（分母恒 500），
 * 重掷次数单独计数只做统计。
 *
 * 【并行】WORKERS=n（默认 min(6, 核数-1)）：主进程 fork n 个子进程分片
 * （下标 % n == id），各写 tools/bake/_wr_part_<i>.json，主进程合并后删分片。
 * WORKERS=1 单进程直跑。
 *
 * 用法: node tools/bake_winrate.js
 *       WORKERS=4 node tools/bake_winrate.js
 *       PROBE=1 node tools/bake_winrate.js        # 探吞吐：1 对 × PROBE_N 场
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fork } = require('child_process');
const os = require('os');

/* ---------- 可复现的种子随机（mulberry32，[0,1) 括号写法别动，踩过坑） ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
}
/* 场次种子：把 (主种子, 卡a, 卡b, 第几掷) 混成 32 位整数。
   每掷独立 —— 重掷第 k 次拿 k 的新种子，与别的对局打没打过无关。 */
function gameSeed(master, a, b, k) {
  let h = master >>> 0;
  const s = a + '|' + b + '|' + k;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846CA68B) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const MASTER = parseInt(process.env.SIMSEED || process.env.SEED || '20261001', 10);
const GAMES = parseInt(process.env.N || '500', 10);          // 每对场数（左右各半，必须偶数）
const CAP = +(process.env.CAP || 240);
const HZ = +(process.env.HZ || 120);
const DT = 1 / HZ;
const MAX_RETRY = 50;                                        // 单场重掷上限（兜底）
const WORKERS = Math.max(1, parseInt(process.env.WORKERS
  || String(Math.min(6, Math.max(1, os.cpus().length - 1))), 10));
const OUT_DIR = path.join(__dirname, 'bake');
const OUT_JSON = path.join(OUT_DIR, 'winrate_' + GAMES + '.json');

/* ---------- 载入游戏脚本（与 balance120.js 同一套打桩） ---------- */
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
  setTimeout, clearTimeout, console, Math: Object.create(Math), Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
/* 场次种子全部显式传给 resetMatch；Math.random 只兜引擎里的非对局用途 ——
   也换成确定性的，保证整份数据可复现。 */
sandbox.Math.random = mulberry32(MASTER ^ 0x5BF03635);
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T;
const CARDS = T.CARDS.map(c => ({ id: c.id, name: c.name }));
const IDS = CARDS.map(c => c.id);
const NAME_OF = id => CARDS.find(c => c.id === id).name;

/* ---------- 单场：重掷直到分出胜负 ----------
   gameIdx = 本对内第几场（0..499），必须参与混种 —— 否则一场对里的每一局都是
   同一颗种子（引擎完全确定），500 场等于同一场打 500 遍。
   种子空间按 (gameIdx * 64 + attempt) 切开：MAX_RETRY < 64，重掷不会撞别的场次。
   返回 { win: 0|1, t, rerolls, rerollTimeout, rerollDraw }
   win 按位置记：0 = 左位（units[0]）胜、1 = 右位胜。 */
function playDecisive(aId, bId, gameIdx) {
  let rerolls = 0, rerollTimeout = 0, rerollDraw = 0;
  for (let attempt = 0; ; attempt++) {
    T.resetMatch(T.CARD_BY_ID[aId], T.CARD_BY_ID[bId],
      gameSeed(MASTER, aId, bId, gameIdx * 64 + attempt));
    T.world.running = true;
    let steps = 0;
    const capSteps = Math.ceil(CAP / DT) + 5;
    while (!T.world.over && T.world.t < CAP && steps < capSteps) {
      T.world.t += DT;
      T.stepPhysics(DT);
      steps++;
    }
    const o = T.world.over;
    const t = T.world.t;
    if (o && o.win === 0) return { win: 0, t, rerolls, rerollTimeout, rerollDraw };
    if (o && o.win === 1) return { win: 1, t, rerolls, rerollTimeout, rerollDraw };
    if (attempt >= MAX_RETRY) {
      console.error(`  !! ${aId} vs ${bId} 重掷 ${MAX_RETRY} 次仍平局，硬收（记 0）`);
      return { win: 0, t, rerolls, rerollTimeout, rerollDraw };
    }
    /* 到这里 = 超时平局（没 over）或同归于尽（win === -1）→ 换种子重打 */
    if (o && o.win === -1 && o.reason !== 'timeout') rerollDraw++; else rerollTimeout++;
    rerolls++;
  }
}

/* ---------- 分片：本进程负责全部对里 下标 % WORKERS === id 的片 ---------- */
function runSlice(id) {
  const pairs = [];
  for (let i = 0; i < IDS.length; i++)
    for (let j = i + 1; j < IDS.length; j++) pairs.push([IDS[i], IDS[j]]);
  const half = GAMES / 2;
  const mine = pairs.filter((_, idx) => idx % WORKERS === id);
  const t0 = Date.now();
  let totalT = 0, rerolls = 0, rerollTimeout = 0, rerollDraw = 0, games = 0;
  const wins = {};
  for (let idx = 0; idx < pairs.length; idx++) {
    if (idx % WORKERS !== id) continue;
    const x = pairs[idx][0], y = pairs[idx][1];             // IDS 顺序下 x<y? 不一定，按字典序归一
    const keyA = x < y ? x : y, keyB = x < y ? y : x;
    wins[keyA] = wins[keyA] || {};
    wins[keyA][keyB] = { win: 0, games: GAMES };            // win 记 keyA 方
    let aWin = 0;
    for (let k = 0; k < half; k++) {                        // 前一半：keyA 在左
      const g = playDecisive(keyA, keyB, k);
      if (g.win === 0) aWin++;
      totalT += g.t; rerolls += g.rerolls; rerollTimeout += g.rerollTimeout;
      rerollDraw += g.rerollDraw; games++;
    }
    for (let k = 0; k < half; k++) {                        // 后一半：keyB 在左
      const g = playDecisive(keyB, keyA, half + k);
      if (g.win === 1) aWin++;                              // 右位赢才算 keyA 赢
      totalT += g.t; rerolls += g.rerolls; rerollTimeout += g.rerollTimeout;
      rerollDraw += g.rerollDraw; games++;
    }
    wins[keyA][keyB].win = aWin;
    const sec = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`[w${id}] ${NAME_OF(keyA)} vs ${NAME_OF(keyB)}  ${aWin}-${GAMES - aWin}  ${sec}s`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const part = {
    worker: id, games, totalT, rerolls, rerollTimeout, rerollDraw,
    sec: (Date.now() - t0) / 1000, wins,
  };
  fs.writeFileSync(path.join(OUT_DIR, `_wr_part_${id}.json`), JSON.stringify(part));
  console.log(`[w${id}] 完成，吞吐 ${(games / ((Date.now() - t0) / 1000)).toFixed(1)} 场/s`);
}

/* ---------- 探吞吐 ---------- */
if (process.env.PROBE) {
  const pn = parseInt(process.env.PROBE_N || '20', 10);
  const t0 = Date.now();
  const half = Math.ceil(pn / 2);
  for (let k = 0; k < half; k++) playDecisive(IDS[0], IDS[1], k);
  for (let k = 0; k < pn - half; k++) playDecisive(IDS[1], IDS[0], half + k);
  const sec = (Date.now() - t0) / 1000;
  console.log(`探针：${pn} 场用时 ${sec.toFixed(1)}s → ${(pn / sec).toFixed(1)} 场/s；`
    + `231 对 × ${GAMES} 场单进程 ≈ ${((231 * GAMES) / (pn / sec) / 60).toFixed(0)} 分钟`);
  process.exit(0);
}

/* ---------- 合并 ---------- */
function mergeParts() {
  const wins = {};
  let games = 0, totalT = 0, rerolls = 0, rerollTimeout = 0, rerollDraw = 0, sec = 0;
  const t0 = Date.now();
  for (let i = 0; i < WORKERS; i++) {
    const f = path.join(OUT_DIR, `_wr_part_${i}.json`);
    if (!fs.existsSync(f)) { console.error(`!! 缺分片 ${f}`); process.exit(1); }
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    games += p.games; totalT += p.totalT; rerolls += p.rerolls;
    rerollTimeout += p.rerollTimeout; rerollDraw += p.rerollDraw; sec += p.sec;
    for (const a of Object.keys(p.wins)) {
      wins[a] = wins[a] || {};
      for (const b of Object.keys(p.wins[a])) wins[a][b] = p.wins[a][b];
    }
    fs.unlinkSync(f);
  }
  /* 完整性自检：231 对全在、games 对、win ∈ [0, games] 且都是整数 */
  const expect = CARDS.length * (CARDS.length - 1) / 2;
  let cnt = 0;
  for (const a of Object.keys(wins)) for (const b of Object.keys(wins[a])) {
    const e = wins[a][b];
    if (!(e.games === GAMES && Number.isInteger(e.win) && e.win >= 0 && e.win <= GAMES)) {
      console.error(`!! 脏数据 ${a}|${b}: ${JSON.stringify(e)}`); process.exit(1);
    }
    cnt++;
  }
  if (cnt !== expect) { console.error(`!! 对数 ${cnt} ≠ ${expect}`); process.exit(1); }

  const json = {
    bakedAt: new Date().toISOString(),
    masterSeed: MASTER, gamesPerPair: GAMES, cap: CAP, hz: HZ,
    rerollPolicy: 'timeout/draw -> next seed until decisive',
    cardCount: CARDS.length, pairCount: cnt, totalGames: games,
    rerolledGames: rerolls, rerollTimeout, rerollDraw,
    wallSecPerWorker: sec,
    ids: IDS, names: IDS.map(NAME_OF),
    wins,   // wins[a][b] = {win, games}，a<b 字典序；win = a 方胜场（整数）
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(json));
  console.log(`\n合并完成 → ${OUT_JSON}（${(fs.statSync(OUT_JSON).size / 1024).toFixed(1)} KB，`
    + `合并用时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  console.log(`总场次 ${games}，重掷 ${rerolls} 场（超时 ${rerollTimeout} / 同死 ${rerollDraw}），`
    + `平均每场 ${(totalT / games).toFixed(1)} 游戏秒`);
}

/* ---------- 入口 ---------- */
const WORKER_ID = parseInt(process.env.WORKER_ID || '-1', 10);
if (WORKER_ID >= 0) {
  runSlice(WORKER_ID);
} else if (WORKERS === 1) {
  runSlice(0);
  mergeParts();
} else {
  console.log(`主种子 ${MASTER}，${IDS.length} 张卡 ${IDS.length * (IDS.length - 1) / 2} 对 × ${GAMES} 场，`
    + `${WORKERS} 个并行进程，步长 1/${HZ}s，超时 ${CAP}s 重掷到分胜负`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const kids = [];
  for (let i = 0; i < WORKERS; i++) {
    const env = Object.assign({}, process.env, { WORKER_ID: String(i) });
    delete env.PROBE;
    kids.push(fork(__filename, [], { env, stdio: 'inherit' }));
  }
  let failed = 0;
  kids.forEach((k, i) => k.on('exit', (code) => {
    if (code !== 0) { failed++; console.error(`!! 子进程 w${i} 退出码 ${code}`); }
  }));
  (function waitAll() {
    if (kids.some(k => k.exitCode === null)) { setTimeout(waitAll, 500); return; }
    if (failed) { console.error(`有 ${failed} 个子进程失败，不合并`); process.exit(1); }
    mergeParts();
  })();
}
