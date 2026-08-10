
    // ============================================================
    //  FEATURE: Regions Highscore [regionsHighscore]
    // ============================================================
    if (_settings.regionsHighscore) {
        try {
            (function _init_regionsHighscore() {

    // ==================== CONFIGURATION ====================
    const GRID_SIZE = 25;
    const TILE_SIZE = 1000;
    const USERNAME_BATCH_SIZE = 10;
    const SELECTION_COLOR = 'rgba(59, 130, 246, 0.3)';
    const SELECTION_BORDER_COLOR = 'rgba(59, 130, 246, 0.8)';

    // ==================== STATE ====================
    let isSelectionModeActive = false;
    let isDragging = false;
    let selectionStart = null;
    let selectionEnd = null;
    let selectionCanvas = null;
    let selectionCtx = null;
    let highscoreButton = null;
    let _map = null; // resolved MapLibre map object (not the DOM element)

    // ==================== MAP ACCESS ====================
    function _getMap() {
        if (_map) return _map;
        try { const m = (0, eval)('map'); if (m && typeof m.scrollZoom !== 'undefined') return (_map = m); } catch {}
        if (typeof unsafeWindow !== 'undefined') { try { const m = unsafeWindow.eval('map'); if (m && typeof m.scrollZoom !== 'undefined') return (_map = m); } catch {} }
        return null;
    }

    // ==================== INITIALIZATION ====================
    function waitForGeoPixels() {
        return new Promise((resolve) => {
            const watchStartedAt = Date.now();
            let firstCheck = true;
            let warnedSlow = false;
            const check = () => {
                if (firstCheck) {
                    firstCheck = false;
                    dbgPush('Regions Highscore: waiting for map/turf/tileImageCache/#controls-left to become available -- polling every 500ms.', { uiComponent: 'Regions Highscore' });
                }

                const mapReady = !!_getMap();
                const turfReady = typeof turf !== 'undefined';
                const tileCacheReady = typeof tileImageCache !== 'undefined';
                const controlsReady = !!document.getElementById('controls-left');

                if (mapReady && turfReady && tileCacheReady && controlsReady) {
                    dbgPush('Regions Highscore: all init conditions met after ' + (Date.now() - watchStartedAt) + 'ms -- proceeding.', { uiComponent: 'Regions Highscore' });
                    resolve();
                } else {
                    if (!warnedSlow && (Date.now() - watchStartedAt) >= 15000) {
                        warnedSlow = true;
                        const missing = [];
                        if (!mapReady) missing.push('map');
                        if (!turfReady) missing.push('turf');
                        if (!tileCacheReady) missing.push('tileImageCache');
                        if (!controlsReady) missing.push('#controls-left');
                        dbgPush('Regions Highscore: still waiting after 15s -- still unmet: ' + missing.join(', ') + '. This feature has no fallback if it never inits, so polling continues.', { uiComponent: 'Regions Highscore' });
                        console.error('[GeoPixelcons++] Regions Highscore: waitForGeoPixels still unmet after 15s -- missing: ' + missing.join(', '));
                    }
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    async function init() {
        await waitForGeoPixels();
        console.log('[Regions Highscore] Initializing...');

        createSelectionCanvas();
        createHighscoreButton();
        setupEventListeners();

        console.log('[Regions Highscore] Ready!');
    }

    // ==================== UI COMPONENTS ====================
    function createHighscoreButton() {
        highscoreButton = document.createElement('button');
        highscoreButton.id = 'gpc-highscore-trigger';
        highscoreButton.style.display = 'none';
        highscoreButton.addEventListener('click', toggleSelectionMode);
        document.body.appendChild(highscoreButton);
    }

    function createSelectionCanvas() {
        selectionCanvas = document.createElement('canvas');
        selectionCanvas.id = 'highscore-selection-canvas';
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

        // Sync canvas size with viewport
        const syncCanvasSize = () => {
            const dpr = window.devicePixelRatio || 1;
            selectionCanvas.width = window.innerWidth * dpr;
            selectionCanvas.height = window.innerHeight * dpr;
            selectionCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        syncCanvasSize();
        window.addEventListener('resize', syncCanvasSize);

        // Redraw on map events
        ['move', 'rotate', 'zoom'].forEach((ev) => {
            _map.on(ev, () => {
                if (isDragging) drawSelectionPreview();
            });
        });
    }

    function toggleSelectionMode() {
        isSelectionModeActive = !isSelectionModeActive;

        if (isSelectionModeActive) {
            highscoreButton.style.backgroundColor = '#3b82f6';
            highscoreButton.style.color = 'white';
            highscoreButton.style.boxShadow = '0 0 10px rgba(59, 130, 246, 0.5)';
            document.body.style.cursor = 'crosshair';
            disableMapInteractions();
            showNotification('Click and drag to select a region');
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

        if (highscoreButton) {
            highscoreButton.style.backgroundColor = 'white';
            highscoreButton.style.color = 'black';
            highscoreButton.style.boxShadow = '';
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
        if (e.button !== 0) return; // Only left click

        // Check if clicking on UI elements
        if (e.target.closest('#controls-left') || e.target.closest('#controls-right') || e.target.closest('.modal-container')) {
            return;
        }

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
            showNotification('Selection too small. Please select a larger area.');
            clearSelectionCanvas();
            resetSelectionMode();
            return;
        }

        // Reset mode but keep selection visible during computation
        isSelectionModeActive = false;
        if (highscoreButton) {
            highscoreButton.style.backgroundColor = 'white';
            highscoreButton.style.color = 'black';
            highscoreButton.style.boxShadow = '';
        }
        document.body.style.cursor = '';
        enableMapInteractions();

        // Show loading modal
        const modal = createLeaderboardModal(bounds, null, true);
        const progressEl = modal.querySelector('.rhs-progress-text');

        const updateProgress = (text) => {
            if (progressEl) progressEl.textContent = text;
        };

        try {
            const userCounts = await computeRegionPixels(bounds, updateProgress);
            updateProgress('Fetching usernames...');
            const leaderboard = await buildLeaderboard(userCounts);
            updateLeaderboardModal(modal, bounds, leaderboard);
        } catch (error) {
            console.error('[Regions Highscore] Error computing leaderboard:', error);
            showNotification('Error computing leaderboard: ' + error.message);
            modal.close();
        }

        clearSelectionCanvas();
        selectionStart = null;
        selectionEnd = null;
    }

    function handleKeyDown(e) {
        if (e.key === 'Escape') {
            if (isSelectionModeActive || isDragging) {
                resetSelectionMode();
            }
        }
    }

    // ==================== COORDINATE HELPERS ====================
    function screenPointToGrid(clientX, clientY) {
        // _map.unproject expects point relative to map container
        const mapContainer = _map.getContainer();
        const rect = mapContainer.getBoundingClientRect();
        const point = [clientX - rect.left, clientY - rect.top];
        
        const lngLat = _map.unproject(point);
        const merc = turf.toMercator([lngLat.lng, lngLat.lat]);

        return {
            gridX: Math.round(merc[0] / GRID_SIZE),
            gridY: Math.round(merc[1] / GRID_SIZE),
        };
    }

    function gridToScreen(gridX, gridY) {
        const mercX = gridX * GRID_SIZE;
        const mercY = gridY * GRID_SIZE;
        const lngLat = turf.toWgs84([mercX, mercY]);
        const point = _map.project(lngLat);
        
        // Convert map-relative coordinates to screen coordinates
        const mapContainer = _map.getContainer();
        const rect = mapContainer.getBoundingClientRect();
        
        return {
            x: point.x + rect.left,
            y: point.y + rect.top
        };
    }

    function getSelectionBounds() {
        return {
            minX: Math.min(selectionStart.gridX, selectionEnd.gridX),
            maxX: Math.max(selectionStart.gridX, selectionEnd.gridX),
            minY: Math.min(selectionStart.gridY, selectionEnd.gridY),
            maxY: Math.max(selectionStart.gridY, selectionEnd.gridY),
        };
    }

    // ==================== DRAWING ====================
    function drawSelectionPreview() {
        clearSelectionCanvas();
        if (!selectionStart || !selectionEnd) return;

        const bounds = getSelectionBounds();

        // Convert grid bounds to screen coordinates
        const topLeft = gridToScreen(bounds.minX - 0.5, bounds.maxY + 0.5);
        const bottomRight = gridToScreen(bounds.maxX + 0.5, bounds.minY - 0.5);

        const x = topLeft.x;
        const y = topLeft.y;
        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;

        selectionCtx.fillStyle = SELECTION_COLOR;
        selectionCtx.fillRect(x, y, width, height);

        selectionCtx.strokeStyle = SELECTION_BORDER_COLOR;
        selectionCtx.lineWidth = 2;
        selectionCtx.strokeRect(x, y, width, height);

        // Draw size indicator
        const selWidth = bounds.maxX - bounds.minX + 1;
        const selHeight = bounds.maxY - bounds.minY + 1;
        const sizeText = `${selWidth} × ${selHeight}`;

        selectionCtx.font = 'bold 14px sans-serif';
        selectionCtx.fillStyle = 'white';
        selectionCtx.strokeStyle = 'black';
        selectionCtx.lineWidth = 3;

        const textX = x + width / 2;
        const textY = y + height / 2;

        selectionCtx.textAlign = 'center';
        selectionCtx.textBaseline = 'middle';
        selectionCtx.strokeText(sizeText, textX, textY);
        selectionCtx.fillText(sizeText, textX, textY);
    }

    // ==================== PIXEL COMPUTATION ====================
    async function computeRegionPixels(bounds, updateProgress) {
        const userCounts = new Map();
        const { minX, maxX, minY, maxY } = bounds;

        // Determine which tiles we need (more efficient iteration)
        const neededTiles = new Set();
        const startTileX = Math.floor(minX / TILE_SIZE) * TILE_SIZE;
        const endTileX = Math.floor(maxX / TILE_SIZE) * TILE_SIZE;
        const startTileY = Math.floor(minY / TILE_SIZE) * TILE_SIZE;
        const endTileY = Math.floor(maxY / TILE_SIZE) * TILE_SIZE;

        for (let tx = startTileX; tx <= endTileX; tx += TILE_SIZE) {
            for (let ty = startTileY; ty <= endTileY; ty += TILE_SIZE) {
                neededTiles.add(`${tx},${ty}`);
            }
        }

        const tilesArray = [...neededTiles];
        console.log(`[Regions Highscore] Need ${tilesArray.length} tiles for region ${maxX - minX + 1}×${maxY - minY + 1}`);
        console.log(`[Regions Highscore] Selection bounds: X ${minX} to ${maxX}, Y ${minY} to ${maxY}`);
        console.log(`[Regions Highscore] Tiles needed:`, tilesArray);

        let processedTiles = 0;
        let totalPixelsFound = 0;

        for (const tileKey of tilesArray) {
            const [tileX, tileY] = tileKey.split(',').map(Number);

            // Update progress
            processedTiles++;
            if (updateProgress) {
                updateProgress(`Processing tile ${processedTiles}/${tilesArray.length}...`);
            }

            // Yield to UI
            await new Promise(resolve => setTimeout(resolve, 0));

            // Try to get from cache first
            let userBitmap = null;
            const cached = tileImageCache.get(tileKey);
            console.log(`[Regions Highscore] Cache lookup for ${tileKey}:`, cached ? 'FOUND' : 'NOT FOUND');
            if (cached) {
                console.log(`[Regions Highscore] Cache entry keys:`, Object.keys(cached));
                console.log(`[Regions Highscore] Cache entry:`, cached);
            }
            if (cached && cached.userBitmap) {
                userBitmap = cached.userBitmap;
                console.log(`[Regions Highscore] Using cached userBitmap, size: ${userBitmap.width}x${userBitmap.height}`);
            } else {
                // Fetch from API
                console.log(`[Regions Highscore] Fetching tile ${tileKey} from API...`);
                if (updateProgress) {
                    updateProgress(`Fetching tile ${tileKey}...`);
                }
                try {
                    const tileData = await fetchTileData(tileX, tileY);
                    console.log(`[Regions Highscore] API response for ${tileKey}:`, tileData);
                    if (tileData && tileData.userBitmap) {
                        userBitmap = tileData.userBitmap;
                        console.log(`[Regions Highscore] Fetched userBitmap, size: ${userBitmap.width}x${userBitmap.height}`);
                    }
                } catch (err) {
                    console.warn(`[Regions Highscore] Failed to fetch tile ${tileKey}:`, err);
                    continue;
                }
            }

            if (!userBitmap) continue;

            // Debug: check if bitmap has ANY non-zero data by sampling various points
            const debugCanvas = new OffscreenCanvas(userBitmap.width, userBitmap.height);
            const debugCtx = debugCanvas.getContext('2d', { willReadFrequently: true });
            debugCtx.drawImage(userBitmap, 0, 0);
            const fullData = debugCtx.getImageData(0, 0, userBitmap.width, userBitmap.height).data;
            let nonZeroInFullBitmap = 0;
            for (let i = 0; i < fullData.length; i += 4) {
                if (fullData[i] !== 0 || fullData[i+1] !== 0 || fullData[i+2] !== 0) {
                    nonZeroInFullBitmap++;
                    if (nonZeroInFullBitmap <= 3) {
                        const pixelIndex = i / 4;
                        const bmpX = pixelIndex % userBitmap.width;
                        const bmpY = Math.floor(pixelIndex / userBitmap.width);
                        // Convert back to grid coordinates both ways
                        const gridXFromBmp = tileX + bmpX;
                        const gridYInverted = tileY + (TILE_SIZE - 1 - bmpY);
                        const gridYDirect = tileY + bmpY;
                        console.log(`[Regions Highscore] Non-zero pixel at bitmap (${bmpX}, ${bmpY}): RGB(${fullData[i]},${fullData[i+1]},${fullData[i+2]})`);
                        console.log(`  - Grid coords if Y inverted: (${gridXFromBmp}, ${gridYInverted})`);
                        console.log(`  - Grid coords if Y direct: (${gridXFromBmp}, ${gridYDirect})`);
                    }
                }
            }
            console.log(`[Regions Highscore] Total non-zero pixels in FULL bitmap: ${nonZeroInFullBitmap}`);
            
            // Check specific pixel (-351700, 218914) that user mentioned
            const testGridX = -351700;
            const testGridY = 218914;
            if (testGridX >= tileX && testGridX < tileX + TILE_SIZE && testGridY >= tileY && testGridY < tileY + TILE_SIZE) {
                const testLocalX = testGridX - tileX;
                const testLocalYInverted = TILE_SIZE - 1 - (testGridY - tileY);
                const testLocalYDirect = testGridY - tileY;
                
                console.log(`[Regions Highscore] Test pixel (-351700, 218914):`);
                console.log(`  - If Y inverted: local (${testLocalX}, ${testLocalYInverted})`);
                console.log(`  - If Y direct: local (${testLocalX}, ${testLocalYDirect})`);
                
                const testIdxInverted = (testLocalYInverted * userBitmap.width + testLocalX) * 4;
                const testIdxDirect = (testLocalYDirect * userBitmap.width + testLocalX) * 4;
                
                console.log(`  - Inverted value: RGB(${fullData[testIdxInverted]},${fullData[testIdxInverted+1]},${fullData[testIdxInverted+2]},${fullData[testIdxInverted+3]})`);
                console.log(`  - Direct value: RGB(${fullData[testIdxDirect]},${fullData[testIdxDirect+1]},${fullData[testIdxDirect+2]},${fullData[testIdxDirect+3]})`);
            }

            // Calculate the region of this tile that overlaps with selection
            const tileMinX = Math.max(minX, tileX);
            const tileMaxX = Math.min(maxX, tileX + TILE_SIZE - 1);
            const tileMinY = Math.max(minY, tileY);
            const tileMaxY = Math.min(maxY, tileY + TILE_SIZE - 1);

            const regionWidth = tileMaxX - tileMinX + 1;
            const regionHeight = tileMaxY - tileMinY + 1;

            if (regionWidth <= 0 || regionHeight <= 0) continue;

            // Read the entire relevant region at once (much faster than 1x1)
            // Y is NOT inverted in the bitmap - use direct coordinates
            const localStartX = tileMinX - tileX;
            const localStartY = tileMinY - tileY;

            console.log(`[Regions Highscore] Tile ${tileKey}: reading region ${regionWidth}x${regionHeight} at local (${localStartX}, ${localStartY})`);
            console.log(`[Regions Highscore] Tile bounds: X ${tileMinX}-${tileMaxX}, Y ${tileMinY}-${tileMaxY}`);

            const tempCanvas = new OffscreenCanvas(regionWidth, regionHeight);
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            tempCtx.drawImage(
                userBitmap,
                localStartX, localStartY, regionWidth, regionHeight,
                0, 0, regionWidth, regionHeight
            );

            const imageData = tempCtx.getImageData(0, 0, regionWidth, regionHeight);
            const data = imageData.data;

            // Debug: log sample pixels to understand the data format
            console.log(`[Regions Highscore] ImageData size: ${imageData.width}x${imageData.height}, data length: ${data.length}`);
            const samplePixels = [];
            for (let s = 0; s < Math.min(10, regionWidth * regionHeight); s++) {
                const idx = s * 4;
                samplePixels.push(`(${data[idx]},${data[idx+1]},${data[idx+2]},${data[idx+3]})`);
            }
            console.log(`[Regions Highscore] First 10 pixels (RGBA):`, samplePixels.join(' '));

            // Process pixels in chunks to avoid blocking UI
            const CHUNK_SIZE = 50000;
            const totalPixels = regionWidth * regionHeight;
            let nonZeroCount = 0;

            for (let i = 0; i < totalPixels; i++) {
                const offset = i * 4;
                const r = data[offset];
                const g = data[offset + 1];
                const b = data[offset + 2];
                const a = data[offset + 3];

                // User ID is encoded in RGB; check if RGB is non-zero (not alpha)
                const userId = (r << 16) | (g << 8) | b;
                if (userId > 0) {
                    userCounts.set(userId, (userCounts.get(userId) || 0) + 1);
                    totalPixelsFound++;
                    if (nonZeroCount < 3) {
                        console.log(`[Regions Highscore] Found user pixel: userId=${userId} (R=${r},G=${g},B=${b},A=${a})`);
                    }
                    nonZeroCount++;
                }

                // Yield every CHUNK_SIZE pixels to keep UI responsive
                if (i > 0 && i % CHUNK_SIZE === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            console.log(`[Regions Highscore] Found ${nonZeroCount} non-zero pixels in tile region`);
        }

        console.log(`[Regions Highscore] Total pixels with users found: ${totalPixelsFound}`);
        console.log(`[Regions Highscore] Unique users: ${userCounts.size}`);

        return userCounts;
    }

    async function fetchTileData(tileX, tileY) {
        const response = await fetch('https://geopixels.net/GetPixelsCached', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Tiles: [{ x: tileX, y: tileY, timestamp: 0 }],
            }),
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();
        const tileKey = `tile_${tileX}_${tileY}`;
        const tileInfo = data.Tiles[tileKey];

        console.log(`[Regions Highscore] API tile key: ${tileKey}`);
        console.log(`[Regions Highscore] Available tiles in response:`, Object.keys(data.Tiles));
        console.log(`[Regions Highscore] Tile info:`, tileInfo);

        if (!tileInfo) return null;

        // Handle full tile with WebP images
        if (tileInfo.Type === 'full' && tileInfo.UserWebP) {
            const userBitmap = await decodeWebPToBitmap(tileInfo.UserWebP);
            return { userBitmap };
        }

        // Handle delta (partial update) - we need to process deltas
        if (tileInfo.Pixels && tileInfo.Pixels.length > 0) {
            // Create bitmap from deltas
            const userBitmap = await createBitmapFromDeltas(tileInfo.Pixels, tileX, tileY);
            return { userBitmap };
        }

        return null;
    }

    async function decodeWebPToBitmap(base64Data) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                createImageBitmap(img).then(resolve).catch(reject);
            };
            img.onerror = reject;
            img.src = `data:image/webp;base64,${base64Data}`;
        });
    }

    async function createBitmapFromDeltas(deltas, tileX, tileY) {
        const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
        const ctx = canvas.getContext('2d');

        for (const delta of deltas) {
            const [gridX, gridY, color, userId] = delta;
            // Y is NOT inverted - use direct coordinates
            const localX = gridX - tileX;
            const localY = gridY - tileY;

            // Encode userId as RGB
            const r = (userId >> 16) & 0xff;
            const g = (userId >> 8) & 0xff;
            const b = userId & 0xff;

            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(localX, localY, 1, 1);
        }

        return createImageBitmap(canvas);
    }

    // ==================== LEADERBOARD ====================
    async function buildLeaderboard(userCounts) {
        // Sort by pixel count descending
        const sorted = [...userCounts.entries()].sort((a, b) => b[1] - a[1]);

        // Fetch usernames
        const userIds = sorted.map(([id]) => id);
        const usernames = await fetchUsernames(userIds);

        return sorted.map(([userId, count], index) => ({
            rank: index + 1,
            userId,
            username: usernames.get(userId) || `User #${userId}`,
            pixelCount: count,
        }));
    }

    async function fetchUsernames(userIds) {
        const usernames = new Map();

        // Batch requests
        for (let i = 0; i < userIds.length; i += USERNAME_BATCH_SIZE) {
            const batch = userIds.slice(i, i + USERNAME_BATCH_SIZE);

            const promises = batch.map(async (userId) => {
                try {
                    const response = await fetch('https://geopixels.net/GetUserProfile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ targetId: userId }),
                    });

                    if (response.ok) {
                        const data = await response.json();
                        return { userId, name: data.name || `User #${userId}` };
                    }
                } catch (err) {
                    console.warn(`[Regions Highscore] Failed to fetch user ${userId}:`, err);
                }
                return { userId, name: `User #${userId}` };
            });

            const results = await Promise.all(promises);
            for (const { userId, name } of results) {
                usernames.set(userId, name);
            }
        }

        return usernames;
    }

    // ==================== THEME HELPERS ====================
    function isDarkMode() {
        return getComputedStyle(document.documentElement).colorScheme === 'dark';
    }

    function getThemeColors() {
        const dark = isDarkMode();
        return {
            modalBg: dark ? '#1e2939' : 'white',
            overlayBg: dark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
            text: dark ? '#f3f4f6' : '#333',
            textSecondary: dark ? '#d1d5db' : '#666',
            textMuted: dark ? '#99a1af' : '#888',
            textSubtle: dark ? '#6a7282' : '#999',
            border: dark ? '#364153' : '#eee',
            headerBg: dark ? '#101828' : '#f0f0f0',
            summaryBg: dark ? '#101828' : '#f8f9fa',
            summaryText: dark ? '#d1d5db' : '#555',
            closeBtnColor: dark ? '#99a1af' : '#666',
            closeBtnHoverBg: dark ? '#364153' : '#f0f0f0',
            closeBtnHoverColor: dark ? '#f3f4f6' : '#333',
            notificationBg: dark ? '#1e2939' : '#333',
            notificationText: dark ? '#f3f4f6' : 'white',
        };
    }

    // ==================== ADJUST BOUNDS MODAL ====================
    function showAdjustModal(currentBounds, onConfirm) {
        const existing = document.querySelector('.rhs-adjust-overlay');
        if (existing) existing.remove();

        const t = getThemeColors();

        const overlay = document.createElement('div');
        overlay.className = 'rhs-adjust-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 10001;
            background: ${t.overlayBg};
            display: flex; align-items: center; justify-content: center;
            font-family: system-ui, sans-serif;
        `;

        const inputStyle = `width: 100%; margin-top: 2px; padding: 6px 8px; border-radius: 6px; border: 1px solid ${t.border}; background: ${t.headerBg}; color: ${t.text}; font-size: 13px; font-family: monospace;`;

        const box = document.createElement('div');
        box.style.cssText = `
            background: ${t.modalBg}; color: ${t.text}; border-radius: 12px;
            box-shadow: 0 16px 48px rgba(0,0,0,0.5);
            padding: 24px; min-width: 320px; display: flex; flex-direction: column; gap: 14px;
        `;

        box.innerHTML = `
            <h3 style="margin: 0; font-size: 16px; font-weight: 700;">Adjust Region Bounds</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <label style="font-size: 12px; color: ${t.textSecondary};">X1 (min)
                    <input id="rhs-adj-x1" type="number" value="${currentBounds.minX}" style="${inputStyle}" />
                </label>
                <label style="font-size: 12px; color: ${t.textSecondary};">X2 (max)
                    <input id="rhs-adj-x2" type="number" value="${currentBounds.maxX}" style="${inputStyle}" />
                </label>
                <label style="font-size: 12px; color: ${t.textSecondary};">Y1 (min)
                    <input id="rhs-adj-y1" type="number" value="${currentBounds.minY}" style="${inputStyle}" />
                </label>
                <label style="font-size: 12px; color: ${t.textSecondary};">Y2 (max)
                    <input id="rhs-adj-y2" type="number" value="${currentBounds.maxY}" style="${inputStyle}" />
                </label>
            </div>
            <div id="rhs-adj-error" style="font-size: 12px; color: #ef4444; display: none;"></div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="rhs-adj-cancel" style="padding: 8px 16px; border-radius: 8px; border: 1px solid ${t.border}; background: ${t.headerBg}; color: ${t.textSecondary}; cursor: pointer; font-size: 13px;">Cancel</button>
                <button id="rhs-adj-confirm" style="padding: 8px 16px; border-radius: 8px; border: none; background: #3b82f6; color: white; cursor: pointer; font-size: 13px; font-weight: 600;">Apply</button>
            </div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        box.querySelector('#rhs-adj-cancel').onclick = close;

        box.querySelector('#rhs-adj-confirm').onclick = () => {
            const x1 = parseInt(box.querySelector('#rhs-adj-x1').value);
            const x2 = parseInt(box.querySelector('#rhs-adj-x2').value);
            const y1 = parseInt(box.querySelector('#rhs-adj-y1').value);
            const y2 = parseInt(box.querySelector('#rhs-adj-y2').value);
            const errEl = box.querySelector('#rhs-adj-error');

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

            close();
            onConfirm(newBounds);
        };

        const escH = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); } };
        document.addEventListener('keydown', escH);
    }

    async function rerunLeaderboard(newBounds) {
        // Remove any existing modal
        const existing = document.querySelector('.rhs-modal-container');
        if (existing) existing.remove();

        const modal = createLeaderboardModal(newBounds, null, true);
        const progressEl = modal.querySelector('.rhs-progress-text');
        const updateProgress = (text) => { if (progressEl) progressEl.textContent = text; };

        try {
            const userCounts = await computeRegionPixels(newBounds, updateProgress);
            updateProgress('Fetching usernames...');
            const leaderboard = await buildLeaderboard(userCounts);
            updateLeaderboardModal(modal, newBounds, leaderboard);
        } catch (error) {
            console.error('[Regions Highscore] Error:', error);
            showNotification('Error computing leaderboard: ' + error.message);
            modal.close();
        }
    }

    // ==================== MODAL ====================
    function createLeaderboardModal(bounds, leaderboard = null, loading = false) {
        // Remove existing modal if any
        const existing = document.querySelector('.rhs-modal-container');
        if (existing) existing.remove();

        const width = bounds.maxX - bounds.minX + 1;
        const height = bounds.maxY - bounds.minY + 1;
        const totalPixels = width * height;

        const t = getThemeColors();

        const modalContainer = document.createElement('div');
        modalContainer.className = 'rhs-modal-container';
        modalContainer.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 10000;
            background: ${t.overlayBg};
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const modal = document.createElement('div');
        modal.className = 'rhs-modal';
        modal.style.cssText = `
            position: relative;
            background: ${t.modalBg};
            color: ${t.text};
            border-radius: 12px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
            padding: 24px;
            min-width: 400px;
            max-width: 90vw;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
        `;

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
            position: absolute;
            top: 12px;
            right: 12px;
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: ${t.closeBtnColor};
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        `;
        closeBtn.onmouseover = () => { closeBtn.style.background = t.closeBtnHoverBg; closeBtn.style.color = t.closeBtnHoverColor; };
        closeBtn.onmouseout = () => { closeBtn.style.background = 'none'; closeBtn.style.color = t.closeBtnColor; };

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'margin-bottom: 16px; padding-right: 32px;';
        header.innerHTML = `
            <h2 style="margin: 0 0 8px 0; font-size: 24px; font-weight: bold; color: ${t.text};">📊 Region Leaderboard</h2>
            <p style="margin: 0; color: ${t.textSecondary}; font-size: 14px;">Selected area: ${width} × ${height} pixels (${totalPixels.toLocaleString()} total)</p>
            <p style="margin: 4px 0 0 0; color: ${t.textMuted}; font-size: 12px; font-family: monospace;">X: ${bounds.minX} to ${bounds.maxX} | Y: ${bounds.minY} to ${bounds.maxY}</p>
        `;

        const adjustBtn = document.createElement('button');
        adjustBtn.textContent = 'Adjust…';
        adjustBtn.style.cssText = `
            margin-top: 8px; padding: 5px 12px; border-radius: 6px; border: 1px solid ${t.border};
            background: ${t.headerBg}; color: ${t.textSecondary}; font-size: 12px; cursor: pointer;
            transition: background 0.15s; white-space: nowrap;
        `;
        adjustBtn.onmouseover = () => { adjustBtn.style.background = t.closeBtnHoverBg; };
        adjustBtn.onmouseout  = () => { adjustBtn.style.background = t.headerBg; };
        adjustBtn.onclick = () => {
            showAdjustModal(bounds, (newBounds) => {
                rerunLeaderboard(newBounds);
            });
        };
        header.appendChild(adjustBtn);

        // Content area
        const content = document.createElement('div');
        content.className = 'rhs-modal-content';
        content.style.cssText = `
            flex: 1;
            overflow-y: auto;
            min-height: 200px;
        `;

        if (loading) {
            content.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: ${t.textSecondary};">
                    <div style="font-size: 32px; margin-bottom: 16px;">⏳</div>
                    <div class="rhs-progress-text">Calculating leaderboard...</div>
                    <div style="font-size: 12px; margin-top: 8px; color: ${t.textSubtle};">This may take a moment for large regions</div>
                </div>
            `;
        } else if (leaderboard) {
            content.appendChild(createLeaderboardTable(leaderboard));
        }

        modal.appendChild(closeBtn);
        modal.appendChild(header);
        modal.appendChild(content);
        modalContainer.appendChild(modal);
        document.body.appendChild(modalContainer);

        // Close handlers
        const closeModal = () => modalContainer.remove();
        closeBtn.onclick = closeModal;
        modalContainer.onclick = (e) => { if (e.target === modalContainer) closeModal(); };

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        modal.close = closeModal;
        return modal;
    }

    function updateLeaderboardModal(modal, bounds, leaderboard) {
        const content = modal.querySelector('.rhs-modal-content');
        if (!content) return;

        content.innerHTML = '';

        if (leaderboard.length === 0) {
            const t = getThemeColors();
            content.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 150px; color: ${t.textSecondary};">
                    <div style="font-size: 32px; margin-bottom: 16px;">🤷</div>
                    <div>No pixels found in this region</div>
                </div>
            `;
        } else {
            content.appendChild(createLeaderboardTable(leaderboard));
        }
    }

    function createLeaderboardTable(leaderboard) {
        const t = getThemeColors();
        const container = document.createElement('div');

        // Summary
        const totalPixels = leaderboard.reduce((sum, entry) => sum + entry.pixelCount, 0);
        const summary = document.createElement('div');
        summary.style.cssText = `margin-bottom: 16px; padding: 12px; background: ${t.summaryBg}; border-radius: 8px; font-size: 14px; color: ${t.summaryText};`;
        summary.innerHTML = `<strong>${leaderboard.length}</strong> users placed <strong>${totalPixels.toLocaleString()}</strong> pixels in this region`;
        container.appendChild(summary);

        // Table
        const table = document.createElement('table');
        table.style.cssText = `width: 100%; border-collapse: collapse; font-size: 14px; color: ${t.text};`;

        // Header row
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr style="background: ${t.headerBg}; text-align: left;">
                <th style="padding: 10px 12px; font-weight: 600; width: 60px;">Rank</th>
                <th style="padding: 10px 12px; font-weight: 600;">Username</th>
                <th style="padding: 10px 12px; font-weight: 600; text-align: right; width: 100px;">Pixels</th>
                <th style="padding: 10px 12px; font-weight: 600; text-align: right; width: 80px;">%</th>
            </tr>
        `;
        table.appendChild(thead);

        // Body rows
        const tbody = document.createElement('tbody');

        for (const entry of leaderboard) {
            const row = document.createElement('tr');
            row.style.cssText = `
                border-bottom: 1px solid ${t.border};
                ${entry.rank <= 3 ? 'background: ' + getRankBackground(entry.rank) + ';' : ''}
            `;

            const percent = ((entry.pixelCount / totalPixels) * 100).toFixed(1);
            const rankEmoji = getRankEmoji(entry.rank);

            row.innerHTML = `
                <td style="padding: 10px 12px; font-weight: ${entry.rank <= 3 ? 'bold' : 'normal'};">${rankEmoji} ${entry.rank}</td>
                <td style="padding: 10px 12px;">${escapeHtml(entry.username)}</td>
                <td style="padding: 10px 12px; text-align: right; font-family: monospace;">${entry.pixelCount.toLocaleString()}</td>
                <td style="padding: 10px 12px; text-align: right; color: ${t.textSecondary};">${percent}%</td>
            `;

            tbody.appendChild(row);
        }

        table.appendChild(tbody);
        container.appendChild(table);

        return container;
    }

    function getRankEmoji(rank) {
        switch (rank) {
            case 1: return '🥇';
            case 2: return '🥈';
            case 3: return '🥉';
            default: return '';
        }
    }

    function getRankBackground(rank) {
        switch (rank) {
            case 1: return 'rgba(255, 215, 0, 0.15)';
            case 2: return 'rgba(192, 192, 192, 0.15)';
            case 3: return 'rgba(205, 127, 50, 0.15)';
            default: return 'transparent';
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== NOTIFICATIONS ====================
    function showNotification(message) {
        // Use GeoPixels' notification system if available
        if (typeof showAnnouncement === 'function') {
            showAnnouncement(message);
            return;
        }

        // Fallback notification
        const t = getThemeColors();
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${t.notificationBg};
            color: ${t.notificationText};
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 10001;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.transition = 'opacity 0.3s';
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // ==================== PROCESS WITH BOUNDS (for flyout) =========
    async function processWithBounds(bounds) {
        const width = bounds.maxX - bounds.minX + 1;
        const height = bounds.maxY - bounds.minY + 1;
        if (width < 2 || height < 2) { showNotification('Selection too small. Please select a larger area.'); return; }
        const modal = createLeaderboardModal(bounds, null, true);
        const progressEl = modal.querySelector('.rhs-progress-text');
        const updateProgress = (text) => { if (progressEl) progressEl.textContent = text; };
        try {
            const userCounts = await computeRegionPixels(bounds, updateProgress);
            updateProgress('Fetching usernames...');
            const leaderboard = await buildLeaderboard(userCounts);
            updateLeaderboardModal(modal, bounds, leaderboard);
        } catch (error) {
            console.error('[Regions Highscore] Error computing leaderboard:', error);
            showNotification('Error computing leaderboard: ' + error.message);
            try { modal.close(); } catch {}
        }
    }

    // ==================== START ====================
    init();

    // Expose API for flyout
    _regionsHighscore = { processWithBounds, toggleSelectionMode };
            })();
            _featureStatus.regionsHighscore = 'ok';
            console.log('[GeoPixelcons++] \u2705 Regions Highscore loaded');
        } catch (err) {
            _featureStatus.regionsHighscore = 'error';
            dbgPush(`Regions Highscore init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Regions Highscore' });
            console.error('[GeoPixelcons++] ❌ Regions Highscore failed:', err);
        }
    }