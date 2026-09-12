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
//      gridSize, SYNC_TILE_SIZE, turf, drawCachedTilesOnMap, isSyncing,
//      Worker (the sync-worker the ring loader instantiates), mergeWorker /
//      ensureMergeWorker, createImageBitmap, document.hidden, and a
//      controllable Date so pacing/cooldowns can be tested instantly.
//      The fakes mirror the real contracts:
//        - drawCachedTilesOnMap (index.js ~549-655): early-return below
//          minZoom, upload every cached tile inside a buffer of 2x the
//          viewport (min 7 tiles), evict GPU textures outside it.
//        - sync-worker (js/sync-worker.js): receives {type:'sync-delta',
//          tiles}, answers ONE message {ok, processedTiles:{tile_X_Y:{type,
//          colorBitmap,userBitmap,deltas,timestamp}}}; the fake server
//          enforces the real 9-tile cap (HTTP 413 -> ok:false).
//        - mergeWorker (index.js ~3504-3530): receives {tileKey,colorBitmap,
//          userBitmap,deltas}, answers with merged bitmaps which the site's
//          own handler writes back into tileImageCache and then draws.

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
    assert.doesNotMatch(BRIDGE_SOURCE, /tileImageCache\.set/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\.setTile\(/, 'never uploads itself; it only guards the site upload');
    assert.match(BRIDGE_SOURCE, /function installUploadGuard\(/);
    assert.match(BRIDGE_SOURCE, /layer\.setTile = guarded;/);
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
    // The ring loader must never touch the site's own sync path: the server
    // caps a request at 9 tiles, so padding the site's request would 413 it.
    assert.doesNotMatch(BRIDGE_SOURCE, /window\.synchronize\s*=/);
    assert.doesNotMatch(BRIDGE_SOURCE, /syncWorker/);
    assert.match(BRIDGE_SOURCE, /RING_BATCH_SIZE = 9;/);
    assert.match(BRIDGE_SOURCE, /new Worker\(SYNC_WORKER_URL\)/);
    assert.match(BRIDGE_SOURCE, /SYNC_WORKER_URL = '\/js\/sync-worker\.js'/);
    assert.match(BRIDGE_SOURCE, /MIN_RADIUS = 1, MAX_RADIUS = 4/);
    // Ring responses go through the site's merge worker for deltas and never
    // write a timestamp-only entry (the site's zombie-making CASE 4).
    const ringBlock = BRIDGE_SOURCE.slice(BRIDGE_SOURCE.indexOf('function onRingWorkerMessage('), BRIDGE_SOURCE.indexOf('function assign('));
    assert.match(ringBlock, /mw\.postMessage\(\{ tileKey: cacheKey/);
    assert.doesNotMatch(ringBlock, /\{ timestamp: timestamp \}\)/);
    // The ring loader's own cache.set calls are confined to that response handler.
    const setCount = (BRIDGE_SOURCE.match(/cache\.set\(/g) || []).length;
    const setInRing = (ringBlock.match(/cache\.set\(/g) || []).length;
    assert.equal(setCount, setInRing, 'cache.set only in the ring response handler');
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
        uploads: [],
        hasTile(k) { return this.tiles.has(k); },
        removeTile(k) { this.tiles.delete(k); },
        setTile(k, source, corners) { this.uploads.push(k); this.tiles.set(k, { tex: {} }); },
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
            else { pixelTileLayer.setTile(key, e.colorBitmap, []); tileTextureState.set(key, { timestamp: e.timestamp }); }
        }
    }

    // What the site's updateInterfaceState does on every zoom frame.
    map.on('zoom', () => { if (map._zoom < renderLevel && pixelTileLayer.tiles.size > 0) { pixelTileLayer.tiles.clear(); tileTextureState.clear(); } });

    // ---- ring loader collaborators, mirroring js/sync-worker.js and the merge worker ----
    let serverTimestamp = 100;
    const workers = [];
    class FakeWorker {
        constructor(url) {
            this.url = url; this.listeners = new Map(); this.messages = []; workers.push(this);
        }
        addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
        _emit(type, data) { for (const fn of this.listeners.get(type) || []) fn({ data }); }
        postMessage(msg) {
            this.messages.push(msg);
            if (!msg || msg.type !== 'sync-delta') return;
            const respond = () => {
                if (msg.tiles.length > 9) { this._emit('message', { ok: false, error: 'GetPixelsCached returned 413' }); return; }
                const returned = fake.server(msg.tiles);
                serverTimestamp++;
                const processedTiles = {};
                for (const t of returned) {
                    const key = `tile_${t.x}_${t.y}`;
                    if (t.timestamp === 0) processedTiles[key] = { type: 'full', colorBitmap: makeBitmap(), userBitmap: makeBitmap(), deltas: fake.deltasFor(t), timestamp: serverTimestamp };
                    else processedTiles[key] = { type: 'delta', deltas: fake.deltasFor(t), timestamp: serverTimestamp };
                }
                this._emit('message', { ok: true, processedTiles, users: [], userData: null });
            };
            if (fake.autoRespond) setTimeout(respond, 0); else fake.pendingResponses.push(respond);
        }
    }
    const fake = { server: (tiles) => tiles, deltasFor: () => [], autoRespond: true, pendingResponses: [] };

    const mergeWorker = {
        messages: [],
        postMessage(msg, transfer) {
            this.messages.push({ msg, transfer });
            // The site's onmessage handler: cache the merged bitmaps, then draw.
            setTimeout(() => {
                const entry = tileImageCache.get(msg.tileKey) || {};
                tileImageCache.set(msg.tileKey, { ...entry, colorBitmap: makeBitmap(), userBitmap: makeBitmap() });
                drawCachedTilesOnMap();
            }, 0);
        },
    };

    // A clock the tests can advance so pacing and cooldowns are testable instantly.
    let nowMs = 1_000_000;
    const FakeDate = { now: () => nowMs };

    const documentFake = { hidden: false };
    const context = {
        map, pixelTileLayer, tileImageCache, tileTextureState, drawCachedTilesOnMap,
        isSyncing: false,
        Worker: FakeWorker, mergeWorker, ensureMergeWorker() {}, createImageBitmap: async (b) => makeBitmap(),
        document: documentFake,
        minZoom: renderLevel,
        userConfig: { renderLevel },
        gridSize: GRID, SYNC_TILE_SIZE: TILE_GRID, turf: fakeTurf,
        setTimeout, clearTimeout, clearInterval, Date: FakeDate, Promise, isFinite, isNaN, parseInt, Math, Number, Array, Object,
        // unref'd so a test that attaches without detaching cannot keep the process alive
        setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref(); return t; },
        // No requestAnimationFrame on purpose: the bridge must work in a
        // document whose rAF is paused (hidden tab, embedded webview).
    };
    context.window = context;
    vm.createContext(context);

    return {
        context, map, pixelTileLayer, tileImageCache, tileTextureState, draws, fake, mergeWorker, workers,
        setDrawThrows(v) { drawThrows = v; },
        advance(ms) { nowMs += ms; },
        now() { return nowMs; },
        install() { vm.runInContext(BRIDGE_SOURCE, context, { filename: 'improved-map-rendering-bridge.js' }); return context.__gpcImprovedMapRendering; },
        // MapLibre emits 'move' on every camera frame, then 'zoom' when zooming.
        zoomTo(z) { map._zoom = z; map.emit('move'); map.emit('zoom'); },
        panTo(x, y = map._c[1]) { map._c = [x, y]; map.emit('move'); },
        settle() { map.emit('moveend'); },
        siteTick() { drawCachedTilesOnMap(); },   // the site's own 5 s full-sync draw
        gpuKeys() { return new Set(pixelTileLayer.tiles.keys()); },
        ringWorker() { return workers[0] || null; },
        requests() { return workers.flatMap((w) => w.messages); },
        lastRequest() { const r = this.requests(); return r[r.length - 1]; },
        // Drives the ring loop like the bridge's own 1 s timer would, then lets the fake worker answer.
        async tick(api) { const posted = api.ringTick(); await sleep(5); return posted; },
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
    api.attach(); api.configure({ radius: 1 });          // restore only; the ring loader has its own tests

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
    api.attach(); api.configure({ radius: 1 });

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
    const api = site.install(); api.attach(); api.configure({ radius: 1 });

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
    const api = site.install(); api.attach(); api.configure({ radius: 1 });
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

test('attach waits safely for the map and installs listeners exactly once', () => {
    const site = makeFakeSite();
    const api = site.install();
    const realMap = site.context.map;

    delete site.context.map;                 // site init() has not created map yet
    assert.equal(api.attach(), false);
    assert.equal(api.getState().attached, false);

    site.context.map = realMap;
    assert.equal(api.attach(), true);
    assert.equal(api.attach(), true);        // idempotent
    assert.equal(realMap.listenerCount('move'), 1);
    assert.equal(realMap.listenerCount('moveend'), 1);
    assert.equal(realMap.listenerCount('zoom'), 1, 'only the site handler; the bridge relies on move');
    assert.equal(site.workers.length, 0, 'the ring worker is created lazily, on the first batch');

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

test('loads the 5x5 ring through its own worker in 9-tile batches, nearest first, one in flight', async () => {
    // The site's own 3x3 is cached (its sync handles that); the ring beyond it is not.
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 1) });
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });

    assert.equal(await site.tick(api), true, 'a batch went out');
    assert.equal(site.workers.length, 1, 'exactly one ring worker');
    assert.equal(site.ringWorker().url, '/js/sync-worker.js', 'the site\'s own worker script');
    const req1 = site.lastRequest();
    assert.equal(req1.type, 'sync-delta');
    assert.equal(req1.tiles.length, 9, 'server cap');
    assert.equal(req1.userID, undefined, 'no credentials: the worker then skips /GetUserData');
    assert.ok(req1.tiles.every((t) => t.timestamp === 0));
    const d2 = new Set(ringKeys(HOME_CENTRE, 2).filter((k) => !ringKeys(HOME_CENTRE, 1).includes(k)));
    assert.ok(req1.tiles.every((t) => d2.has(`${t.x},${t.y}`)), 'only ring tiles beyond the 3x3');
    assert.equal(site.cachedKeys().size, 9 + 9, 'the batch was cached through the site-equivalent path');
    assert.equal(api.getStats().ringTilesCached, 9);

    assert.equal(await site.tick(api), false, 'pacing: no second batch within RING_MIN_GAP_MS');
    site.advance(1000);
    assert.equal(await site.tick(api), true);
    assert.equal(site.lastRequest().tiles.length, 7, 'the remaining 16 - 9 ring tiles');
    assert.equal(site.cachedKeys().size, 25, 'the whole 5x5 is loaded');

    site.advance(1000);
    assert.equal(await site.tick(api), false, 'ring complete: nothing to do');
    assert.equal(api.getStats().ringBatches, 2);
    assert.equal(api.getStats().ringTilesRequested, 16);
});

