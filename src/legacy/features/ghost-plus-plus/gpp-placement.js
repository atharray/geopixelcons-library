    // ── Ghost++ placement / transform panel ───────────────────────────
    // Implements gppRenderPositionTransform(container, template, onChange)
    // per gpp-init.js's render-function contract: top-left X/Y fields,
    // click-to-place map capture, one-cell nudge buttons, an opacity slider,
    // a lock checkbox, and a group-noise checkbox. Reads/writes only through
    // gppState (gpp-runtime.js) and the page-realm bridge (gpp-bridge.js) —
    // never touches map/turf/grid globals directly. No flip/rotate controls
    // here — removed per explicit product decision (easy to do in any image
    // editor before importing; not worth the UI weight).

    // Templates currently pinned to "Preview" (100% opacity, solid cell
    // fill, regardless of their own persisted opacity/gapRatio) — a
    // transient, session-only view aid, deliberately NOT persisted and
    // deliberately NOT the same mechanism as template.opacity/the visibility
    // eye-icon (see gpp-renderer.js's gppRendererDrawWebGl/Canvas2d, which
    // read this Set directly — same shared-top-level-scope pattern as
    // gppPlacementPreview below).
    let gppForcedVisibleTemplateIds = new Set();

    // A guild template (template.ephemeral — gpp-guild-templates.js's grid,
    // or the guild menu's "Set as Ghost") is always treated as position-
    // locked, regardless of its own (always-false, since guild stubs never
    // persist) `locked` field — per explicit product decision, no user
    // should be able to move a guild template from this UI, even purely
    // client-side for the current session. Used everywhere template.locked
    // alone used to gate a position mutation, both in this panel's own
    // controls AND the global keyboard shortcuts below, so there is no
    // bypass route (a disabled button alone would not stop Arrow-key nudge
    // or the E-to-place shortcut, which read gppState fresh rather than
    // this panel's own render-time `disabledAttr`).
    function gppIsPositionLocked(template) {
        return !!template && (!!template.locked || !!template.ephemeral);
    }

    // Debounces the focused template's IndexedDB state write while the
    // Opacity slider is being dragged (many 'input' events per drag) —
    // moved here from gpp-view-settings.js along with the slider itself.
    let gppOpacityPersistTimer = null;
    function gppScheduleOpacityPersist(template) {
        if (gppOpacityPersistTimer) clearTimeout(gppOpacityPersistTimer);
        gppOpacityPersistTimer = setTimeout(() => {
            gppOpacityPersistTimer = null;
            gppState.persistTemplateState(template).catch(err => {
                console.error('[GeoPixelcons++] Ghost++ placement: failed to persist template opacity.', err);
            });
        }, 300);
    }

    // Active click-to-place capture, if any. Only one can be in flight at a
    // time; a fresh render (focus change, template deleted, panel rebuilt)
    // always tears down a stale capture via gppCancelPlacementCapture().
    let gppPlacementCaptureCleanup = null;

    // { templateId, position } while a placement capture is tracking the
    // pointer, else null. gpp-renderer.js's gppRendererProjectTemplate()
    // reads this directly (shared top-level scope — see build.js's
    // SRC_ORDER banner) and, when it matches the template being drawn,
    // draws at this position INSTEAD of template.position — this is what
    // makes the ghost image visibly follow the cursor before the placing
    // click commits it, matching the original prototype's
    // (scripts/geopixels-ghost-template-overhaul/1.0.0.js) placementPreview.
    let gppPlacementPreview = null;

    function gppCancelPlacementCapture() {
        if (gppPlacementCaptureCleanup) {
            try { gppPlacementCaptureCleanup(); } catch (_) { /* ignore */ }
            gppPlacementCaptureCleanup = null;
        }
    }

    // Inverse of the renderer's projection: screen pixel -> lngLat (via the
    // live map) -> Web Mercator metres (via turf) -> grid cell (subtract the
    // site's grid origin offset, divide by cell size, round to the nearest
    // integer cell).
    function gppMapClientPointToGrid(map, turf, grid, clientX, clientY) {
        const rect = map.getContainer().getBoundingClientRect();
        const lngLat = map.unproject([clientX - rect.left, clientY - rect.top]);
        if (!lngLat) return null;
        const lng = typeof lngLat.lng === 'number' ? lngLat.lng : lngLat[0];
        const lat = typeof lngLat.lat === 'number' ? lngLat.lat : lngLat[1];
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        const mercator = turf.toMercator([lng, lat]);
        if (!mercator) return null;
        return {
            gridX: Math.round((mercator[0] - grid.offsetMetersX) / grid.gridSize),
            gridY: Math.round((mercator[1] - grid.offsetMetersY) / grid.gridSize),
        };
    }

    // Installs a one-shot, capture-phase click listener directly on the
    // map's container. Capture-phase + stopPropagation/stopImmediatePropagation
    // means the click is consumed before it can ever reach the map canvas's
    // own (native painting) click handler — this is a hard safety
    // requirement, not cosmetic: Ghost++ must never cause a stray pixel
    // placement. `onStatus(text, isError)` is optional UI feedback.
    function gppBeginPlacementCapture(template, onPlaced, onStatus) {
        gppCancelPlacementCapture();
        // Defense in depth — both real call sites (the Place button and the
        // E-to-place keyboard shortcut) already check gppIsPositionLocked
        // before ever reaching here, but this guards against any future or
        // overlooked caller too.
        if (gppIsPositionLocked(template)) {
            if (onStatus) onStatus('This template’s position is locked.', true);
            return;
        }
        const map = gppGetMap();
        const turf = gppGetTurf();
        if (!map || !turf) {
            if (onStatus) onStatus('Map is not ready yet.', true);
            return;
        }
        const mapContainer = map.getContainer();
        const grid = gppReadGridConstants();
        const previousCursor = mapContainer.style.cursor;
        mapContainer.style.cursor = 'crosshair';

        function cleanup() {
            mapContainer.removeEventListener('click', handleClick, true);
            mapContainer.removeEventListener('mousemove', handleMouseMove);
            mapContainer.removeEventListener('mouseleave', handleMouseLeave);
            document.removeEventListener('keydown', handleKeyDown, true);
            mapContainer.style.cursor = previousCursor;
            gppPlacementCaptureCleanup = null;
            if (gppPlacementPreview && gppPlacementPreview.templateId === template.id) {
                gppPlacementPreview = null;
                gppNotifyRendererSchedule();
            }
        }

        function handleMouseMove(event) {
            const position = gppMapClientPointToGrid(map, turf, grid, event.clientX, event.clientY);
            if (!position) return;
            gppPlacementPreview = { templateId: template.id, position };
            gppNotifyRendererSchedule();
        }

        function handleMouseLeave() {
            if (!gppPlacementPreview || gppPlacementPreview.templateId !== template.id) return;
            gppPlacementPreview = null;
            gppNotifyRendererSchedule();
        }

        function handleClick(event) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            const position = gppMapClientPointToGrid(map, turf, grid, event.clientX, event.clientY);
            cleanup();
            if (position) onPlaced(position);
            else if (onStatus) onStatus('Could not resolve that click to a grid cell.', true);
        }

        function handleKeyDown(event) {
            if (event.key !== 'Escape') return;
            cleanup();
            if (onStatus) onStatus('Placement cancelled.', false);
        }

        mapContainer.addEventListener('click', handleClick, true);
        mapContainer.addEventListener('mousemove', handleMouseMove);
        mapContainer.addEventListener('mouseleave', handleMouseLeave);
        document.addEventListener('keydown', handleKeyDown, true);
        gppPlacementCaptureCleanup = cleanup;
        if (onStatus) onStatus('Move the pointer over the map to preview the template, then click to set its top-left cell. Escape cancels.', false);
    }

    // Scoped, once-injected styling for this panel's controls (mirrors
    // gpp-ui-shell.js's gppInjectShellStyle guard-by-id pattern). Classed
    // rather than bare-element selectors so it can never leak into other
    // Ghost++ panels' buttons/inputs.
    // Rewrites content every call (see gpp-init.js's theme-change observer)
    // instead of no-op-ing once created, so a live dark/light toggle isn't
    // frozen at whatever theme was active on first mount.
    function gppInjectPlacementStyle() {
        let style = document.getElementById('gpp-pt-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'gpp-pt-style';
            document.head.appendChild(style);
        }
        style.textContent = `
            .gpp-pt-btn {
                padding: 3px 9px; border-radius: 4px; cursor: pointer; font-size: 12px;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#f8fafc', '#313244')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-pt-btn:hover:not(:disabled) { background: ${t2('#e2e8f0', '#45475a')}; }
            .gpp-pt-btn:disabled { opacity: .45; cursor: not-allowed; }
            /* Place / Unset / Go to / Preview line up as roughly-equal-width
               columns via flex-grow, but (unlike a fixed-column grid, which
               has no wrap mechanism and forces this row to overflow its
               container once shrunk past the buttons' combined min-content
               width) flex-wrap lets them reflow onto a second line as the
               right panel narrows — matching the nudge-arrow row below,
               which already uses this same pattern. */
            .gpp-pt-row3 {
                display: flex; flex-wrap: wrap; gap: 6px;
            }
            .gpp-pt-row3 .gpp-pt-btn { flex: 1 1 64px; box-sizing: border-box; text-align: center; }
            .gpp-pt-btn-active { border-color: ${t2('#2563eb', '#89b4fa')}; color: ${t2('#2563eb', '#89b4fa')}; }
            .gpp-pt-opacity-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
            .gpp-pt-opacity-row label { flex: 0 0 auto; min-width: 50px; font-size: 12px; color: ${t2('#1f2937', '#e2e2f5')}; }
            .gpp-pt-opacity-row input[type="range"] { flex: 1 1 auto; min-width: 0; }
            .gpp-pt-opacity-value {
                flex: 0 0 auto; min-width: 34px; text-align: right; font-size: 11px;
                font-variant-numeric: tabular-nums; color: ${t2('#475569', '#a6adc8')};
            }
            .gpp-pt-reset-btn {
                border: none; background: transparent; cursor: pointer; font-size: 13px;
                padding: 0 2px; flex-shrink: 0; color: ${t2('#64748b', '#a6adc8')};
            }
            .gpp-pt-input {
                width: 100%; box-sizing: border-box; padding: 4px 6px; border-radius: 4px; font-size: 12px;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#ffffff', '#11111b')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-pt-input:disabled { opacity: .5; }
            .gpp-pt-field { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: ${t2('#64748b', '#a6adc8')}; }
            .gpp-pt-lock { display: flex; align-items: center; gap: 4px; font-size: 12px; color: ${t2('#111827', '#f5f5f5')}; margin-left: auto; }
        `;
    }

    function gppNotifyRendererSchedule() {
        if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
    }

    function gppRenderPositionTransform(container, template, onChange) {
        if (!container) return;
        // Any panel rebuild (focus change, delete, ordinary refresh) tears
        // down a stale in-flight placement capture — it can only ever be
        // valid for the render that started it.
        gppCancelPlacementCapture();
        gppInjectPlacementStyle();

        // Preserve the <details> open/closed state across the full-rebuild
        // refreshes gpp-init.js triggers after every onChange() (a palette
        // swatch toggle, an unrelated section's edit, etc.) — without this,
        // any interaction anywhere in the modal would snap this section back
        // open, per gpp-view-settings.js's identical pattern for the same
        // reason. Defaults to open on the very first render.
        const previousDetails = container.querySelector('details.gpp-collapsible');
        const wasOpen = previousDetails ? previousDetails.open : true;

        container.innerHTML = '';

        const details = document.createElement('details');
        details.className = 'gpp-collapsible';
        details.open = wasOpen;
        const summary = document.createElement('summary');
        summary.textContent = 'Template Settings';
        const body = document.createElement('div');
        body.className = 'gpp-body';
        details.appendChild(summary);
        details.appendChild(body);
        container.appendChild(details);

        if (!template) {
            const empty = document.createElement('p');
            empty.style.cssText = `margin: 0; font-size: 12px; color: ${t2('#64748b', '#a6adc8')};`;
            empty.textContent = 'No template selected.';
            body.appendChild(empty);
            return;
        }

        const locked = gppIsPositionLocked(template);
        const disabledAttr = locked ? 'disabled' : '';
        const groupNoise = !!template.groupNoise;

        body.innerHTML = `
            <div style="display:flex; gap:8px; margin-bottom:8px;">
                <label class="gpp-pt-field">Top-left X
                    <input id="gpp-pt-x" class="gpp-pt-input" type="number" step="1" ${disabledAttr}>
                </label>
                <label class="gpp-pt-field">Top-left Y
                    <input id="gpp-pt-y" class="gpp-pt-input" type="number" step="1" ${disabledAttr}>
                </label>
            </div>
            <div class="gpp-pt-row3" style="margin-bottom:6px;">
                <button type="button" id="gpp-pt-place" class="gpp-pt-btn" ${disabledAttr}>Place</button>
                <button type="button" id="gpp-pt-unset" class="gpp-pt-btn" ${(template.position && !locked) ? '' : 'disabled'} title="Unloads the template from the map — click Place again to put it back">Unset</button>
                <button type="button" id="gpp-pt-goto" class="gpp-pt-btn" ${template.position ? '' : 'disabled'}>Go to</button>
                <button type="button" id="gpp-pt-preview" class="gpp-pt-btn" title="Temporarily show this template at 100% opacity with no cell gaps, without changing its actual Opacity setting">Preview</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:6px;">
                <button type="button" id="gpp-pt-nudge-left" class="gpp-pt-btn" title="Nudge left" ${disabledAttr}>&larr;</button>
                <button type="button" id="gpp-pt-nudge-up" class="gpp-pt-btn" title="Nudge up" ${disabledAttr}>&uarr;</button>
                <button type="button" id="gpp-pt-nudge-down" class="gpp-pt-btn" title="Nudge down" ${disabledAttr}>&darr;</button>
                <button type="button" id="gpp-pt-nudge-right" class="gpp-pt-btn" title="Nudge right" ${disabledAttr}>&rarr;</button>
            </div>
            <div class="gpp-pt-opacity-row">
                <label for="gpp-pt-opacity">Opacity</label>
                <input id="gpp-pt-opacity" type="range" min="0" max="100" step="1" title="Template overlay opacity. 0% is fully invisible.">
                <span id="gpp-pt-opacity-value" class="gpp-pt-opacity-value"></span>
                <button type="button" id="gpp-pt-opacity-reset" class="gpp-pt-reset-btn" title="Reset to default opacity">&#8630;</button>
            </div>
            <div style="display:flex; align-items:center; margin-bottom:6px;">
                <label id="gpp-pt-lock-label" class="gpp-pt-lock" style="margin-left:0;"><input id="gpp-pt-lock" type="checkbox" ${locked ? 'checked' : ''} ${template.ephemeral ? 'disabled' : ''}> <span id="gpp-pt-lock-text">Lock Position</span></label>
            </div>
            <div style="display:flex; align-items:center; margin-bottom:2px;">
                <label id="gpp-pt-group-noise-label" class="gpp-pt-lock" style="margin-left:0;"><input id="gpp-pt-group-noise" type="checkbox" ${groupNoise ? 'checked' : ''}> <span id="gpp-pt-group-noise-text">Group noise</span></label>
            </div>
            <div id="gpp-pt-status" style="font-size:11px; min-height:14px; color:${t2('#64748b', '#a6adc8')};"></div>
        `;

        const xInput = body.querySelector('#gpp-pt-x');
        const yInput = body.querySelector('#gpp-pt-y');
        xInput.value = template.position ? String(template.position.gridX) : '';
        yInput.value = template.position ? String(template.position.gridY) : '';
        const statusEl = body.querySelector('#gpp-pt-status');

        if (typeof gppAttachTooltip === 'function') {
            // hoverElement is the TEXT span, not the wrapping <label> (which
            // also contains the checkbox) -- explicit user feedback:
            // hovering the checkbox itself must not show the tooltip.
            // focusElement is the actual checkbox input, so keyboard Tab
            // still surfaces the same help. Wording per explicit user
            // preference for the normal (non-guild) Lock Position case; the
            // ephemeral/guild case keeps its own more specific explanation,
            // since "cannot be repositioned" alone wouldn't explain WHY to
            // someone looking at a guild template.
            gppAttachTooltip(
                body.querySelector('#gpp-pt-lock-text'),
                template.ephemeral
                    ? "Guild templates are always position-locked — you can't move them from this UI."
                    : 'When enabled, template cannot be repositioned.',
                body.querySelector('#gpp-pt-lock')
            );
            gppAttachTooltip(body.querySelector('#gpp-pt-group-noise-text'), 'When enabled, Group Noise takes effect, combining similar colors with each other.', body.querySelector('#gpp-pt-group-noise'));
        }

        function setStatus(text, isError) {
            statusEl.textContent = text || '';
            statusEl.style.color = isError ? t2('#dc2626', '#f38ba8') : t2('#64748b', '#a6adc8');
        }

        async function commitPosition(gridX, gridY) {
            if (gppIsPositionLocked(template)) return;
            if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) return;
            template.position = { gridX: Math.round(gridX), gridY: Math.round(gridY) };
            await gppState.persistTemplateState(template);
            gppNotifyRendererSchedule();
            onChange();
        }

        function readCoordInputs() {
            const xText = xInput.value.trim();
            const yText = yInput.value.trim();
            const x = Number(xText);
            const y = Number(yText);
            if (!xText || !yText || !Number.isInteger(x) || !Number.isInteger(y)) {
                setStatus('Enter both coordinates as whole numbers.', true);
                return null;
            }
            return { gridX: x, gridY: y };
        }

        function commitCoordInputs() {
            const parsed = readCoordInputs();
            if (!parsed) return;
            commitPosition(parsed.gridX, parsed.gridY).catch(err => setStatus(err && err.message ? err.message : String(err), true));
        }
        xInput.addEventListener('change', commitCoordInputs);
        yInput.addEventListener('change', commitCoordInputs);

        body.querySelector('#gpp-pt-place').addEventListener('click', () => {
            if (gppIsPositionLocked(template)) return;
            gppBeginPlacementCapture(
                template,
                position => {
                    commitPosition(position.gridX, position.gridY)
                        .then(() => setStatus(`Placed at ${position.gridX}, ${position.gridY}.`, false))
                        .catch(err => setStatus(err && err.message ? err.message : String(err), true));
                },
                (text, isError) => setStatus(text, isError)
            );
        });

        // Reuses gpp-library.js's instant (jumpTo, not eased) teleport — same
        // action as a library card's "go to" arrow, just reachable without
        // leaving this panel.
        const gotoBtn = body.querySelector('#gpp-pt-goto');
        if (gotoBtn && !gotoBtn.disabled) {
            gotoBtn.addEventListener('click', () => {
                if (typeof gppLibraryFlyToTemplate === 'function') gppLibraryFlyToTemplate(template);
            });
        }

        const unsetBtn = body.querySelector('#gpp-pt-unset');
        if (unsetBtn && !unsetBtn.disabled) {
            unsetBtn.addEventListener('click', () => {
                if (gppIsPositionLocked(template)) return;
                gppCancelPlacementCapture();
                template.position = null;
                gppState.persistTemplateState(template)
                    .then(() => {
                        gppNotifyRendererSchedule();
                        setStatus('Position cleared — click Place to show it again.', false);
                        onChange();
                    })
                    .catch(err => setStatus(err && err.message ? err.message : String(err), true));
            });
        }

        // A transient view aid, deliberately SEPARATE from template.opacity/
        // the visibility eye-icon (see gppForcedVisibleTemplateIds' own
        // comment near the top of this file) — toggling it never touches
        // the persisted opacity setting, and never persists itself.
        const previewBtn = body.querySelector('#gpp-pt-preview');
        const paintPreviewBtn = () => {
            previewBtn.classList.toggle('gpp-pt-btn-active', gppForcedVisibleTemplateIds.has(template.id));
        };
        paintPreviewBtn();
        previewBtn.addEventListener('click', () => {
            if (gppForcedVisibleTemplateIds.has(template.id)) gppForcedVisibleTemplateIds.delete(template.id);
            else gppForcedVisibleTemplateIds.add(template.id);
            paintPreviewBtn();
            gppNotifyRendererSchedule();
        });

        const opacityInput = body.querySelector('#gpp-pt-opacity');
        const opacityValueEl = body.querySelector('#gpp-pt-opacity-value');
        opacityInput.value = String(Math.round(gppClamp(template.opacity, 0, 1) * 100));
        opacityValueEl.textContent = opacityInput.value + '%';
        opacityInput.addEventListener('input', () => {
            opacityValueEl.textContent = opacityInput.value + '%';
            template.opacity = gppClamp(Number(opacityInput.value) / 100, 0, 1);
            gppNotifyRendererSchedule();
            gppScheduleOpacityPersist(template);
        });
        opacityInput.addEventListener('change', () => {
            gppScheduleOpacityPersist(template);
            onChange();
        });
        body.querySelector('#gpp-pt-opacity-reset').addEventListener('click', () => {
            opacityInput.value = '100';
            opacityValueEl.textContent = '100%';
            template.opacity = 1;
            gppNotifyRendererSchedule();
            gppScheduleOpacityPersist(template);
            onChange();
        });

        function nudge(deltaX, deltaY) {
            if (gppIsPositionLocked(template)) return;
            const base = template.position || { gridX: 0, gridY: 0 };
            commitPosition(base.gridX + deltaX, base.gridY + deltaY)
                .catch(err => setStatus(err && err.message ? err.message : String(err), true));
        }
        body.querySelector('#gpp-pt-nudge-left').addEventListener('click', () => nudge(-1, 0));
        body.querySelector('#gpp-pt-nudge-right').addEventListener('click', () => nudge(1, 0));
        // Grid Y is up-positive: "up" increases gridY, "down" decreases it.
        body.querySelector('#gpp-pt-nudge-up').addEventListener('click', () => nudge(0, 1));
        body.querySelector('#gpp-pt-nudge-down').addEventListener('click', () => nudge(0, -1));

        body.querySelector('#gpp-pt-lock').addEventListener('change', event => {
            template.locked = !!event.target.checked;
            if (template.locked) gppCancelPlacementCapture();
            gppState.persistTemplateState(template)
                .then(() => onChange())
                .catch(err => setStatus(err && err.message ? err.message : String(err), true));
        });

        // Bundled with the template like the original Ghost Template Manager's
        // own per-image groupNoise field (ghost-template-manager.js) — not a
        // one-off UI preference. gppShimSyncFocusedTemplate() best-effort
        // mirrors this onto the native #groupNoiseToggle checkbox (see
        // gpp-native-shim.js) for whatever native-tool compatibility that's
        // still worth while Ghost++ owns the overlay.
        body.querySelector('#gpp-pt-group-noise').addEventListener('change', event => {
            template.groupNoise = !!event.target.checked;
            gppState.persistTemplateState(template)
                .then(() => {
                    if (typeof gppShimSyncFocusedTemplate === 'function') gppShimSyncFocusedTemplate();
                    onChange();
                })
                .catch(err => setStatus(err && err.message ? err.message : String(err), true));
        });

    }

    // ── Global keyboard shortcuts ───────────────────────────────────────
    // Ghost++ shipped with none of these (only its on-screen buttons), but
    // an older, now-abandoned prototype of this same feature
    // (scripts/geopixels-ghost-template-overhaul/1.0.0.js — the version
    // several earlier product decisions in this file already cite) had a
    // global keydown handler that let arrow keys nudge the focused template
    // one cell at a time while its own modal was open. That's the one
    // concrete, evidenced shortcut worth restoring; it's reimplemented here
    // against gpp-pt-nudge-*'s own commitPosition-equivalent logic.
    // "Press E to place a template" (the reported regression) has no
    // matching binding in that prototype, the legacy Ghost Template Manager,
    // or the native site's own configurable keybinds (whose 'ghost' action
    // defaults to G and just opens/toggles the ghost tool — already handled
    // today by gpp-native-shim.js's click-capture redirect on
    // loadGhostImageBtn, independent of this file). E is added here as the
    // closest faithful equivalent: it enters the same click-to-place capture
    // gpp-pt-place's own button triggers, rather than silently doing nothing.

    // Mirrors gppRenderPositionTransform's own commitPosition() — duplicated
    // rather than shared because that one is a closure over a specific
    // render call's `template`/`onChange`/`setStatus`, none of which a
    // global, render-independent keydown listener has access to.
    async function gppShortcutCommitPosition(template, gridX, gridY) {
        if (!template || gppIsPositionLocked(template)) return;
        if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) return;
        template.position = { gridX: Math.round(gridX), gridY: Math.round(gridY) };
        await gppState.persistTemplateState(template);
        gppNotifyRendererSchedule();
        gppRequestUiRefresh();
    }

    function gppNudgeFocusedTemplateByKeyboard(deltaX, deltaY) {
        const template = gppState.getFocusedTemplate();
        if (!template || gppIsPositionLocked(template) || !template.position) return;
        gppShortcutCommitPosition(template, template.position.gridX + deltaX, template.position.gridY + deltaY)
            .catch(err => console.error('[GeoPixelcons++] Ghost++ keyboard nudge failed:', err));
    }

    function gppTriggerPlaceShortcut() {
        const template = gppState.getFocusedTemplate();
        if (!template || gppIsPositionLocked(template)) return;
        gppBeginPlacementCapture(
            template,
            position => {
                gppShortcutCommitPosition(template, position.gridX, position.gridY)
                    .catch(err => console.error('[GeoPixelcons++] Ghost++ keyboard place failed:', err));
            },
            null
        );
    }

    function gppHandlePlacementKeydown(event) {
        const modal = document.getElementById(GPP_IDS.modal);
        if (!modal || modal.classList.contains('gpp-hidden')) return;
        if (event.defaultPrevented) return;
        const target = event.target;
        if (target && typeof target.matches === 'function' && target.matches('input, textarea, select, [contenteditable="true"]')) return;
        // Grid Y is up-positive, matching gpp-pt-nudge-up/-down's own
        // convention (see nudge() above).
        const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
        const delta = deltas[event.key];
        if (delta) {
            event.preventDefault();
            event.stopPropagation();
            gppNudgeFocusedTemplateByKeyboard(delta[0], delta[1]);
            return;
        }
        if (event.key.length === 1 && event.key.toLowerCase() === 'e' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            gppTriggerPlaceShortcut();
        }
    }

    // Installed unconditionally alongside gpp-renderer.js's own auto-mount
    // gate (same `_settings.ghostPlusPlus` check, top-level script-load
    // time) rather than from inside open()/ensureRuntime() — the listener
    // itself is cheap and self-guards on the modal's own visibility on every
    // keystroke, so there's no benefit to a lazier install, and this keeps
    // it working the very first time the modal opens rather than only after
    // some other init path has run.
    if (_settings.ghostPlusPlus) {
        document.addEventListener('keydown', gppHandlePlacementKeydown, true);
    }
