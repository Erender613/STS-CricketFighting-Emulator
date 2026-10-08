/* 验收：冲锋！！的仆从 AI 已按 2026-09-23 的"完全重构"重写。
 *
 * 新规格（= 本次判据）：
 *   1) 没有状态机 —— m.state 不存在、p.mSpd/mRest/restSpd/seekSpd 全 undefined、
 *      AI 从不改写 m.baseSpeed（每帧都应是 CFG.SPEED）。
 *   2) 只有一条规则：索敌范围（senseR）内看到敌人 → 加一发冲撞速度，冷却 ramCd。
 *   3) 冲撞的结束由【速度】决定：ram=true 的每一帧都必须 boost > ramEnd；
 *      boost 掉到 ramEnd 以下的那一帧 ram 立刻转 false（没有任何计时器）。
 *   4) 冲撞速度耗完后恢复正常：ram=false 的帧里 curSpeed() 必须正好等于 CFG.SPEED
 *      （即"和所有卡牌一致"，不再有 restSpd 那种低速滑行）。
 *   5) 伤害只在 ram=true 时结算，且一次冲撞最多打一下。
 *
 * 用法：node tools/_minion_ai_check.js [html路径] [对局] [秒数]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
/* 默认对位取 charge:defy —— 样本健康（约 180 仆从·秒 / 20+ 次完整冲撞）。
   别用 charge:end_of_days 当默认：末日降临会把仆从按死在冲撞途中，样本只剩十几秒。 */
const PAIR = (process.argv[3] || 'charge:defy').split(':');
const SECS = Number(process.argv[4] || 90);

