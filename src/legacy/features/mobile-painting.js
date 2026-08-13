
    // ============================================================
    //  EXTENSION: Mobile Painting [mobilePaintingExtension]
    // ============================================================
    // In-development extension. Implementation is intentionally being built
    // up in small, explicitly-requested increments -- do not add behavior
    // here beyond what has actually been asked for.
    if (_settings.mobilePaintingExtension) {
        try {
            (function _ext_mobilePainting() {

    const MP_STYLE_ID = 'gpc-mobile-painting-style';

    // Narrower than core.js's shared isDarkMode(): only the OTHER
    // "GeoPixels++" extension's own explicit theme selector counts here, not
    // body.dark or the OS-level prefers-color-scheme fallback isDarkMode()
    // also honors. See the .gpc-mobile-controls-row comment in injectStyle()
    // below for why -- #bottomControls' own wrapper never itself goes dark,
    // so an OS/body signal alone would make these buttons black against a
    // background that stays unconditionally white regardless.
    function isControlsRowDark() {
        try {
            const raw = localStorage.getItem('geo++_settings');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.theme && parsed.theme !== 'system') {
                    return parsed.theme === 'simple_black';
                }
            }
        } catch (e) {}
        return false;
    }
    function tc(light, dark) { return isControlsRowDark() ? dark : light; }

    // Reuses Ghost++'s own .gpp-palette-grid / .gpp-swatch / tooltip class
    // names and rules (see gpp-palette.js) so this looks and feels identical
    // to the real Ghost++ palette. Trimmed to just the grid + on/off swatch
    // state + hover tooltip -- no search/sort/filter/bulk-action CHROME,
    // since this renders inline in the compact bottom paint bar rather than
    // the full Ghost++ manager panel (the sort/filter EFFECTS themselves
    // still apply -- see computeVisibleOrder below -- just not their own
    // controls, which stay in the Ghost++ modal).
    // Called on every buildTemplatePaletteGrid() rebuild (resync()'s 1s
    // poll, every gppSubscribeUiRefresh() tick) -- NOT just once. This is
    // load-bearing for theme reactivity: tc()/t2() are read fresh into the
    // template literal below on every call, so re-running this is what
    // makes a live GeoPixels++ theme change (no page reload) actually show
    // up here, the same way every other themed surface in this codebase
    // (Ghost++'s own modal included) just re-reads isDarkMode()/t2() fresh
    // at its own next build/open rather than caching it. Previously this
    // function early-returned once the <style> tag already existed, which
    // silently froze every tc()/t2() color at whatever the theme happened
    // to be the very first time the palette grid ever rendered (typically
    // page load) -- the reported "buttons stayed light after switching
    // GeoPixels++ to dark" bug. Now it reuses the same tag but always
    // refreshes its content instead.
    function injectStyle() {
        let style = document.getElementById(MP_STYLE_ID);
        const isNew = !style;
        if (isNew) {
            style = document.createElement('style');
            style.id = MP_STYLE_ID;
        }
        style.textContent = `
            /* Row layout: the swatch grid takes the available width, and a
               small live preview of the focused template's ghost image
               (see .gpc-mobile-preview-frame below) sits to its right,
               sized to the grid's own height. */
            .gpc-mobile-palette-wrap { width: 100%; box-sizing: border-box; display: flex; flex-direction: row; align-items: stretch; gap: 6px; }
            /* Shown in .gpc-mobile-palette-wrap's place whenever no Ghost++
               template is focused -- see ensureNoTemplatePrompt's own
               comment for why this exists at all (without it, a user who
               hasn't focused a template yet has no way to reach placeholder
               mode -- its own trigger normally lives inside
               .gpc-mobile-palette-wrap, which doesn't exist without one). */
            .gpc-mobile-no-template-prompt {
                width: 100%; box-sizing: border-box; margin-bottom: 6px; padding: 10px;
                display: flex; align-items: center; justify-content: center;
                border: 1px dashed ${tc('#d1d5db', '#45475a')}; border-radius: 6px;
                color: ${tc('#64748b', '#a6adc8')}; font-size: 12px; cursor: pointer;
            }
            .gpc-mobile-no-template-prompt:hover {
                background: ${tc('#f3f4f6', '#313244')};
            }
            .gpp-palette-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(26px, 1fr));
                grid-auto-rows: minmax(26px, 1fr);
                /* 2 visible rows (26px + 3px gap, doubled, plus the grid's own
                   2px top/bottom padding) before scrolling -- same constant
                   Ghost++'s own minified mode uses for the identical shape
                   (see gpp-ui-shell.js's .gpp-minified .gpp-palette-grid). */
                gap: 3px; max-height: 60px; overflow-y: auto; padding: 2px;
                flex: 1 1 auto; min-width: 0; box-sizing: border-box;
                scrollbar-gutter: stable;
            }
            /* Small live preview of the focused template's own ghost image
               (same source gpp-lib-current-canvas-wrap uses in the real
               Ghost++ Library panel -- gppLibraryRenderFullCanvas -- not a
               separate lower-res thumbnail, so nothing about the image
               itself is downsampled/compressed).
               No explicit height here -- per explicit product decision, the
               frame should fill and center within whatever height the row
               actually ends up (now variable, since #gpc-mobile-palette-grid's
               own height depends on the "Visible rows" setting), via the
               row's own align-items:stretch. That can't be done with the
               canvas sized directly by the frame's flow the way it used to
               be, though: measured for real, a canvas using height:100% with
               NO explicit frame height creates a genuine circular
               dependency -- the frame's own pre-stretch hypothetical height
               (used to help decide how tall the ROW even is) would be
               computed FROM the canvas's own intrinsic pixel size (since a
               height:100% child can't resolve against an indeterminate
               auto-height parent, so browsers fall right back to the
               canvas's raw width/height attributes) -- confirmed this by
               measuring it directly: a realistic 500x300 canvas blew the
               entire row up to 300px tall instead of the ~80px the OTHER
               siblings actually need. Fixed by taking the canvas out of
               normal flow entirely (position:absolute, centered via
               top/left 50% + a translate) so it can no longer contribute to
               the frame's own hypothetical size at all -- the frame's
               (and so the row's) height is then decided purely by the OTHER
               siblings (the grid, the view-controls column), stretch gives
               the now-content-independent frame a real definite height, and
               ONLY THEN does the absolutely-positioned canvas's own
               max-width/max-height:100% resolve against that. Confirmed
               this actually breaks the cycle (not just look right once) by
               re-measuring the same 500x300 canvas afterward: row height
               came from the OTHER siblings as intended, canvas correctly
               shrank to fit within the resulting frame without distortion,
               and stayed correctly centered. max-width+max-height BOTH as
               caps (neither one fixed), same pattern already verified
               correct for the larger-preview modal's own canvas -- a
               DIFFERENT situation from this rule's own prior height:100%-
               only approach, which was deliberately avoiding max-width
               specifically because THAT combination (a FIXED height paired
               with max-width) measurably distorted the image; two caps
               together, with neither dimension fixed, doesn't have that
               problem. image-rendering: pixelated keeps pixel art crisp at
               a small display size instead of blurring it.
               Per explicit product decision, the frame should also be a
               SQUARE -- width matching whatever its own (now variable)
               height ends up. CSS aspect-ratio can't do this on its own
               here: flexbox resolves a row-direction item's main-axis size
               (width) BEFORE cross-axis stretch determines its height, so
               aspect-ratio (evaluated during that same earlier pass) has
               no stretched height yet to derive from -- confirmed this
               doesn't work by testing it directly (width stayed pinned at
               min-width regardless of how tall the row actually became).
               ensurePreviewFrameStaysSquare's ResizeObserver instead
               reacts AFTER layout has already resolved a real height, so
               there's nothing circular about reading it then and setting
               width to match. min-width here is now just the pre-first-
               observation fallback (that callback fires asynchronously,
               not synchronously on observe()), not the frame's normal
               resting width. */
            .gpc-mobile-preview-frame {
                position: relative;
                flex: 0 0 auto; min-width: 40px;
                overflow: hidden; box-sizing: border-box; cursor: pointer;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
                border-radius: 4px; background: ${t2('rgba(0,0,0,.03)', 'rgba(255,255,255,.05)')};
            }
            .gpc-mobile-preview-frame canvas {
                position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                max-width: 100%; max-height: 100%; width: auto; height: auto;
                display: block; image-rendering: pixelated;
            }
            /* Info icon, top-right corner of the preview frame -- opens the
               larger-preview modal (see openTemplatePreviewModal). A small
               semi-opaque backing circle so the glyph stays legible over
               any preview image color, light or dark alike -- not
               t2()/tc()-themed on purpose, same reasoning either way (dark
               translucent circle, white glyph) reads fine over both. Own
               click listener with stopPropagation -- sits inside the frame,
               which itself is the placeholder-mode toggle's click target
               (getTemplatePreviewCanvas), so a tap here must not ALSO
               trigger that. z-index:1 keeps it above the frame's own
               absolutely-positioned canvas. */
            .gpc-mobile-preview-info-btn {
                position: absolute; top: 2px; right: 2px; z-index: 1;
                width: 16px; height: 16px; padding: 0; border: none; border-radius: 50%;
                background: rgba(0,0,0,.55); color: #fff;
                display: flex; align-items: center; justify-content: center;
                font-size: 10px; line-height: 1; cursor: pointer;
            }
            .gpc-mobile-preview-info-btn:hover { background: rgba(0,0,0,.75); }
            /* Larger-preview modal (openTemplatePreviewModal) -- a genuine
               standalone overlay appended to document.body, NOT nested
               inside #bottomControls, so t2() (not tc()) is the CORRECT
               signal here, same as every other real modal in this codebase
               (Ghost++'s own, core.js's #gpc-settings-modal) -- tc() exists
               specifically to work around #bottomControls' own wrapper
               never going dark, which doesn't apply to a modal this file
               builds and positions itself. z-index matches core.js's own
               #gpc-settings-modal convention (100000). */
            .gpc-preview-modal-overlay {
                position: fixed; inset: 0; z-index: 100000;
                background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center;
                padding: 16px; box-sizing: border-box;
            }
            .gpc-preview-modal-box {
                width: 100%; max-width: 532px; max-height: 90vh; overflow-y: auto;
                box-sizing: border-box; padding: 14px; border-radius: 10px;
                background: ${t2('#ffffff', '#1e1e2e')}; color: ${t2('#111827', '#f5f5f5')};
                box-shadow: 0 12px 32px rgba(0,0,0,.4);
                display: flex; flex-direction: column; gap: 10px;
            }
            .gpc-preview-modal-header {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
            }
            .gpc-preview-modal-title {
                font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .gpc-preview-modal-close-btn {
                flex-shrink: 0; border: none; background: transparent; cursor: pointer;
                font-size: 14px; color: ${t2('#64748b', '#a6adc8')}; padding: 2px 4px;
            }
            /* Fresh gppLibraryRenderFullCanvas() call, independent of the
               small thumbnail's own cached canvas (getTemplatePreviewCanvas)
               -- a second call returns a second, unrelated <canvas>, so
               there's no node-sharing conflict with the thumbnail still
               showing behind this modal. max-width+max-height BOTH set as
               caps (neither one FIXED) with width/height:auto is the
               standard "fit within bounds, keep aspect ratio" CSS pattern
               -- a different situation from the small thumbnail's own
               comment (which warns against a FIXED height paired with
               max-width, not two caps together). Verified in a real DOM
               regardless, given that comment's own history. */
            .gpc-preview-modal-canvas-frame {
                display: flex; align-items: center; justify-content: center;
                max-height: 56vh; overflow: hidden;
                border: 1px solid ${t2('#d1d5db', '#45475a')}; border-radius: 6px;
                background: ${t2('rgba(0,0,0,.03)', 'rgba(255,255,255,.05)')};
            }
            .gpc-preview-modal-canvas-frame canvas {
                max-width: 100%; max-height: 56vh; width: auto; height: auto;
                display: block; image-rendering: pixelated;
            }
            .gpc-preview-modal-progress-wrap { display: flex; flex-direction: column; gap: 4px; }
            .gpc-preview-modal-bar-outer {
                display: flex; height: 10px; border-radius: 5px; overflow: hidden;
                background: ${t2('#e5e7eb', '#313244')};
            }
            .gpc-preview-modal-summary-line {
                font-size: 11px; color: ${t2('#475569', '#a6adc8')};
            }
            .gpc-preview-modal-colors-wrap { display: flex; flex-direction: column; gap: 4px; }
            .gpc-preview-modal-colors-wrap label {
                font-size: 11px; font-weight: 600; color: ${t2('#1f2937', '#e2e2f5')};
            }
            .gpc-preview-modal-colors-row { display: flex; gap: 6px; align-items: stretch; }
            .gpc-preview-modal-colors-row textarea {
                flex: 1 1 auto; min-width: 0; height: 70px; resize: vertical;
                font: 11px ui-monospace, Menlo, Consolas, monospace;
                padding: 6px; border-radius: 6px; box-sizing: border-box;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#f9fafb', '#181825')}; color: ${t2('#111827', '#f5f5f5')};
            }
            .gpc-preview-modal-copy-btn {
                flex-shrink: 0; width: 32px; border-radius: 6px; cursor: pointer;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#ffffff', '#313244')}; color: ${t2('#111827', '#f5f5f5')};
                font-size: 14px;
            }
            .gpc-preview-modal-copy-btn:hover { background: ${t2('#f3f4f6', '#45475a')}; }
            .gpc-preview-modal-buy-btn {
                font: inherit; font-weight: 600; padding: 8px; border-radius: 6px; cursor: pointer;
                border: 1px solid ${t2('#2563eb', '#89b4fa')};
                background: ${t2('#2563eb', '#89b4fa')}; color: ${t2('#ffffff', '#1e1e2e')};
            }
            .gpc-preview-modal-buy-btn:hover { opacity: .9; }
            /* Palette view toggle (Grid/List), borrowed from gpp-view-
               settings.js -- see borrowPaletteViewToggle's own comment.
               Ghost++'s own .gpp-vs-row is a horizontal label-then-toggle
               row (display:flex, no direction set); per explicit product
               decision this reads better stacked (label above the toggle)
               in the narrow slot between the grid and the preview frame, so
               flex-direction is overridden to column here -- the row's own
               child order (label, then the toggle div) already puts the
               label first, so no DOM reordering is needed, just a re-flow.
               Same pitfall as every other borrowed-into-mobile-view element
               (see the #gpc-mobile-placeholder-group CSS comment further
               below): Ghost++'s own .gpp-vs-label/.gpp-vs-view-btn/-active
               are styled via t2()/isDarkMode(), correct for their normal
               home inside the real, independently-themed Ghost++ modal but
               wrong here for the same reason -- #bottomControls' own
               wrapper never itself goes dark. Re-themed with tc() instead,
               scoped to this row's own marker class (added by
               borrowPaletteViewToggle, so the real settings panel's normal
               appearance is untouched) and !important, matching that same
               block's own precedent (two separate <style> tags whose
               relative order in <head> isn't guaranteed, so specificity
               alone can't be trusted to win the tie). flex:0 0 auto matches
               .gpc-mobile-preview-frame's own sizing choice -- a fixed-
               content-width column, not growing/shrinking with the grid. */
            /* Stable container for the toggle row above AND our own
               "Visible rows" row below it (see ensureViewControlsColumn) --
               THIS is what actually sits in .gpc-mobile-palette-wrap, not
               the toggle row directly. Matters for more than just stacking
               the two: borrowNode always APPENDS at the end of whatever
               parent it's given, so re-borrowing the toggle row straight
               into .gpc-mobile-palette-wrap on a live-sync tick (which by
               then already holds the grid AND the preview frame) landed it
               AFTER the preview frame instead of back between the grid and
               the frame where it started -- a real, reported drift bug.
               This container persists across live-sync ticks unchanged
               (only the real row inside it gets returned+reborrowed), so
               its own position in the wrap -- set once, correctly, when the
               wrap itself is built -- never drifts. */
            .gpc-mobile-view-controls-col {
                flex: 0 0 auto; display: flex; flex-direction: column;
                align-items: center; justify-content: center; gap: 5px;
            }
            .gpc-mobile-view-toggle-row {
                flex: 0 0 auto !important;
                display: flex !important; flex-direction: column !important;
                align-items: center !important; justify-content: center !important;
                gap: 3px !important; margin: 0 !important;
            }
            /* Our own control, never Ghost++'s -- no borrow/restore
               discipline needed, unlike everything else in this column. */
            .gpc-mobile-visible-rows-row {
                display: flex; flex-direction: column; align-items: center; gap: 2px;
            }
            .gpc-mobile-visible-rows-row label {
                font-size: 9px; white-space: nowrap; color: ${tc('#64748b', '#a6adc8')};
            }
            .gpc-mobile-visible-rows-row select {
                font: inherit; font-size: 11px; padding: 1px 3px; border-radius: 4px;
                border: 1px solid ${tc('#d1d5db', '#45475a')};
                background: ${tc('#ffffff', '#313244')}; color: ${tc('#111827', '#f5f5f5')};
                cursor: pointer;
            }
            .gpc-mobile-view-toggle-row .gpp-vs-label {
                min-width: 0 !important; font-size: 9px !important; white-space: nowrap !important;
                color: ${tc('#64748b', '#a6adc8')} !important;
            }
            .gpc-mobile-view-toggle-row .gpp-vs-view-toggle {
                border-color: ${tc('#d1d5db', '#45475a')} !important;
            }
            .gpc-mobile-view-toggle-row .gpp-vs-view-btn {
                background: ${tc('#ffffff', '#313244')} !important;
                color: ${tc('#64748b', '#a6adc8')} !important;
            }
            .gpc-mobile-view-toggle-row .gpp-vs-view-btn:hover {
                background: ${tc('#f3f4f6', '#45475a')} !important;
            }
            .gpc-mobile-view-toggle-row .gpp-vs-view-btn-active {
                background: ${tc('#2563eb', '#89b4fa')} !important;
                color: ${tc('#ffffff', '#1e1e2e')} !important;
            }
            /* !important is load-bearing: #gpc-native-top-bar carries its own
               inline style="display: flex; ..." (native markup), which beats
               any non-!important class on specificity alone. */
            .gpc-hidden { display: none !important; }
            /* The native page's own top-of-screen toast (js/index151.js's
               showAlert/#alertBox, real markup: fixed top-16 ... z-50) --
               z-50 is far below this file's own modals (see
               openTemplatePreviewModal, z-index:100000, matching core.js's
               own #gpc-settings-modal convention), so an alert triggered
               while one of those is open would silently render BEHIND it,
               invisible. Alerts should always be the topmost thing on
               screen regardless of what else is open -- bumped above every
               modal this codebase uses, not just this file's own. */
            #alertBox { z-index: 100050 !important; }
            /* Shown in place of #gpc-native-top-bar and .gpc-mobile-controls-
               row once the preview-thumbnail canvas is tapped -- see
               toggleNativeControlsForPlaceholders. Three equal-width columns
               (#gpc-mobile-scan-panel / -upload-panel / -placement-panel),
               each holding real Ghost++ panels BORROWED (moved, not cloned
               -- see borrowNode) from their real locations in the (hidden)
               Ghost++ modal for as long as this view is showing, and
               returned when switching back. Single shared parent for the
               same reason established for the two-panel version this
               replaced: innerWrapper (their parent once inserted) is a flex
               column with its own gap-4 (16px) between children -- one
               shared parent means that gap applies once around the row as
               a whole, not once per bare sibling column.
               align-items: stretch (the default value -- listed explicitly
               here since it's load-bearing, not just left implicit) pins
               all three columns' heights to whichever one is tallest, since
               their own real content heights can differ (e.g. p1's counts
               line only shows once there's something to report). Each
               column is itself display:flex/flex-direction:column (see
               .gpc-mobile-placeholder below), so the extra height a shorter
               column gets just becomes trailing empty space inside it
               rather than stretching any individual child. */
            .gpc-mobile-placeholder-group {
                width: 100%; box-sizing: border-box;
                display: flex; flex-direction: row; align-items: stretch; gap: 6px;
            }
            .gpc-mobile-placeholder {
                flex: 1 1 0; min-width: 0; box-sizing: border-box; padding: 8px;
                display: flex; flex-direction: column; gap: 6px;
                border: 1px solid ${tc('#d1d5db', '#45475a')}; border-radius: 6px;
                color: ${tc('#111827', '#f5f5f5')}; background: ${tc('#ffffff', '#1e1e2e')};
                font-size: 11px;
            }
            /* Shared 2x2 layout for both p1's (Scan/Show errors/Show missing/
               Nearest error) and p3's (Place/Unset/Go to/Preview) button
               sets -- an explicit grid rather than relying on each source
               panel's own flex-wrap (gpp-scan.js's headRow, gpp-placement.js's
               .gpp-pt-row3), which reflows into 2x2 only incidentally at
               certain widths, not reliably at this column's actual width. */
            .gpc-mobile-p-btn-grid {
                display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
            }
            .gpc-mobile-p-btn-grid .gpp-pt-btn,
            .gpc-mobile-p-btn-grid button {
                width: 100%; box-sizing: border-box;
            }
            .gpc-mobile-p3-checkboxes {
                display: flex; flex-direction: column; gap: 4px;
            }
            /* Lock Position/Group noise (.gpc-mobile-p3-checkboxes) on the
               left, the real nudge-arrow cluster (#gpp-pt-nudge-row,
               borrowed wholesale -- its own inline flex-wrap:wrap;gap:6px
               already arranges the 4 arrows the way Ghost++ itself designed
               them) to the right, per explicit product decision. wrap: if
               this column gets too narrow for both side by side, the
               (single, since it's borrowed as one unit) nudge cluster drops
               to its own line below the checkboxes rather than overflowing. */
            .gpc-mobile-p3-checkbox-nudge-row {
                display: flex; flex-direction: row; align-items: center;
                flex-wrap: wrap; gap: 10px; margin-bottom: 6px;
            }
            /* #gpp-pt-nudge-row carries its own inline margin-bottom:6px,
               sized for Ghost++'s normal vertical stacking -- redundant
               (and, since it's a row-direction flex item now, a source of
               slight vertical misalignment against .gpc-mobile-p3-
               checkboxes next to it) in this side-by-side layout, so it's
               zeroed out here. !important since it's overriding an inline
               style. */
            #gpc-mobile-placeholder-group #gpp-pt-nudge-row {
                margin-bottom: 0 !important;
            }
            /* Same pitfall as .gpc-mobile-controls-row's own buttons (see
               that comment above), now on the elements borrowed into p1/p2/
               p3: they're styled by their OWN real Ghost++ code (gpp-scan.js,
               gpp-placement.js, gpp-library.js, gpp-ui-shell.js) via
               t2()/isDarkMode(), which -- correctly, for their normal home
               inside the real, independently-themed Ghost++ modal -- falls
               back to body.dark / OS prefers-color-scheme when the other
               "GeoPixels++" extension has no explicit theme set. That
               fallback is wrong here for the exact same reason it was wrong
               for this row's own buttons: #bottomControls' own wrapper never
               itself goes dark, so an OS/body-driven dark render bakes in
               dark colors against a background staying light regardless.
               Re-themed with tc() instead, ID-scoped to #gpc-mobile-
               placeholder-group (so the real Ghost++ modal's own normal
               appearance is untouched) and !important (so it wins over
               Ghost++'s own class rules and inline styles regardless of
               which was written last). The 4 gpp-scan.js buttons
               (#gpp-scan-btn-*) are handled separately in JS -- see
               retintScanButton in buildPlaceholder1Content -- since their
               colors are baked into inline style.cssText per-button at
               render time, including a primary/accent variant this static
               CSS can't distinguish from the plain one. */
            #gpc-mobile-placeholder-group button,
            #gpc-mobile-placeholder-group .gpp-pt-btn {
                border: 1px solid ${tc('#d1d5db', '#45475a')} !important;
                background: ${tc('#ffffff', '#313244')} !important;
                color: ${tc('#111827', '#f5f5f5')} !important;
            }
            #gpc-mobile-placeholder-group button:hover:not(:disabled),
            #gpc-mobile-placeholder-group .gpp-pt-btn:hover:not(:disabled) {
                background: ${tc('#f3f4f6', '#45475a')} !important;
            }
            #gpc-mobile-placeholder-group .gpp-pt-btn-active {
                border-color: ${tc('#2563eb', '#89b4fa')} !important;
                color: ${tc('#2563eb', '#89b4fa')} !important;
            }
            #gpc-mobile-placeholder-group label,
            #gpc-mobile-placeholder-group .gpp-pt-lock,
            #gpc-mobile-placeholder-group #gpp-drop-zone {
                color: ${tc('#111827', '#f5f5f5')} !important;
            }
            #gpc-mobile-placeholder-group #gpp-drop-zone {
                border-color: ${tc('#d1d5db', '#45475a')} !important;
            }
            #gpc-mobile-placeholder-group .gpp-muted,
            #gpc-mobile-placeholder-group #gpp-url-upload-btn,
            #gpc-mobile-placeholder-group .gpp-pt-opacity-value {
                color: ${tc('#64748b', '#a6adc8')} !important;
            }
            /* #gpp-pt-opacity-row's real CSS packs label+slider+value+reset
               into one nowrap flex row with a 50px-min-width label -- fine
               in the real modal's much wider Template Settings panel, but
               in this column (roughly a third of a phone screen) that
               leaves almost no width for the slider's own draggable track.
               Reordered onto two lines instead: label+value+reset stay
               together on line one, the slider gets the full second line
               (flex-basis 100% forces the wrap). order values are just
               sequence numbers, not meaningful outside this rule. */
            #gpc-mobile-placeholder-group #gpp-pt-opacity-row {
                flex-wrap: wrap;
            }
            #gpc-mobile-placeholder-group #gpp-pt-opacity-row label {
                order: 1; min-width: 0 !important; flex: 1 1 auto !important;
            }
            #gpc-mobile-placeholder-group #gpp-pt-opacity-row .gpp-pt-opacity-value {
                order: 2;
            }
            #gpc-mobile-placeholder-group #gpp-pt-opacity-row .gpp-pt-reset-btn {
                order: 3;
            }
            #gpc-mobile-placeholder-group #gpp-pt-opacity-row #gpp-pt-opacity {
                order: 4; flex: 1 1 100% !important;
            }
            /* .gpp-pt-reset-btn is a <button>, so it'd otherwise also match
               the generic button rule above -- its real CSS deliberately
               has NO border/background (a plain icon button), which that
               rule's border/background would clobber. More specific
               (tag+class beats the plain button rule's tag-only selector)
               so this wins regardless of declaration order, restoring the
               borderless look and only actually re-theming its color. */
            #gpc-mobile-placeholder-group button.gpp-pt-reset-btn {
                border: none !important; background: transparent !important;
                color: ${tc('#64748b', '#a6adc8')} !important;
            }
            #gpc-mobile-placeholder-group #gpp-scan-bar-outer {
                background: ${tc('#e5e7eb', '#313244')} !important;
            }
            .gpp-swatch {
                position: relative; aspect-ratio: 1 / 1; min-height: 15px; border-radius: 4px;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                padding: 0; transition: transform .18s ease-out, box-shadow .18s ease-out;
            }
            .gpp-swatch:hover {
                transform: scale(1.2);
                box-shadow: 0 3px 8px ${t2('rgba(0,0,0,.35)', 'rgba(0,0,0,.6)')};
                z-index: 2;
            }
            /* Per explicit product decision, disabled colors in THIS grid get
               NO visual indicator at all -- no grayscale (see the removed-
               filter history in the changelog), no diagonal slash either.
               The underlying mask (template.mask via core.maskSet) is
               unchanged -- other colors are still genuinely disabled in the
               Ghost++ overlay, exactly as soloColor() always did; only the
               visual off-state styling is suppressed here. Ghost++'s own
               grid keeps its usual grayscale + slash treatment, untouched.
               #gpc-mobile-palette-grid-scoped override below, not just an
               absence of a rule here -- Ghost++'s own #gpp-palette-style
               tag (gpp-palette.js's gppInjectPaletteStyle(), which our own
               ensurePaletteControllerReady() calls can trigger) defines an
               UNGATED .gpp-swatch.gpp-swatch-off::after slash rule that
               would otherwise apply to every matching element on the page
               regardless of which grid it's actually in or which stylesheet
               "owns" it -- CSS selectors aren't scoped by which script wrote
               them. The higher-specificity ID-scoped override is what
               actually guarantees it never shows here, independent of
               style-tag injection order. */
            #gpc-mobile-palette-grid .gpp-swatch.gpp-swatch-off::after {
                content: none;
            }
            /* List mode (buildTemplatePaletteGrid mirrors gpp-palette.js's
               own .gpp-swatch-list row exactly, via the SAME real
               gppPaletteApplyListLayout() call it uses -- see that
               function's call site below). Its background/text/bar colors
               are Ghost++'s own, via t2()/isDarkMode() -- correct for the
               real, independently-themed Ghost++ modal, wrong here for the
               exact same reason it's wrong everywhere else in this file:
               #bottomControls' own wrapper never itself goes dark, so an
               OS/body-driven dark render would paint these rows dark
               against a background staying light regardless. Re-themed
               with tc(), ID-scoped to #gpc-mobile-palette-grid so Ghost++'s
               own real grid (list mode there too) is untouched, and
               !important so it wins over Ghost++'s own rules regardless of
               which was written last. */
            #gpc-mobile-palette-grid .gpp-swatch.gpp-swatch-list {
                background: ${tc('#ffffff', '#181825')} !important;
            }
            #gpc-mobile-palette-grid .gpp-swatch.gpp-swatch-list:hover {
                background: ${tc('#f3f4f6', '#232336')} !important;
            }
            #gpc-mobile-palette-grid .gpp-palette-list-chip {
                border-color: ${tc('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')} !important;
            }
            #gpc-mobile-palette-grid .gpp-palette-list-hex {
                color: ${tc('#111827', '#f5f5f5')} !important;
            }
            #gpc-mobile-palette-grid .gpp-palette-list-progress-text {
                color: ${tc('#64748b', '#a6adc8')} !important;
            }
            #gpc-mobile-palette-grid .gpp-palette-list-bar-outer {
                background: ${tc('#e5e7eb', '#313244')} !important;
            }
            /* "Currently selected" indicator: a plain black square border
               with a white glow around it. Replaced the earlier rotating
               (then stationary) dashed mask-composite frame per explicit
               product decision -- simpler and less busy. Only shows while
               liveState.soloMode is true (see setSwatchState) -- there's no
               single "the" selected color to ring while in multi-select
               mode (All/Owned/Filtered). Separate pseudo-element from
               .gpp-swatch-off's ::after slash so a swatch could in
               principle carry both without conflict, even though in
               practice soloColor() always leaves the selected swatch
               enabled. border-radius is the swatch's own 4px plus the -3px
               inset, so the ring's corners stay concentric with the
               swatch's own rounded corners instead of going square-cornered
               around a rounded swatch. z-index is well above anything else
               that can appear under #bottomControls -- the control row's
               own dropdown menus (1000) and the Paint Menu Controls
               feature's topBar (hide-paint-menu.js, 20) included -- so the
               ring for whichever swatch is selected always stays visible
               above them rather than being able to render underneath. */
            .gpp-swatch.gpp-swatch-selected::before {
                content: ''; position: absolute; inset: -3px; z-index: 2000;
                pointer-events: none; box-sizing: border-box; border-radius: 7px;
                border: 2px solid #000;
                box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 0 6px 2px rgba(255,255,255,.9);
            }
            /* Shared with Ghost++'s own tooltip (#gpp-palette-tooltip is a
               page-global singleton -- see gpp-palette.js's
               gppPaletteEnsureTooltipEl) -- injected here too so the tooltip
               looks right even if the real Ghost++ modal was never opened
               this session (its own style tag would otherwise never run). */
            #gpp-palette-tooltip {
                position: fixed; z-index: 10070; pointer-events: none; display: none;
                padding: 6px 9px; border-radius: 7px; font-size: 12px; line-height: 1.4;
                background: ${t2('#ffffff', '#1e1e2e')};
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                box-shadow: 0 8px 20px ${t2('rgba(15,23,42,.28)', 'rgba(0,0,0,.6)')};
                color: ${t2('#111827', '#f5f5f5')};
            }
            #gpp-palette-tooltip .gpp-palette-tooltip-hex {
                font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700;
                display: flex; align-items: center; gap: 6px;
            }
            #gpp-palette-tooltip .gpp-palette-tooltip-swatch {
                display: inline-block; width: 10px; height: 10px; border-radius: 3px;
                border: 1px solid ${t2('rgba(0,0,0,.28)', 'rgba(255,255,255,.28)')};
            }
            #gpp-palette-tooltip .gpp-palette-tooltip-stats {
                margin-top: 2px; color: ${t2('#64748b', '#a6adc8')};
            }
            /* Bulk-action / sort / filter / get-hex row. Styled via tc(),
               a narrower variant of t2()/isDarkMode() defined below: this
               row should only go dark when the OTHER "GeoPixels++"
               extension's OWN theme selector is explicitly set to a dark
               theme -- unlike isDarkMode() (core.js's "DARK THEME
               DETECTION (Geopixels++ compatibility)"), it does NOT fall
               back to body.dark or the OS-level prefers-color-scheme, since
               #bottomControls' own inner wrapper ships a hardcoded,
               unconditional bg-white with no dark: variant of its own
               (verified against the live DOM) -- an OS/body dark signal
               alone would make these buttons black against a background
               that stays unconditionally white regardless. Colors below are
               reused verbatim from this file's own #gpp-palette-tooltip
               block above, not reinvented. */
            .gpc-mobile-controls-row {
                width: 100%; box-sizing: border-box; margin-bottom: 6px;
                display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
            }
            .gpc-ctrl-btn {
                max-width: 130px; box-sizing: border-box; min-width: 0;
                border: 2px solid ${tc('#d1d5db', '#45475a')}; border-radius: 6px;
                background: ${tc('#ffffff', '#1e1e2e')}; color: ${tc('#111827', '#f5f5f5')};
                font-size: 11px; font-weight: 600; cursor: pointer;
                display: flex; align-items: center; gap: 5px; overflow: hidden;
                padding: 5px 8px; white-space: nowrap;
            }
            .gpc-ctrl-btn:hover { background: ${tc('#f3f4f6', '#313244')}; }
            .gpc-ctrl-btn-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .gpc-ctrl-btn-arrow { font-size: 9px; opacity: .7; flex-shrink: 0; }
            .gpc-ctrl-dropdown { position: relative; display: inline-flex; min-width: 0; }
            /* Menus open UPWARD (bottom, not top) -- this row sits at the very
               bottom of the screen, so a downward menu would run off-page.
               z-index is well above the Paint Menu Controls feature's topBar
               (hide-paint-menu.js, inline z-index: 20, appended as a later
               DOM sibling of this row inside the same #bottomControls) --
               with equal z-index the later DOM element wins ties, which was
               burying this menu under that toggle's button row. */
            .gpc-ctrl-menu {
                display: none; position: absolute; bottom: calc(100% + 4px); left: 0; z-index: 1000;
                min-width: 190px; max-width: 230px; padding: 6px; border-radius: 8px;
                border: 1px solid ${tc('#e5e7eb', '#313244')};
                background: ${tc('#ffffff', '#181825')};
                box-shadow: 0 -8px 24px rgba(0,0,0,.28);
            }
            .gpc-ctrl-menu.gpc-open { display: flex; flex-direction: column; gap: 2px; }
            .gpc-ctrl-menu-option {
                display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 5px;
                font-size: 12px; cursor: pointer; user-select: none;
                color: ${tc('#111827', '#f5f5f5')};
            }
            .gpc-ctrl-menu-option:hover { background: ${tc('#f3f4f6', '#313244')}; }
            .gpc-ctrl-menu-option input { width: 13px; height: 13px; cursor: pointer; }
        `;
        if (isNew) document.head.appendChild(style);
    }

    function applyFullWidthBottomControls(bottomControls) {
        bottomControls.style.width = '100vw';
        bottomControls.style.maxWidth = '100vw';
        bottomControls.style.left = '0';
        bottomControls.style.right = '0';
        bottomControls.style.transform = 'none';
    }

    function getFocusedTemplateWithPalette() {
        if (typeof gppState === 'undefined' || typeof gppState.getFocusedTemplate !== 'function') return null;
        const template = gppState.getFocusedTemplate();
        return (template && template.palette && template.palette.length) ? template : null;
    }

    // Also reconciles the "currently selected" ring indicator
    // (liveState.selectedHex, set by soloColor/setGridClickTarget below)
    // against this swatch -- every call site that already calls
    // setSwatchState (initial build, soloColor's own update loop, resync()'s
    // reconcile pass) gets the ring kept in sync for free, with no separate
    // pass needed. The ring only shows while liveState.soloMode is true --
    // there's no single "the" selected color to ring while in multi-select
    // mode (see bulkEnableAll/Owned/Filtered, which set soloMode false).
    function setSwatchState(swatch, hex, enabled) {
        swatch.classList.toggle('gpp-swatch-off', !enabled);
        swatch.setAttribute('aria-pressed', String(enabled));
        swatch.setAttribute('aria-label', `${enabled ? 'Hide' : 'Show'} ${hex}`);
        swatch.classList.toggle('gpp-swatch-selected', !!liveState && liveState.soloMode !== false && liveState.selectedHex === hex);
    }

    // Native #hexDisplay (js/index148.js's SetColors) only ever updates on
    // NATIVE swatch mouseover, and is hidden below Tailwind's md breakpoint
    // (`hidden md:inline-block`) -- invisible at the phone widths this
    // extension targets, since it existed purely as a hover preview for the
    // native grid we've replaced. Forced visible here and updated on
    // selection (not hover -- see the tooltip for that) instead.
    function updateHexDisplay(hex) {
        const hexDisplay = document.getElementById('hexDisplay');
        if (!hexDisplay) return;
        hexDisplay.textContent = hex;
        hexDisplay.style.display = 'inline-block';
    }

    // Bare `window` inside a userscript is not reliably the same object as
    // the native page's own `window` (Tampermonkey/Violentmonkey run scripts
    // in a sandboxed realm in some browsers -- see the `unsafeWindow`
    // fallback used almost everywhere else in this codebase, e.g.
    // hide-paint-menu.js, paint-brush-swap.js, ghost-plus-plus/gpp-*.js).
    // soloColor()/toggleColor() previously called bare `window.changeColor`,
    // which silently no-ops when `window` is sandboxed -- the grid's own
    // solo/toggle visuals still updated fine (self-contained DOM state), but
    // the real native active paint color (`pixelColor`, js/index148.js)
    // never actually changed. This matches this file's own established
    // convention instead of inventing a new one.
    function pageWindow() {
        return (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    }

    // Reads the SAME already-computed sort/filter result the real Ghost++
    // palette panel last produced (controller.renderState.visible -- see the
    // "Exposed on the controller" comment in gpp-palette.js's
    // performFilterSort), rather than re-implementing that 8-sort/6-filter
    // pipeline a second time here where it could drift out of sync. Only
    // trusted when the real panel's controller is actually showing the SAME
    // template (templateKey match) -- otherwise (Ghost++ modal never opened
    // this session, or showing a different template) falls back to natural
    // palette order with nothing filtered out.
    function getRealPaletteRenderState(templateId) {
        if (typeof gppPaletteControllers === 'undefined') return null;
        const realContainer = document.getElementById('gpp-palette-section');
        if (!realContainer) return null;
        const realController = gppPaletteControllers.get(realContainer);
        if (!realController || realController.templateKey !== templateId || !realController.renderState) return null;
        return realController.renderState;
    }

    function computeVisibleOrder(template) {
        const realState = getRealPaletteRenderState(template.id);
        if (realState && Array.isArray(realState.visible)) return realState.visible.slice();
        const order = [];
        for (let index = 0; index < template.palette.length; index++) order.push(index);
        return order;
    }

    // Keeps .gpc-mobile-preview-frame a SQUARE -- see that CSS rule's own
    // comment for why this has to be a ResizeObserver rather than CSS
    // aspect-ratio. ONE persistent observer, re-pointed at whichever frame
    // is current rather than a new observer per rebuild -- disconnecting
    // before each re-observe means an old, about-to-be-discarded frame
    // (buildTemplatePaletteGrid makes a new one on every template switch)
    // never lingers as an observed target. The >0.5 guard is what makes
    // this convergent instead of a runaway loop: the write below itself
    // changes the frame's box, which the browser re-notifies for, but that
    // second notification finds width already matching height and does
    // nothing further -- confirmed by calling this same reaction logic
    // repeatedly against a real element and checking it stops writing
    // after exactly one correction per genuine height change.
    let previewFrameSquareObserver = null;
    function ensurePreviewFrameStaysSquare(frame) {
        if (!previewFrameSquareObserver) {
            previewFrameSquareObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const target = entry.target;
                    const height = target.getBoundingClientRect().height;
                    const width = target.getBoundingClientRect().width;
                    if (Math.abs(width - height) > 0.5) {
                        target.style.width = height + 'px';
                    }
                }
            });
        }
        previewFrameSquareObserver.disconnect();
        previewFrameSquareObserver.observe(frame);
    }

    // Cache for the ghost-image preview canvas (see buildTemplatePaletteGrid
    // below) -- gppLibraryRenderFullCanvas() re-walks every pixel of the
    // template's own indices array, which is wasted work if repeated on
    // every resync() tick (color toggles, sort/filter changes -- none of
    // which touch the image itself). Only regenerated when the focused
    // template's identity actually changes; the same canvas node is reused
    // (and just re-appended, a cheap DOM op) otherwise.
    let previewCanvasTemplateId = null;
    let previewCanvasEl = null;
    function getTemplatePreviewCanvas(template) {
        if (previewCanvasTemplateId === template.id && previewCanvasEl) return previewCanvasEl;
        previewCanvasEl = (typeof gppLibraryRenderFullCanvas === 'function') ? gppLibraryRenderFullCanvas(template) : null;
        previewCanvasTemplateId = template.id;
        // Attached HERE, only in the branch that creates a genuinely new
        // canvas -- not in buildTemplatePaletteGrid's caller, which would
        // re-attach on every rebuild (sort/filter/template-unchanged
        // resyncs) since this same cached node gets reused across those.
        // A second listener on the same node would double-fire per click,
        // toggling state twice and netting a no-op on every other tap.
        if (previewCanvasEl) previewCanvasEl.addEventListener('click', toggleNativeControlsForPlaceholders);
        return previewCanvasEl;
    }

    // Relocates (not clones) a real, singleton Ghost++ DOM node into
    // `newParent` while placeholder mode is active, remembering exactly
    // where it came from so returnBorrowedNodes() can put it back. These
    // are the SAME elements the real Ghost++ modal needs in place if it's
    // ever opened normally -- cloning would produce a visual copy with none
    // of the original's live wiring/state, so borrowing (moving) is the
    // only option that keeps every button/checkbox genuinely functional
    // without reimplementing any of Ghost++'s own logic a second time.
    //
    // Both functions take an optional `list` to track against, defaulting
    // to `borrowedNodes` (p1/p2/p3's own, returned only while placeholder
    // mode is showing). The palette-view toggle below uses its OWN separate
    // list instead -- its lifecycle is genuinely independent (borrowed for
    // as long as the compact grid exists at all, not scoped to placeholder
    // mode), so a plain "return everything" call for one must never also
    // catch the other.
    let borrowedNodes = []; // [{ node, originalParent, originalNextSibling }]
    function borrowNode(node, newParent, list) {
        if (!node) return;
        (list || borrowedNodes).push({ node, originalParent: node.parentElement, originalNextSibling: node.nextElementSibling });
        newParent.appendChild(node);
    }
    // Restored in reverse borrow order, each via insertBefore its recorded
    // next-sibling (falling back to appendChild if that sibling itself
    // moved/vanished in the meantime) -- puts every borrowed node back
    // exactly where Ghost++ itself put it, not just back into the right
    // parent.
    function returnBorrowedNodes(list) {
        const target = list || borrowedNodes;
        for (let i = target.length - 1; i >= 0; i--) {
            const { node, originalParent, originalNextSibling } = target[i];
            if (!originalParent) continue;
            if (originalNextSibling && originalNextSibling.parentElement === originalParent) {
                originalParent.insertBefore(node, originalNextSibling);
            } else {
                originalParent.appendChild(node);
            }
        }
        target.length = 0;
    }

    // Palette view toggle (Grid/List, gpp-view-settings.js), borrowed into
    // buildTemplatePaletteGrid's own .gpc-mobile-palette-wrap, directly left
    // of .gpc-mobile-preview-frame. Kept live-synced by the SAME shared
    // observer as p1/p2/p3 (startGhostModalLiveSync, below) -- an EARLIER
    // version of this used a second, independent MutationObserver instead,
    // which caused a real, shipped freeze-the-page bug: two separate
    // observers both watching #gpp-modal, each disconnecting only ITSELF
    // before its own mutation and reconnecting only ITSELF after, still see
    // each OTHER's mutations (disconnecting observer A doesn't stop B from
    // reacting to A's own DOM changes) -- so A's reconnect-after-mutation
    // gets seen by B, which mutates and reconnects, which A (already back
    // on again) sees and reacts to, forever. A single shared observer's
    // disconnect covers BOTH concerns' own mutations at once, which is the
    // only way to actually break a loop like that.
    //
    // Note: toggling Grid/List here only changes Ghost++'s OWN real
    // gppSettings.paletteViewMode (so it's remembered correctly if the real
    // modal is ever opened) -- it does not switch THIS file's own compact
    // grid (buildTemplatePaletteGrid) to a list layout, which always renders
    // as a grid regardless of this setting.
    let viewToggleBorrowedNodes = []; // separate from borrowedNodes -- its lifecycle (borrowed for as long as the compact grid exists at all, not scoped to placeholder mode) is independent of p1/p2/p3's, so a plain "return everything" call for one must never also catch the other.

    // "Visible rows" -- purely a THIS-file preference (how tall
    // #gpc-mobile-palette-grid's own scroll area is), nothing Ghost++ has
    // any concept of, so it's not gppSettings -- a dedicated localStorage
    // key instead, same direct-localStorage approach isControlsRowDark()
    // already uses for a similar reason.
    const VISIBLE_ROWS_KEY = 'gpc_mobilePaletteVisibleRows';
    function getVisibleRowsSetting() {
        const n = parseInt(localStorage.getItem(VISIBLE_ROWS_KEY), 10);
        return (Number.isInteger(n) && n >= 1 && n <= 10) ? n : 2; // 2 matches the height this grid always used before this setting existed
    }
    function setVisibleRowsSetting(n) {
        try { localStorage.setItem(VISIBLE_ROWS_KEY, String(n)); } catch (e) {}
    }
    // Matches .gpp-palette-grid's own real metrics exactly (26px rows, 3px
    // gap between them, 2px padding on each of the top/bottom edges) --
    // see that rule's own comment for where those numbers come from. Not
    // pixel-exact for every possible row count (grid-auto-rows' own
    // minmax(26px, 1fr) can still let the LAST partial row stretch to fill
    // any few leftover pixels), which is fine -- this is a scrollable area
    // either way, so "approximately N rows before scrolling" is the actual
    // goal, not a hard guarantee.
    function computeGridMaxHeight(rows) {
        return rows * 26 + (rows - 1) * 3 + 4;
    }

    // Our own control, appended alongside the borrowed toggle row inside
    // ensureViewControlsColumn's container -- built once per compact-grid
    // instance (guarded against the container already having one, since
    // borrowPaletteViewToggle -- and so this -- runs again on every
    // live-sync tick) and never touches any real Ghost++ state, so unlike
    // everything else in this file there's no borrow/restore discipline
    // needed for it at all.
    function ensureVisibleRowsControl(col) {
        if (col.querySelector('#gpc-mobile-visible-rows-row')) return;
        const row = document.createElement('div');
        row.id = 'gpc-mobile-visible-rows-row';
        row.className = 'gpc-mobile-visible-rows-row';
        const label = document.createElement('label');
        label.htmlFor = 'gpc-mobile-visible-rows';
        label.textContent = 'Visible rows';
        const select = document.createElement('select');
        select.id = 'gpc-mobile-visible-rows';
        for (let n = 1; n <= 10; n++) {
            const option = document.createElement('option');
            option.value = String(n);
            option.textContent = String(n);
            select.appendChild(option);
        }
        select.value = String(getVisibleRowsSetting());
        select.addEventListener('change', () => {
            const n = parseInt(select.value, 10) || 2;
            setVisibleRowsSetting(n);
            const liveGrid = document.getElementById('gpc-mobile-palette-grid');
            if (liveGrid) liveGrid.style.maxHeight = computeGridMaxHeight(n) + 'px';
        });
        row.append(label, select);
        col.appendChild(row);
    }

    // Shared, stable container for the borrowed toggle row AND
    // ensureVisibleRowsControl's own row, stacked together -- see this
    // container's own CSS comment (.gpc-mobile-view-controls-col) for why
    // it has to exist as a separate, persistent element rather than
    // borrowing the toggle row directly into .gpc-mobile-palette-wrap.
    // Scoped to hostEl (NOT a bare document.getElementById) on purpose: at
    // the moment buildTemplatePaletteGrid calls this, the OLD wrap (with
    // its own #gpc-mobile-view-controls, about to be discarded via
    // showCompactGrid's replaceWith) can still be in the document
    // alongside the brand new one being built -- an unscoped lookup could
    // find and reuse the wrong one.
    function ensureViewControlsColumn(hostEl) {
        let col = hostEl.querySelector('#gpc-mobile-view-controls');
        if (!col) {
            col = document.createElement('div');
            col.id = 'gpc-mobile-view-controls';
            col.className = 'gpc-mobile-view-controls-col';
            hostEl.appendChild(col);
        }
        return col;
    }
    function borrowPaletteViewToggle(hostEl) {
        if (!hostEl) return;
        const col = ensureViewControlsColumn(hostEl);
        const row = document.getElementById('gpp-vs-palette-view-row');
        if (row) {
            row.classList.add('gpc-mobile-view-toggle-row');
            // Recorded manually rather than via the shared borrowNode
            // helper -- pinned to always be col's FIRST child (insertBefore
            // col.firstChild, safe even when row already IS the first
            // child -- see borrowNode's own precedent for why that self-
            // reference case is spec-safe) so a later re-borrow can never
            // reorder it after ensureVisibleRowsControl's row below.
            viewToggleBorrowedNodes.push({ node: row, originalParent: row.parentElement, originalNextSibling: row.nextElementSibling });
            col.insertBefore(row, col.firstChild);
        }
        ensureVisibleRowsControl(col);
    }

    // Ensures Ghost++'s real progress section, drop zone, and template
    // library / position-transform section are all currently rendered with
    // fresh data for the focused template, so there's something current to
    // borrow from -- ensurePaletteControllerReady() guarantees the modal
    // shell (and the left-panel sections within it) exists at all, even if
    // the real Ghost++ modal was never opened this session;
    // gppRequestUiRefresh() then populates it (and the separate right-panel
    // library/position-transform section) for whichever template is
    // actually focused right now.
    function ensureGhostPlusPlusPanelsReady() {
        ensurePaletteControllerReady();
        if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
    }

    // Return-then-rebuild for all three columns, shared by the initial
    // switch to placeholder mode and by the live-sync observer below.
    // Callers are responsible for their own "should this run right now"
    // checks (e.g. is placeholder mode even showing).
    function rebuildPlaceholderColumns() {
        returnBorrowedNodes();
        const scanPanel = document.getElementById('gpc-mobile-scan-panel');
        const uploadPanel = document.getElementById('gpc-mobile-upload-panel');
        const placementPanel = document.getElementById('gpc-mobile-placement-panel');
        if (scanPanel) { scanPanel.innerHTML = ''; buildPlaceholder1Content(scanPanel); }
        if (uploadPanel) { uploadPanel.innerHTML = ''; buildPlaceholder2Content(uploadPanel); }
        if (placementPanel) { placementPanel.innerHTML = ''; buildPlaceholder3Content(placementPanel); }
    }

    // Keeps everything borrowed from the real Ghost++ modal live-synced
    // with its own re-renders: the palette-view toggle above (borrowed for
    // as long as the compact grid exists at all -- .gpc-mobile-palette-wrap
    // is always visible, not just during placeholder mode) AND p1/p2/p3
    // (borrowed only while placeholder mode is showing). Without this, any
    // borrowed control's own interaction leaves every OTHER borrowed node
    // permanently stale. Root cause: `onChange` (the parameter
    // gpp-scan.js/gpp-placement.js/gpp-library.js/gpp-view-settings.js's
    // render functions were called with) IS gpp-init.js's refreshAll,
    // called DIRECTLY by a borrowed checkbox/button's own handler --
    // refreshAll() itself never touches gppUiRefreshSubscribers (only the
    // separate gppRequestUiRefresh() gateway does), so
    // gppSubscribeUiRefresh() alone can't catch these. refreshAll() wipes
    // and rebuilds #gpp-progress-section's content, #gpp-view-settings-
    // section's content, and (via gppRenderTemplateLibrary)
    // #gpp-lib-current-pt on every single call -- creating fresh, invisible
    // replacement sets back in their original, now-empty-looking homes,
    // while whatever we'd already borrowed keeps its own old listeners (DOM
    // relocation doesn't detach those) but stops receiving any further
    // updates. Concrete, reported symptoms of this: Lock Position / Group
    // noise checkboxes visibly desyncing from Ghost++'s own state after the
    // first interaction, Place/Preview appearing dead
    // (gppRenderPositionTransform calls gppCancelPlacementCapture() at the
    // START of every one of these re-renders, killing an in-progress
    // capture the instant any other borrowed control is touched), and the
    // palette-view toggle going stale after the very first color tap (this
    // file's own soloColor()/toggleColor() already call
    // gppRequestUiRefresh() themselves).
    //
    // Fixed the same way the hide-paint-menu.js reorder bug was: a
    // MutationObserver watching for externally-triggered DOM changes and
    // reacting immediately. Watches #gpp-modal itself (the whole modal's
    // stable, never-replaced root, built at Ghost++ init regardless of
    // whether its own modal has ever been opened) with subtree:true, since
    // the specific containers being watched have different replacement
    // semantics (#gpp-progress-section keeps its own identity and just gets
    // new children; #gpp-lib-current-pt and gpp-view-settings.js's own row
    // get entirely replaced by fresh elements, as part of their render
    // functions' own full rebuild) -- observing the whole modal catches all
    // of these uniformly.
    //
    // ONE shared observer, started once and never stopped -- there's no
    // "leaving" event to stop on, since the palette-view toggle concern is
    // permanent for as long as the compact grid exists at all, well beyond
    // any single placeholder-mode session (see the comment above the
    // palette-view toggle borrow functions for why an earlier, separate-
    // observer version of this caused a real, shipped freeze bug: two
    // observers each disconnecting only themselves before their own
    // mutation still see each OTHER's mutations, so each one's reconnect
    // re-triggers the other, forever). Disconnects itself before its OWN
    // mutations and reconnects after, rather than a same-tick flag (a
    // MutationObserver callback fires as a later microtask, by which point
    // a flag reset synchronously inside this same call would already be
    // back to its original value) -- otherwise THIS rebuild would trigger
    // itself indefinitely too, since returning and re-borrowing are
    // themselves childList mutations within the observed subtree.
    let ghostModalLiveSyncObserver = null;
    function startGhostModalLiveSync() {
        if (ghostModalLiveSyncObserver) return;
        const modalEl = document.getElementById('gpp-modal');
        if (!modalEl) return;
        let refreshQueued = false;
        ghostModalLiveSyncObserver = new MutationObserver(() => {
            if (refreshQueued) return;
            refreshQueued = true;
            Promise.resolve().then(() => {
                refreshQueued = false;
                if (!ghostModalLiveSyncObserver) return;
                ghostModalLiveSyncObserver.disconnect();
                try {
                    const wrap = document.querySelector('.gpc-mobile-palette-wrap');
                    if (wrap) {
                        returnBorrowedNodes(viewToggleBorrowedNodes);
                        borrowPaletteViewToggle(wrap);
                    }
                    const group = document.getElementById('gpc-mobile-placeholder-group');
                    if (group && !group.classList.contains('gpc-hidden')) {
                        rebuildPlaceholderColumns();
                    }
                } finally {
                    if (ghostModalLiveSyncObserver && modalEl.isConnected) {
                        ghostModalLiveSyncObserver.observe(modalEl, { childList: true, subtree: true });
                    }
                }
            });
        });
        ghostModalLiveSyncObserver.observe(modalEl, { childList: true, subtree: true });
    }

    // Paste-to-upload regression fix: gpp-init.js's wireDropZone() attaches
    // its paste listener to #gpp-modal itself (event delegation), not to
    // #gpp-drop-zone directly -- once the drop zone is borrowed out of the
    // modal's subtree, a paste there no longer bubbles to that listener.
    // Rather than reimplementing file ingestion (ingestFileList is a
    // private closure inside gpp-init.js, not reachable from here), this
    // reuses the drop zone's own REAL 'drop' listener -- which IS attached
    // directly to it, not delegated, so it's unaffected by borrowing -- by
    // dispatching a synthetic 'drop' event carrying the pasted files as its
    // dataTransfer. Attached once, globally; the guard below makes it a
    // no-op except while the drop zone is actually the one currently
    // showing in our own placeholder group.
    function handlePlaceholderPaste(event) {
        if (!event.clipboardData) return;
        const dropZone = document.getElementById('gpp-drop-zone');
        if (!dropZone) return;
        const group = document.getElementById('gpc-mobile-placeholder-group');
        if (!group || group.classList.contains('gpc-hidden') || !group.contains(dropZone)) return;
        const files = Array.from(event.clipboardData.items || [])
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter(Boolean);
        if (!files.length) return;
        const dt = new DataTransfer();
        files.forEach((file) => dt.items.add(file));
        dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    document.addEventListener('paste', handlePlaceholderPaste);

    // gpp-pt-place -> togglePrimaryMode(): per explicit product decision,
    // pressing Place should temporarily switch the native page into
    // Inspect mode for the duration of the click-to-place capture (easier
    // to aim a tap with) and switch back the instant that capture ends --
    // however it ends: placed successfully, Escape-cancelled, or torn down
    // by an unrelated fresh render. gpp-placement.js's
    // gppSubscribePlacementCaptureStart/-End (added specifically for this)
    // fire on exactly those two transitions, so this never needs to know
    // WHY a capture ended, only that it did -- and the start hook only
    // ever fires once a capture is genuinely about to begin (past
    // gppIsPositionLocked's own gate), so a click that was actually a
    // no-op can't mis-toggle this. togglePrimaryMode() is the NATIVE
    // page's own function (js/index151.js) -- called via pageWindow(),
    // same reasoning as soloColor()/toggleColor()'s changeColor() call
    // (bare `window` isn't reliably the same object as the page's own in a
    // sandboxed userscript realm). Subscribed once, globally, exactly like
    // handlePlaceholderPaste above -- the real #gpp-pt-place button is a
    // singleton regardless of whether it's currently borrowed into this
    // view or sitting in the real (possibly desktop-opened) Ghost++ modal,
    // so this applies uniformly either way, not just while this view is
    // showing.
    function togglePagePrimaryMode() {
        const win = pageWindow();
        if (win && typeof win.togglePrimaryMode === 'function') win.togglePrimaryMode();
    }
    // Start-only: tells the user where to actually tap now that the page
    // just switched into Inspect mode for them. showAlert(title, body) is
    // the native page's own top-of-screen toast (js/index151.js) -- same
    // function, same 'Info'/'Success' title convention, and same
    // pageWindow()-guarded call shape already used for it elsewhere in this
    // codebase (gpp-scan.js's gppScanAlertEnabledCount, gpp-native-shim.js).
    function handlePlacementCaptureStart() {
        togglePagePrimaryMode();
        const win = pageWindow();
        if (win && typeof win.showAlert === 'function') {
            win.showAlert('Info', 'Click on top right corner to place template on map.');
        }
    }
    if (typeof gppSubscribePlacementCaptureStart === 'function') {
        gppSubscribePlacementCaptureStart(handlePlacementCaptureStart);
    }
    if (typeof gppSubscribePlacementCaptureEnd === 'function') {
        gppSubscribePlacementCaptureEnd(togglePagePrimaryMode);
    }

    // Mirrors gpp-scan.js's own gppScanStyleButton exactly -- same shape,
    // same literal color values -- but keyed on tc() instead of t2() (see
    // the #gpc-mobile-placeholder-group CSS comment above for why). Not
    // reusable as-is since t2()/tc() aren't swappable at the call site;
    // this specific color-assignment logic is presentation, not business
    // logic Ghost++ itself decides (that stays entirely in gpp-scan.js --
    // this only re-renders the SAME already-decided primary/non-primary
    // state with different colors), so mirroring it here doesn't duplicate
    // anything. gppScanStyleButton itself is left completely untouched.
    function retintScanButton(button, primary) {
        if (!button) return;
        button.style.cssText =
            'font:inherit; padding:3px 8px; border-radius:5px; cursor:pointer;' +
            'border:1px solid ' + tc('#cbd5e1', '#45475a') + ';' +
            'background:' + (primary ? tc('#2563eb', '#89b4fa') : tc('#ffffff', '#313244')) + ';' +
            'color:' + (primary ? tc('#ffffff', '#1e1e2e') : tc('#111827', '#f5f5f5')) + ';' +
            (button.disabled ? 'opacity:.5; cursor:default;' : '');
    }

    // Placeholder 1: the real scan-progress bar + its two summary text
    // lines + 4 of its 5 real buttons (Scan progress / Show errors / Show
    // missing / Nearest error -- Clear is deliberately left behind, per
    // explicit product decision) in a 2x2 grid. All borrowed from
    // #gpp-progress-section (gpp-scan.js's gppRenderProgressBar), which the
    // ids added there exist specifically to make findable.
    function buildPlaceholder1Content(container) {
        const section = document.getElementById('gpp-progress-section');
        if (!section) return;
        const template = getFocusedTemplateWithPalette();
        const bar = section.querySelector('#gpp-scan-bar-outer');
        const summaryLine = section.querySelector('#gpp-scan-summary-line');
        const countsLine = section.querySelector('#gpp-scan-counts-line'); // only present when there's something to report
        const scanBtn = section.querySelector('#gpp-scan-btn-scan');
        const showErrBtn = section.querySelector('#gpp-scan-btn-show-err');
        const showMissBtn = section.querySelector('#gpp-scan-btn-show-miss');
        const nearestBtn = section.querySelector('#gpp-scan-btn-nearest');

        // Same primary/non-primary determination gpp-scan.js's own
        // gppRenderProgressBar makes for these same 4 buttons (scanBtn
        // always primary, nearestBtn never, the other two reflecting
        // whether that toggle is currently on) -- re-applied here with
        // tc()'s colors instead of t2()'s.
        if (scanBtn) retintScanButton(scanBtn, true);
        if (showErrBtn) retintScanButton(showErrBtn, !!(template && template._gppShowWrong));
        if (showMissBtn) retintScanButton(showMissBtn, !!(template && template._gppShowMissing));
        if (nearestBtn) retintScanButton(nearestBtn, false);

        if (bar) borrowNode(bar, container);
        if (summaryLine) borrowNode(summaryLine, container);
        if (countsLine) borrowNode(countsLine, container);

        const buttonsGrid = document.createElement('div');
        buttonsGrid.className = 'gpc-mobile-p-btn-grid';
        [scanBtn, showErrBtn, showMissBtn, nearestBtn].forEach((btn) => { if (btn) borrowNode(btn, buttonsGrid); });
        container.appendChild(buttonsGrid);
    }

    // Placeholder 2: the real #gpp-drop-zone, wholesale (drag/drop/paste/
    // click-to-choose file wiring already attached by gpp-init.js's
    // wireDropZone() -- nothing here re-touches any of that), then the real
    // "Manage templates" button (gpp-library.js) -- moved here from
    // placeholder 3 per explicit product decision, directly under the drop
    // zone rather than below the Place/Preview/Lock/Group-noise block.
    //
    // The zone's own real heading/format-list/"load from a URL" text is
    // written for desktop (mentions drag/drop and paste, plus a URL-upload
    // flow); per explicit product decision mobile painters only ever tap
    // to pick a file, so those three real elements (#gpp-drop-zone-heading/
    // -hint ids added in gpp-init.js's ensureShellBuilt specifically for
    // this, #gpp-url-upload-btn already had one) are hidden in place --
    // never removed -- in favor of one short line of our own, inserted as
    // a plain child rather than borrowed (nothing here reads or writes any
    // real Ghost++ state, so there's nothing to keep in sync). This runs
    // on every rebuild (including live-sync ticks), which is fine --
    // adding an already-present class / reusing an already-created element
    // is a no-op each time. restoreDropZoneForDesktop() (called from
    // toggleNativeControlsForPlaceholders' native-switch branch, the one
    // point this column genuinely stops coming back) undoes this, so the
    // real Ghost++ modal never shows the shortened mobile copy.
    function buildPlaceholder2Content(container) {
        const dropZone = document.getElementById('gpp-drop-zone');
        if (!dropZone) return;

        const heading = document.getElementById('gpp-drop-zone-heading');
        const hint = document.getElementById('gpp-drop-zone-hint');
        const urlBtn = document.getElementById('gpp-url-upload-btn');
        if (heading) heading.classList.add('gpc-hidden');
        if (hint) hint.classList.add('gpc-hidden');
        if (urlBtn) urlBtn.classList.add('gpc-hidden');

        let mobileHint = document.getElementById('gpc-mobile-drop-zone-hint');
        if (!mobileHint) {
            mobileHint = document.createElement('div');
            mobileHint.id = 'gpc-mobile-drop-zone-hint';
            mobileHint.innerHTML = '<strong>Click to upload template files</strong>';
        }
        dropZone.insertBefore(mobileHint, dropZone.firstChild);

        borrowNode(dropZone, container);
        const manageBtn = document.getElementById('gpp-lib-manage-btn');
        if (manageBtn) borrowNode(manageBtn, container);
    }

    // Undoes buildPlaceholder2Content's mobile-only simplification of the
    // real drop zone -- called right before it's actually sent home (see
    // toggleNativeControlsForPlaceholders), not on every live-sync
    // mid-cycle churn (rebuildPlaceholderColumns re-simplifies immediately
    // after those anyway, so there's nothing to undo there).
    function restoreDropZoneForDesktop() {
        const heading = document.getElementById('gpp-drop-zone-heading');
        const hint = document.getElementById('gpp-drop-zone-hint');
        const urlBtn = document.getElementById('gpp-url-upload-btn');
        const mobileHint = document.getElementById('gpc-mobile-drop-zone-hint');
        if (heading) heading.classList.remove('gpc-hidden');
        if (hint) hint.classList.remove('gpc-hidden');
        if (urlBtn) urlBtn.classList.remove('gpc-hidden');
        if (mobileHint) mobileHint.remove();
    }

    // Placeholder 3: Place/Unset/Go to/Preview (2x2 grid, same layout
    // approach as placeholder 1's buttons) from gpp-placement.js's
    // gppRenderPositionTransform, then Lock Position / Group noise side by
    // side with the real left/up/down/right nudge-arrow cluster (all
    // already uniquely id'd there, no further source changes needed beyond
    // this session's own #gpp-pt-nudge-row/#gpp-pt-opacity-row additions),
    // then the real opacity slider below both. The "Manage templates"
    // button lives in placeholder 2, under the drop zone -- see
    // buildPlaceholder2Content.
    function buildPlaceholder3Content(container) {
        const ptContainer = document.getElementById('gpp-lib-current-pt');
        const placeBtn = ptContainer ? ptContainer.querySelector('#gpp-pt-place') : null;
        const unsetBtn = ptContainer ? ptContainer.querySelector('#gpp-pt-unset') : null;
        const gotoBtn = ptContainer ? ptContainer.querySelector('#gpp-pt-goto') : null;
        const previewBtn = ptContainer ? ptContainer.querySelector('#gpp-pt-preview') : null;
        const lockLabel = ptContainer ? ptContainer.querySelector('#gpp-pt-lock-label') : null;
        const groupNoiseLabel = ptContainer ? ptContainer.querySelector('#gpp-pt-group-noise-label') : null;
        const nudgeRow = ptContainer ? ptContainer.querySelector('#gpp-pt-nudge-row') : null;
        const opacityRow = ptContainer ? ptContainer.querySelector('#gpp-pt-opacity-row') : null;

        const buttonsGrid = document.createElement('div');
        buttonsGrid.className = 'gpc-mobile-p-btn-grid';
        [placeBtn, unsetBtn, gotoBtn, previewBtn].forEach((btn) => { if (btn) borrowNode(btn, buttonsGrid); });
        container.appendChild(buttonsGrid);

        // Nudge arrows are borrowed WHOLESALE as one unit (not picked apart
        // into a new grid like the buttons above) -- #gpp-pt-nudge-row's own
        // inline flex-wrap:wrap;gap:6px already arranges the 4 of them
        // exactly the way Ghost++ itself designed, nothing to reconstruct.
        const checkboxAndNudgeRow = document.createElement('div');
        checkboxAndNudgeRow.className = 'gpc-mobile-p3-checkbox-nudge-row';
        const checkboxWrap = document.createElement('div');
        checkboxWrap.className = 'gpc-mobile-p3-checkboxes';
        if (lockLabel) borrowNode(lockLabel, checkboxWrap);
        if (groupNoiseLabel) borrowNode(groupNoiseLabel, checkboxWrap);
        checkboxAndNudgeRow.appendChild(checkboxWrap);
        if (nudgeRow) borrowNode(nudgeRow, checkboxAndNudgeRow);
        container.appendChild(checkboxAndNudgeRow);

        if (opacityRow) borrowNode(opacityRow, container);
    }

    // Triggered by tapping .gpp-lib-thumb-canvas (the preview thumbnail
    // itself, see getTemplatePreviewCanvas above) -- a menu switcher
    // between two states, using this file's usual display:none-via-class
    // convention for the two containers that just toggle visibility (never
    // removed from the DOM), plus the borrow/return mechanism above for the
    // real Ghost++ content that has to actually move:
    //   - Native: #gpc-native-top-bar and .gpc-mobile-controls-row visible,
    //     #gpc-mobile-placeholder-group hidden (the default/starting state).
    //   - Placeholders: the reverse, with p1/p2/p3 freshly (re)populated by
    //     borrowing from Ghost++'s real panels each time -- switching case
    //     it back to native returns everything and empties p1/p2/p3 again,
    //     so a later switch back to placeholders always borrows current
    //     data rather than showing whatever was true the last time.
    // The group and its 3 column divs are created lazily on first use and,
    // once created, persist across toggles as stable containers -- only
    // their contents and .gpc-hidden class change after that. Current state
    // is read directly off the group's own class rather than tracked in a
    // separate flag, so this stays correct even if triggered some other way
    // later.
    // .gpc-mobile-palette-wrap (the color grid + preview thumbnail itself)
    // is deliberately never touched by either direction -- it stays visible
    // throughout, exactly as it already does; nothing here references it.
    function toggleNativeControlsForPlaceholders() {
        const nativeTopBar = document.getElementById('gpc-native-top-bar');
        const controlsRow = document.querySelector('.gpc-mobile-controls-row');
        let group = document.getElementById('gpc-mobile-placeholder-group');

        if (!group) {
            group = document.createElement('div');
            group.id = 'gpc-mobile-placeholder-group';
            group.className = 'gpc-mobile-placeholder-group gpc-hidden';

            // Ids name what each column actually holds (see buildPlaceholder-
            // {1,2,3}Content) instead of their old scaffolding-era
            // gpc-mobile-placeholder-{1,2,3} names, left over from when
            // these genuinely held nothing but "placeholder 1"/"placeholder
            // 2" text.
            const scanPanel = document.createElement('div');
            scanPanel.id = 'gpc-mobile-scan-panel';
            scanPanel.className = 'gpc-mobile-placeholder';
            const uploadPanel = document.createElement('div');
            uploadPanel.id = 'gpc-mobile-upload-panel';
            uploadPanel.className = 'gpc-mobile-placeholder';
            const placementPanel = document.createElement('div');
            placementPanel.id = 'gpc-mobile-placement-panel';
            placementPanel.className = 'gpc-mobile-placeholder';
            group.append(scanPanel, uploadPanel, placementPanel);

            // Inserted where the native elements visually sit, so the rest
            // of #bottomControls (the color grid below) doesn't jump
            // whichever state ends up showing.
            if (nativeTopBar) {
                nativeTopBar.insertAdjacentElement('afterend', group);
            } else if (controlsRow) {
                controlsRow.insertAdjacentElement('beforebegin', group);
            }
        }

        const switchingToPlaceholders = group.classList.contains('gpc-hidden');
        if (switchingToPlaceholders) {
            ensureGhostPlusPlusPanelsReady();
            rebuildPlaceholderColumns();
            startGhostModalLiveSync();
        } else {
            // No stopGhostModalLiveSync() call here -- the shared observer
            // (see its own comment) stays running permanently; its callback
            // already gates the p1/p2/p3 rebuild on the group actually being
            // visible, so leaving it connected while native controls are
            // showing just means it keeps the palette-view toggle in sync
            // (its own separate, always-relevant concern) and no-ops on the
            // p1/p2/p3 half.
            restoreDropZoneForDesktop();
            returnBorrowedNodes();
            ['gpc-mobile-scan-panel', 'gpc-mobile-upload-panel', 'gpc-mobile-placement-panel'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = ''; // clears our own now-empty wrapper divs (button grids, checkbox stacks) left behind
            });
        }

        group.classList.toggle('gpc-hidden', !switchingToPlaceholders);
        if (nativeTopBar) nativeTopBar.classList.toggle('gpc-hidden', switchingToPlaceholders);
        if (controlsRow) controlsRow.classList.toggle('gpc-hidden', switchingToPlaceholders);
        dbgPush('Mobile Painting: preview thumbnail tapped -- switched to ' + (switchingToPlaceholders ? 'placeholder panels' : 'native controls') + '.', { uiComponent: 'Mobile Painting' });
    }

    // ── Larger-preview modal (eye icon on .gpc-mobile-preview-frame) ───────
    // A genuine standalone modal, built fresh on every open and torn down on
    // close -- unlike everything else this file borrows from the real
    // Ghost++ modal, nothing here is borrowed DOM. Two reasons: (1) this can
    // be opened while placeholder mode is ALSO showing (with the real
    // #gpp-scan-bar-outer/#gpp-scan-summary-line already borrowed into p1),
    // and borrowing the same singleton elements a second place at once would
    // either rip them out of p1 or require yet another live-sync concern --
    // exactly the kind of observer/borrow proliferation that caused the
    // real page-freeze regression earlier in this feature's history; (2)
    // everything shown here (a progress bar's segment widths, its summary
    // text, the color list) is pure, stateless formatting of already-real
    // data (template.scanSummary, template.palette), the same category of
    // thing gppPaletteStats/gppPaletteProgressColor already are -- not
    // Ghost++ business logic being duplicated, just display of it.

    function closeTemplatePreviewModal() {
        const existing = document.getElementById('gpc-mobile-preview-modal');
        if (existing) existing.remove();
    }

    // Mirrors gpp-scan.js's own gppRenderProgressBar readout exactly (same
    // 3-segment correct/wrong/not-yet-placed bar, same summary text
    // including gppScanFormatRelativeTime's real relative-time formatting,
    // called directly rather than reimplemented) for whichever of its
    // states currently applies -- not placed yet, not scanned yet, no
    // opaque pixels, or a real scan result.
    function buildModalProgressReadout(template) {
        const wrap = document.createElement('div');
        wrap.className = 'gpc-preview-modal-progress-wrap';

        const barOuter = document.createElement('div');
        barOuter.className = 'gpc-preview-modal-bar-outer';
        wrap.appendChild(barOuter);

        const summaryLine = document.createElement('div');
        summaryLine.className = 'gpc-preview-modal-summary-line';
        wrap.appendChild(summaryLine);

        const neutralSeg = () => {
            const seg = document.createElement('div');
            seg.style.cssText = 'width:100%; background:' + t2('#cbd5e1', '#45475a') + ';';
            barOuter.appendChild(seg);
        };

        if (!template.position) {
            barOuter.style.opacity = '0.4';
            summaryLine.textContent = 'Place the template on the map, then scan to see progress.';
        } else if (!template.scanSummary) {
            neutralSeg();
            summaryLine.textContent = 'Not scanned yet.';
        } else {
            const summary = template.scanSummary;
            const total = summary.total;
            if (total <= 0) {
                neutralSeg();
                summaryLine.textContent = 'Template has no opaque pixels -- nothing to show.';
            } else {
                const notPlaced = Math.max(0, total - summary.correct - summary.wrong);
                const pct = (value) => (value / total) * 100;

                const correctSeg = document.createElement('div');
                correctSeg.style.cssText = `width:${pct(summary.correct)}%; background:${t2('#16a34a', '#a6e3a1')};`;
                correctSeg.title = `Correct: ${summary.correct.toLocaleString()} px`;
                barOuter.appendChild(correctSeg);

                const wrongSeg = document.createElement('div');
                wrongSeg.style.cssText = `width:${pct(summary.wrong)}%; background:${t2('#dc2626', '#f38ba8')};`;
                wrongSeg.title = `Wrong color: ${summary.wrong.toLocaleString()} px`;
                barOuter.appendChild(wrongSeg);

                const notPlacedSeg = document.createElement('div');
                notPlacedSeg.style.cssText = `width:${pct(notPlaced)}%; background:${t2('#94a3b8', '#6c7086')};`;
                notPlacedSeg.title = `Not yet placed: ${notPlaced.toLocaleString()} px`;
                barOuter.appendChild(notPlacedSeg);

                const donePct = Math.round(pct(summary.correct));
                summaryLine.textContent = `${summary.correct.toLocaleString()} completed of ${total.toLocaleString()} total (${donePct}%)`
                    + (summary.scannedAt ? ` — scanned ${gppScanFormatRelativeTime(summary.scannedAt)}` : '');
            }
        }
        return wrap;
    }

    // Textarea with every color in the template (matches
    // copyHexValuesForScope's own 'all'-scope order/format exactly, since
    // that's what the copy button below actually copies) plus a clipboard
    // button that reuses copyHexValuesForScope directly for the real
    // copy-with-fallback behavior -- only the confirmation on top
    // (showAlert with the returned count) is new here.
    function buildModalColorsSection(template, core) {
        const wrap = document.createElement('div');
        wrap.className = 'gpc-preview-modal-colors-wrap';

        const label = document.createElement('label');
        label.htmlFor = 'gpc-preview-modal-colors-textarea';
        label.textContent = 'Colors in this template';
        wrap.appendChild(label);

        const row = document.createElement('div');
        row.className = 'gpc-preview-modal-colors-row';

        const textarea = document.createElement('textarea');
        textarea.id = 'gpc-preview-modal-colors-textarea';
        textarea.readOnly = true;
        const hexes = [];
        for (let index = 0; index < template.palette.length; index++) {
            hexes.push(core.packedToHex(template.palette[index]));
        }
        textarea.value = hexes.join(', ');
        row.appendChild(textarea);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'gpc-preview-modal-copy-btn';
        copyBtn.title = 'Copy to clipboard';
        copyBtn.textContent = '📋';
        copyBtn.addEventListener('click', () => {
            const count = copyHexValuesForScope(template, core, 'all');
            const win = pageWindow();
            if (win && typeof win.showAlert === 'function') {
                win.showAlert('Success', `${count.toLocaleString()} color${count === 1 ? '' : 's'} copied to clipboard.`);
            }
        });
        row.appendChild(copyBtn);

        wrap.appendChild(row);
        return wrap;
    }

    // Mirrors gpp-palette.js's own buyBtn click handler exactly (same
    // owned-check + dedup + needed-list computation, same disabled/all-
    // owned guard messages) -- duplicated rather than called since it's
    // inline inside that file's own private closure, not a reachable
    // function, but the ACTUAL "reveal profile panel, scroll, populate
    // textarea" behavior still goes through the one real function
    // (gppBulkPurchaseOpenProfilePanel), not reimplemented. Closes this
    // modal afterward so it doesn't sit on top of the profile panel it
    // just opened.
    function buildModalBuyAllButton(template, core) {
        const buyBtn = document.createElement('button');
        buyBtn.type = 'button';
        buyBtn.className = 'gpc-preview-modal-buy-btn';
        buyBtn.textContent = 'Buy all colors';
        buyBtn.title = "Reveal the profile panel's Bulk Purchase Colors card, pre-filled with every color in this template you don't already own";
        buyBtn.addEventListener('click', () => {
            if (typeof gppBulkPurchaseOpenProfilePanel !== 'function') {
                alert('Bulk Purchase Colors is disabled in GeoPixelcons++ settings.');
                return;
            }
            const ownedHex = new Set(((typeof gppReadGamePalette === 'function') ? gppReadGamePalette() : []).map((row) => String(row.hex).toUpperCase()));
            const seen = new Set();
            const needed = [];
            for (let index = 0; index < template.palette.length; index++) {
                const hex = core.packedToHex(template.palette[index]);
                if (ownedHex.has(hex) || seen.has(hex)) continue;
                seen.add(hex);
                needed.push(hex);
            }
            if (!needed.length) {
                alert('Every color in this template is already owned.');
                return;
            }
            gppBulkPurchaseOpenProfilePanel(needed);
            closeTemplatePreviewModal();
        });
        return buyBtn;
    }

    // Fresh gppLibraryRenderFullCanvas() call -- independent of
    // getTemplatePreviewCanvas's own cached canvas for the small thumbnail,
    // so there's no node-sharing conflict with the thumbnail still showing
    // behind this modal.
    function buildModalPreviewCanvas(template) {
        const frame = document.createElement('div');
        frame.className = 'gpc-preview-modal-canvas-frame';
        if (typeof gppLibraryRenderFullCanvas === 'function') {
            const canvas = gppLibraryRenderFullCanvas(template);
            if (canvas) frame.appendChild(canvas);
        }
        return frame;
    }

    function openTemplatePreviewModal(template) {
        closeTemplatePreviewModal(); // always rebuilt fresh, never reused stale
        const core = gppCreateCore();

        const overlay = document.createElement('div');
        overlay.id = 'gpc-mobile-preview-modal';
        overlay.className = 'gpc-preview-modal-overlay';
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeTemplatePreviewModal();
        });

        const box = document.createElement('div');
        box.className = 'gpc-preview-modal-box';
        overlay.appendChild(box);

        const headerRow = document.createElement('div');
        headerRow.className = 'gpc-preview-modal-header';
        const title = document.createElement('div');
        title.className = 'gpc-preview-modal-title';
        title.textContent = template.name || 'Template preview';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gpc-preview-modal-close-btn';
        closeBtn.textContent = '✖';
        closeBtn.title = 'Close';
        closeBtn.addEventListener('click', closeTemplatePreviewModal);
        headerRow.append(title, closeBtn);
        box.appendChild(headerRow);

        box.appendChild(buildModalPreviewCanvas(template));
        box.appendChild(buildModalProgressReadout(template));
        box.appendChild(buildModalColorsSection(template, core));
        box.appendChild(buildModalBuyAllButton(template, core));

        document.body.appendChild(overlay);
    }

    // Builds the compact grid for `order` (a list of palette indices, already
    // filtered/sorted to match whatever the real Ghost++ panel currently
    // shows -- see computeVisibleOrder). Clicking a swatch is NOT a plain
    // per-color toggle like Ghost++'s own grid -- per explicit product
    // decision, it "solos" that color (enable it, disable every other color
    // in this template's overlay via core.maskSet), selects it as the active
    // native paint color via changeColor(hex), and updates #hexDisplay, so a
    // mobile painter taps one swatch to see only that color's remaining
    // pixels on the map AND be ready to paint them immediately. State
    // (template.mask) and persistence/redraw are still the same real Ghost++
    // state, not a separate copy -- and gppRequestUiRefresh() is called
    // afterward so an already-open Ghost++ modal reflects the solo
    // immediately too, not just on its next poll.
    function buildTemplatePaletteGrid(template, order) {
        injectStyle();
        const core = gppCreateCore();
        const colourLookup = (typeof gppPaletteBuildColourLookup === 'function') ? gppPaletteBuildColourLookup(template) : null;
        const hasProgress = !!template.scanSummary;
        // Mirrors gpp-palette.js's own buildSwatch check exactly -- the SAME
        // gppSettings.paletteViewMode the borrowed Grid/List toggle (see
        // borrowPaletteViewToggle) writes to, so this grid switches to list
        // mode in lockstep with it. Re-read fresh on every call here (every
        // template switch, same as everything else in this function), not
        // cached -- resync()'s own "sameEverything" fast path already
        // leaves an existing grid's DOM alone between rebuilds, same as it
        // does for every other per-template detail this function decides.
        const listMode = gppSettings.paletteViewMode === 'list';

        const wrap = document.createElement('div');
        wrap.className = 'gpc-mobile-palette-wrap';

        // Distinct id from Ghost++'s own (class-only, no id) .gpp-palette-grid
        // so the two are unambiguous to refer to separately. The list-mode
        // modifier class is Ghost++'s own real one
        // (.gpp-palette-grid.gpp-palette-list-mode, injected by
        // gppInjectPaletteStyle -- display:flex/column instead of the
        // tiled display:grid); its rule isn't scoped to any one container
        // id, so reusing the class here is enough to pick it up, no new
        // CSS needed for the container itself.
        const grid = document.createElement('div');
        grid.id = 'gpc-mobile-palette-grid';
        grid.className = 'gpp-palette-grid';
        grid.classList.toggle('gpp-palette-list-mode', listMode);
        // Overrides the class rule's own hardcoded max-height:60px (inline
        // beats class, no !important needed) with the user's own "Visible
        // rows" preference -- see ensureVisibleRowsControl/
        // computeGridMaxHeight. Applied here so a template switch (this
        // function's own rebuild trigger) picks up the current setting,
        // not just the dropdown's own change handler.
        grid.style.maxHeight = computeGridMaxHeight(getVisibleRowsSetting()) + 'px';

        function soloColor(targetIndex, hex) {
            for (let index = 0; index < template.palette.length; index++) {
                core.maskSet(template.mask, index, index === targetIndex);
            }
            // Set BEFORE the update loop below, so setSwatchState's own
            // liveState.selectedHex check reflects the NEW selection, not
            // whatever was selected before this click. soloMode is set true
            // here too -- a solo click always re-establishes solo mode, even
            // if an Enable All/Owned/Filtered bulk action had switched to
            // multi-select mode moments earlier.
            if (liveState) { liveState.selectedHex = hex; liveState.soloMode = true; }
            const swatches = grid.children;
            for (let i = 0; i < swatches.length; i++) {
                const swatch = swatches[i];
                const swatchIndex = Number(swatch.dataset.index);
                setSwatchState(swatch, swatch.dataset.hex, swatchIndex === targetIndex);
            }
            const pw = pageWindow();
            if (typeof pw.changeColor === 'function') pw.changeColor(hex);
            updateHexDisplay(hex);
            gppState.persistTemplateState(template).catch((err) => {
                console.error('[GeoPixelcons++] Mobile Painting: failed to persist template state', err);
            });
            if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
            if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        }

        // Multi-select mode counterpart to soloColor: used instead whenever
        // liveState.soloMode is false (last Enable action was All/Owned/
        // Filtered, not Selected) -- toggles just the clicked color's own
        // mask bit, leaving every other color's visibility exactly as it
        // was ("the visibility of each color remains"). Still tracks
        // liveState.selectedHex (so switching the Enable dropdown back to
        // "Selected" knows which color to re-solo), but the ring never
        // shows for it while soloMode stays false (see setSwatchState).
        // changeColor/updateHexDisplay only fire when the click is turning
        // the color ON -- turning one off shouldn't also make it the active
        // native paint color.
        function toggleColor(targetIndex, hex) {
            const nowEnabled = !core.maskHas(template.mask, targetIndex);
            core.maskSet(template.mask, targetIndex, nowEnabled);
            if (liveState) liveState.selectedHex = hex;
            // grid.children is in `order` (sorted/filtered) sequence, NOT
            // palette-index sequence -- can't index it by targetIndex
            // directly, has to be matched by its own dataset.index, same as
            // soloColor's own update loop does.
            const swatches = grid.children;
            for (let i = 0; i < swatches.length; i++) {
                if (Number(swatches[i].dataset.index) === targetIndex) {
                    setSwatchState(swatches[i], hex, nowEnabled);
                    break;
                }
            }
            if (nowEnabled) {
                const pw = pageWindow();
                if (typeof pw.changeColor === 'function') pw.changeColor(hex);
                updateHexDisplay(hex);
            }
            gppState.persistTemplateState(template).catch((err) => {
                console.error('[GeoPixelcons++] Mobile Painting: failed to persist template state', err);
            });
            if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
            if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        }

        order.forEach((index) => {
            const hex = core.packedToHex(template.palette[index]);
            const enabled = core.maskHas(template.mask, index);
            // Called unconditionally now (matches gpp-palette.js's own
            // buildSwatch, which does the same) -- gppPaletteStats already
            // safely handles a null/undefined colourLookup on its own
            // (falls back to no per-color progress entry, same as the
            // no-scan state), so the extra null-guard around the outer
            // call here was redundant, and list mode below needs a real
            // stats object unconditionally (gppPaletteApplyListLayout
            // reads stats.total even when hasProgress is false, for its
            // "<total> px" fallback text).
            const stats = gppPaletteStats(template, index, colourLookup);

            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'gpp-swatch' + (listMode ? ' gpp-swatch-list' : '');
            swatch.dataset.hex = hex;
            swatch.dataset.index = String(index);
            setSwatchState(swatch, hex, enabled);

            if (listMode) {
                // Real Ghost++ function, called directly rather than
                // reimplemented -- builds the exact same chip/hex/progress-
                // text/mini-bar row gpp-palette.js's own buildSwatch does
                // in list mode (see that function and its shared
                // gppPaletteApplyListLayout helper). Defensively typeof-
                // guarded, matching how gppPaletteShowTooltip is handled
                // below, with a plain colored square as the fallback rather
                // than an unstyled blank button if gpp-palette.js somehow
                // hasn't loaded.
                if (typeof gppPaletteApplyListLayout === 'function') {
                    gppPaletteApplyListLayout(swatch, hex, stats, hasProgress);
                } else {
                    swatch.style.backgroundColor = hex;
                }
            } else {
                swatch.style.backgroundColor = hex;
                // Per-swatch completion badge -- mirrors gpp-palette.js's
                // own grid-mode badge exactly (same classes, same real
                // gppPaletteProgressColor() call for the in-progress
                // interpolation, not reimplemented) so it reads identically
                // to the real Ghost++ grid: white circle + green check once
                // complete, a black unfilled ring before any of that color
                // is placed, a red-to-green interpolated ring while in
                // progress. List mode skips this entirely, same as
                // gpp-palette.js's own buildSwatch does -- the row's own
                // progress text/bar already conveys the same thing, spelled
                // out instead of iconified.
                // .gpp-swatch-progress's own CSS (injected by Ghost++'s real
                // gppInjectPaletteStyle, already triggered by
                // ensurePaletteControllerReady elsewhere in this file) is
                // reused as-is -- nothing scoped/overridden here, since
                // it's data-driven rather than a light/dark theme concern.
                // Only shown once a scan has actually run for this template
                // (progress is otherwise unknown, not "0%") -- same
                // hasProgress/stats.total>0 gate gpp-palette.js itself uses.
                if (hasProgress && stats.total > 0) {
                    const badge = document.createElement('span');
                    if (stats.completed >= stats.total) {
                        badge.className = 'gpp-swatch-progress gpp-swatch-progress-complete';
                    } else if (stats.completed <= 0) {
                        badge.className = 'gpp-swatch-progress gpp-swatch-progress-unstarted';
                    } else {
                        badge.className = 'gpp-swatch-progress gpp-swatch-progress-inprogress';
                        badge.style.background = gppPaletteProgressColor(stats.completed / stats.total);
                    }
                    badge.setAttribute('aria-hidden', 'true');
                    swatch.appendChild(badge);
                }
            }
            swatch.addEventListener('click', () => {
                if (liveState && liveState.soloMode === false) toggleColor(index, hex);
                else soloColor(index, hex);
            });
            // Same custom mouse-following tooltip as Ghost++'s real grid,
            // not a native title attribute -- see gppPaletteShowTooltip's own
            // comment in gpp-palette.js for why.
            if (typeof gppPaletteShowTooltip === 'function') {
                swatch.addEventListener('mouseenter', (event) => gppPaletteShowTooltip(event, hex, stats, hasProgress));
                swatch.addEventListener('mousemove', (event) => gppPaletteMoveTooltip(event));
                swatch.addEventListener('mouseleave', () => gppPaletteHideTooltip());
            }
            grid.appendChild(swatch);
        });

        wrap.appendChild(grid);

        // Palette view toggle (Grid/List) -- see the borrowPaletteViewToggle/
        // startGhostModalLiveSync blocks above for the full picture.
        // Returned-then-reborrowed on every call here (a template switch),
        // same discipline as rebuildPlaceholderColumns uses for p1/p2/p3 --
        // the OLD wrap (and whatever it's currently holding) is about to be
        // discarded via showCompactGrid's replaceWith, so the toggle needs
        // to be reclaimed before that happens, not left to go down with it.
        returnBorrowedNodes(viewToggleBorrowedNodes);
        borrowPaletteViewToggle(wrap);
        startGhostModalLiveSync();

        // Small live preview of the focused template's own ghost image, to
        // the grid's right -- see the .gpc-mobile-preview-frame CSS comment
        // above for the sizing/fidelity reasoning. The click listener lives
        // on the canvas itself (getTemplatePreviewCanvas), not this wrapper
        // -- see that function's own comment for why.
        const previewCanvas = getTemplatePreviewCanvas(template);
        if (previewCanvas) {
            const previewFrame = document.createElement('div');
            previewFrame.className = 'gpc-mobile-preview-frame';
            previewFrame.title = template.name || 'Template preview';
            previewFrame.appendChild(previewCanvas);

            // Opens the larger-preview modal -- see openTemplatePreviewModal
            // above. stopPropagation is load-bearing: this button sits
            // inside the frame, which is ITSELF the click target that
            // toggles placeholder mode (the listener lives on previewCanvas,
            // attached in getTemplatePreviewCanvas) -- without it, tapping
            // this button would also fire that toggle underneath it.
            const infoBtn = document.createElement('button');
            infoBtn.type = 'button';
            infoBtn.className = 'gpc-mobile-preview-info-btn';
            infoBtn.title = 'Larger preview';
            infoBtn.textContent = 'ℹ️';
            infoBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                openTemplatePreviewModal(template);
            });
            previewFrame.appendChild(infoBtn);

            wrap.appendChild(previewFrame);
            // Safe to call here even though `wrap` itself isn't inserted
            // into the document until showCompactGrid runs right after
            // this function returns -- ResizeObserver.observe() doesn't
            // require a connected target; it just won't have anything to
            // report until the frame actually gets a real layout box. See
            // ensurePreviewFrameStaysSquare's own comment for the rest.
            ensurePreviewFrameStaysSquare(previewFrame);
        }

        return wrap;
    }

    // ── Bulk-action / sort / filter / get-hex row ──────────────────────────
    // A compact row of controls "duplicated" from Ghost++'s own palette
    // panel (Enable all/owned/filtered, Disable all, Get hex values, Sort,
    // Filter), per explicit product decision folding Ghost++'s 3 separate
    // Enable buttons into one Enable▾ dropdown to fit the space.
    //
    // Enable/Disable/Get-hex only need public primitives (core.maskSet/
    // maskHas, gppReadGamePalette(), computeVisibleOrder()'s already-exposed
    // renderState) -- reimplemented directly against those rather than
    // reaching into gpp-palette.js's private closures, low drift risk since
    // this is plain set-membership logic already verified against its real
    // handlers (allBtn/noneBtn/ownedBtn/enableFilteredBtn/
    // copyHexValuesForScope).
    //
    // Sort and Filter are different: their RESULT (renderState.visible) is
    // already reused via computeVisibleOrder, but *setting* them requires
    // actually running Ghost++'s private 8-sort/6-filter algorithm, which
    // only exists inside a live gpp-palette.js controller instance. Rather
    // than duplicate that pipeline a second time (the exact drift risk
    // computeVisibleOrder was built to avoid), these controls are a genuine
    // remote control: gppEnsurePaletteSectionReady() (gpp-init.js) guarantees
    // #gpp-palette-section's controller exists without ever revealing the
    // modal, then our own dropdown/select write straight into ITS real form
    // elements and dispatch the same events its own listeners are wired to
    // -- one shared source of truth, so a change here reaches the real
    // Ghost++ grid too (if open) exactly the same way a change made inside
    // the real modal would.
    function ensurePaletteControllerReady() {
        if (typeof gppEnsurePaletteSectionReady === 'function') gppEnsurePaletteSectionReady();
    }

    // Mirrors Ghost++'s own product decision (gpp-scan.js's gppTryAutoScan,
    // wired into gpp-palette.js's own Enable/Sort/Filter controls): any use
    // of this row's Enable/Sort/Filter options first tries to run a scan
    // too, so progress numbers stay fresh without a separate manual click.
    // ensurePaletteControllerReady() first, since gppTryAutoScan() needs
    // #gpp-progress-section (and the scan button inside it) to already
    // exist, which it might not if the real Ghost++ modal was never opened
    // this session; gppRequestUiRefresh() then renders that section's
    // current content (including the button) for whichever template is
    // actually focused right now. No-ops quietly (via gppTryAutoScan's own
    // guards) if Ghost++ isn't enabled, nothing is focused, or the template
    // isn't placed on the map yet.
    function tryAutoScanFirst() {
        ensurePaletteControllerReady();
        if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
        if (typeof gppTryAutoScan === 'function') gppTryAutoScan();
    }

    function getRealPaletteFormControls() {
        const container = document.getElementById('gpp-palette-section');
        if (!container) return null;
        return {
            container,
            searchInput: container.querySelector('.gpp-palette-search-input'),
            sortSelect: container.querySelector('.gpp-palette-sort-select'),
            filterInputs: Array.from(container.querySelectorAll('.gpp-palette-filter-menu input[type="checkbox"]')),
        };
    }

    function notifyMaskChanged(template) {
        gppState.persistTemplateState(template).catch((err) => {
            console.error('[GeoPixelcons++] Mobile Painting: failed to persist template state', err);
        });
        if (typeof gppRendererSchedule === 'function') gppRendererSchedule();
        if (typeof gppRequestUiRefresh === 'function') gppRequestUiRefresh();
    }

    // All/Owned/Filtered enable multiple colors at once, so grid swatch
    // clicks switch out of solo mode too (see the click handler in
    // buildTemplatePaletteGrid) -- a tap now toggles just that one color
    // instead of soloing it, and the ring stops showing (setSwatchState
    // gates it on soloMode). liveState.selectedHex is deliberately left
    // alone, NOT cleared, here -- it's kept as a "last individually touched
    // color" memory so switching the Enable dropdown back to "Selected"
    // (bulkEnableSelected below) knows what to re-solo, per explicit
    // product decision: swapping to Selected while a color is already
    // selected should immediately re-solo it.
    function bulkEnableAll(template, core) {
        tryAutoScanFirst();
        if (liveState) liveState.soloMode = false;
        template.mask = core.makeFullMask(template.palette.length, template.counts);
        notifyMaskChanged(template);
    }

    function bulkDisableAll(template) {
        template.mask = new Uint32Array(Math.ceil(template.palette.length / 32));
        notifyMaskChanged(template);
    }

    function bulkEnableOwned(template, core) {
        tryAutoScanFirst();
        if (liveState) liveState.soloMode = false;
        const rows = (typeof gppReadGamePalette === 'function') ? gppReadGamePalette() : [];
        const allowedHex = new Set();
        rows.forEach((row) => { if (row && row.hex) allowedHex.add(String(row.hex).toUpperCase()); });
        const mask = new Uint32Array(Math.ceil(template.palette.length / 32));
        for (let index = 0; index < template.palette.length; index++) {
            if (allowedHex.has(core.packedToHex(template.palette[index]))) core.maskSet(mask, index, true);
        }
        template.mask = mask;
        notifyMaskChanged(template);
    }

    // Mirrors the real enableFilteredBtn handler: an active search term
    // (read from the real search box, if it exists) excludes non-matches
    // even without the "Show search results only" checkbox on, exactly like
    // the real button -- see gpp-palette.js's own comment on this exact
    // behavior for why.
    function bulkEnableFiltered(template, core) {
        tryAutoScanFirst();
        if (liveState) liveState.soloMode = false;
        const realState = getRealPaletteRenderState(template.id);
        const real = getRealPaletteFormControls();
        const hasActiveSearch = !!(real && real.searchInput && real.searchInput.value.trim().length > 0);
        const matchingSet = (realState && realState.matching) || new Set();
        const visible = (realState && realState.visible) || [];
        const mask = new Uint32Array(Math.ceil(template.palette.length / 32));
        visible.forEach((index) => {
            if (hasActiveSearch && !matchingSet.has(index)) return;
            core.maskSet(mask, index, true);
        });
        template.mask = mask;
        notifyMaskChanged(template);
    }

    // "Selected" under the Enable dropdown: switches grid clicks back to
    // solo mode, and -- per explicit product decision -- if a color is
    // already marked selected (liveState.selectedHex, set by the last
    // individual swatch tap even while in multi-select mode) immediately
    // replays soloColor's exact effect for it (disable every other color,
    // enable just this one), rather than waiting for the next tap. The mode
    // switch itself always happens; the immediate re-solo only happens if
    // there's something to re-solo -- no-ops (with a dbgPush diagnostic) if
    // nothing is currently selected, or if that hex isn't in this
    // template's palette (e.g. focused template changed since it was set).
    function bulkEnableSelected(template, core) {
        tryAutoScanFirst();
        if (liveState) liveState.soloMode = true;
        const hex = liveState && liveState.selectedHex;
        if (!hex) {
            dbgPush('Mobile Painting: switched to solo mode, but no color is currently selected to re-solo.', { uiComponent: 'Mobile Painting' });
            return;
        }
        let targetIndex = -1;
        for (let index = 0; index < template.palette.length; index++) {
            if (core.packedToHex(template.palette[index]) === hex) { targetIndex = index; break; }
        }
        if (targetIndex === -1) {
            dbgPush('Mobile Painting: switched to solo mode, but the selected color is not in this template\'s palette.', { uiComponent: 'Mobile Painting' });
            return;
        }
        for (let index = 0; index < template.palette.length; index++) {
            core.maskSet(template.mask, index, index === targetIndex);
        }
        const pw = pageWindow();
        if (typeof pw.changeColor === 'function') pw.changeColor(hex);
        updateHexDisplay(hex);
        notifyMaskChanged(template);
    }

    const GPC_HEX_VALUE_SCOPES = [
        { value: 'all', text: 'All colors' },
        { value: 'owned', text: 'Owned colors only' },
        { value: 'notOwned', text: 'Not owned colors only' },
        { value: 'enabled', text: 'Enabled colors only' },
        { value: 'enabledOwned', text: 'Enabled + owned colors' },
        { value: 'filtered', text: 'Filtered colors only' },
        { value: 'filteredOwned', text: 'Filtered + owned colors only' },
    ];

    function copyHexValuesForScope(template, core, scope) {
        ensurePaletteControllerReady();
        const ownedHex = new Set(((typeof gppReadGamePalette === 'function') ? gppReadGamePalette() : []).map((row) => String(row.hex).toUpperCase()));
        const realState = getRealPaletteRenderState(template.id);
        const filteredSet = new Set((realState && realState.visible) || []);
        const hexes = [];
        for (let index = 0; index < template.palette.length; index++) {
            const hex = core.packedToHex(template.palette[index]);
            const isOwned = ownedHex.has(hex);
            const isEnabled = core.maskHas(template.mask, index);
            const isFiltered = filteredSet.has(index);
            let include;
            switch (scope) {
                case 'all': include = true; break;
                case 'owned': include = isOwned; break;
                case 'notOwned': include = !isOwned; break;
                case 'enabled': include = isEnabled; break;
                case 'enabledOwned': include = isEnabled && isOwned; break;
                case 'filtered': include = isFiltered; break;
                case 'filteredOwned': include = isFiltered && isOwned; break;
                default: include = false;
            }
            if (include) hexes.push(hex);
        }
        const text = hexes.join(', ');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => alert(text || 'No matching colors.'));
        } else {
            alert(text || 'No matching colors.');
        }
        return hexes.length;
    }

    // Class names below are OUR OWN (.gpc-ctrl-*), defined in injectStyle()
    // with t2()/isDarkMode() branching -- see the comment on
    // .gpc-mobile-controls-row there for why this uses this codebase's own
    // theme signal rather than native Tailwind dark: classes.

    // Shared across all 4 of this row's dropdowns (Enable/Sort/Filter/Get
    // hex values -- 3 via buildDropdownButton below, Filter via its own
    // near-identical buildFilterControl) -- without this, each one only
    // ever closed ITSELF (via its own document-level outside-click
    // listener, or picking one of its own options) and had no way to know
    // about, let alone close, any of the OTHERS. Opening dropdown A while
    // dropdown B was already open left both visibly open at once: A's own
    // button click calls event.stopPropagation() (needed so the SAME
    // click that opens A doesn't also immediately close A via A's own
    // outside-click listener) -- but that ALSO means the click never
    // reaches document, so B's own independent outside-click listener
    // never fires either. Populated once, at buildControlsRow()'s own
    // one-time build (never rebuilt afterward, so no accumulation risk).
    let openControlsRowMenus = [];
    function closeOtherControlsRowMenus(exceptCloseFn) {
        openControlsRowMenus.forEach((closeFn) => {
            if (closeFn !== exceptCloseFn) closeFn();
        });
    }

    // Generic small popup-menu button. Used for both the "Enable" and
    // "Get hex values" menus -- Ghost++'s own filter-dropdown DOM pattern
    // (trigger button + absolutely-positioned menu) without reusing its
    // classes, so this row's styling can't be perturbed by Ghost++'s own
    // re-injected stylesheet.
    function buildDropdownButton(labelText, optionDefs) {
        const dropdown = document.createElement('div');
        dropdown.className = 'gpc-ctrl-dropdown';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gpc-ctrl-btn';
        const buttonText = document.createElement('span');
        buttonText.className = 'gpc-ctrl-btn-text';
        buttonText.textContent = labelText;
        const arrow = document.createElement('span');
        arrow.className = 'gpc-ctrl-btn-arrow';
        arrow.textContent = '▾';
        button.append(buttonText, arrow);

        const menu = document.createElement('div');
        menu.className = 'gpc-ctrl-menu';
        const closeMenu = () => menu.classList.remove('gpc-open');
        openControlsRowMenus.push(closeMenu);
        optionDefs.forEach(({ text, onClick }) => {
            const option = document.createElement('div');
            option.className = 'gpc-ctrl-menu-option';
            option.textContent = text;
            option.addEventListener('click', () => {
                closeMenu();
                onClick();
            });
            menu.appendChild(option);
        });
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const opening = !menu.classList.contains('gpc-open');
            if (opening) closeOtherControlsRowMenus(closeMenu);
            menu.classList.toggle('gpc-open');
        });
        menu.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', closeMenu);

        dropdown.append(button, menu);
        return { el: dropdown, setLabel: (text) => { buttonText.textContent = text; } };
    }

    // Our own <select>, but its options are cloned from the real sort
    // select's current options (values + text) rather than a hardcoded
    // second copy of GPP_PALETTE_SORT_OPTIONS -- one less place for the two
    // lists to drift apart. A dropdown button (same as Enable/Filter/Get hex
    // values) rather than a native <select> -- a <select> always displays
    // whichever option is currently chosen, so it can't stay labeled "Sort";
    // this is an action menu, not a persistent state display. Only synced
    // once, at build time; a sort option that only unlocks after a scan runs
    // (see gpp-palette.js's syncProgressGatedControls) won't retroactively
    // appear here without a page reload -- disclosed limitation, not chased
    // further.
    function buildSortControl() {
        ensurePaletteControllerReady();
        const real = getRealPaletteFormControls();
        const optionDefs = (real && real.sortSelect ? Array.from(real.sortSelect.options) : []).map((realOpt) => ({
            text: realOpt.textContent,
            onClick: () => {
                tryAutoScanFirst();
                const fresh = getRealPaletteFormControls();
                if (!fresh || !fresh.sortSelect) return;
                fresh.sortSelect.value = realOpt.value;
                fresh.sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
            },
        }));
        return buildDropdownButton('Sort', optionDefs).el;
    }

    // Checkboxes cloned (value + label text) from the real filter menu's
    // current checkboxes, same anti-drift reasoning as buildSortControl.
    // Each one writes straight through to its real counterpart on change --
    // no local filter state of our own. Note: no search box here (out of
    // scope for this row), so "Show search results only" is inert unless a
    // search term also happens to be set in the real Ghost++ panel; and the
    // "Filter within pixel count..." checkbox reuses whatever min/max the
    // real panel currently has rather than adding a second pair of number
    // inputs here.
    function buildFilterControl() {
        ensurePaletteControllerReady();
        const real = getRealPaletteFormControls();
        const optionDefs = (real ? real.filterInputs : []).map((realInput) => ({
            value: realInput.value,
            text: realInput.parentElement && realInput.parentElement.querySelector('span')
                ? realInput.parentElement.querySelector('span').textContent
                : realInput.value,
            checked: realInput.checked,
        }));

        const dropdown = document.createElement('div');
        dropdown.className = 'gpc-ctrl-dropdown';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gpc-ctrl-btn';
        const buttonText = document.createElement('span');
        buttonText.className = 'gpc-ctrl-btn-text';
        buttonText.textContent = 'Filter';
        const arrow = document.createElement('span');
        arrow.className = 'gpc-ctrl-btn-arrow';
        arrow.textContent = '▾';
        button.append(buttonText, arrow);

        const menu = document.createElement('div');
        menu.className = 'gpc-ctrl-menu';
        const closeMenu = () => menu.classList.remove('gpc-open');
        openControlsRowMenus.push(closeMenu);
        optionDefs.forEach(({ value, text, checked }) => {
            const label = document.createElement('label');
            label.className = 'gpc-ctrl-menu-option';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = value;
            input.checked = checked;
            const span = document.createElement('span');
            span.textContent = text;
            label.append(input, span);
            menu.appendChild(label);

            input.addEventListener('change', () => {
                tryAutoScanFirst();
                const fresh = getRealPaletteFormControls();
                const target = fresh && fresh.filterInputs.find((el) => el.value === value);
                if (!target) return;
                target.checked = input.checked;
                target.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const opening = !menu.classList.contains('gpc-open');
            if (opening) closeOtherControlsRowMenus(closeMenu);
            menu.classList.toggle('gpc-open');
        });
        menu.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', closeMenu);

        dropdown.append(button, menu);
        return dropdown;
    }

    function buildControlsRow() {
        const row = document.createElement('div');
        row.className = 'gpc-mobile-controls-row';

        function withTemplate(fn) {
            return () => {
                const template = getFocusedTemplateWithPalette();
                if (!template) {
                    dbgPush('Mobile Painting: control row action ignored -- no focused Ghost++ template.', { uiComponent: 'Mobile Painting' });
                    return;
                }
                fn(template, gppCreateCore());
            };
        }

        const enableDropdown = buildDropdownButton('Enable', [
            { text: 'All', onClick: withTemplate(bulkEnableAll) },
            { text: 'Owned', onClick: withTemplate(bulkEnableOwned) },
            { text: 'Filtered', onClick: withTemplate(bulkEnableFiltered) },
            { text: 'Selected', onClick: withTemplate(bulkEnableSelected) },
        ]);
        const disableAllBtn = document.createElement('button');
        disableAllBtn.type = 'button';
        disableAllBtn.className = 'gpc-ctrl-btn';
        const disableAllText = document.createElement('span');
        disableAllText.className = 'gpc-ctrl-btn-text';
        disableAllText.textContent = 'Disable all';
        disableAllBtn.appendChild(disableAllText);
        disableAllBtn.addEventListener('click', withTemplate(bulkDisableAll));

        const sortControl = buildSortControl();
        const filterDropdown = buildFilterControl();

        const hexDropdown = buildDropdownButton('Get hex values', GPC_HEX_VALUE_SCOPES.map(({ value, text }) => ({
            text,
            onClick: withTemplate((template, core) => {
                const count = copyHexValuesForScope(template, core, value);
                hexDropdown.setLabel(count ? `Copied ${count}!` : 'Nothing to copy');
                setTimeout(() => hexDropdown.setLabel('Get hex values'), 1200);
            }),
        })));

        row.append(enableDropdown.el, disableAllBtn, sortControl, filterDropdown, hexDropdown.el);
        return row;
    }

    // ── Live sync ────────────────────────────────────────────────────────
    // Keeps the inline grid matching Ghost++'s real state after the initial
    // swap: switching the focused template, toggling a color's show/hide, or
    // changing the real panel's sort/search/filter selections, all need to
    // be reflected here too.
    //
    // Two sources feed the same resync() function:
    //   1. gppSubscribeUiRefresh() -- gpp-init.js's real external-refresh
    //      hook. Confirmed to fire on a palette mask toggle (gpp-palette.js's
    //      setSwatchMaskState calls gppRequestUiRefresh() directly), so a
    //      color toggled from the real modal reaches this near-instantly.
    //   2. A 1s poll fallback -- gpp-library.js's "switch focused template"
    //      click handlers only call their own local refreshAll(), never
    //      gppRequestUiRefresh(), and sort/filter control changes only call
    //      performFilterSort() directly -- neither reaches subscribers.
    //      Polling is the only reliable way to catch either without patching
    //      more of Ghost++'s own code than the one renderState hook above.
    let liveState = null; // { bottomControls, savedNativeContainer, wrap, grid, templateId, orderKey, paletteViewMode, selectedHex, soloMode }

    // Shown in .gpc-mobile-palette-wrap's usual spot whenever no Ghost++
    // template is focused -- most notably the very first time a mobile
    // painter ever opens this feature, before they've selected or imported
    // anything. Without this, they'd have NO way to reach placeholder mode
    // at all: its own trigger (the click listener in
    // getTemplatePreviewCanvas) lives on the preview thumbnail, which is
    // itself inside .gpc-mobile-palette-wrap -- and that wrap only exists
    // once resync() has something to build it FOR. toggleNativeControls
    // ForPlaceholders itself was already fully independent of template
    // state (its own insertion point is #gpc-native-top-bar/
    // .gpc-mobile-controls-row, neither of which are template-scoped), and
    // Ghost++'s own real p1/p2/p3 content already renders its own "Select
    // or import a template"-style messaging with nothing focused, same as
    // the real desktop modal would -- this prompt is the only genuinely
    // missing piece, not a new code path into placeholder mode itself.
    // Anchored to the SAME insertion point showCompactGrid uses for the
    // real wrap (savedNativeContainer, afterend) so the rest of
    // #bottomControls doesn't jump depending on which of the two is
    // currently showing. Idempotent (checked via getElementById) so
    // resync() can call this on every no-template tick, not just the
    // transition into that state.
    function ensureNoTemplatePrompt() {
        if (document.getElementById('gpc-mobile-no-template-prompt')) return;
        const prompt = document.createElement('div');
        prompt.id = 'gpc-mobile-no-template-prompt';
        prompt.className = 'gpc-mobile-no-template-prompt';
        prompt.textContent = 'Click for template options';
        prompt.addEventListener('click', toggleNativeControlsForPlaceholders);
        liveState.savedNativeContainer.insertAdjacentElement('afterend', prompt);
    }
    function removeNoTemplatePrompt() {
        const prompt = document.getElementById('gpc-mobile-no-template-prompt');
        if (prompt) prompt.remove();
    }

    function resync() {
        if (!liveState) return;
        // Keeps the shared stylesheet (control row buttons/menus, and the
        // #gpc-mobile-placeholder-group overrides for whatever's currently
        // borrowed into p1/p2/p3) live-refreshed on the SAME cadence as
        // everything else resync() already reacts to -- previously
        // injectStyle() only ever ran from inside buildTemplatePaletteGrid,
        // which this function only calls when the focused template or its
        // visible order actually changed (see the `sameEverything` fast
        // path below); on an otherwise-idle tick (the overwhelmingly common
        // case -- same template, nothing to rebuild) that path returns
        // early and injectStyle() never got a chance to notice a theme
        // change. Ghost++'s own modal doesn't have this problem because
        // every one of ITS renders re-reads t2() fresh regardless of
        // whether anything else about that render actually changed --
        // this matches that same behavior instead of gating the refresh on
        // an unrelated "did the grid's own content change" check.
        injectStyle();
        const template = getFocusedTemplateWithPalette();

        if (!template) {
            if (liveState.wrap) {
                // Reclaim the borrowed palette-view toggle BEFORE the wrap
                // holding it gets removed -- otherwise it would silently go
                // down with it (detached, not returned to its real gpp-
                // view-settings-section home), leaving that section missing
                // its Grid/List row if the real Ghost++ modal is ever opened
                // afterward.
                returnBorrowedNodes(viewToggleBorrowedNodes);
                liveState.wrap.remove();
                // Restore visibility rather than re-inserting the node --
                // it was never removed from the DOM (see showCompactGrid
                // below), only hidden, so the native site's own periodic
                // SetColors() (js/index153.js) keeps finding
                // .control-container-colors and quietly re-populating it
                // the whole time, exactly like it would with this
                // extension off. Actually detaching it (an earlier version
                // of this code used replaceWith()) made every one of those
                // native sync ticks log "Color container
                // '.control-container-colors' not found." to the console.
                liveState.savedNativeContainer.style.display = '';
                dbgPush('Mobile Painting: no focused Ghost++ template anymore -- restored the native color grid.', { uiComponent: 'Mobile Painting' });
                liveState.wrap = null;
                liveState.grid = null;
                liveState.templateId = null;
                liveState.orderKey = null;
                liveState.paletteViewMode = null;
                liveState.selectedHex = null;
                liveState.soloMode = true;
            }
            ensureNoTemplatePrompt();
            return;
        }

        removeNoTemplatePrompt(); // a template just became focused (or already was) -- the real wrap is about to take (or already takes) its place
        const order = computeVisibleOrder(template);
        const orderKey = order.join(',');
        // Mirrors gpp-palette.js's own listMode check (gppSettings.
        // paletteViewMode === 'list') -- included in sameEverything on
        // purpose: toggling the borrowed Grid/List button (see
        // borrowPaletteViewToggle) doesn't touch the template or its
        // visible order, so without this a Grid<->List switch with no
        // accompanying template switch would silently stay on the fast
        // path below forever and this grid would never actually pick up
        // the new mode -- same class of gap the injectStyle() reactivity
        // fix above addressed, just for a full rebuild's worth of state
        // instead of a stylesheet.
        const paletteViewMode = gppSettings.paletteViewMode === 'list' ? 'list' : 'grid';
        const sameEverything = liveState.grid && liveState.templateId === template.id && liveState.orderKey === orderKey && liveState.paletteViewMode === paletteViewMode;

        if (sameEverything) {
            const core = gppCreateCore();
            const swatches = liveState.grid.children;
            for (let i = 0; i < swatches.length; i++) {
                const swatch = swatches[i];
                const index = Number(swatch.dataset.index);
                const enabled = core.maskHas(template.mask, index);
                if (swatch.classList.contains('gpp-swatch-off') === enabled) {
                    setSwatchState(swatch, swatch.dataset.hex, enabled);
                }
            }
            return;
        }

        const replacement = buildTemplatePaletteGrid(template, order);
        showCompactGrid(replacement);
        liveState.grid = replacement.querySelector('.gpp-palette-grid');
        liveState.templateId = template.id;
        liveState.orderKey = orderKey;
        liveState.paletteViewMode = paletteViewMode;
        dbgPush('Mobile Painting: (re)built palette grid for template "' + template.id + '" (' + order.length + '/' + template.palette.length + ' colors visible).', { uiComponent: 'Mobile Painting' });
    }

    // Swaps the compact grid in without ever detaching
    // .control-container-colors from the document -- only hides it (see
    // resync()'s own comment for why that distinction matters). First swap
    // hides the native container and inserts the replacement right after it;
    // later rebuilds (template switch, order change) just replace the
    // previous compact grid with the new one, native container untouched.
    function showCompactGrid(replacement) {
        if (liveState.wrap) {
            liveState.wrap.replaceWith(replacement);
        } else {
            liveState.savedNativeContainer.style.display = 'none';
            liveState.savedNativeContainer.insertAdjacentElement('afterend', replacement);
        }
        liveState.wrap = replacement;
    }

    function mount(bottomControls) {
        applyFullWidthBottomControls(bottomControls);
        dbgPush('Mobile Painting: #bottomControls found -- applied full-width layout.', { uiComponent: 'Mobile Painting' });

        const nativeContainer = bottomControls.querySelector('.control-container-colors');
        if (!nativeContainer) {
            dbgPush('Mobile Painting: no .control-container-colors found inside #bottomControls -- nothing to replace.', { uiComponent: 'Mobile Painting' });
            return;
        }

        // Assigns a stable id to the native top bar (hexDisplay/sortBtn/
        // brush buttons/energy/gpc-paint-close) -- it has none of its own,
        // and hide-paint-menu.js already has to find it by class
        // (':scope > .w-full.flex') alongside its own controlsRow naming.
        // An id makes it easier to identify in DevTools and gives any
        // future code (including this file's own) a direct, stable
        // reference instead of a class-based lookup.
        //
        // MUST be scoped through ':scope > div' (innerWrapper) first, same
        // as hide-paint-menu.js's own lookup -- an earlier version used the
        // unscoped bottomControls.querySelector('.w-full.flex') here, which
        // doesn't just search topBar's own class combination
        // (w-full flex items-center justify-between gap-3); it also matches
        // innerWrapper ITSELF, since innerWrapper's own class list (bg-white
        // ... flex flex-col ... gap-4 w-full) separately contains both
        // "w-full" and "flex" too. querySelector() considers the whole
        // subtree of descendants, and innerWrapper -- a valid descendant of
        // bottomControls -- comes before its own children in document
        // order, so it was winning as the "first match" instead of the
        // actual top bar div. That meant #gpc-native-top-bar ended up
        // pointing at the ENTIRE white background panel, and toggling
        // .gpc-hidden on it (see toggleNativeControlsForPlaceholders) hid that whole
        // panel's background -- exactly the "blue showing through" bug
        // reported, confirmed via the reporter's own DevTools inspection.
        const innerWrapperEl = bottomControls.querySelector(':scope > div');
        const nativeTopBar = innerWrapperEl ? innerWrapperEl.querySelector(':scope > .w-full.flex') : null;
        if (nativeTopBar && !nativeTopBar.id) nativeTopBar.id = 'gpc-native-top-bar';

        liveState = { bottomControls, savedNativeContainer: nativeContainer, wrap: null, grid: null, templateId: null, orderKey: null, paletteViewMode: null, selectedHex: null, soloMode: true };

        // The native Sort button (sortAndSetColors()) is redundant with our
        // own Sort control below -- hidden in place, same reasoning as
        // .control-container-colors above: never remove a native node
        // outright, since something native may still expect to find it.
        const nativeSortBtn = bottomControls.querySelector('#sortBtn');
        if (nativeSortBtn) nativeSortBtn.style.display = 'none';

        // Inserted right before the (native or compact) color grid, not
        // appended to the end of innerWrapper -- appendChild put it below
        // the grid, since the grid always sits earlier (2nd child, right
        // after the top bar). nativeContainer stays a stable anchor point
        // for this regardless of whether it or our compact grid is what's
        // actually showing at any given moment (see showCompactGrid).
        const controlsRowEl = buildControlsRow();
        nativeContainer.insertAdjacentElement('beforebegin', controlsRowEl);

        // The Paint Menu Controls feature's own collapse toggle
        // (hide-paint-menu.js's #gpc-hide-paint-toggle / #gpc-paint-flip-pos)
        // reorders the NATIVE top bar (.w-full.flex, with hexDisplay/
        // sortBtn/brush buttons/energy) and this hidden .control-container-
        // colors relative to EACH OTHER on every press via plain
        // insertBefore() calls, regardless of whether their relative order
        // actually needs to change -- see its own updateState(). Those
        // calls don't know about controlsRowEl sitting between them, so the
        // net effect drags the native top bar to end up AFTER controlsRowEl
        // instead of before it: an unrelated feature's DOM write stepping
        // on this one's. Rather than coupling the two features together,
        // this MutationObserver just re-asserts controlsRowEl's own
        // position (immediately before nativeContainer, its stable anchor)
        // whenever the shared parent's children change for ANY reason --
        // self-heals from this specific interaction, and any similar one,
        // without needing to know what moved what. Debounced onto a
        // microtask (same pattern as gpp-init.js's own gppRefreshTheme) so
        // a burst of synchronous mutations only triggers one recheck.
        const swapParent = nativeContainer.parentElement;
        if (swapParent) {
            let reorderCheckQueued = false;
            new MutationObserver(() => {
                if (reorderCheckQueued) return;
                reorderCheckQueued = true;
                Promise.resolve().then(() => {
                    reorderCheckQueued = false;
                    if (controlsRowEl.nextElementSibling !== nativeContainer) {
                        nativeContainer.insertAdjacentElement('beforebegin', controlsRowEl);
                    }
                });
            }).observe(swapParent, { childList: true });
        }

        // Ghost++'s template library loads from IndexedDB asynchronously (see
        // gppInitRuntime()), and may not be settings-enabled at all -- retry
        // for the same 15s window the rest of this codebase uses rather than
        // giving up after a single check.
        resync();
        if (!liveState.grid) {
            const retryInterval = setInterval(() => {
                resync();
                if (liveState.grid) clearInterval(retryInterval);
            }, 500);
            setTimeout(() => {
                clearInterval(retryInterval);
                if (!liveState.grid) {
                    dbgPush('Mobile Painting: gave up after 15s -- no focused Ghost++ template with a decoded palette was found; left the native color grid in place.', { uiComponent: 'Mobile Painting' });
                }
            }, 15000);
        }

        if (typeof gppSubscribeUiRefresh === 'function') gppSubscribeUiRefresh(() => resync());
        setInterval(() => resync(), 1000);
    }

    const existing = document.getElementById('bottomControls');
    if (existing) {
        mount(existing);
    } else {
        const watchStartedAt = Date.now();
        const observer = new MutationObserver(() => {
            const el = document.getElementById('bottomControls');
            if (el) {
                observer.disconnect();
                dbgPush('Mobile Painting: #bottomControls appeared ' + (Date.now() - watchStartedAt) + 'ms after watching started -- mounting now.', { uiComponent: 'Mobile Painting' });
                mount(el);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            if (!document.getElementById('bottomControls')) {
                dbgPush('Mobile Painting: gave up after 15s -- #bottomControls was never found.', { uiComponent: 'Mobile Painting' });
                console.error('[GeoPixelcons++] Mobile Painting: never found #bottomControls.');
            }
        }, 15000);
    }

            })();
            _featureStatus.mobilePaintingExtension = 'ok';
            console.log('[GeoPixelcons++] ✅ Mobile Painting loaded');
        } catch (err) {
            _featureStatus.mobilePaintingExtension = 'error';
            dbgPush(`Mobile Painting init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Mobile Painting' });
            console.error('[GeoPixelcons++] ❌ Mobile Painting failed:', err);
        }
    }
