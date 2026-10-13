// tests/regression/guild-panel-touch.mjs
//
// Real-browser regression check for issue #76: the Guild Panel must open fully
// on a phone-width viewport and move/resize by touch with the viewport clamp.
//
// The helper block under test is read live from
// src/legacy/features/guild-overhaul.js (between the "Floating panel placement"
// marker and updateSnapshotIntervalUI) and executed in a headless Chrome/Edge
// page against a small DOM fixture that mirrors the panel markup. Pointer
// events are dispatched synthetically (pointerType 'touch' / 'mouse').
//
// Usage:  node tests/regression/guild-panel-touch.mjs
// Exit code is non-zero if any assertion failed or the browser run crashed.
// Needs a locally installed Chrome or Edge (or CHROME_PATH / BROWSER_PATH).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const GUILD_FILE = resolve(TEST_DIR, '..', '..', 'src', 'legacy', 'features', 'guild-overhaul.js');
const BLOCK_START = '    // --- Floating panel placement and viewport clamping (touch-friendly) ---';
const BLOCK_END = '    function updateSnapshotIntervalUI() {';

function extractHelperBlock() {
    const source = readFileSync(GUILD_FILE, 'utf8');
    const start = source.indexOf(BLOCK_START);
    const end = source.indexOf(BLOCK_END);
    assert(start !== -1 && end > start, 'could not locate the guild panel helper block in guild-overhaul.js');
    return source.slice(start, end);
}

