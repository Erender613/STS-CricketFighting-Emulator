# -*- coding: utf-8 -*-
"""
十卡战斗验收探针：选两张新卡开战 -> 同步推演 N 秒 -> 冻结并导出主画布 PNG（1:1）。
用法: python tools/make_probe_m.py
产出: tools/_probe_m.html，配合 shotpng.py 截图。
"""
import io
import os

ROOT = r"C:\Users\shenl\Desktop\new"
SRC = os.path.join(ROOT, "杀戮尖塔小球对决.html")
OUT = os.path.join(ROOT, "tools", "_probe_m.html")

PROBE = r"""
<div id="err" style="position:fixed;left:4px;top:2px;color:#7CFC9A;background:rgba(0,0,0,.8);
  font:10px monospace;z-index:99999;white-space:pre-wrap;max-width:900px"></div>
<script>
window.__ERRS__ = [];
window.addEventListener('error', function(e){ window.__ERRS__.push('ERR: ' + (e.message||e.error)); });
window.addEventListener('unhandledrejection', function(e){ window.__ERRS__.push('REJ: ' + e.reason); });

function probeM(){
  var info = [];
  try {
    var L = (location.hash.match(/L=(\w+)/) || [,'sleight_of_flesh'])[1];
    var R = (location.hash.match(/R=(\w+)/) || [,'darkness'])[1];
    var SEC = parseFloat((location.hash.match(/S=([\d.]+)/) || [,'18'])[1]);
    SEL.L = L; SEL.R = R;
    resetMatch(CARD_BY_ID[L], CARD_BY_ID[R]);
    world.running = true;
    var dt = 1/60;
    for (var i = 0; i < SEC * 60; i++) { world.t += dt; stepPhysics(dt); if (world.over) break; }
    info.push('L=' + L + ' R=' + R + ' sim=' + world.t.toFixed(1) + 's'
      + ' hpL=' + Math.round(world.units[0].hp) + ' hpR=' + Math.round(world.units[1].hp)
      + ' over=' + JSON.stringify(world.over));
    drawArena(); drawOverlayBanner();
    var d = document.createElement('div');
    d.id = 'img1';
    d.style.display = 'none';
    d.textContent = cv.toDataURL('image/png');
    document.body.appendChild(d);
  } catch (e) { info.push('EXC: ' + (e && e.message)); }
  document.getElementById('err').textContent = info.join('\n') + '\n' + window.__ERRS__.join('\n');
}
setTimeout(probeM, 600);
</script>
"""


def main():
    html = io.open(SRC, encoding="utf-8").read()
    html = html.replace("</body>", PROBE + "</body>")
    io.open(OUT, "w", encoding="utf-8").write(html)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
