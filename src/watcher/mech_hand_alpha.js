/* ============================================================
   7.8 观者卡牌机制（片段 A）——「以手拒之」/「阿尔法」
   ------------------------------------------------------------
   本文件是 src/watcher/mech_hand_alpha.js 的原文，由 tools/splice_watcher.py
   整段拼进 src/game.html 的 WATCHER_MECHS_START/END 自动生成区（7.7 之后、第 8 章之前）。
   片段运行在游戏主脚本的顶层作用域，可以直接用 Unit / Effect / world / IMG / rand 等全局对象。

   约定（和同批片段保持一致，避免互相打架）：
     · 顶层只出现新 class 与 MECHS 注册，不声明任何全局 const/let/function；
     · 决定对局走向的随机一律 rand(a,b)（对战流），纯观感随机一律 vrand（观感流），
       全文件没有 Math.random；
     · 头顶不加任何状态文字：两张卡的 statusText() 恒返回 null
       （贝塔/欧米伽挂的是 MechNone，它本身也返回 null）；
     · 数值全部读 card.p（CARDS 里 id = talk_to_the_hand / alpha 两项），
       本文件只在构造函数里补一份“缺键兜底默认值”，方便片段先于卡表落地时单独跑。
       调平衡请改 card.p，不要改这个文件里的数学。

   依赖素材（IMG[] 的 key，由 build.py 从反编译资源打进包）：
     · 'pw_block_return' —— 以手拒之的手掌贴图（watcher mod 的 block_return_power 图标）；
     · 'card_beta' / 'card_omega' —— 贝塔 / 欧米伽的 token 卡面（走 Unit.imgKey → drawUnits）。
   缺图兜底：手掌会程序画一只简化手掌，贝塔/欧米伽走 drawUnits 的“无图色块”分支，不会报错。
   ============================================================ */

/* ---------- 7.8.1 以手拒之：环绕自己的手掌虚影 ---------- */
/* 手掌本体（纯 Effect：不进碰撞、不会被索敌、不会被打死）。
   轨道：第 slot 只手占 handMax 等分轨道里的一格（slot / handMax × TAU），
   再叠加 MechTalkToTheHand.spin（每秒 orbitSpin 弧度）整体公转；半径 orbitR，
   另加几像素的 sin 呼吸浮动（纯观感）。绘制时手掌“朝外”：
   ctx.rotate(朝向 + π/2) 把贴图自身的上方向转到轨道径向外侧。

   拍击状态机：
     idle  —— 吸附在轨道上；【自己这一只手的拍击冷却】this.cd 走完、且 slapRange 内
              有敌人时，找最近的一个起手；
     lunge —— 朝目标快速拍出（0.34s 的正弦包络：伸出 → 命中 → 收回），
              进度过 45% 的那一帧结算一次：slapDmg 点伤害（走 e.damage(..., u)，
              所以吃力量/虚弱/易伤）+ 本体 addTimedBlock(blockGain, blockDur)。

   ⚠ 拍击冷却 2026-10-23 用户口径改成【每只手独立计算】：冷却记在各自 WatcherHand.cd 上，
     起手即把这只手自己的 cd 置满 p.slapCd；不再有跨手的全局节流（MechTalkToTheHand.slapCd
     已删除）。为了让“每只手独立”不至于把总输出顶上天，p.slapCd 从 1.55 拉长到 10.0，
     之后按用户要求一路调整：10.0 → 9.0 → 7.5 →【8.0】（本轮“改成 8 秒”）——
     单只手平均 8 秒拍一下；同时 slapDmg 60 →【50】（“伤害削弱为 50 点”）。
     新手掌落地时给一个“刚睡醒”的短冷却（cd 初值 = p.slapCd × handWake），
     否则刚长出来的手要干等太久才肯出手，前中期手感会像没做事。

   ⚠ 给的是【限时格挡】而不是 addBlock：按用户口径“新格挡叠加数值 + 刷新时长”，
     由 Unit.addTimedBlock 统一实现（见 Lead 的基础设施）。这里留一条 addBlock 兜底，
     只为本片段能早于基础设施落地时先跑起来；正式构建一定走 addTimedBlock。
   ⚠ 手掌不会主动消失（上限 handMax=6 只常驻），本体阵亡后安静淡出回收。 */
