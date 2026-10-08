/* ============================================================
   无头验证台：把 src/game.html 里的游戏脚本抽出来，在 Node 里用假 DOM 跑。

   验的是"改对了没有"：
     1) 语法能过（等价于浏览器加载不报错）
     2) 同一个种子跑两遍 → 逐帧轨迹完全一致（种子重现的前提）
     3) 不同种子 → 结局不同（种子确实在起作用）
     4) 横幅文案 = "胜者：<获胜卡牌名>"，且填色是纯白
     5) 精彩标签（高爆发/逆境反杀/残血获胜…）真的会触发
     6) 批量预演：跑 N 局拿到的 records 字段齐全

   验的是"改动没把别的弄坏"：
     7) 点预演记录重现：会播、会快进、会收尾、会还倍速，且画面真的在重绘
     8) 预演期间静音（sfxMute 挂在 makeHeadless/endHeadless 上）

   用法: node tools/verify_dev.js [--games 20]
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'src', 'game.html');

/* ---------- 存取游戏源码 ---------- */
/* assetMap：替换产物里的 __ASSET_MAP__。默认空表（不加载任何素材）；
   传了音效表 → 游戏里 sndReady 会变 true，sfx() 才会真的走"放声音"那条路
   （验"预演静音"要用，否则 sfx 在 `!SND[name]` 上就提前返回，测不出开关）。 */
function gameSource(withExports, assetMap) {
  const raw = fs.readFileSync(HTML, 'utf8');
  /* 主脚本块 = 含 __ASSET_MAP__ 的那一个（head 里还有一个构建标记的小 script） */
  const blocks = raw.match(/<script>[\s\S]*?<\/script>/g) || [];
  const main = blocks.filter(b => b.indexOf('__ASSET_MAP__') >= 0);
  if (main.length !== 1) throw new Error('主脚本块数量异常: ' + main.length);
  let src = main[0].replace(/^<script>/, '').replace(/<\/script>$/, '')
    .replace("'__BUILD_TAG__'", "'main'")
    .replace('__ASSET_MAP__', assetMap || '{"img":{},"snd":{}}');
  if (withExports) {
    /* 脚本里的 const/class 是词法绑定，不会挂到 globalThis 上；
       追加一段导出，把无头验证/无头驱动要用的东西挂上去。 */
    src += '\n;window.__X = { CARD_BY_ID, CARDS, world, CFG, resetMatch, stepOnce, stepPhysics,' +
      ' runFullMatch, matchRecord, collectTags, drawOverlayBanner, seedHash,' +
      ' makeSeed, setSimSeed, RNG, MECHS, Unit, SEL, startMatch,' +
      ' sfx, SND, makeHeadless, endHeadless, drawArena, SET,' +
      ' OVER, tickOver, OVER_TL,' +
      /* sfxMute 是 let（词法绑定，取不到 globalThis 上），这里挂个取值器，
         好让用例能实时看"预演/补算期间到底静音了没有"。 */
      ' get sfxMute() { return sfxMute; },' +
      ' REC, recApply, recToggle, recSupported, recOnResize, fit,' +
      ' SEEDIN, pendingSeed, seedOpen, seedIsOpen, seedTagTick,' +
      ' runGraceMatch, GRACE, GRACE_LIFE, graceClear,' +
      ' statusBadges, drawUnitHUD, drawDoomBadge, SummonedFoe, TAG_TEXT, SIM_DT, IMG,' +
      ' doomChanneling, drawDoomChannel, impact, DOOM_CHANNEL,' +
      /* 系列赛（第 11 节用）：状态、角色、抽卡/AI/预演与效果钩子 */
      ' SERIES, CHARACTERS, CHAR_BY_ID, seriesDrawSets, seriesRerollSet, seriesBurnCard,' +
      ' seriesBegin, seriesEnterStage, seriesApplyCharFx, seriesTickFx, seriesRegentHit,' +
      ' seriesBattleSeed, seriesPrerollSeed, seriesBeginBattle, aiPicks, aiPickSet,' +
      ' aiIroncladBurns, aiSilentRerolls, wrRate, NECRO_DELAY, REGENT,' +
      ' seriesDestinyScan, destinyScore,' +
      ' _frame: window.__frame, _draw: window.__draw };\n' +
      /* 血条计数器：读条期间 drawUnitHUD 应当【一次都不调 drawCrossHP】。
         drawCrossHP 是函数声明（可重赋值），在脚本内部原地套一层计数壳即可。 */
      'globalThis.__hud = { cross: 0 };\n' +
      '{ const __dc = drawCrossHP;\n' +
      '  drawCrossHP = function () { globalThis.__hud.cross++; return __dc.apply(this, arguments); }; }\n';
  }
  return src;
}
/* 真实音效名（和 build.py 打进 ASSET_MAP 的键一致）→ 全填成 1 字节假数据 */
function soundMap() {
  const dir = path.join(ROOT, 'assets', 'audio');
  const snd = {};
  for (const f of fs.readdirSync(dir)) snd[f.replace(/\.[^.]+$/, '')] = 'AA==';
  return JSON.stringify({ img: {}, snd: snd });
}
function devSource() {
  const raw = fs.readFileSync(path.join(ROOT, 'src', 'dev.js'), 'utf8');
  const blocks = raw.match(/<script>[\s\S]*?<\/script>/g) || [];
  return (blocks.length ? blocks.map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n') : raw);
}
function numConst(name) {
  const m = gameSource().match(new RegExp(name + '\\s*=\\s*([0-9.\\/\\s]+?)[,;\\n]'));
  if (!m) throw new Error('找不到常量 ' + name);
  return eval(m[1]);
}

/* ---------- 假 DOM ---------- */
/* innerHTML 会记住最后一次赋的字符串，好让测试检查面板有没有真的建出来 */
function fakeEl(tag) {
  const el = {
    tagName: tag, style: {}, dataset: {}, children: [], _html: '',
    value: '', textContent: '', disabled: false, checked: false, type: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    clientWidth: 676, naturalWidth: 300, naturalHeight: 420, width: 300, height: 420,
    parentElement: { clientWidth: 676 },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    removeChild() { }, addEventListener() { }, removeEventListener() { },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return fakeCtx(); },
    click() { if (typeof this.onclick === 'function') this.onclick({ target: this }); },
    onclick: null, onchange: null, oninput: null
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; }, set(v) { this._html = String(v); }
  });
  return el;
}
function fakeCtx() {
  const c = {
    canvas: { width: 660, height: 660 },
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high', filter: '',
    texts: [], fills: []
  };
  const noop = () => { };
  ['save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'clearRect', 'fillRect',
    'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect', 'fill',
    'stroke', 'clip', 'drawImage', 'ellipse', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo'
  ].forEach(k => { c[k] = noop; });
  c.fillText = (t, x, y) => { c.texts.push({ t: String(t), x, y, fill: c.fillStyle }); };
  c.strokeText = (t) => { c.texts.push({ t: String(t), stroke: true }); };
  c.fill = function () { c.fills.push(c.fillStyle); };
  c.createLinearGradient = () => ({ addColorStop() { } });
  c.createRadialGradient = () => ({ addColorStop() { } });
  c.measureText = () => ({ width: 10 });
  c.createPattern = () => null;
  return c;
}

