// Track terrain.
//
// Both racers run identical copies of the track in separate worlds, so every
// track must be perfectly reproducible -- hence a seeded PRNG rather than
// Math.random anywhere in here.

import { setFixtureMass } from './build.js';

const SAMPLE = 0.25;       // metres between terrain samples
const START_FLAT = 7;      // flat run-up so nobody spawns on a slope
const LEAD_IN = -12;

/** mulberry32: small, fast, and good enough for terrain. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ground materials.
 *
 * `grip` scales how much traction a driven wheel gets; `roll` is rolling
 * resistance. Both act on WHEELS ONLY, which is what makes the parts feel
 * different: a jet pushes on the chassis and does not care what it is standing
 * on, and a tread starts from friction 2.4 against a small wheel's 1.1, so ice
 * hurts it far less. Ice therefore rewards jets, mud rewards treads, and
 * tarmac rewards plain fast wheels.
 */
export const SURFACES = {
  dirt:   { id: 'dirt',   grip: 1.00, roll: 0.00, fill: '#2b3a2c', cap: '#46b04a' },
  tarmac: { id: 'tarmac', grip: 1.30, roll: 0.00, fill: '#23262e', cap: '#7b8494' },
  ice:    { id: 'ice',    grip: 0.07, roll: 0.00, fill: '#26414f', cap: '#a8e4ff' },
  mud:    { id: 'mud',    grip: 0.72, roll: 0.60, fill: '#33291d', cap: '#7a5c34' },
  sand:   { id: 'sand',   grip: 0.62, roll: 0.26, fill: '#4a4028', cap: '#d9c07a' },
  // Test-rig only: a rubber mat, so the Tilt Test measures BALANCE and not
  // friction. grip scales the wheel and the ground, so 2.2 puts the effective
  // coefficient around 2.2 -- a vehicle would have to reach 66 degrees before
  // it slid, which is past the 60-degree cap. Never put this on a race track.
  griptest: { id: 'griptest', grip: 2.20, roll: 0.00, fill: '#241f2b', cap: '#6b5a7a' },
};

/** Material under a given point. Tracks list only their exceptions. */
export function surfaceAt(track, x) {
  for (const band of track.surfaces || []) {
    if (x >= band[0] && x < band[1]) return SURFACES[band[2]] || SURFACES.dirt;
  }
  return SURFACES.dirt;
}

/**
 * Local uphill angle of the terrain at x, in radians.
 *
 * Finite difference rather than an analytic derivative, so it works for any
 * height() a track cares to define. Positive means climbing.
 */
export function slopeAt(track, x, h = 0.2) {
  return Math.atan2(track.height(x + h) - track.height(x - h), 2 * h);
}

const WIND_EDGE = 4;        // metres of ramp at each end of a zone

/**
 * Wind strength at x, 0 outside every zone.
 *
 * The gust is a function of POSITION, not time. A time-based gust would mean
 * one racer arriving in a lull and the other in a peak -- genuine unfairness,
 * experienced by a child as "he got lucky wind" and impossible to argue with. A
 * standing wave gives both racers the identical profile, still feels gusty
 * because they are moving through it, needs no clock at all, and lets the
 * renderer draw its streaks from the same function that supplies the force.
 *
 * @returns {null|{s:number, dir:number}}
 */
export function windAt(track, x) {
  for (const f of track.features || []) {
    if (f.kind !== 'wind') continue;
    const x0 = f.x, x1 = f.x + f.length;
    if (x < x0 || x > x1) continue;
    const ramp = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
    const edge = Math.min(ramp((x - x0) / WIND_EDGE), ramp((x1 - x) / WIND_EDGE));
    const g = f.gust ?? 0;
    const s = (f.strength ?? 1) * edge * (1 - g + g * Math.sin(x * 0.9));
    if (s > 0) return { s, dir: f.dir ?? -1 };
  }
  return null;
}

/** Fade terrain in over the first few metres so the start is always flat. */
const easeIn = (x) => {
  if (x <= START_FLAT) return 0;
  const t = Math.min(1, (x - START_FLAT) / 10);
  return t * t * (3 - 2 * t);
};

/**
 * A climbable step: short ramp up, a plateau, then back down.
 *
 * These were vertical walls, which made every vehicle fail at exactly the same
 * metre mark -- that is not an obstacle testing a build, it is a full stop.
 * Ramping them means grip and wheel size decide who gets over.
 */
function ledge(x, at, h, ramp) {
  const plateau = 3;
  const end = at + ramp * 2 + plateau;
  if (x <= at || x >= end) return 0;
  if (x < at + ramp) return h * (x - at) / ramp;
  if (x < at + ramp + plateau) return h;
  return h * (1 - (x - at - ramp - plateau) / ramp);
}

