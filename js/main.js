'use strict';
/* Rocketwright — screens, menus, input and the main loop. */

/* ---------------- screens & modals ---------------- */

function showHangar() {
  F.running = false;
  hideModal();
  $('flight').classList.add('hidden');
  $('hangar').classList.remove('hidden');
  hangarChanged();
}
function launch() {
  const a = analyzeDesign(Hangar.design);
  if (!a.valid) return;
  $('hangar').classList.add('hidden');
  $('flight').classList.remove('hidden');
  resizeFlight();
  flightStart(Hangar.design, Hangar.name);
}

let modalOpen = false;
function showModal(html, buttons) {
  const card = $('modalCard');
  card.innerHTML = html;
  const row = document.createElement('div');
  row.className = 'modal-btns';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.textContent = b.label;
    if (b.cls) el.className = b.cls;
    el.addEventListener('click', b.fn);
    row.appendChild(el);
  }
  card.appendChild(row);
  $('modal').classList.remove('hidden');
  modalOpen = true;
  F.paused = true;
}
function hideModal() {
  $('modal').classList.add('hidden');
  modalOpen = false;
  F.paused = false;
}

const HELP_HTML = `
<h2>How to play</h2>
<p><b>Build</b> in the hangar by dragging parts onto your rocket. Parts snap to the top or bottom of other parts, or to their
sides. With <b>symmetry</b> on, side parts are placed in mirrored pairs. <b>Decouplers</b> split the rocket into stages, and
<b>radial decouplers</b> hold side boosters. Engines burn fuel from tanks they connect to without crossing a decoupler
(a <b>crossfeed decoupler</b> lets boosters feed the core). The staging panel shows what each press of <kbd>Space</kbd> does, with
its Δv (how much speed it can add) and TWR (thrust-to-weight; above 1 to lift off). Use ▲/▼ to change the order.</p>
<div class="keys">
  <div><kbd>Space</kbd> Stage: ignite, separate, parachute</div>
  <div><kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd> Rotate</div>
  <div><kbd>W</kbd>/<kbd>S</kbd>, <kbd>Shift</kbd>, <kbd>↑</kbd>/<kbd>↓</kbd> Throttle</div>
  <div><kbd>Z</kbd> Full throttle · <kbd>X</kbd> Cut throttle</div>
  <div><kbd>T</kbd> Toggle SAS · <kbd>1</kbd>–<kbd>6</kbd> SAS modes</div>
  <div><kbd>M</kbd> Map view · <kbd>F</kbd> Map focus</div>
  <div><kbd>,</kbd>/<kbd>.</kbd> Time warp slower / faster</div>
  <div>Mouse wheel: zoom · <kbd>Esc</kbd> Menu</div>
  <div><kbd>R</kbd> RCS · <kbd>Q</kbd>/<kbd>E</kbd> slide · <kbd>H</kbd>/<kbd>N</kbd> forward/back</div>
  <div>Hangar: <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>X</kbd> symmetry · <kbd>Del</kbd> remove</div>
</div>
<h3>Getting to orbit</h3>
<ol>
  <li>Launch straight up. At about 1 km, tilt slightly toward one side (a few degrees).</li>
  <li>Let the rocket follow its prograde marker (green circle) as it slowly tips over: a <i>gravity turn</i>. Aim for about 45° pitch at 10 km.</li>
  <li>When your <b>apoapsis</b> reaches about 80 km, cut the throttle and coast. Use the map (<kbd>M</kbd>) and time warp.</li>
  <li>Near apoapsis, point prograde (SAS mode <kbd>3</kbd>) and burn until your <b>periapsis</b> is above 70 km. You're in orbit!</li>
</ol>
<h3>Coming home</h3>
<p>Point retrograde and burn until periapsis is inside the atmosphere (around 30 km). Drop spent stages, then stage the parachute
when you're slow. Touch down under 6 m/s (12 m/s with landing legs, 10 m/s in water).</p>
<h3>Reaching Pallid</h3>
<p>From orbit, burn prograde when Pallid is rising over the horizon, about 110° ahead of you. Watch the map until your path shows a
<b>Pallid encounter</b>. Pallid has no air, so you have to land with your engine. Pack landing legs.</p>`;

function showHelp() {
  const wasRunning = F.running;
  showModal(HELP_HTML, [{ label: 'Got it', cls: 'primary', fn: () => { hideModal(); if (wasRunning && F.endShown) showCrashModal(); } }]);
}

function showMilestones() {
  const got = Store.get('milestones', {});
  const items = MILESTONES.map((m) => `<li class="${got[m.id] ? 'done' : ''}"><span class="chk">${got[m.id] ? '★' : '☆'}</span>
    <div><b>${m.name}</b><div class="muted">${m.desc}</div></div></li>`).join('');
  const n = MILESTONES.filter((m) => got[m.id]).length;
  showModal(`<h2>Milestones · ${n}/${MILESTONES.length}</h2><ul class="milestones">${items}</ul>`,
    [{ label: 'Close', cls: 'primary', fn: hideModal }]);
}

function openMenu() {
  if (!F.running || F.endShown) return;
  const c = F.craft;
  const btns = [{ label: 'Resume', cls: 'primary', fn: hideModal }];
  if (c.landed && c.landed.body === HOME && F.flags.maxAlt > 100) btns.push({ label: 'Recover vessel', fn: recover });
  btns.push({ label: 'Revert to launch', fn: () => { hideModal(); flightStart(F.design, F.craftName); } });
  btns.push({ label: 'Back to hangar', fn: showHangar });
  btns.push({ label: 'Controls', fn: showHelp });
  showModal(`<h2>Paused</h2><p class="muted">${F.craftName} · ${fmtClock(F.t)}</p>`, btns);
}

