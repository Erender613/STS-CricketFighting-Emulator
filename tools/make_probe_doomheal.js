/**
 * 生成 tools/_doomheal_probe.html：验证「治疗打断灾厄读条」的画面。
 * 抓三帧：① 读条中（血条消失、只剩读条环） ② 治疗抬到灾厄之上（血条立刻恢复）
 *        ③ 再掉回灾厄线（读条从 0 重新开始）
 * 用法: node tools/make_probe_doomheal.js && python tools/shotpng.py tools/_doomheal_probe.html tools/预览图 _doomheal
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, '杀戮尖塔小球对决.html'), 'utf8');
const probe = `
<script>
(function () {
  var logs = [], vic = null, foe = null, armed = false, mode = 0, settle = 0;
  function el(id) { return document.getElementById(id); }
  function errbox(t) { var e = el('err'); if (!e) { e = document.createElement('div'); e.id = 'err'; e.style.display = 'none'; document.body.appendChild(e); } e.textContent += t + ' | '; }
  function grab(n) { var cv = el('cv'); var d = document.createElement('div'); d.id = 'img' + n; d.style.display = 'none'; d.textContent = cv.toDataURL('image/png'); document.body.appendChild(d); }
  function log(t) { logs.push(t); }
  function done() { var L = document.createElement('div'); L.id = 'probelog'; L.style.display = 'none'; L.textContent = logs.join(' | '); document.body.appendChild(L); }
  window.requestAnimationFrame = function () { return 0; };
  try { window.cancelAnimationFrame(0); } catch (e) { }
  function pin() { vic.x = 330; vic.y = 330; vic.dx = 0; vic.dy = 0; vic.boost = 0; if (foe) { foe.x = 150; foe.y = 150; foe.dx = 0; foe.dy = 0; } }
  var step = 1000 / 60, ts = 0, started = false;
  var tick = setInterval(function () {
    for (var k = 0; k < 2; k++) { ts += step; try { window.__frame(ts); } catch (e) { errbox('frame 异常: ' + e.message); clearInterval(tick); return; } }
    try {
      if (!started) { SEL.L = 'dark_embrace'; SEL.R = 'charge'; refreshPanels(); startMatch(); started = true; return; }
      if (!vic) { if (!world.units || world.units.length < 2) return; vic = world.units[0]; foe = world.units[1]; return; }
      if (!armed) { vic.mech.update = function () { }; if (foe && foe.mech) foe.mech.update = function () { }; armed = true; }
      pin();
      if (mode === 0) {
        vset(500, 600, 1.5);
        if (++settle >= 5) { grab(1); log('① 读条 1.50/3（血条已消失）'); mode = 1; settle = 0; }
      } else if (mode === 1) {
        /* 治疗：500 → 700 > 灾厄 600 → 读条被打断，血条恢复 */
        if (vic.hp !== 700 || vic.doomT !== 0) { vic.hp = 500; vic.doom = 600; vic.doomT = 1.5; vic.heal(200); }
        if (++settle >= 5) { grab(2); log('② 治疗到 ' + vic.hp + ' > 灾厄 ' + vic.doom + ' → 读条清零 ' + vic.doomT + '，血条恢复'); mode = 2; settle = 0; }
      } else {
        /* 再被打回灾厄线：读条从 0 重新开始 */
        if (vic.hp !== 400) { vic.hp = 400; vic.doom = 600; vic.doomT = 0.6; }
        if (++settle >= 5) { grab(3); log('③ 再掉回 ' + vic.hp + ' < 灾厄 ' + vic.doom + ' → 读条从 0 重来（' + vic.doomT.toFixed(2) + '）'); done(); clearInterval(tick); }
      }
    } catch (e) { errbox('驱动异常: ' + e.message); clearInterval(tick); }
  }, 0);
  function vset(hp, doom, t) { vic.hp = hp; vic.doom = doom; vic.doomT = t; }
})();
</script>
`;
fs.writeFileSync(path.join(__dirname, '_doomheal_probe.html'), html.replace('</body>', probe + '\n</body>'), 'utf8');
console.log('生成 tools/_doomheal_probe.html');
