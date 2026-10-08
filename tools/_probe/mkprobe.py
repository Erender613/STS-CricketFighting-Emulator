# -*- coding: utf-8 -*-
"""把构建产物 杀戮尖塔小球对决.html 复制一份并注入调试探针，用于无头 Chrome 截图目视验证。
用法: python tools/_probe/mkprobe.py
生成: tools/_probe/p_<mode>.html   (mode 通过 URL #hash 传入)
"""
import io
import os

ROOT = r"C:\Users\shenl\Desktop\new"
SRC = os.path.join(ROOT, "杀戮尖塔小球对决.html")
OUTDIR = os.path.join(ROOT, "tools", "_probe")

PROBE = r"""
<div id="__p" style="position:fixed;left:6px;top:6px;color:#7CFC9A;background:rgba(0,0,0,.72);
 font:11px monospace;z-index:999999;white-space:pre-wrap;padding:4px"></div>
<script>
(function () {
  var errs = [];
  window.addEventListener('error', function (e) { errs.push('ERR: ' + (e.message || e.error)); });
  var mode = (location.hash || '#hand').slice(1);
  function ui(t) {
    var d = document.getElementById('__p');
    if (d) d.textContent = t + (errs.length ? '\n@@ ' + errs.join('\n@@ ') : '\n@@ NO_JS_ERROR');
  }
  function ready() {
    return typeof IMG !== 'undefined' && IMG['card_dark_embrace'] && IMG['sp_lightning_orb']
           && IMG['sp_demon_hand'];
  }
  function stop() { world.running = false; }
  function clearWorld() { world.units = []; world.effects = []; world.nums = []; world.over = null; }
  /* 粒子不是 manual，按引擎的规矩在这里单独 update
     （探针里不敢用 stepPhysics，那会把单位也一起推进）。hand / zoom 两个模式都要用，
     所以放在这个共用作用域里 —— 放进某个分支里另一个分支会 undefined。 */
  function tickParticles(dt) {
    for (var i = 0; i < world.effects.length; i++) {
      var e = world.effects[i];
      if (!e.dead && !e.manual) e.update(dt);
    }
    world.effects = world.effects.filter(function (e) { return !e.dead; });
  }

  var n = 0;
  var iv = setInterval(function () {
    n++;
    if (!ready() && n < 100) return;
    clearInterval(iv);
    try { build(); } catch (e) { errs.push('BUILD: ' + (e && e.message ? e.message : e)); }
    ui('mode=' + mode + ' t=' + world.t.toFixed(2) + ' effects=' + world.effects.length +
       ' units=' + world.units.length);
  }, 50);

  function build() {
    if (mode === 'hand') {
      clearWorld();
      var A = new Unit(CARD_BY_ID['dark_embrace'], 0);
      var B = new Unit(CARD_BY_ID['end_of_days'], 1);
      A.x = 330; A.y = 52; A.dx = 1; A.dy = 0;
      B.x = 520; B.y = 470;
      world.units.push(A, B);
      function hand(x, y, nx, ny, len, grabbing) {
        var p = A.card.p;
        var maxLen = nx > 0 ? CFG.AW - x : nx < 0 ? x : ny > 0 ? CFG.AH - y : y;
        var h = new DemonHand(A, x, y, nx, ny, maxLen, p);
        h.state = grabbing ? 'back' : 'out';
        h.age = 1.0;                       // 入场回弹已经结束
        h.drawUnder = true;
        if (grabbing) { h.backLen0 = len + 1; h.grab = B; }   // grab 设上 → 不算"退场"，粒子照撒
        world.effects.push(h);
        return h;
      }
      var HANDS = [
        [hand(3, 150, 1, 0, 430, false), 430],     // 左墙：长距离完全伸出（腕口已远离墙 → 一长条余烬）
        [hand(150, 3, 0, 1, 330, false), 330],     // 顶墙：中距离（躲开左上那张卡，不然颗粒被卡面盖住）
        [hand(657, 300, -1, 0, 330, true), 330],   // 右墙：抓住对手往回拖
        [hand(3, 560, 1, 0, 118, false), 118]      // 左墙：刚探出（断口还在墙里 → 不冒粒子）
      ];
      /* 四只手【一起】从洞里往外长：每只都留下一条"断口喷出来的余烬"轨迹。
         用 90 帧走完，手腕移动速度才跟真实 handSpeed 同量级，轨迹不会挤成一坨。
         （DemonHand 是 manual，update 得自己调；粒子不是 manual，单独 tick。） */
      for (var s = 1; s <= 90; s++) {
        HANDS.forEach(function (o) { o[0].len = o[1] * s / 90; o[0].emitDust(1 / 60); });
        tickParticles(1 / 60);
      }
      /* 再原地多撒 6 帧：让每只手的断口当下都有一簇"新鲜"粒子（真实里手停住也就 0.1s） */
      for (var s2 = 0; s2 < 6; s2++) {
        HANDS.forEach(function (o) { o[0].emitDust(1 / 60); });
        tickParticles(1 / 60);
      }
      HANDS.forEach(function (o) { o[0].len = o[1]; });
      stop();
      /* 关键：无头 Chrome 里 rAF 不一定继续推进，直接同步重画一帧再导出，
         否则拿到的是 build() 之前那一帧的旧画面（会看到默认对局的卡）。 */
      drawArena();
      drawOverlayBanner();
      try {
        var d = document.createElement('div');
        d.id = 'img2'; d.style.display = 'none';
        d.textContent = document.getElementById('cv').toDataURL('image/png');
        document.body.appendChild(d);
      } catch (e2) { errs.push('EXPORT: ' + (e2 && e2.message ? e2.message : e2)); }
      var de = document.createElement('div');
      de.id = 'err';
      var info = ['NO_JS_ERROR', 'cv=' + cv.width + 'x' + cv.height + ' SCALE=' + SCALE.toFixed(3) +
                  ' AW=' + CFG.AW + ' AH=' + CFG.AH];
      world.units.forEach(function (u) { info.push('unit ' + u.imgKey + ' @ ' + u.x.toFixed(0) + ',' + u.y.toFixed(0) + ' alive=' + u.alive); });
      var motes = world.effects.filter(function (e) {
        return typeof WristMote !== 'undefined' && e instanceof WristMote;
      });
      if (motes.length) {
        var mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
        motes.forEach(function (m) {
          mnx = Math.min(mnx, m.x); mny = Math.min(mny, m.y);
          mxx = Math.max(mxx, m.x); mxy = Math.max(mxy, m.y);
        });
        info.push('motes=' + motes.length + ' bbox=' + mnx.toFixed(0) + '..' + mxx.toFixed(0) + ', ' +
                  mny.toFixed(0) + '..' + mxy.toFixed(0));
      } else info.push('motes=0');
      world.effects.forEach(function (e) {
        if (e.sx !== undefined) info.push('hand sx,sy=' + e.sx + ',' + e.sy + ' n=' + e.nx + ',' + e.ny +
          ' len=' + e.len.toFixed(0) + ' maxLen=' + e.maxLen.toFixed(0) + ' st=' + e.state + ' age=' + e.age.toFixed(2) + ' under=' + e.drawUnder);
      });
      de.textContent = errs.length ? (errs.join(' | ') + ' || ' + info.join(' ; ')) : info.join(' ; ');
      document.body.appendChild(de);
    } else if (mode === 'zoom') {      var app = document.getElementById('app');
      if (app) app.style.display = 'none';
      stop();
      var c2 = document.createElement('canvas');
      c2.width = 1100; c2.height = 1300;
      c2.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#151124;';
      document.body.appendChild(c2);
      var g = c2.getContext('2d');
      g.fillStyle = '#151124'; g.fillRect(0, 0, c2.width, c2.height);
      g.save();
      function one(x, y, len, grip, live, tag) {
        g.save(); g.translate(x, y);
        drawDemonHand(g, 0, 0, 0, len, grip, live);
        g.restore();
        g.fillStyle = '#8fe4ff'; g.font = '11px monospace';
        g.fillText(tag + '  len=' + len + ' grip=' + grip +
                   ' pop=' + live.pop.toFixed(2) + ' hole=' + live.hole.toFixed(2), x, y - 86);
      }
      var LIVE = { pop: 1, shrink: 1, alpha: 1, hole: 1, jit: 0, t: 1.2 };
      // 一行一只，覆盖：刚探出 / 半伸出 / 完全伸出 / 抓住时攥紧 / 退场淡出
      one(30, 150, 60, 0.15, { pop: 0.5, shrink: 1, alpha: 1, hole: 0.8, jit: 0, t: 0.6 }, '刚探出');
      one(30, 400, 190, 0.15, LIVE, '半伸出');
      one(30, 650, 420, 0.10, LIVE, '完全伸出(430)');
      one(620, 150, 420, 1.00, { pop: 1, shrink: 0.94, alpha: 1, hole: 1, jit: 0.12, t: 2.4 }, '攥紧+抖动');
      one(620, 400, 420, 0.00, { pop: 1, shrink: 0.72, alpha: 0.55, hole: 0.45, jit: 0, t: 3.6 }, '退场淡出');
      g.restore();

      /* ---- 腕口粒子：证明"不跟手" ----
         下面两块用的是【同一团】世界坐标粒子：上一块手完全伸出、下一块手缩回去大半。
         粒子一颗都没动，因为它们是撒在世界里自己飘的，不挂在手上。 */
      var UD = new Unit(CARD_BY_ID['dark_embrace'], 0);
      var demo = new DemonHand(UD, 150, 0, 1, 0, 600, CARD_BY_ID['dark_embrace'].p);
      demo.state = 'out'; demo.age = 1.0; demo.drawUnder = true;
      world.effects.push(demo);
      for (var s3 = 1; s3 <= 70; s3++) { demo.len = 430 * s3 / 70; demo.emitDust(1 / 60); tickParticles(1 / 60); }
      for (var s4 = 0; s4 < 10; s4++) { demo.emitDust(1 / 60); tickParticles(1 / 60); }
      function panel(oy, handLen, tag) {
        g.save(); g.translate(0, oy);
        demo.len = handLen;
        demo.draw(g);                                   // 手的世界坐标就是这块画布的坐标
        world.effects.forEach(function (m) { if (m instanceof WristMote) m.draw(g); });
        g.restore();
        g.fillStyle = '#8fe4ff'; g.font = '12px monospace';
        g.fillText(tag, 30, oy - 62);
      }
      panel(980, 430, '腕口粒子（世界坐标）：手伸出时沿路撒下的一条余烬 —— 手往哪走，它不跟');
      panel(1170, 150, '同一团粒子：手已缩回去大半（左端超出墙面的部分被 clip 掉）—— 粒子一颗都没动');
      // 关键：导出 canvas 原始位图（1:1），别用 --screenshot（会被缩放）
      var d1 = document.createElement('div');
      d1.id = 'img1'; d1.style.display = 'none';
      d1.textContent = c2.toDataURL('image/png');
      document.body.appendChild(d1);
      var de = document.createElement('div');
      de.id = 'err';
      de.textContent = errs.length ? errs.join(' | ') : 'NO_JS_ERROR';
      document.body.appendChild(de);
    } else if (mode === 'hp') {
      // 血条路径对照：左=旧实现(两个矩形叠) 中=新实现(单一轮廓) 右=新实现+垂直填充示例
      var app2 = document.getElementById('app');
      if (app2) app2.style.display = 'none';
      stop();
      var cc = document.createElement('canvas');
      cc.width = 780; cc.height = 400;
      cc.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#151124;';
      document.body.appendChild(cc);
      var hp = cc.getContext('2d');
      hp.fillStyle = '#151124'; hp.fillRect(0, 0, cc.width, cc.height);
      function crossOld(size, t) {          // 旧实现：两个独立矩形拼路径
        var s = size / 2, h = t / 2, p = new Path2D();
        addRRC(p, -s, -h, size, t, 3);
        addRRC(p, -h, -s, t, size, 3);
        return p;
      }
      function cell(px, py, path, ratio, doom, label) {
        var S = 70, t = S * 0.36, s = S / 2;
        hp.save(); hp.translate(px, py); hp.scale(2.5, 2.5);
        hp.fillStyle = 'rgba(10,8,16,.92)'; hp.fill(path);
        hp.save(); hp.clip(path);
        hp.fillStyle = '#ffffff';
        hp.fillRect(-s, -s + S * (1 - ratio), S, S * ratio);
        if (doom > 0) {
          hp.fillStyle = '#8b34d8';
          hp.fillRect(-s, -s + S * (1 - doom), S, S * doom);
        }
        hp.restore();
        hp.lineWidth = 2; hp.strokeStyle = 'rgba(240,236,255,.85)'; hp.stroke(path);
        hp.restore();
        hp.fillStyle = '#8fe4ff'; hp.font = '12px monospace'; hp.textAlign = 'center';
        hp.fillText(label, px, py + 150);
      }
      var S0 = 70, t0 = S0 * 0.36;
      cell(140, 190, crossOld(S0, t0), 1.0, 0, '旧：两个矩形 -> 中间有交叉线');
      cell(390, 190, crossPath(S0, t0), 1.0, 0, '新：单一轮廓 -> 中间空心干净');
      cell(640, 190, crossPath(S0, t0), 0.62, 0.30, '新 + 垂直填充(生命62%/灾厄30%)');
    } else if (mode === 'hud') {
      clearWorld();
      var V = CARD_BY_ID['voltaic'];
      var A = new Unit(CARD_BY_ID['dark_embrace'], 0);
      A.x = 150; A.y = 55; A.hp = Math.round(A.maxHp * 0.62); A.doom = Math.round(A.maxHp * 0.34);
      var B = new Unit(CARD_BY_ID['end_of_days'], 1);
      B.x = 505; B.y = 470; B.hp = Math.round(B.maxHp * 0.86); B.doom = Math.round(B.maxHp * 0.74);
      var C = new Unit(CARD_BY_ID['voltaic'], 0);
      C.x = 500; C.y = 56; C.hp = 186;
      world.units.push(A, C, B);
      // 一排电球正好横穿两条血条所在高度：检验血条是否还压得住
      function row(cy, x0, x1, n2) {
        for (var i = 0; i < n2; i++) {
          var o = new Orb(V.mech === 'voltaic' ? B : C, i / n2 * Math.PI * 2, V.p);
          var t = i / (n2 - 1);
          o.x = x0 + (x1 - x0) * t;
          o.y = cy + Math.sin(i * 1.9) * 9;
          o.state = 'fire'; o.launched = true; o.life = 1.2; o.spd = 620;
          o.vx = Math.cos(i) * 620; o.vy = Math.sin(i) * 620;
          world.effects.push(o);
        }
      }
      row(184, 60, 250, 8);      // A 翻转后的血条高度
      row(341, 380, 640, 10);    // B 的血条高度
      world.shake = 0;
      stop();
    } else if (mode === 'voltaic') {
      resetMatch(CARD_BY_ID['voltaic'], CARD_BY_ID['beat_into_shape']);
      world.running = true;
      var dt = 1 / 60;
      /* 跑到"至少 3 颗电球在飞"就停：正好定格在齐射中段，看得见直线弹道 */
      var flying = 0;
      for (var k = 0; k < 60 * 40; k++) {
        world.t += dt; stepPhysics(dt);
        flying = world.effects.filter(function (e) {
          return e.constructor.name === 'Orb' && e.launched && e.delay <= 0 && !e.dead;
        }).length;
        if (flying >= 3) break;
        if (world.over) break;
      }
      stop();
      var info = ['NO_JS_ERROR', 'flying=' + flying + ' t=' + world.t.toFixed(2)];
      world.effects.forEach(function (e) {
        if (e.constructor.name === 'Orb' && e.launched && !e.dead) {
          info.push('orb aim=' + e.aim.toFixed(3) + ' v=(' + e.vx.toFixed(0) + ',' + e.vy.toFixed(0) + ')');
        }
      });
      world.units.forEach(function (u) { info.push(u.imgKey + ' boost=' + u.boost.toFixed(1)); });
      var d5 = document.createElement('div');
      d5.id = 'img2'; d5.style.display = 'none';
      /* 关键：无头 Chrome 里 rAF 不推进，得同步重画一帧再导出，否则是旧画面 */
      drawArena();
      drawOverlayBanner();
      d5.textContent = document.getElementById('cv').toDataURL('image/png');
      document.body.appendChild(d5);
      var de5 = document.createElement('div');
      de5.id = 'err'; de5.textContent = errs.length ? (errs.join(' | ') + ' || ' + info.join(' ; ')) : info.join(' ; ');
      document.body.appendChild(de5);
    } else if (mode === 'swing') {
      /* 君王之剑挥砍：验两件事
         ① 走"最近的转向"（原来 179°→-179° 会倒着转 344°，现在只转 16°）
         ② 收刀不会跳 —— 挥砍期间不再自由环绕，收刀时把环绕角接到刀尾角度上 */
      var app3 = document.getElementById('app');
      if (app3) app3.style.display = 'none';
      stop();
      var c3 = document.createElement('canvas');
      c3.width = 1100; c3.height = 950;
      c3.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#151124;';
      document.body.appendChild(c3);
      var h = c3.getContext('2d');
      h.fillStyle = '#151124'; h.fillRect(0, 0, c3.width, c3.height);
      var P3 = CARD_BY_ID['beat_into_shape'].p;
      var U3 = new Unit(CARD_BY_ID['beat_into_shape'], 0);
      function step(cx, cy, k, startAng, wantAng) {
        var sw = new Sword(U3, P3);
        sw.birth = 1.0; sw.hit = true;               // birth=1 跳过出生金光；hit=true 不触发伤害
        sw.startAng = startAng;
        sw.swingArc = wrapPi(wantAng - startAng);
        sw.swing = P3.swingTime * (1 - k);            // pose() 里反推回来正好是 k
        U3.x = cx; U3.y = cy;
        sw.draw(h);
      }
      function panel(oy, startAng, wantAng, tag) {
        var ks = [0.10, 0.35, 0.62, 0.90];
        for (var s = 0; s < ks.length; s++) step(170 + s * 240, oy, ks[s], startAng, wantAng);
        var arc = wrapPi(wantAng - startAng) * 180 / Math.PI;
        LABELS.push(tag + '   这一刀扫过 ' + arc.toFixed(0) + '°   （四格 = 进度 10% / 35% / 62% / 90%）', oy - 158);
      }
      var LABELS = [];
      panel(210, 3.0, -3.0, '① 起手 172°、目标 -172°：以前会倒着甩 344°，现在只转 16°');
      panel(520, -1.2, 1.2, '② 正常一刀：137°，带渐隐残影扇面');
      panel(830, 0.40, 0.52, '③ 目标几乎就在刀尖方向：7°，不再突然甩一下');
      for (var li = 0; li < LABELS.length; li += 2) {   // 最后再画字，免得被剑盖住
        h.fillStyle = 'rgba(10,6,22,.78)'; h.fillRect(10, LABELS[li + 1] - 15, 1060, 22);
        h.fillStyle = '#8fe4ff'; h.font = '12px monospace';
        h.fillText(LABELS[li], 20, LABELS[li + 1]);
      }
      var d3 = document.createElement('div');
      d3.id = 'img1'; d3.style.display = 'none';
      d3.textContent = c3.toDataURL('image/png');
      document.body.appendChild(d3);
      var de3 = document.createElement('div');
      de3.id = 'err'; de3.textContent = errs.length ? errs.join(' | ') : 'NO_JS_ERROR';
      document.body.appendChild(de3);
    } else if (mode === 'doom') {
      resetMatch(CARD_BY_ID['end_of_days'], CARD_BY_ID['dark_embrace']);
      world.running = true;
      var dt2 = 1 / 60;
      for (var k2 = 0; k2 < 60 * 24; k2++) { world.t += dt2; stepPhysics(dt2); if (world.over) break; }
      stop();
    }
  }
})();
</script>
"""


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    html = io.open(SRC, "r", encoding="utf-8").read()
    assert "</body>" in html, "找不到 </body>"
    out = html.replace("</body>", PROBE + "\n</body>")
    for mode in ("hand", "zoom", "hp", "hud", "voltaic", "doom", "swing"):
        p = os.path.join(OUTDIR, "p_%s.html" % mode)
        io.open(p, "w", encoding="utf-8", newline="\n").write(out)
        print("生成", p)


if __name__ == "__main__":
    main()
