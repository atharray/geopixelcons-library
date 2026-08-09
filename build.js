'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, 'dist', 'geopixelcons-library.js');
const SOURCE_ORDER = [
    'src/contracts.js',
    'src/index.js',
];

const body = SOURCE_ORDER
    .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'))
    .join('\n\n')
    .trimEnd();
const artifact = `/* GeoPixelcons Library v0.1.0 - readable release bundle */\n${body}\n`;

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, artifact, 'utf8');

const sri = `sha256-${crypto.createHash('sha256').update(artifact).digest('base64')}`;
console.log(`Built: ${path.relative(ROOT, OUTPUT)} (${Buffer.byteLength(artifact)} bytes)`);
console.log(`SRI: ${sri}`);
