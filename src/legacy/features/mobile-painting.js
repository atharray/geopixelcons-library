
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

    // Narrower than core.js's shared isDarkMode(): only the OTHER
    // "GeoPixels++" extension's own explicit theme selector counts here, not
    // body.dark or the OS-level prefers-color-scheme fallback isDarkMode()
    // also honors. See the .gpc-mobile-controls-row comment in injectStyle()
    // below for why -- #bottomControls' own wrapper never itself goes dark,
    // so an OS/body signal alone would make these buttons black against a
    // background that stays unconditionally white regardless.
    function isControlsRowDark() {
        try {
            const raw = localStorage.getItem('geo++_settings');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.theme && parsed.theme !== 'system') {
                    return parsed.theme === 'simple_black';
                }
            }
        } catch (e) {}
        return false;
    }
    function tc(light, dark) { return isControlsRowDark() ? dark : light; }

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
            /* Row layout: the swatch grid takes the available width, and a
               small live preview of the focused template's ghost image
               (see .gpc-mobile-preview-frame below) sits to its right,
               sized to the grid's own height. */
            .gpc-mobile-palette-wrap { width: 100%; box-sizing: border-box; display: flex; flex-direction: row; align-items: stretch; gap: 6px; }
            .gpp-palette-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(26px, 1fr));
                grid-auto-rows: minmax(26px, 1fr);
                /* 2 visible rows (26px + 3px gap, doubled, plus the grid's own
                   2px top/bottom padding) before scrolling -- same constant
                   Ghost++'s own minified mode uses for the identical shape
                   (see gpp-ui-shell.js's .gpp-minified .gpp-palette-grid). */
                gap: 3px; max-height: 60px; overflow-y: auto; padding: 2px;
                flex: 1 1 auto; min-width: 0; box-sizing: border-box;
                scrollbar-gutter: stable;
            }
            /* Small live preview of the focused template's own ghost image
               (same source gpp-lib-current-canvas-wrap uses in the real
               Ghost++ Library panel -- gppLibraryRenderFullCanvas -- not a
               separate lower-res thumbnail, so nothing about the image
               itself is downsampled/compressed). The frame's height matches
               the grid's own (60px); the canvas gets ONLY 'height' set (not
               'width', and deliberately no 'max-width' either -- that was
               tried and measured to distort the image: clamping the
               auto-computed width while height stayed fixed squashed a
               200x100 test canvas down to 88x58 instead of the correct
               116x58, exactly the compression this is meant to avoid), so
               the browser derives width purely from the canvas's own real
               aspect ratio. No cap on the frame's own width either, for the
               same reason -- for any reasonably square-ish or moderately
               wide template this stays small on its own since height alone
               is already capped to the grid's height; an unusually
               wide/panoramic template will make the frame wider rather than
               distorting its image, which is the explicit priority order
               ("don't compress... but constrain to match the height").
               image-rendering: pixelated keeps pixel art crisp at a small
               display size instead of blurring it. */
            .gpc-mobile-preview-frame {
                flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
                height: 60px; overflow: hidden; box-sizing: border-box; cursor: pointer;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
                border-radius: 4px; background: ${t2('rgba(0,0,0,.03)', 'rgba(255,255,255,.05)')};
            }
            .gpc-mobile-preview-frame canvas {
                height: 100%; width: auto; display: block;
                image-rendering: pixelated;
            }
            /* !important is load-bearing: #gpc-native-top-bar carries its own
               inline style="display: flex; ..." (native markup), which beats
               any non-!important class on specificity alone. */
            .gpc-hidden { display: none !important; }
            /* Scaffolding shown in place of #gpc-native-top-bar and
               .gpc-mobile-controls-row once the preview-frame thumbnail is
               clicked -- see buildTemplatePaletteGrid's preview-frame click
               handler. Placeholder content only, for now. Both panels sit
               inside a single .gpc-mobile-placeholder-group instead of
               being inserted as two bare siblings -- innerWrapper (their
               parent once inserted) is itself a flex column with its own
               gap-4 (16px) between children; a per-placeholder margin-
               bottom stacked ON TOP of that gap between the two panels,
               which is what actually produced the "awkward" extra spacing
               reported. The group is the ONE flex child innerWrapper's own
               gap applies around; spacing between the two panels inside it
               is controlled entirely by the group's own (smaller,
               intentional) gap below. */
            .gpc-mobile-placeholder-group {
                width: 100%; box-sizing: border-box;
                display: flex; flex-direction: column; gap: 6px;
            }
            .gpc-mobile-placeholder {
                width: 100%; box-sizing: border-box; padding: 10px 12px;
                border: 1px dashed ${tc('#d1d5db', '#45475a')}; border-radius: 6px;
                color: ${tc('#111827', '#f5f5f5')}; background: ${tc('#ffffff', '#1e1e2e')};
                font-size: 12px; text-align: center;
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
            /* Per explicit product decision, disabled colors in THIS grid get
               NO visual indicator at all -- no grayscale (see the removed-
               filter history in the changelog), no diagonal slash either.
               The underlying mask (template.mask via core.maskSet) is
               unchanged -- other colors are still genuinely disabled in the
               Ghost++ overlay, exactly as soloColor() always did; only the
               visual off-state styling is suppressed here. Ghost++'s own
               grid keeps its usual grayscale + slash treatment, untouched.
               #gpc-mobile-palette-grid-scoped override below, not just an
               absence of a rule here -- Ghost++'s own #gpp-palette-style
               tag (gpp-palette.js's gppInjectPaletteStyle(), which our own
               ensurePaletteControllerReady() calls can trigger) defines an
               UNGATED .gpp-swatch.gpp-swatch-off::after slash rule that
               would otherwise apply to every matching element on the page
               regardless of which grid it's actually in or which stylesheet
               "owns" it -- CSS selectors aren't scoped by which script wrote
               them. The higher-specificity ID-scoped override is what
               actually guarantees it never shows here, independent of
               style-tag injection order. */
            #gpc-mobile-palette-grid .gpp-swatch.gpp-swatch-off::after {
                content: none;
            }
            /* "Currently selected" indicator: a plain black square border
               with a white glow around it. Replaced the earlier rotating
               (then stationary) dashed mask-composite frame per explicit
               product decision -- simpler and less busy. Only shows while
               liveState.soloMode is true (see setSwatchState) -- there's no
               single "the" selected color to ring while in multi-select
               mode (All/Owned/Filtered). Separate pseudo-element from
               .gpp-swatch-off's ::after slash so a swatch could in
               principle carry both without conflict, even though in
               practice soloColor() always leaves the selected swatch
               enabled. border-radius is the swatch's own 4px plus the -3px
               inset, so the ring's corners stay concentric with the
               swatch's own rounded corners instead of going square-cornered
               around a rounded swatch. z-index is well above anything else
               that can appear under #bottomControls -- the control row's
               own dropdown menus (1000) and the Paint Menu Controls
               feature's topBar (hide-paint-menu.js, 20) included -- so the
               ring for whichever swatch is selected always stays visible
               above them rather than being able to render underneath. */
            .gpp-swatch.gpp-swatch-selected::before {
                content: ''; position: absolute; inset: -3px; z-index: 2000;
                pointer-events: none; box-sizing: border-box; border-radius: 7px;
                border: 2px solid #000;
                box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 0 6px 2px rgba(255,255,255,.9);
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
            /* Bulk-action / sort / filter / get-hex row. Styled via tc(),
               a narrower variant of t2()/isDarkMode() defined below: this
               row should only go dark when the OTHER "GeoPixels++"
               extension's OWN theme selector is explicitly set to a dark
               theme -- unlike isDarkMode() (core.js's "DARK THEME
               DETECTION (Geopixels++ compatibility)"), it does NOT fall
               back to body.dark or the OS-level prefers-color-scheme, since
               #bottomControls' own inner wrapper ships a hardcoded,
               unconditional bg-white with no dark: variant of its own
               (verified against the live DOM) -- an OS/body dark signal
               alone would make these buttons black against a background
               that stays unconditionally white regardless. Colors below are
               reused verbatim from this file's own #gpp-palette-tooltip
               block above, not reinvented. */
            .gpc-mobile-controls-row {
                width: 100%; box-sizing: border-box; margin-bottom: 6px;
                display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
            }
            .gpc-ctrl-btn {
                max-width: 130px; box-sizing: border-box; min-width: 0;
                border: 2px solid ${tc('#d1d5db', '#45475a')}; border-radius: 6px;
                background: ${tc('#ffffff', '#1e1e2e')}; color: ${tc('#111827', '#f5f5f5')};
                font-size: 11px; font-weight: 600; cursor: pointer;
                display: flex; align-items: center; gap: 5px; overflow: hidden;
                padding: 5px 8px; white-space: nowrap;
            }
            .gpc-ctrl-btn:hover { background: ${tc('#f3f4f6', '#313244')}; }
            .gpc-ctrl-btn-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .gpc-ctrl-btn-arrow { font-size: 9px; opacity: .7; flex-shrink: 0; }
            .gpc-ctrl-dropdown { position: relative; display: inline-flex; min-width: 0; }
            /* Menus open UPWARD (bottom, not top) -- this row sits at the very
               bottom of the screen, so a downward menu would run off-page.
               z-index is well above the Paint Menu Controls feature's topBar
               (hide-paint-menu.js, inline z-index: 20, appended as a later
               DOM sibling of this row inside the same #bottomControls) --
               with equal z-index the later DOM element wins ties, which was
               burying this menu under that toggle's button row. */
            .gpc-ctrl-menu {
                display: none; position: absolute; bottom: calc(100% + 4px); left: 0; z-index: 1000;
                min-width: 190px; max-width: 230px; padding: 6px; border-radius: 8px;
                border: 1px solid ${tc('#e5e7eb', '#313244')};
                background: ${tc('#ffffff', '#181825')};
                box-shadow: 0 -8px 24px rgba(0,0,0,.28);
            }
            .gpc-ctrl-menu.gpc-open { display: flex; flex-direction: column; gap: 2px; }
            .gpc-ctrl-menu-option {
                display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 5px;
                font-size: 12px; cursor: pointer; user-select: none;
                color: ${tc('#111827', '#f5f5f5')};
            }
            .gpc-ctrl-menu-option:hover { background: ${tc('#f3f4f6', '#313244')}; }
            .gpc-ctrl-menu-option input { width: 13px; height: 13px; cursor: pointer; }
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

    // Also reconciles the "currently selected" ring indicator
    // (liveState.selectedHex, set by soloColor/setGridClickTarget below)
    // against this swatch -- every call site that already calls
    // setSwatchState (initial build, soloColor's own update loop, resync()'s
    // reconcile pass) gets the ring kept in sync for free, with no separate
    // pass needed. The ring only shows while liveState.soloMode is true --
    // there's no single "the" selected color to ring while in multi-select
    // mode (see bulkEnableAll/Owned/Filtered, which set soloMode false).
    function setSwatchState(swatch, hex, enabled) {
        swatch.classList.toggle('gpp-swatch-off', !enabled);
        swatch.setAttribute('aria-pressed', String(enabled));
        swatch.setAttribute('aria-label', `${enabled ? 'Hide' : 'Show'} ${hex}`);
        swatch.classList.toggle('gpp-swatch-selected', !!liveState && liveState.soloMode !== false && liveState.selectedHex === hex);
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

    // Bare `window` inside a userscript is not reliably the same object as
    // the native page's own `window` (Tampermonkey/Violentmonkey run scripts
    // in a sandboxed realm in some browsers -- see the `unsafeWindow`
    // fallback used almost everywhere else in this codebase, e.g.
    // hide-paint-menu.js, paint-brush-swap.js, ghost-plus-plus/gpp-*.js).
    // soloColor()/toggleColor() previously called bare `window.changeColor`,
    // which silently no-ops when `window` is sandboxed -- the grid's own
    // solo/toggle visuals still updated fine (self-contained DOM state), but
    // the real native active paint color (`pixelColor`, js/index148.js)
    // never actually changed. This matches this file's own established
    // convention instead of inventing a new one.
    function pageWindow() {
        return (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
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

    // Cache for the ghost-image preview canvas (see buildTemplatePaletteGrid
    // below) -- gppLibraryRenderFullCanvas() re-walks every pixel of the
    // template's own indices array, which is wasted work if repeated on
    // every resync() tick (color toggles, sort/filter changes -- none of
    // which touch the image itself). Only regenerated when the focused
    // template's identity actually changes; the same canvas node is reused
    // (and just re-appended, a cheap DOM op) otherwise.
    let previewCanvasTemplateId = null;
    let previewCanvasEl = null;
    function getTemplatePreviewCanvas(template) {
        if (previewCanvasTemplateId === template.id && previewCanvasEl) return previewCanvasEl;
        previewCanvasEl = (typeof gppLibraryRenderFullCanvas === 'function') ? gppLibraryRenderFullCanvas(template) : null;
        previewCanvasTemplateId = template.id;
        return previewCanvasEl;
    }

    // Triggered by tapping the preview-frame thumbnail (see
    // buildTemplatePaletteGrid below). Hides #gpc-native-top-bar and
    // .gpc-mobile-controls-row (display:none via .gpc-hidden -- neither is
    // removed from the DOM, matching this file's own never-remove-only-hide
    // convention elsewhere) and inserts two stacked placeholder panels in
    // their place. Placeholder content only, for now -- scaffolding for a
    // feature that hasn't been specified yet. Idempotent: a second tap (or
    // a second call for any other reason) is a no-op if the panels already
    // exist, rather than duplicating them.
    function revealPlaceholderPanels() {
        if (document.getElementById('gpc-mobile-placeholder-group')) return;

        const nativeTopBar = document.getElementById('gpc-native-top-bar');
        const controlsRow = document.querySelector('.gpc-mobile-controls-row');
        if (nativeTopBar) nativeTopBar.classList.add('gpc-hidden');
        if (controlsRow) controlsRow.classList.add('gpc-hidden');

        // Both panels share ONE parent (.gpc-mobile-placeholder-group) --
        // see its own CSS comment above for why: a shared parent is both
        // the fix for the awkward double-spacing (innerWrapper's own
        // flex gap-4 applies once around the group, not once per bare
        // sibling placeholder) and a single stable anchor for this whole
        // group going forward. .gpc-mobile-palette-wrap (the color grid +
        // preview thumbnail) is deliberately never touched here -- it
        // should stay visible exactly as it already does; nothing in this
        // function references it.
        const group = document.createElement('div');
        group.id = 'gpc-mobile-placeholder-group';
        group.className = 'gpc-mobile-placeholder-group';

        const placeholder1 = document.createElement('div');
        placeholder1.id = 'gpc-mobile-placeholder-1';
        placeholder1.className = 'gpc-mobile-placeholder';
        placeholder1.textContent = 'placeholder 1';

        const placeholder2 = document.createElement('div');
        placeholder2.id = 'gpc-mobile-placeholder-2';
        placeholder2.className = 'gpc-mobile-placeholder';
        placeholder2.textContent = 'placeholder 2';

        group.append(placeholder1, placeholder2);

        // Inserted where the two hidden elements used to visually sit, so
        // the rest of #bottomControls (the color grid below) doesn't jump.
        if (nativeTopBar) {
            nativeTopBar.insertAdjacentElement('afterend', group);
        } else if (controlsRow) {
            controlsRow.insertAdjacentElement('beforebegin', group);
        }
        dbgPush('Mobile Painting: preview-frame tapped -- native top bar and controls row hidden, placeholder panels shown.', { uiComponent: 'Mobile Painting' });
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
            // whatever was selected before this click. soloMode is set true
            // here too -- a solo click always re-establishes solo mode, even
            // if an Enable All/Owned/Filtered bulk action had switched to
            // multi-select mode moments earlier.
            if (liveState) { liveState.selectedHex = hex; liveState.soloMode = true; }
            const swatches = grid.children;
            for (let i = 0; i < swatches.length; i++) {
                const swatch = swatches[i];
                const swatchIndex = Number(swatch.dataset.index);
                setSwatchState(swatch, swatch.dataset.hex, swatchIndex === targetIndex);
            }
            const pw = pageWindow();
            if (typeof pw.changeColor === 'function') pw.changeColor(hex);
            updateHexDisplay(hex);
            gppState.persistTemplateState(template).catch((err) => {
                console.error('[GeoPixelcons++] Mobile Painting: failed to persist template state', err);
            });
            if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
            if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        }

        // Multi-select mode counterpart to soloColor: used instead whenever
        // liveState.soloMode is false (last Enable action was All/Owned/
        // Filtered, not Selected) -- toggles just the clicked color's own
        // mask bit, leaving every other color's visibility exactly as it
        // was ("the visibility of each color remains"). Still tracks
        // liveState.selectedHex (so switching the Enable dropdown back to
        // "Selected" knows which color to re-solo), but the ring never
        // shows for it while soloMode stays false (see setSwatchState).
        // changeColor/updateHexDisplay only fire when the click is turning
        // the color ON -- turning one off shouldn't also make it the active
        // native paint color.
        function toggleColor(targetIndex, hex) {
            const nowEnabled = !core.maskHas(template.mask, targetIndex);
            core.maskSet(template.mask, targetIndex, nowEnabled);
            if (liveState) liveState.selectedHex = hex;
            // grid.children is in `order` (sorted/filtered) sequence, NOT
            // palette-index sequence -- can't index it by targetIndex
            // directly, has to be matched by its own dataset.index, same as
            // soloColor's own update loop does.
            const swatches = grid.children;
            for (let i = 0; i < swatches.length; i++) {
                if (Number(swatches[i].dataset.index) === targetIndex) {
                    setSwatchState(swatches[i], hex, nowEnabled);
                    break;
                }
            }
            if (nowEnabled) {
                const pw = pageWindow();
                if (typeof pw.changeColor === 'function') pw.changeColor(hex);
                updateHexDisplay(hex);
            }
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
            swatch.addEventListener('click', () => {
                if (liveState && liveState.soloMode === false) toggleColor(index, hex);
                else soloColor(index, hex);
            });
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

        // Small live preview of the focused template's own ghost image, to
        // the grid's right -- see the .gpc-mobile-preview-frame CSS comment
        // above for the sizing/fidelity reasoning.
        const previewCanvas = getTemplatePreviewCanvas(template);
        if (previewCanvas) {
            const previewFrame = document.createElement('div');
            previewFrame.className = 'gpc-mobile-preview-frame';
            previewFrame.title = template.name || 'Template preview';
            previewFrame.appendChild(previewCanvas);
            previewFrame.addEventListener('click', revealPlaceholderPanels);
            wrap.appendChild(previewFrame);
        }

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

    // Mirrors Ghost++'s own product decision (gpp-scan.js's gppTryAutoScan,
    // wired into gpp-palette.js's own Enable/Sort/Filter controls): any use
    // of this row's Enable/Sort/Filter options first tries to run a scan
    // too, so progress numbers stay fresh without a separate manual click.
    // ensurePaletteControllerReady() first, since gppTryAutoScan() needs
    // #gpp-progress-section (and the scan button inside it) to already
    // exist, which it might not if the real Ghost++ modal was never opened
    // this session; gppRequestUiRefresh() then renders that section's
    // current content (including the button) for whichever template is
    // actually focused right now. No-ops quietly (via gppTryAutoScan's own
    // guards) if Ghost++ isn't enabled, nothing is focused, or the template
    // isn't placed on the map yet.
    function tryAutoScanFirst() {
        ensurePaletteControllerReady();
        if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        if (typeof gppTryAutoScan === 'function') gppTryAutoScan();
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

    // All/Owned/Filtered enable multiple colors at once, so grid swatch
    // clicks switch out of solo mode too (see the click handler in
    // buildTemplatePaletteGrid) -- a tap now toggles just that one color
    // instead of soloing it, and the ring stops showing (setSwatchState
    // gates it on soloMode). liveState.selectedHex is deliberately left
    // alone, NOT cleared, here -- it's kept as a "last individually touched
    // color" memory so switching the Enable dropdown back to "Selected"
    // (bulkEnableSelected below) knows what to re-solo, per explicit
    // product decision: swapping to Selected while a color is already
    // selected should immediately re-solo it.
    function bulkEnableAll(template, core) {
        tryAutoScanFirst();
        if (liveState) liveState.soloMode = false;
        template.mask = core.makeFullMask(template.palette.length, template.counts);
        notifyMaskChanged(template);
    }

    function bulkDisableAll(template) {
        template.mask = new Uint32Array(Math.ceil(template.palette.length / 32));
        notifyMaskChanged(template);
    }

    function bulkEnableOwned(template, core) {
        tryAutoScanFirst();
        if (liveState) liveState.soloMode = false;
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
        tryAutoScanFirst();
        if (liveState) liveState.soloMode = false;
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

    // "Selected" under the Enable dropdown: switches grid clicks back to
    // solo mode, and -- per explicit product decision -- if a color is
    // already marked selected (liveState.selectedHex, set by the last
    // individual swatch tap even while in multi-select mode) immediately
    // replays soloColor's exact effect for it (disable every other color,
    // enable just this one), rather than waiting for the next tap. The mode
    // switch itself always happens; the immediate re-solo only happens if
    // there's something to re-solo -- no-ops (with a dbgPush diagnostic) if
    // nothing is currently selected, or if that hex isn't in this
    // template's palette (e.g. focused template changed since it was set).
    function bulkEnableSelected(template, core) {
        tryAutoScanFirst();
        if (liveState) liveState.soloMode = true;
        const hex = liveState && liveState.selectedHex;
        if (!hex) {
            dbgPush('Mobile Painting: switched to solo mode, but no color is currently selected to re-solo.', { uiComponent: 'Mobile Painting' });
            return;
        }
        let targetIndex = -1;
        for (let index = 0; index < template.palette.length; index++) {
            if (core.packedToHex(template.palette[index]) === hex) { targetIndex = index; break; }
        }
        if (targetIndex === -1) {
            dbgPush('Mobile Painting: switched to solo mode, but the selected color is not in this template\'s palette.', { uiComponent: 'Mobile Painting' });
            return;
        }
        for (let index = 0; index < template.palette.length; index++) {
            core.maskSet(template.mask, index, index === targetIndex);
        }
        const pw = pageWindow();
        if (typeof pw.changeColor === 'function') pw.changeColor(hex);
        updateHexDisplay(hex);
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

    // Class names below are OUR OWN (.gpc-ctrl-*), defined in injectStyle()
    // with t2()/isDarkMode() branching -- see the comment on
    // .gpc-mobile-controls-row there for why this uses this codebase's own
    // theme signal rather than native Tailwind dark: classes.

    // Generic small popup-menu button. Used for both the "Enable" and
    // "Get hex values" menus -- Ghost++'s own filter-dropdown DOM pattern
    // (trigger button + absolutely-positioned menu) without reusing its
    // classes, so this row's styling can't be perturbed by Ghost++'s own
    // re-injected stylesheet.
    function buildDropdownButton(labelText, optionDefs) {
        const dropdown = document.createElement('div');
        dropdown.className = 'gpc-ctrl-dropdown';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gpc-ctrl-btn';
        const buttonText = document.createElement('span');
        buttonText.className = 'gpc-ctrl-btn-text';
        buttonText.textContent = labelText;
        const arrow = document.createElement('span');
        arrow.className = 'gpc-ctrl-btn-arrow';
        arrow.textContent = '▾';
        button.append(buttonText, arrow);

        const menu = document.createElement('div');
        menu.className = 'gpc-ctrl-menu';
        const closeMenu = () => menu.classList.remove('gpc-open');
        optionDefs.forEach(({ text, onClick }) => {
            const option = document.createElement('div');
            option.className = 'gpc-ctrl-menu-option';
            option.textContent = text;
            option.addEventListener('click', () => {
                closeMenu();
                onClick();
            });
            menu.appendChild(option);
        });
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.classList.toggle('gpc-open');
        });
        menu.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', closeMenu);

        dropdown.append(button, menu);
        return { el: dropdown, setLabel: (text) => { buttonText.textContent = text; } };
    }

    // Our own <select>, but its options are cloned from the real sort
    // select's current options (values + text) rather than a hardcoded
    // second copy of GPP_PALETTE_SORT_OPTIONS -- one less place for the two
    // lists to drift apart. A dropdown button (same as Enable/Filter/Get hex
    // values) rather than a native <select> -- a <select> always displays
    // whichever option is currently chosen, so it can't stay labeled "Sort";
    // this is an action menu, not a persistent state display. Only synced
    // once, at build time; a sort option that only unlocks after a scan runs
    // (see gpp-palette.js's syncProgressGatedControls) won't retroactively
    // appear here without a page reload -- disclosed limitation, not chased
    // further.
    function buildSortControl() {
        ensurePaletteControllerReady();
        const real = getRealPaletteFormControls();
        const optionDefs = (real && real.sortSelect ? Array.from(real.sortSelect.options) : []).map((realOpt) => ({
            text: realOpt.textContent,
            onClick: () => {
                tryAutoScanFirst();
                const fresh = getRealPaletteFormControls();
                if (!fresh || !fresh.sortSelect) return;
                fresh.sortSelect.value = realOpt.value;
                fresh.sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
            },
        }));
        return buildDropdownButton('Sort', optionDefs).el;
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
        dropdown.className = 'gpc-ctrl-dropdown';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gpc-ctrl-btn';
        const buttonText = document.createElement('span');
        buttonText.className = 'gpc-ctrl-btn-text';
        buttonText.textContent = 'Filter';
        const arrow = document.createElement('span');
        arrow.className = 'gpc-ctrl-btn-arrow';
        arrow.textContent = '▾';
        button.append(buttonText, arrow);

        const menu = document.createElement('div');
        menu.className = 'gpc-ctrl-menu';
        const closeMenu = () => menu.classList.remove('gpc-open');
        optionDefs.forEach(({ value, text, checked }) => {
            const label = document.createElement('label');
            label.className = 'gpc-ctrl-menu-option';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = value;
            input.checked = checked;
            const span = document.createElement('span');
            span.textContent = text;
            label.append(input, span);
            menu.appendChild(label);

            input.addEventListener('change', () => {
                tryAutoScanFirst();
                const fresh = getRealPaletteFormControls();
                const target = fresh && fresh.filterInputs.find((el) => el.value === value);
                if (!target) return;
                target.checked = input.checked;
                target.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.classList.toggle('gpc-open');
        });
        menu.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', closeMenu);

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
            { text: 'Selected', onClick: withTemplate(bulkEnableSelected) },
        ]);
        const disableAllBtn = document.createElement('button');
        disableAllBtn.type = 'button';
        disableAllBtn.className = 'gpc-ctrl-btn';
        const disableAllText = document.createElement('span');
        disableAllText.className = 'gpc-ctrl-btn-text';
        disableAllText.textContent = 'Disable all';
        disableAllBtn.appendChild(disableAllText);
        disableAllBtn.addEventListener('click', withTemplate(bulkDisableAll));

        const sortControl = buildSortControl();
        const filterDropdown = buildFilterControl();

        const hexDropdown = buildDropdownButton('Get hex values', GPC_HEX_VALUE_SCOPES.map(({ value, text }) => ({
            text,
            onClick: withTemplate((template, core) => {
                const count = copyHexValuesForScope(template, core, value);
                hexDropdown.setLabel(count ? `Copied ${count}!` : 'Nothing to copy');
                setTimeout(() => hexDropdown.setLabel('Get hex values'), 1200);
            }),
        })));

        row.append(enableDropdown.el, disableAllBtn, sortControl, filterDropdown, hexDropdown.el);
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
    let liveState = null; // { bottomControls, savedNativeContainer, wrap, grid, templateId, orderKey, selectedHex, soloMode }

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
                liveState.soloMode = true;
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

        // Assigns a stable id to the native top bar (hexDisplay/sortBtn/
        // brush buttons/energy/gpc-paint-close) -- it has none of its own,
        // and hide-paint-menu.js already has to find it by class
        // (':scope > .w-full.flex') alongside its own controlsRow naming.
        // An id makes it easier to identify in DevTools and gives any
        // future code (including this file's own) a direct, stable
        // reference instead of a class-based lookup.
        const nativeTopBar = bottomControls.querySelector('.w-full.flex');
        if (nativeTopBar && !nativeTopBar.id) nativeTopBar.id = 'gpc-native-top-bar';

        liveState = { bottomControls, savedNativeContainer: nativeContainer, wrap: null, grid: null, templateId: null, orderKey: null, selectedHex: null, soloMode: true };

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
        const controlsRowEl = buildControlsRow();
        nativeContainer.insertAdjacentElement('beforebegin', controlsRowEl);

        // The Paint Menu Controls feature's own collapse toggle
        // (hide-paint-menu.js's #gpc-hide-paint-toggle / #gpc-paint-flip-pos)
        // reorders the NATIVE top bar (.w-full.flex, with hexDisplay/
        // sortBtn/brush buttons/energy) and this hidden .control-container-
        // colors relative to EACH OTHER on every press via plain
        // insertBefore() calls, regardless of whether their relative order
        // actually needs to change -- see its own updateState(). Those
        // calls don't know about controlsRowEl sitting between them, so the
        // net effect drags the native top bar to end up AFTER controlsRowEl
        // instead of before it: an unrelated feature's DOM write stepping
        // on this one's. Rather than coupling the two features together,
        // this MutationObserver just re-asserts controlsRowEl's own
        // position (immediately before nativeContainer, its stable anchor)
        // whenever the shared parent's children change for ANY reason --
        // self-heals from this specific interaction, and any similar one,
        // without needing to know what moved what. Debounced onto a
        // microtask (same pattern as gpp-init.js's own gppRefreshTheme) so
        // a burst of synchronous mutations only triggers one recheck.
        const swapParent = nativeContainer.parentElement;
        if (swapParent) {
            let reorderCheckQueued = false;
            new MutationObserver(() => {
                if (reorderCheckQueued) return;
                reorderCheckQueued = true;
                Promise.resolve().then(() => {
                    reorderCheckQueued = false;
                    if (controlsRowEl.nextElementSibling !== nativeContainer) {
                        nativeContainer.insertAdjacentElement('beforebegin', controlsRowEl);
                    }
                });
            }).observe(swapParent, { childList: true });
        }

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
