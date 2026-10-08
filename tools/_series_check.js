/**
 * 系列赛（PvE / AI vs AI）+ 角色系统 无头探针：给 src/game.html 打桩真跑。
 *
 *  A) 抽取约束：200 个系列种子全查 —— 己方 9 张互不重复、对应两套（红 i ∩ 蓝 i）无
 *     相同卡、卡 id 全部有效、抽取可复现
 *  B) 静默猎手重随机：必换出新卡、不破坏约束、次数扣减、用完拒绝
 *  C) 铁甲烧牌 + AI 决策：只烧对方、最多 2 张、烧的是对方卡组里的卡；选牌全非空且
 *     不选被烧的卡；WR 数据缺失（探针直跑 src）时 wrRate 一律 0.5
 *  D) 整场决定论：同系列种子两次完整跑（抽卡→AI 全部动作→三局种子）逐项全同
 *  E) 储君：撞击 +3 虚弱/易伤、0.5s 触发间隔、上限 6 层、友方不误伤
 *  F) 亡灵契约师：致死不立即死、挂 7 秒倒计时、期间再杀无效、到期按原路径
 *     （普通/灾厄）进入死亡动画、dieT 保留"挨刀时刻"
 *  G) 故障机器人：敌方血量 ≥75% 期间受伤害 -75%（floor 取整保 1 点）、低于 75% 后
 *     恢复正常、无角色一方不受影响；边界 75% 整数交叉相乘口径
 *  H) 端到端：AI vs AI（固定双角色）完整三局两胜 —— 预演种子必分胜负、比分可达 2
 *  I) 天意加身：推演扫描 50 局扫到玩家胜局、最佳种子可复现、精彩度评分口径
 *  J) 经典模式回归：SERIES.on = false 时角色字段全 falsy、对局照常分出胜负
 *
 * 用法: node tools/_series_check.js                        # 默认读 src/game.html
 *       GAME_HTML=杀戮尖塔小球对决_开发者版.html node ...   # 也可对着构建产物跑
 *
 * ⚠ 2026-10-08：系列赛只在开发者版开放。正式版（杀戮尖塔小球对决.html）的系列赛代码
 *   已被 build.py 在构建期整块剔除，对着它跑本探针会在装载阶段直接 ReferenceError
 *   （本探针要往沙箱里挂 SERIES/CHARACTERS 等符号，正式版里没有）—— 这是预期行为。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 可复现的种子随机（mulberry32，[0,1) 自检别删） ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
}
const SEED = parseInt(process.env.SIMSEED || '20261001', 10);
const MathSeeded = Object.create(Math);
MathSeeded.random = mulberry32(SEED);

const HTML = process.env.GAME_HTML
  ? path.resolve(process.env.GAME_HTML)
  : path.join(__dirname, '..', 'src', 'game.html');
const html = fs.readFileSync(HTML, 'utf8');
/* 取最大的 script 块（产物里的 __BUILD__ 小标记块不能被贪婪正则一起吞） */
const _blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = _blocks.sort((a, b) => b.length - a.length)[0];
if (!src) { console.error('找不到 script'); process.exit(1); }
/* 探针直跑 src 时 __WR_DATA__ 是"未定义标识符"——游戏里的 typeof 兜底会置 null，
   正好把"AI 退化成不看数据"这条路也测掉。这里不再替换 __WR_DATA__。 */
src = src.replace("'__BUILD_TAG__'", "'probe'").replace('__ASSET_MAP__', '{"img":{},"snd":{},"bg":{},"bgm":{},"ui":{}}');
src += `\nglobalThis.__T = { world, CFG, CARDS, CARD_BY_ID, resetMatch, stepPhysics, stepOnce,
  runFullMatch, makeHeadless, endHeadless, testList, seedHash, makeSeed,
  SERIES, CHARACTERS, CHAR_BY_ID, NECRO_DELAY, REGENT,
  seriesDrawSets, seriesRerollSet, seriesBurnCard, seriesBegin, seriesApplyCharFx,
  seriesTickFx, seriesRegentHit, seriesBattleSeed, seriesPrerollSeed,
  seriesDestinyScan, destinyScore,
  aiPicks, aiPickSet, aiIroncladBurns, aiSilentRerolls, aiSetScore, wrRate };`;

