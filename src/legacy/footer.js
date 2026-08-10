
    // ============================================================
    //  AUTO-SCREENSHOT ON PAINT (fetch interceptor)
    // ============================================================
    if (_settings.regionScreenshot) {
        try {
            const _targetWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            const _origFetch = _targetWindow.fetch.bind(_targetWindow);
            _targetWindow.fetch = async function(...args) {
                const response = await _origFetch(...args);
                try {
                    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
                    if (url.includes('/PlacePixels') && isAutoScreenshotEnabled() && _regionScreenshot) {
                        const coords = loadCachedCoords();
                        if (coords && response.ok) {
                            // Small delay to let the tile cache update
                            setTimeout(() => {
                                _regionScreenshot.silentDownload(coords);
                            }, 800);
                        }
                    }
                } catch {}
                return response;
            };
            console.log('[GeoPixelcons++] \u2705 Auto-screenshot fetch hook installed');
        } catch (err) {
            console.error('[GeoPixelcons++] \u274c Auto-screenshot hook failed:', err);
        }
    }

    console.log('[GeoPixelcons++] v' + VERSION + ' initialized. Features:', _featureStatus);
})();
