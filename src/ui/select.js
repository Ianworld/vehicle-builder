// Race setup: pick a vehicle for each player, pick a track, go.

import { TRACKS } from '../game/track.js';
import { renderVehicleThumb } from './thumb.js';

export function createSelect({ mount, vehicles, onStart, onExit }) {
  // Default to two different vehicles so the first race is never a mirror match.
  const picks = [vehicles[0], vehicles[1] || vehicles[0]];
  let trackId = TRACKS[0].id;

  mount.innerHTML = `
    <div class="screen select">
      <header class="topbar">
        <button class="btn icon" data-act="exit" title="Back to garage">‹</button>
        <h1>Race</h1>
        <span class="spacer"></span>
        <button class="btn primary" data-act="start">Start Race ▸</button>
      </header>
      <div class="selBody">
        <div class="picker" data-player="0">
          <div class="phead p1">Player 1</div>
          <div class="chosen" id="chosen0"></div>
          <div class="choices" id="choices0"></div>
        </div>
        <div class="picker" data-player="1">
          <div class="phead p2">Player 2</div>
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

  $('#tracks').innerHTML = TRACKS.map((t) => `
    <button class="trackChip" data-track="${t.id}">
      <b>${t.name}</b><span>${t.blurb}</span>
    </button>`).join('');

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
