/* 一次性：把"战斗开始过场"几个关键时刻拼成一张对照图导出，用来肉眼验收。
 * 踩过的坑（都体现在这里）：
 *   ① rAF 主循环要继续重绘 + tickIntro 累加时间 → 先覆盖 requestAnimationFrame 掐掉循环；
 *   ② toDataURL 连续调多次时，第 2 张之后会拿到坏帧（实测第 1 张正常、后面全丢）→
 *      改成"把几个时刻 drawImage 拼到一张大画布、只导出一次"；
 *   ③ 导出前用 getImageData 强制同步 flush；
 *   ④ 用 JPEG：dump-dom 输出上限约 5MB，3 张 626px 的 PNG 会顶到上限。
 * 用法：node tools/_intro_shot.js → tools/_intro_probe.html → 无头 Chrome dump-dom
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '杀戮尖塔小球对决.html');
const PROBE = path.join(__dirname, '_intro_probe.html');

/* 采样时刻（对着当前 INTRO_TL 选的：lead .30 + titleIn 1.30 = 1.60 开始一起收尾，
 * titleOut = barOut = .80 → 2.40 一起没）。
 *   t=1.20 两者都在 / t=2.00 都在淡出 / t=2.30 都基本没了 / t=2.60 彻底没了。
 *   ★ t=2.60 是这次改动的关键哨兵：旧时间线（条带 2.45 才开始收、收到 2.95）在这里
 *     条带还剩约 17% 亮度；新时间线应该 r-b 变负（条带不在）。 */
const TIMES = [1.20, 2.00, 2.30, 2.60];

const html = fs.readFileSync(SRC, 'utf8');
const probe = `
<div id="err" style="position:fixed;left:8px;top:8px;color:#7CFC9A;background:rgba(0,0,0,.75);font:11px monospace;z-index:99999;white-space:pre-wrap"></div>
<script>
window.__ERRS__ = [];
window.addEventListener('error', function (e) { window.__ERRS__.push('ERR: ' + (e.message || e.error)); });
setTimeout(function () {
  window.requestAnimationFrame = function () { return 0; };
  setTimeout(function () {
    var cv = document.getElementById('cv'), g = cv.getContext('2d');
    var flush = function () { g.getImageData(0, 0, 1, 1); };
    var TIMES = ${JSON.stringify(TIMES)};
    /* 条带探针 —— 判据改过，别再退回"看 r-b 正负"：
       那条是早期按"竞技场是纯色 #1b1627"标定的，2026-09-23 竞技场改成半透明渐变
       （为了透出整页布景）之后就失效了：背景本身 r-b 已经是很负的值，
       条带叠上去只是把 r-b 从 -24 抬到 -2，仍然是负 → 会把"条带在"读成"条带不在"。
       现在的口径是【跟"过场关闭"的同一帧做差】：条带的行内亮度会显著下降，
       背景的渐变/暗角/布景全都在两帧里抵消掉了，免疫任何背景改动。
       取样列取最左侧 x=4（避开两张卡牌）。 */
    var k = cv.width / 1920, cy = Math.round(cv.height * 0.449), hh = Math.round(90 * k);
    var luma = function (d, i) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
    function frame() { return g.getImageData(0, 0, cv.width, cv.height).data; }
    /* 条带：最左侧一列（x=4，避开卡牌、也避开居中的标题），带内各行的平均亮度差。
       背景的渐变/暗角/布景在同一帧基准里抵消，所以这个数只反映条带。 */
    function bandMean(a, b, y0, y1) {
      var s = 0, n = 0;
      for (var y = y0; y <= y1; y++) { var i = (y * cv.width + 4) * 4; s += Math.abs(luma(a, i) - luma(b, i)); n++; }
      return n ? s / n : 0;
    }
    /* 标题：居中区域的最大亮度差。金色字的亮度差是 160+ 量级，条带只有 ~7，
       所以这个数基本只反映标题（标题正好压在条带中间，行上分不开，靠量级区分）。 */
    function titleMax(a, b) {
      var m = 0, x0 = Math.round(cv.width * 0.30), x1 = Math.round(cv.width * 0.70);
      var y0 = Math.round(cv.height * 0.42), y1 = Math.round(cv.height * 0.50);
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var i = (y * cv.width + x) * 4;
          var d = Math.abs(luma(a, i) - luma(b, i));
          if (d > m) m = d;
        }
      }
      return m;
    }
    function barPixel(cur, base) {
      return ' 条带=' + bandMean(cur, base, cy - hh + 2, cy + hh - 2).toFixed(2) +
             ' 标题=' + titleMax(cur, base).toFixed(0) +
             ' (带内 ' + (cy - hh) + '~' + (cy + hh) + 'px)';
    }
    var big = document.createElement('canvas');
    big.width = cv.width * TIMES.length; big.height = cv.height;
    var bg = big.getContext('2d');
    bg.fillStyle = '#000'; bg.fillRect(0, 0, big.width, big.height);
    var rows = ['cv=' + cv.width + 'x' + cv.height];
    /* 基准帧：过场关掉，只留竞技场 */
    window.__intro.on = false; window.__draw(); flush();
    var base = frame();
    for (var i = 0; i < TIMES.length; i++) {
      window.__intro.on = true; window.__intro.t = TIMES[i];
      window.__draw(); flush();
      var cur = frame();
      rows.push('t=' + TIMES[i] + barPixel(cur, base));
      bg.drawImage(cv, cv.width * i, 0);
      bg.fillStyle = 'rgba(0,0,0,.6)'; bg.fillRect(cv.width * i, 0, 96, 20);
      bg.fillStyle = '#9f9'; bg.font = '13px monospace';
      bg.fillText('t=' + TIMES[i] + 's', cv.width * i + 6, 14);
    }
    bg.getImageData(0, 0, 1, 1);
    var img = big.toDataURL('image/jpeg', 0.92);
    document.getElementById('err').textContent = 'META ' + rows.join(' | ') + ' @@ ' +
      (window.__ERRS__.length ? window.__ERRS__.join(' ; ') : 'NO_JS_ERROR') + ' ### ' + img;
  }, 300);
}, 3500);
</script>
</body>`;
fs.writeFileSync(PROBE, html.replace('</body>', probe), 'utf8');
console.log('探针页已写出:', PROBE, ' 时刻:', TIMES.join(', '));
