const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOWS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

let days = {};           // date -> day object
let aliases = {};        // normalized OCR name -> canonical name
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedFiles = [];
let ocrResult = null;    // last parsed OCR data

document.addEventListener('DOMContentLoaded', () => {
    $('#headerDate').textContent = fmtDateLong(todayStr());
    $('#dateInput').value = todayStr();
    requireLogin().then((user) => { if (user) loadData(); });
});

async function loadData() {
    try {
        days = await API.all();
    } catch (e) {
        days = {};
        showToast('Failed to load data: ' + e.message);
    }
    try {
        aliases = await API.names();
    } catch (e) { /* aliases optional */ }
    renderCalendar();
    showLatestSummary();
}

// ---------------- Upload ----------------
const dz = $('#dropzone');
const fileInput = $('#fileInput');

dz.addEventListener('click', () => fileInput.click());
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    setFiles([...e.dataTransfer.files]);
});
fileInput.addEventListener('change', (e) => setFiles([...e.target.files]));

function setFiles(files) {
    selectedFiles = files.filter((f) => f.type.startsWith('image/'));
    const btn = $('#processBtn');
    if (selectedFiles.length) {
        $('#dzTitle').textContent = selectedFiles.length + ' file(s) ready';
        $('#dzSub').textContent = selectedFiles.map((f) => f.name).join(' · ');
        dz.classList.add('files');
        btn.disabled = false;
        $('#clearBtn').hidden = false;
        $('#status').textContent = '';
        $('#status').className = 'status';
    } else {
        $('#dzTitle').textContent = 'Drop both screenshots here or click to browse';
        $('#dzSub').textContent = 'Positions view + Portfolio summary — processed in your browser';
        dz.classList.remove('files');
        btn.disabled = true;
        $('#clearBtn').hidden = true;
    }
}

$('#clearBtn').addEventListener('click', () => {
    fileInput.value = '';
    setFiles([]);
});

$('#processBtn').addEventListener('click', async () => {
    const btn = $('#processBtn');
    btn.disabled = true;
    const status = $('#status');
    status.className = 'status';
    status.innerHTML = '<span class="spinner"></span>Running OCR in your browser...';

    try {
        let positions = null, portfolio = null;
        let i = 0;
        for (const f of selectedFiles) {
            status.innerHTML = `<span class="spinner"></span>Analyzing screenshot ${++i}/${selectedFiles.length}...`;
            const parsed = await ocrImage(f);
            if (parsed.type === 'positions') positions = parsed;
            else if (parsed.type === 'portfolio') portfolio = parsed;
            else {
                status.className = 'status err';
                const snippet = (parsed.text || '').replace(/\s+/g, ' ').slice(0, 120);
                status.textContent = `Screenshot ${i} not recognized. OCR read: "${snippet}". Try the other screenshot (positions + portfolio are both needed).`;
                return;
            }
        }
        if (!positions && !portfolio) {
            status.className = 'status err';
            status.textContent = 'Could not extract numbers from these screenshots.';
            return;
        }

        const date = $('#dateInput').value;
        const day = mergeDay(positions, portfolio, days[date] || {});
        const res = await API.save(date, day);
        if (res.ok) {
            days[date] = day;
            status.className = 'status ok';
            status.textContent = `Saved ${date} — Valorisation ${fmtMoney(day.valorisation)}`;
            showToast('Day saved');
            renderCalendar();
            showLatestSummary();
            showDetail(date);
        } else {
            status.className = 'status err';
            status.textContent = 'Server error: ' + (res.error || 'unknown');
        }
    } catch (e) {
        status.className = 'status err';
        status.textContent = 'OCR failed: ' + e.message;
    }
    btn.disabled = !selectedFiles.length;
});

function mergeDay(positions, portfolio, existing) {
    const day = { ...existing };
    if (positions) {
        day.valorisation = positions.valorisation ?? day.valorisation;
        day.total_valo = positions.total_valo ?? day.total_valo;
        day.plus_minus_value = positions.plus_minus_value ?? day.plus_minus_value;
        day.disponible = positions.disponible ?? day.disponible;
        day.engagee = positions.engagee ?? day.engagee;
        if (positions.positions.length) day.positions = positions.positions;
    }
    if (portfolio) {
        day.total_portefeuille = portfolio.total_portefeuille ?? day.total_portefeuille;
        day.total_liquidite = portfolio.total_liquidite ?? day.total_liquidite;
        day.liquidite_disponible = portfolio.liquidite_disponible ?? day.liquidite_disponible;
        day.liquidite_reservee = portfolio.liquidite_reservee ?? day.liquidite_reservee;
        day.total_general = portfolio.total_general ?? day.total_general;
        if (portfolio.holdings.length) day.holdings = portfolio.holdings;
    }
    // merged per-share list (common shares summed)
    if (positions && portfolio) {
        day.stocks = applyAliases(mergeStocks(positions.positions, portfolio.holdings), aliases);
    } else if (positions) {
        day.stocks = applyAliases(positions.positions.map((p) => ({
            name: p.name, qty: p.qty, value: p.value, plus_minus: p.plus_minus,
            pm: p.pm, prmp: p.prmp, source: 'A',
        })), aliases);
    } else if (portfolio) {
        day.stocks = applyAliases(portfolio.holdings.map((h) => ({
            name: h.titre, qty: h.quantite, value: h.montant, cours: h.cours, source: 'B',
        })), aliases);
    }
    return day;
}

