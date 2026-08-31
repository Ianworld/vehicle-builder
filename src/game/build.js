// Compiles a vehicle grid into planck bodies and joints.
//
// The decision that makes this stable: ALL structural parts collapse into ONE
// rigid body with a fixture per part, rather than a body per block held
// together by joints. A jointed lattice is what makes these games wobble and
// tear themselves apart. As a bonus, mass and centre of gravity fall out of the
// fixture layout for free, so where a kid puts the ballast genuinely matters.
//
// Wheels are the exception: separate circle bodies on WheelJoints, which give a
// motor and spring suspension in one joint.

import { CELL, getPart, partSize } from './parts.js';
import { vehicleBoundsCells } from './geometry.js';

/** Metres per grid cell. A 5-cell vehicle is then 2.5 m long. */
export const M = 0.5;

/** Every fixture of one vehicle shares this, so nothing self-collides. */
const SELF_GROUP = -1;

// Local polygon outlines, in cell space with Y UP and the cell spanning 0..1.
// Only parts whose collision shape should not be a plain box appear here.
const SHAPES = {
  // Plow: point low at the front (right), rising backwards, so an obstacle
  // rides up and over instead of stopping the vehicle. This triangle IS the
  // part's whole reason to exist -- a box here would do nothing.
  // The leading edge is a short vertical face, not a knife point: a true point
  // catches on the joins between terrain edges and pins the vehicle.
  wedge: [[0, 0.875], [0, 0], [1, 0], [1, 0.14]],
};

/**
 * Rotate a local direction to match a part's sprite rotation.
 * One sprite turn is 90 degrees clockwise on screen, which with Y up is
 * (x, y) -> (y, -x). Check: a jet's (1,0) becomes (0,-1) at r=1, i.e. it fires
 * downward, which is what the rotated sprite shows.
 */
function rotateDir(planck, [x, y], turns) {
  let px = x, py = y;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) {
    const nx = py, ny = -px;
    px = nx; py = ny;
  }
  return new planck.Vec2(px, py);
}

function rotatePoint([x, y], turns) {
  // Sprite rotation is clockwise on screen; with Y up that is counter-clockwise
  // here. Rotate about the cell centre so the footprint stays put.
  const cx = 0.5, cy = 0.5;
  let px = x - cx, py = y - cy;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) {
    const nx = -py, ny = px;      // +90 deg CCW in world space
    px = nx; py = ny;
  }
  return [px + cx, py + cy];
}

/**
 * Set a fixture's density so the body ends up with the intended mass in kg,
 * whatever the shape's actual area is. Doing it by measurement means a
 * triangular plow weighs what parts.js says it weighs, not half of it.
 *
 * planck's getMassData FILLS an output object rather than returning one.
 */
export function setFixtureMass(planck, fixture, kg) {
  const md = { mass: 0, center: new planck.Vec2(0, 0), I: 0 };
  fixture.getMassData(md);
  if (md.mass > 1e-6) fixture.setDensity(kg / md.mass);   // density 1 => mass == area
}

/**
 * @param {planck.World} world
 * @param {object} vehicle          normalized vehicle
 * @param {{x:number,y:number}} spawn   world position of the vehicle's bottom centre
 */
