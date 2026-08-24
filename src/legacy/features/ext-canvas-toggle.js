    // ============================================================
    //  EXTENSION: Canvas Visibility Toggle [extCanvasToggle]
    // ============================================================
    //
    //  Fades or hides the entire pixel canvas, leaving the base map visible.
    //
    //  Deliberately NOT built on the Blocked User List machinery, even though
    //  "hide everyone" sounds like the same problem. That path decodes a
    //  1000x1000 user-id bitmap and rebuilds every texel per tile; using it to
    //  produce nothing but transparent tiles would be the most expensive
    //  possible way to reach an empty screen.
    //
    //  PixelTileLayer already carries the answer: a `u_opacity` uniform,
    //  applied once per tile per frame (js/pixel-tile-layer.js). Setting
    //  pixelTileLayer.opacity and asking for a repaint costs one uniform write
    //  and no per-pixel work at all, and it is instantly reversible because no
    //  texture is ever modified. Being a float rather than a flag, arbitrary
    //  fades cost exactly what a full hide costs -- handy for tracing over
    //  existing art.
    //
    //  Not persisted across reloads on purpose: a canvas that is still hidden
    //  after a refresh reads as "the site is broken", and the recovery is
    //  non-obvious if you have forgotten the button exists.
    //
    if (_settings.extCanvasToggle) {
        try {
            (function _ext_canvasToggle() {

    const BUTTON_ID   = 'gpp-canvas-toggle-btn';
    const WRAP_ID     = 'gpp-canvas-toggle-wrap';
    const POPOVER_ID  = 'gpp-canvas-toggle-popover';
    const STYLE_ID    = 'gpp-canvas-toggle-style';
    const BRIDGE_FLAG = '__gpcCanvasToggleBridge';

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
        renderPopover();
    }

    const EYE_OPEN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 '
        + '9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>'
        + '<line x1="1" y1="1" x2="23" y2="23"/></svg>';

    // Matches the Blocked User List / Ghost++ palette so the two fade controls
    // in GeoPixelcons++ look and behave identically.
    function injectStyle() {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            document.head.appendChild(style);
        }
        style.textContent = `
            #${WRAP_ID} { position: relative; }
            #${POPOVER_ID} {
                position: absolute; left: calc(100% + 8px); top: 0; z-index: 100000;
                display: none; align-items: center; gap: 6px;
                padding: 7px 9px; border-radius: 8px;
                background: ${t('#ffffff', '#1e1e2e')}; color: ${t('#111827', '#f5f5f5')};
                border: 1px solid ${t('#d1d5db', '#45475a')};
                box-shadow: 0 8px 24px ${t('rgba(15,23,42,.22)', 'rgba(0,0,0,.55)')};
                font-family: system-ui,-apple-system,sans-serif;
            }
            #${POPOVER_ID}.gpp-ct-open { display: flex; }
            .gpp-ct-end {
                background: none; border: none; cursor: pointer; padding: 1px;
                display: flex; align-items: center; flex-shrink: 0;
                color: ${t('#94a3b8', '#6c7086')};
            }
            .gpp-ct-end:hover { color: ${t('#2563eb', '#89b4fa')}; }
            .gpp-ct-end-active { color: ${t('#2563eb', '#89b4fa')}; }
            .gpp-ct-slider {
                width: 120px; height: 4px; -webkit-appearance: none; appearance: none;
                border-radius: 2px; cursor: pointer; margin: 0;
                background: ${t('#e5e7eb', '#313244')};
            }
            .gpp-ct-slider::-webkit-slider-thumb {
                -webkit-appearance: none; appearance: none;
                width: 12px; height: 12px; border-radius: 50%; cursor: pointer;
                background: ${t('#2563eb', '#89b4fa')};
                border: 2px solid ${t('#ffffff', '#1e1e2e')};
            }
            .gpp-ct-slider::-moz-range-thumb {
                width: 12px; height: 12px; border-radius: 50%; cursor: pointer; border: none;
                background: ${t('#2563eb', '#89b4fa')};
            }
            .gpp-ct-pct {
                font-size: 10px; font-family: ui-monospace,Consolas,monospace;
                color: ${t('#64748b', '#a6adc8')};
                width: 30px; text-align: right; flex-shrink: 0;
            }
        `;
    }

    function renderButton() {
        const btn = document.getElementById(BUTTON_ID);
        if (!btn) return;
        const faded = opacity < 1;
        btn.innerHTML = faded ? EYE_OFF : EYE_OPEN;
        btn.style.opacity = faded ? '0.75' : '1';
        btn.title = opacity === 1 ? 'Pixel canvas visibility'
            : opacity === 0 ? 'Pixel canvas hidden — click to adjust'
            : `Pixel canvas at ${Math.round(opacity * 100)}% — click to adjust`;
    }

    function renderPopover() {
        const pop = document.getElementById(POPOVER_ID);
        if (!pop) return;
        const slider = document.getElementById('gpp-canvas-toggle-slider');
        const pct = document.getElementById('gpp-canvas-toggle-pct');
        const hideBtn = document.getElementById('gpp-canvas-toggle-hide');
        const showBtn = document.getElementById('gpp-canvas-toggle-show');
        if (slider) slider.value = String(Math.round(opacity * 100));
        if (pct) pct.textContent = `${Math.round(opacity * 100)}%`;
        if (hideBtn) hideBtn.classList.toggle('gpp-ct-end-active', opacity <= 0);
        if (showBtn) showBtn.classList.toggle('gpp-ct-end-active', opacity >= 1);
    }

    function buildPopover() {
        const pop = document.createElement('div');
        pop.id = POPOVER_ID;

        const hideBtn = document.createElement('button');
        hideBtn.id = 'gpp-canvas-toggle-hide';
        hideBtn.type = 'button';
        hideBtn.className = 'gpp-ct-end';
        hideBtn.innerHTML = EYE_OFF;
        hideBtn.title = 'Hide the canvas completely';
        hideBtn.addEventListener('click', (e) => { e.stopPropagation(); opacity = 0; apply(); });

        const slider = document.createElement('input');
        slider.id = 'gpp-canvas-toggle-slider';
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.step = '1';
        slider.className = 'gpp-ct-slider';
        slider.addEventListener('input', (e) => {
            e.stopPropagation();
            opacity = Number(slider.value) / 100;
            apply();
        });
        slider.addEventListener('click', (e) => e.stopPropagation());

        const showBtn = document.createElement('button');
        showBtn.id = 'gpp-canvas-toggle-show';
        showBtn.type = 'button';
        showBtn.className = 'gpp-ct-end';
        showBtn.innerHTML = EYE_OPEN;
        showBtn.title = 'Show the canvas fully';
        showBtn.addEventListener('click', (e) => { e.stopPropagation(); opacity = 1; apply(); });

        const pct = document.createElement('span');
        pct.id = 'gpp-canvas-toggle-pct';
        pct.className = 'gpp-ct-pct';

        pop.appendChild(hideBtn);
        pop.appendChild(slider);
        pop.appendChild(showBtn);
        pop.appendChild(pct);
        return pop;
    }

    function closePopover() {
        const pop = document.getElementById(POPOVER_ID);
        if (pop) pop.classList.remove('gpp-ct-open');
    }

    function createButton(dropdown) {
        if (document.getElementById(BUTTON_ID)) return true;

        // The native dropdown is a flex column of round buttons; wrapping ours
        // keeps it in that flow while giving the popover something positioned
        // to anchor against.
        const wrap = document.createElement('div');
        wrap.id = WRAP_ID;

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
            const pop = document.getElementById(POPOVER_ID);
            if (!pop) return;
            pop.classList.toggle('gpp-ct-open');
            renderPopover();
        });

        const pop = buildPopover();

        wrap.appendChild(btn);
        wrap.appendChild(pop);
        dropdown.appendChild(wrap);

        document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target)) closePopover();
        });

        renderButton();
        renderPopover();
        return true;
    }

    function init() {
        installBridge();
        injectStyle();

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
