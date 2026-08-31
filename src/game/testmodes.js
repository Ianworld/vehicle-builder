// Scripted test tracks: measure a vehicle instead of racing it.
//
// Both run through the ordinary race machinery -- two independent worlds, the
// settle countdown, split screen, a results overlay -- because comparing two
// vehicles side by side IS the lesson. What changes is who drives and what
// counts as finishing, so each mode is a small controller that owns those.
//
// Recovery is off in both. It fires after 2.5s of no forward progress and
// shoves the vehicle along, which in a test that measures how steep a hill a
// vehicle can climb would mean the game pushing it up the hill.

import { updateRacer } from './physics.js';
import { SURFACES, slopeAt } from './track.js';

export const TILT_MAX = Math.PI / 3;        // 60 deg: past this it does not tip
const TILT_RATE = 9 * Math.PI / 180;        // deg/sec the world leans over
const TIPPED = 0.6;                         // rad of hull deviation = clearly over
const LIFT_HOLD = 0.08;                     // seconds of daylight that count
const ARM_ANGLE = 2 * Math.PI / 180;        // don't watch until it has settled
const FELL_OVER = 0.35;                     // already down before we started
const SETTLE_HOLD = 0.35;                   // beat before the lean starts

const STALL_TIME = 1.2;                     // no progress for this long = stuck
const STALL_EPS = 0.15;                     // metres that count as progress
const STAGE_CAP = 18;                       // seconds before a stage gives up

/** Is this body resting on anything? */
function touchingGround(body) {
  for (let ce = body.getContactList(); ce; ce = ce.next) {
    if (ce.contact && ce.contact.isTouching()) return true;
  }
  return false;
}

/** Freeze a vehicle exactly where it is, so a second attempt starts identical. */
function snapshot(racer) {
  const grab = (b) => ({ b, p: b.getPosition().clone(), a: b.getAngle() });
  return [grab(racer.chassis), ...racer.wheels.map((w) => grab(w.body))];
}

function restore(planck, snap) {
  const { Vec2 } = planck;
  for (const s of snap) {
    s.b.setTransform(new Vec2(s.p.x, s.p.y), s.a);
    s.b.setLinearVelocity(new Vec2(0, 0));
    s.b.setAngularVelocity(0);
    s.b.setAwake(true);
  }
}

/**
 * Put the vehicle in a test rig: brakes locked, and never allowed to sleep.
 *
 * The obvious approach -- chocking the wheels with little blocks -- is wrong,
 * and wrong in a way that looks right. A chock sits outboard of the tyre, so
 * the vehicle stops tipping over its CONTACT PATCH and starts tipping over the
 * chock: measured against a predicted 20 degrees, a test tower read 40. The
 * chocks were quietly acting as outriggers.
 *
 * So translation is stopped two other ways instead, neither of which adds a
 * support point: the track is a rubber mat (SURFACES.griptest) so it cannot
 * slide until well past the 60-degree cap, and the wheel motors are held at an
 * enormous torque so it cannot roll. Braking has to be re-applied every tick
 * because updateRacer rewrites maxMotorTorque from the part catalogue.
 *
 * Sleeping is disabled because a settled vehicle nods off in about half a
 * second, and a sleeping body does not notice that gravity has moved.
 */
const BRAKE_TORQUE = 1e7;

function rigUp(racer) {
  for (const b of [racer.chassis, ...racer.wheels.map((w) => w.body)]) {
    b.setSleepingAllowed(false);
    b.setAwake(true);
  }
}

function holdBrakes(racer) {
  for (const w of racer.wheels) {
    w.joint.setMotorSpeed(0);
    w.joint.setMaxMotorTorque(BRAKE_TORQUE);
  }
}

/**
 * Tilt Test: lean the world until the vehicle falls over.
 *
 * Rotating GRAVITY rather than the ground. Swinging a long static chain under a
 * body that is resting on it invites jitter and tunnelling, whereas turning the
 * gravity vector is exactly equivalent and completely stable. The camera leans
 * the other way (cam.roll) so the player sees a rising ramp.
 *
 * Both directions get tested. Plodder holds 60 degrees nose-up and gives up at
 * 44 nose-down because its ballast is at the back; measuring only one way would
 * call the least stable starter the most stable.
 */
