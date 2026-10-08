/**
 * 同构建、同种子、同步数（各 300 局/对）下，1/120s（游戏真实）与 1/60s（旧脚本口径）的差异。
 * 这才是「步长本身」造成的偏差；之前 _balance.json 的差异主要来自卡牌改动（时间戳早于构建）。
 */
const fs = require('fs');
const path = require('path');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, '_balance120.json'), 'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(__dirname, '_balance_60.json'), 'utf8'));
const mapB = Object.fromEntries(B.pairs.map(r => [r.a + '|' + r.b, r]));
const nm = Object.fromEntries(A.ids.map((id, i) => [id, A.names[i]]));
const rows = A.pairs.map(r => {
  const o = mapB[r.a + '|' + r.b];
  return { a: nm[r.a], b: nm[r.b], n: r.winRate * 100, o: o.winRate * 100, d: (r.winRate - o.winRate) * 100 };
});
const abs = rows.map(r => Math.abs(r.d));
console.log(`样本：${rows.length} 组 × ${A.gamesPerPair} 局（两个口径同种子 ${A.seed}）`);
console.log(`平均 |Δ| = ${(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(1)} 个百分点；`
  + `最大 ${Math.max(...abs).toFixed(1)}；中位数 ${abs.slice().sort((a, b) => a - b)[abs.length >> 1].toFixed(1)}`);
console.log(`N=300 时 p=0.5 的理论标准误 ≈ ±${(100 * Math.sqrt(0.25 / 300)).toFixed(1)} 个百分点（两个口径各自都有这个量级的噪声）`);
const flips = rows.filter(r => (r.o - 50) * (r.n - 50) < 0);
console.log(`\n胜负关系跨过 50% 的组：${flips.length}/${rows.length}`);
for (const r of flips.sort((x, y) => Math.abs(y.d) - Math.abs(x.d)))
  console.log(`  ${r.a} vs ${r.b}：60Hz ${r.o.toFixed(0)}% → 120Hz ${r.n.toFixed(0)}%（Δ${r.d >= 0 ? '+' : ''}${r.d.toFixed(0)}）`);
console.log('\n|Δ| 最大的 12 组：');
for (const r of [...rows].sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 12))
  console.log(`  ${r.a.padEnd(6)} vs ${r.b.padEnd(6)} 60Hz ${r.o.toFixed(0).padStart(3)}% → 120Hz ${r.n.toFixed(0).padStart(3)}%  Δ${r.d >= 0 ? '+' : ''}${r.d.toFixed(0)}`);
console.log('\n总胜率对照（120Hz 为正式结论）：');
for (const id of A.ranking)
  console.log(`  ${nm[id].padEnd(6)} 120Hz ${(A.overall[id].winRate * 100).toFixed(1)}%   60Hz ${(B.overall[id].winRate * 100).toFixed(1)}%`
    + `   Δ${((A.overall[id].winRate - B.overall[id].winRate) * 100).toFixed(1)}`);
