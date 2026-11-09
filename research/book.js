// Strategies from "151 Trading Strategies" (Kakushadze & Serur, 2018) — same train/test protocol
const R = require('./research.js'); const E = require('../app/src/engine.js');
const { P, SYMS, SPLIT, STRATS, evaluate } = R;
const ema = E.ema;
for (const s of SYMS) { const H = P[s].H; for (const n of [10, 20, 30, 50, 100, 200]) H['E' + n] = ema(H.c, n); }
const dTrend = (sym, i) => { const { D, H } = P[sym]; const j = H.di[i]; if (j < 50) return 0;
  if (D.c[j] > D.e50[j] && D.e20[j] > D.e50[j]) return 1; if (D.c[j] < D.e50[j] && D.e20[j] < D.e50[j]) return -1; return 0; };

// (a) "Two moving averages": enter on fast/slow crossover, exit on opposite crossover; protective stop k*ATR
const twoMA = (f, sl, k, filt) => ({
  exitFn(sym, i, pos) { const H = P[sym].H; return pos.dir === 'LONG' ? H['E' + f][i] < H['E' + sl][i] : H['E' + f][i] > H['E' + sl][i]; },
  sig(sym, i) { const H = P[sym].H, F = H['E' + f], Sl = H['E' + sl], a = H.atr[i], tr = filt ? dTrend(sym, i) : 0;
    if (F[i] > Sl[i] && F[i - 1] <= Sl[i - 1] && (!filt || tr > 0)) return { dir: 'LONG', stop: H.c[i] - k * a };
    if (F[i] < Sl[i] && F[i - 1] >= Sl[i - 1] && (!filt || tr < 0)) return { dir: 'SHORT', stop: H.c[i] + k * a };
    return null; } });
// (b) "Three moving averages": all three aligned; exit when alignment breaks
const threeMA = (a1, a2, a3, k) => ({
  exitFn(sym, i, pos) { const H = P[sym].H, x = H['E' + a1][i], y = H['E' + a2][i];
    return pos.dir === 'LONG' ? x < y : x > y; },
  sig(sym, i) { const H = P[sym].H, A = H['E' + a1], B = H['E' + a2], C = H['E' + a3], at = H.atr[i];
    const up = A[i] > B[i] && B[i] > C[i], upP = A[i - 1] > B[i - 1] && B[i - 1] > C[i - 1];
    const dn = A[i] < B[i] && B[i] < C[i], dnP = A[i - 1] < B[i - 1] && B[i - 1] < C[i - 1];
    if (up && !upP) return { dir: 'LONG', stop: H.c[i] - k * at };
    if (dn && !dnP) return { dir: 'SHORT', stop: H.c[i] + k * at };
    return null; } });
// (c) Price momentum (time-series): 4H close vs close L bars ago, with daily trend
const tsMom = (L, k) => ({ trail: k,
  sig(sym, i) { const H = P[sym].H, r = H.c[i] / H.c[i - L] - 1, rp = H.c[i - 1] / H.c[i - 1 - L] - 1, tr = dTrend(sym, i), a = H.atr[i];
    const th = 2 * a / H.c[i] * Math.sqrt(L / 6);
    if (tr > 0 && r > th && rp <= th) return { dir: 'LONG', stop: H.c[i] - k * a };
    if (tr < 0 && r < -th && rp >= -th) return { dir: 'SHORT', stop: H.c[i] + k * a };
    return null; } });

const f = (x, d = 1) => (x >= 0 ? ' ' : '') + x.toFixed(d);
function line(r) { const a = r.res.train, b = r.res.test;
  console.log(r.name.padEnd(32), '| TRAIN n', String(a.n).padStart(4), 'R', f(a.sumR).padStart(6), 'PF', a.pf.toFixed(2), 'sym+', a.symPos + '/9', 'fut%', f(a.fut.ret).padStart(6), 'dd', a.fut.dd.toFixed(0),
    '|| TEST n', String(b.n).padStart(3), 'R', f(b.sumR).padStart(6), 'PF', b.pf.toFixed(2), 'sym+', b.symPos + '/9', 'fut%', f(b.fut.ret).padStart(6), 'dd', b.fut.dd.toFixed(0)); }
