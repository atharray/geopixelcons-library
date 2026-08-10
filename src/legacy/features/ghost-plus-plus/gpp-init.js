    // ── Ghost++ Template Overlay ──────────────────────────────────────
    // Mounts the runtime (gpp-runtime.js) into the shell (gpp-ui-shell.js)
    // and wires ingestion. Panel content is delegated to well-known render
    // functions so palette/library/progress/view-settings modules can be
    // developed independently and plugged in here without editing this file:
    //   gppRenderPositionTransform(container, template)  — collapsible section
    //   gppRenderViewSettings(container, template)        — collapsible section
    //   gppRenderPalette(container, template)              — colour panel
    //   gppRenderProgressBar(container, template)          — completion bar
    //   gppRenderTemplateLibrary(container)                 — right-panel library
    // Each is optional — if undefined, its container is left empty rather
    // than throwing, so this file works standalone while those land.
    // Lets code outside this file's own closures (namely gpp-placement.js's
    // global keyboard-shortcut handler) trigger the exact same side-panel
    // refresh a button click would, without needing its own reference into
    // `open()`'s local `refreshAll` — set once below, right after
    // `refreshAll` is declared (function declarations are hoisted, so the
    // assignment's own position inside _init_ghostPlusPlus() doesn't matter).
    let gppLastRefreshAll = null;
    const gppUiRefreshSubscribers = new Set();
    function gppSubscribeUiRefresh(listener) {
        if (typeof listener !== 'function') return () => {};
        gppUiRefreshSubscribers.add(listener);
        return () => gppUiRefreshSubscribers.delete(listener);
    }
    function gppRequestUiRefresh() {
        if (typeof gppLastRefreshAll === 'function') gppLastRefreshAll();
        gppUiRefreshSubscribers.forEach(listener => {
            try { listener(); } catch (err) { console.error('[GeoPixelcons++] Ghost++ refresh subscriber failed:', err); }
        });
    }

    // Lets code outside this file (gpp-native-shim.js's guild "Set as Ghost"/
    // native-control-redirect flows) reveal the Ghost++ panel WITHOUT ever
    // closing it. The opener button's own click handler (below) is a real
    // open/close TOGGLE, which is correct for a direct user click on the
    // button itself, but simulating a click on it from code was the actual
    // cause of a reported bug: using "Set as Ghost" from the guild Projects
    // menu while the Ghost++ panel was already open closed it instead of
    // leaving it open. This is a no-op if the panel is already open (does
    // NOT re-run open()'s own re-center-on-open logic in that case, so an
    // already-open panel is left exactly where the user put it).
    let gppLastEnsureOpen = null;
    function gppEnsureGhostPlusPlusOpen() {
        if (typeof gppLastEnsureOpen === 'function') gppLastEnsureOpen();
    }

    if (_settings.ghostPlusPlus || gpcMobileOverhaulAvailable()) {
        function gppStartGhostPlusPlus() {
        try {
            (function _init_ghostPlusPlus() {
                const modalEl = gppBuildModalShell();
                const mobileOverhaulActive = gpcMobileOverhaulAvailable();
                if (mobileOverhaulActive) {
                    modalEl.classList.add('gpp-hidden');
                    modalEl.setAttribute('aria-hidden', 'true');
                    modalEl.dataset.mobileOverhaulSuppressed = 'true';
                }
                gppLastRefreshAll = refreshAll;
                gppLastEnsureOpen = () => {
                    if (gpcMobileOverhaulAvailable()) {
                        if (typeof gppMobileOverhaulEnsureOpen === 'function') gppMobileOverhaulEnsureOpen();
                    } else if (modalEl.classList.contains('gpp-hidden')) open();
                };
                const openerRefs = gppReplaceNativeOpener(() => {
                    if (gpcMobileOverhaulAvailable()) {
                        if (typeof gppMobileOverhaulTogglePanel === 'function') gppMobileOverhaulTogglePanel();
                    } else if (modalEl.classList.contains('gpp-hidden')) open();
                    else close();
                });
                modalEl.addEventListener('click', event => {
                    if (event.target.closest('[data-gpp-action="close"]')) close();
                });

                // Every gppInject*Style() function now rewrites its <style>
                // tag's content on each call (see their own header comments)
                // instead of writing it once — this observer is what actually
                // triggers those re-writes when the site's theme changes live
                // (any toggle, from any source, ultimately flips body.dark,
                // since that's the one signal Tailwind's own dark: variants
                // key off — see CLAUDE.md). Without this, every t2()-derived
                // colour across the whole feature stays frozen at whatever
                // theme was active on first mount.
                let gppThemeRefreshQueued = false;
                function gppRefreshTheme() {
                    if (gppThemeRefreshQueued) return;
                    gppThemeRefreshQueued = true;
                    Promise.resolve().then(() => {
                        gppThemeRefreshQueued = false;
                        [gppInjectShellStyle, gppInjectPaletteStyle, gppLibraryInjectStyle,
                            gppInjectPlacementStyle, gppInjectViewSettingsStyle].forEach(fn => {
                            if (typeof fn === 'function') {
                                try { fn(); } catch (err) { console.error('[GeoPixelcons++] Ghost++ theme refresh failed.', err); }
                            }
                        });
                        // Re-render visible panel content too, since gpp-scan.js's
                        // progress bar (and any other inline-styled elements) only
                        // pick up fresh t2() values when they rebuild, not from a
                        // stylesheet.
                        if (!modalEl.classList.contains('gpp-hidden') && runtimeReady) refreshAll();
                    });
                }
                new MutationObserver(gppRefreshTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

                // The MutationObserver above only catches changes to body's
                // own class attribute. core.js's isDarkMode() (which t2()
                // calls through) ALSO reads a separate signal first — the
                // "GeoPixels++" script's own theme choice, stored under
                // localStorage['geo++_settings'] — and that script may not
                // touch body.dark at all when the user switches it. Same-tab
                // localStorage writes never fire the 'storage' event either
                // (that only fires in OTHER tabs), so there is no reliable
                // change signal to listen for here — poll isDarkMode()'s
                // actual return value instead and refresh whenever it flips,
                // regardless of which theme source caused the flip.
                let gppLastKnownDark = isDarkMode();
                setInterval(() => {
                    const nowDark = isDarkMode();
                    if (nowDark !== gppLastKnownDark) {
                        gppLastKnownDark = nowDark;
                        gppRefreshTheme();
                    }
                }, 1000);

                let runtimeReady = null;

                function ensureRuntime() {
                    if (!runtimeReady) runtimeReady = gppInitRuntime().then(state => {
                        // gppShimEnable() is unconditional and re-entrant-safe, so it's
                        // fine to call every time the runtime becomes ready.
                        if (typeof gppShimEnable === 'function') gppShimEnable();
                        // Same self-guarding reasoning — gppEnsureAutoscanHook() only
                        // wraps placePixelAt once and gppScheduleAutoscan() itself
                        // checks gppSettings.autoscanEnabled, so installing the hook
                        // unconditionally here is safe even when autoscan is off.
                        if (typeof gppEnsureAutoscanHook === 'function') gppEnsureAutoscanHook();
                        // Rewires the guild menu's "Set as Ghost" button into Ghost++'s
                        // own ingestion pipeline instead of the native ghost tool —
                        // needs gppState, hence installed here rather than at script load.
                        if (typeof gppEnsureGuildProjectHook === 'function') gppEnsureGuildProjectHook();
                        return state;
                    }).catch(err => {
                        runtimeReady = null;
                        throw err;
                    });
                    return runtimeReady;
                }

                async function open() {
                    if (gpcMobileOverhaulAvailable()) {
                        if (typeof gppMobileOverhaulEnsureOpen === 'function') gppMobileOverhaulEnsureOpen();
                        return;
                    }
                    modalEl.classList.remove('gpp-hidden');
                    modalEl.setAttribute('aria-hidden', 'false');
                    // Always re-center on open, discarding any left/top a
                    // previous drag left behind as an inline style — the
                    // modal DOM node persists across close/reopen (only the
                    // .gpp-hidden class toggles), so without this it would
                    // silently keep reopening wherever it was last dragged to.
                    // getBoundingClientRect() forces the layout needed to read
                    // real dimensions immediately after unhiding it.
                    const modalRect = modalEl.getBoundingClientRect();
                    modalEl.style.left = Math.max(0, (window.innerWidth - modalRect.width) / 2) + 'px';
                    modalEl.style.top = Math.max(0, (window.innerHeight - modalRect.height) / 2) + 'px';
                    modalEl.style.right = 'auto';
                    const body = document.getElementById('gpp-left-body');
                    // Build the shell (drop zone + every section container)
                    // ONCE ever, not on every open — see ensureShellBuilt's
                    // own comment for why this matters far beyond avoiding
                    // wasted DOM work.
                    ensureShellBuilt();
                    // Run one refreshAll() pass IMMEDIATELY, instead of
                    // blocking behind a blank "Loading…" placeholder until
                    // the full template library (gpp-runtime.js's
                    // gppInitRuntime -> gppLoadTemplateLibrary, which decodes
                    // every shared/private template) finishes — that decode
                    // is already running in the background from page load
                    // (gpp-renderer.js's auto-mount also awaits it), so on a
                    // slow/first open the modal used to sit on "Loading…" for
                    // however much of it was still outstanding. Every
                    // gppRender* function already tolerates template=null
                    // (gppState.getFocusedTemplate() safely returns null
                    // while gppTemplates is still empty), so this first pass
                    // just renders each section's normal empty state — real
                    // content replaces it via the second refreshAll() call
                    // below the moment the runtime actually finishes. Skipped
                    // once the runtime has ALREADY finished (every open after
                    // the first) — it would otherwise render the exact same
                    // content the refreshAll() below is about to render again
                    // a moment later, for nothing; with a real-sized library
                    // (tens of templates) that redundant full re-render was a
                    // large, pointless chunk of the "reopening feels slow"
                    // complaint on top of the listener leak above.
                    if (!gppState.runtimeReady) refreshAll();
                    try {
                        await ensureRuntime();
                        refreshAll();
                    } catch (err) {
                        body.innerHTML = '';
                        const errorEl = document.createElement('p');
                        errorEl.style.cssText = 'font-size:12px; color:#ef4444;';
                        errorEl.textContent = 'Ghost++ failed to start: ' + (err && err.message ? err.message : String(err));
                        body.appendChild(errorEl);
                        console.error('[GeoPixelcons++] Ghost++ runtime init failed:', err);
                    }
                }

                function close() {
                    modalEl.classList.add('gpp-hidden');
                    modalEl.setAttribute('aria-hidden', 'true');
                }

                // Builds the shell (drop zone + every section container) the
                // FIRST time open() runs, and never again afterward (checked
                // via #gpp-drop-zone's own presence) — previously this wiped
                // and rebuilt #gpp-left-body's entire innerHTML on EVERY
                // open(), which meant #gpp-palette-section (and every other
                // section container) was a brand-new DOM node each time.
                // That defeated gpp-palette.js's own gppPaletteControllers
                // WeakMap (keyed by container — a new container is always a
                // cache miss), forcing gppCreatePaletteController to run
                // fresh on every single open and re-register its 4
                // document-level listeners (two dismiss-on-outside-click,
                // one drag-end, one contextmenu) — accumulating forever with
                // no matching removeEventListener, since the OLD container
                // (and its now-detached listeners' closures) just leaked
                // instead of being cleaned up. With a real personal library
                // (tens of templates, so a non-trivial gppRenderTemplateLibrary/
                // gppCreatePaletteController cost per rebuild too), a handful
                // of reopens was enough for this to be genuinely felt as
                // "opening got slow". Keeping the same container nodes
                // across opens lets that WeakMap cache actually do its job —
                // the controller (and its listeners) are now built once per
                // page load, not once per open.
                function ensureShellBuilt() {
                    if (document.getElementById('gpp-drop-zone')) return;
                    const body = document.getElementById('gpp-left-body');
                    body.innerHTML = `
                        <div id="gpp-drop-zone">
                            <div><strong>Drop, paste, or click to choose template files</strong></div>
                            <div class="gpp-muted" style="font-size:11px;">PNG, JPEG/JFIF, WebP, or .json (export) supported</div>
                            <button type="button" id="gpp-url-upload-btn">or load from a URL</button>
                            <input id="gpp-file-input" type="file" accept="image/png,image/jpeg,image/jfif,image/webp,application/json,.json" multiple style="display:none;">
                        </div>
                        <div id="gpp-ingest-status" class="gpp-muted" style="font-size:11px; min-height:14px;"></div>
                        <div id="gpp-progress-section"></div>
                        <div id="gpp-error-settings-section"></div>
                        <div id="gpp-view-settings-section"></div>
                        <div id="gpp-palette-section"></div>
                    `;
                    wireDropZone();
                }

                function refreshAll() {
                    const template = gppState.getFocusedTemplate();

                    // Single choke point every state-changing action already flows through
                    // (ingest, focus change, mask/colour toggle, position edit, transform all
                    // end in onChange() -> refreshAll()), so this one guarded call is enough to
                    // keep the native-ghost mirror in sync without touching every caller site.
                    // Must run unconditionally, even while Mobile Overhaul owns the UI --
                    // unlike everything below, this is a real cross-cutting side effect,
                    // not desktop-panel rendering.
                    if (typeof gppShimSyncFocusedTemplate === 'function') gppShimSyncFocusedTemplate();

                    // While Mobile Overhaul owns the painting UI, this modal is
                    // gpp-hidden and its own open() is never called (it
                    // short-circuits straight to the mobile panel instead) -- so
                    // nothing ever legitimately reads this modal's rendered DOM.
                    // gppRequestUiRefresh() (gpp-init.js's own subscriber list,
                    // fed by essentially every state-changing action: colour
                    // changes, placement commits, autoscan ticks, palette edits)
                    // still called gppLastRefreshAll() = this function unconditionally,
                    // meaning EVERY one of those triggers -- which can fire many
                    // times a second during active painting/pan/zoom -- was fully
                    // rebuilding the entire invisible desktop panel: progress bar,
                    // error settings, view settings, the whole colour palette, the
                    // ENTIRE template library grid (with per-template thumbnail
                    // rendering), and position/transform. This was pure wasted
                    // work on every refresh, confirmed as the largest identified
                    // cost behind "even on PC" mobile performance complaints --
                    // mobile was silently paying for a full desktop re-render on
                    // top of its own. Bail out before any of it.
                    //
                    // Checked live (modalEl.dataset), NOT the mobileOverhaulActive
                    // const captured once above -- gppMobileRestoreDesktopFallback()
                    // (mobile-overhaul-bootstrap.js) can un-suppress this same
                    // modal and hand control back to the desktop UI mid-session if
                    // the mobile controller crashes after already starting. A
                    // stale "was mobile active at Ghost++ init time" flag would
                    // permanently strand refreshAll() in skip-mode even after that
                    // fallback restored desktop rendering.
                    if (modalEl.dataset.mobileOverhaulSuppressed === 'true') return;

                    const editingLabel = document.getElementById(GPP_IDS.editingLabel);
                    if (!template) {
                        editingLabel.textContent = '';
                    } else if (template.position) {
                        editingLabel.textContent = template.name + ' — X: ' + template.position.gridX + ', Y: ' + template.position.gridY;
                    } else {
                        editingLabel.textContent = template.name + ' — not placed';
                    }

                    const progressContainer = document.getElementById('gpp-progress-section');
                    if (typeof gppRenderProgressBar === 'function' && progressContainer) {
                        gppRenderProgressBar(progressContainer, template, refreshAll);
                    }
                    const errorSettingsContainer = document.getElementById('gpp-error-settings-section');
                    if (typeof gppRenderErrorSettings === 'function' && errorSettingsContainer) {
                        gppRenderErrorSettings(errorSettingsContainer, template, refreshAll);
                    }
                    const vsContainer = document.getElementById('gpp-view-settings-section');
                    if (typeof gppRenderViewSettings === 'function' && vsContainer) {
                        gppRenderViewSettings(vsContainer, template, refreshAll);
                    }
                    const paletteContainer = document.getElementById('gpp-palette-section');
                    if (typeof gppRenderPalette === 'function' && paletteContainer) {
                        gppRenderPalette(paletteContainer, template, refreshAll);
                    }
                    const libraryContainer = document.getElementById(GPP_IDS.rightContent);
                    if (typeof gppRenderTemplateLibrary === 'function' && libraryContainer) {
                        gppRenderTemplateLibrary(libraryContainer, refreshAll);
                    }
                    // Position/Transform now renders INSIDE the library panel's
                    // "current template" section (gpp-lib-current) rather than
                    // its own top-level shell section — see gpp-library.js's
                    // gppRenderTemplateLibrary, which is what actually creates
                    // gpp-lib-current-pt, so this call must come after the one
                    // above, not in its old spot right after Error Settings.
                    const ptContainer = document.getElementById(GPP_LIB_CURRENT_PT_ID);
                    if (typeof gppRenderPositionTransform === 'function' && ptContainer) {
                        gppRenderPositionTransform(ptContainer, template, refreshAll);
                    }
                }

                function setIngestStatus(text, isError) {
                    const el = document.getElementById('gpp-ingest-status');
                    if (!el) return;
                    el.textContent = text;
                    el.style.color = isError ? '#ef4444' : '';
                }

                async function ingestFileList(files) {
                    const list = Array.from(files || []);
                    for (const file of list) {
                        try {
                            if (file.type === 'application/json' || /\.json$/i.test(file.name || '')) {
                                const created = await gppState.ingestJsonFile(file, (fraction, label) => {
                                    setIngestStatus((label || 'Importing') + ' — ' + file.name + ' (' + Math.round(fraction * 100) + '%)');
                                });
                                setIngestStatus('Imported ' + created.length + (created.length === 1 ? ' template' : ' templates') + ' from ' + file.name + '.');
                                continue;
                            } else if (gppState.acceptedImageTypes.includes(file.type)) {
                                await gppState.ingestImageFile(file, (fraction, label) => {
                                    setIngestStatus((label || 'Importing') + ' — ' + file.name + ' (' + Math.round(fraction * 100) + '%)');
                                });
                            } else {
                                setIngestStatus('Skipped ' + (file.name || 'file') + ': unsupported type.', true);
                                continue;
                            }
                            setIngestStatus('Imported ' + file.name + '.');
                        } catch (err) {
                            setIngestStatus('Failed to import ' + (file.name || 'file') + ': ' + (err && err.message ? err.message : String(err)), true);
                            console.error('[GeoPixelcons++] Ghost++ ingest failed:', err);
                        }
                    }
                    refreshAll();
                }

                // ---- URL upload (shares the drop zone's own ingest pipeline) ----
                // Mirrors the legacy Ghost Template Manager's own "Load from URL" button
                // (ghost-template-manager.js's handleUrlUpload), reusing the same
                // GM_xmlhttpRequest bypass for CORS/CSP (already granted, plus @connect *,
                // in header.js) -- but funnels the result through THIS feature's own
                // ingestFileList() instead of duplicating its per-type dispatch/status/
                // error handling.
                const GPP_URL_EXT_TO_MIME = {
                    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                    jfif: 'image/jfif', webp: 'image/webp', json: 'application/json',
                };

                function gppFetchBlobViaGM(url) {
                    return new Promise((resolve, reject) => {
                        if (typeof GM_xmlhttpRequest !== 'function') {
                            reject(new Error('URL upload is unavailable (GM_xmlhttpRequest is missing).'));
                            return;
                        }
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: url,
                            responseType: 'blob',
                            onload: response => {
                                if (response.status >= 200 && response.status < 300) {
                                    resolve(response.response);
                                } else {
                                    reject(new Error('HTTP ' + response.status + (response.statusText ? ' ' + response.statusText : '')));
                                }
                            },
                            onerror: () => reject(new Error('Network error while fetching the URL.')),
                            ontimeout: () => reject(new Error('Request timed out.')),
                        });
                    });
                }

                function gppInferTypeFromUrl(url) {
                    try {
                        const match = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname);
                        if (match) return GPP_URL_EXT_TO_MIME[match[1].toLowerCase()] || null;
                    } catch (err) { /* invalid URL -- handled by the caller's own dispatch check */ }
                    return null;
                }

                function gppDeriveFilenameFromUrl(url, mimeType) {
                    let name = '';
                    try {
                        name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
                    } catch (err) { /* falls through to the default name below */ }
                    if (!name) name = 'url-upload';
                    const ext = Object.keys(GPP_URL_EXT_TO_MIME).find(key => GPP_URL_EXT_TO_MIME[key] === mimeType);
                    if (ext && !new RegExp('\\.' + ext + '$', 'i').test(name)) name += '.' + ext;
                    return name;
                }

                async function ingestFromUrl(rawUrl) {
                    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
                    setIngestStatus('Fetching ' + url + '…');
                    let blob;
                    try {
                        blob = await gppFetchBlobViaGM(url);
                    } catch (err) {
                        setIngestStatus('Failed to fetch URL: ' + (err && err.message ? err.message : String(err)), true);
                        console.error('[GeoPixelcons++] Ghost++ URL ingest fetch failed:', err);
                        return;
                    }
                    // blob.type can carry a trailing parameter (e.g. a real
                    // JSON API responding with 'application/json;
                    // charset=utf-8') that would otherwise defeat the exact
                    // equality/includes() checks below even though the type
                    // itself is perfectly usable.
                    let mimeType = (blob.type || '').split(';')[0].trim().toLowerCase();
                    if (mimeType !== 'application/json' && !gppState.acceptedImageTypes.includes(mimeType)) {
                        mimeType = gppInferTypeFromUrl(url) || mimeType;
                    }
                    if (mimeType !== 'application/json' && !gppState.acceptedImageTypes.includes(mimeType)) {
                        setIngestStatus('Could not tell what that URL points to — make sure it ends in .png/.jpg/.jpeg/.webp/.json or the server sends a matching Content-Type.', true);
                        return;
                    }
                    const file = new File([blob], gppDeriveFilenameFromUrl(url, mimeType), { type: mimeType });
                    await ingestFileList([file]);
                }

                function handleUrlUploadClick(event) {
                    event.stopPropagation(); // the drop zone itself also has a click -> file-picker handler
                    const input = prompt('Enter an image or .json template URL:');
                    if (!input) return;
                    const trimmed = input.trim();
                    if (!trimmed) return;
                    ingestFromUrl(trimmed);
                }

                function wireDropZone() {
                    const dropZone = document.getElementById('gpp-drop-zone');
                    const fileInput = document.getElementById('gpp-file-input');
                    document.getElementById('gpp-url-upload-btn').addEventListener('click', handleUrlUploadClick);
                    dropZone.addEventListener('click', () => fileInput.click());
                    fileInput.addEventListener('change', () => {
                        ingestFileList(fileInput.files);
                        fileInput.value = '';
                    });
                    dropZone.addEventListener('dragover', event => {
                        if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
                        event.preventDefault();
                        dropZone.classList.add('gpp-dragging');
                    });
                    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('gpp-dragging'));
                    dropZone.addEventListener('drop', event => {
                        if (!event.dataTransfer || !event.dataTransfer.files.length) return;
                        event.preventDefault();
                        dropZone.classList.remove('gpp-dragging');
                        ingestFileList(event.dataTransfer.files);
                    });
                    modalEl.addEventListener('paste', event => {
                        if (!event.clipboardData) return;
                        const files = Array.from(event.clipboardData.items || [])
                            .filter(item => item.kind === 'file')
                            .map(item => item.getAsFile())
                            .filter(Boolean);
                        if (files.length) ingestFileList(files);
                    });
                }

                _featureStatus.ghostPlusPlus = 'ok';
                dbgPush('Ghost++ Template Overlay initialized successfully — opener mounted' + (openerRefs && openerRefs.native ? ' next to the native ghost button' : ' (native ghost button not found synchronously — see the gpp-opener-native-button log entries above for how that was handled)') + '.', { uiComponent: 'Ghost++ Template Overlay' });
                console.log('[GeoPixelcons++] ✅ Ghost++ Template Overlay loaded');
            })();
        } catch (err) {
            _featureStatus.ghostPlusPlus = 'error';
            dbgPush(`Ghost++ Template Overlay init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Ghost++ Template Overlay' });
            console.error('[GeoPixelcons++] ❌ Ghost++ Template Overlay failed:', err);
        }
        }
        // Logged unconditionally (dbgPush itself no-ops unless Enable
        // Debugging is on) so a user's exported debug log shows exactly
        // which branch Ghost++ took on their machine — the Firefox bug
        // report this was added for ("toggled Ghost++ on, still see the
        // old menu") turned out to be a race in gppReplaceNativeOpener
        // finding the native button, not this gate itself, but knowing
        // whether the page was even done loading yet is the first thing
        // worth checking from an exported log, before digging further.
        dbgPush('Ghost++ init: document.readyState was "' + document.readyState + '" at script-execution time — ' + (document.readyState === 'loading' ? 'waiting for DOMContentLoaded before starting.' : 'starting immediately.'), { uiComponent: 'Ghost++ Template Overlay' });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                dbgPush('Ghost++ init: DOMContentLoaded fired — starting now.', { uiComponent: 'Ghost++ Template Overlay' });
                gppStartGhostPlusPlus();
            });
        } else {
            gppStartGhostPlusPlus();
        }
    }
