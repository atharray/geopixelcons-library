
    // ============================================================
    //  SETTING: Disable Group Noise [disableGroupNoise]
    // ============================================================
    if (_settings.disableGroupNoise) {
        try {
            function enforceNoGroupNoise() {
                const toggle = document.getElementById('groupNoiseToggle');
                if (!toggle) return false;

                // Uncheck it
                if (toggle.checked) {
                    toggle.checked = false;
                    // Fire change event so ghost22.js re-processes if a template is loaded
                    if (typeof handleGroupingToggle === 'function') {
                        handleGroupingToggle();
                    }
                }

                // Gray out the toggle and its label, add "disabled" text
                toggle.disabled = true;
                toggle.style.opacity = '0.4';
                toggle.style.cursor = 'not-allowed';
                const container = toggle.closest('label') || toggle.parentElement;
                if (container) {
                    container.style.opacity = '0.4';
                    container.style.cursor = 'not-allowed';
                    // Add "disabled" badge if not already present
                    if (!container.querySelector('.gpc-noise-disabled-badge')) {
                        const badge = document.createElement('span');
                        badge.className = 'gpc-noise-disabled-badge';
                        badge.style.cssText = 'font-size:10px;font-weight:600;color:#ef4444;margin-left:6px;vertical-align:middle;';
                        badge.textContent = '(disabled by GeoPixelcons++)';
                        container.appendChild(badge);
                    }
                }

                // Intercept any programmatic re-checking via a property override
                Object.defineProperty(toggle, 'checked', {
                    get() { return false; },
                    set() { /* no-op: group noise is permanently disabled */ },
                    configurable: true
                });

                return true;
            }

            // Try immediately, then observe for the ghost modal being opened
            if (!enforceNoGroupNoise()) {
                const noiseObserver = new MutationObserver(() => {
                    if (enforceNoGroupNoise()) noiseObserver.disconnect();
                });
                noiseObserver.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => noiseObserver.disconnect(), 60000);
            }

            _featureStatus.disableGroupNoise = 'ok';
            console.log('[GeoPixelcons++] ✅ Disable Group Noise loaded');
        } catch (err) {
            _featureStatus.disableGroupNoise = 'error';
            dbgPush(`Disable Group Noise init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Disable Group Noise' });
            console.error('[GeoPixelcons++] ❌ Disable Group Noise failed:', err);
        }
    }