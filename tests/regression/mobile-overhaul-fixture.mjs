// tests/mobile-overhaul-fixture.mjs
//
// Real-browser integration fixture for the GeoPixelcons++ Mobile System
// Overhaul. This deliberately exercises the production assembly boundary:
//
//   1. The companion gpp-mobile-ui.js classic script executes first, exactly
//      like a Tampermonkey @require (outside GeoPixelcons++'s private IIFE).
//   2. Every main-script source file then executes in build.js SRC_ORDER,
//      preserving core.js's opening IIFE and footer.js's closing IIFE.
//   3. The page supplies synthetic native GeoPixels DOM and page-realm lexical
//      bindings, while the fixture observes only the public external boundary
//      and real DOM effects.
//
// Two isolated browser profiles cover the enabled bundle and the missing-
// bundle degradation path. Keep later mobile UI assertions in the scenario
// driver below so this remains the single end-to-end fixture for the feature.
//
// Usage: node tests/mobile-overhaul-fixture.mjs

// No browser automation dependency is required. The fixture page reports its
// JSON result to a throwaway same-origin HTTP server, following the existing
// Ghost++ real-browser harness pattern.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = resolve(TEST_DIR, '..', '..');
const BUILD_PATH = join(SCRIPT_DIR, 'build.js');
const CORE_PATH = join(SCRIPT_DIR, 'src', 'legacy', 'core.js');
const MOBILE_UI_VERSION_TOKEN = '__GPP_MOBILE_UI_VERSION__';
const VIEWPORT_TEXT = process.env.GPP_MOBILE_FIXTURE_VIEWPORT || '390x844';
const VIEWPORT_MATCH = /^(\d{3,4})x(\d{3,4})$/u.exec(VIEWPORT_TEXT);
assert(VIEWPORT_MATCH, `Invalid GPP_MOBILE_FIXTURE_VIEWPORT: ${VIEWPORT_TEXT}`);
const FIXTURE_VIEWPORT = Object.freeze({
    width: Number(VIEWPORT_MATCH[1]),
    height: Number(VIEWPORT_MATCH[2]),
});

// Inserted immediately before the real footer.js closes the production IIFE.
// This is fixture-only white-box setup: it creates valid in-memory templates
// without replacing or exposing any bridge implementation function.
// Every assertion still reaches state through the actual production bridge.
const MOBILE_HOST_TEST_HOOK = String.raw`
    window.__mobileHostFixture = Object.freeze({
        installTemplate: function() {
            const core = gppCreateCore();
            const id = 'mobile_fixture_template';
            const existingIndex = gppTemplates.findIndex(template => template.id === id);
            if (existingIndex >= 0) gppTemplates.splice(existingIndex, 1);
            const template = {
                id,
                name: 'Mobile fixture template',
                width: 2,
                height: 1,
                indexType: 'u8',
                indices: new Uint8Array([0, 1]),
                palette: new Uint32Array([
                    core.hexToPacked('#000000'),
                    core.hexToPacked('#FF0000'),
                ]),
                counts: new Uint32Array([1, 1]),
                opaquePixelCount: 2,
                quantized: false,
                poorMatchPixelCount: 0,
                sourceBlob: null,
                mask: core.maskOnly(2, 1),
                position: { gridX: 10, gridY: 20 },
                opacity: 1,
                locked: false,
                groupNoise: false,
                groupNoiseData: null,
                order: gppTemplates.length,
                scanSummary: null,
            };
            gppTemplates.push(template);
            gppFocusedTemplateId = id;
            return template;
        },
        installHistoryFixtures: function() {
            const primary = gppTemplates.find(template => template.id === 'mobile_fixture_template');
            if (!primary) throw new Error('Install the primary mobile fixture template first');

            const historyId = 'mobile_fixture_history';
            const existingHistoryIndex = gppTemplates.findIndex(template => template.id === historyId);
            if (existingHistoryIndex >= 0) gppTemplates.splice(existingHistoryIndex, 1);
            const history = {
                ...primary,
                id: historyId,
                name: 'Mobile fixture history',
                indices: new Uint8Array(primary.indices),
                palette: new Uint32Array(primary.palette),
                counts: new Uint32Array(primary.counts),
                mask: new Uint32Array(primary.mask),
                position: { gridX: 30, gridY: 40 },
                order: gppTemplates.length,
            };
            gppTemplates.push(history);

            const ephemeralId = 'mobile_fixture_ephemeral';
            const existingEphemeralIndex = gppGuildTemplates.findIndex(template => template.id === ephemeralId);
            if (existingEphemeralIndex >= 0) gppGuildTemplates.splice(existingEphemeralIndex, 1);
            const ephemeral = {
                ...primary,
                id: ephemeralId,
                name: 'Mobile fixture guild template',
                indices: new Uint8Array(primary.indices),
                palette: new Uint32Array(primary.palette),
                counts: new Uint32Array(primary.counts),
                mask: new Uint32Array(primary.mask),
                position: { gridX: 50, gridY: 60 },
                opacity: 0,
                locked: false,
                ephemeral: true,
                guildDecoded: true,
                order: 0,
            };
            gppGuildTemplates.push(ephemeral);
            return { history, ephemeral };
        },
        installScanProbe: function() {
            const originalScan = gppScanTemplate;
            const calls = [];
            const observedScan = function(template) {
                calls.push({
                    templateId: template ? template.id : null,
                    time: performance.now(),
                });
                return Promise.resolve({ fixtureProbe: true });
            };
            gppScanTemplate = observedScan;
            return Object.freeze({
                desktopAutoscanEnabled: !!gppSettings.autoscanEnabled,
                get count() { return calls.length; },
                snapshot: function() { return calls.map(call => ({ ...call })); },
                restore: function() {
                    clearTimeout(gppAutoscanDebounceTimer);
                    gppAutoscanDebounceTimer = null;
                    if (gppScanTemplate === observedScan) gppScanTemplate = originalScan;
                },
            });
        },
        snapshot: function(template) {
            return {
                focusedId: gppFocusedTemplateId,
                templateIds: gppTemplates.map(item => item.id),
                mask: template ? Array.from(template.mask) : null,
                position: template && template.position
                    ? { gridX: template.position.gridX, gridY: template.position.gridY }
                    : null,
            };
        },
    });
`;

