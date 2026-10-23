/* 五体投地祈祷地面法阵：截图检查（临时探针，下划线开头不被 splice 拼接）
 * 用法: NODE_PATH="C:\Users\shenl\.workbuddy\binaries\node\workspace\node_modules" \
 *        node tools/_prostrate_ellipse_shot.js <html> <out.png>
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const HTML = process.argv[2] || path.join(ROOT, '杀戮尖塔小球对决_开发者版.html');
const OUT = process.argv[3] || path.join(__dirname, '_rec', 'prostrate_after.png');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto('file:///' + path.resolve(HTML).replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate('window.requestAnimationFrame = function(){ return 0; }');

  const info = await page.evaluate(`(function(){
    resetMatch(CARD_BY_ID['prostrate'], CARD_BY_ID['dark_embrace'], 20261023);
    world.over = null; world.running = true;
    var dt = 1/120, aura = null, t0 = 0;
    for (var i = 0; i < 120*20 && !world.over; i++) {
      world.t += dt; stepPhysics(dt);
      aura = null;
      for (var k = 0; k < world.effects.length; k++) {
        var e = world.effects[k];
        if (!e.dead && e.constructor.name === 'ProstrateAura') { aura = e; break; }
      }
      if (aura) { t0 = world.t; break; }
    }
    if (!aura) return { ok:false, err:'no ProstrateAura' };
    /* 再推进 0.9s：旧版此时椭圆 rotate(world.t*0.55) 已有明显倾角，便于肉眼对比 */
    for (var j = 0; j < 0.9/dt; j++) { world.t += dt; stepPhysics(dt); }
    window.__draw();
    var c = document.getElementById('cv').getBoundingClientRect();
    return { ok:true, t: world.t, auraT: (function(){ var a=null; for (var q=0;q<world.effects.length;q++){ var e=world.effects[q]; if(!e.dead&&e.constructor.name==='ProstrateAura') a=e; } return a?+a.t.toFixed(2):null; })(),
             box: { x:c.x, y:c.y, width:c.width, height:c.height } };
  })()`);
  console.log(JSON.stringify(info));
  if (info.ok) {
    await page.screenshot({ path: OUT, clip: info.box });
    console.log('shot ' + OUT + ' errs=' + JSON.stringify(errs));
  }
  await browser.close();
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
