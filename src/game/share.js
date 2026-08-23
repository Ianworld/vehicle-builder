// Getting vehicles in and out of the browser: share links and backup files.
//
// On static hosting these are not nice-to-haves. Browser storage is per-device
// and per-browser however durable we make it, so a file export is the only
// honest backup, and a share link is a third copy that survives any amount of
// cache clearing -- plus it is how a kid sends a truck to a friend with no
// backend at all.

import { encodeVehicle, decodeVehicle } from './codec.js';
import { normalize } from './vehicle.js';

// ------------------------------------------------------------- share links

export function shareUrlFor(vehicle) {
  const url = new URL(window.location.href);
  url.hash = 'v=' + encodeVehicle(vehicle);
  return url.toString();
}

/** A vehicle from the current URL hash, or null. */
export function vehicleFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('v=')) return null;
  return decodeVehicle(hash.slice(2));
}

export function clearHash() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and a user gesture; fall back to the
    // old execCommand path so this still works over plain http on a LAN.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ------------------------------------------------------------ backup files

export function downloadGarage(vehicles) {
  const doc = {
    format: 'vehicle-builder-garage',
    version: 1,
    exported: new Date().toISOString(),
    vehicles: vehicles.map(normalize),
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Accepts a whole-garage export or a bare array of vehicles. */
export async function readGarageFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data
    : Array.isArray(data?.vehicles) ? data.vehicles
    : null;
  if (!list) throw new Error('That file does not look like a garage export.');
  return list.map(normalize);
}

export function pickGarageFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => resolve(input.files?.[0] || null);
    // A cancelled picker fires nothing in most browsers, so the promise simply
    // never settles -- acceptable here since the caller just stops waiting.
    input.click();
  });
}
