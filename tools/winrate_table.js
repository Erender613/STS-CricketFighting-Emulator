/**
 * 从 tools/_balance120.json 生成「两两对战胜率」彩色表格（Markdown + 控制台等宽版），方便直接贴进聊天/文档。
 * 🟩 ≥70% 碾压 / 🟨 55~69% 占优 / ⬜ 45~54% 均势 / 🟧 25~44% 吃亏 / 🟥 <25% 被碾压
 * 用法: node tools\winrate_table.js
 */
const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_balance120.json'), 'utf8'));
const IDS = data.ids, NAMES = data.names, N = data.gamesPerPair;
const nm = id => NAMES[IDS.indexOf(id)];

const cell = {};      // cell[a][b] = { p, w, l, d }
for (const id of IDS) cell[id] = {};
for (const p of data.pairs) {
  cell[p.a][p.b] = { p: p.winRate * 100, w: p.aWin, l: p.bWin, d: p.draw };
  cell[p.b][p.a] = { p: 100 - p.winRate * 100, w: p.bWin, l: p.aWin, d: p.draw };
}
const mark = v => v >= 70 ? '🟩' : v >= 55 ? '🟨' : v >= 45 ? '⬜' : v >= 25 ? '🟧' : '🟥';

/* 平均胜率用「行内 14 组对手胜率的算术平均」，与 平衡矩阵_120.md 一致 */
const avg = {};
for (const r of IDS) {
  let s = 0, c = 0;
  for (const o of IDS) if (o !== r) { s += cell[r][o].p; c++; }
  avg[r] = s / c;
}
const order = [...IDS].sort((a, b) => avg[b] - avg[a]);

/* ---------- 1) 彩色 Markdown 矩阵（行 = 行角色视角胜率） ---------- */
let md = `## 两两对战胜率（每对 ${N} 场，左右站位各半，合计 ${data.totalGames.toLocaleString()} 场）\n\n`;
md += `行角色 vs 列角色，格内 = **行角色胜率%**（含 0.5×平局）`;
md += `🟩≥70 🟨55-69 ⬜45-54 🟧25-44 🟥<25\n\n`;
md += `| 角色 \\ 对手 | ${order.map(nm).join(' | ')} | 平均 |\n`;
md += `|---|${order.map(() => '---:').join('|')}|---:|\n`;
for (const r of order) {
  const cs = order.map(c => c === r ? '·' : `${mark(cell[r][c].p)}${Math.round(cell[r][c].p)}`);
  md += `| **${nm(r)}** | ${cs.join(' | ')} | **${avg[r].toFixed(1)}** |\n`;
}

/* ---------- 2) 控制台等宽版 ---------- */
const W = 6;
function pad(s, w) {
  let len = 0;
  for (const ch of s) len += /[\u4e00-\u9fff\uff01]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, w - len));
}
let txt = `两两对战胜率（每对 ${N} 场，行=行角色胜率%）\n`;
txt += pad('角色', 12) + order.map(c => pad(nm(c), W)).join('') + '  平均\n';
txt += '-'.repeat(12 + W * order.length + 6) + '\n';
for (const r of order) {
  txt += pad(nm(r), 12) + order.map(c => pad(c === r ? '·' : String(Math.round(cell[r][c].p)), W)).join('')
    + '  ' + avg[r].toFixed(1) + '\n';
}

/* ---------- 3) 看点 ---------- */
const flat = data.pairs.map(p => ({ a: nm(p.a), b: nm(p.b), p: p.winRate * 100, w: p.aWin, l: p.bWin, d: p.draw }));
flat.sort((x, y) => y.p - x.p);
md += `\n### 最一边倒（前 8 组）\n\n`;
for (const r of flat.slice(0, 8)) md += `- **${r.a} ${Math.round(r.p)}%** vs ${r.b}（${r.w}-${r.l}${r.d ? ' 平' + r.d : ''}）\n`;
md += `\n### 最势均力敌（最接近 50% 的 8 组）\n\n`;
for (const r of [...flat].sort((x, y) => Math.abs(x.p - 50) - Math.abs(y.p - 50)).slice(0, 8))
  md += `- ${r.a} ${Math.round(r.p)}% vs ${r.b}（${r.w}-${r.l}${r.d ? ' 平' + r.d : ''}）\n`;

fs.writeFileSync(path.join(__dirname, '胜率表_120.md'), md, 'utf8');
console.log(txt);
console.log(md);
console.log('已写出 tools/胜率表_120.md');
