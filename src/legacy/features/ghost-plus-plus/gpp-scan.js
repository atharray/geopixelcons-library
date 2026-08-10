    // ── Ghost++ progress/error scanning ───────────────────────────────
    // Compares a positioned template's opaque cells against the live map and
    // renders the segmented progress bar (gppRenderProgressBar, one of
    // gpp-init.js's render-function hooks). No cancel button/flow exists here
    // on purpose — per product decision, a scan runs to completion; it is
    // fast enough (cropped per-tile bitmaps, batched per-band getImageData, see
    // below) that a cancel affordance was rejected outright.
    //
    // ── scanSummary shape (documented contract for other Ghost++ files) ──
    //   template.scanSummary = {
    //     scannedAt: <ISO string>,
    //     total:   <int>,   // every opaque cell in the template, regardless of mask
    //     correct: <int>,   // ...and matched the map exactly
    //     wrong:   <int>,   // ...and the map has a different colour there
    //     missing: <int>,   // ...and the map tile is loaded but empty there
    //     unknown: <int>,   // ...and the map tile has not synced yet
    //     perColour: [ { index, enabled, correct, wrong, missing, unknown, total }, ... ],
    //       // one entry per palette index present in the template (counts[index] > 0),
    //       // `enabled` reflects template.mask AT SCAN TIME (kept for
    //       // consumers like gpp-palette.js's sort/filter), `total` is that
    //       // colour's opaque pixel count (template.counts[index]). correct/
    //       // wrong/missing/unknown are sampled the same regardless of `enabled`.
    //     states: Uint8Array(width*height),
    //       // one core.constants.ERROR_STATE byte per cell, row-major, same
    //       // indexing as template.indices (row 0 = northernmost row, since
    //       // template position.gridY is Y-up and decreases going down rows).
    //       // Only transparent cells stay ERROR_STATE.UNCHECKED (0) — every
    //       // opaque cell is sampled regardless of its colour's mask state.
    //   }
    //   By construction, correct+wrong+missing+unknown === total for a completed
    //   scan (every opaque cell lands in exactly one bucket) — this is a
    //   statement on the WHOLE template, matching the native ghost tool's own
    //   progress bar, and does not change when a colour is toggled on/off in
    //   the palette (mask still gates which colours draw error CROSSES on the
    //   map and which colours get queued for placement elsewhere — just not
    //   this aggregate count). Read scanSummary's top-level fields directly;
    //   there is no separate "live totals" recompute — the stored numbers
    //   never depend on the current mask, so they never need re-deriving.
    //
    // ── Error-visualization integration shape ─────────────────────────
    // gpp-renderer.js (the WebGL2/Canvas2D template overlay) does not exist yet
    // at the time this file was written, so there is no gppRendererSchedule()
    // to hook into (guarded with a typeof check below in case it lands later —
    // this file will additionally nudge it on every redraw request). Until then,
    // and as a permanent Canvas2D fallback either way, this file owns a small
    // dedicated transparent <canvas> layered inside the map container
    // (#gpp-scan-error-layer) that draws an X mark over each on-screen wrong/
    // missing cell, recomputed from template.scanSummary.states every redraw —
    // never from an accumulating array. If/when the WebGL2 renderer lands, it
    // can instead upload `states` as a per-cell error texture and skip this
    // canvas entirely; `states` (not this drawing code) is the authoritative,
    // documented contract. Redraws are requestAnimationFrame-coalesced and
    // triggered by: map 'move'/'zoom'/'resize', a completed scan, clear-errors,
    // and every gppRenderProgressBar call (so switching the focused template
    // updates the on-map markers even without moving the map).

    const GPP_SCAN_BAND_HEIGHT = 128; // rows per getImageData batch, matches the perf-tested GTM prototype

    let gppScanRunning = false;
    // Which template's scan gppScanRunning refers to — a genuinely concurrent
    // scan of a DIFFERENT template is impossible anyway (gppScanRunInternal
    // samples the single shared map canvas at the currently-visible viewport,
    // so gppScanRunning itself correctly stays a global lock, guarding both
    // gppScanTemplate's own busy check and gppScheduleAutoscan). This id
    // exists purely so the Progress section's buttons (rendered below) can
    // tell "a scan is running for THIS template" apart from "a scan is
    // running for some OTHER template the user has since swapped away from"
    // — without it, swapping focus away from a template with a slow
    // in-flight background scan (e.g. gppTriggerLoadTimeScan on a huge
    // template) left every OTHER template's buttons falsely stuck on
    // "Scanning…"/disabled until that unrelated scan finished.
    let gppScanningTemplateId = null;

    function gppScanIsBusyFor(template) {
        return gppScanRunning && !!template && gppScanningTemplateId === template.id;
    }

    // ── Autoscan (gppSettings.autoscanEnabled) ─────────────────────────
    // Automatically re-runs "Scan progress" on the focused template shortly
    // after the user places a pixel, instead of requiring a manual click
    // every time. Wraps the native placePixelAt (a plain function
    // DECLARATION in the page's own code — unlike a `let` binding, this
    // attaches to window normally, same reasoning as gpp-bridge.js's native
    // draw-function patches) non-destructively: always calls through to
    // whatever was there before (the true native original, or another
    // userscript's own wrapper — composes either way)
    // and only ADDS a debounced scan trigger afterward, never altering
    // placement behaviour itself. Installed once, self-guards on the
    // setting so it's safe to call unconditionally on every runtime init.
    let gppAutoscanHookInstalled = false;
    let gppAutoscanDebounceTimer = null;

    function gppScheduleAutoscan() {
        // Mobile Overhaul promises always-live progress with no manual Scan
        // action. Reuse the existing trailing debounce instead of scanning
        // once per queued pixel; desktop behavior remains setting-controlled.
        if (!gpcMobileOverhaulAvailable() && !gppSettings.autoscanEnabled) return;
        clearTimeout(gppAutoscanDebounceTimer);
        gppAutoscanDebounceTimer = setTimeout(() => {
            const template = gppState.getFocusedTemplate();
            if (!template || !template.position || gppScanRunning) return;
            // Unlike the manual Scan button's own click handler (below,
            // ~line 890), which calls onChange() both immediately AND again
            // once its promise resolves, this fires from a bare setTimeout —
            // completely decoupled from any refresh. Without the immediate
            // call here, the button could start scanning without ever
            // visibly showing "Scanning…", relying entirely on some
            // unrelated later action to reveal that state; without the
            // .finally() below, it could stay stuck showing "Scanning…"
            // after finishing, for the same reason. Together these make
            // this call site self-sufficient instead of implicitly
            // depending on whatever else happens to trigger a refresh.
            // gppScanTemplate sets gppScanRunning/gppScanningTemplateId
            // SYNCHRONOUSLY before its first await, so the refresh must
            // come AFTER calling it — refreshing first would still see the
            // old, not-yet-busy state and never show Scanning… at all.
            const pending = gppScanTemplate(template);
            if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
            pending.catch(err => {
                console.error('[GeoPixelcons++] Ghost++ autoscan failed:', err);
            }).finally(() => {
                if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
            });
        }, 1500);
    }

    function gppEnsureAutoscanHook() {
        if (gppAutoscanHookInstalled) return;
        const target = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        const orig = target.placePixelAt;
        if (typeof orig !== 'function') return; // native function not ready yet — next init call retries
        gppAutoscanHookInstalled = true;
        target.placePixelAt = function gppPlacePixelAtAutoscanWrapper() {
            const result = orig.apply(this, arguments);
            gppScheduleAutoscan();
            // Unconditional (not gated on autoscanEnabled), unlike the scan
            // trigger above: Hide queued crosshairs needs the on-screen
            // markers to refresh promptly after each placement/queue call,
            // not just after a full rescan. gppScanScheduleErrorRedraw() is
            // already requestAnimationFrame-coalesced, so calling it on every
            // pixel during a bulk queue run still only redraws once per frame.
            gppScanScheduleErrorRedraw();
            return result;
        };
    }

    function gppScanYield() {
        return new Promise(resolve => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(() => resolve(), { timeout: 50 });
            } else {
                window.setTimeout(resolve, 0);
            }
        });
    }

    // Classifies one already-decoded image band against the template's
    // indices/mask, writing into the shared `states` buffer and accumulating
    // per-colour counts. `reality` is a Uint8ClampedArray (RGBA, top-row-first)
    // sized `width`, or null when the covering tile has not synced (=> UNKNOWN
    // for every sampled cell in the band, no getImageData needed at all).
    function gppScanProcessBand(template, core, paletteLookup, reality, width, bandHeight, localRowStart, localXStart, states, colourAgg, groupOfIndex) {
        const ERROR_STATE = core.constants.ERROR_STATE;
        const empty = core.emptyValue(template.indexType);
        for (let row = 0; row < bandHeight; row++) {
            const templateRow = localRowStart + row;
            let templateOffset = templateRow * template.width + localXStart;
            let realityOffset = row * width * 4;
            for (let column = 0; column < width; column++, templateOffset++, realityOffset += 4) {
                const expectedIndex = template.indices[templateOffset];
                if (expectedIndex === empty) continue; // transparent cell: stays UNCHECKED
                // Sampled regardless of template.mask — like the native ghost
                // tool's own progress bar, this is a statement on the whole
                // template, not just its currently-enabled colours (mask only
                // gates which colours draw error CROSSES/queue for placement,
                // see gpp-scan.js's other mask checks and gpp-palette.js).
                const state = reality
                    ? core.compareRealityPixel(
                        expectedIndex,
                        reality[realityOffset],
                        reality[realityOffset + 1],
                        reality[realityOffset + 2],
                        reality[realityOffset + 3],
                        paletteLookup,
                        true,
                        groupOfIndex
                    )
                    : ERROR_STATE.UNKNOWN;
                states[templateOffset] = state;
                const agg = colourAgg[expectedIndex];
                if (state === ERROR_STATE.CORRECT) agg.correct++;
                else if (state === ERROR_STATE.WRONG) agg.wrong++;
                else if (state === ERROR_STATE.MISSING) agg.missing++;
                else agg.unknown++;
            }
        }
    }

    // Full scan: crops and reads only the tile rectangles overlapping the
    // template's bounding box (never a full-template-sized canvas read, never
    // a per-pixel drawImage+getImageData call — one getImageData per
    // GPP_SCAN_BAND_HEIGHT-row band, then compareRealityPixel per cell in that
    // batch). A tile's colour bitmap is stored south-up (row 0 = the tile's
    // minimum grid Y), so each band is drawn through a vertical-flip transform
    // before reading, aligning it with the template's north-first row order.
    async function gppScanRunInternal(template) {
        const core = gppCreateCore();
        const ERROR_STATE = core.constants.ERROR_STATE;
        const grid = gppReadGridConstants();
        const tileSize = grid.tileSize;
        const bounds = core.computeGridBounds(template.position, template.width, template.height);
        if (!bounds) throw new Error('Template has no position.');

        const paletteLookup = new Map();
        template.palette.forEach((packed, index) => paletteLookup.set(packed, index));

        // Group Noise: lazily built once per (palette, groupNoise-on) and
        // cached on the template — a template's palette never changes after
        // construction (no in-place flip/rotate exists anymore), so this
        // cache needs no separate invalidation. null whenever groupNoise is
        // off, which keeps compareRealityPixel's new branch byte-identical
        // to before it existed (see gpp-core.js).
        if (template.groupNoise && !template.groupNoiseData) {
            template.groupNoiseData = core.groupPaletteColors(template.palette);
        }
        const groupOfIndex = (template.groupNoise && template.groupNoiseData) ? template.groupNoiseData.groupOfIndex : null;

        const states = new Uint8Array(template.width * template.height); // all UNCHECKED
        const colourAgg = new Array(template.palette.length);
        for (let index = 0; index < colourAgg.length; index++) colourAgg[index] = { correct: 0, wrong: 0, missing: 0, unknown: 0 };

        const firstX = Math.floor(bounds.left / tileSize) * tileSize;
        const lastX = Math.floor(bounds.right / tileSize) * tileSize;
        const firstY = Math.floor(bounds.bottom / tileSize) * tileSize;
        const lastY = Math.floor(bounds.top / tileSize) * tileSize;

        const scratch = document.createElement('canvas');
        const scratchCtx = scratch.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });

        for (let tileX = firstX; tileX <= lastX; tileX += tileSize) {
            for (let tileY = firstY; tileY <= lastY; tileY += tileSize) {
                const xMin = Math.max(bounds.left, tileX);
                const xMax = Math.min(bounds.right, tileX + tileSize - 1);
                const yMin = Math.max(bounds.bottom, tileY);
                const yMax = Math.min(bounds.top, tileY + tileSize - 1);
                if (xMin > xMax || yMin > yMax) continue; // this tile doesn't overlap the template

                const regionWidth = xMax - xMin + 1;
                const regionHeight = yMax - yMin + 1;
                const localXStart = xMin - bounds.left;

                const sourceBitmap = gppGetTileBitmap(tileX, tileY); // null => tile not synced yet
                let croppedBitmap = null;
                if (sourceBitmap) {
                    try {
                        croppedBitmap = await createImageBitmap(sourceBitmap, xMin - tileX, yMin - tileY, regionWidth, regionHeight);
                    } catch (_) {
                        croppedBitmap = null;
                    }
                }

                try {
                    for (let bandTop = yMax; bandTop >= yMin; bandTop -= GPP_SCAN_BAND_HEIGHT) {
                        const bandBottom = Math.max(yMin, bandTop - GPP_SCAN_BAND_HEIGHT + 1);
                        const bandHeight = bandTop - bandBottom + 1;
                        const localRowStart = bounds.top - bandTop;

                        let reality = null;
                        if (croppedBitmap) {
                            if (scratch.width !== regionWidth || scratch.height !== bandHeight) {
                                scratch.width = regionWidth;
                                scratch.height = bandHeight;
                            }
                            scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
                            scratchCtx.clearRect(0, 0, regionWidth, bandHeight);
                            scratchCtx.save();
                            scratchCtx.translate(0, bandHeight);
                            scratchCtx.scale(1, -1);
                            scratchCtx.drawImage(
                                croppedBitmap,
                                0, bandBottom - yMin, regionWidth, bandHeight,
                                0, 0, regionWidth, bandHeight
                            );
                            scratchCtx.restore();
                            reality = scratchCtx.getImageData(0, 0, regionWidth, bandHeight).data;
                        }

                        gppScanProcessBand(template, core, paletteLookup, reality, regionWidth, bandHeight, localRowStart, localXStart, states, colourAgg, groupOfIndex);
                        await gppScanYield();
                    }
                } finally {
                    if (croppedBitmap) croppedBitmap.close();
                }
            }
        }

        let total = 0, correct = 0, wrong = 0, missing = 0, unknown = 0;
        const perColour = [];
        for (let index = 0; index < template.palette.length; index++) {
            const count = template.counts[index] || 0;
            if (!count) continue;
            const enabled = core.maskHas(template.mask, index);
            const agg = colourAgg[index];
            perColour.push({ index, enabled, correct: agg.correct, wrong: agg.wrong, missing: agg.missing, unknown: agg.unknown, total: count });
            // Always counted toward the aggregate totals — mask no longer
            // gates this (see gppScanProcessBand's comment). `enabled` is
            // still recorded per-colour above for consumers that need it
            // (gpp-palette.js's sort/filter), just not used to exclude a
            // colour from the whole-template progress numbers here.
            total += count;
            correct += agg.correct;
            wrong += agg.wrong;
            missing += agg.missing;
            unknown += agg.unknown;
        }

        template.scanSummary = { scannedAt: new Date().toISOString(), total, correct, wrong, missing, unknown, perColour, states };
        return template.scanSummary;
    }

    // Public, guarded entry point — the only sanctioned way to start a scan.
    // Refuses to run a second scan concurrently (no cancel button exists, so
    // "busy" is a silent no-op rather than something the UI needs to surface
    // beyond disabling the button while gppScanRunning is true).
    async function gppScanTemplate(template) {
        if (!template || !template.position) return { ok: false, reason: 'not-positioned' };
        if (gppScanRunning) return { ok: false, reason: 'busy' };
        gppScanRunning = true;
        gppScanningTemplateId = template.id;
        try {
            await gppScanRunInternal(template);
            gppScanScheduleErrorRedraw();
            return { ok: true };
        } catch (error) {
            console.error('[GeoPixelcons++] Ghost++ scan failed:', error);
            return { ok: false, reason: 'error', error };
        } finally {
            gppScanRunning = false;
            gppScanningTemplateId = null;
        }
    }

    // Flies the map to the wrong/missing cell nearest the current map centre,
    // among currently-enabled colours. Grid<->world conversion mirrors
    // encodePositionHeader/computeGridBounds: gridX/gridY are pure grid
    // indices, offsetMetersX/Y are added only when converting to world meters
    // (and subtracted when converting the other way), kept symmetric here.
    async function gppFlyToNearestError(template) {
        if (!template || !template.position || !template.scanSummary) return { ok: false, reason: 'nothing-to-search' };
        const map = gppGetMap();
        const turf = gppGetTurf();
        if (!map || !turf) return { ok: false, reason: 'map-unavailable' };
        const core = gppCreateCore();
        const ERROR_STATE = core.constants.ERROR_STATE;
        const grid = gppReadGridConstants();
        const states = template.scanSummary.states;

        const center = map.getCenter();
        const mercator = turf.toMercator([center.lng, center.lat]);
        const centerX = (mercator[0] - grid.offsetMetersX) / grid.gridSize;
        const centerY = (mercator[1] - grid.offsetMetersY) / grid.gridSize;

        // Search whichever of wrong/missing is currently toggled visible; if
        // neither is (a scan just finished and the user hasn't opted into a
        // display yet), search both so the action is still useful.
        const searchWrong = template._gppShowWrong || !template._gppShowMissing;
        const searchMissing = template._gppShowMissing || !template._gppShowWrong;

        let nearest = null;
        let nearestDistance = Infinity;
        const chunk = 65536;
        for (let start = 0; start < states.length; start += chunk) {
            const end = Math.min(states.length, start + chunk);
            for (let pixel = start; pixel < end; pixel++) {
                const state = states[pixel];
                if (state === ERROR_STATE.WRONG && !searchWrong) continue;
                if (state === ERROR_STATE.MISSING && !searchMissing) continue;
                if (state !== ERROR_STATE.WRONG && state !== ERROR_STATE.MISSING) continue;
                const paletteIndex = template.indices[pixel];
                if (!core.maskHas(template.mask, paletteIndex)) continue; // respect current filter
                const localX = pixel % template.width;
                const localY = Math.floor(pixel / template.width);
                const gridX = template.position.gridX + localX;
                const gridY = template.position.gridY - localY;
                const dx = gridX - centerX;
                const dy = gridY - centerY;
                const distance = dx * dx + dy * dy;
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearest = { gridX, gridY };
                }
            }
            await gppScanYield();
        }

        if (!nearest) return { ok: false, reason: 'none-found' };
        const target = turf.toWgs84([
            nearest.gridX * grid.gridSize + grid.offsetMetersX,
            nearest.gridY * grid.gridSize + grid.offsetMetersY,
        ]);
        // Instant, not eased — same explicit product decision as the
        // template library's own teleport (gppLibraryFlyToTemplate): jump
        // straight there rather than flying/easing into it.
        map.jumpTo({ center: target, zoom: Math.max(map.getZoom(), 17) });
        // Pulses a highlight ring on the exact cell just teleported to, so
        // it's obvious at a glance which one needs correcting — independent
        // of the ambient error-cross display settings (see
        // gppScanStartNearestErrorGlow), since this is a direct response to
        // the button click, not the passive crosshair overlay.
        gppScanStartNearestErrorGlow(template.id, nearest.gridX, nearest.gridY);
        return { ok: true };
    }

    // Clearing the error DISPLAY is deliberately separate from discarding the
    // scan itself — template.scanSummary (the progress numbers) is untouched
    // here. Only the two session-only, non-persisted display toggles below
    // are reset. A fresh scan (gppScanTemplate) turns both back on.
    function gppClearTemplateErrors(template) {
        if (!template) return;
        template._gppShowWrong = false;
        template._gppShowMissing = false;
        gppScanScheduleErrorRedraw();
    }

    // ── Viewport-bounded error-marker overlay (Canvas2D) ───────────────
    // North-up, zero-pitch projection is assumed (the site disables rotation
    // and pitch), so the viewport is a simple axis-aligned grid rectangle.

    function gppScanComputeViewportGridBounds() {
        const map = gppGetMap();
        const turf = gppGetTurf();
        if (!map || !turf || typeof map.getBounds !== 'function') return null;
        const grid = gppReadGridConstants();
        const mapBounds = map.getBounds();
        const nw = mapBounds.getNorthWest();
        const se = mapBounds.getSouthEast();
        const nwMercator = turf.toMercator([nw.lng, nw.lat]);
        const seMercator = turf.toMercator([se.lng, se.lat]);
        return {
            left: Math.floor((nwMercator[0] - grid.offsetMetersX) / grid.gridSize) - 1,
            right: Math.ceil((seMercator[0] - grid.offsetMetersX) / grid.gridSize) + 1,
            bottom: Math.floor((seMercator[1] - grid.offsetMetersY) / grid.gridSize) - 1,
            top: Math.ceil((nwMercator[1] - grid.offsetMetersY) / grid.gridSize) + 1,
        };
    }

    let gppScanOverlayCanvas = null;
    let gppScanMapWired = false;
    let gppScanRedrawScheduled = false;

    // ── "Nearest error" target glow ─────────────────────────────────────
    // A short pulsing ring drawn over the exact cell gppFlyToNearestError
    // just teleported to — deliberately independent of gppSettings.showErrors
    // and the per-template showWrong/showMissing toggles (gppScanRedrawErrors
    // draws this before any of those gates), since it's a direct response to
    // the button click rather than the passive crosshair overlay.
    let gppNearestErrorGlow = null; // { templateId, gridX, gridY, startTime } | null
    let gppNearestErrorGlowRafId = 0;
    const GPP_NEAREST_ERROR_GLOW_DURATION_MS = 2200;
    const GPP_NEAREST_ERROR_GLOW_PULSE_MS = 650;

    function gppScanStartNearestErrorGlow(templateId, gridX, gridY) {
        gppNearestErrorGlow = { templateId, gridX, gridY, startTime: Date.now() };
        if (gppNearestErrorGlowRafId) return; // animation loop already running, will pick up the new target next frame
        const tick = () => {
            if (!gppNearestErrorGlow) { gppNearestErrorGlowRafId = 0; return; }
            const elapsed = Date.now() - gppNearestErrorGlow.startTime;
            if (elapsed >= GPP_NEAREST_ERROR_GLOW_DURATION_MS) {
                gppNearestErrorGlow = null;
                gppNearestErrorGlowRafId = 0;
                gppScanRedrawErrors(); // one last redraw so the ring actually disappears
                return;
            }
            gppScanRedrawErrors();
            gppNearestErrorGlowRafId = requestAnimationFrame(tick);
        };
        gppNearestErrorGlowRafId = requestAnimationFrame(tick);
    }

    // Parented inside the map's own container (not window/body) so
    // map.project()'s container-relative pixel coordinates line up with the
    // canvas's own pixel space without any extra offset bookkeeping, and so it
    // tracks the container's on-screen position/size for free via CSS.
    function gppScanEnsureOverlay() {
        const map = gppGetMap();
        if (!map || typeof map.getContainer !== 'function') return null;
        gppEnsureMapContainerContainsStacking(map);
        const host = map.getContainer();
        if (gppScanOverlayCanvas && gppScanOverlayCanvas.parentElement === host) return gppScanOverlayCanvas;
        if (gppScanOverlayCanvas && gppScanOverlayCanvas.parentElement) gppScanOverlayCanvas.remove();
        const canvas = document.createElement('canvas');
        canvas.id = 'gpp-scan-error-layer';
        canvas.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none; z-index:5;';
        host.appendChild(canvas);
        gppScanOverlayCanvas = canvas;
        return canvas;
    }

    function gppScanWireMapEvents() {
        if (gppScanMapWired) return;
        const map = gppGetMap();
        if (!map || typeof map.on !== 'function') return;
        map.on('move', gppScanScheduleErrorRedraw);
        map.on('zoom', gppScanScheduleErrorRedraw);
        map.on('resize', gppScanScheduleErrorRedraw);
        window.addEventListener('resize', gppScanScheduleErrorRedraw);
        gppScanMapWired = true;
    }

    // rAF-coalesced: any number of calls within one frame (map 'move' fires
    // continuously while panning) collapse into a single redraw.
    function gppScanScheduleErrorRedraw() {
        gppScanWireMapEvents();
        if (typeof gppRendererSchedule === 'function') {
            try { gppRendererSchedule(); } catch (_) { /* renderer's own concern */ }
        }
        if (gppScanRedrawScheduled) return;
        gppScanRedrawScheduled = true;
        requestAnimationFrame(() => {
            gppScanRedrawScheduled = false;
            gppScanRedrawErrors();
        });
    }

    function gppScanRedrawErrors() {
        const canvas = gppScanEnsureOverlay();
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const wantWidth = Math.max(1, Math.round(rect.width * dpr));
        const wantHeight = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== wantWidth || canvas.height !== wantHeight) {
            canvas.width = wantWidth;
            canvas.height = wantHeight;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const template = (typeof gppState !== 'undefined') ? gppState.getFocusedTemplate() : null;
        const map = gppGetMap();
        const turf = gppGetTurf();

        // "Nearest error" target glow — deliberately independent of
        // gppSettings.showErrors/showWrong/showMissing below (a direct
        // response to the button click, not the passive crosshair overlay).
        // Only gated on the glow's own template still being focused and
        // visible, not on the crosshair display settings.
        if (gppNearestErrorGlow && template && template.id === gppNearestErrorGlow.templateId && template.opacity > 0 && map && turf) {
            const grid = gppReadGridConstants();
            const elapsed = Date.now() - gppNearestErrorGlow.startTime;
            try {
                const world = turf.toWgs84([
                    gppNearestErrorGlow.gridX * grid.gridSize + grid.offsetMetersX,
                    gppNearestErrorGlow.gridY * grid.gridSize + grid.offsetMetersY,
                ]);
                const screen = map.project(world);
                if (Number.isFinite(screen.x) && Number.isFinite(screen.y)) {
                    const fadeOut = Math.max(0, 1 - elapsed / GPP_NEAREST_ERROR_GLOW_DURATION_MS);
                    const pulsePhase = (elapsed % GPP_NEAREST_ERROR_GLOW_PULSE_MS) / GPP_NEAREST_ERROR_GLOW_PULSE_MS;
                    const ringRadius = 6 + pulsePhase * 14;
                    ctx.globalAlpha = (1 - pulsePhase) * fadeOut;
                    ctx.strokeStyle = '#fbbf24';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(screen.x, screen.y, ringRadius, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
            } catch (_) { /* map/turf not ready this frame — try again next tick */ }
        }

        if (!gppSettings.showErrors) return; // master switch — see gpp-scan.js's Error Settings section
        const showWrong = !!(template && template._gppShowWrong);
        const showMissing = !!(template && template._gppShowMissing);
        if (!template || template.opacity <= 0 || !template.position || !template.scanSummary) return;
        if (!showWrong && !showMissing) return; // nothing toggled on — Clear leaves scanSummary intact but stops here
        if (!map || !turf) return;

        const core = gppCreateCore();
        const ERROR_STATE = core.constants.ERROR_STATE;
        const empty = core.emptyValue(template.indexType);
        const grid = gppReadGridConstants();
        const bounds = core.computeGridBounds(template.position, template.width, template.height);
        const viewport = gppScanComputeViewportGridBounds();
        if (!bounds || !viewport) return;

        const left = Math.max(bounds.left, viewport.left);
        const right = Math.min(bounds.right, viewport.right);
        const bottom = Math.max(bounds.bottom, viewport.bottom);
        const top = Math.min(bounds.top, viewport.top);
        if (left > right || bottom > top) return; // template isn't on screen at all

        // Extreme-zoom-out guard: bail rather than iterate a huge cell grid.
        if ((right - left + 1) * (top - bottom + 1) > 400000) return;

        // Affine grid->screen transform, computed ONCE from 3 projected
        // reference points (origin + one step along each grid axis) instead
        // of calling turf.toWgs84()+map.project() per cell inside the loop
        // below — those do real trig work (Mercator inverse projection,
        // etc.), and doing it per error cell was the actual "atrocious
        // performance with thousands of errors" bottleneck: thousands of
        // trig-heavy calls, every single animation frame while panning.
        // North-up/zero-pitch is already assumed elsewhere in this file (see
        // gppScanComputeViewportGridBounds), so grid->screen is a plain
        // linear map — this mirrors gpp-renderer.js's own
        // gppRendererProjectTemplate, which uses the identical technique for
        // the per-cell dot overlay.
        const originWorld = turf.toWgs84([left * grid.gridSize + grid.offsetMetersX, top * grid.gridSize + grid.offsetMetersY]);
        const stepXWorld = turf.toWgs84([(left + 1) * grid.gridSize + grid.offsetMetersX, top * grid.gridSize + grid.offsetMetersY]);
        const stepYWorld = turf.toWgs84([left * grid.gridSize + grid.offsetMetersX, (top - 1) * grid.gridSize + grid.offsetMetersY]);
        const originPx = map.project(originWorld);
        const stepXPx = map.project(stepXWorld);
        const stepYPx = map.project(stepYWorld);
        const stepXdx = stepXPx.x - originPx.x;
        const stepXdy = stepXPx.y - originPx.y;
        const stepYdx = stepYPx.x - originPx.x;
        const stepYdy = stepYPx.y - originPx.y;
        const cellPx = Math.abs(stepXdx);
        if (!(cellPx >= 2)) return;

        const settings = gppState.settings || {};
        const shape = settings.errorShape || 'x';
        const opacity = Number.isFinite(settings.errorOpacity) ? settings.errorOpacity : 1;
        if (opacity <= 0) return;
        const sizeScale = Number.isFinite(settings.errorSizeScale) ? settings.errorSizeScale : 1;
        const half = Math.max(1.5, cellPx * 0.32 * sizeScale);

        const states = template.scanSummary.states;

        // One bulk read of the native queue rather than one page-realm call
        // per on-screen cell (see gpp-bridge.js's gppReadQueuedPixelKeys).
        // Only fetched when the setting is on — an empty Set is a no-op skip
        // check below, so this stays free when the feature isn't in use.
        const queuedKeys = gppSettings.hideQueuedCrosses !== false
            ? new Set(gppReadQueuedPixelKeys())
            : null;

        // Collect screen positions first, then draw each shape type as ONE
        // batched path (single beginPath/stroke or fill call) instead of one
        // stroke() per marker — this is the actual performance win when a
        // scan surfaces thousands of markers; per-call canvas overhead, not
        // the cell-iteration itself, was the bottleneck.
        const points = [];
        for (let gridY = top; gridY >= bottom; gridY--) {
            const localY = template.position.gridY - gridY;
            if (localY < 0 || localY >= template.height) continue;
            const dGridY = top - gridY;
            for (let gridX = left; gridX <= right; gridX++) {
                const localX = gridX - template.position.gridX;
                if (localX < 0 || localX >= template.width) continue;
                const pixel = localY * template.width + localX;
                const expectedIndex = template.indices[pixel];
                if (expectedIndex === empty) continue;
                if (!core.maskHas(template.mask, expectedIndex)) continue; // respect current filter
                const state = states[pixel];
                if (state === ERROR_STATE.WRONG && !showWrong) continue;
                if (state === ERROR_STATE.MISSING && !showMissing) continue;
                if (state !== ERROR_STATE.WRONG && state !== ERROR_STATE.MISSING) continue;
                if (queuedKeys && queuedKeys.has(gridX + ',' + gridY)) continue; // already queued — see Hide queued crosshairs
                const dGridX = gridX - left;
                points.push(originPx.x + dGridX * stepXdx + dGridY * stepYdx, originPx.y + dGridX * stepXdy + dGridY * stepYdy);
            }
        }
        if (!points.length) return;

        ctx.globalAlpha = opacity;
        ctx.strokeStyle = settings.errorColor || '#dc2626';
        ctx.fillStyle = settings.errorColor || '#dc2626';
        ctx.lineWidth = Math.max(1, Math.min(2, cellPx / 4));

        if (shape === 'circle') {
            ctx.beginPath();
            for (let i = 0; i < points.length; i += 2) {
                ctx.moveTo(points[i] + half, points[i + 1]);
                ctx.arc(points[i], points[i + 1], half, 0, Math.PI * 2);
            }
            ctx.fill();
        } else if (shape === 'square') {
            ctx.beginPath();
            for (let i = 0; i < points.length; i += 2) {
                ctx.rect(points[i] - half, points[i + 1] - half, half * 2, half * 2);
            }
            ctx.fill();
        } else { // 'x'
            ctx.beginPath();
            for (let i = 0; i < points.length; i += 2) {
                ctx.moveTo(points[i] - half, points[i + 1] - half);
                ctx.lineTo(points[i] + half, points[i + 1] + half);
                ctx.moveTo(points[i] + half, points[i + 1] - half);
                ctx.lineTo(points[i] - half, points[i + 1] + half);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    function gppScanFormatRelativeTime(iso) {
        if (!iso) return '';
        const then = new Date(iso).getTime();
        if (!Number.isFinite(then)) return '';
        const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
        if (seconds < 5) return 'just now';
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return new Date(iso).toLocaleDateString();
    }

    function gppScanStyleButton(button, primary) {
        button.style.cssText =
            'font:inherit; padding:3px 8px; border-radius:5px; cursor:pointer;' +
            'border:1px solid ' + t2('#cbd5e1', '#45475a') + ';' +
            'background:' + (primary ? t2('#2563eb', '#89b4fa') : t2('#ffffff', '#313244')) + ';' +
            'color:' + (primary ? t2('#ffffff', '#1e1e2e') : t2('#111827', '#f5f5f5')) + ';' +
            (button.disabled ? 'opacity:.5; cursor:default;' : '');
    }

    // Sums scanSummary.perColour[i].wrong/missing only for palette indices
    // CURRENTLY enabled in template.mask (the live mask, not each entry's own
    // possibly-stale `enabled` snapshot from scan time) — matching exactly
    // what gppScanRedrawErrors draws on the map right now.
    function gppScanCountEnabledErrors(template, kind) {
        const summary = template.scanSummary;
        if (!summary || !Array.isArray(summary.perColour)) return 0;
        const core = gppCreateCore();
        let count = 0;
        summary.perColour.forEach(entry => {
            if (core.maskHas(template.mask, entry.index)) count += entry[kind] || 0;
        });
        return count;
    }

    // Restores the native ghost tool's "how many crosses did that just place"
    // alert (see js/ghost22.js's findPlacedErrors()/findMissingErrors(), which
    // call the page's own showAlert()) for Ghost++'s own Show errors/Show
    // missing toggles, filtered to the currently-enabled colours only.
    function gppScanAlertEnabledCount(template, kind) {
        const target = gppNativeBridgeTarget();
        if (typeof target.showAlert !== 'function') return;
        const count = gppScanCountEnabledErrors(template, kind);
        const noun = kind === 'wrong' ? 'error' : 'missing pixel';
        if (count === 0) {
            target.showAlert('Success', (kind === 'wrong' ? 'Perfect match! No errors' : 'No missing pixels') + ' found among your currently enabled colors.');
        } else {
            target.showAlert('Info', 'Found ' + count.toLocaleString() + ' ' + noun + (count === 1 ? '' : 's') + ' among your currently enabled colors.');
        }
    }

    // ── gpp-init.js render-function contract ───────────────────────────
    // container id: 'gpp-progress-section'. `template` may be null.
    function gppRenderProgressBar(container, template, onChange) {
        if (!container) return;
        gppScanScheduleErrorRedraw(); // keep on-map markers in sync with the focused template on every UI refresh

        // Same wasOpen-preservation pattern as every other gpp-init.js
        // section's <details> — read before the wipe, restore after.
        const previousDetails = container.querySelector('details.gpp-collapsible');
        const wasOpen = previousDetails ? previousDetails.open : true;
        container.innerHTML = '';

        const details = document.createElement('details');
        details.className = 'gpp-collapsible';
        details.open = wasOpen;
        const summary = document.createElement('summary');
        summary.textContent = 'Progress';
        details.appendChild(summary);

        const wrap = document.createElement('div');
        wrap.className = 'gpp-body';
        details.appendChild(wrap);

        // Left-justified — the <summary> above already shows "Progress",
        // so no title/spacer is needed to push these to the right.
        const headRow = document.createElement('div');
        headRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:6px; flex-wrap:wrap; justify-content:flex-start;';

        const scanBusy = gppScanIsBusyFor(template);

        const scanBtn = document.createElement('button');
        scanBtn.type = 'button';
        scanBtn.textContent = scanBusy ? 'Scanning…' : 'Scan progress';
        scanBtn.disabled = !template || !template.position || scanBusy;
        scanBtn.title = !template ? '' : (!template.position ? 'Place the template on the map first.' : 'Compare this template against the live map.');
        gppScanStyleButton(scanBtn, true);
        headRow.appendChild(scanBtn);

        // Scanning only computes progress numbers. Error/missing MARKERS are
        // a separate, explicit opt-in the user can turn on afterward — two
        // independent toggles (matching the native ghost menu's own wrong-
        // vs-missing distinction), not bundled into the scan action itself.
        const showErrBtn = document.createElement('button');
        showErrBtn.type = 'button';
        const wrongOn = !!(template && template._gppShowWrong);
        showErrBtn.textContent = wrongOn ? 'Hide errors' : 'Show errors';
        showErrBtn.disabled = !template || !template.scanSummary || scanBusy;
        showErrBtn.title = 'Mark cells painted the wrong color.';
        gppScanStyleButton(showErrBtn, wrongOn);
        headRow.appendChild(showErrBtn);

        const showMissBtn = document.createElement('button');
        showMissBtn.type = 'button';
        const missingOn = !!(template && template._gppShowMissing);
        showMissBtn.textContent = missingOn ? 'Hide missing' : 'Show missing';
        showMissBtn.disabled = !template || !template.scanSummary || scanBusy;
        showMissBtn.title = 'Mark cells that are not painted at all yet.';
        gppScanStyleButton(showMissBtn, missingOn);
        headRow.appendChild(showMissBtn);

        const nearestBtn = document.createElement('button');
        nearestBtn.type = 'button';
        nearestBtn.textContent = 'Nearest error';
        nearestBtn.disabled = !template || !template.scanSummary || scanBusy;
        gppScanStyleButton(nearestBtn, false);
        headRow.appendChild(nearestBtn);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';
        clearBtn.title = 'Hide error/missing markers. Does not discard the scan — progress above stays.';
        clearBtn.disabled = !template || (!template._gppShowWrong && !template._gppShowMissing) || scanBusy;
        gppScanStyleButton(clearBtn, false);
        headRow.appendChild(clearBtn);

        wrap.appendChild(headRow);

        const autoscanRow = document.createElement('label');
        autoscanRow.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:11px; margin:0 0 6px; cursor:pointer; color:' + t2('#1f2937', '#e2e2f5') + ';';
        const autoscanCheckbox = document.createElement('input');
        autoscanCheckbox.type = 'checkbox';
        autoscanCheckbox.checked = !!gppSettings.autoscanEnabled;
        autoscanCheckbox.addEventListener('change', () => {
            gppSettings.autoscanEnabled = autoscanCheckbox.checked;
            gppState.saveSettings();
        });
        autoscanRow.title = 'Automatically re-scans the focused template shortly after you place pixels';
        autoscanRow.append(autoscanCheckbox, document.createTextNode('Autoscan'));
        wrap.appendChild(autoscanRow);

        const barOuter = document.createElement('div');
        barOuter.style.cssText = 'display:flex; height:10px; border-radius:5px; overflow:hidden; background:' + t2('#e5e7eb', '#313244') + ';';
        wrap.appendChild(barOuter);

        const summaryLine = document.createElement('div');
        summaryLine.style.cssText = 'font-size:11px; margin-top:4px; color:' + t2('#475569', '#a6adc8') + ';';
        wrap.appendChild(summaryLine);

        if (!template) {
            barOuter.style.opacity = '0.4';
            summaryLine.textContent = 'Select or import a template.';
        } else if (!template.position) {
            barOuter.style.opacity = '0.4';
            summaryLine.textContent = 'Place the template on the map, then scan to see progress.';
        } else if (!template.scanSummary) {
            const neutral = document.createElement('div');
            neutral.style.cssText = 'width:100%; background:' + t2('#cbd5e1', '#45475a') + ';';
            neutral.title = 'Not scanned yet';
            barOuter.appendChild(neutral);
            summaryLine.textContent = 'Not scanned yet.';
        } else {
            // A statement on the WHOLE template, like the native ghost tool's
            // own progress bar — not filtered by which colours are currently
            // enabled (see gppScanRunInternal's aggregation). Read straight
            // off scanSummary rather than recomputing against the current
            // mask, since scanSummary itself is no longer mask-dependent.
            const summary = template.scanSummary;
            const total = summary.total;
            const notPlaced = Math.max(0, total - summary.correct - summary.wrong);
            const unscanned = Math.max(0, notPlaced - summary.missing - summary.unknown);
            const pct = value => (total > 0 ? (value / total) * 100 : 0);

            if (total <= 0) {
                const neutral = document.createElement('div');
                neutral.style.cssText = 'width:100%; background:' + t2('#cbd5e1', '#45475a') + ';';
                neutral.title = 'Template has no opaque pixels';
                barOuter.appendChild(neutral);
                summaryLine.textContent = 'Template has no opaque pixels — nothing to show.';
            } else {
                const correctSeg = document.createElement('div');
                correctSeg.style.cssText = `width:${pct(summary.correct)}%; background:${t2('#16a34a', '#a6e3a1')};`;
                correctSeg.title = `Correct: ${summary.correct.toLocaleString()} px`;
                barOuter.appendChild(correctSeg);

                const wrongSeg = document.createElement('div');
                wrongSeg.style.cssText = `width:${pct(summary.wrong)}%; background:${t2('#dc2626', '#f38ba8')};`;
                wrongSeg.title = `Wrong color: ${summary.wrong.toLocaleString()} px`;
                barOuter.appendChild(wrongSeg);

                const notPlacedSeg = document.createElement('div');
                notPlacedSeg.style.cssText = `width:${pct(notPlaced)}%; background:${t2('#94a3b8', '#6c7086')};`;
                notPlacedSeg.title = `Not yet placed: ${notPlaced.toLocaleString()} px`
                    + ` (missing: ${summary.missing.toLocaleString()}, tile not loaded: ${summary.unknown.toLocaleString()}`
                    + (unscanned ? `, not yet scanned: ${unscanned.toLocaleString()}` : '') + ')';
                barOuter.appendChild(notPlacedSeg);

                const donePct = Math.round(pct(summary.correct));
                summaryLine.textContent = `${summary.correct.toLocaleString()} completed of ${total.toLocaleString()} total (${donePct}%)`
                    + (summary.scannedAt ? ` — scanned ${gppScanFormatRelativeTime(summary.scannedAt)}` : '');

                // Always shown whenever there's something to report — no
                // longer gated on the per-template Show errors/Show missing
                // toggles (those now only control the on-map crosshairs,
                // via gppScanRedrawErrors, same as always). Whole-template
                // counts (summary.wrong/summary.missing directly), matching
                // the "X completed of Y total" statement immediately above,
                // not the mask-filtered currently-enabled-colours-only
                // counts the map's own crosshair drawing uses — an
                // always-visible summary staying stable regardless of which
                // colours you happen to have toggled on is less confusing
                // than one that changes complexion with the palette.
                if (summary.wrong > 0 || summary.missing > 0) {
                    const parts = [];
                    if (summary.wrong > 0) parts.push(`${summary.wrong.toLocaleString()} error${summary.wrong === 1 ? '' : 's'}`);
                    if (summary.missing > 0) parts.push(`${summary.missing.toLocaleString()} missing`);
                    const countsLine = document.createElement('div');
                    countsLine.style.cssText = 'font-size:11px; margin-top:2px; color:' + t2('#475569', '#a6adc8') + ';';
                    countsLine.textContent = parts.join(', ')
                        + ((summary.wrong > 0 && summary.missing > 0) ? ` (${(summary.wrong + summary.missing).toLocaleString()} combined)` : '');
                    wrap.appendChild(countsLine);
                }
            }
        }

        container.appendChild(details);

        scanBtn.addEventListener('click', () => {
            if (gppScanRunning || !template || !template.position) return;
            const pending = gppScanTemplate(template); // sets gppScanRunning synchronously before its first await
            onChange();
            pending.then(() => onChange());
        });
        showErrBtn.addEventListener('click', () => {
            if (!template || !template.scanSummary) return;
            template._gppShowWrong = !template._gppShowWrong;
            if (template._gppShowWrong) gppScanAlertEnabledCount(template, 'wrong');
            gppScanScheduleErrorRedraw();
            onChange();
        });
        showMissBtn.addEventListener('click', () => {
            if (!template || !template.scanSummary) return;
            template._gppShowMissing = !template._gppShowMissing;
            if (template._gppShowMissing) gppScanAlertEnabledCount(template, 'missing');
            gppScanScheduleErrorRedraw();
            onChange();
        });
        nearestBtn.addEventListener('click', () => {
            if (!template || !template.scanSummary) return;
            gppFlyToNearestError(template);
        });
        clearBtn.addEventListener('click', () => {
            if (!template) return;
            gppClearTemplateErrors(template);
            onChange();
        });
    }

    // ── gpp-init.js render-function contract ───────────────────────────
    // container id: 'gpp-error-settings-section'. Global (applies to every
    // template's error-marker rendering — see gppScanRedrawErrors above,
    // which reads gppSettings.errorShape/errorColor/errorOpacity/errorSizeScale
    // fresh on every redraw), so `template` is accepted for signature
    // consistency with the other render hooks but unused.
    function gppRenderErrorSettings(container) {
        if (!container) return;
        const previous = container.querySelector('details.gpp-collapsible');
        const wasOpen = previous ? previous.open : false;
        container.innerHTML = '';

        const details = document.createElement('details');
        details.className = 'gpp-collapsible';
        details.open = wasOpen;
        const summary = document.createElement('summary');
        summary.textContent = 'Error Settings';
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'gpp-body';

        // Matches this codebase's existing reset-icon convention (see
        // hide-paint-menu.js / ghost-template-manager.js's own '↺' buttons).
        function addResetButton(rowEl, title, onClick) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerHTML = '↺';
            btn.title = title;
            btn.style.cssText = 'border:none; background:transparent; cursor:pointer; font-size:13px; padding:0 2px; flex-shrink:0; color:' + t2('#64748b', '#a6adc8') + ';';
            btn.addEventListener('click', onClick);
            rowEl.appendChild(btn);
        }

        function row(labelText) {
            const r = document.createElement('div');
            r.style.cssText = 'display:flex; align-items:center; gap:8px; margin:6px 0;';
            const label = document.createElement('label');
            label.style.cssText = 'flex:0 0 auto; min-width:70px; font-size:12px; color:' + t2('#1f2937', '#e2e2f5') + ';';
            label.textContent = labelText;
            r.appendChild(label);
            body.appendChild(r);
            return r;
        }

        // Master switch — moved here (was in View Settings' template
        // subsection) so it lives alongside the settings it actually gates.
        // gppScanRedrawErrors() reads gppSettings.showErrors directly, so
        // unchecking this hides every error/missing marker on the map
        // regardless of any individual template's own Show errors/Show
        // missing toggle state — the rows below only affect HOW markers
        // look, so they're dimmed and disabled while this is off.
        const showErrorsRow = document.createElement('div');
        showErrorsRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin:6px 0;';
        const showErrorsLabel = document.createElement('label');
        showErrorsLabel.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer; color:' + t2('#1f2937', '#e2e2f5') + ';';
        const showErrorsInput = document.createElement('input');
        showErrorsInput.type = 'checkbox';
        showErrorsInput.checked = !!gppSettings.showErrors;
        const showErrorsText = document.createElement('span');
        showErrorsText.textContent = 'Show error crosses';
        showErrorsLabel.append(showErrorsInput, showErrorsText);
        showErrorsRow.appendChild(showErrorsLabel);
        // hoverElement=showErrorsText (text only, not the checkbox --
        // explicit user feedback), focusElement=showErrorsInput.
        if (typeof gppAttachTooltip === 'function') gppAttachTooltip(showErrorsText, 'Master switch for the wrong/missing-pixel markers on the map. Turning this off hides every marker regardless of any per-template Show errors/Show missing setting; the controls below only change how markers look while this is on.', showErrorsInput);

        // To the right of Show error crosses. Defaults on: once a pixel is
        // queued (native queuedPixels — see gpp-bridge.js's
        // gppReadQueuedPixelKeys), its crosshair stops drawing even before it
        // actually paints on the map, so the crosshairs left on screen are
        // exactly the ones still needing to be queued.
        const hideQueuedLabel = document.createElement('label');
        hideQueuedLabel.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer; margin-left:14px; color:' + t2('#1f2937', '#e2e2f5') + ';';
        const hideQueuedInput = document.createElement('input');
        hideQueuedInput.type = 'checkbox';
        hideQueuedInput.checked = gppSettings.hideQueuedCrosses !== false;
        const hideQueuedText = document.createElement('span');
        hideQueuedText.textContent = 'Hide queued crosshairs';
        hideQueuedLabel.append(hideQueuedInput, hideQueuedText);
        showErrorsRow.appendChild(hideQueuedLabel);
        // hoverElement=hideQueuedText (text only, not the checkbox --
        // explicit user feedback), focusElement=hideQueuedInput.
        if (typeof gppAttachTooltip === 'function') gppAttachTooltip(hideQueuedText, 'Stop showing a crosshair once you\'ve queued a pixel over it, even before it actually paints — only the crosshairs you still need to queue stay visible.', hideQueuedInput);
        hideQueuedInput.addEventListener('change', () => {
            gppSettings.hideQueuedCrosses = hideQueuedInput.checked;
            gppState.saveSettings();
            gppScanScheduleErrorRedraw();
        });

        body.appendChild(showErrorsRow);

        function applyShowErrorsGate() {
            const on = showErrorsInput.checked;
            [shapeSelect, colorInput, opacityInput, sizeInput].forEach(el => { el.disabled = !on; });
            [shapeRow, colorRow, opacityRow, sizeRow].forEach(r => { r.style.opacity = on ? '' : '.45'; });
        }
        showErrorsInput.addEventListener('change', () => {
            gppSettings.showErrors = showErrorsInput.checked;
            gppState.saveSettings();
            applyShowErrorsGate();
            gppScanScheduleErrorRedraw();
        });

        const shapeRow = row('Shape');
        const shapeSelect = document.createElement('select');
        ['x', 'circle', 'square'].forEach(value => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value === 'x' ? 'X mark' : (value === 'circle' ? 'Circle' : 'Square');
            if ((gppSettings.errorShape || 'x') === value) opt.selected = true;
            shapeSelect.appendChild(opt);
        });
        shapeSelect.addEventListener('change', () => {
            gppSettings.errorShape = shapeSelect.value;
            gppState.saveSettings();
            gppScanScheduleErrorRedraw();
        });
        shapeRow.appendChild(shapeSelect);

        const colorRow = row('Color');
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = gppSettings.errorColor || '#dc2626';
        colorInput.addEventListener('input', () => {
            gppSettings.errorColor = colorInput.value;
            gppState.saveSettings();
            gppScanScheduleErrorRedraw();
        });
        colorRow.appendChild(colorInput);
        addResetButton(colorRow, 'Reset to default color', () => {
            colorInput.value = '#dc2626';
            gppSettings.errorColor = '#dc2626';
            gppState.saveSettings();
            gppScanScheduleErrorRedraw();
        });

        const opacityRow = row('Opacity');
        const opacityInput = document.createElement('input');
        opacityInput.type = 'range';
        opacityInput.min = '0'; opacityInput.max = '100'; opacityInput.step = '1';
        opacityInput.value = String(Math.round((Number.isFinite(gppSettings.errorOpacity) ? gppSettings.errorOpacity : 1) * 100));
        opacityInput.style.flex = '1';
        const opacityValue = document.createElement('span');
        opacityValue.style.cssText = 'font-size:11px; min-width:32px; text-align:right;';
        opacityValue.textContent = opacityInput.value + '%';
        opacityInput.addEventListener('input', () => {
            opacityValue.textContent = opacityInput.value + '%';
            gppSettings.errorOpacity = Number(opacityInput.value) / 100;
            gppState.saveSettings();
            gppScanScheduleErrorRedraw();
        });
        opacityRow.append(opacityInput, opacityValue);
        addResetButton(opacityRow, 'Reset to default opacity', () => {
            opacityInput.value = '100';
            opacityValue.textContent = '100%';
            gppSettings.errorOpacity = 1;
            gppState.saveSettings();
            gppScanScheduleErrorRedraw();
        });

        const sizeRow = row('Size');
        const sizeInput = document.createElement('input');
        sizeInput.type = 'range';
        sizeInput.min = '25'; sizeInput.max = '250'; sizeInput.step = '5';
        sizeInput.value = String(Math.round((Number.isFinite(gppSettings.errorSizeScale) ? gppSettings.errorSizeScale : 1) * 100));
        sizeInput.style.flex = '1';
        const sizeValue = document.createElement('span');
        sizeValue.style.cssText = 'font-size:11px; min-width:32px; text-align:right;';
        sizeValue.textContent = sizeInput.value + '%';
        sizeInput.addEventListener('input', () => {
            sizeValue.textContent = sizeInput.value + '%';
            gppSettings.errorSizeScale = Number(sizeInput.value) / 100;
            gppState.saveSettings();
            gppScanScheduleErrorRedraw();
        });
        sizeRow.append(sizeInput, sizeValue);
        addResetButton(sizeRow, 'Reset to default size', () => {
            sizeInput.value = '100';
            sizeValue.textContent = '100%';
            gppSettings.errorSizeScale = 1;
            gppState.saveSettings();
            gppScanScheduleErrorRedraw();
        });

        applyShowErrorsGate();

        details.appendChild(body);
        container.appendChild(details);
    }
