process.env.GAME_HTML='杀戮尖塔小球对决.html';
const path=require('path'); const WT=require(path.join(__dirname,'watcher_test.js'));
const G=WT.loadGame({seed:555}); const T=G.T; WT.applyGate(T,true);
let spawned=0, summonCls=0, frames=0, err=null;
try{
  T.resetMatch(T.CARD_BY_ID['alpha'], T.CARD_BY_ID['dark_embrace'], 555);
  T.world.running=true;
  const dt=1/120;
  for(let i=0;i<120*30 && !T.world.over;i++){
    T.world.t+=dt; T.stepPhysics(dt);
    for(const e of T.world.effects){ if(e.constructor.name==='WAAlphaSummon') summonCls++; }
    if(i%20===0){ T.drawArena(); T.drawUnitHUD(); frames++; }
  }
}catch(e){ err=e.message+'\n'+(e.stack||'').split('\n').slice(1,4).join('\n'); }
console.log('err=',err,'frames=',frames,'summonFrames=',summonCls,'t=',T.world.t.toFixed(1));
// 逐帧检查 WAAlphaSummon 的 draw 是否真的被调用
