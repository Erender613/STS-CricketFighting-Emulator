/* ============================================================
   浏览器探针 A（主版本）：由 tools/verify_browser.py 注入到构建产物副本
   （tools/_probe/devpanel_main.js → tools/_probe/_v_main_probe.html）
   ① 标题颜色
   ② 构造"某方获胜/平局"的终局 → 调真实渲染 → 读画布像素判断横幅是否纯白
   ③ 真开一局跑 60 帧 → 让红方战死 → 走完主循环的结算通路
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
  function done() { document.title = 'PROBE_MAIN_DONE'; }
  window.onerror = function (m, s, l) { log('JS错误: ' + m + ' @' + l); };

  var h1 = document.querySelector('header h1');
  log('标题文案="' + h1.textContent + '" 颜色=' + getComputedStyle(h1).color);
  log('标题加粗部分颜色=' + getComputedStyle(h1.querySelector('b')).color);
  log('含开发者面板=' + !!document.querySelector('#devSlot .devbtn'));

  /* ---------- ② 横幅像素 ----------
     只统计"笔画像素"（够亮的），再看这些笔画是不是全是中性灰白：
     背景那条半透明黑带本身略带蓝紫，直接数"带彩像素"会把它算进去。 */
  function bannerPixels() {
    var cv = document.getElementById('cv'), g = cv.getContext('2d');
    var S = cv.width / 660;
    var img = g.getImageData(Math.round(60 * S), Math.round(278 * S),
      Math.round(540 * S), Math.round(24 * S)).data;
    var glyph = 0, white = 0, colored = 0, maxc = 0, minLum = 255, sumLum = 0;
    for (var i = 0; i < img.length; i += 4) {
      var r = img[i], gg = img[i + 1], b = img[i + 2], a = img[i + 3];
      if (a < 128) continue;
      var mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), spread = mx - mn;
      if (mx <= 150) continue;                       // 暗带/背景不算笔画
      glyph++;
      sumLum += mx; if (mx < minLum) minLum = mx;
      if (spread > 24) { colored++; if (spread > maxc) maxc = spread; }
      if (r > 240 && gg > 240 && b > 240) white++;
    }
    return { glyph: glyph, white: white, colored: colored, maxc: maxc,
             minLum: minLum, avgLum: glyph ? Math.round(sumLum / glyph) : 0 };
  }
  [0, 1, -1].forEach(function (side) {
    resetMatch(CARD_BY_ID['dark_embrace'], CARD_BY_ID['voltaic'], 4242);
    world.over = { win: side, reason: side < 0 ? 'timeout' : 'kill', t: 33.3, tags: [] };
    drawArena(); drawOverlayBanner();
    var p = bannerPixels();
    var who = side < 0 ? '平局' : ('胜者 ' + world.units[side].card.name);
    log('构造[' + who + '] → 笔画=' + p.glyph + ' 纯白=' + p.white +
      ' 带彩=' + p.colored + ' 最大彩差=' + p.maxc +
      ' 最暗笔画亮度=' + p.minLum + ' 平均亮度=' + p.avgLum +
      ((p.glyph > 200 && p.colored === 0 && p.minLum > 150) ? '  [OK 纯白字]' : '  [!! 疑似非纯白]'));
  });

  /* ---------- ③ 真打一局：60 帧后让红方战死 ---------- */
  resetMatch(CARD_BY_ID['dark_embrace'], CARD_BY_ID['voltaic'], 4242);
  world.running = true;
  var f = 0, g = 0;
  function step() {
    if (f++ < 60) { requestAnimationFrame(step); return; }
    log('跑过 ' + f + ' 帧（真实耗时 ' + el() + 's）→ 让红方战死（横幅应变成蓝方卡名）');
    world.units[0].damage(99999);
    requestAnimationFrame(after);
  }
  function after() {
    if (!world.over) {
      if (++g > 400) { log('!! 单位死亡后主循环没走到结算'); return done(); }
      requestAnimationFrame(after); return;
    }
    log('结算通路: win=' + world.over.win + ' reason=' + world.over.reason +
      ' t=' + world.over.t.toFixed(2) + ' 标签=' + JSON.stringify(world.over.tags || []));
    log('期望胜者=' + world.units[world.over.win].card.name + '（蓝方 voltaic）');
    log('主循环 running=' + world.running + '（正式版不自动停，应为 true）');
    done();
  }
  requestAnimationFrame(step);
})();
