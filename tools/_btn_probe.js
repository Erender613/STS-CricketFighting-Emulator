/* 诊断 + 复验：① 设置里按钮的白边 ② 按钮上的"井状"细缝 ③ 新配色
   用 4x 设备像素比截图，放大到能看清 1 设备像素。
   用法：NODE_PATH=<node workspace>/node_modules node tools/_btn_probe.js
*/
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file:///' + path.join(ROOT, '杀戮尖塔小球对决.html').replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, '_ui');

const boxOf = (page, sel) => page.evaluate(`(function(){
  var e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  var r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
})()`);

/* 用坐标裁切截图（比 locator.screenshot 可靠：它在这个页面里会卡在"稳定性检查"上，
   因为主循环的 requestAnimationFrame 被 stub 掉了） */
async function shotClip(page, sel, file, pad) {
  pad = (pad === undefined) ? 10 : pad;
  const b = await boxOf(page, sel);
  if (!b || !b.width) { console.log('SKIP(不可见) ' + sel + ' -> ' + file); return false; }
  await page.screenshot({ path: path.join(OUT, file),
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad),
            width: b.width + pad * 2, height: b.height + pad * 2 } });
  return true;
}

/* 把一个元素在"常态 / 悬停 / 按住 / 点击后"四个状态下各截一张 */
async function shots(page, sel, tag) {
  const b0 = await boxOf(page, sel);
  if (!b0) { console.log('NOT_FOUND ' + sel); return; }
  await page.mouse.move(4, 4);
  await page.waitForTimeout(220);
  await shotClip(page, sel, tag + '_1常态.png');
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.waitForTimeout(220);
  await shotClip(page, sel, tag + '_2悬停.png');
  await page.mouse.down();
  await page.waitForTimeout(200);
  await shotClip(page, sel, tag + '_3按住.png');
  await page.mouse.up();
  await page.waitForTimeout(260);
  await shotClip(page, sel, tag + '_4点击后.png');
  await page.mouse.move(4, 4);
  await page.waitForTimeout(200);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 4 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 30000 });
  await page.waitForTimeout(1300);
  await page.evaluate('window.requestAnimationFrame = function(){return 0;}');

  const R = {};

  /* ---------- A) 工具栏按钮（必须在打开设置之前 —— 遮罩会挡住它） ---------- */
  await shots(page, '#btnSound', 'A工具');

  /* ---------- B) 设置里的按钮 ---------- */
  R.beforeOpen = await page.evaluate("(function(){var m=document.getElementById('setMask');return m?m.className:'NO_MASK';})()");
  await page.click('#btnSettings');
  await page.waitForTimeout(400);
  R.afterOpen = await page.evaluate(`(function(){
    var m = document.getElementById('setMask'), g = document.getElementById('setBgGrid');
    return { maskCls: m ? m.className : 'NO_MASK',
             maskDisplay: m ? getComputedStyle(m).display : null,
             gridFound: !!g,
             gridBtns: g ? g.querySelectorAll('button').length : -1 };
  })()`);
  console.log('· 面板状态', JSON.stringify(R.afterOpen));

  R.panel = await page.evaluate(`(function(){
    var box = document.getElementById('setBox');
    var sel = document.getElementById('setBgm');
    var bg = [].map.call(box.querySelectorAll('#setBgGrid button'), function(b){ return b.textContent; });
    var opt = [].map.call(sel.querySelectorAll('option'), function(c){ return c.textContent; });
    return { bgButtons: bg, bgmCount: opt.length, bgmFirst: opt.slice(0,3),
             title: box.querySelector('h2').textContent };
  })()`);

  /* 计算样式：背景色是否已是透明 / 配色是否是黑底白字 */
  R.styles = await page.evaluate(`(function(){
    function pick(sel){
      var e = document.querySelector(sel); if (!e) return {sel:sel, err:'NOT_FOUND'};
      var c = getComputedStyle(e);
      return { sel: sel, backgroundColor: c.backgroundColor, color: c.color,
               borderImageSource: c.borderImageSource.slice(0, 24) };
    }
    var root = getComputedStyle(document.documentElement);
    var body = getComputedStyle(document.body);
    return {
      bgBtn: pick('#setBgGrid button'),
      panel: pick('#setBox'),
      toolBar: pick('.toolbar'),
      leftCard: pick('.sideL .panel'),
      vars: { txt: root.getPropertyValue('--txt').trim(),
              dim: root.getPropertyValue('--dim').trim(),
              panel: root.getPropertyValue('--panel').trim(),
              bg: root.getPropertyValue('--bg').trim() },
      bodyBg: body.backgroundColor, bodyColor: body.color
    };
  })()`);

  /* 圆角外露的是什么颜色（白边检测） */
  R.corner = await page.evaluate(`(function(){
    var b = document.querySelector('#setBgGrid button:nth-child(2)');
    var r = b.getBoundingClientRect();
    var out = [];
    [[1.2,1.2],[r.width-1.2,1.2],[1.2,r.height-1.2],[r.width-1.2,r.height-1.2]].forEach(function(p){
      var el = document.elementFromPoint(r.left+p[0], r.top+p[1]);
      out.push(el === b ? 'self' : (el ? (el.tagName+'.'+el.className) : 'null'));
    });
    return out;
  })()`);

  await shots(page, '#setBgGrid button:nth-child(2)', 'B布景');
  await shots(page, '#setCloseBtn', 'C完成');

  await page.screenshot({ path: path.join(OUT, 'f_设置面板_新配色.png') });

  R.errs = errs;
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})();
