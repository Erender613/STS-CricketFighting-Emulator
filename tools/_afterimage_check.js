/**
 * 【余像回归探针】直接读 src/game.html（不依赖打包产物），验 2026 口径的四条：
 *   1) 斩击线的角度 = 「分身位置 → 敌方本体位置」这条直线（不再随机）
 *   2) 伤害沿直线扫：线上的敌人一并吃 pierceDmg，线外的原封不动
 *   3) 分身消失的那一刻，本体【立刻失去格挡】（20 → 0，且不弹"格挡 0"）
 *   4) 15 秒未被攻击 → 自动消散并放出斩击；倒计时在分身上方画成小圆环
 * 另外把「祭品召唤出来的余像」也走一遍（缩放 0.75 + 同样有 15 秒读条）。
 *
 * 用法: node tools/_afterimage_check.js
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
MathSeeded.random = mulberry32(20260927);

const HTML = process.env.GAME_HTML
  ? path.resolve(process.env.GAME_HTML)
  : path.join(__dirname, '..', 'src', 'game.html');
const raw = fs.readFileSync(HTML, 'utf8');
const blocks = raw.match(/<script>([\s\S]*?)<\/script>/g) || [];
let src = blocks.map(s => s.slice(8, -9)).sort((a, b) => b.length - a.length)[0];
src = src.replace("'__BUILD_TAG__'", "'probe'").replace('__ASSET_MAP__', '{"img":{},"snd":{}}');
src += '\nglobalThis.__T = { world, CFG, CARD_BY_ID, CARDS, stepPhysics, resetMatch, Unit, SummonedFoe, MECHS, WhitePierce, drawUnits, setCtx: function (c) { cx = c; } };\n';

function stubEl() {
  return {
    style: {}, dataset: {}, children: [], disabled: false, textContent: '', title: '',
    clientWidth: 700, clientHeight: 700, innerHTML: '', value: '', checked: false,
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, removeChild() { },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { width: 700, height: 700, top: 0, left: 0 }; },
    setAttribute() { }, getAttribute() { return null; },
    getContext() { return ctx2d(); }, closest() { return null; },
    parentElement: { clientWidth: 700 }, querySelector() { return null; },
    querySelectorAll() { return []; }, click() { },
  };
}
const grad = () => ({ addColorStop() { } });
function ctx2d() {
  const t = { createLinearGradient: grad, createRadialGradient: grad, createPattern: () => null, measureText: () => ({ width: 10 }) };
  return new Proxy(t, { get(o, k) { return (k in o) ? o[k] : () => { }; }, set(o, k, v) { o[k] = v; return true; }, has() { return true; } });
}
/* 记录型上下文：只关心 arc()（圆环读条）与 drawImage()，用来断言"分身头顶画了环"。 */
function recCtx() {
  const c = { arcs: [], images: 0, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', font: '', textAlign: '', textBaseline: '' };
  const noop = () => { };
  ['save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'rect', 'fill', 'stroke', 'clip', 'ellipse', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo', 'fillText', 'strokeText'].forEach(k => { c[k] = noop; });
  c.arc = (x, y, r, a0, a1) => c.arcs.push({ x, y, r, a0, a1 });
  c.drawImage = () => { c.images++; };
  c.createLinearGradient = grad; c.createRadialGradient = grad; c.createPattern = () => null; c.measureText = () => ({ width: 10 });
  return c;
}
class P2 { moveTo() { } lineTo() { } arcTo() { } closePath() { } rect() { } arc() { } }
class Im { constructor() { this.naturalWidth = 300; this.naturalHeight = 423; } }
const els = {};
const sandbox = {
  document: {
    getElementById(id) { return els[id] || (els[id] = stubEl()); },
    createElement() { return stubEl(); },
    createTextNode(t) { return { nodeValue: t, textContent: t }; },
    addEventListener() { }, removeEventListener() { }, querySelector() { return null; },
  },
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
const DT = 1 / 60;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + extra)); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }

/* 让余像的分身先长出来（MechAfterimage.cd 初值 0.25 → 约 15 帧） */
function spawnClone(ai) {
  ai.alive = true;
  for (let i = 0; i < 40 && !(ai.mech && ai.mech.clone); i++) { T.world.t += DT; T.stepPhysics(DT); }
  return ai.mech.clone;
}
/* 摆位：把参战单位放到受控坐标，避免物理步进把它们甩开 */
function place(u, x, y, dx, dy) { u.x = x; u.y = y; u.dx = dx || 0; u.dy = dy || 0; u.boost = 0; }

