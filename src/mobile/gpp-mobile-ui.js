// gpp-mobile-ui.js is loaded as a classic Tampermonkey @require script.
// Evaluation must only publish the initializer; all DOM work begins at init.
var mobileOverhaulInit = (function () {
    'use strict';

    const GPP_MOBILE_UI_VERSION = '0.1.0';

    const MOBILE_OVERHAUL_API_VERSION = 1;

    function validateMobileOverhaulBridge(bridge) {
        if (!bridge || typeof bridge !== 'object') {
            throw new TypeError('GeoPixelcons++ Mobile Overhaul requires a bridge object');
        }
        if (bridge.apiVersion !== MOBILE_OVERHAUL_API_VERSION) {
            throw new Error(
                'Unsupported GeoPixelcons++ Mobile Overhaul bridge API version: expected '
                + MOBILE_OVERHAUL_API_VERSION + ', received ' + String(bridge.apiVersion)
            );
        }
        if (typeof bridge.ready !== 'function') {
            throw new TypeError('GeoPixelcons++ Mobile Overhaul bridge.ready must be a function');
        }
        return bridge;
    }

    const MOBILE_RESTORED_ATTRIBUTES = ['style', 'class', 'hidden', 'aria-hidden'];

    function captureMobileElementState(element) {
        const attributes = Object.create(null);
        for (const name of MOBILE_RESTORED_ATTRIBUTES) {
            attributes[name] = {
                present: element.hasAttribute(name),
                value: element.getAttribute(name),
            };
        }
        return {
            parent: element.parentNode,
            nextSibling: element.nextSibling,
            attributes,
        };
    }

    function restoreMobileElementState(element, state) {
        for (const name of MOBILE_RESTORED_ATTRIBUTES) {
            const saved = state.attributes[name];
            if (saved.present) element.setAttribute(name, saved.value === null ? '' : saved.value);
            else element.removeAttribute(name);
        }
    }

    function createMobileLifecycle(documentRef) {
        const presentationRecords = [];
        const capturedPresentation = new WeakSet();
        const movedRecords = [];
        const movedByElement = new WeakMap();
        const listenerRecords = [];
        let destroyed = false;

        function capturePresentation(element) {
            if (!element || capturedPresentation.has(element)) return;
            capturedPresentation.add(element);
            presentationRecords.push({ element, state: captureMobileElementState(element) });
        }

        function moveElement(element, target) {
            if (!element || !target) return null;
            let record = movedByElement.get(element);
            if (!record) {
                const state = captureMobileElementState(element);
                let anchor = null;
                if (state.parent && typeof documentRef.createComment === 'function') {
                    anchor = documentRef.createComment('gpc-mobile-overhaul-original-position');
                    state.parent.insertBefore(anchor, element);
                }
                record = { element, state, anchor, restored: false };
                movedByElement.set(element, record);
                movedRecords.push(record);
            }
            if (element.parentNode !== target) target.appendChild(element);
            return record;
        }

        function listen(element, type, listener, options) {
            if (!element || typeof element.addEventListener !== 'function') return;
            element.addEventListener(type, listener, options);
            listenerRecords.push({ element, type, listener, options });
        }

        function restoreMoved(record) {
            if (!record || record.restored) return;
            record.restored = true;
            const { element, state, anchor } = record;

            if (anchor && anchor.parentNode) {
                const anchorParent = anchor.parentNode;
                anchorParent.insertBefore(element, anchor);
                anchorParent.removeChild(anchor);
            } else if (state.parent) {
                if (state.nextSibling && state.nextSibling.parentNode === state.parent) {
                    state.parent.insertBefore(element, state.nextSibling);
                } else {
                    state.parent.appendChild(element);
                }
            }
            restoreMobileElementState(element, state);
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;

            for (let index = listenerRecords.length - 1; index >= 0; index -= 1) {
                const record = listenerRecords[index];
                record.element.removeEventListener(
                    record.type,
                    record.listener,
                    record.options
                );
            }
            for (let index = movedRecords.length - 1; index >= 0; index -= 1) {
                restoreMoved(movedRecords[index]);
            }
            for (let index = presentationRecords.length - 1; index >= 0; index -= 1) {
                const record = presentationRecords[index];
                restoreMobileElementState(record.element, record.state);
            }
        }

        return Object.freeze({
            capturePresentation,
            moveElement,
            listen,
            destroy,
        });
    }

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
        if (button.disabled || button.getAttribute && button.getAttribute('aria-disabled') === 'true') {
            return false;
        }
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

    function mobileHamburgerSetCss(element, declarations) {
        element.style.cssText = declarations.join(';');
    }

    function mobileHamburgerIsDark(documentRef) {
        // GeoPixels' body.dark class is authoritative. Falling back to the OS
        // preference can create a mixed light/dark surface when the site's
        // explicit theme differs from the device theme.
        return !!(documentRef.body && mobileHamburgerHasClass(documentRef.body, 'dark'));
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
            mountTarget.appendChild(root);
            shell = { root, button, buttonAlert, menu };

            listen(button, 'click', toggleMenu);
            listen(menu, 'click', onMenuClick);
            listen(documentRef, 'pointerdown', onOutsidePointer, true);
            listen(documentRef, 'keydown', onKeyDown, true);
            syncOpenPresentation();
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
            const dark = mobileHamburgerIsDark(documentRef);
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
                'border:1px solid ' + (dark ? '#86efac' : '#15803d'),
                'border-radius:12px',
                'background:' + (dark ? '#4ade80' : '#16a34a'),
                'color:' + (dark ? '#052e16' : '#ffffff'),
                'box-shadow:0 4px 14px ' + (dark ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.25)'),
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
                'border:2px solid ' + (dark ? '#1e1e2e' : '#ffffff'),
                'background:' + (dark ? '#f87171' : '#dc2626'),
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
                'border:1px solid ' + (dark ? '#45475a' : '#dbe3ee'),
                'border-radius:12px',
                'background:' + (dark ? '#1e1e2e' : '#ffffff'),
                'color:' + (dark ? '#cdd6f4' : '#1e293b'),
                'box-shadow:0 12px 32px ' + (dark ? 'rgba(0,0,0,0.55)' : 'rgba(15,23,42,0.24)'),
                'touch-action:pan-y',
            ]);
        }

        function clearMenu() {
            if (!shell) return;
            while (shell.menu.firstChild) shell.menu.removeChild(shell.menu.firstChild);
        }

        function appendSection(path, hasAlert, dark) {
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
                'border-top:1px solid ' + (dark ? '#45475a' : '#e2e8f0'),
                'color:' + (dark ? '#a6adc8' : '#64748b'),
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
                    'background:' + (dark ? '#f87171' : '#dc2626'),
                    'flex:0 0 auto',
                ]);
                divider.appendChild(marker);
            }
            shell.menu.appendChild(divider);
        }

        function appendAction(action, index, dark) {
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
                'background:' + (dark ? '#313244' : '#f1f5f9'),
                'color:' + (dark ? '#cdd6f4' : '#1e293b'),
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
            const dark = mobileHamburgerIsDark(documentRef);
            let currentPath = '';
            for (let index = 0; index < actions.length; index += 1) {
                const action = actions[index];
                const path = action.path.join(' \u203a ');
                if (path !== currentPath) {
                    const sectionHasAlert = actions.some(candidate => (
                        candidate.path.join(' \u203a ') === path && candidate.alert
                    ));
                    appendSection(path, sectionHasAlert, dark);
                    currentPath = path;
                }
                appendAction(action, index, dark);
            }

            if (actions.length === 0) {
                const empty = documentRef.createElement('p');
                empty.className = 'gpc-mobile-flat-menu-empty';
                empty.textContent = 'Actions are still loading\u2026';
                mobileHamburgerSetCss(empty, [
                    'margin:0',
                    'padding:12px',
                    'color:' + (dark ? '#a6adc8' : '#64748b'),
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

    const MOBILE_VIEW_A_PANEL_HEIGHT_KEY = 'gpc-mobile-overhaul-panel-height';
    const MOBILE_VIEW_A_MIN_PANEL_HEIGHT = 168;
    const MOBILE_VIEW_A_MAX_PANEL_FRACTION = 0.5;
    const MOBILE_VIEW_A_SCRUB_MAX = 1000;

    const MOBILE_VIEW_A_SORT_OPTIONS = [
        { value: 'default', label: 'Most used' },
        { value: 'leastUsed', label: 'Least used' },
        { value: 'mostRemaining', label: 'Most remaining' },
        { value: 'leastRemaining', label: 'Least remaining' },
        { value: 'mostPct', label: 'Most % remaining' },
        { value: 'leastPct', label: 'Least % remaining' },
        { value: 'byColor', label: 'Color' },
        { value: 'byColorRev', label: 'Color reversed' },
    ];

    const MOBILE_VIEW_A_FILTER_OPTIONS = [
        { value: 'hideCompleted', label: 'Hide completed colors' },
        { value: 'hideInProgress', label: 'Hide in-progress colors' },
        { value: 'hideUnstarted', label: 'Hide unstarted colors' },
        { value: 'ownedOnly', label: 'Owned colors only' },
        { value: 'unownedOnly', label: 'Not-owned colors only' },
        { value: 'countRange', label: 'Filter by pixel count' },
    ];

    function mobileViewANumber(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function mobileViewANormalizeHexSearch(value) {
        const compact = String(value === null || value === undefined ? '' : value)
            .trim()
            .toLowerCase()
            .replace(/^#/u, '')
            .replace(/[\s_-]+/gu, '');
        if (!compact) return '';
        return /^[0-9a-f]+$/u.test(compact) ? compact : null;
    }

    function mobileViewAHexSearchScore(hex, query) {
        const needle = mobileViewANormalizeHexSearch(query);
        if (needle === '') return 0;
        if (needle === null) return Number.POSITIVE_INFINITY;
        const haystack = mobileViewANormalizeHexSearch(hex);
        if (!haystack) return Number.POSITIVE_INFINITY;
        if (haystack === needle) return -100;

        const directIndex = haystack.indexOf(needle);
        if (directIndex >= 0) return directIndex;

        let needleIndex = 0;
        let firstIndex = -1;
        let lastIndex = -1;
        for (let index = 0; index < haystack.length && needleIndex < needle.length; index += 1) {
            if (haystack[index] !== needle[needleIndex]) continue;
            if (firstIndex < 0) firstIndex = index;
            lastIndex = index;
            needleIndex += 1;
        }
        if (needleIndex !== needle.length) return Number.POSITIVE_INFINITY;
        return 10 + firstIndex + Math.max(0, lastIndex - firstIndex - needle.length + 1);
    }

    function mobileViewAFilterSortRows(rows, state) {
        const options = state || Object.create(null);
        const query = options.search || '';
        const showAll = !!options.showAll;
        const hasProgress = !!options.hasProgress;
        const rawFilters = options.filters || [];
        const filters = new Set(Array.from(rawFilters, value => String(value)));
        const minCount = Number(options.minCount);
        const maxCount = Number(options.maxCount);
        const hasMinCount = Number.isFinite(minCount);
        const hasMaxCount = Number.isFinite(maxCount);

        const filtered = Array.from(rows || []).map(row => ({
            row,
            searchScore: mobileViewAHexSearchScore(row && row.hex, query),
        })).filter(entry => {
            const row = entry.row || Object.create(null);
            if (!showAll && !row.selected) return false;
            if (!Number.isFinite(entry.searchScore)) return false;
            if (filters.has('ownedOnly') && !row.owned) return false;
            if (filters.has('unownedOnly') && row.owned) return false;

            const total = Math.max(0, mobileViewANumber(row.total, 0));
            const completed = Math.max(0, mobileViewANumber(row.completed, 0));
            if (hasProgress) {
                if (filters.has('hideCompleted') && total > 0 && completed >= total) return false;
                if (filters.has('hideInProgress') && completed > 0 && completed < total) return false;
                if (filters.has('hideUnstarted') && total > 0 && completed === 0) return false;
            }
            if (filters.has('countRange')) {
                if (hasMinCount && total < minCount) return false;
                if (hasMaxCount && total > maxCount) return false;
            }
            return true;
        });

        const sortValue = MOBILE_VIEW_A_SORT_OPTIONS.some(option => option.value === options.sort)
            ? options.sort
            : 'default';
        filtered.sort((left, right) => {
            if (left.searchScore !== right.searchScore) return left.searchScore - right.searchScore;
            const a = left.row || Object.create(null);
            const b = right.row || Object.create(null);
            const aTotal = Math.max(0, mobileViewANumber(a.total, 0));
            const bTotal = Math.max(0, mobileViewANumber(b.total, 0));
            const aRemaining = Math.max(0, mobileViewANumber(a.remaining, 0));
            const bRemaining = Math.max(0, mobileViewANumber(b.remaining, 0));
            const aPercent = Math.max(0, mobileViewANumber(a.remainingPercent, 0));
            const bPercent = Math.max(0, mobileViewANumber(b.remainingPercent, 0));
            const aHex = String(a.hex || '').toUpperCase();
            const bHex = String(b.hex || '').toUpperCase();
            const tie = mobileViewANumber(a.index, 0) - mobileViewANumber(b.index, 0);

            switch (sortValue) {
                case 'leastUsed': return (aTotal - bTotal) || tie;
                case 'mostRemaining': return (bRemaining - aRemaining) || tie;
                case 'leastRemaining': return (aRemaining - bRemaining) || tie;
                case 'mostPct': return (bPercent - aPercent) || tie;
                case 'leastPct': return (aPercent - bPercent) || tie;
                case 'byColor': return aHex.localeCompare(bHex) || tie;
                case 'byColorRev': return bHex.localeCompare(aHex) || tie;
                default: return (bTotal - aTotal) || tie;
            }
        });
        return filtered.map(entry => entry.row);
    }

    function mobileViewAClampPanelHeight(value, viewportHeight) {
        const viewport = Math.max(1, mobileViewANumber(viewportHeight, 672));
        const maximum = Math.max(96, Math.floor(viewport * MOBILE_VIEW_A_MAX_PANEL_FRACTION));
        const minimum = Math.min(MOBILE_VIEW_A_MIN_PANEL_HEIGHT, maximum);
        return Math.max(minimum, Math.min(maximum, Math.round(mobileViewANumber(value, minimum))));
    }

    function mobileViewAFormatScanStats(template, busy) {
        if (!template) return 'No focused template';
        const summary = template.scanSummary;
        if (!template.position) return busy ? 'Preparing live scan…' : 'Set a location to start live progress';
        if (!summary) return busy ? 'Updating live scan…' : 'Waiting for live scan…';

        const total = Math.max(0, mobileViewANumber(summary.total, 0));
        const completed = Math.max(0, Math.min(total, mobileViewANumber(summary.correct, 0)));
        const remaining = Math.max(0, total - completed);
        const unknown = Math.max(0, mobileViewANumber(summary.unknown, 0));
        let text = completed.toLocaleString('en-US') + ' / '
            + total.toLocaleString('en-US') + ' placed • '
            + remaining.toLocaleString('en-US') + ' remaining';
        if (unknown > 0) text += ' • ' + unknown.toLocaleString('en-US') + ' not loaded';
        if (busy) text = 'Updating… ' + text;
        return text;
    }

    function createMobileViewA(bridge, lifecycle, shell, callbacks) {
        if (!bridge || typeof bridge !== 'object') {
            throw new TypeError('View A requires the Mobile Overhaul bridge');
        }
        if (!shell || !shell.panel || !shell.header || !shell.row) {
            throw new TypeError('View A requires shell.panel, shell.header, and shell.row');
        }

        const documentRef = (bridge.env && bridge.env.document) || shell.panel.ownerDocument;
        if (!documentRef || typeof documentRef.createElement !== 'function') {
            throw new Error('View A requires a DOM document');
        }
        const windowRef = (bridge.env && bridge.env.window) || documentRef.defaultView;
        const callbackApi = callbacks || Object.create(null);
        const localCleanups = [];
        let unsubscribeRefresh = null;
        let destroyed = false;
        let visible = true;
        let foldOpen = false;
        let showAll = false;
        let thumbnailHidden = false;
        let search = '';
        let sort = 'default';
        let filters = [];
        let minCount = '';
        let maxCount = '';
        let refreshVersion = 0;
        let actionVersion = 0;
        let pendingColorIndex = null;
        let paletteScrollRatio = 0;
        let visiblePaletteRowsByIndex = new Map();
        let resizeState = null;

        function viewportHeight() {
            return (windowRef && mobileViewANumber(windowRef.innerHeight, 0))
                || mobileViewANumber(documentRef.documentElement && documentRef.documentElement.clientHeight, 0)
                || 672;
        }

        function readStoredHeight() {
            try {
                const storage = windowRef && windowRef.localStorage;
                if (!storage || typeof storage.getItem !== 'function') return null;
                const stored = Number(storage.getItem(MOBILE_VIEW_A_PANEL_HEIGHT_KEY));
                return Number.isFinite(stored) ? stored : null;
            } catch (_) {
                return null;
            }
        }

        function persistHeight(value) {
            try {
                const storage = windowRef && windowRef.localStorage;
                if (storage && typeof storage.setItem === 'function') {
                    storage.setItem(MOBILE_VIEW_A_PANEL_HEIGHT_KEY, String(value));
                }
            } catch (_) { /* Storage can be disabled without disabling the panel. */ }
        }

        let panelHeight = mobileViewAClampPanelHeight(
            readStoredHeight() || Math.min(260, viewportHeight() * 0.45),
            viewportHeight()
        );

        function reportError(error, context) {
            try {
                if (typeof callbackApi.onError === 'function') {
                    callbackApi.onError(error, context);
                    return;
                }
                if (typeof bridge.log === 'function') {
                    bridge.log('error', context, error);
                }
            } catch (_) { /* Error reporting must not become a second failure. */ }
        }

        function element(tagName, className, text) {
            const node = documentRef.createElement(tagName);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        }

        function button(className, text, label) {
            const node = element('button', className, text);
            node.type = 'button';
            if (label) node.setAttribute('aria-label', label);
            return node;
        }

        function listen(target, type, listener, options) {
            if (!target || typeof target.addEventListener !== 'function') return;
            if (lifecycle && typeof lifecycle.listen === 'function') {
                lifecycle.listen(target, type, listener, options);
            } else {
                target.addEventListener(type, listener, options);
            }
            localCleanups.push(() => {
                if (typeof target.removeEventListener === 'function') {
                    target.removeEventListener(type, listener, options);
                }
            });
        }

        function replaceChildren(target) {
            let first = target.firstChild || (target.childNodes && target.childNodes[0]);
            while (first) {
                target.removeChild(first);
                first = target.firstChild || (target.childNodes && target.childNodes[0]);
            }
            for (let index = 1; index < arguments.length; index += 1) {
                const child = arguments[index];
                if (child) target.appendChild(child);
            }
        }

        function toggleClass(target, className, enabled) {
            const classes = new Set(String(target.className || '').split(/\s+/u).filter(Boolean));
            if (enabled) classes.add(className);
            else classes.delete(className);
            target.className = Array.from(classes).join(' ');
        }

        function containsNode(container, node) {
            if (!container || !node) return false;
            if (typeof container.contains === 'function') return container.contains(node);
            let current = node;
            while (current) {
                if (current === container) return true;
                current = current.parentNode;
            }
            return false;
        }

        const root = element('section', 'gpc-mobile-view-a');
        root.id = 'gpc-mobile-view-a';
        root.setAttribute('aria-label', 'Mobile painting palette');

        const staticStyle = element('style');
        staticStyle.textContent = `
            .gpc-mobile-view-a {
                --mva-surface: #ffffff; --mva-surface-2: #f8fafc; --mva-text: #1e293b;
                --mva-muted: #64748b; --mva-border: #cbd5e1; --mva-button: #e2e8f0;
                --mva-button-active: #facc15; --mva-focus: #2563eb; --mva-danger: #b91c1c;
                box-sizing: border-box; position: relative; display: flex; flex: 1 1 auto; min-height: 0;
                flex-direction: column; gap: 6px; overflow: hidden; padding: 4px 48px 4px 0;
                color: var(--mva-text);
                overscroll-behavior: contain;
            }
            body.dark .gpc-mobile-view-a {
                --mva-surface: #1e1e2e; --mva-surface-2: #313244; --mva-text: #cdd6f4;
                --mva-muted: #a6adc8; --mva-border: #585b70; --mva-button: #45475a;
                --mva-button-active: #f9e2af; --mva-focus: #89b4fa; --mva-danger: #f38ba8;
            }
            .gpc-mva-resize-handle {
                position: absolute; z-index: 4; top: 0; right: 0; width: 44px; height: 100%;
                border: 0; border-radius: 10px 0 0 10px; background: transparent; cursor: ns-resize;
                touch-action: none; user-select: none;
            }
            .gpc-mva-resize-handle::after {
                content: ''; position: absolute; top: 50%; right: 12px; width: 4px; height: 32px;
                transform: translateY(-50%);
                border-radius: 999px; background: var(--mva-border);
            }
            .gpc-mva-toolbar { display: flex; align-items: center; gap: 6px; min-width: 0; }
            .gpc-mva-search, .gpc-mva-select, .gpc-mva-count {
                box-sizing: border-box; min-height: 44px; border: 1px solid var(--mva-border);
                border-radius: 8px; background: var(--mva-surface-2); color: var(--mva-text);
                font: inherit; font-size: 14px; padding: 8px;
            }
            .gpc-mva-search { flex: 1 1 110px; min-width: 88px; }
            .gpc-mva-tool-button {
                box-sizing: border-box; min-width: 44px; min-height: 44px; padding: 6px 9px;
                border: 1px solid var(--mva-border); border-radius: 8px;
                background: var(--mva-button); color: var(--mva-text); font: inherit;
                font-size: 18px; cursor: pointer; touch-action: manipulation;
            }
            .gpc-mva-tool-button[aria-pressed='true'] {
                background: var(--mva-button-active); color: #422006;
                box-shadow: 0 0 0 2px color-mix(in srgb, var(--mva-button-active) 50%, transparent);
            }
            body.dark .gpc-mva-tool-button[aria-pressed='true'] { color: #422006; }
            .gpc-mva-fold-region { position: relative; }
            .gpc-mva-fold {
                position: absolute; z-index: 8; right: 0; bottom: calc(100% + 6px); width: min(360px, 92vw);
                box-sizing: border-box; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
                padding: 10px; border: 1px solid var(--mva-border); border-radius: 10px;
                background: var(--mva-surface); color: var(--mva-text);
                box-shadow: 0 8px 24px rgba(15, 23, 42, .24); overscroll-behavior: contain;
            }
            body.dark .gpc-mva-fold { box-shadow: 0 8px 24px rgba(0, 0, 0, .45); }
            .gpc-mva-fold[hidden] { display: none; }
            .gpc-mva-field { display: flex; min-width: 0; flex-direction: column; gap: 4px;
                color: var(--mva-muted); font-size: 12px; font-weight: 700; }
            .gpc-mva-filter { min-height: 132px; }
            .gpc-mva-count-row { grid-column: 1 / -1; display: flex; gap: 8px; }
            .gpc-mva-count { width: 50%; }
            .gpc-mva-workspace {
                display: grid; grid-template-columns: minmax(0, 1fr) 104px; gap: 8px;
                flex: 1 1 auto; min-height: 64px; overflow: hidden;
            }
            .gpc-mobile-view-a.is-thumbnail-hidden .gpc-mva-workspace { grid-template-columns: minmax(0, 1fr); }
            .gpc-mobile-view-a.is-thumbnail-hidden .gpc-mva-thumbnail-column { display: none; }
            .gpc-mva-palette-column { display: flex; min-width: 0; min-height: 0; flex-direction: column; gap: 4px; }
            .gpc-mva-palette {
                display: flex; flex: 1 1 auto; align-items: stretch; gap: 6px; min-height: 58px;
                overflow-x: auto; overflow-y: hidden; padding: 2px; scroll-snap-type: x proximity;
                overscroll-behavior-x: contain; touch-action: pan-x;
            }
            .gpc-mva-swatch {
                box-sizing: border-box; position: relative; flex: 0 0 58px; min-width: 58px; min-height: 54px;
                border: 2px solid var(--mva-border); border-radius: 9px; overflow: hidden;
                cursor: pointer; scroll-snap-align: start; touch-action: manipulation;
            }
            .gpc-mva-swatch[aria-pressed='true'] { border-color: var(--mva-focus); box-shadow: 0 0 0 2px var(--mva-focus); }
            .gpc-mva-swatch:disabled { cursor: progress; opacity: .65; }
            .gpc-mva-swatch-label {
                position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 1px;
                background: rgba(0, 0, 0, .7); color: #ffffff; font: 700 9px/1.2 ui-monospace, monospace;
                text-align: center; pointer-events: none;
            }
            body.dark .gpc-mva-swatch-label { background: rgba(0, 0, 0, .78); color: #ffffff; }
            .gpc-mva-scrub { box-sizing: border-box; width: 100%; min-height: 24px; margin: 0; touch-action: pan-x; }
            .gpc-mva-empty { align-self: center; padding: 8px; color: var(--mva-muted); font-size: 12px; }
            .gpc-mva-thumbnail-column { display: flex; min-width: 0; flex-direction: column; }
            .gpc-mva-thumbnail {
                box-sizing: border-box; display: flex; flex: 1 1 auto; min-height: 64px; align-items: center;
                justify-content: center; padding: 4px; border: 1px solid var(--mva-border);
                border-radius: 9px; background: var(--mva-surface-2); color: var(--mva-muted);
                overflow: hidden; cursor: pointer; touch-action: manipulation;
            }
            .gpc-mva-thumbnail canvas, .gpc-mva-thumbnail img {
                display: block; max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: pixelated;
            }
            .gpc-mva-stats { flex: 0 0 auto; min-height: 18px; color: var(--mva-muted);
                font-size: 12px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .gpc-mva-status { min-height: 16px; color: var(--mva-danger); font-size: 11px; }
            .gpc-mobile-view-a :focus-visible { outline: 3px solid var(--mva-focus); outline-offset: 2px; }
            @media (orientation: landscape) and (max-height: 520px) {
                .gpc-mobile-view-a { gap: 3px; padding-bottom: max(2px, env(safe-area-inset-bottom, 0px)); }
                .gpc-mva-workspace { min-height: 54px; }
                .gpc-mva-swatch { min-height: 48px; }
                .gpc-mva-fold { bottom: auto; top: calc(100% + 4px); max-height: 48vh; overflow: auto; }
            }
        `;
        const geometryStyle = element('style');

        const resizeHandle = element('div', 'gpc-mva-resize-handle');
        resizeHandle.setAttribute('role', 'separator');
        resizeHandle.setAttribute('aria-label', 'Resize mobile painting panel');
        resizeHandle.setAttribute('aria-orientation', 'horizontal');
        resizeHandle.tabIndex = 0;

        const toolbar = element('div', 'gpc-mva-toolbar');
        const searchInput = element('input', 'gpc-mva-search');
        searchInput.type = 'search';
        searchInput.placeholder = 'Search hex…';
        searchInput.autocomplete = 'off';
        searchInput.spellcheck = false;
        searchInput.setAttribute('aria-label', 'Fuzzy hex color search');

        const showAllButton = button('gpc-mva-tool-button', '◉', 'Show all template colors');
        showAllButton.title = 'Show all colors';
        showAllButton.setAttribute('aria-pressed', 'false');

        const thumbnailToggle = button('gpc-mva-tool-button', '▣', 'Hide template thumbnail');
        thumbnailToggle.title = 'Hide template thumbnail';
        thumbnailToggle.setAttribute('aria-pressed', 'false');

        const wrenchButton = button('gpc-mva-tool-button', '⚙', 'Open template settings');
        wrenchButton.title = 'Template settings';

        const foldRegion = element('div', 'gpc-mva-fold-region');
        const foldButton = button('gpc-mva-tool-button', '⇅', 'Open palette sort and filter controls');
        foldButton.title = 'Sort and filter';
        foldButton.setAttribute('aria-expanded', 'false');

        const fold = element('div', 'gpc-mva-fold');
        fold.hidden = true;
        const sortLabel = element('label', 'gpc-mva-field', 'Sort by');
        const sortSelect = element('select', 'gpc-mva-select');
        sortSelect.setAttribute('aria-label', 'Sort palette colors');
        for (const optionDefinition of MOBILE_VIEW_A_SORT_OPTIONS) {
            const option = element('option', '', optionDefinition.label);
            option.value = optionDefinition.value;
            sortSelect.appendChild(option);
        }
        sortLabel.appendChild(sortSelect);

        const filterLabel = element('label', 'gpc-mva-field', 'Filter by');
        const filterSelect = element('select', 'gpc-mva-select gpc-mva-filter');
        filterSelect.multiple = true;
        filterSelect.size = MOBILE_VIEW_A_FILTER_OPTIONS.length;
        filterSelect.setAttribute('aria-label', 'Filter palette colors');
        for (const optionDefinition of MOBILE_VIEW_A_FILTER_OPTIONS) {
            const option = element('option', '', optionDefinition.label);
            option.value = optionDefinition.value;
            filterSelect.appendChild(option);
        }
        filterLabel.appendChild(filterSelect);

        const countRow = element('div', 'gpc-mva-count-row');
        const minInput = element('input', 'gpc-mva-count');
        minInput.type = 'number';
        minInput.min = '0';
        minInput.inputMode = 'numeric';
        minInput.placeholder = 'Min pixels';
        minInput.setAttribute('aria-label', 'Minimum pixel count');
        const maxInput = element('input', 'gpc-mva-count');
        maxInput.type = 'number';
        maxInput.min = '0';
        maxInput.inputMode = 'numeric';
        maxInput.placeholder = 'Max pixels';
        maxInput.setAttribute('aria-label', 'Maximum pixel count');
        countRow.appendChild(minInput);
        countRow.appendChild(maxInput);
        fold.appendChild(sortLabel);
        fold.appendChild(filterLabel);
        fold.appendChild(countRow);
        foldRegion.appendChild(foldButton);
        foldRegion.appendChild(fold);

        toolbar.appendChild(searchInput);
        toolbar.appendChild(showAllButton);
        toolbar.appendChild(thumbnailToggle);
        toolbar.appendChild(foldRegion);
        toolbar.appendChild(wrenchButton);

        const workspace = element('div', 'gpc-mva-workspace');
        const paletteColumn = element('div', 'gpc-mva-palette-column');
        const paletteScroller = element('div', 'gpc-mva-palette');
        paletteScroller.setAttribute('role', 'listbox');
        paletteScroller.setAttribute('aria-label', 'Template colors');
        const scrub = element('input', 'gpc-mva-scrub');
        scrub.type = 'range';
        scrub.min = '0';
        scrub.max = String(MOBILE_VIEW_A_SCRUB_MAX);
        scrub.step = '1';
        scrub.value = '0';
        scrub.setAttribute('aria-label', 'Scroll through template colors');
        paletteColumn.appendChild(paletteScroller);
        paletteColumn.appendChild(scrub);

        const thumbnailColumn = element('div', 'gpc-mva-thumbnail-column');
        const thumbnailButton = button('gpc-mva-thumbnail', 'No template', 'Open focused template preview');
        thumbnailColumn.appendChild(thumbnailButton);
        workspace.appendChild(paletteColumn);
        workspace.appendChild(thumbnailColumn);

        const stats = element('div', 'gpc-mva-stats', 'No focused template');
        stats.setAttribute('aria-live', 'polite');
        const status = element('div', 'gpc-mva-status');
        status.setAttribute('aria-live', 'polite');

        root.appendChild(staticStyle);
        root.appendChild(geometryStyle);
        root.appendChild(resizeHandle);
        root.appendChild(toolbar);
        root.appendChild(workspace);
        root.appendChild(stats);
        root.appendChild(status);
        shell.panel.appendChild(root);

        function applyPanelHeight(nextHeight, shouldPersist) {
            panelHeight = mobileViewAClampPanelHeight(nextHeight, viewportHeight());
            geometryStyle.textContent = `
                #gpc-mobile-panel {
                    box-sizing: border-box !important; display: flex !important; flex-direction: column !important;
                    position: relative !important; overflow: hidden !important; height: ${panelHeight}px !important;
                    min-height: min(${MOBILE_VIEW_A_MIN_PANEL_HEIGHT}px, 50vh) !important;
                    max-height: 50vh !important;
                    padding-right: max(10px, env(safe-area-inset-right, 0px)) !important;
                    padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)) !important;
                    padding-left: max(10px, env(safe-area-inset-left, 0px)) !important;
                }
            `;
            resizeHandle.setAttribute('aria-valuemin', String(Math.min(MOBILE_VIEW_A_MIN_PANEL_HEIGHT, Math.floor(viewportHeight() * 0.5))));
            resizeHandle.setAttribute('aria-valuemax', String(Math.max(96, Math.floor(viewportHeight() * 0.5))));
            resizeHandle.setAttribute('aria-valuenow', String(panelHeight));
            if (shouldPersist) persistHeight(panelHeight);
        }

        function setFoldOpen(nextOpen) {
            foldOpen = !!nextOpen;
            fold.hidden = !foldOpen;
            foldButton.setAttribute('aria-expanded', String(foldOpen));
        }

        function readSelectedFilters() {
            if (filterSelect.selectedOptions) {
                filters = Array.from(filterSelect.selectedOptions, option => option.value);
                return;
            }
            filters = Array.from(filterSelect.options || filterSelect.childNodes || [])
                .filter(option => option.selected)
                .map(option => option.value);
        }

        function updateScrubFromScroll() {
            const maximum = Math.max(0, mobileViewANumber(paletteScroller.scrollWidth, 0)
                - mobileViewANumber(paletteScroller.clientWidth, 0));
            paletteScrollRatio = maximum > 0
                ? Math.max(0, Math.min(1, mobileViewANumber(paletteScroller.scrollLeft, 0) / maximum))
                : 0;
            scrub.value = String(Math.round(paletteScrollRatio * MOBILE_VIEW_A_SCRUB_MAX));
            scrub.disabled = maximum <= 0;
        }

        function updateScrollFromScrub() {
            const maximum = Math.max(0, mobileViewANumber(paletteScroller.scrollWidth, 0)
                - mobileViewANumber(paletteScroller.clientWidth, 0));
            paletteScrollRatio = Math.max(0, Math.min(1,
                mobileViewANumber(scrub.value, 0) / MOBILE_VIEW_A_SCRUB_MAX));
            paletteScroller.scrollLeft = maximum * paletteScrollRatio;
        }

        function restorePaletteScroll() {
            const callback = () => {
                if (destroyed) return;
                const maximum = Math.max(0, mobileViewANumber(paletteScroller.scrollWidth, 0)
                    - mobileViewANumber(paletteScroller.clientWidth, 0));
                paletteScroller.scrollLeft = maximum * paletteScrollRatio;
                updateScrubFromScroll();
            };
            if (windowRef && typeof windowRef.requestAnimationFrame === 'function') {
                windowRef.requestAnimationFrame(callback);
            } else {
                callback();
            }
        }

        function invokeCallback(name, template) {
            const aliases = name === 'openTemplateSettings'
                ? ['openTemplateSettings', 'showTemplateSettings', 'openViewB']
                : [name];
            const callback = aliases.map(alias => callbackApi[alias]).find(value => typeof value === 'function');
            if (!callback) return;
            try {
                const result = callback(template);
                if (result && typeof result.then === 'function') {
                    result.catch(error => reportError(error, name));
                }
            } catch (error) {
                reportError(error, name);
            }
        }

        function selectPaletteColor(row) {
            if (!row || pendingColorIndex !== null || typeof bridge.selectColor !== 'function') return;
            const currentAction = ++actionVersion;
            pendingColorIndex = row.index;
            status.textContent = 'Selecting ' + String(row.hex || 'color') + '…';
            refresh();
            let selection;
            try {
                selection = bridge.selectColor(row.index);
            } catch (error) {
                selection = Promise.reject(error);
            }
            Promise.resolve(selection).then(result => {
                if (destroyed || currentAction !== actionVersion) return;
                if (result && result.selected === false) {
                    throw new Error(result.reason || 'Color could not be selected');
                }
                status.textContent = '';
            }).catch(error => {
                if (destroyed || currentAction !== actionVersion) return;
                status.textContent = 'Could not select that color.';
                reportError(error, 'selectColor');
            }).finally(() => {
                if (destroyed || currentAction !== actionVersion) return;
                pendingColorIndex = null;
                refresh();
            });
        }

        function renderPalette(template, rows) {
            const visibleRows = mobileViewAFilterSortRows(rows, {
                search,
                showAll,
                sort,
                filters,
                minCount: minCount === '' ? Number.NaN : Number(minCount),
                maxCount: maxCount === '' ? Number.NaN : Number(maxCount),
                hasProgress: !!(template && template.scanSummary),
            });
            visiblePaletteRowsByIndex = new Map();
            replaceChildren(paletteScroller);
            if (!template) {
                paletteScroller.appendChild(element('div', 'gpc-mva-empty', 'Focus a template to see its colors.'));
            } else if (!rows.length) {
                paletteScroller.appendChild(element('div', 'gpc-mva-empty', 'This template has no palette colors.'));
            } else if (!visibleRows.length) {
                const message = showAll
                    ? 'No colors match the current search or filters.'
                    : 'No single selected color is available. Turn on Show All to choose one.';
                paletteScroller.appendChild(element('div', 'gpc-mva-empty', message));
            } else {
                for (const row of visibleRows) {
                    visiblePaletteRowsByIndex.set(String(row.index), row);
                    const swatch = button('gpc-mva-swatch', '', 'Select ' + String(row.hex || 'template color'));
                    swatch.setAttribute('role', 'option');
                    swatch.setAttribute('aria-selected', String(!!row.selected));
                    swatch.setAttribute('aria-pressed', String(!!row.selected));
                    swatch.setAttribute('data-mobile-color-index', String(row.index));
                    swatch.style.background = String(row.hex || '#000000');
                    swatch.title = String(row.hex || '') + ' • '
                        + mobileViewANumber(row.completed, 0).toLocaleString('en-US') + '/'
                        + mobileViewANumber(row.total, 0).toLocaleString('en-US') + ' placed';
                    swatch.disabled = pendingColorIndex !== null;
                    if (pendingColorIndex === row.index) swatch.setAttribute('aria-busy', 'true');
                    const label = element('span', 'gpc-mva-swatch-label', String(row.hex || '').toUpperCase());
                    swatch.appendChild(label);
                    paletteScroller.appendChild(swatch);
                }
            }
            restorePaletteScroll();
        }

        function renderThumbnail(template, version) {
            replaceChildren(thumbnailButton, element('span', 'gpc-mva-empty', template ? 'Loading preview…' : 'No template'));
            thumbnailButton.disabled = !template;
            if (!template || typeof bridge.renderThumbnail !== 'function') return;

            let rendered;
            try {
                rendered = bridge.renderThumbnail(template, 96);
            } catch (error) {
                rendered = Promise.reject(error);
            }
            Promise.resolve(rendered).then(preview => {
                if (destroyed || version !== refreshVersion || !preview) return;
                replaceChildren(thumbnailButton, preview);
                preview.setAttribute && preview.setAttribute('aria-hidden', 'true');
            }).catch(error => {
                if (destroyed || version !== refreshVersion) return;
                replaceChildren(thumbnailButton, element('span', 'gpc-mva-empty', 'Preview unavailable'));
                reportError(error, 'renderThumbnail');
            });
        }

        function refresh() {
            if (destroyed) return controller;
            const version = ++refreshVersion;
            applyPanelHeight(panelHeight, false);
            root.hidden = !visible;
            root.setAttribute('aria-hidden', String(!visible));
            toggleClass(root, 'is-thumbnail-hidden', thumbnailHidden);
            showAllButton.setAttribute('aria-pressed', String(showAll));
            showAllButton.title = showAll ? 'Show only the selected color' : 'Show all colors';
            thumbnailToggle.setAttribute('aria-pressed', String(thumbnailHidden));
            thumbnailToggle.setAttribute('aria-label', thumbnailHidden ? 'Show template thumbnail' : 'Hide template thumbnail');
            thumbnailToggle.title = thumbnailHidden ? 'Show template thumbnail' : 'Hide template thumbnail';

            let template = null;
            let rows = [];
            try {
                template = typeof bridge.getFocusedTemplate === 'function'
                    ? bridge.getFocusedTemplate()
                    : null;
                rows = template && typeof bridge.getPaletteRows === 'function'
                    ? Array.from(bridge.getPaletteRows(template) || [])
                    : [];
            } catch (error) {
                status.textContent = 'Template colors are temporarily unavailable.';
                reportError(error, 'refreshPalette');
            }

            renderPalette(template, rows);
            renderThumbnail(template, version);
            let scanBusy = false;
            try {
                scanBusy = !!(template && typeof bridge.getScanBusy === 'function'
                    && bridge.getScanBusy(template));
            } catch (error) {
                reportError(error, 'getScanBusy');
            }
            stats.textContent = mobileViewAFormatScanStats(template, scanBusy);
            stats.setAttribute('aria-busy', String(scanBusy));
            wrenchButton.disabled = !template;
            return controller;
        }

        function show() {
            if (destroyed) return false;
            visible = true;
            refresh();
            return true;
        }

        function hide() {
            if (destroyed) return false;
            visible = false;
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');
            setFoldOpen(false);
            return false;
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;
            refreshVersion += 1;
            actionVersion += 1;
            if (typeof unsubscribeRefresh === 'function') {
                try { unsubscribeRefresh(); } catch (error) { reportError(error, 'unsubscribeRefresh'); }
            }
            for (let index = localCleanups.length - 1; index >= 0; index -= 1) {
                localCleanups[index]();
            }
            if (root.parentNode) root.parentNode.removeChild(root);
        }

        const controller = Object.freeze({
            get visible() { return !destroyed && visible; },
            get destroyed() { return destroyed; },
            refresh,
            show,
            hide,
            destroy,
        });

        listen(searchInput, 'input', () => {
            search = searchInput.value;
            refresh();
        });
        listen(showAllButton, 'click', () => {
            showAll = !showAll;
            refresh();
        });
        listen(thumbnailToggle, 'click', () => {
            thumbnailHidden = !thumbnailHidden;
            refresh();
        });
        listen(wrenchButton, 'click', () => {
            let template = null;
            try { template = bridge.getFocusedTemplate && bridge.getFocusedTemplate(); }
            catch (error) { reportError(error, 'getFocusedTemplate'); }
            invokeCallback('openTemplateSettings', template);
        });
        listen(thumbnailButton, 'click', () => {
            let template = null;
            try { template = bridge.getFocusedTemplate && bridge.getFocusedTemplate(); }
            catch (error) { reportError(error, 'getFocusedTemplate'); }
            if (template) invokeCallback('openPreview', template);
        });
        listen(foldButton, 'click', event => {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            setFoldOpen(!foldOpen);
        });
        listen(documentRef, 'pointerdown', event => {
            if (!foldOpen || containsNode(foldRegion, event.target)) return;
            setFoldOpen(false);
        }, true);
        listen(sortSelect, 'change', () => {
            sort = sortSelect.value;
            refresh();
        });
        listen(filterSelect, 'change', () => {
            readSelectedFilters();
            refresh();
        });
        listen(minInput, 'input', () => {
            minCount = minInput.value;
            refresh();
        });
        listen(maxInput, 'input', () => {
            maxCount = maxInput.value;
            refresh();
        });
        listen(paletteScroller, 'click', event => {
            let target = event && event.target;
            while (target && target !== paletteScroller
                && !(typeof target.getAttribute === 'function'
                    && target.getAttribute('data-mobile-color-index') !== null)) {
                target = target.parentNode;
            }
            if (!target || target === paletteScroller || typeof target.getAttribute !== 'function') return;
            const index = target.getAttribute('data-mobile-color-index');
            selectPaletteColor(visiblePaletteRowsByIndex.get(index));
        });
        listen(paletteScroller, 'scroll', updateScrubFromScroll, { passive: true });
        listen(scrub, 'input', updateScrollFromScrub);

        listen(resizeHandle, 'pointerdown', event => {
            if (event.button !== undefined && event.button !== 0) return;
            resizeState = {
                pointerId: event.pointerId,
                startY: mobileViewANumber(event.clientY, 0),
                startHeight: panelHeight,
            };
            if (typeof resizeHandle.setPointerCapture === 'function' && event.pointerId !== undefined) {
                resizeHandle.setPointerCapture(event.pointerId);
            }
            if (typeof event.preventDefault === 'function') event.preventDefault();
        });
        listen(resizeHandle, 'pointermove', event => {
            if (!resizeState || (event.pointerId !== undefined && event.pointerId !== resizeState.pointerId)) return;
            const delta = resizeState.startY - mobileViewANumber(event.clientY, resizeState.startY);
            applyPanelHeight(resizeState.startHeight + delta, false);
            if (typeof event.preventDefault === 'function') event.preventDefault();
        });
        function finishResize(event) {
            if (!resizeState || (event.pointerId !== undefined && event.pointerId !== resizeState.pointerId)) return;
            const pointerId = resizeState.pointerId;
            resizeState = null;
            if (typeof resizeHandle.hasPointerCapture === 'function'
                && typeof resizeHandle.releasePointerCapture === 'function'
                && pointerId !== undefined && resizeHandle.hasPointerCapture(pointerId)) {
                resizeHandle.releasePointerCapture(pointerId);
            }
            persistHeight(panelHeight);
        }
        listen(resizeHandle, 'pointerup', finishResize);
        listen(resizeHandle, 'pointercancel', finishResize);
        listen(resizeHandle, 'keydown', event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            const delta = event.key === 'ArrowUp' ? 12 : -12;
            applyPanelHeight(panelHeight + delta, true);
            if (typeof event.preventDefault === 'function') event.preventDefault();
        });
        listen(windowRef, 'resize', () => applyPanelHeight(panelHeight, true), { passive: true });

        if (typeof bridge.subscribeRefresh === 'function') {
            try {
                unsubscribeRefresh = bridge.subscribeRefresh(refresh);
            } catch (error) {
                reportError(error, 'subscribeRefresh');
            }
        }

        applyPanelHeight(panelHeight, false);
        refresh();
        return controller;
    }

    const MOBILE_VIEW_B_THUMBNAIL_SIZE = 72;
    const MOBILE_VIEW_B_COMPACT_THUMBNAIL_SIZE = 48;

    function mobileViewBInteger(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string' && !value.trim()) return null;
        const number = Number(value);
        return Number.isInteger(number) ? number : null;
    }

    function mobileViewBNormalizeGridPoint(value) {
        if (!value || typeof value !== 'object') return null;
        const gridX = mobileViewBInteger(value.gridX !== undefined ? value.gridX : value.x);
        const gridY = mobileViewBInteger(value.gridY !== undefined ? value.gridY : value.y);
        return gridX === null || gridY === null ? null : { gridX, gridY };
    }

    function mobileViewBDpadDelta(direction) {
        switch (direction) {
        case 'up': return { deltaX: 0, deltaY: 1 };
        case 'right': return { deltaX: 1, deltaY: 0 };
        case 'down': return { deltaX: 0, deltaY: -1 };
        case 'left': return { deltaX: -1, deltaY: 0 };
        default: return null;
        }
    }

    function mobileViewBCanEditPosition(bridge, template) {
        if (!template || template.ephemeral || template.locked) return false;
        if (typeof bridge.canEditPosition !== 'function') return true;
        try {
            return !!bridge.canEditPosition(template);
        } catch (_) {
            return false;
        }
    }

    function mobileViewBCanDeleteTemplate(template, personalIds) {
        return !!template && !template.ephemeral && personalIds.has(String(template.id));
    }

    function mobileViewBTemplateName(template) {
        const name = template && typeof template.name === 'string' ? template.name.trim() : '';
        return name || 'Untitled template';
    }

    function createMobileViewB(bridge, lifecycle, shell, callbacks) {
        if (!bridge || typeof bridge !== 'object') {
            throw new TypeError('View B requires the Mobile Overhaul bridge');
        }
        if (!shell || !shell.panel || typeof shell.panel.appendChild !== 'function') {
            throw new TypeError('View B requires shell.panel');
        }

        const documentRef = (bridge.env && bridge.env.document) || shell.panel.ownerDocument;
        if (!documentRef || typeof documentRef.createElement !== 'function') {
            throw new Error('View B requires a DOM document');
        }
        const windowRef = (bridge.env && bridge.env.window) || documentRef.defaultView;
        const callbackApi = callbacks || Object.create(null);
        const localCleanups = [];
        let unsubscribeRefresh = null;
        let destroyed = false;
        let visible = false;
        let refreshVersion = 0;
        let actionVersion = 0;
        let actionBusy = false;
        let focusedTemplate = null;
        let personalTemplatesById = new Map();
        let draftTemplateId = null;
        let draftX = '';
        let draftY = '';
        let draftDirty = false;
        let statusMessage = '';
        let statusKind = '';
        let controller = null;

        function reportError(error, context) {
            try {
                if (typeof callbackApi.onError === 'function') {
                    callbackApi.onError(error, context);
                    return;
                }
                if (typeof bridge.log === 'function') bridge.log('error', context, error);
            } catch (_) { /* Error reporting must never hide the original failure. */ }
        }

        function element(tagName, className, text) {
            const node = documentRef.createElement(tagName);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        }

        function button(className, text, label) {
            const node = element('button', className, text);
            node.type = 'button';
            if (label) node.setAttribute('aria-label', label);
            return node;
        }

        function listen(target, type, listener, options) {
            if (!target || typeof target.addEventListener !== 'function') return;
            if (lifecycle && typeof lifecycle.listen === 'function') {
                lifecycle.listen(target, type, listener, options);
            } else {
                target.addEventListener(type, listener, options);
            }
            localCleanups.push(() => {
                if (typeof target.removeEventListener === 'function') {
                    target.removeEventListener(type, listener, options);
                }
            });
        }

        function replaceChildren(target) {
            let child = target.firstChild || (target.childNodes && target.childNodes[0]);
            while (child) {
                target.removeChild(child);
                child = target.firstChild || (target.childNodes && target.childNodes[0]);
            }
            for (let index = 1; index < arguments.length; index += 1) {
                if (arguments[index]) target.appendChild(arguments[index]);
            }
        }

        function setStatus(message, kind) {
            statusMessage = String(message || '');
            statusKind = String(kind || '');
            status.textContent = statusMessage;
            status.setAttribute('data-kind', statusKind);
        }

        function setDraft(point, dirty) {
            const normalized = mobileViewBNormalizeGridPoint(point);
            draftX = normalized ? String(normalized.gridX) : '';
            draftY = normalized ? String(normalized.gridY) : '';
            draftDirty = !!dirty;
            syncPositionPresentation();
        }

        function readDraft() {
            const gridX = mobileViewBInteger(draftX);
            const gridY = mobileViewBInteger(draftY);
            return gridX === null || gridY === null ? null : { gridX, gridY };
        }

        const root = element('section', 'gpc-mobile-view-b');
        root.id = 'gpc-mobile-view-b';
        root.hidden = true;
        root.setAttribute('aria-hidden', 'true');
        root.setAttribute('aria-label', 'Template settings');

        const staticStyle = element('style');
        staticStyle.textContent = `
            .gpc-mobile-view-b {
                --mvb-surface: #ffffff; --mvb-surface-2: #f8fafc; --mvb-text: #1e293b;
                --mvb-muted: #64748b; --mvb-border: #cbd5e1; --mvb-button: #e2e8f0;
                --mvb-accent: #ea580c; --mvb-accent-text: #ffffff; --mvb-focus: #2563eb;
                --mvb-danger: #b91c1c; box-sizing: border-box; display: flex; flex: 1 1 auto;
                min-height: 0; flex-direction: column; gap: 7px; overflow: hidden; color: var(--mvb-text);
                padding: 3px 0 max(4px, env(safe-area-inset-bottom, 0px));
                overscroll-behavior: contain;
            }
            body.dark .gpc-mobile-view-b {
                --mvb-surface: #1e1e2e; --mvb-surface-2: #313244; --mvb-text: #cdd6f4;
                --mvb-muted: #a6adc8; --mvb-border: #585b70; --mvb-button: #45475a;
                --mvb-accent: #fab387; --mvb-accent-text: #11111b; --mvb-focus: #89b4fa;
                --mvb-danger: #f38ba8;
            }
            .gpc-mvb-topbar { display: flex; align-items: center; gap: 7px; min-width: 0; }
            .gpc-mvb-title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 15px; line-height: 1.2; }
            .gpc-mvb-button, .gpc-mvb-input {
                box-sizing: border-box; min-width: 44px; min-height: 44px; border: 1px solid var(--mvb-border);
                border-radius: 8px; background: var(--mvb-button); color: var(--mvb-text);
                font: inherit; font-size: 14px; touch-action: manipulation;
            }
            .gpc-mvb-button { padding: 7px 10px; cursor: pointer; font-weight: 700; }
            .gpc-mvb-button[disabled], .gpc-mvb-input[disabled] { opacity: .48; cursor: not-allowed; }
            .gpc-mvb-button:focus-visible, .gpc-mvb-input:focus-visible {
                outline: 3px solid var(--mvb-focus); outline-offset: 2px;
            }
            .gpc-mvb-return { font-size: 20px; }
            .gpc-mvb-preview[aria-pressed="true"] { background: var(--mvb-accent); color: var(--mvb-accent-text); }
            .gpc-mvb-list {
                flex: 1 1 auto; min-height: 68px; overflow-y: auto; padding: 2px 3px 2px 0;
                display: flex; flex-direction: column; gap: 6px; overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
            }
            .gpc-mvb-card {
                display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center;
                gap: 7px; min-height: 58px; padding: 5px; border: 1px solid var(--mvb-border);
                border-radius: 10px; background: var(--mvb-surface-2);
            }
            .gpc-mvb-card.is-focused {
                grid-template-columns: 72px minmax(0, 1fr); min-height: 84px;
                border: 2px solid var(--mvb-accent); background: var(--mvb-surface);
            }
            .gpc-mvb-card.is-ephemeral { border-style: dashed; }
            .gpc-mvb-thumb {
                width: 48px; height: 48px; display: grid; place-items: center; overflow: hidden;
                border: 1px solid var(--mvb-border); border-radius: 7px; background: var(--mvb-surface);
                color: var(--mvb-muted); font-size: 10px;
            }
            .gpc-mvb-card.is-focused .gpc-mvb-thumb { width: 72px; height: 72px; grid-row: span 2; }
            .gpc-mvb-thumb > canvas, .gpc-mvb-thumb > img {
                display: block; max-width: 100%; max-height: 100%; object-fit: contain;
            }
            .gpc-mvb-card-copy { min-width: 0; }
            .gpc-mvb-card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; }
            .gpc-mvb-card-meta { margin-top: 2px; color: var(--mvb-muted); font-size: 11px; }
            .gpc-mvb-card-actions { display: flex; align-items: center; gap: 5px; }
            .gpc-mvb-card.is-focused .gpc-mvb-card-actions { grid-column: 2; justify-content: flex-start; }
            .gpc-mvb-card-action { min-width: 44px; min-height: 44px; padding: 5px 8px; }
            .gpc-mvb-delete { color: var(--mvb-danger); }
            .gpc-mvb-empty { padding: 14px 8px; color: var(--mvb-muted); text-align: center; }
            .gpc-mvb-position {
                flex: 0 0 auto; display: grid; grid-template-columns: minmax(96px, 1.2fr) minmax(0, 1fr) auto;
                align-items: center; gap: 7px; padding-top: 6px; border-top: 1px solid var(--mvb-border);
            }
            .gpc-mvb-set-location { align-self: stretch; background: var(--mvb-accent); color: var(--mvb-accent-text); }
            .gpc-mvb-coordinates { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; min-width: 0; }
            .gpc-mvb-coordinate { min-width: 0; color: var(--mvb-muted); font-size: 11px; font-weight: 700; }
            .gpc-mvb-input { width: 100%; padding: 6px; background: var(--mvb-surface-2); }
            .gpc-mvb-dpad {
                display: grid; grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(2, 44px);
                gap: 3px; touch-action: manipulation;
            }
            .gpc-mvb-nudge { padding: 0; font-size: 18px; }
            .gpc-mvb-nudge[data-mobile-nudge="up"] { grid-column: 2; grid-row: 1; }
            .gpc-mvb-nudge[data-mobile-nudge="left"] { grid-column: 1; grid-row: 2; }
            .gpc-mvb-nudge[data-mobile-nudge="down"] { grid-column: 2; grid-row: 2; }
            .gpc-mvb-nudge[data-mobile-nudge="right"] { grid-column: 3; grid-row: 2; }
            .gpc-mvb-status { min-height: 16px; color: var(--mvb-muted); font-size: 11px; }
            .gpc-mvb-status[data-kind="error"] { color: var(--mvb-danger); }
            .gpc-mobile-view-b-reticle {
                position: fixed; z-index: 99989; left: 50%; top: 50%; width: 52px; height: 52px;
                min-width: 52px; min-height: 52px; margin: -26px 0 0 -26px; padding: 0;
                border: 2px solid #ffffff; border-radius: 50%; background: rgba(234, 88, 12, .82);
                color: #ffffff; box-shadow: 0 0 0 2px rgba(15, 23, 42, .72), 0 4px 16px rgba(0, 0, 0, .35);
                font: 800 26px/1 system-ui, sans-serif; cursor: crosshair; pointer-events: auto;
                touch-action: manipulation; user-select: none;
            }
            body.dark .gpc-mobile-view-b-reticle { background: rgba(250, 179, 135, .9); color: #11111b; }
            .gpc-mobile-view-b-reticle[disabled] { opacity: .45; cursor: not-allowed; }
            @media (orientation: landscape) and (max-height: 540px) {
                .gpc-mobile-view-b { gap: 4px; }
                .gpc-mvb-card { min-height: 52px; }
                .gpc-mvb-card.is-focused { min-height: 68px; grid-template-columns: 56px minmax(0, 1fr) auto; }
                .gpc-mvb-card.is-focused .gpc-mvb-thumb { width: 56px; height: 56px; grid-row: auto; }
                .gpc-mvb-card.is-focused .gpc-mvb-card-actions { grid-column: 3; }
                .gpc-mvb-position { grid-template-columns: minmax(100px, .8fr) minmax(120px, 1fr) auto; }
            }
            @media (max-width: 430px) {
                .gpc-mvb-position { grid-template-columns: minmax(0, 1fr) auto; }
                .gpc-mvb-set-location { grid-column: 1 / -1; min-height: 44px; }
            }
        `;

        const topbar = element('div', 'gpc-mvb-topbar');
        const returnButton = button('gpc-mvb-button gpc-mvb-return', '\u21a9', 'Return to mobile painting');
        const title = element('h2', 'gpc-mvb-title', 'Templates / History');
        const previewButton = button('gpc-mvb-button gpc-mvb-preview', 'Preview', 'Preview focused template');
        previewButton.setAttribute('aria-pressed', 'false');
        topbar.appendChild(returnButton);
        topbar.appendChild(title);
        topbar.appendChild(previewButton);

        const list = element('div', 'gpc-mvb-list');
        list.id = 'gpc-mobile-template-history-list';
        list.setAttribute('role', 'list');
        list.setAttribute('aria-label', 'Templates and history');

        const positionControls = element('div', 'gpc-mvb-position');
        const setLocationButton = button('gpc-mvb-button gpc-mvb-set-location', 'Set Location', 'Commit template location');
        const coordinates = element('div', 'gpc-mvb-coordinates');
        const xLabel = element('label', 'gpc-mvb-coordinate', 'X');
        const xInput = element('input', 'gpc-mvb-input');
        xInput.id = 'gpc-mobile-template-x';
        xInput.type = 'number';
        xInput.step = '1';
        xInput.inputMode = 'numeric';
        xInput.setAttribute('aria-label', 'Template top-left X coordinate');
        const yLabel = element('label', 'gpc-mvb-coordinate', 'Y');
        const yInput = element('input', 'gpc-mvb-input');
        yInput.id = 'gpc-mobile-template-y';
        yInput.type = 'number';
        yInput.step = '1';
        yInput.inputMode = 'numeric';
        yInput.setAttribute('aria-label', 'Template top-left Y coordinate');
        xLabel.appendChild(xInput);
        yLabel.appendChild(yInput);
        coordinates.appendChild(xLabel);
        coordinates.appendChild(yLabel);

        const dpad = element('div', 'gpc-mvb-dpad');
        dpad.setAttribute('role', 'group');
        dpad.setAttribute('aria-label', 'Nudge template one grid cell');
        const nudgeDefinitions = [
            ['up', '\u2191', 'Nudge template up one cell, Y plus one'],
            ['left', '\u2190', 'Nudge template left one cell'],
            ['down', '\u2193', 'Nudge template down one cell, Y minus one'],
            ['right', '\u2192', 'Nudge template right one cell'],
        ];
        for (const definition of nudgeDefinitions) {
            const nudgeButton = button('gpc-mvb-button gpc-mvb-nudge', definition[1], definition[2]);
            nudgeButton.setAttribute('data-mobile-nudge', definition[0]);
            dpad.appendChild(nudgeButton);
        }

        const status = element('div', 'gpc-mvb-status');
        status.setAttribute('aria-live', 'polite');
        const reticle = button('gpc-mobile-view-b-reticle', '\u2316', 'Use the map center as the template top-left draft location');
        reticle.id = 'gpc-mobile-template-reticle';

        positionControls.appendChild(setLocationButton);
        positionControls.appendChild(coordinates);
        positionControls.appendChild(dpad);
        root.appendChild(staticStyle);
        root.appendChild(topbar);
        root.appendChild(list);
        root.appendChild(positionControls);
        root.appendChild(status);
        shell.panel.appendChild(root);

        function reticleMountTarget() {
            if (shell.root && shell.root !== shell.panel) return shell.root;
            if (shell.panel.parentNode && shell.panel.parentNode !== shell.panel) return shell.panel.parentNode;
            return documentRef.body || documentRef.documentElement;
        }

        function mountReticle() {
            if (!visible || destroyed || reticle.parentNode) return;
            const target = reticleMountTarget();
            if (target && target !== shell.panel) target.appendChild(reticle);
        }

        function unmountReticle() {
            if (reticle.parentNode) reticle.parentNode.removeChild(reticle);
        }

        function findActionTarget(start, boundary, attributeName) {
            let current = start;
            while (current && current !== boundary) {
                if (typeof current.getAttribute === 'function'
                    && current.getAttribute(attributeName) !== null) return current;
                current = current.parentNode;
            }
            return null;
        }

        function renderThumbnail(template, slot, size, version) {
            if (!template || typeof bridge.renderThumbnail !== 'function') return;
            let rendered;
            try {
                rendered = bridge.renderThumbnail(template, size);
            } catch (error) {
                rendered = Promise.reject(error);
            }
            Promise.resolve(rendered).then(preview => {
                if (destroyed || version !== refreshVersion || !preview) return;
                replaceChildren(slot, preview);
                if (typeof preview.setAttribute === 'function') preview.setAttribute('aria-hidden', 'true');
            }).catch(error => {
                if (destroyed || version !== refreshVersion) return;
                slot.textContent = 'No preview';
                reportError(error, 'renderThumbnail');
            });
        }

        function createTemplateCard(template, isFocused, isPersonal, version) {
            const card = element('article', 'gpc-mvb-card');
            card.setAttribute('role', 'listitem');
            card.setAttribute('data-mobile-template-id', String(template.id));
            if (isFocused) card.className += ' is-focused';
            if (template.ephemeral) card.className += ' is-ephemeral';

            const thumbnail = element('div', 'gpc-mvb-thumb', 'Loading');
            const copy = element('div', 'gpc-mvb-card-copy');
            const name = element('div', 'gpc-mvb-card-name', mobileViewBTemplateName(template));
            const position = mobileViewBNormalizeGridPoint(template.position);
            let metaText = position
                ? 'X ' + position.gridX + ' \u00b7 Y ' + position.gridY
                : 'Location not set';
            if (template.ephemeral) metaText += ' \u00b7 Guild / view only';
            else if (template.locked) metaText += ' \u00b7 Position locked';
            const meta = element('div', 'gpc-mvb-card-meta', metaText);
            copy.appendChild(name);
            copy.appendChild(meta);

            const actions = element('div', 'gpc-mvb-card-actions');
            const setButton = button('gpc-mvb-button gpc-mvb-card-action', 'Set', 'Focus ' + mobileViewBTemplateName(template));
            setButton.setAttribute('data-mvb-action', 'focus');
            setButton.setAttribute('data-mobile-template-id', String(template.id));
            setButton.disabled = isFocused || actionBusy || !isPersonal;
            const deleteButton = button('gpc-mvb-button gpc-mvb-card-action gpc-mvb-delete', 'Delete', 'Delete ' + mobileViewBTemplateName(template));
            deleteButton.setAttribute('data-mvb-action', 'delete');
            deleteButton.setAttribute('data-mobile-template-id', String(template.id));
            deleteButton.disabled = actionBusy
                || !mobileViewBCanDeleteTemplate(template, new Set(personalTemplatesById.keys()));
            actions.appendChild(setButton);
            actions.appendChild(deleteButton);

            card.appendChild(thumbnail);
            card.appendChild(copy);
            card.appendChild(actions);
            renderThumbnail(
                template,
                thumbnail,
                isFocused ? MOBILE_VIEW_B_THUMBNAIL_SIZE : MOBILE_VIEW_B_COMPACT_THUMBNAIL_SIZE,
                version
            );
            return card;
        }

        function renderTemplateList(personalTemplates, focused, version) {
            replaceChildren(list);
            const focusedIsPersonal = !!(focused && personalTemplatesById.has(String(focused.id)));
            if (focused && !focusedIsPersonal) {
                list.appendChild(createTemplateCard(focused, true, false, version));
            }
            if (!personalTemplates.length) {
                const message = focused && !focusedIsPersonal
                    ? 'No personal templates are in history.'
                    : 'No templates are in history yet.';
                list.appendChild(element('div', 'gpc-mvb-empty', message));
                return;
            }
            for (const template of personalTemplates) {
                list.appendChild(createTemplateCard(
                    template,
                    !!(focused && String(focused.id) === String(template.id)),
                    true,
                    version
                ));
            }
        }

        function syncPositionPresentation() {
            const editable = mobileViewBCanEditPosition(bridge, focusedTemplate);
            const validDraft = !!readDraft();
            const canNudge = editable && !!mobileViewBNormalizeGridPoint(
                focusedTemplate && focusedTemplate.position
            );
            xInput.value = draftX;
            yInput.value = draftY;
            xInput.disabled = actionBusy || !editable;
            yInput.disabled = actionBusy || !editable;
            setLocationButton.disabled = actionBusy || !editable || !validDraft;
            reticle.disabled = actionBusy || !editable;
            reticle.title = editable
                ? 'Pan the map, then tap to copy the center cell into X/Y'
                : 'This template position cannot be changed';
            for (const child of Array.from(dpad.childNodes || [])) {
                if (child && 'disabled' in child) child.disabled = actionBusy || !canNudge;
            }
            if (!focusedTemplate) {
                setLocationButton.title = 'Focus a template first';
            } else if (!editable) {
                setLocationButton.title = focusedTemplate.ephemeral
                    ? 'Guild templates are view-only'
                    : 'This template position is locked';
            } else if (!validDraft) {
                setLocationButton.title = 'Enter integer X and Y coordinates';
            } else {
                setLocationButton.title = draftDirty ? 'Commit the drafted location' : 'Commit this location';
            }
            previewButton.disabled = actionBusy || !focusedTemplate;
            let previewForced = false;
            try {
                previewForced = !!(focusedTemplate && typeof bridge.isPreviewForced === 'function'
                    && bridge.isPreviewForced(focusedTemplate.id));
            } catch (error) {
                reportError(error, 'isPreviewForced');
            }
            previewButton.setAttribute('aria-pressed', String(previewForced));
            previewButton.textContent = previewForced ? 'Preview On' : 'Preview';
            root.setAttribute('aria-busy', String(actionBusy));
            status.textContent = statusMessage;
            status.setAttribute('data-kind', statusKind);
        }

        function refresh() {
            if (destroyed) return controller;
            const version = ++refreshVersion;
            root.hidden = !visible;
            root.setAttribute('aria-hidden', String(!visible));
            if (visible) mountReticle();
            else unmountReticle();

            let personalTemplates = [];
            let nextFocused = null;
            try {
                personalTemplates = typeof bridge.getTemplates === 'function'
                    ? Array.from(bridge.getTemplates() || []).filter(template => template && !template.ephemeral)
                    : [];
                nextFocused = typeof bridge.getFocusedTemplate === 'function'
                    ? bridge.getFocusedTemplate()
                    : null;
            } catch (error) {
                setStatus('Template history is temporarily unavailable.', 'error');
                reportError(error, 'refreshTemplates');
            }
            personalTemplatesById = new Map(personalTemplates.map(template => [String(template.id), template]));
            focusedTemplate = nextFocused;

            const nextTemplateId = focusedTemplate ? String(focusedTemplate.id) : null;
            if (draftTemplateId !== nextTemplateId) {
                draftTemplateId = nextTemplateId;
                setDraft(focusedTemplate && focusedTemplate.position, false);
            } else if (!draftDirty) {
                setDraft(focusedTemplate && focusedTemplate.position, false);
            }

            if (visible) renderTemplateList(personalTemplates, focusedTemplate, version);
            syncPositionPresentation();
            return controller;
        }

        function show() {
            if (destroyed) return false;
            visible = true;
            refresh();
            return true;
        }

        function hide() {
            if (destroyed) return false;
            visible = false;
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');
            unmountReticle();
            return false;
        }

        async function runAction(context, pendingMessage, work, failureMessage) {
            if (destroyed || actionBusy) return false;
            const version = ++actionVersion;
            actionBusy = true;
            setStatus(pendingMessage, 'busy');
            syncPositionPresentation();
            try {
                const result = await work();
                if (destroyed || version !== actionVersion) return false;
                return result;
            } catch (error) {
                if (!destroyed && version === actionVersion) setStatus(failureMessage, 'error');
                reportError(error, context);
                return false;
            } finally {
                if (!destroyed && version === actionVersion) {
                    actionBusy = false;
                    refresh();
                }
            }
        }

        async function focusPersonalTemplate(template) {
            if (!template || template.ephemeral || typeof bridge.focusTemplate !== 'function') return false;
            return runAction('focusTemplate', 'Focusing template\u2026', async () => {
                const result = await bridge.focusTemplate(template.id);
                if (!result) throw new Error('Template could not be focused');
                draftDirty = false;
                setStatus('Template focused.', 'success');
                return true;
            }, 'Could not focus that template.');
        }

        async function confirmDeletion(template) {
            const message = 'Delete "' + mobileViewBTemplateName(template) + '" from template history?';
            if (typeof callbackApi.confirmDelete === 'function') {
                return !!(await callbackApi.confirmDelete(template, message));
            }
            if (windowRef && typeof windowRef.confirm === 'function') return !!windowRef.confirm(message);
            return false;
        }

        async function deletePersonalTemplate(template) {
            if (!mobileViewBCanDeleteTemplate(template, new Set(personalTemplatesById.keys()))) return false;
            if (typeof bridge.deleteTemplate !== 'function') return false;
            return runAction('deleteTemplate', 'Confirming deletion\u2026', async () => {
                if (!(await confirmDeletion(template))) {
                    setStatus('Delete canceled.', '');
                    return false;
                }
                setStatus('Deleting template\u2026', 'busy');
                const result = await bridge.deleteTemplate(template.id);
                if (result === false) throw new Error('Template could not be deleted');
                draftDirty = false;
                setStatus('Template deleted.', 'success');
                return true;
            }, 'Could not delete that template.');
        }

        function handleListAction(event) {
            const target = findActionTarget(event && event.target, list, 'data-mvb-action');
            if (!target || target.disabled || actionBusy) return;
            const action = target.getAttribute('data-mvb-action');
            const id = String(target.getAttribute('data-mobile-template-id'));
            const template = personalTemplatesById.get(id);
            if (action === 'focus') {
                focusPersonalTemplate(template);
            } else if (action === 'delete') {
                deletePersonalTemplate(template);
            }
        }

        function readReticleDraft() {
            if (actionBusy || !mobileViewBCanEditPosition(bridge, focusedTemplate)
                || typeof bridge.readCenterGrid !== 'function') return;
            let result;
            try {
                result = bridge.readCenterGrid();
            } catch (error) {
                setStatus('Could not read the map center.', 'error');
                reportError(error, 'readCenterGrid');
                return;
            }
            const applyPoint = value => {
                if (destroyed) return;
                const point = mobileViewBNormalizeGridPoint(value);
                if (!point) {
                    setStatus('The map center is outside the paint grid.', 'error');
                    return;
                }
                setDraft(point, true);
                setStatus('Draft X ' + point.gridX + ', Y ' + point.gridY + '. Tap Set Location to commit.', 'success');
            };
            if (result && typeof result.then === 'function') {
                result.then(applyPoint).catch(error => {
                    if (destroyed) return;
                    setStatus('Could not read the map center.', 'error');
                    reportError(error, 'readCenterGrid');
                });
            } else {
                applyPoint(result);
            }
        }

        function commitDraftLocation() {
            const template = focusedTemplate;
            const point = readDraft();
            if (!point || !mobileViewBCanEditPosition(bridge, template)
                || typeof bridge.commitPosition !== 'function') return;
            runAction('commitPosition', 'Setting template location\u2026', async () => {
                const result = await bridge.commitPosition(template, point.gridX, point.gridY);
                if (result === false) throw new Error('Template location was rejected');
                draftDirty = false;
                setStatus('Location set to X ' + point.gridX + ', Y ' + point.gridY + '.', 'success');
                return true;
            }, 'Could not set the template location.');
        }

        function handleNudge(event) {
            const target = findActionTarget(event && event.target, dpad, 'data-mobile-nudge');
            if (!target || target.disabled || actionBusy) return;
            const delta = mobileViewBDpadDelta(target.getAttribute('data-mobile-nudge'));
            const template = focusedTemplate;
            if (!delta || !mobileViewBCanEditPosition(bridge, template)
                || typeof bridge.nudge !== 'function') return;
            runAction('nudge', 'Moving template one cell\u2026', async () => {
                const result = await bridge.nudge(template, delta.deltaX, delta.deltaY);
                if (result === false) throw new Error('Template move was rejected');
                const point = mobileViewBNormalizeGridPoint(result)
                    || mobileViewBNormalizeGridPoint(template.position);
                if (point) setDraft(point, false);
                else draftDirty = false;
                setStatus('Template moved one cell.', 'success');
                return true;
            }, 'Could not move the template.');
        }

        function togglePreview() {
            const template = focusedTemplate;
            if (!template || actionBusy || typeof bridge.togglePreview !== 'function') return;
            runAction('togglePreview', 'Updating preview\u2026', async () => {
                await bridge.togglePreview(template);
                setStatus('Preview updated.', 'success');
                return true;
            }, 'Could not update the template preview.');
        }

        function returnToPainting() {
            const callback = typeof callbackApi.returnToPainting === 'function'
                ? callbackApi.returnToPainting
                : callbackApi.onReturn;
            if (typeof callback !== 'function') return;
            try {
                const result = callback();
                if (result && typeof result.then === 'function') {
                    result.catch(error => reportError(error, 'returnToPainting'));
                }
            } catch (error) {
                reportError(error, 'returnToPainting');
            }
        }

        function updateDraftFromInputs() {
            draftX = String(xInput.value);
            draftY = String(yInput.value);
            draftDirty = true;
            syncPositionPresentation();
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;
            visible = false;
            refreshVersion += 1;
            actionVersion += 1;
            unmountReticle();
            if (typeof unsubscribeRefresh === 'function') {
                try { unsubscribeRefresh(); } catch (error) { reportError(error, 'unsubscribeRefresh'); }
            }
            for (let index = localCleanups.length - 1; index >= 0; index -= 1) {
                localCleanups[index]();
            }
            if (root.parentNode) root.parentNode.removeChild(root);
        }

        controller = Object.freeze({
            get visible() { return !destroyed && visible; },
            get destroyed() { return destroyed; },
            show,
            hide,
            refresh,
            destroy,
        });

        listen(returnButton, 'click', returnToPainting);
        listen(previewButton, 'click', togglePreview);
        listen(list, 'click', handleListAction);
        listen(reticle, 'click', readReticleDraft);
        listen(setLocationButton, 'click', commitDraftLocation);
        listen(xInput, 'input', updateDraftFromInputs);
        listen(yInput, 'input', updateDraftFromInputs);
        listen(dpad, 'click', handleNudge);

        if (typeof bridge.subscribeRefresh === 'function') {
            try {
                unsubscribeRefresh = bridge.subscribeRefresh(refresh);
            } catch (error) {
                reportError(error, 'subscribeRefresh');
            }
        }

        refresh();
        return controller;
    }

    const MOBILE_UI_SCALE_STORAGE_KEY = 'gpc-mobile-overhaul-ui-scale';
    const MOBILE_UI_SCALE_MIN = 75;
    const MOBILE_UI_SCALE_MAX = 150;
    const MOBILE_UI_SCALE_STEP = 5;
    const MOBILE_UI_SCALE_TARGET_SELECTOR = [
        '[data-gpc-mobile-scale-surface]',
        '#controls-left',
        '#controls-right',
        '#topControls',
        '#coordinateDisplay',
        '#resumePaintingControl',
        '.leaflet-control-container',
        '.maplibregl-control-container',
        '[role="dialog"]',
        'dialog',
        '.modal',
        '.popover',
        '.toast-container',
        '.gpc-mobile-panel-header',
        '.gpc-mobile-native-controls-row',
        '.gpc-mobile-view-a',
        '.gpc-mobile-view-b',
        '#gpc-mobile-template-reticle',
    ].join(',');

    function createMobileAdditions(bridge, lifecycle, shell, callbacks) {
        if (!bridge || typeof bridge !== 'object') {
            throw new TypeError('Mobile additions require the Mobile Overhaul bridge');
        }
        if (!shell || !shell.panel || !shell.row) {
            throw new TypeError('Mobile additions require shell.panel and shell.row');
        }

        const documentRef = (bridge.env && bridge.env.document) || shell.panel.ownerDocument;
        if (!documentRef || typeof documentRef.createElement !== 'function') {
            throw new Error('Mobile additions require a DOM document');
        }
        const windowRef = (bridge.env && bridge.env.window) || documentRef.defaultView;
        const callbackApi = callbacks || Object.create(null);
        const listenerCleanups = [];
        const scaleRecords = new Map();
        const eyedropperRecords = new Map();
        let unsubscribeRefresh = null;
        let mutationObserver = null;
        let refreshTimer = null;
        let fallbackEyedropper = null;
        let fallbackEyedropperListener = null;
        let destroyed = false;
        let previewOpen = false;
        let previewTemplate = null;
        let previewVersion = 0;
        let actionVersion = 0;
        let actionBusy = false;
        let previousFocus = null;
        let scaleExpanded = false;

        function reportError(error, context) {
            try {
                if (typeof callbackApi.onError === 'function') {
                    callbackApi.onError(error, context);
                    return;
                }
                if (typeof bridge.log === 'function') bridge.log('error', context, error);
            } catch (_) { /* Reporting an error must not create another one. */ }
        }

        function element(tagName, className, text) {
            const node = documentRef.createElement(tagName);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        }

        function button(className, text, label) {
            const node = element('button', className, text);
            node.type = 'button';
            if (label) node.setAttribute('aria-label', label);
            return node;
        }

        function option(value, label) {
            const node = element('option', '', label);
            node.value = value;
            return node;
        }

        function listen(target, type, listener, options) {
            if (!target || typeof target.addEventListener !== 'function') return;
            target.addEventListener(type, listener, options);
            listenerCleanups.push(() => {
                if (typeof target.removeEventListener === 'function') {
                    target.removeEventListener(type, listener, options);
                }
            });
        }

        function replaceChildren(target) {
            let first = target.firstChild || (target.childNodes && target.childNodes[0]);
            while (first) {
                target.removeChild(first);
                first = target.firstChild || (target.childNodes && target.childNodes[0]);
            }
            for (let index = 1; index < arguments.length; index += 1) {
                const child = arguments[index];
                if (child) target.appendChild(child);
            }
        }

        function captureAttribute(elementRef, name) {
            return {
                present: elementRef.hasAttribute(name),
                value: elementRef.getAttribute(name),
            };
        }

        function restoreAttribute(elementRef, name, record) {
            // Chromium keeps the CSSStyleDeclaration's empty backing
            // attribute alive after style.setProperty() + removeAttribute().
            // Replacing it through the attribute API first detaches that
            // backing declaration, allowing the second call to truly restore
            // an originally absent style attribute.
            if (name === 'style' && !record.present) {
                elementRef.setAttribute('style', '');
                elementRef.removeAttribute('style');
                return;
            }
            if (record.present) elementRef.setAttribute(name, record.value === null ? '' : record.value);
            else elementRef.removeAttribute(name);
        }

        function setImportantStyle(elementRef, name, value) {
            if (elementRef.style && typeof elementRef.style.setProperty === 'function') {
                elementRef.style.setProperty(name, value, 'important');
            } else if (elementRef.style) {
                elementRef.style[name] = value;
            }
        }

        const style = element('style');
        style.textContent = `
            .gpc-mobile-additions {
                --gma-surface: #ffffff; --gma-surface-2: #f8fafc; --gma-text: #1e293b;
                --gma-muted: #64748b; --gma-border: #cbd5e1; --gma-button: #e2e8f0;
                --gma-accent: #2563eb; --gma-danger: #b91c1c;
                color: var(--gma-text); font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
            }
            body.dark .gpc-mobile-additions {
                --gma-surface: #1e1e2e; --gma-surface-2: #313244; --gma-text: #cdd6f4;
                --gma-muted: #a6adc8; --gma-border: #585b70; --gma-button: #45475a;
                --gma-accent: #89b4fa; --gma-danger: #f38ba8;
            }
            .gpc-mobile-preview-overlay[hidden], .gpc-mobile-ui-scale-slider[hidden] { display: none !important; }
            .gpc-mobile-preview-overlay {
                position: fixed; inset: 0; z-index: 100010; box-sizing: border-box; display: flex;
                align-items: center; justify-content: center; padding: max(12px, env(safe-area-inset-top, 0px))
                max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px))
                max(12px, env(safe-area-inset-left, 0px)); background: rgba(15,23,42,.58);
                overscroll-behavior: contain; touch-action: manipulation;
            }
            .gpc-mobile-preview-card {
                box-sizing: border-box; width: min(94vw, 520px); max-height: min(88vh, 760px);
                display: flex; flex-direction: column; gap: 10px; overflow: auto; padding: 14px;
                border: 1px solid var(--gma-border); border-radius: 14px; background: var(--gma-surface);
                color: var(--gma-text); box-shadow: 0 18px 50px rgba(0,0,0,.35);
                padding-bottom: max(14px, env(safe-area-inset-bottom, 0px));
            }
            .gpc-mobile-preview-header { display: flex; align-items: center; gap: 8px; }
            .gpc-mobile-preview-title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 18px; }
            .gpc-mobile-preview-close, .gpc-mobile-preview-action, .gpc-mobile-eyedropper-fallback {
                box-sizing: border-box; min-width: 44px; min-height: 44px; border: 1px solid var(--gma-border);
                border-radius: 9px; padding: 8px 11px; background: var(--gma-button); color: var(--gma-text);
                font: inherit; font-weight: 650; cursor: pointer; touch-action: manipulation;
            }
            .gpc-mobile-preview-close { font-size: 20px; line-height: 1; }
            .gpc-mobile-preview-action:focus-visible, .gpc-mobile-preview-close:focus-visible,
            .gpc-mobile-ui-scale-button:focus-visible, .gpc-mobile-ui-scale-range:focus-visible,
            .gpc-mobile-preview-scope:focus-visible { outline: 3px solid var(--gma-accent); outline-offset: 2px; }
            .gpc-mobile-preview-frame {
                min-height: 132px; display: grid; place-items: center; overflow: auto; padding: 8px;
                border: 1px solid var(--gma-border); border-radius: 10px; background: var(--gma-surface-2);
            }
            .gpc-mobile-preview-frame canvas, .gpc-mobile-preview-frame img {
                display: block; max-width: 100%; height: auto; image-rendering: pixelated;
            }
            .gpc-mobile-preview-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
            .gpc-mobile-preview-hex { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
            .gpc-mobile-preview-scope {
                box-sizing: border-box; min-height: 44px; width: 100%; border: 1px solid var(--gma-border);
                border-radius: 9px; padding: 8px; background: var(--gma-surface-2); color: var(--gma-text); font: inherit;
            }
            .gpc-mobile-preview-status { min-height: 1.3em; color: var(--gma-muted); font-size: 13px; }
            .gpc-mobile-preview-status[data-kind="error"] { color: var(--gma-danger); }
            .gpc-mobile-preview-status[data-kind="success"] { color: #15803d; }
            body.dark .gpc-mobile-preview-status[data-kind="success"] { color: #a6e3a1; }
            .gpc-mobile-ui-scale-control {
                position: fixed; z-index: 100020; top: max(8px, env(safe-area-inset-top, 0px));
                right: max(8px, env(safe-area-inset-right, 0px)); pointer-events: auto;
            }
            .gpc-mobile-ui-scale-surface {
                display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 4px;
                border: 1px solid var(--gma-border); border-radius: 11px; background: var(--gma-surface);
                box-shadow: 0 5px 18px rgba(0,0,0,.2);
            }
            .gpc-mobile-ui-scale-button {
                box-sizing: border-box; min-width: 58px; min-height: 44px; border: 0; border-radius: 8px;
                padding: 7px; background: var(--gma-button); color: var(--gma-text); font: inherit;
                font-weight: 700; cursor: pointer; touch-action: manipulation;
            }
            .gpc-mobile-ui-scale-slider { display: flex; align-items: center; gap: 6px; min-width: 170px; }
            .gpc-mobile-ui-scale-range { min-width: 118px; min-height: 44px; accent-color: var(--gma-accent); touch-action: none; }
            .gpc-mobile-ui-scale-output { min-width: 42px; font-size: 12px; font-weight: 700; text-align: right; }
            .gpc-mobile-eyedropper-label { margin-left: 4px; font: inherit; font-size: 12px; }
            @media (orientation: landscape) and (max-height: 520px) {
                .gpc-mobile-preview-overlay { align-items: flex-start; padding-top: max(6px, env(safe-area-inset-top, 0px)); }
                .gpc-mobile-preview-card { width: min(96vw, 720px); max-height: calc(100vh - 12px); }
                .gpc-mobile-preview-frame { min-height: 88px; max-height: 34vh; }
                .gpc-mobile-preview-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                .gpc-mobile-ui-scale-control { top: max(4px, env(safe-area-inset-top, 0px)); }
            }
            @media (max-width: 380px) {
                .gpc-mobile-preview-actions, .gpc-mobile-preview-hex { grid-template-columns: 1fr; }
                .gpc-mobile-ui-scale-slider { min-width: 145px; }
                .gpc-mobile-ui-scale-range { min-width: 92px; }
            }
        `;

        const mountTarget = documentRef.body || documentRef.documentElement;
        if (!mountTarget) throw new Error('Mobile additions require a mounted document');

        const overlay = element('div', 'gpc-mobile-additions gpc-mobile-preview-overlay');
        overlay.id = 'gpc-mobile-preview-dialog';
        overlay.hidden = true;
        overlay.setAttribute('role', 'presentation');
        overlay.setAttribute('aria-hidden', 'true');

        const previewCard = element('section', 'gpc-mobile-preview-card');
        previewCard.setAttribute('role', 'dialog');
        previewCard.setAttribute('aria-modal', 'true');
        previewCard.setAttribute('aria-labelledby', 'gpc-mobile-preview-title');
        previewCard.setAttribute('data-gpc-mobile-scale-surface', 'preview');

        const previewHeader = element('div', 'gpc-mobile-preview-header');
        const previewTitle = element('h2', 'gpc-mobile-preview-title', 'Template preview');
        previewTitle.id = 'gpc-mobile-preview-title';
        const closeButton = button('gpc-mobile-preview-close', '\u00d7', 'Close template preview');
        previewHeader.appendChild(previewTitle);
        previewHeader.appendChild(closeButton);

        const previewFrame = element('div', 'gpc-mobile-preview-frame', 'Open a template to preview it.');
        previewFrame.setAttribute('aria-live', 'polite');

        const actions = element('div', 'gpc-mobile-preview-actions');
        const buyButton = button('gpc-mobile-preview-action', 'Buy all colors');
        const groupButton = button('gpc-mobile-preview-action', 'Group noise');
        const goToButton = button('gpc-mobile-preview-action', 'Go to');
        const togglePreviewButton = button('gpc-mobile-preview-action', 'Toggle preview');
        actions.appendChild(buyButton);
        actions.appendChild(groupButton);
        actions.appendChild(goToButton);
        actions.appendChild(togglePreviewButton);

        const hexRow = element('div', 'gpc-mobile-preview-hex');
        const hexScope = element('select', 'gpc-mobile-preview-scope');
        hexScope.setAttribute('aria-label', 'Hex value scope');
        hexScope.appendChild(option('all', 'All'));
        hexScope.appendChild(option('owned', 'Owned'));
        hexScope.appendChild(option('notOwned', 'Not owned'));
        hexScope.appendChild(option('selected', 'Currently selected'));
        hexScope.value = 'all';
        const copyButton = button('gpc-mobile-preview-action', 'Get hex values');
        hexRow.appendChild(hexScope);
        hexRow.appendChild(copyButton);

        const previewStatus = element('div', 'gpc-mobile-preview-status');
        previewStatus.setAttribute('role', 'status');
        previewStatus.setAttribute('aria-live', 'polite');

        previewCard.appendChild(previewHeader);
        previewCard.appendChild(previewFrame);
        previewCard.appendChild(actions);
        previewCard.appendChild(hexRow);
        previewCard.appendChild(previewStatus);
        overlay.appendChild(previewCard);

        const scaleRoot = element('div', 'gpc-mobile-additions gpc-mobile-ui-scale-control');
        scaleRoot.id = 'gpc-mobile-ui-scale-control';
        const scaleSurface = element('div', 'gpc-mobile-ui-scale-surface');
        scaleSurface.setAttribute('data-gpc-mobile-scale-surface', 'scale-control');
        const scaleButton = button('gpc-mobile-ui-scale-button', 'UI 100%', 'Adjust mobile UI scale');
        scaleButton.setAttribute('aria-expanded', 'false');
        const scaleSlider = element('div', 'gpc-mobile-ui-scale-slider');
        scaleSlider.hidden = true;
        const scaleRange = element('input', 'gpc-mobile-ui-scale-range');
        scaleRange.type = 'range';
        scaleRange.min = String(MOBILE_UI_SCALE_MIN);
        scaleRange.max = String(MOBILE_UI_SCALE_MAX);
        scaleRange.step = String(MOBILE_UI_SCALE_STEP);
        scaleRange.setAttribute('aria-label', 'Mobile UI scale');
        const scaleOutput = element('output', 'gpc-mobile-ui-scale-output', '100%');
        scaleSlider.appendChild(scaleRange);
        scaleSlider.appendChild(scaleOutput);
        scaleSurface.appendChild(scaleButton);
        scaleSurface.appendChild(scaleSlider);
        scaleRoot.appendChild(scaleSurface);

        scaleRoot.appendChild(style);
        mountTarget.appendChild(overlay);
        mountTarget.appendChild(scaleRoot);

        function clampScale(value) {
            const numeric = Number(value);
            const fallback = 100;
            if (!Number.isFinite(numeric)) return fallback;
            const stepped = Math.round(numeric / MOBILE_UI_SCALE_STEP) * MOBILE_UI_SCALE_STEP;
            return Math.max(MOBILE_UI_SCALE_MIN, Math.min(MOBILE_UI_SCALE_MAX, stepped));
        }

        function readStoredScale() {
            try {
                const storage = windowRef && windowRef.localStorage;
                if (!storage || typeof storage.getItem !== 'function') return 100;
                const stored = storage.getItem(MOBILE_UI_SCALE_STORAGE_KEY);
                return stored === null ? 100 : clampScale(stored);
            } catch (_) {
                return 100;
            }
        }

        let appliedScale = readStoredScale();
        let pendingScale = appliedScale;

        function matchesScaleSelector(elementRef) {
            if (!elementRef || typeof elementRef.matches !== 'function') return false;
            try { return elementRef.matches(MOBILE_UI_SCALE_TARGET_SELECTOR); } catch (_) { return false; }
        }

        function isScaleExempt(elementRef) {
            if (!elementRef || elementRef === shell.root || elementRef === shell.panel
                || elementRef === overlay || elementRef === scaleRoot) return true;
            const tagName = String(elementRef.tagName || '').toLowerCase();
            if (tagName === 'canvas' || tagName === 'script' || tagName === 'style'
                || tagName === 'link' || tagName === 'meta' || tagName === 'noscript') return true;
            const id = String(elementRef.id || '').toLowerCase();
            if (id === 'map' || id === 'mapcontainer' || id === 'gpp-renderer-root'
                || id === 'gpp-overlay-canvas' || id === 'gpp-canvas' || id === 'pixel-canvas') return true;
            const className = String(elementRef.className || '').toLowerCase();
            return className.includes('gpp-renderer') || className.includes('map-canvas');
        }

        function containsMapSurface(elementRef) {
            if (!elementRef || typeof elementRef.querySelector !== 'function') return false;
            try {
                return !!elementRef.querySelector(
                    '#map, #mapContainer, #pixel-canvas, #gpp-overlay-canvas, #gpp-renderer-root'
                );
            } catch (_) {
                return false;
            }
        }

        function isFullscreenUiOverlay(elementRef) {
            const className = String(elementRef && elementRef.className || '').toLowerCase();
            const inlineStyle = String(elementRef && elementRef.getAttribute
                ? elementRef.getAttribute('style') || ''
                : '').toLowerCase();
            return ((className.split(/\s+/u).includes('fixed')
                    || className.split(/\s+/u).includes('absolute'))
                    && (className.split(/\s+/u).includes('inset-0') || className.includes('inset-[0')))
                || (/position\s*:\s*(?:fixed|absolute)/u.test(inlineStyle)
                    && /inset\s*:\s*0/u.test(inlineStyle));
        }

        function collectGlobalUiRoots() {
            const roots = [];
            const bodyChildren = documentRef.body && documentRef.body.children
                ? Array.from(documentRef.body.children)
                : Array.from(documentRef.body && documentRef.body.childNodes || []);
            for (const child of bodyChildren) {
                if (!child || !child.tagName || isScaleExempt(child)) continue;
                // A map wrapper can also contain top-level controls. Never zoom
                // the wrapper itself: the renderer must retain exact geometry,
                // while the explicit UI-surface query below still finds its UI.
                if (containsMapSurface(child)) continue;
                if (isFullscreenUiOverlay(child)) {
                    const contentChildren = child.children
                        ? Array.from(child.children)
                        : Array.from(child.childNodes || []).filter(node => node && node.tagName);
                    for (const content of contentChildren) {
                        if (!isScaleExempt(content)) roots.push(content);
                    }
                    continue;
                }
                roots.push(child);
            }
            return roots;
        }

        function collectScaleTargets() {
            const candidates = [
                ...collectGlobalUiRoots(),
                shell.header,
                shell.row,
                previewCard,
                scaleSurface,
            ];
            if (typeof documentRef.querySelectorAll === 'function') {
                try {
                    candidates.push(...Array.from(documentRef.querySelectorAll(MOBILE_UI_SCALE_TARGET_SELECTOR)));
                } catch (error) {
                    reportError(error, 'queryScaleTargets');
                }
            }
            const unique = [];
            const seen = new Set();
            for (const candidate of candidates) {
                if (!candidate || seen.has(candidate) || isScaleExempt(candidate)) continue;
                seen.add(candidate);
                unique.push(candidate);
            }
            const selected = [];
            for (const candidate of unique) {
                let nested = false;
                for (const existing of selected) {
                    if (existing !== candidate && typeof existing.contains === 'function'
                        && existing.contains(candidate)) {
                        nested = true;
                        break;
                    }
                }
                if (nested) continue;
                for (let index = selected.length - 1; index >= 0; index -= 1) {
                    const existing = selected[index];
                    if (typeof candidate.contains === 'function' && candidate.contains(existing)) {
                        selected.splice(index, 1);
                    }
                }
                selected.push(candidate);
            }
            return selected;
        }

        function captureScaleTarget(target) {
            if (scaleRecords.has(target)) return scaleRecords.get(target);
            const record = {
                style: captureAttribute(target, 'style'),
                marker: captureAttribute(target, 'data-gpc-mobile-scale-applied'),
            };
            scaleRecords.set(target, record);
            return record;
        }

        function restoreScaleTarget(target) {
            const record = scaleRecords.get(target);
            if (!record) return;
            restoreAttribute(target, 'style', record.style);
            restoreAttribute(target, 'data-gpc-mobile-scale-applied', record.marker);
            scaleRecords.delete(target);
        }

        function applyScaleTargets() {
            if (destroyed) return;
            if (appliedScale === 100) {
                for (const target of Array.from(scaleRecords.keys())) restoreScaleTarget(target);
                return;
            }
            const targets = collectScaleTargets();
            const targetSet = new Set(targets);
            for (const target of Array.from(scaleRecords.keys())) {
                if (!targetSet.has(target)) restoreScaleTarget(target);
            }
            const ratio = String(appliedScale / 100);
            for (const target of targets) {
                captureScaleTarget(target);
                target.setAttribute('data-gpc-mobile-scale-applied', String(appliedScale));
                setImportantStyle(target, 'zoom', ratio);
            }
        }

        function updateScaleLabels(value) {
            const label = String(value) + '%';
            scaleRange.value = String(value);
            scaleOutput.textContent = label;
            scaleButton.textContent = 'UI ' + label;
            scaleRange.setAttribute('aria-valuetext', label);
        }

        function persistScale(value) {
            try {
                const storage = windowRef && windowRef.localStorage;
                if (storage && typeof storage.setItem === 'function') {
                    storage.setItem(MOBILE_UI_SCALE_STORAGE_KEY, String(value));
                }
            } catch (_) { /* Storage can be unavailable without disabling scaling. */ }
        }

        function setScale(value, shouldPersist) {
            if (destroyed) return appliedScale;
            appliedScale = clampScale(value);
            pendingScale = appliedScale;
            updateScaleLabels(appliedScale);
            applyScaleTargets();
            if (shouldPersist !== false) persistScale(appliedScale);
            return appliedScale;
        }

        function collapseScaleControl() {
            if (!scaleExpanded) return;
            scaleExpanded = false;
            scaleSlider.hidden = true;
            scaleButton.setAttribute('aria-expanded', 'false');
            if (documentRef.activeElement === scaleRange
                && typeof scaleButton.focus === 'function') {
                scaleButton.focus();
            }
        }

        function previewTemplateName(template) {
            return String((template && (template.name || template.title)) || 'Template');
        }

        function setPreviewStatus(message, kind) {
            previewStatus.textContent = message || '';
            previewStatus.setAttribute('data-kind', kind || '');
        }

        function syncPreviewActions() {
            const hasTemplate = !!previewTemplate;
            for (const control of [buyButton, groupButton, goToButton, togglePreviewButton, copyButton, hexScope]) {
                control.disabled = actionBusy || !hasTemplate;
            }
            previewCard.setAttribute('aria-busy', String(actionBusy));
            groupButton.setAttribute('aria-pressed', String(!!(previewTemplate && previewTemplate.groupNoise)));
            let previewForced = false;
            try {
                previewForced = !!(previewTemplate && typeof bridge.isPreviewForced === 'function'
                    && bridge.isPreviewForced(previewTemplate.id));
            } catch (error) {
                reportError(error, 'isPreviewForced');
            }
            togglePreviewButton.setAttribute('aria-pressed', String(previewForced));
        }

        function renderFreshPreview() {
            if (destroyed || !previewOpen || !previewTemplate) return;
            const version = ++previewVersion;
            replaceChildren(previewFrame, element('span', '', 'Loading full preview\u2026'));
            if (typeof bridge.renderFullPreview !== 'function') {
                replaceChildren(previewFrame, element('span', '', 'Full preview is unavailable.'));
                return;
            }
            let rendered;
            try {
                rendered = bridge.renderFullPreview(previewTemplate);
            } catch (error) {
                rendered = Promise.reject(error);
            }
            Promise.resolve(rendered).then(node => {
                if (destroyed || !previewOpen || version !== previewVersion) return;
                if (!node || typeof previewFrame.appendChild !== 'function') {
                    replaceChildren(previewFrame, element('span', '', 'Full preview is unavailable.'));
                    return;
                }
                replaceChildren(previewFrame, node);
            }).catch(error => {
                if (destroyed || !previewOpen || version !== previewVersion) return;
                replaceChildren(previewFrame, element('span', '', 'Could not render the full preview.'));
                setPreviewStatus('Preview rendering failed.', 'error');
                reportError(error, 'renderFullPreview');
            });
        }

        async function runPreviewAction(context, pendingMessage, work, successMessage) {
            if (destroyed || !previewOpen || !previewTemplate || actionBusy) return false;
            const version = ++actionVersion;
            actionBusy = true;
            setPreviewStatus(pendingMessage, 'busy');
            syncPreviewActions();
            try {
                const result = await work(previewTemplate);
                if (destroyed || !previewOpen || version !== actionVersion) return false;
                setPreviewStatus(
                    typeof successMessage === 'function' ? successMessage(result) : successMessage,
                    'success'
                );
                renderFreshPreview();
                return result;
            } catch (error) {
                if (!destroyed && previewOpen && version === actionVersion) {
                    setPreviewStatus('That action could not be completed.', 'error');
                }
                reportError(error, context);
                return false;
            } finally {
                if (!destroyed && version === actionVersion) {
                    actionBusy = false;
                    syncPreviewActions();
                }
            }
        }

        function openPreview(template) {
            if (destroyed || !template) return false;
            if (!previewOpen) previousFocus = documentRef.activeElement || null;
            previewTemplate = template;
            previewOpen = true;
            previewTitle.textContent = previewTemplateName(template) + ' preview';
            overlay.hidden = false;
            overlay.setAttribute('aria-hidden', 'false');
            setPreviewStatus('', '');
            syncPreviewActions();
            renderFreshPreview();
            applyScaleTargets();
            if (typeof closeButton.focus === 'function') closeButton.focus();
            return true;
        }

        function closePreview(options) {
            if (!previewOpen) return false;
            previewOpen = false;
            previewTemplate = null;
            previewVersion += 1;
            actionVersion += 1;
            actionBusy = false;
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            replaceChildren(previewFrame, element('span', '', 'Open a template to preview it.'));
            setPreviewStatus('', '');
            if (!options || options.restoreFocus !== false) {
                if (previousFocus && typeof previousFocus.focus === 'function'
                    && previousFocus.isConnected !== false) {
                    try { previousFocus.focus(); } catch (_) { /* Focus restoration is best effort. */ }
                }
            }
            previousFocus = null;
            return false;
        }

        function restoreEyedropper(nativeButton) {
            const record = eyedropperRecords.get(nativeButton);
            if (!record) return;
            if (record.label && record.label.parentNode === nativeButton) nativeButton.removeChild(record.label);
            restoreAttribute(nativeButton, 'style', record.style);
            restoreAttribute(nativeButton, 'aria-label', record.ariaLabel);
            restoreAttribute(nativeButton, 'title', record.title);
            restoreAttribute(nativeButton, 'data-gpc-mobile-eyedropper', record.marker);
            eyedropperRecords.delete(nativeButton);
        }

        function removeFallbackEyedropper() {
            if (!fallbackEyedropper) return;
            if (fallbackEyedropperListener) {
                fallbackEyedropper.removeEventListener('click', fallbackEyedropperListener);
            }
            if (fallbackEyedropper.parentNode) fallbackEyedropper.parentNode.removeChild(fallbackEyedropper);
            fallbackEyedropper = null;
            fallbackEyedropperListener = null;
        }

        function createFallbackEyedropper() {
            if (fallbackEyedropper || destroyed) return;
            fallbackEyedropper = button(
                'gpc-mobile-additions gpc-mobile-eyedropper-fallback',
                'Eyedropper',
                'Pick one color from the map'
            );
            fallbackEyedropper.id = 'gpc-mobile-eyedropper-fallback';
            fallbackEyedropperListener = async () => {
                if (fallbackEyedropper.disabled || typeof bridge.activateEyedropper !== 'function') return;
                fallbackEyedropper.disabled = true;
                try {
                    const result = await bridge.activateEyedropper();
                    if (result === false) throw new Error('Native eyedropper is unavailable');
                } catch (error) {
                    reportError(error, 'activateEyedropper');
                } finally {
                    if (fallbackEyedropper) fallbackEyedropper.disabled = false;
                }
            };
            fallbackEyedropper.addEventListener('click', fallbackEyedropperListener);
            const paintButton = documentRef.getElementById && documentRef.getElementById('commitBtn');
            if (paintButton && paintButton.parentNode === shell.row) {
                shell.row.insertBefore(fallbackEyedropper, paintButton.nextSibling || null);
            } else {
                shell.row.appendChild(fallbackEyedropper);
            }
        }

        function ensureEyedropper() {
            if (destroyed || typeof documentRef.getElementById !== 'function') return;
            const nativeButton = documentRef.getElementById('toggleEyedropper_Bottom');
            for (const recorded of Array.from(eyedropperRecords.keys())) {
                if (recorded !== nativeButton) restoreEyedropper(recorded);
            }
            if (!nativeButton) {
                createFallbackEyedropper();
                return;
            }
            removeFallbackEyedropper();
            if (!eyedropperRecords.has(nativeButton)) {
                const label = element('span', 'gpc-mobile-eyedropper-label', 'Eye');
                label.setAttribute('aria-hidden', 'true');
                const record = {
                    style: captureAttribute(nativeButton, 'style'),
                    ariaLabel: captureAttribute(nativeButton, 'aria-label'),
                    title: captureAttribute(nativeButton, 'title'),
                    marker: captureAttribute(nativeButton, 'data-gpc-mobile-eyedropper'),
                    label,
                };
                eyedropperRecords.set(nativeButton, record);
                nativeButton.appendChild(label);
            }
            nativeButton.setAttribute('aria-label', 'Pick one color from the map');
            nativeButton.setAttribute('title', 'Eyedropper (one use)');
            nativeButton.setAttribute('data-gpc-mobile-eyedropper', 'one-shot');
            setImportantStyle(nativeButton, 'min-width', '44px');
            setImportantStyle(nativeButton, 'min-height', '44px');
            const paintButton = documentRef.getElementById('commitBtn');
            if (paintButton && paintButton.parentNode === shell.row && nativeButton.parentNode === shell.row
                && paintButton.nextSibling !== nativeButton) {
                shell.row.insertBefore(nativeButton, paintButton.nextSibling || null);
            }
        }

        function refreshSurfaceEffects() {
            if (destroyed) return;
            ensureEyedropper();
            applyScaleTargets();
        }

        function refresh() {
            if (destroyed) return controller;
            refreshSurfaceEffects();
            if (previewOpen) {
                syncPreviewActions();
                renderFreshPreview();
            }
            return controller;
        }

        function nodeCanAffectAdditions(node) {
            if (!node || !node.tagName) return false;
            if (String(node.id || '') === 'toggleEyedropper_Bottom'
                || String(node.id || '') === 'commitBtn') return true;
            if (documentRef.body && node.parentNode === documentRef.body && !isScaleExempt(node)) return true;
            if (matchesScaleSelector(node)) return true;
            if (typeof node.querySelector === 'function') {
                try {
                    return !!(node.querySelector('#toggleEyedropper_Bottom, #commitBtn')
                        || node.querySelector(MOBILE_UI_SCALE_TARGET_SELECTOR));
                } catch (_) { return false; }
            }
            return false;
        }

        function scheduleSurfaceRefresh() {
            if (destroyed || refreshTimer !== null) return;
            const schedule = windowRef && typeof windowRef.setTimeout === 'function'
                ? windowRef.setTimeout.bind(windowRef)
                : setTimeout;
            refreshTimer = schedule(() => {
                refreshTimer = null;
                refreshSurfaceEffects();
            }, 32);
        }

        function onMutations(records) {
            for (const record of records || []) {
                if (record.type !== 'childList') continue;
                for (const node of Array.from(record.addedNodes || [])) {
                    if (nodeCanAffectAdditions(node)) {
                        scheduleSurfaceRefresh();
                        return;
                    }
                }
                for (const node of Array.from(record.removedNodes || [])) {
                    if (nodeCanAffectAdditions(node)) {
                        scheduleSurfaceRefresh();
                        return;
                    }
                }
            }
        }

        function destroy() {
            if (destroyed) return;
            closePreview({ restoreFocus: false });
            destroyed = true;
            previewVersion += 1;
            actionVersion += 1;
            if (typeof unsubscribeRefresh === 'function') {
                try { unsubscribeRefresh(); } catch (error) { reportError(error, 'unsubscribeRefresh'); }
            }
            if (mutationObserver) mutationObserver.disconnect();
            if (refreshTimer !== null) {
                const cancel = windowRef && typeof windowRef.clearTimeout === 'function'
                    ? windowRef.clearTimeout.bind(windowRef)
                    : clearTimeout;
                cancel(refreshTimer);
                refreshTimer = null;
            }
            for (let index = listenerCleanups.length - 1; index >= 0; index -= 1) {
                listenerCleanups[index]();
            }
            removeFallbackEyedropper();
            for (const nativeButton of Array.from(eyedropperRecords.keys())) restoreEyedropper(nativeButton);
            for (const target of Array.from(scaleRecords.keys())) restoreScaleTarget(target);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (scaleRoot.parentNode) scaleRoot.parentNode.removeChild(scaleRoot);
        }

        let controller = Object.freeze({
            get destroyed() { return destroyed; },
            get previewOpen() { return !destroyed && previewOpen; },
            get scale() { return appliedScale; },
            get pendingScale() { return pendingScale; },
            openPreview,
            closePreview,
            getScale: () => appliedScale,
            setScale,
            refresh,
            destroy,
        });

        listen(closeButton, 'click', () => closePreview());
        listen(overlay, 'click', event => {
            if (event.target === overlay) closePreview();
        });
        listen(documentRef, 'keydown', event => {
            if (previewOpen && (event.key === 'Escape' || event.key === 'Esc')) {
                if (typeof event.preventDefault === 'function') event.preventDefault();
                closePreview();
                return;
            }
            if (previewOpen && event.key === 'Tab') {
                const focusable = [
                    closeButton,
                    buyButton,
                    groupButton,
                    goToButton,
                    togglePreviewButton,
                    hexScope,
                    copyButton,
                ].filter(control => !control.disabled && control.hidden !== true);
                if (!focusable.length) return;
                const activeIndex = focusable.indexOf(documentRef.activeElement);
                const nextIndex = event.shiftKey
                    ? (activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1)
                    : (activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1);
                if (typeof event.preventDefault === 'function') event.preventDefault();
                if (typeof focusable[nextIndex].focus === 'function') focusable[nextIndex].focus();
            }
        });
        listen(scaleButton, 'click', () => {
            scaleExpanded = !scaleExpanded;
            scaleSlider.hidden = !scaleExpanded;
            scaleButton.setAttribute('aria-expanded', String(scaleExpanded));
            if (scaleExpanded && typeof scaleRange.focus === 'function') scaleRange.focus();
        });
        listen(scaleRange, 'input', () => {
            pendingScale = clampScale(scaleRange.value);
            updateScaleLabels(pendingScale);
        });
        listen(scaleRange, 'change', () => {
            setScale(pendingScale, true);
            collapseScaleControl();
        });
        listen(scaleRange, 'pointerup', () => {
            if (pendingScale !== appliedScale) setScale(pendingScale, true);
            collapseScaleControl();
        });
        listen(buyButton, 'click', () => runPreviewAction(
            'buyUnownedColors',
            'Opening color purchase\u2026',
            template => {
                if (typeof bridge.buyUnownedColors !== 'function') throw new Error('Buy action unavailable');
                return bridge.buyUnownedColors(template);
            },
            result => result && result.opened === false ? 'No colors need purchasing.' : 'Color purchase opened.'
        ));
        listen(copyButton, 'click', () => runPreviewAction(
            'copyHexValues',
            'Getting hex values\u2026',
            template => {
                if (typeof bridge.copyHexValues !== 'function') throw new Error('Hex action unavailable');
                return bridge.copyHexValues(template, hexScope.value || 'all');
            },
            result => result && result.copied === false ? 'Hex values shown.' : 'Hex values copied.'
        ));
        listen(groupButton, 'click', () => runPreviewAction(
            'setGroupNoise',
            'Updating group noise\u2026',
            async template => {
                if (typeof bridge.setGroupNoise !== 'function') throw new Error('Group noise unavailable');
                const enabled = await bridge.setGroupNoise(template, !template.groupNoise);
                template.groupNoise = !!enabled;
                return enabled;
            },
            enabled => enabled ? 'Group noise enabled.' : 'Group noise disabled.'
        ));
        listen(goToButton, 'click', () => runPreviewAction(
            'goTo',
            'Moving to template\u2026',
            template => {
                if (typeof bridge.goTo !== 'function') throw new Error('Go to unavailable');
                return bridge.goTo(template);
            },
            'Moved to template.'
        ));
        listen(togglePreviewButton, 'click', () => runPreviewAction(
            'togglePreview',
            'Updating preview visibility\u2026',
            template => {
                if (typeof bridge.togglePreview !== 'function') throw new Error('Preview toggle unavailable');
                return bridge.togglePreview(template);
            },
            'Preview visibility updated.'
        ));

        updateScaleLabels(appliedScale);
        refreshSurfaceEffects();

        if (typeof bridge.subscribeRefresh === 'function') {
            try {
                unsubscribeRefresh = bridge.subscribeRefresh(refresh);
            } catch (error) {
                reportError(error, 'subscribeRefresh');
            }
        }

        const MutationObserverCtor = windowRef && typeof windowRef.MutationObserver === 'function'
            ? windowRef.MutationObserver
            : (typeof MutationObserver === 'function' ? MutationObserver : null);
        const observeTarget = documentRef.body || documentRef.documentElement;
        if (MutationObserverCtor && observeTarget) {
            mutationObserver = new MutationObserverCtor(onMutations);
            mutationObserver.observe(observeTarget, { childList: true, subtree: true });
        }

        return controller;
    }

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

    let activeController = null;
    let activeInitPromise = null;

    async function initMobileOverhaul(bridge) {
        validateMobileOverhaulBridge(bridge);
        if (activeController) return activeController;
        if (activeInitPromise) return activeInitPromise;

        const pending = (async () => {
            await bridge.ready();
            const controller = createNativeControlsController(bridge, destroyedController => {
                if (activeController === destroyedController) activeController = null;
            });
            activeController = controller;
            return controller;
        })();
        activeInitPromise = pending;

        try {
            return await pending;
        } finally {
            if (activeInitPromise === pending) activeInitPromise = null;
        }
    }

    Object.defineProperties(initMobileOverhaul, {
        apiVersion: {
            value: MOBILE_OVERHAUL_API_VERSION,
            enumerable: true,
        },
        moduleVersion: {
            value: GPP_MOBILE_UI_VERSION,
            enumerable: true,
        },
    });

    return initMobileOverhaul;
})();
