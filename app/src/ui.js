/* ===================== APP UI v2 — multi-symbol analysis report ===================== */
(() => {
const $ = s => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const S = {
  data: null, lastGen: null, syms: [], sel: LS.get('scanner.sel', null), O: {}, replayM: null,
  auto: false, autoTimer: null, nextCheck: 0, focusTrade: null,
  params: Object.assign({}, Engine.DEFAULTS, LS.get('scanner.params', {})),
  port: Object.assign({}, Engine.PORT_DEFAULTS, LS.get('scanner.port.v3', {})),
};

/* ---------------- format ---------------- */
const fmtP = p => p == null || isNaN(p) ? '-' : (Math.abs(p) >= 1000 ? p.toFixed(2) : Math.abs(p) >= 10 ? p.toFixed(3) : Math.abs(p) >= 1 ? p.toFixed(4) : p.toPrecision(5));
const fmtN = (x, d = 2) => x == null || isNaN(x) ? '-' : (x === Infinity ? '∞' : Number(x).toFixed(d));
const fmtPct = (x, d = 1) => (x > 0 ? '+' : '') + fmtN(x, d) + '%';
const TF_FMT = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtT = ts => ts ? TF_FMT.format(new Date(ts * 1000)) : '-';
const num = x => `<span class="num">${x}</span>`;
const rng = z => num(fmtP(z.lo) + ' – ' + fmtP(z.hi));
const dirBadge = d => d === 'LONG' || d === 'BULL' ? `<span class="badge b-long">${d === 'LONG' ? 'خرید LONG' : 'صعودی'}</span>`
  : d === 'SHORT' || d === 'BEAR' ? `<span class="badge b-short">${d === 'SHORT' ? 'فروش SHORT' : 'نزولی'}</span>` : `<span class="badge b-range">رنج</span>`;
const short = s => s.replace('-USDT', '');

/* ---------------- data loading ---------------- */
function loadScript() {
  const old = document.getElementById('dataScript'); if (old) old.remove();
  const sc = document.createElement('script');
  sc.id = 'dataScript'; sc.src = 'ScannerData.js?t=' + Date.now();
  sc.onload = () => { if (window.SCANNER_DATA) onData(window.SCANNER_DATA, 'ScannerData.js'); };
  sc.onerror = () => { if (!S.data) setPill('', 'دیتای ۹ ارز (ScannerData.js) برای بخش پیشرفته پیدا نشد — اختیاری'); };
  document.head.appendChild(sc);
}
$('#fileIn').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try { const raw = rd.result.trim(), isScan = raw.startsWith('window.SCANNER_SCAN');
      const t = raw.replace(/^window\.SCANNER_(DATA|SCAN)\s*=\s*/, '').replace(/;\s*$/, '');
      if (isScan) { S.scanGen = null; onScan(JSON.parse(t)); } else { S.lastGen = null; onData(JSON.parse(t), f.name); }
    } catch (err) { alert('فایل قابل خواندن نیست: ' + err.message); }
  };
  rd.readAsText(f);
});
function setPill(cls, txt) { const p = $('#dataPill'); p.className = 'pill ' + cls; p.textContent = txt; }

function onData(data, srcName) {
  if (S.data && data.generatedUtc === S.lastGen) { refreshPill(); return; }
  S.data = data; S.lastGen = data.generatedUtc;
  S.syms = Object.keys(data.symbols || {});
  if (!S.sel || !S.syms.includes(S.sel)) S.sel = S.syms[0];
  const sp = $('#srcPill'); sp.style.display = '';
  const demo = data.source === 'SYNTHETIC-TEST';
  sp.textContent = (demo ? '⚠ دیتای آزمایشی' : 'منبع: ' + (data.source || '?')) + ' · ' + S.syms.length + ' ارز · ' + srcName;
  sp.className = 'pill ' + (demo ? 'warn' : '');
  buildAll();
}

function refreshPill() {
  const o = S.O[S.sel]; if (!o || !o.ctx) return;
  const M = o.ctx.M, last = M.t[M.n - 1] + 900, age = (Date.now() / 1000 - last) / 60;
  setPill(age < 35 ? 'ok' : age < 180 ? 'warn' : 'bad',
    `آخرین کندل: ${fmtT(last)} (${age < 120 ? Math.round(age) + ' دقیقه قبل' : (age / 60).toFixed(1) + ' ساعت قبل'}) · خروجی اکسل: ${fmtT(S.data.generatedUtc)}`);
}

function buildAll() {
  S.O = {};
  for (const sym of S.syms) {
    const o = { sym };
    try {
      o.ctx = Engine.prepare(S.data.symbols[sym], S.params);
      o.rep = Engine.evaluateLatest(o.ctx);                 // levels/channel context
      if (isTrend()) { o.bt = Engine.backtestTrend(o.ctx); o.ev = Engine.evaluateTrend(o.ctx, null, o.bt); o.status = trendStatus(o); }
      else { o.bt = Engine.backtest(o.ctx); o.status = symStatus(o); }
    } catch (e) { o.err = e.message; o.status = { rank: 9, cls: 'st-wait', txt: 'خطا: ' + e.message }; }
    S.O[sym] = o;
  }
  S.replayM = null;
  refreshPill(); renderWatchlist(); renderReport(); renderBt(); drawChart(); renderLV();
  checkNewSignals();
}

/* ---------------- analysis helpers ---------------- */
function keyZones(d, price) {
  const a = d.atr;
  const all = d.zones.filter(z => Math.abs(z.mid - price) <= 8 * a);
  const inside = all.filter(z => z.lo <= price && z.hi >= price);
  const sup = all.filter(z => z.hi < price).sort((x, y) => y.hi - x.hi).slice(0, 3);
  const res = all.filter(z => z.lo > price).sort((x, y) => x.lo - y.lo).slice(0, 3);
  const mark = (arr, kind) => arr.map((z, i) => Object.assign({}, z, { kind, important: z.touches >= 3 || i === 0 }));
  return { inside: mark(inside, 'IN'), sup: mark(sup, 'S'), res: mark(res, 'R'), list: [...mark(res, 'R').reverse(), ...mark(inside, 'IN'), ...mark(sup, 'S')] };
}
function activeLock(o, dir, price, t) {
  return (o.bt.locks || []).find(l => l.dir === dir && t >= l.from && t < l.until && price >= l.lo && price <= l.hi);
}
function scenPlan(o, dir, rep) {
  const { ctx } = o, P = ctx.P, d = rep.daily, h = rep.h4, price = rep.price, a4 = h.atr;
  const side = dir === 'LONG' ? h.long : h.short;
  const kz = keyZones(d, price);
  let zone = side.zone || (dir === 'LONG' ? (kz.inside[0] || kz.sup[0]) : (kz.inside[0] || kz.res[0])) || null;
  let viaChan = false;
  if (!zone) { const e = dir === 'LONG' ? h.chanLine.lower : h.chanLine.upper; zone = { lo: e - 0.25 * a4, hi: e + 0.25 * a4, touches: 0 }; viaChan = true; }
  const L = dir === 'LONG';
  const entry = L ? Math.min(price, zone.hi) : Math.max(price, zone.lo);
  const sl = L ? zone.lo - P.slAtr4h * a4 : zone.hi + P.slAtr4h * a4;
  const risk = Math.abs(entry - sl);
  const tz = d.zones.filter(z => L ? z.lo - entry >= 0.5 * risk : entry - z.hi >= 0.5 * risk).sort((x, y) => L ? x.lo - y.lo : y.hi - x.hi)[0];
  let tp = tz ? (L ? tz.lo : tz.hi) : entry + (L ? 1 : -1) * P.minRR * risk, tpFromLevel = !!tz;
  if (Math.abs(tp - entry) / risk > P.maxRR) { tp = entry + (L ? 1 : -1) * P.maxRR * risk; tpFromLevel = false; }
  const rr = Math.abs(tp - entry) / risk, riskPct = risk / entry * 100;
  const inZone = price >= zone.lo && price <= zone.hi;
  const distPct = inZone ? 0 : L ? (price - zone.hi) / price * 100 : (zone.lo - price) / price * 100;
  const tr = d.trend.dir;
  const aligned = (L && tr === 'BULL') || (!L && tr === 'BEAR');
  const active = side.ok && (!P.requireConfirm || !!side.confirm);
  return { dir, zone, viaChan, entry, sl, tp, rr, riskPct, tpFromLevel, distPct, inZone, aligned, allowed: rep.dirs.includes(dir), active, side,
    lock: activeLock(o, dir, entry, rep.time) };
}
function symStatus(o) {
  const rep = o.rep;
  if (rep.error) return { rank: 8, cls: 'st-wait', txt: rep.error };
  const lt = o.bt.trades[o.bt.trades.length - 1];
  const sig = rep.signal && !activeLock(o, rep.signal.dir, rep.signal.entry, rep.time) ? rep.signal : null;
  if (sig) return { rank: 0, cls: 'st-sig', txt: `🎯 سیگنال ${sig.dir === 'LONG' ? 'خرید' : 'فروش'} (امتیاز ${sig.total})` };
  if (lt && lt.status === 'OPEN') return { rank: 1, cls: 'st-open', txt: `📌 معامله‌ی باز ${lt.dir === 'LONG' ? 'خرید' : 'فروش'}` };
  const plans = rep.dirs.map(dd => scenPlan(o, dd, rep));
  const act = plans.find(p => p.active && !p.lock);
  if (act) return { rank: 2, cls: 'st-zone', txt: `⏳ در ناحیه‌ی ${act.dir === 'LONG' ? 'خرید' : 'فروش'} — منتظر ماشه ۱۵م`, dist: 0 };
  const best = plans.filter(p => !p.lock).sort((a, b) => a.distPct - b.distPct)[0];
  if (!best) { const lk = plans.find(p => p.lock); return { rank: 5, cls: 'st-wait', txt: lk ? `🔒 ناحیه‌ی ${lk.dir === 'LONG' ? 'خرید' : 'فروش'} قفل تا ${fmtT(lk.lock.until).split(', ')[1] || ''} ${fmtT(lk.lock.until).split(', ')[0].slice(5)}` : 'منتظر' }; }
  const near = best.distPct <= 2 * S.params.h4ZoneAtr * (rep.h4.atr / rep.price * 100);
  return { rank: near ? 3 : 4, cls: near ? 'st-near' : 'st-wait', dist: best.distPct,
    txt: `${near ? 'نزدیک' : 'تا'} ناحیه‌ی ${best.dir === 'LONG' ? 'خرید' : 'فروش'}: ${fmtN(best.distPct)}%` };
}
const chg24 = M => { const i = M.n - 1, j = Math.max(0, i - 96); return (M.c[i] - M.c[j]) / M.c[j] * 100; };

/* ---------------- auto mode + alerts ---------------- */
$('#btnReload').onclick = () => { S.lastGen = null; S.scanGen = null; loadScript(); loadScan(); };
$('#btnAuto').onclick = () => {
  S.auto = !S.auto;
  if (S.auto) {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
    S.nextCheck = Date.now() + 60000;
    S.autoTimer = setInterval(() => {
      const left = Math.max(0, Math.round((S.nextCheck - Date.now()) / 1000));
      $('#btnAuto').textContent = `⏱ خودکار: روشن (${left}s)`;
      if (left <= 0) { S.nextCheck = Date.now() + 60000; loadScript(); loadScan(); }
    }, 1000);
    $('#btnAuto').classList.add('on');
  } else {
    clearInterval(S.autoTimer); $('#btnAuto').classList.remove('on'); $('#btnAuto').textContent = '⏱ خودکار: خاموش';
  }
  LS.set('scanner.auto', S.auto);
};
function beep() {
  try { const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach(d => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.value = 0.15; o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.15); });
  } catch (e) {}
}
function checkNewSignals() {
  const seen = LS.get('scanner.alerts', {});
  let fired = false;
  for (const sym of S.syms) {
    const o = S.O[sym]; if (!o.bt) continue;
    const t = o.bt.trades[o.bt.trades.length - 1];
    if (!t || t.status !== 'OPEN') continue;
    const key = t.entryTime + '|' + t.dir;
    if (seen[sym] === key) continue;
    seen[sym] = key;
    if ((Date.now() / 1000 - t.entryTime) / 60 > 60) continue;
    fired = true;
    try { if (window.Notification && Notification.permission === 'granted')
      new Notification(`${sym} ${t.dir}`, { body: `ورود ${fmtP(t.entry)} | SL ${fmtP(t.sl)} | TP ${fmtP(t.tp1)}` }); } catch (e) {}
  }
  LS.set('scanner.alerts', seen);
  if (fired) beep();
}

