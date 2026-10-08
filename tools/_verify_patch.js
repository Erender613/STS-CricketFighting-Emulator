/* 逐条验证本轮改动是否真的生效 —— 直接驱动真实战斗引擎，不打桩。
 *
 * ⚠ 部分小节已作废（2026-09-23 晚）：冲锋仆从 AI 被"完全重构"后，
 *   涉及 p.mSpd / p.restSpd / p.leashSpd / mech.hitCd / mech.state==='ram' 的那几条
 *   （【3】回防速度、【4】撞击后退、【?】仆从冲撞）已无对应实现，会报 undefined 而不通过。
 *   其余各节（电流相生环绕、暴露、锻打、劫掠、种子、环绕灼烧等）仍然有效，可照跑。
 *   仆从新 AI 的验收见 tools/_minion_ai_check.js。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
let src =(()=>{const b=(String(html).match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9));return b.sort((x,y)=>y.length-x.length)[0]||'';})();
src += `
globalThis.__T = { world, CFG, CARD_BY_ID, CARDS, stepPhysics, resetMatch,
  Knife, Orb, DarkOrb, Star, Minion, MinionBrain, MechCharge, MechPillage, MechSnakebite, MechVoltaic };
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
/* 沙箱里的 Math.random 换成可复现的种子随机：
   否则依赖随机的断言（如"劫掠突进位移"）每次跑出不同数值，会误报成 FAIL。
   Object.create(Math) 让 hypot/floor 等其它方法照常可用，只替换 random。 */
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
/* 把一张卡彻底"停住"：不跑机制、不移动（用于搭场景，排除干扰） */
function park(u) { u.mech.update = () => { }; u.baseSpeed = 0; u.boost = 0; u.freeze = 1e9; }
/* 造一个被冻住的仆从 */
function makeMinion(owner, x, y) {
  const m = new T.Minion(owner, x, y, owner.card.p);
  m.mech.update = () => { };
  W.units.push(m);
  return m;
}

/* ============ 1. 弹幕穿过仆从：飞刀 ============ */
console.log('\n【1】弹幕击中仆从 → 打一次伤害后穿过（刀刃陷阱飞刀 vs 冲锋仆从）');
{
  T.resetMatch(byId('knife_trap'), byId('charge'));
  W.running = true;
  const kt = W.units[0], ch = W.units[1];
  kt.mech.cd = 1e9;                       // 别让刀刃陷阱自己扔刀，减少噪声
  ch.mech.cd = 1e9;                       // 冲锋别再造仆从
  ch.x = 600; ch.y = 600;                 // 本体挪角落，让飞刀能一路飞过去
  const mn = makeMinion(ch, 400, 330);
  const hp0 = mn.hp;
  const kn = new T.Knife(kt, 180, 330, 0, byId('knife_trap').p);
  W.effects.push(kn);
  let n = 0;
  while (!kn.dead && n < 180 && kn.state !== 'stuck') { step(1); n++; }
  chk('飞刀命中仆从后没有消失', !kn.dead, `dead=${kn.dead} state=${kn.state} 用了 ${(n * DT).toFixed(2)}s`);
  chk('仆从吃到了一次伤害', mn.hp < hp0, `hp ${hp0} → ${mn.hp}`);
  chk('飞刀记下了穿过的仆从', kn.hitMinions.size === 1, `hitMinions=${kn.hitMinions.size}`);
  chk('飞刀继续飞到了墙边', kn.state === 'stuck', `state=${kn.state} x=${kn.x.toFixed(0)}`);
}

