// tests/improved-map-rendering.test.mjs
//
// Verifies the Improved Map Rendering extension two ways:
//   1. Contract checks against the built artifact and core.js: the feature is
//      registered, lives in the Map settings category, defaults to off, and
//      its two sub-settings are rendered inside the toggle's own row.
//   2. Behavioural checks that execute the REAL page-realm bridge source
//      (extracted from the feature file, never re-typed here) inside a vm
//      context that fakes exactly the GeoPixels globals it depends on:
//      map, pixelTileLayer, tileImageCache, tileTextureState, minZoom,
//      gridSize, SYNC_TILE_SIZE, turf, drawCachedTilesOnMap, synchronize,
//      ensureSyncWorker, syncWorker, isSyncing.
//      The fakes mirror the real contracts:
//        - drawCachedTilesOnMap (index.js ~549-655): early-return below
//          minZoom, upload every cached tile inside a buffer of 2x the
//          viewport (min 7 tiles), evict GPU textures outside it.
//        - synchronize (index.js ~299-505): bail if isSyncing or below
//          minZoom, build the 3x3 around the CENTRE tile ('full' = all nine
//          with timestamps, 'partial' = only never-seen ones), return early
//          with no worker message when that list is empty, otherwise post
//          {type:'sync-delta', tiles} and cache every tile the worker
//          returns, then draw.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const artifact = readFileSync(new URL('../dist/geopixelcons-library.js', import.meta.url), 'utf8');
const coreSource = readFileSync(new URL('../src/legacy/core.js', import.meta.url), 'utf8');
const featureSource = readFileSync(new URL('../src/legacy/features/ext-improved-map-rendering.js', import.meta.url), 'utf8');

const bridgeMatch = featureSource.match(/const BRIDGE_SOURCE = `([\s\S]*?)`;/);
assert.ok(bridgeMatch, 'expected the feature to expose its page-realm code as BRIDGE_SOURCE');
const BRIDGE_SOURCE = bridgeMatch[1];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 1. Contract
// ---------------------------------------------------------------------------

test('registers Improved Map Rendering as a Map-category extension', () => {
    assert.match(artifact, /EXTENSION: Improved Map Rendering \[extImprovedMapRendering\]/);
    assert.match(artifact, /if \(_settings\.extImprovedMapRendering\)/);
    assert.match(artifact, /key: 'extImprovedMapRendering', name: 'Improved Map Rendering', icon: '⚡'/);
    assert.match(artifact, /name: 'Map', keys: \[[^\]]*'extImprovedMapRendering'\]/);
    assert.match(artifact, /version: '2\.14\.0'/);
    assert.match(artifact, /Improved Map Rendering \(Map, off by default\)/);
    assert.match(artifact, /Improved Map Rendering: Tile loading radius setting/);
    assert.match(artifact, /Improved Map Rendering: Max tile cache \(GB\) setting/);
});

test('defaults Improved Map Rendering to disabled, radius 2 (5x5), 2 GB cache', () => {
    // Every EXTENSION_LIST entry except the pill hover labels defaults to
    // false; the new key must not be special-cased anywhere.
    assert.match(coreSource, /EXTENSION_LIST\.forEach\(f => DEFAULT_SETTINGS\[f\.key\] = f\.key === 'extPillHoverLabels' \? true : false\);/);
    assert.doesNotMatch(coreSource, /DEFAULT_SETTINGS\.extImprovedMapRendering\s*=/);
    assert.doesNotMatch(coreSource, /extImprovedMapRendering: true/);
    assert.match(coreSource, /improvedMapRenderingTileRadius: 2, improvedMapRenderingMaxCacheGB: 2/);
});

