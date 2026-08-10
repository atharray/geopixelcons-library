    Object.defineProperties(initMobileOverhaul, {
        apiVersion: {
            value: MOBILE_OVERHAUL_API_VERSION,
            enumerable: true,
        },
        moduleVersion: {
            value: GPP_MOBILE_UI_VERSION,
            enumerable: true,
        },
    });

    return initMobileOverhaul;
})();
