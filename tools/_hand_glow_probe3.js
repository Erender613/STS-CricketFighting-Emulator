/* 同一位置、不同冷却状态的两帧对比（临时探针）
 * 用法: NODE_PATH=... node tools/_hand_glow_probe3.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, '杀戮尖塔小球对决_开发者版.html');
const OUTDIR = path.join(__dirname, '_rec');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  await page.goto('file:///' + path.resolve(HTML).replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate('window.requestAnimationFrame = function(){ return 0; }');

  const info = await page.evaluate(`(function(){
    resetMatch(CARD_BY_ID['talk_to_the_hand'], CARD_BY_ID['dark_embrace'], 777002);
    world.over = null; world.running = true;
    var dt = 1/120;
    for (var i = 0; i < 120*8; i++) { world.t += dt; stepPhysics(dt); }
    var me = world.units[0], hands = (me.mech && me.mech.hands) || [];
    if (!hands.length) return { ok:false };
    window.__H = hands;
    /* 只留一只在固定位置；清掉粒子 */
    world.effects = [];
    var box = document.getElementById('cv').getBoundingClientRect();
    return { ok:true, n:hands.length, box:{x:box.x,y:box.y,width:box.width,height:box.height},
             sc:(document.getElementById('cv').width/660) };
  })()`);
  console.log(JSON.stringify(info));
  if (!info.ok) { await browser.close(); return; }

  async function frame(cd, out) {
    await page.evaluate(`(function(){
      var h = window.__H[0];
      h.phase = 0; h.fade = 1; h.px = 300; h.py = 300; h.pa = 0; h.cd = ${cd};
      h.state = 'idle';
      world.effects = [h];
      window.__draw();
    })()`);
    await page.screenshot({ path: path.join(OUTDIR, out), clip: info.box });
    console.log('shot ' + out);
  }
  await frame(0, 'hand_same_ready.png');
  await frame(7, 'hand_same_cool.png');
  console.log('errs=' + JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