test('renders the sub-settings inside the toggle row, below it, only while enabled', () => {
    // Same row div as the toggle (flex-wrap + full-width child), not a sibling row.
    assert.match(coreSource, /const row = extensionRowsByKey\.get\('extImprovedMapRendering'\);/);
    assert.match(coreSource, /row\.style\.flexWrap = 'wrap';/);
    assert.match(coreSource, /panel\.id = 'gpp-imr-settings';/);
    assert.match(coreSource, /flex-basis: 100%; width: 100%;/);
    assert.match(coreSource, /row\.appendChild\(panel\);/);
    // Visibility bound to the toggle, both initially and on change.
    assert.match(coreSource, /display: \$\{_settings\.extImprovedMapRendering \? 'flex' : 'none'\}/);
    assert.match(coreSource, /panel\.style\.display = toggleInput\.checked \? 'flex' : 'none';/);
    // Max tile cache is a TEXT input in GB; radius is a 1..4 select (3x3..9x9), default 2.
    assert.match(coreSource, /gbInput\.id = 'gpp-imr-max-cache-gb';/);
    assert.match(coreSource, /gbInput\.type = 'text';/);
    assert.match(coreSource, /radiusSelect\.id = 'gpp-imr-tile-radius';/);
    assert.match(coreSource, /\[\[1, '3×3'\], \[2, '5×5'\], \[3, '7×7'\], \[4, '9×9'\]\]/);
    assert.match(coreSource, /readout\.id = 'gpp-imr-cache-readout';/);
    // Live-applied through the feature handle, and persisted.
    assert.match(coreSource, /let _improvedMapRendering = null;/);
    assert.match(coreSource, /if \(_improvedMapRendering\) _improvedMapRendering\.applySettings\(\);/);
    assert.match(featureSource, /_improvedMapRendering = \{/);
    // Theme compliance: no bare hex on the panel; every colour is a dark ternary.
    const panelBlock = coreSource.slice(coreSource.indexOf('attachImprovedMapRenderingSettings'), coreSource.indexOf("toggleInput.addEventListener('change'"));
    for (const hex of panelBlock.match(/#[0-9a-f]{6}/gi) || []) {
        const idx = panelBlock.indexOf(hex);
        assert.match(panelBlock.slice(Math.max(0, idx - 60), idx + 40), /dark \?/, `${hex} must be inside a dark ? ... : ... ternary`);
    }
    // Every element the panel creates carries a gpp- id.
    for (const m of panelBlock.matchAll(/\.id = '([^']+)'/g)) assert.ok(m[1].startsWith('gpp-'), `element id "${m[1]}" must start with gpp-`);
});

test('bridge hygiene: site functions only, no clear(), no bitmap writes, no rAF', () => {
    assert.match(BRIDGE_SOURCE, /drawCachedTilesOnMap\(\)/);
    assert.match(BRIDGE_SOURCE, /function needsDraw\(/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\.clear\(/);
    assert.doesNotMatch(BRIDGE_SOURCE, /tileImageCache\.set|cache\.set\(/);
    assert.doesNotMatch(BRIDGE_SOURCE, /setTile\(/);
    // The only cache deletion is inside the budgeted eviction, guarded by isSyncing.
    const evictBlock = BRIDGE_SOURCE.slice(BRIDGE_SOURCE.indexOf('function evict('), BRIDGE_SOURCE.indexOf('function scheduleEvict('));
    assert.match(evictBlock, /if \(isSiteSyncing\(\)\) return 0;/);
    assert.match(evictBlock, /cache\.delete\(c\.key\);/);
    assert.equal((BRIDGE_SOURCE.match(/cache\.delete\(/g) || []).length, 1, 'exactly one cache.delete, in evict()');
    assert.doesNotMatch(BRIDGE_SOURCE, /moveLayer\((?!\))/, 'must never call moveLayer itself (mentioning it in a comment is fine)');
    // Interpolation-free so the extracted source is exactly what runs in-page.
    assert.doesNotMatch(BRIDGE_SOURCE, /\$\{/);
    // rAF is paused in hidden documents / some embedded webviews; a pending
    // flag waiting on it would block every later restore (observed live).
    assert.doesNotMatch(BRIDGE_SOURCE, /requestAnimationFrame\s*\(/);
    assert.doesNotMatch(BRIDGE_SOURCE, /typeof requestAnimationFrame/);
    // Listens to camera movement, which covers zoom frames too.
    assert.match(BRIDGE_SOURCE, /m\.on\('move', onMove\)/);
    assert.match(BRIDGE_SOURCE, /m\.on\('moveend', onMoveEnd\)/);
    // Ring fetch rides on the site's own request/response path.
    assert.match(BRIDGE_SOURCE, /worker\.postMessage = function \(msg\)/);
    assert.match(BRIDGE_SOURCE, /window\.synchronize = function \(syncType\)/);
    assert.match(BRIDGE_SOURCE, /MAX_NEW_TILES_PER_SYNC = 16/);
    assert.match(BRIDGE_SOURCE, /MIN_RADIUS = 1, MAX_RADIUS = 4/);
});

// ---------------------------------------------------------------------------
// 2. Behaviour
// ---------------------------------------------------------------------------

// Real EPSG:3857 so the bridge's arithmetic is exercised on genuine numbers.
const R = 6378137;
const fakeTurf = {
    toMercator: ([lng, lat]) => [R * lng * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))],
    toWgs84: ([x, y]) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI],
};

const GRID = 25;             // metres per grid pixel   (index.js: let gridSize = 25)
const TILE_GRID = 1000;      // grid pixels per tile    (index.js: const SYNC_TILE_SIZE = 1000)
const TILE_M = GRID * TILE_GRID;               // 25 km
const MIN_BUFFER_M = 7 * TILE_M;               // 175 km, index.js MIN_BUFFER_METERS
const TILE_BYTES = 1000 * 1000 * 4 * 2;        // two 1000x1000 RGBA bitmaps per tile

// Nine tiles in a row along x: keys "0,0", "1000,0", ..., "8000,0".
// HOME sits over tile 1 and its 175 km buffer covers tiles 0-4;
// FAR sits over tile 8 and covers tiles 5-8. The two sets are disjoint.
const ROW_KEYS = Array.from({ length: 9 }, (_, i) => `${i * TILE_GRID},0`);
const HOME = [30000, 12500];
const FAR = [220000, 12500];
const HOME_SET = new Set(ROW_KEYS.slice(0, 5));
const FAR_SET = new Set(ROW_KEYS.slice(5));
const HOME_CENTRE = { x: 1000, y: 0 };         // centre tile for HOME, as synchronize() computes it

function tileMercBox(key) {
    const [ox, oy] = key.split(',').map(Number);
    const x0 = ox * GRID - GRID / 2, y0 = oy * GRID - GRID / 2;
    return { x0, y0, x1: x0 + TILE_M, y1: y0 + TILE_M };
}
function makeBitmap() { return { width: 1000, height: 1000, closed: false, close() { this.closed = true; } }; }
function ringKeys(centre, radius) {
    const keys = [];
    for (let i = -radius; i <= radius; i++) for (let j = -radius; j <= radius; j++) keys.push(`${centre.x + i * TILE_GRID},${centre.y + j * TILE_GRID}`);
    return keys;
}

function makeFakeSite({ renderLevel = 10.5, zoom = 14, cachedKeys = ROW_KEYS, resident = null, center = HOME, viewportM = 2000 } = {}) {
    const listeners = new Map();
    const map = {
        _zoom: zoom,
        _c: [...center],           // centre in mercator metres
        _vp: viewportM,            // viewport width/height in metres (buffer floor dominates)
        getZoom() { return this._zoom; },
        getCenter() { const [lng, lat] = fakeTurf.toWgs84(this._c); return { lng, lat }; },
        getBounds() {
            const [w, s] = fakeTurf.toWgs84([this._c[0] - this._vp / 2, this._c[1] - this._vp / 2]);
            const [e, n] = fakeTurf.toWgs84([this._c[0] + this._vp / 2, this._c[1] + this._vp / 2]);
            return { getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n };
        },
        on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
        off(type, fn) { listeners.get(type)?.delete(fn); },
        emit(type) { for (const fn of listeners.get(type) || []) fn(); },
        listenerCount(type) { return listeners.get(type)?.size || 0; },
    };
    const tileTextureState = new Map();
    const pixelTileLayer = {
        tiles: new Map(),
        hasTile(k) { return this.tiles.has(k); },
        removeTile(k) { this.tiles.delete(k); },
    };
    const tileImageCache = new Map();
    for (const key of cachedKeys) tileImageCache.set(key, { colorBitmap: makeBitmap(), userBitmap: makeBitmap(), timestamp: 1 });
    for (const key of (resident || cachedKeys)) { pixelTileLayer.tiles.set(key, { tex: {} }); tileTextureState.set(key, { timestamp: 1 }); }

    function bufferBox() {
        const w = Math.max(map._vp * 2, MIN_BUFFER_M), h = Math.max(map._vp * 2, MIN_BUFFER_M);
        return { minX: map._c[0] - w / 2, maxX: map._c[0] + w / 2, minY: map._c[1] - h / 2, maxY: map._c[1] + h / 2 };
    }

    const draws = [];
    let drawThrows = false;
    // Mirrors index.js drawCachedTilesOnMap: early-return below minZoom, then
    // evict outside the buffer / upload inside it.
    function drawCachedTilesOnMap() {
        draws.push({ zoom: map._zoom, cx: map._c[0] });
        if (drawThrows) throw new Error('boom');
        if (map._zoom < renderLevel) return;
        const b = bufferBox();
        for (const [key, e] of tileImageCache) {
            if (!e.colorBitmap || !e.userBitmap) continue;
            const t = tileMercBox(key);
            const outside = b.minX > t.x1 || b.maxX < t.x0 || b.minY > t.y1 || b.maxY < t.y0;
            if (outside) { pixelTileLayer.tiles.delete(key); tileTextureState.delete(key); }
            else { pixelTileLayer.tiles.set(key, { tex: {} }); tileTextureState.set(key, { timestamp: e.timestamp }); }
        }
    }

    // What the site's updateInterfaceState does on every zoom frame.
    map.on('zoom', () => { if (map._zoom < renderLevel && pixelTileLayer.tiles.size > 0) { pixelTileLayer.tiles.clear(); tileTextureState.clear(); } });

    // ---- sync worker + synchronize, mirroring index.js ----
    const worker = {
        messages: [],
        // The fake server: returns every requested tile unless overridden.
        server: (tiles) => tiles,
        postMessage(msg) {
            this.messages.push(msg);
            const returned = this.server(msg.tiles);
            setTimeout(() => this._resolve && this._resolve({ tiles: returned }), 0);
        },
    };
    const syncCalls = [];
    let serverTimestamp = 100;
    async function synchronize(syncType = 'partial') {
        syncCalls.push(syncType);
        if (context.isSyncing) return;
        if (map._zoom < renderLevel) return;
        context.isSyncing = true;
        try {
            const c = map.getCenter();
            const merc = fakeTurf.toMercator([c.lng, c.lat]);
            const cx = Math.floor(Math.round(merc[0] / GRID) / TILE_GRID) * TILE_GRID;
            const cy = Math.floor(Math.round(merc[1] / GRID) / TILE_GRID) * TILE_GRID;
            const tiles = [];
            for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
                const x = cx + i * TILE_GRID, y = cy + j * TILE_GRID;
                const cached = tileImageCache.get(`${x},${y}`);
                const timestamp = cached ? cached.timestamp : 0;       // index.js: cachedEntry ? cachedEntry.timestamp : 0
                if (syncType === 'full') tiles.push({ x, y, timestamp });
                else if (timestamp === 0) tiles.push({ x, y, timestamp: 0 });
            }
            if (tiles.length === 0) { context.isSyncing = false; return; }
            context.ensureSyncWorker();
            const result = await new Promise((resolve) => { worker._resolve = resolve; context.syncWorker.postMessage({ type: 'sync-delta', tiles, userID: 'u', tokenUser: 't' }); });
            serverTimestamp++;
            for (const t of result.tiles) {
                const key = `${t.x},${t.y}`;
                const cur = tileImageCache.get(key) || {};
                if (t.timestamp === 0) {
                    if (cur.colorBitmap) cur.colorBitmap.close();
                    if (cur.userBitmap) cur.userBitmap.close();
                    tileImageCache.set(key, { ...cur, timestamp: serverTimestamp, colorBitmap: makeBitmap(), userBitmap: makeBitmap() });
                } else if (cur.colorBitmap && cur.userBitmap) {
                    tileImageCache.set(key, { ...cur, timestamp: serverTimestamp });   // deltas applied (no-op here)
                } else {
                    tileImageCache.set(key, { ...cur, timestamp: serverTimestamp });   // CASE 4 zombie, exactly like the site
                }
            }
            drawCachedTilesOnMap();
        } finally {
            context.isSyncing = false;
        }
    }

    const context = {
        map, pixelTileLayer, tileImageCache, tileTextureState, drawCachedTilesOnMap,
        synchronize, ensureSyncWorker() { if (!context.syncWorker) context.syncWorker = worker; }, syncWorker: null, isSyncing: false,
        minZoom: renderLevel,
        userConfig: { renderLevel },
        gridSize: GRID, SYNC_TILE_SIZE: TILE_GRID, turf: fakeTurf,
        setTimeout, clearTimeout, Date, isFinite, isNaN, parseInt, Math, Number, Array, Object,
        // No requestAnimationFrame on purpose: the bridge must work in a
        // document whose rAF is paused (hidden tab, embedded webview).
    };
    context.window = context;
    vm.createContext(context);

    return {
        context, map, pixelTileLayer, tileImageCache, tileTextureState, draws, worker, syncCalls,
        setDrawThrows(v) { drawThrows = v; },
        install() { vm.runInContext(BRIDGE_SOURCE, context, { filename: 'improved-map-rendering-bridge.js' }); return context.__gpcImprovedMapRendering; },
        // MapLibre emits 'move' on every camera frame, then 'zoom' when zooming.
        zoomTo(z) { map._zoom = z; map.emit('move'); map.emit('zoom'); },
        panTo(x, y = map._c[1]) { map._c = [x, y]; map.emit('move'); },
        settle() { map.emit('moveend'); },
        siteTick() { drawCachedTilesOnMap(); },   // the site's own 5 s full-sync draw
        gpuKeys() { return new Set(pixelTileLayer.tiles.keys()); },
        // Calls whatever `synchronize` currently is in the page (the bridge's wrapper once hooked).
        async sync(type) { await context.synchronize(type); await sleep(5); },
        lastRequest() { return worker.messages[worker.messages.length - 1]; },
        cachedKeys() { return new Set([...tileImageCache.entries()].filter(([, e]) => e.colorBitmap && e.userBitmap).map(([k]) => k)); },
    };
}

const setEq = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));

// ---- restore -------------------------------------------------------------

test('restores the canvas from memory as soon as zoom crosses back above the render level', async () => {
    const site = makeFakeSite({ resident: [...HOME_SET] });
    const api = site.install();
    assert.equal(api.attach(), true);

    site.zoomTo(10.0);                       // below 10.5: site clears GPU textures
    await sleep(20);
    assert.equal(site.pixelTileLayer.tiles.size, 0);
    assert.deepEqual(site.draws, [], 'must not redraw while still below the render level');

    site.zoomTo(14.0);                       // back above: hook should trigger the redraw
    await sleep(20);
    assert.equal(site.draws.length, 1, 'exactly one redraw');
    assert.equal(site.draws[0].zoom, 14);
    assert.ok(setEq(site.gpuKeys(), HOME_SET), 'the visible tiles are back on the GPU');
    assert.equal(api.getState().restores, 1);

    site.zoomTo(15.0);                       // further zoom with textures resident: no-op
    await sleep(20);
    assert.equal(site.draws.length, 1);
});

test('restores evicted tiles when panning back over an area already visited', async () => {
    const site = makeFakeSite({ resident: [...HOME_SET] });
    const api = site.install();
    api.attach();

    // Pan far away. The site's next sync tick uploads the far tiles and
    // evicts the home tiles from the GPU; the bridge must not fight that.
    site.panTo(FAR[0]); site.settle();
    await sleep(20);
    assert.equal(site.draws.length, 1, 'far tiles were cached but not resident, so one draw is legitimate');
    site.siteTick();
    assert.ok(setEq(site.gpuKeys(), FAR_SET), 'site evicted home, uploaded far');
    const drawsBefore = site.draws.length;

    // Pan home again: home tiles are cached but gone from the GPU. (150 ms
    // rather than 20 because the previous restore was moments ago and the
    // bridge deliberately defers a second one past MIN_RESTORE_GAP_MS.)
    site.panTo(HOME[0]); site.settle();
    await sleep(150);
    assert.equal(site.draws.length, drawsBefore + 1, 'one redraw on returning home');
    assert.ok(setEq(site.gpuKeys(), HOME_SET), 'home tiles are back, far tiles evicted');
    assert.equal(api.getState().lastReason, 'move');
});

test('does not call the site draw while panning across tiles that are already resident', async () => {
    // drawCachedTilesOnMap() calls map.moveLayer(), which forces a full label
    // placement pass. Panning around inside the resident area must therefore
    // never reach it.
    const site = makeFakeSite({ resident: [...HOME_SET] });
    const api = site.install();
    api.attach();

    // Pan WEST, away from the cached-but-not-resident far tiles, so nothing
    // new can enter the buffer.
    for (let x = HOME[0]; x >= HOME[0] - 40000; x -= 500) site.panTo(x);   // 80 pan frames, ~40 km
    site.settle();
    await sleep(150);
    assert.deepEqual(site.draws, [], 'no draw: nothing new entered the buffer');
    assert.ok(api.getState().checks > 0, 'the bridge did evaluate the frames');
    assert.equal(api.getState().restores, 0);
});

test('draws once when a missing tile enters the buffer mid-drag, not on every frame', async () => {
    const site = makeFakeSite({ resident: [...HOME_SET] });
    site.install().attach();

    let firstDrawAtX = null;
    for (let x = HOME[0]; x <= HOME[0] + 30000; x += 1000) {
        site.panTo(x);
        await sleep(5);
        if (site.draws.length && firstDrawAtX === null) firstDrawAtX = x;
    }
    site.settle();
    await sleep(150);
    assert.equal(site.draws.length, 1, 'exactly one draw for the whole drag');
    // tile 5 starts at x0 = 5*25000 - 12.5; it enters the buffer once
    // centre + 87500 >= x0, i.e. centre >= ~37487.5
    assert.ok(firstDrawAtX >= 37000 && firstDrawAtX <= 39000, `draw fired at centre x=${firstDrawAtX}`);
    assert.ok(site.gpuKeys().has(ROW_KEYS[5]));
});

test('coalesces a burst of camera frames into a single redraw', async () => {
    const site = makeFakeSite({ resident: [...HOME_SET] });
    site.install().attach();
    site.zoomTo(9.0);
    await sleep(20);
    for (let z = 10.6; z <= 13; z += 0.2) site.zoomTo(z);   // 13 frames in one tick
    site.settle();
    await sleep(20);
    assert.equal(site.draws.length, 1);
});

test('throttles rapid re-crossings but still restores the final state', async () => {
    const site = makeFakeSite({ resident: [...HOME_SET] });
    site.install().attach();

    site.zoomTo(9.0); await sleep(20);
    site.zoomTo(14.0); await sleep(20);
    assert.equal(site.draws.length, 1);

    site.zoomTo(9.0); await sleep(5);
    site.zoomTo(14.0); await sleep(20);
    assert.equal(site.draws.length, 1, 'second restore is deferred, not stacked');
    assert.equal(site.pixelTileLayer.tiles.size, 0);

    await sleep(150);
    assert.equal(site.draws.length, 2, 'trailing restore fires once the gap has elapsed');
    assert.ok(setEq(site.gpuKeys(), HOME_SET));
});

test('does nothing when there is nothing cached to bring back', async () => {
    const site = makeFakeSite({ cachedKeys: [] });
    site.install().attach();
    site.zoomTo(9.0); await sleep(20);
    site.zoomTo(14.0); site.settle(); await sleep(20);
    assert.deepEqual(site.draws, []);
});

test('falls back to userConfig.renderLevel when minZoom is unavailable', async () => {
    const site = makeFakeSite({ renderLevel: 8, resident: [...HOME_SET] });
    delete site.context.minZoom;
    site.install().attach();
    site.zoomTo(7.5); await sleep(20);
    assert.equal(site.pixelTileLayer.tiles.size, 0);
    site.zoomTo(7.9); await sleep(20);
    assert.deepEqual(site.draws, [], 'still below the configured level');
    site.zoomTo(8.0); await sleep(20);
    assert.equal(site.draws.length, 1);
    assert.equal(site.draws[0].zoom, 8.0);
});

test('stays conservative when the geometry globals are missing', async () => {
    const site = makeFakeSite({ resident: [...HOME_SET] });
    delete site.context.turf;
    site.install().attach();

    site.pixelTileLayer.tiles.delete(ROW_KEYS[1]);      // one visible tile missing, others resident
    site.panTo(HOME[0] + 100); site.settle();
    await sleep(20);
    assert.deepEqual(site.draws, [], 'partial residency is ambiguous without geometry: no draw');

    site.zoomTo(9.0); await sleep(20);                   // site clears everything
    site.zoomTo(14.0); await sleep(20);
    assert.equal(site.draws.length, 1, 'empty GPU is unambiguous: draw');
});

test('survives a throwing drawCachedTilesOnMap without breaking later restores', async () => {
    const site = makeFakeSite({ resident: [...HOME_SET] });
    const api = site.install();
    api.attach();
    site.setDrawThrows(true);
    site.zoomTo(9.0); await sleep(20);
    assert.doesNotThrow(() => site.zoomTo(14.0));
    await sleep(20);
    assert.equal(site.draws.length, 1);
    assert.equal(api.getState().restores, 0, 'a failed draw is not counted as a restore');

    site.setDrawThrows(false);
    site.zoomTo(9.0); await sleep(20);
    site.zoomTo(14.0); await sleep(150);
    assert.ok(setEq(site.gpuKeys(), HOME_SET));
    assert.equal(api.getState().restores, 1);
});

test('attach waits safely for the map, installs listeners once, and hooks the sync path', () => {
    const site = makeFakeSite();
    const api = site.install();
    const realMap = site.context.map;
    const siteSync = site.context.synchronize;

    delete site.context.map;                 // site init() has not created map yet
    assert.equal(api.attach(), false);
    assert.equal(api.getState().attached, false);
    assert.equal(site.context.synchronize, siteSync, 'nothing hooked before the map exists');

    site.context.map = realMap;
    assert.equal(api.attach(), true);
    assert.equal(api.attach(), true);        // idempotent
    assert.equal(realMap.listenerCount('move'), 1);
    assert.equal(realMap.listenerCount('moveend'), 1);
    assert.equal(realMap.listenerCount('zoom'), 1, 'only the site handler; the bridge relies on move');
    assert.notEqual(site.context.synchronize, siteSync, 'synchronize is wrapped');
    assert.ok(site.context.syncWorker, 'the worker was created so its postMessage could be wrapped');
    assert.equal(api.getState().syncHooked, true);

    // Re-running the bridge source (e.g. a second install attempt) is a no-op.
    vm.runInContext(BRIDGE_SOURCE, site.context);
    assert.equal(realMap.listenerCount('move'), 1);

    api.detach();
    assert.equal(realMap.listenerCount('move'), 0);
    assert.equal(realMap.listenerCount('moveend'), 0);
});

test('manual restore() honours the same guards as the hook', () => {
    const site = makeFakeSite({ resident: [...HOME_SET] });
    const api = site.install();
    assert.equal(api.restore(), false, 'every visible tile already resident');
    site.pixelTileLayer.tiles.clear();
    site.map._zoom = 9;
    assert.equal(api.restore(), false, 'below render level');
    site.map._zoom = 12;
    assert.equal(api.restore(), true);
    assert.ok(setEq(site.gpuKeys(), HOME_SET));
    assert.equal(api.getState().lastReason, 'manual');
});

// ---- tile loading radius --------------------------------------------------

test('configure() clamps radius to 1..4 and the cache budget to >= 0', () => {
    const site = makeFakeSite();
    const api = site.install();
    // (field-wise: objects from the vm realm have a different Object prototype)
    assert.equal(api.getConfig().radius, 2, 'bridge default: 5x5');
    assert.equal(api.getConfig().maxCacheBytes, 0, 'bridge default: no limit until configured');
    assert.equal(api.configure({ radius: 0 }).radius, 1);
    assert.equal(api.configure({ radius: 9 }).radius, 4);
    assert.equal(api.configure({ radius: 2.6 }).radius, 3);
    assert.equal(api.configure({ radius: 'nope' }).radius, 3, 'garbage leaves the value alone');
    assert.equal(api.configure({ maxCacheBytes: -5 }).maxCacheBytes, 0);
    assert.equal(api.configure({ maxCacheBytes: 1.5e9 }).maxCacheBytes, 1500000000);
});

test('expands a full sync from the site 3x3 to the configured ring, nearest first', async () => {
    const site = makeFakeSite({ cachedKeys: [] });
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });

    await site.sync('full');
    const req = site.lastRequest();
    assert.equal(req.tiles.length, 25, '3x3 from the site + 16 ring tiles');
    assert.ok(req.tiles.every((t) => t.timestamp === 0), 'nothing cached yet, so everything is a fresh request');
    assert.ok(setEq(new Set(req.tiles.map((t) => `${t.x},${t.y}`)), new Set(ringKeys(HOME_CENTRE, 2))));
    // The site's own 9 come first, untouched; the ring is appended.
    assert.deepEqual(req.tiles.slice(0, 9).map((t) => `${t.x},${t.y}`).sort(), ringKeys(HOME_CENTRE, 1).sort());
    assert.equal(site.cachedKeys().size, 25, 'the site response loop cached every returned tile');
    assert.equal(api.getStats().ringFetches, 1);
    assert.equal(api.getStats().ringTilesRequested, 16);

    // Next full sync: every ring tile is cached, so it is sent WITH its timestamp (updates flow to the ring too).
    await site.sync('full');
    const req2 = site.lastRequest();
    assert.equal(req2.tiles.length, 25);
    assert.ok(req2.tiles.every((t) => t.timestamp > 0));
});

test('radius 1 leaves the site request untouched; radius 4 fills a 9x9 progressively, 16 new tiles per sync', async () => {
    const site = makeFakeSite({ cachedKeys: [] });
    const api = site.install(); api.attach();

    api.configure({ radius: 1 });
    await site.sync('full');
    assert.equal(site.lastRequest().tiles.length, 9);
    assert.equal(api.getStats().ringFetches, 0);

    api.configure({ radius: 4 });
    await site.sync('full');
    assert.equal(site.lastRequest().tiles.length, 9 + 16, 'capped: 16 uncached ring tiles per request');
    // Nearest first: this batch must be exactly the d=2 ring (16 tiles).
    const d2 = new Set(ringKeys(HOME_CENTRE, 2).filter((k) => !ringKeys(HOME_CENTRE, 1).includes(k)));
    assert.ok(setEq(new Set(site.lastRequest().tiles.slice(9).map((t) => `${t.x},${t.y}`)), d2));

    // Subsequent partial syncs would normally return early (centre 3x3 cached);
    // the bridge promotes them to full while the ring is incomplete.
    let syncs = 0;
    while (site.cachedKeys().size < 81 && syncs < 10) { await site.sync('partial'); syncs++; }
    assert.equal(site.cachedKeys().size, 81, 'the whole 9x9 arrived');
    assert.equal(syncs, 4, '24 + 32 remaining tiles at 16 per sync = 4 more syncs');
    assert.equal(api.getStats().promotions, 4);
    assert.deepEqual(site.syncCalls.slice(-4), ['full', 'full', 'full', 'full'], 'the fake site saw full syncs');

    await site.sync('partial');
    assert.equal(site.syncCalls[site.syncCalls.length - 1], 'partial', 'ring complete: no more promotion');
    assert.equal(api.getStats().promotions, 4);
});

test('preserves the site partial-sync semantics once the ring is complete', async () => {
    // Ring fully cached except one tile of the site's OWN 3x3: the site's
    // partial sync requests exactly that tile, and the bridge must neither
    // promote it to a full sync nor pad the request with cached ring tiles.
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 2).filter((k) => k !== '0,0') });
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });

    await site.sync('partial');
    const req = site.lastRequest();
    assert.deepEqual(req.tiles.map((t) => `${t.x},${t.y}`), ['0,0']);
    assert.equal(req.tiles[0].timestamp, 0);
    assert.equal(site.syncCalls[site.syncCalls.length - 1], 'partial', 'not promoted: nothing beyond the 3x3 is missing');
    assert.equal(api.getStats().promotions, 0);
    assert.equal(api.getStats().ringFetches, 0);
});

