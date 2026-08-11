
    // ============================================================
    //  EXTENSION: Mobile Painting [mobilePaintingExtension]
    // ============================================================
    // In-development extension. Implementation is intentionally being built
    // up in small, explicitly-requested increments -- do not add behavior
    // here beyond what has actually been asked for.
    if (_settings.mobilePaintingExtension) {
        try {
            (function _ext_mobilePainting() {

    const MP_STYLE_ID = 'gpc-mobile-painting-style';

    // Reuses Ghost++'s own .gpp-palette-grid / .gpp-swatch class names and
    // rules (see gpp-palette.js) so this looks identical to the real Ghost++
    // palette. Trimmed to just the grid + on/off swatch state -- no search,
    // sort, or bulk-action chrome, since this renders inline in the compact
    // bottom paint bar rather than the full Ghost++ manager panel.
    function injectStyle() {
        if (document.getElementById(MP_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = MP_STYLE_ID;
        style.textContent = `
            .gpc-mobile-palette-wrap { width: 100%; box-sizing: border-box; }
            .gpp-palette-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(26px, 1fr));
                grid-auto-rows: minmax(26px, 1fr);
                gap: 3px; max-height: 260px; overflow-y: auto; padding: 2px;
                width: 100%; box-sizing: border-box;
                scrollbar-gutter: stable;
            }
            .gpp-swatch {
                position: relative; aspect-ratio: 1 / 1; min-height: 15px; border-radius: 4px;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                padding: 0; transition: transform .08s ease;
            }
            .gpp-swatch:hover { transform: scale(1.15); z-index: 2; }
            .gpp-swatch.gpp-swatch-off { filter: grayscale(.7) opacity(.4); }
            .gpp-swatch.gpp-swatch-off::after {
                content: ''; position: absolute; inset: 0; pointer-events: none;
                border-radius: inherit;
                background: linear-gradient(to top right,
                    transparent calc(50% - 1px), rgba(50,50,50,.75) calc(50% - 1px),
                    rgba(50,50,50,.75) calc(50% + 1px), transparent calc(50% + 1px));
            }
        `;
        document.head.appendChild(style);
    }

    function applyFullWidthBottomControls(bottomControls) {
        bottomControls.style.width = '100vw';
        bottomControls.style.maxWidth = '100vw';
        bottomControls.style.left = '0';
        bottomControls.style.right = '0';
        bottomControls.style.transform = 'none';
    }

    function getFocusedTemplateWithPalette() {
        if (typeof gppState === 'undefined' || typeof gppState.getFocusedTemplate !== 'function') return null;
        const template = gppState.getFocusedTemplate();
        return (template && template.palette && template.palette.length) ? template : null;
    }

    function setSwatchState(swatch, hex, enabled) {
        swatch.classList.toggle('gpp-swatch-off', !enabled);
        swatch.setAttribute('aria-pressed', String(enabled));
        swatch.setAttribute('aria-label', `${enabled ? 'Hide' : 'Show'} ${hex}`);
    }

    // Builds a grid of the CURRENTLY FOCUSED Ghost++ template's own colors --
    // not GeoPixels' native default palette. Clicking a swatch here is NOT a
    // plain per-color toggle like Ghost++'s own grid -- per explicit product
    // decision, it "solos" that color (enable it, disable every other color
    // in this template's overlay via core.maskSet) AND selects it as the
    // active native paint color via changeColor(hex), so a mobile painter
    // taps one swatch to both see only that color's remaining pixels on the
    // map and be ready to paint them immediately. State (template.mask) and
    // persistence/redraw (gppState.persistTemplateState, gppRendererSchedule)
    // are still the same real Ghost++ state, not a separate copy -- and
    // gppRequestUiRefresh() is called afterward so an already-open Ghost++
    // modal reflects the solo immediately too, not just on its next poll.
    function buildTemplatePaletteGrid(template) {
        injectStyle();
        const core = gppCreateCore();

        const wrap = document.createElement('div');
        wrap.className = 'gpc-mobile-palette-wrap';

        const grid = document.createElement('div');
        grid.className = 'gpp-palette-grid';

        function soloColor(targetIndex, hex) {
            for (let index = 0; index < template.palette.length; index++) {
                core.maskSet(template.mask, index, index === targetIndex);
            }
            const swatches = grid.children;
            for (let index = 0; index < swatches.length; index++) {
                setSwatchState(swatches[index], swatches[index].title, index === targetIndex);
            }
            if (typeof window.changeColor === 'function') window.changeColor(hex);
            gppState.persistTemplateState(template).catch((err) => {
                console.error('[GeoPixelcons++] Mobile Painting: failed to persist template state', err);
            });
            if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
            if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        }

        const paletteLength = template.palette ? template.palette.length : 0;
        for (let index = 0; index < paletteLength; index++) {
            const hex = core.packedToHex(template.palette[index]);
            const enabled = core.maskHas(template.mask, index);

            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.style.backgroundColor = hex;
            swatch.title = hex;
            setSwatchState(swatch, hex, enabled);
            swatch.addEventListener('click', () => soloColor(index, hex));
            grid.appendChild(swatch);
        }

        wrap.appendChild(grid);
        return wrap;
    }

    // ── Live sync ────────────────────────────────────────────────────────
    // Keeps the inline grid matching Ghost++'s real state after the initial
    // swap: switching the focused template, or toggling a color's show/hide
    // from the actual Ghost++ modal, both need to be reflected here too.
    //
    // Two sources feed the same resync() function:
    //   1. gppSubscribeUiRefresh() -- gpp-init.js's real external-refresh
    //      hook. Confirmed to fire on a palette mask toggle (gpp-palette.js's
    //      setSwatchMaskState calls gppRequestUiRefresh() directly), so a
    //      color toggled from the real modal reaches this near-instantly.
    //   2. A 1s poll fallback -- gpp-library.js's "switch focused template"
    //      click handlers only call their own local refreshAll() (via the
    //      onChange callback), never gppRequestUiRefresh(), so that specific
    //      path does NOT reach subscribers. Polling is the only reliable way
    //      to catch it without patching Ghost++'s own template-library code.
    let liveState = null; // { bottomControls, savedNativeContainer, wrap, grid, templateId, paletteLength }

    function resync() {
        if (!liveState) return;
        const template = getFocusedTemplateWithPalette();

        if (!template) {
            if (liveState.wrap) {
                liveState.wrap.replaceWith(liveState.savedNativeContainer);
                dbgPush('Mobile Painting: no focused Ghost++ template anymore -- restored the native color grid.', { uiComponent: 'Mobile Painting' });
                liveState.wrap = null;
                liveState.grid = null;
                liveState.templateId = null;
                liveState.paletteLength = null;
            }
            return;
        }

        const sameTemplate = liveState.grid && liveState.templateId === template.id && liveState.paletteLength === template.palette.length;
        if (sameTemplate) {
            const core = gppCreateCore();
            const swatches = liveState.grid.children;
            for (let index = 0; index < swatches.length; index++) {
                const swatch = swatches[index];
                const enabled = core.maskHas(template.mask, index);
                if (swatch.classList.contains('gpp-swatch-off') === enabled) {
                    setSwatchState(swatch, swatch.title, enabled);
                }
            }
            return;
        }

        const replacement = buildTemplatePaletteGrid(template);
        (liveState.wrap || liveState.savedNativeContainer).replaceWith(replacement);
        liveState.wrap = replacement;
        liveState.grid = replacement.querySelector('.gpp-palette-grid');
        liveState.templateId = template.id;
        liveState.paletteLength = template.palette.length;
        dbgPush('Mobile Painting: (re)built palette grid for template "' + template.id + '" (' + template.palette.length + ' colors).', { uiComponent: 'Mobile Painting' });
    }

    function mount(bottomControls) {
        applyFullWidthBottomControls(bottomControls);
        dbgPush('Mobile Painting: #bottomControls found -- applied full-width layout.', { uiComponent: 'Mobile Painting' });

        const nativeContainer = bottomControls.querySelector('.control-container-colors');
        if (!nativeContainer) {
            dbgPush('Mobile Painting: no .control-container-colors found inside #bottomControls -- nothing to replace.', { uiComponent: 'Mobile Painting' });
            return;
        }

        liveState = { bottomControls, savedNativeContainer: nativeContainer, wrap: null, grid: null, templateId: null, paletteLength: null };

        // Ghost++'s template library loads from IndexedDB asynchronously (see
        // gppInitRuntime()), and may not be settings-enabled at all -- retry
        // for the same 15s window the rest of this codebase uses rather than
        // giving up after a single check.
        resync();
        if (!liveState.grid) {
            const retryInterval = setInterval(() => {
                resync();
                if (liveState.grid) clearInterval(retryInterval);
            }, 500);
            setTimeout(() => {
                clearInterval(retryInterval);
                if (!liveState.grid) {
                    dbgPush('Mobile Painting: gave up after 15s -- no focused Ghost++ template with a decoded palette was found; left the native color grid in place.', { uiComponent: 'Mobile Painting' });
                }
            }, 15000);
        }

        if (typeof gppSubscribeUiRefresh === 'function') gppSubscribeUiRefresh(() => resync());
        setInterval(() => resync(), 1000);
    }

    const existing = document.getElementById('bottomControls');
    if (existing) {
        mount(existing);
    } else {
        const watchStartedAt = Date.now();
        const observer = new MutationObserver(() => {
            const el = document.getElementById('bottomControls');
            if (el) {
                observer.disconnect();
                dbgPush('Mobile Painting: #bottomControls appeared ' + (Date.now() - watchStartedAt) + 'ms after watching started -- mounting now.', { uiComponent: 'Mobile Painting' });
                mount(el);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            if (!document.getElementById('bottomControls')) {
                dbgPush('Mobile Painting: gave up after 15s -- #bottomControls was never found.', { uiComponent: 'Mobile Painting' });
                console.error('[GeoPixelcons++] Mobile Painting: never found #bottomControls.');
            }
        }, 15000);
    }

            })();
            _featureStatus.mobilePaintingExtension = 'ok';
            console.log('[GeoPixelcons++] ✅ Mobile Painting loaded');
        } catch (err) {
            _featureStatus.mobilePaintingExtension = 'error';
            dbgPush(`Mobile Painting init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Mobile Painting' });
            console.error('[GeoPixelcons++] ❌ Mobile Painting failed:', err);
        }
    }
