/* ===================== WEEKLY LOW-VOL TAB ===================== */
S.lv = Object.assign({}, Engine.LV_DEFAULTS, LS.get('scanner.lv', {}));
const WD = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];
function lastPrice(sym) { const o = S.O[sym]; if (o && o.ctx) { const M = o.ctx.M; return M.c[M.n - 1]; } const r = S.data.symbols[sym]['1day']; return r[r.length - 1][4]; }
function renderLV() {
  const box = $('#lvBody'); if (!box || !S.data) return;
  const opt = Object.assign({}, S.lv, { takerFee: S.port.takerFee, fundingPct8h: S.port.fundingPct8h });
  let bt, now;
  try { bt = Engine.lowVolBacktest(S.data.symbols, opt); now = Engine.lowVolNow(S.data.symbols, opt); }
  catch (e) { box.innerHTML = `<div class="card red">${e.message}</div>`; return; }
  S.lvRes = bt;
  const cap = S.port.capital, pick = now.pick;
  const cur = bt.weeks[bt.weeks.length - 1];
  // live P&L of the current (open) week
  let wkPnl = 0; const curRows = (cur ? cur.legs : []).map(l => { const px = lastPrice(l.s), r = (px / l.entry - 1) * Math.sign(l.w); wkPnl += Math.abs(l.w) * r; return { ...l, px, r: r * 100 }; });
  const fmtUsd = x => num((x < 0 ? '-' : '') + '$' + fmtN(Math.abs(x)));
  const rowsPlan = pick ? Object.entries(pick.w).sort((a, b) => b[1] - a[1]).map(([s, w]) => {
    const v = pick.vol.find(x => x.s === s).v, px = lastPrice(s), usd = cap * Math.abs(w);
    return `<tr><td><b>${short(s)}</b></td><td>${dirBadge(w > 0 ? 'LONG' : 'SHORT')}</td><td class="num">${fmtN(v, 0)}%</td><td>${fmtUsd(usd)}</td><td class="num">${fmtP(px)}</td><td class="num">${fmtN(usd / px, 4)}</td></tr>`; }).join('') : '';
  box.innerHTML = `
  <div class="card"><h3>📅 استراتژی هفتگی «کم‌نوسان در برابر پرنوسان» — کتاب 151 Trading Strategies، بخش ۳.۳</h3>
    <p style="margin:0">هر هفته ${S.lv.lvK} ارزِ کم‌نوسان‌تر خرید و ${S.lv.lvK} ارزِ پرنوسان‌تر فروش (فیوچرز، سرمایه‌ی مساوی در دو طرف) و یک هفته نگه‌داری. فقط هفته‌ای یک بار کار دارد.</p></div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>🗓 پیش‌نمایش سبد هفته‌ی بعد — برای سرمایه‌ی ${fmtUsd(cap)} <small class="mute">(بر اساس دیتای امروز؛ قطعی در زمان تعویض)</small></h3>
      ${pick ? `<table><tr><th>ارز</th><th>جهت</th><th>نوسان سالانه</th><th>حجم پوزیشن</th><th>قیمت فعلی</th><th>مقدار تقریبی</th></tr>${rowsPlan}</table>
      <p class="mute" style="font-size:12px;margin-top:8px">مجموع حجم = ${fmtN(S.lv.lvGross * 100, 0)}% سرمایه (نصف خرید، نصف فروش). با اهرم ${S.port.leverage}، مارجین لازم حدود ${fmtUsd(cap * S.lv.lvGross / S.port.leverage)} است. حد ضرر جداگانه ندارد؛ ریسک با تنوع و هم‌وزنی کنترل می‌شود.</p>` : '<div class="mute">دیتای کافی نیست</div>'}
      <p><b>تعویض بعدی سبد:</b> ${fmtT(now.next)} (به وقت تهران) — بعد از بسته شدن کندل روزانه‌ی ${WD[S.lv.lvDay]} (UTC).</p></div>
    <div class="card"><h3>📊 سبد فعلی (هفته‌ی جاری) از ${cur ? fmtT(cur.t) : '-'} — سود/زیان تا الان: <b class="num ${wkPnl >= 0 ? 'green' : 'red'}">${fmtPct(wkPnl * 100, 2)}</b> (${fmtUsd(wkPnl * cap)})</h3>
      <table><tr><th>ارز</th><th>جهت</th><th>قیمت ورود</th><th>قیمت فعلی</th><th>بازده</th></tr>
      ${curRows.map(l => `<tr><td><b>${short(l.s)}</b></td><td>${dirBadge(l.w > 0 ? 'LONG' : 'SHORT')}</td><td class="num">${fmtP(l.entry)}</td><td class="num">${fmtP(l.px)}</td><td class="num ${l.r >= 0 ? 'green' : 'red'}">${fmtPct(l.r, 2)}</td></tr>`).join('')}</table></div>
  </div>
  <div class="grid g4" style="margin-top:12px">
    <div class="card"><h3>بک‌تست: ${fmtUsd(cap)} شد</h3><div class="big num ${bt.ret >= 0 ? 'green' : 'red'}">$${fmtN(cap * (1 + bt.ret / 100))}</div><small class="mute">${fmtPct(bt.ret)} در ${bt.n} هفته</small></div>
    <div class="card"><h3>هفته‌های سودده</h3><div class="big">${fmtN(bt.win, 0)}%</div></div>
    <div class="card"><h3>بیشترین افت</h3><div class="big red num">${fmtN(bt.maxDD, 1)}%</div></div>
    <div class="card"><h3>هزینه‌ها (کارمزد + فاندینگ)</h3><div class="big amber num">${fmtN(bt.costs, 1)}%</div><small class="mute">جمع ساده‌ی هزینه‌ی هفتگی؛ فاندینگ برای هر دو طرف پرداختی فرض شده (محافظه‌کارانه)</small></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>منحنی سرمایه (USDT)</h3><canvas class="eq" id="lvCanvas"></canvas></div>
    <div class="card"><h3>⚙️ تنظیمات</h3>
      <div class="set-row"><span>طول محاسبه‌ی نوسان (روز)</span><input type="number" id="lvV" value="${S.lv.lvV}"></div>
      <div class="set-row"><span>تعداد ارز در هر طرف</span><input type="number" id="lvK" value="${S.lv.lvK}"></div>
      <div class="set-row" style="grid-template-columns:1fr 160px"><span>روز تعویض سبد (کندل روزانه، UTC)</span><select id="lvDay">${WD.map((d, i) => `<option value="${i}" ${+S.lv.lvDay === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="set-row"><span>حجم کل نسبت به سرمایه (۱ = ۱۰۰٪)</span><input type="number" step="0.25" id="lvGross" value="${S.lv.lvGross}"></div>
      <button id="lvSave" class="primary" style="margin-top:8px">ذخیره و اجرای مجدد</button>
      <p class="mute" style="font-size:12px">سرمایه، کارمزد و فاندینگ از فرم «شبیه‌سازی سرمایه» در تب بک‌تست خوانده می‌شود.</p></div>
  </div>
  <div class="card" style="margin-top:12px"><h3>تاریخچه‌ی هفته‌ها (جدیدترین بالا)</h3><div class="scroll"><table><tr><th>هفته از</th><th>خرید</th><th>فروش</th><th>بازده هفته</th><th>موجودی</th></tr>
    ${bt.weeks.slice().reverse().map(w => `<tr><td class="num">${fmtT(w.t).split(',')[0]}</td><td>${w.legs.filter(l => l.w > 0).map(l => short(l.s)).join('، ')}</td><td>${w.legs.filter(l => l.w < 0).map(l => short(l.s)).join('، ')}</td>
      <td class="num ${w.ret >= 0 ? 'green' : 'red'}">${w.done ? fmtPct(w.ret, 2) : 'در جریان'}</td><td>${w.done ? fmtUsd(cap * w.eq) : '-'}</td></tr>`).join('')}</table></div></div>
  <div class="card amber" style="margin-top:12px;font-size:13px">⚠ این استراتژی عملاً «ارزهای اصلی (BTC، BNB، ETH) در برابر آلت‌کوین‌ها» است و در ۲ سال اخیر کار کرده چون آلت‌کوین‌ها عقب ماندند. در دوره‌ی «آلت‌سیزن» (رشد سریع‌تر آلت‌ها از BTC) ضرر می‌دهد. توصیه‌ی مالی نیست.</div>`;
  $('#lvSave').onclick = () => { S.lv = { lvV: +$('#lvV').value, lvK: +$('#lvK').value, lvDay: +$('#lvDay').value, lvGross: +$('#lvGross').value }; LS.set('scanner.lv', S.lv); renderLV(); };
  drawLine(document.getElementById('lvCanvas'), [cap, ...bt.weeks.filter(w => w.done).map(w => cap * w.eq)], '$', cap);
}

/* ===================== HYPERLIQUID TRADER TRACKER ===================== */
const HL_INFO = 'https://api.hyperliquid.xyz/info', HL_LB = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const HL = { lb: null, top: [], states: {}, follow: LS.get('hl.follow', []), snap: LS.get('hl.snap', {}), alerts: LS.get('hl.alerts', []), busy: false, timer: null,
  opt: Object.assign({ minAcct: 100000, maxAcct: 20000000, maxTurn: 30, window: 'month', topN: 25, delayMin: 15, autoMin: 10 }, LS.get('hl.opt', {})) };
const OUR = () => new Set(S.syms.map(s => s.replace('-USDT', '')));
const hlPost = async body => { const r = await fetch(HL_INFO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const shortAddr = a => a.slice(0, 6) + '…' + a.slice(-4);
const usd = x => num((x < 0 ? '-' : '') + '$' + (Math.abs(x) >= 1e6 ? fmtN(Math.abs(x) / 1e6, 2) + 'M' : Math.abs(x) >= 1e3 ? fmtN(Math.abs(x) / 1e3, 1) + 'K' : fmtN(Math.abs(x))));
const perf = (row, w) => { const p = (row.windowPerformances || []).find(x => x[0] === w); return p ? { pnl: +p[1].pnl, roi: +p[1].roi * 100, vlm: +p[1].vlm } : { pnl: 0, roi: 0, vlm: 0 }; };
function hlMsg(t, cls = 'mute') { const e = $('#hlMsg'); if (e) e.innerHTML = `<span class="${cls}">${t}</span>`; }

function renderHL() {
  const box = $('#hlBody'); if (!box) return;
  const o = HL.opt;
  box.innerHTML = `
  <div class="card"><h3>👥 دنبال کردن تریدرهای Hyperliquid — همه‌ی پوزیشن‌ها روی بلاکچین عمومی است (فقط خواندنی، بدون نیاز به حساب)</h3>
    <div class="toolbar">
      <label>حداقل موجودی حساب $ <input type="number" id="hlMin" value="${o.minAcct}" style="width:110px"></label>
      <label>حداکثر موجودی $ <input type="number" id="hlMax" value="${o.maxAcct}" style="width:120px"></label>
      <label title="حجم معاملات ۳۰ روز تقسیم بر موجودی حساب؛ عدد خیلی بالا یعنی بازارساز یا ربات پرتکرار که قابل کپی نیست">حداکثر گردش ماهانه (×موجودی) <input type="number" id="hlTurn" value="${o.maxTurn}" style="width:60px"></label>
      <label>رتبه‌بندی بر اساس سود <select id="hlWin"><option value="week" ${o.window === 'week' ? 'selected' : ''}>۷ روز</option><option value="month" ${o.window === 'month' ? 'selected' : ''}>۳۰ روز</option><option value="allTime" ${o.window === 'allTime' ? 'selected' : ''}>کل دوره</option></select></label>
      <label>تعداد <input type="number" id="hlN" value="${o.topN}" style="width:60px"></label>
      <button id="hlLoad" class="primary">۱) دریافت لیست برترین‌ها</button>
      <button id="hlPos">۲) بررسی پوزیشن‌های باز</button>
      <button id="hlAuto">${HL.timer ? '⏱ پایش خودکار: روشن' : '⏱ پایش خودکار: خاموش'}</button>
      <label>هر <input type="number" id="hlEvery" value="${o.autoMin}" style="width:50px"> دقیقه</label>
    </div><div id="hlMsg" class="mute" style="font-size:13px"></div></div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>🧭 جمع‌بندی پوزیشن‌ها روی ارزهای شما (تریدرهای انتخاب‌شده)</h3><div id="hlCons"><div class="mute">ابتدا لیست را بگیرید و پوزیشن‌ها را بررسی کنید.</div></div></div>
    <div class="card"><h3>🔔 تغییرات اخیر (باز/بسته شدن پوزیشن)</h3><div id="hlAlerts" class="scroll" style="max-height:300px">${HL.alerts.length ? HL.alerts.slice(0, 60).map(a => `<div class="alert-item">${a}</div>`).join('') : '<div class="mute">هنوز تغییری ثبت نشده</div>'}</div></div>
  </div>
  <div class="card" style="margin-top:12px"><h3>🏆 برترین تریدرها ${HL.lb ? `(از ${HL.lb.length.toLocaleString()} حساب)` : ''} — ⭐ = دنبال‌شده · کلیک روی ردیف = جزئیات و بک‌تست کپی</h3><div id="hlTable"></div></div>
  <div id="hlDetail"></div>`;
  $('#hlLoad').onclick = hlLoad; $('#hlPos').onclick = () => hlPositions(false);
  $('#hlAuto').onclick = hlToggleAuto;
  ['hlMin', 'hlMax', 'hlTurn', 'hlWin', 'hlN', 'hlEvery'].forEach(id => $('#' + id).onchange = () => { HL.opt = { ...HL.opt, minAcct: +$('#hlMin').value, maxAcct: +$('#hlMax').value, maxTurn: +$('#hlTurn').value, window: $('#hlWin').value, topN: +$('#hlN').value, autoMin: Math.max(2, +$('#hlEvery').value) }; LS.set('hl.opt', HL.opt); if (HL.lb) hlRank(); });
  hlTable(); hlConsensus();
}
async function hlLoad() {
  hlMsg('در حال دریافت لیست (ممکن است چند ثانیه طول بکشد؛ فایل بزرگی است)…');
  try { const r = await fetch(HL_LB); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); HL.lb = j.leaderboardRows || j; hlRank(); hlMsg(`✅ ${HL.lb.length.toLocaleString()} حساب دریافت شد.`, 'green'); }
  catch (e) { hlMsg(`❌ اتصال به Hyperliquid برقرار نشد (${e.message}). اینترنت/VPN را بررسی کنید. اگر مرورگر خطای CORS می‌دهد، بگویید تا نسخه‌ی پروکسی بسازم.`, 'red'); }
}
function hlRank() {
  const o = HL.opt;
  const rows = HL.lb.map(r => ({ addr: (r.ethAddress || '').toLowerCase(), name: r.displayName || '', acct: +r.accountValue, day: perf(r, 'day'), week: perf(r, 'week'), month: perf(r, 'month'), all: perf(r, 'allTime') }))
    .filter(r => r.addr && r.acct >= o.minAcct && (!o.maxAcct || r.acct <= o.maxAcct) && r.all.pnl > 0 && r.month.pnl > 0 && r.month.vlm > 0 && (!o.maxTurn || r.month.vlm / r.acct <= o.maxTurn));
  const key = o.window === 'allTime' ? 'all' : o.window;
  rows.sort((a, b) => b[key].pnl - a[key].pnl);
  const fol = rows.filter(r => HL.follow.includes(r.addr));
  HL.top = [...fol, ...rows.filter(r => !HL.follow.includes(r.addr)).slice(0, Math.max(0, o.topN - fol.length))];
  hlTable();
}
function hlTable() {
  const el = $('#hlTable'); if (!el) return;
  if (!HL.top.length) { el.innerHTML = '<div class="mute">لیست هنوز دریافت نشده.</div>'; return; }
  el.innerHTML = `<div class="scroll"><table><tr><th></th><th>آدرس</th><th>موجودی حساب</th><th>سود ۷ روز</th><th>سود ۳۰ روز (ROI)</th><th>سود کل دوره</th><th>حجم ۳۰ روز</th><th>گردش</th><th>پوزیشن‌های باز</th></tr>
  ${HL.top.map(r => { const st = HL.states[r.addr]; const pos = st ? st.positions.map(p => `<span class="badge ${p.size > 0 ? 'b-long' : 'b-short'}">${p.coin}</span>`).join(' ') || '<span class="mute">ندارد</span>' : '<span class="mute">—</span>';
    return `<tr class="click" data-a="${r.addr}"><td><span data-f="${r.addr}" style="cursor:pointer">${HL.follow.includes(r.addr) ? '⭐' : '☆'}</span></td><td><span class="addr">${shortAddr(r.addr)}</span> ${r.name ? `<small class="mute">${r.name}</small>` : ''}</td>
      <td>${usd(r.acct)}</td><td class="${r.week.pnl >= 0 ? 'green' : 'red'}">${usd(r.week.pnl)}</td><td class="green">${usd(r.month.pnl)} <small class="num">(${fmtN(r.month.roi, 0)}%)</small></td><td>${usd(r.all.pnl)}</td><td>${usd(r.month.vlm)}</td><td class="num">${fmtN(r.month.vlm / r.acct, 1)}×</td><td>${pos}</td></tr>`; }).join('')}</table></div>`;
  el.querySelectorAll('[data-f]').forEach(x => x.onclick = e => { e.stopPropagation(); const a = x.dataset.f; HL.follow = HL.follow.includes(a) ? HL.follow.filter(y => y !== a) : [...HL.follow, a]; LS.set('hl.follow', HL.follow); hlTable(); });
  el.querySelectorAll('tr[data-a]').forEach(tr => tr.onclick = () => hlDetail(tr.dataset.a));
}
function parseState(st) {
  return { acct: +(st.marginSummary || {}).accountValue || 0, positions: (st.assetPositions || []).map(x => x.position || x).map(p => ({
    coin: p.coin, size: +p.szi, entry: +p.entryPx, value: +p.positionValue, upnl: +p.unrealizedPnl, roe: +p.returnOnEquity * 100, lev: p.leverage ? +p.leverage.value : null, liq: p.liquidationPx ? +p.liquidationPx : null })).filter(p => p.size !== 0) };
}
async function hlPositions(silent) {
  if (HL.busy) return; if (!HL.top.length) { hlMsg('ابتدا لیست برترین‌ها را دریافت کنید.', 'amber'); return; }
  HL.busy = true; let done = 0, fail = 0; const changes = [];
  const list = HL.top.slice();
  const worker = async () => { while (list.length) { const r = list.shift();
    try { const st = parseState(await hlPost({ type: 'clearinghouseState', user: r.addr })); HL.states[r.addr] = st; diffSnap(r.addr, st, changes); } catch (e) { fail++; }
    done++; if (!silent) hlMsg(`بررسی پوزیشن‌ها… ${done}/${HL.top.length}`); await new Promise(z => setTimeout(z, 150)); } };
  await Promise.all([worker(), worker(), worker()]);
  HL.busy = false;
  LS.set('hl.snap', HL.snap);
  if (changes.length) { HL.alerts = [...changes, ...HL.alerts].slice(0, 200); LS.set('hl.alerts', HL.alerts); if (changes.some(c => c.includes('⭐'))) beep(); }
  hlMsg(`✅ پوزیشن‌های ${done - fail} تریدر به‌روز شد${fail ? ` (${fail} خطا)` : ''} · ${new Date().toLocaleTimeString('fa-IR')}${changes.length ? ` · ${changes.length} تغییر جدید` : ''}`, 'green');
  hlTable(); hlConsensus(); const a = $('#hlAlerts'); if (a && HL.alerts.length) a.innerHTML = HL.alerts.slice(0, 60).map(x => `<div class="alert-item">${x}</div>`).join('');
}
function diffSnap(addr, st, out) {
  const prev = HL.snap[addr], cur = {}; for (const p of st.positions) cur[p.coin] = p.size;
  if (prev) {
    const tag = (HL.follow.includes(addr) ? '⭐ ' : '') + `<span class="addr">${shortAddr(addr)}</span>`, t = new Date().toLocaleString('fa-IR');
    for (const c in cur) {
      const p = st.positions.find(x => x.coin === c);
      if (!(c in prev)) out.push(`${t} · ${tag} <b>باز کرد</b> ${dirBadge(cur[c] > 0 ? 'LONG' : 'SHORT')} ${c} ${usd(p.value)} در ${num(fmtP(p.entry))}`);
      else if (Math.sign(prev[c]) !== Math.sign(cur[c])) out.push(`${t} · ${tag} <b>جهت را برگرداند</b> ${c} → ${dirBadge(cur[c] > 0 ? 'LONG' : 'SHORT')}`);
      else if (Math.abs(cur[c]) > Math.abs(prev[c]) * 1.25) out.push(`${t} · ${tag} حجم ${c} را <b>افزایش داد</b> (${usd(p.value)})`);
    }
    for (const c in prev) if (!(c in cur)) out.push(`${t} · ${tag} <b>بست</b> ${c} (${prev[c] > 0 ? 'Long' : 'Short'})`);
  }
  HL.snap[addr] = cur;
}
function hlConsensus() {
  const el = $('#hlCons'); if (!el) return;
  const ours = OUR(), agg = {};
  let n = 0;
  for (const r of HL.top) { const st = HL.states[r.addr]; if (!st) continue; n++;
    for (const p of st.positions) { if (!ours.has(p.coin)) continue; const a = agg[p.coin] || (agg[p.coin] = { L: 0, S: 0, lv: 0, sv: 0, lev: [] });
      if (p.size > 0) { a.L++; a.lv += p.value; } else { a.S++; a.sv += p.value; } if (p.lev) a.lev.push(p.lev); } }
  if (!n) { el.innerHTML = '<div class="mute">پوزیشنی بررسی نشده.</div>'; return; }
  const rows = Object.entries(agg).sort((a, b) => (b[1].lv + b[1].sv) - (a[1].lv + a[1].sv));
  el.innerHTML = `<div class="mute" style="font-size:12px;margin-bottom:6px">از ${n} تریدر بررسی‌شده</div><table><tr><th>ارز</th><th>Long</th><th>Short</th><th>نسبت حجم دلاری</th><th>برآیند</th><th>اهرم میانه</th></tr>
  ${rows.map(([c, a]) => { const tot = a.lv + a.sv, lp = tot ? a.lv / tot * 100 : 0, lev = a.lev.sort((x, y) => x - y)[a.lev.length >> 1];
    const bias = lp >= 65 ? dirBadge('LONG') : lp <= 35 ? dirBadge('SHORT') : '<span class="badge b-range">دوطرفه</span>';
    return `<tr><td><b>${c}</b></td><td>${a.L} <small class="mute">${usd(a.lv)}</small></td><td>${a.S} <small class="mute">${usd(a.sv)}</small></td>
      <td><div class="bar"><i style="width:${lp}%;background:#22c55e"></i><i style="width:${100 - lp}%;background:#ef4444"></i></div></td><td>${bias}</td><td>${lev ? lev + 'x' : '-'}</td></tr>`; }).join('') || '<tr><td colspan="6" class="mute">هیچ‌کدام روی ارزهای شما پوزیشن ندارند</td></tr>'}</table>`;
}
function hlToggleAuto() {
  if (HL.timer) { clearInterval(HL.timer); HL.timer = null; }
  else { hlPositions(true); HL.timer = setInterval(() => hlPositions(true), HL.opt.autoMin * 60000); }
  const b = $('#hlAuto'); if (b) b.textContent = HL.timer ? '⏱ پایش خودکار: روشن' : '⏱ پایش خودکار: خاموش';
}

// ---- trader detail + copy-trade backtest ----
async function fetchFills(addr, days) {
  let start = Date.now() - days * 86400000, all = [];
  for (let k = 0; k < 6; k++) {
    const f = await hlPost({ type: 'userFillsByTime', user: addr, startTime: start, aggregateByTime: true });
    if (!Array.isArray(f) || !f.length) break;
    all = all.concat(f); if (f.length < 2000) break;
    start = Math.max(...f.map(x => x.time)) + 1;
  }
  return all.sort((a, b) => a.time - b.time);
}
function tradesFromFills(fills) {
  const pos = {}, open = {}, trades = [];
  for (const f of fills) {
    const c = f.coin; if (c.startsWith('@') || c.includes(':')) continue;      // skip spot / HIP-3
    const sz = +f.sz * (f.side === 'B' ? 1 : -1), start = f.startPosition != null ? +f.startPosition : (pos[c] || 0);
    let end = start + sz; if (Math.abs(end) < 1e-9 * Math.max(1, Math.abs(start))) end = 0;
    const fee = +f.fee || 0, cp = +f.closedPnl || 0, px = +f.px;
    if (start === 0 || Math.sign(start) !== Math.sign(end) && end !== 0) {
      if (start !== 0 && open[c]) { const o = open[c]; o.exitT = f.time; o.exitPx = px; o.pnl += cp - fee; trades.push(o); }
      if (end !== 0) open[c] = { coin: c, dir: end > 0 ? 1 : -1, entryT: f.time, entryPx: px, pnl: start === 0 ? -fee : 0, maxSz: Math.abs(end), notional: Math.abs(end) * px };
      else delete open[c];
    } else if (open[c]) {
      const o = open[c]; o.pnl += cp - fee; o.maxSz = Math.max(o.maxSz, Math.abs(end)); o.notional = Math.max(o.notional, Math.abs(end) * px);
      if (end === 0 || Math.abs(end) < 1e-12) { o.exitT = f.time; o.exitPx = px; trades.push(o); delete open[c]; }
    }
    pos[c] = end;
  }
  return { trades, open: Object.values(open) };
}
function priceAt(sym, tsMs) {           // first 15m close at/after time (our KuCoin data)
  const o = S.O[sym]; if (!o || !o.ctx) return null; const M = o.ctx.M, t = tsMs / 1000;
  let lo = 0, hi = M.n - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (M.t[m] + 900 >= t) { a = m; hi = m - 1; } else lo = m + 1; }
  return a < 0 ? null : M.c[a];
}
async function hlDetail(addr) {
  const box = $('#hlDetail'); const r = HL.top.find(x => x.addr === addr) || { addr };
  box.innerHTML = `<div class="card" style="margin-top:12px"><h3>🔎 <span class="addr">${addr}</span></h3><div class="mute">در حال دریافت پوزیشن‌ها و تاریخچه‌ی ۹۰ روز…</div></div>`;
  box.scrollIntoView({ behavior: 'smooth' });
  try {
    const st = HL.states[addr] || parseState(await hlPost({ type: 'clearinghouseState', user: addr })); HL.states[addr] = st;
    const fills = await fetchFills(addr, 90);
    const { trades } = tradesFromFills(fills);
    const D = +HL.opt.delayMin * 60000, fee = 2 * S.port.takerFee / 100;
    const ours = OUR();
    let own = 0, wins = 0, cp = [], days = {};
    for (const t of trades) { own += t.pnl; if (t.pnl > 0) wins++; const d = new Date(t.exitT).toISOString().slice(0, 10); days[d] = (days[d] || 0) + t.pnl; }
    for (const t of trades.filter(t => ours.has(t.coin))) {
      const sym = t.coin + '-USDT', e = priceAt(sym, t.entryT + D), x = priceAt(sym, t.exitT + D);
      if (e && x) cp.push({ ...t, copyRet: t.dir * (x / e - 1) * 100 - fee * 100, ownRet: t.dir * (t.exitPx / t.entryPx - 1) * 100, e, x });
    }
    const cpSum = cp.reduce((a, t) => a + t.copyRet, 0), cpWin = cp.filter(t => t.copyRet > 0).length, ownSum = cp.reduce((a, t) => a + t.ownRet, 0);
    const dvals = Object.values(days), posDays = dvals.filter(x => x > 0).length;
    const hold = trades.length ? trades.reduce((a, t) => a + (t.exitT - t.entryT), 0) / trades.length / 3600000 : 0;
    const verdict = cp.length < 10 ? '<span class="amber">نمونه‌ی کم روی ارزهای شما — قضاوت قابل اتکا نیست</span>'
      : cpSum > 0 && cpWin / cp.length >= 0.45 ? '<b class="green">کپی با تأخیر هم سودده بوده</b>' : '<b class="red">کپی با تأخیر سودده نبوده — دنبال کردن توصیه نمی‌شود</b>';
    box.innerHTML = `<div class="card" style="margin-top:12px"><h3>🔎 <span class="addr">${addr}</span> ${r.name ? '· ' + r.name : ''}</h3>
      <div class="grid g4">
        <div class="card"><h3>موجودی حساب</h3><div class="big">${usd(st.acct)}</div></div>
        <div class="card"><h3>سود تحقق‌یافته ۹۰ روز (خود تریدر)</h3><div class="big ${own >= 0 ? 'green' : 'red'}">${usd(own)}</div><small class="mute">${trades.length} معامله · برد ${trades.length ? fmtN(wins / trades.length * 100, 0) : 0}% · روزهای سودده ${dvals.length ? fmtN(posDays / dvals.length * 100, 0) : 0}%</small></div>
        <div class="card"><h3>مدت میانگین معامله</h3><div class="big">${hold < 48 ? fmtN(hold, 1) + ' ساعت' : fmtN(hold / 24, 1) + ' روز'}</div><small class="mute">${hold < 2 ? 'اسکالپر — کپی دستی عملاً ممکن نیست' : ''}</small></div>
        <div class="card"><h3>بک‌تست کپی با ${HL.opt.delayMin} دقیقه تأخیر</h3><div class="big num ${cpSum >= 0 ? 'green' : 'red'}">${fmtPct(cpSum)}</div><small class="mute">جمع بازده ${cp.length} معامله روی ارزهای شما (بعد از کارمزد) · برد ${cp.length ? fmtN(cpWin / cp.length * 100, 0) : 0}% · بازده خود تریدر روی همین‌ها ${fmtPct(ownSum)}</small></div>
      </div>
      <p>نتیجه: ${verdict}. <span class="mute" style="font-size:12px">ورود و خروج کپی با قیمت بسته‌شدن ۱۵ دقیقه‌ی KuCoin بعد از تأخیر حساب شده؛ تأخیر را می‌توانید عوض کنید:</span>
        <input type="number" id="hlDelay" value="${HL.opt.delayMin}" style="width:60px"> دقیقه <button id="hlRe">محاسبه‌ی مجدد</button>
        <button id="hlFol">${HL.follow.includes(addr) ? '⭐ دنبال‌شده (حذف)' : '☆ دنبال کن'}</button></p>
      <div class="grid g2"><div><h3>پوزیشن‌های باز</h3><table><tr><th>ارز</th><th>جهت</th><th>حجم</th><th>ورود</th><th>اهرم</th><th>سود/زیان</th><th>لیکوئید</th></tr>
        ${st.positions.map(p => `<tr><td><b>${p.coin}</b></td><td>${dirBadge(p.size > 0 ? 'LONG' : 'SHORT')}</td><td>${usd(p.value)}</td><td class="num">${fmtP(p.entry)}</td><td>${p.lev ? p.lev + 'x' : '-'}</td><td class="${p.upnl >= 0 ? 'green' : 'red'}">${usd(p.upnl)}</td><td class="num">${p.liq ? fmtP(p.liq) : '-'}</td></tr>`).join('') || '<tr><td colspan="7" class="mute">پوزیشن باز ندارد</td></tr>'}</table></div>
      <div><h3>معاملات اخیر روی ارزهای شما (کپی)</h3><div class="scroll" style="max-height:300px"><table><tr><th>ارز</th><th>جهت</th><th>ورود</th><th>خروج</th><th>تریدر</th><th>کپی</th></tr>
        ${cp.slice().reverse().slice(0, 40).map(t => `<tr><td>${t.coin}</td><td>${dirBadge(t.dir > 0 ? 'LONG' : 'SHORT')}</td><td class="num">${fmtT(t.entryT / 1000)}</td><td class="num">${fmtT(t.exitT / 1000)}</td><td class="num ${t.ownRet >= 0 ? 'green' : 'red'}">${fmtPct(t.ownRet, 2)}</td><td class="num ${t.copyRet >= 0 ? 'green' : 'red'}">${fmtPct(t.copyRet, 2)}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">معامله‌ای روی ارزهای شما نداشته</td></tr>'}</table></div></div></div></div>`;
    $('#hlRe').onclick = () => { HL.opt.delayMin = +$('#hlDelay').value; LS.set('hl.opt', HL.opt); hlDetail(addr); };
    $('#hlFol').onclick = () => { HL.follow = HL.follow.includes(addr) ? HL.follow.filter(y => y !== addr) : [...HL.follow, addr]; LS.set('hl.follow', HL.follow); hlDetail(addr); hlTable(); };
  } catch (e) { box.innerHTML = `<div class="card red" style="margin-top:12px">خطا در دریافت اطلاعات: ${e.message}</div>`; }
}
renderHL();
