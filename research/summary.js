global.window={}; eval(require('fs').readFileSync('ScannerData.js','utf8'));
const E=require('../app/src/engine.js'); const D=window.SCANNER_DATA.symbols;
const list=[]; const cover={};
for(const s of Object.keys(D)){ const ctx=E.prepare(D[s],{}); const bt=E.backtestTrend(ctx); list.push({sym:s,trades:bt.trades,lastPrice:ctx.M.c[ctx.M.n-1]}); cover[s]=new Date(ctx.M.t[0]*1000).toISOString().slice(0,10); }
const p=E.portfolio(list,{});
const tr=p.trades; const wins=tr.filter(x=>x.pnl>0), loss=tr.filter(x=>x.pnl<=0);
const gp=wins.reduce((a,x)=>a+x.pnl,0), gl=loss.reduce((a,x)=>a+x.pnl,0);
const gross=tr.reduce((a,x)=>a+x.pnl+x.entryFee+x.exitFee+x.fund,0);
const tradeFees=tr.reduce((a,x)=>a+x.entryFee+x.exitFee,0), fund=tr.reduce((a,x)=>a+x.fund,0);
const first=Math.min(...tr.map(x=>x.entryTime)), last=Math.max(...tr.map(x=>x.exitTime));
const hold=tr.map(x=>(x.exitTime-x.entryTime)/3600); hold.sort((a,b)=>a-b);
const fmt=t=>new Date(t*1000).toISOString().slice(0,10);
console.log('coverage15m',JSON.stringify(cover));
console.log('first entry',fmt(first),'last exit',fmt(last),'days',((last-first)/86400).toFixed(0));
console.log('closed trades',tr.length,'open',p.openPos.length, 'wins',wins.length,'losses',loss.length);
console.log('gross profit wins $',gp.toFixed(2),'gross loss $',gl.toFixed(2),'(net of fees per trade)');
console.log('pnl before fees $',gross.toFixed(2),'trade fees $',tradeFees.toFixed(2),'funding $',fund.toFixed(2),'(+open entry fees)',(p.fees-tradeFees).toFixed(2));
console.log('final cash',p.final.toFixed(2),'unreal',p.unreal.toFixed(2),'equity',(p.final+p.unreal).toFixed(2),'ret%',p.retPct.toFixed(1),'maxDD',p.maxDD.toFixed(1),'maxDD$',p.maxDDusd.toFixed(2),'streak',p.maxStreak);
console.log('hold hours median',hold[hold.length>>1].toFixed(0),'avg',(hold.reduce((a,b)=>a+b)/hold.length).toFixed(0),'max',hold[hold.length-1].toFixed(0));
console.log('biggest win',Math.max(...tr.map(x=>x.pnl)).toFixed(2),'biggest loss',Math.min(...tr.map(x=>x.pnl)).toFixed(2));
console.log('months',Object.entries(p.months).map(([k,v])=>k+':'+v.pnl.toFixed(2)+'('+v.n+')').join(' '));
// by period: ETH/BTC only 2y vs all
