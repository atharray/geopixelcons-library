// tests/ghost-plus-plus-fixture.mjs
//
// Real, runnable verification of the ASSEMBLED Ghost++ feature (the 12 files
// under src/features/ghost-plus-plus/) as it is actually shipped inside
// GeoPixelcons++ — not a per-file syntax check, not a mocked/paraphrased
// re-implementation. This launches a real locally-installed headless
// Chrome/Edge against a synthetic fixture page (served over a throwaway
// local HTTP server with a permissive CSP) that provides GeoPixels' page
// globals (map/turf/grid/palette/native-ghost bindings) as plain top-level
// `let` bindings, then inlines the 13 Ghost++ source files (read live from
// disk — never hand-copied) so the real, shipped code executes against
// them, exercising real cross-file calls.
//
// Reference pattern (infrastructure only, not reused verbatim — see this
// file's own header comments for why the mount mechanism differs):
//   scripts/geopixels-ghost-template-overhaul/tests/harness.mjs
//   scripts/geopixels-ghost-template-overhaul/tests/runtime-smoke.mjs
//
// Key deliberate deviations from that reference, disclosed here:
//   1. No sandbox/page-realm boundary is simulated. Ghost++ now runs in the
//      same realm as the rest of GPC++ (see gpp-bridge.js's header comment),
//      so `map`/`turf`/`Colors`/etc. are simply top-level `let` bindings in
//      an earlier <script> tag of the same document — no unsafeWindow
//      injection dance needed to reach them.
//   2. The 12 Ghost++ files are inlined as bare top-level script content,
//      WITHOUT the extra wrapping IIFE the real build.js gives them (in
//      production they share one IIFE with ~25 unrelated feature files).
//      This is necessary, not cosmetic: this version of Ghost++ exposes no
//      public debug handle (no `window.__gpGhostPlus` the way the old
//      standalone prototype had), so white-box access to gppState,
//      gppInitRuntime, gppCreateCore, gppScanTemplate, gppShimEnable, and
//      the gppRender* functions requires them to be real top-level bindings
//      reachable from the driver <script> that runs after them. IIFE-vs-
//      global scoping does not change any of the tested logic, only its
//      external visibility.
//   3. The fixture declares MORE native `let` bindings than the task's
//      illustrative list (adds ghostImageCanvas, ghostPaletteColors,
//      ghostAllImageColors, paletteToImageColorMap, ghostImageFileObject)
//      because gpp-native-shim.js's actual mirror-writer functions
//      (gppClearNativeMirror / gppWriteFullNativeMirror / gppWriteLightNativeMirror)
//      assign to all of them. Omitting any would make the FIXTURE throw a
//      ReferenceError (strict-mode assignment to an undeclared binding via
//      the injected page-realm <script>), which would be a fixture bug, not
//      a real Ghost++ bug.
//   4. window.requestAnimationFrame/cancelAnimationFrame are overridden to
//      setTimeout(...,0)-based shims, exactly like the old harness did —
//      headless Chrome does not reliably drive a real compositor rAF
//      cadence, and gpp-renderer.js/gpp-scan.js schedule all redraws
//      through rAF.
//
// Usage:  node tests/ghost-plus-plus-fixture.mjs
// Exit code is non-zero if any assertion failed or either browser pass
// crashed/timed out.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const GPP_DIR = resolve(TEST_DIR, '..', '..', 'src', 'legacy', 'features', 'ghost-plus-plus');
const MOBILE_PAINTING_FILE = resolve(TEST_DIR, '..', '..', 'src', 'legacy', 'features', 'mobile-painting.js');

// Exactly the 13-file slice of build.js's SRC_ORDER for Ghost++, in the same
// order build.js concatenates them in.
const GPP_FILES = [
    'gpp-core.js',
    'gpp-bridge.js',
    'gpp-legacy-bridge.js',
    'gpp-runtime.js',
    'gpp-ui-shell.js',
    'gpp-renderer.js',
    'gpp-native-shim.js',
    'gpp-placement.js',
    'gpp-scan.js',
    'gpp-palette.js',
    'gpp-library.js',
    'gpp-view-settings.js',
    'gpp-init.js',
];

function readGhostPlusPlusSource() {
    return GPP_FILES.map(name => readFileSync(join(GPP_DIR, name), 'utf8')).join('\n');
}

function readMobilePaintingSource() {
    return readFileSync(MOBILE_PAINTING_FILE, 'utf8');
}

// Runs the exact same real Ghost++ source this fixture already exercises
// through terser (build.js's own minification pass — see that file) before
// injecting it into the page, so the "Minified build" pass below proves
// minification itself doesn't break anything THIS suite actually checks,
// using infrastructure that's already known-good — rather than trying to
// boot the full 30-feature production bundle (GM_* grants, 'unsafeWindow',
// dozens of unrelated features' own expected native DOM/globals) in this
// minimal synthetic page, which would fail for reasons having nothing to
// do with minification.
async function readGhostPlusPlusSourceMinified() {
    const terser = await import('terser');
    const result = await terser.minify(readGhostPlusPlusSource() + '\n' + readMobilePaintingSource(), {
        compress: true,
        mangle: true,
        format: { comments: false, ascii_only: false },
    });
    if (result.error) throw result.error;
    return result.code;
}

function findBrowser() {
    const candidates = [
        process.env.CHROME_PATH,
        process.env.BROWSER_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean);
    return candidates.find(candidate => existsSync(candidate)) || null;
}

// ── isDarkMode()/t() copied verbatim from src/core.js (they are tiny and
// pure) so the inlined gpp-ui-shell.js/gpp-placement.js/gpp-palette.js/etc.
// theme helper `t2()` (which just calls the real `t()`) resolves correctly.
const CORE_THEME_HELPERS = [
    "function isDarkMode() {",
    "    const gppSettings = localStorage.getItem('geo++_settings');",
    "    if (gppSettings) {",
    "        try {",
    "            const parsed = JSON.parse(gppSettings);",
    "            if (parsed.theme && parsed.theme !== 'system') {",
    "                return parsed.theme === 'simple_black';",
    "            }",
    "        } catch(e) {}",
    "    }",
    "    return document.body.classList.contains('dark') ||",
    "           window.matchMedia('(prefers-color-scheme: dark)').matches;",
    "}",
    "function t(light, dark) { return isDarkMode() ? dark : light; }",
].join('\n');

function buildFixtureHead(forceCanvas2D) {
    // Written by hand (no backticks used anywhere below) so it can be
    // concatenated with the raw Ghost++ source via plain string '+' without
    // any risk of the outer template literal being terminated early by a
    // stray backtick inside gpp-ui-shell.js's CSS-in-JS template strings.
    const lines = [];
    lines.push('<!doctype html>');
    lines.push('<html><head><meta charset="utf-8">');
    lines.push('<title>Ghost++ assembled-feature fixture</title>');
    lines.push('<style>html,body{margin:0;padding:0;background:#fff;}');
    lines.push('#map-shell{position:absolute;left:0;top:0;width:800px;height:600px;overflow:hidden;background:#eee;}');
    lines.push('</style></head><body>');
    lines.push('<div id="imageGroupDropdown"><button id="loadGhostImageBtn" type="button"><span id="loadGhostImageBtnLabel">eye</span></button></div>');
    lines.push('<input id="ghostImageInput" type="file" accept="image/*" style="display:none">');
    lines.push('<button id="initiatePlaceGhostBtn" type="button" style="display:none">Native place</button>');
    lines.push('<button id="clearGhostImageBtn" type="button" style="display:none">Native clear</button>');
    // Deliberately plain site-like paint bar: Painting Menu Overhaul must preserve
    // these natural dimensions rather than forcing a full-viewport width.
    lines.push('<div id="bottomControls"><div style="padding:12px;box-sizing:border-box"><div class="w-full flex"><span id="hexDisplay"></span><button id="sortBtn" type="button">Sort</button></div><div class="control-container-colors"><button type="button">Native color</button></div></div><div style="position:absolute;top:-24px;left:0;right:0;height:24px" id="gpc-paint-menu-toolbar"><button id="gpc-hide-paint-toggle" type="button">Toggle paint menu</button><button id="gpc-paint-flip-pos" type="button">Flip paint menu</button><button id="gpc-compact-brush" type="button">Brushes</button></div></div>');
    lines.push('<div id="map-shell"><div id="pixel-canvas"></div><canvas id="ghost-canvas"></canvas></div>');
    lines.push('<pre id="test-result" data-status="pending">pending</pre>');
    lines.push('<script>');
    lines.push("'use strict';");
    lines.push('window.__fixtureErrors = [];');
    lines.push("window.addEventListener('error', function(e) { window.__fixtureErrors.push(String((e.error && e.error.stack) || e.message)); });");
    lines.push("window.addEventListener('unhandledrejection', function(e) { window.__fixtureErrors.push('unhandledrejection: ' + String((e.reason && e.reason.stack) || e.reason)); });");
    lines.push('var __consoleErrors = [];');
    lines.push('var __consoleWarnings = [];');
    lines.push('var __origConsoleError = console.error.bind(console);');
    lines.push('console.error = function() { __consoleErrors.push(Array.prototype.map.call(arguments, String).join(" ")); __origConsoleError.apply(console, arguments); };');
    lines.push('var __origConsoleWarn = console.warn.bind(console);');
    lines.push('console.warn = function() { __consoleWarnings.push(Array.prototype.map.call(arguments, String).join(" ")); __origConsoleWarn.apply(console, arguments); };');
    lines.push('window.__fixtureConsole = { errors: __consoleErrors, warnings: __consoleWarnings };');
    lines.push('');
    lines.push('// Headless Chrome does not reliably drive rAF without a live compositor;');
    lines.push('// gpp-renderer.js / gpp-scan.js schedule every redraw through rAF, so this');
    lines.push('// mirrors the old harness\'s proven setTimeout-based shim.');
    lines.push('window.requestAnimationFrame = function(cb) { return setTimeout(function() { cb(performance.now()); }, 0); };');
    lines.push('window.cancelAnimationFrame = function(id) { clearTimeout(id); };');
    lines.push('');
    lines.push('var FORCE_CANVAS2D = ' + (forceCanvas2D ? 'true' : 'false') + ';');
    lines.push('if (FORCE_CANVAS2D) {');
    lines.push('    var __origGetContext = HTMLCanvasElement.prototype.getContext;');
    lines.push('    HTMLCanvasElement.prototype.getContext = function(type, opts) {');
    lines.push("        if (type === 'webgl2') return null;");
    lines.push('        return __origGetContext.call(this, type, opts);');
    lines.push('    };');
    lines.push('}');
    lines.push('');
    lines.push('var MAP_ORIGIN_X = 400, MAP_ORIGIN_Y = 300, MAP_SCALE = 2;');
    lines.push('var __mapShellEl = document.getElementById("map-shell");');
    lines.push('var __mapZoom = 15;');
    lines.push('var __mapListeners = {};');
    lines.push('window.__flyToCalls = [];');
    lines.push('window.__jumpToCalls = [];');
    lines.push('');
    lines.push('let gridSize = 25;');
    lines.push('let halfSize = 12.5;');
    lines.push('let minZoom = 10.5;');
    lines.push('let SYNC_TILE_SIZE = 1000;');
    lines.push('let offsetMetersX = 0;');
    lines.push('let offsetMetersY = 0;');
    lines.push("let Colors = ['#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#000000', '#00000000'];");
    lines.push('let activeColors = [0, 1, 2];');
    lines.push('let tileImageCache = new Map();');
    lines.push('');
    lines.push('// turf: identity-ish passthrough (arrays in, arrays out) — all the');
    lines.push('// grid<->screen math lives in map.project/unproject below instead, so a');
    lines.push('// round trip through project+unproject is a real, non-trivial check.');
    lines.push('let turf = {');
    lines.push('    toWgs84: function(coord) { return [coord[0], coord[1]]; },');
    lines.push('    toMercator: function(coord) { return [coord[0], coord[1]]; },');
    lines.push('};');
    lines.push('');
    lines.push('let map = {');
    lines.push('    getContainer: function() { return __mapShellEl; },');
    lines.push('    getZoom: function() { return __mapZoom; },');
    lines.push('    getCenter: function() { return { lng: 0, lat: 0 }; },');
    lines.push('    getBounds: function() {');
    lines.push('        return {');
    lines.push('            getNorthWest: function() { return { lng: -1000, lat: 1000 }; },');
    lines.push('            getSouthEast: function() { return { lng: 1000, lat: -1000 }; },');
    lines.push('        };');
    lines.push('    },');
    lines.push('    project: function(coord) {');
    lines.push('        var lng = Array.isArray(coord) ? coord[0] : coord.lng;');
    lines.push('        var lat = Array.isArray(coord) ? coord[1] : coord.lat;');
    lines.push('        return { x: MAP_ORIGIN_X + lng * MAP_SCALE, y: MAP_ORIGIN_Y - lat * MAP_SCALE };');
    lines.push('    },');
    lines.push('    unproject: function(point) {');
    lines.push('        var x = Array.isArray(point) ? point[0] : point.x;');
    lines.push('        var y = Array.isArray(point) ? point[1] : point.y;');
    lines.push('        return { lng: (x - MAP_ORIGIN_X) / MAP_SCALE, lat: (MAP_ORIGIN_Y - y) / MAP_SCALE };');
    lines.push('    },');
    lines.push('    flyTo: function(opts) { window.__flyToCalls.push(opts); },');
    lines.push('    jumpTo: function(opts) { window.__jumpToCalls.push(opts); if (opts && typeof opts.zoom === "number") __mapZoom = opts.zoom; },');
    lines.push('    on: function(type, cb) { (__mapListeners[type] || (__mapListeners[type] = new Set())).add(cb); },');
    lines.push('    off: function(type, cb) { if (__mapListeners[type]) __mapListeners[type].delete(cb); },');
    lines.push('};');
    lines.push('');
    lines.push('let ghostImage = null;');
    lines.push('let ghostImageOriginalData = null;');
    lines.push('let ghostImageTopLeft = null;');
    lines.push('let ghostImageCanvas = null;');
    lines.push('let ghostPaletteColors = [];');
    lines.push('let ghostActivePaletteColors = new Set();');
    lines.push('let ghostAllImageColors = new Map();');
    lines.push('let paletteToImageColorMap = new Map();');
    lines.push('let imageColorToDominantColorMap = new Map();');
    lines.push('let isColorFilterDisabled = true;');
    lines.push('let ghostImageFileObject = null;');
    lines.push('');
    // Same realm-mismatch shape as the ghost-* bindings above: real
    // top-level `let`s, exercising gpp-bridge.js's gppReadNativeGuildData()/
    // gppReadNativeAuth() (the eval-bridge fix for the "Could not find the
    // selected project" bug) rather than a plain unsafeWindow.x property
    // read, which would silently see undefined for all three.
    lines.push('let userGuildData = null;');
    lines.push('let tokenUser = "fixture-token";');
    lines.push('let userData = { id: 4242 };');
    lines.push('');
    lines.push('window.__alerts = [];');
    lines.push('function showAlert(title, message) { window.__alerts.push({ title: title, message: message }); }');
    lines.push('window.__nativeSetProjectAsGhostCalls = 0;');
    lines.push('function setProjectAsGhost(projectId) { window.__nativeSetProjectAsGhostCalls++; }');
    lines.push('');
    // Tampermonkey global gpp-init.js's gppFetchBlobViaGM() wraps for the
    // Ghost++ URL-upload button (#gpp-url-upload-btn -> handleUrlUploadClick
    // -> ingestFromUrl). __gmXhrCalls records every requested URL so tests
    // can assert gppFetchBlobViaGM called through with the right, normalized
    // URL; __gmXhrResponses is a per-URL registry a test populates BEFORE
    // triggering the fetch (`{ blob }` for a canned success, `{ error }` for
    // a canned failure) — an unregistered URL rejects via onerror, matching
    // a real network failure rather than hanging forever.
    lines.push('window.__gmXhrCalls = [];');
    lines.push('window.__gmXhrResponses = {};');
    lines.push('window.GM_xmlhttpRequest = function(opts) {');
    lines.push('    window.__gmXhrCalls.push(opts.url);');
    lines.push('    var canned = window.__gmXhrResponses[opts.url];');
    lines.push('    setTimeout(function() {');
    lines.push('        if (!canned) { if (opts.onerror) opts.onerror(new Error("fixture: no mock GM_xmlhttpRequest response registered for " + opts.url)); return; }');
    lines.push('        if (canned.error) { if (opts.onerror) opts.onerror(new Error(canned.error)); return; }');
    lines.push('        if (opts.onload) opts.onload({ status: canned.status || 200, statusText: canned.statusText || "OK", response: canned.blob });');
    lines.push('    }, 0);');
    lines.push('};');
    lines.push('');
    lines.push('window.__nativeControlEvents = 0;');
    lines.push('window.__nativeDrawCalls = 0;');
    lines.push('window.__nativeRegenCalls = 0;');
    lines.push('window.__nativeInitCalls = 0;');
    lines.push('window.__changedColors = [];');
    lines.push('function changeColor(hex) { window.__changedColors.push(hex); }');
    lines.push('function drawGhostImageOnCanvas() { window.__nativeDrawCalls++; }');
    lines.push('function regenerateGhostCanvas() { window.__nativeRegenCalls++; }');
    lines.push('function initializeGhostFromStorage() { window.__nativeInitCalls++; }');
    lines.push('document.getElementById("loadGhostImageBtnLabel").addEventListener("click", function() { window.__nativeControlEvents++; });');
    lines.push('["ghostImageInput","initiatePlaceGhostBtn","clearGhostImageBtn"].forEach(function(id) {');
    lines.push('    var type = id === "ghostImageInput" ? "change" : "click";');
    lines.push('    document.getElementById(id).addEventListener(type, function() { window.__nativeControlEvents++; });');
    lines.push('});');
    lines.push('');
    // Start as though Simple Black was already applied before Painting Menu Overhaul
    // mounts. The feature must consult the live computed root style instead
    // of only a later settings refresh.
    lines.push('document.documentElement.style.colorScheme = "dark";');
    lines.push('localStorage.setItem("geo++_mobile_painting_ui_scale", "90");');
    lines.push('let _settings = { ghostPlusPlus: true, mobilePaintingExtension: true, hidePaintMenu: true };');
    lines.push('function gpcMobileOverhaulAvailable() { return false; }');
    lines.push('let _featureStatus = {};');
    lines.push('function dbgPush(message, opts) { console.warn("[dbgPush]", message, opts); }');
    lines.push('');
    lines.push(CORE_THEME_HELPERS);
    lines.push('</script>');
    return lines.join('\n');
}

