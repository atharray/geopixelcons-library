
    // ============================================================
    //  FEATURE: Region Screenshot [regionScreenshot]
    // ============================================================
    if (_settings.regionScreenshot) {
        try {
            (function _init_regionScreenshot() {

    // ==================== CONFIGURATION ====================
    const GRID_SIZE = 25;
    const TILE_SIZE = 1000;
    const MAX_REGION_PIXELS = 15000 * 15000; // 225M px — hard limit to prevent OOM
    const SELECTION_COLOR = 'rgba(16, 185, 129, 0.25)';
    const SELECTION_BORDER_COLOR = 'rgba(16, 185, 129, 0.9)';
    const DEFAULT_BACKGROUND_COLOR = '#ffffff';
    const BACKGROUND_PREF_KEY = 'gpc-region-screenshot-background';

    // ==================== STATE ====================
    let isSelectionModeActive = false;
    let isDragging = false;
    let selectionStart = null;
    let selectionEnd = null;
    let selectionCanvas = null;
    let selectionCtx = null;
    let screenshotButton = null;
    let _map = null; // resolved MapLibre map object (not the DOM element)

    // ==================== BACKGROUND PREFERENCES ====================
    function loadBackgroundPreference() {
        try {
            const pref = JSON.parse(localStorage.getItem(BACKGROUND_PREF_KEY) || 'null');
            const mode = pref && pref.mode === 'solid' ? 'solid' : 'transparent';
            const color = pref && /^#[0-9A-Fa-f]{6}$/.test(pref.color || '')
                ? pref.color.toLowerCase()
                : DEFAULT_BACKGROUND_COLOR;
            return { mode, color };
        } catch (_) {
            return { mode: 'transparent', color: DEFAULT_BACKGROUND_COLOR };
        }
    }

    function saveBackgroundPreference(mode, color) {
        try {
            localStorage.setItem(BACKGROUND_PREF_KEY, JSON.stringify({
                mode: mode === 'solid' ? 'solid' : 'transparent',
                color: /^#[0-9A-Fa-f]{6}$/.test(color || '') ? color.toLowerCase() : DEFAULT_BACKGROUND_COLOR,
            }));
        } catch (_) {}
    }

    function composeCanvasWithBackground(canvas, mode, color) {
        if (mode !== 'solid') return canvas;
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = canvas.width;
        exportCanvas.height = canvas.height;
        const exportCtx = exportCanvas.getContext('2d');
        exportCtx.fillStyle = /^#[0-9A-Fa-f]{6}$/.test(color || '') ? color : DEFAULT_BACKGROUND_COLOR;
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        exportCtx.drawImage(canvas, 0, 0);
        return exportCanvas;
    }

    // ==================== MAP ACCESS ====================
    function _getMap() {
        if (_map) return _map;
        try { const m = (0, eval)('map'); if (m && typeof m.scrollZoom !== 'undefined') return (_map = m); } catch {}
        if (typeof unsafeWindow !== 'undefined') { try { const m = unsafeWindow.eval('map'); if (m && typeof m.scrollZoom !== 'undefined') return (_map = m); } catch {} }
        return null;
    }

    // ==================== INITIALIZATION ====================
    // Polls (every 500ms, forever) for four unrelated readiness signals: the
    // resolved map object, two page globals (turf, tileImageCache), and the
    // #controls-left DOM element. A MutationObserver can't detect globals
    // becoming defined, so this keeps the original poll-and-reschedule shape
    // rather than forcing the MutationObserver pattern used for single DOM
    // elements elsewhere in this codebase (see Ghost Palette Search's
    // injectSyncGhostBtn). This feature has no fallback if it never
    // initializes, so retrying is unbounded by design -- the 15s mark only
    // emits one loud diagnostic (dbgPush + console.error) naming exactly
    // which condition(s) are still unmet, then polling continues silently.
    function waitForGeoPixels() {
        const startedAt = Date.now();
        let firstCheck = true;
        let loggedSlowStart = false;
        return new Promise((resolve) => {
            const check = () => {
                if (firstCheck) {
                    firstCheck = false;
                    dbgPush('Region Screenshot: starting poll for map / turf / tileImageCache / #controls-left readiness (every 500ms).', { uiComponent: 'Region Screenshot' });
                }

                const mapReady = !!_getMap();
                const turfReady = typeof turf !== 'undefined';
                const tileImageCacheReady = typeof tileImageCache !== 'undefined';
                const controlsLeftReady = !!document.getElementById('controls-left');

                if (mapReady && turfReady && tileImageCacheReady && controlsLeftReady) {
                    dbgPush('Region Screenshot: all readiness conditions met after ' + (Date.now() - startedAt) + 'ms -- resolving.', { uiComponent: 'Region Screenshot' });
                    resolve();
                    return;
                }

                if (!loggedSlowStart && (Date.now() - startedAt) >= 15000) {
                    loggedSlowStart = true;
                    const msg = 'Region Screenshot: still waiting after 15s -- map=' + mapReady + ', turf=' + turfReady +
                        ', tileImageCache=' + tileImageCacheReady + ', #controls-left=' + controlsLeftReady +
                        '. Will keep retrying every 500ms (this is a one-time diagnostic, not a giveup).';
                    dbgPush(msg, { uiComponent: 'Region Screenshot' });
                    console.error('[GeoPixelcons++] ' + msg);
                }

                setTimeout(check, 500);
            };
            check();
        });
    }

    async function init() {
        await waitForGeoPixels();
        console.log('[Region Screenshot] Initializing...');
        createSelectionCanvas();
        createScreenshotButton();
        setupEventListeners();
        console.log('[Region Screenshot] Ready!');
    }

    // ==================== UI COMPONENTS ====================
    function createScreenshotButton() {
        screenshotButton = document.createElement('button');
        screenshotButton.id = 'gpc-screenshot-trigger';
        screenshotButton.style.display = 'none';
        screenshotButton.addEventListener('click', toggleSelectionMode);
        document.body.appendChild(screenshotButton);
    }

    function createSelectionCanvas() {
        selectionCanvas = document.createElement('canvas');
        selectionCanvas.id = 'screenshot-selection-canvas';
        selectionCanvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            pointer-events: none;
            z-index: 1000;
        `;
        document.body.appendChild(selectionCanvas);
        selectionCtx = selectionCanvas.getContext('2d');

        const syncSize = () => {
            const dpr = window.devicePixelRatio || 1;
            selectionCanvas.width = window.innerWidth * dpr;
            selectionCanvas.height = window.innerHeight * dpr;
            selectionCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        syncSize();
        window.addEventListener('resize', syncSize);

        ['move', 'rotate', 'zoom'].forEach((ev) => {
            _map.on(ev, () => {
                if (isDragging) drawSelectionPreview();
            });
        });
    }

    // ==================== SELECTION MODE ====================
    function toggleSelectionMode() {
        isSelectionModeActive = !isSelectionModeActive;
        if (isSelectionModeActive) {
            screenshotButton.style.backgroundColor = '#10b981';
            screenshotButton.style.color = 'white';
            screenshotButton.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.6)';
            document.body.style.cursor = 'crosshair';
            disableMapInteractions();
            showNotification('Click and drag to select a region to screenshot');
        } else {
            resetSelectionMode();
        }
    }

    function disableMapInteractions() {
        const m = _getMap(); if (!m) return;
        m.dragPan.disable();
        m.scrollZoom.disable();
        m.boxZoom.disable();
        m.doubleClickZoom.disable();
        m.touchZoomRotate.disable();
    }

    function enableMapInteractions() {
        const m = _getMap(); if (!m) return;
        m.dragPan.enable();
        m.scrollZoom.enable();
        m.boxZoom.enable();
        // Note: doubleClickZoom is intentionally NOT re-enabled — the native site disables it
        m.touchZoomRotate.enable();
    }

    function resetSelectionMode() {
        isSelectionModeActive = false;
        isDragging = false;
        selectionStart = null;
        selectionEnd = null;
        if (screenshotButton) {
            screenshotButton.style.backgroundColor = 'white';
            screenshotButton.style.color = 'black';
            screenshotButton.style.boxShadow = '';
        }
        document.body.style.cursor = '';
        enableMapInteractions();
        clearSelectionCanvas();
    }

    function clearSelectionCanvas() {
        if (selectionCtx && selectionCanvas) {
            selectionCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        }
    }

    // ==================== EVENT HANDLERS ====================
    function setupEventListeners() {
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('keydown', handleKeyDown);
    }

    function handleMouseDown(e) {
        if (!isSelectionModeActive) return;
        if (e.button !== 0) return;
        if (
            e.target.closest('#controls-left') ||
            e.target.closest('#controls-right') ||
            e.target.closest('.rsc-modal-container')
        ) return;

        isDragging = true;
        selectionStart = screenPointToGrid(e.clientX, e.clientY);
        selectionEnd = selectionStart;
        e.preventDefault();
        e.stopPropagation();
    }

    function handleMouseMove(e) {
        if (!isDragging || !selectionStart) return;
        selectionEnd = screenPointToGrid(e.clientX, e.clientY);
        drawSelectionPreview();
    }

    async function handleMouseUp(e) {
        if (!isDragging || !selectionStart || !selectionEnd) return;
        isDragging = false;

        const bounds = getSelectionBounds();
        const width = bounds.maxX - bounds.minX + 1;
        const height = bounds.maxY - bounds.minY + 1;

        if (width < 2 || height < 2) {
            showNotification('Selection too small — please drag a larger area.');
            clearSelectionCanvas();
            resetSelectionMode();
            return;
        }

        if (width * height > MAX_REGION_PIXELS) {
            showNotification(`Region too large (${width}×${height}). Maximum is ~15000×15000 px.`);
            clearSelectionCanvas();
            resetSelectionMode();
            return;
        }

        // Exit selection mode
        isSelectionModeActive = false;
        if (screenshotButton) {
            screenshotButton.style.backgroundColor = 'white';
            screenshotButton.style.color = 'black';
            screenshotButton.style.boxShadow = '';
        }
        document.body.style.cursor = '';
        enableMapInteractions();

        // Show loading modal
        const modal = createPreviewModal(bounds, null, true);
        const progressEl = modal.querySelector('.rsc-progress-text');
        const updateProgress = (text) => { if (progressEl) progressEl.textContent = text; };

        try {
            const screenshotCanvas = await renderRegionToCanvas(bounds, updateProgress);
            updatePreviewModal(modal, bounds, screenshotCanvas);
        } catch (err) {
            console.error('[Region Screenshot] Error:', err);
            showNotification('Error capturing screenshot: ' + err.message);
            modal.closeModal();
        }

        clearSelectionCanvas();
        selectionStart = null;
        selectionEnd = null;
    }

    function handleKeyDown(e) {
        if (e.key === 'Escape' && (isSelectionModeActive || isDragging)) {
            resetSelectionMode();
        }
    }

    // ==================== COORDINATE HELPERS ====================
    function screenPointToGrid(clientX, clientY) {
        const mapContainer = _map.getContainer();
        const rect = mapContainer.getBoundingClientRect();
        const lngLat = _map.unproject([clientX - rect.left, clientY - rect.top]);
        const merc = turf.toMercator([lngLat.lng, lngLat.lat]);
        return {
            gridX: Math.round(merc[0] / GRID_SIZE),
            gridY: Math.round(merc[1] / GRID_SIZE),
        };
    }

    function gridToScreen(gridX, gridY) {
        const lngLat = turf.toWgs84([gridX * GRID_SIZE, gridY * GRID_SIZE]);
        const point = _map.project(lngLat);
        const rect = _map.getContainer().getBoundingClientRect();
        return { x: point.x + rect.left, y: point.y + rect.top };
    }

    function getSelectionBounds() {
        return {
            minX: Math.min(selectionStart.gridX, selectionEnd.gridX),
            maxX: Math.max(selectionStart.gridX, selectionEnd.gridX),
            minY: Math.min(selectionStart.gridY, selectionEnd.gridY),
            maxY: Math.max(selectionStart.gridY, selectionEnd.gridY),
        };
    }

    // ==================== SELECTION DRAWING ====================
    function drawSelectionPreview() {
        clearSelectionCanvas();
        if (!selectionStart || !selectionEnd) return;

        const bounds = getSelectionBounds();
        const topLeft = gridToScreen(bounds.minX - 0.5, bounds.maxY + 0.5);
        const bottomRight = gridToScreen(bounds.maxX + 0.5, bounds.minY - 0.5);

        const x = topLeft.x;
        const y = topLeft.y;
        const w = bottomRight.x - topLeft.x;
        const h = bottomRight.y - topLeft.y;

        selectionCtx.fillStyle = SELECTION_COLOR;
        selectionCtx.fillRect(x, y, w, h);

        selectionCtx.strokeStyle = SELECTION_BORDER_COLOR;
        selectionCtx.lineWidth = 2;
        selectionCtx.setLineDash([6, 3]);
        selectionCtx.strokeRect(x, y, w, h);
        selectionCtx.setLineDash([]);

        const selW = bounds.maxX - bounds.minX + 1;
        const selH = bounds.maxY - bounds.minY + 1;
        const sizeText = `${selW} × ${selH}`;

        selectionCtx.font = 'bold 14px sans-serif';
        selectionCtx.textAlign = 'center';
        selectionCtx.textBaseline = 'middle';
        selectionCtx.lineWidth = 3;
        selectionCtx.strokeStyle = 'rgba(0,0,0,0.6)';
        selectionCtx.strokeText(sizeText, x + w / 2, y + h / 2);
        selectionCtx.fillStyle = 'white';
        selectionCtx.fillText(sizeText, x + w / 2, y + h / 2);
    }

    // ==================== SCREENSHOT RENDERING ====================
    async function renderRegionToCanvas(bounds, updateProgress) {
        const { minX, maxX, minY, maxY } = bounds;
        const outWidth  = maxX - minX + 1;
        const outHeight = maxY - minY + 1;

        // Output canvas — transparent background, 1px = 1 grid cell
        const outputCanvas = new OffscreenCanvas(outWidth, outHeight);
        const outputCtx = outputCanvas.getContext('2d');
        outputCtx.clearRect(0, 0, outWidth, outHeight);

        // Find all tiles that overlap with the selection
        const startTileX = Math.floor(minX / TILE_SIZE) * TILE_SIZE;
        const endTileX   = Math.floor(maxX / TILE_SIZE) * TILE_SIZE;
        const startTileY = Math.floor(minY / TILE_SIZE) * TILE_SIZE;
        const endTileY   = Math.floor(maxY / TILE_SIZE) * TILE_SIZE;

        const neededTiles = [];
        for (let tx = startTileX; tx <= endTileX; tx += TILE_SIZE) {
            for (let ty = startTileY; ty <= endTileY; ty += TILE_SIZE) {
                neededTiles.push([tx, ty]);
            }
        }

        console.log(`[Region Screenshot] ${neededTiles.length} tile(s) needed for ${outWidth}×${outHeight} region`);

        let processed = 0;
        for (const [tileX, tileY] of neededTiles) {
            processed++;
            const tileKey = `${tileX},${tileY}`;
            updateProgress && updateProgress(`Processing tile ${processed}/${neededTiles.length}…`);

            // Yield to browser
            await new Promise(r => setTimeout(r, 0));

            // ---- Try cache first ----
            let colorBitmap = null;
            let deltas = null;

            const cached = tileImageCache.get(tileKey);
            if (cached) {
                colorBitmap = cached.colorBitmap || null;
                deltas = cached.deltas || null;
            }

            // ---- Fallback: fetch from API ----
            if (!colorBitmap) {
                updateProgress && updateProgress(`Fetching tile ${tileKey} from server…`);
                try {
                    const fetched = await fetchTileColorBitmap(tileX, tileY);
                    colorBitmap = fetched.colorBitmap;
                    deltas = fetched.deltas;
                } catch (err) {
                    console.warn(`[Region Screenshot] Could not load tile ${tileKey}:`, err);
                    continue;
                }
            }

            if (!colorBitmap) continue;

            // ---- Compute overlapping region in tile local coords ----
            const tileMinX = Math.max(minX, tileX);
            const tileMaxX = Math.min(maxX, tileX + TILE_SIZE - 1);
            const tileMinY = Math.max(minY, tileY);
            const tileMaxY = Math.min(maxY, tileY + TILE_SIZE - 1);

            const regionW = tileMaxX - tileMinX + 1;
            const regionH = tileMaxY - tileMinY + 1;
            if (regionW <= 0 || regionH <= 0) continue;

            const localStartX = tileMinX - tileX;
            const localStartY = tileMinY - tileY;

            // Destination position on output canvas
            const destX = tileMinX - minX;
            const destY = tileMinY - minY;

            // Draw this tile's color section onto the output canvas
            outputCtx.drawImage(
                colorBitmap,
                localStartX, localStartY, regionW, regionH,
                destX, destY, regionW, regionH
            );

            // ---- Apply any recent in-memory deltas on top ----
            // These are pixel updates that have arrived since the last full sync
            // and may not yet be baked into the colorBitmap.
            if (deltas && deltas.length > 0) {
                for (const delta of deltas) {
                    const gx = delta.gridX;
                    const gy = delta.gridY;

                    // Skip if outside this tile's contributing region
                    if (gx < tileMinX || gx > tileMaxX || gy < tileMinY || gy > tileMaxY) continue;

                    const ox = gx - minX;
                    const oy = gy - minY;

                    if (delta.color === '#00000000' || delta.color === null) {
                        // Erased pixel — clear it
                        outputCtx.clearRect(ox, oy, 1, 1);
                    } else if (delta.color) {
                        outputCtx.fillStyle = delta.color;
                        outputCtx.fillRect(ox, oy, 1, 1);
                    }
                }
            }
        }

        updateProgress && updateProgress('Finalizing…');

        // Transfer to a regular (main-thread) canvas so we can export it.
        // Flip vertically: grid Y increases northward but canvas Y increases downward,
        // so without a flip the image is upside-down.
        const regularCanvas = document.createElement('canvas');
        regularCanvas.width = outWidth;
        regularCanvas.height = outHeight;
        const regularCtx = regularCanvas.getContext('2d');
        regularCtx.save();
        regularCtx.translate(0, outHeight);
        regularCtx.scale(1, -1);
        regularCtx.drawImage(outputCanvas, 0, 0);
        regularCtx.restore();

        return regularCanvas;
    }

    // ---- API tile fetch (fallback when not cached) ----
    async function fetchTileColorBitmap(tileX, tileY) {
        const response = await fetch('https://geopixels.net/GetPixelsCached', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Tiles: [{ x: tileX, y: tileY, timestamp: 0 }] }),
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);

        const data = await response.json();
        const tileKey = `tile_${tileX}_${tileY}`;
        const tileInfo = data.Tiles && data.Tiles[tileKey];

        if (!tileInfo) return { colorBitmap: null, deltas: null };

        // Full tile with WebP
        if (tileInfo.Type === 'full' && tileInfo.ColorWebP) {
            const colorBitmap = await decodeWebP(tileInfo.ColorWebP);
            // Process any bundled deltas
            const deltas = buildDeltasFromRaw(tileInfo.Deltas || []);
            return { colorBitmap, deltas };
        }

        // Delta-only tile — build a small bitmap from the delta array
        if (tileInfo.Pixels && tileInfo.Pixels.length > 0) {
            const colorBitmap = await buildColorBitmapFromDeltas(tileInfo.Pixels, tileX, tileY);
            return { colorBitmap, deltas: null };
        }

        return { colorBitmap: null, deltas: null };
    }

    async function decodeWebP(base64Data) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => createImageBitmap(img).then(resolve).catch(reject);
            img.onerror = reject;
            img.src = `data:image/webp;base64,${base64Data}`;
        });
    }

    function buildDeltasFromRaw(rawDeltas) {
        return rawDeltas.map(p => {
            const [gridX, gridY, color] = p;
            if (color === -1) return { gridX, gridY, color: null };
            const r = (color >> 16) & 0xff;
            const g = (color >> 8) & 0xff;
            const b = color & 0xff;
            return { gridX, gridY, color: `rgb(${r},${g},${b})` };
        });
    }

    async function buildColorBitmapFromDeltas(rawDeltas, tileX, tileY) {
        const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
        const ctx = canvas.getContext('2d');
        for (const [gridX, gridY, color] of rawDeltas) {
            if (color === -1) continue;
            const r = (color >> 16) & 0xff;
            const g = (color >> 8) & 0xff;
            const b = color & 0xff;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(gridX - tileX, gridY - tileY, 1, 1);
        }
        return createImageBitmap(canvas);
    }

    // ==================== ADJUST BOUNDS MODAL ====================
    function showAdjustModal(currentBounds, onConfirm) {
        const existing = document.querySelector('.rsc-adjust-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'rsc-adjust-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 10001;
            background: rgba(0,0,0,0.55);
            display: flex; align-items: center; justify-content: center;
            font-family: system-ui, sans-serif;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: #1e1e2e; color: #cdd6f4; border-radius: 12px;
            box-shadow: 0 16px 48px rgba(0,0,0,0.5);
            padding: 24px; min-width: 320px; display: flex; flex-direction: column; gap: 14px;
        `;

        box.innerHTML = `
            <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #cba6f7;">Adjust Region Bounds</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <label style="font-size: 12px; color: #a6adc8;">X1 (min)
                    <input id="rsc-adj-x1" type="number" value="${currentBounds.minX}" style="width: 100%; margin-top: 2px; padding: 6px 8px; border-radius: 6px; border: 1px solid #45475a; background: #313244; color: #cdd6f4; font-size: 13px; font-family: monospace;" />
                </label>
                <label style="font-size: 12px; color: #a6adc8;">X2 (max)
                    <input id="rsc-adj-x2" type="number" value="${currentBounds.maxX}" style="width: 100%; margin-top: 2px; padding: 6px 8px; border-radius: 6px; border: 1px solid #45475a; background: #313244; color: #cdd6f4; font-size: 13px; font-family: monospace;" />
                </label>
                <label style="font-size: 12px; color: #a6adc8;">Y1 (min)
                    <input id="rsc-adj-y1" type="number" value="${currentBounds.minY}" style="width: 100%; margin-top: 2px; padding: 6px 8px; border-radius: 6px; border: 1px solid #45475a; background: #313244; color: #cdd6f4; font-size: 13px; font-family: monospace;" />
                </label>
                <label style="font-size: 12px; color: #a6adc8;">Y2 (max)
                    <input id="rsc-adj-y2" type="number" value="${currentBounds.maxY}" style="width: 100%; margin-top: 2px; padding: 6px 8px; border-radius: 6px; border: 1px solid #45475a; background: #313244; color: #cdd6f4; font-size: 13px; font-family: monospace;" />
                </label>
            </div>
            <div id="rsc-adj-error" style="font-size: 12px; color: #f38ba8; display: none;"></div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="rsc-adj-cancel" style="padding: 8px 16px; border-radius: 8px; border: 1px solid #45475a; background: #313244; color: #a6adc8; cursor: pointer; font-size: 13px;">Cancel</button>
                <button id="rsc-adj-confirm" style="padding: 8px 16px; border-radius: 8px; border: none; background: #cba6f7; color: #1e1e2e; cursor: pointer; font-size: 13px; font-weight: 600;">Apply</button>
            </div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        box.querySelector('#rsc-adj-cancel').onclick = close;

        box.querySelector('#rsc-adj-confirm').onclick = () => {
            const x1 = parseInt(box.querySelector('#rsc-adj-x1').value);
            const x2 = parseInt(box.querySelector('#rsc-adj-x2').value);
            const y1 = parseInt(box.querySelector('#rsc-adj-y1').value);
            const y2 = parseInt(box.querySelector('#rsc-adj-y2').value);
            const errEl = box.querySelector('#rsc-adj-error');

            if ([x1, x2, y1, y2].some(isNaN)) {
                errEl.textContent = 'All fields must be valid numbers.';
                errEl.style.display = 'block';
                return;
            }

            const newBounds = {
                minX: Math.min(x1, x2), maxX: Math.max(x1, x2),
                minY: Math.min(y1, y2), maxY: Math.max(y1, y2),
            };
            const w = newBounds.maxX - newBounds.minX + 1;
            const h = newBounds.maxY - newBounds.minY + 1;

            if (w < 2 || h < 2) {
                errEl.textContent = 'Region must be at least 2×2.';
                errEl.style.display = 'block';
                return;
            }
            if (w * h > MAX_REGION_PIXELS) {
                errEl.textContent = `Region too large (${w}×${h}).`;
                errEl.style.display = 'block';
                return;
            }

            close();
            onConfirm(newBounds);
        };

        const escH = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); } };
        document.addEventListener('keydown', escH);
    }

    async function rerunScreenshot(newBounds) {
        // Remove any existing modal
        const existing = document.querySelector('.rsc-modal-container');
        if (existing) existing.remove();

        const modal = createPreviewModal(newBounds, null, true);
        const progressEl = modal.querySelector('.rsc-progress-text');
        const updateProgress = (text) => { if (progressEl) progressEl.textContent = text; };

        try {
            const screenshotCanvas = await renderRegionToCanvas(newBounds, updateProgress);
            updatePreviewModal(modal, newBounds, screenshotCanvas);
        } catch (err) {
            console.error('[Region Screenshot] Error:', err);
            showNotification('Error capturing screenshot: ' + err.message);
            modal.closeModal();
        }
    }

    // ==================== MODAL ====================
    function createPreviewModal(bounds, screenshotCanvas, loading = false) {
        // Remove any existing modal
        const existing = document.querySelector('.rsc-modal-container');
        if (existing) existing.remove();

        const w = bounds.maxX - bounds.minX + 1;
        const h = bounds.maxY - bounds.minY + 1;

        // ---- Overlay ----
        const overlay = document.createElement('div');
        overlay.className = 'rsc-modal-container';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 10000;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // ---- Modal box ----
        const modal = document.createElement('div');
        modal.className = 'rsc-modal';
        modal.style.cssText = `
            position: relative;
            background: #1e1e2e;
            color: #cdd6f4;
            border-radius: 14px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.55);
            padding: 24px;
            min-width: 380px;
            max-width: min(90vw, 700px);
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            gap: 16px;
            font-family: system-ui, sans-serif;
        `;

        // ---- Header ----
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;';
        header.innerHTML = `
            <div>
                <h2 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 700; color: #cba6f7;">📷 Region Screenshot</h2>
                <p style="margin: 0; font-size: 13px; color: #a6adc8;">${w} × ${h} px &nbsp;|&nbsp; X: ${bounds.minX} → ${bounds.maxX} &nbsp;|&nbsp; Y: ${bounds.minY} → ${bounds.maxY}</p>
            </div>
        `;

        const adjustBtn = document.createElement('button');
        adjustBtn.textContent = 'Adjust…';
        adjustBtn.style.cssText = `
            flex-shrink: 0; padding: 5px 12px; border-radius: 6px; border: 1px solid #45475a;
            background: #313244; color: #a6adc8; font-size: 12px; cursor: pointer;
            transition: background 0.15s; white-space: nowrap;
        `;
        adjustBtn.onmouseover = () => { adjustBtn.style.background = '#45475a'; };
        adjustBtn.onmouseout  = () => { adjustBtn.style.background = '#313244'; };
        adjustBtn.onclick = () => {
            showAdjustModal(bounds, (newBounds) => {
                rerunScreenshot(newBounds);
            });
        };
        header.insertBefore(adjustBtn, null);

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
            flex-shrink: 0;
            background: #313244;
            border: none;
            color: #a6adc8;
            font-size: 16px;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s;
        `;
        closeBtn.onmouseover = () => { closeBtn.style.background = '#45475a'; };
        closeBtn.onmouseout  = () => { closeBtn.style.background = '#313244'; };
        header.appendChild(closeBtn);

        // ---- Content area ----
        const content = document.createElement('div');
        content.className = 'rsc-modal-content';
        content.style.cssText = `
            flex: 1;
            overflow: auto;
            display: flex;
            flex-direction: column;
            gap: 14px;
        `;

        if (loading) {
            content.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;
                            min-height: 180px; color: #a6adc8; gap: 12px;">
                    <div style="font-size: 36px;">⏳</div>
                    <div class="rsc-progress-text" style="font-size: 14px;">Preparing screenshot…</div>
                    <div style="font-size: 12px; color: #6c7086;">Large regions may take a moment</div>
                </div>
            `;
        } else if (screenshotCanvas) {
            buildPreviewContent(content, bounds, screenshotCanvas);
        }

        // ---- Assemble ----
        modal.appendChild(header);
        modal.appendChild(content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const closeModal = () => overlay.remove();
        closeBtn.onclick = closeModal;
        overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

        const escHandler = (e) => {
            if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);

        modal.closeModal = closeModal;
        return modal;
    }

    function updatePreviewModal(modal, bounds, screenshotCanvas) {
        const content = modal.querySelector('.rsc-modal-content');
        if (!content) return;
        content.innerHTML = '';
        buildPreviewContent(content, bounds, screenshotCanvas);
    }

    // Reads pixel data from canvas and returns [[hex, count], ...] sorted by count desc.
    function extractPaletteFromCanvas(canvas) {
        try {
            const ctx = canvas.getContext('2d');
            const { width, height } = canvas;
            const data = ctx.getImageData(0, 0, width, height).data;
            const counts = new Map();
            for (let i = 0; i < data.length; i += 4) {
                const a = data[i + 3];
                if (a < 128) continue;
                const hex = '#' + [data[i], data[i + 1], data[i + 2]]
                    .map(v => v.toString(16).toUpperCase().padStart(2, '0')).join('');
                counts.set(hex, (counts.get(hex) || 0) + 1);
            }
            return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        } catch (err) {
            console.error('[Region Screenshot] extractPaletteFromCanvas error:', err);
            return [];
        }
    }

    function buildPreviewContent(container, bounds, canvas) {
        const w = bounds.maxX - bounds.minX + 1;
        const h = bounds.maxY - bounds.minY + 1;

        // ---- Checkerboard preview wrapper (shows transparency) ----
        const previewWrapper = document.createElement('div');
        previewWrapper.style.cssText = `
            border-radius: 10px;
            overflow: hidden;
            max-height: 55vh;
            background: repeating-conic-gradient(#313244 0% 25%, #45475a 0% 50%) 0 0 / 16px 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid #45475a;
        `;

        const imgEl = document.createElement('img');
        imgEl.style.cssText = `
            max-width: 100%;
            max-height: 55vh;
            image-rendering: pixelated;
            object-fit: contain;
        `;
        const backgroundPref = loadBackgroundPreference();
        let backgroundMode = backgroundPref.mode;
        let backgroundColor = backgroundPref.color;

        const getExportCanvas = () => {
            return composeCanvasWithBackground(canvas, backgroundMode, backgroundColor);
        };

        const updatePreviewBackground = () => {
            imgEl.src = getExportCanvas().toDataURL('image/png');
            if (info) {
                info.textContent = backgroundMode === 'solid'
                    ? `${w}×${h} pixels • PNG with ${backgroundColor.toUpperCase()} background`
                    : `${w}×${h} pixels • PNG with transparent background`;
            }
        };

        previewWrapper.appendChild(imgEl);
        container.appendChild(previewWrapper);

        // ---- Background controls ----
        const bgRow = document.createElement('div');
        bgRow.style.cssText = 'display:flex;align-items:center;gap:10px;justify-content:center;flex-wrap:wrap;font-size:12px;color:#a6adc8;';

        const bgLabel = document.createElement('label');
        bgLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:600;';
        bgLabel.textContent = 'Background';

        const bgSelect = document.createElement('select');
        bgSelect.style.cssText = 'padding:5px 8px;border-radius:6px;border:1px solid #45475a;background:#313244;color:#cdd6f4;font-size:12px;cursor:pointer;';
        [
            { value: 'transparent', text: 'Transparent' },
            { value: 'solid', text: 'Solid color' },
        ].forEach(({ value, text }) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            bgSelect.appendChild(opt);
        });

        const bgColorInput = document.createElement('input');
        bgColorInput.type = 'color';
        bgColorInput.value = backgroundColor;
        bgColorInput.title = 'Background color';
        bgColorInput.style.cssText = 'width:34px;height:28px;padding:2px;border-radius:6px;border:1px solid #45475a;background:#313244;cursor:pointer;display:none;';
        bgSelect.value = backgroundMode;
        bgColorInput.style.display = backgroundMode === 'solid' ? '' : 'none';

        bgSelect.addEventListener('change', () => {
            backgroundMode = bgSelect.value;
            bgColorInput.style.display = backgroundMode === 'solid' ? '' : 'none';
            saveBackgroundPreference(backgroundMode, backgroundColor);
            updatePreviewBackground();
        });
        bgColorInput.addEventListener('input', () => {
            backgroundColor = bgColorInput.value;
            saveBackgroundPreference(backgroundMode, backgroundColor);
            updatePreviewBackground();
        });

        bgRow.appendChild(bgLabel);
        bgRow.appendChild(bgSelect);
        bgRow.appendChild(bgColorInput);
        container.appendChild(bgRow);

        // ---- Info row ----
        const info = document.createElement('p');
        info.style.cssText = 'margin: 0; font-size: 12px; color: #6c7086; text-align: center;';
        container.appendChild(info);
        updatePreviewBackground();

        // ---- Buttons ----
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 10px; justify-content: stretch;';

        // Download button
        const downloadBtn = document.createElement('button');
        downloadBtn.innerHTML = '⬇ Download PNG';
        downloadBtn.style.cssText = `
            flex: 1;
            padding: 10px 16px;
            background: #cba6f7;
            color: #1e1e2e;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.15s;
        `;
        downloadBtn.onmouseover = () => { downloadBtn.style.opacity = '0.85'; };
        downloadBtn.onmouseout  = () => { downloadBtn.style.opacity = '1'; };
        downloadBtn.onclick = () => {
            const link = document.createElement('a');
            const ts = (() => { try { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}-${String(d.getSeconds()).padStart(2,'0')}`; } catch(_) { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); } })();
            link.download = `geopixels-screenshot-${ts}.png`;
            link.href = getExportCanvas().toDataURL('image/png');
            link.click();
        };

        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = '📋 Copy to Clipboard';
        copyBtn.style.cssText = `
            flex: 1;
            padding: 10px 16px;
            background: #89dceb;
            color: #1e1e2e;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.15s;
        `;
        copyBtn.onmouseover = () => { copyBtn.style.opacity = '0.85'; };
        copyBtn.onmouseout  = () => { copyBtn.style.opacity = '1'; };
        copyBtn.onclick = () => {
            if (!navigator.clipboard || !window.ClipboardItem) {
                showNotification('Clipboard API not supported in this browser.');
                return;
            }
            getExportCanvas().toBlob(async (blob) => {
                try {
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                    copyBtn.innerHTML = '✅ Copied!';
                    setTimeout(() => { copyBtn.innerHTML = '📋 Copy to Clipboard'; }, 2000);
                } catch (err) {
                    console.error('[Region Screenshot] Clipboard write failed:', err);
                    showNotification('Could not write to clipboard: ' + err.message);
                }
            }, 'image/png');
        };

        btnRow.appendChild(downloadBtn);
        btnRow.appendChild(copyBtn);
        container.appendChild(btnRow);

        // ---- Show Palette button ----
        const paletteBtn = document.createElement('button');
        paletteBtn.textContent = '🎨 Show Palette';
        paletteBtn.style.cssText = `
            width: 100%; padding: 8px 16px;
            background: #45475a; color: #cdd6f4;
            border: none; border-radius: 8px; font-size: 13px;
            font-weight: 600; cursor: pointer; transition: opacity 0.15s;
        `;
        paletteBtn.onmouseover = () => { paletteBtn.style.opacity = '0.82'; };
        paletteBtn.onmouseout  = () => { paletteBtn.style.opacity = '1'; };

        const paletteSection = document.createElement('div');
        paletteSection.style.cssText = `
            display: none;
            background: #181825; border: 1px solid #45475a;
            border-radius: 8px; padding: 10px 12px;
        `;

        let _paletteLoaded = false;
        paletteBtn.onclick = () => {
            const open = paletteSection.style.display !== 'none';
            if (open) {
                paletteSection.style.display = 'none';
                paletteBtn.textContent = '🎨 Show Palette';
            } else {
                paletteSection.style.display = '';
                paletteBtn.textContent = '🎨 Hide Palette';
                if (!_paletteLoaded) {
                    _paletteLoaded = true;
                    renderPaletteSection(paletteSection, canvas);
                }
            }
        };

        container.appendChild(paletteBtn);
        container.appendChild(paletteSection);
    }

    function renderPaletteSection(container, canvas) {
        const palette = extractPaletteFromCanvas(canvas);

        if (!palette.length) {
            container.innerHTML = '<div style="font-size:12px;color:#6c7086;text-align:center;padding:4px;">No opaque pixels found in selection.</div>';
            return;
        }

        const hexList = palette.map(([hex]) => hex).join(', ');

        // Header row: color count + copy button
        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';

        const colorCount = document.createElement('span');
        colorCount.style.cssText = 'font-size:12px;color:#a6adc8;';
        colorCount.textContent = palette.length + ' color' + (palette.length !== 1 ? 's' : '');

        const copyHexBtn = document.createElement('button');
        copyHexBtn.textContent = '📋 Copy hex list';
        copyHexBtn.style.cssText = 'padding:3px 8px;border-radius:5px;border:none;background:#585b70;color:#cdd6f4;font-size:11px;cursor:pointer;';
        copyHexBtn.onclick = () => {
            const copyFallback = () => {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = hexList; ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
                    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                    copyHexBtn.textContent = '✅ Copied!';
                    setTimeout(() => { copyHexBtn.textContent = '📋 Copy hex list'; }, 2000);
                } catch (_) {}
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(hexList).then(() => {
                    copyHexBtn.textContent = '✅ Copied!';
                    setTimeout(() => { copyHexBtn.textContent = '📋 Copy hex list'; }, 2000);
                }).catch(copyFallback);
            } else { copyFallback(); }
        };

        headerRow.appendChild(colorCount);
        headerRow.appendChild(copyHexBtn);
        container.appendChild(headerRow);

        // Textarea with comma-separated hex values
        const hexTextarea = document.createElement('textarea');
        hexTextarea.value = hexList;
        hexTextarea.readOnly = true;
        hexTextarea.style.cssText = `
            width: 100%; height: 48px; resize: vertical;
            background: #1e1e2e; border: 1px solid #45475a; border-radius: 6px;
            padding: 6px 8px; font-family: monospace; font-size: 11px;
            color: #cdd6f4; box-sizing: border-box; margin-bottom: 8px;
        `;
        container.appendChild(hexTextarea);

        // Scrollable color list
        const colorList = document.createElement('div');
        colorList.style.cssText = 'display:flex;flex-direction:column;gap:2px;max-height:180px;overflow-y:auto;';

        palette.forEach(([hex, count]) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:2px 0;';

            const swatch = document.createElement('span');
            swatch.style.cssText = `
                display:inline-block;width:14px;height:14px;border-radius:3px;
                background:${hex};border:1px solid rgba(255,255,255,0.18);flex-shrink:0;
            `;

            const hexLabel = document.createElement('span');
            hexLabel.style.cssText = 'font-family:monospace;font-size:12px;color:#cdd6f4;flex:1;';
            hexLabel.textContent = hex;

            const countLabel = document.createElement('span');
            countLabel.style.cssText = 'font-size:11px;color:#6c7086;white-space:nowrap;';
            countLabel.textContent = count.toLocaleString() + ' px';

            row.appendChild(swatch);
            row.appendChild(hexLabel);
            row.appendChild(countLabel);
            colorList.appendChild(row);
        });

        container.appendChild(colorList);
    }

    // ==================== NOTIFICATIONS ====================
    function showNotification(message) {
        if (typeof showAnnouncement === 'function') {
            showAnnouncement(message);
            return;
        }

        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #313244;
            color: #cdd6f4;
            padding: 12px 24px;
            border-radius: 10px;
            z-index: 10002;
            font-size: 14px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            font-family: system-ui, sans-serif;
            max-width: 400px;
            text-align: center;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.transition = 'opacity 0.3s';
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3500);
    }

    // ==================== PROCESS WITH BOUNDS (for flyout) =========
    async function processWithBounds(bounds) {
        const width = bounds.maxX - bounds.minX + 1;
        const height = bounds.maxY - bounds.minY + 1;
        if (width < 2 || height < 2) { showNotification('Selection too small — please select a larger area.'); return; }
        if (width * height > MAX_REGION_PIXELS) { showNotification(`Region too large (${width}×${height}). Maximum is ~15000×15000 px.`); return; }
        const modal = createPreviewModal(bounds, null, true);
        const progressEl = modal.querySelector('.rsc-progress-text');
        const updateProgress = (text) => { if (progressEl) progressEl.textContent = text; };
        try {
            const screenshotCanvas = await renderRegionToCanvas(bounds, updateProgress);
            updatePreviewModal(modal, bounds, screenshotCanvas);
        } catch (err) {
            console.error('[Region Screenshot] Error:', err);
            showNotification('Error capturing screenshot: ' + err.message);
            try { modal.closeModal(); } catch {}
        }
    }

    async function silentDownload(bounds) {
        const width = bounds.maxX - bounds.minX + 1;
        const height = bounds.maxY - bounds.minY + 1;
        if (width < 2 || height < 2 || width * height > MAX_REGION_PIXELS) return;
        try {
            const canvas = await renderRegionToCanvas(bounds, () => {});
            const backgroundPref = loadBackgroundPreference();
            const exportCanvas = composeCanvasWithBackground(canvas, backgroundPref.mode, backgroundPref.color);
            const link = document.createElement('a');
            const ts = (() => { try { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}-${String(d.getSeconds()).padStart(2,'0')}`; } catch(_) { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); } })();
            link.download = `geopixels-screenshot-${ts}.png`;
            link.href = exportCanvas.toDataURL('image/png');
            link.click();
        } catch (err) {
            console.error('[Region Screenshot] Silent download error:', err);
        }
    }

    // ==================== START ====================
    init();

    // Expose API for flyout
    _regionScreenshot = { processWithBounds, toggleSelectionMode, silentDownload };
            })();
            _featureStatus.regionScreenshot = 'ok';
            console.log('[GeoPixelcons++] \u2705 Region Screenshot loaded');
        } catch (err) {
            _featureStatus.regionScreenshot = 'error';
            dbgPush(`Region Screenshot init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Region Screenshot' });
            console.error('[GeoPixelcons++] ❌ Region Screenshot failed:', err);
        }
    }