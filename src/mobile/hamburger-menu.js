    const MOBILE_HAMBURGER_ROOT_ID = 'gpc-mobile-hamburger';
    const MOBILE_HAMBURGER_BUTTON_ID = 'gpc-mobile-hamburger-button';
    const MOBILE_HAMBURGER_MENU_ID = 'gpc-mobile-hamburger-menu';
    const MOBILE_HAMBURGER_RESTORED_ATTRIBUTES = [
        'style',
        'class',
        'hidden',
        'aria-hidden',
    ];

    function mobileHamburgerElementChildren(node) {
        if (!node) return [];
        if (node.children) return Array.from(node.children);
        return Array.from(node.childNodes || []).filter(child => !!child.tagName);
    }

    function mobileHamburgerIsButton(element) {
        return !!element && String(element.tagName || '').toLowerCase() === 'button';
    }

    function mobileHamburgerHasClass(element, className) {
        if (!element) return false;
        if (element.classList && typeof element.classList.contains === 'function') {
            return element.classList.contains(className);
        }
        return String(element.getAttribute && element.getAttribute('class') || '')
            .split(/\s+/u)
            .includes(className);
    }

    function mobileHamburgerNormalizeLabel(value) {
        return String(value || '').replace(/\s+/gu, ' ').trim();
    }

    function mobileHamburgerReadLabel(button) {
        if (!button) return 'Unnamed action';
        for (const name of ['title', 'aria-label', 'data-label']) {
            const value = button.getAttribute && button.getAttribute(name);
            const normalized = mobileHamburgerNormalizeLabel(value);
            if (normalized) return normalized;
        }
        const text = mobileHamburgerNormalizeLabel(button.textContent);
        if (text) return text;
        return mobileHamburgerNormalizeLabel(button.id) || 'Unnamed action';
    }

    function mobileHamburgerWalkDescendants(root, visitor) {
        for (const child of mobileHamburgerElementChildren(root)) {
            if (visitor(child) === false) return false;
            if (mobileHamburgerWalkDescendants(child, visitor) === false) return false;
        }
        return true;
    }

    function mobileHamburgerContainsButton(root) {
        let found = false;
        mobileHamburgerWalkDescendants(root, element => {
            if (!mobileHamburgerIsButton(element)) return true;
            found = true;
            return false;
        });
        return found;
    }

    function mobileHamburgerLooksLikeGroupOpener(button, containers) {
        const id = String(button && button.id || '');
        if (/(?:GroupBtn|plusplusBtn|-sub)$/iu.test(id)) return true;
        if (button && button.getAttribute) {
            const popup = button.getAttribute('aria-haspopup');
            if (popup === 'true' || popup === 'menu') return true;
        }
        return containers.some(container => {
            const idOrClass = String(container.id || '') + ' '
                + String(container.getAttribute && container.getAttribute('class') || '');
            return /(dropdown|flyout|submenu)/iu.test(idOrClass);
        });
    }

    function mobileHamburgerGroupInfo(element) {
        const children = mobileHamburgerElementChildren(element);
        const directButtons = children.filter(mobileHamburgerIsButton);
        const containers = children.filter(child => !mobileHamburgerIsButton(child));
        if (directButtons.length !== 1 || containers.length === 0) return null;
        if (!containers.some(mobileHamburgerContainsButton)
            && !mobileHamburgerLooksLikeGroupOpener(directButtons[0], containers)) {
            return null;
        }
        return { opener: directButtons[0], containers };
    }

    function mobileHamburgerIsUnavailable(button) {
        if (!button) return true;
        // Hidden always excludes, regardless of disabled state -- a control
        // that is both disabled AND hidden must not slip through just
        // because the disabled check used to run (and return) first. A
        // disabled-but-VISIBLE control is intentionally still included (see
        // mobileHamburgerIsDisabled(), which renders it as a grayed-out
        // row) rather than excluded, so users can see the action exists.
        if (button.hidden || mobileHamburgerHasClass(button, 'hidden')) return true;
        const style = button.style;
        if (style && (style.getPropertyValue('display') === 'none'
            || style.getPropertyValue('visibility') === 'hidden')) {
            return true;
        }
        return false;
    }

    function mobileHamburgerIsDisabled(button) {
        return !!(button && (button.disabled
            || button.getAttribute && button.getAttribute('aria-disabled') === 'true'));
    }

    function mobileHamburgerIsAlertMarker(element) {
        const id = String(element && element.id || '');
        const classes = String(element && element.getAttribute
            && element.getAttribute('class') || '');
        return /(?:^|[-_])(dot|badge|alert|notification)(?:$|[-_])/iu.test(id + ' ' + classes)
            || /\bbg-red-(?:400|500|600)\b/u.test(classes);
    }

    function mobileHamburgerMarkerIsVisible(element) {
        if (!element || element.hidden || mobileHamburgerHasClass(element, 'hidden')) return false;
        const style = element.style;
        return !(style && (style.getPropertyValue('display') === 'none'
            || style.getPropertyValue('visibility') === 'hidden'
            || style.getPropertyValue('opacity') === '0'));
    }

    function mobileHamburgerHasAlert(element) {
        let found = false;
        mobileHamburgerWalkDescendants(element, child => {
            if (!mobileHamburgerIsAlertMarker(child) || !mobileHamburgerMarkerIsVisible(child)) {
                return true;
            }
            found = true;
            return false;
        });
        return found;
    }

    function collectMobileHamburgerActions(controlsLeft) {
        const actions = [];

        function walk(container, path, inheritedAlert, skipButton) {
            for (const child of mobileHamburgerElementChildren(container)) {
                if (child === skipButton) continue;
                if (mobileHamburgerIsButton(child)) {
                    if (mobileHamburgerIsUnavailable(child)) continue;
                    actions.push({
                        path: path.length ? path.slice() : ['Other'],
                        label: mobileHamburgerReadLabel(child),
                        original: child,
                        disabled: mobileHamburgerIsDisabled(child),
                        alert: !!inheritedAlert || mobileHamburgerHasAlert(child),
                    });
                    continue;
                }

                const group = mobileHamburgerGroupInfo(child);
                if (group) {
                    if (mobileHamburgerIsUnavailable(group.opener)) continue;
                    const nextPath = path.concat(mobileHamburgerReadLabel(group.opener));
                    const nextAlert = !!inheritedAlert || mobileHamburgerHasAlert(group.opener);
                    walk(child, nextPath, nextAlert, group.opener);
                } else {
                    walk(child, path, inheritedAlert, null);
                }
            }
        }

        walk(controlsLeft, [], false, null);
        return actions;
    }

    function mobileHamburgerCaptureAttributes(element) {
        const attributes = Object.create(null);
        for (const name of MOBILE_HAMBURGER_RESTORED_ATTRIBUTES) {
            attributes[name] = {
                present: element.hasAttribute(name),
                value: element.getAttribute(name),
            };
        }
        return attributes;
    }

    function mobileHamburgerRestoreAttributes(element, attributes) {
        for (const name of MOBILE_HAMBURGER_RESTORED_ATTRIBUTES) {
            const saved = attributes[name];
            if (saved.present) element.setAttribute(name, saved.value === null ? '' : saved.value);
            else element.removeAttribute(name);
        }
    }

    // Sets each declaration individually via setProperty() instead of
    // overwriting the whole style.cssText. A full-cssText overwrite would
    // silently wipe out any inline property this function doesn't own --
    // concretely, additions.js applies the global UI scale as an inline
    // `zoom` on this same root element, and a cssText overwrite from
    // openMenu()'s own standalone refresh() (outside native-controls.js's
    // refresh cycle, which would otherwise immediately reapply it) reset
    // the scale back to 1 every time the hamburger opened.
    function mobileHamburgerSetCss(element, declarations) {
        for (const declaration of declarations) {
            const separatorIndex = declaration.indexOf(':');
            if (separatorIndex < 0) continue;
            const property = declaration.slice(0, separatorIndex).trim();
            const value = declaration.slice(separatorIndex + 1).trim();
            if (element.style.getPropertyValue(property) !== value) {
                element.style.setProperty(property, value);
            }
        }
    }

    function createMobileHamburgerMenu(bridge, lifecycle, callbacks = {}) {
        const documentRef = resolveMobileDocument(bridge);
        const windowRef = bridge.env && bridge.env.window
            ? bridge.env.window
            : documentRef.defaultView;
        const localListeners = [];
        const hiddenControls = [];
        const hiddenControlsSet = new WeakSet();
        let observer = null;
        let shell = null;
        let actions = [];
        let open = false;
        let destroyed = false;
        let refreshScheduled = false;

        function listen(target, type, listener, options) {
            if (!target || typeof target.addEventListener !== 'function') return;
            if (lifecycle && typeof lifecycle.listen === 'function') {
                lifecycle.listen(target, type, listener, options);
            } else {
                target.addEventListener(type, listener, options);
            }
            localListeners.push({ target, type, listener, options });
        }

        function syncOpenPresentation() {
            if (!shell) return;
            shell.menu.hidden = !open;
            shell.menu.setAttribute('aria-hidden', open ? 'false' : 'true');
            shell.button.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        function enabledMenuItems() {
            const items = [];
            if (!shell) return items;
            mobileHamburgerWalkDescendants(shell.menu, element => {
                if (element.getAttribute && element.getAttribute('role') === 'menuitem'
                    && !element.disabled && element.getAttribute('aria-disabled') !== 'true') {
                    items.push(element);
                }
                return true;
            });
            return items;
        }

        function focusMenuItem(index) {
            const items = enabledMenuItems();
            if (!items.length) return false;
            const normalized = ((index % items.length) + items.length) % items.length;
            if (typeof items[normalized].focus !== 'function') return false;
            try {
                items[normalized].focus();
                return true;
            } catch (_) {
                return false;
            }
        }

        function openMenu() {
            if (destroyed) return false;
            refresh();
            open = true;
            syncOpenPresentation();
            focusMenuItem(0);
            return true;
        }

        function closeMenu(options) {
            if (destroyed) return false;
            open = false;
            syncOpenPresentation();
            if (options && options.restoreFocus && shell
                && typeof shell.button.focus === 'function') {
                try { shell.button.focus(); } catch (_) { /* best-effort focus restoration */ }
            }
            return false;
        }

        function toggleMenu(event) {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            return open ? closeMenu() : openMenu();
        }

        function ensureShell() {
            if (shell && shell.root.isConnected !== false) return shell;
            const mountTarget = documentRef.body || documentRef.documentElement;
            if (!mountTarget) return null;

            const root = documentRef.createElement('div');
            root.id = MOBILE_HAMBURGER_ROOT_ID;
            root.className = 'gpc-mobile-hamburger';
            root.setAttribute('data-gpc-mobile-overhaul-owned', 'true');

            const button = documentRef.createElement('button');
            button.id = MOBILE_HAMBURGER_BUTTON_ID;
            button.type = 'button';
            button.textContent = '\u2630';
            button.setAttribute('aria-label', 'Open GeoPixels actions');
            button.setAttribute('aria-haspopup', 'menu');
            button.setAttribute('aria-controls', MOBILE_HAMBURGER_MENU_ID);

            const buttonAlert = documentRef.createElement('span');
            buttonAlert.id = 'gpc-mobile-hamburger-alert';
            buttonAlert.setAttribute('aria-hidden', 'true');
            button.appendChild(buttonAlert);

            const menu = documentRef.createElement('div');
            menu.id = MOBILE_HAMBURGER_MENU_ID;
            menu.className = 'gpc-mobile-flat-menu';
            menu.setAttribute('role', 'menu');
            menu.setAttribute('aria-label', 'GeoPixels actions');

            root.appendChild(button);
            root.appendChild(menu);
            shell = { root, button, buttonAlert, menu };

            listen(button, 'click', toggleMenu);
            listen(menu, 'click', onMenuClick);
            listen(documentRef, 'pointerdown', onOutsidePointer, true);
            listen(documentRef, 'keydown', onKeyDown, true);
            syncOpenPresentation();
            // Appended last, once every listener is wired and nothing else
            // here can throw -- appending first and then failing partway
            // through wiring would orphan a live, visible menu with nothing
            // left holding a reference to destroy it.
            mountTarget.appendChild(root);
            return shell;
        }

        function suppressControlsLeft(controlsLeft) {
            if (!controlsLeft) return;
            if (!hiddenControlsSet.has(controlsLeft)) {
                hiddenControlsSet.add(controlsLeft);
                hiddenControls.push({
                    element: controlsLeft,
                    attributes: mobileHamburgerCaptureAttributes(controlsLeft),
                });
                if (lifecycle && typeof lifecycle.capturePresentation === 'function') {
                    lifecycle.capturePresentation(controlsLeft);
                }
            }
            controlsLeft.hidden = true;
            controlsLeft.setAttribute('aria-hidden', 'true');
            controlsLeft.style.setProperty('display', 'none', 'important');
        }

        function applyTheme() {
            if (!shell) return;
            mobileHamburgerSetCss(shell.root, [
                'position:fixed',
                'top:calc(env(safe-area-inset-top, 0px) + 12px)',
                'left:calc(env(safe-area-inset-left, 0px) + 12px)',
                'z-index:99996',
                'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            ]);
            mobileHamburgerSetCss(shell.button, [
                'position:relative',
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'width:44px',
                'height:44px',
                'padding:0',
                'border:1px solid var(--gpp-mobile-focus)',
                'border-radius:12px',
                'background:var(--gpp-mobile-focus)',
                'color:#ffffff',
                'box-shadow:0 4px 14px var(--gpp-mobile-shadow)',
                'font:700 25px/1 system-ui,-apple-system,sans-serif',
                'cursor:pointer',
                'touch-action:manipulation',
                '-webkit-tap-highlight-color:transparent',
            ]);
            mobileHamburgerSetCss(shell.buttonAlert, [
                'position:absolute',
                'top:-2px',
                'right:-2px',
                'width:11px',
                'height:11px',
                'border-radius:999px',
                'border:2px solid var(--gpp-mobile-surface)',
                'background:var(--gpp-mobile-danger)',
                'pointer-events:none',
            ]);
            mobileHamburgerSetCss(shell.menu, [
                'box-sizing:border-box',
                'position:absolute',
                'top:52px',
                'left:0',
                'width:min(82vw, 320px)',
                'max-height:calc(100vh - 88px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
                'overflow-y:auto',
                'overscroll-behavior:contain',
                'padding:8px',
                'border:1px solid var(--gpp-mobile-border)',
                'border-radius:12px',
                'background:var(--gpp-mobile-surface)',
                'color:var(--gpp-mobile-text)',
                'box-shadow:0 12px 32px var(--gpp-mobile-shadow)',
                'touch-action:pan-y',
            ]);
        }

        function clearMenu() {
            if (!shell) return;
            while (shell.menu.firstChild) shell.menu.removeChild(shell.menu.firstChild);
        }

        function appendSection(path, hasAlert) {
            const divider = documentRef.createElement('div');
            divider.className = 'gpc-mobile-flat-menu-section';
            divider.setAttribute('role', 'presentation');
            mobileHamburgerSetCss(divider, [
                'display:flex',
                'align-items:center',
                'gap:7px',
                'min-height:28px',
                'margin:5px 4px 3px',
                'padding:5px 4px 3px',
                'border-top:1px solid var(--gpp-mobile-border)',
                'color:var(--gpp-mobile-muted)',
                'font-size:11px',
                'font-weight:800',
                'letter-spacing:.035em',
                'text-transform:uppercase',
            ]);
            const label = documentRef.createElement('span');
            label.textContent = path;
            divider.appendChild(label);
            if (hasAlert) {
                const marker = documentRef.createElement('span');
                marker.setAttribute('aria-label', 'New activity');
                mobileHamburgerSetCss(marker, [
                    'width:8px',
                    'height:8px',
                    'border-radius:999px',
                    'background:var(--gpp-mobile-danger)',
                    'flex:0 0 auto',
                ]);
                divider.appendChild(marker);
            }
            shell.menu.appendChild(divider);
        }

        function appendAction(action, index) {
            const proxy = documentRef.createElement('button');
            proxy.type = 'button';
            proxy.className = 'gpc-mobile-flat-menu-action';
            proxy.setAttribute('role', 'menuitem');
            proxy.tabIndex = -1;
            proxy.setAttribute('data-gpc-mobile-action-index', String(index));
            proxy.textContent = action.label;
            proxy.disabled = action.disabled;
            if (action.disabled) proxy.setAttribute('aria-disabled', 'true');
            mobileHamburgerSetCss(proxy, [
                'display:flex',
                'align-items:center',
                'width:100%',
                'min-height:44px',
                'margin:2px 0',
                'padding:9px 12px',
                'border:0',
                'border-radius:9px',
                'background:var(--gpp-mobile-surface-2)',
                'color:var(--gpp-mobile-text)',
                'font:600 14px/1.25 system-ui,-apple-system,sans-serif',
                'text-align:left',
                'cursor:' + (action.disabled ? 'not-allowed' : 'pointer'),
                'opacity:' + (action.disabled ? '.55' : '1'),
                'touch-action:manipulation',
                '-webkit-tap-highlight-color:transparent',
            ]);
            shell.menu.appendChild(proxy);
        }

        function renderMenu() {
            if (!shell) return;
            const activeBefore = documentRef.activeElement;
            const activeIndex = activeBefore && shell.menu.contains(activeBefore)
                && activeBefore.getAttribute
                ? Number(activeBefore.getAttribute('data-gpc-mobile-action-index'))
                : -1;
            clearMenu();
            let currentPath = '';
            for (let index = 0; index < actions.length; index += 1) {
                const action = actions[index];
                const path = action.path.join(' \u203a ');
                if (path !== currentPath) {
                    const sectionHasAlert = actions.some(candidate => (
                        candidate.path.join(' \u203a ') === path && candidate.alert
                    ));
                    appendSection(path, sectionHasAlert);
                    currentPath = path;
                }
                appendAction(action, index);
            }

            if (actions.length === 0) {
                const empty = documentRef.createElement('p');
                empty.className = 'gpc-mobile-flat-menu-empty';
                empty.textContent = 'Actions are still loading\u2026';
                mobileHamburgerSetCss(empty, [
                    'margin:0',
                    'padding:12px',
                    'color:var(--gpp-mobile-muted)',
                    'font-size:13px',
                ]);
                shell.menu.appendChild(empty);
            }
            shell.buttonAlert.hidden = !actions.some(action => action.alert);
            if (open) {
                const nextItems = enabledMenuItems();
                const matchingIndex = nextItems.findIndex(item => (
                    Number(item.getAttribute('data-gpc-mobile-action-index')) === activeIndex
                ));
                focusMenuItem(matchingIndex >= 0 ? matchingIndex : 0);
            }
        }

        function findActionButton(target) {
            let current = target;
            while (current && current !== shell.menu) {
                if (current.getAttribute
                    && current.hasAttribute('data-gpc-mobile-action-index')) {
                    return current;
                }
                current = current.parentNode;
            }
            return null;
        }

        function invokeAction(action) {
            if (!action || action.disabled) return;
            const original = action.original;
            const isGhostPlusPlus = original && original.id === 'gpp-opener';
            if (isGhostPlusPlus && typeof callbacks.showTemplateSettings === 'function') {
                closeMenu();
                if (typeof callbacks.openPanel === 'function') callbacks.openPanel();
                callbacks.showTemplateSettings();
                return;
            }
            closeMenu();
            if (original && typeof original.click === 'function') original.click();
        }

        function onMenuClick(event) {
            const proxy = findActionButton(event.target);
            if (!proxy) return;
            if (typeof event.preventDefault === 'function') event.preventDefault();
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
            const index = Number(proxy.getAttribute('data-gpc-mobile-action-index'));
            if (Number.isInteger(index)) invokeAction(actions[index]);
        }

        function onOutsidePointer(event) {
            if (!open || !shell || shell.root.contains(event.target)) return;
            closeMenu();
        }

        function onKeyDown(event) {
            if (!open) return;
            if (event.key === 'Escape') {
                closeMenu({ restoreFocus: true });
                if (typeof event.preventDefault === 'function') event.preventDefault();
                return;
            }
            if (event.key === 'Tab') {
                closeMenu();
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const items = enabledMenuItems();
            if (!items.length) return;
            const currentIndex = items.indexOf(documentRef.activeElement);
            let nextIndex;
            if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = items.length - 1;
            else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : currentIndex - 1;
            else nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
            focusMenuItem(nextIndex);
            if (typeof event.preventDefault === 'function') event.preventDefault();
        }

        function subtreeContainsControlsLeft(node) {
            if (!node) return false;
            if (node.id === 'controls-left') return true;
            let found = false;
            mobileHamburgerWalkDescendants(node, child => {
                if (child.id !== 'controls-left') return true;
                found = true;
                return false;
            });
            return found;
        }

        function mutationsAffectMenu(records) {
            const controlsLeft = documentRef.getElementById('controls-left');
            for (const record of records || []) {
                if (record.type === 'attributes') {
                    if (record.target === documentRef.body && record.attributeName === 'class') {
                        return true;
                    }
                    if (controlsLeft && (record.target === controlsLeft
                        || controlsLeft.contains(record.target))) {
                        return true;
                    }
                    continue;
                }
                if (record.type !== 'childList') continue;
                if (controlsLeft && (record.target === controlsLeft
                    || controlsLeft.contains(record.target))) {
                    return true;
                }
                for (const node of Array.from(record.addedNodes || [])) {
                    if (subtreeContainsControlsLeft(node)) return true;
                }
                for (const node of Array.from(record.removedNodes || [])) {
                    if (subtreeContainsControlsLeft(node)) return true;
                }
            }
            return false;
        }

        function onMutations(records) {
            if (mutationsAffectMenu(records)) scheduleRefresh();
        }

        function observe() {
            const MutationObserverCtor = windowRef && windowRef.MutationObserver
                ? windowRef.MutationObserver
                : (typeof MutationObserver === 'function' ? MutationObserver : null);
            const target = documentRef.documentElement || documentRef.body;
            if (!MutationObserverCtor || !target) return;
            if (!observer) observer = new MutationObserverCtor(onMutations);
            observer.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    'class',
                    'title',
                    'disabled',
                    'aria-disabled',
                    'aria-label',
                    'hidden',
                    'style',
                ],
            });
        }

        function refresh() {
            if (destroyed) return null;
            if (observer) observer.disconnect();
            ensureShell();
            const controlsLeft = documentRef.getElementById('controls-left');
            if (controlsLeft) {
                suppressControlsLeft(controlsLeft);
                actions = collectMobileHamburgerActions(controlsLeft);
            } else {
                actions = [];
            }
            applyTheme();
            renderMenu();
            syncOpenPresentation();
            observe();
            return api;
        }

        function scheduleRefresh() {
            if (destroyed || refreshScheduled) return;
            refreshScheduled = true;
            const enqueue = windowRef && typeof windowRef.queueMicrotask === 'function'
                ? windowRef.queueMicrotask.bind(windowRef)
                : callback => Promise.resolve().then(callback);
            enqueue(() => {
                refreshScheduled = false;
                refresh();
            });
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;
            if (observer) observer.disconnect();
            for (let index = localListeners.length - 1; index >= 0; index -= 1) {
                const record = localListeners[index];
                record.target.removeEventListener(
                    record.type,
                    record.listener,
                    record.options
                );
            }
            for (let index = hiddenControls.length - 1; index >= 0; index -= 1) {
                const record = hiddenControls[index];
                mobileHamburgerRestoreAttributes(record.element, record.attributes);
            }
            if (shell && shell.root.parentNode) shell.root.parentNode.removeChild(shell.root);
            shell = null;
            actions = [];
            open = false;
        }

        const api = Object.freeze({
            get isOpen() {
                return !destroyed && open;
            },
            get destroyed() {
                return destroyed;
            },
            refresh,
            open: openMenu,
            close: closeMenu,
            toggle: toggleMenu,
            destroy,
        });

        refresh();
        return api;
    }
