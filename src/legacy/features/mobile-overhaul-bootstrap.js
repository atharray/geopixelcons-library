
    // ============================================================
    //  FEATURE: Mobile System Overhaul [mobileOverhaul]
    // ============================================================
    // The presentation layer is supplied by the tagged external @require.
    // It runs outside this private IIFE, so every capability crosses one
    // explicit adapter instead of exposing gppState or other internals on
    // window. Evaluation of the external bundle is side-effect-free; all DOM
    // work begins only after this bootstrap calls its initializer.

    // `var` is deliberate: gpcMobileOverhaulAvailable() is defined in core.js
    // and called by earlier feature modules before execution reaches this
    // source file. Hoisting gives those gates a safe initial `undefined`
    // phase instead of putting the later binding in a temporal dead zone.
    var gppMobileOverhaulPhase = 'idle';
    let gppMobileOverhaulController = null;
    let gppMobileOverhaulPendingOpen = false;
    let gppMobileColorListenerInstalled = false;
    let gppMobilePaintSuccessHookInstalled = false;
    let gppMobileColorListener = null;
    let gppMobilePaintFetchTarget = null;
    let gppMobilePaintOriginalFetch = null;
    let gppMobilePaintWrappedFetch = null;
    let gppMobileLateHookRetryTimer = null;
    let gppMobilePlacementActive = false;

    function gppMobileOverhaulEnsureOpen() {
        if (gppMobileOverhaulController && typeof gppMobileOverhaulController.openPanel === 'function') {
            gppMobileOverhaulController.openPanel();
        } else {
            gppMobileOverhaulPendingOpen = true;
        }
    }

    function gppMobileOverhaulTogglePanel() {
        if (gppMobileOverhaulController && typeof gppMobileOverhaulController.togglePanel === 'function') {
            gppMobileOverhaulController.togglePanel();
        } else {
            gppMobileOverhaulPendingOpen = true;
        }
    }

    function gppMobilePostlude() {
        if (typeof gppShimSyncFocusedTemplate === 'function') gppShimSyncFocusedTemplate();
        if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
        if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
    }

    function gppMobileFindTemplate(id) {
        if (!id) return null;
        return gppState.templates.find(template => template.id === id)
            || gppState.guildTemplates.find(template => template.id === id)
            || null;
    }

    function gppMobileNormalizeHex(value) {
        const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(value || '').trim());
        if (!match || (match[2] && match[2].toUpperCase() !== 'FF')) return null;
        return '#' + match[1].toUpperCase();
    }

    function gppMobileMaskIsNarrow(template) {
        if (!template || !template.palette) return true;
        const core = gppCreateCore();
        let count = 0;
        for (let index = 0; index < template.palette.length; index += 1) {
            if (core.maskHas(template.mask, index)) {
                count += 1;
                if (count > 1) return false;
            }
        }
        return true;
    }

    function gppMobileFindPaletteIndexByColor(template, value) {
        const hex = gppMobileNormalizeHex(value);
        if (!template || !hex || !template.palette) return -1;
        const core = gppCreateCore();
        for (let index = 0; index < template.palette.length; index += 1) {
            if (core.packedToHex(template.palette[index]) === hex) return index;
        }
        return -1;
    }

    function gppMobileReadPaletteRows(template) {
        if (!template || !template.palette) return [];
        const core = gppCreateCore();
        const ownedRows = gppReadGamePalette();
        const ownedByHex = new Map();
        ownedRows.forEach(row => {
            const hex = gppMobileNormalizeHex(row.hex);
            if (hex) ownedByHex.set(hex, row);
        });
        const colourLookup = gppPaletteBuildColourLookup(template);
        return Array.from(template.palette, (packed, index) => {
            const hex = core.packedToHex(packed);
            const gameRow = ownedByHex.get(hex);
            const stats = gppPaletteStats(template, index, colourLookup);
            return Object.freeze({
                index,
                hex,
                packed,
                owned: !!gameRow,
                activeInGame: !!(gameRow && gameRow.active),
                selected: core.maskHas(template.mask, index),
                total: stats.total,
                completed: stats.completed,
                remaining: stats.remaining,
                remainingPercent: stats.remainingPercent,
            });
        });
    }

    async function gppMobileSelectColor(index, options) {
        const template = gppState.getFocusedTemplate();
        if (!template || !Number.isInteger(index) || index < 0 || index >= template.palette.length) {
            return { selected: false, owned: false, reason: 'invalid-color' };
        }
        const core = gppCreateCore();
        // While "Show all colors" is on, selecting a swatch only changes
        // the active native paint color -- template.mask must stay wide so
        // the renderer keeps showing the whole project as a guide. narrowMask
        // defaults to true (today's single-active-color behavior).
        const shouldNarrowMask = !options || options.narrowMask !== false;
        if (shouldNarrowMask) {
            template.mask = core.maskOnly(template.palette.length, index);
        } else if (!core.maskHas(template.mask, index)) {
            // Defensive: the color being actively painted must always be
            // selectable even if the mask was somehow narrower than expected.
            core.maskSet(template.mask, index, true);
        }
        await gppState.persistTemplateState(template);

        const hex = core.packedToHex(template.palette[index]);
        const gameRow = gppReadGamePalette().find(row => gppMobileNormalizeHex(row.hex) === hex);
        const shouldChangeNative = !options || options.changeNative !== false;
        if (gameRow && shouldChangeNative) {
            const nativeHex = String(gameRow.hex);
            gppRunInPageRealm(
                'var mobileHex=' + JSON.stringify(nativeHex) + ';' +
                'var mobileIndex=(typeof Colors!=="undefined"&&Array.isArray(Colors))?Colors.indexOf(mobileHex):-1;' +
                'if(mobileIndex>=0){' +
                'if(typeof activeColors!=="undefined"&&Array.isArray(activeColors)&&activeColors.indexOf(mobileIndex)===-1){activeColors.push(mobileIndex);if(typeof SetColors==="function")SetColors();}' +
                'if(typeof changeColor==="function")changeColor(mobileHex);' +
                '}'
            );
        }
        gppMobilePostlude();
        return { selected: true, owned: !!gameRow, hex, index };
    }

    // "Show all colors" directly controls what the renderer draws: on
    // widens template.mask to every palette color (the whole project shows
    // as a guide); off narrows it back to a single color, matching mobile's
    // single-active-color contract. This is deliberately NOT display-only --
    // the renderer (gpp-renderer.js) only ever draws mask-selected colors,
    // so a display-only toggle here would never have actually changed what
    // shows on the map.
    async function gppMobileSetShowAllColors(showAll) {
        const template = gppState.getFocusedTemplate();
        if (!template || !template.palette || !template.palette.length) return false;
        const core = gppCreateCore();
        if (showAll) {
            template.mask = core.makeFullMask(template.palette.length, template.counts);
        } else {
            const currentPaintColor = gppEvalPageExpr('(typeof pixelColor!=="undefined"?pixelColor:null)');
            let index = gppMobileFindPaletteIndexByColor(template, currentPaintColor);
            if (index < 0) {
                for (let candidate = 0; candidate < template.palette.length; candidate += 1) {
                    if (core.maskHas(template.mask, candidate)) { index = candidate; break; }
                }
            }
            if (index < 0) index = 0;
            template.mask = core.maskOnly(template.palette.length, index);
        }
        await gppState.persistTemplateState(template);
        gppMobilePostlude();
        return true;
    }

    async function gppMobileNormalizeFocusedSelection() {
        const template = gppState.getFocusedTemplate();
        if (!template || !template.palette || !template.palette.length) return false;
        const currentPaintColor = gppEvalPageExpr('(typeof pixelColor!=="undefined"?pixelColor:null)');
        let index = gppMobileFindPaletteIndexByColor(template, currentPaintColor);
        if (index < 0) {
            const core = gppCreateCore();
            for (let candidate = 0; candidate < template.palette.length; candidate += 1) {
                if (core.maskHas(template.mask, candidate)) {
                    index = candidate;
                    break;
                }
            }
        }
        if (index < 0) index = 0;
        return gppMobileSelectColor(index, {
            changeNative: gppMobileFindPaletteIndexByColor(template, currentPaintColor) !== index,
        });
    }

    function gppMobileInstallColorSync() {
        // Reuse the same page-realm event seam as Sync Ghost With Selected
        // Color, but install it unconditionally for this mode so an eyedropper
        // pick also becomes the one selected Ghost++ mask color.
        gppRunInPageRealm(
            'if(!window.__gpc_colorPatchApplied){' +
            'var mobileOriginalChangeColor=window.changeColor;' +
            'if(typeof mobileOriginalChangeColor==="function"){' +
            'window.__gpc_colorPatchApplied=true;' +
            'window.changeColor=function(color){var result=mobileOriginalChangeColor.apply(this,arguments);document.dispatchEvent(new CustomEvent("gpc:pixelColorChanged",{detail:color}));return result;};' +
            '}' +
            '}'
        );
        if (gppMobileColorListenerInstalled) return;
        gppMobileColorListenerInstalled = true;
        gppMobileColorListener = event => {
            if (!_settings.mobileOverhaul) return;
            const template = gppState.getFocusedTemplate();
            const index = gppMobileFindPaletteIndexByColor(template, event.detail);
            // A picked map color that is absent from this template must leave
            // its existing one-bit selection intact, not clear the mask.
            if (index < 0) return;
            // This same event also fires from gppMobileSelectColor's OWN
            // native changeColor() call (the page-realm patch above dispatches
            // it for every changeColor, not just genuine eyedropper picks) --
            // so a swatch tapped while "Show all colors" is on re-enters here
            // via that patched changeColor, with no way to directly know
            // whether narrowing is wanted. Infer it from the mask's current
            // breadth instead: a still-narrow (single-color) mask means this
            // is a genuine eyedropper pick in the normal single-active-color
            // mode, so narrow as usual; an already-wide mask means Show All
            // is active, so stay wide and just ensure the picked color's bit
            // is included.
            gppMobileSelectColor(index, { changeNative: false, narrowMask: gppMobileMaskIsNarrow(template) }).catch(err => {
                console.error('[GeoPixelcons++] Mobile Overhaul failed to sync the picked color:', err);
            });
        };
        document.addEventListener('gpc:pixelColorChanged', gppMobileColorListener);
    }

    function gppMobileInstallPaintSuccessHook() {
        if (gppMobilePaintSuccessHookInstalled) return;
        const target = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (!target || typeof target.fetch !== 'function') return;
        const originalFetch = target.fetch;
        const wrappedFetch = async function gppMobilePaintSuccessFetchWrapper() {
            const response = await originalFetch.apply(this, arguments);
            try {
                const request = arguments[0];
                const url = typeof request === 'string' ? request : (request && request.url) || '';
                if (response && response.ok && String(url).includes('/PlacePixels')) {
                    // Give the native full synchronize/tile-cache update a
                    // moment to land, then reuse the same coalesced autoscan.
                    setTimeout(() => {
                        if (gpcMobileOverhaulAvailable() && typeof gppScheduleAutoscan === 'function') {
                            gppScheduleAutoscan();
                        }
                    }, 800);
                }
            } catch (_) { /* placement itself must never depend on the hook */ }
            return response;
        };
        target.fetch = wrappedFetch;
        gppMobilePaintFetchTarget = target;
        gppMobilePaintOriginalFetch = originalFetch;
        gppMobilePaintWrappedFetch = wrappedFetch;
        gppMobilePaintSuccessHookInstalled = true;
    }

    function gppMobileEnsureLateHooks() {
        if (!gpcMobileOverhaulAvailable()) return;
        if (typeof gppShimEnable === 'function') gppShimEnable();
        if (typeof gppEnsureAutoscanHook === 'function') gppEnsureAutoscanHook();
        if (typeof gppEnsureGuildProjectHook === 'function') gppEnsureGuildProjectHook();
        gppMobileInstallColorSync();
        gppMobileInstallPaintSuccessHook();
    }

    function gppMobileScheduleLateHookRetries() {
        let attempts = 0;
        function retry() {
            gppMobileEnsureLateHooks();
            attempts += 1;
            if (attempts < 20 && gpcMobileOverhaulAvailable()) {
                gppMobileLateHookRetryTimer = setTimeout(retry, 250);
            } else {
                gppMobileLateHookRetryTimer = null;
            }
        }
        retry();
    }

    function gppMobileDisposeHostEffects() {
        if (gppMobileLateHookRetryTimer) clearTimeout(gppMobileLateHookRetryTimer);
        gppMobileLateHookRetryTimer = null;
        if (gppMobileColorListenerInstalled && gppMobileColorListener) {
            document.removeEventListener('gpc:pixelColorChanged', gppMobileColorListener);
        }
        gppMobileColorListenerInstalled = false;
        gppMobileColorListener = null;
        if (gppMobilePaintFetchTarget
            && gppMobilePaintFetchTarget.fetch === gppMobilePaintWrappedFetch
            && gppMobilePaintOriginalFetch) {
            gppMobilePaintFetchTarget.fetch = gppMobilePaintOriginalFetch;
        }
        gppMobilePaintSuccessHookInstalled = false;
        gppMobilePaintFetchTarget = null;
        gppMobilePaintOriginalFetch = null;
        gppMobilePaintWrappedFetch = null;
    }

    function gppMobileRestoreDesktopFallback() {
        const modal = document.getElementById('gpp-modal');
        if (modal) {
            delete modal.dataset.mobileOverhaulSuppressed;
            modal.setAttribute('aria-hidden', 'true');
        }
        gppMobileOverhaulPendingOpen = false;
        if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
    }

    function gppMobileHandleControllerDestroyed() {
        gppMobileOverhaulController = null;
        gppMobileDisposeHostEffects();
        gppMobileOverhaulPhase = 'destroyed';
        // Without this, a debug snapshot taken after a mid-session
        // controller-destroyed event still reports 'ok' from the original
        // successful init, misleadingly implying the feature is still alive.
        _featureStatus.mobileOverhaul = 'destroyed';
        gppMobileRestoreDesktopFallback();
    }

    function gppMobileReadCenterGrid() {
        const map = gppGetMap();
        const turf = gppGetTurf();
        if (!map || !turf || typeof map.getCanvas !== 'function') return null;
        const canvas = map.getCanvas();
        if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return null;
        const rect = canvas.getBoundingClientRect();
        return gppMapClientPointToGrid(
            map,
            turf,
            gppReadGridConstants(),
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
    }

    async function gppMobileCommitPosition(templateOrId, gridX, gridY) {
        const template = typeof templateOrId === 'string' ? gppMobileFindTemplate(templateOrId) : templateOrId;
        if (!template || gppIsPositionLocked(template)) return false;
        const nextX = Number(gridX);
        const nextY = Number(gridY);
        if (!Number.isInteger(nextX) || !Number.isInteger(nextY)) return false;
        await gppShortcutCommitPosition(template, nextX, nextY);
        gppMobilePostlude();
        return true;
    }

    // Tap-to-place: reuses gpp-placement.js's gppBeginPlacementCapture()
    // directly -- the exact same capture-phase, DOM-hit-tested mechanism
    // desktop's own Place button and the E keyboard shortcut already use
    // safely (no gesture-collision risk with the map's own pan/zoom, since
    // this was already proven out there). Replaces the mobile-only fixed
    // reticle system, which reinvented positioning instead of reusing this.
    // Commits directly on the first map tap -- there is no intermediate
    // "draft" step here, matching how the desktop Place button itself
    // behaves (a tap IS the commit), unlike the manual X/Y input fields
    // (template-settings.js's own separate draft-then-Set-Location flow),
    // which are untouched by this and remain their own precise-entry path.
    function gppMobileBeginPlacement(templateOrId, onPlaced, onStatus) {
        const template = typeof templateOrId === 'string' ? gppMobileFindTemplate(templateOrId) : templateOrId;
        if (!template) {
            if (onStatus) onStatus('Focus a template first.', true);
            return false;
        }
        if (gppIsPositionLocked(template)) {
            if (onStatus) onStatus('This template’s position is locked.', true);
            return false;
        }
        if (typeof gppBeginPlacementCapture !== 'function') {
            if (onStatus) onStatus('Placement is not available yet.', true);
            return false;
        }
        gppMobilePlacementActive = true;
        gppBeginPlacementCapture(
            template,
            position => {
                gppMobilePlacementActive = false;
                gppMobileCommitPosition(template, position.gridX, position.gridY)
                    .then(committed => { if (onPlaced) onPlaced(committed ? position : null); })
                    .catch(error => {
                        console.error('[GeoPixelcons++] Mobile Overhaul failed to commit a tapped position:', error);
                        if (onStatus) onStatus('Could not set that location.', true);
                    });
            },
            (message, isError) => {
                if (isError) gppMobilePlacementActive = false;
                if (onStatus) onStatus(message, isError);
            }
        );
        return true;
    }

    function gppMobileCancelPlacement() {
        gppMobilePlacementActive = false;
        if (typeof gppCancelPlacementCapture === 'function') gppCancelPlacementCapture();
    }

    function gppMobileIsPlacementActive() {
        return gppMobilePlacementActive;
    }

    async function gppMobileNudge(templateOrId, deltaX, deltaY) {
        const template = typeof templateOrId === 'string' ? gppMobileFindTemplate(templateOrId) : templateOrId;
        if (!template || !template.position) return false;
        return gppMobileCommitPosition(
            template,
            template.position.gridX + Number(deltaX || 0),
            template.position.gridY + Number(deltaY || 0)
        );
    }

    function gppMobileTogglePreview(templateOrId) {
        const template = typeof templateOrId === 'string' ? gppMobileFindTemplate(templateOrId) : templateOrId;
        if (!template) return false;
        if (gppForcedVisibleTemplateIds.has(template.id)) gppForcedVisibleTemplateIds.delete(template.id);
        else gppForcedVisibleTemplateIds.add(template.id);
        if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
        if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        return gppForcedVisibleTemplateIds.has(template.id);
    }

    async function gppMobileSetGroupNoise(templateOrId, enabled) {
        const template = typeof templateOrId === 'string' ? gppMobileFindTemplate(templateOrId) : templateOrId;
        if (!template) return false;
        template.groupNoise = !!enabled;
        template.groupNoiseData = template.groupNoise
            ? gppCreateCore().groupPaletteColors(template.palette)
            : null;
        await gppState.persistTemplateState(template);
        gppMobilePostlude();
        return template.groupNoise;
    }

    function gppMobileGetHexValues(templateOrId, scope) {
        const template = typeof templateOrId === 'string' ? gppMobileFindTemplate(templateOrId) : templateOrId;
        if (!template) return [];
        return gppMobileReadPaletteRows(template)
            .filter(row => {
                if (scope === 'owned') return row.owned;
                if (scope === 'notOwned') return !row.owned;
                if (scope === 'selected') return row.selected;
                return true;
            })
            .map(row => row.hex);
    }

    async function gppMobileCopyHexValues(templateOrId, scope) {
        const values = gppMobileGetHexValues(templateOrId, scope);
        const text = values.join(', ');
        if (text && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                return { copied: true, count: values.length, text };
            } catch (_) { /* alert fallback below */ }
        }
        alert(text || 'No matching colors.');
        return { copied: false, count: values.length, text };
    }

    function gppMobileBuyUnownedColors(templateOrId) {
        const template = typeof templateOrId === 'string' ? gppMobileFindTemplate(templateOrId) : templateOrId;
        if (!template) return { opened: false, reason: 'no-template', colors: [] };
        if (typeof gppBulkPurchaseOpenProfilePanel !== 'function') {
            alert('Bulk Purchase Colors is disabled in GeoPixelcons++ settings.');
            return { opened: false, reason: 'feature-disabled', colors: [] };
        }
        const colors = gppMobileGetHexValues(template, 'notOwned');
        if (!colors.length) {
            alert('Every color in this template is already owned.');
            return { opened: false, reason: 'already-owned', colors };
        }
        gppBulkPurchaseOpenProfilePanel(colors);
        return { opened: true, colors };
    }

    function gppMobileActivateEyedropper() {
        // Native setToolMode() updates both toolbar buttons without null
        // guards, so keep both originals connected and refuse activation if
        // either has not mounted yet.
        if (!document.getElementById('toggleEyedropper') || !document.getElementById('toggleEyedropper_Bottom')) {
            return false;
        }
        // Confirm the native function actually exists before reporting
        // success -- both toolbar buttons can be present in the DOM while
        // the page's own toggleEyedropperMode has been renamed/removed, in
        // which case the injected script's own internal `typeof` guard
        // would otherwise silently no-op with no feedback to the caller.
        if (gppEvalPageExpr('typeof toggleEyedropperMode') !== 'function') {
            return false;
        }
        gppRunInPageRealm('if(typeof toggleEyedropperMode==="function")toggleEyedropperMode();');
        return true;
    }

    function gppBuildMobileOverhaulBridge() {
        return Object.freeze({
            apiVersion: 1,
            hostVersion: VERSION,
            // Object.freeze() here only prevents reassigning env.window/
            // env.document to something else -- it does NOT sandbox window
            // or document themselves; the mobile module can still reach any
            // global or DOM node through them. That's expected, not a
            // regression: the mobile module already runs as a trusted
            // @require with full page-realm privileges before this bridge
            // is ever built. The rest of this bridge (every method below)
            // is what keeps day-to-day mobile UI code from reaching for raw
            // internals like gppState directly -- env exists for the few
            // cases (DOM mounting, localStorage) that genuinely need it.
            env: Object.freeze({ window, document }),
            isDark: () => isDarkMode(),
            ready: async () => {
                if (typeof gppRendererMount === 'function') await gppRendererMount();
                await gppInitRuntime();
                await gppMobileNormalizeFocusedSelection();
                gppMobileScheduleLateHookRetries();
                return true;
            },
            subscribeRefresh: listener => gppSubscribeUiRefresh(listener),
            getTemplates: () => gppState.templates.slice(),
            getFocusedTemplate: () => gppState.getFocusedTemplate(),
            focusTemplate: async id => {
                if (!gppMobileFindTemplate(id)) return null;
                await gppState.focusTemplate(id);
                // Persisted desktop templates may legitimately carry a
                // multi-color mask. Every template entering the mobile
                // painting surface must immediately re-establish its
                // single-active-color invariant.
                await gppMobileNormalizeFocusedSelection();
                gppMobilePostlude();
                return gppState.getFocusedTemplate();
            },
            deleteTemplate: async id => {
                const template = gppMobileFindTemplate(id);
                if (!template || !gppState.templates.includes(template)) return false;
                await gppState.deleteTemplate(template);
                // Deleting the focused template can promote another saved
                // desktop template, whose mask must be normalized too.
                await gppMobileNormalizeFocusedSelection();
                gppMobilePostlude();
                return true;
            },
            getPaletteRows: template => gppMobileReadPaletteRows(template),
            selectColor: (index, options) => gppMobileSelectColor(index, options),
            setShowAllColors: showAll => gppMobileSetShowAllColors(showAll),
            renderThumbnail: (template, size) => gppLibraryRenderThumbCanvas(template, size || 96),
            renderFullPreview: template => gppLibraryRenderFullCanvas(template),
            readCenterGrid: () => gppMobileReadCenterGrid(),
            canEditPosition: template => !!template && !gppIsPositionLocked(template),
            commitPosition: (template, x, y) => gppMobileCommitPosition(template, x, y),
            beginPlacement: (template, onPlaced, onStatus) => gppMobileBeginPlacement(template, onPlaced, onStatus),
            cancelPlacement: () => gppMobileCancelPlacement(),
            isPlacementActive: () => gppMobileIsPlacementActive(),
            nudge: (template, dx, dy) => gppMobileNudge(template, dx, dy),
            isPreviewForced: id => gppForcedVisibleTemplateIds.has(id),
            togglePreview: template => gppMobileTogglePreview(template),
            setGroupNoise: (template, enabled) => gppMobileSetGroupNoise(template, enabled),
            scanTemplate: template => gppScanTemplate(template),
            getScanBusy: template => gppScanIsBusyFor(template),
            buyUnownedColors: template => gppMobileBuyUnownedColors(template),
            getHexValues: (template, scope) => gppMobileGetHexValues(template, scope),
            copyHexValues: (template, scope) => gppMobileCopyHexValues(template, scope),
            goTo: template => gppLibraryFlyToTemplate(template),
            activateEyedropper: () => gppMobileActivateEyedropper(),
            getSelectedPaintColor: () => gppEvalPageExpr('(typeof pixelColor!=="undefined"?pixelColor:null)'),
            ensureRuntimeHooks: () => gppMobileEnsureLateHooks(),
            disposeHostEffects: () => gppMobileDisposeHostEffects(),
            onControllerDestroyed: () => gppMobileHandleControllerDestroyed(),
            requestRefresh: () => gppRequestUiRefresh(),
            log: (level, message, detail) => {
                const method = console[level] ? level : 'log';
                console[method]('[GeoPixelcons++] Mobile Overhaul: ' + message, detail || '');
            },
        });
    }

    // hidePaintMenu/ext-auto-hover-menus/ext-pill-hover-labels each read
    // gpcMobileOverhaulAvailable() once, synchronously, at script-boot time
    // -- before this async function has had any chance to succeed or fail.
    // If mobileOverhaul turns out unavailable, they were wrongly skipped and
    // need a second chance; each exposes its own idempotent retry function.
    function gppMobileRetryGatedFeatures() {
        if (typeof gppRetryHidePaintMenuInit === 'function') gppRetryHidePaintMenuInit();
        if (typeof gppRetryExtAutoHoverMenusInit === 'function') gppRetryExtAutoHoverMenusInit();
        if (typeof gppRetryExtPillHoverLabelsInit === 'function') gppRetryExtPillHoverLabelsInit();
    }

    async function gppStartMobileOverhaul() {
        if (!_settings.mobileOverhaul) return;
        const externalInit = (typeof mobileOverhaulInit === 'function') ? mobileOverhaulInit : null;
        if (!externalInit) {
            gppMobileOverhaulPhase = 'failed';
            _featureStatus.mobileOverhaul = 'unavailable';
            console.error('[GeoPixelcons++] Mobile System Overhaul is enabled, but its external module did not load. Other features will continue normally.');
            gppMobileRetryGatedFeatures();
            return;
        }
        gppMobileOverhaulPhase = 'starting';
        try {
            const controller = await externalInit(gppBuildMobileOverhaulBridge());
            if (!controller
                || typeof controller.openPanel !== 'function'
                || typeof controller.togglePanel !== 'function'
                || typeof controller.refresh !== 'function'
                || typeof controller.destroy !== 'function') {
                if (controller && typeof controller.destroy === 'function') controller.destroy();
                throw new Error('External module returned an invalid controller');
            }
            gppMobileOverhaulController = controller;
            gppMobileOverhaulPhase = 'ready';
            _featureStatus.mobileOverhaul = 'ok';
            if (gppMobileOverhaulPendingOpen && gppMobileOverhaulController && typeof gppMobileOverhaulController.openPanel === 'function') {
                gppMobileOverhaulPendingOpen = false;
                gppMobileOverhaulController.openPanel();
            }
            console.log('[GeoPixelcons++] ✅ Mobile System Overhaul loaded');
        } catch (err) {
            if (gppMobileOverhaulController && typeof gppMobileOverhaulController.destroy === 'function') {
                try { gppMobileOverhaulController.destroy(); } catch (_) { /* fallback continues */ }
            }
            gppMobileOverhaulController = null;
            gppMobileDisposeHostEffects();
            gppMobileOverhaulPhase = 'failed';
            gppMobileRestoreDesktopFallback();
            _featureStatus.mobileOverhaul = 'error';
            dbgPush(`Mobile System Overhaul init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Mobile System Overhaul' });
            console.error('[GeoPixelcons++] ❌ Mobile System Overhaul failed:', err);
            gppMobileRetryGatedFeatures();
        }
    }

    if (_settings.mobileOverhaul) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', gppStartMobileOverhaul, { once: true });
        } else {
            gppStartMobileOverhaul();
        }
    }