/* ---------------- tabs ---------------- */
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(id) {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('act', x.dataset.tab === id));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('act', x.id === 'tab-' + id));
  if (id === 'chart') drawChart();
  if (id === 'bt') { drawEquity(); if (S.portRes) runPort(); }
  if (id === 'ana') redrawReportCharts();
  if (id === 'lv') renderLV();
  if (id === 'jr') renderJr();
}
function selectSym(sym) { S.sel = sym; LS.set('scanner.sel', sym); S.replayM = null; S.focusTrade = null; refreshPill(); renderWatchlist(); renderReport(); drawChart(); }

/* ---------------- WATCHLIST ---------------- */
function renderWatchlist() {
  const items = S.syms.map(s => S.O[s]).sort((a, b) => (a.status.rank - b.status.rank) || ((a.status.dist ?? 99) - (b.status.dist ?? 99)));
  $('#watchlist').innerHTML = `<div class="mute" style="font-size:12px;padding:0 6px 6px">${S.syms.length} ارز · مرتب‌شده بر اساس نزدیکی به موقعیت ورود</div>` +
    items.map(o => {
      if (!o.ctx) return `<div class="wl-item" data-s="${o.sym}"><div class="wl-sym">${short(o.sym)}</div><div class="wl-st red">${o.err}</div></div>`;
      const M = o.ctx.M, ch = chg24(M), tr = o.rep.daily && o.rep.daily.trend ? o.rep.daily.trend.dir : null;
      return `<div class="wl-item ${o.sym === S.sel ? 'act' : ''}" data-s="${o.sym}">
        <div class="wl-top"><span class="wl-sym">${short(o.sym)}</span>${tr ? dirBadge(tr) : ''}
        <span class="num">${fmtP(M.c[M.n - 1])}</span><span class="num ${ch >= 0 ? 'green' : 'red'}" style="font-size:12px">${fmtPct(ch)}</span></div>
        <div class="wl-st ${o.status.cls}">${o.status.txt}</div></div>`;
    }).join('');
  document.querySelectorAll('.wl-item').forEach(el => el.onclick = () => selectSym(el.dataset.s));
}

/* ---------------- REPORT ---------------- */
let rc = {}; // report charts
function renderReport() {
  if (isTrend()) return renderTrendReport();
  const o = S.O[S.sel];
  if (!o) return;
  if (!o.ctx) { $('#report').innerHTML = `<div class="card red">${o.err}</div>`; return; }
  const ctx = o.ctx, P = ctx.P, M = ctx.M;
  const m = S.replayM == null ? M.n - 1 : S.replayM;
  const rep = S.replayM == null ? o.rep : Engine.evaluateAt(ctx, m);
  o.view = rep;
  const replayBox = `<details class="card" style="margin-top:12px" ${S.replayM != null ? 'open' : ''}><summary>🕘 تست روی گذشته (تحلیل را در هر لحظه‌ی دلخواه ببینید)</summary>
      <div class="toolbar" style="margin:8px 0 0"><span>زمان: <b class="num" id="rpT">${fmtT(rep.time)}</b></span><button id="rpLive" class="primary">برگشت به زنده</button></div>
      <input id="replay" type="range" min="${Math.min(M.n - 1, 200)}" max="${M.n - 1}" value="${m}"></details>`;
  if (rep.error) { $('#report').innerHTML = `<div class="card amber">${rep.error}</div>` + replayBox; bindReplay(); return; }

  const d = rep.daily, h = rep.h4, price = rep.price, T = d.trend;
  const kz = keyZones(d, price);
  const plans = { LONG: scenPlan(o, 'LONG', rep), SHORT: scenPlan(o, 'SHORT', rep) };
  const st = S.replayM == null ? o.status : symStatus(Object.assign({}, o, { rep }));
  const ch = chg24(M);

  // ---- narrative
  const trLabel = T.dir === 'BULL' ? '<b class="green">صعودی</b>' : T.dir === 'BEAR' ? '<b class="red">نزولی</b>' : '<b>رنج / بدون روند مشخص</b>';
  const why = [];
  why.push(d.close > T.ema[0] ? `قیمت بالای EMA${P.dEmaFast}` : `قیمت زیر EMA${P.dEmaFast}`);
  why.push(T.ema[0] > T.ema[1] ? `EMA${P.dEmaFast} بالای EMA${P.dEmaSlow}` : `EMA${P.dEmaFast} زیر EMA${P.dEmaSlow}`);
  why.push(T.slope > P.dSlopeMin ? 'شیب میانگین متحرک مثبت' : T.slope < -P.dSlopeMin ? 'شیب میانگین متحرک منفی' : 'میانگین متحرک تقریباً افقی');
  why.push(T.hh && T.hl ? 'سقف‌ها و کف‌های بالاتر (HH/HL)' : T.hh === false && T.hl === false ? 'سقف‌ها و کف‌های پایین‌تر (LH/LL)' : 'ساختار سقف و کف مختلط');
  const cs = d.chan.slopePctDay, chDir = cs > 0.15 ? 'صعودی' : cs < -0.15 ? 'نزولی' : 'تقریباً افقی';
  const pos = h.chanPos, posTxt = pos < 0 ? 'زیر کف کانال (خروج از کانال به پایین)' : pos > 1 ? 'بالای سقف کانال (خروج از کانال به بالا)' : pos < 0.25 ? 'نزدیک کف کانال' : pos > 0.75 ? 'نزدیک سقف کانال' : 'میانه‌ی کانال';
  const zTxt = z => `${rng(z)} <span class="mute">(${z.touches} برخورد، ${fmtPct((z.kind === 'S' ? z.hi - price : z.lo - price) / price * 100)})</span>`;
  const v = h.vol;
  const volTxt = `حجم دلاری ۴ساعته ${v.trend > 1.2 ? '<b class="green">رو به افزایش</b>' : v.trend < 0.8 ? '<b class="amber">ضعیف</b>' : 'معمولی'} است (${num(fmtN(v.trend))}× میانگین)؛ در ۲۰ کندل اخیر ${v.balance > 1 ? 'حجم کندل‌های سبز بیشتر بوده (فشار خرید)' : 'حجم کندل‌های قرمز بیشتر بوده (فشار فروش)'} و OBV ${v.obvSlope >= 0 ? 'صعودی' : 'نزولی'} است.`;
  const mainDir = T.dir === 'BULL' ? 'LONG' : T.dir === 'BEAR' ? 'SHORT' : (plans.LONG.distPct <= plans.SHORT.distPct ? 'LONG' : 'SHORT');
  const mp = plans[mainDir];
  const concl = rep.signal && !activeLock(o, rep.signal.dir, rep.signal.entry, rep.time)
    ? `<b class="green">همین الان سیگنال ورود ${rep.signal.dir === 'LONG' ? 'خرید' : 'فروش'} صادر شده است</b> (جزئیات در بخش ۱۵ دقیقه).`
    : mp.lock && mp.allowed ? `سناریوی اصلی ${mainDir === 'LONG' ? 'خرید از حمایت' : 'فروش از مقاومت'} ${rng(mp.zone)} است، ولی این ناحیه به‌خاطر حد ضرر اخیر <b class="amber">تا ${fmtT(mp.lock.until)} قفل است</b>؛ تا آن زمان در این ناحیه وارد نمی‌شویم.`
    : mp.active ? `قیمت در ناحیه‌ی ${mainDir === 'LONG' ? 'خرید' : 'فروش'} قرار دارد؛ <b class="amber">در تایم ۱۵ دقیقه منتظر ماشه‌ی ورود هستیم.</b>`
      : `فعلاً موقعیت ورود نداریم. ${T.dir === 'RANGE' ? 'بازار رنج است؛ ' : ''}سناریوی اصلی ${mainDir === 'LONG' ? 'خرید از حمایت' : 'فروش از مقاومت'} ${rng(mp.zone)} است که ${num(fmtN(Math.abs(mp.distPct)))}% با قیمت فعلی فاصله دارد.`;

  let html = `
  <div class="card"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <h2>${short(o.sym)} <span class="mute" style="font-size:13px">/USDT</span></h2>
    <span class="big num">${fmtP(price)}</span><span class="num ${ch >= 0 ? 'green' : 'red'}">${fmtPct(ch)} (۲۴ساعت)</span>
    ${dirBadge(T.dir)}<span class="wl-st ${st.cls}" style="font-size:14px">${st.txt}</span>
    <div class="spacer"></div><span class="mute" style="font-size:12px">${S.replayM == null ? 'زنده' : '🕘 تست گذشته'} · ${fmtT(rep.time)}</span></div></div>

  <div class="card" style="margin-top:12px"><h3>📋 تحلیل وضعیت</h3>
    <p><b>روند روزانه:</b> ${trLabel} — ${why.join('، ')}.</p>
    <p><b>کانال روزانه:</b> کانال ${P.chanLen} روز اخیر ${chDir} است (شیب ${num(fmtPct(cs, 2))} در روز). قیمت در ${num(fmtN(pos * 100, 0) + '%')} کانال، یعنی <b>${posTxt}</b> است؛ سقف کانال حدود ${num(fmtP(h.chanLine.upper))} و کف آن حدود ${num(fmtP(h.chanLine.lower))}.</p>
    <p><b>مقاومت‌های مهم:</b> ${kz.res.length ? kz.res.map(zTxt).join('، ') : 'در محدوده‌ی نزدیک مقاومتی ثبت نشده'}.</p>
    ${kz.inside.length ? `<p><b class="amber">قیمت داخل ناحیه‌ی</b> ${kz.inside.map(z => rng(z) + ` <span class="mute">(${z.touches} برخورد)</span>`).join('، ')} <b class="amber">است.</b></p>` : ''}
    <p><b>حمایت‌های مهم:</b> ${kz.sup.length ? kz.sup.map(zTxt).join('، ') : 'در محدوده‌ی نزدیک حمایتی ثبت نشده'}.</p>
    <p><b>حجم:</b> ${volTxt}</p>
    <p style="margin:0;padding-top:6px;border-top:1px dashed var(--line)"><b>جمع‌بندی:</b> ${concl}</p>
  </div>

  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>📈 روزانه — سطوح مهم و کانال</h3><div class="chartbox"><canvas id="cD"></canvas><div class="cinfo" id="iD"></div></div></div>
    <div class="card"><h3>📈 ۴ ساعته — جایگاه قیمت در سطوح روزانه</h3><div class="chartbox"><canvas id="cH"></canvas><div class="cinfo" id="iH"></div></div></div>
  </div>

  <div class="grid g2" style="margin-top:12px">${['LONG', 'SHORT'].map(dd => scenCard(o, plans[dd], dd === mainDir)).join('')}</div>

  ${m15Card(o, rep, plans)}

  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>📏 جدول سطوح</h3><table><tr><th>نوع</th><th>محدوده</th><th>برخورد</th><th>فاصله</th></tr>
      ${kz.list.map(z => `<tr><td>${z.kind === 'R' ? '<span class="red">مقاومت</span>' : z.kind === 'S' ? '<span class="green">حمایت</span>' : '<span class="amber">قیمت داخل ناحیه</span>'}${z.important ? ' ⭐' : ''}</td>
        <td>${rng(z)}</td><td>${z.touches}</td><td class="num">${z.kind === 'IN' ? '0' : fmtPct((z.kind === 'S' ? z.hi - price : z.lo - price) / price * 100)}</td></tr>`).join('')}</table>
      <div class="mute" style="font-size:12px;margin-top:6px">⭐ = ناحیه‌ی مهم (۳ برخورد یا بیشتر، یا نزدیک‌ترین ناحیه)</div></div>
    <div class="card"><h3>🧾 سیگنال‌های اخیر این ارز (بک‌تست)</h3>${tradesTable(o.bt.trades.slice(-8).reverse().map(t => ({ t, sym: o.sym })), true)}</div>
  </div>` + replayBox;

  $('#report').innerHTML = html;
  bindTradeRows($('#report'));
  bindReplay();
  // charts
  rc = {
    D: new Chart($('#cD'), $('#iD')), H: new Chart($('#cH'), $('#iH')),
    M: document.getElementById('cM') ? new Chart($('#cM'), $('#iM')) : null,
  };
  redrawReportCharts();
}