/**
 * A bowl with a flat floor and climbable walls, for a pond to sit in.
 *
 * The wall length is not cosmetic. A vehicle that sinks has to be able to drive
 * out again, so the steepest part of the ramp is kept near 20 degrees: for a
 * cosine wall that means `wall` of roughly 4.3x the depth. Skimping here turns
 * "you sank, that cost you time" into "you sank, you are finished".
 */
function basin(x, at, len, depth, wall = 8) {
  const end = at + len;
  if (x <= at || x >= end) return 0;
  const t = x < at + wall ? (x - at) / wall
    : x > end - wall ? (end - x) / wall
      : 1;
  const u = Math.max(0, Math.min(1, t));
  return -depth * 0.5 * (1 - Math.cos(Math.PI * u));
}

/**
 * Water surface at x, or null.
 *
 * Water is a FEATURE, not a SURFACES entry: a surface band is [x0, x1, id] with
 * no vertical extent at all, and there is nowhere in it to put a waterline.
 * Deriving the level from the terrain instead would give water that follows the
 * hills, which is nonsense.
 *
 * It builds no fixtures of any kind -- pure data -- so a vehicle arriving at
 * 12 m/s meets progressive drag rather than a collision impulse.
 */
export function waterAt(track, x) {
  for (const f of track.features || []) {
    if (f.kind !== 'water') continue;
    if (x < f.x || x > f.x + f.length) continue;
    return { level: f.level, x0: f.x, x1: f.x + f.length };
  }
  return null;
}

/**
 * Flatten the terrain across a span, easing back to normal either side.
 *
 * Multiplied into height(). A seesaw needs level ground under it -- a plank
 * that swings 9 degrees sitting on a hillside is unpredictable, and which way
 * it starts would depend on the slope rather than on the design.
 */
function flatten(x, spans, blend = 3) {
  let k = 1;
  for (const [a, b] of spans) {
    if (x <= a - blend || x >= b + blend) continue;
    const t = x < a ? (a - x) / blend : x > b ? (x - b) / blend : 0;
    const u = Math.max(0, Math.min(1, t));
    k = Math.min(k, u * u * (3 - 2 * u));
  }
  return k;
}

/**
 * One jump feature: an approach ramp, a steep kicker, then a V-valley.
 *
 * The kicker is the part that matters. A single smooth ramp just let vehicles
 * drive down into the valley and out the other side -- perfectly safe, but not
 * a jump. A short steep lip at the end throws them into the air instead, while
 * the valley floor still catches anyone too slow to clear it.
 */
function gapFeature(x, g) {
  const d = x - g;
  if (d <= -9 || d >= 4) return 0;
  if (d < -4.5) return 1.05 * (d + 9) / 4.5;             // gentle approach
  if (d < -3)   return 1.05 + 0.65 * (d + 4.5) / 1.5;    // kicker, ~24 deg
  if (d < 0)    return 1.7 + (-1.2 - 1.7) * (d + 3) / 3; // valley face
  return -1.2 * (1 - d / 4);                             // climb out
}