const POPT = { mode: 'futures', takerFee: 0.06, makerFee: 0.02, fundingPct8h: 0.01, riskPct: 0.75, maxOpen: 6, maxSameDir: 6 };
// patch evaluate's portfolio options by re-running with POPT
function ev(name, cfg) {
  const r = evaluate(name, cfg);
  for (const part of ['train', 'test']) {
    const list = SYMS.map(s => { const tr = R.run(s, cfg); return { sym: s, trades: part === 'train' ? tr.filter(t => t.entryTime < SPLIT && t.status === 'CLOSED') : tr.filter(t => t.entryTime >= SPLIT), lastPrice: P[s].H.c[P[s].H.n - 1] }; });
    const p = E.portfolio(list, POPT); r.res[part].fut = { ret: p.retPct, dd: p.maxDD };
  }
  line(r);
}
console.log('--- reference (current strategy family, 4H entry)');
ev('Donchian N40 k3 (channel)', STRATS.donchian(40, 3));
console.log('--- Two moving averages (4H EMA crossover)');
for (const [a, b] of [[10, 30], [20, 50], [50, 200]]) for (const filt of [false, true]) ev(`2MA ${a}/${b} k3${filt ? ' +daily' : ''}`, twoMA(a, b, 3, filt));
console.log('--- Three moving averages');
for (const [a, b, c] of [[10, 20, 50], [20, 50, 100], [20, 50, 200]]) ev(`3MA ${a}/${b}/${c} k3`, threeMA(a, b, c, 3));
console.log('--- Time-series price momentum (+daily trend, trailing 3ATR)');
for (const L of [18, 42, 84]) ev(`TS-momentum ${L} bars`, tsMom(L, 3));

// (d) Cross-sectional momentum (book §3.1 adapted to 9 coins): weekly rebalance, long top-k / short bottom-k by L-day return
console.log('--- Cross-sectional momentum (daily, weekly rebalance, futures, 0.06% fee per side + 0.01%/8h funding)');
function xsmom(L, k, skip = 1) {
  const D0 = P['BTC-USDT'].D, n = D0.n;
  const res = { train: { eq: 1, peak: 1, dd: 0, w: 0, n: 0 }, test: { eq: 1, peak: 1, dd: 0, w: 0, n: 0 } };
  let prevLong = [], prevShort = [];
  for (let i = L + skip + 1; i + 7 < n; i += 7) {
    const sc = SYMS.map(s => { const D = P[s].D; return { s, r: D.c[i - skip] / D.c[i - skip - L] - 1 }; }).sort((a, b) => b.r - a.r);
    const longs = sc.slice(0, k).map(x => x.s), shorts = sc.slice(-k).map(x => x.s);
    let ret = 0;
    for (const s of longs) { const D = P[s].D; ret += (D.c[i + 7] / D.c[i] - 1) / (2 * k); }
    for (const s of shorts) { const D = P[s].D; ret -= (D.c[i + 7] / D.c[i] - 1) / (2 * k); }
    const turnover = (longs.filter(s => !prevLong.includes(s)).length + shorts.filter(s => !prevShort.includes(s)).length) / k;   // 0..2
    ret -= turnover * 0.5 * 2 * 0.0006 + 0.0001 * 21;                                                             // fees + 1 week funding
    prevLong = longs; prevShort = shorts;
    const part = D0.t[i] < SPLIT ? 'train' : 'test', x = res[part];
    x.eq *= 1 + ret * 0.5;                     // 50% of capital deployed (≈ risk control)
    x.peak = Math.max(x.peak, x.eq); x.dd = Math.max(x.dd, (x.peak - x.eq) / x.peak * 100); x.n++; if (ret > 0) x.w++;
  }
  console.log(`XS-mom L${L} top/bottom ${k}`.padEnd(32), '| TRAIN weeks', res.train.n, 'ret', f((res.train.eq - 1) * 100) + '%', 'dd', res.train.dd.toFixed(0) + '%', 'win', (res.train.w / res.train.n * 100).toFixed(0) + '%',
    '|| TEST weeks', res.test.n, 'ret', f((res.test.eq - 1) * 100) + '%', 'dd', res.test.dd.toFixed(0) + '%');
}
for (const L of [7, 14, 28]) for (const k of [2, 3]) xsmom(L, k);
