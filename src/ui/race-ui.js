// Split-screen race screen.
//
// Split direction follows the viewport: a side-scrolling race wants WIDE panes,
// so a portrait phone stacks them and anything landscape puts them side by
// side. Two 187px-wide panes on a phone would be unplayable.

import * as R from '../game/race.js';
import { renderView, makeCamera } from './render.js';
import { drawTiltGauge, fitCanvas, RATING_COLOUR } from './gauge.js';
import { tiltRating } from '../game/tilt.js';
import { TILT_MAX } from '../game/testmodes.js';
import { SURFACES } from '../game/track.js';
import { enableProbe } from '../game/physics.js';
import { getPref, setPref } from '../game/prefs.js';

const KEYS = [['a', 'shift'], ['l', ' ']];   // P1, P2

export function createRace({ mount, planck, trackId, entries, onExit, onAgain }) {
  const race = R.createRace(planck, { trackId, entries });
  const cams = race.lanes.map(() => makeCamera());

  mount.innerHTML = `
    <div class="screen race">
      <canvas id="rc"></canvas>
      <div class="racechrome">
        <button class="btn icon" data-act="exit" title="Back">🏠</button>
        <button class="btn icon sci" data-act="science" title="Show the forces">🔬</button>
      </div>
      <div class="bigmsg" id="bigmsg"></div>
      ${race.lanes.map((l, i) => `
        <button class="actionBtn p${i + 1}" data-fire="${i}">
          <span class="ring"></span><b>⚡</b>
        </button>`).join('')}
      <div class="results" id="results" hidden>
        <h2 id="rtitle"></h2>
        <div id="rtimes"></div>
        <div class="rbtns">
          <button class="btn primary big" data-act="again"><b class="ico">🔄</b> Race again</button>
          <button class="btn big" data-act="exit"><b class="ico">🏠</b> Garage</button>
        </div>
      </div>
    </div>`;

  const $ = (s) => mount.querySelector(s);
  const cv = $('#rc');
  const ctx = cv.getContext('2d');
  let stacked = false;

  function layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stacked = w / h < 1.1;
    mount.querySelector('.race').classList.toggle('stacked', stacked);
  }

  const paneRect = (i) => {
    const w = cv.clientWidth, h = cv.clientHeight;
    return stacked
      ? { x: 0, y: i * h / 2, w, h: h / 2 }
      : { x: i * w / 2, y: 0, w: w / 2, h };
  };

  // -------------------------------------------------------------- rendering
  /** Live angle readout, shared by both test rigs. */
  function drawTestHud(pane, lane, pad) {
    const h = lane.test.hud();
    const gw = 62, gh = 54;
    ctx.save();
    ctx.translate(pad, pad + 30);
    ctx.fillStyle = 'rgba(10,14,22,.62)';
    ctx.fillRect(-3, -3, gw + 6, gh + 6);
    drawTiltGauge(ctx, gw, gh, {
      angle: h.angle,
      max: lane.test.kind === 'tilt' ? TILT_MAX : Math.PI / 2,
      rating: tiltRating(h.angle),
      best: lane.test.kind === 'tilt' ? h.best : 0,
    });
    ctx.restore();

    // Which ground it is on, and how it did on the ones already done. The
    // swatch colours are the terrain's own, so the row reads against the
    // hillside the player just watched rather than needing a key.
    if (lane.test.kind === 'slope') {
      const sw = 15, gap = 4;
      h.surfaces.forEach((id, k) => {
        const x = pad + k * (sw + gap), y = pad + 30 + gh + 8;
        const got = h.got[k];
        ctx.fillStyle = 'rgba(10,14,22,.62)';
        ctx.fillRect(x - 1, y - 1, sw + 2, 24);
        ctx.fillStyle = SURFACES[id].fill;
        ctx.fillRect(x, y, sw, 22);
        if (got !== undefined) {
          const frac = Math.max(0.06, Math.min(1, got / (Math.PI / 2)));
          ctx.fillStyle = SURFACES[id].cap;
          ctx.fillRect(x, y + 22 - 22 * frac, sw, 22 * frac);
        }
        ctx.strokeStyle = k === h.stage ? '#f4f7fc' : '#12141c';
        ctx.lineWidth = k === h.stage ? 2 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, sw - 1, 21);
      });
    }
  }

  function drawPaneHud(pane, lane, i) {
    const label = lane.entry.label;
    const prog = R.laneProgress(race, lane);
    const pad = 10;

    ctx.save();
    ctx.translate(pane.x, pane.y);

    // name plate
    ctx.font = '600 13px ui-rounded, system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(10,14,22,.62)';
    ctx.fillRect(pad, pad, tw + 46, 24);
    ctx.fillStyle = i === 0 ? '#7fe3ff' : '#ffd23e';
    ctx.fillText(`P${i + 1}`, pad + 8, pad + 17);
    ctx.fillStyle = '#e4eaf5';
    ctx.fillText(label, pad + 34, pad + 17);

    if (lane.test) { drawTestHud(pane, lane, pad); ctx.restore(); return; }

    // progress rail
    const railW = pane.w - pad * 2, railY = pad + 32;
    ctx.fillStyle = 'rgba(10,14,22,.62)';
    ctx.fillRect(pad, railY, railW, 8);
    ctx.fillStyle = i === 0 ? '#2e9fd6' : '#ffb020';
    ctx.fillRect(pad, railY, railW * prog, 8);
    // finish tick
    ctx.fillStyle = '#f4f7fc';
    ctx.fillRect(pad + railW - 2, railY - 3, 3, 14);

    if (lane.finishTime !== null) {
      ctx.fillStyle = 'rgba(10,14,22,.72)';
      ctx.fillRect(pad, railY + 14, 132, 22);
      ctx.fillStyle = lane.place === 1 ? '#ffd23e' : '#c3cbdb';
      ctx.font = '700 13px ui-rounded, system-ui, sans-serif';
      ctx.fillText(`${lane.place === 1 ? '1st' : '2nd'} — ${lane.finishTime.toFixed(1)}s`, pad + 8, railY + 30);
    } else if (lane.racer.recoverFor > 0) {
      ctx.fillStyle = 'rgba(224,69,79,.85)';
      ctx.fillRect(pad, railY + 14, 96, 22);
      ctx.fillStyle = '#fff';
      ctx.font = '700 12px ui-rounded, system-ui, sans-serif';
      ctx.fillText('FLIPPING BACK', pad + 7, railY + 29);
    }
    ctx.restore();
  }

  function draw() {
    const w = cv.clientWidth, h = cv.clientHeight;
    ctx.clearRect(0, 0, w, h);

    race.lanes.forEach((lane, i) => {
      const pane = paneRect(i);
      const pos = lane.racer.chassis.getPosition();
      // The Slope Test moves the vehicle bodily to the next stage; easing
      // across 40 metres would spend seconds looking at empty hillside.
      if (Math.abs(pos.x - cams[i].x) > 12) { cams[i].x = pos.x; cams[i].y = pos.y; }
      cams[i].x += (pos.x - cams[i].x) * 0.14;
      cams[i].y += (pos.y - cams[i].y) * 0.09;
      cams[i].roll = lane.test ? lane.test.roll() : 0;
      // Narrow panes need to pull back or you cannot see what is coming.
      cams[i].zoom = Math.max(0.55, Math.min(1, pane.w / 620));

      ctx.save();
      ctx.translate(pane.x, pane.y);
      renderView({ ctx, vw: pane.w, vh: pane.h }, cams[i], lane.build, [lane.racer]);
      ctx.restore();

      drawPaneHud(pane, lane, i);
    });

    // divider
    ctx.fillStyle = '#0d1017';
    if (stacked) ctx.fillRect(0, h / 2 - 2, w, 4);
    else ctx.fillRect(w / 2 - 2, 0, 4, h);
  }

  // ------------------------------------------------------------------ loop
  let raf = 0, watchdog = 0, last = performance.now(), lastTick = last;
  let acc = 0, stopped = false;
  const DT = 1 / 60;

  function tick(now) {
    if (stopped) return;
    lastTick = now;
    // A hidden tab throttles rAF and timers to about 1 Hz, which would drag the
    // race along in slow motion while nobody is watching. Hold instead.
    if (document.hidden) { last = now; raf = requestAnimationFrame(tick); return; }
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += real;
    while (acc >= DT) { R.stepRace(race, DT); acc -= DT; }
    draw();
    syncChrome();
    raf = requestAnimationFrame(tick);
  }

  function start() {
    raf = requestAnimationFrame(tick);
    // Some embedded browser views never fire requestAnimationFrame at all, and
    // others fire it only when something else forces a paint. A watchdog covers
    // both without latching: it only steps in when rAF has actually gone quiet.
    watchdog = setInterval(() => {
      const now = performance.now();
      if (!stopped && now - lastTick > 120) tick(now);
    }, 60);
  }

  function syncChrome() {
    const msg = $('#bigmsg');
    if (race.phase === 'countdown') {
      const n = Math.ceil(race.countdown - 0.2);
      msg.textContent = n > 0 ? String(n) : 'GO!';
      msg.hidden = false;
    } else if (race.phase === 'racing') {
      msg.hidden = race.elapsed > 0.8;
      msg.textContent = 'GO!';
    } else {
      msg.hidden = true;
    }

    race.lanes.forEach((lane, i) => {
      const btn = mount.querySelector(`[data-fire="${i}"]`);
      // Nothing to fire on a test rig, and a dead button is worse than none.
      if (race.mode) { btn.hidden = true; return; }
      const has = lane.racer.specials.length > 0;
      btn.classList.toggle('ready', has && R.actionReady(lane));
      btn.classList.toggle('none', !has);
      btn.style.setProperty('--cd', R.actionCooldown(lane).toFixed(2));
    });

    if (R.raceOver(race) && $('#results').hidden) showResults();
  }

  const escapeHtml = (t) => String(t).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /**
   * Test results as pictures, not numbers.
   *
   * A protractor standing at the angle it fell over at, or one bar per ground
   * material in that ground's own colour. Neither needs reading, and the shape
   * of the two rows side by side is the comparison.
   */
  function testResultRow(lane) {
    const res = lane.test.result();
    const wrap = document.createElement('div');
    wrap.className = 'tres';

    if (res.kind === 'tilt') {
      const cv = document.createElement('canvas');
      const c = fitCanvas(cv, 96, 82);
      drawTiltGauge(c, 96, 82, {
        angle: res.angle, max: TILT_MAX, rating: tiltRating(res.angle),
      });
      wrap.appendChild(cv);
      const medal = document.createElement('b');
      medal.className = 'tmedal';
      medal.textContent = res.angle >= Math.atan(1.0) ? '🥇'
        : res.angle >= Math.atan(2 / 3) ? '🥈' : '🥉';
      wrap.appendChild(medal);
    } else {
      const bars = document.createElement('div');
      bars.className = 'tbars';
      for (const b of res.bars) {
        const col = document.createElement('span');
        col.className = 'tbar';
        col.style.background = SURFACES[b.surface].fill;
        const fill = document.createElement('i');
        fill.style.background = SURFACES[b.surface].cap;
        fill.style.height = Math.max(6, Math.min(100, (b.angle / (Math.PI / 2)) * 100)) + '%';
        col.appendChild(fill);
        bars.appendChild(col);
      }
      wrap.appendChild(bars);
    }
    return wrap;
  }

  function showTestResults() {
    const w = race.winner;
    $('#rtitle').innerHTML = w
      ? `🏆 P${w.index + 1} — ${escapeHtml(w.entry.label)}`
      : '🤝 Dead heat';
    const host = $('#rtimes');
    host.innerHTML = '';
    race.lanes.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'rrow trow';
      const who = document.createElement('b');
      who.textContent = `P${i + 1}`;
      const name = document.createElement('span');
      name.className = 'tname';
      name.textContent = l.entry.label;
      row.append(who, name, testResultRow(l));
      host.appendChild(row);
    });
  }

  function showResults() {
    const box = $('#results');
    box.hidden = false;
    if (race.mode) { showTestResults(); return; }
    const w = race.winner;
    $('#rtitle').innerHTML = w
      ? `🏆 P${w.index + 1} — ${escapeHtml(w.entry.label)} wins!`
      : 'Race over';
    // A trailing vehicle is still driving when the celebration window closes.
    // "Did not finish" reads as failure to a kid, so report how far they got.
    $('#rtimes').innerHTML = race.lanes.map((l, i) => {
      const done = l.finishTime !== null;
      const detail = done
        ? `${l.place === 1 ? '1st' : '2nd'} · ${l.finishTime.toFixed(1)}s`
        : `2nd · got to ${Math.round(l.racer.chassis.getPosition().x)}m of ${Math.round(race.track.length)}m`;
      const medal = done && l.place === 1 ? '🏆' : '🚩';
      return `<div class="rrow"><b>P${i + 1}</b> ${medal} ${escapeHtml(l.entry.label)} <span>${detail}</span></div>`;
    }).join('');
  }

  // --------------------------------------------------------- science view
  // Default off in a race, because arrows over both panes during a first race
  // hide the vehicles -- but on in a test rig, where looking at the physics is
  // the entire point. The choice is remembered either way.
  let science = race.mode ? getPref('science', true) : getPref('science', false);

  function applyScience() {
    for (const lane of race.lanes) enableProbe(lane.racer, science);
    mount.querySelector('.sci')?.classList.toggle('on', science);
  }
  applyScience();

  // ----------------------------------------------------------------- input
  const onDown = (e) => {
    const fire = e.target.closest('[data-fire]');
    if (fire) { e.preventDefault(); R.laneAction(race, +fire.dataset.fire); }
  };
  const onClick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'exit') { destroy(); onExit?.(); }
    if (act === 'again') { destroy(); onAgain?.(); }
    if (act === 'science') {
      science = !science;
      setPref('science', science);
      applyScience();
      draw();
    }
  };
  mount.addEventListener('pointerdown', onDown);
  mount.addEventListener('click', onClick);

  function onKey(e) {
    const k = e.key.toLowerCase();
    KEYS.forEach((keys, i) => {
      if (keys.includes(k)) { e.preventDefault(); R.laneAction(race, i); }
    });
  }
  window.addEventListener('keydown', onKey);

  const onVis = () => { last = performance.now(); };
  document.addEventListener('visibilitychange', onVis);

  const ro = new ResizeObserver(layout);
  ro.observe(cv);
  layout();
  start();

  function destroy() {
    stopped = true;
    cancelAnimationFrame(raf);
    clearInterval(watchdog);
    document.removeEventListener('visibilitychange', onVis);
    mount.removeEventListener('pointerdown', onDown);
    mount.removeEventListener('click', onClick);
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
  }

  // Exposed for headless verification, where rAF may never fire.
  return {
    destroy,
    _race: race,
    _step: (secs) => {
      for (let i = 0; i < Math.round(secs / DT); i++) R.stepRace(race, DT);
      // The camera eases toward its vehicle once per rendered frame, so a single
      // draw after a long step would leave it far behind. Snap it for stepping.
      race.lanes.forEach((lane, i) => {
        const p = lane.racer.chassis.getPosition();
        cams[i].x = p.x; cams[i].y = p.y;
      });
      draw();
      syncChrome();
    },
  };
}
