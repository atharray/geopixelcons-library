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

    function isMobileDarkTheme(documentRef) {
        // Match the site's explicit Tailwind theme instead of the OS theme;
        // the two can legitimately differ.
        return !!(documentRef.body && documentRef.body.classList
            && documentRef.body.classList.contains('dark'));
    }

    function setMobileCssText(element, declarations) {
        const cssText = declarations.join(';');
        if (element.style.cssText !== cssText) element.style.cssText = cssText;
    }

    function applyMobilePanelTheme(documentRef, shell) {
        const dark = isMobileDarkTheme(documentRef);
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
            'background:' + (dark ? '#1e1e2e' : '#ffffff'),
            'color:' + (dark ? '#cdd6f4' : '#1e293b'),
            'border-top:1px solid ' + (dark ? '#45475a' : '#e2e8f0'),
            'box-shadow:0 -10px 30px ' + (dark ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.18)'),
            'pointer-events:auto',
            'touch-action:manipulation',
            'overscroll-behavior:contain',
        ]);
        setMobileCssText(shell.header, [
            'display:flex',
            'align-items:center',
            'justify-content:space-between',
            'gap:8px',
            'margin-bottom:6px',
            'font-size:12px',
            'font-weight:700',
        ]);
        setMobileCssText(shell.closeButton, [
            'min-width:44px',
            'min-height:44px',
            'border:0',
            'border-radius:8px',
            'background:' + (dark ? '#585b70' : '#e2e8f0'),
            'color:' + (dark ? '#cdd6f4' : '#1e293b'),
            'font:inherit',
            'font-size:20px',
            'line-height:1',
            'cursor:pointer',
            'touch-action:manipulation',
        ]);
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

            const header = documentRef.createElement('div');
            header.id = 'gpc-mobile-panel-header';
            header.className = 'gpc-mobile-panel-header';

            const title = documentRef.createElement('span');
            title.textContent = 'Mobile painting';

            const closeButton = documentRef.createElement('button');
            closeButton.id = 'gpc-mobile-panel-close';
            closeButton.type = 'button';
            closeButton.textContent = '\u00d7';
            closeButton.setAttribute('aria-label', 'Close mobile painting controls');

            const row = documentRef.createElement('div');
            row.id = MOBILE_NATIVE_ROW_ID;
            row.className = 'gpc-mobile-native-controls-row';

            header.appendChild(title);
            header.appendChild(closeButton);
            panel.appendChild(header);
            panel.appendChild(row);
            root.appendChild(panel);
            mountTarget.appendChild(root);

            shell = { root, panel, header, closeButton, row };
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

        function showTemplateSettings() {
            openPanel();
            ensureViewA();
            ensureViewB();
            if (viewAController) viewAController.hide();
            const shown = viewBController ? viewBController.show() : false;
            const viewBRoot = documentRef.getElementById('gpc-mobile-view-b');
            if (shown && viewBRoot && typeof viewBRoot.querySelector === 'function') {
                focusMobileTarget(viewBRoot.querySelector('button[aria-label="Return to mobile painting"]'));
            }
            return shown;
        }

        function showPaintingView() {
            openPanel();
            ensureViewA();
            ensureViewB();
            if (viewBController) viewBController.hide();
            const shown = viewAController ? viewAController.show() : false;
            const viewARoot = documentRef.getElementById('gpc-mobile-view-a');
            if (shown && viewARoot && typeof viewARoot.querySelector === 'function') {
                focusMobileTarget(viewARoot.querySelector('button[aria-label="Open template settings"]'));
            }
            return shown;
        }

        function openTemplatePreview(template) {
            openPanel();
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

        function relocateNativeControls() {
            if (!shell) return;
            const controls = [];
            for (const id of MOBILE_CONTROL_IDS) {
                const control = documentRef.getElementById(id);
                if (!control) continue;
                lifecycle.moveElement(control, shell.row);
                controls.push(control);
            }

            let next = null;
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
            ensureHamburgerMenu();
            ensureViewA();
            ensureViewB();
            ensureAdditions();
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

        function openPanel() {
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
            syncOpenPresentation();
            if (moveFocus) {
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
