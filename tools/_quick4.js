process.env.GAME_HTML='杀戮尖塔小球对决.html';
const path=require('path'); const WT=require(path.join(__dirname,'watcher_test.js'));
const G=WT.loadGame({seed:20260922}); const T=G.T; WT.applyGate(T,true);
const TOP5=WT.TOP5_EXPECTED;
function measure(id,N=30){
  let w=0,g=0,per={};
  for(const b of TOP5){ let ww=0,gg=0; const half=Math.floor(N/2);
    for(let k=0;k<half*2;k++){const left=k<half;
      const r=WT.runMatch(G,left?id:b,left?b:id,{cap:120,nanCheck:false}); gg++;
      if(r.result!=='D'&&((r.result==='L')===left)) ww++;}
    per[b]=+(ww/gg*100).toFixed(0); w+=ww; g+=gg; }
  return {wr:+(w/g*100).toFixed(1), per};
}
for(const id of ['talk_to_the_hand','alpha','prostrate','wish']) console.log(id, JSON.stringify(measure(id)));
