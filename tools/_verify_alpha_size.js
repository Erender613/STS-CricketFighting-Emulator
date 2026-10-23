/* ============================================================================
 * 独立验收脚本：观者「阿尔法」的贝塔/欧米伽 token 改动
 *   1) 贝塔/欧米伽尺寸：minion 0.8 × sizeMul 0.8 (≈0.64) → 只剩 minion 0.8（=仆从一样大）
 *   2) 取消 ghost：与敌方/友方都做圆-圆物理碰撞
 *   3) omegaWaveR 180 → 220
 *   4) omegaMax 4 → 3
 *
 * 用法：
 *   NODE_PATH="C:\Users\shenl\.workbuddy\binaries\node\workspace\node_modules" \
 *     node tools/_verify_alpha_size.js before    # 基线：读 tools/_rec/before_dev.html
 *   ... node tools/_verify_alpha_size.js after     # 复测：读当前构建产物
 *
 * 首次以 before 运行时会把当前构建产物复制成 tools/_rec/before_dev.html 留档
 * （已存在则不覆盖，保证基线永远是"改动前"那一份）。
 * 输出：tools/_rec/alpha_size_before.png / alpha_size_after.png
 *       tools/_rec/alpha_size_before.json / alpha_size_after.json
 * 不修改任何游戏源码/构建产物。
 * ==========================================================================*/
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '_rec');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const LIVE = path.join(ROOT, '杀戮尖塔小球对决_开发者版.html');
const SNAP = path.join(OUT, 'before_dev.html');
const TAG = (process.argv[2] || 'before').toLowerCase();
const SHOT = path.join(OUT, 'alpha_size_' + TAG + '.png');
const JSONOUT = path.join(OUT, 'alpha_size_' + TAG + '.json');

fs.mkdirSync(OUT, { recursive: true });
if (TAG === 'before') {
  if (!fs.existsSync(SNAP)) {
    fs.copyFileSync(LIVE, SNAP);
    console.log('[snapshot] 已复制改动前构建产物 -> ' + SNAP);
  } else {
    console.log('[snapshot] 基线留档已存在，保持不动: ' + SNAP);
  }
}
const TARGET = TAG === 'before' ? SNAP : LIVE;
const FILE = 'file:///' + TARGET.replace(/\\/g, '/');
console.log('[target] ' + TARGET);

