// The rival vehicles that ship with the site.
//
// Static JSON in the repo, fetched read-only, so a brand-new browser with an
// empty garage still has something to race against. Resolved against
// import.meta.url rather than a page-relative path, because the site is served
// from a GitHub Pages subpath.

import { normalize } from './vehicle.js';

const FILES = ['plodder', 'hopper', 'spike'];

let cache = null;

export async function loadStarters() {
  if (cache) return cache;
  const out = [];
  for (const name of FILES) {
    try {
      const url = new URL(`../../starter-vehicles/${name}.json`, import.meta.url);
      const res = await fetch(url);
      if (!res.ok) continue;
      const v = normalize(await res.json());
      v.starter = true;             // set after normalize, which drops extras
      out.push(v);
    } catch {
      // A missing starter is not worth breaking the garage over.
    }
  }
  cache = out;
  return out;
}
