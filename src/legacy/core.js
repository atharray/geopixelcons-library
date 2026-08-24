
(function () {
    'use strict';

    const VERSION = '2.10.0';

    // ============================================================
    //  SETTINGS SYSTEM
    // ============================================================
    const STORAGE_KEY = 'geopixelcons_settings';
    const FEATURE_LIST = [
        { key: 'bulkPurchaseColors', name: 'Bulk Purchase Colors', icon: '🛒', desc: 'Advanced color purchasing with queue management.', features: ['Bulk color purchase with preview modal', 'Queue management in profile panel', 'Duplicate detection & insufficient-pixels handling', 'Purchase progress tracking'] },
        { key: 'ghostPlusPlus', name: 'Ghost++', icon: '👻', desc: 'A scalable, multi-template ghost/overlay manager that replaces the native ghost image tool.', features: ['Indexed-core rendering that scales to large, high-colour templates', 'Draggable, resizable, fully collapsible manager with a two-column layout', 'Thumbnail template library with hover preview, edit/teleport, and bulk export/delete', 'Sort/filter/search palette with hover-to-copy hex readout', 'Segmented completion progress bar with per-colour breakdown, unaffected by which colours are toggled on/off', 'One-click full-opacity template Preview toggle'] },
        { key: 'guildOverhaul', name: 'Guild Overhaul', icon: '⚔️', desc: 'Comprehensive guild interface improvements.', features: ['Enhanced member management UI', 'Bank/treasury system', 'Color limit tracking', 'Role hierarchy display', 'Guild-specific moderation tools'] },
        { key: 'hidePaintMenu', name: 'Paint Menu Controls', icon: '🫣', desc: 'Adds a collapse/expand toggle for the bottom controls panel.', features: ['Collapse & expand the bottom paint controls', 'Reposition controls (left/center/right)', 'Optional toolbar scale changes controls and height without changing paint-panel width', 'Smooth CSS animations'] },
        { key: 'paintBrushSwap', name: 'Paint Brush Overhaul', icon: '🖌️', desc: 'Rapid paintbrush tool switching with keyboard shortcuts.', features: ['Configurable keyboard shortcuts for brush swap', 'Brush preset profiles for different painting patterns', 'Quick-switch between brush types'] },
        { key: 'regionScreenshot', name: 'Region Screenshot', icon: '📸', desc: 'Capture region-level screenshots with coordinate overlays.', features: ['Region image capture with coordinate overlay', 'Alpha channel support', 'Save as PNG directly'] },
        { key: 'regionsHighscore', name: 'Regions Highscore', icon: '🏆', desc: 'Displays regional pixel/color contribution rankings.', features: ['Sort rankings by player or guild', 'Filter by pixel count, color, or region', 'Historical contribution statistics'] },
        { key: 'themeEditor', name: 'Theme Editor', icon: '🎨', desc: 'Visual map theme editor — edit MapLibre GL styles with color pickers, save/load/manage custom themes.', features: ['Bundled themes (Fjord, Obsidian, Monokai, Ayu Mirage, etc.)', 'Simple & Full color editing modes', 'Live preview toggle for instant feedback', 'Import/export themes as JSON files', 'Quick theme-switch submenu in the dropdown', 'Theme manager with create, edit & delete'] },
        { key: 'mapMarkers', name: 'Map Markers', icon: '📌', desc: 'Place and manage image stickers on the map canvas. Images scale and persist with the map.', features: ['Upload PNG/JPEG/WebP files or use image URLs', 'Drag to define placement bounds (click-only rejected with prompt)', 'Hold Shift during drag to force aspect-ratio lock', 'Per-marker lock/unlock aspect ratio toggle', 'Per-marker opacity slider and visibility toggle', 'Edit mode with 8 fixed-size handles (corners + edge midpoints)', 'Drag-to-sort cards to reorder rendering order', 'Compact card view with click-to-expand controls', 'Draggable management modal', 'Persistent storage via IndexedDB'] },
        { key: 'profileColorsCollapse', name: 'Profile Color List Collapse', icon: '🎨', desc: 'Keeps large owned-color lists compact in the Profile overlay.', features: ['Shows the first 100 colors initially', 'Expands the complete list with Show All', 'Collapses it again with Show Less'] },
    ];

    const EXTENSION_LIST = [
        { key: 'extAutoHoverMenus', name: 'Auto-open Menus on Hover', icon: '🖱️', desc: 'Automatically opens group button dropdown menus when you hover over them.', features: ['Hover over any group button to auto-open its dropdown', 'Configurable vertical hover zone (250px)', 'Per-button cooldown to prevent rapid toggles', 'MutationObserver-based — detects new buttons automatically'] },
        { key: 'extGoToLastLocation', name: 'Auto-Go to Last Location', icon: '📍', desc: 'Automatically returns you to your last location on page load if you spawned at the default area.', features: ['Detects if you spawned in the default area', 'Auto-clicks the "Last Location" button on load', 'One-shot — only fires once per page load', 'Automatic cleanup after 10 seconds to prevent leaks'] },
        { key: 'extPillHoverLabels', name: 'Hover Labels', icon: '💊', desc: 'Adds the expanding pill-style hover animation with text labels to all submenu buttons under controls-left.', features: ['Expanding pill animation on hover', 'Shows button title/name as a label', 'Applies to all native dropdown submenu buttons', 'Respects dark mode colors', 'MutationObserver-based — detects dynamically added buttons'] },
        { key: 'extJanitorView', name: 'Janitor View', icon: '🛡️', desc: 'Reveals the hidden moderation button for janitors/moderators.', features: ['Removes the hidden class from the moderation group button', 'Makes the 🛡️ Moderation button visible in the controls'] },
        { key: 'extMapMovementLock', name: 'Map Movement Lock', icon: '🔒', desc: 'Adds a right-side lock button that freezes map panning, zooming, and page scrolling until you unlock it.', features: ['Creates a lock toggle in controls-right', 'Blocks mouse, touch, keyboard, zoom button, scripted pan/zoom movement, and page-wide scrolling while locked', 'Preserves the locked state across reloads while the extension is enabled'] },
        { key: 'extBlockedUsers', name: 'Blocked User List', icon: '🚷', desc: 'Hides or highlights canvas pixels based on who placed them. Local rendering only — it changes nothing for other players and does not stop anyone painting.', features: ['🚷 Blocked Users entry in the GeoPixelcons++ menu opens the manager', '🚷 button in the pixel info panel queues the selected user, ready to block', 'Hide mode makes their pixels transparent; Highlight mode tints them red instead', 'Add users directly by numeric ID; names resolve automatically', 'Blocks persist across reloads', 'Reads the per-pixel ownership data the site already loads — no extra requests'] },
        { key: 'extGuildSearch', name: 'Guild Search Button', icon: '🔎', desc: 'Inserts a search icon button in the guild submenu to open the Guild Search modal — allows searching other guilds without leaving your own.', features: ['Adds a search button directly below the Guild menu button in its submenu', 'Calls the native toggleGuildSearchModal() when clicked'] },
        { key: 'extLogOutButton', name: 'Log Out Button', icon: '🚪', desc: 'Appends a Log Out button to the bottom of the right controls panel. Hides automatically when you are not logged in.', features: ['Exit-icon Log Out button at the bottom of controls-right', 'Calls the native logOut() when clicked', 'Auto-hides while the user is logged out and reappears on login'] },
        { key: 'ghostPaletteSearch', name: 'Ghost Palette Color Search', icon: '🔍', deprecated: true, ghostPlusPlusGray: true, desc: 'Superseded by Ghost++. Adds a searchable color filter to the native ghost image palette — only useful if Ghost++ is disabled.', features: ['Search ghost palette colors by hex code', 'Hide unmatched colors with a toggle', 'Enable filtered: enable matched colors and disable all others in the ghost palette', 'Enable owned and filtered: enable only owned colors currently shown by filters', 'Real-time glow/highlight on matching swatches'] },
        { key: 'ghostTemplateManager', name: 'Ghost Template Manager', icon: '👻', deprecated: true, ghostPlusPlusGray: true, desc: 'Superseded by Ghost++. Full ghost image template history with import/export and overlay preview on the native ghost tool — only useful if Ghost++ is disabled.', features: ['IndexedDB-backed template history', 'Import/export ghost templates as files', 'Preview overlay on the map', 'Position encoding in image header', 'Duplicate detection'] },
        { key: 'showSyncGhostBtn', name: 'Sync Ghost With Selected Color', icon: '♻️', desc: 'Adds a button to the Image Tools (🖼️) dropdown. When toggled on in-game, changing your active paint color automatically enables only that color in the ghost palette and disables all others.', features: ['Toggle button in the Image Tools dropdown', 'Auto-enables only the currently selected paint color in the ghost palette, disabling the rest', 'Works with Ghost++\'s own focused template as well as the native ghost palette'] },
        { key: 'mobilePaintingExtension', name: 'Painting Menu Overhaul', icon: '🎨', desc: 'Touch-friendly painting menu adjustments. Requires Ghost++ with a focused template. Under active development — features are being added incrementally.', features: ['Keeps the site\'s natural responsive paint-panel width', 'Native color grid replaced with the focused Ghost++ template\'s own color grid, live-synced with the Ghost++ manager', 'Tap a color to show only its remaining pixels and select it as your active paint color', 'Enable > Selected can optionally highlight the nearest selected-color pixel with a large red pulse without moving the map', 'Hover tooltip and hex display match the Ghost++ manager; sort/filter set there carries over too', 'Enable/Disable/Get hex/Sort/Filter controls that share live state with the Ghost++ manager', 'Preview thumbnail → upload panel → Use manual palette keeps your own hand-picked colors instead of syncing to the focused template', 'Tapping a template color you don\'t own shows an alert instead of silently failing to select it'] },
    ];

    // Presentation-only grouping for the Settings modal. Runtime feature keys,
    // defaults, and status tracking continue to come from the two lists above.
    const EXTENSION_CATEGORIES = [
        { name: 'Painting', keys: ['paintBrushSwap', 'hidePaintMenu', 'mobilePaintingExtension', 'bulkPurchaseColors'] },
        { name: 'Ghost Template', keys: ['ghostPlusPlus', 'showSyncGhostBtn'] },
        { name: 'Map', keys: ['mapMarkers', 'extMapMovementLock', 'regionScreenshot', 'regionsHighscore', 'themeEditor', 'extJanitorView', 'extBlockedUsers'] },
        { name: 'Menuing', keys: ['guildOverhaul', 'extGuildSearch', 'profileColorsCollapse', 'extAutoHoverMenus', 'extPillHoverLabels', 'extLogOutButton'] },
        { name: 'Misc', keys: ['extGoToLastLocation'] },
        { name: 'Deprecated', keys: ['ghostPaletteSearch', 'ghostTemplateManager'] },
    ];

    const DEFAULT_SETTINGS = { useEmojiIcon: false, compactPaintOverflow: true, disableGroupNoise: false, startShiftLock: false, startInspectMode: false, smoothZoomButtons: false, enableDebug: false, modernizeGhostPaletteBtns: false, rememberGhostModalPos: false, mobilePaintingManualPalette: false, controlsUiScale: 100, keybinds: { openSettings: { key: 'P', ctrl: true, shift: true }, mapMovementLock: { key: 'L', ctrl: true, shift: true } } };
    FEATURE_LIST.forEach(f => DEFAULT_SETTINGS[f.key] = true);
    // Ghost++ deliberately opts out of the blanket "every feature defaults on" rule above:
    // it wholesale replaces the native ghost-image tool, which is too large a UX change to
    // force on every user silently. New installs get it off until they enable it themselves.
    DEFAULT_SETTINGS.ghostPlusPlus = false;
    EXTENSION_LIST.forEach(f => DEFAULT_SETTINGS[f.key] = f.key === 'extPillHoverLabels' ? true : false);

    function loadSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULT_SETTINGS };
            const parsed = JSON.parse(raw);
            // Merge with defaults so new features default to enabled
            const merged = { ...DEFAULT_SETTINGS, ...parsed };
            // Deep-merge each keybind so partial saved entries inherit missing defaults.
            const savedKeybinds = parsed.keybinds || {};
            const savedOpenSettings = savedKeybinds.openSettings;
            if (savedOpenSettings &&
                savedOpenSettings.key === 'H' &&
                savedOpenSettings.ctrl === true &&
                savedOpenSettings.shift === true) {
                savedKeybinds.openSettings = { key: 'P', ctrl: true, shift: true };
            }
            merged.keybinds = { ...savedKeybinds };
            Object.entries(DEFAULT_SETTINGS.keybinds).forEach(([key, defaults]) => {
                merged.keybinds[key] = { ...defaults, ...(savedKeybinds[key] || {}) };
            });
            return merged;
        } catch (e) {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings(settings) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    const _settings = loadSettings();
    // Assigned by features/controls-scale.js later in the assembled IIFE.
    // The dropdown's click handler runs only after every feature has loaded.
    let gpcControlsScale = null;

    // ============================================================
    //  DEBUG SYSTEM
    // ============================================================
    const _debugLog = [];

    /**
     * Push an entry into the debug log. Only records when enableDebug is true.
     * @param {string} message  Human-readable description of the event.
     * @param {object} [opts]
     * @param {Error|any} [opts.error]       The caught error object (message + stack captured).
     * @param {string}    [opts.uiComponent] Description of the UI element that triggered the action.
     */
    function dbgPush(message, opts = {}) {
        if (!_settings.enableDebug) return;
        const entry = { timestamp: new Date().toISOString(), message };
        if (opts.uiComponent) entry.uiComponent = opts.uiComponent;
        if (opts.error != null) {
            entry.error = String(opts.error);
            if (opts.error && opts.error.stack) entry.stack = opts.error.stack;
        }
        _debugLog.push(entry);
    }

    /** Returns the number of currently collected debug entries. */
    function dbgCount() { return _debugLog.length; }

    // Lets OTHER installed userscripts feed their own diagnostic events into
    // THIS script's Debug Log, instead of each needing an entirely separate
    // export/toggle of their own -- one exported file covering everything
    // instead of hunting through several. Exposed on the real page window
    // (unsafeWindow and window are the same actual DOM object) since that's
    // the one thing genuinely shared across separate userscripts running in
    // the same page, unlike anything declared with let/const at this
    // script's own top level. push() already no-ops unless Enable Debugging
    // is on (see dbgPush above), so a caller doesn't strictly need to check
    // isEnabled() first, but it's exposed anyway so one can skip building a
    // message/opts object it doesn't need yet.
    (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).__gpcDebugBridge = Object.freeze({
        push: (message, opts) => dbgPush(message, opts),
        isEnabled: () => !!_settings.enableDebug,
    });

    // Live point-in-time state, captured fresh whenever the Debug Log is
    // exported (never stored in _debugLog itself, which only holds the
    // timestamped event trail) \u2014 a support report saying "it's still not
    // working" is far easier to diagnose against a snapshot of what the
    // instance actually looks like RIGHT NOW than against the event log
    // alone, especially when the failure happened before anything even
    // got a chance to call dbgPush(). Scoped deliberately: every feature's
    // enabled/ok/error/disabled status (the single most useful signal for
    // "is something else interfering") plus a deeper Ghost++-specific dive
    // (the feature actually being actively debugged) and the small,
    // already-existing native-ghost-state read \u2014 not an attempt to dump
    // every other feature's own private internals, which would need
    // touching many files for uncertain benefit. Never includes anything
    // sensitive (auth tokens, user data) \u2014 only feature toggles, counts,
    // and DOM presence/visibility flags.
    function dbgCaptureStateSnapshot() {
        const snapshot = {
            capturedAt: new Date().toISOString(),
            version: VERSION,
            page: {
                url: location.href,
                userAgent: navigator.userAgent,
                readyState: document.readyState,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                darkMode: (() => { try { return isDarkMode(); } catch (_) { return null; } })(),
            },
            settings: _settings,
            featureStatus: _featureStatus,
        };
        if (typeof gppState !== 'undefined') {
            try {
                const nativeBtn = document.getElementById('loadGhostImageBtn');
                const modalEl = document.getElementById('gpp-modal');
                snapshot.ghostPlusPlus = {
                    settings: gppState.settings,
                    runtimeReady: gppState.runtimeReady,
                    templateCount: gppState.templates ? gppState.templates.length : null,
                    guildTemplateCount: gppState.guildTemplates ? gppState.guildTemplates.length : null,
                    focusedTemplateId: gppState.focusedTemplateId,
                    shimActive: (typeof gppShimActive !== 'undefined') ? gppShimActive : null,
                    openerMounted: !!document.getElementById('gpp-opener'),
                    nativeButtonFound: !!nativeBtn,
                    nativeButtonHidden: nativeBtn ? nativeBtn.classList.contains('hidden') : null,
                    modalMounted: !!modalEl,
                    modalCurrentlyOpen: modalEl ? !modalEl.classList.contains('gpp-hidden') : null,
                };
            } catch (err) {
                snapshot.ghostPlusPlus = { error: 'Failed to capture Ghost++ state: ' + (err && err.message ? err.message : String(err)) };
            }
            try {
                snapshot.nativeGhostState = (typeof gppReadNativeGhostSnapshot === 'function') ? gppReadNativeGhostSnapshot() : null;
            } catch (err) {
                snapshot.nativeGhostState = { error: 'Failed to read native ghost state: ' + (err && err.message ? err.message : String(err)) };
            }
        }
        return snapshot;
    }

    /** Downloads the current debug log (plus a live state snapshot) as a .txt file. */
    function dbgExport() {
        const lines = _debugLog.map(e => {
            let s = `[${e.timestamp}] ${e.message}`;
            if (e.uiComponent) s += `\n  UI Component : ${e.uiComponent}`;
            if (e.error)       s += `\n  Error        : ${e.error}`;
            if (e.stack)       s += `\n  Stack        :\n    ${e.stack.replace(/\n/g, '\n    ')}`;
            return s;
        });
        const sep = '\n' + '\u2500'.repeat(60) + '\n';
        const header = `GeoPixelcons++ Debug Log\nVersion : ${VERSION}\nGenerated: ${new Date().toISOString()}\nEntries  : ${_debugLog.length}\n${'='.repeat(60)}\n\n`;
        const body = _debugLog.length ? lines.join(sep) : '(No timestamped log entries recorded yet.)';
        let snapshotSection;
        try {
            snapshotSection = '\n\n' + '='.repeat(60) + '\nSTATE SNAPSHOT (captured just now, at export time)\n' + '='.repeat(60) + '\n' + JSON.stringify(dbgCaptureStateSnapshot(), null, 2) + '\n';
        } catch (err) {
            snapshotSection = '\n\n(Failed to capture state snapshot: ' + (err && err.message ? err.message : String(err)) + ')\n';
        }
        const blob = new Blob([header + body + snapshotSection], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `gpc-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { a.remove(); URL.revokeObjectURL(a.href); } catch (_) {} }, 1000);
    }

    let _themeEditor = null; // Populated by theme editor module
    let _regionScreenshot = null; // Populated by region screenshot module
    let _regionsHighscore = null; // Populated by regions highscore module
    let _mapMarkers = null; // Populated by map markers module
    let _blockedUsers = null; // Populated by blocked user list module

    // ─── Shared coord cache for screenshot/highscore flyouts ────────
    const COORD_CACHE_KEY = 'gpc_cachedCoords';
    const AUTO_SS_KEY = 'gpc_autoScreenshotEnabled';
    function loadCachedCoords() { try { return JSON.parse(localStorage.getItem(COORD_CACHE_KEY)); } catch { return null; } }
    function saveCachedCoords(c) { localStorage.setItem(COORD_CACHE_KEY, JSON.stringify(c)); }
    function isAutoScreenshotEnabled() { return localStorage.getItem(AUTO_SS_KEY) === '1'; }
    function setAutoScreenshot(on) { localStorage.setItem(AUTO_SS_KEY, on ? '1' : '0'); }

    const _featureStatus = {}; // key => 'ok' | 'error' | 'disabled'
    FEATURE_LIST.forEach(f => {
        _featureStatus[f.key] = _settings[f.key] ? 'pending' : 'disabled';
    });
    EXTENSION_LIST.forEach(f => {
        _featureStatus[f.key] = _settings[f.key] ? 'pending' : 'disabled';
    });

    // ============================================================
    //  DARK THEME DETECTION (Geopixels++ compatibility)
    // ============================================================
    function isDarkMode() {
        const gppSettings = localStorage.getItem('geo++_settings');
        if (gppSettings) {
            try {
                const parsed = JSON.parse(gppSettings);
                if (parsed.theme && parsed.theme !== 'system') {
                    return parsed.theme === 'simple_black';
                }
            } catch(e) {}
        }
        return document.body.classList.contains('dark') ||
               window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    // Theme-aware colors
    function t(light, dark) { return isDarkMode() ? dark : light; }

    // ============================================================
    //  UI: SETTINGS MODAL (Tabbed)
    // ============================================================
    function createSettingsModal() {
        // Remove existing
        const existing = document.getElementById('gpc-settings-modal');
        if (existing) { existing.remove(); return; }

        const dark = isDarkMode();
        const overlay = document.createElement('div');
        overlay.id = 'gpc-settings-modal';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 100000;
            background: rgba(0,0,0,0.5); display: flex;
            align-items: center; justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: ${dark ? '#1e1e2e' : '#ffffff'};
            color: ${dark ? '#cdd6f4' : '#1e293b'};
            border-radius: 12px; padding: 0; width: 460px; max-width: 95vw;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px 20px; display: flex; align-items: center;
            justify-content: space-between;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border-bottom: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
        `;
        header.innerHTML = `<span style="font-weight:700;font-size:16px;">⚙️ GeoPixelcons++</span>`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            background:none; border:none; font-size:18px; cursor:pointer;
            color:${dark ? '#a6adc8' : '#64748b'}; padding:4px 8px; border-radius:4px;
        `;
        closeBtn.onmouseenter = () => closeBtn.style.background = dark ? '#45475a' : '#e2e8f0';
        closeBtn.onmouseleave = () => closeBtn.style.background = 'none';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // Tab bar
        const tabBar = document.createElement('div');
        tabBar.style.cssText = `
            display: flex; background: ${dark ? '#1e1e2e' : '#ffffff'};
            border-bottom: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
        `;
        const tabs = ['Extensions', 'Keybindings'];
        const tabBtns = [];
        const tabPanels = [];

        tabs.forEach((tabName, i) => {
            const btn = document.createElement('button');
            btn.textContent = tabName;
            btn.style.cssText = `
                flex: 1; padding: 10px 16px; font-size: 13px; font-weight: 600;
                border: none; cursor: pointer; transition: 0.2s;
                background: ${i === 0 ? (dark ? '#1e1e2e' : '#ffffff') : (dark ? '#313244' : '#f1f5f9')};
                color: ${i === 0 ? (dark ? '#cdd6f4' : '#1e293b') : (dark ? '#6c7086' : '#94a3b8')};
                border-bottom: 2px solid ${i === 0 ? '#22c55e' : 'transparent'};
            `;
            btn.addEventListener('click', () => switchTab(i));
            tabBtns.push(btn);
            tabBar.appendChild(btn);
        });
        modal.appendChild(tabBar);

        function switchTab(idx) {
            tabBtns.forEach((b, i) => {
                const active = i === idx;
                b.style.background = active ? (dark ? '#1e1e2e' : '#ffffff') : (dark ? '#313244' : '#f1f5f9');
                b.style.color = active ? (dark ? '#cdd6f4' : '#1e293b') : (dark ? '#6c7086' : '#94a3b8');
                b.style.borderBottom = active ? '2px solid #22c55e' : '2px solid transparent';
            });
            tabPanels.forEach((p, i) => {
                p.style.display = i === idx ? 'block' : 'none';
            });
        }

        // Warning banner (hidden by default)
        const banner = document.createElement('div');
        banner.id = 'gpc-restart-banner';
        banner.style.cssText = `
            display: none; padding: 10px 20px;
            background: ${dark ? '#f9e2af33' : '#fef3c7'};
            color: ${dark ? '#f9e2af' : '#92400e'};
            font-size: 13px; font-weight: 600;
            border-bottom: 1px solid ${dark ? '#f9e2af44' : '#fde68a'};
        `;
        banner.textContent = '⚠️ Refresh the page to apply changes';
        modal.appendChild(banner);

        // ---- Floating tooltip helper ----
        let activeTooltip = null;
        function removeTooltip() {
            if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
        }

        function showTooltip(e, feature) {
            removeTooltip();
            const tip = document.createElement('div');
            tip.style.cssText = `
                position: fixed; z-index: 100001; padding: 12px 16px; border-radius: 8px;
                background: ${dark ? '#313244' : '#ffffff'}; color: ${dark ? '#cdd6f4' : '#1e293b'};
                box-shadow: 0 8px 24px rgba(0,0,0,0.25); font-size: 13px; max-width: 280px;
                border: 1px solid ${dark ? '#45475a' : '#e2e8f0'}; pointer-events: none;
            `;
            let html = `<div style="font-weight:700;margin-bottom:6px;">${feature.icon} ${feature.name}</div>`;
            html += `<div style="margin-bottom:6px;color:${dark ? '#a6adc8' : '#64748b'};">${feature.desc}</div>`;
            html += '<ul style="margin:0;padding-left:18px;">';
            feature.features.forEach(f => { html += `<li style="margin-bottom:2px;">${f}</li>`; });
            html += '</ul>';
            tip.innerHTML = html;
            document.body.appendChild(tip);
            // Position near cursor
            const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
            let tx = e.clientX + 12, ty = e.clientY + 12;
            if (tx + tipW > window.innerWidth - 8) tx = e.clientX - tipW - 12;
            if (ty + tipH > window.innerHeight - 8) ty = e.clientY - tipH - 12;
            tip.style.left = tx + 'px';
            tip.style.top = ty + 'px';
            activeTooltip = tip;
        }

        function showSimpleTooltip(e, text) {
            removeTooltip();
            const tip = document.createElement('div');
            tip.style.cssText = `
                position: fixed; z-index: 100001; padding: 10px 14px; border-radius: 8px;
                background: ${dark ? '#313244' : '#ffffff'}; color: ${dark ? '#cdd6f4' : '#1e293b'};
                box-shadow: 0 8px 24px rgba(0,0,0,0.25); font-size: 13px; max-width: 260px;
                border: 1px solid ${dark ? '#45475a' : '#e2e8f0'}; pointer-events: none; line-height: 1.5;
            `;
            tip.textContent = text;
            document.body.appendChild(tip);
            const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
            let tx = e.clientX + 12, ty = e.clientY + 12;
            if (tx + tipW > window.innerWidth - 8) tx = e.clientX - tipW - 12;
            if (ty + tipH > window.innerHeight - 8) ty = e.clientY - tipH - 12;
            tip.style.left = tx + 'px';
            tip.style.top = ty + 'px';
            activeTooltip = tip;
        }

        // ---- Navigate to a feature's UI element ----
        function navigateToFeature(key) {
            function flashEl(el) {
                if (!el) return;
                el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                el.style.transition = 'box-shadow .3s';
                el.style.boxShadow = '0 0 0 3px #facc15, 0 0 16px 4px rgba(250,204,21,.5)';
                setTimeout(() => { el.style.boxShadow = ''; setTimeout(() => { el.style.transition = ''; }, 300); }, 1500);
            }
            function flashAll(els) { els.forEach(el => flashEl(el)); }
            const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            const nav = {
                ghostPaletteSearch: () => {
                    // Open ghost modal, then flash the color search container
                    if (typeof _pw.toggleGhostModal === 'function') _pw.toggleGhostModal(true);
                    setTimeout(() => flashEl(document.querySelector('.color-search-container')), 400);
                },
                ghostTemplateManager: () => {
                    // Open ghost modal, then flash the toolbar buttons
                    if (typeof _pw.toggleGhostModal === 'function') _pw.toggleGhostModal(true);
                    setTimeout(() => flashAll(Array.from(document.querySelectorAll('.gp-to-btn'))), 400);
                },
                guildOverhaul: () => {
                    const guildBtn = document.querySelector('#guildMenuBtn');
                    if (guildBtn) guildBtn.click();
                },
                hidePaintMenu: () => {
                    flashEl(document.querySelector('#gpc-hide-paint-toggle'));
                },
                paintBrushSwap: () => {
                    flashEl(document.querySelector('#brush-swap-toggle'));
                },
                regionsHighscore: () => {
                    if (_regionsHighscore) _regionsHighscore.toggleSelectionMode();
                },
                regionScreenshot: () => {
                    if (_regionScreenshot) _regionScreenshot.toggleSelectionMode();
                },
                bulkPurchaseColors: () => {
                    if (typeof _pw.toggleProfile === 'function') _pw.toggleProfile();
                    setTimeout(() => flashEl(document.querySelector('#gp-bulk-profile-card')), 400);
                },
                profileColorsCollapse: () => {
                    const profileOverlay = document.getElementById('profileOverlay');
                    if (profileOverlay && profileOverlay.classList.contains('hidden') && typeof _pw.toggleProfile === 'function') {
                        _pw.toggleProfile();
                    }
                    setTimeout(() => flashEl(document.getElementById('userColorsContainer')), 400);
                },
                themeEditor: () => {
                    if (_themeEditor) _themeEditor.toggleModal();
                },
                extAutoHoverMenus: () => {
                    // No specific UI to navigate to
                },
                extGoToLastLocation: () => {
                    // No specific UI to navigate to
                },
                extPillHoverLabels: () => {
                    // No specific UI to navigate to
                },
                extJanitorView: () => {
                    const modBtn = document.getElementById('modGroupBtn');
                    if (modBtn) flashEl(modBtn);
                },
                extMapMovementLock: () => {
                    flashEl(document.getElementById('gpc-map-movement-lock-btn'));
                },
                extBlockedUsers: () => {
                    if (_blockedUsers) _blockedUsers.openModal();
                },
                extGuildSearch: () => {
                    flashEl(document.getElementById('gpc-guild-search-btn'));
                },
                extLogOutButton: () => {
                    flashEl(document.getElementById('gpc-logout-btn'));
                },
                mobilePaintingExtension: () => {
                    flashEl(document.getElementById('bottomControls'));
                },
            };
            const fn = nav[key];
            if (fn) fn();
        }

        const ghostPlusPlusDependentRows = new Set();

        function refreshGhostPlusPlusDependentRows() {
            const gray = !!_settings.ghostPlusPlus;
            ghostPlusPlusDependentRows.forEach((row) => {
                row.style.opacity = gray ? '0.58' : '';
                row.style.filter = gray ? 'grayscale(0.75)' : '';
            });
        }

        // ---- Helper: build a toggle row ----
        function buildToggleRow(f, showHelp) {
            const status = _featureStatus[f.key];
            const enabled = _settings[f.key] !== false;

            const row = document.createElement('div');
            row.dataset.featureKey = f.key;
            row.style.cssText = `
                display: flex; align-items: center; justify-content: space-between;
                padding: 10px 14px; border-radius: 8px;
                background: ${enabled
                    ? (status === 'error' ? (dark ? '#f9e2af22' : '#fefce8') : (dark ? '#a6e3a122' : '#f0fdf4'))
                    : (dark ? '#f38ba822' : '#fef2f2')};
                border: 1px solid ${enabled
                    ? (status === 'error' ? (dark ? '#f9e2af44' : '#fde68a') : (dark ? '#a6e3a144' : '#bbf7d0'))
                    : (dark ? '#f38ba844' : '#fecaca')};
                transition: all 0.2s;
            `;

            const labelWrap = document.createElement('div');
            labelWrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;min-width:0;';

            const iconSpan = document.createElement('span');
            iconSpan.textContent = f.icon;
            const nameSpan = document.createElement('span');
            nameSpan.textContent = f.name;
            nameSpan.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border-bottom:1px dashed ' + (dark ? '#6c7086' : '#94a3b8') + ';transition:color .15s,border-color .15s;';
            nameSpan.addEventListener('mouseenter', () => { nameSpan.style.color = '#3b82f6'; nameSpan.style.borderBottomColor = '#3b82f6'; });
            nameSpan.addEventListener('mouseleave', () => { nameSpan.style.color = ''; nameSpan.style.borderBottomColor = dark ? '#6c7086' : '#94a3b8'; });
            nameSpan.addEventListener('click', () => {
                overlay.remove();
                navigateToFeature(f.key);
            });
            labelWrap.appendChild(iconSpan);
            labelWrap.appendChild(nameSpan);

            if (showHelp && f.desc) {
                const helpBtn = document.createElement('span');
                helpBtn.textContent = '❓';
                helpBtn.style.cssText = 'cursor:help;font-size:14px;flex-shrink:0;margin-left:2px;';
                helpBtn.addEventListener('mouseenter', (ev) => showTooltip(ev, f));
                helpBtn.addEventListener('mouseleave', removeTooltip);
                labelWrap.appendChild(helpBtn);
            }

            // Toggle switch
            const toggle = document.createElement('label');
            toggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0; margin-left:8px;';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = enabled;
            input.style.cssText = 'opacity:0;width:0;height:0;';

            const slider = document.createElement('span');
            slider.style.cssText = `
                position:absolute; inset:0; border-radius:12px; transition:0.2s;
                background: ${enabled ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
            `;
            const knob = document.createElement('span');
            knob.style.cssText = `
                position:absolute; top:2px; left:${enabled ? '22px' : '2px'};
                width:20px; height:20px; border-radius:50%; transition:0.2s;
                background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            `;
            slider.appendChild(knob);

            input.addEventListener('change', () => {
                _settings[f.key] = input.checked;
                saveSettings(_settings);
                slider.style.background = input.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
                knob.style.left = input.checked ? '22px' : '2px';
                row.style.background = input.checked
                    ? (dark ? '#a6e3a122' : '#f0fdf4')
                    : (dark ? '#f38ba822' : '#fef2f2');
                row.style.borderColor = input.checked
                    ? (dark ? '#a6e3a144' : '#bbf7d0')
                    : (dark ? '#f38ba844' : '#fecaca');
                if (f.key === 'ghostPlusPlus') refreshGhostPlusPlusDependentRows();
                banner.style.display = 'block';
            });

            toggle.appendChild(input);
            toggle.appendChild(slider);

            row.appendChild(labelWrap);
            row.appendChild(toggle);
            if (f.ghostPlusPlusGray) {
                row.dataset.deprecated = 'true';
                ghostPlusPlusDependentRows.add(row);
                refreshGhostPlusPlusDependentRows();
            }
            return row;
        }

        // Former GPC Settings rows now live beside extension rows. Keep their
        // enabled/disabled surface colors identical to the standard rows.
        function styleStandaloneExtensionRow(row) {
            const input = row.querySelector('input[type="checkbox"]');
            if (!input) return;
            const sync = () => {
                const enabled = !!input.checked;
                row.style.background = enabled
                    ? (dark ? '#a6e3a122' : '#f0fdf4')
                    : (dark ? '#f38ba822' : '#fef2f2');
                row.style.borderColor = enabled
                    ? (dark ? '#a6e3a144' : '#bbf7d0')
                    : (dark ? '#f38ba844' : '#fecaca');
            };
            sync();
            input.addEventListener('change', sync);
        }

        // ============ TAB 1: Extensions ============
        const extPanel = document.createElement('div');
        extPanel.style.cssText = 'padding: 12px 20px; display: flex; flex-direction: column; gap: 14px; max-height: 50vh; overflow-y: auto;';
        const extensionDefinitions = new Map([...FEATURE_LIST, ...EXTENSION_LIST].map((feature) => [feature.key, feature]));
        const extensionRowsByKey = new Map();
        const extensionCategoryPanels = new Map();

        EXTENSION_CATEGORIES.forEach((category) => {
            const section = document.createElement('section');
            section.style.cssText = `display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;background:${dark ? '#181825' : '#f8fafc'};border:1px solid ${dark ? '#313244' : '#e2e8f0'};`;
            const heading = document.createElement('div');
            heading.style.cssText = `font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${dark ? '#a6adc8' : '#64748b'};padding:0 4px 2px;`;
            heading.textContent = category.name;
            section.appendChild(heading);
            category.keys.forEach((key) => {
                const feature = extensionDefinitions.get(key);
                if (!feature) return;
                const row = buildToggleRow(feature, true);
                extensionRowsByKey.set(key, row);
                section.appendChild(row);
            });
            extensionCategoryPanels.set(category.name, section);
            extPanel.appendChild(section);
        });

        const deprecatedSection = extensionCategoryPanels.get('Deprecated');

        tabPanels.push(extPanel);
        modal.appendChild(extPanel);

        // Former GPC Settings rows are appended to their purpose-based
        // Extensions sections below as they are constructed.
        const miscSettingsSection = extensionCategoryPanels.get('Misc');

        // Emoji icon toggle
        const emojiRow = document.createElement('div');
        emojiRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-radius: 8px;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
        `;
        const emojiLabel = document.createElement('div');
        emojiLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;';
        emojiLabel.innerHTML = '<span>😢</span><span>Use emoji for menu button</span>';
        const emojiHelp = document.createElement('span');
        emojiHelp.textContent = '❓';
        emojiHelp.style.cssText = 'cursor:help;font-size:12px;flex-shrink:0;margin-left:4px;opacity:0.6;';
        emojiHelp.addEventListener('mouseenter', (ev) => showSimpleTooltip(ev, 'When enabled, replaces the GeoPixelcons++ button icon with the 😢 emoji.'));
        emojiHelp.addEventListener('mouseleave', removeTooltip);
        emojiLabel.appendChild(emojiHelp);

        const emojiToggle = document.createElement('label');
        emojiToggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;';
        const emojiInput = document.createElement('input');
        emojiInput.type = 'checkbox';
        emojiInput.checked = !!_settings.useEmojiIcon;
        emojiInput.style.cssText = 'opacity:0;width:0;height:0;';
        const emojiSlider = document.createElement('span');
        emojiSlider.style.cssText = `
            position:absolute; inset:0; border-radius:12px; transition:0.2s;
            background: ${_settings.useEmojiIcon ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
        `;
        const emojiKnob = document.createElement('span');
        emojiKnob.style.cssText = `
            position:absolute; top:2px; left:${_settings.useEmojiIcon ? '22px' : '2px'};
            width:20px; height:20px; border-radius:50%; transition:0.2s;
            background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        `;
        emojiSlider.appendChild(emojiKnob);

        emojiInput.addEventListener('change', () => {
            _settings.useEmojiIcon = emojiInput.checked;
            saveSettings(_settings);
            emojiSlider.style.background = emojiInput.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
            emojiKnob.style.left = emojiInput.checked ? '22px' : '2px';
            // Live-update the button
            const mainBtn = document.getElementById('geopixelconsGroupBtn');
            if (mainBtn) {
                if (emojiInput.checked) {
                    mainBtn.style.backgroundImage = 'none';
                    mainBtn.textContent = '😢';
                    mainBtn.style.fontSize = '20px';
                } else {
                    mainBtn.textContent = '';
                    mainBtn.style.fontSize = '';
                    mainBtn.style.backgroundImage = mainBtn.dataset.iconBg || '';
                }
            }
        });

        emojiToggle.appendChild(emojiInput);
        emojiToggle.appendChild(emojiSlider);
        emojiRow.appendChild(emojiLabel);
        emojiRow.appendChild(emojiToggle);
        miscSettingsSection.appendChild(emojiRow);

        // Compact paint overflow toggle
        const compactRow = document.createElement('div');
        compactRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-radius: 8px;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            margin-top: 4px;
        `;
        const compactLabel = document.createElement('div');
        compactLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;';
        compactLabel.innerHTML = '<span>🖌️</span><span>Compact paint controls</span>';
        const compactHelp = document.createElement('span');
        compactHelp.textContent = '❓';
        compactHelp.style.cssText = 'cursor:help;font-size:12px;flex-shrink:0;margin-left:4px;opacity:0.6;';
        compactHelp.addEventListener('mouseenter', (ev) => showSimpleTooltip(ev, 'Moves the ✕ close button and 🖌️ brushes button from inside the paint modal to compact icons above it, alongside the collapse/drag controls. Helps on small or zoomed-in screens.'));
        compactHelp.addEventListener('mouseleave', removeTooltip);
        compactLabel.appendChild(compactHelp);

        const compactToggle = document.createElement('label');
        compactToggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;';
        const compactInput = document.createElement('input');
        compactInput.type = 'checkbox';
        compactInput.checked = !!_settings.compactPaintOverflow;
        compactInput.style.cssText = 'opacity:0;width:0;height:0;';
        const compactSlider = document.createElement('span');
        compactSlider.style.cssText = `
            position:absolute; inset:0; border-radius:12px; transition:0.2s;
            background: ${_settings.compactPaintOverflow ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
        `;
        const compactKnob = document.createElement('span');
        compactKnob.style.cssText = `
            position:absolute; top:2px; left:${_settings.compactPaintOverflow ? '22px' : '2px'};
            width:20px; height:20px; border-radius:50%; transition:0.2s;
            background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        `;
        compactSlider.appendChild(compactKnob);

        compactInput.addEventListener('change', () => {
            _settings.compactPaintOverflow = compactInput.checked;
            saveSettings(_settings);
            compactSlider.style.background = compactInput.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
            compactKnob.style.left = compactInput.checked ? '22px' : '2px';
            banner.style.display = 'block';
        });

        compactToggle.appendChild(compactInput);
        compactToggle.appendChild(compactSlider);
        compactRow.appendChild(compactLabel);
        compactRow.appendChild(compactToggle);
        miscSettingsSection.appendChild(compactRow);

        // Disable Group Noise toggle
        const noiseRow = document.createElement('div');
        noiseRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-radius: 8px;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            margin-top: 4px;
        `;
        const noiseLabel = document.createElement('div');
        noiseLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;';
        noiseLabel.innerHTML = '<span>🚫</span><span>Disable Group Noise</span>';
        const noiseHelp = document.createElement('span');
        noiseHelp.textContent = '❓';
        noiseHelp.style.cssText = 'cursor:help;font-size:12px;flex-shrink:0;margin-left:4px;opacity:0.6;';
        noiseHelp.addEventListener('mouseenter', (ev) => showSimpleTooltip(ev, 'Permanently unchecks and hides the "Group Noise" toggle in the ghost template modal. Prevents automatic color grouping so every unique color is treated individually.'));
        noiseHelp.addEventListener('mouseleave', removeTooltip);
        noiseLabel.appendChild(noiseHelp);

        const noiseToggle = document.createElement('label');
        noiseToggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;';
        const noiseInput = document.createElement('input');
        noiseInput.type = 'checkbox';
        noiseInput.checked = !!_settings.disableGroupNoise;
        noiseInput.style.cssText = 'opacity:0;width:0;height:0;';
        const noiseSlider = document.createElement('span');
        noiseSlider.style.cssText = `
            position:absolute; inset:0; border-radius:12px; transition:0.2s;
            background: ${_settings.disableGroupNoise ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
        `;
        const noiseKnob = document.createElement('span');
        noiseKnob.style.cssText = `
            position:absolute; top:2px; left:${_settings.disableGroupNoise ? '22px' : '2px'};
            width:20px; height:20px; border-radius:50%; transition:0.2s;
            background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        `;
        noiseSlider.appendChild(noiseKnob);

        noiseInput.addEventListener('change', () => {
            _settings.disableGroupNoise = noiseInput.checked;
            saveSettings(_settings);
            noiseSlider.style.background = noiseInput.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
            noiseKnob.style.left = noiseInput.checked ? '22px' : '2px';
            banner.style.display = 'block';
        });

        noiseToggle.appendChild(noiseInput);
        noiseToggle.appendChild(noiseSlider);
        noiseRow.appendChild(noiseLabel);
        noiseRow.appendChild(noiseToggle);
        miscSettingsSection.appendChild(noiseRow);

        // Start in Shift Lock toggle
        const shiftRow = document.createElement('div');
        shiftRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-radius: 8px;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            margin-top: 4px;
        `;
        const shiftLabel = document.createElement('div');
        shiftLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;';
        shiftLabel.innerHTML = '<span>\uD83D\uDD12</span><span>Start in Shift Lock</span>';
        const shiftHelp = document.createElement('span');
        shiftHelp.textContent = '❓';
        shiftHelp.style.cssText = 'cursor:help;font-size:12px;flex-shrink:0;margin-left:4px;opacity:0.6;';
        shiftHelp.addEventListener('mouseenter', (ev) => showSimpleTooltip(ev, 'Automatically enables Shift Lock on page load so you can paint without holding Shift.'));
        shiftHelp.addEventListener('mouseleave', removeTooltip);
        shiftLabel.appendChild(shiftHelp);

        const shiftToggle = document.createElement('label');
        shiftToggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;';
        const shiftInput = document.createElement('input');
        shiftInput.type = 'checkbox';
        shiftInput.checked = !!_settings.startShiftLock;
        shiftInput.style.cssText = 'opacity:0;width:0;height:0;';
        const shiftSlider = document.createElement('span');
        shiftSlider.style.cssText = `
            position:absolute; inset:0; border-radius:12px; transition:0.2s;
            background: ${_settings.startShiftLock ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
        `;
        const shiftKnob = document.createElement('span');
        shiftKnob.style.cssText = `
            position:absolute; top:2px; left:${_settings.startShiftLock ? '22px' : '2px'};
            width:20px; height:20px; border-radius:50%; transition:0.2s;
            background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        `;
        shiftSlider.appendChild(shiftKnob);

        shiftInput.addEventListener('change', () => {
            _settings.startShiftLock = shiftInput.checked;
            saveSettings(_settings);
            shiftSlider.style.background = shiftInput.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
            shiftKnob.style.left = shiftInput.checked ? '22px' : '2px';
        });

        shiftToggle.appendChild(shiftInput);
        shiftToggle.appendChild(shiftSlider);
        shiftRow.appendChild(shiftLabel);
        shiftRow.appendChild(shiftToggle);
        miscSettingsSection.appendChild(shiftRow);

        // Start in Inspect Mode toggle
        const inspectRow = document.createElement('div');
        inspectRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-radius: 8px;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            margin-top: 4px;
        `;
        const inspectLabel = document.createElement('div');
        inspectLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;';
        inspectLabel.innerHTML = '<span>\uD83D\uDD0D</span><span>Start in Inspect Mode</span>';
        const inspectHelp = document.createElement('span');
        inspectHelp.textContent = '❓';
        inspectHelp.style.cssText = 'cursor:help;font-size:12px;flex-shrink:0;margin-left:4px;opacity:0.6;';
        inspectHelp.addEventListener('mouseenter', (ev) => showSimpleTooltip(ev, 'Automatically switches to Inspect Mode on page load instead of starting in Paint (Action) mode.'));
        inspectHelp.addEventListener('mouseleave', removeTooltip);
        inspectLabel.appendChild(inspectHelp);

        const inspectToggle = document.createElement('label');
        inspectToggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;';
        const inspectInput = document.createElement('input');
        inspectInput.type = 'checkbox';
        inspectInput.checked = !!_settings.startInspectMode;
        inspectInput.style.cssText = 'opacity:0;width:0;height:0;';
        const inspectSlider = document.createElement('span');
        inspectSlider.style.cssText = `
            position:absolute; inset:0; border-radius:12px; transition:0.2s;
            background: ${_settings.startInspectMode ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
        `;
        const inspectKnob = document.createElement('span');
        inspectKnob.style.cssText = `
            position:absolute; top:2px; left:${_settings.startInspectMode ? '22px' : '2px'};
            width:20px; height:20px; border-radius:50%; transition:0.2s;
            background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        `;
        inspectSlider.appendChild(inspectKnob);

        inspectInput.addEventListener('change', () => {
            _settings.startInspectMode = inspectInput.checked;
            saveSettings(_settings);
            inspectSlider.style.background = inspectInput.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
            inspectKnob.style.left = inspectInput.checked ? '22px' : '2px';
        });

        inspectToggle.appendChild(inspectInput);
        inspectToggle.appendChild(inspectSlider);
        inspectRow.appendChild(inspectLabel);
        inspectRow.appendChild(inspectToggle);
        miscSettingsSection.appendChild(inspectRow);

        // Smooth Zoom Buttons toggle
        const smoothZoomRow = document.createElement('div');
        smoothZoomRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-radius: 8px;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            margin-top: 4px;
        `;
        const smoothZoomLabel = document.createElement('div');
        smoothZoomLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;';
        smoothZoomLabel.innerHTML = '<span>🔢</span><span>Smooth Zoom Buttons</span>';
        const smoothZoomHelp = document.createElement('span');
        smoothZoomHelp.textContent = '❓';
        smoothZoomHelp.style.cssText = 'cursor:help;font-size:12px;flex-shrink:0;margin-left:4px;opacity:0.6;';
        smoothZoomHelp.addEventListener('mouseenter', (ev) => showSimpleTooltip(ev, 'Replaces the +/\u2212 zoom buttons with a smooth zoom control: vertical slider, exact value input, hold-to-repeat \u00b1 buttons, and scroll-wheel zoom on the widget.'));
        smoothZoomHelp.addEventListener('mouseleave', removeTooltip);
        smoothZoomLabel.appendChild(smoothZoomHelp);

        const smoothZoomToggle = document.createElement('label');
        smoothZoomToggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;';
        const smoothZoomInput = document.createElement('input');
        smoothZoomInput.type = 'checkbox';
        smoothZoomInput.checked = !!_settings.smoothZoomButtons;
        smoothZoomInput.style.cssText = 'opacity:0;width:0;height:0;';
        const smoothZoomSlider = document.createElement('span');
        smoothZoomSlider.style.cssText = `
            position:absolute; inset:0; border-radius:12px; transition:0.2s;
            background: ${_settings.smoothZoomButtons ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
        `;
        const smoothZoomKnob = document.createElement('span');
        smoothZoomKnob.style.cssText = `
            position:absolute; top:2px; left:${_settings.smoothZoomButtons ? '22px' : '2px'};
            width:20px; height:20px; border-radius:50%; transition:0.2s;
            background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        `;
        smoothZoomSlider.appendChild(smoothZoomKnob);

        smoothZoomInput.addEventListener('change', () => {
            _settings.smoothZoomButtons = smoothZoomInput.checked;
            saveSettings(_settings);
            smoothZoomSlider.style.background = smoothZoomInput.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
            smoothZoomKnob.style.left = smoothZoomInput.checked ? '22px' : '2px';
            banner.style.display = 'block';
        });

        smoothZoomToggle.appendChild(smoothZoomInput);
        smoothZoomToggle.appendChild(smoothZoomSlider);
        smoothZoomRow.appendChild(smoothZoomLabel);
        smoothZoomRow.appendChild(smoothZoomToggle);
        const mapCategoryPanel = extensionCategoryPanels.get('Map');
        if (mapCategoryPanel) {
            const movementRow = extensionRowsByKey.get('extMapMovementLock');
            if (movementRow) movementRow.insertAdjacentElement('afterend', smoothZoomRow);
            else mapCategoryPanel.appendChild(smoothZoomRow);
        }

        // Enable Debugging toggle
        const debugRow = document.createElement('div');
        debugRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-radius: 8px;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            margin-top: 4px;
        `;
        const debugLabel = document.createElement('div');
        debugLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;';
        debugLabel.innerHTML = '<span>🔶</span><span>Enable Debugging</span>';
        const debugHelp = document.createElement('span');
        debugHelp.textContent = '❓';
        debugHelp.style.cssText = 'cursor:help;font-size:12px;flex-shrink:0;margin-left:4px;opacity:0.6;';
        debugHelp.addEventListener('mouseenter', (ev) => showSimpleTooltip(ev, 'When enabled, errors are recorded in memory and a Debug Logs button appears in the dropdown. Click it to export a log file. Refresh the page after toggling.'));
        debugHelp.addEventListener('mouseleave', removeTooltip);
        debugLabel.appendChild(debugHelp);

        const debugToggle = document.createElement('label');
        debugToggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;';
        const debugInput = document.createElement('input');
        debugInput.type = 'checkbox';
        debugInput.checked = !!_settings.enableDebug;
        debugInput.style.cssText = 'opacity:0;width:0;height:0;';
        const debugSlider = document.createElement('span');
        debugSlider.style.cssText = `
            position:absolute; inset:0; border-radius:12px; transition:0.2s;
            background: ${_settings.enableDebug ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
        `;
        const debugKnob = document.createElement('span');
        debugKnob.style.cssText = `
            position:absolute; top:2px; left:${_settings.enableDebug ? '22px' : '2px'};
            width:20px; height:20px; border-radius:50%; transition:0.2s;
            background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        `;
        debugSlider.appendChild(debugKnob);

        debugInput.addEventListener('change', () => {
            _settings.enableDebug = debugInput.checked;
            saveSettings(_settings);
            debugSlider.style.background = debugInput.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
            debugKnob.style.left = debugInput.checked ? '22px' : '2px';
            banner.style.display = 'block';
        });

        debugToggle.appendChild(debugInput);
        debugToggle.appendChild(debugSlider);
        debugRow.appendChild(debugLabel);
        debugRow.appendChild(debugToggle);
        miscSettingsSection.appendChild(debugRow);

        // Ghost Menu UI Overhaul toggle (deprecated)
        const modernBtnsRow = document.createElement('div');
        modernBtnsRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-radius: 8px;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            margin-top: 4px;
        `;
        const modernBtnsLabel = document.createElement('div');
        modernBtnsLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;';
        modernBtnsLabel.innerHTML = '<span>🎛️</span><span>Ghost Menu UI Overhaul</span>';
        const modernBtnsHelp = document.createElement('span');
        modernBtnsHelp.textContent = '❓';
        modernBtnsHelp.style.cssText = 'cursor:help;font-size:12px;flex-shrink:0;margin-left:4px;opacity:0.6;';
        modernBtnsHelp.addEventListener('mouseenter', (ev) => showSimpleTooltip(ev, 'Requires Ghost Template Manager. Removes the ✚₊ collapse toggle added by geopixels++, shows all its hidden buttons permanently, and applies consistent flat styling to every action button in the ghost palette panel.'));
        modernBtnsHelp.addEventListener('mouseleave', removeTooltip);
        modernBtnsLabel.appendChild(modernBtnsHelp);

        const modernBtnsToggle = document.createElement('label');
        modernBtnsToggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;';
        const modernBtnsInput = document.createElement('input');
        modernBtnsInput.type = 'checkbox';
        modernBtnsInput.checked = !!_settings.modernizeGhostPaletteBtns;
        modernBtnsInput.style.cssText = 'opacity:0;width:0;height:0;';
        const modernBtnsSlider = document.createElement('span');
        modernBtnsSlider.style.cssText = `
            position:absolute; inset:0; border-radius:12px; transition:0.2s;
            background: ${_settings.modernizeGhostPaletteBtns ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
        `;
        const modernBtnsKnob = document.createElement('span');
        modernBtnsKnob.style.cssText = `
            position:absolute; top:2px; left:${_settings.modernizeGhostPaletteBtns ? '22px' : '2px'};
            width:20px; height:20px; border-radius:50%; transition:0.2s;
            background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        `;
        modernBtnsSlider.appendChild(modernBtnsKnob);

        modernBtnsInput.addEventListener('change', () => {
            _settings.modernizeGhostPaletteBtns = modernBtnsInput.checked;
            saveSettings(_settings);
            modernBtnsSlider.style.background = modernBtnsInput.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
            modernBtnsKnob.style.left = modernBtnsInput.checked ? '22px' : '2px';
            banner.style.display = 'block';
        });

        modernBtnsToggle.appendChild(modernBtnsInput);
        modernBtnsToggle.appendChild(modernBtnsSlider);
        modernBtnsRow.appendChild(modernBtnsLabel);
        modernBtnsRow.appendChild(modernBtnsToggle);
        modernBtnsRow.dataset.deprecated = 'true';
        ghostPlusPlusDependentRows.add(modernBtnsRow);
        refreshGhostPlusPlusDependentRows();
        deprecatedSection.appendChild(modernBtnsRow);

        // Remember ghost template modal position & size toggle
        const ghostPosRow = document.createElement('div');
        ghostPosRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-radius: 8px;
            background: ${dark ? '#313244' : '#f1f5f9'};
            border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            margin-top: 4px;
        `;
        const ghostPosLabel = document.createElement('div');
        ghostPosLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;';
        ghostPosLabel.innerHTML = '<span>📌</span><span>Remember ghost template position and size</span>';
        const ghostPosHelp = document.createElement('span');
        ghostPosHelp.textContent = '❓';
        ghostPosHelp.style.cssText = 'cursor:help;font-size:12px;flex-shrink:0;margin-left:4px;opacity:0.6;';
        ghostPosHelp.addEventListener('mouseenter', (ev) => showSimpleTooltip(ev, 'When enabled, saves and restores the ghost template modal\'s on-screen position and size across page refreshes and re-opens. Requires Ghost Template Manager.'));
        ghostPosHelp.addEventListener('mouseleave', removeTooltip);
        ghostPosLabel.appendChild(ghostPosHelp);

        const ghostPosToggle = document.createElement('label');
        ghostPosToggle.style.cssText = 'position:relative; width:44px; height:24px; cursor:pointer; flex-shrink:0;';
        const ghostPosInput = document.createElement('input');
        ghostPosInput.type = 'checkbox';
        ghostPosInput.checked = !!_settings.rememberGhostModalPos;
        ghostPosInput.style.cssText = 'opacity:0;width:0;height:0;';
        const ghostPosSlider = document.createElement('span');
        ghostPosSlider.style.cssText = `
            position:absolute; inset:0; border-radius:12px; transition:0.2s;
            background: ${_settings.rememberGhostModalPos ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1')};
        `;
        const ghostPosKnob = document.createElement('span');
        ghostPosKnob.style.cssText = `
            position:absolute; top:2px; left:${_settings.rememberGhostModalPos ? '22px' : '2px'};
            width:20px; height:20px; border-radius:50%; transition:0.2s;
            background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        `;
        ghostPosSlider.appendChild(ghostPosKnob);

        ghostPosInput.addEventListener('change', () => {
            _settings.rememberGhostModalPos = ghostPosInput.checked;
            saveSettings(_settings);
            ghostPosSlider.style.background = ghostPosInput.checked ? '#22c55e' : (dark ? '#585b70' : '#cbd5e1');
            ghostPosKnob.style.left = ghostPosInput.checked ? '22px' : '2px';
        });

        ghostPosToggle.appendChild(ghostPosInput);
        ghostPosToggle.appendChild(ghostPosSlider);
        ghostPosRow.appendChild(ghostPosLabel);
        ghostPosRow.appendChild(ghostPosToggle);
        deprecatedSection.appendChild(ghostPosRow);
        ghostPlusPlusDependentRows.add(ghostPosRow);
        refreshGhostPlusPlusDependentRows();

        [emojiRow, compactRow, noiseRow, shiftRow, inspectRow, smoothZoomRow, debugRow, modernBtnsRow, ghostPosRow]
            .forEach(styleStandaloneExtensionRow);

        // ============ TAB 2: Keybindings ============
        const kbPanel = document.createElement('div');
        kbPanel.style.cssText = 'padding: 12px 20px; display: none;';

        const GPC_KEYBINDS = [
            { key: 'openSettings',    label: 'Open GeoPixelcons++ Settings', defKey: 'P', defCtrl: true, defShift: true },
            { key: 'mapMovementLock', label: 'Toggle Map Movement Lock',      defKey: 'L', defCtrl: true, defShift: true },
        ];

        const kbInputs = {};

        GPC_KEYBINDS.forEach(({ key, label, defKey, defCtrl, defShift }) => {
            const cur = (_settings.keybinds && _settings.keybinds[key]) || { key: defKey, ctrl: defCtrl, shift: defShift };

            const row = document.createElement('div');
            row.style.cssText = `
                padding: 10px 14px; border-radius: 8px;
                background: ${dark ? '#313244' : '#f1f5f9'};
                border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
                margin-bottom: 8px;
            `;

            const rowLabel = document.createElement('div');
            rowLabel.style.cssText = `font-size:13px;font-weight:600;margin-bottom:8px;color:${dark ? '#cdd6f4' : '#1e293b'};`;
            rowLabel.textContent = label;

            const controlsRow = document.createElement('div');
            controlsRow.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;';

            // Ctrl checkbox
            const ctrlLabelEl = document.createElement('label');
            ctrlLabelEl.style.cssText = `display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;color:${dark ? '#cdd6f4' : '#1e293b'};`;
            const ctrlCb = document.createElement('input');
            ctrlCb.type = 'checkbox'; ctrlCb.checked = !!cur.ctrl;
            ctrlLabelEl.appendChild(ctrlCb);
            ctrlLabelEl.appendChild(Object.assign(document.createElement('span'), { textContent: 'Ctrl' }));

            // Shift checkbox
            const shiftLabelEl = document.createElement('label');
            shiftLabelEl.style.cssText = ctrlLabelEl.style.cssText;
            const shiftCb = document.createElement('input');
            shiftCb.type = 'checkbox'; shiftCb.checked = !!cur.shift;
            shiftLabelEl.appendChild(shiftCb);
            shiftLabelEl.appendChild(Object.assign(document.createElement('span'), { textContent: 'Shift' }));

            // Key text input
            const keyWrap = document.createElement('label');
            keyWrap.style.cssText = `display:flex;align-items:center;gap:6px;font-size:13px;color:${dark ? '#cdd6f4' : '#1e293b'};`;
            keyWrap.appendChild(Object.assign(document.createElement('span'), { textContent: 'Key:' }));
            const keyIn = document.createElement('input');
            keyIn.type = 'text'; keyIn.maxLength = 1;
            keyIn.value = (cur.key || defKey).toUpperCase();
            keyIn.style.cssText = `
                width:36px; padding:4px 8px; border-radius:5px; text-align:center;
                text-transform:uppercase; font-family:monospace; font-size:13px; font-weight:700;
                border:1px solid ${dark ? '#45475a' : '#d1d5db'};
                background:${dark ? '#181825' : '#fff'};
                color:${dark ? '#cdd6f4' : '#1e293b'};
            `;
            keyIn.addEventListener('input', () => {
                keyIn.value = keyIn.value.replace(/[^a-zA-Z0-9]/g, '').slice(-1).toUpperCase();
                updatePreview();
            });
            keyWrap.appendChild(keyIn);

            // Live preview of the combo
            const previewEl = document.createElement('span');
            previewEl.style.cssText = `font-size:11px;color:${dark ? '#6c7086' : '#94a3b8'};font-family:monospace;`;
            function updatePreview() {
                const parts = [];
                if (ctrlCb.checked) parts.push('Ctrl');
                if (shiftCb.checked) parts.push('Shift');
                if (keyIn.value) parts.push(keyIn.value.toUpperCase());
                previewEl.textContent = parts.length ? '→ ' + parts.join('+') : '';
            }
            ctrlCb.addEventListener('change', updatePreview);
            shiftCb.addEventListener('change', updatePreview);
            updatePreview();

            controlsRow.appendChild(ctrlLabelEl);
            controlsRow.appendChild(shiftLabelEl);
            controlsRow.appendChild(keyWrap);
            controlsRow.appendChild(previewEl);
            row.appendChild(rowLabel);
            row.appendChild(controlsRow);
            kbPanel.appendChild(row);
            kbInputs[key] = { ctrlEl: ctrlCb, shiftEl: shiftCb, keyEl: keyIn };
        });

        const kbSaveBtn = document.createElement('button');
        kbSaveBtn.textContent = '💾 Save Shortcuts';
        kbSaveBtn.style.cssText = `
            width: 100%; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer;
            background: #22c55e; color: #fff; font-size: 14px; font-weight: 600;
            transition: opacity 0.15s; margin-top: 4px;
        `;
        kbSaveBtn.onmouseover = () => { kbSaveBtn.style.opacity = '0.85'; };
        kbSaveBtn.onmouseleave = () => { kbSaveBtn.style.opacity = '1'; };
        kbSaveBtn.onclick = () => {
            if (!_settings.keybinds) _settings.keybinds = {};
            GPC_KEYBINDS.forEach(({ key }) => {
                const { ctrlEl, shiftEl, keyEl } = kbInputs[key];
                _settings.keybinds[key] = {
                    ctrl: ctrlEl.checked,
                    shift: shiftEl.checked,
                    key: (keyEl.value || '').toUpperCase().slice(0, 1),
                };
            });
            saveSettings(_settings);
            banner.style.display = 'block';
            kbSaveBtn.textContent = '✅ Saved!';
            setTimeout(() => { kbSaveBtn.textContent = '💾 Save Shortcuts'; }, 2000);
        };
        kbPanel.appendChild(kbSaveBtn);

        tabPanels.push(kbPanel);
        modal.appendChild(kbPanel);

        // Footer
        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 12px 20px;
            background: ${dark ? '#313244' : '#f8fafc'};
            border-top: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            font-size: 11px;
            color: ${dark ? '#6c7086' : '#94a3b8'};
            text-align: center;
        `;
        footer.textContent = 'GeoPixelcons++ v' + VERSION;
        modal.appendChild(footer);

        overlay.appendChild(modal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { removeTooltip(); overlay.remove(); }
        });
        document.body.appendChild(overlay);
    }

    // Open the actual Settings modal from anywhere on the page. Capture phase
    // prevents GeoPixels' single-key shortcut handler from also consuming the key.
    document.addEventListener('keydown', (e) => {
        if (e.repeat || e.altKey || e.metaKey) return;
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

        const kb = {
            ...DEFAULT_SETTINGS.keybinds.openSettings,
            ...((_settings.keybinds && _settings.keybinds.openSettings) || {}),
        };
        const key = kb.key || DEFAULT_SETTINGS.keybinds.openSettings.key;
        if (kb.ctrl !== e.ctrlKey || kb.shift !== e.shiftKey) return;
        if (e.key.toUpperCase() !== key.toUpperCase()) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        createSettingsModal();
    }, true);

    // ============================================================
    //  UI: CHANGELOG MODAL
    // ============================================================
    const CHANGELOG = [
        {
            version: '2.10.0',
            date: '2026-08-23',
            items: [
                { type: 'added', text: 'Blocked User List: new 🚷 Blocked Users entry in the GeoPixelcons++ menu lets you hide pixels placed by specific players, so griefed areas stop showing on your screen' },
                { type: 'added', text: 'Blocked User List: Highlight mode tints a blocked user\'s pixels red instead of hiding them, which is usually more useful for spotting and reporting griefing' },
                { type: 'added', text: 'Blocked User List: click any pixel, then hit the 🚷 button next to Report in the pixel info panel to queue that player in the block list, ready to confirm — or add them directly by user ID' },
            ]
        },
        {
            version: '2.9.1',
            date: '2026-08-20',
            items: [
                { type: 'fixed', text: 'Painting Menu Overhaul: restored the "or load from a URL" option in the template upload panel (it was hidden and also boxed in an unwanted background)' },
            ]
        },
        {
            version: '2.9.0',
            date: '2026-08-19',
            items: [
                { type: 'added', text: 'Painting Menu Overhaul: new "Use manual palette" checkbox (under the template preview\'s upload panel) shows your own color palette instead of the focused Ghost++ template\'s colors, and always stays in sync with your profile page\'s color toggles' },
                { type: 'fixed', text: 'Painting Menu Overhaul: tapping a template color you don\'t own now shows a brief red X over it and an alert instead of silently failing to select it, and no longer marks it as selected' },
                { type: 'fixed', text: 'Painting Menu Overhaul: the Filter dropdown no longer closes after picking one option, so multiple filters can be selected in one open' },
                { type: 'changed', text: 'Painting Menu Overhaul: restyled the top control bar (color readout, eyedropper/brush/shift-lock, Paint, saved brushes, charge timer, energy) to match the rest of this feature\'s own look, including matching font sizes and button padding' },
                { type: 'fixed', text: 'Painting Menu Overhaul: reduced the gap between the top control bar and the row below it to 5px' },
                { type: 'changed', text: 'Paint Menu Controls: reduced the scaled panel\'s own outer padding by 20%' },
            ]
        },
        {
            version: '2.8.0',
            date: '2026-08-18',
            items: [
                { type: 'changed', text: 'GeoPixelcons++ Settings: Extensions are now organized into Painting, Ghost Template, Map, Menuing, and Misc categories' },
                { type: 'changed', text: 'GeoPixelcons++ Settings: renamed Paint Brush Overhaul and Ghost++, replaced the misleading Painting Menu Overhaul icon, and marked superseded Ghost controls as deprecated' },
                { type: 'changed', text: 'GeoPixelcons++ Settings: moved remaining general controls into Extensions → Misc and placed Smooth Zoom Buttons with the Map controls' },
                { type: 'changed', text: 'GeoPixelcons++ Settings: removed the redundant GPC Settings tab so extension controls live in one organized place' },
                { type: 'changed', text: 'GeoPixelcons++ Settings: moved superseded Ghost controls into Misc → Deprecated and aligned all moved rows with the standard red/green state styling' },
            ]
        },
        {
            version: '2.7.0',
            date: '2026-08-17',
            items: [
                { type: 'changed', text: 'Painting Menu Overhaul: the bottom control-row buttons are now centered within their row' },
                { type: 'added', text: 'Controls Scale: a new GeoPixelcons++ dropdown setting scales both left and right native control clusters together' },
                { type: 'changed', text: 'Paint Menu Controls: the scale slider opens upward from a toolbar tab beside its flip button, applies when released, and works without Painting Menu Overhaul enabled' },
                { type: 'fixed', text: 'Painting Menu Overhaul: control-row dropdowns now stay above the Paint Menu Controls buttons' },
                { type: 'fixed', text: 'Painting Menu Overhaul: Filter within pixel count now exposes working minimum and maximum inputs' },
                { type: 'changed', text: 'Painting Menu Overhaul: replaced the extra gap between the control row and compact palette with a small amount of breathing room' },
                { type: 'fixed', text: 'Painting Menu Overhaul: added a small amount of breathing room below the control row' },
                { type: 'fixed', text: 'Paint Menu Controls: scaling keeps the paint panel\'s visual width fixed; only its controls and height change' },
                { type: 'fixed', text: 'Paint Menu Controls: its toolbar and compact Brush Swap buttons stay attached and scale with the paint surface' },
                { type: 'fixed', text: 'Painting Menu Overhaul: switching between the template preview and native controls now updates the scaled panel height immediately' },
                { type: 'fixed', text: 'Paint Menu Controls: its toolbar sits flush against the scaled panel edge' },
                { type: 'fixed', text: 'Paint Menu Controls: the scale slider keeps the exact released value, and its toolbar tab matches the selected theme' },
                { type: 'fixed', text: 'Paint Menu Controls: a scaled paint panel now follows the site\'s normal responsive width and stays centered after resizing the window' },
            ]
        },
        {
            version: '2.6.0',
            date: '2026-08-17',
            items: [
                { type: 'changed', text: 'Ghost++ compact view now opens at a short height and stays within the visible screen while resizing' },
            ]
        },
        {
            version: '2.5.0',
            date: '2026-08-16',
            items: [
                { type: 'changed', text: 'Mobile Painting (in development): bottom paint controls now keep the site\'s natural responsive width instead of being forced full-screen' },
                { type: 'fixed', text: 'Mobile Painting (in development): controls now apply the active GeoPixels++ Simple Black theme when the extension first loads' },
                { type: 'fixed', text: 'Mobile Painting (in development): Scan progress now refreshes the compact palette\'s per-color checkmarks and status when its scan finishes' },
                { type: 'added', text: 'Mobile Painting (in development): Enable > Selected now reveals an optional, session-only Highlight nearest checkbox; selecting a new color can show its nearest remaining pixel with large fading red rings without teleporting the map (off by default)' },
                { type: 'fixed', text: 'Mobile Painting (in development): Highlight nearest red rings now remain visible even when the focused Ghost++ template is hidden or set to 0% opacity' },
                { type: 'added', text: 'Mobile Painting (in development): native color grid replaced with the focused Ghost++ template\'s own color grid, styled like the Ghost++ manager' },
                { type: 'added', text: 'Mobile Painting (in development): the color grid now stays live-synced with the Ghost++ manager -- switching templates or changing a color\'s visibility there updates it automatically' },
                { type: 'added', text: 'Mobile Painting (in development): tapping a color now shows only that color\'s remaining pixels on the map and selects it as your active paint color in one tap' },
                { type: 'added', text: 'Mobile Painting (in development): the selected color now shows in the hex display, and colors get the same hover tooltip as the Ghost++ manager' },
                { type: 'added', text: 'Mobile Painting (in development): the color grid now respects whatever sort/filter is set in the Ghost++ manager\'s own color panel' },
                { type: 'added', text: 'Mobile Painting (in development): stronger hover feedback (bigger scale, soft shadow), plus a rotating dashed ring marking whichever color is currently selected' },
                { type: 'fixed', text: 'Mobile Painting (in development): swatches were missing their base style class, so the hover/selected effects above never actually appeared -- now they do' },
                { type: 'fixed', text: 'Mobile Painting (in development): stopped a repeating native "Color container not found" console error by hiding the native color grid instead of removing it' },
                { type: 'fixed', text: 'Mobile Painting (in development): disabled colors no longer gray out -- that was always on regardless of the Ghost++ manager\'s own "Gray unselected color boxes" setting' },
                { type: 'added', text: 'Mobile Painting (in development): added a control row below the color grid -- Enable (all/owned/filtered), Disable all, Get hex values, Sort, and Filter, all sharing state with the Ghost++ manager' },
                { type: 'removed', text: 'Mobile Painting (in development): removed the redundant native Sort button now that the control row has its own Sort' },
                { type: 'changed', text: 'Mobile Painting (in development): the color grid now shows 2 rows before scrolling instead of ~10, matching the Ghost++ manager\'s own compact view' },
                { type: 'changed', text: 'Mobile Painting (in development): the selected-color ring is now a square (was a circle) and spins 4x slower' },
                { type: 'fixed', text: 'Mobile Painting (in development): the control row now shows above the color grid instead of below it' },
                { type: 'removed', text: 'Mobile Painting (in development): disabled colors no longer show a diagonal slash in the mobile grid either -- the underlying show/hide state is unchanged, only the visual indicator is gone' },
                { type: 'fixed', text: 'Mobile Painting (in development): the control row buttons now use this extension\'s own dark-mode palette consistently -- "Disable all" had no styling of its own before and rendered as bare text; every button, the Sort dropdown, and Filter/Enable/Get hex values menus now match' },
                { type: 'changed', text: 'Mobile Painting (in development): control row buttons now have a capped width sized to their label instead of stretching to fill the row' },
                { type: 'changed', text: 'Mobile Painting (in development): the Enable, Filter, and Get hex values menus now open upward instead of downward, since the row sits at the bottom of the screen' },
                { type: 'changed', text: 'Mobile Painting (in development): the selected-color ring no longer spins -- it\'s now a stationary square dashed border' },
                { type: 'changed', text: 'Mobile Painting (in development): Sort is now a plain "Sort" button with a dropdown menu instead of a native select that displayed whatever option was last chosen' },
                { type: 'fixed', text: 'Mobile Painting (in development): control row buttons now stay white with black text by default, only switching to the dark palette when the GeoPixels++ extension\'s own theme selector is explicitly set to a dark theme -- previously also reacted to the OS/browser dark preference even though the surrounding native controls never actually go dark' },
                { type: 'fixed', text: 'Mobile Painting (in development): the Enable/Filter/Get hex values dropdown menus no longer render underneath the Paint Menu Controls collapse/drag button row' },
                { type: 'added', text: 'Mobile Painting (in development): the Enable dropdown has a new "Selected" option that switches the color grid back to solo-select mode and immediately re-solos whichever color was last individually tapped' },
                { type: 'fixed', text: 'Mobile Painting (in development): tapping a color in the grid now actually changes the game\'s active paint color -- it was silently failing to reach the real page function in some browsers, even though the grid\'s own solo-select highlighting still updated correctly' },
                { type: 'added', text: 'Mobile Painting (in development): picking Enable All/Owned/Filtered now switches the color grid to multi-select mode -- tapping a color toggles just that one color instead of soloing it, and the selected-color ring stops showing since there\'s no longer a single "the" selected color; picking Selected switches back' },
                { type: 'changed', text: 'Mobile Painting (in development): the selected-color ring is now a plain black square border with a white glow, replacing the dashed frame' },
                { type: 'added', text: 'Ghost++ / Mobile Painting: using Enable, Sort, or Filter (in either the real Ghost++ manager or its mobile mirror, excluding Disable) now first tries to run Scan Progress, so progress numbers stay fresh without a separate manual click' },
                { type: 'changed', text: 'Mobile Painting (in development): the selected-color ring now sits above every other element under the bottom paint bar, and its corners match the swatch\'s own rounding instead of being square' },
                { type: 'fixed', text: 'Mobile Painting (in development): toggling the Paint Menu Controls collapse button no longer shifts the color-grid controls row above the native hex display / sort / brush row' },
                { type: 'added', text: 'Mobile Painting (in development): a small preview of the focused template\'s ghost image now sits to the right of the color grid, sized to the grid\'s own height without distorting the image' },
                { type: 'added', text: 'Mobile Painting (in development): the native hexDisplay/sortBtn/brush-buttons/energy row now has a stable id (gpc-native-top-bar) instead of being reachable only by class' },
                { type: 'added', text: 'Mobile Painting (in development): tapping the template preview thumbnail now hides the native top bar and the control row, showing two placeholder panels in their place (scaffolding for a feature to come)' },
                { type: 'fixed', text: 'Mobile Painting (in development): the two placeholder panels shown after tapping the preview thumbnail no longer have awkward extra spacing between them -- they now share one parent instead of each stacking its own margin on top of the surrounding layout\'s own gap' },
                { type: 'fixed', text: 'Mobile Painting (in development): fixed a real bug where the native top bar id (#gpc-native-top-bar) could end up on the entire white bottom-bar panel instead of just the small top bar row -- tapping the preview thumbnail was hiding that whole panel\'s white background, exposing the map behind it' },
                { type: 'changed', text: 'Mobile Painting (in development): tapping the template preview thumbnail is now a proper toggle -- tap again to switch back from the placeholder panels to the native controls, instead of it only going one way' },
                { type: 'added', text: 'Mobile Painting (in development): the placeholder panels are now three real columns instead of two placeholders -- left is Ghost++\'s own scan progress bar, summary text, and Scan/Show errors/Show missing/Nearest error buttons; middle is the real template drop zone; right is Place/Unset/Go to/Preview, Lock Position, Group noise, and a Manage templates button that opens the real template manager -- all genuine Ghost++ controls, borrowed from their real locations while this view is open and returned when switching back' },
                { type: 'fixed', text: 'Mobile Painting (in development): the real Ghost++ buttons/checkboxes/drop zone borrowed into the p1/p2/p3 columns now follow the same light/dark theme signal as the rest of this row instead of Ghost++\'s own, which could render them dark on a light page for the same reason the control row\'s own buttons had this bug fixed earlier' },
                { type: 'fixed', text: 'Mobile Painting (in development): fixed the p1/p2/p3 columns going stale after any single interaction -- using one borrowed control (a checkbox, Show errors, etc.) silently caused Ghost++ to redraw the other columns\' real content invisibly elsewhere, which is why Lock Position/Group noise looked out of sync and Place/Preview appeared unresponsive (a fresh Ghost++ render cancels any in-progress "click the map to place" capture). The columns now stay live-synced with Ghost++\'s own redraws for as long as this view is open' },
                { type: 'fixed', text: 'Mobile Painting (in development): pasting a file to upload a template now works again while the drop zone is showing in the p2 column -- it previously only worked inside the real (currently hidden) Ghost++ modal' },
                { type: 'changed', text: 'Mobile Painting (in development): the Manage templates button now sits in the p2 column, directly under the drop zone, instead of below Place/Unset/Go to/Preview in p3' },
                { type: 'changed', text: 'Mobile Painting (in development): the drop zone\'s own desktop-oriented text (drag/drop + paste instructions, supported formats, "or load from a URL") is now replaced with a single "Click to upload template files" line while shown here -- mobile painters only ever tap to pick a file. The real text is restored the instant this view closes, so the actual Ghost++ modal is unaffected' },
                { type: 'fixed', text: 'Mobile Painting (in development): fixed this row\'s buttons and the p1/p2/p3 columns staying in whichever light/dark theme was active the very first time they rendered, even after switching the GeoPixels++ extension\'s own theme setting -- the color values were baked into a stylesheet that was only ever written once per page load and never refreshed' },
                { type: 'fixed', text: 'Mobile Painting (in development): the control row buttons (Enable/Disable/Sort/Filter/Get hex values) were still stuck in whichever theme was active on first render even after the previous fix, because the stylesheet refresh only ever ran when the color grid itself got rebuilt from scratch (switching templates) -- an idle tick with the same template focused, by far the common case, skipped it entirely. The stylesheet now refreshes on every tick regardless, so switching the GeoPixels++ theme takes effect within about a second without needing to touch a template' },
                { type: 'changed', text: 'Mobile Painting (in development): the three columns\' ids now describe what they actually hold (#gpc-pmo-scan-panel / #gpc-pmo-upload-panel / #gpc-pmo-placement-panel) instead of their leftover scaffolding-era gpc-pmo-placeholder-1/2/3 names, from back when they held nothing but literal "placeholder 1"/"placeholder 2" text' },
                { type: 'fixed', text: 'Mobile Painting (in development): the three columns no longer size to their own content\'s height independently -- since p1\'s counts line only shows once there\'s something to report and the drop zone/scan bar can wrap differently, they could end up visibly uneven heights. All three now stretch to match whichever one is tallest' },
                { type: 'added', text: 'Mobile Painting (in development): a real Palette view (Grid/List) toggle from Ghost++ now sits directly left of the template preview thumbnail, with its label stacked above the toggle instead of beside it -- toggling it updates Ghost++\'s own real view-mode setting (so it\'s remembered if the real modal is ever opened), though this row\'s own compact grid always stays a grid regardless' },
                { type: 'added', text: 'Mobile Painting (in development): pressing Place now temporarily switches into Inspect mode for as long as the click-to-place capture is active, and switches back the instant it ends -- placed, Escape-cancelled, or superseded -- so aiming a tap at the map doesn\'t fight with paint mode' },
                { type: 'added', text: 'Mobile Painting (in development): the real left/up/down/right nudge arrows now sit to the right of Lock Position/Group noise in the placement column, with the real opacity slider below both' },
                { type: 'added', text: 'Mobile Painting (in development): color swatches now show the same completion badge Ghost++\'s own grid does once a scan has run -- a white circle with a green check when a color is fully placed, a black ring before it\'s started, and a red-to-green ring while in progress' },
                { type: 'fixed', text: 'Mobile Painting (in development): fixed a real regression from the palette view toggle addition that froze the entire page on tapping the template preview thumbnail -- two independent MutationObservers ended up watching the same Ghost++ modal, and each one\'s own disconnect-before-mutate-reconnect-after guard only ever covered ITS OWN mutations, not the other observer\'s, so each one\'s reconnect kept re-triggering the other forever. Merged into a single shared observer, which is the only way one disconnect can actually cover both concerns at once' },
                { type: 'added', text: 'Mobile Painting (in development): the color grid now actually switches to the same compact list layout (color chip, hex, "<placed>/<total>", and a mini progress bar per row) Ghost++\'s own grid does when the borrowed Grid/List toggle is set to List -- previously only the real Ghost++ panel changed layout; this grid stayed a tiled grid regardless of which mode was selected' },
                { type: 'fixed', text: 'Mobile Painting (in development): switching Grid/List without also switching templates now actually updates this grid -- it only ever rebuilt on a template or visible-color-order change, so toggling the view mode alone silently did nothing until something else happened to trigger a rebuild' },
                { type: 'fixed', text: 'Mobile Painting (in development): the opacity slider was nearly unusable on a phone-width screen -- its row packed the label, the slider, the percentage, and the reset button into one line, leaving almost no width for the actual draggable track. The label/percentage/reset now share one line and the slider gets a full line to itself below them' },
                { type: 'fixed', text: 'Mobile Painting (in development): fixed the palette-view toggle drifting to the right of the preview thumbnail over time instead of staying to its left -- borrowing always re-appends at the end of whatever it\'s given, and by the time a live-sync tick fires the thumbnail is already there too. It now borrows into its own stable column instead, which never moves once placed' },
                { type: 'added', text: 'Mobile Painting (in development): a new "Visible rows" dropdown (1-10, default 2) below the Grid/List toggle controls how many rows show in the color grid before it scrolls' },
                { type: 'added', text: 'Mobile Painting (in development): an eye icon on the template preview thumbnail opens a larger preview -- a bigger image, the same progress bar and summary text, every color in the template in a copyable list, and a Buy all colors button that opens the real purchase flow pre-filled with whatever you don\'t already own' },
                { type: 'added', text: 'Mobile Painting (in development): pressing Place now also shows a reminder toast pointing at where to actually tap to place the template' },
                { type: 'changed', text: 'Mobile Painting (in development): the template preview thumbnail now stretches to fill and center within whatever height its row actually ends up (which can vary now that Visible rows exists), instead of always staying a fixed 60px tall regardless' },
                { type: 'changed', text: 'Mobile Painting (in development): the preview thumbnail\'s larger-preview button is now an info icon instead of an eye' },
                { type: 'changed', text: 'Mobile Painting (in development): the larger-preview modal (and its own bigger preview image) is now about 40% larger' },
                { type: 'added', text: 'Mobile Painting (in development): with no Ghost++ template focused yet -- most notably the very first time this feature is ever opened -- a "Click for template options" prompt now shows in place of the color grid. Tapping it opens the same template options (drop zone, Manage templates, Scan progress, and so on) placeholder mode already provides once a template exists; previously there was no way to reach any of that at all with nothing focused yet' },
                { type: 'changed', text: 'Mobile Painting (in development): the template preview thumbnail is now a square, its width matching whatever height its own row ends up (was a plain rectangle sized to the image itself)' },
                { type: 'fixed', text: 'Mobile Painting (in development): Enable, Sort, Filter, and Get hex values in the bottom controls row now close each other when a different one is opened, instead of leaving multiple of them visibly open on top of each other at once' },
                { type: 'changed', text: 'Mobile Painting (in development): the "Visible rows" dropdown now defaults to 3 instead of 2' },
                { type: 'added', text: 'Guild Overhaul: XP Tracker and player markers now show each member\'s last observed activity from snapshot XP gains, with configurable inactive-after days and yellow inactive markers that take priority over territory colors' },
                { type: 'fixed', text: 'Guild Overhaul: opening the XP Tracker now records activity that happened since the latest stored snapshot, so current tracker changes no longer appear as unknown' },
                { type: 'changed', text: 'Guild Overhaul: members with unknown activity are now treated as inactive and shown with the inactive marker color until activity is observed' },
            ]
        },
        {
            version: '2.4.1',
            date: '2026-08-16',
            items: [
                { type: 'changed', text: 'Compact Paint Controls is now enabled by default for new installs' },
            ]
        },
        {
            version: '2.4.0',
            date: '2026-08-16',
            items: [
                { type: 'added', text: 'Bulk Purchase Colors now warns before buying more than 50 colors, showing the color count and total Pixel cost with Continue or Cancel options' },
            ]
        },
        {
            version: '2.3.0',
            date: '2026-08-14',
            items: [
                { type: 'added', text: 'Guild Overhaul: optionally load and show guild territories automatically when the map opens' },
            ]
        },
        {
            version: '2.2.0',
            date: '2026-08-13',
            items: [
                { type: 'added', text: 'Ghost++ compact view now includes the Palette view Grid/List toggle directly below Enable all and Disable all' },
            ]
        },
        {
            version: '2.1.0',
            date: '2026-08-13',
            items: [
                { type: 'added', text: 'Profile overlay: owned-color lists over 100 colors now start compact with a Show All button, and can be collapsed again with Show Less' },
                { type: 'fixed', text: 'Profile color list: the new enhancement no longer watches every page mutation after the native profile container is found, preventing unnecessary background work' },
            ]
        },
        {
            version: '2.0.0',
            date: '2026-08-09',
            items: [
                { type: 'changed', text: 'GeoPixelcons++ now uses a tiny integrity-pinned shell and a readable, versioned GeoPixelcons library bundle, preserving existing behavior while keeping Greasyfork uploads lightweight' },
                { type: 'fixed', text: 'Library loading now requires an exact immutable tag and Tampermonkey SRI digest, preventing releases that point at a missing or mutable external bundle' },
                { type: 'removed', text: 'Mobile Compatibility and Mobile System Overhaul settings have been removed entirely, including their touch-first painting interface and modal-positioning behavior -- mobile support is being redesigned from scratch' },
            ]
        },
        {
            version: '1.11.0',
            date: '2026-08-09',
            items: [
                { type: 'added', text: 'Mobile System Overhaul: a new default-off, manual setting replaces the native paint bar and desktop Ghost++ window after reload with a touch-first painting interface on any screen size' },
                { type: 'added', text: 'Mobile painting view: resizable safe-area-aware bottom panel with the native Paint/energy/brush controls, one-shot eyedropper, single-active-color palette, scrub/search/sort/filter tools, template thumbnail, and always-live Ghost++ scan progress' },
                { type: 'added', text: 'Mobile template tools: flat live hamburger menu, fixed-map-reticle positioning, template history/focus/delete controls, full preview actions, and an independently persisted 75%-150% whole-site UI scale' },
                { type: 'changed', text: 'The mobile presentation layer now loads from the immutable geopixelcons-external v0.1.0 bundle; missing or failed initialization restores the existing native/desktop interface instead of breaking unrelated features' },
            ]
        },
        {
            version: '1.10.1',
            date: '2026-08-02',
            items: [
                { type: 'fixed', text: 'Ghost++: hovering a checkbox/slider itself no longer shows its tooltip (as intended), but clicking it -- or starting to drag a slider -- still popped the tooltip anyway, since the mouse interaction also gives the control keyboard focus as a native side effect, which a separate focus handler treated the same as a real Tab keypress. Tooltips triggered by focus now only fire for genuine keyboard navigation' },
            ]
        },
        {
            version: '1.10.0',
            date: '2026-08-02',
            items: [
                { type: 'added', text: 'Ghost++ View Settings: new "Rescale Ghost++" slider (Global section, 50%-150%) uniformly scales the whole panel -- text, buttons, colors, and all -- independent of the corner-drag resize, per feedback that the redesigned panel feels too large with no way to shrink it as a whole. Rescales once you release the slider, not while dragging' },
                { type: 'added', text: 'Ghost++: new compact/minified view (button beside the ✕ close button) shows just Enable all/Disable all and the color grid (~2 rows, scrollable), for grabbing colors while painting without the full panel taking up screen space. Cross-fades into and out of it instead of snapping instantly' },
                { type: 'added', text: 'Ghost++: hover tooltips (appear near the cursor, replacing the slower/less consistent native browser tooltip) added to Cell Fill, Only show current template on map, Gray unselected color boxes, Show error crosses, Hide queued crosshairs, Group Noise, and Lock Position. Only shown when hovering the text description itself, not the checkbox/slider, and auto-dismiss on their own after 10 seconds' },
                { type: 'fixed', text: 'Ghost++: dragging any slider (Cell Fill, Opacity, Error Opacity/Size, ...) left it holding keyboard focus afterward, silently breaking native GeoPixels keyboard shortcuts (I, Y, P, spacebar, G, ...) until clicking elsewhere in the panel. Sliders now give up focus the moment their value change commits' },
                { type: 'fixed', text: 'Ghost++: the native G shortcut could open the panel but never close it again, even after keyboard focus was otherwise fine -- a side effect of an earlier fix that made every blocked native ghost control open-only. G (and only G, which is a real toggle key) now correctly toggles open/closed again' },
                { type: 'fixed', text: 'Ghost++: at a narrow panel width, collapsing then re-expanding the color library panel (◀/▶ button) grew the panel wider than it was before collapsing, visibly overflowing off-screen on small/mobile-width windows, instead of restoring the exact prior width' },
                { type: 'added', text: 'Ghost++: at a narrow panel width, the ◀/▶ button now swaps between showing the template list fully or the colors fully -- one at a time -- instead of the plain 34px-stub partial collapse, mirroring the legacy Ghost Template Manager\'s own mobile behavior. A wide panel is unaffected and keeps the plain partial collapse' },
            ]
        },
        {
            version: '1.9.13',
            date: '2026-08-02',
            items: [
                { type: 'added', text: 'Ghost++: loading a guild project via "Set as Ghost" now shows a success confirmation once it\'s loaded, restoring the native ghost tool\'s old "Ghost image set." feedback -- Ghost++\'s own guild-loading pipeline previously went silent on success' },
                { type: 'fixed', text: 'Ghost++: loading a guild project via "Set as Ghost" while the Ghost++ panel was already open didn\'t visually update the panel\'s palette/progress/library sections to the newly loaded template -- even though it was already correctly focused and rendering on the map -- until the panel was closed and reopened. Now refreshes the open panel immediately' },
            ]
        },
        {
            version: '1.9.12',
            date: '2026-08-02',
            items: [
                { type: 'fixed', text: 'Ghost++: templates loaded into Ghost++ didn\'t count as loaded on the native ghost template manager, so guild leaders couldn\'t use "Add as Guild Project" / "Update Project" (and the guild panel\'s own ghost preview showed "No ghost image loaded") even with a template genuinely focused and positioned -- those all read a native mirror that could still be stale the first time they ran after Ghost++ activated. Now forces a fresh sync of the focused template right before each of those runs' },
                { type: 'fixed', text: 'Ghost++: clicking "Set as Ghost" on a guild project (or triggering a blocked native ghost control) closed the Ghost++ panel instead of opening it, if the panel happened to already be open -- both were simulating a click on the opener button, which toggles. Now opens the panel if closed and leaves it exactly as-is if already open, without affecting the button\'s normal open/close toggle behaviour for direct clicks' },
            ]
        },
        {
            version: '1.9.11',
            date: '2026-07-30',
            items: [
                { type: 'fixed', text: 'Bulk Purchase Colors: reading colors and pixel counts from a Ghost++ template previously scraped the native ghost palette, which Ghost++ leaves empty while it owns the overlay -- "Add Ghost Template Colors" could report no colors found, or the Buy All list could show pixel counts for only some colors, with a template genuinely loaded. Now reads directly from the focused Ghost++ template when one exists, falling back to the native palette exactly as before for non-Ghost++ users' },
            ]
        },
        {
            version: '1.9.10',
            date: '2026-07-29',
            items: [
                { type: 'fixed', text: 'Ghost++: the template overlay (and the error/wrong-pixel highlight layer) could render visibly on top of the native toolbar buttons under controls-right, since the map container doesn\'t establish its own stacking context and their z-index leaked out to compete directly against the toolbar\'s. Fixed at the root by giving the map container a real z-index once, instead of adjusting individual layer values' },
            ]
        },
        {
            version: '1.9.9',
            date: '2026-07-29',
            items: [
                { type: 'changed', text: 'Ghost Palette Search: "Sync Ghost With Selected Color" is now its own independent extension with its own Settings toggle, instead of a display option nested inside "Ghost Palette Color Search (legacy)". It never actually depended on that feature\'s search/filter tools -- the two were only ever bundled in the same file historically. Existing users who had it enabled keep it enabled with no action needed' },
            ]
        },
        {
            version: '1.9.8',
            date: '2026-07-29',
            items: [
                { type: 'fixed', text: 'Ghost Palette Search: 1.9.7\'s auto-enable of "Ghost Palette Color Search (legacy)" only fired when checking "Sync Ghost With Selected Color" itself -- unchecking the legacy feature afterward (or having it off from before 1.9.7) left the display option checked but silently doing nothing. Settings now self-corrects that mismatch every time it opens, and unchecking the legacy feature live-unchecks the display option too instead of only taking effect on the next reload' },
            ]
        },
        {
            version: '1.9.7',
            date: '2026-07-28',
            items: [
                { type: 'fixed', text: 'Ghost Palette Search: the ♻️ "Sync Ghost With Selected Color" display option did nothing if the "Ghost Palette Color Search (legacy)" feature itself was off, since the button lives entirely inside that feature — enabling the display option now also enables that feature automatically (a page refresh is still needed), instead of silently failing with no indication why' },
                { type: 'changed', text: 'Debug System: Ghost Palette Search now logs its own search-box mount wait too, including a note that it stays permanently unmounted while Ghost++ owns the overlay -- which is expected, not a bug' },
            ]
        },
        {
            version: '1.9.6',
            date: '2026-07-28',
            items: [
                { type: 'changed', text: 'Debug System: six more features (Paint Menu Controls, Region Screenshot, Regions Highscore, Auto-open Menus on Hover, Ghost Template Manager, Pill Hover Labels) that wait for a native page element or global to appear now retry with a bounded giveup and log every step to the Debug Log, instead of polling forever with no diagnostic trail if they never found what they were waiting for' },
            ]
        },
        {
            version: '1.9.5',
            date: '2026-07-28',
            items: [
                { type: 'fixed', text: 'Ghost Palette Color Search: the ♻️ "Sync Ghost With Selected Color" button could silently fail to mount if the game\'s Image Tools menu hadn\'t rendered yet, with no giveup and no way to tell why from a Debug Log — it now retries the same way Ghost++\'s own button does and logs every step, including whether it stayed hidden behind its own separate "Sync Ghost With Selected Color" display-option checkbox in Settings' },
            ]
        },
        {
            version: '1.9.4',
            date: '2026-07-28',
            items: [
                { type: 'added', text: 'Debug System: other installed userscripts can now feed their own diagnostic events into this script\'s Debug Log, so a single exported file can cover more than one addon at once when troubleshooting an interaction between them' },
            ]
        },
        {
            version: '1.9.3',
            date: '2026-07-28',
            items: [
                { type: 'fixed', text: 'Ghost++: other addons that read the native "which ghost colors are enabled" state directly could see it as empty even with colors correctly enabled in Ghost++ itself, until you happened to open Ghost++\'s own menu at least once — that native state now stays correctly in sync from the moment Ghost++ finishes loading, not just after its menu has been opened' },
            ]
        },
        {
            version: '1.9.2',
            date: '2026-07-28',
            items: [
                { type: 'fixed', text: 'Ghost++: the separate GeoPixels++ addon\'s "Toggle ghost image" keybind (Y by default) stopped doing anything visible once Ghost++ took over the overlay slot, since it only toggles the native ghost canvas Ghost++ had already emptied out — Y now also toggles Ghost++\'s own overlay, so it still works as a quick "peek at the map" shortcut' },
            ]
        },
        {
            version: '1.9.1',
            date: '2026-07-27',
            items: [
                { type: 'fixed', text: 'Ghost++: fixed a bug (reported on Firefox) where enabling the Ghost++ setting and reloading could still leave the OLD native ghost tool active instead of switching to Ghost++ — its own init now waits for the page to finish loading, and its native-button replacement now retries if that button hasn\'t mounted yet instead of silently giving up' },
                { type: 'fixed', text: 'Ghost++: the native ghost button was hidden immediately, but a keyboard shortcut (or anything else that clicks it programmatically) could still pop the old native ghost tool before you\'d ever manually opened Ghost++ once — the click-blocking that prevents this now activates immediately instead of waiting for your first open' },
                { type: 'added', text: 'Ghost++ Progress: clicking "Show errors" or "Show missing" now pops an alert with the resulting count (e.g. "Found 12 errors among your currently enabled colors"), matching the native ghost tool\'s own scan alerts' },
                { type: 'changed', text: 'Ghost++ palette: a fully-completed color now shows a large checkmark (with a thin black outline so it stays visible on bright colors) across the whole swatch instead of a small white circle with a tiny check mark, similar in style to how a disabled color shows its diagonal slash' },
                { type: 'added', text: 'Ghost++: with Enable Debugging on (Settings), the exported Debug Log now records whether Ghost++ started immediately or waited for the page to finish loading, whether it found (or had to wait for) the native ghost button, and whether it finished initializing successfully or hit an error — so a "Ghost++ doesn\'t seem to be working" report can be diagnosed from an exported log instead of guesswork' },
                { type: 'added', text: 'Debug Logs: the exported file now also includes a live state snapshot (every feature\'s enabled/ok/error status, plus a deeper Ghost++-specific dive) captured at the moment you click "Debug Logs" — and the button now always exports something, even with zero recorded events, since the snapshot alone can be the more useful half when something failed too early to log anything' },
            ]
        },
        {
            // Consolidates every version between the last release actually
            // published to Greasyfork (1.8.2) and this one into a single
            // entry — local version numbers had continued on far past
            // Greasyfork (through 1.21.0) across many small, incremental
            // releases while none of them were ever pushed there. The
            // superseded 1.10.0-1.21.0 build snapshots were deleted from
            // archive/ (2026-08-02) as dead weight from a numbering lineage
            // this reset abandoned; see git history (pre-2026-08-02) for the
            // full granular record if ever needed. This entry summarizes the
            // net user-facing result of all of it.
            version: '1.9.0',
            date: '2026-07-26',
            items: [
                { type: 'added', text: 'New: Ghost++ Template Overlay — a scalable, multi-template ghost/overlay manager (opt-in, enable it in Settings) that can replace the native ghost image tool: draggable/resizable two-column panel, thumbnail template library with hover preview and drag-reorder, sort/filter/search palette with hover-to-copy hex values, segmented completion progress bar, click-to-place positioning with a live cursor-following preview, and a Group Noise implementation matching the native tool\'s own near-identical-color merging' },
                { type: 'added', text: 'Ghost++: keyboard shortcuts — arrow keys nudge the focused template\'s position one cell at a time, and E enters click-to-place mode' },
                { type: 'added', text: 'Ghost++: a "Guild Templates" section lists your guild\'s project templates and loads them in at 0% opacity so they don\'t immediately cover the map — these are never saved to your template library or written to disk, since guild projects change frequently; they\'re re-fetched fresh every page load' },
                { type: 'changed', text: 'Ghost++ Guild Templates are now TRUE lazy-loaded for real performance with large guilds — expanding the section only fetches the lightweight project list and shows browser-native thumbnails; a template\'s actual pixel data is only fetched/decoded the first time you click to view it, not for the whole guild up front' },
                { type: 'fixed', text: 'Ghost++: a hidden template (0% opacity) — guild or regular — no longer holds a GPU texture / canvas resource at all; previously it was still fully uploaded and just skipped drawing, which was real, avoidable memory and upload cost for large templates' },
                { type: 'added', text: 'Ghost++ View Settings: new "Auto-hide unfocused templates" checkbox (off by default) — when on, focusing a template automatically hides every other one, so only ever one is visible at a time; also reduces memory/GPU usage for large libraries' },
                { type: 'fixed', text: 'The guild menu\'s "Set as Ghost" button no longer fails with "Could not find the selected project" — it now loads the guild project straight into Ghost++, position included, without ever saving it to your library either' },
                { type: 'added', text: 'Ghost++ Manage Templates: a fixed-size Grid view (now the default) alongside the existing List view — click a thumbnail to load/focus that template, plus per-card multiselect, show/hide, and go-to-location buttons; template previews render at full resolution instead of a blurrier shared thumbnail, darkened until you hover, with always-visible corner buttons' },
                { type: 'changed', text: 'Ghost++: shows a "Loading templates…" placeholder while your library decodes in the background instead of looking empty; bulk export in Manage Templates now shows real progress and encodes noticeably faster (native browser base64 conversion instead of a manual byte-by-byte loop, small-batch parallel re-encoding)' },
                { type: 'added', text: 'Ghost++ palette: bulk actions (All/None/Owned/Match palette/Set palette), "Buy all colors", a "Get hex values" export menu, left/right-click-drag to enable/disable colors, and a "Group Noise Changes" section showing exactly which colors got merged and their combined hex value' },
                { type: 'added', text: 'Ghost++ Progress: "Nearest error" teleports instantly and pulses a highlight ring on the exact cell that needs correcting; all teleports (grid/Manage Templates/Nearest error) zoom out further for a better overview and never zoom back in if you\'re already closer' },
                { type: 'fixed', text: 'Ghost++: fixed poor performance with thousands of error/missing crosshairs on screen — the redraw math is now computed once per frame instead of once per marker' },
                { type: 'changed', text: 'Ghost++ Progress: error/missing pixel counts now always show under the progress bar whenever there are any, instead of only after checking Show errors/Show missing' },
                { type: 'changed', text: 'Ghost++ Template Settings: Preview is a separate, transient full-opacity view that never touches your saved Opacity slider; flip/rotate buttons were removed (easy to do in any image editor beforehand)' },
                { type: 'fixed', text: 'Ghost++: Unset position, drag-reorder order, and each section\'s collapsed/expanded state now all persist correctly across reloads' },
                { type: 'fixed', text: 'Ghost++: scrollable sections (palette grid, Manage Templates list, main panel) no longer shift the rest of the layout when their scrollbar appears or disappears' },
                { type: 'changed', text: 'Ghost++: the whole compatibility shim keeps the guild menu, queue-ghost-color, and other native-ghost-aware tools working correctly while Ghost++ owns the overlay slot' },
                { type: 'changed', text: 'Ghost Template Manager and Ghost Palette Color Search remain available as legacy fallbacks, unaffected if you already had them enabled' },
                { type: 'added', text: 'Ghost Template Manager: the Group Noise checkbox state is now saved with each history entry and restored automatically when you reload it — overridden as always if "Disable Group Noise" is enabled; templates saved before this update (or imported from older JSON bundles) default to disabled' },
                { type: 'changed', text: 'The shipped script is now minified, cutting its file size roughly in half — keeps room to grow well under Greasyfork\'s size limit' },
                { type: 'added', text: 'Ghost++ View Settings: new "Gray unselected color boxes" checkbox (on by default) — turn it off to keep only the diagonal slash on a disabled color and see its true color underneath, instead of also graying/dimming it' },
                { type: 'added', text: 'Ghost++ View Settings: new "Palette view" grid/list toggle — list mode turns the color grid into compact rows showing the hex value, placed/total, and a mini progress bar, still affected by the same sort and filters as the grid' },
                { type: 'fixed', text: 'Ghost++ guild menu: fixed a crash ("Unsupported index type: null") and a "click does nothing" bug that could both occur if the same guild project was viewed from both the Guild Templates section and "Set as Ghost" — they now correctly share one entry instead of quietly creating a duplicate' },
                { type: 'fixed', text: 'Ghost++ Progress: the Scan button (and the rest of that row) no longer gets stuck showing "Scanning…" after you switch templates while a large template\'s scan is still finishing in the background — it now reflects whichever template is actually focused' },
                { type: 'fixed', text: 'Ghost++ Progress: automatic scans (on focusing a template, or after placing pixels with Autoscan on) now reliably update the Scan button when they finish, instead of sometimes staying stuck on "Scanning…" until an unrelated action (like toggling a color) happened to refresh it' },
                { type: 'fixed', text: 'Ghost Palette Color Search\'s "Sync Ghost With Selected Color" button (under the image group dropdown) works again once Ghost++ is enabled — it now drives Ghost++\'s own focused template instead of the native color palette, which Ghost++ leaves empty' },
                { type: 'fixed', text: 'Ghost++: a guild template loaded via the guild menu\'s "Set as Ghost" now shows its preview thumbnail and full Template Settings panel like any other template; its position is always locked (checkbox forced on and disabled) since guild templates can\'t be moved from this UI' },
                { type: 'fixed', text: 'Ghost++: worked around a Firefox-only CSS Grid bug where the color palette and Templates grids could collapse/stack their cells on top of each other (instead of showing squares) once the side panel got narrow' },
                { type: 'removed', text: 'Ghost++: removed the in-panel "Guild Templates" browsing section — the guild menu\'s own "Set as Ghost" button remains fully supported for loading a guild project into Ghost++' },
                { type: 'changed', text: 'Ghost++ View Settings: "Auto-hide unfocused templates" is now on by default and renamed to "Only show current template on map"' },
                { type: 'fixed', text: 'Ghost++: reopening the panel repeatedly no longer gets progressively slower — the panel\'s content areas are now built once instead of torn down and rebuilt on every open, which was silently piling up duplicate event listeners the longer a session went on (worse with a larger template library)' },
                { type: 'fixed', text: 'Ghost++: the left panel\'s header and every section\'s horizontal divider now reach the true edge of the panel instead of stopping short — an ambient padding rule (plus a redundant, unused scrollbar reservation) on the panel container was insetting content that should have spanned edge to edge' },
                { type: 'changed', text: 'Ghost++ palette: "Get hex values", "Filters", and the Sort dropdown now have centered text' },
                { type: 'changed', text: 'Ghost++ palette: the bulk color-selection buttons are now three clearer rows — Enable all/Disable all, Enable owned/Enable filtered, Match palette/Set palette — instead of one row of terse labels' },
                { type: 'added', text: 'Ghost++ palette: new "Enable filtered" button — enables only the colors currently matching your search/filters and disables the rest' },
                { type: 'fixed', text: 'Ghost++ Progress: a template that was already loaded before you refreshed the page now automatically scans the first time you open Ghost++, instead of sitting with no progress shown until you manually click Scan or switch templates away and back' },
                { type: 'fixed', text: 'Ghost++: the Place/Unset/Go to/Preview button row now wraps onto extra lines as you drag the panel splitter narrower, instead of overflowing past the right panel\'s edge and disappearing behind the left panel' },
                { type: 'added', text: 'Ghost++: the drop zone now has an "or load from a URL" option alongside drop/paste/click-to-choose, matching the legacy Ghost Template Manager\'s own URL upload — paste an image or exported .json template URL and it ingests the same way a local file would' },
            ]
        },
        {
            version: '1.8.2',
            date: '2026-06-15',
            items: [
                { type: 'fixed', text: 'Keyboard Shortcuts: Ctrl+Shift+P now reliably opens the GeoPixelcons++ Settings modal without conflicting with the site\'s H shortcut; saved copies of the old Ctrl+Shift+H default migrate automatically' },
            ]
        },
        {
            version: '1.8.1',
            date: '2026-06-15',
            items: [
                { type: 'fixed', text: 'Guild Search Button: the search control now expands to show its "Search Guilds" hover label like the other left-side submenu buttons' },
            ]
        },
        {
            version: '1.8.0',
            date: '2026-06-15',
            items: [
                { type: 'added', text: 'GeoPixelcons++ Settings: new "Keybindings" tab to customise the keyboard shortcuts for "Open Settings" and "Toggle Map Movement Lock" — each has Ctrl / Shift checkboxes and a single key input; changes take effect after a page refresh' },
                { type: 'changed', text: 'Ghost Palette Color Search: "Pixel count range" filter is now a checkbox called "Filter within pixel count…" matching the other filter options — checking it reveals the min / max inputs beneath' },
                { type: 'added', text: 'Ghost Palette Color Search: new "Owned colors only" filter checkbox — hides all ghost palette colors not owned by the current user' },
                { type: 'added', text: 'Region Screenshot: "Show Palette" button in the preview modal extracts all unique colors from the captured region, shows pixel counts per color, and provides a copy-to-clipboard hex list' },
                { type: 'added', text: 'Guild Search Button: new extra extension — inserts a search icon button below the Guild menu button that opens the Guild Search modal, letting guild members search other guilds without leaving their own' },
                { type: 'added', text: 'Log Out Button: new extra extension — appends a log-out icon button to the right controls panel; auto-hides while the user is signed out and reappears on login' },
            ]
        },
        {
            version: '1.7.0',
            date: '2026-06-14',
            items: [
                { type: 'added', text: 'Theme Editor: light themes now have a "Marsh / Wetland (tufts)" control under Land & Nature — a visibility toggle plus opacity slider to hide or fade the grass-tuft texture that previously could not be removed or recolored' },
                { type: 'added', text: 'Theme Editor: added a "Grass" color row under Land & Nature to recolor or hide the flat grass landcover tint' },
                { type: 'added', text: 'Theme Editor: added a global "Road Width" slider under Roads that scales all road line widths (light and dark bases) while preserving zoom-based scaling' },
                { type: 'changed', text: 'Theme Editor: light "Roads" controls now cover casings, ramps/links, service roads, bridges and tunnels (grouped by class) so orange road outlines can be fully hidden or recolored — previously the casing stayed visible' },
                { type: 'added', text: 'Ghost Palette Color Search: added a "Pixel count range" (min/max) filter in the Filters dropdown to show only colors within a given pixel-count range' },
                { type: 'added', text: 'Map Movement Lock: added a Ctrl+Shift+L keyboard shortcut to toggle the lock' },
                { type: 'fixed', text: 'Ghost Template Manager: collapsing/expanding the preview panel no longer resets the modal\'s total width — it keeps the controls width fixed and only adds or removes the preview on the right' },
            ]
        },
        {
            version: '1.6.0',
            date: '2026-06-01',
            items: [
                { type: 'added', text: 'GeoPixelcons++ main panel: added Ctrl+Shift+H keyboard shortcut to toggle the main dropdown panel open and closed' },
            ]
        },
        {
            version: '1.5.0',
            date: '2026-05-25',
            items: [
                { type: 'added', text: 'Ghost Template Manager: added an "Enable owned and filtered" button beside "Enable filtered" that enables only owned ghost colors currently shown by the active search/filter controls' },
                { type: 'added', text: 'Map Movement Lock: added a settings-controlled extension that creates a right-side lock button to freeze map panning and zooming until unlocked' },
                { type: 'added', text: 'GeoPixelcons++ Settings: added a Mobile Compatibility toggle that disables draggable guild/ghost modals on mobile and makes the Ghost Menu UI Overhaul switch between controls and preview instead of squeezing both panels onscreen' },
                { type: 'fixed', text: 'Ghost Template Manager: clicking "Place on Map" now temporarily hides the ghost menu overhaul so the map is unobstructed while choosing the ghost placement point' },
                { type: 'changed', text: 'Map Movement Lock: locking movement now also suppresses page-wide browser scrolling so oversized UI cannot move the viewport separately from the map' },
            ]
        },
        {
            version: '1.4.0',
            date: '2026-05-21',
            items: [
                { type: 'added', text: 'GeoPixelcons++ Settings: new "Remember ghost template position and size" toggle — when enabled, saves and restores the ghost template modal\'s on-screen position and size across page refreshes; requires Ghost Template Manager to be enabled' },
                { type: 'changed', text: 'Ghost Palette Color Search: replaced the bulky multi-select list with a compact Filters dropdown of checkboxes; added "Hide in-progress colors" and "Hide unstarted colors" alongside the existing unmatched/completed filters' },
                { type: 'changed', text: 'Ghost Palette Color Search: search is now a compact one-line textarea that also accepts space-separated and newline-separated terms, and "Show search results first" now sits directly below it' },
                { type: 'added', text: 'Ghost Palette Color Search: new wheelable "Sort by" dropdown — sort by most/least used, most/least remaining, most/least percent remaining, or color hex; returning to Most used now re-sorts correctly after other methods' },
                { type: 'changed', text: 'Ghost Palette Color Search: Sort by is now self-labeled inside the dropdown text, matching the compact Filters control without a separate external label' },
                { type: 'changed', text: 'Ghost Palette Color Search: Filters and Sort by now stack vertically based on the actual search panel width, so narrowing the Ghost Menu UI Overhaul left panel moves Sort by below Filters even on wide screens' },
                { type: 'changed', text: 'Ghost Palette Color Search: progress-dependent filters and sort methods now hide automatically until placed/total ghost progress stats are detected, while search, unmatched filtering, most/least used, and color sorting remain available' },
                { type: 'changed', text: 'Ghost Palette Color Search: "Enable filtered" now enables the colors currently visible in the ghost palette and disables hidden colors, so it works with search plus every filter combination' },
                { type: 'fixed', text: 'Ghost Template Manager: "Remember ghost template position and size" now reapplies saved geometry after the modal layout initializes and after the native open button runs, preventing the default centered size from overwriting saved placement' },
                { type: 'changed', text: 'Ghost Template Manager: the middle divider in the Ghost Menu UI Overhaul modal can now be dragged from roughly 5% to 95% of the modal width, allowing either side to be nearly minimized or maximized' },
                { type: 'fixed', text: 'Ghost Template Manager: bottom-right modal resizing now preserves the current left/right split ratio so the whole modal feels like it is resizing instead of only expanding the left panel' },
                { type: 'added', text: 'Ghost Template Manager: Recent thumbnails now show compact inline more/less tiles when history has more than 10 images, expanding from 10 to 50 recent templates in a scrollable fixed-square grid' },
                { type: 'added', text: 'Region Screenshot: preview modal now has a Background selector with the existing transparent export plus a new solid color option; the chosen color applies to preview, download, and clipboard copy' },
                { type: 'changed', text: 'Region Screenshot: Background mode and solid color are now remembered between screenshots, including silent downloads, so repeated captures reuse the last chosen background' },
                { type: 'added', text: 'Bulk Purchase Colors: the profile queue now has the same sorting methods as the ghost palette controls, including wheel-to-change sorting and ghost-progress-aware remaining/% remaining options' },
                { type: 'changed', text: 'Bulk Purchase Colors: profile queue rows and the queue Sort by dropdown now use Tailwind-compatible theme colors so they match GeoPixels++ Simple Black and other site themes; ghost counts now show color-formatted total, placed/total, and completion percentage' },
            ]
        },
        {
            version: '1.3.25',
            date: '2026-05-18',
            items: [
                { type: 'added', text: 'Ghost Template Manager: added a draggable horizontal divider between the preview image and the action buttons — drag up/down to freely set the preview height, overriding the default aspect-ratio sizing' },
            ]
        },
        {
            version: '1.3.24',
            date: '2026-05-18',
            items: [
                { type: 'fixed', text: 'Ghost Template Manager: preview image container now uses aspect-ratio (4:3) instead of a fixed 210px height, so the preview scales taller as the user widens the right panel with the splitter' },
            ]
        },
        {
            version: '1.3.23',
            date: '2026-05-18',
            items: [
                { type: 'added', text: 'Ghost Template Manager: added a draggable panel splitter on the left edge of the preview panel — drag left to widen the right panel (giving the image preview more space), drag right to shrink it; width is remembered across collapse/expand cycles' },
            ]
        },
        {
            version: '1.3.22',
            date: '2026-05-17',
            items: [
                { type: 'added', text: 'Ghost Palette Color Search: new ♻️ \'Sync Ghost With Selected Color\' toggle button injected into the Image Tools (🖼️) dropdown — when active (green), changing the selected paint color automatically enables only that color in the ghost palette and disables all others; ignored if the color is not in the template' },
                { type: 'added', text: 'Ghost Palette Color Search: Sync Ghost button is hidden by default; enabled via a new ♻️ Sync Ghost With Selected Color row in the Extensions tab (under Additional Extensions), with the same green/red state styling as other extension rows' },
                { type: 'changed', text: 'Settings modal — Extra Settings tab: replaced all nine per-row description divs with compact inline ❓ tooltip icons; hovering shows the description in a floating tooltip, significantly reducing the tab height' },
                { type: 'changed', text: 'Settings modal — Extensions tab: removed the 🟢/🔴/🟡 status dot from all feature and extension toggle rows; enabled/disabled state is already conveyed by the toggle switch color' },
            ]
        },
        {
            version: '1.3.21',
            date: '2026-05-14',
            items: [
                { type: 'fixed', text: 'Start Shift Lock: the Find Art button now works correctly when shift-lock is active — FindRandomArt is patched to temporarily call toggleShiftDown() around each invocation, since shiftDown is a closure variable that cannot be overridden directly' },
            ]
        },
        {
            version: '1.3.20',
            date: '2026-05-13',
            items: [
                { type: 'fixed', text: 'Ghost Template Manager (overhaul): the bottom-right resize handle now correctly adjusts the modal width while the preview panel is collapsed, updating the collapsed width variable so the CSS rule does not block the resize' },
            ]
        },
        {
            version: '1.3.19',
            date: '2026-05-13',
            items: [
                { type: 'fixed', text: 'Ghost Template Manager (overhaul): rebuilt the Collapse preview / Expand preview animation so the modal and right preview panel resize together using a coordinated CSS state, avoiding the left-panel jump/reflow jank during toggles' },
            ]
        },
        {
            version: '1.3.18',
            date: '2026-05-13',
            items: [
                { type: 'fixed', text: 'Ghost Template Manager (overhaul): action buttons (Toggle All, Set Palette, Match My Palette, Bulk Purchase Colors, Enable Only Owned Ghost Colors, Get/Set Ghost Colors, Enable filtered) no longer wrap text — long labels truncate with ellipsis and the full text appears on hover' },
                { type: 'fixed', text: 'Ghost Template Manager (overhaul): clicking "Collapse preview" now shrinks the entire modal instead of expanding the left panel to fill the freed space; the modal width is restored when the right panel is re-expanded' },
            ]
        },
        {
            version: '1.3.17',
            date: '2026-05-13',
            items: [
                { type: 'fixed', text: 'Ghost Template Manager: importing a JSON history export then immediately re-opening history no longer reverses the order — entries are now inserted oldest-first so the newest-first display order is preserved after import' },
                { type: 'fixed', text: 'Ghost Template Manager: loading a template from the history modal (card click or Load & Go To) now moves that entry to the top of history to reflect recency; the recent-image strip (Ghost Menu UI Overhaul) is also refreshed to stay in sync' },
                { type: 'fixed', text: 'Ghost Template Manager: clicking a recent-image thumbnail now promotes that entry to the top of history and immediately refreshes the recent strip so the order stays accurate' },
            ]
        },
        {
            version: '1.3.16',
            date: '2026-05-12',
            items: [
                { type: 'added', text: 'Ghost Template Manager: new "Ghost Menu UI Overhaul" setting (off by default) — when enabled, removes the ✚₊ collapse toggle injected by geopixels++, makes all its hidden buttons permanently visible, and applies a unified flat slate styling to every action button under the ghost palette container' },
                { type: 'changed', text: 'Ghost Palette Color Search: removed the ✅ emoji from the "Enable filtered" button and moved it out of the search filter box into its own row above the search container, closer to the other ghost color enable/disable buttons' },
                { type: 'added', text: 'Ghost Template Manager: full modal layout overhaul (requires "Ghost Menu UI Overhaul") — widens the modal to a two-column layout with a collapsible right panel; image preview, action buttons (URL / File / History / Save Pos / Place on Map / Clear Image), and recent-image history are moved to the right panel; left panel retains scroll content (progress, filter controls, color palette)' },
                { type: 'added', text: 'Ghost Palette Color Search: "Hide completed colors" checkbox — when checked, hides all color swatches whose geopixels++ progress badge shows 100% (detected from the multiline title set by the Refresh % button); works independently of and combines with the existing "Hide unmatched colors" filter' },
                { type: 'added', text: 'Ghost Template Manager: modal is draggable from the header bar and all 4 edges (grab cursor feedback); resizable from the bottom-right SE corner handle only (guild modal pattern); initial size 800×75vh; conflicting Tailwind classes stripped so resize works without !important fights' },
                { type: 'fixed', text: 'Ghost Template Manager: ghostColorPalette max-height (Tailwind max-h-48) overridden so the palette expands freely with its content instead of capping at 192px' },
                { type: 'fixed', text: 'Ghost Template Manager: recent-image grid rows no longer spread to fill the panel height — align-content:start packs them to the top' },
                { type: 'fixed', text: 'Ghost Template Manager: close button was invisible (bg-white on bg-white header); now theme-aware with transparent background and visible hover state; falls back to a freshly created button if the site\'s onclick selector returns null' },
                { type: 'fixed', text: 'Ghost Template Manager: preview image was not showing — container detection was matching the outermost ancestor div instead of the direct parent of #ghostPreviewImage; fixed to use parentElement of the image itself' },
            ]
        },
        {
            version: '1.3.15',
            date: '2026-05-11',
            items: [
                { type: 'changed', text: 'Source refactored into modular build system (src/ + build.js) — no functional changes for end users; versioned output files are unchanged' },
            ]
        },
        {
            version: '1.3.14',
            date: '2026-05-11',
            items: [
                { type: 'added', text: 'Map Markers: re-added GIF support — upload animated GIFs as map markers; rendered as a live DOM overlay (positioned relative to the map container, using CSS-pixel coordinates to fix the zoom-level skew bug) so animation plays correctly while the canvas handles static images as before' },
            ]
        },
        {
            version: '1.3.13',
            date: '2026-05-10',
            items: [
                { type: 'removed', text: 'Map Markers: removed GIF and MP4/video upload support — file picker now accepts PNG/JPEG/WebP only; the Video URL button has been removed; all GIF/video overlay rendering code has been eliminated' },
            ]
        },
        {
            version: '1.3.12',
            date: '2026-05-10',
            items: [
                { type: 'changed', text: 'Map Markers: compact card view is now the default on open' },
                { type: 'fixed', text: 'Map Markers: drag-to-sort handle in full card view no longer blocks the opacity slider — only the ⠇ grip icon initiates a drag; the rest of the card is fully interactive' },
                { type: 'fixed', text: 'Map Markers: uploaded MP4/WebM video markers now render visibly — the data URL is converted to a blob URL before being set as the video src (browsers silently fail to play large data-URL videos); autoplay is deferred until after the element is in the DOM' },
                { type: 'fixed', text: 'Map Markers: GIF overlays no longer compress horizontally when zooming — removed contain:strict from the overlay container, which was preventing objectFit from applying correctly to img elements inside a CSS containment context' },
            ]
        },
        {
            version: '1.3.11',
            date: '2026-05-10',
            items: [
                { type: 'added', text: 'Ghost Palette Color Search: \u201cEnable filtered\u201d button next to \u201cHide unmatched colors\u201d \u2014 when clicked, every color whose hex matches the current search terms is enabled in the ghost palette and every non-matching color is disabled; also clears the \u201cShow All\u201d (disable filter) toggle if it was active' },
                { type: 'fixed', text: 'Map Markers: YouTube markers no longer use an <iframe> (blocked by site CSP frame-src) — now renders as a clickable thumbnail overlay (thumbnail fetched via GM_xmlhttpRequest to bypass img-src CSP); clicking opens the video in a new tab' },
                { type: 'removed', text: 'Map Markers: YouTube embed markers removed — the site CSP blocks both iframe embedding and direct thumbnail image loading; the workaround was too limited to be useful' },
            ]
        },
        {
            version: '1.3.10',
            date: '2026-05-10',
            items: [
                { type: 'fixed', text: 'Map Markers: image/GIF/video data now stored in IndexedDB instead of GM_setValue — eliminates the "Message exceeded maximum allowed size of 64MiB" Chrome extension runtime error that occurred when many large images were stored, which blocked all other Tampermonkey userscripts from loading' },
                { type: 'added', text: 'Map Markers: automatic one-time migration — existing marker images stored in the old GM_setValue keys are moved to IndexedDB on first load and the old keys are cleaned up' },
            ]
        },
        {
            version: '1.3.9',
            date: '2026-05-10',
            items: [
                { type: 'added', text: 'Map Markers: GIF and MP4 embeds — upload animated GIFs or MP4 videos as map markers; rendered as live DOM overlays so animation/playback is preserved (GIF plays, video autoplays muted/looped)' },
                { type: 'added', text: 'Map Markers: drag-to-sort — grab the ⠿ handle on any marker card and drag it up or down to reorder the marker rendering/list order; new order is persisted immediately' },
                { type: 'added', text: 'Map Markers: compact card view — toggle button in the modal header switches to a condensed single-row view showing thumbnail, name, and coordinates only; clicking any compact card expands it in-place to reveal the full controls' },
            ]
        },
        {
            version: '1.3.8',
            date: '2026-05-10',
            items: [
                { type: 'added', text: 'Smooth Zoom Buttons: new extra setting (on by default) — replaces the native +/− zoom buttons with a smooth zoom control: vertical slider, exact value input box, hold-to-repeat ± buttons, and scroll-wheel zoom on the widget' },
            ]
        },
        {
            version: '1.3.7',
            date: '2026-05-10',
            items: [
                { type: 'added', text: 'Map Markers: new feature \u2014 upload any PNG/JPEG/WebP/GIF image and place it as a persistent sticker on the map canvas; images scale and translate with the map in real time using the same grid coordinate system as Censor rects in GeoPixels++' },
                { type: 'added', text: 'Map Markers: \u201cPlace on Map\u201d button enters placement mode for a specific marker \u2014 hold and drag to define the bounding box; click without dragging is rejected with an instructional message' },
                { type: 'added', text: 'Map Markers: Hold Shift during placement drag to lock the image\u2019s natural aspect ratio; per-marker \ud83d\udd12/\ud83d\udd13 toggle persists the lock preference for future edits' },
                { type: 'added', text: 'Map Markers: \u201cEdit\u201d button shows 8 fixed-size handles (4 corners + 4 edge midpoints) for resizing/stretching; handles are a consistent 6\u202fpx radius regardless of map zoom level; corner drags respect the Shift / lock-aspect setting, edge midpoints stretch freely' },
                { type: 'added', text: 'Map Markers: draggable management modal with per-image thumbnail, name input, opacity slider, visibility toggle, Place / Edit / Remove actions, and placement status' },
                { type: 'added', text: 'Map Markers: images and placement state persisted via GM_setValue \u2014 survive page refreshes; image data stored per-marker under separate keys to keep the metadata payload small' },
            ]
        },
        {
            version: '1.3.6',
            date: '2026-05-09',
            items: [
                { type: 'fixed', text: 'Ghost Template Manager: loading from Image History with encoded coords placed the image at the old position \u2014 root cause: applyCoordinatesToGame called initializeGhostFromStorage before the game\'s FileReader had written ghostImageData to localStorage, so it returned early; fix: write ghostImageCoords immediately, then poll until BOTH the place button is re-enabled AND ghostImageData is present before calling initializeGhostFromStorage' },
                { type: 'fixed', text: 'Ghost Template Manager: \u2018Go To\u2019 button said \u201cNo ghost image template currently set\u201d after loading from History \u2014 ghostImageCoords is now written before the poll starts so it is always available' },
                { type: 'fixed', text: 'Ghost Template Manager: loading a new image with no encoded position cleared ghostImageCoords from localStorage \u2014 if the user had manually placed a previous image the overlay appeared positioned but saving produced no coords; coords are now only cleared by the explicit Clear button' },
                { type: 'fixed', text: 'Ghost Template Manager: \u2018Go To\u2019 button in the panel said \u201cNo ghost image template currently set\u201d after loading from History because ghostImageTopLeft (in-memory, page scope) was never set by the race-losing initializeGhostFromStorage call \u2014 fixed by the same direct-assignment approach above' },
                { type: 'fixed', text: 'Region Screenshot: screenshot filenames now use local time instead of UTC \u2014 falls back to UTC if local time formatting fails' },
            ]
        },
        {
            version: '1.3.5',
            date: '2026-05-08',
            items: [
                { type: 'changed', text: 'Paint Brush Swap: reduced to a single resize handle \u2014 top-right corner when the paint menu is at the bottom (default), bottom-right corner when the paint menu is docked to the top; height drag direction flips accordingly' },
                { type: 'added', text: 'Paint Brush Swap: \u21BA reset-size button in the footer clears the stored width/height and restores the dropdown to its natural size' },
            ]
        },
        {
            version: '1.3.4',
            date: '2026-05-08',
            items: [
                { type: 'fixed', text: 'Paint Brush Swap: collapsed brush dropdown was intercepting canvas clicks after any resize drag \u2014 the div retained its physical footprint despite being visually hidden; fixed with pointer-events:none on the closed state and pointer-events:auto on .open' },
                { type: 'fixed', text: 'Paint Brush Swap: resize drag was laggy because the CSS max-height transition kept firing on every mousemove; transitions are now disabled for the duration of the drag via a .brush-swap-resizing class and restored on mouseup' },
            ]
        },
        {
            version: '1.3.3',
            date: '2026-05-08',
            items: [
                { type: 'fixed', text: 'Paint Brush Swap: resize handles on the brush dropdown were jittery and drifting \u2014 now use capture-phase listeners, a single start-size snapshot, and set explicit width alongside maxWidth/maxHeight to match the guild panel resize behavior' },
            ]
        },
        {
            version: '1.3.2',
            date: '2026-05-08',
            items: [
                { type: 'changed', text: 'Paint Brush Swap \u2014 Export: brush list now shows as a scrollable checklist with checkboxes; Select All / Select None controls; JSON output and Copy/Download actions only include checked brushes; header updates live to show selection count' },
                { type: 'changed', text: 'Paint Brush Swap \u2014 Import: JSON is parsed on input/file-upload and immediately rendered as a scrollable checklist; only checked brushes are committed when clicking \u201cImport Selected\u201d; invalid entries still reported with a count' },
            ]
        },
        {
            version: '1.3.1',
            date: '2026-05-08',
            items: [
                { type: 'changed', text: 'Paint Brush Swap: Export/Import footer buttons now show "📤 Export" and "📥 Import" labels instead of bare arrows — same height, wider to fit the text' },
            ]
        },
        {
            version: '1.3.0',
            date: '2026-05-07',
            items: [
                { type: 'added', text: 'Paint Brush Swap: Export Brushes \u2014 \u2B06 button at the bottom of the brush dropdown opens a modal with the full brush list as JSON; copy to clipboard or download as a .json file' },
                { type: 'added', text: 'Paint Brush Swap: Import Brushes \u2014 \u2B07 button opens a modal where you can paste JSON or upload a .json file; imported brushes are appended to your existing list (no overwrites), invalid entries are skipped with a count' },
            ]
        },
        {
            version: '1.2.2',
            date: '2026-05-07',
            items: [
                { type: 'fixed', text: 'Ghost Template Manager: loading a template from Image History that was saved without coordinates threw "parameter 1 is not of type File" — images retrieved from IndexedDB are Blobs, not Files; when no encoded position is decoded the blob is now wrapped in a File before being passed to DataTransfer' },
            ]
        },
        {
            version: '1.2.1',
            date: '2026-05-06',
            items: [
                { type: 'fixed', text: 'Debug System: applyCoordinatesToGame now logs to the debug file when the place button never becomes enabled (5s timeout) or when initializeGhostFromStorage is missing from page scope — both are silent failures that previously produced no debug output' },
                { type: 'fixed', text: 'Debug System: IndexedDB open failure now rejects with a real Error object (was a bare string) and is captured in the debug log, making DB unavailability visible' },
                { type: 'fixed', text: 'Debug System: HistoryManager.getAll transaction errors now reject (instead of hanging forever) and are captured in the debug log' },
                { type: 'fixed', text: 'Debug System: cleanCanvas.toBlob inside processAndLoadImage now has a 10s timeout — if the browser never calls the callback the hang is caught, logged, and the load fails gracefully instead of stalling silently' },
            ]
        },
        {
            version: '1.2.0',
            date: '2026-05-06',
            items: [
                { type: 'added', text: 'Debug System: new "Enable Debugging" toggle in Settings — when on, a "Debug Logs" button appears in the dropdown that exports a timestamped .txt log of all caught errors with their UI component, message, and stack trace' },
                { type: 'added', text: 'Debug System: all feature initialization catch blocks, Ghost Template Manager operations (processAndLoadImage, URL upload, Save Pos, Auto-Cache, Export, Import history), and card interactions now feed into dbgPush when debugging is enabled' },
            ]
        },
        {
            version: '1.1.9',
            date: '2026-04-26',
            items: [
                { type: 'fixed', text: 'Guild XP Tracker: player markers on map showed numeric user IDs instead of display names — buildPlayerMarkerData was using the dict key (now a numeric ID) as the name; fixed to use data.name with key as fallback' },
                { type: 'added', text: 'Ghost Template Manager: selective export in Image History — ☐ per-card checkbox, Select All / Select None buttons, and "Export Selected" exports only checked templates (same JSON format; compatible with import); "Export All" removed in favour of Select All + Export Selected' },
            ]
        },
        {
            version: '1.1.8',
            date: '2026-04-26',
            items: [
                { type: 'fixed', text: 'Auto-Hover Menus: menuGroupBtn and modGroupBtn have class="... relative ..." on the button element itself — button.closest(\'.relative\') returned the button instead of the wrapper div, so parent/dropdown/isMenuOpen were all wrong and every button→dropdown mousemove re-toggled the menu closed; fixed by using button.closest(\'div.relative\'); also added _gpcOpened flag + wrapper mouseleave guard as a defensive layer against re-clicks on re-hover' },
                { type: 'fixed', text: 'Guild XP Tracker: users who rename no longer appear as LEFT + JOINED — snapshots now key by numeric user ID; display name is stored separately and stays current' },
                { type: 'fixed', text: 'Guild XP Tracker: one-time migration auto-converts old name-keyed snapshots to ID-keyed format so existing history remains valid' },
                { type: 'fixed', text: 'Brush Editor (Opera GX failsafe — pending end-user validation): after panel closes, overlay gets pointer-events:none + visibility:hidden to prevent ghost click-through on browsers that may not apply Tailwind hidden reliably' },
                { type: 'added', text: 'Brush Editor: left-click (or drag) immediately activates cells; right-click (or drag) erases — no toggle delay' },
                { type: 'added', text: 'Brush Editor: "Fill All" button beside "Reset Active Brush" — instantly activates every cell in the grid' },
            ]
        },
        {
            version: '1.1.7',
            date: '2026-04-19',
            items: [
                { type: 'added', text: 'Setting: Disable Group Noise — permanently unchecks and grays out the "Group Noise" toggle in the ghost modal' },
                { type: 'added', text: 'Setting: Start in Shift Lock — auto-enables Shift Lock on page load' },
                { type: 'added', text: 'Setting: Start in Inspect Mode — auto-switches to Inspect Mode on page load' },
                { type: 'added', text: 'Changelog modal accessible from the GeoPixelcons++ dropdown menu' },
            ]
        },
        {
            version: '1.1.6',
            date: '2026-04-19',
            items: [
                { type: 'renamed', text: 'Extension: "Janny Tools" renamed to "Janitor View" throughout' },
                { type: 'added', text: 'Setting: Compact Paint Controls — moves ✕ close and 🖌️ brushes buttons above the paint modal as compact icons' },
                { type: 'added', text: 'Compact brush button forwards scroll-to-swap wheel events' },
                { type: 'added', text: 'Compact brush dropdown repositioned via fixed positioning on document.body to avoid transform issues' },
                { type: 'added', text: 'Compact ✕ button positioned absolutely to the right of the topBar, isolated from centered buttons' },
                { type: 'improved', text: 'Ghost template colors now sorted by pixel count (most used → least used) in both bulk purchase paths' },
                { type: 'added', text: 'Bulk purchase modal and profile queue now show ghost template pixel counts per color (purple labels)' },
                { type: 'added', text: 'Legend in bulk purchase modal: "Purple numbers = pixels used in the loaded ghost template"' },
                { type: 'added', text: 'Ghost palette MutationObserver auto-refreshes queue ghost counts when template is loaded/unloaded' },
            ]
        },
        {
            version: '1.1.4',
            date: '2026-04-18',
            items: [
                { type: 'added', text: 'Extension: Janitor View — reveals the hidden moderation button for janitors/moderators' },
                { type: 'fixed', text: 'VERSION constant now correctly synced with @version header (was stuck at 1.0.3)' },
            ]
        },
        {
            version: '1.1.3',
            date: '2026-04-17',
            items: [
                { type: 'note', text: 'Version bump — identical to 1.0.3 (header version sync)' },
            ]
        },
        {
            version: '1.0.3',
            date: '2026-04-17',
            items: [
                { type: 'fixed', text: 'Guild Overhaul: auto-center panel on open — fixes draggable guild panel getting stuck off-screen' },
                { type: 'improved', text: 'Bulk Purchase: newly purchased colors are now automatically added to the active palette' },
            ]
        },
        {
            version: '1.0.2',
            date: '2026-04-16',
            items: [
                { type: 'added', text: 'Paint Brush Swap: click-to-expand brush preview grids (36×36 → 120×120)' },
                { type: 'added', text: 'Brush preview tooltip on hover ("click to expand")' },
                { type: 'fixed', text: 'Region Screenshot & Regions Highscore: no longer re-enable doubleClickZoom (respects site default)' },
            ]
        },
        {
            version: '1.0.0',
            date: '2026-04-15',
            items: [
                { type: 'note', text: 'Initial release — unified enhancement suite' },
                { type: 'added', text: 'Features: Bulk Purchase Colors, Ghost Palette Search, Ghost Template Manager, Guild Overhaul, Paint Menu Controls, Paint Brush Swap, Region Screenshot, Regions Highscore, Theme Editor' },
                { type: 'added', text: 'Extensions: Auto-open Menus on Hover, Auto-Go to Last Location, Hover Labels' },
                { type: 'added', text: 'Settings modal with per-feature toggles, status indicators, and emoji icon option' },
            ]
        },
    ];

    function showChangelog() {
        const existing = document.getElementById('gpc-changelog-modal');
        if (existing) existing.remove();

        const dark = isDarkMode();
        const overlay = document.createElement('div');
        overlay.id = 'gpc-changelog-modal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';

        const TYPE_COLORS = {
            added:    { bg: dark ? '#052e16' : '#f0fdf4', text: dark ? '#4ade80' : '#166534', label: 'NEW' },
            improved: { bg: dark ? '#1e1b4b' : '#eef2ff', text: dark ? '#818cf8' : '#4338ca', label: 'IMPROVED' },
            fixed:    { bg: dark ? '#422006' : '#fffbeb', text: dark ? '#fbbf24' : '#92400e', label: 'FIX' },
            renamed:  { bg: dark ? '#164e63' : '#ecfeff', text: dark ? '#22d3ee' : '#0e7490', label: 'RENAMED' },
            changed:  { bg: dark ? '#1c1917' : '#fafaf9', text: dark ? '#a8a29e' : '#57534e', label: 'CHANGED' },
            removed:  { bg: dark ? '#450a0a' : '#fff1f2', text: dark ? '#f87171' : '#9f1239', label: 'REMOVED' },
            note:     { bg: dark ? '#1e293b' : '#f8fafc', text: dark ? '#94a3b8' : '#64748b', label: 'NOTE' },
        };

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: ${dark ? '#1e1e2e' : '#ffffff'};
            color: ${dark ? '#cdd6f4' : '#1e293b'};
            border-radius: 16px;
            width: 90%;
            max-width: 560px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 20px 24px 16px;
            border-bottom: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        `;
        const title = document.createElement('h2');
        title.style.cssText = 'margin:0;font-size:1.25rem;font-weight:700;';
        title.textContent = '📋 Changelog';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = `width:2rem;height:2rem;border-radius:50%;border:none;background:${dark ? '#45475a' : '#f1f5f9'};cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;color:${dark ? '#cdd6f4' : '#64748b'};`;
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => overlay.remove());
        header.appendChild(title);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // ── Filter bar ────────────────────────────────────────────────
        // Collect every type that actually appears in the changelog data
        const allTypes = [...new Set(
            CHANGELOG.flatMap(r => r.items.map(it => it.type))
        )];
        // Canonical display order; unknown types appended at the end
        const typeOrder = ['added','fixed','improved','changed','removed','renamed','note'];
        allTypes.sort((a, b) => {
            const ai = typeOrder.indexOf(a), bi = typeOrder.indexOf(b);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        const filterBar = document.createElement('div');
        filterBar.style.cssText = `display:flex;flex-wrap:wrap;gap:6px;padding:10px 24px;border-bottom:1px solid ${dark ? '#45475a' : '#e2e8f0'};flex-shrink:0;`;

        // activeTypes tracks which labels are enabled (all on by default)
        const activeTypes = new Set(allTypes);

        function applyFilters() {
            body.querySelectorAll('[data-cl-type]').forEach(row => {
                row.style.display = activeTypes.has(row.dataset.clType) ? '' : 'none';
            });
            // Hide version headers whose every item is hidden
            body.querySelectorAll('[data-cl-section]').forEach(section => {
                const rows = section.querySelectorAll('[data-cl-type]');
                const anyVisible = [...rows].some(r => r.style.display !== 'none');
                section.style.display = anyVisible ? '' : 'none';
            });
        }

        allTypes.forEach(type => {
            const tc = TYPE_COLORS[type] || TYPE_COLORS.note;
            const chip = document.createElement('button');
            chip.style.cssText = `font-size:0.6rem;font-weight:700;padding:3px 8px;border-radius:4px;border:none;cursor:pointer;transition:opacity .15s;background:${tc.text}18;color:${tc.text};`;
            chip.textContent = tc.label;
            chip.title = `Toggle ${tc.label} entries`;
            chip.dataset.active = '1';
            chip.addEventListener('click', () => {
                if (activeTypes.has(type)) {
                    activeTypes.delete(type);
                    chip.dataset.active = '0';
                    chip.style.opacity = '0.35';
                } else {
                    activeTypes.add(type);
                    chip.dataset.active = '1';
                    chip.style.opacity = '1';
                }
                applyFilters();
            });
            filterBar.appendChild(chip);
        });

        modal.appendChild(filterBar);

        // Body (scrollable)
        const body = document.createElement('div');
        body.style.cssText = 'overflow-y:auto;padding:16px 24px 24px;flex:1;';

        CHANGELOG.forEach((release, i) => {
            const section = document.createElement('div');
            section.dataset.clSection = release.version;
            section.style.cssText = `margin-bottom:${i < CHANGELOG.length - 1 ? '20px' : '0'};`;

            const versionHeader = document.createElement('div');
            versionHeader.style.cssText = `display:flex;align-items:center;gap:10px;margin-bottom:10px;`;
            const vBadge = document.createElement('span');
            vBadge.style.cssText = `font-size:0.95rem;font-weight:700;color:${dark ? '#cba6f7' : '#7c3aed'};`;
            vBadge.textContent = 'v' + release.version;
            const vDate = document.createElement('span');
            vDate.style.cssText = `font-size:0.75rem;color:${dark ? '#6c7086' : '#94a3b8'};`;
            vDate.textContent = release.date;
            versionHeader.appendChild(vBadge);
            versionHeader.appendChild(vDate);
            if (i === 0) {
                const currentBadge = document.createElement('span');
                currentBadge.style.cssText = `font-size:0.6rem;font-weight:700;padding:2px 6px;border-radius:4px;background:${dark ? '#22c55e33' : '#dcfce7'};color:${dark ? '#4ade80' : '#166534'};`;
                currentBadge.textContent = 'CURRENT';
                versionHeader.appendChild(currentBadge);
            }
            section.appendChild(versionHeader);

            release.items.forEach(item => {
                const tc = TYPE_COLORS[item.type] || TYPE_COLORS.note;
                const row = document.createElement('div');
                row.dataset.clType = item.type;
                row.style.cssText = `display:flex;align-items:flex-start;gap:8px;padding:5px 8px;margin-bottom:3px;border-radius:6px;background:${tc.bg};`;
                const badge = document.createElement('span');
                badge.style.cssText = `font-size:0.55rem;font-weight:700;padding:2px 5px;border-radius:3px;color:${tc.text};background:${tc.text}18;white-space:nowrap;margin-top:2px;flex-shrink:0;`;
                badge.textContent = tc.label;
                const text = document.createElement('span');
                text.style.cssText = `font-size:0.8rem;color:${dark ? '#bac2de' : '#334155'};line-height:1.4;`;
                text.textContent = item.text;
                row.appendChild(badge);
                row.appendChild(text);
                section.appendChild(row);
            });

            if (i < CHANGELOG.length - 1) {
                const divider = document.createElement('div');
                divider.style.cssText = `height:1px;background:${dark ? '#45475a' : '#e2e8f0'};margin-top:16px;`;
                section.appendChild(divider);
            }

            body.appendChild(section);
        });

        modal.appendChild(body);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ============================================================
    //  UI: CONTROLS-LEFT SUBMENU
    // ============================================================
    function waitForControlsLeft(cb) {
        const el = document.getElementById('controls-left');
        if (el) return cb(el);
        setTimeout(() => waitForControlsLeft(cb), 500);
    }

    waitForControlsLeft((controlsLeft) => {
        // Create the group container
        const group = document.createElement('div');
        group.className = 'relative';

        // Main button
        const mainBtn = document.createElement('button');
        mainBtn.id = 'geopixelconsGroupBtn';
        mainBtn.className = 'w-10 h-10 bg-white shadow rounded-full flex items-center justify-center hover:bg-gray-100 cursor-pointer';
        mainBtn.title = 'GeoPixelcons++';
        const _iconBg = 'url(data:image/png;base64,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);background-size:cover;background-position:center;border:none;padding:0;';

        // Apply icon to button
        mainBtn.style.cssText = 'background-image:' + _iconBg;
        mainBtn.dataset.iconBg = _iconBg.substring(0, _iconBg.indexOf(');') + 1);
        if (_settings.useEmojiIcon) {
            mainBtn.style.backgroundImage = 'none';
            mainBtn.textContent = '😢';
            mainBtn.style.fontSize = '20px';
        }

        // Dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-menu absolute left-0 mt-2 flex flex-col gap-2 transition-all duration-150 ease-out opacity-0 scale-95 hidden';

        // ── Theme-aware color tokens for the dropdown UI ──
        // Use CSS custom properties so colors follow GeoPixels++ theme changes live
        const C = {
            pillBg:      'var(--color-white, #fff)',
            pillHover:   'var(--color-gray-100, #f3f4f6)',
            pillText:    'var(--color-gray-700, #374151)',
            flyBg:       'var(--color-white, #fff)',
            flyHover:    'var(--color-gray-100, #f3f4f6)',
            flyText:     'var(--color-gray-700, #374151)',
            flyMuted:    'var(--color-gray-500, #6b7280)',
            inputBg:     'var(--color-white, #fff)',
            inputBorder: 'var(--color-gray-300, #d1d5db)',
            inputText:   'var(--color-gray-900, #111827)',
            shadow:      '0 1px 3px rgba(0,0,0,.12)',
            activeBg:    'var(--color-green-100, #bbf7d0)',
            activeText:  'var(--color-green-800, #166534)',
            teBtnBg:     'var(--color-purple-500, #7c3aed)',
            teBtnText:   'var(--color-purple-50, #f3e8ff)',
            teActiveBg:  'var(--color-purple-400, #c4b5fd)',
            teInactiveBg:'var(--color-white, #fff)',
            teHover:     'var(--color-purple-100, #ede9fe)',
            navBg:       'var(--color-white, #fff)',
            navText:     'var(--color-gray-500, #6b7280)',
        };
        dropdown.id = 'geopixelconsDropdown';

        function openDropdown() {
            // Refresh debug button label with current log count (only when debugging is on)
            if (_settings.enableDebug) {
                const _dbgLabelSpan = document.querySelector('#gpc-debug-dropdown-btn span:nth-child(2)');
                if (_dbgLabelSpan) _dbgLabelSpan.textContent = `Debug Logs (${dbgCount()})`;
            }
            dropdown.classList.remove('hidden');
            setTimeout(() => {
                dropdown.classList.remove('opacity-0', 'scale-95');
            }, 10);
        }
        function closeDropdown() {
            dropdown.classList.add('opacity-0', 'scale-95');
            setTimeout(() => {
                dropdown.classList.add('hidden');
            }, 150);
        }

        mainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close other dropdowns using the site's function if available
            if (typeof closeAllDropdowns === 'function') {
                closeAllDropdowns();
            } else {
                document.querySelectorAll('.dropdown-menu').forEach(d => {
                    if (d !== dropdown && !d.classList.contains('hidden')) {
                        d.classList.add('opacity-0', 'scale-95');
                        setTimeout(() => d.classList.add('hidden'), 150);
                    }
                });
            }
            const isOpen = !dropdown.classList.contains('hidden');
            if (isOpen) closeDropdown(); else openDropdown();
        });

        function makeSubBtn(icon, label, onClick) {
            const btn = document.createElement('button');
            btn.className = 'gpc-pill-btn';
            btn.title = label;
            btn.style.cssText = 'position:relative;width:40px;height:40px;border-radius:9999px;background:'+C.pillBg+';box-shadow:'+C.shadow+';display:flex;align-items:center;justify-content:flex-start;border:none;cursor:pointer;overflow:hidden;transition:width .25s cubic-bezier(.4,0,.2,1);padding:0;font-size:16px;flex-shrink:0;';
            const iconSpan = document.createElement('span');
            iconSpan.style.cssText = 'width:40px;min-width:40px;text-align:center;flex-shrink:0;line-height:40px;';
            iconSpan.textContent = icon;
            const labelSpan = document.createElement('span');
            labelSpan.style.cssText = 'white-space:nowrap;font-size:12px;font-weight:600;color:'+C.pillText+';opacity:0;transition:opacity .2s .05s;padding-right:12px;pointer-events:none;';
            labelSpan.textContent = label;
            btn.appendChild(iconSpan);
            btn.appendChild(labelSpan);
            btn.addEventListener('mouseenter', () => {
                const textW = labelSpan.scrollWidth + 12;
                btn.style.width = (40 + textW) + 'px';
                labelSpan.style.opacity = '1';
                btn.style.background = C.pillHover;
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.width = '40px';
                labelSpan.style.opacity = '0';
                btn.style.background = C.pillBg;
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                btn.style.width = '40px';
                labelSpan.style.opacity = '0';
                btn.style.background = C.pillBg;
                closeDropdown();
                onClick();
            });
            return btn;
        }

        // ─── Shared flyout close registry (only one open at a time) ──
        const _flyoutClosers = [];
        function closeAllFlyouts() { for (const fn of _flyoutClosers) fn(); }

        // ─── Shared flyout builder for Screenshot / Highscore ─────────
        function buildFeatureFlyout(opts) {
            // opts: { id, icon, title, featureKey, getModule, color }
            const group = document.createElement('div');
            group.style.cssText = 'position:relative;';

            const mainBtn = document.createElement('button');
            mainBtn.className = 'gpc-pill-btn';
            mainBtn.title = opts.title;
            mainBtn.style.cssText = 'position:relative;width:40px;height:40px;border-radius:9999px;background:'+C.pillBg+';box-shadow:'+C.shadow+';display:flex;align-items:center;justify-content:flex-start;border:none;cursor:pointer;overflow:hidden;transition:width .25s cubic-bezier(.4,0,.2,1);padding:0;font-size:16px;flex-shrink:0;';
            mainBtn.id = 'gpc-' + opts.id + '-sub';
            const mainIcon = document.createElement('span');
            mainIcon.style.cssText = 'width:40px;min-width:40px;text-align:center;flex-shrink:0;line-height:40px;';
            mainIcon.textContent = opts.icon;
            const mainLabel = document.createElement('span');
            mainLabel.style.cssText = 'white-space:nowrap;font-size:12px;font-weight:600;color:'+C.pillText+';opacity:0;transition:opacity .2s .05s;padding-right:12px;pointer-events:none;';
            mainLabel.textContent = opts.title;
            mainBtn.appendChild(mainIcon);
            mainBtn.appendChild(mainLabel);
            mainBtn.addEventListener('mouseenter', () => {
                if (flyoutOpen) return;
                const textW = mainLabel.scrollWidth + 12;
                mainBtn.style.width = (40 + textW) + 'px';
                mainLabel.style.opacity = '1';
                mainBtn.style.background = C.pillHover;
            });
            mainBtn.addEventListener('mouseleave', () => {
                mainBtn.style.width = '40px';
                mainLabel.style.opacity = '0';
                mainBtn.style.background = C.pillBg;
            });
            function collapsePill() {
                mainBtn.style.width = '40px';
                mainLabel.style.opacity = '0';
                mainBtn.style.background = C.pillBg;
            }

            const flyout = document.createElement('div');
            flyout.id = 'gpc-' + opts.id + '-flyout';
            Object.assign(flyout.style, {
                position: 'absolute', left: 'calc(100% + 8px)', top: '0',
                transform: 'scale(0.95)',
                display: 'flex', flexDirection: 'column', gap: '4px',
                transition: 'all 0.15s ease-out',
                opacity: '0', pointerEvents: 'none', zIndex: '21',
            });
            let flyoutOpen = false;

            const flyBtnStyle = 'display:flex;align-items:center;gap:6px;min-width:200px;padding:5px 10px;background:'+C.flyBg+';box-shadow:'+C.shadow+';border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:500;color:'+C.flyText+';white-space:nowrap;height:28px;transition:background .12s;';
            const flyBtnActiveStyle = flyBtnStyle.replace('background:'+C.flyBg,'background:'+C.activeBg).replace('color:'+C.flyText,'color:'+C.activeText);

            function makeFlyBtn(label, emoji, onClick, extraId) {
                const btn = document.createElement('button');
                btn.style.cssText = flyBtnStyle;
                btn.innerHTML = emoji + ' ' + label;
                if (extraId) btn.id = extraId;
                btn.addEventListener('mouseenter', () => { if (!btn.dataset.active) btn.style.background = C.flyHover; });
                btn.addEventListener('mouseleave', () => { if (!btn.dataset.active) btn.style.background = C.flyBg; });
                btn.addEventListener('click', (e) => { e.stopPropagation(); closeFly(); closeDropdown(); onClick(); });
                return btn;
            }

            function closeFly() {
                flyoutOpen = false;
                flyout.style.opacity = '0';
                flyout.style.pointerEvents = 'none';
                flyout.style.transform = 'scale(0.95)';
            }

            // ── 1) Select Area (ad-hoc drag) ──
            flyout.appendChild(makeFlyBtn('Select Area', '🔲', () => {
                const triggerBtn = document.getElementById('gpc-' + opts.id + '-trigger');
                if (triggerBtn) triggerBtn.click();
            }));

            // ── 2) Pick Points (click two corners) ──
            flyout.appendChild(makeFlyBtn('Pick Points', '📌', () => {
                startPickPointsMode(opts);
            }));

            // ── 3) Input Coords ──
            const coordForm = document.createElement('div');
            Object.assign(coordForm.style, {
                display: 'flex', flexDirection: 'column', gap: '4px',
                minWidth: '200px', padding: '6px 10px',
                background: C.flyBg, boxShadow: C.shadow,
                borderRadius: '6px', fontSize: '11px',
            });
            const cached = loadCachedCoords();
            const _inputSt = 'width:60px;padding:2px 4px;border:1px solid '+C.inputBorder+';border-radius:4px;font-size:11px;background:'+C.inputBg+';color:'+C.inputText+';';
            coordForm.innerHTML =
                '<div style="font-weight:600;color:'+C.flyText+';margin-bottom:2px;">📝 Input Coords</div>' +
                '<div style="display:flex;gap:4px;align-items:center;">' +
                '  <span style="width:22px;color:'+C.flyMuted+';font-size:10px;">NW</span>' +
                '  <input id="gpc-' + opts.id + '-nw-x" type="number" placeholder="X" style="'+_inputSt+'" value="' + (cached ? cached.minX : '') + '">' +
                '  <input id="gpc-' + opts.id + '-nw-y" type="number" placeholder="Y" style="'+_inputSt+'" value="' + (cached ? cached.maxY : '') + '">' +
                '</div>' +
                '<div style="display:flex;gap:4px;align-items:center;">' +
                '  <span style="width:22px;color:'+C.flyMuted+';font-size:10px;">SE</span>' +
                '  <input id="gpc-' + opts.id + '-se-x" type="number" placeholder="X" style="'+_inputSt+'" value="' + (cached ? cached.maxX : '') + '">' +
                '  <input id="gpc-' + opts.id + '-se-y" type="number" placeholder="Y" style="'+_inputSt+'" value="' + (cached ? cached.minY : '') + '">' +
                '</div>' +
                '<button id="gpc-' + opts.id + '-coord-go" style="margin-top:2px;padding:4px 8px;background:' + (opts.color || '#3b82f6') + ';color:white;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Go</button>';
            coordForm.addEventListener('click', (e) => e.stopPropagation());
            flyout.appendChild(coordForm);

            // Wire the Go button after appending
            setTimeout(() => {
                const goBtn = document.getElementById('gpc-' + opts.id + '-coord-go');
                if (goBtn) goBtn.addEventListener('click', () => {
                    const minX = parseInt(document.getElementById('gpc-' + opts.id + '-nw-x').value);
                    const maxY = parseInt(document.getElementById('gpc-' + opts.id + '-nw-y').value);
                    const maxX = parseInt(document.getElementById('gpc-' + opts.id + '-se-x').value);
                    const minY = parseInt(document.getElementById('gpc-' + opts.id + '-se-y').value);
                    if ([minX, maxY, maxX, minY].some(isNaN)) return;
                    const bounds = { minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minY: Math.min(minY, maxY), maxY: Math.max(minY, maxY) };
                    saveCachedCoords(bounds);
                    closeFly(); closeDropdown();
                    const mod = opts.getModule();
                    if (mod && mod.processWithBounds) mod.processWithBounds(bounds);
                });
            }, 0);

            // ── 4) Auto-screenshot toggle (screenshot only) ──
            if (opts.id === 'screenshot') {
                const autoBtn = document.createElement('button');
                autoBtn.id = 'gpc-auto-screenshot-btn';
                const isOn = isAutoScreenshotEnabled() && loadCachedCoords();
                autoBtn.style.cssText = isOn ? flyBtnActiveStyle : flyBtnStyle;
                autoBtn.innerHTML = '📷 Auto-save on paint';
                if (isOn) autoBtn.dataset.active = '1';
                autoBtn.title = 'Takes a screenshot of the cached area every time you paint. Requires Input Coords.';
                autoBtn.addEventListener('mouseenter', () => { if (!autoBtn.dataset.active) autoBtn.style.background = C.flyHover; });
                autoBtn.addEventListener('mouseleave', () => { if (!autoBtn.dataset.active) autoBtn.style.background = isAutoScreenshotEnabled() && loadCachedCoords() ? C.activeBg : C.flyBg; });
                autoBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const coords = loadCachedCoords();
                    if (!coords) {
                        _gpcNotify('Set coords first (Input Coords or Pick Points).', true);
                        return;
                    }
                    const nowOn = !isAutoScreenshotEnabled();
                    setAutoScreenshot(nowOn);
                    autoBtn.style.cssText = nowOn ? flyBtnActiveStyle : flyBtnStyle;
                    if (nowOn) { autoBtn.dataset.active = '1'; autoBtn.innerHTML = '📷 Auto-save on paint ✅'; }
                    else { delete autoBtn.dataset.active; autoBtn.innerHTML = '📷 Auto-save on paint'; }
                    _gpcNotify(nowOn ? 'Auto-screenshot ON' : 'Auto-screenshot OFF');
                });
                flyout.appendChild(autoBtn);
            }

            _flyoutClosers.push(closeFly);

            mainBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                collapsePill();
                const wasOpen = flyoutOpen;
                closeAllFlyouts();
                if (!wasOpen) {
                    flyoutOpen = true;
                    // Refresh cached coord values in inputs
                    const cc = loadCachedCoords();
                    const setVal = (suffix, val) => { const el = document.getElementById('gpc-' + opts.id + '-' + suffix); if (el) el.value = val ?? ''; };
                    setVal('nw-x', cc?.minX); setVal('nw-y', cc?.maxY); setVal('se-x', cc?.maxX); setVal('se-y', cc?.minY);
                    flyout.style.opacity = '1'; flyout.style.pointerEvents = 'auto'; flyout.style.transform = 'scale(1)';
                    // Refresh auto-screenshot button state
                    const ab = document.getElementById('gpc-auto-screenshot-btn');
                    if (ab) {
                        const isOn = isAutoScreenshotEnabled() && loadCachedCoords();
                        ab.style.cssText = isOn ? flyBtnActiveStyle : flyBtnStyle;
                        ab.innerHTML = isOn ? '📷 Auto-save on paint ✅' : '📷 Auto-save on paint';
                        if (isOn) ab.dataset.active = '1'; else delete ab.dataset.active;
                    }
                }
            });
            document.addEventListener('click', (e) => { if (flyoutOpen && !group.contains(e.target)) closeFly(); });

            group.appendChild(mainBtn);
            group.appendChild(flyout);
            return group;
        }

        // ─── Shared "Pick Points" mode ──────────────────────────────
        let _pickState = null;

        function startPickPointsMode(opts) {
            if (_pickState) cleanupPickPoints();
            const map = _getMapRef();
            if (!map) { _gpcNotify('Map not ready.', true); return; }

            _pickState = { opts, step: 0, markers: [], handler: null, keyHandler: null };
            _gpcNotify('Click top-left corner…');
            document.body.style.cursor = 'crosshair';

            _pickState.handler = function(e) {
                const gSize = (typeof gridSize !== 'undefined') ? gridSize : 25;
                const merc = turf.toMercator([e.lngLat.lng, e.lngLat.lat]);
                const gx = Math.round(merc[0] / gSize);
                const gy = Math.round(merc[1] / gSize);

                if (_pickState.step === 0) {
                    _pickState.p1 = { x: gx, y: gy };
                    // Add marker
                    const el = _createPickMarker('NW', '#ef4444');
                    const marker = new maplibregl.Marker({ element: el }).setLngLat(e.lngLat).addTo(map);
                    _pickState.markers.push(marker);
                    _pickState.step = 1;
                    _gpcNotify('Click bottom-right corner…');
                } else {
                    _pickState.p2 = { x: gx, y: gy };
                    const el = _createPickMarker('SE', '#3b82f6');
                    const marker = new maplibregl.Marker({ element: el }).setLngLat(e.lngLat).addTo(map);
                    _pickState.markers.push(marker);

                    const p1 = _pickState.p1, p2 = _pickState.p2;
                    const bounds = {
                        minX: Math.min(p1.x, p2.x), maxX: Math.max(p1.x, p2.x),
                        minY: Math.min(p1.y, p2.y), maxY: Math.max(p1.y, p2.y),
                    };
                    saveCachedCoords(bounds);
                    cleanupPickPoints();
                    _gpcNotify('Coords applied! (' + bounds.minX + ',' + bounds.maxY + ') → (' + bounds.maxX + ',' + bounds.minY + ')');
                }
            };

            _pickState.keyHandler = function(e) {
                if (e.key === 'Escape') { cleanupPickPoints(); _gpcNotify('Cancelled.'); }
            };

            map.on('click', _pickState.handler);
            document.addEventListener('keydown', _pickState.keyHandler);
        }

        function cleanupPickPoints() {
            if (!_pickState) return;
            const map = _getMapRef();
            if (map) {
                if (_pickState.handler) map.off('click', _pickState.handler);
            }
            for (const m of _pickState.markers) m.remove();
            if (_pickState.keyHandler) document.removeEventListener('keydown', _pickState.keyHandler);
            document.body.style.cursor = '';
            _pickState = null;
        }

        function _createPickMarker(label, color) {
            const el = document.createElement('div');
            el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;';
            el.innerHTML =
                '<svg width="28" height="40" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="' + color + '"/><circle cx="12" cy="11" r="4.5" fill="white"/></svg>' +
                '<span style="font-size:10px;font-weight:700;color:' + color + ';text-shadow:0 0 2px white,0 0 2px white;">' + label + '</span>';
            return el;
        }

        function _getMapRef() {
            try { const m = (0, eval)('map'); if (m && typeof m.setStyle === 'function') return m; } catch {}
            if (typeof unsafeWindow !== 'undefined') { try { const m = unsafeWindow.eval('map'); if (m && typeof m.setStyle === 'function') return m; } catch {} }
            return null;
        }

        function _gpcNotify(msg, isError) {
            const existing = document.getElementById('gpc-flyout-toast'); if (existing) existing.remove();
            const toast = document.createElement('div'); toast.id = 'gpc-flyout-toast'; toast.textContent = msg;
            Object.assign(toast.style, { position:'fixed',top:'70px',left:'50%',transform:'translateX(-50%)',background:isError?'#fca5a5':'#bbf7d0',color:isError?'#7f1d1d':'#166534',padding:'8px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'600',zIndex:'100001',boxShadow:'0 4px 12px rgba(0,0,0,.2)',transition:'opacity .3s',fontFamily:"system-ui,sans-serif" });
            document.body.appendChild(toast); setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
        }

        // Screenshot button with flyout (only if enabled)
        if (_settings.regionScreenshot) {
            dropdown.appendChild(buildFeatureFlyout({
                id: 'screenshot', icon: '📸', title: 'Region Screenshot',
                featureKey: 'regionScreenshot', color: '#10b981',
                getModule: () => _regionScreenshot,
            }));
        }

        // Highscore button with flyout (only if enabled)
        if (_settings.regionsHighscore) {
            dropdown.appendChild(buildFeatureFlyout({
                id: 'highscore', icon: '🏆', title: 'Region Highscore',
                featureKey: 'regionsHighscore', color: '#3b82f6',
                getModule: () => _regionsHighscore,
            }));
        }

        // Theme Editor button with right-expanding flyout (only if enabled)
        // Note: _themeEditor is populated later by the feature module, so we
        // only check it lazily (on click), not at dropdown-build time.
        if (_settings.themeEditor) {
            const teGroup = document.createElement('div');
            teGroup.style.cssText = 'position:relative;';

            const teBtn = document.createElement('button');
            teBtn.className = 'gpc-pill-btn';
            teBtn.title = 'Theme Editor';
            teBtn.style.cssText = 'position:relative;width:40px;height:40px;border-radius:9999px;background:'+C.pillBg+';box-shadow:'+C.shadow+';display:flex;align-items:center;justify-content:flex-start;border:none;cursor:pointer;overflow:hidden;transition:width .25s cubic-bezier(.4,0,.2,1);padding:0;font-size:16px;flex-shrink:0;';
            teBtn.id = 'gpc-theme-sub';
            const teIcon = document.createElement('span');
            teIcon.style.cssText = 'width:40px;min-width:40px;text-align:center;flex-shrink:0;line-height:40px;';
            teIcon.textContent = '🎨';
            const teLabelSpan = document.createElement('span');
            teLabelSpan.style.cssText = 'white-space:nowrap;font-size:12px;font-weight:600;color:'+C.pillText+';opacity:0;transition:opacity .2s .05s;padding-right:12px;pointer-events:none;';
            teLabelSpan.textContent = 'Theme Editor';
            teBtn.appendChild(teIcon);
            teBtn.appendChild(teLabelSpan);
            teBtn.addEventListener('mouseenter', () => {
                if (teFlyoutOpen) return;
                const textW = teLabelSpan.scrollWidth + 12;
                teBtn.style.width = (40 + textW) + 'px';
                teLabelSpan.style.opacity = '1';
                teBtn.style.background = C.pillHover;
            });
            teBtn.addEventListener('mouseleave', () => {
                teBtn.style.width = '40px';
                teLabelSpan.style.opacity = '0';
                teBtn.style.background = C.pillBg;
            });
            function teCollapsePill() {
                teBtn.style.width = '40px';
                teLabelSpan.style.opacity = '0';
                teBtn.style.background = C.pillBg;
            }

            const teFlyout = document.createElement('div');
            teFlyout.id = 'gpc-theme-flyout';
            Object.assign(teFlyout.style, {
                position: 'absolute', left: 'calc(100% + 8px)', top: '0',
                transform: 'scale(0.95)',
                display: 'flex', flexDirection: 'column', gap: '3px',
                transition: 'all 0.15s ease-out',
                opacity: '0', pointerEvents: 'none', zIndex: '21',
            });

            let teFlyoutOpen = false;
            let teSubPage = 0;
            const TE_PER_PAGE = 4;

            function _escHTML(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

            function renderThemeFlyout() {
                teFlyout.innerHTML = '';
                if (!_themeEditor) return;
                const themes = _themeEditor.loadThemes();
                const activeName = _themeEditor.getActiveThemeName();
                const allNames = Object.keys(themes).sort((a, b) => {
                    const pa = a === 'Default' ? 0 : a === 'Default Dark' ? 1 : 2;
                    const pb = b === 'Default' ? 0 : b === 'Default Dark' ? 1 : 2;
                    return pa !== pb ? pa - pb : a.localeCompare(b);
                });
                const totalPages = Math.max(1, Math.ceil(allNames.length / TE_PER_PAGE));
                if (teSubPage >= totalPages) teSubPage = 0;
                const start = teSubPage * TE_PER_PAGE;
                const page = allNames.slice(start, start + TE_PER_PAGE);

                for (const name of page) {
                    const theme = themes[name];
                    const isActive = name === activeName;
                    const btn = document.createElement('button');
                    Object.assign(btn.style, {
                        display: 'flex', alignItems: 'center', gap: '6px',
                        minWidth: '130px', maxWidth: '190px', padding: '4px 8px',
                        background: isActive ? C.teActiveBg : C.teInactiveBg,
                        boxShadow: C.shadow,
                        borderRadius: '6px', border: 'none', cursor: 'pointer',
                        fontSize: '11px', fontWeight: isActive ? '700' : '500',
                        color: isActive ? C.teBtnText : C.flyText,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        transition: 'background .12s', height: '28px',
                    });
                    const bgColor = theme.overrides?.['background::background-color'] || theme.overrides?.['water::fill-color'] || '#808080';
                    btn.innerHTML = '<span style="width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.15);flex-shrink:0;background:' + bgColor + '"></span>' + _escHTML(name);
                    btn.title = name;
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await _themeEditor.applyThemeByName(name);
                        renderThemeFlyout();
                    });
                    btn.addEventListener('mouseenter', () => { if (!isActive) btn.style.background = C.teHover; });
                    btn.addEventListener('mouseleave', () => { if (!isActive) btn.style.background = C.teInactiveBg; });
                    teFlyout.appendChild(btn);
                }

                if (totalPages > 1) {
                    const nav = document.createElement('button');
                    Object.assign(nav.style, {
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: '130px', maxWidth: '190px', padding: '3px 8px',
                        background: C.navBg, boxShadow: C.shadow,
                        borderRadius: '6px', border: 'none', cursor: 'pointer',
                        fontSize: '10px', color: C.navText, height: '22px', transition: 'background .12s',
                    });
                    nav.textContent = '▸ ' + (teSubPage + 1) + '/' + totalPages;
                    nav.title = 'Next page';
                    nav.addEventListener('click', (e) => {
                        e.stopPropagation();
                        teSubPage = (teSubPage + 1) % totalPages;
                        renderThemeFlyout();
                    });
                    teFlyout.appendChild(nav);
                }

                // "Editor" button to open full modal
                const editorBtn = document.createElement('button');
                Object.assign(editorBtn.style, {
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                    minWidth: '130px', maxWidth: '190px', padding: '4px 8px',
                    background: C.teBtnBg, boxShadow: C.shadow,
                    borderRadius: '6px', border: 'none', cursor: 'pointer',
                    fontSize: '11px', fontWeight: '600', color: C.teBtnText,
                    whiteSpace: 'nowrap', height: '28px', transition: 'filter .12s',
                });
                editorBtn.textContent = '⚙️ Editor';
                editorBtn.title = 'Open full Theme Editor';
                editorBtn.addEventListener('mouseenter', () => { editorBtn.style.filter = 'brightness(1.1)'; });
                editorBtn.addEventListener('mouseleave', () => { editorBtn.style.filter = ''; });
                editorBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeDropdown();
                    closeFlyout();
                    if (_themeEditor) _themeEditor.toggleModal();
                });
                teFlyout.appendChild(editorBtn);
            }

            function closeFlyout() {
                teFlyoutOpen = false;
                teFlyout.style.opacity = '0';
                teFlyout.style.pointerEvents = 'none';
                teFlyout.style.transform = 'scale(0.95)';
            }

            _flyoutClosers.push(closeFlyout);

            teBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                teCollapsePill();
                const wasOpen = teFlyoutOpen;
                closeAllFlyouts();
                if (!wasOpen) {
                    teFlyoutOpen = true;
                    renderThemeFlyout();
                    teFlyout.style.opacity = '1';
                    teFlyout.style.pointerEvents = 'auto';
                    teFlyout.style.transform = 'scale(1)';
                }
            });

            document.addEventListener('click', (e) => {
                if (teFlyoutOpen && !teGroup.contains(e.target)) closeFlyout();
            });

            teGroup.appendChild(teBtn);
            teGroup.appendChild(teFlyout);
            dropdown.appendChild(teGroup);
        }

        // Map Markers button (only if enabled)
        if (_settings.mapMarkers) {
            dropdown.appendChild(makeSubBtn('📌', 'Map Markers', () => {
                if (_mapMarkers) _mapMarkers.openModal();
            }));
        }

        // Blocked User List button (only if enabled)
        if (_settings.extBlockedUsers) {
            dropdown.appendChild(makeSubBtn('🚷', 'Blocked Users', () => {
                if (_blockedUsers) _blockedUsers.openModal();
            }));
        }

        // Controls scale is deliberately a standalone dropdown setting: it
        // applies to both native side clusters, independent of any paint UI.
        dropdown.appendChild(makeSubBtn('↔️', 'Controls scale', () => {
            if (gpcControlsScale) gpcControlsScale.open();
        }));

        // Settings button (always visible)
        dropdown.appendChild(makeSubBtn('⚙️', 'Settings...', createSettingsModal));

        // Changelog button (always visible)
        dropdown.appendChild(makeSubBtn('📋', 'Changelog', showChangelog));

        // Debug Logs button — only shown when Enable Debugging is on.
        // Always exports, even with zero timestamped entries — dbgExport()
        // appends a live state snapshot regardless, which is often the more
        // useful half of the file when something failed too early for any
        // dbgPush() call to have run yet.
        if (_settings.enableDebug) {
            const _dbgBtn = makeSubBtn('🔶', `Debug Logs (${dbgCount()})`, dbgExport);
            _dbgBtn.id = 'gpc-debug-dropdown-btn';
            dropdown.appendChild(_dbgBtn);
        }

        group.appendChild(mainBtn);
        group.appendChild(dropdown);

        // Ensure GeoPixelcons++ is always after GeoPixels++ in controls-left
        function positionAfterGeoPixelsPP() {
            const gppGroup = controlsLeft.querySelector('#geopixels-plusplus')?.closest('.relative');
            if (gppGroup && gppGroup.nextSibling !== group) {
                gppGroup.after(group);
                return true;
            }
            return false;
        }

        controlsLeft.appendChild(group);
        if (!positionAfterGeoPixelsPP()) {
            // GeoPixels++ may not be loaded yet — watch for it
            const obs = new MutationObserver(() => {
                if (positionAfterGeoPixelsPP()) obs.disconnect();
            });
            obs.observe(controlsLeft, { childList: true, subtree: true });
            // Stop watching after 30s to avoid leaks
            setTimeout(() => obs.disconnect(), 30000);
        }
    });

    // ============================================================
    //  FEATURE MODULES
    //  Each wrapped in a try/catch to set status
    // ============================================================