/* ============ 2. 另外三种弹幕同样穿过仆从 ============ */
console.log('\n【2】电球 / 暗黑球 / 辉星 同样穿过仆从');
{
  const mk = () => {
    T.resetMatch(byId('knife_trap'), byId('charge'));
    W.running = true;
    const A = W.units[0], B = W.units[1];
    A.mech.cd = 1e9; B.mech.cd = 1e9;
    B.x = 600; B.y = 600;                 // 本体挪开，避免弹幕先撞本体
    const mn = makeMinion(B, 300, 330);
    return { A, mn };
  };
  {
    const { A, mn } = mk();
    mn.maxHp = 1e6; mn.hp = 1e6;             // 血厚木桩：几下打不死，才能数清挨了几下
    const o = new T.Orb(A, 0, byId('voltaic').p);
    o.state = 'fire'; o.launched = true; o.life = 0; o.aim = 0; o.delay = 0;
    o.x = 150; o.y = 330; o.spd = 800;
    W.effects.push(o);
    let n = 0; while (!o.dead && n < 180) { step(1); n++; }
    chk('电球命中仆从后继续飞', o.hitMinions.size === 1 && o.x > 340, `x=${o.x.toFixed(0)} 穿过=${o.hitMinions.size}`);
    /* 关键回归：穿过 ≠ 每帧都打。同一颗电球对同一只仆从必须【只结算 1 次】。
       曾因漏写去重检查，一颗电球能打同一只仆从 33 下（8 伤 ×33 = 264）。
       用血量差反推次数（把木桩血量抬高，免得几下就被打死数不清）。 */
    const vP = byId('voltaic').p;
    chk('同一颗电球对它只打 1 次', Math.round((1e6 - mn.hp) / vP.shotDmg) === 1,
      `挨了 ${Math.round((1e6 - mn.hp) / vP.shotDmg)} 下（${vP.shotDmg} 伤/下）`);
  }
  {
    const { A, mn } = mk();
    mn.maxHp = 1e6; mn.hp = 1e6;             // 血厚木桩：几下打不死，才能数清挨了几下
    const d = new T.DarkOrb(A, byId('darkness').p);
    d.state = 'seek'; d.vx = 1; d.vy = 0; d.x = 250; d.y = 330; d.seekT = 0;
    W.effects.push(d);
    let n = 0, xHit = -1;
    while (n < 180 && d.hitMinions.size === 0) { step(1); n++; xHit = d.x; }
    while (!d.dead && n < 240) { step(1); n++; }
    chk('暗黑球命中仆从后继续飞', xHit >= 0 && d.x > xHit + 15, `命中时 x=${xHit.toFixed(0)} → 飞完 x=${d.x.toFixed(0)} 穿过=${d.hitMinions.size}`);
    /* 同上的关键回归：暗黑球原先也是"先伤害、后去重"，重叠期间每帧都打。 */
    const dP = byId('darkness').p;
    const dHits = Math.round((1e6 - mn.hp) / dP.dmg);
    chk('同一颗暗黑球对它只打 1 次', dHits === 1, `挨了 ${dHits} 下（${dP.dmg} 伤/下）`);
  }
  {
    /* 辉星是"从场外螺旋吸回本体"的弹幕 —— 仆从要压在本体附近才会被扫到 */
    T.resetMatch(byId('guiding_star'), byId('charge'));
    W.running = true;
    const gs = W.units[0], ch = W.units[1];
    park(gs); ch.mech.cd = 1e9;
    ch.x = 620; ch.y = 620;
    const mn = makeMinion(ch, gs.x + 130, gs.y);
    mn.maxHp = 1e6; mn.hp = 1e6;             // 血厚木桩：几下打不死，才能数清挨了几下
    const hp0 = mn.hp;
    const st = new T.Star(gs, gs.x + 300, gs.y, 0, byId('guiding_star').p, 1);
    W.effects.push(st);
    let n = 0; while (n < 180 && st.hitMinions.size === 0) { step(1); n++; }
    chk('辉星命中仆从后记下穿过', st.hitMinions.size === 1, `穿过=${st.hitMinions.size} dead=${st.dead}`);
    /* 同上的关键回归：辉星原先也是"先伤害、后去重"（一圈实测每只能挨 11~26 下）。 */
    const sHits = Math.round((hp0 - mn.hp) / byId('guiding_star').p.dmg);
    chk('同一颗辉星对它只打 1 次', sHits === 1, `挨了 ${sHits} 下（${byId('guiding_star').p.dmg} 伤/下）`);
  }
}

