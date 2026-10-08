/**
 * 生成 tools/_wisp_probe.html：验证「灵魂归巢」动画的画面。
 * 直接驱动 combat 世界 —— 前 3 次 onSoulDeath 开风暴，第 4 次在 (150,505) 起飞，
 * 在飞行途中截 3 帧（早/中/到），交给 tools/shotpng.py 用无头 Chrome 取出来。
 * 用法: node tools/make_probe_wisp.js && python tools/shotpng.py tools/_wisp_probe.html tools/预览图 _wisp
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');

/* 起飞点刻意选在左下：离风眼 (330,330) 有 240px，蜿蜒看得清 */
const probe = `
<script>
(function () {
  var frames = 0, logs = [], stage = 0, mech = null, fired = false, fly0 = 0;
  function el(id) { return document.getElementById(id); }
  function errbox(t) {
    var e = el('err');
    if (!e) { e = document.createElement('div'); e.id = 'err'; e.style.display = 'none'; document.body.appendChild(e); }
    e.textContent += t + ' | ';
  }
  function grab(n) {
    var cv = el('cv');
    var d = document.createElement('div');
    d.id = 'img' + n; d.style.display = 'none';
    d.textContent = cv.toDataURL('image/png');
    document.body.appendChild(d);
  }
  try { SET.testCards = true; refreshPanels(); } catch (e) { errbox('设置测试版失败: ' + e.message); }
  window.requestAnimationFrame = function () { return 0; };
  try { window.cancelAnimationFrame(0); } catch (e) { }

  var step = 1000 / 60, ts = 0, started = false, armedAt = 0;
  var tick = setInterval(function () {
    for (var k = 0; k < 2; k++) {
      ts += step;
      try { window.__frame(ts); } catch (e) { errbox('frame 异常: ' + e.message); clearInterval(tick); return; }
    }
    if (!started) {
      SEL.L = 'soul_storm'; SEL.R = 'perfected_strike';
      refreshPanels();
      startMatch();
      logs.push('对局 soul_storm vs perfected_strike');
      started = true;
      return;
    }
    try {
      if (!fired && world.units && world.units.length >= 2 && world.units[0].mech
          && world.units[0].mech.onSoulDeath) {
        mech = world.units[0].mech;
        mech.onSoulDeath(150, 505); mech.onSoulDeath(150, 505); mech.onSoulDeath(150, 505);
        mech.onSoulDeath(150, 505);                 // 第 4 个 → 起飞
        fly0 = frames; fired = true;
        logs.push('t=' + world.t.toFixed(2) + 's 风暴=' + !!mech.storm + ' 发出第 4 个灵魂');
      }
      if (fired && mech.storm) {
        var d = frames - fly0;
        if (stage === 0 && d >= 10) { grab(1); logs.push('img1 d=' + d + ' 帧 bonus=' + mech.storm.bonus); stage = 1; }
        if (stage === 1 && d >= 26) { grab(2); logs.push('img2 d=' + d + ' 帧 bonus=' + mech.storm.bonus); stage = 2; }
        if (stage === 2 && d >= 44) {
          grab(3);
          logs.push('img3 d=' + d + ' 帧 bonus=' + mech.storm.bonus + ' 风眼=' + mech.storm.core.toFixed(1));
          clearInterval(tick);
          var L = document.createElement('div'); L.id = 'probelog'; L.style.display = 'none';
          L.textContent = logs.join(' | '); document.body.appendChild(L);
          return;
        }
      }
    } catch (e) { errbox('驱动异常: ' + e.message); clearInterval(tick); }
    frames++;
  }, 0);
})();
</script>
`;

const out = html.replace('</body>', probe + '\n</body>');
fs.writeFileSync(path.join(__dirname, '_wisp_probe.html'), out, 'utf8');
console.log('生成 tools/_wisp_probe.html （%.2f MB）', Buffer.byteLength(out) / 1048576);
