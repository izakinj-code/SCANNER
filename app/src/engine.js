/* =====================================================================
   SCANNER ENGINE v1  —  multi-timeframe (1day / 4hour / 15min)
   Pure functions, no DOM. Used by the app for live scan + backtest.
   Row format from ScannerData.js : [ts, open, high, low, close, volume, turnover]
   ===================================================================== */
const Engine = (() => {

  const DEFAULTS = {
    // --- Daily trend
    dEmaFast: 20, dEmaSlow: 50, dSlopeBars: 5, dSlopeMin: 0.05,
    // --- Daily levels & channel
    pivotLR: 3, levelLookback: 150, levelClusterAtr: 0.6, levelMaxDistAtr: 4,
    chanLen: 60,
    // --- 4H location
    h4ZoneAtr: 1.2, h4TouchBars: 6, h4ChanLow: 0.25, h4ChanHigh: 0.75,
    // --- Volume
    volSma: 20, volFast: 10, volSlow: 30, rvolMin: 1.2,
    // --- 15m trigger
    m15Ema: 20, m15BreakBars: 3, m15SetupBars: 16,
    // --- Risk
    slAtr4h: 0.5, maxRiskPct: 6, minRR: 2, maxRR: 4, maxTradeBars: 288, feePct: 0.1, cooldownBars: 4,
    // --- Filter
    minScore: 60, allowCounter: false, enableLong: true, enableShort: true,
    // --- strategy selector + trend strategy params
    strategy: 'trend', trN: 40, trK: 3, trWin: 24, trTouchAtr: 0.25, trFailAtr: 1.5, trPartialR: 0,
    // --- v1.1 improvements (0 / false = off)
    zoneLockDays: 4,      // after a SL, block same-direction entries in that price band for N days
    partialR: 0,          // close 50% at this R and move SL to entry (0 = off)
    requireConfirm: false // 4H confirmation candle is mandatory
  };

  const TF_SEC = { '1day': 86400, '4hour': 14400, '15min': 900 };

  /* ------------------------------------------------------------ math */
  function ema(src, n) {
    const out = new Array(src.length).fill(NaN);
    if (src.length < n) return out;
    let s = 0;
    for (let i = 0; i < n; i++) s += src[i];
    out[n - 1] = s / n;
    const k = 2 / (n + 1);
    for (let i = n; i < src.length; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
    return out;
  }
  function sma(src, n) {
    const out = new Array(src.length).fill(NaN);
    let s = 0;
    for (let i = 0; i < src.length; i++) {
      s += src[i];
      if (i >= n) s -= src[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }
  function atr(h, l, c, n) {
    const out = new Array(c.length).fill(NaN);
    if (c.length <= n) return out;
    const tr = c.map((_, i) => i === 0 ? h[0] - l[0] :
      Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    let s = 0;
    for (let i = 1; i <= n; i++) s += tr[i];
    out[n] = s / n;
    for (let i = n + 1; i < c.length; i++) out[i] = (out[i - 1] * (n - 1) + tr[i]) / n;
    return out;
  }
  function linreg(ys) { // x = 0..n-1
    const n = ys.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
    const d = n * sxx - sx * sx;
    const slope = d === 0 ? 0 : (n * sxy - sx * sy) / d;
    return { slope, intercept: (sy - slope * sx) / n };
  }

  /* ------------------------------------------------------- prepare */
  function prepSeries(rows, P) {
    const S = { t: [], o: [], h: [], l: [], c: [], v: [], q: [] };
    for (const r of rows) {
      S.t.push(r[0]); S.o.push(r[1]); S.h.push(r[2]); S.l.push(r[3]);
      S.c.push(r[4]); S.v.push(r[5]); S.q.push(r[6] || r[5] * r[4]);
    }
    S.n = S.t.length;
    S.atr = atr(S.h, S.l, S.c, 14);
    S.qSma = sma(S.q, P.volSma);
    S.qFast = sma(S.q, P.volFast);
    S.qSlow = sma(S.q, P.volSlow);
    const obv = [0];
    for (let i = 1; i < S.n; i++) obv.push(obv[i - 1] + (S.c[i] > S.c[i - 1] ? S.q[i] : S.c[i] < S.c[i - 1] ? -S.q[i] : 0));
    S.obv = obv;
    // pivots (confirmed R bars later)
    const R = P.pivotLR;
    S.ph = new Array(S.n).fill(false); S.pl = new Array(S.n).fill(false);
    for (let j = R; j < S.n - R; j++) {
      let isH = true, isL = true;
      for (let k = j - R; k <= j + R; k++) {
        if (k === j) continue;
        if (k < j ? S.h[k] >= S.h[j] : S.h[k] > S.h[j]) isH = false;
        if (k < j ? S.l[k] <= S.l[j] : S.l[k] < S.l[j]) isL = false;
      }
      S.ph[j] = isH; S.pl[j] = isL;
    }
    return S;
  }

  function prepare(symbolData, params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    for (const tf of ['1day', '4hour', '15min'])
      if (!symbolData[tf] || symbolData[tf].length < 30) throw new Error('دیتای کافی برای ' + tf + ' نیست');
    const D = prepSeries(symbolData['1day'], P);
    const H = prepSeries(symbolData['4hour'], P);
    const M = prepSeries(symbolData['15min'], P);
    D.emaF = ema(D.c, P.dEmaFast); D.emaS = ema(D.c, P.dEmaSlow);
    H.ema = ema(H.c, 20);
    M.ema = ema(M.c, P.m15Ema);
    return { P, D, H, M, cacheD: new Map(), cacheH: new Map() };
  }

  // last index whose candle is CLOSED at time T
  function lastClosed(S, sec, T) {
    let lo = 0, hi = S.n - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (S.t[mid] + sec <= T) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /* ------------------------------------------------ STAGE 1+2 daily */
  function analyzeDaily(ctx, i) {
    if (ctx.cacheD.has(i)) return ctx.cacheD.get(i);
    const { P, D } = ctx, R = P.pivotLR;
    const res = { i, ok: false };
    const need = Math.max(P.dEmaSlow, P.chanLen, 20);
    if (i < need) { res.reason = 'دیتای روزانه برای گرم شدن اندیکاتورها کافی نیست (' + (i + 1) + '/' + (need + 1) + ')'; ctx.cacheD.set(i, res); return res; }

    const c = D.c[i], a = D.atr[i], ef = D.emaF[i], es = D.emaS[i];
    const slope = (ef - D.emaF[i - P.dSlopeBars]) / a;
    // confirmed pivots
    const PH = [], PL = [];
    for (let j = Math.max(0, i - P.levelLookback); j <= i - R; j++) {
      if (D.ph[j]) PH.push({ j, p: D.h[j] });
      if (D.pl[j]) PL.push({ j, p: D.l[j] });
    }
    let hh = null, hl = null;
    if (PH.length >= 2) hh = PH[PH.length - 1].p > PH[PH.length - 2].p;
    if (PL.length >= 2) hl = PL[PL.length - 1].p > PL[PL.length - 2].p;

    let bull = 0, bear = 0;
    if (c > ef) bull++; else bear++;
    if (ef > es) bull++; else bear++;
    if (slope > P.dSlopeMin) bull++; else if (slope < -P.dSlopeMin) bear++;
    if (hh === true && hl === true) bull++; else if (hh === false && hl === false) bear++;
    let trend = 'RANGE';
    if (bull >= 3 && bull > bear) trend = 'BULL';
    else if (bear >= 3 && bear > bull) trend = 'BEAR';
    res.trend = { dir: trend, bull, bear, slope, ema: [ef, es], hh, hl, strength: Math.max(bull, bear) / 4 };

    // ---- level zones (cluster pivots)
    const cand = PH.map(x => ({ p: x.p, j: x.j, k: 'H' })).concat(PL.map(x => ({ p: x.p, j: x.j, k: 'L' })))
      .sort((x, y) => x.p - y.p);
    const tol = P.levelClusterAtr * a;
    const zones = [];
    for (const x of cand) {
      const z = zones[zones.length - 1];
      if (z && x.p - z.hi <= tol) { z.hi = Math.max(z.hi, x.p); z.touches++; z.last = Math.max(z.last, x.j); z.pts.push(x); }
      else zones.push({ lo: x.p, hi: x.p, touches: 1, last: x.j, pts: [x] });
    }
    for (const z of zones) {
      const minW = 0.25 * a;
      if (z.hi - z.lo < minW) { const m = (z.hi + z.lo) / 2; z.lo = m - minW / 2; z.hi = m + minW / 2; }
      z.mid = (z.lo + z.hi) / 2;
      z.dist = (z.mid - c) / a;
      z.near = Math.abs(z.dist) <= P.levelMaxDistAtr;
      delete z.pts;
    }
    res.zones = zones;

    // ---- regression channel on closes
    const L = P.chanLen, ys = D.c.slice(i - L + 1, i + 1);
    const lr = linreg(ys);
    let up = -Infinity, dn = Infinity;
    for (let x = 0; x < L; x++) {
      const base = lr.intercept + lr.slope * x;
      up = Math.max(up, D.h[i - L + 1 + x] - base);
      dn = Math.min(dn, D.l[i - L + 1 + x] - base);
    }
    res.chan = {
      startIdx: i - L + 1, endIdx: i, slope: lr.slope, intercept: lr.intercept, up, dn,
      slopePctDay: lr.slope / c * 100,
      at(x) { const b = this.intercept + this.slope * x; return { upper: b + this.up, lower: b + this.dn, mid: b }; }
    };
    res.atr = a; res.close = c; res.ok = true;
    ctx.cacheD.set(i, res);
    return res;
  }

  /* ------------------------------------------- STAGE 3+4 4h location */
  function analyze4h(ctx, k, d) {
    const key = k;
    if (ctx.cacheH.has(key)) return ctx.cacheH.get(key);
    const { P, H } = ctx;
    const res = { k, ok: false };
    if (k < Math.max(P.volSlow, 25)) { res.reason = 'دیتای ۴ساعته کافی نیست'; ctx.cacheH.set(key, res); return res; }
    const c = H.c[k], a = H.atr[k];

    // daily channel position using 4h close (extrapolate channel by fraction of day)
    const dayFrac = (H.t[k] + 14400 - (ctx.D.t[d.i] + 86400)) / 86400;
    const ch = d.chan.at(d.chan.endIdx - d.chan.startIdx + dayFrac);
    const chanPos = (c - ch.lower) / (ch.upper - ch.lower);

    const near = d.zones.filter(z => z.near);
    // support: zone whose low is below price; take the highest
    const sup = near.filter(z => z.lo <= c).sort((x, y) => y.hi - x.hi)[0] || null;
    const resZ = near.filter(z => z.hi >= c).sort((x, y) => x.lo - y.lo)[0] || null;

    const from = Math.max(0, k - P.h4TouchBars + 1);
    let minL = Infinity, maxH = -Infinity;
    for (let x = from; x <= k; x++) { minL = Math.min(minL, H.l[x]); maxH = Math.max(maxH, H.h[x]); }

    const long = { zone: sup, viaZone: false, viaChan: false, dist: null, touched: false };
    if (sup) {
      long.dist = Math.max(0, c - sup.hi) / a;
      long.touched = minL <= sup.hi + 0.25 * a;
      long.broken = c < sup.lo - 0.25 * a;
      long.viaZone = long.dist <= P.h4ZoneAtr && long.touched && !long.broken;
    }
    long.viaChan = chanPos <= P.h4ChanLow && chanPos > -0.15;
    long.ok = long.viaZone || long.viaChan;

    const short = { zone: resZ, viaZone: false, viaChan: false, dist: null, touched: false };
    if (resZ) {
      short.dist = Math.max(0, resZ.lo - c) / a;
      short.touched = maxH >= resZ.lo - 0.25 * a;
      short.broken = c > resZ.hi + 0.25 * a;
      short.viaZone = short.dist <= P.h4ZoneAtr && short.touched && !short.broken;
    }
    short.viaChan = chanPos >= P.h4ChanHigh && chanPos < 1.15;
    short.ok = short.viaZone || short.viaChan;

    // 4h confirmation candle
    const o = H.o[k], hi = H.h[k], lo = H.l[k], rng = Math.max(hi - lo, 1e-12);
    const po = H.o[k - 1], pc = H.c[k - 1];
    const lowWick = (Math.min(o, c) - lo) / rng, upWick = (hi - Math.max(o, c)) / rng;
    long.confirm = (lowWick >= 0.4 && c > (hi + lo) / 2) ? 'پین‌بار صعودی' :
      (c > o && pc < po && c >= po && o <= pc) ? 'اینگالفینگ صعودی' :
        (c > H.ema[k] && pc <= H.ema[k - 1]) ? 'عبور از EMA20' : null;
    short.confirm = (upWick >= 0.4 && c < (hi + lo) / 2) ? 'پین‌بار نزولی' :
      (c < o && pc > po && c <= po && o >= pc) ? 'اینگالفینگ نزولی' :
        (c < H.ema[k] && pc >= H.ema[k - 1]) ? 'شکست EMA20 به پایین' : null;

    // volume (turnover)
    let g = 0, r = 0;
    for (let x = Math.max(0, k - 19); x <= k; x++) { if (H.c[x] >= H.o[x]) g += H.q[x]; else r += H.q[x]; }
    const obvSeg = H.obv.slice(Math.max(0, k - 19), k + 1);
    const obvSlope = linreg(obvSeg).slope / (H.qSma[k] || 1);
    res.vol = { trend: H.qFast[k] / H.qSlow[k], balance: r > 0 ? g / r : 9, obvSlope };

    Object.assign(res, { ok: true, close: c, atr: a, chanPos, chanLine: ch, long, short });
    ctx.cacheH.set(key, res);
    return res;
  }

  function volScore(v, dir) {
    let s = 0;
    if (v.trend > 1) s += 0.3;
    if (dir === 'LONG') { if (v.balance > 1) s += 0.35; if (v.obvSlope > 0) s += 0.35; }
    else { if (v.balance < 1) s += 0.35; if (v.obvSlope < 0) s += 0.35; }
    return s;
  }

  /* ------------------------------------------------ STAGE 5 trigger */
  function trigger15(ctx, m, h4, d, dir) {
    const { P, M } = ctx;
    const side = dir === 'LONG' ? h4.long : h4.short;
    const out = { ok: false, checks: {} };
    if (m < Math.max(P.m15SetupBars, P.volSma) + 2) return out;
    const c = M.c[m], o = M.o[m];
    let minL = Infinity, maxH = -Infinity;
    for (let x = m - P.m15SetupBars + 1; x <= m; x++) { minL = Math.min(minL, M.l[x]); maxH = Math.max(maxH, M.h[x]); }
    let brk = dir === 'LONG' ? -Infinity : Infinity;
    for (let x = m - P.m15BreakBars; x < m; x++) brk = dir === 'LONG' ? Math.max(brk, M.h[x]) : Math.min(brk, M.l[x]);
    const rvol = M.q[m] / (M.qSma[m - 1] || 1);
    const pc = M.c[m - 1], po = M.o[m - 1];
    const a4 = h4.atr;

    // reference line for the pullback (zone edge or channel line)
    let ref;
    if (dir === 'LONG') ref = side.viaZone ? side.zone.hi : h4.chanLine.lower + 0.25 * (h4.chanLine.upper - h4.chanLine.lower);
    else ref = side.viaZone ? side.zone.lo : h4.chanLine.upper - 0.25 * (h4.chanLine.upper - h4.chanLine.lower);

    const ck = out.checks;
    if (dir === 'LONG') {
      ck.pullback = minL <= ref + 0.25 * a4;
      ck.breakout = c > brk;
      ck.ema = c > M.ema[m];
      ck.pattern = (c > o && pc < po && c >= po && o <= pc) ? 'اینگالفینگ' :
        ((Math.min(o, c) - M.l[m]) / Math.max(M.h[m] - M.l[m], 1e-12) >= 0.5 && c > o) ? 'چکش' : null;
    } else {
      ck.pullback = maxH >= ref - 0.25 * a4;
      ck.breakout = c < brk;
      ck.ema = c < M.ema[m];
      ck.pattern = (c < o && pc > po && c <= po && o >= pc) ? 'اینگالفینگ' :
        ((M.h[m] - Math.max(o, c)) / Math.max(M.h[m] - M.l[m], 1e-12) >= 0.5 && c < o) ? 'ستاره دنباله‌دار' : null;
    }
    ck.rvol = rvol;
    ck.breakLevel = brk; ck.emaVal = M.ema[m]; ck.ref = ref;
    ck.rvolOk = rvol >= P.rvolMin;
    out.ok = ck.pullback && ck.breakout && ck.ema && ck.rvolOk;

    // ---- risk plan
    const entry = c;
    let sl, tp1 = null, tp2 = null, tpFromLevel = false;
    const above = d.zones.filter(z => z.lo > entry).sort((x, y) => x.lo - y.lo);
    const below = d.zones.filter(z => z.hi < entry).sort((x, y) => y.hi - x.hi);
    if (dir === 'LONG') {
      const base = side.viaZone ? Math.min(minL, side.zone.lo) : minL;
      sl = base - P.slAtr4h * a4;
      const risk = entry - sl;
      const tgt = above.filter(z => z.lo - entry >= 0.5 * risk);
      if (tgt[0]) { tp1 = tgt[0].lo; tpFromLevel = true; }
      if (tgt[1]) tp2 = tgt[1].lo;
      if (!tp1) tp1 = entry + P.minRR * risk;
      if (!tp2) tp2 = Math.max(tp1, entry + 3 * risk);
    } else {
      const base = side.viaZone ? Math.max(maxH, side.zone.hi) : maxH;
      sl = base + P.slAtr4h * a4;
      const risk = sl - entry;
      const tgt = below.filter(z => entry - z.hi >= 0.5 * risk);
      if (tgt[0]) { tp1 = tgt[0].hi; tpFromLevel = true; }
      if (tgt[1]) tp2 = tgt[1].hi;
      if (!tp1) tp1 = entry - P.minRR * risk;
      if (!tp2) tp2 = Math.min(tp1, entry - 3 * risk);
    }
    const risk = Math.abs(entry - sl);
    if (Math.abs(tp1 - entry) / risk > P.maxRR) { tp1 = entry + Math.sign(tp1 - entry) * P.maxRR * risk; tpFromLevel = false; }
    const rr = Math.abs(tp1 - entry) / risk;
    const riskPct = risk / entry * 100;
    out.plan = { entry, sl, tp1, tp2, rr, riskPct, tpFromLevel };
    ck.rrOk = rr >= P.minRR - 1e-9;
    ck.riskOk = riskPct <= P.maxRiskPct && risk > 0;
    out.ok = out.ok && ck.rrOk && ck.riskOk;
    return out;
  }

  /* --------------------------------------------- full evaluation */
  // evaluates at 15m bar m (closed). Returns stage report + signal
  function evaluateAt(ctx, m) {
    const { P, D, H, M } = ctx;
    const T = M.t[m] + 900;
    const i = lastClosed(D, 86400, T), k = lastClosed(H, 14400, T);
    const rep = { time: T, m, i, k, price: M.c[m], stages: [], signal: null, setups: [] };
    if (i < 0 || k < 0) { rep.error = 'دیتای روزانه/۴ساعته قبل از این زمان وجود ندارد'; return rep; }
    const d = analyzeDaily(ctx, i);
    rep.daily = d;
    if (!d.ok) { rep.error = d.reason; return rep; }
    const h4 = analyze4h(ctx, k, d);
    rep.h4 = h4;
    if (!h4.ok) { rep.error = h4.reason; return rep; }

    const dirs = [];
    const tr = d.trend.dir;
    if (P.enableLong && (tr === 'BULL' || tr === 'RANGE' || P.allowCounter)) dirs.push('LONG');
    if (P.enableShort && (tr === 'BEAR' || tr === 'RANGE' || P.allowCounter)) dirs.push('SHORT');

    for (const dir of dirs) {
      const side = dir === 'LONG' ? h4.long : h4.short;
      const locOk = side.ok && (!P.requireConfirm || !!side.confirm);
      const s = { dir, location: locOk, side };
      if (locOk) {
        const trg = trigger15(ctx, m, h4, d, dir);
        s.trigger = trg;
        // score
        const aligned = (dir === 'LONG' && tr === 'BULL') || (dir === 'SHORT' && tr === 'BEAR');
        const sc = {};
        sc.trend = aligned ? Math.round(25 * d.trend.strength) : (tr === 'RANGE' ? 12 : 5);
        sc.location = Math.min(25, (side.viaZone ? 15 + Math.min(10, (side.zone.touches - 1) * 4) : 0) + (side.viaChan ? (side.viaZone ? 5 : 14) : 0));
        sc.confirm = side.confirm ? (side.confirm.includes('EMA') ? 10 : 15) : 0;
        const vs = volScore(h4.vol, dir);
        sc.volume = Math.round(14 * vs + 6 * Math.min(1, Math.max(0, (trg.checks.rvol || 0) - 1)));
        sc.trigger = trg.ok ? (10 + (trg.checks.pattern ? 5 : 0)) : 0;
        s.score = sc;
        s.total = sc.trend + sc.location + sc.confirm + sc.volume + sc.trigger;
        if (trg.ok && s.total >= P.minScore) {
          rep.signal = rep.signal && rep.signal.total >= s.total ? rep.signal : Object.assign({ dir, total: s.total, score: sc, time: T }, trg.plan, { pattern: trg.checks.pattern, rvol: trg.checks.rvol });
        }
      }
      rep.setups.push(s);
    }
    rep.dirs = dirs;
    return rep;
  }

  /* --------------------------------------------------- backtest */
  function backtest(ctx, opts = {}) {
    const { P, M } = ctx;
    const trades = [], locks = [];
    let open = null, cool = 0;
    const startM = Math.max(P.m15SetupBars + P.volSma + 2, 0);
    const fromTs = opts.fromTs || 0;
    const fee = P.feePct / 100;
    for (let m = startM; m < M.n; m++) {
      if (M.t[m] < fromTs) continue;
      if (open) {
        const isL = open.dir === 'LONG', risk = open.risk;
        const fav = (isL ? M.h[m] - open.entry : open.entry - M.l[m]) / risk;
        open.mfe = Math.max(open.mfe, fav);
        let exit = null, why = null;
        if (isL ? M.l[m] <= open.stop : M.h[m] >= open.stop) { exit = open.stop; why = open.partialDone ? 'BE' : 'SL'; }
        else {
          if (P.partialR > 0 && !open.partialDone && fav >= P.partialR) {
            open.partialDone = true;
            open.partialR = P.partialR - fee * (open.entry + (isL ? open.entry + P.partialR * risk : open.entry - P.partialR * risk)) / risk;
            open.stop = open.entry;            // move to break-even
            open.partialPrice = isL ? open.entry + P.partialR * risk : open.entry - P.partialR * risk;
          }
          if (isL ? M.h[m] >= open.tp1 : M.l[m] <= open.tp1) { exit = open.tp1; why = 'TP'; }
          else if (m - open.m >= P.maxTradeBars) { exit = M.c[m]; why = 'TIME'; }
        }
        if (exit !== null) {
          const gross = (isL ? exit - open.entry : open.entry - exit) / risk;
          const restR = gross - fee * (open.entry + exit) / risk;
          const R = open.partialDone ? 0.5 * open.partialR + 0.5 * restR : restR;
          Object.assign(open, { exit, exitTime: M.t[m] + 900, why, R, bars: m - open.m, status: 'CLOSED' });
          if (why === 'SL' && P.zoneLockDays > 0) {
            const pad = 0.5 * risk;
            locks.push({ from: M.t[m] + 900, dir: open.dir, lo: Math.min(open.entry, open.sl) - pad, hi: Math.max(open.entry, open.sl) + pad, until: M.t[m] + P.zoneLockDays * 86400 });
          }
          trades.push(open); open = null; cool = P.cooldownBars;
        }
        continue;
      }
      if (cool > 0) { cool--; continue; }
      const rep = evaluateAt(ctx, m);
      if (rep.signal) {
        const sg = rep.signal, now = M.t[m];
        const locked = locks.some(l => l.dir === sg.dir && now < l.until && sg.entry >= l.lo && sg.entry <= l.hi);
        if (locked) continue;
        open = Object.assign({}, sg, { m, entryTime: rep.time, status: 'OPEN', stop: sg.sl, risk: Math.abs(sg.entry - sg.sl), mfe: 0, partialDone: false });
      }
    }
    if (open) { open.R = null; trades.push(open); }
    return { trades, stats: stats(trades), locks };
  }

  function stats(trades) {
    const closed = trades.filter(t => t.status === 'CLOSED');
    const wins = closed.filter(t => t.R > 0.01);
    let eq = 0, peak = 0, dd = 0;
    const curve = [];
    for (const t of closed) { eq += t.R; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); curve.push({ t: t.exitTime, eq }); }
    const pos = closed.filter(t => t.R > 0).reduce((s, t) => s + t.R, 0);
    const neg = -closed.filter(t => t.R < 0).reduce((s, t) => s + t.R, 0);
    return {
      n: closed.length, open: trades.length - closed.length,
      wins: wins.length, winRate: closed.length ? wins.length / closed.length * 100 : 0,
      totalR: eq, avgR: closed.length ? eq / closed.length : 0,
      pf: neg > 0 ? pos / neg : (pos > 0 ? Infinity : 0), maxDD: dd,
      longs: closed.filter(t => t.dir === 'LONG').length, shorts: closed.filter(t => t.dir === 'SHORT').length,
      avgBars: closed.length ? closed.reduce((s, t) => s + t.bars, 0) / closed.length : 0,
      curve,
    };
  }


  /* ============== PORTFOLIO SIMULATION (money management, fees) ==============
     list: [{ sym, trades, lastPrice, lastTime }]  — trades from backtest() per symbol
  */
  const PORT_DEFAULTS = { capital: 100, riskPct: 0.75, mode: 'futures', leverage: 3, maxOpen: 6, maxSameDir: 6,
    takerFee: 0.06, makerFee: 0.02, slipPct: 0.05, fundingPct8h: 0.01, minNotional: 5 };

  function portfolio(list, opt) {
    const O = Object.assign({}, PORT_DEFAULTS, opt || {});
    const tk = O.takerFee / 100, mk = O.makerFee / 100, sl = O.slipPct / 100;
    const all = [];
    for (const it of list) for (const t of it.trades) all.push({ sym: it.sym, t, last: it });
    all.sort((a, b) => a.t.entryTime - b.t.entryTime);
    let cash = O.capital, peak = O.capital, maxDD = 0, maxDDusd = 0, fees = 0, funding = 0;
    const open = [], done = [], skipped = {}, curve = [{ t: all.length ? all[0].t.entryTime : 0, eq: O.capital }];
    const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };

    function realize(p) {
      const t = p.t, d = p.dir;
      let pnl = 0, fee = 0;
      const legs = [];
      if (t.partialDone && t.partialPrice) legs.push({ q: p.qty / 2, px: t.partialPrice, rate: mk });
      const rest = legs.length ? p.qty / 2 : p.qty;
      let px, rate;
      if (t.why === 'TP') { px = t.tp1; rate = mk; }                         // limit order
      else if (t.why === 'SL' || t.why === 'BE') { px = t.exit * (1 - d * sl); rate = tk; } // stop-market, adverse slip
      else { px = t.exit * (1 - d * sl); rate = tk; }                         // time exit, market
      legs.push({ q: rest, px, rate });
      for (const L of legs) { pnl += d * L.q * (L.px - p.entryPx); fee += L.q * L.px * L.rate; }
      const hours = (t.exitTime - t.entryTime) / 3600;
      const fund = O.mode === 'futures' ? p.notional * (O.fundingPct8h / 100) * hours / 8 : 0;
      cash += pnl - fee - fund; fees += fee; funding += fund;
      const net = pnl - fee - fund - p.entryFee;
      done.push(Object.assign(p, { exitPx: px, exitTime: t.exitTime, why: t.why, pnl: net, exitFee: fee, fund, balance: cash }));
      peak = Math.max(peak, cash);
      const ddUsd = peak - cash; maxDDusd = Math.max(maxDDusd, ddUsd); maxDD = Math.max(maxDD, ddUsd / peak * 100);
      curve.push({ t: t.exitTime, eq: cash });
    }
    function closeUntil(ts) {
      open.sort((a, b) => a.t.exitTime - b.t.exitTime);
      while (open.length && open[0].t.status === 'CLOSED' && open[0].t.exitTime <= ts) realize(open.shift());
    }

    for (const a of all) {
      const t = a.t;
      closeUntil(t.entryTime);
      const d = t.dir === 'LONG' ? 1 : -1;
      if (O.mode === 'spot' && d < 0) { skip('اسپات: فروش (Short) ممکن نیست'); continue; }
      if (open.length >= O.maxOpen) { skip('سقف معاملات همزمان'); continue; }
      if (open.filter(p => p.dir === d).length >= O.maxSameDir) { skip('سقف معاملات هم‌جهت'); continue; }
      if (cash <= O.minNotional) { skip('موجودی ناکافی'); continue; }
      const entryPx = t.entry * (1 + d * sl);
      const stopPx = t.sl * (1 - d * sl);
      const perUnit = Math.abs(entryPx - stopPx) + entryPx * tk + stopPx * tk;   // loss per unit incl. fees
      const riskUsd = cash * O.riskPct / 100;
      let qty = riskUsd / perUnit, notional = qty * entryPx, capped = false;
      const used = open.reduce((s, p) => s + p.notional, 0);
      const cap = O.mode === 'spot' ? cash - used : cash * O.leverage - used;
      if (notional > cap) { qty = Math.max(0, cap) / entryPx; notional = qty * entryPx; capped = true; }
      if (notional < O.minNotional) { skip('حجم سفارش کمتر از حداقل (سرمایه درگیر)'); continue; }
      const entryFee = notional * tk;
      cash -= entryFee; fees += entryFee;
      open.push({ sym: a.sym, t, dir: d, entryPx, stopPx, qty, notional, entryFee, riskUsd: qty * perUnit, capped, entryTime: t.entryTime });
    }
    closeUntil(Infinity);
    // still open: mark to market
    let unreal = 0;
    for (const p of open) {
      const lp = p.t.status === 'OPEN' ? lastPriceOf(list, p.sym) : p.t.exit;
      unreal += p.dir * p.qty * (lp - p.entryPx) - p.notional * tk;
    }
    const wins = done.filter(p => p.pnl > 0), losses = done.filter(p => p.pnl <= 0);
    let streak = 0, maxStreak = 0;
    for (const p of done.slice().sort((a, b) => a.exitTime - b.exitTime)) { if (p.pnl <= 0) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0; }
    const months = {};
    let prevEq = O.capital;
    for (const p of done.slice().sort((a, b) => a.exitTime - b.exitTime)) {
      const k = new Date(p.exitTime * 1000).toISOString().slice(0, 7);
      if (!months[k]) months[k] = { start: prevEq, pnl: 0, n: 0 };
      months[k].pnl += p.pnl; months[k].n++; prevEq += p.pnl;
    }
    const grossW = wins.reduce((s, p) => s + p.pnl, 0), grossL = -losses.reduce((s, p) => s + p.pnl, 0);
    return {
      opt: O, final: cash, unreal, openPos: open, retPct: (cash - O.capital) / O.capital * 100, fees, funding, maxDD, maxDDusd,
      taken: done.length, wins: wins.length, winRate: done.length ? wins.length / done.length * 100 : 0,
      avgWin: wins.length ? grossW / wins.length : 0, avgLoss: losses.length ? -grossL / losses.length : 0,
      pf: grossL > 0 ? grossW / grossL : Infinity, maxStreak, skipped, curve, trades: done, months,
    };
  }
  function lastPriceOf(list, sym) { const it = list.find(x => x.sym === sym); return it ? it.lastPrice : 0; }


  /* =====================================================================
     TREND STRATEGY v1  (selected by 2-year research, train/test validated)
     - Daily trend : close > EMA50 and EMA20 > EMA50 (long) / mirror (short)
     - 4H trigger  : 4H close breaks the high/low of the previous N bars
     - 15m entry   : within W 15m bars, price pulls back to the breakout level
                     (± touchAtr×ATR4H) and a 15m candle closes back past EMA20
                     in the trade direction. Fails if price closes beyond
                     level ∓ failAtr×ATR4H or the window expires.
     - Stop        : entry ∓ K×ATR4H, then trailing K×ATR4H on every 4H close
     - No fixed target (trend following)
     ===================================================================== */
  const TREND_DEFAULTS = { trN: 40, trK: 3, trWin: 24, trTouchAtr: 0.25, trFailAtr: 1.5, trPartialR: 0 };

  function prepTrend(ctx) {
    if (ctx.trendReady) return;
    const P = Object.assign({}, TREND_DEFAULTS, ctx.P), { D, H, M } = ctx;
    D.e20 = ema(D.c, 20); D.e50 = ema(D.c, 50);
    M.e20 = ema(M.c, 20);
    const N = P.trN;
    H.dHi = new Array(H.n).fill(NaN); H.dLo = new Array(H.n).fill(NaN);
    for (let i = N; i < H.n; i++) { let hh = -Infinity, ll = Infinity; for (let x = i - N; x < i; x++) { if (H.h[x] > hh) hh = H.h[x]; if (H.l[x] < ll) ll = H.l[x]; } H.dHi[i] = hh; H.dLo[i] = ll; }
    H.di = new Array(H.n); let j = -1;
    for (let i = 0; i < H.n; i++) { const T = H.t[i] + 14400; while (j + 1 < D.n && D.t[j + 1] + 86400 <= T) j++; H.di[i] = j; }
    ctx.TP = P; ctx.trendReady = true;
  }
  function dTrendAt(ctx, j) {
    const D = ctx.D; if (j < 50) return 0;
    if (D.c[j] > D.e50[j] && D.e20[j] > D.e50[j]) return 1;
    if (D.c[j] < D.e50[j] && D.e20[j] < D.e50[j]) return -1;
    return 0;
  }
  function first15At(M, ts) { let lo = 0, hi = M.n - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (M.t[m] >= ts) { a = m; hi = m - 1; } else lo = m + 1; } return a; }

  // full simulation up to time `until` (unix sec, candle close time). Returns trades + live state.
  function backtestTrend(ctx, opts = {}) {
    prepTrend(ctx);
    const P = ctx.TP, { D, H, M } = ctx, until = opts.until || Infinity;
    const trades = [];
    let pos = null, pend = null;
    const closeTrade = (ex, t, why) => {
      const d = pos.dir === 'LONG' ? 1 : -1;
      const restR = d * (ex - pos.entry) / Math.abs(pos.entry - pos.sl);
      if (pos.partialDone && why === 'SL') why = 'BE';
      Object.assign(pos, { exit: ex, exitTime: t, why, R: pos.partialDone ? 0.5 * P.trPartialR + 0.5 * restR : restR, status: 'CLOSED', tp1: ex,
        bars: Math.round((t - pos.entryTime) / 900) });
      trades.push(pos); pos = null;
    };
    const tryPartial = (hi, lo) => {
      if (!pos || !(P.trPartialR > 0) || pos.partialDone) return;
      const L = pos.dir === 'LONG', r = Math.abs(pos.entry - pos.sl), tgt = L ? pos.entry + P.trPartialR * r : pos.entry - P.trPartialR * r;
      if (L ? hi >= tgt : lo <= tgt) { pos.partialDone = true; pos.partialPrice = tgt; if (L ? pos.stop < pos.entry : pos.stop > pos.entry) pos.stop = pos.entry; }
    };
    // process 15m bars [m0, m1) for pending entry / stop hits. returns nothing
    const run15 = (m0, tEnd) => {
      for (let m = m0; m >= 0 && m < M.n && M.t[m] < tEnd && M.t[m] + 900 <= until; m++) {
        if (pos) {
          const L = pos.dir === 'LONG';
          if (L ? M.l[m] <= pos.stop : M.h[m] >= pos.stop) { closeTrade(L ? Math.min(pos.stop, M.o[m]) : Math.max(pos.stop, M.o[m]), M.t[m] + 900, pos.trailed ? 'TRAIL' : 'SL'); }
          else tryPartial(M.h[m], M.l[m]);
          continue;
        }
        if (!pend) continue;
        if (M.t[m] + 900 > pend.expire) { pend.status = 'EXPIRED'; pend = null; continue; }
        const L = pend.dir === 'LONG';
        if (!pend.touched && (L ? M.l[m] <= pend.level + P.trTouchAtr * pend.atr : M.h[m] >= pend.level - P.trTouchAtr * pend.atr)) pend.touched = M.t[m] + 900;
        if (L ? M.c[m] < pend.level - P.trFailAtr * pend.atr : M.c[m] > pend.level + P.trFailAtr * pend.atr) { pend.status = 'FAILED'; pend = null; continue; }
        if (pend.touched && (L ? M.c[m] > M.e20[m] && M.c[m] > M.o[m] : M.c[m] < M.e20[m] && M.c[m] < M.o[m])) {
          const entry = M.c[m], stop = L ? entry - P.trK * pend.atr : entry + P.trK * pend.atr;
          pos = { dir: pend.dir, entry, sl: stop, stop, entryTime: M.t[m] + 900, level: pend.level, breakTime: pend.time, trailed: false, status: 'OPEN', R: null, total: '-', rr: null, tp1: null, partialDone: false };
          pend = null;
        }
      }
    };
    let lastI = -1;
    for (let i = Math.max(P.trN, 60); i < H.n; i++) {
      const barEnd = H.t[i] + 14400;
      if (barEnd > until) break;
      lastI = i;
      // 15m bars inside this 4H bar: pending entries + stop hits after entry
      if ((pend || pos) && M.n) {
        const a = first15At(M, H.t[i]);
        const posBefore = pos;
        if (a >= 0) run15(a, barEnd);
        if (pos && pos === posBefore) {
          // position existed before this bar: stop already checked on 15m inside run15
        }
      } else if (pos) {
        const L = pos.dir === 'LONG';
        if (L ? H.l[i] <= pos.stop : H.h[i] >= pos.stop) closeTrade(L ? Math.min(pos.stop, H.o[i]) : Math.max(pos.stop, H.o[i]), barEnd, pos.trailed ? 'TRAIL' : 'SL');
        else tryPartial(H.h[i], H.l[i]);
      }
      // trailing on 4H close
      if (pos) {
        const L = pos.dir === 'LONG', ns = L ? H.c[i] - P.trK * H.atr[i] : H.c[i] + P.trK * H.atr[i];
        if (L ? ns > pos.stop : ns < pos.stop) { pos.stop = ns; pos.trailed = true; }
        continue;
      }
      if (pend) continue;
      // new 4H breakout signal
      const j = H.di[i], tr = dTrendAt(ctx, j);
      if (tr > 0 && H.c[i] > H.dHi[i]) pend = { dir: 'LONG', level: H.dHi[i], atr: H.atr[i], time: barEnd, expire: barEnd + P.trWin * 900, touched: 0, status: 'PENDING' };
      else if (tr < 0 && H.c[i] < H.dLo[i]) pend = { dir: 'SHORT', level: H.dLo[i], atr: H.atr[i], time: barEnd, expire: barEnd + P.trWin * 900, touched: 0, status: 'PENDING' };
      if (pend && (!M.n || M.t[0] > barEnd)) pend = null;     // no 15m data for this period
    }
    // tail: 15m bars after the last closed 4H bar (current forming 4H bar)
    if (lastI >= 0 && M.n && (pend || pos)) { const a = first15At(M, H.t[lastI] + 14400); if (a >= 0) run15(a, Infinity); }
    if (pos) trades.push(pos);
    return { trades, stats: stats(trades), pending: pend, lastI, locks: [] };
  }

  // live state for the report at time `until` (default: last 15m close)
  function evaluateTrend(ctx, until, btPre) {
    prepTrend(ctx);
    const { D, H, M } = ctx, P = ctx.TP;
    const T = until || (M.n ? M.t[M.n - 1] + 900 : H.t[H.n - 1] + 14400);
    const bt = btPre && !until ? btPre : backtestTrend(ctx, { until: T });
    const i = bt.lastI;
    if (i < 0) return { error: 'دیتای ۴ساعته کافی نیست' };
    const j = H.di[i], trd = dTrendAt(ctx, j);
    // level for the NEXT 4H bar = high/low of last N closed bars (incl. bar i)
    let hh = -Infinity, ll = Infinity; for (let x = i - P.trN + 1; x <= i; x++) { hh = Math.max(hh, H.h[x]); ll = Math.min(ll, H.l[x]); }
    const mIdx = M.n ? Math.max(0, first15At(M, T) < 0 ? M.n - 1 : first15At(M, T) - 1) : -1;
    const price = mIdx >= 0 ? M.c[mIdx] : H.c[i];
    const last = bt.trades[bt.trades.length - 1];
    const open = last && last.status === 'OPEN' ? last : null;
    const fresh = open && T - open.entryTime <= 900 ? open : null;           // entry on the very last 15m close
    return { time: T, price, i, j, m: mIdx, trend: trd, daily: { c: D.c[j], e20: D.e20[j], e50: D.e50[j] },
      h4: { close: H.c[i], atr: H.atr[i], hi: hh, lo: ll, barTime: H.t[i] + 14400 },
      pending: bt.pending, open, signal: fresh, bt };
  }


  /* =====================================================================
     WEEKLY LOW-VOLATILITY (book §3.3, market-neutral)
     Every week (decision at the close of the daily candle of weekday `day`, UTC):
       long the k lowest-volatility coins, short the k highest (V-day realized vol),
       50% of gross capital each side, equal weights. Hold 7 days.
     ===================================================================== */
  const LV_DEFAULTS = { lvV: 30, lvK: 3, lvDay: 0, lvGross: 1 };   // lvDay: 0 = Sunday candle (closes Mon 00:00 UTC)
  function lowVolAligned(symbols) {
    const syms = Object.keys(symbols).filter(s => symbols[s]['1day'] && symbols[s]['1day'].length > 40);
    const tset = new Set(); for (const s of syms) for (const r of symbols[s]['1day']) tset.add(r[0]);
    const T = [...tset].sort((a, b) => a - b);
    const C = {}; for (const s of syms) { const m = new Map(symbols[s]['1day'].map(r => [r[0], r[4]])); C[s] = T.map(t => m.has(t) ? m.get(t) : NaN); }
    return { syms, T, C };
  }
  function lowVolPick(A, i, P) {
    const ret = (s, j) => A.C[s][j] / A.C[s][j - 1] - 1;
    const vol = [];
    for (const s of A.syms) { let a = 0, n = 0; for (let j = i - P.lvV + 1; j <= i; j++) { const r = ret(s, j); if (isFinite(r)) { a += r * r; n++; } } if (n >= P.lvV * 0.8) vol.push({ s, v: Math.sqrt(a / n) * Math.sqrt(365) * 100 }); }
    vol.sort((x, y) => x.v - y.v);
    if (vol.length < 2 * P.lvK) return null;
    const w = {}; vol.slice(0, P.lvK).forEach(x => w[x.s] = 0.5 * P.lvGross / P.lvK); vol.slice(-P.lvK).forEach(x => w[x.s] = -0.5 * P.lvGross / P.lvK);
    return { w, vol };
  }
  function lowVolBacktest(symbols, opts = {}) {
    const P = Object.assign({}, LV_DEFAULTS, opts), fee = (opts.takerFee ?? 0.06) / 100, fund = (opts.fundingPct8h ?? 0.01) / 100;
    const A = lowVolAligned(symbols), weeks = [];
    let eq = 1, pk = 1, dd = 0, prev = {};
    for (let i = P.lvV + 1; i < A.T.length; i++) {
      if (new Date(A.T[i] * 1000).getUTCDay() !== P.lvDay) continue;
      const pick = lowVolPick(A, i, P); if (!pick) continue;
      const end = Math.min(i + 7, A.T.length - 1), done = i + 7 <= A.T.length - 1;
      let r = 0, turn = 0, gross = 0; const legs = [];
      for (const s of A.syms) {
        const wi = pick.w[s] || 0; turn += Math.abs(wi - (prev[s] || 0)); gross += Math.abs(wi);
        if (wi) { const rr = A.C[s][end] / A.C[s][i] - 1; r += wi * rr; legs.push({ s, w: wi, entry: A.C[s][i], exit: A.C[s][end], ret: rr * 100 * Math.sign(wi) }); }
      }
      const cost = turn * fee + gross * fund * 3 * (end - i);
      r -= cost; prev = pick.w;
      if (done) { eq *= 1 + r; pk = Math.max(pk, eq); dd = Math.max(dd, (pk - eq) / pk * 100); }
      weeks.push({ t: A.T[i] + 86400, tEnd: A.T[end] + 86400, ret: r * 100, cost: cost * 100, legs, vol: pick.vol, done, eq });
    }
    const dn = weeks.filter(w => w.done);
    return { weeks, eq, ret: (eq - 1) * 100, maxDD: dd, win: dn.length ? dn.filter(w => w.ret > 0).length / dn.length * 100 : 0, n: dn.length,
      costs: dn.reduce((a, w) => a + w.cost, 0), P, A };
  }
  function lowVolNow(symbols, opts = {}) {
    const P = Object.assign({}, LV_DEFAULTS, opts), A = lowVolAligned(symbols);
    const i = A.T.length - 1, pick = lowVolPick(A, i, P);
    // next decision: next candle close whose candle weekday == lvDay
    const lastClose = A.T[i] + 86400; let next = lastClose;
    while (new Date((next - 86400) * 1000).getUTCDay() !== P.lvDay || next <= Date.now() / 1000) next += 86400;
    return { pick, asOf: lastClose, next, P };
  }

  function evaluateLatest(ctx) { return evaluateAt(ctx, ctx.M.n - 1); }

  return { DEFAULTS, TREND_DEFAULTS, LV_DEFAULTS, lowVolBacktest, lowVolNow, PORT_DEFAULTS, portfolio, backtestTrend, evaluateTrend, TF_SEC, prepare, evaluateAt, evaluateLatest, backtest, analyzeDaily, lastClosed, ema };
})();
if (typeof module !== 'undefined') module.exports = Engine;
