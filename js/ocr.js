// ---- OCR parser (browser, Tesseract.js) ----
// Strategy: work at WORD level. Tesseract merges whole table rows into one line,
// and space-thousands ("7 853,13") split numbers across words. Adjacent numeric
// words are merged back into a single number.

function parseNumber(s) {
    s = String(s).trim();
    s = s.replace(/[^\d,.\-]/g, '');
    if (!s || s === '-' || s === '.-' || s === ',-') return null;
    s = s.replace(/\.(?=.*\.)/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return Math.round(n * 1000) / 1000;
}

function isNumericWord(t) {
    return /\d/.test(t);
}

function cleanText(t) {
    return String(t || '').trim().replace(/\s+/g, ' ');
}

// Build rows of WORDS (each word has text + bbox) — one row per Tesseract line.
function flattenLines(blocks) {
    const lines = [];
    for (const b of blocks || []) {
        for (const p of b.paragraphs || []) {
            for (const l of p.lines || []) lines.push(l);
        }
    }
    return lines;
}

function buildWordRows(blocks, yThreshold = 15) {
    const rows = [];
    for (const l of flattenLines(blocks)) {
        const words = [];
        for (const w of l.words || []) {
            if (!w.text || !w.text.trim()) continue;
            words.push({ text: w.text, bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } });
        }
        if (words.length) rows.push(words);
    }
    return rows;
}

function rowText(row) {
    return row.map((w) => cleanText(w.text)).join(' ');
}

// Group adjacent numeric words in a row into merged number strings,
// but only when they sit in the same column (small x-gap), e.g.:
// "7" "853,13" -> "7853,13" (space thousands), while
// "76" "19.050" stay separate (table columns).
function numericGroups(row, gapThreshold = 60) {
    const groups = [];
    let cur = [];
    let prev = null;
    for (const w of row) {
        if (isNumericWord(w.text)) {
            const gapOk = prev && (w.bbox.x0 - prev.bbox.x1) < gapThreshold;
            if (!prev || !gapOk) {
                if (cur.length) { groups.push(cur.join('')); cur = []; }
            }
            cur.push(cleanText(w.text));
            prev = w;
        } else {
            if (cur.length) { groups.push(cur.join('')); cur = []; }
            prev = null;
        }
    }
    if (cur.length) groups.push(cur.join(''));
    return groups;
}

// First numeric group in the row positioned after the label's x0.
function numberAfterLabel(row, labelWord) {
    if (!labelWord) return null;
    const later = row.filter((w) => w.bbox.x0 >= labelWord.bbox.x0);
    const groups = numericGroups(later);
    // drop the label word itself if it contains digits (e.g. "QTE: 26")
    const labelText = cleanText(labelWord.text);
    let v = null;
    for (const g of groups) {
        v = parseNumber(g);
        if (v !== null) return v;
    }
    return null;
}

// All numeric groups in the row, as values.
function allNumbersInRow(row) {
    return numericGroups(row).map(parseNumber).filter((v) => v !== null);
}

function norm(t) {
    return String(t || '').toLowerCase().replace(/[éèêë]/g, 'e').replace(/[àâä]/g, 'a').replace(/[îï]/g, 'i').replace(/[ôö]/g, 'o').replace(/[ûü]/g, 'u').replace(/ç/g, 'c');
}

function findWord(row, pattern, exact = false) {
    const p = norm(pattern);
    for (const w of row) {
        const t = norm(w.text);
        if (exact ? p === t : t.includes(p)) return w;
    }
    return null;
}

function classifyScreenshot(rows) {
    const all = rows.map(rowText).join(' ').toLowerCase();
    if (all.includes('valorisation')) return 'positions';
    if (all.includes('total portefeuille') || all.includes('total general') || all.includes('total général')) return 'portfolio';
    // Scrolled-down part of the positions screen: no header, but the
    // positions list itself (QTE/PRMP/PM rows).
    if (all.includes('qte') && (all.includes('prmp') || all.includes('+/-value'))) return 'positions-part';
    return 'unknown';
}

