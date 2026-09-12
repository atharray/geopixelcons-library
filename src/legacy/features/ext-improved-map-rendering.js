
    // ============================================================
    //  EXTENSION: Improved Map Rendering [extImprovedMapRendering]
    // ============================================================
    //
    //  Three related fixes for how GeoPixels gets pixel tiles on screen, all
    //  built on the site's own functions rather than a re-implementation:
    //
    //  1. RESTORE -- bring already-loaded tiles back the moment they are
    //     needed again (after zooming in past your Render Level, or panning
    //     back over tiles you have visited) instead of waiting for the next
    //     server sync.
    //  2. TILE LOADING RADIUS -- fetch a wider ring of tiles around the map
    //     centre than the site's hardcoded 3x3, so a zoomed-out view fills in
    //     without having to pan over every tile.
    //  3. MAX TILE CACHE -- the site never frees decoded tiles from RAM. With
    //     a wider ring that stops being harmless, so an optional budget
    //     evicts the tiles farthest from the view once the cache exceeds it.
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
    //      re-uploaded from memory in ~13 ms).
    //
    //  Why the site loads lazily: synchronize() always requests exactly the
    //  3x3 tiles (75 km square) around the map CENTRE regardless of zoom. At
    //  the default render level (10.5) that is ~20% of the viewport; at zoom
    //  8 it is under 1%. Everything else on screen is whatever happened to be
    //  cached when the centre last passed over it.
    //
    //  How each part works:
    //    - Restore: on every camera move, when some cached tile inside the
    //      site's own draw buffer has no GPU texture, call the site's
    //      drawCachedTilesOnMap(). Zero network requests.
    //    - Radius: the server caps /GetPixelsCached at 9 tiles per request
    //      (HTTP 413, verified live), so the ring is loaded by a second
    //      instance of the site's own sync-worker: batches of at most 9,
    //      nearest first, one in flight at a time, at least 1 s apart, only
    //      above the render level and only while the tab is visible. Cached
    //      ring tiles are re-checked for deltas every 15 s x radius. Responses
    //      are handled with the same four cases as synchronize(), through the
    //      site's merge worker, so its caches see exactly what its own sync
    //      would produce. The site's own 3x3 request is never touched.
    //    - Budget: once a second, on moveend and after each ring batch, if the
    //      estimated decoded size (width x height x 4 bytes x 2 bitmaps) exceeds
    //      the budget, evict tiles outside BOTH the draw buffer and the fetch
    //      ring, farthest from centre first, closing their ImageBitmaps and
    //      dropping their GPU textures. Tiles on screen are never evicted, so
    //      the budget is soft while zoomed far out. Never runs while the site
    //      has a sync in flight: a response for an evicted tile would leave a
    //      timestamp-only entry the site then treats as "in cache" forever
    //      (its CASE 4). Such entries -- whatever their origin -- are detected
    //      (bitmaps undefined rather than null) and re-requested as full tiles.
    //
    //  Everything this needs -- map, pixelTileLayer, tileImageCache, minZoom,
    //  mergeWorker, isSyncing -- is a top-level `let`/`const` in index.js,
    //  invisible to unsafeWindow property access, so the hook runs as a
    //  classic <script> in the page's own lexical scope, the same technique
    //  as ext-canvas-toggle.js and ext-map-movement-lock.js.
    //
    //  Safety properties:
    //    - Calls the site's draw only when a cached tile inside the site's
    //      own buffer is missing from the GPU (see needsDraw). This is not
    //      just thrift: drawCachedTilesOnMap() also calls map.moveLayer(),
    //      which dirties MapLibre's layer order and forces a full label
    //      placement pass on the next frame even when the layer is already
    //      on top. The site pays that every 5 s; paying it per pan frame
    //      would thrash label placement.
    //    - Never calls clear(), never writes bitmaps into tileImageCache; the
    //      only cache mutation is the budgeted eviction described above.
    //    - Coalesced to one check per event-loop tick and throttled. It does
    //      not use requestAnimationFrame, which is paused in hidden documents
    //      and some embedded webviews (verified: a rAF-based version never
    //      fired in the desktop app's browser pane while zoom events did).
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
    var SYNC_WORKER_URL = '/js/sync-worker.js';   // the site's own worker script, run as a second instance
    var RING_BATCH_SIZE = 9;              // hard server limit per /GetPixelsCached request (HTTP 413 above)
    var RING_MIN_GAP_MS = 1000;           // pacing between ring batches; one batch in flight at a time
    var RING_TIMEOUT_MS = 30000;          // give up waiting for a batch that never answers
    var RING_REFRESH_BASE_MS = 15000;     // x radius: how often cached ring tiles are re-checked for deltas
    var REREQUEST_COOLDOWN_MS = 30000;    // a tile the server did not return is not asked for again sooner
    var MIN_RADIUS = 1, MAX_RADIUS = 4;   // 3x3 .. 9x9
    var state = {
        attached: false,
        checkPending: false,
        trailingTimer: null,
        lastRestoreAt: 0,
        restores: 0,
        checks: 0,
        lastReason: null,
        radius: 2,                        // 5x5 by default
        maxCacheBytes: 0,                 // 0 = unlimited
        attachedAt: 0,
        timer: null,
        ringWorker: null,
        ringInFlight: null,               // { tiles, at } while a batch is awaiting its response
        lastRingBatchAt: 0,
        requestedAt: {},                  // tileKey -> Date.now() of our last fresh request for it
        refreshedAt: {},                  // tileKey -> Date.now() of our last delta check for it
        ringBatches: 0,
        ringTilesRequested: 0,
        ringTilesCached: 0,
        evictions: 0,
        evictedBytes: 0,
        evictPending: false
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
    function getGeometry() {
        var t = null, grid = null, tileGrid = null;
        try { t = (typeof turf !== 'undefined' && turf && typeof turf.toMercator === 'function') ? turf : null; } catch (e) {}
        try { grid = (typeof gridSize === 'number') ? gridSize : null; } catch (e) {}
        try { tileGrid = (typeof SYNC_TILE_SIZE === 'number') ? SYNC_TILE_SIZE : null; } catch (e) {}
        if (!t || !grid || !tileGrid) return null;
        return { turf: t, grid: grid, tileGrid: tileGrid, tileSize: grid * tileGrid, half: grid / 2 };
    }
    function isSiteSyncing() {
        try { return typeof isSyncing !== 'undefined' && !!isSyncing; } catch (e) { return false; }
    }

    // The centre tile exactly as synchronize() computes it (index.js ~313).
    function centreTile(m, g) {
        var c = m.getCenter();
        var merc = g.turf.toMercator([c.lng, c.lat]);
        var gx = Math.round(merc[0] / g.grid), gy = Math.round(merc[1] / g.grid);
        return {
            x: Math.floor(gx / g.tileGrid) * g.tileGrid,
            y: Math.floor(gy / g.tileGrid) * g.tileGrid
        };
    }
    function parseKey(key) {
        var comma = key.indexOf(',');
        if (comma < 0) return null;
        var ox = parseInt(key.slice(0, comma), 10), oy = parseInt(key.slice(comma + 1), 10);
        if (isNaN(ox) || isNaN(oy)) return null;
        return { x: ox, y: oy };
    }
    // Chebyshev distance in tiles from the centre tile.
    function tileDistance(origin, centre, g) {
        return Math.max(Math.abs(origin.x - centre.x), Math.abs(origin.y - centre.y)) / g.tileGrid;
    }

    // Mirrors the visibility test inside drawCachedTilesOnMap (index.js):
    // a tile is drawn when it intersects a buffer of twice the viewport,
    // never smaller than 7 tiles, centred on the map centre. Everything is
    // done in Web Mercator metres -- the same rectangle the site builds, just
    // without the per-tile lng/lat round trip.
    function bufferBox(m, g) {
        if (typeof m.getBounds !== 'function' || typeof m.getCenter !== 'function') return null;
        var bounds = m.getBounds();
        var sw = g.turf.toMercator([bounds.getWest(), bounds.getSouth()]);
        var ne = g.turf.toMercator([bounds.getEast(), bounds.getNorth()]);
        var centre = m.getCenter();
        var c = g.turf.toMercator([centre.lng, centre.lat]);
        var minBuffer = 7 * g.tileSize;
        var w = Math.max((ne[0] - sw[0]) * 2, minBuffer);
        var h = Math.max((ne[1] - sw[1]) * 2, minBuffer);
        return { minX: c[0] - w / 2, maxX: c[0] + w / 2, minY: c[1] - h / 2, maxY: c[1] + h / 2 };
    }
    function tileInBox(origin, box, g) {
        var x0 = origin.x * g.grid - g.half, y0 = origin.y * g.grid - g.half;
        var x1 = x0 + g.tileSize, y1 = y0 + g.tileSize;
        return !(x1 < box.minX || x0 > box.maxX || y1 < box.minY || y0 > box.maxY);
    }

    // Returns true when at least one cached tile inside the draw buffer has
    // no GPU texture yet, i.e. exactly the moments the site's own draw would
    // upload something. This matters because drawCachedTilesOnMap() also
    // calls map.moveLayer(), which marks the style's layer order dirty and
    // forces MapLibre into a full label-placement pass on the next frame even
    // when the layer is already on top. Calling it on every pan frame would
    // thrash placement; calling it only when there is a texture to upload
    // keeps that cost to the same occasions the site would have paid it.
    function needsDraw(m, layer, cache) {
        if (layer.tiles.size === 0) return true;      // the zoom-back-in case: nothing resident at all
        var g = getGeometry();
        if (!g) return false;                          // cannot mirror the site's test; stay conservative
        var box = bufferBox(m, g);
        if (!box) return false;
        var hasTile = (typeof layer.hasTile === 'function')
            ? function (k) { return layer.hasTile(k); }
            : function (k) { return layer.tiles.has(k); };
        var it = cache.entries();
        for (var step = it.next(); !step.done; step = it.next()) {
            var key = step.value[0], entry = step.value[1];
            if (!entry || !entry.colorBitmap || !entry.userBitmap) continue;   // nothing drawable yet
            if (hasTile(key)) continue;                                        // already on the GPU
            var origin = parseKey(key);
            if (!origin) continue;
            if (!tileInBox(origin, box, g)) continue;                          // outside the buffer
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

    // ---------- tile loading radius ----------
    //
    // The server caps /GetPixelsCached at 9 tiles per request (HTTP 413
    // "Request exceeds the maximum of 9 tiles." -- verified live), so the
    // ring cannot simply be appended to the site's own request: one oversized
    // request fails outright and costs the site its 3x3 update for that
    // cycle. The ring is therefore loaded through a SEPARATE sync-worker
    // instance, at most 9 tiles per batch, one batch in flight at a time,
    // with a minimum gap between batches. Responses are handled here with
    // the same four cases as synchronize() (index.js ~383-465), using the
    // site's own merge worker for delta application, so the site's caches
    // see exactly what they would see from its own sync.

    // A cache entry the site will keep sending a timestamp for but never
    // re-fetch: CASE 4 in synchronize() stores { timestamp } with no bitmap
    // fields at all. Mid-merge entries are different -- the site sets their
    // bitmaps to null explicitly -- and must keep their timestamp.
    function isZombieEntry(entry) {
        return !!entry && entry.colorBitmap === undefined && entry.userBitmap === undefined;
    }
    function entryTimestamp(entry) {
        if (!entry || isZombieEntry(entry)) return 0;
        var ts = entry.timestamp;
        return (typeof ts === 'number' && ts > 0) ? ts : 0;
    }
    function recentlyRequested(key, now) {
        var at = state.requestedAt[key];
        return typeof at === 'number' && (now - at) < REREQUEST_COOLDOWN_MS;
    }

    // Visits ring tiles nearest-first: distance minD, then the next ring, ...
    // up to state.radius. Distance 1 is the site's own 3x3 (minus the
    // centre), which its partial sync already fills within a second; the ring
    // loader therefore starts at distance 2.
    function forEachRingTile(centre, g, fn, minD) {
        for (var d = (minD || 1); d <= state.radius; d++) {
            for (var i = -d; i <= d; i++) {
                for (var j = -d; j <= d; j++) {
                    if (Math.max(Math.abs(i), Math.abs(j)) !== d) continue;
                    if (fn(centre.x + i * g.tileGrid, centre.y + j * g.tileGrid) === false) return;
                }
            }
        }
    }

    function ringRefreshIntervalMs() {
        // Scales with ring size so refresh traffic stays roughly constant:
        // 5x5 -> 30 s (2 batches), 9x9 -> 60 s (9 batches).
        return RING_REFRESH_BASE_MS * state.radius;
    }

    // Picks the next batch: uncached ring tiles first (fresh requests), then
    // cached ring tiles whose last refresh is older than the interval (with
    // their timestamps, so the server answers with deltas only).
    function nextRingBatch(now) {
        if (state.radius <= 1) return [];
        var m = getMap(), cache = getCache(), g = getGeometry();
        if (!m || !cache || !g || typeof m.getCenter !== 'function') return [];
        var threshold = getThreshold();
        if (threshold !== null && m.getZoom() < threshold) return [];
        var centre = centreTile(m, g);
        var batch = [];
        forEachRingTile(centre, g, function (x, y) {
            var key = x + ',' + y;
            if (entryTimestamp(cache.get(key)) > 0) return true;
            if (recentlyRequested(key, now)) return true;
            batch.push({ x: x, y: y, timestamp: 0, key: key });
            return batch.length < RING_BATCH_SIZE;
        }, 2);
        if (batch.length < RING_BATCH_SIZE) {
            var interval = ringRefreshIntervalMs();
            var due = [];
            forEachRingTile(centre, g, function (x, y) {
                var key = x + ',' + y;
                var ts = entryTimestamp(cache.get(key));
                if (ts === 0) return true;
                var last = state.refreshedAt[key];
                if (typeof last !== 'number') last = state.attachedAt;      // tiles loaded by the site itself
                if (now - last < interval) return true;
                due.push({ x: x, y: y, timestamp: ts, key: key, last: last });
                return true;
            }, 2);
            due.sort(function (a, b) { return a.last - b.last; });          // stalest first
            for (var i = 0; i < due.length && batch.length < RING_BATCH_SIZE; i++) batch.push(due[i]);
        }
        return batch;
    }

    function getRingWorker() {
        if (state.ringWorker) return state.ringWorker;
        if (typeof Worker !== 'function') return null;
        try {
            var w = new Worker(SYNC_WORKER_URL);
            w.addEventListener('message', onRingWorkerMessage);
            w.addEventListener('error', function () { finishRingBatch(); });
            state.ringWorker = w;
            return w;
        } catch (e) { return null; }
    }
    // A batch that timed out does not count towards pacing: the next tick may
    // move on immediately rather than wait another gap on top of the timeout.
    function finishRingBatch(timedOut) {
        state.ringInFlight = null;
        if (!timedOut) state.lastRingBatchAt = Date.now();
    }

    function postRingBatch(batch) {
        var w = getRingWorker();
        if (!w) return false;
        var now = Date.now();
        var tiles = [];
        for (var i = 0; i < batch.length; i++) {
            var t = batch[i];
            tiles.push({ x: t.x, y: t.y, timestamp: t.timestamp });
            if (t.timestamp === 0) state.requestedAt[t.key] = now;
            state.refreshedAt[t.key] = now;       // a fresh load is as up to date as a delta check
        }
        state.ringInFlight = { tiles: tiles, at: now };
        state.ringBatches++;
        state.ringTilesRequested += tiles.length;
        try {
            // No userID/tokenUser: the worker then skips its /GetUserData call.
            w.postMessage({ type: 'sync-delta', tiles: tiles });
        } catch (e) {
            finishRingBatch();
            return false;
        }
        return true;
    }

    // Mirrors synchronize()'s response handling (index.js ~383-465) for the
    // tiles this loader asked for. Deltas go through the site's merge worker,
    // whose own onmessage handler writes the merged bitmaps back into
    // tileImageCache and calls drawCachedTilesOnMap().
    function onRingWorkerMessage(ev) {
        var data = ev && ev.data;
        if (!data || data.type === 'log' || data.type === 'worker-error') return;
        finishRingBatch();
        if (!data.ok || !data.processedTiles) return;
        var cache = getCache();
        if (!cache) return;
        var mw = null;
        try { if (typeof ensureMergeWorker === 'function') ensureMergeWorker(); } catch (e) {}
        try { mw = (typeof mergeWorker !== 'undefined' && mergeWorker && typeof mergeWorker.postMessage === 'function') ? mergeWorker : null; } catch (e) { mw = null; }
        var cached = 0;
        var keys = Object.keys(data.processedTiles);
        for (var i = 0; i < keys.length; i++) {
            var tileKey = keys[i];
            var tileData = data.processedTiles[tileKey];
            if (!tileData) continue;
            var cacheKey = tileKey.replace('tile_', '').replace('_', ',');
            var type = tileData.type, colorBitmap = tileData.colorBitmap, userBitmap = tileData.userBitmap;
            var deltas = tileData.deltas, timestamp = tileData.timestamp;
            var current = cache.get(cacheKey) || {};
            try {
                if (type === 'full' && colorBitmap && userBitmap) {
                    closeBitmap(current.colorBitmap);
                    closeBitmap(current.userBitmap);
                    if (deltas && deltas.length > 0 && mw) {
                        // CASE 1: base image + deltas -> merge worker fills the bitmaps in.
                        cache.set(cacheKey, assign({}, current, { timestamp: timestamp, colorBitmap: null, userBitmap: null }));
                        mw.postMessage({ tileKey: cacheKey, colorBitmap: colorBitmap, userBitmap: userBitmap, deltas: deltas }, [colorBitmap, userBitmap]);
                    } else {
                        // CASE 2: plain full tile.
                        cache.set(cacheKey, assign({}, current, { timestamp: timestamp, colorBitmap: colorBitmap, userBitmap: userBitmap }));
                        cached++;
                    }
                } else if (type === 'delta' && deltas && deltas.length > 0) {
                    if (current.colorBitmap && current.userBitmap && mw && typeof createImageBitmap === 'function') {
                        // CASE 3: apply deltas to the cached bitmaps via the merge worker.
                        applyDeltasViaMergeWorker(cache, cacheKey, current, deltas, timestamp, mw);
                    }
                    // Not cached (e.g. evicted meanwhile): deliberately NOT the site's
                    // CASE 4 -- writing { timestamp } alone would create a zombie.
                }
                // 'delta' with no deltas: nothing changed; nothing to do.
            } catch (e) { /* one bad tile must not spoil the batch */ }
        }
        state.ringTilesCached += cached;
        if (cached > 0) scheduleRestore('ring');
        scheduleEvict('ring');
    }
    function applyDeltasViaMergeWorker(cache, cacheKey, current, deltas, timestamp, mw) {
        var oldColor = current.colorBitmap, oldUser = current.userBitmap;
        // Mark as mid-merge first (bitmaps null), exactly like the site does.
        cache.set(cacheKey, assign({}, current, { timestamp: timestamp, colorBitmap: null, userBitmap: null }));
        Promise.all([createImageBitmap(oldColor), createImageBitmap(oldUser)]).then(function (clones) {
            closeBitmap(oldColor);
            closeBitmap(oldUser);
            mw.postMessage({ tileKey: cacheKey, colorBitmap: clones[0], userBitmap: clones[1], deltas: deltas }, [clones[0], clones[1]]);
        }, function () {
            // Could not clone: put the originals back untouched.
            var e = cache.get(cacheKey);
            if (e && e.colorBitmap === null) cache.set(cacheKey, assign({}, e, { colorBitmap: oldColor, userBitmap: oldUser }));
        });
    }
    function assign(target) {
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i];
            if (!src) continue;
            for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
        }
        return target;
    }

    // One step of the ring loop: post the next batch if nothing is in flight
    // and the pacing gap has elapsed. Also the periodic home of the cache
    // budget check. Runs every second while attached (like the site's own
    // partial-sync timer) and is exposed for diagnostics/tests.
    function ringTick() {
        var now = Date.now();
        try { if (typeof document !== 'undefined' && document && document.hidden) return false; } catch (e) {}
        if (state.ringInFlight) {
            if (now - state.ringInFlight.at > RING_TIMEOUT_MS) finishRingBatch(true);   // worker never answered
            else return false;
        }
        if (now - state.lastRingBatchAt < RING_MIN_GAP_MS) return false;
        var batch = nextRingBatch(now);
        if (batch.length === 0) return false;
        return postRingBatch(batch);
    }
    function onTimer() {
        try { ringTick(); } catch (e) {}
        try { if (!state.evictPending) evict('tick'); } catch (e) {}
    }

    // ---------- max tile cache ----------

    function entryBytes(entry) {
        var cb = entry.colorBitmap, ub = entry.userBitmap;
        if (!cb || !ub) return 0;
        var cw = cb.width || 0, ch = cb.height || 0, uw = ub.width || 0, uh = ub.height || 0;
        return (cw * ch + uw * uh) * 4;
    }
    function cacheStats() {
        var cache = getCache();
        var tiles = 0, bytes = 0;
        if (cache) {
            var it = cache.values();
            for (var step = it.next(); !step.done; step = it.next()) {
                var b = entryBytes(step.value);
                if (b > 0) { tiles++; bytes += b; }
            }
        }
        return { tiles: tiles, bytes: bytes };
    }
    function closeBitmap(b) {
        try { if (b && typeof b.close === 'function') b.close(); } catch (e) {}
    }
    function dropGpuTile(key) {
        var layer = getLayer();
        try { if (layer && typeof layer.removeTile === 'function' && layer.tiles.has(key)) layer.removeTile(key); } catch (e) {}
        try { if (typeof tileTextureState !== 'undefined' && tileTextureState && typeof tileTextureState.delete === 'function') tileTextureState.delete(key); } catch (e) {}
    }

    // Returns the number of tiles evicted.
    function evict(reason) {
        if (!(state.maxCacheBytes > 0)) return 0;
        if (isSiteSyncing()) return 0;               // a response could still reference an evicted tile
        var m = getMap(), cache = getCache(), g = getGeometry();
        if (!m || !cache || !g || typeof m.getCenter !== 'function') return 0;
        var box = bufferBox(m, g);
        if (!box) return 0;
        var centre = centreTile(m, g);
        var total = 0, candidates = [];
        var it = cache.entries();
        for (var step = it.next(); !step.done; step = it.next()) {
            var key = step.value[0], entry = step.value[1];
            var bytes = entryBytes(entry);
            if (bytes === 0) continue;                // mid-merge or zombie: not ours to touch
            total += bytes;
            var origin = parseKey(key);
            if (!origin) continue;
            if (tileInBox(origin, box, g)) continue;  // on screen (or about to be): never evicted
            var dist = tileDistance(origin, centre, g);
            if (dist <= state.radius) continue;        // inside the fetch ring: keep
            candidates.push({ key: key, bytes: bytes, dist: dist });
        }
        if (total <= state.maxCacheBytes || candidates.length === 0) return 0;
        candidates.sort(function (a, b) { return b.dist - a.dist; });
        var evicted = 0;
        for (var i = 0; i < candidates.length && total > state.maxCacheBytes; i++) {
            var c = candidates[i];
            var e = cache.get(c.key);
            if (!e) continue;
            closeBitmap(e.colorBitmap);
            closeBitmap(e.userBitmap);
            cache.delete(c.key);
            dropGpuTile(c.key);
            delete state.requestedAt[c.key];
            total -= c.bytes;
            evicted++;
            state.evictedBytes += c.bytes;
        }
        state.evictions += evicted;
        return evicted;
    }
    function scheduleEvict(reason) {
        if (state.evictPending) return;
        state.evictPending = true;
        setTimeout(function () {
            state.evictPending = false;
            try { evict(reason); } catch (e) {}
        }, 0);
    }

    // ---------- wiring ----------

    // MapLibre fires 'move' on every camera frame -- pans AND zooms (a zoom
    // frame emits 'move' then 'zoom') -- so 'move' alone covers both the
    // zoom-back-in case and panning back over already-visited tiles.
    // 'moveend' guarantees a final check after inertia settles, and is the
    // natural moment to enforce the cache budget.
    function onMove() { scheduleRestore('move'); }
    function onMoveEnd() { scheduleRestore('moveend'); scheduleEvict('moveend'); try { ringTick(); } catch (e) {} }

    function attach() {
        if (state.attached) return true;
        var m = getMap();
        if (!m) return false;
        m.on('move', onMove);
        m.on('moveend', onMoveEnd);
        state.attached = true;
        state.attachedAt = Date.now();
        state.timer = setInterval(onTimer, 1000);
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
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
        state.attached = false;
    }

    function configure(opts) {
        if (!opts || typeof opts !== 'object') return getConfig();
        if (opts.radius !== undefined) {
            var r = Math.round(Number(opts.radius));
            if (isFinite(r)) state.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r));
        }
        if (opts.maxCacheBytes !== undefined) {
            var b = Number(opts.maxCacheBytes);
            state.maxCacheBytes = (isFinite(b) && b > 0) ? Math.floor(b) : 0;
            scheduleEvict('configure');
        }
        return getConfig();
    }
    function getConfig() {
        return { radius: state.radius, maxCacheBytes: state.maxCacheBytes };
    }

    window.__gpcImprovedMapRendering = {
        attach: attach,
        detach: detach,
        configure: configure,
        getConfig: getConfig,
        restore: function () { return restore('manual'); },
        evict: function () { return evict('manual'); },
        ringTick: function () { return ringTick(); },
        getStats: function () {
            var s = cacheStats();
            return {
                tiles: s.tiles,
                bytes: s.bytes,
                radius: state.radius,
                maxCacheBytes: state.maxCacheBytes,
                evictions: state.evictions,
                evictedBytes: state.evictedBytes,
                ringBatches: state.ringBatches,
                ringTilesRequested: state.ringTilesRequested,
                ringTilesCached: state.ringTilesCached,
                ringInFlight: !!state.ringInFlight
            };
        },
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

    // Converts the persisted settings into the bridge's units.
    function bridgeConfigFromSettings() {
        const radius = Number(_settings.improvedMapRenderingTileRadius);
        const gb = Number(_settings.improvedMapRenderingMaxCacheGB);
        return {
            radius: isFinite(radius) ? radius : 2,
            maxCacheBytes: (isFinite(gb) && gb > 0) ? Math.floor(gb * 1024 * 1024 * 1024) : 0,
        };
    }

    function applySettings() {
        try {
            const api = _pw[BRIDGE_API];
            if (api && typeof api.configure === 'function') api.configure(bridgeConfigFromSettings());
        } catch (err) {
            dbgPush(`Improved Map Rendering configure failed: ${err && err.message ? err.message : String(err)}`,
                { error: err, uiComponent: 'Improved Map Rendering' });
        }
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
    applySettings();
    attachWhenReady();

    // Lets the Settings modal apply radius / budget changes live.
    _improvedMapRendering = {
        applySettings,
        getStats() {
            try {
                const api = _pw[BRIDGE_API];
                return (api && typeof api.getStats === 'function') ? api.getStats() : null;
            } catch (err) { return null; }
        },
    };

            })();
            _featureStatus.extImprovedMapRendering = 'ok';
            console.log('[GeoPixelcons++] ✅ Improved Map Rendering loaded');
        } catch (err) {
            _featureStatus.extImprovedMapRendering = 'error';
            dbgPush(`Improved Map Rendering init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Improved Map Rendering' });
            console.error('[GeoPixelcons++] ❌ Improved Map Rendering failed:', err);
        }
    }
