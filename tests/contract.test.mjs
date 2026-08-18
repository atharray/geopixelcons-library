import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const artifact = readFileSync(new URL('../dist/geopixelcons-library.js', import.meta.url), 'utf8');
const paintMenuControlsSource = readFileSync(new URL('../src/legacy/features/hide-paint-menu.js', import.meta.url), 'utf8');
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
    assert.match(artifact, /const VERSION = '2\.7\.0';/);
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const versionPattern = new RegExp(`const LIBRARY_VERSION = '${escapedVersion}'; // x-release-please-version`);
    assert.match(artifact, versionPattern);
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
    assert.match(paintMenuControlsSource, /root\.style\.height/);
    assert.match(paintMenuControlsSource, /gpc-paint-flip-pos/);
    assert.match(paintMenuControlsSource, /making the scale tab a Paint Menu Controls capability/);
    assert.doesNotMatch(paintingMenuOverhaulSource, /gpc-pmc-scale-tab/);
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
