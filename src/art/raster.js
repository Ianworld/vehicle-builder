// Rasterizer for the sprite DSL.
//
// Sprites are lists of geometric primitives drawn onto a Uint8Array of palette
// indices -- not onto a canvas. Going through Canvas paths would antialias the
// edges, which is exactly what makes generated art look mushy at 32px. Here a
// pixel is either one palette index or transparent, full stop.
//
// After the primitives are drawn, every sprite goes through the SAME style pass
// (inner outline, top highlight, bottom shade). That shared pass is what makes
// independently-authored sprites read as one art set.

import { RGB, LIGHTER, DARKER, INK } from './palette.js';

/** Perceptual brightness per palette index, used to tell a raised boss from a
 *  recessed pocket during the bevel pass. */
const LUM = RGB.map(([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b);

/** Transparent sentinel. Uint8Array can't hold -1, so 255 means "no pixel". */
export const T = 255;

export function makeGrid(w, h) {
  const g = new Uint8Array(w * h);
  g.fill(T);
  return g;
}

// ---------------------------------------------------------------- primitives

// Every primitive funnels through this, so bounds checking lives in one place.
function put(g, w, h, x, y, c) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  g[y * w + x] = c;
}

function fillRect(g, w, h, x, y, rw, rh, c) {
  for (let yy = y; yy < y + rh; yy++) {
    for (let xx = x; xx < x + rw; xx++) put(g, w, h, xx, yy, c);
  }
}

function strokeRect(g, w, h, x, y, rw, rh, c) {
  for (let xx = x; xx < x + rw; xx++) { put(g, w, h, xx, y, c); put(g, w, h, xx, y + rh - 1, c); }
  for (let yy = y; yy < y + rh; yy++) { put(g, w, h, x, yy, c); put(g, w, h, x + rw - 1, yy, c); }
}

// Pixel centers sit at +0.5, which is what keeps circles visually centered
// rather than one pixel heavy on the top-left.
function fillCircle(g, w, h, cx, cy, r, c) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) put(g, w, h, x, y, c);
    }
  }
}

function strokeCircle(g, w, h, cx, cy, r, c, thick = 1) {
  const outer = r * r, inner = (r - thick) * (r - thick);
  for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d2 = dx * dx + dy * dy;
      if (d2 <= outer && d2 > inner) put(g, w, h, x, y, c);
    }
  }
}

function fillEllipse(g, w, h, cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) put(g, w, h, x, y, c);
    }
  }
}

function line(g, w, h, x0, y0, x1, y1, c) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    put(g, w, h, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Even-odd scanline fill. Sampling at pixel-center y+0.5 avoids the classic
// off-by-one where a vertex exactly on a scanline gets counted twice.
//
// Polygon coordinates are CONTINUOUS, not pixel indices: a shape covering a
// whole 32px sprite spans 0..32, not 0..31. Using 0..31 leaves the last row
// and column unfilled.
function fillPoly(g, w, h, pts, c) {
  let minY = Infinity, maxY = -Infinity;
  for (const [, py] of pts) { if (py < minY) minY = py; if (py > maxY) maxY = py; }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const sy = y + 0.5;
    const xs = [];
    for (let i = 0, n = pts.length; i < n; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % n];
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
        xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.floor(xs[i] + 0.5); x < Math.ceil(xs[i + 1] - 0.5) + 1; x++) {
        if (x + 0.5 >= xs[i] && x + 0.5 <= xs[i + 1]) put(g, w, h, x, y, c);
      }
    }
  }
}

function fillRoundRect(g, w, h, x, y, rw, rh, r, c) {
  for (let yy = 0; yy < rh; yy++) {
    for (let xx = 0; xx < rw; xx++) {
      // Distance from the nearest corner arc center; inside the straight
      // sections dx/dy fall to zero and the test always passes.
      const dx = Math.max(0, (r - 0.5) - xx, xx - (rw - r - 0.5));
      const dy = Math.max(0, (r - 0.5) - yy, yy - (rh - r - 0.5));
      if (dx * dx + dy * dy <= r * r) put(g, w, h, x + xx, y + yy, c);
    }
  }
}

const OPS = {
  rect:    (g, w, h, a) => fillRect(g, w, h, a[0], a[1], a[2], a[3], a[4]),
  box:     (g, w, h, a) => strokeRect(g, w, h, a[0], a[1], a[2], a[3], a[4]),
  rrect:   (g, w, h, a) => fillRoundRect(g, w, h, a[0], a[1], a[2], a[3], a[4], a[5]),
  circle:  (g, w, h, a) => fillCircle(g, w, h, a[0], a[1], a[2], a[3]),
  ring:    (g, w, h, a) => strokeCircle(g, w, h, a[0], a[1], a[2], a[3], a[4] ?? 1),
  ellipse: (g, w, h, a) => fillEllipse(g, w, h, a[0], a[1], a[2], a[3], a[4]),
  line:    (g, w, h, a) => line(g, w, h, a[0], a[1], a[2], a[3], a[4]),
  poly:    (g, w, h, a) => fillPoly(g, w, h, a[0], a[1]),
  pset:    (g, w, h, a) => put(g, w, h, a[0], a[1], a[2]),
  clear:   (g, w, h, a) => fillRect(g, w, h, a[0], a[1], a[2], a[3], T),
};

