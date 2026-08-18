
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
        // Painting Menu Overhaul may place these two live native nodes inside
        // its scale-content layer after this feature initialized. Resolve their
        // current shared parent inside updateState instead of retaining the old
        // direct-wrapper parent, so a later collapse/dock never calls
        // insertBefore() with a reference node that has moved.
        const getSwapParent = () => (
            controlsRow && colorsDiv && controlsRow.parentElement === colorsDiv.parentElement
                ? controlsRow.parentElement
                : null
        );

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
                [toggleBtn, dragBar, resetBtn, flipBtn].forEach(el => {
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
                [toggleBtn, dragBar, resetBtn, flipBtn].forEach(el => {
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

        // Initialize
        updateState();
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
