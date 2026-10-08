/* ============================================================
   本轮（第 5 轮返工）改动的无头验证
     ① 陨石打击：三颗初始等离子球【战斗开始 1 秒后才浮现】
     ② 陨石打击：速度为 0 的悬停球【不再来回晃动】
     ③ 余像：每次分身把格挡【重置为 20】（不是叠加）—— 且描述文案已改
     ④ 余像：本体受伤与分身被命中【同时发生】时也反伤
     ⑤ 祭品：每秒失去 6 次 × 6 点生命（3 秒合计 108）
     ⑥ 祭品召唤的余像分身【缩小】（冲锋仆从不受影响）
     ⑦ 末日降临：陨石直击伤害 230 → 220
   用法: node tools/_verify_round5.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { loadGame } = require('./verify_dev.js');

let fails = 0, passes = 0;
function ok(cond, label, extra) {
  if (cond) { passes++; console.log('  ✓ ' + label); }
  else { fails++; console.log('  ✗ ' + label + (extra === undefined ? '' : '  → ' + extra)); }
}
const G = loadGame();
const X = G.X;
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.html'), 'utf8');
const DT = 1 / 120;
function stepSeconds(n) { const c = Math.round(n / DT); for (let i = 0; i < c; i++) X.stepPhysics(DT); }

/* ---------- ⑦ 纯参数检查（最快、最直接） ---------- */
console.log('== ⑦ 末日降临：陨石直击 -10 ==');
const EOD = X.CARD_BY_ID['end_of_days'];
ok(EOD.p.dmg === 220, 'end_of_days.p.dmg === 220（原 230）', EOD.p.dmg);
ok(EOD.p.doomRate === 66 && EOD.p.doomR === 125 && EOD.p.zoneR === 106,
  '灾厄圈相关数值未被误伤（66 / 125 / 106）');

console.log('== 卡面参数与文案 ==');
const AI = X.CARD_BY_ID['afterimage'], OF = X.CARD_BY_ID['offering'];
const MT = X.CARD_BY_ID['meteor_strike'];
ok(AI.p.blockGain === 20, 'afterimage.p.blockGain === 20（原 50）', AI.p.blockGain);
ok(AI.p.replicaScale === 0.75, 'afterimage.p.replicaScale === 0.75', AI.p.replicaScale);
ok(AI.desc.length === 1 && AI.desc[0] === '惩罚击中分身的敌人，自身受伤时分身失效',
  '余像描述 = 「惩罚击中分身的敌人，自身受伤时分身失效」', JSON.stringify(AI.desc));
ok(OF.p.tickRate === 6 && OF.p.hpLoss === 6, 'offering 每秒 6 次 × 6 点（原 5 次）',
  OF.p.tickRate + '×' + OF.p.hpLoss);
ok(MT.p.spawnDelay === 1.0, 'meteor_strike.p.spawnDelay === 1.0', MT.p.spawnDelay);

/* ---------- ① 开局 1 秒才浮现 ---------- */
console.log('== ① 等离子球延迟 1 秒 ==');
X.resetMatch(X.CARD_BY_ID['meteor_strike'], X.CARD_BY_ID['expose'], 12345);
const mst = X.world.units[0].mech;
const orbs = () => mst.all.filter(o => !o.dead);
stepSeconds(0.5);
ok(orbs().length === 0 && mst.orbDelay > 0,
  't=0.5s 场上一颗球都没有（倒计时还剩 ' + mst.orbDelay.toFixed(3) + 's）');
stepSeconds(0.45);                                     // t = 0.95s
ok(orbs().length === 0, 't=0.95s 仍然一颗都没有');
stepSeconds(0.10);                                     // t = 1.05s
ok(orbs().length === 3, 't=1.05s 三颗球全部浮现', orbs().length);
ok(orbs().every(o => o.state === 'idle'), '浮现出来的球是 idle（待收集）悬停态');

/* ---------- ② 速度为 0 的悬停球不再晃动 ---------- */
console.log('== ② 悬停球静止 ==');
const before = orbs().map(o => [o.x, o.y]);
stepSeconds(1.6);                                      // 走完 26 个"呼吸"周期
const after = orbs().filter(o => o.state === 'idle').map(o => [o.x, o.y]);
let maxDrift = 0;
for (let i = 0; i < Math.min(before.length, after.length); i++) {
  maxDrift = Math.max(maxDrift, Math.hypot(after[i][0] - before[i][0], after[i][1] - before[i][1]));
}
ok(after.length === 3 && maxDrift < 1e-9,
  '1.6 秒里 idle 球坐标一动不动（最大位移 ' + maxDrift.toExponential(2) + 'px）');
