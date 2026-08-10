'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OUTPUT = path.join(ROOT, 'dist', 'geopixelcons-library.js');
// Mobile UI (src/mobile/...): kept as modular source, not a pre-flattened
// bundle, so it can be maintained the same way as every other feature area.
// Concatenation order matches the mobile module's own internal contract: a
// single wrapping IIFE producing one top-level "var mobileOverhaulInit".
// NOTE: this array literal is also parsed by a simple quote-matching regex in
// tests/regression/mobile-overhaul-fixture.mjs -- keep comments outside the
// array (as above), not inside it, and avoid apostrophes in any comment that
// does end up inside the brackets below.
const LEGACY_SOURCE_ORDER = [
    'src/mobile/wrapper-open.js',
    'src/mobile/theme.js',
    'src/mobile/contract.js',
    'src/mobile/shared/lifecycle.js',
    'src/mobile/hamburger-menu.js',
    'src/mobile/view-a/panel-core.js',
    'src/mobile/view-b/template-settings.js',
    'src/mobile/additions.js',
    'src/mobile/view-a/native-controls.js',
    'src/mobile/init.js',
    'src/mobile/wrapper-close.js',
    'src/legacy/core.js',
    'src/legacy/features/ghost-plus-plus/gpp-core.js',
    'src/legacy/features/ghost-plus-plus/gpp-bridge.js',
    'src/legacy/features/ghost-plus-plus/gpp-legacy-bridge.js',
    'src/legacy/features/ghost-plus-plus/gpp-runtime.js',
    'src/legacy/features/ghost-plus-plus/gpp-ui-shell.js',
    'src/legacy/features/ghost-plus-plus/gpp-renderer.js',
    'src/legacy/features/ghost-plus-plus/gpp-native-shim.js',
    'src/legacy/features/ghost-plus-plus/gpp-placement.js',
    'src/legacy/features/ghost-plus-plus/gpp-scan.js',
    'src/legacy/features/ghost-plus-plus/gpp-palette.js',
    'src/legacy/features/ghost-plus-plus/gpp-library.js',
    'src/legacy/features/ghost-plus-plus/gpp-view-settings.js',
    'src/legacy/features/ghost-plus-plus/gpp-init.js',
    'src/legacy/features/ghost-palette-search.js',
    'src/legacy/features/sync-ghost-color.js',
    'src/legacy/features/hide-paint-menu.js',
    'src/legacy/features/ghost-template-manager.js',
    'src/legacy/features/disable-group-noise.js',
    'src/legacy/features/start-shift-lock.js',
    'src/legacy/features/start-inspect-mode.js',
    'src/legacy/features/smooth-zoom-buttons.js',
    'src/legacy/features/guild-overhaul.js',
    'src/legacy/features/paint-brush-swap.js',
    'src/legacy/features/regions-highscore.js',
    'src/legacy/features/region-screenshot.js',
    'src/legacy/features/bulk-purchase-colors.js',
    'src/legacy/features/ext-auto-hover-menus.js',
    'src/legacy/features/ext-go-to-last-location.js',
    'src/legacy/features/ext-pill-hover-labels.js',
    'src/legacy/features/ext-janitor-view.js',
    'src/legacy/features/ext-map-movement-lock.js',
    'src/legacy/features/ext-guild-search.js',
    'src/legacy/features/ext-log-out-button.js',
    'src/legacy/features/theme-editor.js',
    'src/legacy/features/map-markers.js',
    'src/legacy/features/mobile-overhaul-bootstrap.js',
    'src/legacy/footer.js',
];

const MOBILE_UI_VERSION_TOKEN = '__GPP_MOBILE_UI_VERSION__';

let legacyProgram = LEGACY_SOURCE_ORDER
    .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'))
    .join('\n\n')
    .trimEnd();

// The mobile UI module reports its own version via a `moduleVersion` property
// (informational, for debugging which build is live) using a token that used
// to be substituted by its own standalone build.js. It's now one feature area
// among many in this library, so it just reports the library's version.
const mobileVersionTokenCount = legacyProgram.split(MOBILE_UI_VERSION_TOKEN).length - 1;
if (mobileVersionTokenCount !== 1) {
    throw new Error(`Expected exactly one ${MOBILE_UI_VERSION_TOKEN} token, found ${mobileVersionTokenCount}`);
}
legacyProgram = legacyProgram.replace(MOBILE_UI_VERSION_TOKEN, PACKAGE.version);

const artifact = `/* GeoPixelcons Library v${PACKAGE.version} - readable release bundle */
/* The legacy program is intentionally evaluated only when the shell calls boot(). */
var GeoPixelconsLibrary = (function createGeoPixelconsLibrary() {
    const LIBRARY_VERSION = '${PACKAGE.version}'; // x-release-please-version
    let runtime = null;
    let booting = false;

    function boot() {
        if (runtime) return runtime;
        if (booting) throw new Error('GeoPixelcons library boot is already in progress.');
        booting = true;
        try {
${legacyProgram}
            runtime = Object.freeze({
                version: LIBRARY_VERSION,
                destroy() {
                    throw new Error('Legacy GeoPixelcons controllers require a page reload to tear down.');
                },
            });
            return runtime;
        } finally {
            booting = false;
        }
    }

    return Object.freeze({
        version: LIBRARY_VERSION,
        boot,
    });
})();
`;

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, artifact, 'utf8');

const sri = `sha256-${crypto.createHash('sha256').update(artifact).digest('base64')}`;
console.log(`Built: ${path.relative(ROOT, OUTPUT)} (${Buffer.byteLength(artifact)} bytes)`);
console.log(`SRI: ${sri}`);
