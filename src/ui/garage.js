// The garage: every saved vehicle, plus the backup and share affordances that
// static hosting makes mandatory.

import * as store from '../game/storage.js';
import * as share from '../game/share.js';
import * as V from '../game/vehicle.js';
import { renderVehicleThumb } from './thumb.js';

export function createGarage({ mount, onEdit, onNew, onRace }) {
  mount.innerHTML = `
    <div class="screen garage">
      <header class="topbar">
        <h1>My Garage</h1>
        <span class="spacer"></span>
        <button class="btn" data-act="import">Import</button>
        <button class="btn" data-act="export">Backup</button>
        <button class="btn" data-act="new">+ New Vehicle</button>
        <button class="btn primary" data-act="race">Race ▸</button>
      </header>
      <div class="storage-note" id="snote"></div>
      <div class="cards" id="cards"></div>
    </div>`;

  const $ = (s) => mount.querySelector(s);
  let vehicles = [];

  function storageNote() {
    const st = store.storageState();
    const el = $('#snote');
    if (st.idb === 'unavailable') {
      el.className = 'storage-note warn';
      el.textContent = 'This browser is blocking its database, so vehicles are saved in a less durable way. Use Backup to keep a copy.';
    } else if (!st.persisted) {
      el.className = 'storage-note';
      el.textContent = 'Saved in this browser. It should stick around, but Backup gives you a copy you can keep or move to another device.';
    } else {
      el.className = 'storage-note ok';
      el.textContent = 'Saved in this browser with persistent storage granted — these will survive restarts.';
    }
  }

  async function refresh() {
    vehicles = await store.listVehicles();
    storageNote();
    const host = $('#cards');
    host.innerHTML = '';

    if (!vehicles.length) {
      host.innerHTML = `<div class="empty">
        <p>No vehicles yet.</p>
        <button class="btn primary big" data-act="new">Build your first one</button>
        <p class="hint">Or hit <b>Race</b> to try the built-in rivals.</p>
      </div>`;
      return;
    }

    for (const v of vehicles) {
      const stats = V.stats(v);
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="thumb"></div>
        <div class="cname"></div>
        <div class="cbars">
          <i title="Speed"><s style="width:${(stats.speed * 100) | 0}%"></s></i>
          <i title="Grip"><s class="g" style="width:${(stats.grip * 100) | 0}%"></s></i>
          <i title="Weight"><s class="w" style="width:${(stats.weight * 100) | 0}%"></s></i>
        </div>
        <div class="crow">
          <button class="btn" data-edit="${v.id}">Edit</button>
          <button class="btn" data-share="${v.id}">Share</button>
          <button class="btn danger" data-del="${v.id}">Delete</button>
        </div>`;
      card.querySelector('.thumb').appendChild(renderVehicleThumb(v, 220, 130));
      card.querySelector('.cname').textContent = v.name;
      host.appendChild(card);
    }
  }

  function toast(msg, kind = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    mount.querySelector('.screen').appendChild(t);
    setTimeout(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2600);
  }

  const onClick = async (e) => {
    const el = e.target.closest('button');
    if (!el) return;

    if (el.dataset.edit) { onEdit?.(vehicles.find((v) => v.id === el.dataset.edit)); return; }

    if (el.dataset.del) {
      const v = vehicles.find((x) => x.id === el.dataset.del);
      if (v && confirm(`Delete "${v.name}"? This cannot be undone.`)) {
        await store.deleteVehicle(v.id);
        await refresh();
      }
      return;
    }

    if (el.dataset.share) {
      const v = vehicles.find((x) => x.id === el.dataset.share);
      const url = share.shareUrlFor(v);
      const ok = await share.copyText(url);
      toast(ok ? 'Share link copied to clipboard' : url, ok ? 'ok' : 'warn');
      return;
    }

    const act = el.dataset.act;
    if (act === 'new') onNew?.();
    if (act === 'race') onRace?.();
    if (act === 'export') {
      if (!vehicles.length) { toast('Nothing to back up yet', 'warn'); return; }
      share.downloadGarage(vehicles);
      toast('Downloaded garage.json');
    }
    if (act === 'import') {
      const file = await share.pickGarageFile();
      if (!file) return;
      try {
        const list = await share.readGarageFile(file);
        const res = await store.importVehicles(list);
        await refresh();
        toast(`Imported: ${res.added} new, ${res.updated} updated, ${res.skipped} unchanged`);
      } catch (err) {
        toast(String(err.message || err), 'warn');
      }
    }
  };
  mount.addEventListener('click', onClick);

  refresh();
  // #app is shared by every screen, so a handler that is never removed keeps
  // firing for the screens that come after it.
  return { refresh, destroy() { mount.removeEventListener('click', onClick); } };
}
