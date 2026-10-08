/* 受控 A/B 汇总：冲锋！！仆从 AI 重构【前 / 后】。
 *
 * 两组数据来自同一份随机流的两个构建（改动前的产物 = `git show "HEAD:杀戮尖塔小球对决.html"`），
 * 除了仆从 AI 之外没有任何差异，所以胜率差可以直接归因到本次重构。
 *   对照组：_balance_oldai.json（N=50 CAP=240 GAME_HTML=tools/_art_oldai.html node tools/balance.js）
 *   新组：  _balance_newai.json（N=50 CAP=240 node tools/balance.js）
 *
 * 用法：node tools/_cmp_minion_ai.js
 */
const fs = require('fs');
const path = require('path');

const GROUPS = [
  ['重构前（状态机 AI）', '_balance_oldai.json'],
  ['重构后（冲量 AI）', '_balance_newai.json'],
];
const data = GROUPS.map(([label, f]) => {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) { console.error(`缺少 ${f}`); process.exit(1); }
  return { label, j: JSON.parse(fs.readFileSync(p, 'utf8')) };
});
const j0 = data[0].j, j1 = data[1].j;
const names = j0.names, ids = j0.ids;
const wr = (j, id) => j.overall[id].winRate * 100;
/* 每卡 700 场（14 个对手 × 50 局），p≈0.5 时的标准误 */
const SE = Math.sqrt(0.25 / (j0.gamesPerPair * (ids.length - 1))) * 100;

console.log(`受控 A/B：种子 ${j0.seed}，每对 ${j0.gamesPerPair} 局，超时 ${j0.capSec}s，` +
  `每卡 ${j0.gamesPerPair * (ids.length - 1)} 场（标准误 ≈ ${SE.toFixed(1)}pt）\n`);

const pad = (s, n) => String(s).padEnd(n, ' ');
const rpad = (s, n) => String(s).padStart(n, ' ');
const rows = ids.map(id => {
  const a = wr(j0, id), b = wr(j1, id);
  return { id, nm: names[ids.indexOf(id)], a, b, d: b - a };
});
/* 只把"位移超过 1 个标准误"的挑出来展示，其余汇总 */
const moved = rows.filter(r => Math.abs(r.d) > SE).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

console.log(pad('卡牌', 12) + rpad('重构前', 9) + rpad('重构后', 9) + '   Δ    显著?');
console.log('-'.repeat(48));
console.log(pad('★ 冲锋！！', 12) + rpad(rows.find(r => r.id === 'charge').a.toFixed(1) + '%', 9) +
  rpad(rows.find(r => r.id === 'charge').b.toFixed(1) + '%', 9) + '  ' +
  rpad(((rows.find(r => r.id === 'charge').d > 0 ? '+' : '') +
    rows.find(r => r.id === 'charge').d.toFixed(1)), 6) +
  (Math.abs(rows.find(r => r.id === 'charge').d) > SE ? '  ←' : ''));
console.log('-'.repeat(48));
for (const r of moved) {
  if (r.id === 'charge') continue;
  console.log(pad(r.nm, 12) + rpad(r.a.toFixed(1) + '%', 9) + rpad(r.b.toFixed(1) + '%', 9) +
    '  ' + rpad((r.d > 0 ? '+' : '') + r.d.toFixed(1), 6) + '  ←');
}
console.log('-'.repeat(48));

const others = rows.filter(r => r.id !== 'charge').map(r => Math.abs(r.d)).sort((a, b) => a - b);
const med = others[Math.floor(others.length / 2)];
const maxo = others[others.length - 1];
console.log(`\n★ 冲锋！！ ${rows.find(r => r.id === 'charge').a.toFixed(1)}% → ` +
  `${rows.find(r => r.id === 'charge').b.toFixed(1)}%   ` +
  `${(rows.find(r => r.id === 'charge').d > 0 ? '+' : '')}${rows.find(r => r.id === 'charge').d.toFixed(1)}pt`);
console.log(`其余 ${others.length} 张卡：|Δ| 中位数 ${med.toFixed(1)}pt、最大 ${maxo.toFixed(1)}pt` +
  `（= 随机流扰动本底，不是因果）`);

/* 排名：只看重构前后的名次变化 */
const rank = j => {
  const s = ids.map(id => ({ id, w: wr(j, id) })).sort((x, y) => y.w - x.w);
  return s.findIndex(x => x.id === 'charge') + 1;
};
console.log(`冲锋！！的排名：第 ${rank(j0)} 名 → 第 ${rank(j1)} 名（共 ${ids.length} 张）`);

/* 对位明细：N=50 时噪声可达 ±45pt，只看方向、不当结论 */
const pairWR = (j, id, opp) => {
  const p = j.pairs.find(x => (x.a === id && x.b === opp) || (x.a === opp && x.b === id));
  if (!p) return NaN;
  return (p.a === id ? p.aWin : p.bWin) / p.games * 100;
};
const det = ids.filter(i => i !== 'charge')
  .map(i => ({ i, d: pairWR(j1, 'charge', i) - pairWR(j0, 'charge', i) }))
  .filter(x => !Number.isNaN(x.d));
if (det.length) {
  const up = det.filter(x => x.d > 0).length, dn = det.filter(x => x.d < 0).length;
  console.log(`\n对位明细（噪声 ±45pt，只看方向）：胜负方向上升 ${up} 个对位 / 下降 ${dn} 个对位`);
}
