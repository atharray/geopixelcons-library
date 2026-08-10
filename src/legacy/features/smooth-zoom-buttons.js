
    // ============================================================
    //  SETTING: Smooth Zoom Buttons [smoothZoomButtons]
    // ============================================================
    if (_settings.smoothZoomButtons) {
        try {
            const _pw2 = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            const SZ_MIN = 0.5;
            const SZ_MAX = 22;
            const SZ_STEP = 0.01;
            const SZ_WHEEL_STEP = 0.1;
            const SZ_HOLD_DELAY = 400;
            const SZ_HOLD_INTERVAL = 50;

            // Inject styles — only non-Tailwind-expressible rules (writing-mode, spinner removal)
            const szStyle = document.createElement('style');
            szStyle.textContent = `
                #gpc-smooth-zoom input[type=range] {
                    writing-mode: vertical-lr;
                    direction: rtl;
                    width: 8px;
                    height: 94px;
                    cursor: pointer;
                    accent-color: #22c55e;
                    margin: 0;
                }
                #gpc-smooth-zoom input[type=number]::-webkit-outer-spin-button,
                #gpc-smooth-zoom input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
                #gpc-smooth-zoom input[type=number] { -moz-appearance: textfield; }
            `;
            document.head.appendChild(szStyle);

            function _sz_buildWidget(zoomInBtn, zoomOutBtn, controlsRight) {
                zoomInBtn.style.display = 'none';
                zoomOutBtn.style.display = 'none';

                const wrapper = document.createElement('div');
                wrapper.id = 'gpc-smooth-zoom';
                wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;';

                function makeCircleBtn(label, title) {
                    const btn = document.createElement('button');
                    btn.className = 'gpc-sz-btn w-10 h-10 bg-white dark:bg-gray-700 shadow rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer select-none flex-shrink-0 text-gray-700 dark:text-gray-200 border-0';
                    btn.textContent = label;
                    btn.title = title;
                    btn.style.cssText = 'font-size:20px;line-height:1;';
                    return btn;
                }

                const plusBtn = makeCircleBtn('+', 'Zoom In');
                const minusBtn = makeCircleBtn('\u2212', 'Zoom Out');

                const sliderWrap = document.createElement('div');
                sliderWrap.className = 'bg-white dark:bg-gray-700 shadow flex items-center justify-center';
                sliderWrap.style.cssText = 'width:40px;height:120px;border-radius:20px;';
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = SZ_MIN;
                slider.max = SZ_MAX;
                slider.step = SZ_STEP;
                sliderWrap.appendChild(slider);

                const valueBox = document.createElement('input');
                valueBox.type = 'number';
                valueBox.min = SZ_MIN;
                valueBox.max = SZ_MAX;
                valueBox.step = 0.01;
                valueBox.className = 'text-center text-xs font-semibold border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg shadow';
                valueBox.style.cssText = 'width:40px;height:28px;padding:0 4px;box-sizing:border-box;';

                wrapper.appendChild(plusBtn);
                wrapper.appendChild(sliderWrap);
                wrapper.appendChild(minusBtn);
                wrapper.appendChild(valueBox);
                controlsRight.insertBefore(wrapper, zoomInBtn);

                // Wait for map instance then wire up events
                function _sz_waitForMap(cb) {
                    if (_pw2.map && typeof _pw2.map.getZoom === 'function') { cb(_pw2.map); return; }
                    const t = setInterval(() => {
                        if (_pw2.map && typeof _pw2.map.getZoom === 'function') { clearInterval(t); cb(_pw2.map); }
                    }, 200);
                    setTimeout(() => clearInterval(t), 20000);
                }

                _sz_waitForMap((map) => {
                    function getZ() { return map.getZoom(); }
                    function setZ(z) {
                        const clamped = Math.max(SZ_MIN, Math.min(SZ_MAX, Math.round(parseFloat(z) * 100) / 100));
                        map.setZoom(clamped);
                    }
                    function syncUI() {
                        const z = getZ();
                        slider.value = z;
                        valueBox.value = z.toFixed(2);
                    }
                    syncUI();
                    map.on('zoom', syncUI);

                    slider.addEventListener('input', () => setZ(parseFloat(slider.value)));

                    valueBox.addEventListener('change', () => {
                        const val = parseFloat(valueBox.value);
                        if (!isNaN(val)) setZ(val);
                        syncUI();
                    });
                    valueBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') valueBox.blur(); });

                    let _szHoldTimer = null, _szHoldInterval = null;
                    function startHold(step) {
                        setZ(getZ() + step);
                        _szHoldTimer = setTimeout(() => {
                            _szHoldInterval = setInterval(() => setZ(getZ() + step), SZ_HOLD_INTERVAL);
                        }, SZ_HOLD_DELAY);
                    }
                    function stopHold() {
                        clearTimeout(_szHoldTimer);
                        clearInterval(_szHoldInterval);
                        _szHoldTimer = null;
                        _szHoldInterval = null;
                    }

                    [[plusBtn, SZ_STEP], [minusBtn, -SZ_STEP]].forEach(([btn, step]) => {
                        btn.addEventListener('mousedown', () => startHold(step));
                        btn.addEventListener('mouseup', stopHold);
                        btn.addEventListener('mouseleave', stopHold);
                        btn.addEventListener('touchstart', (e) => { e.preventDefault(); startHold(step); }, { passive: false });
                        btn.addEventListener('touchend', stopHold);
                    });

                    wrapper.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        setZ(getZ() + (e.deltaY < 0 ? SZ_WHEEL_STEP : -SZ_WHEEL_STEP));
                    }, { passive: false });
                });
            }

            function _sz_waitForEls(cb) {
                const zi = document.getElementById('zoomIn');
                const zo = document.getElementById('zoomOut');
                const cr = document.getElementById('controls-right');
                if (zi && zo && cr) { cb(zi, zo, cr); return; }
                const obs = new MutationObserver(() => {
                    const zi2 = document.getElementById('zoomIn');
                    const zo2 = document.getElementById('zoomOut');
                    const cr2 = document.getElementById('controls-right');
                    if (zi2 && zo2 && cr2) { obs.disconnect(); cb(zi2, zo2, cr2); }
                });
                obs.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => obs.disconnect(), 15000);
            }

            _sz_waitForEls(_sz_buildWidget);

            _featureStatus.smoothZoomButtons = 'ok';
            console.log('[GeoPixelcons++] \u2705 Smooth Zoom Buttons loaded');
        } catch (err) {
            _featureStatus.smoothZoomButtons = 'error';
            dbgPush(`Smooth Zoom Buttons init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Smooth Zoom Buttons' });
            console.error('[GeoPixelcons++] \u274C Smooth Zoom Buttons failed:', err);
        }
    }