function bindReplay() {
  const r = $('#replay'); if (!r) return;
  r.oninput = e => { const o = S.O[S.sel], v = +e.target.value; $('#rpT').textContent = fmtT(o.ctx.M.t[v] + 900); };
  r.onchange = e => { const o = S.O[S.sel], v = +e.target.value; S.replayM = v >= o.ctx.M.n - 1 ? null : v; renderReport(); };
  const b = $('#rpLive'); if (b) b.onclick = () => { S.replayM = null; renderReport(); };
}

function scenCard(o, p, isMain) {
  const P = o.ctx.P, L = p.dir === 'LONG', a = p.zone;
  const title = p.aligned ? 'سناریوی اصلی — هم‌جهت روند' : o.view.daily.trend.dir === 'RANGE' ? 'سناریوی بازار رنج' : 'سناریوی خلاف روند';
  let status;
  if (!p.allowed) status = `<span class="mute">⛔ غیرفعال: خلاف روند روزانه (برای فعال‌سازی، «اجازه‌ی معامله خلاف روند» را در تنظیمات روشن کنید)</span>`;
  else if (p.lock) status = `<span class="amber">🔒 این ناحیه به‌خاطر حد ضرر اخیر تا ${fmtT(p.lock.until)} قفل است</span>`;
  else if (p.active) status = `<b class="green">✅ فعال — قیمت در ناحیه است؛ منتظر ماشه‌ی ۱۵ دقیقه</b>`;
  else status = `<span>⏳ ${p.inZone ? 'قیمت داخل ناحیه است ولی شرط ۴ساعته هنوز کامل نیست' : `قیمت باید ${num(fmtN(Math.abs(p.distPct)))}% ${L ? 'پایین' : 'بالا'} بیاید`}</span>`;
  const zoneDesc = p.viaChan ? `${L ? 'کف' : 'سقف'} کانال روزانه (حدود ${num(fmtP((a.lo + a.hi) / 2))})` : `ناحیه‌ی ${L ? 'حمایت' : 'مقاومت'} ${rng(a)} (${a.touches} برخورد)`;
  const conf = L ? 'پین‌بار یا اینگالفینگ صعودی، یا برگشت بالای EMA20' : 'پین‌بار یا اینگالفینگ نزولی، یا شکست EMA20 به پایین';
  const body = `اگر قیمت ${p.inZone ? 'در' : 'به'} ${zoneDesc} ${p.inZone ? 'بماند' : 'برسد'}${P.requireConfirm ? ` و در ۴ ساعته کندل تأیید (${conf}) ببینیم` : ` (کندل تأیید ۴ساعته: ${conf} — امتیاز اضافه)`}،
    در تایم ۱۵ دقیقه منتظر می‌مانیم تا یک کندل ${L ? 'بالای سقف' : 'زیر کف'} ${P.m15BreakBars} کندل قبلی و ${L ? 'بالای' : 'زیر'} EMA${P.m15Ema} بسته شود و حجم دلاری آن حداقل ${P.rvolMin} برابر میانگین باشد.`;
  const warns = [];
  if (p.riskPct > P.maxRiskPct) warns.push(`⚠ حد ضرر پشت این ناحیه ${fmtN(p.riskPct)}% دور است (حداکثر مجاز ${P.maxRiskPct}%). ناحیه پهن است و ورود فقط وقتی معتبر می‌شود که قیمت به لبه‌ی ${L ? 'پایینی' : 'بالایی'} آن نزدیک شود.`);
  if (p.rr < P.minRR - 1e-9) warns.push(`⚠ هدف بعدی نزدیک است (R:R ${fmtN(p.rr)} کمتر از ${P.minRR})؛ با این فاصله سیگنال صادر نمی‌شود مگر ورود بهتری پیدا شود.`);
  return `<div class="card scen ${isMain ? 'main' : ''} ${p.allowed ? '' : 'off'}">
    <h3>${dirBadge(p.dir)} ${title}</h3>
    <div>${status}</div>
    <p style="margin:8px 0">${body}</p>
    <div class="kv">
      <div><span>ورود تقریبی</span>${num(fmtP(p.entry))}</div>
      <div><span>حد ضرر</span>${num(fmtP(p.sl))}</div>
      <div><span>هدف ${p.tpFromLevel ? '(ناحیه‌ی بعدی)' : '(بر اساس R)'}</span>${num(fmtP(p.tp))}</div>
      <div><span>R:R</span>${num(fmtN(p.rr))}</div>
      <div><span>ریسک</span>${num(fmtN(p.riskPct))}%</div>
    </div>
    ${warns.map(w => `<div class="amber" style="font-size:13px;margin-top:6px">${w}</div>`).join('')}
  </div>`;
}

function m15Card(o, rep, plans) {
  const P = o.ctx.P;
  const sig = rep.signal && !activeLock(o, rep.signal.dir, rep.signal.entry, rep.time) ? rep.signal : null;
  let txt;
  if (sig) {
    txt = `<div class="card signal ${sig.dir === 'SHORT' ? 'short' : ''}" style="padding:10px"><div class="big">🎯 سیگنال ورود ${dirBadge(sig.dir)} <span class="pill">امتیاز ${sig.total}</span></div>
      <div class="kv"><div><span>ورود</span>${num(fmtP(sig.entry))}</div><div><span>حد ضرر</span>${num(fmtP(sig.sl))}</div><div><span>حد سود ۱</span>${num(fmtP(sig.tp1))}</div>
      <div><span>حد سود ۲</span>${num(fmtP(sig.tp2))}</div><div><span>R:R</span>${num(fmtN(sig.rr))}</div><div><span>ریسک</span>${num(fmtN(sig.riskPct))}%</div></div>
      <p style="margin:8px 0 0">کندل ۱۵ دقیقه‌ی ${fmtT(rep.time)} همه‌ی شرایط را کامل کرد${sig.pattern ? ` (الگوی ${sig.pattern})` : ''}. RVOL: ${num(fmtN(sig.rvol))}</p></div>`;
  } else {
    const act = rep.setups.find(s => s.location && s.trigger && !plans[s.dir].lock);
    if (act) {
      const c = act.trigger.checks, L = act.dir === 'LONG', pl = act.trigger.plan;
      const li = (ok, t) => `<li>${ok ? '✅' : '⬜'} ${t}</li>`;
      const missing = [];
      if (!c.breakout) missing.push(`یک کندل ۱۵م ${L ? 'بالای' : 'زیر'} ${num(fmtP(c.breakLevel))} بسته شود`);
      if (!c.ema) missing.push(`قیمت ${L ? 'بالای' : 'زیر'} EMA${P.m15Ema} (${num(fmtP(c.emaVal))}) برود`);
      if (!c.rvolOk) missing.push(`حجم کندل ماشه حداقل ${P.rvolMin}× میانگین باشد`);
      txt = `<p><b class="amber">انتظار ورود ${L ? 'خرید' : 'فروش'} داریم.</b> قیمت در ناحیه‌ی ${L ? 'حمایت' : 'مقاومت'} است و حالا فقط ماشه‌ی ۱۵ دقیقه باقی مانده.</p>
        <ul class="chk">
          ${li(c.pullback, `پولبک به ناحیه در ${P.m15SetupBars} کندل اخیر`)}
          ${li(c.breakout, `بسته شدن ${L ? 'بالای سقف' : 'زیر کف'} ${P.m15BreakBars} کندل قبل → سطح ماشه: ${num(fmtP(c.breakLevel))}`)}
          ${li(c.ema, `${L ? 'بالای' : 'زیر'} EMA${P.m15Ema} → ${num(fmtP(c.emaVal))}`)}
          ${li(c.rvolOk, `حجم ≥ ${P.rvolMin}× میانگین (کندل فعلی: ${num(fmtN(c.rvol))}×)`)}
          ${li(c.rrOk, `R:R ≥ ${P.minRR} (با ورود الان: ${num(fmtN(pl.rr))})`)}
          ${li(c.riskOk, `فاصله‌ی حد ضرر ≤ ${P.maxRiskPct}% (الان: ${num(fmtN(pl.riskPct))}%)`)}
        </ul>
        ${missing.length ? `<p><b>برای صدور سیگنال باید:</b> ${missing.join('، ')}.</p>` : ''}
        <p class="mute">اگر ماشه بخورد: ورود حدود ${num(fmtP(pl.entry))}، حد ضرر ${num(fmtP(pl.sl))}، هدف ${num(fmtP(pl.tp1))}.</p>`;
    } else {
      const ps = rep.dirs.map(dd => plans[dd]).filter(p => !p.lock).sort((a, b) => a.distPct - b.distPct);
      const p = ps[0];
      txt = `<p><b>در تایم ۱۵ دقیقه فعلاً انتظار ورود نداریم.</b></p>` +
        (p ? `<p>ابتدا قیمت باید به ${p.viaChan ? (p.dir === 'LONG' ? 'کف' : 'سقف') + ' کانال روزانه' : `ناحیه‌ی ${p.dir === 'LONG' ? 'حمایت' : 'مقاومت'} ${rng(p.zone)}`} برسد (${num(fmtN(Math.abs(p.distPct)))}% فاصله). تا آن موقع دنبال کردن ۱۵ دقیقه لازم نیست؛ با روشن بودن حالت خودکار، رسیدن به ناحیه و سیگنال اعلام می‌شود.</p>`
          : (() => { const lk = rep.dirs.map(dd => plans[dd]).find(p => p.lock);
              return lk ? `<p>ناحیه‌ی ${lk.dir === 'LONG' ? 'خرید' : 'فروش'} ${rng(lk.zone)} به‌خاطر حد ضرر اخیر تا <b>${fmtT(lk.lock.until)}</b> قفل است. بعد از آن، اگر قیمت هنوز در این ناحیه باشد، دوباره منتظر ماشه‌ی ۱۵ دقیقه می‌مانیم.</p>`
                : '<p>جهت مجازی برای معامله وجود ندارد (تنظیمات Long/Short را بررسی کنید).</p>'; })());
    }
  }
  return `<div class="card" style="margin-top:12px"><h3>🎯 تایم ۱۵ دقیقه — انتظار ورود</h3>
    <div class="grid g2"><div class="chartbox small"><canvas id="cM"></canvas><div class="cinfo" id="iM"></div></div><div>${txt}</div></div></div>`;
}

