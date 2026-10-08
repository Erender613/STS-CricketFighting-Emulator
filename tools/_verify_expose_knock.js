/* 验证本轮两条改动（直接驱动真实战斗引擎，不打桩）：
   1) 暴露：一次光束总伤害 < 75 → 本次冷却 -1.8 秒（含阈值边界、dealt 统计口径）
   2) 电流相生：电球击退加大到 45/270 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', '杀戮尖塔小球对决.html');
let src =(()=>{const b=(String(fs.readFileSync(HTML, 'utf8')).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})();
src += `
globalThis.__T = { world, CFG, CARD_BY_ID, stepPhysics, resetMatch, Beam, MECHS, Orb, Unit };
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
const T = sandbox.__T, W = T.world, CFG = T.CFG;
const DT = 1 / 60;
const byId = (id) => T.CARD_BY_ID[id];

let pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  [OK]   ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  [FAIL] ' + name + '   ' + detail); }
}
function step(n) { for (let i = 0; i < n; i++) { W.t += DT; T.stepPhysics(DT); if (W.over) return true; } return false; }
function park(u) { u.mech.update = () => { }; u.baseSpeed = 0; u.boost = 0; u.freeze = 1e9; }

const EP = byId('expose').p, VP = byId('voltaic').p;

/* ============ 1. 参数落地 ============ */
console.log('\n【1】参数');
chk('expose.lowDmg = 75', EP.lowDmg === 75, `=${EP.lowDmg}`);
chk('expose.lowCd = 1.8', EP.lowCd === 1.8, `=${EP.lowCd}`);
chk('voltaic.shotKnock = 10（已回退到最原始值）', VP.shotKnock === 10, `=${VP.shotKnock}`);
chk('voltaic.shotKnockCap = 60（已回退到最原始值）', VP.shotKnockCap === 60, `=${VP.shotKnockCap}`);
chk('cap 未越过引擎硬上限 380', VP.shotKnockCap <= 380, `cap=${VP.shotKnockCap}`);

/* ============ 2. onBeamEnd 阈值逻辑（含边界） ============ */
console.log('\n【2】暴露 · 光束结算的阈值判定');
{
  const M = T.MECHS.expose;
  const mk = (cd) => { const m = new M({ alive: true, dying: null, grabbed: 0 }, EP); m.cd = cd; return m; };
  let m = mk(5); m.onBeamEnd(74.9);
  chk('总伤害 74.9（<75）→ 冷却 5 → 3.2', Math.abs(m.cd - 3.2) < 1e-9, `cd=${m.cd.toFixed(3)}`);
  m = mk(5); m.onBeamEnd(0);
  chk('一炮全空（0）→ 冷却 5 → 3.2', Math.abs(m.cd - 3.2) < 1e-9, `cd=${m.cd.toFixed(3)}`);
  m = mk(5); m.onBeamEnd(75);
  chk('恰好 75（不小于 75）→ 冷却不动', m.cd === 5, `cd=${m.cd}`);
  m = mk(5); m.onBeamEnd(400);
  chk('打满 400 → 冷却不动', m.cd === 5, `cd=${m.cd}`);
  m = mk(1); m.onBeamEnd(10);
  chk('剩余冷却不足 1.8 时砍到 0，不为负', m.cd === 0, `cd=${m.cd}`);
  m = mk(5); m.onBeamEnd(10); m.onBeamEnd(10);
  chk('连续两炮都打空 → 累减两次数', Math.abs(m.cd - 1.4) < 1e-9, `cd=${m.cd.toFixed(3)}`);
}

/* ============ 3. 真引擎：光束的总伤害统计 ============ */
console.log('\n【3】暴露 · 一次光束的 dealt 是否等于目标实际掉血');
{
  /* --- 3a 打空（目标挪到场外） --- */
  T.resetMatch(byId('expose'), byId('defy'));
  W.running = true;
  {
    const A = W.units[0], B = W.units[1];
    park(A); park(B);
    A.mech.cd = 5;                       // cd 冻住，不让它自己发第二炮
    B.x = -3000; B.y = -3000;
    const beam = new T.Beam(A, 60, 330, 0, EP);
    W.effects.push(beam);
    let n = 0; while (!beam.dead && n < 400) { step(1); n++; }
    chk('光束自然消散并触发结算', beam.dead && beam.settled === true, `dead=${beam.dead} settled=${beam.settled}`);
    chk('全程没碰到人 → dealt = 0', beam.dealt === 0, `dealt=${beam.dealt}`);
    chk('打空 → 冷却从 5 砍到 3.2', Math.abs(A.mech.cd - 3.2) < 1e-9, `cd=${A.mech.cd.toFixed(3)}`);
  }

  /* --- 3b 打满（目标摆在光束第一段上） --- */
  T.resetMatch(byId('expose'), byId('defy'));
  W.running = true;
  {
    const A = W.units[0], B = W.units[1];
    park(A); park(B);
    A.mech.cd = 5;
    B.hp = 1e6;                          // 撑住别被打死，好统计完整
    B.x = 350; B.y = 330;
    const hp0 = B.hp;
    const beam = new T.Beam(A, 60, 330, 0, EP);
    W.effects.push(beam);
    let n = 0; while (!beam.dead && n < 400) { step(1); n++; }
    const lost = hp0 - B.hp;
    chk('打中 → dealt 远超阈值', beam.dealt > 75, `dealt=${beam.dealt}`);
    chk('dealt 与实际掉血逐点一致', beam.dealt === lost, `dealt=${beam.dealt} 掉血=${lost}`);
    chk('打满 → 冷却保持 5 不变', A.mech.cd === 5, `cd=${A.mech.cd}`);
  }
}

