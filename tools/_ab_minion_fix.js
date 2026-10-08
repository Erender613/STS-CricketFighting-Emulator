/* ⚠ 已作废（2026-09-23）：本工具研究的是"冲撞期间不拴绳 / 撞后宽限"这组改动，
 *   而【拴绳机制已被用户要求整条移除】（见 src/game.html「本卡没有拴绳」段）。
 *   下面 REVERSES 里的替换串现在一个都匹配不到，跑起来必然报"命中 0 次"。
 *   保留仅供留档。要做受控对照，直接用改动前的产物即可 ——
 *   本次做法：`git show "HEAD:杀戮尖塔小球对决.html" > tools/_art_control.html`（那次改动是
 *   工作区里唯一未提交的改动，所以 HEAD 的产物就是完美的同源对照组），
 *   再 `N=50 CAP=240 GAME_HTML=tools/_art_control.html node tools/balance.js`。
 *   再更新（2026-09-23 晚）：仆从 AI 已"完全重构"，本文件研究的对象（冲撞/拴绳/宽限）
 *   整体不存在了。新 AI 的验收见 tools/_minion_ai_check.js；受控 A/B 仍照下面这套做法
 *   （抽 HEAD 产物当对照组）跑。
 *
 * 受控 A/B 对照组：把【本次冲锋仆从的两处改动】从当前构建产物里逐条回退，
 * 其余（含上游重构后的随机流）一字不动。
 *
 * 这样对照组和实验组的随机流完全同步，胜率差异才归因于本次改动本身。
 * （直接跟记忆里的旧平衡表比是错的：上游把随机流拆成 sim/vis 两条，整张表都位移了。）
 *
 * 用法见下面 GROUP 的注释。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '杀戮尖塔小球对决.html');

let html = fs.readFileSync(SRC, 'utf8');

/* 每项：[组, 说明, 改后文本, 改前文本] —— 必须各命中恰好 1 次
   组 A = 冲撞期间不拴绳 / 撞后宽限 0.3s；组 B = 友方也能碰撞。
   用法（⚠ 文件名里的 noA/noB 指的是"把这一组【回退】掉"，不是"只留这一组"）：
     node tools/_ab_minion_fix.js            → A、B 都回退 = 原样 → _art_control.html
     node tools/_ab_minion_fix.js A          → 回退 A = 【只有友方碰撞】 → _art_noA.html
     node tools/_ab_minion_fix.js B          → 回退 B = 【只有拴绳修复】 → _art_noB.html
   实测（种子 20260922，N=50）：原样 54.4% / 只有拴绳修复 56.9% / 只有友方碰撞 49.7% / 两个都改 49.7%。
   即拴绳修复 +2.5pt、友方碰撞 -4.7pt。 */
const GROUP = (process.argv[2] || 'AB').toUpperCase();

const REVERSES = [
  ['A', '卡牌参数 leashHold',
    `         leashR: 400, leashBack: 300, leashSpd: 560, leashHold: 0.3,
         bounce: 380, bounceCap: 380 }`,
    `         leashR: 400, leashBack: 300, leashSpd: 560, bounce: 380, bounceCap: 380 }`],

  ['A', '构造器 leashHold 字段',
    `    this.leashHold = 0;
`, ''],

  ['A', '宽限倒计时',
    `    if (this.leashHold > 0) this.leashHold -= dt;   // 撞击后的宽限倒计时
`, ''],

  ['A', '拴绳不再让位于冲撞',
    `    if (m.state !== 'ram' && this.leashHold <= 0) {
      if (!this.leashing && hd > p.leashR) this.leashing = true;
      if (this.leashing && hd < p.leashBack) this.leashing = false;
    }`,
    `    if (!this.leashing && hd > p.leashR) this.leashing = true;
    if (this.leashing && hd < p.leashBack) this.leashing = false;`],

  ['A', '冲撞到点后置宽限',
    `        this.leashHold = p.leashHold;                // 冲撞跑完 → 先留在这儿 0.3s 再谈回家
`, ''],

  ['A', '撞击命中后置宽限',
    `    this.leashHold = p.leashHold;                  // 撞完了 → 先留在原地 0.3s，别急着往回跑
`, ''],

  ['B', '命中回调的友方守卫',
    `    /* 友方（自家本体、同伴仆从）现在也会物理相撞了（见引擎的单位×仆从碰撞段），
       但那只该是"挤开"，绝不能结算撞击伤害 —— 这里按队伍拦掉。 */
    if (e.team === m.team) return;
`, ''],

  ['B', 'ghostOn 只穿敌方仆从',
    `  ghostOn(other) {
    return !!(other && other.minion && other.team !== this.m.team && this.m.state === 'ram');
  }`,
    `  ghostOn(other) { return !!(other && other.minion && this.m.state === 'ram'); }`],

  ['B', '引擎恢复"队友不对撞"',
    `        if (!a.minion && !b.minion) continue;          // 本体-本体已单独结算`,
    `        if (a.team === b.team) continue;
        if (!a.minion && !b.minion) continue;          // 本体-本体已单独结算`],
];

const OUT = path.join(__dirname, GROUP === 'A' ? '_art_noA.html'
  : GROUP === 'B' ? '_art_noB.html' : '_art_control.html');

let bad = 0;
for (const [grp, name, after, before] of REVERSES) {
  if (!GROUP.includes(grp)) continue;
  const n = html.split(after).length - 1;
  if (n !== 1) { console.error(`✗ ${name}：命中 ${n} 次（应为 1 次）`); bad++; continue; }
  html = html.replace(after, before);
  console.log(`✓ [${grp}] ${name}`);
}
if (bad) { console.error(`\n有 ${bad} 处对不上，未写出对照组`); process.exit(1); }

fs.writeFileSync(OUT, html);
console.log(`\n已写出：${OUT}  (${
  (fs.statSync(OUT).size / 1048576).toFixed(2)} MB)`);
console.log(`跑对照：N=50 CAP=240 GAME_HTML=${path.relative(path.join(__dirname, '..'), OUT)} node tools/balance.js`);