function redrawReportCharts() {
  if (isTrend()) return redrawTrendCharts();
  const o = S.O[S.sel]; if (!o || !o.view || o.view.error || !rc.D) return;
  const ctx = o.ctx, rep = o.view, d = rep.daily, price = rep.price;
  const kz = keyZones(d, price);
  const zones = kz.list;
  const ch = d.chan, t0 = ctx.D.t[ch.startIdx], chan = { t0, t1: ctx.D.t[ch.endIdx] + 86400 * 3, f: t => ch.at((t - t0) / 86400) };
  const endD = ctx.D.n - 1 - (S.replayM == null ? 0 : ctx.D.n - 1 - rep.i);
  const endH = rep.k, endM = rep.m;
  rc.D.setData(ctx.D, 86400, { price, zones, zoneLabels: true, chan, emas: [{ arr: ctx.D.emaF, color: '#60a5fa' }, { arr: ctx.D.emaS, color: '#c084fc' }], showVol: true, title: 'Daily', end: endD, view: 120 });
  rc.H.setData(ctx.H, 14400, { price, zones, zoneLabels: true, chan, emas: [{ arr: ctx.H.ema, color: '#60a5fa' }], showVol: true, title: '4H', end: endH, view: 150 });
  if (rc.M) {
    const hl = [];
    const sig = rep.signal;
    if (sig) hl.push({ p: sig.entry, c: '#3b82f6', t: 'ورود' }, { p: sig.sl, c: '#ef4444', t: 'SL' }, { p: sig.tp1, c: '#22c55e', t: 'TP' });
    else {
      const act = rep.setups.find(s => s.location && s.trigger);
      if (act) hl.push({ p: act.trigger.checks.breakLevel, c: '#f59e0b', t: 'سطح ماشه' }, { p: act.trigger.plan.sl, c: '#ef4444', t: 'SL' });
    }
    rc.M.setData(ctx.M, 900, { price, zones: zones.filter(z => Math.abs(z.mid - price) / price < 0.06), zoneLabels: true, emas: [{ arr: ctx.M.ema, color: '#60a5fa' }], showVol: true, hlines: hl, title: '15m', end: endM, view: 140 });
  }
}

function tradesTable(rows, compact, withSym) {
  if (!rows.length) return '<div class="mute">معامله‌ای ثبت نشده</div>';
  return `<div class="scroll"><table><tr>${withSym ? '<th>ارز</th>' : ''}<th>جهت</th><th>زمان ورود</th><th>ورود</th><th>SL</th><th>TP</th><th>R:R</th>${compact ? '' : '<th>امتیاز</th><th>زمان خروج</th>'}<th>نتیجه</th></tr>
  ${rows.map(({ t, sym }) => {
    const idx = S.O[sym].bt.trades.indexOf(t);
    const res = t.status === 'OPEN' ? `<span class="amber">باز${t.partialDone ? ' (½ بسته)' : ''}</span>` : `<span class="${t.R > 0.01 ? 'green' : t.R < -0.01 ? 'red' : 'mute'} num">${t.why} ${fmtN(t.R)}R</span>`;
    return `<tr class="click" data-sym="${sym}" data-ti="${idx}">${withSym ? `<td><b>${short(sym)}</b></td>` : ''}<td>${dirBadge(t.dir)}</td><td class="num">${fmtT(t.entryTime)}</td><td class="num">${fmtP(t.entry)}</td>
    <td class="num">${fmtP(t.sl)}</td><td class="num">${fmtP(t.tp1)}</td><td class="num">${fmtN(t.rr)}</td>${compact ? '' : `<td>${t.total}</td><td class="num">${t.exitTime ? fmtT(t.exitTime) : '-'}</td>`}<td>${res}</td></tr>`; }).join('')}</table></div>`;
}
function bindTradeRows(root) {
  root.querySelectorAll('tr[data-ti]').forEach(tr => tr.onclick = () => {
    const sym = tr.dataset.sym;
    if (sym !== S.sel) selectSym(sym);
    S.focusTrade = S.O[sym].bt.trades[+tr.dataset.ti];
    $('#tfSel').value = '15min';
    showTab('chart');
    big.centerOn(S.focusTrade.entryTime);
  });
}

/* ---------------- BACKTEST TAB ---------------- */
$('#btnBt').onclick = () => { if (S.data) buildAll(); };
function renderBt() {
  const rows = S.syms.map(s => S.O[s]).filter(o => o.bt);
  if (!rows.length) return;
  const all = rows.flatMap(o => o.bt.trades.map(t => ({ t, sym: o.sym })));
  const closed = all.filter(x => x.t.status === 'CLOSED').sort((a, b) => a.t.exitTime - b.t.exitTime);
  let eq = 0, peak = 0, dd = 0; S.curve = [];
  for (const x of closed) { eq += x.t.R; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); S.curve.push(eq); }
  const wins = closed.filter(x => x.t.R > 0.01).length;
  const pos = closed.filter(x => x.t.R > 0).reduce((s, x) => s + x.t.R, 0), neg = -closed.filter(x => x.t.R < 0).reduce((s, x) => s + x.t.R, 0);
  const n = closed.length;
  $('#btBody').innerHTML = `<div class="grid g4">
    <div class="card"><h3>معاملات بسته (همه‌ی ارزها)</h3><div class="big">${n}</div><small class="mute">${rows.length} ارز · باز ${all.length - n}</small></div>
    <div class="card"><h3>درصد برد</h3><div class="big ${wins / n >= 0.4 ? 'green' : 'red'}">${fmtN(n ? wins / n * 100 : 0, 1)}%</div></div>
    <div class="card"><h3>مجموع / میانگین R</h3><div class="big ${eq >= 0 ? 'green' : 'red'} num">${fmtN(eq)}R</div><small class="mute">میانگین ${num(fmtN(n ? eq / n : 0))}R (بعد از کارمزد)</small></div>
    <div class="card"><h3>Profit Factor / بیشترین افت</h3><div class="big num">${fmtN(neg > 0 ? pos / neg : Infinity)}</div><small class="mute">بیشترین افت ${num(fmtN(dd))}R</small></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>نتیجه به تفکیک ارز</h3><table><tr><th>ارز</th><th>معاملات</th><th>برد</th><th>مجموع R</th><th>PF</th><th>افت</th><th>Long/Short</th></tr>
      ${rows.sort((a, b) => b.bt.stats.totalR - a.bt.stats.totalR).map(o => { const s = o.bt.stats; return `<tr class="click" data-pick="${o.sym}"><td><b>${short(o.sym)}</b></td><td>${s.n}</td><td>${fmtN(s.winRate, 0)}%</td>
        <td class="num ${s.totalR >= 0 ? 'green' : 'red'}">${fmtN(s.totalR)}</td><td class="num">${fmtN(s.pf)}</td><td class="num">${fmtN(s.maxDD)}</td><td>${s.longs}/${s.shorts}</td></tr>`; }).join('')}</table></div>
    <div class="card"><h3>منحنی سرمایه‌ی ترکیبی (R)</h3><canvas class="eq" id="eqCanvas"></canvas></div>
  </div>
  <div class="card" style="margin-top:12px;border-color:#3b82f6"><h3>💰 شبیه‌سازی سرمایه — مدیریت سرمایه و کارمزد</h3>
    <div id="portForm" class="grid g4" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))"></div>
    <div class="toolbar" style="margin-top:10px"><button id="btnPort" class="primary">▶ اجرای شبیه‌سازی</button>
      <span class="mute" style="font-size:12px">حجم هر معامله طوری حساب می‌شود که اگر حد ضرر بخورد (با کارمزد و لغزش)، فقط «ریسک هر معامله» از موجودی کم شود.</span></div>
    <div id="portOut"></div></div>
  <div class="card" style="margin-top:12px"><h3>همه‌ی معاملات سیگنال (بر حسب R، بدون محدودیت سرمایه · کلیک = نمایش روی نمودار)</h3>${tradesTable(all.sort((a, b) => b.t.entryTime - a.t.entryTime), false, true)}</div>`;
  bindTradeRows($('#btBody'));
  renderPortForm(); runPort();
  $('#btBody').querySelectorAll('tr[data-pick]').forEach(tr => tr.onclick = () => { selectSym(tr.dataset.pick); showTab('ana'); });
  drawEquity();
}
function drawEquity() {
  const cv = document.getElementById('eqCanvas'); if (!cv || !S.curve || !cv.offsetWidth) return;
  const dpr = window.devicePixelRatio || 1, W = cv.offsetWidth, H = cv.offsetHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.direction = 'ltr'; g.clearRect(0, 0, W, H);
  const pts = [0, ...S.curve];
  if (pts.length < 2) return;
  const mn = Math.min(...pts), mx = Math.max(...pts);
  const y = v => H - 20 - (v - mn) / ((mx - mn) || 1) * (H - 40), x = i => 44 + i / (pts.length - 1) * (W - 60);
  g.strokeStyle = '#26324f'; g.beginPath(); g.moveTo(44, y(0)); g.lineTo(W - 16, y(0)); g.stroke();
  g.fillStyle = '#8b96b0'; g.font = '11px Tahoma'; g.fillText('0R', 6, y(0) + 4); g.fillText(fmtN(mx, 1) + 'R', 6, y(mx) + 4);
  g.strokeStyle = pts[pts.length - 1] >= 0 ? '#22c55e' : '#ef4444'; g.lineWidth = 2; g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(x(i), y(p)) : g.moveTo(x(i), y(p))); g.stroke();
}



/* ===================== TREND STRATEGY UI ===================== */
const isTrend = () => S.params.strategy === 'trend';
function trendStatus(o) {
  const ev = o.ev;
  if (!ev || ev.error) return { rank: 8, cls: 'st-wait', txt: ev ? ev.error : 'بدون دیتا' };
  if (ev.signal) return { rank: 0, cls: 'st-sig', txt: `🎯 ورود ${ev.signal.dir === 'LONG' ? 'خرید' : 'فروش'} — همین الان` };
  if (ev.open) { const r = curR(ev.open, ev.price); return { rank: 1, cls: 'st-open', txt: `📌 ${ev.open.dir === 'LONG' ? 'خرید' : 'فروش'} باز · ${fmtN(r)}R` }; }
  if (ev.pending) return { rank: 2, cls: 'st-zone', txt: `⏳ شکست ${ev.pending.dir === 'LONG' ? 'سقف' : 'کف'} — منتظر پولبک ۱۵م` };
  if (ev.trend === 0) return { rank: 6, cls: 'st-wait', txt: 'روند روزانه خنثی — معامله نداریم', dist: 99 };
  const L = ev.trend > 0, lvl = L ? ev.h4.hi : ev.h4.lo, dist = Math.abs(lvl - ev.price) / ev.price * 100;
  const near = Math.abs(lvl - ev.price) <= 1.5 * ev.h4.atr;
  return { rank: near ? 3 : 4, cls: near ? 'st-near' : 'st-wait', dist, txt: `${near ? 'نزدیک' : 'تا'} شکست ${L ? 'سقف' : 'کف'} ۴ساعته: ${fmtN(dist)}%` };
}
const curR = (t, price) => (t.dir === 'LONG' ? price - t.entry : t.entry - price) / Math.abs(t.entry - t.sl);
function sizeHint(entry, stop) {
  const p = S.port, risk = p.capital * p.riskPct / 100, per = Math.abs(entry - stop), qty = risk / per, notional = qty * entry;
  return `با سرمایه‌ی ${num('$' + p.capital)} و ریسک ${p.riskPct}%: ریسک ${num('$' + fmtN(risk))} → حجم پوزیشن ${num('$' + fmtN(notional))}${p.mode === 'futures' ? ` (با اهرم ${p.leverage}: مارجین حدود ${num('$' + fmtN(notional / p.leverage))})` : ''}`;
}

