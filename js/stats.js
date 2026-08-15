let days = {};

document.addEventListener('DOMContentLoaded', () => {
    $('#headerDate').textContent = fmtDateLong(todayStr());
    init();
});

async function init() {
    try {
        days = await API.all();
    } catch (e) {
        showToast('Failed to load data: ' + e.message);
        return;
    }
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