function readUtf8WithoutBom(path) {
    const bytes = readFileSync(path);
    assert.notDeepEqual(
        [...bytes.subarray(0, 3)],
        [0xef, 0xbb, 0xbf],
        `${path} must be UTF-8 without BOM`,
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function readProductionAssembly() {
    const buildSource = readUtf8WithoutBom(BUILD_PATH);
    const orderMatch = buildSource.match(/const\s+LEGACY_SOURCE_ORDER\s*=\s*(\[[\s\S]*?\]);/);
    assert(orderMatch, 'build.js must expose a literal LEGACY_SOURCE_ORDER array');

    const sourceOrder = [...orderMatch[1].matchAll(/['"]([^'"]+)['"]/g)]
        .map(match => match[1]);
    assert(sourceOrder.length > 3, 'build.js LEGACY_SOURCE_ORDER unexpectedly contained too few files');
    assert.equal(sourceOrder.at(-1), 'src/legacy/footer.js', 'legacy footer must remain last in LEGACY_SOURCE_ORDER');

    // The mobile UI module is modular source (multiple files), not a single
    // pre-flattened bundle, but it must still be an unbroken run of
    // src/mobile/... entries at the very front, before src/legacy/core.js.
    const coreIndex = sourceOrder.indexOf('src/legacy/core.js');
    assert(coreIndex > 0, 'LEGACY_SOURCE_ORDER must list src/legacy/core.js after the mobile module files');
    const mobileOrder = sourceOrder.slice(0, coreIndex);
    assert(
        mobileOrder.length > 0 && mobileOrder.every(entry => entry.startsWith('src/mobile/')),
        'every entry before src/legacy/core.js in LEGACY_SOURCE_ORDER must be a src/mobile/ file',
    );

    const gppInitIndex = sourceOrder.indexOf('src/legacy/features/ghost-plus-plus/gpp-init.js');
    const mobileBootstrapIndex = sourceOrder.indexOf('src/legacy/features/mobile-overhaul-bootstrap.js');
    assert(gppInitIndex >= 0, 'LEGACY_SOURCE_ORDER is missing Ghost++ initialization');
    assert(mobileBootstrapIndex > gppInitIndex, 'mobile bootstrap must run after Ghost++ declarations');

    const bodyOrder = sourceOrder.slice(coreIndex);
    const sourceByPath = new Map();
    const bodySource = bodyOrder.map(relativePath => {
        const source = readUtf8WithoutBom(join(SCRIPT_DIR, relativePath));
        sourceByPath.set(relativePath, source);
        return relativePath === 'src/legacy/footer.js'
            ? MOBILE_HOST_TEST_HOOK + '\n' + source
            : source;
    }).join('\n');

    const coreSource = sourceByPath.get('src/legacy/core.js');
    const initSource = sourceByPath.get('src/legacy/features/ghost-plus-plus/gpp-init.js');
    const bootstrapSource = sourceByPath.get('src/legacy/features/mobile-overhaul-bootstrap.js');
    assert.match(
        coreSource,
        /DEFAULT_SETTINGS\s*=\s*\{[^}]*\bmobileOverhaul\s*:\s*false\b/,
        'mobileOverhaul must remain default-off',
    );
    assert.match(
        coreSource,
        /function\s+gpcMobileOverhaulAvailable\s*\(\)[\s\S]*?typeof\s+mobileOverhaulInit\s*===\s*['"]function['"]/,
        'availability must be guarded by the external initializer',
    );
    assert.match(
        initSource,
        /_settings\.ghostPlusPlus\s*\|\|\s*gpcMobileOverhaulAvailable\(\)/,
        'Mobile Overhaul must start the Ghost++ engine independently of the desktop setting',
    );
    assert.match(
        bootstrapSource,
        /typeof\s+mobileOverhaulInit\s*===\s*['"]function['"]/,
        'bootstrap must guard a missing external initializer',
    );

    // Explicitly turn off every listed production feature/extension so the
    // fixture isolates the overhaul while still executing every source file.
    // loadSettings() merges this object with defaults, just as it does on the
    // real page. The two settings under test are intentionally explicit.
    const listedKeys = [...coreSource.matchAll(/\{\s*key:\s*'([^']+)'/g)]
        .map(match => match[1]);
    const settings = Object.fromEntries(listedKeys.map(key => [key, false]));
    Object.assign(settings, {
        useEmojiIcon: false,
        compactPaintOverflow: false,
        disableGroupNoise: false,
        startShiftLock: false,
        startInspectMode: false,
        smoothZoomButtons: false,
        mobileCompatibility: false,
        mobileOverhaul: true,
        enableDebug: false,
        modernizeGhostPaletteBtns: false,
        rememberGhostModalPos: false,
        ghostPlusPlus: false,
        regionScreenshot: false,
        keybinds: {
            openSettings: { key: 'P', ctrl: true, shift: true },
            mapMovementLock: { key: 'L', ctrl: true, shift: true },
        },
    });

    return { sourceOrder, mobileOrder, bodySource, settings };
}

// Assembles the mobile UI module's own multi-file source exactly as build.js
// does (same file order, same version-token substitution), independently of
// the main production body. This mirrors an @require boundary: the mobile
// module is a self-contained classic script that executes before the main
// IIFE, so the fixture keeps it as its own separately-parseable string.
function readExternalBundle(mobileOrder) {
    assert(mobileOrder.length > 0, 'mobile module file list must not be empty');
    for (const relativePath of mobileOrder) {
        assert(
            existsSync(join(SCRIPT_DIR, relativePath)),
            `mobile module source file is missing: ${relativePath}`,
        );
    }
    let source = mobileOrder
        .map(relativePath => readUtf8WithoutBom(join(SCRIPT_DIR, relativePath)))
        .join('\n\n');
    const tokenCount = source.split(MOBILE_UI_VERSION_TOKEN).length - 1;
    assert.equal(tokenCount, 1, `expected exactly one ${MOBILE_UI_VERSION_TOKEN} token, found ${tokenCount}`);
    source = source.replace(MOBILE_UI_VERSION_TOKEN, 'fixture-test-version');
    assert.match(
        source,
        /\bvar\s+mobileOverhaulInit\s*=/,
        'external bundle must publish the classic-script mobileOverhaulInit binding',
    );
    return source;
}

function buildExternalFailureStub(mode) {
    if (mode === 'throw-before-ready') {
        return String.raw`var mobileOverhaulInit = (function() {
    function initMobileOverhaulFailureStub() {
        throw new Error('fixture external failure before bridge.ready');
    }
    Object.defineProperties(initMobileOverhaulFailureStub, {
        apiVersion: { value: 1, enumerable: true },
        moduleVersion: { value: 'fixture-throw-before-ready', enumerable: true },
    });
    return initMobileOverhaulFailureStub;
})();`;
    }

    if (mode === 'invalid-after-ready') {
        return String.raw`var mobileOverhaulInit = (function() {
    async function initMobileOverhaulFailureStub(bridge) {
        await bridge.ready();
        var documentRef = bridge.env.document;
        var bottom = documentRef.getElementById('bottomControls');
        var saved = {
            className: bottom.className,
            style: bottom.getAttribute('style'),
            hidden: bottom.hidden,
            ariaHidden: bottom.getAttribute('aria-hidden'),
        };
        var partial = documentRef.createElement('div');
        partial.id = 'gpc-mobile-invalid-partial';
        documentRef.body.appendChild(partial);
        bottom.hidden = true;
        bottom.classList.add('hidden');
        bottom.style.display = 'none';
        bottom.setAttribute('aria-hidden', 'true');
        return Object.freeze({
            destroy: function() {
                window.__fixtureInvalidControllerDestroyCalls = (window.__fixtureInvalidControllerDestroyCalls || 0) + 1;
                partial.remove();
                bottom.className = saved.className;
                if (saved.style === null) bottom.removeAttribute('style');
                else bottom.setAttribute('style', saved.style);
                bottom.hidden = saved.hidden;
                if (saved.ariaHidden === null) bottom.removeAttribute('aria-hidden');
                else bottom.setAttribute('aria-hidden', saved.ariaHidden);
            },
        });
    }
    Object.defineProperties(initMobileOverhaulFailureStub, {
        apiVersion: { value: 1, enumerable: true },
        moduleVersion: { value: 'fixture-invalid-after-ready', enumerable: true },
    });
    return initMobileOverhaulFailureStub;
})();`;
    }

    throw new Error(`Unknown external failure mode: ${mode}`);
}

function findBrowser() {
    const candidates = [
        process.env.BROWSER_PATH,
        process.env.EDGE_PATH,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].filter(Boolean);
    return candidates.find(candidate => existsSync(candidate)) || null;
}

function buildFixtureHtml(includeExternal) {
    const externalTag = includeExternal ? '<script src="/external.js"></script>' : '';
    return String.raw`<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>GeoPixelcons++ Mobile Overhaul fixture</title>
    <style>
        html, body { margin: 0; width: 100%; height: 100%; }
        #map-shell { position: relative; width: 800px; height: 600px; background: #eee; }
        #pixel-canvas, #ghost-canvas { position: absolute; inset: 0; width: 800px; height: 600px; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div id="map-shell">
        <canvas id="pixel-canvas" width="800" height="600"></canvas>
        <canvas id="ghost-canvas" width="800" height="600"></canvas>
    </div>

    <div id="controls-left">
        <div id="image-tools-group" class="relative">
            <button id="imageGroupBtn" type="button">Image Tools</button>
            <div id="imageGroupDropdown" class="dropdown-menu">
                <button id="loadGhostImageBtn" type="button"><span id="loadGhostImageBtnLabel">Overlay Image</span></button>
            </div>
        </div>
        <div id="fixture-native-group" class="relative">
            <button id="fixtureNativeGroupBtn" type="button" title="Fixture native tools">Fixture native tools</button>
            <div id="fixtureNativeDropdown" class="dropdown-menu">
                <div id="fixture-native-nested-section">
                    <button id="fixtureNativeNestedLeaf" type="button" title="Fixture nested action"><span>Nested action</span></button>
                </div>
            </div>
        </div>
    </div>
    <div id="controls-right"></div>

    <input id="ghostImageInput" type="file" accept="image/*" style="display:none">
    <button id="initiatePlaceGhostBtn" type="button" style="display:none">Native place</button>
    <button id="clearGhostImageBtn" type="button" style="display:none">Native clear</button>

    <div id="native-paint-shell">
        <div id="bottomControls" class="native-bottom baseline" style="display:flex" aria-label="Native paint controls">
            <span id="before-energy">before energy</span>
            <span id="currentEnergyDisplay">123</span>
            <span id="between-energy-brush">between energy and brush</span>
            <button id="toggleBrushModeBtn_Bottom" type="button">Brush</button>
            <div id="brush-swap-wrapper" class="relative inline-block">
                <button id="brush-swap-toggle" type="button">Swap</button>
                <div id="brush-swap-dropdown" style="width:120px;height:80px;position:absolute;bottom:100%;right:0;"></div>
            </div>
            <span id="between-brush-paint">between brush and paint</span>
            <button id="commitBtn" type="button">Paint (0)</button>
            <button id="toggleEyedropper_Bottom" type="button">Eyedropper</button>
            <span id="after-paint">after paint</span>
        </div>
        <button id="resumePaintingControl" type="button">Resume painting</button>
    </div>
    <button id="toggleEyedropper" type="button">Toolbar eyedropper</button>

    <pre id="test-result" data-status="pending">pending</pre>

    ${externalTag}
    <script src="/prelude.js"></script>
    <script src="/main.js"></script>
    <script src="/driver.js"></script>
</body>
</html>`;
}

function buildPreludeSource(settings) {
    return String.raw`'use strict';

window.__fixtureErrors = [];
window.addEventListener('error', function(event) {
    window.__fixtureErrors.push(String((event.error && event.error.stack) || event.message));
});
window.addEventListener('unhandledrejection', function(event) {
    window.__fixtureErrors.push('unhandledrejection: ' + String((event.reason && event.reason.stack) || event.reason));
});

var __consoleErrors = [];
var __consoleWarnings = [];
var __originalConsoleError = console.error.bind(console);
var __originalConsoleWarn = console.warn.bind(console);
console.error = function() {
    __consoleErrors.push(Array.prototype.map.call(arguments, String).join(' '));
    __originalConsoleError.apply(console, arguments);
};
console.warn = function() {
    __consoleWarnings.push(Array.prototype.map.call(arguments, String).join(' '));
    __originalConsoleWarn.apply(console, arguments);
};
window.__fixtureConsole = { errors: __consoleErrors, warnings: __consoleWarnings };

window.requestAnimationFrame = function(callback) {
    return setTimeout(function() { callback(performance.now()); }, 0);
};
window.cancelAnimationFrame = function(id) { clearTimeout(id); };

var __nativeCanvasGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(type, options) {
    if (type === 'webgl2') return null;
    return __nativeCanvasGetContext.call(this, type, options);
};

var unsafeWindow = window;
window.unsafeWindow = window;
window.GM_getValue = function(_key, fallback) { return fallback; };
window.GM_setValue = function() {};
window.GM_deleteValue = function() {};
window.GM_registerMenuCommand = function() {};
window.GM_xmlhttpRequest = function(options) {
    setTimeout(function() {
        if (options && typeof options.onerror === 'function') {
            options.onerror(new Error('Fixture has no GM_xmlhttpRequest response'));
        }
    }, 0);
};
window.alert = function(message) { window.__fixtureAlerts.push(String(message)); };
window.confirm = function() { return true; };
window.prompt = function() { return null; };
window.__fixtureAlerts = [];
window.__fixtureClipboardWrites = [];
try {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: async function(value) {
                window.__fixtureClipboardWrites.push(String(value));
            },
        },
    });
} catch (_) { /* The copy action still has its alert fallback. */ }
window.__fixtureStage = 'prelude-complete';
window.__fixtureReportFetch = window.fetch.bind(window);

setTimeout(function() {
    var resultElement = document.getElementById('test-result');
    if (!resultElement || resultElement.dataset.status !== 'pending') return;
    var payload = {
        scenario: 'watchdog',
        crashed: true,
        message: 'Fixture watchdog fired at stage: ' + String(window.__fixtureStage),
        results: [],
        consoleErrors: window.__fixtureConsole.errors,
        consoleWarnings: window.__fixtureConsole.warnings,
        fixtureErrors: window.__fixtureErrors,
    };
    resultElement.dataset.status = 'crashed';
    resultElement.textContent = JSON.stringify(payload);
    window.__fixtureReportFetch('/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    }).catch(function() {});
}, 20000);

localStorage.clear();
localStorage.setItem('geopixelcons_settings', ${JSON.stringify(JSON.stringify(settings))});

var MAP_ORIGIN_X = 400;
var MAP_ORIGIN_Y = 300;
var MAP_SCALE = 2;
var __mapZoom = 15;
var __mapListeners = Object.create(null);
var __mapShell = document.getElementById('map-shell');
var __pixelCanvas = document.getElementById('pixel-canvas');

let gridSize = 25;
let halfSize = 12.5;
let minZoom = 10.5;
let SYNC_TILE_SIZE = 1000;
let offsetMetersX = 0;
let offsetMetersY = 0;
let Colors = ['#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#000000', '#00000000'];
let activeColors = [0, 1, 2];
let pixelColor = '#FFFFFF';
let queuedPixels = new Map();
let tileImageCache = new Map();

let turf = {
    toWgs84: function(coord) { return [coord[0], coord[1]]; },
    toMercator: function(coord) { return [coord[0], coord[1]]; },
};

let map = {
    getContainer: function() { return __mapShell; },
    getCanvas: function() { return __pixelCanvas; },
    getZoom: function() { return __mapZoom; },
    getCenter: function() { return { lng: 0, lat: 0 }; },
    getBounds: function() {
        return {
            getNorthWest: function() { return { lng: -1000, lat: 1000 }; },
            getSouthEast: function() { return { lng: 1000, lat: -1000 }; },
        };
    },
    project: function(coord) {
        var lng = Array.isArray(coord) ? coord[0] : coord.lng;
        var lat = Array.isArray(coord) ? coord[1] : coord.lat;
        return { x: MAP_ORIGIN_X + lng * MAP_SCALE, y: MAP_ORIGIN_Y - lat * MAP_SCALE };
    },
    unproject: function(point) {
        var x = Array.isArray(point) ? point[0] : point.x;
        var y = Array.isArray(point) ? point[1] : point.y;
        return { lng: (x - MAP_ORIGIN_X) / MAP_SCALE, lat: (MAP_ORIGIN_Y - y) / MAP_SCALE };
    },
    flyTo: function() {},
    jumpTo: function(options) {
        window.__nativeMapJumpCalls += 1;
        window.__lastNativeMapJump = options || null;
        if (options && typeof options.zoom === 'number') __mapZoom = options.zoom;
    },
    on: function(type, callback) {
        (__mapListeners[type] || (__mapListeners[type] = new Set())).add(callback);
    },
    off: function(type, callback) {
        if (__mapListeners[type]) __mapListeners[type].delete(callback);
    },
};

let ghostImage = null;
let ghostImageOriginalData = null;
let ghostImageTopLeft = null;
let ghostImageCanvas = null;
let ghostPaletteColors = [];
let ghostActivePaletteColors = new Set();
let ghostAllImageColors = new Map();
let paletteToImageColorMap = new Map();
let imageColorToDominantColorMap = new Map();
let isColorFilterDisabled = true;
let ghostImageFileObject = null;
let ghostCanvas = document.getElementById('ghost-canvas');
let ghostCanvasCtx = ghostCanvas.getContext('2d');

let userGuildData = null;
let tokenUser = null;
let userData = { id: null };

window.__nativeResumeCalls = 0;
window.__nativeEyedropperCalls = 0;
window.__nativePaintCalls = 0;
window.__nativeGhostControlCalls = 0;
window.__nativeChangeColorCalls = 0;
window.__fixtureNativeNestedLeafCalls = 0;
window.__nativeMapJumpCalls = 0;
window.__nativeBrushSwapToggleCalls = 0;
window.__nativeBrushSwapWheelCalls = 0;
window.__lastNativeMapJump = null;
window.__nativePlacePixelCalls = [];
window.__nativeEyedropperArmed = false;
window.__fixtureOriginalFetch = window.fetch;

function drawGhostImageOnCanvas() {}
function regenerateGhostCanvas() {}
function initializeGhostFromStorage() {}
function setProjectAsGhost() {}
function addGhostAsProject() {}
function updateGuildProject() {}
function populateGuildInfo() {}
function showAlert(title, message) {
    window.__fixtureAlerts.push(String(title) + ': ' + String(message));
}
function SetColors() {}
function changeColor(color) {
    window.__nativeChangeColorCalls += 1;
    pixelColor = String(color).toUpperCase();
    if (window.__nativeEyedropperArmed) window.__nativeEyedropperArmed = false;
}
function placePixelAt() {
    window.__nativePlacePixelCalls.push(Array.prototype.slice.call(arguments));
    return { changed: true, queued: arguments[2] === true };
}
function toggleEyedropperMode() {
    window.__nativeEyedropperCalls += 1;
    window.__nativeEyedropperArmed = !window.__nativeEyedropperArmed;
}

window.__fixtureSetGamePalette = function(colors, active, selected) {
    Colors = colors.slice();
    activeColors = active.slice();
    if (selected !== undefined) pixelColor = selected;
};
window.__fixtureGetSelectedPaintColor = function() { return pixelColor; };
window.__fixturePickNativeColor = function(color) { return window.changeColor(color); };

document.getElementById('commitBtn').addEventListener('click', function() {
    window.__nativePaintCalls += 1;
});
document.getElementById('fixtureNativeNestedLeaf').addEventListener('click', function() {
    window.__fixtureNativeNestedLeafCalls += 1;
});
document.getElementById('toggleEyedropper_Bottom').addEventListener('click', function() {
    toggleEyedropperMode();
});
// Mimics paint-brush-swap.js's own toggleDropdown() just closely enough to
// verify native-controls.js's proxy forwards to the REAL button (this one,
// left in place) instead of moving it -- toggling classList.open here is
// exactly what the real dropdown does when shown/hidden.
document.getElementById('brush-swap-toggle').addEventListener('click', function() {
    window.__nativeBrushSwapToggleCalls += 1;
    document.getElementById('brush-swap-dropdown').classList.toggle('open');
});
document.getElementById('brush-swap-toggle').addEventListener('wheel', function() {
    window.__nativeBrushSwapWheelCalls += 1;
});
document.getElementById('resumePaintingControl').addEventListener('click', function() {
    window.__nativeResumeCalls += 1;
    var bottom = document.getElementById('bottomControls');
    bottom.hidden = false;
    bottom.classList.remove('hidden');
    bottom.style.display = 'flex';
    bottom.removeAttribute('aria-hidden');
});
['loadGhostImageBtn', 'ghostImageInput', 'initiatePlaceGhostBtn', 'clearGhostImageBtn'].forEach(function(id) {
    var element = document.getElementById(id);
    var type = id === 'ghostImageInput' ? 'change' : 'click';
    element.addEventListener(type, function() { window.__nativeGhostControlCalls += 1; });
});

function fixtureElementSnapshot(id) {
    var element = document.getElementById(id);
    return {
        id: id,
        parentId: element && element.parentElement ? element.parentElement.id : null,
        nextId: element && element.nextElementSibling ? element.nextElementSibling.id : null,
        className: element ? element.className : null,
        style: element ? element.getAttribute('style') : null,
        hidden: element ? element.hidden : null,
        ariaHidden: element ? element.getAttribute('aria-hidden') : null,
    };
}

var __nativeSnapshotIds = [
    'bottomControls',
    'currentEnergyDisplay',
    'toggleBrushModeBtn_Bottom',
    'brush-swap-toggle',
    'commitBtn',
    'toggleEyedropper_Bottom',
];
window.__initialNativeSnapshots = Object.fromEntries(
    __nativeSnapshotIds.map(function(id) { return [id, fixtureElementSnapshot(id)]; }),
);
window.__fixtureElementSnapshot = fixtureElementSnapshot;

window.__mobileBoundary = {
    externalAvailableBeforeMain: typeof mobileOverhaulInit === 'function',
    externalApiVersion: typeof mobileOverhaulInit === 'function' ? mobileOverhaulInit.apiVersion : null,
    externalModuleVersion: typeof mobileOverhaulInit === 'function' ? mobileOverhaulInit.moduleVersion : null,
    initCalls: 0,
    readyCalls: 0,
    readyResolved: false,
    fetchWrappedAfterReady: false,
    bridge: null,
    controller: null,
    initError: null,
};

if (typeof mobileOverhaulInit === 'function') {
    var __realMobileOverhaulInit = mobileOverhaulInit;
    var __observedMobileOverhaulInit = function(bridge) {
        window.__mobileBoundary.initCalls += 1;
        window.__mobileBoundary.bridge = bridge;

        var observedBridge = Object.assign({}, bridge, {
            ready: async function() {
                window.__mobileBoundary.readyCalls += 1;
                var state = await bridge.ready.apply(bridge, arguments);
                window.__mobileBoundary.readyResolved = true;
                window.__mobileBoundary.fetchWrappedAfterReady = window.fetch !== window.__fixtureOriginalFetch;
                return state;
            },
        });
        Object.freeze(observedBridge);

        var result;
        try {
            result = __realMobileOverhaulInit(observedBridge);
        } catch (error) {
            window.__mobileBoundary.initError = String((error && error.stack) || error);
            throw error;
        }
        return Promise.resolve(result).then(function(controller) {
            window.__mobileBoundary.controller = controller;
            return controller;
        }, function(error) {
            window.__mobileBoundary.initError = String((error && error.stack) || error);
            throw error;
        });
    };
    Object.defineProperties(__observedMobileOverhaulInit, {
        apiVersion: { value: __realMobileOverhaulInit.apiVersion, enumerable: true },
        moduleVersion: { value: __realMobileOverhaulInit.moduleVersion, enumerable: true },
    });
    mobileOverhaulInit = __observedMobileOverhaulInit;
}
`;
}

function buildDriverSource(mode) {
    return String.raw`'use strict';

(async function runMobileOverhaulFixture() {
    var mode = ${JSON.stringify(mode)};
    var scenario = mode;
    var resultElement = document.getElementById('test-result');
    var results = [];
    var hostTemplate = null;
    var historyFixtures = null;

    function fail(message) { throw new Error(message); }
    function assertBrowser(condition, message) { if (!condition) fail(message); }
    function assertEqual(actual, expected, message) {
        if (!Object.is(actual, expected)) {
            fail(message + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
        }
    }
    function assertDeepEqual(actual, expected, message) {
        var left = JSON.stringify(actual);
        var right = JSON.stringify(expected);
        if (left !== right) fail(message + ' (expected ' + right + ', got ' + left + ')');
    }
    function delay(milliseconds) { return new Promise(function(resolveDelay) { setTimeout(resolveDelay, milliseconds); }); }
    async function waitFor(predicate, label, timeoutMs) {
        var deadline = Date.now() + (timeoutMs || 15000);
        var lastError = null;
        while (Date.now() < deadline) {
            try {
                if (predicate()) return;
            } catch (error) {
                lastError = error;
            }
            await delay(20);
        }
        fail('Timed out waiting for ' + label + (lastError ? ': ' + lastError.message : ''));
    }
    async function check(id, callback) {
        window.__fixtureStage = 'check:' + id;
        try {
            await callback();
            results.push({ id: id, ok: true, detail: 'passed' });
        } catch (error) {
            results.push({ id: id, ok: false, detail: String((error && error.stack) || error) });
        }
    }
    function effectivelyHidden(element) {
        return !!element && (
            element.hidden
            || element.classList.contains('hidden')
            || getComputedStyle(element).display === 'none'
            || element.getAttribute('aria-hidden') === 'true'
        );
    }
    function currentSettings() {
        return JSON.parse(localStorage.getItem('geopixelcons_settings') || '{}');
    }
    function assertNativeSnapshot(id) {
        assertDeepEqual(
            window.__fixtureElementSnapshot(id),
            window.__initialNativeSnapshots[id],
            id + ' must be restored to its exact native DOM position/state',
        );
    }

    try {
        window.__fixtureStage = 'driver-started';
        if (document.readyState === 'loading') {
            await new Promise(function(resolveReady) {
                document.addEventListener('DOMContentLoaded', resolveReady, { once: true });
            });
        }

        await check('saved-setting-contract', async function() {
            var settings = currentSettings();
            assertEqual(settings.ghostPlusPlus, false, 'desktop Ghost++ setting must be off in this fixture');
            assertEqual(settings.mobileOverhaul, true, 'Mobile Overhaul setting must be on in this fixture');
        });

        if (mode === 'real') {
            await waitFor(function() {
                return window.__mobileBoundary.controller || window.__mobileBoundary.initError;
            }, 'the external initializer to settle');

            await check('external-initializer-available', async function() {
                assertEqual(window.__mobileBoundary.externalAvailableBeforeMain, true, 'external @require binding must exist before the main IIFE');
                assertEqual(window.__mobileBoundary.externalApiVersion, 1, 'external API version');
                assertBrowser(!!window.__mobileBoundary.externalModuleVersion, 'external module version must be published');
                assertEqual(window.__mobileBoundary.initCalls, 1, 'main bootstrap must call the external initializer once');
                assertBrowser(!window.__mobileBoundary.initError, 'external initializer failed: ' + window.__mobileBoundary.initError);
            });

            await check('external-bridge-ready', async function() {
                var bridge = window.__mobileBoundary.bridge;
                assertBrowser(bridge && typeof bridge === 'object', 'main script must pass a bridge object');
                assertEqual(bridge.apiVersion, 1, 'bridge API version');
                assertBrowser(typeof bridge.hostVersion === 'string' && bridge.hostVersion.length > 0, 'bridge host version');
                assertBrowser(bridge.env && bridge.env.window === window && bridge.env.document === document, 'bridge must expose the live environment');
                assertEqual(window.__mobileBoundary.readyCalls, 1, 'external initializer must await bridge.ready exactly once');
                assertEqual(window.__mobileBoundary.readyResolved, true, 'bridge.ready must resolve before the controller mounts');
                assertBrowser(Array.isArray(bridge.getTemplates()), 'ready bridge must expose the initialized template list');
            });

            await check('engine-starts-with-desktop-setting-off', async function() {
                var modal = document.getElementById('gpp-modal');
                assertBrowser(modal, 'Mobile Overhaul availability must start and mount the shared Ghost++ engine');
                assertBrowser(document.getElementById('gpp-opener'), 'shared Ghost++ opener must mount for native shortcut compatibility');
                assertBrowser(modal.classList.contains('gpp-hidden'), 'desktop Ghost++ modal must remain hidden');
                assertEqual(modal.getAttribute('aria-hidden'), 'true', 'suppressed desktop modal must be aria-hidden');
                assertEqual(modal.dataset.mobileOverhaulSuppressed, 'true', 'desktop modal must record suppression');
            });

            await waitFor(function() {
                var controller = window.__mobileBoundary.controller;
                return controller && controller.mounted && document.getElementById('gpc-mobile-overhaul-root');
            }, 'the external native-controls shell to mount');

            await check('native-controls-relocated', async function() {
                var controller = window.__mobileBoundary.controller;
                var root = document.getElementById('gpc-mobile-overhaul-root');
                var panel = document.getElementById('gpc-mobile-panel');
                var row = document.getElementById('gpc-mobile-native-controls-row');
                assertBrowser(controller.mounted, 'controller must report mounted');
                assertBrowser(root && panel && row, 'external root, panel, and native row must mount');
                ['currentEnergyDisplay', 'toggleBrushModeBtn_Bottom', 'commitBtn', 'toggleEyedropper_Bottom'].forEach(function(id) {
                    assertEqual(document.getElementById(id).parentElement, row, id + ' must move into the mobile native row');
                });
                // brush-swap-toggle is deliberately NOT moved -- its saved-
                // brush dropdown is a position:absolute sibling anchored to
                // its original wrapper, so relocating the button alone would
                // strand a now-invisible dropdown inside display:none
                // #bottomControls. A proxy button takes its place in the
                // row instead (see the dedicated brush-swap-proxy check).
                assertEqual(
                    document.getElementById('brush-swap-toggle').parentElement,
                    document.getElementById('brush-swap-wrapper'),
                    'the real brush-swap-toggle must stay in its original wrapper, not move into the mobile native row',
                );
                assertDeepEqual(
                    Array.from(row.children).map(function(element) { return element.id; }),
                    [
                        'currentEnergyDisplay', 'toggleBrushModeBtn_Bottom', 'gpc-mobile-brush-swap-proxy', 'commitBtn', 'toggleEyedropper_Bottom',
                        'gpc-mobile-ui-scale-control', 'gpc-mobile-panel-close',
                    ],
                    'native controls must retain the specified mobile row order with the brush-swap proxy after Brush, Eyedropper after Paint, followed by the UI scale control and the close button (no separate header bar)',
                );
                assertBrowser(!document.getElementById('gpc-mobile-panel-header'), 'the old separate title/close header bar must no longer exist');
                assertEqual(
                    document.getElementById('commitBtn').nextElementSibling,
                    document.getElementById('toggleEyedropper_Bottom'),
                    'the real bottom Eyedropper control must immediately follow Paint',
                );
                assertEqual(
                    document.getElementById('toggleEyedropper').parentElement,
                    document.body,
                    'toolbar eyedropper must stay connected in its original location for native setToolMode',
                );
            });

            await check('native-controls-row-order-stable-across-refreshes', async function() {
                // Regression test for a real ordering bug found while
                // building the brush-swap proxy: relocateNativeControls()'s
                // reorder loop anchored its last element to the row's
                // absolute end (null), which is only correct on the very
                // first refresh -- on every later refresh it walked the
                // whole 5-item block one position further past whatever
                // ensureAdditions()/refresh() had already appended after it
                // (the UI scale control, the close button), since "the
                // row's true end" had moved past them. By the 3rd refresh
                // the scale control had walked all the way to the front.
                var controller = window.__mobileBoundary.controller;
                var row = document.getElementById('gpc-mobile-native-controls-row');
                var expectedOrder = [
                    'currentEnergyDisplay', 'toggleBrushModeBtn_Bottom', 'gpc-mobile-brush-swap-proxy', 'commitBtn', 'toggleEyedropper_Bottom',
                    'gpc-mobile-ui-scale-control', 'gpc-mobile-panel-close',
                ];
                for (var refreshCount = 0; refreshCount < 6; refreshCount += 1) {
                    controller.refresh();
                    assertDeepEqual(
                        Array.from(row.children).map(function(element) { return element.id; }),
                        expectedOrder,
                        'row order must stay stable after refresh #' + (refreshCount + 1) + ', not walk the UI scale control/close button out of place',
                    );
                }
            });

            await check('brush-swap-proxy-forwards-clicks-and-repositions-dropdown', async function() {
                var proxy = document.getElementById('gpc-mobile-brush-swap-proxy');
                var realToggle = document.getElementById('brush-swap-toggle');
                var dropdown = document.getElementById('brush-swap-dropdown');
                assertBrowser(proxy, 'a brush-swap proxy button must be mounted in the mobile row');
                assertEqual(proxy.getAttribute('aria-label'), 'Toggle saved brushes', 'the proxy must carry a descriptive label instead of the native "▲ brushes" text');
                assertBrowser(!dropdown.classList.contains('open'), 'dropdown must start closed');

                var callsBefore = window.__nativeBrushSwapToggleCalls;
                proxy.click();
                await waitFor(function() {
                    return window.__nativeBrushSwapToggleCalls === callsBefore + 1
                        && dropdown.classList.contains('open')
                        && dropdown.parentElement === document.body
                        && dropdown.style.position === 'fixed';
                }, 'a proxy click to forward to the real (still in place) brush-swap-toggle, open its dropdown, and move+reposition it onto document.body');

                var proxyRect = proxy.getBoundingClientRect();
                var dropdownRect = dropdown.getBoundingClientRect();
                assertBrowser(
                    Math.abs(dropdownRect.left - proxyRect.left) < 2,
                    'repositioned dropdown must align its left edge with the visible proxy button, not the hidden real button',
                );
                assertBrowser(
                    dropdownRect.bottom <= proxyRect.top + 6,
                    'repositioned dropdown must open upward, sitting just above the proxy button (the panel is permanently bottom-docked)',
                );

                // A second click must forward AND close the dropdown back
                // down -- proving the proxy's own stopPropagation() runs on
                // the ORIGINAL click (not just the synthetic one it
                // forwards), so paint-brush-swap.js's document-level
                // "click outside closes the dropdown" listener never sees
                // this click and races the reopen shut again.
                proxy.click();
                await waitFor(function() {
                    return window.__nativeBrushSwapToggleCalls === callsBefore + 2 && !dropdown.classList.contains('open');
                }, 'a second proxy click to forward to the real toggle and close the dropdown back down');

                var wheelCallsBefore = window.__nativeBrushSwapWheelCalls;
                proxy.dispatchEvent(new WheelEvent('wheel', { deltaY: 12, bubbles: true, cancelable: true }));
                await waitFor(function() {
                    return window.__nativeBrushSwapWheelCalls === wheelCallsBefore + 1;
                }, 'proxy wheel events (scroll-to-swap) to forward to the real brush-swap-toggle');

                assertEqual(realToggle.parentElement, document.getElementById('brush-swap-wrapper'), 'the real brush-swap-toggle must never move, only the proxy does');
            });

            await check('native-bottom-controls-hidden', async function() {
                var bottom = document.getElementById('bottomControls');
                assertBrowser(bottom && bottom.isConnected, 'native bottomControls must stay connected for restoration');
                assertBrowser(effectivelyHidden(bottom), 'native bottomControls must be hidden while the overhaul owns painting UI');
                bottom.hidden = false;
                bottom.setAttribute('aria-hidden', 'false');
                bottom.style.setProperty('display', 'flex');
                await waitFor(function() {
                    return bottom.hidden
                        && bottom.getAttribute('aria-hidden') === 'true'
                        && bottom.style.getPropertyValue('display') === 'none'
                        && bottom.style.getPropertyPriority('display') === 'important';
                }, 'host rewrites of native bottomControls to be re-suppressed');
            });

            await check('resume-opens-mobile-panel', async function() {
                var controller = window.__mobileBoundary.controller;
                assertBrowser(typeof controller.closePanel === 'function' && typeof controller.openPanel === 'function', 'controller must expose panel lifecycle methods');
                controller.closePanel();
                await waitFor(function() { return controller.isOpen === false; }, 'the mobile panel to close');
                var nativeCallsBefore = window.__nativeResumeCalls;
                var resume = document.getElementById('resumePaintingControl');
                resume.click();
                await waitFor(function() { return controller.isOpen === true; }, 'resumePaintingControl to reopen the mobile panel');
                assertEqual(window.__nativeResumeCalls, nativeCallsBefore, 'capture-phase mobile resume handler must block native resume behavior');
                assertBrowser(effectivelyHidden(document.getElementById('bottomControls')), 'native bottomControls must stay hidden after resume');

                var closeButton = document.getElementById('gpc-mobile-panel-close');
                closeButton.focus();
                closeButton.click();
                await waitFor(function() { return controller.isOpen === false; }, 'the panel close button to hide the mobile surface');
                assertEqual(document.activeElement, resume, 'closing the panel from inside it must move focus to Resume painting');
                resume.click();
                await waitFor(function() { return controller.isOpen === true; }, 'Resume painting to reopen after the close-button focus check');
                assertEqual(window.__nativeResumeCalls, nativeCallsBefore, 'reopening after close must still block native resume behavior');
            });

            await check('desktop-modal-remains-hidden', async function() {
                var modal = document.getElementById('gpp-modal');
                assertBrowser(modal && effectivelyHidden(modal), 'resume/open actions must never reveal the desktop Ghost++ modal');
                modal.hidden = false;
                modal.setAttribute('aria-hidden', 'false');
                modal.style.setProperty('display', 'block');
                await waitFor(function() {
                    return modal.hidden
                        && modal.getAttribute('aria-hidden') === 'true'
                        && modal.style.getPropertyValue('display') === 'none'
                        && modal.style.getPropertyPriority('display') === 'important';
                }, 'host rewrites of the desktop Ghost++ modal to be re-suppressed');
            });

            await waitFor(function() {
                var menu = document.getElementById('gpc-mobile-hamburger-menu');
                return menu && Array.from(menu.querySelectorAll('[data-gpc-mobile-action-index]')).some(function(action) {
                    return action.textContent.trim() === 'Fixture nested action';
                });
            }, 'the flattened native fixture action in the mobile hamburger');

            await check('hamburger-preserves-and-flattens-native-tree', async function() {
                var controlsLeft = document.getElementById('controls-left');
                var originalLeaf = document.getElementById('fixtureNativeNestedLeaf');
                var originalOpener = document.getElementById('gpp-opener');
                var mobileRoot = document.getElementById('gpc-mobile-hamburger');
                var menu = document.getElementById('gpc-mobile-hamburger-menu');
                var proxy = Array.from(menu.querySelectorAll('[data-gpc-mobile-action-index]')).find(function(action) {
                    return action.textContent.trim() === 'Fixture nested action';
                });

                assertBrowser(controlsLeft && controlsLeft.isConnected, 'the original controls-left tree must stay connected');
                assertBrowser(effectivelyHidden(controlsLeft), 'the original controls-left tree must be hidden while the flat menu owns navigation');
                assertBrowser(originalLeaf && controlsLeft.contains(originalLeaf), 'the nested native leaf must remain in its original tree');
                assertBrowser(originalOpener && controlsLeft.contains(originalOpener), 'the real gpp-opener must remain in the original tree');
                assertBrowser(mobileRoot && menu && proxy, 'the mobile hamburger must render a labeled flat proxy');
                assertEqual(proxy.textContent.trim(), 'Fixture nested action', 'the flat proxy must use the native action label');
                assertBrowser(!mobileRoot.querySelector('.dropdown-menu'), 'the mobile hamburger must not reproduce desktop dropdown-menu nesting');
            });

            await check('hamburger-opens-downward-and-proxies-clicks', async function() {
                var button = document.getElementById('gpc-mobile-hamburger-button');
                var menu = document.getElementById('gpc-mobile-hamburger-menu');
                var proxy = Array.from(menu.querySelectorAll('[data-gpc-mobile-action-index]')).find(function(action) {
                    return action.textContent.trim() === 'Fixture nested action';
                });
                button.click();
                await waitFor(function() { return button.getAttribute('aria-expanded') === 'true' && !menu.hidden; }, 'the hamburger to open');
                var buttonRect = button.getBoundingClientRect();
                var menuRect = menu.getBoundingClientRect();
                assertBrowser(menuRect.top >= buttonRect.bottom, 'the hamburger menu must expand downward below its button');

                proxy = Array.from(menu.querySelectorAll('[data-gpc-mobile-action-index]')).find(function(action) {
                    return action.textContent.trim() === 'Fixture nested action';
                });
                var callsBefore = window.__fixtureNativeNestedLeafCalls;
                proxy.click();
                assertEqual(window.__fixtureNativeNestedLeafCalls, callsBefore + 1, 'the flat proxy must invoke the original nested native click handler');
                assertEqual(button.getAttribute('aria-expanded'), 'false', 'invoking a flat action must close the hamburger');

                button.click();
                await waitFor(function() { return button.getAttribute('aria-expanded') === 'true'; }, 'the hamburger to reopen');
                document.getElementById('map-shell').dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true,
                    pointerId: 31,
                    pointerType: 'touch',
                    isPrimary: true,
                }));
                assertEqual(button.getAttribute('aria-expanded'), 'false', 'an outside pointer must close the hamburger');
                assertBrowser(menu.hidden, 'the closed hamburger menu must be hidden');
            });

            await check('view-a-mounts-with-always-live-controls', async function() {
                var viewA = document.getElementById('gpc-mobile-view-a');
                var panel = document.getElementById('gpc-mobile-panel');
                assertBrowser(viewA && viewA.parentElement === panel, 'View A must mount inside the real mobile panel');
                assertBrowser(!effectivelyHidden(viewA), 'View A must begin visible');
                assertEqual(viewA.getAttribute('aria-hidden'), 'false', 'visible View A must be exposed to assistive technology');
                var scanActions = Array.from(viewA.querySelectorAll('button')).filter(function(action) {
                    var label = [action.textContent, action.title, action.getAttribute('aria-label')].join(' ');
                    return /\bscan\b/i.test(label);
                });
                assertDeepEqual(scanActions.map(function(action) { return action.id || action.className; }), [], 'View A must not expose a manual Scan action');
            });

            await check('palette-grid-always-shows-every-color-show-all-only-affects-the-map', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var viewA = document.getElementById('gpc-mobile-view-a');
                window.__fixtureSetGamePalette(['#000000', '#FF0000', '#00000000'], [0, 1, 2], '#FF0000');
                hostTemplate = window.__mobileHostFixture.installTemplate();
                bridge.requestRefresh();
                await waitFor(function() {
                    return viewA.querySelectorAll('.gpc-mva-swatch').length === 2;
                }, 'the palette grid to show every template color from the start, regardless of Show All');

                var showAll = viewA.querySelector('button[aria-label="Show all template colors"]');
                assertBrowser(showAll, 'View A must expose the Show All control');
                assertEqual(showAll.getAttribute('aria-pressed'), 'false', 'Show All must default off');
                assertEqual(hostTemplate.mask[0], 2, 'template.mask must start narrowed to the one selected color (red, index 1)');
                var colorBefore = window.__fixtureGetSelectedPaintColor();
                var changesBefore = window.__nativeChangeColorCalls;

                showAll.click();
                await waitFor(function() {
                    return showAll.getAttribute('aria-pressed') === 'true' && hostTemplate.mask[0] === 3;
                }, 'Show All must widen template.mask to every color -- the renderer only ever draws mask-selected colors, so a display-only toggle would never change what the map shows');
                assertEqual(window.__fixtureGetSelectedPaintColor(), colorBefore, 'Show All must not change the native paint color by itself');
                assertEqual(window.__nativeChangeColorCalls, changesBefore, 'Show All must not invoke native changeColor by itself');
                assertDeepEqual(
                    Array.from(viewA.querySelectorAll('.gpc-mva-swatch')).map(function(swatch) {
                        return swatch.getAttribute('data-mobile-color-index');
                    }).sort(),
                    ['0', '1'],
                    'the palette grid must still show every color while Show All is on -- it never hid anything to begin with',
                );

                var black = viewA.querySelector('.gpc-mva-swatch[data-mobile-color-index="0"]');
                black.click();
                await waitFor(function() {
                    return window.__fixtureGetSelectedPaintColor() === '#000000';
                }, 'selecting a swatch while Show All is on to change the active paint color');
                await waitFor(function() {
                    return hostTemplate.mask[0] === 3;
                }, 'selecting a swatch while Show All is on to keep the mask wide, not narrow it back to one color -- even through the changeColor()-triggered gpc:pixelColorChanged re-entrancy');

                showAll.click();
                await waitFor(function() {
                    return showAll.getAttribute('aria-pressed') === 'false' && hostTemplate.mask[0] === 1;
                }, 'turning Show All back off must narrow the mask back to exactly the active color (black, index 0)');
                assertEqual(viewA.querySelectorAll('.gpc-mva-swatch').length, 2, 'the palette grid must still show every color after Show All turns back off');
            });

            await check('palette-swatch-selects-one-mask-bit-and-native-color', async function() {
                // The previous check ends with black (index 0) already the
                // active mask-selected color -- select red (index 1) here so
                // this genuinely exercises a color change, not a no-op
                // reselect of whatever's already active.
                var viewA = document.getElementById('gpc-mobile-view-a');
                var red = viewA.querySelector('.gpc-mva-swatch[data-mobile-color-index="1"]');
                assertBrowser(red, 'the red swatch must remain clickable in the grid even while it is not the mask-selected color');
                var changesBefore = window.__nativeChangeColorCalls;
                red.click();
                await waitFor(function() {
                    return hostTemplate.mask[0] === 2
                        && window.__fixtureGetSelectedPaintColor() === '#FF0000';
                }, 'the red swatch to synchronize the template mask and native color');
                assertDeepEqual(Array.from(hostTemplate.mask), [2], 'selecting red must leave exactly its one mask bit set');
                assertBrowser(window.__nativeChangeColorCalls > changesBefore, 'red selection must invoke native changeColor');
                assertEqual(window.__fixtureGetSelectedPaintColor(), '#FF0000', 'red selection must change the native paint color');
            });

            await check('thumbnail-toggle-expands-palette-grid', async function() {
                var viewA = document.getElementById('gpc-mobile-view-a');
                var workspace = viewA.querySelector('.gpc-mva-workspace');
                var paletteColumn = viewA.querySelector('.gpc-mva-palette-column');
                var thumbnailColumn = viewA.querySelector('.gpc-mva-thumbnail-column');
                var toggle = viewA.querySelector('button[aria-label="Hide template thumbnail"]');
                var widthBefore = paletteColumn.getBoundingClientRect().width;
                var columnsBefore = getComputedStyle(workspace).gridTemplateColumns;
                assertBrowser(toggle && widthBefore > 0, 'the visible thumbnail layout must have a measurable palette column');

                toggle.click();
                await waitFor(function() { return viewA.classList.contains('is-thumbnail-hidden'); }, 'the template thumbnail to hide');
                await delay(20);
                var widthAfter = paletteColumn.getBoundingClientRect().width;
                assertEqual(getComputedStyle(thumbnailColumn).display, 'none', 'thumbnail hide must remove the thumbnail column from layout');
                assertBrowser(widthAfter > widthBefore, 'hiding the thumbnail must expand the palette grid');
                assertBrowser(getComputedStyle(workspace).gridTemplateColumns !== columnsBefore, 'thumbnail hide must switch the workspace to its one-column grid');
            });

            await check('palette-navigation-controls-use-native-inputs', async function() {
                var viewA = document.getElementById('gpc-mobile-view-a');
                var scrub = viewA.querySelector('input[aria-label="Scroll through template colors"]');
                var sort = viewA.querySelector('select[aria-label="Sort palette colors"]');
                var filter = viewA.querySelector('select[aria-label="Filter palette colors"]');
                assertBrowser(scrub instanceof HTMLInputElement && scrub.type === 'range', 'palette scrub must be a real range input');
                assertBrowser(sort instanceof HTMLSelectElement && !sort.multiple, 'palette sort must be a real single select');
                assertBrowser(filter instanceof HTMLSelectElement && filter.multiple, 'palette filter must be a real multiple select');
                assertBrowser(sort.options.length > 1 && filter.options.length > 1, 'sort and filter selects must expose real option sets');
            });

            await check('panel-resize-clamps-and-persists-on-pointerup', async function() {
                var panel = document.getElementById('gpc-mobile-panel');
                var handle = document.querySelector('[aria-label="Resize mobile painting panel"]');
                var closeButton = document.getElementById('gpc-mobile-panel-close');
                var storageKey = 'gpc-mobile-overhaul-panel-height';
                var capturedPointerId = null;
                var handleRect = handle.getBoundingClientRect();
                var closeRect = closeButton.getBoundingClientRect();
                assertBrowser(
                    handleRect.top >= closeRect.bottom || handleRect.right <= closeRect.left,
                    'the resize touch target must not overlap the panel close button',
                );
                var closeHit = document.elementFromPoint(
                    closeRect.left + closeRect.width / 2,
                    closeRect.top + closeRect.height / 2,
                );
                assertBrowser(closeHit === closeButton || closeButton.contains(closeHit), 'the close button must remain the top hit target at its center');
                handle.setPointerCapture = function(pointerId) { capturedPointerId = pointerId; };
                handle.hasPointerCapture = function(pointerId) { return capturedPointerId === pointerId; };
                handle.releasePointerCapture = function(pointerId) {
                    if (capturedPointerId === pointerId) capturedPointerId = null;
                };
                localStorage.removeItem(storageKey);

                handle.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    pointerId: 73,
                    pointerType: 'touch',
                    isPrimary: true,
                    button: 0,
                    buttons: 1,
                    clientY: 500,
                }));
                assertEqual(capturedPointerId, 73, 'resize pointerdown must capture its pointer');
                handle.dispatchEvent(new PointerEvent('pointermove', {
                    bubbles: true,
                    cancelable: true,
                    pointerId: 73,
                    pointerType: 'touch',
                    isPrimary: true,
                    buttons: 1,
                    clientY: -1000,
                }));
                var movedHeight = Number(handle.getAttribute('aria-valuenow'));
                assertBrowser(movedHeight <= Math.floor(window.innerHeight * 0.5), 'pointer resize must clamp the panel to at most 50vh');
                assertBrowser(parseFloat(getComputedStyle(panel).height) <= window.innerHeight * 0.5 + 1, 'rendered panel height must honor the 50vh clamp');
                assertEqual(localStorage.getItem(storageKey), null, 'pointermove must not persist an in-progress resize');

                handle.dispatchEvent(new PointerEvent('pointerup', {
                    bubbles: true,
                    cancelable: true,
                    pointerId: 73,
                    pointerType: 'touch',
                    isPrimary: true,
                    button: 0,
                    buttons: 0,
                    clientY: -1000,
                }));
                assertEqual(capturedPointerId, null, 'pointerup must release the captured resize pointer');
                assertEqual(Number(localStorage.getItem(storageKey)), movedHeight, 'pointerup must persist the final clamped panel height');
            });

            await check('view-a-wrench-opens-view-b', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var viewA = document.getElementById('gpc-mobile-view-a');
                var viewB = document.getElementById('gpc-mobile-view-b');
                var wrench = viewA.querySelector('button[aria-label="Open template settings"]');
                historyFixtures = window.__mobileHostFixture.installHistoryFixtures();
                bridge.requestRefresh();
                assertBrowser(wrench && !wrench.disabled, 'the focused template must enable the View A wrench');

                wrench.focus();
                wrench.click();
                await waitFor(function() {
                    return effectivelyHidden(viewA) && viewB && !effectivelyHidden(viewB);
                }, 'View B to open');
                assertEqual(viewA.getAttribute('aria-hidden'), 'true', 'opening template settings must hide View A accessibly');
                assertEqual(viewB.getAttribute('aria-hidden'), 'false', 'View B must become the visible mobile view');
                assertBrowser(!document.getElementById('gpc-mobile-template-reticle'), 'the old fixed-reticle system must no longer exist');
                assertEqual(document.activeElement.getAttribute('aria-label'), 'Return to mobile painting', 'View A to View B must move focus into the visible settings view');
            });

            await check('tap-to-place-arms-capture-and-commits-on-map-tap', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var viewB = document.getElementById('gpc-mobile-view-b');
                var placeButton = document.getElementById('gpc-mobile-template-place');
                var xInput = viewB.querySelector('#gpc-mobile-template-x');
                var yInput = viewB.querySelector('#gpc-mobile-template-y');
                var mapShell = document.getElementById('map-shell');
                assertBrowser(placeButton && !placeButton.disabled, 'the focused, unlocked template must enable Tap map to place');
                assertEqual(placeButton.getAttribute('aria-pressed'), 'false', 'placement must start idle');
                assertEqual(bridge.isPlacementActive(), false, 'placement must start inactive');

                placeButton.click();
                await waitFor(function() {
                    return placeButton.getAttribute('aria-pressed') === 'true' && bridge.isPlacementActive() === true;
                }, 'tapping Tap map to place to arm gppBeginPlacementCapture on the real map container');
                assertEqual(placeButton.textContent, 'Tap the map…', 'the armed button must say so');

                var localX = 250, localY = 180;
                var rect = mapShell.getBoundingClientRect();
                var expectedLng = (localX - 400) / 2;
                var expectedLat = (300 - localY) / 2;
                var expectedGridX = Math.round(expectedLng / gridSize);
                var expectedGridY = Math.round(expectedLat / gridSize);
                mapShell.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true, clientX: rect.left + localX, clientY: rect.top + localY,
                }));

                await waitFor(function() {
                    var position = window.__mobileHostFixture.snapshot(hostTemplate).position;
                    return position && position.gridX === expectedGridX && position.gridY === expectedGridY;
                }, 'the map tap to commit the tapped grid cell directly -- no separate Set Location step, matching desktop\'s own Place button');
                // template.position becoming visible (polled above) and the
                // panel's own presentation catching up to it are two
                // separate steps -- give the UI's refresh cycle a moment
                // rather than asserting DOM state in the same tick.
                await waitFor(function() {
                    return placeButton.getAttribute('aria-pressed') === 'false' && bridge.isPlacementActive() === false;
                }, 'a successful tap to disarm placement mode and clean up the capture');
                await waitFor(function() {
                    return Number(xInput.value) === expectedGridX && Number(yInput.value) === expectedGridY;
                }, 'the committed position to also update the X/Y display fields');
            });

            await check('tap-to-place-toggle-cancels-armed-capture', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var placeButton = document.getElementById('gpc-mobile-template-place');
                placeButton.click();
                await waitFor(function() { return bridge.isPlacementActive() === true; }, 'placement to arm');
                placeButton.click();
                await waitFor(function() {
                    return bridge.isPlacementActive() === false && placeButton.getAttribute('aria-pressed') === 'false';
                }, 'tapping the armed button again to cancel the capture instead of committing');
            });

            await check('view-b-dpad-up-and-down-use-grid-y-semantics', async function() {
                var viewB = document.getElementById('gpc-mobile-view-b');
                var beforeUp = window.__mobileHostFixture.snapshot(hostTemplate).position;
                viewB.querySelector('[data-mobile-nudge="up"]').click();
                await waitFor(function() {
                    var position = window.__mobileHostFixture.snapshot(hostTemplate).position;
                    return position.gridY === beforeUp.gridY + 1 && viewB.getAttribute('aria-busy') === 'false';
                }, 'D-pad Up to add one grid Y cell');
                var afterUp = window.__mobileHostFixture.snapshot(hostTemplate).position;
                assertEqual(afterUp.gridX, beforeUp.gridX, 'D-pad Up must not change X');
                assertEqual(afterUp.gridY, beforeUp.gridY + 1, 'D-pad Up must change Y by exactly +1');

                viewB.querySelector('[data-mobile-nudge="down"]').click();
                await waitFor(function() {
                    var position = window.__mobileHostFixture.snapshot(hostTemplate).position;
                    return position.gridY === afterUp.gridY - 1 && viewB.getAttribute('aria-busy') === 'false';
                }, 'D-pad Down to subtract one grid Y cell');
                var afterDown = window.__mobileHostFixture.snapshot(hostTemplate).position;
                assertEqual(afterDown.gridX, afterUp.gridX, 'D-pad Down must not change X');
                assertEqual(afterDown.gridY, afterUp.gridY - 1, 'D-pad Down must change Y by exactly -1');
            });

            await check('fractional-view-b-coordinate-disables-commit', async function() {
                var viewB = document.getElementById('gpc-mobile-view-b');
                var xInput = viewB.querySelector('#gpc-mobile-template-x');
                var yInput = viewB.querySelector('#gpc-mobile-template-y');
                var setLocation = viewB.querySelector('.gpc-mvb-set-location');
                var before = window.__mobileHostFixture.snapshot(hostTemplate).position;
                xInput.value = String(before.gridX + 0.5);
                xInput.dispatchEvent(new Event('input', { bubbles: true }));
                assertBrowser(xInput.validity.stepMismatch, 'fractional X must violate the integer input step');
                assertBrowser(setLocation.disabled, 'fractional X/Y input must disable Set Location');
                setLocation.click();
                await delay(50);
                assertDeepEqual(window.__mobileHostFixture.snapshot(hostTemplate).position, before, 'disabled fractional commit must not mutate template.position');

                xInput.value = String(before.gridX);
                yInput.value = String(before.gridY);
                xInput.dispatchEvent(new Event('input', { bubbles: true }));
                yInput.dispatchEvent(new Event('input', { bubbles: true }));
                assertBrowser(!setLocation.disabled, 'restoring integer X/Y must re-enable Set Location');
            });

            await check('preview-button-toggles-forced-preview-state', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var viewB = document.getElementById('gpc-mobile-view-b');
                var preview = viewB.querySelector('.gpc-mvb-preview');
                assertEqual(bridge.isPreviewForced(hostTemplate.id), false, 'forced preview must begin off for the fixture template');
                assertEqual(preview.getAttribute('aria-pressed'), 'false', 'Preview button must expose the initial off state');

                preview.click();
                await waitFor(function() {
                    return bridge.isPreviewForced(hostTemplate.id)
                        && preview.getAttribute('aria-pressed') === 'true'
                        && !preview.disabled;
                }, 'Preview to turn forced visibility on');
                assertEqual(preview.textContent.trim(), 'Preview On', 'forced preview on-state must be visibly labeled');

                preview.click();
                await waitFor(function() {
                    return !bridge.isPreviewForced(hostTemplate.id)
                        && preview.getAttribute('aria-pressed') === 'false'
                        && !preview.disabled;
                }, 'Preview to turn forced visibility back off');
            });

            await check('template-history-uses-bounded-canvases-and-actions', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var viewB = document.getElementById('gpc-mobile-view-b');
                var list = viewB.querySelector('#gpc-mobile-template-history-list');
                await waitFor(function() {
                    var cards = Array.from(list.children).filter(function(child) { return child.classList.contains('gpc-mvb-card'); });
                    return cards.length === 2 && cards.every(function(card) { return card.querySelector('.gpc-mvb-thumb canvas'); });
                }, 'personal template history thumbnails');
                var cards = Array.from(list.children).filter(function(child) { return child.classList.contains('gpc-mvb-card'); });
                var canvases = cards.map(function(card) { return card.querySelector('.gpc-mvb-thumb canvas'); });
                assertDeepEqual(
                    cards.map(function(card) { return card.getAttribute('data-mobile-template-id'); }),
                    [hostTemplate.id, historyFixtures.history.id],
                    'history list must include the focused and prior personal templates',
                );
                assertEqual(new Set(canvases).size, canvases.length, 'each template card must own a distinct thumbnail canvas');
                canvases.forEach(function(canvas) {
                    assertBrowser(canvas.width > 0 && canvas.height > 0 && canvas.width <= 72 && canvas.height <= 72, 'history thumbnails must remain bounded at 72px');
                });
                cards.forEach(function(card) {
                    assertBrowser(card.querySelector('[data-mvb-action="focus"]'), 'each personal history card must expose a focus control');
                    assertBrowser(card.querySelector('[data-mvb-action="delete"]'), 'each personal history card must expose a delete control');
                });

                var historyFocus = list.querySelector('[data-mvb-action="focus"][data-mobile-template-id="' + historyFixtures.history.id + '"]');
                var historyDelete = list.querySelector('[data-mvb-action="delete"][data-mobile-template-id="' + historyFixtures.history.id + '"]');
                assertBrowser(!historyFocus.disabled && !historyDelete.disabled, 'non-focused personal history must enable focus and delete controls');
                historyFixtures.history.mask[0] = 3;
                historyFocus.click();
                await waitFor(function() {
                    var focused = bridge.getFocusedTemplate();
                    return focused && focused.id === historyFixtures.history.id && viewB.getAttribute('aria-busy') === 'false';
                }, 'the history focus control to focus its template');
                assertBrowser([1, 2].includes(historyFixtures.history.mask[0]), 'focusing a saved multi-color mask must normalize it to exactly one paint color');

                var primaryFocus = list.querySelector('[data-mvb-action="focus"][data-mobile-template-id="' + hostTemplate.id + '"]');
                assertBrowser(primaryFocus && !primaryFocus.disabled, 'focus control must update after history focus changes');
                hostTemplate.mask[0] = 3;
                primaryFocus.click();
                await waitFor(function() {
                    var focused = bridge.getFocusedTemplate();
                    return focused && focused.id === hostTemplate.id && viewB.getAttribute('aria-busy') === 'false';
                }, 'the primary focus control to restore the fixture template');
                assertBrowser([1, 2].includes(hostTemplate.mask[0]), 'returning to a saved multi-color mask must preserve the mobile single-color invariant');

                historyFixtures.history.mask[0] = 3;
                await bridge.focusTemplate(historyFixtures.history.id);
                hostTemplate.mask[0] = 3;
                assertEqual(await bridge.deleteTemplate(historyFixtures.history.id), true, 'deleting the focused personal history template must succeed');
                assertEqual(bridge.getFocusedTemplate().id, hostTemplate.id, 'deleting the focused history template must promote the remaining personal template');
                assertBrowser([1, 2].includes(hostTemplate.mask[0]), 'delete fallback focus must normalize a persisted multi-color mask');
            });

            await check('ephemeral-focused-template-disables-move-and-delete', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var viewB = document.getElementById('gpc-mobile-view-b');
                var ephemeral = historyFixtures.ephemeral;
                var focused = await bridge.focusTemplate(ephemeral.id);
                assertBrowser(focused && focused.id === ephemeral.id, 'fixture ephemeral template must be focusable through the real bridge');
                await waitFor(function() {
                    return viewB.querySelector('.gpc-mvb-card.is-focused.is-ephemeral[data-mobile-template-id="' + ephemeral.id + '"]');
                }, 'the focused ephemeral history card');

                var card = viewB.querySelector('.gpc-mvb-card.is-focused.is-ephemeral[data-mobile-template-id="' + ephemeral.id + '"]');
                var positionBefore = { gridX: ephemeral.position.gridX, gridY: ephemeral.position.gridY };
                assertBrowser(card.querySelector('[data-mvb-action="focus"]').disabled, 'focused ephemeral card must disable focus');
                assertBrowser(card.querySelector('[data-mvb-action="delete"]').disabled, 'ephemeral card must disable delete');
                assertBrowser(viewB.querySelector('.gpc-mvb-set-location').disabled, 'ephemeral template must disable Set Location');
                assertBrowser(viewB.querySelector('#gpc-mobile-template-x').disabled && viewB.querySelector('#gpc-mobile-template-y').disabled, 'ephemeral template must disable coordinate editing');
                assertBrowser(Array.from(viewB.querySelectorAll('[data-mobile-nudge]')).every(function(button) { return button.disabled; }), 'ephemeral template must disable every D-pad move');
                assertBrowser(document.getElementById('gpc-mobile-template-place').disabled, 'ephemeral template must disable tap-to-place');
                assertEqual(bridge.canEditPosition(ephemeral), false, 'bridge must classify ephemeral position as locked');
                assertEqual(await bridge.nudge(ephemeral, 0, 1), false, 'bridge must reject an ephemeral nudge');
                assertEqual(await bridge.deleteTemplate(ephemeral.id), false, 'bridge must reject deleting an ephemeral history item');
                assertDeepEqual(ephemeral.position, positionBefore, 'rejected ephemeral actions must preserve position');
            });

            await check('view-b-return-restores-view-a', async function() {
                var viewA = document.getElementById('gpc-mobile-view-a');
                var viewB = document.getElementById('gpc-mobile-view-b');
                var returnButton = viewB.querySelector('button[aria-label="Return to mobile painting"]');
                assertBrowser(returnButton, 'View B must expose Return to mobile painting');
                returnButton.focus();
                returnButton.click();
                await waitFor(function() {
                    return !effectivelyHidden(viewA) && effectivelyHidden(viewB);
                }, 'Return to restore View A');
                assertEqual(viewA.getAttribute('aria-hidden'), 'false', 'Return must restore View A accessibly');
                assertEqual(viewB.getAttribute('aria-hidden'), 'true', 'Return must hide View B accessibly');
                assertBrowser(viewB.isConnected, 'hidden View B may remain mounted for later reuse');
                assertEqual(document.activeElement.getAttribute('aria-label'), 'Open template settings', 'Return must move focus back into the visible painting view');
            });

            await check('template-thumbnail-opens-full-preview-actions', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var viewA = document.getElementById('gpc-mobile-view-a');
                window.__fixtureSetGamePalette(['#FF0000', '#00000000'], [0, 1], '#FF0000');
                hostTemplate = window.__mobileHostFixture.installTemplate();
                bridge.requestRefresh();
                var showThumbnail = viewA.querySelector('button[aria-label="Show template thumbnail"]');
                if (showThumbnail) showThumbnail.click();
                var thumbnail = viewA.querySelector('button[aria-label="Open focused template preview"]');
                await waitFor(function() {
                    return thumbnail && !thumbnail.disabled
                        && getComputedStyle(thumbnail.parentElement).display !== 'none';
                }, 'the focused View A thumbnail to become available');

                thumbnail.click();
                await waitFor(function() {
                    var overlay = document.getElementById('gpc-mobile-preview-dialog');
                    return overlay && !effectivelyHidden(overlay)
                        && overlay.querySelector('.gpc-mobile-preview-frame canvas');
                }, 'the full template preview modal');
                var overlay = document.getElementById('gpc-mobile-preview-dialog');
                var dialog = overlay.querySelector('[role="dialog"]');
                var canvas = overlay.querySelector('.gpc-mobile-preview-frame canvas');
                var actionLabels = Array.from(overlay.querySelectorAll('.gpc-mobile-preview-actions button'))
                    .map(function(button) { return button.textContent.trim(); });
                assertEqual(overlay.getAttribute('aria-hidden'), 'false', 'open preview overlay must be exposed accessibly');
                assertBrowser(dialog && dialog.getAttribute('aria-modal') === 'true', 'preview content must be a modal dialog');
                assertEqual(canvas.width, hostTemplate.width, 'full preview canvas must retain template width');
                assertEqual(canvas.height, hostTemplate.height, 'full preview canvas must retain template height');
                assertDeepEqual(
                    actionLabels,
                    ['Buy all colors', 'Group noise', 'Go to', 'Toggle preview'],
                    'preview modal must expose the complete action set',
                );
                assertBrowser(overlay.querySelector('button.gpc-mobile-preview-action:not(.gpc-mobile-preview-close)'), 'preview actions must use real buttons');
            });

            await check('preview-hex-scope-copies-exact-color-sets', async function() {
                var overlay = document.getElementById('gpc-mobile-preview-dialog');
                var scope = overlay.querySelector('select[aria-label="Hex value scope"]');
                var copy = Array.from(overlay.querySelectorAll('button')).find(function(button) {
                    return button.textContent.trim() === 'Get hex values';
                });
                assertBrowser(scope instanceof HTMLSelectElement && copy, 'hex scope and copy action must be native controls');
                assertDeepEqual(
                    Array.from(scope.options).map(function(option) { return [option.value, option.textContent.trim()]; }),
                    [['all', 'All'], ['owned', 'Owned'], ['notOwned', 'Not owned'], ['selected', 'Currently selected']],
                    'hex scope must expose all four product-defined choices',
                );
                assertBrowser(navigator.clipboard && typeof navigator.clipboard.writeText === 'function', 'fixture clipboard seam must be available');
                var expectedByScope = {
                    all: '#000000, #FF0000',
                    owned: '#FF0000',
                    notOwned: '#000000',
                    selected: '#FF0000',
                };
                window.__fixtureClipboardWrites.length = 0;
                for (var scopeName of ['all', 'owned', 'notOwned', 'selected']) {
                    scope.value = scopeName;
                    var expectedWriteCount = window.__fixtureClipboardWrites.length + 1;
                    copy.click();
                    await waitFor(function() {
                        return window.__fixtureClipboardWrites.length === expectedWriteCount && !copy.disabled;
                    }, 'hex copy for scope ' + scopeName);
                    assertEqual(
                        window.__fixtureClipboardWrites.at(-1),
                        expectedByScope[scopeName],
                        scopeName + ' hex scope must copy exactly its matching colors',
                    );
                }
            });

            await check('preview-actions-drive-group-goto-and-visibility', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var overlay = document.getElementById('gpc-mobile-preview-dialog');
                var action = function(label) {
                    return Array.from(overlay.querySelectorAll('.gpc-mobile-preview-actions button')).find(function(button) {
                        return button.textContent.trim() === label;
                    });
                };
                var buy = action('Buy all colors');
                var group = action('Group noise');
                var goTo = action('Go to');
                var togglePreview = action('Toggle preview');
                assertBrowser(buy && group && goTo && togglePreview, 'every preview action must remain available after hex operations');
                assertBrowser(!buy.disabled, 'Buy all colors action must be usable when a template is open');

                group.click();
                await waitFor(function() { return hostTemplate.groupNoise && group.getAttribute('aria-pressed') === 'true' && !group.disabled; }, 'Group noise to turn on');
                group.click();
                await waitFor(function() { return !hostTemplate.groupNoise && group.getAttribute('aria-pressed') === 'false' && !group.disabled; }, 'Group noise to turn back off');

                var jumpsBefore = window.__nativeMapJumpCalls;
                goTo.click();
                await waitFor(function() { return window.__nativeMapJumpCalls === jumpsBefore + 1 && !goTo.disabled; }, 'Go to to invoke native map jumpTo');
                assertBrowser(window.__lastNativeMapJump && Array.isArray(window.__lastNativeMapJump.center), 'Go to must supply a concrete native map center');

                assertEqual(bridge.isPreviewForced(hostTemplate.id), false, 'modal forced preview must begin off');
                togglePreview.click();
                await waitFor(function() {
                    return bridge.isPreviewForced(hostTemplate.id)
                        && togglePreview.getAttribute('aria-pressed') === 'true'
                        && !togglePreview.disabled;
                }, 'modal Toggle preview to turn on');
                togglePreview.click();
                await waitFor(function() {
                    return !bridge.isPreviewForced(hostTemplate.id)
                        && togglePreview.getAttribute('aria-pressed') === 'false'
                        && !togglePreview.disabled;
                }, 'modal Toggle preview to turn back off');
            });

            await check('ui-scale-input-previews-change-persists-and-exempts-map', async function() {
                var storageKey = 'gpc-mobile-overhaul-ui-scale';
                var scaleRoot = document.getElementById('gpc-mobile-ui-scale-control');
                var scaleButton = scaleRoot.querySelector('button[aria-label="Adjust mobile UI scale"]');
                var range = scaleRoot.querySelector('input[aria-label="Mobile UI scale"]');
                var output = scaleRoot.querySelector('output');
                // GeoPixelcons-owned surfaces: eligible for scaling.
                var eligibleUi = document.getElementById('gpc-mobile-native-controls-row');
                var eligibleHamburger = document.getElementById('gpc-mobile-hamburger');
                var previewCard = document.querySelector('.gpc-mobile-preview-card');
                // Native site elements: scaling is deliberately scoped to
                // GeoPixelcons' own UI only, not a guess at native-site DOM
                // structure -- these must never be touched.
                var nativeUi = document.getElementById('controls-right');
                var panel = document.getElementById('gpc-mobile-panel');
                var mobileRoot = document.getElementById('gpc-mobile-overhaul-root');
                var mapShell = document.getElementById('map-shell');
                var pixelCanvas = document.getElementById('pixel-canvas');
                var eligibleStyleBefore = eligibleUi.getAttribute('style');
                var nativeStyleBefore = nativeUi.getAttribute('style');
                localStorage.removeItem(storageKey);
                scaleButton.click();
                assertEqual(scaleButton.getAttribute('aria-expanded'), 'true', 'scale button must expand its range control');

                range.value = '125';
                range.dispatchEvent(new Event('input', { bubbles: true }));
                assertEqual(output.textContent.trim(), '125%', 'range input must preview its pending label immediately');
                assertEqual(scaleButton.textContent.trim(), 'UI 125%', 'pending input must update the compact scale label');
                assertEqual(localStorage.getItem(storageKey), null, 'range input must not persist before change/pointerup');
                assertEqual(eligibleUi.getAttribute('data-gpc-mobile-scale-applied'), null, 'range input must not apply pending zoom to UI roots');
                assertEqual(eligibleUi.getAttribute('style'), eligibleStyleBefore, 'range input must leave eligible UI geometry untouched');

                range.dispatchEvent(new Event('change', { bubbles: true }));
                assertEqual(localStorage.getItem(storageKey), '125', 'range change must persist the applied scale');
                assertEqual(scaleButton.getAttribute('aria-expanded'), 'false', 'range change must collapse the scale control');
                assertBrowser(range.parentElement.hidden, 'committed scale slider must be hidden until reopened');
                assertEqual(eligibleUi.getAttribute('data-gpc-mobile-scale-applied'), '125', 'range change must mark eligible GeoPixelcons-owned UI roots');
                assertEqual(eligibleUi.style.getPropertyValue('zoom'), '1.25', 'range change must apply the chosen UI zoom');
                assertEqual(eligibleHamburger.getAttribute('data-gpc-mobile-scale-applied'), '125', 'the hamburger menu root must participate in UI scaling');
                assertEqual(previewCard.getAttribute('data-gpc-mobile-scale-applied'), '125', 'bounded modal content must participate in UI scaling');
                assertEqual(nativeUi.getAttribute('data-gpc-mobile-scale-applied'), null, 'native site UI must never be scaled -- scope is GeoPixelcons-owned elements only');
                assertEqual(nativeUi.getAttribute('style'), nativeStyleBefore, 'native site UI geometry must remain untouched by mobile UI scale');
                [panel, mobileRoot, mapShell, pixelCanvas].forEach(function(exempt) {
                    assertEqual(exempt.getAttribute('data-gpc-mobile-scale-applied'), null, exempt.id + ' must remain scale-exempt');
                    assertEqual(exempt.style.getPropertyValue('zoom'), '', exempt.id + ' must retain full-width/map geometry');
                });

                scaleButton.click();
                range.value = '100';
                range.dispatchEvent(new Event('input', { bubbles: true }));
                range.dispatchEvent(new Event('change', { bubbles: true }));
                assertEqual(localStorage.getItem(storageKey), '100', 'reset scale must persist the default');
                assertEqual(eligibleUi.getAttribute('data-gpc-mobile-scale-applied'), null, '100% must remove scale markers');
                assertEqual(eligibleUi.getAttribute('style'), eligibleStyleBefore, '100% must restore the exact eligible UI style');

                document.querySelector('button[aria-label="Close template preview"]').click();
                await waitFor(function() { return effectivelyHidden(document.getElementById('gpc-mobile-preview-dialog')); }, 'the preview modal to close');
            });

            await check('one-shot-native-eyedropper-syncs-template-mask', async function() {
                var eyedropper = document.getElementById('toggleEyedropper_Bottom');
                assertEqual(eyedropper.getAttribute('data-gpc-mobile-eyedropper'), 'one-shot', 'real bottom Eyedropper must advertise one-shot behavior');
                assertEqual(eyedropper.getAttribute('aria-label'), 'Pick one color from the map', 'mobile Eyedropper must have a descriptive label');
                assertBrowser(eyedropper.querySelector('.gpc-mobile-eyedropper-label'), 'mobile Eyedropper must retain its compact visible label');
                assertDeepEqual(Array.from(hostTemplate.mask), [2], 'fixture must begin with only red selected');
                window.__nativeEyedropperArmed = false;
                var callsBefore = window.__nativeEyedropperCalls;

                eyedropper.click();
                assertEqual(window.__nativeEyedropperCalls, callsBefore + 1, 'one tap must invoke the native Eyedropper exactly once');
                assertEqual(window.__nativeEyedropperArmed, true, 'native one-shot Eyedropper must arm for the next map color');
                window.__fixturePickNativeColor('#000000');
                await waitFor(function() { return hostTemplate.mask[0] === 1; }, 'the picked black color to synchronize the Ghost++ mask');
                assertEqual(window.__nativeEyedropperArmed, false, 'the first picked color must consume the one-shot Eyedropper');
                assertEqual(window.__fixtureGetSelectedPaintColor(), '#000000', 'native picked color must remain the active paint color');
                assertDeepEqual(Array.from(hostTemplate.mask), [1], 'one-shot picked color must select exactly black in the focused template');
            });

            await check('always-live-autoscan-debounces-queue-and-placepixels', async function() {
                var bridge = window.__mobileBoundary.bridge;
                bridge.ensureRuntimeHooks();
                var scanProbe = window.__mobileHostFixture.installScanProbe();
                try {
                    assertEqual(scanProbe.desktopAutoscanEnabled, false, 'desktop Autoscan setting must remain off while Mobile Overhaul supplies always-live progress');
                    var nativePlacementsBefore = window.__nativePlacePixelCalls.length;
                    var placementResult = window.placePixelAt(101, 201, true);
                    window.placePixelAt(102, 202, true);
                    window.placePixelAt(103, 203, true);
                    assertBrowser(placementResult && placementResult.queued, 'fixture placement must exercise the live queued-pixel path');
                    assertEqual(window.__nativePlacePixelCalls.length, nativePlacementsBefore + 3, 'autoscan wrapper must preserve every native queued placement');
                    assertEqual(window.__nativePlacePixelCalls.at(-1)[2], true, 'queued placement flag must reach the native function unchanged');
                    await waitFor(function() { return scanProbe.count === 1; }, 'three queued placements to coalesce into one autoscan', 4000);
                    await delay(250);
                    assertEqual(scanProbe.count, 1, 'trailing debounce must produce exactly one scan for the queued burst');
                    assertEqual(scanProbe.snapshot()[0].templateId, hostTemplate.id, 'queued autoscan must target the focused template');

                    var response = await window.fetch('/PlacePixels', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: '{}',
                    });
                    assertBrowser(response.ok, 'fixture /PlacePixels response must be successful');
                    await waitFor(function() { return scanProbe.count === 2; }, 'successful /PlacePixels to trigger its delayed autoscan', 5000);
                    await delay(250);
                    assertEqual(scanProbe.count, 2, 'successful /PlacePixels must add one coalesced scan, not duplicates');
                    assertEqual(scanProbe.snapshot()[1].templateId, hostTemplate.id, 'paint-success autoscan must target the focused template');
                } finally {
                    scanProbe.restore();
                }
            });

            await check('transparent-native-color-does-not-alias-black', async function() {
                var bridge = window.__mobileBoundary.bridge;
                window.__fixtureSetGamePalette(['#FF0000', '#00000000'], [0, 1], '#FF0000');
                hostTemplate = window.__mobileHostFixture.installTemplate();
                var rows = bridge.getPaletteRows(hostTemplate);
                assertEqual(rows[0].hex, '#000000', 'fixture palette index 0 must be opaque black');
                assertEqual(rows[0].owned, false, 'native transparent sentinel must not count as owned opaque black');
                assertEqual(rows[1].owned, true, 'real opaque red must still count as owned');

                var changeCallsBefore = window.__nativeChangeColorCalls;
                var selectedBefore = window.__fixtureGetSelectedPaintColor();
                var result = await bridge.selectColor(0);
                assertEqual(result.selected, true, 'template black selection must still succeed');
                assertEqual(result.owned, false, 'black selection result must not claim transparent ownership');
                assertEqual(window.__nativeChangeColorCalls, changeCallsBefore, 'unowned black must not call native changeColor with the transparent sentinel');
                assertEqual(window.__fixtureGetSelectedPaintColor(), selectedBefore, 'unowned black must leave the native transparent/opaque paint selection unchanged');
                assertDeepEqual(Array.from(hostTemplate.mask), [1], 'template mask must select only black');
            });

            await check('absent-picked-color-preserves-template-mask', async function() {
                var bridge = window.__mobileBoundary.bridge;
                bridge.ensureRuntimeHooks();
                await bridge.selectColor(0, { changeNative: false });
                document.dispatchEvent(new CustomEvent('gpc:pixelColorChanged', { detail: '#FF0000' }));
                await waitFor(function() {
                    return hostTemplate.mask[0] === 2;
                }, 'a present picked color to prove the host listener is active');

                var before = Array.from(hostTemplate.mask);
                document.dispatchEvent(new CustomEvent('gpc:pixelColorChanged', { detail: '#ABCDEF' }));
                await delay(75);
                assertDeepEqual(Array.from(hostTemplate.mask), before, 'a picked color absent from the focused template must not clear or replace its mask');
            });

            await check('invalid-focus-id-does-not-mutate-state', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var before = window.__mobileHostFixture.snapshot(hostTemplate);
                var result = await bridge.focusTemplate('mobile_fixture_missing_id');
                var after = window.__mobileHostFixture.snapshot(hostTemplate);
                assertEqual(result, null, 'invalid focus ID must be rejected');
                assertDeepEqual(after, before, 'invalid focus ID must not mutate focus, order, mask, or position');
            });

            await check('fractional-position-is-rejected', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var before = window.__mobileHostFixture.snapshot(hostTemplate).position;
                var result = await bridge.commitPosition(hostTemplate, 10.5, 21);
                var after = window.__mobileHostFixture.snapshot(hostTemplate).position;
                assertEqual(result, false, 'fractional grid coordinates must be rejected');
                assertDeepEqual(after, before, 'rejected fractional coordinates must leave template.position unchanged');
            });

            await check('mobile-compatibility-setting-removed', async function() {
                // loadSettings() merges forward from whatever localStorage
                // already has -- an old stored blob keeping the now-unused
                // mobileCompatibility key around is harmless, inert data,
                // not something removing it from DEFAULT_SETTINGS promises
                // to strip. What actually matters: the feature has no UI and
                // does nothing with the key even if it's present.
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'P', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
                }));
                await waitFor(function() { return document.getElementById('gpc-settings-modal'); }, 'settings modal');
                var rows = Array.from(document.querySelectorAll('#gpc-settings-modal *')).filter(function(node) {
                    return node.textContent && node.textContent.indexOf('Mobile Compatibility') !== -1;
                });
                assertEqual(rows.length, 0, 'settings modal must not expose a Mobile Compatibility row');
                document.getElementById('gpc-settings-modal').remove();
            });

            await check('close-panel-forces-native-resume-control-visible-when-natively-hidden', async function() {
                var controller = window.__mobileBoundary.controller;
                var resume = document.getElementById('resumePaintingControl');
                // The fixture's plain stub button never hides itself on its
                // own -- simulate the real native site's own paint-mode
                // logic (setPrimaryMode()/updateInterfaceState()) leaving it
                // hidden while painting, which is the actual condition
                // behind the reported "closed the panel, no way back in" bug.
                resume.hidden = true;
                resume.setAttribute('aria-hidden', 'true');
                resume.style.setProperty('display', 'none');
                controller.openPanel();
                await waitFor(function() { return controller.isOpen === true; }, 'the panel to open');
                controller.closePanel();
                await waitFor(function() { return controller.isOpen === false; }, 'the panel to close');
                assertBrowser(!resume.hidden, 'closing the panel must force the native resume control visible even when native mode logic left it hidden');
                assertBrowser(resume.getAttribute('aria-hidden') !== 'true', 'closing the panel must clear aria-hidden from the forced-visible resume control');
                assertEqual(resume.style.getPropertyValue('display'), '', 'closing the panel must clear an inline display:none on the resume control');
                resume.click();
                await waitFor(function() { return controller.isOpen === true; }, 'the now-visible resume control to reopen the panel');
                assertBrowser(resume.hidden, 'reopening the panel must let it own the reopen affordance again, suppressing the native control');
            });

            await check('reopen-via-resume-control-shows-view-a-not-stranded-view-b', async function() {
                var controller = window.__mobileBoundary.controller;
                var viewA = document.getElementById('gpc-mobile-view-a');
                var viewB = document.getElementById('gpc-mobile-view-b');
                var wrench = viewA.querySelector('button[aria-label="Open template settings"]');
                controller.openPanel();
                await waitFor(function() { return controller.isOpen === true && !effectivelyHidden(viewA); }, 'the panel to open showing View A');
                wrench.click();
                await waitFor(function() { return !effectivelyHidden(viewB); }, 'View B to open via the wrench icon');
                controller.closePanel();
                await waitFor(function() { return controller.isOpen === false; }, 'the panel to close while View B was still active');
                var resume = document.getElementById('resumePaintingControl');
                resume.click();
                await waitFor(function() { return controller.isOpen === true; }, 'the resume control to reopen the panel');
                assertBrowser(!effectivelyHidden(viewA), 'reopening via any path other than View B’s own Return button must show View A, the painting menu');
                assertBrowser(effectivelyHidden(viewB), 'reopening via any path other than Return must not leave View B stranded on screen');
                assertEqual(viewA.getAttribute('aria-hidden'), 'false', 'View A must be exposed accessibly after this reopen path');
                assertEqual(viewB.getAttribute('aria-hidden'), 'true', 'View B must be hidden accessibly after this reopen path');
            });

            await check('close-panel-also-closes-open-preview-modal', async function() {
                var controller = window.__mobileBoundary.controller;
                var viewA = document.getElementById('gpc-mobile-view-a');
                controller.openPanel();
                await waitFor(function() { return controller.isOpen === true && !effectivelyHidden(viewA); }, 'the panel to open showing View A');
                var thumbnail = viewA.querySelector('button[aria-label="Open focused template preview"]');
                if (!thumbnail || thumbnail.disabled) return; // no focused template installed by this point in the sequence
                thumbnail.click();
                var overlay = document.getElementById('gpc-mobile-preview-dialog');
                await waitFor(function() { return overlay && !effectivelyHidden(overlay); }, 'the preview modal to open');
                controller.closePanel();
                await waitFor(function() {
                    return controller.isOpen === false && effectivelyHidden(overlay);
                }, 'closing the panel to also close the still-open preview modal, not leave it covering the map');
            });

            await check('controller-destroy-restores-host-effects', async function() {
                var bridge = window.__mobileBoundary.bridge;
                var controller = window.__mobileBoundary.controller;
                assertEqual(window.__mobileBoundary.fetchWrappedAfterReady, true, 'bridge.ready must install the host paint-success fetch wrapper');
                assertBrowser(window.fetch !== window.__fixtureOriginalFetch, 'host fetch wrapper must remain active while the controller is mounted');
                await bridge.selectColor(1, { changeNative: false });
                var maskBeforeDestroy = Array.from(hostTemplate.mask);

                await controller.destroy();
                await waitFor(function() {
                    return controller.destroyed && !document.getElementById('gpc-mobile-overhaul-root');
                }, 'controller host-effect teardown');
                assertEqual(window.fetch, window.__fixtureOriginalFetch, 'controller destroy must restore the exact original host fetch function');

                document.dispatchEvent(new CustomEvent('gpc:pixelColorChanged', { detail: '#000000' }));
                await delay(75);
                assertDeepEqual(Array.from(hostTemplate.mask), maskBeforeDestroy, 'controller destroy must remove the host color-change listener');
            });

            await check('destroy-restores-native-dom', async function() {
                var controller = window.__mobileBoundary.controller;
                assertBrowser(typeof controller.destroy === 'function', 'controller must expose destroy');
                await controller.destroy();
                await waitFor(function() {
                    return controller.destroyed && !document.getElementById('gpc-mobile-overhaul-root');
                }, 'Mobile Overhaul teardown');
                ['bottomControls', 'currentEnergyDisplay', 'toggleBrushModeBtn_Bottom', 'brush-swap-toggle', 'commitBtn', 'toggleEyedropper_Bottom']
                    .forEach(assertNativeSnapshot);

                var bottom = document.getElementById('bottomControls');
                bottom.classList.add('hidden');
                bottom.style.display = 'none';
                bottom.setAttribute('aria-hidden', 'true');
                var callsBefore = window.__nativeResumeCalls;
                document.getElementById('resumePaintingControl').click();
                assertEqual(window.__nativeResumeCalls, callsBefore + 1, 'destroy must remove the resume capture listener');
                assertBrowser(!effectivelyHidden(bottom), 'native resume behavior must work after destroy');
            });

            await check('settings-row-and-reload-banner', async function() {
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'P', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
                }));
                await waitFor(function() { return document.getElementById('gpc-settings-modal'); }, 'settings modal');
                var input = document.querySelector('input[aria-label="Enable Mobile System Overhaul after reload"]');
                assertBrowser(input, 'settings modal must expose the Mobile Overhaul checkbox');
                assertEqual(input.checked, true, 'settings checkbox must reflect the saved enabled value');
                input.checked = false;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                assertEqual(currentSettings().mobileOverhaul, false, 'settings checkbox must persist changes');
                assertEqual(document.getElementById('gpc-restart-banner').style.display, 'block', 'settings change must show the reload-required banner');
                input.checked = true;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                assertEqual(currentSettings().mobileOverhaul, true, 'fixture must restore the enabled saved value');
            });
        } else if (mode === 'missing') {
            // Give the guarded bootstrap's missing-module branch one turn to
            // run after DOMContentLoaded before checking the untouched page.
            await delay(100);

            await check('missing-external-is-guarded', async function() {
                assertEqual(window.__mobileBoundary.externalAvailableBeforeMain, false, 'missing scenario must truly omit the external bundle');
                assertEqual(window.__mobileBoundary.initCalls, 0, 'main script must not call a missing initializer');
                assertBrowser(
                    window.__fixtureConsole.errors.some(function(message) {
                        return message.includes('external module did not load');
                    }),
                    'guarded bootstrap must diagnose the unavailable external module',
                );
            });

            await check('missing-external-preserves-native-desktop-ui', async function() {
                assertBrowser(!document.getElementById('gpc-mobile-overhaul-root'), 'missing bundle must not create a partial mobile root');
                assertBrowser(!document.getElementById('gpc-mobile-panel'), 'missing bundle must not create a partial mobile panel');
                assertBrowser(!document.getElementById('gpp-modal'), 'desktop-off Ghost++ engine must not be forced on without an available bundle');
                assertBrowser(!document.getElementById('gpp-opener'), 'native ghost opener must not be replaced without an available bundle');
                assertBrowser(!effectivelyHidden(document.getElementById('bottomControls')), 'native bottomControls must remain visible');
                ['bottomControls', 'currentEnergyDisplay', 'toggleBrushModeBtn_Bottom', 'brush-swap-toggle', 'commitBtn', 'toggleEyedropper_Bottom']
                    .forEach(assertNativeSnapshot);

                var bottom = document.getElementById('bottomControls');
                bottom.classList.add('hidden');
                bottom.style.display = 'none';
                bottom.setAttribute('aria-hidden', 'true');
                document.getElementById('resumePaintingControl').click();
                assertEqual(window.__nativeResumeCalls, 1, 'native resume handler must remain installed');
                assertBrowser(!effectivelyHidden(bottom), 'native resume must still reopen native bottomControls');
                assertEqual(document.getElementById('loadGhostImageBtn').style.display, '', 'native ghost button must remain available');
            });
        } else {
            await waitFor(function() {
                return window.__fixtureConsole.errors.some(function(message) {
                    return message.includes('Mobile System Overhaul failed');
                });
            }, 'the guarded external-initializer failure path');

            await check('external-initializer-failure-is-contained', async function() {
                var boundary = window.__mobileBoundary;
                assertEqual(boundary.externalAvailableBeforeMain, true, 'failure stub must exist before the production IIFE');
                assertEqual(boundary.initCalls, 1, 'production bootstrap must invoke the failure stub once');
                if (mode === 'throw-before-ready') {
                    assertEqual(boundary.readyCalls, 0, 'throw-before-ready stub must fail before bridge.ready');
                    assertEqual(boundary.readyResolved, false, 'bridge.ready must not resolve in the early-throw path');
                    assertBrowser(boundary.initError && boundary.initError.includes('before bridge.ready'), 'fixture must observe the intentional early throw');
                } else {
                    assertEqual(boundary.readyCalls, 1, 'invalid-controller stub must call bridge.ready once');
                    assertEqual(boundary.readyResolved, true, 'bridge.ready must resolve before the invalid controller is rejected');
                    assertEqual(boundary.fetchWrappedAfterReady, true, 'after-ready failure setup must have installed the host fetch wrapper');
                    assertEqual(window.__fixtureInvalidControllerDestroyCalls, 1, 'production bootstrap must destroy an invalid partial controller');
                }
                assertEqual(window.fetch, window.__fixtureOriginalFetch, 'initializer failure must restore the exact original host fetch function');
                assertBrowser(
                    window.__fixtureConsole.errors.some(function(message) {
                        return message.includes('Mobile System Overhaul failed');
                    }),
                    'initializer failure must be diagnosed without becoming an uncaught exception',
                );
            });

            await check('initializer-failure-leaves-no-partial-mobile-surface', async function() {
                assertBrowser(!document.getElementById('gpc-mobile-overhaul-root'), 'failed initializer must not leave the real mobile root mounted');
                assertBrowser(!document.getElementById('gpc-mobile-panel'), 'failed initializer must not leave the real mobile panel mounted');
                assertBrowser(!document.getElementById('gpc-mobile-invalid-partial'), 'invalid controller destroy must remove its partial surface');
                assertBrowser(!effectivelyHidden(document.getElementById('bottomControls')), 'failed initializer must leave native bottomControls visible');
                ['bottomControls', 'currentEnergyDisplay', 'toggleBrushModeBtn_Bottom', 'brush-swap-toggle', 'commitBtn', 'toggleEyedropper_Bottom']
                    .forEach(assertNativeSnapshot);

                hostTemplate = window.__mobileHostFixture.installTemplate();
                var maskBefore = Array.from(hostTemplate.mask);
                document.dispatchEvent(new CustomEvent('gpc:pixelColorChanged', { detail: '#000000' }));
                await delay(75);
                assertDeepEqual(Array.from(hostTemplate.mask), maskBefore, 'failed initializer must remove or never install the host color-change listener');
            });

            await check('initializer-failure-restores-desktop-opener', async function() {
                var opener = document.getElementById('gpp-opener');
                var modal = document.getElementById('gpp-modal');
                assertBrowser(opener && modal, 'shared Ghost++ engine must retain a desktop opener and modal after external failure');
                assertBrowser(modal.classList.contains('gpp-hidden'), 'desktop modal should begin closed before the fallback opener is clicked');
                opener.click();
                await waitFor(function() {
                    return !modal.classList.contains('gpp-hidden') && getComputedStyle(modal).display !== 'none';
                }, 'the desktop Ghost++ opener after external failure', 3000);
                assertBrowser(modal.getAttribute('aria-hidden') !== 'true', 'visible fallback modal must not remain aria-hidden');
                assertBrowser(document.getElementById('gpp-drop-zone'), 'fallback desktop opener must build the usable Ghost++ shell');

                var bottom = document.getElementById('bottomControls');
                bottom.classList.add('hidden');
                bottom.style.display = 'none';
                bottom.setAttribute('aria-hidden', 'true');
                var callsBefore = window.__nativeResumeCalls;
                document.getElementById('resumePaintingControl').click();
                assertEqual(window.__nativeResumeCalls, callsBefore + 1, 'failed initializer must leave native resume behavior installed');
                assertBrowser(!effectivelyHidden(bottom), 'native resume must reopen native controls after initializer failure');
            });
        }

        await delay(50);
        await check('no-uncaught-browser-errors', async function() {
            assertDeepEqual(window.__fixtureErrors, [], 'browser must not emit error or unhandledrejection events');
        });

        var failed = results.filter(function(result) { return !result.ok; });
        var payload = {
            scenario: scenario,
            crashed: false,
            results: results,
            consoleErrors: window.__fixtureConsole.errors,
            consoleWarnings: window.__fixtureConsole.warnings,
            fixtureErrors: window.__fixtureErrors,
        };
        resultElement.dataset.status = failed.length ? 'fail' : 'pass';
        resultElement.textContent = JSON.stringify(payload);
        window.__fixtureStage = 'reporting-results';
        await window.__fixtureReportFetch('/report', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        var crashPayload = {
            scenario: scenario,
            crashed: true,
            message: String((error && error.stack) || error),
            results: results,
            consoleErrors: window.__fixtureConsole ? window.__fixtureConsole.errors : [],
            consoleWarnings: window.__fixtureConsole ? window.__fixtureConsole.warnings : [],
            fixtureErrors: window.__fixtureErrors || [],
        };
        resultElement.dataset.status = 'crashed';
        resultElement.textContent = JSON.stringify(crashPayload);
        window.__fixtureStage = 'reporting-crash';
        window.__fixtureReportFetch('/report', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(crashPayload),
        }).catch(function() {});
    }
})();
`;
}

async function runBrowserScenario({ label, mode, assembly, externalSource }) {
    const includeExternal = mode !== 'missing';
    const scenarioExternalSource = mode === 'real'
        ? externalSource
        : (mode === 'missing' ? '' : buildExternalFailureStub(mode));
    const html = buildFixtureHtml(includeExternal);
    const preludeSource = buildPreludeSource(assembly.settings);
    const driverSource = buildDriverSource(mode);

    let resolveReport;
    let rejectReport;
    const reportPromise = new Promise((resolvePromise, rejectPromise) => {
        resolveReport = resolvePromise;
        rejectReport = rejectPromise;
    });

    const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self' data: blob:",
        "worker-src 'self' blob:",
    ].join('; ');

    const server = createServer((request, response) => {
        if (request.method === 'POST' && request.url === '/PlacePixels') {
            request.resume();
            response.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
            });
            response.end('{"success":true}');
            return;
        }

        if (request.method === 'POST' && request.url === '/report') {
            let body = '';
            request.setEncoding('utf8');
            request.on('data', chunk => { body += chunk; });
            request.on('end', () => {
                response.writeHead(200, { 'content-type': 'text/plain' });
                response.end('ok');
                resolveReport(body);
            });
            request.on('error', rejectReport);
            return;
        }

        const scriptRoutes = new Map([
            ['/external.js', scenarioExternalSource],
            ['/prelude.js', preludeSource],
            ['/main.js', assembly.bodySource],
            ['/driver.js', driverSource],
        ]);
        if (scriptRoutes.has(request.url)) {
            response.writeHead(200, {
                'content-type': 'text/javascript; charset=utf-8',
                'cache-control': 'no-store',
                'content-security-policy': csp,
            });
            response.end(scriptRoutes.get(request.url));
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
    assert(browserPath, 'Microsoft Edge or Google Chrome was not found; set BROWSER_PATH');
    const profileDirectory = mkdtempSync(join(tmpdir(), 'gpp-mobile-fixture-'));
    let stderr = '';
    let browser;

    try {
        browser = spawn(browserPath, [
            '--headless=new',
            '--disable-gpu',
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
            `--window-size=${FIXTURE_VIEWPORT.width},${FIXTURE_VIEWPORT.height}`,
            `--user-data-dir=${profileDirectory}`,
            `http://127.0.0.1:${address.port}/`,
        ], {
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true,
        });
        browser.stderr.setEncoding('utf8');
        browser.stderr.on('data', chunk => { stderr += chunk; });
        browser.once('error', rejectReport);
        browser.once('close', code => {
            if (code !== 0) {
                rejectReport(new Error(`headless browser exited early with code ${code}\n${stderr}`));
            }
        });

        const timeoutMs = 60_000;
        let timeoutId;
        const timeoutPromise = new Promise((_, rejectTimeout) => {
            timeoutId = setTimeout(() => rejectTimeout(new Error(
                `${label} timed out after ${timeoutMs}ms waiting for /report`,
            )), timeoutMs);
        });
        let body;
        try {
            body = await Promise.race([reportPromise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutId);
        }
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch (error) {
            throw new Error(`${label} returned invalid JSON: ${error.message}\n${String(body).slice(0, 2000)}`);
        }
        return { label, parsed, stderr, browserPath };
    } finally {
        if (browser && !browser.killed) {
            try { browser.kill(); } catch (_) { /* ignore */ }
        }
        await new Promise(resolveClose => server.close(resolveClose));
        await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
        try {
            rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch (error) {
            console.warn(`Could not remove temporary browser profile ${profileDirectory}: ${error.message}`);
        }
    }
}

function printScenario(outcome) {
    console.log(`\n=== ${outcome.label} ===`);
    const payload = outcome.parsed;
    if (payload.crashed) {
        console.log(`CRASH: ${payload.message}`);
        return { failed: true, total: 0, passed: 0 };
    }

    let passed = 0;
    let failed = 0;
    for (const result of payload.results || []) {
        console.log(`[${result.ok ? 'PASS' : 'FAIL'}] ${result.id}: ${result.detail}`);
        if (result.ok) passed += 1;
        else failed += 1;
    }
    if (payload.consoleErrors && payload.consoleErrors.length) {
        console.log('console.error calls:');
        payload.consoleErrors.forEach(message => console.log(`  ${message}`));
    }
    if (payload.fixtureErrors && payload.fixtureErrors.length) {
        console.log('window error/unhandledrejection events:');
        payload.fixtureErrors.forEach(message => console.log(`  ${message}`));
    }
    return { failed: failed > 0, total: passed + failed, passed };
}

async function main() {
    const assembly = readProductionAssembly();
    const externalSource = readExternalBundle(assembly.mobileOrder);
    assert.doesNotThrow(() => new Function(assembly.bodySource), 'assembled production IIFE must parse');
    assert.doesNotThrow(() => new Function(externalSource), 'external bundle must parse');
    assert.doesNotThrow(() => new Function(buildPreludeSource(assembly.settings)), 'fixture prelude must parse');
    console.log(`Production assembly: ${assembly.sourceOrder.length} files from build.js LEGACY_SOURCE_ORDER.`);
    console.log(`External bundle: ${assembly.mobileOrder.length} mobile module files under src/mobile/.`);
    console.log(`Requested viewport: ${FIXTURE_VIEWPORT.width}x${FIXTURE_VIEWPORT.height}`);

    const allScenarios = [
        { label: 'Bundle present / Mobile Overhaul active', mode: 'real' },
        { label: 'Bundle missing / graceful native fallback', mode: 'missing' },
        { label: 'Initializer throws before bridge.ready / desktop fallback', mode: 'throw-before-ready' },
        { label: 'Invalid controller after bridge.ready / rollback', mode: 'invalid-after-ready' },
    ];
    const requestedMode = process.env.GPP_MOBILE_FIXTURE_MODE;
    const scenarios = requestedMode
        ? allScenarios.filter(scenario => scenario.mode === requestedMode)
        : allScenarios;
    assert(scenarios.length > 0, `Unknown GPP_MOBILE_FIXTURE_MODE: ${requestedMode}`);
    for (const scenario of scenarios) {
        assert.doesNotThrow(() => new Function(buildDriverSource(scenario.mode)), `${scenario.mode} driver must parse`);
        if (scenario.mode !== 'real' && scenario.mode !== 'missing') {
            assert.doesNotThrow(() => new Function(buildExternalFailureStub(scenario.mode)), `${scenario.mode} external stub must parse`);
        }
    }
    const outcomes = [];
    for (const scenario of scenarios) {
        outcomes.push(await runBrowserScenario({ ...scenario, assembly, externalSource }));
    }

    console.log('\n============================================================');
    console.log(' MOBILE SYSTEM OVERHAUL REAL-BROWSER FIXTURE');
    console.log('============================================================');
    let failed = false;
    let total = 0;
    let passed = 0;
    for (const outcome of outcomes) {
        const summary = printScenario(outcome);
        failed ||= summary.failed;
        total += summary.total;
        passed += summary.passed;
    }
    console.log('\n============================================================');
    console.log(failed ? `RESULT: FAIL (${passed}/${total} passed).` : `RESULT: PASS (${passed}/${total} passed).`);
    if (failed) process.exitCode = 1;
}

main().catch(error => {
    console.error('Mobile Overhaul fixture runner crashed:', error);
    process.exitCode = 1;
});
