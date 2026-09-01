// Buoyancy: real Archimedes, not a "light things float" rule.
//
// planck is 2D, so a fixture's density is kilograms per square metre and the
// displaced "volume" is an area. That makes the law exactly:
//
//     F = density * g * submerged_area
//
// applied upward at the centroid of the submerged part. The only arbitrary
// number is the water's density, which is a balance knob like DRAG_PER_METRE.

/**
 * Kilograms per square metre of water.
 *
 * One fully submerged grid cell (0.5m x 0.5m = 0.25 m^2) holds up 11.25kg,
 * which is the sentence worth remembering. Chosen so that nothing in the parts
 * catalogue lands near neutral: 40 would make `block` exactly neutral and 48-50
 * would make `tread` marginal, and a part that visibly cannot decide whether it
 * floats reads as a bug rather than as a lesson.
 *
 * The starters fall out of it with no content authoring at all -- Hopper 28.5
 * and Spike 33.1 kg/m^2 float, Plodder at 65.5 sinks.
 *
 * Honest caveat: floaters sit LOW, around two thirds submerged, because the
 * catalogue only spans 1.7x in material density. You cannot make a block build
 * ride high without also floating the ballast tank. The right reading is that
 * `light_block` (16 kg/m^2, about a third submerged) is the boat part -- do not
 * try to fix the ride height with the density, that is the physics being honest.
 */
export const WATER = {
  density: 45,
  // Split by axis: a hull is streamlined lengthwise and bluff vertically. This
  // is physical rather than a fudge, and it is what lets the bobbing be damped
  // without turning the water into a wall you cannot drive through.
  // Lengthwise drag has to be small enough that a paddling vehicle can actually
  // beat it. At 18/14 the sums said terminal velocity was 1.5 m/s and the
  // reality was 0.05: a floating Hopper sat in the pond for twenty seconds
  // going nowhere, and raising the paddle cap changed nothing because the cap
  // was never the binding constraint. 8/5 against ~120N of paddle settles a
  // floater near 2.5 m/s -- a clear four-fold penalty against land speed,
  // which is the point, without being a wall.
  dragXLin: 8, dragXQuad: 5,
  // Vertical stays stiff. This is what damps the bobbing, and a hull is bluff
  // vertically and streamlined lengthwise, so the split is physical.
  dragYLin: 90, dragYQuad: 40,
  angularDamping: 2.5,
  // Wheels keep turning underwater -- they are electric, and a child expects a
  // spinning wheel to keep spinning -- but they bite far less, and they push a
  // little water. Without the paddle a floating vehicle is a dead duck in the
  // middle of a pond and the recovery controller has to bail it out every time.
  wetGrip: 0.55,
  paddle: 40, paddleMax: 75,
  // A jet is the one drive part that does not need the ground, so unthrottled
  // it becomes the universal answer to water -- exactly the jet-sled problem
  // the 900N -> 180N cut fixed. Still the best thing in a pond, just not free.
  jetScale: 0.60,
};

/**
 * Cache one body's fixtures in LOCAL coordinates, once, at build time.
 *
 * Transforming ~56 vertices per body per tick costs one cos/sin; doing it per
 * fixture would cost one per fixture for no gain.
 */
export function displacementOf(body) {
  const out = [];
  for (let f = body.getFixtureList(); f; f = f.getNext()) {
    const shape = f.getShape();
    if (shape.getType() === 'circle') {
      out.push({ kind: 'circle', cx: shape.m_p.x, cy: shape.m_p.y, r: shape.m_radius });
    } else if (shape.m_vertices) {
      const n = shape.m_count ?? shape.m_vertices.length;
      const xs = new Float64Array(n), ys = new Float64Array(n);
      for (let i = 0; i < n; i++) { xs[i] = shape.m_vertices[i].x; ys[i] = shape.m_vertices[i].y; }
      out.push({ kind: 'poly', xs, ys, n });
    }
  }
  return out;
}

// Scratch buffers: this runs for every fixture of every body every tick, and
// allocating here would make the garbage collector part of the physics.
const CX = new Float64Array(16);
const CY = new Float64Array(16);
const WX = new Float64Array(16);
const WY = new Float64Array(16);

