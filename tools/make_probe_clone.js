/**
 * 生成 tools/_afterimage_probe.html：验证「余像分身 15 秒读条圆环 + 斩击线」的画面。
 * 直接驱动 combat 世界 —— 让余像先分出分身，抓三帧：
 *   img1：计时刚起步（圆环几乎空）
 *   img2：计到一半（圆环半圈）
 *   img3：计时跑满 → 分身消散、白线沿「分身 → 敌方本体」贯穿场地
 * 每帧把双方钉在固定坐标（并把速度清零），坐标是"渲染前"就位，抓帧才准。
 * 用法: node tools/make_probe_clone.js && python tools/shotpng.py tools/_afterimage_probe.html tools/预览图 _clone
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');

const probe = `
<script>
(function () {
  var frames = 0, logs = [], stageA = 0, stageB = 0, clone = null, ai = null, foe = null;
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
  function log(t) { logs.push(t); }
  function pin(u, x, y) { if (u) { u.x = x; u.y = y; u.dx = 0; u.dy = 0; u.boost = 0; u.speed = 0; } }
  try { SET.testCards = true; refreshPanels(); } catch (e) { errbox('设置测试版失败: ' + e.message); }
  window.requestAnimationFrame = function () { return 0; };
  try { window.cancelAnimationFrame(0); } catch (e) { }

  var step = 1000 / 60, ts = 0, started = false, done = false;
  var tick = setInterval(function () {
    for (var k = 0; k < 2; k++) {
      ts += step;
      try { window.__frame(ts); } catch (e) { errbox('frame 异常: ' + e.message); clearInterval(tick); return; }
    }
    if (done) return;
    try {
      if (!started) {
        SEL.L = 'afterimage'; SEL.R = 'dark_embrace';
        refreshPanels();
        startMatch();
        log('对局 afterimage vs dark_embrace');
        started = true;
        return;
      }
      if (!ai) {
        ai = null;
        for (var i = 0; i < world.units.length; i++) {
          var u = world.units[i];
          if (u && u.mech && typeof u.mech.spawn === 'function' && u.card && u.card.id === 'afterimage') ai = u;
        }
        foe = null;
        for (var j = 0; j < world.units.length; j++) if (world.units[j] !== ai && !world.units[j].minion) foe = foe || world.units[j];
        if (ai) log('本体=' + ai.card.id + ' 敌方本体=' + (foe && foe.card.id));
      }
      if (!ai || !foe) return;
      clone = ai.mech.clone;
      /* 钉住位形：分身左下、敌方本体右上 → 斩击线是一条明显的斜线 */
      pin(foe, 500, 150);
      if (clone && !clone.dying && !clone.cDispersed) pin(clone, 140, 470);

      if (stageA === 0 && clone && clone.idle >= 1.0) {
        pin(clone, 140, 470);
        grab(1); log('t=' + world.t.toFixed(2) + ' idle=' + clone.idle.toFixed(2) + ' 环=' + (clone.idle / clone.idleMax).toFixed(2));
        stageA = 1;
      } else if (stageA === 1 && clone && clone.idle >= 7.5) {
        clone.idle = 7.5;
        pin(clone, 140, 470);
        grab(2); log('idle=7.50 环=0.50');
        stageA = 2;
      } else if (stageA === 2 && clone && !clone.cDispersed) {
        pin(clone, 140, 470);
        clone.idle = clone.idleMax + 1;
        stageB = frames;
        log('推满计时 → 等自动消散');
        stageA = 3;
      } else if (stageA === 3 && clone && clone.cDispersed && frames - stageB >= 2) {
        grab(3);
        log('t=' + world.t.toFixed(2) + ' 已消散，白线 ang 已定格');
        stageA = 4; done = true;
        var L = document.createElement('div'); L.id = 'probelog'; L.style.display = 'none';
        L.textContent = logs.join(' | '); document.body.appendChild(L);
        clearInterval(tick);
        return;
      }
    } catch (e) { errbox('驱动异常: ' + e.message); clearInterval(tick); }
    frames++;
  }, 0);
})();
</script>
`;

const out = html.replace('</body>', probe + '\n</body>');
fs.writeFileSync(path.join(__dirname, '_afterimage_probe.html'), out, 'utf8');
console.log('生成 tools/_afterimage_probe.html');