// Fallback classification on the raw OCR text (works even when word/block
// structure is missing). Returns {type, rows} where rows may be crude.
function classifyText(rawText) {
    const s = String(rawText || '').toLowerCase();
    if (s.includes('valorisation')) return 'positions';
    if (s.includes('total portefeuille') || s.includes('total general') || s.includes('total général')) return 'portfolio';
    if (s.includes('qte') && (s.includes('prmp') || s.includes('+/-value'))) return 'positions-part';
    return 'unknown';
}

// Last-resort parser: extract the totals directly from raw OCR text via
// regex (no bboxes needed). Positions/holdings lists need the word-based
// path, so this only fills the summary fields.
function parseFromText(rawText) {
    const t = String(rawText || '');
    const normText = t.replace(/[éèêë]/g, 'e').replace(/[àâä]/g, 'a');
    const find = (label) => {
        const re = new RegExp(label + '\\s*:?\\s*([\\d][\\d\\s.,-]*\\d)', 'i');
        const m = normText.match(re);
        if (!m) return null;
        return parseNumber(m[1]);
    };
    const out = { type: classifyText(normText), via: 'text' };
    if (out.type === 'positions' || out.type === 'positions-part') {
        out.valorisation = find('valorisation');
        out.total_valo = find('total valo');
        out.plus_minus_value = find('\\+/-\\s*value');
        out.disponible = find('disponible');
        out.engagee = find('engagee');
        out.positions = [];
    } else if (out.type === 'portfolio') {
        out.total_portefeuille = find('total portefeuille');
        out.total_liquidite = find('total liquidite(?! dispo| reserv)');
        out.liquidite_disponible = find('liquidite disponible');
        out.liquidite_reservee = find('liquidite reservee');
        out.total_general = find('total general');
        out.holdings = [];
    }
    return out;
}

// ---------------- Positions screenshot ----------------
function parsePositions(rows) {
    const result = {
        type: 'positions',
        valorisation: null, total_valo: null, plus_minus_value: null,
        disponible: null, engagee: null, positions: [],
    };

    for (const row of rows) {
        const rt = norm(rowText(row));

        if (rt.includes('disponible') && !rt.includes('total')) {
            const lb = findWord(row, 'disponible');
            const v = numberAfterLabel(row, lb);
            if (v !== null) result.disponible = v;
        }
        if (rt.includes('engagee') || rt.includes('engagée')) {
            const lb = findWord(row, 'engage');
            const v = numberAfterLabel(row, lb);
            if (v !== null) result.engagee = v;
        }
        if (rt.replace(/!/g, '').includes('total valo')) {
            const lb = findWord(row, 'total');
            const v = numberAfterLabel(row, lb);
            if (v !== null) result.total_valo = v;
        }
        if (rt.replace(/ /g, '').replace(/:/g, '').includes('+/-value')) {
            const lb = findWord(row, '+/-');
            const v = numberAfterLabel(row, lb);
            if (v !== null && result.plus_minus_value === null) result.plus_minus_value = v;
        }
        if (rt.includes('valorisation')) {
            const lb = findWord(row, 'valorisation');
            const v = numberAfterLabel(row, lb);
            if (v !== null) result.valorisation = v;
        }
    }

    result.positions = extractPositions(rows);
    return result;
}

