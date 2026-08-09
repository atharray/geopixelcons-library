var GeoPixelconsLibrary = (function createGeoPixelconsLibrary() {
    const LIBRARY_VERSION = '0.1.0';

    function boot(adapter) {
        const api = gpcValidateAdapter(adapter);
        const controllers = new Map();
        let destroyed = false;

        function assertLive() {
            if (destroyed) throw new Error('GeoPixelcons library runtime is destroyed.');
        }

        return Object.freeze({
            get destroyed() {
                return destroyed;
            },
            register(id, factory) {
                assertLive();
                if (typeof id !== 'string' || !id) throw new TypeError('Controller id must be a non-empty string.');
                if (controllers.has(id)) throw new Error(`GeoPixelcons controller ${id} is already registered.`);
                if (typeof factory !== 'function') throw new TypeError(`GeoPixelcons controller ${id} factory must be a function.`);
                const controller = gpcValidateController(factory(api), id);
                controllers.set(id, controller);
                return controller;
            },
            refresh() {
                assertLive();
                for (const controller of controllers.values()) controller.refresh();
            },
            destroy() {
                if (destroyed) return;
                destroyed = true;
                const errors = [];
                for (const controller of [...controllers.values()].reverse()) {
                    try {
                        controller.destroy();
                    } catch (error) {
                        errors.push(error);
                    }
                }
                controllers.clear();
                if (errors.length) throw new AggregateError(errors, 'One or more GeoPixelcons controllers failed to destroy.');
            },
        });
    }

    return Object.freeze({
        version: LIBRARY_VERSION,
        contractVersion: GPC_LIBRARY_CONTRACT_VERSION,
        boot,
    });
})();