/* ============ 3. 仆从拴绳（离本体 >400px 快速回防） ============ */
console.log('\n【3】仆从离本体 >400px → 优先快速回到本体身边');
{
  T.resetMatch(byId('darkness'), byId('charge'));
  W.running = true;
  const foe = W.units[0], ch = W.units[1];
  park(foe); ch.mech.cd = 1e9;
  const p = ch.card.p;
  const mn = new T.Minion(ch, 60, 120, p);      // 与本体 (495,330) 相距约 483px，且离墙有距离
  W.units.push(mn);
  const d0 = Math.hypot(mn.x - ch.x, mn.y - ch.y);
  let spdMax = 0, dirOK = false;
  for (let i = 0; i < 60; i++) {
    step(1);
    if (mn.baseSpeed === p.leashSpd) {
      spdMax = p.leashSpd;
      if (mn.dx > 0.5) dirOK = true;            // 方向朝本体（本体在右下）
    }
    if (Math.hypot(mn.x - ch.x, mn.y - ch.y) <= p.leashR) break;
  }
  const d1 = Math.hypot(mn.x - ch.x, mn.y - ch.y);
  chk('拴绳半径参数为 400', p.leashR === 400, `leashR=${p.leashR}`);
  chk('超出后切到回防速度', spdMax === p.leashSpd && spdMax > p.mSpd, `baseSpeed=${spdMax}（冲撞 ${p.mSpd}）`);
  chk('回防时方向指向本体', dirOK, `dx=${mn.dx.toFixed(2)}`);
  chk('一路收进 400px 以内', d1 <= p.leashR + 1, `距离 ${d0.toFixed(0)} → ${d1.toFixed(0)}`);

  /* 对照组：距离在 400 以内时不该触发回防 */
  const mn2 = new T.Minion(ch, ch.x - 300, ch.y, p);
  W.units.push(mn2);
  step(3);
  chk('400px 以内不触发回防', mn2.baseSpeed !== p.leashSpd, `baseSpeed=${mn2.baseSpeed}（回防速度是 ${p.leashSpd}）`);
}

/* ============ 4. 仆从撞人后大幅反弹 ============ */
console.log('\n【4】仆从冲撞敌人之后大幅反弹');
{
  T.resetMatch(byId('darkness'), byId('charge'));
  W.running = true;
  const foe = W.units[0], ch = W.units[1];
  park(foe); ch.mech.cd = 1e9;
  /* 把本体也搬到敌人旁边：仆从一旦离本体太远就会触发【回防】（那是【3】的事），
     会把状态强制成 idle，导致这里看不到 ram→rest。隔离掉这个干扰。 */
  park(ch); ch.x = foe.x - 200; ch.y = foe.y;
  const p = ch.card.p;
  const mn = new T.Minion(ch, foe.x - 60, foe.y, p);   // 贴着敌人（54+26=80 才接触）
  W.units.push(mn);
  chk('仆从贴着本体（不会触发回防，隔离反弹测试）',
    Math.hypot(mn.x - ch.x, mn.y - ch.y) < p.leashBack,
    `离本体 ${Math.hypot(mn.x - ch.x, mn.y - ch.y).toFixed(0)}px < leashBack ${p.leashBack}`);
  mn.state = 'ram'; mn.mech.m.state = 'ram'; mn.mech.m.timer = 0.8;
  mn.mech.m.dx = 1; mn.mech.m.dy = 0;                  // 朝右撞敌人
  const hp0 = foe.hp;
  let hitFrame = -1, boostAfter = 0, dirDot = 1;
  for (let i = 0; i < 30; i++) {
    const st0 = mn.state;
    step(1);
    if (st0 === 'ram' && mn.state === 'rest') {
      hitFrame = i; boostAfter = mn.boost;
      const ex = foe.x - mn.x, ey = foe.y - mn.y, L = Math.hypot(ex, ey) || 1;
      dirDot = (mn.dx * ex + mn.dy * ey) / L;          // <0 = 已朝反方向弹开
      break;
    }
  }
  chk('确实撞上了（进入 rest）', hitFrame >= 0, `第 ${hitFrame} 帧，敌人掉血 ${hp0 - foe.hp}`);
  chk('反弹加了很大一段加速', boostAfter >= 300, `boost=${boostAfter.toFixed(0)}（参数 bounce=${p.bounce}）`);
  chk('方向已弹离敌人', dirDot < 0, `dot=${dirDot.toFixed(2)}`);
  const v0 = mn.curSpeed();
  step(1);
  chk('撞击后仍在高速后退', v0 > 300, `速度 ${v0.toFixed(0)} px/s（常速 ${p.restSpd}）`);
}

