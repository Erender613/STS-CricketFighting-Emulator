/* ⚠ 已作废（2026-09-23）：拴绳机制已整条移除，本探针读的 mech.leashing 永远是 undefined，
 *   p.leashR / p.leashBack 也是 undefined → 报表里会打出 "undefined"，拴绳段数恒为 0，
 *   下面的"拴绳区附近掉头"统计也失去意义（NaN 比较）。
 *   要验"拴绳确实没了 + 冲撞仍照常命中 + mRest 生效"，请用 tools/_minion_noleash_check.js。
 *   【再更新（2026-09-23 晚）】_minion_noleash_check.js 也已随"仆从 AI 完全重构"删除
 *   （它断言的 mRest/ram 状态在新 AI 里不存在）。现在请用 tools/_minion_ai_check.js。
 *
 * 诊断：冲锋仆从的【冲撞(ram)】与【回巢(leash)】是否互相打架。
 *
 * 观察点：
 *   1) 每一次 ram 是怎么结束的 —— 撞击命中 / 计时到点 / 被拴绳打断 / 主人阵亡
 *   2) 拴绳(leashing) 的 接通↔解除 往返次数与周期，判断是否在 leashR 边界上来回抖动
 *   3) 仆从"朝敌人方向的径向速度"符号翻转次数（真·反复进退的直接度量）
 *
 * 用法：node tools/_minion_leash_probe.js [html路径] [对局] [秒数]
 *   对局形如 charge:charge，默认 charge:doom（敌人会跑，最容易触发）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const PAIR = (process.argv[3] || 'charge:end_of_days').split(':');
const SECS = Number(process.argv[4] || 60);

const html = fs.readFileSync(HTML, 'utf8');
/* 取最大的 script 块 = 游戏逻辑（构建产物里还有 __BUILD__ 小标记块，不能用贪婪正则） */
const _blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = _blocks.sort((a, b) => b.length - a.length)[0];
if (!src) { console.error('找不到 script'); process.exit(1); }
src += `\nglobalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, MinionBrain };\n`;

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
/* 注意：mulberry32 必须返回 [0,1)。曾因少一层括号返回 [-0.5,0.5) 把整张平衡表跑废。 */
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
const T = sandbox.__T, W = T.world;
const DT = 1 / 60;
const byId = (id) => T.CARD_BY_ID[id];

/* ---------- 挂钩 MinionBrain.update，记录每一次状态转换 ---------- */
const events = [];       // 全局事件流
let FRAME = 0;
let MINION_SEQ = 0;
const meta = new Map();  // brain -> { id, ram: {...}, prevState, prevLeash }
const origUpdate = T.MinionBrain.prototype.update;
const origHit = T.MinionBrain.prototype.onUnitHit;

T.MinionBrain.prototype.update = function (dt) {
  const m = this.m;
  let rec = meta.get(this);
  if (!rec) { rec = { id: 'M' + (++MINION_SEQ), prevState: m.state, prevLeash: !!this.leashing, ram: null }; meta.set(this, rec); }

  const s0 = m.state, l0 = !!this.leashing;
  const own0 = Math.hypot(m.o.x - m.x, m.o.y - m.y);

  origUpdate.call(this, dt);

  const s1 = m.state, l1 = !!this.leashing;

  /* 冲撞开始 */
  if (s0 !== 'ram' && s1 === 'ram') {
    rec.ram = { id: rec.id, start: FRAME, end: null, reason: null, hits: 0, friendly: 0, friendlyAt: null,
                ownAtStart: own0, ownAtEnd: null, ordered: !!this.ordered };
    events.push({ f: FRAME, id: rec.id, kind: 'ram-start', own: own0, ordered: !!this.ordered });
  }
  /* 冲撞结束 */
  if (s0 === 'ram' && s1 !== 'ram' && rec.ram && rec.ram.end === null) {
    rec.ram.end = FRAME;
    rec.ram.reason = l1 && !l0 ? 'leash打断' : (s1 === 'rest' ? '撞到/到点' : s1);
    rec.ram.ownAtEnd = Math.hypot(m.o.x - m.x, m.o.y - m.y);
    events.push({ f: FRAME, id: rec.id, kind: 'ram-end', reason: rec.ram.reason,
                  dur: (FRAME - rec.ram.start) * DT, own: rec.ram.ownAtEnd, hits: rec.ram.hits });
    rams.push(rec.ram); rec.ram = null;
  }
  /* 拴绳 接通 / 解除 */
  if (!l0 && l1) {
    leash.push({ id: rec.id, on: FRAME, off: null, wasRam: s0 === 'ram' });
    events.push({ f: FRAME, id: rec.id, kind: 'leash-on', own: own0, wasRam: s0 === 'ram' });
  }
  if (l0 && !l1) {
    const cur = leash.filter(x => x.id === rec.id && x.off === null).pop();
    if (cur) { cur.off = FRAME; events.push({ f: FRAME, id: rec.id, kind: 'leash-off', own: Math.hypot(m.o.x - m.x, m.o.y - m.y), dur: (FRAME - cur.on) * DT }); }
  }
  rec.prevState = s1; rec.prevLeash = l1;
};
const rams = [], leash = [], friendly = [], selfHarm = [];

