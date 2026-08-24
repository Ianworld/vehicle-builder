// Race setup: pick a vehicle for each player, pick a track, go.

import { TRACKS } from '../game/track.js';
import { renderVehicleThumb } from './thumb.js';

/** A small silhouette of a track's terrain, sampled from its height function. */
function trackProfile(track, w, h) {
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);

  const N = 90;
  const ys = [];
  for (let i = 0; i <= N; i++) ys.push(track.height((i / N) * track.length));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = Math.max(1e-3, hi - lo);
  const yAt = (v) => h - 4 - ((v - lo) / span) * (h - 12);

  ctx.beginPath();
  ctx.moveTo(0, h);
  ys.forEach((v, i) => ctx.lineTo((i / N) * w, yAt(v)));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(70,176,74,.30)';
  ctx.fill();

  ctx.beginPath();
  ys.forEach((v, i) => (i ? ctx.lineTo((i / N) * w, yAt(v)) : ctx.moveTo(0, yAt(v))));
  ctx.strokeStyle = '#5fce63';
  ctx.lineWidth = 2;
  ctx.stroke();

  // finish line
  ctx.fillStyle = '#f4f7fc';
  ctx.fillRect(w - 2, yAt(ys[N]) - 9, 2, 9);
  return cv;
}

export function createSelect({ mount, vehicles, onStart, onExit }) {
  // Default to two different vehicles so the first race is never a mirror match.
  const picks = [vehicles[0], vehicles[1] || vehicles[0]];
  let trackId = TRACKS[0].id;

  mount.innerHTML = `
    <div class="screen select">
      <header class="topbar">
        <button class="btn icon" data-act="exit" title="Back to garage">🏠</button>
        <h1>🏁 Race</h1>
        <span class="spacer"></span>
        <button class="btn primary" data-act="start"><b class="ico">🏁</b> Start</button>
      </header>
      <div class="selBody">
        <div class="picker" data-player="0">
          <div class="phead p1"><i>1</i> Player 1</div>
          <div class="chosen" id="chosen0"></div>
          <div class="choices" id="choices0"></div>
        </div>
        <div class="picker" data-player="1">
          <div class="phead p2"><i>2</i> Player 2</div>
          <div class="chosen" id="chosen1"></div>
          <div class="choices" id="choices1"></div>
        </div>
      </div>
      <div class="tracks" id="tracks"></div>
    </div>`;

  const $ = (s) => mount.querySelector(s);

  function renderChosen(p) {
    const host = $(`#chosen${p}`);
    host.innerHTML = '';
    const v = picks[p];
    host.appendChild(renderVehicleThumb(v, 260, 120));
    const cap = document.createElement('div');
    cap.className = 'cname';
    cap.textContent = v.name + (v.starter ? '  (rival)' : '');
    host.appendChild(cap);
  }

  function renderChoices(p) {
    const host = $(`#choices${p}`);
    host.innerHTML = '';
    for (const v of vehicles) {
      const b = document.createElement('button');
      b.className = 'vchip' + (picks[p].id === v.id ? ' sel' : '');
      b.dataset.pick = `${p}:${v.id}`;
      b.appendChild(renderVehicleThumb(v, 76, 48, { pad: 3 }));
      const s = document.createElement('span');
      s.textContent = v.name;
      b.appendChild(s);
      host.appendChild(b);
    }
  }

  // Each track shows its own elevation profile, drawn from the real height
  // function -- a picture of the course beats a name you cannot read yet.
  $('#tracks').innerHTML = TRACKS.map((t) => `
    <button class="trackChip" data-track="${t.id}">
      <span class="tprofile"></span>
      <span class="tmeta"><b>${t.name}</b><span>${t.blurb}</span></span>
    </button>`).join('');

  mount.querySelectorAll('.trackChip').forEach((chip) => {
    const track = TRACKS.find((t) => t.id === chip.dataset.track);
    chip.querySelector('.tprofile').appendChild(trackProfile(track, 132, 40));
  });

  function renderTracks() {
    mount.querySelectorAll('[data-track]').forEach((el) =>
      el.classList.toggle('on', el.dataset.track === trackId));
  }

  const onClick = (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const [p, id] = pick.dataset.pick.split(':');
      picks[+p] = vehicles.find((v) => v.id === id);
      renderChosen(+p); renderChoices(+p);
      return;
    }
    const tr = e.target.closest('[data-track]');
    if (tr) { trackId = tr.dataset.track; renderTracks(); return; }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'exit') onExit?.();
    if (act === 'start') onStart?.({
      trackId,
      entries: picks.map((v) => ({ vehicle: v, label: v.name })),
    });
  };
  mount.addEventListener('click', onClick);

  [0, 1].forEach((p) => { renderChosen(p); renderChoices(p); });
  renderTracks();

  // #app is shared by every screen; an un-removed handler keeps firing later.
  return { destroy() { mount.removeEventListener('click', onClick); } };
}