async function renameStock(oldName) {
    const newName = prompt('Rename stock (applies to all days):', oldName);
    if (!newName || newName.trim() === oldName) return;
    const key = stockKey(oldName);
    aliases[key] = newName.trim();
    try {
        const res = await API.setNames(aliases);
        if (!res.ok) throw new Error(res.error || 'save failed');
        showToast('Renamed to ' + aliases[key]);
        loadData();
    } catch (e) {
        showToast('Rename failed: ' + e.message);
    }
}

// ---------------- Summary ----------------
function showLatestSummary() {
    const section = $('#summarySection');
    const dates = Object.keys(days).sort();
    if (!dates.length) { section.hidden = true; return; }
    section.hidden = false;
    const last = dates[dates.length - 1];
    const day = days[last];
    $('#latestDate').textContent = fmtDateLong(last);

    const prev = prevDay(last);
    const delta = prev && day.valorisation != null && prev.valorisation != null
        ? Math.round((day.valorisation - prev.valorisation) * 1000) / 1000
        : null;

    const cards = [
        { label: 'Valorisation', value: day.valorisation, mono: true },
        { label: 'Total Portefeuille', value: day.total_portefeuille, mono: true },
        { label: 'Liquidité', value: day.total_liquidite, mono: true },
        { label: 'Total Général', value: day.total_general, mono: true },
        { label: '+/- Value', value: day.plus_minus_value, mono: true },
        { label: 'Disponible', value: day.disponible, mono: true },
    ];

    let html = '';
    if (delta !== null) {
        html += `<div class="stat-card">
            <div class="stat-label">vs Yesterday</div>
            <div class="stat-value mono ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${fmtMoney(delta)}</div>
            <div class="stat-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}">${delta > 0 ? '▲ Up' : delta < 0 ? '▼ Down' : '— Flat'}</div>
        </div>`;
    }
    cards.forEach((c) => {
        html += `<div class="stat-card">
            <div class="stat-label">${c.label}</div>
            <div class="stat-value ${c.mono ? 'mono' : ''}">${fmtNum(c.value)} TND</div>
        </div>`;
    });
    $('#summaryGrid').innerHTML = html;
}

function prevDay(date) {
    const dates = Object.keys(days).sort();
    const idx = dates.indexOf(date);
    return idx > 0 ? days[dates[idx - 1]] : null;
}

// ---------------- Calendar ----------------
function renderCalendar() {
    $('#calTitle').textContent = `${MONTHS[currentMonth]} ${currentYear}`;
    const grid = $('#calGrid');

    let html = DOWS.map((d) => `<div class="cal-dow">${d}</div>`).join('');

    const first = new Date(currentYear, currentMonth, 1);
    let start = (first.getDay() + 6) % 7;
    const dim = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = todayStr();

    for (let i = 0; i < start; i++) html += `<div class="cal-day empty"></div>`;

    const sortedDates = Object.keys(days).sort();

    for (let d = 1; d <= dim; d++) {
        const date = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const day = days[date];
        let cls = 'cal-day';
        let chgHtml = '';

        if (day) {
            const prev = prevDay(date);
            const change = prev && day.valorisation != null && prev.valorisation != null
                ? Math.round((day.valorisation - prev.valorisation) * 1000) / 1000
                : null;
            if (change !== null) {
                if (change > 0) cls += ' up';
                else if (change < 0) cls += ' down';
                else cls += ' flat';
                const sign = change > 0 ? '+' : '';
                chgHtml = `<div class="chg">${sign}${fmtNum(change, 1)}</div>`;
            } else {
                cls += ' flat';
            }
        }
        if (date === today) cls += ' today';

        html += `<div class="${cls}" onclick="selectDay('${date}')">
            <div class="d">${d}</div>${chgHtml}
        </div>`;
    }
    grid.innerHTML = html;
}

$('#prevBtn').addEventListener('click', () => {
    currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
});
$('#nextBtn').addEventListener('click', () => {
    currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
});

