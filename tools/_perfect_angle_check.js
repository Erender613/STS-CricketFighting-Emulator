/* 完美打击夹角口径验收：显示/画线必须用【碰撞前一刻】的速度方向（2026-09-24 用户要求）。
 * 做法：resetMatch 后手工摆位、手工设双方方向，直接调 stepPhysics 触发一次碰撞，
 * 然后检查：
 *   ① GoldenLines 存的 dx/dy == 碰撞前方向（旧实现存的是反射后的弹开方向，这里必红）；
 *   ② AnglePing 的数字 == 碰撞前方向夹角（黄金夹角 137.5° 一例 + 普通角一例）。
 * 用法：node tools/_perfect_angle_check.js [html]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '杀戮尖塔小球对决.html');
const html = fs.readFileSync(HTML, 'utf8');
const blocks = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.slice(8, -9));
const src = blocks.sort((a, b) => b.length - a.length)[0];

function mul(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
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
  vm.runInContext(src + '\nglobalThis.__T={world,CARD_BY_ID,resetMatch,stepPhysics,GoldenLines,AnglePing};\n', sb, { filename: 'g' });
  return sb.__T;
}

let fail = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fail++;
}

function runCase(degTarget, label) {
  const T = fresh(20260924);
  const W = T.world;
  T.resetMatch(T.CARD_BY_ID.perfected_strike, T.CARD_BY_ID.knife_trap, 20260924);
  W.running = true;
  const a = W.units[0], b = W.units[1];
  /* 摆位：相距 100px（< 2R=108，保证下一步就触发碰撞），法线水平朝 +x */
  a.x = 300; a.y = 330; b.x = 400; b.y = 330;
  /* 手工设【碰撞前】方向：a 朝 +x；b 朝 degTarget 方向 */
  a.dx = 1; a.dy = 0; a.baseSpeed = 150; a.boost = 0;
  const rad = degTarget * Math.PI / 180;
  b.dx = Math.cos(rad); b.dy = Math.sin(rad); b.baseSpeed = 150; b.boost = 0;
  /* 记下碰撞前的方向（反射会改 dx/dy，先留底） */
  const preA = { dx: a.dx, dy: a.dy }, preB = { dx: b.dx, dy: b.dy };
  T.stepPhysics(1 / 60);
  /* 找本次碰撞产生的 GoldenLines / AnglePing */
  const gl = W.effects.find(x => x instanceof T.GoldenLines);
  const ap = W.effects.find(x => x instanceof T.AnglePing);
  console.log(`\n— 案例：${label}（期望夹角 ${degTarget}°）—`);
  if (!gl || !ap) { check('效果生成', false, gl ? '缺 AnglePing' : '缺 GoldenLines'); return; }
  /* ① 金线必须是"来路"：线方向与碰撞前方向同向（点积≈1），不能是反射后的弹开方向 */
  const same = (ln, pre) => {
    const n = Math.hypot(ln.dx, ln.dy) || 1, m = Math.hypot(pre.dx, pre.dy) || 1;
    return Math.abs((ln.dx / n) * (pre.dx / m) + (ln.dy / n) * (pre.dy / m)) > 0.999;
  };
  check('金线① = 我方碰撞前方向', same(gl.lines[0], preA));
  check('金线② = 敌方碰撞前方向', same(gl.lines[1], preB));
  /* ② 数字 = 碰撞前夹角。黄金夹角窗口 2.5° 内显示 '137.5°'，否则 deg.toFixed(0) */
  const exact = Math.abs(degTarget - 137.5) <= 2.5;
  const want = exact ? '137.5°' : degTarget.toFixed(0) + '°';
  check('弹出数字正确', ap.v === want, `显示 ${ap.v} / 期望 ${want} / exact=${ap.exact}`);
}

runCase(137.5, '黄金夹角');
runCase(60, '普通 60° 夹角');

console.log(fail === 0 ? '\n✓ 全部通过：完美打击现在按碰撞前一刻的速度方向显示夹角与画线' : `\n✗ ${fail} 项未过`);
process.exit(fail === 0 ? 0 : 1);
