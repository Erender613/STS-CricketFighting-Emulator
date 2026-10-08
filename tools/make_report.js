/**
 * 把 tools/_balance.json（由 tools/balance.js 跑循环赛产出）渲染成可视化的对战胜率表（单文件 HTML）。
 * 用法:
 *   N=100 CAP=240 node tools/balance.js    # 先跑循环赛，产出 _balance.json
 *   node tools/make_report.js              # 再渲染成 对战胜率表.html（工作区根目录）
 *
 * 配色遵循中国习惯：红 = 胜率高（强）、绿 = 胜率低（弱），以 50% 为中性分界。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/* 默认渲染 tools/balance.js 的产物；换数据集（例如 tools/balance120.js 的 120Hz 口径）时：
   BAL=_balance120.json OUT=对战胜率表_120.html node tools/make_report.js */
const BAL = process.env.BAL || '_balance.json';
const OUT = process.env.OUT || '对战胜率表.html';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, BAL), 'utf8'));

const IDS = data.ids;
const NAMES = data.names;
const nm = id => NAMES[IDS.indexOf(id)];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = x => (x * 100).toFixed(1) + '%';

/* 热力色：t=0 中性灰白，t=1 深红/深绿 */
function heat(wr) {
  const t = Math.pow(Math.min(1, Math.abs(wr - 0.5) * 2), 0.85);
  const c = wr >= 0.5 ? [198, 40, 40] : [46, 125, 50];
  const base = [246, 247, 249];
  const rgb = base.map((b, i) => Math.round(b + (c[i] - b) * t));
  return { bg: `rgb(${rgb.join(',')})`, fg: t > 0.52 ? '#fff' : '#1f2328', t };
}

/* 以 50% 为中心的对称条：>50% 向右红、<50% 向左绿（中线到满格 = 50 个百分点） */
function divergeBar(wr, h) {
  const d = Math.abs(wr - 0.5) * 100;              // 百分点
  const pos = wr >= 0.5;
  const style = pos
    ? `left:50%;width:${d.toFixed(1)}%;background:linear-gradient(90deg,#ef9a9a,#c62828);border-radius:0 20px 20px 0`
    : `right:50%;width:${d.toFixed(1)}%;background:linear-gradient(270deg,#a5d6a7,#2e7d32);border-radius:20px 0 0 20px`;
  void h;
  return `<div class="track" title="${pct(wr)}"><span class="mid"></span><i style="${style}"></i></div>`;
}

/* 取 a vs b 这组里 a 的视角数据（pairs 只存了一份，按需翻转） */
function cell(a, b) {
  const rec = data.pairs.find(p => p.a === a && p.b === b) || data.pairs.find(p => p.a === b && p.b === a);
  const flip = rec.a !== a;
  const aWin = flip ? rec.bWin : rec.aWin;
  const bWin = flip ? rec.aWin : rec.bWin;
  return { wr: (aWin + 0.5 * rec.draw) / rec.games, aWin, bWin, draw: rec.draw, games: rec.games, avgTime: rec.avgTime };
}

/* ---------- 1. 总排名 ---------- */
const rankRows = data.ranking.map((id, i) => {
  const o = data.overall[id];
  const h = heat(o.winRate);
  return `<tr${i < 3 ? ' class="top"' : ''}>
    <td class="rk">${i + 1}</td>
    <td class="nm">${esc(nm(id))}</td>
    <td class="num">${o.win}</td>
    <td class="num">${o.lose}</td>
    <td class="num">${o.draw}</td>
    <td class="num b" style="color:${h.fg === '#fff' ? '#c62828' : (o.winRate >= 0.5 ? '#c62828' : '#2e7d32')}">${pct(o.winRate)}</td>
    <td class="barcell">${divergeBar(o.winRate, h)}</td>
  </tr>`;
}).join('');

/* ---------- 2. 胜率矩阵（行 = 行角色视角） ---------- */
const matrixHead = '<tr><th class="corner">行 ＼ 列</th>'
  + IDS.map(id => `<th class="colh">${esc(nm(id))}</th>`).join('')
  + '<th class="colh avgcol">总胜率</th></tr>';
const matrixRows = IDS.map(a => {
  const cells = IDS.map(b => {
    if (a === b) return '<td class="diag">—</td>';
    const c = cell(a, b);
    const h = heat(c.wr);
    return `<td class="cell" style="background:${h.bg};color:${h.fg}"`
      + ` title="${esc(nm(a))} ${c.aWin}胜 ${c.bWin}负${c.draw ? ' ' + c.draw + '平' : ''}">`
      + `${(c.wr * 100).toFixed(0)}</td>`;
  }).join('');
  const own = data.overall[a].winRate;
  return `<tr><th class="rowh">${esc(nm(a))}</th>${cells}`
    + `<td class="avg" style="color:${own >= 0.5 ? '#c62828' : '#2e7d32'}">${pct(own)}</td></tr>`;
}).join('');

