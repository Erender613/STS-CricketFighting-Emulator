/* ============================================================
   恶魔之手（黑暗之拥）—— 贴图与动画照反编译原版「夜魇」的屏幕特效还原
   依据：C:\Users\shenl\Desktop\项目\STS2-Decompiled
     pck-extracted/scenes/vfx/cards/nightmare_hands_vfx.tscn
       · 贴图 images/packed/vfx/combat/spooky_hand.png（5 只手，都是同一张图）
       · 节点 modulate = Color(0.833333, 0.5, 1, 0.376471) + 加法混合（ADD）
     MegaCrit.Sts2.Core.Nodes.Vfx.Cards/NSpookyHandVfx.cs
       · 入场：scale 0 → 目标值（0.4~0.5s，TRANS_SPRING + EASE_OUT —— 冲过头再弹回）
       · 悬浮：rotation = 基准 + sin(t·speed)·intensity（speed 3~5、intensity 0.1~0.3），
               中段会卡顿几拍（幅度减半）
       · 退场：scale → 目标值×0.5（TRANS_BACK + EASE_IN），同时 alpha → 0
   本作没有"整屏 5 只手"的结构，改成从墙上的黑洞里伸出 1 只，抓住对手往回拖。
   ============================================================ */

/* 贴图几何常数：全部由 tools/spooky_fit.py 按实测算出，别手改。
   spooky_hand.png 是"白形 + 真 alpha"（不透明区均色 240,240,240），
   所以"乘法染色 + lighter 混合"就等价于原版的 modulate + ADD。 */
const DH = {
  IW: 184, IH: 254,      // 裁掉留白后的贴图尺寸
  U0: 157,               // 贴图顶端（前臂断面）的前臂中心 u —— 手臂接这里
  ROT: -0.20654,         // 前臂相对 +v 的自然倾角：把贴图转正后手臂才是一条直线
  TIPX: 262.6,           // 转正后"沿轴最远的实心像素"距断面的距离（贴图单位）
  LEN: 210,              // 希望手在场地里有多长 → 反推缩放
  TINT: '#d480ff',       // = Color(0.833, 0.5, 1)：淡紫
  A: 0.376,              // = 0.376471：原版 modulate 的 alpha
  HOLE: 54               // 黑洞沿墙面的半长轴
};
DH.S = DH.LEN / DH.TIPX;

/* 通用贴图染色（RGB 乘一下、保留原 alpha）——与 sbTint 同一套做法 */
function tintTex(key, color) {
  const im = IMG[key];
  return im ? sbTint(im, color) : null;
}

/* 入场回弹曲线（≈ Godot 的 TRANS_SPRING + EASE_OUT）：先冲到约 1.1 再落回 1 */
function springOut(u) {
  if (u >= 1) return 1;
  const c = 1.55, t = u - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
}

/* 椭圆黑洞：配色与结构完全照「末日降临」的 DoomHole（黑核 → 深紫 → 紫环），
   只是改成沿墙面(y)拉长、沿法线(x)压扁 —— 变成墙上的一道竖裂缝，手臂从里面穿出来。 */
function drawDemonHole(ctx, R, k) {
  k = clamp(k, 0, 1);
  if (k <= 0.002) return;
  const r = R * (0.30 + 0.70 * clamp(k * 1.7, 0, 1));
  ctx.save();
  ctx.scale(0.42, 1);
  ctx.globalAlpha = clamp(k * 2.4, 0, 1);
  const g = ctx.createRadialGradient(0, 0, r * 0.08, 0, 0, r);
  g.addColorStop(0, '#000000');
  g.addColorStop(0.60, '#0b0212');
  g.addColorStop(0.88, 'rgba(120,50,180,.85)');
  g.addColorStop(1, 'rgba(120,50,180,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.globalAlpha *= 0.85;
  ctx.strokeStyle = '#a86be0'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, TAU); ctx.stroke();
  ctx.restore();
}

