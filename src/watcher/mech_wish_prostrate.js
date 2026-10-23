/* ============================================================
   7.8 观者卡牌机制（片段 B）——「许愿」/「五体投地」
   ------------------------------------------------------------
   本文件是 src/watcher/mech_wish_prostrate.js 的原文，由 tools/splice_watcher.py
   整段拼进 src/game.html 的 WATCHER_MECHS_START/END 自动生成区（7.7 之后、第 8 章之前）。
   片段运行在游戏主脚本的顶层作用域，可以直接用 Unit / Effect / world / IMG / rand 等全局对象。

   约定（和同批片段保持一致，避免互相打架）：
     · 顶层只出现新 class、WP 前缀的 helper 函数与两行 MECHS 注册；
     · 决定对局走向的随机一律 rand(a,b)（对战流，决定论），纯观感随机一律 vrand
       （观感流），全文件没有 Math.random；
     · 头顶文字只允许「祈祷nya...」这一句（statusText 仅在祈祷时返回），其余时候恒 null；
     · 数值全部读 card.p（CARDS 里 id = wish / prostrate 两项），本文件只在构造函数里
       补一份“缺键兜底默认值”，方便片段先于卡表落地时单独跑。调平衡请改 card.p。

   依赖素材（IMG[] 的 key，由 build.py 从反编译资源打进包）：
     · 'card_fame_and_fortune' / 'card_become_almighty' / 'card_live_forever'
         —— 许愿三选一的卡面（名利双收 / 力大无穷 / 永生不死）；
     · 'sp_coin'        —— 名利双收的金币（本体 coin vfx）；
     · 'sp_eye_anim'    —— 神格睁眼 7 帧横排（448×64，watcher mod vfx）；
     · 'sp_big_blur'    —— 神格紫色光晕（watcher mod vfx）；
     · 'sp_glow_spark'  —— 神格金尘 / 力大无穷上涌粒子（watcher mod vfx）。
   缺图一律有程序绘制兜底，不会报错、只是观感差一档。
   ============================================================ */

/* ============================================================
   7.8.3 许愿 —— 周期性三选一：名利双收 / 力大无穷 / 永生不死
   ============================================================ */

/* ---------- 通用小工具（WP 前缀，避免和同批片段撞名） ---------- */
/* 限时格挡：Lead 在 Unit 上提供 addTimedBlock(v, dur)（叠加数值 + 刷新时长）。
   这里只包一层薄壳：片段比基础设施先落地时退化成普通 addBlock，联调期不崩；
   正式集成后永远走 addTimedBlock。 */
function WPAddTimedBlock(u, v, dur) {
  if (!u || !u.alive || u.dying || !(v > 0)) return;
  if (typeof u.addTimedBlock === 'function') { u.addTimedBlock(v, dur); return; }
  if (typeof u.addBlock === 'function') u.addBlock(v);
}

/* 一团柔光（径向渐变）。神格光晕 / 聚光灯 / 护甲起手共用。
   rgb = [r,g,b]；a = 中心透明度。调用方自己负责 save/restore 与 'lighter'。 */
function WPSoftGlow(ctx, x, y, r, rgb, a) {
  if (!(r > 0) || !(a > 0)) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a.toFixed(3) + ')');
  g.addColorStop(0.55, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (a * 0.42).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

/* 居中画一张 IMG 贴图。缺图返回 false，调用方自己走程序绘制兜底。
   （只负责 drawImage，不改 composite / shadow，调用方自己 save/restore。） */
function WPSprite(ctx, key, x, y, w, h, alpha) {
  const im = IMG[key];
  if (!im) return false;
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
  return true;
}

/* 椭圆路径（老浏览器没有 ctx.ellipse 时退化成圆）。调用方随后自己 fill/stroke。 */
function WPEllipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  if (ctx.ellipse) ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
  else ctx.arc(x, y, Math.max(0.1, rx), 0, TAU);
}

/* 血量比例（0~1）：许愿的力/永生加权用。 */
function WPHpRatio(u) { return clamp(u.hp / Math.max(1, u.maxHp), 0, 1); }

/* 敌人受击半径：仆从用 rBody，本体/分身用 CFG.R（与引擎其它命中判定同口径）。 */
function WPEnemyRadius(e) { return (e && e.minion && e.rBody) ? e.rBody : CFG.R; }

/* ---------- 三张许愿卡面（头顶扇形浮现） ---------- */
/* 用户口径：触发时头顶短暂浮现三种效果对应的卡牌，【不写任何文字】；
   被随机选中的那张加金色高光 / 轻微放大。
   绘制顺序：两侧 → 中间，选中的最后画（盖在最上面）。
   卡面尺寸取本体卡面的 0.62 倍（三张并排约 200px，正好在头顶），
   纵向放在卡面中上部（“头顶/身上浮现”），避开 HUD 那一列血条与徽标。 */
