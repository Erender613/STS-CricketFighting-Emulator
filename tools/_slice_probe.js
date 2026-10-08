/* 受控实验：同一按钮、不同 border-image-slice，看"井状"分界线怎么变。
   输出一张横向拼图 tools/_ui/slice对比.png（每格一个 slice 值，4x 设备像素）。
   用法：NODE_PATH=<node workspace>/node_modules node tools/_slice_probe.js
*/
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file:///' + path.join(ROOT, '杀戮尖塔小球对决.html').replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, '_ui');

/* [标签, slice, border-image-width]
   对齐推导：九宫格的分界线之所以显形，是因为【角块】和【边块】的缩放比不同
   （源 34px 的角块 → 8px 目标 = 0.2353，而源 842px 的上边块 → 174.7px = 0.2075），
   分界处的采样相位差 2~4 个源像素；源图在那个位置正好是"高光线/黑描边"这种高对比，
   于是显出一条线。要让两个方向各自的比例一致，需要
     x: border-image-width / slice_左右 = 按钮宽 / 图宽 = 190.7/910  → slice_左右 ≈ 38
     y: border-image-width / slice_上下 = 按钮高 / 图高 =  34/196   → slice_上下 ≈ 46
*/
const CASES = [
  ['现状34', '34 fill', '8px'],
  ['新5848w10', '58 48 58 48 fill', '10px'],
  ['新5848w10.5', '58 48 58 48 fill', '10.5px'],
  ['新5244w9', '52 44 52 44 fill', '9px'],
  ['整图拉伸', null, null],          // 特殊：不用 border-image，整图铺满
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 4 });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate('window.requestAnimationFrame = function(){return 0;}');

  await page.click('#btnSettings');
  await page.waitForTimeout(350);

  /* 让按钮不带 .on（避免金色描边干扰），并把鼠标移开 */
  await page.evaluate("(function(){var bs=document.querySelectorAll('#setBgGrid button');for(var i=0;i<bs.length;i++)bs[i].classList.remove('on');})()");
  await page.mouse.move(4, 4);
  await page.waitForTimeout(200);

  const b = await page.evaluate(`(function(){
    var e = document.querySelector('#setBgGrid button:nth-child(3)');
    var r = e.getBoundingClientRect();
    return { x:r.left, y:r.top, width:r.width, height:r.height };
  })()`);
  const clip = { x: b.x - 12, y: b.y - 12, width: b.width + 24, height: b.height + 24 };
  const meta = [];

  for (const [tag, slice, width] of CASES) {
    const css = (slice === null)
      ? '.bggrid button{border-image-source:none !important;background:var(--btn-rest) center/100% 100% no-repeat !important}'
      : ('.bggrid button{border-image-slice:' + slice + ' !important;border-image-width:' + width + ' !important}');
    await page.evaluate(`(function(){
      var st = document.getElementById('__probe');
      if (!st) { st = document.createElement('style'); st.id = '__probe'; document.head.appendChild(st); }
      st.textContent = ${JSON.stringify(css)};
    })()`);
    await page.waitForTimeout(180);
    const f = path.join(OUT, 'slice_' + tag + '.png');
    await page.screenshot({ path: f, clip });
    meta.push({ tag, slice, width });
    console.log('拍 ' + tag + '  slice=' + slice + ' width=' + width);
  }

  console.log(JSON.stringify(meta));
  await browser.close();
})();