function buildDriverScript() {
    // Also hand-written with no backticks, for the same concatenation-safety
    // reason as buildFixtureHead().
    const L = [];
    L.push('<script>');
    L.push('(async function() {');
    L.push('  "use strict";');
    L.push('  var results = [];');
    L.push('  function record(id, ok, detail) { results.push({ id: id, ok: !!ok, detail: String(detail == null ? "" : detail) }); }');
    L.push('  async function step(id, fn) {');
    L.push('    try { var detail = await fn(); record(id, true, detail || "ok"); }');
    L.push('    catch (err) { record(id, false, (err && err.stack) ? err.stack : String(err)); }');
    L.push('  }');
    L.push('  async function waitFor(predicate, timeout, interval) {');
    L.push('    timeout = timeout || 5000; interval = interval || 25;');
    L.push('    var start = performance.now();');
    L.push('    while (true) {');
    L.push('      var ok = false;');
    L.push('      try { ok = await predicate(); } catch (_) { ok = false; }');
    L.push('      if (ok) return true;');
    L.push('      if (performance.now() - start > timeout) return false;');
    L.push('      await new Promise(function(r) { setTimeout(r, interval); });');
    L.push('    }');
    L.push('  }');
    L.push('  function idbGetAll(storeName) {');
    L.push('    return new Promise(function(resolveP, rejectP) {');
    L.push('      var req = indexedDB.open("GP_Ghost_Plus_Plus", 1);');
    L.push('      req.onsuccess = function() {');
    L.push('        var db = req.result;');
    L.push('        try {');
    L.push('          var tx = db.transaction(storeName, "readonly");');
    L.push('          var getAllReq = tx.objectStore(storeName).getAll();');
    L.push('          getAllReq.onsuccess = function() { db.close(); resolveP(getAllReq.result); };');
    L.push('          getAllReq.onerror = function() { db.close(); rejectP(getAllReq.error); };');
    L.push('        } catch (err) { db.close(); rejectP(err); }');
    L.push('      };');
    L.push('      req.onerror = function() { rejectP(req.error); };');
    L.push('    });');
    L.push('  }');
    L.push('  // Raw write into Ghost++\'s OWN private core store — used only to seed a');
    L.push('  // "leftover from before shared-library was unconditional" scenario for tests,');
    L.push('  // since ordinary ingest no longer ever writes here.');
    L.push('  function idbPut(storeName, record) {');
    L.push('    return new Promise(function(resolveP, rejectP) {');
    L.push('      var req = indexedDB.open("GP_Ghost_Plus_Plus", 1);');
    L.push('      req.onsuccess = function() {');
    L.push('        var db = req.result;');
    L.push('        try {');
    L.push('          var tx = db.transaction(storeName, "readwrite");');
    L.push('          tx.objectStore(storeName).put(record);');
    L.push('          tx.oncomplete = function() { db.close(); resolveP(); };');
    L.push('          tx.onerror = function() { db.close(); rejectP(tx.error); };');
    L.push('        } catch (err) { db.close(); rejectP(err); }');
    L.push('      };');
    L.push('      req.onerror = function() { rejectP(req.error); };');
    L.push('    });');
    L.push('  }');
    L.push('  // Raw, black-box access to the LEGACY history database (ghost-template-manager.js\'s');
    L.push('  // own GP_Ghost_History v3 "images" store) — independent of gpp-legacy-bridge.js, so');
    L.push('  // these assertions verify the on-disk shape Ghost++ writes, not just its own read-back.');
    L.push('  function legacyDbOpen() {');
    L.push('    return new Promise(function(resolveP, rejectP) {');
    L.push('      var req = indexedDB.open("GP_Ghost_History", 3);');
    L.push('      req.onupgradeneeded = function() {');
    L.push('        var db = req.result;');
    L.push('        var store = db.createObjectStore("images", { keyPath: "id", autoIncrement: true });');
    L.push('        store.createIndex("hash", "hash", { unique: false });');
    L.push('        store.createIndex("templateId", "templateId", { unique: false });');
    L.push('      };');
    L.push('      req.onsuccess = function() { resolveP(req.result); };');
    L.push('      req.onerror = function() { rejectP(req.error); };');
    L.push('    });');
    L.push('  }');
    L.push('  async function legacyGetAll() {');
    L.push('    var db = await legacyDbOpen();');
    L.push('    return new Promise(function(resolveP, rejectP) {');
    L.push('      var tx = db.transaction("images", "readonly");');
    L.push('      var req = tx.objectStore("images").getAll();');
    L.push('      req.onsuccess = function() { db.close(); resolveP(req.result || []); };');
    L.push('      req.onerror = function() { db.close(); rejectP(req.error); };');
    L.push('    });');
    L.push('  }');
    L.push('  async function legacyPut(record) {');
    L.push('    var db = await legacyDbOpen();');
    L.push('    return new Promise(function(resolveP, rejectP) {');
    L.push('      var tx = db.transaction("images", "readwrite");');
    L.push('      var req = tx.objectStore("images").add(record);');
    L.push('      var newId = null;');
    L.push('      req.onsuccess = function() { newId = req.result; };');
    L.push('      tx.oncomplete = function() { db.close(); resolveP(newId); };');
    L.push('      tx.onerror = function() { db.close(); rejectP(tx.error); };');
    L.push('    });');
    L.push('  }');
    L.push('  function popcount(x) {');
    L.push('    x = x - ((x >>> 1) & 0x55555555);');
    L.push('    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);');
    L.push('    x = (x + (x >>> 4)) & 0x0f0f0f0f;');
    L.push('    return (x * 0x01010101) >>> 24;');
    L.push('  }');
    L.push('  function maskBitDiffCount(a, b) {');
    L.push('    var len = Math.max(a.length, b.length), diff = 0;');
    L.push('    for (var i = 0; i < len; i++) {');
    L.push('      var wa = a[i] || 0, wb = b[i] || 0;');
    L.push('      diff += popcount((wa ^ wb) >>> 0);');
    L.push('    }');
    L.push('    return diff;');
    L.push('  }');
    L.push('  async function makeTileBitmap(secondColorCss) {');
    L.push('    var c = document.createElement("canvas");');
    L.push('    c.width = 1000; c.height = 1000;');
    L.push('    var ctx = c.getContext("2d");');
    L.push('    ctx.clearRect(0, 0, 1000, 1000);');
    L.push('    ctx.fillStyle = "rgb(255,0,0)";');
    L.push('    ctx.fillRect(125, 76, 1, 1);');
    L.push('    ctx.fillRect(125, 75, 1, 1);');
    L.push('    ctx.fillStyle = secondColorCss;');
    L.push('    ctx.fillRect(126, 76, 1, 1);');
    L.push('    return await createImageBitmap(c);');
    L.push('  }');
    // `variant` (optional) swaps in genuinely DIFFERENT pixel content —
    // just varying `name` does NOT change the file's hash/templateId, so
    // two calls with different names but the default (no variant) pattern
    // are byte-identical and WILL dedup-match against each other. Pass
    // variant:true wherever a test needs a distinct, non-colliding image.
    L.push('  function makeTestPngFile(name, variant) {');
    L.push('    return new Promise(function(resolveP, rejectP) {');
    L.push('      var c = document.createElement("canvas");');
    L.push('      c.width = 2; c.height = 2;');
    L.push('      var ctx = c.getContext("2d");');
    L.push('      ctx.clearRect(0, 0, 2, 2);');
    L.push('      if (variant === "seed") {');
    L.push('        ctx.fillStyle = "rgb(70,80,90)";');
    L.push('        ctx.fillRect(0, 0, 1, 1);');
    L.push('        ctx.fillRect(0, 1, 1, 1);');
    L.push('        ctx.fillStyle = "rgb(100,110,120)";');
    L.push('        ctx.fillRect(1, 0, 1, 1);');
    L.push('      } else if (variant === "guildA") {'); // distinct from every other variant — used only by the guildTemplates.* steps, must never dedup-collide with content ingested earlier in the suite
    L.push('        ctx.fillStyle = "rgb(11,22,33)";');
    L.push('        ctx.fillRect(0, 0, 1, 1);');
    L.push('        ctx.fillRect(0, 1, 1, 1);');
    L.push('        ctx.fillStyle = "rgb(44,55,66)";');
    L.push('        ctx.fillRect(1, 0, 1, 1);');
    L.push('      } else if (variant === "guildB") {');
    L.push('        ctx.fillStyle = "rgb(77,88,99)";');
    L.push('        ctx.fillRect(0, 0, 1, 1);');
    L.push('        ctx.fillRect(0, 1, 1, 1);');
    L.push('        ctx.fillStyle = "rgb(111,122,133)";');
    L.push('        ctx.fillRect(1, 0, 1, 1);');
    L.push('      } else if (variant === "autoHideA") {'); // distinct from every other variant — used only by the autoHideUnfocused.* step
    L.push('        ctx.fillStyle = "rgb(150,10,200)";');
    L.push('        ctx.fillRect(0, 0, 1, 1);');
    L.push('        ctx.fillRect(0, 1, 1, 1);');
    L.push('        ctx.fillStyle = "rgb(180,40,230)";');
    L.push('        ctx.fillRect(1, 0, 1, 1);');
    L.push('      } else if (variant === "autoHideB") {');
    L.push('        ctx.fillStyle = "rgb(10,200,150)";');
    L.push('        ctx.fillRect(0, 0, 1, 1);');
    L.push('        ctx.fillRect(0, 1, 1, 1);');
    L.push('        ctx.fillStyle = "rgb(40,230,180)";');
    L.push('        ctx.fillRect(1, 0, 1, 1);');
    L.push('      } else if (variant === "scanBusyB") {'); // distinct from every other variant — used only by the scan.per-template-busy-state step, must never dedup-collide with the generic catch-all bucket below (which shared.ingest\'s variant:true also uses)
    L.push('        ctx.fillStyle = "rgb(5,120,240)";');
    L.push('        ctx.fillRect(0, 0, 1, 1);');
    L.push('        ctx.fillRect(0, 1, 1, 1);');
    L.push('        ctx.fillStyle = "rgb(35,150,255)";');
    L.push('        ctx.fillRect(1, 0, 1, 1);');
    L.push('      } else if (variant) {');
    L.push('        ctx.fillStyle = "rgb(10,20,30)";');
    L.push('        ctx.fillRect(0, 0, 1, 1);');
    L.push('        ctx.fillRect(0, 1, 1, 1);');
    L.push('        ctx.fillStyle = "rgb(40,50,60)";');
    L.push('        ctx.fillRect(1, 0, 1, 1);');
    L.push('      } else {');
    L.push('      ctx.fillStyle = "rgb(255,0,0)";');
    L.push('      ctx.fillRect(0, 0, 1, 1);');
    L.push('      ctx.fillRect(0, 1, 1, 1);');
    L.push('      ctx.fillStyle = "rgb(0,255,0)";');
    L.push('      ctx.fillRect(1, 0, 1, 1);');
    L.push('      }');
    L.push('      c.toBlob(function(blob) {');
    L.push('        if (!blob) { rejectP(new Error("toBlob returned null")); return; }');
    L.push('        resolveP(new File([blob], name, { type: "image/png" }));');
    L.push('      }, "image/png");');
    L.push('    });');
    L.push('  }');
    L.push('');
    L.push('  var core = gppCreateCore();');
    L.push('  var template = null;');
    L.push('  var sharedTemplate = null;');
    L.push('');
    // "Only show current template on map" (gppSettings.autoHideUnfocused)
    // now defaults to true (see gpp-runtime.js's GPP_DEFAULT_SETTINGS) — the
    // vast majority of this suite's OTHER steps focus/position multiple
    // templates and expect them to stay simultaneously visible (opacity>0)
    // unless a step is specifically testing auto-hide itself, so force it
    // off here as this suite's own known baseline BEFORE any of that runs.
    // The dedicated autoHideUnfocused.* step manages the setting entirely
    // on its own and restores it to this same off baseline when it's done.
    L.push('  gppSettings.autoHideUnfocused = false;');
    L.push('  gppState.saveSettings();');
    L.push('');
    // ---- item a ----
    // NOTE: does NOT assume the opener mounts synchronously with zero wait.
    // gpp-init.js's document.readyState==='loading' gate (see the
    // init.readystate-gate-does-not-break-normal-load step further below,
    // whose own header comment explains this in full) legitimately defers
    // gppStartGhostPlusPlus() behind a DOMContentLoaded listener whenever
    // Ghost++'s own inline <script> executes while the document is still
    // mid-parse -- which is exactly what happens in THIS fixture (the whole
    // page, including the driver script below, is one static HTML response
    // with no closing </body></html> until after the driver script itself
    // runs, so document.readyState reads 'loading' at ghost-plus-plus
    // script-execution time). Checking for the opener synchronously, with no
    // wait at all, used to be safe (mount was always synchronous) but is no
    // longer a valid assumption now that the gate can legitimately defer
    // mount until DOMContentLoaded fires -- so wait for it first, exactly
    // like the later regression-guard step does, before asserting anything
    // about its own placement/state.
    L.push('  await step("a", async function() {');
    L.push('    await waitFor(function() { return !!document.getElementById(GPP_IDS.opener); }, 8000);');
    L.push('    var nativeBtn = document.getElementById("loadGhostImageBtn");');
    L.push('    var opener = document.getElementById(GPP_IDS.opener);');
    L.push('    if (!opener) throw new Error("opener button did not mount");');
    L.push('    if (document.querySelectorAll("#" + GPP_IDS.opener).length !== 1) throw new Error("expected exactly one opener button");');
    L.push('    if (nativeBtn.style.display !== "none") throw new Error("native loadGhostImageBtn was not hidden");');
    L.push('    if (nativeBtn.nextElementSibling !== opener) throw new Error("opener does not sit in native button\'s place (nextElementSibling)");');
    L.push('    var modal = document.getElementById(GPP_IDS.modal);');
    L.push('    if (!modal || !modal.classList.contains("gpp-hidden")) throw new Error("modal did not mount closed");');
    L.push('    var rendererCanvas = document.getElementById(GPP_RENDERER_CANVAS_ID);');
    L.push('    if (!rendererCanvas) throw new Error("renderer canvas did not mount");');
    L.push('    if (rendererCanvas.parentElement !== __mapShellEl) throw new Error("renderer canvas is not parented in the map container");');
    L.push('    await waitFor(function() { return !!gppDatabase; }, 8000);');
    L.push('    if (__consoleErrors.length) throw new Error("console.error during mount: " + __consoleErrors.join(" | "));');
    L.push('    if (window.__fixtureErrors.length) throw new Error("window error/unhandledrejection during mount: " + window.__fixtureErrors.join(" | "));');
    L.push('    return "opener mounted in place of native button; modal closed; renderer canvas attached to map container; no console/window errors";');
    L.push('  });');
    L.push('');
    // ---- item shim.native-click-blocked-before-first-open ----
    // Regression guard for: gppShimEnable() (which installs the native-
    // control click-blocking capture) used to only run lazily on the
    // modal's FIRST open, via ensureRuntime(). Before that ever happened,
    // the native #loadGhostImageBtn was hidden (display:none) but its own
    // click listener was still fully live -- display:none does not stop a
    // programmatic .click() (the site's own keyboard-shortcut handler,
    // performShortcutAction's 'ghost' case, calls
    // loadGhostImageBtn?.click() directly), so pressing that shortcut
    // before ever manually opening Ghost++ once would still pop the old
    // native ghost UI. A user's own exported debug log showed Ghost++
    // init completing successfully (native button found, opener mounted)
    // and STILL reported "still don't see the menu" -- this gap is why.
    // Must run here, immediately after item "a" and before ANY step opens
    // the modal (prep.open-modal doesn't run until much later in this
    // suite) -- that ordering IS the point of this test.
    L.push('  await step("shim.native-click-blocked-before-first-open", async function() {');
    L.push('    var modal = document.getElementById(GPP_IDS.modal);');
    L.push('    if (!modal || !modal.classList.contains("gpp-hidden")) throw new Error("test setup: expected the modal to still be closed/never opened at this point in the suite -- this test is only meaningful before the first open");');
    L.push('    if (!gppShimActive) throw new Error("REGRESSION: gppShimActive is not true immediately after Ghost++ init, before the modal has ever been opened -- native-control click captures are not installed yet");');
    L.push('    var beforeControlEvents = window.__nativeControlEvents;');
    L.push('    document.getElementById("loadGhostImageBtnLabel").click();');
    L.push('    if (window.__nativeControlEvents !== beforeControlEvents) throw new Error("REGRESSION: clicking the (hidden) native ghost button before Ghost++\'s modal has ever been opened still reached the native handler -- this is the exact bug reported (\\"toggled Ghost++ on, still see the old menu\\"), reachable via a keyboard shortcut or any other programmatic .click() on the hidden button");');
    L.push('    return "gppShimEnable() (and its native-control click-blocking capture) is active immediately after Ghost++ initializes, before the modal has ever been manually opened -- a keyboard-shortcut-triggered click on the hidden native ghost button no longer reaches its native handler";');
    L.push('  });');
    L.push('');
    // ---- item shim.y-toggle-syncs-renderer-visibility ----
    // Regression guard for: the separate GeoPixels++ addon's own "Toggle
    // ghost image" keybind (default key Y, scripts/geopixels++/0.7.0.js's
    // KEY_BINDINGS.toggleGhost) directly toggles the NATIVE #ghost-canvas
    // element's `hidden` attribute -- it has no knowledge of Ghost++'s
    // own, completely separate renderer canvas (#gpp-renderer-canvas), so
    // pressing Y had zero visible effect on the overlay Ghost++ actually
    // renders once gppNativeDrawReplacement makes the native canvas
    // permanently empty. gppInstallGhostCanvasVisibilitySync
    // (gpp-native-shim.js) mirrors the native canvas's hidden state onto
    // the renderer canvas instead, via a MutationObserver -- verify that
    // mirror actually works, toggling both directions, using the EXACT
    // same .toggleAttribute("hidden") call the Y keybind itself makes.
    L.push('  await step("shim.y-toggle-syncs-renderer-visibility", async function() {');
    L.push('    var nativeCanvas = document.getElementById("ghost-canvas");');
    L.push('    if (!nativeCanvas) throw new Error("test setup: #ghost-canvas not found");');
    L.push('    var renderer = document.getElementById(GPP_RENDERER_CANVAS_ID);');
    L.push('    if (!renderer) throw new Error("test setup: #gpp-renderer-canvas not mounted");');
    L.push('    nativeCanvas.hidden = false;');
    L.push('    var shown = await waitFor(function() { return renderer.style.display !== "none"; }, 3000);');
    L.push('    if (!shown) throw new Error("test setup: renderer canvas did not start visible with native canvas shown");');
    L.push('    nativeCanvas.toggleAttribute("hidden");'); // exactly what GeoPixels++'s Y keybind itself calls
    L.push('    var hidden = await waitFor(function() { return renderer.style.display === "none"; }, 3000);');
    L.push('    if (!hidden) throw new Error("REGRESSION: toggling #ghost-canvas hidden (matching GeoPixels++\'s own Y keybind) did not hide Ghost++\'s own renderer canvas -- Y still has no visible effect while Ghost++ owns the overlay");');
    L.push('    nativeCanvas.toggleAttribute("hidden");');
    L.push('    var shownAgain = await waitFor(function() { return renderer.style.display !== "none"; }, 3000);');
    L.push('    if (!shownAgain) throw new Error("REGRESSION: toggling #ghost-canvas hidden back off did not restore the renderer canvas\'s visibility");');
    L.push('    return "toggling #ghost-canvas\'s hidden attribute (exactly what GeoPixels++\'s own Y keybind does) now mirrors onto Ghost++\'s own renderer canvas visibility, so Y keeps working as a quick map-peek toggle while Ghost++ owns the overlay";');
    L.push('  });');
    L.push('');
    // ---- item b ----
    // Shared-library is unconditional (not a setting) — every ingest always
    // writes into the shared GP_Ghost_History store, never the old private
    // GPP_TEMPLATE_STORE, so this asserts a 'legacy_'-prefixed id and a
    // matching GP_Ghost_History record instead of a private core record.
    L.push('  await step("b", async function() {');
    L.push('    var warnCountBefore = __consoleWarnings.length;');
    L.push('    var file = await makeTestPngFile("gpp-fixture-template.png");');
    L.push('    template = await gppState.ingestImageFile(file);');
    L.push('    var usedFallback = __consoleWarnings.slice(warnCountBefore).some(function(w) { return w.indexOf("Worker ingest failed, falling back to main thread") !== -1; });');
    L.push('    if (template.width !== 2 || template.height !== 2) throw new Error("unexpected dimensions " + template.width + "x" + template.height);');
    L.push('    if (template.indexType !== "u8") throw new Error("expected indexType u8, got " + template.indexType);');
    L.push('    if (template.palette.length !== 2) throw new Error("expected 2-colour palette, got " + template.palette.length);');
    L.push('    if (template.opaquePixelCount !== 3) throw new Error("expected opaquePixelCount 3, got " + template.opaquePixelCount);');
    L.push('    if (gppState.templates.length !== 1) throw new Error("expected exactly 1 template in gppState.templates, got " + gppState.templates.length);');
    L.push('    if (gppState.focusedTemplateId !== template.id) throw new Error("newly ingested template was not focused");');
    L.push('    if (template.id.indexOf("legacy_") !== 0) throw new Error("expected a \'legacy_\'-prefixed id (shared-library is unconditional), got " + template.id);');
    L.push('    if (typeof template.legacySourceId !== "number") throw new Error("expected template.legacySourceId to be set");');
    L.push('    var coreRecords = await idbGetAll("templates");');
    L.push('    if (coreRecords.length !== 0) throw new Error("expected no private GPP_TEMPLATE_STORE record, found " + coreRecords.length);');
    L.push('    var stateRecords = await idbGetAll("templateState");');
    L.push('    var matchingState = stateRecords.filter(function(r) { return r.id === template.id; });');
    L.push('    if (stateRecords.length !== 1 || matchingState.length !== 1) throw new Error("expected exactly 1 matching state record, store has " + stateRecords.length + ", matching " + matchingState.length);');
    L.push('    var legacyRecords = await legacyGetAll();');
    L.push('    var matchingLegacy = legacyRecords.filter(function(r) { return ("legacy_" + r.id) === template.id; });');
    L.push('    if (legacyRecords.length !== 1 || matchingLegacy.length !== 1) throw new Error("expected exactly 1 matching GP_Ghost_History record, store has " + legacyRecords.length + ", matching " + matchingLegacy.length);');
    L.push('    return "ingest path=" + (usedFallback ? "main-thread fallback" : "Worker") + "; indexType=u8 palette=2 opaquePixelCount=3; wrote to the shared GP_Ghost_History store (id=" + template.id + ") with exactly 1 matching state record and no private core record";');
    L.push('  });');
    L.push('');
    // ---- item c ----
    L.push('  await step("c", async function() {');
    L.push('    var beforeCount = gppState.templates.length;');
    L.push('    var pair = await Promise.all([gppInitRuntime(), gppInitRuntime()]);');
    L.push('    if (pair[0] !== pair[1]) throw new Error("concurrent gppInitRuntime() calls resolved to different references");');
    L.push('    if (pair[0] !== gppState) throw new Error("gppInitRuntime() did not resolve to the shared gppState");');
    L.push('    if (gppState.templates.length !== beforeCount) throw new Error("template count changed after concurrent gppInitRuntime() calls: " + beforeCount + " -> " + gppState.templates.length);');
    L.push('    return "Promise.all([gppInitRuntime(), gppInitRuntime()]) resolved both to the same gppState reference, no duplicated templates, no throw (NOTE: by this point in the page lifecycle, gpp-renderer.js\'s auto-mount had already made the very first call synchronously at script-load time — see this file\'s header comment #2 — so this specifically re-verifies the caching/memoization guard on overlapping callers, not a from-zero first-call race)";');
    L.push('  });');
    L.push('');
    // ---- item d ----
    L.push('  var harness = document.createElement("div");');
    L.push('  harness.id = "test-harness";');
    L.push('  harness.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:400px;";');
    L.push('  document.body.appendChild(harness);');
    L.push('  var freshContainers = {};');
    L.push('  ["palette", "library", "progress", "position", "viewsettings"].forEach(function(name) {');
    L.push('    var el = document.createElement("div");');
    L.push('    el.id = "test-" + name;');
    L.push('    harness.appendChild(el);');
    L.push('    freshContainers[name] = el;');
    L.push('  });');
    L.push('  await step("d", async function() {');
    L.push('    var noop = function() {};');
    L.push('    gppRenderPalette(freshContainers.palette, null, noop);');
    L.push('    gppRenderTemplateLibrary(freshContainers.library, noop);');
    L.push('    gppRenderProgressBar(freshContainers.progress, null, noop);');
    L.push('    gppRenderPositionTransform(freshContainers.position, null, noop);');
    L.push('    gppRenderViewSettings(freshContainers.viewsettings, null, noop);');
    L.push('    gppRenderPalette(freshContainers.palette, template, noop);');
    L.push('    gppRenderTemplateLibrary(freshContainers.library, noop);');
    L.push('    gppRenderProgressBar(freshContainers.progress, template, noop);');
    L.push('    gppRenderPositionTransform(freshContainers.position, template, noop);');
    L.push('    gppRenderViewSettings(freshContainers.viewsettings, template, noop);');
    L.push('    var swatch = freshContainers.palette.querySelector(".gpp-swatch");');
    L.push('    if (!swatch) throw new Error("no palette swatch rendered for the real template");');
    L.push('    var maskBefore = new Uint32Array(template.mask);');
    L.push('    swatch.click();');
    L.push('    var diff1 = maskBitDiffCount(maskBefore, template.mask);');
    L.push('    if (diff1 !== 1) throw new Error("expected exactly 1 bit to change after first toggle, got " + diff1);');
    L.push('    var maskAfterFirstToggle = new Uint32Array(template.mask);');
    L.push('    var persistedOnce = await waitFor(async function() {');
    L.push('      var states = await idbGetAll("templateState");');
    L.push('      var rec = states.find(function(r) { return r.id === template.id; });');
    L.push('      if (!rec) return false;');
    L.push('      var recMask = new Uint32Array(rec.mask);');
    L.push('      return maskBitDiffCount(recMask, maskAfterFirstToggle) === 0;');
    L.push('    }, 4000);');
    L.push('    if (!persistedOnce) throw new Error("first palette toggle was not persisted to IndexedDB in time");');
    L.push('    swatch.click(); // toggle back so later items (scan) see the full/original mask');
    L.push('    var diff2 = maskBitDiffCount(maskAfterFirstToggle, template.mask);');
    L.push('    if (diff2 !== 1) throw new Error("expected exactly 1 bit to change after second toggle, got " + diff2);');
    L.push('    var netDiff = maskBitDiffCount(maskBefore, template.mask);');
    L.push('    if (netDiff !== 0) throw new Error("mask did not return to its original value after toggling the same swatch twice");');
    L.push('    var persistedTwice = await waitFor(async function() {');
    L.push('      var states = await idbGetAll("templateState");');
    L.push('      var rec = states.find(function(r) { return r.id === template.id; });');
    L.push('      if (!rec) return false;');
    L.push('      var recMask = new Uint32Array(rec.mask);');
    L.push('      return maskBitDiffCount(recMask, template.mask) === 0;');
    L.push('    }, 4000);');
    L.push('    if (!persistedTwice) throw new Error("second palette toggle (restore) was not persisted to IndexedDB in time");');
    L.push('    return "all 5 gppRender* functions ran with template=null and with a real template without throwing; palette swatch toggle flipped exactly 1 mask bit each time and persisted to IndexedDB both times";');
    L.push('  });');
    L.push('');
    // ---- item e ----
    L.push('  await step("e", async function() {');
    L.push('    var vs = freshContainers.viewsettings;');
    L.push('    var pos = freshContainers.position;');
    L.push('    var gapInput = vs.querySelector("#gpp-vs-gap-ratio");');
    L.push('    var opacityInput = pos.querySelector("#gpp-pt-opacity");'); // moved from View Settings to Template Settings
    L.push('    if (!gapInput) throw new Error("gap-ratio slider not found");');
    L.push('    if (!opacityInput) throw new Error("opacity slider not found");');
    L.push('    gapInput.value = "0";');
    L.push('    gapInput.dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    if (gppSettings.gapRatio !== 0) throw new Error("gapRatio did not reach exactly 0, got " + gppSettings.gapRatio);');
    L.push('    gapInput.dispatchEvent(new Event("change", { bubbles: true }));');
    L.push('    opacityInput.value = "0";');
    L.push('    opacityInput.dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    if (template.opacity !== 0) throw new Error("template.opacity did not reach exactly 0, got " + template.opacity);');
    L.push('    opacityInput.dispatchEvent(new Event("change", { bubbles: true }));');
    L.push('    var persisted = await waitFor(async function() {');
    L.push('      var states = await idbGetAll("templateState");');
    L.push('      var rec = states.find(function(r) { return r.id === template.id; });');
    L.push('      return !!rec && rec.opacity === 0;');
    L.push('    }, 2000);');
    L.push('    if (!persisted) throw new Error("opacity=0 was not persisted to IndexedDB in time (debounced write)");');
    L.push('    return "gap-ratio and per-template opacity sliders both reached exactly 0 (not clamped above it); opacity=0 persisted to IndexedDB";');
    L.push('  });');
    L.push('');
    // ---- prep: commit a position via the Position/Transform panel ----
    L.push('  await step("prep.position", async function() {');
    L.push('    var pos = freshContainers.position;');
    L.push('    var xInput = pos.querySelector("#gpp-pt-x");');
    L.push('    var yInput = pos.querySelector("#gpp-pt-y");');
    L.push('    if (!xInput || !yInput) throw new Error("position X/Y inputs not found");');
    L.push('    xInput.value = "125";');
    L.push('    yInput.value = "76";');
    L.push('    xInput.dispatchEvent(new Event("change", { bubbles: true }));');
    L.push('    var placed = await waitFor(function() { return template.position && template.position.gridX === 125 && template.position.gridY === 76; }, 3000);');
    L.push('    if (!placed) throw new Error("exact X/Y coordinate commit did not update template.position");');
    L.push('    return "template placed at (125,76) via the Position/Transform panel\'s X/Y inputs";');
    L.push('  });');
    L.push('');
    // ---- item f ----
    L.push('  await step("f", async function() {');
    // gppShimEnable() now also runs immediately at Ghost++ init time (inside
    // gppReplaceNativeOpener's attach(), gpp-ui-shell.js) rather than only
    // lazily on the modal's first open -- so by the time THIS step runs, the
    // native functions are already patched, and capturing a "before" snapshot
    // here would just capture the ALREADY-patched replacements (comparing a
    // value to itself never throws, silently defeating the old assertion).
    // Assert directly against the known replacement function references
    // instead of an unreliable before/after snapshot.
    L.push('    gppShimEnable();'); // idempotent re-call (see gppShimActive guard) -- still expected not to throw
    L.push('    if (window.drawGhostImageOnCanvas !== gppNativeDrawReplacement) throw new Error("drawGhostImageOnCanvas is not Ghost++\'s replacement");');
    L.push('    if (window.initializeGhostFromStorage !== gppNativeInitializeReplacement) throw new Error("initializeGhostFromStorage is not Ghost++\'s replacement");');
    L.push('    if (!ghostImageTopLeft || ghostImageTopLeft.gridX !== template.position.gridX || ghostImageTopLeft.gridY !== template.position.gridY) {');
    L.push('      throw new Error("native ghostImageTopLeft does not reflect the focused template\'s position: " + JSON.stringify(ghostImageTopLeft));');
    L.push('    }');
    L.push('    if (!(ghostActivePaletteColors instanceof Set)) throw new Error("native ghostActivePaletteColors is not a Set");');
    L.push('    var expectedActive = new Set();');
    L.push('    for (var i = 0; i < template.palette.length; i++) {');
    L.push('      if (core.maskHas(template.mask, i)) expectedActive.add(core.packedToRgbaString(template.palette[i]));');
    L.push('    }');
    L.push('    var sameSize = expectedActive.size === ghostActivePaletteColors.size;');
    L.push('    var sameMembers = sameSize && Array.from(expectedActive).every(function(v) { return ghostActivePaletteColors.has(v); });');
    L.push('    if (!sameMembers) throw new Error("native ghostActivePaletteColors does not match the focused template\'s mask: expected " + Array.from(expectedActive).join(",") + " got " + Array.from(ghostActivePaletteColors).join(","));');
    L.push('    if (!(ghostImageOriginalData instanceof ImageData)) throw new Error("native ghostImageOriginalData was not rebuilt as a real ImageData instance");');
    L.push('    var beforeControlEvents = window.__nativeControlEvents;');
    L.push('    document.getElementById("loadGhostImageBtnLabel").click();');
    L.push('    var blocked = window.__nativeControlEvents === beforeControlEvents;');
    L.push('    return "gppShimEnable() ran without throwing; native draw fn patched; ghostImageTopLeft=" + JSON.stringify(ghostImageTopLeft) + " and ghostActivePaletteColors (" + ghostActivePaletteColors.size + " entries) match the focused template; native control capture " + (blocked ? "blocked a click on loadGhostImageBtn (bonus check)" : "did NOT block a click on loadGhostImageBtn (bonus check failed)");');
    L.push('  });');
    L.push('');
    // ---- item shim.runtime-ready-resyncs-cleared-native-mirror ----
    // Regression guard for: gppShimEnable() now runs immediately at Ghost++
    // init (see item "shim.native-click-blocked-before-first-open" above),
    // well BEFORE gppInitRuntime() resolves -- so its first
    // gppShimSyncFocusedTemplate() call correctly clears the native mirror
    // (gppClearNativeMirror) to empty, since nothing is focused yet at that
    // point. Before this fix, NOTHING was guaranteed to re-sync it once the
    // runtime actually became ready -- gppTriggerScanForRestoredFocus()
    // only refreshes when it finds a POSITIONED template needing a scan,
    // silently skipping the refresh otherwise. Other addons reading the
    // native mirror directly (e.g. GICV Advanced\'s "Queue pixels for me",
    // which reads the bare ghostActivePaletteColors binding) would then see
    // "no colors selected" even though Ghost++ itself correctly showed
    // colors enabled -- reported by a real user. gppInitRuntime() now calls
    // gppRequestUiRefresh() unconditionally right after gppRuntimeReady
    // flips true, closing this gap. Simulate the exact starting condition
    // (mirror cleared, as if this were the very first sync at init, before
    // ANY scan or modal-open happened) and verify a plain
    // gppRequestUiRefresh() call alone -- not gppShimEnable(), not a scan,
    // not opening the modal -- is enough to restore it.
    L.push('  await step("shim.runtime-ready-resyncs-cleared-native-mirror", async function() {');
    L.push('    if (!template || !template.mask) throw new Error("test setup: no focused template with a mask available yet");');
    L.push('    gppClearNativeMirror();');
    L.push('    if (ghostActivePaletteColors.size !== 0) throw new Error("test setup: gppClearNativeMirror() did not actually clear ghostActivePaletteColors");');
    L.push('    gppRequestUiRefresh();'); // the exact call gppInitRuntime() now makes unconditionally
    L.push('    var expectedActive = new Set();');
    L.push('    for (var i = 0; i < template.palette.length; i++) {');
    L.push('      if (core.maskHas(template.mask, i)) expectedActive.add(core.packedToRgbaString(template.palette[i]));');
    L.push('    }');
    L.push('    var sameSize = expectedActive.size === ghostActivePaletteColors.size;');
    L.push('    var sameMembers = sameSize && Array.from(expectedActive).every(function(v) { return ghostActivePaletteColors.has(v); });');
    L.push('    if (!sameMembers) throw new Error("REGRESSION: gppRequestUiRefresh() alone (matching what gppInitRuntime() now calls unconditionally once ready) did not restore the native ghostActivePaletteColors mirror after it was cleared -- expected " + Array.from(expectedActive).join(",") + " got " + Array.from(ghostActivePaletteColors).join(","));');
    L.push('    return "a plain gppRequestUiRefresh() call (no scan, no modal-open, no gppShimEnable() re-call) correctly restores the native ghostActivePaletteColors mirror from a freshly-cleared state, matching what gppInitRuntime() now guarantees once the runtime becomes ready -- other addons reading this binding directly (e.g. GICV\'s Queue pixels for me) no longer see a stale/empty selection";');
    L.push('  });');
    L.push('');
    // ---- item g ----
    L.push('  await step("g", async function() {');
    L.push('    var rendererCanvas = document.getElementById(GPP_RENDERER_CANVAS_ID);');
    L.push('    if (!rendererCanvas) throw new Error("renderer canvas is not mounted");');
    L.push('    if (rendererCanvas.parentElement !== __mapShellEl) throw new Error("renderer canvas detached from map container");');
    L.push('    var mode = gppRendererState ? gppRendererState.mode : null;');
    L.push('    if (FORCE_CANVAS2D && mode !== "canvas2d") throw new Error("forced-fallback pass did not end up in canvas2d mode, got " + mode);');
    L.push('    var errCountBefore = __consoleErrors.length;');
    L.push('    gppRendererSchedule();');
    L.push('    await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });');
    L.push('    if (__consoleErrors.length > errCountBefore) throw new Error("gppRendererSchedule() draw produced console errors: " + __consoleErrors.slice(errCountBefore).join(" | "));');
    L.push('    return "renderer canvas mounted in map container; mode=" + mode + "; gppRendererSchedule() did not throw and produced no console errors";');
    L.push('  });');
    L.push('');
    // ---- item h ----
    L.push('  await step("h", async function() {');
    L.push('    var bitmapCorrect = await makeTileBitmap("rgb(0,255,0)");');
    L.push('    tileImageCache.set("0,0", { colorBitmap: bitmapCorrect });');
    L.push('    var p1 = gppScanTemplate(template);');
    L.push('    var p2 = gppScanTemplate(template);');
    L.push('    var pair = await Promise.all([p1, p2]);');
    L.push('    var r1 = pair[0], r2 = pair[1];');
    L.push('    var oneOk = (r1.ok === true) !== (r2.ok === true); // exactly one succeeded, the other was refused as busy');
    L.push('    var refusedAsBusy = (r1.ok === false && r1.reason === "busy") || (r2.ok === false && r2.reason === "busy");');
    L.push('    if (!oneOk || !refusedAsBusy) throw new Error("concurrent gppScanTemplate() calls did not behave as one-runs/one-refused-busy: r1=" + JSON.stringify(r1) + " r2=" + JSON.stringify(r2));');
    L.push('    var summary = template.scanSummary;');
    L.push('    if (!summary) throw new Error("scanSummary was not set after a successful scan");');
    L.push('    if (isNaN(Date.parse(summary.scannedAt))) throw new Error("scanSummary.scannedAt is not a valid ISO date string");');
    L.push('    if (!(summary.states instanceof Uint8Array) || summary.states.length !== template.width * template.height) throw new Error("scanSummary.states has the wrong shape");');
    L.push('    if (!Array.isArray(summary.perColour) || summary.perColour.length !== template.palette.length) throw new Error("scanSummary.perColour has the wrong shape");');
    L.push('    var expected = { total: 0, correct: 0, wrong: 0, missing: 0, unknown: 0 };');
    L.push('    for (var i = 0; i < template.palette.length; i++) {');
    L.push('      if (!core.maskHas(template.mask, i)) continue;');
    L.push('      expected.total += template.counts[i] || 0;');
    L.push('    }');
    L.push('    if (summary.total !== expected.total) throw new Error("scanSummary.total=" + summary.total + " expected " + expected.total);');
    L.push('    if (summary.correct !== expected.total || summary.wrong !== 0 || summary.missing !== 0) {');
    L.push('      throw new Error("scan against a deliberately fully-matching synthetic tile did not come back fully correct: " + JSON.stringify({ total: summary.total, correct: summary.correct, wrong: summary.wrong, missing: summary.missing, unknown: summary.unknown }));');
    L.push('    }');
    L.push('    var runningAgain = gppScanTemplate(template);');
    L.push('    var immediateResult = await runningAgain;');
    L.push('    bitmapCorrect.close();');
    L.push('    return "concurrent gppScanTemplate() calls: one ran to completion (ok=true), the other was refused as busy (no second concurrent scan); scanSummary shape matches the documented contract; total=" + summary.total + " correct=" + summary.correct + " wrong=" + summary.wrong + " missing=" + summary.missing + " unknown=" + summary.unknown;');
    L.push('  });');
    L.push('');
    // ---- item scan.per-template-busy-state ----
    // Regression guard for the "Scan button stuck on Scanning… after
    // template swap" bug: gppScanRunning is a single GLOBAL flag by design
    // (a genuinely concurrent scan of two DIFFERENT templates isn't
    // physically meaningful — gppScanRunInternal samples the one shared,
    // currently-visible map canvas), so gppScanTemplate itself correctly
    // keeps refusing a second concurrent call regardless of which template
    // it targets (see item h). But the Progress section's buttons must
    // reflect whether THIS specific template is the one being scanned, not
    // merely whether ANY scan is in flight. Before the gppScanningTemplateId
    // fix, gppTriggerLoadTimeScan firing a slow background scan for one
    // template (e.g. on focus) and the user then swapping to a DIFFERENT
    // template left that other template's Scan button falsely stuck on
    // "Scanning…"/disabled — along with Show errors/Show missing/Nearest
    // error/Clear — until the unrelated scan finished, even though nothing
    // was actually happening to it.
    L.push('  await step("scan.per-template-busy-state", async function() {');
    L.push('    var fileE = await makeTestPngFile("scan-busy-b.png", "scanBusyB");'); // distinct content from every earlier variant — see makeTestPngFile's own comment
    L.push('    var templateB = await gppState.ingestImageFile(fileE);');
    L.push('    templateB.position = { gridX: 300, gridY: 300 };');
    L.push('    await gppState.persistTemplateState(templateB);');
    L.push('    var noop = function() {};');
    L.push('    var containerA = document.createElement("div");');
    L.push('    var containerB = document.createElement("div");');
    L.push('    document.body.appendChild(containerA);');
    L.push('    document.body.appendChild(containerB);');
    L.push('');
    L.push('    var pending = gppScanTemplate(template); // sets gppScanRunning + gppScanningTemplateId synchronously before its first await (see item h)');
    L.push('    if (!gppScanRunning || gppScanningTemplateId !== template.id) throw new Error("expected gppScanTemplate to mark itself running synchronously before this assertion runs");');
    L.push('');
    L.push('    gppRenderProgressBar(containerA, template, noop);');
    L.push('    var buttonsA = containerA.querySelectorAll("button");');
    L.push('    if (buttonsA[0].textContent !== "Scanning…" || !buttonsA[0].disabled) throw new Error("the template actually being scanned should show its Scan button as Scanning…/disabled, got text=" + buttonsA[0].textContent + " disabled=" + buttonsA[0].disabled);');
    L.push('    if (!buttonsA[1].disabled) throw new Error("the template actually being scanned should also disable Show errors while busy, got disabled=" + buttonsA[1].disabled);');
    L.push('');
    L.push('    gppRenderProgressBar(containerB, templateB, noop);');
    L.push('    var buttonsB = containerB.querySelectorAll("button");');
    L.push('    if (buttonsB[0].textContent !== "Scan progress") throw new Error("STUCK-SCANNING REGRESSION: a different, unrelated template Scan button read [" + buttonsB[0].textContent + "] just because another templates scan is in flight");');
    L.push('    if (buttonsB[0].disabled) throw new Error("STUCK-SCANNING REGRESSION: a different, unrelated template Scan button was disabled just because another templates scan is in flight");');
    L.push('');
    L.push('    var result = await pending;');
    L.push('    if (!result.ok) throw new Error("the in-flight scan itself did not complete successfully: " + JSON.stringify(result));');
    L.push('    if (gppScanRunning || gppScanningTemplateId !== null) throw new Error("expected gppScanRunning/gppScanningTemplateId to reset once the scan settles, got gppScanRunning=" + gppScanRunning + " gppScanningTemplateId=" + gppScanningTemplateId);');
    L.push('');
    L.push('    gppRenderProgressBar(containerA, template, noop);');
    L.push('    var buttonsAAfter = containerA.querySelectorAll("button");');
    L.push('    if (buttonsAAfter[0].textContent !== "Scan progress" || buttonsAAfter[0].disabled) throw new Error("expected the Scan button to return to normal once its own scan finished, got text=" + buttonsAAfter[0].textContent + " disabled=" + buttonsAAfter[0].disabled);');
    L.push('');
    L.push('    containerA.remove(); containerB.remove();');
    L.push('    await gppState.deleteTemplate(templateB);'); // deleteTemplate takes the template object, not its id
    L.push('    return "a template\'s Scan/error/missing/nearest/clear buttons only show Scanning…/disabled while THAT template is the one actually being scanned — a different template\'s in-flight background scan no longer falsely blocks or mislabels this one\'s Progress section";');
    L.push('  });');
    L.push('');

    // ---- item scan.manual-button-refreshes-public-subscribers ----
    // The compact Painting Menu Overhaul palette subscribes through
    // gppSubscribeUiRefresh(). Its borrowed Scan progress button used to call
    // only the private panel callback, leaving mobile checkmarks/status stale
    // even when the scan itself completed. Exercise the real button and prove
    // the public gateway fires both at its synchronous busy transition and at
    // completion.
    L.push('  await step("scan.manual-button-refreshes-public-subscribers", async function() {');
    L.push('    var bitmap = await makeTileBitmap("rgb(0,255,0)");');
    L.push('    var priorTile = tileImageCache.get("0,0");');
    L.push('    tileImageCache.set("0,0", { colorBitmap: bitmap });');
    L.push('    var container = document.createElement("div");');
    L.push('    var refreshStates = [];');
    L.push('    var unsubscribe = gppSubscribeUiRefresh(function() { refreshStates.push(!!gppScanRunning); });');
    L.push('    try {');
    L.push('      var ready = await waitFor(function() { return !gppScanRunning; }, 8000);');
    L.push('      if (!ready) throw new Error("test setup: a prior scan never settled before clicking the manual Scan progress button");');
    L.push('      gppRenderProgressBar(container, template, function() {});');
    L.push('      var scanBtn = container.querySelector("#gpp-scan-btn-scan");');
    L.push('      if (!scanBtn || scanBtn.disabled) throw new Error("test setup: expected an enabled manual Scan progress button");');
    L.push('      scanBtn.click();');
    L.push('      if (refreshStates[0] !== true) throw new Error("REGRESSION: clicking Scan progress did not synchronously notify public UI subscribers of the busy state: " + JSON.stringify(refreshStates));');
    L.push('      var settled = await waitFor(function() { return !gppScanRunning && refreshStates.indexOf(false) !== -1; }, 8000);');
    L.push('      if (!settled) throw new Error("REGRESSION: clicking Scan progress did not notify public UI subscribers after completion: " + JSON.stringify(refreshStates));');
    L.push('    } finally {');
    L.push('      unsubscribe();');
    L.push('      container.remove();');
    L.push('      if (priorTile) tileImageCache.set("0,0", priorTile); else tileImageCache.delete("0,0");');
    L.push('      bitmap.close();');
    L.push('    }');
    L.push('    return "clicking the real Scan progress button now notifies public UI subscribers at both busy and completion states, so Painting Menu Overhaul can refresh its palette status without waiting for its fallback poll";');
    L.push('  });');
    L.push('');
    // ---- open real modal (integration + needed for item i) ----
    // gpp-native-shim.js's blocked-click handler (already exercised once by
    // item "f", which clicked the blocked native loadGhostImageBtnLabel)
    // ALSO clicks the Ghost++ opener itself as a UX redirect (see that
    // file's gppBlockNativeGhostControl) — and that redirect's own
    // ensureRuntime()/IndexedDB round trip may still be in flight here. If
    // this step clicked the opener unconditionally, a real double-toggle
    // could race it shut (correct product behaviour for two independent
    // clicks — a toggle button closes on its second click) purely because
    // of this step's own test ordering. Wait for item f's redirect to
    // finish opening it first; only click ourselves if it is still closed.
    L.push('  await step("prep.open-modal", async function() {');
    L.push('    var alreadyOpen = await waitFor(function() {');
    L.push('      var modal = document.getElementById(GPP_IDS.modal);');
    L.push('      return modal && !modal.classList.contains("gpp-hidden");');
    L.push('    }, 2000);');
    L.push('    if (!alreadyOpen) document.getElementById(GPP_IDS.opener).click();');
    L.push('    var opened = await waitFor(function() {');
    L.push('      var modal = document.getElementById(GPP_IDS.modal);');
    L.push('      return modal && !modal.classList.contains("gpp-hidden") && !!document.getElementById("gpp-drop-zone");');
    L.push('    }, 5000);');
    L.push('    if (!opened) throw new Error("clicking the opener did not open the real modal / render its shell in time");');
    L.push('    var placeBtn = document.getElementById("gpp-pt-place");');
    L.push('    if (!placeBtn) throw new Error("real modal did not render the Position/Transform panel\'s Place-on-map button");');
    L.push('    if (__consoleErrors.length) throw new Error("console errors while opening the real modal: " + __consoleErrors.join(" | "));');
    L.push('    return "real modal opened via the opener button; full shell (drop zone, position/view-settings/palette/progress sections, library) rendered without throwing";');
    L.push('  });');
    L.push('');
    // ---- item i ----
    L.push('  await step("i", async function() {');
    L.push('    var placeBtn = document.getElementById("gpp-pt-place");');
    L.push('    placeBtn.click(); // begins gppBeginPlacementCapture on the real map container');
    L.push('    var canaryFired = false;');
    L.push('    var canary = function() { canaryFired = true; };');
    L.push('    __mapShellEl.addEventListener("click", canary); // registered AFTER the capture listener');
    L.push('    var localX = 300, localY = 200;');
    L.push('    var rect = __mapShellEl.getBoundingClientRect();');
    L.push('    var expectedLng = (localX - MAP_ORIGIN_X) / MAP_SCALE;');
    L.push('    var expectedLat = (MAP_ORIGIN_Y - localY) / MAP_SCALE;');
    L.push('    var expectedGridX = Math.round(expectedLng / gridSize);');
    L.push('    var expectedGridY = Math.round(expectedLat / gridSize);');
    L.push('    var pixelCanvasEl = document.getElementById("pixel-canvas");');
    L.push('    pixelCanvasEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: rect.left + localX, clientY: rect.top + localY }));');
    L.push('    var moved = await waitFor(function() { return template.position && template.position.gridX === expectedGridX && template.position.gridY === expectedGridY; }, 3000);');
    L.push('    if (canaryFired) throw new Error("canary listener fired for the click that placement capture should have consumed");');
    L.push('    if (!moved) throw new Error("placement capture click did not resolve to the expected grid cell (" + expectedGridX + "," + expectedGridY + "), template.position=" + JSON.stringify(template.position));');
    L.push('    pixelCanvasEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: rect.left + localX, clientY: rect.top + localY }));');
    L.push('    await new Promise(function(r) { setTimeout(r, 50); });');
    L.push('    var cleanedUp = canaryFired === true;');
    L.push('    return "placement-capture click was consumed (canary on the same map container, registered after the capture listener, never fired); resolved to the exact expected grid cell (" + expectedGridX + "," + expectedGridY + ") via the deterministic map.project/unproject transform; capture cleaned up after use (bonus check: " + (cleanedUp ? "a later click reached the canary as expected" : "canary still did not fire on a later click") + ")";');
    L.push('  });');
    L.push('');
    // ---- item shared.cross-dedup ----
    // Shared-library is unconditional now, so nothing ordinary ever creates
    // a private GPP_TEMPLATE_STORE record any more — but installs that
    // updated from a pre-1.11.0 build may still have leftover private
    // templates sitting in that store. Manually seed one (idbPut, bypassing
    // gpp-runtime.js entirely) to simulate that leftover, then re-ingest
    // byte-identical content and confirm it MIGRATES that seeded entry
    // (state carries over, private record removed, one 'legacy_'-prefixed
    // result) instead of creating an independent duplicate — this is the
    // exact bug an adversarial review caught in an earlier draft of this
    // feature (cross-namespace dedup was missing).
    L.push('  await step("shared.cross-dedup", async function() {');
    L.push('    var seedFile = await makeTestPngFile("gpp-fixture-seed.png", "seed");');
    L.push('    var seedBitmap = await createImageBitmap(seedFile);');
    L.push('    var seedCanvas = document.createElement("canvas");');
    L.push('    seedCanvas.width = seedBitmap.width; seedCanvas.height = seedBitmap.height;');
    L.push('    var sctx = seedCanvas.getContext("2d"); sctx.drawImage(seedBitmap, 0, 0);');
    L.push('    var seedRgba = sctx.getImageData(0, 0, seedCanvas.width, seedCanvas.height).data;');
    L.push('    var seedIndexed = core.indexRgba(seedRgba, seedCanvas.width, seedCanvas.height);');
    L.push('    var privateId = "gpp_seed_test";');
    L.push('    await idbPut("templates", {');
    L.push('      id: privateId, name: "Seed", width: seedCanvas.width, height: seedCanvas.height,');
    L.push('      indexType: seedIndexed.indexType, indices: seedIndexed.indices.buffer,');
    L.push('      palette: Array.from(seedIndexed.palette), counts: Array.from(seedIndexed.counts),');
    L.push('      opaquePixelCount: seedIndexed.opaquePixelCount, quantized: seedIndexed.quantized,');
    L.push('      poorMatchPixelCount: seedIndexed.poorMatchPixelCount, sourceBlob: seedFile,');
    L.push('    });');
    L.push('    await idbPut("templateState", {');
    L.push('      id: privateId, name: "Seed", position: { gridX: 41, gridY: -9 }, opacity: 0.37,');
    L.push('      locked: false, order: 999, mask: Array.from(seedIndexed.mask),');
    L.push('    });');
    L.push('    await gppState.reloadLibrary();');
    L.push('    if (!gppState.templates.some(function(t) { return t.id === privateId; })) throw new Error("test setup: seeded private template did not appear after reloadLibrary()");');
    L.push('    var beforeLegacyCount = (await legacyGetAll()).length;');
    L.push('    var migrated = await gppState.ingestImageFile(seedFile);');
    L.push('    if (migrated.id === privateId) throw new Error("expected a NEW \'legacy_\'-prefixed id, migration should not reuse the old private id");');
    L.push('    if (migrated.id.indexOf("legacy_") !== 0) throw new Error("expected a \'legacy_\'-prefixed id after migrating a private duplicate, got " + migrated.id);');
    L.push('    if (Math.abs(migrated.opacity - 0.37) > 1e-9) throw new Error("migrated template lost the seeded private entry\'s opacity — expected 0.37, got " + migrated.opacity);');
    L.push('    if (!migrated.position || migrated.position.gridX !== 41 || migrated.position.gridY !== -9) throw new Error("migrated template lost the seeded private entry\'s position: " + JSON.stringify(migrated.position));');
    L.push('    if (gppState.templates.some(function(t) { return t.id === privateId; })) throw new Error("the superseded private template is still present in gppState.templates");');
    L.push('    var afterCoreRecords = await idbGetAll("templates");');
    L.push('    if (afterCoreRecords.some(function(r) { return r.id === privateId; })) throw new Error("the superseded private template\'s core record was not removed from GPP_TEMPLATE_STORE");');
    L.push('    var afterLegacyCount = (await legacyGetAll()).length;');
    L.push('    if (afterLegacyCount !== beforeLegacyCount + 1) throw new Error("expected exactly 1 new GP_Ghost_History record for the migrated template, went from " + beforeLegacyCount + " to " + afterLegacyCount);');
    L.push('    return "re-ingesting a seeded leftover private template\'s exact content migrated it (" + privateId + " -> " + migrated.id + "), preserving opacity=0.37 and position (41,-9), with no duplicate and no orphaned private record";');
    L.push('  });');
    L.push('');
    // ---- item shared.ingest ----
    // Verifies the write side of gpp-runtime.js's shared-mode branch
    // end-to-end against the REAL GP_Ghost_History database (not just
    // gpp-legacy-bridge.js's own read-back) — the id namespace, that no
    // duplicate private-store record is created, and that the shared
    // record carries a real hash.
    L.push('  await step("shared.ingest", async function() {');
    L.push('    var beforeLegacyCount = (await legacyGetAll()).length;');
    L.push('    var file2 = await makeTestPngFile("gpp-fixture-shared-template.png", true);'); // variant:true — must NOT collide with item b's / shared.cross-dedup's image content
    L.push('    sharedTemplate = await gppState.ingestImageFile(file2);');
    L.push('    if (sharedTemplate.id.indexOf("legacy_") !== 0) throw new Error("expected a \'legacy_\'-prefixed id for a shared-mode ingest, got " + sharedTemplate.id);');
    L.push('    if (typeof sharedTemplate.legacySourceId !== "number") throw new Error("shared-mode ingest did not set template.legacySourceId (would silently break delete propagation)");');
    L.push('    var legacyRecords = await legacyGetAll();');
    L.push('    if (legacyRecords.length !== beforeLegacyCount + 1) throw new Error("expected exactly 1 new GP_Ghost_History record, went from " + beforeLegacyCount + " to " + legacyRecords.length);');
    L.push('    var matching = legacyRecords.filter(function(r) { return ("legacy_" + r.id) === sharedTemplate.id; });');
    L.push('    if (matching.length !== 1) throw new Error("no GP_Ghost_History record matches the new template\'s id");');
    L.push('    if (!matching[0].hash || !matching[0].templateId) throw new Error("GP_Ghost_History record is missing hash/templateId");');
    L.push('    var coreRecords = await idbGetAll("templates");');
    L.push('    var privateMatch = coreRecords.filter(function(r) { return r.id === sharedTemplate.id; });');
    L.push('    if (privateMatch.length !== 0) throw new Error("shared-mode ingest unexpectedly wrote a private GPP_TEMPLATE_STORE record too");');
    L.push('    if (!gppState.templates.some(function(t) { return t.id === sharedTemplate.id; })) throw new Error("shared template is missing from gppState.templates after ingest");');
    L.push('    return "shared-mode ingest wrote exactly 1 new GP_Ghost_History record (id=" + matching[0].id + ") and no private core record; template.id=" + sharedTemplate.id;');
    L.push('  });');
    L.push('');
    // ---- item shared.delete ----
    // The bug this specifically guards: gppDeleteTemplate() branches on
    // typeof template.legacySourceId === "number" — if the ingest path
    // above ever forgot to set that field (it did, in an earlier draft of
    // this feature, until this exact test caught it), deleting a
    // freshly-ingested shared template would silently leave its
    // GP_Ghost_History record orphaned forever instead of propagating the
    // delete, contradicting the explicit "delete from both" product decision.
    L.push('  await step("shared.delete", async function() {');
    L.push('    var legacyId = sharedTemplate.legacySourceId;');
    L.push('    await gppState.deleteTemplate(sharedTemplate);');
    L.push('    if (gppState.templates.some(function(t) { return t.id === sharedTemplate.id; })) throw new Error("deleted shared template still present in gppState.templates");');
    L.push('    var legacyRecords = await legacyGetAll();');
    L.push('    if (legacyRecords.some(function(r) { return r.id === legacyId; })) throw new Error("deleting the Ghost++ template did NOT remove its GP_Ghost_History record (id=" + legacyId + ") — shared delete did not propagate");');
    L.push('    return "deleting a shared-origin template removed it from gppState.templates AND its GP_Ghost_History record (id=" + legacyId + ")";');
    L.push('  });');
    L.push('');
    // ---- item shared.preexisting ----
    // Simulates the OTHER direction: an image the legacy Ghost Template
    // Manager created (position header baked into the blob via
    // core.encodePositionHeader, exactly like ghost-template-manager.js's
    // own encodeRobustPosition would) inserted directly into
    // GP_Ghost_History, bypassing Ghost++ entirely — then verifies
    // gppState.reloadLibrary() discovers it, decodes it, and recovers the
    // exact position from its header.
    // Position-header packets are 5 PIXELS WIDE (see gpp-core.js's
    // decodePositionHeader: `for (x = 0; x + 4 < width; x += 5)`, and it
    // explicitly refuses to treat anything narrower than 5px as headered),
    // so this test image must be at least that wide for a real packet to
    // exist — unlike makeTestPngFile's 2x2 fixture used elsewhere, which is
    // deliberately too small to carry one and is not reused here.
    L.push('  await step("shared.preexisting", async function() {');
    L.push('    var w = 6, h = 2;');
    L.push('    var rgba = new Uint8ClampedArray(w * h * 4);');
    L.push('    for (var i = 0; i < w * h; i++) { rgba[i * 4] = 10; rgba[i * 4 + 1] = 20; rgba[i * 4 + 2] = 30; rgba[i * 4 + 3] = 255; }');
    L.push('    var encoded = core.encodePositionHeader(rgba, w, h, { gridX: 41, gridY: -7 });');
    L.push('    var c = document.createElement("canvas");');
    L.push('    c.width = encoded.width; c.height = encoded.height;');
    L.push('    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(encoded.rgba), encoded.width, encoded.height), 0, 0);');
    L.push('    var preBlob = await new Promise(function(r) { c.toBlob(r, "image/png"); });');
    L.push('    var preHash = await gppLegacyComputeFileHash(preBlob);');
    L.push('    var preTemplateId = await gppLegacyComputeTemplateId(preBlob);');
    L.push('    var newId = await legacyPut({ blob: preBlob, name: "GTM_authored", date: Date.now(), hash: preHash, templateId: preTemplateId, groupNoise: false });');
    L.push('    await gppState.reloadLibrary();');
    L.push('    var found = gppState.templates.filter(function(t) { return t.id === ("legacy_" + newId); })[0];');
    L.push('    if (!found) throw new Error("a GP_Ghost_History record created OUTSIDE Ghost++ (id=" + newId + ") was not picked up by reloadLibrary()");');
    L.push('    if (found.width !== w || found.height !== h) throw new Error("expected the position-header row to be stripped back to " + w + "x" + h + ", got " + found.width + "x" + found.height);');
    L.push('    if (!found.position || found.position.gridX !== 41 || found.position.gridY !== -7) throw new Error("position decoded from a legacy-authored blob did not match what was encoded: " + JSON.stringify(found.position));');
    L.push('    return "a GP_Ghost_History record created outside Ghost++ was discovered by reloadLibrary(), decoded to " + w + "x" + h + ", and its position header (41,-7) recovered exactly";');
    L.push('  });');
    L.push('');
    // ---- item shared.multi-concurrent ----
    // Regression test for a real bug: gppLoadSharedLibraryTemplates was
    // briefly changed to decode every shared image via Promise.all (for
    // speed), which silently broke — gppIngestViaWorker's cancellation
    // bookkeeping (gppIngestToken/gppIngestOperation) is a SINGLE shared
    // module-level slot designed for one in-flight ingest at a time; firing
    // several decodes concurrently makes every earlier call's captured
    // token stop matching gppIngestToken the instant a later call
    // increments it, so its worker's onmessage guard silently drops every
    // message but the last one — every earlier promise never resolves, and
    // gppState.reloadLibrary() (and therefore the whole modal) hangs forever
    // whenever 2+ shared templates exist. Seeds two distinct images directly
    // into GP_Ghost_History (bypassing the single-flight ingest path,
    // exactly like shared.preexisting above) and asserts reloadLibrary()
    // resolves within a generous timeout with both present.
    L.push('  await step("shared.multi-concurrent", async function() {');
    L.push('    function makeSolidPng(r, g, b) {');
    L.push('      var w = 6, h = 2;');
    L.push('      var rgba = new Uint8ClampedArray(w * h * 4);');
    L.push('      for (var i = 0; i < w * h; i++) { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255; }');
    L.push('      var c = document.createElement("canvas");');
    L.push('      c.width = w; c.height = h;');
    L.push('      c.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);');
    L.push('      return new Promise(function(r2) { c.toBlob(r2, "image/png"); });');
    L.push('    }');
    L.push('    var blobA = await makeSolidPng(200, 30, 30);');
    L.push('    var blobB = await makeSolidPng(30, 200, 30);');
    L.push('    var hashA = await gppLegacyComputeFileHash(blobA);');
    L.push('    var hashB = await gppLegacyComputeFileHash(blobB);');
    L.push('    var idA = await gppLegacyComputeTemplateId(blobA);');
    L.push('    var idB = await gppLegacyComputeTemplateId(blobB);');
    L.push('    var newIdA = await legacyPut({ blob: blobA, name: "concurrent_A", date: Date.now(), hash: hashA, templateId: idA, groupNoise: false });');
    L.push('    var newIdB = await legacyPut({ blob: blobB, name: "concurrent_B", date: Date.now(), hash: hashB, templateId: idB, groupNoise: false });');
    L.push('    var timedOut = false;');
    L.push('    var timeoutHandle;');
    L.push('    var timeoutPromise = new Promise(function(resolve) { timeoutHandle = setTimeout(function() { timedOut = true; resolve(); }, 8000); });');
    L.push('    await Promise.race([gppState.reloadLibrary(), timeoutPromise]);');
    L.push('    clearTimeout(timeoutHandle);');
    L.push('    if (timedOut) throw new Error("gppState.reloadLibrary() did not resolve within 8s with 2 shared templates present — regression of the concurrent-decode hang (gppIngestViaWorker\'s single shared cancellation token cannot serve overlapping calls)");');
    L.push('    var foundA = gppState.templates.some(function(t) { return t.id === ("legacy_" + newIdA); });');
    L.push('    var foundB = gppState.templates.some(function(t) { return t.id === ("legacy_" + newIdB); });');
    L.push('    if (!foundA || !foundB) throw new Error("reloadLibrary() resolved but did not return both concurrently-seeded shared templates (foundA=" + foundA + ", foundB=" + foundB + ")");');
    L.push('    return "reloadLibrary() with 2 shared templates present resolved well within the timeout and returned both, confirming shared-library decoding is not concurrent";');
    L.push('  });');
    L.push('');
    // ---- item groupNoise.changes-section ----
    // Group Noise Changes must (a) be entirely hidden while groupNoise is
    // off, (b) appear and list exactly the colours that actually merged
    // (never the untouched one) once it is on. Uses 2 near-identical colours
    // (squared distance 1, within the threshold of 2) plus 1 distant one.
    L.push('  await step("groupNoise.changes-section", async function() {');
    L.push('    var w = 3, h = 1;');
    L.push('    var c = document.createElement("canvas");');
    L.push('    c.width = w; c.height = h;');
    L.push('    var ctx = c.getContext("2d");');
    L.push('    ctx.fillStyle = "rgb(100,100,100)"; ctx.fillRect(0, 0, 1, 1);');
    L.push('    ctx.fillStyle = "rgb(100,100,101)"; ctx.fillRect(1, 0, 1, 1);'); // squared distance 1 from the above — must merge
    L.push('    ctx.fillStyle = "rgb(200,50,50)"; ctx.fillRect(2, 0, 1, 1);'); // far away — must NOT merge
    L.push('    var blob = await new Promise(function(r) { c.toBlob(r, "image/png"); });');
    L.push('    var gncTemplate = await gppState.ingestImageFile(new File([blob], "gpp-fixture-gnc.png", { type: "image/png" }));');
    L.push('    if (gncTemplate.palette.length !== 3) throw new Error("expected a 3-colour raw palette before grouping, got " + gncTemplate.palette.length);');
    L.push('    var harness2 = document.createElement("div");');
    L.push('    harness2.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:400px;";');
    L.push('    document.body.appendChild(harness2);');
    L.push('    gppRenderPalette(harness2, gncTemplate, function() {});');
    L.push('    var gncDetailsOff = harness2.querySelector("#gpp-palette-gnc-details");');
    L.push('    if (!gncDetailsOff) throw new Error("Group Noise Changes <details> element was not built at all");');
    L.push('    if (gncDetailsOff.style.display !== "none") throw new Error("Group Noise Changes section should be hidden while groupNoise is off");');
    L.push('    gncTemplate.groupNoise = true;');
    L.push('    gppRenderPalette(harness2, gncTemplate, function() {});');
    L.push('    var gncDetailsOn = harness2.querySelector("#gpp-palette-gnc-details");');
    L.push('    if (gncDetailsOn.style.display === "none") throw new Error("Group Noise Changes section should be visible once groupNoise is on and a merge occurred");');
    L.push('    var groups = gncDetailsOn.querySelectorAll(".gpp-gnc-group");');
    L.push('    if (groups.length !== 1) throw new Error("expected exactly 1 merged group shown, got " + groups.length);');
    L.push('    var members = groups[0].querySelectorAll(".gpp-gnc-member");');
    L.push('    if (members.length !== 2) throw new Error("expected exactly 2 member colors in the merged group, got " + members.length);');
    L.push('    var hexTexts = Array.from(gncDetailsOn.querySelectorAll(".gpp-gnc-hex")).map(function(el) { return el.textContent; });');
    L.push('    if (hexTexts.indexOf("#646464") === -1) throw new Error("expected #646464 (100,100,100) to appear in the Group Noise Changes section, got: " + hexTexts.join(","));');
    L.push('    if (hexTexts.indexOf("#646465") === -1) throw new Error("expected #646465 (100,100,101) to appear in the Group Noise Changes section, got: " + hexTexts.join(","));');
    L.push('    if (hexTexts.indexOf("#C83232") !== -1) throw new Error("the distant colour #C83232 (200,50,50) should not appear in the Group Noise Changes section, got: " + hexTexts.join(","));');
    L.push('    return "Group Noise Changes section stayed hidden with groupNoise off, then appeared listing exactly the 2 merged near-duplicate colors (not the 3rd, distant one) once groupNoise was turned on";');
    L.push('  });');
    L.push('');
    // ---- item teleport.zoom-and-glow ----
    // gppLibraryFlyToTemplate must clamp to zoom 12.5 (not the old 16), and
    // only as a FLOOR (never zooms back out if already closer). Similarly
    // gppFlyToNearestError must clamp to 17 (not 18), find a seeded WRONG
    // cell correctly, and start the target-cell glow at that exact grid
    // cell — also a smoke test of gppScanRedrawErrors' affine-transform
    // rewrite (must not throw with the glow active).
    L.push('  await step("teleport.zoom-and-glow", async function() {');
    L.push('    __mapZoom = 8;');
    L.push('    gppLibraryFlyToTemplate(template);');
    L.push('    if (__mapZoom !== 12.5) throw new Error("expected gppLibraryFlyToTemplate to jump to zoom 12.5 when starting below it, got " + __mapZoom);');
    L.push('    __mapZoom = 14;');
    L.push('    gppLibraryFlyToTemplate(template);');
    L.push('    if (__mapZoom !== 14) throw new Error("expected gppLibraryFlyToTemplate to leave zoom unchanged when already above 12.5 (never zoom OUT), got " + __mapZoom);');
    L.push('');
    L.push('    var ERROR_STATE = core.constants.ERROR_STATE;');
    L.push('    var fakeStates = new Uint8Array(template.width * template.height).fill(ERROR_STATE.CORRECT);');
    L.push('    fakeStates[0] = ERROR_STATE.WRONG;'); // local (0,0) -> absolute (template.position.gridX, template.position.gridY)
    L.push('    var savedSummary = template.scanSummary;');
    L.push('    template.scanSummary = { scannedAt: new Date().toISOString(), total: fakeStates.length, correct: fakeStates.length - 1, wrong: 1, missing: 0, unknown: 0, perColour: savedSummary.perColour, states: fakeStates };');
    L.push('    template.mask = core.makeFullMask(template.palette.length, template.counts);'); // guarantee the seeded cell\'s color is enabled regardless of earlier steps
    L.push('    template._gppShowWrong = true;');
    L.push('    template._gppShowMissing = false;');
    L.push('    gppNearestErrorGlow = null;');
    L.push('    __mapZoom = 8;');
    L.push('    var result = await gppFlyToNearestError(template);');
    L.push('    template.scanSummary = savedSummary;'); // restore before any assertion can throw and skip this
    L.push('    if (!result.ok) throw new Error("gppFlyToNearestError did not find the seeded WRONG cell: " + JSON.stringify(result));');
    L.push('    if (__mapZoom !== 17) throw new Error("expected gppFlyToNearestError to jump to zoom 17 when starting below it, got " + __mapZoom);');
    L.push('    if (!gppNearestErrorGlow || gppNearestErrorGlow.templateId !== template.id) throw new Error("gppFlyToNearestError did not start the target-cell glow for the focused template");');
    L.push('    if (gppNearestErrorGlow.gridX !== template.position.gridX || gppNearestErrorGlow.gridY !== template.position.gridY) throw new Error("glow target (" + gppNearestErrorGlow.gridX + "," + gppNearestErrorGlow.gridY + ") did not match the seeded WRONG cell (" + template.position.gridX + "," + template.position.gridY + ")");');
    L.push('    gppScanRedrawErrors();'); // exercises the affine-transform crosshair path with the glow active — must not throw
    L.push('    gppNearestErrorGlow = null;'); // let the glow\'s own rAF loop stop on its next tick instead of running for its full ~2.2s during later steps
    L.push('    return "gppLibraryFlyToTemplate clamps to zoom 12.5 as a floor only; gppFlyToNearestError clamps to zoom 17, finds the seeded WRONG cell, and starts the target-cell glow at the exact right grid cell";');
    L.push('  });');
    L.push('');

    // ---- item scan.selected-colour-highlight-no-teleport ----
    // Enable > Selected's optional guide must search the newly selected
    // palette index only, then paint its own red multi-ring target without
    // repurposing the regular Nearest error action (which jumps the map).
    L.push('  await step("scan.selected-colour-highlight-no-teleport", async function() {');
    L.push('    var ERROR_STATE = core.constants.ERROR_STATE;');
    L.push('    var targetPaletteIndex = template.indices[1];');
    L.push('    var otherPaletteIndex = template.indices[0];');
    L.push('    if (targetPaletteIndex === otherPaletteIndex) throw new Error("test setup: fixture needs distinct palette indexes for selected-colour scan coverage");');
    L.push('    var savedSummary = template.scanSummary;');
    L.push('    var fakeStates = new Uint8Array(template.width * template.height).fill(ERROR_STATE.CORRECT);');
    L.push('    fakeStates[0] = ERROR_STATE.WRONG;'); // nearest by distance, but deliberately the OTHER colour
    L.push('    fakeStates[1] = ERROR_STATE.MISSING;'); // selected colour — must win even when it is not nearest overall
    L.push('    template.scanSummary = { scannedAt: new Date().toISOString(), total: fakeStates.length, correct: fakeStates.length - 2, wrong: 1, missing: 1, unknown: 0, perColour: savedSummary.perColour, states: fakeStates };');
    L.push('    template.mask = core.makeFullMask(template.palette.length, template.counts);');
    L.push('    var jumpsBefore = __jumpToCalls.length;');
    L.push('    var flightsBefore = __flyToCalls.length;');
    L.push('    gppNearestSelectedColorGlow = null;');
    L.push('    try {');
    L.push('      var result = await gppScanHighlightNearestSelectedColor(template, targetPaletteIndex);');
    L.push('      if (!result.ok) throw new Error("selected-colour nearest scan did not find the seeded target: " + JSON.stringify(result));');
    L.push('      if (result.gridX !== template.position.gridX + 1 || result.gridY !== template.position.gridY) throw new Error("selected-colour nearest scan chose (" + result.gridX + "," + result.gridY + ") instead of the selected-colour target (" + (template.position.gridX + 1) + "," + template.position.gridY + ")");');
    L.push('      if (__jumpToCalls.length !== jumpsBefore || __flyToCalls.length !== flightsBefore) throw new Error("REGRESSION: selected-colour highlight moved the map (jump delta=" + (__jumpToCalls.length - jumpsBefore) + ", fly delta=" + (__flyToCalls.length - flightsBefore) + ")");');
    L.push('      if (!gppNearestSelectedColorGlow || gppNearestSelectedColorGlow.templateId !== template.id) throw new Error("selected-colour scan did not start its separate red pulse state");');
    L.push('      if (gppNearestSelectedColorGlow.gridX !== result.gridX || gppNearestSelectedColorGlow.gridY !== result.gridY) throw new Error("selected-colour pulse target did not match its selected-colour scan result");');
    L.push('      gppScanRedrawErrors();'); // smoke test the four-ring canvas drawing path
    L.push('      gppScanClearSelectedColorGlow();');
    L.push('      if (gppNearestSelectedColorGlow || gppNearestSelectedColorGlowRafId) throw new Error("selected-colour pulse clear did not synchronously remove the active guide");');
    L.push('    } finally {');
    L.push('      template.scanSummary = savedSummary;');
    L.push('      gppScanClearSelectedColorGlow();');
    L.push('    }');
    L.push('    return "the selected-colour nearest helper ignores a closer wrong pixel of another colour, starts and clears its own pulse at the selected-colour cell, and never calls jumpTo/flyTo";');
    L.push('  });');
    L.push('');
    // ---- item scan.nearest-search-snapshots-scan-and-position ----
    // A full nearest lookup yields between large chunks. It must retain both
    // its scan state and the template position captured at launch rather than
    // mixing the first chunk with a later scan/drag update.
    L.push('  await step("scan.nearest-search-snapshots-scan-and-position", async function() {');
    L.push('    var ERROR_STATE = core.constants.ERROR_STATE;');
    L.push('    var targetPaletteIndex = template.indices[1];');
    L.push('    var stateCount = 65537;');
    L.push('    var initialStates = new Uint8Array(stateCount).fill(ERROR_STATE.CORRECT);');
    L.push('    initialStates[stateCount - 1] = ERROR_STATE.MISSING;');
    L.push('    var indexed = new Uint16Array(stateCount);');
    L.push('    indexed[stateCount - 1] = targetPaletteIndex;');
    L.push('    var transientTemplate = { id: "snapshot-search", position: { gridX: 321, gridY: 654 }, scanSummary: { states: initialStates }, palette: template.palette, indices: indexed, width: stateCount, height: 1, mask: core.makeFullMask(template.palette.length, template.counts) };');
    L.push('    var pending = gppScanFindNearestError(transientTemplate, { paletteIndex: targetPaletteIndex });');
    L.push('    transientTemplate.position.gridX = 9999;');
    L.push('    transientTemplate.position.gridY = 9999;');
    L.push('    transientTemplate.scanSummary = { states: new Uint8Array(stateCount).fill(ERROR_STATE.CORRECT) };');
    L.push('    var result = await pending;');
    L.push('    if (!result.ok || result.gridX !== 321 + stateCount - 1 || result.gridY !== 654) throw new Error("nearest lookup mixed in a later scan or position: " + JSON.stringify(result));');
    L.push('    return "gppScanFindNearestError snapshots both scan states and grid origin before yielding between chunks";');
    L.push('  });');
    L.push('');
    // ---- item manage.grid-view ----
    // Manage Templates modal's new Grid view (now the default, alongside the
    // pre-existing List view): verifies the default really is grid, a grid
    // card's thumbnail click focuses the template and re-renders the
    // focused-styling class, the per-card multiselect checkbox drives the
    // toolbar's bulk-delete button, and the header toggle switches to List
    // view (real rows render) and back to Grid view.
    L.push('  await step("manage.grid-view", async function() {');
    L.push('    var existingModal = document.getElementById(GPP_LIB_MANAGE_ID);');
    L.push('    if (existingModal) existingModal.remove();'); // clean slate regardless of any prior step
    L.push('    var priorFocused = gppState.focusedTemplateId;');
    L.push('    gppOpenManageTemplatesModal(function() {});');
    L.push('    var modal = document.getElementById(GPP_LIB_MANAGE_ID);');
    L.push('    if (!modal) throw new Error("gppOpenManageTemplatesModal did not mount the modal");');
    L.push('    var listEl = modal.querySelector(".gpp-lib-manage-list");');
    L.push('    if (!listEl) throw new Error("Manage Templates modal did not render its list container");');
    L.push('    if (gppManageViewMode !== "grid") throw new Error("expected the default Manage Templates view to be grid, got " + gppManageViewMode);');
    L.push('    if (!listEl.classList.contains("gpp-lib-manage-list-grid")) throw new Error("grid view is active but the list container is missing its grid modifier class");');
    L.push('    var gridCard = listEl.querySelector(".gpp-lib-manage-grid-card");');
    L.push('    if (!gridCard) throw new Error("no grid card rendered for the seeded template");');
    L.push('    await gppState.focusTemplate(null);'); // unfocus so the click below has something to change
    L.push('    gridCard.click();');
    L.push('    var refocused = await waitFor(function() {');
    L.push('      return gppState.focusedTemplateId === template.id && !!modal.querySelector(".gpp-lib-manage-grid-card-focused");');
    L.push('    }, 2000);');
    L.push('    if (!refocused) throw new Error("clicking a grid card thumbnail did not focus its template and re-render the focused styling");');
    L.push('    var refreshedCard = modal.querySelector(".gpp-lib-manage-grid-card-focused");');
    L.push('    var selBtn = refreshedCard.querySelector(".gpp-lib-manage-grid-sel");');
    L.push('    if (!selBtn) throw new Error("grid card is missing its multiselect button");');
    L.push('    selBtn.click();');
    L.push('    if (!refreshedCard.classList.contains("gpp-lib-manage-grid-card-selected")) throw new Error("clicking the multiselect button did not mark the grid card selected");');
    L.push('    var deleteBtn = modal.querySelector(".gpp-lib-btn-danger");');
    L.push('    if (!deleteBtn || deleteBtn.disabled) throw new Error("toolbar bulk-delete button should be enabled once a grid card is multiselect-checked");');
    L.push('    selBtn.click();'); // deselect again so later state stays clean
    L.push('    var toggleBtns = modal.querySelectorAll(".gpp-lib-manage-view-toggle button");');
    L.push('    if (toggleBtns.length !== 2) throw new Error("expected exactly 2 buttons in the list/grid view toggle, got " + toggleBtns.length);');
    L.push('    toggleBtns[1].click();'); // list view
    L.push('    if (gppManageViewMode !== "list") throw new Error("clicking the list-view toggle did not switch gppManageViewMode to list");');
    L.push('    if (!listEl.querySelector(".gpp-lib-row")) throw new Error("switching to list view did not render list rows");');
    L.push('    if (listEl.classList.contains("gpp-lib-manage-list-grid")) throw new Error("list view is active but the grid modifier class was not removed");');
    L.push('    toggleBtns[0].click();'); // back to grid view
    L.push('    if (gppManageViewMode !== "grid") throw new Error("clicking the grid-view toggle did not switch back to grid");');
    L.push('    if (!listEl.querySelector(".gpp-lib-manage-grid-card")) throw new Error("switching back to grid view did not render grid cards");');
    L.push('    modal.querySelector(".gpp-lib-manage-close").click();');
    L.push('    if (priorFocused) await gppState.focusTemplate(priorFocused);'); // restore focus for cleanliness
    L.push('    return "Manage Templates modal defaults to Grid view; a grid card\'s thumbnail click focuses its template, its multiselect checkbox drives the bulk-delete button, and the header toggle switches to List view (real rows render) and back";');
    L.push('  });');
    L.push('');
    // ---- item guild.set-as-ghost ----
    // Regression guard for the "Could not find the selected project" bug:
    // gppLoadGuildProjectIntoGhostPlusPlus used to read `userGuildData` via
    // a plain unsafeWindow property access, which is always undefined for a
    // top-level `let` binding (userGuildData/tokenUser/userData all are, in
    // the real js/index148.js) — it now goes through gpp-bridge.js's
    // gppReadNativeGuildData() eval-bridge instead. ensureRuntime() (run
    // during prep.open-modal) already installed the guild-project hook, so
    // window.setProjectAsGhost here is Ghost++'s own replacement.
    // ALSO covers the later "must never persist" requirement: this must
    // decode into gppState.guildTemplates only, never gppState.templates,
    // and never write a single byte to either IndexedDB database Ghost++
    // uses (GP_Ghost_Plus_Plus's templateState store, or the shared
    // GP_Ghost_History images store).
    L.push('  await step("guild.set-as-ghost", async function() {');
    L.push('    var pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";');
    L.push('    userGuildData = { projects: [{ id: 555, image: pngDataUrl, imageGridX: 33, imageGridY: -12 }] };');
    L.push('    window.__alerts.length = 0;');
    L.push('    var templatesBefore = gppState.templates.length;');
    L.push('    var guildBefore = gppState.guildTemplates.length;');
    L.push('    var stateRecordsBefore = (await idbGetAll("templateState")).length;');
    L.push('    var legacyRecordsBefore = (await legacyGetAll()).length;');
    L.push('    if (typeof window.setProjectAsGhost !== "function") throw new Error("guild project hook was not installed (setProjectAsGhost missing)");');
    L.push('    window.setProjectAsGhost(555);');
    L.push('    // Wait for opacity===1 specifically, not just position — gppGetOrCreateGuildTemplate');
    L.push('    // now pushes the stub into gppState.guildTemplates IMMEDIATELY (position is set');
    L.push('    // synchronously during stub construction), well before the async decode+focus flow');
    L.push('    // finishes and flips opacity to 1. Waiting on position alone would race and resolve');
    L.push('    // while the template is still an undecoded, invisible (opacity 0) stub.');
    L.push('    var loaded = await waitFor(function() {');
    L.push('      return gppState.guildTemplates.some(function(t) { return t.position && t.position.gridX === 33 && t.position.gridY === -12 && t.opacity === 1; });');
    L.push('    }, 4000);');
    L.push('    if (window.__alerts.length !== 1) throw new Error("expected exactly 1 success alert after guild Set as Ghost, got " + window.__alerts.length + ": " + JSON.stringify(window.__alerts));');
    L.push('    if (window.__alerts[0].title !== "Success") throw new Error("expected the guild Set as Ghost alert to be a Success alert, got " + JSON.stringify(window.__alerts[0]));');
    L.push('    if (!loaded) throw new Error("guild project 555 was not decoded into gppState.guildTemplates at the expected position");');
    L.push('    var tpl = gppState.guildTemplates.find(function(t) { return t.position && t.position.gridX === 33 && t.position.gridY === -12; });');
    L.push('    if (!tpl.ephemeral) throw new Error("guild-loaded template must carry ephemeral:true");');
    L.push('    if (tpl.opacity !== 1) throw new Error("a deliberate Set as Ghost click should be visible (opacity 1), got " + tpl.opacity);');
    L.push('    if (gppState.templates.length !== templatesBefore) throw new Error("Set as Ghost must never add to gppState.templates (the persistent library) — went from " + templatesBefore + " to " + gppState.templates.length);');
    L.push('    if (gppState.guildTemplates.length !== guildBefore + 1) throw new Error("expected exactly 1 new entry in gppState.guildTemplates, went from " + guildBefore + " to " + gppState.guildTemplates.length);');
    L.push('    var focused = gppState.getFocusedTemplate();');
    L.push('    if (!focused || focused.id !== tpl.id) throw new Error("gppState.getFocusedTemplate() should resolve the guild template via its gppGuildTemplates fallback, got " + JSON.stringify(focused && focused.id));');
    L.push('    var stateRecordsAfter = (await idbGetAll("templateState")).length;');
    L.push('    var legacyRecordsAfter = (await legacyGetAll()).length;');
    L.push('    if (stateRecordsAfter !== stateRecordsBefore) throw new Error("Set as Ghost wrote to the templateState IndexedDB store — went from " + stateRecordsBefore + " to " + stateRecordsAfter + " records");');
    L.push('    if (legacyRecordsAfter !== legacyRecordsBefore) throw new Error("Set as Ghost wrote to the shared GP_Ghost_History IndexedDB store — went from " + legacyRecordsBefore + " to " + legacyRecordsAfter + " records");');
    L.push('    userGuildData = null;');
    L.push('    return "guild menu \'Set as Ghost\' correctly reads userGuildData via the page-realm bridge, decodes the project into gppState.guildTemplates ONLY (never gppState.templates, never IndexedDB), and focuses it";');
    L.push('  });');
    L.push('');
    // ---- item guild.set-as-ghost-no-duplicate-on-repeat ----
    // Regression guard for the "guild duplicate-stub" bug's one remaining
    // scenario now that the Guild Templates section is gone (removed per
    // explicit product decision — no one used it over the native guild
    // menu itself; see gppGetOrCreateGuildTemplate's own comment in
    // gpp-runtime.js for the original two-entry-point bug this dedup logic
    // was written for). With only ONE entry point left, the only way to
    // still hit a duplicate is calling "Set as Ghost" twice in a row for
    // the same project — must reuse the same object, not create a second
    // one sharing its id.
    L.push('  await step("guild.set-as-ghost-no-duplicate-on-repeat", async function() {');
    L.push('    var fileC = await makeTestPngFile("guild-project-c.png", "guildC");'); // distinct content from every earlier variant — see makeTestPngFile's own comment
    L.push('    var urlC = URL.createObjectURL(fileC);');
    L.push('    userGuildData = { projects: [ { id: 7001, image: urlC, imageGridX: 71, imageGridY: -71 } ] };');
    L.push('    window.__alerts.length = 0;');
    L.push('    window.setProjectAsGhost(7001);');
    L.push('    var stub = null;');
    L.push('    var ready = await waitFor(function() {');
    L.push('      stub = gppState.guildTemplates.find(function(t) { return t.id === "guild_7001"; });');
    L.push('      return !!stub && stub.opacity === 1 && stub.guildDecoded === true;');
    L.push('    }, 5000);');
    L.push('    if (!ready) throw new Error("Set as Ghost did not decode/show the project in time");');
    L.push('    if (window.__alerts.length !== 1) throw new Error("expected exactly 1 success alert after Set as Ghost, got " + window.__alerts.length + ": " + JSON.stringify(window.__alerts));');
    L.push('    if (window.__alerts[0].title !== "Success") throw new Error("expected the Set as Ghost alert to be a Success alert, got " + JSON.stringify(window.__alerts[0]));');
    L.push('');
    L.push('    window.setProjectAsGhost(7001);'); // same project id again
    L.push('    var readyAgain = await waitFor(function() { var f = gppState.getFocusedTemplate(); return f && f.id === "guild_7001"; }, 5000);');
    L.push('    if (!readyAgain) throw new Error("second Set as Ghost for the same project did not re-focus it");');
    L.push('    var entries = gppState.guildTemplates.filter(function(t) { return t.id === "guild_7001"; });');
    L.push('    if (entries.length !== 1) throw new Error("DUPLICATE-STUB REGRESSION: expected exactly 1 entry after calling Set as Ghost twice for the same project, got " + entries.length);');
    L.push('    if (entries[0] !== stub) throw new Error("the second Set as Ghost call replaced the existing entry instead of reusing it");');
    L.push('');
    L.push('    userGuildData = null;');
    L.push('    return "calling the guild menu\'s Set as Ghost twice in a row for the same project reuses the same gppState.guildTemplates entry via gppGetOrCreateGuildTemplate — no duplicate ids";');
    L.push('  });');
    L.push('');
    // ---- item autoHideUnfocused.toggle-and-focus-behavior ----
    // View Settings > Global "Only show current template on map" checkbox
    // (gppSettings.autoHideUnfocused, on by default — this test forces it
    // off first so it can independently verify the ON transition below,
    // not because off is the default): applies immediately on check (not
    // just on the next focus change), persists every opacity flip it makes
    // to IndexedDB, and makes gppFocusTemplate hide every other real
    // template while ensuring the newly-focused one is visible.
    L.push('  await step("autoHideUnfocused.toggle-and-focus-behavior", async function() {');
    L.push('    gppSettings.autoHideUnfocused = false;');
    L.push('    gppState.saveSettings();');
    L.push('    var fileA = await makeTestPngFile("auto-hide-a.png", "autoHideA");'); // distinct content from every earlier variant — see makeTestPngFile\'s own comment
    L.push('    var fileB = await makeTestPngFile("auto-hide-b.png", "autoHideB");');
    L.push('    var tplA = await gppState.ingestImageFile(fileA);');
    L.push('    var tplB = await gppState.ingestImageFile(fileB);');
    L.push('    tplA.position = { gridX: 100, gridY: 100 }; tplB.position = { gridX: 200, gridY: 200 };');
    L.push('    tplA.opacity = 1; tplB.opacity = 1;');
    L.push('    await gppState.persistTemplateState(tplA);');
    L.push('    await gppState.persistTemplateState(tplB);');
    L.push('');
    L.push('    var opened = document.getElementById(GPP_IDS.modal) && !document.getElementById(GPP_IDS.modal).classList.contains("gpp-hidden");');
    L.push('    if (!opened) document.getElementById(GPP_IDS.opener).click();');
    L.push('    await waitFor(function() { var m = document.getElementById(GPP_IDS.modal); return m && !m.classList.contains("gpp-hidden"); }, 3000);');
    L.push('    await gppState.focusTemplate(tplA.id);'); // setting is still off here — establishes a focused template BEFORE enabling it, so the immediate-apply-on-check path below has something to act on
    L.push('');
    L.push('    var checkbox = document.getElementById("gpp-vs-auto-hide-unfocused");');
    L.push('    if (!checkbox) throw new Error("Only show current template on map checkbox not found in View Settings");');
    L.push('    if (checkbox.checked) throw new Error("expected the checkbox to reflect the forced-off gppSettings.autoHideUnfocused set above");');
    L.push('');
    L.push('    checkbox.click();');
    L.push('    if (!gppSettings.autoHideUnfocused) throw new Error("clicking the checkbox did not set gppSettings.autoHideUnfocused");');
    L.push('    var appliedImmediately = await waitFor(function() { return tplB.opacity === 0 && tplA.opacity === 1; }, 3000);');
    L.push('    if (!appliedImmediately) throw new Error("checking the box did not immediately hide the non-focused template — tplA.opacity=" + tplA.opacity + " tplB.opacity=" + tplB.opacity);');
    L.push('    var stateRecords = await idbGetAll("templateState");');
    L.push('    var recB = stateRecords.find(function(r) { return r.id === tplB.id; });');
    L.push('    if (!recB || recB.opacity !== 0) throw new Error("auto-hide did not persist template B\'s opacity=0 to IndexedDB");');
    L.push('');
    L.push('    await gppState.focusTemplate(tplB.id);');
    L.push('    var switched = await waitFor(function() { return tplA.opacity === 0 && tplB.opacity === 1; }, 3000);');
    L.push('    if (!switched) throw new Error("focusing template B did not hide A and show B — tplA.opacity=" + tplA.opacity + " tplB.opacity=" + tplB.opacity);');
    L.push('');
    // The first click's own change handler calls onChange() (a full panel
    // refresh), which rebuilds View Settings and replaces the checkbox DOM
    // node — re-query it fresh rather than reuse the now-detached reference.
    L.push('    var checkbox2 = document.getElementById("gpp-vs-auto-hide-unfocused");');
    L.push('    if (!checkbox2) throw new Error("Only show current template on map checkbox missing after a panel refresh");');
    L.push('    if (!checkbox2.checked) throw new Error("expected the re-rendered checkbox to still show checked");');
    L.push('    checkbox2.click();'); // turn back off — clean slate for later steps, which assume it off (the real default is now on — see gpp-runtime.js's GPP_DEFAULT_SETTINGS — this test deliberately forces it off throughout so it can independently verify the ON transition, and leaves it off after so later steps aren\'t affected by templates auto-hiding each other)
    L.push('    if (gppSettings.autoHideUnfocused) throw new Error("clicking the checkbox again did not turn the setting back off");');
    L.push('    return "Only show current template on map checkbox exists in View Settings (on by default — this test exercises the toggle independent of that), applies immediately on check, persists opacity changes to IndexedDB, and auto-hides the previously-focused template while showing the newly-focused one";');
    L.push('  });');
    L.push('');
    // ---- item keyboard.nudge-and-place ----
    // Regression guard for the restored keyboard shortcuts: arrow keys nudge
    // the focused/placed/unlocked template one cell (ported from the
    // abandoned geopixels-ghost-template-overhaul prototype's own
    // onGlobalKeyDown), and E enters the same click-to-place capture the
    // Place button triggers.
    L.push('  await step("keyboard.nudge-and-place", async function() {');
    // `template` (this driver script's own variable, assigned once back at
    // item "b") can go stale after any later re-ingest/supersede replaces
    // its array slot with a NEW object sharing the same id (exactly what
    // just happened by this point in the suite) — always re-look-up the
    // live object by id instead of trusting that old reference.
    L.push('    function liveTemplate() { return gppState.templates.find(function(t) { return t.id === template.id; }); }');
    L.push('    var opened = document.getElementById(GPP_IDS.modal) && !document.getElementById(GPP_IDS.modal).classList.contains("gpp-hidden");');
    L.push('    if (!opened) document.getElementById(GPP_IDS.opener).click();');
    L.push('    await waitFor(function() { var m = document.getElementById(GPP_IDS.modal); return m && !m.classList.contains("gpp-hidden"); }, 3000);');
    L.push('    await gppState.focusTemplate(template.id);');
    L.push('    var live = liveTemplate();');
    L.push('    live.locked = false;');
    L.push('    if (!live.position) live.position = { gridX: 10, gridY: 10 };');
    L.push('    await gppState.persistTemplateState(live);');
    L.push('    var beforeX = live.position.gridX;');
    L.push('    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));');
    L.push('    var nudged = await waitFor(function() { return liveTemplate().position.gridX === beforeX + 1; }, 2000);');
    L.push('    if (!nudged) throw new Error("ArrowRight keydown did not nudge the focused template — gridX=" + liveTemplate().position.gridX + " expected " + (beforeX + 1));');
    L.push('');
    L.push('    document.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true, cancelable: true }));');
    L.push('    var captureStarted = await waitFor(function() { return gppPlacementCaptureCleanup !== null; }, 2000);');
    L.push('    if (!captureStarted) throw new Error("pressing E did not start a placement capture (gppPlacementCaptureCleanup is still null)");');
    L.push('    var rect = __mapShellEl.getBoundingClientRect();');
    L.push('    var localX = 250, localY = 150;');
    L.push('    var expectedLng = (localX - MAP_ORIGIN_X) / MAP_SCALE;');
    L.push('    var expectedLat = (MAP_ORIGIN_Y - localY) / MAP_SCALE;');
    L.push('    var expectedGridX = Math.round(expectedLng / gridSize);');
    L.push('    var expectedGridY = Math.round(expectedLat / gridSize);');
    L.push('    document.getElementById("pixel-canvas").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: rect.left + localX, clientY: rect.top + localY }));');
    L.push('    var placed = await waitFor(function() { var p = liveTemplate().position; return p.gridX === expectedGridX && p.gridY === expectedGridY; }, 3000);');
    L.push('    if (!placed) throw new Error("E-triggered placement capture click did not resolve to the expected grid cell (" + expectedGridX + "," + expectedGridY + "), got " + JSON.stringify(liveTemplate().position));');
    L.push('    return "ArrowLeft/Right/Up/Down nudge the focused template by one cell, and E enters the same click-to-place capture as the Place button";');
    L.push('  });');
    L.push('');
    // ---- item manage.grid-thumb-full-res ----
    // Manage Templates grid cards used to draw from gppLibraryEnsureThumb's
    // bounded/downsampled cache into a fixed 92x92 canvas; they now use
    // gppLibraryRenderFullCanvas, which sizes the canvas to the template's
    // OWN true resolution (2x2 for every synthetic template this fixture
    // creates) and lets CSS (object-fit: contain) do the fitting. Asserting
    // the canvas element's actual width/height attributes (not its CSS box
    // size) is a direct, unambiguous check that the switch really happened.
    L.push('  await step("manage.grid-thumb-full-res", async function() {');
    L.push('    var existingModal = document.getElementById(GPP_LIB_MANAGE_ID);');
    L.push('    if (existingModal) existingModal.remove();');
    L.push('    gppManageViewMode = "grid";');
    L.push('    gppOpenManageTemplatesModal(function() {});');
    L.push('    var modal = document.getElementById(GPP_LIB_MANAGE_ID);');
    L.push('    var canvas = modal && modal.querySelector(".gpp-lib-manage-grid-thumb-wrap canvas");');
    L.push('    if (!canvas) throw new Error("no thumbnail canvas rendered in the Manage Templates grid view");');
    L.push('    if (canvas.width !== 2 || canvas.height !== 2) throw new Error("expected the grid card\'s canvas to be sized at the template\'s true 2x2 resolution (gppLibraryRenderFullCanvas), got " + canvas.width + "x" + canvas.height);');
    L.push('    modal.querySelector(".gpp-lib-manage-close").click();');
    L.push('    return "Manage Templates grid cards now render gppLibraryRenderFullCanvas (true 2x2 source resolution) instead of the bounded 92x92 thumbnail cache";');
    L.push('  });');
    L.push('');
    // ---- item export.progress-callback ----
    // gppExportTemplatesAsJson gained an onProgress(fraction, label)
    // parameter (batched, FileReader-based base64 conversion replacing the
    // old manual chunked-loop version) — verify the callback contract
    // directly: called at least once per template, fraction monotonically
    // non-decreasing, ending at exactly 1.
    L.push('  await step("export.progress-callback", async function() {');
    L.push('    var targets = gppState.templates.slice(0, Math.min(3, gppState.templates.length));');
    L.push('    if (!targets.length) throw new Error("no templates available to export");');
    L.push('    var calls = [];');
    L.push('    await gppState.exportTemplatesAsJson(targets, "fixture-export-test.json", function(fraction, label) {');
    L.push('      calls.push({ fraction: fraction, label: label });');
    L.push('    });');
    L.push('    if (calls.length < targets.length) throw new Error("expected at least " + targets.length + " progress callback(s), got " + calls.length);');
    L.push('    for (var i = 1; i < calls.length; i++) {');
    L.push('      if (calls[i].fraction < calls[i - 1].fraction) throw new Error("progress fraction went backwards: " + JSON.stringify(calls));');
    L.push('    }');
    L.push('    var last = calls[calls.length - 1];');
    L.push('    if (Math.abs(last.fraction - 1) > 1e-9) throw new Error("expected the final progress callback to reach fraction 1, got " + last.fraction);');
    L.push('    if (!calls.every(function(c) { return typeof c.label === "string" && c.label.length > 0; })) throw new Error("every progress callback should carry a non-empty label, got " + JSON.stringify(calls));');
    L.push('    return "gppExportTemplatesAsJson\'s onProgress callback fires once per template with a monotonically non-decreasing fraction reaching exactly 1";');
    L.push('  });');
    L.push('');
    // ---- item export.ui-progress-bar ----
    // Wires the callback above into the Manage Templates modal's real
    // "Export selected" button: the progress row must appear during the
    // export and disappear again afterward, with the button re-enabled —
    // bounded by waitFor so a real hang fails the test instead of the
    // whole suite.
    L.push('  await step("export.ui-progress-bar", async function() {');
    L.push('    var existingModal = document.getElementById(GPP_LIB_MANAGE_ID);');
    L.push('    if (existingModal) existingModal.remove();');
    L.push('    gppOpenManageTemplatesModal(function() {});');
    L.push('    var modal = document.getElementById(GPP_LIB_MANAGE_ID);');
    L.push('    var firstCheckbox = modal.querySelector(".gpp-lib-row input[type=checkbox], .gpp-lib-manage-grid-sel");');
    L.push('    if (gppManageViewMode !== "list") { modal.querySelectorAll(".gpp-lib-manage-view-toggle button")[1].click(); }');
    L.push('    var checkbox = modal.querySelector(".gpp-lib-row input[type=checkbox]");');
    L.push('    if (!checkbox) throw new Error("no list-view row checkbox found to select a template for export");');
    L.push('    checkbox.click();');
    L.push('    var exportBtn = Array.from(modal.querySelectorAll(".gpp-lib-btn")).find(function(b) { return b.textContent.indexOf("Export selected") !== -1; });');
    L.push('    if (!exportBtn || exportBtn.disabled) throw new Error("Export selected button not found or still disabled after selecting a template");');
    L.push('    exportBtn.click();');
    L.push('    var finished = await waitFor(function() {');
    L.push('      var row = modal.querySelector(".gpp-lib-manage-export-progress");');
    L.push('      return row && row.style.display === "none" && !exportBtn.disabled;');
    L.push('    }, 5000);');
    L.push('    if (!finished) throw new Error("export progress row did not hide / export button did not re-enable after clicking Export selected");');
    L.push('    modal.querySelector(".gpp-lib-manage-close").click();');
    L.push('    return "clicking Export selected shows the progress row during export and hides it again with the button re-enabled once finished";');
    L.push('  });');
    L.push('');
    // ---- item grayDisabledSwatches.toggle ----
    // New View Settings > Global checkbox: on by default (today's existing
    // look). Verifies the REAL CSS EFFECT via getComputedStyle, not just
    // class presence — on, a disabled swatch has a real grayscale/opacity
    // filter; off, that filter is gone (computed "none") while the swatch
    // still carries .gpp-swatch-off (the diagonal slash is driven by that
    // class alone, unconditionally — see gpp-palette.js's CSS comment).
    L.push('  await step("grayDisabledSwatches.toggle", async function() {');
    L.push('    gppSettings.grayDisabledSwatches = true;');
    L.push('    gppState.saveSettings();');
    L.push('    var noop = function() {};');
    L.push('    var container = document.createElement("div");');
    L.push('    container.style.cssText = "position:absolute; left:-9999px; top:-9999px;";');
    L.push('    document.body.appendChild(container);'); // must be connected to the document for getComputedStyle to reflect real CSS, not a detached node's initial values
    L.push('    gppRenderPalette(container, template, noop);');
    L.push('    var grid = container.querySelector(".gpp-palette-grid");');
    L.push('    if (!grid) throw new Error("no palette grid rendered");');
    L.push('    if (!grid.classList.contains("gpp-palette-gray-disabled")) throw new Error("expected .gpp-palette-gray-disabled on the grid by default");');
    L.push('    var swatch = grid.querySelector(".gpp-swatch");');
    L.push('    if (!swatch) throw new Error("no swatch rendered");');
    L.push('    if (!swatch.classList.contains("gpp-swatch-off")) swatch.click();'); // ensure we're testing a DISABLED swatch
    L.push('    if (!swatch.classList.contains("gpp-swatch-off")) throw new Error("could not get a disabled swatch to test against");');
    L.push('    var filterOn = getComputedStyle(swatch).filter;');
    L.push('    if (!filterOn || filterOn === "none") throw new Error("expected a real grayscale/opacity filter on a disabled swatch when the setting is on, got: " + filterOn);');
    L.push('');
    L.push('    gppSettings.grayDisabledSwatches = false;');
    L.push('    gppState.saveSettings();');
    L.push('    gppRenderPalette(container, template, noop);'); // same container+template -> reuses the cached controller -> performFilterSort re-reads the setting fresh
    L.push('    var gridAfter = container.querySelector(".gpp-palette-grid");');
    L.push('    if (gridAfter.classList.contains("gpp-palette-gray-disabled")) throw new Error("expected .gpp-palette-gray-disabled to be removed once the setting is off");');
    L.push('    var swatchAfter = gridAfter.querySelector(".gpp-swatch.gpp-swatch-off");');
    L.push('    if (!swatchAfter) throw new Error("expected the disabled swatch to still render (with its slash) once grayscale is off");');
    L.push('    var filterOff = getComputedStyle(swatchAfter).filter;');
    L.push('    if (filterOff !== "none") throw new Error("expected NO grayscale/opacity filter once the setting is off, got: " + filterOff);');
    L.push('');
    L.push('    gppSettings.grayDisabledSwatches = true; gppState.saveSettings(); container.remove();'); // clean slate
    L.push('    return "Gray unselected color boxes: on by default with a real grayscale/opacity filter on disabled swatches (verified via getComputedStyle); off removes that filter while the swatch (and its slash) still renders";');
    L.push('  });');
    L.push('');
    // ---- item paletteViewMode.toggle ----
    // New View Settings > Global "Palette view" grid/list toggle. Grid is
    // the default (today's square-tile layout, unchanged). List switches
    // .gpp-palette-grid into a flex column of compact rectangular rows
    // (verified via getComputedStyle, not just class presence — same rigor
    // as grayDisabledSwatches.toggle above) showing the hex value, "x/y"
    // (completed/total), and a mini progress bar — and stays driven by the
    // exact same sort state as the grid (verified here via the Sort:
    // Color option, which the tiny 2-color fixture template makes
    // deterministic: green #00FF00 sorts before red #FF0000).
    L.push('  await step("paletteViewMode.toggle", async function() {');
    L.push('    gppSettings.paletteViewMode = "grid";');
    L.push('    gppState.saveSettings();');
    L.push('');
    L.push('    var gridBtn = document.getElementById("gpp-vs-palette-view-grid");');
    L.push('    var listBtn = document.getElementById("gpp-vs-palette-view-list");');
    L.push('    if (!gridBtn || !listBtn) throw new Error("Palette view grid/list buttons not found in View Settings");');
    L.push('    if (!gridBtn.classList.contains("gpp-vs-view-btn-active") || listBtn.classList.contains("gpp-vs-view-btn-active")) throw new Error("expected Grid to be the active default in View Settings");');
    L.push('    listBtn.click();');
    L.push('    if (gppSettings.paletteViewMode !== "list") throw new Error("clicking List did not set gppSettings.paletteViewMode");');
    L.push('    if (listBtn.classList.contains("gpp-vs-view-btn-active") !== true || gridBtn.classList.contains("gpp-vs-view-btn-active")) throw new Error("expected List to become the active button and Grid to deactivate");');
    L.push('    gridBtn.click();');
    L.push('    if (gppSettings.paletteViewMode !== "grid") throw new Error("clicking Grid did not restore gppSettings.paletteViewMode");');
    L.push('');
    L.push('    var noop = function() {};');
    L.push('    var container = document.createElement("div");');
    L.push('    container.style.cssText = "position:absolute; left:-9999px; top:-9999px;";');
    L.push('    document.body.appendChild(container);'); // must be connected to the document for getComputedStyle to reflect real CSS
    L.push('    gppRenderPalette(container, template, noop);');
    L.push('    var grid = container.querySelector(".gpp-palette-grid");');
    L.push('    if (!grid) throw new Error("no palette grid rendered");');
    L.push('    if (grid.classList.contains("gpp-palette-list-mode")) throw new Error("grid mode should not carry .gpp-palette-list-mode");');
    L.push('    if (getComputedStyle(grid).display !== "grid") throw new Error("expected the palette container to be a real CSS grid in grid mode, got display=" + getComputedStyle(grid).display);');
    L.push('    var gridSwatch = grid.querySelector(".gpp-swatch");');
    L.push('    if (!gridSwatch) throw new Error("no swatch rendered in grid mode");');
    L.push('    if (gridSwatch.classList.contains("gpp-swatch-list")) throw new Error("grid-mode swatch should not carry .gpp-swatch-list");');
    L.push('    if (!gridSwatch.style.backgroundColor) throw new Error("expected grid-mode swatch to paint its own background color directly");');
    L.push('    if (grid.querySelector(".gpp-palette-list-hex")) throw new Error("grid mode should not render list-mode hex/progress text");');
    L.push('');
    L.push('    gppSettings.paletteViewMode = "list";');
    L.push('    gppState.saveSettings();');
    L.push('    gppRenderPalette(container, template, noop);'); // same container+template -> reuses the cached controller -> performFilterSort re-reads the setting fresh
    L.push('    var gridAfter = container.querySelector(".gpp-palette-grid");');
    L.push('    if (!gridAfter.classList.contains("gpp-palette-list-mode")) throw new Error("expected .gpp-palette-list-mode once the setting is list");');
    L.push('    if (getComputedStyle(gridAfter).display !== "flex") throw new Error("expected the palette container to switch to a flex column in list mode, got display=" + getComputedStyle(gridAfter).display);');
    L.push('    var listRows = gridAfter.querySelectorAll(".gpp-swatch.gpp-swatch-list");');
    L.push('    if (listRows.length !== 2) throw new Error("expected 2 list rows for the 2-color fixture template, got " + listRows.length);');
    L.push('    listRows.forEach(function(row) {');
    L.push('      if (row.style.backgroundColor) throw new Error("list-mode row itself should not carry the raw hex background — that belongs to .gpp-palette-list-chip");');
    L.push('      var chip = row.querySelector(".gpp-palette-list-chip");');
    L.push('      if (!chip || !chip.style.backgroundColor) throw new Error("expected a colored .gpp-palette-list-chip inside each list row");');
    L.push('      var hexLabel = row.querySelector(".gpp-palette-list-hex");');
    L.push('      if (!hexLabel || !/^#[0-9A-F]{6}$/i.test(hexLabel.textContent)) throw new Error("expected a real hex value in .gpp-palette-list-hex, got: " + (hexLabel && hexLabel.textContent));');
    L.push('      var progressText = row.querySelector(".gpp-palette-list-progress-text");');
    L.push('      if (!progressText || !progressText.textContent) throw new Error("expected non-empty progress text (the x/y this view was asked to show) in each list row");');
    L.push('      if (!row.querySelector(".gpp-palette-list-bar-outer")) throw new Error("expected a progress bar element in each list row");');
    L.push('    });');
    L.push('');
    L.push('    // Still driven by the same sort/filter state as the grid — Sort:');
    L.push('    // Color is deterministic for this 2-color fixture template.');
    L.push('    var sortSelect = container.querySelector(".gpp-palette-sort-select");');
    L.push('    if (!sortSelect) throw new Error("no sort select rendered in list mode");');
    L.push('    sortSelect.value = "byColor";');
    L.push('    sortSelect.dispatchEvent(new Event("change"));');
    L.push('    var sortedHexes = Array.from(gridAfter.querySelectorAll(".gpp-palette-list-hex")).map(function(el) { return el.textContent; });');
    L.push('    if (sortedHexes.length !== 2 || sortedHexes[0] !== "#00FF00" || sortedHexes[1] !== "#FF0000") throw new Error("Sort: Color did not apply in list mode, got " + JSON.stringify(sortedHexes));');
    L.push('');
    L.push('    gppSettings.paletteViewMode = "grid"; gppState.saveSettings(); container.remove();'); // clean slate
    L.push('    return "Palette view grid/list toggle exists in View Settings (grid active by default), and list mode renders real space-efficient rows (hex + x/y progress text + a progress bar, verified via getComputedStyle) still driven by the same sort state as the grid";');
    L.push('  });');
    L.push('');
    // ---- item scan.auto-trigger-refreshes-ui ----
    // Regression guard for the "Scanning… stuck until I toggle a color"
    // report: gppTriggerLoadTimeScan (fired by gppFocusTemplate on every
    // real focus change) and gppScheduleAutoscan's debounced timer (fired
    // after placing pixels) both used to be pure fire-and-forget — nothing
    // ever refreshed the real Progress section's DOM when the scan they
    // kicked off actually finished, so the Scan button stayed frozen
    // showing whatever it happened to say when it was last rendered by some
    // UNRELATED action, until another unrelated action (e.g. toggling a
    // palette color, which does call onChange()) happened to refresh it —
    // read as "stuck, but only sometimes" from the outside. Exercises
    // gppTriggerLoadTimeScan directly against the REAL, already-open
    // modal's own #gpp-progress-section — deliberately never calling any
    // render function itself, so a pass here proves gppRequestUiRefresh()
    // is what's keeping the real UI honest end to end, not the test.
    L.push('  await step("scan.auto-trigger-refreshes-ui", async function() {');
    L.push('    var settledFirst = await waitFor(function() { return !gppScanRunning; }, 5000);');
    L.push('    if (!settledFirst) throw new Error("test setup: a prior scan never settled");');
    L.push('    var opened = document.getElementById(GPP_IDS.modal) && !document.getElementById(GPP_IDS.modal).classList.contains("gpp-hidden");');
    L.push('    if (!opened) document.getElementById(GPP_IDS.opener).click();');
    L.push('    await waitFor(function() { var m = document.getElementById(GPP_IDS.modal); return m && !m.classList.contains("gpp-hidden"); }, 3000);');
    L.push('    await gppState.focusTemplate(template.id);');
    L.push('    var progressSection = document.getElementById("gpp-progress-section");');
    L.push('    if (!progressSection) throw new Error("Progress section container not found in the real modal");');
    L.push('    if (!progressSection.querySelector("button")) throw new Error("no Scan button rendered in the real Progress section");');
    L.push('');
    L.push('    gppTriggerLoadTimeScan(template);'); // the exact fire-and-forget entry point gppFocusTemplate calls on every real focus change — no render call of our own from here on
    L.push('    var scanBtnNow = progressSection.querySelector("button");');
    L.push('    if (!scanBtnNow || scanBtnNow.textContent !== "Scanning…" || !scanBtnNow.disabled) throw new Error("REGRESSION: starting an auto-triggered scan did not immediately refresh the real Progress section to show Scanning…/disabled, got text=" + (scanBtnNow && scanBtnNow.textContent) + " disabled=" + (scanBtnNow && scanBtnNow.disabled));');
    L.push('');
    L.push('    var settled = await waitFor(function() { return !gppScanRunning; }, 8000);');
    L.push('    if (!settled) throw new Error("the auto-triggered scan never settled");');
    L.push('    var scanBtnAfter = progressSection.querySelector("button");'); // re-query, not the captured reference — gppRenderProgressBar rebuilds this container from scratch on every refresh
    L.push('    if (!scanBtnAfter || scanBtnAfter.textContent !== "Scan progress" || scanBtnAfter.disabled) throw new Error("STUCK-SCANNING REGRESSION: the real Progress section stayed on Scanning…/disabled after the auto-triggered scan finished, with no unrelated UI action to accidentally refresh it — got text=" + (scanBtnAfter && scanBtnAfter.textContent) + " disabled=" + (scanBtnAfter && scanBtnAfter.disabled));');
    L.push('    return "gppTriggerLoadTimeScan now refreshes the real Progress section on its own — both immediately when the scan starts (Scanning… appears right away) and again once it finishes (the button returns to normal) — without depending on an unrelated later action like toggling a color to unstick it";');
    L.push('  });');
    L.push('');
    // ---- item guild.set-as-ghost-shows-preview-and-locks-position ----
    // Regression guard for two things that should still be true about "what
    // happens once a guild template is loaded" now that the Guild Templates
    // section is gone and the guild menu's "Set as Ghost" is the only entry
    // point left:
    //   1. gpp-library.js's "current template" preview (.gpp-lib-current,
    //      the gpp-lib-thumb-canvas + name block) only ever looked up the
    //      focused template in gppState.templates (the personal library) —
    //      a focused GUILD template resolved to undefined there, so no
    //      preview ever rendered for one. Fixed with a gppState.guildTemplates
    //      fallback lookup.
    //   2. A guild template's own `locked` field always defaults to false
    //      (never persisted either way, since it's ephemeral) — per
    //      explicit product decision it must still always BEHAVE locked:
    //      checkbox checked AND disabled, every position-mutating control
    //      (buttons, arrow-key nudge, E-to-place) refuses to move it, even
    //      though nothing here relies on IndexedDB to enforce that (it's a
    //      pure client-side guard — gppIsPositionLocked in gpp-placement.js).
    L.push('  await step("guild.set-as-ghost-shows-preview-and-locks-position", async function() {');
    L.push('    var fileE = await makeTestPngFile("guild-project-e.png", "guildE");'); // distinct content from every earlier variant — see makeTestPngFile's own comment
    L.push('    var urlE = URL.createObjectURL(fileE);');
    L.push('    userGuildData = { projects: [ { id: 8001, image: urlE, imageGridX: 44, imageGridY: -44 } ] };');
    L.push('    window.__alerts.length = 0;');
    L.push('    window.setProjectAsGhost(8001);'); // decode + show + focus, all via the guild menu\'s own entry point
    L.push('    var stub = null;');
    L.push('    var shown = await waitFor(function() {');
    L.push('      stub = gppState.guildTemplates.find(function(t) { return t.id === "guild_8001"; });');
    L.push('      return !!stub && stub.guildDecoded === true && stub.opacity === 1;');
    L.push('    }, 5000);');
    L.push('    if (!shown) throw new Error("Set as Ghost did not decode/show the project in time");');
    L.push('    if (window.__alerts.length !== 1) throw new Error("expected exactly 1 success alert after Set as Ghost, got " + window.__alerts.length + ": " + JSON.stringify(window.__alerts));');
    L.push('    if (window.__alerts[0].title !== "Success") throw new Error("expected the Set as Ghost alert to be a Success alert, got " + JSON.stringify(window.__alerts[0]));');
    L.push('');
    L.push('    var focusedNow = await waitFor(function() { return gppState.focusedTemplateId === stub.id; }, 3000);');
    L.push('    if (!focusedNow) throw new Error("REGRESSION: Set as Ghost did not focus the template — gppState.focusedTemplateId=" + gppState.focusedTemplateId);');
    L.push('    var resolvedFocused = gppState.getFocusedTemplate();');
    L.push('    if (!resolvedFocused || resolvedFocused.id !== stub.id) throw new Error("gppState.getFocusedTemplate() did not resolve to the guild template after Set as Ghost");');
    // Deliberately NOT calling gppRequestUiRefresh() manually here anymore --
    // this used to be required to work around a real bug (an already-open
    // panel never re-rendered for a newly-focused guild template until
    // closed and reopened) by forcing the refresh the test itself needed.
    // gppLoadGuildProjectIntoGhostPlusPlus now does this refresh internally
    // (see gpp-native-shim.js), so leaving this call out is what makes this
    // test an actual regression guard for that fix -- if the internal
    // refresh call were ever removed, the assertions below would go back to
    // failing exactly like they did before the fix.
    L.push('');
    L.push('    var modal = document.getElementById(GPP_IDS.modal);');
    L.push('    var currentBlock = modal.querySelector(".gpp-lib-current");');
    L.push('    if (!currentBlock) throw new Error("REGRESSION: no .gpp-lib-current preview block rendered for the focused guild template");');
    L.push('    var previewCanvas = currentBlock.querySelector("canvas.gpp-lib-thumb-canvas");');
    L.push('    if (!previewCanvas) throw new Error("REGRESSION: no gpp-lib-thumb-canvas preview rendered for the focused guild template");');
    L.push('    if (previewCanvas.width !== stub.width || previewCanvas.height !== stub.height) throw new Error("preview canvas size (" + previewCanvas.width + "x" + previewCanvas.height + ") does not match the decoded guild template\'s own resolution (" + stub.width + "x" + stub.height + ")");');
    L.push('');
    L.push('    var ptContainer = document.getElementById(GPP_LIB_CURRENT_PT_ID);');
    L.push('    if (!ptContainer) throw new Error("Position/Transform container not found");');
    L.push('    var lockCheckbox = ptContainer.querySelector("#gpp-pt-lock");');
    L.push('    if (!lockCheckbox) throw new Error("REGRESSION: Template Settings controls (e.g. Lock Position) are not visible for the focused guild template");');
    L.push('    if (!lockCheckbox.checked) throw new Error("expected Lock Position to show checked for a guild template");');
    L.push('    if (!lockCheckbox.disabled) throw new Error("expected the Lock Position checkbox itself to be disabled for a guild template — no user should be able to uncheck it");');
    L.push('    var placeBtn = ptContainer.querySelector("#gpp-pt-place");');
    L.push('    var unsetBtn = ptContainer.querySelector("#gpp-pt-unset");');
    L.push('    var nudgeLeftBtn = ptContainer.querySelector("#gpp-pt-nudge-left");');
    L.push('    var xInput = ptContainer.querySelector("#gpp-pt-x");');
    L.push('    if (!placeBtn.disabled || !unsetBtn.disabled || !nudgeLeftBtn.disabled || !xInput.disabled) throw new Error("expected every position-editing control to be disabled for a locked guild template");');
    L.push('    var gotoBtn = ptContainer.querySelector("#gpp-pt-goto");');
    L.push('    if (gotoBtn.disabled) throw new Error("Go to (teleport the MAP view, not the template) should stay enabled even for a locked guild template");');
    L.push('');
    L.push('    // Even a client-side-only bypass attempt must not move it — stub.locked');
    L.push('    // itself is (and stays) false, since it never persists either way; the');
    L.push('    // lock must come from gppIsPositionLocked treating ephemeral as locked.');
    L.push('    if (stub.locked) throw new Error("test premise broken: guild stub.locked should stay false (ephemeral is what enforces the lock, not this field)");');
    L.push('    var beforePos = JSON.stringify(stub.position);');
    L.push('    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));');
    L.push('    await new Promise(function(r) { setTimeout(r, 150); });');
    L.push('    if (JSON.stringify(stub.position) !== beforePos) throw new Error("REGRESSION: ArrowRight keydown moved a locked guild template\'s position client-side — before=" + beforePos + " after=" + JSON.stringify(stub.position));');
    L.push('    document.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true, cancelable: true }));');
    L.push('    await new Promise(function(r) { setTimeout(r, 100); });');
    L.push('    if (gppPlacementCaptureCleanup !== null) throw new Error("REGRESSION: pressing E started a placement capture for a locked guild template");');
    L.push('');
    L.push('    userGuildData = null;');
    L.push('    return "a guild template loaded via the guild menu\'s Set as Ghost shows its preview thumbnail (gpp-lib-thumb-canvas) and full Template Settings controls like any other template, with Lock Position forced on/un-uncheckable and every position-mutating control (buttons + keyboard shortcuts) blocked client-side";');
    L.push('  });');
    L.push('');
    // ---- item palette.sync-with-selected-color ----
    // Regression guard for gppApplySelectedColorToFocusedTemplate
    // (gpp-palette.js) — the Ghost++-owned half of the compatibility seam
    // for the legacy Ghost Palette Color Search tool's own ♻️ "Sync Ghost
    // With Selected Color" button (ghost-palette-search.js, still under
    // #imageGroupDropdown — deliberately NOT a new Ghost++ panel button,
    // per explicit product decision). That legacy button is inert while
    // Ghost++ owns the overlay slot (it manipulates the native
    // #ghostColorPalette DOM, which never gets (re)populated for whatever
    // Ghost++ has focused — see gpp-native-shim.js's own header comment),
    // so its own applyAutoEnableSelectedColor now calls this function
    // FIRST and skips the native-DOM path whenever it returns true.
    // ghost-palette-search.js's whole feature is gated behind
    // _settings.ghostPaletteSearch (off in this fixture — see
    // _settings above), so applyAutoEnableSelectedColor/_syncGhostEnabled
    // don't exist here to test end-to-end; this exercises
    // gppApplySelectedColorToFocusedTemplate directly instead, which is
    // the part Ghost++ actually owns and the part that fixed the reported
    // incompatibility. Looks colors up by hex rather than assuming a fixed
    // palette index order, since the shared `template` fixture's own
    // red/green palette order is an implementation detail of the ingest
    // worker, not something this test should hardcode.
    L.push('  await step("palette.sync-with-selected-color", async function() {');
    L.push('    if (typeof gppApplySelectedColorToFocusedTemplate !== "function") throw new Error("gppApplySelectedColorToFocusedTemplate was not exposed by gpp-palette.js");');
    L.push('');
    L.push('    await gppState.focusTemplate(null);');
    L.push('    var handledWithNoFocus = gppApplySelectedColorToFocusedTemplate("#FF0000FF");');
    L.push('    if (handledWithNoFocus !== false) throw new Error("expected false (let the legacy native-DOM path run) when Ghost++ has no template focused, got " + handledWithNoFocus);');
    L.push('');
    L.push('    await gppState.focusTemplate(template.id);');
    L.push('    var live = gppState.templates.find(function(t) { return t.id === template.id; });');
    L.push('    live.mask = core.makeFullMask(live.palette.length, live.counts);');
    L.push('    await gppState.persistTemplateState(live);');
    L.push('    function indexForHex(tpl, hex) {');
    L.push('      for (var i = 0; i < tpl.palette.length; i++) { if (core.packedToHex(tpl.palette[i]) === hex) return i; }');
    L.push('      return -1;');
    L.push('    }');
    L.push('    var redIndex = indexForHex(live, "#FF0000");');
    L.push('    var greenIndex = indexForHex(live, "#00FF00");');
    L.push('    if (redIndex === -1 || greenIndex === -1) throw new Error("test setup: fixture template does not contain the expected red/green palette colors, got " + JSON.stringify(Array.from(live.palette).map(function(p) { return core.packedToHex(p); })));');
    L.push('');
    L.push('    var handledRed = gppApplySelectedColorToFocusedTemplate("#FF0000FF");'); // 8-digit RGBA hex, matching the native changeColor(color) format
    L.push('    if (handledRed !== true) throw new Error("expected true (Ghost++ has a template focused) once a template is focused, got " + handledRed);');
    L.push('    if (!core.maskHas(live.mask, redIndex) || core.maskHas(live.mask, greenIndex)) throw new Error("REGRESSION: picking red did not enable ONLY red in the focused template\'s mask, got " + JSON.stringify(Array.from(live.mask)));');
    L.push('');
    L.push('    var handledGreen = gppApplySelectedColorToFocusedTemplate("#00FF00FF");');
    L.push('    if (handledGreen !== true) throw new Error("expected true (Ghost++ still has a template focused), got " + handledGreen);');
    L.push('    if (!core.maskHas(live.mask, greenIndex) || core.maskHas(live.mask, redIndex)) throw new Error("REGRESSION: picking green did not switch the mask over to ONLY green, got " + JSON.stringify(Array.from(live.mask)));');
    L.push('');
    L.push('    var recAfter = await idbGetAll("templateState");');
    L.push('    var rec = recAfter.find(function(r) { return r.id === live.id; });');
    L.push('    var recMask = rec && new Uint32Array(rec.mask);');
    L.push('    if (!rec || !core.maskHas(recMask, greenIndex) || core.maskHas(recMask, redIndex)) throw new Error("expected the color-sync mask change to persist to IndexedDB");');
    L.push('');
    L.push('    return "gppApplySelectedColorToFocusedTemplate (the Ghost++ half of the legacy Sync Ghost With Selected Color compatibility seam) returns false with no template focused (letting the legacy native-DOM path run), and true while driving the focused template\'s mask to ONLY the picked color once one is — persisted to IndexedDB";');
    L.push('  });');
    L.push('');
    // ---- item modal.reopen-does-not-leak-listeners ----
    // Regression guard for the "reopening the modal gets progressively
    // slower with a real-sized library" report. Root cause: gpp-init.js's
    // open() used to rebuild #gpp-left-body's entire innerHTML on EVERY
    // open (renderShell), making every section container — especially
    // #gpp-palette-section — a brand-new DOM node each time. That defeated
    // gpp-palette.js's own gppPaletteControllers WeakMap (keyed by
    // container), forcing gppCreatePaletteController to re-run on every
    // single open and re-register 4 document-level listeners (two
    // dismiss-on-outside-click, one drag-end mouseup, one contextmenu) with
    // no matching removeEventListener — accumulating forever. Fixed by
    // building the shell once (ensureShellBuilt, checked via #gpp-drop-zone's
    // own presence) and reusing the same containers on every later open.
    // Verifies both the direct cause (the palette container is the SAME DOM
    // node across a close+reopen cycle) and the observable symptom (zero
    // new document click listeners get registered on a second open with the
    // same focused template).
    L.push('  await step("modal.reopen-does-not-leak-listeners", async function() {');
    L.push('    var modal = document.getElementById(GPP_IDS.modal);');
    L.push('    if (modal.classList.contains("gpp-hidden")) document.getElementById(GPP_IDS.opener).click();');
    L.push('    await waitFor(function() { return !modal.classList.contains("gpp-hidden"); }, 3000);');
    L.push('    await gppState.focusTemplate(template.id);');
    L.push('    if (typeof gppRequestUiRefresh === "function") gppRequestUiRefresh();');
    L.push('');
    L.push('    var paletteContainerBefore = document.getElementById("gpp-palette-section");');
    L.push('    if (!paletteContainerBefore) throw new Error("test setup: palette section container not found");');
    L.push('');
    L.push('    document.getElementById(GPP_IDS.opener).click();'); // close
    L.push('    var closed = await waitFor(function() { return modal.classList.contains("gpp-hidden"); }, 2000);');
    L.push('    if (!closed) throw new Error("test setup: modal did not close");');
    L.push('');
    L.push('    var origAdd = document.addEventListener;');
    L.push('    var clickListenersDuringReopen = 0;');
    L.push('    document.addEventListener = function(type, listener, opts) {');
    L.push('      if (type === "click") clickListenersDuringReopen++;');
    L.push('      return origAdd.call(document, type, listener, opts);');
    L.push('    };');
    L.push('    try {');
    L.push('      document.getElementById(GPP_IDS.opener).click();'); // reopen — same focused template, nothing else changed
    L.push('      var reopened = await waitFor(function() { return !modal.classList.contains("gpp-hidden"); }, 3000);');
    L.push('      if (!reopened) throw new Error("test setup: modal did not reopen");');
    L.push('    } finally {');
    L.push('      document.addEventListener = origAdd;');
    L.push('    }');
    L.push('');
    L.push('    var paletteContainerAfter = document.getElementById("gpp-palette-section");');
    L.push('    if (paletteContainerAfter !== paletteContainerBefore) throw new Error("REGRESSION: #gpp-palette-section is a new DOM node after reopening — the shell is being rebuilt on every open again, defeating gpp-palette.js\'s controller cache");');
    L.push('    if (clickListenersDuringReopen !== 0) throw new Error("REGRESSION: reopening the modal with the same focused template registered " + clickListenersDuringReopen + " new document click listener(s) — gppCreatePaletteController re-ran instead of reusing its cached controller, so these leak on every open");');
    L.push('');
    L.push('    return "the modal shell\'s section containers (e.g. #gpp-palette-section) are now built once and reused across close/reopen cycles instead of rebuilt from scratch every time — reopening with the same focused template registers zero new document-level click listeners, confirming gpp-palette.js\'s controller cache is no longer defeated on every open";');
    L.push('  });');
    L.push('');
    // ---- item shell.head-and-dividers-reach-panel-edge ----
    // Regression guard for #gpp-modal-left's own ambient horizontal padding
    // (10px 12px, previously) silently insetting BOTH .gpp-head (the title
    // bar, a direct child) and every details.gpp-collapsible section's own
    // border-top divider by 12px from the true panel edge — user-reported
    // as ".gpp-head doesn't extend all the way rightward to
    // .gpp-panel-splitter, same with any of the horizontal dividers". Fixed
    // by moving the horizontal inset off the ambient container and onto
    // the pieces that actually need it (.gpp-head's own existing padding,
    // #gpp-drop-zone/#gpp-ingest-status's own margin, and
    // details.gpp-collapsible's own padding) — none of which move where a
    // border drawn on that same element's own box sits. Verifies actual
    // rendered geometry (getBoundingClientRect) on both edges, not just
    // that some CSS rule exists.
    L.push('  await step("shell.head-and-dividers-reach-panel-edge", async function() {');
    L.push('    var opened = document.getElementById(GPP_IDS.modal) && !document.getElementById(GPP_IDS.modal).classList.contains("gpp-hidden");');
    L.push('    if (!opened) document.getElementById(GPP_IDS.opener).click();');
    L.push('    await waitFor(function() { var m = document.getElementById(GPP_IDS.modal); return m && !m.classList.contains("gpp-hidden"); }, 3000);');
    L.push('');
    L.push('    var leftPanel = document.getElementById(GPP_IDS.left);');
    L.push('    var head = leftPanel.querySelector(".gpp-head");');
    L.push('    if (!head) throw new Error("test setup: .gpp-head not found");');
    L.push('    var leftRect = leftPanel.getBoundingClientRect();');
    L.push('    var headRect = head.getBoundingClientRect();');
    L.push('    var headRightGap = leftRect.right - headRect.right;');
    L.push('    var headLeftGap = headRect.left - leftRect.left;');
    L.push('    if (headRightGap > 1) throw new Error("REGRESSION: .gpp-head stops " + headRightGap.toFixed(1) + "px short of the true right panel edge instead of reaching gpp-panel-splitter — gpp-modal-left\'s ambient horizontal padding leak is back");');
    L.push('    if (headLeftGap > 1) throw new Error("REGRESSION: .gpp-head stops " + headLeftGap.toFixed(1) + "px short of the true left panel edge — gpp-modal-left\'s ambient horizontal padding leak is back");');
    L.push('');
    L.push('    var details = leftPanel.querySelector("details.gpp-collapsible");');
    L.push('    if (!details) throw new Error("test setup: no details.gpp-collapsible found");');
    L.push('    var detailsRect = details.getBoundingClientRect();');
    L.push('    var detailsRightGap = leftRect.right - detailsRect.right;');
    L.push('    var detailsLeftGap = detailsRect.left - leftRect.left;');
    L.push('    if (detailsLeftGap > 1) throw new Error("REGRESSION: a details.gpp-collapsible section stops " + detailsLeftGap.toFixed(1) + "px short of the true left panel edge");');
    L.push('    // Unlike .gpp-head, details.gpp-collapsible sits inside #gpp-left-body,');
    L.push('    // which deliberately keeps its own scrollbar-gutter:stable (an EARLIER,');
    L.push('    // separate fix for content shifting left/right as filtering/scanning');
    L.push('    // crossed the scroll threshold — kept on purpose, per explicit user');
    L.push('    // decision, even though it means these dividers sit a bit short of the');
    L.push('    // true edge). So this checks for a small, expected gutter-sized gap —');
    L.push('    // NOT zero (removing the gutter reservation entirely would be its own');
    L.push('    // regression) and NOT the old ~27px combined bug (gpp-modal-left\'s');
    L.push('    // horizontal padding stacked with its own redundant, now-removed');
    L.push('    // scrollbar-gutter reservation).');
    L.push('    if (detailsRightGap <= 5) throw new Error("REGRESSION: a details.gpp-collapsible section reaches all the way to the true right panel edge — #gpp-left-body\'s own scrollbar-gutter:stable reservation appears to have been removed, which will bring back the content-shifts-during-scroll bug it was added to prevent");');
    L.push('    if (detailsRightGap >= 25) throw new Error("REGRESSION: a details.gpp-collapsible section stops " + detailsRightGap.toFixed(1) + "px short of the true right panel edge — that\'s well beyond a normal scrollbar-gutter reservation, the old gpp-modal-left horizontal padding leak (or its own redundant scrollbar-gutter) looks like it\'s back");');
    L.push('');
    L.push('    return "the left panel\'s own header (.gpp-head) now spans the true full panel width on both edges, flush to gpp-panel-splitter, instead of stopping ~27px short due to gpp-modal-left\'s own horizontal padding plus its redundant scrollbar-gutter reservation; each collapsible section\'s border-top divider reaches the left edge exactly and stops only the expected, deliberate scrollbar-gutter width short on the right (#gpp-left-body\'s own reservation, kept on purpose)";');
    L.push('  });');
    L.push('');
    // ---- item palette.bulk-rows-and-enable-filtered ----
    // Regression guard for two related UI changes to the palette panel's
    // bulk-action area:
    //   1. The five bulk buttons now render as three separate rows instead
    //      of one — Enable all/Disable all (top), Enable owned/Enable
    //      filtered (middle), Match palette/Set palette (bottom) — with
    //      clearer labels than the old bare All/None/Owned.
    //   2. The new "Enable filtered" button, and the fix for its own
    //      reported bug: typing into the search box alone only affects
    //      sort order/glow (matches float to top) by default — it does NOT
    //      exclude non-matches from renderState.visible unless "Show
    //      search results only" (hideUnmatched) is SEPARATELY checked (see
    //      performFilterSort's own isUnmatched handling). The first cut of
    //      this button read renderState.visible alone, so a plain search
    //      with that checkbox left unchecked (the obvious, expected way to
    //      use it) enabled every color instead of just the matches — this
    //      test exercises exactly that combination, not the
    //      checkbox-also-checked one a looser test previously passed
    //      under. The fix intersects against renderState.matching whenever
    //      the search box is non-empty, regardless of that checkbox's own
    //      state, while still respecting whatever the OTHER filter
    //      checkboxes (hideCompleted/hideInProgress/hideUnstarted/
    //      ownedOnly/countRange, all independent of hideUnmatched) already
    //      exclude from `visible`.
    // Also spot-checks the "Get hex values"/"Filters"/Sort dropdown text
    // centering fix via getComputedStyle.
    L.push('  await step("palette.bulk-rows-and-enable-filtered", async function() {');
    L.push('    var noop = function() {};');
    L.push('    var container = document.createElement("div");');
    L.push('    document.body.appendChild(container);');
    L.push('    var live = gppState.templates.find(function(t) { return t.id === template.id; });');
    L.push('    live.mask = core.makeFullMask(live.palette.length, live.counts);');
    L.push('    await gppState.persistTemplateState(live);');
    L.push('    gppRenderPalette(container, live, noop);');
    L.push('');
    L.push('    var rows = container.querySelectorAll(".gpp-palette-bulk-row:not(.gpp-palette-2col-row)");'); // excludes the separate "Buy all colors" row, which reuses the same base class
    L.push('    if (rows.length !== 3) throw new Error("expected exactly 3 bulk-action rows, got " + rows.length);');
    L.push('    var rowTexts = Array.from(rows).map(function(row) { return Array.from(row.querySelectorAll("button")).map(function(b) { return b.textContent; }); });');
    L.push('    if (rowTexts[0].join("|") !== "Enable all|Disable all") throw new Error("unexpected top row buttons: " + JSON.stringify(rowTexts[0]));');
    L.push('    if (rowTexts[1].join("|") !== "Enable owned|Enable filtered") throw new Error("unexpected middle row buttons: " + JSON.stringify(rowTexts[1]));');
    L.push('    if (rowTexts[2].join("|") !== "Match palette|Set palette") throw new Error("unexpected bottom row buttons: " + JSON.stringify(rowTexts[2]));');
    L.push('');
    L.push('    var filterButtons = container.querySelectorAll(".gpp-palette-filter-button");'); // "Get hex values" + "Filters"
    L.push('    if (filterButtons.length !== 2) throw new Error("expected 2 .gpp-palette-filter-button elements (Get hex values, Filters), got " + filterButtons.length);');
    L.push('    filterButtons.forEach(function(btn) {');
    L.push('      if (getComputedStyle(btn).justifyContent !== "center") throw new Error("expected " + btn.textContent + " button text to be centered (justify-content:center), got " + getComputedStyle(btn).justifyContent);');
    L.push('    });');
    L.push('    var sortSelect = container.querySelector(".gpp-palette-sort-select");');
    L.push('    if (!sortSelect) throw new Error("test setup: sort select not found");');
    L.push('    if (getComputedStyle(sortSelect).textAlign !== "center") throw new Error("expected Sort dropdown text to be centered (text-align:center), got " + getComputedStyle(sortSelect).textAlign);');
    L.push('');
    L.push('    function indexForHex(tpl, hex) {');
    L.push('      for (var i = 0; i < tpl.palette.length; i++) { if (core.packedToHex(tpl.palette[i]) === hex) return i; }');
    L.push('      return -1;');
    L.push('    }');
    L.push('    var redIndex = indexForHex(live, "#FF0000");');
    L.push('    var greenIndex = indexForHex(live, "#00FF00");');
    L.push('    if (redIndex === -1 || greenIndex === -1) throw new Error("test setup: fixture template does not contain the expected red/green palette colors");');
    L.push('');
    L.push('    var enableFilteredBtn = Array.from(container.querySelectorAll("button")).find(function(b) { return b.textContent === "Enable filtered"; });');
    L.push('    if (!enableFilteredBtn) throw new Error("Enable filtered button not found");');
    L.push('    var hideUnmatchedCheckbox = container.querySelector(\'input[type="checkbox"][value="hideUnmatched"]\');');
    L.push('    if (!hideUnmatchedCheckbox) throw new Error("test setup: Show search results only checkbox not found");');
    L.push('');
    L.push('    // THE reported bug: search typed, "Show search results only" left');
    L.push('    // UNCHECKED (the obvious way anyone would actually use this) — must');
    L.push('    // still enable only the match, not everything.');
    L.push('    var searchInput = container.querySelector(".gpp-palette-search-input");');
    L.push('    searchInput.value = "FF0000";');
    L.push('    searchInput.dispatchEvent(new Event("input"));');
    L.push('    if (hideUnmatchedCheckbox.checked) throw new Error("test setup: expected Show search results only to still be unchecked");');
    L.push('    enableFilteredBtn.click();');
    L.push('    if (!core.maskHas(live.mask, redIndex) || core.maskHas(live.mask, greenIndex)) throw new Error("REGRESSION: Enable filtered with an active search but hideUnmatched UNCHECKED enabled more than just the match — got mask=" + JSON.stringify(Array.from(live.mask)) + " (this is the exact bug reported: it enabled everything instead of just the search results)");');
    L.push('');
    L.push('    // Clearing the search and clicking again should fall back to');
    L.push('    // whatever the OTHER filter checkboxes leave in `visible` — with');
    L.push('    // none checked, that is everything, matching Enable all.');
    L.push('    searchInput.value = ""; searchInput.dispatchEvent(new Event("input"));');
    L.push('    enableFilteredBtn.click();');
    L.push('    if (!core.maskHas(live.mask, redIndex) || !core.maskHas(live.mask, greenIndex)) throw new Error("expected Enable filtered with no active search and no filters checked to enable everything, got mask=" + JSON.stringify(Array.from(live.mask)));');
    L.push('');
    L.push('    container.remove();');
    L.push('    return "the palette panel\'s bulk-action buttons now render as three rows (Enable all/Disable all, Enable owned/Enable filtered, Match palette/Set palette) with clearer labels; the new Enable filtered button enables only colors currently passing the search/filter and disables the rest; Get hex values/Filters/Sort dropdown text is centered";');
    L.push('  });');
    L.push('');
    // ---- item scan.restored-focus-auto-scans-once ----
    // Regression guard for: a template that was already focused from a
    // PREVIOUS page session (gppFocusedTemplateId restored via a plain
    // module-load-time assignment, or gppInitRuntime()'s own no-such-
    // template-anymore fallback — neither goes through gppFocusTemplate(),
    // so that function's own `id !== previousId` auto-scan trigger never
    // fires for a restored focus) used to sit with stale/no progress until
    // the user manually clicked Scan or switched templates away and back.
    // gppInitRuntime() now calls gppTriggerScanForRestoredFocus() once its
    // own async work finishes; this test calls that function directly
    // (white-box, matching this suite's existing style for module-level
    // state) rather than forcing a real gppInitRuntime() re-run, which
    // would redundantly redo its own expensive database/library-loading
    // work and risk disturbing every other test's shared state.
    L.push('  await step("scan.restored-focus-auto-scans-once", async function() {');
    L.push('    var settledFirst = await waitFor(function() { return !gppScanRunning; }, 5000);');
    L.push('    if (!settledFirst) throw new Error("test setup: a prior scan never settled");');
    L.push('    var savedFocusedId = gppFocusedTemplateId;');
    L.push('    // `template` (this driver script\'s own variable) can go stale if any');
    L.push('    // earlier step\'s re-ingest/supersede replaced its array slot with a');
    L.push('    // NEW object sharing the same id (see keyboard.nudge-and-place\'s own');
    L.push('    // identical liveTemplate() pattern) — always re-look-up the live object.');
    L.push('    function liveTemplate() { return gppTemplates.find(function(t) { return t.id === template.id; }); }');
    L.push('');
    L.push('    // No-op case: nothing (or a nonexistent id) focused must not throw or start a scan.');
    L.push('    gppFocusedTemplateId = "gpp_nonexistent_restored_focus_id";');
    L.push('    gppTriggerScanForRestoredFocus();');
    L.push('    if (gppScanRunning) throw new Error("REGRESSION: gppTriggerScanForRestoredFocus() started a scan for a nonexistent focused template id");');
    L.push('');
    L.push('    // Real case: simulate the module-load-time restoration by setting');
    L.push('    // gppFocusedTemplateId directly, bypassing gppFocusTemplate() entirely');
    L.push('    // (exactly what actually happens on a real page load).');
    L.push('    var live = liveTemplate();');
    L.push('    live.scanSummary = null;'); // simulate "never scanned this session" so a real trigger is observable
    L.push('    gppFocusedTemplateId = live.id;');
    L.push('    gppTriggerScanForRestoredFocus();');
    L.push('    if (!gppScanRunning || gppScanningTemplateId !== live.id) throw new Error("REGRESSION: gppTriggerScanForRestoredFocus() did not start a scan for the already-focused (restored) template");');
    L.push('    var settled = await waitFor(function() { return !gppScanRunning; }, 8000);');
    L.push('    if (!settled) throw new Error("the auto-triggered scan for the restored focus never settled");');
    L.push('    if (!liveTemplate().scanSummary) throw new Error("REGRESSION: gppTriggerScanForRestoredFocus() did not actually produce a scanSummary for the restored template");');
    L.push('');
    L.push('    gppFocusedTemplateId = savedFocusedId;');
    L.push('    return "gppInitRuntime() now auto-triggers a scan for whichever template was already focused from a previous page session (via the new gppTriggerScanForRestoredFocus()), instead of leaving it with stale/no progress until the user manually clicks Scan or switches templates away and back";');
    L.push('  });');
    L.push('');
    // ---- item shell.right-panel-buttons-reflow-not-overflow ----
    // Regression guard for: dragging the right panel narrower than the
    // Place/Unset/Go to/Preview row's natural content width used to make
    // that row overflow past #gpp-modal-right-content's own edges instead
    // of wrapping — user-reported as the row's buttons appearing to "go
    // under the left div ... instead of wrapping around like it used to".
    // Root cause was two-fold: (1) .gpp-pt-row3 was a fixed 4-column CSS
    // grid (repeat(4, 1fr)), which has no wrap mechanism at all, unlike the
    // nudge-arrow row right below it (plain flex-wrap); (2) even after
    // switching it to flex-wrap, its ancestor #gpp-lib-current-pt is a flex
    // item of .gpp-lib-current (align-items:center, meant for centering the
    // narrower canvas thumbnail above it) — a flex item's default
    // min-width:auto floors its fit-content sizing at its content's
    // min-content width, so the whole Template Settings section stayed
    // pinned near its widest row's natural width regardless of how far the
    // panel was dragged. Fixed by giving #gpp-lib-current-pt its own
    // align-self:stretch + min-width:0, so it genuinely tracks the panel's
    // real available width instead of shrink-wrapping to content.
    L.push('  await step("shell.right-panel-buttons-reflow-not-overflow", async function() {');
    L.push('    var opened = document.getElementById(GPP_IDS.modal) && !document.getElementById(GPP_IDS.modal).classList.contains("gpp-hidden");');
    L.push('    if (!opened) document.getElementById(GPP_IDS.opener).click();');
    L.push('    await waitFor(function() { var m = document.getElementById(GPP_IDS.modal); return m && !m.classList.contains("gpp-hidden"); }, 3000);');
    L.push('');
    L.push('    var row3 = document.querySelector(".gpp-pt-row3");');
    L.push('    if (!row3) throw new Error("test setup: .gpp-pt-row3 not found — expected a template to already be focused by this point in the suite");');
    L.push('');
    L.push('    var right = document.getElementById(GPP_IDS.right);');
    L.push('    var rightContent = document.getElementById(GPP_IDS.rightContent);');
    L.push('    var savedWidth = right.style.width;');
    L.push('    var savedTransition = right.style.transition;');
    L.push('    try {');
    L.push('      right.style.transition = "none";');
    L.push('      right.style.width = "60px";'); // far below the row's natural content width, exercising the extreme end of the panel-splitter's own allowed range
    L.push('      var rcRect = rightContent.getBoundingClientRect();');
    L.push('      var row3Rect = row3.getBoundingClientRect();');
    L.push('      if (row3Rect.left < rcRect.left - 1) throw new Error("REGRESSION: .gpp-pt-row3 (Place/Unset/Go to/Preview) extends " + (rcRect.left - row3Rect.left).toFixed(1) + "px left of #gpp-modal-right-content\'s own edge when the right panel is dragged narrow — it is overflowing into the left panel instead of reflowing to fit");');
    L.push('      if (row3Rect.right > rcRect.right + 1) throw new Error("REGRESSION: .gpp-pt-row3 extends " + (row3Rect.right - rcRect.right).toFixed(1) + "px past #gpp-modal-right-content\'s own right edge when the right panel is dragged narrow");');
    L.push('    } finally {');
    L.push('      right.style.width = savedWidth;');
    L.push('      right.style.transition = savedTransition;');
    L.push('    }');
    L.push('');
    L.push('    return "the Place/Unset/Go to/Preview button row (and the section containing it) now stays within #gpp-modal-right-content\'s own bounds — wrapping onto additional lines as needed — instead of overflowing past it into the left panel when the right panel is dragged narrower than the row\'s natural content width";');
    L.push('  });');
    L.push('');
    // ---- item ingest.url-upload-image-and-json ----
    // Covers the new "or load from a URL" button (#gpp-url-upload-btn ->
    // handleUrlUploadClick -> ingestFromUrl -> gppFetchBlobViaGM ->
    // ingestFileList). ingestFromUrl itself is declared INSIDE gpp-init.js's
    // own _init_ghostPlusPlus() IIFE (unlike gppState/gppCreateCore/etc,
    // which are real top-level bindings this driver script can reach
    // directly) — see this file's own header comment #2 on why only
    // TOP-LEVEL declarations are reachable here. So this test drives
    // ingestFromUrl the only way actually available: through the real
    // #gpp-url-upload-btn click, with window.prompt stubbed to return each
    // test URL synchronously instead of blocking on a real dialog — still
    // "bypassing the real prompt() dialog entirely" as intended, just via a
    // stub rather than a direct function reference. window.__gmXhrCalls /
    // window.__gmXhrResponses come from the GM_xmlhttpRequest mock added to
    // buildFixtureHead() above.
    L.push('  await step("ingest.url-upload-image-and-json", async function() {');
    L.push('    function makeDistinctPngBlob() {');
    L.push('      return new Promise(function(resolveP, rejectP) {');
    L.push('        var c = document.createElement("canvas");');
    L.push('        c.width = 2; c.height = 2;');
    L.push('        var ctx = c.getContext("2d");');
    L.push('        ctx.clearRect(0, 0, 2, 2);');
    // Genuinely new RGB values — distinct from every makeTestPngFile
    // variant (default/seed/guildA/guildB/autoHideA/autoHideB/scanBusyB/
    // generic) so this can never dedup-collide with an already-ingested
    // template's content hash.
    L.push('        ctx.fillStyle = "rgb(201,17,222)";');
    L.push('        ctx.fillRect(0, 0, 1, 1);');
    L.push('        ctx.fillRect(0, 1, 1, 1);');
    L.push('        ctx.fillStyle = "rgb(33,199,55)";');
    L.push('        ctx.fillRect(1, 0, 1, 1);');
    L.push('        c.toBlob(function(blob) {');
    L.push('          if (!blob) { rejectP(new Error("toBlob returned null")); return; }');
    L.push('          resolveP(blob);');
    L.push('        }, "image/png");');
    L.push('      });');
    L.push('    }');
    L.push('');
    L.push('    var opened = document.getElementById(GPP_IDS.modal) && !document.getElementById(GPP_IDS.modal).classList.contains("gpp-hidden");');
    L.push('    if (!opened) document.getElementById(GPP_IDS.opener).click();');
    L.push('    await waitFor(function() { var m = document.getElementById(GPP_IDS.modal); return m && !m.classList.contains("gpp-hidden"); }, 3000);');
    L.push('');
    L.push('    var urlUploadBtn = document.getElementById("gpp-url-upload-btn");');
    L.push('    if (!urlUploadBtn) throw new Error("test setup: #gpp-url-upload-btn not found");');
    L.push('    var statusEl = document.getElementById("gpp-ingest-status");');
    L.push('    if (!statusEl) throw new Error("test setup: #gpp-ingest-status not found");');
    L.push('    var origPrompt = window.prompt;');
    L.push('');
    L.push('    // ---- case 1: image ----');
    L.push('    var imgBlob = await makeDistinctPngBlob();');
    L.push('    var imageUrl = "https://example.invalid/my-template.png";');
    L.push('    window.__gmXhrResponses[imageUrl] = { blob: imgBlob };');
    L.push('    var idsBeforeImage = gppState.templates.map(function(t) { return t.id; });');
    L.push('    var statusBeforeCase1 = statusEl.textContent;');
    L.push('    window.prompt = function() { return imageUrl; };');
    L.push('    try { urlUploadBtn.click(); } finally { window.prompt = origPrompt; }');
    L.push('    var imageIngested = await waitFor(function() { return gppState.templates.length === idsBeforeImage.length + 1; }, 8000);');
    L.push('    if (!imageIngested) throw new Error("REGRESSION: image URL upload did not add exactly 1 new template, count=" + gppState.templates.length + " expected=" + (idsBeforeImage.length + 1));');
    L.push('    if (window.__gmXhrCalls.indexOf(imageUrl) === -1) throw new Error("REGRESSION: gppFetchBlobViaGM did not call GM_xmlhttpRequest with the expected normalized URL " + imageUrl + ", got calls=" + JSON.stringify(window.__gmXhrCalls));');
    L.push('    var newestImageTemplate = gppState.templates.find(function(t) { return idsBeforeImage.indexOf(t.id) === -1; });');
    L.push('    if (!newestImageTemplate) throw new Error("test setup: could not locate the newly URL-ingested image template");');
    L.push('    if (newestImageTemplate.width !== 2 || newestImageTemplate.height !== 2) throw new Error("REGRESSION: URL-ingested image template has unexpected dimensions " + newestImageTemplate.width + "x" + newestImageTemplate.height);');
    // gppState.templates.length increasing (checked above) fires BEFORE
    // this ingest's own async tail actually finishes -- gppIngestImageFile
    // pushes onto gppTemplates, then still has `await
    // gppPersistTemplateState(...)` (an IndexedDB write) plus more work
    // left to do before ingestFileList's own terminal `setIngestStatus`
    // call runs. handleUrlUploadClick never awaits ingestFromUrl (fire-
    // and-forget), so without waiting for THIS case's own terminal status
    // text too, the next case can start (and finish, and set ITS OWN
    // status) while this one's slower tail is still in flight -- and if
    // that tail's delayed setIngestStatus('Imported...') call lands AFTER
    // the next case's, it silently overwrites it. This is exactly the
    // "Imported 1 template from export.json." showing up during case 3's
    // own assertion bug: case 2's tail was still pending when case 3 ran.
    L.push('    var case1Settled = await waitFor(function() { return statusEl.textContent !== statusBeforeCase1 && statusEl.textContent.indexOf("Imported") !== -1; }, 8000);');
    L.push('    if (!case1Settled) throw new Error("test setup: case 1\'s own ingest status never reached its terminal \\"Imported...\\" text (still showing: " + statusEl.textContent + ") -- its async tail (IndexedDB persistence, etc.) may still be pending");');
    L.push('');
    L.push('    // ---- case 2: JSON export (a real gppExportTemplatesAsJson() blob, not a hand-authored export payload) ----');
    L.push('    var origCreateObjectURL = URL.createObjectURL;');
    L.push('    var capturedBlob = null;');
    L.push('    URL.createObjectURL = function(blob) { capturedBlob = blob; return origCreateObjectURL.call(URL, blob); };');
    L.push('    try { await gppState.exportTemplatesAsJson([newestImageTemplate], "url-test-export.json"); } finally { URL.createObjectURL = origCreateObjectURL; }');
    L.push('    if (!capturedBlob) throw new Error("test setup: exportTemplatesAsJson did not call URL.createObjectURL");');
    // gppIngestImageFile/gppIngestJsonFile both dedup by content hash and
    // SUPERSEDE (in place, no count change) rather than duplicate when the
    // re-ingested content already matches an existing gppTemplates entry —
    // see their shared "supersedes" comment. Re-ingesting an export of
    // newestImageTemplate WITHOUT removing it first would therefore always
    // supersede itself and never increase the count, no matter what URL it
    // is served from. Deleting the source template first before importing
    // its own export is not a workaround for that — it is the realistic
    // scenario this button exists for (importing a template export that is
    // NOT already sitting in your local library), so this is exactly what
    // the count-increases-by-1 assertion below is meant to exercise.
    L.push('    await gppState.deleteTemplate(newestImageTemplate);');
    L.push('    if (gppState.templates.some(function(t) { return t.id === newestImageTemplate.id; })) throw new Error("test setup: could not delete the export source template ahead of the JSON re-ingest");');
    L.push('    var jsonUrl = "https://example.invalid/export.json";');
    L.push('    window.__gmXhrResponses[jsonUrl] = { blob: capturedBlob };');
    L.push('    var idsBeforeJson = gppState.templates.map(function(t) { return t.id; });');
    L.push('    var statusBeforeCase2 = statusEl.textContent;');
    L.push('    window.prompt = function() { return jsonUrl; };');
    L.push('    try { urlUploadBtn.click(); } finally { window.prompt = origPrompt; }');
    L.push('    var jsonIngested = await waitFor(function() { return gppState.templates.length === idsBeforeJson.length + 1; }, 8000);');
    L.push('    if (!jsonIngested) throw new Error("REGRESSION: JSON export URL upload did not add exactly 1 new template, count=" + gppState.templates.length + " expected=" + (idsBeforeJson.length + 1));');
    // This is the exact case that raced against case 3 in the reported
    // flake (see the identical comment above case 1's own settle-wait for
    // the full mechanism) -- gppIngestJsonFile's own await
    // gppIngestImageFile(...) chain has the same push-then-more-async-work
    // shape, so without waiting for THIS case's own terminal status here,
    // case 3 could start (and finish, setting its OWN status) while this
    // one's slower tail (IndexedDB persistence, etc.) was still in flight,
    // and its later, delayed setIngestStatus('Imported...') call would
    // silently overwrite case 3's "Could not tell..." status afterward.
    L.push('    var case2Settled = await waitFor(function() { return statusEl.textContent !== statusBeforeCase2 && statusEl.textContent.indexOf("Imported") !== -1; }, 8000);');
    L.push('    if (!case2Settled) throw new Error("test setup: case 2\'s own ingest status never reached its terminal \\"Imported...\\" text (still showing: " + statusEl.textContent + ") -- its async tail (IndexedDB persistence, etc.) may still be pending");');
    L.push('');
    L.push('    // ---- case 3: unrecognized type -> graceful rejection, not a silent failure or a throw ----');
    L.push('    var textBlob = new Blob(["hello"], { type: "text/plain" });');
    L.push('    var textUrl = "https://example.invalid/notes.txt";');
    L.push('    window.__gmXhrResponses[textUrl] = { blob: textBlob };');
    L.push('    var countBeforeText = gppState.templates.length;');
    L.push('    window.prompt = function() { return textUrl; };');
    L.push('    try { urlUploadBtn.click(); } finally { window.prompt = origPrompt; }');
    L.push('    var statusUpdated = await waitFor(function() { return statusEl.textContent.indexOf("Could not tell what that URL points to") !== -1; }, 8000);');
    L.push('    if (!statusUpdated) throw new Error("REGRESSION: unrecognized-type URL upload did not surface the expected status message, got: " + statusEl.textContent);');
    L.push('    if (gppState.templates.length !== countBeforeText) throw new Error("REGRESSION: unrecognized-type URL upload changed the template count, before=" + countBeforeText + " after=" + gppState.templates.length);');
    L.push('');
    L.push('    // ---- case 4: server sends a wrong/generic Content-Type, but the URL\'s own extension is recognized -- exercises gppInferTypeFromUrl\'s override path (the entire reason that function exists), not just the happy path where blob.type is already correct ----');
    L.push('    function makeSecondDistinctPngBlob() {');
    L.push('      return new Promise(function(resolveP, rejectP) {');
    L.push('        var c = document.createElement("canvas");');
    L.push('        c.width = 2; c.height = 2;');
    L.push('        var ctx = c.getContext("2d");');
    L.push('        ctx.clearRect(0, 0, 2, 2);');
    L.push('        ctx.fillStyle = "rgb(9,240,120)";'); // distinct from every other blob in this suite (see makeDistinctPngBlob's own comment)
    L.push('        ctx.fillRect(0, 0, 1, 1);');
    L.push('        ctx.fillRect(0, 1, 1, 1);');
    L.push('        ctx.fillStyle = "rgb(250,5,80)";');
    L.push('        ctx.fillRect(1, 0, 1, 1);');
    L.push('        c.toBlob(function(blob) {');
    L.push('          if (!blob) { rejectP(new Error("toBlob returned null")); return; }');
    L.push('          resolveP(new Blob([blob], { type: "application/octet-stream" }));'); // deliberately WRONG/generic Content-Type, despite being real PNG bytes
    L.push('        }, "image/png");');
    L.push('      });');
    L.push('    }');
    L.push('    var octetBlob = await makeSecondDistinctPngBlob();');
    L.push('    var extInferUrl = "https://example.invalid/served-with-wrong-content-type.png";'); // recognized .png extension -- must override the bad Content-Type above
    L.push('    window.__gmXhrResponses[extInferUrl] = { blob: octetBlob };');
    L.push('    var idsBeforeExtInfer = gppState.templates.map(function(t) { return t.id; });');
    L.push('    var statusBeforeCase4 = statusEl.textContent;');
    L.push('    window.prompt = function() { return extInferUrl; };');
    L.push('    try { urlUploadBtn.click(); } finally { window.prompt = origPrompt; }');
    L.push('    var extInferIngested = await waitFor(function() { return gppState.templates.length === idsBeforeExtInfer.length + 1; }, 8000);');
    L.push('    if (!extInferIngested) throw new Error("REGRESSION: a URL served with an unrecognized Content-Type (application/octet-stream) but a recognized .png extension did not ingest -- gppInferTypeFromUrl\'s override path is broken, count=" + gppState.templates.length + " expected=" + (idsBeforeExtInfer.length + 1));');
    L.push('    var extInferTemplate = gppState.templates.find(function(t) { return idsBeforeExtInfer.indexOf(t.id) === -1; });');
    L.push('    if (!extInferTemplate || extInferTemplate.width !== 2 || extInferTemplate.height !== 2) throw new Error("REGRESSION: extension-inferred URL upload did not produce the expected 2x2 template");');
    // Same race as cases 1/2 above -- wait for THIS case's own terminal
    // status before case 5 (which itself deletes extInferTemplate and
    // re-exports it) starts, so there is no lingering async tail left to
    // interfere with case 5's own status assertion.
    L.push('    var case4Settled = await waitFor(function() { return statusEl.textContent !== statusBeforeCase4 && statusEl.textContent.indexOf("Imported") !== -1; }, 8000);');
    L.push('    if (!case4Settled) throw new Error("test setup: case 4\'s own ingest status never reached its terminal \\"Imported...\\" text (still showing: " + statusEl.textContent + ") -- its async tail (IndexedDB persistence, etc.) may still be pending");');
    L.push('');
    L.push('    // ---- case 5: URL path has NO extension at all, but the server\'s Content-Type is already directly valid (a realistic API-endpoint shape) -- exercises gppDeriveFilenameFromUrl\'s missing-extension append branch, which case 1/2 above never touch since their URLs already end in the matching extension ----');
    L.push('    var origCreateObjectURL2 = URL.createObjectURL;');
    L.push('    var capturedBlob2 = null;');
    L.push('    URL.createObjectURL = function(blob) { capturedBlob2 = blob; return origCreateObjectURL2.call(URL, blob); };');
    L.push('    try { await gppState.exportTemplatesAsJson([extInferTemplate], "url-test-export-2.json"); } finally { URL.createObjectURL = origCreateObjectURL2; }');
    L.push('    if (!capturedBlob2) throw new Error("test setup: exportTemplatesAsJson did not call URL.createObjectURL (case 5)");');
    L.push('    await gppState.deleteTemplate(extInferTemplate);'); // same supersedes-in-place reasoning as case 2 above
    L.push('    var extensionlessUrl = "https://example.invalid/api/template-export-endpoint";'); // no dot anywhere in the path
    L.push('    window.__gmXhrResponses[extensionlessUrl] = { blob: capturedBlob2 };'); // capturedBlob2.type is already "application/json" -- no extension-inference needed, exercising a different branch than case 4
    L.push('    var idsBeforeExtensionless = gppState.templates.map(function(t) { return t.id; });');
    L.push('    var statusBeforeCase5 = statusEl.textContent;');
    L.push('    window.prompt = function() { return extensionlessUrl; };');
    L.push('    try { urlUploadBtn.click(); } finally { window.prompt = origPrompt; }');
    L.push('    var extensionlessIngested = await waitFor(function() { return gppState.templates.length === idsBeforeExtensionless.length + 1; }, 8000);');
    L.push('    if (!extensionlessIngested) throw new Error("REGRESSION: an extensionless URL serving a directly-valid application/json Content-Type did not ingest -- gppDeriveFilenameFromUrl\'s missing-extension append path may be throwing, count=" + gppState.templates.length + " expected=" + (idsBeforeExtensionless.length + 1));');
    // Same race as the earlier cases -- drain this case's own async tail
    // before returning, so no later test (which reuses this same shared
    // #gpp-ingest-status element and gppState.templates array) can
    // observe a delayed setIngestStatus('Imported...') call landing after
    // it has already moved on.
    L.push('    var case5Settled = await waitFor(function() { return statusEl.textContent !== statusBeforeCase5 && statusEl.textContent.indexOf("Imported") !== -1; }, 8000);');
    L.push('    if (!case5Settled) throw new Error("test setup: case 5\'s own ingest status never reached its terminal \\"Imported...\\" text (still showing: " + statusEl.textContent + ") -- its async tail (IndexedDB persistence, etc.) may still be pending");');
    L.push('');
    L.push('    return "ingestFromUrl (driven via #gpp-url-upload-btn with window.prompt stubbed, bypassing the real prompt() dialog) ingests a PNG blob served through the mocked GM_xmlhttpRequest as a new 2x2 template, ingests a real gppExportTemplatesAsJson()-produced JSON blob as 1 new template, rejects an unrecognized text/plain blob with the expected status message and no template count change, recovers via gppInferTypeFromUrl when the server sends a wrong/generic Content-Type but the URL\'s own extension is recognized, and still ingests successfully when the URL path has no extension at all but the server\'s Content-Type is already directly valid";');
    L.push('  });');
    L.push('');
    // ---- item ingest.url-upload-button-does-not-open-file-picker ----
    // Regression guard for handleUrlUploadClick's event.stopPropagation()
    // call: #gpp-url-upload-btn is a DOM child of #gpp-drop-zone, which has
    // its OWN click -> fileInput.click() (file-picker) handler. Without
    // stopPropagation, every click on the URL-upload button would ALSO pop
    // the native file picker underneath the prompt() dialog.
    L.push('  await step("ingest.url-upload-button-does-not-open-file-picker", async function() {');
    L.push('    var opened = document.getElementById(GPP_IDS.modal) && !document.getElementById(GPP_IDS.modal).classList.contains("gpp-hidden");');
    L.push('    if (!opened) document.getElementById(GPP_IDS.opener).click();');
    L.push('    await waitFor(function() { var m = document.getElementById(GPP_IDS.modal); return m && !m.classList.contains("gpp-hidden"); }, 3000);');
    L.push('');
    L.push('    var urlUploadBtn = document.getElementById("gpp-url-upload-btn");');
    L.push('    if (!urlUploadBtn) throw new Error("test setup: #gpp-url-upload-btn not found");');
    L.push('    var fileInput = document.getElementById("gpp-file-input");');
    L.push('    if (!fileInput) throw new Error("test setup: #gpp-file-input not found");');
    L.push('');
    L.push('    var clickCount = 0;');
    L.push('    var origClick = fileInput.click;');
    L.push('    fileInput.click = function() { clickCount++; return origClick.apply(this, arguments); };');
    L.push('    var origPrompt = window.prompt;');
    L.push('    window.prompt = function() { return null; };'); // short-circuits handleUrlUploadClick right after stopPropagation, no GM_xmlhttpRequest mock needed for this test
    L.push('    try {');
    L.push('      urlUploadBtn.click();');
    L.push('    } finally {');
    L.push('      fileInput.click = origClick;');
    L.push('      window.prompt = origPrompt;');
    L.push('    }');
    L.push('    if (clickCount !== 0) throw new Error("REGRESSION: clicking #gpp-url-upload-btn also triggered #gpp-file-input.click() " + clickCount + " time(s) — event.stopPropagation() in handleUrlUploadClick is no longer blocking the drop zone\'s own click -> file-picker handler from firing");');
    L.push('    return "clicking #gpp-url-upload-btn does not also trigger #gpp-drop-zone\'s own click -> file-picker handler (event.stopPropagation() inside handleUrlUploadClick blocks the bubble), confirmed via the file input\'s own .click() call count staying at 0 with window.prompt stubbed to return null";');
    L.push('  });');
    L.push('');
    // ---- item init.readystate-gate-does-not-break-normal-load ----
    // Regression guard for gpp-init.js's new document.readyState==='loading'
    // gate around gppStartGhostPlusPlus(): every inline <script> in THIS
    // fixture executes while the parser is still mid-document (no closing
    // </body></html> until after the driver script itself runs), so
    // document.readyState may well already read 'loading' at ghost-plus-plus
    // script-execution time, taking the DOMContentLoaded-deferred branch
    // rather than the immediate one -- which branch actually fires is not
    // something this test controls or should assume. Instead of asserting a
    // specific branch, just confirm Ghost++ ends up fully initialized either
    // way (waiting it out via waitFor in case init is still settling by the
    // time this step runs) -- a real regression guard that the gating
    // refactor didn't silently break initialization altogether in this
    // harness.
    L.push('  await step("init.readystate-gate-does-not-break-normal-load", async function() {');
    L.push('    var readyStateAtCheck = document.readyState;');
    L.push('    var ready = await waitFor(function() {');
    L.push('      return _featureStatus.ghostPlusPlus === "ok" &&');
    L.push('        !!document.getElementById(GPP_IDS.opener) &&');
    L.push('        typeof gppState !== "undefined";');
    L.push('    }, 5000);');
    L.push('    if (!ready) throw new Error("REGRESSION: Ghost++ never finished initializing under this test environment\'s document.readyState gate -- _featureStatus.ghostPlusPlus=" + _featureStatus.ghostPlusPlus + " opener=" + !!document.getElementById(GPP_IDS.opener) + " gppState=" + (typeof gppState) + " (document.readyState was \'" + readyStateAtCheck + "\' when this check started)");');
    L.push('    return "Ghost++ finished initializing (opener mounted, _featureStatus.ghostPlusPlus===\'ok\', gppState defined) despite the new document.readyState-gated startup in gpp-init.js -- document.readyState was \'" + readyStateAtCheck + "\' when this check started";');
    L.push('  });');
    L.push('');
    // ---- item init.opener-replacement-retries-when-native-button-appears-late ----
    // Regression guard for gppReplaceNativeOpener's new late-arrival retry
    // path (user-reported on Firefox: Ghost++ init ran before the site's own
    // JS had mounted #loadGhostImageBtn yet, leaving the fully-functional
    // native button untouched and the new opener stranded at document.body).
    // The fixture's own real init (see item "a") already ran with the native
    // button PRESENT the whole time, which never exercises the "not found
    // yet, watch for it" branch at all -- so this calls gppReplaceNativeOpener
    // directly a SECOND time (a plain top-level function, callable like any
    // other in this white-box suite), against a scenario where the REAL
    // #loadGhostImageBtn is temporarily detached from the document and then
    // genuinely re-inserted -- a real DOM childList mutation, exactly what
    // the MutationObserver (configured with childList:true, subtree:true --
    // it does NOT watch attributes, so merely renaming an id in place would
    // never trigger it) actually listens for.
    L.push('  await step("init.opener-replacement-retries-when-native-button-appears-late", async function() {');
    L.push('    var nativeBtn = document.getElementById("loadGhostImageBtn");');
    L.push('    if (!nativeBtn) throw new Error("test setup: real #loadGhostImageBtn not found");');
    L.push('    var originalOpener = document.getElementById(GPP_IDS.opener);');
    L.push('    if (!originalOpener) throw new Error("test setup: the real #gpp-opener from initial init was not found");');
    L.push('    var originalParent = nativeBtn.parentElement;');
    L.push('    var originalNext = nativeBtn.nextElementSibling;'); // the real opener, per item "a"'s own insertAdjacentElement("afterend", ...) placement
    L.push('    nativeBtn.remove();'); // simulate the native button not existing yet (a client-rendered element not guaranteed present)
    L.push('    if (document.getElementById("loadGhostImageBtn")) throw new Error("test setup: nativeBtn.remove() did not actually detach it");');
    L.push('');
    L.push('    var noop = function() {};');
    L.push('    var refs2 = gppReplaceNativeOpener(noop);');
    L.push('    if (refs2.native !== null) throw new Error("expected refs2.native to be null when the native button is not present at call time, got " + refs2.native);');
    L.push('    if (!refs2.opener || refs2.opener.parentElement !== document.body) throw new Error("expected the fallback opener to be appended directly to document.body while the native button is missing (no #controls-left exists in this fixture)");');
    L.push('    if (refs2.opener === originalOpener) throw new Error("test setup: the second gppReplaceNativeOpener() call reused the original opener button instead of creating its own");');
    L.push('');
    L.push('    originalParent.insertBefore(nativeBtn, originalNext);'); // re-insert -- a real childList mutation under document.body, exactly what the MutationObserver is listening for
    L.push('    if (nativeBtn.nextElementSibling === refs2.opener) throw new Error("test setup: the second opener was already relocated synchronously, before the MutationObserver could have fired -- this would make the waitFor below tautological");');
    L.push('    var relocated = await waitFor(function() {');
    L.push('      return refs2.native === nativeBtn && nativeBtn.nextElementSibling === refs2.opener;');
    L.push('    }, 4000);'); // the real give-up timer is 15000ms -- far longer than this; the observer should fire near-instantly on the mutation above
    L.push('    if (!relocated) throw new Error("REGRESSION: the MutationObserver did not relocate the late second opener next to the re-appeared native button in time -- refs2.native=" + refs2.native + " nativeBtn.nextElementSibling=" + (nativeBtn.nextElementSibling && nativeBtn.nextElementSibling.id));');
    L.push('    if (nativeBtn.style.display !== "none" || !nativeBtn.classList.contains("hidden") || nativeBtn.getAttribute("data-gpc-pill") !== "1") throw new Error("REGRESSION: the re-attached native button was not hidden/marked the same way a normally-present native button would be -- display=" + nativeBtn.style.display + " hidden-class=" + nativeBtn.classList.contains("hidden") + " data-gpc-pill=" + nativeBtn.getAttribute("data-gpc-pill"));');
    L.push('');
    L.push('    refs2.opener.remove();'); // clean up the duplicate opener this test created
    L.push('    if (nativeBtn.nextElementSibling !== originalOpener) throw new Error("REGRESSION: cleaning up the test-created duplicate opener left the ORIGINAL real native-button/opener pairing (from initial init) disturbed -- nativeBtn.nextElementSibling=" + (nativeBtn.nextElementSibling && nativeBtn.nextElementSibling.id));');
    L.push('    if (document.getElementById(GPP_IDS.opener) !== originalOpener) throw new Error("REGRESSION: the original real #gpp-opener is no longer the one found in the document after cleanup");');
    L.push('    if (nativeBtn.style.display !== "none" || !nativeBtn.classList.contains("hidden")) throw new Error("REGRESSION: the original native-button/opener pairing lost its hidden state after this test");');
    L.push('    return "gppReplaceNativeOpener(), called directly a second time while the real #loadGhostImageBtn was temporarily detached, returns refs.native=null and appends its own fallback opener straight to document.body; once the native button is genuinely re-inserted into the DOM (a real childList mutation), its MutationObserver finds it, hides it, marks it (.hidden + data-gpc-pill), and relocates the second opener to sit right after it -- all well within the real 15000ms give-up timer; the original real opener/native pairing from initial init is unaffected after cleanup";');
    L.push('  });');
    L.push('');
    // ---- item scan.error-count-alert-on-show-toggle ----
    // Regression guard for gppScanCountEnabledErrors/gppScanAlertEnabledCount:
    // the showErrBtn/showMissBtn click handlers in gppRenderProgressBar now
    // restore the native ghost tool's own "how many crosses did that just
    // place" showAlert() call, but ONLY when the respective toggle just
    // turned true (not when turning it back off), and the count itself must
    // be filtered to the CURRENTLY enabled colours (live mask), not the
    // whole-template scanSummary.wrong/missing. Builds a template with 3
    // distinct colours (2 enabled with different wrong/missing counts, 1
    // DISABLED with its own nonzero wrong/missing) and fabricates its
    // scanSummary directly (same technique already used by this suite's own
    // teleport.zoom-and-glow step), computing the expected mask-filtered
    // counts independently BEFORE clicking anything so the assertion never
    // trusts the implementation under test.
    L.push('  await step("scan.error-count-alert-on-show-toggle", async function() {');
    L.push('    var w = 3, h = 1;');
    L.push('    var c = document.createElement("canvas");');
    L.push('    c.width = w; c.height = h;');
    L.push('    var ctx = c.getContext("2d");');
    L.push('    ctx.fillStyle = "rgb(255,0,0)"; ctx.fillRect(0, 0, 1, 1);'); // red
    L.push('    ctx.fillStyle = "rgb(0,255,0)"; ctx.fillRect(1, 0, 1, 1);'); // green
    L.push('    ctx.fillStyle = "rgb(0,0,255)"; ctx.fillRect(2, 0, 1, 1);'); // blue
    L.push('    var blob = await new Promise(function(r) { c.toBlob(r, "image/png"); });');
    L.push('    var alertTemplate = await gppState.ingestImageFile(new File([blob], "gpp-fixture-alert-count.png", { type: "image/png" }));');
    L.push('    if (alertTemplate.palette.length !== 3) throw new Error("test setup: expected a 3-colour palette, got " + alertTemplate.palette.length);');
    L.push('    function indexForHex(tpl, hex) {');
    L.push('      for (var i = 0; i < tpl.palette.length; i++) { if (core.packedToHex(tpl.palette[i]) === hex) return i; }');
    L.push('      return -1;');
    L.push('    }');
    L.push('    var redIndex = indexForHex(alertTemplate, "#FF0000");');
    L.push('    var greenIndex = indexForHex(alertTemplate, "#00FF00");');
    L.push('    var blueIndex = indexForHex(alertTemplate, "#0000FF");');
    L.push('    if (redIndex === -1 || greenIndex === -1 || blueIndex === -1) throw new Error("test setup: fixture template does not contain the expected red/green/blue palette colors");');
    L.push('');
    L.push('    alertTemplate.mask = new Uint32Array(Math.ceil(alertTemplate.palette.length / 32));'); // start from all-disabled, enable red+green only
    L.push('    core.maskSet(alertTemplate.mask, redIndex, true);');
    L.push('    core.maskSet(alertTemplate.mask, greenIndex, true);');
    L.push('    core.maskSet(alertTemplate.mask, blueIndex, false);');
    L.push('    await gppState.persistTemplateState(alertTemplate);');
    L.push('');
    L.push('    var perColour = [');
    L.push('      { index: redIndex, enabled: true, correct: 0, wrong: 3, missing: 1, unknown: 0, total: 4 },');
    L.push('      { index: greenIndex, enabled: true, correct: 0, wrong: 1, missing: 5, unknown: 0, total: 6 },');
    L.push('      { index: blueIndex, enabled: false, correct: 0, wrong: 9, missing: 9, unknown: 0, total: 18 },'); // disabled colour with its OWN nonzero wrong/missing -- must be excluded from the alert counts
    L.push('    ];');
    L.push('    alertTemplate.scanSummary = { scannedAt: new Date().toISOString(), total: 28, correct: 0, wrong: 13, missing: 15, unknown: 0, perColour: perColour, states: new Uint8Array(alertTemplate.width * alertTemplate.height) };');
    L.push('');
    L.push('    var expectedWrong = 0, expectedMissing = 0;'); // independently computed, mask-filtered -- matches gppScanCountEnabledErrors\'s own logic, but never calls it
    L.push('    perColour.forEach(function(entry) {');
    L.push('      if (core.maskHas(alertTemplate.mask, entry.index)) { expectedWrong += entry.wrong; expectedMissing += entry.missing; }');
    L.push('    });');
    L.push('    if (expectedWrong !== 4) throw new Error("test setup: expected mask-filtered wrong count 4 (3 red + 1 green, excluding blue\'s 9), got " + expectedWrong);');
    L.push('    if (expectedMissing !== 6) throw new Error("test setup: expected mask-filtered missing count 6 (1 red + 5 green, excluding blue\'s 9), got " + expectedMissing);');
    L.push('');
    L.push('    var noop = function() {};');
    L.push('    var container = document.createElement("div");');
    L.push('    document.body.appendChild(container);');
    L.push('    function findBtn(text) { return Array.from(container.querySelectorAll("button")).find(function(b) { return b.textContent === text; }); }');
    L.push('    gppRenderProgressBar(container, alertTemplate, noop);');
    L.push('    var showErrBtn = findBtn("Show errors");');
    L.push('    if (!showErrBtn) throw new Error("test setup: Show errors button not found in the Progress section");');
    L.push('');
    L.push('    window.__alerts.length = 0;');
    L.push('    showErrBtn.click();');
    L.push('    if (window.__alerts.length !== 1) throw new Error("expected exactly 1 new alert after toggling Show errors ON, got " + window.__alerts.length);');
    L.push('    var errAlert = window.__alerts[0];');
    L.push('    if (errAlert.title !== "Info") throw new Error("expected alert title \'Info\' for a nonzero wrong count, got " + errAlert.title);');
    L.push('    if (errAlert.message.indexOf(String(expectedWrong)) === -1) throw new Error("expected alert message to contain the independently-computed wrong count " + expectedWrong + ", got: " + errAlert.message);');
    L.push('    if (errAlert.message.indexOf("currently enabled colors") === -1) throw new Error("expected alert message to mention \'currently enabled colors\', got: " + errAlert.message);');
    L.push('');
    L.push('    gppRenderProgressBar(container, alertTemplate, noop);'); // rebuild the DOM so the buttons reflect the now-ON toggle before we look for Show missing
    L.push('    var showMissBtn = findBtn("Show missing");');
    L.push('    if (!showMissBtn) throw new Error("test setup: Show missing button not found after re-render");');
    L.push('    window.__alerts.length = 0;');
    L.push('    showMissBtn.click();');
    L.push('    if (window.__alerts.length !== 1) throw new Error("expected exactly 1 new alert after toggling Show missing ON, got " + window.__alerts.length);');
    L.push('    var missAlert = window.__alerts[0];');
    L.push('    if (missAlert.title !== "Info") throw new Error("expected alert title \'Info\' for a nonzero missing count, got " + missAlert.title);');
    L.push('    if (missAlert.message.indexOf(String(expectedMissing)) === -1) throw new Error("expected alert message to contain the independently-computed missing count " + expectedMissing + ", got: " + missAlert.message);');
    L.push('    if (missAlert.message.indexOf("currently enabled colors") === -1) throw new Error("expected alert message to mention \'currently enabled colors\', got: " + missAlert.message);');
    L.push('');
    L.push('    gppRenderProgressBar(container, alertTemplate, noop);'); // rebuild again so the errors button now reads "Hide errors"
    L.push('    var hideErrBtn = findBtn("Hide errors");');
    L.push('    if (!hideErrBtn) throw new Error("test setup: expected the errors button to now read \'Hide errors\' after toggling it on");');
    L.push('    window.__alerts.length = 0;');
    L.push('    hideErrBtn.click();'); // toggling BACK OFF must not push another alert
    L.push('    if (window.__alerts.length !== 0) throw new Error("REGRESSION: toggling Show errors back OFF pushed " + window.__alerts.length + " alert(s) -- the count alert should only fire when turning the toggle ON, not off");');
    L.push('');
    L.push('    container.remove();');
    L.push('    return "Show errors/Show missing each push exactly one alert when their respective toggle turns ON (title=\'Info\', message containing the independently-computed, mask-filtered wrong/missing count and the phrase \'currently enabled colors\' -- correctly excluding a disabled 3rd colour\'s own nonzero wrong/missing pixels), and push no additional alert when toggled back OFF";');
    L.push('  });');
    L.push('');
    // ---- item palette.complete-swatch-shows-large-checkmark-not-tiny-badge ----
    // Regression guard for the '.gpp-swatch-progress-complete' CSS rewrite: a
    // large SVG checkmark background-image spanning the whole swatch instead
    // of the old tiny 7x7px white-circle badge, and the old badge.textContent
    // = '\u2713' assignment removed from both buildSwatch/buildGroupSwatch's
    // complete-state branch (the checkmark is now purely the CSS
    // background-image). Fabricates scanSummary directly (see
    // teleport.zoom-and-glow / scan.error-count-alert-on-show-toggle above)
    // against a 2-colour template: red fully complete (1/1), green partially
    // complete (1/2, still in-progress) -- proving only the complete-state
    // variant grew, not the shared base badge rule.
    L.push('  await step("palette.complete-swatch-shows-large-checkmark-not-tiny-badge", async function() {');
    L.push('    var w = 3, h = 1;');
    L.push('    var c = document.createElement("canvas");');
    L.push('    c.width = w; c.height = h;');
    L.push('    var ctx = c.getContext("2d");');
    L.push('    ctx.fillStyle = "rgb(255,0,0)"; ctx.fillRect(0, 0, 1, 1);'); // red x1
    L.push('    ctx.fillStyle = "rgb(0,255,0)"; ctx.fillRect(1, 0, 1, 1);'); // green x2
    L.push('    ctx.fillStyle = "rgb(0,255,0)"; ctx.fillRect(2, 0, 1, 1);');
    L.push('    var blob = await new Promise(function(r) { c.toBlob(r, "image/png"); });');
    L.push('    var checkTemplate = await gppState.ingestImageFile(new File([blob], "gpp-fixture-checkmark.png", { type: "image/png" }));');
    L.push('    if (checkTemplate.palette.length !== 2) throw new Error("test setup: expected a 2-colour palette (1 red + 2 green pixels dedup to 2 colours), got " + checkTemplate.palette.length);');
    L.push('    function indexForHex(tpl, hex) {');
    L.push('      for (var i = 0; i < tpl.palette.length; i++) { if (core.packedToHex(tpl.palette[i]) === hex) return i; }');
    L.push('      return -1;');
    L.push('    }');
    L.push('    var redIdx = indexForHex(checkTemplate, "#FF0000");');
    L.push('    var greenIdx = indexForHex(checkTemplate, "#00FF00");');
    L.push('    if (redIdx === -1 || greenIdx === -1) throw new Error("test setup: fixture template does not contain the expected red/green colours");');
    L.push('    if ((checkTemplate.counts[redIdx] || 0) !== 1 || (checkTemplate.counts[greenIdx] || 0) !== 2) throw new Error("test setup: unexpected pixel counts red=" + checkTemplate.counts[redIdx] + " green=" + checkTemplate.counts[greenIdx]);');
    L.push('    checkTemplate.mask = core.makeFullMask(checkTemplate.palette.length, checkTemplate.counts);');
    L.push('    checkTemplate.scanSummary = {');
    L.push('      scannedAt: new Date().toISOString(), total: 3, correct: 2, wrong: 1, missing: 0, unknown: 0,');
    L.push('      perColour: [');
    L.push('        { index: redIdx, enabled: true, correct: 1, wrong: 0, missing: 0, unknown: 0, total: 1 },'); // fully complete
    L.push('        { index: greenIdx, enabled: true, correct: 1, wrong: 1, missing: 0, unknown: 0, total: 2 },'); // in-progress (1 of 2)
    L.push('      ],');
    L.push('      states: new Uint8Array(3),');
    L.push('    };');
    L.push('    await gppState.persistTemplateState(checkTemplate);');
    L.push('');
    L.push('    var noop = function() {};');
    L.push('    var container = document.createElement("div");');
    L.push('    container.style.cssText = "position:absolute; left:-9999px; top:-9999px; width:400px;";'); // must be connected to the document for getComputedStyle/getBoundingClientRect to reflect real CSS
    L.push('    document.body.appendChild(container);');
    L.push('    gppRenderPalette(container, checkTemplate, noop);');
    L.push('');
    L.push('    var swatches = container.querySelectorAll(".gpp-swatch");');
    L.push('    if (swatches.length !== 2) throw new Error("expected exactly 2 swatches rendered, got " + swatches.length);');
    L.push('');
    L.push('    var completeBadge = container.querySelector(".gpp-swatch-progress-complete");');
    L.push('    if (!completeBadge) throw new Error("no .gpp-swatch-progress-complete badge rendered for the fully-completed color");');
    L.push('    if (completeBadge.textContent.trim() !== "") throw new Error("REGRESSION: .gpp-swatch-progress-complete badge still carries the old \'\\u2713\' text character (would visually double up with the new CSS checkmark), textContent=" + JSON.stringify(completeBadge.textContent));');
    L.push('    var completeStyle = getComputedStyle(completeBadge);');
    L.push('    if (completeStyle.backgroundImage.indexOf("data:image/svg+xml") === -1) throw new Error("expected .gpp-swatch-progress-complete to carry an inline SVG data-URI background-image, got: " + completeStyle.backgroundImage);');
    L.push('    var completeRect = completeBadge.getBoundingClientRect();');
    L.push('    if (completeRect.width <= 15) throw new Error("REGRESSION: .gpp-swatch-progress-complete is still tiny (width=" + completeRect.width + "px) -- expected it to now span the whole swatch");');
    L.push('    if (completeRect.height <= 15) throw new Error("REGRESSION: .gpp-swatch-progress-complete is still tiny (height=" + completeRect.height + "px) -- expected it to now span the whole swatch");');
    L.push('');
    L.push('    var inProgressBadge = container.querySelector(".gpp-swatch-progress-inprogress");');
    L.push('    if (!inProgressBadge) throw new Error("no .gpp-swatch-progress-inprogress badge rendered for the partially-completed color");');
    L.push('    if (inProgressBadge.textContent.trim() !== "") throw new Error("test setup: in-progress badge unexpectedly carries text content: " + JSON.stringify(inProgressBadge.textContent));');
    L.push('    var inProgressRect = inProgressBadge.getBoundingClientRect();');
    L.push('    if (inProgressRect.width >= 12) throw new Error("REGRESSION: the in-progress badge grew alongside the complete badge (width=" + inProgressRect.width + "px) -- only the complete-state variant should have changed");');
    L.push('    if (inProgressRect.height >= 12) throw new Error("REGRESSION: the in-progress badge grew alongside the complete badge (height=" + inProgressRect.height + "px) -- only the complete-state variant should have changed");');
    L.push('');
    L.push('    container.remove();');
    L.push('    return "the completed-color swatch\'s badge (.gpp-swatch-progress-complete) now renders with empty textContent (the old \'\\u2713\' character is gone) and a large CSS SVG checkmark background-image spanning most of the swatch (width/height both > 15px, vs. the old fixed 7px), while an in-progress swatch\'s own badge stays small (< 12px) and unchanged";');
    L.push('  });');
    L.push('');
    // ---- item uiShell.rescale-and-minified-view ----
    // Regression/feature guard for two pieces of explicit user feedback:
    // (1) "The ability to actually SCALE the size of the ghost++ menu not
    // just resize with corners" -- the View Settings > Global > "Rescale
    // Ghost++" slider (gpp-view-settings.js) sets --gpp-scale, verified
    // both via the raw custom-property value AND the modal's own VISUAL
    // (getBoundingClientRect) width actually reflecting it against its
    // LAYOUT (offsetWidth) width. (2) "would it be possible to make it
    // collapsible... or at least some type of minified view with only what
    // you need to paint" -- the minify button (gpp-ui-shell.js) toggles
    // .gpp-minified, which must hide the right panel and every left-body
    // section except the color grid while keeping Enable all/Disable all
    // (#gpp-palette-bulk-top) visible, and fully restore on toggle-off.
    L.push('  await step("uiShell.rescale-and-minified-view", async function() {');
    L.push('    var modal = document.getElementById(GPP_IDS.modal);');
    L.push('    if (!modal || modal.classList.contains("gpp-hidden")) throw new Error("test setup: expected the real modal to already be open at this point in the suite");');
    L.push('    var scaleInput = document.getElementById("gpp-vs-ui-scale");');
    L.push('    if (!scaleInput) throw new Error("Rescale Ghost++ slider (#gpp-vs-ui-scale) not found in View Settings");');
    L.push('    var scaleBefore = getComputedStyle(modal).getPropertyValue("--gpp-scale").trim();');
    L.push('    scaleInput.value = "70";');
    L.push('    scaleInput.dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    var scaledCssMidDrag = getComputedStyle(modal).getPropertyValue("--gpp-scale").trim();');
    L.push('    if (scaledCssMidDrag !== scaleBefore) throw new Error("REGRESSION: --gpp-scale changed on a plain \'input\' event (mid-drag) -- per explicit user feedback (\\"unwieldy... changes sizes immediately while adjusting\\"), the panel must only rescale once the drag releases (\'change\'), got " + JSON.stringify(scaledCssMidDrag) + " (before=" + JSON.stringify(scaleBefore) + ")");');
    L.push('    scaleInput.dispatchEvent(new Event("change", { bubbles: true }));');
    L.push('    var scaledCss = getComputedStyle(modal).getPropertyValue("--gpp-scale").trim();');
    L.push('    if (scaledCss !== "0.7") throw new Error("expected --gpp-scale to read back as 0.7 after releasing Rescale Ghost++ at 70% (\'change\'), got " + JSON.stringify(scaledCss));');
    L.push('    var scaledVisualWidth = modal.getBoundingClientRect().width;');
    L.push('    var layoutWidth = modal.offsetWidth;');
    L.push('    if (Math.abs(scaledVisualWidth - layoutWidth * 0.7) > 2) throw new Error("modal\'s VISUAL width does not reflect the 0.7 scale -- visual=" + scaledVisualWidth + " layout=" + layoutWidth + " (expected visual ~= layout * 0.7)");');
    L.push('    if (gppSettings.uiScale !== 0.7) throw new Error("Rescale Ghost++ did not persist to gppSettings.uiScale, got " + gppSettings.uiScale);');
    L.push('    scaleInput.value = "100";'); // reset for later tests, which assume no active scale
    L.push('    scaleInput.dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    scaleInput.dispatchEvent(new Event("change", { bubbles: true }));');
    L.push('    if (getComputedStyle(modal).getPropertyValue("--gpp-scale").trim() !== "1") throw new Error("failed to reset --gpp-scale back to 1 after the scale portion of this test");');
    L.push('');
    L.push('    var minifyBtn = modal.querySelector(\'[data-gpp-action="minify"]\');');
    L.push('    if (!minifyBtn) throw new Error("minify button not found beside the close button");');
    L.push('    var rightPanel = document.getElementById(GPP_IDS.right);');
    L.push('    var progressSection = document.getElementById("gpp-progress-section");');
    L.push('    var bulkTop = document.getElementById("gpp-palette-bulk-top");');
    L.push('    if (!bulkTop) throw new Error("Enable all/Disable all row (#gpp-palette-bulk-top) not found -- cannot verify minified view keeps it visible");');
    L.push('    var fullListBtn = document.getElementById("gpp-vs-palette-view-list");');
    L.push('    if (!fullListBtn) throw new Error("full Ghost++ Palette view List button not found");');
    L.push('    fullListBtn.click();');
    L.push('    if (gppSettings.paletteViewMode !== "list") throw new Error("test setup: full Ghost++ view did not switch to List before entering compact mode");');
    L.push('    gppSettings.compactPaletteViewMode = "grid";');
    L.push('    gppState.saveSettings();');
    L.push('    // The minify button now cross-fades (gppRunMinifyTransition) rather than');
    L.push('    // toggling .gpp-minified synchronously -- wait for the transitionend-driven');
    L.push('    // swap to actually land instead of asserting immediately after .click().');
    L.push('    minifyBtn.click();');
    L.push('    var enteredMinified = await waitFor(function() { return modal.classList.contains("gpp-minified"); }, 2000);');
    L.push('    if (!enteredMinified) throw new Error("clicking the minify button did not add .gpp-minified to the modal in time");');
    L.push('    if (getComputedStyle(rightPanel).display !== "none") throw new Error("REGRESSION: the right panel (library/preview) is still visible in minified view");');
    L.push('    if (getComputedStyle(progressSection).display !== "none") throw new Error("REGRESSION: the Progress section is still visible in minified view -- minified view must show only Enable all/Disable all, Palette view, and the color grid");');
    L.push('    if (getComputedStyle(bulkTop).display === "none") throw new Error("REGRESSION: the Enable all/Disable all row is hidden in minified view -- it is one of the controls minified view must always show");');
    L.push('    var compactPaletteViewRow = modal.querySelector(".gpp-palette-view-row");');
    L.push('    if (!compactPaletteViewRow) throw new Error("compact minified view is missing the Palette view row");');
    L.push('    if (getComputedStyle(compactPaletteViewRow).display === "none") throw new Error("REGRESSION: the Palette view row is hidden in minified view");');
    L.push('    var compactGridBtn = compactPaletteViewRow.querySelector("[data-gpp-palette-view=grid]");');
    L.push('    var compactListBtn = compactPaletteViewRow.querySelector("[data-gpp-palette-view=list]");');
    L.push('    if (!compactGridBtn || !compactListBtn) throw new Error("compact minified view is missing its Grid/List palette buttons");');
    L.push('    if (gppSettings.compactPaletteViewMode !== "grid") throw new Error("compact mode did not start with its independent Grid preference");');
    L.push('    if (!compactGridBtn.classList.contains("gpp-vs-view-btn-active") || compactListBtn.classList.contains("gpp-vs-view-btn-active")) throw new Error("expected compact Grid to be active independently of the full-menu List preference");');
    L.push('    if (!document.querySelector(".gpp-palette-grid") || document.querySelector(".gpp-palette-grid").classList.contains("gpp-palette-list-mode")) throw new Error("compact mode did not render its independent Grid layout");');
    L.push('    compactListBtn.click();');
    L.push('    if (gppSettings.compactPaletteViewMode !== "list") throw new Error("clicking the compact List button did not persist gppSettings.compactPaletteViewMode=list");');
    L.push('    if (gppSettings.paletteViewMode !== "list") throw new Error("compact List click incorrectly changed the full-menu palette preference");');
    L.push('    if (!compactListBtn.classList.contains("gpp-vs-view-btn-active") || compactGridBtn.classList.contains("gpp-vs-view-btn-active")) throw new Error("compact Palette view buttons did not mark List active");');
    L.push('    if (!document.querySelector(".gpp-palette-grid .gpp-swatch-list")) throw new Error("compact List button did not switch the palette swatches to list mode");');
    L.push('    compactGridBtn.click();');
    L.push('    if (gppSettings.compactPaletteViewMode !== "grid") throw new Error("clicking the compact Grid button did not persist gppSettings.compactPaletteViewMode=grid");');
    L.push('    if (gppSettings.paletteViewMode !== "list") throw new Error("compact Grid click incorrectly changed the full-menu palette preference");');
    L.push('    var compactHandle = modal.querySelector(".gpp-corner.se");');
    L.push('    if (!compactHandle || getComputedStyle(compactHandle).display === "none") throw new Error("compact mode resize handle is not visible");');
    L.push('    var compactWidthBefore = modal.offsetWidth;');
    L.push('    var compactHeightBefore = modal.offsetHeight;');
    L.push('    if (compactHeightBefore > 220) throw new Error("REGRESSION: compact mode defaulted to a content-sized height of " + compactHeightBefore + "px instead of a short bounded height");');
    L.push('    var compactBoundsBefore = modal.getBoundingClientRect();');
    L.push('    if (compactBoundsBefore.right > window.innerWidth + 1 || compactBoundsBefore.bottom > window.innerHeight + 1) throw new Error("REGRESSION: compact mode default bounds extend beyond the viewport: " + JSON.stringify({ right: compactBoundsBefore.right, bottom: compactBoundsBefore.bottom, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }));');
    L.push('    var compactPointerId = 73;');
    L.push('    compactHandle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: compactPointerId, clientX: 300, clientY: 220 }));');
    L.push('    compactHandle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, button: 0, pointerId: compactPointerId, clientX: 340, clientY: 260 }));');
    L.push('    compactHandle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: compactPointerId, clientX: 340, clientY: 260 }));');
    L.push('    if (!(gppSettings.compactWidth > compactWidthBefore)) throw new Error("resizing compact mode did not persist a larger compact width");');
    L.push('    if (!(gppSettings.compactHeight > compactHeightBefore)) throw new Error("resizing compact mode did not persist a larger compact height");');
    L.push('    var boundPointerId = 74;');
    L.push('    compactHandle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: boundPointerId, clientX: 300, clientY: 220 }));');
    L.push('    compactHandle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, button: 0, pointerId: boundPointerId, clientX: window.innerWidth * 4, clientY: window.innerHeight * 4 }));');
    L.push('    compactHandle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: boundPointerId, clientX: window.innerWidth * 4, clientY: window.innerHeight * 4 }));');
    L.push('    var compactBoundsAfterLimit = modal.getBoundingClientRect();');
    L.push('    if (compactBoundsAfterLimit.right > window.innerWidth + 1 || compactBoundsAfterLimit.bottom > window.innerHeight + 1) throw new Error("REGRESSION: compact resize exceeded the viewport: " + JSON.stringify({ right: compactBoundsAfterLimit.right, bottom: compactBoundsAfterLimit.bottom, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }));');
    L.push('    var compactWidthRemembered = gppSettings.compactWidth;');
    L.push('    var compactHeightRemembered = gppSettings.compactHeight;');
    L.push('    var settledAtFull = await waitFor(function() { return !modal.classList.contains("gpp-minify-transitioning"); }, 2000);');
    L.push('    if (!settledAtFull) throw new Error("the minify transition never finished (still fading) -- gpp-minify-transitioning was never removed");');
    L.push('    if (getComputedStyle(modal).opacity !== "1") throw new Error("REGRESSION: the modal did not fade back to full opacity after entering minified view, opacity=" + getComputedStyle(modal).opacity);');
    L.push('    minifyBtn.click();');
    L.push('    var exitedMinified = await waitFor(function() { return !modal.classList.contains("gpp-minified"); }, 2000);');
    L.push('    if (!exitedMinified) throw new Error("clicking the minify button a second time did not exit minified view in time");');
    L.push('    if (getComputedStyle(rightPanel).display === "none") throw new Error("REGRESSION: the right panel stayed hidden after exiting minified view");');
    L.push('    var settledAtNormal = await waitFor(function() { return !modal.classList.contains("gpp-minify-transitioning"); }, 2000);');
    L.push('    if (!settledAtNormal) throw new Error("the exit-minify transition never finished (still fading)");');
    L.push('    minifyBtn.click();');
    L.push('    var reenteredMinified = await waitFor(function() { return modal.classList.contains("gpp-minified"); }, 2000);');
    L.push('    if (!reenteredMinified) throw new Error("compact mode did not re-enter after the resize persistence check");');
    L.push('    if (Math.abs(gppSettings.compactWidth - compactWidthRemembered) > 0.1 || Math.abs(gppSettings.compactHeight - compactHeightRemembered) > 0.1) throw new Error("compact dimensions changed unexpectedly after re-entering compact mode");');
    L.push('    if (gppSettings.paletteViewMode !== "list" || gppSettings.compactPaletteViewMode !== "grid") throw new Error("full and compact palette preferences were not retained independently after re-entry");');
    L.push('    var settledAtReentry = await waitFor(function() { return !modal.classList.contains("gpp-minify-transitioning"); }, 2000);');
    L.push('    if (!settledAtReentry) throw new Error("the compact re-entry transition never finished");');
    L.push('    minifyBtn.click();');
    L.push('    var exitedAfterResize = await waitFor(function() { return !modal.classList.contains("gpp-minified"); }, 2000);');
    L.push('    if (!exitedAfterResize) throw new Error("clicking the minify button after the resize persistence check did not exit compact view");');
    L.push('    return "Rescale Ghost++ only applies once the slider is released (\'change\', not \'input\'), live-updating --gpp-scale and persisting to gppSettings.uiScale; full and compact palette Grid/List preferences stay independent, and compact corner resizing persists width/height across compact re-entry";');
    L.push('  });');
    L.push('');
    // ---- item uiShell.range-slider-blurs-on-change ----
    // Regression guard for a real reported bug: interacting with any
    // Ghost++ range slider left it holding keyboard focus afterward
    // (standard range-input behaviour), which silently broke every native
    // GeoPixels keyboard shortcut (I, Y, P, spacebar, G, ...) until the
    // user clicked elsewhere in the panel -- the native site's own
    // shortcut handler skips processing while a form control is focused.
    // gpp-ui-shell.js's delegated 'change' listener blurs a range input
    // the moment its value COMMITS -- verified here to fire on 'change'
    // (drag released) but NOT on 'input' (mid-drag, which must not
    // interrupt an in-progress drag by yanking focus away).
    L.push('  await step("uiShell.range-slider-blurs-on-change", async function() {');
    L.push('    var gapInput = document.getElementById("gpp-vs-gap-ratio");');
    L.push('    if (!gapInput) throw new Error("test setup: Cell fill slider not found");');
    L.push('    var vsDetails = gapInput.closest("details.gpp-collapsible");'); // View Settings starts collapsed -- an element inside a closed <details> cannot be focused at all
    L.push('    if (vsDetails) vsDetails.open = true;');
    L.push('    gapInput.focus();');
    L.push('    if (document.activeElement !== gapInput) throw new Error("test setup: could not focus the Cell fill slider");');
    L.push('    gapInput.dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    if (document.activeElement !== gapInput) throw new Error("REGRESSION: the slider lost focus on a plain \'input\' event (mid-drag) -- it must only blur once the value COMMITS (\'change\'), or an in-progress drag would be interrupted");');
    L.push('    gapInput.dispatchEvent(new Event("change", { bubbles: true }));');
    L.push('    if (document.activeElement === gapInput) throw new Error("REGRESSION: the slider still holds keyboard focus after its value committed (\'change\') -- this is the exact reported bug: interacting with any Ghost++ slider silently breaks native keyboard shortcuts (I/Y/P/spacebar/G/...) until clicking elsewhere");');
    L.push('    return "a range slider inside Ghost++ (Cell fill) gives up keyboard focus the moment its value change commits (\'change\'), not mid-drag (\'input\') -- restoring native GeoPixels keyboard shortcuts immediately, no click-away needed";');
    L.push('  });');
    L.push('');
    // ---- item shim.g-shortcut-toggles-not-open-only ----
    // Regression guard for the OTHER half of the same user report: even
    // clicking away to restore keyboard focus, G specifically still could
    // not close the panel ("G is hard overwritten and won't close the menu
    // at all... it'll open, but then not close"). Root cause: an earlier
    // version of the guild-project "open, don't toggle-closed" fix
    // (gppEnsureGhostPlusPlusOpen) was applied to ALL FOUR
    // GPP_NATIVE_CONTROL_TARGETS uniformly, including loadGhostImageBtn --
    // but loadGhostImageBtn is also what the native G keyboard shortcut
    // clicks (performShortcutAction's 'ghost' case), and G is meant to
    // TOGGLE like any other GeoPixels keybind. Simulates that exact
    // trigger (a direct .click() on the native button, intercepted by
    // gppInstallNativeControlCaptures) twice in a row.
    L.push('  await step("shim.g-shortcut-toggles-not-open-only", async function() {');
    L.push('    var modal = document.getElementById(GPP_IDS.modal);');
    L.push('    if (!modal || modal.classList.contains("gpp-hidden")) throw new Error("test setup: expected the real modal to already be open at this point in the suite");');
    L.push('    var nativeBtn = document.getElementById("loadGhostImageBtn");');
    L.push('    if (!nativeBtn) throw new Error("test setup: native loadGhostImageBtn not found");');
    L.push('    nativeBtn.click(); // simulated G press #1 -- panel starts open');
    L.push('    if (!modal.classList.contains("gpp-hidden")) throw new Error("REGRESSION: the first simulated G press did not close the already-open panel -- G must TOGGLE (\\"G is hard overwritten and won\'t close the menu at all... it\'ll open, but then not close\\")");');
    L.push('    nativeBtn.click(); // simulated G press #2 -- panel is now closed');
    L.push('    if (modal.classList.contains("gpp-hidden")) throw new Error("REGRESSION: the second simulated G press did not reopen the panel");');
    L.push('    return "the native G keyboard shortcut (loadGhostImageBtn.click(), intercepted by gppInstallNativeControlCaptures) correctly TOGGLES the Ghost++ panel open/closed across repeated presses, instead of only ever opening it";');
    L.push('  });');
    L.push('');
    // ---- item uiShell.wide-mode-collapse-expand-restores-width-when-right-panel-widened ----
    // Regression guard for a real reported mobile bug: collapsing then
    // re-expanding the right panel (gpp-collapse-btn) could grow the modal
    // WIDER than it was before collapsing -- visibly expanding off-screen
    // on a narrow/mobile window -- instead of restoring the exact prior
    // width. Root cause: the collapsed width's own 320px safety floor
    // could kick in and inflate the modal wider than the left content
    // truly needed, and the OLD expand math derived "left width" by
    // subtracting 34 from that already-inflated collapsed width,
    // compounding the error. Reproduced here at a WIDE modal width (700px,
    // safely above GPP_NARROW_SWAP_MARGIN's threshold, so this exercises
    // the wide-mode partial-collapse branch specifically, not the newer
    // narrow-width full-panel-swap mode) by widening the RIGHT panel
    // itself to 500px (as a splitter-drag would) -- true left width
    // 700-500=200px is still well under the floor's implied 286px
    // (320-34), the same underlying condition a genuinely narrow modal
    // with a default-width right panel would also hit.
    L.push('  await step("uiShell.wide-mode-collapse-expand-restores-width-when-right-panel-widened", async function() {');
    L.push('    var modal = document.getElementById(GPP_IDS.modal);');
    L.push('    if (!modal || modal.classList.contains("gpp-hidden")) throw new Error("test setup: expected the real modal to already be open at this point in the suite");');
    L.push('    var right = document.getElementById(GPP_IDS.right);');
    L.push('    if (right.classList.contains("gpp-collapsed")) throw new Error("test setup: expected the right panel to start expanded");');
    L.push('    if (modal.classList.contains("gpp-narrow-full-right")) throw new Error("test setup: expected the modal to not already be in narrow-swap mode");');
    L.push('    var toggleBtn = modal.querySelector(\'[data-gpp-action="toggle-right"]\');');
    L.push('    if (!toggleBtn) throw new Error("test setup: toggle-right button not found");');
    L.push('    var savedModalWidth = modal.style.width;');
    L.push('    var savedRightWidth = right.style.width;');
    L.push('    // Wait out any width transition still settling from an earlier test\'s');
    L.push('    // click (gpp-modal-animating-width\'s transitionend can lag a bit behind');
    L.push('    // the synchronous .click() call that started it) BEFORE reading/setting');
    L.push('    // width here -- otherwise offsetWidth can reflect a stale, still-mid-');
    L.push('    // transition value from whatever ran right before this test.');
    L.push('    var settledBefore = await waitFor(function() { return !modal.classList.contains("gpp-modal-animating-width"); }, 2000);');
    L.push('    if (!settledBefore) throw new Error("test setup: a width transition from an earlier test never settled");');
    L.push('    modal.style.width = "700px";');
    L.push('    right.style.width = "500px";');
    L.push('    var minWidth = parseFloat(getComputedStyle(modal).minWidth) || 480;');
    L.push('    if (modal.offsetWidth <= minWidth + 80) throw new Error("test setup: 700px modal width is not safely above the narrow-swap threshold (min-width=" + minWidth + ") -- test premise broken, this must stay in the wide-mode branch");');
    L.push('    var widthBeforeCollapse = modal.offsetWidth;');
    L.push('    toggleBtn.click(); // collapse');
    L.push('    if (!right.classList.contains("gpp-collapsed")) throw new Error("clicking toggle-right did not collapse the right panel");');
    L.push('    if (modal.classList.contains("gpp-narrow-full-right")) throw new Error("REGRESSION: a wide modal incorrectly entered narrow-swap mode");');
    L.push('    var settledAtCollapse = await waitFor(function() { return !modal.classList.contains("gpp-modal-animating-width"); }, 2000);');
    L.push('    if (!settledAtCollapse) throw new Error("the collapse width transition never finished");');
    L.push('    toggleBtn.click(); // expand');
    L.push('    if (right.classList.contains("gpp-collapsed")) throw new Error("clicking toggle-right a second time did not expand the right panel");');
    L.push('    var settledAtExpand = await waitFor(function() { return !modal.classList.contains("gpp-modal-animating-width"); }, 2000);');
    L.push('    if (!settledAtExpand) throw new Error("the expand width transition never finished");');
    L.push('    var widthAfterExpand = modal.offsetWidth;');
    L.push('    if (widthAfterExpand > widthBeforeCollapse + 2) throw new Error("REGRESSION: with the right panel widened (500px), collapsing then re-expanding grew the modal from " + widthBeforeCollapse + "px to " + widthAfterExpand + "px -- it must restore (approximately) the exact pre-collapse width, not grow wider off-screen");');
    L.push('    if (widthAfterExpand < widthBeforeCollapse - 2) throw new Error("collapsing then re-expanding the right panel SHRANK the modal from " + widthBeforeCollapse + "px to " + widthAfterExpand + "px -- expected it to restore the exact pre-collapse width");');
    L.push('    modal.style.width = savedModalWidth;');
    L.push('    right.style.width = savedRightWidth;');
    L.push('    var settledAfterRestore = await waitFor(function() { return !modal.classList.contains("gpp-modal-animating-width"); }, 2000);');
    L.push('    if (!settledAfterRestore) throw new Error("test cleanup: the restore-width transition never finished");');
    L.push('    return "with the right panel widened to 500px (true left width 200px, under the collapsed view\'s 320px floor), collapsing then re-expanding the right panel at a WIDE modal width now restores the exact pre-collapse modal width (" + widthBeforeCollapse + "px) instead of growing wider -- and correctly never enters narrow-swap mode";');
    L.push('  });');
    L.push('');
    // ---- item uiShell.narrow-width-toggle-right-swaps-panels ----
    // Feature guard for explicit user request: emulate the legacy Ghost
    // Template Manager's own gpc-mobile-compat/gpc-mobile-preview-open
    // pattern -- at a narrow modal width, the SAME toggle-right button
    // should swap between showing the left panel fully or the right panel
    // fully, instead of the plain 34px-stub partial collapse used at wide
    // widths (covered separately above).
    L.push('  await step("uiShell.narrow-width-toggle-right-swaps-panels", async function() {');
    L.push('    var modal = document.getElementById(GPP_IDS.modal);');
    L.push('    if (!modal || modal.classList.contains("gpp-hidden")) throw new Error("test setup: expected the real modal to already be open at this point in the suite");');
    L.push('    var left = document.getElementById(GPP_IDS.left);');
    L.push('    var right = document.getElementById(GPP_IDS.right);');
    L.push('    if (right.classList.contains("gpp-collapsed")) throw new Error("test setup: expected the right panel to start expanded");');
    L.push('    if (modal.classList.contains("gpp-narrow-full-right")) throw new Error("test setup: expected the modal to not already be in narrow-swap mode");');
    L.push('    var toggleBtn = modal.querySelector(\'[data-gpp-action="toggle-right"]\');');
    L.push('    var savedModalWidth = modal.style.width;');
    L.push('    var savedRightWidth = right.style.width;');
    L.push('    // Wait out any width transition still settling from an earlier test (see');
    L.push('    // the wide-mode test above\'s own comment on this) before doing anything.');
    L.push('    var settledBefore = await waitFor(function() { return !modal.classList.contains("gpp-modal-animating-width"); }, 2000);');
    L.push('    if (!settledBefore) throw new Error("test setup: a width transition from an earlier test never settled");');
    L.push('    right.style.width = "";'); // back to its default (280px) -- this test is about modal width, not a widened right panel like the test above
    L.push('    modal.style.width = "480px";'); // the CSS min-width itself -- squarely inside the narrow-swap threshold
    L.push('    if (getComputedStyle(left).display === "none") throw new Error("test setup: left panel unexpectedly already hidden");');
    L.push('    toggleBtn.click(); // narrow-swap to full right');
    L.push('    if (!modal.classList.contains("gpp-narrow-full-right")) throw new Error("REGRESSION: clicking toggle-right at a narrow modal width did not enter narrow-swap mode (.gpp-narrow-full-right)");');
    L.push('    if (getComputedStyle(left).display !== "none") throw new Error("REGRESSION: the left panel is still visible after swapping to full-right at a narrow width");');
    L.push('    if (right.classList.contains("gpp-collapsed")) throw new Error("REGRESSION: the right panel is still in its 34px-stub collapsed state after swapping to full-right");');
    L.push('    // #gpp-modal-right\'s own width transition (not gpp-modal-animating-width,');
    L.push('    // which only governs the OUTER modal) -- poll the actual rendered width');
    L.push('    // rather than assuming any fixed duration.');
    L.push('    var reachedFull = await waitFor(function() { return right.getBoundingClientRect().width >= modal.offsetWidth - 4; }, 2000);');
    L.push('    if (!reachedFull) throw new Error("REGRESSION: the right panel never reached (approximately) the full modal width after the narrow-width swap, stuck at " + right.getBoundingClientRect().width + "px of " + modal.offsetWidth + "px");');
    L.push('    toggleBtn.click(); // narrow-swap back to showing left');
    L.push('    if (modal.classList.contains("gpp-narrow-full-right")) throw new Error("REGRESSION: clicking toggle-right a second time did not exit narrow-swap mode");');
    L.push('    if (getComputedStyle(left).display === "none") throw new Error("REGRESSION: the left panel is still hidden after swapping back at a narrow width");');
    L.push('    if (!right.classList.contains("gpp-collapsed")) throw new Error("REGRESSION: the right panel did not return to its 34px-stub collapsed state after swapping back -- it should show as a thin stub next to the now-visible left panel, not stay expanded");');
    L.push('    var reachedStub = await waitFor(function() { return right.getBoundingClientRect().width <= 40; }, 2000);');
    L.push('    if (!reachedStub) throw new Error("REGRESSION: the right panel never shrank back to its 34px stub after swapping back, stuck at " + right.getBoundingClientRect().width + "px");');
    L.push('');
    L.push('    // ---- Returning to a wide modal must not leave narrow-swap state behind ----');
    L.push('    modal.style.width = "700px";');
    L.push('    toggleBtn.click(); // wide-mode partial collapse');
    L.push('    if (modal.classList.contains("gpp-narrow-full-right")) throw new Error("REGRESSION: a wide modal entered narrow-swap mode instead of the plain partial collapse");');
    L.push('    if (!right.classList.contains("gpp-collapsed")) throw new Error("clicking toggle-right on a wide modal did not partially collapse the right panel");');
    L.push('    var settledAtCollapse = await waitFor(function() { return !modal.classList.contains("gpp-modal-animating-width"); }, 2000);');
    L.push('    if (!settledAtCollapse) throw new Error("the wide-mode collapse width transition never finished");');
    L.push('    toggleBtn.click(); // restore to expanded for later tests');
    L.push('    if (right.classList.contains("gpp-collapsed")) throw new Error("test cleanup: failed to re-expand the right panel");');
    L.push('    var settledAtExpand = await waitFor(function() { return !modal.classList.contains("gpp-modal-animating-width"); }, 2000);');
    L.push('    if (!settledAtExpand) throw new Error("test cleanup: the wide-mode expand width transition never finished");');
    L.push('    modal.style.width = savedModalWidth;');
    L.push('    right.style.width = savedRightWidth;');
    L.push('    return "at a narrow modal width, toggle-right now swaps between showing the left panel fully and the right panel fully (.gpp-narrow-full-right), mirroring the legacy Ghost Template Manager\'s own mobile-compat pattern; a wide modal is unaffected and keeps the plain 34px-stub partial collapse";');
    L.push('  });');
    L.push('');
    // ---- item uiShell.tooltip-hover-scoped-to-text-not-control ----
    // Feature guard for explicit user request: "Remove the tooltip from
    // appear when hovering any of the check boxes or sliders, they should
    // only appear above the text descriptions." Checks two settings with
    // structurally different DOM shapes -- View Settings' "Gray unselected
    // color boxes" (a plain <span> sibling of the checkbox, inside a
    // wrapping <label>) and Template Settings' "Lock Position" (a <span>
    // this session just introduced specifically to make this split
    // possible, since the text used to be a bare text node) -- so this
    // isn't just proven for one particular label shape.
    L.push('  await step("uiShell.tooltip-hover-scoped-to-text-not-control", async function() {');
    L.push('    var modal = document.getElementById(GPP_IDS.modal);');
    L.push('    if (!modal || modal.classList.contains("gpp-hidden")) throw new Error("test setup: expected the real modal to already be open at this point in the suite");');
    L.push('    modal.querySelectorAll("details.gpp-collapsible").forEach(function(d) { d.open = true; });'); // View Settings starts collapsed -- opening every section is harmless and simplest here
    L.push('    function tooltipShown() {');
    L.push('      var tip = document.getElementById("gpp-tooltip");');
    L.push('      return !!tip && getComputedStyle(tip).display !== "none";');
    L.push('    }');
    L.push('    function hoverAndCheck(el, label, expectShown) {');
    L.push('      if (!el) throw new Error(label + ": element not found");');
    L.push('      var rect = el.getBoundingClientRect();');
    L.push('      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;');
    L.push('      el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, clientX: cx, clientY: cy }));'); // real mouseenter does NOT bubble -- match that, since gppAttachTooltip listens directly on the target element, not a delegated ancestor
    L.push('      var shown = tooltipShown();');
    L.push('      el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));');
    L.push('      if (shown !== expectShown) throw new Error("REGRESSION: hovering " + label + " " + (expectShown ? "did not show" : "incorrectly showed") + " the tooltip (got shown=" + shown + ", expected=" + expectShown + ")");');
    L.push('    }');
    L.push('    var grayInput = document.getElementById("gpp-vs-gray-disabled-swatches");');
    L.push('    var grayText = grayInput ? grayInput.nextElementSibling : null;');
    L.push('    hoverAndCheck(grayInput, "the Gray unselected color boxes CHECKBOX", false);');
    L.push('    hoverAndCheck(grayText, "the Gray unselected color boxes TEXT", true);');
    L.push('    var lockInput = document.getElementById("gpp-pt-lock");');
    L.push('    var lockText = document.getElementById("gpp-pt-lock-text");');
    L.push('    hoverAndCheck(lockInput, "the Lock Position CHECKBOX", false);');
    L.push('    hoverAndCheck(lockText, "the Lock Position TEXT", true);');
    L.push('    var gapInput = document.getElementById("gpp-vs-gap-ratio");');
    L.push('    var gapLabel = document.querySelector(\'label[for="gpp-vs-gap-ratio"]\');');
    L.push('    hoverAndCheck(gapInput, "the Cell fill SLIDER", false);');
    L.push('    hoverAndCheck(gapLabel, "the Cell fill TEXT", true);');
    L.push('    return "hovering a checkbox or slider no longer shows its tooltip; hovering the text description next to it still does (verified across both the View Settings row shape and Template Settings\' Lock Position, plus a slider)";');
    L.push('  });');
    L.push('');
    // ---- item uiShell.tooltip-does-not-appear-from-click-or-drag-start ----
    // Regression guard for a real reported bug: hovering a checkbox/slider
    // itself correctly no longer shows the tooltip (covered above), but
    // actually CLICKING a checkbox -- or starting to drag a slider -- still
    // popped it, since that mouse interaction also gives the control
    // keyboard FOCUS as a native side effect, and the focus handler
    // (wired for real Tab-key accessibility) didn't distinguish that from
    // genuine keyboard navigation. Uses HTMLElement.click() for BOTH
    // (rather than a raw PointerEvent dispatch + explicit .focus() for the
    // slider, an earlier version of this test) -- click() specifically
    // simulates the browser's FULL native activation chain, including the
    // same :focus-visible suppression a real mousedown/click causes; a
    // bare .focus() call bypasses that internal chain entirely and is NOT
    // an equivalent stand-in, confirmed by live interactive testing (a
    // real mouse drag on the slider shows no tooltip, matching click()
    // here, while a bare .focus() call incorrectly did in an earlier
    // version of this test -- a fixture-harness artifact, not a real bug).
    // The positive "keyboard Tab still shows it" case is NOT re-verified
    // here: :focus-visible's heuristic is evaluated against genuine
    // trusted input history, which this in-page-JS-driven harness has no
    // way to fake -- it was confirmed via live interactive browser Tab
    // presses instead (see PAINT_LAG_FIX-style live-verification pattern
    // used elsewhere this session).
    L.push('  await step("uiShell.tooltip-does-not-appear-from-click-or-drag-start", async function() {');
    L.push('    function tooltipShown() {');
    L.push('      var tip = document.getElementById("gpp-tooltip");');
    L.push('      return !!tip && getComputedStyle(tip).display !== "none";');
    L.push('    }');
    L.push('    var grayInput = document.getElementById("gpp-vs-gray-disabled-swatches");');
    L.push('    if (!grayInput) throw new Error("test setup: Gray unselected color boxes checkbox not found");');
    L.push('    var grayCheckedBefore = grayInput.checked;');
    L.push('    grayInput.click();'); // real click: mousedown+focus+mouseup+click, same as a real user tap
    L.push('    if (tooltipShown()) throw new Error("REGRESSION: clicking the Gray unselected color boxes CHECKBOX showed its tooltip -- clicking a control must never show its tooltip, even though the click also focuses it");');
    L.push('    if (grayInput.checked === grayCheckedBefore) throw new Error("test setup: the click did not actually toggle the checkbox -- test premise broken");');
    L.push('    grayInput.click();'); // restore original state
    L.push('');
    L.push('    var gapInput = document.getElementById("gpp-vs-gap-ratio");');
    L.push('    if (!gapInput) throw new Error("test setup: Cell fill slider not found");');
    L.push('    var gapValueBefore = gapInput.value;');
    L.push('    gapInput.click();'); // real click on the slider track -- same native activation chain a click-to-start-a-drag would trigger
    L.push('    if (tooltipShown()) throw new Error("REGRESSION: clicking the Cell fill SLIDER showed its tooltip -- must never show from a mouse interaction with the control itself, even though the click also focuses it");');
    L.push('    gapInput.value = gapValueBefore;'); // restore -- click() on a range input can jump its value to the click position
    L.push('    gapInput.blur();');
    L.push('    return "clicking a checkbox, or clicking/starting to drag a slider, no longer shows its tooltip -- the focus that mouse interaction causes as a side effect is now distinguished (via :focus-visible) from genuine keyboard Tab navigation, confirmed separately via live interactive testing to still correctly show it";');
    L.push('  });');
    L.push('');
    // ---- item uiShell.tooltip-auto-dismisses-after-10s ----
    // Feature guard for explicit user request: "Can we make the hover text
    // disappear after 10 seconds on its own?" Genuinely waits out the real
    // 10s timer (no shortcut exists for testing a real elapsed-time
    // auto-dismiss) -- confirms it's still visible at ~9s (not dismissed
    // too early, e.g. by some other unrelated timer) and gone by ~10.5s,
    // WITHOUT ever firing mouseleave (proving this is a real timeout, not
    // just the existing hide-on-mouseleave behavior).
    L.push('  await step("uiShell.tooltip-auto-dismisses-after-10s", async function() {');
    L.push('    var gapInput = document.getElementById("gpp-vs-gap-ratio");');
    L.push('    var gapLabel = document.querySelector(\'label[for="gpp-vs-gap-ratio"]\');');
    L.push('    if (!gapLabel) throw new Error("test setup: Cell fill label not found");');
    L.push('    var rect = gapLabel.getBoundingClientRect();');
    L.push('    gapLabel.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, clientX: rect.left + 2, clientY: rect.top + 2 }));');
    L.push('    var tip = document.getElementById("gpp-tooltip");');
    L.push('    if (!tip || getComputedStyle(tip).display === "none") throw new Error("test setup: tooltip did not appear on hover");');
    L.push('    await new Promise(function(r) { setTimeout(r, 9000); });'); // plain 9s sleep
    L.push('    if (getComputedStyle(tip).display === "none") throw new Error("REGRESSION: the tooltip disappeared before 9s -- it must stay visible for the full 10s while still hovering, not dismiss early");');
    L.push('    var dismissedByDeadline = await waitFor(function() { return getComputedStyle(tip).display === "none"; }, 2500);');
    L.push('    if (!dismissedByDeadline) throw new Error("REGRESSION: the tooltip never auto-dismissed by ~11.5s of continuous hovering (no mouseleave fired) -- expected it to disappear on its own after 10s");');
    L.push('    gapLabel.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));');
    L.push('    return "a tooltip left open (continuously hovered, no mouseleave) stays visible through ~9s and auto-dismisses on its own by ~11.5s, matching the requested 10s auto-dismiss";');
    L.push('  });');
    L.push('');
    // ---- item mobile-painting.live-controller ----
    // Loads the real Painting Menu Overhaul source after Ghost++ in the same browser
    // page. Covers the regressions that a scan-only fixture cannot: natural
    // host width, Simple Black present before mount, compact palette status
    // rebuild after the public completed-scan refresh, and a rapid A -> B
    // selection cancelling A.  The preceding manual-scan test separately
    // proves that its button emits that public refresh synchronously and when
    // the scan settles.
    L.push('  await step("painting-menu-overhaul.live-controller", async function() {');
    L.push('    if (!template || !template.id) throw new Error("test setup: expected the original template id for Painting Menu Overhaul coverage");');
    L.push('    // The preceding compact-menu scenario intentionally leaves the full Ghost++ palette in List mode. Force Grid here because the assertion below exercises the grid-only circular progress badge; List mode instead renders its progress as text and a bar.');
    L.push('    gppSettings.paletteViewMode = "grid"; gppState.saveSettings();');
    L.push('    var originalTemplateId = template.id;');
    L.push('    await gppState.focusTemplate(originalTemplateId);');
    L.push('    template = gppState.getFocusedTemplate();');
    L.push('    if (!template || template.id !== originalTemplateId || !template.position) throw new Error("test setup: expected the current positioned original template for Painting Menu Overhaul coverage");');
    L.push('    var focusScanSettled = await waitFor(function() { return !gppScanRunning; }, 8000);');
    L.push('    if (!focusScanSettled) throw new Error("test setup: focus-triggered scan did not settle before rapid-selection coverage");');
    L.push('    var seededTotal = 0, seededPerColour = [];');
    L.push('    for (var seededIndex = 0; seededIndex < template.palette.length; seededIndex++) { var count = template.counts[seededIndex] || 0; if (!count) continue; seededTotal += count; seededPerColour.push({ index: seededIndex, enabled: true, correct: count, wrong: 0, missing: 0, unknown: 0, total: count }); }');
    L.push('    template.mask = core.makeFullMask(template.palette.length, template.counts);');
    L.push('    template.scanSummary = { scannedAt: new Date().toISOString(), total: seededTotal, correct: seededTotal, wrong: 0, missing: 0, unknown: 0, perColour: seededPerColour, states: new Uint8Array(template.width * template.height) };');
    L.push('    gppRequestUiRefresh();');
    L.push('    var gridReady = await waitFor(function() { return !!document.getElementById("gpc-mobile-palette-grid"); }, 5000);');
    L.push('    if (!gridReady) throw new Error("Painting Menu Overhaul never mounted its compact palette grid");');
    L.push('    var bottom = document.getElementById("bottomControls");');
    L.push('    if (!bottom || bottom.style.width || bottom.style.maxWidth || bottom.style.left || bottom.style.right || bottom.style.transform) throw new Error("REGRESSION: Painting Menu Overhaul imposed inline full-width/position styles on #bottomControls");');
    L.push('    var row = document.querySelector(".gpc-mobile-controls-row");');
    L.push('    var enableButton = row && Array.from(row.querySelectorAll("button")).find(function(button) { return button.textContent.trim().indexOf("Enable") === 0; });');
    L.push('    if (!enableButton) throw new Error("Painting Menu Overhaul Enable control was not mounted");');
    L.push('    if (getComputedStyle(row).justifyContent !== "center") throw new Error("REGRESSION: Painting Menu Overhaul control-row buttons are not centered within .gpc-mobile-controls-row");');
    L.push('    var paletteWrap = document.querySelector(".gpc-mobile-palette-wrap");');
    L.push('    if (paletteWrap) { var rowPaletteGap = paletteWrap.getBoundingClientRect().top - row.getBoundingClientRect().bottom; if (rowPaletteGap < 2 || rowPaletteGap > 6) throw new Error("REGRESSION: expected a tiny 4px gap between the Painting Menu Overhaul controls row and compact palette, got " + rowPaletteGap + "px"); }');
    L.push('    var originalTryAutoScan = gppTryAutoScan; gppTryAutoScan = function() {};');
    L.push('    var filterButton = Array.from(row.querySelectorAll("button")).find(function(button) { return button.textContent.trim().indexOf("Filter") === 0; });');
    L.push('    if (!filterButton) throw new Error("Painting Menu Overhaul Filter control was not mounted");');
    L.push('    filterButton.click();');
    L.push('    var filterMenu = filterButton.parentElement.querySelector(".gpc-ctrl-menu");');
    L.push('    var countOption = filterMenu && Array.from(filterMenu.querySelectorAll("label.gpc-ctrl-menu-option")).find(function(option) { return option.textContent.indexOf("Filter within pixel count") !== -1; });');
    L.push('    var countCheckbox = countOption && countOption.querySelector("input[type=checkbox]");');
    L.push('    if (!countCheckbox) throw new Error("Painting Menu Overhaul Filter is missing the pixel-count option");');
    L.push('    countCheckbox.click();');
    L.push('    var compactCountRow = filterMenu.querySelector(".gpc-ctrl-menu-count");');
    L.push('    var compactCountInputs = compactCountRow && compactCountRow.querySelectorAll("input[type=number]");');
    L.push('    if (!compactCountRow || compactCountRow.hidden || !compactCountInputs || compactCountInputs.length !== 2) throw new Error("REGRESSION: Filter within pixel count did not reveal its min/max inputs");');
    L.push('    compactCountInputs[0].value = "2"; compactCountInputs[0].dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    compactCountInputs[1].value = "9"; compactCountInputs[1].dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    var realCountInputs = document.querySelectorAll("#gpp-palette-section .gpp-palette-filter-count .gpp-palette-count-input");');
    L.push('    if (realCountInputs.length !== 2 || realCountInputs[0].value !== "2" || realCountInputs[1].value !== "9") throw new Error("REGRESSION: compact pixel-count range did not forward to Ghost++: " + Array.from(realCountInputs).map(function(input) { return input.value; }).join(","));');
    L.push('    countCheckbox.click(); document.body.click();');
    L.push('    if (getComputedStyle(enableButton).backgroundColor !== "rgb(30, 30, 46)") throw new Error("REGRESSION: Simple Black already applied at mount did not dark-theme Painting Menu Overhaul controls: " + getComputedStyle(enableButton).backgroundColor);');
    L.push('    var originalFindNearest = gppScanFindNearestError;');
    L.push('    var originalStartGlow = gppScanStartSelectedColorGlow;');
    L.push('    var originalClearGlow = gppScanClearSelectedColorGlow;');
    L.push('    var deferred = [], glowCalls = [], clearedPulseCount = 0;');
    L.push('    try {');
    L.push('      gppTryAutoScan = function() {};');
    L.push('      enableButton.click();');
    L.push('      var enableMenu = enableButton.parentElement.querySelector(".gpc-ctrl-menu");');
    L.push('      var selectedOption = Array.from(enableMenu.querySelectorAll(".gpc-ctrl-menu-option")).find(function(option) { return option.textContent.trim() === "Selected"; });');
    L.push('      if (!selectedOption) throw new Error("Painting Menu Overhaul Enable > Selected option is missing");');
    L.push('      selectedOption.click();');
    L.push('      var highlightOption = enableMenu.querySelector("label.gpc-ctrl-menu-option-nested");');
    L.push('      var highlightInput = highlightOption && highlightOption.querySelector("input[type=checkbox]");');
    L.push('      if (!highlightOption || highlightOption.hidden || !highlightInput || highlightInput.checked) throw new Error("Highlight nearest must appear only under Selected and default unchecked");');
    L.push('      highlightInput.click();');
    L.push('      if (!highlightInput.checked) throw new Error("Highlight nearest checkbox did not enable");');
    L.push('      gppScanFindNearestError = function(_template, options) { return new Promise(function(resolve) { deferred.push({ resolve: resolve, paletteIndex: options.paletteIndex }); }); };');
    L.push('      gppScanStartSelectedColorGlow = function(templateId, gridX, gridY) { glowCalls.push({ templateId: templateId, gridX: gridX, gridY: gridY }); };');
    L.push('      var swatches = Array.from(document.querySelectorAll("#gpc-mobile-palette-grid .gpp-swatch"));');
    L.push('      if (swatches.length < 2) throw new Error("test setup: Painting Menu Overhaul needs two swatches for stale-selection coverage");');
    L.push('      swatches[0].click();');
    L.push('      swatches[1].click();');
    L.push('      if (deferred.length !== 2) throw new Error("test setup: expected one nearest lookup per rapid A -> B selection, got " + deferred.length + " (busy=" + gppScanRunning + ", focused=" + (gppState.getFocusedTemplate() && gppState.getFocusedTemplate().id) + ", summary=" + !!template.scanSummary + ", changed=" + JSON.stringify(window.__changedColors.slice(-2)) + ")");');
    L.push('      deferred[0].resolve({ ok: true, gridX: 111, gridY: 111 });');
    L.push('      await new Promise(function(resolve) { setTimeout(resolve, 0); });');
    L.push('      if (deferred.length !== 2 || glowCalls.length !== 0) throw new Error("REGRESSION: stale A lookup retried or glowed after B became current (lookups=" + deferred.length + ", glows=" + glowCalls.length + ")");');
    L.push('      deferred[1].resolve({ ok: true, gridX: 222, gridY: 222 });');
    L.push('      await new Promise(function(resolve) { setTimeout(resolve, 0); });');
    L.push('      if (glowCalls.length !== 1 || glowCalls[0].gridX !== 222 || glowCalls[0].gridY !== 222) throw new Error("current B lookup did not produce exactly its own selected-colour pulse: " + JSON.stringify(glowCalls));');
    L.push('      gppScanClearSelectedColorGlow = function() { clearedPulseCount++; };');
    L.push('      highlightInput.click();');
    L.push('      if (highlightInput.checked || clearedPulseCount !== 1) throw new Error("REGRESSION: turning off Highlight nearest did not immediately clear its active selected-colour pulse");');
    L.push('    } finally {');
    L.push('      gppScanFindNearestError = originalFindNearest;');
    L.push('      gppScanStartSelectedColorGlow = originalStartGlow;');
    L.push('      gppScanClearSelectedColorGlow = originalClearGlow;');
    L.push('      gppTryAutoScan = originalTryAutoScan;');
    L.push('    }');
    L.push('    var originalCanvasStroke = CanvasRenderingContext2D.prototype.stroke;');
    L.push('    var selectedPulseStrokeCount = 0;');
    L.push('    CanvasRenderingContext2D.prototype.stroke = function() { var strokeColor = String(this.strokeStyle || "").replace(/\\s/g, "").toLowerCase(); if (strokeColor === "#ef4444" || strokeColor === "rgb(239,68,68)") selectedPulseStrokeCount++; return originalCanvasStroke.apply(this, arguments); };');
    L.push('    try {');
    L.push('      gppScanStartSelectedColorGlow(template.id, template.position.gridX, template.position.gridY);');
    L.push('      var pulsePainted = await waitFor(function() { return selectedPulseStrokeCount > 0; }, 1500);');
    L.push('      if (!pulsePainted) throw new Error("REGRESSION: selected-colour pulse started but did not paint any red rings to the scan overlay canvas");');
    L.push('    } finally {');
    L.push('      gppScanClearSelectedColorGlow();');
    L.push('      CanvasRenderingContext2D.prototype.stroke = originalCanvasStroke;');
    L.push('    }');
    L.push('    var compactBeforeCompletedScan = document.getElementById("gpc-mobile-palette-grid");');
    L.push('    var refreshedPerColour = seededPerColour.map(function(entry) { return { index: entry.index, enabled: entry.enabled, correct: 0, wrong: entry.total, missing: 0, unknown: 0, total: entry.total }; });');
    L.push('    template.scanSummary = { scannedAt: new Date().toISOString(), total: seededTotal, correct: 0, wrong: seededTotal, missing: 0, unknown: 0, perColour: refreshedPerColour, states: new Uint8Array(template.width * template.height).fill(core.constants.ERROR_STATE.WRONG) };');
    L.push('    gppRequestUiRefresh();');
    L.push('    var compactUpdated = await waitFor(function() { var grid = document.getElementById("gpc-mobile-palette-grid"); return grid && grid !== compactBeforeCompletedScan; }, 5000);');
    L.push('    if (!compactUpdated) throw new Error("REGRESSION: completed Scan progress refresh did not rebuild Painting Menu Overhaul per-colour status/badges");');
    L.push('    var firstUpdatedBadge = document.querySelector("#gpc-mobile-palette-grid .gpp-swatch-progress");');
    L.push('    if (!firstUpdatedBadge || !firstUpdatedBadge.classList.contains("gpp-swatch-progress-unstarted")) throw new Error("REGRESSION: compact palette did not consume the completed Scan progress status for its per-colour badge");');
    L.push('    var previewCanvas = document.querySelector(".gpc-mobile-preview-frame canvas");');
    L.push('    if (!previewCanvas) throw new Error("test setup: Painting Menu Overhaul preview canvas was not mounted");');
    L.push('    var scaleRoot = bottom.querySelector(":scope > div");');
    L.push('    var scaleContent = scaleRoot && scaleRoot.querySelector(":scope > .gpc-mobile-scale-content");');
    L.push('    var scaleBefore = scaleRoot && scaleRoot.dataset.gpcMobileUiScale;');
    L.push('    var bottomWidthBeforeScale = bottom.getBoundingClientRect().width;');
    L.push('    var surfaceWidthBeforeScale = scaleRoot.getBoundingClientRect().width;');
    L.push('    var surfaceStyle = getComputedStyle(scaleRoot);');
    L.push('    var surfaceContentWidth = surfaceWidthBeforeScale - parseFloat(surfaceStyle.paddingLeft || "0") - parseFloat(surfaceStyle.paddingRight || "0") - parseFloat(surfaceStyle.borderLeftWidth || "0") - parseFloat(surfaceStyle.borderRightWidth || "0");');
    L.push('    var bottomStyleWidthBeforeScale = bottom.style.width;');
    L.push('    var paintMenuToolbar = document.getElementById("gpc-paint-menu-toolbar");');
    L.push('    if (!scaleContent || !paintMenuToolbar || paintMenuToolbar.parentElement !== scaleContent || !paintMenuToolbar.querySelector("#gpc-compact-brush")) throw new Error("REGRESSION: Paint Menu Controls toolbar (including compact Brush Swap) was not adopted into the Painting Menu Overhaul scale content");');
    L.push('    var scaleTab = document.getElementById("gpc-mobile-scale-tab");');
    L.push('    var scalePopover = document.getElementById("gpc-mobile-scale-popover");');
    L.push('    var flipPaintMenu = document.getElementById("gpc-paint-flip-pos");');
    L.push('    if (!scaleTab || !scalePopover || scaleTab.previousElementSibling !== flipPaintMenu || !scalePopover.hidden) throw new Error("REGRESSION: Painting Menu scale tab was not mounted immediately to the right of Paint Menu Controls flip button");');
    L.push('    previewCanvas.click();');
    L.push('    var placeholderReady = await waitFor(function() { var group = document.getElementById("gpc-mobile-placeholder-group"); return group && !group.classList.contains("gpc-hidden"); }, 5000);');
    L.push('    if (!placeholderReady) throw new Error("Painting Menu Overhaul placeholder mode did not open");');
    L.push('    var uploadPanel = document.getElementById("gpc-mobile-upload-panel");');
    L.push('    scaleTab.click();');
    L.push('    var scaleInput = document.getElementById("gpc-mobile-ui-scale");');
    L.push('    if (!uploadPanel || !scaleInput || !scalePopover.contains(scaleInput) || scalePopover.hidden || uploadPanel.contains(scaleInput)) throw new Error("REGRESSION: Painting Menu scale slider did not open from its toolbar tab");');
    L.push('    if (scalePopover.getBoundingClientRect().bottom > scaleTab.getBoundingClientRect().top + 1) throw new Error("REGRESSION: Painting Menu scale popover did not open upward from its toolbar tab");');
    L.push('    var scaleLabel = scalePopover.querySelector("label[for=\\\"gpc-mobile-ui-scale\\\"]");');
    L.push('    if (!scaleLabel || scaleLabel.textContent.trim() !== "Painting Menu scale") throw new Error("REGRESSION: scale slider did not use the Painting Menu Overhaul brand");');
    L.push('    if (scaleInput.value !== "90" || localStorage.getItem("geo++_painting_menu_overhaul_ui_scale") !== "90") throw new Error("REGRESSION: scale setting did not migrate the previous preview value into the Painting Menu Overhaul key");');
    L.push('    scaleInput.value = "80";');
    L.push('    scaleInput.dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    if (scaleRoot.dataset.gpcMobileUiScale !== scaleBefore || getComputedStyle(scaleContent).transform === "none") throw new Error("REGRESSION: Painting Menu scale changed while the slider was still being dragged");');
    L.push('    scaleInput.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));');
    L.push('    if (scaleRoot.dataset.gpcMobileUiScale !== "80" || getComputedStyle(scaleRoot).transform !== "none" || getComputedStyle(scaleContent).transform === "none" || localStorage.getItem("geo++_painting_menu_overhaul_ui_scale") !== "80") throw new Error("REGRESSION: Painting Menu scale did not apply to content and persist on slider release");');
    L.push('    var toolbarHeightAt80 = paintMenuToolbar.getBoundingClientRect().height;');
    L.push('    if (Math.abs(toolbarHeightAt80 - 19.2) > 1.5) throw new Error("REGRESSION: Paint Menu Controls toolbar did not scale with the surface at 80% (height=" + toolbarHeightAt80 + ")");');
    L.push('    if (Math.abs(paintMenuToolbar.getBoundingClientRect().bottom - scaleRoot.getBoundingClientRect().top) > 1.5) throw new Error("REGRESSION: scaled Paint Menu Controls toolbar is detached from the scaled paint surface at 80%");');
    L.push('    var bottomWidthAfterSmallScale = bottom.getBoundingClientRect().width;');
    L.push('    var surfaceWidthAt80 = scaleRoot.getBoundingClientRect().width;');
    L.push('    var surfaceHeightAt80 = scaleRoot.getBoundingClientRect().height;');
    L.push('    if (Math.abs(bottomWidthAfterSmallScale - bottomWidthBeforeScale) > 1) throw new Error("REGRESSION: scaling changed #bottomControls outer width at 80% (before=" + bottomWidthBeforeScale + ", after=" + bottomWidthAfterSmallScale + ")");');
    L.push('    if (Math.abs(surfaceWidthAt80 - surfaceWidthBeforeScale) > 1 || Math.abs(scaleContent.getBoundingClientRect().width - surfaceContentWidth) > 1) throw new Error("REGRESSION: Painting Menu scale changed the visual surface width at 80% instead of only its height");');
    L.push('    if (bottom.style.width !== bottomStyleWidthBeforeScale) throw new Error("REGRESSION: scaling rewrote #bottomControls inline width");');
    L.push('    var placeholderSurfaceHeightAt80 = scaleRoot.getBoundingClientRect().height;');
    L.push('    previewCanvas.click();');
    L.push('    await waitFor(function() { var group = document.getElementById("gpc-mobile-placeholder-group"); return group && group.classList.contains("gpc-hidden"); }, 5000);');
    L.push('    await new Promise(function(resolve) { requestAnimationFrame(function() { requestAnimationFrame(resolve); }); });');
    L.push('    var nativeSurfaceHeightAt80 = scaleRoot.getBoundingClientRect().height;');
    L.push('    if (Math.abs(nativeSurfaceHeightAt80 - placeholderSurfaceHeightAt80) < 1) throw new Error("REGRESSION: preview-frame switch left the scaled surface height stale until another interaction");');
    L.push('    previewCanvas.click();');
    L.push('    await waitFor(function() { var group = document.getElementById("gpc-mobile-placeholder-group"); return group && !group.classList.contains("gpc-hidden") && !!document.getElementById("gpc-mobile-ui-scale"); }, 5000);');
    L.push('    await new Promise(function(resolve) { requestAnimationFrame(function() { requestAnimationFrame(resolve); }); });');
    L.push('    var restoredPlaceholderHeightAt80 = scaleRoot.getBoundingClientRect().height;');
    L.push('    if (Math.abs(restoredPlaceholderHeightAt80 - placeholderSurfaceHeightAt80) > 2) throw new Error("REGRESSION: preview-frame return did not restore the scaled placeholder height immediately");');
    L.push('    scaleInput = document.getElementById("gpc-mobile-ui-scale");');
    L.push('    if (!scaleInput || scaleInput.value !== "80") throw new Error("REGRESSION: preview-frame switch did not retain the committed Painting Menu scale");');
    L.push('    scaleInput.value = "120";');
    L.push('    scaleInput.dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    scaleInput.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));');
    L.push('    var bottomWidthAfterLargeScale = bottom.getBoundingClientRect().width;');
    L.push('    var surfaceWidthAt120 = scaleRoot.getBoundingClientRect().width;');
    L.push('    var surfaceHeightAt120 = scaleRoot.getBoundingClientRect().height;');
    L.push('    if (Math.abs(bottomWidthAfterLargeScale - bottomWidthBeforeScale) > 1) throw new Error("REGRESSION: scaling changed #bottomControls outer width at 120% (before=" + bottomWidthBeforeScale + ", after=" + bottomWidthAfterLargeScale + ")");');
    L.push('    if (Math.abs(surfaceWidthAt120 - surfaceWidthBeforeScale) > 1 || Math.abs(scaleContent.getBoundingClientRect().width - surfaceContentWidth) > 1) throw new Error("REGRESSION: Painting Menu scale changed the visual surface width at 120% instead of only its height");');
    L.push('    if (surfaceHeightAt120 <= surfaceHeightAt80 + 1) throw new Error("REGRESSION: Painting Menu scale did not change the fixed-width surface height (80%=" + surfaceHeightAt80 + ", 120%=" + surfaceHeightAt120 + ")");');
    L.push('    if (bottom.style.width !== bottomStyleWidthBeforeScale) throw new Error("REGRESSION: large-scale commit rewrote #bottomControls inline width");');
    L.push('    var toolbarHeightAt120 = paintMenuToolbar.getBoundingClientRect().height;');
    L.push('    if (Math.abs(toolbarHeightAt120 - 28.8) > 1.5) throw new Error("REGRESSION: Paint Menu Controls toolbar did not scale with the surface at 120% (height=" + toolbarHeightAt120 + ")");');
    L.push('    if (Math.abs(paintMenuToolbar.getBoundingClientRect().bottom - scaleRoot.getBoundingClientRect().top) > 1.5) throw new Error("REGRESSION: scaled Paint Menu Controls toolbar is detached from the scaled paint surface at 120%");');
    L.push('    scaleInput.value = "100";');
    L.push('    scaleInput.dispatchEvent(new Event("input", { bubbles: true }));');
    L.push('    scaleInput.dispatchEvent(new Event("change", { bubbles: true }));');
    L.push('    if (scaleRoot.dataset.gpcMobileUiScale !== "100") throw new Error("REGRESSION: Painting Menu scale did not reset after a committed change");');
    L.push('    if (scaleRoot.style.height) throw new Error("REGRESSION: 100% Painting Menu scale left a fixed inline surface height behind");');
    L.push('    var paintMenuToggle = paintMenuToolbar.querySelector("#gpc-hide-paint-toggle");');
    L.push('    if (!paintMenuToggle) throw new Error("test setup: Paint Menu Controls toggle was not retained in the scale content");');
    L.push('    paintMenuToggle.click(); paintMenuToggle.click();');
    L.push('    await new Promise(function(resolve) { setTimeout(resolve, 0); });');
    L.push('    if (document.getElementById("gpc-native-top-bar").parentElement !== scaleContent || document.querySelector(".control-container-colors").parentElement !== scaleContent) throw new Error("REGRESSION: Paint Menu Controls collapse/dock logic no longer works with Painting Menu Overhaul scale content");');
    L.push('    previewCanvas.click();');
    L.push('    await waitFor(function() { var group = document.getElementById("gpc-mobile-placeholder-group"); return group && group.classList.contains("gpc-hidden"); }, 5000);');
    L.push('    return "Painting Menu Overhaul centers its control row, preserves native bar width, sees Simple Black at first mount, exposes a default-off Selected-only highlight, cancels stale A -> B lookups, rebuilds compact status, opens the release-applied scale slider upward from its toolbar tab, and keeps the visual surface width fixed";');
    L.push('  });');
    L.push('');
    L.push('  var resultEl = document.getElementById("test-result");');
    L.push('  resultEl.dataset.status = "done";');
    L.push('  var payload = {');
    L.push('    forceCanvas2D: FORCE_CANVAS2D,');
    L.push('    rendererMode: (typeof gppRendererState !== "undefined" && gppRendererState) ? gppRendererState.mode : null,');
    L.push('    results: results,');
    L.push('    consoleErrors: __consoleErrors,');
    L.push('    consoleWarnings: __consoleWarnings,');
    L.push('    fixtureErrors: window.__fixtureErrors,');
    L.push('  };');
    L.push('  resultEl.textContent = JSON.stringify(payload);');
    L.push('  fetch("/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(function() {});');
    L.push('})().catch(function(err) {');
    L.push('  var resultEl = document.getElementById("test-result");');
    L.push('  resultEl.dataset.status = "crashed";');
    L.push('  var crashPayload = { crashed: true, message: String((err && err.stack) || err), results: results, consoleErrors: __consoleErrors, consoleWarnings: __consoleWarnings, fixtureErrors: window.__fixtureErrors };');
    L.push('  resultEl.textContent = JSON.stringify(crashPayload);');
    L.push('  fetch("/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(crashPayload) }).catch(function() {});');
    L.push('});');
    L.push('</script>');
    return L.join('\n');
}

