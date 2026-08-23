// Shared geometry helpers. Lives apart from vehicle.js so the physics builder
// and the thumbnail renderer can use it without pulling in either one.

import { getPart, partSize } from './parts.js';

/** Bounding box of a vehicle's parts, in grid cells. */
export function vehicleBoundsCells(vehicle) {
  if (!vehicle.parts.length) return { x: 0, y: 0, w: 1, h: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of vehicle.parts) {
    const { w, h } = partSize(getPart(p.t), p.r || 0);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + w); y1 = Math.max(y1, p.y + h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