test('promotes a partial sync to full only when a tile BEYOND the 3x3 is unrequested', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 2).filter((k) => k !== '3000,2000') });
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });

    await site.sync('partial');
    assert.equal(site.syncCalls[site.syncCalls.length - 1], 'full', 'promoted: a d=2 ring tile is missing');
    const keys = site.lastRequest().tiles.map((t) => `${t.x},${t.y}`);
    assert.equal(keys.length, 25, 'the full request carries the whole ring');
    const missing = site.lastRequest().tiles.find((t) => t.x === 3000 && t.y === 2000);
    assert.equal(missing.timestamp, 0, 'the missing tile is a fresh request');
    assert.ok(site.lastRequest().tiles.filter((t) => t !== missing).every((t) => t.timestamp > 0), 'cached ring tiles carry timestamps');
    assert.equal(api.getStats().promotions, 1);
    assert.equal(site.cachedKeys().size, 25);
});

test('a tile the server never returns is not re-requested every second', async () => {
    const site = makeFakeSite({ cachedKeys: [] });
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });
    site.worker.server = (tiles) => tiles.filter((t) => `${t.x},${t.y}` !== '3000,2000');   // one ring tile "missing" upstream

    await site.sync('full');
    assert.equal(site.cachedKeys().size, 24);
    const requestsAfterFirst = site.worker.messages.length;

    // Many partial ticks: the centre 3x3 is cached, the one hole was requested
    // moments ago, so no promotion and no request at all.
    for (let i = 0; i < 5; i++) await site.sync('partial');
    assert.equal(site.worker.messages.length, requestsAfterFirst, 'no requests during the cooldown');
    assert.equal(api.getStats().promotions, 0);
    assert.ok(site.syncCalls.slice(-5).every((t) => t === 'partial'));

    // A site-initiated full sync during the cooldown does not re-add it either.
    await site.sync('full');
    assert.ok(!site.lastRequest().tiles.some((t) => t.x === 3000 && t.y === 2000));
});

