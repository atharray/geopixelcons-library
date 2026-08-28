    // ── Ghost++ UI shell ──────────────────────────────────────────────
    // Opener button (replaces the native "Overlay Image" button in place) and
    // the modal skeleton: two-column layout, fully collapsible right panel,
    // drag from any edge, resize from any corner. Palette/library/scan panels
    // are populated by gpp-runtime.js; this file owns layout/chrome only.

    const GPP_IDS = Object.freeze({
        opener: 'gpp-opener',
        modal: 'gpp-modal',
        style: 'gpp-shell-style',
        left: 'gpp-modal-left',
        right: 'gpp-modal-right',
        rightContent: 'gpp-modal-right-content',
        editingLabel: 'gpp-editing-label',
    });

    // How far above the modal's own CSS min-width still counts as "narrow"
    // for the toggle-right button's full-panel-swap mode (see its click
    // handler below) -- the left/right split is already quite cramped
    // somewhat above the bare 480px floor, not only exactly at it.
    const GPP_NARROW_SWAP_MARGIN = 80;

    // .gpp-head is a plain flex row (Ghost++ label, editing name, spacer,
    // minify/close buttons) with no wrap -- a long ingested filename (image
    // hashes, camera exports, etc. routinely run 40+ characters) grows the
    // name span wide enough to shove the minify/close buttons straight off
    // the modal's right edge. With the panel then stuck in minified mode
    // (only Enable all/Disable all + the color grid shown, per that view's
    // own CSS below) there was no other control left to toggle it back off
    // -- reported by ReaCreations, 2026-08-13. Truncate the display copy
    // here rather than the modal's overflow: hidden alone, so the name
    // stays readable instead of just clipping mid-character.
    // Ingested template names never actually carry an extension by this
    // point -- gppIngestImageFile strips it before template.name is ever
    // set (gpp-runtime.js), and JSON re-imports inherit that already-bare
    // name -- but this still preserves one defensively in case a future
    // ingest path ever sets a dotted name.
    const GPP_EDITING_NAME_MAX = 10;
    function gppTruncateEditingName(name) {
        const safe = name || 'Untitled template';
        const extMatch = /\.[a-z0-9]{2,4}$/i.exec(safe);
        const ext = extMatch ? extMatch[0] : '';
        const base = ext ? safe.slice(0, -ext.length) : safe;
        if (base.length <= GPP_EDITING_NAME_MAX) return safe;
        return base.slice(0, GPP_EDITING_NAME_MAX) + '...' + ext;
    }

    // Rewrites the tag's content every call rather than no-op-ing once it
    // exists — t2()/isDarkMode() are evaluated fresh each time this runs, so
    // re-calling it (see gpp-init.js's theme-change observer) is how the UI
    // picks up a live dark/light toggle instead of staying frozen at
    // whatever theme was active on first mount.
    function gppInjectShellStyle() {
        let style = document.getElementById(GPP_IDS.style);
        if (!style) {
            style = document.createElement('style');
            style.id = GPP_IDS.style;
            document.head.appendChild(style);
        }
        style.textContent = `
            #${GPP_IDS.modal} {
                position: fixed; left: 24px; top: 90px; z-index: 2000;
                display: flex; flex-direction: row;
                width: min(92vw, 800px); height: 75vh;
                min-width: min(480px, calc(100vw - 16px));
                min-height: min(320px, calc(100vh - 16px));
                border-radius: .75rem; overflow: hidden;
                background: ${t2('#ffffff', '#1e1e2e')}; color: ${t2('#111827', '#f5f5f5')};
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                box-shadow: 0 12px 32px ${t2('rgba(15,23,42,.28)', 'rgba(0,0,0,.62)')};
                font: 13px system-ui, sans-serif;
                /* View Settings > Global > "Rescale Ghost++" (gpp-view-settings.js)
                   sets --gpp-scale as an inline style on this element.
                   transform-origin: top left keeps the modal's own left/top
                   (a plain layout position, unaffected by transform) as the
                   one fixed anchor point regardless of scale, so
                   gppWireModalDrag's move math needs no changes -- only
                   gppWireModalResize's drag-to-resize compensates for scale
                   explicitly (see its own comment), since resize deltas are
                   real, unscaled screen pixels. getBoundingClientRect()
                   already reports the SCALED (visual) box in every modern
                   browser, so drag/collapse/expand width math elsewhere in
                   this file (which all reads it) keeps working unmodified. */
                transform: scale(var(--gpp-scale, 1));
                transform-origin: top left;
            }
            #${GPP_IDS.modal}.gpp-hidden { display: none; }
            /* ── Minified view (per explicit user feedback) ──────────────
               Pure CSS toggle (see the minify button's click handler below)
               -- hides everything except the Enable all/Disable all row, the
               palette Grid/List control, and the color grid itself, and
               shrinks the modal down to a small
               floating strip. The real sections/controllers underneath stay
               fully mounted and functional; only their visibility changes,
               so nothing needs to be re-rendered when toggling in or out. */
            #${GPP_IDS.modal}.gpp-minified {
                width: min(var(--gpp-compact-width, 260px), calc(100vw - 16px)) !important; min-width: 0 !important;
                height: min(var(--gpp-compact-height, 160px), calc(100vh - 16px)) !important; min-height: 0 !important;
            }
            #${GPP_IDS.modal}.gpp-minified #${GPP_IDS.right},
            #${GPP_IDS.modal}.gpp-minified .gpp-edge { display: none !important; }
            /* Keep the corners active in compact mode so this window can be
               resized and remembered independently of the full menu. */
            #${GPP_IDS.modal}.gpp-minified .gpp-corner { display: block !important; }
            /* The "Ghost++" title itself is dead weight in the already-cramped
               260px minified strip -- the editing-name label next to it (see
               gppTruncateEditingName above) already identifies the panel,
               so drop the title to leave it more room before truncating. */
            #${GPP_IDS.modal}.gpp-minified .gpp-head-title { display: none !important; }
            #${GPP_IDS.modal}.gpp-minified #gpp-left-body {
                display: flex; flex-direction: column; min-height: 0; overflow: hidden !important;
            }
            #${GPP_IDS.modal}.gpp-minified #gpp-left-body > *:not(#gpp-palette-section) { display: none !important; }
            #${GPP_IDS.modal}.gpp-minified #gpp-palette-section > details > summary,
            #${GPP_IDS.modal}.gpp-minified .gpp-palette-empty,
            #${GPP_IDS.modal}.gpp-minified .gpp-palette-search-input,
            #${GPP_IDS.modal}.gpp-minified .gpp-palette-bulk-row:not(#gpp-palette-bulk-top),
            #${GPP_IDS.modal}.gpp-minified .gpp-palette-controls-row,
            #${GPP_IDS.modal}.gpp-minified details.gpp-collapsible#gpp-palette-gnc-details { display: none !important; }
            #${GPP_IDS.modal}.gpp-minified #gpp-palette-section {
                display: flex; flex: 1 1 auto; min-height: 0;
            }
            #${GPP_IDS.modal}.gpp-minified #gpp-palette-section > details {
                display: flex; flex: 1 1 0; flex-direction: column;
                min-height: 0; overflow: hidden; border-top: none; padding: 6px;
            }
            #${GPP_IDS.modal}.gpp-minified #gpp-palette-section > details > .gpp-body {
                display: flex; flex: 1 1 0; flex-direction: column;
                min-height: 0; overflow: hidden;
            }
            #${GPP_IDS.modal}.gpp-minified .gpp-palette-panel {
                flex: 1 1 0; min-height: 0; overflow: hidden;
            }
            #${GPP_IDS.modal}.gpp-minified .gpp-palette-grid {
                flex: 1 1 0; min-height: 0; max-height: none; overflow-y: auto;
            }
            /* Only present for the duration of a collapse/expand toggle (see
               the toggle-right handler below) — ports ghost-template-manager.js's
               own .gpc-preview-animating: without a matching width transition
               on the MODAL itself, right's own width animates smoothly while
               the modal's outer edge snaps instantly, which reads as a janky,
               uncoordinated "weird animation" since the two related widths
               move at different paces. Scoped to a temporary class (not a
               permanent rule) so it never fights gppWireModalResize's own
               drag-to-resize, which needs instant, untransitioned width
               updates while dragging.
               Duration/easing MUST match #${GPP_IDS.right}'s own width
               transition exactly (.15s ease, below) — #${GPP_IDS.left} is
               flex:1 1 0 with no width transition of its own, so at every
               frame its rendered width is just "modal's current width minus
               right's current width". If the two transitions run for
               different durations, that difference is momentarily nonzero
               partway through (one side finishes shrinking before the
               other), which reads as the left panel visibly bulging and
               settling instead of staying rock-steady while only the right
               side moves. Keeping both transitions identical keeps that
               difference constant (= left's true width) at every frame. */
            #${GPP_IDS.modal}.gpp-modal-animating-width { transition: width .15s ease; overflow: hidden; }
            /* Temporary, like -animating-width above -- see the minify
               button's click handler (gppRunMinifyTransition) for why this
               is an opacity cross-fade rather than a resize animation. */
            #${GPP_IDS.modal}.gpp-minify-transitioning { transition: opacity .14s ease; }
            #${GPP_IDS.modal} .gpp-head {
                display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: move;
                touch-action: none; user-select: none; -webkit-user-select: none;
                background: ${t2('#f8fafc', '#181825')}; border-bottom: 1px solid ${t2('#d1d5db', '#45475a')};
            }
            #${GPP_IDS.modal} .gpp-head .gpp-spacer { flex: 1; }
            #${GPP_IDS.modal} .gpp-head button {
                position: relative; z-index: 7;
                border: none; background: transparent; color: inherit; cursor: pointer; font-size: 14px;
            }
            /* Two stacked lines (name, then position) rather than one run-on
               string -- a single-line version had the whole thing (name AND
               the X/Y coordinates after it) subject to the same nowrap +
               ellipsis rule below, so on anything narrower than the full
               string's width the coordinates themselves got silently
               ellipsis-clipped along with the name, not just the name (per
               user follow-up on the original overflow fix). Splitting into
               two lines lets each be truncated independently -- only
               .gpp-editing-name (backstopping gppTruncateEditingName()) ever
               needs to clip; .gpp-editing-coords is always short and fixed-
               format ("X: n, Y: n") so it is never truncated. */
            #${GPP_IDS.editingLabel} {
                display: flex; flex-direction: column; gap: 1px;
                font-size: 11px; font-weight: 600;
                color: ${t2('#475569', '#a6adc8')};
                /* min-width: 0 lets this actually shrink inside the flex row
                   (flex items default to min-width: auto -- content width --
                   which is exactly what let a long name push the minify/close
                   buttons off the modal before). */
                min-width: 0;
            }
            #${GPP_IDS.editingLabel} .gpp-editing-name {
                min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
            }
            #${GPP_IDS.editingLabel} .gpp-editing-coords {
                font-weight: 400; opacity: .85;
            }
            /* No overflow-y/scrollbar-gutter here — #gpp-left-body (its
               child, below) is the one that actually scrolls (.gpp-head
               plus #gpp-left-body's own flex:1 exactly fill this
               container's height between them), so this element itself
               never shows a scrollbar. It used to carry both properties
               anyway — pure dead weight that silently reserved ~15px of
               scrollbar-gutter space on the right for a scrollbar that
               could never appear, on top of the horizontal padding bug
               above; together they were the "invisible padding" that kept
               .gpp-head and every divider from reaching gpp-panel-splitter. */
            #${GPP_IDS.left} {
                flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;
                padding: 10px 0;
            }
            /* Horizontal inset intentionally does NOT live on the container
               above — .gpp-head is a direct child of it and needs to span
               the full panel width, flush to .gpp-panel-splitter (so does
               every details.gpp-collapsible section's own border-top
               divider, below). Each piece that actually needs breathing
               room insets ITSELF instead: .gpp-head via its own padding
               (below), #gpp-drop-zone/#gpp-ingest-status via their own
               margin, and details.gpp-collapsible via its own padding
               (further down) — none of which affect where a border drawn
               on that same element's box actually sits. */
            #gpp-drop-zone, #gpp-ingest-status { margin-left: 12px; margin-right: 12px; }
            /* Reserves the scrollbar's own width whether or not it's
               currently needed, on every scrollable region below — per
               explicit product feedback, content (Progress/Error Settings/
               palette/etc.) was visibly shifting left/right as filtering or
               scanning made a container's content just barely cross the
               scroll threshold. */
            #gpp-left-body { scrollbar-gutter: stable; }
            #${GPP_IDS.right} {
                position: relative;
                width: 280px; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden;
                border-left: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#f8fafc', '#181825')};
                transition: width .15s ease;
            }
            #${GPP_IDS.right}.gpp-collapsed { width: 34px; }
            #${GPP_IDS.right}.gpp-collapsed #${GPP_IDS.rightContent} { opacity: 0; pointer-events: none; }
            #${GPP_IDS.right}.gpp-collapsed .gpp-panel-splitter { display: none; }
            /* Narrow-width full-panel swap (mirrors the legacy Ghost
               Template Manager's own gpc-mobile-compat/gpc-mobile-preview-
               open pattern, per explicit user request) -- see the
               toggle-right button's click handler for exactly when this
               applies instead of the plain .gpp-collapsed 34px stub above.
               #${GPP_IDS.right}'s own width transition (above) already
               covers the 34px<->100% animation; #${GPP_IDS.left} itself
               isn't animated (display:none can't be), an accepted trade-off
               for keeping "100% means 100%, no competing flex sibling"
               unambiguous rather than fighting flexbox over it. */
            #${GPP_IDS.modal}.gpp-narrow-full-right #${GPP_IDS.left} { display: none; }
            #${GPP_IDS.modal}.gpp-narrow-full-right #${GPP_IDS.right} { width: 100% !important; }
            #${GPP_IDS.modal}.gpp-narrow-full-right #${GPP_IDS.right} .gpp-panel-splitter { display: none; }
            #${GPP_IDS.rightContent} { flex: 1; overflow-y: auto; padding: 10px; scrollbar-gutter: stable; }
            .gpp-panel-splitter {
                position: absolute; left: -4px; top: 0; bottom: 0; width: 8px;
                cursor: ew-resize; z-index: 20; background: transparent; transition: background .15s;
                touch-action: none; user-select: none; -webkit-user-select: none;
            }
            .gpp-panel-splitter:hover, .gpp-panel-splitter.gpp-ps-dragging { background: rgba(99,102,241,.25); }
            .gpp-collapse-btn {
                width: 20px; height: 20px; border-radius: 9999px; border: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#ffffff', '#313244')}; color: inherit; cursor: pointer; font-size: 10px;
                display: flex; align-items: center; justify-content: center; flex-shrink: 0;
            }
            .gpp-edge {
                position: absolute; z-index: 5; cursor: move;
                touch-action: none; user-select: none; -webkit-user-select: none;
            }
            .gpp-edge.n, .gpp-edge.s { left: 12px; right: 12px; height: 6px; }
            .gpp-edge.n { top: 0; } .gpp-edge.s { bottom: 0; }
            .gpp-edge.e, .gpp-edge.w { top: 12px; bottom: 12px; width: 6px; }
            .gpp-edge.e { right: 0; } .gpp-edge.w { left: 0; }
            .gpp-corner {
                position: absolute; z-index: 6; width: 24px; height: 24px;
                touch-action: none; user-select: none; -webkit-user-select: none;
            }
            .gpp-corner.nw { top: 0; left: 0; cursor: nwse-resize; }
            .gpp-corner.ne { top: 0; right: 0; cursor: nesw-resize; }
            .gpp-corner.sw { bottom: 0; left: 0; cursor: nesw-resize; }
            .gpp-corner.se { bottom: 0; right: 0; cursor: nwse-resize; }
            /* Horizontal padding lives HERE (not on the ambient #gpp-modal-left
               container above) so the summary heading and .gpp-body content
               stay inset, while border-top itself — drawn on this element's
               own border box, which padding never moves — still spans the
               full, true panel width flush to .gpp-panel-splitter. */
            details.gpp-collapsible { border-top: 1px solid ${t2('#e5e7eb', '#313244')}; padding: 8px 12px; }
            details.gpp-collapsible > summary {
                cursor: pointer; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 6px;
            }
            details.gpp-collapsible > summary::-webkit-details-marker { display: none; }
            details.gpp-collapsible > summary::before { content: '\\25B8'; transition: transform .1s; }
            details.gpp-collapsible[open] > summary::before { transform: rotate(90deg); }
            details.gpp-collapsible .gpp-body { padding: 8px 2px 2px; }
            #gpp-drop-zone {
                border: 2px dashed ${t2('#cbd5e1', '#45475a')}; border-radius: 8px;
                padding: 14px; text-align: center; cursor: pointer;
                color: ${t2('#334155', '#cdd6f4')};
                transition: border-color .1s, background .1s;
            }
            #gpp-drop-zone:hover, #gpp-drop-zone.gpp-dragging {
                border-color: ${t2('#2563eb', '#89b4fa')};
                background: ${t2('rgba(37,99,235,.06)', 'rgba(137,180,250,.08)')};
            }
            #gpp-drop-zone .gpp-muted { color: ${t2('#64748b', '#a6adc8')}; }
            #gpp-url-upload-btn {
                display: inline-block; margin-top: 6px; padding: 0; border: none; background: none;
                font: inherit; font-size: 11px; text-decoration: underline; cursor: pointer;
                color: ${t2('#64748b', '#a6adc8')};
            }
            #gpp-url-upload-btn:hover { color: ${t2('#2563eb', '#89b4fa')}; }
            /* Shared hover tooltip (gppAttachTooltip below) — mirrors
               gpp-palette.js's own #gpp-palette-tooltip swatch tooltip
               (mouse-following, edge-clamped, singleton element) so every
               "what does this setting do" hint in Ghost++ looks and behaves
               consistently, not just the palette's. */
            #${GPP_TOOLTIP_ID} {
                position: fixed; z-index: 100010; pointer-events: none; display: none;
                max-width: 240px; padding: 6px 9px; border-radius: 7px; font-size: 11px; line-height: 1.4;
                background: ${t2('#111827', '#11111b')}; color: #f5f5f5;
                box-shadow: 0 8px 20px ${t2('rgba(15,23,42,.28)', 'rgba(0,0,0,.6)')};
            }
        `;
    }

    // Theme helper local to this feature (mirrors core.js's isDarkMode()/t(),
    // reused directly rather than reimplemented) — aliased to a short name so
    // the template-literal CSS above stays readable.
    function t2(light, dark) { return t(light, dark); }

    // ── Shared hover tooltip ─────────────────────────────────────────
    // Per explicit user feedback asking for "hover divs that appear near
    // the cursor" on several named settings, rather than the browser's own
    // `title` attribute tooltip (slow to appear, doesn't follow the
    // cursor, easy to miss, inconsistent across browsers). One singleton
    // element, reused for whichever tooltipped element is currently
    // hovered/focused — mirrors gpp-palette.js's own proven
    // #gpp-palette-tooltip pattern for swatch hex/stats, generalized here
    // to plain text so gpp-view-settings.js/gpp-scan.js/gpp-placement.js
    // can all share one implementation instead of each rolling their own.
    const GPP_TOOLTIP_ID = 'gpp-tooltip';
    let gppTooltipEl = null;
    function gppEnsureTooltipEl() {
        if (gppTooltipEl && document.body.contains(gppTooltipEl)) return gppTooltipEl;
        const el = document.createElement('div');
        el.id = GPP_TOOLTIP_ID;
        document.body.appendChild(el);
        gppTooltipEl = el;
        return el;
    }
    // Auto-dismiss timer, per explicit user feedback -- a tooltip left
    // open (e.g. the user stopped moving the mouse without leaving the
    // element, or alt-tabbed away) disappears on its own after 10s rather
    // than sitting there indefinitely. Armed only the moment the tooltip
    // actually TRANSITIONS from hidden to shown, not re-armed on every
    // mousemove reposition while already visible (gppShowTooltip is called
    // continuously while hovering) -- re-arming on every mousemove would
    // mean it never fires as long as the cursor keeps moving.
    const GPP_TOOLTIP_AUTO_DISMISS_MS = 10000;
    let gppTooltipHideTimer = null;
    function gppShowTooltip(text, clientX, clientY) {
        const el = gppEnsureTooltipEl();
        const wasHidden = el.style.display !== 'block';
        el.textContent = text;
        el.style.display = 'block';
        const margin = 14;
        // Estimated against the CSS max-width/typical single-line height
        // rather than a live getBoundingClientRect() read, so this stays a
        // synchronous, layout-thrash-free calculation even on frequent
        // mousemove — good enough to keep the tooltip from running off the
        // viewport edge without forcing a layout every pointer tick.
        const estWidth = 240, estHeight = 44;
        let left = clientX + margin;
        let top = clientY + margin;
        if (left + estWidth > window.innerWidth) left = clientX - estWidth - margin;
        if (top + estHeight > window.innerHeight) top = clientY - estHeight - margin;
        el.style.left = Math.max(4, left) + 'px';
        el.style.top = Math.max(4, top) + 'px';
        if (wasHidden) {
            clearTimeout(gppTooltipHideTimer);
            gppTooltipHideTimer = setTimeout(gppHideTooltip, GPP_TOOLTIP_AUTO_DISMISS_MS);
        }
    }
    function gppHideTooltip() {
        if (gppTooltipEl) gppTooltipEl.style.display = 'none';
        clearTimeout(gppTooltipHideTimer);
        gppTooltipHideTimer = null;
    }
    // Strips any existing native `title` (kept in a handful of places as an
    // authoring fallback), including on descendants — a caller commonly
    // attaches this to a wrapping row/label while the original title was
    // authored on a more deeply nested child (e.g. the slider input
    // itself); leaving that in place would stack a native browser tooltip
    // on top of this custom one on hover (a real bug found exactly this
    // way in gpp-view-settings.js's Cell Fill row).
    function gppStripNativeTitles(element) {
        if (!element) return;
        element.removeAttribute('title');
        if (typeof element.querySelectorAll === 'function') {
            element.querySelectorAll('[title]').forEach(node => node.removeAttribute('title'));
        }
    }
    // Call once per setting at build time.
    //   hoverElement — shows the tooltip on mouse hover. Per explicit user
    //     feedback, this must be the TEXT description only (a label/span),
    //     never the checkbox or slider itself — hovering the control alone
    //     should not pop a tooltip.
    //   text — the tooltip's own content.
    //   focusElement — optional; shows the SAME tooltip on keyboard focus.
    //     Defaults to hoverElement when omitted. Pass the actual checkbox/
    //     slider input here when hoverElement is a separate text label, so
    //     keyboard users tabbing through controls (which focuses the INPUT,
    //     never a plain text span) still get the same contextual help
    //     mouse users see on hover — the hover-only restriction above is
    //     specifically a mouse-hover-target scoping choice, not an intent
    //     to drop keyboard accessibility.
    function gppAttachTooltip(hoverElement, text, focusElement) {
        if (!hoverElement || !text) return;
        gppStripNativeTitles(hoverElement);
        hoverElement.addEventListener('mouseenter', event => gppShowTooltip(text, event.clientX, event.clientY));
        hoverElement.addEventListener('mousemove', event => gppShowTooltip(text, event.clientX, event.clientY));
        hoverElement.addEventListener('mouseleave', gppHideTooltip);
        const target = focusElement || hoverElement;
        gppStripNativeTitles(target);
        target.addEventListener('focus', () => {
            // Real reported bug: clicking a checkbox, or starting to drag a
            // slider, gives that control keyboard focus as a native side
            // effect of the mouse interaction -- which fired this SAME
            // 'focus' handler and popped the tooltip even though the
            // mouseenter/mousemove listeners above (scoped to the text
            // label only) correctly never did. :focus-visible is the
            // browser's own heuristic for "should this focus be visibly
            // indicated" -- true for real keyboard navigation (Tab), false
            // for a mouse click/drag-start -- exactly the distinction
            // needed to keep the tooltip working for keyboard users while
            // never appearing from a mouse interaction with the control
            // itself, matching the same restriction already applied to
            // hover above.
            if (typeof target.matches === 'function' && !target.matches(':focus-visible')) return;
            const rect = target.getBoundingClientRect();
            gppShowTooltip(text, rect.left, rect.bottom + 4);
        });
        target.addEventListener('blur', gppHideTooltip);
    }

    // `loadGhostImageBtn` ("Overlay Image") lives inside `#imageGroupDropdown`
    // alongside `toggleDitherer` (Pixelate Image) and, when the legacy Ghost
    // Palette Search feature is active, `gpc-sync-ghost-btn`. Per explicit
    // clarification, the opener belongs INSIDE that dropdown too — as a
    // sibling of those buttons, positioned right after the div wrapping
    // loadGhostImageBtn — not out in the always-visible toolbar row (an
    // earlier attempt moved it there and got the placement wrong).
    // Assumes exactly one call site (gpp-init.js's own readyState-gated
    // startup) — it creates a fresh #gpp-opener unconditionally, so a
    // second call would produce a visible duplicate button. Not guarded
    // against here since there is only ever the one call site today.
    function gppReplaceNativeOpener(onOpen) {
        const opener = document.createElement('button');
        opener.type = 'button';
        opener.id = GPP_IDS.opener;
        opener.title = 'Ghost++ template overlay';
        opener.setAttribute('aria-label', 'Open Ghost++');
        opener.textContent = '👻';
        // Match the native icon buttons' own classes exactly (they carry no
        // dark: variant themselves — these floating toolbar icons render the
        // same in both themes on this site) rather than custom CSS, so the
        // new button is visually indistinguishable from its siblings.
        opener.className = 'w-10 h-10 bg-white shadow rounded-full flex items-center justify-center hover:bg-gray-100 cursor-pointer';
        opener.style.fontSize = '16px';
        opener.addEventListener('click', onOpen);

        const refs = { opener, native: null };

        function attach(native) {
            refs.native = native;
            native.style.display = 'none';
            // The site's own Tailwind "hidden" convention (see e.g. Janitor
            // View's "removes the hidden class" pattern) AND a pre-emptive
            // 'data-gpc-pill' marker — ext-pill-hover-labels.js (the Hover
            // Labels extension, default-on) re-scans #controls-left on every
            // DOM mutation (including this very insertion below) and
            // explicitly sets style.display='flex' on any of its target
            // buttons that lacks the .hidden class, reviving a plain inline-
            // style hide. 'data-gpc-pill' is that feature's own "already
            // processed" marker (its PROCESSED_ATTR) — setting it here short-
            // circuits its transformButton() before it ever touches this
            // button's display style, regardless of the .hidden class too.
            native.classList.add('hidden');
            native.setAttribute('data-gpc-pill', '1');
            // Sibling of loadGhostImageBtn (and toggleDitherer) in the same
            // toolbar row, right below loadGhostImageBtn — per explicit user
            // correction, NOT a sibling of some enclosing wrapper div.
            if (native.parentElement) {
                native.insertAdjacentElement('afterend', opener);
            } else if (!opener.isConnected) {
                document.body.appendChild(opener);
            }
            // Hiding the native button alone does NOT stop it from firing —
            // display:none doesn't block a programmatic .click() (e.g. the
            // site's own keyboard-shortcut handler, performShortcutAction's
            // 'ghost' case, calls loadGhostImageBtn?.click() directly), and
            // that would still pop the native ghost modal even though
            // Ghost++'s own opener is right there. gppShimEnable() (which
            // installs the click-blocking capture for exactly this button)
            // used to only run lazily on the user's FIRST manual open of
            // Ghost++ (via ensureRuntime()) — leaving a real window, before
            // that first open, where a keyboard shortcut (or anything else
            // that calls .click() on the hidden button) still summoned the
            // old native UI. A user's own exported debug log showed init
            // completing successfully (native button found, opener mounted)
            // yet them still reporting "still don't see the menu" — this is
            // the gap that explained it. gppShimEnable() is idempotent
            // (guarded by gppShimActive) and every one of its pieces
            // (native function patching, control-capture installation,
            // snapshot/mirror reads) only touches page-realm globals and
            // gppState's own already-safe-when-empty accessors — none of it
            // needs gppInitRuntime() to have resolved first — so it's safe
            // to run right here, the moment the native button is confirmed
            // to exist, instead of waiting for the modal's first open.
            if (typeof gppShimEnable === 'function') {
                gppShimEnable();
                dbgPush('Ghost++ opener/native-button: native-control click captures installed immediately (blocks the hidden native ghost button from still opening the old UI via a keyboard shortcut or other programmatic click, before the user has ever opened Ghost++ once).', { uiComponent: 'Ghost++ Template Overlay' });
            }
        }

        const native = document.getElementById('loadGhostImageBtn');
        if (native) {
            dbgPush('Ghost++ opener/native-button: #loadGhostImageBtn found on the first synchronous check — replaced immediately.', { uiComponent: 'Ghost++ Template Overlay' });
            attach(native);
        } else {
            // The native toolbar button may not exist yet if Ghost++'s own init
            // runs before the site's own JS has finished mounting it -- a
            // client-rendered element, not guaranteed present merely because
            // DOMContentLoaded already fired. User-reported (Firefox) as
            // 'toggled Ghost++ on, still see the old menu': without this,
            // the fully-functional native button silently stayed untouched
            // and clickable, and this opener button landed at document.body
            // instead of the toolbar, unnoticed. Watch for it to actually
            // appear instead of giving up after one synchronous check.
            dbgPush('Ghost++ opener/native-button: #loadGhostImageBtn NOT found on the first synchronous check — this is the exact condition behind the reported "toggled Ghost++ on, still see the old menu" bug. Watching for it to appear instead of giving up.', { uiComponent: 'Ghost++ Template Overlay' });
            const watchStartedAt = Date.now();
            document.body.appendChild(opener); // visible in the meantime, better than nothing
            const watchRoot = document.getElementById('controls-left') || document.body;
            const observer = new MutationObserver(() => {
                const found = document.getElementById('loadGhostImageBtn');
                if (!found) return;
                observer.disconnect();
                clearTimeout(giveUpTimer);
                dbgPush('Ghost++ opener/native-button: #loadGhostImageBtn appeared ' + (Date.now() - watchStartedAt) + 'ms after Ghost++ started watching for it — replaced now.', { uiComponent: 'Ghost++ Template Overlay' });
                attach(found);
            });
            observer.observe(watchRoot, { childList: true, subtree: true });
            // 15s matches the same give-up duration ext-map-movement-lock.js
            // and ext-log-out-button.js already use for their own late-
            // mounting-element watchers, not an arbitrary pick.
            const giveUpTimer = setTimeout(() => {
                observer.disconnect();
                dbgPush('Ghost++ opener/native-button: gave up after 15s — #loadGhostImageBtn was never found. The native ghost tool will keep working alongside the Ghost++ button instead of being hidden.', { uiComponent: 'Ghost++ Template Overlay' });
                console.error('[GeoPixelcons++] Ghost++: never found the native #loadGhostImageBtn to replace -- it will keep working alongside the Ghost++ button instead of being hidden.');
            }, 15000);
        }

        return refs;
    }

    function gppRestoreNativeOpener(refs) {
        if (refs && refs.opener) refs.opener.remove();
        if (refs && refs.native) {
            refs.native.style.display = '';
            refs.native.classList.remove('hidden');
            refs.native.removeAttribute('data-gpc-pill');
        }
    }

    function gppBuildModalShell() {
        gppInjectShellStyle();
        const modal = document.createElement('div');
        modal.id = GPP_IDS.modal;
        modal.className = 'gpp-hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', 'Ghost++ template overlay manager');
        modal.innerHTML = `
            <div class="gpp-edge n" data-gpp-drag></div>
            <div class="gpp-edge s" data-gpp-drag></div>
            <div class="gpp-edge e" data-gpp-drag></div>
            <div class="gpp-edge w" data-gpp-drag></div>
            <div class="gpp-corner nw" data-gpp-resize="nw"></div>
            <div class="gpp-corner ne" data-gpp-resize="ne"></div>
            <div class="gpp-corner sw" data-gpp-resize="sw"></div>
            <div class="gpp-corner se" data-gpp-resize="se"></div>
            <div id="${GPP_IDS.left}">
                <div class="gpp-head" data-gpp-drag>
                    <strong class="gpp-head-title">Ghost++</strong>
                    <span id="${GPP_IDS.editingLabel}">
                        <span class="gpp-editing-name"></span>
                        <span class="gpp-editing-coords"></span>
                    </span>
                    <span class="gpp-spacer"></span>
                    <button type="button" data-gpp-action="minify" aria-label="Minified view" title="Compact view: Enable/Disable all, palette view, and the color grid">▭</button>
                    <button type="button" data-gpp-action="close" aria-label="Close">✕</button>
                </div>
                <div id="gpp-left-body" style="flex:1; overflow-y:auto;"></div>
            </div>
            <div id="${GPP_IDS.right}">
                <div class="gpp-panel-splitter" data-gpp-splitter title="Drag to resize"></div>
                <div style="display:flex; align-items:center; padding:6px 8px; gap:6px;">
                    <button type="button" class="gpp-collapse-btn" data-gpp-action="toggle-right" title="Collapse">◀</button>
                    <span class="gpp-muted" style="font-size:11px;">Preview &amp; library</span>
                </div>
                <div id="${GPP_IDS.rightContent}"></div>
            </div>
        `;
        document.body.appendChild(modal);
        gppWireModalDrag(modal);
        gppWireModalResize(modal);
        gppWirePanelSplitter(modal);
        const constrainToViewport = () => {
            if (modal.classList.contains('gpp-hidden')) return;
            requestAnimationFrame(() => {
                if (document.body.contains(modal)) gppConstrainModalToViewport(modal);
            });
        };
        window.addEventListener('resize', constrainToViewport, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', constrainToViewport, { passive: true });
            window.visualViewport.addEventListener('scroll', constrainToViewport, { passive: true });
        }
        modal.addEventListener('transitionend', event => {
            if (event.target === modal && event.propertyName === 'width') {
                modal.classList.remove('gpp-modal-animating-width');
            }
        });
        modal.querySelector('[data-gpp-action="toggle-right"]').addEventListener('click', () => {
            const right = document.getElementById(GPP_IDS.right);
            const toggleBtn = modal.querySelector('[data-gpp-action="toggle-right"]');

            // ── Narrow-width full-panel swap ────────────────────────────
            // Per explicit user request: at a narrow modal width, this
            // button no longer partially collapses the right panel to a
            // 34px stub (which barely helps when the LEFT panel is already
            // cramped too); instead it swaps between showing the left panel
            // fully OR the right panel fully, one at a time. Decided fresh
            // on every click from the modal's CURRENT width (not a separate
            // persistent "mobile mode" setting -- Ghost++ has no such global
            // toggle), so resizing the modal narrower/wider between clicks
            // always gets the behaviour appropriate to its size AT THAT MOMENT.
            // GPP_NARROW_SWAP_MARGIN (not just the bare CSS min-width
            // itself): the split is already quite cramped somewhat above
            // the literal 480px floor, not only exactly at it.
            // modal.dataset.gppNarrowSwapActive is the authoritative signal
            // for "the LAST toggle-right interaction was narrow-swap mode"
            // -- right.classList.contains('gpp-collapsed') ALONE can't
            // disambiguate that from a genuine wide-mode partial collapse,
            // since narrow-swap's own "showing left" sub-state deliberately
            // REUSES the exact same .gpp-collapsed 34px-stub CSS rather than
            // inventing a second one (see below).
            //
            // Determine narrowness from the EXPANDED-state width, not
            // whatever the modal currently measures -- if the right panel
            // is presently in EITHER kind of collapsed/stub state (a wide-
            // mode PARTIAL collapse, the 320px-floored stub below, OR
            // narrow-swap's own "showing left" sub-state), that width can
            // itself dip below the narrow-swap threshold even though the
            // modal's TRUE (expanded) size is comfortably wide. Using the
            // raw current width here would misfire "isNarrow" on the very
            // next click (the intended "expand") right after a wide-mode
            // collapse, permanently trapping a wide modal in the wrong mode
            // instead of ever letting it toggle normally -- real bugs
            // caught by this file's own fixture tests. Reconstructs what
            // the width WOULD be if expanded from the same remembered left/
            // right widths the wide-mode expand branch below already relies
            // on -- only meaningful for a genuine wide-mode collapse, hence
            // gated on gppNarrowSwapActive being ABSENT.
            let widthForNarrowCheck = modal.offsetWidth;
            if (right.classList.contains('gpp-collapsed') && !modal.dataset.gppNarrowSwapActive) {
                const rememberedLeftWidth = parseInt(modal.dataset.gppLeftWidth, 10);
                const rememberedRightWidth = parseInt(modal.dataset.gppRightWidth, 10) || 280;
                if (Number.isFinite(rememberedLeftWidth)) {
                    widthForNarrowCheck = rememberedLeftWidth + rememberedRightWidth;
                }
            }
            const minWidth = parseFloat(getComputedStyle(modal).minWidth) || 480;
            const isNarrow = widthForNarrowCheck <= minWidth + GPP_NARROW_SWAP_MARGIN;
            if (isNarrow) {
                modal.dataset.gppNarrowSwapActive = '1';
                const showingFullRight = modal.classList.toggle('gpp-narrow-full-right');
                if (showingFullRight) {
                    // #${GPP_IDS.right} already carries a permanent
                    // `transition: width .15s ease` (see its own base rule),
                    // so growing 34px -> 100% here animates smoothly for
                    // free -- no extra animation class needed, unlike the
                    // wide-mode branch below (which resizes the OUTER modal,
                    // not just this inner panel).
                    right.classList.remove('gpp-collapsed');
                } else {
                    // Back to "showing left": reuse the exact same 34px-stub
                    // CSS the wide-mode partial collapse already uses below,
                    // rather than inventing a second stub width.
                    right.classList.add('gpp-collapsed');
                }
                toggleBtn.textContent = showingFullRight ? '▶' : '◀';
                toggleBtn.title = showingFullRight ? 'Show colors' : 'Show template list';
                return;
            }
            // Returning to a wide modal after being in narrow-swap mode
            // (either of its two sub-states) -- right's current
            // .gpp-collapsed (if set, from narrow-swap's own "showing left"
            // sub-state) does NOT represent a genuine wide-mode collapse.
            // Reset both markers so a freshly-wide modal always starts
            // un-collapsed, rather than inheriting stale narrow-swap state
            // that would otherwise fight the wide-mode logic below (which
            // assumes #${GPP_IDS.left} is never display:none, and that
            // .gpp-collapsed always means a genuine wide-mode collapse).
            if (modal.dataset.gppNarrowSwapActive) {
                delete modal.dataset.gppNarrowSwapActive;
                modal.classList.remove('gpp-narrow-full-right');
                right.classList.remove('gpp-collapsed');
            }

            // Ports ghost-template-manager.js's own .gpc-panel-splitter
            // collapse behaviour (see gppWirePanelSplitter below) up to the
            // whole-modal level: shrink gpp-modal's own width by the same
            // amount right shrinks by, so no empty gap is left where right
            // used to sit — merely freezing left's width (an earlier, now-
            // superseded fix) only stopped left from swallowing that space,
            // it didn't reclaim it.
            //
            // On EXPAND, derive the target from the modal's CURRENT
            // (collapsed) width rather than blindly restoring a remembered
            // total — that earlier approach snapped back to a stale size
            // whenever the user resized the modal (drag a corner/edge)
            // WHILE it was collapsed, ignoring that resize entirely. Instead,
            // treat "current collapsed width minus the 34px stub" as the
            // left panel's live width (exactly GTM's own leftW = currentW -
            // 34) and add back only the right panel's remembered width.
            modal.classList.add('gpp-modal-animating-width');
            // Chromium normally emits transitionend for the width change.
            // Keep a guarded fallback for hidden/background tabs and embedded
            // browsers that suppress that event; otherwise the temporary
            // class could remain forever and block the next panel toggle.
            const widthTransitionToken = String((Number(modal.dataset.gppWidthTransitionToken) || 0) + 1);
            modal.dataset.gppWidthTransitionToken = widthTransitionToken;
            setTimeout(() => {
                if (modal.dataset.gppWidthTransitionToken === widthTransitionToken) {
                    modal.classList.remove('gpp-modal-animating-width');
                }
            }, 300);
            // Prefer the LOGICAL width this code (or the panel splitter's
            // own drag handler) last explicitly set, over offsetWidth --
            // both the modal (gated behind .gpp-modal-animating-width,
            // which stays present until its transition genuinely finishes)
            // and #${GPP_IDS.right} (which has an UNCONDITIONAL width
            // transition on its own base rule, not gated behind any temp
            // class) can still be mid-transition the instant this handler
            // runs again -- offsetWidth reflects whatever is CURRENTLY
            // rendered at that moment, not necessarily the settled target,
            // if this click follows very soon (machine-speed, not human-
            // paced) after the width was last set. parseFloat(...style.width)
            // reads back the exact value this code itself is driving toward,
            // sidestepping that ambiguity entirely; falls back to
            // offsetWidth only when there's no inline override yet (the
            // plain CSS default, a static value with no such risk).
            // offsetWidth (LAYOUT box), not getBoundingClientRect().width
            // (VISUAL box) either way -- View Settings' "Rescale Ghost++"
            // can apply a transform: scale() to the modal (gpp-ui-shell.js's
            // --gpp-scale), and every width computed below gets assigned
            // straight to modal.style.width, a layout property. Reading a
            // scaled visual width here and assigning it as if it were an
            // unscaled layout width would silently shrink/grow the modal by
            // an extra factor of the scale on every collapse/expand.
            const inlineModalWidth = parseFloat(modal.style.width);
            const currentModalWidth = Number.isFinite(inlineModalWidth) ? inlineModalWidth : modal.offsetWidth;
            const willCollapse = !right.classList.contains('gpp-collapsed');
            if (willCollapse) {
                const inlineRightWidth = parseFloat(right.style.width);
                const rightWidth = Number.isFinite(inlineRightWidth) ? inlineRightWidth : right.offsetWidth;
                if (rightWidth > 38) modal.dataset.gppRightWidth = rightWidth + 'px';
                // True left width BEFORE the 320px floor below can inflate it
                // -- see the REGRESSION note in the else branch for why this
                // matters. Captured now since it can no longer be recovered
                // once the floor has (maybe) kicked in.
                const trueLeftWidth = currentModalWidth - rightWidth;
                modal.dataset.gppLeftWidth = trueLeftWidth + 'px';
                const collapsedWidth = Math.max(320, trueLeftWidth + 34);
                modal.style.width = collapsedWidth + 'px';
                // Baseline to diff against on expand, so a resize WHILE
                // collapsed (dragging a corner/edge with the right panel
                // hidden) is still honoured -- see the else branch below.
                modal.dataset.gppCollapsedWidthAtCollapse = collapsedWidth + 'px';
            } else {
                // REGRESSION FIX (narrow/mobile widths): this used to derive
                // leftWidth as "current (collapsed) modal width minus 34",
                // which is only correct when the 320px floor above never
                // kicked in. On a narrow modal (e.g. resized down toward its
                // 480px minimum, as reported on a narrow/mobile screen,
                // where the left panel's true width can be well under
                // 286px), the floor DOES kick in and inflates the collapsed
                // modal wider than the left content actually needs --
                // deriving leftWidth from that already-inflated width
                // compounded the error, expanding the modal WIDER on
                // re-expand than it was before collapsing (visibly growing
                // off the right edge of a narrow screen instead of
                // restoring the exact prior size). Fixed by remembering the
                // TRUE left width captured before any floor clamp
                // (gppLeftWidth, set in the `if` branch above), then
                // applying only the DELTA from any resize that happened
                // while collapsed (comparing the modal's width now against
                // its own width right after collapsing) -- so a resize-
                // while-collapsed is still honoured exactly as the original
                // design intended, without the floor's inflation leaking
                // into the math.
                const rememberedLeftWidth = parseInt(modal.dataset.gppLeftWidth, 10);
                const collapsedWidthAtCollapse = parseInt(modal.dataset.gppCollapsedWidthAtCollapse, 10);
                const resizeDelta = Number.isFinite(collapsedWidthAtCollapse)
                    ? currentModalWidth - collapsedWidthAtCollapse
                    : 0;
                const leftWidth = Number.isFinite(rememberedLeftWidth)
                    ? rememberedLeftWidth + resizeDelta
                    : currentModalWidth - 34; // fallback -- should not happen in practice, matches the old (buggy) derivation
                const rememberedRightWidth = parseInt(modal.dataset.gppRightWidth, 10) || 280;
                modal.style.width = Math.max(480, leftWidth + rememberedRightWidth) + 'px';
            }
            const collapsed = right.classList.toggle('gpp-collapsed');
            // gppWirePanelSplitter's drag handler sets an INLINE width style,
            // which (inline always outranks a stylesheet class rule) silently
            // defeated the .gpp-collapsed rule's width:34px below the moment
            // the user had ever dragged the splitter — the content faded out
            // but the panel itself never actually shrank. Clear that inline
            // override on collapse (remembering it first) and restore it on
            // expand, rather than fighting it every time.
            if (collapsed) {
                if (right.style.width) right.dataset.gppExpandedWidth = right.style.width;
                right.style.width = '';
            } else if (right.dataset.gppExpandedWidth) {
                right.style.width = right.dataset.gppExpandedWidth;
            }
            modal.querySelector('[data-gpp-action="toggle-right"]').textContent = collapsed ? '▶' : '◀';
            modal.querySelector('[data-gpp-action="toggle-right"]').title = collapsed ? 'Expand' : 'Collapse';
        });

        // ── Minified view ───────────────────────────────────────────────
        // Per explicit user feedback ("i reeeally dont like how much bigger
        // the box is now" / "would it be possible to make it collapsible...
        // or at least some type of minified view with only what you need to
        // paint"): a compact mode showing ONLY the Enable all/Disable all
        // buttons, the palette Grid/List control, and the color grid
        // (height-capped to ~2 rows, scrollable)
        // -- everything else (ingest, Progress, Error Settings, View
        // Settings, Template Settings, the whole right panel/library) is
        // hidden via the .gpp-minified CSS below. Pure CSS toggle, not a
        // separate render path -- the real sections stay mounted and fully
        // functional underneath, so leaving minified view shows exactly
        // where you left off with no re-render needed. Session-only (not
        // persisted to gppSettings), matching the right panel's own
        // collapse/expand state -- the modal DOM node persists across
        // close/reopen within one page load either way (see open()'s own
        // comment in gpp-init.js), so it still "remembers" until reload.
        // Cross-fades the swap into/out of minified view instead of an
        // instant layout snap, per explicit user feedback ("any way to
        // animate into that view to make it look more interactive"). Opacity
        // only, deliberately NOT a width/height resize animation: the real
        // target size for .gpp-minified content is dynamic (grid row count,
        // future content) and would need fragile JS measurement to animate
        // correctly to/from CSS's un-transitionable "auto", AND the modal's
        // `transform: scale(var(--gpp-scale, 1))` (View Settings' "Rescale
        // Ghost++") already owns the transform property -- layering a second
        // animated transform on the same property for this would conflict
        // with it. A brief fade-to-low-opacity, instant layout swap while
        // faded, fade-back-in reads as a real, deliberate transition without
        // either risk. transitionend-driven (not a guessed setTimeout
        // duration) so it can't drift out of sync with the CSS duration
        // below, matching this file's own .gpp-modal-animating-width
        // cleanup pattern.
        function gppRunMinifyTransition() {
            // Re-entrancy guard: a click while the fade is already running
            // would add a SECOND pair of transitionend listeners racing the
            // first, toggling .gpp-minified an extra, unwanted time. Simply
            // ignored rather than queued -- a rapid double-click is
            // realistically just an impatient single click.
            if (modal.classList.contains('gpp-minify-transitioning')) return;
            const btn = modal.querySelector('[data-gpp-action="minify"]');
            modal.classList.add('gpp-minify-transitioning');
            void modal.offsetHeight; // force the browser to commit the current (opacity:1) frame before the change below, or the transition may have nothing to animate from
            modal.style.opacity = '0.25';
            const onFadeOut = event => {
                if (event.target !== modal || event.propertyName !== 'opacity') return;
                modal.removeEventListener('transitionend', onFadeOut);
                const minified = modal.classList.toggle('gpp-minified'); // the actual (instant) layout swap, now hidden by the low opacity above
                if (typeof gppConstrainModalToViewport === 'function') gppConstrainModalToViewport(modal);
                if (typeof gppRefreshPaletteViewMode === 'function') gppRefreshPaletteViewMode();
                btn.title = minified ? 'Exit compact view' : 'Compact view: Enable/Disable all, palette view, and the color grid';
                btn.setAttribute('aria-label', minified ? 'Exit minified view' : 'Minified view');
                modal.style.opacity = '1';
                const onFadeIn = event2 => {
                    if (event2.target !== modal || event2.propertyName !== 'opacity') return;
                    modal.removeEventListener('transitionend', onFadeIn);
                    modal.classList.remove('gpp-minify-transitioning');
                    modal.style.opacity = '';
                };
                modal.addEventListener('transitionend', onFadeIn);
            };
            modal.addEventListener('transitionend', onFadeOut);
        }
        modal.querySelector('[data-gpp-action="minify"]').addEventListener('click', gppRunMinifyTransition);

        // ── Keyboard-shortcut focus-steal fix ───────────────────────────
        // Real reported bug: dragging any Ghost++ range slider (Cell Fill,
        // Opacity, Error Opacity/Size, ...) leaves the browser's keyboard
        // focus sitting on that <input> afterward -- standard behaviour for
        // range inputs, but it silently breaks every native GeoPixels
        // keyboard shortcut (I, Y, P, spacebar, G, ...) until the user
        // clicks elsewhere, since the native site's own shortcut handler
        // skips processing while a form control is focused (so normal
        // typing isn't hijacked) and has no way to know THIS particular
        // slider is done being interacted with. Blurring the slider the
        // moment its value change COMMITS (the 'change' event -- fires once
        // per drag, on release/keyup, unlike 'input' which fires
        // continuously mid-drag and would fight the drag itself) hands
        // focus back to the page immediately, with no click-away needed.
        // Delegated on the modal ('change' bubbles) so it covers every
        // current and future range input inside Ghost++ from one place,
        // instead of each slider needing its own blur call.
        modal.addEventListener('change', event => {
            if (event.target && event.target.tagName === 'INPUT' && event.target.type === 'range') {
                event.target.blur();
            }
        });
        return modal;
    }

    // Ports ghost-template-manager.js's .gpc-panel-splitter behaviour exactly:
    // an 8px strip straddling the right panel's left border, drag-left widens
    // the right panel, clamped to 5%-95% of the MODAL's width (not the right
    // panel's own width).
    function gppWirePanelSplitter(modal) {
        const splitter = modal.querySelector('[data-gpp-splitter]');
        const right = document.getElementById(GPP_IDS.right);
        splitter.addEventListener('pointerdown', event => {
            if (!gppIsPrimaryModalPointer(event) || right.classList.contains('gpp-collapsed')) return;
            event.preventDefault();
            event.stopPropagation();
            const startX = event.clientX;
            // offsetWidth (layout box), not getBoundingClientRect().width
            // (visual box) -- see gppWireModalResize's own comment on why
            // this distinction matters once --gpp-scale can be non-1.
            const startW = right.offsetWidth;
            const scale = gppReadModalScale(modal);
            right.style.transition = 'none';
            splitter.classList.add('gpp-ps-dragging');
            try { splitter.setPointerCapture(event.pointerId); } catch (_) { /* synthetic events may not have an active pointer */ }
            const onMove = ev => {
                ev.preventDefault();
                const delta = (startX - ev.clientX) / scale; // drag left = wider right panel; raw screen-pixel delta -> layout-pixel delta
                const modalW = modal.offsetWidth;
                const minW = Math.max(34, Math.floor(modalW * 0.05));
                const maxW = Math.max(minW, Math.floor(modalW * 0.95));
                const newW = Math.min(Math.max(minW, startW + delta), maxW);
                right.style.width = newW + 'px';
            };
            const onUp = () => {
                splitter.classList.remove('gpp-ps-dragging');
                right.style.transition = '';
                splitter.removeEventListener('pointermove', onMove);
                splitter.removeEventListener('pointerup', onUp);
            };
            splitter.addEventListener('pointermove', onMove);
            splitter.addEventListener('pointerup', onUp);
            splitter.addEventListener('pointercancel', onUp);
        });
    }

    // Drag (move) is wired to the header AND all 4 edges — grabbing any edge
    // moves the whole modal, matching the explicit "draggable on all edges"
    // requirement. Resize is corners-only (see gppWireModalResize) — edges
    // deliberately do not resize.
    function gppWireModalDrag(modal) {
        modal.querySelectorAll('[data-gpp-drag]').forEach(handle => {
            let drag = null;
            handle.addEventListener('pointerdown', event => {
                if (!gppIsPrimaryModalPointer(event) || event.target.closest('button')) return;
                event.preventDefault();
                const rect = modal.getBoundingClientRect();
                drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
                // A real pointerdown has an active pointer to capture. Some
                // embedders and synthetic regression events do not; resize
                // still works without capture because the handlers are
                // attached to this handle, so treat capture as best-effort.
                try { handle.setPointerCapture(event.pointerId); } catch (_) { /* no active pointer to capture */ }
                event.stopPropagation();
            });
            handle.addEventListener('pointermove', event => {
                if (!drag || drag.id !== event.pointerId) return;
                event.preventDefault();
                gppClampModalPosition(modal, event.clientX - drag.dx, event.clientY - drag.dy);
                modal.style.right = 'auto';
            });
            const finishDrag = event => { if (drag && drag.id === event.pointerId) drag = null; };
            handle.addEventListener('pointerup', finishDrag);
            handle.addEventListener('pointercancel', finishDrag);
        });
    }

    // Corners only — each `data-gpp-resize` value encodes which two sides
    // move (nw/ne/sw/se), so a single pointer handler covers all 4.
    // Reads the live transform: scale() factor View Settings' "Rescale
    // Ghost++" slider (gpp-view-settings.js) applies to the modal via the
    // --gpp-scale custom property. Falls back to 1 when never set (the
    // property's own computed value is then an empty string, not "1" --
    // var()'s fallback only kicks in where the property is actually
    // consumed, e.g. inside `transform: scale(var(--gpp-scale, 1))`, not
    // when reading the custom property back out directly).
    function gppReadModalScale(modal) {
        const raw = getComputedStyle(modal).getPropertyValue('--gpp-scale');
        const parsed = parseFloat(raw);
        return (Number.isFinite(parsed) && parsed > 0) ? parsed : 1;
    }

    const GPP_COMPACT_MIN_WIDTH = 180;
    const GPP_COMPACT_MIN_HEIGHT = 72;
    const GPP_VIEWPORT_MARGIN = 8;

    // Mouse pointerdown uses button 0 for the primary button. Touch and pen
    // pointerdown may use -1 because no mouse button changed; rejecting that
    // value makes the entire modal look non-draggable/non-resizable on phones.
    function gppIsPrimaryModalPointer(event) {
        // Older/synthetic PointerEvent constructors leave pointerType empty
        // and isPrimary false even for the only pointer in the test. Real
        // touch/pen events identify their type, so only reject a non-primary
        // event when that type signal is present.
        if (!event || (event.isPrimary === false && event.pointerType)) return false;
        const pointerType = event.pointerType || 'mouse';
        return pointerType === 'mouse' ? event.button === 0 : (event.button === 0 || event.button === -1);
    }

    function gppVisibleViewport() {
        const visual = window.visualViewport;
        const width = visual && Number.isFinite(visual.width) ? visual.width : window.innerWidth;
        const height = visual && Number.isFinite(visual.height) ? visual.height : window.innerHeight;
        return {
            width: Number.isFinite(width) && width > 0 ? width : 1200,
            height: Number.isFinite(height) && height > 0 ? height : 900,
        };
    }

    function gppModalLayoutDimension(modal, axis) {
        const scale = gppReadModalScale(modal);
        const rect = modal.getBoundingClientRect();
        const layout = axis === 'width' ? modal.offsetWidth : modal.offsetHeight;
        const visual = axis === 'width' ? rect.width : rect.height;
        return (Number.isFinite(layout) && layout > 0) ? layout
            : ((Number.isFinite(visual) && visual > 0) ? visual / scale : 1);
    }

    function gppModalViewportLimit(modal, axis, fixedPosition) {
        const viewport = gppVisibleViewport();
        const positionProperty = axis === 'width' ? 'left' : 'top';
        const rawPosition = fixedPosition === undefined
            ? parseFloat(getComputedStyle(modal).getPropertyValue(positionProperty))
            : Number(fixedPosition);
        const position = Number.isFinite(rawPosition) ? Math.max(GPP_VIEWPORT_MARGIN, rawPosition) : GPP_VIEWPORT_MARGIN;
        const scale = gppReadModalScale(modal);
        const available = (viewport[axis] - position - GPP_VIEWPORT_MARGIN) / scale;
        return Math.max(1, available);
    }

    function gppClampModalPosition(modal, left, top) {
        const viewport = gppVisibleViewport();
        const scale = gppReadModalScale(modal);
        const visualWidth = gppModalLayoutDimension(modal, 'width') * scale;
        const visualHeight = gppModalLayoutDimension(modal, 'height') * scale;
        const maxLeft = Math.max(GPP_VIEWPORT_MARGIN, viewport.width - visualWidth - GPP_VIEWPORT_MARGIN);
        const maxTop = Math.max(GPP_VIEWPORT_MARGIN, viewport.height - visualHeight - GPP_VIEWPORT_MARGIN);
        const requestedLeft = Number(left);
        const requestedTop = Number(top);
        modal.style.left = Math.min(maxLeft, Math.max(GPP_VIEWPORT_MARGIN,
            Number.isFinite(requestedLeft) ? requestedLeft : GPP_VIEWPORT_MARGIN)) + 'px';
        modal.style.top = Math.min(maxTop, Math.max(GPP_VIEWPORT_MARGIN,
            Number.isFinite(requestedTop) ? requestedTop : GPP_VIEWPORT_MARGIN)) + 'px';
    }

    function gppClampModalDimension(value, min, max) {
        const upper = Math.max(1, Number(max));
        const lower = Math.min(min, upper);
        return Math.min(upper, Math.max(lower, Number(value)));
    }

    function gppConstrainModalToViewport(modal) {
        if (!modal || modal.classList.contains('gpp-hidden')) return;
        gppClampModalPosition(modal, parseFloat(modal.style.left), parseFloat(modal.style.top));
        if (modal.classList.contains('gpp-minified')) {
            gppApplyCompactSize(modal);
        } else {
            const maxWidth = gppModalViewportLimit(modal, 'width');
            const maxHeight = gppModalViewportLimit(modal, 'height');
            const width = gppModalLayoutDimension(modal, 'width');
            const height = gppModalLayoutDimension(modal, 'height');
            if (width > maxWidth) modal.style.width = maxWidth + 'px';
            if (height > maxHeight) modal.style.height = maxHeight + 'px';
        }
        gppClampModalPosition(modal, parseFloat(modal.style.left), parseFloat(modal.style.top));
    }

    function gppCompactViewportLimit(modal, axis) {
        return gppModalViewportLimit(modal, axis);
    }

    function gppClampCompactDimension(value, fallback, min, max) {
        const parsed = Number(value);
        const safeMax = Math.max(1, Number(max));
        const safeMin = Math.min(min, safeMax);
        const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : safeMin;
        return Number.isFinite(parsed) ? Math.min(safeMax, Math.max(safeMin, parsed))
            : Math.min(safeMax, Math.max(safeMin, safeFallback));
    }

    function gppApplyCompactSize(modal) {
        const width = gppClampCompactDimension(
            gppSettings.compactWidth,
            260,
            GPP_COMPACT_MIN_WIDTH,
            gppCompactViewportLimit(modal, 'width'),
        );
        modal.style.setProperty('--gpp-compact-width', `${width}px`);
        if (typeof gppSettings.compactHeight === 'number' && Number.isFinite(gppSettings.compactHeight)) {
            const height = gppClampCompactDimension(
                gppSettings.compactHeight,
                160,
                GPP_COMPACT_MIN_HEIGHT,
                gppCompactViewportLimit(modal, 'height'),
            );
            modal.style.setProperty('--gpp-compact-height', `${height}px`);
        } else {
            modal.style.removeProperty('--gpp-compact-height');
        }
    }

    function gppPersistCompactSize(modal) {
        if (!modal.classList.contains('gpp-minified')) return;
        const widthStyle = parseFloat(modal.style.getPropertyValue('--gpp-compact-width'));
        const heightStyle = parseFloat(modal.style.getPropertyValue('--gpp-compact-height'));
        const width = gppClampCompactDimension(
            widthStyle,
            260,
            GPP_COMPACT_MIN_WIDTH,
            gppCompactViewportLimit(modal, 'width'),
        );
        const heightFallback = modal.offsetHeight > 0 ? modal.offsetHeight : 120;
        const height = gppClampCompactDimension(
            heightStyle,
            heightFallback,
            GPP_COMPACT_MIN_HEIGHT,
            gppCompactViewportLimit(modal, 'height'),
        );
        gppSettings.compactWidth = width;
        gppSettings.compactHeight = height;
        gppState.saveSettings();
    }

    function gppWireModalResize(modal) {
        modal.querySelectorAll('[data-gpp-resize]').forEach(handle => {
            const sides = handle.dataset.gppResize;
            let drag = null;
            handle.addEventListener('pointerdown', event => {
                if (!gppIsPrimaryModalPointer(event)) return;
                event.preventDefault();
                const rect = modal.getBoundingClientRect(); // left/top only -- transform-origin: top left keeps these the same in layout and visual space regardless of scale
                const compact = modal.classList.contains('gpp-minified');
                drag = {
                    id: event.pointerId, startX: event.clientX, startY: event.clientY, rect,
                    // offsetWidth/Height are the LAYOUT (pre-transform) box
                    // -- unlike getBoundingClientRect(), unaffected by
                    // --gpp-scale. modal.style.width/height must be set in
                    // these same layout units, or resizing while scaled
                    // would jump to the wrong size the instant a drag
                    // starts (mixing a scaled "visual" width with an
                    // unscaled layout property).
                    layoutWidth: modal.offsetWidth, layoutHeight: modal.offsetHeight,
                    scale: gppReadModalScale(modal),
                    compact,
                };
                // Pointer capture is best-effort: synthetic events and a few
                // embedded browser contexts have no active pointer to capture.
                try { handle.setPointerCapture(event.pointerId); } catch (_) { /* no active pointer to capture */ }
                event.stopPropagation();
            });
            handle.addEventListener('pointermove', event => {
                if (!drag || drag.id !== event.pointerId) return;
                event.preventDefault();
                // Raw screen-pixel cursor delta -> layout-pixel delta: 1
                // real screen pixel of drag must produce 1 VISUAL pixel of
                // size change to track the cursor exactly, which means
                // layout-pixel-change = screen-pixel-delta / scale (since
                // visual = layout * scale). Without this, resizing at any
                // scale other than 100% drifted away from the cursor.
                const dx = (event.clientX - drag.startX) / drag.scale;
                const dy = (event.clientY - drag.startY) / drag.scale;
                const minW = drag.compact ? GPP_COMPACT_MIN_WIDTH : 480;
                const minH = drag.compact ? GPP_COMPACT_MIN_HEIGHT : 320;
                const setWidth = width => {
                    if (drag.compact) modal.style.setProperty('--gpp-compact-width', width + 'px');
                    else modal.style.width = width + 'px';
                };
                const setHeight = height => {
                    if (drag.compact) modal.style.setProperty('--gpp-compact-height', height + 'px');
                    else modal.style.height = height + 'px';
                };
                if (sides.includes('e')) {
                    const maxW = gppModalViewportLimit(modal, 'width');
                    setWidth(gppClampModalDimension(drag.layoutWidth + dx, minW, maxW));
                }
                if (sides.includes('s')) {
                    const maxH = gppModalViewportLimit(modal, 'height');
                    setHeight(gppClampModalDimension(drag.layoutHeight + dy, minH, maxH));
                }
                if (sides.includes('w')) {
                    const maxW = Math.min(
                        gppModalViewportLimit(modal, 'width'),
                        Math.max(1, (drag.rect.left + drag.rect.width - GPP_VIEWPORT_MARGIN) / drag.scale),
                    );
                    const width = gppClampModalDimension(drag.layoutWidth - dx, minW, maxW);
                    setWidth(width);
                    // Keep the visual right edge anchored under the cursor:
                    // the new VISUAL width is width * scale, not width.
                    modal.style.left = (drag.rect.left + drag.rect.width - width * drag.scale) + 'px';
                }
                if (sides.includes('n')) {
                    const maxH = Math.min(
                        gppModalViewportLimit(modal, 'height'),
                        Math.max(1, (drag.rect.top + drag.rect.height - GPP_VIEWPORT_MARGIN) / drag.scale),
                    );
                    const height = gppClampModalDimension(drag.layoutHeight - dy, minH, maxH);
                    setHeight(height);
                    modal.style.top = (drag.rect.top + drag.rect.height - height * drag.scale) + 'px';
                }
                gppClampModalPosition(modal, parseFloat(modal.style.left), parseFloat(modal.style.top));
            });
            const finishResize = event => {
                if (!drag || drag.id !== event.pointerId) return;
                if (drag.compact) gppPersistCompactSize(modal);
                drag = null;
            };
            handle.addEventListener('pointerup', finishResize);
            handle.addEventListener('pointercancel', finishResize);
        });
    }