function renderTrendReport() {
  const o = S.O[S.sel]; if (!o) return;
  if (!o.ctx) { $('#report').innerHTML = `<div class="card red">${o.err}</div>`; return; }
  const ctx = o.ctx, M = ctx.M, TP = Object.assign({}, Engine.TREND_DEFAULTS, ctx.P);
  const m = S.replayM == null ? M.n - 1 : S.replayM;
  const ev = S.replayM == null ? o.ev : Engine.evaluateTrend(ctx, M.t[m] + 900);
  const rep = S.replayM == null ? o.rep : Engine.evaluateAt(ctx, m);
  o.tview = ev; o.view = rep;
  const replayBox = `<details class="card" style="margin-top:12px" ${S.replayM != null ? 'open' : ''}><summary>🕘 تست روی گذشته (تحلیل را در هر لحظه‌ی دلخواه ببینید)</summary>
      <div class="toolbar" style="margin:8px 0 0"><span>زمان: <b class="num" id="rpT">${fmtT(M.t[m] + 900)}</b></span><button id="rpLive" class="primary">برگشت به زنده</button></div>
      <input id="replay" type="range" min="${Math.min(M.n - 1, 200)}" max="${M.n - 1}" value="${m}"></details>`;
  if (ev.error) { $('#report').innerHTML = `<div class="card amber">${ev.error}</div>` + replayBox; bindReplay(); return; }
  const price = ev.price, a4 = ev.h4.atr, d = ev.daily, ch = chg24(M);
  const st = S.replayM == null ? o.status : trendStatus(Object.assign({}, o, { ev }));
  const trTxt = ev.trend > 0 ? '<b class="green">صعودی</b>' : ev.trend < 0 ? '<b class="red">نزولی</b>' : '<b>خنثی</b>';
  const why = [d.c > d.e50 ? 'قیمت بالای EMA50' : 'قیمت زیر EMA50', d.e20 > d.e50 ? 'EMA20 بالای EMA50' : 'EMA20 زیر EMA50'];
  const pHi = (ev.h4.hi - price) / price * 100, pLo = (ev.h4.lo - price) / price * 100;
  const kz = !rep.error ? keyZones(rep.daily, price) : { res: [], sup: [], inside: [], list: [] };
  const zTxt = z => `${rng(z)} <span class="mute">(${z.touches} برخورد)</span>`;

  let concl;
  if (ev.signal) concl = `<b class="green">سیگنال ورود ${ev.signal.dir === 'LONG' ? 'خرید' : 'فروش'} همین الان صادر شده است.</b>`;
  else if (ev.open) concl = `یک معامله‌ی ${ev.open.dir === 'LONG' ? 'خرید' : 'فروش'} باز است؛ فقط حد ضرر دنبال‌کننده را به‌روز نگه دارید (${num(fmtP(ev.open.stop))}).`;
  else if (ev.pending) concl = `<b class="amber">شکست ۴ساعته رخ داده؛ در ۱۵ دقیقه منتظر پولبک و ماشه‌ی ورود هستیم.</b>`;
  else if (ev.trend === 0) concl = 'روند روزانه مشخص نیست؛ طبق استراتژی معامله‌ای نمی‌گیریم تا روند شکل بگیرد.';
  else concl = `منتظر شکست ${ev.trend > 0 ? 'سقف' : 'کف'} ۴ساعته در ${num(fmtP(ev.trend > 0 ? ev.h4.hi : ev.h4.lo))} هستیم (${num(fmtN(Math.abs(ev.trend > 0 ? pHi : pLo)))}% فاصله). تا آن موقع تایم ۱۵ دقیقه لازم نیست.`;

  const scen = dir => {
    const L = dir === 'LONG', ok = L ? ev.trend > 0 : ev.trend < 0, lvl = L ? ev.h4.hi : ev.h4.lo;
    const stop = L ? lvl - TP.trK * a4 : lvl + TP.trK * a4, riskPct = TP.trK * a4 / lvl * 100;
    const fail = L ? lvl - TP.trFailAtr * a4 : lvl + TP.trFailAtr * a4;
    const status = !ok ? `<span class="mute">⛔ غیرفعال: روند روزانه ${L ? 'صعودی' : 'نزولی'} نیست</span>`
      : ev.pending && ev.pending.dir === dir ? '<b class="amber">⏳ شکست رخ داده — منتظر ماشه‌ی ۱۵ دقیقه</b>'
      : ev.open && ev.open.dir === dir ? '<b class="green">📌 معامله باز است</b>'
      : `⏳ قیمت ${num(fmtN(Math.abs(L ? pHi : pLo)))}% با سطح شکست فاصله دارد`;
    return `<div class="card scen ${ok ? 'main' : 'off'}"><h3>${dirBadge(dir)} ${L ? 'شکست سقف ۴ساعته' : 'شکست کف ۴ساعته'}</h3><div>${status}</div>
      <p style="margin:8px 0">اگر یک کندل ۴ساعته ${L ? 'بالای سقف' : 'زیر کف'} ${TP.trN} کندل اخیر یعنی ${num(fmtP(lvl))} بسته شود، تا ${fmtN(TP.trWin / 4, 0)} ساعت در ۱۵ دقیقه منتظر می‌مانیم
      قیمت به حدود ${num(fmtP(lvl))} برگردد و یک کندل ${L ? 'سبز بالای' : 'قرمز زیر'} EMA20 بسته شود. حد ضرر اولیه ${TP.trK}×ATR از ورود است و حد سود ثابت ندارد؛
      با هر کندل ۴ساعته حد ضرر به فاصله‌ی ${TP.trK}×ATR پشت قیمت جابه‌جا می‌شود. اگر ۱۵ دقیقه ${L ? 'زیر' : 'بالای'} ${num(fmtP(fail))} بسته شود، شکست باطل است.</p>
      <div class="kv"><div><span>سطح شکست / ورود تقریبی</span>${num(fmtP(lvl))}</div><div><span>حد ضرر اولیه (تقریبی)</span>${num(fmtP(stop))}</div>
      <div><span>ریسک تا حد ضرر</span>${num(fmtN(riskPct) + '%')}</div><div><span>ATR ۴ساعته</span>${num(fmtP(a4))}</div><div><span>سطح ابطال</span>${num(fmtP(fail))}</div></div></div>`;
  };

  // 15m card
  let m15;
  const e20 = ctx.M.e20 ? ctx.M.e20[ev.m] : NaN;
  if (ev.signal) {
    const s = ev.signal;
    m15 = `<div class="card signal ${s.dir === 'SHORT' ? 'short' : ''}" style="padding:10px"><div class="big">🎯 ورود ${dirBadge(s.dir)}</div>
      <div class="kv"><div><span>ورود</span>${num(fmtP(s.entry))}</div><div><span>حد ضرر اولیه</span>${num(fmtP(s.sl))}</div><div><span>ریسک</span>${num(fmtN(Math.abs(s.entry - s.sl) / s.entry * 100) + '%')}</div><div><span>حد سود</span>ندارد (دنبال‌کننده)</div></div>
      <p style="margin:8px 0 0">${sizeHint(s.entry, s.sl)}</p></div>`;
  } else if (ev.open) {
    const t = ev.open, r = curR(t, price);
    m15 = `<p><b>معامله‌ی باز ${dirBadge(t.dir)}</b> از ${fmtT(t.entryTime)}</p><div class="kv"><div><span>ورود</span>${num(fmtP(t.entry))}</div><div><span>حد ضرر فعلی (دنبال‌کننده)</span><b class="num red">${fmtP(t.stop)}</b></div>
      <div><span>وضعیت</span><b class="num ${r >= 0 ? 'green' : 'red'}">${fmtN(r)}R</b></div><div><span>حد ضرر اولیه</span>${num(fmtP(t.sl))}</div></div>
      <p class="mute" style="margin-top:8px">در صرافی، حد ضرر را روی ${num(fmtP(t.stop))} قرار دهید و بعد از بسته شدن هر کندل ۴ساعته اینجا را برای مقدار جدید چک کنید. خروج فقط با خوردن حد ضرر است.</p>`;
  } else if (ev.pending) {
    const p = ev.pending, L = p.dir === 'LONG', li = (ok, t) => `<li>${ok ? '✅' : '⬜'} ${t}</li>`;
    m15 = `<p><b class="amber">انتظار ورود ${L ? 'خرید' : 'فروش'} داریم.</b></p><ul class="chk">
      ${li(true, `شکست ${L ? 'سقف' : 'کف'} ۴ساعته در ${num(fmtP(p.level))} (${fmtT(p.time)})`)}
      ${li(!!p.touched, `پولبک ۱۵ دقیقه به ${num(fmtP(L ? p.level + TP.trTouchAtr * p.atr : p.level - TP.trTouchAtr * p.atr))} یا ${L ? 'پایین‌تر' : 'بالاتر'}`)}
      ${li(false, `بسته شدن کندل ${L ? 'سبز بالای' : 'قرمز زیر'} EMA20 (${num(fmtP(e20))})`)}</ul>
      <p class="mute">ابطال: بسته شدن ۱۵م ${L ? 'زیر' : 'بالای'} ${num(fmtP(L ? p.level - TP.trFailAtr * p.atr : p.level + TP.trFailAtr * p.atr))} · مهلت تا ${fmtT(p.expire)}</p>
      <p class="mute">${sizeHint(p.level, L ? p.level - TP.trK * p.atr : p.level + TP.trK * p.atr)}</p>`;
  } else m15 = `<p><b>در تایم ۱۵ دقیقه فعلاً کاری نداریم.</b></p><p>${ev.trend === 0 ? 'روند روزانه خنثی است.' : `اول باید کندل ۴ساعته ${ev.trend > 0 ? 'بالای' : 'زیر'} ${num(fmtP(ev.trend > 0 ? ev.h4.hi : ev.h4.lo))} بسته شود. با حالت خودکار، شکست و ورود اعلام می‌شود.`}</p>`;

  $('#report').innerHTML = `
  <div class="card"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <h2>${short(o.sym)} <span class="mute" style="font-size:13px">/USDT</span></h2>
    <span class="big num">${fmtP(price)}</span><span class="num ${ch >= 0 ? 'green' : 'red'}">${fmtPct(ch)} (۲۴ساعت)</span>
    ${dirBadge(ev.trend > 0 ? 'BULL' : ev.trend < 0 ? 'BEAR' : 'RANGE')}<span class="wl-st ${st.cls}" style="font-size:14px">${st.txt}</span>
    <div class="spacer"></div><span class="mute" style="font-size:12px">استراتژی روند · ${S.replayM == null ? 'زنده' : '🕘 تست گذشته'} · ${fmtT(ev.time)}</span></div></div>
  <div class="card" style="margin-top:12px"><h3>📋 تحلیل وضعیت</h3>
    <p><b>روند روزانه:</b> ${trTxt} — ${why.join('، ')}. ${ev.trend > 0 ? 'فقط معامله‌ی خرید مجاز است.' : ev.trend < 0 ? 'فقط معامله‌ی فروش مجاز است.' : 'معامله‌ای مجاز نیست.'}</p>
    <p><b>کانال ۴ساعته (${TP.trN} کندل اخیر):</b> سقف ${num(fmtP(ev.h4.hi))} <span class="mute">(${fmtPct(pHi)})</span> و کف ${num(fmtP(ev.h4.lo))} <span class="mute">(${fmtPct(pLo)})</span>؛ ATR ۴ساعته ${num(fmtP(a4))} (${num(fmtN(a4 / price * 100))}% قیمت).</p>
    <p><b>سطوح مهم روزانه:</b> مقاومت ${kz.res.length ? kz.res.slice(0, 2).map(zTxt).join('، ') : '—'} · حمایت ${kz.sup.length ? kz.sup.slice(0, 2).map(zTxt).join('، ') : '—'}${kz.inside.length ? ` · <span class="amber">قیمت داخل ناحیه‌ی ${rng(kz.inside[0])}</span>` : ''}</p>
    <p style="margin:0;padding-top:6px;border-top:1px dashed var(--line)"><b>جمع‌بندی:</b> ${concl}</p></div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>📈 روزانه — روند، سطوح و کانال</h3><div class="chartbox"><canvas id="cD"></canvas><div class="cinfo" id="iD"></div></div></div>
    <div class="card"><h3>📈 ۴ ساعته — کانال شکست (نارنجی)</h3><div class="chartbox"><canvas id="cH"></canvas><div class="cinfo" id="iH"></div></div></div>
  </div>
  <div class="grid g2" style="margin-top:12px">${scen('LONG')}${scen('SHORT')}</div>
  <div class="card" style="margin-top:12px"><h3>🎯 تایم ۱۵ دقیقه — ورود و مدیریت معامله</h3>
    <div class="grid g2"><div class="chartbox small"><canvas id="cM"></canvas><div class="cinfo" id="iM"></div></div><div>${m15}</div></div></div>
  <div class="card" style="margin-top:12px"><h3>🧾 معاملات اخیر این ارز (بک‌تست استراتژی روند)</h3>${tradesTable(o.bt.trades.slice(-10).reverse().map(t => ({ t, sym: o.sym })), true)}</div>` + replayBox;
  bindTradeRows($('#report')); bindReplay();
  rc = { D: new Chart($('#cD'), $('#iD')), H: new Chart($('#cH'), $('#iH')), M: new Chart($('#cM'), $('#iM')) };
  redrawTrendCharts();
}
function redrawTrendCharts() {
  const o = S.O[S.sel]; if (!o || !o.tview || o.tview.error || !rc.D) return;
  const ctx = o.ctx, ev = o.tview, rep = o.view, price = ev.price;
  const zones = rep && !rep.error ? keyZones(rep.daily, price).list : [];
  let chan = null;
  if (rep && !rep.error) { const ch = rep.daily.chan, t0 = ctx.D.t[ch.startIdx]; chan = { t0, t1: ctx.D.t[ch.endIdx] + 86400 * 3, f: t => ch.at((t - t0) / 86400) }; }
  const trades = ev.bt.trades;
  rc.D.setData(ctx.D, 86400, { price, zones, zoneLabels: true, chan, emas: [{ arr: ctx.D.e20, color: '#60a5fa' }, { arr: ctx.D.e50, color: '#c084fc' }], showVol: true, title: 'Daily · EMA20/50', end: ev.j, view: 120 });
  const hl4 = [];
  if (ev.open) hl4.push({ p: ev.open.stop, c: '#ef4444', t: 'حد ضرر فعلی' });
  rc.H.setData(ctx.H, 14400, { price, zones: zones.filter(z => z.important), emas: [{ arr: ctx.H.dHi, color: '#f59e0b' }, { arr: ctx.H.dLo, color: '#f59e0b' }], trades, hlines: hl4, showVol: true, title: '4H · Donchian ' + (ctx.TP ? ctx.TP.trN : 40), end: ev.i, view: 150 });
  const hl = [];
  if (ev.pending) { const p = ev.pending, TP = ctx.TP; hl.push({ p: p.level, c: '#f59e0b', t: 'سطح شکست' }, { p: p.dir === 'LONG' ? p.level - TP.trFailAtr * p.atr : p.level + TP.trFailAtr * p.atr, c: '#ef4444', t: 'ابطال' }); }
  if (ev.open) hl.push({ p: ev.open.entry, c: '#3b82f6', t: 'ورود' }, { p: ev.open.stop, c: '#ef4444', t: 'حد ضرر' });
  rc.M.setData(ctx.M, 900, { price, emas: [{ arr: ctx.M.e20, color: '#60a5fa' }], trades, hlines: hl, showVol: true, title: '15m · EMA20', end: ev.m, view: 140 });
}

