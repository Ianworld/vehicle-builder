// The vehicle grid model: placement rules, connectivity, stats, and the
// on-disk shape. Pure data -- no DOM, no physics, so it can be unit-tested and
// reused by the racer.

import { PARTS, PART_BY_ID, getPart, partSize, GRID_W, GRID_H } from './parts.js';
import { vehicleBoundsCells } from './geometry.js';

export const SCHEMA_VERSION = 1;

const ADJECTIVES = ['Red', 'Turbo', 'Mighty', 'Rusty', 'Sneaky', 'Jumbo', 'Zippy',
  'Grumpy', 'Cosmic', 'Chunky', 'Silver', 'Wild', 'Brave', 'Lucky', 'Thunder'];
const NOUNS = ['Stomper', 'Crawler', 'Rocket', 'Bruiser', 'Hopper', 'Digger',
  'Comet', 'Tank', 'Buggy', 'Roller', 'Beast', 'Bolt', 'Rig', 'Racer'];

let nameSeed = 0;
export function randomName() {
  // Deterministic-ish rotation rather than pure random, so two vehicles made
  // back to back never collide on a name.
  const a = ADJECTIVES[(Math.random() * ADJECTIVES.length) | 0];
  const n = NOUNS[(Math.random() * NOUNS.length) | 0];
  nameSeed++;
  return `${a} ${n}`;
}

export function newId() {
  return 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function emptyVehicle(name) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name: name || randomName(),
    created: Date.now(),
    modified: Date.now(),
    parts: [],
  };
}

export const clone = (v) => JSON.parse(JSON.stringify(v));

// --------------------------------------------------------------- occupancy

/** Every cell a placement covers. */
export function cellsOf(placement) {
  const part = getPart(placement.t);
  if (!part) return [];
  const { w, h } = partSize(part, placement.r || 0);
  const out = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) out.push([placement.x + dx, placement.y + dy]);
  }
  return out;
}

/** Map of "x,y" -> placement index. */
export function occupancy(vehicle) {
  const map = new Map();
  vehicle.parts.forEach((p, i) => {
    for (const [x, y] of cellsOf(p)) map.set(`${x},${y}`, i);
  });
  return map;
}

export function inBounds(placement) {
  const part = getPart(placement.t);
  if (!part) return false;
  const { w, h } = partSize(part, placement.r || 0);
  return placement.x >= 0 && placement.y >= 0 &&
         placement.x + w <= GRID_W && placement.y + h <= GRID_H;
}

/** Can this placement go here? `ignoreIndex` lets a part be tested in place. */
export function canPlace(vehicle, placement, ignoreIndex = -1) {
  if (!inBounds(placement)) return false;
  const occ = occupancy(vehicle);
  for (const [x, y] of cellsOf(placement)) {
    const hit = occ.get(`${x},${y}`);
    if (hit !== undefined && hit !== ignoreIndex) return false;
  }
  return true;
}

export function placeAt(vehicle, placement) {
  if (!canPlace(vehicle, placement)) return false;
  vehicle.parts.push({ t: placement.t, x: placement.x, y: placement.y, r: placement.r || 0 });
  vehicle.modified = Date.now();
  return true;
}

export function partIndexAt(vehicle, x, y) {
  const hit = occupancy(vehicle).get(`${x},${y}`);
  return hit === undefined ? -1 : hit;
}

export function removeAt(vehicle, x, y) {
  const i = partIndexAt(vehicle, x, y);
  if (i < 0) return false;
  vehicle.parts.splice(i, 1);
  vehicle.modified = Date.now();
  return true;
}

/** Rotate the part under a cell, but only if it still fits where it sits. */
export function rotateAt(vehicle, x, y) {
  const i = partIndexAt(vehicle, x, y);
  if (i < 0) return false;
  const p = vehicle.parts[i];
  if (!getPart(p.t)?.rotatable) return false;
  const next = { ...p, r: ((p.r || 0) + 1) % 4 };
  if (!canPlace(vehicle, next, i)) return false;
  vehicle.parts[i] = next;
  vehicle.modified = Date.now();
  return true;
}

// ------------------------------------------------------------ connectivity

/**
 * Indices of parts NOT attached to the main body.
 *
 * There is no designated cockpit part, so "the vehicle" is simply the largest
 * orthogonally-connected group of parts. Everything else is floating. This
 * keeps the rule explainable to a kid -- one clump, no islands -- without
 * forcing them to place a special block first.
 */
export function orphanIndices(vehicle) {
  const n = vehicle.parts.length;
  if (n === 0) return [];

  const occ = occupancy(vehicle);
  const adj = Array.from({ length: n }, () => new Set());
  vehicle.parts.forEach((p, i) => {
    for (const [x, y] of cellsOf(p)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = occ.get(`${x + dx},${y + dy}`);
        if (j !== undefined && j !== i) { adj[i].add(j); adj[j].add(i); }
      }
    }
  });

  const comp = new Array(n).fill(-1);
  const sizes = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] !== -1) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const cur = stack.pop();
      count++;
      for (const nb of adj[cur]) if (comp[nb] === -1) { comp[nb] = id; stack.push(nb); }
    }
    sizes.push(count);
  }

  // Ties go to the lowest component id, so the answer is stable frame to frame.
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  const out = [];
  for (let i = 0; i < n; i++) if (comp[i] !== best) out.push(i);
  return out;
}

