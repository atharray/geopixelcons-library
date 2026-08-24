import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const artifact = readFileSync(new URL('../dist/geopixelcons-library.js', import.meta.url), 'utf8');
const legacyCoreSource = readFileSync(new URL('../src/legacy/core.js', import.meta.url), 'utf8');
const paintMenuControlsSource = readFileSync(new URL('../src/legacy/features/hide-paint-menu.js', import.meta.url), 'utf8');
const controlsScaleSource = readFileSync(new URL('../src/legacy/features/controls-scale.js', import.meta.url), 'utf8');
const paintingMenuOverhaulSource = readFileSync(new URL('../src/legacy/features/mobile-painting.js', import.meta.url), 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('loads as a side-effect-free factory before the main userscript', () => {
    const sandbox = { Object, Error };
    vm.createContext(sandbox);
    assert.doesNotThrow(() => vm.runInContext(artifact, sandbox, { filename: 'geopixelcons-library.js' }));
    assert.equal(sandbox.GeoPixelconsLibrary.version, version);
    assert.equal(typeof sandbox.GeoPixelconsLibrary.boot, 'function');
});

test('publishes the library bridge when @require wraps the source', () => {
    const sandbox = { Object, Error };
    vm.createContext(sandbox);
    const wrappedRequire = `(function(){\n${artifact}\n})();`;
    assert.doesNotThrow(() => vm.runInContext(wrappedRequire, sandbox, { filename: 'tampermonkey-require.js' }));
    assert.equal(sandbox.GeoPixelconsLibrary.version, version);
    assert.equal(typeof sandbox.GeoPixelconsLibrary.boot, 'function');
});

test('keeps the legacy application behind the boot boundary', () => {
    assert.match(artifact, /function boot\(\)/);
    assert.match(artifact, /FEATURE: Ghost Template Manager/);
    assert.match(artifact, /const VERSION = '2\.10\.0';/);
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const versionPattern = new RegExp(`const LIBRARY_VERSION = '${escapedVersion}'; // x-release-please-version`);
    assert.match(artifact, versionPattern);
});

test('organizes settings into the requested visual extension categories', () => {
    assert.match(artifact, /const EXTENSION_CATEGORIES = \[/);
    assert.match(artifact, /name: 'Painting', keys: \['paintBrushSwap', 'hidePaintMenu', 'mobilePaintingExtension', 'bulkPurchaseColors'\]/);
    assert.match(artifact, /name: 'Ghost Template', keys: \['ghostPlusPlus', 'showSyncGhostBtn'\]/);
    assert.match(artifact, /name: 'Map', keys: \['mapMarkers', 'extMapMovementLock', 'regionScreenshot', 'regionsHighscore', 'themeEditor', 'extJanitorView', 'extBlockedUsers'\]/);
    assert.match(artifact, /name: 'Menuing', keys: \['guildOverhaul', 'extGuildSearch', 'profileColorsCollapse', 'extAutoHoverMenus', 'extPillHoverLabels', 'extLogOutButton'\]/);
    assert.match(artifact, /name: 'Misc', keys: \['extGoToLastLocation'\]/);
    assert.match(artifact, /name: 'Deprecated', keys: \['ghostPaletteSearch', 'ghostTemplateManager'\]/);
    assert.match(artifact, /const tabs = \['Extensions', 'Keybindings'\]/);
    assert.match(artifact, /name: 'Paint Brush Overhaul'/);
    assert.match(artifact, /name: 'Ghost\+\+'/);
    assert.match(artifact, /name: 'Painting Menu Overhaul', icon: '🎨'/);
    assert.match(artifact, /name: 'Ghost Palette Color Search', icon: '🔍', deprecated: true, ghostPlusPlusGray: true/);
    assert.match(artifact, /name: 'Ghost Template Manager', icon: '👻', deprecated: true, ghostPlusPlusGray: true/);
    assert.match(artifact, /const deprecatedSection = extensionCategoryPanels\.get\('Deprecated'\)/);
    assert.match(artifact, /modernBtnsLabel\.innerHTML = '<span>🎛️<\/span><span>Ghost Menu UI Overhaul<\/span>'/);
    assert.match(artifact, /ghostPosLabel\.innerHTML = '<span>📌<\/span><span>Remember ghost template position and size<\/span>'/);
    assert.match(artifact, /miscSettingsSection\.appendChild\(emojiRow\)/);
    assert.match(artifact, /movementRow\.insertAdjacentElement\('afterend', smoothZoomRow\)/);
    assert.match(artifact, /deprecatedSection\.appendChild\(modernBtnsRow\)/);
    assert.match(artifact, /deprecatedSection\.appendChild\(ghostPosRow\)/);
    assert.match(artifact, /ghostPlusPlusDependentRows\.add\(ghostPosRow\)/);
    assert.match(artifact, /function styleStandaloneExtensionRow\(row\)/);
    assert.match(artifact, /styleStandaloneExtensionRow\);/);
});

test('includes the profile color list collapse feature', () => {
    assert.match(artifact, /FEATURE: Profile Color List Collapse/);
    assert.match(artifact, /userColorsContainer/);
    assert.match(artifact, /MAX_VISIBLE_COLORS = 100/);
    assert.match(artifact, /Show All/);
    assert.match(artifact, /Show Less/);
    assert.match(artifact, /bodyObserver\.disconnect\(\)/);
});
test('includes the opt-in native guild territory auto-loader', () => {
    assert.match(artifact, /territorySettingsCollapsible/);
    assert.match(artifact, /territoryAutoLoadCheck/);
    assert.match(artifact, /autoLoadTerritories: false/);
    assert.match(artifact, /fetchUserGuild/);
    assert.match(artifact, /fetchGuildProjects/);
    assert.match(artifact, /loadGuildProjectsInPageRealm/);
});
test('defaults Compact Paint Controls on for new installs', () => {
    assert.match(artifact, /compactPaintOverflow: true/);
});
test('keeps Painting Menu Overhaul responsive and exposes selected-colour scan feedback', () => {
    assert.doesNotMatch(artifact, /function applyFullWidthBottomControls\(/);
    assert.doesNotMatch(artifact, /style\.width = '100vw'/);
    assert.match(artifact, /rootStyle\.colorScheme/);
    assert.match(artifact, /scanSummaryRef/);
    assert.match(artifact, /gppRequestUiRefresh/);
    assert.match(artifact, /Highlight nearest/);
    assert.match(artifact, /gppScanFindNearestError/);
    assert.match(artifact, /gppScanStartSelectedColorGlow/);
    assert.match(artifact, /gppScanClearSelectedColorGlow/);
    assert.match(artifact, /pendingHighlightPaletteIndex/);
    assert.match(artifact, /requestStillCurrent/);
    assert.match(artifact, /retintBorrowedScanButtons/);
    assert.match(artifact, /justify-content: center/);
    assert.match(artifact, /Painting Menu Overhaul/);
    assert.doesNotMatch(paintingMenuOverhaulSource, /root\.style\.width\s*=/);
    assert.doesNotMatch(artifact, /root\.style\.transform\s*=/);
    assert.doesNotMatch(artifact, /function buildMobileUiScaleControl\(/);
    assert.match(artifact, /gpc-ctrl-menu-count/);
    assert.match(artifact, /Minimum pixel count/);
    assert.match(artifact, /countMinInput\.dispatchEvent\(new Event\('input'/);
    assert.match(artifact, /gpc-hide-paint-toggle/);
    assert.match(artifact, /controlsRowEl\.style\.marginBottom/);
    assert.match(artifact, /-rowGap \+ 4/);
    assert.match(paintingMenuOverhaulSource, /gpc-pmo-palette-grid/);
    assert.doesNotMatch(paintingMenuOverhaulSource, /gpc-mobile-/);
});

test('makes scale a Paint Menu Controls capability independent of Painting Menu Overhaul', () => {
    assert.match(artifact, /gpc-pmc-scale-tab/);
    assert.match(artifact, /geo\+\+_paint_menu_controls_ui_scale/);
    assert.match(paintMenuControlsSource, /let gpcPaintMenuControlsScale = null/);
    assert.match(paintMenuControlsSource, /createPaintMenuControlsScale/);
    assert.match(paintMenuControlsSource, /gpc-pmc-scale-content/);
    assert.match(paintMenuControlsSource, /gpc-pmc-scale-tab/);
    assert.match(paintMenuControlsSource, /gpc-pmc-scale-popover/);
    assert.match(paintMenuControlsSource, /geo\+\+_paint_menu_controls_ui_scale/);
    assert.match(paintMenuControlsSource, /geo\+\+_painting_menu_overhaul_ui_scale/);
    assert.match(paintMenuControlsSource, /geo\+\+_mobile_painting_ui_scale/);
    assert.match(paintMenuControlsSource, /addEventListener\('input', updateReadout\)/);
    assert.match(paintMenuControlsSource, /addEventListener\('change', commit\)/);
    assert.doesNotMatch(paintMenuControlsSource, /addEventListener\('pointerup', commit\)/);
    assert.match(paintMenuControlsSource, /pendingCommitFrame/);
    assert.match(paintMenuControlsSource, /inverseWidthPercent/);
    assert.match(paintMenuControlsSource, /lockNativeWidth/);
    assert.match(paintMenuControlsSource, /releaseNativeWidth/);
    assert.match(paintMenuControlsSource, /requestViewportReflow/);
    assert.match(paintMenuControlsSource, /window\.addEventListener\('resize', requestViewportReflow/);
    assert.match(paintMenuControlsSource, /root\.style\.height/);
    assert.match(paintMenuControlsSource, /gpc-paint-flip-pos/);
    assert.match(paintMenuControlsSource, /making the scale tab a Paint Menu Controls capability/);
    assert.doesNotMatch(paintingMenuOverhaulSource, /gpc-pmc-scale-tab/);
});
test('keeps native controls scale independent and places its setting below Map Markers', () => {
    assert.match(artifact, /gpc-controls-scale-popover/);
    assert.match(artifact, /controlsUiScale: 100/);
    assert.match(controlsScaleSource, /document\.getElementById\('controls-left'\)/);
    assert.match(controlsScaleSource, /document\.getElementById\('controls-right'\)/);
    assert.match(controlsScaleSource, /element\.style\.scale = String\(percent \/ 100\)/);
    assert.match(controlsScaleSource, /top left/);
    assert.match(controlsScaleSource, /top right/);
    assert.match(controlsScaleSource, /addEventListener\('change'/);
    assert.doesNotMatch(controlsScaleSource, /addEventListener\('pointerup'/);
    const mapMarkersEntry = legacyCoreSource.lastIndexOf("dropdown.appendChild(makeSubBtn('📌', 'Map Markers'");
    const scaleEntry = legacyCoreSource.lastIndexOf("dropdown.appendChild(makeSubBtn('↔️', 'Controls scale'");
    const settingsEntry = legacyCoreSource.lastIndexOf("dropdown.appendChild(makeSubBtn('⚙️', 'Settings...'");
    assert.ok(mapMarkersEntry !== -1 && mapMarkersEntry < scaleEntry && scaleEntry < settingsEntry);
});
test('keeps compact Ghost++ palette state and size separate from the full menu', () => {
    assert.match(artifact, /compactPaletteViewMode: 'grid'/);
    assert.match(artifact, /compactWidth: 260/);
    assert.match(artifact, /compactHeight: 160/);
    assert.match(artifact, /gppSettings\.compactPaletteViewMode/);
    assert.match(artifact, /--gpp-compact-width/);
    assert.match(artifact, /--gpp-compact-height/);
    assert.match(artifact, /function gppPersistCompactSize\(modal\)/);
});
test('includes a confirmation gate for large bulk purchases', () => {
    assert.match(artifact, /BULK_PURCHASE_WARNING_THRESHOLD = 50/);
    assert.match(artifact, /gp-bulk-warning-overlay/);
    assert.match(artifact, /gp-bulk-warning-summary/);
    assert.match(artifact, /toBuyCount > BULK_PURCHASE_WARNING_THRESHOLD/);
    assert.match(artifact, /You are about to buy/);
    assert.match(artifact, /⚠️ WARNING ⚠️/);
    assert.match(artifact, />Continue\?</);
    assert.match(artifact, /Continue \(buy all\)/);
    assert.match(artifact, /gp-bulk-warning-continue/);
    assert.match(artifact, /function onBulkConfirm\(\)[\s\S]*?openBulkWarning\(toBuyCount/);
    assert.match(artifact, /function openBulkModal\(colors\)[\s\S]*?renderBulkPreview\(nextColors\)/);
    assert.match(artifact, /function continueBulkWarning\(\)[\s\S]*?executeConfirmedBulkPurchase/);
});

test('tracks snapshot-observed guild activity and marks inactive players yellow', () => {
    assert.match(artifact, /GUILD_ACTIVITY_STORAGE_KEY = 'guild_xp_last_activity_v1'/);
    assert.match(artifact, /function recordGuildActivity\(previousMembers, currentMembers, observedAt\)/);
    assert.match(artifact, /function recordCurrentGuildActivity\(history, currentMembers, observedAt = getVirtualNow\(\)\)/);
    assert.match(artifact, /recordCurrentGuildActivity\(history, currentMembers\)/);
    assert.match(artifact, /currentXp <= getXp\(previousMembers\[memberId\]\)/);
    assert.match(artifact, /observedXp: currentXp/);
    assert.match(artifact, /function rebuildGuildActivityHistory\(history\)/);
    assert.match(artifact, /function formatLastSeenLabel\(timestamp\)/);
    assert.match(artifact, /<th>Last Seen<\/th>/);
    assert.match(artifact, /inactiveAfterDays: 7/);
    assert.match(artifact, /inactiveColor: '#eab308'/);
    assert.match(artifact, /Inactivity takes priority over the existing blue\/red territory colors/);
    assert.match(artifact, /Unknown means there is no evidence of recent activity/);
    assert.match(artifact, /Unknown members belong in Inactive/);
    assert.match(artifact, /c\.type === 'left' \|\| !lastSeenAt \|\| isMemberInactive\(lastSeenAt\) \|\| c\.diff <= 0/);
    assert.match(artifact, /isMemberInactive\(lastSeenAt\)/);
});

test('filters canvas tiles through the blocked user list at the layer boundary', () => {
    assert.match(artifact, /EXTENSION: Blocked User List \[extBlockedUsers\]/);
    assert.match(artifact, /if \(_settings\.extBlockedUsers\)/);
    assert.match(artifact, /name: 'Blocked User List', icon: '🚷'/);

    // The whole feature depends on hooking the single texture-upload choke
    // point rather than the render loop, so that tileImageCache stays
    // untouched ground truth for Ghost++ and the native pixel inspector.
    assert.match(artifact, /pixelTileLayer\.setTile = function \(tileKey, source, corners\)/);
    assert.match(artifact, /__gpcBlockedUsersOriginal/);

    // Attribution decode must key on alpha, never on the id value: user id 0
    // is a real account, which is why index.js itself tests a > 0.
    assert.match(artifact, /if \(d\[i \+ 3\] === 0\) continue;/);
    assert.match(artifact, /\(d\[i\] << 16\) \| \(d\[i \+ 1\] << 8\) \| d\[i \+ 2\]/);

    // Per-tile id index keyed on bitmap identity, not tile key -- index.js
    // rebuilds cache entries with a spread that would carry a stale index.
    assert.match(artifact, /if \(!idx \|\| idx\.bmp !== ub\)/);

    assert.match(artifact, /state\.mode === 'highlight'/);
    assert.match(artifact, /window\.__gpcBlockedUsers = \{/);
    assert.match(artifact, /\/GetUserProfile/);

    // Entry points: GeoPixelcons++ dropdown, and a queue button seated next to
    // the native Report flag inside the pixel info panel.
    assert.match(artifact, /makeSubBtn\('🚷', 'Blocked Users'/);
    assert.match(artifact, /let _blockedUsers = null;/);
    assert.match(artifact, /_blockedUsers = \{ openModal \};/);
    assert.match(artifact, /report\.parentElement\.insertBefore\(btn, report\)/);
    assert.doesNotMatch(artifact, /gpc-blocked-users-btn/);
});

test('gives the Blocked User List per-user visibility, notes and bulk editing', () => {
    // Master switch is an override, not a bulk write: flipping it off and back
    // on must not lose which individual eyes the user had already turned off.
    assert.match(artifact, /function activeIds\(\)/);
    assert.match(artifact, /if \(!store\.enabled\) return \[\];/);
    assert.match(artifact, /store\.users\.filter\(\(u\) => u\.enabled\)\.map\(\(u\) => u\.id\)/);
    assert.match(artifact, /gpp-blocked-users-master-toggle/);
    assert.match(artifact, /gpp-blocked-users-eye-/);

    // Bulk add: commas, whitespace and semicolons in any combination.
    assert.match(artifact, /function parseIds\(text\)/);
    assert.match(artifact, /split\(\/\[\\s,;\]\+\/\)/);
    assert.match(artifact, /gpp-blocked-users-preview/);

    // Bulk remove by checkbox.
    assert.match(artifact, /gpp-blocked-users-bulk-unblock/);
    assert.match(artifact, /gpp-blocked-users-select-all/);

    // Private per-user note.
    assert.match(artifact, /gpp-blocked-users-note-/);
    assert.match(artifact, /Add a private note/);

    // The old always-on explainer paragraph was removed on request.
    assert.doesNotMatch(artifact, /Pixels last placed by these users are hidden or highlighted/);
});

test('round-trips the Blocked User List through JSON import and export', () => {
    assert.match(artifact, /function exportObject\(\)/);
    assert.match(artifact, /function importJson\(text\)/);
    assert.match(artifact, /gpp-blocked-users-io-btn/);
    assert.match(artifact, /gpp-blocked-users-io-copy/);
    assert.match(artifact, /gpp-blocked-users-io-download/);
    assert.match(artifact, /gpp-blocked-users-io-file/);
    assert.match(artifact, /geopixels-blocklist\.json/);

    // Notes are opt-out on export, and the choice persists.
    assert.match(artifact, /gpp-blocked-users-io-exclude-notes/);
    assert.match(artifact, /if \(!store\.excludeNotes && u\.note\) out\.note = u\.note;/);

    // Import merges rather than replaces -- it must never wipe an existing list.
    assert.match(artifact, /if \(isBlocked\(u\.id\)\) \{ skipped\+\+; return; \}/);
});

test('styles the Blocked User List on the Ghost++ palette', () => {
    const source = readFileSync(new URL('../src/legacy/features/ext-blocked-users.js', import.meta.url), 'utf8');
    // Same t() helper Ghost++ uses via t2(), so a live theme switch tracks.
    assert.match(source, /function injectStyle\(\)/);
    assert.match(source, /\$\{t\('#ffffff', '#1e1e2e'\)\}/);   // panel, cf. gpp-lib-fullview
    assert.match(source, /\$\{t\('#d1d5db', '#45475a'\)\}/);   // border, cf. gpp-lib-btn
    assert.match(source, /\$\{t\('#2563eb', '#89b4fa'\)\}/);   // accent, cf. gpp-lib-card:hover
    assert.match(source, /\$\{t\('#64748b', '#a6adc8'\)\}/);   // muted, cf. gpp-lib-count
    // Restyled on every open so a live dark/light toggle is not frozen.
    assert.match(source, /injectStyle\(\);/);
    assert.doesNotMatch(source, /function themeColors\(\)/);
});

test('gives every Blocked User List element a gpp- prefixed id', () => {
    const source = readFileSync(new URL('../src/legacy/features/ext-blocked-users.js', import.meta.url), 'utf8');

    // Current standard: elements created by GeoPixelcons++ must carry a gpp- id.
    const assignedIds = [...source.matchAll(/\.id = ['"`]([^'"`$]*)/g)]
        .map((m) => m[1])
        .filter(Boolean);
    assert.ok(assignedIds.length > 0, 'expected the feature to assign element ids');
    for (const id of assignedIds) {
        assert.ok(id.startsWith('gpp-'), `element id "${id}" must start with gpp-`);
    }

    // Template-literal ids (per-row controls) must follow the same rule.
    const templateIds = [...source.matchAll(/\.id = `([^`]*)`/g)].map((m) => m[1]);
    for (const id of templateIds) {
        assert.ok(id.startsWith('gpp-'), `templated element id "${id}" must start with gpp-`);
    }

    assert.match(source, /const MODAL_ID\s*=\s*'gpp-blocked-users-modal'/);
    assert.match(source, /const HOVER_BTN_ID\s*=\s*'gpp-blocked-users-hover-btn'/);
});
