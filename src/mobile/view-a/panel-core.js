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
        const hasProgress = !!options.hasProgress;
        const rawFilters = options.filters || [];
        const filters = new Set(Array.from(rawFilters, value => String(value)));
        const minCount = Number(options.minCount);
        const maxCount = Number(options.maxCount);
        const hasMinCount = Number.isFinite(minCount);
        const hasMaxCount = Number.isFinite(maxCount);

        // The palette grid always lists every template color -- "Show all
        // colors" only controls what the map renders (template.mask), not
        // which swatches this grid displays. Search/owned/progress/count
        // filters below still narrow the grid as normal.
        const filtered = Array.from(rows || []).map(row => ({
            row,
            searchScore: mobileViewAHexSearchScore(row && row.hex, query),
        })).filter(entry => {
            const row = entry.row || Object.create(null);
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
        if (!shell || !shell.panel || !shell.row) {
            throw new TypeError('View A requires shell.panel and shell.row');
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

        function iconButton(className, iconName, label) {
            const node = button(className, undefined, label);
            node.innerHTML = mobileIconMarkup(iconName);
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
                box-sizing: border-box; position: relative; display: flex; flex: 1 1 auto; min-height: 0;
                flex-direction: column; gap: 6px; overflow: hidden; padding: 4px 48px 4px 0;
                color: var(--gpp-mobile-text);
                overscroll-behavior: contain;
            }
            .gpc-mva-resize-handle {
                position: absolute; z-index: 4; top: 0; right: 0; width: 44px; height: 100%;
                border: 0; border-radius: 10px 0 0 10px; background: transparent; cursor: ns-resize;
                touch-action: none; user-select: none;
            }
            .gpc-mva-resize-handle::after {
                content: ''; position: absolute; top: 50%; right: 12px; width: 4px; height: 32px;
                transform: translateY(-50%);
                border-radius: 999px; background: var(--gpp-mobile-border);
            }
            .gpc-mva-toolbar { display: flex; align-items: center; gap: 6px; min-width: 0; }
            .gpc-mva-search, .gpc-mva-select, .gpc-mva-count {
                box-sizing: border-box; min-height: 44px; border: 1px solid var(--gpp-mobile-border);
                border-radius: 8px; background: var(--gpp-mobile-surface-2); color: var(--gpp-mobile-text);
                font: inherit; font-size: 14px; padding: 8px;
            }
            .gpc-mva-search { flex: 1 1 110px; min-width: 88px; }
            .gpc-mva-tool-button {
                box-sizing: border-box; min-width: 44px; min-height: 44px; padding: 6px 9px;
                border: 1px solid var(--gpp-mobile-border); border-radius: 8px;
                background: var(--gpp-mobile-surface-3); color: var(--gpp-mobile-text); font: inherit;
                font-size: 18px; cursor: pointer; touch-action: manipulation;
                display: inline-flex; align-items: center; justify-content: center;
            }
            .gpc-mva-tool-button[aria-pressed='true'] {
                background: var(--gpp-mobile-focus); color: #ffffff;
                box-shadow: 0 0 0 2px var(--gpp-mobile-focus-wash);
            }
            .gpc-mva-fold-region { position: relative; }
            .gpc-mva-fold {
                position: absolute; z-index: 8; right: 0; bottom: calc(100% + 6px); width: min(360px, 92vw);
                box-sizing: border-box; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
                padding: 10px; border: 1px solid var(--gpp-mobile-border); border-radius: 10px;
                background: var(--gpp-mobile-surface); color: var(--gpp-mobile-text);
                box-shadow: 0 8px 24px rgba(15, 23, 42, .24); overscroll-behavior: contain;
            }
            body.dark .gpc-mva-fold { box-shadow: 0 8px 24px rgba(0, 0, 0, .45); }
            .gpc-mva-fold[hidden] { display: none; }
            .gpc-mva-field { display: flex; min-width: 0; flex-direction: column; gap: 4px;
                color: var(--gpp-mobile-muted); font-size: 12px; font-weight: 700; }
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
                border: 2px solid var(--gpp-mobile-border); border-radius: 9px; overflow: hidden;
                cursor: pointer; scroll-snap-align: start; touch-action: manipulation;
            }
            .gpc-mva-swatch[aria-pressed='true'] { border-color: var(--gpp-mobile-focus); box-shadow: 0 0 0 2px var(--gpp-mobile-focus); }
            .gpc-mva-swatch:disabled { cursor: progress; opacity: .65; }
            .gpc-mva-swatch-label {
                position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 1px;
                background: rgba(0, 0, 0, .7); color: #ffffff; font: 700 9px/1.2 ui-monospace, monospace;
                text-align: center; pointer-events: none;
            }
            body.dark .gpc-mva-swatch-label { background: rgba(0, 0, 0, .78); color: #ffffff; }
            .gpc-mva-scrub { box-sizing: border-box; width: 100%; min-height: 24px; margin: 0; touch-action: pan-x; }
            .gpc-mva-empty { align-self: center; padding: 8px; color: var(--gpp-mobile-muted); font-size: 12px; }
            .gpc-mva-thumbnail-column { display: flex; min-width: 0; flex-direction: column; }
            .gpc-mva-thumbnail {
                box-sizing: border-box; display: flex; flex: 1 1 auto; min-height: 64px; align-items: center;
                justify-content: center; padding: 4px; border: 1px solid var(--gpp-mobile-border);
                border-radius: 9px; background: var(--gpp-mobile-surface-2); color: var(--gpp-mobile-muted);
                overflow: hidden; cursor: pointer; touch-action: manipulation;
            }
            .gpc-mva-thumbnail canvas, .gpc-mva-thumbnail img {
                display: block; max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: pixelated;
            }
            .gpc-mva-stats { flex: 0 0 auto; min-height: 18px; color: var(--gpp-mobile-muted);
                font-size: 12px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .gpc-mva-status { min-height: 16px; color: var(--gpp-mobile-danger); font-size: 11px; }
            .gpc-mobile-view-a :focus-visible { outline: 3px solid var(--gpp-mobile-focus); outline-offset: 2px; }
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

        const showAllButton = iconButton('gpc-mva-tool-button', 'showAllColors', 'Show all template colors');
        showAllButton.title = 'Show all colors';
        showAllButton.setAttribute('aria-pressed', 'false');

        const thumbnailToggle = iconButton('gpc-mva-tool-button', 'hideThumbnail', 'Hide template thumbnail');
        thumbnailToggle.title = 'Hide template thumbnail';
        thumbnailToggle.setAttribute('aria-pressed', 'false');

        const wrenchButton = iconButton('gpc-mva-tool-button', 'settings', 'Open template settings');
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
                // While "Show all colors" is on, selecting a swatch only
                // changes the active native paint color -- it must not
                // narrow template.mask back down to one color, or the map
                // would stop showing the rest of the project as a guide the
                // moment the user picks a color to actually paint with.
                selection = bridge.selectColor(row.index, { narrowMask: !showAll });
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
                paletteScroller.appendChild(element('div', 'gpc-mva-empty', 'No colors match the current search or filters.'));
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
            showAllButton.title = showAll
                ? 'Showing the whole project on the map -- tap to show only the active color'
                : 'Showing only the active color on the map -- tap to preview the whole project';
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
            // Directly widens/narrows template.mask (the renderer only ever
            // draws mask-selected colors) instead of being a display-only
            // palette-grid filter -- otherwise toggling this would never
            // have actually changed what the map shows.
            if (typeof bridge.setShowAllColors === 'function') {
                Promise.resolve(bridge.setShowAllColors(showAll)).catch(error => {
                    reportError(error, 'setShowAllColors');
                });
            }
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