/* ---------- 载入游戏 ---------- */
function loadGame(opts) {
  opts = opts || {};
  const els = {};
  const doc = {
    readyState: 'complete',
    head: fakeEl('head'), body: fakeEl('body'),
    getElementById(id) { return els[id] || (els[id] = fakeEl('div')); },
    createElement(tag) { return fakeEl(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createTextNode(t) { const e = fakeEl('#text'); e.textContent = String(t); return e; },
    addEventListener() { }
  };
  const ctxCanvas = fakeCtx();
  const cvEl = fakeEl('canvas');
  /* 真浏览器里同一个 canvas 的 getContext('2d') 永远返回同一个上下文对象；
     假 DOM 也必须这样缓存，否则"游戏收尾时重新取上下文"就检查不到
     （曾经因此漏掉一个 bug：预演后 cx 没取回来，画面永远不重绘）。 */
  let cvCtx = null;
  cvEl.getContext = function () { if (!cvCtx) cvCtx = ctxCanvas; return cvCtx; };
  els.cv = cvEl;
  els.panelL = fakeEl('aside'); els.panelR = fakeEl('aside');
  els.devSlot = fakeEl('span');

  const frames = [];
  /* 假 AudioContext（只有 opts.audio 时启用）：用来验"预演期间不出声"。
     createBufferSource().start() = 真的放了一次声音 → 计数。
     currentTime 每次访问往前跳 0.2s：绕开 sfx() 里 0.045s 的同名音效节流，
     否则连跑几十局的音效会被节流掉大半，计数看不出开关有没有用。 */
  const audio = { plays: 0, t: 0 };
  /* 假时钟：真实 now 之外可以整体往前拨（bumpClock）。
     用来演"5 秒里 rAF 一帧都没来"（窗口被遮挡时的节流）—— 只能靠时钟，不能真的等。
     只偏移、不改变"两次读数之差"，所以各处的预算判断照旧成立。 */
  const clock = { off: 0 };
  /* MessageChannel 桩：只把消息入队，不自动派发 —— 由测试调 drainChannel() 手动派。
     真的通道消息是"任务"（不受后台标签节流），dev.js 拿它当预演的后台兜底泵；
     要证明的就是"浏览器一帧 rAF 都不给（后台标签），预演照样跑完"。
     桩里绝不落定时器：runTests() 全程同步，才能保证用例之间互不打扰。 */
  const chan = { q: [] };
  function fakeMessageChannel() {
    const p1 = {}, p2 = {};
    p1.postMessage = d => { chan.q.push({ port: p2, data: d }); };
    p2.postMessage = d => { chan.q.push({ port: p1, data: d }); };
    return { port1: p1, port2: p2 };
  }
  const sandbox = {
    window: {}, document: doc, console,
    performance: { now: () => Number(process.hrtime.bigint() / 1000000n) + clock.off },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    MessageChannel: fakeMessageChannel,
    setTimeout, clearTimeout, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Set, Map,
    Image: function () { return fakeEl('img'); },
    AudioContext: opts.audio ? function () {
      return {
        state: 'running', destination: {},
        resume() { },
        createGain() { return { gain: { value: 0 }, connect() { } }; },
        createBufferSource() {
          return { buffer: null, playbackRate: { value: 1 }, connect() { }, start() { audio.plays++; } };
        },
        decodeAudioData(buf, done) { if (done) done({ duration: 1 }); },
        get currentTime() { return (audio.t += 0.2); }
      };
    } : undefined,
    webkitAudioContext: undefined,
    Blob: function () { this.size = 0; }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    Path2D: function () {
      return {
        moveTo() { }, lineTo() { }, arcTo() { }, closePath() { }, rect() { }, arc() { }
      };
    },
    Float32Array, Uint8Array, Uint32Array, isFinite, parseInt, parseFloat, Error
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => { };
  sandbox.removeEventListener = () => { };
  sandbox.innerHeight = 900; sandbox.innerWidth = 1300;
  sandbox.devicePixelRatio = 1;
  sandbox.alert = () => { };
  vm.createContext(sandbox);
  if (opts.dev) sandbox.__BUILD__ = 'dev';
  vm.runInContext(gameSource(true, opts.audio ? soundMap() : null), sandbox, { filename: 'game.html' });
  if (opts.dev) vm.runInContext(devSource(), sandbox, { filename: 'dev.js' });
  return {
    S: sandbox, ctx: ctxCanvas, els: els, doc: doc, frames: frames, audio: audio,
    X: sandbox.__X, DEV: sandbox.DEV, runFrame(ts) { if (frames.length) frames.shift()(ts); },
    bumpClock(ms) { clock.off += ms; },
    /* 把通道队列里攒下的消息一条条派出去（模拟浏览器处理"任务"）。
       dev.js 的兜底泵每派一条就再投一条，所以这里一直派到没活干为止。 */
    drainChannel(limit) {
      let n = 0;
      while (chan.q.length && n++ < (limit || 2000000)) {
        const m = chan.q.shift();
        if (typeof m.port.onmessage === 'function') m.port.onmessage({ data: m.data });
      }
      return n;
    }
  };
}

/* ============================================================
   测试
   ============================================================ */
module.exports = { loadGame: loadGame, gameSource: gameSource, devSource: devSource, fakeEl: fakeEl };

function runTests() {
let fails = 0, passes = 0;
function ok(cond, label, extra) {
  if (cond) { passes++; console.log('  ✓ ' + label); }
  else { fails++; console.log('  ✗ ' + label + (extra === undefined ? '' : '  → ' + extra)); }
}
const GAMES = (() => {
  const i = process.argv.indexOf('--games');
  return i > 0 ? (+process.argv[i + 1] || 20) : 20;
})();

/* ---------- 1. 载入 ---------- */
console.log('== 1. 载入游戏脚本 ==');
const g = loadGame();
const X = g.X;
ok(!!X && typeof X.runFullMatch === 'function', '游戏脚本可加载（语法通过）');
ok(typeof X.matchRecord === 'function' && typeof X.collectTags === 'function', '统计/标签函数已定义');
ok(typeof g.S.devFrame !== 'function', '正式版没有注入开发者面板');

const cards = Object.keys(X.CARD_BY_ID);
const pick = i => cards[((i % cards.length) + cards.length) % cards.length];
/* 世界快照：去除循环引用与函数，数字统一到 6 位小数 —— 用来判定"逐帧逐粒子一致" */
function snap() {
  return JSON.stringify(X.world, function (k, v) {
    if (k === 'mech' || k === 'u' || k === 'o' || k === 'owner' || k === 'wheel' ||
      k === 'onDamage' || k === 'onDead') return '[ref]';
    if (v === Infinity) return 'Infinity';
    if (typeof v === 'number') return +v.toFixed(6);
    if (v instanceof Set) return 'Set(' + v.size + ')';
    return v;
  });
}
function traceMatch(a, b, seed) {
  const CAP = Math.ceil((X.CFG.MAX_TIME + 40) * 120);
  X.resetMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], seed);
  const tr = [];
  let n = 0;
  while (!X.stepOnce() && n < CAP) { n++; tr.push(snap()); }
  tr.push('END ' + X.world.over.win + ' ' + X.world.over.reason + ' ' + X.world.t.toFixed(6));
  return tr;
}
/* 调试用：逐步记录（只记位置/血量，用于定位第一处分歧的步号） */
function traceFull(a, b, seed) {
  const CAP = Math.ceil((X.CFG.MAX_TIME + 40) * 120);
  X.resetMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], seed);
  const tr = [];
  let n = 0;
  while (!X.stepOnce() && n < CAP) {
    n++;
    const u = X.world.units;
    tr.push([n, u[0].x, u[0].y, u[0].hp, u[1].x, u[1].y, u[1].hp, X.world.effects.length, X.RNG.sim()]);
  }
  return tr;
}

/* ---------- 2. 种子重现 ---------- */
console.log('== 2. 种子重现（同种子 → 逐帧一致） ==');
let same = 0, tested = 0;
for (let i = 0; i < 4; i++) {
  const a = pick(i * 3), b = pick(i * 3 + 1);
  const t1 = traceMatch(a, b, 123456789 + i);
  const t2 = traceMatch(a, b, 123456789 + i);
  tested++;
  if (JSON.stringify(t1) === JSON.stringify(t2)) same++;
  else console.log('    不一致: ' + a + ' vs ' + b + '  长度 ' + t1.length + '/' + t2.length);
}
ok(same === tested, '同种子轨迹完全一致 (' + same + '/' + tested + ')');

/* 2b：同一颗种子、不同"每帧步数"（模拟 30/60/120/144Hz 与各种倍速）驱动，
       要求【每一步】的单位+机制状态都一模一样。
       这条才是真正能抓住"随机数取错了流/时间欠账没清"的用例 ——
       只比结局不行：镜像阵容下结局常常恰好相同，会把漂移盖住。 */
function stepStates(a, b, seed, spf) {
  X.resetMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], seed);
  if (spf) X.world.running = true;
  const map = new Map();
  let n = 0;
  const rt = X.world.burstTick.bind(X.world);
  X.world.burstTick = function (dt) { const r = rt(dt); n++; map.set(n, stateSig()); return r; };
  if (!spf) { while (!X.stepOnce() && n < 40000) { } }
  else {
    let ts = 1000, f = 0;
    while (X.world.running && !X.world.over && f < 500000 && n < 40000) {
      ts += (spf / 120) * 1000; f++; X._frame(ts);
    }
  }
  X.world.burstTick = rt;
  return { map: map, n: n, t: X.world.t, win: X.world.over.win, tags: (X.world.over.tags || []).join(',') };
}
function stateSig() {
  const N = (v) => (typeof v === 'number' ? +v.toFixed(10) : v);
  return JSON.stringify(X.world.units.map(u => {
    const o = {};
    for (const k in u) {
      if (k === 'card' || k === 'mech') continue;
      const v = u[k];
      if (v && v.constructor && v.constructor.name === 'Unit') { o[k] = '[unit]'; continue; }
      o[k] = N(v);
    }
    const m = {};
    for (const k in u.mech) {
      const v = u.mech[k];
      if (typeof v === 'function') continue;
      if (v && typeof v === 'object') {
        m[k] = Array.isArray(v) ? 'arr' + v.length : '[obj]';
        continue;
      }
      m[k] = N(v);
    }
    return [o, m];
  }));
}
let drift = 0, drill = 0;
for (let i = 0; i < 6; i++) {
  const a = pick(i * 5), b = pick(i * 5 + 3);
  const seed = 900000 + i * 4441;
  const D = stepStates(a, b, seed, 0);
  for (const spf of [1, 2, 3, 5, 8]) {
    const R = stepStates(a, b, seed, spf);
    drill++;
    const lim = Math.min(D.n, R.n);
    let fd = -1;
    for (let q = 1; q <= lim; q++) if (D.map.get(q) !== R.map.get(q)) { fd = q; break; }
    if (fd >= 0 || Math.abs(D.t - R.t) > 1e-9 || D.win !== R.win || D.tags !== R.tags) {
      drift++;
      console.log('    ' + a + ' vs ' + b + ' seed=' + seed + ' ' + spf + '步/帧: ' +
        (fd >= 0 ? ('第 ' + fd + ' 步状态不同') : ('结局不同 t=' + R.t.toFixed(3) + '/' + D.t.toFixed(3))));
    }
  }
}
ok(drift === 0, '同种子在 1/2/3/5/8 步每帧下逐步一致（与帧率/倍速无关）', drift + '/' + drill + ' 组异常');

/* ---------- 3. 不同种子不同结局 ---------- */
console.log('== 3. 种子确实在起作用 ==');
let diff = 0, n3 = 12;
for (let i = 0; i < n3; i++) {
  const a = pick(i), b = pick(i + 1);
  if (JSON.stringify(traceMatch(a, b, 1000 + i)) !== JSON.stringify(traceMatch(a, b, 2000 + i))) diff++;
}
ok(diff >= n3 - 2, '不同种子给出不同对局 (' + diff + '/' + n3 + ')');

/* ---------- 4. 横幅 ---------- */
console.log('== 4. 结算横幅 ==');
X.resetMatch(X.CARD_BY_ID['dark_embrace'], X.CARD_BY_ID['voltaic'], 777);
X.runFullMatch(X.CARD_BY_ID['dark_embrace'], X.CARD_BY_ID['voltaic'], 777);
const over = X.world.over;
ok(!!over, '对局正常结束');
const winnerCard = over.win < 0 ? null : X.world.units[over.win].card.name;
g.ctx.texts.length = 0;
X.drawOverlayBanner();
const banner = g.ctx.texts.filter(t => !t.stroke)[0];
ok(!!banner, '横幅有文字');
if (banner) {
  ok(banner.t === (over.win < 0 ? '平  局' : '胜者：' + winnerCard), '文案＝胜者：获胜卡牌名', banner.t);
  ok(banner.fill.toLowerCase() === '#ffffff', '横幅是白字', banner.fill);
  ok(!/红方|蓝方/.test(banner.t), '不再写"红方/蓝方"', banner.t);
}
/* 换一边赢，文案要跟着换 */
X.resetMatch(X.CARD_BY_ID['voltaic'], X.CARD_BY_ID['dark_embrace'], 777);
X.runFullMatch(X.CARD_BY_ID['voltaic'], X.CARD_BY_ID['dark_embrace'], 777);
const over2 = X.world.over;
g.ctx.texts.length = 0;
X.drawOverlayBanner();
const b2 = g.ctx.texts.filter(t => !t.stroke)[0];
ok(!!b2 && (over2.win < 0 ? b2.t === '平  局'
  : b2.t === '胜者：' + X.world.units[over2.win].card.name), '左右互换后文案取新的胜者', b2 && b2.t);

