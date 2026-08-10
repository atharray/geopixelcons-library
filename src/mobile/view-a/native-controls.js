    const MOBILE_ROOT_ID = 'gpc-mobile-overhaul-root';
    const MOBILE_PANEL_ID = 'gpc-mobile-panel';
    const MOBILE_NATIVE_ROW_ID = 'gpc-mobile-native-controls-row';
    const MOBILE_CONTROL_IDS = [
        'currentEnergyDisplay',
        'toggleBrushModeBtn_Bottom',
        'brush-swap-toggle',
        'commitBtn',
        'toggleEyedropper_Bottom',
    ];
    // brush-swap-toggle (paint-brush-swap.js) is special-cased in
    // relocateNativeControls() rather than blindly relocated like the rest
    // of MOBILE_CONTROL_IDS -- see ensureBrushSwapProxy() for why.
    const MOBILE_BRUSH_SWAP_TOGGLE_ID = 'brush-swap-toggle';
    const MOBILE_BRUSH_SWAP_PROXY_ID = 'gpc-mobile-brush-swap-proxy';

    function resolveMobileDocument(bridge) {
        if (bridge.env && bridge.env.document
            && typeof bridge.env.document.createElement === 'function') {
            return bridge.env.document;
        }
        if (bridge.document && typeof bridge.document.createElement === 'function') {
            return bridge.document;
        }
        if (typeof document !== 'undefined' && document
            && typeof document.createElement === 'function') {
            return document;
        }
        throw new Error('GeoPixelcons++ Mobile Overhaul requires a DOM document');
    }

    function setMobileCssText(element, declarations) {
        const cssText = declarations.join(';');
        if (element.style.cssText !== cssText) element.style.cssText = cssText;
    }

    // Shared with ensureBrushSwapProxy() (styled once immediately at
    // creation, so it never paints with default browser button styling for
    // one refresh cycle before applyMobilePanelTheme() next runs) and
    // applyMobilePanelTheme() (idempotent re-application on every refresh,
    // matching every other row control here).
    function applyBrushSwapProxyTheme(proxy) {
        setMobileCssText(proxy, [
            'display:inline-flex',
            'align-items:center',
            'justify-content:center',
            'min-width:44px',
            'min-height:44px',
            'border:1px solid var(--gpp-mobile-border)',
            'border-radius:8px',
            'background:var(--gpp-mobile-surface-3)',
            'color:var(--gpp-mobile-text)',
            'font:inherit',
            'cursor:pointer',
            'touch-action:manipulation',
            'flex:0 0 auto',
        ]);
    }

    // Colors come entirely from the shared var(--gpp-mobile-*) tokens
    // (installMobileTheme(), theme.js) now -- no per-render dark-mode
    // detection or hex-literal branching needed here at all; the cascade
    // reacts to the site's own `body.dark` class on its own.
    function applyMobilePanelTheme(documentRef, shell) {
        setMobileCssText(shell.root, [
            'position:fixed',
            'left:0',
            'right:0',
            'bottom:0',
            'z-index:99990',
            'pointer-events:none',
            'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        ]);
        setMobileCssText(shell.panel, [
            'box-sizing:border-box',
            'width:100%',
            'min-height:96px',
            'padding:8px 10px calc(8px + env(safe-area-inset-bottom, 0px))',
            'background:var(--gpp-mobile-surface)',
            'color:var(--gpp-mobile-text)',
            'border-top:1px solid var(--gpp-mobile-border)',
            'box-shadow:0 -10px 30px var(--gpp-mobile-shadow)',
            'pointer-events:auto',
            'touch-action:manipulation',
            'overscroll-behavior:contain',
        ]);
        setMobileCssText(shell.closeButton, [
            'min-width:44px',
            'min-height:44px',
            'border:0',
            'border-radius:8px',
            'background:var(--gpp-mobile-surface-3)',
            'color:var(--gpp-mobile-text)',
            'font:inherit',
            'font-size:16px',
            'line-height:1',
            'cursor:pointer',
            'touch-action:manipulation',
            'flex:0 0 auto',
        ]);
        // Only present once ensureBrushSwapProxy() has created it (needs
        // the real #brush-swap-toggle to exist first) -- styled the same
        // way as shell.closeButton, an ordinary icon-only row control.
        const brushSwapProxy = documentRef.getElementById(MOBILE_BRUSH_SWAP_PROXY_ID);
        if (brushSwapProxy) applyBrushSwapProxyTheme(brushSwapProxy);
        setMobileCssText(shell.row, [
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'gap:8px',
            'min-height:44px',
            'overflow-x:auto',
            'overscroll-behavior-x:contain',
            'touch-action:pan-x',
        ]);
    }

    function createNativeControlsController(bridge, onDestroy) {
        const documentRef = resolveMobileDocument(bridge);
        const windowRef = bridge.env && bridge.env.window
            ? bridge.env.window
            : documentRef.defaultView;
        const lifecycle = createMobileLifecycle(documentRef);
        const resumeControls = new WeakSet();
        const observedSuppressedSurfaces = new WeakSet();
        const subscriptionCleanups = [];
        let mutationObserver = null;
        let hamburgerController = null;
        let viewAController = null;
        let viewBController = null;
        let additionsController = null;
        let additionsShell = null;
        let shell = null;
        let destroyed = false;
        let open = true;
        // Single source of truth for which screen is showing. Every entry
        // point that changes the panel's open/view state goes through
        // refresh() -> applyActiveView(), instead of each caller separately
        // remembering to pair the right show()/hide() calls -- that's what
        // previously let openPanel()/togglePanel() leave View B on screen
        // after being reopened via a path other than the Return button.
        let activeView = 'a';
        let refreshScheduled = false;
        let controller = null;
        const nativeMutationRelevantIds = new Set([
            MOBILE_ROOT_ID,
            'bottomControls',
            'gpp-modal',
            'resumePaintingControl',
            'toggleEyedropper',
            ...MOBILE_CONTROL_IDS,
        ]);

        function ensureShell() {
            if (shell && shell.root.isConnected !== false) return shell;
            const mountTarget = documentRef.body || documentRef.documentElement;
            if (!mountTarget) return null;

            const root = documentRef.createElement('div');
            root.id = MOBILE_ROOT_ID;
            root.className = 'gpc-mobile-overhaul-root';
            root.setAttribute('data-gpc-mobile-overhaul-owned', 'true');

            const panel = documentRef.createElement('section');
            panel.id = MOBILE_PANEL_ID;
            panel.className = 'gpc-mobile-panel';
            panel.setAttribute('role', 'region');
            panel.setAttribute('aria-label', 'GeoPixelcons++ mobile painting controls');

            // No separate title bar -- it was just "Mobile painting" text
            // plus this close button and nothing else. The close button now
            // lives at the right edge of the native controls row instead,
            // alongside everything else the user actually interacts with.
            const closeButton = documentRef.createElement('button');
            closeButton.id = 'gpc-mobile-panel-close';
            closeButton.type = 'button';
            closeButton.textContent = '\u2715';
            closeButton.setAttribute('aria-label', 'Close mobile painting controls');

            const row = documentRef.createElement('div');
            row.id = MOBILE_NATIVE_ROW_ID;
            row.className = 'gpc-mobile-native-controls-row';
            // closeButton is appended in refresh(), after every other row
            // item is placed, so it always lands rightmost regardless of
            // what relocateNativeControls()/the UI scale control add later.

            panel.appendChild(row);
            root.appendChild(panel);
            mountTarget.appendChild(root);

            shell = { root, panel, closeButton, row };
            lifecycle.listen(closeButton, 'click', closePanel);
            applyMobilePanelTheme(documentRef, shell);
            syncOpenPresentation();
            return shell;
        }

        function syncOpenPresentation() {
            if (!shell) return;
            if (shell.root.hidden === open) shell.root.hidden = !open;
            const ariaHidden = open ? 'false' : 'true';
            if (shell.root.getAttribute('aria-hidden') !== ariaHidden) {
                shell.root.setAttribute('aria-hidden', ariaHidden);
            }
        }

        function suppressSurface(element) {
            if (!element) return;
            lifecycle.capturePresentation(element);
            if (mutationObserver && !observedSuppressedSurfaces.has(element)) {
                observedSuppressedSurfaces.add(element);
                mutationObserver.observe(element, {
                    attributes: true,
                    attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
                });
            }
            if (!element.hidden) element.hidden = true;
            if (element.getAttribute('aria-hidden') !== 'true') {
                element.setAttribute('aria-hidden', 'true');
            }
            if (element.style.getPropertyValue('display') !== 'none'
                || element.style.getPropertyPriority('display') !== 'important') {
                element.style.setProperty('display', 'none', 'important');
            }
        }

        function interceptResumePainting(event) {
            if (destroyed) return;
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            if (event && typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            openPanel();
        }

        function bindResumeControl() {
            const resume = documentRef.getElementById('resumePaintingControl');
            if (!resume || resumeControls.has(resume)) return;
            resumeControls.add(resume);
            lifecycle.listen(resume, 'click', interceptResumePainting, true);
        }

        // The panel closing must always leave the user exactly one visible,
        // tappable way back in. The native #resumePaintingControl's own
        // hidden/visible state is driven by the site's paint/inspect mode
        // logic, which has no reason to run just because this panel closed --
        // in ordinary paint mode it can stay hidden forever, stranding the
        // user with #bottomControls also suppressed and nothing on screen.
        // Force it visible while the panel is closed (its click listener is
        // already bound above), and keep it out of the way while the panel
        // owns the screen.
        function syncResumeControlVisibility() {
            const resume = documentRef.getElementById('resumePaintingControl');
            if (!resume) return;
            lifecycle.capturePresentation(resume);
            if (open) {
                if (!resume.hidden) resume.hidden = true;
                if (resume.getAttribute('aria-hidden') !== 'true') {
                    resume.setAttribute('aria-hidden', 'true');
                }
                return;
            }
            if (resume.hidden) resume.hidden = false;
            if (resume.getAttribute('aria-hidden') === 'true') resume.removeAttribute('aria-hidden');
            if (resume.style.getPropertyValue('display') === 'none') {
                resume.style.removeProperty('display');
            }
        }

        function focusMobileTarget(target) {
            if (!target || target.disabled || target.isConnected === false
                || typeof target.focus !== 'function') return false;
            try {
                target.focus();
                return true;
            } catch (_) {
                return false;
            }
        }

        // showTemplateSettings/showPaintingView are the two callers that need
        // a SPECIFIC view, as opposed to openPanel()'s "just get me back to
        // the default painting screen" contract -- so they set open+
        // activeView directly and refresh once, rather than calling
        // openPanel() (which would force activeView back to 'a').
        function showTemplateSettings() {
            if (destroyed) return false;
            open = true;
            activeView = 'b';
            refresh();
            const viewBRoot = documentRef.getElementById('gpc-mobile-view-b');
            if (viewBRoot && typeof viewBRoot.querySelector === 'function') {
                focusMobileTarget(viewBRoot.querySelector('button[aria-label="Return to mobile painting"]'));
            }
            return activeView === 'b';
        }

        function showPaintingView() {
            if (destroyed) return false;
            open = true;
            activeView = 'a';
            refresh();
            const viewARoot = documentRef.getElementById('gpc-mobile-view-a');
            if (viewARoot && typeof viewARoot.querySelector === 'function') {
                focusMobileTarget(viewARoot.querySelector('button[aria-label="Open template settings"]'));
            }
            return activeView === 'a';
        }

        // Opening a template preview is an overlay on top of whichever view
        // is already showing (View A's thumbnail button, or a row in View
        // B's template list) -- it must not reset activeView the way the
        // public openPanel() does, or closing the preview would strand the
        // user back on View A regardless of where they opened it from.
        function openTemplatePreview(template) {
            if (destroyed) return false;
            ensureOpen();
            ensureAdditions();
            return additionsController ? additionsController.openPreview(template) : false;
        }

        function ensureViewA() {
            if (typeof createMobileViewA !== 'function' || !shell) return;
            const currentRoot = documentRef.getElementById('gpc-mobile-view-a');
            if (viewAController && (!currentRoot || currentRoot.parentNode !== shell.panel)) {
                viewAController.destroy();
                viewAController = null;
            }
            if (!viewAController || viewAController.destroyed) {
                viewAController = createMobileViewA(bridge, lifecycle, shell, {
                    openTemplateSettings: showTemplateSettings,
                    openPreview: openTemplatePreview,
                });
            }
        }

        function ensureViewB() {
            if (typeof createMobileViewB !== 'function' || !shell) return;
            const currentRoot = documentRef.getElementById('gpc-mobile-view-b');
            if (viewBController && (!currentRoot || currentRoot.parentNode !== shell.panel)) {
                viewBController.destroy();
                viewBController = null;
            }
            if (!viewBController || viewBController.destroyed) {
                viewBController = createMobileViewB(bridge, lifecycle, shell, {
                    returnToPainting: showPaintingView,
                });
            }
        }

        function ensureAdditions() {
            if (typeof createMobileAdditions !== 'function' || !shell) return;
            if (additionsController && additionsShell !== shell) {
                additionsController.destroy();
                additionsController = null;
                additionsShell = null;
            }
            if (!additionsController || additionsController.destroyed) {
                additionsController = createMobileAdditions(bridge, lifecycle, shell);
                additionsShell = shell;
            } else {
                additionsController.refresh();
            }
        }

        // Applies `activeView` to both view controllers every refresh, so
        // every entry point that opens the panel is correct by construction
        // instead of depending on each caller remembering the right pair of
        // show()/hide() calls. show()/hide() are both idempotent.
        //
        // The gpc-view-a-active/gpc-view-b-active classes let each view own
        // its own #gpc-mobile-panel geometry rule (panel-core.js's
        // applyPanelHeight(), template-settings.js's applyPanelGeometry())
        // scoped to only apply while that view is actually showing -- View A
        // stays mounted-but-hidden while View B is active, so without this
        // scoping its user-resized (and possibly quite small, down to 168px)
        // panelHeight would otherwise apply unconditionally, clipping View
        // B's own taller content underneath it.
        function applyActiveView() {
            if (shell && shell.panel) {
                shell.panel.classList.toggle('gpc-view-a-active', activeView !== 'b');
                shell.panel.classList.toggle('gpc-view-b-active', activeView === 'b');
            }
            if (activeView === 'b') {
                if (viewAController) viewAController.hide();
                if (viewBController) viewBController.show();
            } else {
                if (viewBController) viewBController.hide();
                if (viewAController) viewAController.show();
            }
        }

        function ensureHamburgerMenu() {
            if (typeof createMobileHamburgerMenu !== 'function') return;
            if (!hamburgerController || hamburgerController.destroyed) {
                hamburgerController = createMobileHamburgerMenu(bridge, lifecycle, {
                    openPanel,
                    showTemplateSettings,
                });
            } else {
                hamburgerController.refresh();
            }
        }

        // #brush-swap-toggle's saved-brush dropdown (paint-brush-swap.js) is
        // a position:absolute SIBLING inside a small `wrapper` div left
        // behind in #bottomControls -- relocateNativeControls()'s normal
        // path only ever moves the *listed element itself*, not a sibling
        // positioned relative to its original location. Blindly relocating
        // the button (as every other MOBILE_CONTROL_IDS entry is) would move
        // it into view while its dropdown stays invisible inside the now
        // display:none #bottomControls: exactly the "Brushes button doesn't
        // work, doesn't show anything" bug from real-device testing.
        // hide-paint-menu.js's own compact mode already solves this identical
        // problem for its own relocated button (compactBrushBtn): forward
        // the click to the real, still-in-place button, then reposition the
        // dropdown as position:fixed computed from the *visible* proxy
        // button's own rect. Reused verbatim here instead of reinventing it.
        function repositionBrushSwapDropdown(proxy) {
            const dropdown = documentRef.getElementById('brush-swap-dropdown');
            if (!dropdown || !proxy) return;
            // Routed through lifecycle.moveElement() (not a raw appendChild)
            // so this dropdown gets the exact same original-position capture
            // and destroy()-time restoration every other relocated native
            // control already gets -- otherwise it would be permanently
            // stranded in document.body (with its position:fixed override
            // still applied) after the mobile overhaul is torn down.
            if (dropdown.parentElement !== documentRef.body) {
                lifecycle.moveElement(dropdown, documentRef.body);
            }
            const rect = proxy.getBoundingClientRect();
            dropdown.style.position = 'fixed';
            dropdown.style.right = 'auto';
            dropdown.style.margin = '0';
            dropdown.style.left = rect.left + 'px';
            // shell.row is permanently bottom-docked (the panel is always
            // anchored to the bottom of the viewport), so the dropdown only
            // ever needs to open upward from the proxy -- unlike the native
            // paint menu's own top/bottom dock toggle (gpc-paint-is-top),
            // which hide-paint-menu.js's compact mode has to account for and
            // this row does not.
            dropdown.style.top = 'auto';
            const viewportHeight = (windowRef && windowRef.innerHeight)
                || (documentRef.documentElement && documentRef.documentElement.clientHeight)
                || 0;
            dropdown.style.bottom = (viewportHeight - rect.top + 4) + 'px';
        }

        function ensureBrushSwapProxy() {
            if (!shell) return null;
            const realToggle = documentRef.getElementById(MOBILE_BRUSH_SWAP_TOGGLE_ID);
            let proxy = documentRef.getElementById(MOBILE_BRUSH_SWAP_PROXY_ID);
            if (!realToggle) {
                // The real button isn't present (not yet loaded, or the
                // paintBrushSwap feature is disabled) -- no proxy without it.
                if (proxy && proxy.parentNode) proxy.parentNode.removeChild(proxy);
                return null;
            }
            if (proxy) return proxy;

            proxy = documentRef.createElement('button');
            proxy.id = MOBILE_BRUSH_SWAP_PROXY_ID;
            proxy.type = 'button';
            proxy.setAttribute('aria-label', 'Toggle saved brushes');
            proxy.title = 'Toggle saved brushes';
            proxy.innerHTML = mobileIconMarkup('brushes');
            applyBrushSwapProxyTheme(proxy);

            lifecycle.listen(proxy, 'click', event => {
                // Must run before the real button's own click listener fires
                // (forwarded below), because that listener's own
                // e.stopPropagation() only stops the *synthetic* click it
                // dispatches -- this original click on the proxy is a
                // separate event that would otherwise keep bubbling to
                // paint-brush-swap.js's document-level "click outside
                // closes the dropdown" listener and immediately re-close
                // whatever the forwarded click just opened.
                if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
                const target = documentRef.getElementById(MOBILE_BRUSH_SWAP_TOGGLE_ID);
                if (target) target.click();
                const scheduleReposition = windowRef && typeof windowRef.requestAnimationFrame === 'function'
                    ? windowRef.requestAnimationFrame.bind(windowRef)
                    : callback => (typeof setTimeout === 'function' ? setTimeout(callback, 0) : callback());
                scheduleReposition(() => repositionBrushSwapDropdown(proxy));
            });

            // Forward scroll-to-swap (mouse wheel cycles saved brushes) from
            // the proxy to the real button, mirroring hide-paint-menu.js's
            // compactBrushBtn wheel forwarding.
            lifecycle.listen(proxy, 'wheel', event => {
                const target = documentRef.getElementById(MOBILE_BRUSH_SWAP_TOGGLE_ID);
                const WheelEventCtor = (windowRef && windowRef.WheelEvent)
                    || (typeof WheelEvent !== 'undefined' ? WheelEvent : null);
                if (!target || !WheelEventCtor) return;
                target.dispatchEvent(new WheelEventCtor('wheel', {
                    deltaY: event.deltaY,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    bubbles: false,
                }));
                if (typeof event.preventDefault === 'function') event.preventDefault();
            }, { passive: false });

            return proxy;
        }

        function relocateNativeControls() {
            if (!shell) return;
            const controls = [];
            for (const id of MOBILE_CONTROL_IDS) {
                if (id === MOBILE_BRUSH_SWAP_TOGGLE_ID) {
                    const proxy = ensureBrushSwapProxy();
                    if (proxy) controls.push(proxy);
                    continue;
                }
                const control = documentRef.getElementById(id);
                if (!control) continue;
                lifecycle.moveElement(control, shell.row);
                controls.push(control);
            }

            // Anchor the reordered block to whatever already immediately
            // follows it in the row (the UI scale control, the close
            // button) instead of blindly anchoring to `null` (the row's
            // absolute end). `null` only happens to be correct on the very
            // first refresh, when this block truly is the last thing in the
            // row -- on every later refresh, anything appended AFTER the
            // block by a prior pass (ensureAdditions()'s scale control,
            // refresh()'s own trailing close-button append) means "the
            // row's true end" has moved past them, so re-anchoring to null
            // walks the whole block one position further past them EVERY
            // single refresh, silently scrambling the row order over time
            // (confirmed via a live repro: by the 3rd refresh the UI scale
            // control had walked all the way to the front of the row).
            const controlsSet = new Set(controls);
            let anchor = null;
            for (const child of Array.from(shell.row.children)) {
                if (!controlsSet.has(child)) { anchor = child; break; }
            }

            let next = anchor;
            for (let index = controls.length - 1; index >= 0; index -= 1) {
                const control = controls[index];
                if (control.parentNode !== shell.row || control.nextSibling !== next) {
                    shell.row.insertBefore(control, next);
                }
                next = control;
            }
        }

        function refresh() {
            if (destroyed) return controller;
            if (typeof bridge.ensureRuntimeHooks === 'function') bridge.ensureRuntimeHooks();
            ensureShell();
            if (shell) applyMobilePanelTheme(documentRef, shell);
            suppressSurface(documentRef.getElementById('bottomControls'));
            suppressSurface(documentRef.getElementById('gpp-modal'));
            relocateNativeControls();
            bindResumeControl();
            syncResumeControlVisibility();
            ensureHamburgerMenu();
            ensureViewA();
            ensureViewB();
            ensureAdditions();
            // Appended last, unconditionally, so it always ends up rightmost
            // regardless of what relocateNativeControls()/the UI scale
            // control just added -- appendChild on an already-connected
            // node just moves it, so this is a cheap no-op once settled.
            if (shell && shell.row.lastElementChild !== shell.closeButton) {
                shell.row.appendChild(shell.closeButton);
            }
            applyActiveView();
            syncOpenPresentation();
            return controller;
        }

        function scheduleRefresh() {
            if (destroyed || refreshScheduled) return;
            refreshScheduled = true;
            const enqueue = windowRef && typeof windowRef.queueMicrotask === 'function'
                ? windowRef.queueMicrotask.bind(windowRef)
                : (typeof queueMicrotask === 'function'
                    ? queueMicrotask
                    : callback => Promise.resolve().then(callback));
            enqueue(() => {
                refreshScheduled = false;
                refresh();
            });
        }

        function nativeMutationNodeIsRelevant(node) {
            if (!node) return false;
            if (nativeMutationRelevantIds.has(String(node.id || ''))) return true;
            if (typeof node.querySelector === 'function') {
                for (const id of nativeMutationRelevantIds) {
                    try {
                        if (node.querySelector('#' + id)) return true;
                    } catch (_) { /* malformed third-party IDs are not used here */ }
                }
            }
            const children = node.childNodes ? Array.from(node.childNodes) : [];
            return children.some(nativeMutationNodeIsRelevant);
        }

        function nativeMutationsAffectController(records) {
            for (const record of records || []) {
                if (record.type === 'attributes') {
                    if (record.target === documentRef.body && record.attributeName === 'class') return true;
                    if (observedSuppressedSurfaces.has(record.target)) return true;
                    continue;
                }
                if (record.type !== 'childList') continue;
                // View A, the hamburger, and later mobile views intentionally
                // rebuild their own children. Those mutations must never feed
                // back into the native relocation observer.
                if (shell && shell.root && typeof shell.root.contains === 'function'
                    && shell.root.contains(record.target)) {
                    continue;
                }
                if (nativeMutationNodeIsRelevant(record.target)) return true;
                for (const node of Array.from(record.addedNodes || [])) {
                    if (nativeMutationNodeIsRelevant(node)) return true;
                }
                for (const node of Array.from(record.removedNodes || [])) {
                    if (nativeMutationNodeIsRelevant(node)) return true;
                }
            }
            return false;
        }

        function onNativeMutations(records) {
            if (nativeMutationsAffectController(records)) scheduleRefresh();
        }

        // The public "just open the panel" entry point (native ghost/paint
        // opener, hamburger, guild "Set as Ghost", the resume-control
        // intercept). Always lands on View A -- View A is the painting menu
        // now; View B is a deliberate excursion only showTemplateSettings()
        // enters. Use ensureOpen() instead when the current view must be
        // preserved (e.g. opening a template preview from View B).
        function openPanel() {
            if (destroyed) return false;
            open = true;
            activeView = 'a';
            refresh();
            return true;
        }

        function ensureOpen() {
            if (destroyed) return false;
            open = true;
            refresh();
            return true;
        }

        function closePanel() {
            if (destroyed) return false;
            const activeElement = documentRef.activeElement;
            const moveFocus = !!(shell && shell.root && activeElement
                && (activeElement === shell.root
                    || (typeof shell.root.contains === 'function' && shell.root.contains(activeElement))));
            open = false;
            // Deliberately lighter than refresh(): closing must never leave
            // anything else on screen, so it always closes the preview
            // modal and forces the one guaranteed reopen affordance visible,
            // but it doesn't need to re-run shell/native-control mounting.
            if (additionsController) additionsController.closePreview();
            syncOpenPresentation();
            syncResumeControlVisibility();
            if (moveFocus) {
                // Guaranteed visible now, unlike the old fallback which could
                // try to focus a still natively-hidden element.
                focusMobileTarget(documentRef.getElementById('resumePaintingControl'));
            }
            return false;
        }

        function togglePanel() {
            return open ? closePanel() : openPanel();
        }

        function subscribeOptional(name, listener) {
            if (typeof bridge[name] !== 'function') return;
            const unsubscribe = bridge[name](listener);
            if (typeof unsubscribe === 'function') subscriptionCleanups.push(unsubscribe);
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;
            if (mutationObserver) mutationObserver.disconnect();
            if (hamburgerController) hamburgerController.destroy();
            hamburgerController = null;
            if (additionsController) additionsController.destroy();
            additionsController = null;
            additionsShell = null;
            if (viewAController) viewAController.destroy();
            viewAController = null;
            if (viewBController) viewBController.destroy();
            viewBController = null;
            for (let index = subscriptionCleanups.length - 1; index >= 0; index -= 1) {
                subscriptionCleanups[index]();
            }
            lifecycle.destroy();
            if (shell && shell.root.parentNode) shell.root.parentNode.removeChild(shell.root);
            shell = null;
            if (typeof onDestroy === 'function') onDestroy(controller);
            if (typeof bridge.onControllerDestroyed === 'function') {
                bridge.onControllerDestroyed();
            } else if (typeof bridge.disposeHostEffects === 'function') {
                bridge.disposeHostEffects();
            }
        }

        controller = Object.freeze({
            apiVersion: MOBILE_OVERHAUL_API_VERSION,
            moduleVersion: GPP_MOBILE_UI_VERSION,
            get mounted() {
                return !destroyed && !!(shell && shell.root.isConnected !== false);
            },
            get destroyed() {
                return destroyed;
            },
            get isOpen() {
                return !destroyed && open;
            },
            openPanel,
            closePanel,
            togglePanel,
            showTemplateSettings,
            showPaintingView,
            refresh,
            destroy,
        });

        try {
            refresh();
            subscribeOptional('subscribeRefresh', refresh);
            subscribeOptional('subscribeEnsureOpen', openPanel);

            const MutationObserverCtor = windowRef && typeof windowRef.MutationObserver === 'function'
                ? windowRef.MutationObserver
                : (typeof MutationObserver === 'function' ? MutationObserver : null);
            const observeTarget = documentRef.documentElement || documentRef.body;
            if (MutationObserverCtor && observeTarget) {
                mutationObserver = new MutationObserverCtor(onNativeMutations);
                mutationObserver.observe(observeTarget, {
                    childList: true,
                    subtree: true,
                });
                if (documentRef.body) {
                    mutationObserver.observe(documentRef.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                    });
                }
                suppressSurface(documentRef.getElementById('bottomControls'));
                suppressSurface(documentRef.getElementById('gpp-modal'));
            }

            return controller;
        } catch (error) {
            destroy();
            throw error;
        }
    }
