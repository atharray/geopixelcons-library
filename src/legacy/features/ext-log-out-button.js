
    // ============================================================
    //  EXTENSION: Log Out Button [extLogOutButton]
    // ============================================================
    if (_settings.extLogOutButton) {
        try {
            (function _ext_logOutButton() {

    const BUTTON_ID = 'gpc-logout-btn';

    function installStyles() {
        if (document.getElementById('gpc-logout-style')) return;
        const style = document.createElement('style');
        style.id = 'gpc-logout-style';
        style.textContent = `
            #${BUTTON_ID} {
                width: 40px;
                height: 40px;
                border-radius: 9999px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                user-select: none;
                border: 1px solid var(--color-red-300, #fca5a5);
                background: var(--color-red-50, #fff1f2);
                color: var(--color-red-600, #dc2626);
                box-shadow: 0 1px 3px rgba(0,0,0,0.16);
                font-size: 18px;
                line-height: 1;
                transition: background 0.15s, border-color 0.15s, transform 0.12s;
            }
            #${BUTTON_ID}:hover {
                background: var(--color-red-100, #ffe4e6);
            }
            #${BUTTON_ID}:active {
                transform: scale(0.94);
            }
        `;
        document.head.appendChild(style);
    }

    function doLogOut() {
        const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (typeof pageWindow.logOut === 'function') {
            pageWindow.logOut();
            return;
        }
        const script = document.createElement('script');
        script.textContent = 'if(typeof logOut==="function")logOut();';
        document.head.appendChild(script);
        script.remove();
    }

    function isLoggedIn() {
        const div = document.getElementById('g_id_signin');
        return !!(div && div.classList.contains('hidden'));
    }

    function watchSignInDiv(btn) {
        const div = document.getElementById('g_id_signin');
        if (div) {
            const obs = new MutationObserver(() => {
                btn.style.display = isLoggedIn() ? '' : 'none';
            });
            obs.observe(div, { attributes: true, attributeFilter: ['class'] });
            return;
        }
        // g_id_signin not yet in DOM — watch for it
        const bodyObs = new MutationObserver(() => {
            const d = document.getElementById('g_id_signin');
            if (!d) return;
            bodyObs.disconnect();
            btn.style.display = isLoggedIn() ? '' : 'none';
            const obs = new MutationObserver(() => {
                btn.style.display = isLoggedIn() ? '' : 'none';
            });
            obs.observe(d, { attributes: true, attributeFilter: ['class'] });
        });
        bodyObs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => bodyObs.disconnect(), 30000);
    }

    function createButton(controlsRight) {
        if (document.getElementById(BUTTON_ID)) return;
        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.title = 'Log Out';
        // Exit / log-out icon (arrow leaving a door)
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
        btn.style.display = isLoggedIn() ? '' : 'none';
        btn.addEventListener('click', doLogOut);
        controlsRight.appendChild(btn);
        watchSignInDiv(btn);
    }

    function init() {
        installStyles();

        const controlsRight = document.getElementById('controls-right');
        if (controlsRight) {
            createButton(controlsRight);
            return;
        }

        const observer = new MutationObserver(() => {
            const container = document.getElementById('controls-right');
            if (!container) return;
            observer.disconnect();
            createButton(container);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 15000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

            })();
            _featureStatus.extLogOutButton = 'ok';
            console.log('[GeoPixelcons++] ✅ Log Out Button loaded');
        } catch (err) {
            _featureStatus.extLogOutButton = 'error';
            dbgPush(`Log Out Button init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Log Out Button' });
            console.error('[GeoPixelcons++] ❌ Log Out Button failed:', err);
        }
    }
