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
    assert.match(artifact, /const VERSION = '2\.0\.0';/);
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const versionPattern = new RegExp(`const LIBRARY_VERSION = '${escapedVersion}'; // x-release-please-version`);
    assert.match(artifact, versionPattern);
});
