/* 汇总四组平衡数据，打印"改动前 / 只移除拴绳 / 只改 mRest / 全量改动"的对照表。
 * 用法：node tools/_cmp_charge_voltaic.js
 */
const fs = require('fs');
const path = require('path');

const GROUPS = [
  ['改动前（拴绳在 / mRest 1.0 / 环烧 10×1）', '_balance_control.json'],
  ['只移除拴绳（mRest 仍 1.0）', '_balance_noleash.json'],
  ['只改 mRest 1.2（拴绳仍在）', '_balance_mr12.json'],
  ['全量本次改动（拴绳移除 + mRest 1.2 + 环烧 10×3）', '_balance_new.json'],
];

const data = GROUPS.map(([label, f]) => {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) { console.error(`缺少 ${f}`); process.exit(1); }
  return { label, j: JSON.parse(fs.readFileSync(p, 'utf8')) };
});
const names = data[0].j.names, ids = data[0].j.ids;

/* 只关注有改动 / 明显位移的卡；其余放在"其他"里给个总览 */
const FOCUS = ['charge', 'voltaic', 'darkness', 'guiding_star', 'dark_embrace'];
const wr = (j, id) => j.overall[id].winRate * 100;
const SE = Math.sqrt(0.25 / 700) * 100;      // 每卡 700 场、p≈0.5 时的标准误

console.log(`种子 ${data[0].j.seed}，每对 ${data[0].j.gamesPerPair} 局，超时 ${data[0].j.capSec}s，` +
  `共 ${data[0].j.totalGames} 场，每卡 700 场（标准误 ≈ ${SE.toFixed(1)}pt）\n`);

const pad = (s, n) => String(s).padEnd(n, ' ');
const rpad = (s, n) => String(s).padStart(n, ' ');

console.log(pad('卡牌', 10) + GROUPS.map((_, i) => rpad('组' + (i + 1), 9)).join('') + '   Δ(4-1)');
console.log('-'.repeat(10 + 9 * GROUPS.length + 9));
for (const id of FOCUS) {
  const nm = names[ids.indexOf(id)];
  const row = data.map(d => rpad(wr(d.j, id).toFixed(1) + '%', 9)).join('');
  const d = wr(data[3].j, id) - wr(data[0].j, id);
  const mark = Math.abs(d) > 2 * SE ? '  ←' : '';
  console.log(pad(nm, 10) + row + '  ' + rpad((d > 0 ? '+' : '') + d.toFixed(1), 6) + mark);
}
console.log('-'.repeat(10 + 9 * GROUPS.length + 9));

/* 全体位移幅度：看"没改的卡"漂了多少 = 本次随机流扰动带来的本底噪声 */
const changed = new Set(FOCUS);
const others = ids.filter(i => !changed.has(i));
const drift = others.map(id => Math.abs(wr(data[3].j, id) - wr(data[0].j, id)));
drift.sort((a, b) => a - b);
console.log(`未被本次改动直接触及的 ${others.length} 张卡：|Δ| 中位数 ${drift[Math.floor(drift.length / 2)].toFixed(1)}pt、` +
  `最大 ${drift[drift.length - 1].toFixed(1)}pt（= 随机流扰动本底，别把 ±1~2pt 当因果）\n`);

console.log('=== 拆解（冲锋！！）===');
const G = i => (id) => wr(data[i].j, id);       // G(组号)(卡id) → 胜率%
const [g1, g2, g3, g4] = [G(0), G(1), G(2), G(3)];
const dd = (a, b, id) => a(id) - b(id);
const fmt = v => (v > 0 ? '+' : '') + v.toFixed(1);
console.log(`  只移除拴绳        ${g1('charge').toFixed(1)}% → ${g2('charge').toFixed(1)}%   ${fmt(dd(g2, g1, 'charge'))}pt`);
console.log(`  只改 mRest 1.2    ${g1('charge').toFixed(1)}% → ${g3('charge').toFixed(1)}%   ${fmt(dd(g3, g1, 'charge'))}pt`);
console.log(`  两处一起（本次）  ${g1('charge').toFixed(1)}% → ${g4('charge').toFixed(1)}%   ${fmt(dd(g4, g1, 'charge'))}pt`);
console.log(`  （全量组还叠加了"电流相生变强"，会再压所有对手约 1pt/张，故不能直接相加）`);
console.log('\n=== 电流相生 ===');
console.log(`  环烧 10×1 → 10×3  ${g1('voltaic').toFixed(1)}% → ${g4('voltaic').toFixed(1)}%   ${fmt(dd(g4, g1, 'voltaic'))}pt`);
console.log(`  对照：只移除拴绳时它没动 ${g1('voltaic').toFixed(1)}% → ${g2('voltaic').toFixed(1)}%（证明位移来自环烧而非随机扰动）`);
