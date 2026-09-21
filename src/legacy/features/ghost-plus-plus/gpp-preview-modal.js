
    // ── Ghost++ larger-preview modal ─────────────────────────────────────
    // The "ℹ️ Larger preview" modal for a template: its full-resolution
    // image, the same 3-segment scan-progress readout as the Progress
    // section (bar doubles as the entry point to the contributions
    // leaderboard, see gpp-contributions.js), a Leaderboard button that
    // loads that same per-painter table inline into a collapsible section,
    // every colour in the template as a copyable hex list, and a
    // Buy-all-colors shortcut into Bulk Purchase Colors. Opened from the
    // ℹ️ button on the Ghost++ window's current-template frame
    // (gpp-library.js, .gpp-lib-current-info) and from Painting Menu
    // Overhaul's own ℹ️ on its preview thumbnail (mobile-painting.js,
    // .gpc-pmo-preview-info-btn).
    //
    // This began life inside Painting Menu Overhaul (mobile-painting.js's
    // openTemplatePreviewModal) and moved here so the Ghost++ window can
    // open it whether or not that extension is enabled; PMO now delegates
    // to gppPreviewModalOpen. The DOM id (#gpc-pmo-preview-modal) and the
    // .gpc-preview-modal-* class names were deliberately kept through the
    // move so it stays the same modal for anyone styling or scripting
    // against it. A genuine standalone overlay appended to document.body,
    // so t2() is the right theme signal, same as every other real modal in
    // this codebase; z-index matches core.js's own #gpc-settings-modal
    // convention (100000) — gpp-contributions.js's modal sits above it.
    //
    // Public surface:
    //   gppPreviewModalOpen(template)  — opens (or rebuilds) the modal.
    //   gppPreviewModalClose()         — removes it, if open.

    const GPP_PREVIEW_MODAL_STYLE_ID = 'gpp-preview-modal-style';
    const GPP_PREVIEW_MODAL_ID = 'gpc-pmo-preview-modal';

    // (Re)injected on every open so a live GeoPixels++ theme switch is
    // picked up by the next open, matching how the other Ghost++ sections
    // refresh their t2()-baked stylesheets.
    function gppPreviewModalInjectStyle() {
        let styleEl = document.getElementById(GPP_PREVIEW_MODAL_STYLE_ID);
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = GPP_PREVIEW_MODAL_STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = `
            .gpc-preview-modal-overlay {
                position: fixed; inset: 0; z-index: 100000;
                background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center;
                padding: 16px; box-sizing: border-box;
            }
            .gpc-preview-modal-box {
                width: 100%; max-width: 532px; max-height: 90vh; overflow-y: auto;
                box-sizing: border-box; padding: 14px; border-radius: 10px;
                background: ${t2('#ffffff', '#1e1e2e')}; color: ${t2('#111827', '#f5f5f5')};
                box-shadow: 0 12px 32px rgba(0,0,0,.4);
                display: flex; flex-direction: column; gap: 10px;
            }
            .gpc-preview-modal-header {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
            }
            .gpc-preview-modal-title {
                font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .gpc-preview-modal-close-btn {
                flex-shrink: 0; border: none; background: transparent; cursor: pointer;
                font-size: 14px; color: ${t2('#64748b', '#a6adc8')}; padding: 2px 4px;
            }
            /* Fresh gppLibraryRenderFullCanvas() call, independent of any
               thumbnail's own cached canvas -- a second call returns a
               second, unrelated <canvas>, so there's no node-sharing
               conflict with a thumbnail still showing behind this modal.
               max-width+max-height BOTH set as caps (neither one FIXED) with
               width/height:auto is the standard "fit within bounds, keep
               aspect ratio" CSS pattern. */
            .gpc-preview-modal-canvas-frame {
                display: flex; align-items: center; justify-content: center;
                max-height: 56vh; overflow: hidden;
                border: 1px solid ${t2('#d1d5db', '#45475a')}; border-radius: 6px;
                background: ${t2('rgba(0,0,0,.03)', 'rgba(255,255,255,.05)')};
            }
            .gpc-preview-modal-canvas-frame canvas {
                max-width: 100%; max-height: 56vh; width: auto; height: auto;
                display: block; image-rendering: pixelated;
            }
            .gpc-preview-modal-progress-wrap { display: flex; flex-direction: column; gap: 4px; }
            .gpc-preview-modal-bar-outer {
                display: flex; height: 10px; border-radius: 5px; overflow: hidden;
                background: ${t2('#e5e7eb', '#313244')};
            }
            .gpc-preview-modal-summary-line {
                font-size: 11px; color: ${t2('#475569', '#a6adc8')};
            }
            .gpc-preview-modal-colors-wrap { display: flex; flex-direction: column; gap: 4px; }
            .gpc-preview-modal-colors-wrap label {
                font-size: 11px; font-weight: 600; color: ${t2('#1f2937', '#e2e2f5')};
            }
            .gpc-preview-modal-colors-row { display: flex; gap: 6px; align-items: stretch; }
            .gpc-preview-modal-colors-row textarea {
                flex: 1 1 auto; min-width: 0; height: 70px; resize: vertical;
                font: 11px ui-monospace, Menlo, Consolas, monospace;
                padding: 6px; border-radius: 6px; box-sizing: border-box;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#f9fafb', '#181825')}; color: ${t2('#111827', '#f5f5f5')};
            }
            .gpc-preview-modal-copy-btn {
                flex-shrink: 0; width: 32px; border-radius: 6px; cursor: pointer;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#ffffff', '#313244')}; color: ${t2('#111827', '#f5f5f5')};
                font-size: 14px;
            }
            .gpc-preview-modal-copy-btn:hover { background: ${t2('#f3f4f6', '#45475a')}; }
            .gpc-preview-modal-buy-btn {
                font: inherit; font-weight: 600; padding: 8px; border-radius: 6px; cursor: pointer;
                border: 1px solid ${t2('#2563eb', '#89b4fa')};
                background: ${t2('#2563eb', '#89b4fa')}; color: ${t2('#ffffff', '#1e1e2e')};
            }
            .gpc-preview-modal-buy-btn:hover { opacity: .9; }
            .gpc-preview-modal-leaderboard:empty { display: none; }
            .gpc-preview-modal-leaderboard-btn {
                width: 100%; font: inherit; font-weight: 600; padding: 8px; border-radius: 6px; cursor: pointer;
                border: 1px solid ${t2('#d1d5db', '#45475a')};
                background: ${t2('#ffffff', '#313244')}; color: ${t2('#111827', '#f5f5f5')};
            }
            .gpc-preview-modal-leaderboard-btn:hover { background: ${t2('#f3f4f6', '#45475a')}; }
            /* Reuses Ghost++'s own details.gpp-collapsible look (global rules,
               gpp-ui-shell.js) with the panel's side padding removed, since
               this one sits inside the modal box rather than a panel. */
            details.gpc-preview-modal-leaderboard-details { padding: 8px 0 0; font-size: 12px; }
            details.gpc-preview-modal-leaderboard-details .gpp-body { padding: 8px 0 0; overflow-x: auto; }
        `;
    }

    let gppPreviewModalEscHandler = null;
    let gppPreviewModalLeaderboardRun = null; // { cancelled } for an inline leaderboard still loading

    function gppPreviewModalClose() {
        const existing = document.getElementById(GPP_PREVIEW_MODAL_ID);
        if (existing) existing.remove();
        if (gppPreviewModalEscHandler) {
            document.removeEventListener('keydown', gppPreviewModalEscHandler);
            gppPreviewModalEscHandler = null;
        }
        if (gppPreviewModalLeaderboardRun) {
            gppPreviewModalLeaderboardRun.cancelled = true;
            gppPreviewModalLeaderboardRun = null;
        }
    }

    // "Leaderboard" — the same per-painter table the contributions modal
    // shows (gpp-contributions.js), loaded inline on demand: one click
    // replaces the button with a collapsible <details> that first shows the
    // loading readout and then the table, so a long list can be folded away
    // again without leaving the modal. Only offered once there's a scan with
    // opaque pixels to attribute — the same gate as the clickable bar.
    function gppPreviewModalLeaderboard(template) {
        const section = document.createElement('div');
        section.id = 'gpp-preview-modal-leaderboard';
        section.className = 'gpc-preview-modal-leaderboard';
        if (typeof gppContributionsLoad !== 'function' || !template.position || !template.scanSummary || !(template.scanSummary.total > 0)) return section;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'gpp-preview-modal-leaderboard-btn';
        btn.className = 'gpc-preview-modal-leaderboard-btn';
        btn.textContent = 'Leaderboard';
        btn.title = 'Who painted this template — correct and incorrect pixels per painter, from the last scan';
        btn.addEventListener('click', () => {
            const t = gppContribThemeColors();
            const run = { cancelled: false };
            if (gppPreviewModalLeaderboardRun) gppPreviewModalLeaderboardRun.cancelled = true;
            gppPreviewModalLeaderboardRun = run;

            const details = document.createElement('details');
            details.className = 'gpp-collapsible gpc-preview-modal-leaderboard-details';
            details.open = true;
            const summary = document.createElement('summary');
            summary.textContent = 'Leaderboard';
            const body = document.createElement('div');
            body.className = 'gpp-body';
            body.innerHTML = '<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 0; color: ' + t.textSecondary + ';">'
                + '<div style="font-size: 28px; margin-bottom: 12px;">⏳</div>'
                + '<div id="gpp-preview-modal-leaderboard-progress">Reading the scan…</div>'
                + '</div>';
            details.append(summary, body);
            btn.replaceWith(details);

            const progressEl = body.querySelector('#gpp-preview-modal-leaderboard-progress');
            gppContributionsLoad(template, run, text => { if (progressEl && progressEl.isConnected) progressEl.textContent = text; })
                .then(result => {
                    if (!result || run.cancelled || !body.isConnected) return;
                    gppContribRenderResult(body, result.rows, result.counts, t);
                })
                .catch(error => {
                    console.error('[GeoPixelcons++] Ghost++ preview leaderboard failed:', error);
                    if (body.isConnected) body.innerHTML = gppContribErrorHtml(error, t);
                })
                .finally(() => { if (gppPreviewModalLeaderboardRun === run) gppPreviewModalLeaderboardRun = null; });
        });
        section.appendChild(btn);
        return section;
    }

    // Fresh gppLibraryRenderFullCanvas() call -- see the canvas-frame CSS
    // comment above for why a fresh canvas rather than a shared one.
    function gppPreviewModalCanvas(template) {
        const frame = document.createElement('div');
        frame.className = 'gpc-preview-modal-canvas-frame';
        const canvas = gppLibraryRenderFullCanvas(template);
        if (canvas) frame.appendChild(canvas);
        return frame;
    }

    // Mirrors gpp-scan.js's own gppRenderProgressBar readout exactly (same
    // 3-segment correct/wrong/not-yet-placed bar, same summary text
    // including gppScanFormatRelativeTime's real relative-time formatting,
    // called directly rather than reimplemented) for whichever of its
    // states currently applies -- not placed yet, not scanned yet, no
    // opaque pixels, or a real scan result.
    function gppPreviewModalProgress(template) {
        const wrap = document.createElement('div');
        wrap.className = 'gpc-preview-modal-progress-wrap';

        const barOuter = document.createElement('div');
        barOuter.className = 'gpc-preview-modal-bar-outer';
        wrap.appendChild(barOuter);

        const summaryLine = document.createElement('div');
        summaryLine.className = 'gpc-preview-modal-summary-line';
        wrap.appendChild(summaryLine);

        const neutralSeg = () => {
            const seg = document.createElement('div');
            seg.style.cssText = 'width:100%; background:' + t2('#cbd5e1', '#45475a') + ';';
            barOuter.appendChild(seg);
        };

        if (!template.position) {
            barOuter.style.opacity = '0.4';
            summaryLine.textContent = 'Place the template on the map, then scan to see progress.';
        } else if (!template.scanSummary) {
            neutralSeg();
            summaryLine.textContent = 'Not scanned yet.';
        } else {
            const summary = template.scanSummary;
            const total = summary.total;
            if (total <= 0) {
                neutralSeg();
                summaryLine.textContent = 'Template has no opaque pixels — nothing to show.';
            } else {
                const notPlaced = Math.max(0, total - summary.correct - summary.wrong);
                const pct = value => (value / total) * 100;

                const correctSeg = document.createElement('div');
                correctSeg.style.cssText = `width:${pct(summary.correct)}%; background:${t2('#16a34a', '#a6e3a1')};`;
                correctSeg.title = `Correct: ${summary.correct.toLocaleString()} px`;
                barOuter.appendChild(correctSeg);

                const wrongSeg = document.createElement('div');
                wrongSeg.style.cssText = `width:${pct(summary.wrong)}%; background:${t2('#dc2626', '#f38ba8')};`;
                wrongSeg.title = `Wrong color: ${summary.wrong.toLocaleString()} px`;
                barOuter.appendChild(wrongSeg);

                const notPlacedSeg = document.createElement('div');
                notPlacedSeg.style.cssText = `width:${pct(notPlaced)}%; background:${t2('#94a3b8', '#6c7086')};`;
                notPlacedSeg.title = `Not yet placed: ${notPlaced.toLocaleString()} px`;
                barOuter.appendChild(notPlacedSeg);

                // Same entry point to the per-painter leaderboard as the real
                // Progress bar (gpp-contributions.js); it opens above this modal.
                if (typeof gppContribMakeBarClickable === 'function') gppContribMakeBarClickable(barOuter, template);

                const donePct = Math.round(pct(summary.correct));
                summaryLine.textContent = `${summary.correct.toLocaleString()} completed of ${total.toLocaleString()} total (${donePct}%)`
                    + (summary.scannedAt ? ` — scanned ${gppScanFormatRelativeTime(summary.scannedAt)}` : '');
            }
        }
        return wrap;
    }

    // Every colour in the template, in palette order, as "#RRGGBB, #RRGGBB"
    // -- the same list Painting Menu Overhaul's "Get hex values > all" copies.
    function gppPreviewModalHexList(template, core) {
        const hexes = [];
        for (let index = 0; index < template.palette.length; index++) hexes.push(core.packedToHex(template.palette[index]));
        return hexes;
    }

    function gppPreviewModalColors(template, core) {
        const wrap = document.createElement('div');
        wrap.className = 'gpc-preview-modal-colors-wrap';

        const label = document.createElement('label');
        label.htmlFor = 'gpc-preview-modal-colors-textarea';
        label.textContent = 'Colors in this template';
        wrap.appendChild(label);

        const row = document.createElement('div');
        row.className = 'gpc-preview-modal-colors-row';

        const textarea = document.createElement('textarea');
        textarea.id = 'gpc-preview-modal-colors-textarea';
        textarea.readOnly = true;
        textarea.value = gppPreviewModalHexList(template, core).join(', ');
        row.appendChild(textarea);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'gpc-preview-modal-copy-btn';
        copyBtn.title = 'Copy to clipboard';
        copyBtn.textContent = '📋';
        copyBtn.addEventListener('click', () => {
            const hexes = gppPreviewModalHexList(template, core);
            const text = hexes.join(', ');
            const confirm = () => {
                const target = gppNativeBridgeTarget();
                if (typeof target.showAlert === 'function') target.showAlert('Success', `${hexes.length.toLocaleString()} color${hexes.length === 1 ? '' : 's'} copied to clipboard.`);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(confirm).catch(() => alert(text || 'No colors.'));
            } else {
                alert(text || 'No colors.');
            }
        });
        row.appendChild(copyBtn);

        wrap.appendChild(row);
        return wrap;
    }

    // Mirrors gpp-palette.js's own buyBtn click handler exactly (same
    // owned-check + dedup + needed-list computation, same disabled/all-
    // owned guard messages) -- duplicated rather than called since it's
    // inline inside that file's own private closure, not a reachable
    // function, but the ACTUAL "reveal profile panel, scroll, populate
    // textarea" behavior still goes through the one real function
    // (gppBulkPurchaseOpenProfilePanel), not reimplemented. Closes this
    // modal afterward so it doesn't sit on top of the profile panel it
    // just opened.
    function gppPreviewModalBuyAll(template, core) {
        const buyBtn = document.createElement('button');
        buyBtn.type = 'button';
        buyBtn.className = 'gpc-preview-modal-buy-btn';
        buyBtn.textContent = 'Buy all colors';
        buyBtn.title = "Reveal the profile panel's Bulk Purchase Colors card, pre-filled with every color in this template you don't already own";
        buyBtn.addEventListener('click', () => {
            if (typeof gppBulkPurchaseOpenProfilePanel !== 'function') {
                alert('Bulk Purchase Colors is disabled in GeoPixelcons++ settings.');
                return;
            }
            const ownedHex = new Set(((typeof gppReadGamePalette === 'function') ? gppReadGamePalette() : []).map(row => String(row.hex).toUpperCase()));
            const seen = new Set();
            const needed = [];
            for (let index = 0; index < template.palette.length; index++) {
                const hex = core.packedToHex(template.palette[index]);
                if (ownedHex.has(hex) || seen.has(hex)) continue;
                seen.add(hex);
                needed.push(hex);
            }
            if (!needed.length) {
                alert('Every color in this template is already owned.');
                return;
            }
            gppBulkPurchaseOpenProfilePanel(needed);
            gppPreviewModalClose();
        });
        return buyBtn;
    }

    function gppPreviewModalOpen(template) {
        if (!template) return;
        gppPreviewModalClose(); // always rebuilt fresh, never reused stale
        gppPreviewModalInjectStyle();
        const core = gppCreateCore();

        const overlay = document.createElement('div');
        overlay.id = GPP_PREVIEW_MODAL_ID;
        overlay.className = 'gpc-preview-modal-overlay';
        overlay.addEventListener('click', event => {
            if (event.target === overlay) gppPreviewModalClose();
        });

        const box = document.createElement('div');
        box.className = 'gpc-preview-modal-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        overlay.appendChild(box);

        const headerRow = document.createElement('div');
        headerRow.className = 'gpc-preview-modal-header';
        const title = document.createElement('div');
        title.className = 'gpc-preview-modal-title';
        title.textContent = template.name || 'Template preview';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gpc-preview-modal-close-btn';
        closeBtn.textContent = '✖';
        closeBtn.title = 'Close';
        closeBtn.addEventListener('click', gppPreviewModalClose);
        headerRow.append(title, closeBtn);
        box.appendChild(headerRow);

        box.appendChild(gppPreviewModalCanvas(template));
        box.appendChild(gppPreviewModalProgress(template));
        box.appendChild(gppPreviewModalLeaderboard(template));
        box.appendChild(gppPreviewModalColors(template, core));
        box.appendChild(gppPreviewModalBuyAll(template, core));

        document.body.appendChild(overlay);

        // The contributions leaderboard (opened from this modal's own scan
        // bar) stacks above this one and owns Escape while it is showing.
        gppPreviewModalEscHandler = event => {
            if (event.key !== 'Escape' || document.getElementById('gpp-contrib-modal-container')) return;
            gppPreviewModalClose();
        };
        document.addEventListener('keydown', gppPreviewModalEscHandler);
    }
