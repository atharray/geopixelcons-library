
    // ============================================================
    //  EXTENSION: Auto-open Menus on Hover [extAutoHoverMenus]
    // ============================================================
    if (_settings.extAutoHoverMenus && !gpcMobileOverhaulAvailable()) {
        try {
            (function _ext_autoHoverMenus() {

    const VERTICAL_ZONE_PX = 250;
    const PER_BUTTON_COOLDOWN_MS = 400;

    const buttonsState = new WeakMap();
    let trackedButtons = [];
    // Tracks whether #controls-left has EVER been found across the lifetime of
    // this feature. scanAndAttach() is not one-shot -- it's also re-invoked
    // repeatedly by the debounced MutationObserver re-scan below, and by then
    // #controls-left always already exists in practice. The bounded
    // synchronous-check -> MutationObserver-watch -> 15s-giveup pattern below
    // is only meaningful for the very first invocation, before controls-left
    // has ever existed.
    let controlsLeftEverFound = false;

    function isMenuOpen(info) {
        const { button, parent } = info;
        if (!button) return false;
        // aria-expanded is the most reliable cross-version signal
        if (button.getAttribute('aria-expanded') === 'true') return true;
        if (parent && parent.getAttribute('aria-expanded') === 'true') return true;
        // active class check
        if (button.classList.contains('active') || (parent && parent.classList.contains('active'))) return true;
        // Live dropdown lookup — re-query each check so dynamically-injected menus are found
        const dd = info.dropdown ||
            (parent ? (parent.querySelector('.dropdown-menu') ||
                       parent.querySelector('[role="menu"]') ||
                       null) : null);
        if (dd) {
            if (dd.offsetParent !== null) return true;
            if (dd.classList.contains('show') || dd.classList.contains('open')) return true;
        }
        // Fallback: any visible child list or [class*="dropdown"] sibling
        if (parent) {
            const candidates = parent.querySelectorAll('ul, [class*="dropdown"], [class*="menu"]');
            for (const el of candidates) {
                if (el !== button && el.offsetParent !== null && el.childElementCount > 0) return true;
            }
        }
        return false;
    }

    function tryOpen(info) {
        // _gpcOpened: we opened this menu and the mouse hasn't fully left the
        // button+dropdown area yet. Guard against toggle-close even when
        // isMenuOpen() fails to detect the open state (e.g. modGroupBtn/menuGroupBtn).
        if (info._gpcOpened) return;
        const now = Date.now();
        const last = buttonsState.get(info.button) || 0;
        if (now - last < PER_BUTTON_COOLDOWN_MS) return;
        if (isMenuOpen(info)) return;
        try {
            info.button.click();
            buttonsState.set(info.button, now);
            info._gpcOpened = true;
        } catch (_) {}
    }

    function scanAndAttach() {
        const controlsLeft = document.getElementById('controls-left');
        if (!controlsLeft) {
            if (controlsLeftEverFound) {
                // Steady state: controls-left previously existed and has now
                // vanished from under us. Don't start a brand-new watch/giveup
                // cycle -- the existing debounced re-scan (installMutationObserver)
                // will simply call scanAndAttach() again on its own schedule.
                dbgPush('Auto-open Menus on Hover: scanAndAttach() re-invoked but #controls-left is missing even though it was found previously -- unexpected DOM state, skipping this scan.', { uiComponent: 'Auto-open Menus on Hover' });
                return;
            }
            dbgPush('Auto-open Menus on Hover: #controls-left NOT found on the first synchronous check -- watching for it to appear.', { uiComponent: 'Auto-open Menus on Hover' });
            const watchStartedAt = Date.now();
            const observer = new MutationObserver(() => {
                const found = document.getElementById('controls-left');
                if (!found) return;
                observer.disconnect();
                clearTimeout(giveUpTimer);
                controlsLeftEverFound = true;
                dbgPush('Auto-open Menus on Hover: #controls-left appeared ' + (Date.now() - watchStartedAt) + 'ms after watching started -- scanning now.', { uiComponent: 'Auto-open Menus on Hover' });
                scanAndAttach();
            });
            observer.observe(document.body, { childList: true, subtree: true });
            const giveUpTimer = setTimeout(() => {
                observer.disconnect();
                dbgPush('Auto-open Menus on Hover: gave up after 15s -- #controls-left was never found, hover-to-open menus could not be attached at all.', { uiComponent: 'Auto-open Menus on Hover' });
                console.error('[GeoPixelcons++] Auto-open Menus on Hover: never found #controls-left.');
            }, 15000);
            return;
        }
        controlsLeftEverFound = true;

        const buttons = Array.from(
            controlsLeft.querySelectorAll('button[id$="GroupBtn"], button[id$="plusplusBtn"]')
        );

        // Detach any previously attached listeners before rebuilding
        trackedButtons.forEach(info => {
            if (info.button && info._hoverHandler) {
                info.button.removeEventListener('mouseenter', info._hoverHandler);
            }
            if (info._parentEl && info._parentLeaveHandler) {
                info._parentEl.removeEventListener('mouseleave', info._parentLeaveHandler);
            }
        });

        trackedButtons = buttons.map(button => {
            // Use `div.relative` specifically — menuGroupBtn and modGroupBtn have
            // `relative` in their OWN class list, so `button.closest('.relative')`
            // would return the button itself (wrong parent, no dropdown found).
            const parent = button.closest('div.relative') || button.parentElement;
            const dropdown = parent
                ? (parent.querySelector('.dropdown-menu') ||
                   parent.querySelector('[role="menu"]') ||
                   parent.querySelector('ul') ||
                   null)
                : null;
            const info = { button, parent, dropdown, _gpcOpened: false };

            // mouseenter on the button: open the menu if it isn't already ours.
            info._hoverHandler = () => {
                tryOpen(info);
            };
            button.addEventListener('mouseenter', info._hoverHandler);

            // mouseleave on the parent container (button + dropdown together):
            // when the pointer leaves the ENTIRE area, the site will close the dropdown
            // on its own, so reset our opened flag so re-hovering can reopen it.
            const parentEl = parent || button;
            info._parentEl = parentEl;
            info._parentLeaveHandler = (e) => {
                // relatedTarget is where the mouse went — if it's outside our container,
                // the user has fully left and we can allow reopening on next entry.
                if (!parentEl.contains(e.relatedTarget)) {
                    info._gpcOpened = false;
                }
            };
            parentEl.addEventListener('mouseleave', info._parentLeaveHandler);

            return info;
        });
    }

    function installMutationObserver() {
        const body = document.body;
        if (!body) return;
        const observer = new MutationObserver(() => {
            clearTimeout(scanDebounceTimer);
            scanDebounceTimer = setTimeout(scanAndAttach, 150);
        });
        // Only watch childList — attribute changes on body fire constantly and caused
        // scanAndAttach to re-register mouseenter handlers in a tight loop in older versions.
        observer.observe(body, { childList: true, subtree: true });
    }

    let scanDebounceTimer = null;

    function init() {
        scanAndAttach();
        installMutationObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

            })();
            _featureStatus.extAutoHoverMenus = 'ok';
            console.log('[GeoPixelcons++] ✅ Auto-open Menus on Hover loaded');
        } catch (err) {
            _featureStatus.extAutoHoverMenus = 'error';
            dbgPush(`Auto-open Menus on Hover init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Auto-open Menus on Hover' });
            console.error('[GeoPixelcons++] ❌ Auto-open Menus on Hover failed:', err);
        }
    }
