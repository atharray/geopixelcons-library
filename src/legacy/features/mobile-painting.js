
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

    // Builds a grid of the CURRENTLY FOCUSED Ghost++ template's own colors --
    // not GeoPixels' native default palette -- reusing the real per-color
    // enabled/disabled state (template.mask) and toggle behavior
    // (core.maskToggle + gppState.persistTemplateState + gppRendererSchedule)
    // that Ghost++'s own palette grid uses, so clicking a swatch here shows/
    // hides that color in the ghost overlay exactly like the real Ghost++
    // manager does -- this is genuinely the same underlying state, just a
    // more compact rendering of it, not a separate copy that can drift out
    // of sync.
    function buildTemplatePaletteGrid(template) {
        injectStyle();
        const core = gppCreateCore();

        const wrap = document.createElement('div');
        wrap.className = 'gpc-mobile-palette-wrap';

        const grid = document.createElement('div');
        grid.className = 'gpp-palette-grid';

        const paletteLength = template.palette ? template.palette.length : 0;
        for (let index = 0; index < paletteLength; index++) {
            const hex = core.packedToHex(template.palette[index]);
            const enabled = core.maskHas(template.mask, index);

            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'gpp-swatch' + (enabled ? '' : ' gpp-swatch-off');
            swatch.style.backgroundColor = hex;
            swatch.title = hex;
            swatch.setAttribute('aria-pressed', String(enabled));
            swatch.setAttribute('aria-label', `${enabled ? 'Hide' : 'Show'} ${hex}`);
            swatch.addEventListener('click', () => {
                const nowEnabled = core.maskToggle(template.mask, index);
                swatch.classList.toggle('gpp-swatch-off', !nowEnabled);
                swatch.setAttribute('aria-pressed', String(nowEnabled));
                swatch.setAttribute('aria-label', `${nowEnabled ? 'Hide' : 'Show'} ${hex}`);
                gppState.persistTemplateState(template).catch((err) => {
                    console.error('[GeoPixelcons++] Mobile Painting: failed to persist template state', err);
                });
                if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
            });
            grid.appendChild(swatch);
        }

        wrap.appendChild(grid);
        return wrap;
    }

    // Swaps GeoPixels' native `.control-container-colors` block (flat grid of
    // every default paint color) for the focused Ghost++ template's own
    // color grid, styled identically to Ghost++'s real palette. Requires
    // Ghost++ to be enabled AND have a focused template with a decoded
    // palette -- if neither is true yet, the native grid is left alone
    // rather than showing an empty box (this is watched/retried below, not
    // just checked once, since Ghost++'s template library loads from
    // IndexedDB asynchronously after #bottomControls itself mounts).
    function getFocusedTemplateWithPalette() {
        if (typeof gppState === 'undefined' || typeof gppState.getFocusedTemplate !== 'function') return null;
        const template = gppState.getFocusedTemplate();
        return (template && template.palette && template.palette.length) ? template : null;
    }

    function replaceNativeColorGrid(bottomControls) {
        const nativeContainer = bottomControls.querySelector('.control-container-colors');
        if (!nativeContainer) return false;
        const template = getFocusedTemplateWithPalette();
        if (!template) return false;

        const replacement = buildTemplatePaletteGrid(template);
        nativeContainer.replaceWith(replacement);
        dbgPush('Mobile Painting: replaced native color grid with template "' + template.id + '"\'s Ghost++ palette grid (' + template.palette.length + ' colors).', { uiComponent: 'Mobile Painting' });
        return true;
    }

    function mount(bottomControls) {
        applyFullWidthBottomControls(bottomControls);
        dbgPush('Mobile Painting: #bottomControls found -- applied full-width layout.', { uiComponent: 'Mobile Painting' });

        if (replaceNativeColorGrid(bottomControls)) return;

        // Ghost++'s template library loads from IndexedDB asynchronously (see
        // gppInitRuntime()), and may not be settings-enabled at all -- retry
        // for the same 15s window the rest of this codebase uses rather than
        // giving up after a single check.
        const watchStartedAt = Date.now();
        const retryInterval = setInterval(() => {
            if (replaceNativeColorGrid(bottomControls)) {
                clearInterval(retryInterval);
            }
        }, 500);
        setTimeout(() => {
            clearInterval(retryInterval);
            if (!document.querySelector('.gpc-mobile-palette-wrap')) {
                dbgPush('Mobile Painting: gave up after 15s -- no focused Ghost++ template with a decoded palette was found; left the native color grid in place.', { uiComponent: 'Mobile Painting' });
            }
        }, 15000);
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