const ev = s => s; // 可读性占位

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files']
  });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto(FILE, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('typeof window.__frame === "function"', null, { timeout: 180000 });
  /* 等所有卡面图（含 card_beta / card_omega）真正解码完，否则 drawImage 的尺寸没有意义 */
  await page.waitForFunction(
    'typeof IMG !== "undefined" && IMG["card_alpha"] && IMG["card_beta"] && IMG["card_omega"]' +
    ' && IMG["card_charge"] && IMG["card_lightning_rod"] && IMG["card_alpha"].naturalWidth > 0',
    null, { timeout: 180000 });
  /* 冻结 rAF：后面一律手动 __draw() 出帧 */
  await page.evaluate('window.requestAnimationFrame = function(){return 0;}');
  await page.waitForTimeout(300);

  /* ------------------------------------------------------------------ *
   * 0. 环境探针 + drawImage 打补丁 + 度量工具
   * ------------------------------------------------------------------ */
  const probe = await page.evaluate(ev(`(function(){
    var names = ['resetMatch','CARD_BY_ID','world','CFG','IMG','stepPhysics',
                 'drawArena','drawUnitHUD','BetaUnit','OmegaUnit','SummonedFoe','Minion','Unit'];
    var visible = {};
    for (var i = 0; i < names.length; i++) {
      try { visible[names[i]] = (typeof eval(names[i])); } catch (e) { visible[names[i]] = 'ERR:' + e.message; }
    }
    /* 画布尺寸信息 */
    var cv = document.getElementById('cv');
    /* ---------- 给 drawImage 打补丁：记录每次调用的 {key, dw, dh} ---------- */
    if (!window.__diPatched) {
      var keyByEl = new Map();
      for (var k in IMG) if (IMG[k]) keyByEl.set(IMG[k], k);
      window.__keyByEl = keyByEl;
      var orig = CanvasRenderingContext2D.prototype.drawImage;
      window.__diLog = [];
      window.__diRec = false;
      CanvasRenderingContext2D.prototype.drawImage = function (img) {
        if (window.__diRec) {
          var a = arguments, dw = null, dh = null;
          if (a.length === 3) { dw = img.width; dh = img.height; }        // dx,dy
          else if (a.length === 5) { dw = a[3]; dh = a[4]; }              // dx,dy,dw,dh
          else if (a.length === 9) { dw = a[7]; dh = a[8]; }              // sx,sy,sw,sh,dx,dy,dw,dh
          window.__diLog.push({ key: window.__keyByEl.get(img) || null, dw: dw, dh: dh });
        }
        return orig.apply(this, arguments);
      };
      window.__diPatched = true;
    }
    /* ---------- 度量：录一帧 __draw()，按 key 归并（取最小尺寸代表单位本体） ---------- */
    window.__measure = function () {
      window.__diLog = [];
      window.__diRec = true;
      window.__draw();
      window.__diRec = false;
      var byKey = {};
      for (var i = 0; i < window.__diLog.length; i++) {
        var r = window.__diLog[i];
        if (!r.key || r.dw == null) continue;
        var o = byKey[r.key] || (byKey[r.key] = { n: 0, minDw: Infinity, minDh: Infinity, all: [] });
        o.n++;
        if (r.dw < o.minDw) { o.minDw = r.dw; o.minDh = r.dh; }
        if (o.all.length < 8) o.all.push([Math.round(r.dw * 100) / 100, Math.round(r.dh * 100) / 100]);
      }
      for (var kk in byKey) {
        var b = byKey[kk];
        if (!isFinite(b.minDw)) b.minDw = null;
        if (!isFinite(b.minDh)) b.minDh = null;
      }
      return byKey;
    };
    return { visible: visible, cardW: CFG.CARD_W, cardH: CFG.CARD_H, R: CFG.R,
             cvW: cv.width, cvH: cv.height, dpr: window.devicePixelRatio,
             imgCards: Object.keys(IMG).filter(function(k){ return k.indexOf('card_') === 0; }).sort() };
  })()`));

  const out = { tag: TAG, target: TARGET, shot: SHOT, probe: probe, errors: errs };

  /* ------------------------------------------------------------------ *
   * 1. 真实对局推进 12s：确认 beta→omega 转化会发生，并在真实场景下量尺寸
   * ------------------------------------------------------------------ */
  const sim = await page.evaluate(ev(`(function(){
    var DT = 1 / 120;
    resetMatch(CARD_BY_ID['alpha'], CARD_BY_ID['charge'], 777);
    world.over = null;
    var alpha = world.units[0], enemy = world.units[1];
    alpha.bouncePop = 0; enemy.bouncePop = 0;
    var mech = alpha.mech;
    var steps = Math.round(12 / DT), maxBeta = 0, maxOmega = 0, firstOmegaT = null;
    for (var i = 0; i < steps; i++) {
      world.t += DT;
      stepPhysics(DT);
      if (mech && mech.betas) {
        if (mech.betas.length > maxBeta) maxBeta = mech.betas.length;
        if (mech.omegas.length > maxOmega) maxOmega = mech.omegas.length;
        if (firstOmegaT === null && mech.omegas.length > 0) firstOmegaT = world.t;
      }
      if (world.over) world.over = null;   // 保持推进，不看胜负
    }
    var m = window.__measure();
    /* 存活 token 概览 */
    function alive(u) { return u.alive && !u.dying && !u.finished; }
    var betas = world.units.filter(function(u){ return alive(u) && u.imgKey === 'card_beta'; });
    var omegas = world.units.filter(function(u){ return alive(u) && u.imgKey === 'card_omega'; });
    /* 当前场上 wave 特效的 maxR */
    var waves = [];
    for (var j = 0; j < world.effects.length; j++) {
      var e = world.effects[j];
      if (e && e.maxR !== undefined && !e.dead) {
        waves.push({ cls: (e.constructor && e.constructor.name) || '?', maxR: e.maxR, spd: e.spd, t: Math.round(e.t * 1000) / 1000 });
      }
    }
    var p = CARD_BY_ID['alpha'].p;
    return {
      seed: world.seed, t: Math.round(world.t * 1000) / 1000,
      maxBeta: maxBeta, maxOmegaObserved: maxOmega, firstOmegaT: firstOmegaT === null ? null : Math.round(firstOmegaT * 1000) / 1000,
      aliveBetas: betas.length, aliveOmegas: omegas.length,
      betaGhost: betas.length ? betas[0].ghost : 'n/a',
      betaGhostKey: betas.length ? Object.prototype.hasOwnProperty.call(betas[0], 'ghost') : 'n/a',
      omegaGhost: omegas.length ? omegas[0].ghost : 'n/a',
      omegaGhostKey: omegas.length ? Object.prototype.hasOwnProperty.call(omegas[0], 'ghost') : 'n/a',
      sizes: {
        card_alpha: m['card_alpha'] || null,
        card_beta: m['card_beta'] || null,
        card_omega: m['card_omega'] || null
      },
      waves: waves,
      params: { omegaMax: p.omegaMax, omegaWaveR: p.omegaWaveR, waveSpd: p.waveSpd, betaGrow: p.betaGrow,
                betaR: p.betaR, omegaR: p.omegaR, betaHp: p.betaHp, omegaHp: p.omegaHp,
                betaMax: p.betaMax, omegaWaveCd: p.omegaWaveCd, omegaFirst: p.omegaFirst }
    };
  })()`));
  out.sim12s = sim;

  /* ------------------------------------------------------------------ *
   * 1b. 召唤演出帧：刚种下贝塔时 WAAlphaSummon 会额外画一张 card_beta 虚影
   *     （1.3×(缩小后卡面)，随后淡出）。用"最小尺寸"代表单位本体，这里验证该口径。
   * ------------------------------------------------------------------ */
  const summonFrame = await page.evaluate(ev(`(function(){
    var DT = 1 / 120;
    resetMatch(CARD_BY_ID['alpha'], CARD_BY_ID['charge'], 20261023);
    world.over = null;
    var A = world.units[0], E = world.units[1];
    A.bouncePop = 0; E.bouncePop = 0;
    /* 推进到第一颗贝塔刚召唤出来（first = 1.6s），虚影 life = 0.5s，取 t≈1.65s */
    var steps = Math.round(1.66 / DT);
    for (var i = 0; i < steps; i++) { world.t += DT; stepPhysics(DT); if (world.over) world.over = null; }
    var summons = [];
    for (var j = 0; j < world.effects.length; j++) {
      var e = world.effects[j];
      if (e && e.imgKey === 'card_beta' && !e.dead) summons.push({ cls: e.constructor && e.constructor.name, t: Math.round(e.t * 1000) / 1000, w: e.w, h: e.h });
    }
    var m = window.__measure();
    var betas = world.units.filter(function(u){ return u.alive && !u.dying && u.imgKey === 'card_beta'; });
    return {
      t: Math.round(world.t * 1000) / 1000,
      aliveBetas: betas.length,
      summonEffects: summons,
      card_beta: m['card_beta'] || null,       // all 里应能看到 1.3× 虚影 + 1.0× 本体两种尺寸
      card_alpha: m['card_alpha'] || null
    };
  })()`));
  out.summonFrame = summonFrame;

  /* ------------------------------------------------------------------ *
   * 2. 受控尺寸场景：alpha / beta / omega / 仆从 同框，量"单位本体"最小尺寸
   *    （bouncePop 归零、不推进物理 → 排除 pop / 转化动画的影响）
   * ------------------------------------------------------------------ */
  const sizeScene = await page.evaluate(ev(`(function(){
    resetMatch(CARD_BY_ID['alpha'], CARD_BY_ID['charge'], 4242);
    world.over = null;
    var A = world.units[0], E = world.units[1];
    A.x = 150; A.y = 180; A.dx = 1; A.dy = 0; A.bouncePop = 0;
    E.x = 500; E.y = 180; E.dx = -1; E.dy = 0; E.bouncePop = 0;
    var p = CARD_BY_ID['alpha'].p;
    var beta = new BetaUnit(A, p, 235, 470);
    beta.bouncePop = 0; beta.dx = 0; beta.dy = 0;
    var om = new OmegaUnit(A, p, 380, 470);
    om.bouncePop = 0; om.dx = 0; om.dy = 0;
    /* 变身缩放动画：量稳定期尺寸前把 appearT 置满（否则刚出场是 0.55 倍） */
    var ap0 = om.appearScale();
    om.appearT = om.appearDur;
    var ap1 = om.appearScale();
    /* 另造一个只读探针（不入 world.units）：起始 appearScale 应为 ≈0.55 */
    var probeOm = new OmegaUnit(A, p, -9999, -9999);
    var probeStart = probeOm.appearScale();
    probeOm.appearT = probeOm.appearDur;
    var probeEnd = probeOm.appearScale();
    var mo = new SummonedFoe(A, CARD_BY_ID['lightning_rod'], 525, 470, CARD_BY_ID['offering'].p);
    mo.bouncePop = 0; mo.dx = 0; mo.dy = 0;
    world.units.push(beta, om, mo);
    var m = window.__measure();
    function w(k) { return (m[k] && m[k].minDw != null) ? Math.round(m[k].minDw * 100) / 100 : null; }
    function h(k) { return (m[k] && m[k].minDh != null) ? Math.round(m[k].minDh * 100) / 100 : null; }
    var alphaW = w('card_alpha'), betaW = w('card_beta'), omegaW = w('card_omega'), minionW = w('card_lightning_rod');
    return {
      sizes: { alpha: alphaW, beta: betaW, omega: omegaW, minion: minionW,
               alphaH: h('card_alpha'), betaH: h('card_beta'), omegaH: h('card_omega'), minionH: h('card_lightning_rod') },
      ratios: {
        beta_over_alpha: (betaW != null && alphaW) ? Math.round(betaW / alphaW * 1000) / 1000 : null,
        omega_over_alpha: (omegaW != null && alphaW) ? Math.round(omegaW / alphaW * 1000) / 1000 : null,
        beta_over_minion: (betaW != null && minionW) ? Math.round(betaW / minionW * 1000) / 1000 : null,
        omega_over_minion: (omegaW != null && minionW) ? Math.round(omegaW / minionW * 1000) / 1000 : null
      },
      appear: {
        dur: om.appearDur,
        scaleAtBirth: probeStart, scaleAtEnd: probeEnd,
        scaleBeforeSettling: ap0          // 构造后直接读（appearT 还是 0）
      },
      unitProps: {
        beta: { minion: beta.minion, sizeMul: beta.sizeMul, hasSizeMul: Object.prototype.hasOwnProperty.call(beta, 'sizeMul'),
                ghost: beta.ghost, hasGhost: Object.prototype.hasOwnProperty.call(beta, 'ghost'),
                imgKey: beta.imgKey, rBody: beta.rBody },
        omega: { minion: om.minion, sizeMul: om.sizeMul, hasSizeMul: Object.prototype.hasOwnProperty.call(om, 'sizeMul'),
                 ghost: om.ghost, hasGhost: Object.prototype.hasOwnProperty.call(om, 'ghost'),
                 imgKey: om.imgKey, rBody: om.rBody, appearDur: om.appearDur },
        minion: { minion: mo.minion, sizeMul: mo.sizeMul, hasSizeMul: Object.prototype.hasOwnProperty.call(mo, 'sizeMul'),
                  ghost: mo.ghost, hasGhost: Object.prototype.hasOwnProperty.call(mo, 'ghost'),
                  imgKey: mo.imgKey, rBody: mo.rBody }
      },
      rawByKey: m
    };
  })()`));
  out.sizeScene = sizeScene;

  /* 用这个场景截图（先按 drawImage 度量，再补文字标签，标签不影响度量） */
  const shotInfo = await page.evaluate(ev(`(function(){
    var cx2 = document.getElementById('cv').getContext('2d');
    /* 标签画在竞技场坐标系里（drawArena 结束时 transform 是 scale(SCALE)） */
    function label(x, y, text, color) {
      cx2.save();
      cx2.font = 'bold 15px sans-serif';
      cx2.textAlign = 'center';
      cx2.lineWidth = 3.5;
      cx2.strokeStyle = 'rgba(0,0,0,.85)';
      cx2.fillStyle = color;
      cx2.strokeText(text, x, y);
      cx2.fillText(text, x, y);
      cx2.restore();
    }
    label(150, 118, 'ALPHA 1.00x', '#ffd9a0');
    label(500, 118, 'ENEMY', '#a0c8ff');
    label(235, 528, 'BETA', '#ffb0e0');
    label(380, 528, 'OMEGA', '#ffc070');
    label(525, 528, 'MINION 0.80x', '#b0ffc0');
    var r = document.getElementById('cv').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`));
  await page.screenshot({ path: SHOT, clip: shotInfo });
  out.shotInfo = shotInfo;

  /* ------------------------------------------------------------------ *
   * 3. 碰撞：同队两只贝塔 / 跨队两只贝塔 / 跨队「贝塔 × 欧米伽」
   *    重叠后应被圆-圆弹开（引擎每帧只弹一次，给 45 帧）
   * ------------------------------------------------------------------ */
  async function collideTest(mode) {
    return await page.evaluate(ev(`(function(){
      var DT = 1 / 120;
      resetMatch(CARD_BY_ID['alpha'], CARD_BY_ID['charge'], ${mode === 'same' ? 999 : (mode === 'cross' ? 1001 : 1002)});
      world.over = null;
      var A = world.units[0], E = world.units[1];
      A.x = 100; A.y = 100; A.dx = 0; A.dy = 0; A.bouncePop = 0;
      E.x = 560; E.y = 100; E.dx = 0; E.dy = 0; E.bouncePop = 0;
      var p = CARD_BY_ID['alpha'].p;
      /* 故意几乎完全重叠（留 1px 避免 d=0 的除零保护直接跳过） */
      var b1, b2;
      if ('${mode}' === 'betaOmega') {
        b1 = new BetaUnit(A, p, 300, 300);
        b2 = new OmegaUnit(E, p, 301, 300);      // 跨队：贝塔 vs 欧米伽（34 + 30 = 64）
        b2.appearT = b2.appearDur;               // 量碰撞，别夹带变身缩放
      } else {
        b1 = new BetaUnit(A, p, 300, 300);
        b2 = new BetaUnit('${mode}' === 'same' ? A : E, p, 301, 300);
      }
      [b1, b2].forEach(function (b) { b.bouncePop = 0; b.dx = 0; b.dy = 0; });
      world.units.push(b1, b2);
      var d0 = Math.hypot(b2.x - b1.x, b2.y - b1.y);
      for (var i = 0; i < 45; i++) { world.t += DT; stepPhysics(DT); if (world.over) world.over = null; }
      var d1 = Math.hypot(b2.x - b1.x, b2.y - b1.y);
      /* 引擎碰撞半径口径（与 stepPhysics 的 rOf 一致） */
      function rOf(u) { return (u.minion && u.p && u.p.mR) ? u.p.mR : (u.rBody || CFG.R); }
      var minD = rOf(b1) + rOf(b2);
      return {
        mode: '${mode}', team1: b1.team, team2: b2.team,
        kinds: [b1.imgKey, b2.imgKey],
        dist0: Math.round(d0 * 100) / 100, dist1: Math.round(d1 * 100) / 100,
        rSum: minD, ratioOfRSum: Math.round(d1 / minD * 1000) / 1000,
        ghost1: b1.ghost, ghost2: b2.ghost,
        hasGhost1: Object.prototype.hasOwnProperty.call(b1, 'ghost'),
        hasGhost2: Object.prototype.hasOwnProperty.call(b2, 'ghost'),
        rBody: [b1.rBody, b2.rBody],
        stepsRun: 45
      };
    })()`));
  }
  out.collideSameTeam = await collideTest('same');
  out.collideCrossTeam = await collideTest('cross');
  out.collideBetaOmega = await collideTest('betaOmega');

  /* ------------------------------------------------------------------ *
   * 3b. 贝塔→欧米伽转化帧：WAAlphaMorph 演出 + appearScale 0.55→1.0 + spawnCd 重读
   * ------------------------------------------------------------------ */
  const morph = await page.evaluate(ev(`(function(){
    var DT = 1 / 120;
    resetMatch(CARD_BY_ID['alpha'], CARD_BY_ID['charge'], 20261024);
    world.over = null;
    var A = world.units[0], E = world.units[1];
    A.x = 200; A.y = 200; A.dx = 0; A.dy = 0; A.bouncePop = 0;
    E.x = 560; E.y = 560; E.dx = 0; E.dy = 0; E.bouncePop = 0;
    var p = CARD_BY_ID['alpha'].p;
    var mech = A.mech;
    /* 手工种一只"熟透"的贝塔（age 刚好到 betaGrow），推进 1 帧触发转化 */
    var beta = new BetaUnit(A, p, 300, 300);
    beta.bouncePop = 0; beta.dx = 0; beta.dy = 0;
    beta.age = p.betaGrow;
    world.units.push(beta);
    mech.betas.push(beta);
    world.t += DT; stepPhysics(DT);
    var om = mech.omegas.length ? mech.omegas[mech.omegas.length - 1] : null;
    /* 转化发生的这一帧里：waGrowOmega 把 spawnCd 重置成 betaIv，随后同一帧末尾
       update 又做了一次 spawnCd -= dt → 应为 5 - dt。必须【转化后立刻】采样。 */
    var spawnCdImmediate = mech.spawnCd;
    var morphs = [], rings = [];
    for (var j = 0; j < world.effects.length; j++) {
      var e = world.effects[j];
      if (!e || e.dead) continue;
      if (e.constructor && e.constructor.name === 'WAAlphaMorph') {
        morphs.push({ cls: 'WAAlphaMorph', t: Math.round(e.t * 1000) / 1000, life: e.life,
                      w: Math.round(e.w * 100) / 100, h: Math.round(e.h * 100) / 100 });
      }
    }
    var apAtBirth = om ? om.appearScale() : null;
    var T0 = om ? om.appearT : null;
    /* 再推进 0.42s（appearDur）→ 稳定为 1.0；同时看 beta 是否已安静消失 */
    for (var i = 0; i < Math.round((om ? om.appearDur : 0.42) / DT) + 2; i++) {
      world.t += DT; stepPhysics(DT); if (world.over) world.over = null;
    }
    var apSettled = om ? om.appearScale() : null;
    var alphaW = CFG.CARD_W;
    return {
      betaGrow: p.betaGrow,
      converted: !!(beta && beta.finished && !beta.alive),
      omegaAlive: !!(om && om.alive && !om.dying),
      omegaCount: mech.omegas.length,
      morphEffects: morphs, morphCount: morphs.length,
      appearAtBirth: apAtBirth, appearTAtBirth: T0,
      appearSettled: apSettled,
      spawnCdAfterConvert: Math.round(spawnCdImmediate * 1000) / 1000,
      spawnCdNow: Math.round(mech.spawnCd * 1000) / 1000,
      betaIv: p.betaIv,
      cardW: alphaW
    };
  })()`));
  out.morph = morph;

  /* ------------------------------------------------------------------ *
   * 3c. omegaMax 行为：已有 omegaMax 只欧米伽时，熟透的贝塔【不转化】；
   *     空出一个名额后立刻转化（omegaMax=4 的旧构建这里会是 4 只才卡住）
   * ------------------------------------------------------------------ */
  const capTest = await page.evaluate(ev(`(function(){
    var DT = 1 / 120;
    resetMatch(CARD_BY_ID['alpha'], CARD_BY_ID['charge'], 20261025);
    world.over = null;
    var A = world.units[0], E = world.units[1];
    A.x = 200; A.y = 200; A.dx = 0; A.dy = 0; A.bouncePop = 0;
    E.x = 560; E.y = 560; E.dx = 0; E.dy = 0; E.bouncePop = 0;
    var p = CARD_BY_ID['alpha'].p, mech = A.mech;
    var n = p.omegaMax;                       // 当前上限
    var oms = [];
    for (var i = 0; i < n; i++) {
      var o = new OmegaUnit(A, p, 120 + i * 90, 500);
      o.appearT = o.appearDur; o.bouncePop = 0;
      world.units.push(o); mech.omegas.push(o); oms.push(o);
    }
    var beta = new BetaUnit(A, p, 300, 300);
    beta.bouncePop = 0; beta.dx = 0; beta.dy = 0; beta.age = p.betaGrow;
    world.units.push(beta); mech.betas.push(beta);
    /* 满员：推进 1 帧 → 不应转化 */
    world.t += DT; stepPhysics(DT);
    var convertedWhenFull = !!(beta.finished && !beta.alive);
    var omegasWhenFull = mech.omegas.length;
    /* 空出一个名额 → 下一帧立刻转化 */
    var drop = mech.omegas.shift();
    drop.alive = false; drop.finished = true;
    world.t += DT; stepPhysics(DT);
    var convertedAfterFree = !!(beta.finished && !beta.alive);
    var omegasAfter = mech.omegas.length;
    return { omegaMax: n, betaGrow: p.betaGrow,
             omegasWhenFull: omegasWhenFull, convertedWhenFull: convertedWhenFull,
             convertedAfterFree: convertedAfterFree, omegasAfter: omegasAfter };
  })()`));
  out.capTest = capTest;

  /* ------------------------------------------------------------------ *
   * 4. 冲击波半径：真实跑一段，抓 WAAlphaWave 的 maxR
   * ------------------------------------------------------------------ */
  const wave = await page.evaluate(ev(`(function(){
    var DT = 1 / 120;
    resetMatch(CARD_BY_ID['alpha'], CARD_BY_ID['charge'], 31337);
    world.over = null;
    var A = world.units[0], E = world.units[1];
    A.bouncePop = 0; E.bouncePop = 0;
    var mech = A.mech;
    var seen = [], maxOmega = 0, morphSeen = 0, morphFirst = null;
    for (var i = 0; i < Math.round(16 / DT); i++) {
      world.t += DT;
      stepPhysics(DT);
      if (world.over) world.over = null;
      if (mech.omegas && mech.omegas.length > maxOmega) maxOmega = mech.omegas.length;
      for (var j = 0; j < world.effects.length; j++) {
        var e = world.effects[j];
        if (e && e.maxR !== undefined && e.spd !== undefined && seen.indexOf(e) < 0) {
          seen.push(e);
          if (seen.length > 8) seen.shift();
        }
        if (e && !e.dead && e.constructor && e.constructor.name === 'WAAlphaMorph') {
          morphSeen++;
          if (!morphFirst) morphFirst = { t: Math.round(e.t * 1000) / 1000, life: e.life,
                                          w: Math.round(e.w * 100) / 100, h: Math.round(e.h * 100) / 100 };
        }
      }
    }
    var ws = seen.map(function (e) {
      return { cls: (e.constructor && e.constructor.name) || '?', maxR: e.maxR, spd: e.spd,
               life: Math.round(e.life * 1000) / 1000, dead: !!e.dead };
    });
    var p = CARD_BY_ID['alpha'].p;
    return { wavesSeen: ws, count: ws.length,
             maxRSet: ws.length ? Math.max.apply(null, ws.map(function(w){return w.maxR;})) : null,
             spdSet: ws.length ? Math.max.apply(null, ws.map(function(w){return w.spd;})) : null,
             maxOmegaObserved16s: maxOmega, morphFramesSeen: morphSeen, morphFirst: morphFirst,
             pOmegaWaveR: p.omegaWaveR, pOmegaMax: p.omegaMax, pWaveSpd: p.waveSpd,
             pOmegaHp: p.omegaHp, pOmegaWaveDmg: p.omegaWaveDmg, pBetaIv: p.betaIv, pBetaGrow: p.betaGrow,
             pBetaHp: p.betaHp, pBetaR: p.betaR, pOmegaR: p.omegaR,
             paramKeys: Object.keys(p).sort(),
             CARD_W: CFG.CARD_W, CARD_H: CFG.CARD_H };
  })()`));
  out.wave = wave;

  out.errors = errs;

  /* ------------------------------------------------------------------ *
   * 5. 汇总/判定
   * ------------------------------------------------------------------ */
  const S = sizeScene.sizes, R = sizeScene.ratios;
  const sameD = out.collideSameTeam, crossD = out.collideCrossTeam, boD = out.collideBetaOmega;
  const checks = [];
  function chk(name, ok, detail) { checks.push({ name: name, pass: !!ok, detail: detail }); }

  if (TAG === 'before') {
    chk('基线（改动前）读数已采集', true,
        'beta/alpha=' + R.beta_over_alpha + '  omega/alpha=' + R.omega_over_alpha +
        '  beta/minion=' + R.beta_over_minion);
  } else {
    const near = (v, t, tol) => v != null && Math.abs(v - t) <= tol;
    chk('beta/alpha ≈ 0.80 (±0.02)', near(R.beta_over_alpha, 0.80, 0.02), R.beta_over_alpha);
    chk('omega/alpha ≈ 0.80 (±0.02)', near(R.omega_over_alpha, 0.80, 0.02), R.omega_over_alpha);
    chk('beta/minion ≈ 1.00 (±0.02)', near(R.beta_over_minion, 1.00, 0.02), R.beta_over_minion);
    chk('omega/minion ≈ 1.00 (±0.02)', near(R.omega_over_minion, 1.00, 0.02), R.omega_over_minion);
    chk('beta 无 ghost 属性', !sameD.hasGhost1 && !sameD.hasGhost2 && !sameD.ghost1 && !sameD.ghost2,
        'ghost1=' + sameD.ghost1 + ' has=' + sameD.hasGhost1 + ' / ghost2=' + sameD.ghost2 + ' has=' + sameD.hasGhost2);
    chk('omega 无 ghost 属性', !sizeScene.unitProps.omega.hasGhost && !sizeScene.unitProps.omega.ghost,
        'ghost=' + sizeScene.unitProps.omega.ghost + ' has=' + sizeScene.unitProps.omega.hasGhost);
    chk('beta/omega 无 sizeMul', !sizeScene.unitProps.beta.hasSizeMul && !sizeScene.unitProps.omega.hasSizeMul,
        'beta.hasSizeMul=' + sizeScene.unitProps.beta.hasSizeMul + ' omega.hasSizeMul=' + sizeScene.unitProps.omega.hasSizeMul);
    chk('同队贝塔重叠后被弹开 (d ≥ 0.9×68)', sameD.dist1 >= 0.9 * sameD.rSum,
        'd0=' + sameD.dist0 + ' → d=' + sameD.dist1 + ' rSum=' + sameD.rSum + ' ratio=' + sameD.ratioOfRSum);
    chk('跨队贝塔×贝塔重叠后被弹开 (d ≥ 0.9×68)', crossD.dist1 >= 0.9 * crossD.rSum,
        'd0=' + crossD.dist0 + ' → d=' + crossD.dist1 + ' rSum=' + crossD.rSum + ' ratio=' + crossD.ratioOfRSum);
    chk('跨队贝塔×欧米伽重叠后被弹开 (d ≥ 0.9×64)', boD.dist1 >= 0.9 * boD.rSum,
        'd0=' + boD.dist0 + ' → d=' + boD.dist1 + ' rSum=' + boD.rSum + ' ratio=' + boD.ratioOfRSum);
    chk('p.omegaWaveR === 220', wave.pOmegaWaveR === 220, wave.pOmegaWaveR);
    chk('p.omegaMax === 3', wave.pOmegaMax === 3, wave.pOmegaMax);
    chk('p.omegaHp === 100', wave.pOmegaHp === 100, wave.pOmegaHp);
    chk('p.omegaWaveDmg === 150', wave.pOmegaWaveDmg === 150, wave.pOmegaWaveDmg);
    chk('p.betaIv === 5', wave.pBetaIv === 5, wave.pBetaIv);
    chk('p.betaGrow === 5', wave.pBetaGrow === 5, wave.pBetaGrow);
    chk('p.waveSpd === 320', wave.pWaveSpd === 320, wave.pWaveSpd);
    chk('冲击波特效 maxR=220 / spd=320', wave.maxRSet === 220 && wave.spdSet === 320,
        'maxR=' + wave.maxRSet + ' spd=' + wave.spdSet + ' 实例数=' + wave.count);
    chk('omegaMax 行为：满员不转化、空位立刻转化', !capTest.convertedWhenFull && capTest.convertedAfterFree,
        '满员(' + capTest.omegasWhenFull + ')时转化=' + capTest.convertedWhenFull + '；空位后转化=' + capTest.convertedAfterFree);
    chk('beta→omega 转化仍会发生 (12s 内出现 omega)', out.sim12s.aliveOmegas > 0 || out.sim12s.maxOmegaObserved > 0,
        'aliveOmegas=' + out.sim12s.aliveOmegas + ' maxObserved=' + out.sim12s.maxOmegaObserved);
    chk('WAAlphaMorph 在转化帧出现', out.morph.morphCount >= 1,
        'morphCount=' + out.morph.morphCount + ' ' + JSON.stringify(out.morph.morphEffects));
    chk('OmegaUnit.appearScale() 起始 ≈0.55 (±0.02)', near(out.morph.appearAtBirth, 0.55, 0.02), out.morph.appearAtBirth);
    chk('OmegaUnit.appearScale() 动画结束=1', out.morph.appearSettled === 1, out.morph.appearSettled);
    chk('转化后 spawnCd 重新读条 = betaIv(5)', Math.abs(out.morph.spawnCdAfterConvert - 5) <= 0.05,
        '转化帧 spawnCd=' + out.morph.spawnCdAfterConvert + '（=5-1/120，同帧扣一步）；0.42s 后=' + out.morph.spawnCdNow);
  }
  out.checks = checks;
  fs.writeFileSync(JSONOUT, JSON.stringify(out, null, 2));

  console.log('\n================ 尺寸（受控场景，单位本体最小绘制尺寸） ================');
  console.log(JSON.stringify(S, null, 2));
  console.log('比值:', JSON.stringify(R, null, 2));
  console.log('单位属性(sizeMul/ghost/appear):', JSON.stringify(sizeScene.unitProps), JSON.stringify(sizeScene.appear));
  console.log('\n================ 12s 真实推进 ================');
  console.log(JSON.stringify({ t: sim.t, maxBeta: sim.maxBeta, maxOmegaObserved: sim.maxOmegaObserved,
    aliveBetas: sim.aliveBetas, aliveOmegas: sim.aliveOmegas, firstOmegaT: sim.firstOmegaT,
    betaGhost: sim.betaGhost, omegaGhost: sim.omegaGhost, params: sim.params,
    sizes: sim.sizes, waves: sim.waves }, null, 2));
  console.log('\n================ 召唤演出帧（WAAlphaSummon 虚影 vs 本体） ================');
  console.log(JSON.stringify(out.summonFrame, null, 2));
  console.log('\n================ 碰撞 ================');
  console.log(JSON.stringify({ sameTeamBetaBeta: out.collideSameTeam, crossTeamBetaBeta: crossD,
    crossTeamBetaOmega: boD }, null, 2));
  console.log('\n================ 转化帧（WAAlphaMorph / appearScale / spawnCd） ================');
  console.log(JSON.stringify(out.morph, null, 2));
  console.log('\n================ omegaMax 行为 ================');
  console.log(JSON.stringify(out.capTest, null, 2));
  console.log('\n================ 冲击波 ================');
  console.log(JSON.stringify(wave, null, 2));
  console.log('\n================ 判定 ================');
  for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + '  [' + c.detail + ']');
  console.log('\n截图: ' + SHOT);
  console.log('JSON: ' + JSONOUT);
  console.log('errs=' + JSON.stringify(errs));
  await browser.close();
  if (TAG === 'after' && checks.some(c => !c.pass)) process.exitCode = 2;
})().catch(e => { console.error('FATAL', e); process.exit(1); });
