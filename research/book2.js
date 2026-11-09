// "151 Trading Strategies" — market-neutral / mean-reversion / ML families, daily + 4H, same train/test split
const R = require('./research.js'); const E = require('../app/src/engine.js');
const { P, SYMS, SPLIT } = R;
const FEE = 0.0006, FUND8H = 0.0001;              // futures taker per side, funding per 8h (paid, conservative)
const f = (x, d = 1) => (x >= 0 ? ' ' : '') + x.toFixed(d);

// aligned daily close matrix
const D0 = P['BTC-USDT'].D, T = D0.t;
const C = {}; for (const s of SYMS) { const D = P[s].D, m = new Map(D.t.map((t, i) => [t, D.c[i]])); C[s] = T.map(t => m.get(t)); }
const ret = (s, i, L = 1) => C[s][i] / C[s][i - L] - 1;

// portfolio-level book-keeping for weight-based strategies (gross exposure = 1 → 100% of equity, no leverage)
function runWeights(name, weightsFn, hold = 1, start = 40) {
  const res = { train: { eq: 1, pk: 1, dd: 0, n: 0, w: 0, fee: 0 }, test: { eq: 1, pk: 1, dd: 0, n: 0, w: 0, fee: 0 } };
  let prev = {};
  for (let i = start; i + hold < T.length; i += hold) {
    const w = weightsFn(i); if (!w) continue;
    let r = 0, turn = 0;
    for (const s of SYMS) { const wi = w[s] || 0; r += wi * (C[s][i + hold] / C[s][i] - 1); turn += Math.abs(wi - (prev[s] || 0)); }
    const gross = SYMS.reduce((a, s) => a + Math.abs(w[s] || 0), 0);
    const cost = turn * FEE + gross * FUND8H * 3 * hold;
    r -= cost; prev = w;
    const x = res[T[i] < SPLIT ? 'train' : 'test'];
    x.eq *= 1 + r; x.pk = Math.max(x.pk, x.eq); x.dd = Math.max(x.dd, (x.pk - x.eq) / x.pk * 100); x.n++; if (r > 0) x.w++; x.fee += cost;
  }
  const a = res.train, b = res.test;
  console.log(name.padEnd(38), '| TRAIN', f((a.eq - 1) * 100).padStart(6) + '%', 'dd', a.dd.toFixed(0).padStart(2) + '%', 'win', (a.w / a.n * 100).toFixed(0) + '%', 'periods', a.n,
    '|| TEST', f((b.eq - 1) * 100).padStart(6) + '%', 'dd', b.dd.toFixed(0).padStart(2) + '%', 'win', (b.w / b.n * 100).toFixed(0) + '%');
  return res;
}
const norm = (w) => { const g = Object.values(w).reduce((a, x) => a + Math.abs(x), 0); if (!g) return null; for (const k in w) w[k] /= g; return w; };

console.log('=== §3.9/3.10 Mean-reversion (cluster / cross-sectional): long losers, short winners vs. market average');
for (const L of [1, 3, 5, 7]) for (const H of [1, 3, 7]) runWeights(`XS mean-rev L${L} hold${H}`, i => {
  const r = {}; let m = 0; for (const s of SYMS) { r[s] = ret(s, i, L); m += r[s] / SYMS.length; }
  const w = {}; for (const s of SYMS) w[s] = -(r[s] - m); return norm(w); }, H);

console.log('=== §3.3 Low-volatility anomaly: long low-vol, short high-vol (beta-neutral-ish, weekly)');
for (const V of [30, 60]) runWeights(`Low-vol V${V} hold7`, i => {
  if (i < V + 1) return null;
  const vol = SYMS.map(s => { let a = 0; for (let k = i - V + 1; k <= i; k++) a += ret(s, k) ** 2; return { s, v: Math.sqrt(a / V) }; }).sort((x, y) => x.v - y.v);
  const w = {}; vol.slice(0, 3).forEach(x => w[x.s] = 1 / x.v); vol.slice(-3).forEach(x => w[x.s] = -1 / x.v);
  const lg = vol.slice(0, 3).reduce((a, x) => a + 1 / x.v, 0), sh = vol.slice(-3).reduce((a, x) => a + 1 / x.v, 0);
  vol.slice(0, 3).forEach(x => w[x.s] /= lg); vol.slice(-3).forEach(x => w[x.s] /= sh); return norm(w); }, 7, V + 2);

console.log('=== §3.8 Pairs trading (z-score of log price ratio vs. rolling mean), daily, enter |z|>Z, exit z crosses 0');
function pairs(a, b, W, Z, start = 60) {
  const res = { train: { eq: 1, pk: 1, dd: 0, n: 0, w: 0 }, test: { eq: 1, pk: 1, dd: 0, n: 0, w: 0 } };
  let pos = 0, ent = 0;
  for (let i = W + 1; i < T.length - 1; i++) {
    const x = []; for (let k = i - W + 1; k <= i; k++) x.push(Math.log(C[a][k] / C[b][k]));
    const mu = x.reduce((p, q) => p + q, 0) / W, sd = Math.sqrt(x.reduce((p, q) => p + (q - mu) ** 2, 0) / W), z = (x[W - 1] - mu) / sd;
    if (pos === 0 && Math.abs(z) > Z) { pos = z > 0 ? -1 : 1; ent = i; }
    else if (pos !== 0 && (pos > 0 ? z >= 0 : z <= 0 || i - ent > 3 * W)) {
      // trade result: long a short b if pos=1 (0.5 / 0.5 of equity)
      const ra = C[a][i] / C[a][ent] - 1, rb = C[b][i] / C[b][ent] - 1;
      const r = pos * 0.5 * (ra - rb) - 4 * FEE * 0.5 - FUND8H * 3 * (i - ent);
      const p = res[T[ent] < SPLIT ? 'train' : 'test']; p.eq *= 1 + r; p.pk = Math.max(p.pk, p.eq); p.dd = Math.max(p.dd, (p.pk - p.eq) / p.pk * 100); p.n++; if (r > 0) p.w++;
      pos = 0;
    }
  }
  return res;
}
const pairList = [];
for (let x = 0; x < SYMS.length; x++) for (let y = x + 1; y < SYMS.length; y++) pairList.push([SYMS[x], SYMS[y]]);
for (const [W, Z] of [[20, 2], [30, 2], [60, 2]]) {
  let tr = [], te = [];
  for (const [a, b] of pairList) { const r = pairs(a, b, W, Z); tr.push(r.train); te.push(r.test); }
  const avg = (arr, k) => arr.reduce((p, q) => p + q[k], 0) / arr.length;
  const posTr = tr.filter(r => r.eq > 1).length, posTe = te.filter(r => r.eq > 1).length;
  console.log(`Pairs W${W} z${Z} (all ${pairList.length} pairs, avg)`.padEnd(38), '| TRAIN avg', f((avg(tr, 'eq') - 1) * 100) + '%', 'pairs+', posTr + '/' + pairList.length, 'trades', tr.reduce((p, q) => p + q.n, 0),
    '|| TEST avg', f((avg(te, 'eq') - 1) * 100) + '%', 'pairs+', posTe + '/' + pairList.length, 'trades', te.reduce((p, q) => p + q.n, 0));
}
module.exports = { C, T, runWeights };
