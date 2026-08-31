// Runtime physics for one vehicle: drive, thrust, aero, specials, auto-right.

import { buildVehicle, M } from './build.js';
import { surfaceAt, windAt } from './track.js';

export const GRAVITY = -10;

/**
 * Air drag, per metre of vehicle height, quadratic in speed.
 *
 * Wheels are speed-limited by their motor, but a jet had nothing opposing it at
 * all -- no terminal velocity, so a jet sled simply accelerated until the track
 * ran out and beat every wheeled build on six of seven tracks. Scaling by
 * height also means a tall vehicle pushes more air, which quietly reinforces
 * the same "keep it low" lesson the centre-of-mass marker teaches.
 */
const DRAG_PER_METRE = 2.0;

/**
 * Wind, per metre of vehicle height.
 *
 * Has to be bigger than it looks, because a wheel motor is SPEED-controlled: it
 * simply applies more torque against a headwind and holds the same speed, right
 * up until the demand passes what the motor can give. At 90 a 3m tower lost
 * only 4% -- the wind was real, absorbed, and invisible. 170 puts that tower at
 * roughly 410N which, with about 250N of its own air drag, finally exceeds the
 * ~600N its wheels can deliver, so it genuinely slows. A low car pays about
 * 70N and never comes close, which is exactly the intended gap.
 */
const WIND_PER_METRE = 170;
const WIND_MAX_HEIGHT = 3.0;
const WIND_MAX_LEVER = 1.2;
/**
 * Wind may never exceed this share of what the wheels can actually push with.
 *
 * Without it wind becomes a wall. A tall light tower parked in the strong zone
 * took EIGHT recovery assists in 25 seconds and travelled 1.5 metres: stopped
 * dead, hopped, stopped again. The obvious alternative -- dropping the forward
 * half of the recovery impulse -- was tried and is far worse, because that
 * shove is what frees a vehicle wedged against a boulder: it cost Rockslide
 * Spike 69 metres and pushed total assists across the starters from 37 to 47.
 *
 * Capping the cause instead of blunting the cure keeps the promise the whole
 * game rests on. Below the cap the vehicle settles at a slower steady speed;
 * it never reaches zero, so the stall timer never fires.
 */
const WIND_MAX_SHARE = 0.8;

// The kid-friendly guarantee is "never stuck", which is a stronger promise than
// "never upside down". Vehicles were beaching nose-up at 80-90 degrees with
// their wheels spinning in the air -- nowhere near a flip, but just as stuck.
// So recovery watches PROGRESS, with a fast path for an obvious flip.
const FLIP_ANGLE = 1.95;          // ~112 deg: clearly on its back
const FLIP_GRACE = 0.6;           // inverted AND stopped -- help almost at once
const FLIP_GRACE_MOVING = 1.2;    // inverted but sliding along: still help
const STALL_GRACE = 2.5;          // seconds of no forward progress
const PROGRESS_EPS = 0.25;        // metres that count as "moved"
const RECOVER_TIMEOUT = 2.5;      // give up rather than fight terrain forever

export function createWorld(planck) {
  return new planck.World({ gravity: new planck.Vec2(0, GRAVITY) });
}

export function createRacer(planck, world, vehicle, spawn) {
  const built = buildVehicle(planck, world, vehicle, spawn);
  return {
    planck,
    world,
    vehicle,
    ...built,
    throttle: 0,
    boostFor: 0,
    gripFor: 0,
    hopFor: 0,
    track: null,        // set by the race so surfaces can be sampled
    surface: null,      // what the wheels are standing on right now
    invertedFor: 0,
    stalledFor: 0,
    recoverFor: 0,
    bestX: spawn.x,
    recoveries: 0,
    actionHeld: false,
    finished: false,
    finishTime: null,
    distance: 0,
  };
}

const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Rotational inertia about the CENTRE OF MASS.
 *
 * planck's getInertia() is measured about the body's local origin, which for a
 * vehicle is its bottom-centre anchor -- 2.5x to 3.1x the true value here, and
 * the factor varies with how tall the design is. Scaling control torque by that
 * made corrections silently stronger on top-heavy vehicles than on low ones.
 * The gains below are expressed as angular accelerations, so they need the real
 * inertia to mean the same thing on every vehicle.
 */
