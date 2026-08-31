// The grid builder screen.
//
// Touch-first, which is also the right shape for laptop: one pointer path, no
// hover-dependent affordances, nothing smaller than a thumb. Three explicit
// tools (build / turn / erase) rather than clever gestures -- a long-press
// delete is undiscoverable for a kid and fights with panning.

import { CELL, GRID_W, GRID_H, PARTS, GROUPS, getPart, partSize } from '../game/parts.js';
import * as V from '../game/vehicle.js';
import { spriteCanvas, spriteCopy } from '../art/atlas.js';
import { bindPointer } from './input.js';
import { tiltTest, tiltRating } from '../game/tilt.js';
import { drawTiltGauge, fitCanvas, RATING_COLOUR } from './gauge.js';

const TOOLS = [
  { id: 'build', icon: '🔨', label: 'Build' },
  { id: 'turn',  icon: '↻',  label: 'Turn' },
  { id: 'erase', icon: '✕',  label: 'Rub out' },
];

const TILT_W = 34;
const TILT_H = 30;

export function createBuilder({ mount, vehicle, onExit, onSave }) {
  let veh = V.clone(vehicle);
  let tool = 'build';
  let held = 'block';
  let group = 'structure';
  let undoStack = [];
  let orphans = new Set();
  let painting = null;      // cells already touched during one drag
  let hover = null;         // {x,y} grid cell under the pointer

  const cam = { scale: 1, ox: 0, oy: 0, fitted: false };

  // ------------------------------------------------------------------ DOM
  mount.innerHTML = `
    <div class="screen builder">
      <header class="topbar">
        <button class="btn icon" data-act="exit" title="Back to garage">🏠</button>
        <button class="btn name" data-act="rename"><span id="vname"></span> <em>✎</em></button>
        <span class="spacer"></span>
        <button class="btn primary" data-act="save"><b class="ico">✅</b> Save</button>
      </header>

      <div class="stage"><canvas id="grid"></canvas>
        <div class="warn" id="warn" hidden>Some parts aren't attached!</div>
      </div>

      <div class="meters">
        <div class="meter"><b>⚡</b><em>Speed</em><i><s id="m-speed"></s></i></div>
        <div class="meter"><b>🧲</b><em>Grip</em><i><s id="m-grip"></s></i></div>
        <div class="meter"><b>⚖️</b><em>Weight</em><i><s id="m-weight"></s></i></div>
        <div class="meter tilt"><b>📐</b><em>Tip</em><canvas id="m-tilt"></canvas></div>
      </div>

      <div class="toolbar">
        <div class="tools" id="tools"></div>
        <button class="btn icon" data-act="undo" title="Undo">↶</button>
        <button class="btn icon" data-act="clear" title="Start over">🗑️</button>
        <span class="spacer"></span>
        <button class="btn icon" data-act="zoomout">−</button>
        <button class="btn icon" data-act="fit" title="Fit">⛶</button>
        <button class="btn icon" data-act="zoomin">+</button>
      </div>

      <div class="tray">
        <div class="tabs" id="tabs"></div>
        <div class="parts" id="traylist"></div>
      </div>
    </div>`;

  const $ = (sel) => mount.querySelector(sel);
  const canvas = $('#grid');
  const ctx = canvas.getContext('2d');

  // Tool buttons
  $('#tools').innerHTML = TOOLS.map((t) =>
    `<button class="btn tool" data-tool="${t.id}"><b>${t.icon}</b><span>${t.label}</span></button>`).join('');

  // Tray tabs
  $('#tabs').innerHTML = GROUPS.map((g) =>
    `<button class="tab" data-group="${g.id}"><b>${g.icon}</b><span>${g.label}</span></button>`).join('');

  function renderTray() {
    const list = $('#traylist');
    list.innerHTML = '';
    for (const part of PARTS.filter((p) => p.group === group)) {
      const b = document.createElement('button');
      b.className = 'part' + (held === part.id ? ' sel' : '');
      b.dataset.part = part.id;
      // Thumbnails scale the sprite down to fit a uniform box so a 2x2 wheel
      // and a 1x1 block read at comparable size in the tray.
      const src = spriteCanvas(part.id, 0, 1);
      const box = 46;
      const s = Math.min(box / src.width, box / src.height);
      const cv = document.createElement('canvas');
      cv.width = box; cv.height = box;
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(src, (box - src.width * s) / 2, (box - src.height * s) / 2,
        src.width * s, src.height * s);
      b.appendChild(cv);
      const cap = document.createElement('span');
      cap.textContent = part.name;
      b.appendChild(cap);
      list.appendChild(b);
    }
    mount.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('on', t.dataset.group === group));
  }

  function renderTools() {
    mount.querySelectorAll('.tool').forEach((b) =>
      b.classList.toggle('on', b.dataset.tool === tool));
  }

  // ------------------------------------------------------------- camera
  function fit() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const s = Math.min(w / (GRID_W * CELL + 40), h / (GRID_H * CELL + 40));
    cam.scale = Math.max(0.35, Math.min(3, s));
    cam.ox = (w - GRID_W * CELL * cam.scale) / 2;
    cam.oy = (h - GRID_H * CELL * cam.scale) / 2;
    cam.fitted = true;
  }

  function zoomAt(cx, cy, factor) {
    const next = Math.max(0.35, Math.min(3.5, cam.scale * factor));
    const k = next / cam.scale;
    cam.ox = cx - (cx - cam.ox) * k;
    cam.oy = cy - (cy - cam.oy) * k;
    cam.scale = next;
  }

  const toCell = (px, py) => ({
    x: Math.floor((px - cam.ox) / cam.scale / CELL),
    y: Math.floor((py - cam.oy) / cam.scale / CELL),
  });

  // --------------------------------------------------------------- render
  function resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!cam.fitted) fit();
    draw();
  }

  function drawSprite(art, rot, gx, gy) {
    const img = spriteCanvas(art, rot, 1);
    ctx.drawImage(img,
      cam.ox + gx * CELL * cam.scale,
      cam.oy + gy * CELL * cam.scale,
      img.width * cam.scale, img.height * cam.scale);
  }

  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    const gw = GRID_W * CELL * cam.scale, gh = GRID_H * CELL * cam.scale;

    // build plate
    ctx.fillStyle = '#141926';
    ctx.fillRect(cam.ox, cam.oy, gw, gh);

    // grid lines
    ctx.strokeStyle = 'rgba(130,155,205,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GRID_W; x++) {
      const px = Math.round(cam.ox + x * CELL * cam.scale) + .5;
      ctx.moveTo(px, cam.oy); ctx.lineTo(px, cam.oy + gh);
    }
    for (let y = 0; y <= GRID_H; y++) {
      const py = Math.round(cam.oy + y * CELL * cam.scale) + .5;
      ctx.moveTo(cam.ox, py); ctx.lineTo(cam.ox + gw, py);
    }
    ctx.stroke();

    // ground line: tells a kid which way is down without a word of text
    ctx.strokeStyle = '#3f8a4a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cam.ox - 10, cam.oy + gh + 1.5);
    ctx.lineTo(cam.ox + gw + 10, cam.oy + gh + 1.5);
    ctx.stroke();

    // placed parts
    veh.parts.forEach((p, i) => {
      drawSprite(getPart(p.t).art, p.r || 0, p.x, p.y);
      if (orphans.has(i)) {
        const { w: pw, h: ph } = partSize(getPart(p.t), p.r || 0);
        ctx.fillStyle = 'rgba(224,69,79,.42)';
        ctx.fillRect(cam.ox + p.x * CELL * cam.scale, cam.oy + p.y * CELL * cam.scale,
          pw * CELL * cam.scale, ph * CELL * cam.scale);
      }
    });

    drawBalance();

    // ghost of the part about to be placed
    if (hover && tool === 'build') {
      const part = getPart(held);
      const rot = 0;
      const placement = { t: held, x: hover.x, y: hover.y, r: rot };
      const ok = V.canPlace(veh, placement);
      ctx.globalAlpha = 0.55;
      drawSprite(part.art, rot, hover.x, hover.y);
      ctx.globalAlpha = 1;
      const { w: pw, h: ph } = partSize(part, rot);
      ctx.strokeStyle = ok ? '#7fe3ff' : '#e0454f';
      ctx.lineWidth = 2;
      ctx.strokeRect(cam.ox + hover.x * CELL * cam.scale + 1,
        cam.oy + hover.y * CELL * cam.scale + 1,
        pw * CELL * cam.scale - 2, ph * CELL * cam.scale - 2);
    }

    // highlight the cell under an erase/turn pointer
    if (hover && tool !== 'build') {
      ctx.strokeStyle = tool === 'erase' ? '#e0454f' : '#ffd23e';
      ctx.lineWidth = 2;
      ctx.strokeRect(cam.ox + hover.x * CELL * cam.scale + 1,
        cam.oy + hover.y * CELL * cam.scale + 1,
        CELL * cam.scale - 2, CELL * cam.scale - 2);
    }
  }

  /**
   * The centre of mass, and the wheel support base it has to sit over.
   *
   * This is the one thing that decides whether a vehicle tips, and it was
   * previously invisible -- the physics knew, the player could not. The dot
   * turns green as the mass gets low and the wheels get far apart, which is
   * the whole lesson, taught without a word of text.
   */
  function drawBalance() {
    const com = V.centreOfMass(veh);
    if (!com) return;
    const rating = V.balanceRating(com);
    const colour = RATING_COLOUR[rating];
    const px = (cellX) => cam.ox + cellX * CELL * cam.scale;
    const py = (cellY) => cam.oy + cellY * CELL * cam.scale;
    const cx = px(com.x), cy = py(com.y);

    if (com.ground !== null) {
      const gy = py(com.ground);
      // support base: the span the mass must stay inside
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px(com.left), gy);
      ctx.lineTo(px(com.right), gy);
      ctx.stroke();
      for (const edge of [com.left, com.right]) {
        ctx.beginPath();
        ctx.moveTo(px(edge), gy - 6);
        ctx.lineTo(px(edge), gy + 6);
        ctx.stroke();
      }
      // drop line, so the HEIGHT of the mass reads at a glance
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // the marker itself: dark halo first so it survives any sprite behind it
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,11,18,.72)'; ctx.fill();

    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = colour; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#f4f7fc'; ctx.stroke();

    ctx.strokeStyle = '#0d1017';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
    ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- state
  function pushUndo() {
    undoStack.push(JSON.stringify(veh.parts));
    if (undoStack.length > 60) undoStack.shift();
  }

  // How steep a slope this vehicle survives. Predicted here from the grid, and
  // measured for real on the Tilt Test track -- same gauge in both places.
  let tiltBest = 0;

  function refreshTilt() {
    const cv = $('#m-tilt');
    const t = tiltTest(veh);
    const c = fitCanvas(cv, TILT_W, TILT_H);
    if (!t) { tiltBest = 0; return; }
    if (!t.degenerate && t.mode === 'wheels') tiltBest = Math.max(tiltBest, t.angle);
    drawTiltGauge(c, TILT_W, TILT_H, {
      angle: t.angle,
      rating: t.rating,
      best: tiltBest,
      wobble: t.degenerate,
    });
  }

  function refresh() {
    orphans = new Set(V.orphanIndices(veh));
    const s = V.stats(veh);
    $('#m-speed').style.width = (s.speed * 100).toFixed(0) + '%';
    $('#m-grip').style.width = (s.grip * 100).toFixed(0) + '%';
    $('#m-weight').style.width = (s.weight * 100).toFixed(0) + '%';
    refreshTilt();
    $('#vname').textContent = veh.name;
    $('#warn').hidden = orphans.size === 0;
    draw();
  }

  function applyAt(cell) {
    const key = `${cell.x},${cell.y}`;
    if (painting?.has(key)) return;
    painting?.add(key);

    let changed = false;
    if (tool === 'build') {
      const placement = { t: held, x: cell.x, y: cell.y, r: 0 };
      if (V.canPlace(veh, placement)) { pushUndo(); changed = V.placeAt(veh, placement); }
    } else if (tool === 'erase') {
      if (V.partIndexAt(veh, cell.x, cell.y) >= 0) { pushUndo(); changed = V.removeAt(veh, cell.x, cell.y); }
    } else if (tool === 'turn') {
      const i = V.partIndexAt(veh, cell.x, cell.y);
      if (i >= 0 && getPart(veh.parts[i].t).rotatable) { pushUndo(); changed = V.rotateAt(veh, cell.x, cell.y); }
    }
    if (changed) refresh();
  }

  // ---------------------------------------------------------------- input
  const unbind = bindPointer(canvas, {
    onDown(p) {
      painting = new Set();
      hover = toCell(p.x, p.y);
      applyAt(hover);
      draw();
    },
    onMove(p) {
      const cell = toCell(p.x, p.y);
      const moved = !hover || hover.x !== cell.x || hover.y !== cell.y;
      hover = cell;
      // Dragging paints a run of cells -- the fastest way to lay a chassis.
      if (painting && moved) applyAt(cell);
      else if (moved) draw();
    },
    onUp() { painting = null; },
    onCancel() {
      // A second finger arrived: this was a pinch, not a paint. Undo the stroke
      // so panning never leaves a stray block behind.
      if (painting && painting.size && undoStack.length) {
        veh.parts = JSON.parse(undoStack.pop());
        refresh();
      }
      painting = null;
    },
    onPinch(g) {
      painting = null;
      zoomAt(g.cx, g.cy, g.dScale);
      cam.ox += g.dx; cam.oy += g.dy;
      draw();
    },
    onWheel(g) { zoomAt(g.cx, g.cy, g.dScale); draw(); },
  });

  // hover tracking for mouse users, without capturing a drag
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || painting) return;
    const r = canvas.getBoundingClientRect();
    const cell = toCell(e.clientX - r.left, e.clientY - r.top);
    if (!hover || hover.x !== cell.x || hover.y !== cell.y) { hover = cell; draw(); }
  });
  canvas.addEventListener('pointerleave', () => { hover = null; draw(); });

  // ------------------------------------------------------------- controls
  mount.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-tool]');
    if (tb) { tool = tb.dataset.tool; renderTools(); draw(); return; }

    const tab = e.target.closest('[data-group]');
    if (tab) { group = tab.dataset.group; renderTray(); return; }

    const pb = e.target.closest('[data-part]');
    if (pb) {
      held = pb.dataset.part;
      tool = 'build';               // picking a part always means "I want to build"
      renderTools(); renderTray(); draw();
      return;
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;

    // Both routes out of the builder save first. Leaving by the back arrow used
    // to discard everything silently, which is a fail state in a game that is
    // supposed to have none.
    if (act === 'exit' || act === 'save') {
      if (!veh.parts.length) { onExit?.(); return; }   // nothing worth saving
      const res = await onSave?.(veh);
      if (res === 'failed') { toast('Could not save — try again', 'warn'); return; }
      onExit?.();      // seeing the vehicle land in the garage IS the confirmation
    }
    if (act === 'undo') {
      if (undoStack.length) { veh.parts = JSON.parse(undoStack.pop()); refresh(); }
    }
    if (act === 'clear') {
      if (veh.parts.length && confirm('Start over? This clears the whole vehicle.')) {
        pushUndo(); veh.parts = []; refresh();
      }
    }
    if (act === 'rename') {
      const name = prompt('Name your vehicle:', veh.name);
      if (name && name.trim()) { veh.name = name.trim().slice(0, 40); refresh(); }
    }
    if (act === 'fit') { fit(); draw(); }
    if (act === 'zoomin') { zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.25); draw(); }
    if (act === 'zoomout') { zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.8); draw(); }
  });

  function toast(msg, kind = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    mount.querySelector('.screen').appendChild(t);
    setTimeout(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2200);
  }

  function onKey(e) {
    if (e.target.matches('input,textarea')) return;
    if (e.key === 'b') { tool = 'build'; renderTools(); draw(); }
    if (e.key === 'r') { tool = 'turn'; renderTools(); draw(); }
    if (e.key === 'e') { tool = 'erase'; renderTools(); draw(); }
    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (undoStack.length) { veh.parts = JSON.parse(undoStack.pop()); refresh(); }
    }
  }
  window.addEventListener('keydown', onKey);

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  renderTools(); renderTray(); resize(); refresh();

  return {
    getVehicle: () => veh,
    // Exposed for headless verification, the same way race-ui exposes _step:
    // set parts directly, re-render, and read back what the gauge computed.
    _refresh: refresh,
    _tilt: () => tiltTest(veh),
    destroy() { unbind(); ro.disconnect(); window.removeEventListener('keydown', onKey); },
  };
}
