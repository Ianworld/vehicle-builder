// Builds every sprite once at boot and caches the results.
//
// Rasterizing all parts costs a couple of milliseconds total, so there is no
// reason to do it lazily or per frame. Rotations are exact 90-degree spins of
// the index grid, so a rotated jet is pixel-identical to the original.

import { SPRITES, ROTATABLE } from './parts-art.js';
import { makeGrid, drawOps, stylePass, gridToCanvas, rotateGrid } from './raster.js';

const grids = new Map();     // "name" | "name@turns"  -> {w, h, grid}
const canvases = new Map();  // "<gridKey>#<scale>"    -> HTMLCanvasElement

function rasterize(def) {
  const grid = makeGrid(def.w, def.h);
  drawOps(grid, def.w, def.h, def.ops);
  stylePass(grid, def.w, def.h, def.style);
  return { w: def.w, h: def.h, grid };
}

let built = false;

export function buildAtlas() {
  if (built) return;
  for (const [name, def] of Object.entries(SPRITES)) {
    const base = rasterize(def);
    grids.set(name, base);
    if (ROTATABLE.includes(name)) {
      for (let t = 1; t < 4; t++) {
        const r = rotateGrid(base.grid, base.w, base.h, t);
        grids.set(`${name}@${t}`, r);
      }
    }
  }
  built = true;
}

const keyFor = (name, turns = 0) => (turns % 4 === 0 ? name : `${name}@${turns % 4}`);

export function spriteGrid(name, turns = 0) {
  buildAtlas();
  const key = keyFor(name, turns);
  const g = grids.get(key) || grids.get(name);
  if (!g) throw new Error(`no sprite: ${name}`);
  return g;
}

/**
 * Canvas for a sprite at an integer scale. Cached, so callers can ask for the
 * same sprite every frame without cost.
 */
export function spriteCanvas(name, turns = 0, scale = 1) {
  const key = `${keyFor(name, turns)}#${scale}`;
  let cv = canvases.get(key);
  if (!cv) {
    const g = spriteGrid(name, turns);
    cv = gridToCanvas(g.grid, g.w, g.h, scale);
    canvases.set(key, cv);
  }
  return cv;
}

/**
 * A FRESH canvas for a sprite. Use this any time the result goes into the DOM:
 * spriteCanvas hands back a shared cached node, and appending that same node in
 * two places silently moves it out of the first.
 */
export function spriteCopy(name, turns = 0, scale = 1) {
  const src = spriteCanvas(name, turns, scale);
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  cv.getContext('2d').drawImage(src, 0, 0);
  return cv;
}

export function spriteNames() {
  return Object.keys(SPRITES);
}

export { SPRITES, ROTATABLE };
