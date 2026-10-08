/* 对比「改动前(_balance_prev.json)」与「改动后(_balance.json)」的循环赛结果。 */
const fs = require('fs');
const path = require('path');
const prev = JSON.parse(fs.readFileSync(path.join(__dirname, '_balance_prev.json'), 'utf8'));
const now = JSON.parse(fs.readFileSync(path.join(__dirname, '_balance.json'), 'utf8'));

const nameOf = (j, id) => j.names[j.ids.indexOf(id)];
const rate = (j, id) => j.overall[id].winRate;
const rankOf = (j, id) => j.ranking.indexOf(id) + 1;

const rows = now.ids.map(id => ({
  id, name: nameOf(now, id),
  p: rate(prev, id), n: rate(now, id),
  rp: rankOf(prev, id), rn: rankOf(now, id),
}));
rows.sort((a, b) => b.n - a.n);

console.log('轮次：' + prev.totalGames + ' 场 → ' + now.totalGames + ' 场（每对 ' + now.gamesPerPair +
  ' 局，超时 ' + now.capSec + 's）');
console.log('平局：' + prev.drawGames + ' → ' + now.drawGames +
  '   平均时长：' + prev.avgTime.toFixed(1) + 's → ' + now.avgTime.toFixed(1) + 's\n');

console.log('  排名  卡名         改前     改后      Δ      名次');
console.log('  ' + '-'.repeat(58));
rows.forEach((r, i) => {
  const d = (r.n - r.p) * 100;
  const mark = ['expose', 'voltaic'].includes(r.id) ? ' ★' : '';
  console.log('  ' + String(i + 1).padStart(3) + '  ' + r.name.padEnd(10) +
    (r.p * 100).toFixed(1).padStart(6) + '%' + (r.n * 100).toFixed(1).padStart(8) + '%' +
    (d >= 0 ? '+' : '') + d.toFixed(1).padStart(7) + 'pt' +
    ('  ' + r.rp + '→' + r.rn).padStart(10) + mark);
});

const sp = rows.map(r => r.n).slice().sort((a, b) => a - b);
const mean = sp.reduce((a, b) => a + b, 0) / sp.length;
const sd = Math.sqrt(sp.reduce((a, b) => a + (b - mean) ** 2, 0) / sp.length);
const spp = prev.ids.map(id => rate(prev, id)).sort((a, b) => a - b);
const mp = spp.reduce((a, b) => a + b, 0) / spp.length;
const sdp = Math.sqrt(spp.reduce((a, b) => a + (b - mp) ** 2, 0) / spp.length);
console.log('\n全场离散度（标准差）：' + (sdp * 100).toFixed(1) + 'pt → ' + (sd * 100).toFixed(1) + 'pt');
console.log('极差：' + ((spp[spp.length - 1] - spp[0]) * 100).toFixed(1) + 'pt → ' +
  ((sp[sp.length - 1] - sp[0]) * 100).toFixed(1) + 'pt');

/* 改动相关两卡的对位细节 */
for (const id of ['expose', 'voltaic']) {
  const nm = nameOf(now, id);
  console.log('\n=== ' + nm + ' 的对位变化（胜率）===');
  const rc = [];
  for (const foe of now.ids) {
    if (foe === id) continue;
    const a = prev.pairs.find(p => (p.a === id && p.b === foe) || (p.a === foe && p.b === id));
    const b = now.pairs.find(p => (p.a === id && p.b === foe) || (p.a === foe && p.b === id));
    if (!a || !b) continue;
    /* aWin/bWin 是按 pairs 里的 a/b 记的，取哪一边要看谁是本卡 */
    const wr = (x) => (x.a === id ? x.aWin : x.bWin) / x.games;
    rc.push({ foe: nameOf(now, foe), p: wr(a), n: wr(b) });
  }
  rc.sort((x, y) => (y.n - y.p) - (x.n - x.p));
  rc.forEach(r => {
    const d = (r.n - r.p) * 100;
    console.log('   ' + r.foe.padEnd(12) + (r.p * 100).toFixed(0).padStart(5) + '% →' +
      (r.n * 100).toFixed(0).padStart(5) + '%   ' + (d >= 0 ? '+' : '') + d.toFixed(0).padStart(4) + 'pt');
  });
}
