global.window = {}; require('./data3/ScannerData.js'); const Scan = require('./scan.js');
const data = window.SCANNER_DATA, SPLIT = Date.UTC(2026, 4, 8) / 1000, COST = 0.22;
function prepAll(P){ const X={}; for (const s in data.symbols) X[s]=Scan.prep(data.symbols[s],P); return X; }
function sim(Xs,c,P){ const M=Xs.M,H=Xs.H,d=c.d,e=c.entry,r=Math.abs(e-c.sl); let stop=c.sl,lastH=c.i,k=c.mt+1,half=false,R=null,stopC=c.sl,RA=null,RC=null;
  for(;k<M.n&&k<=c.mt+30*96;k++){ const hi=M.h[k],lo=M.l[k],hs=s=>d>0?lo<=s:hi>=s;
    const q4=Scan.lastClosed(H.t,14400,M.t[k]); if(q4>lastH){for(let q=lastH+1;q<=q4;q++){const ns=H.c[q]-d*P.K*H.atr[q]; if(d>0?ns>stop:ns<stop)stop=ns; if(half&&(d>0?ns>stopC:ns<stopC))stopC=ns;} lastH=q4;}
    if(R==null&&hs(stop)) R=d*(stop-e)/r;
    if(RA==null){ if(hs(c.sl)) RA=-1; else if(d>0?hi>=c.tp1:lo<=c.tp1) RA=c.rr1; }
    if(RC==null){ if(!half){ if(hs(c.sl)) RC=-1; else if(d>0?hi>=c.tp1:lo<=c.tp1){half=true; stopC=d>0?Math.max(e,stopC):Math.min(e,stopC);} } else if(hs(stopC)) RC=0.5*c.rr1+0.5*d*(stopC-e)/r; }
    if(R!=null&&RA!=null&&RC!=null)break; }
  const kk=Math.min(k,M.n-1), last=d*(M.c[kk]-e)/r, cR=COST/c.riskPct;
  return {T:(R??last)-cR, A:(RA??last)-cR, C:(RC??(half?0.5*c.rr1+0.5*last:last))-cR, k:kk}; }
function run(P, gate, X){ X=X||prepAll(P); const B=X['BTC-USDT'], out=[];
  for(const s in X){ const Xs=X[s],M=Xs.M; let busy=-1;
    for(let mt=300;mt<M.n-1;mt++){ if(mt<=busy)continue;
      const bj=Scan.lastClosed(B.D.t,86400,M.t[mt]+900); const ctx={P,btcTrend:s==='BTC-USDT'?0:Scan.dTrend(B.D,bj)};
      let best=null; for(const d of [1,-1]){ const c=Scan.checklist(s,Xs,d,ctx,{mt}); if(!c||c.status!=='READY')continue; const it={};for(const x of c.items)it[x.key]=x.ok; c.it=it; if(!gate(c))continue; if(!best||c.score>best.score)best=c;}
      if(!best)continue; const r=sim(Xs,best,P); out.push({s,t:best.time,d:best.d,score:best.score,...r}); busy=r.k; } }
  return out; }
const f=(x,n=2)=>isNaN(x)?'-':x.toFixed(n);
function rep(name,a){ const st=b=>{ if(!b.length)return 'n=0'; const m=v=>b.reduce((s,x)=>s+x[v],0)/b.length; return `n=${b.length} wr=${f(b.filter(x=>x.T>0).length/b.length*100,0)}% T=${f(m('T'))} A=${f(m('A'))} C=${f(m('C'))}`;};
  console.log(name.padEnd(34),'TRAIN',st(a.filter(x=>x.t<SPLIT)).padEnd(44),'TEST',st(a.filter(x=>x.t>=SPLIT))); }
module.exports={run,rep,prepAll};
if(require.main===module){
 const base=Object.assign({},Scan.P0);
 const brk=c=>/^شکست/.test(c.locType||''), pb=c=>/^پولبک/.test(c.locType||'');
 const G={
  'baseline (any READY)':c=>true,
  'd':c=>c.it.d,
  'd+btc':c=>c.it.d&&c.it.btc!==false,
  'd+h4':c=>c.it.d&&c.it.h4,
  'd+h4+btc':c=>c.it.d&&c.it.h4&&c.it.btc!==false,
  'd+w+h4+btc':c=>c.it.d&&c.it.w&&c.it.h4&&c.it.btc!==false,
  'breakout only':brk,
  'breakout+d':c=>brk(c)&&c.it.d,
  'breakout+d+btc':c=>brk(c)&&c.it.d&&c.it.btc!==false,
  'pullback+d+h4+btc':c=>pb(c)&&c.it.d&&c.it.h4&&c.it.btc!==false,
  'd+h4+btc+pa':c=>c.it.d&&c.it.h4&&c.it.btc!==false&&c.it.pa,
  'd+h4+btc+vol':c=>c.it.d&&c.it.h4&&c.it.btc!==false&&c.it.vol,
  'd+h4+btc+rsi':c=>c.it.d&&c.it.h4&&c.it.btc!==false&&c.it.rsi,
 };
 for(const ms of [0.6,1.0,1.5]){ const P=Object.assign({},base,{minStop:ms}); const X=prepAll(P); console.log('\n=== minStop',ms,'×ATR4H');
   for(const k in G) rep(k, run(P,G[k],X)); }
}
