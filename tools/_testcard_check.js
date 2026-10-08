/**
 * 验证「测试版卡牌」开关：关 → 15 张缩略图（3 行），开 → 20 张（4 行）。
 * 直接打桩 DOM，按 id 抓 setBuildPanel() 生成的按钮，再模拟点击开关。
 * 用法: node tools/_testcard_check.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const HTML = path.join(__dirname, '..', '杀戮塔小球对决.html');
const ALT = path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const file = fs.existsSync(ALT) ? ALT : HTML;
const blocks = (fs.readFileSync(file, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = blocks.sort((a, b) => b.length - a.length)[0];
src += `\nglobalThis.__T = { CARDS, testList, setBuildPanel, SEL, get SET() { return SET; } };\n`;

const store = {};
const grad = () => ({ addColorStop() { } });
/* 2D 上下文桩：fit() 会走 cv.getContext('2d')，返回 null 会在 imageSmoothingEnabled 上炸 */
function ctx2d() {
  const t = {
    createLinearGradient: grad, createRadialGradient: grad, createPattern: () => null,
    measureText: () => ({ width: 10 }),
  };
  return new Proxy(t, { get(o, k) { return (k in o) ? o[k] : () => { }; }, set(o, k, v) { o[k] = v; return true; }, has() { return true; } });
}
function stubEl(id) {
  const el = {
    id: id || '', style: {}, dataset: {}, children: [], disabled: false,
    textContent: '', title: '', clientWidth: 700, clientHeight: 700, innerHTML: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, v) { if (v === undefined) v = !this._s.has(c); v ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { width: 700, height: 700, top: 0, left: 0 }; },
    setAttribute() { }, getAttribute() { return null; },
    getContext() { return ctx2d(); }, closest() { return null; }, parentElement: null,
    onclick: null,
  };
  el.parentElement = el;
  return el;
}
const els = {};
const sandbox = {
  document: {
    getElementById(id) { return els[id] || (els[id] = stubEl(id)); },
    createElement() { return stubEl(); },
    createTextNode(t) { return { nodeValue: t, textContent: t }; },
    addEventListener() { }, querySelector() { return null; },
  },
  window: { addEventListener() { }, devicePixelRatio: 1, innerHeight: 900, innerWidth: 1400 },
  Image: class { constructor() { this.naturalWidth = 300; this.naturalHeight = 423; } },
  Path2D: class { moveTo() { } lineTo() { } arcTo() { } closePath() { } rect() { } arc() { } },
  requestAnimationFrame: () => 0, cancelAnimationFrame() { },
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  setTimeout, clearTimeout, console, Math, Date, JSON, Object, Array, String, Number,
  Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.html' });
const T = sandbox.__T;

let bad = 0;
function check(name, ok, extra) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) bad++;
}

/* ⚠ 桩里的 innerHTML='' 不会清 children（真 DOM 会），所以数按钮个数只能
   数"最后一次重建之后 append 进去的那批" —— 这里按 dataset.cid 去重来数。 */
function thumbIds(el) {
  const th = el.children.find(c => c.className === 'thumbs');
  const seen = [];
  for (const b of th.children) if (b.dataset && b.dataset.cid && !seen.includes(b.dataset.cid)) seen.push(b.dataset.cid);
  return seen;
}

console.log('— 默认（测试版关）—');
let list = T.testList();
check('选卡列表 15 张', list.length === 15, `实际 ${list.length}`);
check('不含测试版卡', !list.some(c => c.test));
const panelL = els['panelL'];
check('左面板缩略图 15 个', thumbIds(panelL).length === 15, `实际 ${thumbIds(panelL).length}`);

console.log('— 打开测试版卡牌 —');
T.setBuildPanel();
const btn = els['setTestBtn'];
check('设置里有测试版开关', !!btn);
btn.onclick();
list = T.testList();
check('选卡列表 20 张', list.length === 20, `实际 ${list.length}`);
check('SET.testCards = true', T.SET.testCards === true);
check('已写入 localStorage', /"testCards":true/.test(store['sts2ball.set'] || ''), store['sts2ball.set']);
const thumbs = thumbIds(panelL);
check('左面板缩略图 20 个', thumbs.length === 20, `实际 ${thumbs.length}`);
const ids = thumbs;
for (const id of ['offering', 'afterimage', 'tracking', 'soul_storm', 'meteor_strike']) {
  check('缩略图含 ' + id, ids.includes(id));
}
check('按钮文案已更新', btn.textContent === '测试版卡牌: 开', btn.textContent);
check('当前选中项仍在列表里', ids.includes(T.SEL.L) && ids.includes(T.SEL.R), T.SEL.L + '/' + T.SEL.R);

console.log('— 再关掉 —');
btn.onclick();
check('回到 15 张', T.testList().length === 15);
check('回写 localStorage', /"testCards":false/.test(store['sts2ball.set'] || ''));

console.log(bad ? `\n!! 失败 ${bad} 项` : '\n✓ 全部通过');
process.exit(bad ? 1 : 0);
