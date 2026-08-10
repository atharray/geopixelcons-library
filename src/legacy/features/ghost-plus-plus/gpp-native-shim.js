    // ── Ghost++ native-ghost compatibility shim ───────────────────────
    // Lets Ghost++ own the overlay slot while keeping the *native* ghost
    // consumers (cursor sampling, error-cross rendering, the location
    // readout, guild fill/auto-place) working against the focused Ghost++
    // template instead of stale/empty state. Everything here goes through
    // gpp-bridge.js's narrow, named touch points — this file never reads or
    // writes `map`/`turf`/`Colors`/native `let` bindings directly.
    //
    // Unconditional (not a setting — assumed whenever Ghost++ itself is
    // enabled, by explicit product decision; there is no UI to turn it off
    // independently, and no restore/disable path — see gpp-bridge.js's
    // gppSetNativeFunction comment).
    //
    // Lifecycle contract:
    //   gppShimEnable()              — patch native draw fns to no-ops,
    //                                   install native-control capture
    //                                   listeners, mirror the focused template.
    //                                   Call this once Ghost++'s runtime is
    //                                   ready; re-entrant calls just resync.
    //   gppShimSyncFocusedTemplate() — refresh the mirror for whichever
    //                                   template is currently focused. Safe to
    //                                   call any time (no-ops unless the shim
    //                                   is active); call it after ANY state
    //                                   change another Ghost++ module makes
    //                                   that affects the focused template:
    //                                   focus change, mask/colour toggles,
    //                                   position edits, ingest/import of a new
    //                                   template, and core-rewriting transforms
    //                                   (flip/rotate). It internally skips
    //                                   rebuilding the (potentially large) RGBA
    //                                   mirror when the focused template's core
    //                                   (id + indices + palette identity)
    //                                   hasn't changed since the last sync, so
    //                                   rapid mask/position edits stay cheap.
    //
    // INTEGRATION NOTE FOR WHOEVER WIRES THIS UP: this file intentionally has
    // no side effects at load time (consistent with every other gpp-*.js
    // file) — nothing here runs until one of the two functions above is
    // called. The call sites below still need to be wired from elsewhere
    // (gpp-init.js / the palette+position+library modules), since this file
    // may not edit any other file:
    //   - Call `gppShimEnable()` once Ghost++'s runtime has initialized
    //     (after `gppInitRuntime()` resolves).
    //   - Call `gppEnsureGuildProjectHook()` from the same spot (it needs
    //     `gppState` to exist) to rewire the guild menu's "Set as Ghost"
    //     button (`setProjectAsGhost`) into Ghost++'s own ingestion pipeline.
    //   - Call `gppShimSyncFocusedTemplate()` from `gppFocusTemplate`'s caller
    //     after a focus change, from the palette panel after any mask/colour
    //     toggle, from the position/transform panel after a move/flip/rotate,
    //     and from the ingest flow after a new template is imported/focused.
    //
    // Native ghost state ownership: while the shim is active, Ghost++ is the
    // sole writer of `ghostImage`, `ghostImageTopLeft`, `ghostImageOriginalData`,
    // `ghostImageCanvas`, `ghostPaletteColors`, `ghostActivePaletteColors`,
    // `ghostAllImageColors`, `paletteToImageColorMap`,
    // `imageColorToDominantColorMap`, `isColorFilterDisabled`, and
    // `ghostImageFileObject` (see js/ghost22.js for their native declarations).
    // `gppReadNativeGhostSnapshot()`'s bridge surface only exposes three small
    // fields (hasGhostImage / ghostImageTopLeft / isColorFilterDisabled), so
    // this shim does not attempt to snapshot-and-restore whatever arbitrary
    // native ghost state may have existed before Ghost++ claimed the slot —
    // `gpp-ui-shell.js`'s `gppReplaceNativeOpener()` already hides the native
    // entry point for the whole time Ghost++ is enabled, so there should be no
    // independent native ghost session to preserve, and (being unconditional
    // now) nothing ever hands the slot back.
    //
    // Native localStorage (`ghostImageData` / `ghostImageCoords`) IS mirrored
    // by this file (in addition to the in-memory globals above) — third-party
    // userscripts that piggyback on the *native* ghost tool (e.g.
    // queue-ghost-color) read their ghost position/image from these
    // two keys instead of (or in addition to) the in-memory globals, exactly
    // like the legacy Ghost Template Manager's own `applyCoordinatesToGame`
    // (see ghost-template-manager.js) already writes them. Written on every
    // full mirror rebuild (`gppWriteFullNativeMirror`) and on every light
    // resync (`gppWriteLightNativeMirror`, coords only — the image data URL
    // is unchanged when only the mask/position moved), and removed on
    // `gppClearNativeMirror` so no stale snapshot lingers once Ghost++
    // releases the slot or has no focused template.
    //
    // `setProjectAsGhost` (the guild menu's "Set as Ghost" button,
    // html-snippets/guildTemplates.html) IS patched — see
    // gppInstallGuildProjectHook()/gppGuildProjectHookInstalled below — but
    // NOT through gpp-bridge.js's `gppSetNativeFunction`, since that helper's
    // `GPP_NATIVE_FN_NAMES` allowlist only covers `drawGhostImageOnCanvas`,
    // `regenerateGhostCanvas`, `initializeGhostFromStorage`. `setProjectAsGhost`
    // is invoked via an inline `onclick="setProjectAsGhost(id)"` attribute
    // rather than addEventListener on a stable element, so wrapping the
    // global function directly (same "function DECLARATION -> attaches to
    // window normally" reasoning gpp-bridge.js documents for the other three)
    // is the only viable interception point. `addGhostAsProject` and
    // `updateGuildProject` are now ALSO wrapped (see
    // gppEnsureGuildProjectSubmitHooks()/gppWrapNativeFunctionWithFreshMirror
    // below) — a real report from a guild leader ("the templates loaded onto
    // Ghost++ don't count as loaded on the default ghost template manager, so
    // I can't load them as guild projects, it shows that space empty") traced
    // to those two native functions (and populateGuildInfo()'s own project
    // preview panel, also wrapped for the same reason) reading a native
    // mirror that can be stale the first time they're read after Ghost++
    // activates. `applyGuildImageAsGhost` (a different, LOAD-direction
    // function — the guild's own "official" banner image becoming your
    // ghost, unrelated to this report) remains out of scope.

    // Page-realm temp bridge key used to hand large/complex payloads (raw RGBA
    // bytes, palette arrays) to an injected <script> so it can reconstruct
    // real page-realm `Uint8ClampedArray`/`ImageData`/`Set`/`Map` instances via
    // their own constructors — see gpp-bridge.js's `gppWriteNativeGhostMirror`
    // doc comment ("page-realm-constructible descriptors ... since ImageData
    // does not survive a naive string round-trip"). The property is written
    // right before injecting the script and deleted by that same script before
    // it finishes, so it never lingers on `window`.
    const GPP_NATIVE_MIRROR_GLOBAL = '__gppNativeMirrorPayload';

    // The native/GPC++ controls that must not be allowed to silently replace
    // Ghost++'s state while it owns the overlay slot. Matches the original
    // prototype's `installNativeControlCaptures()` list exactly (see
    // scripts/geopixels-ghost-template-overhaul/1.0.0.js ~1971-1991).
    // `loadGhostImageBtn` is already display:none'd by
    // `gppReplaceNativeOpener()`, but a hidden button can still be triggered
    // programmatically, so it stays in this list for defense in depth.
    const GPP_NATIVE_CONTROL_TARGETS = [
        ['loadGhostImageBtn', 'click'],
        ['ghostImageInput', 'change'],
        ['initiatePlaceGhostBtn', 'click'],
        ['clearGhostImageBtn', 'click'],
    ];

    let gppShimActive = false;
    let gppNativeControlCaptures = [];
    let gppGuildProjectHookInstalled = false;

    // Identity of the template core (id + the exact `indices`/`palette` typed
    // array references) currently reflected in the native RGBA mirror. Used
    // to skip the expensive per-pixel RGBA rebuild when only the mask or
    // position changed — mirrors the original design's distinction between
    // "focus changes/imports/transforms rebuild the RGBA mirror" and cheaper
    // in-place updates for everything else (see ARCHITECTURE.md's "Native
    // coexistence" section).
    let gppMirroredTemplateId = null;
    let gppMirroredIndices = null;
    let gppMirroredPalette = null;

    function gppNativeBridgeTarget() {
        return (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    }

    // Plain per-origin Web Storage — shared across the page and every
    // userscript sandbox regardless of realm, unlike the in-memory globals
    // above (see ghost-template-manager.js's `applyCoordinatesToGame`, which
    // already relies on this same direct-call working across the sandbox
    // boundary). No injected-script bridge needed here.
    function gppWriteNativeGhostLocalStorage(coords, dataUrl) {
        try {
            if (coords) localStorage.setItem('ghostImageCoords', JSON.stringify(coords));
            if (dataUrl) localStorage.setItem('ghostImageData', dataUrl);
        } catch (_) { /* storage may be unavailable (private mode, quota) */ }
    }

    function gppClearNativeGhostLocalStorage() {
        try {
            localStorage.removeItem('ghostImageCoords');
            localStorage.removeItem('ghostImageData');
        } catch (_) { /* ignore */ }
    }

    // Builds a PNG data URL from the focused template's decoded RGBA — the
    // same format native `ghost22.js` writes into `ghostImageData` (an
    // `<img>`-loadable data URL, not a raw buffer).
    function gppEncodeRgbaToDataUrl(rgba, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(rgba);
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── Native function replacements ──────────────────────────────────
    // Assigned via gppSetNativeFunction, which writes them onto the page's
    // `window`/`unsafeWindow`. Because these are ordinary JS function VALUES
    // (not source-text injected into the page), calling them from native code
    // still executes this closure in Ghost++'s own sandboxed realm — the same
    // technique gpp-bridge.js's doc comment calls out as GTM's
    // `patchGhostModalToggleForRemembering` pattern — so they can freely call
    // other gpp* functions directly.

    function gppNativeDrawReplacement() {
        // No-op: the expensive native canvas overlay must not render
        // underneath Ghost++'s own renderer while the shim owns the slot.
    }

    function gppNativeRegenerateReplacement() {
        // No-op: nothing native ever reads `ghostImageCanvas` again once
        // `drawGhostImageOnCanvas` itself is neutralized, so rebuilding the
        // offscreen filtered canvas would just be wasted work.
    }

    function gppNativeInitializeReplacement() {
        // The native page-load hook that would normally repopulate ghost
        // state from `localStorage`. Ghost++ never persists to that storage
        // (see file header), so instead of loading anything, just reassert
        // the current mirror — this is the "patched initializer reasserting
        // its takeover snapshot if invoked while ownership is active" behavior
        // ARCHITECTURE.md's Native coexistence section calls for.
        gppShimSyncFocusedTemplate();
    }

    // ── Native control interception ───────────────────────────────────

    function gppBlockNativeGhostControl(event) {
        if (!gppShimActive) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.target && event.target.id === 'ghostImageInput') {
            try { event.target.value = ''; } catch (_) { /* ignore */ }
        }
        console.warn('[GeoPixelcons++] Ghost++: native ghost control blocked while Ghost++ owns the overlay slot. Use the Ghost++ (👻) panel instead.');
        // `loadGhostImageBtn` carries real TOGGLE intent -- it's the target
        // of both a direct (now-hidden) click AND the native G keyboard
        // shortcut (performShortcutAction's 'ghost' case calls
        // loadGhostImageBtn?.click() directly), and G is meant to open OR
        // close like any other toggle key. Route it through opener.click()
        // (the opener button's own real open/close toggle) so G keeps
        // working both ways. The other three native controls in
        // GPP_NATIVE_CONTROL_TARGETS (file input change, initiate-place,
        // clear-image) carry no such toggle intent -- interacting with them
        // only ever means "show me the ghost tool", never "close it" -- so
        // they go through gppEnsureGhostPlusPlusOpen() (gpp-init.js)
        // instead, which never closes an already-open panel. A real
        // reported regression: routing ALL FOUR through
        // gppEnsureGhostPlusPlusOpen() (an earlier version of this fix)
        // broke G's close half entirely -- "G is hard overwritten and won't
        // close the menu at all... it'll open, but then not close."
        //
        // event.currentTarget (the element THIS LISTENER is attached to --
        // always one of the 4 GPP_NATIVE_CONTROL_TARGETS elements, see
        // gppInstallNativeControlCaptures), NOT event.target: this listener
        // runs in the CAPTURE phase, where event.target is still the
        // original (possibly nested) element the click actually started
        // from, not necessarily loadGhostImageBtn itself. Real production
        // triggers (performShortcutAction('ghost')'s loadGhostImageBtn?.click()
        // included) always call .click() directly on the target element
        // itself, so target===currentTarget in practice today -- but
        // currentTarget is the objectively correct, bubble-path-independent
        // way to ask "which of the 4 controls fired this," and costs
        // nothing to get right now.
        if (event.currentTarget && event.currentTarget.id === 'loadGhostImageBtn') {
            const opener = document.getElementById(GPP_IDS.opener);
            if (opener) opener.click();
        } else if (typeof gppEnsureGhostPlusPlusOpen === 'function') {
            gppEnsureGhostPlusPlusOpen();
        }
    }

    function gppInstallNativeControlCaptures() {
        gppRemoveNativeControlCaptures();
        GPP_NATIVE_CONTROL_TARGETS.forEach(pair => {
            const id = pair[0];
            const type = pair[1];
            const element = document.getElementById(id);
            if (!element) return;
            element.addEventListener(type, gppBlockNativeGhostControl, true);
            gppNativeControlCaptures.push({ element, type });
        });
    }

    function gppRemoveNativeControlCaptures() {
        gppNativeControlCaptures.forEach(entry => {
            entry.element.removeEventListener(entry.type, gppBlockNativeGhostControl, true);
        });
        gppNativeControlCaptures = [];
    }

    // ── Guild "Set as Ghost" compatibility rewire ──────────────────────
    // Native setProjectAsGhost(projectId) (js/index148.js) looks up
    // userGuildData.projects, loads project.image into the NATIVE ghost tool
    // (ghostImageOriginalData/extractAndMapColors/drawGhostImageOnCanvas), and
    // positions it at project.imageGridX/imageGridY. While Ghost++ owns the
    // overlay slot, that whole native pipeline is neutralised (see this
    // file's draw-fn replacements/control captures above), so letting it run
    // would just fight Ghost++'s own state for nothing visible. Full
    // replacement, not call-through: decode the same project data via
    // Ghost++'s EPHEMERAL path (gppState.decodeGuildTemplate,
    // gpp-guild-templates.js's own architecture) instead of a real,
    // persisted ingest — a guild project loaded this way must never be
    // written to IndexedDB either, same "changes frequently, load
    // dynamically" reasoning as the Guild Templates section itself.
    async function gppLoadGuildProjectIntoGhostPlusPlus(projectId) {
        const target = gppNativeBridgeTarget();
        // `userGuildData` is a top-level `let` in js/index148.js (see
        // gpp-bridge.js's header comment) — `target.userGuildData` (a
        // window PROPERTY read) always silently returns undefined, which is
        // the actual cause of this having always shown "Could not find the
        // selected project.": `guildData` was undefined, not merely missing
        // the requested project. gppReadNativeGuildData() reads the real
        // live binding via the page-realm eval bridge instead.
        const guildData = gppReadNativeGuildData();
        const project = guildData && Array.isArray(guildData.projects)
            ? guildData.projects.find(p => p.id === projectId)
            : null;
        if (!project) {
            if (typeof target.showAlert === 'function') target.showAlert('Error', 'Could not find the selected project.');
            return;
        }
        try {
            // gppGetOrCreateGuildTemplate (NOT gppBuildGuildTemplateStub
            // directly) — reuses the Guild Templates section's own stub for
            // this project if one already exists (e.g. the section was
            // expanded earlier), rather than creating a second object with
            // the same id sitting alongside it in gppGuildTemplates. Two
            // objects sharing an id used to be exactly how this crashed:
            // gppGetFocusedTemplate's .find() could resolve back to the
            // OTHER (still-undecoded) duplicate — see that function's own
            // comment for the full explanation.
            const template = gppState.getOrCreateGuildTemplate(project);
            await gppState.decodeGuildTemplate(template); // no-op if this entry was already decoded
            // Unlike the Guild Templates section's own opacity-0 browse
            // default, a deliberate single "Set as Ghost" click means the
            // user wants to see this NOW.
            template.opacity = 1;
            await gppState.focusTemplate(template.id); // resolves via gppGetFocusedTemplate's gppGuildTemplates fallback; never persists (see gppFocusTemplate's own ephemeral guard)
            gppShimSyncFocusedTemplate();
            // gppRequestUiRefresh() (gpp-init.js) -- without this, an
            // ALREADY-OPEN Ghost++ panel kept showing whatever template was
            // focused before, even though the guild template was correctly
            // focused and already rendering on the map itself. A real
            // reported bug: open()'s own unconditional refreshAll() only
            // runs on a closed->open transition, and
            // gppEnsureGhostPlusPlusOpen() below is deliberately a no-op
            // when the panel is already open (see its own comment) -- so
            // without an explicit refresh here, nothing ever re-rendered the
            // palette/progress/library sections for the newly focused
            // template until the user manually closed and reopened the
            // panel (which forces open()'s refresh to run again).
            if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
            // gppEnsureGhostPlusPlusOpen() (gpp-init.js), NOT opener.click()
            // -- the opener button's click handler is a real open/close
            // TOGGLE (see gpp-init.js's own comment on it), so simulating a
            // click here closed an already-open Ghost++ panel instead of
            // leaving it open -- a real reported bug ("Set as Ghost" from
            // the guild Projects menu closes Ghost++ if it's already open).
            if (typeof gppEnsureGhostPlusPlusOpen === 'function') gppEnsureGhostPlusPlusOpen();
            // Restores the native tool's own "Ghost image set." success
            // feedback (js/index.js's original setProjectAsGhost ends with
            // showAlert("Success", "Ghost image set.")) -- Ghost++'s
            // replacement pipeline above went silent on success with no
            // equivalent, which read as "did this actually work?" with
            // nothing else visibly confirming it beyond the map itself.
            if (typeof target.showAlert === 'function') target.showAlert('Success', 'Guild project loaded into Ghost++.');
        } catch (err) {
            console.error('[GeoPixelcons++] Ghost++: failed to load guild project ' + projectId + ' as a Ghost++ template.', err);
            if (typeof target.showAlert === 'function') target.showAlert('Error', 'Could not load that guild project into Ghost++.');
        }
    }

    // ── Guild "Add/Update Project" + preview compatibility rewire ──────
    // Native addGhostAsProject() and updateGuildProject(projectId)
    // (js/index.js) both gate on localStorage.getItem('ghostImageData') +
    // the in-memory ghostImageTopLeft global — the same native mirror this
    // shim already maintains for other consumers, but only rebuilt on a
    // FULL mirror rebuild (focus change/import/transform); a light resync
    // (mask/position-only edits) deliberately skips re-encoding the PNG,
    // since the pixel content itself is unchanged then (see
    // gppWriteLightNativeMirror's own comment) — correct for the steady
    // state, but leaves a real gap if nothing has forced a full sync yet for
    // the currently-focused template (e.g. very soon after Ghost++
    // activates, before any other module happened to trigger one).
    // populateGuildInfo()'s own "Preview of your current ghost image" panel
    // reads that exact same localStorage key, so the same gap shows there
    // too — a guild leader reported both symptoms together: the preview
    // showing empty, and being unable to add/update a project, while a
    // template was genuinely focused and positioned in Ghost++.
    //
    // Fix: wrap, don't replace. gppShimSyncFocusedTemplate() is cheap when
    // nothing has actually changed (it tracks whether a full rebuild already
    // ran for this exact template core via gppMirroredTemplateId/Indices/
    // Palette, and skips the costly re-encode otherwise) and correctly
    // forces one the one time it's actually needed. Calling it immediately
    // before handing off to the ORIGINAL native function guarantees
    // localStorage/ghostImageTopLeft are fresh at the exact moment these
    // functions read them — full replacement (reimplementing their fetch/
    // auth/confirmation/success-handling here, the way setProjectAsGhost's
    // LOAD direction below does) was considered and rejected: these
    // functions already do the right thing once their inputs are correct,
    // so there's nothing to improve on by rewriting them, only risk from a
    // subtly different payload or fetch/credentials behavior across the
    // sandbox/page-realm boundary.
    function gppWrapNativeFunctionWithFreshMirror(name) {
        const target = gppNativeBridgeTarget();
        const original = target[name];
        if (typeof original !== 'function' || original.__gppMirrorWrapped) return false;
        const wrapped = function (...args) {
            gppShimSyncFocusedTemplate();
            return original.apply(this, args);
        };
        wrapped.__gppMirrorWrapped = true;
        target[name] = wrapped;
        return true;
    }

    let gppGuildProjectSubmitHooksInstalled = false;
    function gppEnsureGuildProjectSubmitHooks() {
        if (gppGuildProjectSubmitHooksInstalled) return;
        const okAdd = gppWrapNativeFunctionWithFreshMirror('addGhostAsProject');
        const okUpdate = gppWrapNativeFunctionWithFreshMirror('updateGuildProject');
        const okPreview = gppWrapNativeFunctionWithFreshMirror('populateGuildInfo');
        // All three are part of the same native guild-management code block,
        // so in practice they become available together — only mark this
        // done once every one of them has actually been wrapped, matching
        // gppEnsureGuildProjectHook's own "not ready yet, next call retries"
        // reasoning below rather than partially wiring and forgetting the rest.
        if (okAdd && okUpdate && okPreview) gppGuildProjectSubmitHooksInstalled = true;
    }

    // Installed once, from the same lifecycle point as gppShimEnable() (after
    // gpp-runtime.js's runtime is ready — this wrapper needs gppState to
    // exist). Re-entrant-safe like gpp-scan.js's gppEnsureAutoscanHook().
    function gppEnsureGuildProjectHook() {
        // Independent readiness gate from setProjectAsGhost below — these are
        // a different set of native functions and may become available at a
        // slightly different time, even though in practice they're part of
        // the same native guild-management code block.
        gppEnsureGuildProjectSubmitHooks();
        if (gppGuildProjectHookInstalled) return;
        const target = gppNativeBridgeTarget();
        if (typeof target.setProjectAsGhost !== 'function') return; // not ready yet — next init call retries
        gppGuildProjectHookInstalled = true;
        target.setProjectAsGhost = function gppSetProjectAsGhostReplacement(projectId) {
            gppLoadGuildProjectIntoGhostPlusPlus(projectId);
        };
    }

    // ── Native ghost mirror builders ──────────────────────────────────

    // Resets every native ghost binding Ghost++ owns back to its empty
    // default (mirrors js/ghost22.js's own `clearGhostImage()` shape) and
    // forgets what was mirrored, so the next sync always does a full rebuild.
    function gppClearNativeMirror() {
        gppWriteNativeGhostMirror(
            'ghostImage = null;' +
            'ghostImageTopLeft = null;' +
            'ghostImageOriginalData = null;' +
            'ghostImageCanvas = null;' +
            'ghostPaletteColors = [];' +
            'ghostActivePaletteColors = new Set();' +
            'ghostAllImageColors = new Map();' +
            'paletteToImageColorMap = new Map();' +
            'imageColorToDominantColorMap = new Map();' +
            'isColorFilterDisabled = false;' +
            'ghostImageFileObject = null;'
        );
        gppClearNativeGhostLocalStorage();
        gppMirroredTemplateId = null;
        gppMirroredIndices = null;
        gppMirroredPalette = null;
    }

    // Builds the small, page-realm-safe describable pieces shared by both the
    // full and light mirror writers: one object per palette entry plus the
    // list of currently-enabled entries' rgba-string keys (the same key format
    // js/ghost22.js's native code already keys its Maps/Sets by).
    function gppBuildPaletteMirrorData(core, template) {
        const paletteColors = [];
        const activeRgba = [];
        for (let index = 0; index < template.palette.length; index++) {
            const packed = template.palette[index];
            const rgb = core.unpackRgb(packed);
            const rgbaString = core.packedToRgbaString(packed);
            const hex = core.packedToHex(packed);
            const count = template.counts[index] || 0;
            paletteColors.push({ r: rgb.r, g: rgb.g, b: rgb.b, rgba: rgbaString, hex: hex, count: count, totalCount: count });
            if (core.maskHas(template.mask, index)) activeRgba.push(rgbaString);
        }
        return { paletteColors: paletteColors, activeRgba: activeRgba };
    }

    // Full rebuild: reconstructs ghostImageOriginalData (an ImageData built
    // from the template's indexed cells + palette), ghostImageTopLeft, and
    // enough of ghostActivePaletteColors/imageColorToDominantColorMap/
    // ghostAllImageColors/isColorFilterDisabled that native cursor sampling,
    // error-cross rendering, and the location readout keep working. Used on
    // focus change, import, and any core-rewriting transform (flip/rotate).
    function gppWriteFullNativeMirror(template) {
        const core = gppCreateCore();
        const rgba = core.indexedToRgba(template.indices, template.indexType, template.palette);
        const paletteData = gppBuildPaletteMirrorData(core, template);

        const allColorsEntries = [];
        const dominantEntries = [];
        for (let index = 0; index < paletteData.paletteColors.length; index++) {
            const entry = paletteData.paletteColors[index];
            allColorsEntries.push([entry.rgba, entry.count]);
            dominantEntries.push([entry.rgba, entry.rgba]);
        }

        const target = gppNativeBridgeTarget();
        target[GPP_NATIVE_MIRROR_GLOBAL] = {
            width: template.width,
            height: template.height,
            rgbaBuffer: rgba.buffer,
            topLeft: template.position ? { gridX: template.position.gridX, gridY: template.position.gridY } : null,
            paletteColors: paletteData.paletteColors,
            activeRgba: paletteData.activeRgba,
            allColorsEntries: allColorsEntries,
            dominantEntries: dominantEntries,
        };

        gppWriteNativeGhostMirror(
            'var _p = window["' + GPP_NATIVE_MIRROR_GLOBAL + '"];' +
            'if (!_p) return;' +
            'var _bytes = new Uint8ClampedArray(_p.rgbaBuffer);' +
            'var _imageData;' +
            'try {' +
            '  _imageData = new ImageData(_bytes, _p.width, _p.height, { colorSpace: "srgb" });' +
            '} catch (e) {' +
            '  var _scratch = document.createElement("canvas").getContext("2d");' +
            '  _imageData = _scratch.createImageData(_p.width, _p.height);' +
            '  _imageData.data.set(_bytes);' +
            '}' +
            'var _paletteColors = [];' +
            'for (var _i = 0; _i < _p.paletteColors.length; _i++) {' +
            '  var _pc = _p.paletteColors[_i];' +
            '  _paletteColors.push({ r: _pc.r, g: _pc.g, b: _pc.b, rgba: _pc.rgba, hex: _pc.hex, count: _pc.count, totalCount: _pc.totalCount });' +
            '}' +
            'var _activeSet = new Set();' +
            'for (var _j = 0; _j < _p.activeRgba.length; _j++) _activeSet.add(_p.activeRgba[_j]);' +
            'var _allColors = new Map();' +
            'for (var _k = 0; _k < _p.allColorsEntries.length; _k++) _allColors.set(_p.allColorsEntries[_k][0], _p.allColorsEntries[_k][1]);' +
            'var _dominant = new Map();' +
            'for (var _m = 0; _m < _p.dominantEntries.length; _m++) _dominant.set(_p.dominantEntries[_m][0], _p.dominantEntries[_m][1]);' +
            'ghostImage = { width: _p.width, height: _p.height };' +
            'ghostImageTopLeft = _p.topLeft ? { gridX: _p.topLeft.gridX, gridY: _p.topLeft.gridY } : null;' +
            'ghostImageOriginalData = _imageData;' +
            'ghostImageCanvas = null;' +
            'ghostPaletteColors = _paletteColors;' +
            'ghostActivePaletteColors = _activeSet;' +
            'ghostAllImageColors = _allColors;' +
            'paletteToImageColorMap = new Map();' +
            'imageColorToDominantColorMap = _dominant;' +
            'isColorFilterDisabled = false;' +
            // A source Blob can differ from the indexed template after header
            // stripping, quantisation, or transforms — keep this null so no
            // native moderator-only restore endpoint can submit stale pixels
            // at the current shim position (matches the original prototype's
            // reasoning verbatim).
            'ghostImageFileObject = null;' +
            'delete window["' + GPP_NATIVE_MIRROR_GLOBAL + '"];'
        );
        if (template.position) {
            const dataUrl = gppEncodeRgbaToDataUrl(rgba, template.width, template.height);
            gppWriteNativeGhostLocalStorage({ gridX: template.position.gridX, gridY: template.position.gridY }, dataUrl);
        }

        gppMirroredTemplateId = template.id;
        gppMirroredIndices = template.indices;
        gppMirroredPalette = template.palette;
    }

    // Cheap path: the focused template's core (pixels/palette) hasn't
    // changed since the last full mirror, so only refresh what a mask toggle
    // or a position move could have changed — no RGBA/ImageData rebuild.
    function gppWriteLightNativeMirror(template) {
        const core = gppCreateCore();
        const paletteData = gppBuildPaletteMirrorData(core, template);

        const target = gppNativeBridgeTarget();
        target[GPP_NATIVE_MIRROR_GLOBAL] = {
            topLeft: template.position ? { gridX: template.position.gridX, gridY: template.position.gridY } : null,
            paletteColors: paletteData.paletteColors,
            activeRgba: paletteData.activeRgba,
        };

        gppWriteNativeGhostMirror(
            'var _p = window["' + GPP_NATIVE_MIRROR_GLOBAL + '"];' +
            'if (!_p) return;' +
            'var _paletteColors = [];' +
            'for (var _i = 0; _i < _p.paletteColors.length; _i++) {' +
            '  var _pc = _p.paletteColors[_i];' +
            '  _paletteColors.push({ r: _pc.r, g: _pc.g, b: _pc.b, rgba: _pc.rgba, hex: _pc.hex, count: _pc.count, totalCount: _pc.totalCount });' +
            '}' +
            'var _activeSet = new Set();' +
            'for (var _j = 0; _j < _p.activeRgba.length; _j++) _activeSet.add(_p.activeRgba[_j]);' +
            'ghostImageTopLeft = _p.topLeft ? { gridX: _p.topLeft.gridX, gridY: _p.topLeft.gridY } : null;' +
            'ghostPaletteColors = _paletteColors;' +
            'ghostActivePaletteColors = _activeSet;' +
            'isColorFilterDisabled = false;' +
            'delete window["' + GPP_NATIVE_MIRROR_GLOBAL + '"];'
        );
        if (template.position) {
            gppWriteNativeGhostLocalStorage({ gridX: template.position.gridX, gridY: template.position.gridY }, null);
        }
    }

    // ── Public shim lifecycle ─────────────────────────────────────────

    // Refreshes the native mirror for whichever template is currently
    // focused. Safe to call at any time from any Ghost++ module — it is a
    // no-op unless the shim is active. See the file header for the full list
    // of state changes that should trigger a call to this function.
    function gppShimSyncFocusedTemplate() {
        if (!gppShimActive) return;
        const template = gppState.getFocusedTemplate();
        if (!template) {
            gppClearNativeMirror();
            return;
        }
        const sameCore = template.id === gppMirroredTemplateId
            && template.indices === gppMirroredIndices
            && template.palette === gppMirroredPalette;
        if (sameCore) {
            gppWriteLightNativeMirror(template);
        } else {
            gppWriteFullNativeMirror(template);
        }
    }

    // Snapshot + patch: neutralises the native draw path and installs the
    // native-control capture listeners, then mirrors the focused template.
    // Unconditional (not a setting — assumed whenever Ghost++ itself is
    // enabled, by explicit product decision); re-entrant calls just resync
    // instead of double-patching.
    // ── "Y" (toggle ghost image) compatibility ─────────────────────────
    // The separate GeoPixels++ addon has its own "Toggle ghost image"
    // keybind (default key Y, scripts/geopixels++/0.7.0.js's
    // KEY_BINDINGS.toggleGhost) that directly toggles the NATIVE
    // #ghost-canvas element's `hidden` attribute. It has no knowledge of
    // Ghost++'s own, completely separate renderer canvas
    // (gpp-renderer.js's #gpp-renderer-canvas) — so while Ghost++ owns the
    // overlay slot, pressing Y was toggling visibility on a canvas that
    // gppNativeDrawReplacement above has already made permanently empty,
    // with zero visible effect on the overlay the user actually sees.
    // Mirror the same hidden/shown state onto Ghost++'s own renderer
    // canvas instead, via a MutationObserver on #ghost-canvas's own
    // `hidden` attribute, so Y keeps working as a quick "peek at the map"
    // toggle without touching any per-template opacity setting.
    let gppNativeGhostCanvasObserver = null;
    function gppSyncRendererVisibility(nativeHidden) {
        const renderer = document.getElementById(GPP_RENDERER_CANVAS_ID);
        if (renderer) renderer.style.display = nativeHidden ? 'none' : '';
    }
    function gppInstallGhostCanvasVisibilitySync() {
        if (gppNativeGhostCanvasObserver) return; // already installed
        const attach = nativeCanvas => {
            gppSyncRendererVisibility(nativeCanvas.hidden);
            gppNativeGhostCanvasObserver = new MutationObserver(() => gppSyncRendererVisibility(nativeCanvas.hidden));
            gppNativeGhostCanvasObserver.observe(nativeCanvas, { attributes: true, attributeFilter: ['hidden'] });
        };
        const nativeCanvas = document.getElementById('ghost-canvas');
        if (nativeCanvas) {
            attach(nativeCanvas);
            return;
        }
        // #ghost-canvas is normally part of the static base HTML (present
        // from page load, same as #pixel-canvas) so this branch should be
        // rare — same defensive reasoning as gppReplaceNativeOpener's own
        // retry, though: no reason to assume it can never lose the race.
        // document.body (not map.getContainer()) since the map/renderer
        // may not have mounted yet at this point either.
        const observer = new MutationObserver(() => {
            const found = document.getElementById('ghost-canvas');
            if (!found) return;
            observer.disconnect();
            attach(found);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function gppShimEnable() {
        if (gppShimActive) {
            // Re-scan on re-entry so controls that mounted after the first
            // call receive the same capture-phase protection. The installer
            // removes existing captures before adding the current set.
            gppInstallNativeControlCaptures();
            gppShimSyncFocusedTemplate();
            return;
        }
        gppShimActive = true;
        gppSetNativeFunction('drawGhostImageOnCanvas', gppNativeDrawReplacement);
        gppSetNativeFunction('regenerateGhostCanvas', gppNativeRegenerateReplacement);
        gppSetNativeFunction('initializeGhostFromStorage', gppNativeInitializeReplacement);
        gppInstallNativeControlCaptures();
        gppInstallGhostCanvasVisibilitySync();
        // One-time cleanup: a native ghost image (loaded via the native tool
        // itself, or via the legacy Ghost Template Manager driving that same
        // native tool) may already be painted on the native ghost-canvas from
        // before Ghost++ took over. gppNativeDrawReplacement is a no-op from
        // here on, so without this it would stay stuck on screen forever.
        gppClearNativeGhostCanvasPaint();
        try {
            const nativeSnapshot = gppReadNativeGhostSnapshot();
            if (nativeSnapshot && nativeSnapshot.hasGhostImage) {
                console.warn('[GeoPixelcons++] Ghost++: a native ghost image was already active; Ghost++ is taking over the overlay slot.');
            }
        } catch (_) { /* diagnostic only */ }
        gppShimSyncFocusedTemplate();
    }
