
    // ============================================================
    //  SETTING: Start in Shift Lock [startShiftLock]
    // ============================================================
    if (_settings.startShiftLock) {
        try {
            const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

            // `shiftDown` is a closure variable inside the site's script — NOT a
            // window property (window.shiftDown is always undefined). We cannot read
            // or write it directly. Instead we must go through toggleShiftDown() to
            // actually flip it. We wrap toggleShiftDown first so we can track the
            // current lock state ourselves, then use that in the FindRandomArt patch.
            let _lockOn = false;

            if (typeof _pw.toggleShiftDown === 'function') {
                const _origToggle = _pw.toggleShiftDown;
                _pw.toggleShiftDown = function () {
                    _lockOn = !_lockOn;
                    dbgPush('toggleShiftDown: _lockOn \u2192 ' + _lockOn);
                    return _origToggle.apply(this, arguments);
                };
            }

            // Enable lock on startup (goes through our wrapper, so _lockOn = true).
            if (typeof _pw.toggleShiftDown === 'function') {
                _pw.toggleShiftDown();
                console.log('[GeoPixelcons++] \u2705 Shift Lock enabled on startup');
                dbgPush('startShiftLock: enabled on startup, _lockOn=' + _lockOn);
            }

            // Patch FindRandomArt: temporarily call toggleShiftDown() to flip the
            // closure shiftDown to false before the call, then restore it after.
            if (typeof _pw.FindRandomArt === 'function') {
                const _origFRA = _pw.FindRandomArt;
                _pw.FindRandomArt = async function () {
                    const _wasLocked = _lockOn;
                    if (_wasLocked && typeof _pw.toggleShiftDown === 'function') {
                        _pw.toggleShiftDown(); // _lockOn=false, closure shiftDown=false
                    }
                    try {
                        return await _origFRA.apply(this, arguments);
                    } finally {
                        if (_wasLocked && typeof _pw.toggleShiftDown === 'function') {
                            _pw.toggleShiftDown(); // _lockOn=true, closure shiftDown=true
                        }
                    }
                };
                dbgPush('startShiftLock: FindRandomArt patched');
            }

            _featureStatus.startShiftLock = 'ok';
        } catch (err) {
            _featureStatus.startShiftLock = 'error';
            dbgPush(`Start in Shift Lock init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Start in Shift Lock' });
            console.error('[GeoPixelcons++] \u274C Start in Shift Lock failed:', err);
        }
    }