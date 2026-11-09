global.window={}; eval(require('fs').readFileSync('ScannerData.js','utf8'));
const E=require('../app/src/engine.js'); const D=window.SCANNER_DATA.symbols;
for (const pr of [0,1,1.5,2,3]) {
  const list=[]; let all=[];
  for(const s of Object.keys(D)){ const ctx=E.prepare(D[s],{trPartialR:pr}); const bt=E.backtestTrend(ctx); list.push({sym:s,trades:bt.trades,lastPrice:ctx.M.c[ctx.M.n-1]}); all=all.concat(bt.trades.filter(t=>t.status==='CLOSED')); }
  const p=E.portfolio(list,{});
  const w=all.filter(t=>t.R>0.01).length, sumR=all.reduce((a,t)=>a+t.R,0);
  console.log('partial',pr,'| trades',all.length,'WR(R)',(w/all.length*100).toFixed(0)+'%','sumR',sumR.toFixed(1),'| $',p.final.toFixed(1),'WR$',p.winRate.toFixed(0)+'%','DD',p.maxDD.toFixed(1)+'%','avgWin',p.avgWin.toFixed(2),'avgLoss',p.avgLoss.toFixed(2),'streak',p.maxStreak);
}
