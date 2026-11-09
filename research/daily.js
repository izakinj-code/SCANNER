// Low-frequency, big-move strategies on DAILY candles (manual friendly: decide once a day)
const R = require('./research.js'); const E = require('../app/src/engine.js');
const { P, SYMS, SPLIT } = R;
function atr(h, l, c, n) { const o = new Array(c.length).fill(NaN); let v; for (let i = 1; i < c.length; i++) { const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); if (i < n) continue; if (i === n) { let s = 0; for (let k = 1; k <= n; k++) s += Math.max(h[k] - l[k], Math.abs(h[k] - c[k - 1]), Math.abs(l[k] - c[k - 1])); v = s / n; } else v = (v * (n - 1) + tr) / n; o[i] = v; } return o; }
for (const s of SYMS) { const D = P[s].D; D.atr = atr(D.h, D.l, D.c, 14); for (const n of [10, 20, 30, 50, 100]) D['E' + n] = E.ema(D.c, n); }
const BTC = P['BTC-USDT'].D;

// generic daily simulator: entry at daily close, stop checked on next days' high/low
function run(sym, cfg) {
  const D = P[sym].D, trades = []; let pos = null;
  for (let i = cfg.start || 60; i < D.n; i++) {
    const tEnd = D.t[i] + 86400;
    if (pos) {
      const L = pos.dir === 'LONG', d = L ? 1 : -1; let ex = null, why;
      if (L ? D.l[i] <= pos.stop : D.h[i] >= pos.stop) { ex = L ? Math.min(pos.stop, D.o[i]) : Math.max(pos.stop, D.o[i]); why = pos.trailed ? 'TIME' : 'SL'; }
      else if (cfg.exitFn && cfg.exitFn(sym, i, pos)) { ex = D.c[i]; why = 'TIME'; }
      if (ex !== null) { trades.push({ dir: pos.dir, entry: pos.entry, sl: pos.sl, tp1: ex, exit: ex, why, R: d * (ex - pos.entry) / Math.abs(pos.entry - pos.sl), entryTime: pos.t, exitTime: tEnd, status: 'CLOSED', partialDone: false, days: i - pos.i, movePct: d * (ex / pos.entry - 1) * 100 }); pos = null; }
      else {
        if (cfg.trail) { const ns = L ? D.c[i] - cfg.trail * D.atr[i] : D.c[i] + cfg.trail * D.atr[i]; if (L ? ns > pos.stop : ns < pos.stop) { pos.stop = ns; pos.trailed = true; } }
        if (cfg.exitLow) { let x = L ? Infinity : -Infinity; for (let k = i - cfg.exitLow + 1; k <= i; k++) x = L ? Math.min(x, D.l[k]) : Math.max(x, D.h[k]); if (L ? x > pos.stop : x < pos.stop) { pos.stop = x; pos.trailed = true; } }
      }
      if (pos) continue;
    }
    const sg = cfg.sig(sym, i); if (!sg) continue;
    if (cfg.side === 'long' && sg.dir === 'SHORT') continue;
    if (cfg.btc) { const b = BTC.c[i] > BTC.E50[i] ? 1 : -1; if ((sg.dir === 'LONG') !== (b > 0)) continue; }
    const entry = D.c[i]; if (Math.abs(entry - sg.stop) / entry > 0.4) continue;
    pos = { dir: sg.dir, entry, sl: sg.stop, stop: sg.stop, t: tEnd, i, trailed: false };
  }
  if (pos) trades.push({ dir: pos.dir, entry: pos.entry, sl: pos.sl, tp1: pos.entry, entryTime: pos.t, status: 'OPEN', R: null, i: pos.i });
  return trades;
}
const brk = (N, k, opt = {}) => ({ trail: opt.exitLow ? 0 : k, exitLow: opt.exitLow, btc: opt.btc, side: opt.side,
  sig(sym, i) { const D = P[sym].D; let hh = -Infinity, ll = Infinity; for (let x = i - N; x < i; x++) { hh = Math.max(hh, D.h[x]); ll = Math.min(ll, D.l[x]); }
    const up = D.c[i] > D.E50[i], dn = D.c[i] < D.E50[i], a = D.atr[i];
    if (D.c[i] > hh && (!opt.filt || up)) return { dir: 'LONG', stop: D.c[i] - k * a };
    if (D.c[i] < ll && (!opt.filt || dn)) return { dir: 'SHORT', stop: D.c[i] + k * a };
    return null; } });
