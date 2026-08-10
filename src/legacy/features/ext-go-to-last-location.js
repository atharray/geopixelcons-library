
    // ============================================================
    //  EXTENSION: Auto-Go to Last Location [extGoToLastLocation]
    // ============================================================
    if (_settings.extGoToLastLocation) {
        try {
            (function _ext_goToLastLocation() {

    const SPAWN_LNG_MIN = -75;
    const SPAWN_LNG_MAX = -73;
    const SPAWN_LAT_MIN = 39;
    const SPAWN_LAT_MAX = 41;

    let hasClicked = false;
    let observer = null;

    function checkAndClick() {
        if (hasClicked) return;

        const button = document.getElementById('lastLocationButton');

        let mapObj = null;
        try {
            mapObj = eval('map');
        } catch (e) {
            return;
        }

        if (button && typeof window.goToLocation === 'function' && mapObj && typeof mapObj.getCenter === 'function') {
            try {
                const center = mapObj.getCenter();
                const lng = center.lng;
                const lat = center.lat;

                if (lng >= SPAWN_LNG_MIN && lng <= SPAWN_LNG_MAX && lat >= SPAWN_LAT_MIN && lat <= SPAWN_LAT_MAX) {
                    hasClicked = true;
                    if (observer) observer.disconnect();
                    button.click();
                }
            } catch (e) {}
        }
    }

    checkAndClick();

    if (!hasClicked) {
        observer = new MutationObserver(() => {
            checkAndClick();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            if (!hasClicked && observer) {
                observer.disconnect();
            }
        }, 10000);
    }

            })();
            _featureStatus.extGoToLastLocation = 'ok';
            console.log('[GeoPixelcons++] ✅ Auto-Go to Last Location loaded');
        } catch (err) {
            _featureStatus.extGoToLastLocation = 'error';
            dbgPush(`Auto-Go to Last Location init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Auto-Go to Last Location' });
            console.error('[GeoPixelcons++] ❌ Auto-Go to Last Location failed:', err);
        }
    }