class WatcherHand extends Effect {
  constructor(mech, slot) {
    super();
    this.mech = mech;              // 所属机制（读 mech.spin 做整体公转）
    this.u = mech.u;               // 本体单位
    this.p = mech.p;               // 卡牌参数表（card.p + 兜底）
    this.slot = slot;              // 轨道槽位 0..handMax-1
    this.phase = vrand(0, TAU, 'vrand');   // 呼吸/脉动相位（观感流，只掷一次）
    /* 当前绘制位置 / 朝向：update 里算好，draw 直接用。
       （draw 的调用次数和 update 不一定同步，绝不能把世界计算塞进 draw。） */
    this.px = this.u.x; this.py = this.u.y; this.pa = 0;
    this.fade = 0;                 // 出生淡入（0→1）
    /* 每只手【自己】的拍击冷却：出生时给一个较短的“刚睡醒”冷却，
       起手后置满 p.slapCd（各手互不影响，见类注释）。 */
    this.cd = this.p.slapCd * (this.p.handWake === undefined ? 0.30 : this.p.handWake);
    this.state = 'idle';
    this.stT = 0;                  // 本次拍击动作已进行的秒数
    this.hitDone = false;          // 本次拍击是否已经结算过命中
    this.tgt = null;               // 本次拍击锁定的敌人
    this.reach = 0;                // 本次拍击的伸出距离（像素，触发时按距离定）
    this.dirx = 1; this.diry = 0;  // 拍出方向（目标死了以后沿用这个方向）
    this.sparkT = 0;               // 轨道火星计时（纯观感）
  }
  /* 轨道基准位置：半径 + 呼吸浮动，并返回向外的角度 */
  waBase() {
    const p = this.p;
    const a = this.slot * TAU / Math.max(1, p.handMax) + this.mech.spin;
    const rr = p.orbitR + Math.sin(world.t * 2.1 + this.phase) * 4;
    return { x: this.u.x + Math.cos(a) * rr, y: this.u.y + Math.sin(a) * rr, a: a };
  }
  /* 在手掌中心 slapRange 内找最近的敌方单位（本体/仆从都算） */
  waFindTarget(x, y) {
    const p = this.p;
    let best = null, bd = p.slapRange;
    for (const e of world.enemiesOf(this.u)) {
      if (!e.alive || e.dying || e.finished) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= bd) { bd = d; best = e; }
    }
    return best;
  }
  update(dt) {
    const u = this.u, p = this.p;
    /* 出生淡入；本体阵亡 → 手掌安静淡出回收（不弹字、不震屏） */
    if (!u.alive || u.dying) {
      this.state = 'idle';
      this.fade -= dt * 2.4;
      if (this.fade <= 0) { this.dead = true; return; }
    } else if (this.fade < 1) {
      this.fade = clamp(this.fade + dt * 4, 0, 1);
    }
    const base = this.waBase();
    /* 每只手自己的拍击冷却（一直往前跑；起手那一帧由下面重新置满） */
    if (this.cd > 0) this.cd -= dt;
    /* ---------- 空闲：吸附轨道，自己的冷却好了就找目标起手 ---------- */
    if (this.state !== 'lunge') {
      this.state = 'idle';
      this.px = base.x; this.py = base.y; this.pa = base.a;
      /* 轨道上的细碎金色火星（纯观感，走观感流）。
         2026-10-23 用户口径：火星也是“光效”，同样只在冷却好了之后才冒 ——
         冷却中的手掌不再有任何发光物，避免被误读成“随时能拍”。 */
      if (this.cd <= 0) {
        this.sparkT += dt;
        while (this.sparkT >= 0.4) {
          this.sparkT -= 0.4;
          world.effects.push(new Spark(this.px + vrand(-10, 10, 'vrand'),
                                       this.py + vrand(-10, 10, 'vrand'),
                                       { c: '#ffe6b8', s0: 6, s1: 34 }));
        }
      } else {
        this.sparkT = 0;
      }
      if (!u.alive || u.dying) return;
      /* 被拎着（恶魔之手）：不能发起攻击，只绕圈（引擎口径：被抓=不能触发机制） */
      if (u.grabbed > 0) return;
      /* 这只手自己的拍击冷却还没走完 */
      if (this.cd > 0) return;
      const tgt = this.waFindTarget(this.px, this.py);
      if (!tgt) return;
      /* 起手：锁定目标、算出这次要伸出多远（纯视觉，判定半径仍是 slapRange） */
      this.tgt = tgt;
      this.state = 'lunge'; this.stT = 0; this.hitDone = false;
      this.cd = p.slapCd;                        // 只给这一只手记冷却（各手独立）
      const d = Math.hypot(tgt.x - base.x, tgt.y - base.y) || 1;
      this.dirx = (tgt.x - base.x) / d; this.diry = (tgt.y - base.y) / d;
      this.reach = clamp(d - p.handSize * 0.3, 12, p.handSize * 1.9);
      sfx('blunt_attack', 0.18, 1.55, 0.08);     // 起手风声（很轻）
      return;
    }
    /* ---------- 拍击动作：0.34s 的正弦包络（伸出 → 命中 → 收回） ---------- */
    this.stT += dt;
    const prog = clamp(this.stT / 0.34, 0, 1);
    const ext = this.reach * Math.sin(Math.PI * prog);   // 0 → 最远 → 0
    let dx = this.dirx, dy = this.diry;
    const tgt = this.tgt;
    if (tgt && tgt.alive && !tgt.dying && !tgt.finished) {
      const dd = Math.hypot(tgt.x - base.x, tgt.y - base.y) || 1;
      dx = (tgt.x - base.x) / dd; dy = (tgt.y - base.y) / dd;
    }
    this.px = base.x + dx * ext;
    this.py = base.y + dy * ext;
    this.pa = Math.atan2(dy, dx);                        // 拍出时掌心朝目标
    if (!this.hitDone && prog >= 0.45) {                 // 动作中段结算一次命中
      this.hitDone = true;
      this.waImpact();
    }
    if (prog >= 1) { this.state = 'idle'; this.tgt = null; this.stT = 0; }
  }
  /* 拍击结算：命中 → slapDmg 伤害 + 本体限时格挡。
     “拍空”（目标在动作途中死了/被击飞）不给格挡，只留一点掌风 ——
     和用户口径“拍出造成伤害并给予格挡”一致：格挡是命中奖励，不是出手就送。 */
  waImpact() {
    const p = this.p, u = this.u, tgt = this.tgt;
    if (!u.alive || u.dying) return;
    if (!tgt || !tgt.alive || tgt.dying || tgt.finished ||
        Math.hypot(tgt.x - this.px, tgt.y - this.py) > p.slapRange + p.handSize * 0.6) {
      world.effects.push(new Ring(this.px, this.py, 4, p.handSize * 1.2, 0.22,
                                  'rgba(255,226,170,.55)', 2));
      return;
    }
    /* 走 damage()：吃力量（Lead 在 damage() 里加固定值）、虚弱、易伤 */
    tgt.damage(p.slapDmg, 'hit', u);
    if (u.alive && !u.dying) {
      /* 限时格挡：叠加数值 + 刷新时长（Lead 的 Unit.addTimedBlock） */
      if (typeof u.addTimedBlock === 'function') u.addTimedBlock(p.blockGain, p.blockDur);
      else if (typeof u.addBlock === 'function') u.addBlock(p.blockGain);   // 旧引擎兜底
    }
    /* 命中反馈：掌风环 + 内圈亮环 + 火星 + 轻震屏（纯观感） */
    world.effects.push(new Ring(tgt.x, tgt.y, 8, p.handSize * 2.2, 0.26,
                                'rgba(255,214,150,.92)', 3));
    world.effects.push(new Ring(tgt.x, tgt.y, 2, p.handSize * 1.1, 0.16,
                                'rgba(255,250,235,.95)', 2));
    burst(tgt.x, tgt.y, 12, { c: '#ffe2b0', s0: 90, s1: 300 });
    sfx('heavy_attack', 0.55, 1.08);
    world.shake = Math.max(world.shake, 4);
  }
  draw(ctx) {
    if (this.fade <= 0.01) return;
    const p = this.p, im = IMG['pw_block_return'];
    const S = Math.max(8, p.handSize);
    const pulse = 0.5 + 0.5 * Math.sin(world.t * 3.4 + this.phase);
    /* 手掌贴图放大后（handSize 38 → 54）整体压一点透明度，避免六只大手把卡面糊满。
       2026-10-23 用户口径：冷却中的手掌【变暗】（×0.82 透明度 + 贴图 brightness 0.70），
       一眼区分“亮着 = 冷却好了能拍 / 暗着 = 冷却中”；拍击动作（lunge）本身不压暗。 */
    const cooling = this.cd > 0 && this.state !== 'lunge';
    const alpha = clamp(this.fade, 0, 1) * (0.40 + 0.10 * pulse) * (cooling ? 0.82 : 1);   // 半透明虚影（0.40~0.50）
    ctx.save();
    /* 手背的柔光：径向渐变 + lighter，叠在卡面上也不会发灰。
       2026-10-23 用户口径：这层【微弱光效只在冷却好了之后才显示】——
       冷却中（cd > 0）藏起来，玩家一眼就能看出“这只手现在能拍”。 */
    if (this.cd <= 0) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(this.px, this.py, 0, this.px, this.py, S * 1.5);
      g.addColorStop(0, 'rgba(255,226,168,' + (0.30 * alpha).toFixed(3) + ')');
      g.addColorStop(0.55, 'rgba(255,190,120,' + (0.14 * alpha).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,180,110,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.px, this.py, S * 1.5, 0, TAU); ctx.fill();
    }
    /* 拍击时的掌风：沿拍出方向扫一段弧形光 */
    if (this.state === 'lunge') {
      const k = Math.sin(Math.PI * clamp(this.stT / 0.34, 0, 1));
      ctx.globalAlpha = alpha * k * 0.75;
      ctx.strokeStyle = 'rgba(255,236,190,.9)';
      ctx.lineWidth = 5 * k + 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(this.px, this.py, S * 0.9, this.pa - 1.0, this.pa + 1.0);
      ctx.stroke();
    }
    /* 手掌贴图：贴图自身“上”方向转到 pa（轨道外向 / 拍出方向）。
       用户 2026-10-23 口径：“冷却期间贴图色调再暗一点” → 冷却中给贴图加
       brightness/saturate 滤镜（色调变暗），只影响贴图本体，掌风/柔光不受影响。 */
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    if (cooling) ctx.filter = 'brightness(0.70) saturate(0.90)';
    ctx.translate(this.px, this.py);
    ctx.rotate(this.pa + Math.PI / 2);
    const breathe = 1 + 0.06 * Math.sin(world.t * 3.4 + this.phase);
    if (im) {
      ctx.drawImage(im, -S * 0.5 * breathe, -S * 0.5 * breathe, S * breathe, S * breathe);
    } else {
      /* 缺图兜底：程序画一只简化手掌（掌心 + 四根手指），保证没有素材时也看得见 */
      ctx.fillStyle = 'rgba(255,232,196,.62)';
      ctx.beginPath(); ctx.arc(0, S * 0.10, S * 0.30, 0, TAU); ctx.fill();
      for (let i = 0; i < 4; i++) {
        const fa = -0.62 + i * 0.41;
        ctx.beginPath();
        ctx.arc(Math.sin(fa) * S * 0.26, -S * 0.26 - Math.cos(fa) * S * 0.12, S * 0.075, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/* 以手拒之的机制：定时往身上贴一只手掌，上限 handMax 只，常驻不消失。
   手掌的“找目标/拍击/给格挡”都在 WatcherHand 自己的 update 里跑
   （它们在世界 effects 数组里，由引擎统一 update/draw）；这里只负责：
     ① 推进整体公转相位 spin（手掌按它算轨道角度）；
     ② 按【递减的】间隔生成新的手掌（first 是首发延迟，之后每长一只就快一点，
        形成“越打越顺手”的成长曲线；handShrink 是每一档的间隔缩减系数）；
     ③ 记一份 hands 账本（给“是否已满”和槽位分配用）。
   拍击冷却不在这里：每只手自己算（见 WatcherHand.cd 与类注释）。 */
class MechTalkToTheHand {
  constructor(u, p) {
    this.u = u;
    /* 参数兜底：正式构建里全部来自 CARDS[id=talk_to_the_hand].p */
    this.p = Object.assign({
      first: 1.8, handIv: 6.0, handShrink: 0.88, handMax: 6, orbitR: 86, orbitSpin: 1.2,
      handSize: 54, slapRange: 170, slapCd: 8.0, handWake: 0.30,
      slapDmg: 50, blockGain: 20, blockDur: 5.0
    }, p || {});
    this.hands = [];                 // 当前存活的手掌（Effect 本体）
    this.spawnCd = this.p.first;     // 下一只手的生成倒计时
    /* 下一档生成间隔：每长出一只就按 handShrink 缩短（成长曲线）。
       第一只手之后是 handIv，之后 handIv×0.88、×0.88²…（夹到 0.6s 下限）。 */
    this.nextIv = this.p.handIv;
    this.spin = 0;                   // 整体公转相位（弧度，持续累加）
  }
  update(dt) {
    const u = this.u, p = this.p;
    if (!u.alive || u.dying) return;
    this.spin += p.orbitSpin * dt;               // 整体缓慢公转
    this.hands = this.hands.filter(h => !h.dead);   // 回收已淡出的手（仅本体阵亡时出现）
    /* 满员：不再生成（手掌常驻不消失，槽位空不出来） */
    if (this.hands.length >= Math.max(1, p.handMax)) return;
    /* 被拎着：暂停生成、也不攒次数（引擎口径：被抓期间不触发机制） */
    if (u.grabbed > 0) return;
    this.spawnCd -= dt;
    if (this.spawnCd <= 0) {
      /* 生成以后按成长曲线缩短下一次的间隔（不在这里一次性算完，方便中途改参数） */
      this.spawnCd = this.nextIv;
      this.nextIv = Math.max(0.6, this.nextIv * (p.handShrink === undefined ? 0.88 : p.handShrink));
      this.waSpawn();
    }
  }
  waSpawn() {
    const p = this.p, u = this.u;
    /* 固定槽位：按 0..handMax-1 里最小的空位坐进去。
       槽位固定后不会因为“又长出一只”而整排跳位（观感稳定、轨道均匀）。 */
    let slot = -1;
    for (let s = 0; s < Math.max(1, p.handMax); s++) {
      if (!this.hands.some(h => !h.dead && h.slot === s)) { slot = s; break; }
    }
    if (slot < 0) return;
    const h = new WatcherHand(this, slot);
    this.hands.push(h);
    world.effects.push(h);               // 进世界 effects：引擎负责 update/draw
    /* 出生反馈：浅金环 + 火星 + 轻音效（纯观感） */
    const a = slot * TAU / Math.max(1, p.handMax) + this.spin;
    const sx = u.x + Math.cos(a) * p.orbitR;
    const sy = u.y + Math.sin(a) * p.orbitR;
    world.effects.push(new Ring(sx, sy, 4, p.handSize * 1.2, 0.3,
                                'rgba(255,226,168,.85)', 2.6));
    burst(sx, sy, 8, { c: '#ffe0b0', s0: 30, s1: 120 });
    sfx('card_deal', 0.4, 1.5);
  }
  /* 头顶不显示任何文字（用户口径：这两张卡不加 overhead 文字） */
  statusText() { return null; }
}
MECHS.talk_to_the_hand = MechTalkToTheHand;

/* ============================================================
   7.8.2 阿尔法：原地不动的贝塔 → 欧米伽冲击波
   ------------------------------------------------------------
   单位链：阿尔法本体（普通 Unit）→ 定时种下「贝塔」token（Unit 子类）
           → 贝塔 betaGrow（7 秒）后原地转化成「欧米伽」token（Unit 子类）
           → 欧米伽登场 omegaFirst 秒后放第一道冲击波，之后每 omegaWaveCd 秒一道。

   贝塔/欧米伽是【真正的 Unit】（进 world.units，有血量、会被敌方索敌/打掉），
   走两条特殊约定：
     · minion = true：drawUnits 按仆从口径画（0.8 倍卡面 + 仆从血条）——
       尺寸与仆从完全相同；2026-10-23 用户口径“太小了，改成与仆从相同大小”，
       于是取消原先额外的 sizeMul=0.8（不再缩到 0.64）；
     · 实体碰撞：不设 ghost —— 与【敌方和友方】单位都按体积弹开（2026-10-23
       用户口径“贝塔和欧米伽要对敌方友方有碰撞”），会挡路、也会被撞开。
   2026-10-23 用户口径（追加）：
     · 贝塔要能【正常移动】（随机方向漂移、撞墙反弹，欧米伽仍是固定炮台），
       但移动速度比正常角色【低一点】：p.betaSpeed（默认 CFG.SPEED×0.8 = 120）；
     · 召唤贝塔时增加【动画表现】：WAAlphaSummon（法阵收拢 + 卡面虚影 + 火花）；
     · 贝塔/欧米伽的卡边改成【灰色】、像仆从一样（烘焙层改成 colorless 卡框）；
     · 欧米伽冲击波范围：160 → 180 → 220，现【削弱回 200】（waveSpd 保持 320）；
     · 贝塔→欧米伽加【卡牌变化动画】：旧卡面放大淡出 + 白光闪一下，欧米伽本体
       从 0.55 倍弹到 1.0 倍（参考本体反编译 NCardTransformVfx/ShineVfx）；
     · 贝塔→欧米伽后阿尔法的召唤冷却【重新读条 betaIv】——但只在【场上还存在另一只贝塔】
       时触发；最后一只贝塔转化不重置倒计时（用户 2026-10-23 修订口径）。
   2026-10-23 用户口径（数值，第五轮）：
     · 阿尔法召唤贝塔 betaIv = 4 秒（上一版 3）、贝塔同时存在上限 betaMax = 2（上一版 1）、
       贝塔生命 betaHp = 100（上一版 150）；
     · 贝塔→欧米伽 betaGrow = 7 秒（上一版 5，本轮 +2 秒）；欧米伽【继承贝塔当前生命】；
     · 欧米伽 omegaHp = 100（上一版 75）、omegaMax = 3（上一版 4）、
       omegaWaveDmg = 150（上一版 100）、冲击波间隔 omegaWaveCd = 2.5 秒（上一版 3）。
   它们的 mech 挂 MechNone（没有自己的机制轮询），生命周期由 MechAlpha.update 手工推进
   —— 和 MechSoulStorm 管 SoulUnit 的方式一致。
   ⚠ 欧米伽的首波延迟单独用 p.omegaFirst（0.35s）：固定 3 秒太长，欧米伽常活不到第一波。
   ============================================================ */

/* ---------- 贝塔的召唤演出 ---------- */
/* 2026-10-23 用户口径：“召唤时增加动画表现”。
   纯观感（vrand），不参与任何判定；life 0.5s，分三层：
     ① 地面法阵：紫色椭圆从外向内收拢、越收越亮；
     ② 卡面虚影：半透明卡框从 1.3 倍缩到 1.0 倍、并快速淡出（读起来像“卡牌凝聚成形”）；
     ③ 向上升腾的紫金火花。
   绘制用 IMG['card_beta'] 当剪影（缺图时画一个圆角矩形兜底）。 */
class WAAlphaSummon extends Effect {
  constructor(x, y, imgKey, w, h) {
    super();
    this.x = x; this.y = y;
    this.imgKey = imgKey || 'card_beta';
    this.w = w || 70; this.h = h || 99;
    this.t = 0;
    this.life = 0.5;
    this.sparks = [];
    for (let i = 0; i < 10; i++) {
      this.sparks.push({
        a: vrand(0, TAU, 'vrand'),
        r: vrand(18, 52, 'vrand'),
        ph: vrand(0, 1, 'vrand'),
        sz: vrand(0.7, 1.4, 'vrand')
      });
    }
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.life) { this.dead = true; return; }
  }
  draw(ctx) {
    const k = clamp(this.t / this.life, 0, 1);
    const A = Math.min(clamp(this.t / 0.10, 0, 1), clamp((this.life - this.t) / 0.18, 0, 1));
    if (A <= 0.01) return;
    const cy = this.y + this.h * 0.42;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* ① 地面法阵：从 1.55 倍收到 0.85 倍（椭圆；老浏览器没有 ctx.ellipse 就退化成圆） */
    const rr = this.w * (1.55 - 0.70 * k);
    const ell = (rx, ry) => {
      ctx.beginPath();
      if (ctx.ellipse) ctx.ellipse(this.x, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
      else ctx.arc(this.x, cy, Math.max(0.1, rx), 0, TAU);
    };
    ctx.strokeStyle = 'rgba(190,150,255,' + (0.75 * A).toFixed(3) + ')';
    ctx.lineWidth = 2.4;
    ell(rr * 0.62, rr * 0.22); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,160,' + (0.45 * A).toFixed(3) + ')';
    ctx.lineWidth = 1.5;
    ell(rr * 0.40, rr * 0.14); ctx.stroke();
    const rg = ctx.createRadialGradient(this.x, cy, 0, this.x, cy, rr * 0.85);
    rg.addColorStop(0, 'rgba(170,120,240,' + (0.22 * A).toFixed(3) + ')');
    rg.addColorStop(1, 'rgba(170,120,240,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(this.x, cy, rr * 0.85, 0, TAU); ctx.fill();
    /* ② 卡面虚影：从 1.30 倍缩到 1.00 倍，同时淡出 */
    const sc = 1.30 - 0.30 * k;
    const im = IMG[this.imgKey];
    ctx.globalAlpha = A * (0.55 * (1 - k) + 0.12);
    if (im) {
      ctx.drawImage(im, this.x - this.w * sc / 2, this.y - this.h * sc / 2,
                    this.w * sc, this.h * sc);
    } else {
      rrPath(ctx, this.x - this.w * sc / 2, this.y - this.h * sc / 2, this.w * sc, this.h * sc, 8);
      ctx.fillStyle = 'rgba(210,180,255,.35)'; ctx.fill();
    }
    /* ③ 紫金火花向上飘（缺 sp_glow_spark 时退化成小圆点） */
    const spark = IMG['sp_glow_spark'];
    for (const s of this.sparks) {
      const ph = (k * 1.15 + s.ph) % 1;
      const px = this.x + Math.cos(s.a) * s.r * (1 - 0.45 * ph);
      const py = this.y + this.h * 0.2 - ph * this.h * 0.95;
      const a = A * 0.6 * Math.sin(Math.PI * ph);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      if (spark) ctx.drawImage(spark, px - 5 * s.sz, py - 11 * s.sz, 10 * s.sz, 22 * s.sz);
      else { ctx.fillStyle = '#e8d6ff'; ctx.beginPath(); ctx.arc(px, py, 2.4 * s.sz, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }
}

/* 贝塔→欧米伽的「卡牌变化」演出。
   参考本体反编译的卡牌变化表现（NCardTransformVfx / NCardTransformShineVfx）：
     ① 旧卡面先做 anticipation（放大一点）+ 白闪 → ② 换成新卡面（欧米伽自己的
     appearScale 从 0.55 弹到 1.0，easeOutBack 略过冲）→ ③ 光晕扩散 + 粒子。
   本类负责 ①：0.5 秒内把贝塔卡面从 1.0 放大到 1.18 并淡出，中心叠一层白光。
   纯观感（vrand），不参与任何判定；缺图时用一个白色圆角块兜底。 */
class WAAlphaMorph extends Effect {
  constructor(x, y, w, h) {
    super();
    this.x = x; this.y = y;
    this.w = w || 70; this.h = h || 99;
    this.t = 0;
    this.life = 0.5;
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.life) { this.dead = true; return; }
  }
  draw(ctx) {
    const k = clamp(this.t / this.life, 0, 1);
    const A = clamp((1 - k) / 0.55, 0, 1);          // 末段快速淡出
    if (A <= 0.01) return;
    /* ① 旧卡面 anticipation：1.00 → 1.18，边放大边淡出（像卡牌"变形"前鼓起） */
    const sc = 1.0 + 0.18 * (1 - Math.pow(1 - k, 2));
    const im = IMG['card_beta'];
    ctx.save();
    ctx.globalAlpha = A * 0.9;
    if (im) {
      ctx.drawImage(im, this.x - this.w * sc / 2, this.y - this.h * sc / 2,
                    this.w * sc, this.h * sc);
    } else {
      ctx.fillStyle = 'rgba(255,240,200,.55)';
      rrPath(ctx, this.x - this.w * sc / 2, this.y - this.h * sc / 2,
             this.w * sc, this.h * sc, 8);
      ctx.fill();
    }
    /* ② 中心白光：前 45% 时间闪一下（加法混合，叠在卡面上） */
    ctx.globalCompositeOperation = 'lighter';
    const flash = k < 0.45 ? Math.sin(Math.PI * (k / 0.45)) : 0;
    if (flash > 0.01) {
      const R = this.w * (0.55 + 0.65 * k);
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, R);
      g.addColorStop(0, 'rgba(255,255,240,' + (0.85 * flash).toFixed(3) + ')');
      g.addColorStop(0.55, 'rgba(255,220,150,' + (0.35 * flash).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,180,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, this.y, R, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

/* 贝塔：会正常移动的 token 卡。betaGrow（默认 7 秒）后由 MechAlpha 换成欧米伽。 */
class BetaUnit extends Unit {
  constructor(owner, p, x, y) {
    /* 伪卡：hp 取 betaHp；speed 取 p.betaSpeed（默认 0.8×正常移速）；mech 占位用 'none'。
       ⚠ 不要给 this.p 赋值：引擎 rOf() 会把 minion.p.mR 当成碰撞半径，
         这里的碰撞半径走 this.rBody（betaR）。 */
    super({ id: 'beta', hp: p.betaHp,
            speed: p.betaSpeed === undefined ? Math.round(CFG.SPEED * 0.8) : p.betaSpeed,
            mech: 'none', p: null }, owner.team);
    this.minion = true;        // 仆从渲染（0.8 倍卡面 + 仆从血条）——尺寸与仆从相同
    /* minionToken = 【按仆从渲染、但不是「冲锋！！」的同类仆从】的召唤 token 标记。
       贝塔/欧米伽是阿尔法种下的真单位（有血量、会被敌方索敌/打掉），
       冲锋仆从的冲撞必须能结算伤害 —— 引擎的 MinionBrain.onUnitHit 只拦
       “真正的同类仆从”，靠这个标记把 token 放行。
       2026-10-23 用户报“冲锋的仆从无法对贝塔/欧米伽造成伤害”，根因就是两者
       都打了 minion = true，被“仆从之间互不伤害”那句统一拦掉了。 */
    this.minionToken = true;
    /* 不设 sizeMul：与仆从同尺寸（用户 2026-10-23 口径“改成与仆从相同大小”）。
       不设 ghost：与敌我双方都做物理碰撞（用户 2026-10-23 口径“要对敌方友方有碰撞”）。 */
    this.o = owner;            // 召唤者（阿尔法本体），伤害统计/索敌都认它
    this.bp = p;               // 本卡参数（不用 this.p，见上面的警告）
    this.rBody = p.betaR;      // 碰撞半径（引擎 rOf 认这个字段）
    this.imgKey = 'card_beta';
    this.x = x; this.y = y;
    /* 正常移动：出生时随机一个方向，之后按标准移速直线漂移、撞墙反弹。
       方向会影响对局（被打掉/转化位置都跟着变）→ 用对战随机流 rand。 */
    const a = rand(0, TAU);
    this.dx = Math.cos(a); this.dy = Math.sin(a);
    this.age = 0;              // 已存在秒数（MechAlpha 推进；到 betaGrow 转化）
    this.bouncePop = 1;        // 出生时卡面小弹一下（drawUnits 的通用字段）
  }
  /* 长大 → 安静消失：不播死亡动画、不弹伤害字、不震屏。
     只标成“不可见、不参与任何结算”：
       drawUnits 用 `!alive && !dying` 跳过、drawUnitHUD 也跳过、
       索敌/碰撞/机制轮询都要求 alive —— 于是它从场上彻底消失。
     ⚠ 不直接 splice world.units：stepPhysics 正用 for..of 遍历这个数组，
       删除元素会让后面的单位跳过一轮机制更新。留一个不可见的空壳最安全
       （整局最多留下几十个空壳，开销可忽略）。 */
  waGrowAway() {
    if (!this.alive || this.dying) return false;
    this.alive = false; this.finished = true;
    this.block = 0; this.doom = 0;
    return true;
  }
}

/* 欧米伽：不移动的 token 卡。登场 omegaFirst 秒后放第一道冲击波，之后每 omegaWaveCd 秒一道。 */
class OmegaUnit extends Unit {
  constructor(owner, p, x, y) {
    super({ id: 'omega', hp: p.omegaHp, speed: CFG.SPEED, mech: 'none', p: null }, owner.team);
    this.minion = true;          // 与仆从同尺寸（不设 sizeMul）
    this.minionToken = true;     // 召唤 token：按仆从渲染，但可被冲锋仆从撞掉（理由见 BetaUnit）
    /* 不设 ghost：与敌我双方都做物理碰撞（用户 2026-10-23 口径）。 */
    this.o = owner;
    this.op = p;                 // 本卡参数（不用 this.p，理由同 BetaUnit）
    this.rBody = p.omegaR;
    this.imgKey = 'card_omega';
    this.x = x; this.y = y;
    this.dx = 0; this.dy = 1;
    /* 首波：p.omegaFirst（默认 0.35s；缺键时退回 omegaWaveCd）。
       之后 updateOmega 用 += omegaWaveCd 走固定节拍：0.35、0.35+3、0.35+6… */
    this.waveCd = p.omegaFirst === undefined ? p.omegaWaveCd : p.omegaFirst;
    this.bouncePop = 1;
    /* 变身缩放（用户 2026-10-23 口径“贝塔变成欧米伽要有缩放动画”，参考本体
       反编译的卡牌变化表现）：出场 0.42 秒内从 0.55 倍弹到 1.0 倍，easeOutBack
       末段轻微过冲。drawUnits / drawUnitHUD 通过 appearScale() 读这个系数。 */
    this.appearT = 0;
    this.appearDur = 0.42;
  }
  curSpeed() { return 0; }       // 原地不动
  /* 出场/变身缩放系数：没有动画时恒为 1 */
  appearScale() {
    if (this.appearT >= this.appearDur) return 1;
    const k = clamp(this.appearT / this.appearDur, 0, 1);
    const c1 = 1.70158, c3 = c1 + 1;
    const e = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
    return 0.55 + 0.45 * e;
  }
  /* 每步由 MechAlpha.update 调：节拍走完就放一道冲击波 */
  updateOmega(dt) {
    if (!this.alive || this.dying) return;
    if (this.appearT < this.appearDur) this.appearT += dt;   // 变身缩放动画推进
    this.waveCd -= dt;
    if (this.waveCd <= 0) {
      /* 用 += 而不是 =：固定节拍不会因为长帧/冻结把后续波越拖越晚 */
      this.waveCd += this.op.omegaWaveCd;
      this.waCastWave();
    }
  }
  waCastWave() {
    const p = this.op, o = this.o;
    world.effects.push(new WAAlphaWave(this.x, this.y, o,
                                       p.omegaWaveDmg, p.omegaWaveR, p.waveSpd));
    /* 起手的一圈压缩环 + 低频音效（纯观感，不参与判定） */
    world.effects.push(new Ring(this.x, this.y, 10, p.omegaWaveR * 0.42, 0.30,
                                'rgba(255,140,50,.9)', 3));
    sfx('doom_apply', 0.30, 1.6, 0.20);
    world.shake = Math.max(world.shake, 2.5);
  }
}

/* 欧米伽的橘红色圆形冲击波。
   判定：波前半径 r = waveSpd × 已过时间，从 0 一路推到 omegaWaveR；
         波前扫到哪个敌方单位（中心距 ≤ r）就给哪个单位结算一次 omegaWaveDmg
         —— 固定伤害、不按距离衰减，'hit' 类型。每道波对每个敌人只结算一次（hitSet）。
   来源记在【阿尔法本体】u 头上（不是欧米伽），这样对局统计算在观者这一方；
   同时顺着 damage() 吃本体的力量/虚弱等乘区（和手掌同一口径）。
   视觉：地面橘红色染 + 双层橘红环 + 脉动 + 中心余晖，全部程序绘制、不依赖素材。 */
class WAAlphaWave extends Effect {
  constructor(x, y, owner, dmg, maxR, spd) {
    super();
    this.x = x; this.y = y; this.o = owner;
    this.dmg = dmg;
    this.maxR = Math.max(1, maxR);
    this.spd = Math.max(1, spd);
    this.t = 0;
    /* 时长 = 走满 maxR 的时间，再留 12% 的收尾让环自然淡掉 */
    this.life = this.maxR / this.spd * 1.12;
    this.hitSet = new Set();
    this.phase = vrand(0, TAU, 'vrand');   // 脉动相位（观感流）
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.life) { this.dead = true; return; }
    const r = Math.min(this.maxR, this.spd * this.t);
    for (const e of world.enemiesOf(this.o)) {
      if (this.hitSet.has(e)) continue;
      if (!e.alive || e.dying || e.finished) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) > r) continue;
      this.hitSet.add(e);
      e.damage(this.dmg, 'hit', this.o);         // 固定 omegaWaveDmg（当前 150），不随距离衰减
      /* 命中反馈：橘红火星 + 小环 + 轻震屏 */
      burst(e.x, e.y, 10, { c: '#ffb060', s0: 80, s1: 260 });
      world.effects.push(new Ring(e.x, e.y, 6, 36, 0.24, 'rgba(255,150,60,.85)', 2.4));
      sfx('heavy_attack', 0.5, 1.15);
      world.shake = Math.max(world.shake, 5);
    }
  }
  draw(ctx) {
    const k = clamp(this.t / this.life, 0, 1);
    const r = Math.max(2, Math.min(this.maxR, this.spd * this.t));
    const fade = clamp((1 - k) * 1.6, 0, 1);           // 末段快速淡出
    const pulse = 0.72 + 0.28 * Math.sin(world.t * 16 + this.phase);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* ① 地面色染：从中心到波前的橘红径向渐变（越靠波前越亮） */
    const g = ctx.createRadialGradient(this.x, this.y, r * 0.10, this.x, this.y, r);
    g.addColorStop(0, 'rgba(255,120,40,' + (0.10 * fade).toFixed(3) + ')');
    g.addColorStop(0.68, 'rgba(255,100,30,' + (0.16 * fade).toFixed(3) + ')');
    g.addColorStop(0.92, 'rgba(255,150,60,' + (0.30 * fade).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, TAU); ctx.fill();
    /* ② 多层环：外圈亮橘 + 内圈金红 + 外侧柔光晕，错开半径/粗细 → 明显的冲击波厚度。
       2026-10-23 用户口径“冲击波要更粗一点，且扩散更慢”：线宽 7 → 15、内环 2.6 → 6，
       波速 waveSpd 520 → 320（走满 omegaWaveR=200 约 0.70 秒，能看清一圈厚厚的火环推过去）。 */
    ctx.globalAlpha = fade * pulse * 0.55;
    ctx.strokeStyle = 'rgba(255,110,30,.55)';
    ctx.lineWidth = 22 * (1 - k * 0.45);
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, TAU); ctx.stroke();
    ctx.globalAlpha = fade * pulse;
    ctx.strokeStyle = '#ff7a28';
    ctx.lineWidth = 15 * (1 - k * 0.50);
    ctx.shadowColor = 'rgba(255,120,40,.95)';
    ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, TAU); ctx.stroke();
    ctx.globalAlpha = fade * pulse * 0.85;
    ctx.strokeStyle = '#ffd27a';
    ctx.lineWidth = 6 * (1 - k * 0.35);
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.90, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0;
    /* ③ 波前内侧压一圈暗红，增加层次（不脉动） */
    ctx.globalAlpha = fade * 0.5;
    ctx.strokeStyle = 'rgba(200,40,10,.65)';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.97, 0, TAU); ctx.stroke();
    /* ④ 中心余晖：放波一瞬间的亮点，随扩散快速衰减 */
    if (k < 0.35) {
      const ck = 1 - k / 0.35;
      ctx.globalAlpha = ck * 0.85;
      const cg = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.maxR * 0.42);
      cg.addColorStop(0, 'rgba(255,230,170,.9)');
      cg.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.maxR * 0.42, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

/* 阿尔法的机制：定时种贝塔 + 推进贝塔转化 + 推进欧米伽冲击波。
   计数一律按“当前存活”现算（this.betas / this.omegas 每步过滤一次），
   所以被打死的 token 会立刻空出名额 —— 不需要额外的死亡回调。 */
class MechAlpha {
  constructor(u, p) {
    this.u = u;
    /* 参数兜底：正式构建里全部来自 CARDS[id=alpha].p */
    this.p = Object.assign({
      first: 1.6, betaIv: 4.0, betaMax: 2, betaHp: 100, betaR: 34, betaSpeed: 120,
      betaGrow: 7.0, omegaMax: 3, omegaHp: 100, omegaR: 30,
      omegaWaveCd: 2.5, omegaFirst: 0.35, omegaWaveDmg: 150, omegaWaveR: 200,
      waveSpd: 320, spawnDist: 96, spawnAvoid: 190
    }, p || {});
    this.betas = [];          // 当前存活/等待转化的贝塔
    this.omegas = [];         // 当前存活的欧米伽
    this.spawnCd = this.p.first;   // 第一颗贝塔的等待时间
  }
  update(dt) {
    const u = this.u, p = this.p;
    if (!u.alive || u.dying) return;
    /* 收获：死亡/已转化的 token 从记账表里剔掉（world.units 里的空壳不动，见 waGrowAway） */
    this.betas = this.betas.filter(b => b.alive && !b.dying && !b.finished);
    this.omegas = this.omegas.filter(o => o.alive && !o.dying && !o.finished);
    /* ① 欧米伽：各自走冲击波节拍（彼此独立，不共享冷却） */
    for (const o of this.omegas) o.updateOmega(dt);
    /* ② 贝塔：走 betaGrow（7 秒）转化计时；omegaMax 已满时【继续等待】，不消失也不消耗 */
    for (const b of this.betas) {
      if (!b.alive || b.dying) continue;
      b.age += dt;
      if (b.age >= p.betaGrow && this.omegas.length < p.omegaMax) this.waGrowOmega(b);
    }
    /* ③ 种新的贝塔：每 betaIv 秒一次；betaMax 满员时这一次跳过（不攒次数） */
    this.spawnCd -= dt;
    if (this.spawnCd <= 0) {
      this.spawnCd = p.betaIv;
      if (u.grabbed > 0) return;                     // 被拎着：不触发机制
      if (this.betas.length < p.betaMax) this.waSpawnBeta();
    }
  }
  /* 贝塔 → 欧米伽：同一个坐标换人，播放“卡牌变化”缩放动画 + 橙色转化环。
     ⚠ 用户 2026-10-23 口径（初始版）：转化后阿尔法的召唤冷却重新读条 betaIv，
        不能因为贝塔空出名额就马上补一只。
     ⚠ 用户 2026-10-23 口径（修订）：这个“重新读条”改为【只在场上还存在另一只贝塔时】
        才触发 —— 两只贝塔接力时把倒计时压回 4 秒；如果这只是场上最后一只贝塔，
        就不重置，让阿尔法按原有倒计时自然补种。
     ⚠ 用户 2026-10-23 口径：欧米伽【继承贝塔当前生命】——贝塔被打掉多少血，
        转化出来的欧米伽就带着多少血（上限仍是 omegaHp），所以先打贝塔再让它开花更划算。 */
  waGrowOmega(b) {
    const p = this.p;
    if (!b.alive || b.dying) return;
    const ms = b.minion ? 0.8 : 1;
    const om = new OmegaUnit(this.u, p, b.x, b.y);
    /* 继承贝塔当前生命：夹在 [1, omegaHp]，避免负血/超上限 */
    om.hp = clamp(b.hp, 1, om.maxHp);
    b.waGrowAway();
    world.units.push(om);
    this.omegas.push(om);
    /* ① 卡牌变化演出：旧贝塔卡面放大淡出 + 白光闪一下（参考反编译卡牌变化） */
    world.effects.push(new WAAlphaMorph(b.x, b.y, CFG.CARD_W * ms, CFG.CARD_H * ms));
    /* ② 欧米伽登场光效：双环 + 火星 + 轻震屏（用户口径：不要头顶文字）。
       欧米伽本体的 0.55→1.0 缩放动画由 OmegaUnit.appearScale() 自己推进。 */
    world.effects.push(new Ring(b.x, b.y, 14, p.omegaR * 2.4, 0.42, 'rgba(255,150,60,.92)', 3.4));
    world.effects.push(new Ring(b.x, b.y, 4, p.omegaR * 1.2, 0.28, 'rgba(255,232,176,.95)', 2.4));
    world.effects.push(new Ring(b.x, b.y, 6, CFG.CARD_W * ms * 0.9, 0.34, 'rgba(255,255,230,.85)', 3));
    burst(b.x, b.y, 22, { c: '#ffb060', s0: 70, s1: 280 });
    sfx('card_deal', 0.7, 0.95);
    world.shake = Math.max(world.shake, 3);
    /* ③ 召唤冷却重新读条：仅当场上【还存在另一只贝塔】时触发（用户 2026-10-23 修订口径）。
       ⚠ 排除正在转化的这只 b：它已经 waGrowAway（alive=false），但仍要显式跳过，
         避免同帧多只成熟时把“自己”算成另一只。 */
    if (this.betas.some(o => o !== b && o.alive && !o.dying && !o.finished)) {
      this.spawnCd = p.betaIv;
    }
  }
  /* 种一颗贝塔：候选点由 waSpawnSpot 打分挑出（离敌人远、离已有 token 不近）。 */
  waSpawnBeta() {
    const p = this.p, u = this.u;
    const spot = this.waSpawnSpot();
    const b = new BetaUnit(u, p, spot.x, spot.y);
    b.bouncePop = 2.2;                       // 出生时卡面弹一下（drawUnits 的通用字段）
    world.units.push(b);
    this.betas.push(b);
    /* 召唤演出（用户 2026-10-23 追加）：法阵收拢 + 卡面虚影凝聚 + 紫金火花。
       虚影尺寸 = 单位本体尺寸（仆从 0.8 倍；贝塔不再额外 sizeMul 缩小）。 */
    const ms = b.minion ? 0.8 : 1;
    world.effects.push(new WAAlphaSummon(spot.x, spot.y, 'card_beta',
                                         CFG.CARD_W * ms, CFG.CARD_H * ms));
    world.effects.push(new Ring(spot.x, spot.y, 6, p.betaR * 2.4, 0.34,
                                'rgba(255,214,150,.85)', 2.8));
    burst(spot.x, spot.y, 10, { c: '#ffe0b0', s0: 40, s1: 170 });
    sfx('card_deal', 0.5, 1.35);
  }
  /* 种贝塔的位置：以本体为圆心、spawnDist 为半径抽 6 个候选点，再按综合得分挑最高分：
       · 离敌人越远越好（权重最高）：p.spawnAvoid 是“理想安全距离”——
         候选点离敌人不足 spawnAvoid 时按差额 2 倍倒扣（别把贝塔种到敌人脸上、
         刚落地就被对面索敌拆掉），超过之后继续 1:1 加分（也没必要缩到最远的角落）；
       · 离已有 token 不要太近：按最近 token 距离加分，到 spawnAvoid×0.6 封顶，
         避免两张卡面叠在一起。
     角度只用 rand（对战流）：站位会实实在在影响对局走向。最后夹进场内（离边 70px）。 */
  waSpawnSpot() {
    const p = this.p, u = this.u;
    const tokens = this.betas.concat(this.omegas);
    const safe = p.spawnAvoid === undefined ? 190 : p.spawnAvoid;
    const e = world.enemyOf(u);              // 最近的敌人（本体/仆从都算）
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 6; i++) {
      const a = rand(0, TAU);                // 对战流
      const x = clamp(u.x + Math.cos(a) * p.spawnDist, 70, CFG.AW - 70);
      const y = clamp(u.y + Math.sin(a) * p.spawnDist, 70, CFG.AH - 70);
      /* ① 离敌人：安全距离内危险重罚（越近越负），超出后越远越好 */
      let enemyScore = 0;
      if (e) {
        const dE = Math.hypot(e.x - x, e.y - y);
        enemyScore = dE >= safe ? (dE - safe) : (dE - safe) * 2.0;
      }
      /* ② 离已有 token：越远越好，到 safe×0.6 封顶（再远也不会更好） */
      let dT = safe;                         // 场上没有 token 时按“够远”处理
      for (const t of tokens) dT = Math.min(dT, Math.hypot(t.x - x, t.y - y));
      const tokenScore = Math.min(dT, safe * 0.6) * 0.5;
      const score = enemyScore + tokenScore;
      if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
    }
    return best || { x: u.x, y: u.y };
  }
  /* 头顶不显示任何文字（用户口径：这两张卡不加 overhead 文字） */
  statusText() { return null; }
}
MECHS.alpha = MechAlpha;
