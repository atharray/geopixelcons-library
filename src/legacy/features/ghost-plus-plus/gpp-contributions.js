
    // ── Ghost++ template contributions ("who painted this template") ────
    // Opened by clicking the Progress section's scan bar (#gpp-scan-bar-
    // outer — see gppRenderProgressBar in gpp-scan.js), its Painting Menu
    // Overhaul mirror, or the PMO larger-preview modal's own bar. A per-
    // painter leaderboard for the FOCUSED template, computed strictly from
    // the last scan: every opaque template cell whose scan state is CORRECT
    // or WRONG is attributed to whoever painted it, read from the site's
    // per-tile `userBitmap` (RGB-encoded userId, laid out exactly like the
    // colorBitmap the scan itself samples — the same field Regions
    // Highscore reads). Cells the template leaves transparent, and MISSING /
    // UNKNOWN cells, contribute nothing — unlike Regions Highscore, which
    // counts every painted pixel inside a rectangle regardless of any
    // template.
    //   correct[user] = cells the user painted in the template's colour
    //                   (Group noise near-duplicates included, exactly as
    //                   the scan classified them)
    //   wrong[user]   = cells the user painted in a different colour
    // A tile that has left the cache since the scan (Improved Map
    // Rendering's cache budget can evict) is fetched back from
    // /GetPixelsCached, one tile per request like Regions Highscore does;
    // a tile that still can't be read leaves its cells "unattributed",
    // which the summary reports rather than silently dropping.
    //
    // The modal deliberately copies Regions Highscore's leaderboard modal
    // (regions-highscore.js's createLeaderboardModal/createLeaderboardTable:
    // same colour values, layout, close button, backdrop-click and Escape)
    // so the two read as one family — with gpp- ids/classes and Ghost++'s
    // own isDarkMode() rule (core.js) rather than that file's colorScheme
    // check, so it agrees with the Ghost++ window it was opened from.
    //
    // Public surface:
    //   gppContributionsOpen(template) — opens (or re-opens) the modal for
    //                                    a positioned, scanned template.

    const GPP_CONTRIB_BAND_ROWS = 128;         // rows per getImageData batch, same as the scan
    const GPP_CONTRIB_USERNAME_BATCH = 10;     // parallel /GetUserProfile lookups, same as Regions Highscore
    const GPP_CONTRIB_Z_INDEX = 100040;        // above the PMO preview modal (100000), below #alertBox (100050)
    const gppContribUsernameCache = new Map(); // userId -> name, for the page session

    let gppContribOpenRun = null; // { cancelled } for the modal currently open, so closing it stops its work

    function gppContribThemeColors() {
        const dark = isDarkMode();
        return {
            modalBg: dark ? '#1e2939' : 'white',
            overlayBg: dark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
            text: dark ? '#f3f4f6' : '#333',
            textSecondary: dark ? '#d1d5db' : '#666',
            textMuted: dark ? '#99a1af' : '#888',
            textSubtle: dark ? '#6a7282' : '#999',
            border: dark ? '#364153' : '#eee',
            headerBg: dark ? '#101828' : '#f0f0f0',
            summaryBg: dark ? '#101828' : '#f8f9fa',
            summaryText: dark ? '#d1d5db' : '#555',
            closeBtnColor: dark ? '#99a1af' : '#666',
            closeBtnHoverBg: dark ? '#364153' : '#f0f0f0',
            closeBtnHoverColor: dark ? '#f3f4f6' : '#333',
        };
    }

    function gppContribEscapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function gppContribYield() {
        return new Promise(resolve => {
            if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 50 });
            else window.setTimeout(resolve, 0);
        });
    }

    // ── owner data ────────────────────────────────────────────────────

    function gppContribDecodeWebP(base64) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => createImageBitmap(img).then(resolve, reject);
            img.onerror = () => reject(new Error('Could not decode the tile image.'));
            img.src = 'data:image/webp;base64,' + base64;
        });
    }

    async function gppContribBitmapFromDeltas(deltas, tileX, tileY, tileSize) {
        const canvas = new OffscreenCanvas(tileSize, tileSize);
        const ctx = canvas.getContext('2d');
        for (const delta of deltas) {
            const gridX = delta[0], gridY = delta[1], userId = delta[3];
            ctx.fillStyle = 'rgb(' + ((userId >> 16) & 255) + ',' + ((userId >> 8) & 255) + ',' + (userId & 255) + ')';
            ctx.fillRect(gridX - tileX, gridY - tileY, 1, 1);
        }
        return createImageBitmap(canvas);
    }

    // Fallback for a tile the site no longer holds: the same request the
    // site's own sync makes for a full tile (timestamp 0 => full WebP).
    async function gppContribFetchTileUserBitmap(tileX, tileY, tileSize) {
        const response = await fetch('https://geopixels.net/GetPixelsCached', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Tiles: [{ x: tileX, y: tileY, timestamp: 0 }] }),
        });
        if (!response.ok) throw new Error('Tile request failed (' + response.status + ').');
        const data = await response.json();
        const info = data && data.Tiles ? data.Tiles['tile_' + tileX + '_' + tileY] : null;
        if (!info) return null;
        if (info.Type === 'full' && info.UserWebP) return gppContribDecodeWebP(info.UserWebP);
        if (Array.isArray(info.Pixels) && info.Pixels.length) return gppContribBitmapFromDeltas(info.Pixels, tileX, tileY, tileSize);
        return null;
    }

    // Walks the same tile rectangles the scan walked, reading the owner
    // bitmap where the scan read the colour bitmap, and buckets every
    // CORRECT/WRONG cell by painter. `states` is frozen at call time so a
    // rescan finishing mid-way can never mix two scans' results.
    async function gppContribComputeCounts(template, run, onProgress) {
        const core = gppCreateCore();
        const ERROR_STATE = core.constants.ERROR_STATE;
        const grid = gppReadGridConstants();
        const tileSize = grid.tileSize;
        const bounds = core.computeGridBounds(template.position, template.width, template.height);
        if (!bounds) throw new Error('Template has no position.');
        const states = template.scanSummary.states;
        const indices = template.indices;
        const empty = core.emptyValue(template.indexType);
        const width = template.width;

        const users = new Map(); // userId -> { correct, wrong }
        let attributed = 0;
        let unattributed = 0;

        const tiles = [];
        for (let tileX = Math.floor(bounds.left / tileSize) * tileSize; tileX <= Math.floor(bounds.right / tileSize) * tileSize; tileX += tileSize) {
            for (let tileY = Math.floor(bounds.bottom / tileSize) * tileSize; tileY <= Math.floor(bounds.top / tileSize) * tileSize; tileY += tileSize) {
                tiles.push([tileX, tileY]);
            }
        }

        const scratch = new OffscreenCanvas(1, 1);
        const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });

        for (let t = 0; t < tiles.length; t++) {
            if (run.cancelled) return null;
            const tileX = tiles[t][0], tileY = tiles[t][1];
            const xMin = Math.max(bounds.left, tileX);
            const xMax = Math.min(bounds.right, tileX + tileSize - 1);
            const yMin = Math.max(bounds.bottom, tileY);
            const yMax = Math.min(bounds.top, tileY + tileSize - 1);
            if (xMin > xMax || yMin > yMax) continue;
            const regionWidth = xMax - xMin + 1;
            const regionHeight = yMax - yMin + 1;

            // Does this tile hold anything attributable at all? Skip the
            // bitmap work (and any network fallback) when it doesn't.
            let wanted = 0;
            for (let gridY = yMax; gridY >= yMin; gridY--) {
                const localY = bounds.top - gridY;
                let pixel = localY * width + (xMin - bounds.left);
                for (let gridX = xMin; gridX <= xMax; gridX++, pixel++) {
                    const state = states[pixel];
                    if ((state === ERROR_STATE.CORRECT || state === ERROR_STATE.WRONG) && indices[pixel] !== empty) wanted++;
                }
            }
            if (!wanted) continue;

            onProgress('Reading tile ' + (t + 1) + ' of ' + tiles.length + '…');
            let userBitmap = gppGetTileUserBitmap(tileX, tileY);
            let fetched = null;
            if (!userBitmap) {
                onProgress('Fetching tile ' + (t + 1) + ' of ' + tiles.length + ' from the server…');
                try { fetched = await gppContribFetchTileUserBitmap(tileX, tileY, tileSize); } catch (_) { fetched = null; }
                userBitmap = fetched;
            }
            if (run.cancelled) { if (fetched) fetched.close(); return null; }
            if (!userBitmap) { unattributed += wanted; continue; }

            let cropped = null;
            try {
                cropped = await createImageBitmap(userBitmap, xMin - tileX, yMin - tileY, regionWidth, regionHeight);
            } catch (_) {
                cropped = null;
            }
            if (!cropped) { unattributed += wanted; if (fetched) fetched.close(); continue; }

            try {
                // Bitmap row r holds grid row yMin + r (tiles are stored
                // south-up, row 0 = the tile's minimum grid Y), so a band of
                // bitmap rows [bandStart, bandStart + bandRows) covers grid
                // rows yMin + bandStart .. upward — read as-is and mapped
                // back to template rows (north-first) per cell, no flip
                // transform needed.
                for (let bandStart = 0; bandStart < regionHeight; bandStart += GPP_CONTRIB_BAND_ROWS) {
                    if (run.cancelled) return null;
                    const bandRows = Math.min(GPP_CONTRIB_BAND_ROWS, regionHeight - bandStart);
                    if (scratch.width !== regionWidth || scratch.height !== bandRows) { scratch.width = regionWidth; scratch.height = bandRows; }
                    scratchCtx.clearRect(0, 0, regionWidth, bandRows);
                    scratchCtx.drawImage(cropped, 0, bandStart, regionWidth, bandRows, 0, 0, regionWidth, bandRows);
                    const data = scratchCtx.getImageData(0, 0, regionWidth, bandRows).data;
                    for (let r = 0; r < bandRows; r++) {
                        const gridY = yMin + bandStart + r;
                        const localY = bounds.top - gridY;
                        let pixel = localY * width + (xMin - bounds.left);
                        let offset = r * regionWidth * 4;
                        for (let gridX = xMin; gridX <= xMax; gridX++, pixel++, offset += 4) {
                            const state = states[pixel];
                            if (state !== ERROR_STATE.CORRECT && state !== ERROR_STATE.WRONG) continue;
                            if (indices[pixel] === empty) continue;
                            const userId = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
                            if (!userId) { unattributed++; continue; }
                            let entry = users.get(userId);
                            if (!entry) { entry = { correct: 0, wrong: 0 }; users.set(userId, entry); }
                            if (state === ERROR_STATE.CORRECT) entry.correct++; else entry.wrong++;
                            attributed++;
                        }
                    }
                    await gppContribYield();
                }
            } finally {
                cropped.close();
                if (fetched) fetched.close();
            }
        }

        return { users, attributed, unattributed };
    }

    async function gppContribFetchUsernames(userIds, run, onProgress) {
        const names = new Map();
        const pending = [];
        for (const id of userIds) {
            if (gppContribUsernameCache.has(id)) names.set(id, gppContribUsernameCache.get(id));
            else pending.push(id);
        }
        for (let i = 0; i < pending.length; i += GPP_CONTRIB_USERNAME_BATCH) {
            if (run.cancelled) return null;
            onProgress('Looking up painters… ' + Math.min(pending.length, i + GPP_CONTRIB_USERNAME_BATCH) + ' of ' + pending.length);
            const batch = pending.slice(i, i + GPP_CONTRIB_USERNAME_BATCH);
            const results = await Promise.all(batch.map(async userId => {
                try {
                    const response = await fetch('https://geopixels.net/GetUserProfile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ targetId: userId }),
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (data && data.name) return [userId, String(data.name)];
                    }
                } catch (_) { /* fall through to the placeholder name */ }
                return [userId, 'User #' + userId];
            }));
            for (const [userId, name] of results) {
                gppContribUsernameCache.set(userId, name);
                names.set(userId, name);
            }
        }
        return names;
    }

    // Ranked by correct pixels, then fewest wrong, then userId for a stable
    // order between equally-placed painters.
    function gppContribRank(users, names) {
        const rows = Array.from(users, ([userId, entry]) => ({ userId, name: names.get(userId) || ('User #' + userId), correct: entry.correct, wrong: entry.wrong }));
        rows.sort((a, b) => (b.correct - a.correct) || (a.wrong - b.wrong) || (a.userId - b.userId));
        rows.forEach((row, index) => { row.rank = index + 1; });
        return rows;
    }

    // ── modal ─────────────────────────────────────────────────────────

    function gppContribRankEmoji(rank) {
        return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
    }

    function gppContribRankBackground(rank) {
        return rank === 1 ? 'rgba(255, 215, 0, 0.15)' : rank === 2 ? 'rgba(192, 192, 192, 0.15)' : rank === 3 ? 'rgba(205, 127, 50, 0.15)' : 'transparent';
    }

    function gppContribCloseModal() {
        const existing = document.getElementById('gpp-contrib-modal-container');
        if (existing) existing.remove();
        if (gppContribOpenRun) { gppContribOpenRun.cancelled = true; gppContribOpenRun = null; }
    }

    function gppContribBuildTable(rows, counts, t) {
        const container = document.createElement('div');
        const totalCorrect = rows.reduce((sum, row) => sum + row.correct, 0);
        const totalWrong = rows.reduce((sum, row) => sum + row.wrong, 0);

        const summary = document.createElement('div');
        summary.id = 'gpp-contrib-summary';
        summary.style.cssText = 'margin-bottom: 16px; padding: 12px; background: ' + t.summaryBg + '; border-radius: 8px; font-size: 14px; color: ' + t.summaryText + ';';
        summary.innerHTML = '<strong>' + rows.length.toLocaleString() + '</strong> painter' + (rows.length === 1 ? '' : 's') + ' placed <strong>'
            + totalCorrect.toLocaleString() + '</strong> correct pixel' + (totalCorrect === 1 ? '' : 's') + ' and <strong>'
            + totalWrong.toLocaleString() + '</strong> wrong-colour pixel' + (totalWrong === 1 ? '' : 's') + ' on this template'
            + (counts.unattributed ? '<br><span style="font-size: 12px; color: ' + t.textMuted + ';">' + counts.unattributed.toLocaleString() + ' painted pixel' + (counts.unattributed === 1 ? '' : 's') + ' could not be attributed (tile data unavailable)</span>' : '');
        container.appendChild(summary);

        const table = document.createElement('table');
        table.id = 'gpp-contrib-table';
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 14px; color: ' + t.text + ';';
        const thead = document.createElement('thead');
        thead.innerHTML = '<tr style="background: ' + t.headerBg + '; text-align: left;">'
            + '<th style="padding: 10px 12px; font-weight: 600; width: 60px;">Rank</th>'
            + '<th style="padding: 10px 12px; font-weight: 600;">Username</th>'
            + '<th style="padding: 10px 12px; font-weight: 600; text-align: right; width: 100px;" title="Pixels placed in the template\'s colour">Correct</th>'
            + '<th style="padding: 10px 12px; font-weight: 600; text-align: right; width: 100px;" title="Pixels placed in a different colour than the template">Incorrect</th>'
            + '<th style="padding: 10px 12px; font-weight: 600; text-align: right; width: 80px;" title="Share of all correct pixels">%</th>'
            + '</tr>';
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        for (const row of rows) {
            const tr = document.createElement('tr');
            tr.className = 'gpp-contrib-row';
            tr.style.cssText = 'border-bottom: 1px solid ' + t.border + ';' + (row.rank <= 3 ? ' background: ' + gppContribRankBackground(row.rank) + ';' : '');
            const percent = totalCorrect > 0 ? ((row.correct / totalCorrect) * 100).toFixed(1) : '0.0';
            tr.innerHTML = '<td style="padding: 10px 12px; font-weight: ' + (row.rank <= 3 ? 'bold' : 'normal') + ';">' + gppContribRankEmoji(row.rank) + ' ' + row.rank + '</td>'
                + '<td style="padding: 10px 12px;">' + gppContribEscapeHtml(row.name) + '</td>'
                + '<td style="padding: 10px 12px; text-align: right; font-family: monospace;">' + row.correct.toLocaleString() + '</td>'
                + '<td style="padding: 10px 12px; text-align: right; font-family: monospace;' + (row.wrong ? ' color: ' + t2('#dc2626', '#f38ba8') + ';' : '') + '">' + row.wrong.toLocaleString() + '</td>'
                + '<td style="padding: 10px 12px; text-align: right; color: ' + t.textSecondary + ';">' + percent + '%</td>';
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        container.appendChild(table);
        return container;
    }

    function gppContribCreateModal(template, t) {
        gppContribCloseModal();
        const summary = template.scanSummary;

        const modalContainer = document.createElement('div');
        modalContainer.id = 'gpp-contrib-modal-container';
        modalContainer.className = 'gpp-contrib-modal-container';
        modalContainer.style.cssText = 'position: fixed; inset: 0; z-index: ' + GPP_CONTRIB_Z_INDEX + '; background: ' + t.overlayBg + '; display: flex; align-items: center; justify-content: center;';

        const modal = document.createElement('div');
        modal.id = 'gpp-contrib-modal';
        modal.className = 'gpp-contrib-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'gpp-contrib-title');
        modal.style.cssText = 'position: relative; background: ' + t.modalBg + '; color: ' + t.text + '; border-radius: 12px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3); padding: 24px; min-width: 400px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column;';

        const closeBtn = document.createElement('button');
        closeBtn.id = 'gpp-contrib-close';
        closeBtn.type = 'button';
        closeBtn.innerHTML = '✕';
        closeBtn.title = 'Close';
        closeBtn.style.cssText = 'position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 20px; cursor: pointer; color: ' + t.closeBtnColor + '; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s;';
        closeBtn.onmouseover = () => { closeBtn.style.background = t.closeBtnHoverBg; closeBtn.style.color = t.closeBtnHoverColor; };
        closeBtn.onmouseout = () => { closeBtn.style.background = 'none'; closeBtn.style.color = t.closeBtnColor; };

        const header = document.createElement('div');
        header.id = 'gpp-contrib-header';
        header.style.cssText = 'margin-bottom: 16px; padding-right: 32px;';
        const scanned = summary.scannedAt ? ' — scanned ' + gppScanFormatRelativeTime(summary.scannedAt) : '';
        header.innerHTML = '<h2 id="gpp-contrib-title" style="margin: 0 0 8px 0; font-size: 24px; font-weight: bold; color: ' + t.text + ';">📊 Template Contributions</h2>'
            + '<p style="margin: 0; color: ' + t.textSecondary + '; font-size: 14px;">' + gppContribEscapeHtml(template.name || 'Template') + ': ' + template.width + ' × ' + template.height + ' cells, ' + summary.total.toLocaleString() + ' opaque pixels</p>'
            + '<p style="margin: 4px 0 0 0; color: ' + t.textMuted + '; font-size: 12px; font-family: monospace;">' + summary.correct.toLocaleString() + ' correct, ' + summary.wrong.toLocaleString() + ' wrong colour, ' + summary.missing.toLocaleString() + ' missing' + gppContribEscapeHtml(scanned) + '</p>';

        const content = document.createElement('div');
        content.id = 'gpp-contrib-modal-content';
        content.className = 'gpp-contrib-modal-content';
        content.style.cssText = 'flex: 1; overflow-y: auto; min-height: 200px;';
        content.innerHTML = '<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: ' + t.textSecondary + ';">'
            + '<div style="font-size: 32px; margin-bottom: 16px;">⏳</div>'
            + '<div id="gpp-contrib-progress-text" class="gpp-contrib-progress-text">Reading the scan…</div>'
            + '<div style="font-size: 12px; margin-top: 8px; color: ' + t.textSubtle + ';">This may take a moment for large templates</div>'
            + '</div>';

        modal.append(closeBtn, header, content);
        modalContainer.appendChild(modal);
        document.body.appendChild(modalContainer);

        const escHandler = event => {
            if (event.key !== 'Escape') return;
            document.removeEventListener('keydown', escHandler);
            gppContribCloseModal();
        };
        closeBtn.addEventListener('click', () => { document.removeEventListener('keydown', escHandler); gppContribCloseModal(); });
        modalContainer.addEventListener('click', event => {
            if (event.target !== modalContainer) return;
            document.removeEventListener('keydown', escHandler);
            gppContribCloseModal();
        });
        document.addEventListener('keydown', escHandler);
        return { modalContainer, content };
    }

    function gppContribSetContent(content, html) {
        content.innerHTML = html;
    }

    async function gppContributionsOpen(template) {
        if (!template || !template.position || !template.scanSummary) return { ok: false, reason: 'not-scanned' };
        const t = gppContribThemeColors();
        const run = { cancelled: false };
        const { modalContainer, content } = gppContribCreateModal(template, t);
        gppContribOpenRun = run;
        const progressEl = content.querySelector('#gpp-contrib-progress-text');
        const onProgress = text => { if (progressEl && progressEl.isConnected) progressEl.textContent = text; };
        try {
            const counts = await gppContribComputeCounts(template, run, onProgress);
            if (!counts || run.cancelled) return { ok: false, reason: 'cancelled' };
            const names = await gppContribFetchUsernames(Array.from(counts.users.keys()), run, onProgress);
            if (!names || run.cancelled) return { ok: false, reason: 'cancelled' };
            const rows = gppContribRank(counts.users, names);
            if (!modalContainer.isConnected) return { ok: false, reason: 'cancelled' };
            if (!rows.length) {
                gppContribSetContent(content, '<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 150px; color: ' + t.textSecondary + ';">'
                    + '<div style="font-size: 32px; margin-bottom: 16px;">🤷</div>'
                    + '<div>No painted pixels could be attributed for this template' + (counts.unattributed ? ' (' + counts.unattributed.toLocaleString() + ' painted pixels had no tile data)' : '') + '</div>'
                    + '<div style="font-size: 12px; margin-top: 8px; color: ' + t.textSubtle + ';">Scan progress with the template on screen, then try again.</div>'
                    + '</div>');
            } else {
                content.innerHTML = '';
                content.appendChild(gppContribBuildTable(rows, counts, t));
            }
            return { ok: true, rows, counts };
        } catch (error) {
            console.error('[GeoPixelcons++] Ghost++ contributions failed:', error);
            if (modalContainer.isConnected) {
                gppContribSetContent(content, '<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 150px; color: ' + t.textSecondary + ';">'
                    + '<div style="font-size: 32px; margin-bottom: 16px;">⚠️</div>'
                    + '<div>Could not compute contributions: ' + gppContribEscapeHtml(error && error.message ? error.message : String(error)) + '</div>'
                    + '</div>');
            }
            return { ok: false, reason: 'error', error };
        }
    }

    // Marks a rendered scan bar as the entry point to this modal: the
    // pointer cursor + hover ring (.gpp-scan-bar-clickable, gpp-ui-shell.js
    // / mobile-painting.js's tc() twin) and keyboard access. Only ever
    // called for a scanned template with opaque pixels — an unscanned bar
    // has nothing to show and stays inert.
    function gppContribMakeBarClickable(barEl, template) {
        if (!barEl || !template) return;
        barEl.classList.add('gpp-scan-bar-clickable');
        barEl.setAttribute('role', 'button');
        barEl.tabIndex = 0;
        barEl.title = 'Click to see who painted this template';
        barEl.addEventListener('click', () => { gppContributionsOpen(template); });
        barEl.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            gppContributionsOpen(template);
        });
    }