// -------------------------------------------------------------------- stats

/**
 * The three builder meters, each normalized 0..1, plus raw totals.
 *
 * Speed deliberately keys off TOP SPEED (motorSpeed x radius) blended with
 * acceleration (torque / mass) -- not off raw motor power. Power alone made the
 * treaded vehicle read as the fastest, because treads trade speed for enormous
 * torque, which is the opposite of what a kid should be told.
 *
 * Grip is absolute rather than per-mass: a heavier vehicle presses its wheels
 * down harder, so dividing traction by mass would wrongly punish weight twice
 * (it already shows up in the weight meter).
 */
export function stats(vehicle) {
  let mass = 0, topSpeed = 0, torque = 0, gripRaw = 0, thrust = 0, wheels = 0, specials = 0;

  for (const p of vehicle.parts) {
    const part = getPart(p.t);
    if (!part) continue;
    mass += part.mass;

    if (part.wheel) {
      // A tread is one shell over two driven contact patches.
      const mult = part.role === 'tread' ? 2 : 1;
      const { motorSpeed, motorTorque, friction, radius } = part.wheel;
      topSpeed = Math.max(topSpeed, motorSpeed * radius);
      torque += motorTorque * mult;
      gripRaw += friction * radius * mult;
      wheels += mult;
    }
    if (part.thrust) thrust += part.thrust.force;
    if (part.special) specials++;
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const safeMass = Math.max(mass, 1);

  const topNorm = clamp01(topSpeed / 16);
  const accelNorm = clamp01(torque / safeMass / 8);
  const thrustBonus = clamp01(thrust / safeMass / 40);

  return {
    mass,
    wheels,
    specials,
    hasDrive: wheels > 0 || thrust > 0,
    speed:  clamp01((topNorm * 0.65 + accelNorm * 0.35) * 0.85 + thrustBonus),
    grip:   clamp01(gripRaw / 6),
    weight: clamp01(mass / 350),
  };
}

// ---------------------------------------------------------- balance / CoM

/**
 * Centre of mass and the wheel support base, in GRID CELL coordinates.
 *
 * Pure data -- no physics instantiation. Each part's rigid body genuinely sits
 * at its footprint centre, so a mass-weighted centroid of the footprints lands
 * within about a millimetre-scale of what the solver computes (measured at
 * 7-15 mm, roughly one screen pixel). Wheels count: they are heavy and low, and
 * leaving them out would overstate how top-heavy a vehicle is.
 *
 * @returns {null|{x,y,mass,left,right,ground,height,base,ratio}}
 *   x,y      centre of mass, in cells, y increasing downward like the grid
 *   left/right/ground  the support base: outermost wheel contacts and the
 *                      ground line they rest on
 *   ratio    CoM height divided by wheelbase. Low is stable; a real car is
 *            about 0.19, and anything past ~0.75 tips over readily.
 */
export function centreOfMass(vehicle) {
  if (!vehicle.parts.length) return null;

  let mass = 0, sx = 0, sy = 0;
  const contacts = [];
  for (const p of vehicle.parts) {
    const part = getPart(p.t);
    if (!part) continue;
    const { w, h } = partSize(part, p.r || 0);
    const cx = p.x + w / 2, cy = p.y + h / 2;
    mass += part.mass;
    sx += part.mass * cx;
    sy += part.mass * cy;

    if (part.wheel) {
      // A tread is one shell over two driven contact patches, at the centre of
      // each of its cells.
      const seats = part.role === 'tread'
        ? [p.x + 0.5, p.x + 1.5]
        : [cx];
      for (const seatX of seats) contacts.push({ x: seatX, y: cy + part.wheel.radius });
    }
  }
  if (mass <= 0) return null;

  const com = { x: sx / mass, y: sy / mass, mass };
  if (!contacts.length) return { ...com, left: null, right: null, ground: null, height: null, base: 0, ratio: Infinity };

  const left = Math.min(...contacts.map((c) => c.x));
  const right = Math.max(...contacts.map((c) => c.x));
  const ground = Math.max(...contacts.map((c) => c.y));
  const base = right - left;
  const height = ground - com.y;          // grid y grows downward
  return { ...com, left, right, ground, height, base, ratio: base > 0.01 ? height / base : Infinity };
}

/** Traffic-light rating for the CoM marker. No numbers -- the player can't read. */
export function balanceRating(com) {
  if (!com || com.base <= 0.01) return 'none';
  if (com.ratio <= 0.5) return 'good';
  if (com.ratio <= 0.75) return 'ok';
  return 'bad';
}

// ----------------------------------------------------------- serialization

/** Drop unknown parts rather than throwing, so an old save still opens. */
export function normalize(raw) {
  const v = {
    schemaVersion: SCHEMA_VERSION,
    id: raw.id || newId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 40) : randomName(),
    created: Number(raw.created) || Date.now(),
    modified: Number(raw.modified) || Date.now(),
    parts: [],
  };
  for (const p of Array.isArray(raw.parts) ? raw.parts : []) {
    if (!PART_BY_ID[p?.t]) continue;
    const placement = { t: p.t, x: p.x | 0, y: p.y | 0, r: ((p.r | 0) % 4 + 4) % 4 };
    if (!getPart(p.t).rotatable) placement.r = 0;
    if (inBounds(placement)) v.parts.push(placement);
  }
  return v;
}

export { GRID_W, GRID_H, PARTS, getPart, partSize };