/* ---------- 3. 逐组明细（按矩阵行序） ---------- */
const detailRows = [];
for (let i = 0; i < IDS.length; i++) {
  for (let j = i + 1; j < IDS.length; j++) {
    const A = IDS[i], B = IDS[j];
    const c = cell(A, B);
    const h = heat(c.wr);
    const color = c.wr >= 0.5 ? '#c62828' : '#2e7d32';
    detailRows.push(`<tr>
      <td class="nm">${esc(nm(A))}</td>
      <td class="nv">vs</td>
      <td class="nm">${esc(nm(B))}</td>
      <td class="num">${c.aWin}</td>
      <td class="num">${c.bWin}</td>
      <td class="num">${c.draw || ''}</td>
      <td class="num b" style="color:${color}">${pct(c.wr)}</td>
      <td class="barcell">${divergeBar(c.wr, h)}</td>
      <td class="num t">${c.avgTime.toFixed(0)}s</td>
    </tr>`);
  }
}

/* ---------- 4. 看点 ---------- */
const sorted = data.pairs.map(p => {
  const fav = p.winRate >= 0.5 ? p.a : p.b;
  const wrFav = p.winRate >= 0.5 ? p.winRate : 1 - p.winRate;
  return { ...p, fav, wrFav, dev: Math.abs(p.winRate - 0.5) };
});
const extremes = sorted.slice().sort((x, y) => y.dev - x.dev).slice(0, 8).map(p => {
  const h = heat(p.wrFav);
  const loser = p.fav === p.a ? p.b : p.a;
  return `<li><b>${esc(nm(p.fav))}</b> 对 ${esc(nm(loser))}
    <span class="pill" style="background:${h.bg};color:${h.fg}">${pct(p.wrFav)}</span></li>`;
}).join('');
const closest = sorted.slice().sort((x, y) => x.dev - y.dev).slice(0, 5).map(p =>
  `<li><b>${esc(nm(p.a))}</b> vs <b>${esc(nm(p.b))}</b>　
    <span class="pill gray">${p.aWin} : ${p.bWin}${p.draw ? '（平 ' + p.draw + '）' : ''}　${pct(p.winRate)}</span></li>`
).join('');