class WishCards extends Effect {
  constructor(u, chosen, showT) {
    super();
    this.u = u;
    this.chosen = chosen;
    this.t = 0;
    this.life = Math.max(0.2, showT === undefined ? 0.9 : showT);
    /* 三张卡面的 IMG key，顺序 = 名利双收 / 力大无穷 / 永生不死 */
    this.keys = ['card_fame_and_fortune', 'card_become_almighty', 'card_live_forever'];
    this.cw = CFG.CARD_W * 0.62;                       // ≈ 66px
    this.ch = this.cw * CFG.CARD_H / CFG.CARD_W;       // ≈ 93px
    this.pickAt = this.life * 0.42;                    // 这个时刻之后“选中”那张亮起来
    this.drawUnder = false;
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.life) { this.dead = true; return; }
    if (!this.u || !this.u.alive || this.u.dying) this.dead = true;
  }
  draw(ctx) {
    const u = this.u;
    if (!u) return;
    const aIn = clamp(this.t / 0.16, 0, 1);
    const aOut = clamp((this.life - this.t) / 0.24, 0, 1);
    const fade = Math.min(aIn, aOut);
    if (fade <= 0.01) return;
    /* 选中高光在半程亮起：先“三张卡都摊开”，再有一张发光，读起来像“选择落定” */
    const reveal = clamp((this.t - this.pickAt) / Math.max(0.08, this.life * 0.22), 0, 1);
    const cx = u.x;
    /* 纵向：整把卡面抬到【本体卡上方】，三张都要完整可见。
       原来只抬 0.30 张卡高，结果三张许愿卡被本体卡面压住大半（实测只露出上沿）；
       现在抬到 0.95 张卡高，并保留贴顶时的下压兜底。 */
    const cy = Math.max(this.ch * 0.62 + 8, u.y - CFG.CARD_H * 0.95);
    /* 两侧先画、选中的最后画 */
    const order = [0, 1, 2].sort((a, b) => (a === this.chosen ? 1 : 0) - (b === this.chosen ? 1 : 0));
    for (const i of order) {
      const off = i - 1;                               // -1 / 0 / +1
      const isPick = i === this.chosen;
      const pop = isPick ? 1 + 0.14 * reveal : 1;
      const x = cx + off * this.cw * 0.92;
      const y = cy + Math.abs(off) * 5 + (isPick ? -3 * reveal : 0);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(off * 0.20 + (isPick ? 0.02 : 0));
      ctx.globalAlpha = fade;
      if (isPick && reveal > 0) {
        /* 金色高光：卡背一团呼吸的金光（只做光，不写字） */
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        WPSoftGlow(ctx, 0, 0, this.cw * 1.08, [255, 205, 96],
                   0.26 + 0.20 * reveal * (0.72 + 0.28 * Math.sin(world.t * 9)));
        ctx.restore();
      }
      ctx.scale(pop, pop);
      const im = IMG[this.keys[i]];
      if (im) {
        ctx.drawImage(im, -this.cw / 2, -this.ch / 2, this.cw, this.ch);
      } else {
        /* 缺图兜底：按三种效果的主色画一张小卡（金 / 橙金 / 青） */
        const cols = ['#5a4314', '#4a2a10', '#123038'];
        rrPath(ctx, -this.cw / 2, -this.ch / 2, this.cw, this.ch, 6);
        ctx.fillStyle = cols[i]; ctx.fill();
        ctx.strokeStyle = 'rgba(255,225,150,.65)'; ctx.lineWidth = 2; ctx.stroke();
      }
      if (isPick && reveal > 0) {
        /* 选中的那张加金色描边（高光的第二层，和光晕叠在一起） */
        ctx.globalAlpha = fade * reveal;
        ctx.strokeStyle = 'rgba(255,216,120,.95)';
        ctx.lineWidth = 2.6;
        rrPath(ctx, -this.cw / 2 - 1.5, -this.ch / 2 - 1.5, this.cw + 3, this.ch + 3, 7);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/* ---------- 名利双收的聚光灯 ---------- */
/* 从屏幕上方打下来的金色光锥 + 地面光斑，持续约 0.7s（= showT × 0.8，跟着卡牌时长走）。
   画在单位【下面】（drawUnder）：光锥不会把卡面糊白，读起来像“一束光照在身上”。 */
class WishSpotlight extends Effect {
  constructor(u, dur) {
    super();
    this.u = u;
    this.t = 0;
    this.life = Math.max(0.2, dur === undefined ? 0.7 : dur);
    this.topHalf = 22;          // 顶部（屏幕边缘）半宽
    this.botHalf = 78;          // 落到单位处的半宽
    this.drawUnder = true;
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.life) { this.dead = true; return; }
    if (!this.u || !this.u.alive || this.u.dying) this.dead = true;
  }
  draw(ctx) {
    const u = this.u;
    if (!u) return;
    const k = clamp(this.t / this.life, 0, 1);
    /* 快速亮起（0.12s）→ 缓慢收暗 */
    const on = clamp(this.t / 0.12, 0, 1);
    const a = on * (1 - Math.pow(k, 1.6));
    if (a <= 0.01) return;
    const x0 = u.x;
    /* 2026-10-23 用户口径：光斑要落在【脚下】（原来落在卡面上沿，看起来像照在头顶），
       并且下边缘由直线改成【半椭圆曲线】——像一束光打在地上摊开的光斑，而不是平底梯形。
       y0 = 卡面底边再往下一点（脚底），椭圆半长轴 rx = botHalf、半短轴 ry = botHalf*0.30。 */
    const y0 = u.y + CFG.CARD_H * 0.5 + 6;
    const rx = this.botHalf;
    const ry = this.botHalf * 0.30;
    /* 光锥底边：以 (x0,y0) 为圆心的下半椭圆（从左端点经最低点回到右端点） */
    const bottomArc = () => {
      if (ctx.ellipse) ctx.ellipse(x0, y0, rx, ry, 0, Math.PI, 0, true);
      else ctx.arc(x0, y0 + ry * 0.5, rx, Math.PI, 0, true);
    };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* ① 光锥：顶端窄、底部按半椭圆摊开 */
    const g = ctx.createLinearGradient(x0, 0, x0, y0 + ry);
    g.addColorStop(0, 'rgba(255,214,110,0)');
    g.addColorStop(0.30, 'rgba(255,214,110,' + (0.05 * a).toFixed(3) + ')');
    g.addColorStop(0.90, 'rgba(255,228,150,' + (0.16 * a).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,240,180,' + (0.22 * a).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - this.topHalf, 0);
    ctx.lineTo(x0 + this.topHalf, 0);
    ctx.lineTo(x0 + rx, y0);
    bottomArc();                       // 下边缘 = 半椭圆曲线（与两侧光锥边在端点自然相接）
    ctx.lineTo(x0 - this.topHalf, 0);
    ctx.closePath(); ctx.fill();
    /* ② 光锥两侧的亮边（把轮廓交代清楚，不然只是一团雾） */
    ctx.strokeStyle = 'rgba(255,232,150,' + (0.20 * a).toFixed(3) + ')';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x0 - this.topHalf, 0); ctx.lineTo(x0 - rx, y0);
    ctx.moveTo(x0 + this.topHalf, 0); ctx.lineTo(x0 + rx, y0);
    ctx.stroke();
    /* ③ 脚下光斑 + 金环（贴着半椭圆的下缘，和光锥底边贴合） */
    WPSoftGlow(ctx, x0, y0 + ry * 0.30, this.botHalf * 1.10, [255, 220, 130], 0.30 * a);
    ctx.strokeStyle = 'rgba(255,230,150,' + (0.55 * a).toFixed(3) + ')';
    ctx.lineWidth = 3;
    WPEllipse(ctx, x0, y0, rx, ry);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,246,205,' + (0.30 * a).toFixed(3) + ')';
    ctx.lineWidth = 1.6;
    WPEllipse(ctx, x0, y0 + ry * 0.10, rx * 0.72, ry * 0.72);
    ctx.stroke();
    ctx.restore();
  }
}

/* ---------- 名利双收的抛物线金币 ---------- */
/* 发射：用户 2026-10-23 最终口径 = 正上方 150° 扇形随机（角度公式见 MechWish.castGold）。
   状态：飞行（重力抛物线 + 撞墙反弹）→ 命中敌人 / 寿命耗尽 / 反弹次数用尽 → 消失。
   单靠直射几乎打不中人（实测胜率 0%），所以金币会反弹：
     · 左右墙：vx 反向 ×0.7；
     · 底 / 顶：vy 反向，底部 ×0.55、顶部只 ×0.8（顶部少减速，金币还能飘回来）；
     · 每次反弹消耗一次 p.coinBounce 配额（默认 2 次），配额用尽再撞墙就碎裂消失；
     · 寿命 p.coinLife 兜底，保证所有金币一定会被回收。
   发射角与初速决定“这枚金币会不会打中人”，所以用 rand（对战流）；
   自转速度/拖尾相位只影响观感，用 vrand。
   命中判定与别的弹幕同口径：中心距 ≤ coinHitR + 敌人半径 → 走 damage()，
   因此吃力量（力大无穷的 +N 对每一枚金币都生效）/ 虚弱 / 易伤。 */
class WishCoin extends Effect {
  constructor(owner, ang, spd, p) {
    super();
    this.o = owner;
    this.p = p;
    const off = (p.coinHitR === undefined ? 52 : p.coinHitR) * 0.86;
    this.x = owner.x + Math.cos(ang) * off;
    this.y = owner.y + Math.sin(ang) * off - 10;
    this.vx = Math.cos(ang) * spd;
    this.vy = Math.sin(ang) * spd - 40;                 // 略微上抛：抛物线更明显
    this.t = 0;
    this.life = p.coinLife === undefined ? 2.4 : p.coinLife;
    this.hitR = p.coinHitR === undefined ? 52 : p.coinHitR;
    this.r = p.coinR === undefined ? 13 : p.coinR;
    /* 还能反弹几次（p.coinBounce，默认 2）：用尽后再撞墙就碎裂 */
    this.bounceLeft = p.coinBounce === undefined ? 2 : Math.max(0, Math.round(p.coinBounce));
    this.spin = vrand(0, TAU, 'vrand');                 // 翻面相位（观感流）
    this.spinSpd = vrand(10, 16, 'vrand');              // 翻面速度（观感流）
    this.tilt = vrand(-0.25, 0.25, 'vrand');            // 轻微倾斜（观感流）
    this.trailT = 0;
  }
  update(dt) {
    const p = this.p;
    this.t += dt;
    if (this.t >= this.life) { this.dead = true; return; }
    /* 抛物线：只加竖直方向的重力 */
    this.vy += (p.coinG === undefined ? 320 : p.coinG) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    /* 撞墙反弹（纯确定性物理）：乱射的金币靠折射才有机会摸到人。
       反弹一次消耗一次配额；配额用尽后再撞墙 → 碎裂消失（寿命仍兜底清场）。 */
    const m = this.r + 3;
    let nx = 0, ny = 0;
    if (this.x < m) { this.x = m; this.vx = Math.abs(this.vx) * 0.7; nx = 1; }
    else if (this.x > CFG.AW - m) { this.x = CFG.AW - m; this.vx = -Math.abs(this.vx) * 0.7; nx = -1; }
    if (this.y < m) { this.y = m; this.vy = Math.abs(this.vy) * 0.8; ny = 1; }       // 顶部少减速
    else if (this.y > CFG.AH - m) { this.y = CFG.AH - m; this.vy = -Math.abs(this.vy) * 0.55; ny = -1; }
    if (nx || ny) {
      if (this.bounceLeft > 0) {
        this.bounceLeft -= 1;
        this.bounceFx();
      } else {
        this.dead = true;
        burst(this.x, this.y, 8, { c: '#ffd76a', s0: 60, s1: 220 });
        sfx('card_exhaust', 0.28, 1.65, 0.05);
        return;
      }
    }
    /* 命中：圆内任一敌人 → 25 伤后消失（同一枚金币只结算一次） */
    for (const e of world.enemiesOf(this.o)) {
      if (e.dying) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) > this.hitR + WPEnemyRadius(e)) continue;
      e.damage(p.coinDmg === undefined ? 25 : p.coinDmg, 'gold', this.o);
      burst(this.x, this.y, 12, { c: '#ffd76a', s0: 90, s1: 320 });
      sfx('blunt_attack', 0.55, 1.25, 0.04);
      world.shake = Math.max(world.shake, 5);
      this.dead = true;
      return;
    }
    this.spin += this.spinSpd * dt;
    /* 拖尾金粉（纯观感） */
    this.trailT += dt;
    if (this.trailT >= 0.075) {
      this.trailT = 0;
      world.effects.push(new Spark(this.x + vrand(-5, 5, 'vrand'), this.y + vrand(-5, 5, 'vrand'),
                                   { c: '#ffdf8a', s0: 8, s1: 40 }));
    }
  }
  /* 反弹反馈：金色火星 + 一圈小光环 + 清脆一声（每枚金币最多响 coinBounce 次）。
     纯观感，不消耗对战随机。 */
  bounceFx() {
    burst(this.x, this.y, 5, { c: '#ffe6a0', s0: 40, s1: 160 });
    world.effects.push(new Ring(this.x, this.y, 3, 18, 0.22, 'rgba(255,226,150,.8)', 2));
    sfx('card_select', 0.20, 1.9, 0.04);
  }
  draw(ctx) {
    const fade = clamp(Math.min(this.t / 0.10, (this.life - this.t) / 0.22), 0, 1);
    if (fade <= 0.01) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    /* 金币底光（让它在暗底上显眼） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    WPSoftGlow(ctx, 0, 0, this.r * 2.6, [255, 200, 80], 0.30 * fade);
    ctx.restore();
    ctx.globalAlpha = fade;
    ctx.rotate(this.tilt);
    ctx.rotate(this.spin * 0.35);
    /* 自转 = 横向压缩（像翻面）+ 小幅摆动；运动时看得出来在转 */
    const flat = 0.22 + 0.78 * Math.abs(Math.cos(this.spin));
    ctx.scale(flat, 1);
    const w = this.r * 2.5;
    const flipLight = 0.40 + 0.60 * Math.abs(Math.cos(this.spin));
    if (!WPSprite(ctx, 'sp_coin', 0, 0, w, w, fade * flipLight)) {
      /* 缺图兜底：金圆 + 内圈 */
      ctx.fillStyle = '#ffcf5a';
      ctx.beginPath(); ctx.arc(0, 0, this.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff3c0'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, this.r * 0.62, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---------- 力大无穷：金色力量上涌 ---------- */
/* 脚下金环扩散 + 一串金色光针向上冲（金色 = 力量）。力量层数本身由徽标显示，
   这里只做“数值涨上去了”的一眼反馈。 */
class WishForceFx extends Effect {
  constructor(u) {
    super();
    this.u = u;
    this.t = 0;
    this.life = 0.85;
    this.motes = [];
    for (let i = 0; i < 14; i++) {
      this.motes.push({
        a: vrand(0, TAU, 'vrand'),
        r: vrand(10, 46, 'vrand'),
        sp: vrand(0.7, 1.4, 'vrand'),
        sz: vrand(0.7, 1.5, 'vrand')
      });
    }
  }
  update(dt) { this.t += dt; if (this.t >= this.life) this.dead = true; }
  draw(ctx) {
    const u = this.u;
    if (!u) return;
    const k = clamp(this.t / this.life, 0, 1);
    const A = 1 - k;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* 脚下金环：快速扩散 */
    ctx.strokeStyle = 'rgba(255,206,110,' + (A * 0.85).toFixed(3) + ')';
    ctx.lineWidth = 3.2;
    WPEllipse(ctx, u.x, u.y + 20, 20 + 70 * k, (20 + 70 * k) * 0.42);
    ctx.stroke();
    /* 向上冲的金色光针（螺旋上升，越往上越淡） */
    for (const m of this.motes) {
      const up = k * m.sp;
      const x = u.x + Math.cos(m.a + up * 2.4) * m.r * (1 - k * 0.35);
      const y = u.y + 26 - up * 120;
      const a = A * (0.9 - up * 0.5);
      if (a <= 0.01) continue;
      if (!WPSprite(ctx, 'sp_glow_spark', x, y, 26 * m.sz, 52 * m.sz, a)) {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ffd682';
        ctx.beginPath(); ctx.arc(x, y, 3.2 * m.sz, 0, TAU); ctx.fill();
      }
    }
    WPSoftGlow(ctx, u.x, u.y, 72, [255, 200, 100], 0.28 * A);
    ctx.restore();
  }
}

/* ---------- 永生不死：青白色护甲上涌 ---------- */
/* 一道从脚下升到胸口的青白护罩环 + 两道绕着卡面旋转的护甲新月（sp_block 贴图），
   配几粒上浮的冰蓝光点。多层护甲层数由徽标显示（本文件不写字）。 */
class WishWardFx extends Effect {
  constructor(u) {
    super();
    this.u = u;
    this.t = 0;
    this.life = 0.9;
    this.spin = vrand(0, TAU, 'vrand');
  }
  update(dt) { this.t += dt; if (this.t >= this.life) this.dead = true; }
  draw(ctx) {
    const u = this.u;
    if (!u) return;
    const k = clamp(this.t / this.life, 0, 1);
    const A = 1 - k;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* 护罩环：从脚下升到胸口，边升边收 */
    ctx.strokeStyle = 'rgba(190,235,255,' + (A * 0.8).toFixed(3) + ')';
    ctx.lineWidth = 3;
    WPEllipse(ctx, u.x, u.y + 40 - 70 * k, 56 - 18 * k, (56 - 18 * k) * 0.34);
    ctx.stroke();
    /* 两道护甲新月绕着卡面转（sp_block 就是“格挡护罩”的贴图） */
    for (let i = 0; i < 2; i++) {
      const ang = this.spin + this.t * 1.9 + i * Math.PI;
      const px = u.x + Math.cos(ang) * 62;
      const py = u.y + Math.sin(ang) * 30 - 14;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      if (!WPSprite(ctx, 'sp_block', 0, 0, 74, 84, A * 0.5)) {
        ctx.strokeStyle = 'rgba(190,235,255,' + (A * 0.7).toFixed(3) + ')';
        ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.arc(0, 0, 26, -0.9, 1.1); ctx.stroke();
      }
      ctx.restore();
    }
    /* 上浮的冰蓝光点 */
    for (let i = 0; i < 8; i++) {
      const ph = (k * 1.1 + i / 8) % 1;
      const x = u.x + Math.sin(i * 2.1 + this.spin) * (24 + 30 * ph);
      const y = u.y + 40 - ph * 110;
      WPSoftGlow(ctx, x, y, 7, [190, 235, 255], (1 - ph) * 0.65 * A);
    }
    ctx.restore();
  }
}

/* ---------- 许愿机制本体 ---------- */
/* 状态机：idle（等冷却）→ show（三张卡面浮现 showT 秒，本体线性减速）→ recover（线性加速
         回 100%）→ idle。
    2026-10-23 用户口径：原来触发瞬间 u.freeze 硬停顿（“一步一顿”），观感太差 ——
    改成【许愿前后线性减速/加速】：
      · show 开头 slowDownT 内：移速 100% → slowMin（50%），线性下降；
      · settle 之前：保持在 slowMin；
      · settle 之后 slowUpT 内：slowMin → 100%，线性回升。
    冷却从触发那一刻起算（show/recover 期间照常走），所以触发间隔 ≈ ivMin~ivMax。
    ⚠ speedMul 是本体自己的移速倍率（这张卡专用）；退出 show/recover 一律归 1。 */
class MechWish {
  constructor(u, p) {
    this.u = u;
    this.p = p;
    this.state = 'idle';
    this.cd = p.first === undefined ? 1.5 : p.first;
    this.timer = 0;                // show 剩余秒数
    this.elapsed = 0;              // show 已进行秒数（算减速曲线）
    this.recT = 0;                 // recover 已进行秒数（算加速曲线）
    this.chosen = -1;              // 0 名利 / 1 力 / 2 永生
    this.cards = null;             // 当前浮现的卡面效果（只用于兜底清理）
  }
  setSpeed(k) { this.u.speedMul = clamp(k, 0.05, 1); }
  update(dt) {
    const u = this.u, p = this.p;
    if (!u.alive || u.dying) return;
    if (this.cd > 0) this.cd -= dt;
    if (this.state === 'show') {
      this.elapsed += dt;
      this.timer -= dt;
      /* 线性减速：slowDownT 内从 1 压到 slowMin，之后保持最低速 */
      const dn = p.slowDownT === undefined ? 0.45 : p.slowDownT;
      const mn = p.slowMin === undefined ? 0.5 : p.slowMin;
      this.setSpeed(1 + (mn - 1) * (dn > 0 ? clamp(this.elapsed / dn, 0, 1) : 1));
      if (this.timer <= 0) {
        this.settle();
        if (!u.alive || u.dying) return;
        this.state = 'recover';
        this.recT = 0;
      }
      return;
    }
    if (this.state === 'recover') {
      this.recT += dt;
      const up = p.slowUpT === undefined ? 0.55 : p.slowUpT;
      const mn = p.slowMin === undefined ? 0.5 : p.slowMin;
      const k = up > 0 ? clamp(this.recT / up, 0, 1) : 1;
      this.setSpeed(mn + (1 - mn) * k);
      if (k >= 1) this.state = 'idle';
      return;
    }
    /* idle：冷却到点、且没被恶魔之手拎着 → 开始许愿（移速兜底归 1） */
    this.setSpeed(1);
    if (this.cd <= 0 && u.grabbed <= 0) this.begin();
  }
  begin() {
    const u = this.u, p = this.p;
    this.state = 'show';
    this.elapsed = 0;
    this.timer = p.showT === undefined ? 0.7 : p.showT;
    this.cd = rand(p.ivMin === undefined ? 3.4 : p.ivMin,
                   p.ivMax === undefined ? 4.6 : p.ivMax, 'wish.cd');
    this.chosen = this.pick();
    /* 不再 freeze 硬停：减速由 update() 的线性曲线负责（用户 2026-10-23 口径） */
    const fx = new WishCards(u, this.chosen, this.timer);
    world.effects.push(fx);
    this.cards = fx;
    sfx('card_deal', 0.72, 1.05);
    burst(u.x + vrand(-24, 24, 'vrand'), u.y - 10 + vrand(-18, 18, 'vrand'), 8,
          { c: '#ffe2a0', s0: 40, s1: 160 });
  }
  /* 三选一的概率（用户口径 + 对战随机流）：
       名利双收 = goldP（恒 50%）；
       剩下 50% 里：力大无穷 = 血量比例、永生不死 = 1 - 血量比例
       （血越高越容易是力，血越低越容易是永生）。 */
  pick() {
    const p = this.p, u = this.u;
    if (rand(0, 1, 'wish.gold') < (p.goldP === undefined ? 0.5 : p.goldP)) return 0;
    return rand(0, 1, 'wish.life') < WPHpRatio(u) ? 1 : 2;
  }
  settle() {
    const u = this.u;
    if (!u.alive || u.dying) return;
    if (this.chosen === 0) this.castGold();
    else if (this.chosen === 1) this.castStrength();
    else this.castImmortal();
  }
  /* 名利双收：聚光灯 + coins 枚抛物线金币（每枚 coinDmg 伤）。
     ⚠ 用户 2026-10-23 最终口径：金币【不再 360° 全随机】，改成【正上方 150° 扇形随机】：
        以竖直向上（-π/2）为中心、左右各 75°（±5π/12），
        即 angle = -π/2 + rand(-5π/12, +5π/12)；五枚像喷泉一样往上抛，
        各自在这个扇形里随机散开，靠重力抛物线落下、撞墙/落地反弹。 */
  castGold() {
    const u = this.u, p = this.p;
    const n = Math.max(1, Math.round(p.coins === undefined ? 5 : p.coins));
    /* 聚光灯持续约 0.7s（= showT × 0.8，跟着卡面时长走） */
    world.effects.push(new WishSpotlight(u, (p.showT === undefined ? 0.9 : p.showT) * 0.8));
    /* 金币：正上方 150° 扇形（-75° ~ +75°）里逐枚随机取角；
       角度/初速决定命中与否 → rand（对战流），同一颗种子逐帧一致。 */
    const half = Math.PI * 5 / 12;                     // 75°
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-half, half, 'wish.coinAng');
      const spd = rand(p.coinSpdMin === undefined ? 260 : p.coinSpdMin,
                       p.coinSpdMax === undefined ? 420 : p.coinSpdMax, 'wish.coinSpd');
      world.effects.push(new WishCoin(u, a, spd, p));
    }
    world.effects.push(new Ring(u.x, u.y, 14, 86, 0.42, '#ffd76a', 3));
    sfx('dagger_throw', 0.8, 1.0);
    world.shake = Math.max(world.shake, 6);
  }
  /* 力大无穷：+strAdd 点力量（每点令自身造成的每段伤害 +1，见 Lead 的 damage()）。 */
  castStrength() {
    const u = this.u, p = this.p;
    u.strength = (u.strength || 0) + (p.strAdd === undefined ? 5 : p.strAdd);
    world.effects.push(new WishForceFx(u));
    burst(u.x, u.y, 18, { c: '#ffd76a', s0: 90, s1: 320 });
    sfx('card_smith', 0.90, 0.92);
  }
  /* 永生不死：+platedAdd 层多层护甲，并按【加上本次以后】的层数给限时格挡。
     ⚠ 2026-10-23 用户口径更新：“许愿获得格挡要算上本次加的多层护甲”——
       首次触发也给 8 点格挡，之后按 16 / 24 / 32… 给（先加层、再按总层数给格挡）。 */
  castImmortal() {
    const u = this.u, p = this.p;
    u.plated = (u.plated || 0) + (p.platedAdd === undefined ? 8 : p.platedAdd);
    WPAddTimedBlock(u, u.plated, p.blockDur === undefined ? 5 : p.blockDur);
    world.effects.push(new WishWardFx(u));
    burst(u.x, u.y, 16, { c: '#bfeaff', s0: 70, s1: 260 });
    sfx('frost_orb_passive', 0.75, 1.12);
  }
  /* 许愿没有任何头顶状态文字（三张卡面已经说明一切）。 */
  statusText() { return null; }
}

/* ============================================================
   7.8.4 五体投地 —— 祈祷攒真言，满层进神格，光柱追踪敌人
   ============================================================ */

/* ---------- 祈祷的地面光环 ---------- */
/* 垫在卡面下面（drawUnder）：脚下一圈紫色法阵 + 缓慢上升的光点，
   读起来像“跪在原地祈祷”。由 MechProstrate 在进入祈祷时挂上、离开时 stop() 淡出。 */
class ProstrateAura extends Effect {
  constructor(u, inT) {
    super();
    this.u = u;
    this.t = 0;
    this.fade = 1;
    this.stopT = 0;
    /* 淡入时长（前摇期间就先挂上法阵，用 inT 慢慢亮起来） */
    this.inT = Math.max(0, inT || 0);
    this.drawUnder = true;
    this.motes = [];
    for (let i = 0; i < 12; i++) {
      this.motes.push({
        a: vrand(0, TAU, 'vrand'),
        r: vrand(26, 56, 'vrand'),
        sp: vrand(0.5, 1.1, 'vrand'),
        sz: vrand(0.7, 1.3, 'vrand')
      });
    }
  }
  stop() { if (this.stopT <= 0) this.stopT = 0.32; }
  update(dt) {
    this.t += dt;
    if (this.stopT > 0) {
      this.stopT -= dt;
      this.fade = clamp(this.stopT / 0.32, 0, 1);
      if (this.stopT <= 0) { this.dead = true; return; }
    }
    if (!this.u || !this.u.alive || this.u.dying) this.dead = true;
  }
  draw(ctx) {
    const u = this.u;
    if (!u) return;
    const fin = this.inT > 0 ? clamp(this.t / this.inT, 0, 1) : 1;
    const A = this.fade * fin * (0.72 + 0.16 * Math.sin(world.t * 3.1));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* 脚下法阵：两层同心椭圆 + 一圈慢转虚线 */
    const cy = u.y + 46;
    WPSoftGlow(ctx, u.x, cy, 74, [150, 96, 220], 0.16 * A);
    ctx.strokeStyle = 'rgba(190,150,255,' + (0.55 * A).toFixed(3) + ')';
    ctx.lineWidth = 2.4;
    WPEllipse(ctx, u.x, cy, 66, 22);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232,214,255,' + (0.40 * A).toFixed(3) + ')';
    ctx.lineWidth = 1.6;
    WPEllipse(ctx, u.x, cy, 48, 16);
    ctx.stroke();
    /* 脚下法阵：两层同心椭圆 + 一圈慢转虚线。
       2026-10-23 修复：原来是把【椭圆整体 rotate()】起来 —— 透视投影的椭圆一转就变成
       "斜着的椭圆"，看起来像一个椭圆在原地转，很怪。现在椭圆本体保持水平不动，
       只推进【虚线相位】lineDashOffset：虚线沿椭圆路径慢慢流动，读起来才是
       "虚线圈在绕圈"。（用户口径：修不好就让它不动；这里是正经修法。） */
    ctx.setLineDash([7, 9]);
    ctx.lineDashOffset = -(world.t * 26);
    ctx.strokeStyle = 'rgba(232,214,255,' + (0.34 * A).toFixed(3) + ')';
    ctx.lineWidth = 2;
    WPEllipse(ctx, u.x, cy, 74, 25);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    /* 上升的紫色光点 */
    for (const m of this.motes) {
      const ph = (this.t * m.sp * 0.35 + m.r / 56) % 1;
      const x = u.x + Math.cos(m.a + ph * 2) * m.r * (0.55 + 0.45 * ph);
      const y = cy - ph * 96;
      const a = A * 0.55 * Math.sin(Math.PI * ph);
      if (a <= 0.01) continue;
      WPSoftGlow(ctx, x, y, 5 * m.sz, [210, 180, 255], a);
    }
    ctx.restore();
  }
}

