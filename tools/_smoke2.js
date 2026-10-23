process.env.GAME_HTML='杀戮尖塔小球对决.html';
const path=require('path'); const WT=require(path.join(__dirname,'watcher_test.js'));
const G=WT.loadGame({seed:99}); const T=G.T; WT.applyGate(T,true);
let err=null,frames=0,seen={};
try{
  T.resetMatch(T.CARD_BY_ID['wish'], T.CARD_BY_ID['prostrate'], 99);
  T.world.running=true;
  for(let i=0;i<120*40 && !T.world.over;i++){
    T.world.t+=1/120; T.stepPhysics(1/120);
    for(const e of T.world.effects){ const n=e.constructor.name; if(n==='WishSpotlight'||n==='DivinityBeam'||n==='WishWardFx') seen[n]=(seen[n]||0)+1; }
    if(i%10===0){ T.drawArena(); T.drawUnitHUD(); frames++; }
  }
}catch(e){ err=e.message+'\n'+(e.stack||'').split('\n').slice(1,5).join('\n'); }
console.log('err=',err,'frames=',frames,'seen=',JSON.stringify(seen),'t=',T.world.t.toFixed(1));
