# GeoPixelcons Library

The versioned, readable `@require` bundle for GeoPixelcons++. It owns the large
feature implementation while the companion shell stays tiny enough for
Greasyfork.

The first migration is deliberately compatibility-first: the legacy private
application IIFE remains intact inside an idempotent `GeoPixelconsLibrary.boot()`
wrapper. That moves code without `eval`, global-state leaks, or a risky
feature-by-feature rewrite.

## Local verification

```powershell
npm ci
npm run verify
```

`dist/geopixelcons-library.js` is committed because jsDelivr serves this exact
file from an immutable Git tag. Never hand-edit it; rebuild it with `npm run
build`.

## Releases

1. Work on an internal `feature/<name>` branch and open a PR to `main`.
2. The PR workflow creates immutable preview tags such as
   `v1.0.0-feature-library-migration-1`. Give the user the exact SRI-pinned
   jsDelivr `@require` line for temporary local Tampermonkey testing; previews
   are never the URL published to Greasyfork.
3. When the user reports a successful test and explicitly authorizes release,
   the agent merges the PR through normal branch protection. For the one-time
   `v1.0.0` baseline, it then runs **Bootstrap stable release** from GitHub
   Actions.
4. Later, Release Please opens a release PR after merged `feat:` or `fix:`
   work. With the same release authorization, the agent verifies and merges it
   to create the stable tag and release.
5. Verify the jsDelivr bytes and SRI before updating the shell repository.

See [ARCHITECTURE.md](ARCHITECTURE.md), [AGENTS.md](AGENTS.md), and
[CLAUDE.md](CLAUDE.md) for the architecture and AI working agreement.
