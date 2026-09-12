// tests/improved-map-rendering.test.mjs
//
// Verifies the Improved Map Rendering extension two ways:
//   1. Contract checks against the built artifact and core.js: the feature is
//      registered, lives in the Map settings category, and defaults to off.
//   2. Behavioural checks that execute the REAL page-realm bridge source
//      (extracted from the feature file, never re-typed here) inside a vm
//      context that fakes exactly the GeoPixels globals it depends on:
//      map, pixelTileLayer, tileImageCache, minZoom, gridSize,
//      SYNC_TILE_SIZE, turf, drawCachedTilesOnMap.
//      The fake drawCachedTilesOnMap mirrors the real one's contract
//      (index.js ~549-655): early-return below minZoom, upload every cached
//      tile inside a buffer of 2x the viewport (min 7 tiles), evict GPU
//      textures outside it.

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
});

test('defaults Improved Map Rendering to disabled', () => {
    // Every EXTENSION_LIST entry except the pill hover labels defaults to
    // false; the new key must not be special-cased anywhere.
    assert.match(coreSource, /EXTENSION_LIST\.forEach\(f => DEFAULT_SETTINGS\[f\.key\] = f\.key === 'extPillHoverLabels' \? true : false\);/);
    assert.doesNotMatch(coreSource, /DEFAULT_SETTINGS\.extImprovedMapRendering\s*=/);
    assert.doesNotMatch(coreSource, /extImprovedMapRendering: true/);
});

test('only ever asks the site to redraw; never touches its caches or clear()', () => {
    assert.match(BRIDGE_SOURCE, /drawCachedTilesOnMap\(\)/);
    assert.match(BRIDGE_SOURCE, /function needsDraw\(/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\.clear\(/);
    assert.doesNotMatch(BRIDGE_SOURCE, /tileImageCache\.(set|delete)/);
    assert.doesNotMatch(BRIDGE_SOURCE, /tileTextureState/);
    assert.doesNotMatch(BRIDGE_SOURCE, /setTile|removeTile/);
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

// Nine tiles in a row along x: keys "0,0", "1000,0", ..., "8000,0".
// HOME sits over tile 1 and its 175 km buffer covers tiles 0-4;
// FAR sits over tile 8 and covers tiles 5-8. The two sets are disjoint.
const ROW_KEYS = Array.from({ length: 9 }, (_, i) => `${i * TILE_GRID},0`);
const HOME = [30000, 12500];
const FAR = [220000, 12500];
const HOME_SET = new Set(ROW_KEYS.slice(0, 5));
const FAR_SET = new Set(ROW_KEYS.slice(5));

function tileMercBox(key) {
    const [ox, oy] = key.split(',').map(Number);
    const x0 = ox * GRID - GRID / 2, y0 = oy * GRID - GRID / 2;
    return { x0, y0, x1: x0 + TILE_M, y1: y0 + TILE_M };
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
    const pixelTileLayer = { tiles: new Map(), hasTile(k) { return this.tiles.has(k); } };
    const tileImageCache = new Map();
    for (const key of cachedKeys) tileImageCache.set(key, { colorBitmap: {}, userBitmap: {}, timestamp: 1 });
    for (const key of (resident || cachedKeys)) pixelTileLayer.tiles.set(key, { tex: {} });

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
            if (outside) pixelTileLayer.tiles.delete(key);
            else pixelTileLayer.tiles.set(key, { tex: {} });
        }
    }

    // What the site's updateInterfaceState does on every zoom frame.
    map.on('zoom', () => { if (map._zoom < renderLevel && pixelTileLayer.tiles.size > 0) pixelTileLayer.tiles.clear(); });

    const context = {
        map, pixelTileLayer, tileImageCache, drawCachedTilesOnMap,
        minZoom: renderLevel,
        userConfig: { renderLevel },
        gridSize: GRID, SYNC_TILE_SIZE: TILE_GRID, turf: fakeTurf,
        setTimeout, clearTimeout, Date, isFinite, isNaN, parseInt, Math,
        // No requestAnimationFrame on purpose: the bridge must work in a
        // document whose rAF is paused (hidden tab, embedded webview).
    };
    context.window = context;
    vm.createContext(context);

    return {
        context, map, pixelTileLayer, tileImageCache, draws,
        setDrawThrows(v) { drawThrows = v; },
        install() { vm.runInContext(BRIDGE_SOURCE, context, { filename: 'improved-map-rendering-bridge.js' }); return context.__gpcImprovedMapRendering; },
        // MapLibre emits 'move' on every camera frame, then 'zoom' when zooming.
        zoomTo(z) { map._zoom = z; map.emit('move'); map.emit('zoom'); },
        panTo(x, y = map._c[1]) { map._c = [x, y]; map.emit('move'); },
        settle() { map.emit('moveend'); },
        siteTick() { drawCachedTilesOnMap(); },   // the site's own 5 s full-sync draw
        gpuKeys() { return new Set(pixelTileLayer.tiles.keys()); },
    };
}

const setEq = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));

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
    // new can enter the buffer. (Panning east would legitimately pull tile 5
    // into the 175 km buffer after ~7.5 km -- see the mid-drag test below.)
    for (let x = HOME[0]; x >= HOME[0] - 40000; x -= 500) site.panTo(x);   // 80 pan frames, ~40 km
    site.settle();
    await sleep(150);
    assert.deepEqual(site.draws, [], 'no draw: nothing new entered the buffer');
    assert.ok(api.getState().checks > 0, 'the bridge did evaluate the frames');
    assert.equal(api.getState().restores, 0);
});

test('draws once when a missing tile enters the buffer mid-drag, not on every frame', async () => {
    // Home resident, far tiles cached but not resident. Drag east frame by
    // frame; the draw must fire only when tile 5 first enters the buffer.
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

    // Immediately oscillate again: within MIN_RESTORE_GAP_MS of the last restore.
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
    // Without turf/gridSize the buffer cannot be mirrored: the bridge must
    // then only act on the unambiguous case (GPU completely empty).
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
