// Look-ahead test: run the strategy on data CUT at time T and compare with the full-data run.
// If no future candle is used, every trade entered before T must be identical in both runs.
global.window={}; eval(require('fs').readFileSync('ScannerData.js','utf8'));
const E=require('../app/src/engine.js'); const D=window.SCANNER_DATA.symbols;
let checks=0, mism=0;
for(const s of ['ETH-USDT','BTC-USDT','SOL-USDT','XRP-USDT']){
  const full=E.backtestTrend(E.prepare(D[s],{})).trades;
  for(const cut of ['2025-06-01','2025-10-15','2026-03-01','2026-07-20','2026-09-10','2026-10-20']){
    const T=Date.parse(cut)/1000;
    const sd={}; for(const tf in D[s]) sd[tf]=D[s][tf].filter(r=>r[0]+({'1day':86400,'4hour':14400,'15min':900}[tf])<=T);
    if(sd['15min'].length<100||sd['1day'].length<60) continue;
    const part=E.backtestTrend(E.prepare(sd,{})).trades;
    const a=full.filter(t=>t.entryTime<=T).map(t=>[t.dir,t.entryTime,t.entry.toFixed(6),t.sl.toFixed(6)].join('|'));
    const b=part.filter(t=>t.entryTime<=T).map(t=>[t.dir,t.entryTime,t.entry.toFixed(6),t.sl.toFixed(6)].join('|'));
    // exits before T must match too
    const ax=full.filter(t=>t.status==='CLOSED'&&t.exitTime<=T).map(t=>t.exitTime+'|'+t.exit.toFixed(6));
    const bx=part.filter(t=>t.status==='CLOSED'&&t.exitTime<=T).map(t=>t.exitTime+'|'+t.exit.toFixed(6));
    const ok=JSON.stringify(a)===JSON.stringify(b)&&JSON.stringify(ax)===JSON.stringify(bx);
    checks++; if(!ok) mism++;
    console.log(s,cut,'entries',a.length,'/',b.length,'exits',ax.length,'/',bx.length, ok?'IDENTICAL':'MISMATCH');
  }
}
console.log('checks',checks,'mismatches',mism);