/* ============ 5. 劫掠：前摇 / 连段冷却 / 冲撞距离速度 ============ */
console.log('\n【5】劫掠：初始前摇 0.25s、连段间 0.75s 冷却、冲撞更远更快');
{
  T.resetMatch(byId('darkness'), byId('pillage'));
  W.running = true;
  const foe = W.units[0], pl = W.units[1];
  const p = byId('pillage').p;
  chk('charge0 = 0.25', p.charge0 === 0.25, `charge0=${p.charge0}`);
  chk('comboCd = 0.75', p.comboCd === 0.75, `comboCd=${p.comboCd}`);

  /* 对手停到左上角并冻结机制，让劫掠有一条长对角线可以跑满 */
  park(foe); foe.x = 10; foe.y = 10;

  let t0 = -1;
  for (let i = 0; i < 60 * 8; i++) {
    step(1);
    if (pl.mech.state === 'charge') { t0 = pl.mech.timer; pl.x = 620; pl.y = 620; break; }
  }
  chk('第一次蓄力时长 ≈ 0.25s', t0 > 0 && t0 <= 0.26, `timer=${t0.toFixed(3)}`);

  /* 跑满一次突进（到状态离开 dash），量位移与峰值速度 */
  let peak = 0, spdCapSeen = null, x0 = null, dist = -1, n = 0;
  while (n < 60 * 5) {
    const wasDash = pl.mech.state === 'dash';
    step(1); n++;
    if (pl.mech.state === 'dash') {
      if (x0 === null) {
        x0 = { x: pl.x, y: pl.y }; spdCapSeen = pl.spdCap;
        /* 把位移积分出来，避免被墙/对手碰撞截断影响读数 */
        var model = 0;
      }
      model += pl.curSpeed() * DT;
      peak = Math.max(peak, pl.curSpeed());
      dist = model;
    } else if (wasDash) break;
  }
  chk('突进期间放开速度上限到 900', spdCapSeen === 900 && peak > 700 && peak <= 900.5, `spdCap=${spdCapSeen} 峰值=${peak.toFixed(0)} px/s`);
  /* 注意：这条只作"跑出了有效位移"的参考。突进受随机相位驱动，前面测试消耗
     rand 的个数一变，这里的起手相位就变（同一份代码能跑出 558 / 626 两个读数）。
     真正的新旧参数对比在【8】，那里会把随机数流重置后各跑一次再比。 */
  chk('这次突进跑出了有效位移（参考值）', dist > 400, `本次位移 ${dist.toFixed(0)} px`);
  chk('突进结束交还速度上限', pl.spdCap === undefined, `spdCap=${pl.spdCap}`);

  /* 命中后应插 0.75s 冷却（走 idle 的 cd）而不是立刻再蓄力 */
  let sawComboCd = null;
  for (let i = 0; i < 60 * 25; i++) {
    const st0 = pl.mech.state;
    step(1);
    if (st0 === 'dash' && pl.mech.state === 'idle' && pl.mech.combo > 0) { sawComboCd = pl.mech.cd; break; }
  }
  chk('命中后先歇 0.75s 再蓄力', sawComboCd !== null && Math.abs(sawComboCd - 0.75) < 0.05, `cd=${sawComboCd === null ? '未出现' : sawComboCd.toFixed(3)}`);
}

/* ============ 6. 蛇咬：恰好攒到 50 层（一层都没多）扑出 → 免冷却 ============ */
console.log('\n【6】蛇咬：毒液整数层数恰好 50 就扑出 → 取消本次冷却（多攒一点不免）');
{
  T.resetMatch(byId('snakebite'), byId('darkness'));
  W.running = true;
  const sb = W.units[0], foe = W.units[1];
  const mech = sb.mech, p = byId('snakebite').p;
  chk('freeCdAt = 50', p.freeCdAt === 50, `freeCdAt=${p.freeCdAt}`);

  mech.state = 'cling'; mech.stock = 10;            // 对照组：不足 50
  mech.pounce(); mech.onUnitHit(foe);
  chk('不足 50 层扑击 → 不免冷却', mech.cd === p.cd, `cd=${mech.cd}（应为 ${p.cd}）`);

  mech.state = 'cling'; mech.stock = 50;            // 实验组：恰好第 50 层
  mech.pounce(); mech.onUnitHit(foe);
  chk('恰好 50 层扑击命中 → 冷却取消', mech.cd === 0, `cd=${mech.cd}`);

  mech.state = 'cling'; mech.stock = 50.4;          // 边界：仍是第 50 层（floor 50）
  mech.pounce(); mech.onUnitHit(foe);
  chk('50.4 层（floor 仍 50）→ 冷却取消', mech.cd === 0, `cd=${mech.cd}`);

  mech.state = 'cling'; mech.stock = 51;            // 边界：多攒了一层
  mech.pounce(); mech.onUnitHit(foe);
  chk('多攒一层（51）→ 不免冷却', mech.cd === p.cd, `cd=${mech.cd}（应为 ${p.cd}）`);

  mech.state = 'cling'; mech.stock = p.poisonCap;   // 攒满才扑 + 扑空路径
  mech.pounce(); mech.done();
  chk('攒满才扑且扑空 → 不免冷却', mech.cd === p.cd, `cd=${mech.cd}（应为 ${p.cd}）`);
}

