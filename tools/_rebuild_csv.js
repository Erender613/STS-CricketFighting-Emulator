/* 从 _balance.json 重建 平衡矩阵.csv（balance.js 写它时经常被编辑器占用而失败）。 */
const fs = require('fs');
const path = require('path');
const j = JSON.parse(fs.readFileSync(path.join(__dirname, '_balance.json'), 'utf8'));
const lines = [['', ...j.names, '平均'].join(',')];
for (const a of j.ids) {
  const row = [j.names[j.ids.indexOf(a)]];
  let sum = 0, n = 0;
  for (const b of j.ids) {
    if (a === b) { row.push(''); continue; }
    const pr = j.pairs.find(p => (p.a === a && p.b === b) || (p.a === b && p.b === a));
    const wr = (pr.a === a ? pr.aWin : pr.bWin) / pr.games * 100;
    row.push(String(Math.round(wr)));
    sum += wr; n++;
  }
  row.push((sum / n).toFixed(1));
  lines.push(row.join(','));
}
const out = path.join(__dirname, '平衡矩阵.csv');
try {
  fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  console.log('已重建 ' + out + '（' + j.totalGames + ' 场的口径）');
} catch (e) {
  console.log('× 写不进去（' + e.code + '）：' + out + ' —— 可能正被编辑器/表格软件打开，关掉后重跑本脚本即可。');
  process.exit(1);
}
