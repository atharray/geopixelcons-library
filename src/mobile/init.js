    let activeController = null;
    let activeInitPromise = null;

    async function initMobileOverhaul(bridge) {
        validateMobileOverhaulBridge(bridge);
        installMobileTheme(bridge.env && bridge.env.document);
        if (activeController) return activeController;
        if (activeInitPromise) return activeInitPromise;

        const pending = (async () => {
            await bridge.ready();
            const controller = createNativeControlsController(bridge, destroyedController => {
                if (activeController === destroyedController) activeController = null;
            });
            activeController = controller;
            return controller;
        })();
        activeInitPromise = pending;

        try {
            return await pending;
        } finally {
            if (activeInitPromise === pending) activeInitPromise = null;
        }
    }