/* ============ 6b. 蛇咬：扑击直伤 25 / 回血要先攒够 50 ============ */
console.log('\n【6b】蛇咬：扑击附带 25 点伤害、毒素 ≥50 才开始回血');
{
  T.resetMatch(byId('snakebite'), byId('darkness'));
  W.running = true;
  const sb = W.units[0], foe = W.units[1];
  const mech = sb.mech, p = byId('snakebite').p;
  chk('pounceDmg = 25', p.pounceDmg === 25, `pounceDmg=${p.pounceDmg}（旧 12）`);
  chk('healAt = 50', p.healAt === 50, `healAt=${p.healAt}`);

  mech.state = 'cling'; mech.stock = 0;
  const hp0 = foe.hp;
  mech.pounce(); mech.onUnitHit(foe);
  chk('扑击命中掉 25 血（毒素为 0）', hp0 - foe.hp === 25, `掉了 ${hp0 - foe.hp} 点`);

  /* 回血门槛：把对手挪到索敌半径外，让蛇一直蛰伏攒毒 */
  foe.x = 620; foe.y = 620; park(foe);
  sb.hp = 500; mech.state = 'cling'; mech.stock = 10; mech.healAcc = 0;
  step(60);
  chk('毒素 <50 不回血', sb.hp === 500, `hp=${sb.hp} stock=${mech.stock.toFixed(0)}`);

  mech.state = 'cling'; mech.stock = 50; mech.healAcc = 0;
  step(90);
  chk('毒素 ≥50 开始回血', sb.hp >= 515 && sb.hp <= 525, `hp=${sb.hp}（约 +20）`);
}

/* ============ 7. 电流相生：环绕伤害 10×3 ============ */
console.log('\n【7】电流相生：环绕电球 = 每秒 10 次 × 3 点，发射击退保持原始值');
{
  T.resetMatch(byId('darkness'), byId('voltaic'));
  W.running = true;
  const v = W.units[1], foe = W.units[0];
  const p = byId('voltaic').p;
  chk('dpsTick=10 / orbitDmg=3', p.dpsTick === 10 && p.orbitDmg === 3, `${p.dpsTick}×${p.orbitDmg}（总 30 dps；沿革 30×1 → 20×3 → 10×1 → 10×3）`);
  chk('发射击退已回退到原始值', p.shotKnock === 10 && p.shotKnockCap === 60, `knock=${p.shotKnock} cap=${p.shotKnockCap}（10/60 → 30/180 → 45/270 → 回退 10/60）`);

  /* 环绕半径 92：把本体摆到离对手 60px，圈就会扫过对手（判定半径 51.3） */
  park(v); park(foe);
  v.x = foe.x - 60; v.y = foe.y;
  const o = new T.Orb(v, 0, p);
  o.hold = true;                                  // 别自转，让它停在正对对手那一侧
  W.effects.push(o);
  const hp0 = foe.hp;
  step(60);
  const dps = hp0 - foe.hp;
  chk('单颗环绕电球 ≈ 30 dps', Math.abs(dps - 30) <= 2.5, `1 秒掉血 ${dps} 点`);
}

/* ============ 8. 劫掠冲撞：新旧参数受控 A/B ============
   每一次都先把随机数流重置到同一颗种子，两组的起手相位完全一致，
   于是"谁跑得更远/更快"就只由 dashImpulse / dashT 决定，
   不受前面测试消耗了多少 rand 的影响。（放在最后，重置随机流不影响别的断言。） */
