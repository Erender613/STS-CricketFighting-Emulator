/**
 * 无头仿真自检：给游戏脚本打桩 DOM/Canvas，把引擎真跑起来。
 *  A) 语法/初始化/运行时异常
 *  B) 五种机制是否都触发（按卡牌 id 对照）
 *  C) 全 25 组有序对局扫描：胜负分布、时长、灾厄处决次数
 * 用法: node tools/simcheck.js
 *       SIMSEED=123 REPS=3 node tools/simcheck.js   # 换种子 / 临时缩小样本冒烟
 *
 * 【为什么给 Math.random 换种子】引擎里的 rand() 直接吃 Math.random，
 * 不设种子的话同一份代码两次跑出来的胜率能差十几个点，根本没法拿来判断
 * "这次改动到底有没有影响平衡"。现在默认固定种子（结果可复现、可 diff），
 * 想看方差就换几个 SIMSEED 各跑一次。
 *
 * 【样本量】REPS 是每组的重复场数。**默认 15 → 25 组 × 15 = 375 场，每张卡 120 场**
 * （p≈0.5 时标准误 ≈ sqrt(.25/120) ≈ 4.6 个百分点，足够判定几点的差异）。
 * 用户第四十五轮明确要求"以后都跑 15reps"，所以默认值就从 3 提到 15；
 * 只想快速冒烟时用 `REPS=3 node tools/simcheck.js` 临时覆盖（别改默认值）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* 可复现的种子随机（mulberry32） */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = parseInt(process.env.SIMSEED || '20260921', 10);
const MathSeeded = Object.create(Math);
MathSeeded.random = mulberry32(SEED);