/* ---------- 祈祷前摇的蓄力环 ---------- */
/* 2026-10-23 用户口径：祈祷前要有前摇提示、并线性进入减速。这是前摇的读条视觉：
   一圈紫色法阵从外向内收（半径 96 → 58）、越收越亮，同时脚下光斑渐亮、向上冒紫色
   念力微粒 —— 玩家能一眼看出“它正在准备祈祷”。
   纯观感（vrand），不参与任何判定；前摇结束时自然走完（life = prayWindT）。 */
class ProstrateCharge extends Effect {
  constructor(u, dur) {
    super();
    this.u = u;
    this.t = 0;
    this.life = Math.max(0.1, dur === undefined ? 0.9 : dur);
    this.motes = [];
    for (let i = 0; i < 10; i++) {
      this.motes.push({
        a: vrand(0, TAU, 'vrand'),
        r: vrand(34, 70, 'vrand'),
        ph: vrand(0, 1, 'vrand'),
        sz: vrand(0.7, 1.3, 'vrand')
      });
    }
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.life) { this.dead = true; return; }
    if (!this.u || !this.u.alive || this.u.dying) this.dead = true;
  }
  draw(ctx) {
    const u = this.u;
    if (!u) return;
    const k = clamp(this.t / this.life, 0, 1);
    const A = 0.25 + 0.75 * k;                       // 越接近祈祷越亮
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cy = u.y + 46;
    const rr = 96 - 38 * k;                          // 从外向内收
    ctx.strokeStyle = 'rgba(214,186,255,' + (0.55 * A).toFixed(3) + ')';
    ctx.lineWidth = 2 + 2.6 * k;
    WPEllipse(ctx, u.x, cy, rr, rr * 0.34);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,255,' + (0.30 * A * k).toFixed(3) + ')';
    ctx.lineWidth = 1.4;
    WPEllipse(ctx, u.x, cy, rr * 0.78, rr * 0.27);
    ctx.stroke();
    WPSoftGlow(ctx, u.x, cy, 62, [168, 118, 236], 0.20 * A * (0.4 + 0.6 * k));
    for (const m of this.motes) {
      const ph = (this.t * 0.9 + m.ph) % 1;
      const x = u.x + Math.cos(m.a) * m.r * (1 - 0.35 * ph);
      const y = cy - 6 - ph * 74;
      const a = A * 0.5 * Math.sin(Math.PI * ph);
      if (a <= 0.01) continue;
      WPSoftGlow(ctx, x, y, 5 * m.sz, [214, 186, 255], a);
    }
    ctx.restore();
  }
}

