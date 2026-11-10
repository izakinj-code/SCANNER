/* ===================== OPPORTUNITIES (Top-100 scanner) + JOURNAL ===================== */
S.scan = null; S.scanGen = null; S.scanRes = null;
S.jr = LS.get('scanner.journal', []);
S.oppF = Object.assign({ kind: 'READY', dir: 'ALL', q: '', limit: 30, minScore: 0 }, LS.get('scanner.oppf', {}));
const KIND = { READY: ['آماده‌ی ورود', 'st-sig'], NEAR: ['نزدیک ورود', 'st-near'], LATE: ['دیر شده — فقط با پولبک', 'st-zone'] };
function loadScan() {
  const old = document.getElementById('scanScript'); if (old) old.remove();
  const sc = document.createElement('script'); sc.id = 'scanScript'; sc.src = 'ScannerScan.js?t=' + Date.now();
  sc.onload = () => { if (window.SCANNER_SCAN) onScan(window.SCANNER_SCAN); };
  sc.onerror = () => { if (!S.scan) $('#oppBody').innerHTML = `<div class="card empty">فایل <b>ScannerScan.js</b> پیدا نشد.<br>در اکسل دکمه‌ی <b>Scan Top 100</b> را بزنید (یا Auto ON را روشن کنید) و این صفحه را کنار فایل اکسل باز کنید.<br><small class="mute">یا با «📂 فایل دستی» فایل ScannerScan.js را انتخاب کنید.</small></div>`; };
  document.head.appendChild(sc);
}
function onScan(d) {
  if (S.scan && d.generatedUtc === S.scanGen) return;
  S.scan = d; S.scanGen = d.generatedUtc;
  try { S.scanRes = Scan.run(d, { traders: tradersConsensus() }); } catch (e) { $('#oppBody').innerHTML = `<div class="card red">خطا در اسکن: ${e.message}</div>`; return; }
  renderOpp(); renderJr(); alertNewOpp();
}
function alertNewOpp() {
  const seen = LS.get('scanner.oppSeen', {}), fresh = [];
  for (const s of S.scanRes.checks) if (s.status === 'READY' && s.score / s.total >= 0.7) { const k = s.sid; if (!seen[k]) { seen[k] = 1; fresh.push(s); } }
  LS.set('scanner.oppSeen', seen);
  if (!fresh.length || !S.oppAlertArmed) { S.oppAlertArmed = true; return; }
  beep();
  try { if (window.Notification && Notification.permission === 'granted') new Notification(`${fresh.length} موقعیت جدید`, { body: fresh.slice(0, 5).map(s => `${short(s.sym)} ${s.dir}`).join('، ') }); } catch (e) {}
}
const tick = ok => ok === true ? '<span class="green">✓</span>' : ok === false ? '<span class="red">✗</span>' : '<span class="mute">–</span>';
const ST = { READY: ['🎯 آماده‌ی ورود (موقعیت + ماشه)', 'st-sig'], NEAR: ['⏳ در موقعیت — منتظر ماشه‌ی ۱۵م', 'st-zone'], WATCH: ['👀 زیر نظر', 'st-wait'] };
function tradersConsensus() {
  if (typeof HL === 'undefined') return null;
  const agg = {}; let n = 0;
  const addrs = [...new Set(HL.top.map(r => r.addr).concat(HL.follow))];
  for (const ad of addrs) { const st = HL.states[ad]; if (!st) continue; n++;
    for (const p of st.positions) { const a = agg[p.coin] || (agg[p.coin] = { L: 0, S: 0, lv: 0, sv: 0, n: 0 }); a.n++; if (p.size > 0) { a.L++; a.lv += p.value; } else { a.S++; a.sv += p.value; } } }
  return n ? agg : null;
}
function rescan() { if (!S.scan) return; S.scanRes = Scan.run(S.scan, { traders: tradersConsensus() }); renderOpp(); }
function renderOpp() {
  const box = $('#oppBody'); if (!box || !S.scanRes) return;
  const r = S.scanRes, f = S.oppF;
  f.minScore = f.minScore ?? 0; if (!['READY', 'NEAR', 'WATCH', 'ALL'].includes(f.kind)) f.kind = 'READY';
  const age = (Date.now() / 1000 - S.scan.generatedUtc) / 60;
  const cnt = k => r.checks.filter(c => c.status === k).length;
  const list = r.checks.filter(c => (f.kind === 'ALL' || c.status === f.kind) && (f.dir === 'ALL' || c.dir === f.dir) && c.score >= f.minScore && (!f.q || c.sym.toLowerCase().includes(f.q.toLowerCase())));
  const ready = r.checks.filter(c => c.status === 'READY'), longs = ready.filter(c => c.d > 0).length;
  const has15 = Object.values(r.X).filter(x => x.M).length;
  box.innerHTML = `
  <div class="grid g4">
    <div class="card"><h3>آخرین به‌روزرسانی دیتابیس</h3><div class="big ${age < 30 ? '' : 'amber'}">${age < 120 ? Math.round(age) + ' دقیقه قبل' : fmtN(age / 60, 1) + ' ساعت قبل'}</div><small class="mute">${fmtT(S.scan.generatedUtc)} · ${r.coins} ارز · ${has15} ارز با دیتای ۱۵م${S.scan.source === 'SYNTHETIC-TEST' ? ' · ⚠ آزمایشی' : ''}</small></div>
    <div class="card"><h3>وضعیت</h3><div class="big"><span class="green">${cnt('READY')}</span> آماده · <span class="amber">${cnt('NEAR')}</span> در موقعیت</div><small class="mute">${cnt('WATCH')} ارز زیر نظر (خارج از موقعیت)</small></div>
    <div class="card"><h3>روند روزانه‌ی BTC</h3><div class="big">${dirBadge(r.btcTrend > 0 ? 'BULL' : r.btcTrend < 0 ? 'BEAR' : 'RANGE')}</div><small class="mute">یکی از تأییدیه‌ها</small></div>
    <div class="card"><h3>تریدرهای دنبال‌شده</h3><div class="big">${typeof HL !== 'undefined' ? HL.follow.length : 0} نفر</div><small class="mute">${tradersConsensus() ? 'تأییدیه‌ی «تریدرهای برتر» فعال است' : 'برای فعال شدن تأییدیه‌ی تریدرها، در پیشرفته ← تریدرها پوزیشن‌ها را بگیرید'}</small></div>
  </div>
  ${ready.length >= 8 ? `<div class="card amber" style="margin-top:12px;font-size:13px">⚠ ${ready.length} موقعیت آماده همزمان (${longs} خرید، ${ready.length - longs} فروش). ارزها همبسته‌اند؛ حداکثر ۳ تا ۵ مورد با بیشترین تأییدیه را انتخاب کنید.</div>` : ''}
  ${sigBtBox()}
  ${followedTradesBox()}
  <div class="toolbar" style="margin-top:12px">
    ${['READY', 'NEAR', 'WATCH', 'ALL'].map(k => `<button data-k="${k}" class="${f.kind === k ? 'primary' : ''}">${k === 'ALL' ? 'همه' : ST[k][0]}</button>`).join('')}
    <select id="oppMin">${[0, 5, 6, 7, 8, 9].map(v => `<option value="${v}" ${f.minScore === v ? 'selected' : ''}>${v ? 'حداقل ' + v + ' تأییدیه' : 'همه‌ی امتیازها'}</option>`).join('')}</select>
    <select id="oppDir"><option value="ALL">هر دو جهت</option><option value="LONG" ${f.dir === 'LONG' ? 'selected' : ''}>فقط خرید</option><option value="SHORT" ${f.dir === 'SHORT' ? 'selected' : ''}>فقط فروش</option></select>
    <input id="oppQ" placeholder="جستجوی ارز…" value="${f.q}" style="width:140px">
    <span class="mute" style="font-size:12px">${list.length} مورد · مرتب بر اساس تعداد تأییدیه</span>
  </div>
  <div class="grid g2">${list.slice(0, f.limit).map(checkCard).join('') || '<div class="card empty">موردی با این فیلتر نیست.</div>'}</div>
  ${list.length > f.limit ? `<div style="text-align:center;margin-top:10px"><button id="oppMore">نمایش موارد بیشتر</button></div>` : ''}
  <p class="mute" style="font-size:12px;margin-top:12px">روش: روند هفتگی ← روند روزانه ← جایگاه در کانال هفتگی ← موقعیت ۴ساعته (سطح حمایت/مقاومت روزانه و هفتگی، EMA20 روزانه، لبه‌ی کانال، یا شکست) ← ماشه‌ی ۱۵ دقیقه ← تأییدیه‌های حجم، RSI، پرایس‌اکشن، فضای حرکت، BTC و تریدرها. ورود فقط وقتی ۴ شرط اصلی (روند روزانه، اصلاح ۴ساعته، موقعیت روی سطح، ماشه‌ی ۱۵م) برقرار باشد؛ نتیجه‌ی بک‌تست در کادر «کارنامه‌ی بک‌تست» بالای همین صفحه. تصمیم نهایی با شماست. توصیه‌ی مالی نیست.</p>`;
  box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { S.oppF.kind = b.dataset.k; S.oppF.limit = 30; LS.set('scanner.oppf', S.oppF); renderOpp(); });
  $('#oppMin').onchange = e => { S.oppF.minScore = +e.target.value; LS.set('scanner.oppf', S.oppF); renderOpp(); };
  $('#oppDir').onchange = e => { S.oppF.dir = e.target.value; LS.set('scanner.oppf', S.oppF); renderOpp(); };
  $('#oppQ').oninput = e => { S.oppF.q = e.target.value; clearTimeout(S.qT); S.qT = setTimeout(() => { renderOpp(); const q = $('#oppQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300); };
  const more = $('#oppMore'); if (more) more.onclick = () => { S.oppF.limit += 30; renderOpp(); };
  box.querySelectorAll('[data-chart]').forEach(b => b.onclick = () => toggleOppChart(b.dataset.chart, b.dataset.tf));
  box.querySelectorAll('[data-take]').forEach(b => b.onclick = () => journalAdd(b.dataset.take, 'IN'));
  box.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => journalAdd(b.dataset.skip, 'SKIP'));
  const fr = $('#folRefresh'); if (fr) fr.onclick = refreshFollowed;
  bindSigBt();
}
const ago = ts => { const m = (Date.now() / 1000 - ts) / 60; return m < 1 ? 'همین الان' : m < 90 ? Math.round(m) + ' دقیقه پیش' : m < 48 * 60 ? fmtN(m / 60, 1) + ' ساعت پیش' : fmtN(m / 1440, 1) + ' روز پیش'; };
function timeLine(c) {
  const lbl = c.status === 'READY' ? '🕒 زمان ثبت سیگنال' : c.status === 'NEAR' ? '🕒 در موقعیت از' : '🕒 بررسی';
  const t = c.status === 'WATCH' ? c.time : (c.since || c.time);
  return `<div style="font-size:12.5px;margin-top:6px;display:flex;gap:14px;flex-wrap:wrap"><span>${lbl}: <b class="num">${fmtT(t)}</b> <span class="mute">(${ago(t)})</span></span>${c.status === 'READY' && c.trigTime && c.trigTime !== t ? `<span class="mute">آخرین ماشه: <span class="num">${fmtT(c.trigTime)}</span></span>` : ''}<span class="mute">آخرین کندل بررسی‌شده: <span class="num">${fmtT(c.time)}</span></span></div>`;
}
function scoreBar(c) { const p = c.score / Math.max(1, c.total) * 100; return `<div style="display:flex;align-items:center;gap:8px"><b class="big">${c.score}</b><span class="mute">از ${c.total} مورد</span><div class="bar" style="width:110px"><i style="width:${p}%;background:${p >= 70 ? '#22c55e' : p >= 50 ? '#f59e0b' : '#ef4444'}"></i></div></div>`; }
function checkCard(c) {
  const id = c.sid, L = c.d > 0, inJ = S.jr.find(e => e.id === id);
  return `<div class="card" style="border-right:4px solid ${L ? '#22c55e' : '#ef4444'}">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="big">${short(c.sym)}</span>${dirBadge(c.dir)}<span class="wl-st ${ST[c.status][1]}">${ST[c.status][0]}</span><div class="spacer"></div>${scoreBar(c)}</div>
    ${timeLine(c)}
    <table style="margin-top:8px;font-size:13px">${c.items.filter(x => x.must).map(x => `<tr><td style="width:22px">${tick(x.ok)}</td><td><b>${x.title}</b> <small class="amber">شرط اصلی</small></td><td style="white-space:normal" class="mute">${x.detail}</td></tr>`).join('')}
      <tr><td colspan="3" class="mute" style="font-size:11.5px;padding-top:6px">تأییدیه‌های تکمیلی (در بک‌تست اثر قابل‌اتکایی نداشتند؛ فقط برای بررسی خودتان):</td></tr>
      ${c.items.filter(x => !x.must).map(x => `<tr><td style="width:22px">${tick(x.ok)}</td><td><b>${x.title}</b></td><td style="white-space:normal" class="mute">${x.detail}</td></tr>`).join('')}</table>
    <div class="kv">
      <div><span>ورود ${c.status === 'READY' ? '' : '(مرجع)'}</span><b class="num">${fmtP(c.entry)}</b></div>
      <div><span>حد ضرر</span><b class="num red">${fmtP(c.sl)}</b> <small class="mute num">${fmtN(c.riskPct, 1)}%</small></div>
      <div><span>تارگت ۱ (${c.tp1Why})</span><b class="num green">${fmtP(c.tp1)}</b> <small class="mute num">${fmtN(c.rr1, 1)}R</small></div>
      <div><span>تارگت ۲ (${c.tp2Why})</span><b class="num green">${fmtP(c.tp2)}</b> <small class="mute num">${fmtN(c.rr2, 1)}R</small></div>
    </div>
    <p class="mute" style="font-size:12px;margin:8px 0 0">${c.status === 'READY' ? '' : 'ورود فقط بعد از ماشه‌ی ۱۵ دقیقه؛ اعداد با قیمت فعلی حساب شده‌اند. '}حد ضرر پشت ${L ? 'حمایت' : 'مقاومت'} نزدیک (بین ۱.۵ تا ۳×ATR ۴ساعته) · مدیریت پیشنهادی طبق بک‌تست: حد ضرر دنبال‌کننده ${c.trailK}×ATR روی بسته شدن هر کندل ۴ساعته؛ تارگت‌ها فقط مرجع‌اند · ${sizeHint(c.entry, c.sl)}</p>
    <div class="toolbar" style="margin:10px 0 0"><button data-chart="${id}" data-tf="4h">📈 ۴ساعته</button>${S.scanRes.X[c.sym].M ? `<button data-chart="${id}" data-tf="15m">📈 ۱۵ دقیقه</button>` : ''}<button data-chart="${id}" data-tf="1d">📈 روزانه</button>
      ${inJ ? `<span class="pill ${inJ.decision === 'IN' ? 'ok' : ''}">${inJ.decision === 'IN' ? '✅ ثبت شد: وارد شدم' : '✖ ثبت شد: رد کردم'}</span>` : `<button data-take="${id}" class="on">✅ وارد شدم</button><button data-skip="${id}">✖ رد کردم</button>`}</div>
    <div class="chartbox small" id="ch-${cssId(id)}" style="display:none;margin-top:10px"><canvas></canvas><div class="cinfo"></div></div>
  </div>`;
}
const cssId = id => id.replace(/[^a-zA-Z0-9]/g, '_');
function findSetup(id) { return S.scanRes.checks.find(s => s.sid === id); }
function toggleOppChart(id, tf) {
  const el = document.getElementById('ch-' + cssId(id)); if (!el) return;
  if (el.style.display !== 'none' && el.dataset.tf === tf) { el.style.display = 'none'; return; }
  el.style.display = 'block'; el.dataset.tf = tf;
  const c = findSetup(id), X = S.scanRes.X[c.sym], Ser = tf === '15m' ? X.M : tf === '1d' ? X.D : X.H, sec = tf === '15m' ? 900 : tf === '1d' ? 86400 : 14400;
  const zs = [c.support, c.resist].filter(Boolean).map(z => ({ ...z, touches: z.t, important: true, kind: z.mid < c.price ? 'S' : 'R' }));
  const ch = new Chart(el.querySelector('canvas'), el.querySelector('.cinfo'));
  ch.setData(Ser, sec, { price: c.price, showVol: true, view: tf === '1d' ? 120 : 130, title: short(c.sym) + ' · ' + tf, zones: zs, zoneLabels: true,
    emas: tf === '1d' ? [{ arr: X.D.e20, color: '#60a5fa' }, { arr: X.D.e50, color: '#c084fc' }] : tf === '15m' ? [{ arr: X.M.e20, color: '#60a5fa' }] : [{ arr: X.H.e20, color: '#60a5fa' }, { arr: X.H.e50, color: '#c084fc' }],
    hlines: [{ p: c.entry, c: '#3b82f6', t: 'ورود' }, { p: c.sl, c: '#ef4444', t: 'حد ضرر' }, { p: c.tp1, c: '#22c55e', t: 'تارگت ۱' }, { p: c.tp2, c: '#16a34a', t: 'تارگت ۲' }] });
}
// ---- followed traders' trades as a watch-list, checked against our checklist
function followedTradesBox() {
  if (typeof HL === 'undefined' || !HL.follow.length) return '';
  const rows = [];
  for (const a of HL.follow) { const st = HL.states[a]; if (!st) continue;
    for (const p of st.positions) { const sym = p.coin + '-USDT', dir = p.size > 0 ? 'LONG' : 'SHORT', ck = S.scanRes.checks.find(c => c.sym === sym);
      const mine = ck ? (ck.dir === dir ? ck : ck.other && ck.other.dir === dir ? ck.other : null) : null;
      rows.push({ a, p, dir, mine }); } }
  return `<details class="card" style="margin-top:12px" open><summary>⭐ معاملات تریدرهای دنبال‌شده (${rows.length}) — با امتیاز تأییدیه‌های ما برای همان جهت</summary>
    <div class="toolbar" style="margin:8px 0"><button id="folRefresh">🔄 به‌روزرسانی پوزیشن‌ها</button><span class="mute" style="font-size:12px">${HL.follow.length} تریدر دنبال‌شده</span></div>
    ${rows.length ? `<div class="scroll" style="max-height:280px"><table><tr><th>تریدر</th><th>ارز</th><th>جهت</th><th>حجم</th><th>ورود</th><th>اهرم</th><th>سود/زیان</th><th>تأییدیه‌های ما</th></tr>
    ${rows.map(x => `<tr><td><span class="addr">${shortAddr(x.a)}</span></td><td><b>${x.p.coin}</b></td><td>${dirBadge(x.dir)}</td><td>${usd(x.p.value)}</td><td class="num">${fmtP(x.p.entry)}</td><td>${x.p.lev ? x.p.lev + 'x' : '-'}</td>
      <td class="${x.p.upnl >= 0 ? 'green' : 'red'}">${usd(x.p.upnl)}</td><td>${x.mine ? `<b>${x.mine.score}/${x.mine.total}</b> <small class="mute">${ST[x.mine.status] ? '' : ''}</small>` : '<span class="mute">خارج از ۱۰۰ ارز</span>'}</td></tr>`).join('')}</table></div>` : '<div class="mute">پوزیشنی دریافت نشده؛ دکمه‌ی به‌روزرسانی را بزنید.</div>'}</details>`;
}
async function refreshFollowed() {
  const b = $('#folRefresh'); if (b) { b.disabled = true; b.textContent = 'در حال دریافت…'; }
  for (const a of HL.follow) { try { HL.states[a] = parseState(await hlPost({ type: 'clearinghouseState', user: a })); } catch (e) {} }
  rescan();
}
function journalAdd(id, decision) {
  const s = findSetup(id); if (!s) return;
  let entry = s.entry;
  if (decision === 'IN') { const v = prompt(`قیمت ورود واقعی ${short(s.sym)} (خالی = ${fmtP(s.entry)})`, fmtP(s.entry)); if (v === null) return; if (+v > 0) entry = +v; }
  S.jr.unshift({ id, sym: s.sym, dir: s.dir, kind: s.status, score: s.score + '/' + s.total, time: s.time, sigTime: s.since || s.time, at: Math.floor(Date.now() / 1000), decision, entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, trailK: s.trailK });
  LS.set('scanner.journal', S.jr); renderOpp(); renderJr();
}
function renderJr() {
  const box = $('#jrBody'); if (!box) return;
  if (!S.jr.length) { box.innerHTML = '<div class="card empty">هنوز چیزی ثبت نشده. در صفحه‌ی «موقعیت‌ها» روی «وارد شدم» یا «رد کردم» بزنید تا اینجا ثبت و پیگیری شود.</div>'; return; }
  const X = S.scanRes ? S.scanRes.X : {};
  const rows = S.jr.map(e => ({ e, o: X[e.sym] ? Scan.outcome(X[e.sym], e) : null }));
  const sum = dec => { const a = rows.filter(r => r.e.decision === dec && r.o && r.o.R != null); return { n: rows.filter(r => r.e.decision === dec).length, closed: a.filter(r => r.o.status !== 'OPEN').length, R: a.reduce((s, r) => s + r.o.R, 0) }; };
  const A = sum('IN'), B = sum('SKIP');
  box.innerHTML = `<div class="grid g4">
    <div class="card"><h3>معاملاتی که وارد شدید</h3><div class="big">${A.n}</div><small class="mute">${A.closed} بسته‌شده</small></div>
    <div class="card"><h3>نتیجه‌ی آن‌ها (طبق قوانین)</h3><div class="big num ${A.R >= 0 ? 'green' : 'red'}">${fmtN(A.R)}R</div><small class="mute">جمع R، شامل پوزیشن‌های باز</small></div>
    <div class="card"><h3>موقعیت‌های ردشده</h3><div class="big">${B.n}</div><small class="mute">اگر وارد می‌شدید: <span class="num ${B.R >= 0 ? 'green' : 'red'}">${fmtN(B.R)}R</span></small></div>
    <div class="card"><h3>قضاوت شما</h3>${(() => { const ok = A.closed >= 5 && B.closed >= 5, better = ok && A.R / A.n >= B.R / B.n; return `<div class="big ${ok ? (better ? 'green' : 'red') : 'mute'}">${ok ? (better ? 'بهتر از سیستم' : 'ضعیف‌تر از سیستم') : 'هنوز زود است'}</div><small class="mute">${ok ? 'میانگین R انتخاب‌ها در برابر ردشده‌ها' : 'حداقل ۵ مورد بسته‌شده در هر گروه لازم است'}</small>`; })()}</div>
  </div>
  <div class="card" style="margin-top:12px"><div class="toolbar" style="margin:0 0 8px"><b>دفترچه</b><div class="spacer"></div><button id="jrCsv">⬇ خروجی CSV</button></div><div class="scroll"><table>
    <tr><th>زمان سیگنال</th><th>زمان ثبت شما</th><th>ارز</th><th>جهت</th><th>تصمیم</th><th>ورود</th><th>حد ضرر</th><th>تارگت ۱/۲</th><th>وضعیت</th><th>R</th><th></th></tr>
    ${rows.map(({ e, o }, k) => { const st = !o ? '<span class="mute">در اسکن فعلی نیست</span>' : o.status === 'OPEN' ? `باز${o.tp1 ? ' · ✅ تارگت ۱' : ''}${o.tp2 ? ' · ✅ تارگت ۲' : ''} · حد ضرر فعلی ${num(fmtP(o.stop))}` : `${o.status === 'SL' ? '❌ حد ضرر' : '🏁 خروج با حد ضرر دنبال‌کننده'}${o.tp1 ? ' (تارگت ۱ خورده بود)' : ''}`;
      return `<tr><td class="num">${fmtT(e.sigTime || e.time)}</td><td class="num">${fmtT(e.at)}</td><td><b>${short(e.sym)}</b></td><td>${dirBadge(e.dir)}</td><td>${e.decision === 'IN' ? '✅ ورود' : '✖ رد'}</td><td class="num">${fmtP(e.entry)}</td><td class="num">${fmtP(e.sl)}</td>
        <td class="num">${fmtP(e.tp1)} / ${fmtP(e.tp2)}</td><td style="white-space:normal">${st}</td><td class="num ${o && o.R >= 0 ? 'green' : 'red'}">${o && o.R != null ? fmtN(o.R) : '-'}</td><td><button data-del="${k}" title="حذف">🗑</button></td></tr>`; }).join('')}</table></div></div>`;
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (!confirm('حذف شود؟')) return; S.jr.splice(+b.dataset.del, 1); LS.set('scanner.journal', S.jr); renderJr(); renderOpp(); });
  $('#jrCsv').onclick = () => {
    const csv = ['signal_time,time,symbol,dir,decision,entry,sl,tp1,tp2,status,R'].concat(rows.map(({ e, o }) => [new Date((e.sigTime || e.time) * 1000).toISOString(), new Date(e.at * 1000).toISOString(), e.sym, e.dir, e.decision, e.entry, e.sl, e.tp1, e.tp2, o ? o.status : '', o && o.R != null ? o.R.toFixed(2) : ''].join(','))).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'journal.csv'; a.click();
  };
}
// advanced menu toggle
(() => {
  const btn = $('#advBtn'); if (!btn) return;
  const set = on => { document.querySelectorAll('nav .adv').forEach(b => b.style.display = on ? '' : 'none'); btn.textContent = on ? 'پیشرفته ▴' : 'پیشرفته ▾'; LS.set('scanner.adv', on); };
  btn.onclick = () => set(document.querySelector('nav .adv').style.display === 'none');
  set(LS.get('scanner.adv', false));
})();

