// Runtime physics for one vehicle: drive, thrust, aero, specials, auto-right.

import { buildVehicle, M } from './build.js';

export const GRAVITY = -10;

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

  for (const s of racer.specials) s.cooldownLeft = Math.max(0, s.cooldownLeft - dt);
  racer.boostFor = Math.max(0, racer.boostFor - dt);
  racer.gripFor = Math.max(0, racer.gripFor - dt);
  racer.hopFor = Math.max(0, racer.hopFor - dt);

  // -- drive -----------------------------------------------------------
  // Negative motor speed spins a wheel clockwise, which drives +x.
  const boosting = racer.boostFor > 0;
  for (const w of racer.wheels) {
    w.joint.setMotorSpeed(-w.maxSpeed * throttle * (boosting ? 1.35 : 1));
    w.joint.setMaxMotorTorque(w.part.wheel.motorTorque * (boosting ? 1.6 : 1));
    const grip = racer.gripFor > 0 ? w.baseFriction * (racer.gripMultiplier || 1) : w.baseFriction;
    if (w.fixture.getFriction() !== grip) w.fixture.setFriction(grip);
  }

  // -- jets ------------------------------------------------------------
  for (const t of racer.thrusters) {
    if (!throttle) continue;
    const world = chassis.getWorldVector(t.dir);
    const scale = t.part.thrust.force * throttle * (boosting ? 1.5 : 1);
    chassis.applyForce(new Vec2(world.x * scale, world.y * scale),
      chassis.getWorldPoint(t.point), true);
  }

  // -- boost -------------------------------------------------------------
  // Applied per booster along its OWN direction and at its own mounting point,
  // so a rotated booster pushes where it points and two of them add up.
  for (const s of racer.specials) {
    if (s.kind !== 'boost' || !(s.burnFor > 0)) continue;
    s.burnFor = Math.max(0, s.burnFor - dt);
    const d = chassis.getWorldVector(s.dir);
    chassis.applyForce(new Vec2(d.x * s.impulse, d.y * s.impulse),
      chassis.getWorldPoint(s.point), true);
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
  for (const wing of racer.wings) {
    const vx = Math.abs(vel.x);
    const down = -wing.part.wing.downforce * vx * vx;
    chassis.applyForce(new Vec2(0, down), chassis.getWorldPoint(wing.point), true);
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

  if (racer.recoverFor === 0 &&
      (racer.stalledFor > STALL_GRACE || racer.invertedFor > flipGrace)) {
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

  racer.distance = chassis.getPosition().x;
  return racer;
}

export { M };