/* ---------- DOM / Canvas 打桩（与 simcheck 同款） ---------- */
function stubEl() {
  const el = {
    style: {}, dataset: {}, children: [], disabled: false, textContent: '', title: '',
    clientWidth: 700, clientHeight: 700, innerHTML: '',
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
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
    body: null,
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

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  × ${name}${extra !== undefined ? ' —— ' + extra : ''}`);
}

/* ---------- 小工具 ---------- */
function drawWith(seed, charSel) {
  const S = T.SERIES;
  S.on = true;
  S.seed = seed >>> 0;
  S.rng = mulberry32(S.seed);
  S.chars.L = charSel && charSel.L ? T.CHAR_BY_ID[charSel.L] : T.CHAR_BY_ID.ironclad;
  S.chars.R = charSel && charSel.R ? T.CHAR_BY_ID[charSel.R] : T.CHAR_BY_ID.silent;
  S.human = { L: false, R: false };       // 探针里默认双 AI，玩家交互路径用浏览器验收
  S.aiLog = [];
  S.score = { L: 0, R: 0 };
  S.round = 0;
  S.roundWinners = [];
  S.rerollsLeft = {
    L: S.chars.L.id === 'silent' ? 2 : 0,
    R: S.chars.R.id === 'silent' ? 2 : 0
  };
  T.seriesDrawSets();
}
function flatSets(side) { return T.SERIES.sets[side].flat(); }
function draftInvariant(tag) {
  const S = T.SERIES;
  const L9 = flatSets('L'), R9 = flatSets('R');
  ok(tag + '：红方 9 张互不重复', new Set(L9).size === 9, JSON.stringify(L9));
  ok(tag + '：蓝方 9 张互不重复', new Set(R9).size === 9, JSON.stringify(R9));
  ok(tag + '：卡 id 全部有效', L9.concat(R9).every(id => !!T.CARD_BY_ID[id]));
  let cross = 0;
  for (let i = 0; i < 3; i++) {
    for (const id of S.sets.L[i]) if (S.sets.R[i].includes(id)) cross++;
  }
  ok(tag + '：对应两套（红 i ∩ 蓝 i）无相同卡', cross === 0, `${cross} 张重复`);
  return { L9, R9 };
}

console.log('== A. 抽取约束（200 个种子全查） ==');
{
  let bad = 0;
  for (let s = 1; s <= 200; s++) {
    drawWith(s * 7919);
    const L9 = flatSets('L'), R9 = flatSets('R');
    if (new Set(L9).size !== 9 || new Set(R9).size !== 9) bad++;
    if (!L9.concat(R9).every(id => !!T.CARD_BY_ID[id])) bad++;
    for (let i = 0; i < 3; i++) {
      for (const id of T.SERIES.sets.L[i]) if (T.SERIES.sets.R[i].includes(id)) bad++;
    }
  }
  ok('200 个种子全部满足抽取约束', bad === 0, `${bad} 处违规`);
  drawWith(777);
  const snap1 = JSON.stringify(T.SERIES.sets);
  drawWith(777);
  ok('抽取可复现（同种子同卡组）', JSON.stringify(T.SERIES.sets) === snap1);
}

console.log('== B. 静默猎手重随机 ==');
{
  drawWith(2026, { L: 'silent', R: 'defect' });
  const old = T.SERIES.sets.L[1].slice();
  ok('初始 2 次机会', T.SERIES.rerollsLeft.L === 2);
  const r1 = T.seriesRerollSet('L', 1);
  ok('第 1 次重随机成功', r1 === true);
  const now = T.SERIES.sets.L[1];
  ok('必换出新卡（与旧套零交集）', old.every(id => !now.includes(id)), `${old} → ${now}`);
  draftInvariant('重随机后');
  ok('次数扣到 1', T.SERIES.rerollsLeft.L === 1);
  T.seriesRerollSet('L', 1);
  T.seriesRerollSet('L', 1);
  ok('用完之后拒绝', T.SERIES.rerollsLeft.L === 0 && T.seriesRerollSet('L', 0) === false);
}

console.log('== C. 铁甲烧牌 + AI 决策 ==');
{
  drawWith(31415, { L: 'ironclad', R: 'silent' });
  T.SERIES.rerollsLeft.R = 2;
  T.aiSilentRerolls('R');
  draftInvariant('AI 重随机后');
  const R9 = flatSets('R');
  T.aiIroncladBurns('L');
  const burned = T.SERIES.burned.R;
  ok('AI 烧 2 张', burned.length === 2, JSON.stringify(burned));
  ok('烧的都是对方卡组里的卡', burned.every(id => R9.includes(id)));
  T.aiIroncladBurns('L');
  ok('重复烧牌不叠加', T.SERIES.burned.R.length === 2);
  T.aiPicks('L'); T.aiPicks('R');
  let dirty = 0;
  for (const side of ['L', 'R']) {
    for (let i = 0; i < 3; i++) {
      const p = T.SERIES.picks[side][i];
      if (!p || !T.SERIES.sets[side][i].includes(p) || T.SERIES.burned[side].includes(p)) dirty++;
    }
  }
  ok('AI 三套选牌都有效且避开被烧卡', dirty === 0, `${dirty} 处非法`);
  ok('WR 数据缺失时 wrRate 一律 0.5', T.wrRate('dark_embrace', 'voltaic') === 0.5);
}

console.log('== D. 整场决定论（抽卡 → AI 动作 → 三局种子） ==');
function fullDraftSnapshot(seed, charSel) {
  drawWith(seed, charSel);
  /* 阶段顺序（2026-10 口径）：静默换牌在前、铁甲烧牌在后 */
  T.aiSilentRerolls('R');
  T.aiIroncladBurns('L');
  T.aiPicks('L'); T.aiPicks('R');
  const seeds = [0, 1, 2].map(r => T.seriesPrerollSeed(r));
  return {
    sets: JSON.stringify(T.SERIES.sets),
    burned: JSON.stringify(T.SERIES.burned),
    picks: JSON.stringify(T.SERIES.picks),
    seeds
  };
}
{
  const a1 = fullDraftSnapshot(8888, { L: 'ironclad', R: 'silent' });
  const a2 = fullDraftSnapshot(8888, { L: 'ironclad', R: 'silent' });
  ok('同系列种子整场逐项全同', JSON.stringify(a1) === JSON.stringify(a2));
  ok('三局预演种子互不相同', new Set(a1.seeds).size === 3, JSON.stringify(a1.seeds));
}

console.log('== E. 储君（撞击叠虚弱/易伤） ==');
{
  drawWith(42, { L: 'regent', R: 'silent' });
  T.resetMatch(T.CARD_BY_ID.dark_embrace, T.CARD_BY_ID.voltaic, 42);
  const [a, b] = T.world.units;
  ok('resetMatch 后自动挂角色效果', a.fxRegent === true && b.fxRegent === false);
  T.seriesRegentHit(a, b);
  ok('撞击 +3 虚弱 +3 易伤', b.weak === 3 && b.vuln === 3, `weak=${b.weak} vuln=${b.vuln}`);
  ok('触发间隔压住（0.5s 内不再叠）', a.regentCd > 0);
  T.seriesRegentHit(a, b);
  ok('间隔内不叠层', b.weak === 3 && b.vuln === 3);
  a.regentCd = 0; T.seriesRegentHit(a, b);
  ok('再撞 +3 → 顶到上限 6', b.weak === 6 && b.vuln === 6);
  a.regentCd = 0; T.seriesRegentHit(a, b);
  ok('上限封住不破 6', b.weak === 6 && b.vuln === 6);
  const hp0 = b.hp;
  const v = b.damage(100, 'hit', a);
  ok('易伤乘区生效（100 → floor 150）', v === 150 && b.hp === hp0 - 150, `v=${v}`);
  b.weak = 0; b.vuln = 0;
  a.regentCd = 0; T.seriesRegentHit(a, a);
  ok('友方不误伤', a.weak === 0 && a.vuln === 0);
  a.regentCd = 0.5; T.seriesTickFx(0.5);
  ok('每步结算冷却正常走', a.regentCd <= 0);
}

console.log('== F. 亡灵契约师（死亡延迟 7 秒） ==');
{
  drawWith(42, { L: 'necrobinder', R: 'silent' });
  T.resetMatch(T.CARD_BY_ID.dark_embrace, T.CARD_BY_ID.voltaic, 42);
  const [a, b] = T.world.units;
  ok('resetMatch 后挂亡灵效果', a.fxNecro === true && b.fxNecro === false);
  const t0 = T.world.t;
  a.damage(999999, 'hit', b);
  ok('致死不立即死', a.alive === true && a.dying === null && a.hp === 0);
  ok('进入亡灵挂起', a.necroPend === true && Math.abs(a.necroT - T.NECRO_DELAY) < 1e-9);
  ok('dieT 记在挨刀这一刻', a.dieT === t0);
  a.damage(999999, 'hit', b);
  ok('挂起期间再杀无效', a.necroPend === true && a.dying === null && a.dieT === t0);
  a.necroT = 0.001;
  T.seriesTickFx(0.01);
  ok('到期进入死亡动画（普通路径）', a.dying !== null && a.dying.doom === false && a.fxNecro === false);
  ok('续死不重写 dieT', a.dieT === t0, `dieT=${a.dieT} t0=${t0}`);
  /* 播完死亡动画 → 对方获胜 */
  for (let i = 0; i < 200 && !T.world.over; i++) { T.world.t += 1 / 120; T.stepPhysics(1 / 120); }
  ok('亡灵到期后正常判负', T.world.over && T.world.over.win === 1, JSON.stringify(T.world.over));
  /* 灾厄路径同样延迟 */
  drawWith(42, { L: 'necrobinder', R: 'silent' });
  T.resetMatch(T.CARD_BY_ID.dark_embrace, T.CARD_BY_ID.voltaic, 42);
  const [c] = T.world.units;
  c.killByDoom();
  ok('灾厄处决同样被延迟', c.necroPend === true && c.necroDoomPath === true && c.dying === null);
  c.necroT = 0.001; T.seriesTickFx(0.01);
  ok('到期按灾厄路径死', c.dying !== null && c.dying.doom === true);
}

console.log('== G. 故障机器人（敌方 ≥75% 血期间 -75% 受伤） ==');
{
  drawWith(42, { L: 'defect', R: 'silent' });
  T.resetMatch(T.CARD_BY_ID.dark_embrace, T.CARD_BY_ID.voltaic, 42);
  const [a, b] = T.world.units;
  ok('resetMatch 后挂免伤效果', a.fxDefect === true && b.fxDefect === false);
  let v = a.damage(100, 'hit', b);
  ok('敌方满血：受 100 → 25（floor 取整）', v === 25, `v=${v}`);
  b.hp = Math.floor(b.maxHp * 0.74);
  v = a.damage(100, 'hit', b);
  ok('敌方低于 75%：恢复正常 100', v === 100, `v=${v}`);
  b.hp = Math.ceil(b.maxHp * 0.75);
  v = a.damage(100, 'hit', b);
  ok('恰好 75% 仍免伤（整数交叉相乘口径）', v === 25, `v=${v}`);
  b.hp = Math.ceil(b.maxHp * 0.75) - 1;
  v = a.damage(100, 'hit', b);
  ok('75% 差 1 点就恢复', v === 100, `v=${v}`);
  v = b.damage(100, 'hit', a);
  ok('无角色一方不受影响', v === 100, `v=${v}`);
  ok('伤害全程整数', Number.isInteger(v));
}

console.log('== H. 端到端：AI vs AI 三局两胜 ==');
{
  drawWith(66666, { L: 'ironclad', R: 'defect' });
  const S = T.SERIES;
  T.aiIroncladBurns('L');
  T.aiPicks('L'); T.aiPicks('R');
  draftInvariant('端到端');
  let done = false, guarded = 0;
  for (let r = 0; r < 3 && !done; r++) {
    const seed = T.seriesPrerollSeed(r);
    ok(`第 ${r + 1} 局预演拿到种子`, Number.isInteger(seed));
    const cl = T.CARD_BY_ID[S.picks.L[r]], cr = T.CARD_BY_ID[S.picks.R[r]];
    T.runFullMatch(cl, cr, seed);
    const w = T.world.over ? T.world.over.win : -1;
    ok(`第 ${r + 1} 局正式对局分出胜负`, w === 0 || w === 1, `win=${w}`);
    if (w === 0 || w === 1) {
      S.score[w === 0 ? 'L' : 'R']++;
      guarded++;
    }
    if (S.score.L >= 2 || S.score.R >= 2) done = true;
  }
  ok('三局内打出一方 2 胜', done && guarded >= 2 && guarded <= 3,
    `比分 ${S.score.L}:${S.score.R}`);
}

console.log('== I. 天意加身（推演扫描 / 精彩度评分） ==');
{
  drawWith(77777, { L: 'ironclad', R: 'defect' });
  const S = T.SERIES;
  /* 固定一对有来有回的卡（烘焙数据里 黑暗之拥 65% 胜 刀刃陷阱 → 50 局内几乎必有玩家胜局） */
  S.picks = { L: ['dark_embrace', 'voltaic', 'pillage'], R: ['knife_trap', 'expose', 'charge'] };
  const wins = T.seriesDestinyScan(0, 0, 50);
  ok(wins.length > 0, '50 局推演扫到玩家胜局', wins.length + ' 胜');
  ok(wins.every(w => Number.isInteger(w.seed) && w.rec.win === 0 && Number.isInteger(w.sc)),
    '胜局记录结构完整（seed/rec.win/sc 全整数口径）');
  wins.sort((a, b) => b.sc - a.sc);
  const best = wins[0];
  /* 最精彩的那颗种子必须真的能复现出玩家胜局 */
  T.runFullMatch(T.CARD_BY_ID.dark_embrace, T.CARD_BY_ID.knife_trap, best.seed);
  ok('最佳种子重演 = 玩家获胜', T.world.over && T.world.over.win === 0,
    JSON.stringify(T.world.over));
  /* 评分与对局一一对应（同 rec 同分），且分数确实由标签/逆转/残血合成 */
  const sc1 = T.destinyScore(best.rec), sc2 = T.destinyScore(best.rec);
  ok(sc1 === sc2 && sc1 === best.sc, 'destinyScore 对同一局稳定', sc1 + ' vs ' + best.sc);
  const boring = { win: 0, tags: [], behind: [0, 0], minHp: [1, 1] };
  const wild = { win: 0, tags: ['a', 'b'], behind: [0.5, 0], minHp: [0.05, 1] };
  ok(T.destinyScore(wild) > T.destinyScore(boring),
    '标签多/逆转大/胜者残血的局更"精彩"', T.destinyScore(boring) + ' → ' + T.destinyScore(wild));
}

console.log('== J. 经典模式回归 ==');
{
  const S = T.SERIES;
  S.on = false;
  T.resetMatch(T.CARD_BY_ID.dark_embrace, T.CARD_BY_ID.voltaic, 4242);
  const [a] = T.world.units;
  ok('经典模式角色字段全 falsy', !a.fxNecro && !a.fxDefect && !a.fxRegent && !a.necroPend);
  T.runFullMatch(T.CARD_BY_ID.dark_embrace, T.CARD_BY_ID.voltaic, 4242);
  ok('经典对局照常分出胜负', T.world.over && T.world.over.win !== undefined,
    JSON.stringify(T.world.over));
  ok('经典对局不受系列种子影响（种子就是本局种子）', T.world.seed === T.seedHash(4242));
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
