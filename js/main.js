'use strict';
/* Rocketwright — screens, menus, input and the main loop. */

/* ---------------- screens & modals ---------------- */

function showHangar() {
  F.running = false;
  hideModal();
  showScreen('hangar');
  buildPalette();
  Hangar.view = null;
  hangarChanged();
}

/* Launch the hangar's design: in career this charges the rocket's price and seats an astronaut. */
function launch() {
  const a = analyzeDesign(Hangar.design);
  if (!a.valid || !Career.s) return;
  launchDesign(Hangar.design, Hangar.name, Hangar.crewId);
}
function launchDesign(design, name, crewId) {
  const s = Career.s;
  const snapshot = JSON.stringify(s);
  let crew = null;
  if (isCareer()) {
    const cost = designCost(design);
    if (lockedParts(design).length) { toast('This design uses parts you have not researched'); return; }
    if (s.funds < cost) { toast(`Not enough funds: this rocket costs ${fmtFunds(cost)}`); return; }
    if (design.parts.some((p) => PART_DEFS[p.id].pod)) {
      crew = s.crew.find((c) => c.id === crewId && c.status === 'available') || availableCrew(s)[0];
      if (!crew) { toast('No astronauts available. Hire one in the Astronaut Office.'); return; }
      crew.status = 'flying';
    }
    s.funds -= cost;
    s.flights++;
    persist();
  }
  showScreen('flight');
  resizeFlight();
  flightStart(design, name, { t0: s.ut, crewId: crew ? crew.id : null });
  F.snapshot = snapshot;
  if (crew) flash(`${crew.name} is aboard ${name}. Press SPACE to launch!`, 5);
}

/* Bring the program's clock forward to the end of the flight and release the crew. */
function finishFlight(recovered) {
  const s = Career.s;
  s.ut = Math.max(s.ut, F.t);
  if (F.crewId) {
    const cm = s.crew.find((c) => c.id === F.crewId);
    if (cm && cm.status === 'flying') {
      cm.status = 'available';
      if (recovered) {
        cm.flights++;
        for (const w of F.flags.visited) if (!cm.worlds.includes(w)) cm.worlds.push(w);
      }
    }
  }
  F.crewId = null;
  if (isCareer()) refreshContracts(s);
  persist();
}

/* Undo everything since launch. */
function revertFlight(toHangar) {
  Career.s = JSON.parse(F.snapshot);
  persist();
  hideModal();
  if (toHangar) showHangar();
  else launchDesign(F.design, F.craftName, F.crewId);
}