function tiltRun(track, lane) {
  const racer = lane.racer;
  const { Vec2 } = racer.planck;
  const g = 10;

  let started = false, snap = null, settleAngle = 0;
  let phase = 0;                 // 0 = nose-up, 1 = nose-down
  let theta = 0, hold = 0, armed = false;
  let liftFrom = null, liftFor = 0;
  const dirOf = (ph) => (ph === 0 ? -1 : 1);   // which way "downhill" points
  const results = [null, null];

  const api = {
    kind: 'tilt',
    done: false,
    roll: () => dirOf(phase) * theta,
    hud: () => ({ angle: theta, best: bestSoFar(), phase, phases: 2 }),
    progress: () => (phase + Math.min(1, theta / TILT_MAX)) / 2,
    score: () => bestSoFar(),
    result: () => ({ kind: 'tilt', angle: bestSoFar(), back: results[0], front: results[1] }),
    step,
  };

  /**
   * True once the vehicle is balanced on its downhill-most contact alone.
   *
   * Not "the uphill wheel has lifted" -- that is only the same thing on a
   * two-wheeler. A tread is two contact patches half a metre apart, so Plodder
   * has four; its uphill-most one lifts while the vehicle is still sitting
   * comfortably on the other three, which read the tip 17 degrees early. What
   * actually defines the tipping point is that every contact except the pivot
   * has unloaded.
   */
  function onPivotAlone() {
    const ws = racer.wheels;
    if (!ws.length) return false;
    const down = dirOf(phase);
    let pivot = ws[0];
    for (const w of ws) {
      if (w.body.getPosition().x * down > pivot.body.getPosition().x * down) pivot = w;
    }
    for (const w of ws) if (w !== pivot && touchingGround(w.body)) return false;
    return true;
  }

  function bestSoFar() {
    const done = results.filter((v) => v !== null);
    return done.length ? Math.min(...done) : theta;
  }

  function step(dt) {
    if (api.done) return;

    if (!started) {
      started = true;
      rigUp(racer);
      settleAngle = racer.chassis.getAngle();
      snap = snapshot(racer);

      // Some builds fall over on the flat before the ground has moved at all.
      // Zero is the honest score for that, and saying so immediately beats
      // leaning a vehicle that is already lying on its side through two full
      // sweeps and calling it perfectly stable.
      if (Math.abs(normAngle(settleAngle)) > FELL_OVER) {
        results[0] = 0;
        results[1] = 0;
        api.done = true;
        return;
      }
    }

    // A beat at level before anything moves, so the start is legible.
    if (hold < SETTLE_HOLD) {
      hold += dt;
    } else {
      theta = Math.min(TILT_MAX, theta + TILT_RATE * dt);
    }

    const d = dirOf(phase);
    racer.world.setGravity(new Vec2(d * g * Math.sin(theta), -g * Math.cos(theta)));

    updateRacer(racer, dt, { throttle: 0, assist: 'off' });
    holdBrakes(racer);          // after updateRacer, which resets motor torque
    racer.world.step(dt);

    // The tipping point is the moment the vehicle is left standing on its
    // downhill contact alone -- the criterion a real tilt-table uses, and the
    // only one here that is not secretly measuring something else.
    //
    // Hull angle alone will not do it. A tall vehicle leans several degrees on
    // its own suspension long before it is going anywhere, so a small angle
    // threshold reads that lean as a tip (a test tower scored 9.6 against a
    // predicted 20). A large threshold is worse in the other direction: by the
    // time the hull has swung 34 degrees the world has kept leaning too, which
    // flattered every vehicle by 4-8 degrees. Lift-off has neither problem --
    // traced on that same tower it lands at 19.4 against the predicted 20.
    // Only start watching once it is properly settled and the world has
    // actually begun to lean. A wobbly build can still be bouncing during the
    // opening beat, and latching on that reported a tip angle of zero.
    if (!armed && theta > ARM_ANGLE && !onPivotAlone()) armed = true;

    if (armed && onPivotAlone()) {
      liftFor += dt;
      if (liftFrom === null) liftFrom = theta;
    } else {
      liftFrom = null;                  // it came back down; it never went
      liftFor = 0;
    }

    const dev = Math.abs(normAngle(racer.chassis.getAngle() - settleAngle));
    const lifted = liftFor > LIFT_HOLD;
    const tipped = dev > TIPPED;
    const capped = theta >= TILT_MAX - 1e-6;

    // Keep leaning past lift-off so the fall is actually seen, but report the
    // angle it let go at, not the angle it landed at.
    if (tipped || capped) {
      results[phase] = (lifted && liftFrom !== null) ? liftFrom : theta;
      if (phase === 1) {
        api.done = true;
        return;
      }
      // Second half: put it back exactly where it started and lean the
      // other way. Restoring the snapshot means both halves are the same
      // experiment, not "whatever state the first half left behind".
      phase = 1;
      theta = 0;
      hold = 0;
      armed = false;
      liftFrom = null;
      liftFor = 0;
      restore(racer.planck, snap);
      racer.world.setGravity(new Vec2(0, -g));
    }
  }

  return api;
}

