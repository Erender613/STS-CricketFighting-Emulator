/* 浏览器验收：录制模式（S）/ 种子按钮与右下角角标 / 开发者版水印
 * 用本机 Chrome（playwright-core 驱动）打开两份产物真跑一遍。
 * 用法：NODE_PATH="C:\Users\shenl\.workbuddy\binaries\node\workspace\node_modules" node tools/_rec_check.js
 * 截图落在 tools/_rec/。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const FILE_MAIN = 'file:///' + path.join(ROOT, '杀戮尖塔小球对决.html').replace(/\\/g, '/');
const FILE_DEV = 'file:///' + path.join(ROOT, '杀戮尖塔小球对决_开发者版.html').replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, '_rec');

/* 载入产物：等 boot 完成 → 掐掉 rAF（否则主循环会把手动摆好的帧冲掉） */
async function open(browser, url, errs) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate('window.requestAnimationFrame = function(){return 0;}');
  return page;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files']
  });
  const errs = [];
  const R = {};

  /* ---------- 录制模式"上下留空必须一致"的多尺寸扫描 ----------
     这是用户报过的一个真 bug：开发者版的版本条 #buildBadge 是 body 的子元素，
     录制模式没把它藏掉 → #app 从 y=37 开始、高 100vh，
     于是竞技场**顶部留空 53px、底部反而被切掉 21px**。
     修法是 ①录制模式隐藏 #buildBadge ②#app 钉成 position:fixed ③尺寸取舞台自身高度。
     这里对【两份产物】各扫一遍常见窗口尺寸，任何一处上下差 >1px 就算失败。 */
  const SIZES = [[1920, 1080], [1600, 900], [1440, 900], [1400, 1000], [1366, 768],
                 [1280, 800], [1280, 1024], [1200, 1000], [1100, 900]];
  const sweepGaps = async (pg) => {
    const out = [];
    for (const [w, h] of SIZES) {
      await pg.setViewportSize({ width: w, height: h });
      await pg.waitForTimeout(90);
      out.push(await pg.evaluate(`(function(){
        window.__rec.apply(true);
        var cv = document.getElementById('cv');
        var b = cv.getBoundingClientRect();
        var l = document.querySelector('.sideL .bigcard').getBoundingClientRect();
        var r = document.querySelector('.sideR .bigcard').getBoundingClientRect();
        var pl = document.querySelector('.sideL').getBoundingClientRect();
        /* 画布不能是"CSS 拉伸出来的"：属性宽度（÷DPR）必须等于量到的 CSS 宽度，
           否则竞技场会被拉伸/发虚（新的 --rec-arena 排布最怕这个） */
        var crisp = Math.abs(cv.width / Math.min(2, devicePixelRatio || 1) - b.width);
        var res = { w: innerWidth, h: innerHeight,
                    gapT: Math.round(b.top), gapB: Math.round(innerHeight - b.bottom),
                    cvW: Math.round(b.width), cvH: Math.round(b.height),
                    cardW: Math.round(l.width), cardWR: Math.round(r.width),
                    /* 竖直：卡面+中英文名这一整块相对视口中心的偏移（要 ≈0） */
                    blockCxOff: Math.round((pl.top + pl.bottom) / 2 - innerHeight / 2),
                    /* 横向：网页边缘→卡面 与 卡面→竞技场边缘 应当相等（左右各一组） */
                    gapLout: Math.round(l.left), gapLin: Math.round(b.left - l.right),
                    gapRout: Math.round(innerWidth - r.right), gapRin: Math.round(r.left - b.right),
                    crisp: +crisp.toFixed(2),
                    scrollH: document.documentElement.scrollHeight };
        window.__rec.apply(false);
        return res;
      })()`));
    }
    return out;
  };
  const gapReport = (list) => {
    let worst = 0, minGap = Infinity, badCard = 0, worstSide = 0, badBlock = 0, worstCrisp = 0;
    list.forEach(r => {
      worst = Math.max(worst, Math.abs(r.gapT - r.gapB));
      minGap = Math.min(minGap, r.gapT, r.gapB);
      if (r.cardW !== 232 || r.cardWR !== 232) badCard++;
      worstSide = Math.max(worstSide, Math.abs(r.gapLout - r.gapLin), Math.abs(r.gapRout - r.gapRin));
      if (Math.abs(r.blockCxOff) > 1) badBlock++;
      worstCrisp = Math.max(worstCrisp, r.crisp || 0);
    });
    return { worst: worst, minGap: minGap, badCard: badCard,
             cardWorstSide: worstSide, badBlock: badBlock, worstCrisp: +worstCrisp.toFixed(2) };
  };
  const checkGaps = (tag, list) => {
    const g = gapReport(list);
    if (g.worst > 1) errs.push('LAYOUT ' + tag + ': 上下留空不一致 ' + JSON.stringify(g));
    if (g.minGap < 8) errs.push('LAYOUT ' + tag + ': 留空太小 ' + JSON.stringify(g));
    if (g.badCard) errs.push('LAYOUT ' + tag + ': 两侧卡面不是 232px 宽（' + g.badCard + ' 处）');
    if (g.cardWorstSide > 1) errs.push('LAYOUT ' + tag + ': 卡面到网页边缘 / 到竞技场边缘的距离不等 '
      + JSON.stringify(list.map(r => [r.w, r.gapLout, r.gapLin, r.gapRout, r.gapRin])));
    if (g.badBlock) errs.push('LAYOUT ' + tag + ': 两侧卡牌没有竖直居中 ' +
      JSON.stringify(list.map(r => [r.w, r.blockCxOff])));
    if (g.worstCrisp > 1) errs.push('LAYOUT ' + tag + ': 画布被 CSS 拉伸了（属性尺寸≠显示尺寸）' + g.worstCrisp);
    return g;
  };

  /* ============================================================
     一、正式版：录制模式 + 种子
     ============================================================ */
  const page = await open(browser, FILE_MAIN, errs);
  /* 先把画面推进到某一帧，方便截图（水印/角标都要有内容可看） */
  const warm = `(function(){
    window.__intro.on = false;
    resetMatch(CARD_BY_ID['knife_trap'], CARD_BY_ID['voltaic'], 20260924);
    world.running = true;
    var base = 900000;
    for (var i = 0; i < 150; i++) window.__frame(base + i * 16.6667);
    world.running = false;
    return world.seed;
  })()`;
  R.seed0 = await page.evaluate(warm);

  /* ---------- 基线（普通模式）几何 ---------- */
  R.before = await page.evaluate(`(function(){
    var cv = document.getElementById('cv').getBoundingClientRect();
    var big = document.querySelector('.sideL .bigcard').getBoundingClientRect();
    return {
      rec: document.body.classList.contains('rec'),
      cv: { w: Math.round(cv.width), h: Math.round(cv.height), top: Math.round(cv.top) },
      bigW: Math.round(big.width),
      toolbar: getComputedStyle(document.querySelector('.toolbar')).display,
      thumbs: getComputedStyle(document.querySelector('.sideL .thumbs')).display,
      panelTitle: getComputedStyle(document.querySelector('.sideL h2')).display,
      panelBg: getComputedStyle(document.querySelector('.sideL')).backgroundColor,
      cname: document.querySelector('.sideL .cname').textContent,
      ctag: document.querySelector('.sideL .ctag').textContent
    };
  })()`);
  await page.screenshot({ path: path.join(OUT, '0_普通模式_整页.png'), fullPage: true });

  /* 切录制模式：探针把 rAF 掐了，改尺寸会清空画布 —— 必须手动重画一帧才看得到画面内容 */
  const pressS = async (pg) => {
    await pg.keyboard.press('s');
    await pg.waitForTimeout(200);
    await pg.evaluate('window.__draw()');
  };
  await pressS(page);
  R.after = await page.evaluate(`(function(){
    var cv = document.getElementById('cv').getBoundingClientRect();
    var big = document.querySelector('.sideL .bigcard').getBoundingClientRect();
    var bigR = document.querySelector('.sideR .bigcard').getBoundingClientRect();
    var cs = function (sel) { var e = document.querySelector(sel); return e ? getComputedStyle(e).display : 'MISSING'; };
    return {
      rec: document.body.classList.contains('rec'),
      cv: { w: Math.round(cv.width), h: Math.round(cv.height),
            top: Math.round(cv.top), left: Math.round(cv.left),
            bottom: Math.round(innerHeight - cv.bottom), right: Math.round(innerWidth - cv.right) },
      bigW: Math.round(big.width),
      bigSideR: Math.round(bigR.width),
      header: cs('header'), toolbar: cs('.toolbar'), hint: cs('.hint'),
      devSlot: cs('#devSlot'), thumbs: cs('.sideL .thumbs'), panelTitle: cs('.sideL h2'),
      panelBg: getComputedStyle(document.querySelector('.sideL')).backgroundColor,
      panelBorder: getComputedStyle(document.querySelector('.sideL')).borderTopColor,
      cname: document.querySelector('.sideL .cname').textContent,
      ctag: document.querySelector('.sideL .ctag').textContent,
      cnameShown: cs('.sideL .cname'), ctagShown: cs('.sideL .ctag'),
      scrollH: document.documentElement.scrollHeight, innerH: innerHeight
    };
  })()`);
  await page.screenshot({ path: path.join(OUT, '1_录制模式.png') });
  /* 再按一次 S 应还原 */
  await pressS(page);
  R.toggleBack = await page.evaluate(`(function(){
    var cv = document.getElementById('cv').getBoundingClientRect();
    return { rec: document.body.classList.contains('rec'), w: Math.round(cv.width),
             toolbar: getComputedStyle(document.querySelector('.toolbar')).display };
  })()`);

  /* ---------- 种子按钮：子界面 / 输入 / 开战 / 显示开关 ---------- */
  await page.click('#btnSeed');
  await page.waitForTimeout(150);
  R.seedPop = await page.evaluate(`(function(){
    var p = document.getElementById('seedPop'), r = p.getBoundingClientRect();
    return { open: p.classList.contains('on'), title: p.querySelector('.row label').textContent,
             hasInput: !!document.getElementById('seedIn'),
             hasShow: !!document.getElementById('seedShow'),
             box: { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) },
             inView: r.right <= innerWidth && r.left >= 0 };
  })()`);
  await page.screenshot({ path: path.join(OUT, '2_种子子界面.png') });

  /* 勾上「显示种子」→ 右下角角标出现 */
  await page.click('#seedShow');
  await page.waitForTimeout(120);
  await page.evaluate(`(function(){
    var t = document.getElementById('seedTag').getBoundingClientRect();
    window.__tagBox = { r: Math.round(innerWidth - t.right), b: Math.round(innerHeight - t.bottom),
                        w: Math.round(t.width), h: Math.round(t.height) };
  })()`);
  R.tag = await page.evaluate(`(function(){
    var e = document.getElementById('seedTag');
    return { on: e.classList.contains('on'), text: e.textContent, display: getComputedStyle(e).display,
             fontSize: getComputedStyle(e).fontSize, box: window.__tagBox,
             seedShownInSet: JSON.parse(localStorage.getItem('sts2ball.set') || '{}').seedShow };
  })()`);
  await page.screenshot({ path: path.join(OUT, '3_种子角标.png') });

  /* 输入种子 → 用该种子开战 */
  await page.fill('#seedIn', '1234567890');
  await page.click('#seedPlay');
  await page.waitForTimeout(200);
  R.seedPlay = await page.evaluate(`(function(){
    return { seed: world.seed, want: seedHash('1234567890'), running: world.running,
             tag: document.getElementById('seedTag').textContent,
             popOpen: document.getElementById('seedPop').classList.contains('on') };
  })()`);

  /* 录制模式时角标必须隐藏 */
  await pressS(page);
  R.tagInRec = await page.evaluate(`(function(){
    var e = document.getElementById('seedTag');
    return { rec: document.body.classList.contains('rec'), on: e.classList.contains('on'),
             display: getComputedStyle(e).display };
  })()`);
  await page.screenshot({ path: path.join(OUT, '4_录制模式_带种子隐藏.png') });
  await pressS(page);

  /* 窄屏（手机尺寸）不该进录制模式 */
  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(150);
  await pressS(page);
  R.narrow = await page.evaluate(`(function(){
    return { rec: document.body.classList.contains('rec'),
             supported: window.__rec.supported(),
             cvW: Math.round(document.getElementById('cv').getBoundingClientRect().width) };
  })()`);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.waitForTimeout(150);
  await page.evaluate('window.__draw()');
  await page.screenshot({ path: path.join(OUT, '7_普通模式_还原.png') });

  /* 多尺寸扫描：上下留空必须一致（正式版） */
  R.sweepMain = await sweepGaps(page);
  R.gapsMain = checkGaps('main', R.sweepMain);
  await page.close();

  /* ============================================================
     二、开发者版：水印
     ============================================================ */
  const dp = await open(browser, FILE_DEV, errs);
  /* 打开开发者面板 → 找到水印行 */
  await dp.click('.devbtn');
  await dp.waitForTimeout(150);
  R.devWm = await dp.evaluate(`(function(){
    var on = document.getElementById('dWmOn');
    return { panelOpen: document.querySelector('.devwrap').classList.contains('on'),
             hasInput: !!document.getElementById('dWm'),
             btnText: on.textContent, btnDisabled: on.disabled,
             tag: document.getElementById('dWm').tagName };
  })()`);
  /* 写两行文字 → 打开 → 采样竞技场正中的像素（与关掉时对比） */
  const wmShot = async (on) => {
    await dp.evaluate(`(function(){
      window.__intro.on = false;
      resetMatch(CARD_BY_ID['defy'], CARD_BY_ID['snakebite'], 777);
      var base = 900000;
      for (var i = 0; i < 120; i++) window.__frame(base + i * 16.6667);
      world.running = false;                // 停住：后面只重画，不推进物理
    })()`);
    await dp.evaluate(`(function(on){
      DEV.wmOn = !!on;
      window.__draw();
    })(${on})`);
    return await dp.evaluate(`(function(){
      var cv = document.getElementById('cv');
      var g = cv.getContext('2d');
      var cx0 = Math.round(cv.width * 0.26), cy0 = Math.round(cv.height * 0.36);
      var w = Math.round(cv.width * 0.48), h = Math.round(cv.height * 0.28);
      var d = g.getImageData(cx0, cy0, w, h).data;
      var sum = 0, n = 0, bright = 0;
      for (var i = 0; i < d.length; i += 4) { var v = (d[i] + d[i+1] + d[i+2]) / 3; sum += v; n++; if (v > 60) bright++; }
      return { mean: +(sum / n).toFixed(3), bright: bright, n: n };
    })()`);
  };
  R.wmOff = await wmShot(false);
  await dp.fill('#dWm', '录制测试水印\n第二行 LINE2');
  await dp.click('#dWmOn');
  await dp.waitForTimeout(120);
  R.wmOn = await wmShot(true);
  R.wmState = await dp.evaluate(`(function(){
    var b = document.getElementById('dWmOn');
    return { on: DEV.wmOn, text: DEV.wmText, btnText: b.textContent, btnDisabled: b.disabled,
             cls: b.className };
  })()`);
  await dp.screenshot({ path: path.join(OUT, '5_水印_开发者版.png') });
  /* 录制模式 + 水印：水印要留着（那是给录屏打标用的），按钮 UI 全部消失 */
  await dp.keyboard.press('s');
  await dp.waitForTimeout(200);
  await dp.evaluate('window.__draw()');  R.wmInRec = await dp.evaluate(`(function(){
    var cs = function (sel) { return getComputedStyle(document.querySelector(sel)).display; };
    return { rec: document.body.classList.contains('rec'),
             devSlot: cs('#devSlot'), toolbar: cs('.toolbar'), header: cs('header'),
             cv: Math.round(document.getElementById('cv').getBoundingClientRect().width) };
  })()`);
  await dp.screenshot({ path: path.join(OUT, '6_录制模式_水印_开发者版.png') });

  /* 结算横幅的入场演出：取四帧（起步 / 半程 / 收尾 / 完成）留档目视 */
  R.overFrames = [];
  for (const [t, nm] of [[0.10, 'a_起步'], [0.35, 'b_半程'], [0.70, 'c_收尾'], [1.30, 'd_完成']]) {
    const st = await dp.evaluate(`(function(t){
      window.__intro.on = false;
      resetMatch(CARD_BY_ID['defy'], CARD_BY_ID['snakebite'], 2468);
      runFullMatch(CARD_BY_ID['defy'], CARD_BY_ID['snakebite'], 2468);
      OVER.for = world.over; OVER.on = true; OVER.t = t;
      window.__draw();
      return { win: world.over.win, t: t,
               txt: document.querySelector('#cv') ? 'ok' : 'no' };
    })(${t})`);
    await dp.locator('.stagebox').screenshot({ path: path.join(OUT, '8_结算横幅_' + nm + '.png') });
    R.overFrames.push(st);
  }
  /* 多尺寸扫描：上下留空必须一致（开发者版 —— 就是这一份被版本条顶偏过） */
  R.sweepDev = await sweepGaps(dp);
  R.gapsDev = checkGaps('dev', R.sweepDev);
  /* 顺带留一张 1920×1080 的录制模式全景（宽屏下卡面是"带子里居中"的典型样子） */
  await dp.setViewportSize({ width: 1920, height: 1080 });
  await dp.waitForTimeout(150);
  await dp.evaluate(`(function(){
    OVER.on = false; OVER.for = null;
    window.__intro.on = false;
    resetMatch(CARD_BY_ID['knife_trap'], CARD_BY_ID['voltaic'], 20260924);
    world.running = true;
    for (var i = 0; i < 150; i++) window.__frame(900000 + i * 16.6667);
    world.running = false;
    window.__rec.apply(true);          // 会调 fit()，把 --rec-arena / --rec-card 写进去
    window.__draw();
  })()`);
  await dp.screenshot({ path: path.join(OUT, '9_录制模式_1920x1080.png') });
  R.wide = await dp.evaluate(`(function(){
    var b = document.getElementById('cv').getBoundingClientRect();
    var l = document.querySelector('.sideL .bigcard').getBoundingClientRect();
    return { arena: Math.round(b.width), gapT: Math.round(b.top),
             gapB: Math.round(innerHeight - b.bottom), cardW: Math.round(l.width),
             pageToCard: Math.round(l.left), cardToArena: Math.round(b.left - l.right) };
  })()`);
  await dp.close();

  R.errs = errs;
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R, null, 2), 'utf8');
  console.log(JSON.stringify(R, null, 2));
})().catch(e => { console.error('FAILED', e); process.exit(1); });
