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
import { getPref, setPref } from './game/prefs.js';

const app = document.getElementById('app');
let current = null;

function swap(factory) {
  current?.destroy?.();
  app.innerHTML = '';
  current = factory(app);
  // Handle for debugging from the console.
  window.__vb = current;
}

/**
 * Last race-screen selection: both picks and the track.
 *
 * Persisted, not just held in memory. In memory it survived every trip through
 * the garage and builder but not a page reload, so every fresh visit went back
 * to the defaults. createSelect already falls back to the defaults for an id
 * that no longer exists, so a deleted vehicle cannot strand a stale pick.
 */
let selection = getPref('selection', null);

function remember(state) {
  selection = state;
  setPref('selection', state);
}

function showGarage() {
  swap((mount) => createGarage({
    mount,
    onNew: () => showBuilder(V.emptyVehicle(), { back: showGarage }),
    onEdit: (v) => showBuilder(v, { back: showGarage }),
    onRace: () => showSelect(selection),
  }));
}

/** Saved vehicles plus the built-in rivals, so racing works on a fresh browser. */
async function raceRoster() {
  const saved = await store.listVehicles();
  const starters = await loadStarters();
  const seen = new Set(saved.map((v) => v.id));
  return [...saved, ...starters.filter((v) => !seen.has(v.id))];
}

async function showSelect(initial) {
  const vehicles = await raceRoster();
  swap((mount) => createSelect({
    mount, vehicles, initial,
    planck: window.planck,
    onChange: remember,
    onGarage: (state) => { remember(state); showGarage(); },
    onStart: (cfg) => { remember(cfg.state); showRace(cfg); },

    // Build a new vehicle straight from the race screen, and come back with it
    // already picked for that player.
    onNew: (playerIndex, state) => {
      remember(state);
      const v = V.emptyVehicle();
      showBuilder(v, { back: () => showSelect(withPick(state, playerIndex, v.id)) });
    },

    // Editing a built-in rival edits YOUR COPY of it. The rivals have to stay
    // available to race against, and a fresh browser has nothing else.
    onEdit: (vehicle, playerIndex, state) => {
      remember(state);
      const v = vehicle.starter
        ? { ...V.clone(vehicle), id: V.newId(), name: vehicle.name + ' copy', starter: false }
        : vehicle;
      showBuilder(v, { back: () => showSelect(withPick(state, playerIndex, v.id)) });
    },
  }));
}

const withPick = (state, i, id) => {
  const pickIds = [...(state?.pickIds || [])];
  pickIds[i] = id;
  return { ...state, pickIds };
};

function showRace(cfg) {
  swap((mount) => createRace({
    mount,
    planck: window.planck,
    trackId: cfg.trackId,
    entries: cfg.entries,
    onExit: () => showSelect(selection),
    onAgain: () => showRace(cfg),
  }));
}

function showBuilder(vehicle, { back } = {}) {
  swap((mount) => createBuilder({
    mount,
    vehicle,
    onExit: back || showGarage,
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
    showBuilder(shared, { back: () => showSelect(selection) });
    return;
  }
  // The race screen is home: it is what a player actually wants to do, and
  // everything else is reachable from it.
  showSelect(selection);
}

boot();
