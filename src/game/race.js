// Head-to-head race over two INDEPENDENT worlds.
//
// Each racer gets its own planck world holding its own copy of the track. That
// guarantees fairness (neither can shove the other, and neither is perturbed by
// the other's debris), makes split screen trivial, and keeps a race repeatable.

import { createWorld, createRacer, updateRacer, fireAction } from './physics.js';
import { getTrack, buildTrack, spawnPoint } from './track.js';

export const COUNTDOWN = 3.2;
const CELEBRATE = 6;      // seconds the loser keeps driving after the winner lands

export function createRace(planck, { trackId, entries }) {
  const track = getTrack(trackId);
  const lanes = entries.map((entry, index) => {
    const world = createWorld(planck);
    const build = buildTrack(planck, world, track);
    const racer = createRacer(planck, world, entry.vehicle, spawnPoint(track, 3));
    return { index, entry, world, build, racer, finishTime: null, place: null };
  });

  return {
    track, lanes,
    phase: 'countdown',       // countdown -> racing -> done
    countdown: COUNTDOWN,
    elapsed: 0,
    doneFor: 0,
    winner: null,
  };
}

export const laneProgress = (race, lane) =>
  Math.max(0, Math.min(1, lane.racer.chassis.getPosition().x / race.track.length));

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
      updateRacer(lane.racer, dt, { throttle: 0 });
      lane.world.step(dt);
    }
    if (race.countdown <= 0) race.phase = 'racing';
    return;
  }

  if (race.phase !== 'done') race.elapsed += dt;

  for (const lane of race.lanes) {
    const finished = lane.finishTime !== null;
    updateRacer(lane.racer, dt, { throttle: finished ? 0 : 1 });
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

export const raceOver = (race) =>
  race.phase === 'done' &&
  (race.doneFor > CELEBRATE || race.lanes.every((l) => l.finishTime !== null));
