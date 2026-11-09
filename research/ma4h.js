const R = require('./research.js'); const E = require('../app/src/engine.js');
const { P, SYMS, SPLIT } = R;
for (const s of SYMS) { const H = P[s].H; H.E50 = E.ema(H.c, 50); H.E200 = E.ema(H.c, 200); }
const dT = (s, i) => { const { D, H } = P[s]; const j = H.di[i]; if (j < 50) return 0; if (D.c[j] > D.e50[j] && D.e20[j] > D.e50[j]) return 1; if (D.c[j] < D.e50[j] && D.e20[j] < D.e50[j]) return -1; return 0; };
const cfgF = (k, filt) => ({
  exitFn(s, i, pos) { const H = P[s].H; return pos.dir === 'LONG' ? H.E50[i] < H.E200[i] : H.E50[i] > H.E200[i]; },
  sig(s, i) { const H = P[s].H, a = H.atr[i], tr = dT(s, i);
    if (H.E50[i] > H.E200[i] && H.E50[i - 1] <= H.E200[i - 1] && (!filt || tr > 0)) return { dir: 'LONG', stop: H.c[i] - k * a };
    if (H.E50[i] < H.E200[i] && H.E50[i - 1] >= H.E200[i - 1] && (!filt || tr < 0)) return { dir: 'SHORT', stop: H.c[i] + k * a };
    return null; } });
const POPT = { mode: 'futures', takerFee: 0.06, makerFee: 0.02, fundingPct8h: 0.01, riskPct: 1, maxOpen: 9, maxSameDir: 9 };
for (const [nm, cfg] of [['4H EMA50/200 k3', cfgF(3, false)], ['4H EMA50/200 k3 +daily', cfgF(3, true)], ['4H EMA50/200 k5', cfgF(5, false)], ['4H EMA50/200 k5 +daily', cfgF(5, true)]]) {
  for (const part of ['train', 'test', 'all']) {
    const list = SYMS.map(s => { const tr = R.run(s, cfg); const f = part === 'train' ? tr.filter(t => t.entryTime < SPLIT && t.status === 'CLOSED') : part === 'test' ? tr.filter(t => t.entryTime >= SPLIT) : tr; return { sym: s, trades: f, lastPrice: P[s].H.c[P[s].H.n - 1] }; });
    const all = list.flatMap(x => x.trades).filter(t => t.status === 'CLOSED');
    const st = R.rStats(all), p = E.portfolio(list, POPT);
    const w = all.filter(t => t.R > 0), hold = all.reduce((a, t) => a + t.bars, 0) / all.length / 6;
    const mv = all.map(t => (t.dir === 'LONG' ? 1 : -1) * (t.exit / t.entry - 1) * 100);
    console.log(nm.padEnd(24), part.padEnd(5), 'n', all.length, 'WR', st.wr.toFixed(0), 'PF', st.pf.toFixed(2), 'avgWinR', (w.reduce((a, t) => a + t.R, 0) / w.length).toFixed(2), 'maxR', Math.max(...all.map(t => t.R)).toFixed(1), 'avgWin%', (mv.filter(x => x > 0).reduce((a, b) => a + b, 0) / mv.filter(x => x > 0).length).toFixed(1), 'avgLoss%', (mv.filter(x => x <= 0).reduce((a, b) => a + b, 0) / Math.max(1, mv.filter(x => x <= 0).length)).toFixed(1), 'hold', hold.toFixed(1) + 'd',
      '| $100->', p.final.toFixed(1), 'DD', p.maxDD.toFixed(1), 'fees', (p.fees + p.funding).toFixed(1), 'streak', p.maxStreak);
  }
}
// concentration check for +daily k3
{ const cfg = cfgF(3, true); const list = SYMS.map(s => ({ sym: s, trades: R.run(s, cfg), lastPrice: P[s].H.c[P[s].H.n - 1] }));
  const p = E.portfolio(list, POPT); const tr = p.trades.slice().sort((a, b) => b.pnl - a.pnl);
  console.log('TOP5', tr.slice(0, 5).map(x => x.sym + ' ' + x.t.dir + ' ' + new Date(x.entryTime * 1000).toISOString().slice(0, 10) + ' $' + x.pnl.toFixed(1)).join(' | '));
  console.log('total pnl', tr.reduce((a, x) => a + x.pnl, 0).toFixed(1), 'without top3', tr.slice(3).reduce((a, x) => a + x.pnl, 0).toFixed(1), 'trades', tr.length, 'open', p.openPos.length);
  const by = {}; for (const x of p.trades) { const y = new Date(x.entryTime * 1000).toISOString().slice(0, 7); by[y] = (by[y] || 0) + 1; } console.log('entries/month', JSON.stringify(by)); }
