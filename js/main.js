'use strict';
/* Rocketwright — hangar (rocket builder), menus and the main loop. */

const $ = (id) => document.getElementById(id);
const Hangar = { design: [], sel: -1, name: 'Orbiter I', view: null };

/* ---------------- hangar ---------------- */

function partStatsLine(d) {
  if (d.kind === 'engine') return `${d.thrust} kN · Isp ${d.ispSL}/${d.ispVac} s · ${d.mass} t`;
  if (d.kind === 'srb') return `${d.thrust} kN · ${d.solid} t solid · ${(d.mass + d.solid).toFixed(1)} t`;
  if (d.kind === 'tank') return `${d.fuel} t fuel · ${(d.mass + d.fuel).toFixed(2)} t full`;
  if (d.torque) return `${d.torque} kN·m torque · ${d.mass} t`;
  return `${d.mass} t`;
}

function buildPalette() {
  const pal = $('palette');
  pal.innerHTML = '';
  for (const cat of CATEGORIES) {
    const h = document.createElement('div');
    h.className = 'cat-title';
    h.textContent = cat;
    pal.appendChild(h);
    for (const id of PART_ORDER) {
      const d = PART_DEFS[id];
      if (d.cat !== cat) continue;
      const b = document.createElement('button');
      b.className = 'part-btn';
      b.title = d.desc;
      const cv = document.createElement('canvas');
      drawPartIcon(cv, id);
      const txt = document.createElement('div');
      txt.innerHTML = `<div class="pname"></div><div class="pstat"></div>`;
      txt.querySelector('.pname').textContent = d.name;
      txt.querySelector('.pstat').textContent = partStatsLine(d);
      b.append(cv, txt);
      b.addEventListener('click', () => addPart(id));
      pal.appendChild(b);
    }
  }
}

function addPart(id) {
  let at = Hangar.sel >= 0 ? Hangar.sel + 1 : Hangar.design.length;
  if (Hangar.sel < 0 && id === 'chute' && Hangar.design[0] === 'pod') at = 0;
  Hangar.design.splice(at, 0, id);
  Hangar.sel = at;
  hangarChanged();
}
function removeSel() {
  if (Hangar.sel < 0) return;
  Hangar.design.splice(Hangar.sel, 1);
  Hangar.sel = Math.min(Hangar.sel, Hangar.design.length - 1);
  if (!Hangar.design.length) Hangar.sel = -1;
  hangarChanged();
}
function moveSel(dir) {
  const i = Hangar.sel, j = i + dir;
  if (i < 0 || j < 0 || j >= Hangar.design.length) return;
  [Hangar.design[i], Hangar.design[j]] = [Hangar.design[j], Hangar.design[i]];
  Hangar.sel = j;
  hangarChanged();
}

function hangarChanged() {
  Store.set('current', { name: Hangar.name, design: Hangar.design });
  drawBuild();
  updateStats();
}

function drawBuild() {
  const cv = $('buildCanvas');
  const box = cv.parentElement.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(50, box.width), H = Math.max(50, box.height);
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(79,209,255,0.07)';
  ctx.lineWidth = 1;
  for (let x = (W / 2) % 24; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const sel = $('selTools');
  if (!Hangar.design.length) { Hangar.view = null; sel.classList.add('hidden'); return; }
  const c = new Craft(makeParts(Hangar.design));
  const L = c.length;
  const extraBot = c.hasLegs || c.hasFins ? 1.5 : 0.5;
  const scale = Math.min(42, (H - 90) / (L + extraBot + 1), (W - 140) / 6);
  const topPx = (H - (L + extraBot) * scale) / 2 + 10;
  Hangar.view = { scale, topPx, W, H, c };
  ctx.save();
  ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, (dpr * W) / 2, dpr * topPx);
  for (const p of c.parts) drawPart(ctx, p, 1 / scale, p.def.legs ? c.footY : undefined);
  if (Hangar.sel >= 0 && c.parts[Hangar.sel]) {
    const p = c.parts[Hangar.sel];
    ctx.strokeStyle = '#4fd1ff';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([4 / scale, 3 / scale]);
    ctx.strokeRect(-1.25, p.bot - 0.08, 2.5, p.def.h + 0.16);
    ctx.setLineDash([]);
  }
  ctx.restore();
  // stage brackets on the left
  const [lo, hi] = segRange(c.parts);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let s = lo; s <= hi; s++) {
    const ps = c.parts.filter((p) => p.seg === s);
    const yTop = topPx - ps[0].top * scale, yBot = topPx - ps[ps.length - 1].bot * scale;
    const x = W / 2 - 2.6 * scale - 10;
    ctx.strokeStyle = 'rgba(255,179,71,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 6, yTop + 2); ctx.lineTo(x, yTop + 2); ctx.lineTo(x, yBot - 2); ctx.lineTo(x + 6, yBot - 2); ctx.stroke();
    ctx.fillStyle = '#ffb347';
    ctx.fillText(`Stage ${hi - s + 1}`, x - 6, (yTop + yBot) / 2 + 4);
  }
  // selection tools
  if (Hangar.sel >= 0 && c.parts[Hangar.sel]) {
    const p = c.parts[Hangar.sel];
    sel.classList.remove('hidden');
    $('selName').textContent = p.def.name;
    const y = topPx - ((p.top + p.bot) / 2) * scale;
    sel.style.top = clamp(y - 18, 4, H - 40) + 'px';
    sel.style.left = W / 2 + 2.7 * scale + 12 + 'px';
  } else sel.classList.add('hidden');
}