const cross = (f, s, k) => ({ trail: k, exitFn(sym, i, pos) { const D = P[sym].D; return pos.dir === 'LONG' ? D['E' + f][i] < D['E' + s][i] : D['E' + f][i] > D['E' + s][i]; },
  sig(sym, i) { const D = P[sym].D, F = D['E' + f], S = D['E' + s], a = D.atr[i];
    if (F[i] > S[i] && F[i - 1] <= S[i - 1]) return { dir: 'LONG', stop: D.c[i] - k * a };
    if (F[i] < S[i] && F[i - 1] >= S[i - 1]) return { dir: 'SHORT', stop: D.c[i] + k * a };
    return null; } });

const POPT = { mode: 'futures', takerFee: 0.06, makerFee: 0.02, fundingPct8h: 0.01, riskPct: 1, maxOpen: 9, maxSameDir: 9, leverage: 3 };
function ev(name, cfg) {
  const out = {};
  for (const part of ['train', 'test']) {
    const list = SYMS.map(s => { const tr = run(s, cfg); return { sym: s, trades: part === 'train' ? tr.filter(t => t.entryTime < SPLIT && t.status === 'CLOSED') : tr.filter(t => t.entryTime >= SPLIT), lastPrice: P[s].D.c[P[s].D.n - 1] }; });
    const all = list.flatMap(x => x.trades).filter(t => t.status === 'CLOSED');
    const st = R.rStats(all), p = E.portfolio(list, POPT);
    const months = part === 'train' ? 18 - 2 : 6;
    const days = all.length ? all.reduce((a, t) => a + t.days, 0) / all.length : 0;
    const best = all.length ? Math.max(...all.map(t => t.movePct)) : 0;
    const symPos = list.filter(x => x.trades.filter(t => t.status === 'CLOSED').reduce((a, t) => a + t.R, 0) > 0).length;
    out[part] = { ...st, ret: p.retPct, dd: p.maxDD, perMonth: all.length / months, days, best, symPos, avgWinR: all.filter(t => t.R > 0).reduce((a, t) => a + t.R, 0) / Math.max(1, all.filter(t => t.R > 0).length) };
  }
  const a = out.train, b = out.test, f = (x, d = 1) => (x >= 0 ? ' ' : '') + x.toFixed(d);
  console.log(name.padEnd(30), '| TRAIN n', String(a.n).padStart(3), `(${a.perMonth.toFixed(1)}/mo)`, 'WR', a.wr.toFixed(0), 'PF', a.pf.toFixed(2), 'avgWin', a.avgWinR.toFixed(1) + 'R', 'hold', a.days.toFixed(0) + 'd', 'sym+', a.symPos + '/9', 'ret', f(a.ret) + '%', 'dd', a.dd.toFixed(0),
    '|| TEST n', String(b.n).padStart(3), 'WR', b.wr.toFixed(0), 'PF', b.pf.toFixed(2), 'sym+', b.symPos + '/9', 'ret', f(b.ret) + '%', 'dd', b.dd.toFixed(0));
}
module.exports = { run, brk, cross, ev };
if (require.main === module) {
  console.log('--- Daily Donchian breakout + ATR trailing stop');
  for (const N of [20, 30, 55]) for (const k of [3, 4]) ev(`D-breakout ${N}d trail${k}ATR`, brk(N, k));
  console.log('--- Turtle style: breakout N, exit on M-day opposite extreme');
  for (const [N, M] of [[20, 10], [55, 20], [30, 15]]) ev(`Turtle ${N}/${M}`, brk(N, 2, { exitLow: M }));
  console.log('--- + filters');
  ev('D-breakout 30d trail4 +EMA50', brk(30, 4, { filt: true }));
  ev('D-breakout 30d trail4 +BTC', brk(30, 4, { btc: true }));
  ev('D-breakout 20d trail4 +EMA50', brk(20, 4, { filt: true }));
  ev('D-breakout 55d trail4 +EMA50', brk(55, 4, { filt: true }));
  console.log('--- Daily EMA crossover');
  for (const [f, s] of [[10, 30], [20, 50], [10, 50]]) ev(`EMA cross ${f}/${s} trail4`, cross(f, s, 4));
}
