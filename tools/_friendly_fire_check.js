/**
 * 【友军误伤审计】祭品会随机召唤场上任意一张卡当友军，所以任何"没按队伍过滤"的
 * 伤害路径都会变成"自己人打自己人"。用户实测到一次：祭品被自己召唤的完美打击打了。
 *
 * 做法：把每一张卡都造一份【召唤物】，让它和主人一起打一场；
 * 在 Unit.prototype.damage 上挂钩，记录每一次伤害的 (受害者, 来源, 数值)，
 * 凡出现【同队伤害】就报出来（自己打自己按设计允许，不算）。
 *
 * 用法: node tools/_friendly_fire_check.js [每张卡跑多少秒，默认 45]
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
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, CARDS, stepPhysics, resetMatch, Unit, SummonedFoe,
  drawArena, drawUnitHUD, setCtx: function (c) { cx = c; }, setCv: function (c) { cv = c; },
  setScale: function (s) { SCALE = s; }, fit, IMG, ASSET_MAP };\n`
  /* 状态文字采集：ctxStrokeText 是"头顶状态文字"的唯一出口。
     记下每次画文字时【哪些召唤物在场】，用来断言"召唤物自己的状态文字真的画出来了"。 */
  + `globalThis.__txt = { log: [] };\n`
  + `{ const __ct = ctxStrokeText;\n`
  + `  ctxStrokeText = function (t, x, y, sc, sw, fc) {\n`
  + `    globalThis.__txt.log.push({ t: String(t),\n`
  + `      minion: world.units.some(function (u) { return u.alive && !u.dying && u.minion; }) });\n`
  + `    return __ct.apply(this, arguments);\n`
  + `  }; }\n`;
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

/* ---- 在 Unit.prototype.damage 上挂钩，记录 (受害者, 来源, 数值) ---- */
let events = [];
const origDamage = T.Unit.prototype.damage;
T.Unit.prototype.damage = function (amount, kind, src2) {
  const before = this.hp;
  const r = origDamage.apply(this, [amount, kind, src2]);
  if (this.hp < before) {
    events.push({
      victim: this, src: src2, v: Math.round(before - this.hp),
      tag: describe(this), srcTag: describe(src2),
      friendly: !!src2 && src2 !== this && src2.team === this.team,
    });
  }
  return r;
};
function describe(u) {
  if (!u) return '环境/无来源';
  if (u.team === undefined) return u.constructor ? u.constructor.name : '?';
  const role = u.replica ? '分身' : u.soul ? '灵魂' : u.minion ? '仆从' : u.summoned ? '召唤友军' : (u.realCard ? u.realCard.name : '本体');
  const card = u.realCard ? u.realCard.name : (u.card ? u.card.name || u.card.id : '?');
  return `${card}(${role},队${u.team})`;
}

const SECONDS = +(process.argv[2] || 45);
const OPP = 'dark_embrace';        // 对手选"伤害最少"的一张，尽量把误伤归因到友军身上
const ids = T.CARDS.map(c => c.id).filter(id => id !== 'offering');
console.log(`友军误伤审计：每张卡当召唤物跑 ${SECONDS}s（对手 ${OPP}）`);
let totalFriendly = 0;
for (const id of ids) {
  events = [];
  T.resetMatch(T.CARD_BY_ID.offering, T.CARD_BY_ID[OPP]);
  T.world.running = true;
  T.world.stats = null;                       // 保证不会被 burstTick 覆盖 onDamage（这里也不用它）
  const owner = T.world.units[0];
  const foe = new T.SummonedFoe(owner, T.CARD_BY_ID[id], owner.x + 120, owner.y, T.CARD_BY_ID.offering.p);
  T.world.units.push(foe);
  const dt = 1 / 60;
  const n = Math.round(SECONDS * 60);
  for (let i = 0; i < n; i++) { T.world.t += dt; T.stepPhysics(dt); }
  const ff = events.filter(e => e.friendly);
  const pairs = {};
  for (const e of ff) {
    const k = `${e.srcTag} → ${e.tag}`;
    pairs[k] = pairs[k] || { n: 0, dmg: 0, max: 0 };
    pairs[k].n++; pairs[k].dmg += e.v; pairs[k].max = Math.max(pairs[k].max, e.v);
  }
  const keys = Object.keys(pairs);
  totalFriendly += ff.length;
  if (keys.length) {
    console.log(`  ✗ ${id.padEnd(16)} 同队伤害 ${ff.length} 次`);
    for (const k of keys) console.log(`       ${k}  ×${pairs[k].n}  合计 ${pairs[k].dmg}（最大 ${pairs[k].max}）`);
  } else {
    console.log(`  ✓ ${id.padEnd(16)} 无同队伤害（全场伤害事件 ${events.length} 次）`);
  }
}
console.log(totalFriendly ? `\n!! 共发现 ${totalFriendly} 次同队伤害` : '\n✓ 全部卡牌都没有友军误伤');