export const TRACKS = [
  {
    id: 'hills',
    name: 'Rolling Hills',
    blurb: 'Gentle. Good for a first race.',
    showcase: 46, cardZoom: 0.30,
    seed: 1337,
    length: 150,
    height: (x) => easeIn(x) * (
      1.30 * Math.sin(x * 0.085) +
      0.55 * Math.sin(x * 0.21 + 1.3) +
      0.22 * Math.sin(x * 0.44 + 0.4)),
    holes: [],
    props: () => [],
  },

  {
    id: 'boulders',
    name: 'Boulder Pass',
    blurb: 'Rocks and crates in the way. Bring a plow.',
    showcase: 63, cardZoom: 0.50,
    seed: 4242,
    length: 170,
    height: (x) => easeIn(x) * (
      0.85 * Math.sin(x * 0.06) +
      0.40 * Math.sin(x * 0.19 + 2.1)) +
      // Hard ledges: the thing a plow and big wheels actually solve.
      // Progressively steeper: gentle, then awkward, then only a grippy or
      // big-wheeled build gets over cleanly.
      ledge(x, 40, 0.35, 1.3) +
      ledge(x, 78, 0.40, 1.4) +
      ledge(x, 120, 0.62, 1.4),
    holes: [],
    props: (r, height) => {
      // Only on the flat stretches. Dropping a boulder onto a ledge stacks two
      // obstacles into one wall, which is what was ending runs outright.
      const zones = [[26, 37], [49, 75], [87, 117], [129, 160]];
      const out = [];
      for (const [a, b] of zones) {
        const n = Math.floor((b - a) / 9);
        for (let i = 0; i < n; i++) {
          const x = a + 4 + i * 9 + r() * 2.5;
          if (x > b) continue;
          if (r() < 0.55) out.push({ kind: 'boulder', x, y: height(x) + 0.9, radius: 0.22 + r() * 0.14 });
          else out.push({ kind: 'crate', x, y: height(x) + 0.9, size: 0.18 + r() * 0.12 });
        }
      }
      return out;
    },
  },

  {
    id: 'gap',
    name: 'The Gap',
    blurb: 'Big jumps. Carry your speed.',
    showcase: 48, cardZoom: 0.24,
    seed: 909,
    length: 165,
    // Valleys with a floor, not bottomless pits. A fast vehicle launches off
    // the lip and flies the whole thing; a slow one trundles down and climbs
    // out the far side. Either way the race finishes, which is the point --
    // falling in a hole is a fail state and this game does not have those.
    height: (x) => {
      let h = easeIn(x) * 0.45 * Math.sin(x * 0.07);
      for (const g of [48, 96, 138]) h += gapFeature(x, g);
      return h;
    },
    holes: [],
    props: () => [],
    features: [],
  },

  {
    id: 'slick',
    name: 'Slick Pass',
    blurb: 'Ice and tarmac. Wheels spin — jets and treads do not.',
    seed: 5150,
    length: 160,
    showcase: 54, cardZoom: 0.32,
    // Ice is the clearest demonstration that the drive parts are different:
    // a jet is unaffected because it pushes on the chassis, not the ground.
    // The ice deliberately covers the climbs. On flat ground traction barely
    // matters -- a wheel only needs enough grip to beat air drag -- so ice laid
    // on the flat is scenery. On a gradient it decides who gets up.
    surfaces: [[26, 54, 'ice'], [54, 72, 'tarmac'], [84, 116, 'ice'], [116, 138, 'tarmac']],
    // The ice runs are kept FLAT and the steps sit on the grippy sections.
    // A step inside an ice field punishes jets as much as wheels -- horizontal
    // thrust cannot climb a wall -- which collapses the very difference the
    // track exists to show. Flat ice is where thrust wins and wheels spin.
    height: (x) => easeIn(x) * (1.10 * Math.sin(x * 0.095) + 0.40 * Math.sin(x * 0.23 + 1.1))
      + ledge(x, 60, 0.55, 0.9) + ledge(x, 124, 0.60, 0.8),
    holes: [],
    props: () => [],
    features: [],
  },

  {
    id: 'rockslide',
    name: 'Rockslide',
    blurb: 'Piles of rock to shove through. A plow earns its place.',
    seed: 8080,
    length: 165,
    showcase: 80, cardZoom: 0.62,
    surfaces: [[96, 124, 'sand']],
    height: (x) => easeIn(x) * (0.85 * Math.sin(x * 0.065) + 0.35 * Math.sin(x * 0.22)),
    holes: [],
    props: () => [],
    features: [
      { kind: 'rocks', x: 44,  rows: 3, perRow: 6, width: 2.8, radius: 0.23 },
      { kind: 'rocks', x: 80,  rows: 3, perRow: 6, width: 3.0, radius: 0.24 },
      { kind: 'rocks', x: 124, rows: 2, perRow: 7, width: 3.2, radius: 0.23 },
    ],
  },

  {
    id: 'lowroad',
    name: 'Low Road',
    blurb: 'Beams overhead. Build it tall and you will pay for it.',
    seed: 3131,
    length: 158,
    showcase: 52, cardZoom: 0.34,
    surfaces: [[74, 104, 'mud']],
    height: (x) => easeIn(x) * (0.55 * Math.sin(x * 0.07) + 0.25 * Math.sin(x * 0.19 + 0.6)),
    holes: [],
    props: () => [],
    features: [
      // Starters are 1.50m (hopper, plodder) and 2.00m (spike) tall. The first
      // arch waves everything sensible through; the second is a genuine
      // constraint that only a low build clears.
      { kind: 'tunnel', x: 46,  length: 14, clearance: 2.30, spacing: 1.7 },
      { kind: 'tunnel', x: 112, length: 18, clearance: 1.80, spacing: 1.7 },
    ],
  },

  {
    id: 'oldbridge',
    name: 'Old Bridge',
    blurb: 'The planks hold light vehicles. Heavy ones go for a swim.',
    seed: 6262,
    length: 162,
    showcase: 52, cardZoom: 0.26,
    surfaces: [[120, 150, 'tarmac']],
    // Shallow gullies under each bridge: a collapse costs time, never the race.
    height: (x) => {
      let h = easeIn(x) * 0.45 * Math.sin(x * 0.08);
      for (const g of [52, 96]) {
        const d = x - g;
        if (d > -9 && d < 9) h -= 2.1 * Math.cos((d / 9) * Math.PI / 2) ** 2;
      }
      return h;
    },
    holes: [],
    props: () => [],
    features: [
      { kind: 'bridge', x: 45, length: 14, planks: 7, limit: 150 },
      { kind: 'bridge', x: 89, length: 14, planks: 7, limit: 110 },
      // The blurb has always promised a swim and the gully has always been dry.
      // Costs no new balance work: the plank limit already decides who gets wet,
      // and the bowl was already there.
      { kind: 'water', x: 90, length: 12, level: -0.75 },
    ],
  },

  {
    id: 'windy',
    name: 'Windy Ridge',
    blurb: 'A headwind. Tall vehicles get pushed about.',
    showcase: 112, cardZoom: 0.28,
    seed: 7373,
    length: 170,
    // Tarmac under both zones so GRIP is not a confounder: this track has one
    // job, which is to isolate how much air a vehicle pushes.
    surfaces: [[36, 76, 'tarmac'], [92, 148, 'tarmac']],
    height: (x) => easeIn(x) * (
      0.95 * Math.sin(x * 0.055) +
      0.38 * Math.sin(x * 0.17 + 1.9)),
    holes: [],
    props: () => [],
    features: [
      // A gentle one first, so the effect is met before it decides anything.
      { kind: 'wind', x: 46, length: 24, strength: 0.75, dir: -1, gust: 0.22 },
      { kind: 'wind', x: 100, length: 40, strength: 1.10, dir: -1, gust: 0.28 },
    ],
  },

  {
    id: 'seesaw',
    name: 'Tipping Point',
    blurb: 'Planks on pivots. Heavy ones tip them early.',
    showcase: 88, cardZoom: 0.34,
    seed: 5115,
    length: 155,
    // Level pads under each plank, because a seesaw on a slope is a coin toss.
    height: (x) => easeIn(x) * flatten(x, [[42, 55], [82, 95], [120, 133]]) * (
      0.80 * Math.sin(x * 0.062) +
      0.34 * Math.sin(x * 0.2 + 0.7)),
    holes: [],
    props: () => [],
    // Three planks of the same shape and increasing weight.
    //
    // The obvious design -- one plank, and a restoring torque that decides HOW
    // FAR PAST THE PIVOT you must be -- does not survive contact with a moving
    // vehicle. Spike crosses a 2m arm in under a third of a second, and no
    // plank with believable inertia rotates far in that time, so what got
    // measured was speed, not weight: Plodder tipped every plank and the two
    // faster starters skimmed over untouched.
    //
    // A long arm and a small offset fixes it, because then dwell time is long
    // enough for weight to be what decides. What varies now is HOW FAR it goes
    // over, which is just as visible side by side and is still force times
    // distance. Measured peak swing:
    //
    //            50kg    65kg    85kg
    //   Plodder   8.8     8.8     8.9
    //   Spike     8.9     8.6     8.7
    //   Hopper    8.0     5.1     3.0
    //
    // so the light starter progressively runs out of authority while the heavy
    // ones sail through, and nothing ever gets stuck.
    features: [
      { kind: 'seesaw', x: 48, length: 7, mass: 50, offset: 0.30, friction: 20, limit: 0.26 },
      { kind: 'seesaw', x: 88, length: 7, mass: 65, offset: 0.30, friction: 20, limit: 0.26 },
      { kind: 'seesaw', x: 126, length: 7, mass: 85, offset: 0.30, friction: 20, limit: 0.26 },
    ],
  },

  {
    id: 'pond',
    name: 'Pond Hop',
    blurb: 'Light things float. Heavy ones go to the bottom.',
    showcase: 66, cardZoom: 0.30,
    seed: 4949,
    length: 168,
    // Sand banks: it reads as a beach, and its rolling resistance is right for
    // a wet edge. The pools are shallow enough that the walls stay drivable.
    surfaces: [[50, 92, 'sand'], [100, 148, 'sand']],
    height: (x) => easeIn(x) * (
      0.70 * Math.sin(x * 0.05) + 0.30 * Math.sin(x * 0.19 + 1.1))
      // Deep enough to actually float a tall vehicle. At 1.2m of water Spike
      // sank despite being well under the water's density: it simply could not
      // get enough of itself under the surface, because a vehicle a metre and a
      // half tall needs about two metres of draft before the sums work. A pond
      // that shallow measures ride height, not density.
      + basin(x, 54, 36, 2.7, 11)
      + basin(x, 104, 42, 3.0, 13),
    holes: [],
    props: () => [],
    // Short pool first, so a floater gets a quick win before the long one makes
    // a sinker really pay for the ballast.
    features: [
      { kind: 'water', x: 60, length: 24, level: -0.45 },
      { kind: 'water', x: 112, length: 26, level: -0.55 },
    ],
  },
];