const html = fs.readFileSync(HTML, 'utf8');
/* 取最大的 script 块 = 游戏逻辑（产物里还有 __BUILD__ 小标记块，不能用贪婪正则） */
const _blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = _blocks.sort((a, b) => b.length - a.length)[0];
if (!src) { console.error('找不到 script'); process.exit(1); }
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, MinionBrain, Unit };\n`;

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
/* mulberry32 必须返回 [0,1)（少一层括号会返回 [-0.5,0.5)）。 */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
}
const _selfT = mulberry32(12345);
{ const v = []; for (let i = 0; i < 1000; i++) v.push(_selfT());
  if (Math.min(...v) < 0 || Math.max(...v) >= 1) throw new Error('mulberry32 自检失败：值域不在 [0,1)'); }

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
const byId = (id) => T.CARD_BY_ID[id];
const p = byId(PAIR[0]).p;

/* 挂钩 onUnitHit：记录"这一下到底有没有真的结算伤害"（= 有没有走到 e.damage） */
let hits = 0, hitsOutsideRam = 0;
const dealt = [];                         // 每次命中实际扣了多少血
const expected = [];                      // 按当时本体血量算出的应扣值（curDmg）
const timeToHit = [];                     // 冲撞起手 → 真正撞上的耗时（判 ramEnd 窗口够不够用）
const origHit = T.MinionBrain.prototype.onUnitHit;
T.MinionBrain.prototype.onUnitHit = function (e) {
  const before = (e && typeof e.hp === 'number') ? e.hp : null;
  const want = before !== null ? this.curDmg() : null;   // 本体血量 → 伤害加成，实时读
  origHit.call(this, e);
  if (e && before !== null && e.hp < before) {
    hits++;
    dealt.push(before - e.hp);
    expected.push(want);
    if (!this.ram) hitsOutsideRam++;      // 不该发生
    if (typeof this._t0 === 'number') timeToHit.push(T.world.t - this._t0);
  }
};

/* 挂钩 knock/nudge：区分"仆从自己冲出去的"和"被敌人击退撞飞的"。
   任何卡牌被击退都会短暂超速，这不算 AI 的问题；只有"仆从自己那发冲撞的速度
   还没耗完就把 ram 关掉"才是违规。敌方机制推人只走 knock()/nudge() 这两条通道
   （pounce 那种 self-pushBoost 是加在自己身上的，不会打到仆从），所以在源头打标记最准。 */
let extKnocks = 0;
for (const fn of ['knock', 'nudge']) {
  const orig = T.Unit.prototype[fn];
  T.Unit.prototype[fn] = function (...a) {
    if (this.minion) { this._extEp = true; extKnocks++; }
    return orig.apply(this, a);
  };
}

/* ---------- 跑对局 ---------- */
T.resetMatch(byId(PAIR[0]), byId(PAIR[1]));
W.running = true;

const frames = Math.round(SECS / DT);
let liveFrames = 0, ramFrames = 0, framesInRange = 0, deadFrames = 0, ramStarts = 0;
let maxOwn = 0;
const spawnDists = [];                    // 每只仆从出生那一刻离本体的距离
let ramWithLowBoost = 0;                  // ram=true 但 boost 已 ≤ ramEnd（不该发生）
let normalSpeedBad = 0;                   // ram=false 但【自己冲撞的】速度还没耗完（不该发生）
let extBoostFrames = 0;                   // 被敌人击退/牵扯等【外因】提速的帧（合法，不算失败）
let ramEndsByDecay = 0;                   // 冲撞速度自然耗完而结束
let ramEndsByDeath = 0;                   // 仆从阵亡时仍在冲撞（尸体不再跑 update，等不到"自然结束"）
let baseSpeedBad = 0;                     // AI 改写过 baseSpeed（不该发生）
const baseSpeeds = new Set();
const ramStartGaps = [];                  // 同一只仆从两次冲撞的间隔
const ramStartDist = [];                  // 发起冲撞时与敌人的距离
const ramDurs = [];                       // ram=true 持续时长
const stateFieldSeen = new Set();         // 仆从上出现过的 m.state 值
const prevRam = new Map(), ramStartF = new Map(), lastRamStart = new Map();
const deathRecorded = new Set();          // 阵亡时仍在冲撞的仆从，只记一次
/* 冷却接线（0b）：每次 ram 起手时核对机置的 cd 是否等于 curCd()（随本体血量浮动） */
let cdWiredBad = 0, cdRangeBad = 0, cdShortened = 0;
/* 诊断：每一帧"为什么没发起冲撞"（按第一道没过的闸门归类，便于定位行为问题） */
const gate = { ramBusy: 0, cdBusy: 0, noEnemy: 0, outRange: 0, ready: 0 };

for (let f = 0; f < frames; f++) {
  W.t += DT;
  T.stepPhysics(DT);
  /* 一轮遍历所有仆从（含尸体）：
     尸体留在 world.units 里播死亡动画、不再跑 mech.update —— 如果只在"活着的"里面
     统计 ram 起止，一只"冲撞中被打死"的仆从会被永远算作"没跑完"，把判据弄假红。
     所以：ram 起止记账对【全体仆从】做，速度/伤害统计只对【活着的】做。 */
  for (const m of W.units.filter(u => u.minion)) {
    if (m.boost <= p.ramEnd) m._extEp = false;      // 这一波额外速度已经衰减干净

    const ram = !!(m.mech && m.mech.ram);
    const ps = prevRam.has(m) ? prevRam.get(m) : false;   // 新出现的仆从当"上一帧没在冲撞"（出生即冲也算上）

    /* --- ram 起止记账（全体仆从） --- */
    if (!ps && ram) {
      ramStarts++;
      m._extEp = false;                            // 冷却 0 时加的那一发是它自己冲的，撤销外力标记
      const st = lastRamStart.get(m);
      if (st !== undefined) ramStartGaps.push((f - st) * DT);
      lastRamStart.set(m, f);
      ramStartF.set(m, f);
      m.mech._t0 = W.t;                            // 记账：这一发的起手时刻
      /* 起手这一刻机置的冷却应等于 curCd()（MinionBrain.update 的最后一句刚写完它） */
      const wantCd = m.mech.curCd();
      if (Math.abs(m.mech.cd - wantCd) > 1e-9) cdWiredBad++;
      if (m.mech.cd < p.ramCd - p.cdCut - 1e-9 || m.mech.cd > p.ramCd + 1e-9) cdRangeBad++;
      if (m.mech.cd < p.ramCd - 1e-9) cdShortened++;
      const e0 = W.enemyOf(m);
      if (e0) ramStartDist.push(Math.hypot(e0.x - m.x, e0.y - m.y));
    }
    if (ps && !ram) {
      ramEndsByDecay++;
      if (ramStartF.has(m)) { ramDurs.push((f - ramStartF.get(m)) * DT); ramStartF.delete(m); }
    }
    prevRam.set(m, ram);

    /* --- 以下只统计活着的仆从（分母不能被尸体抬高一个量级） --- */
    if (!m.alive || m.dying) {
      deadFrames++;
      if (ps && !deathRecorded.has(m)) { ramEndsByDeath++; deathRecorded.add(m); }
      continue;
    }
    liveFrames++;
    if (m.state !== undefined) stateFieldSeen.add(String(m.state));
    if (typeof m.baseSpeed === 'number') baseSpeeds.add(Math.round(m.baseSpeed));
    if (m.baseSpeed !== CFG.SPEED) baseSpeedBad++;

    const hd = Math.hypot(m.o.x - m.x, m.o.y - m.y);
    if (hd > maxOwn) maxOwn = hd;
    if (!m._seen) { m._seen = true; spawnDists.push(hd); }   // 出生那一刻离本体多远

    const me = m.mech;
    if (ram) {
      ramFrames++;
      if (m.boost <= p.ramEnd) ramWithLowBoost++;
    } else if (m.boost > p.ramEnd) {      /* ram 之外还有剩余速度：要么是外力（被击退），要么是它自己的冲撞速度没耗完就提前结束。
         后者才是违规 —— 引擎的 boost 衰减是统一的，所以"自己那一发"绝不可能还剩着就变回普通单位。 */
      if (m._extEp) extBoostFrames++;
      else normalSpeedBad++;
    }

    /* 闸门归类（照抄 MinionBrain.update 的判断顺序） */
    const e = W.enemyOf(m);
    if (me.ram) gate.ramBusy++;
    else if (me.cd > 0) gate.cdBusy++;
    else if (!e) gate.noEnemy++;
    else if (Math.hypot(e.x - m.x, e.y - m.y) > p.senseR) gate.outRange++;
    else gate.ready++;
    if (e && !e.dying && Math.hypot(e.x - m.x, e.y - m.y) <= p.senseR) framesInRange++;
  }
  if (!W.units.some(u => u.alive && !u.minion && !u.dying)) break;
}

/* ---------- 报表 ---------- */
const liveSecs = Math.max(1e-6, liveFrames * DT);
const perMinHits = hits / (liveSecs / 60);
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const minOf = a => a.length ? Math.min(...a) : NaN;
const checks = [];
const ok = (name, cond, detail) => { checks.push(cond); console.log(`  ${cond ? '✓' : '✗'} ${name}  ${detail}`); };

const badParams = ['mSpd', 'mRest', 'restSpd', 'seekSpd', 'leashR']
  .filter(k => p[k] !== undefined);

console.log(`对局 ${PAIR.join(' vs ')}   活的仆从帧 ${liveFrames}（≈ ${liveSecs.toFixed(0)} 仆从·秒；另有尸体帧 ${deadFrames}）`);
console.log(`参数：ramCd=${p.ramCd}(-${p.cdCut}) ramSpd=${p.ramSpd} ramEnd=${p.ramEnd} mHp=${p.mHp} mDmg=${p.mDmg}(+${p.dmgBonus}) senseR=${p.senseR}\n`);

console.log('=== 0. 卡面数值 ===');
ok('仆从生命 = mHp', p.mHp === 300, `mHp=${p.mHp}（2026-09-23 改为 300）`);
ok('满血伤害 = 35（用户要求）', p.mDmg === 35, `mDmg=${p.mDmg}`);
ok('血量加成上限：伤害 +100% / 冷却 -0.6s（用户要求）',
  p.dmgBonus === 1.0 && p.cdCut === 0.6, `dmgBonus=${p.dmgBonus} cdCut=${p.cdCut}（满血 ${p.mDmg} → 濒死 ${(p.mDmg * (1 + p.dmgBonus)).toFixed(0)}；冷却 ${p.ramCd}s → 濒死 ${(p.ramCd - p.cdCut).toFixed(1)}s）`);
ok('生成位置离本体一小段距离（不在身上）',
  spawnDists.length === 0 || Math.min(...spawnDists) >= p.spawnDist * 0.7,
  spawnDists.length ? `最近 ${Math.min(...spawnDists).toFixed(0)}px / 平均 ${(spawnDists.reduce((a, b) => a + b, 0) / spawnDists.length).toFixed(0)}px（spawnDist=${p.spawnDist}，共 ${spawnDists.length} 只）`
                    : '本对位没有新生成（用已有仆从跑的）');
/* 每一击都应该 = curDmg()（按当时本体血量）；目标血量不足时是斩杀，扣血 < 应扣值 */
const dmgSet = [...new Set(dealt.map(d => Math.round(d)))];
const dmgBad = dealt.filter((d, i) => d <= 0 || d > expected[i] + 0.5).length;
const dMax = dealt.length ? Math.max(...dealt) : 0;
ok('每次撞击的伤害 = 本体血量对应的加成值（斩杀时更小）',
  hits === 0 || (dmgBad === 0 && dMax <= p.mDmg * (1 + p.dmgBonus) + 1e-6),
  hits ? `实测扣血 ${dmgSet.join(' / ')}（范围 ${Math.min(...dealt).toFixed(1)}~${dMax.toFixed(1)}，满血基准 ${p.mDmg}，濒死上限 ${(p.mDmg * (1 + p.dmgBonus)).toFixed(0)}），共 ${hits} 次`
       : '本对位没打出撞击');

/* ---- 0b. 冲撞冷却随本体血量缩短（2026-09-27）----
   这条加成一度只是"写好了没接线"：curCd() 定义在那儿，update 里却直接写 p.ramCd，
   于是冷却恒为 2.1s 而所有测试都过（间隔下限 1.5s 是"至少"，永远满足）。
   现在两头都钉住：① 纯函数口径；② 运行时 ram 起手那一刻机置的冷却必须 = curCd()。 */
console.log('\n=== 0b. 冲撞冷却随本体血量缩短（最多 -' + p.cdCut + 's） ===');
{
  const stub = { o: { hp: 1000, maxHp: 1000 } };
  const brain = new T.MinionBrain(stub, p);
  const cdAt = (frac) => { stub.o.hp = frac * stub.o.maxHp; return brain.curCd(); };
  const full = cdAt(1), half = cdAt(0.5), dead = cdAt(0);
  let monoOk = true, prevCd = Infinity, minCd = Infinity, maxCd = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const c = cdAt(1 - i / 20);            // 满血 → 濒死：冷却应当一路不增
    if (c > prevCd + 1e-9) monoOk = false;
    prevCd = c; minCd = Math.min(minCd, c); maxCd = Math.max(maxCd, c);
  }
  const cut = +(p.ramCd - minCd).toFixed(3);
  ok(`满血冷却 = ramCd(${p.ramCd})s`, full === p.ramCd, `实测 ${full}s`);
  ok(`濒死冷却 = ramCd - cdCut = ${(p.ramCd - p.cdCut).toFixed(1)}s`, dead === +(p.ramCd - p.cdCut).toFixed(1),
    `本体 0 血实测 ${dead}s；半血 ${half}s`);
  ok('冷却随已损失生命单调下降', monoOk, `扫描 21 个血量点：${maxCd}s → ${minCd}s`);
  ok(`缩短量正好封在 ${p.cdCut}s`, Math.abs(cut - p.cdCut) < 1e-9, `实测最多缩短 ${cut}s`);
  ok('运行时每次冲撞都按 curCd() 设冷却（加成真的接上了）',
    cdWiredBad === 0 && cdRangeBad === 0,
    `冲撞起手 ${ramStarts} 次：与 curCd() 不符 ${cdWiredBad} 次、越出 [${(p.ramCd - p.cdCut).toFixed(1)}, ${p.ramCd}] ${cdRangeBad} 次；` +
    `其中真正被缩短过 ${cdShortened} 次`);
}

console.log('=== 1. 没有状态机 ===');
ok('仆从上从未出现 m.state 字段', stateFieldSeen.size === 0,
  `出现过的值：${[...stateFieldSeen].join(',') || '(无)'}`);
ok('旧状态机参数已全部删除', badParams.length === 0,
  badParams.length ? `残留：${badParams.join(',')}` : 'mSpd/mRest/restSpd/seekSpd/leashR 全 undefined');
ok('AI 从不改写 baseSpeed', baseSpeedBad === 0,
  `出现过的 baseSpeed：${[...baseSpeeds].sort((a, b) => a - b).join(' / ')}（CFG.SPEED=${CFG.SPEED}）`);

console.log(`\n=== 2. 冲撞 = 索敌范围内的一发速度，冷却 ${(p.ramCd - p.cdCut).toFixed(1)}~${p.ramCd}s（按本体血量） ===`);
console.log(`  冲撞起手 ${ramStarts} 次 → ${(ramStarts / (liveSecs / 60)).toFixed(1)} 次/分钟`);
console.log(`  在 senseR(${p.senseR}px) 内的时间占比 ${(framesInRange / liveFrames * 100).toFixed(1)}%`);
console.log(`  闸门归类（占活仆从帧%）：冲撞中 ${(gate.ramBusy / liveFrames * 100).toFixed(1)}% / ` +
  `冷却中 ${(gate.cdBusy / liveFrames * 100).toFixed(1)}% / 圈外 ${(gate.outRange / liveFrames * 100).toFixed(1)}% / ` +
  `可发起 ${(gate.ready / liveFrames * 100).toFixed(1)}%`);
if (ramStartDist.length) {
  console.log(`  发起时距敌 平均 ${avg(ramStartDist).toFixed(0)}px / 最远 ${Math.max(...ramStartDist).toFixed(0)}px`);
}
ok('每次冲撞都发生在索敌范围内', ramStartDist.length === 0 || Math.max(...ramStartDist) <= p.senseR + 1,
  `最远 ${ramStartDist.length ? Math.max(...ramStartDist).toFixed(1) : '-'}px ≤ ${p.senseR}px`);
ok(`两次冲撞间隔 ≥ ${(p.ramCd - p.cdCut).toFixed(1)}s（冷却下限）`, ramStartGaps.length === 0 || minOf(ramStartGaps) >= p.ramCd - p.cdCut - 1e-6,
  `最短间隔 ${ramStartGaps.length ? minOf(ramStartGaps).toFixed(2) : '-'}s（本体血量决定实际冷却 ${(p.ramCd - p.cdCut).toFixed(1)}~${p.ramCd}s）`);

console.log('\n=== 3. 冲撞的结束由【速度】决定，没有计时器 ===');
console.log(`  ram=true 占 ${(ramFrames / liveFrames * 100).toFixed(1)}% 的帧；单次冲撞平均 ${avg(ramDurs).toFixed(2)}s`);
ok('ram=true 的帧里 boost 一律 > ramEnd', ramWithLowBoost === 0,
  `${ramWithLowBoost} 帧 boost ≤ ${p.ramEnd}`);
ok('ram 至少被真正跑完过（能自然结束）', ramEndsByDecay > 0 || ramEndsByDeath > 0,
  `自然结束 ${ramEndsByDecay} 次` + (ramEndsByDeath ? ` / 另有 ${ramEndsByDeath} 次是"冲撞中阵亡"` : '')
  + (ramEndsByDecay === 0 && ramEndsByDeath > 0
    ? '  ⚠ 本对位样本不足（仆从全在冲撞途中被打死），换个对手再验一次' : ''));

console.log('\n=== 4. 速度耗完后恢复正常行动（和所有卡牌一致）===');
ok('ram=false 时自己那发冲撞速度必已耗完', normalSpeedBad === 0,
  `${normalSpeedBad} 帧残留（另 ${extBoostFrames} 帧是被敌人击退等外因提速，已排除 / ` +
  `全场合计外力击退 ${extKnocks} 次）`);

console.log('\n=== 5. 伤害只在冲撞中结算，一次冲撞一下 ===');
console.log(`  命中 ${hits} 次 → ${perMinHits.toFixed(1)} 次/分钟`);
if (timeToHit.length) {
  console.log(`  起手→撞上 平均 ${avg(timeToHit).toFixed(2)}s / 最慢 ${Math.max(...timeToHit).toFixed(2)}s` +
    `（ramEnd=${p.ramEnd} 的窗口约 ${(Math.log(p.ramSpd / p.ramEnd) / 1.4).toFixed(2)}s）`);
}
ok('ram=false 时从未结算过伤害', hitsOutsideRam === 0, `${hitsOutsideRam} 次越权结算`);

console.log(`\n  附：仆从跑得最远距本体 ${maxOwn.toFixed(0)}px（本卡没有拴绳，不会被召回）`);

const fail = checks.filter(c => !c).length;
console.log('\n' + (fail ? `✗ 失败 ${fail} 项` : `✓ 全部通过：仆从 AI = 普通单位 + 索敌范围冲撞(${p.ramCd}s 冷却，按本体血量缩到 ${(p.ramCd - p.cdCut).toFixed(1)}s)`));
process.exit(fail ? 1 : 0);
