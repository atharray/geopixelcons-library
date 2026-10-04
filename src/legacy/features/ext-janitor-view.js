
    // ============================================================
    //  EXTENSION: Janitor View [extJanitorView]
    // ============================================================
    if (_settings.extJanitorView) {
        try {
            (function _ext_janitorView() {

    function revealModBtn() {
        const btn = document.getElementById('modGroupBtn');
        if (btn && btn.classList.contains('hidden')) {
            btn.classList.remove('hidden');
            return true;
        }
        return false;
    }

    function init() {
        if (revealModBtn()) return;

        // Button may not exist yet — watch for it
        const observer = new MutationObserver(() => {
            if (revealModBtn()) {
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        // Safety cleanup
        setTimeout(() => observer.disconnect(), 30000);
    }

    // ============================================================
    //  Janitor Colors — persistent per-user colour overrides
    // ============================================================
    // The site recolours Janitor View with getColorForUser(userId), which
    // draws a fresh random colour per user each time the view is toggled on.
    // We wrap that one function so a saved hex wins for its user id, and
    // everyone without an override keeps the site's random colour. Because
    // generateUserViewBitmap and Region Screenshot both resolve colours
    // through the same function, overrides apply to the map and exports alike.
    const JC_STORE_KEY = 'gpc-janitor-colors-v1';
    const JC_BTN_ID    = 'gpp-janitor-colors-btn';
    const JC_PANEL_ID  = 'gpp-janitor-colors-panel';
    const JC_IMPORT_ID = 'gpp-janitor-colors-import';
    const JC_STYLE_ID  = 'gpp-janitor-colors-style';
    const JC_TILE_PX   = 1000;
    const JC_DEFAULT_GRID = 25;
    const JC_SCAN_CAP  = 16000000;  // texels read per scan, keeps zoomed-out views responsive
    const JC_ROW_CAP   = 300;
    const JC_NAMES_KEY = 'gpc-janitor-names-v1';
    const JC_NAMES_TTL = 7 * 24 * 60 * 60 * 1000;   // usernames rarely change; refetch weekly
    const JC_NAMES_MAX = 4000;
    const _jcPw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    const jcColors = new Map();   // id -> { hex, name }
    const jcRgb = new Map();      // id -> { r, g, b } served to getColorForUser
    const jcNames = new Map();    // id -> resolved username (session cache)
    let jcOriginal = null;
    let jcScan = null;            // last scan result, reused when only an override changes
    let jcMoveHandler = null;
    let jcSearch = '';            // lowercase filter text for the panel's search box
    let jcSearchTimer = 0;

    function jcNormalizeHex(value) {
        let v = String(value == null ? '' : value).trim();
        if (!v) return null;
        if (v[0] !== '#') v = '#' + v;
        const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
        if (!m) return null;
        let h = m[1];
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        return '#' + h.toUpperCase();
    }

    function jcHexToRgb(hex) {
        return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
    }

    function jcRgbToHex(c) {
        return '#' + [c.r, c.g, c.b].map((n) => (n & 255).toString(16).toUpperCase().padStart(2, '0')).join('');
    }

    // Usernames come only from /GetUserProfile (the tile endpoint carries just
    // owner ids), so remember them between sessions and skip repeat lookups.
    const jcNameTimes = new Map();   // id -> time resolved
    let jcNamesSaveTimer = 0;

    function jcLoadNames() {
        try {
            const raw = localStorage.getItem(JC_NAMES_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const now = Date.now();
            Object.keys(parsed || {}).forEach((k) => {
                const e = parsed[k];
                const id = Number(k);
                if (!Number.isInteger(id) || !Array.isArray(e) || !e[0] || now - Number(e[1]) > JC_NAMES_TTL) return;
                jcNames.set(id, String(e[0]));
                jcNameTimes.set(id, Number(e[1]));
            });
        } catch (_) {}
    }

    function jcSaveNamesSoon() {
        clearTimeout(jcNamesSaveTimer);
        jcNamesSaveTimer = setTimeout(() => {
            try {
                const entries = Array.from(jcNameTimes.entries()).filter(([id]) => jcNames.get(id));
                entries.sort((a, b) => b[1] - a[1]);
                const out = {};
                entries.slice(0, JC_NAMES_MAX).forEach(([id, t]) => { out[id] = [jcNames.get(id), t]; });
                localStorage.setItem(JC_NAMES_KEY, JSON.stringify(out));
            } catch (_) {}
        }, 2000);
    }

    function jcLoad() {
        try {
            const raw = localStorage.getItem(JC_STORE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            (parsed && Array.isArray(parsed.colors) ? parsed.colors : []).forEach((e) => {
                const id = Number(e && e.id);
                const hex = jcNormalizeHex(e && e.hex);
                if (Number.isInteger(id) && id > 0 && hex) jcSetLocal(id, hex, String((e && e.name) || ''));
            });
        } catch (_) {}
    }

    function jcSave() {
        try {
            localStorage.setItem(JC_STORE_KEY, JSON.stringify({ version: 1, colors: jcExportList() }));
        } catch (_) {}
    }

    function jcExportList() {
        return Array.from(jcColors.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([id, v]) => ({ id, hex: v.hex, name: v.name || jcNames.get(id) || '' }));
    }

    function jcSetLocal(id, hex, name) {
        jcColors.set(id, { hex, name: name || '' });
        jcRgb.set(id, jcHexToRgb(hex));
    }

    function jcSetColor(id, hex) {
        const prev = jcColors.get(id);
        jcSetLocal(id, hex, (prev && prev.name) || jcNames.get(id) || '');
        jcSave();
        jcRefreshMap();
    }

    function jcClearColor(id) {
        jcColors.delete(id);
        jcRgb.delete(id);
        jcSave();
        jcRefreshMap();
    }

    function jcInstallHook() {
        if (jcOriginal) return true;
        const orig = _jcPw.getColorForUser;
        if (typeof orig !== 'function') return false;
        if (orig.__gpcJanitorOriginal) { jcOriginal = orig.__gpcJanitorOriginal; return true; }
        // Called once per pixel while the site recolours a tile, so keep it lean.
        const wrapped = function (userId) {
            if (jcRgb.size !== 0) {
                const custom = jcRgb.get(userId);
                if (custom !== undefined) return custom;
            }
            return orig(userId);
        };
        wrapped.__gpcJanitorOriginal = orig;
        _jcPw.getColorForUser = wrapped;
        jcOriginal = orig;
        return true;
    }

    // Same invalidate-and-redraw the site uses after it edits tiles, so the
    // map picks up new colours immediately while Janitor View is on.
    function jcRefreshMap() {
        try {
            if (typeof isUserViewEnabled === 'undefined' || !isUserViewEnabled) return;
            if (typeof tileTextureState !== 'undefined' && tileTextureState) {
                tileTextureState.forEach((s) => { if (s) s.timestamp = -1; });
            }
            if (typeof drawCachedTilesOnMap === 'function') drawCachedTilesOnMap();
        } catch (_) {}
    }

    function jcColorFor(id) {
        const custom = jcRgb.get(id);
        if (custom) return jcRgbToHex(custom);
        try {
            if (typeof getColorForUser === 'function') return jcRgbToHex(getColorForUser(id));
        } catch (_) {}
        return '#808080';
    }

    const JC_SLICE_TEXELS = 150000;   // texels processed per slice before yielding to the page
    let jcScanToken = 0;
    let jcViewKey = '';

    function jcYield() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    // The cached ownership tiles overlapping the viewport, clipped to it. Cheap:
    // no pixel data is read here.
    function jcViewTiles() {
        const out = { tiles: [], truncated: false, ready: false };
        if (typeof map === 'undefined' || !map || typeof tileImageCache === 'undefined' || typeof turf === 'undefined') return out;
        out.ready = true;
        const b = map.getBounds();
        const sw = turf.toMercator(b.getSouthWest().toArray());
        const ne = turf.toMercator(b.getNorthEast().toArray());
        const gs = (typeof gridSize === 'number' && gridSize > 0) ? gridSize : JC_DEFAULT_GRID;
        const minX = Math.floor(sw[0] / gs), maxX = Math.ceil(ne[0] / gs);
        const minY = Math.floor(sw[1] / gs), maxY = Math.ceil(ne[1] / gs);
        let budget = JC_SCAN_CAP;
        for (const [key, entry] of tileImageCache.entries()) {
            const bm = entry && entry.userBitmap;
            if (!bm) continue;
            const parts = key.split(',').map(Number);
            const tx = parts[0], ty = parts[1];
            if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
            const x0 = Math.max(minX, tx), x1 = Math.min(maxX, tx + (bm.width || JC_TILE_PX) - 1);
            const y0 = Math.max(minY, ty), y1 = Math.min(maxY, ty + (bm.height || JC_TILE_PX) - 1);
            const w = x1 - x0 + 1, h = y1 - y0 + 1;
            if (w <= 0 || h <= 0) continue;
            if (w * h > budget) { out.truncated = true; continue; }
            budget -= w * h;
            out.tiles.push({ bm, tx, ty, x0, y0, w, h, gs });
        }
        return out;
    }

    function jcViewSignature() {
        try {
            const b = map.getBounds();
            return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(',') +
                '|' + (typeof tileImageCache !== 'undefined' ? tileImageCache.size : 0);
        } catch (_) {
            return '';
        }
    }

    function jcReadTile(t) {
        const cv = new OffscreenCanvas(t.w, t.h);
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(t.bm, t.x0 - t.tx, t.y0 - t.ty, t.w, t.h, 0, 0, t.w, t.h);
        return { cv, ctx, img: ctx.getImageData(0, 0, t.w, t.h) };
    }

    // Users with pixels inside the viewport (RGB of each ownership texel is the
    // owner id). Time-sliced: reads one tile at a time and yields to the page
    // between slices, so a big view never stalls a frame. Returns null if a
    // newer scan (or closing the panel) superseded this one.
    async function jcScanViewAsync(token) {
        const view = jcViewTiles();
        const counts = new Map();
        const samples = new Map();   // id -> [gridX, gridY] of one of their pixels, for inspecting
        const result = { counts, samples, truncated: view.truncated, ready: view.ready };
        for (const t of view.tiles) {
            if (token !== jcScanToken) return null;
            await jcYield();
            if (token !== jcScanToken) return null;
            let d;
            try { d = jcReadTile(t).img.data; } catch (_) { continue; }
            const rowsPerSlice = Math.max(1, Math.floor(JC_SLICE_TEXELS / t.w));
            for (let r0 = 0; r0 < t.h; r0 += rowsPerSlice) {
                const r1 = Math.min(t.h, r0 + rowsPerSlice);
                for (let i = r0 * t.w * 4, end = r1 * t.w * 4; i < end; i += 4) {
                    if (d[i + 3] === 0) continue;
                    const id = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
                    if (id === 0) continue;
                    const seen = counts.get(id);
                    if (seen === undefined) {
                        const px = i >> 2;
                        samples.set(id, [t.x0 + (px % t.w), t.y0 + Math.floor(px / t.w)]);
                        counts.set(id, 1);
                    } else {
                        counts.set(id, seen + 1);
                    }
                }
                if (r1 < t.h) {
                    await jcYield();
                    if (token !== jcScanToken) return null;
                }
            }
        }
        return result;
    }

    // Same endpoint and payload the native pixel inspector uses.
    async function jcResolveName(id) {
        try {
            const res = await fetch('/GetUserProfile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetId: id }),
            });
            if (!res.ok) return '';
            const data = await res.json();
            return String(data.username || data.Username || data.name || data.Name || '');
        } catch (_) {
            return '';
        }
    }

    const jcNameQueue = [];
    let jcNameWorkers = 0;
    function jcQueueNames(ids, onResolved) {
        ids.forEach((id) => { if (!jcNames.has(id) && !jcNameQueue.includes(id)) jcNameQueue.push(id); });
        while (jcNameWorkers < 4 && jcNameQueue.length) {
            jcNameWorkers++;
            (async () => {
                while (jcNameQueue.length) {
                    const id = jcNameQueue.shift();
                    const name = await jcResolveName(id);
                    jcNames.set(id, name);
                    if (name) { jcNameTimes.set(id, Date.now()); jcSaveNamesSoon(); }
                    const saved = jcColors.get(id);
                    if (saved && name && !saved.name) { saved.name = name; jcSave(); }
                    onResolved(id, name);
                }
                jcNameWorkers--;
            })();
        }
    }

    function jcIsDark() {
        return document.body.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function jcIsViewOn() {
        try { return typeof isUserViewEnabled !== 'undefined' && isUserViewEnabled === true; } catch (_) { return false; }
    }

    function jcInjectStyle() {
        const dark = jcIsDark();
        const t = (l, d) => (dark ? d : l);
        let style = document.getElementById(JC_STYLE_ID);
        if (!style) { style = document.createElement('style'); style.id = JC_STYLE_ID; document.head.appendChild(style); }
        style.textContent = `
            #${JC_PANEL_ID} {
                position: fixed; top: 70px; left: 70px; z-index: 10060; width: 360px; max-width: calc(100vw - 16px);
                max-height: 70vh; display: flex; flex-direction: column; border-radius: 12px; overflow: hidden;
                background: ${t('#ffffff', '#1e1e2e')}; color: ${t('#111827', '#f5f5f5')};
                border: 1px solid ${t('#d1d5db', '#45475a')}; box-shadow: 0 20px 60px rgba(0,0,0,.3);
                font-size: 12px;
            }
            #${JC_PANEL_ID} .gpp-jc-head {
                display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: move; user-select: none;
                background: ${t('#f1f5f9', '#313244')}; border-bottom: 1px solid ${t('#e2e8f0', '#45475a')};
            }
            #${JC_PANEL_ID} .gpp-jc-title { font-weight: 700; flex: 1; font-size: 13px; }
            #${JC_PANEL_ID} .gpp-jc-bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-bottom: 1px solid ${t('#e2e8f0', '#45475a')}; }
            .gpp-jc-btn {
                padding: 4px 9px; border-radius: 6px; border: none; cursor: pointer; font-size: 11px; font-weight: 600;
                background: ${t('#e2e8f0', '#585b70')}; color: ${t('#1e293b', '#cdd6f4')};
            }
            .gpp-jc-btn:hover { filter: brightness(${dark ? '1.15' : '0.95'}); }
            .gpp-jc-btn-primary { background: ${t('#3b82f6', '#89b4fa')}; color: ${t('#ffffff', '#1e1e2e')}; }
            #${JC_PANEL_ID} .gpp-jc-list { overflow-y: auto; padding: 6px 8px; flex: 1; min-height: 60px; }
            #${JC_PANEL_ID} .gpp-jc-row {
                display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px;
                background: ${t('#ffffff', '#181825')}; margin-bottom: 3px;
            }
            #${JC_PANEL_ID} .gpp-jc-row:hover { background: ${t('#f3f4f6', '#232336')}; }
            #${JC_PANEL_ID} .gpp-jc-chip {
                width: 22px; height: 22px; border-radius: 4px; flex-shrink: 0; padding: 0; cursor: pointer;
                border: 1px solid ${t('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')}; background: none;
            }
            #${JC_PANEL_ID} .gpp-jc-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
            #${JC_PANEL_ID} .gpp-jc-name:hover { color: ${t('#3b82f6', '#89b4fa')}; text-decoration: underline; }
            #${JC_PANEL_ID} .gpp-jc-search-wrap { padding: 8px 10px 0; }
            #${JC_PANEL_ID} .gpp-jc-search {
                width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px; font-size: 12px;
                border: 2px solid ${t('#d1d5db', '#45475a')}; background: ${t('#ffffff', '#11111b')}; color: ${t('#111827', '#f5f5f5')};
            }
            #${JC_PANEL_ID} .gpp-jc-search:focus { outline: none; border-color: ${t('#3b82f6', '#89b4fa')}; }
            #${JC_PANEL_ID} .gpp-jc-sub { color: ${t('#64748b', '#a6adc8')}; font-size: 10px; flex-shrink: 0; }
            #${JC_PANEL_ID} .gpp-jc-hex, #${JC_IMPORT_ID} textarea {
                font-family: ui-monospace, Menlo, Consolas, monospace; box-sizing: border-box; border-radius: 6px;
                border: 2px solid ${t('#d1d5db', '#45475a')}; background: ${t('#ffffff', '#11111b')}; color: ${t('#111827', '#f5f5f5')};
            }
            #${JC_PANEL_ID} .gpp-jc-hex { width: 74px; padding: 2px 5px; font-size: 11px; flex-shrink: 0; }
            #${JC_PANEL_ID} .gpp-jc-hex.gpp-jc-custom { border-color: ${t('#3b82f6', '#89b4fa')}; }
            #${JC_PANEL_ID} .gpp-jc-note { padding: 6px 10px; color: ${t('#64748b', '#a6adc8')}; font-size: 11px; border-top: 1px solid ${t('#e2e8f0', '#45475a')}; }
            #${JC_IMPORT_ID} {
                position: fixed; inset: 0; z-index: 10080; background: rgba(0,0,0,.5);
                display: flex; align-items: center; justify-content: center;
            }
            #${JC_IMPORT_ID} .gpp-jc-modal {
                width: 440px; max-width: calc(100vw - 24px); border-radius: 12px; padding: 14px;
                background: ${t('#ffffff', '#1e1e2e')}; color: ${t('#111827', '#f5f5f5')};
                border: 1px solid ${t('#d1d5db', '#45475a')}; box-shadow: 0 20px 60px rgba(0,0,0,.3);
                display: flex; flex-direction: column; gap: 8px; font-size: 12px;
            }
            #${JC_IMPORT_ID} textarea { width: 100%; height: 180px; padding: 8px; font-size: 11px; resize: vertical; }
            #${JC_IMPORT_ID} .gpp-jc-error { color: ${t('#dc2626', '#f38ba8')}; min-height: 14px; }
        `;
    }

    function jcEl(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function jcButton(label, handler, primary) {
        const b = jcEl('button', 'gpp-jc-btn' + (primary ? ' gpp-jc-btn-primary' : ''), label);
        b.type = 'button';
        b.addEventListener('click', handler);
        return b;
    }

    function jcCopy(text, button) {
        const flash = (msg) => {
            const prev = button.textContent;
            button.textContent = msg;
            setTimeout(() => { button.textContent = prev; }, 1600);
        };
        const fallback = () => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                flash('✅ Copied!');
            } catch (_) { flash('Copy failed'); }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => flash('✅ Copied!')).catch(fallback);
        } else { fallback(); }
    }

    function jcParseImport(text) {
        const data = JSON.parse(text);
        let list = null;
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.colors)) list = data.colors;
        else if (data && typeof data === 'object') {
            const src = (data.colors && typeof data.colors === 'object') ? data.colors : data;
            list = Object.entries(src).map(([id, v]) => (typeof v === 'string' ? { id, hex: v } : Object.assign({ id }, v)));
        }
        if (!list) throw new Error('Unrecognized format');
        const out = [];
        list.forEach((e) => {
            const id = Number(e && e.id);
            const hex = jcNormalizeHex(e && e.hex);
            if (Number.isInteger(id) && id > 0 && hex) out.push({ id, hex, name: String((e && e.name) || '') });
        });
        return out;
    }

    function jcOpenImport(onDone) {
        const existing = document.getElementById(JC_IMPORT_ID);
        if (existing) existing.remove();
        jcInjectStyle();
        const overlay = jcEl('div');
        overlay.id = JC_IMPORT_ID;
        const modal = jcEl('div', 'gpp-jc-modal');
        const title = jcEl('div', '', 'Import janitor colors');
        title.style.cssText = 'font-weight:700;font-size:14px;';
        const area = document.createElement('textarea');
        area.placeholder = '{"type":"gpc-janitor-colors","version":1,"colors":[{"id":123,"hex":"#FF00AA"}]}';
        const err = jcEl('div', 'gpp-jc-error');
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = '.json,application/json,text/plain';
        file.addEventListener('change', () => {
            const f = file.files && file.files[0];
            if (!f) return;
            f.text().then((t) => { area.value = t; }).catch(() => { err.textContent = 'Could not read that file.'; });
        });
        const mode = document.createElement('select');
        [['merge', 'Merge with existing colors'], ['replace', 'Replace all existing colors']].forEach(([v, l]) => {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = l;
            mode.appendChild(o);
        });
        const row = jcEl('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
        const close = () => overlay.remove();
        row.append(
            jcButton('Cancel', close),
            jcButton('Import', () => {
                try {
                    const entries = jcParseImport(area.value);
                    if (!entries.length) { err.textContent = 'No valid {id, hex} entries found.'; return; }
                    if (mode.value === 'replace') { jcColors.clear(); jcRgb.clear(); }
                    entries.forEach((e) => jcSetLocal(e.id, e.hex, e.name));
                    jcSave();
                    jcRefreshMap();
                    close();
                    onDone();
                } catch (e) {
                    err.textContent = 'Invalid JSON: ' + (e && e.message ? e.message : e);
                }
            }, true)
        );
        modal.append(title, area, file, mode, err, row);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.body.appendChild(overlay);
        area.focus();
    }

    function jcMakeDraggable(panel, handle) {
        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            const rect = panel.getBoundingClientRect();
            const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
            const move = (ev) => {
                panel.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx)) + 'px';
                panel.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)) + 'px';
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            e.preventDefault();
        });
    }

    function jcClosePanel() {
        const panel = document.getElementById(JC_PANEL_ID);
        if (panel) panel.remove();
        jcScanToken++;
        jcStopHighlight();
        if (jcMoveHandler && typeof map !== 'undefined' && map && typeof map.off === 'function') {
            try { map.off('moveend', jcMoveHandler); } catch (_) {}
        }
        jcMoveHandler = null;
    }

    // ── Hover highlight ──────────────────────────────────────────
    // Hovering a row highlights that user's pixels in magenta. It is a
    // lightweight overlay canvas rather than a tile regeneration: one pass over
    // the cached ownership bitmaps builds a small per-tile mask, which is
    // re-projected only when the map moves.
    let jcHl = null;   // { id, masks, canvas, redraw, timer }

    async function jcBuildMasks(id, state) {
        const masks = [];
        const view = jcViewTiles();
        for (const t of view.tiles) {
            if (jcHl !== state) return null;
            await jcYield();
            if (jcHl !== state) return null;
            try {
                const { cv, ctx, img } = jcReadTile(t);
                const d = img.data;
                const rowsPerSlice = Math.max(1, Math.floor(JC_SLICE_TEXELS / t.w));
                let hit = false;
                for (let r0 = 0; r0 < t.h; r0 += rowsPerSlice) {
                    const r1 = Math.min(t.h, r0 + rowsPerSlice);
                    for (let i = r0 * t.w * 4, end = r1 * t.w * 4; i < end; i += 4) {
                        const match = d[i + 3] !== 0 && ((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) === id;
                        if (match) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255; hit = true; }
                        else { d[i + 3] = 0; }
                    }
                    if (r1 < t.h) {
                        await jcYield();
                        if (jcHl !== state) return null;
                    }
                }
                if (!hit) continue;
                ctx.putImageData(img, 0, 0);
                // Cells are centred on grid coordinates, matching the site's tile placement.
                masks.push({
                    canvas: cv,
                    west: t.x0 * t.gs - t.gs / 2, east: (t.x0 + t.w) * t.gs - t.gs / 2,
                    south: t.y0 * t.gs - t.gs / 2, north: (t.y0 + t.h) * t.gs - t.gs / 2,
                    cols: t.w
                });
            } catch (_) {}
        }
        return masks;
    }

    function jcStopHighlight() {
        if (!jcHl) return;
        clearTimeout(jcHl.timer);
        if (jcHl.redraw && typeof map !== 'undefined' && map && typeof map.off === 'function') {
            try { map.off('move', jcHl.redraw); } catch (_) {}
        }
        if (jcHl.canvas) jcHl.canvas.remove();
        jcHl = null;
    }

    function jcStartHighlight(id) {
        jcStopHighlight();
        const state = { id, masks: null, canvas: null, redraw: null, timer: 0 };
        jcHl = state;
        // Brief delay so sweeping the cursor down the list doesn't scan per row.
        state.timer = setTimeout(async () => {
            if (jcHl !== state) return;
            const masks = await jcBuildMasks(id, state);
            if (jcHl !== state || !masks) return;
            state.masks = masks;
            if (!state.masks.length || typeof map === 'undefined' || !map) return;
            const container = map.getContainer();
            const canvas = document.createElement('canvas');
            canvas.id = 'gpp-janitor-colors-highlight';
            canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;';
            container.appendChild(canvas);
            state.canvas = canvas;
            // Static (no animation): redrawn only when the map itself moves.
            const draw = () => {
                if (jcHl !== state) return;
                const rect = container.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                const cw = Math.round(rect.width * dpr), ch = Math.round(rect.height * dpr);
                if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
                const ctx = canvas.getContext('2d');
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, rect.width, rect.height);
                state.masks.forEach((m) => {
                    const sw = map.project(turf.toWgs84([m.west, m.south]));
                    const ne = map.project(turf.toWgs84([m.east, m.north]));
                    const x = sw.x, y = ne.y, w = ne.x - sw.x, h = sw.y - ne.y;
                    if (w <= 0 || h <= 0) return;
                    if (x > rect.width || y > rect.height || x + w < 0 || y + h < 0) return;
                    ctx.imageSmoothingEnabled = (w / m.cols) < 1;
                    // Mask row 0 is the lowest grid Y, which the site draws at the
                    // BOTTOM of the tile (its corners are supplied BL,BR,TR,TL to
                    // flip the bitmap), so flip vertically to match.
                    ctx.save();
                    ctx.translate(x, y + h);
                    ctx.scale(1, -1);
                    ctx.drawImage(m.canvas, 0, 0, w, h);
                    ctx.restore();
                });
            };
            state.redraw = draw;
            try { map.on('move', draw); } catch (_) {}
            draw();
        }, 90);
    }

    // Same result as clicking one of the user's pixels with the site's inspect
    // tool: inspectPixel fetches /GetUserProfile and fills the hoverInfo panel.
    async function jcInspectUser(id) {
        const sample = jcScan && jcScan.samples && jcScan.samples.get(id);
        try {
            const inspect = _jcPw.inspectPixel || (typeof inspectPixel === 'function' ? inspectPixel : null);
            if (sample && typeof inspect === 'function') {
                await inspect(sample[0], sample[1], sample[0] + ',' + sample[1]);
                return;
            }
            // Fallback: no inspectable pixel, so call the profile endpoint directly.
            const res = await fetch('/GetUserProfile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetId: id }),
            });
            const show = _jcPw.showPixelUser || (typeof showPixelUser === 'function' ? showPixelUser : null);
            if (typeof show === 'function') show(res.ok ? await res.json() : null, sample ? sample[0] + ',' + sample[1] : '');
        } catch (err) {
            console.warn('[GeoPixelcons++] Janitor Colors could not open the user profile:', err);
        }
    }

    // Blocked User List compatibility: its page bridge publishes the users it is
    // currently fading or hiding (only while the list is enabled), so those
    // users stay out of the Janitor Colors list.
    function jcBlockedIds() {
        const ids = new Set();
        try {
            const bridge = _jcPw.__gpcBlockedUsers;
            if (!bridge || typeof bridge.getOpacities !== 'function') return ids;
            (bridge.getOpacities() || []).forEach((e) => {
                const id = Number(e && e.id);
                if (Number.isInteger(id)) ids.add(id);
            });
        } catch (_) {}
        return ids;
    }

    const JC_BATCH = 40;   // rows built per step; the rest load as the list scrolls

    function jcBuildRow(panel, id, count) {
        const row = jcEl('div', 'gpp-jc-row');
        const custom = jcColors.get(id);
        const current = jcColorFor(id);

        const chip = document.createElement('input');
        chip.type = 'color';
        chip.className = 'gpp-jc-chip';
        chip.value = current.toLowerCase();
        chip.title = 'Pick a color';

        const name = jcEl('span', 'gpp-jc-name', jcNames.get(id) || (custom && custom.name) || ('User #' + id));
        name.dataset.gppJcId = String(id);
        name.title = 'User ID ' + id + ' - click to show their profile';
        name.addEventListener('click', () => jcInspectUser(id));
        const sub = jcEl('span', 'gpp-jc-sub', count.toLocaleString() + ' px');

        const hex = document.createElement('input');
        hex.type = 'text';
        hex.className = 'gpp-jc-hex' + (custom ? ' gpp-jc-custom' : '');
        hex.value = custom ? custom.hex : '';
        hex.placeholder = current;
        hex.maxLength = 7;
        hex.spellcheck = false;

        const commit = (raw) => {
            const v = String(raw).trim();
            if (!v) {
                if (custom) jcClearColor(id);
            } else {
                const norm = jcNormalizeHex(v);
                if (!norm) { hex.value = custom ? custom.hex : ''; return; }
                jcSetColor(id, norm);
            }
            jcRenderRows(panel);
        };
        hex.addEventListener('change', () => commit(hex.value));
        hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') hex.blur(); });
        chip.addEventListener('change', () => commit(chip.value));

        row.addEventListener('mouseenter', () => jcStartHighlight(id));
        row.addEventListener('mouseleave', jcStopHighlight);
        row.append(chip, name, sub, hex);
        if (custom) row.appendChild(jcButton('✕', () => { jcClearColor(id); jcRenderRows(panel); }));
        return row;
    }

    function jcApplyResolvedName(panel, id, resolved) {
        if (!resolved) return;
        const list = panel.querySelector('.gpp-jc-list');
        const el = list && list.querySelector('.gpp-jc-name[data-gpp-jc-id="' + id + '"]');
        if (el) el.textContent = resolved;
        if (jcSearch) {
            clearTimeout(jcSearchTimer);
            jcSearchTimer = setTimeout(() => {
                if (document.getElementById(JC_PANEL_ID) === panel) jcRenderRows(panel);
            }, 250);
        }
    }

    // resetDepth: start again from the first batch (search text changed);
    // otherwise keep as many rows built as before so scroll position survives.
    function jcRenderRows(panel, resetDepth) {
        const list = panel.querySelector('.gpp-jc-list');
        const note = panel.querySelector('.gpp-jc-note');
        const scrollTop = list.scrollTop;
        const prevRendered = (panel.__jc && panel.__jc.rendered) || 0;
        jcStopHighlight();
        list.textContent = '';
        panel.__jc = null;
        if (!jcScan) {
            list.appendChild(jcEl('div', 'gpp-jc-sub', 'Scanning the view…'));
            note.textContent = '';
            return;
        }
        if (!jcScan.ready) {
            list.appendChild(jcEl('div', 'gpp-jc-sub', 'The map is still loading.'));
            note.textContent = '';
            return;
        }
        const blocked = jcBlockedIds();
        const entries = Array.from(jcScan.counts.entries()).filter(([id]) => !blocked.has(id)).sort((a, b) => b[1] - a[1]);
        const candidates = entries.slice(0, JC_ROW_CAP);
        const q = jcSearch;
        // A name search needs every candidate's name; otherwise only look up
        // the rows actually built (see renderMore below).
        if (q) jcQueueNames(candidates.map(([id]) => id), (id, resolved) => jcApplyResolvedName(panel, id, resolved));
        const shown = q ? candidates.filter(([id]) => {
            const custom = jcColors.get(id);
            const label = (jcNames.get(id) || (custom && custom.name) || '').toLowerCase();
            return label.includes(q) || String(id).includes(q.replace(/^#/, ''));
        }) : candidates;
        if (!shown.length) {
            list.appendChild(jcEl('div', 'gpp-jc-sub', q ? 'No users in view match that search.' : 'No users in view. Pan or zoom the map, then Refresh.'));
        }

        const state = { shown, rendered: 0, more: null };
        state.more = (n) => {
            const slice = shown.slice(state.rendered, state.rendered + n);
            if (!slice.length) return;
            const frag = document.createDocumentFragment();
            slice.forEach(([id, count]) => frag.appendChild(jcBuildRow(panel, id, count)));
            list.appendChild(frag);
            state.rendered += slice.length;
            if (!q) jcQueueNames(slice.map(([id]) => id), (id, resolved) => jcApplyResolvedName(panel, id, resolved));
        };
        panel.__jc = state;
        state.more(resetDepth ? JC_BATCH : Math.max(JC_BATCH, prevRendered));
        list.scrollTop = scrollTop;

        const inView = entries.filter(([id]) => jcColors.has(id)).length;
        note.textContent = `${entries.length} user${entries.length === 1 ? '' : 's'} in view` +
            (q ? ` · ${shown.length} match` : (entries.length > shown.length ? ` (top ${shown.length} listed)` : '')) +
            ` · ${jcColors.size} custom saved (${inView} in view)` +
            (jcScan.truncated ? ' · zoom in for a complete list' : '') +
            (jcIsViewOn() ? '' : ' · colors show once Janitor View is on');
    }

    async function jcRescan(panel) {
        const token = ++jcScanToken;
        const result = await jcScanViewAsync(token);
        if (!result || token !== jcScanToken || !document.getElementById(JC_PANEL_ID)) return;
        jcScan = result;
        jcViewKey = jcViewSignature();
        jcRenderRows(panel);
    }

    function jcOpenPanel() {
        if (document.getElementById(JC_PANEL_ID)) { jcClosePanel(); return; }
        jcInstallHook();
        jcInjectStyle();
        jcScan = null;
        jcViewKey = '';
        const panel = jcEl('div');
        panel.id = JC_PANEL_ID;

        const head = jcEl('div', 'gpp-jc-head');
        head.append(jcEl('span', 'gpp-jc-title', '🎨 Janitor Colors'), jcButton('✕', jcClosePanel));

        const bar = jcEl('div', 'gpp-jc-bar');
        const exportBtn = jcButton('📋 Export', () => {
            jcCopy(JSON.stringify({ type: 'gpc-janitor-colors', version: 1, colors: jcExportList() }, null, 2), exportBtn);
        });
        bar.append(
            jcButton('🔄 Refresh', () => jcRescan(panel), true),
            jcButton('📥 Import', () => jcOpenImport(() => jcRescan(panel))),
            exportBtn,
            jcButton('🗑️ Clear settings', () => {
                if (!jcColors.size || !confirm('Remove all ' + jcColors.size + ' custom janitor colors?')) return;
                jcColors.clear();
                jcRgb.clear();
                jcSave();
                jcRefreshMap();
                jcRenderRows(panel);
            })
        );

        const searchWrap = jcEl('div', 'gpp-jc-search-wrap');
        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'gpp-jc-search';
        search.placeholder = 'Search users in view by name or ID';
        search.spellcheck = false;
        search.autocomplete = 'off';
        search.value = jcSearch;
        search.addEventListener('input', () => {
            jcSearch = search.value.trim().toLowerCase();
            jcRenderRows(panel, true);
        });
        searchWrap.appendChild(search);

        const list = jcEl('div', 'gpp-jc-list');
        const note = jcEl('div', 'gpp-jc-note');
        panel.append(head, bar, searchWrap, list, note);
        list.addEventListener('scroll', () => {
            const st = panel.__jc;
            if (st && st.rendered < st.shown.length && list.scrollTop + list.clientHeight > list.scrollHeight - 160) st.more(JC_BATCH);
        }, { passive: true });
        document.body.appendChild(panel);
        jcMakeDraggable(panel, head);

        let timer = null;
        jcMoveHandler = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                // Skip hidden tabs and views that haven't actually changed.
                if (document.hidden || !document.getElementById(JC_PANEL_ID)) return;
                if (jcViewSignature() === jcViewKey) return;
                // Don't rebuild rows out from under a field being edited.
                if (list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
                jcRescan(panel);
            }, 900);
        };
        try {
            if (typeof map !== 'undefined' && map && typeof map.on === 'function') map.on('moveend', jcMoveHandler);
        } catch (_) {}
        jcRenderRows(panel);
        jcRescan(panel);
    }

    function jcInsertButton() {
        if (document.getElementById(JC_BTN_ID)) return true;
        const anchor = document.getElementById('toggleUserViewBtn');
        if (!anchor) return false;
        const btn = document.createElement('button');
        btn.id = JC_BTN_ID;
        btn.type = 'button';
        btn.title = 'Janitor Colors';
        btn.className = 'w-10 h-10 bg-white dark:bg-gray-700 shadow rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer text-gray-700 dark:text-gray-200 border-0';
        btn.textContent = '🎨';
        btn.addEventListener('click', jcOpenPanel);
        anchor.insertAdjacentElement('afterend', btn);
        return true;
    }

    function initJanitorColors() {
        if (!_settings.extJanitorColors) {
            _featureStatus.extJanitorColors = 'disabled';
            return;
        }
        jcLoad();
        jcLoadNames();
        _featureStatus.extJanitorColors = 'ok';
        // The page script defines getColorForUser; poll until it exists.
        let tries = 0;
        const hookTimer = setInterval(() => {
            if (jcInstallHook() || ++tries > 120) clearInterval(hookTimer);
        }, 500);
        if (jcInsertButton()) return;
        const observer = new MutationObserver(() => { if (jcInsertButton()) observer.disconnect(); });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 60000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { init(); initJanitorColors(); });
    } else {
        init();
        initJanitorColors();
    }

            })();
            _featureStatus.extJanitorView = 'ok';
            console.log('[GeoPixelcons++] ✅ Janitor View loaded');
        } catch (err) {
            _featureStatus.extJanitorView = 'error';
            dbgPush(`Janitor View init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Janitor View' });
            console.error('[GeoPixelcons++] ❌ Janitor View failed:', err);
        }
    }