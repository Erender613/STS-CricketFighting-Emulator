/* 量冲锋仆从的实测 DPS + 时间预算：
   用固定血量的木桩当对手（不回手、不动），统计
     · 总伤害 / 命中次数 / 命中间隔
     · 仆从的时间都花在哪：回防(leash) / 冲撞(ram) / 停顿(rest) / 待机(idle)
     · 撞上敌人但被冷却挡掉的次数
   支持环境变量换配置（用来定位"输出掉 3.4 倍"丢在哪一项）：
     SRC=old            用 git 8ad39e8~1 的 src（连击 bug 还在的版本）
     SEC=120            模拟时长
     MDMG / MREST / BOUNCE / LEASHR / LEASHBACK  覆盖对应参数
   用法：node tools/_minion_dps.js
        SRC=old node tools/_minion_dps.js                                */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = process.env.SRC || 'new';
const SEC = Number(process.env.SEC || 120);

let html;
if (SRC === 'old') {
  html = execSync('git show 8ad39e8~1:src/game.html', { cwd: ROOT, encoding: 'utf8', maxBuffer: 2e8 });
  console.log('[来源] git 8ad39e8~1（连击 bug 还在的版本：orderRam 会冲掉 rest）');
} else {
  html = fs.readFileSync(path.join(ROOT, 'src', 'game.html'), 'utf8');
  console.log('[来源] 当前 src/game.html');
}
const ovr = (from, to, label) => {
  const c = html.split(from).length - 1;
  if (c !== 1) { console.log('[跳过] ' + label + '：命中 ' + c + ' 处'); return; }
  html = html.split(from).join(to);
  console.log('[改] ' + label);
};
if (process.env.MDMG) ovr('mDmg: 50,', 'mDmg: ' + process.env.MDMG + ',', 'mDmg → ' + process.env.MDMG);
if (process.env.MREST) ovr('mRest: 1.5,', 'mRest: ' + process.env.MREST + ',', 'mRest → ' + process.env.MREST);
if (process.env.BOUNCE) ovr('bounce: 380, bounceCap: 380', 'bounce: ' + process.env.BOUNCE + ', bounceCap: ' + process.env.BOUNCE, 'bounce → ' + process.env.BOUNCE);
if (process.env.LEASHBACK) ovr('leashBack: 300,', 'leashBack: ' + process.env.LEASHBACK + ',', 'leashBack → ' + process.env.LEASHBACK);
if (process.env.LEASHR) ovr('leashR: 400,', 'leashR: ' + process.env.LEASHR + ',', 'leashR → ' + process.env.LEASHR);
if (process.env.SEEKS) ovr('seekSpd: 260,', 'seekSpd: ' + process.env.SEEKS + ',', 'seekSpd → ' + process.env.SEEKS);
if (process.env.NOSEEK) ovr('m.baseSpeed = p.seekSpd;', 'm.baseSpeed = 150;', '关掉进逼（对照）');

/* src 里的资源表是占位符，换成空表 —— 本探针只跑物理与机制，不画图不放音 */
let src =(()=>{const b=(String(html).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})()
  .replace('__ASSET_MAP__', '{ img: {}, sfx: {} }');
src += `\nglobalThis.__T = { world, CARD_BY_ID, stepPhysics, resetMatch, Minion, MinionBrain };\n`;

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
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
}
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
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  setTimeout, clearTimeout, console, Math: seededMath, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T, W = T.world;
const DT = 1 / 60;

/* ---------- 打桩 ---------- */
const S = { hits: 0, hitTimes: [], blocked: 0, ramEntries: 0, leashEntries: 0,
            tLeash: 0, tRam: 0, tRest: 0, tIdle: 0, minionSec: 0 };
const Brain = T.MinionBrain.prototype;
const origUpdate = Brain.update, origHit = Brain.onUnitHit;
let seq = 0;
Brain.update = function (dt) {
  const m = this.m;
  if (!m.__id) m.__id = ++seq;
  const wasLeash = this.leashing, st0 = m.state;
  const r = origUpdate.call(this, dt);
  if (!wasLeash && this.leashing) S.leashEntries++;
  if (st0 !== 'ram' && m.state === 'ram') S.ramEntries++;
  /* 时间预算：按"这一刻它在干嘛"归类（回防优先） */
  if (this.leashing) S.tLeash += dt;
  else if (m.state === 'ram') S.tRam += dt;
  else if (m.state === 'rest') S.tRest += dt;
  else S.tIdle += dt;
  return r;
};
Brain.onUnitHit = function (e) {
  const m = this.m, cd0 = this.hitCd;
  const r = origHit.call(this, e);
  if (!e || e.minion) return r;
  if (this.hitCd !== undefined && this.hitCd > cd0) { S.hits++; S.hitTimes.push(W.t); }
  else if (m.state === 'ram') S.blocked++;
  return r;
};

T.resetMatch(T.CARD_BY_ID['charge'], T.CARD_BY_ID['dark_embrace']);
W.running = true;
const owner = W.units[0], dummy = W.units[1];
owner.hp = owner.maxHp = 1e6;                 // 别让本体自己耗血耗死，专注量仆从输出
dummy.mech.update = () => { }; dummy.baseSpeed = 0; dummy.freeze = 1e9;
dummy.hp = dummy.maxHp = 1e9;                 // 木桩：打不死、不回手

const steps = Math.round(SEC / DT);
for (let i = 0; i < steps; i++) {
  W.t += DT; T.stepPhysics(DT);
  S.minionSec += W.units.filter(u => u.minion && !u.dying).length * DT;
}

const dealt = 1e9 - dummy.hp;
const gaps = S.hitTimes.slice(1).map((t, i) => t - S.hitTimes[i]).sort((a, b) => a - b);
const med = gaps.length ? gaps[gaps.length >> 1] : NaN;
const pct = v => (S.minionSec ? (v / S.minionSec * 100).toFixed(0) + '%' : '-');
console.log(`  ${SEC}s：命中 ${S.hits} 次，总伤害 ${dealt}，仆从在场 ${S.minionSec.toFixed(0)} 仆从·秒`);
console.log(`  → 整卡 DPS ${(dealt / SEC).toFixed(1)}   单仆从 DPS ${(dealt / Math.max(1, S.minionSec)).toFixed(1)}` +
  `   命中 ${(S.hits / SEC * 60).toFixed(1)} 次/分   相邻命中中位间隔 ${isNaN(med) ? '-' : med.toFixed(2) + 's'}`);
console.log(`    时间预算（占仆从在场时间）：回防 ${pct(S.tLeash)}  冲撞 ${pct(S.tRam)}  停顿 ${pct(S.tRest)}  待机 ${pct(S.tIdle)}`);
console.log(`    进入冲撞 ${S.ramEntries} 次   触发回防 ${S.leashEntries} 次   撞上但被冷却挡掉 ${S.blocked} 次`);