// Searches the test rigs too. Falling back to Rolling Hills for an unknown id
// keeps a bad share link from crashing, but it must not swallow a real track:
// before ALL_TRACKS existed, getTrack('tilt-test') silently returned a race.
export const getTrack = (id) => ALL_TRACKS.find((t) => t.id === id) || TRACKS[0];

// ---------------------------------------------------------------- test rigs
//
// Tracks with a `mode`, driven by a scripted controller in testmodes.js rather
// than by "drive right until the finish line". They are not races and are
// picked from their own section of the home screen.

/** Ice first so the easiest lesson lands first, tarmac last. */
const SLOPE_SURFACES = ['ice', 'sand', 'mud', 'dirt', 'tarmac'];
// A proper run-up, identical for every stage and every vehicle.
//
// Starting from a standstill at the foot sounds purer and is worse: on ice a
// vehicle cannot get going at all and every build scores near zero, so the
// surface that should teach the most teaches nothing. With a run-up the
// question becomes "how steep a hill can you charge up", which still needs
// both grip and power and separates the builds cleanly.
const SLOPE_APRON = 9;
const SLOPE_RAMP = 14;                      // ramp length: 0 deg to SLOPE_TOP
// 75 degrees, not 60. A vehicle carries momentum from the run-up and can crest
// a ramp several degrees steeper than it could hold: Hopper climbed clean over
// a 60-degree peak, ran out the far side and scored zero because it finished on
// the flat. Nothing gets over 75, so the ramp always wins in the end.
const SLOPE_TOP = 75 * Math.PI / 180;
const SLOPE_TAIL = 6;
const SLOPE_STAGE = SLOPE_APRON + SLOPE_RAMP * 2 + SLOPE_TAIL;

