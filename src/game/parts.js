// The part catalog: what each part is, how big it is, and what it does.
//
// Footprints are in GRID CELLS. Physics numbers here are first-pass and get
// tuned in phase 3 against the real simulation; the builder only needs mass and
// the three meter contributions to be sane relative to each other.

export const CELL = 32;
export const GRID_W = 14;
export const GRID_H = 9;

// Every group carries an icon: the player this is built for cannot read the
// labels yet, so the picture has to do the work and the word is the backup.
export const GROUPS = [
  { id: 'structure', label: 'Body',  icon: '🧱' },
  { id: 'drive',     label: 'Go',    icon: '🛞' },
  { id: 'nose',      label: 'Front', icon: '🛡️' },
  { id: 'special',   label: 'Power', icon: '⚡' },
];

const P = (id, o) => ({ id, w: 1, h: 1, art: id, rotatable: false, ...o });

export const PARTS = [
  // -- structure ------------------------------------------------------------
  P('block', {
    group: 'structure', name: 'Block', role: 'structure',
    mass: 10, friction: 0.4,
  }),
  P('light_block', {
    group: 'structure', name: 'Light Block', role: 'structure',
    mass: 4, friction: 0.4,
  }),
  P('ballast', {
    group: 'structure', name: 'Weight', role: 'structure',
    mass: 34, friction: 0.5,
  }),

  // -- drive ----------------------------------------------------------------
  P('wheel_small', {
    group: 'drive', name: 'Small Wheel', role: 'wheel',
    mass: 6,
    wheel: { radius: 0.5, motorSpeed: 26, motorTorque: 75, friction: 1.1,
             suspHz: 7.0, suspDamp: 0.7 },
  }),
  P('wheel_big', {
    group: 'drive', name: 'Big Wheel', role: 'wheel', w: 2, h: 2,
    mass: 16,
    wheel: { radius: 1.0, motorSpeed: 15, motorTorque: 200, friction: 1.5,
             suspHz: 4.5, suspDamp: 0.8 },
  }),
  P('tread', {
    group: 'drive', name: 'Tread', role: 'tread', w: 2, h: 1,
    mass: 20,
    // Modelled as two hidden high-friction wheels under one shell.
    wheel: { radius: 0.5, motorSpeed: 14, motorTorque: 120, friction: 2.4,
             suspHz: 9.0, suspDamp: 0.9 },
  }),
  P('jet', {
    group: 'drive', name: 'Jet', role: 'thruster', rotatable: true,
    mass: 8,
    thrust: { force: 900 },
    // Direction the part pushes at rotation 0, in local space with Y up.
    // Rotating the part rotates this with it.
    pushDir: [1, 0],
  }),

  // -- nose / obstacle clearing ---------------------------------------------
  P('wedge', {
    group: 'nose', name: 'Plow', role: 'structure', rotatable: true,
    mass: 8, friction: 0.08,      // slippery on purpose: obstacles slide up it
  }),
  P('bumper', {
    group: 'nose', name: 'Bumper', role: 'structure',
    mass: 6, friction: 0.3, restitution: 0.55,
  }),
  P('grip_hook', {
    group: 'nose', name: 'Grabber', role: 'structure',
    mass: 7, friction: 2.2,
  }),
  P('wing', {
    group: 'nose', name: 'Wing', role: 'wing', w: 2, h: 1,
    mass: 6, friction: 0.2,
    wing: { downforce: 4 },       // scales with the SQUARE of forward speed:
                                  // 22 here pressed harder than gravity at 8 m/s
  }),

  // -- specials: everything here fires on the action button -----------------
  P('booster', {
    group: 'special', name: 'Boost', role: 'special', rotatable: true,
    mass: 9, pushDir: [1, 0],
    special: { kind: 'boost', impulse: 2600, duration: 0.9, cooldown: 4 },
  }),
  P('jump_jet', {
    group: 'special', name: 'Hop', role: 'special', rotatable: true,
    // Nozzle points down at rotation 0, so it pushes UP.
    mass: 9, pushDir: [0, 1],
    special: { kind: 'hop', impulse: 1900, duration: 0.25, cooldown: 3 },
  }),
  P('grip_surge', {
    group: 'special', name: 'Stick', role: 'special', rotatable: true,
    // Traction, not thrust -- rotation is cosmetic here.
    mass: 7, pushDir: [1, 0],
    special: { kind: 'grip', multiplier: 2.6, duration: 2.5, cooldown: 5 },
  }),
];

export const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));

/**
 * Stable ordering for the share-link codec. Parts may be APPENDED but never
 * reordered or removed -- an old link's indices have to keep meaning the same
 * thing. Anything dropped in future should become a null placeholder.
 */
export const CODEC_ORDER = PARTS.map((p) => p.id);

export const getPart = (id) => PART_BY_ID[id];

/** Cells a part occupies, honoring rotation (which swaps w/h on odd turns). */
export function partSize(part, rot = 0) {
  return rot % 2 === 0 ? { w: part.w, h: part.h } : { w: part.h, h: part.w };
}
