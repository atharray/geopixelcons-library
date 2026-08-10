    const MOBILE_OVERHAUL_API_VERSION = 1;

    // Every function-typed member gppBuildMobileOverhaulBridge() (the main
    // script's bootstrap) actually publishes. Kept as one explicit list so
    // a missing or renamed bridge method fails loudly and specifically, once,
    // at startup -- instead of each call site's own typeof-guard letting a
    // broken bridge degrade into "this one feature quietly does nothing,"
    // which is much harder to notice or diagnose.
    // (bridge.subscribeEnsureOpen is deliberately NOT listed: it's not part
    // of the published bridge shape, and native-controls.js's own guarded
    // subscribeOptional() call for it is correctly optional, not a bug.)
    const MOBILE_OVERHAUL_BRIDGE_METHODS = [
        'isDark', 'ready', 'subscribeRefresh', 'getTemplates', 'getFocusedTemplate',
        'focusTemplate', 'deleteTemplate', 'getPaletteRows', 'selectColor', 'renderThumbnail',
        'renderFullPreview', 'readCenterGrid', 'canEditPosition', 'commitPosition',
        'beginPlacement', 'cancelPlacement', 'isPlacementActive', 'nudge',
        'isPreviewForced', 'togglePreview', 'setGroupNoise', 'scanTemplate', 'getScanBusy',
        'buyUnownedColors', 'getHexValues', 'copyHexValues', 'goTo', 'activateEyedropper',
        'getSelectedPaintColor', 'ensureRuntimeHooks', 'disposeHostEffects',
        'onControllerDestroyed', 'requestRefresh', 'log',
    ];

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
        if (typeof bridge.hostVersion !== 'string' || !bridge.hostVersion) {
            throw new TypeError('GeoPixelcons++ Mobile Overhaul bridge.hostVersion must be a non-empty string');
        }
        if (!bridge.env || typeof bridge.env !== 'object'
            || !bridge.env.window || !bridge.env.document
            || typeof bridge.env.document.createElement !== 'function') {
            throw new TypeError('GeoPixelcons++ Mobile Overhaul bridge.env must expose window and document');
        }
        const missing = MOBILE_OVERHAUL_BRIDGE_METHODS.filter(
            name => typeof bridge[name] !== 'function'
        );
        if (missing.length) {
            throw new TypeError(
                'GeoPixelcons++ Mobile Overhaul bridge is missing required method(s): ' + missing.join(', ')
            );
        }
        return bridge;
    }