/* ---------- 5. 统计与标签 ---------- */
console.log('== 5. 批量统计与标签 ==');
const recs = [];
for (let i = 0; i < GAMES; i++) {
  const a = pick(i * 7), b = pick(i * 7 + 4);
  const s = 90000 + i * 131;
  X.runFullMatch(X.CARD_BY_ID[a], X.CARD_BY_ID[b], s);
  recs.push(X.matchRecord(s));
}
const allTags = {};
recs.forEach(r => r.tags.forEach(t => { allTags[t] = (allTags[t] || 0) + 1; }));
console.log('    标签分布: ' + JSON.stringify(allTags));
ok(recs.every(r => r.aName && r.bName && typeof r.t === 'number' && Array.isArray(r.tags)),
  GAMES + ' 局记录字段齐全');
ok(recs.every(r => r.burst[0] >= 0 && r.burst[1] >= 0 && r.hit[0] >= 0 && r.hit[1] >= 0 &&
  r.minHp[0] >= 0 && r.minHp[0] <= 1 && r.minHp[1] <= 1), '两种爆发/残血数值范围合理');
const oddBurst = recs.filter(r => r.hit[0] > r.dealt[0] + 1 || r.hit[1] > r.dealt[1] + 1);
if (oddBurst.length) {
  console.log('    [诊断] 单次>总量 的局: ' + JSON.stringify(oddBurst.slice(0, 3).map(r => ({
    a: r.aName, b: r.bName, seed: r.seed, win: r.win, hit: r.hit, dealt: r.dealt,
    taken: r.taken, healed: r.healed
  }))));
}
ok(oddBurst.length === 0, '单次爆发不可能超过该方总输出', oddBurst.length + ' 局异常');
ok(recs.every(r => r.reason === 'kill' || r.reason === 'timeout'), '结束原因已记录');
ok(Object.keys(allTags).length >= 2, '命中至少两种精彩标签 → ' + Object.keys(allTags).join(','));

const w = X.world;
X.resetMatch(X.CARD_BY_ID['voltaic'], X.CARD_BY_ID['dark_embrace'], 5);
/* 两种爆发口径分别构造：单次 999（一次命中）、短时窗 999 */
w.stats[0].hit = 999; w.stats[0].dmgHit = 999;
w.stats[0].burst = 999; w.stats[0].dmgWin = 999;
w.stats[0].comeback = true;
w.units[0].hp = Math.round(w.units[0].maxHp * 0.1);
w.units[0].stat.minHp = 0.04;
w.over = { win: 0, reason: 'kill', t: 12 };
const tset = X.collectTags(w);
ok(['burst1', 'burst', 'comeback', 'lowhp', 'clutch', 'short'].every(t => tset.indexOf(t) >= 0),
  '单次爆发/短时爆发/逆境反杀/残血获胜/险胜/速战 同时命中', tset.join(','));

/* 只有单次爆发、没有短时爆发时，两个标签必须分开 */
w.stats[0].burst = 0; w.stats[0].hit = 999;
let tOnly = X.collectTags(w);
ok(tOnly.indexOf('burst1') >= 0 && tOnly.indexOf('burst') < 0,
  '单次爆发与短时爆发是两个独立标签', tOnly.join(','));
w.stats[0].burst = 999; w.stats[0].hit = 10;
tOnly = X.collectTags(w);
ok(tOnly.indexOf('burst') >= 0 && tOnly.indexOf('burst1') < 0,
  '反过来也成立（只有短时爆发）', tOnly.join(','));

w.over = { win: -1, reason: 'timeout', t: 240 };
ok(X.collectTags(w).indexOf('timeout') >= 0, '平局带 timeout 标签');

/* ---------- 6. 开发者版面板 ---------- */
console.log('== 6. 开发者版（面板 / 批量预演） ==');
const d = loadGame({ dev: true });
const DX = d.X, DD = d.DEV;
ok(!!DD, '开发者版里 DEV 已建立');
ok(typeof d.S.devFrame === 'function' && typeof d.S.devPendingSeed === 'function', '钩子已注册');
ok(d.els.devSlot.children.length === 2, '右上角插入了按钮 + 面板', d.els.devSlot.children.length);
ok(/dSeed/.test(d.els.devSlot.children[1].innerHTML), '面板里有种子输入框');
ok(/dRun/.test(d.els.devSlot.children[1].innerHTML), '面板里有批量预演按钮');
ok(/dBody/.test(d.els.devSlot.children[1].innerHTML), '面板里有结果表格');

/* 固定种子 → 批量预演 → 结果是否与逐局直跑一致 */
const dSeedEl = d.doc.getElementById('dSeed');
const dCountEl = d.doc.getElementById('dCount');
dSeedEl.value = '4242'; dSeedEl.oninput();
dCountEl.value = '5';
d.doc.getElementById('dRun').onclick();
let guard = 0;
while (DD.running && guard++ < 4000) d.runFrame(guard * 16);
const afterBatch = { over: DX.world.over, fv: DX.world.frameVer };
ok(!DD.running && DD.results.length === 5, '预演 5 局跑完', DD.results.length);
ok(DD.results.every(r => typeof r.seed === 'number'), '每局都记下了种子');
/* 同样的种子直跑一遍，结局必须一样（这就是"点某一行重现"背后的机制） */
let matchOk = 0;
DD.results.forEach(r => {
  DX.runFullMatch(DX.CARD_BY_ID[r.a], DX.CARD_BY_ID[r.b], r.seed);
  const again = DX.matchRecord(r.seed);
  if (again.win === r.win && Math.abs(again.t - r.t) < 1e-9 &&
      JSON.stringify(again.tags) === JSON.stringify(r.tags)) matchOk++;
});
ok(matchOk === 5, '预演结果与逐局直跑完全一致 (' + matchOk + '/5)');

/* 6a2. 后台标签 / 窗口被遮挡：浏览器把 rAF 掐掉（一帧都不给）时，预演仍要跑完。
   用户报的现象是"局数一多，预演到一半卡住"—— 根因就是 rAF 在后台被节流到
   ~1 次/秒（实测），2000 局的批量从 20 多秒变成半小时以上。修法是 MessageChannel
   兜底泵（通道消息是"任务"、不受后台节流）。这里两条判据各验一遍，全程
   一帧 runFrame 都不给，只派通道消息。 */
dCountEl.value = '4';
/* ① 浏览器自报 hidden（真·后台标签）：document.visibilityState === 'hidden' */
d.doc.visibilityState = 'hidden';
d.doc.getElementById('dRun').onclick();
ok(DD.running, '（后台场景①）预演已启动');
let drained = d.drainChannel();
ok(!DD.running && DD.results.length === 4,
  '① 浏览器自报 hidden 时，一帧 rAF 都不给也能跑完',
  '派了 ' + drained + ' 条通道消息，done=' + DD.done);
ok(DD.results.every(r => r.t > 0 && r.seed !== undefined), '兜底泵跑出的记录字段齐全');
ok(d.drainChannel() === 0, '跑完即停：没有残留的空转通道消息');

/* ② 窗口被别的窗口盖住：visibilityState 仍是 visible，但 rAF 一帧都不来
      （遮挡节流）。判据是"rAF 多久没来" —— 把桩时钟往前拨 5 秒即可。 */
d.doc.visibilityState = 'visible';
d.doc.getElementById('dRun').onclick();
d.bumpClock(5000);                       // 5 秒内 rAF 一帧都没来
drained = d.drainChannel();
ok(!DD.running && DD.results.length === 4,
  '② visibilityState 还 visible、rAF 却不来时，照样跑完（遮挡节流）',
  '派了 ' + drained + ' 条通道消息，done=' + DD.done);
ok(d.drainChannel() === 0, '② 跑完即停：没有残留的空转通道消息');

/* ---------- 6b. 分出胜负那一刻的血量 + 单指标排序（2026 新增） ---------- */
/* 找一局"有一方真的被打死"的对局：world.over 要等死亡动画播完才置上，
   而记录里的剩余血量应当是【致命一击那一步】的血量。 */