function buildClick(e) {
  const v = Hangar.view;
  if (!v) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const lx = (sx - v.W / 2) / v.scale, ly = (v.topPx - sy) / v.scale;
  let hit = -1;
  if (Math.abs(lx) < 2.6) v.c.parts.forEach((p, i) => { if (ly <= p.top && ly >= p.bot) hit = i; });
  Hangar.sel = hit;
  drawBuild();
}

function updateStats() {
  const a = analyzeDesign(Hangar.design);
  $('statSummary').innerHTML = `
    <div class="kv"><span>Mass</span><b>${fmtNum(a.mass, 2)} t</b></div>
    <div class="kv"><span>Height</span><b>${fmtNum(a.height, 1)} m</b></div>
    <div class="kv"><span>Parts</span><b>${Hangar.design.length}</b></div>
    <div class="kv big-kv"><span>Total Δv (vacuum)</span><b>${fmtNum(a.total)} m/s</b></div>`;
  const list = $('stageList');
  list.innerHTML = '';
  const rowBySeg = {};
  for (const r of a.rows) rowBySeg[r.seg] = r;
  a.actions.forEach((act, i) => {
    const d = document.createElement('div');
    d.className = 'stage-row';
    const r = act.ignite !== undefined && act.ignite >= 0 ? rowBySeg[act.ignite] : null;
    const label = document.createElement('div');
    label.className = 'stage-label';
    label.textContent = `${i + 1}. ${stageLabel(act, a.parts)}`;
    d.appendChild(label);
    if (r) {
      const s = document.createElement('div');
      s.className = 'stage-stats';
      s.textContent = `Δv ${fmtNum(r.dv)} m/s · TWR ${r.twr.toFixed(2)} (vac ${r.twrVac.toFixed(2)}) · ${fmtNum(r.burn)} s`;
      d.appendChild(s);
    }
    list.appendChild(d);
  });
  if (!a.actions.length) list.innerHTML = '<div class="muted">No stages yet.</div>';
  const w = $('warnings');
  w.innerHTML = '';
  for (const x of a.warnings) {
    const d = document.createElement('div');
    d.className = 'warn ' + x.lvl;
    d.textContent = x.text;
    w.appendChild(d);
  }
  $('btnLaunch').disabled = !a.valid;
}

function fillLoadSelect() {
  const s = $('loadSelect');
  s.innerHTML = '<option value="">Load a craft…</option>';
  const g1 = document.createElement('optgroup');
  g1.label = 'Example crafts';
  for (const n of Object.keys(PRESETS)) { const o = document.createElement('option'); o.value = 'p:' + n; o.textContent = n; g1.appendChild(o); }
  s.appendChild(g1);
  const saved = Store.get('saved', {});
  const names = Object.keys(saved);
  if (names.length) {
    const g2 = document.createElement('optgroup');
    g2.label = 'Your saved crafts';
    for (const n of names) { const o = document.createElement('option'); o.value = 's:' + n; o.textContent = n; g2.appendChild(o); }
    s.appendChild(g2);
  }
}

