/* 手掌：冷却中/就绪 光效受控对比（临时探针）
 * 用法: NODE_PATH=... node tools/_hand_glow_probe2.js
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
    resetMatch(CARD_BY_ID['talk_to_the_hand'], CARD_BY_ID['dark_embrace'], 777001);
    world.over = null; world.running = true;
    var dt = 1/120;
    for (var i = 0; i < 120*8; i++) { world.t += dt; stepPhysics(dt); }
    var me = world.units[0], hands = (me.mech && me.mech.hands) || [];
    if (hands.length < 2) return { ok:false, n:hands.length };
    /* 敌人挪走，别让手起手；清掉所有粒子效果，避免 Spark 干扰 */
    world.units[1].x = 40; world.units[1].y = 40;
    world.effects = world.effects.filter(function(e){ return e.constructor.name === 'WatcherHand'; });
    /* 摆到空地：两只手并排 */
    var h0 = hands[0], h1 = hands[1];
    h0.phase = h1.phase = 0;
    h0.cd = 0;   h1.cd = 7;
    h0.px = 240; h0.py = 300; h0.pa = 0;
    h1.px = 400; h1.py = 300; h1.pa = 0;
    h0.sparkT = 0; h1.sparkT = 0;
    window.__draw();
    var sc = (document.getElementById('cv').width / 660);
    var box = document.getElementById('cv').getBoundingClientRect();
    return { ok:true, sc:sc, box:{x:box.x,y:box.y,width:box.width,height:box.height},
             h0:{x:240,y:300,cd:h0.cd}, h1:{x:400,y:300,cd:h1.cd} };
  })()`);
  console.log(JSON.stringify(info));
  if (!info.ok) { await browser.close(); return; }
  const shot = path.join(OUTDIR, 'hand_glow_controlled.png');
  await page.screenshot({ path: shot, clip: info.box });
  console.log('shot ' + shot + ' errs=' + JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
