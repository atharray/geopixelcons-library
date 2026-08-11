
    // ── Ghost++ viewport renderer ────────────────────────────────────────
    // Draws the ghost overlay on the live map. One canvas is created once and
    // appended to the map container; WebGL2 is preferred (per-cell dot shader
    // sampling small index/palette/mask textures) with an automatic Canvas2D
    // fallback (stepped per-visible-cell fillRect loop) when WebGL2 is
    // unavailable or a template exceeds the GPU's texture size limit.
    // Ported from the standalone prototype's createRenderer()
    // (scripts/geopixels-ghost-template-overhaul/1.0.0.js, lines ~1385-1884):
    // every direct `map`/`turf`/`gridSize`/`halfSize`/`offsetMeters*` access
    // is replaced with gpp-bridge.js's gppGetMap()/gppGetTurf()/
    // gppReadGridConstants(), since this runtime is sandboxed rather than
    // injected into the page realm like the original. The original's
    // per-cell error-cross overlay is intentionally NOT ported — error/scan
    // rendering belongs to a later Story-07-style subsystem and is out of
    // this file's scope.
    //
    // There is no automatic zoom-based "completed template" preview swap —
    // that system was removed in favour of a manual "Preview" button
    // (gpp-placement.js) that just drives template.opacity to 100%, the same
    // field the visibility eye-icon/Opacity slider already control. The
    // per-cell dot overlay stays visible at every zoom down to
    // gppReadGridConstants().minZoom (a separate, lower-level cutoff) by
    // applying gapRatio's proportional inset UNCONDITIONALLY, regardless of
    // how small a cell renders on screen — there is deliberately no small-
    // cell special case that snaps to a solid/100%-fill look, since that
    // made a zoomed-out overlay indistinguishable from Preview being on,
    // which the native ghost overlay never does either ("the cells appear no
    // matter your zoom level, only the render level matters" — a tiny cell
    // just fades out via the canvas/GPU's own antialiasing, same as any
    // other small shape would, rather than being artificially forced solid
    // or discarded outright).
    //
    // Also fixed relative to the original during the port: the original's
    // Canvas2D dot path floored each drawn cell to `Math.max(0.5, ...)`
    // pixels, which meant gapRatio===0 still left a faint 0.5px speckle
    // instead of a fully invisible cell. Both render paths here treat
    // gapRatio<=0 as an unconditional "draw nothing" instead (see
    // gppRendererDrawWebGl's fragment shader and gppRendererDrawCanvas2d),
    // matching gpp-view-settings.js's explicit "no artificial floor" contract
    // for this same setting.
    //
    // Public surface (the only names other Ghost++ files should call):
    //   gppRendererMount()    — idempotent; creates the canvas and wires
    //                           listeners once the map/turf become available.
    //                           Self-invoked at the bottom of this file,
    //                           gated on _settings.ghostPlusPlus — the
    //                           overlay must keep drawing whether or not the
    //                           Ghost++ modal is open, so it does not wait
    //                           for gpp-init.js's open(). Also kicks off
    //                           gppInitRuntime() itself (see
    //                           gppRendererEnsureRuntime()) if nothing has
    //                           loaded the template library from IndexedDB
    //                           yet, so templates painted before a user ever
    //                           opens the modal still show up.
    //   gppRendererSchedule() — coalesced (one rAF per burst) redraw request;
    //                           call after any state change the overlay must
    //                           reflect (mask toggle, position/opacity edit,
    //                           template add/remove). Already called by
    //                           gpp-view-settings.js / gpp-palette.js /
    //                           gpp-placement.js via a `typeof` guard, so it
    //                           is safe for those files to load before this
    //                           one. A no-op before gppRendererMount() has
    //                           run.
    //   gppRendererDestroy()  — full teardown (feature disable / cleanup).

    const GPP_RENDERER_CANVAS_ID = 'gpp-renderer-canvas';
    const GPP_RENDERER_MAP_POLL_MS = 100;
    const GPP_RENDERER_MAP_POLL_MAX_ATTEMPTS = 300; // ~30s

    // One shared, stateless core instance — cheap to build, but no reason to
    // rebuild it per template per frame when a single instance works for the
    // life of the module (function declarations across files are hoisted
    // through the shared IIFE scope, so calling gppCreateCore() here is safe
    // regardless of this file's position in build.js's SRC_ORDER).
    const gppRendererCore = gppCreateCore();

    let gppRendererState = null;       // module singleton; null until gppRendererMount() attaches
    let gppRendererRuntimeReady = null; // promise cache for gppRendererEnsureRuntime()

    // ── small helpers ──────────────────────────────────────────────────

    function gppRendererClamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // Cheap non-cryptographic checksum over a template's live mask bitset,
    // used purely to detect "did the mask change since we last uploaded/
    // cached this template's GPU mask texture or preview thumbnail" without
    // needing an explicit change-notification hook from gpp-palette.js.
    function gppRendererMaskSignature(mask) {
        let sig = 0x9e3779b9 | 0;
        for (let i = 0; i < mask.length; i++) sig = (Math.imul(sig ^ mask[i], 0x85ebca6b)) | 0;
        return sig >>> 0;
    }

    function gppRendererCreateCanvasElement() {
        const element = document.createElement('canvas');
        element.id = GPP_RENDERER_CANVAS_ID;
        element.setAttribute('aria-hidden', 'true');
        Object.assign(element.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            imageRendering: 'pixelated',
            zIndex: '1',
        });
        return element;
    }

    // Loads gpp-runtime.js's template library exactly once for the whole
    // page, whether that happens because the renderer mounted first or
    // because the user opened the Ghost++ modal first (gpp-init.js's own
    // ensureRuntime() sets gppDatabase via gppInitRuntime() too). Checking
    // the shared `gppDatabase` binding (gpp-runtime.js) is a best-effort
    // guard against redundant IndexedDB reads if both paths race — never
    // destructive either way, since gppInitRuntime() only reads.
    function gppRendererEnsureRuntime() {
        if (!gppRendererRuntimeReady) {
            gppRendererRuntimeReady = (gppDatabase ? Promise.resolve(gppState) : gppInitRuntime())
                .catch(err => {
                    gppRendererRuntimeReady = null;
                    throw err;
                });
        }
        return gppRendererRuntimeReady;
    }

    // ── mount / lifecycle ─────────────────────────────────────────────

    function gppRendererMount() {
        if (gppRendererState) return gppRendererState.handle;
        const state = {
            destroyed: false,
            attached: false,
            canvas: null,
            map: null,
            turf: null,
            gl: null,
            ctx2d: null,
            program: null,
            vertexBuffer: null,
            mode: 'pending',
            resources: new Map(), // templateId -> gl/canvas2d resource (see gppRendererUploadTemplate*)
            resizeObserver: null,
            frameRequest: 0,
            moveHandler: null,
            zoomHandler: null,
            contextLostHandler: null,
            pollTimer: 0,
            pollAttempts: 0,
        };
        state.handle = Object.freeze({
            get mounted() { return state.attached; },
            get mode() { return state.mode; },
            schedule: gppRendererSchedule,
            destroy: gppRendererDestroy,
        });
        gppRendererState = state;
        gppRendererWaitForMap(state);
        return state.handle;
    }

    function gppRendererWaitForMap(state) {
        if (state.destroyed) return;
        const map = gppGetMap();
        const turf = gppGetTurf();
        if (map && turf) {
            try {
                gppRendererAttach(state, map, turf);
            } catch (err) {
                console.error('[GeoPixelcons++] Ghost++ renderer failed to attach:', err);
            }
            return;
        }
        if (state.pollAttempts++ >= GPP_RENDERER_MAP_POLL_MAX_ATTEMPTS) {
            console.warn('[GeoPixelcons++] Ghost++ renderer: map never became available; giving up.');
            return;
        }
        state.pollTimer = setTimeout(() => gppRendererWaitForMap(state), GPP_RENDERER_MAP_POLL_MS);
    }

    function gppRendererAttach(state, map, turf) {
        if (state.destroyed || state.attached) return;

        // Defensive cleanup of any stray leftover from a prior mount whose
        // destroy() didn't complete (e.g. threw mid-teardown).
        const stray = document.getElementById(GPP_RENDERER_CANVAS_ID);
        if (stray) stray.remove();

        gppEnsureMapContainerContainsStacking(map);
        const canvas = gppRendererCreateCanvasElement();
        map.getContainer().appendChild(canvas);
        state.canvas = canvas;
        state.map = map;
        state.turf = turf;

        let gl = null;
        try {
            gl = canvas.getContext('webgl2', {
                alpha: true,
                antialias: false,
                premultipliedAlpha: true,
                preserveDrawingBuffer: false,
            });
        } catch (_) { gl = null; }
        if (gl) {
            state.gl = gl;
            try {
                gppRendererInitWebGl(state);
                state.mode = 'webgl2';
            } catch (err) {
                console.warn('[GeoPixelcons++] Ghost++ renderer: WebGL2 unavailable, falling back to Canvas2D.', err);
                gppRendererSwitchToCanvas2d(state, err);
            }
        }
        if (!state.gl) {
            state.ctx2d = state.canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
            if (!state.ctx2d) {
                console.error('[GeoPixelcons++] Ghost++ renderer: no supported canvas backend is available.');
                return;
            }
            state.ctx2d.imageSmoothingEnabled = false;
            state.mode = 'canvas2d';
        }

        state.resizeObserver = new ResizeObserver(() => gppRendererScheduleInternal(state));
        state.resizeObserver.observe(map.getContainer());

        if (state.gl) {
            state.contextLostHandler = event => {
                event.preventDefault();
                try {
                    gppRendererSwitchToCanvas2d(state, new Error('WebGL context lost'));
                    gppRendererScheduleInternal(state);
                } catch (err) {
                    console.error('[GeoPixelcons++] Ghost++ renderer: context lost and Canvas2D fallback failed.', err);
                }
            };
            state.canvas.addEventListener('webglcontextlost', state.contextLostHandler);
        }

        // Requirement: redraws are triggered by map move/zoom but coalesced
        // through one rAF per burst — never drawn synchronously here.
        state.moveHandler = () => gppRendererScheduleInternal(state);
        state.zoomHandler = () => gppRendererScheduleInternal(state);
        map.on('move', state.moveHandler);
        map.on('zoom', state.zoomHandler);

        state.attached = true;

        gppRendererEnsureRuntime()
            .then(() => gppRendererScheduleInternal(state))
            .catch(err => console.error('[GeoPixelcons++] Ghost++ renderer: failed to load the template library.', err));

        gppRendererScheduleInternal(state); // initial paint (draws nothing until the library above resolves)
    }

    function gppRendererDestroy() {
        if (!gppRendererState) return;
        const state = gppRendererState;
        state.destroyed = true;
        gppRendererState = null;

        if (state.pollTimer) clearTimeout(state.pollTimer);
        if (state.frameRequest) window.cancelAnimationFrame(state.frameRequest);
        if (state.resizeObserver) { try { state.resizeObserver.disconnect(); } catch (_) {} }
        if (state.map) {
            try {
                if (state.moveHandler) state.map.off('move', state.moveHandler);
                if (state.zoomHandler) state.map.off('zoom', state.zoomHandler);
            } catch (_) {}
        }
        if (state.canvas && state.contextLostHandler) {
            try { state.canvas.removeEventListener('webglcontextlost', state.contextLostHandler); } catch (_) {}
        }
        try {
            for (const resource of state.resources.values()) gppRendererDeleteResource(state, resource);
            state.resources.clear();
            if (state.gl) {
                if (state.vertexBuffer) state.gl.deleteBuffer(state.vertexBuffer);
                if (state.program) state.gl.deleteProgram(state.program);
            }
        } catch (_) {}
        if (state.canvas && state.canvas.parentNode) state.canvas.remove();
    }

    // ── scheduling ─────────────────────────────────────────────────────

    function gppRendererScheduleInternal(state) {
        if (!state || state.destroyed || !state.attached) return;
        if (state.frameRequest) return; // already coalesced into the pending frame
        state.frameRequest = window.requestAnimationFrame(() => gppRendererDraw(state));
    }

    function gppRendererSchedule() {
        if (!gppRendererState) return; // not mounted yet (or already destroyed) — nothing to draw
        gppRendererScheduleInternal(gppRendererState);
    }

    // ── WebGL2 backend ────────────────────────────────────────────────

    function gppRendererCompileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Ghost++ renderer shader failed: ' + message);
        }
        return shader;
    }

    function gppRendererInitWebGl(state) {
        const gl = state.gl;
        const vertexSource = `#version 300 es
            in vec2 a_position;
            uniform vec4 u_rect;
            uniform vec2 u_viewport;
            out vec2 v_uv;
            void main() {
                vec2 pixel = u_rect.xy + (a_position * u_rect.zw);
                vec2 clip = vec2((pixel.x / u_viewport.x) * 2.0 - 1.0,
                                 1.0 - (pixel.y / u_viewport.y) * 2.0);
                gl_Position = vec4(clip, 0.0, 1.0);
                v_uv = a_position;
            }`;
        // gapRatio<=0 is an unconditional discard so it can reach a truly
        // invisible cell; above that, cells too small on screen to resolve a
        // fractional gap without shimmer/aliasing (<2.5px) just draw solid
        // instead of discarding, so the overlay stays visible at any zoom
        // (down to the native minZoom cutoff already applied before this
        // draw is ever issued — see gppRendererDraw).
        const fragmentSource = `#version 300 es
            precision highp float;
            precision highp int;
            precision highp usampler2D;
            in vec2 v_uv;
            uniform usampler2D u_indices;
            uniform usampler2D u_palette;
            uniform usampler2D u_mask;
            uniform ivec2 u_template_size;
            uniform int u_palette_width;
            uniform uint u_empty;
            uniform float u_gap_ratio;
            uniform float u_opacity;
            out vec4 out_color;
            void main() {
                vec2 safe_uv = min(v_uv, vec2(0.9999999));
                ivec2 cell = ivec2(floor(safe_uv * vec2(u_template_size)));
                uint palette_index = texelFetch(u_indices, cell, 0).r;
                if (palette_index == u_empty) discard;
                int word_index = int(palette_index >> 5u);
                uint word = texelFetch(u_mask, ivec2(word_index, 0), 0).r;
                if ((word & (1u << (palette_index & 31u))) == 0u) discard;
                if (u_gap_ratio <= 0.0) discard;
                if (u_gap_ratio < 1.0) {
                    vec2 within = fract(safe_uv * vec2(u_template_size));
                    float inset = (1.0 - u_gap_ratio) * 0.5;
                    if (within.x < inset || within.x > 1.0 - inset || within.y < inset || within.y > 1.0 - inset) discard;
                }
                int palette_x = int(palette_index) % u_palette_width;
                int palette_y = int(palette_index) / u_palette_width;
                uint packed = texelFetch(u_palette, ivec2(palette_x, palette_y), 0).r;
                vec3 rgb = vec3(float((packed >> 16u) & 255u), float((packed >> 8u) & 255u), float(packed & 255u)) / 255.0;
                out_color = vec4(rgb, u_opacity);
            }`;
        const vertex = gppRendererCompileShader(gl, gl.VERTEX_SHADER, vertexSource);
        const fragment = gppRendererCompileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
        const program = gl.createProgram();
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) || 'Could not link Ghost++ renderer shaders.');
        }
        state.program = program;

        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        state.vertexBuffer = vertexBuffer;

        gl.useProgram(program);
        const positionLocation = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1i(gl.getUniformLocation(program, 'u_indices'), 0);
        gl.uniform1i(gl.getUniformLocation(program, 'u_palette'), 1);
        gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 2);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    }

    function gppRendererSwitchToCanvas2d(state, reason) {
        if (!state.gl) return;
        try {
            for (const resource of state.resources.values()) gppRendererDeleteResource(state, resource);
            if (state.vertexBuffer) state.gl.deleteBuffer(state.vertexBuffer);
            if (state.program) state.gl.deleteProgram(state.program);
        } catch (_) {}
        state.resources.clear();
        state.vertexBuffer = null;
        state.program = null;

        const previousCanvas = state.canvas;
        const nextCanvas = gppRendererCreateCanvasElement();
        if (previousCanvas && previousCanvas.parentNode) previousCanvas.parentNode.replaceChild(nextCanvas, previousCanvas);
        else if (state.map) state.map.getContainer().appendChild(nextCanvas);
        state.canvas = nextCanvas;
        state.gl = null;
        state.ctx2d = nextCanvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
        if (!state.ctx2d) throw new Error('Canvas2D fallback could not be created.');
        state.ctx2d.imageSmoothingEnabled = false;
        state.mode = 'canvas2d';
        if (reason) console.warn('[GeoPixelcons++] Ghost++ renderer: using Canvas2D.', reason);
    }

    function gppRendererCreateTexture(gl, unit) {
        const texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texture;
    }

    // ── per-template GPU/Canvas2D resource management ───────────────────
    // `resources` holds one entry per currently visible+positioned template,
    // keyed by template.id. Rebuilt only when the template's core data
    // (indices/palette/dimensions) actually changed — see
    // gppRendererReconcile() — never per frame. Mask changes (far more
    // frequent — every colour toggle in gpp-palette.js) update just the
    // small mask texture via gppRendererSyncMaskGl(), also detected lazily
    // rather than through an explicit change hook.

    function gppRendererDeleteResource(state, resource) {
        if (!state.gl || !resource) return;
        const gl = state.gl;
        ['indexTexture', 'paletteTexture', 'maskTexture'].forEach(key => {
            if (resource[key]) gl.deleteTexture(resource[key]);
        });
    }

    function gppRendererRemoveTemplateResource(state, id) {
        const resource = state.resources.get(id);
        gppRendererDeleteResource(state, resource);
        state.resources.delete(id);
    }

    function gppRendererUploadTemplateGl(state, template) {
        const gl = state.gl;
        gppRendererRemoveTemplateResource(state, template.id);
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (template.width > maxTextureSize || template.height > maxTextureSize) {
            throw new Error((template.name || 'Template') + ' exceeds this browser\'s ' + maxTextureSize + 'px WebGL texture limit.');
        }

        const indexTexture = gppRendererCreateTexture(gl, 0);
        if (template.indexType === 'u8') {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, template.width, template.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, template.indices);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, template.width, template.height, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, template.indices);
        }

        const paletteTexture = gppRendererCreateTexture(gl, 1);
        const paletteWidth = Math.max(1, Math.min(maxTextureSize, template.palette.length || 1));
        const paletteHeight = Math.max(1, Math.ceil(Math.max(1, template.palette.length) / paletteWidth));
        const paletteData = new Uint32Array(paletteWidth * paletteHeight);
        paletteData.set(template.palette);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, paletteWidth, paletteHeight, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, paletteData);

        const maskTexture = gppRendererCreateTexture(gl, 2);
        const maskData = template.mask.length ? template.mask : new Uint32Array(1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, maskData.length, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, maskData);

        state.resources.set(template.id, {
            indexTexture,
            paletteTexture,
            maskTexture,
            maskSig: gppRendererMaskSignature(template.mask),
            paletteWidth,
            indicesRef: template.indices,
            paletteRef: template.palette,
            width: template.width,
            height: template.height,
        });
    }

    function gppRendererUploadTemplateCanvas2d(state, template) {
        gppRendererRemoveTemplateResource(state, template.id);
        state.resources.set(template.id, {
            colorStrings: Array.from(template.palette, packed => gppRendererCore.packedToHex(packed)),
            indicesRef: template.indices,
            paletteRef: template.palette,
            width: template.width,
            height: template.height,
        });
    }

    // Adds/refreshes resources for every currently visible+positioned
    // template and drops resources for templates no longer in that set
    // (deleted, hidden, or un-positioned). Runs once per draw — cheap,
    // since it only does real GPU/canvas work when a resource is
    // missing or its indices/palette reference (transform/flip/rotate
    // creates a fresh array) or dimensions changed.
    function gppRendererReconcile(state, templates) {
        const ids = new Set(templates.map(t => t.id));
        for (const id of Array.from(state.resources.keys())) {
            if (!ids.has(id)) gppRendererRemoveTemplateResource(state, id);
        }
        for (const template of templates) {
            const existing = state.resources.get(template.id);
            const stale = !existing
                || existing.indicesRef !== template.indices
                || existing.paletteRef !== template.palette
                || existing.width !== template.width
                || existing.height !== template.height;
            if (!stale) continue;
            try {
                if (state.gl) gppRendererUploadTemplateGl(state, template);
                else gppRendererUploadTemplateCanvas2d(state, template);
            } catch (err) {
                if (state.gl) {
                    console.warn('[GeoPixelcons++] Ghost++ renderer: WebGL2 upload failed, falling back to Canvas2D.', err);
                    gppRendererSwitchToCanvas2d(state, err);
                    for (const fallbackTemplate of templates) {
                        try { gppRendererUploadTemplateCanvas2d(state, fallbackTemplate); } catch (err2) {
                            console.error('[GeoPixelcons++] Ghost++ renderer: could not prepare template for Canvas2D.', err2);
                        }
                    }
                    return;
                }
                console.error('[GeoPixelcons++] Ghost++ renderer: could not prepare template.', err);
            }
        }
    }

    function gppRendererSyncMaskGl(state, template, resource) {
        const sig = gppRendererMaskSignature(template.mask);
        if (resource.maskSig === sig) return;
        resource.maskSig = sig;
        const gl = state.gl;
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, resource.maskTexture);
        const maskData = template.mask.length ? template.mask : new Uint32Array(1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, maskData.length, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, maskData);
    }

    // ── grid -> screen projection ─────────────────────────────────────
    // mercX = gridX*gridSize + offsetMetersX (edges offset by ±halfSize),
    // mercY similarly; grid Y is up-positive and a template's rows extend
    // DOWNWARD from its top-left position row 0, so the top edge is
    // position.gridY*size + half (larger Y / further north) and the bottom
    // edge is (position.gridY - height + 1)*size - half (smaller Y / further
    // south) — screen Y then comes out increasing downward via map.project,
    // matching normal screen conventions without an extra flip.

    function gppRendererProjectTemplate(map, turf, grid, template) {
        // gpp-placement.js's gppPlacementPreview (shared top-level scope —
        // see build.js's SRC_ORDER banner) overrides the committed position
        // while a "Place on map" capture is tracking the pointer, so the
        // template visibly follows the cursor before the click commits it.
        const preview = gppPlacementPreview;
        const position = (preview && preview.templateId === template.id) ? preview.position : template.position;
        if (!position) return null;
        try {
            const size = grid.gridSize;
            const half = grid.halfSize;
            const offsetX = grid.offsetMetersX;
            const offsetY = grid.offsetMetersY;
            const topLeftEdge = [position.gridX * size - half + offsetX, position.gridY * size + half + offsetY];
            const bottomRightGridX = position.gridX + template.width - 1;
            const bottomRightGridY = position.gridY - template.height + 1;
            const bottomRightEdge = [bottomRightGridX * size + half + offsetX, bottomRightGridY * size - half + offsetY];
            const topLeft = map.project(turf.toWgs84(topLeftEdge));
            const bottomRight = map.project(turf.toWgs84(bottomRightEdge));
            if (![topLeft.x, topLeft.y, bottomRight.x, bottomRight.y].every(Number.isFinite)) return null;
            return {
                x: topLeft.x,
                y: topLeft.y,
                width: bottomRight.x - topLeft.x,
                height: bottomRight.y - topLeft.y,
            };
        } catch (_) {
            return null;
        }
    }

    function gppRendererViewportIntersects(rect, cssWidth, cssHeight) {
        return rect && rect.x + rect.width >= 0 && rect.x <= cssWidth && rect.y + rect.height >= 0 && rect.y <= cssHeight;
    }

    // ── frame lifecycle ──────────────────────────────────────────────

    // Only resizes the backing store when the observed CSS/device-pixel size
    // actually changed — reassigning canvas.width/height every frame
    // reallocates the backing store and is the known GPC++ perf bug this
    // file must not repeat (see requirement 1).
    function gppRendererEnsureSize(state) {
        const rect = state.map.getContainer().getBoundingClientRect();
        const cssWidth = Math.max(1, rect.width);
        const cssHeight = Math.max(1, rect.height);
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const backingWidth = Math.max(1, Math.round(cssWidth * dpr));
        const backingHeight = Math.max(1, Math.round(cssHeight * dpr));
        if (state.canvas.width !== backingWidth || state.canvas.height !== backingHeight) {
            state.canvas.width = backingWidth;
            state.canvas.height = backingHeight;
        }
        if (state.gl) {
            state.gl.viewport(0, 0, backingWidth, backingHeight);
        } else if (state.ctx2d) {
            state.ctx2d.setTransform(backingWidth / cssWidth, 0, 0, backingHeight / cssHeight, 0, 0);
            state.ctx2d.imageSmoothingEnabled = false;
        }
        return { cssWidth, cssHeight, dpr };
    }

    // A template is "visible" for resourcing/drawing purposes if it's
    // actively being placed (previewTemplateId — must render regardless of
    // its own opacity so the user can see what they're positioning), or if
    // its EFFECTIVE opacity (accounting for gpp-placement.js's Preview
    // button override, same as the WebGl/Canvas2d draw functions' own
    // `previewing` check) is above 0. Used to keep gppRendererReconcile
    // from building a GPU texture / Canvas2D resource for a hidden
    // template at all — see gppRendererDraw's own comment on why this
    // matters for large templates.
    function gppRendererIsTemplateVisible(template, previewTemplateId) {
        if (template.id === previewTemplateId) return true;
        const effectiveOpacity = gppForcedVisibleTemplateIds.has(template.id) ? 1 : template.opacity;
        return effectiveOpacity > 0;
    }

    function gppRendererDraw(state) {
        state.frameRequest = 0;
        if (state.destroyed || !state.attached) return;

        let turf = state.turf;
        if (!turf) {
            turf = gppGetTurf();
            if (turf) state.turf = turf;
        }

        const viewport = gppRendererEnsureSize(state);
        if (state.gl) {
            state.gl.clearColor(0, 0, 0, 0);
            state.gl.clear(state.gl.COLOR_BUFFER_BIT);
        } else if (state.ctx2d) {
            state.ctx2d.clearRect(0, 0, viewport.cssWidth, viewport.cssHeight);
        }
        if (!turf) return; // can't project without turf; next schedule() retries

        let zoom;
        try { zoom = state.map.getZoom(); } catch (_) { zoom = -Infinity; }

        const grid = gppReadGridConstants();
        if (zoom < grid.minZoom) return; // requirement 6: hide entirely below native minZoom

        // A template with no committed position yet still needs to be drawn
        // while gppPlacementPreview (gpp-placement.js) is tracking it — it
        // hasn't been placed, but the "Place on map" click-to-place capture
        // still projects it at the cursor's current grid cell.
        const previewTemplateId = gppPlacementPreview ? gppPlacementPreview.templateId : null;
        // Guild templates (gpp-guild-templates.js) are never part of
        // gppState.templates (see that array's own header comment in
        // gpp-runtime.js — they must never persist or appear in the main
        // Templates grid), but they still need to draw on the map exactly
        // like a real template whenever a card's visibility toggle sets
        // its opacity above 0 — concat them in here, at the one place this
        // whole file turns "templates" into "what gets drawn".
        //
        // Filtered by gppRendererIsTemplateVisible BEFORE reaching
        // gppRendererReconcile, not just inside the WebGl/Canvas2d draw
        // loops below (which still separately check effectiveOpacity too,
        // for the placement-preview edge case) — per explicit product
        // feedback, an opacity-0 template must get ZERO GPU/canvas
        // resources built for it, not just skip being drawn. This matters a
        // lot for large templates (guild projects reported up to 3276x3276
        // in production — a single WebGL index texture that size is ~10MB+
        // on its own): previously EVERY positioned template got a full
        // texture upload in gppRendererReconcile regardless of visibility,
        // so 30-40 large hidden guild templates could mean hundreds of MB
        // of avoidable GPU uploads. Excluding invisible templates here
        // means gppRendererReconcile's own existing stale-resource cleanup
        // (it already drops any resource whose id isn't in the current
        // `templates` set) now also frees a template's resource the moment
        // it becomes hidden, not just skips creating one.
        const templates = gppState.templates.concat(gppState.guildTemplates)
            .filter(t => (t.position || t.id === previewTemplateId) && gppRendererIsTemplateVisible(t, previewTemplateId))
            .slice()
            .sort((a, b) => a.order - b.order);

        gppRendererReconcile(state, templates);

        const settings = gppSettings;

        if (state.gl) gppRendererDrawWebGl(state, viewport, templates, grid, turf, settings);
        else if (state.ctx2d) gppRendererDrawCanvas2d(state, viewport, templates, grid, turf, settings);
    }

    function gppRendererDrawWebGl(state, viewport, templates, grid, turf, settings) {
        const gl = state.gl;
        gl.useProgram(state.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.vertexBuffer);
        const loc = name => gl.getUniformLocation(state.program, name);
        gl.uniform2f(loc('u_viewport'), viewport.cssWidth, viewport.cssHeight);

        for (const template of templates) {
            // gpp-placement.js's "Preview" button — a transient view aid,
            // deliberately independent of template.opacity/gapRatio (see
            // gppForcedVisibleTemplateIds' own comment there).
            const previewing = gppForcedVisibleTemplateIds.has(template.id);
            const effectiveOpacity = previewing ? 1 : template.opacity;
            if (effectiveOpacity <= 0) continue; // requirement 4: 0 opacity is fully invisible — skip the draw entirely
            const resource = state.resources.get(template.id);
            if (!resource) continue;
            const rect = gppRendererProjectTemplate(state.map, turf, grid, template);
            if (!gppRendererViewportIntersects(rect, viewport.cssWidth, viewport.cssHeight)) continue; // requirement 5: cull

            gl.uniform4f(loc('u_rect'), rect.x, rect.y, rect.width, rect.height);
            gl.uniform1f(loc('u_opacity'), effectiveOpacity);
            gl.uniform1f(loc('u_gap_ratio'), previewing ? 1 : settings.gapRatio);

            gppRendererSyncMaskGl(state, template, resource);
            gl.uniform2i(loc('u_template_size'), template.width, template.height);
            gl.uniform1i(loc('u_palette_width'), resource.paletteWidth);
            gl.uniform1ui(loc('u_empty'), gppRendererCore.emptyValue(template.indexType));
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, resource.indexTexture);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, resource.paletteTexture);
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, resource.maskTexture);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }

    function gppRendererDrawCanvas2d(state, viewport, templates, grid, turf, settings) {
        const ctx = state.ctx2d;
        for (const template of templates) {
            // gpp-placement.js's "Preview" button — a transient view aid,
            // deliberately independent of template.opacity/gapRatio (see
            // gppForcedVisibleTemplateIds' own comment there).
            const previewing = gppForcedVisibleTemplateIds.has(template.id);
            const effectiveOpacity = previewing ? 1 : template.opacity;
            if (effectiveOpacity <= 0) continue; // requirement 4
            const resource = state.resources.get(template.id);
            if (!resource) continue;
            const rect = gppRendererProjectTemplate(state.map, turf, grid, template);
            if (!gppRendererViewportIntersects(rect, viewport.cssWidth, viewport.cssHeight)) continue; // requirement 5: cull

            ctx.globalAlpha = effectiveOpacity;

            const effectiveGapRatio = previewing ? 1 : settings.gapRatio;
            if (effectiveGapRatio <= 0) { ctx.globalAlpha = 1; continue; } // exactly 0 = fully invisible, no artificial floor

            const cellWidth = rect.width / template.width;
            const cellHeight = rect.height / template.height;
            const absCellWidth = Math.abs(cellWidth);
            const absCellHeight = Math.abs(cellHeight);
            const stepX = Math.max(1, Math.ceil(1 / Math.max(absCellWidth, 0.0001)));
            const stepY = Math.max(1, Math.ceil(1 / Math.max(absCellHeight, 0.0001)));
            const minX = gppRendererClamp(Math.floor((0 - rect.x) / cellWidth), 0, template.width - 1);
            const maxX = gppRendererClamp(Math.ceil((viewport.cssWidth - rect.x) / cellWidth), 0, template.width);
            const minY = gppRendererClamp(Math.floor((0 - rect.y) / cellHeight), 0, template.height - 1);
            const maxY = gppRendererClamp(Math.ceil((viewport.cssHeight - rect.y) / cellHeight), 0, template.height);
            const startX = Math.max(0, Math.floor(minX / stepX) * stepX);
            const startY = Math.max(0, Math.floor(minY / stepY) * stepY);
            const empty = gppRendererCore.emptyValue(template.indexType);

            // Only visible cells (clamped range above) are ever visited, and
            // for very zoomed-out views stepX/stepY skip-sample rather than
            // touching every cell — never a full template-sized pass.
            for (let y = startY; y < maxY; y += stepY) {
                for (let x = startX; x < maxX; x += stepX) {
                    const sampleX = Math.min(template.width - 1, x + Math.floor(stepX / 2));
                    const sampleY = Math.min(template.height - 1, y + Math.floor(stepY / 2));
                    const index = template.indices[sampleY * template.width + sampleX];
                    if (index === empty || !gppRendererCore.maskHas(template.mask, index)) continue;

                    const drawX = rect.x + x * cellWidth;
                    const drawY = rect.y + y * cellHeight;
                    const drawWidth = cellWidth * stepX;
                    const drawHeight = cellHeight * stepY;
                    // Same proportional inset at every zoom level, however
                    // small the cell renders on screen — matching the native
                    // ghost overlay, which never snaps to a solid/100%-fill
                    // look just because you've zoomed out; only the actual
                    // render resolution determines what's visible. For any
                    // gapRatio in (0,1] this inset is always < half the cell,
                    // so drawnWidth/drawnHeight are always positive (down to
                    // sub-pixel, which the canvas naturally antialiases away
                    // rather than needing an artificial size floor here).
                    const insetX = drawWidth * (1 - effectiveGapRatio) * 0.5;
                    const insetY = drawHeight * (1 - effectiveGapRatio) * 0.5;
                    const drawnWidth = drawWidth - insetX * 2;
                    const drawnHeight = drawHeight - insetY * 2;
                    if (drawnWidth <= 0 || drawnHeight <= 0) continue; // no floor to a visible speckle — see file banner

                    ctx.fillStyle = resource.colorStrings[index];
                    ctx.fillRect(drawX + insetX, drawY + insetY, drawnWidth, drawnHeight);
                }
            }
            ctx.globalAlpha = 1;
        }
    }

    // ── auto-mount ───────────────────────────────────────────────────
    // Mirrors gpp-init.js's own `if (_settings.ghostPlusPlus) { try {...} }`
    // gating, but mounts independently of the modal: the overlay must draw
    // on the map whether or not the Ghost++ manager window is ever opened.
    // gppRendererMount() itself tolerates the map/turf not being ready yet
    // (it polls — see gppRendererWaitForMap()), so this is safe to run at
    // top-level script-load time regardless of where this file sits in
    // build.js's SRC_ORDER relative to gpp-bridge.js/gpp-runtime.js/
    // gpp-init.js (function declarations across files in the shared IIFE are
    // hoisted; the only state this touches — gppSettings/gppState/
    // gppDatabase — is only ever read later, asynchronously, by which point
    // the whole script's synchronous top-level pass has already run).
    if (_settings.ghostPlusPlus) {
        try {
            gppRendererMount();
        } catch (err) {
            console.error('[GeoPixelcons++] Ghost++ renderer failed to mount:', err);
        }
    }