test('radius 1 never creates a worker; radius 4 fills a 9x9 in 9 paced batches', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 1) });
    const api = site.install(); api.attach();

    api.configure({ radius: 1 });
    assert.equal(await site.tick(api), false);
    assert.equal(site.workers.length, 0);

    api.configure({ radius: 4 });
    let batches = 0;
    for (let i = 0; i < 20 && site.cachedKeys().size < 81; i++) { if (await site.tick(api)) batches++; site.advance(1000); }
    assert.equal(site.cachedKeys().size, 81);
    assert.equal(batches, 8, '72 ring tiles / 9 per batch');
    // Nearest first: the first batch was entirely distance-2 tiles.
    const firstBatch = site.requests()[0].tiles.map((t) => Math.max(Math.abs(t.x - 1000), Math.abs(t.y)) / TILE_GRID);
    assert.ok(firstBatch.every((d) => d === 2), `first batch distances: ${firstBatch}`);
});

test('never holds more than one batch in flight, and recovers if the worker never answers', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 1) });
    const api = site.install(); api.attach();
    api.configure({ radius: 3 });
    site.fake.autoRespond = false;                       // the worker goes silent

    assert.equal(await site.tick(api), true);
    assert.equal(api.getStats().ringInFlight, true);
    site.advance(5000);
    assert.equal(await site.tick(api), false, 'still waiting on the first batch');
    assert.equal(site.requests().length, 1);

    site.advance(30000);                                  // RING_TIMEOUT_MS
    assert.equal(await site.tick(api), true, 'timed out: moved on to the next batch');
    assert.equal(site.requests().length, 2);
    // The timeout and the re-request cooldown are both 30 s from the request,
    // so the abandoned tiles are eligible again -- and, still being the
    // nearest uncached ones, they are exactly what gets retried.
    const a = site.requests()[0].tiles.map((t) => `${t.x},${t.y}`).sort();
    const b = site.requests()[1].tiles.map((t) => `${t.x},${t.y}`).sort();
    assert.deepEqual(b, a, 'the nearest tiles are retried');
    assert.equal(api.getStats().ringInFlight, true, 'and again only one batch is in flight');
});

