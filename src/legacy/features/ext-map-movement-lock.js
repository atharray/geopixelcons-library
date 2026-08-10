
    // ============================================================
    //  EXTENSION: Map Movement Lock [extMapMovementLock]
    // ============================================================
    if (_settings.extMapMovementLock) {
        try {
            (function _ext_mapMovementLock() {

    const LOCK_STORAGE_KEY = 'gpc-map-movement-locked';
    const BUTTON_ID = 'gpc-map-movement-lock-btn';

    function installMapLockBridge() {
        const script = document.createElement('script');
        script.textContent = `
(function(){
if(window.__gpcMapMovementLockBridge)return;
window.__gpcMapMovementLockBridge=true;
var storageKey='${LOCK_STORAGE_KEY}';
var handlerNames=['dragPan','scrollZoom','boxZoom','doubleClickZoom','touchZoomRotate','keyboard','dragRotate','touchPitch'];
var movementMethods=['panBy','panTo','zoomIn','zoomOut','zoomTo','setZoom','setCenter','easeTo','flyTo','jumpTo','fitBounds','fitScreenCoordinates','rotateTo','resetNorth','snapToNorth','setBearing','setPitch'];
var state={locked:localStorage.getItem(storageKey)==='1',snapshotTaken:false,handlerWasEnabled:{}};
window.__gpcMapMovementLocked=state.locked;
function getMap(){try{return typeof map!=='undefined'&&map&&typeof map.getCanvas==='function'?map:null;}catch(e){return null;}}
function applyPageScrollLock(){
    var root=document.documentElement;
    var body=document.body;
    if(root)root.classList.toggle('gpc-map-movement-page-locked',state.locked);
    if(body)body.classList.toggle('gpc-map-movement-page-locked',state.locked);
}
function installGuards(m){
    if(!m||m.__gpcMapMovementLockGuarded)return;
    Object.defineProperty(m,'__gpcMapMovementLockGuarded',{value:true,configurable:true});
    movementMethods.forEach(function(name){
        if(typeof m[name]!=='function'||m[name].__gpcMapMovementLockGuarded)return;
        var original=m[name];
        var guarded=function(){
            if(window.__gpcMapMovementLocked)return this;
            return original.apply(this,arguments);
        };
        Object.defineProperty(guarded,'__gpcMapMovementLockGuarded',{value:true,configurable:true});
        Object.defineProperty(guarded,'__gpcMapMovementLockOriginal',{value:original,configurable:true});
        m[name]=guarded;
    });
    handlerNames.forEach(function(name){
        var handler=m[name];
        if(!handler||typeof handler.enable!=='function'||handler.__gpcMapMovementLockGuarded)return;
        var originalEnable=handler.enable;
        var guardedEnable=function(){
            if(window.__gpcMapMovementLocked)return this;
            return originalEnable.apply(this,arguments);
        };
        Object.defineProperty(handler,'__gpcMapMovementLockGuarded',{value:true,configurable:true});
        Object.defineProperty(handler,'__gpcMapMovementLockOriginalEnable',{value:originalEnable,configurable:true});
        handler.enable=guardedEnable;
    });
}
function disableHandlers(m){
    if(!state.snapshotTaken){
        state.handlerWasEnabled={};
        handlerNames.forEach(function(name){
            var handler=m[name];
            state.handlerWasEnabled[name]=!!(handler&&typeof handler.isEnabled==='function'&&handler.isEnabled());
        });
        state.snapshotTaken=true;
    }
    handlerNames.forEach(function(name){
        var handler=m[name];
        if(handler&&typeof handler.disable==='function')handler.disable();
    });
    if(typeof m.stop==='function')m.stop();
}
function restoreHandlers(m){
    if(!state.snapshotTaken)return;
    handlerNames.forEach(function(name){
        var handler=m[name];
        if(!state.handlerWasEnabled[name]||!handler)return;
        var originalEnable=handler.__gpcMapMovementLockOriginalEnable||handler.enable;
        if(typeof originalEnable==='function')originalEnable.apply(handler);
    });
    state.handlerWasEnabled={};
    state.snapshotTaken=false;
}
function applyLockState(){
    applyPageScrollLock();
    var m=getMap();
    if(!m)return false;
    installGuards(m);
    if(state.locked)disableHandlers(m);
    else restoreHandlers(m);
    return true;
}
window.__gpcGetMapMovementLocked=function(){return state.locked;};
window.__gpcSetMapMovementLocked=function(locked){
    state.locked=!!locked;
    window.__gpcMapMovementLocked=state.locked;
    localStorage.setItem(storageKey,state.locked?'1':'0');
    applyLockState();
    document.dispatchEvent(new CustomEvent('gpc:mapMovementLockChanged',{detail:{locked:state.locked}}));
    return state.locked;
};
window.__gpcToggleMapMovementLocked=function(){return window.__gpcSetMapMovementLocked(!state.locked);};
var wait=setInterval(function(){if(applyLockState())clearInterval(wait);},250);
setTimeout(function(){clearInterval(wait);},30000);
applyLockState();
})();`;
        document.head.appendChild(script);
        script.remove();
    }

    function installStyles() {
        if (document.getElementById('gpc-map-movement-lock-style')) return;
        const style = document.createElement('style');
        style.id = 'gpc-map-movement-lock-style';
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
                border: 1px solid var(--color-gray-200, #e5e7eb);
                background: var(--color-gray-100, #fff);
                color: var(--color-gray-700, #374151);
                box-shadow: 0 1px 3px rgba(0,0,0,0.16);
                font-size: 18px;
                line-height: 1;
                transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.15s;
            }
            #${BUTTON_ID}:hover {
                background: var(--color-gray-200, #f3f4f6);
            }
            #${BUTTON_ID}[data-locked="true"] {
                background: var(--color-green-100, #dcfce7);
                color: var(--color-green-900, #14532d);
                border-color: var(--color-green-500, #22c55e);
            }
            #${BUTTON_ID}[data-locked="true"]:hover {
                background: var(--color-green-200, #bbf7d0);
            }
            #${BUTTON_ID}:active {
                transform: scale(0.96);
            }
            html.gpc-map-movement-page-locked,
            body.gpc-map-movement-page-locked {
                width: 100% !important;
                height: 100% !important;
                max-width: 100vw !important;
                max-height: 100dvh !important;
                overflow: hidden !important;
                overscroll-behavior: none !important;
            }
            html.gpc-map-movement-page-locked {
                scrollbar-width: none;
            }
            html.gpc-map-movement-page-locked::-webkit-scrollbar,
            body.gpc-map-movement-page-locked::-webkit-scrollbar {
                display: none;
            }
        `;
        document.head.appendChild(style);
    }

    function getLocked() {
        const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (typeof pageWindow.__gpcGetMapMovementLocked === 'function') {
            return !!pageWindow.__gpcGetMapMovementLocked();
        }
        return localStorage.getItem(LOCK_STORAGE_KEY) === '1';
    }

    function setLocked(locked) {
        const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (typeof pageWindow.__gpcSetMapMovementLocked === 'function') {
            return !!pageWindow.__gpcSetMapMovementLocked(locked);
        }
        localStorage.setItem(LOCK_STORAGE_KEY, locked ? '1' : '0');
        return locked;
    }

    function renderButton(btn) {
        const locked = getLocked();
        btn.dataset.locked = locked ? 'true' : 'false';
        btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
        btn.textContent = locked ? '🔒' : '🔓';
        const kbLabel = getKeybindLabel();
        btn.title = locked ? `Map movement locked – click or press ${kbLabel} to unlock` : `Lock map movement (${kbLabel})`;
        btn.setAttribute('aria-label', locked ? 'Unlock map movement' : 'Lock map movement');
    }

    function createButton(controlsRight) {
        let btn = document.getElementById(BUTTON_ID);
        if (btn) return btn;
        btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.addEventListener('click', () => {
            setLocked(!getLocked());
            renderButton(btn);
        });
        document.addEventListener('gpc:mapMovementLockChanged', () => renderButton(btn));
        renderButton(btn);

        const zoomIn = document.getElementById('zoomIn');
        if (zoomIn && zoomIn.parentElement === controlsRight) controlsRight.insertBefore(btn, zoomIn);
        else controlsRight.prepend(btn);
        return btn;
    }

    // Reads the map-lock keybind from settings, falling back to Ctrl+Shift+L.
    function getMapLockKeybind() {
        try {
            const s = JSON.parse(localStorage.getItem('geopixelcons_settings') || '{}');
            const kb = s.keybinds && s.keybinds.mapMovementLock;
            if (kb && typeof kb.key === 'string' && kb.key.length > 0) return kb;
        } catch (_) {}
        return { key: 'L', ctrl: true, shift: true };
    }

    function getKeybindLabel() {
        const kb = getMapLockKeybind();
        const parts = [];
        if (kb.ctrl) parts.push('Ctrl');
        if (kb.shift) parts.push('Shift');
        parts.push((kb.key || 'L').toUpperCase());
        return parts.join('+');
    }

    // Toggles the lock. Registered in the capture phase with stopImmediatePropagation
    // so the site's keybind handler never also fires on this combo.
    function installKeyboardShortcut() {
        const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (pageWindow.__gpcMapLockShortcutInstalled) return;
        pageWindow.__gpcMapLockShortcutInstalled = true;
        document.addEventListener('keydown', (e) => {
            const kb = getMapLockKeybind();
            if (e.altKey || e.metaKey) return;
            if (kb.ctrl !== e.ctrlKey) return;
            if (kb.shift !== e.shiftKey) return;
            if (e.key.toUpperCase() !== (kb.key || 'L').toUpperCase()) return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            setLocked(!getLocked());
            const btn = document.getElementById(BUTTON_ID);
            if (btn) renderButton(btn);
        }, true);
    }

    function init() {
        installMapLockBridge();
        installStyles();
        installKeyboardShortcut();

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
            _featureStatus.extMapMovementLock = 'ok';
            console.log('[GeoPixelcons++] ✅ Map Movement Lock loaded');
        } catch (err) {
            _featureStatus.extMapMovementLock = 'error';
            dbgPush(`Map Movement Lock init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Map Movement Lock' });
            console.error('[GeoPixelcons++] ❌ Map Movement Lock failed:', err);
        }
    }