// ---------------- Day detail ----------------
async function selectDay(date) {
    const day = days[date];
    if (!day) return;
    showDetail(date);
    $('#detailSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showDetail(date) {
    const day = days[date];
    if (!day) return;
    const section = $('#detailSection');
    section.hidden = false;
    $('#detailTitle').textContent = fmtDateLong(date);

    const prev = prevDay(date);
    const delta = prev && day.valorisation != null && prev.valorisation != null
        ? Math.round((day.valorisation - prev.valorisation) * 1000) / 1000
        : null;
    $('#detailDelta').textContent = delta !== null
        ? `vs ${prevDayLabel(date)}: ${fmtMoney(delta)} (${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'})`
        : 'No previous day to compare';

    let html = '';

    const stocksList = day.stocks && day.stocks.length
        ? day.stocks
        : (day.positions && day.positions.length && day.holdings && day.holdings.length
            ? applyAliases(mergeStocks(day.positions, day.holdings), aliases)
            : (day.stocks || null));

    if (stocksList && stocksList.length) {
        html += `<div class="panel">
            <h3>Stocks (merged)</h3>
            <table class="table">
                <tr><th>Stock</th><th class="num">Qty</th><th class="num">Cours</th><th class="num">Value</th><th class="num">+/-</th><th class="num">Src</th></tr>
                ${stocksList.map((s) => `<tr>
                    <td class="stock-name">${esc(s.name) || '—'}
                        <button class="rename-btn" title="Rename" onclick="renameStock('${escAttr(s.name)}')">✎</button>
                    </td>
                    <td class="num">${s.qty ?? '—'}</td>
                    <td class="num">${fmtNum(s.cours)}</td>
                    <td class="num">${fmtNum(s.value, 2)}</td>
                    <td class="num ${s.plus_minus > 0 ? 'pos' : s.plus_minus < 0 ? 'neg' : ''}">${s.plus_minus != null ? fmtNum(s.plus_minus) : '—'}</td>
                    <td class="num"><span class="src-badge ${s.source}">${s.source === 'both' ? 'A+B' : s.source}</span></td>
                </tr>`).join('')}
            </table>
        </div>`;

        if (day.positions && day.positions.length) {
            html += `<details class="panel"><summary>Picture A (positions view)</summary>
                <table class="table">
                    <tr><th>Stock</th><th class="num">QTE</th><th class="num">PM</th><th class="num">Value</th><th class="num">+/-</th></tr>
                    ${day.positions.map((p) => `<tr>
                        <td class="stock-name">${esc(p.name) || '—'}</td>
                        <td class="num">${p.qty ?? '—'}</td>
                        <td class="num">${fmtNum(p.pm)}</td>
                        <td class="num">${fmtNum(p.value, 2)}</td>
                        <td class="num ${p.plus_minus > 0 ? 'pos' : p.plus_minus < 0 ? 'neg' : ''}">${fmtNum(p.plus_minus)}</td>
                    </tr>`).join('')}
                </table>
            </details>`;
        }

        if (day.holdings && day.holdings.length) {
            html += `<details class="panel"><summary>Picture B (portfolio summary)</summary>
                <table class="table">
                    <tr><th>Titre</th><th class="num">Qty</th><th class="num">Cours</th><th class="num">Montant</th></tr>
                    ${day.holdings.map((h) => `<tr>
                        <td class="stock-name">${esc(h.titre) || '—'}</td>
                        <td class="num">${h.quantite ?? '—'}</td>
                        <td class="num">${fmtNum(h.cours)}</td>
                        <td class="num">${fmtNum(h.montant)}</td>
                    </tr>`).join('')}
                </table>
            </details>`;
        }
    }

    const totals = [
        { k: 'Valorisation', v: day.valorisation, hl: true },
        { k: 'Total Portefeuille', v: day.total_portefeuille },
        { k: 'Total Liquidité', v: day.total_liquidite },
        { k: 'Liquidité Disponible', v: day.liquidite_disponible },
        { k: 'Liquidité Réservée', v: day.liquidite_reservee },
        { k: 'Total Général', v: day.total_general },
        { k: '+/- Value', v: day.plus_minus_value },
    ];
    const hasTotals = totals.some((t) => t.v != null);
    if (hasTotals) {
        html += `<div class="panel">
            <h3>Totals</h3>
            <div class="totals">
                ${totals.map((t) => `<div class="total-row ${t.hl ? 'hl' : ''}">
                    <span class="k">${t.k}</span><span class="v">${fmtNum(t.v)} TND</span>
                </div>`).join('')}
            </div>
        </div>`;
    }

    if (!html) html = '<div class="panel">No data for this day.</div>';
    $('#detailGrid').innerHTML = html;
}

function prevDayLabel(date) {
    const dates = Object.keys(days).sort();
    const idx = dates.indexOf(date);
    return idx > 0 ? dates[idx - 1] : '';
}