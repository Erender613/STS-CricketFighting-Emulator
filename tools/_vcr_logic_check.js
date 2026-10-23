/* 无头逻辑验收：VCR 状态机 / 回放步数 / 定格 / 复起横幅（不需要浏览器，秒级）。
   用 tools/verify_dev.js 的假 DOM 直接驱动 window.__frame。
   用法：node tools/_vcr_logic_check.js [卡A] [卡B] [种子]
   这只是开发期自检脚本（tools/_* 是临时产物，不入库约定见 .gitignore）。 */
const { loadGame } = require('./verify_dev.js');

let fails = 0, passes = 0;
function ok(cond, label, extra) {
  if (cond) { passes++; console.log('  \u2713 ' + label); }
  else { fails++; console.log('  \u2717 ' + label + (extra === undefined ? '' : '  \u2192 ' + extra)); }
}

/* 找一局能分出胜负（win 0/1）的卡对+种子 */
function findDecisive(X, wantWins) {
  const ids = Object.keys(X.CARD_BY_ID);
  const out = [];
  for (let i = 0; i < 60 && out.length < wantWins; i++) {
    const a = ids[i % ids.length], b = ids[(i * 7 + 3) % ids.length];
    const seed = 1000 + i * 7919;
    X.resetMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], seed);
    let n = 0;
    while (!X.stepOnce() && n++ < 40000) { }
    const o = X.world.over;
    if (o && (o.win === 0 || o.win === 1) && o.decideT > 0) out.push({ a, b, seed, over: o });
  }
  return out;
}

const g = loadGame();
const X = g.X;
console.log('== VCR 无头逻辑验收 ==');

/* 时间线常量 */
const TL = X.VCR_TL;
ok(!!TL && TL.speed === 0.2, 'VCR_TL.speed = 0.2', TL && TL.speed);

const found = findDecisive(X, 2);
ok(found.length >= 1, '找到可分胜负的对局', found.length + ' 局');
if (!found.length) { console.log('无法继续'); process.exit(1); }
const C = found[0];
console.log('  用例：' + C.a + ' vs ' + C.b + ' seed=' + C.seed);
const expectWin = C.over.win;
const decideStep0 = Math.round(C.over.decideT * 120);
const expectStart = Math.max(0, decideStep0 - 120);

/* ---- A. 关闭开关时不应触发 ---- */
X.SET.vcr = false;
X.resetMatch(X.CARD_BY_ID[C.a], X.CARD_BY_ID[C.b], C.seed);
let ts = 100000;
while (!X.stepOnce()) { }
X.world.running = false;
for (let i = 0; i < 40; i++) { ts += 16.667; X._frame(ts); }
ok(!X.VCR.on && X.VCR.phase === 'idle', 'SET.vcr=false → 不触发 VCR', X.VCR.phase);

/* ---- B. 开启后完整时间线 ---- */
X.SET.vcr = true;
X.resetMatch(X.CARD_BY_ID[C.a], X.CARD_BY_ID[C.b], C.seed);
while (!X.stepOnce()) { }
const overObj = X.world.over;
ok(!!overObj && overObj.win === expectWin, '重跑同一局结局一致', overObj && overObj.win);
X.world.running = false;
/* 清掉上一轮的 VCR 状态（同一 over 对象/世界已被 reset） */
X.vcrCancel();

const phases = [];
let freezeSeen = false, overAtFreeze = null, revealBannerT = null, stingerSeen = false;
const SND_before = JSON.stringify(X.SND);
let frames = 0;
const t0 = Date.now();
for (let i = 0; i < 4000; i++) {
  ts += 16.667;
  X._frame(ts);
  frames++;
  const ph = X.VCR.phase;
  if (phases[phases.length - 1] !== ph) phases.push(ph);
  if (!freezeSeen && X.VCR.phase === 'freeze') { freezeSeen = true; overAtFreeze = X.world.over; }
  if (X.VCR.phase === 'reveal' && revealBannerT === null) revealBannerT = X.OVER.t;
  if (!stingerSeen && X.VCR.stinger) stingerSeen = true;
  if (ph === 'idle' && i > 10) break;
}
const wall = Date.now() - t0;
console.log('  phases: ' + phases.join(' → ') + '  (' + frames + ' 帧, ' + wall + 'ms)');
ok(phases.slice(0, 8).join('>') === 'hold>hide>title>rewind>play>freeze>reveal>idle',
  'phase 顺序 hold→hide→title→rewind→play→freeze→reveal→idle', phases.join('>'));
