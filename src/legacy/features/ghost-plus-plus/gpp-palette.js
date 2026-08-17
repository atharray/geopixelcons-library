    // ── Ghost++ palette panel ──────────────────────────────────────────
    // Redesigned colour palette for the focused template. Ports the sort (8
    // options) and filter (6 checkboxes incl. progress-gated subset) logic
    // from src/features/ghost-palette-search.js (lines ~433-493, 518-691,
    // 594-639, 732-749) faithfully, adapted from the native page-scope
    // Set/DOM-swatch model to Ghost++'s own template.mask bitset via
    // gppCreateCore()'s maskHas/maskSet/maskToggle/maskOnly. This panel never
    // touches native page state — everything here is local to the focused
    // template record (see gpp-runtime.js for its shape).
    //
    // Entry point wired by gpp-init.js's render-function contract:
    //   gppRenderPalette(container, template, onChange)
    // `container` is 'gpp-palette-section', rebuilt/called on every refresh.
    // A small per-container controller (gppPaletteControllers) is kept so the
    // search text / sort / open filter menu / scroll position survive a
    // refresh that doesn't actually change which template is focused — only
    // the swatch grid itself (and the progress-gated control availability)
    // is resynced on every call; the controls chrome is built once.

    const GPP_PALETTE_STYLE_ID = 'gpp-palette-style';

    const GPP_PALETTE_SORT_OPTIONS = [
        { value: 'default', text: 'Sort: Most used (default)' },
        { value: 'leastUsed', text: 'Sort: Least used' },
        { value: 'mostRemaining', text: 'Sort: Most remaining' },
        { value: 'leastRemaining', text: 'Sort: Least remaining' },
        { value: 'mostPct', text: 'Sort: Most % remaining' },
        { value: 'leastPct', text: 'Sort: Least % remaining' },
        { value: 'byColor', text: 'Sort: Color' },
        { value: 'byColorRev', text: 'Sort: Color reversed' },
    ];
    const GPP_PALETTE_PROGRESS_SORT_VALUES = new Set(['mostRemaining', 'leastRemaining', 'mostPct', 'leastPct']);

    const GPP_PALETTE_FILTER_OPTIONS = [
        // Same underlying behaviour as before (hide anything that isn't a
        // search hit) — renamed to match the clearer, more direct wording
        // requested ("Show search results only"), rather than adding a
        // second, functionally-identical checkbox alongside it.
        { value: 'hideUnmatched', text: 'Show search results only' },
        { value: 'hideCompleted', text: 'Hide completed colors' },
        { value: 'hideInProgress', text: 'Hide in-progress colors' },
        { value: 'hideUnstarted', text: 'Hide unstarted colors' },
        { value: 'ownedOnly', text: 'Owned colors only' },
        { value: 'countRange', text: 'Filter within pixel count…' },
    ];

    // Rewrites content every call (see gpp-init.js's theme-change observer)
    // instead of no-op-ing once created, so a live dark/light toggle isn't
    // frozen at whatever theme was active on first mount.
    function gppInjectPaletteStyle() {
        let style = document.getElementById(GPP_PALETTE_STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = GPP_PALETTE_STYLE_ID;
            document.head.appendChild(style);
        }
        style.textContent = `
            .gpp-palette-empty { font-size: 12px; color: ${t2('#64748b', '#a6adc8')}; padding: 6px 2px; }
            .gpp-palette-panel { display: flex; flex-direction: column; gap: 7px; margin: 8px 0; }
            /* The compact panel gets the same Grid/List control as View
               Settings, but it stays out of the normal palette layout so
               the two controls never appear as duplicate rows. */
            .gpp-palette-view-row.gpp-vs-row {
                display: none; align-items: center; gap: 8px; margin: 0;
            }
            .gpp-minified .gpp-palette-view-row.gpp-vs-row { display: flex; }
            .gpp-palette-view-row .gpp-vs-label {
                flex: 1 1 auto; min-width: 0; font-size: 11px;
                color: ${t2('#1f2937', '#e2e2f5')};
            }
            .gpp-palette-view-row .gpp-vs-view-toggle {
                display: flex; border-radius: 6px; overflow: hidden; flex-shrink: 0;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
            }
            .gpp-palette-view-row .gpp-vs-view-btn {
                font: inherit; font-size: 12px; line-height: 1; cursor: pointer; border: none; padding: 4px 8px;
                background: ${t2('#ffffff', '#313244')}; color: ${t2('#64748b', '#a6adc8')};
            }
            .gpp-palette-view-row .gpp-vs-view-btn:hover { background: ${t2('#f3f4f6', '#45475a')}; }
            .gpp-palette-view-row .gpp-vs-view-btn-active {
                background: ${t2('#2563eb', '#89b4fa')}; color: ${t2('#ffffff', '#1e1e2e')};
            }
            .gpp-gnc-group {
                padding: 6px 0; border-bottom: 1px solid ${t2('#e5e7eb', '#313244')};
            }
            .gpp-gnc-group:last-child { border-bottom: none; }
            .gpp-gnc-heading {
                display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
                color: ${t2('#111827', '#f5f5f5')}; margin-bottom: 4px;
            }
            .gpp-gnc-heading .gpp-gnc-meta { font-weight: 400; color: ${t2('#64748b', '#a6adc8')}; }
            .gpp-gnc-members { display: flex; flex-direction: column; gap: 2px; padding-left: 4px; }
            .gpp-gnc-member {
                display: flex; align-items: center; gap: 6px; font-size: 11px;
                color: ${t2('#1f2937', '#e2e2f5')};
            }
            .gpp-gnc-member .gpp-gnc-kept { font-weight: 600; color: ${t2('#16a34a', '#a6e3a1')}; }
            .gpp-gnc-swatch {
                display: inline-block; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
            }
            .gpp-gnc-hex { font-family: ui-monospace, Menlo, Consolas, monospace; }
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
            .gpp-palette-search-input {
                width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px;
                border: 2px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#ffffff', '#11111b')}; color: ${t2('#111827', '#f5f5f5')};
                font-size: 12px;
            }
            .gpp-palette-search-input:focus { outline: none; border-color: ${t2('#3b82f6', '#89b4fa')}; }
            .gpp-palette-search-input::placeholder { color: ${t2('#94a3b8', '#7f849c')}; }
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
            /* Buy all colors/Get hex values and Sort/Filters both use this
               exact 2-column CSS Grid (not flex:1 1 0) so their column
               boundaries are pixel-identical regardless of content — a grid
               track's minmax(0, 1fr) has no "shrink to content" ambiguity
               the way a flex item's automatic minimum size can, which is
               what caused these two rows to drift out of alignment before. */
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
            .gpp-palette-filter-count {
                display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
                padding: 3px 4px 4px 22px; font-size: 12px; color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-palette-count-input {
                width: 58px; box-sizing: border-box; padding: 2px 5px; font-size: 11px;
                border-radius: 5px; border: 2px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#ffffff', '#11111b')}; color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-palette-sort-wrap { flex: 1 1 0; min-width: 0; }
            .gpp-palette-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(26px, 1fr));
                /* Explicit row floor matching the column formula — Firefox
                   (unlike Chrome) can fail to derive a correct implicit row
                   height from aspect-ratio alone on grid items once the
                   container gets narrow enough to reflow the column count,
                   collapsing rows and stacking swatches on top of each
                   other. This gives it a real number to size rows from
                   instead of depending on that computation. */
                grid-auto-rows: minmax(26px, 1fr);
                gap: 3px; max-height: 260px; overflow-y: auto; padding: 2px;
                scrollbar-gutter: stable;
            }
            /* View Settings > Global > "Palette view" — list mode. Space-
               efficient rectangular rows instead of square tiles; same
               sort/filter pipeline (performFilterSort), just a different
               per-entry DOM shape (see gppPaletteApplyListLayout). Overrides
               the grid's own display:grid/grid-template-columns above. */
            .gpp-palette-grid.gpp-palette-list-mode {
                display: flex; flex-direction: column;
            }
            .gpp-swatch.gpp-swatch-list {
                aspect-ratio: auto; min-height: 26px; width: 100%;
                flex-direction: row; align-items: center; justify-content: flex-start;
                gap: 7px; padding: 3px 8px; border-radius: 6px;
                background: ${t2('#ffffff', '#181825')};
            }
            .gpp-swatch.gpp-swatch-list:hover { transform: none; background: ${t2('#f3f4f6', '#232336')}; }
            .gpp-palette-list-chip {
                width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
            }
            .gpp-palette-list-hex {
                font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; flex-shrink: 0;
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-palette-list-progress-text {
                font-size: 10px; margin-left: auto; flex-shrink: 0;
                color: ${t2('#64748b', '#a6adc8')};
            }
            .gpp-palette-list-bar-outer {
                width: 46px; height: 5px; border-radius: 3px; overflow: hidden; flex-shrink: 0;
                display: block; background: ${t2('#e5e7eb', '#313244')};
            }
            .gpp-palette-list-bar-fill { display: block; height: 100%; }
            .gpp-swatch {
                position: relative; aspect-ratio: 1 / 1; min-height: 15px; border-radius: 4px;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                padding: 0; transition: transform .08s ease;
            }
            .gpp-swatch:hover { transform: scale(1.15); z-index: 2; }
            /* Grayscale/opacity dimming is gated behind the grid's own
               .gpp-palette-gray-disabled modifier class (toggled in
               performFilterSort from gppSettings.grayDisabledSwatches — a
               View Settings > Global checkbox, on by default) — the
               diagonal slash below is NOT gated by it and always applies
               regardless, per explicit product decision: "gray" is an
               optional extra emphasis on top of the slash, not a
               replacement for it. */
            .gpp-palette-gray-disabled .gpp-swatch.gpp-swatch-off { filter: grayscale(.7) opacity(.4); }
            /* Diagonal slash across the whole tile — the merged progress/
               enabled indicator alone wasn't visually distinct enough from
               "enabled but low progress" at a glance (explicit product
               decision); this is on top of the grayscale/opacity above when
               that's also on, not a replacement for it. */
            .gpp-swatch.gpp-swatch-off::after {
                content: ''; position: absolute; inset: 0; pointer-events: none;
                border-radius: inherit;
                background: linear-gradient(to top right,
                    transparent calc(50% - 1px), rgba(50,50,50,.75) calc(50% - 1px),
                    rgba(50,50,50,.75) calc(50% + 1px), transparent calc(50% + 1px));
            }
            /* Single top-right indicator — merges the old separate on/off dot
               and completion-progress badge into one (per explicit product
               decision). pointer-events:none so it never intercepts the
               swatch's own hover/click/drag handling. The off-state rule
               below layers extra grayscale/opacity on top of the whole-button
               graying above, so the SAME dot communicates both progress and
               enabled/disabled. */
            .gpp-swatch-progress {
                position: absolute; top: 3px; right: 3px; width: 7px; height: 7px;
                border-radius: 50%; pointer-events: none; box-sizing: border-box;
                display: flex; align-items: center; justify-content: center;
                font-size: 6px; line-height: 1; font-weight: 900; color: #16a34a;
                box-shadow: 0 0 0 1px rgba(0,0,0,.55);
            }
            .gpp-swatch-progress-complete {
                top: 0; right: 0; width: 100%; height: 100%;
                background-color: transparent; box-shadow: none;
                /* Two overlapping strokes of the same path: a wider black
                   one drawn first, then the theme green on top narrower —
                   leaves a thin black outline visible on both edges so the
                   checkmark stays legible on bright/light swatch colors
                   (explicit product request, after the earlier white
                   drop-shadow glow was removed). */
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 13l5 5L20 6' fill='none' stroke='black' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M4 13l5 5L20 6' fill='none' stroke='${t2('%2316a34a', '%23a6e3a1')}' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
                background-repeat: no-repeat; background-position: center; background-size: 65% 65%;
            }
            .gpp-swatch-progress-unstarted { background: transparent; border: 1.5px solid #000; }
            .gpp-swatch-progress-inprogress { border: 1px solid rgba(0,0,0,.4); }
            .gpp-palette-gray-disabled .gpp-swatch.gpp-swatch-off .gpp-swatch-progress { filter: grayscale(1) opacity(.6); }
            /* Search-match glow — same pulse timing/box-shadow values as
               ghost-palette-search.js's .color-search-glow / pulse-glow, plus an
               added static white+black double ring so the gold glow itself
               stays visible no matter the swatch's own hue. */
            .gpp-swatch.gpp-palette-glow {
                animation: gpp-palette-pulse-glow 1.5s ease-in-out infinite;
                box-shadow: 0 0 0 2px rgba(255,255,255,.95), 0 0 0 4px rgba(0,0,0,.85), 0 0 8px 2px rgba(255,215,0,.8);
            }
            @keyframes gpp-palette-pulse-glow {
                0%, 100% { box-shadow: 0 0 0 2px rgba(255,255,255,.95), 0 0 0 4px rgba(0,0,0,.85), 0 0 8px 2px rgba(255,215,0,.8); }
                50% { box-shadow: 0 0 0 2px rgba(255,255,255,.95), 0 0 0 4px rgba(0,0,0,.85), 0 0 12px 3px rgba(255,215,0,1); }
            }
        `;
    }

    // gpp-scan.js's scanSummary carries per-colour breakdown as an array
    // (`perColour: [{index, correct, ...}, ...]`, one entry per palette
    // index that has any pixels — see that file's header comment), not an
    // object/array indexable by palette index directly. Building this
    // lookup once per performFilterSort() pass (rather than re-scanning
    // perColour per swatch) keeps sort/filter O(n) instead of O(n²).
    function gppPaletteBuildColourLookup(template) {
        const lookup = new Map();
        if (template.scanSummary) {
            template.scanSummary.perColour.forEach(entry => lookup.set(entry.index, entry));
        }
        return lookup;
    }

    // Per-swatch stats used by both sort and filter. `hasProgress` gates the
    // "remaining"/completion-based sort options and filter checkboxes exactly
    // like ghost-palette-search.js's syncProgressDependentControls() (see
    // that file's hasProgressStats()); here the gate is per-template (a
    // scanSummary either exists for the whole template or it doesn't) rather
    // than per-swatch-title-string. `colourLookup` is gppPaletteBuildColourLookup's
    // Map, keyed by palette index -> perColour entry; omit for a one-off call
    // (falls back to no progress data, matching the no-scan state).
    function gppPaletteStats(template, index, colourLookup) {
        const total = template.counts[index] || 0;
        const summary = template.scanSummary;
        const entry = colourLookup ? colourLookup.get(index) : null;
        const completed = summary && entry ? entry.correct : 0;
        const remaining = summary ? Math.max(0, total - completed) : 0;
        const remainingPercent = total > 0 ? (remaining / total) * 100 : 0;
        return { total, completed, remaining, remainingPercent };
    }

    // Interpolates red (0% complete) -> green (100% complete) for the
    // in-progress swatch badge, per the user's explicit "red-to-green
    // gradient shading" request.
    function gppPaletteProgressColor(fraction) {
        const clamped = Math.max(0, Math.min(1, fraction));
        const from = [220, 38, 38];   // tailwind red-600
        const to = [34, 197, 94];     // tailwind green-500
        const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * clamped));
        return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }

    // ── "Sync with selected color" Ghost++ compatibility ─────────────────
    // The legacy Ghost Palette Color Search tool's own ♻️ "Sync Ghost With
    // Selected Color" button (ghost-palette-search.js, under
    // #imageGroupDropdown — deliberately NOT duplicated as a second button
    // inside Ghost++'s own panel, per explicit product decision: same
    // button, same toggle, same location as before Ghost++ existed) works
    // by directly manipulating the NATIVE #ghostColorPalette DOM. That
    // element is only ever (re)built by the native populateColorPaletteUI(),
    // which only runs from the native "load a ghost image" flow
    // (loadGhostImageBtn click / ghostImageInput change — see
    // js/ghost22.js). gpp-native-shim.js deliberately intercepts and blocks
    // both of those while Ghost++ owns the overlay slot
    // (GPP_NATIVE_CONTROL_TARGETS), so #ghostColorPalette never gets
    // populated for whatever template Ghost++ has focused — the legacy
    // toggle would otherwise silently find zero swatches to act on.
    //
    // This is the compatibility seam: ghost-palette-search.js's own
    // applyAutoEnableSelectedColor calls this FIRST and skips its native-DOM
    // path entirely whenever it returns true (Ghost++ has a template
    // focused) — see that file's own updated comment. No enabled/disabled
    // state of its own here; the legacy button's existing _syncGhostEnabled
    // toggle is still the only ON/OFF switch, exactly as before.
    function gppApplySelectedColorToFocusedTemplate(color) {
        if (typeof gppState === 'undefined' || typeof color !== 'string' || !color) return false;
        const template = gppState.getFocusedTemplate();
        if (!template || !template.palette || !template.palette.length) return false;
        // Native paint-color values are 8-digit RGBA hex strings, e.g.
        // "#FF0000FF" (Colors[index] — see js/index148.js's SetColors,
        // whose swatch buttons use the hex string itself as both their id
        // and their onclick's changeColor(color) argument). Ghost++'s own
        // palette hex (core.packedToHex) is 6-digit RGB with no alpha
        // channel — compare on just that leading portion, uppercased, same
        // normalization the legacy tool's own applyAutoEnableSelectedColor
        // already used.
        const hex = (color.length >= 7 ? color.slice(0, 7) : color).toUpperCase();
        const core = gppCreateCore();
        let changed = false;
        for (let index = 0; index < template.palette.length; index++) {
            const isMatch = core.packedToHex(template.palette[index]) === hex;
            if (core.maskHas(template.mask, index) !== isMatch) {
                core.maskSet(template.mask, index, isMatch);
                changed = true;
            }
        }
        if (changed) {
            gppState.persistTemplateState(template).catch(err => {
                console.error('[GeoPixelcons++] Ghost++ palette: failed to persist color-sync mask change.', err);
            });
            if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
            if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        }
        return true; // Ghost++ handled this (a focused template exists) regardless of whether the mask actually changed
    }

    // List-mode row content, shared by buildSwatch/buildGroupSwatch — a
    // color chip (the tile's own background color moves here, since the
    // row itself needs a neutral background for the hex/progress text to
    // stay readable), the hex value, "<completed>/<total>" (the "x/y" the
    // list view was asked to show), and a mini progress bar. The per-swatch
    // corner completion badge (gpp-swatch-progress) is grid-mode only —
    // this row's own progress text/bar already conveys the same thing,
    // spelled out instead of iconified.
    function gppPaletteApplyListLayout(button, hex, stats, hasProgress) {
        const chip = document.createElement('span');
        chip.className = 'gpp-palette-list-chip';
        chip.style.backgroundColor = hex;
        chip.setAttribute('aria-hidden', 'true');

        const hexLabel = document.createElement('span');
        hexLabel.className = 'gpp-palette-list-hex';
        hexLabel.textContent = hex;

        const progressText = document.createElement('span');
        progressText.className = 'gpp-palette-list-progress-text';
        progressText.textContent = hasProgress
            ? `${stats.completed.toLocaleString()}/${stats.total.toLocaleString()}`
            : `${stats.total.toLocaleString()} px`;

        const barOuter = document.createElement('span');
        barOuter.className = 'gpp-palette-list-bar-outer';
        if (hasProgress && stats.total > 0) {
            const fraction = Math.max(0, Math.min(1, stats.completed / stats.total));
            const barFill = document.createElement('span');
            barFill.className = 'gpp-palette-list-bar-fill';
            barFill.style.width = Math.round(fraction * 100) + '%';
            barFill.style.background = gppPaletteProgressColor(fraction);
            barOuter.appendChild(barFill);
        }

        button.append(chip, hexLabel, progressText, barOuter);
    }

    // ── Custom floating swatch tooltip (mouse-following) ────────────────
    // Replaces the native `title` attribute and the old shared "Hex:"
    // readout row — hovering a swatch shows hex + completed/remaining right
    // next to the cursor instead, per explicit product decision ("make it
    // feel much more responsive and interactive"). Singleton element, built
    // lazily on first hover and reused for every swatch afterward, same
    // pattern as gpp-library.js's floating hover preview.
    let gppPaletteTooltipEl = null;
    function gppPaletteEnsureTooltipEl() {
        if (gppPaletteTooltipEl && document.body.contains(gppPaletteTooltipEl)) return gppPaletteTooltipEl;
        const el = document.createElement('div');
        el.id = 'gpp-palette-tooltip';
        document.body.appendChild(el);
        gppPaletteTooltipEl = el;
        return el;
    }
    function gppPaletteShowTooltip(event, hex, stats, hasProgress) {
        const el = gppPaletteEnsureTooltipEl();
        const hexLine = document.createElement('div');
        hexLine.className = 'gpp-palette-tooltip-hex';
        const swatchDot = document.createElement('span');
        swatchDot.className = 'gpp-palette-tooltip-swatch';
        swatchDot.style.backgroundColor = hex;
        hexLine.append(swatchDot, document.createTextNode(hex));
        const statsLine = document.createElement('div');
        statsLine.className = 'gpp-palette-tooltip-stats';
        statsLine.textContent = hasProgress
            ? `${stats.completed.toLocaleString()} / ${stats.total.toLocaleString()} placed`
            : `${stats.total.toLocaleString()} px`;
        el.innerHTML = '';
        el.append(hexLine, statsLine);
        el.style.display = 'block';
        gppPaletteMoveTooltip(event);
    }
    function gppPaletteMoveTooltip(event) {
        const el = gppPaletteTooltipEl;
        if (!el || el.style.display === 'none') return;
        const margin = 14;
        let left = event.clientX + margin;
        let top = event.clientY + margin;
        const rect = el.getBoundingClientRect();
        if (left + rect.width > window.innerWidth) left = event.clientX - rect.width - margin;
        if (top + rect.height > window.innerHeight) top = event.clientY - rect.height - margin;
        el.style.left = Math.max(4, left) + 'px';
        el.style.top = Math.max(4, top) + 'px';
    }
    function gppPaletteHideTooltip() {
        if (gppPaletteTooltipEl) gppPaletteTooltipEl.style.display = 'none';
    }

    // container element -> live controller. A WeakMap needs no manual
    // cleanup: when gpp-init.js's renderShell() rebuilds the left panel on
    // every modal open, the old container (and its controller) are simply
    // garbage-collected.
    const gppPaletteControllers = new WeakMap();

    function gppRenderPalette(container, template, onChange) {
        if (!container) return;
        gppInjectPaletteStyle();
        const templateKey = template ? template.id : null;
        let controller = gppPaletteControllers.get(container);
        if (!controller || controller.templateKey !== templateKey) {
            controller = gppCreatePaletteController(container);
            controller.templateKey = templateKey;
            gppPaletteControllers.set(container, controller);
        }
        controller.update(template, onChange);
    }

    function gppCreatePaletteController(container) {
        const core = gppCreateCore();

        // Preserve open/closed state across a template switch (which rebuilds
        // this whole controller from scratch, unlike an ordinary same-
        // template refresh) — same pattern as every other gpp-init.js
        // section's <details>. Defaults to open on the very first render.
        const previousDetails = container.querySelector('details.gpp-collapsible');
        const wasOpen = previousDetails ? previousDetails.open : true;
        // Separate id (not just `details.gpp-collapsible`, which would match
        // the Template Colors details above instead) since this is a SECOND
        // collapsible in the same container — defaults to collapsed, unlike
        // every other section here.
        const previousGncDetails = container.querySelector('#gpp-palette-gnc-details');
        const gncWasOpen = previousGncDetails ? previousGncDetails.open : false;
        container.innerHTML = '';

        const controller = { template: null, onChange: null, templateKey: undefined };

        const details = document.createElement('details');
        details.className = 'gpp-collapsible';
        details.open = wasOpen;
        const summary = document.createElement('summary');
        summary.textContent = 'Template Colors';
        details.appendChild(summary);
        const detailsBody = document.createElement('div');
        detailsBody.className = 'gpp-body';
        details.appendChild(detailsBody);
        container.appendChild(details);

        // Group Noise Changes — only shown when template.groupNoise is on
        // AND it actually merged 2+ colours together (see
        // updateGroupNoiseChanges below, called from performFilterSort right
        // after groupNoiseData is computed/refreshed). Hidden via
        // display:none rather than left out of the DOM entirely so its own
        // open/closed toggle survives being hidden and re-shown.
        const gncDetails = document.createElement('details');
        gncDetails.id = 'gpp-palette-gnc-details';
        gncDetails.className = 'gpp-collapsible';
        gncDetails.open = gncWasOpen;
        gncDetails.style.display = 'none';
        const gncSummary = document.createElement('summary');
        gncSummary.textContent = 'Group Noise Changes';
        gncDetails.appendChild(gncSummary);
        const gncBody = document.createElement('div');
        gncBody.className = 'gpp-body';
        gncDetails.appendChild(gncBody);
        container.appendChild(gncDetails);

        // Left empty (no text) when no template is focused — the drop zone
        // above already makes the next step obvious.
        const emptyEl = document.createElement('div');
        emptyEl.className = 'gpp-palette-empty';
        detailsBody.appendChild(emptyEl);

        const panel = document.createElement('div');
        panel.className = 'gpp-palette-panel';
        panel.style.display = 'none';
        detailsBody.appendChild(panel);

        // ── Search box + "show matches at top" ──────────────────────────
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'gpp-palette-search-input';
        searchInput.placeholder = 'Search hex (comma/space separated for multiple)';
        panel.appendChild(searchInput);

        // ── Bulk actions: three rows, per explicit product decision — each
        // pair grouped by what it acts on (everything / a personal subset /
        // your in-game palette), with self-explanatory labels instead of
        // the old bare "All"/"None"/"Owned".
        const bulkRowTop = document.createElement('div');
        bulkRowTop.className = 'gpp-palette-bulk-row';
        // id (not just the shared .gpp-palette-bulk-row class three rows
        // here carry) so gpp-ui-shell.js's minified-view CSS can single this
        // ROW out as the one bulk-action row that survives minified mode --
        // see its own comment for why.
        bulkRowTop.id = 'gpp-palette-bulk-top';
        const allBtn = document.createElement('button');
        allBtn.type = 'button'; allBtn.textContent = 'Enable all'; allBtn.title = 'Enable every color';
        const noneBtn = document.createElement('button');
        noneBtn.type = 'button'; noneBtn.textContent = 'Disable all'; noneBtn.title = 'Disable every color';

        const bulkRowMiddle = document.createElement('div');
        bulkRowMiddle.className = 'gpp-palette-bulk-row';
        const ownedBtn = document.createElement('button');
        ownedBtn.type = 'button'; ownedBtn.textContent = 'Enable owned'; ownedBtn.title = 'Enable only colors you own';
        const enableFilteredBtn = document.createElement('button');
        enableFilteredBtn.type = 'button'; enableFilteredBtn.textContent = 'Enable filtered';
        enableFilteredBtn.title = 'Enable only colors currently matching the search box / filter checkboxes below, and disable the rest';

        const bulkRowBottom = document.createElement('div');
        bulkRowBottom.className = 'gpp-palette-bulk-row';
        const activeBtn = document.createElement('button');
        activeBtn.type = 'button'; activeBtn.textContent = 'Match palette'; activeBtn.title = 'Enable only colors currently active in your game palette';
        // Calls the native setGhostColorsAsActivePalette() directly — it
        // already reads ghostActivePaletteColors, which Ghost++'s
        // compatibility shim (gpp-native-shim.js) keeps mirrored to this
        // template's own enabled colors, so no reimplementation is needed
        // here. A plain function DECLARATION in ghost22.js (unlike a `let`
        // binding), so it attaches to window normally and unsafeWindow can
        // call it directly — no page-realm injection needed.
        const setPaletteBtn = document.createElement('button');
        setPaletteBtn.type = 'button';
        setPaletteBtn.textContent = 'Set palette';
        setPaletteBtn.title = "Set your in-game active palette to exactly this template's enabled colors (same as the native ghost tool's own \"Set Palette\")";
        setPaletteBtn.addEventListener('click', () => {
            const target = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (typeof target.setGhostColorsAsActivePalette === 'function') {
                target.setGhostColorsAsActivePalette();
            }
        });

        // Compact-mode palette view — the same persisted Grid/List choice as
        // View Settings, placed directly below Enable all / Disable all.
        // These controls intentionally have no ids because the full View
        // Settings section already owns the stable ids for its own pair.
        const paletteViewRow = document.createElement('div');
        paletteViewRow.className = 'gpp-vs-row gpp-palette-view-row';
        const paletteViewLabel = document.createElement('span');
        paletteViewLabel.className = 'gpp-vs-label';
        paletteViewLabel.textContent = 'Palette view';
        const paletteViewToggle = document.createElement('div');
        paletteViewToggle.className = 'gpp-vs-view-toggle';
        const compactGridBtn = document.createElement('button');
        compactGridBtn.type = 'button';
        compactGridBtn.className = 'gpp-vs-view-btn';
        compactGridBtn.dataset.gppPaletteView = 'grid';
        compactGridBtn.textContent = '▦';
        compactGridBtn.title = 'Grid view';
        compactGridBtn.setAttribute('aria-label', 'Grid view');
        const compactListBtn = document.createElement('button');
        compactListBtn.type = 'button';
        compactListBtn.className = 'gpp-vs-view-btn';
        compactListBtn.dataset.gppPaletteView = 'list';
        compactListBtn.textContent = '☰';
        compactListBtn.title = 'List view';
        compactListBtn.setAttribute('aria-label', 'List view');
        function syncCompactPaletteViewButtons() {
            const mode = gppSettings.paletteViewMode === 'list' ? 'list' : 'grid';
            compactGridBtn.classList.toggle('gpp-vs-view-btn-active', mode === 'grid');
            compactListBtn.classList.toggle('gpp-vs-view-btn-active', mode === 'list');
            compactGridBtn.setAttribute('aria-pressed', String(mode === 'grid'));
            compactListBtn.setAttribute('aria-pressed', String(mode === 'list'));
        }
        function setCompactPaletteViewMode(mode) {
            if (gppSettings.paletteViewMode === mode) return;
            gppSettings.paletteViewMode = mode;
            gppState.saveSettings();
            syncCompactPaletteViewButtons();
            performFilterSort();
            if (typeof controller.onChange === 'function') controller.onChange();
        }
        compactGridBtn.addEventListener('click', () => setCompactPaletteViewMode('grid'));
        compactListBtn.addEventListener('click', () => setCompactPaletteViewMode('list'));
        paletteViewToggle.append(compactGridBtn, compactListBtn);
        paletteViewRow.append(paletteViewLabel, paletteViewToggle);
        syncCompactPaletteViewButtons();

        bulkRowTop.append(allBtn, noneBtn);
        bulkRowMiddle.append(ownedBtn, enableFilteredBtn);
        bulkRowBottom.append(activeBtn, setPaletteBtn);
        panel.append(bulkRowTop, paletteViewRow, bulkRowMiddle, bulkRowBottom);

        // No "Sync with selected color" button here — per explicit product
        // decision, that stays the legacy Ghost Palette Color Search tool's
        // own ♻️ button under #imageGroupDropdown (unchanged location), not
        // a duplicate control inside Ghost++'s own panel. See
        // gppApplySelectedColorToFocusedTemplate above for the compatibility
        // seam that makes that existing button work correctly against
        // Ghost++'s focused template.

        // Own row, below the three bulk-action rows above — per explicit
        // product decision, kept visually separate since it triggers a
        // purchase flow rather than just changing which colors are enabled.
        const buyRow = document.createElement('div');
        buyRow.className = 'gpp-palette-bulk-row gpp-palette-2col-row';
        const buyBtn = document.createElement('button');
        buyBtn.type = 'button'; buyBtn.textContent = 'Buy all colors';
        buyBtn.title = "Reveal the profile panel's Bulk Purchase Colors card, pre-filled with every color in this template you don't already own";
        buyRow.appendChild(buyBtn);

        // ── "Get hex values" dropdown ─────────────────────────────────────
        // Reuses the filter dropdown's own popup-menu classes/behaviour
        // (gpp-palette-filter-dropdown/-button/-menu/-option, .gpp-open) —
        // a generic small popup pattern already established in this file,
        // not specific to the filter checkboxes despite the class names.
        // "Filtered" means whatever the search box + filter checkboxes
        // currently leave visible — the exact same `visible` index list
        // performFilterSort() last computed into renderState.
        const hexDropdown = document.createElement('div');
        hexDropdown.className = 'gpp-palette-filter-dropdown';
        const hexButton = document.createElement('button');
        hexButton.type = 'button';
        hexButton.className = 'gpp-palette-filter-button';
        const hexButtonText = document.createElement('span');
        hexButtonText.textContent = 'Get hex values';
        const hexArrow = document.createElement('span');
        hexArrow.textContent = '▾';
        hexArrow.style.cssText = 'font-size:10px;opacity:.7;';
        hexButton.append(hexButtonText, hexArrow);

        const hexMenu = document.createElement('div');
        hexMenu.className = 'gpp-palette-filter-menu';
        const GPP_HEX_VALUE_SCOPES = [
            { value: 'all', text: 'All colors' },
            { value: 'owned', text: 'Owned colors only' },
            { value: 'notOwned', text: 'Not owned colors only' },
            { value: 'enabled', text: 'Enabled colors only' },
            { value: 'enabledOwned', text: 'Enabled + owned colors' },
            { value: 'filtered', text: 'Filtered colors only' },
            { value: 'filteredOwned', text: 'Filtered + owned colors only' },
        ];

        function copyHexValuesForScope(scope) {
            const template = controller.template;
            if (!template) return;
            const ownedHex = new Set(gppReadGamePalette().map(row => String(row.hex).toUpperCase()));
            const filteredSet = new Set(renderState.visible || []);
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
            const flashCopied = () => {
                hexButtonText.textContent = hexes.length ? `Copied ${hexes.length}!` : 'Nothing to copy';
                setTimeout(() => { hexButtonText.textContent = 'Get hex values'; }, 1200);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(flashCopied).catch(() => alert(text || 'No matching colors.'));
            } else {
                alert(text || 'No matching colors.');
            }
        }

        GPP_HEX_VALUE_SCOPES.forEach(({ value, text }) => {
            const option = document.createElement('div');
            option.className = 'gpp-palette-filter-option';
            option.textContent = text;
            option.addEventListener('click', () => {
                hexMenu.classList.remove('gpp-open');
                copyHexValuesForScope(value);
            });
            hexMenu.appendChild(option);
        });
        hexButton.addEventListener('click', event => {
            event.stopPropagation();
            hexMenu.classList.toggle('gpp-open');
        });
        hexMenu.addEventListener('click', event => event.stopPropagation());
        document.addEventListener('click', () => hexMenu.classList.remove('gpp-open'));
        hexDropdown.append(hexButton, hexMenu);
        buyRow.appendChild(hexDropdown);

        panel.appendChild(buyRow);

        // ── Filters dropdown ──────────────────────────────────────────────
        const controlsRow = document.createElement('div');
        controlsRow.className = 'gpp-palette-controls-row gpp-palette-2col-row';

        const filterDropdown = document.createElement('div');
        filterDropdown.className = 'gpp-palette-filter-dropdown';
        const filterButton = document.createElement('button');
        filterButton.type = 'button';
        filterButton.className = 'gpp-palette-filter-button';
        const filterButtonText = document.createElement('span');
        filterButtonText.textContent = 'Filters';
        const filterArrow = document.createElement('span');
        filterArrow.textContent = '▾';
        filterArrow.style.cssText = 'font-size:10px;opacity:.7;';
        filterButton.append(filterButtonText, filterArrow);

        const filterMenu = document.createElement('div');
        filterMenu.className = 'gpp-palette-filter-menu';

        const filterInputs = [];
        let countMinInput = null;
        let countMaxInput = null;
        GPP_PALETTE_FILTER_OPTIONS.forEach(({ value, text }) => {
            const label = document.createElement('label');
            label.className = 'gpp-palette-filter-option';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = value;
            input.addEventListener('change', () => {
                gppTryAutoScan();
                updateFilterButtonLabel();
                performFilterSort();
            });
            filterInputs.push({ input, label, value });
            const span = document.createElement('span');
            span.textContent = text;
            label.append(input, span);
            filterMenu.appendChild(label);
        });

        const countSubRow = document.createElement('div');
        countSubRow.className = 'gpp-palette-filter-count';
        countSubRow.style.display = 'none';
        countMinInput = document.createElement('input');
        countMinInput.type = 'number'; countMinInput.min = '0'; countMinInput.placeholder = 'min';
        countMinInput.className = 'gpp-palette-count-input';
        countMaxInput = document.createElement('input');
        countMaxInput.type = 'number'; countMaxInput.min = '0'; countMaxInput.placeholder = 'max';
        countMaxInput.className = 'gpp-palette-count-input';
        const countDash = document.createElement('span');
        countDash.textContent = '–'; countDash.style.opacity = '.6';
        [countMinInput, countMaxInput].forEach(input => input.addEventListener('input', () => { gppTryAutoScan(); performFilterSort(); }));
        countSubRow.append(countMinInput, countDash, countMaxInput);
        filterMenu.appendChild(countSubRow);

        const countRangeEntry = filterInputs.find(entry => entry.value === 'countRange');
        if (countRangeEntry) {
            countRangeEntry.input.addEventListener('change', () => {
                countSubRow.style.display = countRangeEntry.input.checked ? '' : 'none';
                if (!countRangeEntry.input.checked) {
                    countMinInput.value = '';
                    countMaxInput.value = '';
                }
            });
        }

        function updateFilterButtonLabel() {
            const n = filterInputs.filter(entry => entry.input.checked).length;
            filterButtonText.textContent = n ? `Filters (${n})` : 'Filters';
        }

        filterButton.addEventListener('click', event => {
            event.stopPropagation();
            filterMenu.classList.toggle('gpp-open');
        });
        filterMenu.addEventListener('click', event => event.stopPropagation());
        document.addEventListener('click', () => filterMenu.classList.remove('gpp-open'));

        filterDropdown.append(filterButton, filterMenu);

        // ── Sort dropdown ───────────────────────────────────────────────
        const sortWrap = document.createElement('div');
        sortWrap.className = 'gpp-palette-sort-wrap';
        const sortSelect = document.createElement('select');
        sortSelect.className = 'gpp-palette-sort-select';
        sortSelect.title = 'Scroll while hovering to change sort order';
        GPP_PALETTE_SORT_OPTIONS.forEach(({ value, text }) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            sortSelect.appendChild(opt);
        });
        sortSelect.addEventListener('change', () => { gppTryAutoScan(); performFilterSort(); });
        sortSelect.addEventListener('wheel', event => {
            event.preventDefault();
            const dir = event.deltaY > 0 ? 1 : -1;
            let next = sortSelect.selectedIndex + dir;
            while (next >= 0 && next < sortSelect.options.length && sortSelect.options[next].disabled) next += dir;
            next = Math.min(Math.max(next, 0), sortSelect.options.length - 1);
            if (next !== sortSelect.selectedIndex) {
                sortSelect.selectedIndex = next;
                gppTryAutoScan();
                performFilterSort();
            }
        }, { passive: false });
        sortWrap.appendChild(sortSelect);

        // Sort on the left, Filters on the right — per explicit product decision.
        controlsRow.append(sortWrap, filterDropdown);
        panel.appendChild(controlsRow);

        // ── Grid ─────────────────────────────────────────────────────────
        const grid = document.createElement('div');
        grid.className = 'gpp-palette-grid';
        panel.appendChild(grid);

        // Progressive rendering: an initial batch, then more appended as the
        // user scrolls near the bottom — no hard cap + "narrow your search"
        // message. `renderState` tracks the full sorted/filtered index list
        // for the CURRENT search/filter/sort pass so scrolling can keep
        // appending from it without recomputing the whole pass.
        const GPP_PALETTE_BATCH_SIZE = 200;
        let renderState = { visible: [], visibleGroups: null, matching: null, colourLookup: null, shownCount: 0 };

        function renderNextBatch() {
            const { visible, visibleGroups, matching, colourLookup } = renderState;
            const renderList = visibleGroups || visible;
            const groupNoiseData = visibleGroups ? controller.template.groupNoiseData : null;
            let start = renderState.shownCount;
            for (;;) {
                const end = Math.min(renderList.length, start + GPP_PALETTE_BATCH_SIZE);
                for (let i = start; i < end; i++) {
                    const entry = renderList[i];
                    grid.appendChild(
                        visibleGroups
                            ? buildGroupSwatch(controller.template, entry, groupNoiseData, matching, colourLookup)
                            : buildSwatch(controller.template, entry, matching.has(entry), colourLookup)
                    );
                }
                renderState.shownCount = end;
                // BUG FIX: on a wide left panel, the CSS grid can fit 200+
                // swatches per row without ever overflowing max-height, so
                // grid.scrollHeight never exceeds grid.clientHeight, the
                // 'scroll' listener below never fires, and this function
                // would otherwise never get called again — users get stuck
                // seeing only the first batch forever. If the grid still
                // isn't scrollable and more items remain, keep rendering
                // batches immediately instead of waiting for a scroll that
                // will never come. `end === start` (a batch made no
                // progress) always stops the loop, so this is bounded by
                // renderList.length / GPP_PALETTE_BATCH_SIZE either way.
                if (end === start || renderState.shownCount >= renderList.length || grid.scrollHeight > grid.clientHeight) break;
                start = end;
            }
        }

        grid.addEventListener('scroll', () => {
            const total = (renderState.visibleGroups || renderState.visible).length;
            if (renderState.shownCount >= total) return;
            // Within ~2 batches' worth of scroll from the bottom, load more.
            if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 400) renderNextBatch();
        });

        // ── Drag-to-toggle: hold LEFT + drag to enable every swatch passed
        // over, hold RIGHT + drag to disable — mirrors the drag-paint
        // interaction common in palette/selection UIs. Only engages once the
        // pointer actually leaves the swatch it was pressed on (see the
        // mousemove listener below), so a plain click/right-click keeps
        // behaving exactly like before (click handler in buildSwatch / native
        // context menu) — no double-toggle, no menu suppressed on a
        // stationary right-click.
        let dragPaint = null; // { button, originEl, visited: Set<index> } while a press might turn into a drag
        let suppressNextClick = false;
        // Tracks where the GESTURE started, not where the eventual contextmenu
        // event's target ends up — a real drag routinely finishes just past
        // the grid's tight bounding box, and a target-based check misses that.
        // Safety-timer-cleared so a contextmenu event that never fires (for
        // any reason) can't leave unrelated right-clicks elsewhere on the
        // page permanently suppressed.
        let rightMouseDownInGrid = false;
        let rightMouseDownSafetyTimer = null;

        function setSwatchMaskState(swatchEl, hex, nowEnabled) {
            swatchEl.classList.toggle('gpp-swatch-off', !nowEnabled);
            swatchEl.setAttribute('aria-pressed', String(nowEnabled));
            swatchEl.setAttribute('aria-label', `${nowEnabled ? 'Hide' : 'Show'} ${hex}`);
            const currentTemplate = controller.template;
            if (currentTemplate) {
                gppState.persistTemplateState(currentTemplate).catch(err => {
                    console.error('[GeoPixelcons++] Ghost++ palette: failed to persist template state', err);
                });
            }
            if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
            if (typeof controller.onChange === 'function') controller.onChange();
        }

        // Reused by both the drag gesture and buildSwatch's click handler so
        // there's one shared toggle+persist call site — gated per
        // dragPaint.visited so a swatch already painted this gesture is
        // never re-toggled on a repeated pass.
        function applyDragPaintTo(swatchEl) {
            if (!dragPaint || !swatchEl) return;
            const index = Number(swatchEl.dataset.colorIndex);
            if (Number.isNaN(index) || dragPaint.visited.has(index)) return;
            dragPaint.visited.add(index);
            const template = controller.template;
            if (!template) return;
            const targetEnabled = dragPaint.button === 0; // left drag enables, right drag disables
            // Group Noise: a grouped swatch carries every member index it
            // represents (see buildGroupSwatch) — drag-paint the whole group
            // together, same as a click, instead of just its representative.
            const memberIndices = swatchEl.dataset.groupMembers
                ? swatchEl.dataset.groupMembers.split(',').map(Number)
                : [index];
            if (memberIndices.every(i => core.maskHas(template.mask, i) === targetEnabled)) return; // already at target state
            memberIndices.forEach(i => core.maskSet(template.mask, i, targetEnabled));
            setSwatchMaskState(swatchEl, core.packedToHex(template.palette[index]), targetEnabled);
        }

        grid.addEventListener('mousedown', event => {
            if (event.button !== 0 && event.button !== 2) return;
            const swatchEl = event.target.closest && event.target.closest('.gpp-swatch');
            if (!swatchEl || !controller.template) return;
            if (event.button === 2) {
                rightMouseDownInGrid = true;
                clearTimeout(rightMouseDownSafetyTimer);
                rightMouseDownSafetyTimer = setTimeout(() => { rightMouseDownInGrid = false; }, 2000);
            }
            dragPaint = { button: event.button, originEl: swatchEl, visited: new Set() };
        });

        grid.addEventListener('mousemove', event => {
            if (!dragPaint) return;
            const swatchEl = event.target.closest && event.target.closest('.gpp-swatch');
            if (!swatchEl) return;
            if (dragPaint.visited.size === 0 && swatchEl !== dragPaint.originEl) {
                // Pointer has actually left the origin swatch — this is a
                // real drag, not a plain click. Paint the origin too (it was
                // "passed over" as part of the gesture) and stop the click
                // that fires on release from acting on top of it.
                if (dragPaint.button === 0) suppressNextClick = true;
                applyDragPaintTo(dragPaint.originEl);
            }
            applyDragPaintTo(swatchEl);
        });

        // Listen on document, not just grid, so a release outside the grid
        // bounds (dragged past its edge) still ends the gesture.
        document.addEventListener('mouseup', () => { dragPaint = null; });

        // Unconditionally suppress the native context menu for any right-
        // click gesture that started on a swatch — mirrors
        // paint-brush-swap.js's own grid.addEventListener('contextmenu', e
        // => e.preventDefault()): right-click is entirely repurposed here
        // (drag-to-disable), so there's no legitimate native-menu use case
        // to preserve, whether or not the press actually turned into a
        // drag. Scoped to document (not grid) and keyed off where the
        // GESTURE STARTED (rightMouseDownInGrid), not where the contextmenu
        // event's target ends up, since a real drag routinely finishes just
        // past the grid's tight bounding box.
        document.addEventListener('contextmenu', event => {
            if (rightMouseDownInGrid) {
                rightMouseDownInGrid = false;
                clearTimeout(rightMouseDownSafetyTimer);
                event.preventDefault();
            }
        });

        searchInput.addEventListener('input', () => performFilterSort());

        // ── Bulk action wiring ─────────────────────────────────────────
        function persistAndNotify(template) {
            gppState.persistTemplateState(template).catch(err => {
                console.error('[GeoPixelcons++] Ghost++ palette: failed to persist template state', err);
            });
            if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
            performFilterSort();
            if (typeof controller.onChange === 'function') controller.onChange();
        }

        allBtn.addEventListener('click', () => {
            const template = controller.template;
            if (!template) return;
            gppTryAutoScan();
            template.mask = core.makeFullMask(template.palette.length, template.counts);
            persistAndNotify(template);
        });
        noneBtn.addEventListener('click', () => {
            const template = controller.template;
            if (!template) return;
            template.mask = new Uint32Array(Math.ceil(template.palette.length / 32));
            persistAndNotify(template);
        });
        // gppTryAutoScan() covers both activeBtn and ownedBtn below, per
        // explicit product decision this only applies to Enable actions,
        // not Disable (noneBtn above is deliberately exempt).
        function applyGamePaletteMask(activeOnly) {
            const template = controller.template;
            if (!template) return;
            gppTryAutoScan();
            const rows = gppReadGamePalette();
            const allowedHex = new Set();
            rows.forEach(row => {
                if (!row || (activeOnly && !row.active)) return;
                if (row.hex) allowedHex.add(String(row.hex).toUpperCase());
            });
            const mask = new Uint32Array(Math.ceil(template.palette.length / 32));
            for (let index = 0; index < template.palette.length; index++) {
                if (allowedHex.has(core.packedToHex(template.palette[index]))) core.maskSet(mask, index, true);
            }
            template.mask = mask;
            persistAndNotify(template);
        }
        activeBtn.addEventListener('click', () => applyGamePaletteMask(true));
        ownedBtn.addEventListener('click', () => applyGamePaletteMask(false));
        // "Enable filtered" — same meaning as the "Filtered colors only"
        // scope in the Get hex values dropdown above: whatever the search
        // box + filter checkboxes currently leave visible, per
        // performFilterSort()'s own renderState.visible (the raw, ungrouped
        // index list — even with Group Noise on, this replaces every
        // member's own mask bit individually, matching how All/None/Owned
        // above already operate on raw indices rather than group
        // representatives).
        enableFilteredBtn.addEventListener('click', () => {
            const template = controller.template;
            if (!template) return;
            gppTryAutoScan();
            // renderState.visible alone is NOT enough here: typing a search
            // term without ALSO checking "Show search results only"
            // (hideUnmatched) only sorts/glows matches by default — it does
            // not exclude non-matches from `visible` (see
            // performFilterSort's own isUnmatched handling). A user who
            // just typed a search and clicks a button literally called
            // "Enable filtered" expects it to act on those matches, not
            // require separately finding and checking a hidden checkbox
            // first — so an active search term is treated as its own
            // exclusion criterion here regardless of that checkbox's real
            // state, while everything else `visible` already excludes
            // (hideCompleted/hideInProgress/hideUnstarted/ownedOnly/
            // countRange, all independent of hideUnmatched) is still
            // respected as-is.
            const hasActiveSearch = searchInput.value.trim().length > 0;
            const matchingSet = renderState.matching || new Set();
            const mask = new Uint32Array(Math.ceil(template.palette.length / 32));
            (renderState.visible || []).forEach(index => {
                if (hasActiveSearch && !matchingSet.has(index)) return;
                core.maskSet(mask, index, true);
            });
            template.mask = mask;
            persistAndNotify(template);
        });
        buyBtn.addEventListener('click', () => {
            const template = controller.template;
            if (!template) return;
            if (typeof gppBulkPurchaseOpenProfilePanel !== 'function') {
                alert('Bulk Purchase Colors is disabled in GeoPixelcons++ settings.');
                return;
            }
            const ownedHex = new Set(gppReadGamePalette().map(row => String(row.hex).toUpperCase()));
            const seen = new Set();
            const needed = [];
            for (let index = 0; index < template.palette.length; index++) {
                const hex = core.packedToHex(template.palette[index]);
                if (ownedHex.has(hex) || seen.has(hex)) continue;
                seen.add(hex);
                needed.push(hex);
            }
            if (!needed.length) {
                alert('Every color in this template is already owned.');
                return;
            }
            // Reveals the profile panel's Bulk Purchase Colors card and
            // autopopulates its textarea — mirrors the legacy native-ghost-
            // menu "Bulk Purchase Colors" button's own flow (see
            // bulk-purchase-colors.js's handlePurchaseUnowned), per explicit
            // product decision, rather than opening the Bulk Purchase
            // Preview modal directly.
            gppBulkPurchaseOpenProfilePanel(needed);
        });

        // ── Progress-gated control availability (mirrors
        // ghost-palette-search.js's syncProgressDependentControls) ───────
        function syncProgressGatedControls() {
            const template = controller.template;
            const hasProgress = !!(template && template.scanSummary);
            // The completed/in-progress/unstarted filter checkboxes stay
            // always visible/enabled, even before a scan has run: pre-scan,
            // the correct assumption is 0 pixels placed for every color, so
            // the (possibly inaccurate-until-scanned) filter results are
            // still acceptable and expected — see performFilterSort's
            // isCompleted/isInProgress/isUnstarted, which no longer gate on
            // hasProgress either.
            Array.from(sortSelect.options).forEach(opt => {
                const needsProgress = GPP_PALETTE_PROGRESS_SORT_VALUES.has(opt.value);
                opt.hidden = needsProgress && !hasProgress;
                opt.disabled = needsProgress && !hasProgress;
            });
            if (!hasProgress && GPP_PALETTE_PROGRESS_SORT_VALUES.has(sortSelect.value)) sortSelect.value = 'default';
            updateFilterButtonLabel();
            return hasProgress;
        }

        // ── Group Noise Changes ────────────────────────────────────────────
        // Shown only when template.groupNoise is on AND grouping actually
        // reduced the colour count (groups.length < palette.length means at
        // least one group has 2+ members) — per explicit product decision,
        // this section should be entirely absent otherwise, not just empty.
        function updateGroupNoiseChanges(template) {
            const data = template.groupNoiseData;
            const merged = data ? data.groups.filter(g => g.memberIndices.length > 1) : [];
            if (!template.groupNoise || !merged.length) {
                gncDetails.style.display = 'none';
                return;
            }
            gncDetails.style.display = '';
            gncBody.innerHTML = '';
            // Largest groups (most colours merged together) first — the ones
            // most worth double-checking sit at the top instead of wherever
            // they happened to land in palette order.
            merged.sort((a, b) => b.memberIndices.length - a.memberIndices.length);
            merged.forEach(group => {
                const repHex = core.packedToHex(template.palette[group.representativeIndex]);
                const totalPx = group.memberIndices.reduce((sum, i) => sum + (template.counts[i] || 0), 0);

                const groupEl = document.createElement('div');
                groupEl.className = 'gpp-gnc-group';

                const heading = document.createElement('div');
                heading.className = 'gpp-gnc-heading';
                const headingSwatch = document.createElement('span');
                headingSwatch.className = 'gpp-gnc-swatch';
                headingSwatch.style.backgroundColor = repHex;
                const headingText = document.createElement('span');
                headingText.innerHTML = `<span class="gpp-gnc-hex">${repHex}</span> <span class="gpp-gnc-meta">(${group.memberIndices.length} colors merged, ${totalPx.toLocaleString()} px total)</span>`;
                heading.append(headingSwatch, headingText);
                groupEl.appendChild(heading);

                const membersEl = document.createElement('div');
                membersEl.className = 'gpp-gnc-members';
                group.memberIndices.forEach(index => {
                    const hex = core.packedToHex(template.palette[index]);
                    const px = template.counts[index] || 0;
                    const isRep = index === group.representativeIndex;
                    const memberEl = document.createElement('div');
                    memberEl.className = 'gpp-gnc-member';
                    const swatch = document.createElement('span');
                    swatch.className = 'gpp-gnc-swatch';
                    swatch.style.backgroundColor = hex;
                    const label = document.createElement('span');
                    label.innerHTML = `<span class="gpp-gnc-hex">${hex}</span> — ${px.toLocaleString()} px` + (isRep ? ' <span class="gpp-gnc-kept">(kept)</span>' : '');
                    memberEl.append(swatch, label);
                    membersEl.appendChild(memberEl);
                });
                groupEl.appendChild(membersEl);
                gncBody.appendChild(groupEl);
            });
        }

        // ── Search / filter / sort / render ───────────────────────────────
        function performFilterSort() {
            const template = controller.template;
            if (!template) return;
            syncProgressGatedControls();
            // Read fresh every call (not just at grid-creation time) so
            // toggling the View Settings > Global "Gray unselected color
            // boxes" checkbox updates an already-open palette immediately,
            // not just on the next template switch — see gpp-palette.js's
            // own CSS comment on this class.
            grid.classList.toggle('gpp-palette-gray-disabled', gppSettings.grayDisabledSwatches !== false);
            // Same live-read-every-call pattern as the line above — toggling
            // View Settings > Global > "Palette view" updates an
            // already-open palette immediately, no template switch needed.
            grid.classList.toggle('gpp-palette-list-mode', gppSettings.paletteViewMode === 'list');

            const searchTerms = searchInput.value.trim().split(/[\s,]+/).map(t => t.toUpperCase()).filter(Boolean);
            const checked = new Set(filterInputs.filter(entry => entry.input.checked).map(entry => entry.value));
            const hideUnmatched = checked.has('hideUnmatched');
            const hideCompleted = checked.has('hideCompleted');
            const hideInProgress = checked.has('hideInProgress');
            const hideUnstarted = checked.has('hideUnstarted');
            const ownedOnly = checked.has('ownedOnly');
            const countRangeOn = checked.has('countRange');
            const minCount = (countRangeOn && countMinInput.value !== '') ? parseInt(countMinInput.value, 10) : NaN;
            const maxCount = (countRangeOn && countMaxInput.value !== '') ? parseInt(countMaxInput.value, 10) : NaN;
            const hasMin = !isNaN(minCount);
            const hasMax = !isNaN(maxCount);

            let ownedHexSet = null;
            if (ownedOnly) {
                ownedHexSet = new Set();
                gppReadGamePalette().forEach(row => { if (row && row.hex) ownedHexSet.add(String(row.hex).toUpperCase()); });
            }

            const count = template.palette.length;
            const matching = new Set();
            if (searchTerms.length) {
                for (let index = 0; index < count; index++) {
                    const hex = core.packedToHex(template.palette[index]);
                    if (searchTerms.some(term => hex.includes(term))) matching.add(index);
                }
            }

            const colourLookup = gppPaletteBuildColourLookup(template);
            const visible = [];
            for (let index = 0; index < count; index++) {
                const stats = gppPaletteStats(template, index, colourLookup);
                const isUnmatched = searchTerms.length > 0 && !matching.has(index);
                // Not gated on scanSummary: pre-scan, completed defaults to 0
                // for every color (gppPaletteStats), so these fall out to
                // "everything unstarted" — the correct assumption per
                // product decision, and exactly what makes these filters
                // usable before a scan has ever run.
                const isCompleted = stats.total > 0 && stats.completed >= stats.total;
                const isInProgress = stats.total > 0 && stats.completed > 0 && stats.completed < stats.total;
                const isUnstarted = stats.total > 0 && stats.completed === 0;
                const hex = core.packedToHex(template.palette[index]);
                const isUnowned = ownedOnly && ownedHexSet && !ownedHexSet.has(hex);
                const outOfRange = (hasMin || hasMax) && ((hasMin && stats.total < minCount) || (hasMax && stats.total > maxCount));
                if ((hideUnmatched && isUnmatched) || (hideCompleted && isCompleted) ||
                    (hideInProgress && isInProgress) || (hideUnstarted && isUnstarted) ||
                    isUnowned || outOfRange) continue;
                visible.push(index);
            }

            // Always on when there's an actual search with a hit — no
            // separate opt-in checkbox, per explicit product decision
            // (matches should always float to the top of the grid).
            const showMatchesAtTop = searchTerms.length > 0 && matching.size > 0;

            const sortValue = sortSelect.value;
            const cmp = (a, b) => {
                if (showMatchesAtTop) {
                    const ma = matching.has(a), mb = matching.has(b);
                    if (ma !== mb) return ma ? -1 : 1;
                }
                const sa = gppPaletteStats(template, a, colourLookup);
                const sb = gppPaletteStats(template, b, colourLookup);
                const tie = a - b;
                switch (sortValue) {
                    case 'default': return (sb.total - sa.total) || tie;
                    case 'leastUsed': return (sa.total - sb.total) || tie;
                    case 'mostRemaining': return (sb.remaining - sa.remaining) || tie;
                    case 'leastRemaining': return (sa.remaining - sb.remaining) || tie;
                    case 'mostPct': return (sb.remainingPercent - sa.remainingPercent) || tie;
                    case 'leastPct': return (sa.remainingPercent - sb.remainingPercent) || tie;
                    case 'byColor': {
                        const ha = core.packedToHex(template.palette[a]);
                        const hb = core.packedToHex(template.palette[b]);
                        return (ha < hb ? -1 : ha > hb ? 1 : 0) || tie;
                    }
                    case 'byColorRev': {
                        const ha = core.packedToHex(template.palette[a]);
                        const hb = core.packedToHex(template.palette[b]);
                        return (ha > hb ? -1 : ha < hb ? 1 : 0) || tie;
                    }
                    default: return tie;
                }
            };
            visible.sort(cmp);

            // Group Noise: collapse the already-filtered/sorted raw-index
            // list down to one entry per group (its representative),
            // keeping first-occurrence order so search-matches-at-top and
            // the chosen sort still determine which group appears first.
            // Filtering/sorting itself (above) stays entirely per-raw-index
            // and unchanged — this is purely a post-processing display step,
            // gated on template.groupNoise so a template with it off takes
            // the exact same code path as before this feature existed.
            let visibleGroups = null;
            if (template.groupNoise) {
                if (!template.groupNoiseData) template.groupNoiseData = core.groupPaletteColors(template.palette);
                const seen = new Set();
                visibleGroups = [];
                for (const index of visible) {
                    const rep = template.groupNoiseData.groupOfIndex[index];
                    if (seen.has(rep)) continue;
                    seen.add(rep);
                    visibleGroups.push(rep);
                }
            }
            updateGroupNoiseChanges(template);

            // Progressive rendering (see renderNextBatch/the grid scroll
            // listener above) instead of a hard cap + "narrow your search"
            // message — the first batch renders immediately, the rest loads
            // as the user scrolls down.
            const previousScrollTop = grid.scrollTop;
            grid.innerHTML = '';
            renderState = { visible, visibleGroups, matching, colourLookup, shownCount: 0 };
            // Exposed on the controller (not just this closure's local
            // `renderState`) so mobile-painting.js's compact grid can read the
            // exact same computed sort/filter order via
            // gppPaletteControllers.get(document.getElementById(
            // 'gpp-palette-section')).renderState -- a reference assignment,
            // so it stays live as renderNextBatch() below mutates shownCount.
            // Deliberately reusing this already-computed result instead of a
            // second copy of the sort/filter algorithm, which could drift out
            // of sync with this one.
            controller.renderState = renderState;
            renderNextBatch();
            // performFilterSort() runs on every refresh (e.g. a single swatch
            // toggle, via controller.update), which always rebuilds the grid
            // from scratch — collapsing it back down to however many batches
            // renderNextBatch()'s own eager-load loop decided were enough to
            // overflow the container, which can be far short of how many
            // batches the user had actually scrolled through. Restoring
            // scrollTop straight against that much shorter content gets
            // silently clamped by the browser, which reads as a jump toward
            // the top. Keep loading batches until there's enough rendered
            // height to actually contain the previous position (or nothing
            // left to load — e.g. a filter now genuinely excludes what used
            // to be there, in which case clamping is the correct behaviour).
            const renderTotal = (visibleGroups || visible).length;
            while (renderState.shownCount < renderTotal && grid.scrollHeight - grid.clientHeight < previousScrollTop) {
                renderNextBatch();
            }
            grid.scrollTop = previousScrollTop;
        }

        function buildSwatch(template, index, isMatch, colourLookup) {
            const packed = template.palette[index];
            const hex = core.packedToHex(packed);
            const enabled = core.maskHas(template.mask, index);
            const stats = gppPaletteStats(template, index, colourLookup);

            // Colour-only swatch — no hex text on the face; the hex/stats are
            // conveyed entirely via the custom mouse-following tooltip
            // (mouseenter/mousemove) rather than a native title attribute.
            const listMode = gppSettings.paletteViewMode === 'list';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gpp-swatch' + (enabled ? '' : ' gpp-swatch-off') + (isMatch ? ' gpp-palette-glow' : '') + (listMode ? ' gpp-swatch-list' : '');
            button.setAttribute('aria-pressed', String(enabled));
            button.setAttribute('aria-label', `${enabled ? 'Hide' : 'Show'} ${hex}`);
            button.dataset.colorIndex = String(index);

            const hasProgress = !!template.scanSummary;

            if (listMode) {
                gppPaletteApplyListLayout(button, hex, stats, hasProgress);
            } else {
                button.style.backgroundColor = hex;
                // Per-swatch completion badge — only shown once a scan has run
                // for this template (progress is otherwise unknown, not "0%").
                // complete: white circle + green check (explicit user request:
                // "make sure this time complete is just white with a green
                // check mark to make it pop out more"); unstarted: black
                // unfilled ring; in-progress: red-to-green interpolated fill.
                if (hasProgress && stats.total > 0) {
                    const badge = document.createElement('span');
                    if (stats.completed >= stats.total) {
                        badge.className = 'gpp-swatch-progress gpp-swatch-progress-complete';
                    } else if (stats.completed <= 0) {
                        badge.className = 'gpp-swatch-progress gpp-swatch-progress-unstarted';
                    } else {
                        badge.className = 'gpp-swatch-progress gpp-swatch-progress-inprogress';
                        badge.style.background = gppPaletteProgressColor(stats.completed / stats.total);
                    }
                    badge.setAttribute('aria-hidden', 'true');
                    button.appendChild(badge);
                }
            }

            button.addEventListener('mouseenter', event => gppPaletteShowTooltip(event, hex, stats, hasProgress));
            button.addEventListener('mousemove', event => gppPaletteMoveTooltip(event));
            button.addEventListener('mouseleave', gppPaletteHideTooltip);
            button.addEventListener('click', () => {
                // A drag-paint gesture (see the grid-level mousedown/
                // mousemove listeners above) that touched this swatch
                // already applied + persisted its target state — skip so a
                // drag that starts and ends on the same swatch doesn't
                // toggle it right back.
                if (suppressNextClick) { suppressNextClick = false; return; }
                const currentTemplate = controller.template;
                if (!currentTemplate) return;
                const nowEnabled = core.maskToggle(currentTemplate.mask, index);
                setSwatchMaskState(button, hex, nowEnabled);
            });
            return button;
        }

        // Group Noise variant of buildSwatch — one swatch represents every
        // near-duplicate colour core.groupPaletteColors() merged together
        // (see gpp-core.js). Same DOM shape/classes as buildSwatch (styling
        // free), but colour/stats/enabled-state/click all operate across the
        // WHOLE group's member indices rather than a single index.
        function buildGroupSwatch(template, representativeIndex, groupNoiseData, matching, colourLookup) {
            const memberIndices = groupNoiseData.groupByRepresentative.get(representativeIndex).memberIndices;
            const packed = template.palette[representativeIndex];
            const hex = core.packedToHex(packed);
            // Defensive: check every member, not just the representative —
            // normal operation keeps them in lockstep (see the click handler
            // below and applyDragPaintTo), but this stays correct even if
            // something upstream ever left them mismatched.
            const enabled = memberIndices.every(i => core.maskHas(template.mask, i));
            const isMatch = memberIndices.some(i => matching.has(i));

            let total = 0, completed = 0;
            memberIndices.forEach(i => {
                const s = gppPaletteStats(template, i, colourLookup);
                total += s.total;
                completed += s.completed;
            });
            const stats = { total, completed, remaining: Math.max(0, total - completed), remainingPercent: total > 0 ? (Math.max(0, total - completed) / total) * 100 : 0 };

            const listMode = gppSettings.paletteViewMode === 'list';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gpp-swatch' + (enabled ? '' : ' gpp-swatch-off') + (isMatch ? ' gpp-palette-glow' : '') + (listMode ? ' gpp-swatch-list' : '');
            button.setAttribute('aria-pressed', String(enabled));
            button.setAttribute('aria-label', `${enabled ? 'Hide' : 'Show'} ${hex} (${memberIndices.length} grouped colors)`);
            button.dataset.colorIndex = String(representativeIndex);
            button.dataset.groupMembers = memberIndices.join(',');

            const hasProgress = !!template.scanSummary;
            if (listMode) {
                gppPaletteApplyListLayout(button, hex, stats, hasProgress);
            } else {
                button.style.backgroundColor = hex;
                if (hasProgress && stats.total > 0) {
                    const badge = document.createElement('span');
                    if (stats.completed >= stats.total) {
                        badge.className = 'gpp-swatch-progress gpp-swatch-progress-complete';
                    } else if (stats.completed <= 0) {
                        badge.className = 'gpp-swatch-progress gpp-swatch-progress-unstarted';
                    } else {
                        badge.className = 'gpp-swatch-progress gpp-swatch-progress-inprogress';
                        badge.style.background = gppPaletteProgressColor(stats.completed / stats.total);
                    }
                    badge.setAttribute('aria-hidden', 'true');
                    button.appendChild(badge);
                }
            }

            button.addEventListener('mouseenter', event => gppPaletteShowTooltip(event, hex, stats, hasProgress));
            button.addEventListener('mousemove', event => gppPaletteMoveTooltip(event));
            button.addEventListener('mouseleave', gppPaletteHideTooltip);
            button.addEventListener('click', () => {
                if (suppressNextClick) { suppressNextClick = false; return; }
                const currentTemplate = controller.template;
                if (!currentTemplate) return;
                const nowEnabled = !memberIndices.every(i => core.maskHas(currentTemplate.mask, i));
                memberIndices.forEach(i => core.maskSet(currentTemplate.mask, i, nowEnabled));
                setSwatchMaskState(button, hex, nowEnabled);
            });
            return button;
        }

        controller.update = function gppPaletteControllerUpdate(template, onChange) {
            controller.template = template || null;
            controller.onChange = typeof onChange === 'function' ? onChange : null;
            syncCompactPaletteViewButtons();
            gppPaletteHideTooltip(); // avoid a stuck tooltip across a re-render/deselection
            if (!controller.template) {
                emptyEl.style.display = '';
                panel.style.display = 'none';
                gncDetails.style.display = 'none';
                return;
            }
            emptyEl.style.display = 'none';
            panel.style.display = '';
            performFilterSort();
        };

        return controller;
    }