console.log('\n== 1. 斩击线角度 = 分身位置 → 敌方本体位置的直线 ==');
{
  T.resetMatch(T.CARD_BY_ID['afterimage'], T.CARD_BY_ID['dark_embrace'], 12345);
  const world = T.world, ai = world.units[0], foe = world.units[1];
  const clone = spawnClone(ai);
  ok('分身已生成', !!clone);
  place(ai, 300, 300); place(clone, 100, 400); place(foe, 500, 200);
  const before = world.effects.length;
  clone.disperse(null, false);
  const pierce = world.effects.slice(before).filter(e => e instanceof T.WhitePierce);
  ok('放出了一道斩击白线', pierce.length === 1, 'effects+=' + (world.effects.length - before));
  const want = Math.atan2(200 - 400, 500 - 100);
  ok('角度 = atan2(本体-分身)（不是随机）', pierce.length === 1 && near(pierce[0].ang, want),
     pierce.length ? 'ang=' + pierce[0].ang.toFixed(4) + ' want=' + want.toFixed(4) : 'no line');
  ok('线画在分身位置', pierce.length === 1 && near(pierce[0].x, 100) && near(pierce[0].y, 400));
}

console.log('\n== 2. 伤害沿线扫：线上的吃、线外的不吃 ==');
{
  T.resetMatch(T.CARD_BY_ID['afterimage'], T.CARD_BY_ID['dark_embrace'], 999);
  const world = T.world, ai = world.units[0], foe = world.units[1];
  const clone = spawnClone(ai);
  const team = foe.team;
  /* 线段：分身 (100,400) → 本体 (500,200)。方向 (400,-200)/|..|。
     线上再放一个敌人（正中间 (300,300)）；线外放一个（垂直偏 200px）。 */
  const onLine = new T.Unit(T.CARD_BY_ID['dark_embrace'], team);
  const offLine = new T.Unit(T.CARD_BY_ID['dark_embrace'], team);
  place(ai, 300, 300); place(clone, 100, 400); place(foe, 500, 200);
  place(onLine, 300, 300); place(offLine, 300, 300 + 200);
  /* bodyOf 取 world.units 里第一个敌方本体 —— foe 在前，onLine/offLine 在后，
     所以"敌方本体"仍是 foe；onLine/offLine 属于"路径上的其它敌人"。
     把 foe 撑到不会被打死，好观察伤情。 */
  foe.hp = foe.maxHp = 100000;
  onLine.hp = onLine.maxHp = 100000;
  offLine.hp = offLine.maxHp = 100000;
  world.units.push(onLine, offLine);
  const h0 = { f: foe.hp, on: onLine.hp, off: offLine.hp };
  clone.disperse(null, false);
  ok('敌方本体吃 150', h0.f - foe.hp === 150, 'Δ' + (h0.f - foe.hp));
  ok('线上的其它敌人也吃 150', h0.on - onLine.hp === 150, 'Δ' + (h0.on - onLine.hp));
  ok('线外的敌人一点没伤', h0.off - offLine.hp === 0, 'Δ' + (h0.off - offLine.hp));
}

console.log('\n== 3. 分身消失 → 本体立刻失去格挡（静默） ==');
{
  T.resetMatch(T.CARD_BY_ID['afterimage'], T.CARD_BY_ID['dark_embrace'], 7);
  const world = T.world, ai = world.units[0], foe = world.units[1];
  const clone = spawnClone(ai);
  ok('召唤分身时本体格挡 = 20', ai.block === 20, 'block=' + ai.block);
  const numsBefore = world.nums.length;
  place(ai, 300, 300); place(clone, 100, 400); place(foe, 500, 200);
  foe.hp = foe.maxHp = 100000;
  clone.disperse(null, false);
  ok('分身消失后本体格挡 = 0', ai.block === 0, 'block=' + ai.block);
  const said0 = world.nums.slice(numsBefore).some(n => String(n.text).indexOf('格挡 0') >= 0);
  ok('没有弹"格挡 0"字样（静默失去）', !said0);
  /* 超时消散同样要掉格挡 */
  const c2 = spawnClone(ai);
  /* 让消散/冷却这条路真的跑完：死亡动画收尾 + 冷却归零，再步进一帧就会重新分身 */
  if (c2) { c2.finished = true; ai.mech.cd = 0; T.world.t += DT; T.stepPhysics(DT); }
  const c3 = ai.mech.clone;
  ok('重新分身 → 格挡又回到 20', ai.block === 20 && c3 !== c2, 'block=' + ai.block);
  if (c3) { place(ai, 300, 300); c3.idle = c3.idleMax + 1; T.world.t += DT; T.stepPhysics(DT); }
  ok('超时消散后格挡同样归零', ai.block === 0, 'block=' + ai.block);
}