ok(X.VCR.decideStep === decideStep0, 'decideStep 与原局一致', X.VCR.decideStep + ' vs ' + decideStep0);
ok(X.VCR.startStep === expectStart, 'startStep = max(0, decideStep-120)', X.VCR.startStep + ' vs ' + expectStart);
ok(X.VCR.step === decideStep0, 'play 恰好停在 decideStep', X.VCR.step + ' vs ' + decideStep0);
ok(freezeSeen, '进入定格阶段');
ok(!overAtFreeze, '定格时 world.over 尚未置（停在决胜微步前）', overAtFreeze);
ok(!!X.VCR.freezeCv, '定格帧已抓取（fake canvas）');
ok(revealBannerT !== null && revealBannerT < 0.2, '复起横幅时 OVER 入场从头开始',
  'OVER.t=' + revealBannerT);
ok(stingerSeen, '复起横幅播放了音效（vcr_stinger 标记）');
ok(X.VCR.bannerA === 1 && !X.VCR.on, '结束后 bannerA=1、VCR 关闭');
ok(!!X.world.over && X.world.over === overObj, '结束后 world.over = 原来那一局', X.world.over === overObj);

/* ---- C. 播放 120 步的时长：0.25× × 120 步 = 4 秒真实时间 ---- */
/* 用同样一局再放一次，数 play 阶段真实时间 */
X.vcrCancel();
X.resetMatch(X.CARD_BY_ID[C.a], X.CARD_BY_ID[C.b], C.seed);
while (!X.stepOnce()) { }
X.world.running = false;
let playT = 0, playFrames = 0, inPlay = false, playStepStart = null, playStepEnd = null;
for (let i = 0; i < 4000; i++) {
  ts += 16.667;
  X._frame(ts);
  if (inPlay || X.VCR.phase === 'play') {
    if (!inPlay) { inPlay = true; playStepStart = X.VCR.step; }
    playStepEnd = X.VCR.step; playT += 16.667 / 1000; playFrames++;
    if (X.VCR.phase !== 'play') break;
  }
}
ok(inPlay && playStepEnd - playStepStart === decideStep0 - expectStart,
  'play 阶段推进的步数 = decideStep-startStep', (playStepEnd - playStepStart));
ok(Math.abs(playT - 1 / TL.speed) < 0.35, 'play 阶段真实时长 ≈ 5s（0.2× 慢放 1s）', playT.toFixed(2) + 's / ' + playFrames + ' 帧');
ok(X.VCR.step === decideStep0, 'play 结束时正好在决胜微步', X.VCR.step);

/* ---- D. 空格跳过 ---- */
X.vcrCancel();
X.resetMatch(X.CARD_BY_ID[C.a], X.CARD_BY_ID[C.b], C.seed);
while (!X.stepOnce()) { }
X.world.running = false;
for (let i = 0; i < 10; i++) { ts += 16.667; X._frame(ts); }
const skippedPhase = X.VCR.phase;
X.vcrSkip();
ok(!X.VCR.on && X.VCR.bannerA === 1, '跳过：VCR 立即结束、横幅恢复', skippedPhase + ' → ' + X.VCR.phase);
ok(!!X.world.over && X.world.over.win === expectWin, '跳过：world.over 已接回', X.world.over && X.world.over.win);

/* ---- E. resetMatch 取消 ---- */
X.vcrCancel();
X.resetMatch(X.CARD_BY_ID[C.a], X.CARD_BY_ID[C.b], C.seed);
while (!X.stepOnce()) { }
X.world.running = false;
for (let i = 0; i < 10; i++) { ts += 16.667; X._frame(ts); }
X.resetMatch(X.CARD_BY_ID[C.a], X.CARD_BY_ID[C.b], C.seed);
ok(!X.VCR.on && X.VCR.phase === 'idle' && !X.VCR.freezeCv, 'resetMatch 取消 VCR 且清掉冻结帧');
ok(!X.world.over, 'resetMatch 后 over 清空');

/* ---- F. 平局/超时不触发 ---- */
X.SET.vcr = true;
X.resetMatch(X.CARD_BY_ID[C.a], X.CARD_BY_ID[C.b], C.seed);
X.world.t = X.CFG.MAX_TIME - 0.001;
const fakeOver = { win: -1, reason: 'timeout', decideT: X.world.t };
X.world.over = fakeOver;
for (let i = 0; i < 5; i++) { ts += 16.667; X._frame(ts); }
ok(!X.VCR.on, '平局/超时（win=-1）不触发 VCR');

console.log('\n' + (fails ? '\u2717' : '\u2713') + ' 通过 ' + passes + ' 项，失败 ' + fails + ' 项');
process.exit(fails ? 1 : 0);
