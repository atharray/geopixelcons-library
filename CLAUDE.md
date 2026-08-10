# Claude Instructions

Read [AGENTS.md](AGENTS.md) first; it is the shared working agreement for all
coding agents.

This repository is the large, versioned GeoPixelcons feature bundle. Preserve
the `GeoPixelconsLibrary.boot()` boundary and the legacy private IIFE inside it.
The companion `geopixelcons-plusplus` repository owns the tiny userscript
metadata shell and SRI-pinned `@require` URL.

When using Git, work only in an internal `feature/<name>` branch. You may make
normal Git changes there—including commits, pushes, and PR creation—but never
write to `main`, force-push, merge a PR, or change/delete tags. Run `npm run
verify` before committing runtime or release changes.
