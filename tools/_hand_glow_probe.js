/* 以手拒之手掌：冷却中 vs 就绪 的光效对比探针（临时，下划线开头不被 splice 拼接）
 * 用法: NODE_PATH=... node tools/_hand_glow_probe.js
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

  const setup = await page.evaluate(`(function(){
    resetMatch(CARD_BY_ID['talk_to_the_hand'], CARD_BY_ID['dark_embrace'], 424242);
    world.over = null; world.running = true;
    var dt = 1/120;
    for (var i = 0; i < 120*13; i++) { world.t += dt; stepPhysics(dt); }
    var me = world.units[0], mech = me.mech, hands = (mech && mech.hands) || [];
    /* 把敌人挪远，避免手掌在测试瞬间起手——保持 idle */
    var foe = world.units[1];
    foe.x = 60; foe.y = 60; foe.dx = 0; foe.dy = 1;
    for (var k = 0; k < hands.length; k++) { hands[k].x = hands[k].px; hands[k].y = hands[k].py; }
    if (hands.length) { hands[0].cd = 0; }               // 就绪
    for (var k = 1; k < hands.length; k++) { hands[k].cd = 7; } // 冷却中
    window.__draw();
    var arr = hands.map(function(h){ return { slot: h.slot, cd: +h.cd.toFixed(2), x: +h.px.toFixed(1), y: +h.py.toFixed(1), phase: +h.phase.toFixed(2) }; });
    var c = document.getElementById('cv').getBoundingClientRect();
    return { n: hands.length, hands: arr, t: +world.t.toFixed(2),
             box: { x: c.x, y: c.y, width: c.width, height: c.height } };
  })()`);
  console.log(JSON.stringify(setup));
  if (!setup.n) { console.log('no hands'); await browser.close(); return; }

  const PX = 520;  // canvas 内部坐标 = 显示坐标（CSS 无缩放？用 box 尺寸反推）
  const scale = setup.box.width / PX;
  const shotPath = path.join(OUTDIR, 'hand_glow_mixed.png');
  await page.screenshot({ path: shotPath, clip: setup.box });
  console.log('shot ' + shotPath + ' scale=' + scale.toFixed(3) + ' errs=' + JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