/**
 * Area and centroid of the part of a convex polygon below `level`.
 *
 * Sutherland-Hodgman against a single half-plane, which for a shape of at most
 * eight vertices is about forty operations. Exact clipping is used rather than
 * clipping the bounding box because an AABB is 1.41x wider for a box at 45
 * degrees -- so a tumbling vehicle would GAIN lift as it spun, which is
 * disqualifying for a mechanic whose whole point is that density decides.
 * Sampling points instead costs more than this and still jitters at the
 * waterline.
 */
function polyBelow(wx, wy, n, level) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ai = wy[i] <= level, aj = wy[j] <= level;
    if (ai) { CX[m] = wx[i]; CY[m] = wy[i]; m++; }
    if (ai !== aj) {
      const t = (level - wy[i]) / (wy[j] - wy[i]);
      CX[m] = wx[i] + (wx[j] - wx[i]) * t;
      CY[m] = level;
      m++;
    }
  }
  if (m < 3) return null;
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const cross = CX[i] * CY[j] - CX[j] * CY[i];
    a2 += cross;
    cx += (CX[i] + CX[j]) * cross;
    cy += (CY[i] + CY[j]) * cross;
  }
  if (Math.abs(a2) < 1e-9) return null;
  return { area: Math.abs(a2) / 2, cx: cx / (3 * a2), cy: cy / (3 * a2) };
}

/** Closed-form circular segment. Circles need no rotation, only their centre. */
function circleBelow(cx, cy, r, level) {
  const h = Math.max(0, Math.min(2 * r, r + (level - cy)));
  if (h <= 0) return null;
  if (h >= 2 * r) return { area: Math.PI * r * r, cx, cy };
  const alpha = Math.acos((r - h) / r);
  const sa = Math.sin(alpha);
  const area = r * r * (alpha - sa * Math.cos(alpha));
  if (area < 1e-9) return null;
  // Centroid of the segment, measured down from the circle's centre.
  const off = (2 / 3) * r * (sa * sa * sa) / (alpha - sa * Math.cos(alpha));
  return { area, cx, cy: cy - off };
}

/**
 * Apply buoyancy and fluid drag to one body. Returns the submerged area.
 *
 * Per FIXTURE, at each one's own submerged centroid -- never lumped at the body
 * centre. Lumping produces exactly zero buoyancy torque, so a vehicle that
 * enters nose-down stays nose-down for ever and ballast at one end produces no
 * list: it would look like a sticker sliding on a blue rectangle. Doing it per
 * fixture gives the righting moment AND the angular damping for free out of the
 * same integral, and makes "weight at the back lifts the nose" visible.
 */
export function applyFluid(planck, body, disp, level, gravity, cfg = WATER) {
  const { Vec2 } = planck;
  const pos = body.getPosition();
  const a = body.getAngle();
  const cos = Math.cos(a), sin = Math.sin(a);
  const vel = body.getLinearVelocity();
  let total = 0;

  for (const d of disp) {
    let sub = null;
    if (d.kind === 'circle') {
      sub = circleBelow(pos.x + d.cx * cos - d.cy * sin,
                        pos.y + d.cx * sin + d.cy * cos, d.r, level);
    } else {
      for (let i = 0; i < d.n; i++) {
        WX[i] = pos.x + d.xs[i] * cos - d.ys[i] * sin;
        WY[i] = pos.y + d.xs[i] * sin + d.ys[i] * cos;
      }
      sub = polyBelow(WX, WY, d.n, level);
    }
    if (!sub) continue;
    total += sub.area;

    const lift = cfg.density * -gravity * sub.area;
    body.applyForce(new Vec2(0, lift), new Vec2(sub.cx, sub.cy), true);

    const fx = -Math.sign(vel.x) * sub.area * (cfg.dragXLin * Math.abs(vel.x) + cfg.dragXQuad * vel.x * vel.x);
    const fy = -Math.sign(vel.y) * sub.area * (cfg.dragYLin * Math.abs(vel.y) + cfg.dragYQuad * vel.y * vel.y);
    body.applyForce(new Vec2(fx, fy), new Vec2(sub.cx, sub.cy), true);
  }
  return total;
}