console.log('\n== 4. 15 秒未被攻击 → 自动消散并放出斩击 ==');
{
  T.resetMatch(T.CARD_BY_ID['afterimage'], T.CARD_BY_ID['dark_embrace'], 4242);
  const world = T.world, ai = world.units[0], foe = world.units[1];
  const clone = spawnClone(ai);
  ok('分身 idleMax = 15', clone && clone.idleMax === 15, clone && ('idleMax=' + clone.idleMax));
  place(ai, 300, 300); place(clone, 100, 400); place(foe, 500, 200);
  foe.hp = foe.maxHp = 100000;
  /* 把计时推到只差一帧，然后步进一帧 → 走 auto-disperse */
  clone.idle = clone.idleMax - 0.001;
  const hp0 = foe.hp, eff0 = world.effects.length;
  T.world.t += DT; T.stepPhysics(DT);
  ok('计时跑满 → 分身消散', clone.cDispersed === true);
  const pierce = world.effects.slice(eff0).filter(e => e instanceof T.WhitePierce);
  ok('消散同时放出斩击白线', pierce.length === 1, 'pierce=' + pierce.length);
  ok('斩击照常打到本体 150', hp0 - foe.hp === 150, 'Δ' + (hp0 - foe.hp));
}

console.log('\n== 5. 倒计时小圆环画在分身上方 ==');
{
  T.resetMatch(T.CARD_BY_ID['afterimage'], T.CARD_BY_ID['dark_embrace'], 55);
  const world = T.world, ai = world.units[0], foe = world.units[1];
  const clone = spawnClone(ai);
  place(ai, 300, 300); place(clone, 200, 250); place(foe, 500, 200);
  clone.idle = clone.idleMax * 0.5;         // 半程：读条画半圈
  const c = recCtx();
  T.setCtx(c);
  T.drawUnits();
  const rings = c.arcs.filter(a => near(a.r, 10));
  ok('分身上方画了半径 10 的圆环（轨道+读条 = 2 段弧）', rings.length === 2, 'rings=' + rings.length);
  const h = T.CFG.CARD_H;                    // rs=1 → 卡高 150
  const wantY = clone.y - h / 2 - 10 - 7;
  ok('圆环在卡面上方', rings.length && near(rings[0].y, wantY, 1), rings.length ? 'y=' + rings[0].y + ' want=' + wantY : '');
  ok('读条弧覆盖半圈（0.5 × 2π）',
     rings.length === 2 && near(Math.abs(rings[1].a1 - rings[1].a0), Math.PI, 0.01),
     rings.length === 2 ? 'span=' + Math.abs(rings[1].a1 - rings[1].a0).toFixed(3) : '');
}

console.log('\n== 6. 祭品召唤的余像：分身缩小 0.75 + 同样有 15 秒读条 ==');
{
  T.resetMatch(T.CARD_BY_ID['offering'], T.CARD_BY_ID['dark_embrace'], 31337);
  const world = T.world, off = world.units[0], foe = world.units[1];
  /* 直接把「余像」作为召唤物摆上场（绕开随机召唤，专测这一条路径） */
  const ai = new T.SummonedFoe(off, T.CARD_BY_ID['afterimage'], off.x + 80, off.y, T.CARD_BY_ID['offering'].p);
  world.units.push(ai);
  const clone = spawnClone(ai);
  ok('召唤物的机制就是 MechAfterimage', !!(ai.mech && ai.mech.clone !== undefined));
  ok('分身的缩放 = 0.75', clone && clone.rs === 0.75, clone && ('rs=' + clone.rs));
  ok('分身的 15 秒计时在', clone && clone.idleMax === 15);
  ok('分身血量按面积缩（240×0.75² ≈ 135）', clone && clone.maxHp === 135, clone && ('hp=' + clone.maxHp));
  /* 同样能画环、超时同样放斩击 */
  place(ai, 300, 300); place(clone, 200, 250); place(foe, 500, 200);
  foe.hp = foe.maxHp = 100000;
  const c = recCtx(); T.setCtx(c); T.drawUnits();
  ok('召唤物的分身头顶同样画出圆环', c.arcs.filter(a => near(a.r, 10)).length === 2);
  clone.idle = clone.idleMax + 1;
  const hp0 = foe.hp, eff0 = world.effects.length;
  T.world.t += DT; T.stepPhysics(DT);
  ok('召唤物的分身超时同样触发放斩击', world.effects.slice(eff0).some(e => e instanceof T.WhitePierce) && hp0 - foe.hp === 150,
     'Δ' + (hp0 - foe.hp));
}

console.log('\n' + (fail === 0 ? '✓ 全部通过' : '✗ 有失败') + '：通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
process.exit(fail === 0 ? 0 : 1);