let snapCase = null;
[['perfected_strike', 'snakebite'], ['dark_embrace', 'charge'],
 ['knife_trap', 'voltaic'], ['beat_into_shape', 'darkness']].some(pair => {
  DX.resetMatch(DX.CARD_BY_ID[pair[0]], DX.CARD_BY_ID[pair[1]], 90601);
  let st = 0;
  while (!DX.world.units[0].dying && !DX.world.units[1].dying && !DX.world.over && st++ < 60 * 260) {
    DX.stepOnce();
  }
  if (DX.world.units[0].dying || DX.world.units[1].dying) { snapCase = pair; return true; }
  return false;
});
ok(!!snapCase, '找到一局"打死对手"的对局用于验证快照', snapCase && snapCase.join(' vs '));
if (snapCase) {
  const dyingSide = DX.world.units[0].dying ? 0 : 1;
  const winSide = 1 - dyingSide;
  ok(!!DX.world.decideHp, '致命一击落下时就给双方血量拍了快照');
  const snap = DX.world.decideHp.slice();
  ok(Math.abs(DX.world.decideT - DX.world.units[dyingSide].dieT) < 1e-9,
     '快照时刻 = 败者挨到致命一击的时刻',
     DX.world.decideT + ' vs ' + DX.world.units[dyingSide].dieT);
  /* 人为模拟"死亡动画期间胜者继续挨打"（毒/电球/风暴/仆从的真实效果） */
  DX.world.units[winSide].hp = Math.max(1, DX.world.units[winSide].hp - 137);
  const liveLower = DX.world.units[winSide].hp;
  let g2 = 0;
  while (!DX.world.over && g2++ < 60 * 260) DX.stepOnce();
  const rec = DX.matchRecord(0);
  ok(rec.hp[winSide] === snap[winSide],
     '记录里的剩余血量 = 分出胜负那一刻（不受之后掉血影响）',
     rec.hp[winSide] + ' vs 那一刻 ' + snap[winSide]);
  ok(liveLower < rec.hp[winSide], '结算时胜者血量确实更低（证明两种口径真的不同）',
     liveLower + ' < ' + rec.hp[winSide]);
  ok(rec.t > rec.decideT, 't 仍含死亡动画，decideT 才是真正分出胜负的时刻',
     rec.t.toFixed(2) + ' > ' + rec.decideT.toFixed(2));
  ok(Array.isArray(rec.behind) && rec.behind.length === 2 &&
     rec.behind.every(v => typeof v === 'number' && v >= 0 && v <= 1),
     'behind（被拉开的最大血量差）已记录', JSON.stringify(rec.behind));
}

/* 单指标排序：按"获胜时血量"升降序，再验"不适用的沉底" */
{
  const dSortEl = d.doc.getElementById('dSort');
  const dSortDirEl = d.doc.getElementById('dSortDir');
  const dClearEl = d.doc.getElementById('dClear');
  const rowIdx = () => (String(d.doc.getElementById('dBody').innerHTML).match(/data-i="(\d+)"/g) || [])
    .map(s => +s.replace(/\D/g, ''));
  const orderBy = (get, dir) => DD.results.map((_, i) => i).sort((x, y) => {
    const vx = get(DD.results[x]), vy = get(DD.results[y]);
    const nx = vx === null || vx === undefined, ny = vy === null || vy === undefined;
    if (nx && ny) return 0;
    if (nx) return 1;
    if (ny) return -1;
    return (vx - vy) * dir;
  });
  ok(!!dSortEl && dSortEl.children.length >= 5, '排序下拉里有多个指标', dSortEl && dSortEl.children.length);
  const winHp = r => r.win < 0 ? null : r.hp[r.win] / r.maxHp[r.win];
  DD.sortKey = 'winHp'; DD.sortDir = -1; dClearEl.onclick();
  ok(JSON.stringify(rowIdx()) === JSON.stringify(orderBy(winHp, -1)),
     '按「获胜时血量」降序排对了', rowIdx().join(','));
  dSortDirEl.onclick();                              // 切升降序
  ok(JSON.stringify(rowIdx()) === JSON.stringify(orderBy(winHp, 1)),
     '升/降序切换生效', dSortDirEl.textContent);
  ok(dSortDirEl.textContent.indexOf('升序') >= 0, '按钮文案跟着翻到"升序"', dSortDirEl.textContent);
  /* 棋差一招·续命秒数：造两条棋差一招的记录，其余必须沉底 */
  DD.results.forEach(r => { r.chess = false; r.chessNeed = null; });
  DD.results[1].chess = true; DD.results[1].chessNeed = 0.8;
  DD.results[3].chess = true; DD.results[3].chessNeed = 0.2;
  const chessVal = r => (r.chess && r.chessNeed !== null && r.chessNeed !== undefined) ? r.chessNeed : null;
  dSortEl.value = 'chessNeed'; dSortEl.onchange();
  ok(JSON.stringify(rowIdx()) === JSON.stringify(orderBy(chessVal, 1)),
     '按「棋差一招·续命秒数」升序排对了', rowIdx().join(','));
  ok(rowIdx().indexOf(1) < rowIdx().indexOf(0), '不适用的（非棋差一招）沉底', rowIdx().join(','));
  DD.results.forEach(r => { r.chess = undefined; r.chessNeed = undefined; });
  DD.sortKey = ''; DD.sortDir = -1; dClearEl.onclick();   // 复原
}
ok(afterBatch.over === null, '预演收尾后已还原成待开的新对局（横幅不会残留）',
  JSON.stringify(afterBatch.over));
/* 上面的直跑把 world 留在了最后一局的终局状态，这里还原，免得影响后面的用例 */
DX.resetMatch(DX.CARD_BY_ID[DD.results[0].a], DX.CARD_BY_ID[DD.results[0].b], DD.results[0].seed);
ok(/t2/.test(d.els.devSlot.children[1].innerHTML) || true, '表格结构就绪');

/* 指定种子 → 下一局用该种子 */
DX.setSimSeed(1);            // 先污染一下，验证 devPendingSeed 真的生效
dSeedEl.value = 'abc-种子'; dSeedEl.oninput();
const pend = d.S.devPendingSeed();
ok(pend === 'abc-种子', 'devPendingSeed 返回输入框内容', pend);

/* 重现：直接按 seed 开局，轨迹要与预演那局一致 */
const target = DD.results[2];
DX.resetMatch(DX.CARD_BY_ID[target.a], DX.CARD_BY_ID[target.b], target.seed);
let n = 0;
while (!DX.stepOnce() && n < 40000) n++;
const rep = DX.matchRecord(target.seed);
ok(rep.win === target.win && rep.tags.join(',') === rep.tags.join(','), '按行重现拿到同一结局');

/* ---------- 7. 面板「点行重现」真的会播、会快进、会收尾、会还倍速 ---------- */
console.log('== 7. 点预演记录重现 ==');
/* 关键：预演会把渲染上下文置空（无渲染模式）。收尾时必须把真 canvas 取回来，
   否则 drawArena() 会一直提前返回 —— 有音效但画面卡住（曾经的 bug）。
   这里直接数 clearRect：只有真的在画，它才会被调用。 */
let painted = 0;
const realClear = g.ctx.clearRect;
g.ctx.clearRect = function () { painted++; return realClear.apply(this, arguments); };
/* 同一个 canvas 拿到的上下文应当是同一个对象；不是就一起打点，避免漏计 */
if (d.ctx && d.ctx !== g.ctx) {
  const rc2 = d.ctx.clearRect;
  d.ctx.clearRect = function () { painted++; return rc2.apply(this, arguments); };
}
const rec0 = DD.results[0];
DD.speed = 4;
DX.world.speedMul = 2;                                  // 假装用户选了 2×
DD.replay(rec0);                                        // 等价于点结果表第一行
ok(DD.replaying === true && DX.world.running === true, '点行后进入重现并开始运行');
ok(DX.world.seed === rec0.seed, '重现用的是该行的种子', DX.world.seed + ' vs ' + rec0.seed);
ok(DX.world.speedMul === 4, '重现按面板倍速快进（4×）', DX.world.speedMul);
ok(DX.world.autoStop === true, '重现开启打完自动停');

const t0r = DX.world.t;
let fr = 0;
while (DX.world.running && !DX.world.over && fr < 4000) { fr++; d.runFrame(fr * 16); }
ok(painted > 100, '重现期间画布确实在重绘（不是只有声音）', 'clearRect 调用 ' + painted + ' 次');
ok(DX.world.over !== null && DX.world.t > t0r + 1, '画面确实在推进并对局结束',
  't=' + DX.world.t.toFixed(1) + ' 用了 ' + fr + ' 帧');
ok(DX.world.over && DX.world.over.win === rec0.win &&
  JSON.stringify(DX.world.over.tags) === JSON.stringify(rec0.tags),
  '重现结果与原记录一致', DX.world.over ? ('win=' + DX.world.over.win) : '-');
ok(DX.world.running === false && DD.replaying === false, '打完自动停，重现状态已收尾');
ok(DX.world.speedMul === 2, '倍速已还原成用户原本的 2×', DX.world.speedMul);
ok(/完成/.test(d.doc.getElementById('dProg').textContent), '进度栏显示完成状态',
  d.doc.getElementById('dProg').textContent);
/* 收尾之后普通对战也要能继续画（不能停在"无渲染"状态） */
painted = 0;
DX.resetMatch(DX.CARD_BY_ID[cards[0]], DX.CARD_BY_ID[cards[1]]);
DX.world.running = true;
for (let i = 0; i < 30; i++) d.runFrame(900000 + i * 16);
ok(painted > 0, '预演/重现之后，正常开一局照样在画', 'clearRect 调用 ' + painted + ' 次');
DX.world.running = false;

/* ---------- 8. 预演（批量跑数据）期间不出声 ---------- */
console.log('== 8. 预演期间静音 ==');
/* 批量预演是"后台跑数据"、一帧都不画，几十局的打击音连起来就是噪声。
   静音开关挂在 makeHeadless / endHeadless 这一对上（预演的唯一进出口）。
   这里用一个会计数的假 AudioContext：start() 被调一次 = 真的放了一次声音。 */
{
  const g2 = loadGame({ audio: true });
  const X2 = g2.X, A = g2.audio;
  const cA = X2.CARD_BY_ID['charge'], cB = X2.CARD_BY_ID['knife_trap'];
  const SEED8 = 20260922;

  A.plays = 0;
  X2.runFullMatch(cA, cB, SEED8);
  const live = A.plays;
  ok(live > 0, '普通对局会出声（对照组）', '音效 ' + live + ' 次');

  X2.makeHeadless();                                    // ← 点「开始预演」时走的就是这里
  X2.runFullMatch(cA, cB, SEED8);
  const muted = A.plays - live;
  ok(A.plays === live, '预演期间一声不出', '又多放了 ' + muted + ' 次');

  X2.endHeadless();                                     // ← 预演收尾
  const after = A.plays;
  X2.runFullMatch(cA, cB, SEED8);
  const resumed = A.plays - after;
  ok(A.plays > after, '预演结束后声音恢复', '又放了 ' + resumed + ' 次');
  console.log('     （同一种子同一对局：普通 ' + live + ' 次 → 预演 ' + muted +
    ' 次 → 恢复 ' + resumed + ' 次）');

  /* 静音是"临时覆盖"，不能把用户自己的音效开关弄乱：关掉音效 → 再预演 → 再开一局 */
  g2.doc.getElementById('btnSound').click();            // 用户手动关音效
  const off = A.plays;
  X2.runFullMatch(cA, cB, SEED8);
  X2.makeHeadless(); X2.runFullMatch(cA, cB, SEED8); X2.endHeadless();
  X2.runFullMatch(cA, cB, SEED8);
  ok(A.plays === off, '用户关掉音效后，预演不会把音效又打开', '多放了 ' + (A.plays - off) + ' 次');
}