/**
 * Height of a ramp whose ANGLE grows linearly from 0 to SLOPE_TOP.
 *
 * Integrating tan gives -ln(cos)/k, which is what makes the steepening smooth:
 * a vehicle meets every angle on the way up and stops at the first one it
 * cannot hold, instead of hitting one fixed gradient and either making it or
 * not.
 */
const rampRise = (s) => {
  const k = SLOPE_TOP / SLOPE_RAMP;
  return -Math.log(Math.cos(k * Math.max(0, Math.min(SLOPE_RAMP, s)))) / k;
};

function slopeHeight(x) {
  if (x <= 0) return 0;
  const stage = Math.floor(x / SLOPE_STAGE);
  if (stage >= SLOPE_SURFACES.length) return 0;
  const s = x - stage * SLOPE_STAGE - SLOPE_APRON;
  if (s <= 0) return 0;                                   // apron
  if (s <= SLOPE_RAMP) return rampRise(s);                // the climb
  if (s <= SLOPE_RAMP * 2) return rampRise(SLOPE_RAMP * 2 - s);   // mirrored descent
  return 0;                                               // tail
}

export const TESTS = [
  {
    id: 'tilt-test',
    name: 'Tilt Test',
    blurb: 'The ground leans over. Who falls first?',
    mode: 'tilt',
    seed: 101,
    length: 26,
    spawnX: 8,
    showcase: 8, cardZoom: 0.30, cardRoll: -24 * Math.PI / 180, cardY: 0.1,
    // Dead flat. The world does not bend -- gravity turns instead, and the
    // camera leans to match, which is stabler than swinging the ground.
    height: () => 0,
    surfaces: [[-40, 80, 'griptest']],
    holes: [],
    props: () => [],
  },
  {
    id: 'slope-test',
    name: 'Slope Test',
    blurb: 'How steep a hill, on five different grounds?',
    mode: 'slope',
    seed: 202,
    length: SLOPE_STAGE * SLOPE_SURFACES.length,
    spawnX: 3,
    showcase: SLOPE_APRON + SLOPE_RAMP * 0.7, cardZoom: 0.30,
    height: slopeHeight,
    surfaces: SLOPE_SURFACES.map((id, i) =>
      [i * SLOPE_STAGE, (i + 1) * SLOPE_STAGE, id]),
    stages: SLOPE_SURFACES.map((surface, i) => ({
      surface,
      startX: i * SLOPE_STAGE + 3,
      startY: 0,
      rampX: i * SLOPE_STAGE + SLOPE_APRON,
    })),
    holes: [],
    props: () => [],
  },
];

export const ALL_TRACKS = [...TRACKS, ...TESTS];

