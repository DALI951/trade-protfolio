let days = {};
let aliases = {};
let shareSource = 'merged';
let shareCharts = {};

document.addEventListener('DOMContentLoaded', () => {
    $('#headerDate').textContent = fmtDateLong(todayStr());
    requireLogin().then((user) => { if (user) init(); });
});

async function init() {
    try {
        days = await API.all();
    } catch (e) {
        showToast('Failed to load data: ' + e.message);
        return;
    }
    try {
        aliases = await API.names();
    } catch (e) { /* optional */ }
    const dates = Object.keys(days).sort();
    if (!dates.length) {
        $('#perfGrid').innerHTML = `<div class="empty" style="grid-column:1/-1">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18M7 15l4-6 4 3 5-8"/></svg>
            <div class="t">No data yet</div>
            <div class="s">Upload today's screenshots from the Calendar page first.</div>
        </div>`;
        return;
    }
    renderPerf(dates);
    renderValueChart(dates);
    renderChangeChart(dates);
    renderBreakdown(dates);
    initShares();
}

function stockNameOf(s) {
    let n = s.name || s.titre || '';
    const key = stockKey(n);
    return aliases[key] || n;
}

// name -> [{date, qty, value, plus_minus}] per the active source
function dayStocksList(day) {
    if (day.stocks && day.stocks.length) return day.stocks;
    if (day.positions && day.positions.length && day.holdings && day.holdings.length) {
        return applyAliases(mergeStocks(day.positions, day.holdings), aliases);
    }
    return day.stocks || null;
}

function stockSeries(source) {
    const series = {};
    for (const [date, day] of Object.entries(days)) {
        const list = source === 'A' ? day.positions
            : source === 'B' ? day.holdings
            : dayStocksList(day);
        for (const s of list || []) {
            const name = stockNameOf(s);
            const pt = {
                date,
                qty: s.qty != null ? s.qty : s.quantite,
                value: s.value != null ? s.value : s.montant,
                plus_minus: s.plus_minus != null ? s.plus_minus : null,
            };
            (series[name] = series[name] || []).push(pt);
        }
    }
    return series;
}

function initShares() {
    $('#srcSeg').addEventListener('click', (e) => {
        const btn = e.target.closest('.seg-btn');
        if (!btn) return;
        shareSource = btn.dataset.src;
        document.querySelectorAll('#srcSeg .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
        renderShares();
    });
    $('#shareSelect').addEventListener('change', () => renderShareChart());
    renderShares();
}

function renderShares() {
    const series = stockSeries(shareSource);
    const names = Object.keys(series).sort();
    const sel = $('#shareSelect');
    sel.innerHTML = names.map((n) => `<option value="${escAttr(n)}">${esc(n)}</option>`).join('');
    renderShareChart();
    renderCompareChart(series);
    renderRanking(series);
}

function renderShareChart() {
    const sel = $('#shareSelect');
    const name = sel.value || '';
    const pts = stockSeries(shareSource)[name] || [];
    const canvas = $('#shareChart');
    if (!canvas) return;
    if (shareCharts.share) shareCharts.share.destroy();
    const ctx = canvas.getContext('2d');
    const opts = chartBase();
    opts.plugins.legend = { display: true, labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } };
    opts.plugins.tooltip.callbacks = {
        label: (c) => `${c.dataset.label}: ${fmtNum(c.parsed.y)}`,
    };
    opts.scales.y.ticks.callback = (v) => fmtNum(v, 0);
    shareCharts.share = new Chart(ctx, {
        type: 'line',
        data: {
            labels: pts.map((p) => p.date),
            datasets: [{
                label: 'Value',
                data: pts.map((p) => p.value),
                borderColor: '#dc2626',
                backgroundColor: 'rgba(220, 38, 38, 0.12)',
                fill: true, tension: 0.35,
                pointRadius: 3.5, pointBackgroundColor: '#dc2626', borderWidth: 2,
            }, {
                label: 'Qty',
                data: pts.map((p) => p.qty),
                borderColor: '#9ca3af', borderDash: [5, 5],
                fill: false, tension: 0.35,
                pointRadius: 2.5, pointBackgroundColor: '#9ca3af', borderWidth: 1.5,
                yAxisID: 'y2',
            }],
        },
        options: Object.assign(opts, {
            scales: Object.assign(opts.scales, {
                y2: {
                    position: 'right',
                    grid: { display: false },
                    ticks: { color: '#5b6270', font: { size: 11 } },
                },
            }),
        }),
    });
}

