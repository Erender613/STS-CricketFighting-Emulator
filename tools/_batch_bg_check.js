/* ============================================================
   开发者版「批量预演 / 空悲切补算」的真浏览器验收（**必须开有头 Chrome**）

   为什么单开一个探针：这两个问题的根因都在"浏览器对后台标签的调度"上，
   headless Chrome 里 rAF 一直满速、也不做后台节流，复现不出来 —— 只有真的
   开一个有头窗口、把页面切到后台标签才验得到。用完会自动关窗口。

   验两件事：
     ① 批量预演切到后台标签后仍在推进
        修复前实测 ≈1 局/秒（rAF 被节流），2000 局要跑半小时 → 用户看到的
        就是"预演到一半卡住"。修复后靠 MessageChannel 兜底泵，实测 ≈30 局/秒。
     ② 空悲切补算不出声、不重绘（用户报过"补算会有声音"）
        补算=后台跑数据：开工就 sfxMute=true、cx 置空（走 makeHeadless），
        算完立刻还原（画面立刻恢复重绘）。

   用法（NODE_PATH 指向 playwright-core）：
     NODE_PATH="C:\Users\shenl\.workbuddy\binaries\node\workspace\node_modules" \
       node tools/_batch_bg_check.js
   退出码：0 = 两条都过；1 = 有失败。
   ============================================================ */
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const DEV = path.join(ROOT, '杀戮尖塔小球对决_开发者版.html');
const url = 'file:///' + DEV.split(path.sep).join('/');

let fails = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  ✓ ' + label + (extra === undefined ? '' : '  → ' + extra));
  else { fails++; console.log('  ✗ ' + label + (extra === undefined ? '' : '  → ' + extra)); }
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: false,
    args: ['--allow-file-access-from-files', '--window-size=1200,820']
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 } });
  const p1 = await ctx.newPage();
  const errs = [];
  p1.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await p1.goto(url, { waitUntil: 'load', timeout: 180000 });
  await p1.waitForFunction('typeof DEV !== "undefined"', null, { timeout: 60000 });
  const p2 = await ctx.newPage();                    // 用第二个标签页把 p1 顶到后台
  await p2.setContent('<h1>另一个标签页</h1>');

  console.log('== ① 后台标签里的批量预演 ==');
  await p1.bringToFront();
  await p1.evaluate(() => {
    document.getElementById('devSlot').children[0].onclick();      // 展开面板
    document.getElementById('dCount').value = '1500';
    document.getElementById('dRun').onclick();
  });
  await p2.bringToFront();                           // p1 转后台
  await p2.waitForTimeout(500);
  const a0 = await p1.evaluate(() => DEV.done);
  await p2.waitForTimeout(3000);
  const a1 = await p1.evaluate(() => DEV.done);
  const rate = (a1 - a0) / 3;
  ok(rate > 20, '后台标签里预演照常推进', rate.toFixed(1) + ' 局/秒（修复前 ≈1 局/秒）');
  await p1.bringToFront();
  await p1.waitForFunction('DEV.running === false', null, { timeout: 300000 });
  ok(true, '后台那一批最终跑完', 'records=' + await p1.evaluate('DEV.results.length'));

  console.log('== ② 空悲切补算：不出声、不重绘 ==');
  const res = await p1.evaluate(async () => {
    const st = { played: 0, during: 0, after: 0, mute0: null, mute1: null, dirty: null };
    const AC = window.AudioContext || window.webkitAudioContext;
    const mk = AC.prototype.createBufferSource;      // 出声 = 真的 createBufferSource().start()
    AC.prototype.createBufferSource = function () {
      const s = mk.call(this);
      const start = s.start.bind(s);
      s.start = function () { st.played++; return start.apply(this, arguments); };
      return s;
    };
    const c2 = document.getElementById('cv').getContext('2d');
    const rc = c2.clearRect.bind(c2);                // 重绘 = drawArena 真的在画
    c2.clearRect = function () { st.during++; return rc.apply(this, arguments); };
    const mute = () => { try { return eval('sfxMute'); } catch (e) { return null; } };
    let box = null;
    for (const c of document.querySelectorAll('#dTags .devchk')) {
      if (c.textContent.trim() === '空悲切') box = c.querySelector('input');
    }
    if (!box) return { err: '没找到空悲切开关' };
    st.played = 0; st.during = 0;
    box.checked = true; box.onchange();              // 开工（补算）
    st.mute0 = mute();
    const t0 = Date.now();
    while (DEV.chessDirty && Date.now() - t0 < 60000) await new Promise(r => requestAnimationFrame(r));
    st.dirty = DEV.chessDirty;
    st.mute1 = mute();
    const before = st.during;
    for (let i = 0; i < 5; i++) await new Promise(r => requestAnimationFrame(r));
    st.after = st.during - before;
    st.during = before;
    return st;
  }).catch(e => ({ err: String(e) }));

  if (res.err) { ok(false, '空悲切补算用例可执行', res.err); }
  else {
    ok(res.mute0 === true, '补算一开工就静音（sfxMute=true）', 'sfxMute=' + res.mute0);
    ok(res.played === 0, '补算全程一次都没出声', res.played + ' 次');
    ok(res.during === 0, '补算全程画布没重绘（不会有假战斗在抖）', res.during + ' 次');
    ok(res.dirty === false && res.mute1 === false, '补算算完立刻解除静音', 'sfxMute=' + res.mute1);
    ok(res.after > 0, '补算收尾后画面恢复重绘', '收尾后 5 帧重绘 ' + res.after + ' 次');
  }
  ok(errs.length === 0, '全程没有页面报错', errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n' + (fails ? '✗ 失败 ' + fails + ' 项' : '✓ 全部通过'));
  process.exit(fails ? 1 : 0);
})();