function loadCraft(name, design) {
  Hangar.name = name;
  Hangar.design = design.filter((id) => PART_DEFS[id]);
  Hangar.sel = -1;
  $('craftName').value = name;
  hangarChanged();
}

/* ---------------- screens & modals ---------------- */

function showHangar() {
  F.running = false;
  hideModal();
  $('flight').classList.add('hidden');
  $('hangar').classList.remove('hidden');
  drawBuild();
  updateStats();
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
<h2>How to fly</h2>
<p><b>Build</b> a rocket in the hangar from the top down: capsule, fuel tanks, then an engine. A <b>decoupler</b> splits the
rocket into stages. Engines only burn fuel from their own stage. The right panel shows each stage's Δv (how much speed it can add) and TWR
(thrust-to-weight; it must be above 1 to lift off).</p>
<div class="keys">
  <div><kbd>Space</kbd> Stage: ignite, separate, parachute</div>
  <div><kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd> Rotate</div>
  <div><kbd>W</kbd>/<kbd>S</kbd>, <kbd>Shift</kbd>, <kbd>↑</kbd>/<kbd>↓</kbd> Throttle</div>
  <div><kbd>Z</kbd> Full throttle · <kbd>X</kbd> Cut throttle</div>
  <div><kbd>T</kbd> Toggle SAS · <kbd>1</kbd>–<kbd>6</kbd> SAS modes</div>
  <div><kbd>M</kbd> Map view · <kbd>F</kbd> Map focus</div>
  <div><kbd>,</kbd>/<kbd>.</kbd> Time warp slower / faster</div>
  <div>Mouse wheel: zoom · <kbd>Esc</kbd> Menu</div>
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
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); removeSel(); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); if (e.shiftKey) moveSel(-1); else { Hangar.sel = Math.max(0, Hangar.sel - 1); drawBuild(); } }
    else if (e.code === 'ArrowDown') { e.preventDefault(); if (e.shiftKey) moveSel(1); else { Hangar.sel = Math.min(Hangar.design.length - 1, Hangar.sel + 1); drawBuild(); } }
    else if (e.code === 'Escape') { Hangar.sel = -1; drawBuild(); }
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
  window.addEventListener('resize', () => { if (!F.running) drawBuild(); });

  $('buildCanvas').addEventListener('click', buildClick);
  $('selUp').addEventListener('click', () => moveSel(-1));
  $('selDown').addEventListener('click', () => moveSel(1));
  $('selDel').addEventListener('click', removeSel);
  $('btnLaunch').addEventListener('click', launch);
  $('btnHelp').addEventListener('click', showHelp);
  $('btnMilestones').addEventListener('click', showMilestones);
  $('craftName').addEventListener('input', (e) => { Hangar.name = e.target.value.trim() || 'Untitled'; Store.set('current', { name: Hangar.name, design: Hangar.design }); });
  $('btnSave').addEventListener('click', () => {
    const saved = Store.get('saved', {});
    saved[Hangar.name] = Hangar.design.slice();
    Store.set('saved', saved);
    fillLoadSelect();
    const b = $('btnSave'); b.textContent = 'Saved ✓'; setTimeout(() => { b.textContent = 'Save'; }, 1200);
  });
  $('btnClear').addEventListener('click', () => { Hangar.design = []; Hangar.sel = -1; hangarChanged(); });
  $('loadSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    const name = v.slice(2);
    if (v[0] === 'p') loadCraft(name, PRESETS[name]);
    else loadCraft(name, Store.get('saved', {})[name] || []);
    e.target.value = '';
  });

  // flight HUD buttons (never keep focus, so Space keeps staging)
  document.querySelectorAll('#flight button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  $('bStage').addEventListener('click', doStage);
  $('bMap').addEventListener('click', toggleMap);
  $('bMenu').addEventListener('click', openMenu);
  $('bWarpUp').addEventListener('click', () => changeWarp(1));
  $('bWarpDn').addEventListener('click', () => changeWarp(-1));
  $('bRecover').addEventListener('click', recover);
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
  if (cur && Array.isArray(cur.design) && cur.design.length) loadCraft(cur.name || 'Untitled', cur.design);
  else loadCraft('Orbiter I', PRESETS['Orbiter I']);
  if (!Store.get('seenHelp', false)) { Store.set('seenHelp', true); showHelp(); }
  requestAnimationFrame(loop);
}
window.addEventListener('DOMContentLoaded', boot);
