/* ⚠ 已作废（2026-09-23 晚）：本工具拆的是"拴绳 / mRest"这两处改动，而仆从 AI 已经
 *   被"完全重构"（状态机、mRest、拴绳全部删除），下面所有替换串都匹配不到了。
 *   保留仅供留档。新 AI 的验收见 tools/_minion_ai_check.js。
 *
 * 受控拆解：把【冲锋！！】这次的两处改动分别单独施加到"改动前"的产物上，
 * 用来回答"到底哪一条把冲锋的胜率拉下来了"。
 *
 * 输入 = tools/_art_control.html（= `git show "HEAD:杀戮尖塔小球对决.html"`，改动前的同源产物）
 * 输出：
 *   tools/_art_noleash.html  只移除拴绳（mRest 保持 1.0、电流相生保持 10×1）
 *   tools/_art_mr12.html     只把 mRest 改成 1.2（拴绳保持原样、电流相生保持 10×1）
 *
 * 为什么要拆：整包改动跑出 冲锋 50.3% → 46.9%（-3.4pt）。两处改动方向相反的可能性是存在的
 * （拴绳在部分对位里其实在帮忙"回防"），不拆开就不知道是哪个在扣分。
 *
 * 用法：node tools/_ab_charge_split.js
 */
const fs = require('fs');
const path = require('path');

const IN = path.join(__dirname, '_art_control.html');
if (!fs.existsSync(IN)) {
  console.error(`找不到 ${IN}\n先执行： git show "HEAD:杀戮尖塔小球对决.html" > tools/_art_control.html`);
  process.exit(1);
}
const base = fs.readFileSync(IN, 'utf8');

/* 锚点：拴绳逻辑在 MinionBrain.update 里，从"宽限倒计时"那行开始，
   到"取敌人"那行为止（含中间的锁存判断与回家分支），一次切干净。 */
const START = `    if (this.leashHold > 0) this.leashHold -= dt;   // 撞击后的宽限倒计时`;
const END = `    const e = world.enemyOf(m);`;

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

/* 拴绳一共落在 5 处（这也是"移除得干净不干净"的完整清单）：
 *   ① 构造器：this.leashHold / this.leashing 两个字段
 *   ② MinionBrain.update 开头：宽限倒计时 + 锁存判断 + 回家分支（整块，见下面 START/END）
 *   ③ update 里 ram 跑完那一支：this.leashHold = p.leashHold
 *   ④ orderRam：正在回防就不接新指令
 *   ⑤ onUnitHit 撞完那一支：this.leashHold = p.leashHold
 * 变体 1 必须把这 5 处全切掉，任何一处漏掉都不算"只移除拴绳"。 */
const CUTS = [
  ['构造器字段',
    `    /* leashHold：冲撞结束后的"先留在原地"宽限（秒）。见 update 里的说明。 */
    this.leashHold = 0;
    /* leashing：拴绳锁存。越过 leashR 就锁定"回家"，直到进到 leashBack 以内才解除，
       避免在 leashR 这条线上反复横跳（一帧回家、一帧冲出去）。 */
    this.leashing = false;
`, ''],
  ['ram 到点后置宽限',
    `        this.leashHold = p.leashHold;                // 冲撞跑完 → 先留在这儿 0.3s 再谈回家
`, ''],
  ['orderRam 的回防守卫',
    `    if (this.leashing) return;                 // 正在回防：不接新指令，免得打断回家
`, ''],
  ['撞击命中后置宽限',
    `    this.leashHold = p.leashHold;                  // 撞完了 → 先留在原地 0.3s，别急着往回跑
`, ''],
];

/* ---------- 变体 1：只移除拴绳 ---------- */
{
  let v = base;

  /* ② 整块：从"宽限倒计时"那行到"取敌人"那行为止 */
  const i = v.indexOf(START), j = v.indexOf(END);
  if (i < 0 || j < 0 || j <= i) fail('拴绳块锚点定位失败（对照产物是不是改动前的那份？）');
  if (v.indexOf(START, i + 1) >= 0) fail('START 锚点不唯一');
  if (v.indexOf(END, j + 1) >= 0) fail('END 锚点不唯一');
  v = v.slice(0, i)
    + `    /* 拴绳已移除（受控拆解变体：只动这一处，mRest 保持 1.0） */\n`
    + v.slice(j);

  /* ① ③ ④ ⑤ */
  for (const [name, after, before] of CUTS) {
    const n = v.split(after).length - 1;
    if (n !== 1) fail(`变体 1「${name}」命中 ${n} 次（应为 1 次）`);
    v = v.replace(after, before);
  }

  /* 自检：拴绳代码、字段、参数引用都必须清零 */
  for (const pat of ['this.leashing', 'this.leashHold', 'p.leashR', 'p.leashBack', 'p.leashSpd', 'p.leashHold']) {
    const n = v.split(pat).length - 1;
    if (n !== 0) fail(`变体 1 里还剩 ${n} 处 \`${pat}\``);
  }
  const mr = /mRest: ([0-9.]+), restSpd/.exec(v);
  if (!mr) fail('变体 1 找不到 mRest');
  if (mr[1] !== '1.0') fail(`变体 1 的 mRest 应为 1.0，实际 ${mr[1]}`);
  if (!v.includes('dpsTick: 10, orbitDmg: 1')) fail('变体 1 的电流相生应保持 10×1');

  const out = path.join(__dirname, '_art_noleash.html');
  fs.writeFileSync(out, v);
  console.log(`✓ 只移除拴绳 → ${path.basename(out)}（5 处全切）`);
  console.log(`  ↳ 自检：leash 系代码/字段 0 处 / mRest=${mr[1]} / 电流相生 10×1 / ${(v.length / 1048576).toFixed(2)} MB`);
}

/* ---------- 变体 2：只把 mRest 改成 1.2 ---------- */
{
  const A = `mSpd: 360, mDmg: 50, mRest: 1.0, restSpd: 60`;
  const B = `mSpd: 360, mDmg: 50, mRest: 1.2, restSpd: 60`;
  const n = base.split(A).length - 1;
  if (n !== 1) fail(`mRest 锚点命中 ${n} 次（应为 1 次）`);
  const v = base.replace(A, B);

  /* 自检：拴绳代码必须完好。
     对照口径：改动前的产物里 `this.leashing` 共 7 处 —— 构造器 1、
     update 的锁存判断 4（两行里各出现两次）+ 回家分支 1、orderRam 1。 */
  const leash = v.split('this.leashing').length - 1;
  if (leash !== 7) fail(`变体 2 的拴绳代码应保留 7 处 this.leashing，实际 ${leash}`);
  if (!v.includes('dpsTick: 10, orbitDmg: 1')) fail('变体 2 的电流相生应保持 10×1');

  const out = path.join(__dirname, '_art_mr12.html');
  fs.writeFileSync(out, v);
  console.log(`✓ 只改 mRest → ${path.basename(out)}（1.0 → 1.2）`);
  console.log(`  ↳ 自检：拴绳代码完好（this.leashing 7 处）/ 电流相生 10×1 / ${(v.length / 1048576).toFixed(2)} MB`);
}

console.log('\n跑法：');
console.log('  N=50 CAP=240 GAME_HTML=tools/_art_noleash.html node tools/balance.js');
console.log('  N=50 CAP=240 GAME_HTML=tools/_art_mr12.html  node tools/balance.js');
