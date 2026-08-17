// ---- Stock merging across the two screenshots ----
// Picture A = positions view (fields: name, value, qty, prmp, pm, plus_minus)
// Picture B = portfolio summary (fields: titre, quantite, cours, montant)
// Common shares are summed into ONE entry per day.

function normalizeStockName(name) {
    return String(name || '')
        .toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[-_/\\]/g, ' ')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Jaro-Winkler similarity (0..1)
function jaroWinkler(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const mw = Math.max(a.length, b.length);
    const matchDist = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    const aM = new Array(a.length).fill(false);
    const bM = new Array(b.length).fill(false);
    let matches = 0;
    for (let i = 0; i < a.length; i++) {
        const lo = Math.max(0, i - matchDist), hi = Math.min(i + matchDist + 1, b.length);
        for (let j = lo; j < hi; j++) {
            if (bM[j] || a[i] !== b[j]) continue;
            aM[i] = bM[j] = true;
            matches++;
            break;
        }
    }
    if (!matches) return 0;
    let t = 0, k = 0;
    for (let i = 0; i < a.length; i++) {
        if (!aM[i]) continue;
        while (!bM[k]) k++;
        if (a[i] !== b[k]) t++;
        k++;
    }
    const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
    let p = 0;
    for (let i = 0; i < Math.min(a.length, b.length, 4); i++) {
        if (a[i] === b[i]) p++; else break;
    }
    return jaro + p * 0.1 * (1 - jaro);
}

function stockSimilarity(nameA, nameB) {
    const a = normalizeStockName(nameA);
    const b = normalizeStockName(nameB);
    if (!a || !b) return 0;
    const jw = jaroWinkler(a, b);
    const aT = a.split(' '), bT = b.split(' ');
    const shared = aT.filter((t) => bT.includes(t)).length;
    const tokenSim = shared / Math.max(aT.length, bT.length);
    const contains = (a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 4 ? 1 : 0;
    return Math.max(jw, tokenSim, contains);
}

// Pair Picture-A positions with Picture-B holdings (1:1 greedy match).
function matchStocks(positions, holdings) {
    const pairs = [];
    const usedB = new Set();
    for (const p of positions) {
        let best = null, bestSim = 0, bestIdx = -1;
        for (let j = 0; j < holdings.length; j++) {
            if (usedB.has(j)) continue;
            const sim = stockSimilarity(p.name, holdings[j].titre);
            if (sim > bestSim) { bestSim = sim; best = holdings[j]; bestIdx = j; }
        }
        if (best && bestSim >= 0.7) {
            usedB.add(bestIdx);
            pairs.push({ a: p, b: best, sim: bestSim });
        } else {
            pairs.push({ a: p, b: null, sim: bestSim });
        }
    }
    for (let j = 0; j < holdings.length; j++) {
        if (!usedB.has(j)) pairs.push({ a: null, b: holdings[j], sim: 0 });
    }
    return pairs;
}

function mergeStocks(positions, holdings) {
    return matchStocks(positions || [], holdings || []).map(({ a, b }) => {
        const pos = a || {};
        const hold = b || {};
        const stock = { name: '', source: 'both' };
        if (a && b) stock.source = 'both';
        else if (a) stock.source = 'A';
        else stock.source = 'B';

        // name: prefer the longer/cleaner of the two OCR readings
        const aName = String(pos.name || '').trim();
        const bName = String(hold.titre || '').trim();
        stock.name = (aName.length >= bName.length ? aName : bName) || aName || bName;

        let qtySum = (pos.qty != null ? pos.qty : 0) + (hold.quantite != null ? hold.quantite : 0);
        let valueSum = (pos.value != null ? pos.value : 0) + (hold.montant != null ? hold.montant : 0);
        stock.qty = qtySum !== 0 ? qtySum : null;
        stock.value = valueSum !== 0 ? valueSum : null;
        stock.plus_minus = pos.plus_minus != null ? pos.plus_minus : null;
        stock.pm = pos.pm != null ? pos.pm : (hold.cours != null ? hold.cours : null);
        stock.prmp = pos.prmp != null ? pos.prmp : null;
        stock.cours = hold.cours != null ? hold.cours : (pos.pm != null ? pos.pm : null);
        return stock;
    });
}

// Apply persistent user aliases (OCR name -> canonical name).
function applyAliases(stocks, aliases) {
    if (!aliases) return stocks;
    for (const s of stocks) {
        const key = normalizeStockName(s.name);
        if (aliases[key]) s.name = aliases[key];
    }
    return stocks;
}

// Pick a canonical name map for display: normalizeStockName as a public helper for stats.
function stockKey(name) {
    return normalizeStockName(name);
}