
    // Shared with Painting Menu Overhaul later in the assembled private IIFE.
    // Paint Menu Controls owns the scale lifecycle; PMO only asks it to
    // re-measure when its own live panels change.
    let gpcPaintMenuControlsScale = null;

    // ============================================================
    //  FEATURE: Paint Menu Controls [hidePaintMenu]
    // ============================================================
    if (_settings.hidePaintMenu) {
        try {
            (function _init_hidePaintMenu() {

    const runPaintMenuInit = (bottomControls, energyDisplay) => {
        // --- 1. CONFIGURATION & STATE ---
        let isCollapsed = false;
        let isTop = false; // whether panel is docked to top
        let dragOffsetX = 0; // px offset from center (persisted)
        const DRAG_STORAGE_KEY = 'gpc-paint-drag-offset';
        const TOP_STORAGE_KEY = 'gpc-paint-is-top';
        try { dragOffsetX = parseFloat(localStorage.getItem(DRAG_STORAGE_KEY)) || 0; } catch {}
        try { isTop = localStorage.getItem(TOP_STORAGE_KEY) === 'true'; } catch {}

        // --- 2. CONTAINER STYLING ---
        // Remove conflicting Tailwind classes
        bottomControls.classList.remove('-translate-x-1/2');
        bottomControls.classList.remove('left-1/2');

        // Keep the original width behavior but add positioning control
        bottomControls.style.position = 'fixed';
        bottomControls.style.bottom = '1rem';
        bottomControls.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        // Remove any width override to preserve original responsive behavior
        bottomControls.style.width = '';
        bottomControls.style.maxWidth = '';

        // Start centered (preserve original behavior)
        bottomControls.style.left = '50%';
        bottomControls.style.transform = 'translateX(-50%)';

        // --- 3. CREATE UI ELEMENTS ---

        // A. Top bar container (holds drag handle, collapse button, reset button)
        const topBar = document.createElement('div');
        topBar.style.cssText = `
            position: absolute;
            top: -24px;
            left: 0;
            right: 0;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 20;
            pointer-events: none;
        `;

        // B. Collapse Button (first, on the left)
        const toggleBtn = document.createElement('button');
        toggleBtn.innerHTML = '▼';
        toggleBtn.id = 'gpc-hide-paint-toggle';
        toggleBtn.style.cssText = `
            pointer-events: auto;
            width: 28px;
            height: 24px;
            border-bottom: none;
            border-radius: 8px 8px 0 0;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        toggleBtn.className = 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300';

        // C. Drag handle bar (to the right of collapse)
        const dragBar = document.createElement('div');
        dragBar.id = 'gpc-paint-drag-bar';
        dragBar.style.cssText = `
            pointer-events: auto;
            cursor: grab;
            height: 24px;
            width: 28px;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
            justify-content: center;
            user-select: none;
            border-bottom: none;
            margin-left: 2px;
        `;
        dragBar.className = 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500';
        dragBar.innerHTML = '<span style="font-size:10px;pointer-events:none;">⋮⋮</span>';

        // D. Reset position button
        const resetBtn = document.createElement('button');
        resetBtn.id = 'gpc-paint-reset-pos';
        resetBtn.title = 'Reset position to center';
        resetBtn.innerHTML = '↺';
        resetBtn.style.cssText = `
            pointer-events: auto;
            width: 28px;
            height: 24px;
            border-bottom: none;
            border-radius: 8px 8px 0 0;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-left: 2px;
        `;
        resetBtn.className = 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300';

        // E. Flip top/bottom button
        const flipBtn = document.createElement('button');
        flipBtn.id = 'gpc-paint-flip-pos';
        flipBtn.title = 'Move to top / bottom';
        flipBtn.innerHTML = isTop ? '⬇' : '⬆';
        flipBtn.style.cssText = `
            pointer-events: auto;
            width: 28px;
            height: 24px;
            border-bottom: none;
            border-radius: 8px 8px 0 0;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-left: 2px;
        `;
        flipBtn.className = 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300';

        // F. Close (switch to inspect mode) button — next to energy display
        const closeBtn = document.createElement('button');
        closeBtn.id = 'gpc-paint-close';
        closeBtn.title = 'Switch to Inspect Mode';
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
            width: 24px;
            height: 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-left: 6px;
            flex-shrink: 0;
            vertical-align: middle;
        `;
        closeBtn.className = 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600';
        closeBtn.addEventListener('click', () => {
            const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (typeof _pw.togglePrimaryMode === 'function') _pw.togglePrimaryMode();
        });
        energyDisplay.parentElement.style.display = 'flex';
        energyDisplay.parentElement.style.alignItems = 'center';
        energyDisplay.insertAdjacentElement('afterend', closeBtn);

        topBar.appendChild(toggleBtn);
        topBar.appendChild(dragBar);
        topBar.appendChild(resetBtn);
        topBar.appendChild(flipBtn);
        topBar.id = 'gpc-paint-menu-toolbar';
        bottomControls.appendChild(topBar);

        // --- G. Compact paint overflow: move close + brushes into topBar ---
        if (_settings.compactPaintOverflow) {
            // Create compact close button for the topBar
            const compactCloseBtn = document.createElement('button');
            compactCloseBtn.id = 'gpc-compact-close';
            compactCloseBtn.title = 'Switch to Inspect Mode';
            compactCloseBtn.innerHTML = '✕';
            compactCloseBtn.style.cssText = `
                pointer-events: auto;
                width: 28px;
                height: 24px;
                border-bottom: none;
                border-radius: 8px 8px 0 0;
                cursor: pointer;
                font-size: 13px;
                font-weight: 700;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-left: 2px;
            `;
            compactCloseBtn.className = 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600';
            compactCloseBtn.addEventListener('click', () => {
                const _pw2 = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                if (typeof _pw2.togglePrimaryMode === 'function') _pw2.togglePrimaryMode();
            });

            // Create compact brush button for the topBar
            const compactBrushBtn = document.createElement('button');
            compactBrushBtn.id = 'gpc-compact-brush';
            compactBrushBtn.title = 'Toggle saved brushes';
            compactBrushBtn.innerHTML = '🖌️';
            compactBrushBtn.style.cssText = `
                pointer-events: auto;
                width: 28px;
                height: 24px;
                border-bottom: none;
                border-radius: 8px 8px 0 0;
                cursor: pointer;
                font-size: 13px;
                display: none;
                align-items: center;
                justify-content: center;
                margin-left: 2px;
            `;
            compactBrushBtn.className = 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600';
            compactBrushBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const realToggle = document.getElementById('brush-swap-toggle');
                if (realToggle) realToggle.click();
                // Reposition dropdown near this compact button using a rAF so layout is settled
                requestAnimationFrame(() => {
                    const dropdown = document.getElementById('brush-swap-dropdown');
                    if (!dropdown) return;
                    // Move dropdown to body so transforms on ancestors don't affect fixed positioning
                    if (dropdown.parentElement !== document.body) {
                        document.body.appendChild(dropdown);
                    }
                    const btnRect = compactBrushBtn.getBoundingClientRect();
                    const paintIsTop = localStorage.getItem('gpc-paint-is-top') === 'true';
                    dropdown.style.position = 'fixed';
                    dropdown.style.right = 'auto';
                    dropdown.style.margin = '0';
                    // Align dropdown left edge with button left edge
                    dropdown.style.left = btnRect.left + 'px';
                    if (paintIsTop) {
                        dropdown.style.top = (btnRect.bottom + 4) + 'px';
                        dropdown.style.bottom = 'auto';
                    } else {
                        dropdown.style.top = 'auto';
                        dropdown.style.bottom = (window.innerHeight - btnRect.top + 4) + 'px';
                    }
                });
            });

            // Forward scroll-to-swap from compact button to the real toggle
            compactBrushBtn.addEventListener('wheel', (e) => {
                const realToggle = document.getElementById('brush-swap-toggle');
                if (realToggle) {
                    realToggle.dispatchEvent(new WheelEvent('wheel', {
                        deltaY: e.deltaY,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        bubbles: false
                    }));
                }
                e.preventDefault();
            }, { passive: false });

            topBar.appendChild(compactBrushBtn);
            topBar.appendChild(compactCloseBtn);

            // Position X button absolutely to the right so it doesn't shift the centered group
            compactCloseBtn.style.position = 'absolute';
            compactCloseBtn.style.right = '20px';
            compactCloseBtn.style.marginLeft = '0';

            // Hide the inline close button immediately
            closeBtn.style.display = 'none';

            // Hide brush-swap-toggle when it appears, and show compact brush btn
            function hideBrushToggle() {
                const brushToggle = document.getElementById('brush-swap-toggle');
                if (brushToggle) {
                    // Hide the button visually but keep the wrapper layout intact
                    // so the dropdown can still position itself correctly
                    brushToggle.style.visibility = 'hidden';
                    brushToggle.style.width = '0';
                    brushToggle.style.padding = '0';
                    brushToggle.style.margin = '0';
                    brushToggle.style.border = 'none';
                    brushToggle.style.overflow = 'hidden';
                    compactBrushBtn.style.display = 'flex';
                    return true;
                }
                return false;
            }

            // Try immediately, and also watch for it being added later by paintBrushSwap
            if (!hideBrushToggle()) {
                const compactObserver = new MutationObserver(() => {
                    if (hideBrushToggle()) compactObserver.disconnect();
                });
                compactObserver.observe(bottomControls, { childList: true, subtree: true });
                // Safety cleanup
                setTimeout(() => compactObserver.disconnect(), 30000);
            }
        }

        // --- "Paint Here" button injected into hoverInfo ---
        function injectPaintHereButton() {
            if (document.getElementById('gpc-paint-here-btn')) return;
            const hoverInfo = document.getElementById('hoverInfo');
            if (!hoverInfo) return;

            const paintBtn = document.createElement('button');
            paintBtn.id = 'gpc-paint-here-btn';
            paintBtn.className = 'w-full bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 transition-colors flex items-center justify-center gap-2 cursor-pointer';
            paintBtn.style.marginTop = '8px';
            paintBtn.innerHTML = '🎨 Paint Here';
            paintBtn.addEventListener('click', () => {
                const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
                if (typeof _pw.togglePrimaryMode === 'function') _pw.togglePrimaryMode();
            });

            // Insert after the Share Location button's parent div
            const shareBtn = document.getElementById('shareLocationBtn');
            const shareContainer = shareBtn?.parentElement;
            if (shareContainer) {
                shareContainer.insertAdjacentElement('afterend', paintBtn);
            } else {
                hoverInfo.appendChild(paintBtn);
            }
        }

        // Observe for hoverInfo appearing
        const hoverObserver = new MutationObserver(() => injectPaintHereButton());
        hoverObserver.observe(document.body, { childList: true, subtree: true });
        injectPaintHereButton();

        // Identify the two main content divs for reordering
        // The first child div is the controls row (buttons, energy, etc.)
        // The second is .control-container-colors (color swatches)
        const innerWrapper = bottomControls.querySelector(':scope > div');
        const controlsRow = innerWrapper
            ? innerWrapper.querySelector(':scope > .w-full.flex')
            : null;
        const colorsDiv = innerWrapper
            ? innerWrapper.querySelector(':scope > .control-container-colors')
            : null;
        // Painting Menu Overhaul can replace the live native nodes inside this
        // feature's scale-content layer. Resolve their current shared parent
        // inside updateState instead of retaining the old direct-wrapper
        // parent, so a later collapse/dock never calls insertBefore() with a
        // reference node that has moved.
        const getSwapParent = () => (
            controlsRow && colorsDiv && controlsRow.parentElement === colorsDiv.parentElement
                ? controlsRow.parentElement
                : null
        );

        // Paint Menu Controls owns the optional scale surface. It exists
        // independently of Painting Menu Overhaul, so native painters can use
        // it with only this feature enabled. The outer #bottomControls width
        // remains site-owned; only a child surface scales and reports its
        // scaled height back to the native wrapper.
        let paintMenuScale = null;
        function createPaintMenuControlsScale() {
            const root = innerWrapper;
            if (!root) return null;

            const MIN = 75;
            const MAX = 125;
            const STEP = 5;
            const DEFAULT = 100;
            const STORAGE_KEY = 'geo++_paint_menu_controls_ui_scale';
            const PMO_STORAGE_KEY = 'geo++_painting_menu_overhaul_ui_scale';
            const LEGACY_STORAGE_KEY = 'geo++_mobile_painting_ui_scale';
            const state = { content: null, percent: DEFAULT, frame: 0, viewportFrame: 0, widthLock: null };
            let tab = null;
            let popover = null;
            let input = null;
            let value = null;
            let pendingCommitFrame = 0;

            const clamp = (raw) => {
                const numeric = Number(raw);
                if (!Number.isFinite(numeric)) return DEFAULT;
                const stepped = Math.round(numeric / STEP) * STEP;
                return Math.max(MIN, Math.min(MAX, stepped));
            };
            const read = () => {
                try {
                    for (const key of [STORAGE_KEY, PMO_STORAGE_KEY, LEGACY_STORAGE_KEY]) {
                        const raw = localStorage.getItem(key);
                        if (raw === null) continue;
                        const parsed = clamp(raw);
                        if (key !== STORAGE_KEY) localStorage.setItem(STORAGE_KEY, String(parsed));
                        return parsed;
                    }
                } catch (e) {}
                return DEFAULT;
            };
            const persist = (percent) => {
                try { localStorage.setItem(STORAGE_KEY, String(percent)); } catch (e) {}
            };
            const isDark = () => {
                try {
                    const rootStyle = getComputedStyle(document.documentElement);
                    if (/\bdark\b/i.test(rootStyle.colorScheme || '')) return true;
                } catch (e) {}
                try {
                    const raw = localStorage.getItem('geo++_settings');
                    const parsed = raw ? JSON.parse(raw) : null;
                    return !!(parsed && parsed.theme === 'simple_black');
                } catch (e) { return false; }
            };
            const ensureStyle = () => {
                let style = document.getElementById('gpc-pmc-scale-style');
                if (!style) {
                    style = document.createElement('style');
                    style.id = 'gpc-pmc-scale-style';
                    document.head.appendChild(style);
                }
                style.textContent = `
                    /* Per explicit user feedback: root's own native padding
                       (the site's real #bottomControls inner wrapper --
                       class="bg-white ... p-4 ... w-full", confirmed live at
                       16px on all four sides) sat between .gpc-pmc-scale-
                       content and the panel's outer edge more than wanted.
                       Reduced by ~20% here rather than touched via JS --
                       measureHeight()/lockNativeWidth() both already re-read
                       root's OWN computed padding live
                       (getComputedStyle(root).paddingTop etc.) every time
                       they run, so overriding it here is picked up by that
                       existing math automatically; no JS changes needed.
                       13px, not the literal 16*0.8=12.8px: confirmed live
                       (getBoundingClientRect vs. alignToolbar's own
                       content.offsetTop, which rounds to the nearest whole
                       pixel by spec) that a fractional padding value leaves
                       a ~0.2px gap between #gpc-paint-menu-toolbar/
                       #gpc-compact-brush and the panel edge -- integer
                       padding values measured drift:0 in every case tested,
                       fractional ones didn't. !important since native p-4
                       is a real Tailwind utility class applied via root's
                       own class="", not ours -- source order alone (this
                       tag is appended to <head> after page load) would
                       likely already win, but !important matches this
                       codebase's own established convention for overriding
                       native utility classes regardless. Scoped to
                       .gpc-pmc-scale-root itself (only ever added by THIS
                       feature's own mount(), see below) so #bottomControls
                       keeps its native 16px whenever Paint Menu Controls is
                       off. */
                    .gpc-pmc-scale-root { position: relative; z-index: 30; overflow: visible; padding: 13px !important; }
                    .gpc-pmc-scale-content { position: relative; display: flex; flex-direction: column; flex: 0 0 auto; width: 100%; box-sizing: border-box; gap: inherit; min-width: 0; }
                    #gpc-pmc-scale-tab { pointer-events: auto; margin-left: 2px; }
                    #gpc-paint-menu-toolbar.gpc-pmc-scale-popover-open { z-index: 1200 !important; }
                    #gpc-pmc-scale-popover[hidden] { display: none; }
                `;
            };
            const ensureContent = () => {
                if (state.content && state.content.isConnected) return state.content;
                let content = root.querySelector(':scope > .gpc-pmc-scale-content');
                if (!content) {
                    content = document.createElement('div');
                    content.className = 'gpc-pmc-scale-content';
                    const children = Array.from(root.children);
                    root.appendChild(content);
                    children.forEach((child) => content.appendChild(child));
                }
                if (topBar.parentElement !== content) content.appendChild(topBar);
                state.content = content;
                return content;
            };
            const restoreContent = () => {
                const content = ensureContent();
                Array.from(root.children).forEach((child) => {
                    if (child !== content) content.appendChild(child);
                });
                if (topBar.parentElement !== content) content.appendChild(topBar);
            };
            const sync = () => {
                if (input) input.value = String(state.percent);
                if (value) value.textContent = `${state.percent}%`;
            };
            const applyPopoverTheme = () => {
                if (!popover) return;
                const dark = isDark();
                popover.style.cssText = [
                    'position:absolute', 'bottom:calc(100% + 6px)', 'left:50%', 'transform:translateX(-50%)',
                    'width:224px', 'box-sizing:border-box', 'padding:8px', 'border-radius:8px',
                    `border:1px solid ${dark ? '#45475a' : '#d1d5db'}`,
                    `background:${dark ? '#1e1e2e' : '#ffffff'}`,
                    `color:${dark ? '#f5f5f5' : '#111827'}`,
                    'box-shadow:0 8px 24px rgba(0,0,0,.28)', 'pointer-events:auto',
                ].join(';');
                const labelRow = popover.querySelector('.gpc-pmc-scale-label-row');
                const scaleValue = popover.querySelector('.gpc-pmc-scale-value');
                if (labelRow) labelRow.style.color = dark ? '#cdd6f4' : '#475569';
                if (scaleValue) scaleValue.style.color = dark ? '#a6adc8' : '#64748b';
                if (input) input.style.accentColor = dark ? '#89b4fa' : '#2563eb';
            };
            const alignToolbar = () => {
                const content = state.content;
                if (!content || topBar.parentElement !== content || !topBar.offsetHeight) return;
                const scale = state.percent / 100;
                const toolbarHeight = topBar.offsetHeight;
                const pixels = (n) => `${Math.round(n * 1000) / 1000}px`;
                if (topBar.style.top !== 'auto') {
                    const next = pixels(-toolbarHeight - (content.offsetTop / scale));
                    if (topBar.style.top !== next) topBar.style.top = next;
                    return;
                }
                const inset = Math.max(0, root.offsetHeight - (content.offsetTop + content.offsetHeight * scale));
                const next = pixels(-toolbarHeight - (inset / scale));
                if (topBar.style.bottom !== next) topBar.style.bottom = next;
            };
            const measureHeight = (content, scale) => {
                const previousHeight = root.style.height;
                const previousTransform = content.style.transform;
                root.style.height = '';
                content.style.transform = 'none';
                const height = content.getBoundingClientRect().height;
                const rootStyle = getComputedStyle(root);
                const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
                    .reduce((total, property) => total + (parseFloat(rootStyle[property]) || 0), 0);
                content.style.transform = previousTransform;
                if (!Number.isFinite(height) || height <= 0) {
                    root.style.height = previousHeight;
                    return;
                }
                root.style.height = `${Math.ceil(chrome + height * scale)}px`;
            };
            // `transform` does not affect layout, so the content needs an
            // inverse width to keep its rendered left/right edges fixed. That
            // inverse width must not, however, become the auto-sized outer
            // panel's new intrinsic width. Lock the existing native width for
            // the duration of a non-100% scale, then restore the exact inline
            // value when the user returns to 100%. On a viewport resize we
            // briefly release and refresh this lock, so GeoPixels still owns
            // the normal responsive re-centering rather than preserving a
            // stale pixel width from the old window size.
            const lockNativeWidth = () => {
                if (state.widthLock) return;
                const style = getComputedStyle(root);
                const rectWidth = root.getBoundingClientRect().width;
                const horizontalChrome = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
                    .reduce((total, property) => total + (parseFloat(style[property]) || 0), 0);
                const contentWidth = style.boxSizing === 'border-box'
                    ? rectWidth
                    : Math.max(0, rectWidth - horizontalChrome);
                state.widthLock = { inlineWidth: root.style.width };
                root.style.width = `${Math.round(contentWidth * 1000) / 1000}px`;
            };
            const releaseNativeWidth = () => {
                if (!state.widthLock) return;
                root.style.width = state.widthLock.inlineWidth;
                state.widthLock = null;
            };
            const apply = (raw) => {
                const percent = clamp(raw);
                const scale = percent / 100;
                const content = ensureContent();
                root.style.setProperty('--gpc-pmc-ui-scale', String(scale));
                root.dataset.gpcPmcUiScale = String(percent);
                state.percent = percent;
                if (percent === DEFAULT) {
                    releaseNativeWidth();
                    content.style.width = '';
                    content.style.marginLeft = '';
                    content.style.marginRight = '';
                    content.style.transformOrigin = '';
                    content.style.transform = '';
                    root.style.height = '';
                } else {
                    lockNativeWidth();
                    const inverseWidthPercent = 100 / scale;
                    const sideMarginPercent = (100 - inverseWidthPercent) / 2;
                    content.style.width = `${inverseWidthPercent}%`;
                    content.style.marginLeft = `${sideMarginPercent}%`;
                    content.style.marginRight = `${sideMarginPercent}%`;
                    content.style.transformOrigin = 'top center';
                    content.style.transform = `scale(${scale})`;
                    measureHeight(content, scale);
                }
                alignToolbar();
                sync();
            };
            const requestLayout = () => {
                if (state.frame) return;
                state.frame = requestAnimationFrame(() => {
                    state.frame = 0;
                    const content = ensureContent();
                    if (state.percent !== DEFAULT) measureHeight(content, state.percent / 100);
                    alignToolbar();
                });
            };
            const requestViewportReflow = () => {
                if (state.viewportFrame) return;
                state.viewportFrame = requestAnimationFrame(() => {
                    state.viewportFrame = 0;
                    if (state.percent === DEFAULT) {
                        requestLayout();
                        return;
                    }
                    // The host needs one layout frame without our temporary
                    // pixel width before we take the new responsive width.
                    releaseNativeWidth();
                    root.style.height = '';
                    requestAnimationFrame(() => {
                        if (state.percent === DEFAULT) {
                            requestLayout();
                            return;
                        }
                        const content = ensureContent();
                        lockNativeWidth();
                        measureHeight(content, state.percent / 100);
                        alignToolbar();
                    });
                });
            };
            const setPopoverOpen = (open) => {
                if (!tab || !popover) return;
                applyPopoverTheme();
                popover.hidden = !open;
                tab.setAttribute('aria-expanded', String(open));
                topBar.classList.toggle('gpc-pmc-scale-popover-open', open);
            };
            const ensureTab = () => {
                if (tab) return;
                tab = document.createElement('button');
                tab.type = 'button';
                tab.id = 'gpc-pmc-scale-tab';
                tab.textContent = '↕';
                tab.title = 'Open Paint Menu Controls scale';
                tab.setAttribute('aria-label', 'Open Paint Menu Controls scale');
                tab.setAttribute('aria-expanded', 'false');
                tab.setAttribute('aria-controls', 'gpc-pmc-scale-popover');
                tab.className = flipBtn.className;
                const flipStyle = flipBtn.getAttribute('style');
                if (flipStyle !== null) tab.setAttribute('style', flipStyle);
                tab.style.marginLeft = '2px';
                flipBtn.insertAdjacentElement('afterend', tab);

                popover = document.createElement('div');
                popover.id = 'gpc-pmc-scale-popover';
                popover.hidden = true;
                popover.setAttribute('role', 'dialog');
                popover.setAttribute('aria-label', 'Paint Menu Controls scale');
                const control = document.createElement('div');
                control.className = 'gpc-pmc-scale-control';
                control.style.cssText = 'width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:3px';
                const labelRow = document.createElement('div');
                labelRow.className = 'gpc-pmc-scale-label-row';
                labelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;font-weight:600';
                const label = document.createElement('label');
                label.htmlFor = 'gpc-pmc-ui-scale';
                label.textContent = 'Paint Menu scale';
                value = document.createElement('output');
                value.id = 'gpc-pmc-ui-scale-value';
                value.className = 'gpc-pmc-scale-value';
                value.htmlFor = 'gpc-pmc-ui-scale';
                value.style.fontVariantNumeric = 'tabular-nums';
                labelRow.append(label, value);
                input = document.createElement('input');
                input.id = 'gpc-pmc-ui-scale';
                input.className = 'gpc-pmc-scale-input';
                input.type = 'range';
                input.min = String(MIN);
                input.max = String(MAX);
                input.step = String(STEP);
                input.value = String(state.percent);
                input.title = 'Scale Paint Menu Controls';
                input.setAttribute('aria-label', 'Paint Menu Controls scale');
                input.style.cssText = 'width:100%;min-width:0;margin:0';
                const updateReadout = () => { value.textContent = `${input.value}%`; };
                const commit = () => {
                    const next = clamp(input.value);
                    input.value = String(next);
                    updateReadout();
                    if (pendingCommitFrame) cancelAnimationFrame(pendingCommitFrame);
                    pendingCommitFrame = requestAnimationFrame(() => {
                        pendingCommitFrame = 0;
                        if (state.percent !== next) {
                            apply(next);
                            persist(next);
                        }
                    });
                };
                input.addEventListener('input', updateReadout);
                input.addEventListener('change', commit);
                tab.addEventListener('click', (event) => {
                    event.stopPropagation();
                    setPopoverOpen(popover.hidden);
                    requestLayout();
                });
                control.append(labelRow, input);
                popover.appendChild(control);
                topBar.appendChild(popover);
                document.addEventListener('pointerdown', (event) => {
                    if (!popover.hidden && !popover.contains(event.target) && event.target !== tab) setPopoverOpen(false);
                }, true);
                document.addEventListener('keydown', (event) => {
                    if (event.key !== 'Escape' || popover.hidden) return;
                    setPopoverOpen(false);
                    tab.focus();
                });
                updateReadout();
                applyPopoverTheme();
            };
            const mount = () => {
                ensureStyle();
                root.classList.add('gpc-pmc-scale-root');
                state.percent = read();
                ensureTab();
                restoreContent();
                const content = ensureContent();
                const rootObserver = new MutationObserver(() => {
                    restoreContent();
                    requestLayout();
                });
                rootObserver.observe(root, { childList: true });
                const contentObserver = new MutationObserver(requestLayout);
                contentObserver.observe(content, { childList: true, subtree: true });
                topBar.addEventListener('click', requestLayout);
                window.addEventListener('resize', requestViewportReflow, { passive: true });
                if (window.visualViewport) {
                    window.visualViewport.addEventListener('resize', requestViewportReflow, { passive: true });
                }
                apply(state.percent);
            };
            return Object.freeze({ get tab() { return tab; }, mount, requestLayout, apply, getRoot: () => root, getContent: () => ensureContent() });
        }

        // --- 4. LOGIC ENGINE ---

        const updateState = () => {
            const COLLAPSE_OFFSET = 48;

            // Vertical docking
            if (isTop) {
                bottomControls.style.bottom = 'auto';
                bottomControls.style.top = '1rem';

                // Reorder: colors first, controls second (buttons closer to map edge)
                const swapParent = getSwapParent();
                if (swapParent) {
                    swapParent.insertBefore(colorsDiv, controlsRow);
                }

                // Button bar goes BELOW the panel when docked top
                topBar.style.top = 'auto';
                topBar.style.bottom = '-24px';
                [toggleBtn, dragBar, resetBtn, flipBtn, paintMenuScale && paintMenuScale.tab].filter(Boolean).forEach(el => {
                    el.style.borderRadius = '0 0 8px 8px';
                    el.style.borderBottom = '';
                    el.style.borderTop = 'none';
                });
                // Also style compact overflow buttons if they exist
                const compactClose1 = document.getElementById('gpc-compact-close');
                const compactBrush1 = document.getElementById('gpc-compact-brush');
                if (compactClose1) { compactClose1.style.borderRadius = '0 0 8px 8px'; compactClose1.style.borderBottom = ''; compactClose1.style.borderTop = 'none'; }
                if (compactBrush1) { compactBrush1.style.borderRadius = '0 0 8px 8px'; compactBrush1.style.borderBottom = ''; compactBrush1.style.borderTop = 'none'; }
            } else {
                bottomControls.style.top = 'auto';
                bottomControls.style.bottom = '1rem';

                // Restore original order: controls first, colors second
                const swapParent = getSwapParent();
                if (swapParent) {
                    swapParent.insertBefore(controlsRow, colorsDiv);
                }

                // Button bar goes ABOVE the panel when docked bottom
                topBar.style.bottom = 'auto';
                topBar.style.top = '-24px';
                [toggleBtn, dragBar, resetBtn, flipBtn, paintMenuScale && paintMenuScale.tab].filter(Boolean).forEach(el => {
                    el.style.borderRadius = '8px 8px 0 0';
                    el.style.borderBottom = 'none';
                    el.style.borderTop = '';
                });
                // Also style compact overflow buttons if they exist
                const compactClose2 = document.getElementById('gpc-compact-close');
                const compactBrush2 = document.getElementById('gpc-compact-brush');
                if (compactClose2) { compactClose2.style.borderRadius = '8px 8px 0 0'; compactClose2.style.borderBottom = 'none'; compactClose2.style.borderTop = ''; }
                if (compactBrush2) { compactBrush2.style.borderRadius = '8px 8px 0 0'; compactBrush2.style.borderBottom = 'none'; compactBrush2.style.borderTop = ''; }
            }

            const yTransform = isCollapsed
                ? (isTop ? `translateY(calc(-100% + ${COLLAPSE_OFFSET}px))` : `translateY(calc(100% - ${COLLAPSE_OFFSET}px))`)
                : 'translateY(0)';

            bottomControls.style.left = '50%';
            bottomControls.style.right = 'auto';
            bottomControls.style.transform = `translateX(calc(-50% + ${dragOffsetX}px)) ${yTransform}`;
            toggleBtn.innerHTML = isCollapsed
                ? (isTop ? '▼' : '▲')
                : (isTop ? '▲' : '▼');
            flipBtn.innerHTML = isTop ? '⬇' : '⬆';
        };

        // --- 5. DRAG LOGIC ---

        let isDragging = false;
        let dragStartX = 0;
        let dragStartOffset = 0;

        function onDragStart(e) {
            isDragging = true;
            dragStartX = (e.touches ? e.touches[0].clientX : e.clientX);
            dragStartOffset = dragOffsetX;
            dragBar.style.cursor = 'grabbing';
            bottomControls.style.transition = 'none'; // disable animation while dragging
            e.preventDefault();
        }
        function onDragMove(e) {
            if (!isDragging) return;
            const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
            dragOffsetX = dragStartOffset + (clientX - dragStartX);
            // Clamp so the panel stays at least partially on screen
            const halfW = bottomControls.offsetWidth / 2;
            const maxOff = window.innerWidth / 2 - 60;
            dragOffsetX = Math.max(-maxOff, Math.min(maxOff, dragOffsetX));
            updateState();
        }
        function onDragEnd() {
            if (!isDragging) return;
            isDragging = false;
            dragBar.style.cursor = 'grab';
            bottomControls.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            localStorage.setItem(DRAG_STORAGE_KEY, String(dragOffsetX));
        }

        dragBar.addEventListener('mousedown', onDragStart);
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
        dragBar.addEventListener('touchstart', onDragStart, { passive: false });
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);

        // --- 6. EVENT LISTENERS ---

        toggleBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            updateState();
        });

        resetBtn.addEventListener('click', () => {
            dragOffsetX = 0;
            localStorage.removeItem(DRAG_STORAGE_KEY);
            updateState();
        });

        flipBtn.addEventListener('click', () => {
            isTop = !isTop;
            isCollapsed = false; // expand when flipping
            localStorage.setItem(TOP_STORAGE_KEY, String(isTop));
            updateState();
        });

        // Initialize. This runs whether or not Painting Menu Overhaul is
        // enabled, making the scale tab a Paint Menu Controls capability.
        paintMenuScale = createPaintMenuControlsScale();
        gpcPaintMenuControlsScale = paintMenuScale;
        if (paintMenuScale) paintMenuScale.mount();
        updateState();
        if (paintMenuScale) paintMenuScale.requestLayout();
        console.log('Bottom controls enhanced: properly centered with left/right positioning.');
    };

    // Mirrors ghost-palette-search.js's injectSyncGhostBtn retry pattern
    // (synchronous check -> MutationObserver watch -> bounded giveup) instead
    // of the old bare setTimeout(init, 500) infinite poll, which had no
    // giveup and logged nothing but a generic 'Elements not found, retrying...'
    // at each attempt. Both #bottomControls and #currentEnergyDisplay must be
    // present before the paint-menu UI can be built, so they're watched together.
    const init = () => {
        const watchStartedAt = Date.now();
        const getAnchors = () => {
            const bottomControls = document.getElementById('bottomControls');
            const energyDisplay = document.getElementById('currentEnergyDisplay');
            return (bottomControls && energyDisplay) ? { bottomControls, energyDisplay } : null;
        };

        const immediate = getAnchors();
        if (immediate) {
            dbgPush('Paint Menu Controls: #bottomControls and #currentEnergyDisplay found on the first synchronous check -- mounting now.', { uiComponent: 'Paint Menu Controls' });
            runPaintMenuInit(immediate.bottomControls, immediate.energyDisplay);
            return;
        }
        dbgPush('Paint Menu Controls: #bottomControls and #currentEnergyDisplay NOT found on the first synchronous check -- watching for them to appear.', { uiComponent: 'Paint Menu Controls' });
        const observer = new MutationObserver(() => {
            const found = getAnchors();
            if (!found) return;
            observer.disconnect();
            clearTimeout(giveUpTimer);
            dbgPush('Paint Menu Controls: #bottomControls and #currentEnergyDisplay appeared ' + (Date.now() - watchStartedAt) + 'ms after watching started -- mounting now.', { uiComponent: 'Paint Menu Controls' });
            runPaintMenuInit(found.bottomControls, found.energyDisplay);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        const giveUpTimer = setTimeout(() => {
            observer.disconnect();
            dbgPush('Paint Menu Controls: gave up after 15s -- #bottomControls and #currentEnergyDisplay were never found together, could not be mounted at all.', { uiComponent: 'Paint Menu Controls' });
            console.error('[GeoPixelcons++] Paint Menu Controls: never found #bottomControls and #currentEnergyDisplay.');
        }, 15000);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
            })();
            _featureStatus.hidePaintMenu = 'ok';
            console.log('[GeoPixelcons++] ✅ Paint Menu Controls loaded');
        } catch (err) {
            _featureStatus.hidePaintMenu = 'error';
            dbgPush(`Paint Menu Controls init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Paint Menu Controls' });
            console.error('[GeoPixelcons++] ❌ Paint Menu Controls failed:', err);
        }
    }
