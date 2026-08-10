
    // ============================================================
    //  SETTING: Start in Inspect Mode [startInspectMode]
    // ============================================================
    if (_settings.startInspectMode) {
        try {
            const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

            // Wait for the map to be fully ready (canvas contexts exist)
            // before toggling mode — prevents white-screen on load
            function waitForMapReady(cb, maxWait) {
                maxWait = maxWait || 20000;
                const start = Date.now();
                function check() {
                    if (_pw.map && typeof _pw.map.getCanvas === 'function' &&
                        document.getElementById('pixel-canvas') &&
                        document.getElementById('pixel-canvas').getContext) {
                        cb(); return;
                    }
                    if (Date.now() - start >= maxWait) return;
                    setTimeout(check, 300);
                }
                check();
            }

            // Wait for the togglePrimaryModeBtn to exist and its title to
            // stabilize (stop changing) before reading the current mode
            function waitForEl(id, cb) {
                const el = document.getElementById(id);
                if (el) { cb(el); return; }
                const obs = new MutationObserver(() => {
                    const found = document.getElementById(id);
                    if (found) { obs.disconnect(); cb(found); }
                });
                obs.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => obs.disconnect(), 15000);
            }

            function waitForStableTitle(el, cb) {
                let timer = null;
                let done = false;
                function fire() {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    titleObs.disconnect();
                    cb(el);
                }
                const titleObs = new MutationObserver(() => {
                    clearTimeout(timer);
                    timer = setTimeout(fire, 500);
                });
                titleObs.observe(el, { attributes: true, attributeFilter: ['title'] });
                timer = setTimeout(fire, 500);
                setTimeout(fire, 6000);
            }

            waitForEl('togglePrimaryModeBtn', (btn) => {
                waitForMapReady(() => {
                    waitForStableTitle(btn, () => {
                        // title "Switch to Action Mode" = currently inspect
                        // title "Switch to Inspect Mode" = currently action
                        const currentMode = (btn.title || '').toLowerCase().includes('action') ? 'inspect' : 'action';
                        if (currentMode === 'action') {
                            try {
                                if (typeof _pw.togglePrimaryMode === 'function') _pw.togglePrimaryMode();
                                else btn.click();
                            } catch (_) { try { btn.click(); } catch (__) {} }
                            console.log('[GeoPixelcons++] \u2705 Switched to Inspect Mode on startup');
                        }
                    });
                });
            });

            _featureStatus.startInspectMode = 'ok';
        } catch (err) {
            _featureStatus.startInspectMode = 'error';
            dbgPush(`Start in Inspect Mode init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Start in Inspect Mode' });
            console.error('[GeoPixelcons++] \u274C Start in Inspect Mode failed:', err);
        }
    }