console.log('\n【8】劫掠冲撞距离/速度：新旧参数受控对比（同随机流）');
{
  const p = byId('pillage').p;
  function runDash(impulse, dashT) {
    seededMath.random = mulberry32(20260922);        // 回到同一随机起点
    const svI = p.dashImpulse, svT = p.dashT;
    p.dashImpulse = impulse; p.dashT = dashT;
    T.resetMatch(byId('darkness'), byId('pillage'));
    W.running = true;
    const foe = W.units[0], pl = W.units[1];
    park(foe); foe.x = 10; foe.y = 10;               // 对手塞进左上角，突进有一条对角线可跑
    let launched = false, model = 0, peak = 0, n = 0;
    while (n < 60 * 8) {                              // 先等它进入蓄力，再摆到右下起跑点
      step(1); n++;
      if (pl.mech.state === 'charge') { pl.x = 620; pl.y = 620; launched = true; break; }
    }
    if (!launched) { p.dashImpulse = svI; p.dashT = svT; return null; }
    n = 0;
    while (n < 60 * 5) {
      const wasDash = pl.mech.state === 'dash';
      step(1); n++;
      if (pl.mech.state === 'dash') { model += pl.curSpeed() * DT; peak = Math.max(peak, pl.curSpeed()); }
      else if (wasDash) break;
    }
    p.dashImpulse = svI; p.dashT = svT;
    return { dist: model, peak: peak };
  }
  const cur = runDash(980, 1.9);                      // 本轮参数
  const old = runDash(760, 1.6);                      // 改动前的参数
  if (!cur || !old) {
    chk('两组突进都跑起来了', false, '没能进入蓄力，场景失效');
  } else {
    chk('冲撞位移比旧参数更远', cur.dist > old.dist + 20,
      `新(980/1.9) ${cur.dist.toFixed(0)} px  vs  旧(760/1.6) ${old.dist.toFixed(0)} px`);
    chk('冲撞峰值速度比旧参数更快', cur.peak > old.peak + 20,
      `新 ${cur.peak.toFixed(0)} px/s  vs  旧 ${old.peak.toFixed(0)} px/s`);
  }
}

/* ============ 9. 锻打成型：撞仆从不算一锤 ============ */
console.log('\n【9】锻打成型：撞【本体】和撞墙才锻打，撞仆从不加伤');
{
  T.resetMatch(byId('beat_into_shape'), byId('charge'));
  W.running = true;
  const pl = W.units[0], ch = W.units[1];
  const p = byId('beat_into_shape').p;
  park(ch); ch.x = 620; ch.y = 620;      // 对手挪远，剑挥不到它
  /* 本体只"停住"、不停机制：park() 会把 mech.update 换成空函数，
     那样锻打成型的计时器就不走了、剑永远铸不出来。 */
  pl.baseSpeed = 0; pl.freeze = 1e9; pl.x = 330; pl.y = 330;
  step(60 * 3);
  chk('君王之剑已铸出', !!pl.mech.sword, pl.mech.sword ? `初始伤害 ${pl.mech.sword.dmg}` : '没铸出来');
  if (!pl.mech.sword) { /* 铸不出来后面没得测，直接跳过 */ }
  else {
    const B = p.bonusPerBounce;

    /* ① 撞仆从（中心距 60 < R+mR = 54+26 = 80 → 走"单位×仆从"那段碰撞） */
    const mn = new T.Minion(ch, pl.x + 60, pl.y, ch.card.p);
    mn.mech.update = () => { }; mn.baseSpeed = 0; mn.boost = 0; mn.freeze = 1e9;
    W.units.push(mn);
    const m0 = pl.mech.sword.dmg;
    step(2);
    const m1 = pl.mech.sword.dmg;
    chk('撞仆从 → 不加伤', m1 === m0, `剑伤 ${m0} → ${m1}（每次反弹本应 +${B}）`);
    W.units = W.units.filter(u => u !== mn);

    /* ② 撞本体（同队不变，中心距 100 < 2R = 108 → 走"本体-本体"那段碰撞） */
    pl.x = ch.x - 100; pl.y = ch.y;
    const u0 = pl.mech.sword.dmg;
    step(2);
    const u1 = pl.mech.sword.dmg;
    chk('撞本体 → 照旧 +' + B, u1 === u0 + B, `剑伤 ${u0} → ${u1}`);

    /* ③ 撞墙（撞墙本来就不限流，也不受这次改动影响） */
    const w0 = pl.mech.sword.dmg;
    pl.mech.onBounce('wall');
    chk('撞墙 → 照旧 +' + B, pl.mech.sword.dmg === w0 + B, `剑伤 ${w0} → ${pl.mech.sword.dmg}`);

    /* ④ 剑还没铸出来时撞谁都不该有反应（防御性，避免空引用） */
    const sv = pl.mech.sword; pl.mech.sword = null;
    let threw = false;
    try { pl.mech.onBounce('unit', ch); pl.mech.onBounce('unit', mn); } catch (e) { threw = true; }
    pl.mech.sword = sv;
    chk('剑不在手上时 onBounce 安全返回', !threw, threw ? '抛异常了' : '没抛异常');
  }
}

