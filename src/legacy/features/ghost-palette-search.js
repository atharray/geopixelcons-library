
    // ============================================================
    //  FEATURE: Ghost Palette Color Search [ghostPaletteSearch]
    // ============================================================
    if (_settings.ghostPaletteSearch) {
        try {
            (function _init_ghostPaletteSearch() {

    // Wait for the ghostColorPalette to exist. Polls forever by design (no
    // giveup-and-stop) -- unlike a UI button that can gracefully stay
    // unmounted, this is the anchor the whole search/filter feature is built
    // on, so there's no fallback if it never appears. #ghostColorPalette is
    // never (re)populated while Ghost++ owns the overlay slot (see gpp-
    // native-shim.js's own header comment), so for a Ghost++ user this is a
    // genuinely expected, permanent "still waiting" state, not a bug -- the
    // 15s mark logs that context once instead of leaving zero trace of why
    // this feature's UI never showed up.
    function waitForElement(selector, callback) {
        const startedAt = Date.now();
        let firstCheck = true;
        let warnedSlow = false;
        function check() {
            const element = document.querySelector(selector);
            if (element) {
                dbgPush('Ghost Palette Search: ' + selector + ' found after ' + (Date.now() - startedAt) + 'ms.', { uiComponent: 'Ghost Palette Search' });
                callback(element);
                return;
            }
            if (firstCheck) {
                firstCheck = false;
                dbgPush('Ghost Palette Search: ' + selector + ' not found yet -- watching (polling every 500ms).', { uiComponent: 'Ghost Palette Search' });
            }
            if (!warnedSlow && (Date.now() - startedAt) >= 15000) {
                warnedSlow = true;
                dbgPush('Ghost Palette Search: still waiting for ' + selector + ' after 15s -- if Ghost++ is enabled, this is expected (it blocks the native ghost palette from ever populating while it owns the overlay), so this search UI will stay unmounted until Ghost++ is disabled. Will keep watching in case that changes.', { uiComponent: 'Ghost Palette Search' });
                console.warn('[GeoPixelcons++] Ghost Palette Search: still waiting for ' + selector + ' after 15s.');
            }
            setTimeout(check, 500);
        }
        check();
    }

    // Add CSS for the glow effect
    const style = document.createElement('style');
    style.textContent = `
        .color-search-glow {
            box-shadow: 0 0 8px 2px rgba(255, 215, 0, 0.8) !important;
            animation: pulse-glow 1.5s ease-in-out infinite;
        }

        @keyframes pulse-glow {
            0%, 100% {
                box-shadow: 0 0 8px 2px rgba(255, 215, 0, 0.8) !important;
            }
            50% {
                box-shadow: 0 0 12px 3px rgba(255, 215, 0, 1) !important;
            }
        }

        .color-search-container {
            margin-bottom: 12px;
            padding: 12px;
            background: var(--color-gray-200, #f9fafb);
            border-radius: 8px;
            border: 1px solid var(--color-gray-300, #e5e7eb);
        }

        .color-search-input {
            width: 100%;
            min-height: 34px;
            height: 34px;
            max-height: 110px;
            padding: 8px 12px;
            border: 2px solid var(--color-gray-400, #d1d5db);
            border-radius: 6px;
            font-size: 14px;
            line-height: 18px;
            transition: border-color 0.2s;
            background: var(--color-gray-100, #fff);
            color: var(--color-gray-900, inherit);
            resize: vertical;
            overflow-y: auto;
            box-sizing: border-box;
        }

        .color-search-input:focus {
            outline: none;
            border-color: #3b82f6;
        }

        .color-search-input::placeholder {
            color: var(--color-gray-600, #9ca3af);
        }

        .gpc-search-toggle-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 8px;
            font-size: 14px;
            color: var(--color-gray-800, #374151);
        }

        .gpc-search-toggle-row input {
            width: 15px;
            height: 15px;
            cursor: pointer;
        }

        .gpc-search-toggle-row label {
            cursor: pointer;
            user-select: none;
        }

        .gpc-search-controls-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
        }

        .gpc-filter-dropdown {
            position: relative;
            width: 42%;
            min-width: 142px;
            flex: 0 0 42%;
        }

        .gpc-filter-button,
        .gpc-sort-select {
            width: 100%;
            min-height: 30px;
            border: 2px solid var(--color-gray-400, #d1d5db);
            border-radius: 6px;
            background: var(--color-gray-100, #fff);
            color: var(--color-gray-900, inherit);
            font-size: 13px;
            cursor: pointer;
        }

        .gpc-filter-button {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 3px 8px;
            text-align: left;
        }

        .gpc-filter-menu {
            display: none;
            position: absolute;
            top: calc(100% + 4px);
            left: 0;
            z-index: 100000;
            min-width: 210px;
            padding: 6px;
            border: 1px solid var(--color-gray-300, #e5e7eb);
            border-radius: 8px;
            background: var(--color-gray-100, #fff);
            box-shadow: 0 8px 24px rgba(0,0,0,0.16);
        }

        .gpc-filter-menu.gpc-open {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .gpc-filter-option {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 4px 5px;
            border-radius: 5px;
            font-size: 13px;
            color: var(--color-gray-900, inherit);
            cursor: pointer;
            user-select: none;
        }

        .gpc-filter-option:hover {
            background: var(--color-gray-200, #f3f4f6);
        }

        .gpc-filter-option input {
            width: 14px;
            height: 14px;
            cursor: pointer;
        }

        .gpc-filter-count {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            padding: 2px 5px 4px 26px;
            font-size: 13px;
            color: var(--color-gray-900, inherit);
        }

        .gpc-count-input {
            width: 64px;
            min-height: 26px;
            border: 2px solid var(--color-gray-400, #d1d5db);
            border-radius: 5px;
            background: var(--color-gray-100, #fff);
            color: var(--color-gray-900, inherit);
            font-size: 12px;
            padding: 2px 6px;
        }

        .gpc-sort-wrap {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 1 1 auto;
            min-width: 190px;
        }

        .gpc-sort-select {
            flex: 1 1 auto;
            padding: 3px 6px;
        }

        .color-search-container.gpc-controls-stacked .gpc-search-controls-row {
            flex-direction: column;
            align-items: stretch;
        }

        .color-search-container.gpc-controls-stacked .gpc-filter-dropdown {
            width: 100%;
            flex: 0 0 auto;
        }

        .color-search-container.gpc-controls-stacked .gpc-sort-wrap {
            width: 100%;
            min-width: 0;
        }

        @media (max-width: 520px) {
            .gpc-search-controls-row { flex-direction: column; align-items: stretch; }
            .gpc-filter-dropdown { flex: 1 1 100%; width: 100%; }
            .gpc-sort-wrap { min-width: 100%; }
        }
    `;
    document.head.appendChild(style);

    (function installOwnedColorsBridge() {
        const script = document.createElement('script');
        script.textContent = `(function(){
if(window.__gpcOwnedGhostColorsBridge)return;
window.__gpcOwnedGhostColorsBridge=true;
Object.defineProperty(window,'__gpcOwnedGhostColors',{configurable:true,get:function(){
    try{
        if(typeof Colors==='undefined'||!Array.isArray(Colors))return[];
        return Colors.slice(0,Math.max(0,Colors.length-1));
    }catch(e){return[];}
}});
})();`;
        document.head.appendChild(script);
        script.remove();
    })();

    function normalizeGhostHex(value) {
        const match = String(value || '').trim().match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/);
        if (!match) return null;
        let hex = match[1];
        if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
        if (hex.length === 8) hex = hex.slice(0, 6);
        return '#' + hex.toUpperCase();
    }

    function rgbaStringToHex(value) {
        const nums = String(value || '').match(/[\d.]+/g);
        if (!nums || nums.length < 3) return null;
        return '#' + nums.slice(0, 3).map(n => {
            const channel = Math.max(0, Math.min(255, parseInt(n, 10) || 0));
            return channel.toString(16).toUpperCase().padStart(2, '0');
        }).join('');
    }

    function getGhostButtonHex(btn) {
        const firstTitleLine = (btn.getAttribute('title') || '').split(/[\r\n]+/)[0];
        return normalizeGhostHex(firstTitleLine) || rgbaStringToHex(btn.dataset.colorRgba || btn.style.backgroundColor);
    }

    function getOwnedGhostHexSet() {
        const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        const colors = Array.isArray(pageWindow.__gpcOwnedGhostColors) ? pageWindow.__gpcOwnedGhostColors : [];
        const set = new Set();
        colors.forEach(color => {
            const hex = normalizeGhostHex(color);
            if (hex) set.add(hex);
        });
        return set;
    }

    // Main functionality
    waitForElement('#ghostColorPalette', (paletteDiv) => {
        // Create search container
        const searchContainer = document.createElement('div');
        searchContainer.className = 'color-search-container';

        // Create compact textarea search input
        const textarea = document.createElement('textarea');
        textarea.rows = 1;
        textarea.className = 'color-search-input';
        textarea.placeholder = 'Search color(s) (comma, space, or newline separated)';
        const resizeSearchBox = () => {
            textarea.style.height = '34px';
            textarea.style.height = Math.min(Math.max(34, textarea.scrollHeight), 110) + 'px';
        };

        // Keep the old variable name for the logic below.
        const searchInput = textarea;

        // ── "Show search results first" checkbox ──────────────────────
        const showResultsRow = document.createElement('div');
        showResultsRow.className = 'gpc-search-toggle-row';

        const showResultsCheckbox = document.createElement('input');
        showResultsCheckbox.type = 'checkbox';
        showResultsCheckbox.id = 'gpc-showResultsFirst';

        const showResultsLabel = document.createElement('label');
        showResultsLabel.htmlFor = 'gpc-showResultsFirst';
        showResultsLabel.textContent = 'Show search results first';

        showResultsRow.appendChild(showResultsCheckbox);
        showResultsRow.appendChild(showResultsLabel);

        // ── Compact filters dropdown with checkboxes ──────────────────
        const controlsRow = document.createElement('div');
        controlsRow.className = 'gpc-search-controls-row';

        const filtersDropdown = document.createElement('div');
        filtersDropdown.className = 'gpc-filter-dropdown';

        const filtersButton = document.createElement('button');
        filtersButton.type = 'button';
        filtersButton.className = 'gpc-filter-button';

        const filtersButtonText = document.createElement('span');
        filtersButtonText.textContent = 'Filters';

        const filtersArrow = document.createElement('span');
        filtersArrow.textContent = '▾';
        filtersArrow.style.cssText = 'font-size:10px;opacity:0.7;';

        filtersButton.appendChild(filtersButtonText);
        filtersButton.appendChild(filtersArrow);

        const filtersMenu = document.createElement('div');
        filtersMenu.className = 'gpc-filter-menu';

        const selectedFilters = new Set();
        const filterInputs = [];
        let countMinInput = null, countMaxInput = null;
        const progressFilterValues = new Set(['hideCompleted', 'hideInProgress', 'hideUnstarted']);
        const progressSortValues = new Set(['mostRemaining', 'leastRemaining', 'mostPct', 'leastPct']);

        [
            { value: 'hideUnmatched',  text: 'Hide unmatched colors' },
            { value: 'hideCompleted',  text: 'Hide completed colors' },
            { value: 'hideInProgress', text: 'Hide in-progress colors' },
            { value: 'hideUnstarted',  text: 'Hide unstarted colors' },
            { value: 'ownedOnly',      text: 'Owned colors only' },
            { value: 'countRange',     text: 'Filter within pixel count…' },
        ].forEach(({ value, text }) => {
            const label = document.createElement('label');
            label.className = 'gpc-filter-option';
            label.dataset.filterValue = value;
            if (progressFilterValues.has(value)) label.dataset.requiresProgress = 'true';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = value;
            input.addEventListener('change', () => {
                if (input.checked) selectedFilters.add(value);
                else selectedFilters.delete(value);
                updateFilterButtonText();
                performSearch();
            });
            filterInputs.push(input);

            const span = document.createElement('span');
            span.textContent = text;

            label.appendChild(input);
            label.appendChild(span);
            filtersMenu.appendChild(label);
        });

        // Pixel-count range sub-row — revealed by the 'countRange' checkbox above.
        const countSubRow = document.createElement('div');
        countSubRow.className = 'gpc-filter-count';
        countSubRow.style.display = 'none';
        countMinInput = document.createElement('input');
        countMinInput.type = 'number'; countMinInput.min = '0'; countMinInput.placeholder = 'min';
        countMinInput.className = 'gpc-count-input';
        countMaxInput = document.createElement('input');
        countMaxInput.type = 'number'; countMaxInput.min = '0'; countMaxInput.placeholder = 'max';
        countMaxInput.className = 'gpc-count-input';
        const countDash = document.createElement('span');
        countDash.textContent = '–'; countDash.style.opacity = '0.6';
        [countMinInput, countMaxInput].forEach(inp => inp.addEventListener('input', () => performSearch()));
        countSubRow.appendChild(countMinInput);
        countSubRow.appendChild(countDash);
        countSubRow.appendChild(countMaxInput);
        filtersMenu.appendChild(countSubRow);

        // Show/hide the sub-row when the 'countRange' checkbox changes
        const _countRangeCb = filterInputs.find(i => i.value === 'countRange');
        if (_countRangeCb) {
            _countRangeCb.addEventListener('change', () => {
                countSubRow.style.display = _countRangeCb.checked ? '' : 'none';
                if (!_countRangeCb.checked) {
                    if (countMinInput) countMinInput.value = '';
                    if (countMaxInput) countMaxInput.value = '';
                }
            });
        }

        function updateFilterButtonText() {
            const n = selectedFilters.size;
            filtersButtonText.textContent = n ? `Filters (${n})` : 'Filters';
        }

        filtersButton.addEventListener('click', e => {
            e.stopPropagation();
            filtersMenu.classList.toggle('gpc-open');
        });
        filtersMenu.addEventListener('click', e => e.stopPropagation());
        document.addEventListener('click', () => filtersMenu.classList.remove('gpc-open'));

        filtersDropdown.appendChild(filtersButton);
        filtersDropdown.appendChild(filtersMenu);

        // ── Sort by dropdown ──────────────────────────────────────────
        const sortWrap = document.createElement('div');
        sortWrap.className = 'gpc-sort-wrap';

        const sortSelect = document.createElement('select');
        sortSelect.className = 'gpc-sort-select';
        sortSelect.title = 'Scroll while hovering to change sort order';

        [
            { value: 'default',        text: 'Sort by: Most used (default)' },
            { value: 'leastUsed',      text: 'Sort by: Least used' },
            { value: 'mostRemaining',  text: 'Sort by: Most remaining' },
            { value: 'leastRemaining', text: 'Sort by: Least remaining' },
            { value: 'mostPct',        text: 'Sort by: Most % remaining' },
            { value: 'leastPct',       text: 'Sort by: Least % remaining' },
            { value: 'byColor',        text: 'Sort by: Color' },
            { value: 'byColorRev',     text: 'Sort by: Color reversed' },
        ].forEach(({ value, text }) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            if (progressSortValues.has(value)) opt.dataset.requiresProgress = 'true';
            sortSelect.appendChild(opt);
        });

        sortWrap.appendChild(sortSelect);
        controlsRow.appendChild(filtersDropdown);
        controlsRow.appendChild(sortWrap);

        function styleFilteredActionButton(btn) {
            Object.assign(btn.style, {
                padding: '3px 10px',
                background: 'var(--color-blue-500, #3b82f6)', color: 'var(--color-white, #fff)', border: 'none',
                borderRadius: '5px', cursor: 'pointer', fontSize: '12px',
                fontWeight: '700', whiteSpace: 'nowrap',
            });
            btn.onmouseenter = () => btn.style.opacity = '0.82';
            btn.onmouseleave = () => btn.style.opacity = '1';
        }

        // ── Ghost palette enable action buttons ────────────────────────
        const enableFilteredBtn = document.createElement('button');
        enableFilteredBtn.textContent = 'Enable filtered';
        enableFilteredBtn.title = 'Enable colors currently shown in the ghost palette and disable hidden colors';
        styleFilteredActionButton(enableFilteredBtn);
        enableFilteredBtn.onclick = () => applyEnabledFilteredColors();

        const enableOwnedFilteredBtn = document.createElement('button');
        enableOwnedFilteredBtn.textContent = 'Enable owned and filtered';
        enableOwnedFilteredBtn.title = 'Enable only owned ghost colors currently shown by the active filters';
        styleFilteredActionButton(enableOwnedFilteredBtn);
        enableOwnedFilteredBtn.onclick = () => applyEnabledOwnedFilteredColors();

        // Row for ghost enable actions — sits above the search box, near the other enable/disable buttons
        const filteredRow = document.createElement('div');
        filteredRow.className = 'gpc-filtered-row';
        filteredRow.style.cssText = 'display:flex;justify-content:flex-start;gap:6px;flex-wrap:wrap;padding:0 0 6px 0;';
        filteredRow.appendChild(enableFilteredBtn);
        filteredRow.appendChild(enableOwnedFilteredBtn);

        // Assemble search container
        searchContainer.appendChild(searchInput);
        searchContainer.appendChild(showResultsRow);
        searchContainer.appendChild(controlsRow);

        // Insert before the palette: filteredRow first, then searchContainer, then paletteDiv
        paletteDiv.parentNode.insertBefore(searchContainer, paletteDiv);
        paletteDiv.parentNode.insertBefore(filteredRow, searchContainer);

        // Stack Filters and Sort by when the left modal panel gets narrow, regardless of viewport width.
        const syncControlsStack = () => {
            const width = searchContainer.getBoundingClientRect().width;
            if (width > 0) searchContainer.classList.toggle('gpc-controls-stacked', width < 420);
        };
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(syncControlsStack).observe(searchContainer);
        } else {
            window.addEventListener('resize', syncControlsStack);
        }
        setTimeout(syncControlsStack, 0);

        // ── Helper: parse pixel stats from a swatch's title ──────────
        // Title format (set by geopixels++ updateGhostPaletteProgress):
        //   #HEX\nX / Y pixels\nZ%
        function parseStats(btn) {
            const title = btn.getAttribute('title') || '';
            const lines = title.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
            const hex = lines[0] || '';
            let completed = 0, total = 0, percent = 0;
            const pixelMatch = (lines[1] || '').match(/^([\d,]+)\s*\/\s*([\d,]+)/);
            if (pixelMatch) {
                completed = parseInt(pixelMatch[1].replace(/,/g, ''), 10);
                total     = parseInt(pixelMatch[2].replace(/,/g, ''), 10);
            } else {
                const countMatch = (lines[1] || '').match(/([\d,]+)\s*pixel/i);
                if (countMatch) total = parseInt(countMatch[1].replace(/,/g, ''), 10);
            }
            const pctMatch = (lines[2] || '').match(/([\d.]+)%/);
            if (pctMatch) percent = parseFloat(pctMatch[1]);
            const remaining = Math.max(0, total - completed);
            const remainingPercent = total > 0 ? (remaining / total) * 100 : 0;
            return { hex, completed, total, remaining, percent, remainingPercent, hasProgress: !!pixelMatch };
        }

        function hasProgressStats() {
            return Array.from(paletteDiv.querySelectorAll('[title^="#"]')).some(btn => parseStats(btn).hasProgress);
        }

        function syncProgressDependentControls() {
            const hasProgress = hasProgressStats();
            filterInputs.forEach(input => {
                const requiresProgress = progressFilterValues.has(input.value);
                const label = input.closest('.gpc-filter-option');
                if (!label || !requiresProgress) return;
                label.style.display = hasProgress ? '' : 'none';
                input.disabled = !hasProgress;
                if (!hasProgress && input.checked) {
                    input.checked = false;
                    selectedFilters.delete(input.value);
                }
            });
            Array.from(sortSelect.options).forEach(opt => {
                const requiresProgress = progressSortValues.has(opt.value);
                opt.hidden = requiresProgress && !hasProgress;
                opt.disabled = requiresProgress && !hasProgress;
            });
            if (!hasProgress && progressSortValues.has(sortSelect.value)) sortSelect.value = 'default';
            updateFilterButtonText();
            return hasProgress;
        }

        // Capture the geopixels-native order as a tie-breaker for stable sorts.
        let originalOrder = null;
        let originalIndex = new Map();
        let _palObs = null;

        function captureOriginalOrder() {
            originalOrder = Array.from(paletteDiv.querySelectorAll('[title^="#"]'));
            originalIndex = new Map(originalOrder.map((btn, idx) => [btn, idx]));
        }

        // ── Sort + reorder DOM ────────────────────────────────────────
        function applySort(matchingButtons) {
            const sortValue   = sortSelect.value;
            const showFirst   = showResultsCheckbox.checked;
            const hasSearch   = matchingButtons.size > 0;

            // Base list: use captured original order when available
            const base = originalOrder && originalOrder.length > 0 && originalOrder.every(b => paletteDiv.contains(b))
                ? originalOrder
                : Array.from(paletteDiv.querySelectorAll('[title^="#"]'));

            const tie = (a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
            const cmp = (a, b) => {
                const sa = parseStats(a), sb = parseStats(b);
                switch (sortValue) {
                    case 'default':        return (sb.total - sa.total) || tie(a, b);
                    case 'leastUsed':      return (sa.total - sb.total) || tie(a, b);
                    case 'mostRemaining':  return (sb.remaining - sa.remaining) || tie(a, b);
                    case 'leastRemaining': return (sa.remaining - sb.remaining) || tie(a, b);
                    case 'mostPct':        return (sb.remainingPercent - sa.remainingPercent) || tie(a, b);
                    case 'leastPct':       return (sa.remainingPercent - sb.remainingPercent) || tie(a, b);
                    case 'byColor':        return (sa.hex < sb.hex ? -1 : sa.hex > sb.hex ? 1 : 0) || tie(a, b);
                    case 'byColorRev':     return (sa.hex > sb.hex ? -1 : sa.hex < sb.hex ? 1 : 0) || tie(a, b);
                    default:               return tie(a, b);
                }
            };
            let sorted = [...base].sort(cmp);

            if (showFirst && hasSearch) {
                const matched   = sorted.filter(b => matchingButtons.has(b));
                const unmatched = sorted.filter(b => !matchingButtons.has(b));
                sorted = [...matched, ...unmatched];
            }

            // Disconnect observer while reordering to avoid re-entrant calls
            if (_palObs) _palObs.disconnect();
            const frag = document.createDocumentFragment();
            sorted.forEach(b => frag.appendChild(b));
            paletteDiv.appendChild(frag);
            if (_palObs) _palObs.observe(paletteDiv, { childList: true, subtree: true });
        }

        // ── Search, filter, and sort ──────────────────────────────────
        function performSearch() {
            syncProgressDependentControls();
            const searchValue    = searchInput.value.trim();
            const hideUnmatched     = selectedFilters.has('hideUnmatched');
            const hideCompleted     = selectedFilters.has('hideCompleted');
            const hideInProgress    = selectedFilters.has('hideInProgress');
            const hideUnstarted     = selectedFilters.has('hideUnstarted');
            const hideUnowned       = selectedFilters.has('ownedOnly');
            const countRangeEnabled = selectedFilters.has('countRange');
            const minCount = (countRangeEnabled && countMinInput && countMinInput.value !== '') ? parseInt(countMinInput.value, 10) : NaN;
            const maxCount = (countRangeEnabled && countMaxInput && countMaxInput.value !== '') ? parseInt(countMaxInput.value, 10) : NaN;
            const hasMinCount = !isNaN(minCount);
            const hasMaxCount = !isNaN(maxCount);
            const ownedSet = hideUnowned ? getOwnedGhostHexSet() : null;

            const allBtns = Array.from(paletteDiv.querySelectorAll('[title^="#"]'));

            // Clear previous glow + hidden state
            allBtns.forEach(btn => btn.classList.remove('color-search-glow', 'hidden'));

            // Build search terms
            const searchTerms = searchValue.split(/[\s,]+/)
                .map(t => t.trim().toUpperCase())
                .filter(t => t.length > 0);

            // Apply glow to matches
            const matchingButtons = new Set();
            if (searchTerms.length > 0) {
                allBtns.forEach(btn => {
                    const titleUp = (btn.getAttribute('title') || '').toUpperCase();
                    if (searchTerms.some(t => titleUp.includes(t))) {
                        btn.classList.add('color-search-glow');
                        matchingButtons.add(btn);
                    }
                });
            }

            // Apply hide filters
            allBtns.forEach(btn => {
                const s = parseStats(btn);
                const hasData      = s.total > 0;
                const isUnmatched  = searchTerms.length > 0 && !matchingButtons.has(btn);
                const isCompleted  = hasData && s.completed >= s.total;
                const isInProgress = hasData && s.completed > 0 && s.completed < s.total;
                const isUnstarted  = hasData && s.completed === 0;
                const isUnowned    = hideUnowned && ownedSet && !ownedSet.has(getGhostButtonHex(btn));
                const outOfRange   = (hasMinCount || hasMaxCount) && ((hasMinCount && s.total < minCount) || (hasMaxCount && s.total > maxCount));

                if ((hideUnmatched  && isUnmatched)  ||
                    (hideCompleted  && isCompleted)  ||
                    (hideInProgress && isInProgress) ||
                    (hideUnstarted  && isUnstarted)  ||
                    isUnowned                        ||
                    outOfRange) {
                    btn.classList.add('hidden');
                }
            });

            // Apply sort / show-results-first reordering
            applySort(matchingButtons);
        }

        function commitGhostPaletteChanges(toEnable, toDisable) {
            if (!toEnable.length && !toDisable.length) return;

            const script = document.createElement('script');
            script.textContent = `(function(en,dis){` +
                `en.forEach(r=>ghostActivePaletteColors.add(r));` +
                `dis.forEach(r=>ghostActivePaletteColors.delete(r));` +
                `if(typeof updateColorPaletteUI==='function')updateColorPaletteUI();` +
                `if(typeof regenerateGhostCanvas==='function')regenerateGhostCanvas();` +
                `})(${JSON.stringify(toEnable)},${JSON.stringify(toDisable)});`;
            document.head.appendChild(script);
            script.remove();
        }

        function disableShowAllGhostFilter() {
            const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            const showAllToggle = document.getElementById('disableColorFilterToggle');
            if (showAllToggle && showAllToggle.checked) {
                showAllToggle.checked = false;
                if (typeof pageWindow.handleColorFilterToggle === 'function') pageWindow.handleColorFilterToggle();
            }
        }

        // ── Enable filtered: enable visible colors, disable hidden ones ──
        function applyEnabledFilteredColors() {
            performSearch();
            const colorButtons = paletteDiv.querySelectorAll('button[data-color-rgba]');
            if (!colorButtons.length) {
                (typeof showAlert === 'function' ? showAlert : alert)('No ghost palette colors found', 'Make sure a ghost image is loaded.');
                return;
            }

            disableShowAllGhostFilter();

            const toEnable = [], toDisable = [];
            let visibleCount = 0;
            colorButtons.forEach(btn => {
                const rgba = btn.dataset.colorRgba;
                if (!rgba) return;
                const shouldBeEnabled = !btn.classList.contains('hidden');
                if (shouldBeEnabled) visibleCount++;
                const isEnabled = btn.classList.contains('border-blue-500');
                if (shouldBeEnabled && !isEnabled) toEnable.push(rgba);
                else if (!shouldBeEnabled && isEnabled) toDisable.push(rgba);
            });

            if (visibleCount === 0) {
                (typeof showAlert === 'function' ? showAlert : alert)('Enable Filtered', 'No visible ghost palette colors are currently shown.');
                return;
            }

            if (!toEnable.length && !toDisable.length) return;

            commitGhostPaletteChanges(toEnable, toDisable);
        }

        // ── Enable owned and filtered: enable visible owned colors only ──
        function applyEnabledOwnedFilteredColors() {
            performSearch();
            const colorButtons = paletteDiv.querySelectorAll('button[data-color-rgba]');
            if (!colorButtons.length) {
                (typeof showAlert === 'function' ? showAlert : alert)('No ghost palette colors found', 'Make sure a ghost image is loaded.');
                return;
            }

            const ownedSet = getOwnedGhostHexSet();
            if (!ownedSet.size) {
                (typeof showAlert === 'function' ? showAlert : alert)('Enable Owned and Filtered', 'No owned colors were detected yet. Refresh your palette or reload GeoPixels, then try again.');
                return;
            }

            disableShowAllGhostFilter();

            const toEnable = [], toDisable = [];
            let visibleCount = 0;
            colorButtons.forEach(btn => {
                const rgba = btn.dataset.colorRgba;
                if (!rgba) return;
                const isVisible = !btn.classList.contains('hidden');
                if (isVisible) visibleCount++;
                const shouldBeEnabled = isVisible && ownedSet.has(getGhostButtonHex(btn));
                const isEnabled = btn.classList.contains('border-blue-500');
                if (shouldBeEnabled && !isEnabled) toEnable.push(rgba);
                else if (!shouldBeEnabled && isEnabled) toDisable.push(rgba);
            });

            if (visibleCount === 0) {
                (typeof showAlert === 'function' ? showAlert : alert)('Enable Owned and Filtered', 'No visible ghost palette colors are currently shown.');
                return;
            }

            commitGhostPaletteChanges(toEnable, toDisable);
        }

        // Add event listeners
        searchInput.addEventListener('input', () => { resizeSearchBox(); performSearch(); });
        sortSelect.addEventListener('change', performSearch);
        sortSelect.addEventListener('wheel', e => {
            e.preventDefault();
            const dir = e.deltaY > 0 ? 1 : -1;
            let next = sortSelect.selectedIndex + dir;
            while (next >= 0 && next < sortSelect.options.length && sortSelect.options[next].disabled) next += dir;
            next = Math.min(Math.max(next, 0), sortSelect.options.length - 1);
            if (next !== sortSelect.selectedIndex) {
                sortSelect.selectedIndex = next;
                performSearch();
            }
        }, { passive: false });
        showResultsCheckbox.addEventListener('change', performSearch);

        // Track the number of color buttons to detect palette resets (new image loaded)
        let previousButtonCount = 0;

        // Watch for dynamically added/removed buttons
        _palObs = new MutationObserver(() => {
            const currentButtonCount = paletteDiv.querySelectorAll('[title^="#"]').length;

            // Significant count change → new image loaded; reset all controls and recapture order
            if (previousButtonCount > 0 && Math.abs(currentButtonCount - previousButtonCount) > 5) {
                searchInput.value = '';
                filterInputs.forEach(input => { input.checked = false; });
                selectedFilters.clear();
                if (countSubRow) countSubRow.style.display = 'none';
                if (countMinInput) countMinInput.value = '';
                if (countMaxInput) countMaxInput.value = '';
                updateFilterButtonText();
                resizeSearchBox();
                sortSelect.value = 'default';
                showResultsCheckbox.checked = false;
                captureOriginalOrder();
            }

            previousButtonCount = currentButtonCount;
            performSearch();
        });

        _palObs.observe(paletteDiv, { childList: true, subtree: true });

        // Initialize original order and button count on first load
        captureOriginalOrder();
        previousButtonCount = paletteDiv.querySelectorAll('[title^="#"]').length;
        syncProgressDependentControls();
        resizeSearchBox();
    });
            })();
            _featureStatus.ghostPaletteSearch = 'ok';
            console.log('[GeoPixelcons++] ✅ Ghost Palette Color Search loaded');
        } catch (err) {
            _featureStatus.ghostPaletteSearch = 'error';
            dbgPush(`Ghost Palette Color Search init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Ghost Palette Color Search' });
            console.error('[GeoPixelcons++] ❌ Ghost Palette Color Search failed:', err);
        }
    }