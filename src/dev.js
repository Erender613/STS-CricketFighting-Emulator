/* ============================================================
   开发者模式（只在「开发者版」里注入；正式版不含本文件）
   ------------------------------------------------------------
   注入位置：src/game.html 结尾。此时游戏本体已经跑完 boot()，
   CARD_BY_ID / SEL / makePanel / resetMatch / runFullMatch / world 等可直接调用。

   功能：
     1) 指定种子 —— 输入任意数字/文本，下一局就用它（同种子必定同一结局）
     2) 批量预演 —— 跑 N 局，记录每局的种子与关键数据（不渲染，切片推进，不卡界面，
        切到别的标签/窗口也照跑 —— rAF 会被浏览器后台节流，兜底泵见下方"推进泵"）
     3) 标签筛选 —— 胜者 / 高爆发 / 逆境反杀 / 残血获胜 …（多选 = 同时满足）
     4) 单指标排序 —— 获胜时血量 / 棋差一招续命秒数 / 逆转血量差 / 对决时间 …（可升降序）
     5) 点任意一行 → 用那局的种子 + 双方卡牌真的打一遍（观战重现，打完自动停）
     6) 空悲切 —— 按记录重放每一局：败者临死续命 1 秒，能反杀就标「棋差一招」
   统计口径见 game.html 第 8.1 / 8.2 节与 tools/README_开发者版.md。
   ============================================================ */