/* ---------- 神格激活爆发（原版 DivinityActivationBurst 的 JS 版） ---------- */
/* 反编译参考：20 枚 glow_spark 从半径 560~900 处向中心收拢，
   延迟 0~0.25s、时长 0.35~0.55s，先快后慢（k²）、越收越亮 —— 像“神力灌体”。 */
class DivinityBurst extends Effect {
  constructor(u) {
    super();
    this.u = u;
    this.t = 0;
    this.life = 1.2;
    this.sparks = [];
    for (let i = 0; i < 20; i++) {
      this.sparks.push({
        a: vrand(0, TAU, 'vrand'),
        r: vrand(560, 900, 'vrand'),
        delay: vrand(0, 0.25, 'vrand'),
        dur: vrand(0.35, 0.55, 'vrand'),
        sx: vrand(1.7, 3.4, 'vrand'),
        cr: vrand(0.80, 1.00, 'vrand'),
        cg: vrand(0.40, 0.70, 'vrand'),
        cb: vrand(0.70, 1.00, 'vrand')
      });
    }
    world.shake = Math.max(world.shake, 14);
  }
  update(dt) { this.t += dt; if (this.t >= this.life) this.dead = true; }
  draw(ctx) {
    const u = this.u;
    if (!u) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const k = clamp((this.t - s.delay) / s.dur, 0, 1);
      if (k <= 0) continue;
      const w = k * k;                                   // 二次缓动：先快后慢地收回中心
      const x = u.x + Math.cos(s.a) * s.r * (1 - w);
      const y = u.y + Math.sin(s.a) * s.r * (1 - w) * 0.55;   // 原版 y 方向压扁一半
      const alpha = (k < 0.15 ? k / 0.15 : (1 - k) / 0.85) * 0.85;
      if (alpha <= 0.01) continue;
      const sc = s.sx * (1 - k * 0.7);
      const col = 'rgba(' + Math.round(s.cr * 255) + ',' + Math.round(s.cg * 255) + ',' +
                  Math.round(s.cb * 255) + ',' + alpha.toFixed(3) + ')';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(u.y - y, u.x - x) + Math.PI / 2);
      const im = IMG['sp_glow_spark'];
      if (im) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(im, -15 * sc, -30 * sc, 30 * sc, 60 * sc);
      } else {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse ? ctx.ellipse(0, 0, 3 * sc, 16 * sc, 0, 0, TAU)
                    : ctx.arc(0, 0, 4 * sc, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    /* 中心一圈金色冲击环（激活的“落点”） */
    const k = clamp(this.t / 0.7, 0, 1);
    if (k < 1) {
      ctx.strokeStyle = 'rgba(255,220,120,' + ((1 - k) * 0.85).toFixed(3) + ')';
      ctx.lineWidth = 5 * (1 - k) + 1;
      WPEllipse(ctx, u.x, u.y, 30 + 210 * k, (30 + 210 * k) * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---------- 神格眼睛 + 紫金光晕（原版 DivinityEyeSpawner / AuraBlobEmitter 的 JS 版） ---------- */
/* 用户口径：“用 IMG['sp_eye_anim'] 7 帧横排做一只睁开的眼睛叠在头顶/身上
   + IMG['sp_big_blur']/['sp_glow_spark'] 的紫色/金色光环粒子”。
   实现：一只主眼（开场 0.45s 睁眼、之后偶尔眨眼）+ 身体周围几团紫色软光
   + 一串缓慢上浮的金色光尘；跟随本体、神格结束时 stop() 淡出。
   生命 = p.divT + 0.5（比神格略长一点，收尾由 mech 显式 stop() 控制）。 */
class DivinityEye extends Effect {
  constructor(u, life) {
    super();
    this.u = u;
    this.t = 0;
    this.life = Math.max(0.4, life === undefined ? 5.5 : life);
    this.stopT = 0;                 // >0 = 正在收尾淡出
    this.ph = vrand(0, TAU, 'vrand');
    /* 紫色软光团（big_blur）：绕身体缓慢起伏 */
    this.blobs = [];
    for (let i = 0; i < 5; i++) {
      this.blobs.push({
        a: vrand(0, TAU, 'vrand'),
        r: vrand(46, 78, 'vrand'),
        sp: vrand(0.25, 0.60, 'vrand'),
        rise: vrand(26, 74, 'vrand'),
        sz: vrand(1.1, 2.1, 'vrand')
      });
    }
    /* 金色光尘（glow_spark）：从身体周围缓缓上浮 */
    this.sparks = [];
    for (let i = 0; i < 10; i++) {
      this.sparks.push({
        a: vrand(0, TAU, 'vrand'),
        r: vrand(18, 64, 'vrand'),
        sp: vrand(0.16, 0.36, 'vrand'),
        ph: vrand(0, 1, 'vrand'),
        sz: vrand(0.7, 1.4, 'vrand')
      });
    }
  }
  /* 神格结束：淡出 0.35s（不硬切，读起来像“神力收回”） */
  stop() { if (this.stopT <= 0) this.stopT = 0.35; }
  update(dt) {
    this.t += dt;
    if (this.stopT > 0) {
      this.stopT -= dt;
      if (this.stopT <= 0) { this.dead = true; return; }
    }
    if (!this.u || !this.u.alive || this.u.dying) { this.dead = true; return; }
    if (this.t >= this.life && this.stopT <= 0) this.dead = true;
  }
  /* 睁眼帧：0.45s 内 0→6 帧；之后保持 6 帧，每 ~2.2s 眨一次眼（6→0→6）。 */
  eyeFrame() {
    const openT = 0.45;
    if (this.t < openT) return Math.min(6, Math.floor((this.t / openT) * 7));
    const blink = (this.t + this.ph) % 2.2;
    if (blink < 0.22) return Math.round(Math.abs(1 - 2 * (blink / 0.22)) * 6);
    return 6;
  }
  draw(ctx) {
    const u = this.u;
    if (!u) return;
    const fadeIn = clamp(this.t / 0.25, 0, 1);
    const fadeOut = this.stopT > 0 ? clamp(this.stopT / 0.35, 0, 1) : 1;
    const A = Math.min(fadeIn, fadeOut);
    if (A <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* ① 身体周围的大团紫色光晕（big_blur 贴图 + 径向渐变叠色） */
    for (const b of this.blobs) {
      const ang = b.a + this.t * b.sp;
      const x = u.x + Math.cos(ang) * b.r;
      const y = u.y + Math.sin(ang) * b.r * 0.55 - b.rise * 0.10 +
                Math.sin(world.t * 1.7 + b.a) * 6;
      WPSoftGlow(ctx, x, y, 52 * b.sz, [140, 84, 240], 0.15 * A);
      WPSprite(ctx, 'sp_big_blur', x, y, 74 * b.sz, 74 * b.sz, 0.10 * A);
    }
    /* ② 金色光尘（glow_spark）缓慢上浮、两端淡出 */
    for (const s of this.sparks) {
      const ph = (this.t * s.sp + s.ph) % 1;
      const x = u.x + Math.cos(s.a) * s.r * (0.55 + 0.45 * ph);
      const y = u.y + 30 - ph * 105;
      const a = A * 0.45 * Math.sin(Math.PI * ph);
      if (a <= 0.01) continue;
      if (!WPSprite(ctx, 'sp_glow_spark', x, y, 16 * s.sz, 30 * s.sz, a)) {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ffe6a0';
        ctx.beginPath(); ctx.arc(x, y, 2.6 * s.sz, 0, TAU); ctx.fill();
      }
    }
    /* ③ 主眼：sp_eye_anim 的 7 帧横排（每帧 = 总宽/7），叠在卡面中上部 */
    const frame = this.eyeFrame();
    const S = CFG.CARD_W * 1.18;
    const ex = u.x;
    const ey = u.y - CFG.CARD_H * 0.12 - 4 * Math.sin(world.t * 2.3 + this.ph);
    WPSoftGlow(ctx, ex, ey, S * 0.82, [150, 90, 250], 0.22 * A);
    const im = IMG['sp_eye_anim'];
    if (im) {
      const fw = im.width / 7, fh = im.height;
      ctx.globalAlpha = A;
      ctx.drawImage(im, frame * fw, 0, fw, fh, ex - S / 2, ey - S / 2, S, S);
      /* 外圈再叠一层低透明度的大眼，做出“发光”的辉光 */
      ctx.globalAlpha = A * 0.5;
      ctx.drawImage(im, frame * fw, 0, fw, fh,
                    ex - S * 0.62, ey - S * 0.62, S * 1.24, S * 1.24);
    } else {
      /* 缺图兜底：一只简笔竖眼（白眼球 + 紫瞳 + 金环） */
      ctx.globalAlpha = A;
      WPSoftGlow(ctx, ex, ey, S * 0.6, [255, 240, 255], 0.30);
      ctx.fillStyle = 'rgba(245,240,255,.92)';
      WPEllipse(ctx, ex, ey, S * 0.38, S * 0.20);
      ctx.fill();
      ctx.fillStyle = 'rgba(180,120,255,.95)';
      ctx.beginPath(); ctx.arc(ex, ey, S * 0.11, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,214,120,.85)'; ctx.lineWidth = 2;
      WPEllipse(ctx, ex, ey, S * 0.42, S * 0.23);
      ctx.stroke();
    }
    /* ④ 眼睛下方一圈金色细环（神格徽记） */
    ctx.globalAlpha = A * 0.7;
    ctx.strokeStyle = 'rgba(255,214,120,.85)';
    ctx.lineWidth = 2;
    WPEllipse(ctx, u.x, u.y + 34, 40, 12);
    ctx.stroke();
    ctx.restore();
  }
}

/* ---------- 神格光柱（伤害区 = 底部圆圈） ---------- */
/* 用户口径：中心白色、边缘紫色，竖直向上【直穿 canvas 顶部（画到 y=0，
   绝对不被竞技场边缘截断）】；实际伤害区域是底部圆圈（半径 beamR）。
   底座不再瞬移贴脸：以 beamFollowSpd（250 ≈ 正常角色移动 150 的 1.67 倍，“比正常角色
   移动快一些”）朝敌方本体追 —— 追得上慢速移动，追不上高速突进（2026-10-23 用户口径，
   作为“前摇不可打断 + 进入祈祷即送 1 层真言”的代价）；
   追上后每秒 beamTick 跳 × beamDmg —— 圆内每个敌人各算一跳（同一敌人可被每秒 6 跳）。
   ⚠ 同一口径下光柱整体更透明：draw 里统一乘 0.75。
   ⚠ 光柱画的是 arena 坐标下的 y ∈ [0, 底座y]；画布上边界就是 y=0，
     所以它一直顶到画布最上沿，边框线（画在 y=1.5）也会被光柱盖住 —— 满足“不被截断”。 */
class DivinityBeam extends Effect {
  constructor(owner, p) {
    super();
    this.o = owner;
    this.p = p;
    this.bx = owner.x;             // 底座（伤害圈中心）
    this.by = owner.y;
    this.t = 0;
    this.acc = 0;                  // 伤害跳数累加器
    this.reveal = 0;               // 光柱从底座向上打到屏幕顶的撑开进度
    this.fade = 1;                 // 收尾淡出
    this.fading = false;
    this.sfxT = -99;
    this.sparkT = 0;
    this.dead = false;
  }
  /* 神格结束：立刻停止伤害并淡出（0.16s，几乎瞬间） */
  stop() { this.fading = true; }
  update(dt) {
    const p = this.p, u = this.o;
    this.t += dt;
    if (!u || !u.alive || u.dying) { this.dead = true; return; }
    if (this.fading) {
      this.fade -= dt / 0.16;
      if (this.fade <= 0) { this.fade = 0; this.dead = true; return; }
    }
    this.reveal = Math.min(1, this.reveal + dt * 5.5);
    /* 底座追踪敌方本体实时位置（速度有上限：每帧最多走 beamFollowSpd × dt） */
    const tgt = world.bodyOf(u) || world.enemyOf(u);
    if (tgt) {
      const dx = tgt.x - this.bx, dy = tgt.y - this.by;
      const d = Math.hypot(dx, dy);
      if (d > 0.5) {
        const step = Math.min(d, (p.beamFollowSpd === undefined ? 250 : p.beamFollowSpd) * dt);
        this.bx += dx / d * step;
        this.by += dy / d * step;
      }
    }
    /* 底座圆别跑出场地：伤害圈要整圈可见 */
    const R = p.beamR === undefined ? 46 : p.beamR;
    this.bx = clamp(this.bx, R, CFG.AW - R);
    this.by = clamp(this.by, R, CFG.AH - R);
    /* 伤害：每秒 beamTick 次，圆内每个敌人各吃一跳 */
    if (!this.fading) {
      this.acc += dt * (p.beamTick === undefined ? 6 : p.beamTick);
      let hops = 0;
      while (this.acc >= 1 && hops < 12) {
        this.acc -= 1;
        hops += 1;
        this.tick();
        if (this.dead) return;
      }
      if (this.acc > 1) this.acc = 0;               // 防御：异常 dt 不追偿一堆跳数
    }
    /* 底座边缘持续冒光（纯观感） */
    this.sparkT += dt;
    if (this.sparkT >= 0.06) {
      this.sparkT = 0;
      const a = vrand(0, TAU, 'vrand');
      world.effects.push(new Spark(this.bx + Math.cos(a) * R * vrand(0.7, 1.05, 'vrand'),
                                   this.by + Math.sin(a) * R * vrand(0.7, 1.05, 'vrand'),
                                   { c: '#e8d6ff', s0: 10, s1: 70 }));
    }
  }
  tick() {
    const p = this.p, u = this.o;
    const R = p.beamR === undefined ? 46 : p.beamR;
    const dmg = p.beamDmg === undefined ? 25 : p.beamDmg;
    for (const e of world.enemiesOf(u)) {
      if (e.dying) continue;
      if (Math.hypot(e.x - this.bx, e.y - this.by) > R + WPEnemyRadius(e)) continue;
      /* 走 damage()：中心白/边缘紫的“光”属性伤害，吃力量/易伤/虚弱（同其它机制口径） */
      e.damage(dmg, 'light', u);
      burst(e.x + vrand(-10, 10, 'vrand'), e.y + vrand(-10, 10, 'vrand'), 4,
            { c: '#efe4ff', s0: 40, s1: 170 });
      if (world.t - this.sfxT > 0.12) {
        this.sfxT = world.t;
        sfx('lightning_orb_passive', 0.22, 1.45, 0.06);
      }
    }
  }
  draw(ctx) {
    const u = this.o;
    if (!u || this.fade <= 0.01) return;
    const p = this.p;
    const R = p.beamR === undefined ? 46 : p.beamR;
    /* 光柱整体透明度（2026-10-23 用户口径：“透明度也加一点”）：0.75 倍，不再糊屏 */
    const fade = this.fade * 0.75;
    const pulse = 0.5 + 0.5 * Math.sin(world.t * 13);
    const half = R * (0.94 + 0.10 * pulse);            // 光柱半宽 ≈ 底座圆半径
    /* 撑开动画：顶端从底座一路打到 y=0；打满后一直顶到画布最上沿 */
    const yTop = lerp(this.by, 0, this.reveal);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (this.by > yTop + 1) {
      /* ① 柱体：中心白、边缘紫（横向渐变，纵向从底座一以贯之到 y=0） */
      const g = ctx.createLinearGradient(this.bx - half * 1.5, 0, this.bx + half * 1.5, 0);
      const stops = [
        [0.00, '140,80,240', 0.00],
        [0.10, '150,92,250', 0.22],
        [0.28, '182,124,255', 0.40],
        [0.43, '244,228,255', 0.70],
        [0.50, '255,255,255', 0.92],
        [0.57, '244,228,255', 0.70],
        [0.72, '182,124,255', 0.40],
        [0.90, '150,92,250', 0.22],
        [1.00, '140,80,240', 0.00]
      ];
      for (const s of stops) g.addColorStop(s[0], 'rgba(' + s[1] + ',' + (s[2] * fade).toFixed(3) + ')');
      ctx.fillStyle = g;
      /* 2026-10-23 用户口径：光柱底部由平直底边改成【半椭圆曲线】（像一束光落在
         地面上摊开），和许愿聚光灯的下缘保持同一种“光斑”语言，衔接更自然。 */
      const botRx = half * 1.5, botRy = half * 0.45;
      const halfEllipse = (rx, ry) => {
        if (ctx.ellipse) ctx.ellipse(this.bx, this.by, Math.max(0.1, rx), Math.max(0.1, ry),
                                     0, 0, Math.PI, false);
        else ctx.arc(this.bx, this.by + ry * 0.5, Math.max(0.1, rx), 0, Math.PI, false);
      };
      ctx.beginPath();
      ctx.moveTo(this.bx - botRx, yTop);
      ctx.lineTo(this.bx + botRx, yTop);
      ctx.lineTo(this.bx + botRx, this.by);
      halfEllipse(botRx, botRy);                       // 右 → 底 → 左
      ctx.lineTo(this.bx - botRx, yTop);
      ctx.closePath(); ctx.fill();
      /* ② 中心白芯（同样以半椭圆收底） */
      const core = half * 0.30;
      const cg = ctx.createLinearGradient(this.bx - core, 0, this.bx + core, 0);
      cg.addColorStop(0, 'rgba(255,255,255,0)');
      cg.addColorStop(0.5, 'rgba(255,255,255,' + (0.55 * fade).toFixed(3) + ')');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(this.bx - core, yTop);
      ctx.lineTo(this.bx + core, yTop);
      ctx.lineTo(this.bx + core, this.by);
      halfEllipse(core, core * 1.05);
      ctx.lineTo(this.bx - core, yTop);
      ctx.closePath(); ctx.fill();
      /* ③ 柱内向上流动的光带（4 条错开相位，交代“光在往上冲”） */
      const span = this.by - yTop;
      for (let i = 0; i < 4; i++) {
        const ph = (world.t * 0.85 + i / 4) % 1;
        const yy = this.by - ph * span - span * 0.10;
        const rr = half * (0.20 + 0.12 * (i % 2));
        WPSoftGlow(ctx, this.bx + Math.sin(world.t * 3 + i * 1.7) * half * 0.35, yy,
                   rr * 1.7, [235, 225, 255], 0.30 * fade * Math.sin(Math.PI * ph));
      }
      /* ④ 柱体两侧的紫色描边（把柱体边界画干净） */
      ctx.strokeStyle = 'rgba(178,130,255,' + (0.42 * fade).toFixed(3) + ')';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(this.bx - half, this.by);
      ctx.lineTo(this.bx - half * 0.62, yTop);
      ctx.moveTo(this.bx + half, this.by);
      ctx.lineTo(this.bx + half * 0.62, yTop);
      ctx.stroke();
    }
    /* ⑤ 底部圆圈：真正的伤害范围（半径 beamR，和判定完全一致） */
    WPSoftGlow(ctx, this.bx, this.by, R * 1.55, [210, 170, 255], 0.28 * fade);
    WPSoftGlow(ctx, this.bx, this.by, R * 0.95, [255, 255, 255], 0.42 * fade);
    ctx.strokeStyle = 'rgba(240,225,255,' + (0.85 * fade).toFixed(3) + ')';
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(this.bx, this.by, R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(170,120,255,' + (0.50 * fade).toFixed(3) + ')';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(this.bx, this.by, R * 0.72, 0, TAU); ctx.stroke();
    /* 旋转的符环：三段弧 */
    const spin = world.t * 2.2;
    for (let i = 0; i < 3; i++) {
      const a0 = spin + i * TAU / 3;
      ctx.strokeStyle = 'rgba(255,245,210,' + (0.60 * fade).toFixed(3) + ')';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(this.bx, this.by, R * 0.88, a0, a0 + 0.7); ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---------- 五体投地机制本体 ---------- */
/* 状态机：idle（等冷却）
          → windup（前摇 prayWindT 秒：头顶【提前】显示「祈祷nya...」，移速从 100% 线性
            压到 prayerSlow，脚下蓄力环收缩；此阶段【不可被打断】）
          → pray（祈祷：30 限时格挡 + 移速×0.12 + 进入瞬间先送 mantraOnEnter 层真言，
            之后越叠越快）
          → divine（真言满 10：清空真言/格挡、5 秒不动 + 神格特效、1 秒后光柱）
          → idle（神格结束，重新等冷却）。
   ⚠ 打断判据用【hp 下降】（= 这一下突破了格挡）：只有 pray 阶段会判；前摇挨打不打断
     （用户 2026-10-23 口径）。真言层数保留，移速恢复，直接进入下一轮冷却。
   ⚠ 头顶文字只有前摇/祈祷时的「祈祷nya...」，其余状态 statusText 一律 null。 */
class MechProstrate {
  constructor(u, p) {
    this.u = u;
    this.p = p;
    this.state = 'idle';
    this.cd = p.first === undefined ? 2.0 : p.first;
    this.windT = 0;          // 前摇剩余秒数
    this.windDur = 0;        // 前摇总时长（算线性减速用）
    this.timer = 0;          // 下一层真言的倒计时
    this.divTimer = 0;       // 神格剩余秒数
    this.beamT = 0;          // 神格开始到光柱落下的倒计时
    this.lastHp = u.hp;      // 祈祷打断判据（每帧对比）
    this.aura = null;        // 祈祷地面光环
    this.eye = null;         // 神格眼睛
    this.beam = null;        // 神格光柱
  }
  update(dt) {
    const u = this.u, p = this.p;
    if (!u.alive || u.dying) return;
    if (this.state === 'idle') {
      this.cd -= dt;
      if (this.cd <= 0 && u.grabbed <= 0) this.startWindup();
      return;
    }
    if (this.state === 'windup') { this.updateWindup(dt); return; }
    if (this.state === 'pray') { this.updatePray(dt); return; }
    if (this.state === 'divine') this.updateDivine(dt);
  }
  /* 前摇：提前出提示（statusText 从这一刻就显示）+ 移速线性压到 prayerSlow；
     期间【不判打断】—— 挨打也照常走完（用户 2026-10-23 口径）。 */
  startWindup() {
    const u = this.u, p = this.p;
    this.state = 'windup';
    this.windDur = Math.max(0.05, p.prayWindT === undefined ? 0.9 : p.prayWindT);
    this.windT = this.windDur;
    this.lastHp = u.hp;
    /* 法阵提前挂上（inT 淡入）+ 收缩蓄力环：一眼能看出“正在准备祈祷” */
    const a = new ProstrateAura(u, this.windDur * 0.8);
    world.effects.push(a);
    this.aura = a;
    world.effects.push(new ProstrateCharge(u, this.windDur));
    world.effects.push(new Ring(u.x, u.y, 8, 54, 0.35, '#e8d6ff', 2));
    sfx('card_deal', 0.30, 1.55);
  }
  updateWindup(dt) {
    const u = this.u, p = this.p;
    const slow = p.prayerSlow === undefined ? 0.12 : p.prayerSlow;
    this.windT -= dt;
    const k = clamp(1 - this.windT / this.windDur, 0, 1);   // 0 → 1 线性
    u.speedMul = 1 + (slow - 1) * k;                        // 100% → prayerSlow 线性减速
    if (this.windT <= 0) this.startPray();
  }
  startPray() {
    const u = this.u, p = this.p;
    this.state = 'pray';
    this.lastHp = u.hp;
    /* 祈祷起手：限时格挡（叠加数值 + 刷新时长） */
    WPAddTimedBlock(u, p.blockGain === undefined ? 30 : p.blockGain,
                    p.blockDur === undefined ? 5 : p.blockDur);
    /* 移速压到最低（离开祈祷恢复 1；神格期间压到 0） */
    u.speedMul = p.prayerSlow === undefined ? 0.12 : p.prayerSlow;
    /* 进入祈祷的一瞬间先送 1 层真言：否则一旦立刻挨打，玩家什么都看不到
       （用户 2026-10-23 口径）。送完立刻判满层，避免“9 层 + 1 层”卡住不进神格。 */
    const gift = Math.max(0, Math.round(p.mantraOnEnter === undefined ? 1 : p.mantraOnEnter));
    if (gift > 0) {
      u.mantra = (u.mantra || 0) + gift;
      const tier = Math.min(u.mantra, 10);
      world.effects.push(new Ring(u.x, u.y, 12, 34 + tier * 2, 0.26, '#e8d6ff', 2));
    }
    const m0 = p.mantra0 === undefined ? 0.9 : p.mantra0;
    const acc = p.mantraAccel === undefined ? 0.1 : p.mantraAccel;
    const mn = p.mantraMin === undefined ? 0.28 : p.mantraMin;
    this.timer = Math.max(mn, m0 - acc * u.mantra);
    world.effects.push(new Ring(u.x, u.y, 10, 74, 0.5, '#e8d6ff', 3));
    burst(u.x, u.y + 26, 10, { c: '#d8c0ff', s0: 50, s1: 200 });
    sfx('card_deal', 0.62, 1.15);
    if (u.mantra >= (p.mantraMax === undefined ? 10 : p.mantraMax)) this.enterDivine();
  }
  updatePray(dt) {
    const u = this.u, p = this.p;
    /* 打断：生命值比上一帧低 = 这一下突破了格挡（纯格挡吸收不会掉血）。
       ⚠ 先更新 lastHp 再判，避免同一帧反复触发。 */
    if (u.hp < this.lastHp) {
      this.lastHp = u.hp;
      this.interrupt();
      return;
    }
    this.lastHp = u.hp;
    /* 真言：间隔从 mantra0 起、每叠一层缩短 mantraAccel，最快 mantraMin */
    this.timer -= dt;
    if (this.timer <= 0) {
      u.mantra = (u.mantra || 0) + 1;
      const m0 = p.mantra0 === undefined ? 0.9 : p.mantra0;
      const acc = p.mantraAccel === undefined ? 0.1 : p.mantraAccel;
      const mn = p.mantraMin === undefined ? 0.28 : p.mantraMin;
      this.timer = Math.max(mn, m0 - acc * u.mantra);
      /* 真言层数由状态徽标显示（pw_mantra），这里只做“又叠了一层”的光效 */
      const tier = Math.min(u.mantra, 10);
      world.effects.push(new Ring(u.x, u.y, 12, 34 + tier * 2, 0.26, '#e8d6ff', 2));
      burst(u.x + vrand(-16, 16, 'vrand'), u.y - 34 + vrand(-12, 12, 'vrand'), 3,
            { c: '#e8d6ff', s0: 10, s1: 60 });
      sfx('card_deal', 0.16, 1.85, 0.08);
      /* 真言满层 → 离开祈祷、清空真言与格挡、进入神格 */
      if (u.mantra >= (p.mantraMax === undefined ? 10 : p.mantraMax)) this.enterDivine();
    }
  }
  /* 被打断：退出祈祷，真言层数保留，移速恢复，进入下一轮冷却。 */
  interrupt() {
    const u = this.u, p = this.p;
    this.state = 'idle';
    this.cd = rand(p.ivMin === undefined ? 6 : p.ivMin,
                   p.ivMax === undefined ? 8 : p.ivMax, 'prostrate.cd');
    u.speedMul = 1;
    if (this.aura) { this.aura.stop(); this.aura = null; }
    world.effects.push(new Ring(u.x, u.y, 16, 64, 0.4, '#ff9a8a', 3));
    burst(u.x, u.y, 10, { c: '#ffb0a0', s0: 60, s1: 220 });
    sfx('deny', 0.7, 1.1);
  }
  /* 真言满 10 层：清空真言与格挡，进入 divT 秒神格。 */
  enterDivine() {
    const u = this.u, p = this.p;
    this.state = 'divine';
    u.mantra = 0;
    u.setBlock(0, true);                       // 清空格挡（时限一并作废）
    u.speedMul = 0;                            // 神格期间不移动（每帧续，见 updateDivine）
    this.divTimer = p.divT === undefined ? 5 : p.divT;
    this.beamT = p.beamDelay === undefined ? 0.7 : p.beamDelay;
    u.divT = this.divTimer;                    // 徽标自动显示 pw_divinity + 倒计时
    if (this.aura) { this.aura.stop(); this.aura = null; }
    /* 神格动态特效：激活爆发 + 眼睛/紫金光晕（原版 DivinityEyeSpawner 等） */
    world.effects.push(new DivinityBurst(u));
    const eye = new DivinityEye(u, this.divTimer + 0.5);
    world.effects.push(eye);
    this.eye = eye;
    world.effects.push(new Ring(u.x, u.y, 10, 130, 0.63, '#ffd24a', 5));
    world.effects.push(new Ring(u.x, u.y, 6, 80, 0.40, '#e8d6ff', 3));
    burst(u.x, u.y, 26, { c: '#e8d6ff', s0: 90, s1: 360 });
    world.shake = Math.max(world.shake, 12);
    sfx('doom_apply', 0.9, 0.8);
    sfx('victory', 0.35, 1.5);
  }
  updateDivine(dt) {
    const u = this.u, p = this.p;
    /* 不移动：每帧续一次（防别的机制把倍率改回来） */
    u.speedMul = 0;
    this.divTimer -= dt;
    u.divT = Math.max(0, this.divTimer);
    /* beamDelay 秒后召唤光柱 */
    if (this.beamT > 0) {
      this.beamT -= dt;
      if (this.beamT <= 0 && !this.beam) {
        const b = new DivinityBeam(u, p);
        world.effects.push(b);
        this.beam = b;
        world.effects.push(new Ring(u.x, u.y, 20, 110, 0.45, '#e8d6ff', 4));
        world.shake = Math.max(world.shake, 12);
        sfx('lightning_orb_evoke', 0.9, 0.8);
      }
    }
    if (this.divTimer <= 0) this.endDivine();
  }
  /* 神格结束：立刻移除光柱、收起眼睛、恢复移动、进入下一轮冷却。 */
  endDivine() {
    const u = this.u, p = this.p;
    this.state = 'idle';
    if (this.beam && !this.beam.dead) this.beam.stop();
    this.beam = null;
    if (this.eye && !this.eye.dead) this.eye.stop();
    this.eye = null;
    u.divT = 0;
    u.speedMul = 1;
    this.cd = rand(p.ivMin === undefined ? 6 : p.ivMin,
                   p.ivMax === undefined ? 8 : p.ivMax, 'prostrate.cd');
    world.effects.push(new Ring(u.x, u.y, 18, 66, 0.4, '#e8d6ff', 3));
  }
  /* 唯一允许的头顶文字（用户明确要求）：前摇/祈祷时的「祈祷nya...」；其余时候 null。
     2026-10-23 口径：提示要【提前】出现 —— 前摇一开始就显示，而不是进入祈祷才显示。 */
  statusText() {
    return (this.state === 'windup' || this.state === 'pray')
      ? { t: '祈祷nya...', c: '#e8d6ff' } : null;
  }
}

/* ---------- 注册（片段顶层只做这两行 MECHS 赋值） ---------- */
MECHS.wish = MechWish;
MECHS.prostrate = MechProstrate;