ok(src.indexOf('bobPh') < 0 && src.indexOf('const bob = Math.sin') < 0,
  '源码里的悬停呼吸偏移已删除（bobPh / const bob = Math.sin 都不在了）');

/* ---------- ③ 每次分身把格挡重置为 20 ---------- */
console.log('== ③ 格挡重置为 20（不叠加） ==');
X.resetMatch(X.CARD_BY_ID['afterimage'], X.CARD_BY_ID['expose'], 777);
const ai = X.world.units[0];
const spawns = [];
const proto = Object.getPrototypeOf(ai.mech);
const origSpawn = proto.spawn;
proto.spawn = function () {
  origSpawn.call(this);
  spawns.push({ round: spawns.length + 1, block: ai.block });
};
ai.block = 500;                                        // 先把格挡堆高：验证"重置"能压低
let n = 0;
const CAP = Math.ceil((X.CFG.MAX_TIME + 40) * 120);
while (!X.stepOnce() && n < CAP) n++;
proto.spawn = origSpawn;
ok(spawns.length >= 2, '一局里至少分了 ' + spawns.length + ' 次身');
ok(spawns.every(s => s.block === 20),
  '每一次分身时格挡都恰好是 20（叠加口径会看到 40/60/80…）',
  JSON.stringify(spawns.slice(0, 6).map(s => s.block)));

/* ---------- ④ 本体受伤 + 分身被命中同时发生 → 也反伤 ---------- */
console.log('== ④ 同时发生也反伤 ==');
function freshAfterimage() {
  X.resetMatch(X.CARD_BY_ID['afterimage'], X.CARD_BY_ID['expose'], 4242);
  const a = X.world.units[0], enemy = X.world.units[1];
  for (let i = 0; i < 200; i++) X.stepPhysics(DT);     // 让分身先出来
  return { a, enemy, c: a.mech.clone };
}
{
  const { a, enemy, c } = freshAfterimage();
  ok(!!c && c.replica, '分身已登场');
  const hp0 = enemy.hp, php0 = a.hp;
  c.damage(10, 'hit', enemy);                          // 模拟"同一次陨石"先打到分身
  ok(enemy.hp === hp0 - 150, '分身被命中 → 敌方本体挨 150 反伤', hp0 + ' → ' + enemy.hp);
  ok(c.cDispersed === true, '分身照常碎裂');
  ok(a.hp === php0, '本体没被反伤波及');
}
{
  const { a, enemy, c } = freshAfterimage();
  const hp0 = enemy.hp;
  a.damage(30, 'hit', enemy);                          // 同一次陨石先打到本体
  ok(a.hp < 1000, '本体确实挨了这一下');
  c.disperse(enemy, true);                             // 紧接着分身失效（带来源）
  ok(c.cDispersed === true, '分身失效');
  ok(enemy.hp === hp0 - 150, '本体受伤优先时【照样反伤】150（旧版这里不反伤）',
    hp0 + ' → ' + enemy.hp);
}
{
  const { a, enemy, c } = freshAfterimage();
  const hp0 = enemy.hp;
  a.damage(30, 'hit', enemy);
  c.disperse(enemy, true);                             // 同一轮先砸本体
  c.disperse(enemy, true);                             // 再砸分身
  c.damage(10, 'hit', enemy);
  ok(enemy.hp === hp0 - 150, '同一次攻击只反一次（幂等）', hp0 + ' → ' + enemy.hp);
}
{
  const { a, enemy, c } = freshAfterimage();
  const hp0 = enemy.hp;
  a.hp -= 25;                                          // 本体掉血 → 无来源分支
  X.stepPhysics(DT);
  ok(c.cDispersed === true, '本体掉血 → 分身失效');
  ok(enemy.hp === hp0, '无来源的纯失效不反伤', enemy.hp);
}
{
  const { a, enemy, c } = freshAfterimage();
  const hp0 = enemy.hp;
  a.hp = 1; a.damage(999, 'hit', enemy);                // 本体被一击打死
  X.stepPhysics(DT);
  ok(a.hp === 0 && !!a.dying, '本体阵亡');
  ok(c.cDispersed === true, '本体阵亡 → 分身失效（收尾清理）');
  ok(enemy.hp === hp0, '收尾清理不反伤（敌方本体一点血都没掉）', enemy.hp);
}
ok(src.indexOf('if (vanish && !src)') >= 0 && src.indexOf('if (vanish) {') < 0,
  'disperse() 的判据已是 `vanish && !src`（有来源就反伤）');

