    const MOBILE_UI_SCALE_STORAGE_KEY = 'gpc-mobile-overhaul-ui-scale';
    const MOBILE_UI_SCALE_MIN = 75;
    const MOBILE_UI_SCALE_MAX = 150;
    const MOBILE_UI_SCALE_STEP = 5;
    // Deliberately scoped to elements GeoPixelcons++ itself owns and
    // controls, not a guess at native-site DOM structure (no #controls-left,
    // .leaflet-control-container, [role="dialog"], etc.) -- those selectors
    // used to double as a second, less risky path into the same territory
    // collectGlobalUiRoots() used to walk more broadly. Scaling anything the
    // native site owns is exactly the kind of guess that breaks silently the
    // next time that site's own markup changes.
    const MOBILE_UI_SCALE_TARGET_SELECTOR = [
        '[data-gpc-mobile-scale-surface]',
        '#gpc-mobile-hamburger',
        '.gpc-mobile-native-controls-row',
        '.gpc-mobile-view-a',
        '.gpc-mobile-view-b',
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
                color: var(--gpp-mobile-text); font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
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
                border: 1px solid var(--gpp-mobile-border); border-radius: 14px; background: var(--gpp-mobile-surface);
                color: var(--gpp-mobile-text); box-shadow: 0 18px 50px rgba(0,0,0,.35);
                padding-bottom: max(14px, env(safe-area-inset-bottom, 0px));
            }
            .gpc-mobile-preview-header { display: flex; align-items: center; gap: 8px; }
            .gpc-mobile-preview-title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 18px; }
            .gpc-mobile-preview-close, .gpc-mobile-preview-action, .gpc-mobile-eyedropper-fallback {
                box-sizing: border-box; min-width: 44px; min-height: 44px; border: 1px solid var(--gpp-mobile-border);
                border-radius: 9px; padding: 8px 11px; background: var(--gpp-mobile-surface-3); color: var(--gpp-mobile-text);
                font: inherit; font-weight: 650; cursor: pointer; touch-action: manipulation;
            }
            .gpc-mobile-preview-close { font-size: 20px; line-height: 1; }
            .gpc-mobile-preview-action:focus-visible, .gpc-mobile-preview-close:focus-visible,
            .gpc-mobile-ui-scale-button:focus-visible, .gpc-mobile-ui-scale-range:focus-visible,
            .gpc-mobile-preview-scope:focus-visible { outline: 3px solid var(--gpp-mobile-focus); outline-offset: 2px; }
            .gpc-mobile-preview-frame {
                min-height: 132px; display: grid; place-items: center; overflow: auto; padding: 8px;
                border: 1px solid var(--gpp-mobile-border); border-radius: 10px; background: var(--gpp-mobile-surface-2);
            }
            .gpc-mobile-preview-frame canvas, .gpc-mobile-preview-frame img {
                display: block; max-width: 100%; height: auto; image-rendering: pixelated;
            }
            .gpc-mobile-preview-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
            .gpc-mobile-preview-hex { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
            .gpc-mobile-preview-scope {
                box-sizing: border-box; min-height: 44px; width: 100%; border: 1px solid var(--gpp-mobile-border);
                border-radius: 9px; padding: 8px; background: var(--gpp-mobile-surface-2); color: var(--gpp-mobile-text); font: inherit;
            }
            .gpc-mobile-preview-status { min-height: 1.3em; color: var(--gpp-mobile-muted); font-size: 13px; }
            .gpc-mobile-preview-status[data-kind="error"] { color: var(--gpp-mobile-danger); }
            .gpc-mobile-preview-status[data-kind="success"] { color: #15803d; }
            body.dark .gpc-mobile-preview-status[data-kind="success"] { color: #a6e3a1; }
            .gpc-mobile-ui-scale-control {
                /* An ordinary row item now, alongside the relocated native
                   controls and the close button -- not a floating corner
                   overlay with no relationship to anything else on screen. */
                flex: 0 0 auto; display: flex; align-items: center;
            }
            .gpc-mobile-ui-scale-surface {
                display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 4px;
                border: 1px solid var(--gpp-mobile-border); border-radius: 11px; background: var(--gpp-mobile-surface-2);
            }
            .gpc-mobile-ui-scale-button {
                box-sizing: border-box; min-width: 58px; min-height: 44px; border: 0; border-radius: 8px;
                padding: 7px; background: var(--gpp-mobile-surface-3); color: var(--gpp-mobile-text); font: inherit;
                font-weight: 700; cursor: pointer; touch-action: manipulation;
            }
            .gpc-mobile-ui-scale-slider { display: flex; align-items: center; gap: 6px; min-width: 170px; }
            .gpc-mobile-ui-scale-range { min-width: 118px; min-height: 44px; accent-color: var(--gpp-mobile-focus); touch-action: none; }
            .gpc-mobile-ui-scale-output { min-width: 42px; font-size: 12px; font-weight: 700; text-align: right; }
            .gpc-mobile-eyedropper-label { margin-left: 4px; font: inherit; font-size: 12px; }
            @media (orientation: landscape) and (max-height: 520px) {
                .gpc-mobile-preview-overlay { align-items: flex-start; padding-top: max(6px, env(safe-area-inset-top, 0px)); }
                .gpc-mobile-preview-card { width: min(96vw, 720px); max-height: calc(100vh - 12px); }
                .gpc-mobile-preview-frame { min-height: 88px; max-height: 34vh; }
                .gpc-mobile-preview-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
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
        const closeButton = button('gpc-mobile-preview-close', '\u2715', 'Close template preview');
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
        // overlay/scaleRoot are appended at the very end of this function
        // (right before `return controller`), once every listener/observer
        // is wired and nothing else here can throw -- appending this early
        // and then failing partway through the rest of construction would
        // orphan live, visible DOM nodes with nothing left holding a
        // reference to destroy them.

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

        function collectScaleTargets() {
            const candidates = [
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

        // Cheap early-bail before any of nodeCanAffectAdditions()'s
        // querySelector work: pan/zoom on the map is by far the
        // highest-volume mutation source on this page (markers/overlays
        // repositioning every frame), and nothing this controller cares
        // about (the UI scale targets, toggleEyedropper_Bottom, commitBtn)
        // ever lives inside the map/renderer container, so a mutation whose
        // target sits inside it can never affect this controller.
        function mutationTargetInMapContainer(target) {
            return !!(target && typeof target.closest === 'function'
                && target.closest('#map, .maplibregl-canvas-container, #gpp-renderer-root'));
        }

        function onMutations(records) {
            for (const record of records || []) {
                if (record.type !== 'childList') continue;
                if (mutationTargetInMapContainer(record.target)) continue;
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

        mountTarget.appendChild(overlay);
        // The scale control lives in the native controls row now (an
        // ordinary row item, not a floating top-right corner button with no
        // relationship to anything else on screen) -- shell.row itself is
        // always append-last by native-controls.js's own refresh(), so this
        // only needs to land somewhere inside it, not specifically last.
        shell.row.appendChild(scaleRoot);

        return controller;
    }
