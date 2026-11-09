// Strategy research on 4H bars with daily context. Train/test split, portfolio sim with fees.
global.window = {}; eval(require('fs').readFileSync(__dirname + '/ScannerData.js', 'utf8'));
const E = require('../app/src/engine.js');
const DATA = window.SCANNER_DATA.symbols;
const SPLIT = Date.UTC(2026, 4, 8) / 1000;          // 2026-05-08 : test = last 6 months
const SYMS = Object.keys(DATA);

/* ---------- indicators ---------- */
const ema = E.ema;
function sma(a, n) { const o = new Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function atr(h, l, c, n) { const o = new Array(c.length).fill(NaN); let v = NaN; for (let i = 1; i < c.length; i++) { const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); if (i === n) { let s = 0; for (let k = 1; k <= n; k++) s += Math.max(h[k] - l[k], Math.abs(h[k] - c[k - 1]), Math.abs(l[k] - c[k - 1])); v = s / n; } else if (i > n) v = (v * (n - 1) + tr) / n; o[i] = v; } return o; }
function rsi(c, n) { const o = new Array(c.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; const up = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
function ser(rows) { const S = { t: [], o: [], h: [], l: [], c: [] }; for (const r of rows) { S.t.push(r[0]); S.o.push(r[1]); S.h.push(r[2]); S.l.push(r[3]); S.c.push(r[4]); } S.n = S.t.length; return S; }

const P = {};
for (const s of SYMS) {
  const D = ser(DATA[s]['1day']), H = ser(DATA[s]['4hour']);
  D.e20 = ema(D.c, 20); D.e50 = ema(D.c, 50); D.e200 = ema(D.c, 200);
  H.e20 = ema(H.c, 20); H.e50 = ema(H.c, 50); H.atr = atr(H.h, H.l, H.c, 14); H.rsi2 = rsi(H.c, 2); H.sma5 = sma(H.c, 5);
  // daily index (last closed) for each 4h bar close
  H.di = new Array(H.n); let j = -1;
  for (let i = 0; i < H.n; i++) { const T = H.t[i] + 14400; while (j + 1 < D.n && D.t[j + 1] + 86400 <= T) j++; H.di[i] = j; }
  P[s] = { D, H };
}
// BTC regime per time
const BTC = P['BTC-USDT'].D;
function btcState(T) { let lo = 0, hi = BTC.n - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (BTC.t[m] + 86400 <= T) { a = m; lo = m + 1; } else hi = m - 1; } if (a < 50) return 0; return BTC.c[a] > BTC.e50[a] ? 1 : -1; }

/* ---------- generic 4H trade simulator ----------
   sig(i) -> null | {dir, stop, tp?}   evaluated on close of bar i, entry at close i
   manage: trailing ATR k (0 = off), timeExit bars, exitFn(i, pos) custom
*/
function run(sym, cfg) {
  const { D, H } = P[sym];
  const trades = [];
  let pos = null;
  const start = 210;
  for (let i = start; i < H.n; i++) {
    if (pos) {
      const L = pos.dir === 'LONG', d = L ? 1 : -1;
      let exit = null, why = null;
      // gap / stop
      if (L ? H.l[i] <= pos.stop : H.h[i] >= pos.stop) { exit = L ? Math.min(pos.stop, H.o[i]) : Math.max(pos.stop, H.o[i]); why = pos.trailed ? 'TRAIL' : 'SL'; }
      else if (pos.tp && (L ? H.h[i] >= pos.tp : H.l[i] <= pos.tp)) { exit = pos.tp; why = 'TP'; }
      else if (cfg.exitFn && cfg.exitFn(sym, i, pos)) { exit = H.c[i]; why = 'EXIT'; }
      else if (cfg.maxBars && i - pos.i >= cfg.maxBars) { exit = H.c[i]; why = 'TIME'; }
      if (exit !== null) {
        const risk = Math.abs(pos.entry - pos.sl);
        trades.push({ dir: pos.dir, entry: pos.entry, sl: pos.sl, tp1: why === 'TP' ? exit : (pos.tp || exit), exit, why: why === 'TP' ? 'TP' : (why === 'SL' ? 'SL' : 'TIME'),
          R: d * (exit - pos.entry) / risk, entryTime: H.t[pos.i] + 14400, exitTime: H.t[i] + 14400, status: 'CLOSED', partialDone: false, bars: i - pos.i });
        pos = null;
      } else if (cfg.trail) {
        const k = cfg.trail * H.atr[i];
        const ns = L ? H.c[i] - k : H.c[i] + k;
        if (L ? ns > pos.stop : ns < pos.stop) { pos.stop = ns; pos.trailed = true; }
      }
      if (pos) continue;
    }
    const s = cfg.sig(sym, i);
    if (!s) continue;
    if (cfg.btc) { const b = btcState(H.t[i] + 14400); if ((s.dir === 'LONG' && b < 0) || (s.dir === 'SHORT' && b > 0)) continue; }
    if (cfg.side === 'long' && s.dir === 'SHORT') continue;
    const entry = H.c[i];
    if (Math.abs(entry - s.stop) / entry > 0.15 || Math.abs(entry - s.stop) <= 0) continue;
    pos = { dir: s.dir, i, entry, sl: s.stop, stop: s.stop, tp: s.tp || null, trailed: false };
  }
  if (pos) trades.push({ dir: pos.dir, entry: pos.entry, sl: pos.sl, tp1: pos.tp || pos.entry, entryTime: P[sym].H.t[pos.i] + 14400, status: 'OPEN', R: null });
  return trades;
}

/* ---------- strategies ---------- */
const dTrend = (sym, i) => { const { D, H } = P[sym]; const j = H.di[i]; if (j < 50) return 0;
  if (D.c[j] > D.e50[j] && D.e20[j] > D.e50[j]) return 1; if (D.c[j] < D.e50[j] && D.e20[j] < D.e50[j]) return -1; return 0; };

const STRATS = {
  // 1. Donchian breakout + daily trend + ATR trailing stop
  donchian: (N, k, tf = true) => ({
    trail: k,
    sig(sym, i) { const H = P[sym].H; let hh = -Infinity, ll = Infinity;
      for (let x = i - N; x < i; x++) { hh = Math.max(hh, H.h[x]); ll = Math.min(ll, H.l[x]); }
      const tr = tf ? dTrend(sym, i) : 0, a = H.atr[i];
      if (H.c[i] > hh && (!tf || tr > 0)) return { dir: 'LONG', stop: H.c[i] - k * a };
      if (H.c[i] < ll && (!tf || tr < 0)) return { dir: 'SHORT', stop: H.c[i] + k * a };
      return null; } }),
  // 2. Pullback to 4H EMA20 inside daily trend; target R or trailing
  pullback: (R, trail) => ({
    trail, maxBars: 60,
    sig(sym, i) { const H = P[sym].H, tr = dTrend(sym, i), a = H.atr[i];
      if (tr > 0 && H.e20[i] > H.e50[i] && H.l[i] <= H.e20[i] && H.c[i] > H.e20[i] && H.c[i] > H.o[i] && H.c[i - 1] <= H.c[i]) {
        let lo = Infinity; for (let x = i - 5; x <= i; x++) lo = Math.min(lo, H.l[x]); const stop = lo - 0.3 * a;
        return { dir: 'LONG', stop, tp: R ? H.c[i] + R * (H.c[i] - stop) : null }; }
      if (tr < 0 && H.e20[i] < H.e50[i] && H.h[i] >= H.e20[i] && H.c[i] < H.e20[i] && H.c[i] < H.o[i] && H.c[i - 1] >= H.c[i]) {
        let hi = -Infinity; for (let x = i - 5; x <= i; x++) hi = Math.max(hi, H.h[x]); const stop = hi + 0.3 * a;
        return { dir: 'SHORT', stop, tp: R ? H.c[i] - R * (stop - H.c[i]) : null }; }
      return null; } }),
  // 3. RSI(2) mean reversion inside daily trend; exit on close back over SMA5
  rsi2: (lo, k) => ({
    maxBars: 12,
    exitFn(sym, i, pos) { const H = P[sym].H; return pos.dir === 'LONG' ? H.c[i] > H.sma5[i] : H.c[i] < H.sma5[i]; },
    sig(sym, i) { const H = P[sym].H, tr = dTrend(sym, i), a = H.atr[i];
      if (tr > 0 && H.rsi2[i] < lo) return { dir: 'LONG', stop: H.c[i] - k * a };
      if (tr < 0 && H.rsi2[i] > 100 - lo) return { dir: 'SHORT', stop: H.c[i] + k * a };
      return null; } }),
};

/* ---------- evaluation ---------- */
function rStats(tr) { const c = tr.filter(t => t.status === 'CLOSED'); const s = c.reduce((a, t) => a + t.R, 0); const w = c.filter(t => t.R > 0).length;
  const pos = c.filter(t => t.R > 0).reduce((a, t) => a + t.R, 0), neg = -c.filter(t => t.R < 0).reduce((a, t) => a + t.R, 0);
  return { n: c.length, wr: c.length ? w / c.length * 100 : 0, sumR: s, pf: neg ? pos / neg : 99 }; }
function evaluate(name, cfg, opts = {}) {
  const per = {}, list = { train: [], test: [] };
  for (const s of SYMS) {
    const tr = opts.trades ? opts.trades(s) : run(s, cfg);
    if (!tr) continue;
    const trn = tr.filter(t => t.entryTime < SPLIT), tst = tr.filter(t => t.entryTime >= SPLIT);
    per[s] = { train: rStats(trn), test: rStats(tst) };
    list.train.push({ sym: s, trades: trn.filter(t => t.status === 'CLOSED'), lastPrice: 0 });
    list.test.push({ sym: s, trades: tst, lastPrice: P[s].H.c[P[s].H.n - 1] });
  }
  const res = {};
  for (const part of ['train', 'test']) {
    const all = list[part].flatMap(x => x.trades);
    const r = rStats(all);
    const fut = E.portfolio(list[part], { mode: 'futures', takerFee: 0.06, makerFee: 0.02, fundingPct8h: 0.01 });
    const spot = E.portfolio(list[part], { mode: 'spot', takerFee: 0.1, makerFee: 0.1 });
    const symPos = Object.values(per).filter(p => p[part].sumR > 0).length;
    res[part] = { ...r, symPos, nSym: Object.keys(per).length, fut: { ret: fut.retPct, dd: fut.maxDD, n: fut.taken, fees: fut.fees + fut.funding }, spot: { ret: spot.retPct, dd: spot.maxDD, n: spot.taken, fees: spot.fees } };
  }
  return { name, res, per };
}
module.exports = { evaluate, STRATS, run, P, SYMS, SPLIT, rStats };

if (require.main === module) {
  const f = (x, d = 1) => (x >= 0 ? ' ' : '') + x.toFixed(d);
  const line = (r) => {
    const a = r.res.train, b = r.res.test;
    console.log(r.name.padEnd(34), '| TRAIN n', String(a.n).padStart(4), 'WR', f(a.wr, 0), 'R', f(a.sumR).padStart(7), 'PF', a.pf.toFixed(2), 'sym+', a.symPos + '/' + a.nSym,
      'fut%', f(a.fut.ret).padStart(6), 'dd', a.fut.dd.toFixed(1), 'spot%', f(a.spot.ret).padStart(6),
      '|| TEST n', String(b.n).padStart(3), 'R', f(b.sumR).padStart(6), 'PF', b.pf.toFixed(2), 'sym+', b.symPos + '/' + b.nSym, 'fut%', f(b.fut.ret).padStart(6), 'dd', b.fut.dd.toFixed(1), 'spot%', f(b.spot.ret).padStart(6));
  };
  const grid = [];
  for (const N of [20, 40, 60]) for (const k of [2, 3, 4]) for (const btc of [false, true]) grid.push([`donchian N${N} k${k}${btc ? ' +BTC' : ''}`, { ...STRATS.donchian(N, k), btc }]);
  for (const R of [0, 2, 3]) for (const tr of [0, 3]) { if (!R && !tr) continue; for (const btc of [false, true]) grid.push([`pullback R${R} trail${tr}${btc ? ' +BTC' : ''}`, { ...STRATS.pullback(R, tr), btc }]); }
  for (const lo of [5, 10]) for (const k of [2, 3]) for (const btc of [false, true]) grid.push([`rsi2 <${lo} k${k}${btc ? ' +BTC' : ''}`, { ...STRATS.rsi2(lo, k), btc }]);
  for (const [n, c] of grid) line(evaluate(n, c));
  for (const [n, c] of grid.filter(g => g[0].startsWith('donchian N40') || g[0].startsWith('pullback R2 trail0'))) line(evaluate(n + ' LONG', { ...c, side: 'long' }));
}
