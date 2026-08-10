    const MOBILE_OVERHAUL_API_VERSION = 1;

    function validateMobileOverhaulBridge(bridge) {
        if (!bridge || typeof bridge !== 'object') {
            throw new TypeError('GeoPixelcons++ Mobile Overhaul requires a bridge object');
        }
        if (bridge.apiVersion !== MOBILE_OVERHAUL_API_VERSION) {
            throw new Error(
                'Unsupported GeoPixelcons++ Mobile Overhaul bridge API version: expected '
                + MOBILE_OVERHAUL_API_VERSION + ', received ' + String(bridge.apiVersion)
            );
        }
        if (typeof bridge.ready !== 'function') {
            throw new TypeError('GeoPixelcons++ Mobile Overhaul bridge.ready must be a function');
        }
        return bridge;
    }
