/**
 * 系列赛 UI 浏览器走查 + 截图（视觉验收用）：
 * 打开正式版产物，把系列赛各阶段真点一遍（模式 → 角色(+天意开关) → 换牌 → 烧牌 →
 * 选牌 → 揭示 → 开战 → 比分条），再直接驱动状态截出"局间 / 结算"两屏。
 * 蓝方角色在开赛前固定为静默猎手，保证走满"换牌 → 烧牌 → 选牌"三个阶段。
 *
 * 产出 tools/预览图/series_*.png；页面报错 / 断言失败都会打出来并以退出码体现。
 *
 * 用法：NODE_PATH="C:\Users\shenl\.workbuddy\binaries\node\workspace\node_modules" \
 *       node tools/_series_shot.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
/* ⚠ 2026-10-08：系列赛只在开发者版开放，走查必须对着【开发者版】跑。 */
const PAGE = 'file:///' + path.join(ROOT, '杀戮尖塔小球对决_开发者版.html').replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(__dirname, '预览图');

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

  let fails = 0;
  const ok = (label, cond, extra) => {
    if (cond) console.log('  ✓ ' + label);
    else { fails++; console.log('  ✗ ' + label + (extra === undefined ? '' : '  → ' + extra)); }
  };
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
  /* 点击第 n 个匹配元素（同一张卡点两下 = 选中又取消，所以这里必须按序号点） */
  const clickAt = (sel, n) => page.evaluate(`(function(){
    var els = document.querySelectorAll('${sel}');
    if (els.length > ${n}) { els[${n}].click(); return true; } return false;
  })()`);

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  console.log('== 1. 入口与模式选择 ==');
  await page.click('#btnSeries');
  await page.waitForTimeout(200);
  ok('覆盖层打开', await page.evaluate(`document.getElementById('seriesMask').classList.contains('on')`));
  ok('模式屏渲染', await page.evaluate(`!!document.querySelector('#seriesBox [data-role="mode"]')`));
  await shot('series_mode.png');

  console.log('== 2. 角色选择 + 天意加身 ==');
  await clickAt('#seriesBox [data-role="mode"][data-v="pve"]', 0);
  await page.waitForTimeout(150);
  const charCards = await page.evaluate(`document.querySelectorAll('#seriesBox .charCard').length`);
  ok('角色屏有 6 张卡（5 角色 + 随机）', charCards === 6, String(charCards));
  await clickAt('#seriesBox .charCard[data-side="L"][data-cid="ironclad"]', 0);
  await page.waitForTimeout(100);
  await clickAt('#seriesBox [data-role="destinyChk"]', 0);
  ok('天意加身开关可勾选', await page.evaluate(`__series.S.destinyEnabled === true`));
  await page.evaluate(`__series.S.charSel.R = 'silent'`);   // 固定蓝方 = 静默猎手，走满三阶段
  await shot('series_char.png');
  await clickAt('#seriesBox [data-role="charGo"]', 0);
  await page.waitForTimeout(1200);          // 等逐张入场动画播完再截/断言

  console.log('== 3. 换牌阶段（静默猎手 · AI 先行） ==');
  ok('阶段顺序正确（换牌最先）',
    await page.evaluate(`__series.S.stages.join() === 'reroll,burn,pick'`));
  ok('当前在换牌阶段', await page.evaluate(`__series.S.draftStage === 'reroll'`));
  ok('阶段进度条已渲染', await page.evaluate(`document.querySelectorAll('#seriesBox .stg').length === 3`));
  ok('换牌阶段有「继续」按钮（AI 可能评估后不换牌，属合法选择）',
    await page.evaluate(`!!document.querySelector('#seriesBox [data-role="advStage"]')`));
  await shot('series_draft_reroll.png');
  await clickAt('#seriesBox [data-role="advStage"]', 0);    // 手动继续（顺带取消自动推进定时器）
  await page.waitForTimeout(200);

  console.log('== 4. 烧牌阶段（铁甲战士 · 你） ==');
  ok('换牌之后才是烧牌', await page.evaluate(`__series.S.draftStage === 'burn'`));
  ok('蓝方 3 套 × 3 张已陈列',
    await page.evaluate(`document.querySelectorAll('#seriesBox [data-role="burn"]').length === 9`));
  await shot('series_draft_burn.png');
  await clickAt('#seriesBox [data-role="burn"]', 0);
  await clickAt('#seriesBox [data-role="burn"]', 1);
  await page.waitForTimeout(120);
  ok('点选 2 张烧毁卡', await page.evaluate(`__series.S.burnSel.length === 2`));
  await clickAt('#seriesBox [data-role="burnGo"]', 0);
  await page.waitForTimeout(250);
  ok('确认后烧毁 2 张', await page.evaluate(`__series.S.burned.R.length === 2`));

  console.log('== 5. 选牌阶段 ==');
  ok('烧牌之后进入选牌', await page.evaluate(`__series.S.draftStage === 'pick'`));
  const pickable = await page.evaluate(`document.querySelectorAll('#seriesBox [data-role="pick"]').length`);
  ok('己方未烧卡都可点选',
    pickable === await page.evaluate(`9 - __series.S.burned.L.length`), String(pickable));
  await page.evaluate(`(function(){
    for (var i = 0; i < 3; i++) {
      var el = document.querySelector('#seriesBox [data-role="pick"][data-set="' + i + '"]');
      if (el) el.click();
    }
  })()`);
  await page.waitForTimeout(150);
  ok('三套各选 1 张',
    await page.evaluate(`__series.S.pickSel.L.filter(Boolean).length === 3`));
  await shot('series_draft_pick.png');
  await clickAt('#seriesBox [data-role="pickGo"]', 0);
  await page.waitForTimeout(250);

  console.log('== 6. 揭示与开战 ==');
  ok('揭示屏出现', await page.evaluate(`__series.S.screen === 'reveal'`));
  ok('双方三张出战卡都已锁定',
    await page.evaluate(`__series.S.picks.L.every(Boolean) && __series.S.picks.R.every(Boolean)`));
  await shot('series_reveal.png');
  await clickAt('#seriesBox [data-role="fight"]', 0);
  await page.waitForTimeout(3500);          // 预演(~0.3s) + 过场 + 开打
  ok('战斗进行中',
    await page.evaluate(`__series.S.screen === 'battle' && __series.world.running`));
  ok('每局种子已预演落定',
    await page.evaluate(`Number.isInteger(__series.S.battleSeeds[0])`));
  ok('比分条可见', await page.evaluate(`document.getElementById('seriesBar').classList.contains('on')`));
  await shot('series_battle.png');
  // 停掉战斗，后面的屏直接驱动状态截（真打一局要 30~120 秒）
  await page.evaluate(`__series.world.running = false; __series.world.over = null;`);

  console.log('== 7. 局间 / 结算（状态驱动） ==');
  await page.evaluate(`(function(){
    var S = __series.S;
    S.screen = 'roundend'; S.round = 1; S.score = { L: 0, R: 1 };
    S.roundWinners = [{ win: 'R', name: '追踪之刃' }];
    S.destiny = true;                       // 输了一局 → 天意激活（局间屏会提示）
    __series.render(); __series.mask(true);
  })()`);
  await page.waitForTimeout(200);
  await shot('series_roundend.png');
  await page.evaluate(`(function(){
    var S = __series.S;
    S.screen = 'end'; S.score = { L: 2, R: 1 };
    S.roundWinners = [{ win: 'R', name: '追踪之刃' }, { win: 'L', name: '劫掠' }, { win: 'L', name: '电流相生' }];
    __series.render(); __series.mask(true);
  })()`);
  await page.waitForTimeout(200);
  await shot('series_end.png');
  // 退出恢复经典
  await clickAt('#seriesBox [data-role="exit"]', 0);
  await page.waitForTimeout(300);
  ok('退出后回到经典模式', await page.evaluate(`!__series.S.on`));
  ok('退出后覆盖层关闭', await page.evaluate(`!document.getElementById('seriesMask').classList.contains('on')`));

  ok('全程无页面报错', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
  await browser.close();
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