function extractPositions(rows) {
    const positions = [];
    for (let i = 0; i < rows.length; i++) {
        const rt = norm(rowText(rows[i]));
        if (!rt.includes('qte')) continue;

        const pos = { name: '', value: null, qty: null, prmp: null, pm: null, plus_minus: null };
        let nameRowIdx = null;

        for (let j = Math.max(0, i - 3); j < i; j++) {
            const jt = norm(rowText(rows[j]));
            const skip = ['positions', 'disponible', 'engagee', 'total', 'valorisation', '+/-', 'qte', 'prmp', 'pm'];
            if (skip.some((s) => jt.includes(s))) continue;
            const words = rows[j];
            const nums = allNumbersInRow(rows[j]);
            if (nums.length === 1 && !isNumericWord(cleanText(words[0]))) {
                // name row: text words (joined) + one trailing number (value)
                pos.value = nums[0];
                pos.name = words.filter((w) => !isNumericWord(w.text))
                    .map((w) => cleanText(w.text)).join(' ');
                nameRowIdx = j;
                break;
            }
        }

        const qteWord = findWord(rows[i], 'qte');
        if (qteWord) {
            const g = numericGroups(rows[i]).map(parseNumber).filter((v) => v !== null);
            // qty is the group right after the QTE label
            for (const w of rows[i]) {
                if (w.bbox.x0 > qteWord.bbox.x0) {
                    const v = parseNumber(cleanText(w.text));
                    if (v !== null && Number.isInteger(v)) { pos.qty = v; break; }
                }
            }
        }
        const prmpWord = findWord(rows[i], 'prmp');
        if (prmpWord) {
            for (const w of rows[i]) {
                if (w.bbox.x0 > prmpWord.bbox.x0) {
                    const v = parseNumber(cleanText(w.text));
                    if (v !== null) { pos.prmp = v; break; }
                }
            }
        }
        function findPmWord(row) {
    for (const w of row) {
        const t = norm(w.text);
        if (/^pm[:.\s]?$/.test(t) || /^pm[:.\s]\d/.test(t)) return w;
    }
    return null;
}

const pmWord = findPmWord(rows[i]);
        if (pmWord) {
            for (const w of rows[i]) {
                if (w.bbox.x0 > pmWord.bbox.x0) {
                    const v = parseNumber(cleanText(w.text));
                    if (v !== null) { pos.pm = v; break; }
                }
            }
            if (pos.pm === null) {
                // label carries the number itself, e.g. "PM:27.15"
                const v = parseNumber(cleanText(pmWord.text).replace(/^pm[:.\s]*/i, ''));
                if (v !== null) pos.pm = v;
            }
        }

        for (let j = i; j < Math.min(rows.length, i + 3); j++) {
            const jt = norm(rowText(rows[j]));
            if (jt.includes('+/-')) {
                const lb = findWord(rows[j], '+/-');
                const v = numberAfterLabel(rows[j], lb);
                if (v !== null) { pos.plus_minus = v; break; }
            }
        }

        if (pos.name && pos.qty !== null) {
            // scroll parts may overlap by one row — drop exact duplicates
            const dup = positions.find((p) => p.name === pos.name && p.qty === pos.qty);
            if (!dup) positions.push(pos);
        }
    }
    return positions;
}

// ---------------- Portfolio screenshot ----------------
function parsePortfolio(rows) {
    const result = {
        type: 'portfolio',
        total_portefeuille: null, total_liquidite: null,
        liquidite_disponible: null, liquidite_reservee: null,
        total_general: null, holdings: [],
    };

    for (const row of rows) {
        const rt = norm(rowText(row));

        if (rt.includes('total portefeuille')) {
            const lb = findWord(row, 'total portefeuille') || findWord(row, 'portefeuille');
            const v = numberAfterLabel(row, lb);
            if (v !== null) result.total_portefeuille = v;
        }
        if (rt.includes('total liquidite') && !rt.includes('dispo') && !rt.includes('reserv')) {
            const lb = findWord(row, 'liquidite');
            const v = numberAfterLabel(row, lb);
            if (v !== null) result.total_liquidite = v;
        }
        if (rt.includes('liquidite disponible') || rt.includes('liquidite disponibl')) {
            const lb = findWord(row, 'disponible');
            const v = numberAfterLabel(row, lb);
            if (v !== null) result.liquidite_disponible = v;
        }
        if (rt.includes('liquidite reservee') || rt.includes('liquidite reserv')) {
            const lb = findWord(row, 'reservee');
            const v = numberAfterLabel(row, lb);
            if (v !== null) result.liquidite_reservee = v;
        }
        if (rt.includes('total general') || rt.includes('total genera')) {
            const lb = findWord(row, 'general');
            const v = numberAfterLabel(row, lb);
            if (v !== null) result.total_general = v;
        }
    }

    result.holdings = extractHoldings(rows);
    return result;
}

