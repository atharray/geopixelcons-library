
    // ============================================================
    //  MAP MARKERS
    // ============================================================
    if (_settings.mapMarkers) {
        try {
            (() => {
                const MM_META_KEY = 'gpc_mapMarkers_v1';
                const MM_OLD_IMG_KEY = (id) => 'gpc_mmImg_' + id; // legacy GM key (migration only)
                const HANDLE_R    = 6; // fixed px radius — consistent at all zoom levels

                let markers  = [];
                const imgCache    = new Map(); // id → HTMLImageElement (for image-type markers)
                const dataUrlCache = new Map(); // id → dataUrl (GIF markers only)
                // ── Canvas (image markers) ───────────────────────────────
                const mmCanvas = document.createElement('canvas');
                mmCanvas.id = 'gpc-markers-canvas';
                mmCanvas.className = 'inset-0 absolute pointer-events-none';
                document.body.appendChild(mmCanvas);

                // ── DOM overlay (GIF markers) ────────────────────────────
                const overlayEls = new Map(); // id → HTMLImageElement
                const mmOverlay = document.createElement('div');
                mmOverlay.id = 'gpc-markers-overlay';
                Object.assign(mmOverlay.style, {
                    position: 'absolute', inset: '0', pointerEvents: 'none',
                    overflow: 'hidden', zIndex: '2',
                });
                // Append after map container is available; done in waitForMapMM callback below

                let mmModal    = null;
                let placingId  = null; // id of marker currently being placed
                let editingId  = null; // id of marker currently being edited
                let _drag      = null; // active drag state
                let mmCompact  = true; // compact card view toggle
                const expandedCards = new Set(); // marker ids expanded in compact view
                let listDragSrc = null; // drag-to-sort source index

                // ── IndexedDB storage for image/media data ────────────────
                // Replaces GM_setValue for image blobs to stay below the 64 MiB
                // Chrome extension message-passing limit.
                const MM_IDB_NAME  = 'gpc_mapMarkers_imgs';
                const MM_IDB_STORE = 'images';
                let _mmDb = null;

                function openMmDb() {
                    if (_mmDb) return Promise.resolve(_mmDb);
                    return new Promise((resolve, reject) => {
                        const req = indexedDB.open(MM_IDB_NAME, 1);
                        req.onupgradeneeded = (e) => {
                            e.target.result.createObjectStore(MM_IDB_STORE);
                        };
                        req.onsuccess = (e) => { _mmDb = e.target.result; resolve(_mmDb); };
                        req.onerror   = (e) => reject(e.target.error);
                    });
                }
                async function mmDbGet(id) {
                    const db = await openMmDb();
                    return new Promise((resolve) => {
                        const req = db.transaction(MM_IDB_STORE, 'readonly').objectStore(MM_IDB_STORE).get(id);
                        req.onsuccess = () => resolve(req.result || null);
                        req.onerror   = () => resolve(null);
                    });
                }
                async function mmDbSet(id, dataUrl) {
                    const db = await openMmDb();
                    return new Promise((resolve, reject) => {
                        const req = db.transaction(MM_IDB_STORE, 'readwrite').objectStore(MM_IDB_STORE).put(dataUrl, id);
                        req.onsuccess = () => resolve();
                        req.onerror   = (e) => reject(e.target.error);
                    });
                }
                async function mmDbDelete(id) {
                    const db = await openMmDb();
                    return new Promise((resolve) => {
                        const tx = db.transaction(MM_IDB_STORE, 'readwrite');
                        tx.objectStore(MM_IDB_STORE).delete(id);
                        tx.oncomplete = () => resolve();
                        tx.onerror    = () => resolve();
                    });
                }

                // ── Metadata (small JSON — stays in GM_setValue) ──────────
                function loadMeta() {
                    try { markers = JSON.parse(GM_getValue(MM_META_KEY, '[]')); }
                    catch { markers = []; }
                }
                function saveMeta() { GM_setValue(MM_META_KEY, JSON.stringify(markers)); }

                function loadImg(id, dataUrl) {
                    return new Promise(resolve => {
                        const img = new Image();
                        img.onload  = () => { imgCache.set(id, img); resolve(img); };
                        img.onerror = () => resolve(null);
                        img.src = dataUrl;
                    });
                }

                // ── Migration: move old GM_setValue image data → IndexedDB ─
                async function migrateOldGmKeys() {
                    let migrated = 0;
                    for (const m of markers) {
                        const oldVal = GM_getValue(MM_OLD_IMG_KEY(m.id), null);
                        if (oldVal) {
                            try {
                                await mmDbSet(m.id, oldVal);
                                try { GM_deleteValue(MM_OLD_IMG_KEY(m.id)); } catch { GM_setValue(MM_OLD_IMG_KEY(m.id), ''); }
                                migrated++;
                            } catch (err) {
                                console.warn('[GeoPixelcons++] Map Markers: migration failed for', m.id, err);
                            }
                        }
                    }
                    if (migrated > 0) console.log(`[GeoPixelcons++] Map Markers: migrated ${migrated} image(s) from GM_setValue to IndexedDB`);
                }

                async function preloadAll() {
                    await migrateOldGmKeys();
                    for (const m of markers) {
                        if (isGifType(m)) {
                            if (!dataUrlCache.has(m.id)) {
                                const d = await mmDbGet(m.id);
                                if (d) dataUrlCache.set(m.id, d);
                            }
                            // Also load into imgCache so naturalWidth/naturalHeight
                            // are available for aspect-ratio calculations
                            if (!imgCache.has(m.id)) {
                                const d = dataUrlCache.get(m.id) || await mmDbGet(m.id);
                                if (d) await loadImg(m.id, d);
                            }
                        } else if (!imgCache.has(m.id)) {
                            const d = await mmDbGet(m.id);
                            if (d) await loadImg(m.id, d);
                        }
                    }
                }

                // ── Media type helpers ────────────────────────────────────
                function isImageType(m) { return !m.mediaType || m.mediaType === 'image'; }
                function isGifType(m)   { return m.mediaType === 'gif'; }

                // ── Grid helpers ──────────────────────────────────────────
                function getGSize() {
                    const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                    return w.gridSize || (typeof gridSize !== 'undefined' ? gridSize : 25);
                }

                // SW-corner grid rect → screen rect { x, y, w, h }
                // Follows the same half-cell offset convention as geo++ censors.
                function markerScreenRect(m) {
                    const g = getGSize();
                    const nwMerc = [(m.gridX - 0.5) * g, (m.gridY - 0.5 + m.gridH) * g];
                    const seMerc = [(m.gridX - 0.5 + m.gridW) * g, (m.gridY - 0.5) * g];
                    const nw = map.project(turf.toWgs84(nwMerc));
                    const se = map.project(turf.toWgs84(seMerc));
                    return { x: nw.x, y: nw.y, w: se.x - nw.x, h: se.y - nw.y };
                }

                // CSS-pixel variant used exclusively for DOM overlay positioning.
                // map.project() returns CSS pixels relative to the map container — use directly.
                function markerCssRect(m) {
                    const g = getGSize();
                    const nwMerc = [(m.gridX - 0.5) * g, (m.gridY - 0.5 + m.gridH) * g];
                    const seMerc = [(m.gridX - 0.5 + m.gridW) * g, (m.gridY - 0.5) * g];
                    const nw = map.project(turf.toWgs84(nwMerc));
                    const se = map.project(turf.toWgs84(seMerc));
                    return { x: nw.x, y: nw.y, w: se.x - nw.x, h: se.y - nw.y };
                }

                function handlePositions(r) {
                    return {
                        nw: { x: r.x,          y: r.y          },
                        n:  { x: r.x + r.w / 2, y: r.y          },
                        ne: { x: r.x + r.w,     y: r.y          },
                        e:  { x: r.x + r.w,     y: r.y + r.h / 2 },
                        se: { x: r.x + r.w,     y: r.y + r.h   },
                        s:  { x: r.x + r.w / 2, y: r.y + r.h   },
                        sw: { x: r.x,           y: r.y + r.h   },
                        w:  { x: r.x,           y: r.y + r.h / 2 },
                    };
                }

                function screenToGrid(cx, cy) {
                    const g  = getGSize();
                    const br = mmCanvas.getBoundingClientRect();
                    const ll = map.unproject([cx - br.left, cy - br.top]);
                    const mc = turf.toMercator([ll.lng, ll.lat]);
                    return { gridX: Math.round(mc[0] / g), gridY: Math.round(mc[1] / g) };
                }

                // ── DOM overlay helpers (GIF markers) ─────────────────────
                function updateOverlayEl(m) {
                    if (!isGifType(m)) return;
                    let el = overlayEls.get(m.id);
                    if (!m.visible || m.gridX == null) {
                        if (el) el.style.display = 'none';
                        return;
                    }
                    if (!el) {
                        el = document.createElement('img');
                        Object.assign(el.style, { position: 'absolute', display: 'block', objectFit: 'fill',
                            maxWidth: 'none', maxHeight: 'none', imageRendering: 'pixelated' });
                        overlayEls.set(m.id, el);
                        mmOverlay.appendChild(el);
                    }
                    // Always sync src in case dataUrlCache was populated after element creation
                    const src = dataUrlCache.get(m.id) || '';
                    if (el.src !== src) el.src = src;
                    if (!src) { el.style.display = 'none'; return; }
                    const r = markerCssRect(m);
                    el.style.display = (r.w > 0 && r.h > 0) ? 'block' : 'none';
                    el.style.left    = r.x + 'px';
                    el.style.top     = r.y + 'px';
                    el.style.width   = r.w + 'px';
                    el.style.height  = r.h + 'px';
                    el.style.opacity = m.opacity ?? 1;
                }

                function updateAllOverlayEls() {
                    for (const m of markers) updateOverlayEl(m);
                }

                function removeOverlayEl(id) {
                    const el = overlayEls.get(id);
                    if (el) { el.remove(); overlayEls.delete(id); }
                    dataUrlCache.delete(id);
                }

                // ── Drawing ───────────────────────────────────────────────
                function redraw() {
                    const pix = document.getElementById('pixel-canvas');
                    if (!pix) return;
                    if (typeof map === 'undefined' || !map || typeof map.project !== 'function') return;
                    mmCanvas.width  = pix.width;
                    mmCanvas.height = pix.height;
                    const ctx = mmCanvas.getContext('2d');
                    ctx.imageSmoothingEnabled = false;
                    ctx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);

                    for (const m of markers) {
                        if (!m.visible || m.gridX == null) continue;
                        if (!isImageType(m)) continue; // gif/video use DOM overlay
                        const img = imgCache.get(m.id);
                        if (!img || !img.complete) continue;
                        const r = markerScreenRect(m);
                        if (r.w <= 0 || r.h <= 0) continue;
                        if (r.x + r.w < 0 || r.x > mmCanvas.width ||
                            r.y + r.h < 0 || r.y > mmCanvas.height) continue;
                        ctx.globalAlpha = m.opacity ?? 1;
                        ctx.drawImage(img, r.x, r.y, r.w, r.h);
                        ctx.globalAlpha = 1;
                        if (editingId === m.id) drawHandles(ctx, r);
                    }

                    // Edit handles for non-image markers (still use canvas overlay)
                    if (editingId) {
                        const em = markers.find(x => x.id === editingId);
                        if (em && em.gridX != null && !isImageType(em)) drawHandles(ctx, markerScreenRect(em));
                    }

                    // Placement preview
                    if (placingId && _drag && _drag.preview) {
                        const p   = _drag.preview;
                        const pm  = markers.find(m => m.id === placingId);
                        const pi  = pm && isImageType(pm) && imgCache.get(pm.id);
                        if (pi) { ctx.globalAlpha = 0.55; ctx.drawImage(pi, p.x, p.y, p.w, p.h); ctx.globalAlpha = 1; }
                        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2;
                        ctx.setLineDash([6, 3]); ctx.strokeRect(p.x, p.y, p.w, p.h); ctx.setLineDash([]);
                    }

                    updateAllOverlayEls();
                }

                function drawHandles(ctx, r) {
                    ctx.save();
                    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 3]); ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]);
                    const hp = handlePositions(r);
                    for (const pos of Object.values(hp)) {
                        ctx.fillStyle   = '#fff';
                        ctx.strokeStyle = '#3b82f6';
                        ctx.lineWidth   = 2;
                        ctx.beginPath();
                        ctx.arc(pos.x, pos.y, HANDLE_R, 0, Math.PI * 2);
                        ctx.fill(); ctx.stroke();
                    }
                    ctx.restore();
                }

                // ── Map wiring ────────────────────────────────────────────
                function waitForMapMM(cb) {
                    let t = 0;
                    function chk() {
                        if (typeof map !== 'undefined' && map && map.on) cb();
                        else if (t++ < 200) setTimeout(chk, 100);
                    }
                    chk();
                }
                waitForMapMM(() => {
                    map.getContainer().appendChild(mmOverlay);
                    ['move', 'rotate', 'zoom'].forEach(ev => map.on(ev, redraw));
                    new ResizeObserver(redraw).observe(map.getContainer());
                    map.once('load', redraw);
                    redraw();
                });

                // ── Mode helpers ──────────────────────────────────────────
                function enterPlace(id) {
                    exitEdit();
                    placingId = id;
                    mmCanvas.style.pointerEvents = 'auto';
                    mmCanvas.style.cursor = 'crosshair';
                    mmNotify('Drag to define image size. Hold Shift to lock aspect ratio.');
                }
                function exitPlace() {
                    placingId = null; _drag = null;
                    mmCanvas.style.pointerEvents = 'none'; mmCanvas.style.cursor = '';
                    redraw();
                }
                function enterEdit(id) {
                    exitPlace();
                    editingId = id;
                    mmCanvas.style.pointerEvents = 'auto'; mmCanvas.style.cursor = 'default';
                    redraw();
                }
                function exitEdit() {
                    editingId = null; _drag = null;
                    mmCanvas.style.pointerEvents = 'none'; mmCanvas.style.cursor = '';
                    redraw();
                    refreshModal(); // sync card buttons ("Done" → "Edit")
                }

                // ── Canvas events ─────────────────────────────────────────
                mmCanvas.addEventListener('wheel', e =>
                    map.getCanvas().dispatchEvent(new WheelEvent(e.type, e)));

                mmCanvas.addEventListener('mousedown', e => {
                    if (e.button !== 0) return;
                    e.preventDefault(); e.stopPropagation();

                    if (placingId) {
                        _drag = { type: 'place', startGrid: screenToGrid(e.clientX, e.clientY), preview: null };
                        return;
                    }
                    if (editingId) {
                        const m = markers.find(x => x.id === editingId);
                        if (!m || m.gridX == null) return;
                        const br  = mmCanvas.getBoundingClientRect();
                        const sx  = e.clientX - br.left, sy = e.clientY - br.top;
                        const hp  = handlePositions(markerScreenRect(m));
                        let hit   = null;
                        for (const [name, pos] of Object.entries(hp)) {
                            const dx = sx - pos.x, dy = sy - pos.y;
                            if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_R + 3) { hit = name; break; }
                        }
                        if (hit) {
                            _drag = { type: 'handle', handle: hit, markerId: editingId,
                                      startGrid: screenToGrid(e.clientX, e.clientY), orig: { ...m } };
                        } else {
                            // Inside the image body → move drag; outside → exit edit
                            const r = markerScreenRect(m);
                            if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) {
                                mmCanvas.style.cursor = 'grabbing';
                                _drag = { type: 'move', markerId: editingId,
                                          startGrid: screenToGrid(e.clientX, e.clientY),
                                          origPos: { gridX: m.gridX, gridY: m.gridY } };
                            } else {
                                exitEdit();
                            }
                        }
                    }
                });

                document.addEventListener('mousemove', e => {
                    // Cursor feedback in edit mode when no drag is active
                    if (!_drag && editingId) {
                        const br = mmCanvas.getBoundingClientRect();
                        const sx = e.clientX - br.left, sy = e.clientY - br.top;
                        if (sx >= 0 && sy >= 0 && sx <= mmCanvas.width && sy <= mmCanvas.height) {
                            const m = markers.find(x => x.id === editingId);
                            if (m && m.gridX != null) {
                                const hp = handlePositions(markerScreenRect(m));
                                let onHandle = false;
                                for (const pos of Object.values(hp)) {
                                    if (Math.hypot(sx - pos.x, sy - pos.y) <= HANDLE_R + 3) { onHandle = true; break; }
                                }
                                if (onHandle) {
                                    mmCanvas.style.cursor = 'nwse-resize';
                                } else {
                                    const r = markerScreenRect(m);
                                    mmCanvas.style.cursor = (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) ? 'grab' : 'default';
                                }
                            }
                        }
                    }

                    if (!_drag) return;

                    if (_drag.type === 'place' && placingId) {
                        const cur = screenToGrid(e.clientX, e.clientY);
                        const sg  = _drag.startGrid;
                        const m   = markers.find(x => x.id === placingId);
                        const img = m && imgCache.get(m.id);
                        let gW = Math.abs(cur.gridX - sg.gridX) + 1;
                        let gH = Math.abs(cur.gridY - sg.gridY) + 1;
                        if ((e.shiftKey || (m && m.lockAspect)) && img) {
                            const ar = img.naturalWidth / img.naturalHeight;
                            if (gW / gH > ar) gH = Math.max(1, Math.round(gW / ar));
                            else              gW = Math.max(1, Math.round(gH * ar));
                        }
                        const swX = Math.min(sg.gridX, cur.gridX);
                        const swY = Math.min(sg.gridY, cur.gridY);
                        const g   = getGSize();
                        const nwS = map.project(turf.toWgs84([(swX - 0.5) * g, (swY - 0.5 + gH) * g]));
                        const seS = map.project(turf.toWgs84([(swX - 0.5 + gW) * g, (swY - 0.5) * g]));
                        _drag.preview = { x: nwS.x, y: nwS.y, w: seS.x - nwS.x, h: seS.y - nwS.y };
                        _drag.pending = { gridX: swX, gridY: swY, gridW: gW, gridH: gH };
                        redraw();

                    } else if (_drag.type === 'handle') {
                        const m = markers.find(x => x.id === _drag.markerId);
                        if (!m) return;
                        applyHandleDrag(m, _drag.handle, screenToGrid(e.clientX, e.clientY),
                                        e.shiftKey, _drag.orig, imgCache.get(m.id));
                        redraw();
                    } else if (_drag.type === 'move') {
                        const m = markers.find(x => x.id === _drag.markerId);
                        if (!m) return;
                        const cur = screenToGrid(e.clientX, e.clientY);
                        m.gridX = _drag.origPos.gridX + (cur.gridX - _drag.startGrid.gridX);
                        m.gridY = _drag.origPos.gridY + (cur.gridY - _drag.startGrid.gridY);
                        redraw();
                    }
                });

                document.addEventListener('mouseup', e => {
                    if (!_drag) return;
                    if (_drag.type === 'place' && placingId) {
                        if (!_drag.pending) {
                            mmNotify('Please drag to define the image size.', true);
                            _drag = null; redraw();
                        } else {
                            const m = markers.find(x => x.id === placingId);
                            if (m) { Object.assign(m, _drag.pending); saveMeta(); }
                            const placedId = placingId;
                            exitPlace();
                            enterEdit(placedId); // auto-enter edit after placing
                            refreshModal();
                            mmNotify('Placed! Drag to move, handles to resize.');
                        }
                    } else if (_drag && _drag.type === 'handle') {
                        saveMeta(); refreshModal(); _drag = null;
                    } else if (_drag && _drag.type === 'move') {
                        mmCanvas.style.cursor = 'grab';
                        saveMeta(); refreshModal(); _drag = null;
                    }
                });

                // ── Handle drag math ──────────────────────────────────────
                // Absolute-cursor approach: the dragged edge/corner snaps to cursor grid position.
                // The opposite anchor (corner or edge) stays fixed from orig.
                // In grid coords: gridX=west, gridX+gridW=east, gridY=south, gridY+gridH=north.
                // Screen: NW=top-left, SE=bottom-right (Y increases southward on screen).
                function applyHandleDrag(m, handle, cur, shiftKey, orig, img) {
                    const ar   = img ? img.naturalWidth / img.naturalHeight : null;
                    const lock = shiftKey || m.lockAspect;
                    const E    = orig.gridX + orig.gridW; // fixed east edge
                    const N    = orig.gridY + orig.gridH; // fixed north edge
                    let nx = orig.gridX, ny = orig.gridY, nw = orig.gridW, nh = orig.gridH;

                    switch (handle) {
                        // Corners: both axes change; opposite corner fixed
                        case 'nw': // screen top-left → grid (west, north)
                            nx = cur.gridX; nw = E - cur.gridX; nh = cur.gridY - orig.gridY;
                            if (lock && ar) { if (nw / nh > ar) { nh = nw / ar; } else { nw = nh * ar; nx = E - nw; } }
                            break;
                        case 'ne': // screen top-right → grid (east, north)
                            nw = cur.gridX - orig.gridX; nh = cur.gridY - orig.gridY;
                            if (lock && ar) { if (nw / nh > ar) nh = nw / ar; else nw = nh * ar; }
                            break;
                        case 'sw': // screen bottom-left → grid (west, south)
                            nx = cur.gridX; nw = E - cur.gridX; ny = cur.gridY; nh = N - cur.gridY;
                            if (lock && ar) { if (nw / nh > ar) { nh = nw / ar; ny = N - nh; } else { nw = nh * ar; nx = E - nw; } }
                            break;
                        case 'se': // screen bottom-right → grid (east, south)
                            nw = cur.gridX - orig.gridX; ny = cur.gridY; nh = N - cur.gridY;
                            if (lock && ar) { if (nw / nh > ar) { nh = nw / ar; ny = N - nh; } else nw = nh * ar; }
                            break;
                        // Edges: single axis only, no aspect ratio applied
                        case 'n': nh = cur.gridY - orig.gridY; break;
                        case 's': ny = cur.gridY; nh = N - cur.gridY; break;
                        case 'e': nw = cur.gridX - orig.gridX; break;
                        case 'w': nx = cur.gridX; nw = E - cur.gridX; break;
                    }
                    if (nw < 1) nw = 1; if (nh < 1) nh = 1;
                    m.gridX = Math.round(nx); m.gridY = Math.round(ny);
                    m.gridW = Math.round(nw); m.gridH = Math.round(nh);
                }

                // ── Modal ─────────────────────────────────────────────────
                function openModal() {
                    if (mmModal) {
                        mmModal.style.display = mmModal.style.display === 'none' ? 'flex' : 'none';
                        return;
                    }
                    mmModal = document.createElement('div');
                    Object.assign(mmModal.style, {
                        position: 'fixed', top: '60px', left: '60px', zIndex: '10000',
                        background: 'var(--color-white,#fff)', borderRadius: '12px',
                        boxShadow: '0 8px 32px rgba(0,0,0,.2)',
                        display: 'flex', flexDirection: 'column', width: '330px', maxHeight: '82vh',
                        userSelect: 'none', overflow: 'hidden',
                    });

                    // Header / drag handle
                    const hdr = document.createElement('div');
                    Object.assign(hdr.style, {
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '11px 14px', background: 'var(--color-gray-50,#f9fafb)',
                        borderBottom: '1px solid var(--color-gray-200,#e5e7eb)',
                        borderRadius: '12px 12px 0 0', cursor: 'grab', flexShrink: '0',
                    });
                    hdr.innerHTML = '<span style="font-weight:700;font-size:13px;color:var(--color-gray-800,#1f2937);">\ud83d\udccc Map Markers</span>';
                    // Compact toggle
                    const compactBtn = document.createElement('button');
                    compactBtn.title = 'Toggle compact view';
                    compactBtn.textContent = mmCompact ? '\u25a1' : '\u2630';
                    Object.assign(compactBtn.style, { background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: '13px', color: 'var(--color-gray-500,#6b7280)', padding: '1px 5px', borderRadius: '4px',
                        marginLeft: 'auto', marginRight: '4px' });
                    compactBtn.onclick = () => {
                        mmCompact = !mmCompact;
                        compactBtn.textContent = mmCompact ? '\u25a1' : '\u2630';
                        refreshModal();
                    };
                    hdr.appendChild(compactBtn);
                    const xBtn = document.createElement('button');
                    xBtn.textContent = '\u2715';
                    Object.assign(xBtn.style, { background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: '13px', color: 'var(--color-gray-500,#6b7280)', padding: '1px 5px', borderRadius: '4px' });
                    xBtn.onclick = () => { mmModal.style.display = 'none'; exitPlace(); exitEdit(); };
                    hdr.appendChild(xBtn);
                    mmModal.appendChild(hdr);

                    // Draggable header
                    let dragOff = null;
                    hdr.addEventListener('mousedown', e => {
                        if (e.target === xBtn || e.target === compactBtn) return;
                        dragOff = { x: e.clientX - mmModal.offsetLeft, y: e.clientY - mmModal.offsetTop };
                        hdr.style.cursor = 'grabbing';
                    });
                    document.addEventListener('mousemove', e => {
                        if (!dragOff) return;
                        mmModal.style.left = (e.clientX - dragOff.x) + 'px';
                        mmModal.style.top  = (e.clientY - dragOff.y) + 'px';
                    });
                    document.addEventListener('mouseup', () => { dragOff = null; hdr.style.cursor = 'grab'; });

                    // ── Shared helpers: register a new marker and enter place mode
                    async function addMarkerFromDataUrl(dataUrl, name, mediaType) {
                        const mt  = mediaType || 'image';
                        const id  = 'mm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                        let ar = 1;
                        if (mt === 'gif') {
                            // Use a temporary img to read first-frame dimensions
                            const img = await loadImg(id, dataUrl);
                            ar = img ? img.naturalWidth / img.naturalHeight : 1;
                            dataUrlCache.set(id, dataUrl);
                        } else {
                            const img = await loadImg(id, dataUrl);
                            ar = img ? img.naturalWidth / img.naturalHeight : 1;
                        }
                        const dW = 50;
                        markers.push({ id, name, mediaType: mt,
                            gridX: null, gridY: null, gridW: dW,
                            gridH: Math.max(1, Math.round(dW / ar)),
                            visible: true, opacity: 1, lockAspect: true });
                        await mmDbSet(id, dataUrl);
                        saveMeta();
                        enterPlace(id);
                        refreshModal();
                    }

                    // Add media row — file upload + image URL + video URL
                    const addRow = document.createElement('div');
                    Object.assign(addRow.style, { padding: '9px 14px', display: 'flex', gap: '6px', flexWrap: 'wrap',
                        borderBottom: '1px solid var(--color-gray-100,#f3f4f6)', flexShrink: '0' });
                    function mkAddBtn(label, bg) {
                        const b = document.createElement('button');
                        b.textContent = label;
                        Object.assign(b.style, { flex: '1 1 40%', padding: '7px', background: bg,
                            color: '#fff', border: 'none', borderRadius: '7px', cursor: 'pointer',
                            fontWeight: '700', fontSize: '12px' });
                        return b;
                    }
                    const addBtn = mkAddBtn('+ Image / GIF', '#3b82f6');
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
                    fileInput.style.display = 'none';
                    fileInput.addEventListener('change', async () => {
                        const file = fileInput.files[0];
                        if (!file) return;
                        const dataUrl = await new Promise(res => {
                            const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(file);
                        });
                        const isGif = file.type === 'image/gif';
                        await addMarkerFromDataUrl(dataUrl, file.name.replace(/\.[^/.]+$/, ''), isGif ? 'gif' : 'image');
                        fileInput.value = '';
                    });
                    addBtn.onclick = () => fileInput.click();

                    const urlBtn = mkAddBtn('\ud83d\udd17 Image URL', '#8b5cf6');
                    urlBtn.onclick = () => {
                        const url = prompt('Enter image URL:');
                        if (!url || !url.trim()) return;
                        mmNotify('Loading\u2026');
                        GM_xmlhttpRequest({
                            method: 'GET', url: url.trim(), responseType: 'blob',
                            onload: (resp) => {
                                const mime = resp.response.type;
                                if (!mime.startsWith('image/')) {
                                    mmNotify('URL does not point to an image.', true);
                                    return;
                                }
                                const isGif = mime === 'image/gif';
                                const reader = new FileReader();
                                reader.onload = async (ev) => {
                                    const name = url.split('/').pop().replace(/\?.*$/, '').replace(/\.[^/.]+$/, '') || 'image';
                                    await addMarkerFromDataUrl(ev.target.result, name, isGif ? 'gif' : 'image');
                                };
                                reader.readAsDataURL(resp.response);
                            },
                            onerror:   () => mmNotify('Failed to load image from URL.', true),
                            ontimeout: () => mmNotify('Request timed out.', true),
                        });
                    };

                    addRow.appendChild(addBtn); addRow.appendChild(fileInput);
                    addRow.appendChild(urlBtn);
                    mmModal.appendChild(addRow);

                    // Scrollable list
                    const list = document.createElement('div');
                    list.id = 'gpc-mm-list';
                    Object.assign(list.style, { flex: '1', overflowY: 'auto', padding: '6px 0' });
                    mmModal.appendChild(list);

                    document.body.appendChild(mmModal);
                    renderList(list);
                }

                function refreshModal() {
                    const l = document.getElementById('gpc-mm-list');
                    if (l) renderList(l);
                    redraw();
                }

                function renderList(list) {
                    list.innerHTML = '';
                    if (!markers.length) {
                        list.innerHTML = '<div style="text-align:center;color:var(--color-gray-400,#9ca3af);padding:22px 14px;font-size:12px;">No markers yet.<br>Upload media above.</div>';
                        return;
                    }
                    let dragOverIdx = null;
                    for (let i = 0; i < markers.length; i++) {
                        const m = markers[i];
                        const wrapper = document.createElement('div');
                        wrapper.setAttribute('data-mm-idx', String(i));
                        wrapper.style.cssText = 'position:relative;';
                        wrapper.appendChild(makeCard(m));

                        // ── Drag-to-sort ───────────────────────────────
                        wrapper.addEventListener('dragstart', e => {
                            listDragSrc = i;
                            e.dataTransfer.effectAllowed = 'move';
                            wrapper.style.opacity = '0.45';
                        });
                        wrapper.addEventListener('dragend', () => {
                            wrapper.style.opacity = '';
                            list.querySelectorAll('[data-mm-drop-indicator]').forEach(el => el.remove());
                        });
                        wrapper.addEventListener('dragover', e => {
                            if (listDragSrc == null || listDragSrc === i) return;
                            e.preventDefault(); e.dataTransfer.dropEffect = 'move';
                            list.querySelectorAll('[data-mm-drop-indicator]').forEach(el => el.remove());
                            const ind = document.createElement('div');
                            ind.setAttribute('data-mm-drop-indicator', '1');
                            ind.style.cssText = 'height:2px;background:#3b82f6;margin:0 10px;border-radius:2px;';
                            const rect = wrapper.getBoundingClientRect();
                            const insertBefore = e.clientY < rect.top + rect.height / 2;
                            if (insertBefore) wrapper.insertAdjacentElement('beforebegin', ind);
                            else             wrapper.insertAdjacentElement('afterend', ind);
                            dragOverIdx = insertBefore ? i : i + 1;
                        });
                        wrapper.addEventListener('dragleave', () => {
                            // Remove indicator only if mouse truly left the list area
                        });
                        wrapper.addEventListener('drop', e => {
                            e.preventDefault();
                            list.querySelectorAll('[data-mm-drop-indicator]').forEach(el => el.remove());
                            if (listDragSrc == null || listDragSrc === dragOverIdx) { listDragSrc = null; return; }
                            const moved = markers.splice(listDragSrc, 1)[0];
                            const dest  = dragOverIdx > listDragSrc ? dragOverIdx - 1 : dragOverIdx;
                            markers.splice(dest, 0, moved);
                            listDragSrc = null; dragOverIdx = null;
                            saveMeta(); refreshModal();
                        });

                        list.appendChild(wrapper);
                    }
                }

                function makeThumb(m, size) {
                    const s = size || 34;
                    const checkers = 'repeating-conic-gradient(#ccc 0% 25%,transparent 0% 50%) 0 0/8px 8px';
                    const sharedStyle = { width: s + 'px', height: s + 'px', borderRadius: '4px',
                        flexShrink: '0', border: '1px solid var(--color-gray-200,#e5e7eb)', background: checkers };
                    if (isGifType(m)) {
                        const el = document.createElement('img');
                        el.src = dataUrlCache.get(m.id) || '';
                        Object.assign(el.style, { ...sharedStyle, objectFit: 'cover', display: 'block' });
                        return el;
                    }
                    // image type: canvas
                    const cvs = document.createElement('canvas');
                    cvs.width = s; cvs.height = s;
                    Object.assign(cvs.style, sharedStyle);
                    const img = imgCache.get(m.id);
                    if (img) {
                        const tc = cvs.getContext('2d');
                        tc.globalAlpha = m.opacity ?? 1;
                        tc.drawImage(img, 0, 0, s, s);
                        tc.globalAlpha = 1;
                    }
                    return cvs;
                }

                function mediaTypeLabel(m) {
                    return isGifType(m) ? '\ud83c\udf9e' : '\ud83d\uddbc';
                }

                function makeCard(m) {
                    const isP = placingId === m.id, isE = editingId === m.id;
                    const isExpanded = !mmCompact || expandedCards.has(m.id);
                    const cardBg     = isE ? 'var(--color-blue-50,#eff6ff)'
                                     : isP ? 'var(--color-green-50,#f0fdf4)'
                                     :       'var(--color-gray-50,#f9fafb)';
                    const cardBorder = isE ? 'var(--color-blue-200,#bfdbfe)'
                                     : isP ? 'var(--color-green-200,#bbf7d0)'
                                     :       'var(--color-gray-200,#e5e7eb)';

                    const card = document.createElement('div');
                    // draggable is NOT set on the card — only the grab handle initiates a drag
                    Object.assign(card.style, {
                        margin: '4px 10px', padding: mmCompact ? '6px 9px' : '9px', borderRadius: '8px',
                        display: 'flex', flexDirection: 'column', gap: '5px',
                        background: cardBg, border: '1px solid ' + cardBorder, cursor: 'default',
                    });

                    // ── Compact top row (always shown) ────────────────────
                    const topRow = document.createElement('div');
                    Object.assign(topRow.style, { display: 'flex', alignItems: 'center', gap: '7px' });

                    // Drag handle — only this element is draggable
                    const dragHdl = document.createElement('span');
                    dragHdl.textContent = '\u2807';
                    dragHdl.title = 'Drag to reorder';
                    dragHdl.draggable = true;
                    dragHdl.style.cssText = 'color:var(--color-gray-400,#9ca3af);cursor:grab;font-size:14px;flex-shrink:0;user-select:none;';
                    topRow.appendChild(dragHdl);

                    topRow.appendChild(makeThumb(m, 34));

                    const infoCol = document.createElement('div');
                    Object.assign(infoCol.style, { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '2px' });

                    const nameLbl = document.createElement('div');
                    nameLbl.textContent = mediaTypeLabel(m) + ' ' + m.name;
                    nameLbl.style.cssText = 'font-size:12px;font-weight:700;color:var(--color-gray-800,#1f2937);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                    infoCol.appendChild(nameLbl);

                    const coordLbl = document.createElement('div');
                    coordLbl.style.cssText = 'font-size:10px;color:' +
                        (m.gridX != null ? 'var(--color-green-600,#16a34a)' : 'var(--color-gray-400,#9ca3af)') + ';';
                    coordLbl.textContent = m.gridX != null
                        ? `(${m.gridX}, ${m.gridY + m.gridH}) \u2014 ${m.gridW}\u00d7${m.gridH}`
                        : 'Not placed';
                    infoCol.appendChild(coordLbl);
                    topRow.appendChild(infoCol);

                    // Eye + expand/collapse in compact mode
                    const eyeBtn2 = document.createElement('button');
                    eyeBtn2.textContent = m.visible ? '\ud83d\udc41' : '\ud83d\udeab';
                    eyeBtn2.title = m.visible ? 'Hide' : 'Show';
                    Object.assign(eyeBtn2.style, { background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: '14px', padding: '1px', flexShrink: '0' });
                    eyeBtn2.onclick = () => { m.visible = !m.visible; saveMeta(); refreshModal(); };
                    topRow.appendChild(eyeBtn2);

                    if (mmCompact) {
                        const chevron = document.createElement('button');
                        chevron.textContent = isExpanded ? '\u25b2' : '\u25bc';
                        chevron.title = isExpanded ? 'Collapse' : 'Expand controls';
                        Object.assign(chevron.style, { background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '10px', color: 'var(--color-gray-500,#6b7280)', padding: '1px', flexShrink: '0' });
                        chevron.onclick = (e) => {
                            e.stopPropagation();
                            if (expandedCards.has(m.id)) expandedCards.delete(m.id);
                            else expandedCards.add(m.id);
                            refreshModal();
                        };
                        topRow.appendChild(chevron);
                        // Click anywhere on compact card (except buttons) also toggles expand
                        card.addEventListener('click', (e) => {
                            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
                            if (expandedCards.has(m.id)) expandedCards.delete(m.id);
                            else expandedCards.add(m.id);
                            refreshModal();
                        });
                    }
                    card.appendChild(topRow);

                    // ── Full controls (hidden in compact unless expanded) ──
                    if (isExpanded) {
                        // Name input row
                        const nameRow = document.createElement('div');
                        Object.assign(nameRow.style, { display: 'flex', alignItems: 'center', gap: '7px' });
                        const nameEl = document.createElement('input');
                        nameEl.type = 'text'; nameEl.value = m.name;
                        Object.assign(nameEl.style, { flex: '1', padding: '3px 6px',
                            border: '1px solid var(--color-gray-300,#d1d5db)', borderRadius: '4px',
                            fontSize: '12px', fontWeight: '600', color: 'var(--color-gray-800,#1f2937)',
                            background: 'var(--color-white,#fff)' });
                        nameEl.onchange = () => { m.name = nameEl.value; saveMeta(); refreshModal(); };
                        nameRow.appendChild(nameEl);
                        card.appendChild(nameRow);

                        // Opacity + aspect lock
                        {
                            const r2 = document.createElement('div');
                            Object.assign(r2.style, { display: 'flex', alignItems: 'center', gap: '6px' });
                            const opLbl = document.createElement('span');
                            opLbl.textContent = 'Opacity';
                            opLbl.style.cssText = 'font-size:11px;color:var(--color-gray-500,#6b7280);flex-shrink:0;';
                            r2.appendChild(opLbl);
                            const opSlider = document.createElement('input');
                            opSlider.type = 'range'; opSlider.min = '0'; opSlider.max = '1';
                            opSlider.step = '0.05'; opSlider.value = m.opacity ?? 1;
                            opSlider.style.cssText = 'flex:1;cursor:pointer;';
                            opSlider.oninput  = () => { m.opacity = parseFloat(opSlider.value); redraw(); };
                            opSlider.onchange = () => saveMeta();
                            r2.appendChild(opSlider);
                            const lockBtn = document.createElement('button');
                            lockBtn.textContent = m.lockAspect ? '\ud83d\udd12' : '\ud83d\udd13';
                            lockBtn.title = m.lockAspect ? 'Aspect locked' : 'Aspect free';
                            Object.assign(lockBtn.style, { background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: '14px', padding: '1px', flexShrink: '0' });
                            lockBtn.onclick = () => { m.lockAspect = !m.lockAspect; saveMeta(); refreshModal(); };
                            r2.appendChild(lockBtn);
                            if (isImageType(m)) {
                                const resetArBtn = document.createElement('button');
                                resetArBtn.textContent = '\u21ba';
                                resetArBtn.title = 'Reset to natural aspect ratio';
                                Object.assign(resetArBtn.style, { background: 'none', border: 'none', cursor: 'pointer',
                                    fontSize: '14px', padding: '1px', flexShrink: '0' });
                                resetArBtn.onclick = () => {
                                    const imgEl = imgCache.get(m.id);
                                    if (!imgEl) return;
                                    m.gridH = Math.max(1, Math.round(m.gridW / (imgEl.naturalWidth / imgEl.naturalHeight)));
                                    saveMeta(); redraw(); refreshModal();
                                };
                                r2.appendChild(resetArBtn);
                            }
                            card.appendChild(r2);
                        }

                        // Action buttons
                        const r3 = document.createElement('div');
                        r3.style.cssText = 'display:flex;gap:5px;';
                        function mkBtn(txt, bg, fn) {
                            const b = document.createElement('button');
                            b.textContent = txt;
                            Object.assign(b.style, { flex: '1', padding: '5px 3px', border: 'none',
                                borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700',
                                background: bg, color: '#fff', transition: 'opacity .12s' });
                            b.onmouseenter = () => b.style.opacity = '0.82';
                            b.onmouseleave = () => b.style.opacity = '1';
                            b.onclick = fn; return b;
                        }
                        r3.appendChild(mkBtn(isP ? '\u23f8 Stop' : '\ud83d\udccd Place', isP ? '#f59e0b' : '#10b981', () => {
                            if (isP) exitPlace(); else enterPlace(m.id); refreshModal();
                        }));
                        if (m.gridX != null) {
                            r3.appendChild(mkBtn(isE ? '\u2713 Done' : '\u270f\ufe0f Edit', isE ? '#6366f1' : '#3b82f6', () => {
                                if (isE) exitEdit(); else enterEdit(m.id); refreshModal();
                            }));
                        }
                        r3.appendChild(mkBtn('\ud83d\uddd1 Remove', '#ef4444', () => {
                            if (!confirm('Remove this marker?')) return;
                            const i = markers.findIndex(x => x.id === m.id);
                            if (i !== -1) markers.splice(i, 1);
                            imgCache.delete(m.id);
                            removeOverlayEl(m.id);
                            expandedCards.delete(m.id);
                            mmDbDelete(m.id).catch(() => {});
                            saveMeta();
                            if (editingId === m.id) exitEdit();
                            if (placingId === m.id) exitPlace();
                            refreshModal();
                        }));
                        card.appendChild(r3);
                    }

                    return card;
                }

                function mmNotify(msg, isErr) {
                    const ex = document.getElementById('gpc-mm-toast'); if (ex) ex.remove();
                    const t = document.createElement('div'); t.id = 'gpc-mm-toast'; t.textContent = msg;
                    Object.assign(t.style, { position: 'fixed', top: '68px', left: '50%',
                        transform: 'translateX(-50%)', padding: '8px 18px', borderRadius: '8px',
                        fontSize: '13px', fontWeight: '700', zIndex: '100002',
                        boxShadow: '0 4px 12px rgba(0,0,0,.2)', transition: 'opacity .3s',
                        fontFamily: 'system-ui,sans-serif',
                        background: isErr ? '#fca5a5' : '#bbf7d0',
                        color:      isErr ? '#7f1d1d' : '#166534' });
                    document.body.appendChild(t);
                    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2600);
                }

                // ── Bootstrap ─────────────────────────────────────────────
                loadMeta();
                preloadAll().then(redraw);

                _mapMarkers = { openModal };
            })();
            _featureStatus.mapMarkers = 'ok';
            console.log('[GeoPixelcons++] \u2705 Map Markers loaded');
        } catch (err) {
            _featureStatus.mapMarkers = 'error';
            dbgPush(`Map Markers init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Map Markers' });
            console.error('[GeoPixelcons++] \u274c Map Markers failed:', err);
        }
    }