/* ---------------- PORTFOLIO SIM ---------------- */
const PORT_FIELDS = [
  ['capital', 'سرمایه اولیه (USDT)', 10], ['riskPct', 'ریسک هر معامله (% موجودی)', 0.25],
  ['mode', 'نوع بازار', 'mode'], ['leverage', 'حداکثر اهرم (فقط فیوچرز)', 1],
  ['maxOpen', 'حداکثر معاملات همزمان', 1], ['maxSameDir', 'حداکثر معاملات هم‌جهت', 1],
  ['takerFee', 'کارمزد Taker (%) — ورود/حد ضرر', 0.01], ['makerFee', 'کارمزد Maker (%) — حد سود', 0.01],
  ['slipPct', 'لغزش قیمت (%)', 0.01], ['fundingPct8h', 'فاندینگ هر ۸ ساعت (%) — فیوچرز', 0.005],
  ['minNotional', 'حداقل حجم سفارش (USDT)', 1],
];
function renderPortForm() {
  const f = $('#portForm'); if (!f) return;
  f.innerHTML = PORT_FIELDS.map(([k, label, step]) => step === 'mode'
    ? `<label class="set-row" style="grid-template-columns:1fr"><span class="mute" style="font-size:12px">${label}</span>
        <select data-pk="mode"><option value="spot" ${S.port.mode === 'spot' ? 'selected' : ''}>اسپات (فقط خرید، بدون اهرم)</option>
        <option value="futures" ${S.port.mode === 'futures' ? 'selected' : ''}>فیوچرز (خرید و فروش)</option></select></label>`
    : `<label class="set-row" style="grid-template-columns:1fr"><span class="mute" style="font-size:12px">${label}</span>
        <input type="number" step="${step}" data-pk="${k}" value="${S.port[k]}" style="width:100%;direction:ltr"></label>`).join('');
  f.querySelector('[data-pk=mode]').onchange = e => {
    const fut = e.target.value === 'futures';
    f.querySelector('[data-pk=takerFee]').value = fut ? 0.06 : 0.1;
    f.querySelector('[data-pk=makerFee]').value = fut ? 0.02 : 0.1;
  };
  $('#btnPort').onclick = () => {
    f.querySelectorAll('[data-pk]').forEach(i => { S.port[i.dataset.pk] = i.dataset.pk === 'mode' ? i.value : Number(i.value); });
    LS.set('scanner.port.v3', S.port); runPort();
  };
}
function runPort() {
  const out = $('#portOut'); if (!out) return;
  const list = S.syms.map(s => S.O[s]).filter(o => o.bt).map(o => ({ sym: o.sym, trades: o.bt.trades, lastPrice: o.ctx.M.c[o.ctx.M.n - 1] }));
  const r = Engine.portfolio(list, S.port); S.portRes = r;
  const $u = x => num((x < 0 ? '-' : '') + '$' + fmtN(Math.abs(x)));
  const gross = r.trades.reduce((s, p) => s + p.pnl + p.entryFee + p.exitFee + p.fund, 0);
  const skipped = Object.entries(r.skipped);
  out.innerHTML = `
  <div class="grid g4" style="margin-top:12px">
    <div class="card"><h3>موجودی نهایی</h3><div class="big num ${r.final >= r.opt.capital ? 'green' : 'red'}">$${fmtN(r.final)}</div>
      <small class="mute">از $${r.opt.capital} · بازده ${num(fmtPct(r.retPct))}${r.openPos.length ? ` · ${r.openPos.length} معامله باز (${$u(r.unreal)} سود/زیان شناور)` : ''}</small></div>
    <div class="card"><h3>کل کارمزدها</h3><div class="big num amber">$${fmtN(r.fees + r.funding)}</div>
      <small class="mute">معاملات ${$u(r.fees)}${r.opt.mode === 'futures' ? ` + فاندینگ ${$u(r.funding)}` : ''} · ${fmtN((r.fees + r.funding) / r.opt.capital * 100, 1)}% سرمایه اولیه${gross > 0 ? ` · ${fmtN((r.fees + r.funding) / gross * 100, 0)}% سود ناخالص` : ''}</small></div>
    <div class="card"><h3>بیشترین افت سرمایه</h3><div class="big num red">${fmtN(r.maxDD, 1)}%</div><small class="mute">${$u(-r.maxDDusd)} · بیشترین ضرر پیاپی: ${r.maxStreak} معامله</small></div>
    <div class="card"><h3>معاملات انجام‌شده</h3><div class="big">${r.taken}</div>
      <small class="mute">برد ${fmtN(r.winRate, 0)}% · PF ${fmtN(r.pf)} · میانگین سود ${$u(r.avgWin)} / ضرر ${$u(r.avgLoss)}</small></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>منحنی موجودی (USDT)</h3><canvas class="eq" id="portCanvas"></canvas></div>
    <div class="card"><h3>نتیجه‌ی ماهانه</h3><table><tr><th>ماه (میلادی)</th><th>معاملات</th><th>سود/زیان</th><th>درصد</th></tr>
      ${Object.entries(r.months).map(([k, v]) => `<tr><td class="num">${k}</td><td>${v.n}</td><td class="${v.pnl >= 0 ? 'green' : 'red'}">${$u(v.pnl)}</td><td class="num ${v.pnl >= 0 ? 'green' : 'red'}">${fmtPct(v.pnl / v.start * 100)}</td></tr>`).join('')}</table>
      ${skipped.length ? `<h3 style="margin-top:12px">سیگنال‌های ردشده توسط مدیریت سرمایه</h3><ul style="margin:0">${skipped.map(([k, v]) => `<li>${k}: <b>${v}</b></li>`).join('')}</ul>` : ''}</div>
  </div>
  <div class="card" style="margin-top:12px"><h3>معاملات با سرمایه‌ی واقعی</h3><div class="scroll"><table>
    <tr><th>ارز</th><th>جهت</th><th>ورود</th><th>خروج</th><th>حجم معامله</th><th>ریسک</th><th>کارمزد</th><th>نتیجه</th><th>سود/زیان خالص</th><th>موجودی</th></tr>
    ${r.trades.slice().sort((a, b) => b.exitTime - a.exitTime).map(p => `<tr><td><b>${short(p.sym)}</b></td><td>${dirBadge(p.dir > 0 ? 'LONG' : 'SHORT')}</td>
      <td class="num">${fmtT(p.entryTime)}</td><td class="num">${fmtT(p.exitTime)}</td><td>${$u(p.notional)}${p.capped ? ' <span class="amber" title="به‌خاطر سقف سرمایه/اهرم کوچک‌تر شد">*</span>' : ''}</td>
      <td>${$u(p.riskUsd)}</td><td class="amber">${$u(p.entryFee + p.exitFee + p.fund)}</td><td>${p.why}</td>
      <td class="${p.pnl >= 0 ? 'green' : 'red'}">${$u(p.pnl)}</td><td>${$u(p.balance)}</td></tr>`).join('')}</table></div>
    <div class="mute" style="font-size:12px;margin-top:6px">* حجم به‌خاطر سقف سرمایه (اسپات) یا اهرم (فیوچرز) کوچک‌تر از مقدار ریسک‌محور شده است. ورود و حد ضرر Market (Taker) با لغزش، حد سود Limit (Maker) فرض شده است.</div></div>`;
  drawLine(document.getElementById('portCanvas'), [r.opt.capital, ...r.curve.slice(1).map(c => c.eq)], '$', r.opt.capital);
}
function drawLine(cv, pts, unit, base) {
  if (!cv || !cv.offsetWidth || pts.length < 2) return;
  const dpr = window.devicePixelRatio || 1, W = cv.offsetWidth, H = cv.offsetHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.direction = 'ltr'; g.clearRect(0, 0, W, H);
  const mn = Math.min(...pts), mx = Math.max(...pts);
  const y = v => H - 20 - (v - mn) / ((mx - mn) || 1) * (H - 40), x = i => 50 + i / (pts.length - 1) * (W - 66);
  g.strokeStyle = '#26324f'; g.beginPath(); g.moveTo(50, y(base)); g.lineTo(W - 16, y(base)); g.stroke();
  g.fillStyle = '#8b96b0'; g.font = '11px Tahoma';
  g.fillText(unit + fmtN(base, 0), 4, y(base) + 4);
  if (Math.abs(y(mx) - y(base)) > 14) g.fillText(unit + fmtN(mx, 1), 4, y(mx) + 4);
  if (Math.abs(y(mn) - y(base)) > 14) g.fillText(unit + fmtN(mn, 1), 4, y(mn) + 4);
  g.strokeStyle = pts[pts.length - 1] >= base ? '#22c55e' : '#ef4444'; g.lineWidth = 2; g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(x(i), y(p)) : g.moveTo(x(i), y(p))); g.stroke();
}

