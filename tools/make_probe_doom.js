/**
 * 生成 tools/_doom_probe.html：验证「灾厄读条」的画面。
 * 抓三帧：读条刚起步（环几乎空）/ 半程 / 快满 —— 同时确认【血条已消失】、
 * 环中间是灾厄图标。
 * 用法: node tools/make_probe_doom.js && python tools/shotpng.py tools/_doom_probe.html tools/预览图 _doom
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');

const probe = `
<script>
(function () {
  var frames = 0, logs = [], vic = null, foe = null, armed = false;
  var targets = [0.45, 1.5, 2.85], ti = 0, settle = 0, WANT = targets[0];
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
  function done() {
    var L = document.createElement('div'); L.id = 'probelog'; L.style.display = 'none';
    L.textContent = logs.join(' | '); document.body.appendChild(L);
  }
  try { SET.testCards = true; refreshPanels(); } catch (e) { errbox('设置测试版失败: ' + e.message); }
  window.requestAnimationFrame = function () { return 0; };
  try { window.cancelAnimationFrame(0); } catch (e) { }

  /* 每帧把读条进度钉在 WANT，hp 与 doom 保持"追平"（= 读条中）。 */
  function pin() {
    vic.x = 330; vic.y = 330; vic.dx = 0; vic.dy = 0; vic.boost = 0;
    vic.hp = 500; vic.doom = 500; vic.doomT = WANT;
    if (foe) { foe.x = 150; foe.y = 150; foe.dx = 0; foe.dy = 0; }
  }

  var step = 1000 / 60, ts = 0, started = false;
  var tick = setInterval(function () {
    for (var k = 0; k < 2; k++) {
      ts += step;
      try { window.__frame(ts); } catch (e) { errbox('frame 异常: ' + e.message); clearInterval(tick); return; }
    }
    try {
      if (!started) {
        SEL.L = 'dark_embrace'; SEL.R = 'charge';
        refreshPanels();
        startMatch();
        log('对局 dark_embrace vs charge（只为看 HUD）');
        started = true;
        return;
      }
      if (!vic) {
        if (!world.units || world.units.length < 2) return;
        vic = world.units[0]; foe = world.units[1];
        return;
      }
      if (!armed) {
        /* 停掉两边机制：这一组帧只想看 HUD，不想被暗黑球/仆从干扰 */
        vic.mech.update = function () { };
        if (foe && foe.mech) foe.mech.update = function () { };
        armed = true;
      }
      WANT = targets[ti];
      pin();
      /* 改完 WANT 先等 4 帧（渲染用的是上一帧的状态），再抓 */
      if (++settle >= 4) {
        grab(ti + 1);
        log('读条 ' + WANT.toFixed(2) + '/3');
        ti++; settle = 0;
        if (ti >= targets.length) { done(); clearInterval(tick); return; }
      }
    } catch (e) { errbox('驱动异常: ' + e.message); clearInterval(tick); }
    frames++;
  }, 0);
})();
</script>
`;

const out = html.replace('</body>', probe + '\n</body>');
fs.writeFileSync(path.join(__dirname, '_doom_probe.html'), out, 'utf8');
console.log('生成 tools/_doom_probe.html');