test('a tile the server never returns is not re-requested until the cooldown expires', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 1) });
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });
    site.fake.server = (tiles) => tiles.filter((t) => !(t.x === 3000 && t.y === 2000));

    for (let i = 0; i < 3; i++) { await site.tick(api); site.advance(1000); }
    assert.equal(site.cachedKeys().size, 24, 'everything but the hole');
    const before = site.requests().length;
    for (let i = 0; i < 5; i++) { await site.tick(api); site.advance(1000); }
    assert.equal(site.requests().length, before, 'nothing during the cooldown');

    site.advance(30000);
    await site.tick(api);
    const hole = site.lastRequest().tiles.find((t) => t.x === 3000 && t.y === 2000);
    assert.ok(hole && hole.timestamp === 0, 'asked once more after the cooldown, as a fresh request');
    // (the cooldown and the 5x5 refresh interval are both 30 s, so this batch
    // may also carry delta checks for cached ring tiles -- with timestamps)
    assert.ok(site.lastRequest().tiles.filter((t) => t !== hole).every((t) => t.timestamp > 0));
});

test('re-requests timestamp-only zombie entries as full tiles, but leaves mid-merge entries alone', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 2) });
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });
    // CASE 4 in synchronize(): { timestamp } with no bitmap fields at all.
    site.tileImageCache.set('3000,2000', { timestamp: 77 });
    // Mid-merge: the site sets bitmaps to null explicitly while the merge worker runs.
    site.tileImageCache.set('3000,1000', { timestamp: 78, colorBitmap: null, userBitmap: null });

    assert.equal(await site.tick(api), true);
    assert.equal(JSON.stringify(site.lastRequest().tiles), JSON.stringify([{ x: 3000, y: 2000, timestamp: 0 }]), 'only the zombie, as a fresh request');
    assert.ok(site.tileImageCache.get('3000,2000').colorBitmap, 'and it is a real tile again');
    assert.equal(site.tileImageCache.get('3000,1000').colorBitmap, null, 'mid-merge entry untouched');
});

