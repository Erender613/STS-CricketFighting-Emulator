/**
 * 生成 tools/_probe_v5.html：在构建产物里注入一段探针脚本，
 * 让 5 张测试版新卡各打一局、在指定时刻截 canvas（toDataURL），
 * 再交给 tools/shotpng.py 用无头 Chrome 取出来。
 *
 * 截的图统一改名为 /tmp/*.png？不 —— 直接存到系统临时目录，
 * 这里写到 %TEMP%\dsh_v5\img1..3.png，再用 read_image 看。
 * 用法: node tools/make_probe_v5.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');

/* 目标帧：按卡牌列下面这张表（时刻秒, 卡牌 id, 对手 id）
   时刻都挑在"机制正在场上表现"的时候。 */
const SHOTS = [
  [12.0, 'afterimage', 'voltaic'],      // 余像：分身 + 本体
  [26.0, 'soul_storm', 'charge'],       // 灵魂风暴：风暴成形 + 灵魂
  [30.0, 'meteor_strike', 'knife_trap'] // 陨石打击：等离子球环绕 / 陨石
];

const probe = `
<script>
(function () {
  var SHOTS = ${JSON.stringify(SHOTS)};
  var results = [];
  var logs = [];
  function el(id) { return document.getElementById(id); }
  function shot(name, data) {
    var d = document.createElement('div');
    d.id = name; d.style.display = 'none'; d.textContent = data;
    document.body.appendChild(d);
  }
  function errbox(t) {
    var e = el('err');
    if (!e) { e = document.createElement('div'); e.id = 'err'; e.style.display = 'none'; document.body.appendChild(e); }
    e.textContent += t + ' | ';
  }
  try {
    // 「测试版卡牌」开关（走真实路径）
    SET.testCards = true;
    refreshPanels();
  } catch (e) { errbox('设置测试版失败: ' + e.message); }

  /* 关键：把 rAF 顶掉。游戏自己的主循环是 requestAnimationFrame(frame) 自递归的，
     不动它就会和本探针手动驱动的 __frame 抢着推进世界（同一局被推两遍，直接卡死）。
     点一下开关后 rAF 已经在跑，所以这里改成"下一帧起不再续"，靠手动驱动。 */
  window.requestAnimationFrame = function () { return 0; };
  try { window.cancelAnimationFrame(0); } catch (e) { }

  var cv = el('cv');
  if (!cv) { errbox('找不到 canvas'); }
  var si = 0, tPrev = 0;
  var raf = window.requestAnimationFrame;
  var acc = 0, started = false;
  function begin(i) {
    var s = SHOTS[i];
    SEL.L = s[1]; SEL.R = s[2];
    refreshPanels();
    startMatch();
    acc = 0; tPrev = 0; started = false;
    logs.push('对局 ' + s[1] + ' vs ' + s[2] + ' 目标 t=' + s[0]);
  }
  if (typeof startMatch !== 'function') { errbox('startMatch 不在作用域'); }

  // 用固定时间戳手动驱动主循环（无头 Chrome 的虚拟时钟会掐掉 rAF）
  var step = 1000 / 60;
  var ts = 0;
  var tick = setInterval(function () {
    for (var k = 0; k < 2; k++) {
      ts += step;
      try { window.__frame(ts); } catch (e) { errbox('frame 异常: ' + e.message); clearInterval(tick); return; }
    }
    if (!started) { started = true; si = 0; begin(0); return; }
    var want = SHOTS[si][0];
    if (world.t >= want) {
      try { shot('img' + (si + 1), cv.toDataURL('image/png')); } catch (e) { errbox('截图失败: ' + e.message); }
      logs.push('  t=' + world.t.toFixed(1) + 's 已截 img' + (si + 1) + '  A=' + Math.round(world.units[0].hp) + ' B=' + Math.round(world.units[1].hp));
      si++;
      if (si >= SHOTS.length) {
        clearInterval(tick);
        var L = document.createElement('div'); L.id = 'probelog'; L.style.display = 'none';
        L.textContent = logs.join(' | '); document.body.appendChild(L);
        return;
      }
      begin(si);
    }
  }, 0);
})();
</script>
`;

const out = html.replace('</body>', probe + '\n</body>');
fs.writeFileSync(path.join(__dirname, '_probe_v5.html'), out, 'utf8');
console.log('生成 tools/_probe_v5.html （%.2f MB）', Buffer.byteLength(out) / 1048576);