const DRIVER = `
(function () {
    const results = [];
    const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? null : String(detail) });
    const panel = document.getElementById('gpp-test-guild-panel');
    const header = panel.querySelector('.guild-modal-header');
    const title = header.querySelector('span');
    const closeBtn = header.querySelector('button');
    const handle = panel.querySelector('.guild-modal-resize');
    const rect = () => panel.getBoundingClientRect();
    const fire = (type, target, x, y, opts) => target.dispatchEvent(new PointerEvent(type, Object.assign({
        bubbles: true, cancelable: true, isPrimary: true, pointerId: 7,
        pointerType: 'touch', button: 0, clientX: x, clientY: y,
    }, opts || {})));
    const M = GUILD_PANEL_MARGIN;
    // Headless windows cannot shrink below ~512px, so report the 390x844 phone
    // viewport through the properties the clamp reads (layout still uses the real window).
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    Object.defineProperty(window.visualViewport, 'width', { configurable: true, value: 390 });
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 844 });
    // Opens the panel at its real phone-width size, then narrows it so horizontal moves have room.
    const placeNarrow = () => { placeGuildPanel(panel); panel.style.width = '300px'; fitGuildPanel(panel, 100, 100); };

    try {
        const vp = guildPanelViewport();
        check('phone-width viewport (390x844)', vp.width === 390 && vp.height === 844, 'vw=' + vp.width + ' vh=' + vp.height);

        // Initial placement (the open path): fully on screen with the 8px margin.
        placeGuildPanel(panel);
        setupDragHandling(panel, header);
        setupResizeHandling(panel, handle);
        let r = rect();
        check('opens fully on screen (left margin)', r.left >= M - 0.5, 'left=' + r.left);
        check('opens fully on screen (right margin)', r.right <= vp.width - M + 0.5, 'right=' + r.right + ' vw=' + vp.width);
        check('opens fully on screen (top margin)', r.top >= M - 0.5, 'top=' + r.top);
        check('opens fully on screen (bottom margin)', r.bottom <= vp.height - M + 0.5, 'bottom=' + r.bottom + ' vh=' + vp.height);

        // Touch drag: far past the top-left corner must clamp to the margin.
        fire('pointerdown', title, r.left + 60, r.top + 10);
        fire('pointermove', title, -400, -400, { button: -1 });
        r = rect();
        check('touch drag clamps to top-left margin', Math.abs(r.left - M) < 0.5 && Math.abs(r.top - M) < 0.5, 'left=' + r.left + ' top=' + r.top);

        // Touch drag far past the bottom-right corner must clamp inside the viewport.
        fire('pointermove', title, 5000, 5000, { button: -1 });
        r = rect();
        check('touch drag clamps to bottom-right margin', r.right <= vp.width - M + 0.5 && r.bottom <= vp.height - M + 0.5, 'right=' + r.right + ' bottom=' + r.bottom);
        fire('pointerup', title, 5000, 5000, { button: 0 });

        // After pointerup the panel must not follow the pointer any more.
        const afterUp = rect().left;
        fire('pointermove', title, 60, 60, { button: -1 });
        check('no drag after pointerup', Math.abs(rect().left - afterUp) < 0.5, 'before=' + afterUp + ' after=' + rect().left);

        // Touch-drag a real movement inside the bounds (down on the title, move 40px left and 20px down from its start).
        placeNarrow();
        r = rect();
        fire('pointerdown', title, r.left + 60, r.top + 10);
        fire('pointermove', title, r.left + 60 - 40, r.top + 10 + 20, { button: -1 });
        fire('pointerup', title, r.left + 20, r.top + 30, { button: 0 });
        const r2 = rect();
        check('touch drag moves the panel by the finger delta', Math.abs((r.left - r2.left) - 40) < 0.5 && Math.abs((r2.top - r.top) - 20) < 0.5, 'dLeft=' + (r2.left - r.left) + ' dTop=' + (r2.top - r.top));

        // Close button press must not start a drag.
        placeGuildPanel(panel);
        r = rect();
        fire('pointerdown', closeBtn, r.right - 15, r.top + 15);
        fire('pointermove', closeBtn, 100, 300, { button: -1 });
        fire('pointerup', closeBtn, 100, 300, { button: 0 });
        check('close button press does not drag', Math.abs(rect().left - r.left) < 0.5, 'before=' + r.left + ' after=' + rect().left);

        // Desktop mouse drag keeps working; a non-primary button does not start one.
        placeNarrow();
        r = rect();
        fire('pointerdown', title, r.left + 30, r.top + 10, { pointerType: 'mouse', button: 2 });
        fire('pointermove', title, r.left + 30 + 25, r.top + 10 + 25, { pointerType: 'mouse', button: 0 });
        check('non-primary mouse button does not drag', Math.abs(rect().left - r.left) < 0.5, 'left=' + rect().left);
        fire('pointerdown', title, r.left + 30, r.top + 10, { pointerType: 'mouse', button: 0 });
        fire('pointermove', title, r.left + 30 - 10, r.top + 10 + 5, { pointerType: 'mouse', button: 0 });
        fire('pointerup', title, r.left + 20, r.top + 15, { pointerType: 'mouse', button: 0 });
        check('primary mouse drag moves the panel', Math.abs((rect().left - r.left) + 10) < 0.5, 'dLeft=' + (rect().left - r.left));

        // Touch resize: dragging the handle far out must stop at the viewport edge.
        placeGuildPanel(panel);
        r = rect();
        const hr = handle.getBoundingClientRect();
        fire('pointerdown', handle, hr.left + 16, hr.top + 16);
        fire('pointermove', handle, 3000, 3000, { button: -1 });
        fire('pointerup', handle, 3000, 3000, { button: 0 });
        r = rect();
        check('touch resize stops at right viewport edge', r.right <= vp.width - M + 0.5, 'right=' + r.right + ' vw=' + vp.width);
        check('touch resize stops at bottom viewport edge', r.bottom <= vp.height - M + 0.5, 'bottom=' + r.bottom + ' vh=' + vp.height);

        // Touch resize shrinks but not below the 300px minimum.
        fire('pointerdown', handle, hr.left + 16, hr.top + 16);
        fire('pointermove', handle, -2000, -2000, { button: -1 });
        fire('pointerup', handle, -2000, -2000, { button: 0 });
        check('touch resize respects minimum width', Math.abs(rect().width - 300) < 0.5, 'width=' + rect().width);

        // A too-wide panel (e.g. after rotation) is capped and kept on screen.
        panel.style.width = '700px';
        fitGuildPanel(panel, 300, 100);
        r = rect();
        check('fit caps an oversize panel to the viewport', r.width <= vp.width - 2 * M + 0.5 && r.left >= M - 0.5 && r.right <= vp.width - M + 0.5, 'left=' + r.left + ' width=' + r.width);
    } catch (err) {
        check('driver ran without throwing', false, err && err.stack ? err.stack : String(err));
    }

    const report = { pass: results.every(x => x.pass), results };
    fetch('/report', { method: 'POST', body: JSON.stringify(report) }).finally(() => {});
})();
`;

