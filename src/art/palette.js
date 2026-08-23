// THE palette. Sixteen colors, four ramps. Nothing else in the game may name a
// sprite color -- every drawing op refers to an index in here, which is what
// makes the palette lock structural instead of a thing we have to remember.
//
//   0        ink / outline
//   1 -  6   steel      (chassis, rims, rubber at the dark end)
//   7 - 10   ember      (jets, boost, hazard)
//  11 - 13   aqua       (energy, grip, glass)
//  14 - 15   crimson    (danger accents)

export const PALETTE = Object.freeze([
  '#12141c', // 0  ink
  '#2a3140', // 1  steel 1 - darkest, doubles as tire rubber
  '#454e63', // 2  steel 2
  '#68738d', // 3  steel 3
  '#97a1b8', // 4  steel 4
  '#d5dce8', // 5  steel 5
  '#f4f7fc', // 6  steel 6 - white highlight
  '#8a3410', // 7  ember 1
  '#d4541c', // 8  ember 2
  '#ff8c1a', // 9  ember 3
  '#ffd23e', // 10 ember 4 - yellow
  '#16506e', // 11 aqua 1
  '#2e9fd6', // 12 aqua 2
  '#7fe3ff', // 13 aqua 3
  '#7a2230', // 14 crimson 1
  '#e0454f', // 15 crimson 2
]);

// One step up / down each ramp. The shared style pass uses these to bevel every
// sprite identically, so highlights and shadows can never drift off-palette.
// Ends of a ramp clamp to themselves.
export const LIGHTER = Object.freeze([
  0,  2, 3, 4, 5, 6, 6,  8, 9, 10, 10,  12, 13, 13,  15, 15,
]);

export const DARKER = Object.freeze([
  0,  1, 1, 2, 3, 4, 5,  7, 7, 8, 9,   11, 11, 12,  14, 14,
]);

export const INK = 0;

/** Palette index -> [r,g,b], precomputed once for the rasterizer. */
export const RGB = Object.freeze(PALETTE.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]));
