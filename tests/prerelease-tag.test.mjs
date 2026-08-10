import assert from 'node:assert/strict';
import test from 'node:test';
import { branchSlug, chooseBump, selectPreview } from '../.github/scripts/prerelease-tag.mjs';

test('normalizes a feature branch into a SemVer-safe prerelease identifier', () => {
    assert.equal(branchSlug('feature/Library Migration!'), 'feature-library-migration');
});

test('uses the requested initial version before the first stable release', () => {
    assert.deepEqual(selectPreview({
        bootstrapVersion: '1.0.0', branch: 'feature/start', title: 'feat: start', tags: [],
    }), {
        tag: 'v1.0.0-feature-start-1', version: '1.0.0', bump: 'minor', number: 1,
    });
});

test('uses feat for a minor candidate and continues the branch counter across bases', () => {
    assert.deepEqual(selectPreview({
        stableVersion: '1.0.0', bootstrapVersion: '1.0.0', branch: 'feature/start', title: 'feat(ui): improve mobile',
        tags: ['v1.0.0-feature-start-1', 'v1.0.1-feature-start-2'],
    }), {
        tag: 'v1.1.0-feature-start-3', version: '1.1.0', bump: 'minor', number: 3,
    });
});

test('uses fix or an explicit patch label for a patch candidate', () => {
    assert.equal(chooseBump({ title: 'fix: remove stale control' }), 'patch');
    assert.equal(chooseBump({ title: 'docs: clarify release flow', labels: [{ name: 'release:patch' }] }), 'patch');
});

test('rejects conflicting release labels', () => {
    assert.throws(() => chooseBump({ labels: ['release:minor', 'release:patch'] }));
});
