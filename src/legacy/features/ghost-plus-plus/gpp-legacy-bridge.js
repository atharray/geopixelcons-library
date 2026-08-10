    // ── Ghost++ legacy history bridge ───────────────────────────────────
    // Unconditional (not a setting — by explicit product decision, always
    // on) integration with the legacy Ghost Template Manager's
    // (ghost-template-manager.js) own IndexedDB template history —
    // 'GP_Ghost_History' v3, store 'images' ({id (autoincrement), blob,
    // name, date, hash, templateId, groupNoise}). Ghost++ reads its
    // template list FROM that store (merged with anything still sitting in
    // its own OLD private gpp-runtime.js store, from before this was
    // unconditional — see gppLoadTemplateLibrary) and writes new/deleted
    // templates back into it, so switching between the legacy ghost menu
    // and the new Ghost++ panel is seamless in both directions: a template
    // created in either shows up in the other, and deleting it from either
    // removes it from both.
    //
    // Schema coupling risk: this file opens 'GP_Ghost_History' at a
    // HARDCODED version (GPP_LEGACY_DB_VERSION) matching
    // ghost-template-manager.js's own DB_VERSION as of this writing. If
    // that file's schema/version ever changes again, this constant must be
    // updated to match — IndexedDB refuses to open a connection at a
    // version lower than the database's current on-disk version.
    //
    // Position-header compatibility: gpp-core.js's decodePositionHeader/
    // encodePositionHeader already implement the exact same 5-pixel-packet,
    // marker-byte-71/80/88, POSITION_OFFSET=0x80000000 format
    // ghost-template-manager.js's encodeRobustPosition/decodeRobustPosition
    // use (confirmed by direct comparison of both implementations), so
    // blobs written by either feature decode identically in the other.
    //
    // Public surface (the only names other Ghost++ files should call):
    //   gppLegacyListImages()               -> Promise<Array<record>>
    //   gppLegacyAddImage(blob,name,noise)  -> Promise<{id,hash,templateId,name,date,groupNoise}>
    //   gppLegacyDeleteImage(id)            -> Promise<void>
    //   gppLegacyComputeTemplateId(blob)    -> Promise<string>  (exposed for tests)

    const GPP_LEGACY_DB_NAME = 'GP_Ghost_History';
    const GPP_LEGACY_DB_VERSION = 3;
    const GPP_LEGACY_STORE_NAME = 'images';

    let gppLegacyDbPromise = null;

    // Mirrors ghost-template-manager.js's own onupgradeneeded exactly
    // (idempotent contains-checks rather than oldVersion branching), so
    // whichever feature happens to be the first to ever open this database
    // on a given profile creates the identical schema the other expects.
    function gppLegacyOpenDatabase() {
        if (!gppLegacyDbPromise) {
            gppLegacyDbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(GPP_LEGACY_DB_NAME, GPP_LEGACY_DB_VERSION);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    const txn = request.transaction;
                    let store;
                    if (!db.objectStoreNames.contains(GPP_LEGACY_STORE_NAME)) {
                        store = db.createObjectStore(GPP_LEGACY_STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    } else {
                        store = txn.objectStore(GPP_LEGACY_STORE_NAME);
                    }
                    if (!store.indexNames.contains('hash')) store.createIndex('hash', 'hash', { unique: false });
                    if (!store.indexNames.contains('templateId')) store.createIndex('templateId', 'templateId', { unique: false });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            }).catch(err => {
                gppLegacyDbPromise = null;
                throw err;
            });
        }
        return gppLegacyDbPromise;
    }

    async function gppLegacyComputeFileHash(blob) {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const bytes = Array.from(new Uint8Array(hashBuffer));
        return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Mirrors ghost-template-manager.js's computeTemplateId(): hashes the
    // position-header-STRIPPED image content, so the same template is
    // recognised as "the same" regardless of where it's been placed —
    // required for cross-feature duplicate detection to behave the same
    // way it already does inside the legacy menu alone. Uses gpp-core.js's
    // own decodePositionHeader (byte-compatible, see file banner) rather
    // than re-implementing GTM's separate canvas-based decoder.
    async function gppLegacyComputeTemplateId(blob) {
        try {
            const core = gppCreateCore();
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const decoded = core.decodePositionHeader(rgba, canvas.width, canvas.height);
            if (!decoded.position) return await gppLegacyComputeFileHash(blob);
            const cleanCanvas = document.createElement('canvas');
            cleanCanvas.width = decoded.width;
            cleanCanvas.height = decoded.height;
            cleanCanvas.getContext('2d').putImageData(
                new ImageData(new Uint8ClampedArray(decoded.rgba), decoded.width, decoded.height), 0, 0
            );
            const cleanBlob = await new Promise(resolve => cleanCanvas.toBlob(resolve, 'image/png'));
            return await gppLegacyComputeFileHash(cleanBlob);
        } catch (_) {
            // On any decode failure, fall back to hashing the raw blob —
            // matches GTM's own fallback exactly.
            return await gppLegacyComputeFileHash(blob);
        }
    }

    function gppLegacyListImages() {
        return gppLegacyOpenDatabase().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(GPP_LEGACY_STORE_NAME, 'readonly');
            const request = tx.objectStore(GPP_LEGACY_STORE_NAME).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        }));
    }

    // Update-in-place on a templateId match (same numeric id kept) rather
    // than ghost-template-manager.js's own delete-then-recreate — a
    // deliberate difference: Ghost++ keys its OWN per-template state
    // (gpp-runtime.js's GPP_STATE_STORE) by 'legacy_'+id, so recreating a
    // matched record under a fresh id would silently orphan the user's
    // mask/position/opacity on every re-ingest of a duplicate image. The
    // only user-visible effect of this choice is GTM's own history list
    // ordering (newest-first, by insertion) — an updated record keeps its
    // original position in that list instead of jumping to the top, which
    // degrades gracefully.
    async function gppLegacyAddImage(blob, name, groupNoise) {
        const db = await gppLegacyOpenDatabase();
        const hash = await gppLegacyComputeFileHash(blob);
        const templateId = await gppLegacyComputeTemplateId(blob);
        const finalName = name || ('Image_' + Date.now());
        const date = Date.now();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(GPP_LEGACY_STORE_NAME, 'readwrite');
            const store = tx.objectStore(GPP_LEGACY_STORE_NAME);
            const lookup = store.index('templateId').get(templateId);
            let resultId = null;
            lookup.onsuccess = () => {
                const existing = lookup.result;
                const item = { blob, name: finalName, date, hash, templateId, groupNoise: !!groupNoise };
                if (existing) {
                    item.id = existing.id;
                    resultId = existing.id;
                    store.put(item);
                } else {
                    const addRequest = store.add(item);
                    addRequest.onsuccess = () => { resultId = addRequest.result; };
                }
            };
            tx.oncomplete = () => resolve({ id: resultId, hash, templateId, name: finalName, date, groupNoise: !!groupNoise });
            tx.onerror = () => reject(tx.error);
        });
    }

    function gppLegacyDeleteImage(id) {
        return gppLegacyOpenDatabase().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(GPP_LEGACY_STORE_NAME, 'readwrite');
            tx.objectStore(GPP_LEGACY_STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        }));
    }
