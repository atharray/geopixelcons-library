// ============================================================
//  FEATURE: Mobile Overhaul [mobileOverhaul]
// ============================================================

const MOBILE_OVERHAUL_SCAFFOLD_ID = 'gpc-mobile-overhaul-scaffold';

function gpcSyncMobileOverhaulButton() {
    const button = document.getElementById('gpc-mobile-overhaul-btn');
    if (!button) return;

    const enabled = _settings.mobileOverhaul === true;
    button.dataset.enabled = String(enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.title = `Mobile Overhaul: ${enabled ? 'On' : 'Off'}`;
    button.style.outline = enabled ? '2px solid var(--color-green-500, #22c55e)' : 'none';
    button.style.outlineOffset = enabled ? '-2px' : '';

    const label = button.querySelector('[data-gpc-mobile-overhaul-label]');
    if (label) label.textContent = `Mobile Overhaul ${enabled ? '(On)' : '(Off)'}`;
}

function gpcUnmountMobileOverhaul() {
    document.getElementById(MOBILE_OVERHAUL_SCAFFOLD_ID)?.remove();
}

function gpcMountMobileOverhaul() {
    gpcUnmountMobileOverhaul();

    const dark = isDarkMode();
    const scaffold = document.createElement('section');
    scaffold.id = MOBILE_OVERHAUL_SCAFFOLD_ID;
    scaffold.setAttribute('role', 'region');
    scaffold.setAttribute('aria-live', 'polite');
    scaffold.setAttribute('aria-label', 'Mobile Overhaul scaffold');
    scaffold.style.cssText = `
        position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 99998;
        max-width: 640px; margin: 0 auto; padding: 14px 16px;
        display: flex; align-items: center; gap: 12px;
        background: ${dark ? '#1e1e2e' : '#ffffff'};
        color: ${dark ? '#cdd6f4' : '#1e293b'};
        border: 1px solid ${dark ? '#45475a' : '#e2e8f0'};
        border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.24);
        font-family: system-ui, -apple-system, sans-serif;
    `;

    const icon = document.createElement('span');
    icon.textContent = '\u{1F4F1}';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.cssText = 'font-size:20px;flex:0 0 auto;';

    const copy = document.createElement('div');
    copy.style.cssText = 'min-width:0;display:flex;flex-direction:column;gap:3px;';

    const title = document.createElement('strong');
    title.textContent = 'Mobile Overhaul scaffold';
    title.style.cssText = 'font-size:14px;line-height:1.2;';

    const description = document.createElement('span');
    description.textContent = 'Enabled. Future touch-first controls will mount here.';
    description.style.cssText = `font-size:12px;line-height:1.35;color:${dark ? '#a6adc8' : '#64748b'};`;

    copy.appendChild(title);
    copy.appendChild(description);
    scaffold.appendChild(icon);
    scaffold.appendChild(copy);
    document.body.appendChild(scaffold);
}

function gpcSetMobileOverhaul(enabled) {
    _settings.mobileOverhaul = !!enabled;
    saveSettings(_settings);

    if (_settings.mobileOverhaul) {
        try {
            gpcMountMobileOverhaul();
            _featureStatus.mobileOverhaul = 'ok';
        } catch (err) {
            _featureStatus.mobileOverhaul = 'error';
            dbgPush(`Mobile Overhaul init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Mobile Overhaul' });
            console.error('[GeoPixelcons++] ❌ Mobile Overhaul failed:', err);
        }
    } else {
        gpcUnmountMobileOverhaul();
        _featureStatus.mobileOverhaul = 'disabled';
    }

    gpcSyncMobileOverhaulButton();
}

function gpcToggleMobileOverhaul() {
    gpcSetMobileOverhaul(!_settings.mobileOverhaul);
}

if (_settings.mobileOverhaul) {
    try {
        gpcMountMobileOverhaul();
        _featureStatus.mobileOverhaul = 'ok';
    } catch (err) {
        _featureStatus.mobileOverhaul = 'error';
        dbgPush(`Mobile Overhaul init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Mobile Overhaul' });
        console.error('[GeoPixelcons++] ❌ Mobile Overhaul failed:', err);
    }
}

gpcSyncMobileOverhaulButton();