/* ============ 10. 仆从回弹：撞击的几何 ============
   两个曾经都写错的点：
   ① 击退方向的符号反了 → 敌人被推向和仆从【同一侧】，两球撞完同向滑行，
      仆从（起步 440）比敌人（240）快，追上去贴脸 —— 那时它是 rest、不结算伤害，
      只能被物理弹开。观感就是"没打到人却被弹回来"，然后弹开、再进逼、再贴脸。
   ② 冲撞中被敌方仆从挡下 → 物理弹开 + 零伤害，同样"还没撞到敌人就被弹回"。
      （仆从之间本来就不互伤，弹开纯属打断冲撞。） */
console.log('\n【10】仆从回弹：击退方向取反 + 冲撞中穿过敌方仆从');
{
  /* ① 撞击几何：仆从朝右冲，本体静置在右边 */
  T.resetMatch(byId('charge'), byId('voltaic'));
  W.running = true;
  const ch = W.units[0], foe = W.units[1];
  park(ch); park(foe);
  ch.x = 100; ch.y = 330; ch.dx = 0; ch.dy = 0;
  foe.x = 500; foe.y = 330; foe.dx = 0; foe.dy = 0;
  const p = byId('charge').p;
  const mn = new T.Minion(ch, 200, 330, p);
  W.units.push(mn);
  mn.state = 'ram'; mn.mech.m.state = 'ram'; mn.mech.m.timer = 2.0;
  mn.mech.m.hitCd = 0; mn.baseSpeed = p.mSpd; mn.dx = 1; mn.dy = 0;

  let hit = -1;
  for (let i = 0; i < 120 && hit < 0; i++) {
    const st0 = mn.state;
    step(1);
    if (st0 === 'ram' && mn.state === 'rest') hit = i;
  }
  chk('仆从撞上了本体', hit >= 0, `第 ${hit} 帧`);
  chk('仆从朝反方向弹开', mn.dx < -0.5, `仆从 dx=${mn.dx.toFixed(2)}`);
  chk('敌人被撞向【远离仆从】的方向', foe.dx > 0.5,
    `敌人 dx=${foe.dx.toFixed(2)}（若与仆从同为负 = 撞成同向滑行 → 仆从追上去贴脸白弹）`);
  const dot = mn.dx * foe.dx + mn.dy * foe.dy;
  chk('两者方向点积 < 0（反向分离）', dot < 0, `dot=${dot.toFixed(2)}`);

  /* ② 冲撞途中撞到敌方仆从 → 穿过去，自己的方向不变 */
  T.resetMatch(byId('charge'), byId('charge'));
  W.running = true;
  const A2 = W.units[0], B2 = W.units[1];
  park(A2); park(B2);
  A2.x = 60; A2.y = 60; B2.x = 60; B2.y = 640;
  const mn2 = new T.Minion(A2, 200, 330, p);
  W.units.push(mn2);
  const blocker = new T.Minion(B2, 280, 330, p);      // 挡在正前方的敌方仆从
  blocker.mech.update = () => { }; blocker.baseSpeed = 0; blocker.boost = 0; blocker.freeze = 1e9;
  blocker.maxHp = 1e9; blocker.hp = 1e9;
  W.units.push(blocker);
  mn2.state = 'ram'; mn2.mech.m.state = 'ram'; mn2.mech.m.timer = 2.0;
  mn2.mech.m.hitCd = 0; mn2.baseSpeed = p.mSpd; mn2.dx = 1; mn2.dy = 0;
  const bh0 = blocker.hp;
  step(20);
  chk('冲撞中撞到敌方仆从 → 方向不变（不被弹回）', mn2.dx > 0.5,
    `dx=${mn2.dx.toFixed(2)}（负号 = 被半路挡下来弹回去了）`);
  chk('仆从之间本来就不互伤', blocker.hp === bh0, `挡路仆从 hp ${bh0} → ${blocker.hp}`);
  chk('确实穿过去了', mn2.x > blocker.x,
    `冲撞者 x=${mn2.x.toFixed(0)} > 挡路者 x=${blocker.x.toFixed(0)}`);
}

console.log('\n=========================');
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