/* ---------- ④b 致命伤也要反伤（真实陨石落地，本体与分身同时在落点里） ----------
   回归背景（用户实测）："陨石打击同时命中余像本体和分身时还是不能触发惩罚"。
   根因是【顺序陷阱】：分身被一击打死时，基类 damage() 内部先 kill()，
   而收尾走的是"本体阵亡 → 安静消散"（无来源），分身立刻 cDispersed+dying；
   等回到 ReplicaUnit.damage() 里再想调 disperse(src) 时，dying 闸门已经关上。 */
{
  X.resetMatch(X.CARD_BY_ID['afterimage'], X.CARD_BY_ID['meteor_strike'], 4242);
  const a2 = X.world.units[0], b2 = X.world.units[1];
  for (let i = 0; i < 60; i++) { X.world.t += DT; X.stepPhysics(DT); }
  const r2 = a2.mech.clone;
  a2.x = 330; a2.y = 330;
  r2.x = 300; r2.y = 300; r2.dx = 0; r2.dy = 0;
  const hpB = b2.hp;
  b2.mech.aim.x = 300; b2.mech.aim.y = 300;
  b2.mech.state = 'cast'; b2.mech.timer = 0.01;
  let landed = false;
  for (let f = 0; f < 600 && !landed; f++) {
    X.world.t += DT; X.stepPhysics(DT);
    a2.x = 330; a2.y = 330;                                  // 两球钉在落点里
    if (r2 && !r2.cDispersed && !r2.dying) { r2.x = 300; r2.y = 300; r2.dx = 0; r2.dy = 0; }
    if (b2.mech.state === 'cast') { b2.mech.aim.x = 300; b2.mech.aim.y = 300; }
    if (X.world.effects.some(e => e.constructor.name === 'MeteorSmoke')) landed = true;
  }
  ok(landed, '陨石真的砸下来了');
  ok(r2.cDispersed === true, '分身被这一颗陨石打死 → 仍然碎裂');
  ok(b2.hp <= hpB - 150, '同一颗陨石同时命中本体+分身时【照样反伤】150',
    '陨石打击本体 ' + hpB + ' → ' + b2.hp + '（掉 ' + (hpB - b2.hp) + '）');
  /* 反向验证：反伤只发生一次（不是每颗球/每帧都反） */
  ok(hpB - b2.hp < 300, '反伤没有重复叠加', '掉了 ' + (hpB - b2.hp));
}
ok(src.indexOf('if (!this.dying && src && src.team !== undefined && src.team !== this.team) this.hitSrc = src;') >= 0,
  'ReplicaUnit.damage() 已 latch 真实来源（致命伤也能反伤）');

/* ---------- ⑤ 祭品每秒 6 次 × 6 点 ---------- */
console.log('== ⑤ 祭品献祭速率 ==');
/* 用"无敌靶子"对局：对手是祭品自己不会去打的那种纯弹球（expose 的 cd 很长），
   但为了绝对可控，这里直接把对手冻住、并全程盯住祭品的血量与扣血回调。 */
