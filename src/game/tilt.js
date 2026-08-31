// How steep a slope this vehicle can sit on before it falls over.
//
// This is the PREDICTION that the Tilt Test track then measures for real. The
// two are independent -- static geometry here, a full rigid-body simulation
// there -- so when they agree it is genuine evidence that both are right.
//
// Pure: no DOM, no planck, no physics world. It reads the grid directly, which
// is what lets the builder update it on every single block placement.

import { centreOfMass, balanceRating } from './vehicle.js';
import { vehicleBoundsCells } from './geometry.js';

/** Past this we stop caring: a vehicle that holds 60 degrees does not tip. */
export const TILT_MAX = Math.PI / 3;      // 60 deg

// Thresholds are DERIVED from balanceRating rather than picked, so that for a
// vehicle whose mass is centred over its wheelbase the medal earned here can
// never disagree with the colour of its centre-of-mass dot. balanceRating flips
// at ratio 0.5 and 0.75, and for a centred CoM the tip angle is
// atan(0.5 / ratio) -- which is exactly these two values.
//
// An OFF-centre vehicle can legitimately disagree, and that is the point: the
// dot only knows how tall you are relative to your wheelbase, while this also
// knows WHERE in that wheelbase the weight sits.
export const TILT_GOOD = Math.atan(1.0);       // 45.0 deg
export const TILT_OK = Math.atan(2 / 3);       // 33.7 deg

const clampAngle = (a) => Math.max(0, Math.min(TILT_MAX, a));

/**
 * The angle at which this vehicle falls over, tested BOTH ways.
 *
 * Testing only nose-up would miss the more common real fault. Plodder, for
 * instance, carries its ballast at the back: it holds 60 degrees nose-up and
 * gives up at 44 nose-down. Reporting the better of the two would call the
 * least stable starter the most stable one, so the result is the WORSE
 * direction -- a vehicle is only as good as the way it falls over first.
 *
 * @returns {null|{angle,rating,worst,back,front,height,left,right,ground,com,mode,degenerate}}
 *   Angles in radians; every coordinate in GRID CELLS with y downward, matching
 *   drawBalance() in the builder.
 */
export function tiltTest(vehicle) {
  const com = centreOfMass(vehicle);
  if (!com) return null;

  let { left, right, ground } = com;
  let mode = 'wheels';

  if (ground === null) {
    // No wheels: it sits on its belly. That is genuinely stable, so measure the
    // hull footprint rather than refusing to answer.
    const b = vehicleBoundsCells(vehicle);
    left = b.x;
    right = b.x + b.w;
    ground = b.y + b.h;
    mode = 'hull';
  }

  const height = ground - com.y;            // grid y grows downward

  // Nose-up tips it over BACKWARDS, pivoting on the rear contact, so the lever
  // that holds it up is the distance from that rear contact to the mass. Nose-
  // down is the mirror image. Half the wheelbase would be wrong for both: it
  // would score a nose-heavy and a tail-heavy vehicle as identical.
  const lever = (arm) => (height <= 0.01 ? TILT_MAX : clampAngle(Math.atan2(arm, height)));
  const back = lever(com.x - left);         // tilting nose-up
  const front = lever(right - com.x);       // tilting nose-down

  const angle = Math.min(back, front);
  const worst = back <= front ? 'back' : 'front';

  // A single wheel is statically unstable, so ~0 degrees is the correct answer.
  // It still reads as a bug, so flag it and let the UI show a wobble rather
  // than award a wooden spoon for something that was never a tipping problem.
  const degenerate = right - left < 0.25;

  return {
    angle, back, front, worst,
    height, left, right, ground, mode, degenerate,
    com: { x: com.x, y: com.y },
    pivot: { x: worst === 'back' ? left : right, y: ground },
    rating: tiltRating(angle),
  };
}

/** Traffic light, on the same scale as balanceRating. */
export function tiltRating(angle) {
  if (!(angle > 0)) return 'none';
  if (angle >= TILT_GOOD) return 'good';
  if (angle >= TILT_OK) return 'ok';
  return 'bad';
}

/** A picture of how well you did, for a player who cannot read. */
export function tiltMedal(result) {
  if (!result || result.degenerate || result.mode === 'hull') return null;
  if (result.angle >= TILT_GOOD) return '🥇';
  if (result.angle >= TILT_OK) return '🥈';
  return '🥉';
}

export { balanceRating };
