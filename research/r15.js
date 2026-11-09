// Does a 15m entry refinement improve the 4H Donchian breakout? futures, long+short
const R = require('./research.js'); const E = require('../app/src/engine.js');
global.window = global.window || {};
const DATA = window.SCANNER_DATA.symbols;
const M = {};
for (const s of R.SYMS) {
  const rows = DATA[s]['15min']; const S = { t: [], o: [], h: [], l: [], c: [] };
  for (const r of rows) { S.t.push(r[0]); S.o.push(r[1]); S.h.push(r[2]); S.l.push(r[3]); S.c.push(r[4]); }
  S.n = S.t.length; S.e20 = E.ema(S.c, 20); M[s] = S;
}
const idx15 = (S, ts) => { let lo = 0, hi = S.n - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (S.t[m] >= ts) { a = m; hi = m - 1; } else lo = m + 1; } return a; };

// variant: mode 'base' (enter at 4H close) | 'pull' (wait 15m pullback to breakout level then 15m close back over EMA20)
function run(sym, { N = 40, k = 3, mode = 'base', win = 24, stopMode = 'atr', from = 0 }) {
  const { D, H } = R.P[sym], S = M[sym];
  const trades = []; let pos = null, pend = null;
  for (let i = 210; i < H.n; i++) {
    const barEnd = H.t[i] + 14400;
    // pending 15m entry inside this 4H bar
    if (!pos && pend) {
      const a = idx15(S, H.t[i]);
      for (let m = Math.max(a, 1); m >= 0 && m < S.n && S.t[m] < barEnd; m++) {
        if (S.t[m] + 900 > pend.expire) { pend = null; break; }
        const L = pend.dir === 'LONG';
        if (!pend.touched) pend.touched = L ? S.l[m] <= pend.level + 0.25 * pend.atr : S.h[m] >= pend.level - 0.25 * pend.atr;
        if (L ? S.l[m] < pend.level - 1.5 * pend.atr : S.h[m] > pend.level + 1.5 * pend.atr) { pend = null; break; } // breakout failed
        if (pend.touched && (L ? S.c[m] > S.e20[m] && S.c[m] > S.o[m] : S.c[m] < S.e20[m] && S.c[m] < S.o[m])) {
          const entry = S.c[m];
          let lo = Infinity, hi = -Infinity; for (let x = Math.max(0, m - 8); x <= m; x++) { lo = Math.min(lo, S.l[x]); hi = Math.max(hi, S.h[x]); }
          const stop = stopMode === 'atr' ? (L ? entry - k * pend.atr : entry + k * pend.atr)
                                          : (L ? Math.min(lo, pend.level) - 1.0 * pend.atr : Math.max(hi, pend.level) + 1.0 * pend.atr);
          pos = { dir: pend.dir, entry, sl: stop, stop, entryTime: S.t[m] + 900, i, trailed: false, m };
          pend = null;
          // manage rest of this 4H bar on 15m after entry
          for (let mm = m + 1; mm < S.n && S.t[mm] < barEnd; mm++) {
            if (L ? S.l[mm] <= pos.stop : S.h[mm] >= pos.stop) { trades.push(close(pos, pos.stop, S.t[mm] + 900, 'SL')); pos = null; break; }
          }
          break;
        }
      }
      if (pos) { // trail at 4H close
        const kk = k * H.atr[i], L = pos.dir === 'LONG', ns = L ? H.c[i] - kk : H.c[i] + kk;
        if (L ? ns > pos.stop : ns < pos.stop) { pos.stop = ns; pos.trailed = true; }
        continue;
      }
    }
    if (pos) {
      const L = pos.dir === 'LONG';
      if (L ? H.l[i] <= pos.stop : H.h[i] >= pos.stop) {
        const ex = L ? Math.min(pos.stop, H.o[i]) : Math.max(pos.stop, H.o[i]);
        trades.push(close(pos, ex, barEnd, pos.trailed ? 'TIME' : 'SL')); pos = null;
      } else {
        const kk = k * H.atr[i], ns = L ? H.c[i] - kk : H.c[i] + kk;
        if (L ? ns > pos.stop : ns < pos.stop) { pos.stop = ns; pos.trailed = true; }
      }
      if (pos) continue;
    }
    // 4H signal
    let hh = -Infinity, ll = Infinity; for (let x = i - N; x < i; x++) { hh = Math.max(hh, H.h[x]); ll = Math.min(ll, H.l[x]); }
    const j = H.di[i]; if (j < 50) continue;
    const up = D.c[j] > D.e50[j] && D.e20[j] > D.e50[j], dn = D.c[j] < D.e50[j] && D.e20[j] < D.e50[j];
    let dir = null, level = null;
    if (H.c[i] > hh && up) { dir = 'LONG'; level = hh; } else if (H.c[i] < ll && dn) { dir = 'SHORT'; level = ll; }
    if (!dir || barEnd < from) continue;
    const a4 = H.atr[i];
    if (mode === 'base' || S.n === 0 || S.t[0] > barEnd) {
      if (mode !== 'base') continue;                    // no 15m data -> skip in 15m mode
      const entry = H.c[i], stop = dir === 'LONG' ? entry - k * a4 : entry + k * a4;
      pos = { dir, entry, sl: stop, stop, entryTime: barEnd, i, trailed: false };
    } else pend = { dir, level, atr: a4, expire: barEnd + win * 900, touched: false };
  }
  return trades;
}
function close(p, ex, t, why) { const d = p.dir === 'LONG' ? 1 : -1;
  return { dir: p.dir, entry: p.entry, sl: p.sl, tp1: ex, exit: ex, why, R: d * (ex - p.entry) / Math.abs(p.entry - p.sl), entryTime: p.entryTime, exitTime: t, status: 'CLOSED', partialDone: false }; }

