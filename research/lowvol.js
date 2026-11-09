const R = require('./research.js'); const { C, T, runWeights } = (() => { const m = require('./book2.js'); return m; })();
const SYMS = R.SYMS; const ret = (s, i) => C[s][i] / C[s][i - 1] - 1;
function lv(V, k, H, off = 0, iw = true) { return runWeights(`Low-vol V${V} k${k} hold${H} off${off}${iw ? '' : ' eqw'}`, i => {
  if (i < V + 1 + off) return null;
  const vol = SYMS.map(s => { let a = 0; for (let j = i - V + 1; j <= i; j++) a += ret(s, j) ** 2; return { s, v: Math.sqrt(a / V) }; }).sort((x, y) => x.v - y.v);
  const w = {}; const L = vol.slice(0, k), S = vol.slice(-k);
  const lw = L.reduce((a, x) => a + (iw ? 1 / x.v : 1), 0), sw = S.reduce((a, x) => a + (iw ? 1 / x.v : 1), 0);
  L.forEach(x => w[x.s] = 0.5 * (iw ? 1 / x.v : 1) / lw); S.forEach(x => w[x.s] = -0.5 * (iw ? 1 / x.v : 1) / sw);
  return w; }, H, V + 2 + off); }
console.log('--- robustness: lookback'); for (const V of [14, 20, 30, 45]) lv(V, 3, 7);
console.log('--- robustness: #coins each side'); for (const k of [2, 3, 4]) lv(30, k, 7);
console.log('--- robustness: holding'); for (const H of [3, 7, 14]) lv(30, 3, H);
console.log('--- robustness: rebalance weekday offset'); for (const o of [0, 1, 2, 3, 4, 5, 6]) lv(30, 3, 7, o);
console.log('--- equal weight'); lv(30, 3, 7, 0, false);
// which coins usually long/short
const cnt = {}; for (let i = 40; i < T.length; i += 7) { const vol = SYMS.map(s => { let a = 0; for (let j = i - 29; j <= i; j++) a += ret(s, j) ** 2; return { s, v: a }; }).sort((x, y) => x.v - y.v);
  vol.slice(0, 3).forEach(x => cnt[x.s] = (cnt[x.s] || '') + 'L'); vol.slice(-3).forEach(x => cnt[x.s] = (cnt[x.s] || '') + 'S'); }
console.log(Object.entries(cnt).map(([s, v]) => s.replace('-USDT', '') + ' L' + (v.match(/L/g) || []).length + ' S' + (v.match(/S/g) || []).length).join(' | '));