/* ---------------- SETTINGS ---------------- */
const SET_DEF = [
  ['استراتژی', [['strategy', 'استراتژی فعال', 'strategy']]],
  ['استراتژی روند (شکست ۴ساعته + ورود ۱۵م)', [['trN', 'تعداد کندل ۴ساعته برای سقف/کف شکست'], ['trK', 'حد ضرر و حد ضرر دنبال‌کننده (×ATR 4H)', 0.5], ['trWin', 'مهلت پولبک ۱۵ دقیقه (تعداد کندل ۱۵م)'], ['trTouchAtr', 'محدوده‌ی پولبک به سطح شکست (×ATR)', 0.05], ['trFailAtr', 'ابطال شکست اگر قیمت این‌قدر برگردد (×ATR)', 0.1], ['trPartialR', 'خروج نصف حجم در این R و انتقال حد ضرر به ورود (۰ = خاموش)', 0.5]]],
  ['روند روزانه', [['dEmaFast', 'EMA سریع روزانه'], ['dEmaSlow', 'EMA کند روزانه'], ['dSlopeBars', 'تعداد کندل برای شیب EMA'], ['dSlopeMin', 'حداقل شیب معنادار (×ATR)', 0.01]]],
  ['سطوح و کانال روزانه', [['pivotLR', 'قدرت Pivot (کندل چپ/راست)'], ['levelLookback', 'بازه جستجوی سطوح (کندل روزانه)'], ['levelClusterAtr', 'تلرانس ادغام سطوح (×ATR)', 0.1], ['levelMaxDistAtr', 'حداکثر فاصله سطح از قیمت (×ATR)', 0.5], ['chanLen', 'طول کانال رگرسیونی (کندل روزانه)']]],
  ['موقعیت ۴ ساعته', [['h4ZoneAtr', 'حداکثر فاصله تا ناحیه (×ATR 4H)', 0.1], ['h4TouchBars', 'تعداد کندل اخیر برای لمس ناحیه'], ['h4ChanLow', 'محدوده کف کانال (۰ تا ۱)', 0.05], ['h4ChanHigh', 'محدوده سقف کانال (۰ تا ۱)', 0.05]]],
  ['حجم', [['volSma', 'میانگین حجم برای RVOL'], ['volFast', 'میانگین کوتاه روند حجم'], ['volSlow', 'میانگین بلند روند حجم'], ['rvolMin', 'حداقل RVOL کندل ماشه', 0.1]]],
  ['ماشه ۱۵ دقیقه', [['m15Ema', 'EMA تایم ۱۵ دقیقه'], ['m15BreakBars', 'شکست سقف/کف چند کندل قبل'], ['m15SetupBars', 'بازه‌ی پولبک (کندل ۱۵م)']]],
  ['مدیریت ریسک', [['slAtr4h', 'بافر حد ضرر (×ATR 4H)', 0.05], ['maxRiskPct', 'حداکثر فاصله حد ضرر (%)', 0.5], ['minRR', 'حداقل R:R', 0.1], ['maxRR', 'سقف R:R حد سود', 0.5], ['maxTradeBars', 'حداکثر مدت معامله (کندل ۱۵م)'], ['feePct', 'کارمزد هر طرف (%)', 0.01], ['cooldownBars', 'استراحت بعد از هر معامله (کندل)']]],
  ['بهبودها', [['zoneLockDays', 'قفل ناحیه بعد از حد ضرر (روز، ۰ = خاموش)'], ['partialR', 'خروج نصف حجم در این R (۰ = خاموش)', 0.1], ['requireConfirm', 'کندل تأیید ۴ساعته اجباری', 'bool']]],
  ['فیلتر نهایی', [['minScore', 'حداقل امتیاز سیگنال (۰ تا ۱۰۰)'], ['enableLong', 'سیگنال Long', 'bool'], ['enableShort', 'سیگنال Short', 'bool'], ['allowCounter', 'اجازه‌ی معامله خلاف روند روزانه', 'bool']]],
];
function renderSettings() {
  $('#setBody').innerHTML = SET_DEF.map(([g, rows]) => `<div class="card set-group"><h4>${g}</h4>${rows.map(([k, label, step]) =>
    step === 'strategy' ? `<div class="set-row" style="grid-template-columns:1fr 260px"><span>${label}</span><select data-k="${k}">
        <option value="trend" ${S.params.strategy === 'trend' ? 'selected' : ''}>روند: شکست ۴ساعته + پولبک ۱۵م (پیشنهادی)</option>
        <option value="levels" ${S.params.strategy === 'levels' ? 'selected' : ''}>برگشت از سطوح (قدیمی)</option></select></div>` :
    step === 'bool' ? `<div class="set-row"><span>${label}</span><input type="checkbox" data-k="${k}" ${S.params[k] ? 'checked' : ''}></div>`
      : `<div class="set-row"><span>${label} <small class="mute">(پیش‌فرض ${Engine.DEFAULTS[k]})</small></span><input type="number" step="${step || 1}" data-k="${k}" value="${S.params[k]}"></div>`).join('')}</div>`).join('');
}
$('#btnSaveSet').onclick = () => {
  document.querySelectorAll('#setBody [data-k]').forEach(inp => { S.params[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? inp.value : Number(inp.value); });
  LS.set('scanner.params', S.params);
  if (S.data) buildAll();
  alert('تنظیمات ذخیره شد و تحلیل و بک‌تست همه‌ی ارزها دوباره اجرا شد.');
};
$('#btnResetSet').onclick = () => { S.params = Object.assign({}, Engine.DEFAULTS); LS.set('scanner.params', {}); renderSettings(); if (S.data) buildAll(); };

/* ---------------- CHART CLASS ---------------- */
class Chart {
  constructor(cv, info) {
    this.cv = cv; this.info = info; this.start = 0; this.count = 160; this.mouse = null; this.drag = null;
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.offsetX); }, { passive: false });
    cv.addEventListener('mousedown', e => { this.drag = { x: e.offsetX, s: this.start }; });
    window.addEventListener('mouseup', () => { this.drag = null; });
    cv.addEventListener('mousemove', e => { this.mouse = { x: e.offsetX, y: e.offsetY };
      if (this.drag) { this.start = this.drag.s - (e.offsetX - this.drag.x) / this.cw(); this.clamp(); } this.draw(); });
    cv.addEventListener('mouseleave', () => { this.mouse = null; this.draw(); });
    window.addEventListener('resize', () => this.draw());
  }
  plotW() { return this.W - 74; }
  cw() { return this.plotW() / this.count; }
  clamp() { const n = this.S ? this.S.n : 0; this.count = Math.max(20, Math.min(Math.max(n, 20) * 1.2, this.count));
    this.start = Math.max(-this.count * 0.8, Math.min(n - this.count * 0.2, this.start)); }
  zoom(f, mx) { const at = this.start + mx / this.cw(); this.count *= f; this.clamp(); this.start = at - mx / this.cw(); this.clamp(); this.draw(); }
  setData(S, sec, ov, keepView) {
    const changed = this.S !== S; this.S = S; this.sec = sec; this.ov = ov;
    if (changed && !keepView) { const end = ov.end != null ? ov.end : S.n - 1, v = ov.view || 160; this.count = v; this.start = end - v + 1 + Math.round(v * 0.08); this.clamp(); }
    this.draw();
  }
  fit() { this.count = this.S.n + 10; this.start = -2; this.clamp(); }
  centerOn(ts) { if (!this.S) return; const i = this.idxAt(ts); this.count = 200; this.start = i - 80; this.clamp(); this.draw(); }
  idxAt(ts) { const t = this.S.t; let lo = 0, hi = t.length - 1, a = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] <= ts) { a = m; lo = m + 1; } else hi = m - 1; } return a; }
  tx(ts) { const i = this.idxAt(ts); return (i + 0.5 + (ts - this.S.t[i]) / this.sec - this.start) * this.cw(); }
  ix(i) { return (i - this.start + 0.5) * this.cw(); }
  draw() {
    const cv = this.cv; if (!cv.isConnected || !cv.offsetWidth || !this.S) return;
    const dpr = window.devicePixelRatio || 1; this.W = cv.offsetWidth; this.H = cv.offsetHeight;
    cv.width = this.W * dpr; cv.height = this.H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.direction = 'ltr'; g.textAlign = 'left';
    const S = this.S, ov = this.ov, W = this.W, H = this.H, pw = this.plotW(), cw = this.cw();
    const volH = ov.showVol ? Math.min(70, H * 0.14) : 0, ph = H - 24 - volH;
    g.fillStyle = '#121a2e'; g.fillRect(0, 0, W, H);
    const s = Math.max(0, Math.floor(this.start)), e = Math.min(S.n - 1, Math.ceil(this.start + this.count));
    if (e < s) return;
    let mn = Infinity, mx = -Infinity, vmx = 0;
    for (let i = s; i <= e; i++) { mn = Math.min(mn, S.l[i]); mx = Math.max(mx, S.h[i]); vmx = Math.max(vmx, S.q[i]); }
    for (const hl of ov.hlines || []) { mn = Math.min(mn, hl.p); mx = Math.max(mx, hl.p); }
    if (ov.plan) for (const v of [ov.plan.sl, ov.plan.tp1]) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const pad = (mx - mn) * 0.07; mn -= pad; mx += pad;
    const y = p => 8 + (mx - p) / (mx - mn) * (ph - 8);
    g.save(); g.beginPath(); g.rect(0, 0, pw, ph); g.clip();
    g.strokeStyle = '#1c2640'; g.lineWidth = 1; g.font = '11px Consolas,monospace';
    const stepP = niceStep((mx - mn) / 7);
    for (let p = Math.ceil(mn / stepP) * stepP; p < mx; p += stepP) { g.beginPath(); g.moveTo(0, y(p)); g.lineTo(pw, y(p)); g.stroke(); }
    // zones
    const usedY = [];
    for (const z of ov.zones || []) {
      if (z.hi < mn || z.lo > mx) continue;
      const sup = z.kind ? z.kind === 'S' : z.mid < ov.price, inside = z.kind === 'IN';
      const a = z.important ? 0.2 : 0.09;
      g.fillStyle = inside ? `rgba(245,158,11,${a})` : sup ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
      g.fillRect(0, y(z.hi), pw, Math.max(2, y(z.lo) - y(z.hi)));
      if (z.important) { g.strokeStyle = inside ? '#f59e0b88' : sup ? '#22c55e88' : '#ef444488'; g.strokeRect(0, y(z.hi), pw, Math.max(2, y(z.lo) - y(z.hi))); }
      let ly = y(z.hi) + 2;
      while (usedY.some(u => Math.abs(u - ly) < 15)) ly += 15;
      usedY.push(ly);
      if (ov.zoneLabels) {
        const lb = `${inside ? 'داخل ناحیه' : sup ? 'حمایت' : 'مقاومت'} ${fmtP(z.lo)}–${fmtP(z.hi)} · ${z.touches}×${z.important ? ' ⭐' : ''}`;
        g.font = '11px Tahoma'; const tw = g.measureText(lb).width;
        g.fillStyle = '#0b1020cc'; g.fillRect(pw - tw - 12, ly, tw + 8, 15);
        g.fillStyle = inside ? '#fbbf24' : sup ? '#4ade80' : '#f87171'; g.fillText(lb, pw - tw - 8, ly + 11);
        g.font = '11px Consolas,monospace';
      }
    }
    // channel
    if (ov.chan) {
      const c = ov.chan, xs = [c.t0, c.t1].map(t => this.tx(t)), pts = [c.t0, c.t1].map(t => c.f(t));
      [['upper', '#f59e0b'], ['mid', '#64748b'], ['lower', '#f59e0b']].forEach(([k, col]) => {
        g.strokeStyle = col; g.setLineDash(k === 'mid' ? [4, 4] : []); g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(xs[0], y(pts[0][k])); g.lineTo(xs[1], y(pts[1][k])); g.stroke(); });
      g.setLineDash([]);
    }
    // candles
    const bw = Math.max(1, cw * 0.7);
    for (let i = s; i <= e; i++) {
      const x = this.ix(i), up = S.c[i] >= S.o[i];
      g.strokeStyle = g.fillStyle = up ? '#22c55e' : '#ef4444';
      g.beginPath(); g.moveTo(x, y(S.h[i])); g.lineTo(x, y(S.l[i])); g.stroke();
      const top = y(Math.max(S.o[i], S.c[i])), bot = y(Math.min(S.o[i], S.c[i]));
      g.fillRect(x - bw / 2, top, bw, Math.max(1, bot - top));
    }
    for (const em of ov.emas || []) {
      g.strokeStyle = em.color; g.lineWidth = 1.4; g.beginPath(); let st = false;
      for (let i = s; i <= e; i++) { const v = em.arr[i]; if (isNaN(v)) continue; st ? g.lineTo(this.ix(i), y(v)) : g.moveTo(this.ix(i), y(v)); st = true; }
      g.stroke();
    }
    // trades
    for (const t of ov.trades || []) {
      const x0 = this.tx(t.entryTime), x1 = t.exitTime ? this.tx(t.exitTime) : this.ix(S.n - 1);
      if (x1 < -50 || x0 > pw + 50) continue;
      const L = t.dir === 'LONG';
      g.fillStyle = 'rgba(239,68,68,.13)'; g.fillRect(x0, Math.min(y(t.entry), y(t.sl)), Math.max(2, x1 - x0), Math.abs(y(t.sl) - y(t.entry)));
      if (t.tp1 != null) { g.fillStyle = 'rgba(34,197,94,.13)'; g.fillRect(x0, Math.min(y(t.entry), y(t.tp1)), Math.max(2, x1 - x0), Math.abs(y(t.tp1) - y(t.entry))); }
      g.fillStyle = L ? '#22c55e' : '#ef4444'; tri(g, x0, y(t.entry), L);
      if (t.exitTime) { g.fillStyle = t.R > 0 ? '#22c55e' : '#ef4444'; g.beginPath(); g.arc(x1, y(t.exit), 4, 0, 7); g.fill(); }
      if (t === S_focus()) { g.strokeStyle = '#fff'; g.strokeRect(x0 - 3, Math.min(y(t.sl), y(t.tp1)) - 3, Math.max(6, x1 - x0 + 6), Math.abs(y(t.sl) - y(t.tp1)) + 6); }
    }
    if (ov.end != null && ov.end < S.n - 1) { const x = this.ix(ov.end) + cw / 2; g.strokeStyle = '#8b5cf6'; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, ph); g.stroke(); g.setLineDash([]); }
    g.restore();
    // horizontal lines
    const hls = (ov.hlines || []).slice();
    if (ov.plan) hls.push({ p: ov.plan.entry, c: '#3b82f6', t: 'ورود' }, { p: ov.plan.sl, c: '#ef4444', t: 'SL' }, { p: ov.plan.tp1, c: '#22c55e', t: 'TP' });
    for (const hl of hls) { g.strokeStyle = hl.c; g.setLineDash([5, 3]); g.beginPath(); g.moveTo(0, y(hl.p)); g.lineTo(pw, y(hl.p)); g.stroke(); g.setLineDash([]);
      g.font = '11px Tahoma'; g.fillStyle = hl.c; g.fillText(`${hl.t} ${fmtP(hl.p)}`, 6, y(hl.p) - 4); g.font = '11px Consolas,monospace'; }
    // volume
    if (volH) { const vy = H - 24 - volH;
      for (let i = s; i <= e; i++) { const hh = S.q[i] / vmx * (volH - 6);
        g.fillStyle = S.c[i] >= S.o[i] ? 'rgba(34,197,94,.4)' : 'rgba(239,68,68,.4)'; g.fillRect(this.ix(i) - bw / 2, vy + volH - hh, bw, hh); } }
    // price axis
    g.fillStyle = '#121a2e'; g.fillRect(pw, 0, W - pw, H); g.fillStyle = '#8b96b0';
    for (let p = Math.ceil(mn / stepP) * stepP; p < mx; p += stepP) g.fillText(fmtP(p), pw + 5, y(p) + 4);
    const li = ov.end != null ? Math.min(ov.end, e) : e, lc = S.c[li];
    g.fillStyle = '#3b82f6'; g.fillRect(pw, y(lc) - 9, W - pw, 18); g.fillStyle = '#fff'; g.fillText(fmtP(lc), pw + 5, y(lc) + 4);
    g.fillStyle = '#8b96b0'; const every = Math.max(1, Math.round(105 / cw));
    for (let i = s; i <= e; i++) if (i % every === 0) g.fillText(fmtT(S.t[i]).slice(this.sec >= 86400 ? 0 : 5).replace(',', ''), this.ix(i) - 38, H - 7);
    if (this.mouse && this.mouse.x < pw) {
      const i = Math.max(0, Math.min(S.n - 1, Math.floor(this.start + this.mouse.x / cw)));
      g.strokeStyle = '#475569'; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(this.ix(i), 0); g.lineTo(this.ix(i), H - 24); g.moveTo(0, this.mouse.y); g.lineTo(pw, this.mouse.y); g.stroke(); g.setLineDash([]);
      if (this.mouse.y < ph) { const p = mx - (this.mouse.y - 8) / (ph - 8) * (mx - mn); g.fillStyle = '#334155'; g.fillRect(pw, this.mouse.y - 9, W - pw, 18); g.fillStyle = '#fff'; g.fillText(fmtP(p), pw + 5, this.mouse.y + 4); }
      this.info.textContent = `${fmtT(S.t[i])}  O ${fmtP(S.o[i])}  H ${fmtP(S.h[i])}  L ${fmtP(S.l[i])}  C ${fmtP(S.c[i])}`;
    } else this.info.textContent = ov.title || '';
  }
}
function tri(g, x, yy, up) { g.beginPath(); if (up) { g.moveTo(x, yy + 2); g.lineTo(x - 6, yy + 12); g.lineTo(x + 6, yy + 12); } else { g.moveTo(x, yy - 2); g.lineTo(x - 6, yy - 12); g.lineTo(x + 6, yy - 12); } g.closePath(); g.fill(); }
function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r))); const f = r / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
const S_focus = () => S.focusTrade;