T.MinionBrain.prototype.onUnitHit = function (e) {
  const rec = meta.get(this);
  const hp0 = e ? e.hp : 0;
  if (rec && rec.ram && e && !e.minion) rec.ram.hits++;
  /* 友方碰撞计数（新规则：本体与自家仆从、同伴仆从之间也会物理相撞）。
     关心的是：冲撞途中会不会被自家本体挡住。 */
  if (e && e.team === this.m.team) {
    friendly.push({ f: FRAME, st: this.m.state, isMinion: !!e.minion });
    if (rec && rec.ram && !e.minion) { rec.ram.friendly++; rec.ram.friendlyAt = FRAME - rec.ram.start; }
  }
  const r = origHit.call(this, e);
  /* 硬守卫：友方碰撞只能"挤开"，绝不能掉血。这里逐次核对。 */
  if (e && e.team === this.m.team && e.hp < hp0) {
    selfHarm.push({ f: FRAME, dmg: hp0 - e.hp, isMinion: !!e.minion });
  }
  return r;
};

/* ---------- 跑对局 ---------- */
T.resetMatch(byId(PAIR[0]), byId(PAIR[1]));
W.running = true;

const frames = Math.round(SECS / DT);
const rev = [];             // 径向速度符号翻转
const lastSign = new Map();
let framesRam = 0, framesLeash = 0, framesTotal = 0;

for (let f = 0; f < frames; f++) {
  FRAME = f;
  W.t += DT;
  T.stepPhysics(DT);
  for (const m of W.units.filter(u => u.minion)) {
    framesTotal++;
    if (m.state === 'ram') framesRam++;
    if (m.mech && m.mech.leashing) framesLeash++;
    /* 真·反复进退：用【仆从→敌人】这条轴（不能用"本体→敌人"，那条轴本身会转，
       仆从贴着敌人侧滑时径向分量会假翻转）。+ = 正在接近敌人，- = 正在远离。 */
    let foe = null, fd = Infinity;
    for (const u of W.units) {
      if (u.team === m.team || u.minion || !u.alive || u.dying) continue;
      const d = Math.hypot(u.x - m.x, u.y - m.y);
      if (d < fd) { fd = d; foe = u; }
    }
    if (!foe) continue;
    const ax = foe.x - m.x, ay = foe.y - m.y;
    const al = Math.hypot(ax, ay) || 1e-6;
    const vx = m.vx !== undefined ? m.vx : m.dx * m.curSpeed();
    const vy = m.vy !== undefined ? m.vy : m.dy * m.curSpeed();
    const radial = vx * (ax / al) + vy * (ay / al);
    const sg = radial > 1 ? 1 : (radial < -1 ? -1 : 0);
    if (sg !== 0) {
      const key = m.__k || (m.__k = 'M' + Math.random().toFixed(4));
      const prev = lastSign.get(key);
      if (prev !== undefined && prev !== 0 && sg !== prev) {
        rev.push({ f, id: key, sign: sg, own: Math.hypot(m.o.x - m.x, m.o.y - m.y), fd, st: m.state, leash:!!(m.mech&&m.mech.leashing) });
      }
      lastSign.set(key, sg);
    }
  }
  if (!W.units.some(u => u.alive && !u.minion && !u.dying)) break;
}

/* ---------- 报表 ---------- */
const p = T.CARD_BY_ID[PAIR[0]].p;
console.log(`对局 ${PAIR.join(' vs ')}   跑 ${(framesTotal / Math.max(1, W.units.filter(u => u.minion).length) * DT).toFixed(0)}s` +
  `   （leashR=${p.leashR}  leashBack=${p.leashBack}  mRest=${p.mRest}）`);
console.log(`仆从总帧数 ${framesTotal}  其中 ram ${(framesRam / framesTotal * 100).toFixed(1)}%` +
  `  leashing ${(framesLeash / framesTotal * 100).toFixed(1)}%`);

