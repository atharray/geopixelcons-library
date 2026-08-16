
    // ============================================================
    //  FEATURE: Bulk Purchase Colors [bulkPurchaseColors]
    // ============================================================
    // gppBulkPurchaseOpenModal — true top-level (shared build.js scope)
    // reference to openBulkModal below, kept null unless this feature is
    // enabled. openBulkModal() itself is declared INSIDE this feature's own
    // _init_bulkPurchaseColors() IIFE (deliberately encapsulated, like every
    // other feature file), so it is NOT reachable as a bare identifier from
    // other files — a cross-feature caller (Ghost++'s "Buy all colours"
    // button, gpp-palette.js) must go through this reference instead of
    // `typeof openBulkModal`, which would always read 'undefined' regardless
    // of whether this feature is actually enabled.
    let gppBulkPurchaseOpenModal = null;
    // Same cross-feature-reachability reasoning as gppBulkPurchaseOpenModal
    // above — Ghost++'s "Buy all colors" button (gpp-palette.js) goes
    // through this instead of the Bulk Purchase Preview modal, per explicit
    // product decision to mirror this feature's own legacy native-ghost-menu
    // flow (see openProfilePanelWithColors / handlePurchaseUnowned below).
    let gppBulkPurchaseOpenProfilePanel = null;
    if (_settings.bulkPurchaseColors) {
        try {
            (function _init_bulkPurchaseColors() {

    // ─── Constants ────────────────────────────────────────────────────────────────
    const PIXELS_PER_COLOR = 100; // Informational cost shown in the preview
    const BULK_PURCHASE_WARNING_THRESHOLD = 50;
    const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // ─── Dark mode detection (geopixels++ compatibility) ──────────────────────────
    function isDarkMode() {
        return getComputedStyle(document.documentElement).colorScheme === 'dark';
    }

    function t() {
        const dark = isDarkMode();
        return {
            panelBg:      dark ? '#1e2939' : '#fff',
            text:         dark ? '#f3f4f6' : '#1f2937',
            textMed:      dark ? '#e5e7eb' : '#374151',
            textSec:      dark ? '#d1d5db' : '#6b7280',
            textMuted:    dark ? '#99a1af' : '#9ca3af',
            textOwned:    dark ? '#6a7282' : '#b0b0b0',
            border:       dark ? '#364153' : '#e5e7eb',
            borderLight:  dark ? '#364153' : '#ececec',
            inputBorder:  dark ? '#4a5565' : '#d1d5db',
            rowBg:        dark ? '#101828' : '#fff',
            rowOwnedBg:   dark ? '#1e2939' : '#f3f4f6',
            sepBg:        dark ? '#101828' : '#f9fafb',
            progressBg:   dark ? '#364153' : '#e5e7eb',
            cancelBg:     dark ? '#364153' : '#e5e7eb',
            cancelText:   dark ? '#e5e7eb' : '#374151',
            closeBg:      dark ? '#364153' : '#f3f4f6',
            closeText:    dark ? '#d1d5db' : '#6b7280',
            queueBg:      dark ? '#101828' : '#fff',
            queueBorder:  dark ? '#364153' : '#e5e7eb',
        };
    }

    // ─── Credential access ────────────────────────────────────────────────────────
    //
    // The page declares `tokenUser`, `userID`, and `subject` with `let` in
    // index121.js. Top-level `let` is NOT a property of `window`, and
    // _pw.eval() cannot reach them either (different script scope).
    //
    // Solution: inject a <script> tag that registers a live getter on
    // window._gpAuth from within the page's own global scope.
    //
    (function installAuthBridge() {
        const s = document.createElement('script');
        s.textContent = `
            Object.defineProperty(window, '_gpAuth', {
                configurable: true,
                get: function() {
                    return {
                        token:   typeof tokenUser !== 'undefined' ? tokenUser : null,
                        userId:  typeof userID   !== 'undefined' ? userID   : null,
                        subject: typeof subject  !== 'undefined' ? subject  : null,
                    };
                }
            });
        `;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
    })();

    /** Return auth credentials, or null if the user is not yet logged in. */
    function getAuth() {
        const a = _pw._gpAuth;
        const token   = (a && a.token)  || localStorage.getItem('tokenUser');
        const userId  = (a && a.userId != null) ? a.userId : parseInt(localStorage.getItem('userID') || '', 10);
        const subject = (a && a.subject) || '';
        if (!token || isNaN(userId)) return null;
        return { token, userId, subject };
    }

    // ─── Color sanitization ───────────────────────────────────────────────────────

    /**
     * Normalise a single raw token to an uppercase "#RRGGBB" string.
     * Returns null for anything that cannot be interpreted as a valid RGB colour.
     *
     * Accepted formats:
     *   - Hex with hash:    #FF0000
     *   - Hex without hash: FF0000
     *   - 3-digit shorthand:#F00 / F00
     *   - Decimal integer:  16711680
     */
    function sanitizeToken(token) {
        // Strip surrounding quotes that may appear in copy-pasted strings
        token = (token || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
        if (!token) return null;

        // Pure decimal integer (digits only, no a-f)
        if (/^\d+$/.test(token)) {
            const n = parseInt(token, 10);
            if (n < 0 || n > 0xFFFFFF) return null;
            return '#' + n.toString(16).toUpperCase().padStart(6, '0');
        }

        const stripped = token.replace(/^#/, '');

        // 6-digit hex
        if (/^[0-9A-Fa-f]{6}$/.test(stripped)) {
            return '#' + stripped.toUpperCase();
        }

        // 3-digit shorthand → expand to 6-digit
        if (/^[0-9A-Fa-f]{3}$/.test(stripped)) {
            const expanded = stripped.split('').map(c => c + c).join('');
            return '#' + expanded.toUpperCase();
        }

        return null;
    }

    /**
     * Split raw textarea input (comma-, space-, or newline-separated) into
     * sanitized, deduplicated colour strings. Returns { valid, invalid }.
     */
    function parseColorInput(raw) {
        const tokens = (raw || '').split(/[\s,\n]+/).filter(Boolean);
        const seen = new Set();
        const valid = [];
        const invalid = [];

        for (const t of tokens) {
            const c = sanitizeToken(t);
            if (c) {
                if (!seen.has(c)) { seen.add(c); valid.push(c); }
            } else {
                invalid.push(t);
            }
        }

        return { valid, invalid };
    }

    // ─── Owned-colour helpers ─────────────────────────────────────────────────────

    /**
     * Build a Set of uppercase "#RRGGBB" hex strings from window.Colors,
     * which the site keeps in sync with the authenticated user's colour list.
     */
    function buildOwnedSet() {
        const set = new Set();
        // `Colors` is a top-level `let` in the page script. With @grant none it is
        // accessible as a bare name in most environments; use try/catch as guard.
        let colors;
        try { colors = Colors; } catch (_) { colors = window.Colors; }
        if (Array.isArray(colors)) {
            colors.forEach(h => {
                if (h && typeof h === 'string') set.add(h.toUpperCase());
            });
        }
        return set;
    }

    /**
     * Fetch a fresh copy of the user's data from the server and return a Set
     * of owned hex strings. Falls back to window.Colors on any error.
     */
    async function fetchOwnedHexSet() {
        const auth = getAuth();
        if (!auth) {
            console.warn('[BulkPurchase] Credentials not yet captured, falling back to local Colors.');
            return buildOwnedSet();
        }
        try {
            const resp = await window.fetch('/GetUserData', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: auth.userId, token: auth.token }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            const set = new Set();
            const raw = data.colors;

            // Server returns a comma-separated decimal string, e.g. "16777215, 0, 65280"
            if (typeof raw === 'string') {
                raw.split(',').forEach(s => {
                    const n = parseInt(s.trim(), 10);
                    // n >= 0 deliberately includes 0 (== #000000)
                    if (!isNaN(n) && n >= 0 && n <= 0xFFFFFF) {
                        set.add('#' + n.toString(16).toUpperCase().padStart(6, '0'));
                    }
                });
            } else if (Array.isArray(raw)) {
                raw.forEach(n => {
                    if (typeof n === 'number' && n >= 0 && n <= 0xFFFFFF) {
                        set.add('#' + n.toString(16).toUpperCase().padStart(6, '0'));
                    }
                });
            }

            // Merge local Colors as belt-and-suspenders
            buildOwnedSet().forEach(h => set.add(h));
            return set;
        } catch (err) {
            console.warn('[BulkPurchase] GetUserData failed, falling back to local Colors:', err);
            return buildOwnedSet();
        }
    }

    // ─── Local hex → integer helper ───────────────────────────────────────────────

    /** Convert "#RRGGBB" to its integer equivalent. */
    function hexToInt(hex) {
        return parseInt(hex.replace(/^#/, ''), 16);
    }

    // Ghost++ owns the native #ghostColorPalette DOM while it has the overlay
    // slot (see gpp-native-shim.js's own header comment) -- it is never
    // (re)populated for whatever template Ghost++ has focused, so the DOM
    // reader below sees empty/stale swatches for any Ghost++ user. That
    // matched real reports exactly: "Add Ghost Template Colors" giving
    // "No ghost palette colors found" with a template genuinely loaded, and
    // Ghost++'s own "Buy all colors" button (gpp-palette.js, which funnels
    // into this file's handlePurchaseUnowned) showing some colors with no
    // pixel count at all -- only the ones that happened to still be present
    // in a stale/partial native DOM got one. gppState/gppCreateCore are
    // unconditionally defined at the top level of the shared build (see
    // gpp-runtime.js/gpp-core.js, neither gated behind _settings.ghostPlusPlus),
    // reachable here directly -- guarded by typeof, matching this codebase's
    // existing convention for optional cross-feature dependencies (see
    // ghost-palette-search.js's own gppApplySelectedColorToFocusedTemplate check).
    //
    // template.counts[index] is precomputed at ingest time (gpp-core.js's
    // indexRgba/indexRgbaAsync) -- no per-pixel iteration needed for totals.
    // template.scanSummary.perColour (gpp-scan.js's own documented contract)
    // gives per-colour correct/total once a scan has run; hasProgress is
    // false (matching the DOM reader's own "no progress line found"
    // fallback) until then.
    function getGhostColorStatsFromTemplate() {
        if (typeof gppState === 'undefined' || typeof gppState.getFocusedTemplate !== 'function') return null;
        const template = gppState.getFocusedTemplate();
        if (!template || !template.palette || !template.counts) return null;
        const core = gppCreateCore();
        const perColour = template.scanSummary && template.scanSummary.perColour;
        const byIndex = perColour ? new Map(perColour.map(entry => [entry.index, entry])) : null;
        const stats = new Map();
        for (let index = 0; index < template.palette.length; index++) {
            const total = template.counts[index] || 0;
            if (!total) continue; // matches the DOM reader, which only ever sees swatches for colours actually used
            const hex = core.packedToHex(template.palette[index]);
            const scanned = byIndex ? byIndex.get(index) : null;
            const completed = scanned ? scanned.correct : 0;
            const hasProgress = !!scanned;
            const remaining = Math.max(0, total - completed);
            stats.set(hex, {
                completed, total, remaining,
                remainingPercent: total > 0 ? (remaining / total) * 100 : 0,
                percent: total > 0 ? (completed / total) * 100 : 0,
                hasProgress,
            });
        }
        return stats;
    }

    // ─── Ghost palette DOM reader ─────────────────────────────────────────────────

    /**
     * Extract unique hex colours from the rendered #ghostColorPalette buttons.
     *
     * Two strategies, tried in order per-button:
     *   1. data-color-rgba="rgba(R,G,B,1)"  — set by ghost22.js, always present
     *   2. title first-line                 — also set by ghost22.js, may vary in format
     *
     * Using `data-color-rgba` as primary avoids any dependency on the title format,
     * which has changed across script versions (2-line, 3-line, etc.).
     */
    function getGhostColorsFromDOM() {
        const templateStats = getGhostColorStatsFromTemplate();
        if (templateStats) {
            return Array.from(templateStats.entries())
                .sort((a, b) => b[1].total - a[1].total)
                .map(([hex]) => hex);
        }
        const swatches = document.querySelectorAll('#ghostColorPalette button[data-color-rgba], #ghostColorPalette button[title]');
        const seen = new Set();
        const colors = []; // { hex, count }

        swatches.forEach(btn => {
            let hex = null;
            let count = 0;

            // Strategy 1: parse data-color-rgba="rgba(R,G,B,1)"
            const rgba = btn.dataset.colorRgba;
            if (rgba) {
                const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (m) {
                    hex = '#' +
                        parseInt(m[1]).toString(16).toUpperCase().padStart(2, '0') +
                        parseInt(m[2]).toString(16).toUpperCase().padStart(2, '0') +
                        parseInt(m[3]).toString(16).toUpperCase().padStart(2, '0');
                }
            }

            // Strategy 2: title first line (e.g. "#D5BFB2" or "#D5BFB2\n42 pixels")
            if (!hex && btn.title) {
                const candidate = btn.title.split(/[\r\n]+/)[0].trim().toUpperCase();
                if (/^#[0-9A-F]{6}$/.test(candidate)) hex = candidate;
            }

            // Parse pixel count from title second line (e.g. "42 pixels")
            if (btn.title) {
                const lines = btn.title.split(/[\r\n]+/);
                for (let i = 1; i < lines.length; i++) {
                    const cm = lines[i].match(/(\d+)\s*pixel/i);
                    if (cm) { count = parseInt(cm[1], 10); break; }
                }
            }

            if (hex && /^#[0-9A-F]{6}$/.test(hex) && !seen.has(hex)) {
                seen.add(hex);
                colors.push({ hex, count });
            }
        });

        // Sort by pixel count descending (most used first)
        colors.sort((a, b) => b.count - a.count);

        return colors.map(c => c.hex);
    }

    /** Returns a Map of hex → pixel count from the ghost template palette DOM. */
    function getGhostPixelCounts() {
        const templateStats = getGhostColorStatsFromTemplate();
        if (templateStats) {
            const counts = new Map();
            templateStats.forEach((stat, hex) => counts.set(hex, stat.total));
            return counts;
        }
        const swatches = document.querySelectorAll('#ghostColorPalette button[data-color-rgba], #ghostColorPalette button[title]');
        const counts = new Map();

        swatches.forEach(btn => {
            let hex = null;
            let count = 0;

            const rgba = btn.dataset.colorRgba;
            if (rgba) {
                const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (m) {
                    hex = '#' +
                        parseInt(m[1]).toString(16).toUpperCase().padStart(2, '0') +
                        parseInt(m[2]).toString(16).toUpperCase().padStart(2, '0') +
                        parseInt(m[3]).toString(16).toUpperCase().padStart(2, '0');
                }
            }

            if (!hex && btn.title) {
                const candidate = btn.title.split(/[\r\n]+/)[0].trim().toUpperCase();
                if (/^#[0-9A-F]{6}$/.test(candidate)) hex = candidate;
            }

            if (btn.title) {
                const lines = btn.title.split(/[\r\n]+/);
                for (let i = 1; i < lines.length; i++) {
                    const cm = lines[i].match(/(\d+)\s*pixel/i);
                    if (cm) { count = parseInt(cm[1], 10); break; }
                }
            }

            if (hex && /^#[0-9A-F]{6}$/.test(hex)) {
                counts.set(hex, count);
            }
        });

        return counts;
    }

    /** Returns hex → ghost-template progress stats parsed from the rendered ghost palette. */
    function getGhostColorStats() {
        const templateStats = getGhostColorStatsFromTemplate();
        if (templateStats) return templateStats;
        const swatches = document.querySelectorAll('#ghostColorPalette button[data-color-rgba], #ghostColorPalette button[title]');
        const stats = new Map();

        swatches.forEach(btn => {
            let hex = null;

            const rgba = btn.dataset.colorRgba;
            if (rgba) {
                const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (m) {
                    hex = '#' +
                        parseInt(m[1]).toString(16).toUpperCase().padStart(2, '0') +
                        parseInt(m[2]).toString(16).toUpperCase().padStart(2, '0') +
                        parseInt(m[3]).toString(16).toUpperCase().padStart(2, '0');
                }
            }

            const lines = (btn.title || '').split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
            if (!hex && /^#[0-9A-F]{6}$/.test(lines[0] || '')) hex = lines[0].toUpperCase();
            if (!hex || !/^#[0-9A-F]{6}$/.test(hex)) return;

            let completed = 0;
            let total = 0;
            let hasProgress = false;
            const progressMatch = (lines[1] || '').match(/^([\d,]+)\s*\/\s*([\d,]+)/);
            if (progressMatch) {
                hasProgress = true;
                completed = parseInt(progressMatch[1].replace(/,/g, ''), 10);
                total     = parseInt(progressMatch[2].replace(/,/g, ''), 10);
            } else {
                for (let i = 1; i < lines.length; i++) {
                    const countMatch = lines[i].match(/([\d,]+)\s*pixel/i);
                    if (countMatch) { total = parseInt(countMatch[1].replace(/,/g, ''), 10); break; }
                }
            }

            const remaining = Math.max(0, total - completed);
            const remainingPercent = total > 0 ? (remaining / total) * 100 : 0;
            const percent = total > 0 ? (completed / total) * 100 : 0;
            stats.set(hex, { completed, total, remaining, remainingPercent, percent, hasProgress });
        });

        return stats;
    }

    // ─── Confirmation / preview modal ─────────────────────────────────────────────

    /** The single shared overlay element (created once and reused). */
    let _bulkOverlay = null;
    /** Original ordered list passed to openBulkModal (preserved for results display). */
    let _pendingColors = [];
    /** Separate warning overlay shown before large purchases reach the preview. */
    let _bulkWarningOverlay = null;

    /** Per-status visual style config. */
    function getStatusStyles() {
        const dark = isDarkMode();
        return {
            pending:   { label: '',                              bg: dark ? '#101828' : '#f9fafb', border: dark ? '#364153' : '#e5e7eb', textColor: dark ? '#6a7282' : '#9ca3af' },
            owned:     { label: 'Already Owned',                 bg: dark ? '#422006' : '#fefce8', border: dark ? '#a16207' : '#fde047', textColor: dark ? '#fbbf24' : '#92400e' },
            purchased: { label: 'Purchased ✓',                  bg: dark ? '#052e16' : '#f0fdf4', border: dark ? '#16a34a' : '#86efac', textColor: dark ? '#4ade80' : '#166534' },
            failed:    { label: 'Failed',                        bg: dark ? '#450a0a' : '#fef2f2', border: dark ? '#dc2626' : '#fca5a5', textColor: dark ? '#f87171' : '#991b1b' },
            skipped:   { label: 'Skipped (Insufficient Pixels)', bg: dark ? '#0f172a' : '#f1f5f9', border: dark ? '#475569' : '#cbd5e1', textColor: dark ? '#94a3b8' : '#64748b' },
        };
    }

    function buildColorRow(hex, status, ghostPixelCount) {
        const STATUS_STYLES = getStatusStyles();
        const s = STATUS_STYLES[status] || STATUS_STYLES.pending;
        const c = t();
        const row = document.createElement('div');
        row.dataset.gpColor = hex;
        row.style.cssText = `display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0.75rem;` +
            `background:${s.bg};border:1px solid ${s.border};border-radius:0.5rem;`;

        const swatch = document.createElement('div');
        swatch.style.cssText = `width:1.75rem;height:1.75rem;border-radius:0.25rem;border:1px solid ${c.inputBorder};flex-shrink:0;background:${hex};`;

        const hexLabel = document.createElement('span');
        hexLabel.style.cssText = `font-family:monospace;font-size:0.875rem;color:${c.textMed};flex:1;`;
        hexLabel.textContent = hex;

        // Ghost template pixel count label
        const ghostLabel = document.createElement('span');
        ghostLabel.className = 'gp-row-ghost';
        if (ghostPixelCount != null) {
            ghostLabel.style.cssText = `font-size:0.7rem;font-weight:500;color:${ghostPixelCount > 0 ? (isDarkMode() ? '#a78bfa' : '#7c3aed') : (isDarkMode() ? '#6b7280' : '#9ca3af')};white-space:nowrap;`;
            ghostLabel.textContent = ghostPixelCount > 0 ? `${ghostPixelCount} px` : 'unused';
        }

        const badge = document.createElement('span');
        badge.className = 'gp-row-badge';
        badge.style.cssText = `font-size:0.7rem;font-weight:600;color:${s.textColor};white-space:nowrap;`;
        badge.textContent = status === 'pending' ? `${PIXELS_PER_COLOR} px` : s.label;

        row.appendChild(swatch);
        row.appendChild(hexLabel);
        if (ghostPixelCount != null) row.appendChild(ghostLabel);
        row.appendChild(badge);
        return row;
    }

    function updateColorRow(hex, status) {
        // Scoped to the modal list only — queue rows use data-gp-queue-color
        const list = document.getElementById('gp-bulk-list');
        if (!list) return;
        const row = list.querySelector(`[data-gp-color="${hex}"]`);
        if (!row) return;
        const STATUS_STYLES = getStatusStyles();
        const s = STATUS_STYLES[status] || STATUS_STYLES.pending;
        row.style.background = s.bg;
        row.style.borderColor = s.border;
        const badge = row.querySelector('.gp-row-badge');
        if (badge) { badge.textContent = s.label; badge.style.color = s.textColor; }
    }

    function ensureBulkWarningModal() {
        if (_bulkWarningOverlay) return;

        const c = t();
        const dark = isDarkMode();
        const primaryBg = dark ? '#89b4fa' : '#3b82f6';
        const primaryText = dark ? '#1e1e2e' : '#fff';

        _bulkWarningOverlay = document.createElement('div');
        _bulkWarningOverlay.id = 'gp-bulk-warning-overlay';
        _bulkWarningOverlay.style.cssText =
            'position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
        _bulkWarningOverlay.innerHTML = `
<div id="gp-bulk-warning-panel" role="dialog" aria-modal="true" aria-labelledby="gp-bulk-warning-title"
     style="background:${c.panelBg};color:${c.text};border-radius:1rem;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:90%;max-width:28rem;padding:1.5rem;display:flex;flex-direction:column;gap:1rem;">
    <h2 id="gp-bulk-warning-title" style="margin:0;font-size:1.25rem;font-weight:700;color:${c.text};">Large bulk purchase warning</h2>
    <p id="gp-bulk-warning-summary" style="margin:0;font-size:1rem;line-height:1.5;color:${c.textMed};"></p>
    <p style="margin:0;font-size:0.85rem;line-height:1.45;color:${c.textSec};">This will send one purchase request for each color. Would you like to continue?</p>
    <div style="display:flex;gap:0.75rem;">
        <button id="gp-bulk-warning-cancel"
                style="flex:1;padding:0.5rem 1rem;background:${c.cancelBg};border:none;border-radius:0.5rem;font-weight:600;cursor:pointer;font-size:0.9rem;color:${c.cancelText};">
            Cancel
        </button>
        <button id="gp-bulk-warning-continue"
                style="flex:1;padding:0.5rem 1rem;background:${primaryBg};color:${primaryText};border:none;border-radius:0.5rem;font-weight:600;cursor:pointer;font-size:0.9rem;">
            Continue
        </button>
    </div>
</div>`;

        document.body.appendChild(_bulkWarningOverlay);

        document.getElementById('gp-bulk-warning-cancel').addEventListener('click', cancelBulkWarning);
        document.getElementById('gp-bulk-warning-continue').addEventListener('click', continueBulkWarning);
        _bulkWarningOverlay.addEventListener('click', e => { if (e.target === _bulkWarningOverlay) cancelBulkWarning(); });
    }

    function openBulkWarning(toBuyCount) {
        ensureBulkWarningModal();
        const cost = (toBuyCount * PIXELS_PER_COLOR).toLocaleString();
        document.getElementById('gp-bulk-warning-summary').textContent =
            `You are about to buy ${toBuyCount.toLocaleString()} colors for ${cost} Pixels.`;
        if (_bulkOverlay) _bulkOverlay.style.display = 'none';
        _bulkWarningOverlay.style.display = 'flex';
    }

    function closeBulkWarning() {
        if (_bulkWarningOverlay) _bulkWarningOverlay.style.display = 'none';
    }

    function cancelBulkWarning() {
        closeBulkWarning();
        closeBulkModal();
    }

    function continueBulkWarning() {
        const colors = [..._pendingColors];
        closeBulkWarning();
        if (colors.length > 0) renderBulkPreview(colors);
    }

    function ensureBulkModal() {
        if (_bulkOverlay) return;

        const c = t();

        _bulkOverlay = document.createElement('div');
        _bulkOverlay.id = 'gp-bulk-overlay';
        // Overlay sits above everything — including z-50 profile panel and z-40 ghost modal
        _bulkOverlay.style.cssText =
            'position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';

        _bulkOverlay.innerHTML = `
<div id="gp-bulk-panel"
     style="background:${c.panelBg};color:${c.text};border-radius:1rem;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:90%;max-width:28rem;max-height:85vh;display:flex;flex-direction:column;padding:1.5rem;gap:1rem;overflow:hidden;">

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <h2 id="gp-bulk-title" style="margin:0;font-size:1.25rem;font-weight:700;color:${c.text};">Bulk Purchase Preview</h2>
        <button id="gp-bulk-close"
                style="width:2rem;height:2rem;border-radius:50%;border:none;background:${c.closeBg};cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;color:${c.closeText};"
                title="Close">\u2715</button>
    </div>

    <!-- Subtitle -->
    <p id="gp-bulk-subtitle" style="margin:0;font-size:0.85rem;color:${c.textSec};flex-shrink:0;"></p>

    <!-- Colour list (all colors in original order, owned grayed out) -->
    <div id="gp-bulk-list"
         style="flex:1 1 auto;overflow-y:auto;display:flex;flex-direction:column;gap:0.5rem;padding-right:0.25rem;min-height:0;"></div>

    <!-- Progress bar (shown during purchase) -->
    <div id="gp-bulk-progress-wrap"
         style="flex-shrink:0;display:none;">
        <div style="width:100%;height:0.75rem;background:${c.progressBg};border-radius:9999px;overflow:hidden;">
            <div id="gp-bulk-progress-bar"
                 style="height:100%;width:0%;background:#3b82f6;border-radius:9999px;transition:width 0.2s ease;"></div>
        </div>
        <p id="gp-bulk-progress-text"
           style="margin:0.25rem 0 0;font-size:0.75rem;color:${c.textSec};text-align:center;"></p>
    </div>

    <!-- Action buttons -->
    <div style="display:flex;gap:0.75rem;flex-shrink:0;">
        <button id="gp-bulk-cancel"
                style="flex:1;padding:0.5rem 1rem;background:${c.cancelBg};border:none;border-radius:0.5rem;font-weight:600;cursor:pointer;font-size:0.9rem;color:${c.cancelText};">
            Cancel
        </button>
        <button id="gp-bulk-confirm"
                style="flex:1;padding:0.5rem 1rem;background:#3b82f6;color:#fff;border:none;border-radius:0.5rem;font-weight:600;cursor:pointer;font-size:0.9rem;">
            Purchase All
        </button>
    </div>
</div>`;

        document.body.appendChild(_bulkOverlay);

        document.getElementById('gp-bulk-close').addEventListener('click', closeBulkModal);
        document.getElementById('gp-bulk-cancel').addEventListener('click', closeBulkModal);
        _bulkOverlay.addEventListener('click', e => { if (e.target === _bulkOverlay) closeBulkModal(); });
        document.getElementById('gp-bulk-confirm').addEventListener('click', onBulkConfirm);
    }

    /**
     * Open the preview modal for a given list of "#RRGGBB" hex strings.
     * All colors are shown in original order; already-owned ones get an
     * "Already Owned" badge and are non-destructively skipped on confirm.
     */
    function renderBulkPreview(colors) {
        ensureBulkModal();

        _pendingColors = colors;

        const ownedSet = buildOwnedSet();
        const toBuyCount  = colors.filter(c => !ownedSet.has(c)).length;
        const ownedCount  = colors.length - toBuyCount;

        // Grab ghost template pixel counts if a template is loaded
        const ghostCounts = getGhostPixelCounts();
        const hasGhost = ghostCounts.size > 0;

        // --- Populate list (original order, owned shown in-place) ---
        const list = document.getElementById('gp-bulk-list');
        list.innerHTML = '';
        colors.forEach(hex => {
            const gpc = hasGhost ? (ghostCounts.get(hex) ?? 0) : undefined;
            list.appendChild(buildColorRow(hex, ownedSet.has(hex) ? 'owned' : 'pending', hasGhost ? gpc : undefined));
        });

        // --- Header / subtitle ---
        document.getElementById('gp-bulk-title').textContent = 'Bulk Purchase Preview';
        const parts = [`${toBuyCount} to purchase · est. ${(toBuyCount * PIXELS_PER_COLOR).toLocaleString()} Pixels`];
        if (ownedCount > 0) parts.push(`${ownedCount} already owned (will skip)`);
        document.getElementById('gp-bulk-subtitle').textContent = parts.join(' · ');

        // --- Ghost template legend ---
        let legend = document.getElementById('gp-bulk-ghost-legend');
        if (legend) legend.remove();
        if (hasGhost) {
            legend = document.createElement('p');
            legend.id = 'gp-bulk-ghost-legend';
            const purpleColor = isDarkMode() ? '#a78bfa' : '#7c3aed';
            legend.style.cssText = `margin:0;font-size:0.75rem;color:${isDarkMode() ? '#9ca3af' : '#6b7280'};flex-shrink:0;`;
            legend.innerHTML = `<span style="color:${purpleColor};font-weight:600;">Purple</span> = pixels used in the loaded ghost template`;
            const subtitle = document.getElementById('gp-bulk-subtitle');
            subtitle.insertAdjacentElement('afterend', legend);
        }

        // --- Reset progress bar ---
        document.getElementById('gp-bulk-progress-wrap').style.display = 'none';
        document.getElementById('gp-bulk-progress-bar').style.width = '0%';
        document.getElementById('gp-bulk-progress-text').textContent = '';

        // --- Reset action buttons ---
        const confirmBtn = document.getElementById('gp-bulk-confirm');
        const cancelBtn  = document.getElementById('gp-bulk-cancel');
        confirmBtn.style.display = '';
        confirmBtn.textContent = 'Purchase All';
        confirmBtn.disabled = toBuyCount === 0;
        confirmBtn.style.opacity = toBuyCount === 0 ? '0.5' : '1';
        confirmBtn.style.cursor  = toBuyCount === 0 ? 'not-allowed' : 'pointer';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.disabled = false;

        _bulkOverlay.style.display = 'flex';
    }

    function openBulkModal(colors) {
        const nextColors = Array.isArray(colors) ? [...colors] : [];
        const ownedSet = buildOwnedSet();
        const toBuyCount = nextColors.filter(color => !ownedSet.has(color)).length;
        _pendingColors = nextColors;

        if (toBuyCount > BULK_PURCHASE_WARNING_THRESHOLD) {
            openBulkWarning(toBuyCount);
            return;
        }

        renderBulkPreview(nextColors);
    }

    function closeBulkModal() {
        if (_bulkOverlay) _bulkOverlay.style.display = 'none';
        closeBulkWarning();
        _pendingColors = [];
        // Sync the profile card queue now that the modal is gone
        if (document.getElementById('gp-bulk-queue-list')) refreshColorQueue();
    }

    async function onBulkConfirm() {
        const confirmBtn = document.getElementById('gp-bulk-confirm');
        const cancelBtn  = document.getElementById('gp-bulk-cancel');
        const closeBtn   = document.getElementById('gp-bulk-close');

        // Lock UI during purchase
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
        confirmBtn.style.cursor = 'not-allowed';
        cancelBtn.disabled = true;
        closeBtn.disabled = true;

        const colors = [..._pendingColors];
        const results = await executeBulkPurchase(colors);

        // Silently strip purchased colors from textarea (queue refreshes when modal closes)
        const textarea = document.getElementById('gp-bulk-textarea');
        if (textarea) {
            const { valid } = parseColorInput(textarea.value);
            const purchasedSet = new Set(colors.filter(h => results.get(h) === 'purchased'));
            const remaining = valid.filter(c => !purchasedSet.has(c));
            textarea.value = remaining.length ? remaining.join(', ') : '';
        }

        // Switch to results view
        showBulkResults(colors, results);

        closeBtn.disabled = false;
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Close';
    }

    // ─── Purchase logic ───────────────────────────────────────────────────────────

    /**
     * Attempt to purchase each non-owned color in order.
     * On HTTP 402 (insufficient pixels), stops immediately and marks the current
     * color plus all remaining unattempted colors as 'skipped'.
     * Returns a Map<hex, 'owned'|'purchased'|'failed'|'skipped'>.
     */
    async function executeBulkPurchase(colors) {
        const progressWrap = document.getElementById('gp-bulk-progress-wrap');
        const progressBar  = document.getElementById('gp-bulk-progress-bar');
        const progressText = document.getElementById('gp-bulk-progress-text');

        progressWrap.style.display = 'block';

        const auth = getAuth();
        if (!auth) {
            progressText.textContent = 'Error: credentials not captured yet.';
            if (_pw.showAlert) _pw.showAlert('Error', 'Credentials not ready. Place a pixel first to initialise auth, then retry.');
            return new Map();
        }

        const ownedSet = buildOwnedSet();
        const results  = new Map();
        colors.forEach(hex => { if (ownedSet.has(hex)) results.set(hex, 'owned'); });

        const toPurchase = colors.filter(hex => !ownedSet.has(hex));
        let stoppedAt = -1;

        for (let i = 0; i < toPurchase.length; i++) {
            const hex = toPurchase[i];

            const pct = Math.round((i / toPurchase.length) * 100);
            progressBar.style.width = pct + '%';
            progressText.textContent = `Purchasing ${i + 1} of ${toPurchase.length}: ${hex}`;

            try {
                const resp = await window.fetch('/MakePurchase', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        Token:   auth.token,
                        UserId:  auth.userId,
                        Subject: auth.subject,
                        type:    'ExtraColor',
                        amount:  hexToInt(hex),
                    }),
                });

                if (resp.status === 200) {
                    results.set(hex, 'purchased');
                    updateColorRow(hex, 'purchased');
                } else if (resp.status === 402) {
                    // Insufficient pixels — stop the loop here
                    results.set(hex, 'skipped');
                    updateColorRow(hex, 'skipped');
                    stoppedAt = i;
                    break;
                } else {
                    results.set(hex, 'failed');
                    updateColorRow(hex, 'failed');
                    console.warn(`[BulkPurchase] Failed ${hex}: HTTP ${resp.status}`);
                }
            } catch (err) {
                results.set(hex, 'failed');
                updateColorRow(hex, 'failed');
                console.error('[BulkPurchase] Error purchasing', hex, err);
            }
        }

        // Mark everything that was never attempted (after the 402) as skipped
        if (stoppedAt >= 0) {
            for (let j = stoppedAt + 1; j < toPurchase.length; j++) {
                const hex = toPurchase[j];
                results.set(hex, 'skipped');
                updateColorRow(hex, 'skipped');
            }
        }

        progressBar.style.width = '100%';

        // Auto-enable newly purchased colors in the page's active palette,
        // mirroring what the native single-color purchase does.
        const successCount = toPurchase.filter(hex => results.get(hex) === 'purchased').length;
        if (successCount > 0) {
            try {
                let colorsLen;
                try { colorsLen = Colors.length; } catch (_) { colorsLen = (_pw.Colors || []).length; }
                const s = document.createElement('script');
                s.textContent = `(function(){try{for(var i=${colorsLen};i<${colorsLen + successCount};i++){if(!activeColors.includes(i))activeColors.push(i);}localStorage.setItem('activeColors',JSON.stringify(activeColors));}catch(e){}})();`;
                (document.head || document.documentElement).appendChild(s);
                s.remove();
            } catch (e) {
                console.warn('[BulkPurchase] Could not auto-enable purchased colors:', e);
            }
        }

        if (typeof window.synchronize === 'function') window.synchronize();

        return results;
    }

    /**
     * Switch the open modal into a results view.
     * The colour rows are already updated in real-time; this just updates the
     * title/subtitle and hides the confirm button.
     */
    function showBulkResults(original, results) {
        const purchased = original.filter(h => results.get(h) === 'purchased').length;
        const owned     = original.filter(h => results.get(h) === 'owned').length;
        const failed    = original.filter(h => results.get(h) === 'failed').length;
        const skipped   = original.filter(h => results.get(h) === 'skipped').length;

        document.getElementById('gp-bulk-title').textContent = 'Purchase Complete';

        const parts = [];
        if (purchased > 0) parts.push(`${purchased} purchased`);
        if (owned     > 0) parts.push(`${owned} already owned`);
        if (skipped   > 0) parts.push(`${skipped} skipped — insufficient Pixels`);
        if (failed    > 0) parts.push(`${failed} failed`);
        document.getElementById('gp-bulk-subtitle').textContent = parts.join(' · ');

        document.getElementById('gp-bulk-confirm').style.display = 'none';
    }

    // ─── Profile card queue helpers ───────────────────────────────────────────────

    /** Remove a single hex value from the textarea and fire 'input' to refresh the queue. */
    function removeColorFromTextarea(hex) {
        const textarea = document.getElementById('gp-bulk-textarea');
        if (!textarea) return;
        const { valid } = parseColorInput(textarea.value);
        const remaining = valid.filter(c => c !== hex);
        textarea.value = remaining.length ? remaining.join(', ') : '';
        textarea.dispatchEvent(new Event('input'));
    }

    /**
     * Re-render the right-side queue list from the current textarea contents.
     * Unowned colors come first (with Buy buttons); owned are grayed at the bottom.
     */
    function refreshColorQueue() {
        const textarea  = document.getElementById('gp-bulk-textarea');
        const list      = document.getElementById('gp-bulk-queue-list');
        const emptyHint = document.getElementById('gp-bulk-empty-hint');
        const buyAllBtn = document.getElementById('gp-bulk-buy-all-btn');
        const infoEl    = document.getElementById('gp-bulk-parse-info');
        const sortEl    = document.getElementById('gp-bulk-sort-select');
        if (!textarea || !list) return;

        const { valid, invalid } = parseColorInput(textarea.value);
        const ownedSet = buildOwnedSet();
        const ghostStats = getGhostColorStats();
        const hasProgressStats = Array.from(ghostStats.values()).some(s => s.hasProgress);
        const progressSortValues = new Set(['mostRemaining', 'leastRemaining', 'mostPct', 'leastPct']);
        if (sortEl) {
            Array.from(sortEl.options).forEach(opt => {
                const isProgressSort = progressSortValues.has(opt.value);
                opt.hidden = isProgressSort && !hasProgressStats;
                opt.disabled = isProgressSort && !hasProgressStats;
            });
            if (!hasProgressStats && progressSortValues.has(sortEl.value)) sortEl.value = 'default';
        }
        const sortValue = sortEl ? sortEl.value : 'default';

        function sortColors(colors) {
            const getStats = hex => ghostStats.get(hex) || { total: 0, remaining: 0, remainingPercent: 0 };
            const originalIndex = new Map(valid.map((hex, idx) => [hex, idx]));
            const tie = (a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
            return [...colors].sort((a, b) => {
                const sa = getStats(a), sb = getStats(b);
                switch (sortValue) {
                    case 'default':        return (sb.total - sa.total) || tie(a, b);
                    case 'leastUsed':      return (sa.total - sb.total) || tie(a, b);
                    case 'mostRemaining':  return (sb.remaining - sa.remaining) || tie(a, b);
                    case 'leastRemaining': return (sa.remaining - sb.remaining) || tie(a, b);
                    case 'mostPct':        return (sb.remainingPercent - sa.remainingPercent) || tie(a, b);
                    case 'leastPct':       return (sa.remainingPercent - sb.remainingPercent) || tie(a, b);
                    case 'byColor':        return a.localeCompare(b) || tie(a, b);
                    case 'byColorRev':     return b.localeCompare(a) || tie(a, b);
                    default:               return tie(a, b);
                }
            });
        }

        const unowned  = sortColors(valid.filter(c => !ownedSet.has(c)));
        const owned    = sortColors(valid.filter(c =>  ownedSet.has(c)));

        // Parse-info label (below textarea)
        if (infoEl) {
            if (!textarea.value.trim()) {
                infoEl.textContent = '';
            } else {
                const parts = [`${unowned.length} to purchase`];
                if (owned.length   > 0) parts.push(`${owned.length} already owned`);
                if (invalid.length > 0) parts.push(`${invalid.length} unrecognised`);
                infoEl.textContent = parts.join(' · ');
            }
        }

        // Buy All button state
        if (buyAllBtn) {
            const n = unowned.length;
            buyAllBtn.textContent = `🛒 Buy All (${n})`;
            buyAllBtn.disabled       = n === 0;
            buyAllBtn.style.opacity  = n === 0 ? '0.5' : '1';
            buyAllBtn.style.cursor   = n === 0 ? 'not-allowed' : 'pointer';
        }

        // Rebuild list
        list.innerHTML = '';
        if (valid.length === 0) {
            if (emptyHint) emptyHint.style.display = 'block';
            return;
        }
        if (emptyHint) emptyHint.style.display = 'none';

        // Grab ghost pixel counts for queue display
        const hasGhost = ghostStats.size > 0;
        const ghostStat = hex => ghostStats.get(hex) || { completed: 0, total: 0, percent: 0 };

        unowned.forEach(hex => list.appendChild(buildQueueRow(hex, false, hasGhost ? ghostStat(hex) : undefined)));

        if (owned.length > 0) {
            const sep = document.createElement('div');
            sep.className = 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400';
            sep.style.cssText =
                `font-size:0.6rem;color:var(--color-gray-500,#6b7280);text-align:center;padding:0.2rem 0;` +
                `border-top:1px solid var(--color-gray-300,#d1d5db);border-bottom:1px solid var(--color-gray-300,#d1d5db);` +
                `background:var(--color-gray-100,#f3f4f6);letter-spacing:0.05em;user-select:none;`;
            sep.textContent = '── Already Owned ──';
            list.appendChild(sep);
            owned.forEach(hex => list.appendChild(buildQueueRow(hex, true, hasGhost ? ghostStat(hex) : undefined)));
        }
    }

    /** Build a single color row for the profile queue. */
    function buildQueueRow(hex, isOwned, ghostStats) {
        const row = document.createElement('div');
        row.dataset.gpQueueColor = hex;
        row.className = isOwned
            ? 'gp-bulk-queue-row gp-bulk-queue-row-owned bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700'
            : 'gp-bulk-queue-row bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700';
        // Fixed height + no gap = button stays in same screen position as rows are removed
        row.style.cssText =
            'display:flex;align-items:center;height:1.625rem;padding:0 0.35rem;' +
            `background:${isOwned ? 'var(--color-gray-100,#f3f4f6)' : 'var(--color-white,#fff)'};` +
            `border-bottom:1px solid ${isOwned ? 'var(--color-gray-300,#d1d5db)' : 'var(--color-gray-200,#e5e7eb)'};` +
            `${isOwned ? 'opacity:0.45;' : ''}`;

        const swatch = document.createElement('div');
        swatch.style.cssText =
            `width:0.875rem;height:0.875rem;border-radius:2px;flex-shrink:0;` +
            `background:${hex};border:1px solid rgba(0,0,0,0.12);margin-right:0.35rem;`;

        const label = document.createElement('span');
        label.style.cssText =
            `font-family:monospace;font-size:0.68rem;flex:1;overflow:hidden;` +
            `color:${isOwned ? 'var(--color-gray-500,#6b7280)' : 'var(--color-gray-700,#374151)'};letter-spacing:-0.01em;`;
        label.textContent = hex;

        row.appendChild(swatch);
        row.appendChild(label);

        // Ghost template pixel count
        if (ghostStats != null) {
            const ghostLabel = document.createElement('span');
            const total = ghostStats.total || 0;
            const completed = ghostStats.completed || 0;
            const percent = Math.round((ghostStats.percent || 0) * 10) / 10;
            const percentText = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
            ghostLabel.style.cssText =
                `font-size:0.6rem;font-weight:600;white-space:nowrap;flex-shrink:0;padding:0 0.25rem;` +
                `color:var(--color-gray-900,#f9fafb);`;
            if (total > 0 && ghostStats.hasProgress) {
                const shellColor = 'var(--color-gray-900,#f9fafb)';
                const progressColor = 'var(--color-purple-300,#c4b5fd)';
                const pctColor = 'var(--color-blue-300,#93c5fd)';
                const add = (text, color) => {
                    const span = document.createElement('span');
                    span.textContent = text;
                    span.style.color = color;
                    ghostLabel.appendChild(span);
                };
                add(`${total.toLocaleString()} px `, shellColor);
                add('(', shellColor);
                add(`${completed.toLocaleString()} px / ${total.toLocaleString()} px`, progressColor);
                add(' | ', shellColor);
                add(`${percentText}%`, pctColor);
                add(')', shellColor);
            } else {
                ghostLabel.textContent = total > 0 ? `${total.toLocaleString()} px` : '—';
            }
            row.appendChild(ghostLabel);
        }

        if (isOwned) {
            const badge = document.createElement('span');
            badge.style.cssText =
                `font-size:0.6rem;color:var(--color-gray-500,#6b7280);white-space:nowrap;flex-shrink:0;padding-left:0.25rem;`;
            badge.textContent = 'owned';
            row.appendChild(badge);
        } else {
            const btn = document.createElement('button');
            // Fixed width so the button is always at the same X — critical for spam-clicking
            btn.style.cssText =
                'width:2.25rem;height:1.25rem;flex-shrink:0;background:#3b82f6;color:#fff;border:none;' +
                'border-radius:3px;font-size:0.65rem;font-weight:700;cursor:pointer;' +
                'display:flex;align-items:center;justify-content:center;letter-spacing:0.02em;';
            btn.textContent = 'BUY';
            btn.addEventListener('mouseover', () => { if (!btn.disabled) btn.style.background = '#2563eb'; });
            btn.addEventListener('mouseout',  () => { if (!btn.disabled) btn.style.background = '#3b82f6'; });
            btn.addEventListener('click', () => buyIndividualColor(hex, btn));
            row.appendChild(btn);
        }

        return row;
    }

    /** Purchase one color immediately; on success remove it from the textarea and queue. */
    async function buyIndividualColor(hex, btn) {
        btn.disabled      = true;
        btn.style.opacity = '0.5';
        btn.style.cursor  = 'not-allowed';
        btn.textContent   = '…';

        const auth = getAuth();
        if (!auth) {
            if (_pw.showAlert) _pw.showAlert('Error', 'Not ready yet — credentials not captured. Try placing a pixel first, then retry.');
            btn.disabled = false; btn.style.opacity = '1';
            btn.style.cursor = 'pointer'; btn.textContent = 'Buy';
            return;
        }

        try {
            const resp = await window.fetch('/MakePurchase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    Token:   auth.token,
                    UserId:  auth.userId,
                    Subject: auth.subject,
                    type:    'ExtraColor',
                    amount:  hexToInt(hex),
                }),
            });

            if (resp.status === 200) {
                // Remove from textarea → fires 'input' → refreshColorQueue removes the row
                removeColorFromTextarea(hex);
                if (typeof window.synchronize === 'function') window.synchronize();
                if (_pw.showAlert) _pw.showAlert('Success', `${hex} purchased successfully!`);
            } else if (resp.status === 402) {
                if (_pw.showAlert) _pw.showAlert('Error', 'Insufficient Pixels to purchase this color.');
                btn.disabled = false; btn.style.opacity = '1';
                btn.style.cursor = 'pointer'; btn.textContent = 'Buy';
            } else {
                const text = await resp.text().catch(() => '');
                if (_pw.showAlert) _pw.showAlert('Error', `Failed to purchase ${hex}. ${text}`.trim());
                btn.disabled = false; btn.style.opacity = '1';
                btn.style.cursor = 'pointer'; btn.textContent = 'Buy';
            }
        } catch (err) {
            console.error('[BulkPurchase] Network error:', err);
            if (_pw.showAlert) _pw.showAlert('Error', 'Network error during purchase.');
            btn.disabled = false; btn.style.opacity = '1';
            btn.style.cursor = 'pointer'; btn.textContent = 'Buy';
        }
    }

    // ─── Profile panel injection ──────────────────────────────────────────────────

    function injectProfileSection() {
        if (document.getElementById('gp-bulk-profile-card')) return;

        // Locate "Unlock Extra Color" card by its unique child element
        const freeColorNotice = document.getElementById('freeColorNotice');
        if (!freeColorNotice) return;

        // Walk up to the card wrapper (p-4 bg-gray-100 rounded-xl shadow)
        const extraColorCard = freeColorNotice.closest('div[class*="p-4"]');
        if (!extraColorCard) return;

        // The grid that contains all upgrade cards
        const grid = extraColorCard.parentElement;
        if (!grid) return;

        const c = t();

        const card = document.createElement('div');
        card.id = 'gp-bulk-profile-card';
        card.className = 'p-4 bg-gray-100 rounded-xl shadow flex flex-col gap-3';
        card.style.gridColumn = '1 / -1';

        card.innerHTML = `
<div style="font-weight:600;font-size:1rem;color:${c.text};margin-bottom:0.125rem;">Bulk Purchase Colors</div>
<div style="display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap;">

    <!-- Left: textarea input -->
    <div style="flex:1;min-width:11rem;display:flex;flex-direction:column;gap:0.5rem;">
        <div class="text-sm text-gray-500">Comma, space, or newline &mdash; hex or decimal</div>
        <textarea id="gp-bulk-textarea"
                  rows="6"
                  placeholder="#FF0000, #00FF00&#10;FF0000 00FF00&#10;16711680"
                  class="w-full border rounded-lg px-3 py-2 text-sm font-mono resize-y"
                  style="outline:none;transition:box-shadow 0.15s;"
                  onfocus="this.style.boxShadow='0 0 0 2px #3b82f6'"
                  onblur="this.style.boxShadow='none'"
        ></textarea>
        <p id="gp-bulk-parse-info" style="margin:0;font-size:0.75rem;color:${c.textMuted};min-height:1rem;"></p>
    </div>

    <!-- Right: live color queue -->
    <div style="flex:1;min-width:12rem;display:flex;flex-direction:column;gap:0.5rem;">
        <button id="gp-bulk-buy-all-btn"
                style="width:100%;padding:0.5rem 0.75rem;background:#3b82f6;color:#fff;
                       border:none;border-radius:0.5rem;font-weight:600;font-size:0.875rem;
                       cursor:not-allowed;opacity:0.5;text-align:center;"
                disabled>
            &#x1F6D2; Buy All (0)
        </button>
         <div style="display:flex;align-items:center;gap:0.4rem;">
            <select id="gp-bulk-sort-select"
                  class="border rounded-md bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
                    title="Scroll while hovering to change sort order"
                  style="flex:1;min-width:0;border:1px solid var(--color-gray-300,#d1d5db);border-radius:0.375rem;
                      background:var(--color-white,#fff);color:var(--color-gray-700,#374151);font-size:0.75rem;padding:0.25rem 0.35rem;cursor:pointer;">
              <option value="default">Sort by: Most used (default)</option>
              <option value="leastUsed">Sort by: Least used</option>
              <option value="mostRemaining">Sort by: Most remaining</option>
              <option value="leastRemaining">Sort by: Least remaining</option>
              <option value="mostPct">Sort by: Most % remaining</option>
              <option value="leastPct">Sort by: Least % remaining</option>
                <option value="byColor">Sort by: Color</option>
                <option value="byColorRev">Sort by: Color reversed</option>
            </select>
        </div>
        <div id="gp-bulk-queue-list"
              class="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
             style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;
                  border:1px solid var(--color-gray-200,#e5e7eb);border-radius:0.375rem;overflow-x:hidden;
                  background:var(--color-white,#fff);"></div>
        <p id="gp-bulk-empty-hint"
           style="margin:0;font-size:0.75rem;color:${c.textMuted};text-align:center;">Enter colors on the left</p>
    </div>

</div>`;

        grid.appendChild(card);

        const textarea = document.getElementById('gp-bulk-textarea');
        textarea.addEventListener('input', refreshColorQueue);

        const bulkSortSelect = document.getElementById('gp-bulk-sort-select');
        if (bulkSortSelect) {
            bulkSortSelect.addEventListener('change', refreshColorQueue);
            bulkSortSelect.addEventListener('wheel', e => {
                e.preventDefault();
                const dir = e.deltaY > 0 ? 1 : -1;
                let next = bulkSortSelect.selectedIndex + dir;
                while (next >= 0 && next < bulkSortSelect.options.length && bulkSortSelect.options[next].disabled) next += dir;
                next = Math.min(Math.max(next, 0), bulkSortSelect.options.length - 1);
                if (next !== bulkSortSelect.selectedIndex) {
                    bulkSortSelect.selectedIndex = next;
                    refreshColorQueue();
                }
            }, { passive: false });
        }

        document.getElementById('gp-bulk-buy-all-btn').addEventListener('click', () => {
            const { valid } = parseColorInput(textarea.value);
            if (valid.length === 0) return;
            openBulkModal(valid);
        });

        // "Add Ghost Template Colors" button — fetches colors from the active ghost image palette
        const ghostFetchBtn = document.createElement('button');
        ghostFetchBtn.id = 'gp-bulk-ghost-fetch-btn';
        ghostFetchBtn.className = 'px-3 py-2 text-white text-sm rounded-lg shadow transition cursor-pointer';
        ghostFetchBtn.style.background = '#7c3aed';
        ghostFetchBtn.style.border = 'none';
        ghostFetchBtn.style.fontWeight = '600';
        ghostFetchBtn.textContent = '👻 Add Ghost Template Colors';
        ghostFetchBtn.title = 'Fetch colors from the current ghost template and populate the text field';
        ghostFetchBtn.addEventListener('mouseover', () => { ghostFetchBtn.style.background = '#6d28d9'; });
        ghostFetchBtn.addEventListener('mouseout',  () => { ghostFetchBtn.style.background = '#7c3aed'; });
        ghostFetchBtn.addEventListener('click', () => {
            const ghostColors = getGhostColorsFromDOM();
            if (ghostColors.length === 0) {
                alert('No ghost palette colors found. Make sure a ghost image is loaded.');
                return;
            }
            const existing = textarea.value.trim();
            textarea.value = existing
                ? existing + ', ' + ghostColors.join(', ')
                : ghostColors.join(', ');
            textarea.dispatchEvent(new Event('input'));
        });

        // Insert below the parse info line, inside the left column
        const parseInfo = document.getElementById('gp-bulk-parse-info');
        if (parseInfo && parseInfo.parentElement) {
            parseInfo.parentElement.appendChild(ghostFetchBtn);
        }

        refreshColorQueue();

        // Watch ghost palette for changes (load/unload template) to refresh queue ghost counts
        const ghostPalette = document.getElementById('ghostColorPalette');
        if (ghostPalette) {
            new MutationObserver(() => {
                if (document.getElementById('gp-bulk-queue-list')) refreshColorQueue();
            }).observe(ghostPalette, { childList: true });
        }
    }

    // ─── Ghost modal injection ─────────────────────────────────────────────────────

    function injectGhostButton() {
        if (document.getElementById('gp-ghost-buy-btn')) return;

        // The "Match My Palette" button is a reliable anchor inside the ghost modal
        const anchorBtn = document.getElementById('filterByUserPaletteBtn');
        if (!anchorBtn) return;

        const btn = document.createElement('button');
        btn.id = 'gp-ghost-buy-btn';
        btn.className = 'px-3 py-2 text-white text-sm rounded-lg shadow transition cursor-pointer';
        btn.style.background = '#7c3aed';
        btn.title = "Find ghost-image colors you don't own yet and open the bulk-purchase flow";
        btn.textContent = 'Bulk Purchase Colors';

        btn.addEventListener('mouseover', () => { btn.style.background = '#6d28d9'; });
        btn.addEventListener('mouseout', () => { btn.style.background = '#7c3aed'; });
        btn.addEventListener('click', handlePurchaseUnowned);

        // Insert after the existing button row so it appears as a natural addition
        anchorBtn.parentElement.appendChild(btn);
    }

    /**
     * Reveals the profile panel's Bulk Purchase Colors card and
     * autopopulates its textarea with the given "#RRGGBB" hex colors,
     * scrolling it into view — the shared tail end of handlePurchaseUnowned
     * (the legacy native-ghost-menu "Bulk Purchase Colors" button's flow),
     * factored out so Ghost++'s own "Buy all colors" button can reuse it
     * with a color list it already computed itself, without needing to
     * scrape #ghostColorPalette or close any modal of its own.
     */
    function openProfilePanelWithColors(colors) {
        const profileOverlay = document.getElementById('profileOverlay');
        if (profileOverlay && profileOverlay.classList.contains('hidden') &&
                typeof _pw.toggleProfile === 'function') {
            _pw.toggleProfile();
        }

        // Give the profile panel time to animate in, then populate the textarea
        setTimeout(() => {
            injectProfileSection();

            const textarea = document.getElementById('gp-bulk-textarea');
            if (textarea) {
                // Always wipe first so repeated presses don't accumulate stale colors
                textarea.value = colors.join(', ');
                textarea.dispatchEvent(new Event('input'));
                textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            // Flash the card with a yellow glow to draw the user's eye
            const card = document.getElementById('gp-bulk-profile-card');
            if (card) {
                card.style.transition = 'box-shadow 0.15s ease';
                card.style.boxShadow  = '0 0 0 3px #fbbf24, 0 0 18px 6px rgba(251,191,36,0.55)';
                setTimeout(() => { card.style.boxShadow = 'none'; }, 900);
            }
        }, 300);
    }

    async function handlePurchaseUnowned() {
        const btn = document.getElementById('gp-ghost-buy-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Checking…';
        }

        try {
            // Read directly from the rendered palette DOM — reliable source of truth.
            // ghost22.js sets swatch.title = `${colorData.hex}\n${totalCount} pixels`
            // so the first line before \n is always the canonical hex value.
            const ghostColors = getGhostColorsFromDOM();

            if (ghostColors.length === 0) {
                if (_pw.showAlert) {
                    _pw.showAlert('Info', 'No ghost palette colors found. Make sure a ghost image is loaded and its color palette is visible in the modal.');
                }
                return;
            }

            // Fetch fresh ownership data from the server
            const ownedSet = await fetchOwnedHexSet();
            const unowned = ghostColors.filter(h => !ownedSet.has(h));

            if (unowned.length === 0) {
                if (_pw.showAlert) {
                    _pw.showAlert('Info', 'You already own all colors used in this ghost image!');
                }
                return;
            }

            // Close the ghost modal
            const _pw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (typeof _pw.toggleGhostModal === 'function') _pw.toggleGhostModal(false);

            openProfilePanelWithColors(unowned);

        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Bulk Purchase Colors';
            }
        }
    }

    // ─── DOM observation and entry point ──────────────────────────────────────────

    /**
     * Watch the DOM for relevant containers and inject our UI whenever they appear.
     * Both the profile panel and the ghost modal already exist in the HTML on load,
     * but the observer also handles any future dynamic additions gracefully.
     */
    function observeAndInject() {
        // Try immediately (elements may already be in the DOM)
        injectProfileSection();
        injectGhostButton();

        // Re-check on every DOM change (guards against dynamic re-renders)
        const observer = new MutationObserver(() => {
            injectProfileSection();
            injectGhostButton();
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeAndInject);
    } else {
        observeAndInject();
    }

    // Expose to the shared top-level scope — see the gppBulkPurchaseOpenModal
    // declaration above this feature block for why this indirection exists.
    gppBulkPurchaseOpenModal = openBulkModal;
    gppBulkPurchaseOpenProfilePanel = openProfilePanelWithColors;

            })();
            _featureStatus.bulkPurchaseColors = 'ok';
            console.log('[GeoPixelcons++] ✅ Bulk Purchase Colors loaded');
        } catch (err) {
            _featureStatus.bulkPurchaseColors = 'error';
            dbgPush(`Bulk Purchase Colors init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Bulk Purchase Colors' });
            console.error('[GeoPixelcons++] ❌ Bulk Purchase Colors failed:', err);
        }
    }
