/* 扫参数：跑多组配置，把 tools/_minion_dps.js 的输出汇总成一张表，
   用来定位"修掉连击后输出掉了 3.4 倍"到底丢在哪一项上。 */
const { execFileSync } = require('child_process');
const path = require('path');
const NODE = process.execPath;
const HARNESS = path.join(__dirname, '_minion_dps.js');

const cases = [
  [`旧版（连击 bug 在，无拴绳无反弹）`, { SRC: `old` }],
  [`当前：修复 + 反弹 + 进逼 260`, {}],
  [`把进逼关掉（回到发呆那版，对照）`, { NOSEEK: `1` }],
  [`进逼 150`, { SEEKS: `150` }],
  [`进逼 430（等于冲撞速度）`, { SEEKS: `430` }],
  [`进逼 260 + 冷却压短 0.6`, { MREST: `0.6` }],
  [`进逼 260 + 弹力调大 500`, { BOUNCE: `500` }],
]

console.log('配置'.padEnd(42) + '整卡DPS  单仆从DPS  命中次数');
const rows = [];
for (const [label, env] of cases) {
  let out = '';
  try {
    out = execFileSync(NODE, [HARNESS], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
  } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const dps = (out.match(/整卡 DPS ([\d.]+)/) || [])[1];
  const mdps = (out.match(/单仆从 DPS ([\d.]+)/) || [])[1];
  const hits = (out.match(/命中 (\d+) 次/) || [])[1];
  console.log(label.padEnd(40) + String(dps || '?').padStart(8) + String(mdps || '?').padStart(10) + String(hits || '?').padStart(10));
  rows.push({ label, dps: Number(dps), hits: Number(hits) });
}
const base = rows[0].dps;
console.log('\n相对旧版（' + base + ' DPS）的保留比例：');
rows.forEach(r => console.log('  ' + r.label.padEnd(40) + ((r.dps / base * 100).toFixed(0) + '%').padStart(6)));
