# Claude Instructions

Read [AGENTS.md](AGENTS.md) first; it is the shared working agreement for all
coding agents.

This repository is the large, versioned GeoPixelcons feature bundle. Preserve
the `GeoPixelconsLibrary.boot()` boundary and the legacy private IIFE inside it.
The companion `geopixelcons-plusplus` repository owns the tiny userscript
metadata shell and SRI-pinned `@require` URL.

When using Git, work only in an internal `feature/<name>` branch. You may make
normal Git changes there—including commits, pushes, and PR creation. After the
user has tested the immutable preview in Tampermonkey and explicitly approves
release in the current conversation, you may merge the feature PR and verified
Release Please PR through normal branch protection. Never write directly to
`main`, force-push, self-approve a required review, or change/delete tags. Run
`npm run verify` before committing runtime or release changes. Greasyfork
upload remains a manual user action.
