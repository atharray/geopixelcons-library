
    // ============================================================
    //  FEATURE: Sync Ghost With Selected Color [showSyncGhostBtn]
    // ============================================================
    // Split out of ghost-palette-search.js into its own feature -- it never
    // depended on anything in that file (the search/filter/sort UI), it was
    // only ever bundled there historically. Standing alone means there is no
    // "display option nested inside an unrelated legacy feature" dependency
    // to keep in sync -- a real Discord report ("button doesn't render" while
    // the display option was checked but its former parent feature was off)
    // came directly from that coupling.
    if (_settings.showSyncGhostBtn) {
        try {
            (function _init_syncGhostColor() {

    let _syncGhostEnabled = false;

    // Patch changeColor once — fires a custom event because pixelColor is a `let`
    // variable in page scope and is not reachable via window.pixelColor.
    (function patchChangeColor() {
        const script = document.createElement('script');
        script.textContent = `(function(){
if(window.__gpc_colorPatchApplied)return;
window.__gpc_colorPatchApplied=true;
var _orig=window.changeColor;
if(typeof _orig!=='function')return;
window.changeColor=function(color){
    _orig.call(this,color);
    document.dispatchEvent(new CustomEvent('gpc:pixelColorChanged',{detail:color}));
};
})();`;
        document.head.appendChild(script);
        script.remove();
    })();

    function applyAutoEnableSelectedColor(targetHex) {
        // Ghost++ compatibility: while it owns the overlay slot, the native
        // #ghostColorPalette DOM below is never (re)populated for whatever
        // template it has focused (see gpp-native-shim.js's own header
        // comment on why — it blocks the native "load a ghost image" flow
        // that's the only thing that ever rebuilds that DOM), so this
        // toggle would otherwise silently find zero swatches to act on.
        // gppApplySelectedColorToFocusedTemplate (gpp-palette.js) drives
        // Ghost++'s own template.mask instead and returns true whenever it
        // handled this (Ghost++ has a template focused) — skip the
        // native-DOM path entirely in that case. Falls through unchanged
        // below whenever Ghost++ isn't enabled, or has nothing focused.
        if (typeof gppApplySelectedColorToFocusedTemplate === 'function' && gppApplySelectedColorToFocusedTemplate(targetHex)) {
            return;
        }
        const paletteDiv = document.getElementById('ghostColorPalette');
        if (!paletteDiv) return;
        const colorButtons = paletteDiv.querySelectorAll('button[data-color-rgba]');
        if (!colorButtons.length) return;
        const normalizedTarget = targetHex.toUpperCase();
        let targetFound = false;
        const toEnable = [], toDisable = [];
        colorButtons.forEach(btn => {
            const rgba = btn.dataset.colorRgba;
            if (!rgba) return;
            let hex = '';
            const firstLine = (btn.getAttribute('title') || '').split(/[\r\n]+/)[0].trim().toUpperCase();
            if (/^#[0-9A-F]{6}$/.test(firstLine)) {
                hex = firstLine;
            } else {
                const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (m) hex = '#' + [m[1], m[2], m[3]]
                    .map(n => parseInt(n).toString(16).toUpperCase().padStart(2, '0')).join('');
            }
            const isEnabled = btn.classList.contains('border-blue-500');
            const shouldBeEnabled = hex === normalizedTarget;
            if (shouldBeEnabled) targetFound = true;
            if (shouldBeEnabled && !isEnabled) toEnable.push(rgba);
            else if (!shouldBeEnabled && isEnabled) toDisable.push(rgba);
        });
        if (!targetFound) return;
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

    document.addEventListener('gpc:pixelColorChanged', (e) => {
        if (!_syncGhostEnabled) return;
        applyAutoEnableSelectedColor(e.detail);
    });

    // ── Inject toggle button into #imageGroupDropdown ─────────────────
    // Mirrors gpp-ui-shell.js's gppReplaceNativeOpener retry pattern
    // (synchronous check -> MutationObserver watch -> bounded giveup) --
    // synchronous check, logged either way; if not found, watch the nearest
    // stable ancestor via MutationObserver; 15s giveup, logged to both
    // dbgPush and console.error.
    (function injectSyncGhostBtn() {
        const syncBtnStyle = document.createElement('style');
        syncBtnStyle.textContent =
            '#gpc-sync-ghost-btn[data-active="true"]{background:#dcfce7!important;}' +
            '#gpc-sync-ghost-btn[data-active="true"]:hover{background:#bbf7d0!important;}';
        document.head.appendChild(syncBtnStyle);

        function createButton(dropdown) {
            if (document.getElementById('gpc-sync-ghost-btn')) return;
            const btn = document.createElement('button');
            btn.id = 'gpc-sync-ghost-btn';
            btn.className = 'w-10 h-10 bg-white shadow rounded-full flex items-center justify-center hover:bg-gray-100 cursor-pointer';
            btn.title = 'Sync Ghost With Selected Color';
            btn.textContent = '♻️';
            btn.addEventListener('click', () => {
                _syncGhostEnabled = !_syncGhostEnabled;
                btn.dataset.active = _syncGhostEnabled ? 'true' : 'false';
            });
            dropdown.appendChild(btn);
            dbgPush('Sync Ghost With Selected Color: button mounted into #imageGroupDropdown.', { uiComponent: 'Sync Ghost With Selected Color' });
        }

        const watchStartedAt = Date.now();
        const immediate = document.getElementById('imageGroupDropdown');
        if (immediate) {
            dbgPush('Sync Ghost With Selected Color: #imageGroupDropdown found on the first synchronous check -- mounting the button now.', { uiComponent: 'Sync Ghost With Selected Color' });
            createButton(immediate);
            return;
        }
        dbgPush('Sync Ghost With Selected Color: #imageGroupDropdown NOT found on the first synchronous check -- watching for it to appear.', { uiComponent: 'Sync Ghost With Selected Color' });
        const watchRoot = document.getElementById('controls-left') || document.body;
        const observer = new MutationObserver(() => {
            const found = document.getElementById('imageGroupDropdown');
            if (!found) return;
            observer.disconnect();
            clearTimeout(giveUpTimer);
            dbgPush('Sync Ghost With Selected Color: #imageGroupDropdown appeared ' + (Date.now() - watchStartedAt) + 'ms after watching started -- mounting the button now.', { uiComponent: 'Sync Ghost With Selected Color' });
            createButton(found);
        });
        observer.observe(watchRoot, { childList: true, subtree: true });
        // 15s matches the same give-up duration gppReplaceNativeOpener (and
        // ext-map-movement-lock.js / ext-log-out-button.js) already use for
        // their own late-mounting-element watchers.
        const giveUpTimer = setTimeout(() => {
            observer.disconnect();
            dbgPush('Sync Ghost With Selected Color: gave up after 15s -- #imageGroupDropdown was never found, so the button could not be mounted at all.', { uiComponent: 'Sync Ghost With Selected Color' });
            console.error('[GeoPixelcons++] Sync Ghost With Selected Color: never found #imageGroupDropdown to mount the button into.');
        }, 15000);
    })();

    _featureStatus.showSyncGhostBtn = 'ok';
    console.log('[GeoPixelcons++] ✅ Sync Ghost With Selected Color loaded');
            })();
        } catch (err) {
            _featureStatus.showSyncGhostBtn = 'error';
            dbgPush(`Sync Ghost With Selected Color init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Sync Ghost With Selected Color' });
            console.error('[GeoPixelcons++] ❌ Sync Ghost With Selected Color failed:', err);
        }
    }