const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Slope Test: how steep a hill it can climb, once per ground material.
 *
 * Deliberately NOT chocked -- here sliding is the thing being measured. What
 * comes out is min(traction limit, torque limit), and which of those bites
 * first is the lesson: on ice everyone is grip-limited and treads win, while a
 * heavy vehicle on a short gear runs out of torque and stops improving no
 * matter how much grip the ground offers.
 */
function slopeRun(track, lane) {
  const racer = lane.racer;
  const { Vec2 } = racer.planck;
  const stages = track.stages;

  let stage = 0, stageT = 0, bestX = -Infinity, stalled = 0;
  const angles = [];
  let placed = false;
  let pose = null;          // the settled pose, reused to start every stage

  const api = {
    kind: 'slope',
    done: false,
    roll: () => 0,
    hud: () => ({
      angle: liveAngle(), stage, stages: stages.length,
      surfaces: stages.map((s) => s.surface), got: angles.slice(),
    }),
    progress: () => (stage + Math.min(1, stageT / STAGE_CAP)) / stages.length,
    score: () => angles.reduce((a, b) => a + b, 0),
    result: () => ({
      kind: 'slope',
      bars: stages.map((s, i) => ({ surface: s.surface, angle: angles[i] ?? 0 })),
      total: angles.reduce((a, b) => a + b, 0),
    }),
    step,
  };

  const liveAngle = () =>
    Math.max(0, slopeAt(track, Math.max(bestX, racer.chassis.getPosition().x)));

  /**
   * Put the vehicle on the next stage's apron in the pose it settled in.
   *
   * Every stage replays the SAME starting pose, shifted sideways, rather than
   * whatever wreck the last ramp left behind -- otherwise a vehicle that slid
   * back down on its roof would start the next material already beaten, and
   * the five numbers would not be comparable with each other.
   *
   * The shift is horizontal only. A uniform translation leaves every
   * WheelJoint's constraint exactly as it was; re-rotating the assembly would
   * not, which is why the aprons are flat and all at the same height.
   */
  function moveToStage() {
    const dx = stages[stage].startX - pose.originX;
    for (const s of pose.bodies) {
      s.body.setTransform(new Vec2(s.x + dx, s.y), s.a);
      s.body.setLinearVelocity(new Vec2(0, 0));
      s.body.setAngularVelocity(0);
      s.body.setAwake(true);
    }
    racer.bestX = racer.chassis.getPosition().x;
    racer.stalledFor = 0;
    racer.invertedFor = 0;
    racer.recoverFor = 0;
    bestX = racer.chassis.getPosition().x;
    stalled = 0;
    stageT = 0;
  }

  function step(dt) {
    if (api.done) return;
    if (!placed) {
      placed = true;
      pose = {
        originX: racer.chassis.getPosition().x,
        bodies: [racer.chassis, ...racer.wheels.map((w) => w.body)].map((body) => ({
          body, x: body.getPosition().x, y: body.getPosition().y, a: body.getAngle(),
        })),
      };
      moveToStage();
    }

    updateRacer(racer, dt, { throttle: 1, assist: 'off' });
    racer.world.step(dt);

    stageT += dt;
    const x = racer.chassis.getPosition().x;
    if (x > bestX + STALL_EPS) { bestX = x; stalled = 0; } else stalled += dt;

    // The high-water mark, from a standing start at the foot of the ramp. This
    // is "how steep a hill can it climb", and it needs BOTH grip and torque --
    // which is the whole lesson, since different vehicles run out of different
    // ones. Letting it slide back and measuring where it settled was tried and
    // is worse: with the wheels still turning, anything on ice slides all the
    // way to the bottom and every vehicle scores zero.
    if (stalled > STALL_TIME || stageT > STAGE_CAP) {
      angles[stage] = Math.max(0, slopeAt(track, bestX));
      stage++;
      if (stage >= stages.length) { api.done = true; return; }
      moveToStage();
    }
  }

  return api;
}

const RUNS = { tilt: tiltRun, slope: slopeRun };

export function createTestRun(mode, track, lane) {
  const make = RUNS[mode];
  if (!make) throw new Error('unknown test mode: ' + mode);
  return make(track, lane);
}

export { SURFACES };
