// Compact vehicle <-> URL-safe string.
//
// A vehicle is a few dozen parts, so a share link needs no bit-packing to fit
// in a URL -- a positional array plus base64url is small enough and far less
// likely to have an encoding bug we discover a year later via a dead link.
//
// Format: [version, name, [[partIndex, x, y, rot], ...]]

import { CODEC_ORDER, PART_BY_ID } from './parts.js';
import { normalize, newId } from './vehicle.js';

const CODEC_VERSION = 1;

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeVehicle(vehicle) {
  const parts = [];
  for (const p of vehicle.parts) {
    const idx = CODEC_ORDER.indexOf(p.t);
    if (idx < 0) continue;   // part retired since this was saved
    parts.push([idx, p.x, p.y, p.r || 0]);
  }
  const payload = JSON.stringify([CODEC_VERSION, vehicle.name || '', parts]);
  return toBase64Url(new TextEncoder().encode(payload));
}

/** Returns a normalized vehicle, or null if the code is unreadable. */
export function decodeVehicle(code) {
  try {
    const json = new TextDecoder().decode(fromBase64Url(code));
    const [version, name, parts] = JSON.parse(json);
    if (version !== CODEC_VERSION || !Array.isArray(parts)) return null;
    return normalize({
      id: newId(),
      name,
      parts: parts.map(([idx, x, y, r]) => ({ t: CODEC_ORDER[idx], x, y, r })).
        filter((p) => PART_BY_ID[p.t]),
    });
  } catch {
    return null;
  }
}