function inertiaAboutCoM(body) {
  const lc = body.getLocalCenter();
  const I = body.getInertia() - body.getMass() * (lc.x * lc.x + lc.y * lc.y);
  return I > 1e-6 ? I : 1;
}

/**
 * Opt-in force recorder for the science view.
 *
 * Off by default, so the cost when nobody is looking is one property check per
 * call site. Recording only reads and stores -- it never applies anything --
 * so turning it on cannot change the simulation, which is asserted in testing
 * by stepping the same race with it on and off and comparing final positions.
 */
export function enableProbe(racer, on = true) {
  racer.probe = on ? new Map() : null;
}

/**
 * Record one force, in newtons, at a world point.
 *
 * Keyed by a stable slot id rather than push order. Drag is gated on speed and
 * rolling resistance on the surface underneath, so the set of live forces
 * changes from tick to tick; with a plain array the indices would shift and the
 * smoothing below would blend one force into another.
 *
 * Smoothed here rather than in the renderer because the race runs up to six
 * fixed steps per drawn frame, and the renderer would only ever see the last.
 */
function probe(racer, key, kind, px, py, fx, fy) {
  const p = racer.probe;
  if (!p) return;
  let e = p.get(key);
  if (!e) p.set(key, (e = { kind, px: 0, py: 0, fx: 0, fy: 0, live: false }));
  e.px = px; e.py = py;
  e.fx += (fx - e.fx) * 0.35;
  e.fy += (fy - e.fy) * 0.35;
  e.live = true;
}

/**
 * Centre of mass of the WHOLE vehicle, in world metres.
 *
 * chassis.getWorldCenter() is the centre of mass of the chassis body alone and
 * leaves out the wheels, which are separate bodies -- with two big wheels that
 * is 32kg missing, enough that the weight arrow would visibly not line up with
 * the centre-of-mass dot the builder draws.
 */
export function vehicleCentreOfMass(racer) {
  let m = racer.chassis.getMass();
  const c = racer.chassis.getWorldCenter();
  let x = c.x * m, y = c.y * m;
  for (const w of racer.wheels) {
    const wm = w.body.getMass();
    const wc = w.body.getWorldCenter();
    m += wm; x += wc.x * wm; y += wc.y * wm;
  }
  return m > 0 ? { x: x / m, y: y / m, mass: m } : { x: c.x, y: c.y, mass: m };
}

/** Fire every special at once -- one button, one predictable rule. */
export function fireAction(racer) {
  const { Vec2 } = racer.planck;
  let fired = false;

  for (const s of racer.specials) {
    if (s.cooldownLeft > 0) continue;
    s.cooldownLeft = s.cooldown;
    fired = true;

    if (s.kind === 'boost') {
      racer.boostFor = Math.max(racer.boostFor, s.duration);
      s.burnFor = s.duration;
    } else if (s.kind === 'hop') {
      // The hop itself is a single impulse. Hold a short visual timer so the
      // flare is actually seen -- 0.25s of thrust is a frame or two on screen.
      racer.hopFor = Math.max(racer.hopFor, Math.max(s.duration, 0.45));
      // One instantaneous kick along the part's own push direction, biased a
      // little forward so a hop clears a lip rather than bouncing in place.
      const push = racer.chassis.getWorldVector(s.dir);
      const fwd = racer.chassis.getWorldVector(new Vec2(1, 0));
      const v = new Vec2(push.x + fwd.x * 0.25, push.y + fwd.y * 0.25);
      v.normalize();
      const k = s.impulse * 0.01 * racer.chassis.getMass();
      racer.chassis.applyLinearImpulse(new Vec2(v.x * k, v.y * k),
        racer.chassis.getWorldPoint(s.point), true);
    } else if (s.kind === 'grip') {
      racer.gripFor = Math.max(racer.gripFor, s.duration);
      racer.gripMultiplier = s.multiplier;
    }
  }
  return fired;
}

