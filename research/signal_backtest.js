global.window = {}; require(process.argv[2]||'./data3/ScannerData.js'); const Scan = require(process.argv[3]||'./scan.js');
const SPLIT = Date.UTC(2026, 4, 8) / 1000, f=(x,n=2)=>x==null||isNaN(x)?'-':x.toFixed(n);
console.time('bt'); const bt = Scan.signalBacktest(window.SCANNER_DATA); console.timeEnd('bt');
const S=bt.sigs; const row=(n,a)=>{const t=Scan.sigStats(a,'T'),A=Scan.sigStats(a,'A'),C=Scan.sigStats(a,'C'); console.log(n.padEnd(22),`n=${t.n}`.padEnd(7),`win=${f(t.wr,0)}%`,`avgR(trail)=${f(t.avgR)}`,`PF=${f(t.pf)}`,`| A=${f(A.avgR)} C=${f(C.avgR)}`,`avgW=${f(t.avgWin)} avgL=${f(t.avgLoss)}`);};
row('ALL',S); row('train',S.filter(x=>x.t<SPLIT)); row('test',S.filter(x=>x.t>=SPLIT)); row('LONG',S.filter(x=>x.d>0)); row('SHORT',S.filter(x=>x.d<0));
console.log('-- by score'); for(const v of [...new Set(S.map(x=>x.score))].sort((a,b)=>a-b)) row('score '+v,S.filter(x=>x.score===v));
console.log('-- by item'); for(const k of ['w','wc','vol','rsi','pa','room','btc']){row(k+' ✓',S.filter(x=>x.it[k]===true));row(k+' ✗',S.filter(x=>x.it[k]===false));}
console.log('-- by coin'); for(const c of bt.coins) row(c,S.filter(x=>x.sym===c));
for (const [nm,a] of [['ALL',S],['test',S.filter(x=>x.t>=SPLIT)]]) for (const mo of [2,4,6]) { const p=Scan.sigPortfolio(a,{maxOpen:mo,riskPct:1}); console.log(nm,'maxOpen',mo,'$100 ->',f(p.end),'ret',f(p.retPct,1)+'%','maxDD',f(p.maxDD,1)+'%','taken',p.taken,'skipped',p.skipped); }
console.log('weeks', f((bt.to-bt.from)/604800,0), 'signals/week', f(S.length/((bt.to-bt.from)/604800),1));