/* ============================================================
   附：召唤物的「可见状态」审计
   ------------------------------------------------------------
   用户报过"祭品召唤的蛇咬蛰伏时不显示积攒毒数量"——根因是 drawUnitHUD 的仆从分支
   漏调 mech.statusText()。这里把每一张卡都当召唤物跑一遍，凡是【它自己会返回
   非 null statusText】的，就要求那串文字真的被画出来过（在它活着的那一帧）。
   做法：在每个物理步之后、drawUnitHUD() 之前读一次 statusText()，然后看这一步里
   画出来的文字有没有它。蛇咬的 statusText 是"纯数字"（中毒图标 + 数值），
   所以用正则判断。
   ============================================================ */
console.log('\n— 召唤物状态文字审计（祭品召来的友军会不会显示自己的状态）—');
const fakeCv = stubEl(); fakeCv.width = 660; fakeCv.height = 660; fakeCv.parentElement.clientWidth = 660;
T.setCv(fakeCv); T.setCtx(ctx2d()); T.setScale(1); T.fit();
let hudFail = 0, hudChecked = 0;
for (const id of ids) {
  T.resetMatch(T.CARD_BY_ID.offering, T.CARD_BY_ID[OPP]);
  T.world.running = true;
  T.world.stats = null;
  const owner = T.world.units[0];
  const foe = new T.SummonedFoe(owner, T.CARD_BY_ID[id], owner.x + 120, owner.y, T.CARD_BY_ID.offering.p);
  T.world.units.push(foe);
  const seen = new Map();                     // statusText 文本 -> 有没有被画出来
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(SECONDS * 60); i++) {
    T.world.t += dt;
    T.stepPhysics(dt);
    foe.hp = foe.maxHp;                        // 不让它被打死，专心验显示
    const st = (foe.mech && foe.mech.statusText) ? foe.mech.statusText() : null;
    T.__txt = sandbox.__txt;                   // 采集器挂在 globalThis 上
    T.__txt.log.length = 0;
    T.drawUnitHUD();
    if (st && st.t) {
      hudChecked++;
      const drawn = T.__txt.log.some(e => e.t === String(st.t));
      if (!seen.has(String(st.t))) seen.set(String(st.t), drawn);
      else if (drawn) seen.set(String(st.t), true);
    }
  }
  const miss = [...seen.entries()].filter(([, drawn]) => !drawn).map(([t]) => t);
  if (seen.size === 0) {
    console.log(`  ·  ${id.padEnd(16)} 这张卡本来就不显示状态文字（跳过）`);
  } else if (miss.length) {
    hudFail++;
    console.log(`  ✗ ${id.padEnd(16)} 有状态文字没画出来：${JSON.stringify(miss.slice(0, 4))}`);
  } else {
    console.log(`  ✓ ${id.padEnd(16)} 状态文字都能显示：${JSON.stringify([...seen.keys()].slice(0, 4))}`);
  }
}
console.log(hudFail ? `\n!! ${hudFail} 张卡的召唤物状态文字显示不出来`
                    : `\n✓ 所有会显示状态的卡，其召唤物也都显示（共检查 ${hudChecked} 帧次）`);
process.exit((totalFriendly || hudFail) ? 1 : 0);