const inHole = (track, x) => track.holes.some(([a, b]) => x > a && x < b);

/**
 * Build one copy of a track into a world.
 *
 * Terrain is emitted as separate chain segments so a hole is simply a missing
 * segment, and so each stretch can carry its own material friction.
 */
export function buildTrack(planck, world, track) {
  const { Vec2, Chain, Circle, Box, Edge, Polygon } = planck;
  const ground = world.createBody({ type: 'static' });

  // --- terrain, split on holes AND on any change of material ---------------
  const segments = [];
  let run = [];
  let runSurface = null;
  const flush = () => {
    if (run.length > 1) segments.push({ points: run, surface: runSurface });
    run = [];
  };
  for (let x = LEAD_IN; x <= track.length + 24; x += SAMPLE) {
    if (inHole(track, x)) { flush(); runSurface = null; continue; }
    const surf = surfaceAt(track, x);
    if (runSurface && surf.id !== runSurface.id) {
      const carry = run[run.length - 1];
      flush();
      run.push(carry);          // share the seam so there is no gap to catch on
    }
    runSurface = surf;
    run.push([x, track.height(x)]);
  }
  flush();

  for (const seg of segments) {
    ground.createFixture({
      shape: new Chain(seg.points.map(([x, y]) => new Vec2(x, y)), false),
      friction: 0.92 * (seg.surface?.grip ?? 1),
      density: 0,
    });
  }

  // Back stop so a vehicle cannot reverse out of the world.
  ground.createFixture({
    shape: new Edge(new Vec2(LEAD_IN, track.height(LEAD_IN) - 2),
                    new Vec2(LEAD_IN, track.height(LEAD_IN) + 12)),
    friction: 0.2,
  });

  // --- loose props ---------------------------------------------------------
  const props = [];
  const r = rng(track.seed);
  const addProp = (p) => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(p.x, p.y) });
    if (p.kind === 'boulder') {
      body.createFixture({ shape: new Circle(p.radius), density: p.density ?? 34, friction: 0.7, restitution: 0.1 });
    } else {
      body.createFixture({ shape: new Box(p.size, p.size), density: p.density ?? 28, friction: 0.6, restitution: 0.05 });
    }
    props.push({ body, ...p });
  };
  for (const p of track.props(r, track.height)) addProp(p);

  // --- features ------------------------------------------------------------
  const breakables = [];      // scripted-destructible: beams and planks
  const winds = [];           // wind zones and their markers, for the renderer
  const seesaws = [];         // dynamic planks on pivots
  const waters = [];          // ponds, for the renderer
  const ctx = { planck, world, track, ground, r, breakables, winds, seesaws, waters, addProp };

  for (const f of track.features || []) {
    const build = FEATURE_BUILDERS[f.kind];
    if (!build) { console.warn('unknown track feature', f.kind); continue; }
    build(ctx, f);
  }

  return { ground, segments, props, breakables, winds, seesaws, waters,
           length: track.length, track, world };
}

/**
 * Where a feature starts and ends, in metres.
 *
 * Needed because the descriptors are NOT consistent: `rocks` treats x as the
 * centre of its mound, while `tunnel` and `bridge` treat it as the left edge.
 * That is easy to trip over now that there are more kinds, so every consumer
 * asks here rather than assuming.
 */
export function featureSpan(f) {
  if (f.kind === 'rocks') {
    const half = (f.width ?? 3.2) / 2;
    return [f.x - half, f.x + half];
  }
  return [f.x, f.x + (f.length ?? 0)];
}

/**
 * One builder per feature kind.
 *
 * A registry rather than a chain of ifs: each kind gets an obvious home, and
 * an unrecognised kind warns and is skipped instead of silently doing nothing.
 */
