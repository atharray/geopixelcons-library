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
    //  Element ids in this feature all use the gpp- prefix (current standard).
    //
    if (_settings.extBlockedUsers) {
        try {
            (function _ext_blockedUsers() {

    const STORE_KEY   = 'gpc-blocked-users-v1';
    const MODAL_ID    = 'gpp-blocked-users-modal';
    const HOVER_BTN_ID = 'gpp-blocked-users-hover-btn';
    const BRIDGE_FLAG = '__gpcBlockedUsersBridge';

    const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // ── persistence ──────────────────────────────────────────────
    // { mode: 'hide'|'highlight', users: [{ id, name }] }
    function loadStore() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return { mode: 'hide', users: [] };
            const parsed = JSON.parse(raw);
            return {
                mode: parsed.mode === 'highlight' ? 'highlight' : 'hide',
                users: Array.isArray(parsed.users)
                    ? parsed.users
                        .map((u) => ({ id: Number(u.id), name: String(u.name || '') }))
                        .filter((u) => Number.isInteger(u.id) && u.id >= 0)
                    : [],
            };
        } catch {
            return { mode: 'hide', users: [] };
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

var state = { ids: new Set(), mode: 'hide', patched: false, lastInspected: null };
var HL = [239, 68, 68];            // red-500, used by highlight mode

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
    if (state.ids.size === 0) return source;
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
    state.ids.forEach(function (id) { if (idx.ids.has(id)) hit = true; });
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
            if (!state.ids.has(id)) continue;
            if (highlight) {
                c[i] = HL[0]; c[i + 1] = HL[1]; c[i + 2] = HL[2]; c[i + 3] = 255;
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
    setIds: function (arr, mode) {
        state.ids = new Set((arr || []).map(Number).filter(function (n) {
            return Number.isInteger(n);
        }));
        state.mode = mode === 'highlight' ? 'highlight' : 'hide';
        patchLayer();
        refresh();
    },
    lastInspected: function () { return state.lastInspected; },
    stats: function () {
        return { patched: state.patched, blocked: state.ids.size, mode: state.mode,
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

    function pushToBridge() {
        try {
            const api = _pw.__gpcBlockedUsers;
            if (api && typeof api.setIds === 'function') {
                api.setIds(store.users.map((u) => u.id), store.mode);
            }
        } catch (err) {
            dbgPush(`Blocked Users bridge push failed: ${err && err.message ? err.message : String(err)}`,
                { error: err, uiComponent: 'Blocked User List' });
        }
    }

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

    function addUser(id, name) {
        if (!Number.isInteger(id) || id < 0 || isBlocked(id)) return false;
        store.users.push({ id, name: name || '' });
        saveStore();
        pushToBridge();
        if (!name) {
            resolveName(id).then((n) => {
                if (!n) return;
                const hit = store.users.find((u) => u.id === id);
                if (!hit) return;
                hit.name = n;
                saveStore();
                renderList();
            });
        }
        return true;
    }

    function removeUser(id) {
        const before = store.users.length;
        store.users = store.users.filter((u) => u.id !== id);
        if (store.users.length === before) return;
        saveStore();
        pushToBridge();
    }

    // ── modal ────────────────────────────────────────────────────
    let listEl = null;

    function themeColors() {
        const dark = document.body.classList.contains('dark')
            || window.matchMedia('(prefers-color-scheme: dark)').matches;
        return {
            dark,
            panel:    dark ? '#1e1e2e' : '#ffffff',
            header:   dark ? '#313244' : '#f1f5f9',
            border:   dark ? '#45475a' : '#e2e8f0',
            text:     dark ? '#cdd6f4' : '#1e293b',
            muted:    dark ? '#9399b2' : '#64748b',
            field:    dark ? '#181825' : '#f8fafc',
            primaryBg:   dark ? '#89b4fa' : '#3b82f6',
            primaryFg:   dark ? '#1e1e2e' : '#ffffff',
            secondaryBg: dark ? '#585b70' : '#e2e8f0',
            secondaryFg: dark ? '#cdd6f4' : '#1e293b',
            danger:   dark ? '#f38ba8' : '#dc2626',
        };
    }

    function renderList() {
        if (!listEl) return;
        const c = themeColors();
        listEl.innerHTML = '';

        if (store.users.length === 0) {
            const empty = document.createElement('div');
            empty.id = 'gpp-blocked-users-empty';
            empty.textContent = 'No blocked users yet.';
            Object.assign(empty.style, {
                padding: '18px 12px', textAlign: 'center', color: c.muted, fontSize: '13px',
            });
            listEl.appendChild(empty);
            return;
        }

        store.users.forEach((u) => {
            const row = document.createElement('div');
            row.id = `gpp-blocked-users-row-${u.id}`;
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 10px', borderBottom: `1px solid ${c.border}`,
            });

            const label = document.createElement('div');
            label.id = `gpp-blocked-users-label-${u.id}`;
            label.style.flex = '1';
            label.style.minWidth = '0';

            const nameLine = document.createElement('div');
            nameLine.id = `gpp-blocked-users-name-${u.id}`;
            nameLine.textContent = u.name || '(unknown name)';
            Object.assign(nameLine.style, {
                color: c.text, fontSize: '13px', fontWeight: '600',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            });

            const idLine = document.createElement('div');
            idLine.id = `gpp-blocked-users-id-${u.id}`;
            idLine.textContent = `ID ${u.id}`;
            Object.assign(idLine.style, { color: c.muted, fontSize: '11px', fontFamily: 'monospace' });

            label.appendChild(nameLine);
            label.appendChild(idLine);

            const rm = document.createElement('button');
            rm.id = `gpp-blocked-users-remove-${u.id}`;
            rm.type = 'button';
            rm.textContent = 'Remove';
            Object.assign(rm.style, {
                background: c.secondaryBg, color: c.secondaryFg, border: 'none',
                borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
            });
            rm.addEventListener('click', () => { removeUser(u.id); renderList(); });

            row.appendChild(label);
            row.appendChild(rm);
            listEl.appendChild(row);
        });
    }

    // prefillId: queue a user in the ID field without blocking them yet.
    function openModal(prefillId) {
        const existing = document.getElementById(MODAL_ID);
        if (existing) {
            // Re-opening with a queued user should load it, not toggle shut.
            if (Number.isInteger(prefillId)) {
                const field = document.getElementById('gpp-blocked-users-id-input');
                if (field) { field.value = String(prefillId); field.focus(); field.select(); }
                return;
            }
            existing.remove();
            return;
        }

        const c = themeColors();

        const overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '100000',
            background: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontFamily: 'system-ui,-apple-system,sans-serif',
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const panel = document.createElement('div');
        panel.id = 'gpp-blocked-users-panel';
        Object.assign(panel.style, {
            width: 'min(460px, 92vw)', maxHeight: '82vh', display: 'flex', flexDirection: 'column',
            background: c.panel, borderRadius: '12px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden',
        });

        // header
        const header = document.createElement('div');
        header.id = 'gpp-blocked-users-header';
        Object.assign(header.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', background: c.header, borderBottom: `1px solid ${c.border}`,
        });
        const title = document.createElement('div');
        title.id = 'gpp-blocked-users-title';
        title.textContent = '🚷 Blocked User List';
        Object.assign(title.style, { color: c.text, fontWeight: '700', fontSize: '14px' });
        const close = document.createElement('button');
        close.id = 'gpp-blocked-users-close';
        close.type = 'button';
        close.textContent = '✕';
        Object.assign(close.style, {
            background: 'transparent', border: 'none', color: c.muted,
            fontSize: '16px', cursor: 'pointer', lineHeight: '1',
        });
        close.addEventListener('click', () => overlay.remove());
        header.appendChild(title);
        header.appendChild(close);

        // body
        const body = document.createElement('div');
        body.id = 'gpp-blocked-users-body';
        Object.assign(body.style, { padding: '14px 16px', overflowY: 'auto' });

        const blurb = document.createElement('div');
        blurb.id = 'gpp-blocked-users-blurb';
        blurb.textContent = 'Pixels last placed by these users are hidden or highlighted on your screen only. '
            + 'This changes nothing for anyone else and does not stop them painting.';
        Object.assign(blurb.style, { color: c.muted, fontSize: '12px', lineHeight: '1.5', marginBottom: '12px' });

        // mode toggle
        const modeWrap = document.createElement('div');
        modeWrap.id = 'gpp-blocked-users-mode';
        Object.assign(modeWrap.style, { display: 'flex', gap: '8px', marginBottom: '14px' });
        const modeBtns = {};
        [['hide', 'Hide their pixels'], ['highlight', 'Highlight in red']].forEach(([key, text]) => {
            const b = document.createElement('button');
            b.id = `gpp-blocked-users-mode-${key}`;
            b.type = 'button';
            b.textContent = text;
            Object.assign(b.style, {
                flex: '1', border: 'none', borderRadius: '8px',
                padding: '8px 10px', fontSize: '12px', cursor: 'pointer',
            });
            b.addEventListener('click', () => {
                store.mode = key;
                saveStore();
                pushToBridge();
                paintModeButtons();
            });
            modeBtns[key] = b;
            modeWrap.appendChild(b);
        });
        function paintModeButtons() {
            Object.entries(modeBtns).forEach(([key, b]) => {
                const on = store.mode === key;
                b.style.background = on ? c.primaryBg : c.secondaryBg;
                b.style.color = on ? c.primaryFg : c.secondaryFg;
                b.style.fontWeight = on ? '700' : '500';
            });
        }
        paintModeButtons();

        // add-by-id row
        const addWrap = document.createElement('div');
        addWrap.id = 'gpp-blocked-users-add';
        Object.assign(addWrap.style, { display: 'flex', gap: '8px', marginBottom: '14px' });

        const input = document.createElement('input');
        input.id = 'gpp-blocked-users-id-input';
        input.type = 'text';
        input.placeholder = 'User ID';
        input.inputMode = 'numeric';
        Object.assign(input.style, {
            flex: '1', minWidth: '0', background: c.field, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: '8px',
            padding: '8px 10px', fontSize: '13px', fontFamily: 'monospace',
        });

        const addBtn = document.createElement('button');
        addBtn.id = 'gpp-blocked-users-add-btn';
        addBtn.type = 'button';
        addBtn.textContent = 'Block';
        Object.assign(addBtn.style, {
            background: c.primaryBg, color: c.primaryFg, border: 'none',
            borderRadius: '8px', padding: '8px 16px', fontSize: '13px',
            fontWeight: '600', cursor: 'pointer',
        });
        function commitAdd() {
            const id = Number(input.value.trim());
            if (!Number.isInteger(id) || id < 0) {
                input.style.borderColor = c.danger;
                setTimeout(() => { input.style.borderColor = c.border; }, 1200);
                return;
            }
            addUser(id, '');
            input.value = '';
            renderList();
        }
        addBtn.addEventListener('click', commitAdd);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitAdd(); });

        addWrap.appendChild(input);
        addWrap.appendChild(addBtn);

        // list
        listEl = document.createElement('div');
        listEl.id = 'gpp-blocked-users-list';
        Object.assign(listEl.style, {
            border: `1px solid ${c.border}`, borderRadius: '8px', overflow: 'hidden',
        });

        body.appendChild(blurb);
        body.appendChild(modeWrap);
        body.appendChild(addWrap);
        body.appendChild(listEl);

        panel.appendChild(header);
        panel.appendChild(body);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        renderList();

        if (Number.isInteger(prefillId)) {
            input.value = String(prefillId);
            input.focus();
            input.select();
        }

        const cleanup = new MutationObserver(() => {
            if (!document.body.contains(overlay)) {
                listEl = null;
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
