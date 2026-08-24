    // ============================================================
    //  EXTENSION: Blocked User List [extBlockedUsers]
    // ============================================================
    //
    //  Hides (or highlights) canvas pixels according to WHO placed them.
    //
    //  How this is possible at all: /GetPixelsCached returns two parallel
    //  1000x1000 WebP images per tile -- ColorWebP (what you see) and
    //  UserWebP, where each texel's RGB is the 24-bit id of the last user to
    //  touch that pixel and alpha>0 means "this pixel has user data". Both
    //  decode into tileImageCache as {colorBitmap, userBitmap}. The site
    //  already walks userBitmap this exact way for its own ownership view
    //  (generateUserViewBitmap in js/index.js), so per-pixel attribution is
    //  fully available client-side with no extra requests.
    //
    //  Where we hook: pixelTileLayer.setTile(tileKey, source, corners) is the
    //  single choke point through which EVERY tile texture reaches the GPU --
    //  normal renders, the site's user-ownership view, and hole re-application
    //  after an erase all funnel through it (js/pixel-tile-layer.js). Patching
    //  that one instance method catches every path without touching the site's
    //  render loop, and -- critically -- we never write back into
    //  tileImageCache, so colorBitmap/userBitmap stay pristine ground truth for
    //  Ghost++ scanning and the native pixel inspector.
    //
    //  Known limitation, by design: userBitmap records only the LAST toucher,
    //  so a blocked pixel becomes transparent (bare map shows through) rather
    //  than revealing whatever art was underneath. The client never received
    //  the prior state, so there is nothing to restore. Highlight mode exists
    //  because "tint theirs red" is usually more useful than erasing it --
    //  hiding a griefer removes the evidence you would want to report.
    //
    //  Styling deliberately mirrors Ghost++ (gpp-library.js): same t() theme
    //  helper from core.js, same palette, radii, and 11px control type, so the
    //  two largest GeoPixelcons++ surfaces read as one product.
    //
    //  Element ids all use the gpp- prefix (current standard).
    //
    if (_settings.extBlockedUsers) {
        try {
            (function _ext_blockedUsers() {

    // Storage key deliberately keeps its original gpc- name: renaming it would
    // silently discard every block a user had already saved.
    const STORE_KEY    = 'gpc-blocked-users-v1';
    const MODAL_ID     = 'gpp-blocked-users-modal';
    const HOVER_BTN_ID = 'gpp-blocked-users-hover-btn';
    const STYLE_ID     = 'gpp-blocked-users-style';
    const BRIDGE_FLAG  = '__gpcBlockedUsersBridge';

    const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // The global highlight colour every new entry inherits (red-500). A user
    // can override it per row; this stays the default so an untouched list
    // looks exactly as it did before per-user colours existed.
    const DEFAULT_HL = '#ef4444';

    function normalizeHex(v) {
        const s = String(v || '').trim();
        return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : DEFAULT_HL;
    }

    function hexToRgb(hex) {
        const h = normalizeHex(hex);
        return [
            parseInt(h.slice(1, 3), 16),
            parseInt(h.slice(3, 5), 16),
            parseInt(h.slice(5, 7), 16),
        ];
    }

    // ── persistence ──────────────────────────────────────────────
    // v2: { version, enabled, mode, excludeNotes,
    //       users:[{id,name,note,enabled,color}] }
    // v1 was { mode, users:[{id,name}] } -- migrated in place on load.
    function normalizeUser(u) {
        const id = Number(u && u.id);
        if (!Number.isInteger(id) || id < 0) return null;
        return {
            id,
            name: String((u && u.name) || ''),
            note: String((u && u.note) || ''),
            enabled: (u && u.enabled === false) ? false : true,
            color: normalizeHex(u && u.color),
        };
    }

    function loadStore() {
        const fallback = { version: 2, enabled: true, mode: 'hide', excludeNotes: false, users: [] };
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return fallback;
            const p = JSON.parse(raw);
            return {
                version: 2,
                enabled: p.enabled === false ? false : true,
                mode: p.mode === 'highlight' ? 'highlight' : 'hide',
                excludeNotes: p.excludeNotes === true,
                users: Array.isArray(p.users) ? p.users.map(normalizeUser).filter(Boolean) : [],
            };
        } catch {
            return fallback;
        }
    }

    function saveStore() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
    }

    let store = loadStore();

    // ── page-realm bridge ────────────────────────────────────────
    // Runs as a classic <script>, so index.js's top-level `let` bindings
    // (pixelTileLayer, tileImageCache, tileTextureState) are lexically in
    // scope -- the same technique ext-map-movement-lock.js uses for `map`.
    // They are invisible to unsafeWindow property access, so a sandbox-side
    // patch is not an option here.
    function installBridge() {
        if (_pw[BRIDGE_FLAG]) return;
        const script = document.createElement('script');
        script.textContent = `
(function(){
if (window.${BRIDGE_FLAG}) return;
window.${BRIDGE_FLAG} = true;

// users: Map<userId, [r,g,b]> -- the value is that user's own highlight
// colour, so one lookup in the hot loop answers both "is this blocked?" and
// "what colour?" instead of a Set test plus a second colour lookup.
var state = { users: new Map(), mode: 'hide', patched: false, lastInspected: null };

// tileKey -> { bmp, ids:Set }  keyed on the userBitmap OBJECT, never the tile
// key: index.js rebuilds cache entries with {...currentEntry, colorBitmap},
// which would carry a stale index forward. Identity comparison survives that.
var idIndex = new Map();

// Shared scratch canvases. setTile() uploads synchronously via texImage2D
// before returning, so a single pair can never be observed mid-reuse.
var cCanvas = null, cCtx = null, uCanvas = null, uCtx = null;
function scratch(w, h) {
    if (!cCanvas) {
        cCanvas = document.createElement('canvas');
        cCanvas.id = 'gpp-blocked-users-scratch-color';
        cCtx = cCanvas.getContext('2d', { willReadFrequently: true });
        uCanvas = document.createElement('canvas');
        uCanvas.id = 'gpp-blocked-users-scratch-user';
        uCtx = uCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (cCanvas.width !== w || cCanvas.height !== h) {
        cCanvas.width = w; cCanvas.height = h;
        uCanvas.width = w; uCanvas.height = h;
    }
    cCtx.clearRect(0, 0, w, h);
    uCtx.clearRect(0, 0, w, h);
}

function userIdsIn(ub, w, h) {
    var ids = new Set();
    try {
        scratch(w, h);
        uCtx.drawImage(ub, 0, 0);
        var d = uCtx.getImageData(0, 0, w, h).data;
        for (var i = 0; i < d.length; i += 4) {
            // alpha, not the id value, marks "has user data" -- id 0 is a real
            // user, which is why index.js tests a>0 rather than truthiness.
            if (d[i + 3] === 0) continue;
            ids.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        }
    } catch (e) { return null; }
    return ids;
}

function filterTile(tileKey, source) {
    if (state.users.size === 0) return source;
    if (typeof tileImageCache === 'undefined' || !tileImageCache) return source;

    var entry = tileImageCache.get(tileKey);
    if (!entry || !entry.userBitmap || !source) return source;

    var ub = entry.userBitmap;
    var w = source.width | 0, h = source.height | 0;
    if (!w || !h || ub.width !== w || ub.height !== h) return source;

    var idx = idIndex.get(tileKey);
    if (!idx || idx.bmp !== ub) {
        var ids = userIdsIn(ub, w, h);
        if (!ids) return source;
        idx = { bmp: ub, ids: ids };
        idIndex.set(tileKey, idx);
    }

    // Most tiles contain nobody blocked -- skip the rebuild entirely.
    var hit = false;
    state.users.forEach(function (_rgb, id) { if (idx.ids.has(id)) hit = true; });
    if (!hit) return source;

    try {
        scratch(w, h);
        cCtx.drawImage(source, 0, 0);
        uCtx.drawImage(ub, 0, 0);
        var cImg = cCtx.getImageData(0, 0, w, h);
        var c = cImg.data;
        var u = uCtx.getImageData(0, 0, w, h).data;
        var highlight = state.mode === 'highlight';

        for (var i = 0; i < u.length; i += 4) {
            if (u[i + 3] === 0) continue;
            var id = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2];
            var col = state.users.get(id);
            if (!col) continue;
            if (highlight) {
                c[i] = col[0]; c[i + 1] = col[1]; c[i + 2] = col[2]; c[i + 3] = 255;
            } else {
                // Fully transparent. The layer uploads DOM sources with
                // UNPACK_PREMULTIPLY_ALPHA_WEBGL, so zeroing all four
                // channels is what a cleared texel looks like there too.
                c[i] = 0; c[i + 1] = 0; c[i + 2] = 0; c[i + 3] = 0;
            }
        }
        cCtx.putImageData(cImg, 0, 0);
        return cCanvas;
    } catch (e) {
        console.warn('[GeoPixelcons++] blocked-users filter failed, passing tile through', e);
        return source;
    }
}

function patchLayer() {
    if (state.patched) return true;
    if (typeof pixelTileLayer === 'undefined' || !pixelTileLayer) return false;
    if (typeof pixelTileLayer.setTile !== 'function') return false;

    var orig = pixelTileLayer.setTile;
    pixelTileLayer.setTile = function (tileKey, source, corners) {
        var use = source;
        try { use = filterTile(tileKey, source); } catch (e) { use = source; }
        return orig.call(this, tileKey, use, corners);
    };
    pixelTileLayer.setTile.__gpcBlockedUsersOriginal = orig;
    state.patched = true;
    return true;
}

// Re-render exactly the way the site re-renders itself after punching holes
// (see updatePunchedHoleTile in js/index.js): invalidate the per-tile texture
// state and let drawCachedTilesOnMap regenerate. Replaying the last setTile
// source would be wrong -- in ownership-view mode that bitmap is a temporary
// that the site closes as soon as the upload returns.
function refresh() {
    try {
        if (typeof tileTextureState !== 'undefined' && tileTextureState) {
            tileTextureState.forEach(function (s) { if (s) s.timestamp = -1; });
        }
        if (typeof drawCachedTilesOnMap === 'function') drawCachedTilesOnMap();
        if (typeof map !== 'undefined' && map && typeof map.triggerRepaint === 'function') {
            map.triggerRepaint();
        }
    } catch (e) { /* a failed refresh must never break painting */ }
}

// Capture whoever the native pixel inspector last resolved, so the pixel-info
// panel can queue that user without us re-implementing click->grid projection.
// Fires on every inspect, including empty pixels (detail.id === null), so the
// panel button can hide itself when there is nobody to block.
if (typeof showPixelUser === 'function' && !showPixelUser.__gpcBlockedUsersHooked) {
    var origShow = showPixelUser;
    window.showPixelUser = function (userData, key) {
        try {
            var id = null, nm = '';
            if (userData) {
                var raw = userData.id !== undefined ? userData.id
                        : userData.ID !== undefined ? userData.ID
                        : userData.Id;
                nm = userData.username || userData.Username
                  || userData.name || userData.Name || '';
                if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) {
                    id = Number(raw);
                }
            }
            state.lastInspected = (id === null) ? null : { id: id, name: String(nm) };
            document.dispatchEvent(new CustomEvent('gpp:pixelUserInspected', {
                detail: { id: id, name: String(nm) }
            }));
        } catch (e) { /* never block the native panel */ }
        return origShow.apply(this, arguments);
    };
    window.showPixelUser.__gpcBlockedUsersHooked = true;
}

window.__gpcBlockedUsers = {
    // arr: [{ id:Number, rgb:[r,g,b] }] -- already resolved sandbox-side, so
    // the page realm never has to parse colour strings in a hot path.
    setUsers: function (arr, mode) {
        var next = new Map();
        (arr || []).forEach(function (u) {
            var id = Number(u && u.id);
            if (!Number.isInteger(id)) return;
            var rgb = (u && u.rgb) || [];
            next.set(id, [rgb[0] | 0, rgb[1] | 0, rgb[2] | 0]);
        });
        state.users = next;
        state.mode = mode === 'highlight' ? 'highlight' : 'hide';
        patchLayer();
        refresh();
    },
    lastInspected: function () { return state.lastInspected; },
    stats: function () {
        return { patched: state.patched, blocked: state.users.size, mode: state.mode,
                 indexedTiles: idIndex.size };
    }
};

// pixelTileLayer is built during map load, so it may not exist yet.
if (!patchLayer()) {
    var tries = 0;
    var timer = setInterval(function () {
        if (patchLayer() || ++tries > 120) clearInterval(timer);
    }, 250);
}
})();`;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }

    // Only users whose own eye is on, and only while the master switch is on.
    function activeUsers() {
        if (!store.enabled) return [];
        return store.users
            .filter((u) => u.enabled)
            .map((u) => ({ id: u.id, rgb: hexToRgb(u.color) }));
    }

    function pushToBridge() {
        try {
            const api = _pw.__gpcBlockedUsers;
            if (api && typeof api.setUsers === 'function') {
                api.setUsers(activeUsers(), store.mode);
            }
        } catch (err) {
            dbgPush(`Blocked Users bridge push failed: ${err && err.message ? err.message : String(err)}`,
                { error: err, uiComponent: 'Blocked User List' });
        }
    }

    function commit() { saveStore(); pushToBridge(); }

    // ── name resolution ──────────────────────────────────────────
    // Same endpoint and payload shape the native pixel inspector uses.
    async function resolveName(id) {
        try {
            const res = await fetch('/GetUserProfile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetId: id }),
            });
            if (!res.ok) return '';
            const data = await res.json();
            return String(data.username || data.Username || data.name || data.Name || '');
        } catch {
            return '';
        }
    }

    // ── list mutation ────────────────────────────────────────────
    function isBlocked(id) { return store.users.some((u) => u.id === id); }

    function addUsers(ids, name) {
        const added = [];
        ids.forEach((id) => {
            if (!Number.isInteger(id) || id < 0 || isBlocked(id)) return;
            store.users.push({ id, name: name || '', note: '', enabled: true, color: DEFAULT_HL });
            added.push(id);
        });
        if (!added.length) return [];
        commit();
        // Names fill in behind the scenes; a slow/failed lookup must not block
        // the block itself from taking effect.
        added.forEach((id) => {
            if (name) return;
            resolveName(id).then((n) => {
                if (!n) return;
                const hit = store.users.find((u) => u.id === id);
                if (!hit || hit.name) return;
                hit.name = n;
                saveStore();
                renderList();
            });
        });
        return added;
    }

    function removeUsers(ids) {
        const set = new Set(ids);
        const before = store.users.length;
        store.users = store.users.filter((u) => !set.has(u.id));
        if (store.users.length !== before) commit();
    }

    // Accepts commas, spaces, tabs, newlines, semicolons, or any mixture.
    function parseIds(text) {
        const seen = new Set();
        const fresh = [], dupInInput = [], already = [], invalid = [];
        String(text || '').split(/[\s,;]+/).forEach((tok) => {
            if (!tok) return;
            const n = Number(tok);
            if (!Number.isInteger(n) || n < 0) { invalid.push(tok); return; }
            if (seen.has(n)) { dupInInput.push(n); return; }
            seen.add(n);
            if (isBlocked(n)) already.push(n);
            else fresh.push(n);
        });
        return { fresh, already, invalid, dupInInput };
    }

    // ── export / import ──────────────────────────────────────────
    function exportObject() {
        return {
            version: 2,
            mode: store.mode,
            users: store.users.map((u) => {
                const out = { id: u.id, name: u.name, enabled: u.enabled, color: u.color };
                if (!store.excludeNotes && u.note) out.note = u.note;
                return out;
            }),
        };
    }

    function exportJson() { return JSON.stringify(exportObject(), null, 2); }

    // Liberal: accepts our own export, a bare array of ids, or an array of
    // objects. Merges rather than replaces -- an import should never silently
    // wipe a list the user spent time building.
    function importJson(text) {
        let parsed;
        try { parsed = JSON.parse(text); }
        catch { return { ok: false, error: 'That is not valid JSON.' }; }

        let rows = null;
        if (Array.isArray(parsed)) rows = parsed;
        else if (parsed && Array.isArray(parsed.users)) rows = parsed.users;
        if (!rows) return { ok: false, error: 'No user list found in that JSON.' };

        const incoming = [];
        rows.forEach((r) => {
            if (typeof r === 'number' || typeof r === 'string') {
                const n = Number(r);
                if (Number.isInteger(n) && n >= 0) {
                    incoming.push({ id: n, name: '', note: '', enabled: true, color: DEFAULT_HL });
                }
                return;
            }
            const u = normalizeUser(r);
            if (u) incoming.push(u);
        });
        if (!incoming.length) return { ok: false, error: 'That JSON contained no usable user ids.' };

        let added = 0, skipped = 0;
        incoming.forEach((u) => {
            if (isBlocked(u.id)) { skipped++; return; }
            store.users.push(u);
            added++;
        });
        if (added) commit();
        return { ok: true, added, skipped };
    }

    // ── styling (mirrors Ghost++ / gpp-library.js) ───────────────
    // Rewritten on every open rather than created once, so a live dark/light
    // toggle is not frozen at whatever theme was active the first time.
    function injectStyle() {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            document.head.appendChild(style);
        }
        style.textContent = `
            #${MODAL_ID} {
                position: fixed; inset: 0; z-index: 100000; display: flex;
                align-items: center; justify-content: center;
                background: rgba(0,0,0,.5);
                font-family: system-ui,-apple-system,sans-serif;
            }
            .gpp-bu-panel {
                width: min(520px, 94vw); max-height: 86vh; display: flex; flex-direction: column;
                background: ${t('#ffffff', '#1e1e2e')}; color: ${t('#111827', '#f5f5f5')};
                border: 1px solid ${t('#d1d5db', '#45475a')};
                border-radius: 10px; overflow: hidden;
                box-shadow: 0 20px 60px ${t('rgba(15,23,42,.28)', 'rgba(0,0,0,.6)')};
            }
            .gpp-bu-header {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
                padding: 10px 12px;
                border-bottom: 1px solid ${t('#d1d5db', '#45475a')};
            }
            .gpp-bu-title { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
            .gpp-bu-body { padding: 10px 12px; overflow-y: auto; }
            .gpp-bu-toolbar {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
                padding-bottom: 8px; margin-bottom: 8px;
                border-bottom: 1px solid ${t('#d1d5db', '#45475a')};
            }
            .gpp-bu-count { font-size: 11px; color: ${t('#64748b', '#a6adc8')}; }
            .gpp-bu-btn {
                font: inherit; font-size: 11px; cursor: pointer; border-radius: 6px;
                padding: 4px 9px; border: 1px solid ${t('#d1d5db', '#45475a')};
                background: ${t('#ffffff', '#313244')}; color: ${t('#111827', '#f5f5f5')};
            }
            .gpp-bu-btn:hover:not(:disabled) { background: ${t('#f3f4f6', '#45475a')}; }
            .gpp-bu-btn:disabled { opacity: .45; cursor: not-allowed; }
            .gpp-bu-btn-danger { color: ${t('#dc2626', '#f38ba8')}; }
            .gpp-bu-btn-primary {
                border-color: ${t('#2563eb', '#89b4fa')};
                color: ${t('#2563eb', '#89b4fa')}; font-weight: 600;
            }
            .gpp-bu-btn-on {
                border-color: ${t('#2563eb', '#89b4fa')};
                background: ${t('rgba(37,99,235,.08)', 'rgba(137,180,250,.12)')};
                color: ${t('#2563eb', '#89b4fa')}; font-weight: 600;
            }
            .gpp-bu-input, .gpp-bu-textarea {
                font: inherit; font-size: 12px; width: 100%; box-sizing: border-box;
                padding: 5px 7px; border-radius: 6px;
                border: 1px solid ${t('#d1d5db', '#45475a')};
                background: ${t('#ffffff', '#11111b')}; color: ${t('#111827', '#f5f5f5')};
            }
            .gpp-bu-input:focus, .gpp-bu-textarea:focus {
                outline: none; border-color: ${t('#2563eb', '#89b4fa')};
            }
            .gpp-bu-textarea { font-family: ui-monospace,Consolas,monospace; font-size: 11px; resize: vertical; }
            .gpp-bu-invalid { border-color: ${t('#dc2626', '#f38ba8')} !important; }
            .gpp-bu-preview {
                margin-top: 6px; font-size: 11px; line-height: 1.5;
                color: ${t('#64748b', '#a6adc8')};
                background: ${t('#f1f5f9', '#292a3a')};
                border: 1px solid ${t('#e5e7eb', '#313244')};
                border-radius: 6px; padding: 6px 8px;
            }
            .gpp-bu-preview-ids {
                font-family: ui-monospace,Consolas,monospace;
                color: ${t('#111827', '#f5f5f5')}; word-break: break-all;
            }
            .gpp-bu-section { margin-bottom: 10px; }
            .gpp-bu-label {
                font-size: 11px; font-weight: 600; margin-bottom: 4px; display: block;
                color: ${t('#64748b', '#a6adc8')};
            }
            .gpp-bu-list {
                border: 1px solid ${t('#d1d5db', '#45475a')};
                border-radius: 6px; overflow: hidden;
            }
            .gpp-bu-row {
                display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px;
                border-bottom: 1px solid ${t('#e5e7eb', '#313244')};
            }
            .gpp-bu-row:last-child { border-bottom: none; }
            .gpp-bu-row:hover { background: ${t('#f9fafb', '#252537')}; }
            .gpp-bu-row-off .gpp-bu-name, .gpp-bu-row-off .gpp-bu-meta { opacity: .45; }
            .gpp-bu-eye {
                background: none; border: none; cursor: pointer; padding: 2px;
                display: flex; align-items: center; color: ${t('#2563eb', '#89b4fa')};
                flex-shrink: 0; margin-top: 1px;
            }
            .gpp-bu-eye-off { color: ${t('#94a3b8', '#6c7086')}; }
            .gpp-bu-eye:disabled { opacity: .35; cursor: not-allowed; }
            .gpp-bu-main { flex: 1; min-width: 0; }
            .gpp-bu-name {
                font-size: 12px; font-weight: 600; overflow: hidden;
                text-overflow: ellipsis; white-space: nowrap;
            }
            .gpp-bu-meta {
                font-size: 10px; font-family: ui-monospace,Consolas,monospace;
                color: ${t('#64748b', '#a6adc8')};
            }
            .gpp-bu-note {
                margin-top: 4px; font-size: 11px; padding: 3px 6px;
                border: 1px solid transparent; border-radius: 4px; background: transparent;
                color: ${t('#64748b', '#a6adc8')}; width: 100%; box-sizing: border-box;
                font-family: inherit;
            }
            .gpp-bu-note:hover { border-color: ${t('#e5e7eb', '#313244')}; }
            .gpp-bu-note:focus {
                outline: none; border-color: ${t('#2563eb', '#89b4fa')};
                background: ${t('#ffffff', '#11111b')}; color: ${t('#111827', '#f5f5f5')};
            }
            .gpp-bu-swatch {
                width: 22px; height: 22px; padding: 0; flex-shrink: 0; margin-top: 1px;
                background: none; cursor: pointer;
                border: 1px solid ${t('#d1d5db', '#45475a')}; border-radius: 5px;
                transition: opacity .12s;
            }
            .gpp-bu-swatch::-webkit-color-swatch-wrapper { padding: 2px; }
            .gpp-bu-swatch::-webkit-color-swatch { border: none; border-radius: 3px; }
            .gpp-bu-swatch::-moz-color-swatch { border: none; border-radius: 3px; }
            .gpp-bu-swatch-idle { opacity: .4; }
            .gpp-bu-swatch-idle:hover { opacity: 1; }
            .gpp-bu-empty {
                padding: 16px 10px; text-align: center; font-size: 11px;
                color: ${t('#64748b', '#a6adc8')};
            }
            .gpp-bu-bulkbar {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
                padding: 6px 8px; margin-top: 8px; border-radius: 6px;
                background: ${t('#f1f5f9', '#292a3a')};
                border: 1px solid ${t('#e5e7eb', '#313244')};
                font-size: 11px;
            }
            .gpp-bu-footer {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
                padding: 8px 12px; border-top: 1px solid ${t('#d1d5db', '#45475a')};
            }
            .gpp-bu-check { cursor: pointer; margin-top: 3px; flex-shrink: 0; }
            .gpp-bu-checkline {
                display: flex; align-items: center; gap: 6px; font-size: 11px;
                color: ${t('#64748b', '#a6adc8')}; cursor: pointer;
            }
            .gpp-bu-status { font-size: 11px; color: ${t('#64748b', '#a6adc8')}; }
            .gpp-bu-status-err { color: ${t('#dc2626', '#f38ba8')}; }
            .gpp-bu-status-ok { color: ${t('#2563eb', '#89b4fa')}; }
            .gpp-bu-btnrow { display: flex; gap: 6px; flex-wrap: wrap; }
        `;
    }

    const EYE_OPEN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_OFF = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 '
        + '9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>'
        + '<line x1="1" y1="1" x2="23" y2="23"/></svg>';

    // ── modal ────────────────────────────────────────────────────
    let listEl = null;
    let selected = new Set();   // ids checked for bulk removal
    let renderMain = null;      // rebinds the main view (set inside openModal)

    function renderList() {
        if (!listEl) return;
        listEl.innerHTML = '';

        if (store.users.length === 0) {
            const empty = document.createElement('div');
            empty.id = 'gpp-blocked-users-empty';
            empty.className = 'gpp-bu-empty';
            empty.textContent = 'No blocked users yet.';
            listEl.appendChild(empty);
            return;
        }

        store.users.forEach((u) => {
            const row = document.createElement('div');
            row.id = `gpp-blocked-users-row-${u.id}`;
            row.className = 'gpp-bu-row' + ((!u.enabled || !store.enabled) ? ' gpp-bu-row-off' : '');

            const check = document.createElement('input');
            check.id = `gpp-blocked-users-check-${u.id}`;
            check.type = 'checkbox';
            check.className = 'gpp-bu-check';
            check.checked = selected.has(u.id);
            check.addEventListener('change', () => {
                if (check.checked) selected.add(u.id); else selected.delete(u.id);
                renderBulkBar();
            });

            const eye = document.createElement('button');
            eye.id = `gpp-blocked-users-eye-${u.id}`;
            eye.type = 'button';
            // Eye OPEN means their pixels are visible (block paused).
            // Eye CROSSED means the block is active and their pixels are gone.
            const showing = !u.enabled || !store.enabled;
            eye.className = 'gpp-bu-eye' + (showing ? ' gpp-bu-eye-off' : '');
            eye.innerHTML = showing ? EYE_OPEN : EYE_OFF;
            eye.disabled = !store.enabled;
            eye.title = !store.enabled
                ? 'Blocklist is disabled — all pixels are showing'
                : (u.enabled ? 'Their pixels are hidden — click to show' : 'Their pixels are showing — click to hide');
            eye.addEventListener('click', () => {
                u.enabled = !u.enabled;
                commit();
                renderList();
            });

            const main = document.createElement('div');
            main.id = `gpp-blocked-users-main-${u.id}`;
            main.className = 'gpp-bu-main';

            const nameLine = document.createElement('div');
            nameLine.id = `gpp-blocked-users-name-${u.id}`;
            nameLine.className = 'gpp-bu-name';
            nameLine.textContent = u.name || '(unknown name)';

            const idLine = document.createElement('div');
            idLine.id = `gpp-blocked-users-id-${u.id}`;
            idLine.className = 'gpp-bu-meta';
            idLine.textContent = `ID ${u.id}`;

            const note = document.createElement('input');
            note.id = `gpp-blocked-users-note-${u.id}`;
            note.type = 'text';
            note.className = 'gpp-bu-note';
            note.placeholder = 'Add a private note…';
            note.value = u.note || '';
            note.addEventListener('change', () => {
                u.note = note.value.trim();
                saveStore();   // notes never affect rendering, so no bridge push
            });

            main.appendChild(nameLine);
            main.appendChild(idLine);
            main.appendChild(note);

            // Per-user highlight colour. Only takes visible effect in Highlight
            // mode, so it dims (but stays editable) while Hide is active rather
            // than vanishing and making the row layout jump between modes.
            const swatch = document.createElement('input');
            swatch.id = `gpp-blocked-users-color-${u.id}`;
            swatch.type = 'color';
            swatch.className = 'gpp-bu-swatch' + (store.mode === 'highlight' ? '' : ' gpp-bu-swatch-idle');
            swatch.value = normalizeHex(u.color);
            swatch.title = store.mode === 'highlight'
                ? `Highlight colour for ${u.name || 'ID ' + u.id}`
                : 'Highlight colour — shows once you switch to Highlight mode';
            swatch.addEventListener('input', () => {
                u.color = normalizeHex(swatch.value);
                commit();
            });

            const rm = document.createElement('button');
            rm.id = `gpp-blocked-users-remove-${u.id}`;
            rm.type = 'button';
            rm.className = 'gpp-bu-btn gpp-bu-btn-danger';
            rm.textContent = 'Remove';
            rm.addEventListener('click', () => {
                selected.delete(u.id);
                removeUsers([u.id]);
                renderList();
                renderBulkBar();
            });

            row.appendChild(check);
            row.appendChild(eye);
            row.appendChild(main);
            row.appendChild(swatch);
            row.appendChild(rm);
            listEl.appendChild(row);
        });
    }

    let bulkBarEl = null;
    function renderBulkBar() {
        if (!bulkBarEl) return;
        const n = selected.size;
        bulkBarEl.style.display = n ? '' : 'none';
        if (!n) return;
        bulkBarEl.innerHTML = '';

        const label = document.createElement('span');
        label.id = 'gpp-blocked-users-bulk-label';
        label.textContent = `${n} selected`;

        const btns = document.createElement('div');
        btns.id = 'gpp-blocked-users-bulk-actions';
        btns.className = 'gpp-bu-btnrow';

        const clear = document.createElement('button');
        clear.id = 'gpp-blocked-users-bulk-clear';
        clear.type = 'button';
        clear.className = 'gpp-bu-btn';
        clear.textContent = 'Clear selection';
        clear.addEventListener('click', () => { selected.clear(); renderList(); renderBulkBar(); });

        const unblock = document.createElement('button');
        unblock.id = 'gpp-blocked-users-bulk-unblock';
        unblock.type = 'button';
        unblock.className = 'gpp-bu-btn gpp-bu-btn-danger';
        unblock.textContent = `Unblock ${n}`;
        unblock.addEventListener('click', () => {
            removeUsers([...selected]);
            selected.clear();
            renderList();
            renderBulkBar();
        });

        btns.appendChild(clear);
        btns.appendChild(unblock);
        bulkBarEl.appendChild(label);
        bulkBarEl.appendChild(btns);
    }

    function openModal(prefillId) {
        const existing = document.getElementById(MODAL_ID);
        if (existing) {
            if (Number.isInteger(prefillId)) {
                const field = document.getElementById('gpp-blocked-users-id-input');
                if (field) {
                    field.value = field.value.trim()
                        ? `${field.value.trim()} ${prefillId}`
                        : String(prefillId);
                    field.dispatchEvent(new Event('input'));
                    field.focus();
                }
                return;
            }
            existing.remove();
            return;
        }

        injectStyle();
        selected = new Set();

        const overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const panel = document.createElement('div');
        panel.id = 'gpp-blocked-users-panel';
        panel.className = 'gpp-bu-panel';

        // ── header ──
        const header = document.createElement('div');
        header.id = 'gpp-blocked-users-header';
        header.className = 'gpp-bu-header';

        const title = document.createElement('div');
        title.id = 'gpp-blocked-users-title';
        title.className = 'gpp-bu-title';
        title.textContent = '🚷 Blocked User List';

        const close = document.createElement('button');
        close.id = 'gpp-blocked-users-close';
        close.type = 'button';
        close.className = 'gpp-bu-btn';
        close.textContent = '✕';
        close.addEventListener('click', () => overlay.remove());

        header.appendChild(title);
        header.appendChild(close);

        const body = document.createElement('div');
        body.id = 'gpp-blocked-users-body';
        body.className = 'gpp-bu-body';

        const footer = document.createElement('div');
        footer.id = 'gpp-blocked-users-footer';
        footer.className = 'gpp-bu-footer';

        // ── main view ──
        renderMain = function () {
            body.innerHTML = '';
            footer.innerHTML = '';
            title.textContent = '🚷 Blocked User List';

            // toolbar: master switch + mode + count
            const toolbar = document.createElement('div');
            toolbar.id = 'gpp-blocked-users-toolbar';
            toolbar.className = 'gpp-bu-toolbar';

            const leftBtns = document.createElement('div');
            leftBtns.id = 'gpp-blocked-users-toolbar-left';
            leftBtns.className = 'gpp-bu-btnrow';

            const master = document.createElement('button');
            master.id = 'gpp-blocked-users-master-toggle';
            master.type = 'button';
            master.className = 'gpp-bu-btn' + (store.enabled ? ' gpp-bu-btn-on' : '');
            master.textContent = store.enabled ? 'Blocklist on' : 'Blocklist off';
            master.title = 'Disabling shows everyone\'s pixels again without losing your list';
            master.addEventListener('click', () => {
                store.enabled = !store.enabled;
                commit();
                renderMain();
            });
            leftBtns.appendChild(master);

            [['hide', 'Hide'], ['highlight', 'Highlight']].forEach(([key, text]) => {
                const b = document.createElement('button');
                b.id = `gpp-blocked-users-mode-${key}`;
                b.type = 'button';
                b.className = 'gpp-bu-btn' + (store.mode === key ? ' gpp-bu-btn-on' : '');
                b.textContent = text;
                b.addEventListener('click', () => {
                    store.mode = key;
                    commit();
                    renderMain();
                });
                leftBtns.appendChild(b);
            });

            const count = document.createElement('span');
            count.id = 'gpp-blocked-users-count';
            count.className = 'gpp-bu-count';
            const active = activeUsers().length;
            count.textContent = `${store.users.length} blocked · ${active} active`;

            toolbar.appendChild(leftBtns);
            toolbar.appendChild(count);
            body.appendChild(toolbar);

            // add section
            const addSection = document.createElement('div');
            addSection.id = 'gpp-blocked-users-add';
            addSection.className = 'gpp-bu-section';

            const addLabel = document.createElement('label');
            addLabel.id = 'gpp-blocked-users-add-label';
            addLabel.className = 'gpp-bu-label';
            addLabel.textContent = 'Block user IDs — commas, spaces, or new lines';

            const input = document.createElement('textarea');
            input.id = 'gpp-blocked-users-id-input';
            input.className = 'gpp-bu-textarea';
            input.rows = 2;
            input.placeholder = '1234, 5678\n9012';

            const preview = document.createElement('div');
            preview.id = 'gpp-blocked-users-preview';
            preview.className = 'gpp-bu-preview';
            preview.style.display = 'none';

            const addBtnRow = document.createElement('div');
            addBtnRow.id = 'gpp-blocked-users-add-actions';
            addBtnRow.className = 'gpp-bu-btnrow';
            addBtnRow.style.marginTop = '6px';

            const addBtn = document.createElement('button');
            addBtn.id = 'gpp-blocked-users-add-btn';
            addBtn.type = 'button';
            addBtn.className = 'gpp-bu-btn gpp-bu-btn-primary';
            addBtn.textContent = 'Block';
            addBtn.disabled = true;

            function refreshPreview() {
                const raw = input.value.trim();
                if (!raw) {
                    preview.style.display = 'none';
                    addBtn.disabled = true;
                    input.classList.remove('gpp-bu-invalid');
                    return;
                }
                const r = parseIds(raw);
                preview.style.display = '';
                addBtn.disabled = r.fresh.length === 0;
                input.classList.toggle('gpp-bu-invalid', r.fresh.length === 0 && r.invalid.length > 0);

                const bits = [];
                if (r.fresh.length) {
                    bits.push(`<b>${r.fresh.length}</b> to block: `
                        + `<span class="gpp-bu-preview-ids">${r.fresh.join(', ')}</span>`);
                }
                if (r.already.length) bits.push(`${r.already.length} already blocked`);
                if (r.dupInInput.length) bits.push(`${r.dupInInput.length} repeated`);
                if (r.invalid.length) bits.push(`${r.invalid.length} not a valid id`);
                if (!bits.length) bits.push('Nothing to block.');
                bits.push(`List would go from ${store.users.length} to ${store.users.length + r.fresh.length}.`);
                preview.innerHTML = bits.join(' · ');
            }

            input.addEventListener('input', refreshPreview);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addBtn.click(); }
            });

            addBtn.addEventListener('click', () => {
                const r = parseIds(input.value);
                if (!r.fresh.length) return;
                addUsers(r.fresh, '');
                input.value = '';
                refreshPreview();
                renderMain();
            });

            addBtnRow.appendChild(addBtn);
            addSection.appendChild(addLabel);
            addSection.appendChild(input);
            addSection.appendChild(preview);
            addSection.appendChild(addBtnRow);
            body.appendChild(addSection);

            // list
            listEl = document.createElement('div');
            listEl.id = 'gpp-blocked-users-list';
            listEl.className = 'gpp-bu-list';
            body.appendChild(listEl);

            bulkBarEl = document.createElement('div');
            bulkBarEl.id = 'gpp-blocked-users-bulkbar';
            bulkBarEl.className = 'gpp-bu-bulkbar';
            bulkBarEl.style.display = 'none';
            body.appendChild(bulkBarEl);

            renderList();
            renderBulkBar();

            // footer
            const selectAll = document.createElement('button');
            selectAll.id = 'gpp-blocked-users-select-all';
            selectAll.type = 'button';
            selectAll.className = 'gpp-bu-btn';
            selectAll.textContent = 'Select all';
            selectAll.disabled = store.users.length === 0;
            selectAll.addEventListener('click', () => {
                if (selected.size === store.users.length) selected.clear();
                else store.users.forEach((u) => selected.add(u.id));
                renderList();
                renderBulkBar();
            });

            const ioBtn = document.createElement('button');
            ioBtn.id = 'gpp-blocked-users-io-btn';
            ioBtn.type = 'button';
            ioBtn.className = 'gpp-bu-btn';
            ioBtn.textContent = 'Import / Export';
            ioBtn.addEventListener('click', renderIo);

            footer.appendChild(selectAll);
            footer.appendChild(ioBtn);
        };

        // ── import / export view ──
        function renderIo() {
            body.innerHTML = '';
            footer.innerHTML = '';
            listEl = null;
            bulkBarEl = null;
            title.textContent = '🚷 Import / Export';

            const status = document.createElement('div');
            status.id = 'gpp-blocked-users-io-status';
            status.className = 'gpp-bu-status';

            const area = document.createElement('textarea');
            area.id = 'gpp-blocked-users-io-textarea';
            area.className = 'gpp-bu-textarea';
            area.rows = 12;
            area.spellcheck = false;

            function reload() { area.value = exportJson(); }
            reload();

            const notesLine = document.createElement('label');
            notesLine.id = 'gpp-blocked-users-io-notes-line';
            notesLine.className = 'gpp-bu-checkline';
            notesLine.style.margin = '8px 0';
            const notesCheck = document.createElement('input');
            notesCheck.id = 'gpp-blocked-users-io-exclude-notes';
            notesCheck.type = 'checkbox';
            notesCheck.checked = store.excludeNotes;
            notesCheck.addEventListener('change', () => {
                store.excludeNotes = notesCheck.checked;
                saveStore();
                reload();
                status.textContent = '';
            });
            const notesText = document.createElement('span');
            notesText.id = 'gpp-blocked-users-io-notes-text';
            notesText.textContent = 'Leave my notes out of the export';
            notesLine.appendChild(notesCheck);
            notesLine.appendChild(notesText);

            const row = document.createElement('div');
            row.id = 'gpp-blocked-users-io-actions';
            row.className = 'gpp-bu-btnrow';

            function mkBtn(id, text, cls, fn) {
                const b = document.createElement('button');
                b.id = id;
                b.type = 'button';
                b.className = 'gpp-bu-btn' + (cls ? ' ' + cls : '');
                b.textContent = text;
                b.addEventListener('click', fn);
                return b;
            }

            row.appendChild(mkBtn('gpp-blocked-users-io-copy', 'Copy', '', async () => {
                try {
                    await navigator.clipboard.writeText(area.value);
                    status.className = 'gpp-bu-status gpp-bu-status-ok';
                    status.textContent = 'Copied to clipboard.';
                } catch {
                    area.select();
                    status.className = 'gpp-bu-status gpp-bu-status-err';
                    status.textContent = 'Clipboard blocked — text selected, press Ctrl+C.';
                }
            }));

            row.appendChild(mkBtn('gpp-blocked-users-io-download', 'Download', '', () => {
                try {
                    const blob = new Blob([area.value], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.id = 'gpp-blocked-users-io-download-link';
                    a.href = url;
                    a.download = 'geopixels-blocklist.json';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    status.className = 'gpp-bu-status gpp-bu-status-ok';
                    status.textContent = 'Downloaded geopixels-blocklist.json';
                } catch (err) {
                    status.className = 'gpp-bu-status gpp-bu-status-err';
                    status.textContent = 'Download failed.';
                }
            }));

            row.appendChild(mkBtn('gpp-blocked-users-io-import', 'Import from text', 'gpp-bu-btn-primary', () => {
                const res = importJson(area.value);
                if (!res.ok) {
                    status.className = 'gpp-bu-status gpp-bu-status-err';
                    status.textContent = res.error;
                    return;
                }
                status.className = 'gpp-bu-status gpp-bu-status-ok';
                status.textContent = `Imported ${res.added} — ${res.skipped} already on the list.`;
                reload();
            }));

            const fileInput = document.createElement('input');
            fileInput.id = 'gpp-blocked-users-io-file';
            fileInput.type = 'file';
            fileInput.accept = 'application/json,.json,text/plain';
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', () => {
                const f = fileInput.files && fileInput.files[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => {
                    area.value = String(reader.result || '');
                    const res = importJson(area.value);
                    if (!res.ok) {
                        status.className = 'gpp-bu-status gpp-bu-status-err';
                        status.textContent = res.error;
                        return;
                    }
                    status.className = 'gpp-bu-status gpp-bu-status-ok';
                    status.textContent = `Imported ${res.added} from ${f.name} — ${res.skipped} already on the list.`;
                    reload();
                };
                reader.onerror = () => {
                    status.className = 'gpp-bu-status gpp-bu-status-err';
                    status.textContent = 'Could not read that file.';
                };
                reader.readAsText(f);
                fileInput.value = '';
            });

            row.appendChild(mkBtn('gpp-blocked-users-io-file-btn', 'Import from file…', '', () => fileInput.click()));

            const hint = document.createElement('div');
            hint.id = 'gpp-blocked-users-io-hint';
            hint.className = 'gpp-bu-count';
            hint.style.marginTop = '8px';
            hint.textContent = 'Importing merges into your list — nothing already blocked is removed or duplicated. '
                + 'A plain array of ids works too.';

            body.appendChild(area);
            body.appendChild(notesLine);
            body.appendChild(row);
            body.appendChild(fileInput);
            body.appendChild(status);
            body.appendChild(hint);

            const back = document.createElement('button');
            back.id = 'gpp-blocked-users-io-back';
            back.type = 'button';
            back.className = 'gpp-bu-btn';
            back.textContent = '← Back to list';
            back.addEventListener('click', renderMain);
            footer.appendChild(back);
        }

        renderMain();

        panel.appendChild(header);
        panel.appendChild(body);
        panel.appendChild(footer);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        if (Number.isInteger(prefillId)) {
            const field = document.getElementById('gpp-blocked-users-id-input');
            if (field) {
                field.value = String(prefillId);
                field.dispatchEvent(new Event('input'));
                field.focus();
            }
        }

        const cleanup = new MutationObserver(() => {
            if (!document.body.contains(overlay)) {
                listEl = null;
                bulkBarEl = null;
                renderMain = null;
                cleanup.disconnect();
            }
        });
        cleanup.observe(document.body, { childList: true });
    }

    // ── pixel-info panel button ──────────────────────────────────
    // Sits immediately left of the native Report flag, inside the same
    // justify-self-end wrapper so the panel's grid-cols-3 layout is untouched.
    // Queues the inspected user into the modal's ID field rather than blocking
    // outright -- a misclick on someone's artwork should not be destructive.
    let hoverBtnUserId = null;

    function createHoverButton() {
        if (document.getElementById(HOVER_BTN_ID)) return true;
        const report = document.getElementById('buttonReport');
        if (!report || !report.parentElement) return false;

        const btn = document.createElement('button');
        btn.id = HOVER_BTN_ID;
        btn.type = 'button';
        btn.title = 'Block this user';
        btn.textContent = '🚷';
        // hoverInfo is a light-only native panel, but dark: variants are
        // included so this stays correct if the site ever themes it.
        btn.className = 'text-gray-400 hover:text-red-500 dark:text-gray-500 '
            + 'dark:hover:text-red-400 cursor-pointer text-2xl mr-1';
        btn.style.display = 'none';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!Number.isInteger(hoverBtnUserId)) return;
            openModal(hoverBtnUserId);
        });

        report.parentElement.insertBefore(btn, report);
        return true;
    }

    function updateHoverButton(detail) {
        const btn = document.getElementById(HOVER_BTN_ID);
        if (!btn) return;
        const id = detail && Number.isInteger(detail.id) ? detail.id : null;
        hoverBtnUserId = id;
        if (id === null) {
            btn.style.display = 'none';
            return;
        }
        btn.style.display = '';
        btn.title = isBlocked(id)
            ? `Already blocked: ${detail.name || 'ID ' + id}`
            : `Block ${detail.name || 'ID ' + id}`;
        btn.style.opacity = isBlocked(id) ? '0.45' : '1';
    }

    function init() {
        installBridge();
        pushToBridge();

        document.addEventListener('gpp:pixelUserInspected', (e) => updateHoverButton(e.detail));

        if (createHoverButton()) return;
        const observer = new MutationObserver(() => {
            if (createHoverButton()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 15000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Consumed by core.js for the GeoPixelcons++ dropdown entry.
    _blockedUsers = { openModal };

            })();
            _featureStatus.extBlockedUsers = 'ok';
            console.log('[GeoPixelcons++] ✅ Blocked User List loaded');
        } catch (err) {
            _featureStatus.extBlockedUsers = 'error';
            dbgPush(`Blocked User List init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Blocked User List' });
            console.error('[GeoPixelcons++] ❌ Blocked User List failed:', err);
        }
    }
