/* 仆从"短时间多次攻击"排查探针：
   只统计【真正造成伤害】的命中 —— 判据是仆从的攻击冷却 hitCd 被重置
   （碰撞回调不等于命中：冷却没走完的那次会被闸门挡掉，不算攻击）。
   同时记录每一次被挡掉的碰撞回调，用来衡量"贴着敌人磨"的程度。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', '杀戮尖塔小球对决.html');
let src =(()=>{const b=(String(fs.readFileSync(HTML, 'utf8')).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})();
src += `
globalThis.__T = { world, CARD_BY_ID, stepPhysics, resetMatch, Minion, MinionBrain, MechCharge };
`;

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
  setTimeout, clearTimeout, console, Math, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T, W = T.world;
const DT = 1 / 60;

const HITS = [];            // 真命中
let midSeq = 0;
const Brain = T.MinionBrain.prototype;
const origUpdate = Brain.update, origHit = Brain.onUnitHit, origOrder = Brain.orderRam;
let BLOCKED = 0, RAM_ENTRIES = 0, LEASH_ENTRIES = 0;

function tag(m) { if (!m.__id) { m.__id = ++midSeq; m.__ev = []; } return m; }
function ev(m, e) { const a = tag(m).__ev; a.push(W.t.toFixed(2) + ' ' + e); if (a.length > 14) a.shift(); }

Brain.update = function (dt) {
  const m = tag(this.m), p = this.p;
  const hd = Math.hypot(m.o.x - m.x, m.o.y - m.y);
  if (hd > p.leashR && !this.leashing) LEASH_ENTRIES++;
  const st0 = m.state;
  const r = origUpdate.call(this, dt);
  if (m.state !== st0) {
    ev(m, st0 + '→' + m.state);
    if (m.state === 'ram' && st0 !== 'ram') RAM_ENTRIES++;
  }
  return r;
};
Brain.orderRam = function (t) {
  const m = tag(this.m);
  if (!this.leashing && m.state !== 'ram') ev(m, '本体下令(原状态' + m.state + ')');
  return origOrder.call(this, t);
};
Brain.onUnitHit = function (e) {
  const m = tag(this.m);
  const before = m.state, cd0 = this.hitCd;
  const hd = Math.hypot(m.o.x - m.x, m.o.y - m.y);
  const ed = e ? Math.hypot(e.x - m.x, e.y - m.y) : NaN;
  const r = origHit.call(this, e);
  if (!e || e.minion) return r;
  const real = this.hitCd > cd0;                    // 冷却被重置 = 真打出去了
  if (real) {
    const prev = HITS.filter(h => h.mid === m.__id).slice(-1)[0];
    HITS.push({
      t: W.t, mid: m.__id, foe: (e.card && e.card.name) || '?',
      gap: prev ? W.t - prev.t : null, hd, ed,
      boost: m.boost || 0, base: m.baseSpeed, ev: m.__ev.slice(),
    });
  } else if (before === 'ram') BLOCKED++;            // 在 ram 里撞上了，但冷却没走完 → 不算攻击
  return r;
};

/* ---------- 跑对局 ---------- */
const CAP = 240, N = 8;
const foes = ['dark_embrace', 'knife_trap', 'perfected_strike', 'defy'];
console.log('冲锋 vs 对手：只统计【真正造成伤害】的命中\n');
console.log('  对手     命中   最小间隔  中位    P10   <0.5s  <1.0s   ram重入  拴绳触发  被挡回调');
for (const fid of foes) {
  const t0 = HITS.length, r0 = RAM_ENTRIES, l0 = LEASH_ENTRIES, b0 = BLOCKED;
  for (let k = 0; k < N; k++) {
    T.resetMatch(T.CARD_BY_ID['charge'], T.CARD_BY_ID[fid]);
    W.running = true;
    let s = 0;
    while (!W.over && W.t < CAP && s < CAP / DT + 5) { W.t += DT; T.stepPhysics(DT); s++; }
  }
  const g = HITS.slice(t0);
  const gaps = g.map(h => h.gap).filter(x => x !== null).sort((a, b) => a - b);
  const q = qq => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(qq * gaps.length))] : NaN;
  console.log('  ' + T.CARD_BY_ID[fid].name.padEnd(7) +
    String(g.length).padStart(5) + '  ' + (gaps[0] || 0).toFixed(2).padStart(7) + 's  ' +
    q(0.5).toFixed(2).padStart(5) + 's  ' + q(0.1).toFixed(2).padStart(5) + 's  ' +
    String(gaps.filter(x => x < 0.5).length).padStart(5) + '  ' +
    String(gaps.filter(x => x < 1.0).length).padStart(5) + '  ' +
    String(RAM_ENTRIES - r0).padStart(7) + '  ' + String(LEASH_ENTRIES - l0).padStart(8) + '  ' +
    String(BLOCKED - b0).padStart(8));
}

const all = HITS.map(h => h.gap).filter(x => x !== null);
console.log('\n=== 真命中间隔分布（同一仆从连续两击）===');
const bucket = [0, 0.5, 1.0, 1.5, 2, 3, 5, 999];
const cnt = new Array(bucket.length - 1).fill(0);
all.forEach(g => { for (let i = 0; i < bucket.length - 1; i++) if (g >= bucket[i] && g < bucket[i + 1]) { cnt[i]++; break; } });
bucket.slice(0, -1).forEach((b, i) => {
  const pct = all.length ? (cnt[i] / all.length * 100) : 0;
  console.log('  ' + (b.toFixed(1) + '~' + bucket[i + 1].toFixed(1) + 's').padStart(12) + '  ' +
    String(cnt[i]).padStart(5) + ' 次  ' + '#'.repeat(Math.round(pct / 2)) + ' ' + pct.toFixed(1) + '%');
});
console.log('\n真命中 ' + HITS.length + ' 次；间隔 <0.5s 的 ' + all.filter(g => g < 0.5).length +
  ' 次（' + (all.filter(g => g < 0.5).length / all.length * 100).toFixed(1) + '%）' +
  '   —— 最小间隔应等于 mRest=' + T.CARD_BY_ID['charge'].p.mRest + 's');
console.log('被冷却挡掉的碰撞回调 ' + BLOCKED + ' 次（这些是"撞上但不算攻击"，不再产生伤害/特效）');

if (all.some(g => g < 0.5)) {
  console.log('\n=== 仍有 <0.5s 的（前 5 个）===');
  HITS.filter(h => h.gap !== null && h.gap < 0.5).sort((a, b) => a.gap - b.gap).slice(0, 5).forEach(h => {
    console.log(' 间隔 ' + h.gap.toFixed(2) + 's @' + h.t.toFixed(2) + ' 离本体 ' + h.hd.toFixed(0) +
      'px 离敌 ' + h.ed.toFixed(0) + 'px 事件: ' + h.ev.join(' | '));
  });
}
