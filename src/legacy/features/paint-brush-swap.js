
    // ============================================================
    //  FEATURE: Paint Brush Swap [paintBrushSwap]
    // ============================================================
    if (_settings.paintBrushSwap) {
        try {
            (function _init_paintBrushSwap() {

    // Page window reference — needed because GPC++ uses @grant which sandboxes `window`
    const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // Helper to set page-scope `let` variables (not accessible via window/unsafeWindow)
    // Injects a <script> tag so the assignment runs in the page's own global scope
    function _setPageVar(name, value) {
        try {
            const s = document.createElement('script');
            s.textContent = `${name} = ${JSON.stringify(value)};`;
            (document.head || document.documentElement).appendChild(s);
            s.remove();
        } catch {}
    }
    function _runInPage(code) {
        try {
            const s = document.createElement('script');
            s.textContent = code;
            (document.head || document.documentElement).appendChild(s);
            s.remove();
        } catch {}
    }

    // ============================================
    // DEBUG MODE
    // ============================================
    const DEBUG = false; // Set to true for console logging

    // ============================================
    // STATE MANAGEMENT
    // ============================================
    const STORAGE_KEY = 'brushPresets';
    const RESIZE_STORAGE_KEY = 'brushSwapDropdownSize';
    const MAX_BRUSHES = 100;

    const scriptState = {
        brushes: [],
        nextId: 1,
        dropdownOpen: false,
        isRenaming: null, // Track which brush ID is being renamed
        scrollIndex: -1,  // Track current scroll-swap index (-1 = no selection)
        activeBrushId: null, // Track which brush is currently loaded
        dragState: null   // Track drag-to-reorder state
    };

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    function loadBrushes() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                scriptState.brushes = JSON.parse(saved);
                scriptState.nextId = Math.max(...scriptState.brushes.map(b => b.id), 0) + 1;
            } catch (e) {
                console.error('Failed to parse brush presets:', e);
                scriptState.brushes = [];
                scriptState.nextId = 1;
            }
        }
    }

    function saveBrushes() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scriptState.brushes));
    }

    function addBrush(pattern, brushSize) {
        if (scriptState.brushes.length >= MAX_BRUSHES) {
            // Delete oldest brush (first in array)
            scriptState.brushes.shift();
        }

        const newBrush = {
            id: scriptState.nextId++,
            name: `Brush ${scriptState.nextId}`,
            pattern: pattern,
            brushSize: brushSize
        };

        scriptState.brushes.push(newBrush);
        saveBrushes();
        return newBrush;
    }

    function deleteBrush(id) {
        scriptState.brushes = scriptState.brushes.filter(b => b.id !== id);
        saveBrushes();
        renderDropdown();
    }

    function renameBrush(id, newName) {
        const brush = scriptState.brushes.find(b => b.id === id);
        if (brush) {
            brush.name = newName.trim() || `Brush ${id}`;
            saveBrushes();
            renderDropdown();
        }
    }

    // ============================================
    // BRUSH CAPTURE FROM DOM
    // ============================================

    function captureBrushFromDOM() {
        const brushGrid = document.getElementById('brushGrid');
        if (!brushGrid) {
            console.warn('Brush Swap: brushGrid not found');
            return null;
        }

        const cells = brushGrid.querySelectorAll('div[data-x][data-y]');
        const pattern = [];
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let centerX = -1, centerY = -1;

        // Collect all active cells and find bounds, also locate center marker
        cells.forEach(cell => {
            if (cell.dataset.active === 'true') {
                const x = parseInt(cell.dataset.x);
                const y = parseInt(cell.dataset.y);
                pattern.push({ gridX: x, gridY: y });
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                
                // Find center marker
                if (cell.dataset.isCenter === 'true' || cell.dataset.isCenter === 'true') {
                    centerX = x;
                    centerY = y;
                }
            }
        });

        if (pattern.length === 0) {
            console.warn('Brush Swap: No active cells in brush');
            return null;
        }

        // Calculate brush size from grid bounds
        const brushSize = Math.max(maxX - minX + 1, maxY - minY + 1);
        
        // If center wasn't found (shouldn't happen), use grid center
        if (centerX === -1 || centerY === -1) {
            centerX = Math.floor(brushSize / 2);
            centerY = Math.floor(brushSize / 2);
        }

        // Convert grid coordinates to relative coordinates, centered on the actual center pixel
        const relativePattern = pattern.map(p => ({
            x: p.gridX - centerX,
            y: (p.gridY - centerY) * -1 // Invert Y for consistency
        }));

        if (DEBUG) console.log('Brush Swap: Captured brush from DOM', {
            brushSize,
            centerX,
            centerY,
            pattern: relativePattern,
            cellCount: pattern.length
        });

        return {
            pattern: relativePattern,
            brushSize: brushSize
        };
    }

    function loadBrush(id) {
        const brush = scriptState.brushes.find(b => b.id === id);
        if (!brush) return;

        applyBrushToEditor(brush);
        scriptState.activeBrushId = id;
        toggleDropdown();
    }

    function applyBrushToEditor(brush) {
        // Track which brush is active
        scriptState.activeBrushId = brush.id;
        // Set page globals — BrushSize is `let`-declared so _pw.BrushSize won't reach it
        _setPageVar('BrushSize', brush.brushSize);
        _setPageVar('currentBrushPattern', [...brush.pattern]);
        // Also mirror on _pw for any code that reads from window
        _pw.BrushSize = brush.brushSize;
        _pw.currentBrushPattern = [...brush.pattern];

        if (DEBUG) console.log('Brush Swap: Set globals', {
            BrushSize: _pw.BrushSize,
            currentBrushPattern: _pw.currentBrushPattern
        });

        // Update userConfig
        if (_pw.userConfig) {
            _pw.userConfig = {
                ..._pw.userConfig,
                currentBrushPattern: _pw.currentBrushPattern,
                brushSize: _pw.BrushSize
            };
            localStorage.setItem('userConfig', JSON.stringify(_pw.userConfig));
            if (DEBUG) console.log('Brush Swap: Updated userConfig');
        }

        // Call server save if available
        _pw.saveConfigServer?.();

        // Regenerate the brush grid to reflect the new pattern/size
        _runInPage('generateBrushGrid(currentBrushPattern)');

        if (DEBUG) console.log('Brush Swap: Applied brush to editor', brush);
    }

    // ============================================
    // BRUSH DIMENSION CONTROL
    // ============================================

    function addBrushDimensionDropdown() {
        const brushEditorPanel = document.getElementById('brushEditorPanel');
        if (!brushEditorPanel) return;

        // Check if dropdown already exists
        if (document.getElementById('brush-swap-dimension-select')) return;

        // Find the header area to insert dropdown
        const header = brushEditorPanel.querySelector('h2');
        if (!header) return;

        // Create dropdown container with Tailwind classes
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'flex gap-2 items-center mb-3 px-1.5 dark:text-gray-300';

        // Create label
        const label = document.createElement('label');
        label.textContent = 'Grid Size:';
        label.className = 'text-xs font-semibold text-gray-700 dark:text-gray-300';

        // Create select
        const select = document.createElement('select');
        select.id = 'brush-swap-dimension-select';
        select.className = 'px-2 py-1 text-xs border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 cursor-pointer';

        const options = [
            { value: 1, label: '1×1' },
            { value: 3, label: '3×3' },
            { value: 5, label: '5×5' },
            { value: 7, label: '7×7' },
            { value: 9, label: '9×9' },
            { value: 11, label: '11×11' },
            { value: 13, label: '13×13' },
            { value: 15, label: '15×15' },
            { value: 17, label: '17×17' },
            { value: 19, label: '19×19' },
            { value: 21, label: '21×21' }
        ];

        // Ensure current BrushSize is in the list
        const curSize = _pw.BrushSize || 5;
        if (!options.some(o => o.value === curSize)) {
            options.push({ value: curSize, label: curSize + '×' + curSize });
            options.sort((a, b) => a.value - b.value);
        }

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            select.appendChild(option);
        });

        // Set current BrushSize as selected
        select.value = _pw.BrushSize || 5;

        // Handle change
        select.addEventListener('change', (e) => {
            const newSize = parseInt(e.target.value);
            _setPageVar('BrushSize', newSize);
            _pw.BrushSize = newSize;
            if (DEBUG) console.log(`Brush Swap: Changed grid size to ${newSize}x${newSize}`);

            // Regenerate grid with new size
            _runInPage('generateBrushGrid(currentBrushPattern)');
        });

        dropdownContainer.appendChild(label);
        dropdownContainer.appendChild(select);

        // Insert after the header
        header.parentNode.insertBefore(dropdownContainer, header.nextSibling);
    }

    // ============================================
    // BRUSH EDITOR ENHANCEMENTS (fill + drag-paint)
    // ============================================

    function _installBrushEditorEnhancements() {
        const panel = document.getElementById('brushEditorPanel');
        if (!panel) return;

        // ── Fill + Reset button row ──────────────────────────
        if (!panel.querySelector('#gpc-brush-fill-btn')) {
            const resetBtn = panel.querySelector('button[onclick="resetBrush()"]');
            if (resetBtn) {
                const container = resetBtn.parentElement;

                // Halve reset button width to make room for fill
                resetBtn.classList.remove('w-full');
                resetBtn.style.width = '50%';

                // Create fill button
                const fillBtn = document.createElement('button');
                fillBtn.id = 'gpc-brush-fill-btn';
                fillBtn.style.width = '50%';
                fillBtn.className = 'py-2 text-sm text-gray-500 hover:text-green-600 hover:bg-gray-50 rounded transition cursor-pointer text-center';
                fillBtn.textContent = 'Fill All';
                fillBtn.title = 'Set all cells to active';
                fillBtn.onclick = () => {
                    const grid = document.getElementById('brushGrid');
                    if (!grid) return;
                    grid.querySelectorAll('[data-x][data-y]').forEach(cell => {
                        cell.dataset.active = 'true';
                        cell.classList.add('!bg-gray-800');
                        cell.classList.remove('bg-white', 'hover:bg-gray-100', 'bg-red-100', 'hover:bg-red-200');
                    });
                };

                container.style.display = 'flex';
                container.style.gap = '8px';
                container.appendChild(fillBtn);
            }
        }

        // ── Drag-to-paint / drag-to-erase on brushGrid ───────
        _installBrushGridDrag();
    }

    function _installBrushGridDrag() {
        const grid = document.getElementById('brushGrid');
        if (!grid || grid._gpcDragInstalled) return;
        grid._gpcDragInstalled = true;

        function setCellActive(cell, active) {
            if (!cell || !cell.dataset || !('x' in cell.dataset)) return;
            const isCenter = cell.dataset.isCenter === 'true';
            cell.dataset.active = active ? 'true' : 'false';
            if (active) {
                cell.classList.add('!bg-gray-800');
                cell.classList.remove('bg-white', 'hover:bg-gray-100', 'bg-red-100', 'hover:bg-red-200');
            } else {
                cell.classList.remove('!bg-gray-800');
                if (isCenter) {
                    cell.classList.add('bg-red-100', 'hover:bg-red-200');
                } else {
                    cell.classList.add('bg-white', 'hover:bg-gray-100');
                }
            }
        }

        // Remove game's onclick handlers (we fully own click/drag behavior)
        function removeOnclikHandlers() {
            grid.querySelectorAll('[data-x][data-y]').forEach(cell => { cell.onclick = null; });
        }
        removeOnclikHandlers();

        // Re-remove onclick whenever generateBrushGrid rebuilds the cells
        const gridObserver = new MutationObserver(removeOnclikHandlers);
        gridObserver.observe(grid, { childList: true });

        let isDragging = false;
        let dragMode = null;    // 'paint' | 'erase'

        grid.addEventListener('mousedown', (e) => {
            const cell = e.target.closest('[data-x][data-y]');
            if (!cell) return;
            e.preventDefault(); // Prevent text selection
            if (e.button === 0) {
                dragMode = 'paint';
                isDragging = true;
                setCellActive(cell, true); // Immediately activate on mousedown
            } else if (e.button === 2) {
                dragMode = 'erase';
                isDragging = true;
                setCellActive(cell, false); // Right-click immediately erases
            }
        });

        grid.addEventListener('mousemove', (e) => {
            if (!isDragging || !dragMode) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const cell = el ? el.closest('[data-x][data-y]') : null;
            if (!cell) return;
            setCellActive(cell, dragMode === 'paint');
        });

        grid.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // Suppress right-click context menu on the grid
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            dragMode = null;
        });
    }

    // ============================================

    function createBrushPreview(brush) {
        const grid = document.createElement('div');
        grid.className = 'brush-swap-preview-grid';

        // Create a map of active cells based on pattern
        const activeCells = new Map();
        const centerOffset = Math.floor(brush.brushSize / 2);
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        brush.pattern.forEach(offset => {
            // Convert from relative coordinates to grid coordinates
            const gridX = offset.x + centerOffset;
            const gridY = (offset.y * -1) + centerOffset; // Denormalize Y-axis
            activeCells.set(`${gridX},${gridY}`, true);
            minX = Math.min(minX, gridX);
            maxX = Math.max(maxX, gridX);
            minY = Math.min(minY, gridY);
            maxY = Math.max(maxY, gridY);
        });

        // Calculate preview dimensions
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const maxDim = Math.max(width, height);

        // Scale cells to fit compact preview (8px max per cell)
        const cellSize = Math.max(4, Math.floor(32 / maxDim));

        // Calculate center of the pattern bounds (not the grid size)
        const patternCenterX = minX + Math.floor((maxX - minX) / 2);
        const patternCenterY = minY + Math.floor((maxY - minY) / 2);

        // Build preview with full pattern bounds
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const cell = document.createElement('div');
                cell.className = 'brush-swap-preview-cell';
                cell.style.width = cellSize + 'px';
                cell.style.height = cellSize + 'px';

                const isActive = activeCells.has(`${x},${y}`);
                const isCenter = x === patternCenterX && y === patternCenterY;

                if (isActive) {
                    cell.classList.add('active');
                    if (isCenter) {
                        cell.classList.add('center');
                    }
                }

                grid.appendChild(cell);
            }
        }

        // Set grid columns dynamically
        grid.style.gridTemplateColumns = `repeat(${width}, ${cellSize}px)`;

        return grid;
    }

    // ============================================
    // DRAG REORDER
    // ============================================

    function setupDragReorder(handle, itemEl, fromIdx, container) {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const items = Array.from(container.querySelectorAll('[data-brush-idx]'));
            const rects = items.map(el => el.getBoundingClientRect());
            let currentDropIdx = fromIdx;

            itemEl.classList.add('brush-swap-item-dragging');

            // Remove any existing indicator
            let indicator = container.querySelector('.brush-swap-drop-indicator');

            function onMove(ev) {
                const y = ev.clientY;

                // Find which slot we're hovering
                let dropIdx = items.length; // default to end
                for (let i = 0; i < rects.length; i++) {
                    const mid = rects[i].top + rects[i].height / 2;
                    if (y < mid) {
                        dropIdx = i;
                        break;
                    }
                }
                if (dropIdx === currentDropIdx) return;
                currentDropIdx = dropIdx;

                // Remove old indicator
                if (indicator) indicator.remove();

                // Insert indicator at the drop position
                indicator = document.createElement('div');
                indicator.className = 'brush-swap-drop-indicator';
                if (dropIdx < items.length) {
                    container.insertBefore(indicator, items[dropIdx]);
                } else {
                    container.appendChild(indicator);
                }
            }

            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                itemEl.classList.remove('brush-swap-item-dragging');
                if (indicator) indicator.remove();

                // Perform the reorder
                if (currentDropIdx !== fromIdx && currentDropIdx !== fromIdx + 1) {
                    const [moved] = scriptState.brushes.splice(fromIdx, 1);
                    const insertAt = currentDropIdx > fromIdx ? currentDropIdx - 1 : currentDropIdx;
                    scriptState.brushes.splice(insertAt, 0, moved);
                    saveBrushes();
                    // Update scrollIndex to follow the moved brush
                    const newIdx = scriptState.brushes.findIndex(b => b.id === moved.id);
                    if (scriptState.scrollIndex === fromIdx) scriptState.scrollIndex = newIdx;
                }
                renderDropdown();
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ============================================
    // UI RENDERING
    // ============================================

    // ============================================
    // BRUSH EXPORT / IMPORT
    // ============================================

    function showExportBrushesModal() {
        const existing = document.getElementById('gpc-brush-export-modal');
        if (existing) { existing.remove(); return; }

        const dark = document.body.classList.contains('dark') ||
                     window.matchMedia('(prefers-color-scheme: dark)').matches;

        const overlay = document.createElement('div');
        overlay.id = 'gpc-brush-export-modal';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 100000;
            background: rgba(0,0,0,0.5); display: flex;
            align-items: center; justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: ${dark ? '#1e1e2e' : '#ffffff'};
            color: ${dark ? '#cdd6f4' : '#1e293b'};
            border-radius: 12px; padding: 0; width: 480px; max-width: 95vw;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;
        `;

        // ── Header ──
        const headerTitle = document.createElement('span');
        headerTitle.style.cssText = 'font-weight:700;font-size:15px;';
        headerTitle.textContent = `\uD83D\uDCE4 Export Brushes`;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 14px 20px; display: flex; align-items: center;
            justify-content: space-between;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border-bottom: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
        `;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715';
        closeBtn.style.cssText = `background:none;border:none;font-size:18px;cursor:pointer;color:${dark ? '#a6adc8' : '#64748b'};padding:4px 8px;border-radius:4px;`;
        closeBtn.onmouseenter = () => closeBtn.style.background = dark ? '#45475a' : '#e2e8f0';
        closeBtn.onmouseleave = () => closeBtn.style.background = 'none';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(headerTitle);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        const body = document.createElement('div');
        body.style.cssText = 'padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;';

        const hint = document.createElement('div');
        hint.style.cssText = `font-size:13px;color:${dark ? '#a6adc8' : '#64748b'};`;
        hint.textContent = 'Select the brushes to export, then copy or download the JSON.';
        body.appendChild(hint);

        // ── Brush checklist ──
        const listWrap = document.createElement('div');
        listWrap.style.cssText = `
            display: flex; flex-direction: column; gap: 2px;
            max-height: 180px; overflow-y: auto;
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            border-radius: 8px; padding: 6px 8px;
            background: ${dark ? '#181825' : '#f8fafc'};
        `;

        // Select All / None row
        const selRow = document.createElement('div');
        selRow.style.cssText = 'display:flex;gap:10px;margin-bottom:4px;';
        const selAll = document.createElement('button');
        selAll.textContent = 'Select All';
        selAll.style.cssText = `background:none;border:none;cursor:pointer;font-size:11px;font-weight:600;padding:0;color:${dark ? '#89b4fa' : '#3b82f6'};`;
        const selNone = document.createElement('button');
        selNone.textContent = 'Select None';
        selNone.style.cssText = selAll.style.cssText;
        selRow.appendChild(selAll);
        selRow.appendChild(selNone);
        listWrap.appendChild(selRow);

        const checkboxes = [];
        scriptState.brushes.forEach((brush) => {
            const row = document.createElement('label');
            row.style.cssText = `display:flex;align-items:center;gap:8px;padding:3px 2px;cursor:pointer;border-radius:4px;font-size:13px;`;
            row.onmouseenter = () => row.style.background = dark ? '#313244' : '#f1f5f9';
            row.onmouseleave = () => row.style.background = 'none';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.style.cssText = 'flex-shrink:0;cursor:pointer;accent-color:#3b82f6;';
            cb.addEventListener('change', updateOutput);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = brush.name;
            nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

            row.appendChild(cb);
            row.appendChild(nameSpan);
            listWrap.appendChild(row);
            checkboxes.push({ cb, brush });
        });

        selAll.onclick  = () => { checkboxes.forEach(x => { x.cb.checked = true;  }); updateOutput(); };
        selNone.onclick = () => { checkboxes.forEach(x => { x.cb.checked = false; }); updateOutput(); };

        body.appendChild(listWrap);

        // ── JSON output ──
        const textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.style.cssText = `
            width: 100%; min-height: 120px; max-height: 200px; box-sizing: border-box;
            padding: 10px; font-family: monospace; font-size: 12px;
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            border-radius: 8px; resize: vertical; outline: none;
            background: ${dark ? '#181825' : '#f8fafc'};
            color: ${dark ? '#cdd6f4' : '#1e293b'};
        `;
        textarea.addEventListener('click', () => textarea.select());
        body.appendChild(textarea);

        function getSelected() {
            return checkboxes.filter(x => x.cb.checked).map(x => x.brush);
        }
        function buildJson(brushList) {
            return JSON.stringify(brushList.map(b => ({ name: b.name, pattern: b.pattern, brushSize: b.brushSize })), null, 2);
        }
        function updateOutput() {
            const sel = getSelected();
            headerTitle.textContent = `\uD83D\uDCE4 Export Brushes (${sel.length} of ${scriptState.brushes.length})`;
            textarea.value = sel.length ? buildJson(sel) : '';
        }
        updateOutput();

        // ── Buttons ──
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

        const copyBtn = document.createElement('button');
        copyBtn.style.cssText = `
            padding: 7px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600;
            background: ${dark ? '#585b70' : '#e2e8f0'}; color: ${dark ? '#cdd6f4' : '#1e293b'};
            transition: background 0.15s;
        `;
        copyBtn.textContent = '\uD83D\uDCCB Copy to Clipboard';
        copyBtn.onmouseenter = () => copyBtn.style.background = dark ? '#6c7086' : '#cbd5e1';
        copyBtn.onmouseleave = () => copyBtn.style.background = dark ? '#585b70' : '#e2e8f0';
        copyBtn.onclick = () => {
            const json = buildJson(getSelected());
            if (!json) return;
            navigator.clipboard.writeText(json).then(() => {
                copyBtn.textContent = '\u2705 Copied!';
                setTimeout(() => { copyBtn.textContent = '\uD83D\uDCCB Copy to Clipboard'; }, 1800);
            }).catch(() => {
                textarea.select();
                document.execCommand('copy');
                copyBtn.textContent = '\u2705 Copied!';
                setTimeout(() => { copyBtn.textContent = '\uD83D\uDCCB Copy to Clipboard'; }, 1800);
            });
        };

        const dlBtn = document.createElement('button');
        dlBtn.style.cssText = `
            padding: 7px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600;
            background: ${dark ? '#89b4fa' : '#3b82f6'}; color: ${dark ? '#1e1e2e' : '#ffffff'};
            transition: background 0.15s;
        `;
        dlBtn.textContent = '\uD83D\uDCBE Download';
        dlBtn.onmouseenter = () => dlBtn.style.background = dark ? '#74c7ec' : '#2563eb';
        dlBtn.onmouseleave = () => dlBtn.style.background = dark ? '#89b4fa' : '#3b82f6';
        dlBtn.onclick = () => {
            const json = buildJson(getSelected());
            if (!json) return;
            const blob = new Blob([json], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `gpc-brushes-${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
        };

        btnRow.appendChild(copyBtn);
        btnRow.appendChild(dlBtn);
        body.appendChild(btnRow);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    function showImportBrushesModal() {
        const existing = document.getElementById('gpc-brush-import-modal');
        if (existing) { existing.remove(); return; }

        const dark = document.body.classList.contains('dark') ||
                     window.matchMedia('(prefers-color-scheme: dark)').matches;

        const overlay = document.createElement('div');
        overlay.id = 'gpc-brush-import-modal';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 100000;
            background: rgba(0,0,0,0.5); display: flex;
            align-items: center; justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: ${dark ? '#1e1e2e' : '#ffffff'};
            color: ${dark ? '#cdd6f4' : '#1e293b'};
            border-radius: 12px; padding: 0; width: 480px; max-width: 95vw;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;
        `;

        // ── Header ──
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 14px 20px; display: flex; align-items: center;
            justify-content: space-between;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border-bottom: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
        `;
        header.innerHTML = `<span style="font-weight:700;font-size:15px;">\uD83D\uDCE5 Import Brushes</span>`;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715';
        closeBtn.style.cssText = `background:none;border:none;font-size:18px;cursor:pointer;color:${dark ? '#a6adc8' : '#64748b'};padding:4px 8px;border-radius:4px;`;
        closeBtn.onmouseenter = () => closeBtn.style.background = dark ? '#45475a' : '#e2e8f0';
        closeBtn.onmouseleave = () => closeBtn.style.background = 'none';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);
        modal.appendChild(header);

        const body = document.createElement('div');
        body.style.cssText = 'padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;';

        const hint = document.createElement('div');
        hint.style.cssText = `font-size:13px;color:${dark ? '#a6adc8' : '#64748b'};`;
        hint.textContent = 'Paste brush JSON or upload a file. Select which brushes to add — they will be appended to your existing list.';
        body.appendChild(hint);

        const statusEl = document.createElement('div');
        statusEl.style.cssText = `font-size:12px;font-weight:600;min-height:16px;color:${dark ? '#a6e3a1' : '#16a34a'};`;
        body.appendChild(statusEl);

        // ── JSON input ──
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Paste JSON here\u2026';
        textarea.style.cssText = `
            width: 100%; min-height: 120px; max-height: 200px; box-sizing: border-box;
            padding: 10px; font-family: monospace; font-size: 12px;
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            border-radius: 8px; resize: vertical; outline: none;
            background: ${dark ? '#181825' : '#f8fafc'};
            color: ${dark ? '#cdd6f4' : '#1e293b'};
        `;
        body.appendChild(textarea);

        // ── Checklist (shown after parse) ──
        const listWrap = document.createElement('div');
        listWrap.style.cssText = `
            display: none; flex-direction: column; gap: 2px;
            max-height: 160px; overflow-y: auto;
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            border-radius: 8px; padding: 6px 8px;
            background: ${dark ? '#181825' : '#f8fafc'};
        `;

        const selRow = document.createElement('div');
        selRow.style.cssText = 'display:flex;gap:10px;margin-bottom:4px;';
        const selAll = document.createElement('button');
        selAll.textContent = 'Select All';
        selAll.style.cssText = `background:none;border:none;cursor:pointer;font-size:11px;font-weight:600;padding:0;color:${dark ? '#89b4fa' : '#3b82f6'};`;
        const selNone = document.createElement('button');
        selNone.textContent = 'Select None';
        selNone.style.cssText = selAll.style.cssText;
        selRow.appendChild(selAll);
        selRow.appendChild(selNone);
        listWrap.appendChild(selRow);

        let parsedBrushes = [];
        let checkboxes = [];

        function buildChecklist(brushes) {
            // Clear old rows (keep selRow)
            while (listWrap.children.length > 1) listWrap.removeChild(listWrap.lastChild);
            checkboxes = [];
            brushes.forEach((brush) => {
                const row = document.createElement('label');
                row.style.cssText = `display:flex;align-items:center;gap:8px;padding:3px 2px;cursor:pointer;border-radius:4px;font-size:13px;`;
                row.onmouseenter = () => row.style.background = dark ? '#313244' : '#f1f5f9';
                row.onmouseleave = () => row.style.background = 'none';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = true;
                cb.style.cssText = 'flex-shrink:0;cursor:pointer;accent-color:#3b82f6;';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = (typeof brush.name === 'string' && brush.name.trim()) ? brush.name.trim() : 'Unnamed brush';
                nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

                row.appendChild(cb);
                row.appendChild(nameSpan);
                listWrap.appendChild(row);
                checkboxes.push({ cb, brush });
            });
            selAll.onclick  = () => { checkboxes.forEach(x => { x.cb.checked = true;  }); };
            selNone.onclick = () => { checkboxes.forEach(x => { x.cb.checked = false; }); };
            listWrap.style.display = 'flex';
        }

        function parseAndPreview(text) {
            let parsed;
            try { parsed = JSON.parse(text.trim()); } catch (e) {
                statusEl.style.color = dark ? '#f38ba8' : '#dc2626';
                statusEl.textContent = '\u274C Invalid JSON: ' + e.message;
                listWrap.style.display = 'none';
                return;
            }
            if (!Array.isArray(parsed)) {
                statusEl.style.color = dark ? '#f38ba8' : '#dc2626';
                statusEl.textContent = '\u274C Expected a JSON array of brush objects.';
                listWrap.style.display = 'none';
                return;
            }
            parsedBrushes = parsed.filter(b => Array.isArray(b.pattern) && typeof b.brushSize === 'number');
            const skipped = parsed.length - parsedBrushes.length;
            if (parsedBrushes.length === 0) {
                statusEl.style.color = dark ? '#f38ba8' : '#dc2626';
                statusEl.textContent = '\u274C No valid brush objects found.';
                listWrap.style.display = 'none';
                return;
            }
            statusEl.style.color = dark ? '#a6adc8' : '#64748b';
            statusEl.textContent = `Found ${parsedBrushes.length} brush${parsedBrushes.length !== 1 ? 'es' : ''}${skipped ? ` (${skipped} invalid skipped)` : ''} \u2014 select which to add:`;
            buildChecklist(parsedBrushes);
        }

        textarea.addEventListener('input', () => {
            if (textarea.value.trim()) parseAndPreview(textarea.value);
            else { listWrap.style.display = 'none'; statusEl.textContent = ''; }
        });

        body.appendChild(listWrap);

        // ── Buttons ──
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;justify-content:space-between;align-items:center;';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => { textarea.value = e.target.result; parseAndPreview(e.target.result); };
            reader.readAsText(file);
            fileInput.value = '';
        });
        body.appendChild(fileInput);

        const uploadBtn = document.createElement('button');
        uploadBtn.style.cssText = `
            padding: 7px 14px; border-radius: 8px; border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            cursor: pointer; font-size: 13px; font-weight: 600;
            background: ${dark ? '#313244' : '#f1f5f9'}; color: ${dark ? '#cdd6f4' : '#1e293b'};
            transition: background 0.15s;
        `;
        uploadBtn.textContent = '\uD83D\uDCC1 Upload File';
        uploadBtn.onmouseenter = () => uploadBtn.style.background = dark ? '#45475a' : '#e2e8f0';
        uploadBtn.onmouseleave = () => uploadBtn.style.background = dark ? '#313244' : '#f1f5f9';
        uploadBtn.onclick = () => fileInput.click();

        const importBtn = document.createElement('button');
        importBtn.style.cssText = `
            padding: 7px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600;
            background: ${dark ? '#89b4fa' : '#3b82f6'}; color: ${dark ? '#1e1e2e' : '#ffffff'};
            transition: background 0.15s;
        `;
        importBtn.textContent = '\u2705 Import Selected';
        importBtn.onmouseenter = () => importBtn.style.background = dark ? '#74c7ec' : '#2563eb';
        importBtn.onmouseleave = () => importBtn.style.background = dark ? '#89b4fa' : '#3b82f6';
        importBtn.onclick = () => {
            const selected = checkboxes.filter(x => x.cb.checked).map(x => x.brush);
            if (selected.length === 0) {
                statusEl.style.color = dark ? '#f38ba8' : '#dc2626';
                statusEl.textContent = '\u274C No brushes selected.';
                return;
            }
            selected.forEach(b => {
                scriptState.brushes.push({
                    id: scriptState.nextId++,
                    name: (typeof b.name === 'string' && b.name.trim()) ? b.name.trim() : `Brush ${scriptState.nextId - 1}`,
                    pattern: b.pattern,
                    brushSize: b.brushSize
                });
            });
            saveBrushes();
            statusEl.style.color = dark ? '#a6e3a1' : '#16a34a';
            statusEl.textContent = `\u2705 Added ${selected.length} brush${selected.length !== 1 ? 'es' : ''}. Total: ${scriptState.brushes.length}.`;
            textarea.value = '';
            listWrap.style.display = 'none';
            parsedBrushes = [];
            checkboxes = [];
            if (scriptState.dropdownOpen) renderDropdown();
        };

        btnRow.appendChild(uploadBtn);
        btnRow.appendChild(importBtn);
        body.appendChild(btnRow);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        setTimeout(() => textarea.focus(), 50);
    }

    function renderDropdown() {
        let dropdown = document.getElementById('brush-swap-dropdown');
        if (!dropdown) return;

        // Clear existing items
        const itemsContainer = dropdown.querySelector('.brush-swap-items');
        itemsContainer.innerHTML = '';

        if (scriptState.brushes.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'text-center text-gray-500 dark:text-gray-400 text-xs py-3 px-2';
            emptyMsg.textContent = 'No saved brushes';
            itemsContainer.appendChild(emptyMsg);
            return;
        }

        scriptState.brushes.forEach((brush, idx) => {
            const item = document.createElement('div');
            const isActive = brush.id === scriptState.activeBrushId;
            item.className = 'flex items-center gap-2 p-1.5 border border-gray-200 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                + (isActive ? ' brush-swap-item-active' : '');
            item.dataset.brushId = brush.id;
            item.dataset.brushIdx = idx;

            // Preview grid (wrapped with click-to-expand)
            const previewWrap = document.createElement('div');
            previewWrap.className = 'brush-swap-preview-wrap';
            const preview = createBrushPreview(brush);
            previewWrap.appendChild(preview);
            previewWrap.addEventListener('click', (e) => {
                e.stopPropagation();
                previewWrap.classList.toggle('expanded');
            });
            // Fast tooltip that follows mouse
            let prevTip = null;
            previewWrap.addEventListener('mouseenter', (e) => {
                prevTip = document.createElement('div');
                prevTip.className = 'brush-swap-quick-tip';
                prevTip.textContent = 'click to expand';
                prevTip.style.left = (e.clientX + 12) + 'px';
                prevTip.style.top = (e.clientY - 8) + 'px';
                document.body.appendChild(prevTip);
            });
            previewWrap.addEventListener('mousemove', (e) => {
                if (prevTip) {
                    prevTip.style.left = (e.clientX + 12) + 'px';
                    prevTip.style.top = (e.clientY - 8) + 'px';
                }
            });
            previewWrap.addEventListener('mouseleave', () => {
                if (prevTip) { prevTip.remove(); prevTip = null; }
            });
            item.appendChild(previewWrap);

            // Name and controls
            const infoContainer = document.createElement('div');
            infoContainer.className = 'flex-1 flex flex-col gap-1';

            // Name display / edit
            const nameContainer = document.createElement('div');
            nameContainer.className = 'flex items-center gap-1 flex-1';

            if (scriptState.isRenaming === brush.id) {
                // Rename input mode
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'flex-1 px-1 py-0.5 text-xs border border-gray-500 dark:border-gray-400 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
                input.value = brush.name;
                input.maxLength = 30;

                input.addEventListener('blur', () => {
                    renameBrush(brush.id, input.value);
                    scriptState.isRenaming = null;
                });

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        renameBrush(brush.id, input.value);
                        scriptState.isRenaming = null;
                    }
                });

                nameContainer.appendChild(input);
                setTimeout(() => input.focus(), 0);
            } else {
                // Normal name display with pencil icon
                const nameSpan = document.createElement('span');
                nameSpan.className = 'flex-1 text-xs font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap overflow-hidden text-ellipsis';
                nameSpan.textContent = brush.name;
                nameContainer.appendChild(nameSpan);

                const pencilBtn = document.createElement('button');
                pencilBtn.className = 'bg-none border-none cursor-pointer p-0 text-xs opacity-60 hover:opacity-100 transition-opacity flex-shrink-0';
                pencilBtn.title = 'Rename brush';
                pencilBtn.innerHTML = '✏️';
                pencilBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    scriptState.isRenaming = brush.id;
                    renderDropdown();
                });
                nameContainer.appendChild(pencilBtn);
            }

            infoContainer.appendChild(nameContainer);

            // Load and Delete buttons
            const buttonsContainer = document.createElement('div');
            buttonsContainer.className = 'flex gap-1 flex-shrink-0';

            const loadBtn = document.createElement('button');
            loadBtn.className = 'px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 cursor-pointer rounded transition-colors hover:bg-blue-50 dark:hover:bg-blue-900 hover:border-blue-400 dark:hover:border-blue-400';
            loadBtn.textContent = 'Load';
            loadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                loadBrush(brush.id);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'px-1 py-0.5 text-xs bg-none border border-gray-300 dark:border-gray-500 opacity-60 hover:opacity-100 transition-opacity cursor-pointer rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-red-50 dark:hover:bg-red-900 hover:border-red-400 dark:hover:border-red-400';
            deleteBtn.title = 'Delete brush';
            deleteBtn.innerHTML = '✕';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteBrush(brush.id);
            });

            buttonsContainer.appendChild(loadBtn);
            buttonsContainer.appendChild(deleteBtn);
            infoContainer.appendChild(buttonsContainer);

            item.appendChild(infoContainer);

            // Drag handle (right side)
            const dragHandle = document.createElement('div');
            dragHandle.className = 'brush-swap-drag-handle';
            dragHandle.title = 'Drag to reorder';
            for (let d = 0; d < 4; d++) {
                const dot = document.createElement('div');
                dot.className = 'brush-swap-drag-handle-dot';
                dragHandle.appendChild(dot);
            }
            setupDragReorder(dragHandle, item, idx, itemsContainer);
            item.appendChild(dragHandle);

            itemsContainer.appendChild(item);
        });
    }

    function toggleDropdown() {
        const dropdown = document.getElementById('brush-swap-dropdown');
        if (!dropdown) return;

        scriptState.dropdownOpen = !scriptState.dropdownOpen;

        if (scriptState.dropdownOpen) {
            // Detect if the paint menu is docked to top
            const paintIsTop = localStorage.getItem('gpc-paint-is-top') === 'true';
            const resizeHandle = dropdown.querySelector('.brush-swap-resize-handle');
            if (paintIsTop) {
                dropdown.style.bottom = 'auto';
                dropdown.style.top = '100%';
                dropdown.style.marginBottom = '0';
                dropdown.style.marginTop = '8px';
                if (resizeHandle) resizeHandle.className = 'brush-swap-resize-handle brush-swap-resize-br';
            } else {
                dropdown.style.top = 'auto';
                dropdown.style.bottom = '100%';
                dropdown.style.marginTop = '0';
                dropdown.style.marginBottom = '8px';
                if (resizeHandle) resizeHandle.className = 'brush-swap-resize-handle brush-swap-resize-tr';
            }
            // Apply stored resize dimensions if any
            try {
                const stored = JSON.parse(localStorage.getItem(RESIZE_STORAGE_KEY));
                if (stored) {
                    dropdown.style.maxWidth = stored.w + 'px';
                    dropdown.style.maxHeight = stored.h + 'px';
                }
            } catch {}
            dropdown.classList.add('open');
            renderDropdown();
        } else {
            dropdown.classList.remove('open');
            scriptState.isRenaming = null;
        }
    }

    // ============================================
    // DOM INITIALIZATION
    // ============================================

    function injectCSS() {
        const style = document.createElement('style');
        style.textContent = `
            /* Paintbrush icon button */
            #brush-swap-toggle {
                opacity: 0.85;
                transition: all 0.2s ease;
            }

            #brush-swap-toggle:hover {
                opacity: 1;
            }

            #brush-swap-toggle:active {
                opacity: 0.7;
            }

            /* Dropdown container */
            #brush-swap-dropdown {
                position: absolute;
                bottom: 100%;
                right: 0;
                border-radius: 4px;
                margin-bottom: 8px;
                max-width: 300px;
                max-height: 0;
                overflow: hidden;
                opacity: 0;
                pointer-events: none;
                transition: max-height 0.3s ease, opacity 0.3s ease;
                z-index: 1000;
            }

            #brush-swap-dropdown.open {
                max-height: 600px;
                opacity: 1;
                overflow-y: auto;
                pointer-events: auto;
            }

            /* Disable all transitions during resize drag to prevent animation lag */
            #brush-swap-dropdown.brush-swap-resizing {
                transition: none !important;
                overflow-y: auto !important;
            }

            /* Items container */
            .brush-swap-items {
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: 8px;
                min-width: 250px;
            }

            /* Preview grid */
            .brush-swap-preview-grid {
                display: grid;
                gap: 1px;
                flex-shrink: 0;
                background: var(--color-gray-100, white);
                padding: 2px;
                border: 1px solid var(--color-gray-400, #ddd);
                border-radius: 2px;
            }

            .brush-swap-quick-tip {
                position: fixed;
                pointer-events: none;
                z-index: 100001;
                background: rgba(0,0,0,0.8);
                color: #fff;
                padding: 3px 7px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 500;
                white-space: nowrap;
                font-family: system-ui, sans-serif;
            }

            .brush-swap-preview-wrap {
                width: 36px;
                height: 36px;
                overflow: hidden;
                flex-shrink: 0;
                border-radius: 3px;
                cursor: pointer;
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .brush-swap-preview-wrap.expanded {
                width: auto;
                height: auto;
                max-width: 120px;
                max-height: 120px;
            }

            .brush-swap-preview-wrap.expanded .brush-swap-preview-grid {
                max-width: 100%;
                max-height: 100%;
            }

            .brush-swap-preview-cell {
                background: var(--color-gray-100, white);
                border: 0.5px solid var(--color-gray-300, #eee);
            }

            .brush-swap-preview-cell.active {
                background: var(--color-gray-800, #333);
            }

            .brush-swap-preview-cell.center {
                background: #ff6b6b;
            }

            /* Scrollbar styling for dropdown */
            #brush-swap-dropdown::-webkit-scrollbar {
                width: 6px;
            }

            #brush-swap-dropdown::-webkit-scrollbar-track {
                background: transparent;
            }

            #brush-swap-dropdown::-webkit-scrollbar-thumb {
                background: #888;
                border-radius: 3px;
            }

            #brush-swap-dropdown::-webkit-scrollbar-thumb:hover {
                background: #555;
            }

            /* Dark mode scrollbar */
            @media (prefers-color-scheme: dark) {
                #brush-swap-dropdown::-webkit-scrollbar-thumb {
                    background: #555;
                }

                #brush-swap-dropdown::-webkit-scrollbar-thumb:hover {
                    background: #777;
                }
            }

            /* Scroll-swap toast */
            #brush-swap-toast {
                position: fixed;
                pointer-events: none;
                z-index: 10000;
                background: rgba(0, 0, 0, 0.82);
                color: #fff;
                padding: 6px 10px;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 600;
                font-family: system-ui, sans-serif;
                white-space: nowrap;
                opacity: 0;
                transition: opacity 0.15s ease;
                transform: translate(12px, -50%);
                display: flex;
                align-items: center;
                gap: 8px;
            }
            #brush-swap-toast.visible {
                opacity: 1;
            }
            #brush-swap-toast .toast-preview {
                flex-shrink: 0;
            }
            #brush-swap-toast .toast-preview .brush-swap-preview-cell {
                background: rgba(255,255,255,0.2);
                border-color: rgba(255,255,255,0.1);
            }
            #brush-swap-toast .toast-preview .brush-swap-preview-cell.active {
                background: #fff;
            }
            #brush-swap-toast .toast-preview .brush-swap-preview-cell.center {
                background: #ff6b6b;
            }
            #brush-swap-toast .toast-preview .brush-swap-preview-grid {
                background: transparent;
                border-color: rgba(255,255,255,0.15);
            }

            /* Active brush highlight */
            .brush-swap-item-active {
                outline: 2px solid var(--color-blue-500, #3b82f6) !important;
                outline-offset: -1px;
                background: var(--color-blue-50, rgba(59,130,246,0.08)) !important;
            }

            /* Drag handle */
            .brush-swap-drag-handle {
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                width: 14px;
                cursor: grab;
                flex-shrink: 0;
                opacity: 0.35;
                transition: opacity 0.15s;
                user-select: none;
                padding: 2px 0;
            }
            .brush-swap-drag-handle:hover {
                opacity: 0.8;
            }
            .brush-swap-drag-handle:active {
                cursor: grabbing;
                opacity: 1;
            }
            .brush-swap-drag-handle-dot {
                width: 3px;
                height: 3px;
                border-radius: 50%;
                background: var(--color-gray-500, #9ca3af);
                margin: 1px 0;
            }

            /* Dragging visual */
            .brush-swap-item-dragging {
                opacity: 0.4;
            }
            .brush-swap-drop-indicator {
                height: 2px;
                background: var(--color-blue-500, #3b82f6);
                border-radius: 1px;
                margin: -2px 0;
                pointer-events: none;
            }

            /* Resize handle — single corner, right side */
            .brush-swap-resize-handle {
                position: absolute;
                right: 0;
                width: 14px;
                height: 14px;
                z-index: 1001;
                opacity: 0;
                transition: opacity 0.15s;
            }
            #brush-swap-dropdown:hover .brush-swap-resize-handle {
                opacity: 0.5;
            }
            .brush-swap-resize-handle:hover {
                opacity: 1 !important;
            }
            .brush-swap-resize-handle::after {
                content: '';
                position: absolute;
                width: 7px;
                height: 7px;
                border-style: solid;
                border-color: var(--color-gray-500, #6b7280);
            }
            /* top-right: open upward */
            .brush-swap-resize-tr {
                top: 0;
                cursor: ne-resize;
            }
            .brush-swap-resize-tr::after {
                top: 2px; right: 2px;
                border-width: 2px 2px 0 0;
            }
            /* bottom-right: open downward (paint menu at top) */
            .brush-swap-resize-br {
                bottom: 0;
                cursor: se-resize;
            }
            .brush-swap-resize-br::after {
                bottom: 2px; right: 2px;
                border-width: 0 2px 2px 0;
            }

            /* Export/Import footer */
            .brush-swap-footer {
                display: flex;
                justify-content: flex-end;
                gap: 4px;
                padding: 6px 8px;
                border-top: 1px solid var(--color-gray-200, #e5e7eb);
            }
            :is(.dark) .brush-swap-footer,
            .dark .brush-swap-footer {
                border-top-color: #374151;
            }
            .brush-swap-footer-btn {
                background: none;
                border: 1px solid var(--color-gray-300, #d1d5db);
                border-radius: 5px;
                cursor: pointer;
                font-size: 11px;
                line-height: 1;
                padding: 3px 8px;
                color: var(--color-gray-500, #6b7280);
                transition: background 0.12s, color 0.12s;
                white-space: nowrap;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .brush-swap-footer-btn:hover {
                background: var(--color-gray-100, #f3f4f6);
                color: var(--color-gray-800, #1f2937);
                border-color: var(--color-gray-400, #9ca3af);
            }
            :is(.dark) .brush-swap-footer-btn,
            .dark .brush-swap-footer-btn {
                border-color: #4b5563;
                color: #9ca3af;
            }
            :is(.dark) .brush-swap-footer-btn:hover,
            .dark .brush-swap-footer-btn:hover {
                background: #374151;
                color: #e5e7eb;
                border-color: #6b7280;
            }
        `;
        document.head.appendChild(style);
    }

    function createUI(bottomControlsElement) {
        // Find commitBtn to position next to it
        const commitBtn = bottomControlsElement.querySelector('#commitBtn') ||
                         bottomControlsElement.querySelector('button');

        if (!commitBtn) {
            console.warn('Brush Swap: Could not find commitBtn');
            return;
        }

        // Create wrapper for button and dropdown
        const wrapper = document.createElement('div');
        wrapper.className = 'relative inline-block';

        // Create toggle button (paintbrush icon)
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'brush-swap-toggle';
        toggleBtn.className = 'bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 cursor-pointer px-2.5 py-1.5 text-xs leading-none font-semibold text-gray-800 dark:text-gray-200 ml-2 inline-flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 hover:border-gray-600 dark:hover:border-gray-500 active:bg-gray-300 dark:active:bg-gray-800';
        toggleBtn.title = 'Toggle saved brushes';
        toggleBtn.innerHTML = '<span style="font-size: 10px; font-weight: 600; display: flex; align-items: center; gap: 4px;">▲ brushes</span>';
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown();
        });

        // ── Scroll-to-swap: mouse wheel over toggle button cycles brushes ──
        const toast = document.createElement('div');
        toast.id = 'brush-swap-toast';
        document.body.appendChild(toast);
        let toastTimer = null;

        function showSwapToast(brush, x, y) {
            toast.innerHTML = '';
            // Add preview
            const previewWrap = document.createElement('span');
            previewWrap.className = 'toast-preview';
            previewWrap.appendChild(createBrushPreview(brush));
            toast.appendChild(previewWrap);
            // Add name
            const nameSpan = document.createElement('span');
            nameSpan.textContent = brush.name;
            toast.appendChild(nameSpan);

            toast.style.left = x + 'px';
            toast.style.top = y + 'px';
            toast.classList.add('visible');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove('visible'), 900);
        }

        toggleBtn.addEventListener('wheel', (e) => {
            if (scriptState.brushes.length === 0) return;
            e.preventDefault();
            e.stopPropagation();

            const dir = e.deltaY > 0 ? 1 : -1;
            const len = scriptState.brushes.length;

            // Initialize index to current brush if not set
            if (scriptState.scrollIndex < 0 || scriptState.scrollIndex >= len) {
                scriptState.scrollIndex = dir > 0 ? 0 : len - 1;
            } else {
                scriptState.scrollIndex = ((scriptState.scrollIndex + dir) % len + len) % len;
            }

            const brush = scriptState.brushes[scriptState.scrollIndex];
            applyBrushToEditor(brush);
            showSwapToast(brush, e.clientX, e.clientY);

            if (DEBUG) console.log(`Brush Swap: Scrolled to "${brush.name}" (index ${scriptState.scrollIndex})`);
        }, { passive: false });

        // Create dropdown container
        const dropdown = document.createElement('div');
        dropdown.id = 'brush-swap-dropdown';
        dropdown.className = 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 shadow-lg';
        dropdown.style.position = 'absolute'; // ensure positioned for resize handles

        // Single resize handle — class swapped in toggleDropdown based on paint menu position
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'brush-swap-resize-handle brush-swap-resize-tr'; // default: top-right
        dropdown.appendChild(resizeHandle);

        // Stored dimensions (persisted so they survive open/close)
        let storedSize = null;
        try { storedSize = JSON.parse(localStorage.getItem(RESIZE_STORAGE_KEY)); } catch {}

        function applyStoredSize() {
            if (storedSize) {
                dropdown.style.width = storedSize.w + 'px';
                dropdown.style.maxWidth = storedSize.w + 'px';
                dropdown.style.maxHeight = storedSize.h + 'px';
            }
        }

        function setupResize(handle) {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startY = e.clientY;
                const rect = dropdown.getBoundingClientRect();
                const startW = rect.width;
                const startH = rect.height;
                const isBottom = handle.classList.contains('brush-swap-resize-br');
                dropdown.style.userSelect = 'none';
                dropdown.classList.add('brush-swap-resizing');

                const onMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const dy = ev.clientY - startY;
                    // Top-right: drag up = taller. Bottom-right: drag down = taller.
                    const newH = Math.max(150, isBottom ? startH + dy : startH - dy);
                    const newW = Math.max(200, startW + dx);
                    dropdown.style.width = newW + 'px';
                    dropdown.style.maxWidth = newW + 'px';
                    dropdown.style.maxHeight = newH + 'px';
                };

                const onUp = () => {
                    dropdown.style.userSelect = '';
                    dropdown.classList.remove('brush-swap-resizing');
                    document.removeEventListener('mousemove', onMove, true);
                    document.removeEventListener('mouseup', onUp, true);
                    const r = dropdown.getBoundingClientRect();
                    storedSize = { w: Math.round(r.width), h: Math.round(r.height) };
                    localStorage.setItem(RESIZE_STORAGE_KEY, JSON.stringify(storedSize));
                };

                document.addEventListener('mousemove', onMove, true);
                document.addEventListener('mouseup', onUp, true);
            });
        }

        setupResize(resizeHandle);
        
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'brush-swap-items';
        dropdown.appendChild(itemsContainer);

        // Footer: export/import buttons
        const dropdownFooter = document.createElement('div');
        dropdownFooter.className = 'brush-swap-footer';

        const exportBtn = document.createElement('button');
        exportBtn.className = 'brush-swap-footer-btn';
        exportBtn.innerHTML = '\uD83D\uDCE4 Export';
        exportBtn.addEventListener('click', (e) => { e.stopPropagation(); showExportBrushesModal(); });

        const importBtn = document.createElement('button');
        importBtn.className = 'brush-swap-footer-btn';
        importBtn.innerHTML = '\uD83D\uDCE5 Import';
        importBtn.addEventListener('click', (e) => { e.stopPropagation(); showImportBrushesModal(); });

        const resetSizeBtn = document.createElement('button');
        resetSizeBtn.className = 'brush-swap-footer-btn';
        resetSizeBtn.innerHTML = '\u21BA';
        resetSizeBtn.title = 'Reset size';
        resetSizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            storedSize = null;
            localStorage.removeItem(RESIZE_STORAGE_KEY);
            dropdown.style.width = '';
            dropdown.style.maxWidth = '';
            dropdown.style.maxHeight = '';
        });

        dropdownFooter.appendChild(exportBtn);
        dropdownFooter.appendChild(importBtn);
        dropdownFooter.appendChild(resetSizeBtn);
        dropdown.appendChild(dropdownFooter);

        // Assemble and insert
        wrapper.appendChild(toggleBtn);
        wrapper.appendChild(dropdown);

        // Insert after commitBtn
        commitBtn.parentNode.insertBefore(wrapper, commitBtn.nextSibling);

        // Close dropdown on click outside
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target) && scriptState.dropdownOpen) {
                toggleDropdown();
            }
        });
    }

    function hookToggleBrushEditor() {
        const originalToggle = _pw.toggleBrushEditor;

        if (typeof originalToggle === 'function') {
            _pw.toggleBrushEditor = function() {
                // Call original toggle
                originalToggle.call(this);

                // Add dimension dropdown after modal opens; also install drag/fill enhancements
                setTimeout(() => {
                    addBrushDimensionDropdown();
                    _installBrushEditorEnhancements();
                }, 50);

                // Opera GX / Blink failsafe: after the close animation (200ms), ensure the
                // overlay has pointer-events:none so it can't silently swallow map clicks.
                setTimeout(() => {
                    const overlay = document.getElementById('brushEditorMenu');
                    if (overlay && overlay.classList.contains('hidden')) {
                        overlay.style.pointerEvents = 'none';
                        overlay.style.visibility = 'hidden';
                    }
                }, 350);
                // When opening, restore pointer-events so the overlay is interactive
                setTimeout(() => {
                    const overlay = document.getElementById('brushEditorMenu');
                    if (overlay && !overlay.classList.contains('hidden')) {
                        overlay.style.pointerEvents = '';
                        overlay.style.visibility = '';
                    }
                }, 10);
            };
            if (DEBUG) console.log('Brush Swap: Hooked toggleBrushEditor');
        }
    }

    // ============================================

    function hookSaveBrushToPreset() {
        if (typeof _pw.saveBrushToPreset !== 'function') {
            console.warn('Brush Swap: saveBrushToPreset not yet available, retrying...');
            return false;
        }

        const originalSave = _pw.saveBrushToPreset;

        _pw.saveBrushToPreset = function(slotIndex) {
            // Call original function
            originalSave.call(this, slotIndex);

            // After save, capture brush from DOM grid
            const brushData = captureBrushFromDOM();
            if (brushData) {
                const newBrush = addBrush(brushData.pattern, brushData.brushSize);
                if (DEBUG) console.log('Brush Swap: Saved brush', newBrush);
                renderDropdown();
            } else {
                console.warn('Brush Swap: Failed to capture brush from DOM');
            }
        };

        if (DEBUG) console.log('Brush Swap: Successfully hooked saveBrushToPreset');
        return true;
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    function init() {
        // Load saved brushes from localStorage
        loadBrushes();

        // Inject CSS
        injectCSS();

        // Wait for bottomControls and saveBrushToPreset to be ready
        let attempts = 0;
        const maxAttempts = 120; // 60 seconds at 500ms intervals

        const initInterval = setInterval(() => {
            attempts++;

            const bottomControls = document.getElementById('bottomControls');
            const hasSaveBrushToPreset = typeof _pw.saveBrushToPreset === 'function';

            if (bottomControls && hasSaveBrushToPreset && attempts <= maxAttempts) {
                clearInterval(initInterval);

                // Set default brush size to 9x9 — must wait for async config fetch
                // which overwrites BrushSize from userConfig.brushSize
                const DEFAULT_BRUSH_SIZE = 9;
                function applyDefaultBrushSize() {
                    _setPageVar('BrushSize', DEFAULT_BRUSH_SIZE);
                    _pw.BrushSize = DEFAULT_BRUSH_SIZE;
                    _runInPage('if(typeof generateBrushGrid==="function")generateBrushGrid(currentBrushPattern)');
                    // Update the dimension dropdown if it exists
                    const sel = document.getElementById('brush-swap-dimension-select');
                    if (sel) sel.value = DEFAULT_BRUSH_SIZE;
                }
                // Apply immediately, then re-apply after config fetch likely completes
                applyDefaultBrushSize();
                let configChecks = 0;
                const configWait = setInterval(() => {
                    configChecks++;
                    // userConfig gets written to localStorage when server fetch completes
                    const saved = localStorage.getItem('userConfig');
                    if (saved || configChecks > 20) {
                        clearInterval(configWait);
                        applyDefaultBrushSize();
                    }
                }, 250);

                // Create UI
                createUI(bottomControls);

                // Hook into saveBrushToPreset (now guaranteed to exist)
                hookSaveBrushToPreset();

                // Hook into toggleBrushEditor for dimension dropdown
                hookToggleBrushEditor();

                if (DEBUG) console.log('Brush Swap initialized successfully');
            } else if (attempts > maxAttempts) {
                clearInterval(initInterval);
                console.warn('Brush Swap: Could not initialize - bottomControls or saveBrushToPreset not found', {
                    hasBottomControls: !!bottomControls,
                    hasSaveBrushToPreset: hasSaveBrushToPreset
                });
            }
        }, 500);
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
            })();
            _featureStatus.paintBrushSwap = 'ok';
            console.log('[GeoPixelcons++] ✅ Paint Brush Swap loaded');
        } catch (err) {
            _featureStatus.paintBrushSwap = 'error';
            dbgPush(`Paint Brush Swap init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Paint Brush Swap' });
            console.error('[GeoPixelcons++] ❌ Paint Brush Swap failed:', err);
        }
    }