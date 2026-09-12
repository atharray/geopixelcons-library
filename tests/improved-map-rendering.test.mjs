// tests/improved-map-rendering.test.mjs
//
// Verifies the Improved Map Rendering extension two ways:
//   1. Contract checks against the built artifact and core.js: the feature is
//      registered, lives in the Map settings category, and defaults to off.
//   2. Behavioural checks that execute the REAL page-realm bridge source
//      (extracted from the feature file, never re-typed here) inside a vm
//      context that fakes exactly the GeoPixels globals it depends on:
//      map, pixelTileLayer, tileImageCache, minZoom, drawCachedTilesOnMap.
//      The fake drawCachedTilesOnMap mirrors the real one's contract: it
//      early-returns below minZoom and otherwise re-uploads every cached tile.

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
    assert.doesNotMatch(BRIDGE_SOURCE, /\.clear\(/);
    assert.doesNotMatch(BRIDGE_SOURCE, /tileImageCache\.(set|delete)/);
    assert.doesNotMatch(BRIDGE_SOURCE, /tileTextureState/);
    assert.doesNotMatch(BRIDGE_SOURCE, /setTile|removeTile/);
    // Interpolation-free so the extracted source is exactly what runs in-page.
    assert.doesNotMatch(BRIDGE_SOURCE, /\$\{/);
    // rAF is paused in hidden documents / some embedded webviews; a pending
    // flag waiting on it would block every later restore (observed live).
    assert.doesNotMatch(BRIDGE_SOURCE, /requestAnimationFrame\s*\(/);
    assert.doesNotMatch(BRIDGE_SOURCE, /typeof requestAnimationFrame/);
});

// ---------------------------------------------------------------------------
// 2. Behaviour
// ---------------------------------------------------------------------------

function makeFakeSite({ renderLevel = 10.5, zoom = 14, cachedTiles = 9 } = {}) {
    const listeners = new Map();
    const map = {
        _zoom: zoom,
        getZoom() { return this._zoom; },
        on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
        off(type, fn) { listeners.get(type)?.delete(fn); },
        emit(type) { for (const fn of listeners.get(type) || []) fn(); },
        listenerCount(type) { return listeners.get(type)?.size || 0; },
    };
    const pixelTileLayer = { tiles: new Map() };
    const tileImageCache = new Map();
    for (let i = 0; i < cachedTiles; i++) tileImageCache.set(`${i}000,0`, { colorBitmap: {}, userBitmap: {}, timestamp: 1 });
    for (const key of tileImageCache.keys()) pixelTileLayer.tiles.set(key, { tex: {} });

    const draws = [];
    let drawThrows = false;
    function drawCachedTilesOnMap() {
        draws.push(map._zoom);
        if (drawThrows) throw new Error('boom');
        if (map._zoom < renderLevel) return;                 // mirrors index.js:551
        for (const key of tileImageCache.keys()) pixelTileLayer.tiles.set(key, { tex: {} });
    }

    // What the site's updateInterfaceState does on every zoom frame.
    function siteZoomHandler() {
        if (map._zoom < renderLevel && pixelTileLayer.tiles.size > 0) pixelTileLayer.tiles.clear();
    }
    map.on('zoom', siteZoomHandler);

    const context = {
        map, pixelTileLayer, tileImageCache, drawCachedTilesOnMap,
        minZoom: renderLevel,
        userConfig: { renderLevel },
        setTimeout, clearTimeout, Date, isFinite,
        // No requestAnimationFrame on purpose: the bridge must work in a
        // document whose rAF is paused (hidden tab, embedded webview).
    };
    context.window = context;
    vm.createContext(context);

    return {
        context, map, pixelTileLayer, tileImageCache, draws,
        setDrawThrows(v) { drawThrows = v; },
        install() { vm.runInContext(BRIDGE_SOURCE, context, { filename: 'improved-map-rendering-bridge.js' }); return context.__gpcImprovedMapRendering; },
        zoomTo(z) { map._zoom = z; map.emit('zoom'); },
    };
}

test('restores the canvas from memory as soon as zoom crosses back above the render level', async () => {
    const site = makeFakeSite();
    const api = site.install();
    assert.equal(api.attach(), true);

    site.zoomTo(10.0);                       // below 10.5: site clears GPU textures
    await sleep(20);
    assert.equal(site.pixelTileLayer.tiles.size, 0);
    assert.deepEqual(site.draws, [], 'must not redraw while still below the render level');

    site.zoomTo(14.0);                       // back above: hook should trigger the redraw
    await sleep(20);
    assert.deepEqual(site.draws, [14], 'exactly one redraw, at the zoomed-in level');
    assert.equal(site.pixelTileLayer.tiles.size, 9, 'all cached tiles back on the GPU');
    assert.equal(api.getState().restores, 1);

    site.zoomTo(15.0);                       // further zoom with textures resident: no-op
    await sleep(20);
    assert.deepEqual(site.draws, [14]);
});

test('coalesces a burst of zoom frames into a single redraw', async () => {
    const site = makeFakeSite();
    site.install().attach();
    site.zoomTo(9.0);
    await sleep(20);
    for (let z = 10.6; z <= 13; z += 0.2) site.zoomTo(z);   // 13 frames in one tick
    await sleep(20);
    assert.equal(site.draws.length, 1);
});

test('throttles rapid re-crossings but still restores the final state', async () => {
    const site = makeFakeSite();
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
    assert.equal(site.pixelTileLayer.tiles.size, 9);
});

test('does nothing when there is nothing cached to bring back', async () => {
    const site = makeFakeSite({ cachedTiles: 0 });
    site.install().attach();
    site.zoomTo(9.0); await sleep(20);
    site.zoomTo(14.0); await sleep(20);
    assert.deepEqual(site.draws, []);
});

test('falls back to userConfig.renderLevel when minZoom is unavailable', async () => {
    const site = makeFakeSite({ renderLevel: 8 });
    delete site.context.minZoom;
    site.install().attach();
    site.zoomTo(7.5); await sleep(20);
    assert.equal(site.pixelTileLayer.tiles.size, 0);
    site.zoomTo(7.9); await sleep(20);
    assert.deepEqual(site.draws, [], 'still below the configured level');
    site.zoomTo(8.0); await sleep(20);
    assert.deepEqual(site.draws, [8.0]);
});

test('survives a throwing drawCachedTilesOnMap without breaking later restores', async () => {
    const site = makeFakeSite();
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
    assert.equal(site.pixelTileLayer.tiles.size, 9);
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
    assert.equal(realMap.listenerCount('zoom'), 2, 'site handler + exactly one bridge handler');
    assert.equal(realMap.listenerCount('zoomend'), 1);

    // Re-running the bridge source (e.g. a second install attempt) is a no-op.
    vm.runInContext(BRIDGE_SOURCE, site.context);
    assert.equal(realMap.listenerCount('zoom'), 2);

    api.detach();
    assert.equal(realMap.listenerCount('zoom'), 1);
    assert.equal(realMap.listenerCount('zoomend'), 0);
});

test('manual restore() honours the same guards as the zoom hook', () => {
    const site = makeFakeSite();
    const api = site.install();
    assert.equal(api.restore(), false, 'textures already resident');
    site.pixelTileLayer.tiles.clear();
    site.map._zoom = 9;
    assert.equal(api.restore(), false, 'below render level');
    site.map._zoom = 12;
    assert.equal(api.restore(), true);
    assert.equal(site.pixelTileLayer.tiles.size, 9);
    assert.equal(api.getState().lastReason, 'manual');
});
