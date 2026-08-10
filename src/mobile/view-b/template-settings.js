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

        function isPlacementActive() {
            return typeof bridge.isPlacementActive === 'function' && !!bridge.isPlacementActive();
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
                box-sizing: border-box; display: flex; flex: 1 1 auto;
                min-height: 0; flex-direction: column; gap: 7px; overflow: hidden; color: var(--gpp-mobile-text);
                padding: 3px 0 max(4px, env(safe-area-inset-bottom, 0px));
                overscroll-behavior: contain;
            }
            .gpc-mvb-topbar { display: flex; align-items: center; gap: 7px; min-width: 0; }
            .gpc-mvb-title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 15px; line-height: 1.2; }
            .gpc-mvb-button, .gpc-mvb-input {
                box-sizing: border-box; min-width: 44px; min-height: 44px; border: 1px solid var(--gpp-mobile-border);
                border-radius: 8px; background: var(--gpp-mobile-surface-3); color: var(--gpp-mobile-text);
                font: inherit; font-size: 14px; touch-action: manipulation;
            }
            .gpc-mvb-button { padding: 7px 10px; cursor: pointer; font-weight: 700; }
            .gpc-mvb-button[disabled], .gpc-mvb-input[disabled] { opacity: .48; cursor: not-allowed; }
            .gpc-mvb-button:focus-visible, .gpc-mvb-input:focus-visible {
                outline: 3px solid var(--gpp-mobile-focus); outline-offset: 2px;
            }
            .gpc-mvb-return { font-size: 20px; }
            .gpc-mvb-preview[aria-pressed="true"] { background: var(--gpp-mobile-focus); color: #ffffff; }
            .gpc-mvb-list {
                flex: 1 1 auto; min-height: 68px; overflow-y: auto; padding: 2px 3px 2px 0;
                display: flex; flex-direction: column; gap: 6px; overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
            }
            .gpc-mvb-card {
                display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center;
                gap: 7px; min-height: 58px; padding: 5px; border: 1px solid var(--gpp-mobile-border);
                border-radius: 10px; background: var(--gpp-mobile-surface-2);
            }
            .gpc-mvb-card.is-focused {
                grid-template-columns: 72px minmax(0, 1fr); min-height: 84px;
                border: 2px solid var(--gpp-mobile-focus); background: var(--gpp-mobile-surface);
            }
            .gpc-mvb-card.is-ephemeral { border-style: dashed; }
            .gpc-mvb-thumb {
                width: 48px; height: 48px; display: grid; place-items: center; overflow: hidden;
                border: 1px solid var(--gpp-mobile-border); border-radius: 7px; background: var(--gpp-mobile-surface);
                color: var(--gpp-mobile-muted); font-size: 10px;
            }
            .gpc-mvb-card.is-focused .gpc-mvb-thumb { width: 72px; height: 72px; grid-row: span 2; }
            .gpc-mvb-thumb > canvas, .gpc-mvb-thumb > img {
                display: block; max-width: 100%; max-height: 100%; object-fit: contain;
            }
            .gpc-mvb-card-copy { min-width: 0; }
            .gpc-mvb-card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; }
            .gpc-mvb-card-meta { margin-top: 2px; color: var(--gpp-mobile-muted); font-size: 11px; }
            .gpc-mvb-card-actions { display: flex; align-items: center; gap: 5px; }
            .gpc-mvb-card.is-focused .gpc-mvb-card-actions { grid-column: 2; justify-content: flex-start; }
            .gpc-mvb-card-action { min-width: 44px; min-height: 44px; padding: 5px 8px; }
            .gpc-mvb-delete { color: var(--gpp-mobile-danger); }
            .gpc-mvb-empty { padding: 14px 8px; color: var(--gpp-mobile-muted); text-align: center; }
            .gpc-mvb-position {
                flex: 0 0 auto; display: grid; grid-template-columns: minmax(96px, 1.2fr) minmax(0, 1fr) auto;
                align-items: center; gap: 7px; padding-top: 6px; border-top: 1px solid var(--gpp-mobile-border);
            }
            .gpc-mvb-set-location { align-self: stretch; background: var(--gpp-mobile-focus); color: #ffffff; }
            .gpc-mvb-coordinates { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; min-width: 0; }
            .gpc-mvb-coordinate { min-width: 0; color: var(--gpp-mobile-muted); font-size: 11px; font-weight: 700; }
            .gpc-mvb-input { width: 100%; padding: 6px; background: var(--gpp-mobile-surface-2); }
            .gpc-mvb-dpad {
                display: grid; grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(2, 44px);
                gap: 3px; touch-action: manipulation;
            }
            .gpc-mvb-nudge { padding: 0; font-size: 18px; }
            .gpc-mvb-nudge[data-mobile-nudge="up"] { grid-column: 2; grid-row: 1; }
            .gpc-mvb-nudge[data-mobile-nudge="left"] { grid-column: 1; grid-row: 2; }
            .gpc-mvb-nudge[data-mobile-nudge="down"] { grid-column: 2; grid-row: 2; }
            .gpc-mvb-nudge[data-mobile-nudge="right"] { grid-column: 3; grid-row: 2; }
            .gpc-mvb-status { min-height: 16px; color: var(--gpp-mobile-muted); font-size: 11px; }
            .gpc-mvb-status[data-kind="error"] { color: var(--gpp-mobile-danger); }
            .gpc-mvb-place {
                grid-column: 1 / -1; min-height: 44px; background: var(--gpp-mobile-surface-3);
                color: var(--gpp-mobile-text); border: 1px dashed var(--gpp-mobile-border);
            }
            .gpc-mvb-place[aria-pressed="true"] {
                background: var(--gpp-mobile-focus); color: #ffffff; border-style: solid;
            }
            .gpc-mvb-place[disabled] { opacity: .45; cursor: not-allowed; }
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
        // Tap-to-place: an ordinary panel button now, not a separate element
        // floating over the map -- arms gppBeginPlacementCapture (via the
        // bridge) and the next tap anywhere on the map commits the position
        // directly, exactly like desktop's own Place button. No special
        // mount target needed, unlike the reticle this replaces.
        const placeButton = button('gpc-mvb-button gpc-mvb-place', 'Tap map to place', 'Tap the map to set the template location');
        placeButton.id = 'gpc-mobile-template-place';
        placeButton.setAttribute('aria-pressed', 'false');

        positionControls.appendChild(placeButton);
        positionControls.appendChild(setLocationButton);
        positionControls.appendChild(coordinates);
        positionControls.appendChild(dpad);
        root.appendChild(staticStyle);
        root.appendChild(topbar);
        root.appendChild(list);
        root.appendChild(positionControls);
        root.appendChild(status);
        shell.panel.appendChild(root);

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
            const placing = isPlacementActive();
            placeButton.disabled = actionBusy || !editable;
            placeButton.setAttribute('aria-pressed', String(placing));
            placeButton.textContent = placing ? 'Tap the map…' : 'Tap map to place';
            placeButton.title = !editable
                ? 'This template position cannot be changed'
                : placing
                    ? 'Tap anywhere on the map to set the location, or tap again to cancel'
                    : 'Tap the map to set the template location';
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
            // Leaving View B while placement is armed must not leave a
            // capture-phase map listener dangling behind -- Return/any exit
            // path cancels it, same as navigating away always should.
            cancelTapToPlace();
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

        function startTapToPlace() {
            if (actionBusy || isPlacementActive() || !mobileViewBCanEditPosition(bridge, focusedTemplate)
                || typeof bridge.beginPlacement !== 'function') return;
            const template = focusedTemplate;
            bridge.beginPlacement(
                template,
                point => {
                    // onPlaced -- the bridge already committed the position
                    // directly (matching desktop's Place button: a tap IS
                    // the commit, there is no intermediate draft step here).
                    // Placement-active state is read from the bridge, never
                    // cached locally: committing runs gppMobilePostlude()
                    // (a full refresh fan-out) BEFORE this callback fires,
                    // so a locally-cached flag here would still read stale
                    // during that intermediate refresh -- the bridge's own
                    // gppMobilePlacementActive is already correct by then.
                    if (destroyed) return;
                    if (point) {
                        setDraft(point, false);
                        setStatus('Location set to X ' + point.gridX + ', Y ' + point.gridY + '.', 'success');
                    } else {
                        setStatus('Could not set that location.', 'error');
                    }
                    syncPositionPresentation();
                },
                (message, isError) => {
                    if (destroyed) return;
                    setStatus(message, isError ? 'error' : 'success');
                    syncPositionPresentation();
                }
            );
            syncPositionPresentation();
        }

        function cancelTapToPlace() {
            if (!isPlacementActive()) return;
            if (typeof bridge.cancelPlacement === 'function') {
                try { bridge.cancelPlacement(); } catch (error) { reportError(error, 'cancelPlacement'); }
            }
            if (!destroyed) syncPositionPresentation();
        }

        function togglePlacement() {
            if (isPlacementActive()) cancelTapToPlace();
            else startTapToPlace();
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
            cancelTapToPlace();
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
        listen(placeButton, 'click', togglePlacement);
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