function extractHoldings(rows) {
    const holdings = [];
    let tableStart = null;
    for (let i = 0; i < rows.length; i++) {
        const rt = norm(rowText(rows[i]));
        if (rt.includes('titre') && (rt.includes('quantite') || rt.includes('cours'))) {
            tableStart = i + 1;
            break;
        }
    }
    if (tableStart === null) return holdings;

    for (let i = tableStart; i < rows.length; i++) {
        const row = rows[i];
        const rt = norm(rowText(row));
        if (rt.includes('total') || rt.includes('liquidite')) break;

        const nums = allNumbersInRow(row);
        if (!nums.length) continue;

        // titre = leading non-numeric words
        const nameWords = [];
        for (const w of row) {
            if (!isNumericWord(w.text)) nameWords.push(cleanText(w.text));
            else break;
        }
        const titre = nameWords.join(' ');

        const h = { titre, quantite: null, cours: null, montant: null };
        if (nums.length >= 3) {
            h.quantite = Number.isInteger(nums[0]) ? nums[0] : Math.round(nums[0]);
            h.cours = nums[1];
            h.montant = nums[2];
        } else if (nums.length === 2) {
            h.cours = nums[0];
            h.montant = nums[1];
            if (h.cours > 0) {
                const inf = h.montant / h.cours;
                if (inf === Math.floor(inf)) h.quantite = Math.floor(inf);
            }
        }
        if (h.titre && (h.quantite !== null || h.montant !== null)) holdings.push(h);
    }
    return holdings;
}

// ---------------- Header value refinement ----------------
// Tesseract sometimes drops the decimal comma of small header numbers at
// full-image scale ("Disponible : 5,18" -> "518"). When a labeled header
// field parsed as a plain integer, re-OCR just its word-bbox region at 5x
// zoom — isolated crops read the comma reliably (verified).
async function reOcrRegion(worker, canvas, x0, y0, x1, y1) {
    const pad = 12;
    const sx = Math.max(0, Math.floor(x0) - pad);
    const sy = Math.max(0, Math.floor(y0) - pad);
    const sw = Math.min(canvas.width - sx, Math.ceil(x1) + pad - sx);
    const sh = Math.min(canvas.height - sy, Math.ceil(y1) + pad - sy);
    if (sw < 4 || sh < 4) return null;
    const z = 5;
    const zoom = document.createElement('canvas');
    zoom.width = sw * z;
    zoom.height = sh * z;
    const zctx = zoom.getContext('2d');
    zctx.imageSmoothingEnabled = true;
    zctx.imageSmoothingQuality = 'high';
    zctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw * z, sh * z);
    const { data } = await worker.recognize(zoom, {}, { text: true });
    return parseNumber(data.text.replace(/[^\d,.\- ]/g, ' '));
}

