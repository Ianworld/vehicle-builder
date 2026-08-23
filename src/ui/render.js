// Draws a physics world: sky, terrain, props, vehicles.
//
// At zoom 1 the mapping is exact: one grid cell is 0.5 m and 32 px, so
// PX_PER_M is 64 and every sprite lands on whole pixels.

import { spriteCanvas } from '../art/atlas.js';
import { M } from '../game/build.js';
import { CELL } from '../game/parts.js';

export const PX_PER_M = CELL / M;   // 64

export function makeCamera() {
  return { x: 0, y: 0, zoom: 1, groundLine: 0.68 };
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
  for (const seg of trackBuild.segments) {
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
    ctx.fillStyle = '#2b3a2c';
    ctx.fill();

    // Grass cap
    ctx.beginPath();
    started = false;
    for (const [x, y] of seg) {
      const px = p.sx(x), py = p.sy(y);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#46b04a';
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

function blit(ctx, sprite, p, wx, wy, angle, wMeters, hMeters) {
  const img = spriteCanvas(sprite.art, sprite.rot, 1);
  ctx.save();
  ctx.translate(p.sx(wx), p.sy(wy));
  ctx.rotate(-angle);                     // canvas y is down, planck y is up
  const w = wMeters * p.s, h = hMeters * p.s;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export function drawRacer(ctx, p, racer) {
  const body = racer.chassis;
  const pos = body.getPosition();
  const ang = body.getAngle();
  const cos = Math.cos(ang), sin = Math.sin(ang);

  // Wheels first so the hull overlaps them.
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
  const p = project(cam, vw, vh);
  drawTerrain(ctx, p, vw, vh, trackBuild);
  drawFinish(ctx, p, trackBuild.length, vh);
  drawProps(ctx, p, trackBuild.props);
  for (const r of racers) drawRacer(ctx, p, r);

  ctx.restore();
}
