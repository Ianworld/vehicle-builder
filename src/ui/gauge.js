// The tilt gauge: a protractor wedge showing how steep a slope a vehicle holds.
//
// Shared deliberately. The builder shows a PREDICTION of this number and the
// Tilt Test track then measures it for real, so the two must look identical --
// if they were drawn by two different bits of code they would drift, and the
// whole point is that the child recognises the same picture in both places.

export const RATING_COLOUR = {
  good: '#46b04a', ok: '#ffd23e', bad: '#e0454f', none: '#8a95ab',
};

const INK = '#12141c';

/**
 * Draw a protractor wedge filled from flat to `angle`.
 *
 * Drawn in CSS pixels into an already-dpr-scaled context, with the pivot at the
 * bottom-left so the wedge opens the same way a ramp does. Angles in radians.
 *
 * @param {object} o
 * @param {number} o.angle    the measured/predicted angle
 * @param {number} [o.max]    full-scale (default 60 deg)
 * @param {string} [o.rating] 'good' | 'ok' | 'bad' | 'none'
 * @param {number} [o.best]   ghost tick to beat, or 0 for none
 * @param {boolean} [o.wobble] degenerate vehicle: show a shrug, not a score
 */
export function drawTiltGauge(ctx, w, h, o) {
  const max = o.max ?? Math.PI / 3;
  const pad = 3;
  // Fit the wedge to whichever axis runs out first at full scale.
  const r = Math.min(w - pad * 2, (h - pad * 2) / Math.sin(max));
  const ox = pad;
  const oy = h - pad;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Full-scale backdrop, so the wedge is read against how far it COULD go.
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.arc(ox, oy, r, 0, -max, true);
  ctx.closePath();
  ctx.fillStyle = 'rgba(130,155,205,.16)';
  ctx.fill();

  if (o.wobble) {
    // A single-wheel vehicle has a real answer of ~0 degrees, which reads as a
    // broken gauge. Say "this isn't a tipping question" instead of scoring it.
    ctx.strokeStyle = RATING_COLOUR.none;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const a = -max * 0.5 + Math.sin(t * Math.PI * 3) * 0.22;
      const p = [ox + Math.cos(a) * r * t, oy + Math.sin(a) * r * t];
      i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  const a = Math.max(0, Math.min(max, o.angle || 0));

  // The measured wedge.
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.arc(ox, oy, r, 0, -a, true);
  ctx.closePath();
  ctx.fillStyle = RATING_COLOUR[o.rating] || RATING_COLOUR.none;
  ctx.fill();

  // The ramp face itself, thickened -- this is the line the eye actually reads.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + Math.cos(-a) * r, oy + Math.sin(-a) * r);
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + r, oy);
  ctx.stroke();

  // Ghost tick at the session best: the no-text way to say "beat this".
  if (o.best > 0.01 && Math.abs(o.best - a) > 0.02) {
    const b = Math.min(max, o.best);
    ctx.strokeStyle = '#f4f7fc';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(ox + Math.cos(-b) * r * 0.55, oy + Math.sin(-b) * r * 0.55);
    ctx.lineTo(ox + Math.cos(-b) * r, oy + Math.sin(-b) * r);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

/** Size a canvas for the device pixel ratio and return a CSS-pixel context. */
export function fitCanvas(cv, w, h) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return c;
}
