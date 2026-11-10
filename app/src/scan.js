/* =====================================================================
   SCAN ENGINE — Top-100 trend-breakout scanner (4H + daily, no 15m)
   Setup (validated family, see research): daily trend (EMA20/50) +
   4H close beyond the high/low of the previous N bars. Stop K×ATR(4H),
   trailing K×ATR on every 4H close; fixed targets shown for reference.
   ===================================================================== */
const Scan = (() => {
  const P0 = { minStop: 1.5, N: 40, K: 3, freshBars: 2, chaseAtr: 1.0, nearAtr: 1.0, tp1R: 2, tp2R: 4, minRvol: 1.5 };

  /* ---------- math ---------- */
  const ema = (a, n) => { const o = new Array(a.length).fill(NaN); if (a.length < n) return o; let s = 0; for (let i = 0; i < n; i++) s += a[i]; o[n - 1] = s / n; const k = 2 / (n + 1); for (let i = n; i < a.length; i++) o[i] = a[i] * k + o[i - 1] * (1 - k); return o; };
  const sma = (a, n) => { const o = new Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
  const atr = (h, l, c, n) => { const o = new Array(c.length).fill(NaN); let v = 0; for (let i = 1; i < c.length; i++) { const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); if (i <= n) { v += tr; if (i === n) { v /= n; o[i] = v; } } else { v = (v * (n - 1) + tr) / n; o[i] = v; } } return o; };
  const rsi = (c, n) => { const o = new Array(c.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0); if (i <= n) { g += u; l += w; if (i === n) { g /= n; l /= n; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } } else { g = (g * (n - 1) + u) / n; l = (l * (n - 1) + w) / n; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } } return o; };
  const ser = rows => { const S = { t: [], o: [], h: [], l: [], c: [], v: [], q: [] }; for (const r of rows) { S.t.push(r[0]); S.o.push(r[1]); S.h.push(r[2]); S.l.push(r[3]); S.c.push(r[4]); S.v.push(r[5]); S.q.push(r[6] || r[5] * r[4]); } S.n = S.t.length; return S; };

  function prep(raw, P) {
    const D = ser(raw['1day']), H = ser(raw['4hour']);
    D.e20 = ema(D.c, 20); D.e50 = ema(D.c, 50); D.rsi = rsi(D.c, 14); D.atr = atr(D.h, D.l, D.c, 14);
    H.atr = atr(H.h, H.l, H.c, 14); H.qSma = sma(H.q, 20); H.e20 = ema(H.c, 20);
    H.dHi = new Array(H.n).fill(NaN); H.dLo = new Array(H.n).fill(NaN);
    for (let i = P.N; i < H.n; i++) { let hh = -Infinity, ll = Infinity; for (let x = i - P.N; x < i; x++) { if (H.h[x] > hh) hh = H.h[x]; if (H.l[x] < ll) ll = H.l[x]; } H.dHi[i] = hh; H.dLo[i] = ll; }
    H.di = new Array(H.n); let j = -1;
    for (let i = 0; i < H.n; i++) { const T = H.t[i] + 14400; while (j + 1 < D.n && D.t[j + 1] + 86400 <= T) j++; H.di[i] = j; }
    D.rsi = D.rsi || rsi(D.c, 14);
    H.e50 = ema(H.c, 50); H.rsi = rsi(H.c, 14);
    // weekly candles from daily (weeks start Monday 00:00 UTC; only completed weeks)
    const W = { t: [], o: [], h: [], l: [], c: [], q: [] };
    for (let k = 0; k < D.n; k++) {
      const dt = new Date(D.t[k] * 1000), wd = (dt.getUTCDay() + 6) % 7, wk = D.t[k] - wd * 86400;
      const z = W.t.length - 1;
      if (z < 0 || W.t[z] !== wk) { W.t.push(wk); W.o.push(D.o[k]); W.h.push(D.h[k]); W.l.push(D.l[k]); W.c.push(D.c[k]); W.q.push(D.q[k]); W.days = 1; }
      else { W.h[z] = Math.max(W.h[z], D.h[k]); W.l[z] = Math.min(W.l[z], D.l[k]); W.c[z] = D.c[k]; W.q[z] += D.q[k]; }
    }
    if (W.t.length && D.t[D.n - 1] + 86400 < W.t[W.t.length - 1] + 7 * 86400) for (const k of ['t', 'o', 'h', 'l', 'c', 'q']) W[k].pop();   // drop running week
    W.n = W.t.length; W.e10 = ema(W.c, 10); W.e20 = ema(W.c, 20); W.atr = atr(W.h, W.l, W.c, 14);
    let M = null;
    if (raw['15min'] && raw['15min'].length > 60) { M = ser(raw['15min']); M.e20 = ema(M.c, 20); M.rsi = rsi(M.c, 14); M.qSma = sma(M.q, 20); M.atr = atr(M.h, M.l, M.c, 14); }
    return { D, H, W, M, vol24: raw.vol24 || 0 };
  }
  const dTrend = (D, j) => { if (j < 50) return 0; if (D.c[j] > D.e50[j] && D.e20[j] > D.e50[j]) return 1; if (D.c[j] < D.e50[j] && D.e20[j] < D.e50[j]) return -1; return 0; };

  // daily S/R zones from confirmed pivots (as of daily index j)
  function zones(D, j, R = 3, look = 200) {
    const a = D.atr[j], pts = [];
    if (!(a > 0)) return [];
    for (let k = Math.max(R, j - look); k <= j - R; k++) {
      let isH = true, isL = true;
      for (let x = k - R; x <= k + R; x++) { if (x === k) continue; if (D.h[x] > D.h[k]) isH = false; if (D.l[x] < D.l[k]) isL = false; }
      if (isH) pts.push(D.h[k]); if (isL) pts.push(D.l[k]);
    }
    pts.sort((x, y) => x - y);
    const Z = [];
    for (const p of pts) { const z = Z[Z.length - 1]; if (z && p - z.hi <= 0.6 * a) { z.hi = p; z.t++; } else Z.push({ lo: p, hi: p, t: 1 }); }
    for (const z of Z) { if (z.hi - z.lo < 0.25 * a) { const m = (z.hi + z.lo) / 2; z.lo = m - 0.125 * a; z.hi = m + 0.125 * a; } z.mid = (z.lo + z.hi) / 2; }
    return Z;
  }

  // historical simulation of the same setup on this coin (4H entry at close)
  function backtest(X, P) {
    const { D, H } = X, out = []; let pos = null;
    for (let i = Math.max(P.N, 60); i < H.n; i++) {
      if (pos) {
        const L = pos.d > 0;
        if (!pos.hit2 && (L ? H.h[i] >= pos.e + P.tp1R * pos.r : H.l[i] <= pos.e - P.tp1R * pos.r) && !(L ? H.l[i] <= pos.s0 : H.h[i] >= pos.s0)) pos.hit2 = true;
        if (L ? H.l[i] <= pos.stop : H.h[i] >= pos.stop) {
          const ex = L ? Math.min(pos.stop, H.o[i]) : Math.max(pos.stop, H.o[i]);
          out.push({ t: pos.t, d: pos.d, R: pos.d * (ex - pos.e) / pos.r, R2: pos.hit2 ? P.tp1R : (pos.lost2 ? -1 : pos.d * (ex - pos.e) / pos.r), bars: i - pos.i });
          pos = null;
        } else {
          if (!pos.hit2 && (L ? H.l[i] <= pos.s0 : H.h[i] >= pos.s0)) pos.lost2 = true;
          const ns = L ? H.c[i] - P.K * H.atr[i] : H.c[i] + P.K * H.atr[i];
          if (L ? ns > pos.stop : ns < pos.stop) pos.stop = ns;
        }
        if (pos) continue;
      }
      const tr = dTrend(D, H.di[i]);
      let d = 0; if (tr > 0 && H.c[i] > H.dHi[i]) d = 1; else if (tr < 0 && H.c[i] < H.dLo[i]) d = -1;
      if (!d) continue;
      const r = P.K * H.atr[i]; if (!(r > 0)) continue;
      pos = { d, e: H.c[i], r, s0: H.c[i] - d * r, stop: H.c[i] - d * r, t: H.t[i] + 14400, i, hit2: false, lost2: false };
    }
    return { trades: out, open: pos };
  }
  const stats = tr => { const n = tr.length; if (!n) return { n: 0 }; const w = tr.filter(t => t.R > 0).length, w2 = tr.filter(t => t.R2 > 0).length;
    return { n, wr: w / n * 100, avgR: tr.reduce((a, t) => a + t.R, 0) / n, wr2: w2 / n * 100, avgR2: tr.reduce((a, t) => a + t.R2, 0) / n, bars: tr.reduce((a, t) => a + t.bars, 0) / n }; };

  // evaluate current situation (last closed 4H bar)
  function evaluate(sym, X, P, btcTrend) {
    const { D, H } = X, i = H.n - 1, j = H.di[i];
    if (i < 60 || j < 50) return null;
    const tr = dTrend(D, j), price = H.c[i], a = H.atr[i];
    // same state machine as the backtest: a signal is "new" only if the simulated strategy opened it in the last freshBars bars
    const op = X.bt && X.bt.open;
    if (op && op.i < i - P.freshBars + 1) return { sym, kind: 'RUNNING', dir: op.d > 0 ? 'LONG' : 'SHORT', d: op.d, entry: op.e, stop: op.stop, since: op.t, price, R: op.d * (price - op.e) / op.r, tr };
    if (!tr) return { sym, kind: 'NONE', tr };
    const d = tr;
    let bi = -1;
    if (op && op.d === d) bi = op.i;
    let kind, level, entry;
    if (bi >= 0) {
      level = d > 0 ? H.dHi[bi] : H.dLo[bi];
      const ext = d * (price - level) / a;
      kind = ext <= P.chaseAtr ? 'READY' : 'LATE';
      entry = price;
    } else {
      let hh = -Infinity, ll = Infinity; for (let x = i - P.N + 1; x <= i; x++) { hh = Math.max(hh, H.h[x]); ll = Math.min(ll, H.l[x]); }
      level = d > 0 ? hh : ll;
      const dist = d * (level - price) / a;
      if (dist < 0 || dist > P.nearAtr) return { sym, kind: 'NONE', tr };
      kind = 'NEAR'; entry = level;
    }
    const risk = P.K * a, sl = entry - d * risk;
    const Z = zones(D, j);
    const ahead = Z.filter(z => d > 0 ? z.lo > entry : z.hi < entry).sort((x, y) => d > 0 ? x.lo - y.lo : y.hi - x.hi);
    const nextZ = ahead[0] || null, roomR = nextZ ? d * ((d > 0 ? nextZ.lo : nextZ.hi) - entry) / risk : null;
    let tp1 = entry + d * P.tp1R * risk, tp1Why = `${P.tp1R}R`;
    if (nextZ && roomR >= 1 && roomR < P.tp1R) { tp1 = d > 0 ? nextZ.lo : nextZ.hi; tp1Why = 'مقاومت/حمایت روزانه'; }
    let tp2 = entry + d * P.tp2R * risk, tp2Why = `${P.tp2R}R`;
    const beyond = ahead.find(z => d * ((d > 0 ? z.lo : z.hi) - tp1) > 0.5 * risk);
    if (beyond && d * ((d > 0 ? beyond.lo : beyond.hi) - entry) / risk < P.tp2R) { tp2 = d > 0 ? beyond.lo : beyond.hi; tp2Why = 'ناحیه‌ی روزانه'; }
    // reasons
    const bk = bi >= 0 ? bi : i, rvol = H.q[bk] / (H.qSma[bk - 1] || H.q[bk]);
    const rs = D.rsi[j], extD = Math.abs(D.c[j] - D.e20[j]) / D.atr[j];
    const R = [];
    R.push({ ok: true, t: `روند روزانه ${d > 0 ? 'صعودی' : 'نزولی'}: قیمت ${d > 0 ? 'بالای' : 'زیر'} EMA50 و EMA20 ${d > 0 ? 'بالای' : 'زیر'} EMA50` });
    if (kind === 'NEAR') R.push({ ok: null, t: `قیمت ${fmt((Math.abs(level - price) / price) * 100, 1)}% با ${d > 0 ? 'سقف' : 'کف'} ${P.N} کندل ۴ساعته (${fmtP(level)}) فاصله دارد — منتظر بسته شدن کندل ۴ساعته ${d > 0 ? 'بالای' : 'زیر'} آن` });
    else R.push({ ok: true, t: `شکست ${d > 0 ? 'سقف' : 'کف'} ${P.N} کندل ۴ساعته (حدود ${Math.round(P.N / 6)} روز) در ${fmtP(level)}${bi < i ? ' (یک کندل قبل)' : ''}` });
    if (kind !== 'NEAR') R.push({ ok: rvol >= P.minRvol ? true : rvol < 1 ? false : null, t: `حجم کندل شکست ${fmt(rvol, 1)}× میانگین ۲۰ کندل${rvol < 1 ? ' — شکست کم‌حجم' : ''}` });
    R.push(nextZ ? { ok: roomR >= P.tp1R ? true : roomR < 1 ? false : null, t: `فاصله تا ${d > 0 ? 'مقاومت' : 'حمایت'} روزانه‌ی بعدی (${fmtP(d > 0 ? nextZ.lo : nextZ.hi)}): ${fmt(roomR, 1)}R` }
                 : { ok: true, t: `${d > 0 ? 'مقاومت' : 'حمایت'} روزانه‌ای در مسیر نیست (فضای حرکت باز)` });
    if (d > 0 ? rs > 75 : rs < 25) R.push({ ok: false, t: `RSI روزانه ${fmt(rs, 0)} — ${d > 0 ? 'اشباع خرید' : 'اشباع فروش'}، احتمال اصلاح` });
    if (extD > 3) R.push({ ok: false, t: `قیمت ${fmt(extD, 1)}×ATR از EMA20 روزانه فاصله دارد — حرکت کشیده شده` });
    if (sym !== 'BTC-USDT' && btcTrend) R.push(btcTrend === d ? { ok: true, t: `روند روزانه‌ی BTC هم‌جهت است` } : { ok: false, t: `روند روزانه‌ی BTC ${btcTrend > 0 ? 'صعودی' : 'نزولی'} است (خلاف جهت)` });
    if (kind === 'LATE') R.push({ ok: false, t: `قیمت ${fmt(d * (price - level) / a, 1)}×ATR از سطح شکست دور شده — ورود فقط با پولبک به ${fmtP(level)}` });
    R.push({ ok: null, t: `نوسان ۴ساعته (ATR): ${fmt(a / price * 100, 2)}% قیمت · حجم ۲۴ساعته ${fmtM(X.vol24)}` });
    let score = 50 + (rvol >= P.minRvol ? 12 : rvol < 1 ? -10 : 0) + (roomR == null || roomR >= P.tp1R ? 12 : roomR < 1 ? -15 : 0)
      + (btcTrend === d ? 10 : sym === 'BTC-USDT' ? 5 : -10) - ((d > 0 ? rs > 75 : rs < 25) ? 10 : 0) - (extD > 3 ? 8 : 0) - (kind === 'LATE' ? 15 : 0) - (kind === 'NEAR' ? 5 : 0);
    score = Math.max(0, Math.min(100, Math.round(score)));
    return { sym, kind, dir: d > 0 ? 'LONG' : 'SHORT', d, price, level, entry, sl, tp1, tp1Why, tp2, tp2Why, risk, riskPct: risk / entry * 100,
      rr1: Math.abs(tp1 - entry) / risk, rr2: Math.abs(tp2 - entry) / risk, atr: a, reasons: R, score, time: H.t[i] + 14400, trailK: P.K };
  }


  /* ---------------- TOP-DOWN CHECKLIST ----------------
     weekly trend -> daily trend -> daily position in weekly channel/levels ->
     4H location inside the daily structure -> 15m entry trigger -> confirmations */
  function regChan(c, h, l, end, L) {
    if (end - L + 1 < 0) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let x = 0; x < L; x++) { const y = c[end - L + 1 + x]; sx += x; sy += y; sxy += x * y; sxx += x * x; }
    const sl = (L * sxy - sx * sy) / (L * sxx - sx * sx), ic = (sy - sl * sx) / L;
    let up = -Infinity, dn = Infinity;
    for (let x = 0; x < L; x++) { const b = ic + sl * x; up = Math.max(up, h[end - L + 1 + x] - b); dn = Math.min(dn, l[end - L + 1 + x] - b); }
    const b = ic + sl * (L - 1);
    return { upper: b + up, lower: b + dn, mid: b, slopePct: sl / b * 100 };
  }
  const pos01 = (p, ch) => (p - ch.lower) / ((ch.upper - ch.lower) || 1);
  function candle(o, h, l, c, po, pc, d) {      // bullish (d=1) / bearish (d=-1) price-action pattern
    const rg = Math.max(h - l, 1e-12), body = Math.abs(c - o);
    if (d > 0) {
      if (c > o && pc < po && c >= po && o <= pc) return 'اینگالفینگ صعودی';
      if ((Math.min(o, c) - l) / rg >= 0.55 && body / rg < 0.35) return 'پین‌بار صعودی';
    } else {
      if (c < o && pc > po && c <= po && o >= pc) return 'اینگالفینگ نزولی';
      if ((h - Math.max(o, c)) / rg >= 0.55 && body / rg < 0.35) return 'پین‌بار نزولی';
    }
    return null;
  }
  // index of last element with T[k] + span <= t (binary search)
  const lastClosed = (T, span, t) => { let lo = 0, hi = T.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] + span <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
  const cache = (X, k, key, f) => { const c = X[k] || (X[k] = {}); return key in c ? c[key] : (c[key] = f()); };
  function checklist(sym, X, d, ctx, at) {
    const { D, H, W, M } = X;
    const mt = M ? (at && at.mt != null ? at.mt : M.n - 1) : -1;
    const tEnd = M ? M.t[mt] + 900 : H.t[H.n - 1] + 14400;
    const i = M ? lastClosed(H.t, 14400, tEnd) : H.n - 1, j = H.di[i], w = lastClosed(W.t, 7 * 86400, D.t[j] + 86400);
    if (i < 60 || j < 50 || w < 0) return null;
    const L = d > 0, price = M ? M.c[mt] : H.c[i], a4 = H.atr[i], aD = D.atr[j];
    const items = [];
    const add = (key, title, ok, detail) => items.push({ key, title, ok, detail });
    // 1 weekly trend
    const wUp = W.c[w] > W.e20[w] && W.e10[w] > W.e20[w], wDn = W.c[w] < W.e20[w] && W.e10[w] < W.e20[w];
    add('w', 'روند هفتگی', w >= 20 ? (L ? wUp : wDn) : null, w >= 20 ? `${wUp ? 'صعودی' : wDn ? 'نزولی' : 'خنثی'} (قیمت و EMA10 نسبت به EMA20 هفتگی)` : 'دیتای هفتگی کافی نیست');
    // 2 daily trend
    const dT = dTrend(D, j);
    add('d', 'روند روزانه', dT === d, `${dT > 0 ? 'صعودی' : dT < 0 ? 'نزولی' : 'خنثی'} (EMA20/EMA50 روزانه)`);
    // 3 daily position inside weekly channel
    const wch = w >= 26 ? cache(X, '_wch', w, () => regChan(W.c, W.h, W.l, w, 26)) : null;
    const wpos = wch ? pos01(D.c[j], wch) : null;
    add('wc', 'جایگاه روزانه در کانال هفتگی', wch ? (L ? wpos <= 0.65 : wpos >= 0.35) : null,
      wch ? `${Math.round(wpos * 100)}% کانال ۲۶ هفته (${wch.slopePct > 0.3 ? 'صعودی' : wch.slopePct < -0.3 ? 'نزولی' : 'افقی'}) — ${L ? (wpos <= 0.65 ? 'فضای رشد دارد' : 'نزدیک سقف کانال') : (wpos >= 0.35 ? 'فضای ریزش دارد' : 'نزدیک کف کانال')}` : 'دیتای ۲۶ هفته کافی نیست');
    // levels: daily + weekly zones
    const all = cache(X, '_zn', j + ':' + w, () => zones(D, j).map(z => ({ ...z, tf: 'روزانه' })).concat((w >= 10 ? zones(W, w, 2, 104) : []).map(z => ({ ...z, tf: 'هفتگی' }))));
    const support = all.filter(z => z.lo <= price).sort((x, y) => y.hi - x.hi)[0] || null;
    const resist = all.filter(z => z.hi >= price).sort((x, y) => x.lo - y.lo)[0] || null;
    // 4 4H location inside daily structure
    const dch = cache(X, '_dch', j, () => regChan(D.c, D.h, D.l, j, 60)), dpos = dch ? pos01(H.c[i], dch) : 0.5;
    const nearZ = L ? support && (price - support.hi) <= 1.0 * a4 : resist && (resist.lo - price) <= 1.0 * a4;
    const nearEma = Math.abs(H.c[i] - D.e20[j]) <= 1.0 * a4;
    const brk = L ? H.c[i] > H.dHi[i] || H.c[i - 1] > H.dHi[i - 1] : H.c[i] < H.dLo[i] || H.c[i - 1] < H.dLo[i - 1];
    const edge = L ? dpos <= 0.3 : dpos >= 0.7;
    const locType = brk ? `شکست ${L ? 'سقف' : 'کف'} ${ctx.P.N} کندل ۴ساعته` : nearZ ? `پولبک به ${L ? 'حمایت' : 'مقاومت'} ${(L ? support : resist).tf} ${fmtP((L ? support : resist).lo)}–${fmtP((L ? support : resist).hi)}`
      : nearEma ? 'پولبک به EMA20 روزانه' : edge ? `${L ? 'کف' : 'سقف'} کانال روزانه` : null;
    add('loc', 'موقعیت ۴ساعته در ساختار روزانه', !!locType, locType || `وسط ساختار (${Math.round(dpos * 100)}% کانال ۶۰ روزه) — نه روی سطح، نه شکست`);
    // 5 4H structure
    // backtest v7: entries work when the 4H is CORRECTING against the daily trend (true pullback), not when it is already extended
    const h4al = L ? H.e20[i] > H.e50[i] && H.c[i] > H.e50[i] : H.e20[i] < H.e50[i] && H.c[i] < H.e50[i];
    add('h4', 'اصلاح ۴ساعته (پولبک در روند روزانه)', !h4al, h4al ? `۴ساعته از قبل ${L ? 'صعودی' : 'نزولی'} و کشیده است (EMA20 ${L ? 'بالای' : 'زیر'} EMA50) — ورود دیرهنگام` : `۴ساعته در حال اصلاح خلاف روند روزانه (EMA20 ${H.e20[i] > H.e50[i] ? 'بالای' : 'زیر'} EMA50 ۴ساعته)`);
    // 6 15m trigger
    let trig = null, mi = -1;
    if (M) {
      for (let k = mt; k >= Math.max(5, mt - 3); k--) {
        let hh = -Infinity, ll = Infinity; for (let x = k - 3; x < k; x++) { hh = Math.max(hh, M.h[x]); ll = Math.min(ll, M.l[x]); }
        if (L ? M.c[k] > hh && M.c[k] > M.e20[k] : M.c[k] < ll && M.c[k] < M.e20[k]) { trig = k; break; }
      }
      mi = trig != null ? trig : mt;
      add('m15', 'ماشه‌ی ورود ۱۵ دقیقه', trig != null, trig != null ? `شکست ${L ? 'سقف' : 'کف'} ۳ کندل قبل و ${L ? 'بالای' : 'زیر'} EMA20 (${mt - trig === 0 ? 'کندل آخر' : (mt - trig) + ' کندل قبل'})`
        : `هنوز نه — نیاز به بسته شدن ${L ? 'بالای' : 'زیر'} ${fmtP(L ? Math.max(M.h[mt - 2], M.h[mt - 1], M.h[mt]) : Math.min(M.l[mt - 2], M.l[mt - 1], M.l[mt]))} و ${L ? 'بالای' : 'زیر'} EMA20 (${fmtP(M.e20[mt])})`);
    } else add('m15', 'ماشه‌ی ورود ۱۵ دقیقه', null, 'دیتای ۱۵ دقیقه برای این ارز نیست');
    // 7 volume
    const rv15 = M && mi >= 0 ? M.q[mi] / (M.qSma[mi - 1] || M.q[mi]) : null, rv4 = H.q[i] / (H.qSma[i - 1] || H.q[i]);
    add('vol', 'تأیید حجم', (rv15 != null && rv15 >= 1.5) || rv4 >= 1.3, `حجم ${rv15 != null ? `کندل ۱۵م ${fmt(rv15, 1)}× · ` : ''}کندل ۴ساعته ${fmt(rv4, 1)}× میانگین`);
    // 8 RSI
    const r4 = H.rsi[i], r4p = H.rsi[i - 1], rD = D.rsi[j];
    const rsiOk = L ? r4 >= 40 && r4 <= 70 && r4 > r4p && rD < 75 : r4 >= 30 && r4 <= 60 && r4 < r4p && rD > 25;
    add('rsi', 'تأیید RSI', rsiOk, `RSI ۴ساعته ${fmt(r4, 0)} (${r4 > r4p ? 'رو به بالا' : 'رو به پایین'}) · روزانه ${fmt(rD, 0)}${L && rD >= 75 ? ' — اشباع خرید' : !L && rD <= 25 ? ' — اشباع فروش' : ''}`);
    // 9 price action
    let pa = candle(H.o[i], H.h[i], H.l[i], H.c[i], H.o[i - 1], H.c[i - 1], d), paTf = '۴ساعته';
    if (!pa && M) for (let k = mt; k >= mt - 3; k--) { pa = candle(M.o[k], M.h[k], M.l[k], M.c[k], M.o[k - 1], M.c[k - 1], d); if (pa) { paTf = '۱۵ دقیقه'; break; } }
    add('pa', 'تأیید پرایس اکشن', !!pa, pa ? `${pa} در ${paTf}` : 'کندل برگشتی/اینگالفینگ هم‌جهت دیده نشد');
    // 10 room to opposite level
    const risk0 = Math.max((ctx.P.minStop || 0.6) * a4, Math.min(3 * a4, L ? price - ((support && price - support.lo <= 2 * a4 ? support.lo : price - 1.5 * a4) - 0.25 * a4) : (((resist && resist.hi - price <= 2 * a4) ? resist.hi : price + 1.5 * a4) + 0.25 * a4) - price));
    const opp = L ? all.filter(z => z.lo > price + 0.3 * risk0).sort((x, y) => x.lo - y.lo) : all.filter(z => z.hi < price - 0.3 * risk0).sort((x, y) => y.hi - x.hi);
    const room = opp[0] ? Math.abs((L ? opp[0].lo : opp[0].hi) - price) / risk0 : null;
    add('room', 'فضای حرکت تا سطح مخالف', room == null || room >= 2, room == null ? `${L ? 'مقاومت' : 'حمایت'}ی در مسیر نیست` : `${fmt(room, 1)}R تا ${L ? 'مقاومت' : 'حمایت'} ${opp[0].tf} ${fmtP(L ? opp[0].lo : opp[0].hi)}`);
    // 11 BTC
    if (sym !== 'BTC-USDT') add('btc', 'هم‌جهتی با BTC', ctx.btcTrend ? ctx.btcTrend === d : null, `روند روزانه BTC ${ctx.btcTrend > 0 ? 'صعودی' : ctx.btcTrend < 0 ? 'نزولی' : 'خنثی'}`);
    // 12 traders (optional, from Hyperliquid consensus)
    const cons = ctx.traders && ctx.traders[sym.replace('-USDT', '')];
    if (cons && cons.n >= 2) { const lp = cons.lv / ((cons.lv + cons.sv) || 1); add('hl', 'تریدرهای برتر هم‌جهت', L ? lp >= 0.6 : lp <= 0.4, `${cons.L} Long / ${cons.S} Short — ${Math.round(lp * 100)}% حجم دلاری Long`); }
    // plan
    const entry = price, sl = L ? entry - risk0 : entry + risk0;
    let tp1 = opp[0] && Math.abs((L ? opp[0].lo : opp[0].hi) - entry) >= 1 * risk0 ? (L ? opp[0].lo : opp[0].hi) : entry + d * 2 * risk0;
    const tp1Why = opp[0] && tp1 === (L ? opp[0].lo : opp[0].hi) ? `${L ? 'مقاومت' : 'حمایت'} ${opp[0].tf}` : '2R';
    const nxt = opp.find(z => Math.abs((L ? z.lo : z.hi) - tp1) > 0.5 * risk0 && d * ((L ? z.lo : z.hi) - tp1) > 0);
    let tp2 = nxt ? (L ? nxt.lo : nxt.hi) : entry + d * Math.max(3, Math.abs(tp1 - entry) / risk0 + 1.5) * risk0, tp2Why = nxt ? `${L ? 'مقاومت' : 'حمایت'} ${nxt.tf}` : 'R';
    const avail = items.filter(x => x.ok !== null), score = avail.filter(x => x.ok).length;
    // mandatory gates (from the signal backtest): daily trend + 4H pullback + location; READY also needs the 15m trigger
    const ok = k => (items.find(x => x.key === k) || {}).ok;
    for (const x of items) x.must = ['d', 'h4', 'loc', 'm15'].includes(x.key);
    const gates = ok('d') && ok('h4') && ok('loc');
    const status = gates ? (ok('m15') ? 'READY' : 'NEAR') : 'WATCH';
    return { sym, dir: L ? 'LONG' : 'SHORT', d, items, score, total: avail.length, status, price, entry, sl, tp1, tp1Why, tp2, tp2Why, risk: risk0, riskPct: risk0 / entry * 100,
      rr1: Math.abs(tp1 - entry) / risk0, rr2: Math.abs(tp2 - entry) / risk0, atr: a4, trailK: ctx.P.K, time: tEnd, trigTime: trig != null ? M.t[trig] + 900 : null, i, j, mt, support, resist, locType, wpos, dpos };
  }


  /* ---------------- SIGNAL BACKTEST (walk-forward over every closed 15m bar; no look-ahead) ----------------
     A signal = status READY of the checklist. Entry at the close of the 15m trigger bar. One position per coin.
     Exit models: T = trailing K×ATR(4H) from the start (the recommended plan), A = all at TP1, C = half at TP1 + trail.
     Costs: round-trip taker fee + slippage, expressed in R. */
  function simSignal(Xs, c, P, cost) {
    const M = Xs.M, H = Xs.H, d = c.d, e = c.entry, r = Math.abs(e - c.sl);
    let stop = c.sl, stopC = c.sl, half = false, lastH = c.i, k = c.mt + 1, RT = null, RA = null, RC = null, mfe = 0, kT = -1;
    const maxK = c.mt + (P.maxHoldDays || 30) * 96;
    for (; k < M.n && k <= maxK; k++) {
      const hi = M.h[k], lo = M.l[k], hs = x => d > 0 ? lo <= x : hi >= x, hit = x => d > 0 ? hi >= x : lo <= x;
      const q4 = lastClosed(H.t, 14400, M.t[k]);
      if (q4 > lastH) { for (let q = lastH + 1; q <= q4; q++) { const ns = H.c[q] - d * P.K * H.atr[q]; if (d > 0 ? ns > stop : ns < stop) stop = ns; if (half && (d > 0 ? ns > stopC : ns < stopC)) stopC = ns; } lastH = q4; }
      if (RT == null) { if (hs(stop)) { RT = d * (stop - e) / r; kT = k; } else mfe = Math.max(mfe, d > 0 ? (hi - e) / r : (e - lo) / r); }
      if (RA == null) { if (hs(c.sl)) RA = -1; else if (hit(c.tp1)) RA = c.rr1; }
      if (RC == null) { if (!half) { if (hs(c.sl)) RC = -1; else if (hit(c.tp1)) { half = true; stopC = d > 0 ? Math.max(e, stopC) : Math.min(e, stopC); } } else if (hs(stopC)) RC = 0.5 * c.rr1 + 0.5 * d * (stopC - e) / r; }
      if (RT != null && RA != null && RC != null) break;
    }
    const kk = Math.min(k, M.n - 1), last = d * (M.c[kk] - e) / r, cR = cost / c.riskPct, open = RT == null;
    return { T: (RT ?? last) - cR, A: (RA ?? last) - cR, C: (RC ?? (half ? 0.5 * c.rr1 + 0.5 * last : last)) - cR, costR: cR, mfe, open,
      exitT: M.t[open ? kk : kT] + 900, exitK: open ? kk : kT };
  }
  function signalBacktest(data, opts) {
    const P = Object.assign({}, P0, opts || {}), cost = P.costPct != null ? P.costPct : 0.22, X = {}, sigs = [];
    for (const s in data.symbols) { try { const x = prep(data.symbols[s], P); if (x.M) X[s] = x; } catch (e) {} }
    const B = X['BTC-USDT'] || (data.symbols['BTC-USDT'] ? prep(data.symbols['BTC-USDT'], P) : null);
    for (const s in X) {
      const Xs = X[s], M = Xs.M; let busy = -1;
      for (let mt = 300; mt < M.n - 1; mt++) {
        if (mt <= busy) continue;
        const ctx = { P, btcTrend: s === 'BTC-USDT' || !B ? 0 : dTrend(B.D, lastClosed(B.D.t, 86400, M.t[mt] + 900)) };
        let best = null;
        for (const d of [1, -1]) { const c = checklist(s, Xs, d, ctx, { mt }); if (c && c.status === 'READY' && (!best || c.score / c.total > best.score / best.total)) best = c; }
        if (!best) continue;
        const r = simSignal(Xs, best, P, cost), it = {};
        for (const x of best.items) it[x.key] = x.ok;
        sigs.push({ sym: s, t: best.time, d: best.d, score: best.score, total: best.total, it, entry: best.entry, sl: best.sl, riskPct: best.riskPct, rr1: best.rr1, ...r });
        busy = r.exitK;
      }
    }
    sigs.sort((a, b) => a.t - b.t);
    return { sigs, P, coins: Object.keys(X), from: sigs.length ? sigs[0].t : null, to: Object.values(X).reduce((m, x) => Math.max(m, x.M.t[x.M.n - 1] + 900), 0) };
  }
  // group statistics for a list of signals and an exit model
  function sigStats(a, v = 'T') {
    const n = a.length; if (!n) return { n: 0 };
    const R = a.map(x => x[v]), win = R.filter(x => x > 0), loss = R.filter(x => x <= 0), sum = R.reduce((s, x) => s + x, 0);
    const gw = win.reduce((s, x) => s + x, 0), gl = -loss.reduce((s, x) => s + x, 0);
    return { n, wr: win.length / n * 100, avgR: sum / n, sumR: sum, avgWin: win.length ? gw / win.length : 0, avgLoss: loss.length ? -gl / loss.length : 0, pf: gl ? gw / gl : Infinity };
  }
  // account simulation: fixed % risk of current equity per signal, limit on concurrent positions
  function sigPortfolio(sigs, o) {
    o = Object.assign({ capital: 100, riskPct: 1, maxOpen: 4, v: 'T' }, o || {});
    let eq = o.capital, peak = eq, dd = 0, open = [], taken = 0, skipped = 0;
    const curve = [];
    const close = t => { open.sort((a, b) => a.exitT - b.exitT); while (open.length && open[0].exitT <= t) { const p = open.shift(); eq += p.risk * p.s[o.v]; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak * 100); curve.push([p.exitT, eq]); } };
    for (const s of sigs) { close(s.t); if (open.length >= o.maxOpen || open.some(p => p.s.sym === s.sym)) { skipped++; continue; } open.push({ s, risk: eq * o.riskPct / 100, exitT: s.exitT }); taken++; }
    close(Infinity);
    return { start: o.capital, end: eq, retPct: (eq / o.capital - 1) * 100, maxDD: dd, taken, skipped, curve };
  }
  // when did the current status start? walk back over closed 15m bars while status+direction stay the same
  function since(sym, X, c, ctx, maxBars = 192) {
    if (!X.M || c.status === 'WATCH') return null;
    let first = c.trigTime || c.time;
    for (let mt = c.mt - 1; mt >= Math.max(300, c.mt - maxBars); mt--) {
      const p = checklist(sym, X, c.d, ctx, { mt });
      if (!p || p.status === 'WATCH' || (c.status === 'READY' && p.status !== 'READY')) break;
      first = p.status === 'READY' ? (p.trigTime || p.time) : p.time;
    }
    return first;
  }
  function run(data, opts) {
    const P = Object.assign({}, P0, opts || {}), out = { setups: [], checks: [], all: {}, P, coins: 0, errors: [] };
    const syms = Object.keys(data.symbols || {});
    let btc = 0;
    const X = {};
    for (const s of syms) { try { X[s] = prep(data.symbols[s], P); } catch (e) { out.errors.push(s + ': ' + e.message); } }
    if (X['BTC-USDT']) { const B = X['BTC-USDT']; btc = dTrend(B.D, B.D.n - 1); }
    out.btcTrend = btc;
    let allTr = [];
    for (const s in X) {
      out.coins++;
      const bt = backtest(X[s], P); X[s].bt = bt; const tr = bt.trades; allTr = allTr.concat(tr);
      const ev = evaluate(s, X[s], P, btc);
      out.all[s] = { X: X[s], hist: stats(tr), ev };
      if (ev && ev.kind === 'RUNNING') (out.running = out.running || []).push(ev);
      try {
        const H = X[s].H; if (H.n < 80 || H.di[H.n - 1] < 50) continue;
        const cl = [1, -1].map(d => checklist(s, X[s], d, { P, btcTrend: btc, traders: opts && opts.traders })).filter(Boolean); if (cl.length < 2) continue; cl.sort((a, b) => (b.score / b.total) - (a.score / a.total));
        const best = cl[0]; best.hist = stats(tr); best.other = cl[1];
        const ctx0 = { P, btcTrend: btc };
        for (const c of cl) { c.since = since(s, X[s], c, ctx0); c.sid = c.sym + '|' + c.dir + '|' + (c.since || c.time); }
        out.checks.push(best);
      } catch (e) { out.errors.push(s + ': ' + e.message); }
    }
    out.hist = stats(allTr);
    out.histFrom = Math.min(...Object.values(X).map(x => x.H.t[Math.max(P.N, 60)] || Infinity));
    const rank = { READY: 0, NEAR: 1, LATE: 2 };
    out.setups.sort((a, b) => rank[a.kind] - rank[b.kind] || b.score - a.score);
    const rk = { READY: 0, NEAR: 1, WATCH: 2 };
    out.checks.sort((a, b) => rk[a.status] - rk[b.status] || (b.score / b.total) - (a.score / a.total));
    out.X = X;
    return out;
  }
  // after-the-fact outcome of a journal entry using 4H data
  function outcome(X, e) {
    const H = X.H, d = e.dir === 'LONG' ? 1 : -1;
    let res = { status: 'OPEN', R: null }, stop = e.sl, i0 = H.t.findIndex(t => t + 14400 > e.time);
    const risk = Math.abs(e.entry - e.sl);
    if (i0 < 0) return { status: 'OPEN', R: d * (H.c[H.n - 1] - e.entry) / risk, stop: e.sl, price: H.c[H.n - 1] };
    for (let i = i0; i < H.n; i++) {
      if (d > 0 ? H.l[i] <= stop : H.h[i] >= stop) return { status: stop === e.sl ? 'SL' : 'TRAIL', R: d * (stop - e.entry) / risk, at: H.t[i] + 14400 };
      if (!res.tp1 && (d > 0 ? H.h[i] >= e.tp1 : H.l[i] <= e.tp1)) res.tp1 = H.t[i] + 14400;
      if (!res.tp2 && (d > 0 ? H.h[i] >= e.tp2 : H.l[i] <= e.tp2)) res.tp2 = H.t[i] + 14400;
      const ns = d > 0 ? H.c[i] - e.trailK * H.atr[i] : H.c[i] + e.trailK * H.atr[i];
      if (d > 0 ? ns > stop : ns < stop) stop = ns;
    }
    res.stop = stop; res.R = d * (H.c[H.n - 1] - e.entry) / risk; res.price = H.c[H.n - 1];
    return res;
  }
  const fmt = (x, d) => (x == null || isNaN(x)) ? '-' : Number(x).toFixed(d);
  const fmtP = p => Math.abs(p) >= 1000 ? p.toFixed(2) : Math.abs(p) >= 10 ? p.toFixed(3) : Math.abs(p) >= 1 ? p.toFixed(4) : p.toPrecision(4);
  const fmtM = x => x >= 1e9 ? (x / 1e9).toFixed(1) + 'B$' : x >= 1e6 ? (x / 1e6).toFixed(1) + 'M$' : (x / 1e3).toFixed(0) + 'K$';
  return { P0, run, outcome, prep, dTrend, checklist, lastClosed, signalBacktest, sigStats, sigPortfolio };
})();
if (typeof module !== 'undefined') module.exports = Scan;