let modalOpen = false;
function showModal(html, buttons, cls) {
  const card = $('modalCard');
  card.className = 'modal-card' + (cls ? ' ' + cls : '');
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
  <div><kbd>B</kbd> Science panel (career)</div>
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
<b>Pallid encounter</b>. Pallid has no air, so you have to land with your engine. Pack landing legs.</p>
<h3>Other worlds</h3>
<p>Verdan orbits the star <b>Helion</b> with six planets: hot <b>Cinder</b>, desert <b>Ochre</b> (moons Pip and Shard), the gas
giant <b>Tempest</b> (moons Gale, Ember and Frost), icy <b>Glacis</b> and distant <b>Umbra</b>. To reach one, burn prograde from
orbit to escape Verdan (try about 1,000 m/s for Ochre), then use the map: zoom out, click a planet to focus it, and adjust your
burn until the path shows an encounter. Time warp goes up to 1,000,000× in deep space. Tempest has no surface, so don't sink into it.</p>
<h3>Career mode</h3>
<p>Take contracts in <b>Mission Control</b>; they pay an advance, then a reward the moment you complete them. Rockets cost money to launch,
so build within budget, then <b>recover</b> them on Verdan to get most of their value back (more the closer you land to the launch site).
Open the 🔬 <b>Science</b> panel (<kbd>B</kbd>) to run experiments: the same experiment is worth more on new worlds and in new situations.
Transmit results with an antenna for half their value, or bring them home for all of it. Spend science in the <b>Research Lab</b> to unlock parts.
Reverting a flight undoes everything that happened in it.</p>`;

function showHelp() {
  const wasRunning = F.running;
  showModal(HELP_HTML, [{ label: 'Got it', cls: 'primary', fn: () => { hideModal(); if (wasRunning && F.endShown) showCrashModal(); } }]);
}

function showMilestones() {
  const got = loadMilestones();
  const items = MILESTONES.map((m) => `<li class="${got[m.id] ? 'done' : ''}"><span class="chk">${got[m.id] ? '★' : '☆'}</span>
    <div><b>${m.name}</b><div class="muted">${m.desc}</div></div></li>`).join('');
  let total = MILESTONES.length, n = MILESTONES.filter((m) => got[m.id]).length;
  const rows = BODIES.filter((b) => b !== HOME && !b.star).map((b) => {
    const cells = MILESTONE_KINDS.map((k) => {
      if (k.solid && b.gas) return '<td class="na">—</td>';
      const id = `${k.k}_${b.id}`;
      total++;
      if (got[id]) n++;
      return `<td class="${got[id] ? 'done' : ''}" title="${k.desc(b)}">${got[id] ? '★' : '☆'}</td>`;
    }).join('');
    const depth = b.parent === SUN ? '' : ' class="moon"';
    return `<tr><th${depth} title="${b.desc}"><span class="dot" style="background:${b.colMap}"></span>${b.name}</th>${cells}</tr>`;
  }).join('');
  showModal(`<h2>Milestones · ${n}/${total}</h2><ul class="milestones">${items}</ul>
    <h3>Worlds</h3><table class="mtable"><tr><th></th>${MILESTONE_KINDS.map((k) => `<th>${k.label}</th>`).join('')}</tr>${rows}</table>`,
    [{ label: 'Close', cls: 'primary', fn: hideModal }]);
}

function openMenu() {
  if (!F.running || F.endShown) return;
  const c = F.craft;
  const btns = [{ label: 'Resume', cls: 'primary', fn: hideModal }];
  if (canRecover()) btns.push({ label: 'Recover vessel', fn: recover });
  btns.push({ label: 'Revert to launch', fn: () => revertFlight(false) });
  btns.push({ label: 'Revert to hangar', fn: () => revertFlight(true) });
  btns.push({ label: 'End flight', fn: confirmEndFlight });
  btns.push({ label: 'Controls', fn: showHelp });
  showModal(`<h2>Paused</h2><p class="muted">${esc(F.craftName)} · ${fmtClock(F.t - F.launchT)} · ${fmtDate(F.t)}</p>`, btns);
}

function canRecover() { const c = F.craft; return c.landed && c.landed.body === HOME && !c.dead && F.flags.maxAlt > 100; }

function confirmEndFlight() {
  const career = isCareer();
  showModal(`<h2>End this flight?</h2><p>The vessel is left behind${career ? ' and its cost is not refunded' : ''}. Your crew is flown home.
    Contracts and science you earned stay. Time moves on to ${fmtDate(F.t)}.</p>`, [
    { label: 'End flight', cls: 'primary', fn: () => { finishFlight(false); showHub(); } },
    { label: 'Cancel', fn: openMenu },
  ]);
}

function showCrashModal() {
  const lost = F.crewLost ? `<p><b>${esc(F.crewLost)}</b> was lost. Reputation −10.</p>` : '';
  showModal(`<h2>Vessel destroyed</h2><p>${esc(F.craftName)} was lost after ${fmtClock(F.t - F.launchT).slice(3)}. ${esc(F.deathReason || '')}.</p>${lost}
    <p class="muted">Tip: land under 6 m/s, or 12 m/s with landing legs. Deploy the parachute well before the ground.</p>`, [
    { label: 'Revert to launch', cls: 'primary', fn: () => revertFlight(false) },
    { label: 'Revert to hangar', fn: () => revertFlight(true) },
    { label: 'Space Centre', fn: () => { finishFlight(false); showHub(); } },
  ]);
}

function recover() {
  const c = F.craft, s = Career.s;
  F.endShown = true;
  let sci = 0, refund = 0, factor = 1;
  const sciLines = [];
  for (const p of c.parts) {
    if (!p.result) continue;
    const r = p.result;
    const g = creditResult(s, r, 1);
    sci += g;
    sciLines.push(`<li>${esc(r.label)} · +${g.toFixed(1)} ⚗</li>`);
    flightEvent({ kind: 'science', body: BODY_BY_ID[r.body], sit: r.sit });
    p.result = null;
  }
  if (isCareer()) {
    const L = c.landed, phi = Math.atan2(L.ry, L.rx);
    factor = recoveryFactor(phi, terrainH(HOME, phi) < 0);
    refund = c.parts.reduce((a, p) => a + partValue(p), 0) * factor;
    addFunds(refund);
  }
  finishFlight(true);
  const names = F.flightMilestones.map((id) => `<li>★ ${milestoneName(id)}</li>`).join('');
  const contracts = F.flightContracts.map((t) => `<li>✓ ${esc(t)}</li>`).join('');
  const visited = F.flags.visited.map((id) => BODY_BY_ID[id].name + (F.flags.landedOn.includes(id) ? ' (landed)' : '')).join(', ');
  showModal(`<h2>Vessel recovered</h2>
    <div class="kv"><span>Mission time</span><b>${fmtClock(F.t - F.launchT).slice(3)}</b></div>
    <div class="kv"><span>Highest altitude</span><b>${fmtDist(F.flags.maxAlt)}</b></div>
    <div class="kv"><span>Worlds visited</span><b>${visited || 'None yet'}</b></div>
    ${isCareer() ? `<div class="kv"><span>Recovery (${Math.round(factor * 100)}% of value)</span><b>+${fmtFunds(refund)}</b></div>` : ''}
    ${isCareer() && sci ? `<div class="kv"><span>Science recovered</span><b>+${sci.toFixed(1)} ⚗</b></div><ul class="plain">${sciLines.join('')}</ul>` : ''}
    ${contracts ? `<h3>Contracts completed</h3><ul class="plain">${contracts}</ul>` : ''}
    ${names ? `<h3>Milestones this flight</h3><ul class="plain">${names}</ul>` : ''}`, [
    { label: 'Space Centre', cls: 'primary', fn: showHub },
    { label: 'Back to hangar', fn: showHangar },
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
    if (!$('hangar').classList.contains('hidden')) hangarKey(e);
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
    case 'KeyB': toggleScience(); break;
    case 'KeyF': cycleMapFocus(); break;
    case 'Escape': openMenu(); break;
    case 'Equal': case 'NumpadAdd': zoomBy(1.25); break;
    case 'Minus': case 'NumpadSubtract': zoomBy(0.8); break;
    default:
      if (/^Digit[1-6]$/.test(e.code)) setSas(SAS_MODES[+e.code.slice(5) - 1]);
  }
}
function zoomBy(f) {
  if (F.map) F.mapZoom = clamp(F.mapZoom * f, 1e-10, 2);
  else F.zoom = clamp(F.zoom * f, 2e-5, 40);
}

function wireUi() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', (e) => { F.keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in F.keys) F.keys[k] = false; });
  $('game').addEventListener('click', (e) => { if (F.map) mapClick(e.clientX, e.clientY); });
  $('game').addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  window.addEventListener('resize', () => { if (!F.running) { Hangar.view = null; drawBuild(); } });

  $('btnLaunch').addEventListener('click', launch);
  $('btnHelp').addEventListener('click', showHelp);
  wireHangar();
  wireHub();
  $('bSci').addEventListener('click', toggleScience);
  $('sciList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sci]');
    if (b) scienceAction(b.dataset.sci, +b.dataset.uid);
  });

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
  loadSave();
  showTitle();
  requestAnimationFrame(loop);
}
window.addEventListener('DOMContentLoaded', boot);