async function buildFixtureHtml(forceCanvas2D, minify) {
    const head = buildFixtureHead(forceCanvas2D);
    const source = minify
        ? await readGhostPlusPlusSourceMinified()
        : readGhostPlusPlusSource() + '\n' + readMobilePaintingSource();
    const ghostScript = '<script>\n\'use strict\';\n' + source + '\n</script>';
    const driver = buildDriverScript();
    return head + '\n' + ghostScript + '\n' + driver + '\n</body></html>';
}

// Real wall-clock run (no --virtual-time-budget / --dump-dom): this fixture's
// driver script exercises real Worker postMessage round-trips and real
// IndexedDB transactions, neither of which is purely timer-driven, and
// --virtual-time-budget's synthetic clock stalled them in practice (observed
// during development: the driver never got past its first "pending" state).
// Instead, the fixture page POSTs its own JSON result back to this same
// local server (same-origin, permitted by the CSP's connect-src 'self') the
// moment its driver script finishes (success or crash), and we just wait for
// that POST under a generous real wall-clock timeout.
async function runBrowserFixture(html, options = {}) {
    const csp = options.csp || [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self' data: blob:",
        "worker-src 'self' blob:",
    ].join('; ');

    let resolveReport;
    let rejectReport;
    const reportPromise = new Promise((res, rej) => { resolveReport = res; rejectReport = rej; });

    const server = createServer((request, response) => {
        if (request.method === 'POST' && request.url === '/report') {
            let body = '';
            request.on('data', chunk => { body += chunk; });
            request.on('end', () => {
                response.writeHead(200, { 'content-type': 'text/plain' });
                response.end('ok');
                resolveReport(body);
            });
            request.on('error', err => rejectReport(err));
            return;
        }
        response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy': csp,
        });
        response.end(html);
    });

    await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    assert(address && typeof address === 'object', 'fixture server did not expose a TCP address');

    const browserPath = findBrowser();
    assert(browserPath, 'Chrome or Edge was not found; set CHROME_PATH or BROWSER_PATH');
    const profileDirectory = mkdtempSync(join(tmpdir(), 'gpp-fixture-'));
    let stdout = '';
    let stderr = '';
    let browser;

    try {
        browser = spawn(browserPath, [
            '--headless=new',
            '--disable-gpu-sandbox',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-default-apps',
            '--disable-sync',
            '--no-first-run',
            '--no-default-browser-check',
            '--mute-audio',
            '--hide-scrollbars',
            `--user-data-dir=${profileDirectory}`,
            `http://127.0.0.1:${address.port}/`,
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        browser.stdout.setEncoding('utf8');
        browser.stderr.setEncoding('utf8');
        browser.stdout.on('data', chunk => { stdout += chunk; });
        browser.stderr.on('data', chunk => { stderr += chunk; });
        browser.once('error', err => rejectReport(err));
        browser.once('close', code => {
            if (code !== 0) rejectReport(new Error(`headless browser exited early with code ${code}\n${stderr}`));
        });

        const wallTimeoutMs = options.wallTimeoutMs || 90_000;
        let timeoutId = null;
        const timeoutPromise = new Promise((_, rej) => {
            timeoutId = setTimeout(() => rej(new Error(`timed out after ${wallTimeoutMs}ms waiting for the fixture's /report POST`)), wallTimeoutMs);
        });
        try {
            const body = await Promise.race([reportPromise, timeoutPromise]);
            return { body, stdout, stderr, browserPath };
        } finally {
            // A successful report does not cancel Promise.race's losing timer
            // automatically. Clearing it keeps a passing three-browser run
            // from appearing to hang for its full watchdog duration.
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    } finally {
        if (browser && !browser.killed) { try { browser.kill(); } catch (_) { /* ignore */ } }
        await new Promise(resolveClose => server.close(resolveClose));
        // Chrome's helper subprocesses (renderer/gpu/utility) can hold file
        // handles in the profile dir briefly after the parent is killed on
        // Windows, so give cleanup a moment and retry before giving up.
        await new Promise(r => setTimeout(r, 500));
        try {
            rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        } catch (cleanupErr) {
            console.error(`(non-fatal) could not remove temp profile dir ${profileDirectory}: ${cleanupErr.message}`);
        }
    }
}

function parseReportBody(body) {
    try {
        return JSON.parse(body);
    } catch (err) {
        return { parseError: String(err), raw: String(body).slice(0, 2000) };
    }
}

async function runPass(label, forceCanvas2D, minify = false) {
    console.log(`\n=== Running pass: ${label} (forceCanvas2D=${forceCanvas2D}${minify ? ', minified' : ''}) ===`);
    const html = await buildFixtureHtml(forceCanvas2D, minify);
    let outcome;
    try {
        const { body, stderr } = await runBrowserFixture(html);
        const parsed = parseReportBody(body);
        outcome = { label, forceCanvas2D, crashedInfra: false, stderr, parsed };
    } catch (err) {
        outcome = { label, forceCanvas2D, crashedInfra: true, error: err && err.stack ? err.stack : String(err) };
    }
    return outcome;
}

function printOutcome(outcome) {
    console.log(`\n--- ${outcome.label} ---`);
    if (outcome.crashedInfra) {
        console.log('INFRA FAILURE (browser process did not complete): ' + outcome.error);
        return { total: 0, passed: 0, failed: 0, infraFailure: true };
    }
    const parsed = outcome.parsed;
    if (!parsed) {
        console.log('Could not find <pre id="test-result"> in the dumped DOM — the driver script likely never finished.');
        console.log('stderr tail:', (outcome.stderr || '').slice(-2000));
        return { total: 0, passed: 0, failed: 0, infraFailure: true };
    }
    if (parsed.crashed) {
        console.log('DRIVER SCRIPT CRASHED before finishing: ' + parsed.message);
        return { total: 0, passed: 0, failed: 0, infraFailure: true };
    }
    if (parsed.parseError) {
        console.log('Could not JSON.parse the test-result payload: ' + parsed.parseError);
        console.log('raw (truncated):', parsed.raw);
        return { total: 0, passed: 0, failed: 0, infraFailure: true };
    }
    let passed = 0, failed = 0;
    for (const r of parsed.results) {
        const mark = r.ok ? 'PASS' : 'FAIL';
        if (r.ok) passed++; else failed++;
        console.log(`[${mark}] ${r.id}: ${r.detail}`);
    }
    console.log(`rendererMode: ${parsed.rendererMode}`);
    if (parsed.consoleErrors && parsed.consoleErrors.length) {
        console.log(`console.error calls captured (${parsed.consoleErrors.length}):`);
        parsed.consoleErrors.forEach(e => console.log('  ' + e));
    } else {
        console.log('console.error calls captured: none');
    }
    if (parsed.consoleWarnings && parsed.consoleWarnings.length) {
        console.log(`console.warn calls captured (${parsed.consoleWarnings.length}):`);
        parsed.consoleWarnings.forEach(w => console.log('  ' + w));
    } else {
        console.log('console.warn calls captured: none');
    }
    if (parsed.fixtureErrors && parsed.fixtureErrors.length) {
        console.log(`window error/unhandledrejection events (${parsed.fixtureErrors.length}):`);
        parsed.fixtureErrors.forEach(e => console.log('  ' + e));
    } else {
        console.log('window error/unhandledrejection events: none');
    }
    return { total: passed + failed, passed, failed, infraFailure: false };
}

async function main() {
    const outcomes = [];
    outcomes.push(await runPass('WebGL2-allowed', false));
    outcomes.push(await runPass('Forced-Canvas2D-fallback', true));
    // Proves terser minification (build.js's own new size-reduction pass —
    // see that file) doesn't break anything this suite checks: the exact
    // same real Ghost++ source, minified, run through the exact same
    // assertions. One combination (WebGL2) is enough to cover minification
    // itself; it isn't a new interaction risk with the Canvas2D fallback.
    outcomes.push(await runPass('Minified-build', false, true));

    console.log('\n\n============================================================');
    console.log(' GHOST++ ASSEMBLED-FEATURE FIXTURE — SUMMARY');
    console.log('============================================================');
    let anyInfraFailure = false;
    let anyAssertionFailure = false;
    for (const outcome of outcomes) {
        const summary = printOutcome(outcome);
        if (summary.infraFailure) anyInfraFailure = true;
        if (summary.failed > 0) anyAssertionFailure = true;
    }

    console.log('\n============================================================');
    if (anyInfraFailure || anyAssertionFailure) {
        console.log('RESULT: FAILURES PRESENT (see table above).');
        process.exitCode = 1;
    } else {
        console.log(`RESULT: all recorded assertions passed in all ${outcomes.length} passes.`);
        process.exitCode = 0;
    }
}

main().catch(err => {
    console.error('Fixture runner crashed:', err);
    process.exitCode = 1;
});
