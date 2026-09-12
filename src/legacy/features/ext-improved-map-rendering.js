
    // ============================================================
    //  EXTENSION: Improved Map Rendering [extImprovedMapRendering]
    // ============================================================
    //
    //  Brings the pixel canvas back the moment you zoom in past your Render
    //  Level again, instead of leaving it blank until the next server sync.
    //
    //  Why the site goes blank (js/index.js, verified against the live page):
    //    - updateInterfaceState runs on every `zoom` frame and, the instant
    //      zoom drops below minZoom, calls pixelTileLayer.clear() and
    //      tileTextureState.clear(). That deletes only the GPU textures --
    //      tileImageCache, the decoded ImageBitmaps, is never evicted.
    //    - Zooming back in re-uploads nothing directly. The only code path
    //      that reaches drawCachedTilesOnMap() afterwards is synchronize():
    //      the 1 s 'partial' sync finds every nearby tile already cached and
    //      returns early WITHOUT drawing, so the canvas stays empty until
    //      the 5 s 'full' sync tick completes a /GetPixelsCached round trip
    //      (measured: ~2.4 s average wait, then all 9 textures re-uploaded
    //      from memory in ~13 ms).
    //
    //  The fix is therefore not a debounce on the clear -- keeping textures
    //  resident below the render level would fight the site's own zoom
    //  prompt and defeat Render Level as a low-spec memory knob. It is a
    //  missing redraw trigger: when zoom crosses back above the threshold
    //  and the layer has no textures but the cache has bitmaps, call the
    //  site's own drawCachedTilesOnMap(). That performs exactly the upload
    //  the 5 s sync would have done later, with zero network requests
    //  (measured: first tile in ~7 ms, all 9 in ~25 ms).
    //
    //  Everything this needs -- map, pixelTileLayer, tileImageCache, minZoom --
    //  is a top-level `let`/`const` in index.js, invisible to unsafeWindow
    //  property access, so the hook runs as a classic <script> in the page's
    //  own lexical scope, the same technique as ext-canvas-toggle.js and
    //  ext-map-movement-lock.js. drawCachedTilesOnMap is a top-level function
    //  declaration and so is a real global, but it is called from inside the
    //  same page-realm script for consistency.
    //
    //  Safety properties:
    //    - Idempotent and self-limiting: drawCachedTilesOnMap() itself
    //      early-returns below minZoom, and once tiles.size > 0 the hook is a
    //      no-op until the site clears the layer again.
    //    - Never touches tileImageCache, tileTextureState, or clear(); it only
    //      asks the site to run its own redraw earlier than it otherwise would.
    //    - Coalesced to one check per event-loop tick and throttled so rapid
    //      oscillation across the threshold cannot stack uploads. It does not
    //      use requestAnimationFrame, which is paused in hidden documents and
    //      some embedded webviews (verified: a rAF-based version never fired
    //      in the desktop app's browser pane while zoom events still did).
    //
    if (_settings.extImprovedMapRendering) {
        try {
            (function _ext_improvedMapRendering() {

    const BRIDGE_FLAG = '__gpcImprovedMapRenderingBridge';
    const BRIDGE_API  = '__gpcImprovedMapRendering';
    const ATTACH_POLL_MS = 250;
    const ATTACH_GIVE_UP_MS = 120000;

    const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // Kept as a standalone constant (no interpolation) so tests can extract
    // and execute the exact page-realm code against fake site globals.
    const BRIDGE_SOURCE = `
(function () {
    if (window.__gpcImprovedMapRenderingBridge) return;
    window.__gpcImprovedMapRenderingBridge = true;

    var MIN_RESTORE_GAP_MS = 100;
    var state = {
        attached: false,
        checkPending: false,
        trailingTimer: null,
        lastRestoreAt: 0,
        restores: 0,
        lastReason: null
    };

    function getMap() {
        try {
            return (typeof map !== 'undefined' && map &&
                typeof map.on === 'function' && typeof map.getZoom === 'function') ? map : null;
        } catch (e) { return null; }
    }
    function getLayer() {
        try {
            return (typeof pixelTileLayer !== 'undefined' && pixelTileLayer &&
                pixelTileLayer.tiles && typeof pixelTileLayer.tiles.size === 'number') ? pixelTileLayer : null;
        } catch (e) { return null; }
    }
    function getCache() {
        try {
            return (typeof tileImageCache !== 'undefined' && tileImageCache &&
                typeof tileImageCache.size === 'number') ? tileImageCache : null;
        } catch (e) { return null; }
    }
    function getThreshold() {
        try { if (typeof minZoom === 'number' && isFinite(minZoom)) return minZoom; } catch (e) {}
        try {
            if (typeof userConfig !== 'undefined' && userConfig &&
                typeof userConfig.renderLevel === 'number' && isFinite(userConfig.renderLevel)) return userConfig.renderLevel;
        } catch (e) {}
        return null;
    }

    // Returns true only when it actually asked the site to redraw.
    function restore(reason) {
        var m = getMap(), layer = getLayer(), cache = getCache();
        if (!m || !layer || !cache) return false;
        if (layer.tiles.size > 0) return false;      // textures already resident
        if (cache.size === 0) return false;           // nothing in memory to bring back
        var threshold = getThreshold();
        var zoom = m.getZoom();
        if (threshold !== null && zoom < threshold) return false;   // still below Render Level
        if (typeof drawCachedTilesOnMap !== 'function') return false;
        try {
            drawCachedTilesOnMap();
        } catch (e) {
            return false;
        }
        state.lastRestoreAt = Date.now();
        state.restores++;
        state.lastReason = reason || null;
        return true;
    }

    // Coalesce the synchronous zoom/zoomend pair (and any burst of zoom
    // frames in one tick) into a single check. Deliberately a macrotask, not
    // requestAnimationFrame: rAF is paused in hidden/background documents and
    // some embedded webviews, and a pending flag waiting on a frame that never
    // comes would silently block every later restore.
    function scheduleRestore(reason) {
        if (state.checkPending) return;
        state.checkPending = true;
        setTimeout(function () {
            state.checkPending = false;
            var sinceLast = Date.now() - state.lastRestoreAt;
            if (sinceLast >= MIN_RESTORE_GAP_MS) {
                restore(reason);
                return;
            }
            // Throttled: make sure the final state still gets restored.
            if (state.trailingTimer) return;
            state.trailingTimer = setTimeout(function () {
                state.trailingTimer = null;
                restore(reason);
            }, MIN_RESTORE_GAP_MS - sinceLast);
        }, 0);
    }

    function onZoom() { scheduleRestore('zoom'); }

    function attach() {
        if (state.attached) return true;
        var m = getMap();
        if (!m) return false;
        m.on('zoom', onZoom);
        m.on('zoomend', onZoom);
        state.attached = true;
        return true;
    }

    function detach() {
        if (!state.attached) return;
        var m = getMap();
        if (m && typeof m.off === 'function') {
            m.off('zoom', onZoom);
            m.off('zoomend', onZoom);
        }
        if (state.trailingTimer) { clearTimeout(state.trailingTimer); state.trailingTimer = null; }
        state.attached = false;
    }

    window.__gpcImprovedMapRendering = {
        attach: attach,
        detach: detach,
        restore: function () { return restore('manual'); },
        getState: function () {
            return {
                attached: state.attached,
                restores: state.restores,
                lastReason: state.lastReason,
                lastRestoreAt: state.lastRestoreAt
            };
        }
    };
})();`;

    function installBridge() {
        if (_pw[BRIDGE_FLAG]) return;
        const script = document.createElement('script');
        script.textContent = BRIDGE_SOURCE;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }

    // `map` is created inside the site's async init(), usually well after
    // this userscript runs, so keep trying to attach until it exists.
    function attachWhenReady() {
        const startedAt = Date.now();
        const tryAttach = () => {
            try {
                const api = _pw[BRIDGE_API];
                if (api && typeof api.attach === 'function' && api.attach()) return true;
            } catch (err) {
                dbgPush(`Improved Map Rendering attach failed: ${err && err.message ? err.message : String(err)}`,
                    { error: err, uiComponent: 'Improved Map Rendering' });
            }
            return false;
        };
        if (tryAttach()) return;
        const timer = setInterval(() => {
            if (tryAttach() || Date.now() - startedAt > ATTACH_GIVE_UP_MS) {
                clearInterval(timer);
            }
        }, ATTACH_POLL_MS);
    }

    installBridge();
    attachWhenReady();

            })();
            _featureStatus.extImprovedMapRendering = 'ok';
            console.log('[GeoPixelcons++] ✅ Improved Map Rendering loaded');
        } catch (err) {
            _featureStatus.extImprovedMapRendering = 'error';
            dbgPush(`Improved Map Rendering init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Improved Map Rendering' });
            console.error('[GeoPixelcons++] ❌ Improved Map Rendering failed:', err);
        }
    }