export function drawOps(grid, w, h, ops) {
  for (const op of ops) {
    if (!op) continue;             // lets helpers return null to skip
    const fn = OPS[op[0]];
    if (!fn) throw new Error(`unknown draw op: ${op[0]}`);
    fn(grid, w, h, op.slice(1));
  }
  return grid;
}

// --------------------------------------------------------------- style pass

/**
 * The shared look. Applied identically to every sprite:
 *   1. inner 1px ink outline (inner, not outer, so a sprite never bleeds past
 *      its grid cell -- parts have to tile edge to edge)
 *   2. 1px highlight on upward-facing edges
 *   3. 1px shade on downward-facing edges
 *
 * @param {object} [opts]
 * @param {boolean} [opts.edgeOutline=true] treat off-canvas as empty, so a
 *   full-bleed sprite still gets a border. Off for sprites meant to look
 *   continuous with their neighbours.
 */
export function stylePass(grid, w, h, opts = {}) {
  const { edgeOutline = true, outline = true, bevel = true } = opts;
  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return edgeOutline ? T : null;
    return grid[y * w + x];
  };
  const empty = (v) => v === T || v === null;

  if (outline) {
    // Collected first, applied after -- otherwise freshly-inked pixels would
    // look like empty space to their neighbours and the outline would cascade
    // inward across the whole sprite.
    const edge = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (grid[i] === T) continue;
        if (empty(at(x - 1, y)) || empty(at(x + 1, y)) ||
            empty(at(x, y - 1)) || empty(at(x, y + 1))) edge.push(i);
      }
    }
    for (const i of edge) grid[i] = INK;
  }

  if (bevel) {
    // Bevel every horizontal edge, silhouette and internal alike. Which way to
    // shade is inferred from relative brightness: a region DARKER than what
    // sits above it reads as a recessed pocket, so its top edge takes the
    // shadow; a region LIGHTER than its neighbour reads as a raised boss, so
    // its top edge takes the highlight. Transparent and ink both count as
    // "dark", which makes the silhouette a boss and lights its top edge.
    const snap = grid.slice();
    const snapAt = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return edgeOutline ? T : null;
      return snap[y * w + x];
    };
    const lumOf = (v) => (v === T || v === null || v === INK ? -1 : LUM[v]);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const c = snap[i];
        if (c === T || c === INK) continue;
        const mine = LUM[c];
        const up = snapAt(x, y - 1);
        const down = snapAt(x, y + 1);

        if (up !== c) {
          grid[i] = lumOf(up) < mine ? LIGHTER[c] : DARKER[c];
        } else if (down !== c) {
          grid[i] = lumOf(down) < mine ? DARKER[c] : LIGHTER[c];
        }
      }
    }
  }
  return grid;
}

// ------------------------------------------------------------------ output

/** Exact 90-degree rotation of the index grid. No resampling, so no mush. */
export function rotateGrid(grid, w, h, turns) {
  turns = ((turns % 4) + 4) % 4;
  if (turns === 0) return { grid: grid.slice(), w, h };
  const nw = turns === 2 ? w : h;
  const nh = turns === 2 ? h : w;
  const out = makeGrid(nw, nh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (turns === 1) { nx = h - 1 - y; ny = x; }
      else if (turns === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      out[ny * nw + nx] = grid[y * w + x];
    }
  }
  return { grid: out, w: nw, h: nh };
}

export function flipGridX(grid, w, h) {
  const out = makeGrid(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + (w - 1 - x)] = grid[y * w + x];
  }
  return out;
}

/** Nearest-neighbour blit to a canvas at an integer scale. */
export function gridToCanvas(grid, w, h, scale = 1) {
  const cv = document.createElement('canvas');
  cv.width = w * scale;
  cv.height = h * scale;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cv.width, cv.height);
  const d = img.data;
  for (let y = 0; y < cv.height; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < cv.width; x++) {
      const c = grid[sy * w + ((x / scale) | 0)];
      const o = (y * cv.width + x) * 4;
      if (c === T) { d[o + 3] = 0; continue; }
      const rgb = RGB[c];
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Debug view: the grid as text, one char per palette index. */
export function gridToAscii(grid, w, h) {
  const chars = '0123456789abcdef';
  let out = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y * w + x];
      out += c === T ? '.' : chars[c];
    }
    out += '\n';
  }
  return out;
}
