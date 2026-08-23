// One pointer path for touch and mouse.
//
// Everything goes through Pointer Events, so there is no separate touch branch
// to get out of sync -- which is most of what makes a builder feel right on a
// tablet AND a laptop. No hover-dependent affordances exist anywhere in the UI
// for the same reason.

/**
 * @param {HTMLElement} el
 * @param {object} h
 * @param {(p:{x,y,id})=>void}   [h.onDown]
 * @param {(p:{x,y,id,dx,dy})=>void} [h.onMove]
 * @param {(p:{x,y,id})=>void}   [h.onUp]
 * @param {(g:{cx,cy,dScale,dx,dy})=>void} [h.onPinch]  two-finger zoom/pan
 * @param {(g:{cx,cy,dScale})=>void}       [h.onWheel]
 * @returns {() => void} unbind
 */
export function bindPointer(el, h = {}) {
  const active = new Map();
  let pinch = null;

  const local = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId };
  };

  const pinchState = () => {
    const [a, b] = [...active.values()];
    const dx = b.x - a.x, dy = b.y - a.y;
    return { dist: Math.hypot(dx, dy) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };

  function onDown(e) {
    // Only primary mouse button paints; right/middle are reserved for panning.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    el.setPointerCapture?.(e.pointerId);
    active.set(e.pointerId, local(e));

    if (active.size === 2) {
      pinch = pinchState();
      h.onCancel?.();        // a second finger means the drag was really a pinch
    } else if (active.size === 1) {
      h.onDown?.(active.get(e.pointerId));
    }
  }

  function onMove(e) {
    if (!active.has(e.pointerId)) return;
    const prev = active.get(e.pointerId);
    const cur = local(e);
    active.set(e.pointerId, cur);

    if (active.size >= 2 && pinch) {
      const next = pinchState();
      h.onPinch?.({
        cx: next.cx, cy: next.cy,
        dScale: next.dist / pinch.dist,
        dx: next.cx - pinch.cx,
        dy: next.cy - pinch.cy,
      });
      pinch = next;
    } else if (active.size === 1) {
      h.onMove?.({ ...cur, dx: cur.x - prev.x, dy: cur.y - prev.y });
    }
  }

  function onUp(e) {
    if (!active.has(e.pointerId)) return;
    const p = active.get(e.pointerId);
    active.delete(e.pointerId);
    el.releasePointerCapture?.(e.pointerId);
    if (active.size < 2) pinch = null;
    if (active.size === 0) h.onUp?.(p);
  }

  function onWheel(e) {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    h.onWheel?.({
      cx: e.clientX - r.left,
      cy: e.clientY - r.top,
      // Trackpads report tiny deltas and mice report ~100; normalizing by a
      // fixed divisor keeps both feeling similar.
      dScale: Math.exp(-e.deltaY / 400),
    });
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('wheel', onWheel);
  };
}