function showCrashModal() {
  showModal(`<h2>Vessel destroyed</h2><p>${F.craftName} was lost after ${fmtClock(F.t).slice(3)}.</p>
    <p class="muted">Tip: land under 6 m/s, or 12 m/s with landing legs. Deploy the parachute well before the ground.</p>`, [
    { label: 'Revert to launch', cls: 'primary', fn: () => { hideModal(); flightStart(F.design, F.craftName); } },
    { label: 'Back to hangar', fn: showHangar },
  ]);
}

function recover() {
  const names = F.flightMilestones.map((id) => MILESTONES.find((m) => m.id === id)).filter(Boolean).map((m) => `<li>★ ${m.name}</li>`).join('');
  F.endShown = true;
  showModal(`<h2>Vessel recovered</h2>
    <div class="kv"><span>Mission time</span><b>${fmtClock(F.t).slice(3)}</b></div>
    <div class="kv"><span>Highest altitude</span><b>${fmtDist(F.flags.maxAlt)}</b></div>
    <div class="kv"><span>Visited Pallid</span><b>${F.flags.landedMoon ? 'Landed!' : F.flags.moon ? 'Yes' : 'No'}</b></div>
    ${names ? `<h3>Milestones this flight</h3><ul class="plain">${names}</ul>` : ''}`, [
    { label: 'Back to hangar', cls: 'primary', fn: showHangar },
    { label: 'Fly again', fn: () => { hideModal(); flightStart(F.design, F.craftName); } },
  ]);
}

function toggleRcs() {
  const c = F.craft;
  if (!c || c.dead) return;
  if (!c.rcsParts.length) { flash('No RCS thrusters on this craft', 2); return; }
  c.rcsOn = !c.rcsOn;
  flash(c.rcsOn ? 'RCS on · Q/E slide sideways · H/N forward/back' : 'RCS off', 2);
}

function toggleMap() {
  F.map = !F.map;
  F.predTick = 0;
}

/* ---------------- input ---------------- */

function onKeyDown(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (modalOpen) {
    if (e.code === 'Escape' && F.running && !F.endShown) hideModal();
    return;
  }
  if (!F.running) {
    hangarKey(e);
    return;
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  F.keys[e.code] = true;
  if (e.repeat) return;
  const c = F.craft;
  switch (e.code) {
    case 'Space': doStage(); break;
    case 'KeyM': toggleMap(); break;
    case 'Comma': changeWarp(-1); break;
    case 'Period': changeWarp(1); break;
    case 'KeyZ': if (!c.dead) c.throttle = 1; break;
    case 'KeyX': if (!c.dead) c.throttle = 0; break;
    case 'KeyT': setSas(F.sas === 'off' ? 'stab' : 'off'); break;
    case 'KeyR': toggleRcs(); break;
    case 'KeyF': F.mapFocus = (F.mapFocus + 1) % 4; if (F.mapFocus !== 1) F.mapZoom = 0; break;
    case 'Escape': openMenu(); break;
    case 'Equal': case 'NumpadAdd': zoomBy(1.25); break;
    case 'Minus': case 'NumpadSubtract': zoomBy(0.8); break;
    default:
      if (/^Digit[1-6]$/.test(e.code)) setSas(SAS_MODES[+e.code.slice(5) - 1]);
  }
}
function zoomBy(f) {
  if (F.map) F.mapZoom = clamp(F.mapZoom * f, 1e-6, 2);
  else F.zoom = clamp(F.zoom * f, 2e-5, 40);
}

function wireUi() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', (e) => { F.keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in F.keys) F.keys[k] = false; });
  $('game').addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  window.addEventListener('resize', () => { if (!F.running) { Hangar.view = null; drawBuild(); } });

  $('btnLaunch').addEventListener('click', launch);
  $('btnHelp').addEventListener('click', showHelp);
  $('btnMilestones').addEventListener('click', showMilestones);
  wireHangar();

  // flight HUD buttons (never keep focus, so Space keeps staging)
  document.querySelectorAll('#flight button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  $('bStage').addEventListener('click', doStage);
  $('bMap').addEventListener('click', toggleMap);
  $('bMenu').addEventListener('click', openMenu);
  $('bWarpUp').addEventListener('click', () => changeWarp(1));
  $('bWarpDn').addEventListener('click', () => changeWarp(-1));
  $('bRecover').addEventListener('click', recover);
  $('bRcs').addEventListener('click', toggleRcs);
  document.querySelectorAll('#sasBtns button').forEach((b) => b.addEventListener('click', () => setSas(b.dataset.sas)));
  document.querySelectorAll('[data-hold]').forEach((b) => {
    const k = b.dataset.hold;
    const on = (e) => { e.preventDefault(); F.keys[k] = true; };
    const off = () => { F.keys[k] = false; };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
  });
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && F.running && !F.endShown) hideModal(); });
}

/* ---------------- boot ---------------- */

let lastFrame = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (F.running) {
    if (!F.paused) flightUpdate(dt);
    flightRender();
  }
  requestAnimationFrame(loop);
}

function boot() {
  buildPalette();
  initFlightView();
  wireUi();
  fillLoadSelect();
  const cur = Store.get('current', null);
  const curDesign = cur ? migrateDesign(cur.design) : null;
  if (curDesign && curDesign.parts.length) loadCraft(cur.name || 'Untitled', curDesign);
  else loadCraft('Orbiter I', PRESETS['Orbiter I']());
  if (!Store.get('seenHelp', false)) { Store.set('seenHelp', true); showHelp(); }
  requestAnimationFrame(loop);
}
window.addEventListener('DOMContentLoaded', boot);
