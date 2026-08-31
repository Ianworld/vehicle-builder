// Draws a physics world: sky, terrain, props, vehicles.
//
// At zoom 1 the mapping is exact: one grid cell is 0.5 m and 32 px, so
// PX_PER_M is 64 and every sprite lands on whole pixels.

import { spriteCanvas } from '../art/atlas.js';
import { M } from '../game/build.js';
import { CELL } from '../game/parts.js';

export const PX_PER_M = CELL / M;   // 64

export function makeCamera() {
  // roll tilts the whole view. The Tilt Test rotates GRAVITY rather than the
  // ground -- rotating a long static chain under a resting body invites jitter
  // -- so the camera has to lean the other way to sell it as a rising ramp.
  return { x: 0, y: 0, zoom: 1, groundLine: 0.68, roll: 0 };
}

/** World -> screen, for a camera drawn into a viewport of w x h css px. */
export function project(cam, vw, vh) {
  const s = PX_PER_M * cam.zoom;
  return {
    s,
    sx: (wx) => (wx - cam.x) * s + vw * 0.34,
    sy: (wy) => vh * cam.groundLine - (wy - cam.y) * s,
  };
}

function drawTerrain(ctx, p, vw, vh, trackBuild) {
  ctx.lineJoin = 'round';
  for (const segment of trackBuild.segments) {
    const seg = segment.points;
    const surf = segment.surface;
    // Cheap horizontal cull: terrain is thousands of samples long.
    const first = seg[0], last = seg[seg.length - 1];
    if (p.sx(last[0]) < -60 || p.sx(first[0]) > vw + 60) continue;

    ctx.beginPath();
    let started = false;
    for (const [x, y] of seg) {
      const px = p.sx(x);
      if (px < -80 || px > vw + 80) { if (started) continue; }
      const py = p.sy(y);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    if (!started) continue;
    // Close the fill down past the bottom of the view.
    ctx.lineTo(p.sx(last[0]), vh + 40);
    ctx.lineTo(p.sx(first[0]), vh + 40);
    ctx.closePath();
    ctx.fillStyle = surf?.fill || '#2b3a2c';
    ctx.fill();

    // Grass cap
    ctx.beginPath();
    started = false;
    for (const [x, y] of seg) {
      const px = p.sx(x), py = p.sy(y);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = surf?.cap || '#46b04a';
    ctx.lineWidth = Math.max(2, 3 * cam0(p));
    ctx.stroke();
  }
}

const cam0 = (p) => p.s / PX_PER_M;

function drawProps(ctx, p, props) {
  for (const prop of props) {
    const pos = prop.body.getPosition();
    const px = p.sx(pos.x), py = p.sy(pos.y);
    if (px < -80 || px > 1e5) continue;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-prop.body.getAngle());
    if (prop.kind === 'boulder') {
      const r = prop.radius * p.s;
      ctx.fillStyle = '#68738d';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#97a1b8';
      ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#12141c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    } else {
      const h = prop.size * p.s;
      ctx.fillStyle = '#8a5a2a';
      ctx.fillRect(-h, -h, h * 2, h * 2);
      ctx.strokeStyle = '#12141c'; ctx.lineWidth = 2;
      ctx.strokeRect(-h, -h, h * 2, h * 2);
      ctx.strokeStyle = '#b5813f';
      ctx.beginPath();
      ctx.moveTo(-h, -h); ctx.lineTo(h, h); ctx.moveTo(h, -h); ctx.lineTo(-h, h);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Tunnel beams and bridge planks. Skipped once destroyed. */
function drawBreakables(ctx, p, build) {
  for (const b of build.breakables || []) {
    if (b.gone) continue;
    const pos = b.body.getPosition();
    const px = p.sx(pos.x), py = p.sy(pos.y);
    if (px < -120 || px > 1e5) continue;
    const hw = b.half * p.s;
    const hh = (b.kind === 'plank' ? 0.16 : b.height) * p.s;

    ctx.save();
    ctx.translate(px, py);
    if (b.kind === 'plank') {
      ctx.fillStyle = '#8a5a2a';
      ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
      ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = Math.max(1, 2 * cam0(p));
      ctx.beginPath();
      ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#68738d';
      ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
      // hazard stripes so the height limit reads as a warning
      ctx.fillStyle = '#ffd23e';
      const n = 3;
      for (let i = 0; i < n; i++) {
        ctx.fillRect(-hw + (i * 2 + 0.4) * (hw * 2) / (n * 2), -hh, (hw * 2) / (n * 2.6), hh * 2);
      }
    }
    ctx.strokeStyle = '#12141c'; ctx.lineWidth = Math.max(1, 2 * cam0(p));
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    ctx.restore();
  }
}

function blit(ctx, sprite, p, wx, wy, angle, wMeters, hMeters) {
  const img = spriteCanvas(sprite.art, sprite.rot, 1);
  ctx.save();
  ctx.translate(p.sx(wx), p.sy(wy));
  ctx.rotate(-angle);                     // canvas y is down, planck y is up
  const w = wMeters * p.s, h = hMeters * p.s;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

const PLUMES = ['flame_a', 'flame_b', 'flame_c', 'flame_d'];
const HOP_PLUMES = ['hop_a', 'hop_b', 'hop_c'];
const GRIT = ['grip_a', 'grip_b', 'grip_c'];

/**
 * Pin an exhaust plume to a nozzle and point it along the exhaust direction.
 * The sprite is authored pointing +X with its attachment edge at x=0, so the
 * origin lands exactly on the nozzle and the flame grows away from the part.
 */
function drawPlume(ctx, p, racer, mount, scale, seed, frames = PLUMES) {
  if (scale <= 0.01) return;
  const body = racer.chassis;
  const at = body.getWorldPoint(mount.nozzle);
  const dir = body.getWorldVector(mount.exhaust);

  // Flicker: a per-thruster seed stops every nozzle pulsing in lockstep.
  const frame = frames[(((performance.now() / 55) | 0) + seed) % frames.length];
  const img = spriteCanvas(frame, 0, 1);
  const w = (img.width / PX_PER_M) * p.s * scale;
  const h = (img.height / PX_PER_M) * p.s * scale;

  ctx.save();
  ctx.translate(p.sx(at.x), p.sy(at.y));
  ctx.rotate(-Math.atan2(dir.y, dir.x));   // canvas y is down, planck y is up
  ctx.drawImage(img, 0, -h / 2, w, h);
  ctx.restore();
}

/** Plumes are drawn behind the vehicle so they never cover the part itself. */
function drawThrust(ctx, p, racer) {
  const boosting = racer.boostFor > 0;

  racer.thrusters.forEach((t, i) => {
    // A jet burns whenever it is pushing, and harder under boost.
    const scale = (racer.throttle > 0 ? 0.8 : 0) * (boosting ? 1.5 : 1);
    drawPlume(ctx, p, racer, t, scale, i);
  });

  racer.specials.forEach((s, i) => {
    if (s.kind === 'boost' && boosting) {
      // Taper off over the last third of the burn rather than snapping to zero.
      const left = Math.min(1, racer.boostFor / (s.duration * 0.34));
      drawPlume(ctx, p, racer, s, 1.1 + 0.4 * left, i + 2);
    } else if (s.kind === 'hop' && racer.hopFor > 0) {
      // Fades as the hop spends itself, so it reads as a burst not a jet.
      drawPlume(ctx, p, racer, s, 0.55 + 0.75 * Math.min(1, racer.hopFor / 0.45),
        i + 5, HOP_PLUMES);
    }
  });

  drawGrip(ctx, p, racer);
}

/**
 * Grip surge has no exhaust -- it is a traction effect -- so it shows as grit
 * thrown out at each wheel's contact patch rather than as a plume.
 */
function drawGrip(ctx, p, racer) {
  if (racer.gripFor <= 0) return;
  const fade = Math.min(1, racer.gripFor / 0.6);

  racer.wheels.forEach((wheel, i) => {
    const c = wheel.body.getPosition();
    const r = wheel.part.wheel.radius * M;
    const frame = GRIT[(((performance.now() / 70) | 0) + i) % GRIT.length];
    const img = spriteCanvas(frame, 0, 1);
    const w = (img.width / PX_PER_M) * p.s;
    const h = (img.height / PX_PER_M) * p.s;

    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * fade;
    // Pinned at the contact patch in WORLD space, not to the wheel's rotation:
    // grit sprays off the ground, it does not spin with the tyre.
    ctx.drawImage(img, p.sx(c.x) - w / 2, p.sy(c.y - r) - h * 0.35, w, h);
    ctx.restore();
  });
}

// ------------------------------------------------------------ science view
//
// Colours are the ones the child already associates with each effect: the grit
// sprites' aqua for grip, the flames' orange for thrust. Every arrow gets the
// same ink outline the sprite style pass gives every sprite, which is what
// makes the overlay read as part of the art rather than as a debug HUD.
// Deliberately no crimson: red already means "bad balance" in the builder.
const FORCE_COLOUR = {
  weight: '#f4f7fc',
  drive: '#7fe3ff',
  thrust: '#ff8c1a',
  boost: '#ffd23e',
  wing: '#2e9fd6',
  drag: '#68738d',
};

// Length is a fixed-reference power law, NOT normalised to the largest arrow.
// Normalising would make length mean something different every frame -- the
// drag arrow would jump the instant a boost ended -- and for a five-year-old
// length has to mean magnitude, always. A straight linear scale is no good
// either: 40N against a 2600N boost is 1.5% of the screen, invisible. This maps
// the game's real 65:1 spread of forces onto 5.6:1 on screen, monotonically.
const REF_N = 1500;        // roughly one vehicle's weight
const REF_LEN = 1.4;       // metres on screen at REF_N
const EXP = 0.6;
const CUTOFF_N = 25;       // below this, draw nothing at all
const MIN_LEN = 0.35;
const MAX_LEN = 2.6;
const MAX_ARROWS = 8;

const arrowLen = (f) => (f < CUTOFF_N ? 0
  : Math.max(MIN_LEN, Math.min(MAX_LEN, Math.pow(f / REF_N, EXP) * REF_LEN)));

function arrow(ctx, p, wx, wy, fx, fy, colour) {
  const mag = Math.hypot(fx, fy);
  const len = arrowLen(mag);
  if (!len) return;
  const ux = fx / mag, uy = fy / mag;
  const x0 = p.sx(wx), y0 = p.sy(wy);
  const px = len * p.s;
  const x1 = x0 + ux * px, y1 = y0 - uy * px;      // canvas y is down
  const head = Math.max(5, Math.min(13, px * 0.28));
  const nx = -uy, ny = -ux;                        // screen-space perpendicular

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? colour : '#12141c';
    ctx.fillStyle = pass ? colour : '#12141c';
    ctx.lineWidth = pass ? 3 : 6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - ux * head * 0.6, y1 + uy * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * head + nx * head * 0.55, y1 + uy * head + ny * head * 0.55);
    ctx.lineTo(x1 - ux * head - nx * head * 0.55, y1 + uy * head - ny * head * 0.55);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Force arrows, plus the balance marks the builder already draws.
 *
 * Draws nothing unless the racer is being probed, so the toggle is simply
 * whether enableProbe() was called -- renderView needs no extra argument.
 */
export function drawForces(ctx, p, racer) {
  if (!racer.probe) return;

  // Strongest last, so the biggest arrow is never buried under a small one.
  const arrows = [...racer.probe.values()]
    .map((e) => ({ e, mag: Math.hypot(e.fx, e.fy) }))
    .filter((a) => a.mag >= CUTOFF_N)
    .sort((a, b) => a.mag - b.mag)
    .slice(-MAX_ARROWS);

  for (const { e } of arrows) {
    arrow(ctx, p, e.px, e.py, e.fx, e.fy, FORCE_COLOUR[e.kind] || '#f4f7fc');
  }

  // The same vocabulary as the builder's balance overlay: the dot, a plumb line
  // straight down, and the bar between the wheel contacts. Watching the plumb
  // walk past the rear wheel as a vehicle rears up explains a tip-over better
  // than any arrow, and it needs no probe data at all.
  const w = racer.probe.get('weight');
  if (!w) return;
  const cx = p.sx(w.px), cy = p.sy(w.py);

  if (racer.wheels.length) {
    // Support base: the outermost contact patches, in WORLD space, so it lies
    // along the ground rather than along the screen.
    let a = null, b = null;
    for (const wheel of racer.wheels) {
      const q = wheel.body.getPosition();
      const pt = { x: q.x, y: q.y - wheel.radius };
      if (!a || pt.x < a.x) a = pt;
      if (!b || pt.x > b.x) b = pt;
    }

    ctx.strokeStyle = '#12141c';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(p.sx(a.x), p.sy(a.y)); ctx.lineTo(p.sx(b.x), p.sy(b.y)); ctx.stroke();
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(p.sx(a.x), p.sy(a.y)); ctx.lineTo(p.sx(b.x), p.sy(b.y)); ctx.stroke();

    // Plumb line: dropped along GRAVITY, not down the screen, and stopped where
    // it meets the line through the contacts. Where that foot lands relative to
    // the two ends IS the tipping criterion -- once it leaves the bar, over it
    // goes -- so this draws the mechanism rather than illustrating it.
    const mag = Math.hypot(w.fx, w.fy);
    if (mag > 1e-6) {
      const gx = w.fx / mag, gyv = w.fy / mag;
      const dx = b.x - a.x, dy = b.y - a.y;
      const det = dx * gyv - dy * gx;
      if (Math.abs(det) > 1e-6) {
        const rx = a.x - w.px, ry = a.y - w.py;
        const t = (dx * ry - dy * rx) / det;         // distance along gravity
        const fx = w.px + gx * t, fy = w.py + gyv * t;
        ctx.strokeStyle = 'rgba(255,210,62,.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.sx(fx), p.sy(fy)); ctx.stroke();
        ctx.setLineDash([]);
        // A tick at the foot, so the eye can see it creep toward the end.
        ctx.fillStyle = '#ffd23e';
        ctx.beginPath(); ctx.arc(p.sx(fx), p.sy(fy), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  ctx.fillStyle = '#12141c';
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd23e';
  ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();
}

export function drawRacer(ctx, p, racer) {
  const body = racer.chassis;
  const pos = body.getPosition();
  const ang = body.getAngle();
  const cos = Math.cos(ang), sin = Math.sin(ang);

  drawThrust(ctx, p, racer);

  // Wheels next so the hull overlaps them.
  for (const wr of racer.wheelRender) {
    const wp = wr.body.getPosition();
    blit(ctx, wr, p, wp.x, wp.y, wr.body.getAngle(), wr.w, wr.h);
  }
  for (const hr of racer.hullRender) {
    blit(ctx, hr, p,
      pos.x + hr.cx * cos - hr.cy * sin,
      pos.y + hr.cx * sin + hr.cy * cos,
      ang, hr.w, hr.h);
  }

  // On top of the sprite: an arrow hidden under the chassis is useless, and the
  // ink outline keeps the vehicle readable underneath.
  drawForces(ctx, p, racer);
}

function drawSky(ctx, vw, vh) {
  const g = ctx.createLinearGradient(0, 0, 0, vh);
  g.addColorStop(0, '#16506e');
  g.addColorStop(0.55, '#2e7fa8');
  g.addColorStop(1, '#7fc4d8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, vw, vh);
}

function drawFinish(ctx, p, x, vh) {
  const px = p.sx(x);
  if (px < -40 || px > 1e5) return;
  const band = 10 * cam0(p);
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = i % 2 ? '#f4f7fc' : '#12141c';
    ctx.fillRect(px, vh * 0.68 - (i + 1) * band, band * 1.6, band);
  }
}

/**
 * Render one viewport.
 * @param {object} view {ctx, vw, vh}
 */
export function renderView({ ctx, vw, vh }, cam, trackBuild, racers) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, vw, vh);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;

  drawSky(ctx, vw, vh);

  // The sky stays put and everything else leans, which is what makes a tilted
  // world read as a slope rather than as a wonky camera.
  if (cam.roll) {
    ctx.translate(vw * (cam.anchor ?? 0.34), vh * cam.groundLine);
    ctx.rotate(cam.roll);
    ctx.translate(-vw * (cam.anchor ?? 0.34), -vh * cam.groundLine);
  }

  const p = project(cam, vw, vh);
  drawTerrain(ctx, p, vw, vh, trackBuild);
  drawFinish(ctx, p, trackBuild.length, vh);
  drawProps(ctx, p, trackBuild.props);
  drawBreakables(ctx, p, trackBuild);
  for (const r of racers) drawRacer(ctx, p, r);

  ctx.restore();
}
