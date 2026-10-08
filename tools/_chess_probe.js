/* ============================================================
   空悲切探针：量一下「棋差一招」到底多久出现一次，并验证机制本身。

   用法: NODE_PATH=... node tools/_chess_probe.js [N]
   判据（不靠肉眼）：
     1) 续命窗口内败者一定活着（致死伤害真的被护体挡住了）
     2) 原局（不加护体）结局不变 —— 分析不能污染正常对局
     3) 窗口内反杀 → flip=true；窗口足够长时应该几乎必然反杀
   ============================================================ */
const path = require('path');
const { loadGame } = require(path.join(__dirname, 'verify_dev.js'));

const N = +process.argv[2] || 120;
const g = loadGame();
const X = g.X;

const cards = Object.keys(X.CARD_BY_ID).filter(id => !X.CARD_BY_ID[id].test);
const pick = i => cards[((i % cards.length) + cards.length) % cards.length];

let flips = 0, tested = 0, aliveOk = 0, hpOk = 0, sameOk = 0, longFlip = 0, longTested = 0;
const examples = [];
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const a = pick(i * 5), b = pick(i * 5 + 3);
  const seed = 700000 + i * 977;
  X.runFullMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], seed);
  const rec = X.matchRecord(seed);
  if (rec.win < 0) continue;                     // 平局没有"败者"，不分析
  tested++;
  const lose = 1 - rec.win;
  const g1 = X.runGraceMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], seed, lose, rec.deathT);
  const u = X.world.units[lose];
  if (u.alive && !u.dying) aliveOk++;
  if (u.hp > 0) hpOk++;
  if (g1.flip) { flips++; if (examples.length < 6) examples.push({ a, b, seed, t: rec.t, deathT: rec.deathT, win: rec.win, chessAt: +g1.t.toFixed(3) }); }
  /* 分析不能污染正常对局：同一颗种子直跑，结局必须和记录一致 */
  X.runFullMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], seed);
  const again = X.matchRecord(seed);
  if (again.win === rec.win && Math.abs(again.t - rec.t) < 1e-9) sameOk++;
  /* 对照组：把续命窗口拉到 20 秒，护体方几乎必然反杀（证明判定通路是通的） */
  if (i % 4 === 0) {
    longTested++;
    const g2 = X.runGraceMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], seed, lose, rec.deathT, 20);
    if (g2.flip) longFlip++;
  }
}

console.log('=== 空悲切（续命 ' + X.GRACE_LIFE + 's） ===');
console.log('分析局数            ' + tested);
console.log('棋差一招            ' + flips + '  (' + (flips / tested * 100).toFixed(1) + '%)');
console.log('窗口内败者仍活着    ' + aliveOk + '/' + tested);
console.log('窗口内败者血量 > 0  ' + hpOk + '/' + tested);
console.log('原局结局不受影响    ' + sameOk + '/' + tested);
console.log('对照(续命 20s)反杀  ' + longFlip + '/' + longTested);
console.log('样例 ' + JSON.stringify(examples.slice(0, 4)));
console.log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log(JSON.stringify({
  tested: tested, flips: flips, alive: aliveOk, hp: hpOk, same: sameOk,
  longFlip: longFlip, longTested: longTested, rate: +(flips / tested).toFixed(4)
}));
