    // Shared visual token source for the whole Mobile System Overhaul UI.
    // Matches Ghost++'s own actual palette (gpp-ui-shell.js's t2(light, dark)
    // calls) exactly, so the mobile surface looks and feels like one
    // product instead of five independently-tuned palettes (the previous
    // state: panel-core.js's --mva-*, template-settings.js's --mvb-*, and
    // additions.js's --gma-* custom-property blocks each invented their own
    // slightly different grays/text colors, plus four unrelated "accent"
    // hues -- blue/yellow/orange/green -- across the same feature; and
    // native-controls.js/hamburger-menu.js hardcoded a fifth and sixth set
    // of hex literals inline via their own JS-computed dark-mode checks).
    //
    // Every mobile file now reads these as plain CSS custom properties
    // (var(--gpp-mobile-*)) instead of defining its own tokens or computing
    // "is dark" in JS. The cascade handles light/dark automatically -- CSS
    // custom properties re-resolve live if `body`'s `dark` class changes,
    // with no re-render needed.
    function installMobileTheme(documentRef) {
        var doc = documentRef || (typeof document !== 'undefined' ? document : null);
        if (!doc || !doc.head || doc.getElementById('gpc-mobile-theme-style')) return;
        var style = doc.createElement('style');
        style.id = 'gpc-mobile-theme-style';
        style.textContent = `
            :root {
                --gpp-mobile-surface: #ffffff;
                --gpp-mobile-surface-2: #f8fafc;
                --gpp-mobile-surface-3: #e5e7eb;
                --gpp-mobile-text: #111827;
                --gpp-mobile-text-2: #334155;
                --gpp-mobile-muted: #64748b;
                --gpp-mobile-border: #d1d5db;
                --gpp-mobile-focus: #2563eb;
                --gpp-mobile-focus-wash: rgba(37, 99, 235, .06);
                --gpp-mobile-danger: #dc2626;
                --gpp-mobile-shadow: rgba(15, 23, 42, .28);
            }
            body.dark {
                --gpp-mobile-surface: #1e1e2e;
                --gpp-mobile-surface-2: #181825;
                --gpp-mobile-surface-3: #313244;
                --gpp-mobile-text: #f5f5f5;
                --gpp-mobile-text-2: #cdd6f4;
                --gpp-mobile-muted: #a6adc8;
                --gpp-mobile-border: #45475a;
                --gpp-mobile-focus: #89b4fa;
                --gpp-mobile-focus-wash: rgba(137, 180, 250, .08);
                --gpp-mobile-danger: #f38ba8;
                --gpp-mobile-shadow: rgba(0, 0, 0, .6);
            }
        `;
        doc.head.appendChild(style);
    }

    // Small inline-SVG icon set replacing the previous unclear/obscure
    // unicode glyphs (a fisheye dot for "show all colors", a filled-square
    // glyph for "hide thumbnail", etc.) with crisp, single-color icons that
    // scale cleanly and can't render as a font-coverage tofu box. All are
    // 18x18 viewBoxes, stroke-based, `currentColor`, matching a plain flat
    // style rather than any particular icon library.
    var MOBILE_ICONS = {
        // 2x2 grid of small squares -- "every color swatch," for Show all colors.
        showAllColors: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2" width="6" height="6" rx="1"/><rect x="10" y="2" width="6" height="6" rx="1"/><rect x="2" y="10" width="6" height="6" rx="1"/><rect x="10" y="10" width="6" height="6" rx="1"/></svg>',
        // A single framed square with a slash -- "hide/collapse the preview thumbnail."
        hideThumbnail: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="12" height="12" rx="2"/><path d="M4 14 L14 4" stroke-linecap="round"/></svg>',
        // A plain gear -- "template settings" -- rendered as crisp strokes
        // instead of relying on a system emoji font's gear glyph.
        settings: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="9" r="2.6"/><path d="M9 2.4v2.1M9 13.5v2.1M15.6 9h-2.1M4.5 9H2.4M13.6 4.4l-1.5 1.5M5.9 12.1l-1.5 1.5M13.6 13.6l-1.5-1.5M5.9 5.9L4.4 4.4" stroke-linecap="round"/></svg>',
        // Ghost++'s own close glyph (U+2715), for visual consistency across
        // the desktop and mobile shells instead of two different X characters.
        close: '✕',
    };

    function mobileIconMarkup(name) {
        return MOBILE_ICONS[name] || '';
    }
