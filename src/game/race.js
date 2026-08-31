// Head-to-head race over two INDEPENDENT worlds.
//
// Each racer gets its own planck world holding its own copy of the track. That
// guarantees fairness (neither can shove the other, and neither is perturbed by
// the other's debris), makes split screen trivial, and keeps a race repeatable.

import { createWorld, createRacer, updateRacer, fireAction } from './physics.js';
import { getTrack, buildTrack, spawnPoint, updateTrack } from './track.js';
import { createTestRun } from './testmodes.js';

export const COUNTDOWN = 3.2;
const CELEBRATE = 6;      // seconds the loser keeps driving after the winner lands

export function createRace(planck, { trackId, entries }) {
  const track = getTrack(trackId);
  // A test rig replaces "drive right until the finish line" with a scripted
  // controller. Everything else -- two worlds, the settle countdown, split
  // screen, the results overlay -- is shared, because comparing two vehicles
  // side by side is the point of a test just as much as of a race.
  const mode = track.mode || null;

  const lanes = entries.map((entry, index) => {
    const world = createWorld(planck);
    const build = buildTrack(planck, world, track);
    const racer = createRacer(planck, world, entry.vehicle, spawnPoint(track, track.spawnX ?? 3));
    racer.track = track;      // lets the wheels sample the ground material
    const lane = { index, entry, world, build, racer, finishTime: null, place: null };
    if (mode) lane.test = createTestRun(mode, track, lane);
    return lane;
  });

  return {
    track, lanes, mode,
    phase: 'countdown',       // countdown -> racing -> done
    countdown: COUNTDOWN,
    elapsed: 0,
    doneFor: 0,
    winner: null,
  };
}

export const laneProgress = (race, lane) =>
  lane.test
    ? Math.max(0, Math.min(1, lane.test.progress()))
    : Math.max(0, Math.min(1, lane.racer.chassis.getPosition().x / race.track.length));

/** Fire a lane's specials. Ignored before GO, so mashing early wastes nothing. */
export function laneAction(race, index) {
  if (race.phase === 'countdown') return false;
  const lane = race.lanes[index];
  if (!lane || lane.finishTime !== null) return false;
  return fireAction(lane.racer);
}

/** True while at least one special is off cooldown. */
export function actionReady(lane) {
  const s = lane.racer.specials;
  if (!s.length) return false;
  return s.some((x) => x.cooldownLeft <= 0);
}

export function actionCooldown(lane) {
  const s = lane.racer.specials;
  if (!s.length) return 1;
  const worst = Math.min(...s.map((x) => x.cooldownLeft / Math.max(x.cooldown, 0.001)));
  return Math.max(0, Math.min(1, worst));
}

/** Advance one fixed tick. Callers drive this from an accumulator. */
export function stepRace(race, dt) {
  if (race.phase === 'countdown') {
    race.countdown -= dt;
    // Still simulate, so vehicles settle onto the ground before GO rather than
    // dropping the instant the race starts.
    for (const lane of race.lanes) {
      // Tests settle with no assistance. Stall recovery triggers at 2.5s of no
      // forward progress and the countdown is 3.2s, so a vehicle standing
      // still on the start line gets a shove -- harmless in a race, but it
      // leaves a test rig rocking before the measurement even begins.
      updateRacer(lane.racer, dt, { throttle: 0, assist: race.mode ? 'off' : 'full' });
      updateTrack(lane.build, dt, lane.racer);
      lane.world.step(dt);
    }
    if (race.countdown <= 0) race.phase = 'racing';
    return;
  }

  if (race.phase !== 'done') race.elapsed += dt;

  if (race.mode) { stepTests(race, dt); return; }

  for (const lane of race.lanes) {
    const finished = lane.finishTime !== null;
    // Track forces (buoyancy, and anything else that pushes on a body) have to
    // land BEFORE the solver runs, or they are a frame stale. Destroying a
    // breakable is legal either way.
    updateRacer(lane.racer, dt, { throttle: finished ? 0 : 1 });
    updateTrack(lane.build, dt, lane.racer);
    lane.world.step(dt);

    if (!finished && lane.racer.chassis.getPosition().x >= race.track.length) {
      lane.finishTime = race.elapsed;
      lane.place = race.lanes.filter((l) => l.finishTime !== null).length;
      lane.racer.finished = true;
      if (!race.winner) {
        race.winner = lane;
        race.phase = 'done';
        race.doneFor = 0;
      }
    }
  }

  if (race.phase === 'done') {
    race.doneFor += dt;
    // Let the trailing vehicle finish for a while -- crossing the line is the
    // fun part even when you have lost.
    if (race.doneFor > CELEBRATE) {
      for (const lane of race.lanes) if (lane.finishTime === null) lane.racer.finished = true;
    }
  }
}

/**
 * Advance a test rig.
 *
 * Unlike a race there is no first-past-the-post: both vehicles run their whole
 * measurement and are ranked afterwards by score, so a slower vehicle that
 * scores better still wins.
 */
function stepTests(race, dt) {
  if (race.phase === 'done') { race.doneFor += dt; return; }

  for (const lane of race.lanes) {
    if (lane.finishTime !== null) continue;
    lane.test.step(dt);
    if (lane.test.done || race.elapsed > TEST_CAP) {
      lane.finishTime = race.elapsed;
      lane.racer.finished = true;
    }
  }

  if (race.lanes.every((l) => l.finishTime !== null) && race.phase !== 'done') {
    const ranked = [...race.lanes].sort((a, b) => b.test.score() - a.test.score());
    ranked.forEach((l, i) => { l.place = i + 1; });
    // A dead heat is a real outcome here (two identical vehicles), so only
    // call a winner when someone is actually ahead.
    const tie = ranked.length > 1 &&
      Math.abs(ranked[0].test.score() - ranked[1].test.score()) < 1e-6;
    race.winner = tie ? null : ranked[0];
    race.phase = 'done';
    race.doneFor = 0;
  }
}

/** Backstop so a pathological build cannot hang a test rig forever. */
const TEST_CAP = 150;

export const raceOver = (race) =>
  race.phase === 'done' &&
  (race.mode
    ? race.doneFor > TEST_LINGER
    : race.doneFor > CELEBRATE || race.lanes.every((l) => l.finishTime !== null));

/** A beat to look at the final tilt before the results cover it. */
const TEST_LINGER = 1.6;
