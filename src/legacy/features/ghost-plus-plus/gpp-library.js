    // ── Ghost++ template library + Manage Templates modal ────────────
    // Implements the `gppRenderTemplateLibrary(container, onChange)` render
    // hook that gpp-init.js calls into GPP_IDS.rightContent (the shell's
    // collapsible right panel) after every state change. Two pieces:
    //   1. A compact grid of small cached thumbnails (click = focus,
    //      hover = floating larger preview, corner arrow = focus + teleport).
    //   2. A separate "Manage templates" overlay modal (multiselect,
    //      bulk export/delete, multi-file import, visibility + drag reorder).
    // Only this file's `gppRenderTemplateLibrary` name is a contract other
    // files depend on; everything else here is internal (`gppLibrary*` /
    // `GPP_LIB_*`) and safe to change freely.

    const GPP_LIB_STYLE_ID = 'gpp-library-style';
    const GPP_LIB_MANAGE_ID = 'gpp-lib-manage-modal';
    const GPP_LIB_HOVER_ID = 'gpp-lib-hover-preview';
    const GPP_LIB_FULLVIEW_ID = 'gpp-lib-fullview-overlay';
    // Container gpp-init.js's refreshAll() renders gpp-placement.js's
    // Position/Transform section into — lives inside gpp-lib-current now
    // (see gppRenderTemplateLibrary), so its id is shared across files the
    // same way GPP_IDS is; declared here since gpp-library.js is what
    // creates the element.
    const GPP_LIB_CURRENT_PT_ID = 'gpp-lib-current-pt';
    const GPP_LIB_GRID_DETAILS_ID = 'gpp-lib-grid-collapsible';
    const GPP_LIB_THUMB_SIZE = 52;   // px, compact grid CSS layout box (on-screen thumbnail size)
    const GPP_LIB_THUMB_RENDER_SIZE = 256; // px, offscreen canvas resolution the thumb is rasterized at — higher than the on-screen box so it stays crisp (retina, hover-zoom) instead of matching the display size 1:1
    const GPP_LIB_PREVIEW_SIZE = 220; // px, hover preview's max on-screen box — the canvas itself renders at the template's own true resolution (see gppLibraryShowHoverPreview), this only bounds its displayed size

    // Per-template cached thumbnail canvases, keyed by template.id. Entries
    // are invalidated (and their canvases regenerated) only when a
    // template's core payload actually changes — detected cheaply via
    // reference-identity of `indices`/`palette` plus width/height, not by
    // re-hashing pixel data every render. `transformIndexed` in gpp-core.js
    // always returns a *new* indices array, so any flip/rotate naturally
    // busts this cache; ordinary re-renders (colour toggles, drag, etc.)
    // reuse the same canvas nodes untouched.
    const gppLibraryThumbCache = new Map(); // id -> { indicesRef, paletteRef, width, height, small }

    // Singleton floating hover-preview element (position:fixed, follows the
    // cursor). Built lazily on first hover, reused for every card afterward.
    let gppLibraryHoverEl = null;

    // Shared drag-reorder state for the compact .gpp-lib-grid cards — same
    // shape/role as the Manage Templates modal's own per-invocation
    // `dragState` (see gppOpenManageTemplatesModal), just module-level since
    // gppRenderTemplateLibrary has no per-call context object of its own to
    // stash it on.
    let gppGridDragState = { id: null };

    // Manage Templates modal's List vs Grid view choice — module-level so it
    // survives closing/reopening the modal within the same page session (no
    // per-template data involved, so localStorage persistence isn't worth
    // the extra plumbing). Defaults to grid per explicit product decision.
    let gppManageViewMode = 'grid';

    // Rewrites content every call (see gpp-init.js's theme-change observer)
    // instead of no-op-ing once created, so a live dark/light toggle isn't
    // frozen at whatever theme was active on first mount.
    function gppLibraryInjectStyle() {
        let style = document.getElementById(GPP_LIB_STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = GPP_LIB_STYLE_ID;
            document.head.appendChild(style);
        }
        style.textContent = `
            .gpp-lib-toolbar {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
                padding-bottom: 8px; margin-bottom: 8px;
                border-bottom: 1px solid ${t2('#d1d5db', '#45475a')};
            }
            .gpp-lib-count { font-size: 11px; color: ${t2('#64748b', '#a6adc8')}; }
            .gpp-lib-current {
                display: flex; flex-direction: column; align-items: center; gap: 6px;
                padding-bottom: 10px; margin-bottom: 10px;
                border-bottom: 1px solid ${t2('#d1d5db', '#45475a')};
            }
            /* .gpp-lib-current's own border-bottom above already divides it
               from the Templates grid — details.gpp-collapsible's generic
               border-top would otherwise stack a second line right beneath
               it with no gap, since this collapsible is its very next
               sibling. */
            #${GPP_LIB_GRID_DETAILS_ID} { border-top: none; }
            .gpp-lib-current canvas {
                display: block; max-width: 100%; max-height: 220px; width: auto; height: auto;
                image-rendering: pixelated; border-radius: 6px;
                background: ${t2('#f1f5f9', '#292a3a')};
                border: 1px solid ${t2('#d1d5db', '#45475a')};
            }
            .gpp-lib-current-canvas-wrap { position: relative; max-width: 100%; }
            .gpp-lib-current-canvas-wrap canvas { cursor: zoom-in; }
            /* .gpp-lib-current's align-items:center is meant for the
               (narrower-than-full-width) canvas thumbnail above this, not
               for the Position/Transform controls gpp-init.js mounts here —
               those should span the full available width. Without this,
               #gpp-lib-current-pt shrink-wraps to fit-content, and since a
               flex item's default min-width:auto floors that at its content's
               min-content size, it stays pinned near its widest row's natural
               width even when the right panel is dragged much narrower —
               pushing that row to overflow past both the container's own
               edges instead of actually reflowing into the space available. */
            #${GPP_LIB_CURRENT_PT_ID} { align-self: stretch; min-width: 0; }
            .gpp-lib-current-unload {
                position: absolute; top: 3px; right: 3px; width: 18px; height: 18px;
                border-radius: 9999px; border: none; display: flex; align-items: center; justify-content: center;
                font-size: 10px; line-height: 1; cursor: pointer; opacity: .65; transition: opacity .1s;
                background: ${t2('rgba(255,255,255,.85)', 'rgba(30,30,46,.85)')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-current-unload:hover { opacity: 1; }
            .gpp-lib-current-name {
                font-size: 12px; font-weight: 600; text-align: center; max-width: 100%;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-editable-name {
                cursor: text; border-radius: 4px; padding: 1px 4px; margin: -1px -4px;
            }
            .gpp-lib-editable-name:hover {
                background: ${t2('rgba(37,99,235,.08)', 'rgba(137,180,250,.12)')};
            }
            .gpp-lib-rename-input {
                font: inherit; width: 100%; box-sizing: border-box;
                padding: 1px 3px; border-radius: 4px;
                border: 1px solid ${t2('#2563eb', '#89b4fa')};
                background: ${t2('#ffffff', '#11111b')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-btn {
                font: inherit; font-size: 11px; cursor: pointer; border-radius: 6px;
                padding: 4px 9px; border: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#ffffff', '#313244')}; color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-btn:hover:not(:disabled) { background: ${t2('#f3f4f6', '#45475a')}; }
            .gpp-lib-btn:disabled { opacity: .45; cursor: not-allowed; }
            .gpp-lib-btn-danger { color: ${t2('#dc2626', '#f38ba8')}; }
            .gpp-lib-empty {
                font-size: 11px; color: ${t2('#64748b', '#a6adc8')}; padding: 10px 2px;
            }
            .gpp-lib-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(${GPP_LIB_THUMB_SIZE}px, 1fr));
                /* Explicit row floor matching the column formula — see
                   gpp-palette.js's identical .gpp-palette-grid fix for why:
                   Firefox can fail to derive implicit row height from
                   .gpp-lib-card's aspect-ratio (nested inside the
                   .gpp-lib-cell flex wrapper) once the panel narrows enough
                   to reflow the column count, collapsing cards toward zero
                   height — which also swallows their click area and hides
                   their canvas thumbnail, since both size off the
                   collapsed card. */
                grid-auto-rows: minmax(${GPP_LIB_THUMB_SIZE}px, 1fr);
                gap: 10px 6px;
            }
            .gpp-lib-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
            .gpp-lib-card {
                position: relative; aspect-ratio: 1 / 1; border-radius: 6px; overflow: hidden;
                cursor: pointer; box-sizing: border-box;
                background: ${t2('#f1f5f9', '#292a3a')};
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                transition: box-shadow .1s, border-color .1s;
            }
            .gpp-lib-card:hover { border-color: ${t2('#2563eb', '#89b4fa')}; }
            .gpp-lib-card-focused {
                border-color: ${t2('#2563eb', '#89b4fa')};
                box-shadow: 0 0 0 2px ${t2('rgba(37,99,235,.35)', 'rgba(137,180,250,.35)')};
            }
            /* Drag-reorder — analogous to .gpp-lib-row-dragging/-dragover
               (Manage Templates modal) but scoped separately since these are
               square grid cards, not list rows. */
            .gpp-lib-card-dragging { opacity: .4; }
            .gpp-lib-card-dragover { border-color: ${t2('#2563eb', '#89b4fa')}; box-shadow: 0 0 0 2px ${t2('rgba(37,99,235,.35)', 'rgba(137,180,250,.35)')}; }
            .gpp-lib-card canvas.gpp-lib-thumb-canvas {
                display: block; width: 100%; height: 100%; image-rendering: pixelated;
            }
            .gpp-lib-arrow {
                position: absolute; top: 3px; right: 3px; width: 17px; height: 17px;
                border-radius: 9999px; border: none; display: flex; align-items: center; justify-content: center;
                font-size: 9px; line-height: 1; cursor: pointer; opacity: .55; transition: opacity .1s;
                background: ${t2('rgba(255,255,255,.85)', 'rgba(30,30,46,.85)')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-card:hover .gpp-lib-arrow { opacity: 1; }
            .gpp-lib-vis-btn {
                position: absolute; bottom: 3px; right: 3px; width: 17px; height: 17px;
                border-radius: 9999px; border: none; display: flex; align-items: center; justify-content: center;
                font-size: 9px; line-height: 1; cursor: pointer; opacity: .55; transition: opacity .1s;
                background: ${t2('rgba(255,255,255,.85)', 'rgba(30,30,46,.85)')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-card:hover .gpp-lib-vis-btn { opacity: 1; }
            #${GPP_LIB_HOVER_ID} {
                position: fixed; z-index: 10060; pointer-events: none; display: none;
                padding: 6px; border-radius: 8px;
                background: ${t2('#ffffff', '#1e1e2e')};
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                box-shadow: 0 8px 24px ${t2('rgba(15,23,42,.28)', 'rgba(0,0,0,.6)')};
            }
            #${GPP_LIB_HOVER_ID} canvas {
                display: block; max-width: ${GPP_LIB_PREVIEW_SIZE}px; max-height: ${GPP_LIB_PREVIEW_SIZE}px; width: auto; height: auto;
                image-rendering: pixelated; border-radius: 4px;
                background: ${t2('#f1f5f9', '#292a3a')};
            }
            .gpp-lib-hover-caption {
                margin-top: 4px; font-size: 10px; text-align: center;
                max-width: ${GPP_LIB_PREVIEW_SIZE}px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                color: ${t2('#64748b', '#a6adc8')};
            }
            .gpp-lib-fullview-overlay {
                position: fixed; inset: 0; z-index: 10070; background: rgba(0,0,0,.55);
                display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
                padding: 32px; box-sizing: border-box;
            }
            .gpp-lib-fullview-canvas {
                display: block; max-width: 90vw; max-height: 82vh; width: auto; height: auto;
                image-rendering: pixelated; border-radius: 6px;
                box-shadow: 0 12px 32px rgba(0,0,0,.5);
            }
            .gpp-lib-fullview-caption {
                font-size: 12px; text-align: center; max-width: 90vw;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                color: ${t2('#64748b', '#a6adc8')};
            }
            .gpp-lib-fullview-close {
                position: absolute; top: 16px; right: 20px; width: 28px; height: 28px;
                border-radius: 9999px; border: none; display: flex; align-items: center; justify-content: center;
                font-size: 14px; cursor: pointer;
                background: ${t2('rgba(255,255,255,.85)', 'rgba(30,30,46,.85)')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-fullview-close:hover { background: ${t2('#f3f4f6', '#45475a')}; }
            .gpp-lib-manage-overlay {
                position: fixed; inset: 0; z-index: 10050; background: rgba(0,0,0,.55);
                display: flex; align-items: center; justify-content: center;
            }
            .gpp-lib-manage-panel {
                width: min(92vw, 560px); max-height: 82vh; display: flex; flex-direction: column; gap: 10px;
                border-radius: 10px; padding: 14px; box-sizing: border-box;
                background: ${t2('#ffffff', '#1e1e2e')}; color: ${t2('#111827', '#f5f5f5')};
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                box-shadow: 0 12px 32px rgba(0,0,0,.35);
                font: 13px system-ui, sans-serif;
            }
            .gpp-lib-manage-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
            .gpp-lib-manage-title { font-weight: 600; font-size: 14px; }
            .gpp-lib-manage-close { border: none; background: transparent; color: inherit; cursor: pointer; font-size: 15px; }
            .gpp-lib-manage-toolbar {
                display: flex; align-items: center; gap: 8px; padding: 6px 0;
                border-top: 1px solid ${t2('#e5e7eb', '#313244')}; border-bottom: 1px solid ${t2('#e5e7eb', '#313244')};
            }
            .gpp-lib-manage-toolbar-spacer { flex: 1; }
            .gpp-lib-manage-selectall { display: flex; align-items: center; gap: 6px; font-size: 12px; }
            .gpp-lib-manage-export-progress { display: flex; flex-direction: column; gap: 4px; padding: 2px 0 4px; }
            .gpp-lib-manage-export-progress-label {
                font-size: 11px; color: ${t2('#64748b', '#a6adc8')};
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .gpp-lib-manage-export-progress-bar {
                height: 6px; border-radius: 9999px; overflow: hidden;
                background: ${t2('#e5e7eb', '#313244')};
            }
            .gpp-lib-manage-export-progress-fill {
                height: 100%; width: 0%; border-radius: 9999px;
                background: ${t2('#2563eb', '#89b4fa')};
                transition: width .12s ease;
            }
            .gpp-lib-manage-list {
                flex: 1; min-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
                scrollbar-gutter: stable;
            }
            .gpp-lib-manage-empty { font-size: 12px; color: ${t2('#64748b', '#a6adc8')}; padding: 12px 4px; text-align: center; }
            .gpp-lib-row {
                display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px;
                border: 1px solid transparent;
            }
            .gpp-lib-row:hover { background: ${t2('#f3f4f6', '#292a3a')}; }
            .gpp-lib-row-dragging { opacity: .4; }
            .gpp-lib-row-dragover { border-color: ${t2('#2563eb', '#89b4fa')}; }
            .gpp-lib-row-handle { cursor: grab; user-select: none; color: ${t2('#94a3b8', '#6c7086')}; font-size: 12px; flex-shrink: 0; }
            .gpp-lib-row-thumb {
                width: 22px; height: 22px; border-radius: 3px; flex-shrink: 0; image-rendering: pixelated;
                background: ${t2('#f1f5f9', '#292a3a')};
            }
            .gpp-lib-row-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
            .gpp-lib-row-name { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .gpp-lib-row-dims { font-size: 10px; color: ${t2('#64748b', '#a6adc8')}; }
            .gpp-lib-row-vis {
                border: none; background: transparent; cursor: pointer; font-size: 13px; flex-shrink: 0;
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-row-goto {
                border: none; background: transparent; cursor: pointer; font-size: 12px; flex-shrink: 0;
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-row-goto:disabled { opacity: .35; cursor: not-allowed; }
            .gpp-lib-manage-header-right { display: flex; align-items: center; gap: 8px; }
            .gpp-lib-manage-view-toggle {
                display: flex; border-radius: 6px; overflow: hidden;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
            }
            .gpp-lib-manage-view-btn {
                font: inherit; font-size: 12px; line-height: 1; cursor: pointer; border: none; padding: 4px 7px;
                background: ${t2('#ffffff', '#313244')}; color: ${t2('#64748b', '#a6adc8')};
            }
            .gpp-lib-manage-view-btn:hover { background: ${t2('#f3f4f6', '#45475a')}; }
            .gpp-lib-manage-view-btn-active {
                background: ${t2('#2563eb', '#89b4fa')}; color: ${t2('#ffffff', '#1e1e2e')};
            }
            /* Fixed-size cards (no 1fr stretch) — scroll, don't reflow, as
               the column count changes; overrides .gpp-lib-manage-list's
               flex column layout when this modifier class is also present. */
            .gpp-lib-manage-list-grid {
                display: grid; grid-template-columns: repeat(auto-fill, 92px); grid-auto-rows: min-content;
                gap: 10px; align-content: start; justify-content: start;
            }
            .gpp-lib-manage-grid-card {
                position: relative; width: 92px; box-sizing: border-box;
                display: flex; flex-direction: column; gap: 3px; cursor: pointer;
            }
            .gpp-lib-manage-grid-card-dragging { opacity: .4; }
            .gpp-lib-manage-grid-thumb-wrap {
                position: relative; width: 92px; height: 92px; border-radius: 6px; overflow: hidden; box-sizing: border-box;
                background: ${t2('#f1f5f9', '#292a3a')};
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                transition: box-shadow .1s, border-color .1s;
            }
            .gpp-lib-manage-grid-card:hover .gpp-lib-manage-grid-thumb-wrap { border-color: ${t2('#2563eb', '#89b4fa')}; }
            .gpp-lib-manage-grid-card-focused .gpp-lib-manage-grid-thumb-wrap {
                border-color: ${t2('#2563eb', '#89b4fa')};
                box-shadow: 0 0 0 2px ${t2('rgba(37,99,235,.35)', 'rgba(137,180,250,.35)')};
            }
            .gpp-lib-manage-grid-card-dragover .gpp-lib-manage-grid-thumb-wrap {
                border-color: ${t2('#2563eb', '#89b4fa')};
                box-shadow: 0 0 0 2px ${t2('rgba(37,99,235,.35)', 'rgba(137,180,250,.35)')};
            }
            .gpp-lib-manage-grid-card-selected .gpp-lib-manage-grid-thumb-wrap {
                border-color: ${t2('#d97706', '#f9a825')};
                box-shadow: 0 0 0 2px ${t2('rgba(217,119,6,.35)', 'rgba(249,168,37,.35)')};
            }
            /* object-fit: contain (not width/height:100% stretch) — the
               canvas now renders at the template's own true, possibly
               non-square resolution (gppLibraryRenderFullCanvas), so it
               must letterbox to fit this square box instead of distorting.
               Slightly darkened by default, full brightness on hover —
               per explicit product feedback, makes the overlaid corner
               buttons (opaque at all times, see below) read clearly
               against any thumbnail without needing their own opacity
               dance, and gives a clear hover affordance for the whole card. */
            .gpp-lib-manage-grid-thumb-wrap canvas {
                display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated;
                filter: brightness(0.72); transition: filter .1s;
            }
            .gpp-lib-manage-grid-card:hover .gpp-lib-manage-grid-thumb-wrap canvas { filter: brightness(1); }
            .gpp-lib-manage-grid-name {
                font-size: 10px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                color: ${t2('#111827', '#f5f5f5')};
            }
            /* Always fully opaque (not translucent-until-hover) — per
               explicit product feedback, these need to be readable at a
               glance without hovering first; the thumbnail's own darken/
               brighten-on-hover treatment above is what now carries the
               hover affordance instead. */
            .gpp-lib-manage-grid-sel, .gpp-lib-manage-grid-vis, .gpp-lib-manage-grid-goto {
                position: absolute; width: 17px; height: 17px; border-radius: 9999px; border: none;
                display: flex; align-items: center; justify-content: center; font-size: 9px; line-height: 1; cursor: pointer;
                background: ${t2('rgba(255,255,255,.85)', 'rgba(30,30,46,.85)')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            .gpp-lib-manage-grid-sel { top: 3px; left: 3px; }
            .gpp-lib-manage-grid-vis { top: 3px; right: 3px; }
            .gpp-lib-manage-grid-goto { bottom: 3px; left: 3px; }
            .gpp-lib-manage-grid-sel-active { background: ${t2('#d97706', '#f9a825')}; color: ${t2('#ffffff', '#1e1e2e')}; opacity: 1; }
        `;
    }

    // ── Thumbnail generation (nearest-neighbour, bounded by output size) ──
    // Cost is O(size²), independent of the source template's resolution —
    // this is what makes it safe to call on every cache miss without ever
    // touching the full-resolution `indices` array pixel-by-pixel.
    function gppLibraryRenderThumbCanvas(template, size) {
        const canvas = document.createElement('canvas');
        canvas.className = 'gpp-lib-thumb-canvas';
        canvas.width = size;
        canvas.height = size;
        const width = template.width;
        const height = template.height;
        const indices = template.indices;
        const palette = template.palette;
        if (!width || !height || !indices || !palette || !palette.length) return canvas;
        const core = gppCreateCore();
        const empty = core.emptyValue(template.indexType);
        const scale = Math.min(size / width, size / height);
        const drawWidth = Math.max(1, Math.round(width * scale));
        const drawHeight = Math.max(1, Math.round(height * scale));
        const offsetX = Math.floor((size - drawWidth) / 2);
        const offsetY = Math.floor((size - drawHeight) / 2);
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(drawWidth, drawHeight);
        const data = imageData.data;
        for (let oy = 0; oy < drawHeight; oy++) {
            const sy = Math.min(height - 1, Math.floor(oy / scale));
            const sRowBase = sy * width;
            const dRowBase = oy * drawWidth;
            for (let ox = 0; ox < drawWidth; ox++) {
                const sx = Math.min(width - 1, Math.floor(ox / scale));
                const value = indices[sRowBase + sx];
                if (value === empty) continue; // stays transparent (ImageData is zero-initialized)
                const packed = palette[value];
                const di = (dRowBase + ox) * 4;
                data[di] = (packed >>> 16) & 0xFF;
                data[di + 1] = (packed >>> 8) & 0xFF;
                data[di + 2] = packed & 0xFF;
                data[di + 3] = 255;
            }
        }
        ctx.putImageData(imageData, offsetX, offsetY);
        return canvas;
    }

    // ── Full-resolution render (current-template panel + fullscreen preview) ──
    // Unlike gppLibraryRenderThumbCanvas (which rasterizes into a SIZE-
    // bounded canvas, downsampling the source), this builds the canvas at
    // the template's own width/height — one real source pixel per canvas
    // pixel — so CSS, not this function, is what scales it down to fit. Not
    // cached in gppLibraryThumbCache: it's a fresh, independent canvas node
    // every call, never one the hover preview or grid cards could steal via
    // appendChild (see this file's header comment on that invariant).
    function gppLibraryRenderFullCanvas(template) {
        const canvas = document.createElement('canvas');
        canvas.className = 'gpp-lib-thumb-canvas';
        const width = template.width || 1;
        const height = template.height || 1;
        canvas.width = width;
        canvas.height = height;
        const indices = template.indices;
        const palette = template.palette;
        if (!template.width || !template.height || !indices || !palette || !palette.length) return canvas;
        const core = gppCreateCore();
        const empty = core.emptyValue(template.indexType);
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        for (let i = 0; i < width * height; i++) {
            const value = indices[i];
            if (value === empty) continue; // stays transparent (ImageData is zero-initialized)
            const packed = palette[value];
            const di = i * 4;
            data[di] = (packed >>> 16) & 0xFF;
            data[di + 1] = (packed >>> 8) & 0xFF;
            data[di + 2] = packed & 0xFF;
            data[di + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    function gppLibraryEnsureThumb(template) {
        let entry = gppLibraryThumbCache.get(template.id);
        const stale = !entry
            || entry.indicesRef !== template.indices
            || entry.paletteRef !== template.palette
            || entry.width !== template.width
            || entry.height !== template.height;
        if (stale) {
            entry = {
                indicesRef: template.indices,
                paletteRef: template.palette,
                width: template.width,
                height: template.height,
                small: gppLibraryRenderThumbCanvas(template, GPP_LIB_THUMB_RENDER_SIZE),
            };
            gppLibraryThumbCache.set(template.id, entry);
        }
        return entry;
    }

    function gppLibraryPruneThumbCache() {
        if (!gppLibraryThumbCache.size) return;
        const liveIds = new Set(gppState.templates.map(t => t.id));
        for (const id of Array.from(gppLibraryThumbCache.keys())) {
            if (!liveIds.has(id)) gppLibraryThumbCache.delete(id);
        }
    }

    // ── Hover preview (floating, follows cursor) ──────────────────────
    function gppLibraryEnsureHoverEl() {
        if (gppLibraryHoverEl && document.body.contains(gppLibraryHoverEl)) return gppLibraryHoverEl;
        const el = document.createElement('div');
        el.id = GPP_LIB_HOVER_ID;
        document.body.appendChild(el);
        gppLibraryHoverEl = el;
        return el;
    }

    function gppLibraryShowHoverPreview(event, template) {
        const el = gppLibraryEnsureHoverEl();
        // Full/true resolution (not the bounded thumb cache) — a fresh,
        // independent canvas every call, never the cached `.small` node a
        // card/row already owns (see this file's header comment on that
        // invariant); CSS bounds its displayed size via max-width/max-height.
        const canvas = gppLibraryRenderFullCanvas(template);
        el.innerHTML = '';
        el.appendChild(canvas);
        const caption = document.createElement('div');
        caption.className = 'gpp-lib-hover-caption';
        caption.textContent = (template.name || 'Untitled template') + '  ' + template.width + '×' + template.height;
        el.appendChild(caption);
        el.style.display = 'block';
        gppLibraryMoveHoverPreview(event);
    }

    function gppLibraryMoveHoverPreview(event) {
        const el = gppLibraryHoverEl;
        if (!el || el.style.display === 'none') return;
        const margin = 16;
        const rect = el.getBoundingClientRect();
        let left = event.clientX + margin;
        let top = event.clientY + margin;
        if (left + rect.width > window.innerWidth) left = event.clientX - rect.width - margin;
        if (top + rect.height > window.innerHeight) top = event.clientY - rect.height - margin;
        el.style.left = Math.max(4, left) + 'px';
        el.style.top = Math.max(4, top) + 'px';
    }

    function gppLibraryHideHoverPreview() {
        if (gppLibraryHoverEl) gppLibraryHoverEl.style.display = 'none';
    }

    // ── Teleport (corner-arrow "go to" action) ────────────────────────
    // Centres on the template's placed footprint rather than its raw
    // top-left grid coordinate, using the same grid->mercator->wgs84
    // convention as the standalone prototype's flyToNearestError (and
    // core.js's pick-points tooling): mercator = grid * gridSize (+ the
    // site's meter offset), then turf.toWgs84(...) for the map's lng/lat.
    function gppLibraryComputeTemplateCenterGrid(template) {
        if (!template.position || !Number.isFinite(template.position.gridX) || !Number.isFinite(template.position.gridY)) return null;
        const width = template.width || 1;
        const height = template.height || 1;
        return {
            gridX: template.position.gridX + (width - 1) / 2,
            gridY: template.position.gridY - (height - 1) / 2,
        };
    }

    // Instant, not eased — explicit user request: teleporting to a template
    // should jump straight there (jumpTo), not ease into it (flyTo).
    function gppLibraryFlyToTemplate(template) {
        const center = gppLibraryComputeTemplateCenterGrid(template);
        if (!center) return;
        const map = gppGetMap();
        const turf = gppGetTurf();
        if (!map || !turf || typeof map.jumpTo !== 'function') return;
        const grid = gppReadGridConstants();
        const mercX = center.gridX * grid.gridSize + grid.offsetMetersX;
        const mercY = center.gridY * grid.gridSize + grid.offsetMetersY;
        try {
            const target = turf.toWgs84([mercX, mercY]);
            if (!target) return;
            const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : 12.5;
            map.jumpTo({ center: target, zoom: Math.max(currentZoom, 12.5) });
        } catch (_) {
            // Never let a teleport click throw out of a UI handler — map/turf
            // may not be fully ready yet; simply do nothing in that case.
        }
    }

    // ── Inline rename (current-template panel + Manage Templates rows) ──
    // Renaming never touches pixel content, so it must never call
    // gppLegacyAddImage (that would re-encode/re-hash the blob for no
    // reason) — gppState.persistTemplateState already writes `name`
    // straight into Ghost++'s own per-template state record (GPP_STATE_STORE,
    // keyed by the SAME id whether shared 'legacy_'-prefixed or private
    // 'gpp_'-prefixed — see gpp-runtime.js), and that stored name always
    // wins over the shared/private core record's own name on next load
    // (gppLoadSharedLibraryTemplates / gppLoadTemplateLibrary: `state.name
    // || ...`), so a plain read-modify-write of that one record is
    // sufficient — no separate touch of GP_Ghost_History or
    // GPP_TEMPLATE_STORE needed.
    async function gppLibraryRenameTemplate(template, newName) {
        const trimmed = (newName || '').trim();
        if (!trimmed || trimmed === template.name) return;
        template.name = trimmed;
        await gppState.persistTemplateState(template);
    }

    // Swaps `nameEl`'s text for an inline <input>, committing on Enter/blur
    // and discarding on Escape. `onDone` re-renders whatever surface this
    // name lives in (current-template panel or a Manage Templates row) —
    // called even when the edit is cancelled, since the caller still needs
    // its normal (non-input) name element restored.
    function gppLibraryStartRename(nameEl, template, onDone) {
        if (nameEl.querySelector('input')) return; // already editing
        const original = template.name || 'Untitled template';
        nameEl.textContent = '';
        // nameEl is a flex item; gpp-lib-current's own align-items:center
        // (unlike gpp-lib-row-meta, which stretches by default) would
        // otherwise leave it sized to its old text content instead of the
        // available width, so the input's own width:100% would resolve
        // against a near-arbitrary box instead of actually filling the row.
        nameEl.style.alignSelf = 'stretch';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'gpp-lib-rename-input';
        input.value = original;
        input.maxLength = 200;
        nameEl.appendChild(input);
        input.focus();
        input.select();

        let settled = false;
        function finish(commit) {
            if (settled) return;
            settled = true;
            input.removeEventListener('blur', onBlur);
            input.removeEventListener('keydown', onKeydown);
            if (commit) {
                gppLibraryRenameTemplate(template, input.value).then(onDone);
            } else {
                onDone();
            }
        }
        function onBlur() { finish(true); }
        function onKeydown(event) {
            event.stopPropagation(); // don't let Escape/Enter reach anything else (e.g. the modal's own close-on-Escape)
            if (event.key === 'Enter') { event.preventDefault(); finish(true); }
            else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        }
        input.addEventListener('blur', onBlur);
        input.addEventListener('keydown', onKeydown);
        input.addEventListener('click', event => event.stopPropagation());
        input.addEventListener('mousedown', event => event.stopPropagation());
    }

    // ── Fullscreen preview overlay (gpp-lib-thumb-canvas click) ────────
    // Mirrors gpp-lib-manage-overlay's own backdrop/dismiss conventions
    // (fixed inset:0 scrim, click-through-to-backdrop closes, Escape
    // closes) at a higher z-index so it can float above both that modal
    // and the hover preview. Renders its own independent full-resolution
    // canvas (gppLibraryRenderFullCanvas) rather than reusing any cached
    // thumb — same reasoning as the current-template panel itself.
    function gppLibraryOpenFullPreview(template) {
        if (document.getElementById(GPP_LIB_FULLVIEW_ID)) return; // already open
        const overlay = document.createElement('div');
        overlay.id = GPP_LIB_FULLVIEW_ID;
        overlay.className = 'gpp-lib-fullview-overlay';

        const canvas = gppLibraryRenderFullCanvas(template);
        canvas.className = 'gpp-lib-fullview-canvas';
        overlay.appendChild(canvas);

        const caption = document.createElement('div');
        caption.className = 'gpp-lib-fullview-caption';
        caption.textContent = (template.name || 'Untitled template') + '  ' + template.width + '×' + template.height;
        overlay.appendChild(caption);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gpp-lib-fullview-close';
        closeBtn.textContent = '✕';
        closeBtn.setAttribute('aria-label', 'Close preview');
        overlay.appendChild(closeBtn);

        function close() {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
        }
        function onKeydown(event) {
            if (event.key === 'Escape') close();
        }
        document.addEventListener('keydown', onKeydown);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });

        document.body.appendChild(overlay);
    }

    // ── Compact thumbnail grid (GPP_IDS.rightContent) ─────────────────
    // Returns a `.gpp-lib-cell` wrapper (the actual grid item) rather than
    // the square thumbnail box itself, kept as a thin wrapper around the
    // square aspect-ratio:1/1 card (needed for the canvas/arrow/vis-button
    // overlay). No name label here — names don't matter in this compact
    // view (per explicit product decision, favouring density) and the
    // card's own `title` attribute still surfaces the name on hover; renaming
    // stays reachable via gpp-lib-current-name/gpp-lib-row-name instead.
    function gppLibraryBuildCard(template, focusedId, onChange) {
        const cell = document.createElement('div');
        cell.className = 'gpp-lib-cell';

        const card = document.createElement('div');
        card.className = 'gpp-lib-card' + (template.id === focusedId ? ' gpp-lib-card-focused' : '');
        card.title = template.name || 'Untitled template';

        const entry = gppLibraryEnsureThumb(template);
        card.appendChild(entry.small);

        // No arrow at all when unplaced — its absence IS the visual signal
        // that this template still needs to be placed (or was Unset), per
        // explicit product decision, rather than a disabled/tinted button.
        const hasPosition = !!gppLibraryComputeTemplateCenterGrid(template);
        if (hasPosition) {
            const arrowBtn = document.createElement('button');
            arrowBtn.type = 'button';
            arrowBtn.className = 'gpp-lib-arrow';
            arrowBtn.textContent = '➤';
            arrowBtn.title = 'Go to this template’s location';
            arrowBtn.addEventListener('click', event => {
                event.stopPropagation();
                (async () => {
                    await gppState.focusTemplate(template.id);
                    gppLibraryFlyToTemplate(template);
                    onChange();
                })();
            });
            card.appendChild(arrowBtn);
        }

        // Quick opacity 0%/100% toggle right on the card — the same
        // mechanism as the Opacity slider and the Manage Templates row's own
        // eye button (see gppLibraryToggleVisibility), just reachable
        // without opening either.
        const visBtn = document.createElement('button');
        visBtn.type = 'button';
        visBtn.className = 'gpp-lib-vis-btn';
        const paintCardVis = () => {
            const visible = template.opacity > 0;
            visBtn.textContent = visible ? '👁️' : '🚫';
            visBtn.title = visible ? 'Visible — click to hide' : 'Hidden — click to show';
        };
        paintCardVis();
        visBtn.addEventListener('click', event => {
            event.stopPropagation();
            gppLibraryToggleVisibility(template).then(() => {
                paintCardVis();
                onChange();
            });
        });
        card.appendChild(visBtn);

        card.addEventListener('click', () => {
            if (template.id === gppState.focusedTemplateId) return;
            (async () => {
                await gppState.focusTemplate(template.id);
                onChange();
            })();
        });
        card.addEventListener('mouseenter', event => gppLibraryShowHoverPreview(event, template));
        card.addEventListener('mousemove', gppLibraryMoveHoverPreview);
        card.addEventListener('mouseleave', gppLibraryHideHoverPreview);

        // Drag-reorder — same mechanism as the Manage Templates modal's rows
        // (gppLibraryReorderTemplates), just retargeted onto the compact grid
        // card and gppGridDragState instead of a modal-local dragState.
        card.draggable = true;
        card.addEventListener('dragstart', event => {
            gppGridDragState.id = template.id;
            event.dataTransfer.effectAllowed = 'move';
            try { event.dataTransfer.setData('text/plain', template.id); } catch (_) { /* some browsers require this call to succeed for drag to start */ }
            gppLibraryHideHoverPreview(); // don't let the floating hover-preview linger over the drag
            card.classList.add('gpp-lib-card-dragging');
        });
        card.addEventListener('dragend', () => {
            gppGridDragState.id = null;
            card.classList.remove('gpp-lib-card-dragging');
            card.classList.remove('gpp-lib-card-dragover');
        });
        card.addEventListener('dragover', event => {
            if (!gppGridDragState.id || gppGridDragState.id === template.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            card.classList.add('gpp-lib-card-dragover');
        });
        card.addEventListener('dragleave', () => card.classList.remove('gpp-lib-card-dragover'));
        card.addEventListener('drop', event => {
            event.preventDefault();
            card.classList.remove('gpp-lib-card-dragover');
            const sourceId = gppGridDragState.id;
            gppGridDragState.id = null;
            if (!sourceId || sourceId === template.id) return;
            (async () => {
                await gppLibraryReorderTemplates(sourceId, template.id);
                onChange();
            })();
        });

        cell.appendChild(card);

        return cell;
    }

    function gppRenderTemplateLibrary(container, onChange) {
        if (!container) return;
        gppLibraryInjectStyle();
        gppLibraryHideHoverPreview();
        gppLibraryPruneThumbCache();

        // gpp-placement.js's Position/Transform section now lives INSIDE
        // this panel (see below), so its own <details> open/closed toggle
        // would otherwise snap shut/open on every unrelated refresh this
        // function's own full innerHTML wipe triggers — same failure mode
        // gpp-placement.js's own wasOpen check already guards against for
        // its narrower re-renders, just one level up. Read it before the
        // wipe, restore it by seeding a matching stub afterward (see below).
        const previousPt = container.querySelector('#' + GPP_LIB_CURRENT_PT_ID + ' details.gpp-collapsible');
        const ptWasOpen = previousPt ? previousPt.open : true;

        // Same wasOpen-preservation as above, for the grid's own new
        // show/hide collapsible (see below) — scoped by id, not just
        // `details.gpp-collapsible`, since the pt stub above is also one.
        const previousGridDetails = container.querySelector('#' + GPP_LIB_GRID_DETAILS_ID);
        const gridWasOpen = previousGridDetails ? previousGridDetails.open : true;

        container.innerHTML = '';

        const templates = gppState.templates;

        const toolbar = document.createElement('div');
        toolbar.className = 'gpp-lib-toolbar';
        const countLabel = document.createElement('span');
        countLabel.className = 'gpp-lib-count';
        // "0 templates" while the very first decode pass is still in flight
        // would read as "your library was wiped" rather than "still
        // loading" — gppState.runtimeReady (gpp-runtime.js) distinguishes
        // the two. Never shown once runtimeReady flips true, even for a
        // genuinely-empty library (matches the grid's own silent-empty
        // convention below).
        countLabel.textContent = !templates.length && !gppState.runtimeReady
            ? 'Loading…'
            : (templates.length === 1 ? '1 template' : (templates.length + ' templates'));
        const manageBtn = document.createElement('button');
        manageBtn.type = 'button';
        manageBtn.className = 'gpp-lib-btn';
        manageBtn.textContent = '🗂️ Manage';
        manageBtn.title = 'Manage templates';
        manageBtn.addEventListener('click', () => gppOpenManageTemplatesModal(onChange));
        toolbar.appendChild(countLabel);
        toolbar.appendChild(manageBtn);
        container.appendChild(toolbar);

        // Dedicated "current template" section — a larger view of whichever
        // template is focused, above the thumbnail grid, plus (below the
        // name) the Position/Transform controls gpp-init.js renders into
        // gpp-lib-current-pt right after this function returns. Renders its
        // OWN independent canvas via gppLibraryRenderFullCanvas rather than
        // reusing gppLibraryEnsureThumb's cached `.small` entry — that same
        // cached node is also what a card's canvas or the hover preview
        // relies on (appendChild relocates a DOM node, it doesn't clone it),
        // which would otherwise silently steal this section's canvas away
        // the moment any card is hovered. Full resolution (not the
        // bounded-size thumb) so the preview shows one real source
        // pixel per canvas pixel before CSS scales it down to fit.
        const focusedId = gppState.focusedTemplateId;
        let focusedTemplate = templates.find(t => t.id === focusedId);
        if (!focusedTemplate) {
            // A guild template loaded via the guild menu's "Set as Ghost"
            // (gpp-native-shim.js) never appears in gppState.templates — it
            // lives in the deliberately separate, ephemeral
            // gppState.guildTemplates array (see gpp-runtime.js's own header
            // comment) — but once focused it still deserves this same
            // preview + Position/Transform panel, same as gppGetFocusedTemplate's
            // own fallback already treats it as "the" focused template
            // everywhere else in Ghost++.
            focusedTemplate = gppState.guildTemplates.find(t => t.id === focusedId);
        }

        if (!templates.length && !focusedTemplate) {
            if (!gppState.runtimeReady) {
                // Still decoding the shared/private template library in the
                // background (gpp-init.js's open() now renders the shell
                // and this panel BEFORE that finishes, for a faster-feeling
                // first open) — say so instead of silently looking empty,
                // which reads as "my templates are gone" for anyone with a
                // large library, per explicit product feedback.
                const loading = document.createElement('div');
                loading.className = 'gpp-lib-empty';
                loading.textContent = 'Loading templates...';
                container.appendChild(loading);
            }
            // Otherwise (a genuinely empty library) left empty — the drop
            // zone in the left panel already makes the next step obvious.
            return;
        }

        const current = document.createElement('div');
        current.className = 'gpp-lib-current';

        if (focusedTemplate) {
            const canvasWrap = document.createElement('div');
            canvasWrap.className = 'gpp-lib-current-canvas-wrap';
            const fullCanvas = gppLibraryRenderFullCanvas(focusedTemplate);
            fullCanvas.title = 'Click for a full-screen preview';
            fullCanvas.addEventListener('click', () => gppLibraryOpenFullPreview(focusedTemplate));
            canvasWrap.appendChild(fullCanvas);

            const unloadBtn = document.createElement('button');
            unloadBtn.type = 'button';
            unloadBtn.className = 'gpp-lib-current-unload';
            unloadBtn.textContent = '✕';
            unloadBtn.title = focusedTemplate.ephemeral ? 'Unload template' : 'Unload template (keeps it in your library)';
            unloadBtn.setAttribute('aria-label', 'Unload template');
            unloadBtn.addEventListener('click', event => {
                event.stopPropagation();
                (async () => {
                    await gppState.focusTemplate(null);
                    onChange();
                })();
            });
            canvasWrap.appendChild(unloadBtn);
            current.appendChild(canvasWrap);

            const nameEl = document.createElement('div');
            nameEl.className = 'gpp-lib-current-name gpp-lib-editable-name';
            nameEl.textContent = focusedTemplate.name || 'Untitled template';
            nameEl.title = 'Click to rename';
            nameEl.addEventListener('click', event => {
                event.stopPropagation();
                gppLibraryStartRename(nameEl, focusedTemplate, onChange);
            });
            current.appendChild(nameEl);
        }

        // Always present (even with no focused template) so
        // gppRenderPositionTransform — called by gpp-init.js right after
        // this function returns — has a container to render its own
        // "No template selected" state into; a matching gpp-collapsible
        // stub, pre-set to the previously-read open/closed state, is what
        // lets that call's own wasOpen check (reading THIS container right
        // before it wipes it) restore instead of default to open.
        const ptContainer = document.createElement('div');
        ptContainer.id = GPP_LIB_CURRENT_PT_ID;
        const ptStub = document.createElement('details');
        ptStub.className = 'gpp-collapsible';
        ptStub.open = ptWasOpen;
        ptContainer.appendChild(ptStub);
        current.appendChild(ptContainer);

        container.appendChild(current);

        // The "Templates" grid itself is still specifically the personal
        // library (gppState.templates) — a focused GUILD template with an
        // otherwise-empty personal library gets the "current template"
        // section above, but no empty "Templates" collapsible below it.
        if (templates.length) {
            const gridDetails = document.createElement('details');
            gridDetails.className = 'gpp-collapsible';
            gridDetails.id = GPP_LIB_GRID_DETAILS_ID;
            gridDetails.open = gridWasOpen;
            const gridSummary = document.createElement('summary');
            gridSummary.textContent = 'Templates';
            const gridBody = document.createElement('div');
            gridBody.className = 'gpp-body';
            gridDetails.appendChild(gridSummary);
            gridDetails.appendChild(gridBody);

            const grid = document.createElement('div');
            grid.className = 'gpp-lib-grid';
            templates.forEach(template => grid.appendChild(gppLibraryBuildCard(template, focusedId, onChange)));
            gridBody.appendChild(grid);

            container.appendChild(gridDetails);
        }
    }

    // ── Manage Templates modal ─────────────────────────────────────────
    // `gppState.templates` is a live-array getter (see gpp-runtime.js); an
    // ordinary drag-reorder mutates it in place with splice + a full
    // order-index renumber, mirroring gppState.normalizeTemplateOrder()'s
    // contract. Delete (which reassigns the underlying array) is handled
    // entirely through gppState.deleteTemplate(), never here.
    async function gppLibraryReorderTemplates(sourceId, targetId) {
        const list = gppState.templates;
        const fromIndex = list.findIndex(t => t.id === sourceId);
        const toIndex = list.findIndex(t => t.id === targetId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
        const [moved] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, moved);
        gppState.normalizeTemplateOrder();
        await Promise.all(list.map(t => gppState.persistTemplateState(t)));
    }

    function gppLibraryBuildManageRow(template, ctx) {
        const row = document.createElement('div');
        row.className = 'gpp-lib-row';
        row.draggable = true;

        row.addEventListener('dragstart', event => {
            ctx.dragState.id = template.id;
            event.dataTransfer.effectAllowed = 'move';
            try { event.dataTransfer.setData('text/plain', template.id); } catch (_) { /* some browsers require this call to succeed for drag to start */ }
            row.classList.add('gpp-lib-row-dragging');
        });
        row.addEventListener('dragend', () => {
            ctx.dragState.id = null;
            row.classList.remove('gpp-lib-row-dragging');
            row.classList.remove('gpp-lib-row-dragover');
        });
        row.addEventListener('dragover', event => {
            if (!ctx.dragState.id || ctx.dragState.id === template.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            row.classList.add('gpp-lib-row-dragover');
        });
        row.addEventListener('dragleave', () => row.classList.remove('gpp-lib-row-dragover'));
        row.addEventListener('drop', event => {
            event.preventDefault();
            row.classList.remove('gpp-lib-row-dragover');
            const sourceId = ctx.dragState.id;
            ctx.dragState.id = null;
            if (!sourceId || sourceId === template.id) return;
            (async () => {
                await gppLibraryReorderTemplates(sourceId, template.id);
                ctx.renderList();
                ctx.onChange();
            })();
        });

        const handle = document.createElement('span');
        handle.className = 'gpp-lib-row-handle';
        handle.textContent = '⠿';
        handle.title = 'Drag to reorder';
        row.appendChild(handle);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = ctx.selectedIds.has(template.id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) ctx.selectedIds.add(template.id); else ctx.selectedIds.delete(template.id);
            ctx.syncBulkButtons();
        });
        row.appendChild(checkbox);

        const rowThumb = document.createElement('canvas');
        rowThumb.className = 'gpp-lib-row-thumb';
        rowThumb.width = 22;
        rowThumb.height = 22;
        const rtx = rowThumb.getContext('2d');
        rtx.imageSmoothingEnabled = false;
        const cached = gppLibraryEnsureThumb(template);
        rtx.drawImage(cached.small, 0, 0, 22, 22);
        row.appendChild(rowThumb);

        const meta = document.createElement('div');
        meta.className = 'gpp-lib-row-meta';
        const nameEl = document.createElement('div');
        nameEl.className = 'gpp-lib-row-name gpp-lib-editable-name';
        nameEl.textContent = template.name || 'Untitled template';
        nameEl.title = 'Click to rename';
        nameEl.addEventListener('click', event => {
            event.stopPropagation();
            // Dragging a row while editing its name would fight text
            // selection/typing inside the input (draggable ancestors hijack
            // pointer gestures) — suspend it for the duration of the edit.
            row.draggable = false;
            gppLibraryStartRename(nameEl, template, () => {
                row.draggable = true;
                ctx.renderList();
                ctx.onChange();
            });
        });
        const dimsEl = document.createElement('div');
        dimsEl.className = 'gpp-lib-row-dims';
        dimsEl.textContent = template.width + '×' + template.height + (template.position ? '' : ' · unplaced');
        meta.appendChild(nameEl);
        meta.appendChild(dimsEl);
        row.appendChild(meta);

        // Same instant (jumpTo, not flyTo) teleport as the compact grid's
        // corner arrow and the Position/Transform panel's own "Go to
        // template" button — reachable here without first focusing the
        // template just to teleport to it.
        const hasPosition = !!gppLibraryComputeTemplateCenterGrid(template);
        const gotoBtn = document.createElement('button');
        gotoBtn.type = 'button';
        gotoBtn.className = 'gpp-lib-row-goto';
        gotoBtn.textContent = '➤';
        gotoBtn.title = hasPosition ? 'Go to this template’s location' : 'No saved location yet';
        gotoBtn.disabled = !hasPosition;
        gotoBtn.addEventListener('click', event => {
            event.stopPropagation();
            if (!hasPosition) return;
            gppLibraryFlyToTemplate(template);
        });
        row.appendChild(gotoBtn);

        const visBtn = document.createElement('button');
        visBtn.type = 'button';
        visBtn.className = 'gpp-lib-row-vis';
        const paintVis = () => {
            const visible = template.opacity > 0;
            visBtn.textContent = visible ? '👁️' : '🚫';
            visBtn.title = visible ? 'Visible — click to hide' : 'Hidden — click to show';
        };
        paintVis();
        visBtn.addEventListener('click', event => {
            event.stopPropagation();
            gppLibraryToggleVisibility(template).then(() => {
                paintVis();
                ctx.onChange();
            });
        });
        row.appendChild(visBtn);

        return row;
    }

    // Fixed-size grid-view card for the Manage Templates modal — the design
    // the user explicitly asked for, modeled on ghost-template-manager.js's
    // `.gp-to-card` (click thumbnail = focus/load, corner buttons for
    // multiselect + go-to-location), but with fixed-width cards (no 1fr
    // stretch) so the grid scrolls instead of reflowing, and reusing
    // Ghost++'s own focus/visibility/teleport plumbing rather than GTM's.
    // No per-card delete button: Ghost++'s list-view rows don't have one
    // either (delete is bulk-only via the toolbar's "Delete selected"), and
    // adding one only to the grid view would make the two views diverge in
    // capability rather than just presentation.
    function gppLibraryBuildManageGridCard(template, ctx) {
        const card = document.createElement('div');
        const focused = template.id === gppState.focusedTemplateId;
        const selected = ctx.selectedIds.has(template.id);
        card.className = 'gpp-lib-manage-grid-card'
            + (focused ? ' gpp-lib-manage-grid-card-focused' : '')
            + (selected ? ' gpp-lib-manage-grid-card-selected' : '');
        card.title = template.name || 'Untitled template';
        card.draggable = true;

        card.addEventListener('dragstart', event => {
            ctx.dragState.id = template.id;
            event.dataTransfer.effectAllowed = 'move';
            try { event.dataTransfer.setData('text/plain', template.id); } catch (_) { /* some browsers require this call to succeed for drag to start */ }
            gppLibraryHideHoverPreview();
            card.classList.add('gpp-lib-manage-grid-card-dragging');
        });
        card.addEventListener('dragend', () => {
            ctx.dragState.id = null;
            card.classList.remove('gpp-lib-manage-grid-card-dragging');
            card.classList.remove('gpp-lib-manage-grid-card-dragover');
        });
        card.addEventListener('dragover', event => {
            if (!ctx.dragState.id || ctx.dragState.id === template.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            card.classList.add('gpp-lib-manage-grid-card-dragover');
        });
        card.addEventListener('dragleave', () => card.classList.remove('gpp-lib-manage-grid-card-dragover'));
        card.addEventListener('drop', event => {
            event.preventDefault();
            card.classList.remove('gpp-lib-manage-grid-card-dragover');
            const sourceId = ctx.dragState.id;
            ctx.dragState.id = null;
            if (!sourceId || sourceId === template.id) return;
            (async () => {
                await gppLibraryReorderTemplates(sourceId, template.id);
                ctx.renderList();
                ctx.onChange();
            })();
        });

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'gpp-lib-manage-grid-thumb-wrap';

        // Full resolution (gppLibraryRenderFullCanvas — the same technique
        // the current-template panel/hover-preview/fullscreen-preview use),
        // not gppLibraryEnsureThumb's bounded/downsampled cache — these
        // cards render at 92x92, large enough on screen to warrant real
        // source pixels instead of a blurrier shared-cache downsample, per
        // explicit product feedback. Always a fresh, independent canvas
        // node (never the cached `.small` this modal's OWN list-view row
        // thumbnails, or the compact grid behind this modal, could have
        // their own claim on via appendChild) — see gppLibraryShowHoverPreview's
        // identical reasoning. CSS (object-fit: contain) letterboxes it to
        // fit the square box without distorting non-square templates.
        thumbWrap.appendChild(gppLibraryRenderFullCanvas(template));

        const selBtn = document.createElement('button');
        selBtn.type = 'button';
        selBtn.className = 'gpp-lib-manage-grid-sel' + (selected ? ' gpp-lib-manage-grid-sel-active' : '');
        selBtn.textContent = selected ? '☑' : '☐';
        selBtn.title = 'Select for bulk actions';
        selBtn.addEventListener('click', event => {
            event.stopPropagation();
            const nowSelected = !ctx.selectedIds.has(template.id);
            if (nowSelected) ctx.selectedIds.add(template.id); else ctx.selectedIds.delete(template.id);
            selBtn.textContent = nowSelected ? '☑' : '☐';
            selBtn.classList.toggle('gpp-lib-manage-grid-sel-active', nowSelected);
            card.classList.toggle('gpp-lib-manage-grid-card-selected', nowSelected);
            ctx.listEl.classList.toggle('gpp-lib-manage-list-grid-selmode', ctx.selectedIds.size > 0);
            ctx.syncBulkButtons();
        });
        thumbWrap.appendChild(selBtn);

        const visBtn = document.createElement('button');
        visBtn.type = 'button';
        visBtn.className = 'gpp-lib-manage-grid-vis';
        const paintVis = () => {
            const visible = template.opacity > 0;
            visBtn.textContent = visible ? '👁️' : '🚫';
            visBtn.title = visible ? 'Visible — click to hide' : 'Hidden — click to show';
        };
        paintVis();
        visBtn.addEventListener('click', event => {
            event.stopPropagation();
            gppLibraryToggleVisibility(template).then(() => {
                paintVis();
                ctx.onChange();
            });
        });
        thumbWrap.appendChild(visBtn);

        // Same visual-logic-as-absence rule as the compact grid's arrow
        // button: no button at all when the template has never been placed
        // (or was Unset), rather than a disabled/tinted one.
        const hasPosition = !!gppLibraryComputeTemplateCenterGrid(template);
        if (hasPosition) {
            const gotoBtn = document.createElement('button');
            gotoBtn.type = 'button';
            gotoBtn.className = 'gpp-lib-manage-grid-goto';
            gotoBtn.textContent = '🎯';
            gotoBtn.title = 'Load & go to this template’s location';
            gotoBtn.addEventListener('click', event => {
                event.stopPropagation();
                (async () => {
                    await gppState.focusTemplate(template.id);
                    gppLibraryFlyToTemplate(template);
                    ctx.renderList();
                    ctx.onChange();
                })();
            });
            thumbWrap.appendChild(gotoBtn);
        }

        thumbWrap.addEventListener('mouseenter', event => gppLibraryShowHoverPreview(event, template));
        thumbWrap.addEventListener('mousemove', gppLibraryMoveHoverPreview);
        thumbWrap.addEventListener('mouseleave', gppLibraryHideHoverPreview);

        card.appendChild(thumbWrap);

        const nameEl = document.createElement('div');
        nameEl.className = 'gpp-lib-manage-grid-name';
        nameEl.textContent = template.name || 'Untitled template';
        card.appendChild(nameEl);

        // Click anywhere on the card (outside the corner buttons, which
        // stopPropagation their own clicks) loads/focuses this template —
        // the exact "clicking on the template thumbnail set it to the
        // currently selected template" behavior requested, ported from
        // GTM's card-body onclick.
        card.addEventListener('click', () => {
            if (template.id === gppState.focusedTemplateId) return;
            (async () => {
                await gppState.focusTemplate(template.id);
                ctx.renderList();
                ctx.onChange();
            })();
        });

        return card;
    }

    // Hiding/showing a template is NOT a separate mechanism from its Opacity
    // slider (gpp-view-settings.js) — it just drives that same value to 0%
    // or 100%, per explicit product decision, so the two controls can never
    // drift out of sync with each other. Shared by the Manage Templates row
    // button, the compact library card button, and the bulk show/hide-
    // selected actions.
    async function gppLibraryToggleVisibility(template) {
        template.opacity = template.opacity > 0 ? 0 : 1;
        await gppState.persistTemplateState(template);
        if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
    }

    async function gppLibrarySetVisibility(template, visible) {
        const target = visible ? 1 : 0;
        if (template.opacity === target) return;
        template.opacity = target;
        await gppState.persistTemplateState(template);
    }

    function gppOpenManageTemplatesModal(onChange) {
        if (document.getElementById(GPP_LIB_MANAGE_ID)) return; // already open
        gppLibraryInjectStyle();

        const selectedIds = new Set();
        const dragState = { id: null };

        const overlay = document.createElement('div');
        overlay.id = GPP_LIB_MANAGE_ID;
        overlay.className = 'gpp-lib-manage-overlay';

        const panel = document.createElement('div');
        panel.className = 'gpp-lib-manage-panel';
        overlay.appendChild(panel);

        const header = document.createElement('div');
        header.className = 'gpp-lib-manage-header';
        const title = document.createElement('span');
        title.className = 'gpp-lib-manage-title';
        title.textContent = 'Manage templates';

        const headerRight = document.createElement('div');
        headerRight.className = 'gpp-lib-manage-header-right';

        const viewToggle = document.createElement('div');
        viewToggle.className = 'gpp-lib-manage-view-toggle';
        const gridViewBtn = document.createElement('button');
        gridViewBtn.type = 'button';
        gridViewBtn.className = 'gpp-lib-manage-view-btn';
        gridViewBtn.textContent = '▦';
        gridViewBtn.title = 'Grid view';
        const listViewBtn = document.createElement('button');
        listViewBtn.type = 'button';
        listViewBtn.className = 'gpp-lib-manage-view-btn';
        listViewBtn.textContent = '☰';
        listViewBtn.title = 'List view';
        viewToggle.appendChild(gridViewBtn);
        viewToggle.appendChild(listViewBtn);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gpp-lib-manage-close';
        closeBtn.textContent = '✕';
        closeBtn.setAttribute('aria-label', 'Close');

        headerRight.appendChild(viewToggle);
        headerRight.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(headerRight);
        panel.appendChild(header);

        const toolbar = document.createElement('div');
        toolbar.className = 'gpp-lib-manage-toolbar';
        const selectAllWrap = document.createElement('label');
        selectAllWrap.className = 'gpp-lib-manage-selectall';
        const selectAllCheckbox = document.createElement('input');
        selectAllCheckbox.type = 'checkbox';
        const selectAllText = document.createElement('span');
        selectAllText.textContent = 'All';
        selectAllWrap.appendChild(selectAllCheckbox);
        selectAllWrap.appendChild(selectAllText);
        const spacer = document.createElement('div');
        spacer.className = 'gpp-lib-manage-toolbar-spacer';
        const showBtn = document.createElement('button');
        showBtn.type = 'button';
        showBtn.className = 'gpp-lib-btn';
        showBtn.textContent = 'Show selected';
        const hideBtn = document.createElement('button');
        hideBtn.type = 'button';
        hideBtn.className = 'gpp-lib-btn';
        hideBtn.textContent = 'Hide selected';
        const exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.className = 'gpp-lib-btn';
        exportBtn.textContent = 'Export selected';
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'gpp-lib-btn gpp-lib-btn-danger';
        deleteBtn.textContent = 'Delete selected';
        toolbar.appendChild(selectAllWrap);
        toolbar.appendChild(spacer);
        toolbar.appendChild(showBtn);
        toolbar.appendChild(hideBtn);
        toolbar.appendChild(exportBtn);
        toolbar.appendChild(deleteBtn);
        panel.appendChild(toolbar);

        // Hidden until an export is actually running — bulk export (unlike
        // show/hide/delete) can take real, visible time (a real PNG
        // re-encode + base64 conversion per template, see
        // gpp-runtime.js's gppExportTemplatesAsJson), and used to leave the
        // modal looking frozen with no feedback while it ran. Per explicit
        // product feedback, wired to that function's own onProgress
        // callback rather than a fake/simulated bar.
        const exportProgressRow = document.createElement('div');
        exportProgressRow.className = 'gpp-lib-manage-export-progress';
        exportProgressRow.style.display = 'none';
        const exportProgressLabel = document.createElement('div');
        exportProgressLabel.className = 'gpp-lib-manage-export-progress-label';
        const exportProgressBarOuter = document.createElement('div');
        exportProgressBarOuter.className = 'gpp-lib-manage-export-progress-bar';
        const exportProgressBarInner = document.createElement('div');
        exportProgressBarInner.className = 'gpp-lib-manage-export-progress-fill';
        exportProgressBarOuter.appendChild(exportProgressBarInner);
        exportProgressRow.appendChild(exportProgressLabel);
        exportProgressRow.appendChild(exportProgressBarOuter);
        panel.appendChild(exportProgressRow);

        function setExportProgress(visible, fraction, label) {
            exportProgressRow.style.display = visible ? '' : 'none';
            if (!visible) return;
            exportProgressBarInner.style.width = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100) + '%';
            exportProgressLabel.textContent = label || 'Exporting…';
        }

        const listEl = document.createElement('div');
        listEl.className = 'gpp-lib-manage-list';
        panel.appendChild(listEl);

        function syncBulkButtons() {
            const templates = gppState.templates;
            const any = selectedIds.size > 0;
            showBtn.disabled = !any;
            hideBtn.disabled = !any;
            exportBtn.disabled = !any;
            deleteBtn.disabled = !any;
            selectAllCheckbox.checked = templates.length > 0 && selectedIds.size === templates.length;
            selectAllCheckbox.indeterminate = selectedIds.size > 0 && selectedIds.size < templates.length;
        }

        const rowCtx = { selectedIds, dragState, renderList, onChange, syncBulkButtons, listEl };

        function syncViewToggle() {
            gridViewBtn.classList.toggle('gpp-lib-manage-view-btn-active', gppManageViewMode === 'grid');
            listViewBtn.classList.toggle('gpp-lib-manage-view-btn-active', gppManageViewMode === 'list');
        }
        syncViewToggle();
        gridViewBtn.addEventListener('click', () => {
            if (gppManageViewMode === 'grid') return;
            gppManageViewMode = 'grid';
            syncViewToggle();
            renderList();
        });
        listViewBtn.addEventListener('click', () => {
            if (gppManageViewMode === 'list') return;
            gppManageViewMode = 'list';
            syncViewToggle();
            renderList();
        });

        function renderList() {
            // Selections for templates that no longer exist (e.g. deleted
            // from elsewhere while this modal was open) are dropped here.
            const templates = gppState.templates;
            const liveIds = new Set(templates.map(t => t.id));
            selectedIds.forEach(id => { if (!liveIds.has(id)) selectedIds.delete(id); });

            const isGrid = gppManageViewMode === 'grid';
            listEl.classList.toggle('gpp-lib-manage-list-grid', isGrid);
            listEl.classList.toggle('gpp-lib-manage-list-grid-selmode', isGrid && selectedIds.size > 0);
            listEl.innerHTML = '';
            if (!templates.length) {
                const empty = document.createElement('div');
                empty.className = 'gpp-lib-manage-empty';
                empty.textContent = 'No templates yet.';
                listEl.appendChild(empty);
            } else if (isGrid) {
                templates.forEach(template => listEl.appendChild(gppLibraryBuildManageGridCard(template, rowCtx)));
            } else {
                templates.forEach(template => listEl.appendChild(gppLibraryBuildManageRow(template, rowCtx)));
            }
            syncBulkButtons();
        }

        selectAllCheckbox.addEventListener('change', () => {
            selectedIds.clear();
            if (selectAllCheckbox.checked) gppState.templates.forEach(t => selectedIds.add(t.id));
            renderList();
        });

        showBtn.addEventListener('click', () => {
            const chosen = gppState.templates.filter(t => selectedIds.has(t.id));
            if (!chosen.length) return;
            (async () => {
                for (const template of chosen) {
                    try { await gppLibrarySetVisibility(template, true); } catch (err) {
                        console.error('[GeoPixelcons++] Ghost++ bulk show failed:', err);
                    }
                }
                if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
                renderList();
                onChange();
            })();
        });

        hideBtn.addEventListener('click', () => {
            const chosen = gppState.templates.filter(t => selectedIds.has(t.id));
            if (!chosen.length) return;
            (async () => {
                for (const template of chosen) {
                    try { await gppLibrarySetVisibility(template, false); } catch (err) {
                        console.error('[GeoPixelcons++] Ghost++ bulk hide failed:', err);
                    }
                }
                if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
                renderList();
                onChange();
            })();
        });

        exportBtn.addEventListener('click', () => {
            (async () => {
                const chosen = gppState.templates.filter(t => selectedIds.has(t.id));
                if (!chosen.length) return;
                // One combined file, not one download per template — same
                // {version, exportDate, images:[...]} shape the JSON import
                // path already accepts.
                exportBtn.disabled = true;
                setExportProgress(true, 0, 'Exporting 0 / ' + chosen.length + '…');
                try {
                    await gppState.exportTemplatesAsJson(chosen, undefined, (fraction, label) => {
                        setExportProgress(true, fraction, label + ' (' + Math.round(fraction * chosen.length) + ' / ' + chosen.length + ')');
                    });
                } catch (err) {
                    console.error('[GeoPixelcons++] Ghost++ bulk export failed:', err);
                } finally {
                    setExportProgress(false);
                    syncBulkButtons(); // restores exportBtn.disabled from the current selection
                }
            })();
        });

        deleteBtn.addEventListener('click', () => {
            const chosen = gppState.templates.filter(t => selectedIds.has(t.id));
            if (!chosen.length) return;
            const label = chosen.length === 1 ? ('"' + (chosen[0].name || 'this template') + '"') : (chosen.length + ' templates');
            if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
            (async () => {
                for (const template of chosen) {
                    try { await gppState.deleteTemplate(template); } catch (err) {
                        console.error('[GeoPixelcons++] Ghost++ delete failed:', err);
                    }
                }
                selectedIds.clear();
                renderList();
                onChange();
            })();
        });

        function close() {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
        }
        function onKeydown(event) {
            if (event.key === 'Escape') close();
        }
        document.addEventListener('keydown', onKeydown);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });

        document.body.appendChild(overlay);
        renderList();
    }
