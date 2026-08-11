
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

    // Reuses Ghost++'s own .gpp-palette-grid / .gpp-swatch / tooltip class
    // names and rules (see gpp-palette.js) so this looks and feels identical
    // to the real Ghost++ palette. Trimmed to just the grid + on/off swatch
    // state + hover tooltip -- no search/sort/filter/bulk-action CHROME,
    // since this renders inline in the compact bottom paint bar rather than
    // the full Ghost++ manager panel (the sort/filter EFFECTS themselves
    // still apply -- see computeVisibleOrder below -- just not their own
    // controls, which stay in the Ghost++ modal).
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
                padding: 0; transition: transform .18s ease-out, box-shadow .18s ease-out;
            }
            .gpp-swatch:hover {
                transform: scale(1.2);
                box-shadow: 0 3px 8px ${t2('rgba(0,0,0,.35)', 'rgba(0,0,0,.6)')};
                z-index: 2;
            }
            /* Deliberately no grayscale/opacity dimming here, unlike Ghost++'s
               own grid -- there, that's gated behind gppSettings.
               grayDisabledSwatches (View Settings > Global > "Gray unselected
               color boxes"), applied via a .gpp-palette-gray-disabled
               ancestor class Ghost++ toggles on ITS OWN grid only.
               mobile-painting.js never reads or toggles that class, so
               copying the plain (ungated) filter rule here made this grid
               permanently dimmed regardless of the setting -- the checkbox
               had no real container to act on. Per explicit product
               decision this grid should never dim off colors at all, so the
               rule is dropped rather than wired up to the setting; the
               diagonal slash below (which Ghost++ never gates either) is
               the only off-state indicator here. */
            .gpp-swatch.gpp-swatch-off::after {
                content: ''; position: absolute; inset: 0; pointer-events: none;
                border-radius: inherit;
                background: linear-gradient(to top right,
                    transparent calc(50% - 1px), rgba(50,50,50,.75) calc(50% - 1px),
                    rgba(50,50,50,.75) calc(50% + 1px), transparent calc(50% + 1px));
            }
            /* "Currently selected" indicator: a slowly-rotating ring of
               alternating black/white dashes (repeating-conic-gradient
               wedges, masked down to a ring) around whichever swatch was
               last tapped -- separate pseudo-element from .gpp-swatch-off's
               ::after slash so a swatch could in principle carry both
               without conflict, even though in practice soloColor() always
               leaves the selected swatch enabled. */
            .gpp-swatch.gpp-swatch-selected::before {
                content: ''; position: absolute; inset: -3px; z-index: 1;
                pointer-events: none; border-radius: 50%;
                background: repeating-conic-gradient(#000 0deg 12deg, #fff 12deg 24deg);
                -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
                mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
                animation: gpc-mobile-selected-spin 4s linear infinite;
            }
            @keyframes gpc-mobile-selected-spin {
                to { transform: rotate(360deg); }
            }
            /* Shared with Ghost++'s own tooltip (#gpp-palette-tooltip is a
               page-global singleton -- see gpp-palette.js's
               gppPaletteEnsureTooltipEl) -- injected here too so the tooltip
               looks right even if the real Ghost++ modal was never opened
               this session (its own style tag would otherwise never run). */
            #gpp-palette-tooltip {
                position: fixed; z-index: 10070; pointer-events: none; display: none;
                padding: 6px 9px; border-radius: 7px; font-size: 12px; line-height: 1.4;
                background: ${t2('#ffffff', '#1e1e2e')};
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                box-shadow: 0 8px 20px ${t2('rgba(15,23,42,.28)', 'rgba(0,0,0,.6)')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            #gpp-palette-tooltip .gpp-palette-tooltip-hex {
                font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700;
                display: flex; align-items: center; gap: 6px;
            }
            #gpp-palette-tooltip .gpp-palette-tooltip-swatch {
                display: inline-block; width: 10px; height: 10px; border-radius: 3px;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
            }
            #gpp-palette-tooltip .gpp-palette-tooltip-stats {
                margin-top: 2px; color: ${t2('#64748b', '#a6adc8')};
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

    // Also reconciles the "currently selected" rotating-ring indicator
    // (liveState.selectedHex, set by soloColor below) against this swatch --
    // every call site that already calls setSwatchState (initial build,
    // soloColor's own update loop, resync()'s reconcile pass) gets the ring
    // kept in sync for free, with no separate pass needed.
    function setSwatchState(swatch, hex, enabled) {
        swatch.classList.toggle('gpp-swatch-off', !enabled);
        swatch.setAttribute('aria-pressed', String(enabled));
        swatch.setAttribute('aria-label', `${enabled ? 'Hide' : 'Show'} ${hex}`);
        swatch.classList.toggle('gpp-swatch-selected', !!liveState && liveState.selectedHex === hex);
    }

    // Native #hexDisplay (js/index148.js's SetColors) only ever updates on
    // NATIVE swatch mouseover, and is hidden below Tailwind's md breakpoint
    // (`hidden md:inline-block`) -- invisible at the phone widths this
    // extension targets, since it existed purely as a hover preview for the
    // native grid we've replaced. Forced visible here and updated on
    // selection (not hover -- see the tooltip for that) instead.
    function updateHexDisplay(hex) {
        const hexDisplay = document.getElementById('hexDisplay');
        if (!hexDisplay) return;
        hexDisplay.textContent = hex;
        hexDisplay.style.display = 'inline-block';
    }

    // Reads the SAME already-computed sort/filter result the real Ghost++
    // palette panel last produced (controller.renderState.visible -- see the
    // "Exposed on the controller" comment in gpp-palette.js's
    // performFilterSort), rather than re-implementing that 8-sort/6-filter
    // pipeline a second time here where it could drift out of sync. Only
    // trusted when the real panel's controller is actually showing the SAME
    // template (templateKey match) -- otherwise (Ghost++ modal never opened
    // this session, or showing a different template) falls back to natural
    // palette order with nothing filtered out.
    function getRealPaletteRenderState(templateId) {
        if (typeof gppPaletteControllers === 'undefined') return null;
        const realContainer = document.getElementById('gpp-palette-section');
        if (!realContainer) return null;
        const realController = gppPaletteControllers.get(realContainer);
        if (!realController || realController.templateKey !== templateId || !realController.renderState) return null;
        return realController.renderState;
    }

    function computeVisibleOrder(template) {
        const realState = getRealPaletteRenderState(template.id);
        if (realState && Array.isArray(realState.visible)) return realState.visible.slice();
        const order = [];
        for (let index = 0; index < template.palette.length; index++) order.push(index);
        return order;
    }

    // Builds the compact grid for `order` (a list of palette indices, already
    // filtered/sorted to match whatever the real Ghost++ panel currently
    // shows -- see computeVisibleOrder). Clicking a swatch is NOT a plain
    // per-color toggle like Ghost++'s own grid -- per explicit product
    // decision, it "solos" that color (enable it, disable every other color
    // in this template's overlay via core.maskSet), selects it as the active
    // native paint color via changeColor(hex), and updates #hexDisplay, so a
    // mobile painter taps one swatch to see only that color's remaining
    // pixels on the map AND be ready to paint them immediately. State
    // (template.mask) and persistence/redraw are still the same real Ghost++
    // state, not a separate copy -- and gppRequestUiRefresh() is called
    // afterward so an already-open Ghost++ modal reflects the solo
    // immediately too, not just on its next poll.
    function buildTemplatePaletteGrid(template, order) {
        injectStyle();
        const core = gppCreateCore();
        const colourLookup = (typeof gppPaletteBuildColourLookup === 'function') ? gppPaletteBuildColourLookup(template) : null;
        const hasProgress = !!template.scanSummary;

        const wrap = document.createElement('div');
        wrap.className = 'gpc-mobile-palette-wrap';

        // Distinct id from Ghost++'s own (class-only, no id) .gpp-palette-grid
        // so the two are unambiguous to refer to separately.
        const grid = document.createElement('div');
        grid.id = 'gpc-mobile-palette-grid';
        grid.className = 'gpp-palette-grid';

        function soloColor(targetIndex, hex) {
            for (let index = 0; index < template.palette.length; index++) {
                core.maskSet(template.mask, index, index === targetIndex);
            }
            // Set BEFORE the update loop below, so setSwatchState's own
            // liveState.selectedHex check reflects the NEW selection, not
            // whatever was selected before this click.
            if (liveState) liveState.selectedHex = hex;
            const swatches = grid.children;
            for (let i = 0; i < swatches.length; i++) {
                const swatch = swatches[i];
                const swatchIndex = Number(swatch.dataset.index);
                setSwatchState(swatch, swatch.dataset.hex, swatchIndex === targetIndex);
            }
            if (typeof window.changeColor === 'function') window.changeColor(hex);
            updateHexDisplay(hex);
            gppState.persistTemplateState(template).catch((err) => {
                console.error('[GeoPixelcons++] Mobile Painting: failed to persist template state', err);
            });
            if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
            if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        }

        order.forEach((index) => {
            const hex = core.packedToHex(template.palette[index]);
            const enabled = core.maskHas(template.mask, index);
            const stats = colourLookup ? gppPaletteStats(template, index, colourLookup) : null;

            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'gpp-swatch';
            swatch.style.backgroundColor = hex;
            swatch.dataset.hex = hex;
            swatch.dataset.index = String(index);
            setSwatchState(swatch, hex, enabled);
            swatch.addEventListener('click', () => soloColor(index, hex));
            // Same custom mouse-following tooltip as Ghost++'s real grid,
            // not a native title attribute -- see gppPaletteShowTooltip's own
            // comment in gpp-palette.js for why.
            if (stats && typeof gppPaletteShowTooltip === 'function') {
                swatch.addEventListener('mouseenter', (event) => gppPaletteShowTooltip(event, hex, stats, hasProgress));
                swatch.addEventListener('mousemove', (event) => gppPaletteMoveTooltip(event));
                swatch.addEventListener('mouseleave', () => gppPaletteHideTooltip());
            }
            grid.appendChild(swatch);
        });

        wrap.appendChild(grid);
        return wrap;
    }

    // ── Live sync ────────────────────────────────────────────────────────
    // Keeps the inline grid matching Ghost++'s real state after the initial
    // swap: switching the focused template, toggling a color's show/hide, or
    // changing the real panel's sort/search/filter selections, all need to
    // be reflected here too.
    //
    // Two sources feed the same resync() function:
    //   1. gppSubscribeUiRefresh() -- gpp-init.js's real external-refresh
    //      hook. Confirmed to fire on a palette mask toggle (gpp-palette.js's
    //      setSwatchMaskState calls gppRequestUiRefresh() directly), so a
    //      color toggled from the real modal reaches this near-instantly.
    //   2. A 1s poll fallback -- gpp-library.js's "switch focused template"
    //      click handlers only call their own local refreshAll(), never
    //      gppRequestUiRefresh(), and sort/filter control changes only call
    //      performFilterSort() directly -- neither reaches subscribers.
    //      Polling is the only reliable way to catch either without patching
    //      more of Ghost++'s own code than the one renderState hook above.
    let liveState = null; // { bottomControls, savedNativeContainer, wrap, grid, templateId, orderKey, selectedHex }

    function resync() {
        if (!liveState) return;
        const template = getFocusedTemplateWithPalette();

        if (!template) {
            if (liveState.wrap) {
                liveState.wrap.remove();
                // Restore visibility rather than re-inserting the node --
                // it was never removed from the DOM (see showCompactGrid
                // below), only hidden, so the native site's own periodic
                // SetColors() (js/index153.js) keeps finding
                // .control-container-colors and quietly re-populating it
                // the whole time, exactly like it would with this
                // extension off. Actually detaching it (an earlier version
                // of this code used replaceWith()) made every one of those
                // native sync ticks log "Color container
                // '.control-container-colors' not found." to the console.
                liveState.savedNativeContainer.style.display = '';
                dbgPush('Mobile Painting: no focused Ghost++ template anymore -- restored the native color grid.', { uiComponent: 'Mobile Painting' });
                liveState.wrap = null;
                liveState.grid = null;
                liveState.templateId = null;
                liveState.orderKey = null;
                liveState.selectedHex = null;
            }
            return;
        }

        const order = computeVisibleOrder(template);
        const orderKey = order.join(',');
        const sameEverything = liveState.grid && liveState.templateId === template.id && liveState.orderKey === orderKey;

        if (sameEverything) {
            const core = gppCreateCore();
            const swatches = liveState.grid.children;
            for (let i = 0; i < swatches.length; i++) {
                const swatch = swatches[i];
                const index = Number(swatch.dataset.index);
                const enabled = core.maskHas(template.mask, index);
                if (swatch.classList.contains('gpp-swatch-off') === enabled) {
                    setSwatchState(swatch, swatch.dataset.hex, enabled);
                }
            }
            return;
        }

        const replacement = buildTemplatePaletteGrid(template, order);
        showCompactGrid(replacement);
        liveState.grid = replacement.querySelector('.gpp-palette-grid');
        liveState.templateId = template.id;
        liveState.orderKey = orderKey;
        dbgPush('Mobile Painting: (re)built palette grid for template "' + template.id + '" (' + order.length + '/' + template.palette.length + ' colors visible).', { uiComponent: 'Mobile Painting' });
    }

    // Swaps the compact grid in without ever detaching
    // .control-container-colors from the document -- only hides it (see
    // resync()'s own comment for why that distinction matters). First swap
    // hides the native container and inserts the replacement right after it;
    // later rebuilds (template switch, order change) just replace the
    // previous compact grid with the new one, native container untouched.
    function showCompactGrid(replacement) {
        if (liveState.wrap) {
            liveState.wrap.replaceWith(replacement);
        } else {
            liveState.savedNativeContainer.style.display = 'none';
            liveState.savedNativeContainer.insertAdjacentElement('afterend', replacement);
        }
        liveState.wrap = replacement;
    }

    function mount(bottomControls) {
        applyFullWidthBottomControls(bottomControls);
        dbgPush('Mobile Painting: #bottomControls found -- applied full-width layout.', { uiComponent: 'Mobile Painting' });

        const nativeContainer = bottomControls.querySelector('.control-container-colors');
        if (!nativeContainer) {
            dbgPush('Mobile Painting: no .control-container-colors found inside #bottomControls -- nothing to replace.', { uiComponent: 'Mobile Painting' });
            return;
        }

        liveState = { bottomControls, savedNativeContainer: nativeContainer, wrap: null, grid: null, templateId: null, orderKey: null, selectedHex: null };

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
