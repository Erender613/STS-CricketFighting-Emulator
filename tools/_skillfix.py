# -*- coding: utf-8 -*-
"""整理 headless-webgl-check 技能：修重号 + 追加本轮新坑。用完可删。"""
import io
import re

P = r"C:\Users\shenl\.workbuddy\skills\headless-webgl-check\SKILL.md"
t = io.open(P, "r", encoding="utf-8").read()
orig = t

# 修重号（每个前缀的后半截关键词唯一，随便顺序都不会串）
ren = [
    ("### 坑 4：别靠肉眼", "### 坑 6：别靠肉眼"),
    ("### 坑 5：`--window-size`", "### 坑 7：`--window-size`"),
    ("### 坑 6：`<canvas", "### 坑 8：`<canvas"),
    ("### 坑 7：手机上的", "### 坑 9：手机上的"),
    ("### 坑 8：调试浮层", "### 坑 10：调试浮层"),
    ("### 坑 9：探针画布必须写死尺寸", "### 坑 11：探针画布必须写死尺寸"),
    ("### 坑 10：截图", "### 坑 12：截图"),
    ("### 坑 11：图形 bug", "### 坑 13：图形 bug"),
]
done = []
for a, b in ren:
    if a in t:
        t = t.replace(a, b, 1)
        done.append(a.split("：")[0] + "->" + b.split("：")[0])
    else:
        done.append("MISS " + a)

NEW = """
### 坑 14：探针脚本里「共用 helper」不能定义在某个 `#mode` 分支里

多场景探针（`if (mode==='hand') {...} else if (mode==='zoom') {...}`）很容易把 helper 顺手写在第一个分支里。
**症状**：hand 场景好好的，zoom 场景整页抛异常 —— 而且因为异常发生在 `build()` 里，连末尾那个写状态的 `#err` div 都没创建，
dump 出来只有一行 `ERRBOX: (未找到 #err)`，看着像"探针没跑"，其实是**分支间作用域问题**。

原因：块内的函数声明（`function tickParticles(){}` 写在 `if` 块里）在非严格模式下虽然会被提升到外层函数作用域，
但**只有执行到那条声明时才完成初始化** —— 另一个分支跑的时候它是 `undefined`。

**做法**：所有模式共用的 helper 一律放在 IIFE 顶层（和 `ready()` / `clearWorld()` 并列），只有真正属于该场景的代码才留在分支里。

### 坑 15：探针里要区分「谁负责 update」

页面里常有两类对象：
- **引擎统一 update 的**（没标 `manual` 的 Effect）→ 引擎的 `stepPhysics` 会更新它们；
- **自己手动 update 的**（标了 `manual`，由某个机制类持有时）→ 引擎不管，探针里得自己调。

探针里如果不敢直接调 `stepPhysics(dt)`（怕把单位、机制一起推进、把摆好的场景搅乱），就**只推进需要的那些**：

```js
function tickParticles(dt) {                     // 只动"世界坐标粒子"这类非 manual 对象
  for (var i = 0; i < world.effects.length; i++) {
    var e = world.effects[i];
    if (!e.dead && !e.manual) e.update(dt);
  }
  world.effects = world.effects.filter(function (e) { return !e.dead; });
}
```

**还有一个陷阱**：只在"世界停下"的那一刻撒粒子，粒子会全挤在一个点上（看不出是粒子，像一坨光斑/糊了一层皮）。
要让探针重现真实观感，得让**带发射器的对象真的动起来**：
```js
for (var s = 1; s <= 90; s++) {          // 90 帧 ≈ 1.5s 走完全程，速度才和真实同量级
  obj.len = target * s / 90;             // 对象沿途移动
  obj.emitDust(1 / 60);                  // 每帧发射
  tickParticles(1 / 60);                 // 已有粒子同步老化
}
```
只测一帧是测不出"轨迹/尾迹"这类效果的 —— 而这正是用户最容易挑出来的地方。

### 坑 16：证明「粒子不跟随主体」的最省事做法：同一团粒子画两遍

用户说"粒子应该是不跟随的"，代码改完怎么让他一眼确认？**别只截一张动图/静帧**：
在同一张探针画布上，把**同一团世界坐标粒子**分别叠在"主体伸出"和"主体缩回"两个位置各画一遍 —— 粒子一颗不动、主体明显位移，
对比图本身就是证据。实现上就是两次 `translate` + 同一个 `obj.draw(ctx)`，粒子那层用 `world.effects.forEach(m => m.draw(ctx))` 复用。
"""

t = t.rstrip("\n") + "\n" + NEW
io.open(P, "w", encoding="utf-8", newline="\n").write(t)
print("renamed:", "; ".join(done), "| bytes", len(orig), "->", len(t))
