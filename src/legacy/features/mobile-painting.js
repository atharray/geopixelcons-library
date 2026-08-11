
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

    // Reuses Ghost++'s own .gpp-palette-grid / .gpp-swatch / .gpp-palette-
    // search-input class names and rules (see gpp-palette.js) so this looks
    // identical whether or not Ghost++ itself is enabled. Deliberately a
    // trimmed subset -- no progress dots, sort, or filter menu, since none
    // of that has meaning against the native (non-template) color list.
    function injectStyle() {
        if (document.getElementById(MP_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = MP_STYLE_ID;
        style.textContent = `
            .gpp-palette-search-input {
                width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px;
                border: 2px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#ffffff', '#11111b')}; color: ${t2('#111827', '#f5f5f5')};
                font-size: 12px; margin-bottom: 6px;
            }
            .gpp-palette-search-input:focus { outline: none; border-color: ${t2('#3b82f6', '#89b4fa')}; }
            .gpp-palette-search-input::placeholder { color: ${t2('#94a3b8', '#7f849c')}; }
            .gpp-palette-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(26px, 1fr));
                grid-auto-rows: minmax(26px, 1fr);
                gap: 3px; max-height: 260px; overflow-y: auto; padding: 2px;
                scrollbar-gutter: stable;
            }
            .gpp-swatch {
                position: relative; aspect-ratio: 1 / 1; min-height: 15px; border-radius: 4px;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                padding: 0; transition: transform .08s ease;
            }
            .gpp-swatch:hover { transform: scale(1.15); z-index: 2; }
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

    // Reads the native swatches (hex id + inline background) before removing
    // them, so this never hardcodes a palette -- it always mirrors whatever
    // colors this specific user's native grid actually has available.
    function buildGppStylePaletteGrid(nativeButtons) {
        injectStyle();

        const wrap = document.createElement('div');
        wrap.className = 'gpc-mobile-palette-wrap';

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'gpp-palette-search-input';
        search.placeholder = 'Search colors by hex...';

        const grid = document.createElement('div');
        grid.className = 'gpp-palette-grid';

        nativeButtons.forEach((nativeBtn) => {
            const hex = nativeBtn.id;
            if (!hex) return;
            const swatch = document.createElement('button');
            swatch.className = 'gpp-swatch';
            swatch.style.background = nativeBtn.style.background;
            swatch.title = hex;
            swatch.dataset.hex = hex.toLowerCase();
            swatch.addEventListener('click', () => {
                if (typeof window.changeColor === 'function') window.changeColor(hex);
            });
            grid.appendChild(swatch);
        });

        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            Array.from(grid.children).forEach((sw) => {
                sw.style.display = (!q || sw.dataset.hex.includes(q)) ? '' : 'none';
            });
        });

        wrap.appendChild(search);
        wrap.appendChild(grid);
        return wrap;
    }

    // Swaps GeoPixels' native `.control-container-colors` block (plain flat
    // swatch grid, no search/filter) for a Ghost++-styled equivalent wired to
    // the same native changeColor(hex) the original swatches called, so
    // mobile painters get Ghost++'s search/filter-to-find-a-color experience
    // inline instead of needing to open the separate Ghost++ manager.
    //
    // Known gap, not addressed here: the native grid also visually marks a
    // swatch (thicker black border, no `color-swatch` class) after it's been
    // selected via changeColor(). That marker did not clear when a different
    // color was subsequently picked in manual testing, so its exact trigger
    // isn't understood well enough to reproduce faithfully yet -- the new
    // grid does not attempt any "currently selected" indicator.
    function replaceNativeColorGrid(bottomControls) {
        const nativeContainer = bottomControls.querySelector('.control-container-colors');
        if (!nativeContainer) return false;
        const nativeButtons = Array.from(nativeContainer.querySelectorAll('button'));
        if (!nativeButtons.length) return false;

        const replacement = buildGppStylePaletteGrid(nativeButtons);
        nativeContainer.replaceWith(replacement);
        dbgPush('Mobile Painting: replaced native color grid (' + nativeButtons.length + ' colors) with a Ghost++-styled grid.', { uiComponent: 'Mobile Painting' });
        return true;
    }

    function mount(bottomControls) {
        applyFullWidthBottomControls(bottomControls);
        dbgPush('Mobile Painting: #bottomControls found -- applied full-width layout.', { uiComponent: 'Mobile Painting' });

        if (replaceNativeColorGrid(bottomControls)) return;

        // The color grid can still be empty/unmounted at this instant (its
        // colors may load a moment after #bottomControls itself does) --
        // watch the same 15s window the rest of this codebase uses.
        const watchStartedAt = Date.now();
        const gridObserver = new MutationObserver(() => {
            if (replaceNativeColorGrid(bottomControls)) {
                gridObserver.disconnect();
            }
        });
        gridObserver.observe(bottomControls, { childList: true, subtree: true });
        setTimeout(() => {
            gridObserver.disconnect();
            if (!document.querySelector('.gpc-mobile-palette-wrap')) {
                dbgPush('Mobile Painting: gave up after 15s -- .control-container-colors never had any color swatches.', { uiComponent: 'Mobile Painting' });
                console.error('[GeoPixelcons++] Mobile Painting: never found a populated .control-container-colors.');
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
