# GeoPixelcons Library Agent Guide

## Purpose

This repository publishes the versioned, readable JavaScript bundle loaded by
the tiny `geopixelcons-plusplus` userscript shell. The exact committed artifact
is `dist/geopixelcons-library.js`; jsDelivr serves it from immutable stable
tags.

The current compatibility cut preserves the legacy GeoPixelcons++ private IIFE
inside `GeoPixelconsLibrary.boot()`. Do not expose its lexical state globally or
call `boot()` while the `@require` file is evaluated.

## Required checks

Run these before every commit that changes runtime code, build code, or release
automation:

```powershell
npm ci
npm run verify
```

`dist/geopixelcons-library.js` is generated. Rebuild it; do not edit it by
hand. Keep all JavaScript UTF-8 without a BOM.

## AI Git agreement

AI may inspect, test, create commits, push, and open pull requests, but only
from an internal branch named `feature/<short-description>`. After the user
has tested the immutable preview in Tampermonkey and explicitly says the
change is approved for release in the current conversation, AI may merge its
feature PR and the resulting Release Please PR through the normal protected
branch flow.

- Never commit, rebase, force-push, or push directly to `main`.
- Never delete or retarget tags; preview tags and stable tags are immutable.
- Never self-approve a required GitHub review or bypass a protection rule.
- Use conventional commits: `feat:` for a minor release, `fix:` for a patch
  release, and `chore:` or `docs:` for non-release work.
- Prefer squash merges so Release Please receives one intentional conventional
  commit message.
- Never add secrets, private tokens, or local credentials to the repository.

The PR preview workflow can create a prerelease tag without executing PR code.
The preview is the user's live-test gate, not a code-review gate. Stable
releases are created after explicit live-test approval by merging a verified
Release Please PR, except for the explicitly manual one-time `v1.0.0`
bootstrap workflow. Greasyfork upload is always manual.

## Preview tag rule

After the first stable release, `feat:` (or a `release:minor` label) yields the
next minor version; `fix:` or other work (or `release:patch`) yields the next
patch version. Each same-repository PR update creates exactly one immutable tag
in this form:

```text
v<next-version>-<feature-branch-slug>-<incrementing-number>
```

The counter starts at `1` and increases across every update of that feature
branch, even if the selected minor/patch base changes. The first PR before a
stable release uses the requested `v1.0.0` baseline.

## Live-test handoff

For a library PR, give the user the exact immutable preview tag and the
jsDelivr `@require` URL with its SHA-256 SRI suffix. The user temporarily
replaces only the `@require` line in their local Tampermonkey copy, tests on
GeoPixels, restores the normal stable pin, and reports either failure details
or explicit release approval. Never place a preview URL in Greasyfork.

## Cross-repository contract

Release this repository first. After the stable tag is public, fetch the
jsDelivr artifact, compute its SHA-256 SRI from the downloaded bytes, and then
change the shell repository's `library.require.json` in a separate feature PR.
Never use a preview tag in a public userscript.
