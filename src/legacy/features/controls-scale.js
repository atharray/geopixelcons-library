
    // ============================================================
    //  UI: CONTROLS SCALE
    // ============================================================
    // Scales both native control clusters as one visual preference. This
    // intentionally uses the individual CSS `scale` property instead of
    // wrapping or reparenting the clusters: GeoPixels and other extensions
    // keep their exact DOM anchors, listeners, dropdown positioning, and
    // late-injected controls.
    (function _init_controlsScale() {
        const MIN = 75;
        const MAX = 125;
        const STEP = 5;
        const DEFAULT = 100;
        const SETTING_KEY = 'controlsUiScale';
        const originals = new WeakMap();
        let pendingCommitFrame = 0;
        let popover = null;
        let input = null;
        let value = null;
        let leftContainer = null;
        let rightContainer = null;

        const clamp = (raw) => {
            const numeric = Number(raw);
            if (!Number.isFinite(numeric)) return DEFAULT;
            const stepped = Math.round(numeric / STEP) * STEP;
            return Math.max(MIN, Math.min(MAX, stepped));
        };
        const read = () => clamp(_settings[SETTING_KEY]);
        const sync = () => {
            const percent = read();
            if (input) input.value = String(percent);
            // `textContent =` replaces a child text node even when its value
            // is unchanged. Avoid creating a self-sustaining childList loop
            // with the late-control observer once this popover is open.
            const label = `${percent}%`;
            if (value && value.textContent !== label) value.textContent = label;
        };
        const remember = (element) => {
            if (!originals.has(element)) {
                originals.set(element, {
                    scale: element.style.scale,
                    transformOrigin: element.style.transformOrigin,
                });
            }
            return originals.get(element);
        };
        const applyTo = (element, percent, origin) => {
            if (!element) return;
            const original = remember(element);
            if (percent === DEFAULT) {
                element.style.scale = original.scale;
                element.style.transformOrigin = original.transformOrigin;
                delete element.dataset.gpcControlsUiScale;
                return;
            }
            element.style.scale = String(percent / 100);
            element.style.transformOrigin = origin;
            element.dataset.gpcControlsUiScale = String(percent);
        };
        const apply = (raw) => {
            const percent = clamp(raw);
            _settings[SETTING_KEY] = percent;
            leftContainer = document.getElementById('controls-left');
            rightContainer = document.getElementById('controls-right');
            applyTo(leftContainer, percent, 'top left');
            applyTo(rightContainer, percent, 'top right');
            sync();
        };
        const persist = () => saveSettings(_settings);
        const close = () => {
            if (!popover) return;
            popover.hidden = true;
        };
        const refreshPopoverTheme = () => {
            if (!popover) return;
            const dark = isDarkMode();
            popover.style.borderColor = dark ? '#45475a' : '#d1d5db';
            popover.style.background = dark ? '#1e1e2e' : '#ffffff';
            popover.style.color = dark ? '#f5f5f5' : '#111827';
            const row = popover.querySelector('.gpc-controls-scale-label-row');
            if (row) row.style.color = dark ? '#cdd6f4' : '#334155';
            if (value) value.style.color = dark ? '#a6adc8' : '#64748b';
            if (input) input.style.accentColor = dark ? '#89b4fa' : '#2563eb';
        };
        const ensurePopover = () => {
            if (popover) return popover;
            const dark = isDarkMode();
            popover = document.createElement('div');
            popover.id = 'gpc-controls-scale-popover';
            popover.hidden = true;
            popover.setAttribute('role', 'dialog');
            popover.setAttribute('aria-label', 'Controls scale');
            popover.style.cssText = [
                'position:fixed', 'top:58px', 'left:12px', 'z-index:100001',
                'width:224px', 'box-sizing:border-box', 'padding:10px', 'border-radius:10px',
                `border:1px solid ${dark ? '#45475a' : '#d1d5db'}`,
                `background:${dark ? '#1e1e2e' : '#ffffff'}`,
                `color:${dark ? '#f5f5f5' : '#111827'}`,
                'box-shadow:0 8px 24px rgba(0,0,0,.28)', 'font-family:system-ui,-apple-system,sans-serif',
            ].join(';');

            const row = document.createElement('div');
            row.className = 'gpc-controls-scale-label-row';
            row.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:700;color:${dark ? '#cdd6f4' : '#334155'};`;
            const label = document.createElement('label');
            label.htmlFor = 'gpc-controls-ui-scale';
            label.textContent = 'Controls scale';
            value = document.createElement('output');
            value.id = 'gpc-controls-ui-scale-value';
            value.htmlFor = 'gpc-controls-ui-scale';
            value.style.cssText = `font-variant-numeric:tabular-nums;color:${dark ? '#a6adc8' : '#64748b'};`;
            row.append(label, value);

            input = document.createElement('input');
            input.id = 'gpc-controls-ui-scale';
            input.type = 'range';
            input.min = String(MIN);
            input.max = String(MAX);
            input.step = String(STEP);
            input.style.cssText = `display:block;width:100%;margin:8px 0 0;accent-color:${dark ? '#89b4fa' : '#2563eb'};`;
            input.addEventListener('input', () => {
                const label = `${clamp(input.value)}%`;
                if (value && value.textContent !== label) value.textContent = label;
            });
            input.addEventListener('change', () => {
                const next = clamp(input.value);
                input.value = String(next);
                if (pendingCommitFrame) cancelAnimationFrame(pendingCommitFrame);
                pendingCommitFrame = requestAnimationFrame(() => {
                    pendingCommitFrame = 0;
                    apply(next);
                    persist();
                });
            });
            popover.append(row, input);
            document.body.appendChild(popover);
            document.addEventListener('pointerdown', (event) => {
                if (!popover.hidden && !popover.contains(event.target)) close();
            }, true);
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') close();
            });
            return popover;
        };
        const open = () => {
            const panel = ensurePopover();
            refreshPopoverTheme();
            sync();
            panel.hidden = false;
        };
        const mount = () => {
            apply(read());
            // Scaling a container automatically covers buttons injected inside
            // it. Only reconcile if GeoPixels itself replaces a whole native
            // cluster; reacting to every unrelated child mutation would turn
            // busy UI updates elsewhere on the page into redundant work.
            const observer = new MutationObserver(() => {
                const nextLeft = document.getElementById('controls-left');
                const nextRight = document.getElementById('controls-right');
                if (nextLeft === leftContainer && nextRight === rightContainer) return;
                apply(read());
            });
            observer.observe(document.body, { childList: true, subtree: true });
        };

        gpcControlsScale = Object.freeze({ open, close, apply, getScale: read });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mount, { once: true });
        } else {
            mount();
        }
    })();
