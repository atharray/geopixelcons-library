
    // ============================================================
    //  EXTENSION: Improved Map Rendering [extImprovedMapRendering]
    // ============================================================
    //
    //  Brings already-loaded pixel tiles back on screen the moment they are
    //  needed again -- after zooming in past your Render Level, or after
    //  panning back over tiles you have visited -- instead of leaving them
    //  blank until the next server sync.
    //
    //  Why the site goes blank (js/index.js, verified against the live page):
    //    - Zoom-out: updateInterfaceState runs on every `zoom` frame and, the
    //      instant zoom drops below minZoom, calls pixelTileLayer.clear() and
    //      tileTextureState.clear(). That deletes only the GPU textures --
    //      tileImageCache, the decoded ImageBitmaps, is never evicted.
    //    - Pan-away: drawCachedTilesOnMap() evicts GPU textures for tiles
    //      outside a buffer of 2x the viewport (min 7 tiles). Again the RAM
    //      copy stays.
    //    - Coming back re-uploads nothing directly. The only code path that
    //      reaches drawCachedTilesOnMap() is synchronize(): the 1 s 'partial'
    //      sync finds every nearby tile already cached and returns early
    //      WITHOUT drawing, so the canvas stays empty until the 5 s 'full'
    //      sync tick completes a /GetPixelsCached round trip (measured: ~2.4 s
    //      average after a zoom, 1.1-5 s after a pan, then all textures
    //      re-uploaded from memory in ~13 ms). Ironically a brand-new area
    //      renders FASTER than a revisited one, because new tiles trigger a
    //      fetch and the fetch triggers the draw.
    //
    //  The fix is therefore not a debounce on the clear -- keeping textures
    //  resident below the render level would fight the site's own zoom
    //  prompt and defeat Render Level as a low-spec memory knob. It is a
    //  missing redraw trigger: on every camera move, when some cached tile
    //  inside the site's own draw buffer has no GPU texture, call the site's
    //  drawCachedTilesOnMap(). That performs exactly the upload the 5 s sync
    //  would have done later, with zero network requests (measured: first
    //  tile in ~4-14 ms, all 9 in ~25-50 ms).
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
    //    - Calls the site's draw only when a cached tile inside the site's
    //      own buffer is missing from the GPU (see needsDraw). This is not
    //      just thrift: drawCachedTilesOnMap() also calls map.moveLayer(),
    //      which dirties MapLibre's layer order and forces a full label
    //      placement pass on the next frame even when the layer is already
    //      on top. The site pays that every 5 s; paying it per pan frame
    //      would thrash label placement.
    //    - Idempotent: drawCachedTilesOnMap() early-returns below minZoom and
    //      skips tiles that are already resident.
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
        checks: 0,
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

    // Mirrors the visibility test inside drawCachedTilesOnMap (index.js):
    // a tile is drawn when it intersects a buffer of twice the viewport,
    // never smaller than 7 tiles, centred on the map centre. Everything is
    // done in Web Mercator metres -- the same rectangle the site builds, just
    // without the per-tile lng/lat round trip. Returns true when at least one
    // cached tile inside that buffer has no GPU texture yet, i.e. exactly the
    // moments the site's own draw would upload something.
    //
    // This matters because drawCachedTilesOnMap() also calls map.moveLayer(),
    // which marks the style's layer order dirty and forces MapLibre into a
    // full label-placement pass on the next frame even when the layer is
    // already on top. Calling it on every pan frame would thrash placement;
    // calling it only when there is a texture to upload keeps that cost to
    // the same occasions the site would have paid it anyway.
    function needsDraw(m, layer, cache) {
        if (layer.tiles.size === 0) return true;      // the zoom-back-in case: nothing resident at all
        var t, grid, tileGrid;
        try { t = (typeof turf !== 'undefined') ? turf : null; } catch (e) { t = null; }
        try { grid = (typeof gridSize === 'number') ? gridSize : null; } catch (e) { grid = null; }
        try { tileGrid = (typeof SYNC_TILE_SIZE === 'number') ? SYNC_TILE_SIZE : null; } catch (e) { tileGrid = null; }
        if (!t || typeof t.toMercator !== 'function' || !grid || !tileGrid ||
            typeof m.getBounds !== 'function' || typeof m.getCenter !== 'function') {
            return false;                              // cannot mirror the site's test; stay conservative
        }
        var bounds = m.getBounds();
        var sw = t.toMercator([bounds.getWest(), bounds.getSouth()]);
        var ne = t.toMercator([bounds.getEast(), bounds.getNorth()]);
        var centre = m.getCenter();
        var c = t.toMercator([centre.lng, centre.lat]);
        var minBuffer = 7 * tileGrid * grid;
        var w = Math.max((ne[0] - sw[0]) * 2, minBuffer);
        var h = Math.max((ne[1] - sw[1]) * 2, minBuffer);
        var minX = c[0] - w / 2, maxX = c[0] + w / 2;
        var minY = c[1] - h / 2, maxY = c[1] + h / 2;
        var tileSize = tileGrid * grid;
        var half = grid / 2;
        var hasTile = (typeof layer.hasTile === 'function')
            ? function (k) { return layer.hasTile(k); }
            : function (k) { return layer.tiles.has(k); };
        var it = cache.entries();
        for (var step = it.next(); !step.done; step = it.next()) {
            var key = step.value[0], entry = step.value[1];
            if (!entry || !entry.colorBitmap || !entry.userBitmap) continue;   // nothing drawable yet
            if (hasTile(key)) continue;                                        // already on the GPU
            var comma = key.indexOf(',');
            if (comma < 0) continue;
            var ox = parseInt(key.slice(0, comma), 10), oy = parseInt(key.slice(comma + 1), 10);
            if (isNaN(ox) || isNaN(oy)) continue;
            var x0 = ox * grid - half, y0 = oy * grid - half;
            var x1 = x0 + tileSize, y1 = y0 + tileSize;
            if (x1 < minX || x0 > maxX || y1 < minY || y0 > maxY) continue;    // outside the buffer
            return true;
        }
        return false;
    }

    // Returns true only when it actually asked the site to redraw.
    function restore(reason) {
        var m = getMap(), layer = getLayer(), cache = getCache();
        if (!m || !layer || !cache) return false;
        if (cache.size === 0) return false;           // nothing in memory to bring back
        var threshold = getThreshold();
        var zoom = m.getZoom();
        if (threshold !== null && zoom < threshold) return false;   // still below Render Level
        if (typeof drawCachedTilesOnMap !== 'function') return false;
        var needed;
        try { needed = needsDraw(m, layer, cache); } catch (e) { needed = false; }
        state.checks++;
        if (!needed) return false;                    // every visible tile is already resident
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

    // Coalesce the synchronous move/zoom/moveend burst of one tick into a
    // single check. Deliberately a macrotask, not requestAnimationFrame: rAF
    // is paused in hidden/background documents and some embedded webviews,
    // and a pending flag waiting on a frame that never comes would silently
    // block every later restore.
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

    // MapLibre fires 'move' on every camera frame -- pans AND zooms (a zoom
    // frame emits 'move' then 'zoom') -- so 'move' alone covers both the
    // zoom-back-in case and panning back over already-visited tiles.
    // 'moveend' guarantees a final check after inertia settles.
    function onMove() { scheduleRestore('move'); }
    function onMoveEnd() { scheduleRestore('moveend'); }

    function attach() {
        if (state.attached) return true;
        var m = getMap();
        if (!m) return false;
        m.on('move', onMove);
        m.on('moveend', onMoveEnd);
        state.attached = true;
        return true;
    }

    function detach() {
        if (!state.attached) return;
        var m = getMap();
        if (m && typeof m.off === 'function') {
            m.off('move', onMove);
            m.off('moveend', onMoveEnd);
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
                checks: state.checks,
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
