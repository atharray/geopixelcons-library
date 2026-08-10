
    // ============================================================
    //  GHOST++ CORE (indexed template data-model + ingest worker)
    // ============================================================
    //  Ported verbatim from the standalone Ghost++ userscript
    //  (scripts/geopixels-ghost-template-overhaul/1.0.0.js, lines 37-632).
    //  createCore() / ingestWorkerMain() are renamed to their gpp-prefixed
    //  top-level equivalents so they live safely in GPC++'s single shared
    //  IIFE scope; internal logic is unchanged.
    /**
     * Pure production core. It deliberately has no DOM dependencies so the
     * monolithic userscript can be tested without regex-extracting source.
     */
    function gppCreateCore() {
        'use strict';

        const ALPHA_THRESHOLD = 128;
        const MAX_EXACT_COLORS = 65534;
        const MAX_U8_COLORS = 254;
        const RGB444_BUCKETS = 4096;
        const EMPTY_U8 = 0xFF;
        const EMPTY_U16 = 0xFFFF;
        const POSITION_OFFSET = 0x80000000;
        const POSITION_MARKER = Object.freeze([71, 80, 88, 255]);
        // Native ghost22.js's own "Group Noise" clustering threshold —
        // squared Euclidean RGB distance below which two colors are merged
        // into the same group (see groupPaletteColors below). Kept as a
        // named, exported constant so it can be tuned/verified against the
        // live native site later rather than buried as a magic number.
        const GROUPING_THRESHOLD_SQUARED = 2;
        const ERROR_STATE = Object.freeze({
            UNCHECKED: 0,
            CORRECT: 1,
            WRONG: 2,
            MISSING: 3,
            UNKNOWN: 4,
        });

        function abortError() {
            const error = new Error('Operation cancelled.');
            error.name = 'AbortError';
            return error;
        }

        function assertDimensions(rgba, width, height) {
            if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
                throw new TypeError('Image dimensions must be positive integers.');
            }
            if (!rgba || typeof rgba.length !== 'number' || rgba.length !== width * height * 4) {
                throw new TypeError('RGBA length does not match image dimensions.');
            }
        }

        function packRgb(r, g, b) {
            return ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
        }

        function unpackRgb(packed) {
            return Object.freeze({
                r: (packed >>> 16) & 0xFF,
                g: (packed >>> 8) & 0xFF,
                b: packed & 0xFF,
            });
        }

        function packedToHex(packed) {
            return `#${(packed & 0xFFFFFF).toString(16).padStart(6, '0').toUpperCase()}`;
        }

        function packedToRgbaString(packed) {
            const { r, g, b } = unpackRgb(packed);
            return `rgba(${r},${g},${b},1)`;
        }

        function hexToPacked(hex) {
            const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
            return match ? parseInt(match[1], 16) : null;
        }

        function emptyValue(indexType) {
            if (indexType === 'u8') return EMPTY_U8;
            if (indexType === 'u16') return EMPTY_U16;
            throw new TypeError(`Unsupported index type: ${indexType}`);
        }

        function makeIndexArray(indexType, length, buffer) {
            if (indexType === 'u8') return buffer ? new Uint8Array(buffer) : new Uint8Array(length);
            if (indexType === 'u16') return buffer ? new Uint16Array(buffer) : new Uint16Array(length);
            throw new TypeError(`Unsupported index type: ${indexType}`);
        }

        function makeFullMask(colorCount, counts) {
            const mask = new Uint32Array(Math.ceil(colorCount / 32));
            for (let index = 0; index < colorCount; index++) {
                if (!counts || counts[index] > 0) mask[index >>> 5] |= (1 << (index & 31));
            }
            return mask;
        }

        function normalizeMask(maskLike, colorCount, counts) {
            const expectedLength = Math.ceil(colorCount / 32);
            const mask = new Uint32Array(expectedLength);
            if (maskLike) {
                const source = maskLike instanceof Uint32Array ? maskLike : new Uint32Array(maskLike);
                mask.set(source.subarray(0, expectedLength));
            } else {
                mask.set(makeFullMask(colorCount, counts));
            }
            const trailing = colorCount & 31;
            if (trailing && mask.length) mask[mask.length - 1] &= (0xFFFFFFFF >>> (32 - trailing));
            return mask;
        }

        function maskHas(mask, index) {
            return index >= 0 && (index >>> 5) < mask.length && (mask[index >>> 5] & (1 << (index & 31))) !== 0;
        }

        function maskSet(mask, index, enabled) {
            if (index < 0 || (index >>> 5) >= mask.length) return false;
            const wordIndex = index >>> 5;
            const bit = 1 << (index & 31);
            const before = mask[wordIndex];
            mask[wordIndex] = enabled ? (before | bit) : (before & ~bit);
            return before !== mask[wordIndex];
        }

        function maskToggle(mask, index) {
            if (index < 0 || (index >>> 5) >= mask.length) return false;
            mask[index >>> 5] ^= (1 << (index & 31));
            return maskHas(mask, index);
        }

        function maskOnly(colorCount, index) {
            const mask = new Uint32Array(Math.ceil(colorCount / 32));
            maskSet(mask, index, true);
            return mask;
        }

        function exactIndexSync(rgba, width, height, options) {
            const total = width * height;
            const provisional = new Uint16Array(total);
            provisional.fill(EMPTY_U16);
            const colors = [];
            const countList = [];
            const colorToIndex = new Map();
            let opaquePixelCount = 0;

            for (let pixel = 0; pixel < total; pixel++) {
                if (options.isCancelled && options.isCancelled()) throw abortError();
                const offset = pixel * 4;
                if (rgba[offset + 3] <= ALPHA_THRESHOLD) continue;
                opaquePixelCount++;
                const packed = packRgb(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
                let paletteIndex = colorToIndex.get(packed);
                if (paletteIndex === undefined) {
                    if (colors.length >= MAX_EXACT_COLORS) return null;
                    paletteIndex = colors.length;
                    colors.push(packed);
                    countList.push(0);
                    colorToIndex.set(packed, paletteIndex);
                }
                provisional[pixel] = paletteIndex;
                countList[paletteIndex]++;
                if (options.onProgress && (pixel & 0x3FFFF) === 0) {
                    options.onProgress(Math.min(0.48, (pixel / total) * 0.48), 'Indexing exact colours');
                }
            }

            const palette = Uint32Array.from(colors);
            const counts = Uint32Array.from(countList);
            if (colors.length <= MAX_U8_COLORS) {
                const indices = new Uint8Array(total);
                indices.fill(EMPTY_U8);
                for (let pixel = 0; pixel < total; pixel++) {
                    const value = provisional[pixel];
                    if (value !== EMPTY_U16) indices[pixel] = value;
                }
                return { indices, indexType: 'u8', palette, counts, opaquePixelCount, quantized: false, poorMatchPixelCount: 0 };
            }
            return { indices: provisional, indexType: 'u16', palette, counts, opaquePixelCount, quantized: false, poorMatchPixelCount: 0 };
        }

        function binnedIndexSync(rgba, width, height, options) {
            const total = width * height;
            const bucketCounts = new Uint32Array(RGB444_BUCKETS);
            const sumR = new Float64Array(RGB444_BUCKETS);
            const sumG = new Float64Array(RGB444_BUCKETS);
            const sumB = new Float64Array(RGB444_BUCKETS);
            let opaquePixelCount = 0;

            for (let pixel = 0; pixel < total; pixel++) {
                if (options.isCancelled && options.isCancelled()) throw abortError();
                const offset = pixel * 4;
                if (rgba[offset + 3] <= ALPHA_THRESHOLD) continue;
                const r = rgba[offset];
                const g = rgba[offset + 1];
                const b = rgba[offset + 2];
                const bucket = ((r >>> 4) << 8) | ((g >>> 4) << 4) | (b >>> 4);
                bucketCounts[bucket]++;
                sumR[bucket] += r;
                sumG[bucket] += g;
                sumB[bucket] += b;
                opaquePixelCount++;
                if (options.onProgress && (pixel & 0x3FFFF) === 0) {
                    options.onProgress(0.48 + (pixel / total) * 0.24, 'Reducing a high-colour image');
                }
            }

            const bucketToIndex = new Int32Array(RGB444_BUCKETS);
            bucketToIndex.fill(-1);
            const colors = [];
            const counts = [];
            for (let bucket = 0; bucket < RGB444_BUCKETS; bucket++) {
                const count = bucketCounts[bucket];
                if (!count) continue;
                const paletteIndex = colors.length;
                bucketToIndex[bucket] = paletteIndex;
                colors.push(packRgb(
                    Math.round(sumR[bucket] / count),
                    Math.round(sumG[bucket] / count),
                    Math.round(sumB[bucket] / count)
                ));
                counts.push(count);
            }

            const indices = new Uint16Array(total);
            indices.fill(EMPTY_U16);
            let poorMatchPixelCount = 0;
            for (let pixel = 0; pixel < total; pixel++) {
                if (options.isCancelled && options.isCancelled()) throw abortError();
                const offset = pixel * 4;
                if (rgba[offset + 3] <= ALPHA_THRESHOLD) continue;
                const r = rgba[offset];
                const g = rgba[offset + 1];
                const b = rgba[offset + 2];
                const bucket = ((r >>> 4) << 8) | ((g >>> 4) << 4) | (b >>> 4);
                const paletteIndex = bucketToIndex[bucket];
                indices[pixel] = paletteIndex;
                if (colors[paletteIndex] !== packRgb(r, g, b)) poorMatchPixelCount++;
                if (options.onProgress && (pixel & 0x3FFFF) === 0) {
                    options.onProgress(0.72 + (pixel / total) * 0.27, 'Writing indexed cells');
                }
            }

            return {
                indices,
                indexType: 'u16',
                palette: Uint32Array.from(colors),
                counts: Uint32Array.from(counts),
                opaquePixelCount,
                quantized: true,
                poorMatchPixelCount,
            };
        }

        function indexRgba(rgba, width, height, options = {}) {
            assertDimensions(rgba, width, height);
            const exact = exactIndexSync(rgba, width, height, options);
            const indexed = exact || binnedIndexSync(rgba, width, height, options);
            indexed.width = width;
            indexed.height = height;
            indexed.mask = makeFullMask(indexed.palette.length, indexed.counts);
            if (options.onProgress) options.onProgress(1, 'Ready');
            return indexed;
        }

        async function indexRgbaAsync(rgba, width, height, options = {}) {
            assertDimensions(rgba, width, height);
            const total = width * height;
            const yieldEvery = Math.max(4096, options.yieldEvery || 65536);
            const yieldControl = options.yieldControl || (() => new Promise(resolve => setTimeout(resolve, 0)));
            const provisional = new Uint16Array(total);
            provisional.fill(EMPTY_U16);
            const colors = [];
            const countList = [];
            const colorToIndex = new Map();
            let opaquePixelCount = 0;
            let exceeded = false;

            for (let start = 0; start < total; start += yieldEvery) {
                if (options.isCancelled && options.isCancelled()) throw abortError();
                const end = Math.min(total, start + yieldEvery);
                for (let pixel = start; pixel < end; pixel++) {
                    const offset = pixel * 4;
                    if (rgba[offset + 3] <= ALPHA_THRESHOLD) continue;
                    opaquePixelCount++;
                    const packed = packRgb(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
                    let paletteIndex = colorToIndex.get(packed);
                    if (paletteIndex === undefined) {
                        if (colors.length >= MAX_EXACT_COLORS) { exceeded = true; break; }
                        paletteIndex = colors.length;
                        colors.push(packed);
                        countList.push(0);
                        colorToIndex.set(packed, paletteIndex);
                    }
                    provisional[pixel] = paletteIndex;
                    countList[paletteIndex]++;
                }
                if (options.onProgress) options.onProgress(Math.min(0.48, (end / total) * 0.48), 'Indexing exact colours');
                if (exceeded) break;
                await yieldControl();
            }

            let indexed;
            if (!exceeded) {
                const palette = Uint32Array.from(colors);
                const counts = Uint32Array.from(countList);
                if (colors.length <= MAX_U8_COLORS) {
                    const indices = new Uint8Array(total);
                    indices.fill(EMPTY_U8);
                    for (let start = 0; start < total; start += yieldEvery) {
                        if (options.isCancelled && options.isCancelled()) throw abortError();
                        const end = Math.min(total, start + yieldEvery);
                        for (let pixel = start; pixel < end; pixel++) {
                            if (provisional[pixel] !== EMPTY_U16) indices[pixel] = provisional[pixel];
                        }
                        if (options.onProgress) options.onProgress(0.48 + (end / total) * 0.51, 'Finalizing compact indices');
                        await yieldControl();
                    }
                    indexed = { indices, indexType: 'u8', palette, counts, opaquePixelCount, quantized: false, poorMatchPixelCount: 0 };
                } else {
                    indexed = { indices: provisional, indexType: 'u16', palette, counts, opaquePixelCount, quantized: false, poorMatchPixelCount: 0 };
                }
            } else {
                const bucketCounts = new Uint32Array(RGB444_BUCKETS);
                const sumR = new Float64Array(RGB444_BUCKETS);
                const sumG = new Float64Array(RGB444_BUCKETS);
                const sumB = new Float64Array(RGB444_BUCKETS);
                opaquePixelCount = 0;
                for (let start = 0; start < total; start += yieldEvery) {
                    if (options.isCancelled && options.isCancelled()) throw abortError();
                    const end = Math.min(total, start + yieldEvery);
                    for (let pixel = start; pixel < end; pixel++) {
                        const offset = pixel * 4;
                        if (rgba[offset + 3] <= ALPHA_THRESHOLD) continue;
                        const r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2];
                        const bucket = ((r >>> 4) << 8) | ((g >>> 4) << 4) | (b >>> 4);
                        bucketCounts[bucket]++;
                        sumR[bucket] += r;
                        sumG[bucket] += g;
                        sumB[bucket] += b;
                        opaquePixelCount++;
                    }
                    if (options.onProgress) options.onProgress(0.48 + (end / total) * 0.24, 'Reducing a high-colour image');
                    await yieldControl();
                }
                const bucketToIndex = new Int32Array(RGB444_BUCKETS);
                bucketToIndex.fill(-1);
                const reducedColors = [];
                const reducedCounts = [];
                for (let bucket = 0; bucket < RGB444_BUCKETS; bucket++) {
                    const count = bucketCounts[bucket];
                    if (!count) continue;
                    bucketToIndex[bucket] = reducedColors.length;
                    reducedColors.push(packRgb(Math.round(sumR[bucket] / count), Math.round(sumG[bucket] / count), Math.round(sumB[bucket] / count)));
                    reducedCounts.push(count);
                }
                const indices = new Uint16Array(total);
                indices.fill(EMPTY_U16);
                let poorMatchPixelCount = 0;
                for (let start = 0; start < total; start += yieldEvery) {
                    if (options.isCancelled && options.isCancelled()) throw abortError();
                    const end = Math.min(total, start + yieldEvery);
                    for (let pixel = start; pixel < end; pixel++) {
                        const offset = pixel * 4;
                        if (rgba[offset + 3] <= ALPHA_THRESHOLD) continue;
                        const r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2];
                        const bucket = ((r >>> 4) << 8) | ((g >>> 4) << 4) | (b >>> 4);
                        const paletteIndex = bucketToIndex[bucket];
                        indices[pixel] = paletteIndex;
                        if (reducedColors[paletteIndex] !== packRgb(r, g, b)) poorMatchPixelCount++;
                    }
                    if (options.onProgress) options.onProgress(0.72 + (end / total) * 0.27, 'Writing indexed cells');
                    await yieldControl();
                }
                indexed = {
                    indices,
                    indexType: 'u16',
                    palette: Uint32Array.from(reducedColors),
                    counts: Uint32Array.from(reducedCounts),
                    opaquePixelCount,
                    quantized: true,
                    poorMatchPixelCount,
                };
            }
            indexed.width = width;
            indexed.height = height;
            indexed.mask = makeFullMask(indexed.palette.length, indexed.counts);
            if (options.onProgress) options.onProgress(1, 'Ready');
            return indexed;
        }

        function indexedToRgba(indices, indexType, palette) {
            const empty = emptyValue(indexType);
            const rgba = new Uint8ClampedArray(indices.length * 4);
            for (let pixel = 0; pixel < indices.length; pixel++) {
                const index = indices[pixel];
                if (index === empty) continue;
                const packed = palette[index];
                const offset = pixel * 4;
                rgba[offset] = (packed >>> 16) & 0xFF;
                rgba[offset + 1] = (packed >>> 8) & 0xFF;
                rgba[offset + 2] = packed & 0xFF;
                rgba[offset + 3] = 255;
            }
            return rgba;
        }

        function computeGridBounds(position, width, height) {
            if (!position || !Number.isFinite(position.gridX) || !Number.isFinite(position.gridY)) return null;
            return Object.freeze({
                left: Math.round(position.gridX),
                top: Math.round(position.gridY),
                right: Math.round(position.gridX) + width - 1,
                bottom: Math.round(position.gridY) - height + 1,
            });
        }

        function transformIndexed(indices, indexType, width, height, operation) {
            let nextWidth = width;
            let nextHeight = height;
            if (operation === 'rotate-cw' || operation === 'rotate-ccw') {
                nextWidth = height;
                nextHeight = width;
            }
            const output = makeIndexArray(indexType, nextWidth * nextHeight);
            output.fill(emptyValue(indexType));
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let nx = x, ny = y;
                    if (operation === 'flip-x') nx = width - 1 - x;
                    else if (operation === 'flip-y') ny = height - 1 - y;
                    else if (operation === 'rotate-cw') { nx = height - 1 - y; ny = x; }
                    else if (operation === 'rotate-ccw') { nx = y; ny = width - 1 - x; }
                    else throw new TypeError(`Unsupported transform: ${operation}`);
                    output[ny * nextWidth + nx] = indices[y * width + x];
                }
            }
            return { indices: output, width: nextWidth, height: nextHeight };
        }

        function templateHash(indices, palette, width, height) {
            let hash = 0x811C9DC5;
            function feed(value) {
                hash ^= value & 0xFF;
                hash = Math.imul(hash, 0x01000193) >>> 0;
            }
            feed(width); feed(width >>> 8); feed(height); feed(height >>> 8);
            const bytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
            for (let index = 0; index < bytes.length; index++) feed(bytes[index]);
            for (let index = 0; index < palette.length; index++) {
                const value = palette[index];
                feed(value); feed(value >>> 8); feed(value >>> 16);
            }
            return hash.toString(16).padStart(8, '0');
        }

        function decodePositionHeader(rgba, width, height) {
            assertDimensions(rgba, width, height);
            if (height < 2 || width < 5) return { position: null, rgba, width, height };
            const xVotes = new Map();
            const yVotes = new Map();
            for (let x = 0; x + 4 < width; x += 5) {
                const marker = x * 4;
                if (rgba[marker] !== POSITION_MARKER[0] || rgba[marker + 1] !== POSITION_MARKER[1] ||
                    rgba[marker + 2] !== POSITION_MARKER[2] || rgba[marker + 3] !== POSITION_MARKER[3]) continue;
                const p1 = (x + 1) * 4;
                const p2 = (x + 2) * 4;
                const p3 = (x + 3) * 4;
                const p4 = (x + 4) * 4;
                const encodedX = (((rgba[p1] << 24) >>> 0) | (rgba[p1 + 1] << 16) | (rgba[p2] << 8) | rgba[p2 + 1]) >>> 0;
                const encodedY = (((rgba[p3] << 24) >>> 0) | (rgba[p3 + 1] << 16) | (rgba[p4] << 8) | rgba[p4 + 1]) >>> 0;
                xVotes.set(encodedX, (xVotes.get(encodedX) || 0) + 1);
                yVotes.set(encodedY, (yVotes.get(encodedY) || 0) + 1);
            }
            if (!xVotes.size || !yVotes.size) return { position: null, rgba, width, height };
            const winner = votes => {
                let bestValue = null, bestCount = -1;
                for (const [value, count] of votes) {
                    if (count > bestCount) { bestValue = value; bestCount = count; }
                }
                return bestValue;
            };
            const encodedX = winner(xVotes);
            const encodedY = winner(yVotes);
            const position = {
                gridX: Number(BigInt(encodedX) - BigInt(POSITION_OFFSET)),
                gridY: Number(BigInt(encodedY) - BigInt(POSITION_OFFSET)),
            };
            const stripped = new Uint8ClampedArray(width * (height - 1) * 4);
            stripped.set(rgba.subarray(width * 4));
            return { position, rgba: stripped, width, height: height - 1 };
        }

        function encodePositionHeader(rgba, width, height, position) {
            assertDimensions(rgba, width, height);
            if (!position || !Number.isInteger(position.gridX) || !Number.isInteger(position.gridY)) {
                throw new TypeError('Integer grid coordinates are required for position export.');
            }
            const output = new Uint8ClampedArray(width * (height + 1) * 4);
            output.set(rgba, width * 4);
            const encodedX = Number((BigInt(position.gridX) + BigInt(POSITION_OFFSET)) & 0xFFFFFFFFn) >>> 0;
            const encodedY = Number((BigInt(position.gridY) + BigInt(POSITION_OFFSET)) & 0xFFFFFFFFn) >>> 0;
            for (let x = 0; x + 4 < width; x += 5) {
                const marker = x * 4;
                output.set(POSITION_MARKER, marker);
                const p1 = (x + 1) * 4, p2 = (x + 2) * 4, p3 = (x + 3) * 4, p4 = (x + 4) * 4;
                output[p1] = (encodedX >>> 24) & 0xFF; output[p1 + 1] = (encodedX >>> 16) & 0xFF; output[p1 + 3] = 255;
                output[p2] = (encodedX >>> 8) & 0xFF; output[p2 + 1] = encodedX & 0xFF; output[p2 + 3] = 255;
                output[p3] = (encodedY >>> 24) & 0xFF; output[p3 + 1] = (encodedY >>> 16) & 0xFF; output[p3 + 3] = 255;
                output[p4] = (encodedY >>> 8) & 0xFF; output[p4 + 1] = encodedY & 0xFF; output[p4 + 3] = 255;
            }
            return { rgba: output, width, height: height + 1 };
        }

        function compareRealityPixel(expectedIndex, mapR, mapG, mapB, mapAlpha, paletteLookup, tileKnown, groupOfIndex) {
            if (!tileKnown) return ERROR_STATE.UNKNOWN;
            if (mapAlpha <= ALPHA_THRESHOLD) return ERROR_STATE.MISSING;
            const actualIndex = paletteLookup.get(packRgb(mapR, mapG, mapB));
            if (actualIndex === expectedIndex) return ERROR_STATE.CORRECT;
            // Group Noise: a placed pixel matching any OTHER colour in the
            // same near-duplicate group as the expected colour still counts
            // as correct — mirrors native ghost22.js's fuzzy progress/error
            // matching. groupOfIndex is null/undefined whenever
            // template.groupNoise is off, so this branch never executes and
            // behaviour is byte-identical to before this parameter existed.
            if (groupOfIndex && actualIndex !== undefined && groupOfIndex[actualIndex] === groupOfIndex[expectedIndex]) {
                return ERROR_STATE.CORRECT;
            }
            return ERROR_STATE.WRONG;
        }

        // Greedy nearest-neighbour colour clustering, matching native
        // ghost22.js's "Group Noise" definition exactly: walk the palette in
        // order; for each colour, join the closest EXISTING group (by
        // squared RGB distance to that group's original representative —
        // never an average) if within thresholdSquared, else start a new
        // group with itself as representative.
        //
        // Optimization note: a brute-force "compare against every existing
        // group's representative" is O(n * g) — worst case O(n^2) against a
        // palette that can legitimately reach MAX_EXACT_COLORS (65534) for a
        // photo-derived source image. Since any two colours within
        // thresholdSquared must have each of |dr|,|db|,|dg| bounded by
        // floor(sqrt(thresholdSquared)) (a single channel differing by more
        // already exceeds the threshold on its own), only representatives in
        // that small integer neighbourhood around the current colour can
        // ever be a match. Indexing representatives by their exact (r,g,b)
        // in a Map and only probing that neighbourhood finds the exact same
        // minimum-distance match a brute-force scan would, in O(n) instead.
        function groupPaletteColors(palette, thresholdSquared) {
            if (typeof thresholdSquared !== 'number') thresholdSquared = GROUPING_THRESHOLD_SQUARED;
            const length = palette.length;
            const groupOfIndex = new Int32Array(length);
            const groups = [];
            const groupByRepresentative = new Map();
            const radius = Math.max(0, Math.floor(Math.sqrt(thresholdSquared)));
            const repByBucket = new Map(); // exact (r,g,b) key -> representative palette index
            const bucketKey = (r, g, b) => (r * 256 + g) * 256 + b;

            for (let i = 0; i < length; i++) {
                const packed = palette[i];
                const r = (packed >>> 16) & 0xFF;
                const g = (packed >>> 8) & 0xFF;
                const b = packed & 0xFF;

                let bestRep = -1;
                let bestDist = Infinity;
                for (let dr = -radius; dr <= radius; dr++) {
                    const nr = r + dr;
                    if (nr < 0 || nr > 255) continue;
                    for (let dg = -radius; dg <= radius; dg++) {
                        const ng = g + dg;
                        if (ng < 0 || ng > 255) continue;
                        for (let db = -radius; db <= radius; db++) {
                            const nb = b + db;
                            if (nb < 0 || nb > 255) continue;
                            const rep = repByBucket.get(bucketKey(nr, ng, nb));
                            if (rep === undefined) continue;
                            const dist = dr * dr + dg * dg + db * db;
                            if (dist <= thresholdSquared && dist < bestDist) {
                                bestDist = dist;
                                bestRep = rep;
                            }
                        }
                    }
                }

                if (bestRep !== -1) {
                    groupOfIndex[i] = bestRep;
                    groupByRepresentative.get(bestRep).memberIndices.push(i);
                } else {
                    groupOfIndex[i] = i;
                    const group = { representativeIndex: i, memberIndices: [i] };
                    groups.push(group);
                    groupByRepresentative.set(i, group);
                    repByBucket.set(bucketKey(r, g, b), i);
                }
            }

            return Object.freeze({ groupOfIndex, groups, groupByRepresentative });
        }

        return Object.freeze({
            constants: Object.freeze({
                ALPHA_THRESHOLD,
                MAX_EXACT_COLORS,
                MAX_U8_COLORS,
                EMPTY_U8,
                EMPTY_U16,
                POSITION_OFFSET,
                POSITION_MARKER,
                ERROR_STATE,
                GROUPING_THRESHOLD_SQUARED,
            }),
            packRgb,
            unpackRgb,
            packedToHex,
            packedToRgbaString,
            hexToPacked,
            emptyValue,
            makeIndexArray,
            makeFullMask,
            normalizeMask,
            maskHas,
            maskSet,
            maskToggle,
            maskOnly,
            indexRgba,
            indexRgbaAsync,
            indexedToRgba,
            computeGridBounds,
            transformIndexed,
            templateHash,
            decodePositionHeader,
            encodePositionHeader,
            compareRealityPixel,
            groupPaletteColors,
        });
    }

    function gppIngestWorkerMain(createCore) {
        'use strict';
        const core = createCore();
        self.onmessage = async event => {
            const message = event.data || {};
            if (message.type !== 'ingest') return;
            const operationId = message.operationId;
            let bitmap = null;
            try {
                self.postMessage({ type: 'progress', operationId, fraction: 0.02, label: 'Decoding image' });
                bitmap = await createImageBitmap(message.file);
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
                context.drawImage(bitmap, 0, 0);
                let rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
                let width = bitmap.width;
                let height = bitmap.height;
                const decoded = core.decodePositionHeader(rgba, width, height);
                rgba = decoded.rgba;
                width = decoded.width;
                height = decoded.height;
                const indexed = core.indexRgba(rgba, width, height, {
                    onProgress: (fraction, label) => self.postMessage({
                        type: 'progress',
                        operationId,
                        fraction: 0.05 + fraction * 0.94,
                        label,
                    }),
                });
                const payload = {
                    type: 'complete',
                    operationId,
                    width,
                    height,
                    position: decoded.position,
                    indexType: indexed.indexType,
                    indices: indexed.indices.buffer,
                    palette: indexed.palette.buffer,
                    counts: indexed.counts.buffer,
                    mask: indexed.mask.buffer,
                    opaquePixelCount: indexed.opaquePixelCount,
                    quantized: indexed.quantized,
                    poorMatchPixelCount: indexed.poorMatchPixelCount,
                };
                self.postMessage(payload, [payload.indices, payload.palette, payload.counts, payload.mask]);
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    operationId,
                    name: error && error.name ? error.name : 'Error',
                    message: error && error.message ? error.message : String(error),
                });
            } finally {
                if (bitmap) bitmap.close();
            }
        };
    }

    // Builds the source string for the Ghost++ ingest Worker's Blob URL.
    // Mirrors the original 1.0.0.js mechanism exactly (see its use of
    // `new Blob([workerSource], { type: 'text/javascript' })`): the
    // ingest-worker IIFE is invoked with the core-factory function's
    // source passed in as its literal `createCore` argument, so the
    // worker never needs a free/global reference to resolve it.
    function gppBuildIngestWorkerSource() {
        return ';(' + gppIngestWorkerMain.toString() + ')(' + gppCreateCore.toString() + ');';
    }
