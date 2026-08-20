    // ── Ghost++ page-realm bridge ─────────────────────────────────────
    // GeoPixels keeps map/grid/palette/native-ghost state in top-level lexical
    // `let` bindings, which are invisible to `window`/`unsafeWindow` property
    // access. Every other GPC++ feature that needs one of these bindings goes
    // through the same two techniques already proven in this codebase:
    //   - READ: `(0, eval)('name')` first (works when Tampermonkey runs us with
    //     enough page-realm visibility), falling back to `unsafeWindow.eval('name')`.
    //     This is exactly core.js's `_getMapRef()` pattern, generalized.
    //   - WRITE (and any statement more complex than a read): inject a `<script>`
    //     tag whose textContent runs the assignment in the page's own realm, then
    //     remove it. This is ghost-palette-search.js's `commitGhostPaletteChanges`
    //     technique. Direct `unsafeWindow.eval('x = 1')` writes are NOT used here
    //     because they are unreliable across browsers/Tampermonkey configurations;
    //     script injection is the cross-browser-tested approach in this codebase.
    //
    // Ghost++ itself runs entirely in the normal Tampermonkey sandbox, like every
    // other GPC++ feature — it does not serialize its own UI/renderer/state into
    // the page realm the way the original standalone 1.0.0.js did. Only these
    // narrow, named touch points cross the realm boundary.

    function gppEvalPageExpr(expr) {
        try {
            const value = (0, eval)(expr);
            if (value !== undefined) return value;
        } catch (_) { /* fall through */ }
        if (typeof unsafeWindow !== 'undefined') {
            try { return unsafeWindow.eval(expr); } catch (_) { /* fall through */ }
        }
        return undefined;
    }

    function gppGetMap() {
        const m = gppEvalPageExpr('map');
        return (m && typeof m.project === 'function') ? m : null;
    }

    // map.getContainer() (native #map) is `position: relative` but its own
    // z-index is `auto` -- it does NOT establish a CSS stacking context. Any
    // positioned, z-indexed element appended inside it (Ghost++'s renderer
    // canvas, gpp-scan.js's error-overlay canvas, or anything future code
    // appends there) therefore does not stay visually contained within
    // #map's own slot in the page's stacking order -- it "leaks" out to
    // compete directly against #map's OWN siblings, e.g. #controls-right
    // (which the native page gives an explicit `z-0`/z-index:0). Since a
    // plain z-index:1 canvas then numerically beats #controls-right's 0,
    // the ghost overlay/error layer rendered visibly ON TOP of the native
    // toolbar buttons under controls-right -- a real user report, confirmed
    // by testing directly against the live site. The fix is at the root:
    // give #map itself a real (non-auto) z-index so it becomes its own
    // stacking context, fully containing everything appended inside it
    // regardless of that content's own z-index value -- confirmed by
    // testing that even a z-index:9999 probe stays contained once this
    // runs. Idempotent and safe to call from every mount site that appends
    // into the map container; setting the same value again is a no-op.
    function gppEnsureMapContainerContainsStacking(map) {
        try {
            const container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
            if (container && container.style.zIndex !== '0') container.style.zIndex = '0';
        } catch (_) { /* never let this be the reason Ghost++ fails to mount */ }
    }

    function gppGetTurf() {
        const t = gppEvalPageExpr('turf');
        return (t && typeof t.toWgs84 === 'function') ? t : null;
    }

    // Single round-trip read of every small page-realm value Ghost++ needs on a
    // steady-state basis. Cheap to call often; callers should still avoid calling
    // it inside a per-pixel/per-frame loop.
    function gppReadGridConstants() {
        const raw = gppEvalPageExpr(
            '({' +
            'gridSize: (typeof gridSize !== "undefined" ? gridSize : 25),' +
            'halfSize: (typeof halfSize !== "undefined" ? halfSize : 12.5),' +
            'minZoom: (typeof minZoom !== "undefined" ? minZoom : 10.5),' +
            'tileSize: (typeof SYNC_TILE_SIZE !== "undefined" ? SYNC_TILE_SIZE : 1000),' +
            'offsetMetersX: (typeof offsetMetersX !== "undefined" ? offsetMetersX : 0),' +
            'offsetMetersY: (typeof offsetMetersY !== "undefined" ? offsetMetersY : 0)' +
            '})'
        );
        return raw || { gridSize: 25, halfSize: 12.5, minZoom: 10.5, tileSize: 1000, offsetMetersX: 0, offsetMetersY: 0 };
    }

    // Returns the account's current palette as [{hex, index, owned}]. `Colors`
    // is replaced wholesale on login with the account's purchased colours
    // (index148.js), so this must be re-read each time it's needed rather than
    // cached at startup.
    function gppReadGamePalette() {
        const raw = gppEvalPageExpr(
            '(function(){' +
            'if (typeof Colors === "undefined" || !Array.isArray(Colors)) return null;' +
            'var active = (typeof activeColors !== "undefined" && Array.isArray(activeColors)) ? activeColors : [];' +
            'var activeSet = {};' +
            'for (var i = 0; i < active.length; i++) activeSet[active[i]] = true;' +
            'var out = [];' +
            'for (var j = 0; j < Colors.length; j++) out.push({ hex: Colors[j], index: j, active: !!activeSet[j] });' +
            'return out;' +
            '})()'
        );
        return raw || [];
    }

    // Returns the exact ordered list of hex values the native
    // .control-container-colors palette actually renders -- activeColors
    // mapped through Colors, in the SAME order js/index151.js's SetColors()
    // itself iterates (the player's own sort/arrangement, e.g. via
    // sortAndSetColors() or manual reordering), not gppReadGamePalette's own
    // Colors-catalog-index order. Used by mobile-painting.js's Painting Menu
    // Overhaul to mirror the player's manually-curated palette faithfully
    // when "Use manual palette" is on, rather than approximating it by
    // filtering gppReadGamePalette()'s rows (which would drop the player's
    // own ordering).
    function gppReadActiveColorOrder() {
        const raw = gppEvalPageExpr(
            '(function(){' +
            'if (typeof Colors === "undefined" || !Array.isArray(Colors)) return null;' +
            'var active = (typeof activeColors !== "undefined" && Array.isArray(activeColors)) ? activeColors : [];' +
            'var out = [];' +
            'for (var i = 0; i < active.length; i++) { var c = Colors[active[i]]; if (c !== undefined) out.push(c); }' +
            'return out;' +
            '})()'
        );
        return Array.isArray(raw) ? raw : [];
    }

    // One bulk read of every "gridX,gridY" key currently reserved in the
    // native queue (`queuedPixels`, a page-realm `Map` — same realm-mismatch
    // reasoning as the rest of this file: a bare `let` binding, never a
    // `window` property). A single round-trip returning a plain string array
    // rather than one gppEvalPageExpr call per on-screen cell, which the
    // error-crosshair redraw loop (gpp-scan.js) would otherwise need — that
    // loop can iterate thousands of cells per redraw.
    function gppReadQueuedPixelKeys() {
        const raw = gppEvalPageExpr(
            '(typeof queuedPixels !== "undefined" && queuedPixels && typeof queuedPixels.keys === "function")' +
            ' ? Array.from(queuedPixels.keys()) : []'
        );
        return Array.isArray(raw) ? raw : [];
    }

    // Direct bitmap access into the live map's tile cache for progress/error
    // scanning. Returns null if the tile hasn't synced. `tileImageCache` is a
    // page-realm `Map`; ImageBitmap values cross the sandbox boundary by
    // reference the same way `map` itself does.
    function gppGetTileBitmap(tileX, tileY) {
        const bitmap = gppEvalPageExpr(
            '(function(){' +
            'if (typeof tileImageCache === "undefined") return null;' +
            'var entry = tileImageCache.get("' + tileX + ',' + tileY + '");' +
            'return (entry && entry.colorBitmap) ? entry.colorBitmap : null;' +
            '})()'
        );
        return bitmap || null;
    }

    // Returns the native guild menu's `userGuildData` object (or null),
    // freshly re-read every call — same "must be re-read, never cached"
    // reasoning as gppReadGamePalette, since `userGuildData` is reassigned
    // wholesale (not mutated) whenever the guild modal repopulates or the
    // user leaves/joins a guild (js/index148.js). Used by
    // gpp-native-shim.js's guild "Set as Ghost" rewire, which previously
    // read this via `unsafeWindow.userGuildData` (a `let` binding, so that
    // property access always silently returned undefined — the actual
    // cause of its "Could not find the selected project." error).
    function gppReadNativeGuildData() {
        return gppEvalPageExpr('(typeof userGuildData !== "undefined" ? userGuildData : null)') || null;
    }

    // Returns the account's auth token + numeric user id, freshly re-read
    // every call (same realm-mismatch reasoning as gppReadNativeGuildData —
    // `tokenUser`/`userData` are both top-level `let` bindings in
    // js/index148.js). Used for authenticated fetches Ghost++ itself needs
    // to make (e.g. POST /GetMyGuildProjects for the Guild Templates
    // section), mirroring the exact { Token, UserId } shape js/index148.js's
    // own fetchGuildProjects() sends.
    function gppReadNativeAuth() {
        const raw = gppEvalPageExpr(
            '({' +
            'token: (typeof tokenUser !== "undefined" ? tokenUser : null),' +
            'userId: (typeof userData !== "undefined" && userData ? userData.id : null)' +
            '})'
        );
        return raw || { token: null, userId: null };
    }

    // Runs arbitrary statements in the page realm via a throwaway injected
    // <script> element. `code` must be a complete, self-contained statement
    // list (no return value is captured — for reads, use gppEvalPageExpr).
    function gppRunInPageRealm(code) {
        const script = document.createElement('script');
        script.textContent = '(function(){ "use strict"; ' + code + ' })();';
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }

    // ── Native ghost state snapshot / restore (for the compatibility shim) ──
    // Ghost++ mirrors only its focused template into these bindings so native
    // consumers (cursor sampling, error crosses, location readout, guild
    // actions) keep working while Ghost++ owns the overlay. See
    // gpp-runtime.js's compatibility-shim section for the mirror-building side;
    // this file only provides the raw read/write primitives.

    function gppReadNativeGhostSnapshot() {
        return gppEvalPageExpr(
            '(function(){' +
            'return {' +
            'hasGhostImage: (typeof ghostImage !== "undefined" && !!ghostImage),' +
            'ghostImageTopLeft: (typeof ghostImageTopLeft !== "undefined" ? ghostImageTopLeft : null),' +
            'isColorFilterDisabled: (typeof isColorFilterDisabled !== "undefined" ? isColorFilterDisabled : null)' +
            '};' +
            '})()'
        );
    }

    // Clears whatever is currently painted onto the native ghost overlay
    // canvas (id="ghost-canvas"). Native `drawGhostImageOnCanvas()` always
    // clearRects that canvas before deciding whether to redraw (see
    // js/ghost22.js), so once Ghost++ replaces it with a no-op
    // (gppNativeDrawReplacement), whatever the native tool — or the legacy
    // Ghost Template Manager driving that same native tool — had already
    // painted stays frozen on screen forever, since nothing ever clears it
    // again. Call once when the shim first takes over the overlay slot; the
    // no-op keeps it that way afterwards so no repeated clearing is needed.
    function gppClearNativeGhostCanvasPaint() {
        gppRunInPageRealm(
            'if (typeof ghostCanvasCtx !== "undefined" && ghostCanvasCtx && typeof ghostCanvas !== "undefined" && ghostCanvas) {' +
            'ghostCanvasCtx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height);' +
            '}'
        );
    }

    // Writes the focused Ghost++ template's RGBA ImageData, dominant-colour
    // map, active-colour set, top-left position, and filter-disabled flag into
    // the native lexical bindings so native consumers read the focused
    // template instead of stale or empty state. `payload` fields are all
    // optional; only provided fields are written. Large/complex values
    // (ImageData, Map, Set) are passed as page-realm-constructible descriptors
    // rather than serialized wholesale, since ImageData does not survive a
    // naive string round-trip.
    function gppWriteNativeGhostMirror(descriptorCode) {
        gppRunInPageRealm(descriptorCode);
    }

    // ── Native function suppression ───────────────────────────────────────
    // `drawGhostImageOnCanvas`, `regenerateGhostCanvas`, and
    // `initializeGhostFromStorage` are top-level `function` DECLARATIONS in
    // ghost22.js, which — unlike `let` bindings — attach to `window` normally,
    // so direct assignment (through `unsafeWindow` for reliability) is enough
    // to monkey-patch them; no script injection is needed for this specific
    // case. This mirrors GTM's `patchGhostModalToggleForRemembering`. No
    // restore path exists: the shim is unconditional for as long as Ghost++
    // itself is enabled (see gpp-native-shim.js), so these patches are never
    // handed back.
    const GPP_NATIVE_FN_NAMES = ['drawGhostImageOnCanvas', 'regenerateGhostCanvas', 'initializeGhostFromStorage'];

    function gppSetNativeFunction(name, replacement) {
        const target = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (GPP_NATIVE_FN_NAMES.indexOf(name) === -1) throw new Error('gppSetNativeFunction: unexpected name ' + name);
        target[name] = replacement;
    }
