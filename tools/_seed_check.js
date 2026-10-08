/* 校验：不传种子时必须现掷并真正灌进对战随机流。
 * 关注三件事：
 *   ① 外层的（模拟"网页每刷新一次"）种子不同 → 局内种子应不同、结果也应不同；
 *   ② 指定同一个种子 → 逐局完全一致（种子重现成立）；
 *   ③ world.seed 记的就是实际用的那个种子。
 * 用法：node tools/_seed_check.js [html]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
const blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
let src = blocks.sort((a, b) => b.length - a.length)[0];

function mul(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function stub() {
  const g = { createLinearGradient: () => ({ addColorStop() { } }), createRadialGradient: () => ({ addColorStop() { } }), createPattern: () => null, measureText: () => ({ width: 10 }) };
  const e = {
    style: {}, dataset: {}, children: [], disabled: false, textContent: '', title: '',
    clientWidth: 700, clientHeight: 700, innerHTML: '',
    classList: { add() { }, remove() { }, toggle() { } },
    appendChild(c) { return c; }, addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { width: 700, height: 700, top: 0, left: 0 }; },
    setAttribute() { }, getAttribute() { return null; },
    getContext() { return new Proxy(g, { get: (o, k) => k in o ? o[k] : () => { }, set: (o, k, v) => { o[k] = v; return true; }, has: () => true }); },
    closest() { return null; }, parentElement: null,
  };
  e.parentElement = e; return e;
}
function fresh(outSeed) {
  const m = Object.create(Math); m.random = mul(outSeed);
  const els = {};
  const sb = {
    document: { getElementById(id) { return els[id] || (els[id] = stub()); }, createElement: stub, createTextNode: t => ({ nodeValue: t }), addEventListener() { }, removeEventListener() { }, querySelector() { return null; } },
    window: { addEventListener() { }, devicePixelRatio: 1, innerHeight: 900, innerWidth: 1400 },
    Image: class { constructor() { this.naturalWidth = 300; this.naturalHeight = 423; } },
    Path2D: class { moveTo() { } lineTo() { } arcTo() { } closePath() { } rect() { } arc() { } },
    requestAnimationFrame: () => 0, cancelAnimationFrame() { },
    atob: s => Buffer.from(s, 'base64').toString('base64'),
    setTimeout, clearTimeout, console, Math: m, Date, JSON, Object, Array, String, Number,
    Map, Set, isNaN, parseFloat, parseInt, RegExp, Error, TypeError, Uint8Array, Promise, Symbol,
  };
  sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(src + '\nglobalThis.__T={world,CARD_BY_ID,resetMatch,stepPhysics};\n', sb, { filename: 'g' });
  return sb.__T;
}
function matches(T, n, explicit) {
  const W = T.world, DT = 1 / 60, out = [];
  for (let g = 0; g < n; g++) {
    const s = T.resetMatch(T.CARD_BY_ID.charge, T.CARD_BY_ID.volt_a || T.CARD_BY_ID.knife_trap, explicit);
    W.running = true;
    let steps = 0;
    while (!W.over && W.t < 60 && steps < 4000) { W.t += DT; T.stepPhysics(DT); steps++; }
    out.push(`[种子 ${s} 结局 ${W.over ? W.over.win : '-'} 用时 ${W.t.toFixed(2)}s 末位 x ${W.units.map(u => u.x.toFixed(0)).join('/')}]`);
  }
  return out;
}

console.log('— 不传种子（模拟"每次刷新网页"）：不同外层随机 → 种子与结果都应不同 —');
const a = matches(fresh(20260922), 3);
const b = matches(fresh(20260923), 3);
a.forEach((r, i) => console.log(`  A${i}  ${r}   ${b[i]}`));
console.log(`  → 三局里有几局和 B 相同：${a.filter((r, i) => r === b[i]).length}/3  （0 才对）`);

console.log('\n— 指定同一个种子 12345：应当逐局一字不差 —');
const c = matches(fresh(111), 2, 12345);
const d = matches(fresh(999), 2, 12345);
c.forEach((r, i) => console.log(`  C${i}  ${r}   ${d[i]}`));
console.log(`  → 得分：${c.every((r, i) => r === d[i]) ? '✓ 完全一致（种子重现成立）' : '✗ 不一致，种子重现坏了'}`);
