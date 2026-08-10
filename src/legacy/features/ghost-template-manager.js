
    // ============================================================
    //  FEATURE: Ghost Template Manager [ghostTemplateManager]
    // ============================================================
    if (_settings.ghostTemplateManager) {
        try {
            (function _init_ghostTemplateManager() {

    // ========== CONFIGURATION ==========
    const DEBUG_MODE = false;
    const DB_NAME = 'GP_Ghost_History';
    const DB_VERSION = 3;
    const STORE_NAME = 'images';

    // Marker Colors for Encoding
    const MARKER_R = 71;
    const MARKER_G = 80;
    const MARKER_B = 88;
    const POSITION_OFFSET = 2147483648;

    let isInternalUpdate = false;
    let previewActive = false;
    let previewOverlay = null;

    // ========== UTILITIES ==========
    function gpLog(msg, data = null) {
        if (!DEBUG_MODE) return;
        console.log(`%c[GP Manager] ${msg}`, "color: #00ffff; background: #000; padding: 2px 4px;", data || '');
    }

    // Debug: Log environment info on load
    gpLog("Script loaded. Environment check:", {
        hasWindow: typeof window !== 'undefined',
        hasUnsafeWindow: typeof unsafeWindow !== 'undefined',
        windowMap: typeof window !== 'undefined' ? typeof window.map : 'N/A',
        windowTurf: typeof window !== 'undefined' ? typeof window.turf : 'N/A',
        unsafeWindowMap: typeof unsafeWindow !== 'undefined' ? typeof unsafeWindow.map : 'N/A',
        unsafeWindowTurf: typeof unsafeWindow !== 'undefined' ? typeof unsafeWindow.turf : 'N/A'
    });

    /**
     * Safely get a page variable, avoiding DOM element conflicts.
     * In some browsers, accessing unsafeWindow.map returns the <div id="map"> element
     * instead of the JavaScript map variable.
     */
    function getPageVariable(varName) {
        // Try window first (works in Chrome/Vivaldi)
        if (typeof window !== 'undefined' && window[varName] !== undefined) {
            const val = window[varName];
            // Make sure it's not a DOM element when we expect an object with methods
            if (varName === 'map' && val instanceof HTMLElement) {
                gpLog(`window.${varName} is a DOM element, trying unsafeWindow`);
            } else {
                gpLog(`Found ${varName} in window`);
                return val;
            }
        }

        // Try unsafeWindow (needed in Firefox/Brave with @grant permissions)
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow[varName] !== undefined) {
            const val = unsafeWindow[varName];
            // Check if it's a DOM element when we expect the map object
            if (varName === 'map' && val instanceof HTMLElement) {
                gpLog(`unsafeWindow.${varName} is a DOM element, looking for alternatives`);
                
                // Try to get the map from common Mapbox/Leaflet global patterns
                // The map might be stored in a different variable or we need wrappedJSObject (Firefox)
                if (typeof unsafeWindow.wrappedJSObject !== 'undefined' && unsafeWindow.wrappedJSObject[varName]) {
                    const wrappedVal = unsafeWindow.wrappedJSObject[varName];
                    if (!(wrappedVal instanceof HTMLElement)) {
                        gpLog(`Found ${varName} in wrappedJSObject`);
                        return wrappedVal;
                    }
                }
                
                // For Brave/Chrome with sandboxing, try accessing via page script injection
                gpLog(`Attempting page context injection for ${varName}`);
                return getPageVariableViaInjection(varName);
            } else {
                gpLog(`Found ${varName} in unsafeWindow`);
                return val;
            }
        }

        // Try wrappedJSObject directly (Firefox)
        if (typeof unsafeWindow !== 'undefined' && 
            typeof unsafeWindow.wrappedJSObject !== 'undefined' && 
            unsafeWindow.wrappedJSObject[varName] !== undefined) {
            gpLog(`Found ${varName} in wrappedJSObject`);
            return unsafeWindow.wrappedJSObject[varName];
        }

        gpLog(`Could not find ${varName} in any scope`);
        return null;
    }

    /**
     * Get a page variable by creating a bridge in the page context.
     * This is needed in Brave when @grant permissions create a sandbox.
     */
    function getPageVariableViaInjection(varName) {
        try {
            // Create a unique ID for this retrieval
            const bridgeId = `__gp_bridge_${varName}_${Date.now()}`;
            
            // Inject a script that copies the variable to a data attribute
            const script = document.createElement('script');
            script.textContent = `
                (function() {
                    if (typeof ${varName} !== 'undefined' && ${varName}) {
                        // Store a marker that the variable exists
                        document.documentElement.setAttribute('${bridgeId}', 'exists');
                        // For map object, we can't directly transfer it, so we'll access it differently
                        if ('${varName}' === 'map' && typeof ${varName}.project === 'function') {
                            document.documentElement.setAttribute('${bridgeId}_hasProject', 'true');
                        }
                    }
                })();
            `;
            document.documentElement.appendChild(script);
            script.remove();
            
            // Check if the variable exists
            const exists = document.documentElement.getAttribute(bridgeId);
            document.documentElement.removeAttribute(bridgeId);
            document.documentElement.removeAttribute(`${bridgeId}_hasProject`);
            
            if (exists === 'exists') {
                gpLog(`${varName} exists in page context, creating proxy`);
                
                // For the map object specifically, we need to create a proxy that executes in page context
                if (varName === 'map') {
                    return createMapProxy();
                } else if (varName === 'turf') {
                    return createTurfProxy();
                }
            }
            
            gpLog(`${varName} not found via injection`);
            return null;
        } catch (e) {
            gpLog(`Error in page context injection for ${varName}:`, e.message);
            return null;
        }
    }

    /**
     * Create a proxy object for the map that executes methods in page context
     */
    function createMapProxy() {
        return {
            project: function(lngLat) {
                // Execute in page context and return result
                const script = document.createElement('script');
                const resultId = `__gp_map_result_${Date.now()}`;
                script.textContent = `
                    (function() {
                        try {
                            const result = map.project([${lngLat[0]}, ${lngLat[1]}]);
                            document.documentElement.setAttribute('${resultId}', JSON.stringify({x: result.x, y: result.y}));
                        } catch(e) {
                            document.documentElement.setAttribute('${resultId}_error', e.message);
                        }
                    })();
                `;
                document.documentElement.appendChild(script);
                script.remove();
                
                const resultStr = document.documentElement.getAttribute(resultId);
                const errorStr = document.documentElement.getAttribute(`${resultId}_error`);
                document.documentElement.removeAttribute(resultId);
                document.documentElement.removeAttribute(`${resultId}_error`);
                
                if (errorStr) {
                    throw new Error(errorStr);
                }
                
                return JSON.parse(resultStr);
            },
            on: function(event, handler) {
                gpLog(`Map event listener for ${event} registered (proxy mode)`);
                // Store the handler for later use
                if (!this._handlers) this._handlers = {};
                if (!this._handlers[event]) this._handlers[event] = [];
                this._handlers[event].push(handler);
                
                // Set up event forwarding via page script
                const listenerId = `__gp_map_listener_${event}_${Date.now()}`;
                const script = document.createElement('script');
                script.textContent = `
                    (function() {
                        if (typeof map !== 'undefined' && map.on) {
                            map.on('${event}', function() {
                                document.documentElement.setAttribute('${listenerId}', Date.now());
                            });
                        }
                    })();
                `;
                document.documentElement.appendChild(script);
                script.remove();
                
                // Set up mutation observer to detect attribute changes
                const observer = new MutationObserver(() => {
                    const val = document.documentElement.getAttribute(listenerId);
                    if (val) {
                        document.documentElement.removeAttribute(listenerId);
                        handler();
                    }
                });
                observer.observe(document.documentElement, { attributes: true });
            },
            off: function(event, handler) {
                gpLog(`Map event listener for ${event} removed (proxy mode)`);
                // In proxy mode, we can't easily remove specific handlers
                // This is a limitation of the bridge approach
            },
            getContainer: function() {
                return document.getElementById('map');
            }
        };
    }

    /**
     * Create a proxy object for turf that executes methods in page context
     */
    function createTurfProxy() {
        return {
            toWgs84: function(mercCoords) {
                const script = document.createElement('script');
                const resultId = `__gp_turf_result_${Date.now()}`;
                script.textContent = `
                    (function() {
                        try {
                            const result = turf.toWgs84([${mercCoords[0]}, ${mercCoords[1]}]);
                            document.documentElement.setAttribute('${resultId}', JSON.stringify(result));
                        } catch(e) {
                            document.documentElement.setAttribute('${resultId}_error', e.message);
                        }
                    })();
                `;
                document.documentElement.appendChild(script);
                script.remove();
                
                const resultStr = document.documentElement.getAttribute(resultId);
                const errorStr = document.documentElement.getAttribute(`${resultId}_error`);
                document.documentElement.removeAttribute(resultId);
                document.documentElement.removeAttribute(`${resultId}_error`);
                
                if (errorStr) {
                    throw new Error(errorStr);
                }
                
                return JSON.parse(resultStr);
            }
        };
    }

    function notifyUser(title, message) {
        // Use safe helper to get showAlert function
        const showAlert = getPageVariable('showAlert');
        
        if (typeof showAlert === 'function') {
            showAlert(title, message);
        } else {
            console.log(`[${title}] ${message}`);
            // Fallback alert if site's showAlert is not available
            alert(`${title}: ${message}`);
        }
    }

    // Reads the live state of the site's native Group Noise checkbox.
    function getGroupNoiseState() {
        const toggle = document.getElementById('groupNoiseToggle');
        return toggle ? !!toggle.checked : false;
    }

    function goToTemplateLocation() {
        const savedCoordsStr = localStorage.getItem('ghostImageCoords');
        if (!savedCoordsStr) {
            notifyUser("No Template", "No ghost image template is currently set.");
            return;
        }
        
        try {
            const coords = JSON.parse(savedCoordsStr);
            if (typeof coords.gridX !== 'number' || typeof coords.gridY !== 'number') {
                notifyUser("Error", "Invalid coordinates in template.");
                return;
            }
            
            // Get goToGridLocation using safe helper
            const goToGridLocation = getPageVariable('goToGridLocation');
            
            if (typeof goToGridLocation === 'function') {
                gpLog(`Teleporting to template location: ${coords.gridX}, ${coords.gridY}`);
                goToGridLocation(coords.gridX, coords.gridY);
            } else {
                notifyUser("Error", "Navigation function not available.");
                gpLog("ERROR: goToGridLocation function not found in window or unsafeWindow");
            }
        } catch (e) {
            dbgPush(`goToTemplateLocation failed to parse coordinates: ${e && e.message ? e.message : String(e)}`, { error: e, uiComponent: 'Ghost Template Manager - Go To Location button' });
            console.error("Failed to parse coordinates:", e);
            notifyUser("Error", "Failed to read template coordinates.");
        }
    }

    // Computes a SHA-256 fingerprint of the file content
    async function computeFileHash(blob) {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Computes a templateId from the clean image content (without position encoding)
    // This allows us to identify the same template even if it's been moved to different positions
    async function computeTemplateId(blob) {
        try {
            const img = await loadImageToCanvas(blob);
            const decoded = decodeRobustPosition(img);
            
            if (decoded && decoded.cleanCanvas) {
                // If position was encoded, use the clean canvas for ID
                const cleanBlob = await new Promise(r => decoded.cleanCanvas.toBlob(r, 'image/png'));
                return await computeFileHash(cleanBlob);
            } else {
                // No position encoding found, use original hash
                return await computeFileHash(blob);
            }
        } catch (e) {
            // On error, fall back to regular hash
            return await computeFileHash(blob);
        }
    }

    // ========== STYLES ==========
    const style = document.createElement('style');
    style.textContent = `
        .gp-to-modal-overlay {
            position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75);
            display: flex; align-items: center; justify-content: center; z-index: 10000;
        }
        .gp-to-modal-panel {
            background: var(--color-gray-100, white); color: var(--color-gray-900, inherit); border-radius: 1rem; padding: 1.5rem;
            width: 95%; max-width: 600px; max-height: 80vh;
            display: flex; flex-direction: column; gap: 1rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        .gp-to-header { display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--color-gray-300, #eee); padding-bottom: 10px; }
        .gp-to-header-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
        .gp-to-title { font-size: 1.25rem; font-weight: bold; color: var(--color-gray-900, #1f2937); }

        .gp-to-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
            gap: 10px; overflow-y: auto; padding: 4px;
        }
        .gp-to-card {
            border: 1px solid var(--color-gray-300, #e5e7eb); border-radius: 8px; overflow: hidden;
            position: relative; transition: transform 0.1s, box-shadow 0.1s;
            cursor: pointer; background: var(--color-gray-200, #f9fafb);
        }
        .gp-to-card:hover { transform: translateY(-2px); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-color: #3b82f6; }
        .gp-to-card img { width: 100%; height: 100px; object-fit: cover; display: block; }
        .gp-to-card-footer {
            padding: 4px; font-size: 10px; text-align: center;
            background: var(--color-gray-100, #fff); color: var(--color-gray-500, #6b7280); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .gp-to-delete-btn {
            position: absolute; top: 2px; right: 2px;
            background: rgba(239, 68, 68, 0.9); color: white;
            border: none; border-radius: 4px; width: 20px; height: 20px;
            display: flex; align-items: center; justify-content: center;
            font-size: 12px; cursor: pointer; z-index: 2;
            opacity: 0; transition: opacity 0.15s;
        }
        .gp-to-card:hover .gp-to-delete-btn { opacity: 1; }
        .gp-to-delete-btn:hover { background: #dc2626; }
        .gp-to-sel-btn {
            position: absolute; top: 2px; left: 2px;
            background: rgba(255,255,255,0.9); color: #374151;
            border: none; border-radius: 4px; width: 20px; height: 20px;
            display: flex; align-items: center; justify-content: center;
            font-size: 13px; cursor: pointer; z-index: 2; line-height: 1;
            opacity: 0; transition: opacity 0.15s;
        }
        .gp-to-card:hover .gp-to-sel-btn { opacity: 1; }
        .gp-to-sel-btn:hover { background: #dbeafe; }
        .gp-to-sel-btn.selected { background: #3b82f6; color: white; opacity: 1; }
        .gp-to-grid.gp-sel-active .gp-to-sel-btn { opacity: 1; }
        .gp-to-goto-btn {
            position: absolute; bottom: 22px; left: 2px;
            background: rgba(251, 146, 60, 0.92); color: white;
            border: none; border-radius: 4px; width: 20px; height: 20px;
            display: flex; align-items: center; justify-content: center;
            font-size: 11px; cursor: pointer; z-index: 2; line-height: 1;
            opacity: 0; transition: opacity 0.15s;
        }
        .gp-to-card:hover .gp-to-goto-btn { opacity: 1; }
        .gp-to-goto-btn:hover { background: rgba(234, 88, 12, 0.95); }
        .gp-to-card.gp-selected { border-color: #3b82f6; box-shadow: 0 0 0 2px #93c5fd; }

        .gp-to-btn {
            padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; border: none;
            display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
            transition: all 0.2s;
        }
        .gp-to-modal-panel .gp-to-btn { font-size: 0.75rem; }
        .gp-to-btn-blue { background-color: #3b82f6; color: white; }
        .gp-to-btn-blue:hover { background-color: #2563eb; }
        .gp-to-btn-green { background-color: #10b981; color: white; }
        .gp-to-btn-green:hover { background-color: #059669; }
        .gp-to-btn-purple { background-color: #8b5cf6; color: white; }
        .gp-to-btn-purple:hover { background-color: #7c3aed; }
        .gp-to-btn-red { background-color: #ef4444; color: white; }
        .gp-to-btn-gray { background-color: var(--color-gray-300, #e5e7eb); color: var(--color-gray-800, #374151); }
        .gp-to-btn-orange { background-color: #f97316; color: white; }
        .gp-to-btn-orange:hover { background-color: #ea580c; }
        .gp-to-btn-cyan { background-color: #06b6d4; color: white; border: 2px solid transparent; }
        .gp-to-btn-cyan:hover { background-color: #0891b2; }
        .gp-to-btn-cyan.active { 
            background-color: #0e7490; 
            border: 2px solid #fbbf24;
            box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.3);
        }

        .gp-to-preview-overlay {
            position: fixed;
            pointer-events: none;
            z-index: 9999;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
    `;
    document.head.appendChild(style);

    // ========== INDEXED DB (CACHE) ==========

    const dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            const txn = e.target.transaction;

            let store;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            } else {
                store = txn.objectStore(STORE_NAME);
            }

            if (!store.indexNames.contains('hash')) {
                store.createIndex('hash', 'hash', { unique: false });
            }
            if (!store.indexNames.contains('templateId')) {
                store.createIndex('templateId', 'templateId', { unique: false });
            }
        };

        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => {
            const err = new Error(`IndexedDB failed to open '${DB_NAME}' v${DB_VERSION}: ${e.target.error}`);
            dbgPush(`dbPromise rejected — IndexedDB unavailable: ${err.message}`, { error: err, uiComponent: 'Ghost Template Manager - IndexedDB init' });
            reject(err);
        };
    });

    const HistoryManager = {
        async add(blob, filename, groupNoise) {
            const db = await dbPromise;
            const hash = await computeFileHash(blob);
            const templateId = await computeTemplateId(blob);

            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const templateIndex = store.index('templateId');

                const req = templateIndex.get(templateId);

                req.onsuccess = () => {
                    const existing = req.result;

                    const item = {
                        blob: blob,
                        name: filename || `Image_${Date.now()}`,
                        date: Date.now(),
                        hash: hash,
                        templateId: templateId,
                        groupNoise: !!groupNoise
                    };

                    if (existing) {
                        // Update the existing record IN PLACE (same numeric id) rather
                        // than delete-then-recreate under a fresh autoincrement id.
                        // GeoPixelcons++'s Ghost++ Template Overlay's optional shared-
                        // library mode keys its own per-template state (position/mask/
                        // opacity/etc, stored separately from this history) by this exact
                        // numeric id — recreating it under a new id on every "reload the
                        // same template" click would silently orphan that state. getAll()
                        // below sorts by `date` rather than relying on id/insertion order
                        // for recency, since the id no longer changes on an update.
                        gpLog("Duplicate template detected (same image, possibly different position). Updating entry in place.");
                        item.id = existing.id;
                        store.put(item);
                    } else {
                        store.add(item);
                    }
                };

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        },
        async getAll() {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                // Sort by `date` (most recent first) rather than reversing insertion/
                // id order — add() now updates an existing record's `date` in place on
                // a duplicate match instead of always minting a new (higher) id, so id
                // order no longer tracks recency.
                req.onsuccess = () => resolve(req.result.sort((a, b) => b.date - a.date));
                tx.onerror = () => {
                    const err = new Error(`HistoryManager.getAll transaction failed: ${tx.error}`);
                    dbgPush(err.message, { error: err, uiComponent: 'Ghost Template Manager - HistoryManager.getAll' });
                    reject(err);
                };
            });
        },
        async delete(id) {
            const db = await dbPromise;
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).delete(id);
                tx.oncomplete = () => resolve();
            });
        },
        async clear() {
            const db = await dbPromise;
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).clear();
                tx.oncomplete = () => resolve();
            });
        }
    };

    // ========== IMPORT/EXPORT FUNCTIONS ==========

    // Helper function to convert blob to base64
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function exportToZip() {
        gpLog("exportToZip: Starting export...");
        const images = await HistoryManager.getAll();
        gpLog(`exportToZip: Retrieved ${images.length} images`);
        
        if (images.length === 0) {
            notifyUser("Info", "No images to export.");
            return;
        }

        // JSZip doesn't work in Tampermonkey sandbox - use JSON bundle instead
        gpLog("exportToZip: Using JSON bundle export (JSZip incompatible with this environment)");
        
        try {
            const exportData = {
                version: "3.5",
                exportDate: new Date().toISOString(),
                images: []
            };

            for (let i = 0; i < images.length; i++) {
                const imgData = images[i];
                gpLog(`Encoding image ${i+1}/${images.length}: ${imgData.name}`);

                const base64 = await blobToBase64(imgData.blob);

                exportData.images.push({
                    id: imgData.id,
                    name: imgData.name,
                    date: imgData.date,
                    hash: imgData.hash,
                    templateId: imgData.templateId,
                    imageData: base64,
                    mimeType: imgData.blob.type || 'image/png',
                    groupNoise: !!imgData.groupNoise
                });
            }

            gpLog(`exportToZip: Creating download...`);
            
            const jsonStr = JSON.stringify(exportData);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `GeoPixels_History_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            gpLog("exportToZip: Export complete");
            notifyUser("Success", `Exported ${images.length} images to JSON bundle.`);
        } catch (error) {
            dbgPush(`exportToZip failed: ${error && error.message ? error.message : String(error)}`, { error: error, uiComponent: 'Image History - Export All' });
            console.error("exportToZip failed:", error);
            gpLog(`exportToZip: ERROR - ${error.message}`);
            notifyUser("Error", "Failed to export: " + error.message);
        }
    }

    async function exportSelectedToJson(selectedIds) {
        if (selectedIds.size === 0) {
            notifyUser("Info", "No images selected.");
            return;
        }
        const images = await HistoryManager.getAll();
        const filtered = images.filter(img => selectedIds.has(img.id));
        if (filtered.length === 0) {
            notifyUser("Info", "No matching images found.");
            return;
        }
        try {
            const exportData = {
                version: "3.5",
                exportDate: new Date().toISOString(),
                images: []
            };
            for (let i = 0; i < filtered.length; i++) {
                const imgData = filtered[i];
                const base64 = await blobToBase64(imgData.blob);
                exportData.images.push({
                    id: imgData.id,
                    name: imgData.name,
                    date: imgData.date,
                    hash: imgData.hash,
                    templateId: imgData.templateId,
                    imageData: base64,
                    mimeType: imgData.blob.type || 'image/png',
                    groupNoise: !!imgData.groupNoise
                });
            }
            const jsonStr = JSON.stringify(exportData);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `GeoPixels_Selected_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            notifyUser("Success", `Exported ${filtered.length} image${filtered.length !== 1 ? 's' : ''}.`);
        } catch (error) {
            dbgPush(`exportSelectedToJson failed: ${error && error.message ? error.message : String(error)}`, { error: error, uiComponent: 'Image History - Export Selected' });
            console.error("exportSelectedToJson failed:", error);
            notifyUser("Error", "Failed to export: " + error.message);
        }
    }

    async function importFromZip(file) {
        try {
            gpLog(`importFromZip: Starting import of ${file.name}`);
            
            // Check if it's a JSON file (new format)
            if (file.name.endsWith('.json')) {
                gpLog("importFromZip: Detected JSON bundle format");
                const text = await file.text();
                const data = JSON.parse(text);
                
                if (!data.images || !Array.isArray(data.images)) {
                    notifyUser("Error", "Invalid JSON: 'images' array not found.");
                    return;
                }
                
                let imported = 0;
                for (const imgEntry of [...data.images].reverse()) {
                    // Convert base64 back to blob
                    const byteCharacters = atob(imgEntry.imageData);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: imgEntry.mimeType || 'image/png' });
                    
                    // Check for duplicate
                    const existingImages = await HistoryManager.getAll();
                    const isDuplicate = existingImages.some(img => img.hash === imgEntry.hash);
                    
                    if (!isDuplicate) {
                        // Older exports (pre-3.5) have no groupNoise field — default to
                        // disabled on import for backwards compatibility.
                        await HistoryManager.add(blob, imgEntry.name, !!imgEntry.groupNoise);
                        imported++;
                        gpLog(`Imported: ${imgEntry.name}`);
                    } else {
                        gpLog(`Skipped duplicate: ${imgEntry.name}`);
                    }
                }
                
                notifyUser("Success", `Imported ${imported} images from JSON bundle.`);
                return;
            }
            
            // Try ZIP format (legacy) - may not work
            gpLog("importFromZip: Attempting ZIP format (may fail)");
            const zip = await JSZip.loadAsync(file);
            const metadataFile = zip.file('metadata.json');

            if (!metadataFile) {
                notifyUser("Error", "Invalid ZIP: metadata.json not found.");
                return;
            }

            const metadataText = await metadataFile.async('text');
            const metadata = JSON.parse(metadataText);

            let imported = 0;
            for (const item of metadata) {
                const imageFile = zip.file(item.filename);
                if (imageFile) {
                    const blob = await imageFile.async('blob');
                    await HistoryManager.add(blob, item.name);
                    imported++;
                }
            }

            notifyUser("Success", `Imported ${imported} images from ZIP.`);
            return true;
        } catch (e) {
            console.error(e);
            notifyUser("Error", "Failed to import file.");
            return false;
        }
    }

    // ========== ALGORITHM (ENCODE/DECODE) ==========

    function encodeRobustPosition(originalCanvas, gridX, gridY) {
        const width = originalCanvas.width;
        const height = originalCanvas.height;
        const newCanvas = document.createElement('canvas');
        newCanvas.width = width;
        newCanvas.height = height + 1;
        const ctx = newCanvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(originalCanvas, 0, 1);
        const headerImage = ctx.getImageData(0, 0, width, 1);
        const data = headerImage.data;
        const valX = (gridX + POSITION_OFFSET) >>> 0;
        const valY = (gridY + POSITION_OFFSET) >>> 0;
        const packetSize = 5;
        const maxPackets = Math.floor(width / packetSize);
        for (let i = 0; i < maxPackets; i++) {
            const base = (i * packetSize) * 4;
            data[base] = MARKER_R; data[base + 1] = MARKER_G; data[base + 2] = MARKER_B; data[base + 3] = 255;
            data[base + 4] = (valX >>> 24) & 0xFF; data[base + 5] = (valX >>> 16) & 0xFF; data[base + 6] = 0; data[base + 7] = 255;
            data[base + 8] = (valX >>> 8) & 0xFF; data[base + 9] = valX & 0xFF; data[base + 10] = 0; data[base + 11] = 255;
            data[base + 12] = (valY >>> 24) & 0xFF; data[base + 13] = (valY >>> 16) & 0xFF; data[base + 14] = 0; data[base + 15] = 255;
            data[base + 16] = (valY >>> 8) & 0xFF; data[base + 17] = valY & 0xFF; data[base + 18] = 0; data[base + 19] = 255;
        }
        ctx.putImageData(headerImage, 0, 0);
        return newCanvas;
    }

    function decodeRobustPosition(img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const headerData = ctx.getImageData(0, 0, img.width, 1).data;
        const votesX = new Map();
        const votesY = new Map();
        let validPackets = 0;
        const packetSize = 5;
        const maxPackets = Math.floor(img.width / packetSize);
        for (let i = 0; i < maxPackets; i++) {
            const base = (i * packetSize) * 4;
            if (headerData[base] === MARKER_R && headerData[base + 1] === MARKER_G && headerData[base + 2] === MARKER_B && headerData[base + 3] === 255) {
                const xVal = ((headerData[base + 4] << 24) | (headerData[base + 5] << 16) | (headerData[base + 8] << 8) | headerData[base + 9]) >>> 0;
                const yVal = ((headerData[base + 12] << 24) | (headerData[base + 13] << 16) | (headerData[base + 16] << 8) | headerData[base + 17]) >>> 0;
                votesX.set(xVal, (votesX.get(xVal) || 0) + 1);
                votesY.set(yVal, (votesY.get(yVal) || 0) + 1);
                validPackets++;
            }
        }
        if (validPackets === 0) return null;
        const getWinner = (map) => [...map.entries()].reduce((a, b) => b[1] > a[1] ? b : a)[0];
        const gridX = getWinner(votesX) - POSITION_OFFSET;
        const gridY = getWinner(votesY) - POSITION_OFFSET;
        const cleanCanvas = document.createElement('canvas');
        cleanCanvas.width = img.width;
        cleanCanvas.height = img.height - 1;
        const cleanCtx = cleanCanvas.getContext('2d');
        cleanCtx.drawImage(canvas, 0, 1, img.width, img.height - 1, 0, 0, img.width, img.height - 1);
        return { gridX, gridY, cleanCanvas };
    }

    // ========== PREVIEW FUNCTIONALITY ==========

    let previewImageCache = null;
    let previewRenderHandler = null;

    function drawPreviewImageOnCanvas() {
        gpLog("drawPreviewImageOnCanvas called");
        
        if (!previewOverlay) {
            gpLog("No preview overlay, returning");
            return;
        }
        
        if (!previewActive) {
            gpLog("Preview not active, returning");
            return;
        }

        const savedImageData = localStorage.getItem('ghostImageData');
        const savedCoordsStr = localStorage.getItem('ghostImageCoords');
        
        if (!savedCoordsStr || !savedImageData) {
            gpLog("Missing ghost image data or coords in localStorage");
            return;
        }

        const coords = JSON.parse(savedCoordsStr);
        gpLog("Ghost coords", coords);
        
        // Use cached image to avoid reloading
        if (!previewImageCache || previewImageCache.src !== savedImageData) {
            previewImageCache = new Image();
            previewImageCache.src = savedImageData;
            gpLog("Loading new preview image");
        }
        
        const img = previewImageCache;
        if (!img.complete) {
            gpLog("Image not loaded yet, waiting...");
            img.onload = () => {
                gpLog("Image loaded, redrawing");
                drawPreviewImageOnCanvas();
            };
            return;
        }
        
        gpLog("Image loaded, dimensions:", { width: img.width, height: img.height });

        // Get required game variables
        const pixelCanvas = document.getElementById('pixel-canvas');
        if (!pixelCanvas) {
            gpLog("ERROR: pixel-canvas not found");
            return;
        }

        // Match canvas size to pixel canvas
        if (previewOverlay.width !== pixelCanvas.width || previewOverlay.height !== pixelCanvas.height) {
            previewOverlay.width = pixelCanvas.width;
            previewOverlay.height = pixelCanvas.height;
            gpLog("Resized preview canvas to", { width: pixelCanvas.width, height: pixelCanvas.height });
        }

        const ctx = previewOverlay.getContext('2d');
        const { width, height } = previewOverlay;
        ctx.clearRect(0, 0, width, height);
        gpLog("Cleared canvas");

        // Get map and turf using safe helper to avoid DOM element conflicts
        const map = getPageVariable('map');
        const turf = getPageVariable('turf');
        
        // gridSize is often 25 (standard grid size for geopixels)
        // Try to get from page, fallback to defaults
        let gridSize = getPageVariable('gridSize') || 25;
        let halfSize = getPageVariable('halfSize') || (gridSize / 2);
        let offsetMetersX = getPageVariable('offsetMetersX') || 0;
        let offsetMetersY = getPageVariable('offsetMetersY') || 0;
        
        gpLog("Grid values:", { gridSize, halfSize, offsetMetersX, offsetMetersY });

        if (!map || !turf) {
            gpLog("ERROR: Missing required variables", { 
                hasMap: !!map, 
                hasTurf: !!turf, 
                gridSize: gridSize 
            });
            return;
        }

        if (typeof map.project !== 'function') {
            gpLog("ERROR: map.project is not a function", { mapType: typeof map });
            return;
        }

        // Calculate corners using the SAME method as the game's drawGhostImageOnCanvas
        // Top-left pixel center
        const tl_pixel_center_x = coords.gridX * gridSize;
        const tl_pixel_center_y = coords.gridY * gridSize;

        // Top-left mercator edge
        const tl_merc_edge = [
            tl_pixel_center_x - halfSize + offsetMetersX,
            tl_pixel_center_y + halfSize + offsetMetersY
        ];

        // Bottom-right grid coordinates
        const br_pixel_gridX = coords.gridX + img.width - 1;
        const br_pixel_gridY = coords.gridY - img.height + 1;

        const br_pixel_center_x = br_pixel_gridX * gridSize;
        const br_pixel_center_y = br_pixel_gridY * gridSize;

        // Bottom-right mercator edge
        const br_merc_edge = [
            br_pixel_center_x + halfSize + offsetMetersX,
            br_pixel_center_y - halfSize + offsetMetersY
        ];
        
        gpLog("Mercator coords (ghost method)", { tl_merc_edge, br_merc_edge });

        // Convert to WGS84 and then project to screen
        const topLeftScreen = map.project(turf.toWgs84(tl_merc_edge));
        const bottomRightScreen = map.project(turf.toWgs84(br_merc_edge));
        
        gpLog("Screen coords", { topLeftScreen, bottomRightScreen });

        const drawX = topLeftScreen.x;
        const drawY = topLeftScreen.y;
        const screenWidth = bottomRightScreen.x - drawX;
        const screenHeight = bottomRightScreen.y - drawY;
        
        gpLog("Draw position and dimensions", { drawX, drawY, screenWidth, screenHeight });

        // Check if visible
        if (drawX + screenWidth < 0 || 
            drawX > width ||
            drawY + screenHeight < 0 || 
            drawY > height) {
            gpLog("Image not in viewport, skipping draw");
            return;
        }

        // Draw fully opaque
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, drawX, drawY, screenWidth, screenHeight);
        
        gpLog("Drew preview image successfully");
    }

    function togglePreview(button) {
        gpLog("togglePreview called, current state:", previewActive);
        gpLog("Button click - environment check:", {
            windowExists: typeof window !== 'undefined',
            unsafeWindowExists: typeof unsafeWindow !== 'undefined',
            windowKeys: typeof window !== 'undefined' ? Object.keys(window).filter(k => k.includes('map') || k.includes('turf')).slice(0, 10) : [],
            unsafeWindowKeys: typeof unsafeWindow !== 'undefined' ? Object.keys(unsafeWindow).filter(k => k.includes('map') || k.includes('turf')).slice(0, 10) : []
        });
        
        if (previewActive) {
            // Deactivate preview
            gpLog("Deactivating preview");
            
            if (previewOverlay && previewOverlay.parentNode) {
                previewOverlay.parentNode.removeChild(previewOverlay);
                gpLog("Removed preview overlay from DOM");
            }
            
            // Unhook from map events
            if (previewRenderHandler) {
                const map = getPageVariable('map');
                if (map && typeof map.off === 'function') {
                    try {
                        map.off('move', previewRenderHandler);
                        map.off('zoom', previewRenderHandler);
                        map.off('rotate', previewRenderHandler);
                        gpLog("Removed map event listeners");
                    } catch (e) {
                        gpLog("Error removing map listeners", e);
                    }
                }
            }
            
            previewOverlay = null;
            previewImageCache = null;
            previewRenderHandler = null;
            previewActive = false;
            button.innerHTML = '👁️ Preview';
            button.classList.remove('active');
            gpLog("Preview deactivated");
        } else {
            // Activate preview
            gpLog("Activating preview");
            
            const savedImageData = localStorage.getItem('ghostImageData');
            const savedCoordsStr = localStorage.getItem('ghostImageCoords');
            
            if (!savedImageData || !savedCoordsStr) {
                gpLog("ERROR: No ghost image data in localStorage");
                notifyUser("Error", "No ghost image on map to preview.");
                return;
            }

            gpLog("Found ghost data in localStorage");

            // Find the pixel canvas to match its size
            const pixelCanvas = document.getElementById('pixel-canvas');
            if (!pixelCanvas) {
                gpLog("ERROR: pixel-canvas not found");
                notifyUser("Error", "Pixel canvas not found. Make sure you're on the map view.");
                return;
            }

            gpLog("Found pixel canvas", { width: pixelCanvas.width, height: pixelCanvas.height });

            // Verify map exists
            const map = getPageVariable('map');
            if (!map) {
                gpLog("ERROR: map not found in any scope");
                notifyUser("Error", "Map not initialized yet. Please wait a moment and try again.");
                return;
            }
            
            gpLog("Map object found", { 
                mapType: typeof map, 
                hasProject: typeof map.project,
                isHTMLElement: map instanceof HTMLElement,
                constructor: map.constructor ? map.constructor.name : 'unknown'
            });

            if (typeof map.project !== 'function') {
                gpLog("ERROR: map.project is not a function", { 
                    mapType: typeof map,
                    projectType: typeof map.project,
                    mapKeys: Object.keys(map).slice(0, 20),
                    mapConstructor: map.constructor ? map.constructor.name : 'unknown'
                });
                notifyUser("Error", "Map projection not available. Page may not be fully loaded.");
                return;
            }
            
            gpLog("map.project verified as function");

            // Verify turf exists
            const turf = getPageVariable('turf');
            if (!turf) {
                gpLog("ERROR: turf not found in any scope");
                notifyUser("Error", "Turf.js library not loaded. Page may not be fully loaded.");
                return;
            }
            
            gpLog("Turf object found", { turfType: typeof turf, hasToWgs84: typeof turf.toWgs84 });

            if (typeof turf.toWgs84 !== 'function') {
                gpLog("ERROR: turf.toWgs84 is not a function", { 
                    turfType: typeof turf,
                    toWgs84Type: typeof turf.toWgs84,
                    turfKeys: Object.keys(turf).slice(0, 20)
                });
                notifyUser("Error", "Map projection not available. Page may not be fully loaded.");
                return;
            }
            
            gpLog("turf.toWgs84 verified as function");

            gpLog("Map and turf are ready with required functions");

            // Create preview canvas
            previewOverlay = document.createElement('canvas');
            previewOverlay.id = 'gp-preview-canvas';
            previewOverlay.className = 'pixel-perfect';
            previewOverlay.width = pixelCanvas.width;
            previewOverlay.height = pixelCanvas.height;
            previewOverlay.style.cssText = 'display: block; image-rendering: pixelated; position: absolute; top: 0; left: 0; pointer-events: none; z-index: 5;';

            gpLog("Created preview canvas element");

            // Insert into DOM - find the map container
            const mapContainer = map.getContainer ? map.getContainer() : document.getElementById('map');
            if (mapContainer) {
                mapContainer.appendChild(previewOverlay);
                gpLog("Appended preview canvas to map container");
            } else {
                document.body.appendChild(previewOverlay);
                gpLog("Appended preview canvas to body (fallback)");
            }
            
            previewActive = true;
            button.innerHTML = '👁️ Hide Preview';
            button.classList.add('active');

            // Create render handler
            previewRenderHandler = () => {
                gpLog("Map event triggered, redrawing preview");
                drawPreviewImageOnCanvas();
            };

            // Hook into map events (same as geopixels++)
            try {
                map.on('move', previewRenderHandler);
                map.on('zoom', previewRenderHandler);
                map.on('rotate', previewRenderHandler);
                gpLog("Attached to map events");
            } catch (e) {
                gpLog("ERROR attaching map listeners", e);
            }

            // Render once immediately
            gpLog("Drawing initial preview");
            drawPreviewImageOnCanvas();
            
            gpLog("Preview activated successfully");
        }
    }

    /**
     * Replicates the logic of the 'Save Pos' button to cache the currently placed ghost image.
     * This function is available globally but is no longer called automatically.
     */
    async function cacheCurrentGhostPosition() {
        const savedCoordsStr = localStorage.getItem('ghostImageCoords');
        const savedImageData = localStorage.getItem('ghostImageData');
        if (!savedCoordsStr || !savedImageData) {
            gpLog("Auto-Cache: No ghost image on map or coordinates found.");
            return;
        }
        gpLog("Auto-Cache: Starting cache process.");

        const coords = JSON.parse(savedCoordsStr);
        const img = new Image();
        img.src = savedImageData;
        await new Promise(r => img.onload = r);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width; tempCanvas.height = img.height;
        tempCanvas.getContext('2d').drawImage(img, 0, 0);

        const encodedCanvas = encodeRobustPosition(tempCanvas, coords.gridX, coords.gridY);
        encodedCanvas.toBlob(async (blob) => {
            if(!blob) return;

            // Save to History (Cache)
            try {
                await HistoryManager.add(blob, `Backup_${coords.gridX}_${coords.gridY}`, getGroupNoiseState());
                gpLog("Auto-Cache: Cached image with position data.");
                notifyUser("Auto-Cache", `Ghost image position ${coords.gridX}, ${coords.gridY} auto-cached.`);
            } catch (e) {
                dbgPush(`cacheCurrentGhostPosition HistoryManager.add failed: ${e && e.message ? e.message : String(e)}`, { error: e, uiComponent: 'Ghost Template Manager - Auto-Cache' });
                console.error("Auto-Cache failed", e);
                notifyUser("Auto-Cache Error", "Failed to auto-cache the image position.");
            }
        }, 'image/png');
    }
    // Expose for direct use if needed, but primarily used internally now
    window.cacheCurrentGhostPosition = cacheCurrentGhostPosition;


    // ========== GAME INTEGRATION ==========

    function applyCoordinatesToGame(coords) {
        gpLog("Applying coordinates...", coords);

        // Write coords to localStorage immediately so goToTemplateLocation and
        // any other readers have them right away — before the FileReader finishes.
        localStorage.setItem('ghostImageCoords', JSON.stringify(coords));

        // Poll until BOTH conditions are true:
        //   1. The place button is re-enabled (game's FileReader finished processing)
        //   2. ghostImageData is in localStorage (FileReader wrote it)
        // Only then call initializeGhostFromStorage — which reads the closure-scoped
        // `let ghostImageTopLeft` variable inside ghost22.js and is the only way to
        // reliably update it. Direct window property assignment does not reach it.
        let attempts = 0;
        const interval = setInterval(() => {
            const placeBtn = document.getElementById('initiatePlaceGhostBtn');
            const hasImageData = !!localStorage.getItem('ghostImageData');

            if (placeBtn && !placeBtn.disabled && hasImageData) {
                clearInterval(interval);

                const initializeGhostFromStorage = getPageVariable('initializeGhostFromStorage');
                if (typeof initializeGhostFromStorage === 'function') {
                    gpLog("Calling initializeGhostFromStorage (ghostImageData confirmed present)");
                    initializeGhostFromStorage();
                    notifyUser("Auto-Place", `Position detected: ${coords.gridX}, ${coords.gridY}`);
                } else {
                    const msg = `initializeGhostFromStorage not found in page scope — template loaded but coordinates not applied (${coords.gridX}, ${coords.gridY})`;
                    dbgPush(msg, { uiComponent: 'Ghost Template Manager - applyCoordinatesToGame' });
                    gpLog("ERROR: " + msg);
                    notifyUser("Warning", `Position set to ${coords.gridX}, ${coords.gridY} but auto-place failed. Click 'Place on Map' manually.`);
                }
            }

            if (++attempts > 100) {
                clearInterval(interval);
                const msg = `applyCoordinatesToGame timed out after 10s waiting for place button + ghostImageData (coords: ${coords.gridX}, ${coords.gridY}).`;
                dbgPush(msg, { uiComponent: 'Ghost Template Manager - applyCoordinatesToGame' });
                gpLog("Timeout: " + msg);
                notifyUser("Warning", `Position set to ${coords.gridX}, ${coords.gridY} but image may still be loading. Try clicking 'Place on Map' manually.`);
            }
        }, 100);
    }

    async function loadImageToCanvas(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    }

    // ========== PROCESSING LOGIC ==========

    async function processAndLoadImage(file, saveToHistory = true, uiComponent = null, restoreGroupNoise = undefined) {
        gpLog("Processing image...");
        const placeBtn = document.getElementById('initiatePlaceGhostBtn');
        if (placeBtn) { placeBtn.innerText = "Analyzing..."; placeBtn.disabled = true; }

        try {
            const img = await loadImageToCanvas(file);
            const decoded = decodeRobustPosition(img);

            let finalFile = file;
            let coords = null;

            if (decoded) {
                gpLog("Found encoded position.", { gridX: decoded.gridX, gridY: decoded.gridY });
                coords = { gridX: decoded.gridX, gridY: decoded.gridY };
                const cleanBlob = await new Promise((resolve, reject) => {
                    const toBlobTimeout = setTimeout(() => {
                        const err = new Error('cleanCanvas.toBlob timed out after 10s — canvas may be invalid or too large');
                        dbgPush(err.message, { error: err, uiComponent: uiComponent || 'Ghost Template Manager - processAndLoadImage' });
                        reject(err);
                    }, 10000);
                    decoded.cleanCanvas.toBlob(blob => {
                        clearTimeout(toBlobTimeout);
                        resolve(blob);
                    }, 'image/png');
                });
                finalFile = new File([cleanBlob], file.name || "ghost.png", { type: "image/png" });
            } else {
                gpLog("No encoded position found in image");
                // Ensure finalFile is a File (not a raw Blob from IndexedDB) —
                // DataTransferItemList.add() requires a File, not a Blob.
                if (!(finalFile instanceof File)) {
                    finalFile = new File([finalFile], 'ghost.png', { type: finalFile.type || 'image/png' });
                }
            }

            if (saveToHistory) {
                await HistoryManager.add(file, file.name, getGroupNoiseState());
            }

            // Restore the Group Noise checkbox *before* dispatching the native change
            // event — the game's own handler reads it asynchronously (FileReader ->
            // Image.onload -> extractAndMapColors) after this call returns, so setting
            // it now guarantees the correct value is in place whenever that fires.
            // If "Disable Group Noise" is on, disable-group-noise.js has already replaced
            // `checked` with a getter/setter that ignores writes, so this is naturally a
            // no-op and that setting always wins — no extra branching needed here.
            if (restoreGroupNoise !== undefined) {
                const groupNoiseToggle = document.getElementById('groupNoiseToggle');
                if (groupNoiseToggle) groupNoiseToggle.checked = !!restoreGroupNoise;
            }

            const input = document.getElementById('ghostImageInput');
            const dt = new DataTransfer();
            dt.items.add(finalFile);
            input.files = dt.files;

            isInternalUpdate = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            isInternalUpdate = false;

            // Wait for the game to process the image first
            await new Promise(resolve => setTimeout(resolve, 100));

            if (coords) {
                gpLog("Applying coordinates to game", coords);
                applyCoordinatesToGame(coords);
            } else {
                // No encoded position in this image — preserve any existing placement.
                // The user may have already manually placed a previous image; loading a
                // new image without coords should not silently erase that position.
                // Coords are only cleared by the explicit Clear button (clearGhostImage).
                gpLog("No encoded position found — existing coords preserved");
            }

        } catch (e) {
            dbgPush(`processAndLoadImage failed: ${e && e.message ? e.message : String(e)}`, { error: e, uiComponent: uiComponent || 'Ghost Template Manager' });
            console.error(e);
            notifyUser("Error", "Failed to process image.");
        } finally {
            if (placeBtn) placeBtn.innerText = "Place on Map";
        }
    }

    // ========== INTERCEPTOR ==========

    function setupNativeInterceptor() {
        const input = document.getElementById('ghostImageInput');
        if (!input) return;

        // 3. Add .zip to the file input's accepted types
        input.setAttribute('accept', 'image/png, image/jpeg, image/webp, image/gif, application/zip, .zip');

        input.addEventListener('change', async (e) => {
            if (isInternalUpdate) return;
            const file = e.target.files[0];
            if (!file) return;
            e.stopImmediatePropagation();
            e.preventDefault();

            // Check if it's a ZIP file
            if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || file.name.toLowerCase().endsWith('.zip')) {
                gpLog("Detected ZIP file upload");
                const success = await importFromZip(file);
                if (success) {
                    // Clear the input so same file can be uploaded again
                    input.value = '';
                }
                return;
            }

            // Otherwise process as image
            processAndLoadImage(file, false, 'Ghost Image Input - file picker');
        }, true);
    }

    // ========== UI HANDLERS ==========

    async function handleUrlUpload() {
        const url = prompt("Enter Image or ZIP URL:");
        if (!url) return;
        
        try {
            // Use GM_xmlhttpRequest to bypass CSP restrictions
            const blob = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'blob',
                    onload: (response) => {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.response);
                        } else {
                            reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
                        }
                    },
                    onerror: (error) => {
                        reject(new Error('Failed to fetch URL'));
                    },
                    ontimeout: () => {
                        reject(new Error('Request timed out'));
                    }
                });
            });

            // Check if it's a ZIP file
            if (blob.type === 'application/zip' || blob.type === 'application/x-zip-compressed' || url.toLowerCase().endsWith('.zip')) {
                gpLog("Detected ZIP file from URL");
                await importFromZip(blob);
                notifyUser("Success", "Imported cache from URL!");
                return;
            }

            // Otherwise treat as image
            if (!blob.type.startsWith('image/')) throw new Error("Invalid image");
            processAndLoadImage(new File([blob], "url_upload.png", { type: blob.type }), false, 'Ghost Template Manager - URL Upload');
        } catch (e) {
            dbgPush(`handleUrlUpload failed: ${e && e.message ? e.message : String(e)}`, { error: e, uiComponent: 'Ghost Template Manager - URL Upload' });
            console.error(e);
            notifyUser("Error", "Could not load file from URL: " + e.message);
        }
    }

    async function downloadWithPos() {
        const savedImageData = localStorage.getItem('ghostImageData');
        if (!savedImageData) {
            notifyUser("Error", "No ghost image loaded.");
            return;
        }
        
        const savedCoordsStr = localStorage.getItem('ghostImageCoords');
        const img = new Image();
        img.src = savedImageData;
        await new Promise(r => img.onload = r);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width; tempCanvas.height = img.height;
        tempCanvas.getContext('2d').drawImage(img, 0, 0);

        const groupNoise = getGroupNoiseState();

        if (savedCoordsStr) {
            // If coordinates exist, encode them and save
            const coords = JSON.parse(savedCoordsStr);
            const encodedCanvas = encodeRobustPosition(tempCanvas, coords.gridX, coords.gridY);
            encodedCanvas.toBlob(async (blob) => {
                if(!blob) return;

                // Save to History (Cache)
                try {
                    await HistoryManager.add(blob, `Backup_${coords.gridX}_${coords.gridY}`, groupNoise);
                    gpLog("Cached image with position data");
                    notifyUser("Success", "Template saved to history!");
                } catch (e) {
                    dbgPush(`downloadWithPos (with coords) HistoryManager.add failed: ${e && e.message ? e.message : String(e)}`, { error: e, uiComponent: 'Ghost Template Manager - Save Pos button' });
                    console.error("Cache failed", e);
                    notifyUser("Error", "Failed to save template");
                }
            }, 'image/png');
        } else {
            // No coordinates: just save the image as-is
            tempCanvas.toBlob(async (blob) => {
                if(!blob) return;

                try {
                    await HistoryManager.add(blob, `Image_${Date.now()}`, groupNoise);
                    gpLog("Cached image without position data");
                    notifyUser("Success", "Template saved to history!");
                } catch (e) {
                    dbgPush(`downloadWithPos (no coords) HistoryManager.add failed: ${e && e.message ? e.message : String(e)}`, { error: e, uiComponent: 'Ghost Template Manager - Save Pos button' });
                    console.error("Cache failed", e);
                    notifyUser("Error", "Failed to save template");
                }
            }, 'image/png');
        }
    }

    async function openHistoryModal() {
        const existing = document.getElementById('gp-history-modal');
        if (existing) existing.remove();

        const images = await HistoryManager.getAll();
        const modal = document.createElement('div');
        modal.id = 'gp-history-modal';
        modal.className = 'gp-to-modal-overlay';
        modal.innerHTML = `
            <div class="gp-to-modal-panel">
                <div class="gp-to-header">
                    <div class="gp-to-header-row">
                        <span class="gp-to-title">Image History (${images.length})</span>
                        <button id="gp-close-hist" class="gp-to-btn gp-to-btn-gray">Close</button>
                    </div>
                    <div class="gp-to-header-row">
                        <button id="gp-select-all" class="gp-to-btn gp-to-btn-blue">☑ Select All</button>
                        <button id="gp-select-none" class="gp-to-btn gp-to-btn-gray">☐ Select None</button>
                        <button id="gp-export-selected" class="gp-to-btn gp-to-btn-blue" disabled style="opacity:0.5">📤 Export Selected</button>
                        <button id="gp-import-zip" class="gp-to-btn gp-to-btn-green">📁 Import JSON</button>
                    </div>
                </div>
                <div class="gp-to-grid" id="gp-history-grid">
                    ${images.length === 0 ? '<p class="p-4 text-gray-500 col-span-full text-center">No images found.</p>' : ''}
                </div>
                <div style="border-top: 1px solid var(--color-gray-300, #eee); padding-top: 10px; display: flex; justify-content: flex-end;">
                    <button id="gp-clear-all" class="gp-to-btn gp-to-btn-red">🗑️ Clear All</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const grid = modal.querySelector('#gp-history-grid');
        const selectedIds = new Set();

        function updateExportSelBtn() {
            const btn = modal.querySelector('#gp-export-selected');
            if (!btn) return;
            if (selectedIds.size > 0) {
                btn.textContent = `📤 Export Selected (${selectedIds.size})`;
                btn.disabled = false;
                btn.style.opacity = '1';
                grid.classList.add('gp-sel-active');
            } else {
                btn.textContent = '📤 Export Selected';
                btn.disabled = true;
                btn.style.opacity = '0.5';
                grid.classList.remove('gp-sel-active');
            }
        }

        images.forEach(imgData => {
            const card = document.createElement('div');
            card.className = 'gp-to-card';
            card.dataset.imgId = imgData.id;
            card.innerHTML = `
                <button class="gp-to-delete-btn" title="Delete">✖</button>
                <button class="gp-to-sel-btn" title="Select for export">☐</button>
                <button class="gp-to-goto-btn" title="Load &amp; Go To">🎯</button>
                <img src="${URL.createObjectURL(imgData.blob)}" />
                <div class="gp-to-card-footer">${new Date(imgData.date).toLocaleTimeString()} - ${imgData.name.substring(0,12)}</div>
            `;
            card.onclick = async (e) => {
                if (e.target.closest('.gp-to-delete-btn')) return;
                if (e.target.closest('.gp-to-sel-btn')) return;
                if (e.target.closest('.gp-to-goto-btn')) return;
                await processAndLoadImage(imgData.blob, false, 'Image History - card click', imgData.groupNoise);
                await HistoryManager.add(imgData.blob, imgData.name, imgData.groupNoise);
                if (_settings.modernizeGhostPaletteBtns) loadRecentImages();
                modal.remove();
            };
            card.querySelector('.gp-to-delete-btn').onclick = async () => {
                await HistoryManager.delete(imgData.id);
                selectedIds.delete(imgData.id);
                updateExportSelBtn();
                card.remove();
            };
            card.querySelector('.gp-to-sel-btn').onclick = (e) => {
                e.stopPropagation();
                const selBtn = card.querySelector('.gp-to-sel-btn');
                if (selectedIds.has(imgData.id)) {
                    selectedIds.delete(imgData.id);
                    selBtn.textContent = '☐';
                    selBtn.classList.remove('selected');
                    card.classList.remove('gp-selected');
                } else {
                    selectedIds.add(imgData.id);
                    selBtn.textContent = '☑';
                    selBtn.classList.add('selected');
                    card.classList.add('gp-selected');
                }
                updateExportSelBtn();
            };
            card.querySelector('.gp-to-goto-btn').onclick = async (e) => {
                e.stopPropagation();
                // Decode coords from the image NOW before anything async happens,
                // so we have them in hand regardless of applyCoordinatesToGame's
                // setInterval timing.
                let coords = null;
                try {
                    const img = await loadImageToCanvas(imgData.blob);
                    const decoded = decodeRobustPosition(img);
                    if (decoded) coords = { gridX: decoded.gridX, gridY: decoded.gridY };
                } catch (_) {
                    dbgPush('Image History Load & Go To: failed to decode position from blob', { error: _, uiComponent: 'Image History - Load & Go To' });
                }
                modal.remove();
                await processAndLoadImage(imgData.blob, false, 'Image History - Load & Go To', imgData.groupNoise);
                await HistoryManager.add(imgData.blob, imgData.name, imgData.groupNoise);
                if (_settings.modernizeGhostPaletteBtns) loadRecentImages();
                if (coords) {
                    const goToGridLocation = getPageVariable('goToGridLocation');
                    if (typeof goToGridLocation === 'function') {
                        goToGridLocation(coords.gridX, coords.gridY);
                    }
                } else {
                    notifyUser("Load & Go", "No encoded coordinates found in this template.");
                }
            };
            grid.appendChild(card);
        });

        modal.querySelector('#gp-select-all').onclick = () => {
            images.forEach(imgData => {
                if (!selectedIds.has(imgData.id)) {
                    selectedIds.add(imgData.id);
                    const card = grid.querySelector(`[data-img-id="${imgData.id}"]`);
                    if (card) {
                        card.querySelector('.gp-to-sel-btn').textContent = '☑';
                        card.querySelector('.gp-to-sel-btn').classList.add('selected');
                        card.classList.add('gp-selected');
                    }
                }
            });
            updateExportSelBtn();
        };

        modal.querySelector('#gp-select-none').onclick = () => {
            selectedIds.clear();
            grid.querySelectorAll('.gp-to-card').forEach(card => {
                card.querySelector('.gp-to-sel-btn').textContent = '☐';
                card.querySelector('.gp-to-sel-btn').classList.remove('selected');
                card.classList.remove('gp-selected');
            });
            updateExportSelBtn();
        };

        modal.querySelector('#gp-export-selected').onclick = async () => {
            await exportSelectedToJson(new Set(selectedIds));
        };

        modal.querySelector('#gp-import-zip').onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json, .zip, application/json, application/zip'; // Accept JSON (new) and ZIP (legacy)
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    await importFromZip(file);
                    modal.remove();
                    openHistoryModal(); // Refresh the modal
                }
            };
            input.click();
        };

        modal.querySelector('#gp-clear-all').onclick = async () => {
            if(confirm("Clear all cached images?")) {
                await HistoryManager.clear();
                modal.remove();
            }
        };
        modal.querySelector('#gp-close-hist').onclick = () => modal.remove();
    }

    // ========== INJECTION ==========

    /**
     * Watches the document for the coordinate-setting success message
     * and triggers the auto-cache function.
     * This addresses issue #2.
     */
    function setupAlertBodyObserver() {
        const targetNode = document.getElementById('alertBody');
        if (!targetNode) {
             gpLog("Could not find alertBody for position observer.");
             return;
        }

        const observer = new MutationObserver((mutationsList, observer) => {
            for(const mutation of mutationsList) {
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    const textContent = targetNode.textContent;
                    if (textContent && textContent.includes("Ghost image position set")) {
                        gpLog("Detected 'Ghost image position set'. Triggering auto-cache.");
                        cacheCurrentGhostPosition();
                        // Disconnect after first success to avoid spamming the cache,
                        // as a new observer will be created when the modal is opened next.
                        observer.disconnect();
                        break;
                    }
                }
            }
        });

        // Start observing the target node for configured mutations
        const config = { childList: true, subtree: true, characterData: true };
        observer.observe(targetNode, config);
    }

    const GPC_GHOST_POS_KEY = 'gpc-ghost-modal-pos';
    let _ghostModalPosSaveTimer = null;

    function rememberGhostModalEnabled() {
        if (typeof gpcMobileCompatibilityActive === 'function' && gpcMobileCompatibilityActive()) return false;
        return !!(_settings.ghostTemplateManager && _settings.rememberGhostModalPos);
    }

    function getSavedGhostModalRect() {
        try {
            const saved = JSON.parse(localStorage.getItem(GPC_GHOST_POS_KEY) || 'null');
            return saved && typeof saved === 'object' ? saved : null;
        } catch (_) {
            return null;
        }
    }

    function restoreGhostModalPlacement(modal) {
        if (!modal || !rememberGhostModalEnabled()) return false;
        const saved = getSavedGhostModalRect();
        if (!saved) return false;

        modal.dataset.gpcRememberRestoring = '1';
        if (saved.top)    modal.style.top = saved.top;
        if (saved.left)   modal.style.left = saved.left;
        if (saved.width)  modal.style.width = saved.width;
        if (saved.height) modal.style.height = saved.height;
        if (saved.top || saved.left) modal.style.transform = 'none';
        setTimeout(() => { delete modal.dataset.gpcRememberRestoring; }, 120);
        return true;
    }

    function saveGhostModalPlacement(modal) {
        if (!modal || !rememberGhostModalEnabled() || modal.dataset.gpcRememberRestoring) return;
        const rect = modal.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        // When the preview is collapsed the live width is the narrow collapsed width;
        // persist the expanded equivalent so reload doesn't pin a collapsed width.
        const collapsed = modal.dataset.gpcPreviewCollapsed === '1';
        const widthVal = (collapsed && modal.dataset.gpcExpandedWidth)
            ? modal.dataset.gpcExpandedWidth
            : (modal.style.width || `${Math.round(rect.width)}px`);
        localStorage.setItem(GPC_GHOST_POS_KEY, JSON.stringify({
            top:    modal.style.top    || `${Math.round(rect.top)}px`,
            left:   modal.style.left   || `${Math.round(rect.left)}px`,
            width:  widthVal,
            height: modal.style.height || `${Math.round(rect.height)}px`,
        }));
    }

    function scheduleGhostModalPlacementSave(modal) {
        clearTimeout(_ghostModalPosSaveTimer);
        _ghostModalPosSaveTimer = setTimeout(() => saveGhostModalPlacement(modal), 350);
    }

    function patchGhostModalToggleForRemembering() {
        const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (w.__gpcGhostModalRememberPatchQueued) return;
        w.__gpcGhostModalRememberPatchQueued = true;

        const watchStartedAt = Date.now();
        function tryPatch() {
            if (typeof w.toggleGhostModal !== 'function') {
                if (Date.now() - watchStartedAt >= 15000) {
                    dbgPush('Ghost Template Manager: gave up after 15s -- w.toggleGhostModal was never found, so the ghost modal position could not be patched for remembering.', { uiComponent: 'Ghost Template Manager' });
                    console.error('[GeoPixelcons++] Ghost Template Manager: never found w.toggleGhostModal to patch for remembering ghost modal position.');
                    return;
                }
                setTimeout(tryPatch, 500);
                return;
            }
            if (w.toggleGhostModal.__gpcRememberPatched) return;
            dbgPush('Ghost Template Manager: w.toggleGhostModal found ' + (Date.now() - watchStartedAt) + 'ms after watching started -- patching now.', { uiComponent: 'Ghost Template Manager' });
            const originalToggleGhostModal = w.toggleGhostModal;
            w.toggleGhostModal = function (...args) {
                const result = originalToggleGhostModal.apply(this, args);
                if (args[0] !== false && rememberGhostModalEnabled()) {
                    const modal = document.getElementById('ghostImageModal');
                    setupGhostModalPlacementMemory(modal);
                    [0, 60, 180].forEach(delay => setTimeout(() => {
                        restoreGhostModalPlacement(modal);
                    }, delay));
                }
                return result;
            };
            w.toggleGhostModal.__gpcRememberPatched = true;
        }
        tryPatch();
    }

    function installGhostPlacementAutoHide() {
        if (document.documentElement.dataset.gpcGhostPlacementAutoHide) return;
        document.documentElement.dataset.gpcGhostPlacementAutoHide = '1';

        const script = document.createElement('script');
        script.textContent = `(function(){
if(window.__gpcToolModeEventPatch)return;
window.__gpcToolModeEventPatch=true;
var watchStartedAt=Date.now();
function patch(){
    if(typeof setToolMode!=='function'){
        if(Date.now()-watchStartedAt>=15000){
            if(window.__gpcDebugBridge&&window.__gpcDebugBridge.isEnabled()){
                window.__gpcDebugBridge.push('Ghost Template Manager: gave up after 15s -- setToolMode was never found, so the toolModeChanged event patch could not be applied.',{uiComponent:'Ghost Template Manager'});
            }
            console.error('[GeoPixelcons++] Ghost Template Manager: never found setToolMode to patch for the toolModeChanged event.');
            return;
        }
        setTimeout(patch,500);
        return;
    }
    if(setToolMode.__gpcToolModeEventPatched)return;
    if(window.__gpcDebugBridge&&window.__gpcDebugBridge.isEnabled()){
        window.__gpcDebugBridge.push('Ghost Template Manager: setToolMode found '+(Date.now()-watchStartedAt)+'ms after watching started -- patching now.',{uiComponent:'Ghost Template Manager'});
    }
    var original=setToolMode;
    window.setToolMode=function(tool){
        var result=original.apply(this,arguments);
        document.dispatchEvent(new CustomEvent('gpc:toolModeChanged',{detail:{tool:tool}}));
        return result;
    };
    window.setToolMode.__gpcToolModeEventPatched=true;
}
patch();
})();`;
        document.head.appendChild(script);
        script.remove();

        let hiddenForPlacement = null;
        let restoreTimer = null;
        const restore = () => {
            if (!hiddenForPlacement) return;
            clearTimeout(restoreTimer);
            hiddenForPlacement.classList.remove('hidden');
            delete hiddenForPlacement.dataset.gpcHiddenForPlacement;
            hiddenForPlacement = null;
        };

        document.addEventListener('click', e => {
            const btn = e.target && e.target.closest ? e.target.closest('#initiatePlaceGhostBtn') : null;
            if (!btn || !e.isTrusted || btn.disabled) return;
            setTimeout(() => {
                const modal = document.getElementById('ghostImageModal');
                if (!modal) return;
                hiddenForPlacement = modal;
                modal.dataset.gpcHiddenForPlacement = '1';
                modal.classList.add('hidden');
                clearTimeout(restoreTimer);
                restoreTimer = setTimeout(restore, 60000);
            }, 0);
        }, true);

        document.addEventListener('gpc:toolModeChanged', e => {
            if (!hiddenForPlacement) return;
            if (!e.detail || e.detail.tool !== 'ghostPlacement') restore();
        });
    }

    function setupGhostModalPlacementMemory(modal) {
        if (!modal || !rememberGhostModalEnabled()) return;
        patchGhostModalToggleForRemembering();
        if (!modal.dataset.gpcRememberObserver) {
            modal.dataset.gpcRememberObserver = '1';
            new MutationObserver(() => scheduleGhostModalPlacementSave(modal))
                .observe(modal, { attributes: true, attributeFilter: ['style'] });
        }
        [0, 80, 240].forEach(delay => setTimeout(() => restoreGhostModalPlacement(modal), delay));
    }

    function injectControls() {
        const modal = document.getElementById('ghostImageModal');
        if (!modal) return;
        const container = modal.querySelector('.flex.flex-wrap.items-center.justify-center.gap-3');
        if (!container || container.dataset.gpInjected) return;
        container.dataset.gpInjected = "true";
        patchGhostModalToggleForRemembering();
        setupGhostModalPlacementMemory(modal);
        installGhostPlacementAutoHide();

        // 1. Remove the 'hidden' class from the hexDisplay span
        const hexDisplay = document.getElementById('hexDisplay');
        if (hexDisplay) {
            hexDisplay.classList.remove('hidden');
            gpLog("Removed 'hidden' class from hexDisplay.");
        }

        setupNativeInterceptor();

        const btnUrl = document.createElement('button');
        btnUrl.innerHTML = '🔗 URL'; btnUrl.className = 'gp-to-btn gp-to-btn-blue shadow';
        btnUrl.title = 'Load from URL (Image or ZIP)';
        btnUrl.onclick = handleUrlUpload;

        const btnLocal = document.createElement('button');
        btnLocal.innerHTML = '📂 File'; btnLocal.className = 'gp-to-btn gp-to-btn-green shadow';
        btnLocal.title = 'Upload Image or ZIP';
        // Note: The click handler for this just triggers the native input, which we intercept.
        btnLocal.onclick = () => document.getElementById('ghostImageInput').click();

        const btnHist = document.createElement('button');
        btnHist.innerHTML = '📜 History'; btnHist.className = 'gp-to-btn gp-to-btn-purple shadow';
        btnHist.onclick = openHistoryModal;

        const btnDL = document.createElement('button');
        btnDL.innerHTML = '💾 Save'; btnDL.className = 'gp-to-btn gp-to-btn-gray shadow';
        btnDL.onclick = downloadWithPos;

        const btnPreview = document.createElement('button');
        btnPreview.innerHTML = '👁️ Preview'; 
        btnPreview.className = 'gp-to-btn gp-to-btn-cyan shadow';
        btnPreview.title = 'Toggle image preview overlay';
        btnPreview.onclick = () => togglePreview(btnPreview);

        const btnGoTo = document.createElement('button');
        btnGoTo.innerHTML = '🎯 Go To'; 
        btnGoTo.className = 'gp-to-btn gp-to-btn-orange shadow';
        btnGoTo.title = 'Teleport to template location';
        btnGoTo.onclick = goToTemplateLocation;

        container.prepend(btnGoTo);
        container.prepend(btnPreview);
        container.prepend(btnDL);
        container.prepend(btnHist);
        container.prepend(btnLocal);
        container.prepend(btnUrl);

        // Auto-caching disabled - user must manually press Save Pos button
        // setupAlertBodyObserver();
    }

    const observer = new MutationObserver(() => injectControls());
    observer.observe(document.body, { childList: true, subtree: true });

    document.querySelector('label[for="ghostImageInput"]')?.classList.add('hidden');

    // ── Ghost Menu UI Overhaul ──────────────────────────────────────
    if (_settings.modernizeGhostPaletteBtns) {
        const MODERN_BTN_ORDER = [
            'Toggle All',
            'Set Palette',
            'Match My Palette',
            'Bulk Purchase Colors',
            'Enable Only Owned Ghost Colors',
            'Get Ghost Colors',
            'Get Enabled Ghost Colors',
            'Set Enabled Ghost Colors',
            'Enable filtered',
            'Enable owned and filtered',
        ];

        const BTN_COLORS = {
            'Toggle All':                      { bg: '#bfdbfe', hover: '#93c5fd', fg: '#1e3a8a' },
            'Set Palette':                     { bg: '#bbf7d0', hover: '#86efac', fg: '#14532d' },
            'Match My Palette':                { bg: '#bbf7d0', hover: '#86efac', fg: '#14532d' },
            'Bulk Purchase Colors':            { bg: '#e9d5ff', hover: '#d8b4fe', fg: '#581c87' },
            'Enable Only Owned Ghost Colors':  { bg: '#fbcfe8', hover: '#f9a8d4', fg: '#831843' },
            'Get Ghost Colors':                { bg: '#fbcfe8', hover: '#f9a8d4', fg: '#831843' },
            'Get Enabled Ghost Colors':        { bg: '#fbcfe8', hover: '#f9a8d4', fg: '#831843' },
            'Set Enabled Ghost Colors':        { bg: '#fbcfe8', hover: '#f9a8d4', fg: '#831843' },
            'Enable filtered':                 { bg: '#fed7aa', hover: '#fdba74', fg: '#7c2d12' },
        };
        BTN_COLORS['Enable owned and filtered'] = BTN_COLORS['Enable filtered'];

        function styleModernBtn(btn, label) {
            if (btn.dataset.gpcStyled) return;
            btn.dataset.gpcStyled = '1';
            btn.className = '';
            const c = BTN_COLORS[label] || { bg: '#e2e8f0', hover: '#cbd5e1', fg: '#334155' };
            Object.assign(btn.style, {
                fontSize: '12px', fontWeight: '600',
                padding: '6px 8px', borderRadius: '6px',
                border: 'none', cursor: 'pointer',
                background: c.bg, color: c.fg,
                transition: 'background 0.15s',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: '1.3',
                boxShadow: 'none', width: '100%',
                textAlign: 'center',
            });
            if (!btn.title) btn.title = label;
            btn.addEventListener('mouseenter', () => { btn.style.background = c.hover; });
            btn.addEventListener('mouseleave', () => { btn.style.background = c.bg; });
        }

        // ── Inject CSS overrides for gp-to-btn colors (one-time) ─────
        if (!document.getElementById('gpc-modern-gp-btn-style')) {
            const s = document.createElement('style');
            s.id = 'gpc-modern-gp-btn-style';
            s.textContent = `
                [data-gp-injected] button, #gpc-modern-gp-grid button {
                    font-size:12px!important; font-weight:600!important;
                    padding:6px 8px!important; border-radius:6px!important;
                    box-shadow:none!important; width:100%!important;
                    white-space:nowrap!important; overflow:hidden!important;
                    text-overflow:ellipsis!important; line-height:1.3!important;
                    text-align:center!important;
                }
                .gp-to-btn-blue   { background-color:#bfdbfe!important; color:#1e3a8a!important; }
                .gp-to-btn-blue:hover { background-color:#93c5fd!important; }
                .gp-to-btn-green  { background-color:#bbf7d0!important; color:#14532d!important; }
                .gp-to-btn-green:hover { background-color:#86efac!important; }
                .gp-to-btn-purple { background-color:#e9d5ff!important; color:#581c87!important; }
                .gp-to-btn-purple:hover { background-color:#d8b4fe!important; }
                .gp-to-btn-gray   { background-color:#f1f5f9!important; color:#475569!important; }
                .gp-to-btn-gray:hover { background-color:#e2e8f0!important; }
                .gp-to-btn-orange { background-color:#fed7aa!important; color:#7c2d12!important; }
                .gp-to-btn-orange:hover { background-color:#fdba74!important; }
                .gp-to-btn-cyan   { background-color:#a5f3fc!important; color:#164e63!important; border:none!important; }
                .gp-to-btn-cyan:hover { background-color:#67e8f9!important; }
                .gp-to-btn-cyan.active { background-color:#0e7490!important; color:#ecfeff!important; border:2px solid #fbbf24!important; box-shadow:0 0 0 3px rgba(251,191,36,.3)!important; }
                .gp-to-btn-red    { background-color:#fecaca!important; color:#991b1b!important; }
                .gp-to-btn-red:hover { background-color:#fca5a5!important; }
                #initiatePlaceGhostBtn { background-color:#bbf7d0!important; color:#14532d!important; }
                #initiatePlaceGhostBtn:hover:not(:disabled) { background-color:#86efac!important; }
                #clearGhostImageBtn    { background-color:#fecaca!important; color:#991b1b!important; }
                #clearGhostImageBtn:hover:not(:disabled) { background-color:#fca5a5!important; }
                #_z_dock_btn { background-color:#c7d2fe!important; color:#312e81!important; }
                #_z_dock_btn:hover { background-color:#a5b4fc!important; }
            `;
            document.head.appendChild(s);
        }

        function applyModernPaletteButtons() {
            const container = document.getElementById('ghostColorPaletteContainer');
            if (!container) return;

            // Remove the ✚₊ collapse toggle and unhide all siblings each time it appears
            container.querySelectorAll('button[data-expanded]').forEach(toggleBtn => {
                let sib = toggleBtn.nextElementSibling;
                while (sib) {
                    if (sib.tagName === 'BUTTON') sib.style.removeProperty('display');
                    sib = sib.nextElementSibling;
                }
                toggleBtn.remove();
            });

            // Collect all action buttons — exclude swatches and search input area,
            // but include the Enable filtered button from .gpc-filtered-row
            const allBtns = Array.from(container.querySelectorAll('button')).filter(btn => {
                if (btn.closest('#ghostColorPalette')) return false;
                if (btn.closest('.color-search-container')) return false;
                if (btn.id === 'gpc-modern-btn-grid') return false;
                return true;
            });

            // Skip if nothing has changed since last run
            const sig = allBtns.map(b => b.textContent.trim()).sort().join('|');
            if (container.dataset.gpcSig === sig) return;
            container.dataset.gpcSig = sig;

            // Build label → button map
            const btnMap = new Map();
            allBtns.forEach(btn => btnMap.set(btn.textContent.trim(), btn));

            // Find or create the 2-column grid
            let grid = document.getElementById('gpc-modern-btn-grid');
            if (!grid) {
                grid = document.createElement('div');
                grid.id = 'gpc-modern-btn-grid';
                grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 0 8px 0;';
                const h3 = container.querySelector('h3');
                if (h3) h3.insertAdjacentElement('afterend', grid);
                else container.prepend(grid);
            }

            // Move buttons into the grid in the specified order
            MODERN_BTN_ORDER.forEach(label => {
                const btn = btnMap.get(label);
                if (!btn) return;
                styleModernBtn(btn, label);
                grid.appendChild(btn);
            });

            // Hide the now-empty .gpc-filtered-row (its button moved to the grid)
            const filteredRow = container.querySelector('.gpc-filtered-row');
            if (filteredRow && !filteredRow.querySelector('button')) {
                filteredRow.style.display = 'none';
            }

            // Remove now-empty wrapper divs left by the site's layout.
            // Protect any div with an id (ghostColorPalette, etc.) and the search/filter UI.
            Array.from(container.querySelectorAll(':scope > div')).forEach(div => {
                if (div.id) return; // never remove a named element
                if (div.closest('.color-search-container') || div.closest('.gpc-filtered-row')) return;
                if (div.querySelector('button, input, label, select')) return;
                div.remove();
            });
        }

        // ── 4-column grid for the gp-injected action buttons ─────────
        function applyModernGpButtons() {
            const injectedDiv = document.querySelector('[data-gp-injected="true"]');
            if (!injectedDiv) return;

            const allBtns = Array.from(injectedDiv.querySelectorAll('button'));
            if (!allBtns.length) return;

            const sig = allBtns.map(b => (b.id || '') + b.textContent.trim()).sort().join('|');
            if (injectedDiv.dataset.gpcGpSig === sig) return;
            injectedDiv.dataset.gpcGpSig = sig;

            let grid = document.getElementById('gpc-modern-gp-grid');
            if (!grid) {
                grid = document.createElement('div');
                grid.id = 'gpc-modern-gp-grid';
                grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:0 0 8px 0;';
                injectedDiv.parentNode.insertBefore(grid, injectedDiv);
            }

            allBtns.forEach(btn => grid.appendChild(btn));
            injectedDiv.style.display = 'none';
        }

        const paletteContainerObs = new MutationObserver(() => {
            applyModernPaletteButtons();
            applyModernGpButtons();
            applyModernGhostModalLayout();
        });
        paletteContainerObs.observe(document.body, { childList: true, subtree: true });
        applyModernPaletteButtons();
        applyModernGpButtons();
        applyModernGhostModalLayout();
    }

    // ── Full Ghost Modal Layout Overhaul ─────────────────────────────────
    // (runs independently of modernizeGhostPaletteBtns / Ghost Menu UI Overhaul; called above when that setting is on)
    let _recentBlobUrls = [];
    let _recentLimit = 10;

    function applyModernGhostModalLayout() {
        const modal = document.getElementById('ghostImageModal');
        if (!modal || modal.dataset.gpcModernModal) return;
        // Wait until injectControls has injected the buttons
        if (!modal.querySelector('[data-gp-injected]')) return;
        modal.dataset.gpcModernModal = '1';

        const dark = () => document.body.classList.contains('dark');

        // ── CSS for children only — no width/height rules on the modal itself here.
        //   The modal's own dimensions are set via inline styles below (after stripping
        //   the conflicting Tailwind classes). This way the resize handler can simply
        //   write modal.style.width / modal.style.height with no !important fights.
        if (!document.getElementById('gpc-modal-layout-style')) {
            const s = document.createElement('style');
            s.id = 'gpc-modal-layout-style';
            s.textContent = `
                #gpc-modal-left {
                    flex: 1 1 0;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    transition: width 0.22s ease, flex-basis 0.22s ease, opacity 0.18s ease;
                }
                #gpc-modal-left-scroll {
                    flex: 1 1 0;
                    min-height: 0;
                    overflow-y: auto;
                    padding: 10px 14px;
                }
                #gpc-modal-right {
                    width: 280px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    transition: width 0.22s ease, opacity 0.18s ease;
                }
                #ghostImageModal.gpc-preview-animating {
                    transition: width 0.22s ease;
                    overflow: hidden;
                }
                #ghostImageModal.gpc-preview-collapsed {
                    width: var(--gpc-collapsed-width) !important;
                }
                #ghostImageModal.gpc-preview-expanded {
                    width: var(--gpc-expanded-width) !important;
                }
                #gpc-modal-right.gpc-collapsed {
                    width: 34px !important;
                    opacity: 0.95;
                }
                #gpc-modal-right.gpc-collapsed #gpc-modal-right-content {
                    opacity: 0;
                    pointer-events: none;
                }
                #gpc-modal-right.gpc-collapsed .gpc-collapse-label { display: none !important; }
                #gpc-modal-right-content {
                    flex: 1 1 0;
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    opacity: 1;
                    transition: opacity 0.12s ease;
                }
                #gpc-recent-grid {
                    display: grid;
                    grid-template-columns: repeat(5, minmax(0, 1fr));
                    grid-auto-rows: var(--gpc-recent-cell-size, 48px);
                    gap: 3px;
                    padding: 4px 8px 8px;
                    overflow-y: auto;
                    overflow-x: hidden;
                    flex: 1 1 0;
                    min-height: 0;
                    align-content: start;
                    justify-items: stretch;
                }
                /* Remove the palette's hardcoded max-height so it expands with content */
                #ghostColorPalette {
                    max-height: none !important;
                    overflow-y: visible !important;
                }
                /* Action buttons grid inside the right panel — force 2-col minimum */
                #gpc-modal-right #gpc-modern-gp-grid {
                    display: grid !important;
                    grid-template-columns: repeat(2, 1fr) !important;
                    gap: 4px !important;
                    padding: 4px 0 !important;
                }
                /* Edge drag strips */
                .gpc-edge-drag {
                    position: absolute;
                    z-index: 102;
                    pointer-events: auto;
                    cursor: grab;
                }
                .gpc-edge-drag:active { cursor: grabbing; }
                .gpc-edge-drag.top    { top: 0;    left: 12px; right: 12px; height: 12px; }
                .gpc-edge-drag.bottom { bottom: 0; left: 12px; right: 30px; height: 12px; }
                .gpc-edge-drag.left   { left: 0;   top: 12px;  bottom: 12px; width: 12px; }
                /* .right is a child of #gpc-modal-right, not modal — see JS below */
                .gpc-edge-drag.right  { right: 0;  top: 0; bottom: 30px; width: 12px; z-index: 50; }
                /* Panel splitter — left edge of #gpc-modal-right, drag to resize the split */
                .gpc-panel-splitter {
                    position: absolute;
                    left: -4px; top: 0; bottom: 0;
                    width: 8px;
                    cursor: ew-resize;
                    z-index: 106;
                    background: transparent;
                    transition: background 0.15s;
                }
                .gpc-panel-splitter:hover,
                .gpc-panel-splitter.gpc-ps-dragging {
                    background: rgba(99,102,241,0.25);
                }
                #gpc-modal-right.gpc-collapsed .gpc-panel-splitter { display: none; }
                /* Horizontal preview-height resize strip */
                .gpc-preview-hresize {
                    flex-shrink: 0;
                    height: 8px;
                    cursor: ns-resize;
                    position: relative;
                    z-index: 10;
                    background: transparent;
                    transition: background 0.15s;
                }
                .gpc-preview-hresize::after {
                    content: '';
                    position: absolute;
                    left: 12px; right: 12px;
                    top: 50%; transform: translateY(-50%);
                    height: 1px;
                    background: var(--color-gray-200, #e5e7eb);
                    transition: background 0.15s;
                }
                .gpc-preview-hresize:hover,
                .gpc-preview-hresize.gpc-ps-dragging {
                    background: rgba(99,102,241,0.15);
                }
                .gpc-preview-hresize:hover::after,
                .gpc-preview-hresize.gpc-ps-dragging::after {
                    background: rgba(99,102,241,0.6);
                }
                /* SE resize grip — bottom-right corner only, like guild modal */
                .gpc-resize-se {
                    position: absolute;
                    bottom: 0; right: 0;
                    width: 20px; height: 20px;
                    cursor: nwse-resize;
                    z-index: 101;
                    border-radius: 0 0 1rem 0;
                    background: linear-gradient(135deg, transparent 50%, #94a3b8 50%);
                    opacity: 0.5;
                    pointer-events: auto;
                    transition: opacity 0.15s;
                }
                .gpc-resize-se:hover { opacity: 1; }
            `;
            document.head.appendChild(s);
        }

        // Strip the Tailwind classes that fight with our layout so plain inline styles win.
        ['w-[90%]', 'max-w-lg', 'p-6', 'max-h-[90vh]', 'cursor-move'].forEach(c => modal.classList.remove(c));
        // Set initial modal dimensions as plain inline styles (no !important needed now).
        Object.assign(modal.style, {
            width:        'min(92vw, 800px)',
            height:       '75vh',
            maxWidth:     'none',
            maxHeight:    'none',
            minWidth:     '480px',
            minHeight:    '320px',
            flexDirection:'row',
            gap:          '0',
            padding:      '0',
            alignItems:   'stretch',
        });
        // ── Locate existing DOM nodes ─────────────────────────────
        const closeBtn   = modal.querySelector('button[onclick*="toggleGhostModal"]');
        const h2         = modal.querySelector('h2');
        const scrollArea = modal.querySelector('.flex-grow.overflow-y-auto, .overflow-y-auto');

        // Find the preview container: get the DIRECT parent of #ghostPreviewImage,
        // not just any ancestor (querySelectorAll picks the outermost wrapper first).
        let previewContainer = null;
        if (scrollArea) {
            const _pImg = scrollArea.querySelector('#ghostPreviewImage');
            if (_pImg) {
                previewContainer = _pImg.parentElement;
            } else {
                previewContainer = scrollArea.querySelector('[class*="border-dashed"]');
            }
        }
        if (previewContainer?.parentNode) previewContainer.parentNode.removeChild(previewContainer);

        // Extract the buttons grid.
        // applyModernGpButtons() runs first and moves all buttons from [data-gp-injected]
        // into #gpc-modern-gp-grid, leaving the original div hidden. Grab the grid;
        // fall back to the raw injected div if the grid hasn't been created yet.
        const buttonsRow = scrollArea
            ? (scrollArea.querySelector('#gpc-modern-gp-grid') || scrollArea.querySelector('[data-gp-injected]'))
            : null;
        if (buttonsRow?.parentNode) buttonsRow.parentNode.removeChild(buttonsRow);
        // Also detach the now-empty (hidden) injected wrapper so it doesn't linger in scrollArea.
        const _injectedShell = scrollArea ? scrollArea.querySelector('[data-gp-injected]') : null;
        if (_injectedShell?.parentNode) _injectedShell.parentNode.removeChild(_injectedShell);

        // ── Left panel ───────────────────────────────────────────────
        const leftPanel = document.createElement('div');
        leftPanel.id = 'gpc-modal-left';

        // Header — also the drag handle.
        // IMPORTANT: makeDraggable(modal) in the site source uses `if (e.target !== elmnt) return`
        // which means the site drag ONLY fires when clicking the bare modal surface (impossible
        // once it's fully covered by children). We implement our own drag here instead.
        const leftHeader = document.createElement('div');
        leftHeader.id = 'gpc-modal-left-header';
        leftHeader.className = 'flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 cursor-move select-none flex-shrink-0 bg-white dark:bg-gray-800';

        const leftTitleWrap = document.createElement('div');
        leftTitleWrap.className = 'flex items-center gap-2 min-w-0';

        if (h2) {
            h2.style.cssText = 'margin:0;font-size:1.05rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            leftTitleWrap.appendChild(h2);
        }
        leftHeader.appendChild(leftTitleWrap);
        // Restyle the close button for the header context.
        // Strip absolute/shadow/bg-white classes (bg-white on white header = invisible);
        // give it a visible, theme-aware appearance instead.
        const effectiveCloseBtn = closeBtn || (() => {
            const b = document.createElement('button');
            b.innerHTML = '&#10005;';
            b.onclick = () => { if (typeof toggleGhostModal === 'function') toggleGhostModal(false); };
            return b;
        })();
        effectiveCloseBtn.className = 'flex-shrink-0 rounded-full cursor-pointer flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100';
        effectiveCloseBtn.style.cssText = 'position:static;border:none;background:transparent;width:2rem;height:2rem;font-size:1.1rem;line-height:1;flex-shrink:0;';
        leftHeader.appendChild(effectiveCloseBtn);
        leftPanel.appendChild(leftHeader);

        // ── Shared drag logic — used by header and all 4 edge strips ────
        function _startDrag(e) {
            if (e.button !== 0 || e.target.closest('button')) return;
            e.preventDefault();
            const r = modal.getBoundingClientRect();
            let st = { mx: e.clientX, my: e.clientY, l: r.left, t: r.top };
            const prevCursor = document.body.style.cursor;
            document.body.style.cursor = 'grabbing';
            const onMove = ev => {
                modal.style.left      = (st.l + ev.clientX - st.mx) + 'px';
                modal.style.top       = (st.t + ev.clientY - st.my) + 'px';
                modal.style.transform = 'none';
            };
            const onUp = () => {
                document.body.style.cursor = prevCursor;
                document.removeEventListener('mousemove', onMove, true);
                document.removeEventListener('mouseup',   onUp,   true);
            };
            document.addEventListener('mousemove', onMove, true);
            document.addEventListener('mouseup',   onUp,   true);
        }
        leftHeader.style.cursor = 'grab';
        leftHeader.addEventListener('mousedown', _startDrag);

        if (scrollArea) {
            scrollArea.id = 'gpc-modal-left-scroll';
            // Strip the old Tailwind overflow/grow classes that conflict with the new layout
            scrollArea.className = scrollArea.className
                .replace(/\bflex-grow\b|\boverflow-y-auto\b|\bpr-\S+\b|\b-mr-\S+\b/g, '').trim();
            leftPanel.appendChild(scrollArea);
        }

        // ── Right panel ──────────────────────────────────────────────
        const rightPanel = document.createElement('div');
        rightPanel.id = 'gpc-modal-right';
        // position:relative so the right edge strip can be absolutely positioned inside it
        rightPanel.style.position = 'relative';
        // Use Tailwind dark: variants so colors track the site's active theme
        rightPanel.className = 'border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800';

        // Collapse bar
        const collapseBar = document.createElement('div');
        collapseBar.className = 'flex items-center gap-1 px-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 select-none';
        collapseBar.style.minHeight = '34px';

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 flex-shrink-0 flex items-center justify-center border-none cursor-pointer';
        collapseBtn.style.cssText = 'width:20px;height:20px;font-size:8px;padding:0;line-height:1;';
        collapseBtn.textContent = '◀';
        collapseBtn.title = 'Collapse preview';

        const collapseLabel = document.createElement('span');
        collapseLabel.className = 'gpc-collapse-label text-xs font-bold text-gray-500 dark:text-gray-400';
        collapseLabel.textContent = '🖼 Preview';

        collapseBar.appendChild(collapseBtn);
        collapseBar.appendChild(collapseLabel);
        rightPanel.appendChild(collapseBar);

        const rightContent = document.createElement('div');
        rightContent.id = 'gpc-modal-right-content';

        // Preview image
        if (previewContainer) {
            previewContainer.className = '';
            previewContainer.style.cssText = 'flex-shrink:0;margin:10px;border-radius:8px;overflow:hidden;background:var(--color-gray-100,#f3f4f6);border:1px solid var(--color-gray-200,#e5e7eb);display:flex;align-items:center;justify-content:center;aspect-ratio:4/3;max-height:340px;position:relative;';
            const pImg = previewContainer.querySelector('#ghostPreviewImage');
            if (pImg) pImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;image-rendering:crisp-edges;';
            const pTxt = previewContainer.querySelector('#ghostPreviewText');
            if (pTxt) { pTxt.className = 'text-gray-400 dark:text-gray-500 text-xs text-center'; pTxt.style.cssText = 'position:relative;z-index:1;padding:8px;'; }
            rightContent.appendChild(previewContainer);

            // Horizontal resize strip — drag to set preview height freely
            const previewHResize = document.createElement('div');
            previewHResize.className = 'gpc-preview-hresize';
            previewHResize.title = 'Drag to resize preview height';
            previewHResize.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                const startY = e.clientY;
                const startH = previewContainer.getBoundingClientRect().height;
                // Switch to explicit height so the user can go above the aspect-ratio default
                previewContainer.style.height = startH + 'px';
                previewContainer.style.maxHeight = 'none';
                previewHResize.classList.add('gpc-ps-dragging');
                document.body.style.cursor = 'ns-resize';
                const onMove = ev => {
                    const newH = Math.max(60, startH + ev.clientY - startY);
                    previewContainer.style.height = newH + 'px';
                };
                const onUp = () => {
                    previewHResize.classList.remove('gpc-ps-dragging');
                    document.body.style.cursor = '';
                    document.removeEventListener('mousemove', onMove, true);
                    document.removeEventListener('mouseup',   onUp,   true);
                };
                document.addEventListener('mousemove', onMove, true);
                document.addEventListener('mouseup',   onUp,   true);
            });
            rightContent.appendChild(previewHResize);
        }

        // Buttons row (URL, File, History, Save Pos, Place on Map, Clear Image …)
        if (buttonsRow) {
            const buttonsWrap = document.createElement('div');
            buttonsWrap.className = 'flex-shrink-0 px-2 py-2';
            // Preserve the grid layout applyModernGpButtons set; just ensure it shows.
            buttonsRow.style.display = '';
            buttonsWrap.appendChild(buttonsRow);
            rightContent.appendChild(buttonsWrap);
        }

        // Recent images section
        const recentWrap = document.createElement('div');
        recentWrap.className = 'border-t border-gray-200 dark:border-gray-700';
        recentWrap.style.cssText = 'flex:1 1 0;min-height:0;display:flex;flex-direction:column;overflow:hidden;';

        const recentHdr = document.createElement('div');
        recentHdr.className = 'flex items-center px-2 gap-1 select-none cursor-pointer flex-shrink-0 text-xs font-bold text-gray-500 dark:text-gray-400';
        recentHdr.style.minHeight = '28px';

        const recentArrow = document.createElement('span');
        recentArrow.textContent = '▾';
        recentArrow.style.cssText = 'transition:transform 0.15s;flex-shrink:0;';

        const recentTitle = document.createElement('span');
        recentTitle.textContent = '🕐 Recent';

        const recentRefreshBtn = document.createElement('button');
        recentRefreshBtn.textContent = '↺';
        recentRefreshBtn.title = 'Refresh';
        recentRefreshBtn.className = 'ml-auto border-none bg-transparent cursor-pointer text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300';
        recentRefreshBtn.style.cssText = 'font-size:13px;padding:0 2px;line-height:1;';
        recentRefreshBtn.addEventListener('click', e => { e.stopPropagation(); loadRecentImages(); });

        recentHdr.appendChild(recentArrow);
        recentHdr.appendChild(recentTitle);
        recentHdr.appendChild(recentRefreshBtn);

        const recentGrid = document.createElement('div');
        recentGrid.id = 'gpc-recent-grid';

        const syncRecentCellSize = () => {
            const width = recentGrid.clientWidth;
            if (!width) return;
            const styles = getComputedStyle(recentGrid);
            const padX = parseFloat(styles.paddingLeft || '0') + parseFloat(styles.paddingRight || '0');
            const gap = parseFloat(styles.columnGap || styles.gap || '0') || 0;
            const cell = Math.max(24, Math.floor((width - padX - gap * 4) / 5));
            recentGrid.style.setProperty('--gpc-recent-cell-size', `${cell}px`);
        };
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(syncRecentCellSize).observe(recentGrid);
        } else {
            window.addEventListener('resize', syncRecentCellSize);
        }
        setTimeout(syncRecentCellSize, 0);

        let recentOpen = true;
        recentHdr.addEventListener('click', () => {
            recentOpen = !recentOpen;
            recentGrid.style.display = recentOpen ? 'grid' : 'none';
            recentArrow.style.transform = recentOpen ? '' : 'rotate(-90deg)';
        });

        recentWrap.appendChild(recentHdr);
        recentWrap.appendChild(recentGrid);
        rightContent.appendChild(recentWrap);
        rightPanel.appendChild(rightContent);

        // Collapse toggle
        let rightCollapsed = false;
        let _previewRightW = 280;  // remembered expanded width of the preview (right) panel

        collapseBtn.addEventListener('click', e => {
            e.stopPropagation();
            rightCollapsed = !rightCollapsed;
            // Anchor on the live left/controls width plus a remembered preview width, so
            // collapse/expand only removes or re-adds the preview on the right — the total
            // modal width is never reset to a stale or default value.
            if (rightCollapsed) {
                modal.classList.remove('gpc-preview-expanded');
                const currentW = Math.round(modal.getBoundingClientRect().width);
                const rightW = Math.round(rightPanel.getBoundingClientRect().width);
                if (rightW > 38) _previewRightW = rightW;           // remember preview width for expand
                const leftW = currentW - rightW;                    // controls width — keep fixed
                const collapsedW = Math.max(320, leftW + 34);
                modal.style.setProperty('--gpc-expanded-width', `${currentW}px`);
                modal.style.setProperty('--gpc-collapsed-width', `${collapsedW}px`);
                modal.classList.add('gpc-preview-animating', 'gpc-preview-collapsed');
                rightPanel.classList.add('gpc-collapsed');
                modal.dataset.gpcExpandedWidth = `${currentW}px`;
                modal.dataset.gpcPreviewCollapsed = '1';
            } else {
                modal.classList.remove('gpc-preview-collapsed');
                const currentW = Math.round(modal.getBoundingClientRect().width);
                const leftW = currentW - 34;                        // currently collapsed → left = total − stub
                const expandedW = Math.max(480, leftW + _previewRightW);
                rightPanel.style.width = `${_previewRightW}px`;     // restore preview to its remembered width
                modal.style.setProperty('--gpc-expanded-width', `${expandedW}px`);
                modal.style.removeProperty('--gpc-collapsed-width');
                modal.classList.add('gpc-preview-animating', 'gpc-preview-expanded');
                rightPanel.classList.remove('gpc-collapsed');
                modal.dataset.gpcExpandedWidth = `${expandedW}px`;
                modal.dataset.gpcPreviewCollapsed = '0';
            }
            collapseBtn.textContent = rightCollapsed ? '▶' : '◀';
            collapseBtn.title = rightCollapsed ? 'Expand preview' : 'Collapse preview';
        });

        modal.addEventListener('transitionend', e => {
            if (e.target !== modal || e.propertyName !== 'width') return;
            if (!rightCollapsed) {
                modal.classList.remove('gpc-preview-expanded');
                modal.style.width = modal.style.getPropertyValue('--gpc-expanded-width') || 'min(92vw, 800px)';
            } else {
                modal.style.width = modal.style.getPropertyValue('--gpc-collapsed-width');
            }
            modal.classList.remove('gpc-preview-animating');
        });

        // ── SE resize handle (bottom-right only — guild modal pattern) ──────────
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'gpc-resize-se';

        let _rs = null;
        resizeHandle.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            const r = modal.getBoundingClientRect();
            const rightRect = rightPanel.getBoundingClientRect();
            _rs = {
                mx: e.clientX,
                my: e.clientY,
                w: r.width,
                h: r.height,
                rightRatio: rightCollapsed ? null : rightRect.width / Math.max(1, r.width),
                rightTransition: rightPanel.style.transition,
            };
            // Disable any active transition so resize is instant
            modal.classList.remove('gpc-preview-animating', 'gpc-preview-expanded');
            modal.style.userSelect = 'none';
            rightPanel.style.transition = 'none';
            const onRsMove = ev => {
                if (!_rs) return;
                const minW = rightCollapsed ? 320 : 480;
                const nextW = Math.max(minW, _rs.w + ev.clientX - _rs.mx);
                const nextWidth = nextW + 'px';
                modal.style.width = nextWidth;
                if (!rightCollapsed && _rs.rightRatio) {
                    const minRightW = Math.max(34, Math.floor(nextW * 0.05));
                    const maxRightW = Math.max(minRightW, Math.floor(nextW * 0.95));
                    const nextRightW = Math.min(Math.max(minRightW, Math.round(nextW * _rs.rightRatio)), maxRightW);
                    rightPanel.style.width = nextRightW + 'px';
                    _previewRightW = nextRightW;   // remember new preview width for collapse/expand
                }
                // Keep the active CSS variable in sync so !important rules don't fight the resize
                if (rightCollapsed) {
                    modal.style.setProperty('--gpc-collapsed-width', nextWidth);
                } else {
                    modal.style.setProperty('--gpc-expanded-width', nextWidth);
                    modal.dataset.gpcExpandedWidth = nextWidth;
                }
                modal.style.height = Math.max(320, _rs.h + ev.clientY - _rs.my) + 'px';
            };
            const onRsUp = () => {
                if (_rs) rightPanel.style.transition = _rs.rightTransition || '';
                _rs = null;
                modal.style.userSelect = '';
                document.removeEventListener('mousemove', onRsMove, true);
                document.removeEventListener('mouseup',   onRsUp,   true);
            };
            document.addEventListener('mousemove', onRsMove, true);
            document.addEventListener('mouseup',   onRsUp,   true);
        });

        // ── Assemble ──────────────────────────────────────────────────
        while (modal.firstChild) modal.removeChild(modal.firstChild);
        modal.appendChild(leftPanel);
        modal.appendChild(rightPanel);
        // Top / bottom / left edge strips are children of modal (absolute vs modal)
        ['top', 'bottom', 'left'].forEach(side => {
            const strip = document.createElement('div');
            strip.className = `gpc-edge-drag ${side}`;
            strip.style.cursor = 'grab';  // inline beats CSS class specificity
            strip.addEventListener('mousedown', _startDrag);
            modal.appendChild(strip);
        });
        // Right edge strip must be a child of rightPanel to beat its stacking context
        const rightStrip = document.createElement('div');
        rightStrip.className = 'gpc-edge-drag right';
        rightStrip.style.cursor = 'grab';
        rightStrip.addEventListener('mousedown', _startDrag);
        rightPanel.appendChild(rightStrip);

        // ── Panel splitter (left edge of rightPanel — drag to resize split ratio) ──
        const panelSplitter = document.createElement('div');
        panelSplitter.className = 'gpc-panel-splitter';
        panelSplitter.title = 'Drag to resize preview panel';
        panelSplitter.addEventListener('mousedown', e => {
            if (e.button !== 0 || rightCollapsed) return;
            e.preventDefault(); e.stopPropagation();
            const startX = e.clientX;
            const startW = rightPanel.getBoundingClientRect().width;
            rightPanel.style.transition = 'none';
            panelSplitter.classList.add('gpc-ps-dragging');
            document.body.style.cursor = 'ew-resize';
            const onMove = ev => {
                const delta = startX - ev.clientX; // drag left → wider right panel
                const modalW = modal.getBoundingClientRect().width;
                const minW = Math.max(34, Math.floor(modalW * 0.05));
                const maxW = Math.max(minW, Math.floor(modalW * 0.95));
                const newW = Math.min(Math.max(minW, startW + delta), maxW);
                rightPanel.style.width = newW + 'px';
                _previewRightW = newW;   // remember split width for collapse/expand
            };
            const onUp = () => {
                panelSplitter.classList.remove('gpc-ps-dragging');
                document.body.style.cursor = '';
                rightPanel.style.transition = '';
                document.removeEventListener('mousemove', onMove, true);
                document.removeEventListener('mouseup',   onUp,   true);
            };
            document.addEventListener('mousemove', onMove, true);
            document.addEventListener('mouseup',   onUp,   true);
        });
        rightPanel.appendChild(panelSplitter);

        modal.appendChild(resizeHandle);

        loadRecentImages();
        setupGhostModalPlacementMemory(modal);
    }

    async function loadRecentImages() {
        const grid = document.getElementById('gpc-recent-grid');
        if (!grid) return;
        _recentBlobUrls.forEach(u => URL.revokeObjectURL(u));
        _recentBlobUrls = [];
        const isDark = document.body.classList.contains('dark');
        const loadingColor = isDark ? '#6b7280' : '#94a3b8';
        grid.innerHTML = `<span style="font-size:10px;color:${loadingColor};padding:4px;grid-column:span 5">Loading…</span>`;
        try {
            const allImages = await HistoryManager.getAll();
            const images = allImages.slice(0, _recentLimit);
            grid.innerHTML = '';
            if (!images.length) {
                grid.innerHTML = `<span style="font-size:10px;color:${loadingColor};padding:4px;grid-column:span 5">No history yet</span>`;
                return;
            }
            images.forEach(imgData => {
                const blobUrl = URL.createObjectURL(imgData.blob);
                _recentBlobUrls.push(blobUrl);
                const thumb = document.createElement('div');
                // Use Tailwind dark: variants — same approach as the rest of the modal
                thumb.className = 'rounded bg-gray-200 dark:bg-gray-700 cursor-pointer';
                thumb.style.cssText = 'width:100%;height:100%;min-width:0;overflow:hidden;border:2px solid transparent;box-sizing:border-box;transition:border-color 0.15s;';
                thumb.title = imgData.name;
                const img = document.createElement('img');
                img.src = blobUrl;
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;image-rendering:pixelated;display:block;';
                thumb.appendChild(img);
                thumb.addEventListener('mouseenter', () => { thumb.style.borderColor = '#3b82f6'; });
                thumb.addEventListener('mouseleave', () => { thumb.style.borderColor = 'transparent'; });
                thumb.addEventListener('click', async () => {
                    await processAndLoadImage(imgData.blob, false, 'Recent thumbnails', imgData.groupNoise);
                    await HistoryManager.add(imgData.blob, imgData.name, imgData.groupNoise);
                    loadRecentImages();
                });
                grid.appendChild(thumb);
            });

            if (allImages.length > 10) {
                const makeRecentPagerTile = (text, onClick) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.textContent = text;
                    btn.className = 'rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer';
                    btn.style.cssText = 'width:100%;height:100%;min-width:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;text-decoration:underline;padding:0;box-sizing:border-box;transition:background-color 0.15s,border-color 0.15s;';
                    btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
                    return btn;
                };

                if (_recentLimit < Math.min(50, allImages.length)) {
                    grid.appendChild(makeRecentPagerTile('more', () => { _recentLimit = 50; loadRecentImages(); }));
                }

                if (_recentLimit > 10) {
                    grid.appendChild(makeRecentPagerTile('less', () => { _recentLimit = 10; loadRecentImages(); }));
                }
            }
        } catch(e) {
            grid.innerHTML = '<span style="font-size:10px;color:#ef4444;padding:4px;grid-column:span 5">Failed to load</span>';
        }
    }

    gpLog("GeoPixels Ultimate Ghost Template Manager v3.5 Loaded (with uint8array ZIP fix)");

            })();
            _featureStatus.ghostTemplateManager = 'ok';
            console.log('[GeoPixelcons++] ✅ Ghost Template Manager loaded');
        } catch (err) {
            _featureStatus.ghostTemplateManager = 'error';
            dbgPush(`Ghost Template Manager init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Ghost Template Manager' });
            console.error('[GeoPixelcons++] ❌ Ghost Template Manager failed:', err);
        }
    }
