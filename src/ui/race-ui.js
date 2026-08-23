// Split-screen race screen.
//
// Split direction follows the viewport: a side-scrolling race wants WIDE panes,
// so a portrait phone stacks them and anything landscape puts them side by
// side. Two 187px-wide panes on a phone would be unplayable.

import * as R from '../game/race.js';
import { renderView, makeCamera } from './render.js';
import { M } from '../game/build.js';

const KEYS = [['a', 'shift'], ['l', ' ']];   // P1, P2

export function createRace({ mount, planck, trackId, entries, onExit, onAgain }) {
  const race = R.createRace(planck, { trackId, entries });
  const cams = race.lanes.map(() => makeCamera());

  mount.innerHTML = `
    <div class="screen race">
      <canvas id="rc"></canvas>
      <button class="btn icon quit" data-act="exit" title="Back">‹</button>
      <div class="bigmsg" id="bigmsg"></div>
      ${race.lanes.map((l, i) => `
        <button class="actionBtn p${i + 1}" data-fire="${i}">
          <span class="ring"></span><b>GO!</b>
        </button>`).join('')}
      <div class="results" id="results" hidden>
        <h2 id="rtitle"></h2>
        <div id="rtimes"></div>
        <div class="rbtns">
          <button class="btn primary big" data-act="again">Race again</button>
          <button class="btn big" data-act="exit">Garage</button>
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
      cams[i].x += (pos.x - cams[i].x) * 0.14;
      cams[i].y += (pos.y - cams[i].y) * 0.09;
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
      const has = lane.racer.specials.length > 0;
      btn.classList.toggle('ready', has && R.actionReady(lane));
      btn.classList.toggle('none', !has);
      btn.style.setProperty('--cd', R.actionCooldown(lane).toFixed(2));
    });

    if (R.raceOver(race) && $('#results').hidden) showResults();
  }

  function showResults() {
    const box = $('#results');
    box.hidden = false;
    const w = race.winner;
    $('#rtitle').textContent = w ? `P${w.index + 1} — ${w.entry.label} wins!` : 'Race over';
    // A trailing vehicle is still driving when the celebration window closes.
    // "Did not finish" reads as failure to a kid, so report how far they got.
    $('#rtimes').innerHTML = race.lanes.map((l, i) => {
      const done = l.finishTime !== null;
      const detail = done
        ? `${l.place === 1 ? '1st' : '2nd'} · ${l.finishTime.toFixed(1)}s`
        : `2nd · got to ${Math.round(l.racer.chassis.getPosition().x)}m of ${Math.round(race.track.length)}m`;
      return `<div class="rrow"><b>P${i + 1}</b> ${l.entry.label} <span>${detail}</span></div>`;
    }).join('');
  }

  // ----------------------------------------------------------------- input
  const onDown = (e) => {
    const fire = e.target.closest('[data-fire]');
    if (fire) { e.preventDefault(); R.laneAction(race, +fire.dataset.fire); }
  };
  const onClick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'exit') { destroy(); onExit?.(); }
    if (act === 'again') { destroy(); onAgain?.(); }
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
