/**
 * 生成 tools/_stormbirth_probe.html：验证「风暴诞生」那 0.8 秒的画面。
 * 直接驱动 combat 世界 —— 前 3 次 onSoulDeath 在场地中心开出风暴，
 * 然后在诞生的四个时刻各截一帧（早 / 四分之一 / 半程 / 收尾）。
 * 用法: node tools/make_probe_stormbirth.js && python tools/shotpng.py tools/_stormbirth_probe.html tools/预览图 _stormbirth
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');

const probe = `
<script>
(function () {
  var frames = 0, logs = [], stage = 0, mech = null, fired = false, born0 = 0;
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
  function k() { return mech.storm ? mech.storm.bornK() : -1; }
  try { SET.testCards = true; refreshPanels(); } catch (e) { errbox('设置测试版失败: ' + e.message); }
  window.requestAnimationFrame = function () { return 0; };
  try { window.cancelAnimationFrame(0); } catch (e) { }

  var step = 1000 / 60, ts = 0, started = false;
  var tick = setInterval(function () {
    for (var j = 0; j < 2; j++) {
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
        born0 = frames; fired = true;
        logs.push('t=' + world.t.toFixed(2) + 's 风暴=' + !!mech.storm);
      }
      if (fired && mech.storm) {
        var d = frames - born0;
        if (stage === 0 && d >= 1)  { grab(1); logs.push('img1 d=' + d + ' k=' + k().toFixed(3)); stage = 1; }
        if (stage === 1 && d >= 3)  { grab(2); logs.push('img2 d=' + d + ' k=' + k().toFixed(3)); stage = 2; }
        if (stage === 2 && d >= 6)  { grab(3); logs.push('img3 d=' + d + ' k=' + k().toFixed(3)); stage = 3; }
        if (stage === 3 && d >= 12) {
          grab(4);
          logs.push('img4 d=' + d + ' k=' + k().toFixed(3));
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
fs.writeFileSync(path.join(__dirname, '_stormbirth_probe.html'), out, 'utf8');
console.log('生成 tools/_stormbirth_probe.html （%.2f MB）', Buffer.byteLength(out) / 1048576);
