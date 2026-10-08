/* 用本机 Chrome（playwright-core 驱动）验收本次三处改动：
 *   ① 引导之星辉星 = 原版淡蓝 #c4edff
 *   ② 设置按钮 / 面板（BGM 21 首 + 布景 4 种）真的能开、能选、能存
 *   ③ 布景是整页背景：竞技场不铺底色、透出正后方同一张图
 * 用法：NODE_PATH=<node workspace>/node_modules node tools/_ui_check.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file:///' + path.join(ROOT, '杀戮尖塔小球对决.html').replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, '_ui');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate('window.requestAnimationFrame = function(){return 0;}');

  const R = {};

  /* ---------- ① 辉星配色 ---------- */
  R.star = await page.evaluate(`(function(){
    var tc = tintTex('sp_star_small', '#c4edff');
    if (!tc) return {err:'NO_TEX'};
    var t = document.createElement('canvas'); t.width = tc.width; t.height = tc.height;
    var g = t.getContext('2d'); g.drawImage(tc, 0, 0);
    var d = g.getImageData(0,0,t.width,t.height).data, ba = -1, best = null;
    for (var i=0;i<d.length;i+=4) if (d[i+3] > ba) { ba = d[i+3]; best=[d[i],d[i+1],d[i+2],d[i+3]]; }
    return { hex: '#' + ((1<<24)+(best[0]<<16)+(best[1]<<8)+best[2]).toString(16).slice(1),
             alpha: best[3], size: tc.width+'x'+tc.height };
  })()`);

  /* ---------- ② 设置面板 ---------- */
  await page.click('#btnSettings');
  await page.waitForTimeout(200);
  R.panel = await page.evaluate(`(function(){
    var box = document.getElementById('setBox');
    var sel = document.getElementById('setBgm');
    var groups = [];
    for (var i=0;i<sel.children.length;i++) {
      var c = sel.children[i];
      groups.push({ tag: c.tagName, label: c.label || c.textContent, n: c.children ? c.children.length : 0 });
    }
    return {
      open: document.getElementById('setMask').classList.contains('on'),
      bgmTotal: sel.children.length,
      groups: groups,
      bgButtons: [].map.call(box.querySelectorAll('#setBgGrid button'), function(b){ return b.dataset.bg + ':' + b.textContent; }),
      title: box.querySelector('h2').textContent
    };
  })()`);
  await page.screenshot({ path: path.join(OUT, 'a_设置面板.png') });

  /* 选一首 BGM（走真实的 change 事件） */
  await page.selectOption('#setBgm', 'combat_overgrowth_a');
  await page.waitForTimeout(1200);   // 等真实解码

  /* 选布景：真的点按钮 */
  await page.click('#setBgGrid button[data-bg="overgrowth"]');
  R.afterPick = await page.evaluate(`(function(){
    return {
      bgm: SET.bgm,
      bg: SET.bg,
      saved: localStorage.getItem('sts2ball.set'),
      bodyScene: document.body.classList.contains('scene'),
      sceneBgUri: (document.getElementById('sceneBg').style.backgroundImage||'').slice(0,30),
      sceneBgLen: (document.getElementById('sceneBg').style.backgroundImage||'').length,
      stageboxBg: getComputedStyle(document.querySelector('.stagebox')).backgroundColor,
      panelBg: getComputedStyle(document.querySelector('.panel')).backgroundColor,
      marked: [].filter.call(document.querySelectorAll('#setBgGrid button'),
        function(b){ return b.classList.contains('on'); }).map(function(b){return b.dataset.bg;})
    };
  })()`);

  /* ---------- BGM 真的解码 + 起播 ----------
     先把面板关掉：遮罩会把工具栏按钮的 click 挡掉（这正是弹窗该有的行为）。 */
  await page.click('#setCloseBtn');
  await page.waitForTimeout(150);
  R.panelClosed = await page.evaluate('!document.getElementById("setMask").classList.contains("on")');

  R.bgm = await page.evaluate(`(function(){
    world.running = true;
    bgmPlay();
    return { acState: AC ? AC.state : 'NO_AC', pick: bgmPickId() };
  })()`);
  await page.waitForTimeout(1500);
  R.bgmAfter = await page.evaluate(`(function(){
    return { curId: bgmCurId, decoded: Object.keys(BGM_BUF).length,
             node: !!bgmNode, loop: bgmNode ? bgmNode.loop : null,
             dur: (bgmNode && bgmNode.buffer) ? +bgmNode.buffer.duration.toFixed(2) : null,
             gain: bgmGain ? bgmGain.gain.value : null };
  })()`);
  /* 静音开关要能一起压掉音乐 */
  await page.click('#btnSound');
  R.afterSoundOff = await page.evaluate('({label: document.getElementById("btnSound").textContent, gain: bgmGain ? bgmGain.gain.value : null})');
  await page.click('#btnSound');
  R.afterSoundOn = await page.evaluate('bgmGain ? bgmGain.gain.value : null');

  /* ---------- ③ 竞技场截图（布景开 / 关 对照） ---------- */
  const shot = async (bgId, file) => {
    await page.evaluate(`(function(){
      SET.bg = ${JSON.stringify(bgId)}; applyScene();
      resetMatch(CARD_BY_ID['guiding_star'], CARD_BY_ID['dark_embrace'], 20260923);
      world.running = true;
      var base = 900000, best = 0, useF = 0, f = 0, t = 0;
      while (f < 900) {
        window.__frame(base + f * 16.6667);
        var n = 0;
        for (var i=0;i<world.effects.length;i++) {
          var e = world.effects[i];
          if (e && e.constructor && e.constructor.name === 'Star' && !e.dead && e.delay <= 0) n++;
        }
        if (n > best) { best = n; useF = f; t = world.t; }
        f++;
      }
      resetMatch(CARD_BY_ID['guiding_star'], CARD_BY_ID['dark_embrace'], 20260923);
      world.running = true;
      for (var j = 0; j <= useF; j++) window.__frame(base + j * 16.6667);
      world.running = false;
      return { t: t, stars: best };
    })()`);
    await page.waitForTimeout(250);
    const box = await page.locator('.stagebox').boundingBox();
    await page.screenshot({ path: path.join(OUT, file), clip: box });
    await page.screenshot({ path: path.join(OUT, file.replace('.png', '_整页.png')), fullPage: true });
  };
  const s1 = await page.evaluate('({t: world.t})');   // 仅占位
  R.shotOn = await page.evaluate(`(function(){ return {t: +world.t.toFixed(2)}; })()`);
  await page.evaluate(`(function(){ window.__starShot = {}; })()`);
  const info1 = await shot('overgrowth', 'b_布景_overgrowth.png');
  const info2 = await shot('none', 'c_布景_默认.png');
  R.starShotOn = info1;
  R.starShotOff = info2;

  /* ---------- ④ 原版按钮皮肤 ----------
     2026-09-23 改：底图从「九宫格 border-image」换成「整图拉伸 background-image」，
     因为九宫格的分界线在按钮上会显成"井字纹"（详见 src/game.html 那段注释）。
     所以这里检查的是 background-image / background-size，
     另外还要确认 background-color 是透明的（<button> 的 UA 默认浅灰白会从
     底图透明的圆角处露出来，看着就是"按钮有白边"）。 */
  R.btn = await page.evaluate(`(function(){
    function g(sel){
      var e = document.querySelector(sel); if (!e) return null;
      var cs = getComputedStyle(e), r = e.getBoundingClientRect();
      return { sel: sel,
               isData: (cs.backgroundImage||'').indexOf('data:image/webp') > 0,
               bgSize: cs.backgroundSize, bgColor: cs.backgroundColor,
               leftoverBorderImage: cs.borderImageSource.slice(0, 16),
               color: cs.color, font: cs.fontSize, box: Math.round(r.width)+'x'+Math.round(r.height) };
    }
    var de = getComputedStyle(document.documentElement);
    return {
      start: g('#btnStart'), pause: g('#btnPause'), sound: g('#btnSound'),
      settings: g('#btnSettings'), seg: g('.seg'), segOn: g('.seg button.on'),
      panelBgBtn: document.getElementById('setMask').classList.contains('on')
                  ? g('#setBgGrid button') : 'mask-closed',
      varRest: (de.getPropertyValue('--btn-rest')||'').slice(0,24),
      varBright: (de.getPropertyValue('--btn-bright')||'').slice(0,24)
    };
  })()`);
  const tb = await page.$('.toolbar');
  const hoverShot = async (sel, file) => {
    if (sel) await page.hover(sel); else await page.mouse.move(4, 960);
    await page.waitForTimeout(220);
    await tb.screenshot({ path: path.join(OUT, file) });
  };
  await hoverShot(null, 'd_按钮_常态.png');
  await hoverShot('#btnReset', 'd_按钮_悬停重置.png');
  await hoverShot('#btnStart', 'd_按钮_悬停开始.png');
  await page.mouse.move(4, 960);
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(OUT, 'e_整页_按钮.png'), fullPage: true });

  R.errs = errs;
  R.saveReload = await page.evaluate(`(function(){
    return JSON.parse(localStorage.getItem('sts2ball.set'));
  })()`);

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R, null, 2), 'utf8');
  console.log(JSON.stringify(R, null, 2));
})().catch(e => { console.error('FAILED', e); process.exit(1); });
