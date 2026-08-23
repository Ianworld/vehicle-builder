// Sprite definitions.
//
// Each part is a list of drawing ops against the locked palette (see
// palette.js). Style -- outline, highlight, shadow -- is NOT authored here; the
// shared style pass in raster.js applies it uniformly to every sprite. What
// lives here is only shape and local color.
//
// Coordinates are continuous, not pixel indices: a shape filling a 32px sprite
// spans 0..32. Grid cell is 32px, so a 2x1 part is a 64x32 sprite.

export const CELL = 32;

// ------------------------------------------------------------------ helpers

/** Tread lugs evenly spaced around a wheel's outer band. */
function lugs(cx, cy, r, n, size, color) {
  const ops = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ops.push(['circle', cx + Math.cos(a) * r, cy + Math.sin(a) * r, size, color]);
  }
  return ops;
}

/** Spokes from hub radius r0 out to rim radius r1. */
function spokes(cx, cy, r0, r1, n, color, thick = 2) {
  const ops = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    // Two offset lines give a spoke with some weight without needing a poly.
    for (let t = -(thick - 1) / 2; t <= (thick - 1) / 2; t += 1) {
      ops.push(['line',
        cx + dx * r0 - dy * t, cy + dy * r0 + dx * t,
        cx + dx * r1 - dy * t, cy + dy * r1 + dx * t, color]);
    }
  }
  return ops;
}

/** A wheel, built once so small and large wheels can't drift apart in style. */
function wheel(size, { lugCount, spokeCount }) {
  const c = size / 2;
  const tire = c - 0.5;
  const rim = size * 0.32;
  const hub = size * 0.11;
  return [
    ['circle', c, c, tire, 1],
    ...lugs(c, c, tire - size * 0.045, lugCount, size * 0.055, 2),
    ['circle', c, c, rim, 4],
    ['circle', c, c, rim - size * 0.045, 3],
    ...spokes(c, c, hub, rim - size * 0.03, spokeCount, 4, size > 40 ? 3 : 2),
    ['circle', c, c, hub, 2],
    ['circle', c, c, hub * 0.45, 5],
  ];
}

/**
 * One exhaust plume frame. Drawn pointing +X with the attachment edge at x=0,
 * vertically centred, so the renderer can pin it to a nozzle and rotate it to
 * whatever direction that thruster actually pushes.
 */
function plume(len, wob, h = 26) {
  const mid = h / 2;
  return [
    ['poly', [[0, mid - 10], [len, mid + wob], [0, mid + 10]], 8],
    ['poly', [[0, mid - 7], [len * 0.72, mid - wob * 0.6], [0, mid + 7]], 9],
    ['poly', [[0, mid - 3.8], [len * 0.40, mid + wob * 0.4], [0, mid + 3.8]], 10],
    // A detached spark or two keeps it from reading as a solid cone.
    ['circle', len * 0.86, mid - 6 + wob, 1.8, 9],
    ['circle', len * 0.70, mid + 6.5 - wob, 1.4, 10],
  ];
}

// Plumes attach flush against a nozzle, so the canvas edge must NOT be inked --
// otherwise a black bar sits between the part and its own flame.
const PLUME_STYLE = { edgeOutline: false };

/** Forward-pointing chevron, used on the boost parts. */
function chevron(x, y, w, h, t, color) {
  return ['poly', [
    [x, y], [x + w, y + h / 2], [x, y + h],
    [x - t, y + h], [x + w - t, y + h / 2], [x - t, y],
  ], color];
}

// ------------------------------------------------------------------ sprites

