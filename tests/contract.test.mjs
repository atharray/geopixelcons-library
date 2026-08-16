import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const artifact = readFileSync(new URL('../dist/geopixelcons-library.js', import.meta.url), 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('loads as a side-effect-free factory before the main userscript', () => {
    const sandbox = { Object, Error };
    vm.createContext(sandbox);
    assert.doesNotThrow(() => vm.runInContext(artifact, sandbox, { filename: 'geopixelcons-library.js' }));
    assert.equal(sandbox.GeoPixelconsLibrary.version, version);
    assert.equal(typeof sandbox.GeoPixelconsLibrary.boot, 'function');
});

test('publishes the library bridge when @require wraps the source', () => {
    const sandbox = { Object, Error };
    vm.createContext(sandbox);
    const wrappedRequire = `(function(){\n${artifact}\n})();`;
    assert.doesNotThrow(() => vm.runInContext(wrappedRequire, sandbox, { filename: 'tampermonkey-require.js' }));
    assert.equal(sandbox.GeoPixelconsLibrary.version, version);
    assert.equal(typeof sandbox.GeoPixelconsLibrary.boot, 'function');
});

test('keeps the legacy application behind the boot boundary', () => {
    assert.match(artifact, /function boot\(\)/);
    assert.match(artifact, /FEATURE: Ghost Template Manager/);
    assert.match(artifact, /const VERSION = '2\.4\.0';/);
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const versionPattern = new RegExp(`const LIBRARY_VERSION = '${escapedVersion}'; // x-release-please-version`);
    assert.match(artifact, versionPattern);
});

test('includes the profile color list collapse feature', () => {
    assert.match(artifact, /FEATURE: Profile Color List Collapse/);
    assert.match(artifact, /userColorsContainer/);
    assert.match(artifact, /MAX_VISIBLE_COLORS = 100/);
    assert.match(artifact, /Show All/);
    assert.match(artifact, /Show Less/);
    assert.match(artifact, /bodyObserver\.disconnect\(\)/);
});
test('includes the opt-in native guild territory auto-loader', () => {
    assert.match(artifact, /territorySettingsCollapsible/);
    assert.match(artifact, /territoryAutoLoadCheck/);
    assert.match(artifact, /autoLoadTerritories: false/);
    assert.match(artifact, /fetchUserGuild/);
    assert.match(artifact, /fetchGuildProjects/);
    assert.match(artifact, /loadGuildProjectsInPageRealm/);
});
test('includes a confirmation gate for large bulk purchases', () => {
    assert.match(artifact, /BULK_PURCHASE_WARNING_THRESHOLD = 50/);
    assert.match(artifact, /gp-bulk-warning-overlay/);
    assert.match(artifact, /gp-bulk-warning-summary/);
    assert.match(artifact, /toBuyCount > BULK_PURCHASE_WARNING_THRESHOLD/);
    assert.match(artifact, /You are about to buy/);
    assert.match(artifact, /⚠️ WARNING ⚠️/);
    assert.match(artifact, />Continue\?</);
    assert.match(artifact, /Continue \(buy all\)/);
    assert.match(artifact, /gp-bulk-warning-continue/);
    assert.match(artifact, /function onBulkConfirm\(\)[\s\S]*?openBulkWarning\(toBuyCount/);
    assert.match(artifact, /function openBulkModal\(colors\)[\s\S]*?renderBulkPreview\(nextColors\)/);
    assert.match(artifact, /function continueBulkWarning\(\)[\s\S]*?executeConfirmedBulkPurchase/);
});