test('refreshes cached ring tiles for deltas on a slow cadence, stalest first, through the merge worker', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 2) });    // site loaded everything itself
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });

    assert.equal(await site.tick(api), false, 'freshly attached: nothing due');
    site.advance(29000);
    assert.equal(await site.tick(api), false, 'below the 15 s x radius interval');
    site.advance(2000);
    assert.equal(await site.tick(api), true, 'refresh due');
    const req = site.lastRequest();
    assert.equal(req.tiles.length, 9);
    assert.ok(req.tiles.every((t) => t.timestamp > 0), 'delta checks carry the cached timestamps');
    assert.equal(site.mergeWorker.messages.length, 0, 'no deltas -> nothing merged, nothing rewritten');

    // Next batch covers the remaining 7; then the ring is quiet again until the next interval.
    site.advance(1000);
    assert.equal(await site.tick(api), true);
    assert.equal(site.lastRequest().tiles.length, 7);
    site.advance(1000);
    assert.equal(await site.tick(api), false);

    // A refresh that DOES find deltas: cloned bitmaps go to the merge worker,
    // the entry is marked mid-merge, and the merge result lands back in the cache.
    site.fake.deltasFor = (t) => (t.x === 3000 && t.y === 2000) ? [{ key: '3000,2000', gridX: 3000, gridY: 2000, color: '#FF0000', userId: 1 }] : [];
    site.advance(31000);
    await site.tick(api); site.advance(1000); await site.tick(api);
    await sleep(10);
    assert.equal(site.mergeWorker.messages.length, 1);
    assert.equal(site.mergeWorker.messages[0].msg.tileKey, '3000,2000');
    assert.ok(site.tileImageCache.get('3000,2000').colorBitmap, 'merged bitmap written back by the site handler');
});

