import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const artifact = readFileSync(new URL('../dist/geopixelcons-library.js', import.meta.url), 'utf8');

function createAdapter() {
    const fn = () => undefined;
    return {
        contractVersion: 1,
        env: { window: {}, document: {} },
        settings: { get: fn, subscribe: fn },
        native: { clickControl: fn, changeColor: fn, activateEyedropper: fn },
        ghost: { getTemplates: fn, focus: fn, renderPreview: fn, scan: fn },
        map: { readCenterGrid: fn, commitPosition: fn, goTo: fn },
        ui: { requestRefresh: fn, reportError: fn },
    };
}

function loadLibrary() {
    const sandbox = { Map, Object, TypeError, Error, AggregateError };
    vm.createContext(sandbox);
    vm.runInContext(artifact, sandbox, { filename: 'geopixelcons-library.js' });
    return sandbox.GeoPixelconsLibrary;
}

test('validates the explicit adapter contract', () => {
    const library = loadLibrary();
    assert.equal(library.contractVersion, 1);
    assert.throws(() => library.boot({ contractVersion: 1 }), /env\.window/);
    assert.throws(() => library.boot({ ...createAdapter(), contractVersion: 2 }), /Unsupported/);
});

test('owns controller lifecycle without leaking main state', () => {
    const library = loadLibrary();
    const runtime = library.boot(createAdapter());
    const calls = [];
    runtime.register('first', () => ({ refresh: () => calls.push('refresh-first'), destroy: () => calls.push('destroy-first') }));
    runtime.register('second', () => ({ refresh: () => calls.push('refresh-second'), destroy: () => calls.push('destroy-second') }));
    runtime.refresh();
    runtime.destroy();
    assert.deepEqual(calls, ['refresh-first', 'refresh-second', 'destroy-second', 'destroy-first']);
    assert.equal(runtime.destroyed, true);
    assert.throws(() => runtime.refresh(), /destroyed/);
});