console.log(`\n=== 一、冲撞(ram) 是怎么结束的（共 ${rams.length} 次）===`);
const byReason = {};
for (const r of rams) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(4)} 次   (${(v / rams.length * 100).toFixed(0)}%)`);
}
const cut = rams.filter(r => r.reason === 'leash打断');
if (cut.length) {
  const avg = cut.reduce((s, r) => s + (r.end - r.start), 0) / cut.length * DT;
  const noHit = cut.filter(r => r.hits === 0).length;
  console.log(`  → 被拴绳打断的冲撞：平均只跑了 ${avg.toFixed(2)}s；其中 ${noHit}/${cut.length} 次【一次都没撞到】`);
  console.log(`  逐条（起/止帧、时长、起点距本体、打断时距本体）：`);
  for (const r of cut.slice(0, 20))
    console.log(`     帧${String(r.start).padStart(5)}→${String(r.end).padStart(5)}  ${((r.end - r.start) * DT).toFixed(2)}s` +
      `  起点距本体 ${r.ownAtStart.toFixed(0).padStart(4)}px  打断时 ${r.ownAtEnd.toFixed(0).padStart(4)}px  命中${r.hits}次`);
}

console.log(`\n=== 二、拴绳往返（共 ${leash.length} 段）===`);
const closed = leash.filter(x => x.off !== null);
const durs = closed.map(x => (x.off - x.on) * DT);
const short = durs.filter(d => d < 1.2).length;
console.log(`  已结束 ${closed.length} 段，平均每段 ${(durs.reduce((a, b) => a + b, 0) / Math.max(1, durs.length)).toFixed(2)}s`);
console.log(`  其中 ${short} 段短于 1.2s（= 刚到家又被拉出去 / 刚出去又被拉回来 → 抖动）`);
for (const x of closed.slice(0, 15))
  console.log(`     仆从${x.id}  帧${String(x.on).padStart(5)}→${String(x.off).padStart(5)}  持续 ${((x.off - x.on) * DT).toFixed(2)}s` +
    `${x.wasRam ? '  ← 打断的是一次冲撞' : ''}`);

console.log(`\n=== 三、径向速度翻转（真·反复进退）===`);
const perMin = (n) => (n / Math.max(1e-6, framesTotal * DT) * 60).toFixed(1);
console.log(`  合计 ${rev.length} 次转向  （${perMin(rev.length)} 次/分钟）`);
const near = rev.filter(r => r.fd < 200);          // 就在敌人跟前掉头 = 用户看到的那种
console.log(`  其中【距敌 <200px 时掉头】：${near.length} 次  （${perMin(near.length)} 次/分钟）  ← 这就是"在敌人面前反复进退"`);
const inWin = rev.filter(r => r.leash || (r.own > p.leashBack - 30 && r.own < p.leashR + 30));
console.log(`  发生在拴绳区(${p.leashBack}~${p.leashR}px)附近的：${inWin.length} 次  （${perMin(inWin.length)} 次/分钟）`);
console.log(`  —— 距敌 <200px 的掉头，逐条看它是"回巢"还是"重新进逼"：`);
for (const r of near.slice(0, 15))
  console.log(`     帧${String(r.f).padStart(5)} state=${r.st.padEnd(5)} 距本体 ${r.own.toFixed(0).padStart(4)}px 距敌 ${r.fd.toFixed(0).padStart(4)}px 拴绳=${r.leash ? 'Y' : 'n'}`);

console.log(`\n=== 四、输出（撞到本体才算数）===`);
console.log(`  仆从对本体命中总数 ${rams.reduce((s, r) => s + r.hits, 0)} 次` +
  `  （${(rams.reduce((s, r) => s + r.hits, 0) / Math.max(1e-6, framesTotal * DT) * 60).toFixed(1)} 次/分钟）`);
console.log(`  平均每次冲撞命中 ${(rams.reduce((s, r) => s + r.hits, 0) / Math.max(1, rams.length)).toFixed(2)} 次` +
  `  空手而归的冲撞 ${rams.filter(r => r.hits === 0).length}/${rams.length}`);
const empty = rams.filter(r => r.hits === 0);
const emptyByFriend = empty.filter(r => r.friendly > 0);
console.log(`     ↳ 空手而归里，途中先撞上自家本体/同伴的：${emptyByFriend.length}/${empty.length}` +
  `（起点距本体 ${(emptyByFriend.reduce((s, r) => s + r.ownAtStart, 0) / Math.max(1, emptyByFriend.length)).toFixed(0)}px，` +
  `平均在冲撞第 ${(emptyByFriend.reduce((s, r) => s + (r.friendlyAt || 0), 0) / Math.max(1, emptyByFriend.length) * DT).toFixed(2)}s 撞上）`);

console.log(`\n=== 五、友方碰撞（新规则：本体↔自家仆从、仆从↔仆从，不再对穿）===`);
console.log(`  仆从与友方相撞 ${friendly.length} 次  （${perMin(friendly.length)} 次/分钟）`);
console.log(`     其中与自家本体相撞 ${friendly.filter(x => !x.isMinion).length} 次、` +
  `与同伴仆从相撞 ${friendly.filter(x => x.isMinion).length} 次`);
const blockRam = friendly.filter(x => x.st === 'ram').length;
console.log(`     发生在【冲撞途中】的 ${blockRam} 次` + (blockRam ? '  ← 会被自家本体顶住（需要留意）' : '  ← 没有一次拦住冲撞'));
if (selfHarm.length) {
  console.log(`  ✗✗ 守卫失效：友方碰撞居然掉了血 ${selfHarm.length} 次，合计 ${selfHarm.reduce((s, x) => s + x.dmg, 0)} 点`);
} else {
  console.log(`  ✓ 守卫有效：友方碰撞只挤开、零掉血（核对 ${friendly.length} 次接触）`);
}