export const SPRITES = {
  // -- structure ------------------------------------------------------------

  // Plain armored chassis plate. The workhorse; every other part reads against
  // this, so it stays deliberately plain.
  block: { w: 32, h: 32, ops: [
    ['rect', 0, 0, 32, 32, 3],
    ['rrect', 5, 5, 22, 22, 4, 2],
    ['circle', 2.5, 2.5, 1.4, 5], ['circle', 29.5, 2.5, 1.4, 5],
    ['circle', 2.5, 29.5, 1.4, 5], ['circle', 29.5, 29.5, 1.4, 5],
  ]},

  // Open frame with an X brace -- visually obviously lighter than a solid block.
  light_block: { w: 32, h: 32, ops: [
    ['rect', 0, 0, 32, 32, 3],
    ['clear', 4, 4, 24, 24],
    ['poly', [[4, 10], [10, 4], [28, 22], [22, 28]], 3],
    ['poly', [[22, 4], [28, 10], [10, 28], [4, 22]], 3],
    ['circle', 16, 16, 3, 4],
  ]},

  // Stacked dense plates. Dark and low-detail so it reads heavy at a glance.
  ballast: { w: 32, h: 32, ops: [
    ['rect', 0, 0, 32, 32, 2],
    ['rect', 3, 4, 26, 5, 1],
    ['rect', 3, 12, 26, 5, 1],
    ['rect', 3, 20, 26, 5, 1],
    ['rect', 3, 27, 26, 3, 1],
    ['rect', 0, 0, 32, 3, 3],
  ]},

  // -- drive ----------------------------------------------------------------

  wheel_small: { w: 32, h: 32, ops: wheel(32, { lugCount: 10, spokeCount: 5 }) },
  wheel_big:   { w: 64, h: 64, ops: wheel(64, { lugCount: 14, spokeCount: 6 }) },

  // Tank tread: two pulleys inside a continuous belt. Real tread links are a
  // trap to simulate, so the physics uses two hidden high-friction wheels and
  // this sprite sells the illusion.
  tread: { w: 64, h: 32, ops: [
    ['rrect', 0, 0, 64, 32, 15.5, 1],
    ...Array.from({ length: 11 }, (_, i) => ['rect', 4 + i * 5.4, 0, 3, 4, 2]),
    ...Array.from({ length: 11 }, (_, i) => ['rect', 4 + i * 5.4, 28, 3, 4, 2]),
    ['rrect', 5, 5, 54, 22, 11, 2],
    ['circle', 16, 16, 9, 4], ['circle', 48, 16, 9, 4],
    ['circle', 16, 16, 6.5, 3], ['circle', 48, 16, 6.5, 3],
    ['circle', 16, 16, 2.5, 2], ['circle', 48, 16, 2.5, 2],
    ['circle', 32, 16, 4.5, 3], ['circle', 32, 16, 2, 2],
  ]},

  // Jet points thrust to the right: nozzle flares left, mount is on the right.
  jet: { w: 32, h: 32, ops: [
    ['poly', [[0, 4], [11, 11], [11, 21], [0, 28]], 2],
    ['poly', [[1.5, 8], [10, 13], [10, 19], [1.5, 24]], 9],
    ['poly', [[2, 12], [9, 14.5], [9, 17.5], [2, 20]], 10],
    ['poly', [[15, 2], [23, 2], [21, 9], [17, 9]], 2],
    ['rrect', 9, 9, 21, 14, 5, 3],
    ['rrect', 12, 12, 12, 8, 3, 2],
    ['rect', 27, 10, 4, 12, 4],
    ['circle', 25.5, 16, 1.6, 5],
  ]},

  // -- nose / obstacle clearing ---------------------------------------------

  // Plow. Tip is low at the front (right), rising backward, so obstacles ride
  // up and over instead of stopping the vehicle.
  wedge: { w: 32, h: 32, ops: [
    ['poly', [[32, 27.5], [32, 32], [0, 32], [0, 4]], 3],
    // Horizontal slots only. A 1px diagonal rib would make the bevel pass
    // speckle along the hypotenuse; horizontal edges bevel cleanly.
    ['rect', 4, 19, 9, 3, 2],
    ['rect', 4, 25, 15, 3, 2],
    ['rect', 0, 23, 6, 9, 4],
    ['circle', 2.8, 27.5, 1.3, 5],
    ['line', 0, 4, 31, 31, 5],
  ]},

  bumper: { w: 32, h: 32, ops: [
    ['rect', 0, 9, 9, 14, 2],
    ['rrect', 6, 3, 26, 26, 11, 8],
    ['rrect', 11, 8, 17, 16, 7, 9],
    ['rect', 14, 11, 12, 2, 8],
    ['rect', 14, 18, 12, 2, 8],
  ]},

  // Crampon-style gripper: forward spikes that catch a ledge lip.
  grip_hook: { w: 32, h: 32, ops: [
    ['rrect', 0, 3, 13, 26, 3, 3],
    ['rect', 3, 8, 7, 3, 2],
    ['rect', 3, 21, 7, 3, 2],
    ['poly', [[11, 5], [28, 9], [11, 12.5]], 4],
    ['poly', [[11, 12], [31.5, 16], [11, 20]], 4],
    ['poly', [[11, 19.5], [28, 23], [11, 27]], 4],
  ]},

  // Downforce wing. Two struts, two endplates -- reads as aero, not as armor.
  wing: { w: 64, h: 32, ops: [
    ['rect', 14, 12, 5, 15, 2],
    ['rect', 45, 12, 5, 15, 2],
    ['rect', 10, 26, 13, 6, 3],
    ['rect', 41, 26, 13, 6, 3],
    ['rrect', 2, 5, 60, 8, 3, 4],
    ['rect', 2, 5, 60, 2, 5],
    ['rect', 0, 1, 5, 16, 3],
    ['rect', 59, 1, 5, 16, 3],
  ]},

  // -- specials (the action button) -----------------------------------------

  booster: { w: 32, h: 32, ops: [
    ['poly', [[0, 8], [8, 12], [8, 20], [0, 24]], 7],
    ['poly', [[1, 11], [7, 13.5], [7, 18.5], [1, 21]], 10],
    ['rrect', 6, 6, 24, 20, 6, 8],
    chevron(13, 9, 6, 14, 3, 10),
    chevron(20, 9, 6, 14, 3, 10),
    chevron(27, 9, 6, 14, 3, 10),
  ]},

  jump_jet: { w: 32, h: 32, ops: [
    ['poly', [[6, 20], [26, 20], [22, 32], [10, 32]], 11],
    ['poly', [[10, 23], [22, 23], [19, 31], [13, 31]], 13],
    ['rrect', 6, 2, 20, 20, 5, 12],
    ['poly', [[16, 4], [24, 13], [19.5, 13], [19.5, 19], [12.5, 19], [12.5, 13], [8, 13]], 13],
  ]},

  // -- exhaust plumes (not placeable parts; drawn by the renderer) ----------
  flame_a: { w: 46, h: 26, ops: plume(34, -1.8), style: PLUME_STYLE },
  flame_b: { w: 46, h: 26, ops: plume(44, 0),    style: PLUME_STYLE },
  flame_c: { w: 46, h: 26, ops: plume(28, 1.8),  style: PLUME_STYLE },
  flame_d: { w: 46, h: 26, ops: plume(39, 1.0),  style: PLUME_STYLE },

  grip_surge: { w: 32, h: 32, ops: [
    ['rrect', 2, 3, 28, 17, 4, 11],
    ['rect', 6, 6, 20, 3, 12],
    ['rect', 6, 12, 20, 3, 12],
    ['poly', [[3, 21], [11, 21], [7, 30]], 13],
    ['poly', [[12, 21], [20, 21], [16, 30]], 13],
    ['poly', [[21, 21], [29, 21], [25, 30]], 13],
  ]},
};

/** Parts whose sprite must be re-rasterized per rotation rather than spun. */
export const ROTATABLE = ['jet', 'wedge'];
