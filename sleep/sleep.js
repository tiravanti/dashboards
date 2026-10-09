/* Sleep & Rest dashboard — renders live data from the Apps Script API.
 * Conventions kept from the original artifact:
 *   - "logged" hours = ASLEEP hours (never time-in-bed)
 *   - a night is keyed by its evening date (a 02:49 bedtime belongs to the previous date)
 *   - hero stats / table / cumulative use a rolling 7-night window; the week chart uses Mon–Sun calendar weeks
 *   - nights with no log are skipped in trends, never counted as 0
 */
(function () {
  'use strict';
  var cfg = window.PORTAL_CONFIG || {};
  var DEMO = location.hash === '#demo';
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var $ = function (id) { return document.getElementById(id); };

  // ───────── small helpers ─────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function parseYmd(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function toYmd(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = parseYmd(s); d.setUTCDate(d.getUTCDate() + n); return toYmd(d); }
  function dayLabel(s) { var d = parseYmd(s); return DOW[d.getUTCDay()] + ' ' + d.getUTCDate(); }
  function mondayOf(s) { return addDays(s, -((parseYmd(s).getUTCDay() + 6) % 7)); }
  function diffDays(a, b) { return Math.round((parseYmd(a) - parseYmd(b)) / 86400000); }
  function bedMinutes(hhmm) { var p = hhmm.split(':'); var m = +p[0] * 60 + +p[1]; return +p[0] < 12 ? m + 1440 : m; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hFmt(h) { var hh = Math.floor(h), mm = Math.round((h - hh) * 60); if (mm === 60) { hh += 1; mm = 0; } return hh + 'h' + pad2(mm); }
  function fmtDelta(h) {
    var sign = h > 0.0084 ? '+' : (h < -0.0084 ? '−' : '');
    return sign + hFmt(Math.abs(h));
  }
  function fmtPct(h, base) {
    if (!base) return '';
    var pct = (h / base) * 100, sign = pct > 0.5 ? '+' : (pct < -0.5 ? '−' : '');
    return sign + Math.round(Math.abs(pct)) + '%';
  }
  function deltaClass(h) { return h > 0.0084 ? 'pos' : (h < -0.0084 ? 'neg' : 'flat'); }
  function scoreClass(s) { return s >= 75 ? 'good' : (s >= 55 ? 'warn' : 'bad'); }
  function minLabel(m) { return m < 60 ? m + 'min' : Math.floor(m / 60) + 'h' + pad2(m % 60); }
  function arrow(cls) { return cls === 'neg' ? '▼ ' : (cls === 'pos' ? '▲ ' : ''); }

  function slipFlag(n) {
    if (!n || !n.plannedStart || !n.loggedStart) return null;
    var diff = bedMinutes(n.loggedStart) - bedMinutes(n.plannedStart);
    return diff >= 15 ? 'Bedtime slipped ~' + minLabel(diff) + ' past the ' + n.plannedStart + ' plan' : null;
  }

  // ───────── state ─────────
  var state = { data: null, weekOffset: 0, M: null, lastLoad: 0, loading: false };

  // ───────── data → model ─────────
  function buildModel(data) {
    var by = {};
    data.nights.forEach(function (n) { by[n.date] = n; });
    var logged = data.nights.filter(function (n) { return n.asleepHours != null && n.date <= data.today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var last = logged.length ? logged[logged.length - 1] : null;

    var win = [];                                   // rolling 7 nights ending at the last logged night
    if (last) for (var i = 6; i >= 0; i--) {
      var d = addDays(last.date, -i), n = by[d] || null;
      win.push({ date: d, label: dayLabel(d), n: n,
        planned: n && n.plannedHours != null ? n.plannedHours : null,
        logged: n && n.asleepHours != null ? n.asleepHours : null });
    }
    win.forEach(function (w) { w.delta = (w.planned != null && w.logged != null) ? w.logged - w.planned : null; });

    var firstDate = data.nights.length ? data.nights[0].date : data.today;
    var minOff = Math.max(-4, Math.floor(diffDays(mondayOf(firstDate), mondayOf(data.today)) / 7));
    return { by: by, logged: logged, last: last, win: win, minOff: Math.min(minOff, 0), maxOff: 1, floor: data.sleepFloorHours || 6.5 };
  }

  function weekData(M, today, offset) {
    var mon = addDays(mondayOf(today), offset * 7), days = [], planned = [], logged = [];
    for (var i = 0; i < 7; i++) {
      var d = addDays(mon, i), n = M.by[d];
      days.push(dayLabel(d));
      planned.push(n && n.plannedHours != null ? n.plannedHours : null);
      logged.push(n && n.asleepHours != null ? n.asleepHours : null);
    }
    var sun = addDays(mon, 6), a = parseYmd(mon), b = parseYmd(sun);
    var label = DOW[a.getUTCDay()] + ' ' + a.getUTCDate() + (a.getUTCMonth() !== b.getUTCMonth() ? ' ' + MON[a.getUTCMonth()] : '') +
      ' – ' + DOW[b.getUTCDay()] + ' ' + b.getUTCDate() + ' ' + MON[b.getUTCMonth()];
    return { days: days, planned: planned, logged: logged, label: label };
  }

  // ───────── render: hero ─────────
  function renderLastNight(M) {
    var n = M.last, el = $('lastNightCard');
    if (!n) { el.innerHTML = '<h2>Last night · logged</h2><div class="empty">No logged nights in this window yet.</div>'; return; }
    var star = n.asleepFromDuration ? '<abbr title="No Polar data in the event — time in bed used">*</abbr>' : '';
    var plannedH = n.plannedHours, h = '<h2>Last night · logged <span style="text-transform:none;letter-spacing:0;font-weight:500">· ' + esc(dayLabel(n.date)) + '</span></h2>';
    h += '<div class="last-night-top"><div><div class="big-stat">' + hFmt(n.inBedHours) + '<small>in bed</small></div>' +
      '<div class="range-row">' + esc(n.loggedStart) + ' <span class="dot"></span> ' + esc(n.loggedEnd) + ' <span class="dot"></span> asleep ~' + hFmt(n.asleepHours) + star + '</div></div>';
    if (n.score != null) h += '<span class="score-pill ' + scoreClass(n.score) + '">' + n.score + ' / 100</span>';
    h += '</div>';
    if (plannedH != null) {
      var d = n.asleepHours - plannedH, cls = deltaClass(d);
      h += '<div class="delta-row"><span class="vs">vs planned ' + hFmt(plannedH) + '</span><span class="delta-pill ' + cls + '">' + arrow(cls) + fmtDelta(d) +
        '<span class="delta-pct">(' + fmtPct(d, plannedH) + ')</span></span></div>';
    }
    var s = n.stages;
    if (s && n.inBedHours) {
      var pc = function (v) { return (Math.max(0, v) / n.inBedHours * 100).toFixed(1) + '%'; };
      h += '<div class="stage-bar"><div class="light" style="width:' + pc(s.lightHours) + '"></div><div class="deep" style="width:' + pc(s.deepHours) +
        '"></div><div class="rem" style="width:' + pc(s.remHours) + '"></div><div class="awake" style="width:' + pc(s.interruptionsHours) + '"></div></div>' +
        '<div class="stage-legend"><span><i class="swatch-light"></i>Light ' + hFmt(s.lightHours) + '</span><span><i class="swatch-deep"></i>Deep ' + hFmt(s.deepHours) +
        '</span><span><i class="swatch-rem"></i>REM ' + hFmt(s.remHours) + '</span><span><i class="swatch-awake"></i>Interruptions ' + hFmt(s.interruptionsHours) + '</span></div>';
    }
    var flags = [], slip = slipFlag(n);
    if (slip) flags.push('<span class="flag shortfall">' + esc(slip) + '</span>');
    if (n.quality) flags.push('<span class="flag">' + esc(n.quality) + '</span>');
    if (n.note) flags.push('<span class="flag">' + esc(n.note) + '</span>');
    if (flags.length) h += '<div class="context-flags">' + flags.join('') + '</div>';
    el.innerHTML = h;
  }

  function renderTonight(M, data) {
    var el = $('tonightCard'), n = M.by[data.today];
    var h = '<h2>Tonight · planned</h2>';
    if (!n || n.plannedHours == null) { el.innerHTML = h + '<div class="empty">Nothing planned for tonight yet.</div>'; return; }
    var rows = [];
    if (n.windDownStart) rows.push(['🌙', n.windDownStart, 'Wind-down']);
    rows.push(['😴', n.plannedStart, 'Sleep begins']);
    rows.push(['⏰', n.plannedEnd, 'Wake' + (n.plannedEnd === data.wakeAnchor ? ' (anchor)' : '')]);
    h += '<div class="plan-rows">' + rows.map(function (r, i) {
      return (i ? '<div class="plan-divider"></div>' : '') + '<div class="plan-row"><div class="icon">' + r[0] + '</div><div class="time">' + esc(r[1]) + '</div><div class="label">' + esc(r[2]) + '</div></div>';
    }).join('') + '</div>';
    var vs = n.plannedHours - M.floor;
    h += '<div class="plan-foot"><span>Target <b>' + hFmt(n.plannedHours) + '</b></span><span>vs floor <b>' + fmtDelta(vs) + '</b></span></div>';
    if (n.plannedNote) {
      var shortNote = n.plannedNote.length > 150 ? n.plannedNote.slice(0, 150).replace(/\s+\S*$/, '') + '…' : n.plannedNote;
      h += '<div class="plan-note" title="' + esc(n.plannedNote) + '">' + esc(shortNote) + '</div>';
    }
    if (data.nsdr) {
      var today = data.nsdr.filter(function (x) { return x.date === data.today; })[0];
      var next = data.nsdr.filter(function (x) { return x.date > data.today; })[0];
      if (today) h += '<div class="nsdr-note">💡 NSDR scheduled today at ' + esc(today.start) + '.</div>';
      else if (next) h += '<div class="nsdr-note">💡 No NSDR scheduled tonight — next one: ' + esc(dayLabel(next.date)) + ', ' + esc(next.start) + '.</div>';
    }
    el.innerHTML = h;
  }

  function summarize(M) {
    var rows = M.win.filter(function (w) { return w.delta != null; });
    if (!rows.length) return null;
    var sp = rows.reduce(function (a, w) { return a + w.planned; }, 0), sl = rows.reduce(function (a, w) { return a + w.logged; }, 0);
    return { n: rows.length, sp: sp, sl: sl, sd: sl - sp };
  }

  function renderAvg(M) {
    var S = summarize(M), el = $('avgCard');
    var h = '<h2>Daily average (last 7 nights)</h2>';
    if (!S) { el.innerHTML = h + '<div class="empty">No night with both a plan and a log yet.</div>'; return; }
    var avgD = S.sd / S.n, cls = deltaClass(avgD);
    h += '<div class="avg-pair"><div class="avg-item"><div class="avg-label">Planned</div><div class="avg-value">' + hFmt(S.sp / S.n) + '</div></div>' +
      '<div class="avg-sep">vs</div><div class="avg-item"><div class="avg-label">Logged</div><div class="avg-value">' + hFmt(S.sl / S.n) + '</div></div></div>' +
      '<div class="delta-row" style="margin-top:16px"><span class="vs">Δ per night</span><span class="delta-pill ' + cls + '">' + arrow(cls) + fmtDelta(avgD) +
      '<span class="delta-pct">(' + fmtPct(S.sd, S.sp) + ')</span></span></div>' +
      '<div class="avg-foot">' + S.n + ' of the last 7 nights have both a plan and a log to compare</div>';
    el.innerHTML = h;
  }

  // ───────── render: week / cumulative / trends / table ─────────
  function renderWeek() {
    var M = state.M, off = state.weekOffset, wk = weekData(M, state.data.today, off);
    $('weekRangeLabel').textContent = wk.label;
    $('weekSectionTitle').textContent = off === 0 ? 'This week' : (off === -1 ? 'Last week' : (off === 1 ? 'Next week' : 'Week of ' + wk.days[0]));
    $('weekPrevBtn').disabled = off <= M.minOff;
    $('weekNextBtn').disabled = off >= M.maxOff;
    $('weekCurrentBtn').classList.toggle('week-nav-current', off === 0);
    var has = wk.planned.concat(wk.logged).some(function (v) { return v != null; });
    var chart = $('weekChart');
    if (!has) chart.innerHTML = '<div class="empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">No data for this week yet</div>';
    else drawBarChart('weekChart', wk.days, wk.planned, wk.logged, { floor: M.floor });
    var strip = $('weekDeltaStrip'); strip.innerHTML = '';
    wk.days.forEach(function (day, i) {
      var p = wk.planned[i], l = wk.logged[i], ok = p != null && l != null, d = ok ? l - p : 0, cls = ok ? deltaClass(d) : 'flat';
      var it = document.createElement('div'); it.className = 'wd-item ' + cls;
      it.innerHTML = '<div class="wd-day">' + esc(day.split(' ')[0]) + '</div><div class="wd-val">' + (ok ? fmtDelta(d) : '—') + '</div><div class="wd-pct">' + (ok ? fmtPct(d, p) : '') + '</div>';
      strip.appendChild(it);
    });
  }

  function renderCumulative(M) {
    var labels = [], cp = [], cl = [], rp = 0, rl = 0, lastLbl = '';
    M.win.forEach(function (w) {
      if (w.planned == null || w.logged == null) return;
      rp += w.planned; rl += w.logged; labels.push(w.label.split(' ')[0]); cp.push(rp); cl.push(rl); lastLbl = w.label;
    });
    var stats = $('cumulativeStats'), chart = $('cumulativeChart');
    $('cumulativeRange').textContent = M.win.length ? M.win[0].label + ' – ' + (lastLbl || M.win[M.win.length - 1].label) : '';
    if (!labels.length) { stats.innerHTML = '<div class="empty">No nights with both a plan and a log in the last 7 nights.</div>'; chart.innerHTML = ''; return; }
    var d = rl - rp, cls = deltaClass(d);
    stats.innerHTML = '<div class="stat"><div class="stat-label">Planned</div><div class="stat-value">' + hFmt(rp) + '</div></div>' +
      '<div class="stat"><div class="stat-label">Logged</div><div class="stat-value">' + hFmt(rl) + '</div></div>' +
      '<div class="stat"><div class="stat-label">Δ cumulative</div><div class="stat-value ' + (cls === 'flat' ? '' : cls) + '">' + fmtDelta(d) + ' <span class="delta-pct">(' + fmtPct(d, rp) + ')</span></div></div>';
    drawLineChart('cumulativeChart', labels, [
      { data: cp, color: cssVar('--text-faint'), dashed: true, pointR: 3 },
      { data: cl, color: cssVar('--bad'), pointR: 3 }
    ], { fillBetween: true, yFmt: function (v) { return v.toFixed(0) + 'h'; } });
  }

  function renderTrends(M) {
    // 7-night moving average over every logged night in the fetched window
    var labels = [], avgs = [];
    M.logged.forEach(function (n, i) {
      var sl = M.logged.slice(Math.max(0, i - 6), i + 1);
      labels.push(String(parseYmd(n.date).getUTCDate()));
      avgs.push(sl.reduce(function (a, x) { return a + x.asleepHours; }, 0) / sl.length);
    });
    if (avgs.length) {
      drawLineChart('movingAvgChart', labels, [
        { data: avgs, color: cssVar('--accent'), pointR: 3 },
        { data: avgs.map(function () { return M.floor; }), color: cssVar('--warn'), dashed: true, pointR: 0 }
      ], { yFmt: function (v) { return v.toFixed(1) + 'h'; }, padL: 28 });
    } else $('movingAvgChart').innerHTML = '';
    $('movingAvgRange').textContent = labels.length ? dayLabel(M.logged[0].date) + ' – ' + dayLabel(M.logged[M.logged.length - 1].date) : '';

    var scored = M.logged.filter(function (n) { return n.score != null; }).slice(-14);
    var sl = scored.map(function (n) { return String(parseYmd(n.date).getUTCDate()); });
    if (scored.length) {
      drawLineChart('scoreChart', sl, [{ data: scored.map(function (n) { return n.score; }), color: cssVar('--accent'), area: true, pointR: 2.5 }], { min: 40, max: 100, padL: 24 });
    } else $('scoreChart').innerHTML = '';
    var bed = scored.filter(function (n) { return n.loggedStart; });
    if (bed.length) {
      var vals = bed.map(function (n) { return bedMinutes(n.loggedStart); });
      var lo = Math.floor((Math.min.apply(null, vals) - 20) / 60) * 60, hi = Math.ceil((Math.max.apply(null, vals) + 20) / 60) * 60;
      drawScatterChart('bedtimeChart', bed.map(function (n) { return String(parseYmd(n.date).getUTCDate()); }), vals, { min: lo, max: hi });
    } else $('bedtimeChart').innerHTML = '';
  }

  function renderTable(M) {
    var body = $('logBody'), foot = $('logFoot'), rows = M.win.slice().reverse().filter(function (w) { return w.n && (w.logged != null); });
    body.innerHTML = rows.map(function (w) {
      var n = w.n;
      var d = w.delta, dc = d == null ? '' : deltaClass(d);
      var ctx = n.note || slipFlag(n) || n.quality || '';
      return '<tr><td class="date-cell">' + esc(w.label + ' → ' + dayLabel(addDays(w.date, 1))) + '</td>' +
        '<td>' + esc(n.loggedStart) + '–' + esc(n.loggedEnd) + '</td>' +
        '<td>' + hFmt(n.asleepHours) + (n.asleepFromDuration ? '<abbr title="No Polar data in the event — time in bed used">*</abbr>' : '') + '</td>' +
        '<td class="score-cell">' + (n.score != null ? '<span class="mini-dot ' + scoreClass(n.score) + '"></span>' + n.score : '—') + '</td>' +
        '<td class="delta-cell ' + dc + '">' + (d == null ? '—' : fmtDelta(d) + ' (' + fmtPct(d, w.planned) + ')') + '</td>' +
        '<td class="note-cell">' + esc(ctx) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="empty">No logged nights in the last 7.</td></tr>';
    var S = summarize(M);
    if (!S) { foot.innerHTML = ''; return; }
    var cls = deltaClass(S.sd);
    foot.innerHTML = '<tr><td class="date-cell">' + S.n + ' nights, total / avg</td><td>—</td><td>' + hFmt(S.sl) + '<span class="log-summary-sub">avg ' + hFmt(S.sl / S.n) + '</span></td><td>—</td>' +
      '<td class="delta-cell ' + cls + '">' + fmtDelta(S.sd) + ' (' + fmtPct(S.sd, S.sp) + ')</td>' +
      '<td class="note-cell">Planned total ' + hFmt(S.sp) + '<span class="log-summary-sub">avg ' + hFmt(S.sp / S.n) + '</span></td></tr>';
  }

  // ───────── hand-drawn SVG charts (no external library) ─────────
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function txt(svg, x, y, anchor, size, str) { var t = svgEl('text', { x: x, y: y, 'text-anchor': anchor, 'font-size': size, fill: cssVar('--text-faint') }); t.textContent = str; svg.appendChild(t); }

  function drawBarChart(id, labels, A, B, opts) {
    var el = $(id); if (!el) return;
    var W = el.clientWidth || 600, H = el.clientHeight || 220, padL = 34, padR = 10, padT = 10, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var vals = [].concat(A, B, [opts.floor]).filter(function (v) { return v != null; });
    var max = Math.max.apply(null, vals) * 1.15, groupW = plotW / labels.length, barW = Math.min(18, groupW * 0.32);
    function y(v) { return padT + plotH - (v / max) * plotH; }
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: '100%', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Planned vs logged sleep per night' });
    for (var g = 0; g <= 4; g++) {
      var gy = y(max * g / 4);
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: cssVar('--border'), 'stroke-width': 1 }));
      txt(svg, padL - 6, gy + 3, 'end', 10, (max * g / 4).toFixed(0) + 'h');
    }
    if (opts.floor != null) svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(opts.floor), y2: y(opts.floor), stroke: cssVar('--warn'), 'stroke-width': 1.5, 'stroke-dasharray': '4,4' }));
    labels.forEach(function (label, i) {
      var cx = padL + groupW * i + groupW / 2;
      if (A[i] != null) svg.appendChild(svgEl('rect', { x: cx - barW - 2, y: y(A[i]), width: barW, height: Math.max(0, y(0) - y(A[i])), rx: 3, fill: cssVar('--accent-soft') }));
      if (B[i] != null) svg.appendChild(svgEl('rect', { x: cx + 2, y: y(B[i]), width: barW, height: Math.max(0, y(0) - y(B[i])), rx: 3, fill: cssVar('--accent') }));
      txt(svg, cx, H - 8, 'middle', 10.5, label);
    });
    el.innerHTML = ''; el.appendChild(svg);
  }

  function drawLineChart(id, labels, series, opts) {
    var el = $(id); if (!el) return; opts = opts || {};
    var W = el.clientWidth || 600, H = el.clientHeight || 190, padL = opts.padL != null ? opts.padL : 30, padR = 10, padT = 12, padB = 22;
    var plotW = W - padL - padR, plotH = H - padT - padB, all = [];
    series.forEach(function (s) { s.data.forEach(function (v) { if (v != null) all.push(v); }); });
    var min = opts.min != null ? opts.min : Math.min.apply(null, all), max = opts.max != null ? opts.max : Math.max.apply(null, all);
    if (min === max) { min -= 1; max += 1; }
    if (opts.min == null) { var padV = (max - min) * 0.08; min -= padV; max += padV; }
    var n = labels.length;
    function x(i) { return n <= 1 ? padL + plotW / 2 : padL + plotW * i / (n - 1); }
    function y(v) { return padT + plotH - ((v - min) / (max - min)) * plotH; }
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: '100%', preserveAspectRatio: 'none', role: 'img' });
    var grid = opts.gridCount || 4;
    for (var g = 0; g <= grid; g++) {
      var gv = min + (max - min) * g / grid, gy = y(gv);
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: cssVar('--border'), 'stroke-width': 1 }));
      if (opts.yFmt) txt(svg, padL - 6, gy + 3, 'end', 10, opts.yFmt(gv));
      else if (opts.min != null) txt(svg, padL - 6, gy + 3, 'end', 10, String(Math.round(gv)));
    }
    function pathFor(data) {
      var pts = []; data.forEach(function (v, i) { if (v != null) pts.push([x(i), y(v)]); });
      if (!pts.length) return null;
      var d = 'M' + pts[0][0] + ',' + pts[0][1]; for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ',' + pts[i][1];
      return { d: d, pts: pts };
    }
    if (opts.fillBetween && series.length === 2) {
      var pa = pathFor(series[0].data), pb = pathFor(series[1].data);
      if (pa && pb) {
        var ad = pa.d; for (var i = pb.pts.length - 1; i >= 0; i--) ad += ' L' + pb.pts[i][0] + ',' + pb.pts[i][1];
        svg.appendChild(svgEl('path', { d: ad + ' Z', fill: cssVar('--bad-soft'), opacity: 0.7, stroke: 'none' }));
      }
    }
    series.forEach(function (s) {
      var p = pathFor(s.data); if (!p) return;
      var a = { d: p.d, fill: 'none', stroke: s.color, 'stroke-width': 2 }; if (s.dashed) a['stroke-dasharray'] = '4,3';
      svg.appendChild(svgEl('path', a));
      if (s.area) svg.appendChild(svgEl('path', { d: p.d + ' L' + p.pts[p.pts.length - 1][0] + ',' + y(min) + ' L' + p.pts[0][0] + ',' + y(min) + ' Z', fill: s.color, opacity: 0.12, stroke: 'none' }));
      if (s.pointR !== 0) p.pts.forEach(function (pt) { svg.appendChild(svgEl('circle', { cx: pt[0], cy: pt[1], r: s.pointR || 3, fill: s.color })); });
    });
    var step = Math.ceil(n / 14);                       // thin the x labels on long series
    labels.forEach(function (l, i) { if (i % step === 0 || i === n - 1) txt(svg, x(i), H - 6, 'middle', 10, l); });
    el.innerHTML = ''; el.appendChild(svg);
  }

  function drawScatterChart(id, labels, values, opts) {
    var el = $(id); if (!el) return;
    var W = el.clientWidth || 600, H = el.clientHeight || 160, padL = 42, padR = 10, padT = 12, padB = 22;
    var plotW = W - padL - padR, plotH = H - padT - padB, min = opts.min, max = opts.max, n = labels.length;
    function x(i) { return n <= 1 ? padL + plotW / 2 : padL + plotW * i / (n - 1); }
    function y(v) { return padT + plotH - ((v - min) / (max - min)) * plotH; }
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: '100%', preserveAspectRatio: 'none', role: 'img' });
    for (var g = 0; g <= 4; g++) {
      var gv = min + (max - min) * g / 4, gy = y(gv), m = ((gv % 1440) + 1440) % 1440;
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: cssVar('--border'), 'stroke-width': 1 }));
      txt(svg, padL - 6, gy + 3, 'end', 10, pad2(Math.floor(m / 60)) + ':' + pad2(Math.round(m % 60)));
    }
    values.forEach(function (v, i) { svg.appendChild(svgEl('circle', { cx: x(i), cy: y(v), r: 4, fill: cssVar('--accent') })); });
    labels.forEach(function (l, i) { txt(svg, x(i), H - 6, 'middle', 10, l); });
    el.innerHTML = ''; el.appendChild(svg);
  }

  // ───────── orchestration ─────────
  function render() {
    var data = state.data; if (!data) return;
    var M = state.M = buildModel(data);
    state.weekOffset = Math.min(Math.max(state.weekOffset, M.minOff), M.maxOff);
    $('floorLabel').textContent = hFmt(M.floor);
    $('subLine').textContent = 'Floor ' + hFmt(M.floor) + ' · Wake anchor ' + (data.wakeAnchor || '—') + ' · ' + (data.timeZone || 'Europe/Rome');
    $('todayTag').textContent = parseYmd(data.today).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('loading').hidden = true; $('dash').hidden = false;
    renderLastNight(M); renderTonight(M, data); renderAvg(M);
    renderWeek(); renderCumulative(M); renderTrends(M); renderTable(M);
    var when = new Date(data.generatedAt);
    $('footStamp').textContent = (DEMO ? 'DEMO — synthetic data, not real · ' : 'Live from Google Calendar · ') + 'updated ' +
      when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: data.timeZone || 'Europe/Rome' });
  }

  function banner(msg, isErr) { var b = $('banner'); b.hidden = !msg; b.textContent = msg || ''; b.className = 'banner' + (isErr ? ' err' : ''); }

  function callApi(token) {
    return fetch(cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify({ idToken: token, daysBack: 35 }) }).then(function (r) { return r.json(); });
  }

  function load(retry) {
    if (state.loading) return; state.loading = true; $('refreshBtn').disabled = true;
    var p = DEMO ? Promise.resolve(window.SLEEP_DEMO()) : Portal.token().then(callApi);
    p.then(function (res) {
      if (res && res.ok) { state.data = res; state.lastLoad = Date.now(); banner(DEMO ? 'Demo mode: synthetic data, no sign-in.' : ''); render(); return; }
      var err = res && res.error;
      if (err === 'token_expired' && !retry) { Portal.rejected(''); state.loading = false; Portal.token().then(function () { load(true); }).catch(function () {}); return; }
      if (err === 'unauthorized') { Portal.rejected('This Google account is not authorised for this dashboard.'); return; }
      banner('The API returned an error (' + (err || 'unknown') + '). Showing the last data, if any.', true);
      if (!state.data) $('loading').textContent = 'Could not load data.';
    }).catch(function (e) {
      if (e && e.message === 'signin_required') { Portal.rejected('Please sign in again.'); return; }
      banner('Could not reach the API — check your connection or the Apps Script deployment.', true);
      if (!state.data) $('loading').textContent = 'Could not load data.';
    }).then(function () { state.loading = false; $('refreshBtn').disabled = false; });
  }

  // ───────── wiring ─────────
  $('weekPrevBtn').addEventListener('click', function () { if (state.M && state.weekOffset > state.M.minOff) { state.weekOffset--; renderWeek(); } });
  $('weekNextBtn').addEventListener('click', function () { if (state.M && state.weekOffset < state.M.maxOff) { state.weekOffset++; renderWeek(); } });
  $('weekCurrentBtn').addEventListener('click', function () { state.weekOffset = 0; renderWeek(); });
  $('refreshBtn').addEventListener('click', function () { load(); });
  $('signOut').addEventListener('click', function () { state.data = null; $('dash').hidden = true; if (DEMO) { location.hash = ''; location.reload(); } else Portal.signOut(); });

  var resizeT; window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if (state.data) { renderWeek(); renderCumulative(state.M); renderTrends(state.M); } }, 150); });
  setInterval(function () { if (document.visibilityState === 'visible' && state.data && Date.now() - state.lastLoad > (cfg.REFRESH_MINUTES || 5) * 60000) load(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && state.data && Date.now() - state.lastLoad > 60000) load(); });

  function showApp(p) { $('gate').hidden = true; $('app').hidden = false; $('who').textContent = p && p.email ? p.email : (DEMO ? 'demo' : ''); }

  if (DEMO) { showApp(null); load(); }
  else Portal.init({
    signedIn: function (t, p) { showApp(p); load(); },
    signedOut: function () { $('app').hidden = true; $('gate').hidden = false; state.data = null; }
  });
})();