export function buildVehicle(planck, world, vehicle, spawn = { x: 0, y: 0 }) {
  const { Vec2, Box, Circle, Polygon, WheelJoint } = planck;
  const b = vehicleBoundsCells(vehicle);
  const anchorX = b.x + b.w / 2;      // horizontal centre, in cells
  const anchorY = b.y + b.h;          // bottom edge, in cells

  // Cell coords (y down) -> vehicle-local metres (y up).
  const lx = (cellX) => (cellX - anchorX) * M;
  const ly = (cellY) => (anchorY - cellY) * M;

  const chassis = world.createBody({
    type: 'dynamic',
    position: new Vec2(spawn.x, spawn.y),
    angularDamping: 0.6,      // stops the hull spinning like a top mid-air
  });

  // Hull sprites ride the chassis transform; wheel sprites ride their own body
  // so they visibly spin and move with the suspension.
  const hullRender = [];
  const wheelRender = [];
  const thrusters = [];
  const wings = [];
  const specials = [];
  const wheels = [];
  let structuralFixtures = 0;

  for (const p of vehicle.parts) {
    const part = getPart(p.t);
    if (!part) continue;
    const rot = p.r || 0;
    const { w, h } = partSize(part, rot);

    const sprite = {
      art: part.art, rot,
      cx: lx(p.x + w / 2), cy: ly(p.y + h / 2),
      w: w * M, h: h * M,
      part,
    };

    if (part.role === 'wheel' || part.role === 'tread') {
      // A tread is one shell over two driven contact patches: the shell is
      // rigid on the hull, the two wheels inside it are hidden.
      const seats = part.role === 'tread'
        ? [[p.x + 0.5, p.y + 0.5], [p.x + 1.5, p.y + 0.5]]
        : [[p.x + w / 2, p.y + h / 2]];
      for (const [cellX, cellY] of seats) {
        const wheel = makeWheel(planck, world, chassis, part, spawn,
          lx(cellX), ly(cellY), part.mass / seats.length);
        wheels.push(wheel);
        if (part.role !== 'tread') wheelRender.push({ ...sprite, body: wheel.body });
      }
      if (part.role === 'tread') hullRender.push(sprite);
      continue;
    }

    hullRender.push(sprite);

    // Everything else is welded into the hull.
    const outline = SHAPES[part.id];
    let shape;
    if (outline) {
      shape = new Polygon(outline.map((pt) => {
        const [rx, ry] = rotatePoint(pt, rot);
        return new Vec2(lx(p.x + rx), ly(p.y + h) + ry * M);
      }));
    } else {
      shape = new Box(w * M / 2, h * M / 2,
        new Vec2(lx(p.x + w / 2), ly(p.y + h / 2)), 0);
    }

    const fx = chassis.createFixture({
      shape,
      density: 1,
      friction: part.friction ?? 0.4,
      restitution: part.restitution ?? 0.05,
      filterGroupIndex: SELF_GROUP,
    });
    setFixtureMass(planck, fx, part.mass);
    structuralFixtures++;

    if (part.thrust) {
      const dir = rotateDir(planck, part.pushDir || [1, 0], rot);
      const centre = new Vec2(lx(p.x + w / 2), ly(p.y + h / 2));
      thrusters.push({ part, point: centre, dir, ...nozzleOf(planck, centre, dir, w, h) });
    }
    if (part.wing) {
      wings.push({ part, point: new Vec2(lx(p.x + w / 2), ly(p.y + h / 2)) });
    }
    if (part.special) {
      // Specials rotate too, so a boost can be mounted to fire in any
      // direction and a hop can be aimed sideways.
      const centre = new Vec2(lx(p.x + w / 2), ly(p.y + h / 2));
      const dir = rotateDir(planck, part.pushDir || [1, 0], rot);
      specials.push({
        part, ...part.special, cooldownLeft: 0, activeFor: 0,
        point: centre, dir, ...nozzleOf(planck, centre, dir, w, h),
      });
    }
  }

  // A vehicle of nothing but wheels would leave the hull massless and break the
  // solver. Give it a token core rather than crashing on a silly build.
  if (structuralFixtures === 0) {
    const fx = chassis.createFixture({
      shape: new Box(0.08, 0.08), density: 1, filterGroupIndex: SELF_GROUP,
    });
    setFixtureMass(planck, fx, 2);
  }

  chassis.resetMassData();

  return { chassis, wheels, thrusters, wings, specials, hullRender, wheelRender, bounds: b };
}

/**
 * Where a thruster's exhaust leaves the part, and which way it goes: the
 * trailing edge of the footprint, opposite the direction of thrust.
 */
function nozzleOf(planck, centre, dir, w, h) {
  const { Vec2 } = planck;
  const exhaust = new Vec2(-dir.x, -dir.y);
  const halfSpan = (Math.abs(dir.x) ? w : h) * M / 2;
  return {
    exhaust,
    nozzle: new Vec2(centre.x + exhaust.x * halfSpan, centre.y + exhaust.y * halfSpan),
  };
}

function makeWheel(planck, world, chassis, part, spawn, localX, localY, kg) {
  const { Vec2, Circle, WheelJoint } = planck;
  const radius = part.wheel.radius * M;

  const body = world.createBody({
    type: 'dynamic',
    position: new Vec2(spawn.x + localX, spawn.y + localY),
  });
  const fx = body.createFixture({
    shape: new Circle(radius),
    density: 1,
    friction: part.wheel.friction,
    restitution: 0.02,
    filterGroupIndex: SELF_GROUP,
  });
  setFixtureMass(planck, fx, kg);
  body.resetMassData();

  const joint = world.createJoint(new WheelJoint({
    enableMotor: true,
    motorSpeed: 0,
    maxMotorTorque: part.wheel.motorTorque,
    frequencyHz: part.wheel.suspHz,
    dampingRatio: part.wheel.suspDamp,
  }, chassis, body, body.getPosition(), new Vec2(0, 1)));

  return {
    body, joint, part, radius,
    baseFriction: part.wheel.friction,
    maxSpeed: part.wheel.motorSpeed,
    fixture: fx,
  };
}
