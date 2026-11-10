const {run,rep,prepAll}=require('./explore.js'); const Scan=require('./scan.js');
const pb=c=>/^پولبک/.test(c.locType||''), brk=c=>/^شکست/.test(c.locType||'');
const G={
 'd':c=>c.it.d,
 'd + 4H NOT aligned (true pullback)':c=>c.it.d&&!c.it.h4,
 'd + 4H aligned':c=>c.it.d&&c.it.h4,
 'd + pa':c=>c.it.d&&c.it.pa,
 'd + wc':c=>c.it.d&&c.it.wc,
 'd + pullback':c=>c.it.d&&pb(c),
 'd + room✗(level near)':c=>c.it.d&&c.it.room===false,
 'd + w':c=>c.it.d&&c.it.w,
 'd + w✗':c=>c.it.d&&c.it.w===false,
 'd LONG':c=>c.it.d&&c.d>0,
 'd SHORT':c=>c.it.d&&c.d<0,
};
for(const ms of [1.5,2.0]){ const P=Object.assign({},Scan.P0,{minStop:ms}); const X=prepAll(P); console.log('\n=== minStop',ms);
 for(const k in G) rep(k, run(P,G[k],X)); }