function renderCompareChart(series) {
    const names = Object.keys(series).sort();
    const lastValues = names.map((n) => {
        const pts = series[n].filter((p) => p.value != null);
        return pts.length ? pts[pts.length - 1].value : null;
    });
    const canvas = $('#compareChart');
    if (!canvas) return;
    if (shareCharts.compare) shareCharts.compare.destroy();
    const ctx = canvas.getContext('2d');
    const opts = chartBase();
    opts.plugins.tooltip.callbacks = {
        label: (c) => `Value: ${fmtNum(c.parsed.y)} TND`,
    };
    opts.scales.y.ticks.callback = (v) => fmtNum(v, 0);
    opts.indexAxis = 'y';
    shareCharts.compare = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: names,
            datasets: [{
                label: 'Latest Value',
                data: lastValues,
                backgroundColor: names.map((n) => {
                    const pts = series[n].filter((p) => p.plus_minus != null);
                    const total = pts.reduce((s, p) => s + p.plus_minus, 0);
                    return total > 0 ? 'rgba(34,197,94,0.65)' : total < 0 ? 'rgba(239,68,68,0.65)' : 'rgba(220,38,38,0.65)';
                }),
                borderColor: '#1b1b26', borderWidth: 1, borderRadius: 4,
            }],
        },
        options: opts,
    });
}

function renderRanking(series) {
    const rows = Object.entries(series).map(([name, pts]) => {
        const values = pts.filter((p) => p.value != null);
        const pmPts = pts.filter((p) => p.plus_minus != null);
        const totalPm = pmPts.reduce((s, p) => s + p.plus_minus, 0);
        const latest = values.length ? values[values.length - 1].value : null;
        const avg = values.length ? values.reduce((s, p) => s + p.value, 0) / values.length : null;
        const best = pmPts.length ? pmPts.reduce((a, b) => (!a || b.plus_minus > a.plus_minus ? b : a), null) : null;
        return {
            name, days: pts.length, latest, avg, totalPm, hasPm: pmPts.length > 0,
            bestDay: best ? `${fmtNum(best.plus_minus)} (${best.date})` : '—',
        };
    }).sort((a, b) => b.totalPm - a.totalPm);

    $('#rankingCount').textContent = rows.length + ' share(s) · sorted by total +/-';
    $('#rankingList').innerHTML = `
        <div class="compare-row wide head">
            <div>Share</div><div class="num">Days</div><div class="num">Latest Value</div><div class="num">Avg Value</div><div class="num">Total +/-</div><div class="num">Best Day</div>
        </div>
        ${rows.map((r) => `
        <div class="compare-row wide">
            <div class="name">${esc(r.name)}</div>
            <div class="num">${r.days}</div>
            <div class="num">${r.latest != null ? fmtNum(r.latest) : '—'}</div>
            <div class="num">${r.avg != null ? fmtNum(r.avg) : '—'}</div>
            <div class="num ${r.totalPm > 0 ? 'pos' : r.totalPm < 0 ? 'neg' : ''}">${r.hasPm ? fmtNum(r.totalPm) : '—'}</div>
            <div class="num">${r.bestDay}</div>
        </div>`).join('')}`;
}

function changes(dates) {
    return dates.map((d) => {
        const prev = days[dates[dates.indexOf(d) - 1]];
        const cur = days[d];
        let change = null;
        if (prev && cur.valorisation != null && prev.valorisation != null) {
            change = Math.round((cur.valorisation - prev.valorisation) * 1000) / 1000;
        }
        return { date: d, day: cur, change };
    });
}

