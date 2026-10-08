/* ============================================================
   浏览器探针 B（开发者版）：由 tools/verify_browser.py 注入到构建产物副本
   （tools/_probe/devpanel_dev.js → tools/_probe/_v_dev_probe.html）
   固定种子 → 批量预演 30 局 → 标签筛选（交集）→ 点一行重现 → 自动停
   ============================================================ */
(function () {
  var V = [], T0 = performance.now();
  var box = document.createElement('div');
  box.id = 'verdict';
  box.style.cssText = 'position:fixed;left:0;bottom:0;right:0;background:#000;color:#0f0;' +
    'font:12px monospace;padding:6px;z-index:99;white-space:pre-wrap';
  document.body.appendChild(box);
  function log(s) { V.push(s); box.textContent = V.join('\n'); }
  function el() { return ((performance.now() - T0) / 1000).toFixed(1); }
  function done() { document.title = 'PROBE_DEV_DONE'; }
  window.onerror = function (m, s, l) { log('JS错误: ' + m + ' @' + l); };

  var btn = document.querySelector('#devSlot .devbtn');
  log('右上角按钮存在=' + !!btn + ' 文案="' + (btn ? btn.textContent : '') + '"');
  if (!btn) return done();
  btn.click();
  log('点击后面板展开=' + document.querySelector('.devwrap').classList.contains('on'));

  var seed = document.getElementById('dSeed');
  seed.value = '20240607';
  seed.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('dCount').value = '30';
  document.getElementById('dRun').click();

  /* 精确按文案找筛选块：不能用 indexOf —— "单次爆发" 是 "对手单次爆发" 的子串，
     会把旁边那块一起勾上（也会把筛选收得过窄）。 */
  function boxWith(txt) {
    var bs = document.querySelectorAll('#dTags input[type=checkbox]');
    for (var i = 0; i < bs.length; i++) if (bs[i].parentNode.textContent === txt) return bs[i];
    for (var j = 0; j < bs.length; j++) if (bs[j].parentNode.textContent.indexOf(txt) >= 0) return bs[j];
    return null;
  }
  function rows() { return document.querySelectorAll('#dBody tr.r').length; }

  var waited = 0;
  function waitBatch() {
    if (DEV.running || DEV.results.length < 30) {
      if (++waited > 400) { log('超时：批量预演没跑完 (' + DEV.results.length + '/30)'); return done(); }
      setTimeout(waitBatch, 20); return;
    }
    var R = DEV.results;
    log('预演完成 ' + R.length + ' 局（真实耗时 ' + el() + 's）；首局种子=' + R[0].seed +
      ' 末局种子=' + R[R.length - 1].seed);
    log('表格行数=' + rows() + ' 汇总="' + document.getElementById('dSum').textContent + '"');
    var tags = {};
    R.forEach(function (r) { r.tags.forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
    log('标签分布=' + JSON.stringify(tags));

    var n0 = rows();
    var b1 = boxWith('逆境反杀');
    if (b1) { b1.checked = true; b1.onchange(); }
    var n1 = rows();
    log('勾"逆境反杀"=' + !!b1 + ' → 行数=' + n1 + ' 汇总="' +
      document.getElementById('dSum').textContent + '"');
    var b2 = boxWith('胜者＝红方');
    if (b2) { b2.checked = true; b2.onchange(); }
    var n2 = rows();
    log('叠加"胜者＝红方" → 行数=' + n2 + '（交集，应 ≤ ' + n1 + '）');
    if (b1) { b1.checked = false; b1.onchange(); }
    log('去掉"逆境反杀"只留"胜者＝红方" → 行数=' + rows() + '（应 ≥ ' + n2 + '）');
    /* 两种爆发必须是两个独立筛选项 */
    var bHit = boxWith('单次爆发'), bWin = boxWith('短时爆发');
    log('爆发筛选: 单次爆发=' + !!bHit + ' 短时爆发=' + !!bWin);
    if (bHit) { bHit.checked = true; bHit.onchange(); }
    var nHit = rows();
    if (bWin) { bWin.checked = true; bWin.onchange(); }
    log('只勾"单次爆发" → ' + nHit + ' 行；再叠加"短时爆发" → ' + rows() +
      ' 行（交集，应 ≤ ' + nHit + '）');
    if (bHit) { bHit.checked = false; bHit.onchange(); }
    if (bWin) { bWin.checked = false; bWin.onchange(); }
    log('其他筛选: 残血获胜=' + !!boxWith('残血获胜') + ' 久战=' + !!boxWith('久战') +
      ' 碾压=' + !!boxWith('碾压') + ' 速战=' + !!boxWith('速战') +
      ' 对手单次爆发=' + !!boxWith('对手单次爆发') + ' 拉锯=' + !!boxWith('拉锯'));
    document.getElementById('dClear').click();
    log('清空筛选 → 行数=' + rows() + '（原 ' + n0 + '）');
    /* 表头要有两种爆发两列 */
    var head = document.querySelector('.devtbl thead').textContent;
    log('表头: ' + head);
    log('表头含"单次爆发"=' + (head.indexOf('单次爆发') >= 0) +
      ' 含"短时爆发"=' + (head.indexOf('短时爆发') >= 0));
    var firstRow = document.querySelectorAll('#dBody tr.r')[0];
    log('第一行数值: ' + (firstRow ? firstRow.textContent.replace(/\s+/g, ' ') : '-'));

    /* 点第一行重现，再在 60 帧后把红方打死，验证"自动停" */
    var row = document.querySelectorAll('#dBody tr.r')[0];
    if (!row) { log('!! 表格没有行'); return done(); }
    var wantSeed = row.children[1].textContent;
    /* 先记录"点之前"的画面指纹：预演结束后必须有真实渲染上下文，
       否则点行只会听到音效、画面一动不动（曾经的 bug）。 */
    var cv = document.getElementById('cv');
    var ctx = cv.getContext('2d');
    function fingerprint() {
      try {
        var d = ctx.getImageData(0, 0, cv.width, cv.height).data, h = 0;
        for (var i = 0; i < d.length; i += 7919) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
        return h;
      } catch (e) { return 'ERR:' + e.message; }
    }
    row.click();
    log('点第一行 → 期望种子=' + wantSeed + ' 实际 world.seed=' + world.seed +
      ' 面板收起=' + !document.querySelector('.devwrap').classList.contains('on') +
      ' 运行中=' + world.running + ' 自动停=' + world.autoStop);
    log('重现倍速选择=' + document.getElementById('dSpeed').value +
      ' 实际 world.speedMul=' + world.speedMul +
      ' 进度栏="' + document.getElementById('dProg').textContent + '"');
    var fp0 = fingerprint();
    var f = 0, g = 0, fpChanged = false, tSeen = [];
    function step() {
      tSeen.push(world.t);
      if (fingerprint() !== fp0) fpChanged = true;
      if (f++ < 60) { requestAnimationFrame(step); return; }
      log('重现播放中：画布内容变化=' + fpChanged + '（指纹 ' + fp0 + ' → ' + fingerprint() + '）' +
        ' 游戏时间 ' + tSeen[0].toFixed(2) + ' → ' + world.t.toFixed(2) + 's' +
        ' 进度栏="' + document.getElementById('dProg').textContent + '"');
      log('→ ' + ((fpChanged && world.t > tSeen[0]) ? '画面真的在动 [OK]' : '画面没动 [卡住]'));
      world.units[0].damage(99999);
      requestAnimationFrame(after);
    }
    function after() {
      if (!world.over) {
        if (++g > 400) { log('!! 重现没走到结算'); return done(); }
        requestAnimationFrame(after); return;
      }
      log('重现结算 win=' + world.over.win + ' t=' + world.over.t.toFixed(2) +
        ' 标签=' + JSON.stringify(world.over.tags));
      log('自动停: running=' + world.running + ' btnStart.disabled=' +
        document.getElementById('btnStart').disabled + ' 按钮文案="' +
        document.querySelector('#devSlot .devbtn').textContent + '"');
      /* 再用「用该种子开战」按钮验一次种子生效 */
      document.querySelector('#devSlot .devbtn').click();
      document.getElementById('dSeedPlay').click();
      log('「用该种子开战」→ world.seed=' + world.seed + ' running=' + world.running);
      log('（没有 JS 错误即通过）');
      done();
    }
    requestAnimationFrame(step);
  }
  setTimeout(waitBatch, 20);
})();