(function () {
  'use strict';
  if (window.__BUILD__ !== 'dev') return;          // 双保险：正式版即使误注入也自禁用
  var SLOT = document.getElementById('devSlot');
  if (!SLOT) return;

  /* ---------- 状态 ---------- */
  var DEV = {
    on: false,
    seedText: '',        // 输入框内容（空 = 每局现掷）
    pendingSeed: null,   // 只对"下一局"生效的种子（保留给外部调用）
    autoStop: true,      // 重现时打完自动停
    replaying: false,    // 正在观战复现某一场（按钮文案用）
    speed: 4,            // 重现倍速：默认 4×，否则一局要等 30~120 秒，看着像"卡住"
    count: 50,           // 批量局数
    results: [],
    running: false,
    done: 0,
    /* 空悲切：开关打开才做"败者续命 1 秒能不能反杀"的重放分析。
       算过的局在记录上留 r.chess = true/false（undefined = 还没算）。 */
    chessOn: false,
    chessDirty: false,
    sortKey: '',         // 当前排序指标（见 SORTS；'' = 记录顺序）
    sortDir: -1,         // +1 升序 / -1 降序
    wmText: '',          // 水印文字（可含 \n = 多行）
    wmOn: false          // 水印开关（没文字时强制关，见 syncWm）
  };
  /* 爆发分两种口径，筛选里也分开：单次（一下多疼）与短时间（一小段里打多密） */
  var FILTER_KEYS = ['burst1', 'burst', 'comeback', 'lowhp', 'clutch', 'short', 'long',
                     'dominate', 'heavy', 'burst1L', 'burstL', 'timeout', 'chess'];
  var active = {};

  /* ---------- 排序指标 ----------
     每个指标给 val(r) → 一个可比较的数字；返回 null = 这一局不适用该指标
     （平局没有"获胜血量"、非棋差一招没有"续命秒数"），排序时一律沉底，
     与升/降序无关。dir 是选中它时的默认方向。
     数值口径与 game.html 的 matchRecord 对齐：
       · winHp     = 分出胜负那一刻胜者的血量比例（hp/maxHp）
       · chessNeed = 棋差一招时"续命多少秒就够反杀" = 反杀时刻 − 致命一击时刻
       · comeback  = 胜者本局被拉开过的最大血量差（比例）→ 逆转幅度
       · t         = 整局时长；hit/burst = 双方各自的最大爆发；minHp = 胜者全程最低血量 */
  var SORTS = {
    '':        { name: '默认（记录顺序）', dir: 0 },
    winHp:     { name: '获胜时血量', dir: -1, val: function (r) {
                   return r.win < 0 ? null : r.hp[r.win] / r.maxHp[r.win]; } },
    chessNeed: { name: '棋差一招·续命秒数', dir: 1, val: function (r) {
                   return r.chess && r.chessNeed !== null && r.chessNeed !== undefined ? r.chessNeed : null; } },
    comeback:  { name: '逆转血量差', dir: -1, val: function (r) {
                   return r.win < 0 ? null : (r.behind ? r.behind[r.win] : 0); } },
    t:         { name: '对决时间', dir: -1, val: function (r) { return r.t; } },
    hit:       { name: '单次爆发', dir: -1, val: function (r) { return Math.max(r.hit[0], r.hit[1]); } },
    burst:     { name: '短时爆发', dir: -1, val: function (r) { return Math.max(r.burst[0], r.burst[1]); } },
    minHp:     { name: '获胜方最低血量', dir: 1, val: function (r) {
                   return r.win < 0 ? null : r.minHp[r.win]; } }
  };
  function sortList(list) {
    var S = SORTS[DEV.sortKey];
    if (!S || !S.val) return list;
    var dir = DEV.sortDir;
    return list.slice().sort(function (x, y) {
      var vx = S.val(x), vy = S.val(y);
      var nx = (vx === null || vx === undefined || isNaN(vx));
      var ny = (vy === null || vy === undefined || isNaN(vy));
      if (nx && ny) return 0;
      if (nx) return 1;                       // 不适用的沉底（与方向无关）
      if (ny) return -1;
      return (vx - vy) * dir;
    });
  }

  /* ---------- 样式 ---------- */
  var CSS = '' +
    '#devSlot{position:relative;margin-left:auto;align-self:center}' +
    '.devbtn{cursor:pointer;border:1px solid #6b5f96;background:#241f33;color:#d8ccff;' +
      'font:600 12px/1 inherit;padding:6px 11px;border-radius:7px;font-family:inherit}' +
    '.devbtn:hover{background:#332c4a}' +
    '.devbtn.on{background:#4a3f6b;color:#fff;border-color:#a893ff}' +
    '.devwrap{position:absolute;right:0;top:34px;z-index:50;width:min(640px,92vw);' +
      'background:#14111d;border:1px solid #5b5080;border-radius:10px;' +
      'box-shadow:0 18px 50px rgba(0,0,0,.65);padding:11px;display:none;' +
      'text-align:left;color:#e6e1f2}' +
    '.devwrap.on{display:block}' +
    '.devwrap h3{margin:0 0 8px;font-size:13px;color:#c9b6ff}' +
    '.devwrap h3 span{font-weight:400;font-size:11px;color:#9a92b4}' +
    '.devrow{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:7px 0}' +
    '.devrow>label{font-size:11px;color:#9a92b4;min-width:52px}' +
    '.devwrap input[type=text],.devwrap input[type=number]{background:#0e0c14;color:#e6e1f2;' +
      'border:1px solid #3a3350;border-radius:6px;padding:6px 8px;font:12px/1.2 inherit;font-family:inherit}' +
    '.devwrap input[type=text]{width:170px}.devwrap input[type=number]{width:74px}' +
    '.devwrap button{cursor:pointer;border:1px solid #544a75;background:#241f33;color:#e6e1f2;' +
      'font:12px/1 inherit;padding:6px 11px;border-radius:6px;font-family:inherit}' +
    '.devwrap button:hover:not(:disabled){background:#332c4a}' +
    '.devwrap button:disabled{opacity:.45;cursor:default}' +
    '.devwrap button.pri{background:#3d2f18;border-color:#e8b25a;color:#ffdfa8}' +
    '.devwrap button.mini{padding:3px 8px;font-size:11px}' +
    '.devwrap select{background:#0e0c14;color:#e6e1f2;border:1px solid #3a3350;border-radius:6px;' +
      'padding:5px 7px;font:12px/1.2 inherit;font-family:inherit}' +
    '.devchk{display:inline-flex;align-items:center;gap:4px;font-size:11px;background:#1b1726;' +
      'border:1px solid #3a3350;border-radius:20px;padding:3px 9px 3px 6px;cursor:pointer;user-select:none}' +
    '.devchk input{margin:0}' +
    '.devchk.on{border-color:#a893ff;background:#2b2440;color:#fff}' +
    '.devchk.grace{border-color:#7d6a3a;background:#241f16;color:#e8d6a8}' +
    '.devchk.grace.on{border-color:#e8b25a;background:#3d2f18;color:#ffe6b8}' +
    '.devbar{height:5px;background:#241f33;border-radius:3px;overflow:hidden;flex:1;min-width:80px}' +
    '.devbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#6b5f96,#c9b6ff)}' +
    '.devtbl{max-height:300px;overflow:auto;border:1px solid #3a3350;border-radius:8px;margin-top:8px}' +
    '.devtbl table{border-collapse:collapse;width:100%;font-size:11px;white-space:nowrap}' +
    '.devtbl th{position:sticky;top:0;background:#241f33;color:#c9b6ff;text-align:left;' +
      'padding:5px 7px;font-weight:600}' +
    '.devtbl td{padding:4px 7px;border-top:1px solid #241f33}' +
    '.devtbl tr.r{cursor:pointer}.devtbl tr.r:hover td{background:#221d33}' +
    '.devtbl .tg{color:#9a92b4}' +
    '.devtbl .tg b{color:#ffd08a;font-weight:600}' +
    '.devfoot{font-size:11px;color:#9a92b4;margin-top:8px;display:flex;gap:10px;flex-wrap:wrap}' +
    '.devseed{font-family:Consolas,monospace;color:#9fe8b0}' +
    '.devnone{font-size:11px;color:#9a92b4;padding:12px;text-align:center}' +
    '.devwrap textarea{flex:1;min-width:0;min-height:44px;resize:vertical;background:#0e0c14;' +
      'color:#e6e1f2;border:1px solid #3a3350;border-radius:6px;padding:6px 8px;' +
      'font:12px/1.35 inherit;font-family:inherit}';

  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  var btn = document.createElement('button');
  btn.className = 'devbtn';
  btn.type = 'button';
  btn.textContent = '开发者模式';
  SLOT.appendChild(btn);

  var panel = document.createElement('div');
  panel.className = 'devwrap';
  panel.innerHTML = '' +
    '<h3>开发者模式 <span>（本面板只存在于开发者版）</span></h3>' +
    '<div class="devrow">' +
      '<label>随机种子</label>' +
      '<input type="text" id="dSeed" placeholder="留空 = 每局随机">' +
      '<button class="mini" id="dSeedRnd" type="button">随机一个</button>' +
      '<button class="mini pri" id="dSeedPlay" type="button">用该种子开战</button>' +
    '</div>' +
    '<div class="devrow">' +
      '<label>水印</label>' +
      '<textarea id="dWm" rows="2" placeholder="竞技场中间的水印文字（回车换行 = 多行）"></textarea>' +
    '</div>' +
    '<div class="devrow" style="margin-top:-2px">' +
      '<button class="mini pri" id="dWmOn" type="button" disabled>水印: 关</button>' +
      '<span style="font-size:11px;color:#9a92b4">' +
        '打开后以很淡的颜色印在竞技场正中（录屏打标用）；画在卡牌/血条之下，不会遮挡对战；' +
        '长文本会自动缩小。' +
      '</span>' +
    '</div>' +
    '<div class="devrow" style="font-size:11px;color:#9a92b4">' +
      '同一对卡牌 + 同一个种子 → 逐帧完全相同的对局；留空则每局现掷。' +
    '</div>' +
    '<div class="devrow">' +
      '<label>批量预演</label>' +
      '<input type="number" id="dCount" min="1" max="2000" step="10" value="50">' +
      '<span style="font-size:11px;color:#9a92b4">局</span>' +
      '<button class="pri" id="dRun" type="button">开始预演</button>' +
      '<button class="mini" id="dStop" type="button" disabled>停止</button>' +
      '<span class="devbar"><i id="dBar"></i></span>' +
      '<span id="dProg" style="font-size:11px;color:#9a92b4">待机</span>' +
    '</div>' +
    '<div class="devrow">' +
      '<label>重现倍速</label>' +
      '<select id="dSpeed">' +
        '<option value="1">1×</option><option value="2">2×</option>' +
        '<option value="4" selected>4×</option><option value="8">8×</option>' +
      '</select>' +
      '<span style="font-size:11px;color:#9a92b4">' +
        '点结果表任意一行 = 用那局的种子＋双方卡牌在这里重打一遍；一局 30~120 秒，' +
        '所以默认 4× 快进（只影响重现，不动工具栏的倍速）。' +
      '</span>' +
    '</div>' +
    '<div class="devrow" style="gap:6px">' +
      '<label>筛选</label>' +
      '<span id="dTags" style="display:flex;gap:5px;flex-wrap:wrap"></span>' +
      '<button class="mini" id="dClear" type="button">清空</button>' +
      '<button class="mini" id="dExport" type="button">导出 JSON</button>' +
    '</div>' +
    '<div class="devrow" style="gap:6px">' +
      '<label>排序</label>' +
      '<select id="dSort"></select>' +
      '<button class="mini" id="dSortDir" type="button">↓ 降序</button>' +
      '<span style="font-size:11px;color:#9a92b4">' +
        '按单个指标排；不适用该指标的对局（如平局的"获胜血量"、非棋差一招的"续命秒数"）一律沉底。' +
      '</span>' +
    '</div>' +
    '<div class="devtbl"><table><thead><tr>' +
      '<th>#</th><th>种子</th><th>红方</th><th>蓝方</th><th>胜者</th><th>时长</th>' +
      '<th>单次爆发</th><th>短时爆发</th><th>获胜剩余</th><th>最低血量</th><th>标签</th>' +
    '</tr></thead><tbody id="dBody"></tbody></table></div>' +
    '<div class="devfoot"><span id="dSum">还没有数据 —— 点「开始预演」跑一批。</span>' +
      '<span style="margin-left:auto">点任意一行＝用该种子重现这场</span></div>';
  SLOT.appendChild(panel);

  var $ = function (id) { return document.getElementById(id); };
  var elSeed = $('dSeed'), elCount = $('dCount'), elBar = $('dBar'), elProg = $('dProg');
  var elSpeed = $('dSpeed');
  var elBody = $('dBody'), elSum = $('dSum'), elTags = $('dTags'), elRun = $('dRun'), elStop = $('dStop');
  var elWm = $('dWm'), elWmOn = $('dWmOn');
  var elSort = $('dSort'), elSortDir = $('dSortDir');
  /* 排序下拉：选项直接由 SORTS 生成，加指标只改 SORTS 一处 */
  Object.keys(SORTS).forEach(function (k) {
    var o = document.createElement('option');
    o.value = k; o.textContent = SORTS[k].name;
    elSort.appendChild(o);
  });
  function syncSort() {
    var S = SORTS[DEV.sortKey] || SORTS[''];
    elSort.value = DEV.sortKey;
    elSortDir.disabled = !S.val;
    elSortDir.textContent = DEV.sortDir < 0 ? '↓ 降序' : '↑ 升序';
  }

  /* ---------- 小工具 ---------- */
  function pct(v) { return (v * 100).toFixed(0) + '%'; }
  function sec(v) { return v.toFixed(1) + 's'; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function winText(r) {
    if (r.win < 0) return '<span style="color:#9a92b4">平局' + (r.reason === 'timeout' ? '(超时)' : '') + '</span>';
    return '<b style="color:#ffd08a">' + esc(r.win === 0 ? r.aName : r.bName) + '</b>';
  }
  /* 跑一局（不渲染）并取出该局的完整记录 */
  function simOne(a, b, seed) {
    runFullMatch(CARD_BY_ID[a], CARD_BY_ID[b], seed);
    return matchRecord(seed);
  }

  /* ---------- 筛选 ---------- */
  function tagChips() {
    elTags.innerHTML = '';
    var keys = ['winner', 'win0', 'win1'].concat(FILTER_KEYS);
    keys.forEach(function (k) {
      var lab = k === 'winner' ? '只看分出胜负'
        : (k === 'win0' ? '胜者＝红方'
        : (k === 'win1' ? '胜者＝蓝方'
        : (k === 'chess' ? '空悲切' : tagText(k))));
      var l = document.createElement('label');
      l.className = 'devchk' + (active[k] ? ' on' : '') + (k === 'chess' ? ' grace' : '');
      var box = document.createElement('input');
      box.type = 'checkbox'; box.checked = !!active[k];
      box.onchange = function () {
        if (box.checked) active[k] = true; else delete active[k];
        l.classList.toggle('on', !!active[k]);
        if (k === 'chess') { DEV.chessOn = !!box.checked; if (box.checked) chessKick(); }
        simSync();          // 取消勾选＝放弃补算：那一份后台模式也要还回去
        renderTable();
      };
      l.appendChild(box);
      l.appendChild(document.createTextNode(lab));
      l.title = k === 'chess'
        ? '空悲切：把败者在临死那一刻起设为无敌、续命 ' + GRACE_LIFE +
          ' 秒再打一遍（灾厄也斩不动）；' +
          '败者若在这段时间里先反杀对手 → 这一局打上「棋差一招」标签。' +
          '打开时会把当前没算过的局补算一遍（每局要重放，进度见下面）。'
        : '阈值见游戏内 TAG_RULES';
      elTags.appendChild(l);
    });
  }
  function pass(r) {
    for (var k in active) {
      if (k === 'winner') { if (r.win < 0) return false; continue; }
      if (k === 'win0') { if (r.win !== 0) return false; continue; }
      if (k === 'win1') { if (r.win !== 1) return false; continue; }
      if (r.tags.indexOf(k) < 0) return false;     // 多选 = 同时满足
    }
    return true;
  }

  /* ---------- 空悲切（败者续命 1 秒能不能反杀 → 「棋差一招」） ----------
     这一项不像别的标签那样"跑完就有了"：得按这一局的记录【重放】才知道，
     所以它既是开关也是筛选：
       · 打开 → 把当前所有还没算过的局按帧切片补算（进度栏显示 空悲切分析 x/y）；
       · 之后新跑的局，只要开关还开着，就当场算（批量预演里每局多花约一倍时间）；
       · 算过的局在记录上留 r.chess，标签列会多出「棋差一招」，勾上就只看这些局；
       · 关掉开关不会抹掉已算出的标签，只是不再往下算。
     判定细节在 game.html 的 8.2（runGraceMatch）：败者临死那一刻起无敌、续命 1 秒，
     这一秒里它先把对手打死 = 棋差一招。 */
  function chessNeed(r) { return r.win >= 0 && r.chess === undefined; }
  function chessCount() {
    var n = 0;
    for (var i = 0; i < DEV.results.length; i++) if (chessNeed(DEV.results[i])) n++;
    return n;
  }
  function chessAnalyze(r) {
    /* deathT = 败者挨到致命一击的时刻（不是 r.t —— 那是死亡动画播完的时刻）。
       ⚠ 驱动它的必须是 unit.dieT 那个数，拿 r.t 会晚 0.9~1.7 秒，护体就白挂了。 */
    var dt = (r.deathT === null || r.deathT === undefined) ? r.t : r.deathT;
    var g = runGraceMatch(CARD_BY_ID[r.a], CARD_BY_ID[r.b], r.seed, 1 - r.win, dt);
    r.chess = !!g.flip;
    r.chessAt = g.flip ? +g.t.toFixed(3) : null;        // 反杀发生在整局的哪一刻
    /* chessNeed = 【续命多少秒就够反杀】= 反杀时刻 − 致命一击时刻。
       护体只保护败者、不改它这一秒的输出，所以时间线是固定的：
       它在 deathT + X 秒打死对手，就说明"续命 X 秒"足够翻盘（排序指标之一）。 */
    r.chessNeed = g.flip ? +Math.max(0, g.t - dt).toFixed(3) : null;
    if (r.chess && r.tags.indexOf('chess') < 0) r.tags.push('chess');
    return r.chess;
  }
  function chessKick() {
    DEV.chessDirty = chessCount() > 0;
    if (DEV.chessDirty) { elProg.textContent = '空悲切分析 0 / ' + DEV.results.length; pumpStart(); }
    simSync();          // 补算=后台跑数据：一开工就不画、不出声（和批量预演同一条路）
  }
  /* 每片推进一次：按 budget 毫秒预算往下算，算完把表格刷一遍。
     片子由推进泵派（见下方"推进泵"），所以这里的预算从外面传进来。 */
  function tickChess(budget) {
    if (!DEV.chessOn || !DEV.chessDirty) return;
    simSync();
    var t0 = performance.now(), lim = budget || BUDGET_MS, found = false;
    for (var i = 0; i < DEV.results.length; i++) {
      var r = DEV.results[i];
      if (!chessNeed(r)) continue;
      if (performance.now() - t0 > lim) {
        elProg.textContent = '空悲切分析 ' + (DEV.results.length - chessCount()) +
          ' / ' + DEV.results.length;
        if (found) renderTable();
        return;
      }
      if (chessAnalyze(r)) found = true;
    }
    DEV.chessDirty = false;
    simSync();                                          // 算完 → 立刻还回画面与声音
    renderTable();
    var hit = 0;
    for (var j = 0; j < DEV.results.length; j++) if (DEV.results[j].chess) hit++;
    elProg.textContent = '完成 ' + DEV.results.length + ' 局 · 棋差一招 ' + hit + ' 局';
  }

  /* ---------- 表格 ---------- */
  function renderTable() {
    var list = sortList(DEV.results.filter(pass));
    var cap = 400;                                 // 表格最多画 400 行，其余靠筛选/导出
    var html = '';
    for (var i = 0; i < list.length && i < cap; i++) {
      var r = list[i];
      var h1 = r.hit[0] >= r.hit[1] ? 0 : 1;       // 单次爆发取大的那边
      var b1 = r.burst[0] >= r.burst[1] ? 0 : 1;   // 短时爆发取大的那边
      var winMin = r.win < 0 ? Math.max(r.minHp[0], r.minHp[1]) : r.minHp[r.win];
      /* 获胜剩余 = 分出胜负那一刻胜者的血量比例（不是死亡动画播完后的，见 markDecided） */
      var winLeft = r.win < 0 ? '—' : pct(r.hp[r.win] / r.maxHp[r.win]);
      var back = r.win < 0 ? null : (r.behind ? r.behind[r.win] : 0);
      var tags = r.tags.map(function (t) { return '<b>' + esc(tagText(t)) + '</b>'; }).join(' ');
      html += '<tr class="r" data-i="' + DEV.results.indexOf(r) + '" title="' +
        '红：' + esc(r.aName) + ' 造成 ' + Math.round(r.dealt[0]) + ' / 承受 ' + Math.round(r.taken[0]) +
        (r.healed[0] > 1 ? ' / 回复 ' + Math.round(r.healed[0]) : '') +
        '\n蓝：' + esc(r.bName) + ' 造成 ' + Math.round(r.dealt[1]) + ' / 承受 ' + Math.round(r.taken[1]) +
        (r.healed[1] > 1 ? ' / 回复 ' + Math.round(r.healed[1]) : '') +
        '\n单次最大命中  红 ' + Math.round(r.hit[0]) + ' @' + sec(r.hitAt[0]) +
        ' · 蓝 ' + Math.round(r.hit[1]) + ' @' + sec(r.hitAt[1]) +
        '\n3 秒最高爆发  红 ' + Math.round(r.burst[0]) + ' @' + sec(r.burstAt[0]) +
        ' · 蓝 ' + Math.round(r.burst[1]) + ' @' + sec(r.burstAt[1]) +
        (r.win < 0 ? '' :
          '\n获胜剩余血量 ' + winLeft + '（分出胜负 ' + sec(r.decideT === null || r.decideT === undefined ? r.t : r.decideT) + '）' +
          '\n被拉开过的最大血量差 ' + pct(back) + '（逆转幅度）') +
        (r.chessAt !== null && r.chessAt !== undefined
          ? '\n空悲切：败者续命 ' + GRACE_LIFE + ' 秒，在 ' + sec(r.chessAt) + ' 反杀成功（棋差一招，' +
            (r.chessNeed !== null && r.chessNeed !== undefined ? '续命 ' + r.chessNeed.toFixed(2) + 's 即可逆转' : '') + '）'
          : '') + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td class="devseed">' + r.seed + '</td>' +
        '<td>' + esc(r.aName) + '</td><td>' + esc(r.bName) + '</td>' +
        '<td>' + winText(r) + '</td>' +
        '<td>' + sec(r.t) + (r.reason === 'timeout' ? ' ⌛' : '') + '</td>' +
        '<td>' + Math.round(r.hit[h1]) + ' <span class="tg">' + (h1 ? '蓝' : '红') + '</span></td>' +
        '<td>' + Math.round(r.burst[b1]) + ' <span class="tg">' + (b1 ? '蓝' : '红') + '</span></td>' +
        '<td>' + winLeft + '</td>' +
        '<td>' + pct(winMin) + '</td>' +
        '<td class="tg">' + (tags || '—') + '</td>' +
        '</tr>';
    }
    elBody.innerHTML = html || '<tr><td colspan="11" class="devnone">没有符合当前筛选的对局</td></tr>';
    Array.prototype.forEach.call(elBody.querySelectorAll('tr.r'), function (tr) {
      tr.onclick = function () { replay(DEV.results[+tr.dataset.i]); };
    });
    var w = [0, 0];
    list.forEach(function (r) { if (r.win >= 0) w[r.win]++; });
    elSum.textContent = '共 ' + DEV.results.length + ' 局，筛出 ' + list.length + ' 局（红胜 ' + w[0] +
      ' / 蓝胜 ' + w[1] + ' / 平 ' + (list.length - w[0] - w[1]) + '）' +
      (list.length > cap ? ' · 表内只显示前 ' + cap + ' 行' : '');
    if (!DEV.running && !DEV.replaying) {
      elProg.textContent = DEV.results.length ? ('完成 ' + DEV.results.length + ' 局') : '待机';
    }
  }

  /* ---------- 重现 ---------- */
  function openPanel(on) {
    DEV.on = on;
    panel.classList.toggle('on', on);
    btn.classList.toggle('on', on);
    btn.textContent = on ? '开发者模式' : (DEV.replaying ? '开发者模式 · 重现中' : '开发者模式');
  }
  function replay(r) {
    if (!r) return;
    /* 系列赛进行中世界归它管：重现会把 SERIES 的对局冲掉，直接不响应 */
    if (typeof SERIES !== 'undefined' && SERIES.on) {
      elProg.textContent = '系列赛进行中，重现不可用';
      return;
    }
    endReplay();                                        // 上一场还在放就先把倍速还回去
    /* 点行重现 = 用户要看这一局：先把没算完的空悲切补算放掉。
       补算也在抢 world（它就是一场场地重放），不放手的话用户这一局会被
       补算每帧按住重置 —— 而且补算还占着"无渲染"那一份引用（画面是空的）。 */
    if (DEV.chessDirty) { DEV.chessDirty = false; simSync(); }
    SEL.L = r.a; SEL.R = r.b;
    makePanel(document.getElementById('panelL'), 'L');   // 把两侧面板刷成这一局的卡
    makePanel(document.getElementById('panelR'), 'R');
    elSeed.value = String(r.seed);
    DEV.seedText = String(r.seed);
    resetMatch(CARD_BY_ID[r.a], CARD_BY_ID[r.b], r.seed);
    /* 【快进播放】一局本身 30~120 秒，按 1× 看就像画面卡住不动；
       这里用面板自己的倍速，并把工具栏的倍速原样记下来、结束后还回去
       （只影响重现，不改用户自己的选择）。 */
    DEV.replayTotal = r.t;
    DEV.speedBack = world.speedMul;
    world.speedMul = DEV.speed;
    world.autoStop = DEV.autoStop;
    world.running = true;
    btnStart.disabled = true; btnPause.disabled = false; btnPause.textContent = '暂停';
    sfx('battle_start_1', 0.85);
    DEV.replaying = true;
    openPanel(false);                                   // 收起面板让出画面
    elProg.textContent = '重现中 0.0s / ' + r.t.toFixed(1) + 's';
  }
  /* 重现结束（打完或被打断）：把倍速还给用户的选择，并把面板状态刷新回去 */
  function endReplay() {
    if (!DEV.replaying) return;
    DEV.replaying = false;
    world.speedMul = DEV.speedBack || 1;
    openPanel(DEV.on);
    renderTable();                                      // 进度栏从"重现中…"切回"完成 N 局"
  }
  /* 重现期间每帧刷新进度："重现中 12.3s / 26.2s" —— 快进时也能看出确实在跑 */
  function replayTick() {
    if (!DEV.replaying) return;
    if (!world.running || world.over) { endReplay(); return; }
    elProg.textContent = '重现中 ' + world.t.toFixed(1) + 's / ' +
      (DEV.replayTotal || 0).toFixed(1) + 's';
  }

  /* ---------- 推进泵（批量预演 / 空悲切补算的驱动） ----------
     预演是"切片推进"：每片干 BUDGET_MS 毫秒的活，片与片之间把主线程还给浏览器。
     切片由两条泵派，两条都要：

       · 主循环 rAF（devFrame）：页面可见时每帧派一片 —— 画面、按钮都还活着。
       · MessageChannel 自投递兜底泵：**rAF 在后台标签 / 窗口被遮挡时会被浏览器
         掐到 ~1 次/秒**（实测 1.6 次/秒；窗口最小化还可能整个停掉）。
         2000 局预演本来 20 多秒，被掐成 1 局/秒就变成半小时以上 ——
         表现就是"预演到一半卡住不动了"。通道消息是"任务"不是定时器，
         不受后台节流（定时器会被掐、通道不会），所以它一顶上去就恢复满速。

     兜底泵只在"探到 rAF 确实不来了"时才干活（判据与迟滞见 BG_ENTER_MS / BG_EXIT_MS）：
       · 浏览器自报 document.hidden（后台标签/最小化）→ 立刻接管；
       · rAF 超过 BG_ENTER_MS 没来一帧（窗口被别的窗口盖住时的"遮挡节流"也走这条）
         → 接管；等 rAF 回到 10fps 以上再交还。
     可见时依旧由 rAF 出片，手感、每帧预算都和以前一模一样。 */
  var PROBE_MS = 250;        // 可见时的探测间隔
  var BG_ENTER_MS = 250;     // rAF 超过这么久没来一帧 = 被节流/停掉了，接管
  var BG_EXIT_MS = 100;      // rAF 回到 10fps 以上才交还给 rAF
  var PUMP = { on: false, ch: null, bg: false, lastRaf: 0 };
  function pumpWork() { return DEV.running || (DEV.chessOn && DEV.chessDirty); }
  function pumpStart() {
    if (PUMP.on) return;
    /* 没有 MessageChannel（无头桩 / 老环境）就只走 rAF —— 行为与加泵之前一致 */
    if (typeof MessageChannel !== 'function' || typeof performance === 'undefined') return;
    if (!PUMP.ch) {
      PUMP.ch = new MessageChannel();
      PUMP.ch.port1.onmessage = pumpLoop;
    }
    PUMP.on = true;
    PUMP.bg = false;
    PUMP.lastRaf = performance.now();            // 从"现在"起算：可见时别一上来就接管
    PUMP.ch.port2.postMessage(0);
  }
  function pumpStop() { PUMP.on = false; }
  function pumpLoop() {
    if (!PUMP.on) return;
    simSync();
    if (!pumpWork()) { PUMP.on = false; return; }
    var gap = performance.now() - PUMP.lastRaf;
    var visHidden = (typeof document !== 'undefined' && document.visibilityState === 'hidden');
    if (visHidden) PUMP.bg = true;                              // 浏览器明说在后台
    else if (PUMP.bg) { if (gap < BG_EXIT_MS) PUMP.bg = false; } // 后台中：rAF 回来了就交还
    else if (gap > BG_ENTER_MS) PUMP.bg = true;                  // 前台：rAF 不来才接管
    if (PUMP.bg) {
      /* ⚠ 后台绝不能改成 setTimeout 派片：定时器正是被掐的那个东西，
         一拍一拍地等就等于回到"1 局/秒"。通道自投递才是那条不受节流的路。 */
      tickBatch(BUDGET_BG); tickChess(BUDGET_BG);               // 没人看画面，一片多跑点
      if (!pumpWork()) { PUMP.on = false; return; }
      PUMP.ch.port2.postMessage(0);
    } else {
      setTimeout(pumpLoop, PROBE_MS);                            // 可见：让 rAF 出片，过会儿再探
    }
  }
  /* 一变成后台就立刻接管：visibilitychange 是事件不是定时器，不受节流，
     所以不用干等下一次探测（那个探测本身就被掐着）。 */
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (PUMP.on && typeof document.visibilityState === 'string' &&
          document.visibilityState === 'hidden') pumpLoop();
    });
  }

  /* ---------- 后台模式（不渲染 + 静音） ----------
     批量预演与空悲切补算都是"后台跑数据"：一帧不画、一声不出。
     两处都踩过同一个坑（用户报的）：
       · 预演时几十局的打击音连成一片噪声 → 静音开关挂在 makeHeadless()/endHeadless() 里；
       · 空悲切补算同样要重放每一局，却【没走这条路】，于是补算时有声音，
         连带画面也被补算的对局占着（抖成一片假战斗）。
     这里把"该不该在后台模式"由 DEV 的旗标【推】出来（预演在跑 || 补算还没算完），
     每次推进都对一遍 —— 而不是在各处手工进出：补算可能被"取消勾选 / 又点预演 /
     点停止"打断，手工进出漏掉任何一条路径都会把画面永远留在无渲染里（老坑）。 */
  var SIM = { bg: false };
  function simSync() {
    var want = !!DEV.running || !!(DEV.chessOn && DEV.chessDirty);
    if (want === SIM.bg) return;
    SIM.bg = want;
    if (want) makeHeadless();                  // 换假 canvas + sfxMute = true
    else endHeadless();                        // 真 canvas 与 2D 上下文取回来 + 解除静音
  }

  /* ---------- 批量预演（切片推进，不卡界面） ---------- */
  var BUDGET_MS = 12;        // 可见时每片的预算（rAF 每帧一片）
  var BUDGET_BG = 24;        // 后台接管时每片的预算（画面没人看，一片多干点）
  function startBatch() {
    if (DEV.running) return;
    /* 系列赛进行中批量预演会把 SERIES 的对局冲掉，直接不响应（同 replay 的守卫） */
    if (typeof SERIES !== 'undefined' && SERIES.on) {
      elProg.textContent = '系列赛进行中，批量预演不可用';
      return;
    }
    var n = Math.max(1, Math.min(2000, +elCount.value || 50));
    DEV.count = n; DEV.running = true; DEV.done = 0; DEV.results = [];
    DEV.chessDirty = false;                             // 上一批的空悲切待算清掉（记录已换）
    elRun.disabled = true; elStop.disabled = false;
    simSync();                                          // 预演期间不渲染、不出声
    stopLive();
    pumpStart();
  }
  function tickBatch(budget) {
    if (!DEV.running) return;
    var t0 = performance.now(), lim = budget || BUDGET_MS;
    var base = DEV.seedText.trim();
    while (DEV.running && DEV.done < DEV.count && performance.now() - t0 < lim) {
      /* 种子：留空 → 每局现掷；填了 → 以它为起点派生（第 2 局起 +1），
         这样"批量预演"既能复现同一批，又不会 50 局全一样 */
      var seed;
      if (!base) seed = makeSeed();
      else seed = seedHash(/^-?\d+$/.test(base) ? (+base + DEV.done) : (base + '#' + DEV.done));
      var rec = simOne(SEL.L, SEL.R, seed);
      /* 空悲切开着就当场分析这一局（重放一遍看败者续命 1 秒能不能反杀） */
      if (DEV.chessOn) chessAnalyze(rec);
      DEV.results.push(rec);
      DEV.done++;
    }
    elBar.style.width = (DEV.done / DEV.count * 100).toFixed(1) + '%';
    elProg.textContent = DEV.done + ' / ' + DEV.count;
    if (DEV.done >= DEV.count) finishBatch();
  }
  function finishBatch() {
    if (!DEV.running) return;                           // 只收尾一次（restoreRaf 可能多调几帧）
    DEV.running = false;
    pumpStop();
    elRun.disabled = false; elStop.disabled = true;
    elProg.textContent = '完成 ' + DEV.done + ' 局';
    renderTable();
    simSync();                                          // 预演完 → 还回画面与声音
    /* 还原成一局待开的新对局：把预演最后一局的结算横幅/状态一起清掉 */
    world.over = null;
    resetMatch(CARD_BY_ID[SEL.L], CARD_BY_ID[SEL.R]);
    world.running = false;
    btnStart.disabled = false; btnPause.disabled = true; btnPause.textContent = '暂停';
    openPanel(true);                                    // 跑完直接展开看结果
  }

  /* ---------- 水印（竞技场正中，颜色很淡） ----------
     钩子名固定 = window.devWmDraw：game.html 在 drawArena() 里【底色与边框之后、
     单位与特效之前】调用它 —— 所以水印是"背景水印"，
     **不会遮住卡牌 / 仆从 / 血条 / 伤害数字**，也不会被底色盖掉。
     正式版里没有这个钩子（也不含本文件），所以正式版零开销。
     字号/浓度按用户要求调小调淡（2026-09-24 二轮：46px/0.115 → 28px/0.08）。 */
  var WM = { size: 28, lh: 1.34, color: 'rgba(214,224,255,0.08)', maxW: 0.88, minSize: 12 };
  function syncWm() {
    var empty = !String(DEV.wmText || '').trim();
    if (empty) DEV.wmOn = false;      // 没文字＝画不出东西，别留一个"开着却看不见"的状态
    elWmOn.disabled = empty;
    elWmOn.textContent = '水印: ' + (DEV.wmOn ? '开' : '关');
    elWmOn.classList.toggle('on', DEV.wmOn);
  }
  elWm.oninput = function () { DEV.wmText = elWm.value; syncWm(); };
  elWmOn.onclick = function () { DEV.wmOn = !DEV.wmOn; syncWm(); };
  /* 画：坐标系是竞技场的 660×660 逻辑坐标（画布外面已经 scale 过），所以字号也按这个尺度给。
     长文本自动缩小：按最长一行量宽度，缩到不超过场宽的 88%（下限 14px），免得溢出竞技场。 */
  window.devWmDraw = function (g2) {
    if (!DEV.wmOn || !g2) return;
    var txt = String(DEV.wmText || '').replace(/\r\n?/g, '\n');
    if (!txt.trim()) return;
    var lines = txt.split('\n');
    var W = CFG.AW, H = CFG.AH;
    var i, w, max, size = WM.size;
    g2.save();
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    for (var pass = 0; pass < 10; pass++) {
      g2.font = '700 ' + size.toFixed(1) + 'px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
      max = 0;
      for (i = 0; i < lines.length; i++) {
        var mt = g2.measureText ? g2.measureText(lines[i]) : null;
        w = (mt && mt.width) || 0;
        if (w > max) max = w;
      }
      if (max <= W * WM.maxW || size <= WM.minSize) break;
      size = Math.max(WM.minSize, size * (W * WM.maxW) / max);
    }
    var lh = size * WM.lh, top = H / 2 - (lines.length - 1) * lh / 2;
    g2.fillStyle = WM.color;
    for (i = 0; i < lines.length; i++) g2.fillText(lines[i], W / 2, top + i * lh);
    g2.restore();
  };
  syncWm();

  /* ---------- 事件 ---------- */
  btn.onclick = function () {
    openPanel(!DEV.on);
    if (DEV.on) renderTable();
  };
  $('dSeedRnd').onclick = function () {
    elSeed.value = String(makeSeed());
    DEV.seedText = elSeed.value;
  };
  $('dSeedPlay').onclick = function () {
    if (!elSeed.value.trim()) { elSeed.value = String(makeSeed()); }
    DEV.seedText = elSeed.value;
    resetMatch(CARD_BY_ID[SEL.L], CARD_BY_ID[SEL.R], DEV.seedText);
    world.autoStop = DEV.autoStop;
    world.running = true;
    btnStart.disabled = true; btnPause.disabled = false; btnPause.textContent = '暂停';
    sfx('battle_start_1', 0.85);
    openPanel(false);
  };
  elSeed.oninput = function () { DEV.seedText = elSeed.value; };
  elSpeed.onchange = function () {
    DEV.speed = +elSpeed.value || 1;
    if (DEV.replaying) world.speedMul = DEV.speed;      // 重现途中改倍速立刻生效
  };
  elRun.onclick = startBatch;
  elStop.onclick = function () {
    if (!DEV.running) return;
    DEV.running = false;
    pumpStop();                                         // 顺带停掉空悲切的补算
    DEV.chessDirty = false;
    elRun.disabled = false; elStop.disabled = true;
    elProg.textContent = '已停止（' + DEV.done + ' 局）';
    renderTable(); simSync();
    world.over = null;
    resetMatch(CARD_BY_ID[SEL.L], CARD_BY_ID[SEL.R]);
    btnStart.disabled = false; btnPause.disabled = true; btnPause.textContent = '暂停';
  };
  /* 手动停/重置重现时（工具栏按钮或快捷键），把倍速还回去 */
  btnStart.addEventListener('click', function () { endReplay(); });
  btnReset.addEventListener('click', function () { endReplay(); });
  /* 用户手动改工具栏倍速时，让"重现倍速"跟着走（下次重现就用这个速度） */
  document.getElementById('segSpeed').addEventListener('click', function () {
    if (!DEV.replaying && world.speedMul) {
      DEV.speed = world.speedMul;
      elSpeed.value = String(world.speedMul);
    }
  });
  $('dClear').onclick = function () { active = {}; tagChips(); renderTable(); };
  elSort.onchange = function () {
    DEV.sortKey = elSort.value;
    var S = SORTS[DEV.sortKey];
    if (S && S.dir) DEV.sortDir = S.dir;      // 换成新指标时用它自己的默认方向
    syncSort(); renderTable();
  };
  elSortDir.onclick = function () {
    var S = SORTS[DEV.sortKey];
    if (!S || !S.val) return;                 // 记录顺序没有方向
    DEV.sortDir = -DEV.sortDir;
    syncSort(); renderTable();
  };
  $('dExport').onclick = function () {
    var blob = new Blob([JSON.stringify(DEV.results, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '小球对决_预演_' + Date.now() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && DEV.on) openPanel(false);
  });

  /* ---------- 供游戏本体调用的钩子 ---------- */
  /* 每帧被主循环调一次：批量预演切片 + 空悲切补算 + 重现进度刷新 + 重现收尾。
     PUMP.lastRaf = 兜底泵用它判断"rAF 还来不来"（见"推进泵"）。 */
  window.devFrame = function () {
    PUMP.lastRaf = performance.now();
    simSync();
    tickBatch(); tickChess(); replayTick();
  };
  /* 工具栏的「开始战斗」会问这里要本局种子：输入框填了就用它（连着开就是同一局），
     留空返回 undefined → 由 resetMatch 现掷一个新种子（与正式版一致）。 */
  window.devPendingSeed = function () {
    var s = DEV.seedText.trim();
    return s ? s : undefined;
  };
  window.devMatchStarted = function () {
    if (DEV.seedText) { elProg.textContent = '本局种子 ' + world.seed; }
  };
  window.DEV = DEV;                                     // 控制台里可直接查
  DEV.replay = replay;                                  // 控制台里也能手动放某一局（DEV.replay(DEV.results[0])）

  tagChips();
  syncSort();
  renderTable();
})();
