// Boot and screen routing.
//
// The URL hash is reserved for share links (#v=...), so navigation between
// screens is in-memory rather than hash-based. Nothing here uses a root-
// absolute path: this ships to a GitHub Pages SUBPATH, where "/src/..." would
// 404 in production while working fine on localhost.

import { buildAtlas } from './art/atlas.js';
import * as store from './game/storage.js';
import * as share from './game/share.js';
import * as V from './game/vehicle.js';
import { createGarage } from './ui/garage.js';
import { createBuilder } from './ui/builder.js';
import { createSelect } from './ui/select.js';
import { createRace } from './ui/race-ui.js';
import { loadStarters } from './game/starters.js';

const app = document.getElementById('app');
let current = null;

function swap(factory) {
  current?.destroy?.();
  app.innerHTML = '';
  current = factory(app);
  // Handle for debugging from the console.
  window.__vb = current;
}

function showGarage() {
  swap((mount) => createGarage({
    mount,
    onNew: () => showBuilder(V.emptyVehicle()),
    onEdit: (v) => showBuilder(v),
    onRace: showSelect,
  }));
}

/** Saved vehicles plus the built-in rivals, so racing works on a fresh browser. */
async function raceRoster() {
  const saved = await store.listVehicles();
  const starters = await loadStarters();
  const seen = new Set(saved.map((v) => v.id));
  return [...saved, ...starters.filter((v) => !seen.has(v.id))];
}

async function showSelect() {
  const vehicles = await raceRoster();
  swap((mount) => createSelect({
    mount, vehicles,
    onExit: showGarage,
    onStart: (cfg) => showRace(cfg),
  }));
}

function showRace(cfg) {
  swap((mount) => createRace({
    mount,
    planck: window.planck,
    trackId: cfg.trackId,
    entries: cfg.entries,
    onExit: showGarage,
    onAgain: () => showRace(cfg),
  }));
}

function showBuilder(vehicle) {
  swap((mount) => createBuilder({
    mount,
    vehicle,
    onExit: showGarage,
    onSave: (v) => store.saveVehicle(v),
  }));
}

async function boot() {
  buildAtlas();
  await store.initStorage();

  // A share link beats everything else: someone followed it to see a vehicle.
  const shared = share.vehicleFromHash();
  if (shared) {
    share.clearHash();
    showBuilder(shared);
    return;
  }
  showGarage();
}

boot();
