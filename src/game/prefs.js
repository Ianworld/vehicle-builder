// Tiny persisted preferences.
//
// Namespaced `vb:` like everything else here, because GitHub Pages puts every
// project a user owns on ONE origin (<user>.github.io) and an unprefixed key
// would collide with someone else's app.
//
// Deliberately separate from storage.js: that guards the child's saved
// vehicles, which are the one irreplaceable thing in this app, and session
// preferences have no business sharing a store with them.

const KEY = (k) => `vb:pref:${k}`;

export function getPref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(KEY(key));
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;          // private mode, blocked storage: not worth caring
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(KEY(key), JSON.stringify(value));
  } catch {
    /* nothing here is important enough to interrupt play */
  }
}
