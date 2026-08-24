    // ============================================================
    //  EXTENSION: Canvas Visibility Toggle [extCanvasToggle]
    // ============================================================
    //
    //  Hides or shows the entire pixel canvas, leaving the base map visible.
    //
    //  Deliberately NOT built on the Blocked User List machinery, even though
    //  "hide everyone" sounds like the same problem. That path decodes a
    //  1000x1000 user-id bitmap and rebuilds every texel per tile; using it to
    //  produce nothing but transparent tiles would be the most expensive
    //  possible way to reach an empty screen.
    //
    //  PixelTileLayer already carries the answer: a `u_opacity` uniform,
    //  applied once per tile per frame (js/pixel-tile-layer.js). Setting
    //  pixelTileLayer.opacity = 0 and asking for a repaint costs one uniform
    //  write and no per-pixel work at all, and it is instantly reversible
    //  because no texture is ever modified.
    //
    //  Because it is a float rather than a flag, partial fades come free --
    //  ALT-click cycles through 50% and 25% for tracing over existing art.
    //
    //  Not persisted across reloads on purpose: a canvas that is still hidden
    //  after a refresh reads as "the site is broken", and the recovery is
    //  non-obvious if you have forgotten the button exists.
    //
    if (_settings.extCanvasToggle) {
        try {
            (function _ext_canvasToggle() {

    const BUTTON_ID   = 'gpp-canvas-toggle-btn';
    const BRIDGE_FLAG = '__gpcCanvasToggleBridge';
    const STEPS = [1, 0, 0.5, 0.25];   // click cycles 1<->0; alt-click walks all

    const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // ── page-realm bridge ────────────────────────────────────────
    // pixelTileLayer is a top-level `let` in index.js, invisible to
    // unsafeWindow property access, so this has to run as a classic <script>
    // in the page's own lexical scope -- same technique as
    // ext-map-movement-lock.js and the Blocked User List.
    function installBridge() {
        if (_pw[BRIDGE_FLAG]) return;
        const script = document.createElement('script');
        script.textContent = `
(function(){
if (window.${BRIDGE_FLAG}) return;
window.${BRIDGE_FLAG} = true;

window.__gpcCanvasToggle = {
    set: function (value) {
        try {
            if (typeof pixelTileLayer === 'undefined' || !pixelTileLayer) return false;
            var v = Number(value);
            if (!(v >= 0 && v <= 1)) return false;
            pixelTileLayer.opacity = v;
            if (typeof map !== 'undefined' && map && typeof map.triggerRepaint === 'function') {
                map.triggerRepaint();
            }
            return true;
        } catch (e) { return false; }
    },
    get: function () {
        try {
            if (typeof pixelTileLayer === 'undefined' || !pixelTileLayer) return null;
            return pixelTileLayer.opacity;
        } catch (e) { return null; }
    }
};
})();`;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }

    let opacity = 1;

    function apply() {
        try {
            const api = _pw.__gpcCanvasToggle;
            if (api && typeof api.set === 'function') api.set(opacity);
        } catch (err) {
            dbgPush(`Canvas Toggle apply failed: ${err && err.message ? err.message : String(err)}`,
                { error: err, uiComponent: 'Canvas Visibility Toggle' });
        }
        renderButton();
    }

    const EYE_OPEN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 '
        + '9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>'
        + '<line x1="1" y1="1" x2="23" y2="23"/></svg>';

    function renderButton() {
        const btn = document.getElementById(BUTTON_ID);
        if (!btn) return;
        const hidden = opacity < 1;
        btn.innerHTML = hidden ? EYE_OFF : EYE_OPEN;
        btn.style.opacity = hidden ? '0.75' : '1';
        btn.title = opacity === 1 ? 'Hide pixel canvas (Alt-click to fade)'
            : opacity === 0 ? 'Show pixel canvas'
            : `Canvas at ${Math.round(opacity * 100)}% — click to show, Alt-click to cycle`;
    }

    function createButton(dropdown) {
        if (document.getElementById(BUTTON_ID)) return true;

        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        // Matches the native Image Tools siblings exactly (toggleDitherer,
        // loadGhostImageBtn) so it reads as part of that dropdown.
        btn.className = 'w-10 h-10 bg-white dark:bg-gray-700 shadow rounded-full flex items-center '
            + 'justify-center hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer '
            + 'text-gray-700 dark:text-gray-200 border-0';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.altKey) {
                const i = STEPS.indexOf(opacity);
                opacity = STEPS[(i < 0 ? 0 : i + 1) % STEPS.length];
            } else {
                opacity = opacity === 1 ? 0 : 1;
            }
            apply();
        });

        dropdown.appendChild(btn);
        renderButton();
        return true;
    }

    function init() {
        installBridge();

        const dropdown = document.getElementById('imageGroupDropdown');
        if (dropdown) { createButton(dropdown); return; }

        const observer = new MutationObserver(() => {
            const d = document.getElementById('imageGroupDropdown');
            if (!d) return;
            observer.disconnect();
            createButton(d);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

            })();
            _featureStatus.extCanvasToggle = 'ok';
            console.log('[GeoPixelcons++] ✅ Canvas Visibility Toggle loaded');
        } catch (err) {
            _featureStatus.extCanvasToggle = 'error';
            dbgPush(`Canvas Visibility Toggle init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Canvas Visibility Toggle' });
            console.error('[GeoPixelcons++] ❌ Canvas Visibility Toggle failed:', err);
        }
    }
