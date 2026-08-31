// Track terrain.
//
// Both racers run identical copies of the track in separate worlds, so every
// track must be perfectly reproducible -- hence a seeded PRNG rather than
// Math.random anywhere in here.

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
};

/** Material under a given point. Tracks list only their exceptions. */
export function surfaceAt(track, x) {
  for (const band of track.surfaces || []) {
    if (x >= band[0] && x < band[1]) return SURFACES[band[2]] || SURFACES.dirt;
  }
  return SURFACES.dirt;
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
    ],
  },
];

export const getTrack = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];

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
  const ctx = { planck, world, track, ground, r, breakables, addProp };

  for (const f of track.features || []) {
    const build = FEATURE_BUILDERS[f.kind];
    if (!build) { console.warn('unknown track feature', f.kind); continue; }
    build(ctx, f);
  }

  return { ground, segments, props, breakables, length: track.length, track, world };
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