X.resetMatch(X.CARD_BY_ID['offering'], X.CARD_BY_ID['expose'], 999);
const off = X.world.units[0];
const foe = X.world.units[1];
let ticks = [];
const origLose = off.loseHp.bind(off);
off.loseHp = function (v, s) {
  ticks.push({ t: X.world.t, timer: off.mech.timer, hp: off.hp });
  return origLose(v, s);
};
/* 推进到"法阵刚展开"的那一步为止（不预设帧数，直接看状态） */
let guard = 0;
while (off.mech.state !== 'cast' && !X.stepOnce() && guard++ < 600) { }
ok(off.mech.state === 'cast', '法阵已展开（cast 状态）');
const castStart = X.world.t;
ticks = [];
const hpA = off.hp;
/* 一直推到布阵结束（同样不预设步数） */
guard = 0;
while (off.mech.state === 'cast' && off.alive && !off.dying && guard++ < 1200) {
  foe.freeze = 1;                                    // 冻住对手，保证祭品能完整布完阵
  if (X.stepOnce()) break;                           // stepOnce 才会推进 world.t
}
const castEnd = X.world.t;
ok(off.mech.state === 'idle', '3 秒布阵结束、回到 idle');
ok(ticks.length === 18, '整整 3 秒一共扣了 18 次血（6 次/秒 × 3 秒）', ticks.length);
ok(hpA - off.hp === 108, '合计献祭 108 点生命（18 × 6，旧口径是 90）', hpA - off.hp);
ok(Math.abs((castEnd - castStart) - 3.0) < 0.02, '布阵时长仍是 3.0 秒',
  (castEnd - castStart).toFixed(4));
const perSec = [0, 0, 0];
for (const k of ticks) {
  const i = Math.min(2, Math.floor((k.t - castStart) / 1.0));
  perSec[i]++;
}
ok(perSec[0] === 6 && perSec[1] === 6 && perSec[2] === 6,
  '每一秒都是恰好 6 次（' + perSec.join(' / ') + '）', JSON.stringify(perSec));

/* ---------- ⑤b 祭品不会召唤与对手相同的卡牌 ---------- */
console.log('== ⑤b 召唤池排除「自己 + 对手」 ==');
{
  const OFF = X.CARD_BY_ID['offering'];
  const allIds = Object.keys(X.CARD_BY_ID);
  let bad = [], selfHits = 0, rolls = 0;
  const seenPerOpp = {};
  for (const oppId of allIds) {
    if (oppId === 'offering') continue;                // 对手也是祭品：两边同卡，单独看
    X.resetMatch(OFF, X.CARD_BY_ID[oppId], 4242);
    const u = X.world.units[0], m = u.mech;
    const seen = new Set();
    for (let k = 0; k < 400; k++) {
      m.summon();
      const mons = X.world.units.filter(o => o.summoned && o.o === u);
      for (const mon of mons) {
        rolls++;
        seen.add(mon.realCard.id);
        if (mon.realCard.id === oppId) bad.push(oppId + '→' + mon.realCard.id);
        if (mon.realCard.id === 'offering') selfHits++;
      }
      for (const mon of mons) { mon.dead = true; mon.finished = true; }   // 清场以便下次召唤
      X.world.units = X.world.units.filter(o => !o.finished);
    }
    seenPerOpp[oppId] = seen.size;
  }
  ok(rolls > 3000, '采样量足够（' + rolls + ' 次召唤）');
  ok(bad.length === 0, '任何对局里都没召出过【对手那张卡】',
    bad.length ? bad.slice(0, 5).join(',') : ('覆盖 ' + Object.keys(seenPerOpp).length + ' 个对手'));
  ok(selfHits === 0, '也从没召出过【祭品自己】', selfHits);
  /* 反向验证的关键：池子必须真的被"排掉两张" ——
     CARDS 里全是可选卡（token 衍生卡 minion_dive / soul 根本不进 CARDS），
     所以池子 = 20 - 自己 - 对手 = 18，见到的种类数绝不可能超过 18。 */
  const nonToken = allIds.filter(id => !X.CARD_BY_ID[id].token).length;
  const maxSeen = Math.max(...Object.values(seenPerOpp));
  ok(nonToken === 20, 'CARDS 全是可选卡（20 张，token 不进 CARDS）', nonToken);
  ok(maxSeen <= nonToken - 2, '单个对手最多只可能见到 ' + (nonToken - 2) + ' 种（20 - 自己 - 对手）',
    '实际最多 ' + maxSeen);
  ok(maxSeen >= 12, '池子没有被过度收窄（单对手见到 ' + maxSeen + ' 种）');
  /* 对手 = 祭品自己时：只剩"排除自己"一条，池子 19 张 */
  X.resetMatch(OFF, X.CARD_BY_ID['offering'], 7);
  const u2 = X.world.units[0], m2 = u2.mech;
  const seen2 = new Set();
  for (let k = 0; k < 400; k++) {
    m2.summon();
    const mons = X.world.units.filter(o => o.summoned && o.o === u2);
    for (const mon of mons) seen2.add(mon.realCard.id);
    for (const mon of mons) { mon.dead = true; mon.finished = true; }
    X.world.units = X.world.units.filter(o => !o.finished);
  }
  ok(!seen2.has('offering'), '祭品对祭品时也不会召出祭品', [...seen2].join(','));
  ok(seen2.size > 10, '祭品对祭品时池子仍然很大（见到 ' + seen2.size + ' 种）');
}

