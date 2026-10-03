
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
        const wrapped = function (userId) {
            const custom = jcRgb.get(userId);
            return custom || orig.apply(this, arguments);
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

    // Users with pixels inside the current viewport, read from the cached
    // ownership bitmaps (RGB of each texel encodes the owner id).
    function jcScanView() {
        const counts = new Map();
        const samples = new Map();   // id -> [gridX, gridY] of one of their pixels, for inspecting
        const result = { counts, samples, truncated: false, ready: false };
        if (typeof map === 'undefined' || !map || typeof tileImageCache === 'undefined' || typeof turf === 'undefined') return result;
        result.ready = true;
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
            if (w * h > budget) { result.truncated = true; continue; }
            budget -= w * h;
            try {
                const cv = new OffscreenCanvas(w, h);
                const ctx = cv.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(bm, x0 - tx, y0 - ty, w, h, 0, 0, w, h);
                const d = ctx.getImageData(0, 0, w, h).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] === 0) continue;
                    const id = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
                    if (id === 0) continue;
                    const seen = counts.get(id);
                    if (seen === undefined) {
                        const px = i >> 2;
                        samples.set(id, [x0 + (px % w), y0 + Math.floor(px / w)]);
                        counts.set(id, 1);
                    } else {
                        counts.set(id, seen + 1);
                    }
                }
            } catch (_) {}
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

    function jcBuildMasks(id) {
        const masks = [];
        if (typeof map === 'undefined' || !map || typeof tileImageCache === 'undefined' || typeof turf === 'undefined') return masks;
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
            if (w * h > budget) continue;
            budget -= w * h;
            try {
                const cv = new OffscreenCanvas(w, h);
                const ctx = cv.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(bm, x0 - tx, y0 - ty, w, h, 0, 0, w, h);
                const img = ctx.getImageData(0, 0, w, h);
                const d = img.data;
                let hit = false;
                for (let i = 0; i < d.length; i += 4) {
                    const match = d[i + 3] !== 0 && ((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) === id;
                    if (match) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255; hit = true; }
                    else { d[i + 3] = 0; }
                }
                if (!hit) continue;
                ctx.putImageData(img, 0, 0);
                // Cells are centred on grid coordinates, matching the site's tile placement.
                masks.push({
                    canvas: cv,
                    west: x0 * gs - gs / 2, east: (x1 + 1) * gs - gs / 2,
                    south: y0 * gs - gs / 2, north: (y1 + 1) * gs - gs / 2,
                    cols: w
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
        state.timer = setTimeout(() => {
            if (jcHl !== state) return;
            state.masks = jcBuildMasks(id);
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

    function jcRenderRows(panel) {
        const list = panel.querySelector('.gpp-jc-list');
        const note = panel.querySelector('.gpp-jc-note');
        const scrollTop = list.scrollTop;
        jcStopHighlight();
        list.textContent = '';
        if (!jcScan || !jcScan.ready) {
            list.appendChild(jcEl('div', 'gpp-jc-sub', 'The map is still loading.'));
            note.textContent = '';
            return;
        }
        const entries = Array.from(jcScan.counts.entries()).sort((a, b) => b[1] - a[1]);
        const candidates = entries.slice(0, JC_ROW_CAP);
        // Names resolve lazily, so look up every candidate (not just matches) or a
        // name search could never find a user whose name hasn't loaded yet.
        jcQueueNames(candidates.map(([id]) => id), (id, resolved) => {
            if (!resolved) return;
            const el = list.querySelector('.gpp-jc-name[data-gpp-jc-id="' + id + '"]');
            if (el) el.textContent = resolved;
            if (jcSearch) {
                clearTimeout(jcSearchTimer);
                jcSearchTimer = setTimeout(() => {
                    if (document.getElementById(JC_PANEL_ID) === panel) jcRenderRows(panel);
                }, 250);
            }
        });
        const q = jcSearch;
        const shown = q ? candidates.filter(([id]) => {
            const custom = jcColors.get(id);
            const label = (jcNames.get(id) || (custom && custom.name) || '').toLowerCase();
            return label.includes(q) || String(id).includes(q.replace(/^#/, ''));
        }) : candidates;
        if (!shown.length) {
            list.appendChild(jcEl('div', 'gpp-jc-sub', q ? 'No users in view match that search.' : 'No users in view. Pan or zoom the map, then Refresh.'));
        }
        shown.forEach(([id, count]) => {
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
            list.appendChild(row);
        });
        list.scrollTop = scrollTop;
        const inView = entries.filter(([id]) => jcColors.has(id)).length;
        note.textContent = `${entries.length} user${entries.length === 1 ? '' : 's'} in view` +
            (q ? ` · ${shown.length} match` : (entries.length > shown.length ? ` (top ${shown.length} shown)` : '')) +
            ` · ${jcColors.size} custom saved (${inView} in view)` +
            (jcScan.truncated ? ' · zoom in for a complete list' : '') +
            (jcIsViewOn() ? '' : ' · colors show once Janitor View is on');
    }

    function jcRescan(panel) {
        jcScan = jcScanView();
        jcRenderRows(panel);
    }

    function jcOpenPanel() {
        if (document.getElementById(JC_PANEL_ID)) { jcClosePanel(); return; }
        jcInstallHook();
        jcInjectStyle();
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
            jcRenderRows(panel);
        });
        searchWrap.appendChild(search);

        const list = jcEl('div', 'gpp-jc-list');
        const note = jcEl('div', 'gpp-jc-note');
        panel.append(head, bar, searchWrap, list, note);
        document.body.appendChild(panel);
        jcMakeDraggable(panel, head);

        let timer = null;
        jcMoveHandler = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                // Don't rebuild rows out from under a field being edited.
                if (!document.getElementById(JC_PANEL_ID)) return;
                if (list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
                jcRescan(panel);
            }, 500);
        };
        try {
            if (typeof map !== 'undefined' && map && typeof map.on === 'function') map.on('moveend', jcMoveHandler);
        } catch (_) {}
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