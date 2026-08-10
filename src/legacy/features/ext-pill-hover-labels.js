
    // ============================================================
    //  EXTENSION: Pill Hover Labels [extPillHoverLabels]
    // ============================================================
    // See the identical comment in hide-paint-menu.js: gpcMobileOverhaulAvailable()
    // is read once at boot, before Mobile Overhaul's async init has settled.
    let gppExtPillHoverLabelsInitialized = false;
    function gppRetryExtPillHoverLabelsInit() {
        if (gppExtPillHoverLabelsInitialized) return;
        if (!_settings.extPillHoverLabels || gpcMobileOverhaulAvailable()) return;
        gppExtPillHoverLabelsInitialized = true;
        try {
            (function _ext_pillHoverLabels() {

    const PROCESSED_ATTR = 'data-gpc-pill';

    function transformButton(btn) {
        if (btn.hasAttribute(PROCESSED_ATTR)) return;
        // Skip buttons that are GeoPixelcons++ pills already
        if (btn.classList.contains('gpc-pill-btn')) return;
        // Only target round 40px submenu buttons (rounded-full or rounded-xl for GeoPixels++ select buttons)
        if (!btn.classList.contains('w-10') || !btn.classList.contains('h-10')) return;
        if (!btn.classList.contains('rounded-full') && !btn.classList.contains('rounded-xl')) return;
        // Must be inside a dropdown-menu
        if (!btn.closest('.dropdown-menu')) return;
        // Must be inside controls-left
        if (!btn.closest('#controls-left')) return;
        // Skip buttons that are hidden (mod tools, etc.) — they'll be
        // picked up by the MutationObserver when they become visible
        if (btn.classList.contains('hidden')) return;

        btn.setAttribute(PROCESSED_ATTR, '1');

        const label = btn.title || btn.getAttribute('aria-label') || '';
        if (!label) return;

        // Save the original icon content — could be text/emoji or an SVG element
        const svg = btn.querySelector('svg');
        const iconText = btn.textContent.trim();

        // Create icon span
        const iconSpan = document.createElement('span');
        iconSpan.style.cssText = 'width:40px;min-width:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:40px;pointer-events:none;';
        if (svg) {
            iconSpan.appendChild(svg.cloneNode(true));
        } else {
            iconSpan.textContent = iconText;
        }

        // Create label span — use CSS var for text color so it follows the active theme
        const labelSpan = document.createElement('span');
        labelSpan.style.cssText = 'white-space:nowrap;font-size:12px;font-weight:600;color:var(--color-gray-700, #374151);opacity:0;transition:opacity .2s .05s;padding-right:12px;pointer-events:none;';
        labelSpan.textContent = label;

        // Restyle the button — use CSS custom properties so GeoPixels++ themes apply
        btn.innerHTML = '';
        btn.style.position = 'relative';
        btn.style.width = '40px';
        btn.style.height = '40px';
        btn.style.borderRadius = '9999px';
        btn.style.background = 'var(--color-white, #fff)';
        btn.style.boxShadow = '0 1px 3px rgba(0,0,0,.12)';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'flex-start';
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.style.overflow = 'hidden';
        btn.style.transition = 'width .25s cubic-bezier(.4,0,.2,1), background .15s';
        btn.style.padding = '0';
        btn.style.fontSize = '16px';
        btn.style.flexShrink = '0';
        // Only set display to flex if not hidden
        if (!btn.classList.contains('hidden')) {
            btn.style.display = 'flex';
        }
        // Keep original classes needed for visibility toggling but drop sizing
        btn.classList.remove('w-10', 'h-10');

        btn.appendChild(iconSpan);
        btn.appendChild(labelSpan);

        btn.addEventListener('mouseenter', () => {
            const textW = labelSpan.scrollWidth + 12;
            btn.style.width = (40 + textW) + 'px';
            labelSpan.style.opacity = '1';
            btn.style.background = 'var(--color-gray-100, #f3f4f6)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.width = '40px';
            labelSpan.style.opacity = '0';
            btn.style.background = 'var(--color-white, #fff)';
        });
    }

    function scanAll() {
        const container = document.getElementById('controls-left');
        if (!container) return;
        // Match both rounded-full (native) and rounded-xl (GeoPixels++ select buttons)
        container.querySelectorAll('.dropdown-menu button.rounded-full, .dropdown-menu button.rounded-xl').forEach(transformButton);
        // Re-check already-processed buttons whose content was externally replaced
        // (e.g. togglePrimaryMode replaces innerHTML, destroying our pill structure).
        // Skip hidden buttons — a button can also carry PROCESSED_ATTR because
        // another feature (e.g. Ghost++'s gppReplaceNativeOpener) reused it as
        // an "already handled, don't touch" marker on a button it hid rather
        // than transformed, and that button will never have span children.
        // Without this guard, the missing-span check below strips the marker
        // on every mutation and re-invites transformButton() to reprocess it.
        container.querySelectorAll('.dropdown-menu button[' + PROCESSED_ATTR + ']').forEach(btn => {
            if (btn.classList.contains('hidden')) return;
            if (!btn.querySelector('span')) {
                // Our spans were destroyed — reset and re-transform
                btn.removeAttribute(PROCESSED_ATTR);
                btn.classList.add('w-10', 'h-10');
                transformButton(btn);
            }
        });
    }

    // Runs the feature's real, ongoing business logic once #controls-left is
    // known to exist: an initial scan plus a permanent MutationObserver that
    // re-scans on childList/attributes mutations within that same container.
    function startPillWatch(container) {
        scanAll();

        // Watch for dynamically added buttons
        const observer = new MutationObserver(() => {
            clearTimeout(debounce);
            debounce = setTimeout(scanAll, 150);
        });
        let debounce = null;
        observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    // Mirrors gpp-ui-shell.js's gppReplaceNativeOpener / Ghost Palette
    // Search's injectSyncGhostBtn retry pattern (synchronous check ->
    // MutationObserver watch -> bounded giveup) instead of the old bare
    // setTimeout(init, 500) infinite poll, which had no giveup and logged
    // nothing at any step.
    function init() {
        const watchStartedAt = Date.now();
        const immediate = document.getElementById('controls-left');
        if (immediate) {
            dbgPush('Pill Hover Labels: #controls-left found on the first synchronous check -- starting scan now.', { uiComponent: 'Pill Hover Labels' });
            startPillWatch(immediate);
            return;
        }
        dbgPush('Pill Hover Labels: #controls-left NOT found on the first synchronous check -- watching for it to appear.', { uiComponent: 'Pill Hover Labels' });
        // #controls-left doesn't exist yet, so it can't be watched directly --
        // watch document.body instead, matching gppReplaceNativeOpener's own
        // fallback-to-body pattern.
        const observer = new MutationObserver(() => {
            const found = document.getElementById('controls-left');
            if (!found) return;
            observer.disconnect();
            clearTimeout(giveUpTimer);
            dbgPush('Pill Hover Labels: #controls-left appeared ' + (Date.now() - watchStartedAt) + 'ms after watching started -- starting scan now.', { uiComponent: 'Pill Hover Labels' });
            startPillWatch(found);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // 15s matches the same give-up duration Ghost Palette Search / Ghost++'s
        // gppReplaceNativeOpener already use for their own late-mounting-element watchers.
        const giveUpTimer = setTimeout(() => {
            observer.disconnect();
            dbgPush('Pill Hover Labels: gave up after 15s -- #controls-left was never found, so pill hover labels could not be initialized at all.', { uiComponent: 'Pill Hover Labels' });
            console.error('[GeoPixelcons++] Pill Hover Labels: never found #controls-left.');
        }, 15000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

            })();
            _featureStatus.extPillHoverLabels = 'ok';
            console.log('[GeoPixelcons++] ✅ Pill Hover Labels loaded');
        } catch (err) {
            _featureStatus.extPillHoverLabels = 'error';
            dbgPush(`Pill Hover Labels init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Pill Hover Labels' });
            console.error('[GeoPixelcons++] ❌ Pill Hover Labels failed:', err);
        }
    }
    gppRetryExtPillHoverLabelsInit();