test('re-requests timestamp-only zombie entries as full tiles, but leaves mid-merge entries alone', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 2) });
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });
    // CASE 4 in synchronize(): { timestamp } with no bitmap fields at all.
    site.tileImageCache.set('3000,2000', { timestamp: 77 });
    // Mid-merge: the site sets bitmaps to null explicitly while the merge worker runs.
    site.tileImageCache.set('3000,1000', { timestamp: 78, colorBitmap: null, userBitmap: null });

    await site.sync('full');
    const byKey = Object.fromEntries(site.lastRequest().tiles.map((t) => [`${t.x},${t.y}`, t.timestamp]));
    assert.equal(byKey['3000,2000'], 0, 'zombie is asked for as a full tile');
    assert.equal(byKey['3000,1000'], 78, 'mid-merge keeps its timestamp');
});

test('does not request anything below the render level', async () => {
    const site = makeFakeSite({ cachedKeys: [] });
    const api = site.install(); api.attach();
    api.configure({ radius: 3 });
    site.map._zoom = 9;
    await site.sync('full');
    await site.sync('partial');
    assert.equal(site.worker.messages.length, 0);
    assert.equal(api.getStats().promotions, 0);
});

// ---- max tile cache -----------------------------------------------------

test('evicts the farthest off-screen tiles once the cache exceeds the budget, closing their bitmaps', () => {
    // 5 home tiles (in buffer) + 5 far tiles (outside buffer and ring): 10 x 8 MB.
    const farKeys = ['6000,0', '7000,0', '8000,0', '9000,0', '10000,0'];
    const site = makeFakeSite({ cachedKeys: [...HOME_SET, ...farKeys], resident: [...HOME_SET, '9000,0'] });
    const api = site.install(); api.attach();
    site.tileTextureState.set('9000,0', { timestamp: 1 });
    const before = { ...site.tileImageCache.get('10000,0') };

    api.configure({ radius: 2 });
    assert.equal(api.evict(), 0, 'no budget configured: nothing evicted');

    api.configure({ maxCacheBytes: 7 * TILE_BYTES });
    const evicted = api.evict();
    assert.equal(evicted, 3, '10 tiles -> 7 tiles');
    assert.ok(setEq(site.cachedKeys(), new Set([...HOME_SET, '6000,0', '7000,0'])), 'farthest three gone, nearest far tiles kept');
    assert.equal(before.colorBitmap.closed, true, 'evicted bitmaps are closed');
    assert.equal(before.userBitmap.closed, true);
    assert.equal(site.pixelTileLayer.tiles.has('9000,0'), false, 'a stray GPU texture for an evicted tile is dropped');
    assert.equal(site.tileTextureState.has('9000,0'), false);
    assert.ok(setEq(site.gpuKeys(), HOME_SET), 'on-screen textures untouched');
    assert.equal(api.getStats().evictions, 3);
    assert.equal(api.getStats().evictedBytes, 3 * TILE_BYTES);
    assert.equal(api.getStats().tiles, 7);
    assert.equal(api.getStats().bytes, 7 * TILE_BYTES);
});