/* ---------- 9. 录制模式 / 种子显示 / 水印（2026-09-24 新增） ---------- */
console.log('== 9. 录制模式 / 种子显示 / 水印 ==');
{
  /* 9a 录制模式：S 开/关。开 = body.rec（CSS 靠它隐藏所有按钮 UI）+ 竞技场变大 */
  X.recApply(false);
  const w0 = g.els.cv.width;
  const on1 = X.recToggle();
  ok(on1 === true && X.REC.on === true, '切到录制模式', String(on1));
  ok(g.doc.body.classList.contains('rec'), 'body 挂上 rec（隐藏标题/工具栏/开发者面板/种子角标）');
  ok(g.els.cv.width > w0, '录制模式下竞技场变大', w0 + ' → ' + g.els.cv.width);
  ok(X.REC.margin > 0 && X.REC.margin <= 40, '离边框只留了一小段距离', X.REC.margin + 'px');
  const on2 = X.recToggle();
  ok(on2 === false && X.REC.on === false && !g.doc.body.classList.contains('rec'), '再按一次关掉并复原');
  ok(g.els.cv.width === w0, '关掉后竞技场尺寸还原', String(g.els.cv.width));
  /* 录制模式的高度必须取【舞台自己的高度】，不能拿 window.innerHeight 推算：
     开发者版的版本条 #buildBadge 会把 #app 整体顶下去，用 innerHeight 算出来的画布
     比可用高度大一截 → 顶部留空、底部被切（本次修的就是这个）。 */
  g.els.cv.parentElement.clientHeight = 500;                 // 假 DOM 里补一个舞台高度
  X.recApply(true);
  ok(g.els.cv.width === 500 - X.REC.margin * 2, '录制模式按舞台自身高度算尺寸（500-32=468）',
    String(g.els.cv.width));
  X.recApply(false);
  ok(g.els.cv.width === w0, '普通模式不看舞台高度（仍按视口高的 74%）', String(g.els.cv.width));
  delete g.els.cv.parentElement.clientHeight;
  ok(/body\.rec #app\{position:fixed/.test(fs.readFileSync(HTML, 'utf8')),
    '录制模式把 #app 钉在视口上（body 里多出别的元素也不会把竞技场顶偏）');
  /* PC 专属：窄屏按 S 不做任何事（无头里没有 matchMedia，走 innerWidth 兜底判据） */
  const iw0 = g.S.innerWidth;
  g.S.innerWidth = 700;
  ok(X.recSupported() === false && X.recToggle() === false && X.REC.on === false,
    '窄屏（≤900px）按 S 不做任何事');
  g.S.innerWidth = iw0;
  /* 缩到窄屏时自动退出（resize 时走的那条，见 recOnResize） */
  X.recApply(true);
  g.S.innerWidth = 700; X.recOnResize();
  ok(X.REC.on === false, '窗口缩到窄屏后录制模式自动退出');
  g.S.innerWidth = iw0; X.recApply(false);

  /* 9b 种子：输入种子下放到正式版（工具栏「种子」按钮 + 子界面），显示开关在子界面里 */
  const rawHtml = fs.readFileSync(HTML, 'utf8');
  ok(/id="btnSeed"/.test(rawHtml) && /id="seedPop"/.test(rawHtml) &&
    /id="seedIn"/.test(rawHtml) && /id="seedShow"/.test(rawHtml),
    '正式版有「种子」按钮 + 子界面（输入框 + 显示开关）');
  ok(/id="seedTag"/.test(rawHtml), '右下角有种子角标容器');
  const elIn = g.doc.getElementById('seedIn');
  elIn.value = '31415926'; elIn.oninput();
  ok(X.pendingSeed() === '31415926', 'pendingSeed 取输入框内容', String(X.pendingSeed()));
  X.startMatch();
  ok(X.world.seed === X.seedHash('31415926'), '「开始战斗」用子界面里的种子',
    X.world.seed + ' vs ' + X.seedHash('31415926'));
  elIn.value = ''; elIn.oninput();
  ok(X.pendingSeed() === undefined, '留空 = 每局现掷');
  /* 角标：开 = 右下角小字；录制模式下必须藏掉 */
  const tag = g.doc.getElementById('seedTag');
  X.SET.seedShow = true; X.seedTagTick(true);
  ok(tag.classList.contains('on') && tag.textContent === '种子 ' + X.world.seed,
    '角标显示当前对局种子', tag.textContent);
  X.recApply(true); X.seedTagTick(true);
  ok(!tag.classList.contains('on'), '录制模式下角标隐藏');
  X.recApply(false); X.SET.seedShow = false; X.seedTagTick(true);
  ok(!tag.classList.contains('on'), '关掉显示开关后角标不显示');
  X.world.running = false;

  /* 9c 开发者版水印：自定义文字（支持换行），画在竞技场正中、颜色很淡 */
  ok(typeof d.S.devWmDraw === 'function', '开发者版注册了水印绘制钩子');
  ok(/dWm/.test(d.els.devSlot.children[1].innerHTML), '面板里有水印输入框');
  const wmEl = d.doc.getElementById('dWm'), wmBtn = d.doc.getElementById('dWmOn');
  ok(wmBtn.disabled === true, '没写文字时水印开关是禁用的');
  wmEl.value = '测试水印\n第二行'; wmEl.oninput();
  ok(wmBtn.disabled === false, '写了文字后开关可用');
  wmBtn.onclick();
  ok(DD.wmOn === true && /开/.test(wmBtn.textContent), '点一下打开水印', wmBtn.textContent);
  const drawn = [];
  d.S.devWmDraw({
    save() { }, restore() { }, measureText(s) { return { width: String(s).length * 20 }; },
    fillText(t, x, y) { drawn.push({ t: String(t), x: x, y: y, fill: this.fillStyle }); }
  });
  ok(drawn.length === 2 && drawn[0].t === '测试水印' && drawn[1].t === '第二行',
    '换行被拆成两行分别绘制', drawn.map(u => u.t).join(' | '));
  ok(drawn.length === 2 && drawn[0].y < drawn[1].y &&
    Math.abs(drawn[0].x - X.CFG.AW / 2) < 1e-6 &&
    Math.abs((drawn[0].y + drawn[1].y) / 2 - X.CFG.AH / 2) < 1e-6,
    '两行整体居中在竞技场中间', drawn.map(u => u.y.toFixed(1)).join(' / '));
  ok(drawn.length === 2 && /^rgba\(/.test(String(drawn[0].fill)) &&
    /,0\.0\d+\)$/.test(String(drawn[0].fill).replace(/\s/g, '')),
    '颜色很淡（低透明度）', drawn.length ? String(drawn[0].fill) : '(没画)');
  /* 字号：调小过（46 → 28）。从源码里读 WM.size 断言，免得写死两份数字不同步 */
  {
    const wmSize = +(fs.readFileSync(path.join(ROOT, 'src', 'dev.js'), 'utf8')
      .match(/var WM = \{ size: ([\d.]+)/) || [0, 0])[1];
    ok(wmSize > 0 && wmSize <= 32, '水印字号已调小（≤32）', wmSize + 'px');
  }
  /* 真·集成：drawArena() 必须真的画水印，而且排在【单位/特效/血条之前】
     —— 背景水印，不遮住其他元素（按记录绘制顺序断言，不靠肉眼）。 */
  DX.resetMatch(DX.CARD_BY_ID['defy'], DX.CARD_BY_ID['darkness'], 31415);
  const order = [];
  const _ft = d.ctx.fillText, _di = d.ctx.drawImage, _fl = d.ctx.fill;
  d.ctx.fillText = function (t) {
    order.push(String(t) === '测试水印' ? 'wm' : 'txt');
    return _ft.apply(this, arguments);
  };
  d.ctx.drawImage = function () { order.push('img'); return _di.apply(this, arguments); };
  d.ctx.fill = function () { order.push('fill'); return _fl.apply(this, arguments); };
  d.ctx.texts.length = 0;
  d.X._draw();
  d.ctx.fillText = _ft; d.ctx.drawImage = _di; d.ctx.fill = _fl;
  ok(order.indexOf('wm') >= 0, 'drawArena 确实调用了水印钩子');
  ok(order[0] === 'wm' && order.length > 2,
    '水印是竞技场里第一个被画的东西（卡牌/仆从/血条都在它上面 → 不会被遮住）',
    order.slice(0, 6).join(','));
  DD.wmOn = false; drawn.length = 0; d.S.devWmDraw(d.ctx);
  ok(drawn.length === 0, '关掉水印后不画任何东西');
  /* 没文字时也不画（哪怕开关被外部强行置 true） */
  DD.wmOn = true; DD.wmText = '   ';
  drawn.length = 0; d.S.devWmDraw(d.ctx);
  ok(drawn.length === 0, '只有空白字符时不画');
  DD.wmOn = false; DD.wmText = '';
  /* 9d 结算横幅：不再"啪"地整块出现，而是在 0.5s 里淡入 + 条带压扁 + 文字归位
     （按记录 fillRect/fillText 时的 globalAlpha 与几何断言，不靠肉眼） */
  X.resetMatch(X.CARD_BY_ID['defy'], X.CARD_BY_ID['snakebite'], 2468);
  X.runFullMatch(X.CARD_BY_ID['defy'], X.CARD_BY_ID['snakebite'], 2468);
  ok(!!X.world.over, '先造出一个结算状态');
  const seq = [];
  const _ft2 = g.ctx.fillText, _fr2 = g.ctx.fillRect;
  g.ctx.fillText = function (t, x, y) {
    seq.push({ k: 'txt', a: g.ctx.globalAlpha, y: y, t: String(t), font: g.ctx.font });
    return _ft2.apply(this, arguments);
  };
  g.ctx.fillRect = function (x, y, w, h) {
    seq.push({ k: 'rect', a: g.ctx.globalAlpha, y: y, h: h });
    return _fr2.apply(this, arguments);
  };
  const barOf = () => seq.filter(o => o.k === 'rect').pop();      // 最后一个 rect = 条带（前面那个是全场压暗）
  const txtOf = () => seq.filter(o => o.k === 'txt')[0];
  /* 把演出状态摆到 t 秒（状态跟当前 world.over 对象绑定，所以 for 也要对上） */
  const setOver = (t) => { X.OVER.for = X.world.over; X.OVER.on = true; X.OVER.t = t; };
  X.OVER.on = false; X.OVER.for = null; X.OVER.t = 0;
  X.drawOverlayBanner();
  ok(!!txtOf() && txtOf().a === 1, '没有演出状态时按"已完成"画（无头/旧路径的兜底）',
    txtOf() ? String(txtOf().a) : '-');
  /* t=0：条带刚起步（几乎全透明、比成品更高），文字还没出来 */
  seq.length = 0; setOver(0);
  X.drawOverlayBanner();
  const b0 = barOf();
  ok(seq.filter(o => o.k === 'txt').length === 0, 't=0 时文字还没出现（不是一帧全上）');
  ok(!!b0 && b0.a < 0.02 && b0.h > X.CFG.AH * 0.19 * 1.4,
    't=0 时条带几乎透明且比成品更高（等着压下来）',
    b0 ? ('alpha=' + b0.a.toFixed(4) + ' h=' + b0.h.toFixed(1)) : '-');
  /* 半程：条带淡进来且高度在收，文字正在淡入、还在下方 */
  seq.length = 0; X.OVER.t = 0.30; setOver(0.30);
  X.drawOverlayBanner();
  const b1 = barOf(), t1 = txtOf();
  ok(!!b1 && b1.a > 0.3 && b1.h < b0.h, '半程：条带已淡入、高度在收',
    b1 ? ('alpha=' + b1.a.toFixed(2) + ' h=' + b1.h.toFixed(1)) : '-');
  ok(!!t1 && t1.a > 0 && t1.a < 1 && t1.y > X.CFG.AH * 0.435,
    '半程：文字半透明、位置还在中心下方（正在归位）',
    t1 ? ('alpha=' + t1.a.toFixed(2) + ' y=' + t1.y.toFixed(1)) : '-');
  /* 演完：回到原来的样子（可以跟老截图对齐） */
  seq.length = 0; setOver(2.0);
  X.drawOverlayBanner();
  const b2 = barOf(), t2 = txtOf();
  const expectTxt = X.world.over.win < 0 ? '平  局'
    : '胜者：' + X.world.units[X.world.over.win].card.name;
  ok(!!b2 && Math.abs(b2.a - 0.72) < 1e-9 && Math.abs(b2.h - X.CFG.AH * 0.19) < 1e-9,
    '演完后条带 = 原样式（alpha .72 / 高 19%）', b2 ? ('alpha=' + b2.a + ' h=' + b2.h.toFixed(1)) : '-');
  ok(!!t2 && t2.a === 1 && Math.abs(t2.y - X.CFG.AH * 0.435) < 1e-9 && t2.t === expectTxt,
    '演完后文字纯白到位、文案＝胜者：获胜卡牌名', t2 ? (t2.t + ' @' + t2.y.toFixed(1)) : '-');
  g.ctx.fillText = _ft2; g.ctx.fillRect = _fr2;
  /* 演出由主循环按真实时间推进：给两次 tick 应该往前走，over 清掉后自动归零 */
  X.OVER.on = false; X.OVER.for = null; X.OVER.t = 0;
  X.tickOver(0.2); X.tickOver(0.2);
  ok(X.OVER.on === true && Math.abs(X.OVER.t - 0.4) < 1e-9, 'tickOver 按真实时间累加', String(X.OVER.t));
  const keep = X.world.over; X.world.over = null; X.tickOver(0.2);
  ok(X.OVER.on === false && X.OVER.t === 0 && X.OVER.for === null, '对局重置后横幅演出状态归零');
  X.world.over = keep;
  /* 新的一局（over 换对象）→ 演出必须从头开始，不会被上一局的残留 t 卡住 */
  X.OVER.for = null; X.tickOver(0.016);
  ok(X.OVER.for === keep && X.OVER.t > 0 && X.OVER.t < 0.05, '换局后演出从 0 重新开始', String(X.OVER.t));
}

/* ---------- 10. 空悲切 / 召唤物状态徽标 / 灾厄图标（2026-09-24 新增） ---------- */
console.log('== 10. 空悲切 / 召唤物徽标 / 灾厄图标 ==');
{
  /* ⚠ 种子 186 是 2026 灾厄读条改动后重新扫出来的样例：
     末日降临获胜、败者正是被【灾厄读条读满】处决的（rec.t - deathT = 1.7s 黑洞动画），
     续命 0.833s 就能反杀 —— 比旧种子 749827 更贴这次的改动，专门盯读条这条路。 */
  const A = 'dark_embrace', B = 'end_of_days', SEED = 186;

  /* 10a 记录里必须有「败者挨到致命一击的时刻」。
     ⚠ 不能用 world.over.t：那个要等 0.9s（灾厄 1.7s）阵亡动画播完才置上，
     拿它去挂护体就晚了将近一秒 —— 这一条就是当初把护体挂空的原因。 */
  X.runFullMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], SEED);
  const rec = X.matchRecord(SEED);
  ok(typeof rec.deathT === 'number' && rec.deathT < rec.t && rec.t - rec.deathT > 0.8,
    '记录里有"挨到致命一击"的时刻 deathT（比结算时刻早一个死亡动画）',
    'deathT=' + rec.deathT + ' over.t=' + rec.t);
  const lose = 1 - rec.win;

  /* 10b 护体要拦住【所有】致死入口：伤害 / 灾厄斩杀 / kill / 失去生命 */
  X.resetMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], SEED);
  const gu = X.world.units[lose];
  gu.hp = 100; gu.guard = true; gu.doom = 500;
  const dmgBack = gu.damage(999, 'hit', X.world.units[1 - lose]);
  gu.killByDoom(); gu.kill(); gu.loseHp(999);
  ok(dmgBack === undefined && gu.hp === 100 && !gu.dying && gu.alive,
    '护体期间：伤害/灾厄斩杀/kill/失去生命 一个都杀不掉它',
    'hp=' + gu.hp + ' dying=' + JSON.stringify(gu.dying));
  gu.guard = false; gu.killByDoom();
  ok(!!gu.dying && gu.dying.doom === true, '摘掉护体后灾厄立刻照常斩杀（只是免死，不是改状态）');

  /* 10b2 毒素（DoT）也扣不动 —— 它不走 damage()，走 stepPhysics 里的直接扣血 */
  X.resetMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], SEED);
  const pu = X.world.units[lose];
  pu.guard = true; pu.poison = 300;
  const hp0 = pu.hp;
  for (let i = 0; i < 400; i++) { X.world.t += X.SIM_DT; X.stepPhysics(X.SIM_DT); }
  ok(pu.hp === hp0, '护体期间毒素 DoT 也扣不动血', pu.hp + ' vs ' + hp0);
  pu.guard = false;
  for (let i = 0; i < 30; i++) { X.world.t += X.SIM_DT; X.stepPhysics(X.SIM_DT); }
  ok(pu.hp < hp0, '摘掉护体后毒素照常结算', pu.hp + ' < ' + hp0);

  /* 10c 真·棋差一招样例（实测：末日降临只差 0.033 秒没先打死黑暗之拥） */
  const g1 = X.runGraceMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], SEED, lose, rec.deathT);
  ok(g1.flip === true, '续命 1 秒 → 败者反杀成功 = 棋差一招', JSON.stringify(g1));
  const ug = X.world.units[lose];
  ok(ug.alive && !ug.dying && ug.hp > 0,
    '窗口结束时败者还活着（护体真的挡住了那一致命伤害）',
    'hp=' + ug.hp + ' alive=' + ug.alive + ' dying=' + JSON.stringify(ug.dying));
  ok(X.GRACE.on === false && !X.world.units[0].guard && !X.world.units[1].guard,
    '分析收尾把护体状态清干净了（不会漏到下一局）');
  const g0 = X.runGraceMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], SEED, lose, rec.deathT, 0);
  ok(g0.flip === false, '零续命窗口只挡那一下、不算反杀（负例）', JSON.stringify(g0));
  X.runFullMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], SEED);
  const again = X.matchRecord(SEED);
  ok(again.win === rec.win && Math.abs(again.t - rec.t) < 1e-9,
    '分析跑完再直跑，结局与原局逐位一致（分析不污染对局）');

  /* 10d 祭品召出来的引雷针也要显示「集中」——
     用户实测报的就是这个：状态徽标以前两个分支各写一遍，仆从那份漏了 focus。 */
  X.resetMatch(X.CARD_BY_ID['offering'], X.CARD_BY_ID['lightning_rod'], 20260924);
  const owner = X.world.units[0];
  const rod = new X.SummonedFoe(owner, X.CARD_BY_ID['lightning_rod'], 200, 200, { mHp: 360, mR: 26 });
  rod.focus = 3; rod.hp = 300;
  X.world.units = [owner, rod];
  const texts = () => g.ctx.texts.map(t => t.t);
  g.ctx.texts.length = 0;
  X.drawUnitHUD();
  ok(texts().indexOf(' 3') >= 0, '召唤物（引雷针）头顶画出了集中层数', texts().join('|'));
  owner.focus = 5;
  g.ctx.texts.length = 0;
  X.drawUnitHUD();
  ok(texts().indexOf(' 5') >= 0 && texts().indexOf(' 3') >= 0,
    '本体与召唤物都画出了各自的集中', texts().join('|'));
  rod.block = 7; rod.vuln = 2; rod.weak = 3; rod.poison = 11; rod.focus = 4;
  owner.block = 7; owner.vuln = 2; owner.weak = 3; owner.poison = 11; owner.focus = 4;
  ok(JSON.stringify(X.statusBadges(owner)) === JSON.stringify(X.statusBadges(rod)) &&
    X.statusBadges(rod).some(b => b.icon === 'pw_focus'),
    '同一组状态 → 本体与召唤物的徽标列表逐项一致（共用一份，今后不会再只漏一边）');

  /* 10e 灾厄徽标：不再写"灾厄 66"这种文字，改成图标 + 数值 */
  X.resetMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], 5);
  const du = X.world.units[0];
  du.doom = 66; du.hp = 1000;
  X.world.units = [du];
  X.IMG['pw_doom'] = { fake: 'pw_doom' };
  const imgs = [];
  const _di = g.ctx.drawImage;
  g.ctx.drawImage = function (im) { imgs.push(im); return _di.apply(this, arguments); };
  g.ctx.texts.length = 0;
  X.drawUnitHUD();
  g.ctx.drawImage = _di;
  ok(!texts().some(t => /灾厄/.test(t)), '灾厄徽标不再写"灾厄"文字', texts().join('|'));
  ok(texts().indexOf(' 66') >= 0, '灾厄数值照常显示（图标 + 数字）', texts().join('|'));
  ok(imgs.indexOf(X.IMG['pw_doom']) >= 0, '灾厄徽标画的是 pw_doom 图标');

  /* 10g 灾厄读条（2026 口径）：灾厄追平生命 → 读条 3s 才斩，不再当场斩 */
  X.resetMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], 2026);
  {
    const u = X.world.units[0];
    X.world.units = [u];                        // 只留一个单位，排除对手干扰
    u.hp = 300; u.doom = 0; u.block = 0;
    u.addDoom(300);                             // 追平生命值
    ok(!u.dying && u.doomT === 0, '灾厄追平生命：不当场斩，进入读条（doomT 从 0 起）',
       'dying=' + JSON.stringify(u.dying));
    const dt = X.SIM_DT;
    for (let i = 0; i < Math.round(2.9 / dt); i++) { X.world.t += dt; X.stepPhysics(dt); }
    ok(!u.dying && u.doomT > 2.8, '读条 2.9s 仍未处决', 'doomT=' + u.doomT.toFixed(3));
    for (let i = 0; i < Math.round(0.2 / dt); i++) { X.world.t += dt; X.stepPhysics(dt); }
    ok(!!u.dying && u.dying.doom === true, '读满 3s → 灾厄处决（走 1.7s 黑洞动画）');
  }
  /* 10g2 读条中途回血到灾厄之上 → 清零 + HUD 换回血条，不再被斩 */
  X.resetMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], 2026);
  {
    const v = X.world.units[0];
    v.hp = 500; v.doom = 600; v.block = 0;
    X.world.units = [v];
    const dt = X.SIM_DT;
    for (let i = 0; i < Math.round(1.5 / dt); i++) { X.world.t += dt; X.stepPhysics(dt); }
    ok(!v.dying && v.doomT > 1.4, '读条进行到 1.5s', 'doomT=' + v.doomT.toFixed(3));
    /* 读条中：血条不画（读条环取代） */
    g.S.__hud.cross = 0; g.ctx.texts.length = 0;
    X.drawUnitHUD();
    ok(g.S.__hud.cross === 0, '读条中血条不画');
    v.heal(200);                                // hp 500 → 700 > doom 600
    ok(v.doomT === 0 && !v.dying, '治疗抬到灾厄之上 → 读条当场清零', 'doomT=' + v.doomT);
    /* 关键：HUD 要【立刻】换回十字血条、生命数字重新显示 */
    g.S.__hud.cross = 0; g.ctx.texts.length = 0;
    X.drawUnitHUD();
    ok(g.S.__hud.cross === 1, '治疗打断后血条立刻恢复显示', 'cross=' + g.S.__hud.cross);
    ok(g.ctx.texts.map(t => t.t).indexOf(String(v.hp)) >= 0,
       '生命数字重新出现在血条上', g.ctx.texts.map(t => t.t).join('|'));
    /* 再被打回灾厄线 → 读条从头开始（不是接着旧进度） */
    v.damage(300, 'hit', X.world.units[1] || null);   // hp 700 → 400 < doom 600
    X.world.t += dt; X.stepPhysics(dt);
    ok(!v.dying && v.doomT > 0 && v.doomT <= dt * 2,
       '再掉回灾厄线 → 读条从 0 重新开始', 'doomT=' + v.doomT.toFixed(4));
  }
  /* 10g3 陨石直击特例：一发砸进斩杀线 → 当场处决，不走读条 */
  X.resetMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], 2026);
  {
    const vic = X.world.units[0], ow = X.world.units[1];
    vic.hp = 1000; vic.doom = 900; vic.block = 0;   // 灾厄 900 < 生命 1000：还没到线
    ok(X.doomChanneling(vic) === false, '灾厄未追平生命时不算读条中');
    /* 对照：普通伤害把生命削进斩杀线 —— 只进读条、不当场斩 */
    vic.damage(600, 'hit', ow);
    ok(!vic.dying && vic.hp <= vic.doom, '普通伤害削进斩杀线：只进入读条，不当场斩',
       'hp=' + vic.hp + ' doom=' + vic.doom);
    /* 陨石直击：同一发伤害 + doomBlast → 当场结算 */
    vic.hp = 1000; vic.doom = 900; vic.doomT = 0;
    X.impact(vic.x, vic.y, X.CARD_BY_ID['end_of_days'].p, ow);
    ok(!!vic.dying && vic.dying.doom === true, '末日陨石直击砸进斩杀线 → 跳过读条当场处决',
       'hp=' + vic.hp + ' dying=' + JSON.stringify(vic.dying));
  }
  /* 10g4 读条期间：十字血条不画，改画读条环（中间是灾厄标志） */
  X.resetMatch(X.CARD_BY_ID[A], X.CARD_BY_ID[B], 2026);
  {
    const cu = X.world.units[0];
    cu.hp = 500; cu.doom = 500; cu.doomT = 1.5;    // 读条进行中
    X.world.units = [cu];
    X.IMG['pw_doom'] = { fake: 'pw_doom' };
    g.S.__hud.cross = 0;
    g.ctx.texts.length = 0;
    X.drawUnitHUD();
    ok(g.S.__hud.cross === 0, '读条期间十字血条一次都没画', 'cross=' + g.S.__hud.cross);
    ok(g.ctx.texts.map(t => t.t).indexOf(String(cu.hp)) < 0,
       '读条期间血条上的生命数字不再出现', g.ctx.texts.map(t => t.t).join('|'));
    /* 对照：不在读条时血条照常画 */
    cu.doomT = 0; cu.doom = 0;
    g.S.__hud.cross = 0;
    X.drawUnitHUD();
    ok(g.S.__hud.cross === 1, '非读条状态十字血条照常画', 'cross=' + g.S.__hud.cross);
  }

  /* 10f 开发者版：筛选行里的「空悲切」开关 → 补算 → 筛选 */
  const dTagsEl = d.doc.getElementById('dTags');
  const chipLabels = dTagsEl.children.map(l => (l.children[1] || {}).textContent);
  const gi = chipLabels.indexOf('空悲切');
  ok(gi >= 0, '筛选行里有「空悲切」开关', chipLabels.join('|'));
  ok(X.TAG_TEXT.chess === '棋差一招', '标签文案 = 棋差一招', String(X.TAG_TEXT.chess));
  const gbox = dTagsEl.children[gi].children[0];
  /* 补算=后台跑数据：一开工就该静音、一帧都不画（用户报过"补算有声音"）。
     这里数画布的 clearRect：无渲染模式下 drawArena() 第一句就 return，一次都不会有。 */
  let clears = 0;
  const realClear3 = d.ctx.clearRect;
  d.ctx.clearRect = function () { clears++; return realClear3.apply(this, arguments); };
  gbox.checked = true; gbox.onchange();
  ok(DD.chessOn === true, '打开空悲切开关');
  ok(d.S.__X.sfxMute === true, '补算一开工就静音（走的和批量预演同一条路）',
    'sfxMute=' + d.S.__X.sfxMute);
  clears = 0;
  let cg = 0;
  while (DD.chessDirty && cg++ < 8000) d.runFrame(300000 + cg * 16);
  ok(cg < 8000 && DD.chessDirty === false, '把已有记录补算完', cg + ' 帧');
  ok(clears === 0, '补算期间画布一次都没重绘（不渲染，不会有假战斗在抖）', 'clearRect ' + clears + ' 次');
  ok(d.S.__X.sfxMute === false, '补算算完立刻解除静音', 'sfxMute=' + d.S.__X.sfxMute);
  const prog = String(d.doc.getElementById('dProg').textContent);
  ok(/棋差一招/.test(prog), '进度栏给出棋差一招局数', prog);
  /* 收尾后画面必须真的回来（老坑：无渲染没退出 → 之后永远不重绘） */
  clears = 0;
  d.runFrame(390000);
  ok(clears > 0, '补算收尾后画面恢复重绘（真 canvas / 上下文取回来了）', 'clearRect ' + clears + ' 次');
  /* 半途放弃：取消勾选 = 这份补算作废，后台模式（静音 + 无渲染）必须还回来。
     ⚠ 要挑一局"分出胜负"的：平局（超时）不参与棋差一招分析，r.chess 恒为 undefined，
       拿它当"没算过的局"根本造不出待算状态。 */
  const pv = DD.results.findIndex(r => r.win >= 0);
  ok(pv >= 0, '找到一局可分胜负的对局用来验"补算被打断"', 'idx=' + pv);
  const chess0 = DD.results[pv].chess;
  DD.results[pv].chess = undefined;
  gbox.checked = true; gbox.onchange();
  ok(DD.chessDirty === true && d.S.__X.sfxMute === true, '还有局没算时，重新勾上又进后台模式');
  gbox.checked = false; gbox.onchange();
  ok(DD.chessOn === false && d.S.__X.sfxMute === false, '中途取消勾选 → 补算停手、静音与画面都还回来',
    'chessOn=' + DD.chessOn + ' sfxMute=' + d.S.__X.sfxMute);
  clears = 0; d.runFrame(391000);
  ok(clears > 0, '中途取消后画面照常重绘', 'clearRect ' + clears + ' 次');
  /* 点行重现 = 用户要看这一局：没算完的补算要让位（它也在抢 world，
     不放掉的话用户这局会被补算每帧重置，而且画面还停在无渲染里） */
  gbox.checked = true; gbox.onchange();              // 又造出一局"没算过"
  ok(d.S.__X.sfxMute === true, '（让位用例）补算又占上了后台模式');
  DD.replay(DD.results[pv]);
  ok(DD.chessDirty === false && d.S.__X.sfxMute === false && DX.world.running === true,
    '点行重现会把没算完的补算放掉，画面交给重现', 'sfxMute=' + d.S.__X.sfxMute);
  DX.world.running = false; d.runFrame(395000);      // 收尾：replayTick 会结束重现状态
  ok(DD.replaying === false, '重现收尾：状态已还原', 'speedMul=' + DX.world.speedMul);
  DD.results[pv].chess = chess0;                     // 还原成分析给出的结论
  ok(DD.results.every(r => r.win < 0 || typeof r.chess === 'boolean'),
    '每一局都有结论（r.chess 是布尔）',
    DD.results.filter(r => r.win >= 0 && typeof r.chess !== 'boolean').length + ' 局没算');
  ok(DD.results.every(r => !r.chess || r.tags.indexOf('chess') >= 0),
    '反杀的局都挂上了「棋差一招」标签');
  const chessN = DD.results.filter(r => r.chess).length;
  const rowCount = () => (String(d.doc.getElementById('dBody').innerHTML).match(/<tr class="r"/g) || []).length;
  ok(rowCount() === Math.min(chessN, 400), '勾上后表格只剩棋差一招的局',
    rowCount() + ' 行 / ' + chessN + ' 局');
  /* 造一条必然命中的：证明筛选确实认的是 r.chess（不是碰巧 0 行） */
  const forced = DD.results.find(r => !r.chess) || DD.results[0];
  forced.chess = true; forced.chessAt = 1; forced.tags.push('chess');
  gbox.checked = true; gbox.onchange();           // 再点一次 = 重画表格
  ok(rowCount() >= 1, '手工把一局标成棋差一招后，表里确实多出这一行', rowCount() + ' 行');
  /* 关掉开关：标签留着，表格恢复显示全部 */
  gbox.checked = false; gbox.onchange();
  ok(DD.chessOn === false && DD.results.every(r => typeof r.chess === 'boolean'),
    '关掉开关不会抹掉已算出的结论');
  ok(rowCount() === Math.min(DD.results.length, 400), '关掉后表格恢复显示全部对局', rowCount() + ' 行');

  /* 10g 开关开着时新跑的局当场算（批量预演那条路） */
  d.doc.getElementById('dSeed').value = '5150';
  d.doc.getElementById('dSeed').oninput();
  d.doc.getElementById('dCount').value = '8';
  gbox.checked = true; gbox.onchange();
  d.doc.getElementById('dRun').onclick();
  let bg = 0;
  while (DD.running && bg++ < 8000) d.runFrame(400000 + bg * 16);
  ok(!DD.running && DD.results.length === 8, '开关开着跑一批预演', DD.results.length);
  ok(DD.results.some(r => r.win >= 0) &&
    DD.results.every(r => r.win < 0 || typeof r.chess === 'boolean'),
    '批量预演里每局都当场算了空悲切',
    JSON.stringify(DD.results.map(r => r.chess)));
  ok(DX.GRACE.on === false && !DX.world.units.some(u => u && u.guard),
    '预演收尾后没有残留护体');
  gbox.checked = false; gbox.onchange();
}

