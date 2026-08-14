// ============================================================
//  FEATURE: Profile Color List Collapse [profileColorsCollapse]
// ============================================================
if (_settings.profileColorsCollapse) {
    try {
        (function _init_profileColorsCollapse() {
            const COLOR_CONTAINER_ID = 'userColorsContainer';
            const TOGGLE_WRAPPER_ID = 'gpc-profile-colors-toggle';
            const TOGGLE_BUTTON_ID = 'gpc-profile-colors-toggle-btn';
            const MAX_VISIBLE_COLORS = 100;
            const COLLAPSED_ATTR = 'data-gpc-profile-color-collapsed';

            let isExpanded = false;
            let watchedContainer = null;
            let containerObserver = null;
            let bodyObserver = null;
            let refreshQueued = false;

            function getColorSwatches(container) {
                return Array.from(container.children).filter((child) => {
                    return child.id !== TOGGLE_WRAPPER_ID;
                });
            }

            function restoreCollapsedSwatches(swatches) {
                swatches.forEach((swatch) => {
                    if (!swatch.hasAttribute(COLLAPSED_ATTR)) return;
                    swatch.classList.remove('hidden');
                    swatch.removeAttribute('aria-hidden');
                    swatch.removeAttribute(COLLAPSED_ATTR);
                });
            }

            function getOrCreateToggle(container) {
                const parent = container.parentElement;
                if (!parent) return null;

                let wrapper = parent.querySelector('#' + TOGGLE_WRAPPER_ID);
                if (!wrapper) {
                    wrapper = document.createElement('div');
                    wrapper.id = TOGGLE_WRAPPER_ID;
                    wrapper.className = 'mt-2 hidden';

                    const button = document.createElement('button');
                    button.id = TOGGLE_BUTTON_ID;
                    button.type = 'button';
                    button.className = 'px-3 py-1 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer';
                    button.setAttribute('aria-controls', COLOR_CONTAINER_ID);
                    button.addEventListener('click', () => {
                        isExpanded = !isExpanded;
                        applyVisibility(container);
                    });

                    wrapper.appendChild(button);
                    parent.insertBefore(wrapper, container.nextSibling);
                }

                return wrapper;
            }

            function applyVisibility(container) {
                if (!container || !container.isConnected) return;

                const swatches = getColorSwatches(container);
                const wrapper = getOrCreateToggle(container);
                if (!wrapper) return;

                restoreCollapsedSwatches(swatches);

                const shouldCollapse = swatches.length > MAX_VISIBLE_COLORS;
                wrapper.classList.toggle('hidden', !shouldCollapse);

                const button = wrapper.querySelector('#' + TOGGLE_BUTTON_ID);
                if (!button) return;

                if (shouldCollapse && !isExpanded) {
                    swatches.slice(MAX_VISIBLE_COLORS).forEach((swatch) => {
                        swatch.classList.add('hidden');
                        swatch.setAttribute('aria-hidden', 'true');
                        swatch.setAttribute(COLLAPSED_ATTR, '1');
                    });
                }

                button.textContent = isExpanded ? 'Show Less' : 'Show All';
                button.setAttribute('aria-expanded', String(isExpanded));
            }

            function queueRefresh(container) {
                if (refreshQueued) return;
                refreshQueued = true;
                queueMicrotask(() => {
                    refreshQueued = false;
                    applyVisibility(container);
                });
            }

            function watchContainer(container) {
                if (container === watchedContainer) {
                    queueRefresh(container);
                    return;
                }

                if (containerObserver) containerObserver.disconnect();
                watchedContainer = container;
                containerObserver = new MutationObserver(() => queueRefresh(container));
                containerObserver.observe(container, { childList: true });
                isExpanded = false;
                applyVisibility(container);
            }

            function syncContainer() {
                const container = document.getElementById(COLOR_CONTAINER_ID);
                if (container) {
                    watchContainer(container);
                    if (bodyObserver) {
                        bodyObserver.disconnect();
                        bodyObserver = null;
                    }
                } else if (containerObserver) {
                    containerObserver.disconnect();
                    containerObserver = null;
                    watchedContainer = null;
                }
            }

            function init() {
                syncContainer();
                if (watchedContainer) return;

                bodyObserver = new MutationObserver(syncContainer);
                bodyObserver.observe(document.body, { childList: true, subtree: true });
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init, { once: true });
            } else {
                init();
            }
        })();
        _featureStatus.profileColorsCollapse = 'ok';
        console.log('[GeoPixelcons++] ✅ Profile Color List Collapse loaded');
    } catch (err) {
        _featureStatus.profileColorsCollapse = 'error';
        dbgPush(`Profile Color List Collapse init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Profile Color List Collapse' });
        console.error('[GeoPixelcons++] ❌ Profile Color List Collapse failed:', err);
    }
}
