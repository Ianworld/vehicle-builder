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
  },
];

export const getTrack = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];

const inHole = (track, x) => track.holes.some(([a, b]) => x > a && x < b);

/**
 * Build one copy of a track into a world.
 * Terrain is emitted as separate chain segments so a hole is simply a missing
 * segment rather than a shape with a notch cut in it.
 */
export function buildTrack(planck, world, track) {
  const { Vec2, Chain, Circle, Box, Edge } = planck;
  const ground = world.createBody({ type: 'static' });

  const segments = [];
  let run = [];
  for (let x = LEAD_IN; x <= track.length + 24; x += SAMPLE) {
    if (inHole(track, x)) {
      if (run.length > 1) segments.push(run);
      run = [];
      continue;
    }
    run.push([x, track.height(x)]);
  }
  if (run.length > 1) segments.push(run);

  for (const seg of segments) {
    ground.createFixture({
      shape: new Chain(seg.map(([x, y]) => new Vec2(x, y)), false),
      friction: 0.92,
      density: 0,
    });
  }

  // Walls: a back stop so a vehicle cannot reverse out of the world, and a
  // catch far past the finish.
  ground.createFixture({
    shape: new Edge(new Vec2(LEAD_IN, track.height(LEAD_IN) - 2),
                    new Vec2(LEAD_IN, track.height(LEAD_IN) + 12)),
    friction: 0.2,
  });

  const props = [];
  const r = rng(track.seed);
  for (const p of track.props(r, track.height)) {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(p.x, p.y) });
    if (p.kind === 'boulder') {
      body.createFixture({ shape: new Circle(p.radius), density: 34, friction: 0.7, restitution: 0.1 });
    } else {
      body.createFixture({ shape: new Box(p.size, p.size), density: 28, friction: 0.6, restitution: 0.05 });
    }
    props.push({ body, ...p });
  }

  return { ground, segments, props, length: track.length, track };
}

/** Ground height plus a little clearance, for spawning. */
export function spawnPoint(track, x = 2) {
  return { x, y: track.height(x) + 1.2 };
}