const FEATURE_BUILDERS = {
  /**
   * A mound: wide at the base, tapering up. Individually shovable, but a wall
   * of them stops a blunt nose, which is what makes a plow worth its weight.
   */
  rocks(ctx, f) {
    const { track, r, addProp } = ctx;
    const rows = f.rows ?? 4;
    for (let row = 0; row < rows; row++) {
      const n = Math.max(1, (f.perRow ?? 7) - row * 2);
      for (let i = 0; i < n; i++) {
        const rad = (f.radius ?? 0.26) * (0.8 + r() * 0.45);
        const spread = (f.width ?? 3.2) * (1 - row / (rows + 1));
        const x = f.x + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread) + (r() - 0.5) * 0.18;
        addProp({ kind: 'boulder', x, y: track.height(f.x) + 0.35 + row * (rad * 1.9),
                  radius: rad, density: f.density ?? 15 });
      }
    }
  },

  /**
   * A run of low beams. Solid enough to be a real ceiling, but scripted to give
   * way to a vehicle that is too tall (see updateBreakables) so a bad build
   * loses a lot of time instead of being stuck forever.
   */
  tunnel(ctx, f) {
    const { planck, world, track, breakables } = ctx;
    const { Vec2, Box } = planck;
    const n = Math.max(1, Math.round(f.length / (f.spacing ?? 1.6)));
    for (let i = 0; i < n; i++) {
      const x = f.x + (i + 0.5) * (f.length / n);
      const y = track.height(x) + f.clearance;
      const body = world.createBody({ type: 'static', position: new Vec2(x, y + 0.28) });
      body.createFixture({ shape: new Box(0.42, 0.28), friction: 0.4, density: 0 });
      breakables.push({ kind: 'beam', body, x, bottom: y, half: 0.42, height: 0.28, gone: false, load: 0 });
    }
  },

  /**
   * Planks over a gully. They hold a light vehicle and give way under a heavy
   * one; the gully below is shallow, so a collapse costs time rather than
   * ending the race.
   */
  /**
   * Wind is invisible, which in a game this visual is a bug on its own. The
   * force lives in physics.js; this builds the evidence -- a row of windsocks
   * whose sag is read from the local strength, so a drooping sock at the edge
   * and a rigid one mid-zone tell the story with no motion at all.
   */
  wind(ctx, f) {
    const { track, winds } = ctx;
    // Data only -- no bodies. A windsock built as a real static post is a post
    // standing in the racing line, and every vehicle drove straight into one.
    // Nothing here is meant to be touched, so nothing here exists to be hit.
    const n = Math.max(2, Math.round(f.length / 11));
    for (let i = 0; i <= n; i++) {
      const x = f.x + (i / n) * f.length;
      winds.push({ kind: 'sock', x, base: track.height(x) });
    }
    winds.push({ kind: 'zone', x0: f.x, x1: f.x + f.length, dir: f.dir ?? -1 });
  },

  /**
   * A plank on a real pivot -- the first DYNAMIC joint in a track.
   *
   * Everything else breakable here is scripted, because "too heavy" and "too
   * tall" have to be predictable. The seesaw is the one place where emergent
   * beats scripted: "further out tips it further" is continuous and visible,
   * where a rule would be a cliff edge nobody can see coming.
   */
  /** Water is data. See waterAt(). */
  water(ctx, f) {
    const { track, waters } = ctx;
    let floor = Infinity;
    for (let x = f.x; x <= f.x + f.length; x += 0.5) floor = Math.min(floor, track.height(x));
    // Catch a mis-authored pool early: over flat ground this renders as a
    // mysterious blue band the vehicle drives straight through.
    if (floor > f.level - 0.2) {
      console.warn('water feature at', f.x, 'has no basin under it');
    }
    waters.push({ x0: f.x, x1: f.x + f.length, level: f.level, floor });
  },

  seesaw(ctx, f) {
    const { planck, world, track, winds } = ctx;
    const { Vec2, Polygon, RevoluteJoint } = planck;
    void winds;

    const half = (f.length ?? 5) / 2;
    const off = f.offset ?? 0.5;
    const px = f.x, py = track.height(f.x) + (f.pivotHeight ?? 0.42);

    // Fulcrum: a static wedge under the pivot.
    const fulcrum = world.createBody({ type: 'static', position: new Vec2(px, py) });
    fulcrum.createFixture({
      shape: new Polygon([new Vec2(-0.55, -(f.pivotHeight ?? 0.42)),
                          new Vec2(0.55, -(f.pivotHeight ?? 0.42)), new Vec2(0, 0.06)]),
      friction: 0.6, density: 0,
    });

    // The plank, tapered to a drivable lip. Same reasoning as the plow: a blunt
    // end is a step a small wheel cannot climb, and a knife edge catches on the
    // ground. The polygon is offset so the body ORIGIN is the pivot, which puts
    // the plank's mass `off` metres to the entry side and gives it a restoring
    // torque of mass * g * off -- without that offset a uniform plank pivoted at
    // its own centre has no restoring torque at any angle and simply stays
    // wherever the last vehicle left it.
    const T0 = 0.18, T1 = 0.03, lip = 0.5;
    const vx = (v) => v - off;
    const plank = world.createBody({
      type: 'dynamic', position: new Vec2(px, py), angularDamping: 0.4,
    });
    const fx = plank.createFixture({
      shape: new Polygon([
        new Vec2(vx(-half), -T1), new Vec2(vx(-half + lip), -T0),
        new Vec2(vx(half - lip), -T0), new Vec2(vx(half), -T1),
        new Vec2(vx(half), T1), new Vec2(vx(half - lip), T0),
        new Vec2(vx(-half + lip), T0), new Vec2(vx(-half), T1),
      ]),
      density: 1, friction: 0.85, restitution: 0.02,
    });
    setFixtureMass(planck, fx, f.mass ?? 120);
    plank.resetMassData();

    const lim = f.limit ?? 0.2;
    world.createJoint(new RevoluteJoint({
      // The limit must sit PAST the angle at which the plank end reaches the
      // ground, so the ground stops it, not the constraint. A 120kg plank and a
      // 200kg vehicle hitting a rigid joint stop at 3 m/s launches the rider.
      enableLimit: true, lowerAngle: -lim, upperAngle: lim,
      // Motor at zero speed is pivot friction: it bleeds the swing so the plank
      // does not flap after the vehicle leaves, and adds a small deadband.
      enableMotor: true, motorSpeed: 0, maxMotorTorque: f.friction ?? 90,
    }, plank, fulcrum, new Vec2(px, py)));

    ctx.seesaws.push({ body: plank, fulcrum, x: px, y: py, half, off,
                       t0: T0, t1: T1, lip, stand: f.pivotHeight ?? 0.42 });
  },

  bridge(ctx, f) {
    const { planck, world, track, breakables } = ctx;
    const { Vec2, Box } = planck;
    const n = f.planks ?? 6;
    const span = f.length / n;
    // The deck is derived from the ground at each abutment, not hand-typed. A
    // deck even half a metre proud of the terrain is a step that a small wheel
    // simply cannot climb, which strands light vehicles at the entrance -- the
    // exact opposite of the intended weight lesson.
    const y0 = track.height(f.x), y1 = track.height(f.x + f.length);
    for (let i = 0; i < n; i++) {
      const x = f.x + (i + 0.5) * span;
      const y = y0 + (y1 - y0) * ((i + 0.5) / n);
      const body = world.createBody({ type: 'static', position: new Vec2(x, y) });
      body.createFixture({ shape: new Box(span / 2, 0.16), friction: 0.9, density: 0 });
      breakables.push({ kind: 'plank', body, x, half: span / 2, top: y + 0.16,
                        limit: f.limit ?? 150, gone: false, load: 0 });
    }
  },
};