function report(name, opt, syms, from, to) {
  const list = []; let all = [];
  for (const s of syms) { const tr = run(s, { ...opt, from }).filter(t => t.entryTime >= from && t.entryTime < to); all = all.concat(tr); list.push({ sym: s, trades: tr, lastPrice: 0 }); }
  const st = R.rStats(all);
  const p = E.portfolio(list, { mode: 'futures', takerFee: 0.06, makerFee: 0.02, fundingPct8h: 0.01, riskPct: 0.75, maxOpen: 6, maxSameDir: 6 });
  console.log(name.padEnd(30), 'n', String(st.n).padStart(4), 'WR', st.wr.toFixed(0), 'sumR', st.sumR.toFixed(1).padStart(6), 'PF', st.pf.toFixed(2),
    'avgR', (st.sumR / st.n).toFixed(2), '| $100 ->', p.final.toFixed(1), 'DD', p.maxDD.toFixed(1) + '%', 'fees', (p.fees + p.funding).toFixed(1));
}
const V = [['4H entry (base)', { mode: 'base' }], ['15m pullback, stop 3ATR', { mode: 'pull', stopMode: 'atr' }], ['15m pullback, tight stop', { mode: 'pull', stopMode: 'tight' }],
  ['15m pullback win48, tight', { mode: 'pull', stopMode: 'tight', win: 48 }]];
console.log('=== ETH + BTC, TRAIN (18m, 15m data complete)');
for (const [n, o] of V) report(n, o, ['ETH-USDT', 'BTC-USDT'], 0, R.SPLIT);
console.log('=== ETH + BTC, TEST (6m)');
for (const [n, o] of V) report(n, o, ['ETH-USDT', 'BTC-USDT'], R.SPLIT, 1e12);
console.log('=== ALL 9 coins, TEST (6m, 15m data available)');
for (const [n, o] of V) report(n, o, R.SYMS, Date.UTC(2026, 4, 13) / 1000, 1e12);
