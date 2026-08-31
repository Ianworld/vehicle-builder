// Thumbnail for a track: a real render of its most interesting stretch.
//
// This builds an actual physics world and draws it with the same renderView the
// race uses, rather than illustrating the track separately. That costs a few
// milliseconds per card and guarantees the picture can never drift from what
// the player will actually drive through.

import { buildTrack, updateFeatures } from '../game/track.js';
import { createWorld } from '../game/physics.js';
import { renderView, makeCamera, PX_PER_M } from './render.js';

const SETTLE_STEPS = 45;   // let rock piles slump into a natural mound first

export function renderTrackCard(planck, track, w, h, opts = {}) {
  const zoom = opts.zoom ?? track.cardZoom ?? 0.30;
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = w * dpr;
  cv.height = h * dpr;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);

  let world = null;
  try {
    world = createWorld(planck);
    const build = buildTrack(planck, world, track);
    for (let i = 0; i < SETTLE_STEPS; i++) {
      // Same order as the race: feature forces first, then solve. Without this
      // a prop resting in water would sink through the floor on the card.
      updateFeatures(build, 1 / 60);
      world.step(1 / 60);
    }

    const focus = track.showcase ?? track.length / 2;
    const cam = makeCamera();
    cam.zoom = zoom;
    cam.groundLine = 0.62;
    // project() pins the camera to 34% across the viewport; nudge so the
    // feature itself lands in the middle of the card.
    cam.x = focus - (0.5 - 0.34) * w / (PX_PER_M * zoom);
    cam.y = track.height(focus) + 1.1;

    renderView({ ctx, vw: w, vh: h }, cam, build, []);
  } catch (err) {
    // A card is decoration; never let one stop the race screen loading.
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, w, h);
    console.warn('track card failed for', track.id, err);
  }
  return cv;
}