/**
 * Per-tick track logic.
 *
 * Split in two because they have different audiences. Breakables need a
 * vehicle to weigh or measure, but feature physics acts on the world whether
 * anyone is driving or not -- and the track thumbnails, which settle a world
 * with no racer in it at all, need the second half to run.
 */
export function updateTrack(build, dt, racer) {
  updateFeatures(build, dt);
  if (racer) updateBreakables(build, dt, racer);
}

/**
 * Feature physics that does not depend on a vehicle.
 *
 * Currently a no-op -- it exists so trackcard.js can settle a world correctly
 * before anything is added here that props need (buoyancy, for one).
 */
export function updateFeatures(build, dt) {
  void build; void dt;
}

/**
 * The scripted part of the breakable features.
 *
 * Deliberately scripted rather than emergent. "Too heavy" and "too tall" have
 * to be predictable enough for a child to learn them, and a purely
 * impulse-driven threshold is neither legible nor repeatable.
 */
export function updateBreakables(build, dt, racer) {
  if (!build.breakables.length || !racer) return;
  const chassis = racer.chassis;
  const pos = chassis.getPosition();
  const mass = chassis.getMass() + racer.wheels.reduce((a, w) => a + w.body.getMass(), 0);

  // Highest point of the hull, for the tunnel. Rotated by hand rather than via
  // getWorldPoint so this needs no planck handle.
  const a = chassis.getAngle(), ca = Math.cos(a), sa = Math.sin(a);
  let top = -Infinity;
  for (const hr of racer.hullRender) {
    const worldY = pos.y + hr.cx * sa + hr.cy * ca;
    top = Math.max(top, worldY + Math.max(hr.w, hr.h) / 2);
  }

  for (const b of build.breakables) {
    if (b.gone) continue;
    const near = Math.abs(pos.x - b.x) < b.half + 1.6;
    if (!near) { b.load = 0; continue; }

    const overloaded = b.kind === 'plank'
      ? mass > b.limit                     // too heavy for the deck
      : top > b.bottom + 0.04;             // too tall for the beam

    if (!overloaded) { b.load = 0; continue; }
    b.load += dt;
    if (b.load > (b.kind === 'plank' ? 0.30 : 0.45)) {
      build.world.destroyBody(b.body);
      b.gone = true;
      b.brokeAt = pos.x;
    }
  }
}

/** Ground height plus a little clearance, for spawning. */
export function spawnPoint(track, x = 2) {
  return { x, y: track.height(x) + 1.2 };
}