/* ---------------- interactive chart tab ---------------- */
const big = new Chart($('#chart'), $('#chartInfo'));
function drawChart() {
  const o = S.O[S.sel]; if (!o || !o.ctx || !o.rep || o.rep.error) return;
  $('#chartSym').textContent = o.sym;
  const tf = $('#tfSel').value, ctx = o.ctx, rep = o.rep;
  const ser = tf === '1day' ? ctx.D : tf === '4hour' ? ctx.H : ctx.M;
  const ov = { price: rep.price, showVol: $('#optVol').checked, title: `${o.sym} · ${$('#tfSel').selectedOptions[0].text}`, view: 160, zoneLabels: true };
  if ($('#optEma').checked) ov.emas = tf === '1day' ? [{ arr: ser.emaF, color: '#60a5fa' }, { arr: ser.emaS, color: '#c084fc' }] : [{ arr: ser.ema, color: '#60a5fa' }];
  if ($('#optZones').checked) ov.zones = keyZones(rep.daily, rep.price).list;
  if ($('#optChan').checked) { const ch = rep.daily.chan, t0 = ctx.D.t[ch.startIdx]; ov.chan = { t0, t1: ctx.D.t[ch.endIdx] + 86400 * 3, f: t => ch.at((t - t0) / 86400) }; }
  if ($('#optTrades').checked) ov.trades = o.bt.trades;
  if (isTrend()) {
    if (tf === '4hour') ov.emas = (ov.emas || []).concat([{ arr: ctx.H.dHi, color: '#f59e0b' }, { arr: ctx.H.dLo, color: '#f59e0b' }]);
    const pl = S.focusTrade || (o.ev && o.ev.open);
    if (pl) ov.hlines = [{ p: pl.entry, c: '#3b82f6', t: 'ورود' }, { p: pl.status === 'OPEN' ? pl.stop : pl.sl, c: '#ef4444', t: pl.status === 'OPEN' ? 'حد ضرر فعلی' : 'SL' }];
  } else { const plan = S.focusTrade || rep.signal; if (plan) ov.plan = plan; }
  big.setData(ser, Engine.TF_SEC[tf], ov, big.S === ser);
}
['#tfSel', '#optZones', '#optChan', '#optEma', '#optTrades', '#optVol'].forEach(id => $(id).addEventListener('change', () => { if (id === '#tfSel') S.focusTrade = null; drawChart(); }));
$('#btnFit').onclick = () => { if (big.S) { big.fit(); big.draw(); } };

/* ---------------- HELP ---------------- */
$('#helpBody').innerHTML = `
<h3 style="color:var(--text)">راه‌اندازی</h3>
<ol>
<li>در اکسل دکمه‌ی <b>Add Symbols</b> را بزنید و ارزها را با کاما وارد کنید (مثلاً <span class="num">BTC,SOL,XRP</span>)، بعد <b>Update + Export</b>.</li>
<li>این فایل HTML را کنار فایل اکسل و <b>ScannerData.js</b> بگذارید و با Chrome باز کنید.</li>
<li>حالت خودکار: «Auto ON» در اکسل + «خودکار» در اپ. سیگنال جدید هر ارز با صدا و نوتیفیکیشن اعلام می‌شود.</li>
</ol>
<h3 style="color:var(--text)">استراتژی پیش‌فرض: روند (شکست ۴ساعته + ورود ۱۵ دقیقه)</h3>
<ol>
<li><b>روند روزانه:</b> خرید فقط وقتی قیمت بالای EMA50 و EMA20 بالای EMA50 است؛ فروش برعکس.</li>
<li><b>شکست ۴ساعته:</b> کندل ۴ساعته بالای سقف (یا زیر کف) ۴۰ کندل قبل بسته شود.</li>
<li><b>ورود ۱۵ دقیقه:</b> تا ۶ ساعت بعد، قیمت به سطح شکست برگردد و یک کندل ۱۵م هم‌جهت، آن طرف EMA20 بسته شود.</li>
<li><b>خروج:</b> حد ضرر ۳×ATR ۴ساعته که با هر کندل ۴ساعته پشت قیمت جابه‌جا می‌شود؛ حد سود ثابت ندارد.</li>
</ol>
<p class="mute">این استراتژی در تحقیق روی ۲ سال دیتای ۹ ارز، هم در ۱۸ ماه اول و هم در ۶ ماه آخرِ دیده‌نشده سودده بود. درصد برد آن پایین (حدود ۳۵ تا ۴۵٪) و سودش از چند معامله‌ی بزرگ است؛ ضررهای پشت‌سرهم طبیعی است.</p>
<h3 style="color:var(--text)">نحوه‌ی خواندن تحلیل</h3>
<ul>
<li><b>لیست ارزها</b> بر اساس نزدیکی به موقعیت ورود مرتب است: 🎯 سیگنال، 📌 معامله‌ی باز، ⏳ در ناحیه و منتظر ماشه، نزدیک ناحیه، و منتظر.</li>
<li><b>نمودار روزانه:</b> نواحی حمایت (سبز)، مقاومت (قرمز) و ناحیه‌ای که قیمت داخل آن است (زرد). ⭐ یعنی ناحیه‌ی مهم. خطوط نارنجی کانال رگرسیونی روزانه هستند.</li>
<li><b>نمودار ۴ساعته:</b> همان نواحی و کانال روزانه، برای دیدن جایگاه دقیق قیمت.</li>
<li><b>سناریوها:</b> برای هر جهت مشخص می‌کند قیمت باید به کجا برسد، چه کندلی در ۱۵ دقیقه لازم است، و ورود، حد ضرر و هدف تقریبی چقدر است.</li>
<li><b>۱۵ دقیقه:</b> اگر قیمت در ناحیه باشد، چک‌لیست ماشه با سطح دقیق شکست و EMA نمایش داده می‌شود؛ در غیر این صورت می‌گوید فعلاً لازم نیست ۱۵ دقیقه را دنبال کنید.</li>
<li><b>تست روی گذشته:</b> پایین گزارش، با اسلایدر می‌توانید تحلیل را در هر لحظه‌ی گذشته ببینید.</li>
</ul>
<p class="amber">این ابزار کمک‌تحلیلی است و توصیه‌ی مالی نیست. نتایج بک‌تست روی ۶ ماه دیتا محدود است.</p>`;

/*__EXT__ ui_ext*/
/*__EXT__ ui_scan*/
/* ---------------- init ---------------- */
renderSettings();
loadScan();
loadScript();
if (LS.get('scanner.auto', false)) $('#btnAuto').click();
})();
