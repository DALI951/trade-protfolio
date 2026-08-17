// ---- Shared helpers ----
const $ = (sel) => document.querySelector(sel);

function fmtNum(n, decimals = 3) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return n.toLocaleString('en-GB', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function fmtMoney(n, decimals = 3) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return sign + fmtNum(n, decimals) + ' TND';
}

function fmtDateLong(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
}

function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
}

function showToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---- API ----
const API = {
    async save(date, day) {
        const res = await fetch('api/save.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, day }),
        });
        return res.json();
    },
    async all() {
        const res = await fetch('api/data.php');
        if (!res.ok) throw new Error('API error ' + res.status);
        return res.json();
    },
    async del(date) {
        const res = await fetch('api/delete.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date }),
        });
        return res.json();
    },
    async names() {
        const res = await fetch('api/names.php');
        if (!res.ok) throw new Error('API error ' + res.status);
        return res.json();
    },
    async setNames(names) {
        const res = await fetch('api/names.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ names }),
        });
        return res.json();
    },
};