"""
生成君王之剑「1:1 像素验收」探针页 v3。

为什么不用 --screenshot：无头 Chrome 的截图与页面 CSS 像素存在缩放差（截图会被缩到 ~0.6x），
量像素时对不上号。改成把 canvas.toDataURL() 塞进 DOM，dump-dom 后取出来解码成 PNG —— 完全 1:1。

导出三张：
  img1  放大隔离图：K = 1.334 局部单位/px，剑身长 ≈1263px（和原版参考 ref_181254 的 1249px 基本同尺寸）
  img2  游戏内尺寸：K = 0.17，看实际观感
  img3  竞技场实景：跑 9 秒后冻结，直接导出游戏主画布
"""
import io
import os

ROOT = r"C:\Users\shenl\Desktop\new"
SRC = os.path.join(ROOT, "杀戮尖塔小球对决.html")
OUT = os.path.join(ROOT, "tools", "_probe_sb.html")

PROBE = r"""
<div id="err" style="position:fixed;left:4px;top:2px;color:#7CFC9A;background:rgba(0,0,0,.8);
  font:10px monospace;z-index:99999;white-space:pre-wrap;max-width:900px"></div>
<script>
window.__ERRS__ = [];
window.addEventListener('error', function(e){ window.__ERRS__.push('ERR: ' + (e.message||e.error)); });
window.addEventListener('unhandledrejection', function(e){ window.__ERRS__.push('REJ: ' + e.reason); });

function sbProbe(){
  var info = [];
  function save(name, cv){
    var d = document.createElement('div');
    d.id = name;
    d.style.display = 'none';
    d.textContent = cv.toDataURL('image/png');
    document.body.appendChild(d);
    info.push(name + '=' + cv.width + 'x' + cv.height);
  }
  try {
    if (!IMG['sp_sb_blade'] || !IMG['sp_sb_hilt2'] || !IMG['sp_sb_outline'] || !IMG['sp_sb_spike'])
      info.push('IMG_MISSING blade=' + !!IMG['sp_sb_blade'] + ' hilt2=' + !!IMG['sp_sb_hilt2']
              + ' outline=' + !!IMG['sp_sb_outline'] + ' spike=' + !!IMG['sp_sb_spike']);

    /* ---- img1：放大隔离，尺寸对齐原版参考 ---- */
    var a = document.createElement('canvas');
    a.width = 1760; a.height = 900;
    var ag = a.getContext('2d');
    var bg = ag.createLinearGradient(0, 0, 0, a.height);
    bg.addColorStop(0, '#2c3a24'); bg.addColorStop(1, '#1b2416');
    ag.fillStyle = bg; ag.fillRect(0, 0, a.width, a.height);
    drawSovereignBlade(ag, 440, 450, 0, 1.334 / SB.K);
    save('img1', a);
    info.push('A SB.cv=' + (SB.cv ? (SB.cv.width + 'x' + SB.cv.height) : 'null'));

    /* ---- img2：游戏内实际尺寸，铺 5 档「锻打成长」 ---- */
    var b = document.createElement('canvas');
    b.width = 1000; b.height = 300;
    var bg2 = b.getContext('2d');
    var g2 = bg2.createLinearGradient(0, 0, 0, b.height);
    g2.addColorStop(0, '#2c3a24'); g2.addColorStop(1, '#1b2416');
    bg2.fillStyle = g2; bg2.fillRect(0, 0, b.width, b.height);
    for (var m = 0; m < 3; m++) {
      var sc = 1 + m * 0.3;
      drawSovereignBlade(bg2, 90 + m * 40, 100 + m * 100, 0, sc);
    }
    save('img2', b);
    info.push('B ok');

    /* ---- img3：竞技场实景 ---- */
    SEL.L = 'beat_into_shape'; SEL.R = 'voltaic';
    resetMatch(CARD_BY_ID['beat_into_shape'], CARD_BY_ID['voltaic']);
    world.running = true;
    for (var i = 0; i < 60 * 9; i++) { world.t += 1/60; stepPhysics(1/60); }
    world.running = false; world.shake = 0;
    for (var j = 0; j < world.effects.length; j++) {
      if (world.effects[j] instanceof Sword) world.effects[j].ang = 0;
    }
    drawArena();
    save('img3', cv);
    info.push('C t=' + world.t.toFixed(2) + ' effects=' + world.effects.length + ' cv=' + cv.width);
  } catch (e) {
    info.push('EXC ' + (e && e.message) + ' @@ ' + (e && e.stack ? String(e.stack).split('\n').slice(0,3).join(' | ') : ''));
  }
  info.push(window.__ERRS__.length ? ('@@ ' + window.__ERRS__.join(' | ')) : '@@ NO_JS_ERROR');
  var d = document.getElementById('err');
  d.textContent = info.join('\n');
  try { if (parent !== self) parent.postMessage(d.textContent, '*'); } catch (e) {}
}
setTimeout(sbProbe, 1600);
</script>
"""


def main():
    html = io.open(SRC, encoding="utf-8").read()
    html = html.replace("</body>", PROBE + "\n</body>")
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(html)
    print("tools/_probe_sb.html")


if __name__ == "__main__":
    main()
