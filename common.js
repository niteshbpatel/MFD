/* ================================================================
   SIP Ledger / SWP Planner — Shared Helpers & Auto-NAV Engine
   ================================================================ */

/* ---------------- formatting ---------------- */
function fmtINR(n){
  if (!isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(Math.round(n));
  return sign + '₹' + n.toLocaleString('en-IN');
}
function fmtPct(n){ return isFinite(n) ? (n>=0?'+':'') + n.toFixed(1) + '%' : '—'; }
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function formatDate(str){
  const d = new Date(str);
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}
function formatDateObj(d){
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}
function uid(prefix){ return (prefix||'e') + Date.now() + Math.floor(Math.random()*1000); }
function debounce(fn, wait){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* ---------------- fund avatar (colour + initial) ---------------- */
const AVATAR_COLORS = ['#2f5be0','#16a34a','#d97706','#dc2626','#0891b2','#7c3aed','#db2777','#4b5563'];
function fundColor(name){
  let h = 0;
  for (let i = 0; i < (name||'').length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function fundInitial(name){
  const trimmed = (name || '?').trim();
  return trimmed ? trimmed.toUpperCase() : '?';
}

/* ---------------- range slider fill ---------------- */
function wireRangeFill(input){
  const update = () => {
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const val = parseFloat(input.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', pct.toFixed(2) + '%');
  };
  input.addEventListener('input', update);
  update();
}

/* ---------------- date math ---------------- */
function monthsBetween(startDateStr, endDate){
  const start = new Date(startDateStr);
  const end = endDate;
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(months, 0);
}

/* ---------------- SIP math ---------------- */
function sipFV(monthlyAmt, monthlyRate, n){
  if (n <= 0) return 0;
  if (Math.abs(monthlyRate) < 1e-9) return monthlyAmt * n;
  return monthlyAmt * ((Math.pow(1+monthlyRate, n) - 1) / monthlyRate) * (1+monthlyRate);
}
function solveCAGR(monthlyAmt, n, targetValue){
  if (n <= 0 || monthlyAmt <= 0) return null;
  let lo = -0.95, hi = 4.0;
  const f = (r) => sipFV(monthlyAmt, r/12, n) - targetValue;
  let flo = f(lo), fhi = f(hi);
  if (flo > 0 && fhi > 0) return hi;
  if (flo < 0 && fhi < 0) return lo;
  for (let i=0;i<80;i++){
    const mid = (lo+hi)/2;
    const fm = f(mid);
    if (Math.abs(fm) < 1) return mid;
    if ((fm>0) === (flo>0)) { lo = mid; flo = fm; } else { hi = mid; }
  }
  return (lo+hi)/2;
}
function simulateSIPFuture(currentValue, monthlyAmt, stepUpType, stepUpValue, annualGrowthRate, horizonMonths){
  const monthlyGrowth = annualGrowthRate / 12;
  let balance = currentValue;
  let contrib = monthlyAmt;
  let totalInvested = 0;
  const yearly = [];
  for (let m = 1; m <= horizonMonths; m++){
    balance = (balance + contrib) * (1 + monthlyGrowth);
    totalInvested += contrib;
    if (m % 12 === 0){
      yearly.push(balance);
      if (stepUpType === 'percent' && stepUpValue) contrib = contrib * (1 + stepUpValue/100);
      else if (stepUpType === 'amount' && stepUpValue) contrib = contrib + parseFloat(stepUpValue);
    }
  }
  return { nominal: balance, yearly, totalInvested };
}

function dailySIPFV(dailyAmt, annualRate, years){
  const days = Math.round(years * 365);
  return sipFV(dailyAmt, annualRate/365, days);
}

function solveRequiredSIP(targetFV, annualRate, months){
  const monthlyRate = annualRate / 12;
  const perRupeeFV = sipFV(1, monthlyRate, months);
  if (perRupeeFV <= 0) return null;
  return targetFV / perRupeeFV;
}

function simulateHistoricalSIP(schedule, annualGrowthRate, endDate){
  const sorted = schedule.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  if (sorted.length === 0) return { nominal: 0, yearly: [], totalInvested: 0, months: 0, finalMonthlyAmount: 0 };

  const start = new Date(sorted.date);
  const monthlyGrowth = annualGrowthRate / 12;
  let balance = 0;
  let totalInvested = 0;
  const yearly = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  let monthIndex = 0;
  let activeAmount = sorted.amount;
  let stepIdx = 0;

  while (cursor <= endMonth){
    while (stepIdx < sorted.length && new Date(sorted[stepIdx].date) <= cursor){
      activeAmount = sorted[stepIdx].amount;
      stepIdx++;
    }
    balance = (balance + activeAmount) * (1 + monthlyGrowth);
    totalInvested += activeAmount;
    monthIndex++;
    if (monthIndex % 12 === 0) yearly.push(balance);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return { nominal: balance, yearly, totalInvested, months: monthIndex, finalMonthlyAmount: activeAmount };
}

/* ---------------- SWP math ---------------- */
function simulateSWP(corpus, withdrawalType, withdrawalValue, annualGrowthRate, annualInflation, stepUpWithInflation, durationYears){
  const monthlyGrowth = annualGrowthRate / 12;
  let balance = corpus;
  let currentMonthlyWithdrawal = withdrawalType === 'percent'
    ? balance * (withdrawalValue/100) / 12
    : parseFloat(withdrawalValue);

  let totalWithdrawn = 0;
  let depletedAtMonth = null;
  const rows = [];

  for (let year = 1; year <= durationYears; year++){
    if (withdrawalType === 'percent'){
      currentMonthlyWithdrawal = balance * (withdrawalValue/100) / 12;
    } else if (year > 1 && stepUpWithInflation){
      currentMonthlyWithdrawal = currentMonthlyWithdrawal * (1 + annualInflation);
    }
    const opening = balance;
    let withdrawnThisYear = 0;
    let deplete = false;
    for (let m = 1; m <= 12; m++){
      if (balance <= 0){ deplete = true; if (depletedAtMonth===null) depletedAtMonth = (year-1)*12 + m; continue; }
      balance = balance * (1 + monthlyGrowth) - currentMonthlyWithdrawal;
      if (balance < 0){ balance = 0; if (depletedAtMonth===null) depletedAtMonth = (year-1)*12 + m; }
      withdrawnThisYear += currentMonthlyWithdrawal;
    }
    totalWithdrawn += withdrawnThisYear;
    rows.push({ year, opening, withdrawn: withdrawnThisYear, closing: balance, depleted: deplete });
  }

  const endingNominal = balance;
  const endingReal = endingNominal / Math.pow(1 + annualInflation, durationYears);
  return { rows, totalWithdrawn, endingNominal, endingReal, depletedAtMonth };
}

/* ---------------- live fund name search (AMFI via mfapi.in) ---------------- */
let _mfListPromise = null;
function getMFList(){
  if (!_mfListPromise){
    _mfListPromise = fetch('https://api.mfapi.in/mf')
      .then(res => { if (!res.ok) throw new Error('bad response'); return res.json(); })
      .catch(err => { console.warn('Live fund search unavailable, falling back to free text:', err); return []; });
  }
  return _mfListPromise;
}
function searchMFList(list, query, limit){
  limit = limit || 8;
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2 || !list || list.length === 0) return [];
  const starts = [], contains = [];
  for (let i = 0; i < list.length; i++){
    const name = list[i].schemeName;
    if (!name) continue;
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) { if (starts.length < limit) starts.push(list[i]); }
    else if (lower.includes(q)) { if (contains.length < limit) contains.push(list[i]); }
    if (starts.length >= limit && contains.length >= limit) break;
  }
  return starts.concat(contains).slice(0, limit);
}

function attachFundAutocomplete(inputEl, opts){
  opts = opts || {};
  const host = inputEl.parentElement;
  host.style.position = 'relative';
  const list = document.createElement('div');
  list.className = 'autocomplete-list';
  list.style.display = 'none';
  host.appendChild(list);

  let currentMatches = [];
  let activeIndex = -1;

  function hide(){ list.style.display = 'none'; list.innerHTML = ''; activeIndex = -1; }

  function renderMatches(items){
    currentMatches = items;
    activeIndex = -1;
    if (items.length === 0){
      list.innerHTML = '<div class="autocomplete-empty">No matches — you can still type any name.</div>';
    } else {
      list.innerHTML = items.map((it, i) =>
        `<div class="autocomplete-item" data-i="${i}">${escapeHtml(it.schemeName)}</div>`
      ).join('');
      list.querySelectorAll('.autocomplete-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectItem(currentMatches[parseInt(el.getAttribute('data-i'), 10)]);
        });
      });
    }
    list.style.display = 'block';
  }

  function selectItem(item){
    inputEl.value = item.schemeName;
    inputEl.dataset.schemeCode = item.schemeCode || '';
    hide();
    if (opts.onSelect) opts.onSelect(item);
  }

  const onType = debounce(() => {
    const q = inputEl.value;
    if (q.trim().length < 2){ hide(); return; }
    list.style.display = 'block';
    list.innerHTML = '<div class="autocomplete-empty">Searching live fund list…</div>';
    getMFList().then(fullList => {
      if (!fullList || fullList.length === 0){
        list.innerHTML = '<div class="autocomplete-empty">Live search unavailable right now — type any name.</div>';
        return;
      }
      renderMatches(searchMFList(fullList, inputEl.value, 8));
    });
  }, 220);

  inputEl.addEventListener('input', () => { delete inputEl.dataset.schemeCode; });
  inputEl.addEventListener('input', onType);
  inputEl.addEventListener('focus', () => { if (inputEl.value.trim().length >= 2) onType(); });
  inputEl.addEventListener('blur', () => setTimeout(hide, 150));
  inputEl.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;
    if (e.key === 'ArrowDown'){ e.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); updateActive(); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); updateActive(); }
    else if (e.key === 'Enter'){ if (activeIndex >= 0){ e.preventDefault(); selectItem(currentMatches[activeIndex]); } }
    else if (e.key === 'Escape'){ hide(); }
  });
  function updateActive(){
    list.querySelectorAll('.autocomplete-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
      if (i === activeIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }
}

/* ---------------- live NAV auto-update and valuation engine ---------------- */
async function updatePortfolioLiveNAV(entry) {
  if (!entry || !entry.schemeCode) return null;
  try {
    const response = await fetch(`https://api.mfapi.in/mf/${entry.schemeCode}/latest`);
    if (!response.ok) throw new Error('Network fallback triggered');
    const jsonResult = await response.json();
    if (jsonResult && jsonResult.data && jsonResult.data) {
      const liveNavValue = parseFloat(jsonResult.data.nav);
      const liveDateString = jsonResult.data.date;
      
      // Calculate real present value dynamically if historical units exist
      let calculatedPresentValue = entry.presentValue; 
      if (entry.units && liveNavValue) {
        calculatedPresentValue = Math.round(entry.units * liveNavValue);
      }
      return {
        nav: liveNavValue,
        date: liveDateString,
        currentValuation: calculatedPresentValue
      };
    }
  } catch (err) {
    console.warn("Live NAV fallback active for schemeCode:", entry.schemeCode, err);
    return null;
  }
  return null;
}

const _mfHistoryCache = {};
function fetchSchemeHistory(code){
  if (!code) return Promise.resolve(null);
  if (!_mfHistoryCache[code]){
    _mfHistoryCache[code] = fetch(`https://api.mfapi.in/mf/${code}`)
      .then(res => { if (!res.ok) throw new Error('bad response'); return res.json(); })
      .then(json => (json && json.data) ? json.data : null)
      .catch(err => { console.warn('NAV history fetch failed:', err); return null; });
  }
  return _mfHistoryCache[code];
}
function parseMFDate(str){ 
  const [d, m, y] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function parseNavHistory(raw){
  return raw
    .map(pt => ({ date: parseMFDate(pt.date), nav: parseFloat(pt.nav) }))
    .filter(pt => !isNaN(pt.nav) && !isNaN(pt.date.getTime()))
    .sort((a, b) => a.date - b.date);
}
function navOnOrBefore(history, targetDate){
  let lo = 0, hi = history.length - 1, ans = null;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    if (history[mid].date <= targetDate){ ans = history[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans || history || null;
}
function computeLiveNAVCheck(schemeCode, startDateStr, monthlyAmt, today){
  return fetchSchemeHistory(schemeCode).then(raw => {
    if (!raw || raw.length === 0) return null;
    const history = parseNavHistory(raw);
    if (history.length === 0) return null;

    const start = new Date(startDateStr);
    let totalUnits = 0;
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let purchases = 0;
    while (cursor <= today){
      const pt = navOnOrBefore(history, cursor);
      if (pt && pt.nav > 0){ totalUnits += monthlyAmt / pt.nav; purchases++; }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    }
    if (purchases === 0) return null;

    const latest = history[history.length - 1];
    return {
      calculatedValue: totalUnits * latest.nav,
      latestNav: latest.nav,
      latestNavDate: latest.date,
      totalUnits,
      purchases
    };
  });
}

function buildNavCheckHTML(entryId, state, presentValue){
  const id = `navcheck-${entryId}`;
  if (state === 'no-code'){
    return `<div id="${id}" class="nav-check-box muted">Live NAV check unavailable — this fund wasn't picked from the live search suggestions. Remove and re-add it, selecting a suggestion this time, to enable this.</div>`;
  }
  if (state === 'loading'){
    return `<div id="${id}" class="nav-check-box muted">Checking live NAV data…</div>`;
  }
  if (state === 'error' || state === null || state === undefined){
    return `<div id="${id}" class="nav-check-box muted">Couldn't reach live NAV data for this fund right now — try reopening this entry later.</div>`;
  }

  const diff = presentValue - state.calculatedValue;
  const diffPct = state.calculatedValue > 0 ? (diff / state.calculatedValue) * 100 : 0;
  const absPct = Math.abs(diffPct);
  const cls = absPct <= 5 ? 'ok' : (absPct <= 15 ? 'warn-mild' : 'warn');
  const statusText = absPct <= 5
    ? 'Matches live NAV data closely'
    : (diffPct > 0
        ? `Your entered value is ${fmtPct(diffPct)} above what real NAVs suggest`
        : `Your entered value is ${fmtPct(diffPct)} below what real NAVs suggest`);

  return `
    <div id="${id}" class="nav-check-box ${cls}">
      <div class="ptitle">Live NAV check <span class="nav-date">NAV ₹${state.latestNav.toFixed(4)} as of ${formatDateObj(state.latestNavDate)}</span></div>
      <div class="proj-row"><span class="k">Expected value from real SIP purchases (${state.purchases} installments)</span><span class="v">${fmtINR(state.calculatedValue)}</span></div>
      <div class="proj-row big"><span class="k">vs. what you entered (${fmtINR(presentValue)})</span><span class="v">${statusText}</span></div>
    </div>
  `;
}

/* ---------------- inline SVG charts ---------------- */
function buildAreaLineChart(nominalPoints, realPoints, opts){
  opts = opts || {};
  const w = opts.width || 320, h = opts.height || 120;
  const accent = opts.accentColor || 'var(--accent-b)';
  const second = opts.secondColor || 'var(--iris)';
  const all = nominalPoints.concat(realPoints || []);
  const maxVal = Math.max.apply(null, all.concat()) * 1.08;
  const n = nominalPoints.length;
  const stepX = n > 1 ? w / (n - 1) : w;
  const toXY = (arr) => arr.map((v, i) => [i * stepX, h - (v / maxVal) * h]);
  const lineFrom = (xy) => 'M' + xy.map(p => p.toFixed(1) + ',' + p.toFixed(1)).join(' L');
  const areaFrom = (xy) => `M0,${h} L` + xy.map(p => p.toFixed(1) + ',' + p.toFixed(1)).join(' L') + ` L${w},${h} Z`;

  const nomXY = toXY(nominalPoints);
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`;
  svg += `<path d="${areaFrom(nomXY)}" fill="${accent}" fill-opacity="0.16" stroke="none"/>`;
  svg += `<path d="${lineFrom(nomXY)}" fill="none" stroke="${accent}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (realPoints && realPoints.length){
    const realXY = toXY(realPoints);
    svg += `<path d="${lineFrom(realXY)}" fill="none" stroke="${second}" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>`;
  }
  svg += `</svg>`;
  return svg;
}

function buildDonutChart(segments, opts){
  opts = opts || {};
  const size = opts.size || 150, thickness = opts.thickness || 20;
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let cumulative = 0;
  let circles = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(28,36,31,0.08)" stroke-width="${thickness}"/>`;
  segments.forEach(seg => {
    const frac = seg.value / total;
    if (frac <= 0) return;
    const dash = frac * circumference;
    const gap = circumference - dash;
    const offset = -cumulative * circumference;
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${thickness}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
    cumulative += frac;
  });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${circles}</svg>`;
}

/* ---------------- generic calculators ---------------- */
function lumpsumFV(principal, annualRate, years){
  return principal * Math.pow(1 + annualRate, years);
}
function periodicSIPFV(amt, annualRate, periodsPerYear, years){
  const n = Math.round(periodsPerYear * years);
  const r = annualRate / periodsPerYear;
  return sipFV(amt, r, n);
}

/* ---------------- SIP with a logged, dated step-up history ---------------- */
function buildMonthlyContribSchedule(startDate, originalAmt, stepUpLog, todayDate, endDate, futureStepUpType, futureStepUpValue){
  const sortedLog = (stepUpLog || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const schedule = [];
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  let futureContrib = null;
  let monthsIntoFuture = 0;
  while (cursor <= end){
    let amt;
    if (cursor <= todayDate){
      amt = originalAmt;
      for (const ev of sortedLog){ if (new Date(ev.date) <= cursor) amt = parseFloat(ev.amount); else break; }
    } else {
      if (futureContrib === null){
        futureContrib = originalAmt;
        for (const ev of sortedLog){ if (new Date(ev.date) <= todayDate) futureContrib = parseFloat(ev.amount); }
      }
      amt = futureContrib;
      monthsIntoFuture++;
      if (monthsIntoFuture % 12 === 0){
        if (futureStepUpType === 'percent' && futureStepUpValue) futureContrib = futureContrib * (1 + futureStepUpValue/100);
        else if (futureStepUpType === 'amount' && futureStepUpValue) futureContrib = futureContrib + parseFloat(futureStepUpValue);
      }
    }
    schedule.push({ date: new Date(cursor), amount: amt });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return schedule;
}
function effectiveMonthlyAmount(originalAmt, stepUpLog, atDate){
  let amt = originalAmt;
  (stepUpLog || []).slice().sort((a,b)=> new Date(a.date)-new Date(b.date)).forEach(ev => {
    if (new Date(ev.date) <= atDate) amt = parseFloat(ev.amount);
  });
  return amt;
}
function fvWithSchedule(amounts, monthlyRate){
  let balance = 0;
  for (const amt of amounts) balance = (balance + amt) * (1 + monthlyRate);
  return balance;
}
function solveCAGRWithSchedule(amounts, targetValue){
  if (!amounts.length) return null;
  let lo = -0.95, hi = 4.0;
  const f = (r) => fvWithSchedule(amounts, r/12) - targetValue;
  let flo = f(lo), fhi = f(hi);
  if (flo > 0 && fhi > 0) return hi;
  if (flo < 0 && fhi < 0) return lo;
  for (let i=0;i<80;i++){
    const mid = (lo+hi)/2, fm = f(mid);
    if (Math.abs(fm) < 1) return mid;
    if ((fm>0)===(flo>0)) { lo=mid; flo=fm; } else hi=mid;
  }
  return (lo+hi)/2;
}
function simulateAccumulationWithSchedule(schedule, annualGrowthRate){
  const monthlyGrowth = annualGrowthRate / 12;
  let balance = 0;
  const yearly = [];
  schedule.forEach((row, i) => {
    balance = (balance + row.amount) * (1 + monthlyGrowth);
    if ((i+1) % 12 === 0) yearly.push(balance);
  });
  return { corpus: balance, yearly };
}

/* ---------------- shared storage ---------------- */
const LEDGER_KEY = 'sipLedgerEntries';
function loadLedgerEntries(){
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]'); }
  catch(e){ return []; }
}
function saveLedgerEntries(entries){
  localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
}
