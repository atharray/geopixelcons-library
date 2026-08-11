
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
                /* 2 visible rows (26px + 3px gap, doubled, plus the grid's own
                   2px top/bottom padding) before scrolling -- same constant
                   Ghost++'s own minified mode uses for the identical shape
                   (see gpp-ui-shell.js's .gpp-minified .gpp-palette-grid). */
                gap: 3px; max-height: 60px; overflow-y: auto; padding: 2px;
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
                    transparent calc(50% - 1px), rgba(50,50,50,.8) calc(50% - 1px),
                    rgba(50,50,50,.8) calc(50% + 1px), transparent calc(50% + 1px));
            }
            /* "Currently selected" indicator: a slowly-rotating SQUARE ring of
               alternating black/white dashes around whichever swatch was last
               tapped. The ring shape is a mask-composite "frame" trick, not
               border-radius: 50% + a radial-gradient mask (which draws a
               circle) -- a repeating-conic-gradient fills the whole
               pseudo-element, then two identical linear-gradient mask layers
               (one clipped to content-box, one to the full border-box) are
               XORed together, leaving only the padding-box band (the frame)
               visible. Separate pseudo-element from .gpp-swatch-off's ::after
               slash so a swatch could in principle carry both without
               conflict, even though in practice soloColor() always leaves
               the selected swatch enabled. */
            .gpp-swatch.gpp-swatch-selected::before {
                content: ''; position: absolute; inset: -3px; z-index: 1;
                pointer-events: none; box-sizing: border-box; padding: 3px;
                background: repeating-conic-gradient(#000 0deg 12deg, #fff 12deg 24deg);
                -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                -webkit-mask-composite: xor;
                mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                mask-composite: exclude;
                animation: gpc-mobile-selected-spin 16s linear infinite;
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
            /* Bulk-action / sort / filter / get-hex row -- reuses Ghost++'s
               own .gpp-palette-bulk-row/-2col-row/-filter-dropdown/-button/
               -menu/-option/-sort classes verbatim (see gpp-palette.js) so
               these look identical to the real panel's own controls. */
            .gpc-mobile-controls-row { width: 100%; box-sizing: border-box; margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
            .gpp-palette-bulk-row { display: flex; gap: 6px; }
            .gpp-palette-bulk-row button,
            .gpp-palette-bulk-row .gpp-palette-filter-dropdown {
                flex: 1 1 0; min-width: 0;
            }
            .gpp-palette-bulk-row button {
                border: 2px solid ${t2('#d1d5db', '#45475a')}; border-radius: 6px;
                background: ${t2('#ffffff', '#11111b')}; color: ${t2('#111827', '#f5f5f5')};
                font-size: 11px; font-weight: 600; cursor: pointer; padding: 4px 6px;
            }
            .gpp-palette-bulk-row button:hover { background: ${t2('#f3f4f6', '#313244')}; }
            .gpp-palette-2col-row {
                display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px;
            }
            .gpp-palette-2col-row button,
            .gpp-palette-2col-row .gpp-palette-filter-dropdown,
            .gpp-palette-2col-row .gpp-palette-sort-wrap {
                width: 100%; box-sizing: border-box; min-width: 0;
            }
            .gpp-palette-filter-dropdown { position: relative; }
            .gpp-palette-filter-button,
            .gpp-palette-sort-select {
                width: 100%; box-sizing: border-box; min-height: 28px;
                border: 2px solid ${t2('#d1d5db', '#45475a')}; border-radius: 6px;
                background: ${t2('#ffffff', '#11111b')}; color: ${t2('#111827', '#f5f5f5')};
                font-size: 11px; cursor: pointer;
                text-align: center; text-align-last: center;
            }
            .gpp-palette-filter-button {
                display: flex; align-items: center; justify-content: center;
                gap: 6px; padding: 3px 8px;
            }
            .gpp-palette-filter-menu {
                display: none; position: absolute; top: calc(100% + 4px); left: 0; z-index: 20;
                min-width: 204px; padding: 6px; border-radius: 8px;
                border: 1px solid ${t2('#e5e7eb', '#313244')};
                background: ${t2('#ffffff', '#181825')};
                box-shadow: 0 8px 24px rgba(0,0,0,.28);
            }
            .gpp-palette-filter-menu.gpp-open { display: flex; flex-direction: column; gap: 2px; }
            .gpp-palette-filter-option {
                display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 5px;
                font-size: 12px; cursor: pointer; user-select: none;
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-palette-filter-option:hover { background: ${t2('#f3f4f6', '#313244')}; }
            .gpp-palette-filter-option input { width: 13px; height: 13px; cursor: pointer; }
            .gpp-palette-sort-wrap { flex: 1 1 0; min-width: 0; }
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

    // ── Bulk-action / sort / filter / get-hex row ──────────────────────────
    // A compact row of controls "duplicated" from Ghost++'s own palette
    // panel (Enable all/owned/filtered, Disable all, Get hex values, Sort,
    // Filter), per explicit product decision folding Ghost++'s 3 separate
    // Enable buttons into one Enable▾ dropdown to fit the space.
    //
    // Enable/Disable/Get-hex only need public primitives (core.maskSet/
    // maskHas, gppReadGamePalette(), computeVisibleOrder()'s already-exposed
    // renderState) -- reimplemented directly against those rather than
    // reaching into gpp-palette.js's private closures, low drift risk since
    // this is plain set-membership logic already verified against its real
    // handlers (allBtn/noneBtn/ownedBtn/enableFilteredBtn/
    // copyHexValuesForScope).
    //
    // Sort and Filter are different: their RESULT (renderState.visible) is
    // already reused via computeVisibleOrder, but *setting* them requires
    // actually running Ghost++'s private 8-sort/6-filter algorithm, which
    // only exists inside a live gpp-palette.js controller instance. Rather
    // than duplicate that pipeline a second time (the exact drift risk
    // computeVisibleOrder was built to avoid), these controls are a genuine
    // remote control: gppEnsurePaletteSectionReady() (gpp-init.js) guarantees
    // #gpp-palette-section's controller exists without ever revealing the
    // modal, then our own dropdown/select write straight into ITS real form
    // elements and dispatch the same events its own listeners are wired to
    // -- one shared source of truth, so a change here reaches the real
    // Ghost++ grid too (if open) exactly the same way a change made inside
    // the real modal would.
    function ensurePaletteControllerReady() {
        if (typeof gppEnsurePaletteSectionReady === 'function') gppEnsurePaletteSectionReady();
    }

    function getRealPaletteFormControls() {
        const container = document.getElementById('gpp-palette-section');
        if (!container) return null;
        return {
            container,
            searchInput: container.querySelector('.gpp-palette-search-input'),
            sortSelect: container.querySelector('.gpp-palette-sort-select'),
            filterInputs: Array.from(container.querySelectorAll('.gpp-palette-filter-menu input[type="checkbox"]')),
        };
    }

    function notifyMaskChanged(template) {
        gppState.persistTemplateState(template).catch((err) => {
            console.error('[GeoPixelcons++] Mobile Painting: failed to persist template state', err);
        });
        if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
        if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
    }

    function bulkEnableAll(template, core) {
        template.mask = core.makeFullMask(template.palette.length, template.counts);
        notifyMaskChanged(template);
    }

    function bulkDisableAll(template) {
        template.mask = new Uint32Array(Math.ceil(template.palette.length / 32));
        notifyMaskChanged(template);
    }

    function bulkEnableOwned(template, core) {
        const rows = (typeof gppReadGamePalette === 'function') ? gppReadGamePalette() : [];
        const allowedHex = new Set();
        rows.forEach((row) => { if (row && row.hex) allowedHex.add(String(row.hex).toUpperCase()); });
        const mask = new Uint32Array(Math.ceil(template.palette.length / 32));
        for (let index = 0; index < template.palette.length; index++) {
            if (allowedHex.has(core.packedToHex(template.palette[index]))) core.maskSet(mask, index, true);
        }
        template.mask = mask;
        notifyMaskChanged(template);
    }

    // Mirrors the real enableFilteredBtn handler: an active search term
    // (read from the real search box, if it exists) excludes non-matches
    // even without the "Show search results only" checkbox on, exactly like
    // the real button -- see gpp-palette.js's own comment on this exact
    // behavior for why.
    function bulkEnableFiltered(template, core) {
        ensurePaletteControllerReady();
        const realState = getRealPaletteRenderState(template.id);
        const real = getRealPaletteFormControls();
        const hasActiveSearch = !!(real && real.searchInput && real.searchInput.value.trim().length > 0);
        const matchingSet = (realState && realState.matching) || new Set();
        const visible = (realState && realState.visible) || [];
        const mask = new Uint32Array(Math.ceil(template.palette.length / 32));
        visible.forEach((index) => {
            if (hasActiveSearch && !matchingSet.has(index)) return;
            core.maskSet(mask, index, true);
        });
        template.mask = mask;
        notifyMaskChanged(template);
    }

    const GPC_HEX_VALUE_SCOPES = [
        { value: 'all', text: 'All colors' },
        { value: 'owned', text: 'Owned colors only' },
        { value: 'notOwned', text: 'Not owned colors only' },
        { value: 'enabled', text: 'Enabled colors only' },
        { value: 'enabledOwned', text: 'Enabled + owned colors' },
        { value: 'filtered', text: 'Filtered colors only' },
        { value: 'filteredOwned', text: 'Filtered + owned colors only' },
    ];

    function copyHexValuesForScope(template, core, scope) {
        ensurePaletteControllerReady();
        const ownedHex = new Set(((typeof gppReadGamePalette === 'function') ? gppReadGamePalette() : []).map((row) => String(row.hex).toUpperCase()));
        const realState = getRealPaletteRenderState(template.id);
        const filteredSet = new Set((realState && realState.visible) || []);
        const hexes = [];
        for (let index = 0; index < template.palette.length; index++) {
            const hex = core.packedToHex(template.palette[index]);
            const isOwned = ownedHex.has(hex);
            const isEnabled = core.maskHas(template.mask, index);
            const isFiltered = filteredSet.has(index);
            let include;
            switch (scope) {
                case 'all': include = true; break;
                case 'owned': include = isOwned; break;
                case 'notOwned': include = !isOwned; break;
                case 'enabled': include = isEnabled; break;
                case 'enabledOwned': include = isEnabled && isOwned; break;
                case 'filtered': include = isFiltered; break;
                case 'filteredOwned': include = isFiltered && isOwned; break;
                default: include = false;
            }
            if (include) hexes.push(hex);
        }
        const text = hexes.join(', ');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => alert(text || 'No matching colors.'));
        } else {
            alert(text || 'No matching colors.');
        }
        return hexes.length;
    }

    // Generic small popup-menu button, matching Ghost++'s own Filters/Get
    // hex values dropdown pattern (gpp-palette-filter-dropdown/-button/
    // -menu/-option -- generic despite the "filter" class names, see
    // gpp-palette.js's own comment on that).
    function buildDropdownButton(labelText, optionDefs) {
        const dropdown = document.createElement('div');
        dropdown.className = 'gpp-palette-filter-dropdown';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gpp-palette-filter-button';
        const buttonText = document.createElement('span');
        buttonText.textContent = labelText;
        const arrow = document.createElement('span');
        arrow.textContent = '▾';
        arrow.style.cssText = 'font-size:10px;opacity:.7;';
        button.append(buttonText, arrow);

        const menu = document.createElement('div');
        menu.className = 'gpp-palette-filter-menu';
        optionDefs.forEach(({ text, onClick }) => {
            const option = document.createElement('div');
            option.className = 'gpp-palette-filter-option';
            option.textContent = text;
            option.addEventListener('click', () => {
                menu.classList.remove('gpp-open');
                onClick();
            });
            menu.appendChild(option);
        });
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.classList.toggle('gpp-open');
        });
        menu.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', () => menu.classList.remove('gpp-open'));

        dropdown.append(button, menu);
        return { el: dropdown, setLabel: (text) => { buttonText.textContent = text; } };
    }

    // Our own <select>, but its options are cloned from the real sort
    // select's current options (values + text) rather than a hardcoded
    // second copy of GPP_PALETTE_SORT_OPTIONS -- one less place for the two
    // lists to drift apart. Only synced once, at build time; a sort option
    // that only unlocks after a scan runs (see gpp-palette.js's
    // syncProgressGatedControls) won't retroactively appear here without a
    // page reload -- disclosed limitation, not chased further.
    function buildSortControl() {
        const wrap = document.createElement('div');
        wrap.className = 'gpp-palette-sort-wrap';
        const select = document.createElement('select');
        select.className = 'gpp-palette-sort-select';
        select.title = 'Sort colors -- also updates the Ghost++ manager';

        ensurePaletteControllerReady();
        const real = getRealPaletteFormControls();
        if (real && real.sortSelect) {
            Array.from(real.sortSelect.options).forEach((realOpt) => {
                const opt = document.createElement('option');
                opt.value = realOpt.value;
                opt.textContent = realOpt.textContent;
                select.appendChild(opt);
            });
            select.value = real.sortSelect.value;
        }

        select.addEventListener('change', () => {
            ensurePaletteControllerReady();
            const fresh = getRealPaletteFormControls();
            if (!fresh || !fresh.sortSelect) return;
            fresh.sortSelect.value = select.value;
            fresh.sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });

        wrap.appendChild(select);
        return wrap;
    }

    // Checkboxes cloned (value + label text) from the real filter menu's
    // current checkboxes, same anti-drift reasoning as buildSortControl.
    // Each one writes straight through to its real counterpart on change --
    // no local filter state of our own. Note: no search box here (out of
    // scope for this row), so "Show search results only" is inert unless a
    // search term also happens to be set in the real Ghost++ panel; and the
    // "Filter within pixel count..." checkbox reuses whatever min/max the
    // real panel currently has rather than adding a second pair of number
    // inputs here.
    function buildFilterControl() {
        ensurePaletteControllerReady();
        const real = getRealPaletteFormControls();
        const optionDefs = (real ? real.filterInputs : []).map((realInput) => ({
            value: realInput.value,
            text: realInput.parentElement && realInput.parentElement.querySelector('span')
                ? realInput.parentElement.querySelector('span').textContent
                : realInput.value,
            checked: realInput.checked,
        }));

        const dropdown = document.createElement('div');
        dropdown.className = 'gpp-palette-filter-dropdown';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gpp-palette-filter-button';
        const buttonText = document.createElement('span');
        buttonText.textContent = 'Filter';
        const arrow = document.createElement('span');
        arrow.textContent = '▾';
        arrow.style.cssText = 'font-size:10px;opacity:.7;';
        button.append(buttonText, arrow);

        const menu = document.createElement('div');
        menu.className = 'gpp-palette-filter-menu';
        optionDefs.forEach(({ value, text, checked }) => {
            const label = document.createElement('label');
            label.className = 'gpp-palette-filter-option';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = value;
            input.checked = checked;
            const span = document.createElement('span');
            span.textContent = text;
            label.append(input, span);
            menu.appendChild(label);

            input.addEventListener('change', () => {
                ensurePaletteControllerReady();
                const fresh = getRealPaletteFormControls();
                const target = fresh && fresh.filterInputs.find((el) => el.value === value);
                if (!target) return;
                target.checked = input.checked;
                target.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.classList.toggle('gpp-open');
        });
        menu.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', () => menu.classList.remove('gpp-open'));

        dropdown.append(button, menu);
        return dropdown;
    }

    function buildControlsRow() {
        const row = document.createElement('div');
        row.className = 'gpc-mobile-controls-row';

        function withTemplate(fn) {
            return () => {
                const template = getFocusedTemplateWithPalette();
                if (!template) {
                    dbgPush('Mobile Painting: control row action ignored -- no focused Ghost++ template.', { uiComponent: 'Mobile Painting' });
                    return;
                }
                fn(template, gppCreateCore());
            };
        }

        const enableDropdown = buildDropdownButton('Enable', [
            { text: 'All', onClick: withTemplate(bulkEnableAll) },
            { text: 'Owned', onClick: withTemplate(bulkEnableOwned) },
            { text: 'Filtered', onClick: withTemplate(bulkEnableFiltered) },
        ]);
        const disableAllBtn = document.createElement('button');
        disableAllBtn.type = 'button';
        disableAllBtn.textContent = 'Disable all';
        disableAllBtn.addEventListener('click', withTemplate(bulkDisableAll));

        const bulkRow = document.createElement('div');
        bulkRow.className = 'gpp-palette-2col-row';
        bulkRow.append(enableDropdown.el, disableAllBtn);

        const sortWrap = buildSortControl();
        const filterDropdown = buildFilterControl();
        const controlsRow = document.createElement('div');
        controlsRow.className = 'gpp-palette-2col-row';
        controlsRow.append(sortWrap, filterDropdown);

        const hexDropdown = buildDropdownButton('Get hex values', GPC_HEX_VALUE_SCOPES.map(({ value, text }) => ({
            text,
            onClick: withTemplate((template, core) => {
                const count = copyHexValuesForScope(template, core, value);
                hexDropdown.setLabel(count ? `Copied ${count}!` : 'Nothing to copy');
                setTimeout(() => hexDropdown.setLabel('Get hex values'), 1200);
            }),
        })));

        row.append(bulkRow, controlsRow, hexDropdown.el);
        return row;
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

        // The native Sort button (sortAndSetColors()) is redundant with our
        // own Sort control below -- hidden in place, same reasoning as
        // .control-container-colors above: never remove a native node
        // outright, since something native may still expect to find it.
        const nativeSortBtn = bottomControls.querySelector('#sortBtn');
        if (nativeSortBtn) nativeSortBtn.style.display = 'none';

        // Inserted right before the (native or compact) color grid, not
        // appended to the end of innerWrapper -- appendChild put it below
        // the grid, since the grid always sits earlier (2nd child, right
        // after the top bar). nativeContainer stays a stable anchor point
        // for this regardless of whether it or our compact grid is what's
        // actually showing at any given moment (see showCompactGrid).
        nativeContainer.insertAdjacentElement('beforebegin', buildControlsRow());

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
