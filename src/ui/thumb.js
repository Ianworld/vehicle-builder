// Renders a whole vehicle to a small canvas, cropped to its parts. Used by the
// garage cards and later by the race select screen.

import { CELL, getPart, partSize } from '../game/parts.js';
import { spriteCanvas } from '../art/atlas.js';
import { vehicleBoundsCells } from '../game/geometry.js';

export function renderVehicleThumb(vehicle, boxW, boxH, { pad = 6 } = {}) {
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = boxW * dpr; cv.height = boxH * dpr;
  cv.style.width = boxW + 'px'; cv.style.height = boxH + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  if (!vehicle.parts.length) return cv;

  const b = vehicleBoundsCells(vehicle);
  const scale = Math.min((boxW - pad * 2) / (b.w * CELL), (boxH - pad * 2) / (b.h * CELL));
  const ox = (boxW - b.w * CELL * scale) / 2;
  const oy = (boxH - b.h * CELL * scale) / 2;

  for (const p of vehicle.parts) {
    const img = spriteCanvas(getPart(p.t).art, p.r || 0, 1);
    ctx.drawImage(img,
      ox + (p.x - b.x) * CELL * scale,
      oy + (p.y - b.y) * CELL * scale,
      img.width * scale, img.height * scale);
  }
  return cv;
}