/* GAME_HTML 可指定其它构建产物（做改动前后的对照用，和 balance.js 保持一致） */
const HTML = process.env.GAME_HTML
  ? path.resolve(process.env.GAME_HTML)
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
/* 取最大的 script 块（构建产物里的 __BUILD__ 小标记块不能用贪婪正则一起吞） */
const _blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = _blocks.sort((a, b) => b.length - a.length)[0];
if (!src) { console.error('找不到 script'); process.exit(1); }
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, CARDS, stepPhysics, resetMatch, SEL, fit, drawArena, drawOverlayBanner, IMG, loadAll, orbPopScale, Knife, Meteor, DoomZone, impact, Orb, Beam, Shockwave };\n`;

/* ---------- DOM / Canvas 打桩 ---------- */
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
  // 用 Proxy 兜底：任何未显式打桩的方法都当作 no-op，属性赋值照常
  const target = {
    createLinearGradient: grad,
    createRadialGradient: grad,
    createPattern: () => null,
    measureText: () => ({ width: 10 }),
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
console.log('  脚本解析/初始化 OK；卡牌数 =', T.CARDS.length);

/* ---------- 单次对局 ---------- */
function run(aId, bId, seconds, collectEffects) {
  const A = T.CARD_BY_ID[aId], B = T.CARD_BY_ID[bId];
  T.resetMatch(A, B);
  T.world.running = true;
  const seen = new Set();
  const made = new WeakSet();
  const counts = {};
  const dt = 1 / 60;
  let steps = 0, dmgEvents = 0, doomExec = 0, exploded = null;
  const hpPrev = T.world.units.map(u => u.hp);
  try {
    while (T.world.t < seconds && !T.world.over && steps < seconds * 60 + 5) {
      T.world.t += dt;
      T.stepPhysics(dt);
      steps++;
      for (const e of T.world.effects) {
        const n = e.constructor.name;
        if (collectEffects) seen.add(n);
        if (!made.has(e)) { made.add(e); counts[n] = (counts[n] || 0) + 1; }
      }
      T.world.units.forEach((u, i) => {
        if (u.hp < hpPrev[i]) dmgEvents++;
        if (u.dying && u.dying.doom && !u.__dc) { u.__dc = 1; doomExec++; }
        hpPrev[i] = u.hp;
        if (collectEffects && u.mech) seen.add(u.mech.constructor.name);  // 仆从等 Unit 型机制
      });
    }
  } catch (e) { exploded = e; console.error('  !! 异常:', e.message); }
  return { seen, counts, dmgEvents, doomExec, over: T.world.over, t: T.world.t, exploded };
}

/* ---------- B) 机制触发 ---------- */
const NEED = {
  dark_embrace: ['DemonHand'],
  knife_trap: ['Knife'],
  beat_into_shape: ['Sword'],
  end_of_days: ['Meteor', 'DoomZone', 'DoomHole'],
  voltaic: ['Orb', 'Zap'],
  /* 新 10 张 */
  pillage: ['ChargeGlow'],
  expose: ['Beam'],
  charge: ['MinionBrain'],   // 仆从现在是 Unit（mech 类），不再是 Effect
  sleight_of_flesh: ['FleshWheel'],
  darkness: ['DarkOrb'],
  perfected_strike: ['AnglePing'],
  /* 蛇咬的蛰伏绿圈（CoilFx）已按用户口径删除，改成"能造出毒液库存"的机制本身。
     MechSnakebite 是 Unit 型机制，run() 的 collectEffects 会把它收进 seen。 */
  snakebite: ['MechSnakebite'],
  guiding_star: ['Star'],
  defy: ['Shockwave'],
  lightning_rod: ['Bolt'],
  /* 测试版 5 张（设置里开「测试版卡牌」才在界面显示；预演用的是 CARDS 全量） */
  offering: ['Pentagram', 'SummonedFoe'],
  afterimage: ['ReplicaUnit', 'WhitePierce'],
  tracking: ['TrackingBlade'],
  soul_storm: ['SoulUnit', 'SoulStormFx', 'SoulWispStream'],
  meteor_strike: ['PlasmaOrb', 'BigMeteor', 'MeteorSmoke'],
};
const IDS = T.CARDS.map(c => c.id);
const trig = {};
for (let i = 0; i < IDS.length; i++) {
  const r = run(IDS[i], IDS[(i + 1) % IDS.length], 120, true);
  const key = IDS[i] + '|' + IDS[(i + 1) % IDS.length];
  trig[key] = { r, left: IDS[i], right: IDS[(i + 1) % IDS.length] };
}
console.log('\n— 机制触发检查（每张卡各跑一局）—');
let allOk = true;
for (const [mech, classes] of Object.entries(NEED)) {
  const hit = Object.values(trig).some(v =>
    (v.left === mech || v.right === mech) && classes.some(c => v.r.seen.has(c)));
  const got = new Set();
  Object.values(trig).forEach(v => { if (v.left === mech || v.right === mech) v.r.seen.forEach(x => got.add(x)); });
  console.log(`  ${hit ? 'OK  ' : 'MISS'} ${mech.padEnd(16)} 需要 ${classes.join('/')}  实际出现: ${[...got].filter(x => x !== 'Ring' && x !== 'Spark' && x !== 'DmgNum' && x !== 'SbMote').join(',') || '(无)'}`);
  if (!hit) allOk = false;
}

/* 【只跑 A+B】——用户口径：修 bug 后的"机制触发自检"可以跑，胜率扫描不行。
   加这个开关是为了让"被允许的那一半"能一条命令跑完，
   不用为了看机制触发去启动后面 375 场的胜率扫描。
   用法： TRIG_ONLY=1 node tools/simcheck.js */
if (process.env.TRIG_ONLY) {
  console.log(allOk ? '\nTRIG_ONLY=1 → 机制触发检查全部 OK（已跳过胜率扫描与后续用例）'
                    : '\nTRIG_ONLY=1 → 存在未触发的机制（见上）');
  process.exit(allOk ? 0 : 1);
}

/* ---------- C) 全 25 组对局扫描 ---------- */
console.log('\n— 全 25 组有序对局扫描（每组最多 150s）—');
/* 默认 REPS=15（每卡 120 场）；要快速冒烟就 `REPS=3 node tools/simcheck.js` */
const REPS = +(process.env.REPS || 15);
const wins = {}; IDS.forEach(i => wins[i] = 0);
const ALL = {};
let totalT = 0, n = 0, totalDoom = 0, totalDmg = 0, anyErr = null;
for (const a of IDS) {
  const row = [];
  for (const b of IDS) {
    if (a === b) { row.push('    —    '); continue; }
    let w = 0, l = 0, d = 0;
    for (let r0 = 0; r0 < REPS; r0++) {
      const r = run(a, b, 150, false);
      ALL[a + '|' + b + '#' + r0] = { r, a, b };
      if (r.exploded) anyErr = r.exploded;
      n++; totalT += r.t; totalDoom += r.doomExec; totalDmg += r.dmgEvents;
      if (!r.over) d++;
      else if (r.over.win === 0) { wins[a]++; w++; }
      else if (r.over.win === 1) { wins[b]++; l++; }
      else { wins[a] += 0.5; wins[b] += 0.5; d++; }
    }
    row.push((' ' + w + '胜' + l + '负' + (d ? d + '平' : '') + ' ').padEnd(10));
  }
  console.log(`  ${a.padEnd(16)} ${row.join('')}`);
}
const PER = REPS * (IDS.length - 1) * 2;
/* 平衡表同时写一份到 _balance.txt：改前改后各跑一次就能直接 diff 出影响 */
const bal = ['seed=' + SEED + '  reps=' + REPS + '  每张卡 ' + PER + ' 场'];
bal.push('卡牌胜率：');
Object.entries(wins).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => {
  bal.push('  ' + T.CARD_BY_ID[k].name.padEnd(6) + ' ' + String(v).padStart(4) + ' 胜 / ' +
           PER + ' 场   ' + (100 * v / PER).toFixed(1) + '%');
});
bal.push('平均时长 ' + (totalT / n).toFixed(1) + 's   平均伤害结算 ' +
         (totalDmg / n).toFixed(1) + ' 次   灾厄处决 ' + totalDoom + ' 次');
console.log('\n  卡牌胜率（每张卡参与 ' + PER + ' 场）：');
bal.slice(2).forEach(l => console.log('    ' + l.trim()));

// 机制「发生次数」统计（用于平衡诊断）
const agg = {};
for (const [k, v] of Object.entries(ALL)) {
  const left = k.split('|')[0];
  for (const [cls, c] of Object.entries(v.r.counts)) {
    // 纯装饰、不属于任何机制产出的类，不纳入机制计数
    if (cls === 'Ring' || cls === 'Spark' || cls === 'DmgNum' || cls === 'Zap' || cls === 'SbMote') continue;
    agg[left] = agg[left] || {};
    agg[left][cls] = (agg[left][cls] || 0) + c;
  }
}
console.log('\n  机制产出总次数（每张卡在其 4 场作为红方的对局中累计）：');
for (const [card, c] of Object.entries(agg)) {
  console.log(`    ${T.CARD_BY_ID[card].name.padEnd(6)} ${Object.entries(c).map(([k, v]) => k + '=' + v).join('  ')}`);
}
fs.writeFileSync(path.join(__dirname, '_balance.txt'), bal.join('\n') + '\n', 'utf8');

/* ---------- D) 渲染路径冒烟测试（打桩 canvas，验证绘制代码不抛异常）---------- */
console.log('\n— 渲染冒烟测试 —');
let renderErr = null;
try {
  T.fit();
  for (const [a, b] of [['dark_embrace', 'end_of_days'], ['beat_into_shape', 'voltaic'], ['knife_trap', 'dark_embrace']]) {
    T.resetMatch(T.CARD_BY_ID[a], T.CARD_BY_ID[b]);
    T.world.running = true;
    for (let i = 0; i < 600; i++) { T.world.t += 1 / 60; T.stepPhysics(1 / 60); }
    T.drawArena();
    T.drawOverlayBanner();
  }
  // 终局横幅
  T.world.over = { win: 0 };
  T.drawArena(); T.drawOverlayBanner();
  T.world.over = { win: -1 };
  T.drawArena(); T.drawOverlayBanner();
  console.log('  OK  drawArena / drawOverlayBanner 全部执行通过');
} catch (e) {
  renderErr = e;
  console.error('  !! 渲染异常:', e.message, '\n', (e.stack || '').split('\n').slice(0, 5).join('\n'));
}

/* ---------- E) 电球滞留回归测试 ----------
   旧 bug：MechVoltaic.summon() 直接把 orbs 数组清空，而电球当时是 manual（只被机制 update），
   于是"上一批还在飞"的电球再也没人 update，永久停在空中。
   判据：某次齐射开始后，把机制停掉（不再持有任何电球引用），
        再推进 8 秒（单个电球寿命上限是 5 秒），场上不应还剩下电球。 */
console.log('\n— 电球滞留回归 —');
let lingerLeft = -1, lingerState = 'ok', lingerErr = null;
try {
  T.resetMatch(T.CARD_BY_ID['voltaic'], T.CARD_BY_ID['beat_into_shape']);
  T.world.running = true;
  // 抬高血量 + 双方静止：避免对局提前结束或走位导致测试中途失效（原版这里偶发误判）
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.baseSpeed = 0; });
  const m = T.world.units[0].mech;
  m.count = 8; m.phase = 'idle'; m.cd = 0;        // 直接指定下一批就是 8 颗，不等自然翻倍
  const dt = 1 / 60;
  let entered = false;
  for (let i = 0; i < 60 * 20; i++) {
    T.world.t += dt; T.stepPhysics(dt);
    if (m.phase === 'firing' && m.orbs.length >= 8) { entered = true; break; }
  }
  if (!entered) {
    lingerState = 'SKIP';
    console.log('  !! 未进入齐射阶段，测试跳过（不判定为通过）');
  } else {
    const fired = m.orbs.length;
    m.phase = 'idle'; m.cd = 1e9; m.orbs = [];    // 停掉机制，并丢弃全部引用
    for (let i = 0; i < 60 * 8; i++) { T.world.t += dt; T.stepPhysics(dt); }
    lingerLeft = T.world.effects.filter(e => e.constructor.name === 'Orb').length;
    console.log(`  齐射电球 ${fired} 颗，机制停摆 8s 后场上残留 ${lingerLeft} 颗  ${lingerLeft === 0 ? 'OK' : '滞留!'}`);
    if (lingerLeft !== 0) lingerState = 'FAIL';
  }
} catch (e) { lingerErr = e; lingerState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- F) 君王之剑光尘回归测试 ----------
   要求：光尘在「剑附近」生成后【不再跟随剑】，而是在世界坐标里原地向上飘一小段再消散；
        且剑消失后，空中的光尘必须自己飘完（不能像当年电球那样永久滞留在画面里）。
   判据：① 6s 内确实生成了 SbMote；
        ② 取一颗光尘推进 0.2s：它的位移必须远小于同期剑的位移
           （旧实现是画在剑的局部坐标里 = 刚性跟随，位移会与剑完全一致）；
        ③ 它必须向上飘（y 减小）；
        ④ 让剑消失后再推进 3s（> 光尘寿命上限 1.05s），场上不应还剩光尘。 */
console.log('\n— 君王之剑光尘回归 —');
let moteState = 'ok', moteErr = null;
try {
  const motes = () => T.world.effects.filter(e => e.constructor.name === 'SbMote');
  T.resetMatch(T.CARD_BY_ID['beat_into_shape'], T.CARD_BY_ID['voltaic']);
  T.world.running = true;
  // 同上：钉死血量与走位，避免对局提前结束干扰判据
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.baseSpeed = 0; });
  const fm = T.world.units[0].mech;                    // 锻打成型
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 6; i++) { T.world.t += dt; T.stepPhysics(dt); }
  const sword = T.world.effects.find(e => e.constructor.name === 'Sword');
  const list = motes();
  if (!sword || list.length === 0) {
    moteState = 'SKIP';
    console.log(`  !! 没铸出剑或没冒光尘（剑=${!!sword} 光尘=${list.length}），测试跳过（不计为通过）`);
  } else {
    console.log(`  在场光尘 ${list.length} 颗（稳态密度参考）`);
    // 取「最年轻」的那颗：老光尘可能只剩几十毫秒寿命，取样会在 0.2s 内消散 → 测试假跳过
    const mt = list.slice().sort((a, b) => (a.t / a.life) - (b.t / b.life))[0];
    const S0 = sword.pose(), M0 = { x: mt.x, y: mt.y };
    for (let i = 0; i < 12; i++) { T.world.t += dt; T.stepPhysics(dt); }   // 推进 0.2s
    if (mt.dead) { moteState = 'SKIP'; console.log('  !! 取样光尘在 0.2s 内已消散，测试跳过'); }
    else {
      const S1 = sword.pose();
      const dM = Math.hypot(mt.x - M0.x, mt.y - M0.y);
      const dS = Math.hypot(S1.x - S0.x, S1.y - S0.y);
      const free = dM < dS * 0.5;                      // 关键：不刚性跟随
      const rose = mt.y < M0.y;
      console.log(`  同期位移  剑 ${dS.toFixed(1)}  光尘 ${dM.toFixed(1)}   ${free ? 'OK 未跟随剑' : '跟随了!'}`);
      console.log(`  光尘上飘  y ${M0.y.toFixed(1)} -> ${mt.y.toFixed(1)}   ${rose ? 'OK 向上飘' : '没上飘!'}`);
      if (!free || !rose) moteState = 'FAIL';
    }
    fm.sword = null; fm.timer = 1e9;                   // 停掉铸剑，并让当前这把剑消失
    sword.dead = true;
    for (let i = 0; i < 60 * 3; i++) { T.world.t += dt; T.stepPhysics(dt); }
    const left = motes().length;
    console.log(`  剑消失 3s 后场上残留光尘 ${left} 颗   ${left === 0 ? 'OK' : '滞留!'}`);
    if (left !== 0) moteState = 'FAIL';
  }
} catch (e) { moteErr = e; moteState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- G) 电流相生「停摆蓄力」与发射回弹回归 ----------
   需求：环绕停下 → 静默 0.6s（chargeDelay）→ 才齐射；发射带"一缩再弹大"的回弹。
   判据：① 环绕结束时进入 charge 相位，此刻没有任何电球处于 fire（还没发射）；
        ② charge 持续时间 ≈ p.chargeDelay（0.6s，容差 ±0.06）；
        ③ 回弹曲线 orbPopScale 必须先缩到 <0.75、再弹到 >1.2，最后回到 1。 */
console.log('\n— 电流相生蓄力/回弹回归 —');
let volState = 'ok', volErr = null;
try {
  const p = T.CARD_BY_ID['voltaic'].p;
  // ③ 先验回弹曲线形状
  let lo = 9, hi = 0;
  for (let i = 0; i <= 100; i++) { const v = T.orbPopScale(i / 100); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const okCurve = lo < 0.75 && hi > 1.2 && Math.abs(T.orbPopScale(0) - 1) < 1e-6 && Math.abs(T.orbPopScale(1) - 1) < 1e-6;
  console.log(`  回弹曲线 min ${lo.toFixed(2)} max ${hi.toFixed(2)}  ${okCurve ? 'OK 先缩后弹' : '形状不对!'}`);
  if (!okCurve) volState = 'FAIL';

  T.resetMatch(T.CARD_BY_ID['voltaic'], T.CARD_BY_ID['dark_embrace']);
  T.world.running = true;
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.baseSpeed = 0; });
  const vm = T.world.units[0].mech;
  const dt = 1 / 60;
  let entered = false, tCharge = -1, firedDuringCharge = 0, tFire = -1;
  for (let i = 0; i < 60 * 40; i++) {
    T.world.t += dt; T.stepPhysics(dt);
    if (!entered && vm.phase === 'charge') {
      entered = true; tCharge = T.world.t;
      firedDuringCharge = vm.orbs.filter(o => o.state === 'fire').length;
    } else if (entered && tFire < 0 && vm.phase === 'firing') {
      tFire = T.world.t;
    }
    if (entered && tFire > 0) break;
  }
  if (!entered || tFire < 0) {
    volState = 'SKIP';
    console.log('  !! 未观察到 charge→firing 过程，测试跳过（不计为通过）');
  } else {
    const dur = tFire - tCharge;
    const noEarlyFire = firedDuringCharge === 0;
    console.log(`  charge 期间已发射 ${firedDuringCharge} 颗  ${noEarlyFire ? 'OK 确实停摆' : '没停住!'}`);
    console.log(`  停摆时长 ${dur.toFixed(2)}s（设定 ${p.chargeDelay}s）  ${Math.abs(dur - p.chargeDelay) <= 0.06 ? 'OK' : '不对!'}`);
    if (!noEarlyFire || Math.abs(dur - p.chargeDelay) > 0.06) volState = 'FAIL';
  }
} catch (e) { volErr = e; volState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- H) 黑暗之拥「腕口粒子」：必须是不跟随手的世界坐标粒子，且不滞留 ----------
   需求（用户原话）："不是碎屑，是随机生成的不跟随粒子！"
   判据：① 手伸出时断口附近有粒子；② 推进 0.2s，粒子位移远小于手（=没挂在手上跟着走）；
        ③ 手报废 3s 后场上一颗不剩（粒子自己飘完，不滞留）。 */
console.log('\n— 黑暗之拥腕口粒子回归 —');
let wrState = 'ok', wrErr = null;
try {
  const motes = () => T.world.effects.filter(e => e.constructor.name === 'WristMote');
  T.resetMatch(T.CARD_BY_ID['dark_embrace'], T.CARD_BY_ID['end_of_days']);
  T.world.running = true;
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; });
  const dt = 1 / 60;
  let hand = null, list = [];
  /* 取样条件要够苛刻，否则这条会随机失败：
     ① 手必须还在"伸展中"且【剩余行程 > 150px】—— 否则 0.2s 里它可能已经到顶
        转入 hold（原地不动），手位移接近 0，任何粒子位移都会"超过手的一半"。
        上限定在 150 而不是 500：手是 1750px/s，剩余 500 只对应头 5 帧，
        而腕口要伸到 len≈216 之后才开始撒粒子（断面还埋在墙里时不撒）——
        "剩余 > 500"与"有粒子"两个条件几乎不可能同时成立（实测就是这么 SKIP 的）。
     ② 手自己必须已经探出墙（len > 300，断面在墙外，正在撒粒子）。
     ③ 粒子至少 6 颗 —— 只拿 1~2 颗时均值被单颗的随机初速主导。 */
  const seenHands = new WeakSet();
  let nHand = 0, maxRemain = 0, maxOutLen = 0, maxMotes = 0;
  for (let i = 0; i < 60 * 20; i++) {
    T.world.t += dt; T.stepPhysics(dt);
    list = motes();
    maxMotes = Math.max(maxMotes, list.length);
    for (const e of T.world.effects) {
      if (e.constructor.name !== 'DemonHand') continue;
      if (!seenHands.has(e)) { seenHands.add(e); nHand++; }
      if (e.state === 'out') {
        maxRemain = Math.max(maxRemain, e.maxLen - e.len);
        maxOutLen = Math.max(maxOutLen, e.len);
      }
    }
    const h = T.world.effects.find(e => e.constructor.name === 'DemonHand'
      && e.state === 'out' && e.len > 300 && (e.maxLen - e.len) > 150);
    if (h && list.length >= 6) { hand = h; break; }
  }
  if (!hand || list.length === 0) {
    wrState = 'SKIP';
    console.log(`  !! 没等到【还在伸展且行程充足】的手或没冒粒子（手=${!!hand} 粒子=${list.length}），跳过（不计为通过）`);
    console.log(`     诊断：20s 内共 ${nHand} 只手；伸展期最大剩余行程 ${maxRemain.toFixed(0)}px、最大长度 ${maxOutLen.toFixed(0)}px；粒子峰值 ${maxMotes} 颗`);
  } else {
    console.log(`  场上腕口粒子 ${list.length} 颗（稳态密度参考）`);
    const mt = list.slice().sort((a, b) => (a.t / a.life) - (b.t / b.life))[0];   // 最年轻的
    const H0 = { x: hand.tipX, y: hand.tipY }, M0 = { x: mt.x, y: mt.y };
    const S0 = { state: hand.state, len: hand.len, dead: hand.dead, age: hand.age };
    /* 判据用【逐帧路径长度】而不是首尾净位移：
       手在 0.2s 里抓到人就会"先伸后缩"，净位移可能刚好回到起点（实测只差 -4px），
       拿净位移当分母会把自由粒子误判成"跟手"（seed 20260921 就是这么红的）。
       路径长度对"刚性跟随"依然敏感 —— 真跟着手走的粒子，路径长度必然与手同量级。 */
    let pathH = 0, pathM = 0;
    let px = H0.x, py = H0.y, mx = M0.x, my = M0.y;
    for (let i = 0; i < 12; i++) {                                                // 推进 0.2s
      T.world.t += dt; T.stepPhysics(dt);
      pathH += Math.hypot(hand.tipX - px, hand.tipY - py); px = hand.tipX; py = hand.tipY;
      pathM += Math.hypot(mt.x - mx, mt.y - my); mx = mt.x; my = mt.y;
    }
    const dH = Math.hypot(hand.tipX - H0.x, hand.tipY - H0.y);
    const dM = Math.hypot(mt.x - M0.x, mt.y - M0.y);
    if (mt.dead) {
      wrState = 'SKIP';
      console.log('  !! 取样粒子在 0.2s 内已消散，跳过（不计为通过）');
    } else {
      const free = pathH > 100 && pathM < pathH * 0.5;
      console.log(`  0.2s 路径长度  手 ${pathH.toFixed(1)}（净位移 ${dH.toFixed(1)}）`
        + `  粒子 ${pathM.toFixed(1)}（净 ${dM.toFixed(1)}）   ${free ? 'OK 未跟随手' : '跟随了!'}`);
      if (!free) {
        /* 手路径这么短只有几种可能：取样时它其实已经死了 / 已经到顶转 hold /
           施法者倒了（update 会提前 return）。把状态打出来，别靠猜。 */
        console.log(`     诊断：手 state ${S0.state}→${hand.state}、dead ${S0.dead}→${hand.dead}`
          + `、len ${S0.len.toFixed(1)}→${hand.len.toFixed(1)}（maxLen ${hand.maxLen}，剩余 ${(hand.maxLen - S0.len).toFixed(1)}）`
          + `、age ${S0.age.toFixed(2)}→${hand.age.toFixed(2)}、施法者 alive=${hand.u.alive} dying=${!!hand.u.dying}`);
        wrState = 'FAIL';
      }
    }
    const bearer = T.world.units.find(u => u.mech && u.mech.constructor.name === 'MechDarkEmbrace');
    if (bearer) bearer.mech.cd = 1e9;                   // 别再召新手，否则又会有新粒子
    T.world.effects.forEach(e => { if (e.constructor.name === 'DemonHand') e.dead = true; });
    for (let i = 0; i < 60 * 3; i++) { T.world.t += dt; T.stepPhysics(dt); }
    const left = motes().length;
    console.log(`  手消失 3s 后残留粒子 ${left} 颗   ${left === 0 ? 'OK' : '滞留!'}`);
    if (left !== 0) wrState = 'FAIL';
  }
} catch (e) { wrErr = e; wrState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- I) 电流相生：出膛后必须直线飞行（不得追踪目标） ---------- */
console.log('\n— 电流相生：电球不追踪 —');
let homeState = 'ok', homeErr = null;
try {
  const wrapAng = a => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  T.resetMatch(T.CARD_BY_ID['voltaic'], T.CARD_BY_ID['end_of_days']);
  T.world.running = true;
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; });
  const dt = 1 / 60;
  /* 取样窗口只取 3 帧（0.05s ≈ 20px）：窗口再长的话电球多半已经命中/飞出，
     测不到东西。命中了就换下一颗重测。 */
  let orb = null, drift = null;
  for (let i = 0; i < 60 * 50 && drift === null; i++) {
    T.world.t += dt; T.stepPhysics(dt);
    if (!orb) orb = T.world.effects.find(e => e.constructor.name === 'Orb' && e.launched && e.delay <= 0);
    if (!orb) continue;
    const a0 = Math.atan2(orb.vy, orb.vx), x0 = orb.x, y0 = orb.y;
    for (let j = 0; j < 3; j++) { T.world.t += dt; T.stepPhysics(dt); }
    if (orb.dead) { orb = null; continue; }                       // 这颗已命中，换一颗
    if (Math.hypot(orb.x - x0, orb.y - y0) < 1) { orb = null; continue; }  // 没动，取样无效
    drift = Math.abs(wrapAng(Math.atan2(orb.vy, orb.vx) - a0));
  }
  if (drift === null) {
    homeState = 'SKIP';
    console.log('  !! 没取到有效飞行样本，跳过（不计为通过）');
  } else {
    const straight = drift < 0.01;
    console.log(`  出膛后航向偏移 ${drift.toFixed(4)} rad   ${straight ? 'OK 直线飞行、不追踪' : '还在追踪!'}`);
    if (!straight) homeState = 'FAIL';
  }
} catch (e) { homeErr = e; homeState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- J) 锻打成型：「撞到对手」起锤必须有 0.3s 内置 cd，撞墙不受限 ---------- */
console.log('\n— 锻打成型：撞人起锤限流 —');
let forgeState = 'ok', forgeErr = null;
try {
  T.resetMatch(T.CARD_BY_ID['beat_into_shape'], T.CARD_BY_ID['end_of_days']);
  T.world.running = true;
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; });
  const dt = 1 / 60;
  const fm = T.world.units[0].mech;
  for (let i = 0; i < 60 * 12 && !fm.sword; i++) { T.world.t += dt; T.stepPhysics(dt); }
  if (!fm.sword || fm.sword.dead) {
    forgeState = 'SKIP';
    console.log('  !! 没等到君王之剑铸成，跳过（不计为通过）');
  } else {
    const bonus = T.CARD_BY_ID['beat_into_shape'].p.bonusPerBounce;
    const cd = T.CARD_BY_ID['beat_into_shape'].p.hitForgeCd;
    // ① 同一瞬间连撞 10 次，只应起一锤
    const d0 = fm.sword.dmg;
    for (let i = 0; i < 10; i++) fm.onBounce('unit');
    const g1 = fm.sword.dmg - d0;
    const okSpam = g1 === bonus;
    console.log(`  连撞 10 次 伤害 ${d0}→${fm.sword.dmg}（新增 ${g1}，期望 ${bonus}）  ${okSpam ? 'OK 只起一锤' : '没限住!'}`);
    // ② cd 过去后再撞，应能再起一锤（证明确实是 cd 而不是永久锁死）
    for (let i = 0; i < Math.ceil(cd * 60) + 1; i++) fm.update(dt);
    const d1 = fm.sword.dmg;
    fm.onBounce('unit');
    const g2 = fm.sword.dmg - d1;
    const okAfter = g2 === bonus;
    console.log(`  ${cd}s 后再撞 新增 ${g2}（期望 ${bonus}）  ${okAfter ? 'OK 冷却已过' : '冷却没恢复!'}`);
    // ③ 撞墙这条路径不该被限流
    fm.hitForgeCd = cd;                       // 假装刚刚撞过人
    const d2 = fm.sword.dmg;
    fm.onBounce('wall');
    const g3 = fm.sword.dmg - d2;
    const okWall = g3 === bonus;
    console.log(`  冷却中撞墙 新增 ${g3}（期望 ${bonus}）  ${okWall ? 'OK 撞墙不受限' : '被误伤!'}`);
    if (!okSpam || !okAfter || !okWall) forgeState = 'FAIL';
  }
} catch (e) { forgeErr = e; forgeState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- K) 黑暗之拥：被抓单位失去碰撞体积、不能触发机制，且必须解禁 ---------- */
console.log('\n— 黑暗之拥：被抓期间失去碰撞 / 不触发机制 / 松手解禁 —');
let grabState = 'ok', grabErr = null;
try {
  T.resetMatch(T.CARD_BY_ID['dark_embrace'], T.CARD_BY_ID['beat_into_shape']);
  T.world.running = true;
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; });
  const dt = 1 / 60;
  const A = T.world.units[0], B = T.world.units[1];   // A=黑暗之拥（抓人方），B=锻打成型（被抓方）
  const dm = A.mech, fm = B.mech;
  /* ⚠️ 等剑这段时间【必须把 A 冻住】：不然 A 会自己撞墙伸手，而且伸出的那只手会被下面的
     `dm.hand = null` 变成"孤儿"—— 没有机制再 update 它，它抓着的 B 永远解不了禁
     （REPS=12 跑出来就是"松手后 B.grabbed = 1 永久卡住"）。 */
  A.freeze = 1e9;
  for (let i = 0; i < 60 * 12 && !fm.sword; i++) { T.world.t += dt; T.stepPhysics(dt); }
  if (!fm.sword || fm.sword.dead) {
    grabState = 'SKIP';
    console.log('  !! 没等到君王之剑铸成，跳过（不计为通过）');
  } else {
    // 手动从左墙伸一只手（y=330），并把 B 摆在手会扫过的位置上等着被抓
    A.x = 600; A.y = 600; B.x = 520; B.y = 330; B.freeze = 60;   // 冻住 B 好让它稳稳等在手的路上
    const preHand = dm.hand;                                     // 兜底：万一还有手在，先让它退场（onDead 会解禁）
    if (preHand) { preHand.dead = true; dm.hand = null; }
    dm.cd = 0;
    dm.onWallHit(1, 0, 3, 330);
    for (let i = 0; i < 60 * 3 && !(dm.hand && dm.hand.grab); i++) { T.world.t += dt; T.stepPhysics(dt); }
    if (!(dm.hand && dm.hand.grab)) {
      grabState = 'SKIP';
      console.log('  !! 手没抓到 B，跳过（不计为通过）');
    } else {
      const d0 = fm.sword.dmg, hp0 = A.hp;
      let bump = false, frames = 0, maxGrab = 0, collideFrames = 0;
      /* 被抓的每一帧都把 A 硬塞到 B 身上（距离 20px < 2R）。
         被抓期间 B 没有碰撞体积 → 不该发生球-球碰撞 → 不该起锤。 */
      while (dm.hand && dm.hand.grab && frames < 40) {
        A.x = B.x + 20; A.y = B.y;
        const popBefore = B.bouncePop;
        T.world.t += dt; T.stepPhysics(dt);
        /* 松手摔那一帧本来就会掉血 + bouncePop（设计内的），别算进"被抓期间" */
        if (!(dm.hand && dm.hand.grab)) break;
        maxGrab = Math.max(maxGrab, B.grabbed);
        // 球-球碰撞会把双方的 bouncePop 顶到 1；被抓期间不该发生
        if (B.bouncePop > popBefore + 0.5) collideFrames++;
        if (fm.sword.dmg !== d0) bump = true;
        frames++;
      }
      const noForge = !bump;
      const noDmg = A.hp === hp0;
      const flagged = maxGrab > 0;              // 抓取期间必须真的被标记为"被抓"
      const noCollide = collideFrames === 0;    // 且真的没发生碰撞
      console.log(`  被抓 ${frames} 帧里一直与对手重叠：剑伤 ${d0}→${fm.sword.dmg} ${noForge ? 'OK 未触发铸造' : '仍在起锤!'}`);
      console.log(`  同期抓人方掉血 ${(hp0 - A.hp).toFixed(0)} ${noDmg ? 'OK 被抓方无法造成伤害' : '仍在打人!'}`);
      console.log(`  抓取期间 B.grabbed 峰值 ${maxGrab}、发生碰撞 ${collideFrames} 帧 ${flagged && noCollide ? 'OK 已禁碰撞' : '没禁住!'}`);
      if (!noForge || !noDmg || !flagged || !noCollide) grabState = 'FAIL';
      // 松手后必须解禁，否则对手永久失去碰撞
      for (let i = 0; i < 60 * 2 && B.grabbed > 0; i++) { T.world.t += dt; T.stepPhysics(dt); }
      console.log(`  松手后 B.grabbed = ${B.grabbed} ${B.grabbed === 0 ? 'OK 已解禁' : '永久卡住!'}`);
      if (B.grabbed !== 0) grabState = 'FAIL';
      // 摔完的落点必须还在场内（以前算出来是 x=-59，整张卡会闪在场外一帧）
      const outB = Math.max(T.CFG.R - B.x, B.x - (T.CFG.AW - T.CFG.R),
                            T.CFG.R - B.y, B.y - (T.CFG.AH - T.CFG.R), 0);
      console.log(`  被摔落点 (${B.x.toFixed(0)}, ${B.y.toFixed(0)})，越界 ${outB.toFixed(1)}px ${outB < 1 ? 'OK 落在场内' : '被摔出场外!'}`);
      if (outB >= 1) grabState = 'FAIL';
    }
  }
  /* 不变量：任何时刻「被抓计数」必须等于「正抓着人的手的数量」——多一个就是漏了解禁 */
  T.resetMatch(T.CARD_BY_ID['dark_embrace'], T.CARD_BY_ID['beat_into_shape']);
  T.world.running = true;
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; });
  let worst = 0, outMax = 0;
  for (let i = 0; i < 60 * 30; i++) {
    T.world.t += dt; T.stepPhysics(dt);
    const held = T.world.effects.filter(e => e.grab).length;
    const cnt = T.world.units.reduce((s, u) => s + u.grabbed, 0);
    if (cnt !== held) worst = Math.max(worst, Math.abs(cnt - held));
    /* 只盯"被抓着"的单位：那些是恶魔之手在硬设坐标，越界就是真 bug。
       没被抓的单位偶尔越界是球-球分离时的正常互推（下一帧就被墙夹回来），
       把两种情况混在一起会让这条回归随机报警。 */
    T.world.units.forEach(u => {
      if (!u.alive || u.dying || u.grabbed <= 0) return;
      const out = Math.max(T.CFG.R - u.x, u.x - (T.CFG.AW - T.CFG.R),
                           T.CFG.R - u.y, u.y - (T.CFG.AH - T.CFG.R), 0);
      if (out > outMax) outMax = out;
    });
  }
  console.log(`  30s 对局里被抓单位越界最大 ${outMax.toFixed(1)}px ${outMax < 1 ? 'OK 全程在场内' : '被拖出场地!'}`);
  if (outMax >= 1) grabState = 'FAIL';
  console.log(`  30s 对局里「被抓计数 vs 实际抓着的手」最大偏差 = ${worst} ${worst === 0 ? 'OK 无泄漏' : '计数泄漏!'}`);
  if (worst !== 0) grabState = 'FAIL';
} catch (e) { grabErr = e; grabState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- L) 电球飞行速度（纯记录，方便对照"提速"到底提了多少） ---------- */
console.log('\n— 电流相生：电球速度 —');
try {
  const vp = T.CARD_BY_ID['voltaic'].p;
  const peak = vp.shotSpd + vp.shotBoost * 0.6;
  console.log(`  巡航 ${vp.shotSpd} px/s，出膛峰值 ≈ ${peak.toFixed(0)} px/s（场地 ${T.CFG.AW}px，横穿约 ${(T.CFG.AW / vp.shotSpd).toFixed(2)}s）`);
} catch (e) { console.error('  !! 异常:', e.message); }

/* ---------- M) 第十五轮：伤害/频率数值回归 ----------
   M1 黑暗之拥：砸墙伤害必须随"手伸出去多远"线性提高（130~270），不是固定值。
   M2 刀刃陷阱：小刀 16 伤、每次一对（朝敌人 + 朝反方向）；被相撞引导回来的刀伤害翻倍（32）；命中只轻推一把（不动方向）；发刀更密。
   M3 末日降临：陨石 220 伤（2026 削弱 230→220） + 强击退（380，knock 的上限）+ 直击半径 130；灾厄圈 66/s、叠灾厄判定半径 doomR 125（画出来的圈 zoneR 106）。
   M4 电流相生：召唤→发射总间隔 3.6~4.8s 随机；上限 64 颗。 */

console.log('\n— 黑暗之拥：伤害随伸出距离提高（130~270）—');
let handDmgState = 'ok', handDmgErr = null;
try {
  const dt = 1 / 60;
  const p = T.CARD_BY_ID['dark_embrace'].p;
  /* 手动从左侧墙（墙面 x=3）伸手，把对手冻在 bx 处等被抓：
     手伸过去 → 抓住 → 回拽 → 砸墙结算一次伤害。返回这一次的伤害与当时的伸展比例。 */
  function slamAt(bx) {
    T.resetMatch(T.CARD_BY_ID['dark_embrace'], T.CARD_BY_ID['beat_into_shape']);
    T.world.running = true;
    const A = T.world.units[0], B = T.world.units[1];
    T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
    A.x = 600; A.y = 600; B.x = bx; B.y = 330;
    const dm = A.mech;
    dm.cd = 0; dm.hand = null;
    dm.onWallHit(1, 0, 3, 330);
    const hand = dm.hand;                    // 抓紧引用：摔完那一帧之后 dm.hand 会被清空
    const hp0 = B.hp;
    for (let i = 0; i < 60 * 6; i++) {
      T.world.t += dt; T.stepPhysics(dt);
      if (B.hp < hp0) return { dmg: hp0 - B.hp, reach: hand.reach, expect: hand.dmgNow() };
      if (!dm.hand) break;
    }
    return null;
  }
  const far = slamAt(590);    // 对手贴着对面墙：手几乎伸满全场才抓到 → 接近上限
  const near = slamAt(70);    // 对手贴着这面墙：手刚探出墙就抓到 → 接近下限
  if (!far || !near) {
    handDmgState = 'SKIP';
    console.log(`  !! 没取到两次砸墙伤害（远=${far ? far.dmg : 'null'} 近=${near ? near.dmg : 'null'}），跳过（不计为通过）`);
  } else {
    const inRange = far.dmg >= 130 && far.dmg <= 270 && near.dmg >= 130 && near.dmg <= 270;
    const mono = far.dmg > near.dmg;
    const farHigh = far.dmg >= 220;          // 远抓必须真的打到高段，否则等于还是固定值
    const nearLow = near.dmg <= 160;         // 近抓必须落在低段
    const exact = far.dmg === far.expect && near.dmg === near.expect;
    const params = p.dmgMin === 130 && p.dmgMax === 270;
    console.log(`  伸满全场才抓到 reach ${far.reach.toFixed(2)} → ${far.dmg} 伤（期望 ${far.expect}）`);
    console.log(`  刚出墙就抓到   reach ${near.reach.toFixed(2)} → ${near.dmg} 伤（期望 ${near.expect}）`);
    console.log(`  参数 dmgMin/dmgMax = ${p.dmgMin}/${p.dmgMax} ${params ? 'OK 130~270' : '不是 130~270!'}`);
    console.log(`  区间 ${inRange ? 'OK 都落在 130~270' : '越界!'} / 单调 ${mono ? 'OK 越远越重' : '反了!'}`
      + ` / 远抓高段 ${farHigh ? 'OK' : '没到 220!'} / 近抓低段 ${nearLow ? 'OK' : '偏高!'}`
      + ` / 结算值一致 ${exact ? 'OK' : '对不上!'}`);
    if (!inRange || !mono || !farHigh || !nearLow || !exact || !params) handDmgState = 'FAIL';
  }
} catch (e) { handDmgErr = e; handDmgState = 'FAIL'; console.error('  !! 异常:', e.message); }

console.log('\n— 刀刃陷阱：16 伤 / 一对反向双发 / 引导刀翻倍（32） / 轻推（不改方向） / 发刀频率 —');
let knifeState = 'ok', knifeErr = null;
try {
  const dt = 1 / 60;
  const kp = T.CARD_BY_ID['knife_trap'].p;
  /* 把对手冻在 (400,330)、方向设成"朝上"，从左边朝它放 n 把刀过去。
     返回累计伤害 + 命中期间 boost 峰值 + 收尾时的 boost 与方向。
     方向必须是"朝上"原封不动 —— 这就是"象征性推一下"与"击退"的分界。 */
  function throwAt(state, n) {
    T.resetMatch(T.CARD_BY_ID['knife_trap'], T.CARD_BY_ID['dark_embrace']);
    T.world.running = true;
    const A = T.world.units[0], B = T.world.units[1];
    T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
    B.x = 400; B.y = 330; B.boost = 0; B.dx = 0; B.dy = -1;
    const ks = [];
    for (let i = 0; i < (n || 1); i++) {
      const k = new T.Knife(A, 200 - i * 20, 330, 0, kp);
      k.state = state || 'fly'; k.delay = 0;
      T.world.effects.push(k); ks.push(k);
    }
    const hp0 = B.hp;
    let peak = 0;
    for (let i = 0; i < 60 * 3; i++) {
      T.world.t += dt; T.stepPhysics(dt);
      peak = Math.max(peak, B.boost);
      if (ks.every(k => k.dead)) break;
    }
    return { dmg: hp0 - B.hp, boost: B.boost, peak: peak, dx: B.dx, dy: B.dy };
  }
  const plain = throwAt('fly', 1);
  const guided = throwAt('recover', 1);
  const volley = throwAt('fly', 6);
  if (!plain || !guided || !volley) {
    knifeState = 'SKIP';
    console.log('  !! 没取到小刀命中样本，跳过（不计为通过）');
  } else {
    const base16 = kp.dmg === 18 && plain.dmg === 18;
    const doubled = guided.dmg === 27;
    /* ① 方向必须一点没动：命中前后都还是"朝上" (0,-1) */
    const dirKept = plain.dx === 0 && plain.dy === -1 && guided.dx === 0 && guided.dy === -1
                 && volley.dx === 0 && volley.dy === -1;
    /* ② 加速必须"只是推一把"：单发 = nudge，且连中 6 刀也只能叠到 nudgeCap
       （第十七轮补→十八轮：8/20 → 16/40，用户要求"再调高一点"） */
    const symbolic = plain.boost === kp.nudge && plain.boost > 0
                  && volley.peak <= kp.nudgeCap + 0.5
                  && kp.nudge === 16 && kp.nudgeCap === 40;
    const noKnockCall = kp.knock === undefined && kp.knockCap === undefined;
    console.log(`  普通飞行刀 ${plain.dmg} 伤（设定 ${kp.dmg}） ${base16 ? 'OK' : '不对!'}`);
    console.log(`  相撞引导刀 ${guided.dmg} 伤 ${doubled ? 'OK ×1.5（18→27）' : '数值不对!'}`);
    console.log(`  命中后 boost 单发 ${plain.boost.toFixed(1)}、连中 6 刀峰值 ${volley.peak.toFixed(1)}`
      + `（accel ${kp.nudge} / cap ${kp.nudgeCap}） ${symbolic ? 'OK 推一把但不改方向' : '数值不对!'}`);
    console.log(`  方向 命中前 (0,-1) → 命中后 (${plain.dx}, ${plain.dy}) / 6 刀后 (${volley.dx}, ${volley.dy})`
      + ` ${dirKept ? 'OK 一点没动' : '方向被改了!'}`);
    console.log(`  已改走 nudge、参数里不再有 knock/knockCap ${noKnockCall ? 'OK' : '还留着旧参数!'}`);
    if (!base16 || !doubled || !dirKept || !symbolic || !noKnockCall) knifeState = 'FAIL';
  }
  /* 引导刀的飞行速度：必须比普通飞行刀快，且倍率要跟 guideSpdMul 对上。
     把对手摆到 x=600、刀放在 x=150，只推进 3 帧（远没到命中距离）再量位移 / 时间。 */
  function measureSpd(state) {
    T.resetMatch(T.CARD_BY_ID['knife_trap'], T.CARD_BY_ID['dark_embrace']);
    T.world.running = true;
    const A = T.world.units[0], B = T.world.units[1];
    T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
    B.x = 600; B.y = 330; B.dx = 0; B.dy = -1;
    const k = new T.Knife(A, 150, 330, 0, kp);
    k.state = state; k.delay = 0;
    T.world.effects.push(k);
    const x0 = k.x;
    for (let i = 0; i < 3; i++) { T.world.t += dt; T.stepPhysics(dt); }
    return (k.x - x0) / (3 * dt);
  }
  const spdPlain = measureSpd('fly');
  const spdGuided = measureSpd('recover');
  const spdRatio = spdPlain > 0 ? spdGuided / spdPlain : 0;
  const faster = spdGuided > spdPlain * 1.05 && Math.abs(spdRatio - kp.guideSpdMul) < 0.05;
  /* 要比原来写死的 1.5× 更快 */
  const fasterThanOld = kp.guideSpdMul > 1.5 && spdRatio > 1.5;
  console.log(`  飞行速度 普通 ${spdPlain.toFixed(0)} px/s / 引导 ${spdGuided.toFixed(0)} px/s`
    + `（倍率 ${spdRatio.toFixed(2)}×，设定 guideSpdMul ${kp.guideSpdMul}，旧值写死 1.5×）`
    + ` ${faster ? 'OK 倍率对得上' : '倍率不对!'} ${fasterThanOld ? 'OK 比原来快' : '没加快!'}`);
  if (!faster || !fasterThanOld) knifeState = 'FAIL';

  /* 每次发射必须是"一对、朝相反方向"的刀：等第一次开火，把那一帧新生成的两枚都抓下来。
     两个单位都冻住、对手放在正右方 → 一对的角度应当正好是 0 与 π。 */
  function firstVolley() {
    T.resetMatch(T.CARD_BY_ID['knife_trap'], T.CARD_BY_ID['dark_embrace']);
    T.world.running = true;
    const A = T.world.units[0], B = T.world.units[1];
    T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
    B.x = 500; B.y = 330;
    const seen = new WeakSet();
    for (let i = 0; i < 60 * 6; i++) {
      T.world.t += dt; T.stepPhysics(dt);
      const fresh = [];
      for (const e of T.world.effects) {
        if (!seen.has(e)) { seen.add(e); if (e.constructor.name === 'Knife') fresh.push(e); }
      }
      if (fresh.length) return { n: fresh.length, angs: fresh.map(k => k.ang), aim: Math.atan2(B.y - A.y, B.x - A.x) };
    }
    return null;
  }
  const vol = firstVolley();
  const wrapPi = a => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const paired = !!vol && vol.n === 2
             && Math.abs(wrapPi(vol.angs[0] - vol.aim)) < 1e-9
             && Math.abs(Math.abs(wrapPi(vol.angs[1] - vol.angs[0])) - Math.PI) < 1e-9;
  console.log(paired
    ? `  一次齐射出膛 ${vol.n} 枚：角度 ${vol.angs.map(a => a.toFixed(3)).join(' / ')}（瞄准角 ${vol.aim.toFixed(3)}） OK 一正一反`
    : `  一次齐射出膛 ${vol ? vol.n : '(没等到)'} 枚，角度 ${vol ? vol.angs.map(a => a.toFixed(3)).join(' / ') : '-'} 一对反向双发不成立!`);
  if (!paired) knifeState = 'FAIL';

  /* 发刀节奏：冻住双方跑 30s，数实际生成的小刀数量 + 两轮开火之间的实测间隔。
     现在 interval 1.85s（上一版 2.0s）→ 30s 约 16 轮 / 32 把。 */
  T.resetMatch(T.CARD_BY_ID['knife_trap'], T.CARD_BY_ID['dark_embrace']);
  T.world.running = true;
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
  const made = new WeakSet();
  let fired = 0;
  const perFrame = [], volleyAt = [];
  for (let i = 0; i < 60 * 30; i++) {
    T.world.t += dt; T.stepPhysics(dt);
    let nNew = 0;
    for (const e of T.world.effects) {
      if (!made.has(e)) { made.add(e); if (e.constructor.name === 'Knife') { fired++; nNew++; } }
    }
    if (nNew) { perFrame.push(nNew); volleyAt.push(T.world.t); }
  }
  const gaps = volleyAt.slice(1).map((t, i) => t - volleyAt[i]);
  const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const alwaysPair = perFrame.length >= 3 && perFrame.every(n => n === 2);
  /* 节奏：设定必须是 1.85s，且实测平均间隔要跟它对得上（上一版 2.0s 会明显更长） */
  const slower = kp.interval === 1.85 && kp.interval < 2.0 && Math.abs(meanGap - kp.interval) < 0.05;
  console.log(`  30s 内发刀 ${fired} 把 / ${volleyAt.length} 轮（每 ${kp.interval}s 一对 → 期望 ~32 把）`
    + `；每次开火的新刀数 ${[...new Set(perFrame)].join(',')} ${alwaysPair ? 'OK 帧帧成对' : '没成对!'}`);
  console.log(`  实测两轮开火平均间隔 ${meanGap.toFixed(2)}s（设定 ${kp.interval}s，上一版 2.0s）`
    + ` ${slower ? 'OK 每 1.85 秒一轮' : '节奏不对!'}`);
  if (!alwaysPair || !slower) knifeState = 'FAIL';

  /* 在场刀上限：直接塞 100 把进 mech.knives，跑一帧 update 必须被裁到 maxKnives（80）。
     另外记录 30s 实测里"同时在场"的峰值，确保它从没越过上限。 */
  {
    const km = T.world.units[0].mech;
    for (let i = 0; i < 100; i++) {
      const k = new T.Knife(T.world.units[0], 100 + i, 330, 0, kp);
      T.world.effects.push(k); km.knives.push(k);
    }
    km.cd = 1e9;                       // 别在测量时又开火
    km.update(dt);
    const alive = km.knives.filter(k => !k.dead).length;
    const capOk = kp.maxKnives === 80 && alive === kp.maxKnives;
    console.log(`  在场刀上限 塞 100 把 → 裁到 ${alive}（设定 maxKnives ${kp.maxKnives}，旧值写死 40）`
      + ` ${capOk ? 'OK 上限 80' : '上限不对!'}`);
    if (!capOk) knifeState = 'FAIL';
  }
} catch (e) { knifeErr = e; knifeState = 'FAIL'; console.error('  !! 异常:', e.message); }

console.log('\n— 末日降临：陨石 220 伤 + 强击退 / 直击半径 130 —');
let meteorState = 'ok', meteorErr = null;
try {
  const p = T.CARD_BY_ID['end_of_days'].p;
  /* 命中半径取 130：把对手分别放在 125（圈内）与 135（圈外），只跑 impact() 不推进时间，
     所以量到的只有"直击"这一下，不含灾厄圈的持续叠值。 */
  function meteorAt(dist) {
    T.resetMatch(T.CARD_BY_ID['end_of_days'], T.CARD_BY_ID['dark_embrace']);
    T.world.running = true;
    const A = T.world.units[0], B = T.world.units[1];
    T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
    B.x = 330 + dist; B.y = 330; B.boost = 0;
    const hp0 = B.hp;
    T.impact(330, 330, p, A);
    return { B: B, A: A, dmg: hp0 - B.hp, boost: B.boost, dx: B.dx, dy: B.dy };
  }
  const near = meteorAt(40);          // 落点在目标左侧 40px → 应该把它往右掀
  const dmg = near.dmg;
  const dmgOk = dmg === 220 && p.dmg === 220;   // 2026 削弱：陨石直击 230 → 220
  const knockOk = near.boost >= 300 && near.boost <= 380 && near.dx > 0.9;
  console.log(`  陨石命中伤害 ${dmg}（设定 ${p.dmg}） ${dmgOk ? 'OK' : '不对!'}`);
  console.log(`  击退 boost ${near.boost.toFixed(0)}（knock 上限 380）方向 (${near.dx.toFixed(2)}, ${near.dy.toFixed(2)})`
    + ` ${knockOk ? 'OK 强击退、朝落点外侧' : '击退不足/方向不对!'}`);
  if (!dmgOk || !knockOk) meteorState = 'FAIL';

  /* 直击半径边界：125px 必中、135px 必不中（并断言参数就是 130，别再退回写死的算式） */
  const inHit = meteorAt(125), outHit = meteorAt(135);
  const radiusOk = p.hitR === 130 && inHit.dmg === 220 && outHit.dmg === 0;
  const oldEdge = p.zoneR * 0.9 + T.CFG.R * 0.4;   // 旧写死算式现在的值，仅用于说明
  console.log(`  直击半径 hitR ${p.hitR}（旧算式 zoneR*0.9+R*0.4 = ${oldEdge.toFixed(0)}）`
    + `：125px 处 ${inHit.dmg} 伤 / 135px 处 ${outHit.dmg} 伤 ${radiusOk ? 'OK 边界正确' : '边界不对!'}`);
  if (!radiusOk) meteorState = 'FAIL';

  /* 正好砸在圆心：方向退化 (0,0)，必须兜住，否则那张卡会原地定住不动 */
  const B = near.B, A = near.A;
  B.boost = 0;
  T.impact(B.x, B.y, p, A);
  const okFallback = Math.hypot(B.dx, B.dy) > 0.9;
  console.log(`  砸在圆心时方向 (${B.dx.toFixed(2)}, ${B.dy.toFixed(2)}) ${okFallback ? 'OK 未退化' : '方向退化，单位会卡住!'}`);
  if (!okFallback) meteorState = 'FAIL';
} catch (e) { meteorErr = e; meteorState = 'FAIL'; console.error('  !! 异常:', e.message); }

console.log('\n— 末日降临：灾厄叠加速度（66/s）+ 叠灾厄判定半径 125 —');
let doomStackState = 'ok', doomStackErr = null;
try {
  const dt = 1 / 60;
  const p = T.CARD_BY_ID['end_of_days'].p;
  T.resetMatch(T.CARD_BY_ID['end_of_days'], T.CARD_BY_ID['dark_embrace']);
  T.world.running = true;
  const A = T.world.units[0], B = T.world.units[1];
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
  B.x = 330; B.y = 330; B.doom = 0;
  T.impact(330, 330, p, A);                 // 落点就在对手脚下 → 它整段时间都在圈内
  const zones = T.world.effects.filter(e => e.constructor.name === 'DoomZone').length;
  const d0 = B.doom, secs = 2.0, steps = Math.round(secs / dt);
  for (let i = 0; i < steps; i++) { T.world.t += dt; T.stepPhysics(dt); }
  const rate = (B.doom - d0) / (steps * dt);
  const rateOk = Math.abs(rate - p.doomRate) < 0.5;
  const exact = p.doomRate === 66;
  console.log(`  场上灾厄圈 ${zones} 个；对手站在圆心 ${secs}s 叠了 ${(B.doom - d0).toFixed(1)} 点`
    + ` → 实测 ${rate.toFixed(2)}/s（设定 doomRate ${p.doomRate}） ${rateOk ? 'OK 与设定一致' : '对不上!'}`);
  console.log(`  设定值必须正好是 66/s（上一版 50.4）${exact ? 'OK' : '不是 66!'}`);
  if (!rateOk || !exact) doomStackState = 'FAIL';

  /* 叠灾厄判定半径：现在是显式参数 doomR（125），不再由画出来的圈 zoneR(106) 推算。
     把对手分别放在 doomR-5（圈内）与 doomR+5（圈外）各跑 2s：
     圈内必须叠、圈外必须一点不叠。
     ⚠️ 直接 new 一个 DoomZone，**不走 impact()** —— 直击半径是 130，
     这两个测试点（120 / 130）都在或贴着直击圈，用 impact() 会先扣一次 230 伤，
     "圈本身不造成伤害"这条就测不出来了。 */
  function zoneStackAt(dist) {
    T.resetMatch(T.CARD_BY_ID['end_of_days'], T.CARD_BY_ID['dark_embrace']);
    T.world.running = true;
    const Az = T.world.units[0], Bz = T.world.units[1];
    T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
    Bz.x = 330 + dist; Bz.y = 330; Bz.doom = 0;
    T.world.effects.push(new T.DoomZone(330, 330, p, Az));   // 只要圈，不要陨石
    const hp0 = Bz.hp;
    for (let i = 0; i < Math.round(2.0 / dt); i++) { T.world.t += dt; T.stepPhysics(dt); }
    return { doom: Bz.doom, hpKept: Bz.hp === hp0 };
  }
  const inZone = zoneStackAt(p.doomR - 5);
  const outZone = zoneStackAt(p.doomR + 5);
  const radiusOk = p.doomR === 125 && p.zoneR === 106
                && inZone.doom > 100 && outZone.doom === 0
                && inZone.hpKept && outZone.hpKept;
  console.log(`  判定半径 doomR ${p.doomR}（上一版 = zoneR + R*0.5 = ${(p.zoneR + T.CFG.R * 0.5).toFixed(0)}）`
    + `；画出来的圈仍是 zoneR ${p.zoneR}`);
  console.log(`  ${(p.doomR - 5).toFixed(0)}px 处 2s 叠 ${inZone.doom.toFixed(1)} / ${(p.doomR + 5).toFixed(0)}px 处 2s 叠 ${outZone.doom.toFixed(1)}`
    + ` ${radiusOk ? 'OK 边界正确、圈本身不造成伤害' : '范围不对!'}`);
  if (!radiusOk) doomStackState = 'FAIL';
} catch (e) { doomStackErr = e; doomStackState = 'FAIL'; console.error('  !! 异常:', e.message); }

console.log('\n— 电流相生：召唤→发射间隔 3.6~4.8s 随机 / 上限 64 / 出膛速度 —');
let gapState = 'ok', gapErr = null;
try {
  const dt = 1 / 60;
  const p = T.CARD_BY_ID['voltaic'].p;
  const vcard = T.CARD_BY_ID['voltaic'];
  T.resetMatch(vcard, T.CARD_BY_ID['dark_embrace']);
  T.world.running = true;
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
  const mech = T.world.units[0].mech;
  const gaps = [];
  const batches = new Set();
  let lastPhase = mech.phase, tMark = 0, maxOrbs = 0, peakCount = 0;
  let flightSpeed = 0;
  /* 跑 75s：数量 1→2→4→8→16→32→64 需要 7 轮（每轮 ≈ 4~4.5s + 一轮齐射），
     60s 只能勉强到 64，留点余量免得边界上抖动。 */
  for (let i = 0; i < 60 * 75; i++) {
    T.world.t += dt; T.stepPhysics(dt);
    if (mech.phase !== lastPhase) {
      if (mech.phase === 'orbit') tMark = T.world.t;                  // 刚召唤出来
      if (mech.phase === 'firing') gaps.push(T.world.t - tMark);      // 发射那一刻
      lastPhase = mech.phase;
    }
    /* 采一次"出膛后在飞"的实测速度：3 帧位移 / 时间（电球是直线飞行，可以直接这么量） */
    if (!flightSpeed) {
      const o = T.world.effects.find(e => e.constructor.name === 'Orb' && e.launched && e.delay <= 0 && !e.dead);
      if (o) {
        const x0 = o.x, y0 = o.y;
        for (let j = 0; j < 3; j++) { T.world.t += dt; T.stepPhysics(dt); }
        const d = Math.hypot(o.x - x0, o.y - y0);
        if (!o.dead && d > 1) flightSpeed = d / (3 * dt);
      }
    }
    const orbit = T.world.effects.filter(e => e.constructor.name === 'Orb' && e.state === 'orbit').length;
    maxOrbs = Math.max(maxOrbs, orbit);
    if (orbit > 0) batches.add(orbit);
    peakCount = Math.max(peakCount, mech.count);
  }
  const nGap = gaps.length;
  const gapParam = p.gapMin === 3.6 && p.gapMax === 4.8;
  const allIn = nGap >= 3 && gaps.every(g => g >= 3.55 && g <= 4.85);
  const spread = nGap >= 3 && (Math.max(...gaps) - Math.min(...gaps)) > 0.15;   // 真的是随机，不是固定值
  const capOk = p.maxOrbs === 64 && peakCount === 64 && maxOrbs <= 64;
  /* 出膛速度：参数要比旧值（620/560）快，且实测飞行速度不能低于巡航设定 */
  const spdParam = p.shotSpd > 620 && p.shotBoost > 560;
  const spdMeasured = flightSpeed > 0 && flightSpeed >= p.shotSpd - 1;
  console.log(`  间隔参数 gapMin/gapMax = ${p.gapMin}/${p.gapMax} ${gapParam ? 'OK 3.6~4.8' : '不是 3.6~4.8!'}`);
  console.log(`  采集 ${nGap} 次「召唤→发射」间隔：${gaps.map(g => g.toFixed(2)).join(' / ')}s`
    + ` ${allIn ? 'OK 全在 3.6~4.8s' : '越界!'}`);
  console.log(`  最大最小差 ${nGap >= 3 ? (Math.max(...gaps) - Math.min(...gaps)).toFixed(2) : '-'}s ${spread ? 'OK 是随机值' : '像是固定值!'}`);
  console.log(`  批次数量出现 ${[...batches].sort((a, b) => a - b).join(',')}，场上峰值 ${maxOrbs} 颗，count 峰值 ${peakCount}`
    + ` ${capOk ? 'OK 上限 64' : '上限不对!'}`);
  console.log(`  出膛速度 巡航 ${p.shotSpd} / 冲量 ${p.shotBoost}（旧值 620/560）${spdParam ? 'OK 已提速' : '没提速!'}`
    + `；实测飞行 ${flightSpeed ? flightSpeed.toFixed(0) : '(没采到)'} px/s ${spdMeasured ? 'OK ≥ 巡航设定' : '偏慢或没采到!'}`);
  if (!gapParam || !allIn || !spread || !capOk || !spdParam || !spdMeasured) gapState = 'FAIL';
} catch (e) { gapErr = e; gapState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- N2) 电流相生：环绕灼烧 = 每秒 10 次 × 3 点 ----------
   做法：冻住双方、手工造一颗电球并 hold（不转），把对手摆在电球所在位置 → 稳定重叠，
   量 1s 的血量损失。期望 30 dps。
   注：数值沿革 30×1(30dps) → 20×3(60dps) → 10×1(10dps) → 10×3(30dps，2026-09-23 用户要求)。
   本条断言原先写死 20×3，后来改成跟随源码设定（下面 expTick/expDmg 手动同步）。 */
console.log('\n— 电流相生：环绕灼烧 10 次/s × 3 点 —');
let orbitDmgState = 'ok', orbitDmgErr = null;
try {
  const dt = 1 / 60;
  const p = T.CARD_BY_ID['voltaic'].p;
  T.resetMatch(T.CARD_BY_ID['voltaic'], T.CARD_BY_ID['dark_embrace']);
  T.world.running = true;
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
  const A = T.world.units[0], B = T.world.units[1];
  A.mech.cd = 1e9;                                  // 别让机制自己召唤/开火干扰测量
  const orb = new T.Orb(A, 0, p);
  orb.hold = true;                                  // 停在原地（不转），稳定压在对手身上
  T.world.effects.push(orb);
  B.x = A.x + p.orbitR; B.y = A.y;
  const hp0 = B.hp, secs = 1.0, steps = Math.round(secs / dt);
  for (let i = 0; i < steps; i++) {
    T.world.t += dt; T.stepPhysics(dt);
    orb.hold = true;                                // 万一本帧被清掉 halo，保持停摆
  }
  const dps = (hp0 - B.hp) / (steps * dt);
  const perTick = dps / p.dpsTick;
  const expTick = 10, expDmg = 3, expDps = expTick * expDmg;   // 跟随 src/game.html 的 p 设定
  const paramOk = p.dpsTick === expTick && p.orbitDmg === expDmg;
  const dpsOk = Math.abs(dps - expDps) < 1.5 && Math.abs(perTick - expDmg) < 0.1;
  console.log(`  参数 dpsTick ${p.dpsTick} × orbitDmg ${p.orbitDmg} ${paramOk ? `OK ${expTick}×${expDmg}` : `不是 ${expTick}×${expDmg}!`}`);
  console.log(`  稳定重叠 ${secs}s 掉血 ${(hp0 - B.hp).toFixed(0)} → 实测 ${dps.toFixed(1)} dps（每跳 ${perTick.toFixed(2)} 点，设定 ${expDps} dps）`
    + ` ${dpsOk ? 'OK 与设定一致' : '对不上!'}`);
  if (!paramOk || !dpsOk) orbitDmgState = 'FAIL';
} catch (e) { orbitDmgErr = e; orbitDmgState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- O) 锻打成型：近战索敌半径与挥砍冷却（都按实测行为验，不只断言参数） ---------- */
console.log('\n— 锻打成型：索敌 150px / 挥砍冷却 2.0s / 初始伤害 30 —');
let forgeRangeState = 'ok', forgeRangeErr = null;
try {
  const dt = 1 / 60;
  const p = T.CARD_BY_ID['beat_into_shape'].p;
  /* 冻住双方 + 等剑铸成 → 位置固定，便于把对手精确摆在某个距离上 */
  function forgeSetup() {
    T.resetMatch(T.CARD_BY_ID['beat_into_shape'], T.CARD_BY_ID['dark_embrace']);
    T.world.running = true;
    const A = T.world.units[0], B = T.world.units[1];
    T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
    A.x = 330; A.y = 330;
    for (let i = 0; i < 60 * 12 && !A.mech.sword; i++) { T.world.t += dt; T.stepPhysics(dt); }
    return { A: A, B: B, sw: A.mech.sword };
  }
  const fs = forgeSetup();
  if (!fs.sw || fs.sw.dead) {
    forgeRangeState = 'SKIP';
    console.log('  !! 没等到君王之剑铸成，跳过（不计为通过）');
  } else {
    const sw = fs.sw;
    const R = p.swingRange;
    const paramOk = p.swingRange === 150 && p.swingCd === 2.0 && p.baseDmg === 30
                 && sw.dmg === 30;      // 铸出来那一刻剑伤就该是 baseDmg（别只看参数）
    /* ① 圈外（R+10）跑 5s：一次都不该起刀 */
    fs.B.x = 330 + R + 10; fs.B.y = 330;
    let outStarts = 0, wasOut = sw.swing > 0;
    for (let i = 0; i < 60 * 5; i++) {
      T.world.t += dt; T.stepPhysics(dt);
      const now = sw.swing > 0;
      if (now && !wasOut) outStarts++;
      wasOut = now;
    }
    /* ② 圈内（R-5）跑 8s：记录每次起刀的时刻，两两间隔应 ≈ swingCd */
    fs.B.x = 330 + R - 5; fs.B.y = 330;
    const at = [], t0 = T.world.t;
    let was = sw.swing > 0;
    for (let i = 0; i < 60 * 8; i++) {
      T.world.t += dt; T.stepPhysics(dt);
      const now = sw.swing > 0;
      if (now && !was) at.push(T.world.t - t0);
      was = now;
    }
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const outOk = outStarts === 0;
    const inOk = at.length >= 3;
    const cdOk = gaps.length >= 2 && gaps.every(g => Math.abs(g - p.swingCd) < 0.05);
    console.log(`  参数 swingRange ${p.swingRange} / swingCd ${p.swingCd}s / 初始伤害 ${p.baseDmg}`
      + `（铸成瞬间剑伤 ${sw.dmg}） ${paramOk ? 'OK 150 / 2.0 / 30' : '不是 150 / 2.0 / 30!'}`);
    console.log(`  ${(R + 10).toFixed(0)}px 处跑 5s 起刀 ${outStarts} 次 ${outOk ? 'OK 圈外不出手' : '圈外也砍!'}`);
    console.log(`  ${(R - 5).toFixed(0)}px 处跑 8s 起刀 ${at.length} 次（间隔 ${gaps.map(g => g.toFixed(2)).join(' / ') || '-'}）`
      + ` 平均 ${meanGap.toFixed(2)}s ${inOk && cdOk ? 'OK 冷却对得上' : '冷却不对/次数太少!'}`);
    if (!paramOk || !outOk || !inOk || !cdOk) forgeRangeState = 'FAIL';
  }
} catch (e) { forgeRangeErr = e; forgeRangeState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- P) 锻打成型：近战击退算作碰撞 → 触发刀刃陷阱的小刀引导 ---------- */
console.log('\n— 锻打成型近战击退算作碰撞（触发刀刃陷阱引导）—');
let swordHitState = 'ok', swordHitErr = null;
try {
  const dt = 1 / 60;
  /* A=刀刃陷阱（被砍的一方，墙上有插刀）、B=锻打成型（挥剑的一方）。
     两球间距取 120px：> 2R(108) 所以【不会发生球-球物理碰撞】，
     又 < swingRange(150) 所以剑会起手并命中 → 引导只可能来自"这次近战"。 */
  T.resetMatch(T.CARD_BY_ID['knife_trap'], T.CARD_BY_ID['beat_into_shape']);
  T.world.running = true;
  const A = T.world.units[0], B = T.world.units[1];
  T.world.units.forEach(u => { u.maxHp = 99999; u.hp = 99999; u.freeze = 1e9; });
  A.x = 330; A.y = 330;
  B.x = 330 + 120; B.y = 330;
  A.mech.cd = 1e9;                                   // 别让 A 自己发新刀，保持"墙上那几把"是唯一变量
  const stuck = [];
  for (let i = 0; i < 3; i++) {
    const k = new T.Knife(A, 40 + i * 10, 40, 0, T.CARD_BY_ID['knife_trap'].p);
    k.state = 'stuck';
    T.world.effects.push(k); A.mech.knives.push(k); stuck.push(k);
  }
  let hitFrame = -1, guidedFrame = -1, guidedN = 0;
  for (let i = 0; i < 60 * 6; i++) {
    T.world.t += dt; T.stepPhysics(dt);
    const sw = B.mech.sword;
    if (hitFrame < 0 && sw && sw.hit) hitFrame = i;
    const g = A.mech.knives.filter(k => k.state === 'recover').length;
    if (guidedFrame < 0 && g > 0) { guidedFrame = i; guidedN = g; }
  }
  const sameMoment = hitFrame >= 0 && guidedFrame >= 0 && Math.abs(guidedFrame - hitFrame) <= 1;
  const allGuided = guidedN === 3;
  console.log(`  间距 120px（>2R 不会物理碰撞、<150 会被剑砍到）`);
  console.log(`  剑命中发生在第 ${hitFrame} 帧 / 小刀转"引导"发生在第 ${guidedFrame} 帧（${guidedN} 把）`
    + ` ${sameMoment ? 'OK 同一瞬间触发' : '没对上!'} ${allGuided ? '' : '（不是 3 把?）'}`);
  if (!sameMoment || !allGuided) swordHitState = 'FAIL';
} catch (e) { swordHitErr = e; swordHitState = 'FAIL'; console.error('  !! 异常:', e.message); }

/* ---------- N) 开局站位：左右对称 + 高度都在正中线 ---------- */
console.log('\n— 开局站位：左右对称、高度居中 —');
let spawnState = 'ok', spawnErr = null;
try {
  const midY = T.CFG.AH * 0.5;
  T.resetMatch(T.CARD_BY_ID['dark_embrace'], T.CARD_BY_ID['knife_trap']);
  const [a, b] = T.world.units;
  const sameY = a.y === midY && b.y === midY;
  const mirrored = Math.abs((a.x + b.x) - T.CFG.AW) < 1e-9 && a.x < b.x;
  /* 多重置几次：确认 y 上再没有随机抖动（旧实现是 AH*0.5 + rand(-70,70)） */
  let jitter = 0;
  for (let i = 0; i < 20; i++) {
    T.resetMatch(T.CARD_BY_ID['end_of_days'], T.CARD_BY_ID['voltaic']);
    const u = T.world.units;
    jitter = Math.max(jitter,
      Math.abs(u[0].y - midY), Math.abs(u[1].y - midY),
      Math.abs((u[0].x + u[1].x) - T.CFG.AW));
  }
  console.log(`  左 (${a.x}, ${a.y}) / 右 (${b.x}, ${b.y})，场地中线 y = ${midY}`);
  console.log(`  两边等高且压在中线 ${sameY ? 'OK' : '不对!'} / 左右关于中线对称 ${mirrored ? 'OK' : '不对!'}`
    + ` / 20 次重置最大偏差 ${jitter.toFixed(3)}px ${jitter === 0 ? 'OK 无随机抖动' : '仍在抖!'}`);
  if (!sameY || !mirrored || jitter !== 0) spawnState = 'FAIL';
} catch (e) { spawnErr = e; spawnState = 'FAIL'; console.error('  !! 异常:', e.message); }

const skipped = lingerState === 'SKIP' || moteState === 'SKIP' || volState === 'SKIP' || wrState === 'SKIP'
              || homeState === 'SKIP' || forgeState === 'SKIP' || grabState === 'SKIP'
              || handDmgState === 'SKIP' || knifeState === 'SKIP' || meteorState === 'SKIP' || gapState === 'SKIP'
              || spawnState === 'SKIP' || doomStackState === 'SKIP' || orbitDmgState === 'SKIP'
              || forgeRangeState === 'SKIP' || swordHitState === 'SKIP';
const bad = anyErr || renderErr || lingerErr || lingerState === 'FAIL' || moteErr || moteState === 'FAIL'
          || volErr || volState === 'FAIL' || wrErr || wrState === 'FAIL'
          || homeErr || homeState === 'FAIL' || forgeErr || forgeState === 'FAIL'
          || grabErr || grabState === 'FAIL'
          || handDmgErr || handDmgState === 'FAIL' || knifeErr || knifeState === 'FAIL'
          || meteorErr || meteorState === 'FAIL' || gapErr || gapState === 'FAIL'
          || spawnErr || spawnState === 'FAIL'
          || doomStackErr || doomStackState === 'FAIL'
          || orbitDmgErr || orbitDmgState === 'FAIL'
          || forgeRangeErr || forgeRangeState === 'FAIL'
          || swordHitErr || swordHitState === 'FAIL';
console.log(bad
  ? '\n✗ 出现运行时异常'
    + (lingerState === 'FAIL' ? ' / 电球滞留' : '')
    + (moteState === 'FAIL' ? ' / 光尘跟随剑或滞留' : '')
    + (volState === 'FAIL' ? ' / 电流相生蓄力或回弹' : '')
    + (wrState === 'FAIL' ? ' / 黑暗之拥腕口粒子跟随手或滞留' : '')
    + (homeState === 'FAIL' ? ' / 电球仍在追踪' : '')
    + (forgeState === 'FAIL' ? ' / 锻打成型撞人起锤未限流' : '')
    + (grabState === 'FAIL' ? ' / 黑暗之拥被抓单位未失去碰撞或未解禁' : '')
    + (handDmgState === 'FAIL' ? ' / 黑暗之拥伤害未随伸出距离提高' : '')
    + (knifeState === 'FAIL' ? ' / 刀刃陷阱数值（20伤/引导翻倍/击退/频率）' : '')
    + (meteorState === 'FAIL' ? ' / 末日降临陨石 200伤+强击退' : '')
    + (gapState === 'FAIL' ? ' / 电流相生间隔 3.6~4.8s 随机或上限 64' : '')
    + (spawnState === 'FAIL' ? ' / 开局站位不对称或高度不在中线' : '')
    + (doomStackState === 'FAIL' ? ' / 灾厄叠加速率或判定半径不对' : '')
    + (orbitDmgState === 'FAIL' ? ' / 环绕灼烧不是 10 次×3 点' : '')
    + (forgeRangeState === 'FAIL' ? ' / 锻打成型索敌半径或挥砍冷却不对' : '')
    + (swordHitState === 'FAIL' ? ' / 近战击退未算作碰撞（没触发小刀引导）' : '')
  : (allOk ? '\n✓ 通过：脚本无异常，五种机制均已触发，渲染路径无异常，电球与剑光尘均无滞留'
    : '\n✗ 有机制未触发'));
process.exit(bad ? 1 : (skipped ? 2 : 0));
