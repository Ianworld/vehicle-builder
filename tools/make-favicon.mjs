// Generates the favicons from the same sprite DSL as the game art, so the icon
// cannot drift off-palette or off-style. Run:  node tools/make-favicon.mjs
//
// Emits favicon-32.png, favicon-64.png and apple-touch-icon.png (192px), all
// nearest-neighbour integer scales of one 32x32 design.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGrid, drawOps, stylePass, T } from '../src/art/raster.js';
import { RGB } from '../src/art/palette.js';
import { encodePNG } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 32;

// A chunky rover in profile: big wheels, a plow nose, boost flaring behind.
// Drawn directly at 32px rather than shrunk from a larger sprite -- downscaled
// pixel art turns to mush at icon sizes.
const ICON = [
  // Fewer, bigger, higher-contrast shapes than the in-game sprites: at 32px a
  // recessed panel and a mid-grey wedge both just read as "dark blob".

  // exhaust plume, the most distinctive silhouette cue
  ['poly', [[0, 10], [11, 16], [0, 22]], 8],
  ['poly', [[0, 12], [7.5, 16], [0, 20]], 9],
  ['poly', [[0, 14], [4, 16], [0, 18]], 10],

  // hull: light body, one bold dark window
  ['rrect', 7, 6, 19, 13, 3, 4],
  ['rect', 10, 9, 13, 6, 1],
  ['rect', 10, 9, 13, 2, 2],

  // plow: brightest value on the icon so it stays visible when tiny
  ['poly', [[25, 20], [32, 20], [25, 8]], 5],

  // Wheels: a plain bright disc on a dark tyre reads as an EYE, and two of
  // them plus the dark window turn the whole icon into a face. A dark hub and
  // a few tread lugs break that up.
  ...wheel(12, 21.5),
  ...wheel(22, 21.5),
];

function wheel(cx, cy) {
  const ops = [['circle', cx, cy, 6.5, 1]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    ops.push(['circle', cx + Math.cos(a) * 5.6, cy + Math.sin(a) * 5.6, 1.15, 2]);
  }
  ops.push(['circle', cx, cy, 3.4, 5]);
  ops.push(['circle', cx, cy, 1.4, 2]);
  return ops;
}


function render() {
  const g = makeGrid(SIZE, SIZE);
  drawOps(g, SIZE, SIZE, ICON);
  // No edge outline: the plume and plow deliberately bleed to the canvas edge.
  stylePass(g, SIZE, SIZE, { edgeOutline: false });
  return g;
}

function toRGBA(grid, scale) {
  const w = SIZE * scale;
  const out = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[((y / scale) | 0) * SIZE + ((x / scale) | 0)];
      const o = (y * w + x) * 4;
      if (c === T) continue;                 // transparent
      const [r, gg, b] = RGB[c];
      out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return { w, rgba: out };
}

/**
 * Wrap a PNG in a single-image .ico. Browsers request /favicon.ico implicitly
 * whatever <link rel="icon"> says, so without this every page load logs a 404.
 */
function icoWrap(png, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);            // reserved
  head.writeUInt16LE(1, 2);            // type: icon
  head.writeUInt16LE(1, 4);            // one image
  head.writeUInt8(size >= 256 ? 0 : size, 6);
  head.writeUInt8(size >= 256 ? 0 : size, 7);
  head.writeUInt8(0, 8);               // palette size
  head.writeUInt8(0, 9);               // reserved
  head.writeUInt16LE(1, 10);           // colour planes
  head.writeUInt16LE(32, 12);          // bits per pixel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);          // offset to image data
  return Buffer.concat([head, png]);
}

const grid = render();
for (const [file, scale] of [
  ['favicon-32.png', 1], ['favicon-64.png', 2], ['apple-touch-icon.png', 6],
]) {
  const { w, rgba } = toRGBA(grid, scale);
  const png = encodePNG(w, w, rgba);
  fs.writeFileSync(path.join(ROOT, file), png);
  console.log(`${file.padEnd(22)} ${w}x${w}  ${png.length} bytes`);
}

{
  const { w, rgba } = toRGBA(grid, 1);
  const ico = icoWrap(encodePNG(w, w, rgba), w);
  fs.writeFileSync(path.join(ROOT, 'favicon.ico'), ico);
  console.log(`${'favicon.ico'.padEnd(22)} ${w}x${w}  ${ico.length} bytes`);
}

// ASCII proof so the design can be sanity-checked without opening an image.
const chars = '0123456789abcdef';
let art = '';
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const c = grid[y * SIZE + x];
    art += c === T ? '.' : chars[c];
  }
  art += '\n';
}
console.log('\n' + art);
