/* 浏览器目视验收：灾厄徽标改图标 / 召唤物（祭品召的引雷针）显示集中 / 空悲切开关
 * 用法：NODE_PATH="C:\Users\shenl\.workbuddy\binaries\node\workspace\node_modules" node tools/_hud_shot.js
 * 截图落在 tools/_rec/hud_*.png（_rec 已 gitignore）。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const FILE_DEV = 'file:///' + path.join(ROOT, '杀戮尖塔小球对决_开发者版.html').replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, '_rec');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files']
  });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto(FILE_DEV, { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate('window.requestAnimationFrame = function(){return 0;}');

  /* 摆一个能同时看到三种徽标的场面：
     · 红方：灾厄 66（末日降临的紫色徽标）+ 易伤/格挡
     · 蓝方：祭品本体 + 祭品召唤出来的引雷针（集中 7）
     · 头顶还有"灾厄"文字的旧样子做对照：把旧画法临时画一份到旁边 */
  const info = await page.evaluate(`(function(){
    resetMatch(CARD_BY_ID['dark_embrace'], CARD_BY_ID['offering'], 24680);
    world.over = null;
    var a = world.units[0], b = world.units[1];
    a.x = 200; a.y = 250; a.dx = 1; a.dy = 0; a.hp = 700; a.doom = 66; a.vuln = 3; a.block = 40;
    b.x = 460; b.y = 250; b.dx = -1; b.dy = 0; b.hp = 820; b.poison = 12;
    var rod = new SummonedFoe(b, CARD_BY_ID['lightning_rod'], 460, 470, { mHp: 360, mR: 26 });
    rod.hp = 300; rod.focus = 7; rod.dx = -1; rod.dy = 0;
    world.units.push(rod);
    window.__draw();
    return { units: world.units.length, rodFocus: rod.focus, aDoom: a.doom,
             rods: world.units.map(function(u){ return { id: u.card.id, minion: !!u.minion, focus: u.focus, doom: u.doom }; }) };
  })()`);
  console.log(JSON.stringify(info));

  const box = await page.evaluate(`(function(){
    var r = document.getElementById('cv').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  await page.screenshot({ path: path.join(OUT, 'hud_badges.png'), clip: box });
  console.log('shot', JSON.stringify(box));

  /* 空悲切：开发者面板里那一项开关的样子 */
  await page.evaluate(`(function(){
    document.querySelector('#devSlot .devbtn').click();
    var chips = document.querySelectorAll('#dTags .devchk');
    for (var i = 0; i < chips.length; i++) {
      if (/空悲切/.test(chips[i].textContent)) {
        var box = chips[i].querySelector('input');
        box.checked = true; box.onchange();
        chips[i].scrollIntoView({ block: 'center' });
      }
    }
  })()`);
  await page.waitForTimeout(300);
  const pbox = await page.evaluate(`(function(){
    var r = document.querySelector('#devSlot .devwrap').getBoundingClientRect();
    return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 };
  })()`);
  await page.screenshot({ path: path.join(OUT, 'hud_devpanel.png'), clip: pbox });
  console.log('shot2', JSON.stringify(pbox));
  console.log('errs=' + JSON.stringify(errs));
  await browser.close();
})();
