// Garage persistence.
//
// GitHub Pages is static, so the browser is the only place a vehicle can live.
// That makes durability the whole job here:
//
//   IndexedDB    primary store. localStorage is the obvious reach and it is the
//                wrong one -- mobile browsers routinely clear it under storage
//                pressure, which is a well-known way HTML5 games lose saves.
//   persist()    asks the browser to exempt this origin from eviction outright.
//   localStorage kept as a cheap redundant mirror. Vehicles are tiny, and it
//                covers IndexedDB being blocked (private mode, odd embeds).
//   export       the honest backup, since browser storage is per-device no
//                matter how durable we make it. Lives in share.js.
//
// Keys are namespaced because <user>.github.io is ONE origin shared by every
// repo the user hosts there.

import { normalize } from './vehicle.js';

const DB_NAME = 'vb-garage';
const DB_VERSION = 1;
const STORE = 'vehicles';
const MIRROR_KEY = 'vb:garage:v1';

let dbPromise = null;
let state = { idb: 'unknown', persisted: false, lastError: null };

export const storageState = () => ({ ...state });

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err); return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexeddb blocked'));
  }).catch((err) => {
    state.idb = 'unavailable';
    state.lastError = String(err);
    dbPromise = null;      // let a later call retry
    throw err;
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ------------------------------------------------------------------ mirror

function readMirror() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalize) : [];
  } catch {
    return [];
  }
}

function writeMirror(vehicles) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(vehicles));
    return true;
  } catch {
    return false;   // quota or disabled; IndexedDB is still the real store
  }
}

// -------------------------------------------------------------------- API

/**
 * Open the database and ask for persistent storage. Safe to call repeatedly.
 * Never throws -- a browser with no IndexedDB still gets a working garage.
 */
export async function initStorage() {
  try {
    await openDb();
    state.idb = 'ok';
  } catch {
    state.idb = 'unavailable';
  }

  await reconcile();

  if (navigator.storage?.persist) {
    try {
      state.persisted = await navigator.storage.persisted?.() || false;
      if (!state.persisted) state.persisted = await navigator.storage.persist();
    } catch {
      state.persisted = false;
    }
  }
  return storageState();
}

/**
 * Make both stores agree.
 *
 * Without this, recovery is one-directional: a wiped localStorage would be read
 * around silently and never refilled, leaving the garage on a single copy while
 * still reporting healthy. Run once at boot -- vehicles are tiny, so writing
 * the whole set back is cheaper than tracking deltas.
 */
async function reconcile() {
  const merged = await listVehicles();
  if (!merged.length) return;

  writeMirror(merged);

  if (state.idb !== 'unavailable') {
    try {
      const db = await openDb();
      const have = new Set(((await tx(db, 'readonly', (s) => s.getAll())) || []).map((v) => v.id));
      const missing = merged.filter((v) => !have.has(v.id));
      if (missing.length) {
        await tx(db, 'readwrite', (store) => { for (const v of missing) store.put(v); });
      }
    } catch (err) {
      state.lastError = String(err);
    }
  }
}

/**
 * Everything in the garage, newest first.
 *
 * Reads BOTH stores and merges by id, preferring whichever copy was modified
 * last. That is what lets the mirror actually rescue you: if IndexedDB is wiped
 * the localStorage copies simply win, and the next save writes them back.
 */
export async function listVehicles() {
  const merged = new Map();
  for (const v of readMirror()) merged.set(v.id, v);

  if (state.idb !== 'unavailable') {
    try {
      const db = await openDb();
      const rows = await tx(db, 'readonly', (s) => s.getAll());
      for (const raw of rows || []) {
        const v = normalize(raw);
        const prev = merged.get(v.id);
        if (!prev || v.modified >= prev.modified) merged.set(v.id, v);
      }
      state.idb = 'ok';
    } catch (err) {
      state.idb = 'unavailable';
      state.lastError = String(err);
    }
  }

  return [...merged.values()].sort((a, b) => b.modified - a.modified);
}

export async function getVehicle(id) {
  return (await listVehicles()).find((v) => v.id === id) || null;
}

/** @returns {'saved'|'local-only'|'failed'} */
export async function saveVehicle(vehicle) {
  const v = normalize({ ...vehicle, modified: Date.now() });
  let idbOk = false;

  if (state.idb !== 'unavailable') {
    try {
      const db = await openDb();
      await tx(db, 'readwrite', (s) => s.put(v));
      idbOk = true;
      state.idb = 'ok';
    } catch (err) {
      state.idb = 'unavailable';
      state.lastError = String(err);
    }
  }

  // Mirror always reflects the full garage, so it can stand alone if needed.
  const all = await listVehicles();
  const byId = new Map(all.map((x) => [x.id, x]));
  byId.set(v.id, v);
  const mirrorOk = writeMirror([...byId.values()]);

  if (idbOk) return 'saved';
  return mirrorOk ? 'local-only' : 'failed';
}

export async function deleteVehicle(id) {
  if (state.idb !== 'unavailable') {
    try {
      const db = await openDb();
      await tx(db, 'readwrite', (s) => s.delete(id));
    } catch (err) {
      state.lastError = String(err);
    }
  }
  writeMirror((await listVehicles()).filter((v) => v.id !== id));
}

/** Merge imported vehicles in by id. Never silently overwrites a newer copy. */
export async function importVehicles(incoming) {
  const existing = new Map((await listVehicles()).map((v) => [v.id, v]));
  let added = 0, updated = 0, skipped = 0;
  for (const raw of incoming) {
    const v = normalize(raw);
    const prev = existing.get(v.id);
    if (!prev) { await saveVehicle(v); added++; }
    else if (v.modified > prev.modified) { await saveVehicle(v); updated++; }
    else skipped++;
  }
  return { added, updated, skipped };
}