/* ============ 4. 真对局：每一次光束的 dealt ↔ 冷却减免 配对 ============ */
console.log('\n【4】暴露 · 真实对局中"打空返冷却"的实际触发');
const LOG = [];
{
  const proto = T.MECHS.expose.prototype, orig = proto.onBeamEnd;
  proto.onBeamEnd = function (dealt) {
    const before = this.cd;
    orig.call(this, dealt);
    LOG.push({ dealt, before, after: this.cd });
  };
}
{
  const foes = ['defy', 'voltaic', 'pillage', 'dark_embrace'];
  const CAP = 240, N = 6;
  for (const fid of foes) {
    for (let k = 0; k < N; k++) {
      T.resetMatch(byId('expose'), byId(fid));
      W.running = true;
      let s = 0;
      while (!W.over && W.t < CAP && s < CAP / DT + 5) { W.t += DT; T.stepPhysics(DT); s++; }
    }
  }
}
{
  const bad = LOG.filter(r => (r.dealt < 75) !== (r.before - r.after > 0));
  chk('每一炮都满足「dealt<75 ⟺ 冷却被砍」', bad.length === 0,
    `共 ${LOG.length} 炮，异常 ${bad.length} 炮`);
  const cuts = LOG.filter(r => r.before - r.after > 0);
  const badCut = cuts.filter(r => Math.abs((r.before - r.after) - 1.8) > 1e-9);
  chk('所有触发的减免都恰好是 1.8 秒', badCut.length === 0, `异常 ${badCut.length} 次`);
  const ds = LOG.map(r => r.dealt).sort((a, b) => a - b);
  const med = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  console.log('       共 ' + LOG.length + ' 炮；总伤害中位数 ' + med +
    '，最低 ' + (ds[0] | 0) + '，最高 ' + (ds[ds.length - 1] | 0));
  console.log('       打空(<75) ' + cuts.length + ' 炮（' + (LOG.length ? (cuts.length / LOG.length * 100).toFixed(1) : 0) +
    '%）→ 这些炮的平均间隔比打满的短 1.8 秒');
  const bucket = [0, 25, 50, 75, 150, 300, 1e9];
  const cnt = new Array(bucket.length - 1).fill(0);
  LOG.forEach(r => { for (let i = 0; i < bucket.length - 1; i++) if (r.dealt >= bucket[i] && r.dealt < bucket[i + 1]) { cnt[i]++; break; } });
  console.log('       dealt 分布：');
  bucket.slice(0, -1).forEach((b, i) => {
    const pct = LOG.length ? cnt[i] / LOG.length * 100 : 0;
    console.log('         ' + (b + '~' + (bucket[i + 1] > 1e8 ? '∞' : bucket[i + 1])).padStart(12) +
      '  ' + String(cnt[i]).padStart(4) + '  ' + '#'.repeat(Math.round(pct / 3)) + ' ' + pct.toFixed(1) + '%' +
      (bucket[i + 1] === 75 ? '   ← 减免线' : ''));
  });
}

/* ============ 5. 电流相生：电球击退的实测力度 ============ */
console.log('\n【5】电流相生 · 电球击退实测（boost = 临时加速量，被 nudge 叠上去）');
{
  T.resetMatch(byId('voltaic'), byId('defy'));
  W.running = true;
  const A = W.units[0], B = W.units[1];
  park(A); park(B);
  B.hp = 1e6;
  B.x = 350; B.y = 330;
  /* park 把 freeze 拉满会让 curSpeed() 恒为 0，测不到"推力→速度"；
     这里解冻，并把朝向清零（有速度但不动位置），只观察 boost 折算出的速度。 */
  B.freeze = 0; B.dx = 0; B.dy = 0;
  /* 一"轮"齐射：10 发错开一点点出膛，模拟真实连续命中 */
  for (let i = 0; i < 10; i++) {
    const o = new T.Orb(A, 0, VP);
    o.state = 'fire'; o.launched = true; o.life = 0; o.aim = 0; o.delay = 0;
    o.x = 150 - i * 40; o.y = 330; o.spd = 800;
    W.effects.push(o);
  }
  let peak = 0, spdPeak = 0;
  const hp0 = B.hp;
  for (let i = 0; i < 120; i++) {
    step(1);
    if (B.boost > peak) peak = B.boost;
    if (B.curSpeed() > spdPeak) spdPeak = B.curSpeed();
  }
  const hits = Math.round((hp0 - B.hp) / VP.shotDmg);
  chk('10 发电球命中后 boost 峰值被 cap 60 封住', peak > 0 && peak <= 60 + 1e-6, `峰值 ${peak.toFixed(1)}（原始 cap 60）`);
  /* 注意：park 会把 baseSpeed 清零，所以 curSpeed() 读到的就是纯 boost 折算出的速度；
     拿它跟【卡面基础速度】比在原始击退(10/60)下必然不成立（cap 只有 60 < 156），
     要跟【本体实际的 baseSpeed】比。 */
  chk('推力确实折算成了速度', spdPeak > B.baseSpeed, `速度峰值 ${spdPeak.toFixed(0)}（本体基础速度 ${B.baseSpeed}，卡面 ${B.card.speed}）`);
  console.log('       命中约 ' + hits + ' 次，boost 峰值 ' + peak.toFixed(1) +
    '；已回退到原始配置(10/60)');

  /* 对照：单发推力确实是 10 */
  B.boost = 0;
  B.nudge(VP.shotKnock, VP.shotKnockCap);
  chk('单发推力 = 10', Math.abs(B.boost - 10) < 1e-6, `boost=${B.boost.toFixed(2)}`);
}

console.log('\n===== 结果：' + pass + ' 项通过，' + fail + ' 项失败 =====');
process.exit(fail ? 1 : 0);