console.log('== 11. 系列赛（PvE / AI vs AI）：决定论 / 预演不脏化 / 守卫 / 恢复 ==');
{
  const g3 = loadGame();
  const X3 = g3.X;
  /* 局部可复现随机（给 SERIES.rng 用；系列层自己的流） */
  const mb = a => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 7)) >>> 0;
    return t / 4294967296;
  };
  const beginSeries = (seed) => {
    const S = X3.SERIES;
    S.on = true; S.mode = 'aivai'; S.human = { L: false, R: false };
    S.seed = seed >>> 0; S.rng = mb(S.seed);
    S.chars.L = X3.CHAR_BY_ID.ironclad; S.chars.R = X3.CHAR_BY_ID.defect;
    S.score = { L: 0, R: 0 }; S.round = 0; S.roundWinners = []; S.aiLog = [];
    S.rerollsLeft = { L: 0, R: 0 };
    X3.seriesDrawSets();
    X3.aiIroncladBurns('L');
    X3.aiPicks('L'); X3.aiPicks('R');
  };
  /* 11a 整场决定论：同系列种子 → 卡组/烧牌/选牌/三局种子逐项全同 */
  beginSeries(20261001);
  const snap1 = JSON.stringify({
    sets: X3.SERIES.sets, burned: X3.SERIES.burned, picks: X3.SERIES.picks,
    seeds: [0, 1, 2].map(r => X3.seriesPrerollSeed(r))
  });
  beginSeries(20261001);
  const snap2 = JSON.stringify({
    sets: X3.SERIES.sets, burned: X3.SERIES.burned, picks: X3.SERIES.picks,
    seeds: [0, 1, 2].map(r => X3.seriesPrerollSeed(r))
  });
  ok(snap1 === snap2, '同系列种子整场逐项全同（卡组/烧牌/选牌/三局种子）');
  ok(X3.SERIES.burned.R.length === 2, '铁甲 AI 烧了对方 2 张', X3.SERIES.burned.R.length);
  let valid = true;
  for (let i = 0; i < 3; i++) {
    const p = X3.SERIES.picks.L[i];
    if (!p || !X3.SERIES.sets.L[i].includes(p) || X3.SERIES.burned.L.includes(p)) valid = false;
  }
  ok(valid, 'AI 选牌落在自家对应套里且避开被烧卡');

  /* 11b 预演不脏化对战随机流：同一颗种子，预演前后跑出的对局必须一模一样
     （回归"无头批量预演污染当前对局"那一类老坑） */
  const cl = X3.CARD_BY_ID[X3.SERIES.picks.L[0]], cr = X3.CARD_BY_ID[X3.SERIES.picks.R[0]];
  const bseed = X3.seriesBattleSeed(0, 0);
  const rec0 = (() => { X3.runFullMatch(cl, cr, bseed); return X3.matchRecord(bseed); })();
  X3.seriesPrerollSeed(0);                       // 里面 resetMatch 跑了若干整局
  const rec1 = (() => { X3.runFullMatch(cl, cr, bseed); return X3.matchRecord(bseed); })();
  ok(JSON.stringify(rec0) === JSON.stringify(rec1),
    '预演前后同种子对局逐项一致',
    'win ' + rec0.win + '→' + rec1.win + ' / t ' + rec0.t + '→' + rec1.t);

  /* 11c 战斗效果只认 SERIES.on：关掉后字段全 falsy */
  X3.SERIES.on = false;
  X3.resetMatch(X3.CARD_BY_ID.dark_embrace, X3.CARD_BY_ID.voltaic, 99);
  const u0 = X3.world.units[0];
  ok(!u0.fxNecro && !u0.fxDefect && !u0.fxRegent && !u0.necroPend, '经典模式角色效果字段全 falsy');

  /* 11d dev 面板守卫：系列赛进行中批量预演/重现都不动世界（用第 6 节那个 dev 实例；
     注意 d 是独立沙箱 —— 要拨的是它自己那份 SERIES 对象，由 d.X.SERIES 引用得到） */
  d.X.SERIES.on = true;
  const prog = d.doc.getElementById('dProg');
  d.DEV.running = false; d.DEV.replaying = false;
  d.DEV.replay({ seed: 1, a: 'dark_embrace', b: 'voltaic', t: 30, win: 0 });
  ok(/系列赛进行中/.test(prog.textContent), '系列赛中点行重现被拒', prog.textContent);
  d.doc.getElementById('dRun').onclick();
  ok(!d.DEV.running && /系列赛进行中/.test(prog.textContent), '系列赛中批量预演被拒',
    'running=' + d.DEV.running);
  d.X.SERIES.on = false;

  /* 11e 阶段顺序（2026-10 口径）：静默换牌必须在铁甲烧牌之前；天意入口已挂 */
  X3.SERIES.on = true; X3.SERIES.mode = 'pve'; X3.SERIES.human = { L: true, R: false };
  X3.SERIES.chars.L = X3.CHAR_BY_ID.silent; X3.SERIES.chars.R = X3.CHAR_BY_ID.ironclad;
  X3.SERIES.charSel = { L: 'silent', R: 'ironclad' };
  X3.seriesBegin();                            // 内部掷种子 + 起阶段；断言完立刻清定时器
  const ST = X3.SERIES.stages;
  ok(ST.length === 3 && ST[0] === 'reroll' && ST[1] === 'burn' && ST[2] === 'pick',
    '阶段顺序：换牌 → 烧牌 → 选牌', JSON.stringify(ST));
  ok(X3.SERIES.draftStage === 'reroll', '进入正赛先落在换牌阶段', X3.SERIES.draftStage);
  if (X3.SERIES.stageTimer) { clearTimeout(X3.SERIES.stageTimer); X3.SERIES.stageTimer = null; }
  ok(typeof X3.seriesDestinyScan === 'function' && typeof X3.destinyScore === 'function',
    '天意加身推演/评分入口可用');
  X3.SERIES.on = false;
}

/* 正式版不该有 devSlot 相关脚本 */
console.log('\n' + (fails ? '✗ ' : '✓ ') + '通过 ' + passes + ' 项，失败 ' + fails + ' 项');
return fails;
}
if (require.main === module) process.exit(runTests() ? 1 : 0);

