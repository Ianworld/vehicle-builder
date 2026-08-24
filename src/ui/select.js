// Race setup: pick a vehicle for each player, pick a track, go.

import { TRACKS } from '../game/track.js';
import { renderVehicleThumb } from './thumb.js';
import { renderTrackCard } from './trackcard.js';

/**
 * The race screen, which is also the app's home. Everything a player needs is
 * reachable from here -- build, edit and pick -- so the garage is an optional
 * bulk-editing detour rather than a place you must pass through to start.
 *
 * @param {object} p
 * @param {{pickIds?:string[], trackId?:string}} [p.initial] restores the
 *   selection after a trip through the builder.
 * @param {(playerIndex:number, state:object)=>void} p.onNew
 * @param {(vehicle:object, playerIndex:number, state:object)=>void} p.onEdit
 */
export function createSelect({ mount, planck, vehicles, initial, onStart, onGarage, onNew, onEdit }) {
  const byId = (id) => vehicles.find((v) => v.id === id);
  // Default to two different vehicles so the first race is never a mirror match.
  const picks = [
    byId(initial?.pickIds?.[0]) || vehicles[0],
    byId(initial?.pickIds?.[1]) || vehicles[1] || vehicles[0],
  ];
  let trackId = TRACKS.some((t) => t.id === initial?.trackId) ? initial.trackId : TRACKS[0].id;
  const state = () => ({ pickIds: picks.map((v) => v && v.id), trackId });

  mount.innerHTML = `
    <div class="screen select">
      <header class="topbar">
        <h1>🏁 Race</h1>
        <span class="spacer"></span>
        <button class="btn" data-act="garage"><b class="ico">🏠</b> Garage</button>
        <button class="btn primary" data-act="start"><b class="ico">🏁</b> Start</button>
      </header>
      <div class="selBody">
        <div class="secHead"><b>🚚</b><span>Pick your vehicles</span></div>
        <div class="pickers">
        <div class="picker" data-player="0">
          <div class="phead p1"><i>1</i> Player 1</div>
          <div class="chosen" id="chosen0"></div>
          <div class="chosenActions">
            <button class="btn" data-edit="0"><b class="ico">🔧</b><span class="elabel">Edit</span></button>
          </div>
          <div class="choices" id="choices0"></div>
        </div>
        <div class="picker" data-player="1">
          <div class="phead p2"><i>2</i> Player 2</div>
          <div class="chosen" id="chosen1"></div>
          <div class="chosenActions">
            <button class="btn" data-edit="1"><b class="ico">🔧</b><span class="elabel">Edit</span></button>
          </div>
          <div class="choices" id="choices1"></div>
        </div>
        </div>
      </div>
      <div class="trackSection">
        <div class="secHead"><b>🏁</b><span>Pick a track</span></div>
        <div class="tracks" id="tracks"></div>
      </div>
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
    // Editing a built-in rival makes your own copy rather than overwriting it,
    // so the rivals are always there to race against.
    const label = mount.querySelector(`[data-edit="${p}"] .elabel`);
    if (label) label.textContent = v.starter ? 'Copy & Edit' : 'Edit';
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
    // Build a brand new vehicle without going to the garage first.
    const add = document.createElement('button');
    add.className = 'vchip addChip';
    add.dataset.new = String(p);
    add.innerHTML = '<i>+</i><span>New</span>';
    host.appendChild(add);
  }

  // Each track shows a real render of its most interesting stretch, built from
  // the actual world -- a picture of the thing beats a name you cannot read.
  $('#tracks').innerHTML = TRACKS.map((t) => `
    <button class="trackChip" data-track="${t.id}">
      <span class="tprofile"></span>
      <span class="tmeta"><b>${t.name}</b><span>${t.blurb}</span></span>
    </button>`).join('');

  mount.querySelectorAll('.trackChip').forEach((chip) => {
    const track = TRACKS.find((t) => t.id === chip.dataset.track);
    chip.querySelector('.tprofile').appendChild(renderTrackCard(planck, track, 150, 78));
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

    const add = e.target.closest('[data-new]');
    if (add) { onNew?.(+add.dataset.new, state()); return; }

    const ed = e.target.closest('[data-edit]');
    if (ed) { const i = +ed.dataset.edit; onEdit?.(picks[i], i, state()); return; }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'garage') onGarage?.(state());
    if (act === 'start') onStart?.({
      trackId,
      state: state(),
      entries: picks.map((v) => ({ vehicle: v, label: v.name })),
    });
  };
  mount.addEventListener('click', onClick);

  [0, 1].forEach((p) => { renderChosen(p); renderChoices(p); });
  renderTracks();

  // #app is shared by every screen; an un-removed handler keeps firing later.
  return { destroy() { mount.removeEventListener('click', onClick); } };
}