/* 手臂：从洞口平直伸到贴图前臂的断面。宽度对齐断面半宽（≈17 贴图单位 × 缩放），
   不然接上去会出现台阶。 */
function drawDemonArm(ctx, len, hw, alpha) {
  if (len <= 5 || alpha <= 0.01) return;
  const aw = hw * 0.82;                    // 洞口略细，腕部对齐贴图
  ctx.save();
  ctx.globalAlpha = alpha;
  const body = function () {
    ctx.beginPath();
    ctx.moveTo(0, -aw);
    ctx.bezierCurveTo(len * 0.34, -aw * 1.10, len * 0.68, -hw, len, -hw);
    ctx.lineTo(len, hw);
    ctx.bezierCurveTo(len * 0.68, hw, len * 0.34, aw * 1.10, 0, aw);
    ctx.closePath();
  };
  body();
  const ag = ctx.createLinearGradient(0, -hw, 0, hw);
  ag.addColorStop(0, 'rgba(6,2,12,.97)');
  ag.addColorStop(0.22, '#150524');
  ag.addColorStop(0.46, '#2a0e46');
  ag.addColorStop(0.74, '#170528');
  ag.addColorStop(1, 'rgba(5,1,10,.97)');
  ctx.fillStyle = ag; ctx.fill();
  ctx.strokeStyle = 'rgba(10,2,18,.9)'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1, -aw * 0.94);
  ctx.bezierCurveTo(len * 0.34, -aw * 1.06, len * 0.68, -hw * 0.97, len, -hw * 0.97);
  ctx.strokeStyle = 'rgba(168,110,236,.40)'; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1, aw * 0.94);
  ctx.bezierCurveTo(len * 0.34, aw * 1.06, len * 0.68, hw * 0.97, len, hw * 0.97);
  ctx.strokeStyle = 'rgba(96,46,158,.28)'; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.restore();
}

/* live = { pop 入场回弹, shrink 额外缩放, alpha 总体不透明度, hole 洞口张开 0..1, jit 抖动角 } */
function drawDemonHand(ctx, px, py, ang, len, grip, live) {
  const gripK = clamp(grip, 0, 1);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ang);

  const tex = tintTex('sp_demon_hand', DH.TINT);
  const k = DH.S * Math.max(0, live.pop) * clamp(live.shrink, 0.05, 2);
  const base = len - DH.TIPX * k;          // 贴图前臂断面距洞口的距离

  /* 1. 手臂（根部随后被黑核盖住；只朝墙内伸，本身不会越界，不需要裁剪） */
  if (base > 4) drawDemonArm(ctx, base, 17 * k, live.alpha);

  /* 2. 黑洞：跨在墙面上（和改造前一样一半在墙外），压在手臂根部上，
        手臂才像"从里面伸出来" */
  drawDemonHole(ctx, DH.HOLE, live.hole);

  /* 3. 手（原版贴图）：加法混合 + 淡紫染色。
        只画"墙前面"的部分 —— 贴图根部还在墙里时会被这一刀切掉，
        看起来正是手从裂缝里一点点挤出来（先指尖、后掌、最后手腕）。
        贴图的 +v（前臂→指尖）对齐"从墙里伸出去"的法线方向：
        rotate(-90°) 把 +v 转到 +x，再补 DH.ROT 把前臂的自然倾斜摆正，
        这样手臂是一条直线、指尖稳稳落在抓取点上。 */
  if (tex && live.alpha > 0.01) {
    ctx.save();
    ctx.beginPath(); ctx.rect(-2, -4000, 9000, 8000); ctx.clip();
    ctx.translate(base, 0);
    ctx.rotate(-Math.PI / 2 + DH.ROT);
    ctx.rotate(-live.jit);                 // 原版的悬浮抖动
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = DH.A * live.alpha * (1 + 0.5 * gripK);
    ctx.drawImage(tex, -DH.U0 * k, 0, DH.IW * k, DH.IH * k);
    ctx.restore();
  }
  ctx.restore();
}
