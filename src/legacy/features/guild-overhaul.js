
    // ============================================================
    //  FEATURE: Guild Overhaul [guildOverhaul]
    // ============================================================
    if (_settings.guildOverhaul) {
        try {
            (function _init_guildOverhaul() {

    // --- Configuration & State ---
    const CONFIG = {
        debugMode: false,
        timeOffset: GM_getValue('debug_time_offset', 0),
        minSnapshotInterval: GM_getValue('min_snapshot_interval', 60 * 60 * 1000),
        maxSnapshots: GM_getValue('max_snapshots', 750)
    };

    const SNAPSHOT_INTERVALS = {
        HOURLY: 60 * 60 * 1000,
        TWELVE_HOURS: 12 * 60 * 60 * 1000,
        TWENTY_FOUR_HOURS: 24 * 60 * 60 * 1000
    };

    const sessionState = {
        visitedCoords: new Set()
    };

    // --- One-time migration: convert old name-keyed snapshots to ID-keyed ---
    // Prior to 1.1.8, members were stored as { "PlayerName#12345": { xp, coords } }.
    // Now they are stored as { "12345": { xp, coords, name: "PlayerName#12345" } }.
    // This runs once at startup and is transparent to the user.
    (function _migrateGuildXPHistory() {
        try {
            const history = GM_getValue('guild_xp_history', []);
            if (!history.length) return;
            let changed = false;
            history.forEach(entry => {
                if (!entry.members) return;
                const oldMembers = entry.members;
                const newMembers = {};
                for (const [key, val] of Object.entries(oldMembers)) {
                    // Already migrated? (pure numeric key)
                    if (/^\d+$/.test(key)) {
                        newMembers[key] = val;
                        continue;
                    }
                    // Legacy format: full name key like "PlayerName#12345"
                    const idMatch = key.match(/#(\d+)$/);
                    if (idMatch) {
                        const id = idMatch[1];
                        if (typeof val === 'number') {
                            newMembers[id] = { xp: val, coords: null, name: key };
                        } else {
                            newMembers[id] = { ...val, name: val.name || key };
                        }
                        changed = true;
                    } else {
                        // No ID found — keep as-is (can't migrate)
                        newMembers[key] = val;
                    }
                }
                entry.members = newMembers;
            });
            if (changed) {
                GM_setValue('guild_xp_history', history);
                console.log('[Guild XP] Migrated old name-keyed snapshots to ID keys');
            }
        } catch (e) {
            console.warn('[Guild XP] Migration failed:', e);
        }
    })();

    // --- Territory Overlay State ---
    const TERRITORY_STORAGE_KEY = 'guildOverhaul_territorySettings';
    let territoryCanvas = null;
    let territoryVisible = false;
    let territoryRects = []; // Array of { gridX, gridY, width, height, label }
    let territoryActivityMap = {}; // Map of rect.index → boolean (has active players)
    let territorySettings = loadTerritorySettings();

    // --- Player Markers Overlay State ---
    const PLAYER_STORAGE_KEY = 'guildOverhaul_playerSettings';
    let playersContainer = null;
    let playersVisible = false;
    let playerMarkerData = []; // Array of { name, gridX, gridY, element, inTerritory }
    let playersShowNames = false;
    let playersColorByTerritory = true;
    let playersShowInTerritory = true;
    let playersShowOutsideTerritory = true;
    let playerSettings = loadPlayerSettings();

    function loadPlayerSettings() {
        try {
            const stored = GM_getValue(PLAYER_STORAGE_KEY, null);
            if (stored) return stored;
        } catch (e) {}
        return {
            markerSize: 28,
            labelFontSize: 11,
            defaultColor: '#ef4444',
            territoryColor: '#3b82f6'
        };
    }

    function savePlayerSettings() {
        GM_setValue(PLAYER_STORAGE_KEY, playerSettings);
    }

    function loadTerritorySettings() {
        try {
            const stored = GM_getValue(TERRITORY_STORAGE_KEY, null);
            if (stored) return stored;
        } catch (e) {}
        return {
            borderColor: '#3b82f6',
            borderThickness: 2,
            showLabels: true,
            labelFontSize: 12,
            showFill: true,
            fillColor: '#3b82f6',
            fillAlpha: 0.15,
            colorByActivity: false,
            activeBorderColor: '#22c55e',
            activeFillColor: '#22c55e',
            abandonedBorderColor: '#6b7280',
            abandonedFillColor: '#6b7280'
        };
    }

    function saveTerritorySettings() {
        GM_setValue(TERRITORY_STORAGE_KEY, territorySettings);
    }

    // --- CSS Styles ---
    // --- CSS Styles (Tailwind-compatible for geopixels++ dark theme) ---
    const style = document.createElement('style');
    style.textContent = `
        .guild-modal-header {
            touch-action: none !important;
            -webkit-user-select: none !important;
            user-select: none !important;
        }
        
        .guild-modal-header span {
            touch-action: none !important;
            -webkit-user-select: none !important;
            user-select: none !important;
            display: block;
            flex: 1;
            padding-right: 10px;
        }
        
        .draggable-panel {
            touch-action: none !important;
        }

        /* Use Tailwind CSS variables for dark mode compatibility */
        .guild-message-section {
            border: 1px solid var(--color-gray-200, #e5e7eb);
            border-radius: 0.5rem;
            overflow: hidden;
            background-color: var(--color-white, #fff);
        }

        .guild-message-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem;
            background-color: var(--color-gray-50, #f9fafb);
            cursor: pointer;
            user-select: none;
            color: var(--color-gray-900, #111827);
        }

        .guild-message-header:hover {
            background-color: var(--color-gray-100, #f3f4f6);
        }

        .guild-message-toggle {
            display: inline-block;
            width: 20px;
            height: 20px;
            text-align: center;
            line-height: 20px;
            font-weight: bold;
            color: var(--color-gray-500, #6b7280);
            transition: transform 0.2s ease;
        }

        .guild-message-toggle.collapsed {
            transform: rotate(-90deg);
        }

        .guild-message-content {
            max-height: 500px;
            overflow: hidden;
            transition: max-height 0.3s ease, padding 0.3s ease;
            padding: 0.75rem;
            background-color: var(--color-white, #fff);
            color: var(--color-gray-900, #111827);
        }

        .guild-message-content.collapsed {
            max-height: 0;
            padding: 0;
        }

        @media (max-width: 1024px) {
            #infoTab .grid.grid-cols-1.lg\\:grid-cols-3 {
                grid-template-columns: 1fr !important;
            }
            #infoTab .lg\\:col-span-2 { grid-column: auto !important; }
            #infoTab .lg\\:col-span-1 { grid-column: auto !important; order: 1; }
            #infoTab > .grid { display: flex; flex-direction: column; }
            #guildMembersContainer { order: 1; margin-top: 2rem; }
        }

        #infoTab.message-collapsed > .grid { display: block; }
        #infoTab.message-collapsed #guildMembersContainer { margin-top: 1rem; }

        .guild-find-btn.visited { background-color: var(--color-purple-500, #a855f7) !important; }
        .guild-find-btn.visited:hover { background-color: var(--color-purple-600, #9333ea) !important; }

        .xp-changes-section {
            margin-top: 1.5rem;
            border: 1px solid var(--color-gray-200, #e5e7eb);
            border-radius: 0.5rem;
            overflow: hidden;
            width: 100%;
            background-color: var(--color-white, #fff);
        }

        .xp-changes-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem;
            background-color: var(--color-gray-100, #f1f5f9);
            cursor: pointer;
            user-select: none;
            font-weight: 600;
            color: var(--color-gray-700, #334155);
        }
        .xp-changes-header:hover { background-color: var(--color-gray-200, #e2e8f0); }

        .xp-changes-content { 
            padding: 1rem; 
            background-color: var(--color-white, #fff); 
            color: var(--color-gray-900, #111827);
            display: block; 
        }
        .xp-changes-content.hidden { display: none; }

        .daily-brief-table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-top: 10px;
            color: var(--color-gray-900, #111827);
        }
        .daily-brief-table th, .daily-brief-table td { 
            border: 1px solid var(--color-gray-300, #d1d5db); 
            padding: 8px; 
            text-align: left; 
        }
        .daily-brief-table th { 
            background-color: var(--color-gray-100, #f2f2f2);
            color: var(--color-gray-900, #111827);
        }
        .daily-brief-table td {
            background-color: var(--color-white, #fff);
        }

        .xp-gain { color: var(--color-green-500, #22c55e); }
        .xp-loss { color: var(--color-red-500, #ef4444); }
        .xp-neutral { color: var(--color-gray-500, #94a3b8); }

        .user-cell-content { display: flex; flex-direction: column; gap: 2px; }
        .user-name { font-weight: 500; color: var(--color-gray-900, #111827); }
        .user-coords { font-size: 13px; }

        .member-icon-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
            transition: background-color 0.2s; margin-left: 4px; border: none;
            background: transparent; padding: 0;
        }
        .member-icon-btn:hover { background-color: var(--color-gray-100, rgba(0,0,0,0.05)); }
        .discord-icon { color: #5865F2; }
        .map-icon { color: var(--color-sky-500, #0ea5e9); }
        .map-icon.out-of-territory { color: var(--color-red-500, #ef4444); }
        .map-icon.visited { color: var(--color-purple-500, #a855f7); }
        
        .control-button {
            padding: 6px 12px; 
            border: 1px solid var(--color-gray-300, #d1d5db); 
            background: var(--color-white, #fff);
            color: var(--color-gray-900, #111827);
            border-radius: 4px; 
            cursor: pointer; 
            font-size: 12px; 
            transition: background-color 0.2s;
        }
        .control-button:hover { background-color: var(--color-gray-100, #f0f0f0); }
        .control-button.active { 
            background-color: var(--color-blue-500, #3b82f6); 
            color: var(--color-white, #fff); 
            border-color: var(--color-blue-500, #3b82f6); 
        }
        
        .trash-btn {
            background: none; border: none; 
            color: var(--color-red-500, #ef4444); 
            cursor: pointer;
            padding: 2px 4px; font-size: 12px;
        }
        .trash-btn:hover { color: var(--color-red-600, #dc2626); }
        
        .tooltip-popup {
            position: fixed; 
            background: var(--color-gray-800, #333); 
            color: var(--color-gray-100, #fff); 
            padding: 4px 8px;
            border-radius: 4px; font-size: 12px; z-index: 10000; pointer-events: none;
            opacity: 0; transition: opacity 0.2s;
        }
        .tooltip-popup.visible { opacity: 1; }

        #snapshotIntervalSelect {
            background-color: var(--color-white, #fff);
            color: var(--color-gray-900, #111827);
        }
        #snapshotIntervalSelect:hover {
            border-color: var(--color-blue-500, #3b82f6) !important;
            box-shadow: 0 0 4px rgba(59, 130, 246, 0.2) !important;
        }

        #snapshotIntervalSelect:focus {
            border-color: var(--color-blue-500, #3b82f6) !important;
            box-shadow: 0 0 6px rgba(59, 130, 246, 0.3) !important;
            outline: none !important;
        }

        /* --- Player Markers Overlay Styles --- */
        #players-container {
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 5;
            overflow: hidden;
        }

        .player-marker {
            position: absolute;
            pointer-events: auto;
            cursor: pointer;
            transform: translate(-50%, -100%);
            transition: transform 0.15s ease;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35));
        }

        .player-marker:hover {
            transform: translate(-50%, -100%) scale(1.25);
            z-index: 10;
        }

        .player-marker-tooltip {
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            margin-bottom: 6px;
            background: var(--color-gray-800, #1f2937);
            color: var(--color-gray-100, #f3f4f6);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s ease;
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        }

        .player-marker-tooltip::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            border: 5px solid transparent;
            border-top-color: var(--color-gray-800, #1f2937);
        }

        .player-marker:hover .player-marker-tooltip {
            opacity: 1;
        }

        .player-marker.show-label .player-marker-tooltip {
            opacity: 1;
        }

        .player-marker-options {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 4px 0;
        }

        .player-marker-options label {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 12px;
            font-weight: 500;
            color: var(--color-gray-600, #4b5563);
            cursor: pointer;
            user-select: none;
        }

        .player-marker-options input[type="checkbox"] {
            width: 14px;
            height: 14px;
            cursor: pointer;
            accent-color: var(--color-blue-500, #3b82f6);
        }

        /* --- Territory Overlay Styles --- */
        #territory-canvas {
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 5;
        }

        /* Territory Controls Container */
        #territoryControlsContainer {
            background-color: var(--color-gray-100, #f0f9ff);
            border: 1px solid var(--color-gray-300, #bae6fd);
        }

        .territory-setting-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .territory-setting-row label {
            font-size: 13px;
            font-weight: 500;
            color: var(--color-gray-700, #374151);
        }

        .territory-settings-collapsible {
            width: 100%;
            border: 1px solid var(--color-gray-300, #d1d5db);
            border-radius: 8px;
            overflow: hidden;
            background: var(--color-white, #fff);
        }

        .territory-settings-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: var(--color-gray-100, #f3f4f6);
            cursor: pointer;
            user-select: none;
            font-size: 13px;
            font-weight: 600;
            color: var(--color-blue-500, #3b82f6);
            border: none;
            width: 100%;
        }

        .territory-settings-toggle:hover {
            background: var(--color-gray-200, #e5e7eb);
        }

        .territory-settings-toggle .toggle-arrow {
            transition: transform 0.2s ease;
            font-size: 11px;
        }

        .territory-settings-toggle .toggle-arrow.collapsed {
            transform: rotate(-90deg);
        }

        .territory-settings-content {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            border-top: 1px solid var(--color-gray-200, #e5e7eb);
            background: var(--color-white, #fff);
        }

        .territory-settings-content.collapsed {
            display: none;
        }

        .territory-section-divider {
            border-top: 1px solid var(--color-gray-200, #e5e7eb);
            margin: 2px 0;
            padding-top: 4px;
            font-size: 11px;
            font-weight: 600;
            color: var(--color-gray-500, #6b7280);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .territory-toggle-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
        }

        .territory-toggle-btn.active {
            background: var(--color-blue-500, #3b82f6);
            color: var(--color-white, #fff);
            box-shadow: 0 2px 8px rgba(59,130,246,0.3);
        }

        .territory-toggle-btn.inactive {
            background: var(--color-gray-200, #e5e7eb);
            color: var(--color-gray-700, #374151);
        }

        .territory-toggle-btn.inactive:hover {
            background: var(--color-gray-300, #d1d5db);
        }

        /* Territory settings inputs */
        .territory-settings-content input[type="color"] {
            border: 2px solid var(--color-gray-300, #d1d5db);
        }
        .territory-settings-content select {
            background-color: var(--color-white, #fff);
            color: var(--color-gray-900, #111827);
            border: 1px solid var(--color-gray-300, #d1d5db);
        }
        .territory-settings-content input[type="range"] {
            accent-color: var(--color-blue-500, #3b82f6);
        }

        /* Info text in territory controls */
        .territory-info-text {
            font-size: 12px;
            color: var(--color-gray-500, #64748b);
        }

        /* --- Modal Styling for Dark Mode Compatibility --- */
        .gmi-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
        }

        .gmi-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--color-white, #fff);
            border: 2px solid var(--color-blue-500, #3b82f6);
            border-radius: 8px;
            padding: 20px;
            z-index: 10000;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            color: var(--color-gray-900, #111827);
        }

        .gmi-modal h3 {
            margin: 0 0 15px 0;
            font-size: 18px;
            font-weight: bold;
            color: var(--color-gray-900, #111827);
        }

        .gmi-modal-btn {
            display: block;
            width: 100%;
            padding: 10px;
            margin: 8px 0;
            border: 1px solid var(--color-gray-300, #d1d5db);
            border-radius: 4px;
            background: var(--color-white, #fff);
            color: var(--color-gray-900, #111827);
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
            text-align: left;
        }

        .gmi-modal-btn:hover {
            background-color: var(--color-gray-100, #f3f4f6);
        }

        .gmi-modal-btn.danger {
            color: var(--color-red-500, #ef4444);
        }

        .gmi-modal-btn.danger:hover {
            background-color: rgba(239, 68, 68, 0.1);
        }

        .gmi-modal-btn.warning {
            color: var(--color-yellow-500, #f59e0b);
        }

        .gmi-modal-btn.warning:hover {
            background-color: rgba(245, 158, 11, 0.1);
        }

        .gmi-modal-btn.primary {
            color: var(--color-blue-500, #3b82f6);
        }

        .gmi-modal-btn.primary:hover {
            background-color: rgba(59, 130, 246, 0.1);
        }

        .gmi-modal-section {
            padding: 10px;
            background: var(--color-gray-50, #f9fafb);
            border-radius: 4px;
            border: 1px solid var(--color-gray-200, #e5e7eb);
            margin-bottom: 15px;
        }

        .gmi-modal-select {
            padding: 6px 10px;
            border: 1px solid var(--color-gray-300, #d1d5db);
            border-radius: 4px;
            background: var(--color-white, #fff);
            color: var(--color-gray-900, #111827);
            font-size: 12px;
            cursor: pointer;
        }

        .gmi-modal-label {
            font-weight: 600;
            font-size: 12px;
            color: var(--color-gray-700, #374151);
            user-select: none;
        }

        .gmi-checkbox-option {
            display: flex;
            align-items: center;
            padding: 8px;
            border: 2px solid var(--color-gray-300, #d1d5db);
            border-radius: 4px;
            background: var(--color-white, #fff);
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }

        .gmi-checkbox-option:hover {
            border-color: var(--color-gray-400, #9ca3af);
        }

        .gmi-checkbox-option input[type="checkbox"] {
            width: 16px;
            height: 16px;
            margin-right: 8px;
            cursor: pointer;
            accent-color: var(--color-blue-500, #3b82f6);
        }

        .gmi-snapshot-list {
            flex: 1;
            overflow-y: auto;
            border: 1px solid var(--color-gray-200, #e5e7eb);
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 15px;
            background: var(--color-gray-50, #f9fafb);
        }

        .gmi-snapshot-item {
            display: flex;
            align-items: center;
            padding: 8px;
            margin: 4px 0;
            background: var(--color-white, #fff);
            border-radius: 4px;
            border: 1px solid var(--color-gray-200, #e5e7eb);
            transition: background-color 0.2s, border-color 0.2s;
        }

        .gmi-snapshot-item.selected {
            background: rgba(239, 68, 68, 0.1);
            border-color: var(--color-red-300, #fca5a5);
        }

        .gmi-snapshot-item label {
            flex: 1;
            cursor: pointer;
            font-size: 12px;
            color: var(--color-gray-700, #374151);
        }

        .gmi-snapshot-item.selected label {
            color: var(--color-red-700, #b91c1c);
            text-decoration: line-through;
        }

        .gmi-action-btn {
            flex: 1;
            min-width: 120px;
            padding: 12px 16px;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        .gmi-action-btn.danger {
            background: var(--color-red-500, #dc2626);
            color: var(--color-white, #fff);
        }

        .gmi-action-btn.danger:hover {
            background: var(--color-red-600, #b91c1c);
        }

        .gmi-action-btn.primary {
            background: var(--color-blue-500, #3b82f6);
            color: var(--color-white, #fff);
        }

        .gmi-action-btn.primary:hover {
            background: var(--color-blue-600, #2563eb);
        }

        .gmi-action-btn.success {
            background: var(--color-green-500, #10b981);
            color: var(--color-white, #fff);
        }

        .gmi-action-btn.success:hover {
            background: var(--color-green-600, #059669);
        }

        .gmi-action-btn.neutral {
            background: var(--color-gray-100, #f3f4f6);
            color: var(--color-gray-600, #6b7280);
        }

        .gmi-action-btn.neutral:hover {
            background: var(--color-gray-200, #e5e7eb);
        }

        /* Progress popup */
        .gmi-progress-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--color-white, #fff);
            color: var(--color-gray-900, #111827);
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: 300px;
            text-align: center;
        }

        .gmi-progress-popup p {
            color: var(--color-gray-700, #374151);
        }

        .gmi-progress-bar-container {
            width: 100%;
            height: 20px;
            background: var(--color-gray-200, #e5e7eb);
            border-radius: 4px;
            margin-top: 10px;
            overflow: hidden;
        }

        .gmi-progress-bar {
            height: 100%;
            background: var(--color-blue-500, #3b82f6);
            transition: width 0.3s;
        }

        /* CSV Modal */
        .gmi-csv-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: var(--color-white, #fff);
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            z-index: 10002;
            width: 500px;
            max-width: 90%;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .gmi-csv-modal h3 {
            margin: 0 0 10px 0;
            color: var(--color-gray-800, #1e293b);
            font-size: 1.25rem;
            font-weight: 600;
        }

        .gmi-csv-modal textarea {
            width: 100%;
            height: 300px;
            font-family: monospace;
            font-size: 12px;
            border: 1px solid var(--color-gray-300, #ccc);
            border-radius: 4px;
            resize: vertical;
            background: var(--color-white, #fff);
            color: var(--color-gray-900, #111827);
        }
    `;
    document.head.appendChild(style);

    // --- Helper Functions ---

    function getVirtualNow() {
        return Date.now() + CONFIG.timeOffset;
    }

    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(checkInterval);
                    resolve(element);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(checkInterval);
                    reject(new Error(`Element ${selector} not found within ${timeout}ms`));
                }
            }, 100);
        });
    }

    async function fetchUserProfile(targetUserId) {
        try {
            if (!targetUserId) { console.error("Missing targetId"); return null; }
            const response = await fetch('/GetUserProfile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ "targetId": parseInt(targetUserId) })
            });
            if (!response.ok) throw new Error(`Server returned ${response.status}`);
            return await response.json();
        } catch (err) {
            console.error("Failed to fetch user profile:", err);
            return null;
        }
    }

    function showTooltip(x, y, text) {
        let tooltip = document.getElementById('custom-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'custom-tooltip';
            tooltip.className = 'tooltip-popup';
            document.body.appendChild(tooltip);
        }
        tooltip.textContent = text;
        tooltip.style.left = x + 10 + 'px';
        tooltip.style.top = y + 'px';
        tooltip.classList.add('visible');
        setTimeout(() => tooltip.classList.remove('visible'), 2000);
    }

    // --- XP Tracking Logic ---

    function parseGuildMembers() {
        const container = document.getElementById('guildMembersContainer');
        if (!container) return null;

        const members = {};
        const memberRows = container.querySelectorAll('div.flex.items-center.justify-between.p-2.rounded-md.bg-white.shadow-sm');

        memberRows.forEach(row => {
            const nameEl = row.querySelector('p.font-semibold');
            const xpEl = row.querySelector('p.text-xs.text-gray-500');

            if (nameEl && xpEl) {
                let fullName = nameEl.textContent.trim();
                const badge = nameEl.querySelector('span');
                if (badge) fullName = fullName.replace(badge.textContent, '').trim();
                
                const xpText = xpEl.textContent;
                const xpMatch = xpText.match(/([\d,.]+)\s*XP$/);
                
                let coords = null;
                const findBtn = row.querySelector('button[onclick^="goToGridLocation"]');
                if (findBtn) {
                    const match = findBtn.getAttribute('onclick').match(/goToGridLocation\((-?\d+),\s*(-?\d+)\)/);
                    if (match) coords = [parseInt(match[1]), parseInt(match[2])];
                }

                if (fullName && xpMatch) {
                    const xp = parseInt(xpMatch[1].replace(/[.,]/g, ''), 10);
                    // Key by numeric user ID extracted from trailing #12345 so name changes
                    // don't cause false LEFT/JOINED events.
                    const idMatch = fullName.match(/#(\d+)$/);
                    const key = idMatch ? idMatch[1] : fullName;
                    members[key] = { xp, coords, name: fullName };
                }
            }
        });
        return members;
    }

    function saveGuildSnapshot(members, forceNew = false) {
        const now = getVirtualNow();
        let history = GM_getValue('guild_xp_history', []);
        const lastEntry = history[history.length - 1];
        const lastBucketStart = lastEntry ? (lastEntry.bucketStartTime || lastEntry.timestamp) : 0;

        const newEntry = { timestamp: now, bucketStartTime: now, members: members };

        if (!forceNew && lastEntry && (now - lastBucketStart < CONFIG.minSnapshotInterval)) {
            newEntry.bucketStartTime = lastBucketStart;
            history[history.length - 1] = newEntry;
            if (CONFIG.debugMode) console.log('[Guild XP] Updated recent snapshot');
        } else {
            history.push(newEntry);
            console.log('[Guild XP] Created new snapshot');
        }

        if (history.length > CONFIG.maxSnapshots) history = history.slice(history.length - CONFIG.maxSnapshots);
        GM_setValue('guild_xp_history', history);
        return history;
    }

    function getXp(val) {
        if (typeof val === 'number') return val;
        if (val && typeof val === 'object' && val.xp !== undefined) return val.xp;
        return 0;
    }
    
    function getCoords(val) {
        if (val && typeof val === 'object' && val.coords) return val.coords;
        return null;
    }

    async function fetchAllGuildMembersData() {
        const currentMembers = parseGuildMembers();
        if (!currentMembers || Object.keys(currentMembers).length === 0) {
            alert('No guild members found. Please wait for members to load.');
            return null;
        }

        const memberNames = Object.keys(currentMembers);
        const allUsersData = [];
        let successCount = 0;
        let failCount = 0;

        const progressDiv = document.createElement('div');
        progressDiv.className = 'gmi-progress-popup';
        progressDiv.innerHTML = `
            <p style="font-weight: bold; margin-bottom: 10px;">Fetching guild member data...</p>
            <p id="progressText" style="font-size: 14px;">0/${memberNames.length}</p>
            <div class="gmi-progress-bar-container">
                <div id="progressBar" class="gmi-progress-bar" style="width: 0%;"></div>
            </div>
        `;
        document.body.appendChild(progressDiv);

        for (let i = 0; i < memberNames.length; i++) {
            const key = memberNames[i];
            // keys are now numeric userId strings (from parseGuildMembers); fall back to
            // legacy #ID extraction for old snapshots that still use full-name keys
            const userId = /^\d+$/.test(key) ? key : (() => {
                const m = key.match(/#(\d+)$/);
                return m ? m[1] : null;
            })();
            if (userId) {
                const data = await fetchUserProfile(userId);
                if (data) { allUsersData.push(data); successCount++; }
                else failCount++;
            } else {
                failCount++;
            }

            const progressPercent = ((i + 1) / memberNames.length) * 100;
            document.getElementById('progressBar').style.width = progressPercent + '%';
            document.getElementById('progressText').textContent = `${i + 1}/${memberNames.length} (${successCount} fetched)`;
        }

        const jsonString = JSON.stringify(allUsersData, null, 2);
        navigator.clipboard.writeText(jsonString).then(() => {
            progressDiv.innerHTML = `
                <p style="font-weight: bold; color: #10b981; margin-bottom: 5px;">✓ Success!</p>
                <p style="font-size: 14px; color: #666;">Fetched: ${successCount} users<br>Failed: ${failCount} users<br><br><strong>JSON copied to clipboard!</strong></p>
            `;
            setTimeout(() => progressDiv.remove(), 3000);
        }).catch((err) => {
            progressDiv.innerHTML = `<p style="font-weight: bold; color: #dc2626;">Error copying to clipboard!</p><p style="font-size: 12px; color: #666;">${err.message}</p>`;
            setTimeout(() => progressDiv.remove(), 3000);
        });

        return allUsersData;
    }

    function calculateXPChanges(oldMembers, newMembers) {
        const changes = [];
        for (const [id, oldVal] of Object.entries(oldMembers)) {
            const oldXp = getXp(oldVal);
            const oldName = oldVal && typeof oldVal === 'object' ? (oldVal.name || id) : id;
            if (newMembers.hasOwnProperty(id)) {
                const newVal = newMembers[id];
                const newXp = getXp(newVal);
                const diff = newXp - oldXp;
                const coords = getCoords(newVal) || getCoords(oldVal);
                const name = (newVal && typeof newVal === 'object' ? newVal.name : null) || oldName;
                changes.push({ type: 'gain', id, name, diff, oldXp, newXp, coords });
            } else {
                const coords = getCoords(oldVal);
                changes.push({ type: 'left', id, name: oldName, oldXp, coords });
            }
        }
        for (const [id, newVal] of Object.entries(newMembers)) {
            if (!oldMembers.hasOwnProperty(id)) {
                const newXp = getXp(newVal);
                const coords = getCoords(newVal);
                const name = newVal && typeof newVal === 'object' ? (newVal.name || id) : id;
                changes.push({ type: 'join', id, name, newXp, coords });
            }
        }
        return changes;
    }

    function getCoordinateColor(coords) {
        if (!coords || coords.length < 2) return { bg: '#f3f4f6', text: '#1f2937' };
        const x = coords[0];
        const y = coords[1];
        const distance = Math.sqrt(x * x + y * y);
        const distanceBand = Math.floor(distance / 25000);
        
        let baseColor;
        if (x >= 0 && y >= 0) {
            const intensity = Math.min(distanceBand * 3, 15);
            baseColor = `hsl(120, 50%, ${97 - intensity}%)`;
        } else if (x < 0 && y >= 0) {
            const intensity = Math.min(distanceBand * 3, 15);
            baseColor = `hsl(0, 50%, ${97 - intensity}%)`;
        } else if (x < 0 && y < 0) {
            const intensity = Math.min(distanceBand * 3, 15);
            baseColor = `hsl(240, 50%, ${97 - intensity}%)`;
        } else {
            const intensity = Math.min(distanceBand * 3, 15);
            baseColor = `hsl(30, 50%, ${97 - intensity}%)`;
        }
        return { bg: baseColor, text: '#1f2937' };
    }

    // --- XP Changes Section ---
    function ensureXPChangesSection() {
        const infoBtn = document.getElementById('infoTabBtn');
        if (!infoBtn) {
            if (document.getElementById('infoTab')) {
                console.log('[Guild XP] Could not find tab buttons, appending to infoTab instead');
                ensureXPChangesSectionLegacy();
            }
            return;
        }

        const tabNav = infoBtn.parentElement;
        if (document.getElementById('xpTrackerTabBtn')) return;

        const existingPanes = document.querySelectorAll('#xpTrackerPane');
        existingPanes.forEach(pane => pane.remove());

        const xpTabBtn = document.createElement('button');
        xpTabBtn.textContent = 'XP Tracker';
        xpTabBtn.id = 'xpTrackerTabBtn';
        xpTabBtn.className = infoBtn.className;
        xpTabBtn.classList.remove('text-blue-600', 'border-blue-500');
        xpTabBtn.classList.add('text-gray-500', 'border-transparent');
        xpTabBtn.style.borderBottom = '2px solid transparent';
        
        const xpTabPane = document.createElement('div');
        xpTabPane.id = 'xpTrackerPane';
        xpTabPane.style.display = 'none';
        xpTabPane.className = 'hidden guild-tab-content'; 
        
        const infoTab = document.getElementById('infoTab');
        const contentContainer = infoTab?.parentElement;

        if (!contentContainer) {
            console.log('[Guild XP] Could not find content container');
            ensureXPChangesSectionLegacy();
            return;
        }

        xpTabBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const allPanes = contentContainer.querySelectorAll('.guild-tab-content, [id$="Tab"], [id$="Pane"]');
            allPanes.forEach(pane => { pane.style.display = 'none'; pane.classList.add('hidden'); });
            const allBtns = tabNav.querySelectorAll('button');
            allBtns.forEach(btn => {
                btn.classList.remove('text-blue-600', 'border-blue-500');
                btn.classList.add('text-gray-500', 'border-transparent');
                btn.style.borderBottom = '2px solid transparent';
                btn.style.color = ''; 
            });
            xpTabPane.style.display = 'block';
            xpTabPane.classList.remove('hidden');
            xpTabBtn.classList.remove('text-gray-500', 'border-transparent');
            xpTabBtn.classList.add('text-blue-600', 'border-blue-500');
            xpTabBtn.style.borderBottom = '2px solid #3b82f6';
            xpTabBtn.style.color = '#3b82f6';
            renderXPChanges(xpTabPane);
        };

        const existingTabs = tabNav.querySelectorAll('button');
        existingTabs.forEach(btn => {
            if (btn.id === 'xpTrackerTabBtn' || btn.dataset.xpTrackerHooked) return;
            const originalOnClick = btn.onclick;
            btn.onclick = (e) => {
                xpTabPane.style.display = 'none';
                xpTabPane.classList.add('hidden');
                const allPanes = contentContainer.querySelectorAll('.guild-tab-content');
                allPanes.forEach(pane => { if (pane.id !== 'xpTrackerPane') pane.style.display = ''; });
                xpTabBtn.classList.remove('text-blue-600', 'border-blue-500');
                xpTabBtn.classList.add('text-gray-500', 'border-transparent');
                xpTabBtn.style.borderBottom = '2px solid transparent';
                xpTabBtn.style.color = '';
                if (originalOnClick) originalOnClick.call(btn, e);
            };
            btn.dataset.xpTrackerHooked = 'true';
        });

        tabNav.appendChild(xpTabBtn);
        contentContainer.appendChild(xpTabPane);

        const navObserver = new MutationObserver(() => {
            if (!document.getElementById('xpTrackerTabBtn')) tabNav.appendChild(xpTabBtn);
        });
        navObserver.observe(tabNav, { childList: true });
    }

    function ensureXPChangesSectionLegacy() {
        const infoTab = document.getElementById('infoTab');
        if (!infoTab || document.getElementById('xpChangesSection')) return;

        const section = document.createElement('div');
        section.id = 'xpChangesSection';
        section.className = 'xp-changes-section';

        const header = document.createElement('div');
        header.className = 'xp-changes-header';
        header.innerHTML = `<span>XP Changes Tracker</span><span class="toggle-icon">▼</span>`;
        
        const content = document.createElement('div');
        content.className = 'xp-changes-content hidden';
        content.id = 'xpChangesContent';

        header.onclick = () => {
            content.classList.toggle('hidden');
            const icon = header.querySelector('.toggle-icon');
            icon.style.transform = content.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
            if (!content.classList.contains('hidden')) renderXPChanges(content);
        };

        section.appendChild(header);
        section.appendChild(content);
        infoTab.appendChild(section);
    }

    function collapseOtherSections() {
        const messageSection = document.querySelector('.guild-message-section');
        if (messageSection) {
            const content = messageSection.querySelector('.guild-message-content');
            const toggle = messageSection.querySelector('.guild-message-toggle');
            if (content && !content.classList.contains('collapsed')) {
                content.classList.add('collapsed');
                toggle.classList.add('collapsed');
                document.getElementById('infoTab').classList.add('message-collapsed');
            }
        }
    }

    function expandOtherSections() {
        const messageSection = document.querySelector('.guild-message-section');
        if (messageSection) {
            const content = messageSection.querySelector('.guild-message-content');
            const toggle = messageSection.querySelector('.guild-message-toggle');
            if (content && content.classList.contains('collapsed')) {
                content.classList.remove('collapsed');
                toggle.classList.remove('collapsed');
                document.getElementById('infoTab').classList.remove('message-collapsed');
            }
        }
    }

    function exportToCSV(snapshots, currentMembers, fromVal, toVal) {
        // Determine which snapshots to compare based on current selection
        // If called from the button, we might need to pass these values or read them from DOM
        // But since this function was originally designed to dump EVERYTHING, let's adapt it
        // to dump the CURRENT VIEW if specific snapshots are provided, or EVERYTHING if not.
        
        let csvContent = '';

        if (fromVal !== undefined && toVal !== undefined) {
            // Export current view (comparison)
            const getSnapshot = (val) => val === 'current' ? { members: currentMembers } : snapshots[val];
            const fromData = getSnapshot(fromVal);
            const toData = getSnapshot(toVal);
            
            if (!fromData || !toData) return;

            const changes = calculateXPChanges(fromData.members, toData.members);
            
            // Sort (same as view)
            changes.sort((a, b) => {
                if (a.type === 'join') return -1;
                if (b.type === 'join') return 1;
                if (a.type === 'left') return 1;
                if (b.type === 'left') return -1;
                return b.diff - a.diff;
            });

            const csvRows = [
                ["Username", "Change Type", "XP Change", "Old XP", "New XP"],
                ...changes.map(c => {
                    const oldVal = c.oldXp || 0;
                    const newVal = c.newXp || 0;
                    const diff = c.diff !== undefined ? c.diff : (newVal - oldVal);
                    return [`"${c.name || c.id}"`, c.type, diff, oldVal, newVal];
                })
            ];
            csvContent = csvRows.map(e => e.join(",")).join("\n");

        } else {
            // Export Full History (Legacy behavior)
            let csv = 'Snapshot,Timestamp,User,XP\n';
            snapshots.forEach((snap, idx) => {
                const timestamp = new Date(snap.timestamp).toLocaleString();
                for (const [key, data] of Object.entries(snap.members)) {
                    const xp = getXp(data);
                    const displayName = (data && typeof data === 'object' && data.name) ? data.name : key;
                    csv += `${idx + 1},"${timestamp}","${displayName}",${xp}\n`;
                }
            });
            // Add current
            const now = new Date(getVirtualNow()).toLocaleString();
            for (const [key, data] of Object.entries(currentMembers)) {
                const xp = getXp(data);
                const displayName = (data && typeof data === 'object' && data.name) ? data.name : key;
                csv += `Current,"${now}","${displayName}",${xp}\n`;
            }
            csvContent = csv;
        }
        
        // Open CSV Modal
        const csvOverlay = document.createElement('div');
        csvOverlay.className = 'gmi-modal-overlay';
        csvOverlay.style.zIndex = '10001';
        csvOverlay.onclick = () => { csvOverlay.remove(); csvModal.remove(); };

        const csvModal = document.createElement('div');
        csvModal.className = 'gmi-csv-modal';

        const title = document.createElement('h3');
        title.textContent = 'CSV Export';

        const textarea = document.createElement('textarea');
        textarea.value = csvContent;
        textarea.readOnly = true;
        textarea.onclick = () => textarea.select();

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.justifyContent = 'flex-end';
        btnRow.style.gap = '10px';

        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = '📋 Copy';
        copyBtn.className = 'control-button';
        copyBtn.onclick = () => {
            textarea.select();
            navigator.clipboard.writeText(csvContent).then(() => {
                const orig = copyBtn.innerHTML;
                copyBtn.innerHTML = '✅ Copied!';
                setTimeout(() => copyBtn.innerHTML = orig, 1000);
            });
        };

        const downloadBtn = document.createElement('button');
        downloadBtn.innerHTML = '💾 Download';
        downloadBtn.className = 'gmi-action-btn success';
        downloadBtn.onclick = () => {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            if (link.download !== undefined) {
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", `guild_xp_export_${Date.now()}.csv`);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        };

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = 'Close';
        closeBtn.className = 'control-button';
        closeBtn.onclick = () => { csvOverlay.remove(); csvModal.remove(); };

        btnRow.appendChild(copyBtn);
        btnRow.appendChild(downloadBtn);
        btnRow.appendChild(closeBtn);

        csvModal.appendChild(title);
        csvModal.appendChild(textarea);
        csvModal.appendChild(btnRow);

        document.body.appendChild(csvOverlay);
        document.body.appendChild(csvModal);
    }

    // --- History Pruning Functions ---

    function deleteAllHistory() {
        if (confirm('Delete ALL snapshots? This cannot be undone.')) {
            GM_setValue('guild_xp_history', []);
            return [];
        }
        return null;
    }

    function keepDailyHistory() {
        let history = GM_getValue('guild_xp_history', []);
        const dailyMap = new Map();

        // Group by day (YYYY-MM-DD)
        history.forEach(entry => {
            const date = new Date(entry.timestamp);
            const dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
            
            // Keep the latest snapshot from each day
            if (!dailyMap.has(dayKey) || entry.timestamp > dailyMap.get(dayKey).timestamp) {
                dailyMap.set(dayKey, entry);
            }
        });

        const pruned = Array.from(dailyMap.values()).sort((a, b) => a.timestamp - b.timestamp);
        const removed = history.length - pruned.length;
        
        if (confirm(`This will keep only the latest snapshot from each day.\nSnapshots: ${history.length} → ${pruned.length} (removing ${removed}).\nContinue?`)) {
            GM_setValue('guild_xp_history', pruned);
            return pruned;
        }
        return null;
    }

    function keepWeeklyHistory() {
        let history = GM_getValue('guild_xp_history', []);
        const weeklyMap = new Map();

        // Group by week (ISO week)
        history.forEach(entry => {
            const date = new Date(entry.timestamp);
            const dayOfWeek = date.getUTCDay();
            const diff = date.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
            const weekStart = new Date(date.setUTCDate(diff));
            const weekKey = weekStart.toISOString().split('T')[0]; // Start of week (YYYY-MM-DD)
            
            // Keep the latest snapshot from each week
            if (!weeklyMap.has(weekKey) || entry.timestamp > weeklyMap.get(weekKey).timestamp) {
                weeklyMap.set(weekKey, entry);
            }
        });

        const pruned = Array.from(weeklyMap.values()).sort((a, b) => a.timestamp - b.timestamp);
        const removed = history.length - pruned.length;
        
        if (confirm(`This will keep only the latest snapshot from each week.\nSnapshots: ${history.length} → ${pruned.length} (removing ${removed}).\nContinue?`)) {
            GM_setValue('guild_xp_history', pruned);
            return pruned;
        }
        return null;
    }

    function deleteHistoryOlderThan7Days() {
        let history = GM_getValue('guild_xp_history', []);
        const now = getVirtualNow();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

        const pruned = history.filter(entry => (now - entry.timestamp) <= sevenDaysMs);
        const removed = history.length - pruned.length;
        
        if (confirm(`This will delete all snapshots older than 7 days.\nSnapshots: ${history.length} → ${pruned.length} (removing ${removed}).\nContinue?`)) {
            GM_setValue('guild_xp_history', pruned);
            return pruned;
        }
        return null;
    }

    function renderCleanHistoryMenu(container, onClose) {
        const overlay = document.createElement('div');
        overlay.className = 'gmi-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'gmi-modal';
        modal.style.minWidth = '350px';

        const title = document.createElement('h3');
        title.textContent = 'Clean History Options';
        modal.appendChild(title);

        const deleteAllBtn = document.createElement('button');
        deleteAllBtn.innerHTML = 'Select All Snapshots for Deletion';
        deleteAllBtn.className = 'gmi-modal-btn danger';
        deleteAllBtn.onclick = () => {
            const result = deleteAllHistory();
            if (result !== null) {
                onClose(result);
            }
        };
        modal.appendChild(deleteAllBtn);

        const keepDailyBtn = document.createElement('button');
        keepDailyBtn.innerHTML = 'Keep One Snapshot Per Day (Latest)';
        keepDailyBtn.className = 'gmi-modal-btn warning';
        keepDailyBtn.onclick = () => {
            const result = keepDailyHistory();
            if (result !== null) {
                onClose(result);
            }
        };
        modal.appendChild(keepDailyBtn);

        const keepWeeklyBtn = document.createElement('button');
        keepWeeklyBtn.innerHTML = 'Keep One Snapshot Per Week (Latest)';
        keepWeeklyBtn.className = 'gmi-modal-btn primary';
        keepWeeklyBtn.onclick = () => {
            const result = keepWeeklyHistory();
            if (result !== null) {
                onClose(result);
            }
        };
        modal.appendChild(keepWeeklyBtn);

        const delete7DaysBtn = document.createElement('button');
        delete7DaysBtn.innerHTML = 'Select Snapshots Older Than 7 Days for Deletion';
        delete7DaysBtn.className = 'gmi-modal-btn';
        delete7DaysBtn.style.color = 'var(--color-purple-500, #8b5cf6)';
        delete7DaysBtn.onclick = () => {
            const result = deleteHistoryOlderThan7Days();
            if (result !== null) {
                onClose(result);
            }
        };
        modal.appendChild(delete7DaysBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.innerHTML = 'Cancel';
        cancelBtn.className = 'gmi-modal-btn';
        cancelBtn.style.marginTop = '15px';
        cancelBtn.style.borderTop = '1px solid var(--color-gray-300, #ddd)';
        cancelBtn.style.paddingTop = '15px';
        cancelBtn.onclick = () => {
            overlay.remove();
            modal.remove();
        };
        modal.appendChild(cancelBtn);

        overlay.onclick = () => {
            overlay.remove();
            modal.remove();
        };

        document.body.appendChild(overlay);
        document.body.appendChild(modal);
    }

    // --- Export/Import Functions ---

    function exportSnapshots() {
        let history = GM_getValue('guild_xp_history', []);
        if (history.length === 0) {
            alert('No snapshots to export.');
            return;
        }

        const exportData = {
            version: 1,
            exportDate: new Date().toISOString(),
            snapshotCount: history.length,
            snapshots: history
        };

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `guild_snapshots_${Date.now()}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        alert(`Exported ${history.length} snapshots successfully.`);
    }

    function importSnapshots() {
        if (!confirm('WARNING: Importing will ERASE all current snapshots and replace them with the imported data.\n\nAre you sure you want to continue?')) {
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const importData = JSON.parse(event.target.result);
                    
                    if (!importData.snapshots || !Array.isArray(importData.snapshots)) {
                        alert('Invalid snapshot file format.');
                        return;
                    }

                    if (importData.snapshots.length === 0) {
                        alert('No snapshots found in file.');
                        return;
                    }

                    GM_setValue('guild_xp_history', importData.snapshots);
                    alert(`Successfully imported ${importData.snapshots.length} snapshots.`);
                    
                    // Refresh the UI if open
                    const xpTrackerPane = document.getElementById('xpTrackerPane');
                    if (xpTrackerPane && xpTrackerPane.style.display !== 'none') {
                        renderXPChanges(xpTrackerPane);
                    }
                } catch (error) {
                    alert(`Error importing file: ${error.message}`);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function renderCleanHistoryModal(onClose) {
        let history = GM_getValue('guild_xp_history', []);
        const selectedIndices = new Set();

        const overlay = document.createElement('div');
        overlay.className = 'gmi-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'gmi-modal';
        modal.style.cssText = `
            width: 90%;
            max-width: 600px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'margin-bottom: 15px; border-bottom: 2px solid var(--color-gray-200, #e5e7eb); padding-bottom: 10px;';

        const title = document.createElement('h3');
        title.textContent = 'Manage Snapshots';
        header.appendChild(title);

        const info = document.createElement('p');
        info.textContent = `Total snapshots: ${history.length}`;
        info.style.cssText = 'margin: 0; font-size: 12px; color: var(--color-gray-500, #6b7280);';
        header.appendChild(info);

        modal.appendChild(header);

        // Max snapshots control
        const maxSnapshotsDiv = document.createElement('div');
        maxSnapshotsDiv.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
            padding: 10px;
            background: #f9fafb;
            border-radius: 4px;
            border: 1px solid var(--color-gray-200, #e5e7eb);
        `;

        const maxLabel = document.createElement('label');
        maxLabel.textContent = 'Max Snapshots:';
        maxLabel.className = 'gmi-modal-label';
        maxSnapshotsDiv.appendChild(maxLabel);

        const maxSelect = document.createElement('select');
        maxSelect.className = 'gmi-modal-select';

        const presets = [50, 100, 250, 500, 750, 1000, 2500, 5000, 10000];
        presets.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            if (value === CONFIG.maxSnapshots) option.selected = true;
            maxSelect.appendChild(option);
        });

        maxSelect.onchange = (e) => {
            const newMax = parseInt(e.target.value);
            CONFIG.maxSnapshots = newMax;
            GM_setValue('max_snapshots', newMax);
        };

        maxSnapshotsDiv.appendChild(maxSelect);
        modal.appendChild(maxSnapshotsDiv);

        // Snapshot Interval Control
        const intervalDiv = document.createElement('div');
        intervalDiv.className = 'gmi-modal-section';
        intervalDiv.style.cssText = `
            display: grid;
            grid-template-columns: 150px 1fr;
            align-items: center;
            gap: 12px;
        `;

        const intervalLabel = document.createElement('label');
        intervalLabel.textContent = 'Snapshot Interval:';
        intervalLabel.className = 'gmi-modal-label';
        intervalLabel.style.whiteSpace = 'nowrap';
        intervalDiv.appendChild(intervalLabel);

        const intervalSelect = document.createElement('select');
        intervalSelect.id = 'snapshotIntervalSelect';
        intervalSelect.className = 'gmi-modal-select';
        intervalSelect.style.cssText = `
            padding: 8px 12px;
            border: 2px solid #d1d5db;
            border-radius: 6px;
            background: white;
            font-size: 13px;
            cursor: pointer;
            color: #374151;
            transition: all 0.2s ease;
            font-weight: 500;
            max-width: 280px;
        `;
        
        // Add hover and focus styles through a style tag
        intervalSelect.onmouseover = () => {
            intervalSelect.style.borderColor = '#3b82f6';
            intervalSelect.style.boxShadow = '0 0 4px rgba(59, 130, 246, 0.2)';
        };
        intervalSelect.onmouseout = () => {
            if (document.activeElement !== intervalSelect) {
                intervalSelect.style.borderColor = '#d1d5db';
                intervalSelect.style.boxShadow = 'none';
            }
        };
        intervalSelect.onfocus = () => {
            intervalSelect.style.borderColor = '#3b82f6';
            intervalSelect.style.boxShadow = '0 0 6px rgba(59, 130, 246, 0.3)';
        };
        intervalSelect.onblur = () => {
            intervalSelect.style.borderColor = '#d1d5db';
            intervalSelect.style.boxShadow = 'none';
        };

        const hourlyOpt = document.createElement('option');
        hourlyOpt.value = 'hourly';
        hourlyOpt.textContent = 'Hourly (1h)';
        intervalSelect.appendChild(hourlyOpt);

        const twelveHourOpt = document.createElement('option');
        twelveHourOpt.value = '12h';
        twelveHourOpt.textContent = '12 Hours';
        intervalSelect.appendChild(twelveHourOpt);

        const twentyFourHourOpt = document.createElement('option');
        twentyFourHourOpt.value = '24h';
        twentyFourHourOpt.textContent = '24 Hours';
        intervalSelect.appendChild(twentyFourHourOpt);

        const customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = `Custom (${formatSnapshotInterval(CONFIG.minSnapshotInterval)})`;
        intervalSelect.appendChild(customOpt);

        // Set current value
        updateSnapshotIntervalDropdown(intervalSelect);

        intervalSelect.onchange = (e) => {
            const selectedValue = e.target.value;
            if (selectedValue === 'hourly') {
                CONFIG.minSnapshotInterval = SNAPSHOT_INTERVALS.HOURLY;
            } else if (selectedValue === '12h') {
                CONFIG.minSnapshotInterval = SNAPSHOT_INTERVALS.TWELVE_HOURS;
            } else if (selectedValue === '24h') {
                CONFIG.minSnapshotInterval = SNAPSHOT_INTERVALS.TWENTY_FOUR_HOURS;
            } else if (selectedValue === 'custom') {
                const userInput = prompt("Enter custom snapshot interval in minutes:", (CONFIG.minSnapshotInterval / (60 * 1000)).toString());
                if (userInput !== null && userInput.trim() !== '') {
                    const minutes = parseFloat(userInput);
                    if (!isNaN(minutes) && minutes > 0) {
                        CONFIG.minSnapshotInterval = minutes * 60 * 1000;
                        const customOption = intervalSelect.querySelector('option[value="custom"]');
                        if (customOption) {
                            customOption.textContent = `Custom (${formatSnapshotInterval(CONFIG.minSnapshotInterval)})`;
                        }
                    } else {
                        alert("Invalid input. Please enter a positive number.");
                        updateSnapshotIntervalDropdown(intervalSelect);
                        return;
                    }
                } else {
                    updateSnapshotIntervalDropdown(intervalSelect);
                    return;
                }
            }

            // Persist the change
            GM_setValue('min_snapshot_interval', CONFIG.minSnapshotInterval);
        };

        intervalDiv.appendChild(intervalSelect);
        modal.appendChild(intervalDiv);

        // Track which preset option is selected (null = none, or the option name)
        let selectedPreset = null;

        // Shortcut options - mutually exclusive checkboxes + Select All toggle
        const shortcutsDiv = document.createElement('div');
        shortcutsDiv.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 15px;
        `;

        const checkboxInputStyle = `
            width: 16px;
            height: 16px;
            margin-right: 8px;
            cursor: pointer;
            accent-color: var(--color-blue-500, #3b82f6);
        `;

        // Helper function to update preset selection
        function updatePresetSelection(newPreset) {
            selectedPreset = selectedPreset === newPreset ? null : newPreset;
            
            // Clear the selection if switching presets
            selectedIndices.clear();
            
            if (selectedPreset === 'all') {
                // Select all snapshots
                if (history.length === 0) {
                    alert('No snapshots to select.');
                    selectedPreset = null;
                } else {
                    for (let i = 0; i < history.length; i++) {
                        selectedIndices.add(i);
                    }
                }
            } else if (selectedPreset === 'daily') {
                // Keep daily
                const dailyMap = new Map();
                history.forEach((entry, idx) => {
                    const date = new Date(entry.timestamp);
                    const dayKey = date.toISOString().split('T')[0];
                    if (!dailyMap.has(dayKey)) {
                        dailyMap.set(dayKey, []);
                    }
                    dailyMap.get(dayKey).push(idx);
                });
                dailyMap.forEach(indices => {
                    for (let i = 0; i < indices.length - 1; i++) {
                        selectedIndices.add(indices[i]);
                    }
                });
            } else if (selectedPreset === 'weekly') {
                // Keep weekly
                const weeklyMap = new Map();
                history.forEach((entry, idx) => {
                    const date = new Date(entry.timestamp);
                    const dayOfWeek = date.getUTCDay();
                    const diff = date.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
                    const weekStart = new Date(date.setUTCDate(diff));
                    const weekKey = weekStart.toISOString().split('T')[0];
                    if (!weeklyMap.has(weekKey)) {
                        weeklyMap.set(weekKey, []);
                    }
                    weeklyMap.get(weekKey).push(idx);
                });
                weeklyMap.forEach(indices => {
                    for (let i = 0; i < indices.length - 1; i++) {
                        selectedIndices.add(indices[i]);
                    }
                });
            } else if (selectedPreset === '7days') {
                // 7+ days old
                const now = getVirtualNow();
                const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                history.forEach((entry, idx) => {
                    if ((now - entry.timestamp) > sevenDaysMs) {
                        selectedIndices.add(idx);
                    }
                });
            }
            
            renderCheckboxList();
            updateCheckboxStates();
        }

        function updateCheckboxStates() {
            allCheckbox.checked = selectedPreset === 'all';
            dailyCheckbox.checked = selectedPreset === 'daily';
            weeklyCheckbox.checked = selectedPreset === 'weekly';
            deleteOldCheckbox.checked = selectedPreset === '7days';
        }

        // All snapshots checkbox
        const allOption = document.createElement('label');
        allOption.className = 'gmi-checkbox-option';
        allOption.style.color = 'var(--color-red-500, #ef4444)';
        const allCheckbox = document.createElement('input');
        allCheckbox.type = 'checkbox';
        allCheckbox.style.cssText = checkboxInputStyle;
        const allLabel = document.createElement('span');
        allLabel.textContent = 'Select All';
        allLabel.style.cssText = 'user-select: none;';
        allOption.appendChild(allCheckbox);
        allOption.appendChild(allLabel);
        allOption.onclick = (e) => {
            if (e.target === allCheckbox) updatePresetSelection('all');
        };
        allOption.onmouseover = (e) => e.currentTarget.style.borderColor = 'var(--color-red-500, #ef4444)';
        allOption.onmouseout = (e) => e.currentTarget.style.borderColor = selectedPreset === 'all' ? 'var(--color-red-500, #ef4444)' : 'var(--color-gray-300, #ddd)';
        shortcutsDiv.appendChild(allOption);

        // Keep daily checkbox
        const dailyOption = document.createElement('label');
        dailyOption.className = 'gmi-checkbox-option';
        dailyOption.style.color = 'var(--color-yellow-500, #f59e0b)';
        const dailyCheckbox = document.createElement('input');
        dailyCheckbox.type = 'checkbox';
        dailyCheckbox.style.cssText = checkboxInputStyle;
        dailyCheckbox.style.accentColor = 'var(--color-yellow-500, #f59e0b)';
        const dailyLabel = document.createElement('span');
        dailyLabel.textContent = 'Keep One Per Day';
        dailyLabel.style.cssText = 'user-select: none;';
        dailyOption.appendChild(dailyCheckbox);
        dailyOption.appendChild(dailyLabel);
        dailyOption.onclick = (e) => {
            if (e.target === dailyCheckbox) updatePresetSelection('daily');
        };
        dailyOption.onmouseover = (e) => e.currentTarget.style.borderColor = 'var(--color-yellow-500, #f59e0b)';
        dailyOption.onmouseout = (e) => e.currentTarget.style.borderColor = selectedPreset === 'daily' ? 'var(--color-yellow-500, #f59e0b)' : 'var(--color-gray-300, #ddd)';
        shortcutsDiv.appendChild(dailyOption);

        // Keep weekly checkbox
        const weeklyOption = document.createElement('label');
        weeklyOption.className = 'gmi-checkbox-option';
        weeklyOption.style.color = 'var(--color-blue-500, #3b82f6)';
        const weeklyCheckbox = document.createElement('input');
        weeklyCheckbox.type = 'checkbox';
        weeklyCheckbox.style.cssText = checkboxInputStyle;
        const weeklyLabel = document.createElement('span');
        weeklyLabel.textContent = 'Keep One Per Week';
        weeklyLabel.style.cssText = 'user-select: none;';
        weeklyOption.appendChild(weeklyCheckbox);
        weeklyOption.appendChild(weeklyLabel);
        weeklyOption.onclick = (e) => {
            if (e.target === weeklyCheckbox) updatePresetSelection('weekly');
        };
        weeklyOption.onmouseover = (e) => e.currentTarget.style.borderColor = 'var(--color-blue-500, #3b82f6)';
        weeklyOption.onmouseout = (e) => e.currentTarget.style.borderColor = selectedPreset === 'weekly' ? 'var(--color-blue-500, #3b82f6)' : 'var(--color-gray-300, #ddd)';
        shortcutsDiv.appendChild(weeklyOption);

        // 7+ days old checkbox
        const deleteOldOption = document.createElement('label');
        deleteOldOption.className = 'gmi-checkbox-option';
        deleteOldOption.style.color = 'var(--color-purple-500, #8b5cf6)';
        const deleteOldCheckbox = document.createElement('input');
        deleteOldCheckbox.type = 'checkbox';
        deleteOldCheckbox.style.cssText = checkboxInputStyle;
        deleteOldCheckbox.style.accentColor = 'var(--color-purple-500, #8b5cf6)';
        const deleteOldLabel = document.createElement('span');
        deleteOldLabel.textContent = 'Delete 7+ Days Old';
        deleteOldLabel.style.cssText = 'user-select: none;';
        deleteOldOption.appendChild(deleteOldCheckbox);
        deleteOldOption.appendChild(deleteOldLabel);
        deleteOldOption.onclick = (e) => {
            if (e.target === deleteOldCheckbox) updatePresetSelection('7days');
        };
        deleteOldOption.onmouseover = (e) => e.currentTarget.style.borderColor = 'var(--color-purple-500, #8b5cf6)';
        deleteOldOption.onmouseout = (e) => e.currentTarget.style.borderColor = selectedPreset === '7days' ? 'var(--color-purple-500, #8b5cf6)' : 'var(--color-gray-300, #ddd)';
        shortcutsDiv.appendChild(deleteOldOption);

        modal.appendChild(shortcutsDiv);

        // Snapshot list container
        const listContainer = document.createElement('div');
        listContainer.className = 'gmi-snapshot-list';
        listContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
        `;
        modal.appendChild(listContainer);

        function renderCheckboxList() {
            listContainer.innerHTML = '';
            
            if (history.length === 0) {
                listContainer.innerHTML = '<p style="color: #6b7280; text-align: center; padding: 20px;">No snapshots available.</p>';
                return;
            }

            let currentDayKey = null;
            let useAltColor = false;

            history.forEach((entry, idx) => {
                const item = document.createElement('div');
                const isSelected = selectedIndices.has(idx);
                
                // Check if date changed
                const entryDate = new Date(entry.timestamp);
                const entryDayKey = entryDate.toISOString().split('T')[0]; // YYYY-MM-DD
                if (entryDayKey !== currentDayKey) {
                    currentDayKey = entryDayKey;
                    useAltColor = !useAltColor; // Toggle color when day changes
                }
                
                item.className = isSelected ? 'gmi-snapshot-item selected' : 'gmi-snapshot-item';
                if (!isSelected && useAltColor) {
                    item.style.background = 'var(--color-gray-100, #f3f4f6)';
                }

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = selectedIndices.has(idx);
                checkbox.style.cssText = 'margin-right: 10px; cursor: pointer; accent-color: var(--color-blue-500, #3b82f6);';
                checkbox.onchange = (e) => {
                    if (e.target.checked) {
                        selectedIndices.add(idx);
                    } else {
                        selectedIndices.delete(idx);
                    }
                    renderCheckboxList();
                };
                item.appendChild(checkbox);

                const label = document.createElement('label');
                label.style.cssText = `flex: 1; cursor: pointer; font-size: 12px; color: ${isSelected ? 'var(--color-red-700, #991b1b)' : 'var(--color-gray-700, #374151)'}; ${isSelected ? 'text-decoration: line-through;' : ''}`;
                label.onclick = () => {
                    checkbox.checked = !checkbox.checked;
                    if (checkbox.checked) {
                        selectedIndices.add(idx);
                    } else {
                        selectedIndices.delete(idx);
                    }
                    renderCheckboxList();
                };

                const timestamp = new Date(entry.timestamp);
                const memberCount = Object.keys(entry.members).length;
                label.innerHTML = `
                    <span style="font-weight: bold;">${idx + 1})</span>
                    ${timestamp.toLocaleString()} 
                    <span style="color: ${isSelected ? 'var(--color-red-600, #b91c1c)' : 'var(--color-gray-500, #6b7280)'};">(${memberCount} members)</span>
                `;
                item.appendChild(label);

                listContainer.appendChild(item);
            });
        }

        renderCheckboxList();

        // Bottom buttons
        const buttonDiv = document.createElement('div');
        buttonDiv.style.cssText = `
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            border-top: 1px solid var(--color-gray-200, #e5e7eb);
            padding-top: 15px;
        `;

        const deleteSelectedBtn = document.createElement('button');
        deleteSelectedBtn.innerHTML = '🗑️ Delete Selected';
        deleteSelectedBtn.className = 'gmi-action-btn danger';
        deleteSelectedBtn.onclick = () => {
            if (selectedIndices.size === 0) {
                alert('No snapshots selected.');
                return;
            }
            const newHistory = history.filter((_, idx) => !selectedIndices.has(idx));
            const deleted = history.length - newHistory.length;
            if (confirm(`Delete ${deleted} snapshot(s)?`)) {
                GM_setValue('guild_xp_history', newHistory);
                overlay.remove();
                modal.remove();
                onClose(newHistory);
            }
        };
        buttonDiv.appendChild(deleteSelectedBtn);

        const exportBtn = document.createElement('button');
        exportBtn.innerHTML = '💾 Export Snapshots';
        exportBtn.className = 'gmi-action-btn primary';
        exportBtn.onclick = () => {
            exportSnapshots();
        };
        buttonDiv.appendChild(exportBtn);

        const importBtn = document.createElement('button');
        importBtn.innerHTML = '📥 Import Snapshots';
        importBtn.className = 'gmi-action-btn success';
        importBtn.onclick = () => {
            importSnapshots();
        };
        buttonDiv.appendChild(importBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.innerHTML = '✕ Close';
        cancelBtn.className = 'gmi-action-btn neutral';
        cancelBtn.onclick = () => {
            overlay.remove();
            modal.remove();
        };
        buttonDiv.appendChild(cancelBtn);

        modal.appendChild(buttonDiv);

        overlay.onclick = () => {
            overlay.remove();
            modal.remove();
        };

        document.body.appendChild(overlay);
        document.body.appendChild(modal);
    }

    function renderXPChanges(container) {
        container.innerHTML = '';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.height = '100%';
        
        const currentMembers = parseGuildMembers();
        let history = GM_getValue('guild_xp_history', []);
        
        if (!currentMembers || Object.keys(currentMembers).length === 0) {
            container.innerHTML = '<p class="text-gray-500">Please wait for members to load...</p>';
            return;
        }

        // --- Controls ---
        const controls = document.createElement('div');
        controls.style.marginBottom = '15px';
        controls.style.display = 'flex';
        controls.style.flexDirection = 'column';
        controls.style.gap = '10px';

        // Snapshot Button + Action Buttons
        const snapRow = document.createElement('div');
        snapRow.style.display = 'flex';
        snapRow.style.justifyContent = 'flex-end';
        snapRow.style.gap = '8px';
        snapRow.style.flexWrap = 'wrap';

        const snapBtn = document.createElement('button');
        snapBtn.innerHTML = '📷 Take a Snapshot';
        snapBtn.className = 'control-button';
        snapBtn.onclick = () => {
            history = saveGuildSnapshot(currentMembers, true);
            renderXPChanges(container);
        };
        snapRow.appendChild(snapBtn);

        const csvBtn = document.createElement('button');
        csvBtn.innerHTML = '📥 Export CSV';
        csvBtn.className = 'control-button';
        csvBtn.onclick = () => {
            // Pass current selection to export function
            exportToCSV(history, currentMembers, fromSelect.value, toSelect.value);
        };
        snapRow.appendChild(csvBtn);

        const exportAllDataBtn = document.createElement('button');
        exportAllDataBtn.innerHTML = '🎨 Export All User Data';
        exportAllDataBtn.className = 'control-button';
        exportAllDataBtn.style.color = '#a855f7';
        exportAllDataBtn.title = 'Fetch and export all guild members\' data (including colors) as JSON';
        exportAllDataBtn.onclick = async () => {
            exportAllDataBtn.disabled = true;
            exportAllDataBtn.style.opacity = '0.5';
            await fetchAllGuildMembersData();
            exportAllDataBtn.disabled = false;
            exportAllDataBtn.style.opacity = '1';
        };
        snapRow.appendChild(exportAllDataBtn);

        const cleanBtn = document.createElement('button');
        cleanBtn.innerHTML = '🧹 Manage History';
        cleanBtn.className = 'control-button';
        cleanBtn.style.color = '#ef4444';
        cleanBtn.onclick = () => {
            renderCleanHistoryModal((newHistory) => {
                history = newHistory;
                renderXPChanges(container);
            });
        };
        snapRow.appendChild(cleanBtn);

        controls.appendChild(snapRow);

        // Selectors
        const getOptions = () => {
            const snaps = history.map((entry, index) => ({
                label: `${index + 1}) ${new Date(entry.timestamp).toLocaleString()}`,
                value: index,
                members: entry.members
            }));
            const curr = {
                label: `Now (${new Date(getVirtualNow()).toLocaleString()})`,
                value: 'current',
                members: currentMembers
            };
            return { snaps, curr, all: [...snaps, curr] };
        };

        let { snaps: snapshots, curr: currentSnapshot, all: allOptions } = getOptions();

        // Filter buttons
        const filterRow = document.createElement('div');
        filterRow.style.display = 'flex';
        filterRow.style.gap = '8px';
        filterRow.style.flexWrap = 'wrap';
        
        let filterMode = 'all'; // 'all', 'active', 'inactive', 'in-territory', 'out-of-territory'

        const clearAllFilterActive = () => {
            allBtn.classList.remove('active');
            activeBtn.classList.remove('active');
            inactiveBtn.classList.remove('active');
            inTerritoryBtn.classList.remove('active');
            outOfTerritoryBtn.classList.remove('active');
        };

        const allBtn = document.createElement('button');
        allBtn.innerHTML = 'Show All';
        allBtn.className = 'control-button active';
        allBtn.onclick = () => {
            filterMode = 'all';
            clearAllFilterActive();
            allBtn.classList.add('active');
            updateTable();
        };
        filterRow.appendChild(allBtn);
        
        const activeBtn = document.createElement('button');
        activeBtn.innerHTML = 'Active';
        activeBtn.className = 'control-button';
        activeBtn.onclick = () => {
            filterMode = 'active';
            clearAllFilterActive();
            activeBtn.classList.add('active');
            updateTable();
        };
        filterRow.appendChild(activeBtn);
        
        const inactiveBtn = document.createElement('button');
        inactiveBtn.innerHTML = 'Inactive';
        inactiveBtn.className = 'control-button';
        inactiveBtn.onclick = () => {
            filterMode = 'inactive';
            clearAllFilterActive();
            inactiveBtn.classList.add('active');
            updateTable();
        };
        filterRow.appendChild(inactiveBtn);

        const inTerritoryBtn = document.createElement('button');
        inTerritoryBtn.innerHTML = '🟦 In Territory';
        inTerritoryBtn.className = 'control-button xp-territory-filter-btn';
        inTerritoryBtn.style.display = playersVisible ? '' : 'none';
        inTerritoryBtn.onclick = () => {
            filterMode = 'in-territory';
            clearAllFilterActive();
            inTerritoryBtn.classList.add('active');
            updateTable();
        };
        filterRow.appendChild(inTerritoryBtn);

        const outOfTerritoryBtn = document.createElement('button');
        outOfTerritoryBtn.innerHTML = '🟥 Out of Territory';
        outOfTerritoryBtn.className = 'control-button xp-territory-filter-btn';
        outOfTerritoryBtn.style.display = playersVisible ? '' : 'none';
        outOfTerritoryBtn.onclick = () => {
            filterMode = 'out-of-territory';
            clearAllFilterActive();
            outOfTerritoryBtn.classList.add('active');
            updateTable();
        };
        filterRow.appendChild(outOfTerritoryBtn);

        controls.appendChild(filterRow);

        const row1 = document.createElement('div');
        row1.style.display = 'flex';
        row1.style.gap = '10px';
        row1.style.alignItems = 'center';
        row1.style.flexWrap = 'wrap';

        const fromSelect = document.createElement('select');
        fromSelect.style.flex = '1';
        fromSelect.style.padding = '4px';
        fromSelect.style.border = '2px solid #3b82f6';
        fromSelect.style.borderRadius = '4px';
        
        const toSelect = document.createElement('select');
        toSelect.style.flex = '1';
        toSelect.style.padding = '4px';
        toSelect.style.border = '2px solid #3b82f6';
        toSelect.style.borderRadius = '4px';

        // Populate
        allOptions.forEach(opt => {
            fromSelect.add(new Option(opt.label, opt.value));
            toSelect.add(new Option(opt.label, opt.value));
        });

        // Defaults
        if (snapshots.length >= 1) {
            fromSelect.value = snapshots[snapshots.length - 1].value;
        } else {
            fromSelect.value = 'current';
        }
        toSelect.value = 'current';

        row1.appendChild(document.createTextNode('From:'));
        row1.appendChild(fromSelect);

        // Delete "From" button
        const deleteFromBtn = document.createElement('button');
        deleteFromBtn.className = 'trash-btn';
        deleteFromBtn.innerHTML = '🗑️';
        deleteFromBtn.title = 'Delete this snapshot';
        deleteFromBtn.onclick = () => {
            const snapIndex = parseInt(fromSelect.value);
            if (snapIndex >= 0 && snapIndex < history.length) {
                if (confirm('Delete this snapshot?')) {
                    history.splice(snapIndex, 1);
                    GM_setValue('guild_xp_history', history);
                    renderXPChanges(container);
                }
            }
        };
        row1.appendChild(deleteFromBtn);

        row1.appendChild(document.createTextNode('To:'));
        row1.appendChild(toSelect);

        // Delete "To" button
        const deleteToBtn = document.createElement('button');
        deleteToBtn.className = 'trash-btn';
        deleteToBtn.innerHTML = '🗑️';
        deleteToBtn.title = 'Delete this snapshot';
        deleteToBtn.onclick = () => {
            const snapIndex = parseInt(toSelect.value);
            if (snapIndex >= 0 && snapIndex < history.length) {
                if (confirm('Delete this snapshot?')) {
                    history.splice(snapIndex, 1);
                    GM_setValue('guild_xp_history', history);
                    renderXPChanges(container);
                }
            }
        };
        row1.appendChild(deleteToBtn);

        controls.appendChild(row1);

        // Results Area
        const resultsDiv = document.createElement('div');
        resultsDiv.style.flex = '1';
        resultsDiv.style.overflowY = 'auto';
        resultsDiv.style.minHeight = '0'; // Crucial for flexbox scrolling
        resultsDiv.style.border = '1px solid #e5e7eb';
        resultsDiv.style.borderRadius = '0.5rem';

        const updateTable = () => {
            resultsDiv.innerHTML = '';
            const fromVal = fromSelect.value;
            const toVal = toSelect.value;
            
            const fromData = fromVal === 'current' ? currentSnapshot : snapshots[fromVal];
            const toData = toVal === 'current' ? currentSnapshot : snapshots[toVal];
            
            if (!fromData || !toData) return;

            let changes = calculateXPChanges(fromData.members, toData.members);
            
            // Apply filter
            if (filterMode === 'active') {
                changes = changes.filter(c => {
                    // Active = Joined OR Positive XP Gain
                    return c.type === 'join' || c.diff > 0;
                });
            } else if (filterMode === 'inactive') {
                changes = changes.filter(c => {
                    // Inactive = Left OR Zero/Negative XP Gain
                    return c.type === 'left' || c.diff <= 0;
                });
            } else if (filterMode === 'in-territory') {
                changes = changes.filter(c => {
                    const markerInfo = playerMarkerData.find(m => m.name === c.name);
                    return markerInfo && markerInfo.inTerritory;
                });
            } else if (filterMode === 'out-of-territory') {
                changes = changes.filter(c => {
                    const markerInfo = playerMarkerData.find(m => m.name === c.name);
                    return markerInfo && !markerInfo.inTerritory;
                });
            }
            
            // Sort
            changes.sort((a, b) => {
                if (a.type === 'join') return -1;
                if (b.type === 'join') return 1;
                if (a.type === 'left') return 1;
                if (b.type === 'left') return -1;
                return b.diff - a.diff;
            });

            const table = document.createElement('table');
            table.className = 'daily-brief-table';
            table.innerHTML = `<thead><tr><th>User</th><th>Change</th><th>Details</th></tr></thead>`;
            const tbody = document.createElement('tbody');

            if (changes.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center">No changes.</td></tr>`;
            } else {
                changes.forEach(change => {
                    const tr = document.createElement('tr');
                    
                    // User Cell with Buttons and Coordinates
                    const userTd = document.createElement('td');
                    userTd.style.display = 'flex';
                    userTd.style.alignItems = 'center';
                    userTd.style.gap = '4px';
                    
                    // Create user info (name only)
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'user-name';
                    nameSpan.textContent = change.name || change.id;
                    
                    userTd.appendChild(nameSpan);

                    // Extract ID — change.id is already the numeric userId string
                    const userId = change.id;
                    if (userId && /^\d+$/.test(userId)) {
                        const discordBtn = document.createElement('button');
                        discordBtn.className = 'member-icon-btn discord-icon';
                        discordBtn.title = 'Check Discord';
                        discordBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 127.14 96.36" width="16" height="16" fill="currentColor">
                                <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.11,77.11,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22c1.24-23.25-13.28-47.54-18.9-72.15ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
                            </svg>
                        `;
                        discordBtn.onclick = async (e) => {
                            e.stopPropagation();
                            const data = await fetchUserProfile(userId);
                            if (data && data.discordUser) {
                                navigator.clipboard.writeText(data.discordUser).then(() => {
                                    showTooltip(e.clientX, e.clientY, `Discord ID: ${data.discordUser} copied!`);
                                });
                            } else {
                                showTooltip(e.clientX, e.clientY, 'No Discord ID found.');
                            }
                        };
                        userTd.appendChild(discordBtn);
                    }

                    // Map Button
                    if (change.coords) {
                        const mapBtn = document.createElement('button');
                        mapBtn.className = 'member-icon-btn map-icon';
                        mapBtn.setAttribute('data-player-name', change.name || change.id);
                        // If player markers are active, mark out-of-territory players red
                        if (playersVisible && playerMarkerData.length > 0) {
                            const markerInfo = playerMarkerData.find(m => m.name === (change.name || change.id));
                            if (markerInfo && !markerInfo.inTerritory) {
                                mapBtn.classList.add('out-of-territory');
                            }
                        }
                        mapBtn.title = 'Find on Map';
                        mapBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="10" r="3"/>
                                <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/>
                            </svg>
                        `;
                        const coordKey = `${change.coords[0]},${change.coords[1]}`;
                        if (sessionState.visitedCoords.has(coordKey)) {
                            mapBtn.classList.add('visited');
                        }
                        mapBtn.onclick = () => {
                            // Find the original Find button in the member row and click it
                            const memberName = change.name || change.id;
                            const memberRows = document.querySelectorAll('#guildMembersContainer div.flex.items-center.justify-between');
                            let found = false;
                            for (const row of memberRows) {
                                const nameEl = row.querySelector('p.font-semibold');
                                if (nameEl) {
                                    // Remove badge the same way parseGuildMembers does
                                    let displayName = nameEl.textContent.trim();
                                    const badge = nameEl.querySelector('span');
                                    if (badge) {
                                        displayName = displayName.replace(badge.textContent, '').trim();
                                    }
                                    // Match by exact name to handle both users with and without usernames
                                    if (displayName === memberName) {
                                        const findBtn = row.querySelector('button[onclick^="goToGridLocation"]');
                                        if (findBtn) {
                                            findBtn.click();
                                            found = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            if (!found && window.goToGridLocation) {
                                window.goToGridLocation(change.coords[0], change.coords[1]);
                            }
                            // Mark as visited
                            sessionState.visitedCoords.add(coordKey);
                            mapBtn.classList.add('visited');
                        };
                        userTd.appendChild(mapBtn);
                    }

                    // Display coordinates if available (right-aligned)
                    if (change.coords) {
                        const spacer = document.createElement('div');
                        spacer.style.flex = '1';
                        userTd.appendChild(spacer);
                        
                        const coordsSpan = document.createElement('span');
                        coordsSpan.className = 'user-coords';
                        
                        // Get colors based on quadrant and distance
                        const colors = getCoordinateColor(change.coords);
                        coordsSpan.style.backgroundColor = colors.bg;
                        coordsSpan.style.padding = '2px 6px';
                        coordsSpan.style.borderRadius = '3px';
                        
                        // Create styled parts
                        const openParen = document.createElement('span');
                        openParen.style.color = colors.text;
                        openParen.textContent = '(';
                        
                        const xVal = document.createElement('span');
                        xVal.style.color = colors.text;
                        xVal.style.fontWeight = '500';
                        xVal.textContent = change.coords[0];
                        
                        const comma = document.createElement('span');
                        comma.style.color = colors.text;
                        comma.textContent = ', ';
                        
                        const yVal = document.createElement('span');
                        yVal.style.color = colors.text;
                        yVal.style.fontWeight = '500';
                        yVal.textContent = change.coords[1];
                        
                        const closeParen = document.createElement('span');
                        closeParen.style.color = colors.text;
                        closeParen.textContent = ')';
                        
                        coordsSpan.appendChild(openParen);
                        coordsSpan.appendChild(xVal);
                        coordsSpan.appendChild(comma);
                        coordsSpan.appendChild(yVal);
                        coordsSpan.appendChild(closeParen);
                        
                        userTd.appendChild(coordsSpan);
                    }

                    let changeCell = '';
                    if (change.type === 'gain') {
                        changeCell = change.diff > 0 ? `<td class="xp-gain">+${change.diff.toLocaleString()}</td>` : 
                                     (change.diff < 0 ? `<td class="xp-loss">${change.diff.toLocaleString()}</td>` : `<td class="xp-neutral">0</td>`);
                    } else if (change.type === 'join') {
                        changeCell = `<td class="xp-gain">JOINED</td>`;
                    } else if (change.type === 'left') {
                        changeCell = `<td class="xp-loss">LEFT</td>`;
                    }
                    
                    tr.appendChild(userTd);
                    
                    // Change Cell
                    const changeTd = document.createElement('td');
                    changeTd.innerHTML = changeCell.replace(/^<td.*?>|<\/td>$/g, ''); // Strip outer td tags since we are creating td
                    changeTd.className = changeCell.match(/class="([^"]+)"/)?.[1] || '';
                    tr.appendChild(changeTd);

                    // Details Cell
                    const detailsTd = document.createElement('td');
                    detailsTd.textContent = `${change.oldXp?.toLocaleString() || 0} → ${change.newXp?.toLocaleString() || 0}`;
                    tr.appendChild(detailsTd);

                    tbody.appendChild(tr);
                });
            }
            table.appendChild(tbody);
            resultsDiv.appendChild(table);
        };

        fromSelect.onchange = updateTable;
        toSelect.onchange = updateTable;
        
        updateTable();

        container.appendChild(controls);
        container.appendChild(resultsDiv);
    }

    function formatSnapshotInterval(ms) {
        const seconds = ms / 1000;
        if (seconds < 60) return `${seconds}s`;
        const minutes = seconds / 60;
        if (minutes < 60) return `${minutes.toFixed(1)}m`;
        const hours = minutes / 60;
        if (hours < 24) return `${hours.toFixed(1)}h`;
        const days = hours / 24;
        return `${days.toFixed(1)}d`;
    }

    function getSnapshotIntervalLabel(ms) {
        if (ms === SNAPSHOT_INTERVALS.HOURLY) return 'Hourly (1h)';
        if (ms === SNAPSHOT_INTERVALS.TWELVE_HOURS) return '12 Hours';
        if (ms === SNAPSHOT_INTERVALS.TWENTY_FOUR_HOURS) return '24 Hours';
        return `Custom (${formatSnapshotInterval(ms)})`;
    }

    function updateSnapshotIntervalDropdown(dropdown) {
        // Update dropdown to show current value
        if (CONFIG.minSnapshotInterval === SNAPSHOT_INTERVALS.HOURLY) {
            dropdown.value = 'hourly';
        } else if (CONFIG.minSnapshotInterval === SNAPSHOT_INTERVALS.TWELVE_HOURS) {
            dropdown.value = '12h';
        } else if (CONFIG.minSnapshotInterval === SNAPSHOT_INTERVALS.TWENTY_FOUR_HOURS) {
            dropdown.value = '24h';
        } else {
            dropdown.value = 'custom';
            const customOption = dropdown.querySelector('option[value="custom"]');
            if (customOption) {
                customOption.textContent = `Custom (${formatSnapshotInterval(CONFIG.minSnapshotInterval)})`;
            }
        }
    }

    // =====================================================
    // === TERRITORY MAP OVERLAY (New in 3.0.0) ===
    // =====================================================

    /**
     * Create the territory overlay canvas that sits on top of the map.
     * Similar approach to geopixels++ censor canvas but draws stroke-only rectangles.
     */
    function createTerritoryCanvas() {
        if (territoryCanvas) return;

        territoryCanvas = document.createElement('canvas');
        territoryCanvas.id = 'territory-canvas';
        document.body.appendChild(territoryCanvas);
        console.log('[Guild Territories] Territory canvas created');
    }

    /**
     * Load an image from a data URL and return its natural dimensions.
     */
    function getImageDimensionsFromSrc(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = src;
        });
    }

    /**
     * Process all guild projects and build territory rectangles.
     * Each project has imageGridX, imageGridY (top-left) and an image (base64 PNG).
     * Width/height are the pixel dimensions of the PNG (1 pixel = 1 grid unit).
     */
    async function buildTerritoryRects() {
        if (typeof userGuildData === 'undefined' || !userGuildData || !userGuildData.projects) {
            console.warn('[Guild Territories] No guild data or projects available');
            return [];
        }

        const projects = userGuildData.projects;
        if (projects.length === 0) return [];

        const rects = [];

        for (let i = 0; i < projects.length; i++) {
            const project = projects[i];
            try {
                const dims = await getImageDimensionsFromSrc(project.image);
                rects.push({
                    gridX: project.imageGridX,
                    gridY: project.imageGridY,
                    width: dims.width,
                    height: dims.height,
                    index: i + 1 // 1-based logical order matching guild modal display
                });
            } catch (err) {
                console.warn(`[Guild Territories] Failed to get dimensions for project #${i + 1} (id ${project.id}):`, err);
            }
        }

        return rects;
    }

    /**
     * Export guild territories as JSON compatible with the GeoPixels Json "Import JSON" feature.
     * Copies to clipboard in the format: [{ name, x, y, width, height }]
     * where x,y is top-left corner (matching Tauri/Json region format).
     */
    async function exportTerritoriesForJson() {
        const exportBtn = document.getElementById('exportTerritoriesBtn');
        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.innerHTML = '⏳ Loading...';
        }

        try {
            // Ensure guild projects are fetched
            if (typeof userGuildData !== 'undefined' && userGuildData && typeof fetchGuildProjects === 'function') {
                await fetchGuildProjects();
            }

            const rects = await buildTerritoryRects();

            if (rects.length === 0) {
                alert('No guild projects found to export.');
                return;
            }

            // Convert to json-compatible format
            const regions = rects.map(rect => ({
                name: `Template #${rect.index}`,
                x: rect.gridX,
                y: rect.gridY,
                width: rect.width,
                height: rect.height
            }));

            const json = JSON.stringify(regions, null, 2);

            try {
                await navigator.clipboard.writeText(json);
                if (exportBtn) {
                    exportBtn.innerHTML = '✅ Copied!';
                    setTimeout(() => { exportBtn.innerHTML = '📋 Export to Clipboard'; }, 2000);
                }
                console.log(`[Guild Territories] Exported ${regions.length} territories to clipboard for Json import`);
            } catch (clipErr) {
                // Fallback: show in prompt for manual copy
                prompt('Copy this JSON and paste into Json\'s "Import JSON":', json);
            }
        } catch (err) {
            console.error('[Guild Territories] Export failed:', err);
            alert('Failed to export territories: ' + err.message);
        } finally {
            if (exportBtn) exportBtn.disabled = false;
            // Restore button text if not in "Copied!" state
            if (exportBtn && !exportBtn.innerHTML.includes('✅')) {
                exportBtn.innerHTML = '📋 Export to Clipboard';
            }
        }
    }

    /**
     * Draw a single territory border rectangle on the canvas.
     * Converts grid coordinates → Mercator → WGS84 → screen pixels.
     * 
     * The coordinate system:
     * - gridX, gridY = top-left of the image in grid space
     * - In GeoPixels, Y axis in grid space is inverted relative to image space
     *   (gridY is top, gridY - height is bottom)
     */
    function drawTerritoryRect(ctx, rect, gSize, color, thickness, fillColor) {
        if (typeof turf === 'undefined' || typeof map === 'undefined') return;

        // Top-left in mercator: gridX is left edge, gridY is top edge
        // The image extends rightward (+X) and downward (-Y in grid terms)
        const topLeftMerc = [
            (rect.gridX - 0.5) * gSize,
            (rect.gridY + 0.5) * gSize
        ];
        const bottomRightMerc = [
            (rect.gridX - 0.5 + rect.width) * gSize,
            (rect.gridY + 0.5 - rect.height) * gSize
        ];

        const topLeftScreen = map.project(turf.toWgs84(topLeftMerc));
        const bottomRightScreen = map.project(turf.toWgs84(bottomRightMerc));

        const screenX = topLeftScreen.x;
        const screenY = topLeftScreen.y;
        const screenW = bottomRightScreen.x - topLeftScreen.x;
        const screenH = bottomRightScreen.y - topLeftScreen.y;

        // Frustum culling - skip if entirely off-screen
        if (
            screenX + screenW < 0 ||
            screenX > ctx.canvas.width ||
            screenY + screenH < 0 ||
            screenY > ctx.canvas.height
        ) return;

        // Optional fill
        if (territorySettings.showFill) {
            ctx.fillStyle = fillColor || territorySettings.fillColor;
            ctx.globalAlpha = territorySettings.fillAlpha;
            ctx.fillRect(screenX, screenY, screenW, screenH);
        }

        // Border stroke
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.globalAlpha = 1;
        ctx.strokeRect(screenX, screenY, screenW, screenH);

        // Draw project label if enabled (uses logical order #1, #2, etc.)
        if (territorySettings.showLabels && screenW > 40 && screenH > 20) {
            const label = `#${rect.index}`;
            ctx.font = `bold ${territorySettings.labelFontSize}px sans-serif`;
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.85;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(label, screenX + 4, screenY + 4);
        }
    }

    /**
     * Build a map of territory index → boolean indicating whether any guild
     * member is currently positioned inside each territory.
     * Used to distinguish active (in-use) vs abandoned/finished territories.
     */
    function buildTerritoryActivityMap() {
        const activity = {};
        if (territoryRects.length === 0) return activity;

        const members = parseGuildMembers();
        if (!members || Object.keys(members).length === 0) return activity;

        for (const rect of territoryRects) {
            let hasPlayers = false;
            for (const [, data] of Object.entries(members)) {
                const coords = getCoords(data);
                if (coords) {
                    const [gx, gy] = coords;
                    if (
                        gx >= rect.gridX &&
                        gx < rect.gridX + rect.width &&
                        gy <= rect.gridY &&
                        gy > rect.gridY - rect.height
                    ) {
                        hasPlayers = true;
                        break;
                    }
                }
            }
            activity[rect.index] = hasPlayers;
        }
        return activity;
    }

    /**
     * Redraw all territory rectangles on the overlay canvas.
     */
    function drawTerritories() {
        if (!territoryCanvas || !territoryVisible) return;

        const pixelCanvas = document.getElementById('pixel-canvas');
        if (!pixelCanvas) return;

        territoryCanvas.width = pixelCanvas.width;
        territoryCanvas.height = pixelCanvas.height;
        const ctx = territoryCanvas.getContext('2d');
        ctx.clearRect(0, 0, territoryCanvas.width, territoryCanvas.height);

        if (territoryRects.length === 0) return;

        const gSize = (typeof gridSize !== 'undefined') ? gridSize : 25;
        const thickness = territorySettings.borderThickness;

        // Build activity map for two-tone coloring if enabled
        if (territorySettings.colorByActivity) {
            territoryActivityMap = buildTerritoryActivityMap();
        }

        // When both territories and players are visible, compute occupancy
        // to highlight unoccupied territories in red
        const occupancyMap = (playersVisible && playerMarkerData.length > 0)
            ? buildTerritoryActivityMap()
            : null;

        territoryRects.forEach(rect => {
            let color = territorySettings.borderColor;
            let fillColor = territorySettings.fillColor;

            if (territorySettings.colorByActivity) {
                const isActive = territoryActivityMap[rect.index] ?? false;
                color = isActive ? territorySettings.activeBorderColor : territorySettings.abandonedBorderColor;
                fillColor = isActive ? territorySettings.activeFillColor : territorySettings.abandonedFillColor;
            }

            // Override: if players are visible and territory is unoccupied, color red
            if (occupancyMap && !(occupancyMap[rect.index])) {
                color = '#ef4444';
                fillColor = '#ef4444';
            }

            drawTerritoryRect(ctx, rect, gSize, color, thickness, fillColor);
        });
    }

    /**
     * Hook into map events so territories redraw on pan/zoom/resize.
     */
    function hookTerritoryToMap() {
        function waitForMapReady(callback) {
            let tries = 0;
            function check() {
                if (typeof map !== 'undefined' && map && map.on && map.getContainer) callback();
                else if (tries++ < 100) setTimeout(check, 100);
            }
            check();
        }

        waitForMapReady(() => {
            ['move', 'rotate', 'zoom'].forEach(ev => map.on(ev, drawTerritories));
            new ResizeObserver(drawTerritories).observe(map.getContainer());
            map.once('load', drawTerritories);
            console.log('[Guild Territories] Hooked to map events');
        });
    }

    /**
     * Toggle territory overlay on/off. If turning on, process projects first.
     */
    async function toggleTerritories() {
        if (territoryVisible) {
            // Turn off
            territoryVisible = false;
            if (territoryCanvas) {
                const ctx = territoryCanvas.getContext('2d');
                ctx.clearRect(0, 0, territoryCanvas.width, territoryCanvas.height);
            }
            updateTerritoryToggleButton();
            console.log('[Guild Territories] Territories hidden');
            return;
        }

        // Turn on - process projects
        const toggleBtn = document.getElementById('territoryToggleBtn');
        if (toggleBtn) {
            toggleBtn.disabled = true;
            toggleBtn.innerHTML = '⏳ Processing...';
        }

        try {
            // Ensure guild projects are fetched
            if (typeof userGuildData !== 'undefined' && userGuildData && typeof fetchGuildProjects === 'function') {
                await fetchGuildProjects();
            }

            territoryRects = await buildTerritoryRects();

            if (territoryRects.length === 0) {
                if (toggleBtn) {
                    toggleBtn.disabled = false;
                    toggleBtn.innerHTML = '🗺️ Show Territories';
                    toggleBtn.className = 'territory-toggle-btn inactive';
                }
                alert('No guild projects found to display territories for.');
                return;
            }

            createTerritoryCanvas();
            territoryVisible = true;
            drawTerritories();
            updateTerritoryToggleButton();
            console.log(`[Guild Territories] Showing ${territoryRects.length} territories`);

        } catch (err) {
            console.error('[Guild Territories] Error building territories:', err);
            alert('Failed to process territories: ' + err.message);
        }

        if (toggleBtn) toggleBtn.disabled = false;
    }

    /**
     * Update the toggle button appearance based on state.
     */
    function updateTerritoryToggleButton() {
        const toggleBtn = document.getElementById('territoryToggleBtn');
        if (!toggleBtn) return;

        if (territoryVisible) {
            toggleBtn.innerHTML = '🗺️ Hide Territories';
            toggleBtn.className = 'territory-toggle-btn active';
        } else {
            toggleBtn.innerHTML = '🗺️ Show Territories';
            toggleBtn.className = 'territory-toggle-btn inactive';
        }
    }

    /**
     * Build the inline collapsible settings panel HTML.
     * Returns the container element to be appended inside the territory controls.
     */
    function buildTerritorySettingsPanel() {
        const wrapper = document.createElement('div');
        wrapper.className = 'territory-settings-collapsible';
        wrapper.id = 'territorySettingsCollapsible';

        // Toggle header
        const toggle = document.createElement('button');
        toggle.className = 'territory-settings-toggle';
        toggle.innerHTML = '<span>⚙️ Settings</span><span class="toggle-arrow collapsed">▼</span>';

        // Content
        const content = document.createElement('div');
        content.className = 'territory-settings-content collapsed';

        const thicknessOptions = [
            { value: 1, label: 'Thin (1px)' },
            { value: 2, label: 'Normal (2px)' },
            { value: 3, label: 'Medium (3px)' },
            { value: 4, label: 'Thick (4px)' },
            { value: 6, label: 'Heavy (6px)' },
            { value: 8, label: 'Extra Heavy (8px)' }
        ];

        const fillOpacityPct = Math.round(territorySettings.fillAlpha * 100);

        content.innerHTML = `
            <div class="territory-setting-row">
                <label>Border Color</label>
                <input type="color" id="territoryColorInput" value="${territorySettings.borderColor}"
                       class="w-10 h-7 rounded-md cursor-pointer p-0.5">
            </div>
            <div class="territory-setting-row">
                <label>Border Thickness</label>
                <select id="territoryThicknessSelect" class="px-2 py-1 rounded-md text-xs min-w-[120px]">
                    ${thicknessOptions.map(opt =>
                        `<option value="${opt.value}" ${territorySettings.borderThickness == opt.value ? 'selected' : ''}>${opt.label}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="territory-setting-row">
                <label>Show Labels</label>
                <input type="checkbox" id="territoryLabelsCheck" ${territorySettings.showLabels ? 'checked' : ''}
                       class="w-4 h-4 cursor-pointer accent-blue-500">
            </div>
            <div class="territory-setting-row">
                <label>Label Size</label>
                <select id="territoryFontSelect" class="px-2 py-1 rounded-md text-xs min-w-[120px]">
                    ${[10, 12, 14, 16, 18, 20].map(s =>
                        `<option value="${s}" ${territorySettings.labelFontSize == s ? 'selected' : ''}>${s}px</option>`
                    ).join('')}
                </select>
            </div>

            <div class="territory-section-divider">Fill</div>
            <div class="territory-setting-row">
                <label>Enable Fill</label>
                <input type="checkbox" id="territoryFillCheck" ${territorySettings.showFill ? 'checked' : ''}
                       class="w-4 h-4 cursor-pointer accent-blue-500">
            </div>
            <div class="territory-setting-row">
                <label>Fill Color</label>
                <input type="color" id="territoryFillColorInput" value="${territorySettings.fillColor}"
                       class="w-10 h-7 rounded-md cursor-pointer p-0.5">
            </div>
            <div class="territory-setting-row">
                <label>Fill Opacity</label>
                <div class="flex items-center gap-1.5">
                    <input type="range" id="territoryFillAlphaRange" min="0.01" max="1" step="0.01" value="${territorySettings.fillAlpha}"
                           class="w-20 cursor-pointer">
                    <span id="territoryFillAlphaValue" class="text-xs min-w-[30px]" style="color: var(--color-gray-500, #6b7280);">${fillOpacityPct}%</span>
                </div>
            </div>

            <div class="territory-section-divider">Activity Coloring</div>
            <div class="territory-setting-row">
                <label>Color by activity</label>
                <input type="checkbox" id="territoryActivityCheck" ${territorySettings.colorByActivity ? 'checked' : ''}
                       class="w-4 h-4 cursor-pointer accent-blue-500"
                       title="Use different colors for territories with active players vs abandoned/finished">
            </div>
            <div id="activityColorRows" style="display:${territorySettings.colorByActivity ? 'flex' : 'none'};flex-direction:column;gap:10px;">
                <div class="territory-setting-row">
                    <label>Active Border</label>
                    <input type="color" id="territoryActiveBorderInput" value="${territorySettings.activeBorderColor}"
                           class="w-10 h-7 rounded-md cursor-pointer p-0.5">
                </div>
                <div class="territory-setting-row">
                    <label>Active Fill</label>
                    <input type="color" id="territoryActiveFillInput" value="${territorySettings.activeFillColor}"
                           class="w-10 h-7 rounded-md cursor-pointer p-0.5">
                </div>
                <div class="territory-setting-row">
                    <label>Abandoned Border</label>
                    <input type="color" id="territoryAbandonedBorderInput" value="${territorySettings.abandonedBorderColor}"
                           class="w-10 h-7 rounded-md cursor-pointer p-0.5">
                </div>
                <div class="territory-setting-row">
                    <label>Abandoned Fill</label>
                    <input type="color" id="territoryAbandonedFillInput" value="${territorySettings.abandonedFillColor}"
                           class="w-10 h-7 rounded-md cursor-pointer p-0.5">
                </div>
                <p style="font-size:11px;color:var(--color-gray-500,#6b7280);margin:0;">
                    Active = guild members drawing inside. Abandoned = no members inside.
                </p>
            </div>

            <div class="territory-section-divider">Preview</div>
            <div id="territoryPreviewContainer" class="flex items-center justify-center gap-2.5 py-1">
                <div id="territoryPreviewBox" style="width: 70px; height: 44px; border: ${territorySettings.borderThickness}px solid ${territorySettings.colorByActivity ? territorySettings.activeBorderColor : territorySettings.borderColor}; border-radius: 2px; position: relative; display: flex; align-items: flex-start; justify-content: flex-start; padding: 2px; background: var(--color-white, #fff);">
                    <div id="territoryPreviewFill" style="position: absolute; inset: 0; background: ${territorySettings.colorByActivity ? territorySettings.activeFillColor : territorySettings.fillColor}; opacity: ${territorySettings.showFill ? territorySettings.fillAlpha : 0}; border-radius: 1px;"></div>
                    <span style="font-size: ${territorySettings.labelFontSize}px; font-weight: bold; color: ${territorySettings.colorByActivity ? territorySettings.activeBorderColor : territorySettings.borderColor}; position: relative; z-index: 1;">${territorySettings.colorByActivity ? 'Active' : '#1'}</span>
                </div>
                <div id="territoryPreviewBoxAbandoned" style="width: 70px; height: 44px; border: ${territorySettings.borderThickness}px solid ${territorySettings.abandonedBorderColor}; border-radius: 2px; position: relative; display: ${territorySettings.colorByActivity ? 'flex' : 'none'}; align-items: flex-start; justify-content: flex-start; padding: 2px; background: var(--color-white, #fff);">
                    <div id="territoryPreviewFillAbandoned" style="position: absolute; inset: 0; background: ${territorySettings.abandonedFillColor}; opacity: ${territorySettings.showFill ? territorySettings.fillAlpha : 0}; border-radius: 1px;"></div>
                    <span style="font-size: ${territorySettings.labelFontSize}px; font-weight: bold; color: ${territorySettings.abandonedBorderColor}; position: relative; z-index: 1;">Done</span>
                </div>
            </div>
        `;

        // Toggle collapse
        toggle.addEventListener('click', () => {
            content.classList.toggle('collapsed');
            toggle.querySelector('.toggle-arrow').classList.toggle('collapsed');
        });

        wrapper.append(toggle, content);

        // Wire up live preview + auto-save after a brief delay
        const wireEvents = () => {
            const updatePreviewAndSave = () => {
                const color = document.getElementById('territoryColorInput')?.value;
                const thickness = parseInt(document.getElementById('territoryThicknessSelect')?.value);
                const fontSize = parseInt(document.getElementById('territoryFontSelect')?.value);
                const showLabels = document.getElementById('territoryLabelsCheck')?.checked;
                const showFill = document.getElementById('territoryFillCheck')?.checked;
                const fillColor = document.getElementById('territoryFillColorInput')?.value;
                const fillAlpha = parseFloat(document.getElementById('territoryFillAlphaRange')?.value);
                const colorByActivity = document.getElementById('territoryActivityCheck')?.checked;
                const activeBorderColor = document.getElementById('territoryActiveBorderInput')?.value;
                const activeFillColor = document.getElementById('territoryActiveFillInput')?.value;
                const abandonedBorderColor = document.getElementById('territoryAbandonedBorderInput')?.value;
                const abandonedFillColor = document.getElementById('territoryAbandonedFillInput')?.value;

                // Show/hide activity color rows
                const activityRows = document.getElementById('activityColorRows');
                if (activityRows) activityRows.style.display = colorByActivity ? 'flex' : 'none';

                // Update main preview box
                const box = document.getElementById('territoryPreviewBox');
                const fillDiv = document.getElementById('territoryPreviewFill');
                const previewBorderColor = colorByActivity ? activeBorderColor : color;
                const previewFillCol = colorByActivity ? activeFillColor : fillColor;

                if (box) {
                    box.style.borderColor = previewBorderColor;
                    box.style.borderWidth = thickness + 'px';
                    const label = box.querySelector('span');
                    if (label) {
                        label.style.color = previewBorderColor;
                        label.style.fontSize = fontSize + 'px';
                        label.textContent = colorByActivity ? 'Active' : '#1';
                    }
                }
                if (fillDiv) {
                    fillDiv.style.background = previewFillCol;
                    fillDiv.style.opacity = showFill ? fillAlpha : 0;
                }

                // Update abandoned preview box
                const boxAbandoned = document.getElementById('territoryPreviewBoxAbandoned');
                const fillDivAbandoned = document.getElementById('territoryPreviewFillAbandoned');
                if (boxAbandoned) {
                    boxAbandoned.style.display = colorByActivity ? 'flex' : 'none';
                    boxAbandoned.style.borderColor = abandonedBorderColor;
                    boxAbandoned.style.borderWidth = thickness + 'px';
                    const label = boxAbandoned.querySelector('span');
                    if (label) {
                        label.style.color = abandonedBorderColor;
                        label.style.fontSize = fontSize + 'px';
                    }
                }
                if (fillDivAbandoned) {
                    fillDivAbandoned.style.background = abandonedFillColor;
                    fillDivAbandoned.style.opacity = showFill ? fillAlpha : 0;
                }

                const alphaLabel = document.getElementById('territoryFillAlphaValue');
                if (alphaLabel) alphaLabel.textContent = Math.round(fillAlpha * 100) + '%';

                // Save and redraw
                territorySettings.borderColor = color;
                territorySettings.borderThickness = thickness;
                territorySettings.showLabels = showLabels;
                territorySettings.labelFontSize = fontSize;
                territorySettings.showFill = showFill;
                territorySettings.fillColor = fillColor;
                territorySettings.fillAlpha = fillAlpha;
                territorySettings.colorByActivity = colorByActivity;
                territorySettings.activeBorderColor = activeBorderColor;
                territorySettings.activeFillColor = activeFillColor;
                territorySettings.abandonedBorderColor = abandonedBorderColor;
                territorySettings.abandonedFillColor = abandonedFillColor;
                saveTerritorySettings();
                drawTerritories();
            };

            ['territoryColorInput', 'territoryFillColorInput', 'territoryActiveBorderInput', 'territoryActiveFillInput', 'territoryAbandonedBorderInput', 'territoryAbandonedFillInput'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', updatePreviewAndSave);
            });
            ['territoryThicknessSelect', 'territoryFontSelect'].forEach(id => {
                document.getElementById(id)?.addEventListener('change', updatePreviewAndSave);
            });
            ['territoryLabelsCheck', 'territoryFillCheck', 'territoryActivityCheck'].forEach(id => {
                document.getElementById(id)?.addEventListener('change', updatePreviewAndSave);
            });
            document.getElementById('territoryFillAlphaRange')?.addEventListener('input', updatePreviewAndSave);
        };

        // Defer event wiring until after DOM insertion
        setTimeout(wireEvents, 0);

        return wrapper;
    }

    /**
     * Add numbered badges (#1, #2, ...) to each project card in the guild modal.
     * Numbers match the logical display order used by the territory overlay.
     */
    function numberProjectCards() {
        const container = document.getElementById('guildProjectsContainer');
        if (!container) return;

        const cards = container.querySelectorAll(':scope > div');
        cards.forEach((card, i) => {
            // Skip if already numbered
            if (card.querySelector('.project-number-badge')) return;

            // Position the card for the badge
            card.style.position = 'relative';

            const badge = document.createElement('div');
            badge.className = 'project-number-badge';
            badge.textContent = `#${i + 1}`;
            badge.style.cssText = `
                position: absolute;
                top: 6px;
                left: 6px;
                background: var(--color-blue-500, #3b82f6);
                color: var(--color-white, #fff);
                font-size: 11px;
                font-weight: 700;
                padding: 2px 7px;
                border-radius: 6px;
                z-index: 5;
                box-shadow: 0 1px 4px rgba(0,0,0,0.2);
                pointer-events: none;
                line-height: 1.4;
            `;
            card.insertBefore(badge, card.firstChild);
        });
    }

    /**
     * Inject the territory controls into the Projects tab of the guild modal.
     */
    function injectTerritoryControls() {
        const projectsTab = document.getElementById('projectsTab');
        if (!projectsTab) return;

        // Don't inject twice
        if (document.getElementById('territoryControlsContainer')) return;

        const container = document.createElement('div');
        container.id = 'territoryControlsContainer';
        container.className = 'flex flex-col gap-3 mb-3 p-3 rounded-lg border';

        // Top row: toggle button + info (right-aligned)
        const topRow = document.createElement('div');
        topRow.className = 'flex items-center justify-between gap-2 flex-wrap';

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'territoryToggleBtn';
        toggleBtn.className = territoryVisible ? 'territory-toggle-btn active' : 'territory-toggle-btn inactive';
        toggleBtn.innerHTML = territoryVisible ? '🗺️ Hide Territories' : '🗺️ Show Territories';
        toggleBtn.addEventListener('click', toggleTerritories);

        const playersBtn = document.createElement('button');
        playersBtn.id = 'playersToggleBtn';
        playersBtn.className = playersVisible ? 'territory-toggle-btn active' : 'territory-toggle-btn inactive';
        playersBtn.innerHTML = playersVisible ? '👥 Hide Players' : '👥 Show Players';
        playersBtn.addEventListener('click', togglePlayers);

        const exportBtn = document.createElement('button');
        exportBtn.id = 'exportTerritoriesBtn';
        exportBtn.className = 'territory-toggle-btn inactive';
        exportBtn.innerHTML = '📋 Export to Clipboard';
        exportBtn.title = 'Copy guild territories as JSON for the GeoPixels Json import';
        exportBtn.addEventListener('click', exportTerritoriesForJson);

        const info = document.createElement('span');
        info.className = 'territory-info-text';
        info.textContent = 'Overlay territories or player locations on the map';

        topRow.append(toggleBtn, playersBtn, exportBtn, info);
        container.appendChild(topRow);

        // Player marker options row (checkboxes)
        const optionsRow = document.createElement('div');
        optionsRow.id = 'playersOptionsRow';
        optionsRow.className = 'player-marker-options';
        optionsRow.style.display = playersVisible ? 'flex' : 'none';

        const showNamesLabel = document.createElement('label');
        const showNamesCheck = document.createElement('input');
        showNamesCheck.type = 'checkbox';
        showNamesCheck.id = 'playersShowNamesCheck';
        showNamesCheck.checked = playersShowNames;
        showNamesCheck.addEventListener('change', (e) => {
            playersShowNames = e.target.checked;
            refreshMarkerLabels();
        });
        showNamesLabel.appendChild(showNamesCheck);
        showNamesLabel.appendChild(document.createTextNode('Show all names'));

        const colorTerritoryLabel = document.createElement('label');
        const colorTerritoryCheck = document.createElement('input');
        colorTerritoryCheck.type = 'checkbox';
        colorTerritoryCheck.id = 'playersColorTerritoryCheck';
        colorTerritoryCheck.checked = playersColorByTerritory;
        colorTerritoryCheck.addEventListener('change', (e) => {
            playersColorByTerritory = e.target.checked;
            refreshMarkerColors();
        });
        colorTerritoryLabel.appendChild(colorTerritoryCheck);
        colorTerritoryLabel.appendChild(document.createTextNode('Blue if in territory'));

        const showInTerritoryLabel = document.createElement('label');
        const showInTerritoryCheck = document.createElement('input');
        showInTerritoryCheck.type = 'checkbox';
        showInTerritoryCheck.id = 'playersShowInTerritoryCheck';
        showInTerritoryCheck.checked = playersShowInTerritory;
        showInTerritoryCheck.addEventListener('change', (e) => {
            playersShowInTerritory = e.target.checked;
            updatePlayerPositions();
        });
        showInTerritoryLabel.appendChild(showInTerritoryCheck);
        showInTerritoryLabel.appendChild(document.createTextNode('Show in-territory'));

        const showOutsideTerritoryLabel = document.createElement('label');
        const showOutsideTerritoryCheck = document.createElement('input');
        showOutsideTerritoryCheck.type = 'checkbox';
        showOutsideTerritoryCheck.id = 'playersShowOutsideTerritoryCheck';
        showOutsideTerritoryCheck.checked = playersShowOutsideTerritory;
        showOutsideTerritoryCheck.addEventListener('change', (e) => {
            playersShowOutsideTerritory = e.target.checked;
            updatePlayerPositions();
        });
        showOutsideTerritoryLabel.appendChild(showOutsideTerritoryCheck);
        showOutsideTerritoryLabel.appendChild(document.createTextNode('Show outside territory'));

        optionsRow.append(showNamesLabel, colorTerritoryLabel, showInTerritoryLabel, showOutsideTerritoryLabel);
        container.appendChild(optionsRow);

        // Settings collapsible panels (full width)
        container.appendChild(buildTerritorySettingsPanel());
        container.appendChild(buildPlayerSettingsPanel());

        // Insert at the top of the projects tab, before the first child
        projectsTab.insertBefore(container, projectsTab.firstChild);
    }

    // =====================================================
    // === PLAYER MARKERS OVERLAY (New in 3.1.0) ===
    // =====================================================

    /**
     * Collect guild member positions from the currently rendered member list.
     * Returns array of { name, gridX, gridY } for members with coordinates.
     */
    function buildPlayerMarkerData() {
        const members = parseGuildMembers();
        if (!members) return [];

        const markers = [];
        for (const [key, data] of Object.entries(members)) {
            const coords = getCoords(data);
            if (coords) {
                // key is now a numeric ID string; use data.name (full display name) when available
                const name = (data && data.name) || key;
                markers.push({ name, gridX: coords[0], gridY: coords[1] });
            }
        }
        return markers;
    }

    /**
     * Create the players overlay container (a div for DOM marker elements).
     */
    function createPlayersContainer() {
        if (playersContainer) return;

        playersContainer = document.createElement('div');
        playersContainer.id = 'players-container';
        document.body.appendChild(playersContainer);
        console.log('[Guild Players] Players container created');
    }

    /**
     * Create a single Google-Maps-style pin marker DOM element for a player.
     * The pin tip anchors at the exact grid coordinate.
     */
    /**
     * Check if a grid coordinate falls inside any territory rectangle.
     */
    function isInsideTerritory(gridX, gridY) {
        for (const rect of territoryRects) {
            if (
                gridX >= rect.gridX &&
                gridX < rect.gridX + rect.width &&
                gridY <= rect.gridY &&
                gridY > rect.gridY - rect.height
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the pin fill color for a marker based on territory status.
     */
    function getMarkerColor(inTerritory) {
        return (playersColorByTerritory && inTerritory) ? playerSettings.territoryColor : playerSettings.defaultColor;
    }

    function createMarkerElement(marker) {
        const wrapper = document.createElement('div');
        wrapper.className = 'player-marker' + (playersShowNames ? ' show-label' : '');
        wrapper.setAttribute('data-player', marker.name);

        const pinColor = getMarkerColor(marker.inTerritory);
        const w = playerSettings.markerSize;
        const h = Math.round(w * 40 / 28); // maintain aspect ratio 28:40

        // Google Maps teardrop SVG pin
        wrapper.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 36">
                <path class="pin-body" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${pinColor}"/>
                <circle cx="12" cy="11" r="4.5" fill="white"/>
            </svg>
            <div class="player-marker-tooltip" style="font-size:${playerSettings.labelFontSize}px">${marker.name.replace(/</g, '&lt;')}</div>
        `;

        // Click to teleport — find the member's actual Find button in the DOM
        // and .click() it (runs in page context), with fallback via script injection
        wrapper.addEventListener('click', (e) => {
            e.stopPropagation();

            let found = false;
            const memberRows = document.querySelectorAll('#guildMembersContainer div.flex.items-center.justify-between');
            for (const row of memberRows) {
                const nameEl = row.querySelector('p.font-semibold');
                if (nameEl) {
                    let displayName = nameEl.textContent.trim();
                    const badge = nameEl.querySelector('span');
                    if (badge) displayName = displayName.replace(badge.textContent, '').trim();
                    if (displayName === marker.name) {
                        const findBtn = row.querySelector('button[onclick^="goToGridLocation"]');
                        if (findBtn) {
                            findBtn.click();
                            found = true;
                            break;
                        }
                    }
                }
            }

            // Fallback: inject a script tag to call goToGridLocation in page context
            if (!found) {
                const s = document.createElement('script');
                s.textContent = `if(typeof goToGridLocation==='function')goToGridLocation(${parseInt(marker.gridX)},${parseInt(marker.gridY)});`;
                document.documentElement.appendChild(s);
                s.remove();
            }

            // Mark as visited
            const coordKey = `${marker.gridX},${marker.gridY}`;
            sessionState.visitedCoords.add(coordKey);
        });

        return wrapper;
    }

    /**
     * Convert a grid coordinate to screen pixel position using the same
     * pipeline as territory overlay: grid → Mercator → WGS84 → screen.
     */
    function gridToScreen(gridX, gridY, gSize) {
        if (typeof turf === 'undefined' || typeof map === 'undefined') return null;
        const mercCoord = [gridX * gSize, gridY * gSize];
        const screenPos = map.project(turf.toWgs84(mercCoord));
        return screenPos; // { x, y }
    }

    /**
     * Reposition all player marker DOM elements to match current map view.
     * Called on every map move/zoom/resize.
     */
    function updatePlayerPositions() {
        if (!playersContainer || !playersVisible) return;

        const gSize = (typeof gridSize !== 'undefined') ? gridSize : 25;
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const margin = 60; // off-screen buffer before hiding

        for (const marker of playerMarkerData) {
            // Hide based on territory visibility checkboxes
            if (marker.inTerritory && !playersShowInTerritory) {
                marker.element.style.display = 'none';
                continue;
            }
            if (!marker.inTerritory && !playersShowOutsideTerritory) {
                marker.element.style.display = 'none';
                continue;
            }

            const pos = gridToScreen(marker.gridX, marker.gridY, gSize);
            if (!pos) continue;

            // Frustum cull with margin
            if (pos.x < -margin || pos.x > viewW + margin || pos.y < -margin || pos.y > viewH + margin) {
                marker.element.style.display = 'none';
            } else {
                marker.element.style.display = '';
                marker.element.style.left = pos.x + 'px';
                marker.element.style.top = pos.y + 'px';
            }
        }
    }

    /**
     * Hook into map events so player markers reposition on pan/zoom/resize.
     */
    function hookPlayersToMap() {
        function waitForMapReady(callback) {
            let tries = 0;
            function check() {
                if (typeof map !== 'undefined' && map && map.on && map.getContainer) callback();
                else if (tries++ < 100) setTimeout(check, 100);
            }
            check();
        }

        waitForMapReady(() => {
            ['move', 'rotate', 'zoom'].forEach(ev => map.on(ev, updatePlayerPositions));
            new ResizeObserver(updatePlayerPositions).observe(map.getContainer());
            map.once('load', updatePlayerPositions);
            console.log('[Guild Players] Hooked to map events');
        });
    }

    /**
     * Toggle player markers overlay on/off.
     */
    /**
     * Update the "Find on Map" buttons in the XP Tracker tab to reflect
     * territory status (red for out-of-territory players) from playerMarkerData.
     */
    function updateXPTrackerMapButtons() {
        const xpPane = document.getElementById('xpTrackerPane');
        if (!xpPane) return;

        const mapBtns = xpPane.querySelectorAll('.map-icon[data-player-name]');
        mapBtns.forEach(btn => {
            const playerName = btn.getAttribute('data-player-name');
            if (!playerName) return;

            // Don't override visited state
            if (btn.classList.contains('visited')) return;

            if (playersVisible && playerMarkerData.length > 0) {
                const markerInfo = playerMarkerData.find(m => m.name === playerName);
                if (markerInfo && !markerInfo.inTerritory) {
                    btn.classList.add('out-of-territory');
                } else {
                    btn.classList.remove('out-of-territory');
                }
            } else {
                btn.classList.remove('out-of-territory');
            }
        });

        // Show/hide territory filter buttons in XP Tracker
        const xpTerritoryBtns = xpPane.querySelectorAll('.xp-territory-filter-btn');
        xpTerritoryBtns.forEach(btn => {
            btn.style.display = playersVisible ? '' : 'none';
        });
    }

    /**
     * Refresh all marker pin colors (e.g. after territory data changes or checkbox toggle).
     */
    function refreshMarkerColors() {
        for (const marker of playerMarkerData) {
            const pinBody = marker.element.querySelector('.pin-body');
            if (pinBody) {
                pinBody.setAttribute('fill', getMarkerColor(marker.inTerritory));
            }
        }
    }

    /**
     * Toggle show-label class on all markers.
     */
    function refreshMarkerLabels() {
        for (const marker of playerMarkerData) {
            marker.element.classList.toggle('show-label', playersShowNames);
        }
    }

    /**
     * Refresh all marker sizes and label font sizes from playerSettings.
     */
    function refreshMarkerSizes() {
        const w = playerSettings.markerSize;
        const h = Math.round(w * 40 / 28);
        for (const marker of playerMarkerData) {
            const svg = marker.element.querySelector('svg');
            if (svg) {
                svg.setAttribute('width', w);
                svg.setAttribute('height', h);
            }
            const tooltip = marker.element.querySelector('.player-marker-tooltip');
            if (tooltip) {
                tooltip.style.fontSize = playerSettings.labelFontSize + 'px';
            }
        }
    }

    /**
     * Build a collapsible settings panel for player marker appearance.
     */
    function buildPlayerSettingsPanel() {
        const wrapper = document.createElement('div');
        wrapper.className = 'territory-settings-collapsible';
        wrapper.id = 'playerSettingsCollapsible';

        const toggle = document.createElement('button');
        toggle.className = 'territory-settings-toggle';
        toggle.innerHTML = '<span>👥 Player Settings</span><span class="toggle-arrow collapsed">▼</span>';

        const content = document.createElement('div');
        content.className = 'territory-settings-content collapsed';

        const sizeOptions = [
            { value: 16, label: 'Tiny (16px)' },
            { value: 20, label: 'Small (20px)' },
            { value: 24, label: 'Medium (24px)' },
            { value: 28, label: 'Default (28px)' },
            { value: 34, label: 'Large (34px)' },
            { value: 42, label: 'Extra Large (42px)' }
        ];

        content.innerHTML = `
            <div class="territory-setting-row">
                <label>Marker Size</label>
                <select id="playerSizeSelect" class="px-2 py-1 rounded-md text-xs min-w-[120px]">
                    ${sizeOptions.map(opt =>
                        `<option value="${opt.value}" ${playerSettings.markerSize == opt.value ? 'selected' : ''}>${opt.label}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="territory-setting-row">
                <label>Label Size</label>
                <select id="playerLabelSizeSelect" class="px-2 py-1 rounded-md text-xs min-w-[120px]">
                    ${[9, 10, 11, 12, 13, 14, 16].map(s =>
                        `<option value="${s}" ${playerSettings.labelFontSize == s ? 'selected' : ''}>${s}px</option>`
                    ).join('')}
                </select>
            </div>
            <div class="territory-setting-row">
                <label>Default Color</label>
                <input type="color" id="playerDefaultColorInput" value="${playerSettings.defaultColor}"
                       class="w-10 h-7 rounded-md cursor-pointer p-0.5">
            </div>
            <div class="territory-setting-row">
                <label>Territory Color</label>
                <input type="color" id="playerTerritoryColorInput" value="${playerSettings.territoryColor}"
                       class="w-10 h-7 rounded-md cursor-pointer p-0.5">
            </div>

            <div class="territory-section-divider">Preview</div>
            <div class="flex items-center justify-center gap-4 py-1">
                <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                    <svg id="playerPreviewDefault" xmlns="http://www.w3.org/2000/svg" width="${playerSettings.markerSize}" height="${Math.round(playerSettings.markerSize*40/28)}" viewBox="0 0 24 36">
                        <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${playerSettings.defaultColor}"/>
                        <circle cx="12" cy="11" r="4.5" fill="white"/>
                    </svg>
                    <span style="font-size:10px;color:var(--color-gray-500,#6b7280);">Outside</span>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                    <svg id="playerPreviewTerritory" xmlns="http://www.w3.org/2000/svg" width="${playerSettings.markerSize}" height="${Math.round(playerSettings.markerSize*40/28)}" viewBox="0 0 24 36">
                        <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${playerSettings.territoryColor}"/>
                        <circle cx="12" cy="11" r="4.5" fill="white"/>
                    </svg>
                    <span style="font-size:10px;color:var(--color-gray-500,#6b7280);">In Territory</span>
                </div>
            </div>
        `;

        toggle.addEventListener('click', () => {
            content.classList.toggle('collapsed');
            toggle.querySelector('.toggle-arrow').classList.toggle('collapsed');
        });

        wrapper.append(toggle, content);

        const wireEvents = () => {
            const update = () => {
                const size = parseInt(document.getElementById('playerSizeSelect')?.value);
                const labelSize = parseInt(document.getElementById('playerLabelSizeSelect')?.value);
                const defaultColor = document.getElementById('playerDefaultColorInput')?.value;
                const territoryColor = document.getElementById('playerTerritoryColorInput')?.value;

                playerSettings.markerSize = size;
                playerSettings.labelFontSize = labelSize;
                playerSettings.defaultColor = defaultColor;
                playerSettings.territoryColor = territoryColor;

                // Update preview
                const h = Math.round(size * 40 / 28);
                const prevDef = document.getElementById('playerPreviewDefault');
                const prevTer = document.getElementById('playerPreviewTerritory');
                if (prevDef) {
                    prevDef.setAttribute('width', size);
                    prevDef.setAttribute('height', h);
                    prevDef.querySelector('path').setAttribute('fill', defaultColor);
                }
                if (prevTer) {
                    prevTer.setAttribute('width', size);
                    prevTer.setAttribute('height', h);
                    prevTer.querySelector('path').setAttribute('fill', territoryColor);
                }

                savePlayerSettings();
                refreshMarkerSizes();
                refreshMarkerColors();
            };

            ['playerSizeSelect', 'playerLabelSizeSelect'].forEach(id => {
                document.getElementById(id)?.addEventListener('change', update);
            });
            ['playerDefaultColorInput', 'playerTerritoryColorInput'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', update);
            });
        };

        setTimeout(wireEvents, 0);
        return wrapper;
    }

    function togglePlayers() {
        if (playersVisible) {
            // Turn off — remove all marker elements
            playersVisible = false;
            playerMarkerData.forEach(m => m.element.remove());
            playerMarkerData = [];
            updatePlayersToggleButton();
            updatePlayersOptionsVisibility();
            updateXPTrackerMapButtons();
            drawTerritories(); // refresh territory colors (remove red highlights)
            console.log('[Guild Players] Player markers hidden');
            return;
        }

        // Turn on — build markers from current guild members
        const toggleBtn = document.getElementById('playersToggleBtn');
        if (toggleBtn) {
            toggleBtn.disabled = true;
            toggleBtn.innerHTML = '⏳ Loading...';
        }

        const data = buildPlayerMarkerData();

        if (data.length === 0) {
            if (toggleBtn) {
                toggleBtn.disabled = false;
                toggleBtn.innerHTML = '👥 Show Players';
                toggleBtn.className = 'territory-toggle-btn inactive';
            }
            alert('No guild members with coordinates found. Make sure the guild Info tab has loaded.');
            return;
        }

        // If territory data is available, compute in-territory flag for each marker
        // If territoryRects hasn't been built yet, try building it now
        const enrichData = async () => {
            if (territoryRects.length === 0) {
                // Try to build territory rects (non-blocking, best-effort)
                try {
                    if (typeof userGuildData !== 'undefined' && userGuildData && typeof fetchGuildProjects === 'function') {
                        await fetchGuildProjects();
                    }
                    territoryRects = await buildTerritoryRects();
                } catch (e) {
                    console.warn('[Guild Players] Could not build territory rects for coloring:', e);
                }
            }

            // Mark each marker with territory membership
            for (const m of data) {
                m.inTerritory = isInsideTerritory(m.gridX, m.gridY);
            }

            createPlayersContainer();

            // Create DOM marker elements
            playerMarkerData = data.map(m => {
                const el = createMarkerElement(m);
                playersContainer.appendChild(el);
                return { ...m, element: el };
            });

            playersVisible = true;
            updatePlayerPositions();
            updatePlayersToggleButton();
            updatePlayersOptionsVisibility();
            updateXPTrackerMapButtons();
            drawTerritories(); // refresh territory colors (show red for unoccupied)

            const inTerritoryCount = data.filter(m => m.inTerritory).length;
            console.log(`[Guild Players] Showing ${playerMarkerData.length} player markers (${inTerritoryCount} in territory)`);

            if (toggleBtn) toggleBtn.disabled = false;
        };

        enrichData();
    }

    /**
     * Update the player toggle button appearance based on state.
     */
    function updatePlayersToggleButton() {
        const toggleBtn = document.getElementById('playersToggleBtn');
        if (!toggleBtn) return;

        if (playersVisible) {
            toggleBtn.innerHTML = '👥 Hide Players';
            toggleBtn.className = 'territory-toggle-btn active';
        } else {
            toggleBtn.innerHTML = '👥 Show Players';
            toggleBtn.className = 'territory-toggle-btn inactive';
        }
    }

    /**
     * Show/hide the player marker options row based on visibility.
     */
    function updatePlayersOptionsVisibility() {
        const optionsRow = document.getElementById('playersOptionsRow');
        if (optionsRow) {
            optionsRow.style.display = playersVisible ? 'flex' : 'none';
        }
    }

    // =====================================================
    // === MODAL TRANSFORMATION (inherited from v2.0) ===
    // =====================================================

    function setupContentTracking() {
        const infoTab = document.getElementById('infoTab');
        if (!infoTab) return;

        const membersContainer = document.getElementById('guildMembersContainer');
        if (membersContainer) {
            const observer = new MutationObserver(() => {
                ensureXPChangesSection();
                const members = parseGuildMembers();
                if (members && Object.keys(members).length > 0) {
                    saveGuildSnapshot(members);
                }
            });
            observer.observe(membersContainer, { childList: true, subtree: true });
        }

        ensureXPChangesSection();

        // Watch for the projects tab being shown so we can inject territory controls + number badges
        const projectsTab = document.getElementById('projectsTab');
        if (projectsTab) {
            const projectsObserver = new MutationObserver(() => {
                injectTerritoryControls();
                numberProjectCards();
            });
            projectsObserver.observe(projectsTab, { childList: true, subtree: true, attributes: true });
        }

        // Also watch the projects container specifically for re-renders
        const projectsContainer = document.getElementById('guildProjectsContainer');
        if (projectsContainer) {
            const containerObserver = new MutationObserver(() => {
                numberProjectCards();
            });
            containerObserver.observe(projectsContainer, { childList: true, subtree: true });
        }

        // Also hook into the projects tab button click
        const projectsTabBtn = document.getElementById('projectsTabBtn');
        if (projectsTabBtn) {
            const originalOnClick = projectsTabBtn.onclick;
            projectsTabBtn.addEventListener('click', () => {
                // Small delay to ensure tab content is visible
                setTimeout(() => {
                    injectTerritoryControls();
                    numberProjectCards();
                }, 50);
            });
        }
    }

    function setupMessageCollapsible() {
        const msgElement = document.getElementById('guildInfoMessage');
        if (!msgElement) return;

        const parent = msgElement.closest('div');
        if (!parent || parent.classList.contains('guild-message-section')) return;

        const section = document.createElement('div');
        section.className = 'guild-message-section';

        const header = document.createElement('div');
        header.className = 'guild-message-header';
        header.innerHTML = `<span>Guild Message</span><span class="guild-message-toggle">▼</span>`;

        const content = document.createElement('div');
        content.className = 'guild-message-content';

        parent.parentNode.insertBefore(section, parent);
        content.appendChild(parent);
        section.appendChild(header);
        section.appendChild(content);

        header.onclick = () => {
            content.classList.toggle('collapsed');
            header.querySelector('.guild-message-toggle').classList.toggle('collapsed');
            const infoTab = document.getElementById('infoTab');
            if (infoTab) infoTab.classList.toggle('message-collapsed', content.classList.contains('collapsed'));
        };
    }

    /**
     * Adds a slim loading progress bar below the header bar that tracks
     * guild data readiness: members loaded, XP section ready, projects available.
     * Auto-hides with a fade once all milestones are met.
     */
    function setupGuildLoadingBar(panel, headerBar) {
        if (document.getElementById('guild-loading-bar-container')) return;

        const container = document.createElement('div');
        container.id = 'guild-loading-bar-container';
        container.style.cssText = `
            position: absolute; top: 40px; left: 0; right: 0; height: 3px;
            background: rgba(0,0,0,0.1); z-index: 52; overflow: hidden;
            transition: opacity 0.5s ease; cursor: pointer;
        `;

        const bar = document.createElement('div');
        bar.id = 'guild-loading-bar';
        bar.style.cssText = `
            height: 100%; width: 0%; background: linear-gradient(90deg, #60a5fa, #3b82f6);
            transition: width 0.4s ease; border-radius: 0 2px 2px 0;
            pointer-events: none;
        `;
        container.appendChild(bar);

        // Hover tooltip
        const tooltip = document.createElement('div');
        tooltip.id = 'guild-loading-tooltip';
        tooltip.style.cssText = `
            position: fixed; display: none; padding: 6px 10px;
            background: ${isDarkMode() ? '#1e1e2e' : '#1f2937'}; color: #f3f4f6;
            font-size: 11px; line-height: 1.5; border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3); pointer-events: none;
            z-index: 100000; white-space: nowrap;
        `;
        document.body.appendChild(tooltip);

        container.addEventListener('mouseenter', () => { tooltip.style.display = 'block'; updateTooltip(); });
        container.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
        container.addEventListener('mousemove', (e) => {
            tooltip.style.left = (e.clientX + 12) + 'px';
            tooltip.style.top = (e.clientY + 12) + 'px';
        });

        // Insert right after the header bar
        headerBar.insertAdjacentElement('afterend', container);

        // Milestones: each worth a portion of the bar
        const milestones = {
            modal:    { done: true,  weight: 10, label: 'Modal ready' },
            stats:    { done: false, weight: 20, label: 'Guild stats' },
            members:  { done: false, weight: 40, label: 'Members list' },
            xpTracker:{ done: false, weight: 30, label: 'XP Tracker' },
        };

        function updateTooltip() {
            const lines = Object.values(milestones).map(m =>
                (m.done ? '✅' : '⏳') + ' ' + m.label
            );
            tooltip.innerHTML = lines.join('<br>');
        }

        function updateProgress() {
            let progress = 0;
            let total = 0;
            const pending = [];
            for (const [key, m] of Object.entries(milestones)) {
                total += m.weight;
                if (m.done) progress += m.weight;
                else pending.push(key);
            }
            const pct = Math.round((progress / total) * 100);
            bar.style.width = pct + '%';

            if (pending.length === 0) {
                bar.style.width = '100%';
                updateTooltip();
                setTimeout(() => {
                    container.style.opacity = '0';
                    setTimeout(() => {
                        container.remove();
                        tooltip.remove();
                    }, 600);
                }, 800);
            }
            updateTooltip();
        }

        function markDone(key) {
            if (milestones[key] && !milestones[key].done) {
                milestones[key].done = true;
                updateProgress();
            }
        }

        // Check milestones periodically
        function poll() {
            // Stats: guild XP / pixels text is populated
            const xpEl = document.getElementById('guildInfoExperience');
            if (xpEl && xpEl.textContent.trim().length > 0) markDone('stats');

            // Members: guildMembersContainer has member rows
            const membersEl = document.getElementById('guildMembersContainer');
            if (membersEl && membersEl.querySelectorAll('div.flex.items-center.justify-between').length > 0) {
                markDone('members');
            }

            // XP Tracker: our injected tab button or legacy section exists
            if (document.getElementById('xpTrackerTabBtn') || document.getElementById('xpChangesSection')) markDone('xpTracker');

            // Keep polling until all done
            const allDone = Object.values(milestones).every(m => m.done);
            if (!allDone) setTimeout(poll, 300);
        }

        updateProgress();
        setTimeout(poll, 200);
    }

    async function transformGuildModal() {
        try {
            await waitForElement('#myGuildModal', 10000);

            const modal = document.getElementById('myGuildModal');
            const panel = document.getElementById('myGuildPanel');

            if (!modal || !panel) {
                console.error('[Guild Modal] myGuildModal or myGuildPanel not found');
                return;
            }

            if (panel.classList.contains('draggable-panel')) return;

            modal.style.position = 'fixed';
            modal.style.inset = 'auto';
            modal.style.backgroundColor = 'transparent';
            modal.style.justifyContent = 'flex-start';
            modal.style.alignItems = 'flex-start';
            modal.style.padding = '0';
            modal.style.pointerEvents = 'none';

            panel.style.position = 'fixed';
            panel.style.cursor = 'default';
            panel.style.transform = 'none';
            panel.style.opacity = '1';
            panel.style.scale = '1';
            panel.style.pointerEvents = 'auto';
            panel.classList.add('draggable-panel');

            panel.style.top = '100px';
            panel.style.left = 'calc(50% - 25rem)';
            panel.style.width = '50rem';
            panel.style.maxWidth = '90vw';
            panel.style.maxHeight = '85vh';
            panel.style.overflowY = '';

            const existingHeader = panel.querySelector('.guild-modal-header');
            if (existingHeader) existingHeader.remove();

            const headerBar = document.createElement('div');
            headerBar.className = 'guild-modal-header';
            headerBar.style.cssText = `
                position: absolute; top: 0; left: 0; right: 0; height: 40px;
                background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                cursor: move; border-radius: 0.75rem 0.75rem 0 0;
                display: flex; align-items: center; justify-content: space-between;
                padding: 0 16px; color: white; font-weight: 600;
                user-select: none; z-index: 50; pointer-events: auto;
            `;
            
            const titleSpan = document.createElement('span');
            titleSpan.textContent = 'Guild Panel';
            titleSpan.style.cursor = 'move';
            
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = `
                background: none; border: none; color: white; font-size: 24px;
                cursor: pointer; padding: 0; margin: 0;
                display: flex; align-items: center; justify-content: center;
                width: 30px; height: 30px; border-radius: 4px; transition: background-color 0.2s;
            `;
            closeBtn.onmouseover = () => closeBtn.style.backgroundColor = 'rgba(255,255,255,0.2)';
            closeBtn.onmouseout = () => closeBtn.style.backgroundColor = 'transparent';
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                if (typeof window.toggleMyGuildModal === 'function') {
                    window.toggleMyGuildModal();
                } else {
                    const originalClose = document.querySelector('#myGuildModal .close-modal, #myGuildModal [onclick*="toggleMyGuildModal"]');
                    if (originalClose) originalClose.click();
                    else modal.style.display = 'none';
                }
            };
            
            headerBar.appendChild(titleSpan);
            headerBar.appendChild(closeBtn);

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'guild-modal-resize';
            resizeHandle.style.cssText = `
                position: absolute; bottom: 0; right: 0; width: 20px; height: 20px;
                cursor: nwse-resize;
                background: linear-gradient(135deg, transparent 0%, #3b82f6 100%);
                border-radius: 0 0 0.75rem 0; z-index: 51; pointer-events: auto;
            `;

            panel.style.paddingTop = '50px';
            if (panel.firstChild) panel.insertBefore(headerBar, panel.firstChild);
            else panel.appendChild(headerBar);

            panel.appendChild(resizeHandle);
            setupDragHandling(panel, titleSpan);
            setupResizeHandling(panel, resizeHandle);
            setupMessageCollapsible();
            setupContentTracking();

            // --- Loading progress bar ---
            setupGuildLoadingBar(panel, headerBar);

            // Inject territory controls and number badges when projects tab is available
            setTimeout(() => {
                injectTerritoryControls();
                numberProjectCards();
            }, 200);

            // Reset panel to center every time the modal is opened (fixes off-screen lock after dragging outside window)
            const _centerPanel = () => {
                panel.style.top = '100px';
                panel.style.left = 'calc(50% - 25rem)';
            };
            const _visibilityObserver = new MutationObserver(() => {
                if (!modal.classList.contains('hidden')) _centerPanel();
            });
            _visibilityObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });

            console.log('[Guild Modal] v3.1 - Transformed to draggable floating panel with territories');

        } catch (error) {
            console.error('[Guild Modal] Error transforming modal:', error);
        }
    }

    function setupDragHandling(panel, header) {
        let isDragging = false;
        let startX = 0, startY = 0, offsetX = 0, offsetY = 0;

        const onMouseDown = (e) => {
            if (e.target.closest('.guild-modal-resize') || e.target.closest('button')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            offsetX = rect.left;
            offsetY = rect.top;
            panel.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove, true);
            document.addEventListener('mouseup', onMouseUp, true);
            e.preventDefault();
            e.stopPropagation();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            panel.style.left = (offsetX + deltaX) + 'px';
            panel.style.top = (offsetY + deltaY) + 'px';
        };

        const onMouseUp = () => {
            isDragging = false;
            panel.style.userSelect = 'auto';
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);
        };

        header.addEventListener('mousedown', onMouseDown, true);
        
        // Also make the header bar itself draggable
        const headerBar = panel.querySelector('.guild-modal-header');
        if (headerBar && headerBar !== header) {
            headerBar.addEventListener('mousedown', onMouseDown, true);
        }
    }

    function setupResizeHandling(panel, handle) {
        let isResizing = false;
        let startX = 0, startY = 0, startW = 0, startH = 0;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startW = rect.width;
            startH = rect.height;
            panel.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove, true);
            document.addEventListener('mouseup', onMouseUp, true);
            e.preventDefault();
            e.stopPropagation();
        });

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const newW = Math.max(300, startW + (e.clientX - startX));
            const newH = Math.max(200, startH + (e.clientY - startY));
            panel.style.width = newW + 'px';
            panel.style.maxHeight = newH + 'px';
        };

        const onMouseUp = () => {
            isResizing = false;
            panel.style.userSelect = 'auto';
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);
        };
    }

    function updateSnapshotIntervalUI() {
        const dropdown = document.getElementById('snapshotIntervalSelect');
        if (dropdown) {
            updateSnapshotIntervalDropdown(dropdown);
        }
    }

    // --- Menu Commands ---
    // Commented out to keep the Tampermonkey menu clean.
    // Uncomment any block below to re-expose it in the menu.
    // All underlying functionality remains intact and accessible via the in-page UI.
    
    /*
    GM_registerMenuCommand("Snapshot Interval: Hourly", () => {
        CONFIG.minSnapshotInterval = SNAPSHOT_INTERVALS.HOURLY;
        GM_setValue('min_snapshot_interval', CONFIG.minSnapshotInterval);
        updateSnapshotIntervalUI();
        alert(`Snapshot Interval set to: Hourly (1 hour)`);
    });

    GM_registerMenuCommand("Snapshot Interval: 12 Hours", () => {
        CONFIG.minSnapshotInterval = SNAPSHOT_INTERVALS.TWELVE_HOURS;
        GM_setValue('min_snapshot_interval', CONFIG.minSnapshotInterval);
        updateSnapshotIntervalUI();
        alert(`Snapshot Interval set to: 12 Hours`);
    });

    GM_registerMenuCommand("Snapshot Interval: 24 Hours", () => {
        CONFIG.minSnapshotInterval = SNAPSHOT_INTERVALS.TWENTY_FOUR_HOURS;
        GM_setValue('min_snapshot_interval', CONFIG.minSnapshotInterval);
        updateSnapshotIntervalUI();
        alert(`Snapshot Interval set to: 24 Hours`);
    });

    GM_registerMenuCommand("Snapshot Interval: Custom", () => {
        const userInput = prompt("Enter custom snapshot interval in minutes:", (CONFIG.minSnapshotInterval / (60 * 1000)).toString());
        if (userInput !== null && userInput.trim() !== '') {
            const minutes = parseFloat(userInput);
            if (!isNaN(minutes) && minutes > 0) {
                CONFIG.minSnapshotInterval = minutes * 60 * 1000;
                GM_setValue('min_snapshot_interval', CONFIG.minSnapshotInterval);
                updateSnapshotIntervalUI();
                alert(`Snapshot Interval set to: ${minutes} minute(s)`);
            } else {
                alert("Invalid input. Please enter a positive number.");
            }
        }
    });

    GM_registerMenuCommand("Toggle Debug Mode", () => {
        CONFIG.debugMode = !CONFIG.debugMode;
        alert(`Debug Mode: ${CONFIG.debugMode ? 'ON' : 'OFF'}`);
    });

    GM_registerMenuCommand("Time Travel: Advance 1 Day", () => {
        CONFIG.timeOffset += 24 * 60 * 60 * 1000;
        GM_setValue('debug_time_offset', CONFIG.timeOffset);
        const virtualDate = new Date(getVirtualNow());
        alert(`Time Travel Active! Virtual Date: ${virtualDate.toDateString()}\nReload the page to apply.`);
    });

    GM_registerMenuCommand("Time Travel: Reset", () => {
        CONFIG.timeOffset = 0;
        GM_setValue('debug_time_offset', 0);
        alert(`Time Travel Reset. Back to reality.`);
    });

    GM_registerMenuCommand("Reset Guild XP History", () => {
        if (confirm("Are you sure you want to clear all stored Guild XP history? This cannot be undone.")) {
            GM_setValue('guild_xp_history', []);
            alert("Guild XP history has been reset.");
        }
    });

    GM_registerMenuCommand("Toggle Territory Overlay", () => {
        toggleTerritories();
    });

    GM_registerMenuCommand("Toggle Player Markers", () => {
        togglePlayers();
    });

    GM_registerMenuCommand("Territory Settings", () => {
        // Open the guild modal projects tab where settings live
        if (typeof window.toggleMyGuildModal === 'function') {
            const modal = document.getElementById('myGuildModal');
            if (modal && modal.classList.contains('hidden')) window.toggleMyGuildModal();
            if (typeof window.switchGuildTab === 'function') window.switchGuildTab('projects');
            setTimeout(() => {
                const collapsible = document.getElementById('territorySettingsCollapsible');
                if (collapsible) {
                    const content = collapsible.querySelector('.territory-settings-content');
                    const arrow = collapsible.querySelector('.toggle-arrow');
                    if (content && content.classList.contains('collapsed')) {
                        content.classList.remove('collapsed');
                        if (arrow) arrow.classList.remove('collapsed');
                    }
                }
            }, 200);
        }
    });
    */

    // --- Initialization ---

    function init() {
        transformGuildModal();
        hookTerritoryToMap();
        hookPlayersToMap();

        const bodyObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.id === 'myGuildModal' || node.querySelector('#myGuildModal')) {
                            console.log('[Guild Modal] Modal detected, re-initializing...');
                            transformGuildModal();
                        }
                    }
                }
            }
        });

        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('[Guild Modal] v3.4.0 - Loaded with territory map overlay, player markers, territory-aware XP tracker, and activity-aware territory coloring');

            })();
            _featureStatus.guildOverhaul = 'ok';
            console.log('[GeoPixelcons++] ✅ Guild Overhaul loaded');
        } catch (err) {
            _featureStatus.guildOverhaul = 'error';
            dbgPush(`Guild Overhaul init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Guild Overhaul' });
            console.error('[GeoPixelcons++] ❌ Guild Overhaul failed:', err);
        }
    }