test('never evicts tiles on screen or inside the fetch ring, even when over budget', () => {
    // Everything cached is either in the buffer or in the 5x5 ring around HOME.
    const site = makeFakeSite({ cachedKeys: [...HOME_SET, ...ringKeys(HOME_CENTRE, 2)] });
    const api = site.install(); api.attach();
    api.configure({ radius: 2, maxCacheBytes: 1 * TILE_BYTES });    // absurdly small budget
    assert.equal(api.evict(), 0);
    assert.equal(api.getStats().tiles, new Set([...HOME_SET, ...ringKeys(HOME_CENTRE, 2)]).size);
});

test('never evicts while the site has a sync in flight, and ignores mid-merge entries', () => {
    const farKeys = ['6000,0', '7000,0', '8000,0'];
    const site = makeFakeSite({ cachedKeys: [...HOME_SET, ...farKeys] });
    const api = site.install(); api.attach();
    api.configure({ maxCacheBytes: 5 * TILE_BYTES });

    site.context.isSyncing = true;
    assert.equal(api.evict(), 0, 'a response could still reference an evicted tile');
    site.context.isSyncing = false;

    // A far tile mid-merge (bitmaps null) is neither counted nor evictable.
    site.tileImageCache.set('8000,0', { timestamp: 5, colorBitmap: null, userBitmap: null });
    assert.equal(api.evict(), 2, 'only the two real far tiles can go');
    assert.ok(site.tileImageCache.has('8000,0'), 'mid-merge entry left for the merge worker');
});