/* ---------- ⑥ 祭品召唤的余像分身也缩小 ---------- */
console.log('== ⑥ 祭品召唤的余像分身要缩小 ==');
/* 找一局"祭品随机召到余像"的对局：召唤物（.summoned）会自己分出身来（.replica），
   两条路径都是真实游戏逻辑，没有手工拼对象。
   ⚠ 对手【不能是余像】：新的召唤池排除了"对手那张卡"（⑤b），
     用余像当对手就永远召不出余像了。所以固定用一个无关对手，靠换种子撞出这局。 */
let found = null;
for (const oppId of ['expose', 'defy', 'snakebite', 'voltaic']) {
  for (let s = 1; s <= 20 && !found; s++) {
    X.resetMatch(X.CARD_BY_ID['offering'], X.CARD_BY_ID[oppId], s);
    let i = 0;
    while (!X.stepOnce() && i < CAP) {
      i++;
      const m = X.world.units.find(u => u.summoned && u.realCard &&
        u.realCard.id === 'afterimage' && u.mech && u.mech.clone);
      if (m) { found = { seed: s, opp: oppId, summon: m, clone: m.mech.clone }; break; }
    }
  }
  if (found) break;
}
if (!found) {
  ok(false, '没找到"祭品召出余像"的对局（无法验证缩放）');
} else {
  console.log('    （种子 ' + found.seed + ' / 对手 ' + found.opp + '：祭品召出了余像）');
  ok(found.summon.replicaScale === 0.75, '祭品召唤的余像，replicaScale = 0.75',
    found.summon.replicaScale);
  ok(found.clone.rs === 0.75, '它的分身 rs = 0.75（缩小）', found.clone.rs);
  ok(Math.abs(found.clone.rBody - AI.p.cR * 0.75) < 1e-9, '分身碰撞半径同步缩小', found.clone.rBody);
  ok(found.clone.maxHp === Math.round(AI.p.cHp * 0.75 * 0.75),
    '分身血量按面积缩到 ' + found.clone.maxHp + '（本体自己是 240）', found.clone.maxHp);
  ok(found.summon.rBody === OF.p.mR, '召唤物【自己】仍是仆从体型 26（不缩）', found.summon.rBody);
  ok(src.indexOf('const rs = u.replica ? (u.rs || 1) : 1;') >= 0,
    'drawUnits 已把 rs 乘进卡面宽高');
}
X.resetMatch(X.CARD_BY_ID['afterimage'], X.CARD_BY_ID['expose'], 88);
const self = X.world.units[0];
self.mech.spawn();
ok(self.mech.clone.rs === 1 && self.mech.clone.maxHp === AI.p.cHp,
  '余像本体自己分的身照旧 1.0 倍 / 240 血', self.mech.clone.rs + ' / ' + self.mech.clone.maxHp);
ok(X.CARD_BY_ID['charge'].p.replicaScale === undefined,
  '冲锋！！的 p 里没有 replicaScale（仆从体型不受影响）');

/* ---------- 回归 ---------- */
console.log('== 回归：五张测试版卡各自能跑完整局 ==');
for (const id of ['offering', 'afterimage', 'tracking', 'soul_storm', 'meteor_strike']) {
  let good = true, why = '';
  for (const foe of ['expose', 'beat_into_shape', 'defy']) {
    try {
      X.resetMatch(X.CARD_BY_ID[id], X.CARD_BY_ID[foe], 31337);
      let i = 0;
      while (!X.stepOnce() && i < CAP) i++;
      if (!X.world.over) { good = false; why = id + ' vs ' + foe + ' 没打完'; }
    } catch (e) { good = false; why = id + ' vs ' + foe + ' 抛异常: ' + e.message; }
  }
  ok(good, id + ' 三局都能正常结算', why);
}

console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
