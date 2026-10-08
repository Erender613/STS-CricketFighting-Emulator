/**
 * 渲染冒烟测试：给一个"什么方法都有的"假 2D 上下文，让 drawArena 真的把每一帧画一遍。
 * simcheck 的 drawArena 在无渲染模式下第一句就 return，所以它其实没验证过新卡的
 * 绘制代码（五角星法阵 / 分身 / 君王之剑 / 等离子球 / 陨石 / 灵魂风暴）。
 * 用法: node tools/_render_check.js
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

const HTML = path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const blocks = (fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = blocks.sort((a, b) => b.length - a.length)[0];
src += `\n/* 给新机制的类套一层计数壳：确认冒烟测试真的把它们造出来并画过。
   class 绑定在词法作用域里，外面拿不到，只能在脚本内部原地替换。 */\n`
  + `globalThis.__seen = (function () {\n`
  + `  const seen = {};\n`
  + `  const wrap = function (name, K) { return class extends K { constructor() { super(...arguments); seen[name] = (seen[name] || 0) + 1; } }; };\n`
  + `  Pentagram = wrap('Pentagram', Pentagram);\n`
  + `  ReplicaUnit = wrap('ReplicaUnit', ReplicaUnit);\n`
  + `  WhitePierce = wrap('WhitePierce', WhitePierce);\n`
  + `  TrackingBlade = wrap('TrackingBlade', TrackingBlade);\n`
  + `  SoulUnit = wrap('SoulUnit', SoulUnit);\n`
  + `  SoulStormFx = wrap('SoulStormFx', SoulStormFx);\n`
  + `  SoulWispStream = wrap('SoulWispStream', SoulWispStream);\n`
  + `  PlasmaOrb = wrap('PlasmaOrb', PlasmaOrb);\n`
  + `  BigMeteor = wrap('BigMeteor', BigMeteor);\n`
  + `  MeteorSmoke = wrap('MeteorSmoke', MeteorSmoke);\n`
  + `  SummonedFoe = wrap('SummonedFoe', SummonedFoe);\n`
  + `  Zap = wrap('Zap', Zap);\n`
  + `  return seen;\n`
  + `})();\n`
  /* 血条计数器：drawUnitHUD 里每画一条十字血条就 +1。
     用来断言"余像的分身不画血条"——分身在场时，画出来的血条数必须
     严格少于场上该画 HUD 的单位数（少掉的就是分身）。 */
  + `globalThis.__hud = { calls: 0 };\n`
  + `{ const __dc = drawCrossHP;\n`
  + `  drawCrossHP = function () { globalThis.__hud.calls++; return __dc.apply(this, arguments); }; }\n`
  + `\nglobalThis.__T = { world, CFG, CARD_BY_ID, CARDS, stepPhysics, resetMatch, drawArena, drawUnitHUD, fit, loadAll, IMG, ASSET_MAP,\n`
  + `  SB, SB_TIP_OFF, PlasmaOrb, SoulStormFx, SoulWispStream, SummonedFoe,\n`
  + `  setCtx: function (c) { cx = c; },\n`
  + `  setScale: function (s) { SCALE = s; },\n`
  + `  getScale: function () { return SCALE; },\n`
  + `  getCv: function () { return cv; },\n`
  + `  setCv: function (c) { cv = c; } };\n`
  /* 状态文字采集：ctxStrokeText 是所有"头顶状态文字"的唯一出口（drawUnitHUD 的
     非仆从分支与仆从分支都走它）。把它包一层，记录【每次画的时候场上都有谁】——
     用来断言"祭品召唤出来的友军也会显示自己的状态文字"。 */
  + `globalThis.__txt = { log: [] };\n`
  + `{ const __ct = ctxStrokeText;\n`
  + `  ctxStrokeText = function (t, x, y, sc, sw, fc) {\n`
  + `    globalThis.__txt.log.push({ t: String(t), fc: fc,\n`
  + `      units: world.units.filter(function (u) { return u.alive && !u.dying; })\n`
  + `        .map(function (u) { return { id: u.card.id, minion: !!u.minion, x: u.x, y: u.y, summoned: !!u.summoned }; }) });\n`
  + `    return __ct.apply(this, arguments);\n`
  + `  }; }\n`;

/* 记录被调用过的绘制方法名与 drawImage 用到的贴图键，用来断言"该画的都画了" */
const called = new Set();
const drawnKeys = new Map();      // 贴图键 -> 次数
const drawnAlpha = new Map();     // 贴图键 -> 画它时用的最小 globalAlpha（验"半透明"）
const alphaLog = [];              // 本帧每次 drawImage 的 {k, a}（逐帧清空，验"分身半透明"）
let lastDrawKey = null;
const grad = () => ({ addColorStop() { } });
function ctx2d() {
  const stack = [];                 // globalAlpha 的存档栈（save/restore 真的能用）
  const target = {
    canvas: { width: 660, height: 660 },
    createLinearGradient: grad, createRadialGradient: grad, createPattern: () => null,
    measureText: () => ({ width: 10 }),
    setTransform() { },
    save() { stack.push(target.globalAlpha); },
    restore() { if (stack.length) target.globalAlpha = stack.pop(); },
    translate() { }, rotate() { }, scale() { },
    clearRect() { }, fillRect() { }, strokeRect() { }, fillText() { }, strokeText() { },
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, arcTo() { }, rect() { },
    fill() { }, stroke() { }, clip() { }, setLineDash() { }, getImageData() { return { data: [] }; },
    drawImage(img) {
      /* 反过来找这张假图对应哪个贴图键（IMG 里的值是同一批 Im 实例）。
         另外：游戏里 tinted()/GREY/WHITE 会 createElement('canvas') 把原图重画一遍
         （余像的分身就是画 tinted 版本），那张 canvas 上没有 __key —— 这里顺手把
         "往这个元素里画了什么键"记在元素上，重画出来的 canvas 就继承了同一个键。 */
      if (img && img.__key) {
        if (target.__el) target.__el.__key = img.__key;
        drawnKeys.set(img.__key, (drawnKeys.get(img.__key) || 0) + 1);
        const a = (typeof target.globalAlpha === 'number') ? target.globalAlpha : 1;
        alphaLog.push({ k: img.__key, a });
        const prev = drawnAlpha.has(img.__key) ? drawnAlpha.get(img.__key) : 1;
        if (a < prev) drawnAlpha.set(img.__key, a);
      }
    },
  };
  return new Proxy(target, {
    get(o, k) {
      if (k in o) { called.add(k); return o[k]; }
      called.add(String(k));
      return () => { };
    },
    set(o, k, v) { o[k] = v; called.add('set:' + String(k)); return true; },
    has() { return true; },
  });
}
function stubEl() {
  const el = {
    style: {}, dataset: {}, children: [], disabled: false, textContent: '', title: '',
    clientWidth: 700, clientHeight: 700, innerHTML: '',
    classList: { add() { }, remove() { }, toggle() { } },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { width: 700, height: 700, top: 0, left: 0 }; },
    setAttribute() { }, getAttribute() { return null; },
    getContext() { const c = ctx2d(); c.__el = el; return c; }, closest() { return null; }, parentElement: null,
  };
  el.parentElement = el; el.parentElement.clientWidth = 700;
  return el;
}
class P2 { moveTo() { } lineTo() { } arcTo() { } closePath() { } rect() { } arc() { } }
class Im {
  constructor() { this.naturalWidth = 300; this.naturalHeight = 423; this.width = 300; this.height = 423; }
  addEventListener(t, f) { if (t === 'load') setTimeout(f, 0); }
}
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

/* 让 IMG 里每一项都变成"已加载的假图"（loadAll 是异步的，直接灌一份更快），
   再把真 canvas / 2D 上下文塞进模块作用域 —— 否则 drawArena 第一句就 return。 */
const imgN = Object.keys((T.ASSET_MAP && T.ASSET_MAP.img) || {}).length;
Object.keys((T.ASSET_MAP && T.ASSET_MAP.img) || {}).forEach(k => { const im = new Im(); im.__key = k; T.IMG[k] = im; });
console.log('贴图键数:', imgN, ' IMG 已填:', Object.keys(T.IMG).length);
const fakeCv = stubEl();
fakeCv.width = 660; fakeCv.height = 660;
fakeCv.parentElement.clientWidth = 660;
T.setCv(fakeCv);
T.setCtx(ctx2d());
T.setScale(1);
console.log('渲染上下文就位:', !!T.getCv());

/* 关键一步：boot() 时 cv 的 getContext 返回 null，于是 cx 被置空、drawArena 直接 return。
   这里把 cv 换成"有尺寸 + 有 2D 上下文"的假 canvas（cv / cx 是模块内的 let 绑定，
   必须通过脚本里暴露的 setter 才改得到）。 */
T.fit();
console.log('SCALE=', T.getScale());

const NEW = ['offering', 'afterimage', 'tracking', 'soul_storm', 'meteor_strike'];
const ALL = T.CARDS.map(c => c.id);
const pairs = [];
/* 强制让新卡两两 + 与老卡对打，并且必须跑满 60 秒（把每个机制的各个阶段都画到） */
for (const a of NEW) for (const b of ALL) if (a !== b) pairs.push([a, b]);

let frames = 0, errs = [];
for (const [a, b] of pairs) {
  T.resetMatch(T.CARD_BY_ID[a], T.CARD_BY_ID[b]);
  T.world.running = true;
  const dt = 1 / 60;
  let n = 0;
  try {
    while (T.world.t < 55 && !T.world.over && n < 55 * 60 + 5) {
      T.world.t += dt;
      T.stepPhysics(dt);
      n++;
      if (n % 7 === 0) { T.drawArena(); T.drawUnitHUD(); frames++; }
    }
    T.drawArena(); T.drawUnitHUD();
  } catch (e) {
    errs.push(`${a} vs ${b}: ${e.message}\n${String(e.stack).split('\n').slice(1, 4).join('\n')}`);
  }
}
console.log(`对局 ${pairs.length} 组，绘制 ${frames} 帧`);
const trk = sandbox.__seen.TrackingBlade || 0;
console.log(`含「追踪之刃」的对局 = ${pairs.filter(p => p[0] === 'tracking' || p[1] === 'tracking').length}，造出的君王之剑 = ${trk}`);
if (errs.length) {
  console.log('!! 绘制异常:');
  errs.slice(0, 8).forEach(e => console.log('  ', e));
  process.exit(1);
}
const need = ['Pentagram', 'ReplicaUnit', 'WhitePierce', 'TrackingBlade', 'SoulUnit', 'SoulStormFx', 'PlasmaOrb', 'BigMeteor', 'MeteorSmoke', 'SummonedFoe'];
const seenNames = sandbox.__seen || {};
console.log('新机制实体出现情况:');
let miss = [];
for (const k of need) {
  const v = seenNames[k] || 0;
  console.log('   ', k.padEnd(14), v);
  if (!v) miss.push(k);
}
if (miss.length) { console.log('!! 未覆盖:', miss.join(', ')); process.exit(1); }

/* ---- 视觉断言：这几条是用户反馈里逐条点出来的，钉住别再退回去 ---- */
let bad = 0;
function chk(name, ok, extra) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) bad++;
}
console.log('视觉断言:');
/* ① 灵魂必须用带卡框的卡面（card_soul），不能再用光秃秃的 sp_soul_unit */
chk('灵魂用带卡框的 card_soul', (drawnKeys.get('card_soul') || 0) > 0, `画了 ${drawnKeys.get('card_soul') || 0} 次`);
chk('旧的无框灵魂贴图已不再使用', !drawnKeys.has('sp_soul_unit'));
/* ② 余像的分身要画出来（跟本体同一张卡面） */
chk('余像分身有绘制', (seenNames.ReplicaUnit || 0) > 0 && (drawnKeys.get('card_afterimage') || 0) > 0);
/* ③ 追踪之刃的新卡面（SeekingEdge 原画）必须真的烘进卡面里 */
chk('追踪之刃卡面已绘制', (drawnKeys.get('card_tracking') || 0) > 0);
/* ④ 等离子球 / 陨石 */
chk('等离子球贴图已绘制', (drawnKeys.get('sp_plasma_orb') || 0) > 0);
chk('陨石贴图已绘制', (drawnKeys.get('sp_meteor_rock') || 0) > 0);
/* ⑤ 格挡徽标图标 */
chk('格挡图标 pw_block 已绘制', (drawnKeys.get('pw_block') || 0) > 0);
/* ⑥ 分身必须是【真单位】——在 world.units 里、有血条、会被索敌。
     这是用户明确纠正过的一条："和正常卡牌无区别，会被敌人索敌和碰撞"。 */
let sawReplicaInUnits = 0, sawReplicaAlive = 0;
for (const [a, b] of pairs) {
  T.resetMatch(T.CARD_BY_ID[a], T.CARD_BY_ID[b]);
  for (let i = 0; i < 3600; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    const reps = T.world.units.filter(u => u.replica);
    sawReplicaInUnits += reps.length ? 1 : 0;
    if (reps.some(u => u.alive && !u.dying)) sawReplicaAlive++;
  }
}
chk('分身进 world.units（可被索敌/碰撞）', sawReplicaInUnits > 0, `${sawReplicaInUnits} 帧里有分身在场`);
/* ⑥b 2026 修订：分身【不显示血条】+【半透明】+【原地消散】。
   血条用 drawCrossHP 计数断言：分身在场时画出来的血条数必须少于场上单位数。 */
let hudLess = 0, hudFrames = 0, clAlphaOk = 0, clAlphaWorst = 1;
for (const [a, b] of pairs) {
  if (a !== 'afterimage' && b !== 'afterimage') continue;
  T.resetMatch(T.CARD_BY_ID[a], T.CARD_BY_ID[b]);
  for (let i = 0; i < 1800; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    if (i % 11) continue;
    const live = T.world.units.filter(u => u.replica && u.alive && !u.dying).length;
    if (!live) continue;
    const hudUnits = T.world.units.filter(u => (u.alive || u.dying) && !u.finished).length;
    sandbox.__hud.calls = 0;                 // drawArena 内部会自己调一次 drawUnitHUD
    alphaLog.length = 0;
    T.drawArena();
    hudFrames++;
    if (sandbox.__hud.calls < hudUnits) hudLess++;      // 少画的就是分身
    /* 分身活着时，card_afterimage 至少有一次是【半透明】画的（本体那一张是 1.0） */
    const reps = alphaLog.filter(e => e.k === 'card_afterimage');
    const trans = reps.filter(e => e.a > 0.15 && e.a <= 0.6);
    const mx = trans.length ? Math.max(...trans.map(e => e.a)) : 1;
    if (trans.length) clAlphaOk++;
    if (mx < clAlphaWorst) clAlphaWorst = mx;
  }
}
chk('分身不画十字血条', hudFrames > 0 && hudLess === hudFrames,
    `${hudLess}/${hudFrames} 帧里血条数少于场上单位数`);
chk('分身半透明（活着时以 alpha ≤ 0.6 画卡面）', hudFrames > 0 && clAlphaOk === hudFrames,
    `${clAlphaOk}/${hudFrames} 帧里出现半透明分身，最亮 ${clAlphaWorst.toFixed(2)}`);
/* ⑥c 分身被打到要【原地消散】：消散后速度与击退加速清零、curSpeed 归零 */
let disperseOk = 0, disperseSeen = 0;
for (const [a, b] of pairs) {
  if (a !== 'afterimage' && b !== 'afterimage') continue;
  T.resetMatch(T.CARD_BY_ID[a], T.CARD_BY_ID[b]);
  for (let i = 0; i < 2400; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    const r = T.world.units.find(u => u.replica && u.cDispersed);
    if (!r || r.__chk) continue;
    r.__chk = 1; disperseSeen++;
    const x0 = r.x, y0 = r.y;
    for (let k = 0; k < 30; k++) { T.world.t += 1 / 60; T.stepPhysics(1 / 60); }
    if (r.curSpeed() === 0 && Math.hypot(r.x - x0, r.y - y0) < 1) disperseOk++;
  }
}
chk('分身被打到后原地消散（0 速、原地不动）', disperseSeen > 0 && disperseOk === disperseSeen,
    `${disperseOk}/${disperseSeen} 个消散的分身留在原地`);

/* ⑥d 2026 修订：光被敌人【撞到】不算挨打（撞上就是弹开），只有真的吃伤害才碎裂 */
{
  const p = T.CARD_BY_ID.afterimage.p;
  T.resetMatch(T.CARD_BY_ID.afterimage, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  const A = T.world.units[0], B = T.world.units[1];
  let rep = null;
  for (let i = 0; i < 600 && !rep; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    rep = T.world.units.find(u => u.replica && u.alive && !u.dying);
  }
  let touchOk = false, touched = '', bounced = 0;
  if (rep) {
    /* 把双方机制停掉，只留纯碰撞：不该有任何伤害路径插手 */
    A.mech.update = () => { }; B.mech.update = () => { };
    B.x = rep.x; B.y = rep.y;                     // 敌人【直接压在分身身上】
    B.dx = 0; B.dy = 0;
    const hp0 = rep.hp;
    for (let i = 0; i < 40; i++) {
      T.world.t += 1 / 60;
      if (i % 4 === 0) { B.x = rep.x; B.y = rep.y; }   // 持续压着（模拟"撞上"）
      T.stepPhysics(1 / 60);
    }
    const d = Math.hypot(B.x - rep.x, B.y - rep.y);
    bounced = d;
    touchOk = !rep.cDispersed && !rep.dying && rep.hp === hp0 && d > p.cR + T.CFG.R * 0.6;
    touched = `分身 HP ${hp0}→${rep.hp}、cDispersed=${!!rep.cDispersed}、被推开 ${d.toFixed(0)}px`;
  } else touched = '没能造出分身';
  chk('敌人撞上分身：只弹开、不碎裂不反伤', touchOk, touched);

/* ⑥e 2026 修订：反伤【锁定敌方本体】——被远程伤害/召唤物打中时也必须砸到本体；
       （另外分身头顶不再有任何文字） */
{
  const p = T.CARD_BY_ID.afterimage.p;
  let bodyHitOk = 0, bodyHitSeen = 0, info = '';
  for (const opp of ['charge', 'voltaic', 'knife_trap']) {
    T.resetMatch(T.CARD_BY_ID.afterimage, T.CARD_BY_ID[opp]);
    T.world.running = true;
    const B = T.world.units[1];
    for (let i = 0; i < 1800; i++) {
      T.world.t += 1 / 60; T.stepPhysics(1 / 60);
      const rep = T.world.units.find(u => u.replica && u.alive && !u.dying);
      if (!rep) continue;
      /* 把分身挪到角落、本体挪到对角，再用一个"非本体"的敌方单位打它一下：
         此时只有"锁定敌方本体"这条规则能让本体掉血 */
      rep.x = 40; rep.y = 40;
      const minion = T.world.units.find(u => u.minion && u.team === 1 && u.alive && !u.dying);
      B.x = T.CFG.AW - 60; B.y = T.CFG.AH - 60;          // 本体离得远远的
      const hp0 = B.hp;
      rep.damage(10, 'hit', minion || B);                // 模拟"远程伤害/召唤物命中"
      const lost = hp0 - B.hp;
      bodyHitSeen++;
      if (lost === p.pierceDmg) bodyHitOk++;
      else if (!info) info = `${opp}: 本体只掉了 ${lost}（期望 ${p.pierceDmg}，src=${minion ? '召唤物' : '本体'}）`;
      break;
    }
  }
  chk('分身被打中：反伤锁定敌方本体（无论谁打的）', bodyHitSeen > 0 && bodyHitOk === bodyHitSeen,
      bodyHitOk === bodyHitSeen ? `${bodyHitOk}/${bodyHitSeen} 次都把 ${p.pierceDmg} 打到本体上` : info);
}
{
  T.resetMatch(T.CARD_BY_ID.afterimage, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  let allNull = true, seen = 0;
  for (let i = 0; i < 1800; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    const m = T.world.units[0].mech;
    if (!m || !m.statusText) continue;
    seen++;
    if (m.statusText() !== null) allNull = false;       // 有分身/在冷却时都不给文字
  }
  chk('余像头顶不显示状态文字（无"分身240"/冷却读秒）', seen > 0 && allNull,
      `statusText() 全程返回 null（采样 ${seen} 次）`);
}
/* ⑥f 2026 修订：五张测试版卡牌头顶【一律不显示任何文字】 */
{
  const bad = [];
  for (const id of ['offering', 'afterimage', 'tracking', 'soul_storm', 'meteor_strike']) {
    const opp = id === 'perfected_strike' ? 'darkness' : 'perfected_strike';
    T.resetMatch(T.CARD_BY_ID[id], T.CARD_BY_ID[opp]);
    T.world.running = true;
    const m = T.world.units[0].mech;
    for (let i = 0; i < 900; i++) {
      T.world.t += 1 / 60; T.stepPhysics(1 / 60);
      if (m.statusText && m.statusText() !== null) { bad.push(id); break; }
    }
  }
  chk('五张测试版卡牌头顶都没有文字', bad.length === 0,
      bad.length ? `这些卡还在显示文字: ${bad.join(', ')}` : 'offering/afterimage/tracking/soul_storm/meteor_strike 全是 null');
}
/* ⑥f2 2026 用户口径：漆黑头顶的「暗黑球 N」文字【已去掉】。
   两条都要过：① statusText() 全程 null；② 真跑 drawUnitHUD()，采集到的头顶文字里
   不许出现任何含「暗黑球」的那条（防止哪天又从别处画回来）。 */
{
  T.resetMatch(T.CARD_BY_ID.darkness, T.CARD_BY_ID.perfected_strike, 20250921);
  T.world.running = true;
  const m = T.world.units[0].mech;
  const txt = sandbox.__txt;
  T.__txt = txt;
  let bad = null, frames = 0;
  for (let i = 0; i < 1800; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    frames++;
    if (m.statusText && m.statusText() !== null) { bad = 'statusText() 返回了 ' + JSON.stringify(m.statusText()); break; }
    txt.log.length = 0;
    T.drawUnitHUD();
    const hit = txt.log.find(e => /暗黑球/.test(String(e.t)));
    if (hit) { bad = '头顶画出了「' + hit.t + '」'; break; }
  }
  chk('漆黑头顶不再显示「暗黑球 N」', bad === null,
      bad === null ? `statusText() 全程 null，${frames} 帧的头顶文字里没有「暗黑球」` : bad);
}
/* ⑥g 格挡在【召唤分身的那一刻】就给（不是等被打碎） */
{
  const p = T.CARD_BY_ID.afterimage.p;
  T.resetMatch(T.CARD_BY_ID.afterimage, T.CARD_BY_ID.dark_embrace);
  T.world.running = true;
  const A = T.world.units[0];
  let ok = false, info = '';
  for (let i = 0; i < 400; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    const rep = T.world.units.find(u => u.replica && u.alive && !u.dying);
    if (!rep) continue;
    ok = A.block === p.blockGain;     // 分身在场 → 格挡恰好是"重置后的 20"
    info = `分身在场时本体 block=${Math.round(A.block)}（期望 = ${p.blockGain}）`;
    break;
  }
  chk('格挡在召唤分身时被重置为 20（不叠加）', ok, info || '没造出分身');
/* ⑥h 祭品的友军【绝不能打到主人】（用户实测："祭品被自己召唤的完美打击打了"）。
      做法：把每一张卡都当成召唤物造一份，直接把"碰撞回调"喂给它，
      主人（祭品）的 HP / 格挡 / 状态必须一点不变。 */
{
  T.resetMatch(T.CARD_BY_ID.offering, T.CARD_BY_ID.soul_storm);
  T.world.running = true;
  const A = T.world.units[0];
  const op = T.CARD_BY_ID.offering.p;
  const bad = [];
  const SNAP = u => ({ hp: u.hp, block: u.block, vuln: u.vuln, weak: u.weak, doom: u.doom, poison: u.poison, focus: u.focus });
  for (const c of T.CARDS) {
    if (c.id === 'offering') continue;                 // 祭品不会召唤自己
    const foe = new T.SummonedFoe(A, c, A.x + 220, A.y + 30, op);
    T.world.units.push(foe);
    const m = foe.mech;
    const before = SNAP(A);
    /* 有些机制只在"正在打"的状态下才结算碰撞 —— 把可能的状态都摆一遍 */
    for (const st of ['dash', 'pounce', 'ram', 'strike', 'fly', 'idle']) {
      if (m.state !== undefined) m.state = st;
      if (m.hit !== undefined) m.hit = false;
      if (m.ram !== undefined) m.ram = 1;
      if (m.hitCd !== undefined) m.hitCd = 0;
      if (m.cd2 !== undefined) m.cd2 = 0;
      if (typeof m.onUnitHit === 'function') { try { m.onUnitHit(A); } catch (e) { /* 状态不对就算了 */ } }
    }
    const after = SNAP(A);
    const changed = Object.keys(before).some(k => before[k] !== after[k]);
    if (changed) bad.push(`${c.id}（HP ${before.hp}→${after.hp} 格挡 ${before.block}→${after.block}）`);
    foe.kill();
  }
  chk('祭品的友军撞到主人不造成任何伤害/状态', bad.length === 0,
      bad.length ? `这些卡会误伤主人: ${bad.join(', ')}` : `${T.CARDS.length - 1} 张卡逐个试过，主人毫发无损`);
}
}
}

/* ⑦ 敌人真的会把分身当目标（索敌能选到它） */
let targeted = 0;
for (const [a, b] of pairs) {
  T.resetMatch(T.CARD_BY_ID[a], T.CARD_BY_ID[b]);
  for (let i = 0; i < 1200; i++) { T.world.t += 1 / 60; T.stepPhysics(1 / 60); }
  const e = T.world.units.find(u => u.team === 1);
  const rep = T.world.units.find(u => u.replica && u.alive);
  if (e && rep && T.world.enemyOf(e) === rep) targeted++;
}
chk('敌人索敌可以选中分身', targeted > 0, `${targeted} 组对局里"离敌人最近的那个"是分身`);

/* ⑧ 追踪之刃：君王之剑
   ① 剑长 = 烘图几何（≈161，不再是写死的 320）；
   ② 飞刺目标 =【碰撞点本身】（必须在墙上，不能被"朝敌人偏一点"带跑）；
   ③ 插墙时【墙卡在剑身中点】（剑身有一半插进墙里）。 */
const expectTip = Math.abs(T.SB.RB[1]) * T.SB.K;
/* 线段被矩形裁剪后剩下的长度（Liang-Barsky）——用来量"场内看得见多长的剑身" */
function clipLen(x0, y0, x1, y1, rx0, ry0, rx1, ry1) {
  const dx = x1 - x0, dy = y1 - y0;
  let t0 = 0, t1 = 1;
  const P = [-dx, dx, -dy, dy];
  const Q = [x0 - rx0, rx1 - x0, y0 - ry0, ry1 - y0];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return 0; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return 0; if (r > t0) t0 = r; }
    else { if (r < t0) return 0; if (r < t1) t1 = r; }
  }
  return Math.hypot(dx, dy) * (t1 - t0);
}
chk('君王之剑长度 = 烘图几何（≈161，不再是 320）',
    Math.abs(T.SB_TIP_OFF - expectTip) < 1e-6 && T.SB_TIP_OFF > 140 && T.SB_TIP_OFF < 190,
    `SB_TIP_OFF=${T.SB_TIP_OFF.toFixed(1)}（旧值 320）`);
{
  let aimOnWall = 0, aimSeen = 0, midOk = 0, midSeen = 0, maxMidErr = 0;
  let insideOk = 0, slashSeen = 0, minInside = 1e9;
  let pivotOk = 0, pivotSeen = 0;
  let keepOk = 0, keepSeen = 0, maxKeepErr = 0, lastFlyAng = null;
  /* 首次召唤的入场方向：起点必须在屏幕外、在"场地内侧方向"那一侧（不是墙后方）、
     而且飞行方向不能几乎与墙平行 */
  let spawnSeen = 0, spawnFarOk = 0, spawnOutOk = 0, spawnSideOk = 0, spawnPerpOk = 0, minPerp = 180;
  const wrapPiLocal = a => Math.atan2(Math.sin(a), Math.cos(a));
  const wallDist = (x, y) => Math.min(x, T.CFG.AW - x, y, T.CFG.AH - y);
  /* 墙的内法线（和 TrackingBlade.wallNormal 同一套判据） */
  const wallNormal = (x, y) => x <= 6 ? [1, 0] : x >= T.CFG.AW - 6 ? [-1, 0]
                       : y <= 6 ? [0, 1] : y >= T.CFG.AH - 6 ? [0, -1] : null;
  for (const opp of ['perfected_strike', 'voltaic', 'dark_embrace']) {
    T.resetMatch(T.CARD_BY_ID.tracking, T.CARD_BY_ID[opp]);
    T.world.running = true;
    const m = T.world.units[0].mech;
    let prevBlade = null;
    for (let i = 0; i < 3000; i++) {
      T.world.t += 1 / 60; T.stepPhysics(1 / 60);
      const b = m.blade;
      /* ① 第一次召唤：刚出现的这一帧（state='fly'，还没移动过）记下入场几何 */
      if (b && b !== prevBlade && b.state === 'fly') {
        const px = b.tx, py = b.ty;                       // 碰撞点
        const n = wallNormal(px, py);
        const offX = b.x - px, offY = b.y - py;
        const offLen = Math.hypot(offX, offY);
        spawnSeen++;
        if (offLen > 700) spawnFarOk++;                   // 从"较远处"飞来
        if (b.x < 0 || b.x > T.CFG.AW || b.y < 0 || b.y > T.CFG.AH) spawnOutOk++;   // 屏幕外
        /* 起点在【场地内侧】方向（dot>0），不是"当前墙的后方" */
        if (n && (offX * n[0] + offY * n[1]) / (offLen || 1) > 0.9) spawnSideOk++;
        /* 飞行方向与墙面的夹角：接近垂直（≈180°），不能几乎平行 */
        if (n) {
          const dotv = Math.cos(b.ang) * n[0] + Math.sin(b.ang) * n[1];   // 期望 ≈ -1
          const deg = Math.acos(Math.max(-1, Math.min(1, dotv))) * 180 / Math.PI;
          if (deg < minPerp) minPerp = deg;
          if (deg > 160) spawnPerpOk++;
        }
      }
      prevBlade = b;
      if (!b) continue;
      /* ② 换趟后的目标点必须落在某面墙上（碰撞点一定在墙上） */
      if (b.state === 'rise' || b.state === 'spin' || b.state === 'fly2') {
        aimSeen++;
        if (wallDist(b.tx, b.ty) <= 8) aimOnWall++;
      }
      /* ②b 旋转轴心 = 剑身中点：剑格与剑尖到轴心 (x,y) 的距离都应该 ≈ 剑长/2 */
      if (b.state === 'spin') {
        pivotSeen++;
        const A3 = b.bladeAnchor();
        const t3x = A3.x + Math.cos(b.ang) * T.SB_TIP_OFF, t3y = A3.y + Math.sin(b.ang) * T.SB_TIP_OFF;
        const d1 = Math.hypot(A3.x - b.x, A3.y - b.y), d2 = Math.hypot(t3x - b.x, t3y - b.y);
        if (Math.abs(d1 - T.SB_TIP_OFF / 2) < 0.5 && Math.abs(d2 - T.SB_TIP_OFF / 2) < 0.5) pivotOk++;
      }
      /* ③ 插稳之后：
            · 碰撞点必须是剑身中点（两侧各 = SB_TIP_OFF/2 → "一半插进墙里"）；
            · 入射角【保留】（插上以后朝向不再变化）；
            · 斜着插进来的那些样本，场内可见长度应该正好是半个剑身。 */
      if (b.state === 'stuck') {
        midSeen++;
        const A2 = b.bladeAnchor();
        const tipX = A2.x + Math.cos(b.ang) * T.SB_TIP_OFF;
        const tipY = A2.y + Math.sin(b.ang) * T.SB_TIP_OFF;
        const dHilt = Math.hypot(A2.x - b.x, A2.y - b.y);       // 剑格 → 碰撞点
        const dTip = Math.hypot(tipX - b.x, tipY - b.y);        // 碰撞点 → 剑尖
        const err = Math.abs(dHilt - dTip);
        if (err > maxMidErr) maxMidErr = err;
        if (dHilt > T.SB_TIP_OFF * 0.4 && dTip > T.SB_TIP_OFF * 0.4) midOk++;
        /* 入射角保留：和"刚插上的那一帧"的朝向完全一致 */
        if (lastFlyAng !== null) {
          const keepErr = Math.abs(wrapPiLocal(b.ang - lastFlyAng)) * 180 / Math.PI;
          if (keepErr > maxKeepErr) maxKeepErr = keepErr;
          keepSeen++;
          if (keepErr < 0.01) keepOk++;
        }
        /* 旋转轴心 = 剑身中点（在 ②b 里按 spin 帧单独统计） */
        const n = wallNormal(b.x, b.y);
        if (n) {
          const dot = Math.cos(b.ang) * n[0] + Math.sin(b.ang) * n[1];   // 期望 ≈ -1
          const deg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
          const fromWall = Math.abs(90 - deg);              // 0 = 完全平行于墙
          /* 真正量一下"场内能看见多长的剑身"：把剑身线段按场地矩形裁剪 */
          const vis = clipLen(A2.x, A2.y, tipX, tipY, 0, 0, T.CFG.AW, T.CFG.AH);
          if (vis < minInside) minInside = vis;
          /* 斜插（离墙面 >45°）时应该正好看得见一半；贴着墙面的那些样本不适用 */
          if (fromWall > 45) {
            slashSeen++;
            if (vis > T.SB_TIP_OFF * 0.35 && vis < T.SB_TIP_OFF * 0.62) insideOk++;
          }
        }
      }
      /* 记录"飞刺/召来阶段最后一帧"的朝向，供插墙后比对（验入射角保留） */
      if (b && (b.state === 'fly' || b.state === 'fly2')) lastFlyAng = b.ang;
      else if (b && b.state !== 'stuck') lastFlyAng = null;
      prevBlade = b;
    }
  }
  chk('飞刺目标 = 碰撞点（落在墙上）', aimSeen > 0 && aimOnWall === aimSeen,
      `${aimOnWall}/${aimSeen} 次换趟目标都在墙上`);
  chk('插墙时墙卡在剑身中点（一半在墙里）', midSeen > 0 && midOk === midSeen,
      `${midOk}/${midSeen} 次插稳时两侧长度相等（最大误差 ${maxMidErr.toFixed(2)}px，剑长 ${T.SB_TIP_OFF.toFixed(0)}）`);
  chk('插墙保留入射角（插上后朝向不再变）', keepSeen > 0 && keepOk === keepSeen,
      `${keepOk}/${keepSeen} 次与飞刺最后朝向一致（最大偏差 ${(maxKeepErr * 180 / Math.PI).toFixed(2)}°）`);
  chk('第一次召来：从屏幕外较远处飞来', spawnSeen > 0 && spawnFarOk === spawnSeen && spawnOutOk === spawnSeen,
      `${spawnFarOk}/${spawnSeen} 次距离 >700px，${spawnOutOk}/${spawnSeen} 次起点在屏幕外`);
  chk('第一次召来：不从当前墙后方、也不几乎平行', spawnSeen > 0 && spawnSideOk === spawnSeen && spawnPerpOk === spawnSeen,
      `${spawnSideOk}/${spawnSeen} 次起点在场地内侧方向，最小飞行夹角 ${minPerp.toFixed(1)}°（>160° 即不平行）`);
  chk('斜插时场内正好看得见半个剑身', slashSeen > 0 && insideOk === slashSeen && minInside > T.SB_TIP_OFF * 0.35,
      `${insideOk}/${slashSeen} 次可见长度落在剑长 35%~62%（全场最短 ${minInside.toFixed(1)}px / 剑长 ${T.SB_TIP_OFF.toFixed(0)}）`);
  chk('旋转轴心在剑身中间（两端各 ≈ 剑长/2）', pivotSeen > 0 && pivotOk === pivotSeen,
      `${pivotOk}/${pivotSeen} 帧旋转时轴心都在剑身中点`);
}

/* ⑨ 灵魂风暴：灵魂不可被索敌 / 出生 4 秒自灭 / 挨一下直接消散 / 风暴没有闪电特效 */
let soulNoTarget = 0, soulTargetN = 0;
for (const [a, b] of pairs) {
  if (a !== 'soul_storm' && b !== 'soul_storm') continue;
  T.resetMatch(T.CARD_BY_ID[a], T.CARD_BY_ID[b]);
  for (let i = 0; i < 2400; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    const souls = T.world.units.filter(u => u.soul && u.alive && !u.dying);
    const foe = T.world.units.find(u => u.team === 1);
    if (!souls.length || !foe) continue;
    soulTargetN++;
    /* 索敌（enemyOf）必须绕开灵魂；enemiesOf 里【仍然有】灵魂（被波及要能打到） */
    if (souls.every(s => T.world.enemyOf(foe) !== s)) soulNoTarget++;
  }
}
chk('灵魂不会被对方索敌（但会被攻击波及）', soulTargetN > 0 && soulNoTarget === soulTargetN,
    `${soulNoTarget}/${soulTargetN} 帧里敌人索敌都绕开了灵魂`);
/* 灵魂没有血条：和分身一样，HUD 里少画的就是它 */
{
  let hudLess = 0, hudFrames = 0;
  T.resetMatch(T.CARD_BY_ID.soul_storm, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  for (let i = 0; i < 3600; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    if (i % 13) continue;
    const souls = T.world.units.filter(u => u.soul && u.alive && !u.dying).length;
    if (!souls) continue;
    const hudUnits = T.world.units.filter(u => (u.alive || u.dying) && !u.finished).length;
    sandbox.__hud.calls = 0;
    T.drawArena();
    hudFrames++;
    if (sandbox.__hud.calls < hudUnits) hudLess++;
  }
  chk('灵魂不画十字血条', hudFrames > 0 && hudLess === hudFrames,
      `${hudLess}/${hudFrames} 帧里血条数少于场上单位数`);
}
/* 灵魂：出生 lifeT 秒自动消散 + 挨一下就直接消散（都不弹伤害数字） */
{
  const p = T.CARD_BY_ID.soul_storm.p;
  T.resetMatch(T.CARD_BY_ID.soul_storm, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  let ref = null, life = -1, hitOk = false, hitInfo = '';
  for (let i = 0; i < 3600; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    if (!ref) {
      ref = T.world.units.find(u => u.soul && u.alive && !u.dying);
      if (ref) continue;
    }
    if (ref && !ref.__dead && ref.dying) { ref.__dead = 1; life = ref.lifeT; }
    /* 另找一颗灵魂，直接给它一下：应当【立刻】消散、且不弹伤害数字 */
    const s2 = T.world.units.find(u => u.soul && u.alive && !u.dying && u !== ref);
    if (s2 && !hitOk) {
      const n0 = T.world.nums.length;
      s2.damage(5, 'hit', T.world.units[1]);
      T.world.t += 1 / 60; T.stepPhysics(1 / 60);
      const newHits = T.world.nums.slice(n0).filter(n => n.kind === 'hit').length;
      hitInfo = `挨一下后 dying=${!!s2.dying}，新增伤害数字 ${newHits} 个`;
      hitOk = !!s2.dying && newHits === 0;
    }
    if (life > 0 && hitOk) break;
  }
  chk(`灵魂出生 ${p.lifeT} 秒自动消散`, life > p.lifeT - 0.3 && life < p.lifeT + 0.6,
      `实测存活 ${life.toFixed(2)}s`);
  chk('灵魂受到攻击波及直接消散（不弹数字）', hitOk, hitInfo);
}
/* 风暴攻击不再有闪电特效（Zap）——用没有电系机制的对手，出现的 Zap 只可能来自风暴 */
{
  const zap0 = sandbox.__seen.Zap || 0;
  T.resetMatch(T.CARD_BY_ID.soul_storm, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  let stormSeen = 0;
  for (let i = 0; i < 5400; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    if (T.world.effects.some(e => e instanceof T.SoulStormFx)) stormSeen++;
  }
  const zaps = (sandbox.__seen.Zap || 0) - zap0;
  chk('风暴攻击没有闪电特效', stormSeen > 0 && zaps === 0,
      `风暴在场 ${stormSeen} 帧、生成的 Zap 共 ${zaps} 个`);
}
/* ⑨c 已有风暴时灵魂消散的水口：先出一串"灵魂归巢"粒子飞向风眼，
       飞到中心（动画播完）才真的强化；风眼半径是平滑长大而非一跳到位。 */
{
  T.resetMatch(T.CARD_BY_ID.soul_storm, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  let storm = null, brief = null, bonusAtSpawn = -1, coreAtSpawn = 0, fromCenter = 0;
  for (let i = 0; i < 7200 && !brief; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    if (!storm) { storm = T.world.effects.find(e => e instanceof T.SoulStormFx) || null; continue; }
    const st = T.world.effects.find(e => e instanceof T.SoulWispStream);
    if (!st) continue;
    brief = st; bonusAtSpawn = storm.bonus; coreAtSpawn = storm.core;
    fromCenter = Math.hypot(st.sx - st.tx, st.sy - st.ty);
  }
  let held = false, arrived = false, coreAfter = 0, settled = 0, midGrow = false, info = '';
  if (brief) {
    /* 动画进行中（未播完）风暴不能已经强化 */
    for (let i = 0; i < 20; i++) {                     // ~0.33s < 0.62s 飞行时长
      T.world.t += 1 / 60; T.stepPhysics(1 / 60);
      if (T.world.effects.some(e => e instanceof T.SoulWispStream) && storm.bonus === bonusAtSpawn) held = true;
    }
    /* 再跑够时间：粒子应当已抵达并让 bonus +1，且风眼【还在半路上】 */
    const cap = storm.bonusCap;
    for (let i = 0; i < 120; i++) {                    // 共 2.3s
      T.world.t += 1 / 60; T.stepPhysics(1 / 60);
      if (i === 24) { coreAfter = storm.core; midGrow = storm.core > coreAtSpawn + 0.05 && storm.core < 46 + storm.bonus * 2.4 - 0.2; }
    }
    arrived = storm.bonus === (bonusAtSpawn >= cap ? cap : bonusAtSpawn + 1)
      && !T.world.effects.some(e => e instanceof T.SoulWispStream);
    settled = Math.abs(storm.core - (46 + storm.bonus * 2.4)) < 0.35;
    info = `起飞处距风眼 ${fromCenter.toFixed(0)}、bonus ${bonusAtSpawn}→${storm.bonus}、`
         + `风眼 ${coreAtSpawn.toFixed(1)}→${coreAfter.toFixed(1)}→${storm.core.toFixed(1)}（目标 ${(46 + storm.bonus * 2.4).toFixed(1)}）`;
  } else info = '没能观察到「灵魂归巢」粒子';
  chk('灵魂消散：先飞一串粒子到风眼，飞完才强化风暴', !!brief && held && arrived, info);
  chk('风暴中心（风眼）平滑扩大而非一跳', !!brief && midGrow && settled, info);
}
/* ⑨d 风暴诞生本身是一条 0.8s 的过渡：刚出现时风墙半径为 0（不打人、也不牵引），
       之后从中心撑开；同一枚系数同时喂给表现与判定，所以要"看到的范围"和
       "打得到的范围"一起长。这里把敌人钉在 0.6×radius 处：
       诞生头 0.1s（风墙才 ~71px）必须够不着，长完之后必须开始挨打。 */
{
  T.resetMatch(T.CARD_BY_ID.soul_storm, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  let storm = null;
  for (let i = 0; i < 7200 && !storm; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    storm = T.world.effects.find(e => e instanceof T.SoulStormFx) || null;
  }
  const p = T.CARD_BY_ID.soul_storm.p;
  const kSpawn = storm ? storm.bornK() : -1;
  const foe = T.world.units.find(u => u.team === 1);
  let mono = true, kFive = 0, kEnd = 0, earlySafe = false, lateHit = false, d0 = 0;
  if (storm && foe && storm.o && storm.o.mech) {
    d0 = p.radius * 0.6;
    const mech = storm.o.mech;
    mech.souls.length = 0;                    // 别让既有灵魂撞上靶子，干扰判定
    const hp0 = foe.hp;
    for (let i = 0; i < 54; i++) {            // 0.9s（> birthDur 0.8s）
      mech.cd = 99;                           // 压住新的召唤
      foe.x = storm.x + d0; foe.y = storm.y; foe.dx = 0; foe.dy = 0;
      T.world.t += 1 / 60; T.stepPhysics(1 / 60);
      const k = storm.bornK();
      if (k < kFive - 1e-9) mono = false;
      kFive = k;
      if (i === 5) { earlySafe = (foe.hp === hp0); kMid = k; }   // 0.1s：风墙 ~71px < 钉靶的 129px
      kEnd = k;
    }
    lateHit = foe.hp < hp0;
  }
  const info = `出生 k=${kSpawn.toFixed(3)}→0.1s k=${kMid.toFixed(3)}→收尾 k=${kEnd.toFixed(3)}、`
             + `靶距 ${d0.toFixed(0)}px（radius ${p.radius}）`;
  chk('风暴诞生是渐变：出生即近乎零半径', !!storm && kSpawn < 0.15, info);
  chk('风暴诞生：0.8s 内单调长到满半径', !!storm && mono && kEnd > 0.999, info);
  chk('风暴诞生：长开之前打不到 0.6×radius 处的敌人', !!storm && earlySafe, info);
  chk('风暴诞生：长开之后该处敌人开始挨打', !!storm && lateHit, info);
}
/* 撞人 30 伤（直接把一颗灵魂挪到敌人身上，看伤害与自灭） */
let touchOk = false, touchInfo = '';
{
  const p = T.CARD_BY_ID.soul_storm.p;
  T.resetMatch(T.CARD_BY_ID.soul_storm, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  let soul = null;
  for (let i = 0; i < 3600 && !soul; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    soul = T.world.units.find(u => u.soul && u.alive && !u.dying);
  }
  const foe = T.world.units.find(u => u.team === 1);
  if (soul && foe) {
    soul.x = foe.x; soul.y = foe.y;                      // 直接贴到敌人身上
    const hp0 = foe.hp;
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    const lost = hp0 - foe.hp;
    touchOk = (lost === p.touchDmg) && (soul.dying || !soul.alive);
    touchInfo = `扣血 ${lost}（期望 ${p.touchDmg}）、灵魂 ${soul.dying || !soul.alive ? '已消亡' : '还活着'}`;
  } else touchInfo = '没能造出灵魂/找不到敌人';
}
chk('灵魂碰到敌人：30 伤 + 自己直接死亡', touchOk, touchInfo);

/* ⑩ 陨石打击：环绕队形自动均匀分布（3 颗 120°、2 颗 180°）+ 集齐后先蓄势 */
const fallSpd = T.CARD_BY_ID.meteor_strike.p.fallSpd;
/* 队形间隔：绕着本体量每两颗之间的夹角，取最大者（均匀分布时 = 360/n） */
function maxGapDeg(orbs, owner) {
  const angs = orbs.map(o => Math.atan2(o.y - owner.y, o.x - owner.x)).sort((x, y) => x - y);
  const gaps = angs.map((v, k) => {
    const nx = (k + 1 < angs.length) ? angs[k + 1] : angs[0] + Math.PI * 2;
    return (nx - v) * 180 / Math.PI;
  });
  return Math.max(...gaps);
}
/* ⑩a 3 颗：让三颗球从【同一个角度】同时入轨，走真实的 hold→cast 流程 ——
       蓄势末段它们必须已经自己排成 120°。敌人机制停掉，保证这一局不会提前结束。 */
let gap3 = [], sawHold = 0;
for (const opp of ['perfected_strike', 'darkness']) {
  T.resetMatch(T.CARD_BY_ID.meteor_strike, T.CARD_BY_ID[opp]);
  T.world.running = true;
  const owner = T.world.units[0], m = owner.mech;
  /* 第 7 轮起：开局三颗球要战斗开始 1 秒后才浮现 —— 先等它们出现（arm 也放在之后） */
  for (let i = 0; i < 200 && m.liveOrbs().length === 0; i++) { T.world.t += 1 / 60; T.stepPhysics(1 / 60); }
  for (const o of m.liveOrbs()) { o.state = 'orbit'; o.oR = m.p.orbitR; o.oAng = 0; }
  for (let i = 0; i < 3600; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    if (m.state !== 'hold') continue;
    sawHold++;
    if (m.timer > 0.5) continue;                      // 只取蓄势末段（角度已收敛）
    const orbs = m.all.filter(o => !o.dead && o.state === 'orbit');
    if (orbs.length === 3) gap3.push(maxGapDeg(orbs, owner));
  }
}
/* ⑩b 2 颗：抹掉第三颗，让剩下两颗从【同一个角度】出发 ——
       队形必须自己把它们分开到 180°（这才是"自动均匀分布"的真正判据）。 */
let gap2 = 0, gap2n = 0;
{
  T.resetMatch(T.CARD_BY_ID.meteor_strike, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  const owner = T.world.units[0], m = owner.mech;
  T.world.units[1].mech.update = () => { };              // 敌人不放招
  /* 等开局那三颗球浮现（第 7 轮起有 1 秒延迟） */
  for (let i = 0; i < 200 && m.liveOrbs().length === 0; i++) { T.world.t += 1 / 60; T.stepPhysics(1 / 60); }
  const three = m.all.slice(0, 3);
  if (three.length === 3) {
    three[2].dead = true;                             // 少一颗
    for (const o of three.slice(0, 2)) { o.state = 'orbit'; o.oR = m.p.orbitR; o.oAng = 0.4; }
    for (let i = 0; i < 150; i++) { T.world.t += 1 / 60; T.stepPhysics(1 / 60); }
    const two = m.all.filter(o => !o.dead && o.state === 'orbit');
    if (two.length === 2) { gap2 = maxGapDeg(two, owner); gap2n = 1; }
  }
}
const maxGap3 = gap3.length ? Math.max(...gap3) : 0;
/* 上界放宽到 175：队形是【指数收敛】的，末段新入轨的那颗偶尔还差一点角度
   （实测最差 164.6°）。判据的重点是"没有挤在一起"（>95° 就算散开了），
   上限只用来兜住"三颗排成一条线"的病态情况。 */
chk('3 颗等离子球均匀分布（最大间隔 ≈120°）',
    gap3.length > 0 && maxGap3 > 95 && maxGap3 < 175,
    `样本 ${gap3.length}，最大间隔 ${maxGap3.toFixed(1)}°`);
chk('2 颗等离子球均匀分布（最大间隔 ≈180°）',
    gap2n > 0 && gap2 > 155 && gap2 < 205, `最大间隔 ${gap2.toFixed(1)}°`);
chk('集齐三颗后先原地蓄势再吸收（hold 阶段出现）', sawHold > 0, `观察到 hold ${sawHold} 帧`);
chk('陨石下落速度已降低（fallSpd ≤ 800）', fallSpd <= 800, `fallSpd=${fallSpd}（旧值 1250）`);
/* ⑩d 2026 数值口径：陨石 200~600 / 追踪之刃剑伤 200 */
chk('陨石伤害区间 = 200~600', T.CARD_BY_ID.meteor_strike.p.dmgMin === 200 && T.CARD_BY_ID.meteor_strike.p.dmgMax === 600,
    `${T.CARD_BY_ID.meteor_strike.p.dmgMin}~${T.CARD_BY_ID.meteor_strike.p.dmgMax}`);
chk('追踪之刃剑伤 = 200', T.CARD_BY_ID.tracking.p.dmg === 200, `${T.CARD_BY_ID.tracking.p.dmg}`);
/* ⑩e 等离子球【刚生成就能被收集】：刚从陨石坑崩出来（还在 scatter）的球，
      本体一靠近就该开始被吸，不用等它减速悬停 */
{
  T.resetMatch(T.CARD_BY_ID.meteor_strike, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  const m = T.world.units[0].mech, A = T.world.units[0];
  T.world.units[1].mech.update = () => { };
  /* 等开局那三颗球浮现（第 7 轮起有 1 秒延迟） */
  for (let i = 0; i < 200 && m.liveOrbs().length === 0; i++) { T.world.t += 1 / 60; T.stepPhysics(1 / 60); }
  for (const o of m.liveOrbs()) { o.state = 'orbit'; o.oR = m.p.orbitR; o.oAng = 0; }
  let ok = false, info = '';
  for (let i = 0; i < 5000; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    const sc = m.liveOrbs().filter(o => o.state === 'scatter' && o.life < 0.5);   // 刚崩出来的
    if (!sc.length) continue;
    const o = sc[0];
    A.x = o.x + 40; A.y = o.y;                    // 本体贴过去
    for (let k = 0; k < 30; k++) { T.world.t += 1 / 60; T.stepPhysics(1 / 60); }
    ok = o.state === 'attract' || o.state === 'orbit';
    info = `陨石落地 t=${T.world.t.toFixed(1)}s，刚崩出来的球被本体靠近后 state=${o.state}`;
    break;
  }
  chk('等离子球刚生成就能被收集（不必先悬停）', ok, info || '没等到陨石落地那一批球');
}
/* ⑩f 环绕/悬停的等离子球【不造成任何伤害】（用户 2026 口径：
      "环绕的等离子球好像还会造成伤害？请去除伤害"）。
      做法：只留两颗球在轨道上（凑不够三颗 → 不会开砸），把敌人一直按在球身上，
      跑 5 秒，敌人体力必须一点不掉。 */
{
  T.resetMatch(T.CARD_BY_ID.meteor_strike, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  const A = T.world.units[0], B = T.world.units[1];
  const m = A.mech;
  B.mech.update = () => { };                    // 敌人不放招，掉血只可能来自等离子球
  const live = m.liveOrbs();
  live[2] && (live[2].dead = true);             // 只留两颗 → 永远凑不齐、不会砸陨石
  for (const o of live.slice(0, 2)) { o.state = 'orbit'; o.oR = m.p.orbitR; o.oAng = 0; }
  const hp0 = B.hp;
  let minD = 1e9;
  for (let i = 0; i < 300; i++) {
    const o = m.orbitOrbs()[0];
    if (o) { B.x = o.x; B.y = o.y; }            // 一直"贴身"待在球上
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    if (o) minD = Math.min(minD, Math.hypot(B.x - o.x, B.y - o.y));
  }
  chk('环绕的等离子球不造成伤害', B.hp === hp0,
      `敌人贴着球 5 秒：HP ${hp0}→${Math.round(B.hp)}（最近距离 ${minD.toFixed(0)}px）`);
}
/* ⑩c 等离子球必须在【陨石落地那一刻】生成（不是等 recover 结束才撒）。
      为了不受"本体能不能走到球旁边"的随机影响：直接把开局三颗摆上轨道，
      并把敌人机制停掉（否则本体可能先被打死，陨石永远不来）。 */
{
  T.resetMatch(T.CARD_BY_ID.meteor_strike, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  const m = T.world.units[0].mech;
  T.world.units[1].mech.update = () => { };
  let landed = -1, orbsAtLand = -1, orbsBeforeLand = -1;
  let prevState = m.state;
  /* ⚠ 这里的实体类都被 wrap() 换成了匿名子类，`constructor.name` 是空的 ——
     所以用计数壳 __seen 来判断"有没有生成过 MeteorSmoke" */
  const smoke0 = sandbox.__seen.MeteorSmoke || 0;
  const arm = () => { for (const o of m.liveOrbs()) { o.state = 'orbit'; o.oR = m.p.orbitR; o.oAng = 0; } };
  for (let i = 0; i < 5000; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    /* 第 7 轮起：开局那三颗球要【战斗开始后 1 秒】才浮现（p.spawnDelay），
       所以必须先把倒计时走完、等球真的出现后再 arm()，否则 arm() 时场上还是空的。 */
    if (m.orbDelay <= 0) arm();
    if (prevState === 'cast' && m.state === 'recover') orbsBeforeLand = m.all.filter(o => !o.dead).length;
    if ((sandbox.__seen.MeteorSmoke || 0) > smoke0) {      // 陨石落地那一帧
      landed = T.world.t;
      orbsAtLand = m.all.filter(o => !o.dead).length;
      break;
    }
    prevState = m.state;
  }
  chk('等离子球在陨石落地时才生成', landed >= 0 && orbsAtLand === 3 && orbsBeforeLand <= 3,
      landed < 0 ? '没等到陨石落地' : `落地瞬间场上球数=${orbsAtLand}（落地前=${orbsBeforeLand}），t=${landed.toFixed(1)}s`);
}

/* ⑪ 末日降临的陨石也改用了「陨石打击」那张贴图（只是更小） */
{
  T.resetMatch(T.CARD_BY_ID.end_of_days, T.CARD_BY_ID.perfected_strike);
  T.world.running = true;
  T.world.units[1].mech.update = () => { };     // 敌人不放招，保证这一局不会提前结束
  const before = drawnKeys.get('sp_meteor_rock') || 0;
  for (let i = 0; i < 3600; i++) {
    T.world.t += 1 / 60; T.stepPhysics(1 / 60);
    if (i % 5 === 0) T.drawArena();
  }
  const after = drawnKeys.get('sp_meteor_rock') || 0;
  chk('末日降临的陨石用 sp_meteor_rock 贴图', after > before, `该局画了 ${after - before} 次`);
}

/* ⑫ 祭品召唤出来的友军【必须也能显示自己的状态文字】。
      回归背景（用户实测）：drawUnitHUD 的仆从分支原来没有调 mech.statusText()，
      于是"祭品召唤的蛇咬蛰伏时不显示积攒毒数量"；同类受影响的还有
      刀刃陷阱「插墙刀 N」、锻打成型「君王之剑 N」、电流相生「电球 N」、
      冲锋！！「仆从 N/2」、蛇咬「中毒 N / 猛扑!」。
      （漆黑原来也在列（显示「暗黑球 N」）；2026 用户口径"去除漆黑头顶的文字" →
        MechDarkness.statusText() 已固定返回 null，故本表把它剔除。）
      做法：对每张卡都造一只"祭品召来的那只"（真的 SummonedFoe，构造与渲染都走真路径），
      然后逐步 drawUnitHUD()，看画出来的状态文字里有没有它自己的那一条。 */
{
  /* 各卡 statusText 的前缀（逐个核对过；蛇咬是"中毒图标 + 纯数字"，所以判数字） */
  const SPEC = {
    knife_trap: '插墙刀 ', beat_into_shape: '君王之剑 ', voltaic: '电球 ',
    charge: '仆从 ', snakebite: /^\d+$/,
  };
  const res = [];
  for (const id of Object.keys(SPEC)) {
    const card = T.CARD_BY_ID[id];
    T.resetMatch(T.CARD_BY_ID['offering'], T.CARD_BY_ID['expose'], 1234);
    T.world.running = true;
    const off = T.world.units[0];
    /* 真·召唤物：SummonedFoe(owner, card, x, y, 祭品的 p) —— 和 MechOffering.summon 同一条路 */
    const mon = new T.SummonedFoe(off, card, 200, 200, T.CARD_BY_ID['offering'].p);
    T.world.units.push(mon);
    let found = '', info = '', dbg = [];
    for (let i = 0; i < 900 && !found; i++) {
      T.world.t += 1 / 60; T.stepPhysics(1 / 60);
      mon.hp = mon.maxHp;                      // 靶子：不让它被打死，专心验渲染
      T.drawUnitHUD();
      /* 只认"这一帧画出来的、恰好落在召唤物头上"的那些文字 */
      const hit = sandbox.__txt.log.find(e => {
        const mine = e.units.find(x => x.minion && x.summoned &&
          Math.abs(x.x - mon.x) < 1e-6 && Math.abs(x.y - mon.y) < 1e-6);
        if (!mine) return false;
        const spec = SPEC[id];
        return (spec instanceof RegExp) ? spec.test(e.t) : (e.t.indexOf(spec) === 0);
      });
      if (hit) { found = hit.t; info = hit.fc; }
    }
    res.push({ id, found, info });
  }
  const failed = res.filter(r => !r.found);
  chk('祭品召唤的友军也会显示自己的状态文字', failed.length === 0,
      failed.length ? ('这 ' + failed.length + ' 张没画出来: ' + failed.map(r => r.id).join(',')) :
        res.map(r => r.id + '→「' + r.found + '」').join('  '));
}

console.log('绘制方法覆盖抽样:', [...called].filter(k => /arc|drawImage|fillText|stroke/.test(k)).slice(0, 12).join(', '));
console.log(bad ? '!! 视觉断言失败' : '✓ 渲染路径无异常');
