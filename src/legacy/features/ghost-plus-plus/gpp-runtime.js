    // ── Ghost++ runtime core ──────────────────────────────────────────
    // Settings, IndexedDB persistence, template state, and the ingestion
    // pipeline (file/drag/paste -> Worker -> indexed template -> stored
    // record). This is the shared state every other Ghost++ module
    // (renderer, native shim, placement, scan, palette/library UI) reads
    // and writes through the small `gppState` surface at the bottom of
    // this file — no other file should declare its own copy of `templates`,
    // `settings`, or `database`.

    const GPP_SETTINGS_KEY = 'gpGhostPlusPlusSettings.v1';
    const GPP_DB_NAME = 'GP_Ghost_Plus_Plus';
    const GPP_DB_VERSION = 1;
    const GPP_TEMPLATE_STORE = 'templates';
    const GPP_STATE_STORE = 'templateState';

    const GPP_DEFAULT_SETTINGS = Object.freeze({
        gapRatio: 0.6,         // 0-1; cell fill/gap ratio, global (all templates)
        // No modal-position memory setting — the modal always re-centers on
        // open (see gpp-init.js's open()), by explicit product decision.
        focusedTemplateId: null,
        showErrors: true,
        autoscanEnabled: false,
        hideQueuedCrosses: true,  // crosshairs over an already-queued pixel stop drawing, defaults on
        errorShape: 'x',         // 'x' | 'circle' | 'square'
        errorColor: '#dc2626',
        errorOpacity: 1,          // 0-1
        errorSizeScale: 1,        // multiplier on the base marker size
        autoHideUnfocused: true, // when true, focusing a template hides every other one — see gppApplyAutoHideUnfocused
        grayDisabledSwatches: true, // when false, a disabled palette swatch only gets the diagonal slash, no grayscale/opacity dimming — see gpp-palette.js's .gpp-palette-gray-disabled
        paletteViewMode: 'grid', // 'grid' | 'list' for the full Ghost++ menu
        compactPaletteViewMode: 'grid', // independent 'grid' | 'list' choice for the compact menu
        compactWidth: 260,       // remembered compact-menu width in layout pixels
        compactHeight: null,     // remembered compact-menu height; null keeps the automatic first-use height
        uiScale: 1,              // 0.5-1.5; whole-modal transform: scale() factor — see View Settings' "Rescale Ghost++" (gpp-view-settings.js) and gpp-ui-shell.js's --gpp-scale
    });

    let gppSettings = gppLoadSettings();
    let gppDatabase = null;
    let gppTemplates = [];          // in-memory list of { id, name, core:{indices,indexType,palette,counts,mask,width,height}, position, opacity, locked, order, scanSummary }
    let gppFocusedTemplateId = gppSettings.focusedTemplateId;
    // Guild project templates (gpp-guild-templates.js) — deliberately a
    // SEPARATE array from gppTemplates, never merged into it: they must
    // never appear in the main Templates grid or Manage Templates modal
    // (both iterate gppState.templates directly), and every template
    // object in here carries `ephemeral: true`, which gppPersistTemplateState/
    // gppPersistTemplateCore both check and refuse to write — guild
    // projects change frequently server-side and must be re-fetched fresh
    // every page load, never cached in IndexedDB. Repopulated once per
    // page session by gpp-guild-templates.js's one-shot fetch; never
    // touched anywhere else.
    let gppGuildTemplates = [];
    let gppIngestOperation = null;  // { worker, operationId, cancel() } while an import is in flight
    let gppIngestToken = 0;

    function gppLoadSettings() {
        try {
            const raw = localStorage.getItem(GPP_SETTINGS_KEY);
            if (!raw) return { ...GPP_DEFAULT_SETTINGS };
            return { ...GPP_DEFAULT_SETTINGS, ...JSON.parse(raw) };
        } catch (_) {
            return { ...GPP_DEFAULT_SETTINGS };
        }
    }

    function gppSaveSettings() {
        localStorage.setItem(GPP_SETTINGS_KEY, JSON.stringify(gppSettings));
    }

    // ── IndexedDB v2-style split: immutable core payload vs mutable state ──
    // `templates`: id, name, width, height, indexType, indices/palette/counts/mask
    // buffers, source Blob, opaquePixelCount, quantized, poorMatchPixelCount,
    // hash. Written once on import or transform (flip/rotate rewrites the core).
    // `templateState`: id, position, opacity, visible, locked, order, mask
    // (the live filter bitset — distinct from the core's initial full mask).
    // Written on every ordinary edit (toggle a colour, move, rename) without
    // touching the core payload.
    function gppOpenDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(GPP_DB_NAME, GPP_DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(GPP_TEMPLATE_STORE)) {
                    db.createObjectStore(GPP_TEMPLATE_STORE, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(GPP_STATE_STORE)) {
                    db.createObjectStore(GPP_STATE_STORE, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function gppDbGetAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = gppDatabase.transaction(storeName, 'readonly');
            const request = tx.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    function gppDbPut(storeName, record) {
        return new Promise((resolve, reject) => {
            const tx = gppDatabase.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    function gppDbDelete(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = gppDatabase.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    function gppMakeTemplateId() {
        return 'gpp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    // Decoded-fields cache for shared-library images, keyed by the shared
    // record's own `hash` — avoids re-running the indexing Worker on every
    // library (re)load for an image whose content hasn't changed. Never
    // explicitly evicted; a full page reload naturally clears it, matching
    // gpp-library.js's thumbnail-cache lifetime assumption.
    const gppLegacyDecodeCache = new Map();

    async function gppLegacyDecodeCached(image) {
        if (image.hash && gppLegacyDecodeCache.has(image.hash)) return gppLegacyDecodeCache.get(image.hash);
        const decoded = await gppDecodeImageBlob(image.blob);
        if (image.hash) gppLegacyDecodeCache.set(image.hash, decoded);
        return decoded;
    }

    // Loads every image from the legacy Ghost Template Manager's shared
    // GP_Ghost_History store and decodes each into Ghost++'s indexed
    // template model, joined against Ghost++'s OWN per-template state
    // (GPP_STATE_STORE, keyed 'legacy_'+numeric-id — the SAME store private
    // templates use, just a different id namespace) for mask/position/
    // opacity/order/visible/locked. A record with no matching state yet
    // (never touched from Ghost++ before) falls back to the position
    // decoded straight from its own image header, if any, and otherwise
    // sane defaults — exactly like a freshly-ingested private template.
    // One bad/corrupt record is logged and skipped rather than failing the
    // whole library load.
    async function gppLoadSharedLibraryTemplates(stateById) {
        const images = await gppLegacyListImages();
        // Serial, not parallel: gppIngestViaWorker's cancellation bookkeeping
        // (gppIngestToken/gppIngestOperation) is a SINGLE shared module-level
        // slot, designed for "at most one in-flight ingest, cancellable via
        // one Cancel button" — not per-call. Firing several decodes
        // concurrently (tried once, reverted) makes every earlier call's
        // captured token stop matching gppIngestToken the moment a later
        // call increments it, so its worker's onmessage guard
        // (`if (gppIngestToken !== token) return;`) silently drops every
        // message for every decode but the last one — their promises never
        // resolve, and this whole function (and therefore Ghost++'s init)
        // hangs forever whenever the shared library has more than one
        // template. Loading templates one at a time is the correctness
        // requirement here, not just an incidental original choice.
        const results = [];
        for (const image of images) {
            const templateId = 'legacy_' + image.id;
            const state = stateById.get(templateId) || {};
            try {
                const decoded = await gppLegacyDecodeCached(image);
                const core2 = gppCreateCore();
                results.push({
                    id: templateId,
                    legacySourceId: image.id,
                    name: state.name || image.name || 'Untitled template',
                    width: decoded.width,
                    height: decoded.height,
                    indexType: decoded.indexType,
                    indices: decoded.indices,
                    palette: decoded.palette,
                    counts: decoded.counts,
                    opaquePixelCount: decoded.opaquePixelCount,
                    quantized: decoded.quantized,
                    poorMatchPixelCount: decoded.poorMatchPixelCount,
                    sourceBlob: image.blob,
                    mask: state.mask ? new Uint32Array(state.mask) : core2.makeFullMask(decoded.palette.length, decoded.counts),
                    // 'position' in state (not truthiness) distinguishes "never
                    // touched by Ghost++ yet" (fall back to the image's own
                    // decoded header) from "explicitly unset" (state.position
                    // persisted as null) — a truthy check alone would let an
                    // explicit Unset silently resurrect the decoded position
                    // on the next reload, since null/undefined are equally
                    // falsy but mean very different things here.
                    position: ('position' in state) ? state.position : (decoded.position || null),
                    opacity: typeof state.opacity === 'number' ? state.opacity : 1,
                    locked: !!state.locked,
                    groupNoise: !!state.groupNoise,
                    // Shared items default to after every private template on their very
                    // first appearance (no state.order yet); an explicit drag-reorder (see
                    // gpp-library.js's gppLibraryReorderTemplates) persists a real order
                    // value afterward, same as any private template.
                    order: typeof state.order === 'number' ? state.order : (1000000 + image.id),
                    scanSummary: null,
                });
            } catch (err) {
                console.error('[GeoPixelcons++] Ghost++: failed to decode shared history image "' + (image.name || image.id) + '".', err);
            }
        }
        return results;
    }

    async function gppLoadTemplateLibrary() {
        const [cores, states] = await Promise.all([
            gppDbGetAll(GPP_TEMPLATE_STORE),
            gppDbGetAll(GPP_STATE_STORE),
        ]);
        const stateById = new Map(states.map(s => [s.id, s]));
        const templates = cores.map(core => {
            const state = stateById.get(core.id) || {};
            const core2 = gppCreateCore();
            return {
                id: core.id,
                name: state.name || core.name || 'Untitled template',
                width: core.width,
                height: core.height,
                indexType: core.indexType,
                indices: core2.makeIndexArray(core.indexType, 0, core.indices),
                palette: new Uint32Array(core.palette),
                counts: new Uint32Array(core.counts),
                opaquePixelCount: core.opaquePixelCount,
                quantized: core.quantized,
                poorMatchPixelCount: core.poorMatchPixelCount,
                sourceBlob: core.sourceBlob || null,
                mask: state.mask ? new Uint32Array(state.mask) : core2.makeFullMask(core.palette.length, core.counts),
                position: state.position || null,
                // No separate "visible" flag — opacity<=0 IS hidden, opacity>0
                // IS visible; a single mechanism, not two (see gpp-library.js's
                // vis toggle, which sets opacity directly rather than a
                // parallel boolean that could drift out of sync with it).
                opacity: typeof state.opacity === 'number' ? state.opacity : 1,
                locked: !!state.locked,
                groupNoise: !!state.groupNoise,
                order: typeof state.order === 'number' ? state.order : 0,
                scanSummary: null,
            };
        });

        // Always merged with the legacy Ghost Template Manager's shared
        // history — not an opt-in setting (see gpp-legacy-bridge.js). `templates`
        // above (this template++'s own private store) stays only as a
        // read path for anything ingested before this was unconditional;
        // every new ingest writes to the shared store instead (see
        // gppIngestImageFile/gppIngestJsonFile).
        let sharedTemplates = [];
        try {
            sharedTemplates = await gppLoadSharedLibraryTemplates(stateById);
        } catch (err) {
            // Never let a broken/unreachable shared history take the whole
            // library down — degrade to whatever private templates exist.
            console.error('[GeoPixelcons++] Ghost++: failed to load the shared legacy history.', err);
        }
        const merged = templates.concat(sharedTemplates);
        merged.sort((a, b) => a.order - b.order);
        return merged;
    }

    // Re-runs the full load (private + shared) and swaps it into the live
    // gppTemplates array.
    async function gppReloadTemplateLibrary() {
        gppTemplates = await gppLoadTemplateLibrary();
        gppNormalizeTemplateOrder();
        if (!gppTemplates.some(t => t.id === gppFocusedTemplateId)) {
            gppFocusedTemplateId = gppTemplates[0] ? gppTemplates[0].id : null;
            gppSettings.focusedTemplateId = gppFocusedTemplateId;
            gppSaveSettings();
        }
        if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
        return gppTemplates;
    }

    function gppNormalizeTemplateOrder() {
        gppTemplates.forEach((template, index) => { template.order = index; });
    }

    // Both this function and gppPersistTemplateCore below are the two
    // choke points every write path in the whole file funnels through to
    // reach IndexedDB — a single `template.ephemeral` guard here is what
    // guarantees NO code path (now or added later) can ever accidentally
    // persist a guild template, rather than needing every individual
    // caller (visibility toggle, drag-reorder, rename, Template Settings,
    // etc.) to remember to check it themselves. See gpp-guild-templates.js
    // for where ephemeral templates come from and why they must never
    // reach the database: guild projects change frequently server-side and
    // are meant to be re-fetched fresh each page load, never cached here.
    async function gppPersistTemplateState(template) {
        if (template.ephemeral) return;
        await gppDbPut(GPP_STATE_STORE, {
            id: template.id,
            name: template.name,
            position: template.position,
            opacity: template.opacity,
            locked: template.locked,
            groupNoise: !!template.groupNoise,
            order: template.order,
            mask: Array.from(template.mask),
        });
    }

    // A core-rewriting change (e.g. core.transformIndexed — no current UI
    // caller since the flip/rotate buttons were removed, but kept as a
    // generic building block) genuinely changes a shared-origin template's
    // pixel content. The shared store is content-
    // addressed (gppLegacyAddImage dedupes by hash), so writing the new
    // pixels there is necessarily a NEW record, not an update to the old
    // one — unlike a plain private-store template, which can just overwrite
    // its own row in place. Re-encoding into GPP_TEMPLATE_STORE under the
    // same id instead (the private-store path below) would silently create
    // a stale, orphaned duplicate the next time the library reloads (both
    // the real shared record and this leftover would carry the same id).
    // So: write the new shared record, migrate this template's identity
    // (id/legacySourceId) and its gppTemplates/focus bookkeeping onto it,
    // and clean up the now-superseded old shared record.
    async function gppPersistTemplateCore(template) {
        if (template.ephemeral) return; // see gppPersistTemplateState's identical guard
        if (typeof template.legacySourceId === 'number') {
            const oldId = template.id;
            const oldLegacyId = template.legacySourceId;
            const blob = await gppEncodeTemplateToPngBlob(template);
            const record = await gppLegacyAddImage(blob, template.name, !!template.groupNoise);
            template.sourceBlob = blob;
            template.id = 'legacy_' + record.id;
            template.legacySourceId = record.id;
            if (record.hash) {
                gppLegacyDecodeCache.set(record.hash, {
                    width: template.width, height: template.height, indexType: template.indexType,
                    indices: template.indices, palette: template.palette, counts: template.counts,
                    opaquePixelCount: template.opaquePixelCount, quantized: template.quantized,
                    poorMatchPixelCount: template.poorMatchPixelCount, position: template.position,
                });
            }
            if (record.id !== oldLegacyId) {
                await Promise.all([
                    gppLegacyDeleteImage(oldLegacyId),
                    gppDbDelete(GPP_STATE_STORE, oldId),
                ]);
            }
            // The old state row (position/mask/opacity/etc, keyed by oldId)
            // was just deleted above — re-persist it under the new id right
            // away rather than leaving it live only in memory until some
            // later, unrelated action happens to save it.
            await gppPersistTemplateState(template);
            const idx = gppTemplates.findIndex(t => t.id === oldId);
            if (idx !== -1) gppTemplates[idx] = template;
            if (gppFocusedTemplateId === oldId) {
                gppFocusedTemplateId = template.id;
                gppSettings.focusedTemplateId = template.id;
                gppSaveSettings();
            }
            return;
        }
        await gppDbPut(GPP_TEMPLATE_STORE, {
            id: template.id,
            name: template.name,
            width: template.width,
            height: template.height,
            indexType: template.indexType,
            indices: template.indices.buffer,
            palette: Array.from(template.palette),
            counts: Array.from(template.counts),
            opaquePixelCount: template.opaquePixelCount,
            quantized: template.quantized,
            poorMatchPixelCount: template.poorMatchPixelCount,
            sourceBlob: template.sourceBlob,
        });
    }

    async function gppDeleteTemplate(template) {
        // A shared-origin template (id 'legacy_'+numeric-id, see
        // gppLoadSharedLibraryTemplates) has no GPP_TEMPLATE_STORE record to
        // begin with — its core data lives entirely in the legacy
        // GP_Ghost_History store instead. Per explicit product decision,
        // deleting it from Ghost++ deletes it there too (true shared
        // delete), not just Ghost++'s own state — so it disappears from the
        // legacy Ghost Template Manager's history as well, matching a
        // single unified library rather than a partial/one-way mirror.
        const deletions = [gppDbDelete(GPP_STATE_STORE, template.id)];
        if (typeof template.legacySourceId === 'number') {
            deletions.push(gppLegacyDeleteImage(template.legacySourceId));
        } else {
            deletions.push(gppDbDelete(GPP_TEMPLATE_STORE, template.id));
        }
        await Promise.all(deletions);
        gppTemplates = gppTemplates.filter(t => t.id !== template.id);
        gppNormalizeTemplateOrder();
        if (gppFocusedTemplateId === template.id) {
            gppFocusedTemplateId = gppTemplates[0] ? gppTemplates[0].id : null;
            gppSettings.focusedTemplateId = gppFocusedTemplateId;
            gppSaveSettings();
        }
        await Promise.all(gppTemplates.map(gppPersistTemplateState));
    }

    // ── Ingestion ──────────────────────────────────────────────────────
    // Accepts PNG/JPEG/JFIF/WebP (Worker path) and JSON exports (direct
    // deserialize, no Worker needed). Decode/index always runs off the main
    // thread via the Worker built from gppBuildIngestWorkerSource(); a
    // cancellable, yielding main-thread fallback covers browsers where
    // Worker/OffscreenCanvas construction fails.
    const GPP_ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jfif', 'image/webp'];

    function gppCancelIngest() {
        if (gppIngestOperation) {
            gppIngestToken++;
            try { gppIngestOperation.worker && gppIngestOperation.worker.terminate(); } catch (_) {}
            gppIngestOperation = null;
        }
    }

    function gppIngestViaWorker(file, onProgress) {
        return new Promise((resolve, reject) => {
            let worker;
            try {
                const source = gppBuildIngestWorkerSource();
                const blob = new Blob([source], { type: 'text/javascript' });
                const url = URL.createObjectURL(blob);
                worker = new Worker(url);
                URL.revokeObjectURL(url);
            } catch (err) {
                reject(err);
                return;
            }
            const operationId = 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            const token = ++gppIngestToken;
            gppIngestOperation = { worker, operationId, cancel: () => { gppIngestToken++; worker.terminate(); } };
            worker.onmessage = event => {
                if (gppIngestToken !== token) return;
                const message = event.data || {};
                if (message.operationId !== operationId) return;
                if (message.type === 'progress') {
                    onProgress && onProgress(message.fraction, message.label);
                } else if (message.type === 'complete') {
                    gppIngestOperation = null;
                    worker.terminate();
                    resolve(message);
                } else if (message.type === 'error') {
                    gppIngestOperation = null;
                    worker.terminate();
                    const error = new Error(message.message);
                    error.name = message.name;
                    reject(error);
                }
            };
            worker.onerror = err => {
                if (gppIngestToken !== token) return;
                gppIngestOperation = null;
                worker.terminate();
                reject(err && err.message ? new Error(err.message) : new Error('Worker failed to start.'));
            };
            worker.postMessage({ type: 'ingest', operationId, file });
        });
    }

    // Cancellable, yielding main-thread fallback used only when the Worker
    // path itself fails to construct (e.g. blob-URL Workers blocked by CSP).
    async function gppIngestOnMainThread(file, onProgress) {
        const core = gppCreateCore();
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        let rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let width = canvas.width, height = canvas.height;
        const decoded = core.decodePositionHeader(rgba, width, height);
        rgba = decoded.rgba; width = decoded.width; height = decoded.height;
        const token = ++gppIngestToken;
        const indexed = await core.indexRgbaAsync(rgba, width, height, {
            isCancelled: () => gppIngestToken !== token,
            onProgress: (fraction, label) => onProgress && onProgress(0.05 + fraction * 0.94, label),
        });
        return {
            width, height, position: decoded.position, indexType: indexed.indexType,
            indices: indexed.indices, palette: indexed.palette, counts: indexed.counts, mask: indexed.mask,
            opaquePixelCount: indexed.opaquePixelCount, quantized: indexed.quantized, poorMatchPixelCount: indexed.poorMatchPixelCount,
        };
    }

    // Decode-only half of ingest — shared between the normal file-upload
    // path below and gpp-legacy-bridge.js-sourced images (see
    // gppLoadSharedLibraryTemplates), neither of which needs to duplicate
    // the Worker/main-thread fallback logic. `blob` need not be a real
    // File (a plain Blob decodes identically); the caller supplies its own
    // name/id/persistence semantics.
    async function gppDecodeImageBlob(blob, onProgress) {
        let result;
        try {
            result = await gppIngestViaWorker(blob, onProgress);
            result.indices = gppCreateCore().makeIndexArray(result.indexType, 0, result.indices);
            result.palette = new Uint32Array(result.palette);
            result.counts = new Uint32Array(result.counts);
            result.mask = new Uint32Array(result.mask);
        } catch (workerError) {
            console.warn('[GeoPixelcons++] Ghost++: Worker ingest failed, falling back to main thread.', workerError);
            result = await gppIngestOnMainThread(blob, onProgress);
        }
        return result;
    }

    // Cross-namespace dedup: a template ingested privately (id 'gpp_...')
    // BEFORE shared-library mode was ever turned on has no record in
    // GP_Ghost_History yet, so gppLegacyAddImage's own templateId lookup
    // (scoped to that store) can never find it. Without this check,
    // re-ingesting the identical image after enabling shared mode would
    // create an independent 'legacy_...' duplicate instead of migrating the
    // existing private entry — two visible copies with independently
    // editable state, and deleting one silently leaves the other behind.
    // Only private templates that still have their raw sourceBlob can be
    // checked this way; own-JSON-format private imports (sourceBlob: null)
    // have nothing to hash and are skipped, same as before this fix existed.
    async function gppFindMatchingPrivateTemplate(contentTemplateId) {
        for (const candidate of gppTemplates) {
            if (candidate.id.indexOf('legacy_') === 0 || !candidate.sourceBlob) continue;
            try {
                const candidateId = await gppLegacyComputeTemplateId(candidate.sourceBlob);
                if (candidateId === contentTemplateId) return candidate;
            } catch (_) {
                // An unhashable candidate just isn't checked — never fails the ingest.
            }
        }
        return null;
    }

    // Deletes a private template's own core+state records and drops it from
    // the in-memory list — used only when gppFindMatchingPrivateTemplate
    // finds it's being superseded by a shared-mode re-ingest of the exact
    // same image content (see callers below), never as a general-purpose
    // delete (that's gppDeleteTemplate, which also handles focus reassignment
    // and order renumbering — unnecessary here since the caller immediately
    // inserts a replacement in the same spot).
    async function gppRemoveSupersededPrivateTemplate(privateTemplate) {
        await Promise.all([
            gppDbDelete(GPP_TEMPLATE_STORE, privateTemplate.id),
            gppDbDelete(GPP_STATE_STORE, privateTemplate.id),
        ]);
        gppTemplates = gppTemplates.filter(t => t.id !== privateTemplate.id);
    }

    // Builds a lightweight, UNDECODED "stub" for a guild project — just
    // enough shape (id/name/position/opacity) for gpp-guild-templates.js to
    // list it and for the renderer's visibility check to safely skip it
    // (opacity 0, no indices/palette yet) — no fetch, no decode, no worker
    // round-trip. `guildProject` retains the raw API object (needed by
    // gppDecodeGuildTemplateEphemeral below AND by the card's own <img
    // src="project.image">, which reads the thumbnail straight off this —
    // never through Ghost++'s own indexed-decode pipeline, deliberately:
    // see that file for why). `guildDecoded` distinguishes a stub from a
    // fully-decoded template without needing a truthy-vs-undefined check on
    // `indices` scattered through every caller.
    //
    // Reported production scale (39 templates, up to 3276x3276 each) is
    // exactly why this exists as a separate step from decoding: building
    // all 39 stubs is nearly free (no network, no CPU), where decoding all
    // 39 up front — the ORIGINAL design — meant 39 full worker round-trips
    // and, via gpp-renderer.js's old unconditional reconcile, 39 real GPU
    // texture uploads (~10MB+ each at that resolution) for templates the
    // user likely never even looks at.
    function gppBuildGuildTemplateStub(project) {
        const hasPosition = Number.isFinite(project.imageGridX) && Number.isFinite(project.imageGridY);
        return {
            id: 'guild_' + project.id,
            name: 'Guild project ' + project.id,
            width: 0,
            height: 0,
            indexType: null,
            indices: null,
            palette: null,
            counts: null,
            opaquePixelCount: 0,
            quantized: false,
            poorMatchPixelCount: 0,
            sourceBlob: null, // never written anywhere — nothing needs to retain this
            mask: null,
            position: hasPosition
                ? { gridX: Math.round(project.imageGridX), gridY: Math.round(project.imageGridY) }
                : null,
            opacity: 0, // hidden by default — see gpp-guild-templates.js
            locked: false,
            groupNoise: false,
            order: 0,
            scanSummary: null,
            ephemeral: true,
            guildProject: project,
            guildDecoded: false,
        };
    }

    // Fetches + decodes a stub's full pixel data IN PLACE (mutates and
    // returns the SAME object gppBuildGuildTemplateStub produced) — true
    // lazy loading: only ever called once a user actually wants to VIEW a
    // specific guild template (a card click in gpp-guild-templates.js, or
    // the guild menu's "Set as Ghost"), never eagerly for the whole batch.
    // A no-op (besides returning the stub) if already decoded — cheap to
    // call unconditionally from a "show this" code path. Reuses
    // gppDecodeImageBlob directly, the exact same pure decode step
    // gppIngestImageFile itself calls before any of ITS persistence work
    // begins — genuinely the same decode, just never followed by a
    // database write (this object's own `ephemeral: true`, set by
    // gppBuildGuildTemplateStub, is what gppPersistTemplateState/
    // gppPersistTemplateCore both check and refuse to write, as defense in
    // depth if this ever reaches a normal-template code path).
    //
    // NOT safe to call directly with more than one in flight — always go
    // through gppState.decodeGuildTemplate (gppQueueGuildDecode below),
    // never this function by name, from outside this file. See that
    // wrapper's own comment for why.
    async function gppDecodeGuildTemplateRaw(stub) {
        if (stub.guildDecoded) return stub;
        const project = stub.guildProject;
        const response = await fetch(project.image);
        const blob = await response.blob();
        const result = await gppDecodeImageBlob(blob);
        stub.width = result.width;
        stub.height = result.height;
        stub.indexType = result.indexType;
        stub.indices = result.indices;
        stub.palette = result.palette;
        stub.counts = result.counts;
        stub.opaquePixelCount = result.opaquePixelCount;
        stub.quantized = result.quantized;
        stub.poorMatchPixelCount = result.poorMatchPixelCount;
        stub.mask = result.mask;
        if (!stub.position) stub.position = result.position || null;
        stub.guildDecoded = true;
        return stub;
    }

    // Serializes every on-demand guild-template decode (gpp-guild-templates.js's
    // per-card lazy decode when a user clicks to view one, AND
    // gpp-native-shim.js's "Set as Ghost") through one shared queue.
    // gppDecodeImageBlob ultimately goes through gppIngestViaWorker, whose
    // single shared cancellation token (gppIngestToken/gppIngestOperation)
    // is not safe for two decodes in flight at once (see that function's
    // own header comment) — before lazy loading, nothing could trigger two
    // independent guild decodes close enough together to matter; a grid of
    // 39 individually-clickable cards is exactly the kind of overlapping
    // trigger that didn't exist before. Chains onto a resolved-or-rejected
    // placeholder either way so one failed decode never wedges every decode
    // after it.
    let gppGuildDecodeQueue = Promise.resolve();
    function gppQueueGuildDecode(stub) {
        const result = gppGuildDecodeQueue.then(() => gppDecodeGuildTemplateRaw(stub));
        gppGuildDecodeQueue = result.then(() => {}, () => {});
        return result;
    }

    // Appends one decoded (or stub) guild template to gppGuildTemplates and
    // asks the renderer to redraw. Callers that want "reuse if one already
    // exists for this project" (i.e. everyone — see
    // gppGetOrCreateGuildTemplate below) should go through that function
    // instead of calling this directly with a freshly-built stub, to avoid
    // ever pushing a second entry with an id already present.
    function gppAddGuildTemplate(template) {
        gppGuildTemplates.push(template);
        if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
    }

    // THE single entry point for turning a guild project into a
    // gppGuildTemplates entry — both gpp-guild-templates.js's Guild
    // Templates section (fetching the whole list on first expand) and
    // gpp-native-shim.js's "Set as Ghost" (a single deliberate project) call
    // this instead of gppBuildGuildTemplateStub+gppAddGuildTemplate
    // directly. Returns the EXISTING entry for this project's id if one is
    // already in gppGuildTemplates (whether still an undecoded stub, or
    // already fully decoded from an earlier "Set as Ghost"/card view) —
    // never creates a second object sharing an id that's already present.
    //
    // This fixes a real, previously-shipped bug: both call sites used to
    // build a brand-new stub unconditionally, so viewing the same guild
    // project from both the section AND "Set as Ghost" (or clicking "Set as
    // Ghost" for a project the section had already stub-listed) produced
    // TWO objects with the identical id ('guild_' + project.id) sitting in
    // gppGuildTemplates side by side. gppGetFocusedTemplate's
    // `gppGuildTemplates.find(t => t.id === gppFocusedTemplateId)` then
    // returns whichever of the two array insertion order happens to put
    // first — often the OLDER, still-undecoded stub (indexType/indices/
    // palette all null) even though a fully-decoded sibling object also
    // existed — which is exactly what made gppShimSyncFocusedTemplate's
    // gppWriteFullNativeMirror -> core.indexedToRgba throw "Unsupported
    // index type: null", and made the Guild Templates section's own card
    // clicks appear to do nothing (the renderer's per-id resource map in
    // gpp-renderer.js also collides on a duplicate id, so which of the two
    // objects' pixels actually end up on screen becomes non-deterministic).
    function gppGetOrCreateGuildTemplate(project) {
        const id = 'guild_' + project.id;
        const existing = gppGuildTemplates.find(t => t.id === id);
        if (existing) return existing;
        const stub = gppBuildGuildTemplateStub(project);
        gppAddGuildTemplate(stub);
        return stub;
    }

    async function gppIngestImageFile(file, onProgress) {
        onProgress && onProgress(0, 'Starting');
        const result = await gppDecodeImageBlob(file, onProgress);
        const name = (file.name || 'Untitled template').replace(/\.[a-z0-9]+$/i, '');

        // Shared-library mode: the raw uploaded file itself (position header
        // and all, if it decoded one above) is exactly what
        // ghost-template-manager.js's own HistoryManager.add() would store,
        // so it is written through unchanged rather than re-encoded from the
        // now-decoded indices. gppLegacyAddImage() dedupes against any
        // existing record with the same clean-content templateId (see that
        // file), returning the SAME numeric id on a match — reuse an
        // already-loaded in-memory template with that id instead of pushing
        // a visual duplicate, mirroring the legacy menu's own "duplicate
        // detected, updating entry" behaviour.
        const contentTemplateId = await gppLegacyComputeTemplateId(file);
        // A private-store template ingested from a build before this was
        // unconditional has no shared record yet — migrate it (state carries
        // over, its own private record is removed) rather than create a
        // visible duplicate for the same image content.
        const privateMatch = await gppFindMatchingPrivateTemplate(contentTemplateId);
        const record = await gppLegacyAddImage(file, name, false);
        const id = 'legacy_' + record.id;
        const legacySourceId = record.id;
        if (record.hash) gppLegacyDecodeCache.set(record.hash, result);

        const template = {
            id,
            legacySourceId,
            name,
            width: result.width,
            height: result.height,
            indexType: result.indexType,
            indices: result.indices,
            palette: result.palette,
            counts: result.counts,
            opaquePixelCount: result.opaquePixelCount,
            quantized: result.quantized,
            poorMatchPixelCount: result.poorMatchPixelCount,
            sourceBlob: file,
            mask: result.mask,
            position: result.position || null,
            opacity: 1,
            locked: false,
            groupNoise: false,
            order: gppTemplates.length,
            scanSummary: null,
        };
        // Two distinct dedup sources can supersede this brand-new template
        // object with an EXISTING one's state: (1) a same-namespace match —
        // gppLegacyAddImage() itself returned an id already present in
        // gppTemplates (a shared template re-ingested), or (2) a cross-
        // namespace match — privateMatch, a template still living in the
        // old private store from before this was unconditional. Either way,
        // the existing entry's order/mask/position/etc carries over and its
        // old record (private-store row for case 2) is removed so the
        // library shows exactly one entry, never two, for the same image.
        const existingIndex = gppTemplates.findIndex(t => t.id === id);
        const supersedes = existingIndex !== -1 ? gppTemplates[existingIndex] : privateMatch;
        if (supersedes) {
            template.order = supersedes.order;
            template.opacity = supersedes.opacity;
            template.locked = supersedes.locked;
            template.groupNoise = supersedes.groupNoise;
            template.position = supersedes.position || template.position;
            template.mask = supersedes.mask;
        }
        if (existingIndex !== -1) {
            gppTemplates[existingIndex] = template;
        } else {
            if (privateMatch) await gppRemoveSupersededPrivateTemplate(privateMatch);
            gppTemplates.push(template);
        }
        await gppPersistTemplateState(template);
        gppFocusedTemplateId = template.id;
        gppSettings.focusedTemplateId = template.id;
        gppSaveSettings();
        gppTriggerLoadTimeScan(template);
        return template;
    }

    function gppBase64ToBlob(base64, mimeType) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mimeType });
    }

    // JSON import accepts two distinct shapes:
    //   1. Our own export (gppExportTemplateAsJson below) — pre-indexed
    //      template data, `{kind:'ghost-plus-plus-template', ...}`.
    //   2. GeoPixelcons++ Ghost Template Manager's history-export format —
    //      `{version, exportDate, images:[{name, imageData (base64 PNG),
    //      mimeType, ...}]}`. Each embedded PNG already carries GTM's own
    //      position-header packets (the same 5-pixel-packet marker format
    //      gpp-core.js's decodePositionHeader/POSITION_MARKER implements),
    //      so once decoded back to a real image file it runs through the
    //      ordinary image-ingest pipeline unmodified — no separate parsing
    //      needed for position data. A single GTM export can bundle several
    //      images, so this always returns an ARRAY of created templates
    //      (length 1 for our own format).
    async function gppIngestJsonFile(file, onProgress) {
        const text = await file.text();
        const parsed = JSON.parse(text);

        if (parsed && Array.isArray(parsed.images)) {
            const created = [];
            const skipped = [];
            for (const entry of parsed.images) {
                if (!entry || typeof entry.imageData !== 'string') { skipped.push(entry && entry.name); continue; }
                const mimeType = entry.mimeType || 'image/png';
                const blob = gppBase64ToBlob(entry.imageData, mimeType);
                const ext = mimeType.split('/')[1] || 'png';
                const imageFile = new File([blob], (entry.name || 'Imported template') + '.' + ext, { type: mimeType });
                const createdTemplate = await gppIngestImageFile(imageFile, onProgress);
                // GTM's own history-export format bundles a per-image groupNoise
                // flag (ghost-template-manager.js's exportToZip/exportSelectedToJson)
                // — apply it here rather than leaving every re-imported template
                // at gppIngestImageFile's fresh-ingest default of false.
                if (typeof entry.groupNoise === 'boolean' && createdTemplate.groupNoise !== entry.groupNoise) {
                    createdTemplate.groupNoise = entry.groupNoise;
                    await gppPersistTemplateState(createdTemplate);
                }
                created.push(createdTemplate);
            }
            if (!created.length) throw new Error('That export did not contain any recognisable images.');
            return created;
        }

        if (!parsed || parsed.kind !== 'ghost-plus-plus-template' || !parsed.width || !parsed.height) {
            throw new Error('That JSON file is not a Ghost++ template export or a GeoPixelcons++ ghost history export.');
        }
        const name = parsed.name || 'Imported template';
        const template = {
            id: gppMakeTemplateId(),
            name,
            width: parsed.width,
            height: parsed.height,
            indexType: parsed.indexType,
            indices: gppCreateCore().makeIndexArray(parsed.indexType, 0, new Uint8Array(parsed.indices).buffer),
            palette: Uint32Array.from(parsed.palette),
            counts: Uint32Array.from(parsed.counts),
            opaquePixelCount: parsed.opaquePixelCount,
            quantized: !!parsed.quantized,
            poorMatchPixelCount: parsed.poorMatchPixelCount || 0,
            sourceBlob: null,
            mask: parsed.mask ? Uint32Array.from(parsed.mask) : gppCreateCore().makeFullMask(parsed.palette.length, parsed.counts),
            position: parsed.position || null,
            opacity: typeof parsed.opacity === 'number' ? parsed.opacity : 1,
            locked: false,
            groupNoise: typeof parsed.groupNoise === 'boolean' ? parsed.groupNoise : false,
            order: gppTemplates.length,
            scanSummary: null,
        };
        // This format carries no raw source blob (it's already-decoded
        // indices/palette) — re-encode it to a real PNG (position header
        // baked in when placed) before writing it into the shared store, so
        // it round-trips through the legacy menu identically to any other
        // history entry.
        const blob = await gppEncodeTemplateToPngBlob(template);
        const contentTemplateId = await gppLegacyComputeTemplateId(blob);
        const privateMatch = await gppFindMatchingPrivateTemplate(contentTemplateId);
        const record = await gppLegacyAddImage(blob, name, template.groupNoise);
        template.id = 'legacy_' + record.id;
        template.legacySourceId = record.id;
        template.sourceBlob = blob;
        if (record.hash) {
            gppLegacyDecodeCache.set(record.hash, {
                width: template.width, height: template.height, indexType: template.indexType,
                indices: template.indices, palette: template.palette, counts: template.counts,
                opaquePixelCount: template.opaquePixelCount, quantized: template.quantized,
                poorMatchPixelCount: template.poorMatchPixelCount, position: template.position,
            });
        }
        // See gppIngestImageFile's identical comment: either a same-namespace
        // (existingIndex) or cross-namespace (privateMatch) supersede carries
        // the old entry's state over and removes its now-superseded record.
        const existingIndex = gppTemplates.findIndex(t => t.id === template.id);
        const supersedes = existingIndex !== -1 ? gppTemplates[existingIndex] : privateMatch;
        if (supersedes) {
            template.order = supersedes.order;
            template.opacity = supersedes.opacity;
            template.locked = supersedes.locked;
            template.groupNoise = supersedes.groupNoise;
            template.position = supersedes.position || template.position;
            template.mask = supersedes.mask;
        }
        if (existingIndex !== -1) {
            gppTemplates[existingIndex] = template;
        } else {
            if (privateMatch) await gppRemoveSupersededPrivateTemplate(privateMatch);
            gppTemplates.push(template);
        }
        await gppPersistTemplateState(template);
        gppFocusedTemplateId = template.id;
        gppSettings.focusedTemplateId = template.id;
        gppSaveSettings();
        gppTriggerLoadTimeScan(template);
        return [template];
    }

    async function gppExportTemplateAsJson(template) {
        const payload = {
            kind: 'ghost-plus-plus-template',
            name: template.name,
            width: template.width,
            height: template.height,
            indexType: template.indexType,
            indices: Array.from(template.indices),
            palette: Array.from(template.palette),
            counts: Array.from(template.counts),
            mask: Array.from(template.mask),
            opaquePixelCount: template.opaquePixelCount,
            quantized: template.quantized,
            poorMatchPixelCount: template.poorMatchPixelCount,
            position: template.position,
            opacity: template.opacity,
            groupNoise: !!template.groupNoise,
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = (template.name || 'template') + '.ghostplusplus.json';
        link.click();
        URL.revokeObjectURL(url);
    }

    // Reverses ingest: indices+palette(+position) -> a real PNG Blob, with
    // GTM's own position-header packets baked in when placed — used both by
    // the base64 JSON export below and by the shared-library write-back
    // path for Ghost++'s own JSON-format import (gpp-legacy-bridge.js has
    // no raw source blob for that shape, only decoded fields).
    async function gppEncodeTemplateToPngBlob(template) {
        const core = gppCreateCore();
        let rgba = core.indexedToRgba(template.indices, template.indexType, template.palette);
        let width = template.width;
        let height = template.height;
        if (template.position) {
            const encoded = core.encodePositionHeader(rgba, width, height, template.position);
            rgba = encoded.rgba;
            width = encoded.width;
            height = encoded.height;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }

    // Blob -> base64 via the browser's own native FileReader encoder rather
    // than a manual arrayBuffer()+Uint8Array+chunked-String.fromCharCode+
    // btoa() pipeline — this is exactly what the legacy Ghost Template
    // Manager's own exportToZip/exportSelectedToJson
    // (ghost-template-manager.js's blobToBase64) has always done, and is
    // the real fix for "export is slow": the manual chunked-loop approach
    // spends real main-thread time building up a giant intermediate JS
    // string one 32K chunk at a time before btoa() even starts, where
    // FileReader hands the whole conversion to the browser's own
    // (non-JS-interpreter) implementation in one call.
    function gppBlobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function gppTemplateToBase64Png(template) {
        const blob = await gppEncodeTemplateToPngBlob(template);
        return gppBlobToBase64(blob);
    }

    // Small batches, not a single unbounded Promise.all — each template's
    // PNG re-encode (gppEncodeTemplateToPngBlob) has no shared mutable
    // state (its own <canvas>, its own FileReader), so running a few at
    // once is safe unlike gppIngestViaWorker's single-shared-token design
    // (see gppLoadSharedLibraryTemplates' own comment on why THAT one must
    // stay serial) — but encoding dozens of large templates fully in
    // parallel would still spike memory/GPU pressure for no real gain past
    // a handful at a time.
    const GPP_EXPORT_BATCH_SIZE = 4;

    // Bulk export (Manage Templates modal's "Export selected") — ONE file
    // covering every selected template, in the same
    // {version, exportDate, images:[...]} shape gppIngestJsonFile already
    // accepts on import (see its GTM-compatibility branch), rather than one
    // download per template. Each image is re-encoded back to a real PNG
    // (with a position header when placed) so the file is a genuine,
    // portable image export, not just a dump of internal index buffers.
    // `onProgress(fraction, label)` is optional (same shape as
    // gppIngestImageFile's own callback) — the Manage Templates modal uses
    // it to drive a real progress bar instead of a blank wait.
    async function gppExportTemplatesAsJson(templates, filename, onProgress) {
        const core = gppCreateCore();
        const images = new Array(templates.length);
        let completed = 0;
        for (let start = 0; start < templates.length; start += GPP_EXPORT_BATCH_SIZE) {
            const batch = templates.slice(start, start + GPP_EXPORT_BATCH_SIZE);
            const encoded = await Promise.all(batch.map(template => gppTemplateToBase64Png(template)));
            batch.forEach((template, i) => {
                const hash = core.templateHash(template.indices, template.palette, template.width, template.height);
                images[start + i] = {
                    id: start + i + 1,
                    name: template.name || 'Untitled template',
                    date: Date.now(),
                    hash,
                    templateId: hash,
                    imageData: encoded[i],
                    mimeType: 'image/png',
                    groupNoise: !!template.groupNoise,
                };
                completed++;
                if (onProgress) onProgress(completed / templates.length, 'Exporting ' + (template.name || 'template'));
            });
        }
        const payload = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            images,
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || ('ghost-plus-plus-export-' + images.length + '.json');
        link.click();
        URL.revokeObjectURL(url);
    }

    function gppGetFocusedTemplate() {
        return gppTemplates.find(t => t.id === gppFocusedTemplateId)
            || gppGuildTemplates.find(t => t.id === gppFocusedTemplateId)
            || null;
    }

    // Focusing a template also treats it as "most recently worked on" — bump
    // it to the very front of the in-memory list (immediate effect, no reload
    // needed for the grid to reflect it) and give it an order value lower
    // than every other template's own current order, so the same ordering
    // survives the next reload/sort too (gppLoadTemplateLibrary sorts by
    // `order` ascending). Only the newly-focused template's state is
    // persisted — everyone else's `order` is left untouched, no renumbering
    // pass (unlike gppNormalizeTemplateOrder, which a full reload/explicit
    // drag-reorder still runs to compact values back down eventually).
    async function gppBumpFocusedTemplateToTop(id) {
        const index = gppTemplates.findIndex(t => t.id === id);
        if (index === -1) return;
        const template = gppTemplates[index];
        const others = gppTemplates.filter(t => t.id !== id);
        if (!others.length) return;
        const minOrder = Math.min(...others.map(t => t.order));
        const alreadyOnTop = index === 0 && template.order < minOrder;
        gppTemplates.splice(index, 1);
        gppTemplates.unshift(template);
        if (alreadyOnTop) return;
        template.order = minOrder - 1;
        await gppPersistTemplateState(template);
    }

    // View Settings' "Auto-hide unfocused templates" checkbox
    // (gppSettings.autoHideUnfocused, default off): when on, focusing a
    // template hides every OTHER template in gppState.templates (opacity
    // 0, persisted like any other visibility change) and makes sure the
    // newly-focused one is itself visible — but only forces it to opacity 1
    // if it was exactly 0 before; a deliberately-set partial opacity (e.g.
    // 50%) is left alone rather than clobbered on every refocus. This is
    // the "only ever look at one template at a time" mode the setting's own
    // name promises, and composes directly with gpp-renderer.js's
    // gppRendererIsTemplateVisible fix (opacity 0 = zero GPU/canvas
    // resources, not just skipped drawing) — with this on, at most one
    // template's resources are ever held at a time, which is exactly the
    // performance case a library full of large templates benefits from.
    // Scoped to gppState.templates only: guild templates (gpp-guild-templates.js)
    // have their own independent, click-to-preview visibility model that
    // never calls gppFocusTemplate at all, so they're naturally unaffected.
    async function gppApplyAutoHideUnfocused(focusedId) {
        const toPersist = [];
        for (const t of gppTemplates) {
            if (t.id === focusedId) {
                if (t.opacity <= 0) { t.opacity = 1; toPersist.push(t); }
            } else if (t.opacity > 0) {
                t.opacity = 0;
                toPersist.push(t);
            }
        }
        if (!toPersist.length) return;
        await Promise.all(toPersist.map(t => gppPersistTemplateState(t)));
        if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
    }

    async function gppFocusTemplate(id) {
        const previousId = gppFocusedTemplateId;
        gppFocusedTemplateId = id;
        // A guild/ephemeral template (gpp-guild-templates.js, or the guild
        // menu's "Set as Ghost") never touches localStorage, the recency
        // order, or an auto-scan — none of those make sense for something
        // that will not exist on the next page load anyway, and
        // gppSaveSettings() writing its id to gppSettings.focusedTemplateId
        // would otherwise be a (harmless but avoidable) trace of it outside
        // gppGuildTemplates itself.
        if (gppGuildTemplates.some(t => t.id === id)) return;
        gppSettings.focusedTemplateId = id;
        gppSaveSettings();
        if (id) await gppBumpFocusedTemplateToTop(id);
        if (id && id !== previousId) {
            gppTriggerLoadTimeScan(gppTemplates.find(t => t.id === id));
            if (gppSettings.autoHideUnfocused) await gppApplyAutoHideUnfocused(id);
        }
    }

    // Fires an immediate (fire-and-forget) "Scan progress" run whenever a
    // template is loaded into view — either by focusing an existing one or
    // by finishing an ingest — so the progress bar/color breakdown render
    // right away instead of staying blank until the user manually clicks
    // Scan progress themselves. Deliberately allowed to be inaccurate (the
    // relevant map tiles may not have synced yet): the user can pan to the
    // template's location and re-run the scan for a correct result. Never
    // awaited by its callers — must not block focus/ingest on a full scan.
    function gppTriggerLoadTimeScan(template) {
        if (!template || !template.position || gppScanRunning) return;
        if (typeof gppScanTemplate !== 'function') return;
        // Fire-and-forget, unlike the manual Scan button's own click handler
        // (gpp-scan.js), which calls onChange() both immediately AND again
        // once its promise resolves. gppTriggerLoadTimeScan's caller
        // (gppFocusTemplate, right above) usually triggers its own refresh
        // around the same time anyway, but calling gppRequestUiRefresh()
        // here too makes this self-sufficient rather than implicitly
        // depending on that — and without the .finally() below, nothing
        // would ever re-render the Progress section once THIS scan actually
        // finished: gppScanRunning/gppScanningTemplateId flip back correctly
        // in memory, but the Scan/error/missing/nearest/clear buttons stayed
        // frozen showing "Scanning…"/disabled until some UNRELATED action
        // (e.g. toggling a palette color, which does call onChange())
        // happened to trigger a refresh — read as "stuck, but only
        // sometimes" from the outside. gppRequestUiRefresh() (gpp-init.js)
        // is the cross-file-safe equivalent of that same onChange() call.
        // gppScanTemplate sets gppScanRunning/gppScanningTemplateId
        // SYNCHRONOUSLY before its first await (see its own comment), so the
        // refresh below correctly sees the new busy state — calling it
        // BEFORE gppScanTemplate would refresh against the still-false
        // flag and never show Scanning… at all.
        const pending = gppScanTemplate(template);
        if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        pending.catch(err => {
            console.error('[GeoPixelcons++] Ghost++ load-time scan failed:', err);
        }).finally(() => {
            if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        });
    }

    // Single entry point every UI file (shell/palette/library/scan) reads
    // and calls through — the one place that "knows" what the runtime is
    // made of, so no other file needs its own copy of this state.
    const gppState = {
        get settings() { return gppSettings; },
        get templates() { return gppTemplates; },
        get guildTemplates() { return gppGuildTemplates; },
        get focusedTemplateId() { return gppFocusedTemplateId; },
        get runtimeReady() { return gppRuntimeReady; },
        buildGuildTemplateStub: gppBuildGuildTemplateStub,
        getOrCreateGuildTemplate: gppGetOrCreateGuildTemplate,
        decodeGuildTemplate: gppQueueGuildDecode,
        addGuildTemplate: gppAddGuildTemplate,
        applyAutoHideUnfocused: gppApplyAutoHideUnfocused,
        getFocusedTemplate: gppGetFocusedTemplate,
        focusTemplate: gppFocusTemplate,
        saveSettings: gppSaveSettings,
        ingestImageFile: gppIngestImageFile,
        ingestJsonFile: gppIngestJsonFile,
        exportTemplateAsJson: gppExportTemplateAsJson,
        exportTemplatesAsJson: gppExportTemplatesAsJson,
        deleteTemplate: gppDeleteTemplate,
        persistTemplateState: gppPersistTemplateState,
        persistTemplateCore: gppPersistTemplateCore,
        normalizeTemplateOrder: gppNormalizeTemplateOrder,
        cancelIngest: gppCancelIngest,
        reloadLibrary: gppReloadTemplateLibrary,
        acceptedImageTypes: GPP_ACCEPTED_IMAGE_TYPES,
    };

    // Guards against concurrent callers (the modal's own open() flow and
    // gpp-renderer.js's independent self-mount both call this) racing two
    // separate gppLoadTemplateLibrary() reads, where the second resolution
    // would silently overwrite gppTemplates and drop anything the first
    // caller had already appended in between.
    let gppRuntimeInitPromise = null;

    // False from page load until gppInitRuntime()'s decode pass genuinely
    // finishes — gpp-init.js's open() now renders the modal shell and calls
    // refreshAll() BEFORE awaiting ensureRuntime() (a faster-feeling first
    // open), which means gpp-library.js's Templates grid can render with
    // gppTemplates still empty purely because decoding hasn't finished yet,
    // not because the user genuinely has zero templates. Exposed via
    // gppState.runtimeReady so that section can tell the two apart and show
    // a "Loading templates..." placeholder instead of looking like the
    // library was wiped. Never reset back to false once true (a later,
    // separate reload — e.g. reloadLibrary() — updates gppTemplates in
    // place; the FIRST decode having finished once is all this flag means).
    let gppRuntimeReady = false;

    // Whatever template is focused at the moment this runs was restored
    // from a PREVIOUS page session (either gppInitRuntime()'s own
    // no-longer-exists fallback, or the plain `gppFocusedTemplateId =
    // gppSettings.focusedTemplateId` assignment at this file's own
    // module-load time) — never through gppFocusTemplate() itself, so that
    // function's own `id !== previousId` auto-scan trigger never got a
    // chance to fire for it. Without this, a template that was already
    // loaded before the page refresh would sit with stale/no progress
    // until the user manually clicked Scan or switched templates away and
    // back. Split out from gppInitRuntime() below so it can be called
    // directly in tests without needing to force a full, expensive
    // re-run of that function's own database/library-loading work.
    function gppTriggerScanForRestoredFocus() {
        const alreadyFocusedTemplate = gppTemplates.find(t => t.id === gppFocusedTemplateId);
        if (alreadyFocusedTemplate) gppTriggerLoadTimeScan(alreadyFocusedTemplate);
    }

    function gppInitRuntime() {
        if (!gppRuntimeInitPromise) {
            gppRuntimeInitPromise = (async () => {
                gppDatabase = await gppOpenDatabase();
                gppTemplates = await gppLoadTemplateLibrary();
                gppNormalizeTemplateOrder();
                if (!gppTemplates.some(t => t.id === gppFocusedTemplateId)) {
                    gppFocusedTemplateId = gppTemplates[0] ? gppTemplates[0].id : null;
                }
                gppRuntimeReady = true;
                // Runtime becoming ready is the one guaranteed moment a
                // native-ghost-mirror sync (gpp-native-shim.js's
                // gppShimSyncFocusedTemplate, reached via refreshAll()) can
                // correctly reflect the real restored focus/mask.
                // gppShimEnable() now runs immediately at Ghost++ init (see
                // gpp-ui-shell.js's gppReplaceNativeOpener), well BEFORE this
                // runtime is ready — so its own first sync call correctly
                // clears the native mirror to empty (nothing is focused yet
                // at that point), but nothing was guaranteed to re-sync it
                // afterward. gppTriggerScanForRestoredFocus() below only
                // refreshes when it actually finds a positioned template to
                // scan, silently skipping the refresh (leaving the mirror
                // stuck empty) whenever there's no restored focus, or the
                // restored template isn't positioned yet. Other addons that
                // read the native mirror directly instead of going through
                // Ghost++'s own UI (e.g. a third-party "queue selected
                // colors" tool reading the bare ghostActivePaletteColors
                // binding) would then see "no colors selected" even though
                // Ghost++ itself correctly shows colors enabled, until some
                // OTHER action (opening Ghost++'s own modal, toggling a
                // color) happened to trigger a real refreshAll() later.
                // refreshAll() safely no-ops for anything not yet built by
                // ensureShellBuilt() (each render call is individually
                // guarded on its own container existing), so this is safe to
                // call even before the modal has ever been opened.
                gppRequestUiRefresh();
                gppTriggerScanForRestoredFocus();
                return gppState;
            })().catch(err => {
                gppRuntimeInitPromise = null;
                throw err;
            });
        }
        return gppRuntimeInitPromise;
    }