function buildHtml() {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>guild panel touch regression</title>
<style>
    body { margin: 0; background: #e5e7eb; font-family: sans-serif; }
    #gpp-test-guild-panel { position: fixed; top: 0; left: 0; background: #fff; }
    #gpp-test-guild-panel .guild-modal-header { position: absolute; top: 0; left: 0; right: 0; height: 40px; background: #2563eb; color: #fff; touch-action: none; }
    #gpp-test-guild-panel .guild-modal-header span { display: block; flex: 1; touch-action: none; }
    #gpp-test-guild-panel .guild-modal-resize { position: absolute; bottom: 0; right: 0; width: 32px; height: 32px; touch-action: none; }
    #gpp-test-guild-panel .gpp-test-body { padding-top: 50px; height: 650px; }
</style>
</head>
<body>
<div id="gpp-test-guild-panel">
    <div class="guild-modal-header"><span>Guild Panel</span><button type="button">x</button></div>
    <div class="gpp-test-body">Panel body</div>
    <div class="guild-modal-resize"></div>
</div>
<script>
${extractHelperBlock()}
</script>
<script>
${DRIVER}
</script>
</body>
</html>
`;
}

function findBrowser() {
    const candidates = [
        process.env.CHROME_PATH,
        process.env.BROWSER_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean);
    return candidates.find(candidate => existsSync(candidate)) || null;
}

async function runInBrowser(html) {
    let resolveReport;
    let rejectReport;
    const reportPromise = new Promise((res, rej) => { resolveReport = res; rejectReport = rej; });
    const server = createServer((request, response) => {
        if (request.method === 'POST' && request.url === '/report') {
            let body = '';
            request.on('data', chunk => { body += chunk; });
            request.on('end', () => {
                response.writeHead(200, { 'content-type': 'text/plain' });
                response.end('ok');
                resolveReport(body);
            });
            return;
        }
        response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
        });
        response.end(html);
    });
    await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(0, '127.0.0.1', resolveListen);
    });
    const { port } = server.address();

    const browserPath = findBrowser();
    assert(browserPath, 'Chrome or Edge was not found; set CHROME_PATH or BROWSER_PATH');
    const profileDirectory = mkdtempSync(join(tmpdir(), 'gpp-guild-touch-'));
    mkdirSync(join(profileDirectory, 'Default'), { recursive: true });
    writeFileSync(join(profileDirectory, 'Default', 'Preferences'), '{}', 'utf8');
    let browser;
    try {
        browser = spawn(browserPath, [
            '--headless=new',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--no-first-run',
            '--no-default-browser-check',
            '--mute-audio',
            '--window-size=390,844',
            `--user-data-dir=${profileDirectory}`,
            `http://127.0.0.1:${port}/`,
        ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let stderr = '';
        browser.stderr.setEncoding('utf8');
        browser.stderr.on('data', chunk => { stderr += chunk; });
        browser.once('error', rejectReport);
        browser.once('close', code => {
            if (code !== 0 && code !== null) rejectReport(new Error(`headless browser exited with code ${code}\n${stderr}`));
        });
        let timeoutId;
        const timeoutPromise = new Promise((_, rej) => {
            timeoutId = setTimeout(() => rej(new Error('timed out waiting for the test page report')), 90_000);
        });
        try {
            return await Promise.race([reportPromise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutId);
        }
    } finally {
        if (browser && !browser.killed) { try { browser.kill(); } catch (_) { /* ignore */ } }
        await new Promise(resolveClose => server.close(resolveClose));
        await new Promise(r => setTimeout(r, 500));
        try {
            rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        } catch (cleanupErr) {
            console.error(`(non-fatal) could not remove temp profile dir ${profileDirectory}: ${cleanupErr.message}`);
        }
    }
}

const body = await runInBrowser(buildHtml());
const report = JSON.parse(body);
for (const row of report.results) {
    console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${row.name}${row.detail && !row.pass ? `  (${row.detail})` : (row.detail ? `  [${row.detail}]` : '')}`);
}
const failed = report.results.filter(row => !row.pass).length;
console.log(`\n${report.results.length - failed} passed, ${failed} failed`);
process.exit(report.pass ? 0 : 1);