// ---- SIGNAL BACKTEST REPORT (runs the same checklist on every closed 15m bar of the core coins' history)
S.sbt = null; S.sbtO = Object.assign({ risk: 0.75, maxOpen: 3, v: 'T' }, LS.get('scanner.sbto', {}));
const SPLIT_T = Date.UTC(2026, 4, 8) / 1000;
function sigBtBox() {
  const b = S.sbt;
  const head = `<details class="card" style="margin-top:12px" id="sbtBox" ${S.sbtOpen ? 'open' : ''}><summary>📊 کارنامه‌ی بک‌تست سیگنال‌ها ${b ? `— ${b.sigs.length} سیگنال، برد ${fmtN(Scan.sigStats(b.sigs, S.sbtO.v).wr, 0)}٪، میانگین ${fmtN(Scan.sigStats(b.sigs, S.sbtO.v).avgR)}R` : ''}</summary>`;
  if (!b) return head + `<div class="toolbar" style="margin:8px 0"><button id="sbtRun" class="primary">▶ اجرای بک‌تست روی دیتای ۲ ساله</button><span class="mute" style="font-size:12px">${S.data ? 'ارزهای دارای دیتای ۱۵ دقیقه‌ی بلندمدت از ScannerData.js — چند ثانیه طول می‌کشد' : 'ابتدا ScannerData.js باید بارگذاری شود'}</span></div></details>`;
  const o = S.sbtO, A = b.sigs, st = a => Scan.sigStats(a, o.v);
  const row = (n, a) => { const x = st(a); return `<tr><td>${n}</td><td class="num">${x.n}</td><td class="num">${x.n ? fmtN(x.wr, 0) + '%' : '-'}</td><td class="num ${x.avgR >= 0 ? 'green' : 'red'}">${x.n ? fmtN(x.avgR) : '-'}</td><td class="num">${x.n ? fmtN(x.pf) : '-'}</td><td class="num ${x.sumR >= 0 ? 'green' : 'red'}">${x.n ? fmtN(x.sumR, 1) : '-'}</td></tr>`; };
  const pf = Scan.sigPortfolio(A, { riskPct: o.risk, maxOpen: o.maxOpen, v: o.v }), pt = Scan.sigPortfolio(A.filter(x => x.t >= SPLIT_T), { riskPct: o.risk, maxOpen: o.maxOpen, v: o.v });
  const weeks = (b.to - b.from) / 604800, scores = [...new Set(A.map(x => x.score))].sort((x, y) => x - y);
  const IT = { w: 'روند هفتگی', wc: 'جایگاه در کانال هفتگی', vol: 'حجم', rsi: 'RSI', pa: 'پرایس اکشن', room: 'فضای حرکت ≥2R', btc: 'هم‌جهتی BTC' };
  const TH = '<tr><th></th><th>تعداد</th><th>برد</th><th>میانگین R</th><th>PF</th><th>جمع R</th></tr>';
  return head + `
  <div class="toolbar" style="margin:8px 0">
    <span>مدیریت خروج:</span><select id="sbtV"><option value="T" ${o.v === 'T' ? 'selected' : ''}>حد ضرر دنبال‌کننده ۳×ATR (پیشنهادی)</option><option value="C" ${o.v === 'C' ? 'selected' : ''}>نصف در تارگت ۱ + دنبال‌کننده</option><option value="A" ${o.v === 'A' ? 'selected' : ''}>کامل در تارگت ۱</option></select>
    <span>ریسک هر معامله</span><select id="sbtR">${[0.5, 0.75, 1, 1.5].map(v => `<option ${o.risk === v ? 'selected' : ''}>${v}</option>`).join('')}</select>%
    <span>حداکثر پوزیشن همزمان</span><select id="sbtM">${[1, 2, 3, 4, 6].map(v => `<option ${o.maxOpen === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <button id="sbtRun">🔄 اجرای دوباره</button></div>
  <div class="grid g4">
    <div class="card"><h3>دوره</h3><div class="big num">${fmtN(weeks, 0)} هفته</div><small class="mute">${fmtT(b.from).split(',')[0]} تا ${fmtT(b.to).split(',')[0]} · ${b.coins.length} ارز · ${fmtN(A.length / weeks, 1)} سیگنال در هفته</small></div>
    <div class="card"><h3>حساب ۱۰۰ دلاری (کل دوره)</h3><div class="big num ${pf.end >= 100 ? 'green' : 'red'}">${fmtN(pf.end, 1)}$</div><small class="mute">بیشترین افت ${fmtN(pf.maxDD, 1)}٪ · ${pf.taken} معامله (${pf.skipped} رد به‌خاطر سقف پوزیشن)</small></div>
    <div class="card"><h3>۶ ماه آخر (تست جدا)</h3><div class="big num ${pt.end >= 100 ? 'green' : 'red'}">${fmtN(pt.end, 1)}$</div><small class="mute">بیشترین افت ${fmtN(pt.maxDD, 1)}٪ · ${pt.taken} معامله</small></div>
    <div class="card"><h3>کارمزد</h3><div class="big num">${fmtN(A.reduce((s, x) => s + x.costR, 0) / Math.max(1, A.length), 2)}R</div><small class="mute">میانگین هزینه‌ی هر معامله (کارمزد ۰.۰۶٪×۲ + لغزش)؛ از نتایج کم شده</small></div>
  </div>
  <div class="grid g2" style="margin-top:10px">
    <div><b>خلاصه</b><table style="font-size:13px">${TH}${row('همه', A)}${row('۱۸ ماه اول', A.filter(x => x.t < SPLIT_T))}${row('۶ ماه آخر', A.filter(x => x.t >= SPLIT_T))}${row('خرید', A.filter(x => x.d > 0))}${row('فروش', A.filter(x => x.d < 0))}</table>
      <b style="display:block;margin-top:10px">بر اساس تعداد تأییدیه</b><table style="font-size:13px">${TH}${scores.map(v => row(v + ' از ' + (A.find(x => x.score === v) || {}).total, A.filter(x => x.score === v))).join('')}</table></div>
    <div><b>اثر هر تأییدیه‌ی تکمیلی</b><table style="font-size:13px">${TH}${Object.keys(IT).map(k => row(IT[k] + ' ✓', A.filter(x => x.it[k] === true)) + row(IT[k] + ' ✗', A.filter(x => x.it[k] === false))).join('')}</table>
      <b style="display:block;margin-top:10px">بر اساس ارز</b><table style="font-size:13px">${TH}${b.coins.map(c => row(short(c), A.filter(x => x.sym === c))).join('')}</table></div>
  </div>
  <b style="display:block;margin-top:10px">آخرین ۴۰ سیگنال تاریخی</b>
  <div class="scroll" style="max-height:320px"><table style="font-size:13px"><tr><th>زمان سیگنال</th><th>ارز</th><th>جهت</th><th>تأییدیه</th><th>ورود</th><th>حد ضرر</th><th>زمان خروج</th><th>نتیجه (R)</th></tr>
    ${A.slice(-40).reverse().map(x => `<tr><td class="num">${fmtT(x.t)}</td><td><b>${short(x.sym)}</b></td><td>${dirBadge(x.d > 0 ? 'LONG' : 'SHORT')}</td><td class="num">${x.score}/${x.total}</td><td class="num">${fmtP(x.entry)}</td><td class="num">${fmtP(x.sl)}</td><td class="num">${x.open ? '<span class="amber">باز</span>' : fmtT(x.exitT)}</td><td class="num ${x[o.v] >= 0 ? 'green' : 'red'}">${fmtN(x[o.v])}</td></tr>`).join('')}</table></div>
  <p class="mute" style="font-size:12px">بدون نگاه به آینده: در هر کندل ۱۵ دقیقه فقط کندل‌های بسته‌شده تا همان لحظه دیده می‌شود. ورود = قیمت بسته شدن کندل ماشه. اگر حد ضرر و تارگت در یک کندل خورده باشند، حد ضرر حساب شده. نتیجه‌ی گذشته تضمین آینده نیست.</p></details>`;
}
function bindSigBt() {
  const box = $('#sbtBox'); if (!box) return;
  box.ontoggle = () => { S.sbtOpen = box.open; };
  const run = $('#sbtRun');
  if (run) run.onclick = () => {
    if (!S.data) { alert('فایل ScannerData.js بارگذاری نشده است.'); return; }
    run.disabled = true; run.textContent = 'در حال محاسبه…';
    setTimeout(() => { try { S.sbt = Scan.signalBacktest(S.data); S.sbtOpen = true; } catch (e) { alert('خطا در بک‌تست: ' + e.message); } renderOpp(); }, 30);
  };
  const sv = (k, el, f) => { if (el) el.onchange = e => { S.sbtO[k] = f(e.target.value); LS.set('scanner.sbto', S.sbtO); renderOpp(); }; };
  sv('v', $('#sbtV'), x => x); sv('risk', $('#sbtR'), Number); sv('maxOpen', $('#sbtM'), Number);
}
