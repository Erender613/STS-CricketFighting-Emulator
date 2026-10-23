process.env.GAME_HTML='src/game.html';
const path=require('path'); const WT=require(path.join(__dirname,'watcher_test.js'));
const G=WT.loadGame({seed:20260922}); const T=G.T; WT.applyGate(T,true);
const TOP5=WT.TOP5_EXPECTED;
function measure(id, over, N=30){
  const c=T.CARD_BY_ID[id]; const old={...c.p}; Object.assign(c.p, over);
  let w=0,g=0,per={};
  for(const b of TOP5){ let ww=0,gg=0; const half=Math.floor(N/2);
    for(let k=0;k<half*2;k++){const left=k<half;
      const r=WT.runMatch(G,left?id:b,left?b:id,{cap:120,nanCheck:false}); gg++;
      if(r.result!=='D'&&((r.result==='L')===left)) ww++;}
    per[b]=+(ww/gg*100).toFixed(0); w+=ww; g+=gg; }
  Object.assign(c.p, old);
  return {wr:+(w/g*100).toFixed(1), per};
}
for(const v of [{slapCd:9},{slapCd:8},{slapCd:7.5}]) console.log('ttth',JSON.stringify(v), JSON.stringify(measure('talk_to_the_hand',v)));
for(const v of [{omegaWaveR:180},{omegaWaveR:175},{omegaWaveR:185,betaSpeed:130}]) console.log('alpha',JSON.stringify(v), JSON.stringify(measure('alpha',v)));
