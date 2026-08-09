const GPC_LIBRARY_CONTRACT_VERSION = 1;

const GPC_REQUIRED_VALUE_PATHS = [
    'env.window',
    'env.document',
];

const GPC_REQUIRED_FUNCTION_PATHS = [
    'settings.get',
    'settings.subscribe',
    'native.clickControl',
    'native.changeColor',
    'native.activateEyedropper',
    'ghost.getTemplates',
    'ghost.focus',
    'ghost.renderPreview',
    'ghost.scan',
    'map.readCenterGrid',
    'map.commitPosition',
    'map.goTo',
    'ui.requestRefresh',
    'ui.reportError',
];

function gpcReadPath(object, dottedPath) {
    return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

function gpcValidateAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') {
        throw new TypeError('GeoPixelcons library requires an adapter object.');
    }
    if (adapter.contractVersion !== GPC_LIBRARY_CONTRACT_VERSION) {
        throw new Error(
            `Unsupported GeoPixelcons adapter contract ${String(adapter.contractVersion)}; expected ${GPC_LIBRARY_CONTRACT_VERSION}.`,
        );
    }
    for (const dottedPath of GPC_REQUIRED_VALUE_PATHS) {
        if (!gpcReadPath(adapter, dottedPath)) {
            throw new TypeError(`GeoPixelcons adapter is missing ${dottedPath}.`);
        }
    }
    for (const dottedPath of GPC_REQUIRED_FUNCTION_PATHS) {
        if (typeof gpcReadPath(adapter, dottedPath) !== 'function') {
            throw new TypeError(`GeoPixelcons adapter is missing ${dottedPath}().`);
        }
    }
    return adapter;
}

function gpcValidateController(controller, id) {
    if (!controller || typeof controller !== 'object') {
        throw new TypeError(`GeoPixelcons controller ${id} did not return an object.`);
    }
    for (const method of ['refresh', 'destroy']) {
        if (typeof controller[method] !== 'function') {
            throw new TypeError(`GeoPixelcons controller ${id} is missing ${method}().`);
        }
    }
    return controller;
}