async function refineHeaderDecimals(worker, canvas, rows, result) {
    const done = new Set();
    for (const row of rows) {
        const rt = norm(rowText(row));
        const defs = [];
        if (rt.includes('disponible') && !rt.includes('total')) defs.push(['disponible', 'disponible']);
        if (rt.includes('engagee') || rt.includes('engagée')) defs.push(['engagee', 'engage']);
        if (rt.replace(/!/g, '').includes('total valo')) defs.push(['total_valo', 'total']);
        if (rt.replace(/ /g, '').replace(/:/g, '').includes('+/-value')) defs.push(['plus_minus_value', '+/-']);
        if (rt.includes('valorisation')) defs.push(['valorisation', 'valorisation']);
        if (rt.includes('total portefeuille')) defs.push(['total_portefeuille', 'portefeuille']);
        if (rt.includes('total liquidite') && !rt.includes('dispo') && !rt.includes('reserv')) defs.push(['total_liquidite', 'liquidite']);
        if (rt.includes('liquidite disponible') || rt.includes('liquidite disponibl')) defs.push(['liquidite_disponible', 'disponible']);
        if (rt.includes('liquidite reservee') || rt.includes('liquidite reserv')) defs.push(['liquidite_reservee', 'reservee']);
        if (rt.includes('total general') || rt.includes('total genera')) defs.push(['total_general', 'general']);
        for (const [field, label] of defs) {
            if (result[field] == null || done.has(field)) continue;
            if (!Number.isInteger(result[field])) continue;
            const lb = findWord(row, label);
            if (!lb) continue;
            const nums = [];
            for (const w of row) {
                if (w.bbox.x0 <= lb.bbox.x0) continue;
                if (!isNumericWord(w.text)) {
                    if (/^[^\w\d]+$/.test(w.text)) continue;
                    break;
                }
                nums.push(w);
            }
            if (!nums.length) continue;
            done.add(field);
            const minX = Math.min(...nums.map((w) => w.bbox.x0));
            const minY = Math.min(...nums.map((w) => w.bbox.y0));
            const maxX = Math.max(...nums.map((w) => w.bbox.x1));
            const maxY = Math.max(...nums.map((w) => w.bbox.y1));
            const v = await reOcrRegion(worker, canvas, minX, minY, maxX, maxY);
            if (v !== null && !Number.isInteger(v)) result[field] = v;
        }
    }
}

// Stack scroll-parts of one screenshot vertically into a single image.
async function stitchImages(files) {
    const bmps = [];
    for (const f of files) bmps.push(await createImageBitmap(f));
    const w = Math.max(...bmps.map((b) => b.width));
    const h = bmps.reduce((s, b) => s + b.height, 0);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    let y = 0;
    for (const b of bmps) {
        ctx.drawImage(b, 0, y);
        y += b.height;
    }
    bmps.forEach((b) => b.close());
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return new File([blob], 'stitched.png', { type: 'image/png' });
}

// ---------------- Main ----------------
// Preprocess the uploaded image on a canvas: upscale to ~1600px wide,
// grayscale + contrast — dramatically improves Tesseract accuracy.
function preprocessImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(2.5, 1600 / img.width);
                const w = Math.round(img.width * scale);
                const h = Math.round(img.height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, w, h);
                const imageData = ctx.getImageData(0, 0, w, h);
                const d = imageData.data;
                // contrast stretch (normalize), NOT binarize — binarizing erases
                // dim label text (e.g. "Valorisation") on dark app themes.
                let min = 255, max = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    if (gray < min) min = gray;
                    if (gray > max) max = gray;
                }
                const span = Math.max(1, max - min);
                for (let i = 0; i < d.length; i += 4) {
                    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    const v = Math.round(((gray - min) / span) * 255);
                    d[i] = d[i + 1] = d[i + 2] = v;
                }
                ctx.putImageData(imageData, 0, 0);
                URL.revokeObjectURL(url);
                resolve(canvas);
            } catch (e) {
                URL.revokeObjectURL(url);
                reject(e);
            }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
        img.src = url;
    });
}

async function ocrImage(file) {
    const worker = await Tesseract.createWorker('eng');
    try {
        const input = await preprocessImage(file);
        const { data } = await worker.recognize(input, {}, { blocks: true, text: true });
        const blocks = data.blocks || [];
        const rows = buildWordRows(blocks);
        const type = classifyScreenshot(rows);
        let result = null;
        if (type === 'positions' || type === 'positions-part') {
            result = parsePositions(rows);
            if (type === 'positions-part') result.via = 'positions-part';
            await refineHeaderDecimals(worker, input, rows, result);
            return result;
        }
        if (type === 'portfolio') {
            result = parsePortfolio(rows);
            await refineHeaderDecimals(worker, input, rows, result);
            return result;
        }
        // Fallback: the block/word structure failed but text may still be
        // readable — extract the totals straight from the raw OCR text.
        if (classifyText(data.text) !== 'unknown') return parseFromText(data.text);
        return { type: 'unknown', raw: rows.map(rowText), text: data.text };
    } finally {
        await worker.terminate();
    }
}