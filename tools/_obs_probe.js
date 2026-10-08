/* 一次性探针：为 OBS 录制选窗口尺寸。
 * 量录制模式下 canvas 的【真实像素】输出（cv.width/height 是 backing store，
 * 不是 CSS 尺寸 —— 高清录制要看的是这个），并在每个尺寸存一张截图目视确认。
 * 用法：node tools/_obs_probe.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const FILE_DEV = 'file:///' + path.join(ROOT, '杀戮尖塔小球对决_开发者版.html').replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, '_obs');

/* 候选：内窗口尺寸（innerWidth/innerHeight，不含浏览器边框）。
 * 1440p / 1600p 那两个是把窗口贴到屏幕尺寸上时的实际 inner 大小。 */
const SIZES = [
  [1280, 1300],
  [1920, 990],
  [2560, 1500],
  [1600, 1280],
  [1200, 1200],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  await page.goto(FILE_DEV, { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const rows = [];
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const r = await page.evaluate(`(function(){
      window.__intro.on = false;
      resetMatch(CARD_BY_ID['knife_trap'], CARD_BY_ID['voltaic'], 20260924);
      world.running = true;
      for (var i = 0; i < 200; i++) window.__frame(900000 + i * 16.6667);
      world.running = false;
      window.__rec.apply(true);       // 会调 fit() → 写 --rec-arena / --rec-card
      window.__draw();
      var cv = document.getElementById('cv');
      var b  = cv.getBoundingClientRect();
      var l  = document.querySelector('.sideL .bigcard').getBoundingClientRect();
      var rr = document.querySelector('.sideR .bigcard').getBoundingClientRect();
      var g  = getComputedStyle(document.querySelector('.grid'));
      return {
        inner: [innerWidth, innerHeight],
        dpr: +(window.devicePixelRatio || 1),
        backing: [cv.width, cv.height],          // ← 真正的输出像素
        css: [Math.round(b.width), Math.round(b.height)],
        arenaTop: Math.round(b.top), arenaBot: Math.round(innerHeight - b.bottom),
        arenaLeft: Math.round(b.left), arenaRight: Math.round(innerWidth - b.right),
        cardW: Math.round(l.width), cardL: Math.round(l.left),
        cardR: Math.round(innerWidth - rr.right),
        cols: g.gridTemplateColumns,
        stretched: +Math.abs(cv.width / Math.min(2, window.devicePixelRatio || 1) - b.width).toFixed(2),
      };
    })()`);
    rows.push(r);
    await page.screenshot({ path: path.join(OUT, `rec_${w}x${h}.png`) });
  }

  await page.setViewportSize({ width: 2560, height: 1500 });
  await page.waitForTimeout(150);
  await page.evaluate('window.__rec.apply(false)');
  await page.screenshot({ path: path.join(OUT, 'normal_2560x1500.png') });
  await browser.close();

  console.log('inner         | DPR | canvas backing (真实输出) | CSS 尺寸   | 上下留空 | 左右留空 | 卡面w | 拉伸');
  console.log('--------------|-----|---------------------------|------------|----------|----------|-------|-----');
  for (const r of rows) {
    console.log(
      `${String(r.inner[0]).padStart(4)}x${String(r.inner[1]).padEnd(4)} | ` +
      `${String(r.dpr).padEnd(3)} | ` +
      `${String(r.backing[0]).padStart(5)}x${String(r.backing[1]).padEnd(5)}`.padEnd(25) + ' | ' +
      `${String(r.css[0]).padStart(5)}x${String(r.css[1]).padEnd(5)}`.padEnd(10) + ' | ' +
      `${String(r.arenaTop).padStart(3)}/${String(r.arenaBot).padEnd(3)}`.padEnd(8) + ' | ' +
      `${String(r.arenaLeft).padStart(4)}/${String(r.arenaRight).padEnd(4)}`.padEnd(8) + ' | ' +
      `${String(r.cardW).padStart(5)} | ${r.stretched}`
    );
  }
  console.log('\ncols(2560 为例):', rows[rows.length - 1].cols);
  console.log('errs:', errs.length ? errs : 'none');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