const perCard = Math.round(data.totalGames * 2 / data.cardCount);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小球对决 · 对战胜率表</title>
<style>
  :root{ --bg:#f7f8fa; --card:#fff; --line:#e3e6ea; --txt:#1f2328; --dim:#697386;
         --red:#c62828; --green:#2e7d32; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);
    font:14px/1.6 "Microsoft YaHei","PingFang SC",system-ui,-apple-system,"Segoe UI",sans-serif;}
  .wrap{max-width:1240px;margin:0 auto;padding:32px 20px 72px}
  h1{font-size:26px;margin:0 0 6px;letter-spacing:.5px}
  h2{font-size:18px;margin:38px 0 10px;padding-left:10px;border-left:4px solid var(--red)}
  .meta{color:var(--dim);font-size:13px;margin-bottom:10px}
  .meta code{background:#eceff3;padding:1px 6px;border-radius:4px;font-size:12px}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0 4px}
  .kpi{flex:1 1 150px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .kpi b{display:block;font-size:22px;line-height:1.25}
  .kpi span{color:var(--dim);font-size:12px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:2px 0;overflow:auto}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{padding:7px 10px;text-align:left;white-space:nowrap;border-bottom:1px solid var(--line)}
  thead th{position:sticky;top:0;background:#f1f3f6;font-weight:600;z-index:2}
  tbody tr:hover{background:#fafbfc}
  tr.top .nm{font-weight:700}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .b{font-weight:700}
  .rk{color:var(--dim);width:34px}
  .nm{font-weight:600}
  .nv{color:var(--dim);font-size:12px;padding:7px 2px}
  .t{color:var(--dim)}
  .barcell{width:190px;padding:7px 12px}
  .track{position:relative;height:12px;background:#eef1f4;border-radius:20px;overflow:hidden}
  .track .mid{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#c9cfd8;z-index:2}
  .track i{position:absolute;top:0;bottom:0}
  /* 矩阵 */
  table.mx{font-size:12px}
  table.mx th,table.mx td{padding:5px 6px;text-align:center;border:1px solid #fff}
  table.mx .colh{background:#f1f3f6;font-weight:600;max-width:76px;white-space:normal;line-height:1.2}
  table.mx .rowh{background:#f1f3f6;font-weight:600;text-align:left;position:sticky;left:0}
  table.mx .cell{font-weight:700}
  table.mx .diag{background:#e9ecf0;color:#b6bcc6}
  table.mx .avg{background:#f8f9fb;font-weight:700}
  table.mx .avgcol{background:#f8f9fb}
  table.mx .corner{background:#f1f3f6;color:var(--dim);font-weight:400;font-size:11px}
  ul{margin:8px 0 0;padding-left:20px;columns:2;column-gap:30px}
  li{margin:4px 0;break-inside:avoid}
  .pill{display:inline-block;padding:1px 8px;border-radius:20px;font-size:12px;font-weight:700;color:#fff}
  .pill.gray{background:#eceff3;color:#4a5262}
  .legend{display:flex;align-items:center;gap:10px;color:var(--dim);font-size:12px;margin:10px 0 12px}
  .scale{height:12px;width:240px;border-radius:20px;
    background:linear-gradient(90deg,#2e7d32,#a5d6a7,#f6f7f9,#ef9a9a,#c62828)}
  .note{background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:10px 14px;font-size:13px;margin-top:16px}
  footer{color:var(--dim);font-size:12px;margin-top:30px;text-align:center}
  .lg{display:inline-flex;align-items:center;gap:5px}
  .dot{width:10px;height:10px;border-radius:3px;display:inline-block}
</style>
</head>
<body>
<div class="wrap">
  <h1>小球对决 · 角色对战胜率表</h1>
  <div class="meta">
    ${data.cardCount} 个角色两两对战 · 每组 <b>${data.gamesPerPair}</b> 局（左右各半）· 共
    <b>${data.totalGames.toLocaleString()}</b> 场 · 超时 ${data.maxTime}s 判平 ·
    随机种子 <code>${data.seed}</code>
  </div>

  <div class="cards">
    <div class="kpi"><b>${data.pairCount}</b><span>组对局</span></div>
    <div class="kpi"><b>${data.totalGames.toLocaleString()}</b><span>总场次</span></div>
    <div class="kpi"><b>${data.drawGames}</b><span>平局</span></div>
    <div class="kpi"><b>${data.avgTime.toFixed(1)}s</b><span>平均单局时长</span></div>
  </div>

  <h2>一、总胜率排名</h2>
  <div class="meta">每张卡参与 ${perCard.toLocaleString()} 场；胜率 =（胜 + 0.5 × 平）÷ 参赛场次。
    条形以 50% 为中线：<span class="lg"><i class="dot" style="background:#c62828"></i>向右=高于五成</span>
    <span class="lg"><i class="dot" style="background:#2e7d32"></i>向左=低于五成</span></div>
  <div class="panel">
    <table>
      <thead><tr><th class="rk">#</th><th>角色</th><th class="num">胜</th><th class="num">负</th>
        <th class="num">平</th><th class="num">总胜率</th><th class="barcell">相对五成</th></tr></thead>
      <tbody>${rankRows}</tbody>
    </table>
  </div>

  <h2>二、两两对战胜率矩阵</h2>
  <div class="meta">行角色 vs 列角色；格内数字 = <b>行角色</b>的胜率（%）。
    <span class="lg"><i class="dot" style="background:#c62828"></i>红=该行强势</span>
    <span class="lg"><i class="dot" style="background:#2e7d32"></i>绿=该行弱势</span>
    最右一列是行角色的总胜率。</div>
  <div class="legend"><span>0%</span><div class="scale"></div><span>100%</span><span style="margin-left:6px">（中点 50%）</span></div>
  <div class="panel">
    <table class="mx"><thead>${matrixHead}</thead><tbody>${matrixRows}</tbody></table>
  </div>

  <h2>三、逐组明细（${data.pairCount} 组 × ${data.gamesPerPair} 局）</h2>
  <div class="meta">条形 = 角色A 的胜率相对五成的位置（向右红=占优，向左绿=吃亏）；“均时”是这一组的平均单局时长。</div>
  <div class="panel">
    <table>
      <thead><tr><th>角色A</th><th></th><th>角色B</th><th class="num">A胜</th><th class="num">B胜</th>
        <th class="num">平</th><th class="num">A胜率</th><th class="barcell">A 相对五成</th><th class="num">均时</th></tr></thead>
      <tbody>${detailRows.join('')}</tbody>
    </table>
  </div>

  <h2>四、看点</h2>
  <div class="meta">最一边倒的 8 组：</div>
  <ul>${extremes}</ul>
  <div class="meta" style="margin-top:16px">最势均力敌的 5 组：</div>
  <ul>${closest}</ul>

  <div class="note">
    <b>怎么读这张表：</b>每组 ${data.gamesPerPair} 局里，A 打 ${data.gamesPerPair / 2} 局左位、${data.gamesPerPair / 2} 局右位（B 反之），
    这样开局左右站位带来的系统性优势不会被算进角色强度。
    平局来自 ${data.maxTime} 秒超时（双方都没打死对方），按 0.5 胜计入胜率。
  </div>

  <footer>由 tools/balance.js 无头跑真实战斗引擎生成 · 原始数据 tools/_balance.json</footer>
</div>
</body>
</html>
`;

const outPath = path.join(ROOT, OUT);
fs.writeFileSync(outPath, html, 'utf8');
console.log('已生成 ' + outPath);
