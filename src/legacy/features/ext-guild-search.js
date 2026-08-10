
    // ============================================================
    //  EXTENSION: Guild Search Button [extGuildSearch]
    // ============================================================
    if (_settings.extGuildSearch) {
        try {
            (function _ext_guildSearch() {

    const BUTTON_ID = 'gpc-guild-search-btn';

    function installStyles() {
        if (document.getElementById('gpc-guild-search-style')) return;
        const style = document.createElement('style');
        style.id = 'gpc-guild-search-style';
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
                background: var(--color-white, #fff);
                color: var(--color-gray-700, #374151);
                border: none;
                box-shadow: 0 1px 3px rgba(0,0,0,0.16);
                font-size: 18px;
                line-height: 1;
                transition: background 0.15s;
            }
            #${BUTTON_ID}:hover {
                background: var(--color-gray-100, #f3f4f6);
            }
            .dark #${BUTTON_ID} {
                background: var(--color-gray-700, #374151);
                color: var(--color-gray-200, #e5e7eb);
            }
            .dark #${BUTTON_ID}:hover {
                background: var(--color-gray-600, #4b5563);
            }
        `;
        document.head.appendChild(style);
    }

    function doGuildSearch() {
        const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (typeof pageWindow.toggleGuildSearchModal === 'function') {
            pageWindow.toggleGuildSearchModal();
            return;
        }
        const script = document.createElement('script');
        script.textContent = 'if(typeof toggleGuildSearchModal==="function")toggleGuildSearchModal();';
        document.head.appendChild(script);
        script.remove();
    }

    function createButton(parent) {
        if (document.getElementById(BUTTON_ID)) return;
        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.className = 'w-10 h-10 rounded-full';
        btn.title = 'Search Guilds';
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
        btn.addEventListener('click', doGuildSearch);

        const guildBtn = document.getElementById('guildMenuBtn');
        if (guildBtn && guildBtn.parentElement) {
            guildBtn.parentElement.insertBefore(btn, guildBtn.nextSibling);
        } else {
            parent.appendChild(btn);
        }
    }

    function init() {
        installStyles();

        const guildBtn = document.getElementById('guildMenuBtn');
        if (guildBtn) {
            createButton(guildBtn.parentElement);
            return;
        }

        const observer = new MutationObserver(() => {
            const gb = document.getElementById('guildMenuBtn');
            if (!gb) return;
            observer.disconnect();
            createButton(gb.parentElement);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

            })();
            _featureStatus.extGuildSearch = 'ok';
            console.log('[GeoPixelcons++] ✅ Guild Search button loaded');
        } catch (err) {
            _featureStatus.extGuildSearch = 'error';
            dbgPush(`Guild Search init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Guild Search' });
            console.error('[GeoPixelcons++] ❌ Guild Search button failed:', err);
        }
    }