function renderPerf(dates) {
    const chgs = changes(dates).filter((c) => c.change !== null);
    const last = days[dates[dates.length - 1]];
    const first = days[dates[0]];

    const upDays = chgs.filter((c) => c.change > 0).length;
    const downDays = chgs.filter((c) => c.change < 0).length;
    const totalChange = chgs.reduce((s, c) => s + c.change, 0);
    const best = chgs.reduce((a, b) => (!a || b.change > a.change ? b : a), null);
    const worst = chgs.reduce((a, b) => (!a || b.change < a.change ? b : a), null);
    const avg = chgs.length ? totalChange / chgs.length : null;

    const winRate = chgs.length ? Math.round((upDays / chgs.length) * 100) : null;

    const cards = [
        { label: 'Days Recorded', value: dates.length, plain: true },
        { label: 'Current Valorisation', value: last.valorisation != null ? fmtNum(last.valorisation) + ' TND' : '—', plain: true },
        { label: 'Total Change', value: fmtMoney(totalChange), cls: totalChange > 0 ? 'pos' : totalChange < 0 ? 'neg' : '', plain: true },
        { label: 'Win Rate', value: winRate !== null ? winRate + '%' : '—', plain: true },
        { label: 'Up Days', value: upDays, cls: 'pos', plain: true },
        { label: 'Down Days', value: downDays, cls: 'neg', plain: true },
        { label: 'Best Day', value: best ? `${fmtNum(best.change)} (${best.date})` : '—', cls: 'pos', plain: true },
        { label: 'Worst Day', value: worst ? `${fmtNum(worst.change)} (${worst.date})` : '—', cls: 'neg', plain: true },
        { label: 'Avg Daily Change', value: avg !== null ? fmtMoney(avg) : '—', plain: true },
    ];

    $('#perfGrid').innerHTML = cards.map((c) => `
        <div class="stat-card">
            <div class="stat-label">${c.label}</div>
            <div class="stat-value ${c.cls || ''}" ${c.plain ? '' : ''}>${c.value}</div>
        </div>`).join('');
}

function chartBase() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#1b1b26', borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
                titleColor: '#e8e8ef', bodyColor: '#9ca3af', padding: 12, cornerRadius: 8,
                displayColors: false,
            },
        },
        scales: {
            x: {
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { color: '#5b6270', font: { size: 11 } },
            },
            y: {
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { color: '#5b6270', font: { size: 11 } },
            },
        },
    };
}

function renderValueChart(dates) {
    const ctx = $('#valueChart').getContext('2d');
    const opts = chartBase();
    opts.plugins.tooltip.callbacks = {
        label: (c) => `Valorisation: ${fmtNum(c.parsed.y)} TND`,
    };
    opts.scales.y.ticks.callback = (v) => fmtNum(v, 0);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: 'Valorisation',
                data: dates.map((d) => days[d].valorisation ?? null),
                borderColor: '#dc2626',
                backgroundColor: 'rgba(220, 38, 38, 0.12)',
                fill: true, tension: 0.35,
                pointRadius: 3.5, pointBackgroundColor: '#dc2626',
                borderWidth: 2,
            }, {
                label: 'Total Général',
                data: dates.map((d) => days[d].total_general ?? null),
                borderColor: '#9ca3af',
                borderDash: [5, 5],
                fill: false, tension: 0.35,
                pointRadius: 2.5, pointBackgroundColor: '#9ca3af',
                borderWidth: 1.5,
            }],
        },
        options: opts,
    });
}

function renderChangeChart(dates) {
    const ctx = $('#changeChart').getContext('2d');
    const chgs = changes(dates);
    const opts = chartBase();
    opts.plugins.tooltip.callbacks = {
        label: (c) => `Change: ${fmtMoney(c.parsed.y)}`,
    };

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chgs.map((c) => c.date),
            datasets: [{
                label: 'Daily Change',
                data: chgs.map((c) => c.change),
                backgroundColor: chgs.map((c) => c.change === null ? '#2a2a36' : c.change >= 0 ? 'rgba(34,197,94,0.65)' : 'rgba(239,68,68,0.65)'),
                borderColor: chgs.map((c) => c.change === null ? '#2a2a36' : c.change >= 0 ? '#22c55e' : '#ef4444'),
                borderWidth: 1, borderRadius: 4,
            }],
        },
        options: opts,
    });
}

function renderBreakdown(dates) {
    const chgs = changes(dates);
    $('#breakdownCount').textContent = dates.length + ' day(s)';
    const rows = chgs.slice().reverse().map((c) => {
        const d = days[c.date];
        let cls = 'flat', label = '—';
        if (c.change !== null) {
            cls = c.change > 0 ? 'pos' : c.change < 0 ? 'neg' : 'flat';
            label = fmtMoney(c.change);
        }
        return `<div class="compare-row">
            <div class="name">${c.date}</div>
            <div class="num">${fmtNum(d.valorisation)}</div>
            <div class="num">${fmtNum(d.total_general)}</div>
            <div class="num ${cls}">${label}</div>
        </div>`;
    }).join('');
    $('#breakdownList').innerHTML = `
        <div class="compare-row head"><div>Date</div><div class="num">Valorisation</div><div class="num">Total Général</div><div class="num">Change</div></div>
        ${rows}`;
}