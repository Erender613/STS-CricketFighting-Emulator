/* 受控变体：给"重构后的冲量 AI"加回【进逼】（圈外就朝敌人走），别的都不动。
 *
 * 目的：回答"冲锋掉的那 36pt，是不是全因为少了进逼"。
 *   输入 = 当前构建产物（杀戮尖塔小球对决.html，仆从 AI = 无状态机 + 索敌圈内冲撞）
 *   输出 = tools/_art_ai_seek.html（多一句"圈外朝敌人走"，其余逐字节相同）
 * 断言：那句插入只命中 1 次；其余关键串仍在。跑完记得删掉临时产物。
 *
 * 用法：node tools/_ab_minion_seek.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const OUT = path.join(__dirname, '_art_ai_seek.html');

const ANCHOR = `    if (d > p.senseR) return;                       // 索敌范围内才有反应`;
const REPL = `    if (d > p.senseR) {                             // 圈外：朝敌人走（受控变体加的"进逼"）
      const L = d || 1;
      m.dx = (e.x - m.x) / L; m.dy = (e.y - m.y) / L;
      return;
    }`;

const html = fs.readFileSync(SRC, 'utf8');
const n = html.split(ANCHOR).length - 1;
if (n !== 1) { console.error(`✗ 锚点命中 ${n} 次（应为 1）—— 源码改过了？`); process.exit(1); }
const out = html.replace(ANCHOR, REPL);

/* 自检（注意：注释里提到 orderRam/leashing 的历史说明不算，要查可执行写法） */
if (out.split('圈外：朝敌人走').length - 1 !== 1) { console.error('✗ 变体没插进去'); process.exit(1); }
if (!out.includes('ramCd: 2.4, ramSpd: 210')) { console.error('✗ 变体的冲撞参数不对'); process.exit(1); }
if (out.includes('mech.orderRam') || out.includes('this.leashing')
  || out.includes("m.state = 'ram'")) { console.error('✗ 变体里混进了旧机制的【代码】'); process.exit(1); }

fs.writeFileSync(OUT, out);
console.log(`✓ 生成 ${path.basename(OUT)}（+${out.length - html.length} 字节）：圈外进逼，其余不变`);
console.log(`  跑法：N=50 CAP=240 GAME_HTML=tools/_art_ai_seek.html node tools/balance.js`);
