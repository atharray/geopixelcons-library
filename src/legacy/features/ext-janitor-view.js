
    // ============================================================
    //  EXTENSION: Janitor View [extJanitorView]
    // ============================================================
    if (_settings.extJanitorView) {
        try {
            (function _ext_janitorView() {

    function revealModBtn() {
        const btn = document.getElementById('modGroupBtn');
        if (btn && btn.classList.contains('hidden')) {
            btn.classList.remove('hidden');
            return true;
        }
        return false;
    }

    function init() {
        if (revealModBtn()) return;

        // Button may not exist yet — watch for it
        const observer = new MutationObserver(() => {
            if (revealModBtn()) {
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        // Safety cleanup
        setTimeout(() => observer.disconnect(), 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

            })();
            _featureStatus.extJanitorView = 'ok';
            console.log('[GeoPixelcons++] ✅ Janitor View loaded');
        } catch (err) {
            _featureStatus.extJanitorView = 'error';
            dbgPush(`Janitor View init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Janitor View' });
            console.error('[GeoPixelcons++] ❌ Janitor View failed:', err);
        }
    }