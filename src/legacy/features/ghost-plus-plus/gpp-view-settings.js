    // ── Ghost++ View Settings ──────────────────────────────────────────
    // Implements the gpp-init.js render-function contract's
    // gppRenderViewSettings(container, template, onChange): a collapsible
    // "View Settings" section (using gpp-ui-shell.js's
    // <details class="gpp-collapsible"> pattern), backed by gppSettings —
    // applies to every template, not just the focused one. The per-template
    // Opacity slider used to live here as its own "Template" subsection but
    // has moved to gpp-placement.js's Template Settings panel instead, per
    // explicit product decision (grouped with the other per-template
    // controls). The master "Show error crosses" toggle (gppSettings.showErrors)
    // lives in gpp-scan.js's Error Settings section instead, alongside the
    // shape/color/opacity/size controls it gates — not here.
    //
    // The cell fill/gap-ratio slider intentionally has NO artificial floor:
    // min="0" and clamp(...,0,1), not the standalone prototype's min="20"
    // with clamp(...,0.2,1) — that floor silently prevented a fully-invisible
    // cell and is not repeated here.

    function gppClamp(value, min, max) {
        'use strict';
        if (!Number.isFinite(value)) return min;
        return Math.min(max, Math.max(min, value));
    }

    // Calls the renderer subsystem's repaint hook if it has landed yet;
    // a no-op (beyond the typeof guard) otherwise, per the shared spec.
    function gppScheduleRenderer() {
        'use strict';
        if (typeof gppRendererSchedule === 'function') {
            try { gppRendererSchedule(); } catch (err) {
                console.error('[GeoPixelcons++] Ghost++ view settings: gppRendererSchedule() failed.', err);
            }
        }
    }

    // Rewrites content every call (see gpp-init.js's theme-change observer)
    // instead of no-op-ing once created, so a live dark/light toggle isn't
    // frozen at whatever theme was active on first mount.
    function gppInjectViewSettingsStyle() {
        'use strict';
        let style = document.getElementById('gpp-view-settings-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'gpp-view-settings-style';
            document.head.appendChild(style);
        }
        style.textContent = `
            .gpp-vs-subhead {
                font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
                color: ${t2('#64748b', '#a6adc8')};
                margin: 10px 0 6px;
            }
            .gpp-vs-subhead:first-child { margin-top: 0; }
            .gpp-vs-row {
                display: flex; align-items: center; gap: 8px; margin: 6px 0;
            }
            .gpp-vs-row.gpp-vs-disabled .gpp-vs-label,
            .gpp-vs-row.gpp-vs-disabled .gpp-vs-value { opacity: .5; }
            .gpp-vs-label {
                flex: 0 0 auto; min-width: 108px; font-size: 12px;
                color: ${t2('#1f2937', '#e2e2f5')};
            }
            .gpp-vs-row input[type="range"] { flex: 1 1 auto; min-width: 0; }
            .gpp-vs-value {
                flex: 0 0 auto; min-width: 34px; text-align: right; font-size: 11px;
                font-variant-numeric: tabular-nums;
                color: ${t2('#475569', '#a6adc8')};
            }
            .gpp-vs-checkbox label {
                display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;
                color: ${t2('#1f2937', '#e2e2f5')};
            }
            .gpp-vs-empty { font-size: 12px; color: ${t2('#64748b', '#a6adc8')}; }
            .gpp-vs-view-toggle {
                display: flex; border-radius: 6px; overflow: hidden; flex-shrink: 0;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
            }
            .gpp-vs-view-btn {
                font: inherit; font-size: 12px; line-height: 1; cursor: pointer; border: none; padding: 4px 8px;
                background: ${t2('#ffffff', '#313244')}; color: ${t2('#64748b', '#a6adc8')};
            }
            .gpp-vs-view-btn:hover { background: ${t2('#f3f4f6', '#45475a')}; }
            .gpp-vs-view-btn-active {
                background: ${t2('#2563eb', '#89b4fa')}; color: ${t2('#ffffff', '#1e1e2e')};
            }
        `;
    }

    // Matches this codebase's existing reset-icon convention (see
    // hide-paint-menu.js / ghost-template-manager.js's own '↺' buttons).
    function gppAddResetButton(rowEl, title, onClick) {
        'use strict';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = '↺';
        btn.title = title;
        btn.style.cssText = 'border:none; background:transparent; cursor:pointer; font-size:13px; padding:0 2px; flex-shrink:0; color:' + t2('#64748b', '#a6adc8') + ';';
        btn.addEventListener('click', onClick);
        rowEl.appendChild(btn);
    }

    function gppBuildGlobalViewSettingsSection(onChange) {
        'use strict';
        const wrap = document.createElement('div');

        const heading = document.createElement('div');
        heading.className = 'gpp-vs-subhead';
        heading.textContent = 'Global';
        wrap.appendChild(heading);

        // Cell fill/gap ratio slider — 0-100 mapped to gppSettings.gapRatio 0-1.
        const gapRow = document.createElement('div');
        gapRow.className = 'gpp-vs-row';
        const gapLabel = document.createElement('label');
        gapLabel.className = 'gpp-vs-label';
        gapLabel.htmlFor = 'gpp-vs-gap-ratio';
        gapLabel.textContent = 'Cell fill';
        const gapInput = document.createElement('input');
        gapInput.type = 'range';
        gapInput.id = 'gpp-vs-gap-ratio';
        gapInput.min = '0';
        gapInput.max = '100';
        gapInput.step = '1';
        // No native title here -- gppAttachTooltip(gapLabel, ...) below
        // covers the text label with a custom tooltip; a native title on
        // this INPUT specifically (a distinct element from gapLabel) would
        // not be stripped by that call and would stack a native browser
        // tooltip on top of the custom one on hover.
        gapInput.value = String(Math.round(gppClamp(gppSettings.gapRatio, 0, 1) * 100));
        const gapValue = document.createElement('span');
        gapValue.className = 'gpp-vs-value';
        gapValue.textContent = gapInput.value + '%';
        gapInput.addEventListener('input', () => {
            gapValue.textContent = gapInput.value + '%';
            gppSettings.gapRatio = gppClamp(Number(gapInput.value) / 100, 0, 1);
            gppState.saveSettings();
            gppScheduleRenderer();
        });
        gapInput.addEventListener('change', () => { onChange && onChange(); });
        gapRow.append(gapLabel, gapInput, gapValue);
        // hoverElement=gapLabel (text only, per explicit user feedback --
        // hovering the slider itself must NOT show the tooltip), focusElement
        // =gapInput (what keyboard Tab actually focuses).
        if (typeof gppAttachTooltip === 'function') gppAttachTooltip(gapLabel, 'Ratio between filled cell and gap. 0% is fully invisible, 100% leaves no gap.', gapInput);
        gppAddResetButton(gapRow, 'Reset to default cell fill', () => {
            gapInput.value = '60';
            gapValue.textContent = '60%';
            gppSettings.gapRatio = 0.6;
            gppState.saveSettings();
            gppScheduleRenderer();
            onChange && onChange();
        });
        wrap.appendChild(gapRow);

        // "Only show current template on map" — on by default (changed from
        // off per explicit product decision: this is the behavior most
        // people want, and it composes with gpp-renderer.js's
        // gppRendererIsTemplateVisible fix (opacity 0 = zero GPU/canvas
        // resources) to guarantee at most one template's resources are ever
        // held at once — a real performance win for a big library, not just
        // a viewing preference). When on, focusing a template hides every
        // other one (gppFocusTemplate -> gppApplyAutoHideUnfocused,
        // gpp-runtime.js); also applied immediately here on check (not just
        // on the next focus change) so the setting feels live rather than
        // inert until you happen to refocus something. Setting key
        // (gppSettings.autoHideUnfocused) and element id
        // (gpp-vs-auto-hide-unfocused) are unchanged — only the label text
        // changed, so existing saved settings still apply correctly.
        const autoHideRow = document.createElement('div');
        autoHideRow.className = 'gpp-vs-row gpp-vs-checkbox';
        const autoHideLabel = document.createElement('label');
        const autoHideInput = document.createElement('input');
        autoHideInput.type = 'checkbox';
        autoHideInput.id = 'gpp-vs-auto-hide-unfocused';
        autoHideInput.checked = !!gppSettings.autoHideUnfocused;
        const autoHideText = document.createElement('span');
        autoHideText.textContent = 'Only show current template on map';
        autoHideLabel.htmlFor = autoHideInput.id;
        // No native title here -- gppAttachTooltip(autoHideText, ...) below
        // covers the text span with a custom tooltip; see gapInput's own
        // comment above for why a title on THIS specific nested element
        // would otherwise stack a native tooltip on top of it.
        autoHideLabel.append(autoHideInput, autoHideText);
        autoHideRow.appendChild(autoHideLabel);
        // hoverElement=autoHideText (text only, not the checkbox --
        // explicit user feedback), focusElement=autoHideInput.
        if (typeof gppAttachTooltip === 'function') gppAttachTooltip(autoHideText, "Only ever show the template you're currently focused on — every other template hides automatically. Also reduces memory/GPU usage when you have many (or very large) templates.", autoHideInput);
        autoHideInput.addEventListener('change', () => {
            gppSettings.autoHideUnfocused = autoHideInput.checked;
            gppState.saveSettings();
            if (autoHideInput.checked && gppState.focusedTemplateId) {
                gppState.applyAutoHideUnfocused(gppState.focusedTemplateId).then(() => onChange && onChange());
            } else {
                onChange && onChange();
            }
        });
        wrap.appendChild(autoHideRow);

        // "Gray unselected color boxes" — on by default (today's existing
        // behavior). A disabled palette swatch (gpp-palette.js) always gets
        // the diagonal slash regardless of this setting — that part is
        // non-negotiable, per explicit product decision. This checkbox only
        // controls the EXTRA grayscale/opacity dimming layered on top of the
        // slash: on, a disabled swatch is both grayed AND slashed (today's
        // look); off, it's slashed only, with its true color still showing
        // through. Applied live via gpp-palette.js's performFilterSort,
        // which reads this setting fresh on every render — no
        // per-template state to touch here, unlike Auto-hide above.
        const grayRow = document.createElement('div');
        grayRow.className = 'gpp-vs-row gpp-vs-checkbox';
        const grayLabel = document.createElement('label');
        const grayInput = document.createElement('input');
        grayInput.type = 'checkbox';
        grayInput.id = 'gpp-vs-gray-disabled-swatches';
        grayInput.checked = gppSettings.grayDisabledSwatches !== false;
        const grayText = document.createElement('span');
        grayText.textContent = 'Gray unselected color boxes';
        grayLabel.htmlFor = grayInput.id;
        // No native title here -- gppAttachTooltip(grayText, ...) below
        // covers the text span with a custom tooltip; see gapInput's own
        // comment above for why a title on THIS specific nested element
        // would otherwise stack a native tooltip on top of it.
        grayLabel.append(grayInput, grayText);
        grayRow.appendChild(grayLabel);
        // hoverElement=grayText (text only, not the checkbox -- explicit
        // user feedback), focusElement=grayInput. Wording per explicit user preference.
        if (typeof gppAttachTooltip === 'function') gppAttachTooltip(grayText, 'When enabled, disabled color tiles appear grayed out.', grayInput);
        grayInput.addEventListener('change', () => {
            gppSettings.grayDisabledSwatches = grayInput.checked;
            gppState.saveSettings();
            onChange && onChange();
        });
        wrap.appendChild(grayRow);

        // "Palette view" — grid (default, the current tile layout) vs list
        // (compact rectangular rows showing the hex value, placed/total as
        // "x/y", and a mini progress bar). Still driven by the exact same
        // sort/filter state as the grid — this only changes how each
        // already-filtered/sorted color is drawn (see gpp-palette.js's
        // performFilterSort, which reads gppSettings.paletteViewMode fresh
        // on every refresh, same live-toggle pattern as Gray unselected
        // color boxes above — no template switch needed to see it apply).
        const viewModeRow = document.createElement('div');
        viewModeRow.className = 'gpp-vs-row';
        const viewModeLabel = document.createElement('span');
        viewModeLabel.className = 'gpp-vs-label';
        viewModeLabel.textContent = 'Palette view';
        const viewModeToggle = document.createElement('div');
        viewModeToggle.className = 'gpp-vs-view-toggle';
        const gridViewBtn = document.createElement('button');
        gridViewBtn.type = 'button';
        gridViewBtn.className = 'gpp-vs-view-btn';
        gridViewBtn.id = 'gpp-vs-palette-view-grid';
        gridViewBtn.textContent = '▦';
        gridViewBtn.title = 'Grid view';
        const listViewBtn = document.createElement('button');
        listViewBtn.type = 'button';
        listViewBtn.className = 'gpp-vs-view-btn';
        listViewBtn.id = 'gpp-vs-palette-view-list';
        listViewBtn.textContent = '☰';
        listViewBtn.title = 'List view';
        function syncPaletteViewButtons() {
            const mode = gppSettings.paletteViewMode === 'list' ? 'list' : 'grid';
            gridViewBtn.classList.toggle('gpp-vs-view-btn-active', mode === 'grid');
            listViewBtn.classList.toggle('gpp-vs-view-btn-active', mode === 'list');
        }
        syncPaletteViewButtons();
        gridViewBtn.addEventListener('click', () => {
            if (gppSettings.paletteViewMode === 'grid') return;
            gppSettings.paletteViewMode = 'grid';
            gppState.saveSettings();
            syncPaletteViewButtons();
            onChange && onChange();
        });
        listViewBtn.addEventListener('click', () => {
            if (gppSettings.paletteViewMode === 'list') return;
            gppSettings.paletteViewMode = 'list';
            gppState.saveSettings();
            syncPaletteViewButtons();
            onChange && onChange();
        });
        viewModeToggle.append(gridViewBtn, listViewBtn);
        viewModeRow.append(viewModeLabel, viewModeToggle);
        wrap.appendChild(viewModeRow);

        // "Rescale Ghost++" — per explicit user feedback ("i reeeally dont
        // like how much bigger the box is now" / "The ability to actually
        // SCALE the size of the ghost++ menu not just resize with
        // corners"): a uniform CSS transform: scale() on the whole modal
        // (gpp-ui-shell.js's --gpp-scale custom property), so every piece
        // of content — text, buttons, swatches, padding — shrinks or grows
        // together. Unlike dragging a resize corner (which only changes
        // how much of the SAME-sized content is visible/scrollable before
        // scrolling kicks in), this actually makes the content itself
        // smaller or larger. 50%-150%, default 100%, step 5%.
        function gppApplyUiScale(scale) {
            const modal = document.getElementById(GPP_IDS.modal);
            if (modal) modal.style.setProperty('--gpp-scale', String(scale));
        }
        const scaleRow = document.createElement('div');
        scaleRow.className = 'gpp-vs-row';
        const scaleLabel = document.createElement('label');
        scaleLabel.className = 'gpp-vs-label';
        scaleLabel.htmlFor = 'gpp-vs-ui-scale';
        scaleLabel.textContent = 'Rescale Ghost++';
        const scaleInput = document.createElement('input');
        scaleInput.type = 'range';
        scaleInput.id = 'gpp-vs-ui-scale';
        scaleInput.min = '50';
        scaleInput.max = '150';
        scaleInput.step = '5';
        const currentScale = gppClamp(Number.isFinite(gppSettings.uiScale) ? gppSettings.uiScale : 1, 0.5, 1.5);
        scaleInput.value = String(Math.round(currentScale * 100));
        const scaleValue = document.createElement('span');
        scaleValue.className = 'gpp-vs-value';
        scaleValue.textContent = scaleInput.value + '%';
        scaleInput.addEventListener('input', () => {
            // Deliberately does NOT apply the scale live during the drag
            // anymore -- per explicit user feedback ("unwieldy... changes
            // sizes immediately while adjusting"), only the % label updates
            // while dragging; the panel itself only rescales once the value
            // commits (the 'change' listener below, which fires on mouse
            // release or keyup) -- same "input vs change" split already
            // used for range-slider-blurs-on-change (gpp-ui-shell.js).
            scaleValue.textContent = scaleInput.value + '%';
        });
        scaleInput.addEventListener('change', () => {
            gppSettings.uiScale = gppClamp(Number(scaleInput.value) / 100, 0.5, 1.5);
            gppApplyUiScale(gppSettings.uiScale);
            gppState.saveSettings();
            onChange && onChange();
        });
        scaleRow.append(scaleLabel, scaleInput, scaleValue);
        // hoverElement=scaleLabel (text only, not the slider -- consistent
        // with every other setting's tooltip per explicit user feedback),
        // focusElement=scaleInput.
        if (typeof gppAttachTooltip === 'function') gppAttachTooltip(scaleLabel, 'Scales the entire Ghost++ panel — text, buttons, colors, and all — up or down, independent of the corner-drag resize.', scaleInput);
        gppAddResetButton(scaleRow, 'Reset to default scale', () => {
            scaleInput.value = '100';
            scaleValue.textContent = '100%';
            gppSettings.uiScale = 1;
            gppApplyUiScale(1);
            gppState.saveSettings();
            onChange && onChange();
        });
        wrap.appendChild(scaleRow);
        // Always reassert the persisted scale on every render (not just
        // when the slider itself changes), so a saved scale still applies
        // immediately on reopen/refresh, before the user ever touches this
        // slider again.
        gppApplyUiScale(currentScale);

        // No "Native compatibility" toggle — it's assumed on for as long as
        // Ghost++ itself is enabled (see gpp-native-shim.js), by explicit
        // product decision. There's nothing meaningful to opt out of
        // independently: it keeps native cursor sampling, error-cross
        // rendering, and the location readout pointed at your focused
        // template, and no painting or queue submission is automated.

        // No zoom-out completed-preview toggle here anymore — replaced by the
        // Position/Transform panel's manual "Preview" button (gpp-placement.js),
        // which just drives the same template.opacity field the visibility
        // eye-icon/Opacity slider already use, per explicit product decision.

        return wrap;
    }

    function gppRenderViewSettings(container, template, onChange) {
        'use strict';
        if (!container) return;
        gppInjectViewSettingsStyle();

        // Preserve the <details> open/closed state across the full-rebuild
        // refreshes gpp-init.js triggers after every onChange() — without
        // this, committing any control (a slider's 'change', a checkbox)
        // would snap the whole section shut on every interaction. Defaults
        // to COLLAPSED on the very first render (no prior <details> to read)
        // — per explicit product decision, View Settings and Error Settings
        // start collapsed while Progress/Template Colors/Template Settings/
        // Templates start expanded.
        const previous = container.querySelector('details.gpp-collapsible');
        const wasOpen = previous ? previous.open : false;

        container.innerHTML = '';

        const details = document.createElement('details');
        details.className = 'gpp-collapsible';
        details.open = wasOpen;

        const summary = document.createElement('summary');
        summary.textContent = 'View Settings';
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'gpp-body';
        body.appendChild(gppBuildGlobalViewSettingsSection(onChange));
        details.appendChild(body);

        container.appendChild(details);
    }