test('enforces the budget automatically after a sync settles and on moveend', async () => {
    // The site's own 3x3 around HOME fully cached (so a partial sync only ever
    // asks for what the test removes), plus four far tiles: 13 tiles.
    const farKeys = ['6000,0', '7000,0', '8000,0', '9000,0'];
    const site = makeFakeSite({ cachedKeys: [...ringKeys(HOME_CENTRE, 1), ...farKeys] });
    const api = site.install(); api.attach();
    api.configure({ radius: 1, maxCacheBytes: 10 * TILE_BYTES });
    await sleep(5);                                              // configure() schedules one pass
    assert.equal(api.getStats().tiles, 10, 'configure() itself brought the cache under budget');
    assert.ok(setEq(site.cachedKeys(), new Set([...ringKeys(HOME_CENTRE, 1), '6000,0'])), 'three farthest gone');

    site.tileImageCache.set('12000,0', { colorBitmap: makeBitmap(), userBitmap: makeBitmap(), timestamp: 1 });
    site.settle(); await sleep(5);
    assert.equal(api.getStats().tiles, 10, 'moveend evicted the newcomer (it is the farthest)');
    assert.ok(!site.tileImageCache.has('12000,0'));

    site.tileImageCache.set('12000,0', { colorBitmap: makeBitmap(), userBitmap: makeBitmap(), timestamp: 1 });
    site.tileImageCache.delete('0,0');                            // make the site request a tile so a sync actually runs
    await site.sync('partial'); await sleep(5);
    assert.deepEqual(site.lastRequest().tiles.map((t) => `${t.x},${t.y}`), ['0,0'], 'only the site request; radius 1 adds nothing');
    assert.equal(api.getStats().tiles, 10, 'the pass after the sync settled evicted again');
    assert.ok(site.tileImageCache.has('0,0'), 'the freshly synced on-screen tile is of course kept');
    assert.ok(!site.tileImageCache.has('12000,0'));
});
