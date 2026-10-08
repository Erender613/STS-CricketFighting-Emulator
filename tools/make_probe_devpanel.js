/**
 * 生成 tools/_devpanel_probe.html：跑几局预演、展开开发者面板 + 选一个排序指标，
 * 交给 chrome --screenshot 拍（表格列 / 排序下拉的排版验收）。
 * 用法: node tools/make_probe_devpanel.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, '杀戮尖塔小球对决_开发者版.html'), 'utf8');
const probe = `
<script>
(function () {
  var started = false, opened = false;
  window.requestAnimationFrame = function () { return 0; };
  try { window.cancelAnimationFrame(0); } catch (e) { }
  var step = 1000 / 60, ts = 0;
  var tick = setInterval(function () {
    for (var k = 0; k < 3; k++) { ts += step; try { window.__frame(ts); } catch (e) {} }
    if (!started) {
      document.getElementById('dCount').value = '8';
      document.getElementById('devSlot').children[0].onclick();   // 打开面板
      document.getElementById('dRun').onclick();
      started = true; opened = true;
      return;
    }
    if (DEV.results.length >= 4) {
      var sel = document.getElementById('dSort');
      sel.value = 'winHp'; sel.onchange();
      var L = document.createElement('div'); L.id = 'probelog'; L.style.display = 'none';
      L.textContent = 'rows=' + DEV.results.length; document.body.appendChild(L);
      clearInterval(tick);
    }
  }, 0);
})();
</script>
`;
fs.writeFileSync(path.join(__dirname, '_devpanel_probe.html'), html.replace('</body>', probe + '\n</body>'), 'utf8');
console.log('生成 tools/_devpanel_probe.html');