export function updateRacer(racer, dt, input = {}) {
  const { Vec2 } = racer.planck;
  const chassis = racer.chassis;
  const throttle = racer.finished ? 0 : (input.throttle ?? 1);
  racer.throttle = throttle;

  if (racer.probe) for (const e of racer.probe.values()) e.live = false;

  for (const s of racer.specials) s.cooldownLeft = Math.max(0, s.cooldownLeft - dt);
  racer.boostFor = Math.max(0, racer.boostFor - dt);
  racer.gripFor = Math.max(0, racer.gripFor - dt);
  racer.hopFor = Math.max(0, racer.hopFor - dt);

  // -- drive -----------------------------------------------------------
  // Negative motor speed spins a wheel clockwise, which drives +x.
  const boosting = racer.boostFor > 0;
  const vel0 = chassis.getLinearVelocity();

  for (const w of racer.wheels) {
    w.joint.setMotorSpeed(-w.maxSpeed * throttle * (boosting ? 1.35 : 1));
    w.joint.setMaxMotorTorque(w.part.wheel.motorTorque * (boosting ? 1.6 : 1));

    // Ground material acts on WHEELS ONLY. That is the whole point: a jet
    // pushes against the chassis and ignores what is underneath, while a tread
    // starts from so much more friction that ice barely troubles it.
    const surf = racer.track ? surfaceAt(racer.track, w.body.getPosition().x) : null;
    const surge = racer.gripFor > 0 ? (racer.gripMultiplier || 1) : 1;
    const grip = w.baseFriction * surge * (surf ? surf.grip : 1);
    if (Math.abs(w.fixture.getFriction() - grip) > 1e-4) w.fixture.setFriction(grip);

    if (racer.probe) {
      // Traction at the contact patch, derived from the motor rather than from
      // the contact solver: torque over radius is what the tyre puts into the
      // ground, capped at what the surface can actually hold. That cap IS the
      // ice lesson -- a wheel spinning on ice draws a short arrow.
      //
      // getMotorTorque reads the PREVIOUS step, because updateRacer runs before
      // world.step. Invisible at 60Hz; do not "fix" it by reordering the step.
      const fMotor = Math.abs(w.joint.getMotorTorque(1 / dt)) / Math.max(0.05, w.radius);
      const fMax = grip * (chassis.getMass() * -GRAVITY / Math.max(1, racer.wheels.length));
      const mag = Math.min(fMotor, fMax) * Math.sign(throttle || 1);
      const fwd = chassis.getWorldVector(new Vec2(1, 0));
      const wp = w.body.getPosition();
      probe(racer, 'drive' + w.slot, 'drive', wp.x, wp.y - w.radius, fwd.x * mag, fwd.y * mag);
    }

    // Rolling resistance for the soft surfaces -- mud and sand sap a wheel
    // regardless of how much torque it has.
    if (surf && surf.roll > 0 && Math.abs(vel0.x) > 0.05) {
      const load = (chassis.getMass() / Math.max(1, racer.wheels.length)) * -GRAVITY;
      const drag = -Math.sign(vel0.x) * surf.roll * load;
      chassis.applyForce(new Vec2(drag, 0), w.body.getPosition(), true);
    }
  }
  racer.surface = racer.track ? surfaceAt(racer.track, chassis.getPosition().x) : null;

  // -- air drag ----------------------------------------------------------
  if (racer.frontalHeight === undefined) {
    let lo = Infinity, hi = -Infinity;
    for (const hr of racer.hullRender) { lo = Math.min(lo, hr.cy - hr.h / 2); hi = Math.max(hi, hr.cy + hr.h / 2); }
    racer.frontalHeight = Math.max(0.5, hi - lo);
    racer.hullMidY = Math.max(0, (lo + hi) / 2);      // where wind pushes
    // What the wheels can push with at full torque. Used to bound wind, so a
    // headwind can slow a vehicle but never bring it to a halt.
    racer.tractive = racer.wheels.reduce(
      (a, w) => a + w.part.wheel.motorTorque / Math.max(0.05, w.radius), 0) || 400;
  }
  const vx = chassis.getLinearVelocity().x;
  if (Math.abs(vx) > 0.2) {
    const drag = -Math.sign(vx) * DRAG_PER_METRE * racer.frontalHeight * vx * vx;
    chassis.applyForceToCenter(new Vec2(drag, 0), true);
    if (racer.probe) {
      const c = chassis.getWorldCenter();
      probe(racer, 'drag', 'drag', c.x, c.y, drag, 0);
    }
  }

  // -- wind ----------------------------------------------------------------
  // Applied at the frontal-area centroid rather than the centre of mass. For a
  // low car that is a pitching moment of about 36 N.m, i.e. nothing; for a 3m
  // tower it is ~405 N.m against roughly 1000 N.m of tipping moment, so the
  // nose lifts visibly and recoverably. Lumping it at the centre of mass would
  // delete the better half of the lesson.
  const wind = (input.wind !== false && racer.track)
    ? windAt(racer.track, chassis.getPosition().x) : null;
  racer.wind = wind;
  if (wind) {
    // Height is capped for the wind term specifically. Uncapped, an absurd
    // tower is pushed nearly to a standstill, which trips the 2.5s stall
    // recovery -- and that hands it a free forward impulse every 2.5 seconds,
    // for ever. Wind must never become propulsion.
    const h = Math.min(WIND_MAX_HEIGHT, racer.frontalHeight);
    const f = wind.dir * Math.min(WIND_PER_METRE * h * wind.s,
                                  WIND_MAX_SHARE * racer.tractive);
    const at = chassis.getWorldPoint(new Vec2(0, Math.min(WIND_MAX_LEVER, racer.hullMidY ?? 0.4)));
    chassis.applyForce(new Vec2(f, 0), at, true);
    if (racer.probe) probe(racer, 'wind', 'drag', at.x, at.y, f, 0);
  }

  // -- jets ------------------------------------------------------------
  for (const t of racer.thrusters) {
    if (!throttle) continue;
    const world = chassis.getWorldVector(t.dir);
    const scale = t.part.thrust.force * throttle * (boosting ? 1.5 : 1);
    const at = chassis.getWorldPoint(t.point);
    chassis.applyForce(new Vec2(world.x * scale, world.y * scale), at, true);
    if (racer.probe) probe(racer, 'jet' + t.slot, 'thrust', at.x, at.y, world.x * scale, world.y * scale);
  }

  // -- boost -------------------------------------------------------------
  // Applied per booster along its OWN direction and at its own mounting point,
  // so a rotated booster pushes where it points and two of them add up.
  for (const s of racer.specials) {
    if (s.kind !== 'boost' || !(s.burnFor > 0)) continue;
    s.burnFor = Math.max(0, s.burnFor - dt);
    const d = chassis.getWorldVector(s.dir);
    const at = chassis.getWorldPoint(s.point);
    chassis.applyForce(new Vec2(d.x * s.impulse, d.y * s.impulse), at, true);
    if (racer.probe) probe(racer, 'boost' + s.slot, 'boost', at.x, at.y, d.x * s.impulse, d.y * s.impulse);
  }

  // -- anti-wheelie --------------------------------------------------------
  // Enough torque to climb a steep ledge is also enough to loop the vehicle
  // over backwards. Damping the ROTATION RATE (rather than clamping the hull
  // angle) is what makes both possible: a wheelie spins up fast, whereas a
  // vehicle sitting on a 35-degree slope is at the same angle but barely
  // rotating, so this leaves genuine hill climbing alone.
  if (throttle > 0) {
    const av = chassis.getAngularVelocity();
    const pitch = normAngle(chassis.getAngle());
    if (av > 1.2 && pitch > 0.35) {
      chassis.applyTorque(-(av - 1.2) * 6.0 * inertiaAboutCoM(chassis), true);
    }
  }

  // -- wings -------------------------------------------------------------
  // Downforce scales with the square of forward speed, so a wing does nothing
  // when you are crawling and a lot when you are about to take off.
  const vel = chassis.getLinearVelocity();
  // Airspeed, not ground speed. In a headwind a vehicle is SLOWER, so a wing
  // keyed to ground speed makes less downforce exactly when the wind's pitching
  // moment is trying to lift the nose -- backwards. This makes the wing the
  // right answer to a wind zone, which is a lesson a child can find by trying.
  //
  // Only the wing uses airspeed. Switching the drag term to it as well would
  // double-count, and keeping wind as a separate force is what lets a STOPPED
  // vehicle still get pushed, which is the most legible thing wind can do.
  const windX = wind ? -wind.dir * wind.s * 6 : 0;
  for (const wing of racer.wings) {
    const vx = Math.abs(vel.x - windX);
    const down = -wing.part.wing.downforce * vx * vx;
    const at = chassis.getWorldPoint(wing.point);
    chassis.applyForce(new Vec2(0, down), at, true);
    if (racer.probe) probe(racer, 'wing' + wing.slot, 'wing', at.x, at.y, 0, down);
  }

  // -- recovery ----------------------------------------------------------
  // Indestructible and never stuck. Two triggers: an obvious flip, or simply
  // failing to make forward progress. The second one is what actually matters
  // -- most real stalls are a nose-up beaching or a hull caught on a ledge,
  // both well short of upside down.
  const angle = normAngle(chassis.getAngle());
  const speed = vel.length();
  const pos = chassis.getPosition();

  if (pos.x > racer.bestX + PROGRESS_EPS) { racer.bestX = pos.x; racer.stalledFor = 0; }
  else if (!racer.finished) racer.stalledFor += dt;

  // Inverted counts even at speed. A vehicle can slide along on its roof for
  // twenty metres while still "making progress", which never trips the stall
  // check and never trips a speed-gated flip check -- so it just stays upside
  // down. Being on your roof is broken regardless of how fast you are going.
  if (Math.abs(angle) > FLIP_ANGLE) racer.invertedFor += dt;
  else racer.invertedFor = 0;

  const flipGrace = speed < 1.6 ? FLIP_GRACE : FLIP_GRACE_MOVING;

  // How much the game is allowed to help.
  //
  //   'full' (races)  both triggers -- the "never stuck" promise.
  //   'flip'          right it if it lands on its roof, but never shove it
  //                   along for standing still.
  //   'off'  (tests)  none. A test that measures how steep a hill a vehicle
  //                   can climb CANNOT have the game pushing it up the hill
  //                   every 2.5 seconds; stalling IS the measurement.
  const assist = input.assist ?? 'full';
  const stalled = assist === 'full' && racer.stalledFor > STALL_GRACE;
  const flipped = assist !== 'off' && racer.invertedFor > flipGrace;

  if (racer.recoverFor === 0 && (stalled || flipped)) {
    racer.recoverFor = 1e-4;
    racer.recoveries++;
    // A one-shot hop. Righting alone does nothing for a hull wedged against a
    // ledge; it needs to be lifted clear as well as levelled.
    const m = chassis.getMass();
    chassis.applyLinearImpulse(new Vec2(m * 1.6, m * 4.0), chassis.getWorldCenter(), true);
  }

  if (racer.recoverFor > 0) {
    racer.recoverFor += dt;
    const inertia = inertiaAboutCoM(chassis);
    const err = normAngle(-angle);
    chassis.applyTorque((err * 27 - chassis.getAngularVelocity() * 9.6) * inertia, true);
    chassis.applyForceToCenter(new Vec2(0, -GRAVITY * chassis.getMass() * 0.3), true);

    const settled = Math.abs(angle) < 0.5 && Math.abs(chassis.getAngularVelocity()) < 1.5;
    if ((settled && racer.recoverFor > 0.35) || racer.recoverFor > RECOVER_TIMEOUT) {
      racer.recoverFor = 0;
      racer.invertedFor = 0;
      racer.stalledFor = 0;
      racer.bestX = pos.x;
    }
  }

  if (racer.probe) {
    // Weight is synthesised rather than recorded: gravity is integrated by the
    // solver, never applied as a force here. Drawn at the whole-vehicle centre
    // of mass so it lands on the same point the builder marks.
    const com = vehicleCentreOfMass(racer);
    // Read gravity from the WORLD rather than using the constant. The Tilt Test
    // rig works by rotating the gravity vector, so a hard-coded straight-down
    // arrow would point the wrong way on exactly the screen where the direction
    // of the weight is the entire lesson.
    const g = racer.world.getGravity();
    probe(racer, 'weight', 'weight', com.x, com.y, g.x * com.mass, g.y * com.mass);
    // Anything that stopped acting this tick fades instead of vanishing, so an
    // arrow does not flicker on and off at a gate boundary.
    for (const e of racer.probe.values()) if (!e.live) { e.fx *= 0.8; e.fy *= 0.8; }
  }

  racer.distance = chassis.getPosition().x;
  return racer;
}

export { M };