test('does not touch tiles that are not in the cache when a delta arrives for them (no zombies)', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 2) });
    const api = site.install(); api.attach();
    api.configure({ radius: 2 });
    site.fake.autoRespond = false;
    site.fake.deltasFor = () => [{ key: 'x', gridX: 0, gridY: 0, color: '#FF0000', userId: 1 }];
    site.advance(31000);
    assert.equal(await site.tick(api), true);                    // a refresh batch is in flight
    const key = `${site.lastRequest().tiles[0].x},${site.lastRequest().tiles[0].y}`;
    site.tileImageCache.delete(key);                              // evicted meanwhile
    site.fake.pendingResponses.shift()(); await sleep(5);
    assert.equal(site.tileImageCache.has(key), false, 'a delta for an absent tile writes nothing');
});

test('does not request anything below the render level or while the tab is hidden', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 1) });
    const api = site.install(); api.attach();
    api.configure({ radius: 3 });
    site.map._zoom = 9;
    assert.equal(await site.tick(api), false);
    site.map._zoom = 14;
    site.context.document.hidden = true;
    assert.equal(await site.tick(api), false);
    site.context.document.hidden = false;
    assert.equal(await site.tick(api), true);
    assert.equal(site.requests().length, 1);
});

test('an oversized batch can never be sent (the fake server 413s it like the real one)', async () => {
    const site = makeFakeSite({ cachedKeys: ringKeys(HOME_CENTRE, 1) });
    const api = site.install(); api.attach();
    api.configure({ radius: 4 });
    for (let i = 0; i < 12; i++) { await site.tick(api); site.advance(1000); }
    assert.ok(site.requests().every((r) => r.tiles.length <= 9));
    assert.equal(site.cachedKeys().size, 81, 'every batch was accepted');
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

test('enforces the budget automatically on configure, on moveend, and on the periodic timer', async () => {
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

    // The site's own sync adds tiles without telling us; the 1 s timer catches it.
    site.tileImageCache.set('12000,0', { colorBitmap: makeBitmap(), userBitmap: makeBitmap(), timestamp: 1 });
    await sleep(1100);
    assert.equal(api.getStats().tiles, 10, 'the periodic pass evicted again');
    assert.ok(!site.tileImageCache.has('12000,0'));
    api.detach();
});

// ---- no uploads below the render level ----------------------------------

test('drops texture uploads that land after a fast zoom-out crossed the render level', async () => {
    // Reproduced live: drawCachedTilesOnMap() queues one upload per tile on
    // setTimeout(0); the site clears the layer only on `zoom` frames, so a
    // one-event zoom-out leaves every still-queued upload to land afterwards.
    const site = makeFakeSite({ resident: [] });
    const api = site.install(); api.attach(); api.configure({ radius: 1 });
    assert.equal(api.getStats().uploadGuarded, true, 'installed at attach, since the layer already exists');
    assert.equal(site.pixelTileLayer.setTile.__gpcImrGuarded, true);

    // Simulate the site's queue: five uploads scheduled while above the threshold...
    const queued = [...HOME_SET].map((k) => () => site.pixelTileLayer.setTile(k, {}, []));
    // ...then the zoom-out crosses below the threshold before they run.
    site.map._zoom = 9.0;
    for (const task of queued) task();
    assert.equal(site.pixelTileLayer.tiles.size, 0, 'nothing landed below the render level');
    assert.equal(api.getStats().uploadsDropped, 5);

    // Above the threshold uploads pass straight through to the site's setTile.
    site.map._zoom = 14;
    site.pixelTileLayer.setTile('0,0', {}, []);
    assert.equal(site.pixelTileLayer.tiles.size, 1);
    assert.deepEqual(site.pixelTileLayer.uploads, ['0,0']);
    assert.equal(api.getStats().uploadsDropped, 5);
});

test('chains with a setTile wrapper that was installed first (Blocked User List style)', () => {
    const site = makeFakeSite({ resident: [] });
    const seen = [];
    const orig = site.pixelTileLayer.setTile;
    site.pixelTileLayer.setTile = function (k, src, c) { seen.push(k); return orig.call(this, k, src, c); };
    site.pixelTileLayer.setTile.__gpcBlockedUsersOriginal = orig;

    const api = site.install(); api.attach();
    assert.equal(site.pixelTileLayer.setTile.__gpcImrGuarded, true);
    assert.equal(site.pixelTileLayer.setTile.__gpcImrInner.__gpcBlockedUsersOriginal, orig, 'wrapped the existing wrapper, not the bare method');

    site.map._zoom = 14;
    site.pixelTileLayer.setTile('1000,0', {}, []);
    assert.deepEqual(seen, ['1000,0'], 'inner wrapper still runs above the threshold');
    site.map._zoom = 9;
    site.pixelTileLayer.setTile('2000,0', {}, []);
    assert.deepEqual(seen, ['1000,0'], 'and is skipped entirely below it');
});

test('installs the guard later if the tile layer does not exist yet at attach time', async () => {
    const site = makeFakeSite({ resident: [] });
    const layer = site.context.pixelTileLayer;
    site.context.pixelTileLayer = null;                       // index.js: `let pixelTileLayer = null` until map load
    const api = site.install(); api.attach();
    assert.equal(api.getStats().uploadGuarded, false);
    site.context.pixelTileLayer = layer;
    await sleep(1100);                                        // the bridge's 1 s timer retries
    assert.equal(api.getStats().uploadGuarded, true);
    assert.equal(layer.setTile.__gpcImrGuarded, true);
    api.detach();
});

test('the guard never blocks the restore path: zooming back in re-uploads normally', async () => {
    const site = makeFakeSite({ resident: [...HOME_SET] });
    const api = site.install(); api.attach(); api.configure({ radius: 1 });
    site.zoomTo(9.0); await sleep(20);
    assert.equal(site.pixelTileLayer.tiles.size, 0);
    site.zoomTo(14.0); await sleep(20);
    assert.ok(setEq(site.gpuKeys(), HOME_SET));
    assert.equal(api.getStats().uploadsDropped, 0, 'nothing was dropped: every upload happened above the threshold');
});
