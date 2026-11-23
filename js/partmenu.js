'use strict';
/* Rocketwright — part menu in flight. Hover a part to see what it's doing; click it to pin a menu with its
   actions (science, parachute, engine, decoupler, docking port) and live settings. */

const PM = { uid: null, pinned: false, x: 0, y: 0, sig: '' };

/* Screen point -> the active craft's local coordinates (undoing the flight camera). */
function screenToCraft(c, sx, sy) {
  const z = F.zoom, rot = F.viewRot || 0;
  const x1 = (sx - F.W / 2) / z, y1 = -(sy - F.H / 2) / z;
  const cr = Math.cos(-rot), sr = Math.sin(-rot);
  const wx = x1 * cr - y1 * sr, wy = x1 * sr + y1 * cr;
  const ax = Math.cos(c.angle), ay = Math.sin(c.angle);
  return [ay * wx - ax * wy + c.xc, ax * wx + ay * wy + c.yc];
}

function partAt(c, sx, sy) {
  if (!c || c.dead) return null;
  if (typeof gfx3d === 'function' && gfx3d()) return pick3d(c, sx, sy);
  const [lx, ly] = screenToCraft(c, sx, sy);
  const pad = Math.max(0.15, 5 / F.zoom);
  for (let i = c.parts.length - 1; i >= 0; i--) {
    const p = c.parts[i], hw = maxWidth(p.def) / 2 + pad;
    if (lx >= p.x - hw && lx <= p.x + hw && ly >= p.bot - pad && ly <= p.top + pad) return p;
  }
  return null;
}

const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);

/* What the part is doing, as a few short lines. */
function partInfo(c, p) {
  const d = p.def, out = [];
  if (d.fuel) out.push(`Fuel ${fmtNum(p.fuel, 2)} / ${fmtNum(d.fuel, 2)} t (${pct(p.fuel, d.fuel)}%)`);
  if (d.mono) out.push(`Monoprop ${fmtNum(p.mono, 2)} / ${fmtNum(d.mono, 2)} t`);
  if (d.ec) out.push(`Charge ${fmtNum(p.ec, 1)} / ${fmtNum(d.ec)}`);
  if (d.solid) out.push(`Solid fuel ${fmtNum(p.solid, 2)} / ${fmtNum(d.solid, 2)} t (${pct(p.solid, d.solid)}%)`);
  if (isEngine(d)) {
    const lim = cfgVal(p, d.solid ? 'srbLimit' : 'thrustLimit');
    const state = !p.ignited ? 'Not started' : p.burn > 0 ? `Burning · ${fmtNum(d.thrust * p.burn)} kN` : d.solid && p.solid <= 0 ? 'Burnt out' : 'Idle (throttle or fuel)';
    out.push(`${state} · limit ${lim}%`);
    out.push(`Max ${d.thrust} kN · Isp ${d.ispSL}–${d.ispVac} s`);
  }
  if (d.chute) {
    const key = d.drogue ? 'drogueAlt' : 'deployAlt';
    const st = p.torn ? 'Torn off' : !p.open ? 'Packed' : p.area > (d.chuteSemi + d.chuteFull) / 2 ? 'Fully open' : 'Partly open';
    out.push(`${st} · opens fully below ${SETTING_DEFS[key].fmt(cfgVal(p, key))}`);
    if (!d.drogue) out.push(`<span class="muted">Tears if it opens fully above ${CHUTE_TEAR_Q} kPa (now ${fmtNum(c.q || 0, 1)})</span>`);
  }
  if (d.gas) out.push(`Argon ${fmtNum(p.gas, 3)} / ${fmtNum(d.gas, 3)} t`);
  if (d.oreCap) out.push(`Ore ${fmtNum(p.ore || 0, 2)} / ${fmtNum(d.oreCap, 1)} t`);
  if (d.scanner) out.push(`Ore in the ground below: ${fmtNum(oreBelow(c, F.t) * 100, 1)}%`);
  if (d.drill) out.push(!p.drilling ? 'Stopped' : !drillOnGround(c, p, F.t) ? 'Not touching the ground' : p.drillRate > 0 ? `Digging ${fmtNum(p.drillRate * 1000, 1)} kg/s` : 'Waiting (no room for ore, no power, or no ore here)');
  if (d.convert) out.push(!p.converting ? 'Stopped' : p.convRate > 0 ? `Making ${p.converting === 'mono' ? 'monopropellant' : 'rocket fuel'} from ${fmtNum(p.convRate * 1000, 1)} kg of ore a second` : 'Waiting (no ore, no power, or tanks full)');
  if (d.prop === 'gas') out.push(`Uses argon and ${d.ecUse} charge/s at full thrust`);
  if (d.prop === 'mono') out.push('Burns monopropellant');
  if (d.fairing) out.push(p.shell ? `Shell on · ${shellH(p)} m tall` : 'Shell thrown off');
  if (d.inflate) out.push(p.inflated ? `Inflated · ${d.wOpen} m wide` : 'Packed');
  if (d.brakeArea) out.push(p.brake ? 'Deployed' : 'Stowed');
  if (d.wheel) out.push(`${p.gearUp ? 'Folded away' : p.touch || (c.landed && c.landed.wheels) ? 'On the ground' : 'Down'}${c.wheelBrake ? ' · brakes on' : ''}`);
  if (d.motor) out.push(`Motor ${d.motor} kN · ↑/↓ drive on the ground`);
  if (d.wing) out.push(`${d.ctrlSurf ? 'Control surface' : 'Wing'} · ${d.wing} m² of lift`);
  if (d.intake) out.push(`Air intake (${d.intake} m²)`);
  if (d.jet) out.push(`Needs oxygen-rich air · ${c.air && c.air.oxygen ? 'air here has oxygen' : 'no oxygen here'}`);
  if (d.cellEC) out.push(p.cellOff ? 'Switched off' : p.cellRun > 0 ? `Making ${fmtNum(p.cellRun, 1)} charge/s` : 'Standing by (batteries full or no fuel)');
  if (d.seats) {
    const n = F.crew.filter((x) => x.pod === p.uid).length;
    out.push(`Seats ${n} / ${d.seats}`);
  }
  if (p.enclosed) out.push('<span class="muted">Inside a fairing</span>');
  if (d.decoupler) out.push(d.crossfeed ? 'Decoupler (lets fuel through)' : 'Decoupler');
  if (d.dock) out.push(p.links.some((u) => { const q = c.byUid.get(u); return q && q.def.dock; }) ? 'Docked' : freePorts(c).includes(p) ? 'Free port' : 'Port (blocked)');
  if (d.solar) out.push('Solar panel');
  if (d.light) out.push(p.lit ? 'On' : 'Off');
  if (d.claw) out.push(p.grabbed != null ? 'Holding on' : p.disarmed ? 'Disarmed' : 'Armed: touch something slowly to grab it');
  if (d.clamp) out.push('Holds the craft down until its stage fires');
  if (d.asteroid) out.push(`About ${fmtNum(p.ore || 0, 1)} t of ore inside · ${fmtNum(p.m, 0)} t in all`);
  if (d.antenna) out.push(`${d.relay ? 'Relay antenna' : 'Antenna'} · reaches ${fmtDist(d.range)}${F.comm ? ` · ${F.comm.ok ? 'signal home' : 'no signal'}` : ''}`);
  if (d.torque) out.push(`Reaction wheels ${d.torque} kN·m`);
  if (d.exp && Career.s && isCareer()) {
    out.push(p.result ? `Holding: ${p.result.label}` : p.spent ? 'Used. Recover it to reset.' : `${EXPERIMENTS[d.exp].name}: ready`);
  }
  const crew = F.crew.filter((x) => x.pod === p.uid);
  if (crew.length) out.push(`👩‍🚀 ${crew.map((x) => x.name).join(', ')}`);
  const mt = partMaxTemp(d);
  if (p.temp > 400) out.push(`<span class="${p.temp / mt > 0.85 ? 'hot' : ''}">Temperature ${fmtNum(p.temp)} / ${fmtNum(mt)} K</span>`);
  out.push(`<span class="muted">${fmtNum(p.m, 2)} t</span>`);
  return out;
}

/* The buttons and sliders a pinned menu offers. */
function partActions(c, p) {
  const d = p.def, a = [];
  if (d.exp && isCareer()) {
    const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], F.t);
    const sit = situationOf(c, b, F.t);
    if (p.result) {
      if (c.parts.some((q) => q.def.antenna) && hasSignal()) a.push(['tx', 'Transmit']);
      a.push(['drop', 'Discard']);
    } else if (canRun(p, b, sit)) a.push(['run', `Run (${subjectLeft(Career.s, subjectId(d.exp, b, sit, sciBiome(c, b, F.t, sit)), subjectCap(d.exp, b, sit)).toFixed(1)} ⚗)`]);
  }
  if (d.chute && !p.open && !p.torn) a.push(['chute', d.drogue ? 'Deploy drogue' : 'Deploy parachute']);
  if (d.chute && (p.open || p.torn) && c.landed && crewHasRole('engineer')) a.push(['repack', 'Repack (engineer)']);
  if (d.fairing && p.shell) a.push(['fairing', 'Open fairing']);
  if (d.inflate && !p.inflated) a.push(['inflate', 'Inflate shield']);
  if (d.brakeArea) a.push(['brake', p.brake ? 'Stow air brakes' : 'Deploy air brakes']);
  if (d.retract) a.push(['gear', p.gearUp ? 'Lower gear' : 'Raise gear']);
  if (d.wheel) a.push(['brake', c.wheelBrake ? 'Release brakes' : 'Brakes on']);
  if (d.cellEC) a.push(['cell', p.cellOff ? 'Switch on' : 'Switch off']);
  if (d.light) a.push(['light', p.lit ? 'Light off' : 'Light on']);
  if (d.claw) a.push(p.grabbed != null ? ['undock', 'Release'] : ['claw', p.disarmed ? 'Arm claw' : 'Disarm claw']);
  if (d.drill) a.push(['drill', p.drilling ? 'Stop drilling' : 'Start drilling']);
  if (d.convert) {
    if (p.converting) a.push(['conv:off', 'Stop refining']);
    else a.push(['conv:fuel', 'Make rocket fuel'], ['conv:mono', 'Make monopropellant']);
  }
  // move fuel or ore between tanks
  for (const [k, cap, what] of [['fuel', 'fuel', 'fuel'], ['ore', 'oreCap', 'ore']]) {
    if (!d[cap] || !c.parts.some((q) => q !== p && q.def[cap])) continue;
    a.push([`pull:${k}`, `Pull ${what} here`], [`push:${k}`, `Push ${what} out`]);
  }
  if (isEngine(d)) {
    if (!p.ignited) a.push(['engOn', 'Start engine']);
    else if (!d.solid) a.push(['engOff', 'Shut down']);
  }
  if (d.decoupler) a.push(['decouple', 'Decouple now']);
  if (d.dock && p.links.some((u) => { const q = c.byUid.get(u); return q && q.def.dock; })) a.push(['undock', 'Undock here']);
  return a;
}
const liveSettings = (d) => partSettingKeys(d).filter((k) => k !== 'fill' && k !== 'fairH');

function renderPartMenu() {
  const el = document.getElementById('partMenu');
  const c = F.craft, p = PM.uid != null && c ? c.byUid.get(PM.uid) : null;
  if (!p || F.map || c.dead) { el.classList.add('hidden'); if (!p || c.dead) { PM.uid = null; PM.pinned = false; } return; }
  el.classList.remove('hidden');
  el.classList.toggle('pinned', PM.pinned);
  document.getElementById('pmTitle').textContent = p.def.name;
  document.getElementById('pmInfo').innerHTML = partInfo(c, p).map((l) => `<div>${l}</div>`).join('');
  const box = document.getElementById('pmActions');
  if (!PM.pinned) { box.innerHTML = '<div class="muted">Click for actions</div>'; PM.sig = ''; }
  else {
    const acts = partActions(c, p), keys = liveSettings(p.def);
    const sig = p.uid + '|' + acts.map((x) => x[0]).join(',') + '|' + keys.join(',');
    if (sig !== PM.sig) {
      PM.sig = sig;
      box.innerHTML = acts.map(([k, label]) => `<button data-pm="${k}">${label}</button>`).join('') +
        keys.map((k) => { const sd = SETTING_DEFS[k], v = cfgVal(p, k);
          return `<label class="set-row"><span>${sd.label}</span><input type="range" data-pmset="${k}" min="${sd.min}" max="${sd.max}" step="${sd.step}" value="${v}"><b>${sd.fmt(v)}</b></label>`; }).join('') ||
        '<div class="muted">Nothing to do with this part.</div>';
    }
  }
  const W = F.W, H = F.H, w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = clamp(PM.x + 16, 6, W - w - 6) + 'px';
  el.style.top = clamp(PM.y + 12, 6, H - h - 6) + 'px';
}

function partMenuAction(kind) {
  const c = F.craft, p = c.byUid.get(PM.uid);
  if (!p) return;
  if (kind === 'run' || kind === 'tx' || kind === 'drop') scienceAction(kind, p.uid);
  else if (kind === 'light') { const on = !p.lit; for (const q of c.lights) if (q === p || (p.sym && q.sym === p.sym)) q.lit = on; }
  else if (kind === 'claw') p.disarmed = !p.disarmed;
  else if (kind === 'drill') { const on = !p.drilling; for (const q of c.drills) if (q === p || (p.sym && q.sym === p.sym)) q.drilling = on; }
  else if (kind.startsWith('conv:')) { const m = kind.slice(5); p.converting = m === 'off' ? null : m; }
  else if (kind.startsWith('pull:') || kind.startsWith('push:')) {
    const k = kind.slice(5), cap = k === 'ore' ? 'oreCap' : k;
    const moved = transferProp(c, p, k, cap, kind.startsWith('pull:'));
    flash(moved > 1e-6 ? `Moved ${fmtNum(moved, 2)} t of ${k}` : `Nothing to move`, 2);
  }
  else if (kind === 'repack') { p.open = false; p.torn = false; p.area = 0; c.chuteOpen = c.chutes.some((q) => q.open); c.recompute(); flash(`${shortName(p.def)} repacked and ready`, 2); }
  else if (kind === 'chute') { p.open = true; c.chuteOpen = true; playSound('chute'); flash(`${shortName(p.def)} deployed`, 2); }
  else if (kind === 'fairing') { p.shell = false; jettisonFairing(c, p); playSound('stage'); flash('Fairing open', 2); }
  else if (kind === 'inflate') { p.inflated = true; c.recompute(); playSound('chute'); flash('Heat shield inflated', 2); }
  else if (kind === 'brake') toggleBrakes();
  else if (kind === 'gear') toggleGear();
  else if (kind === 'cell') { const on = !!p.cellOff; for (const q of c.cells) if (q === p || (p.sym && q.sym === p.sym)) q.cellOff = !on; }
  else if (kind === 'engOn') { p.ignited = true; flash(`${shortName(p.def)} started`, 2); }
  else if (kind === 'engOff') { p.ignited = false; flash(`${shortName(p.def)} shut down`, 2); }
  else if (kind === 'decouple') { fireDecoupler(c, p); PM.uid = null; PM.pinned = false; }
  else if (kind === 'undock') { undock(p); PM.uid = null; PM.pinned = false; }
  PM.sig = '';
  F.dvTick = 0;
  renderPartMenu();
}

/* L: every light on or off. */
function toggleLights() {
  const c = F.craft;
  if (!c || c.dead) return;
  if (!c.lights.length) { flash('No lights on this craft', 2); return; }
  const on = !c.lights.some((p) => p.lit);
  for (const p of c.lights) p.lit = on;
  flash(on ? 'Lights on' : 'Lights off', 1.5);
}

/* ---------------- action groups ----------------
   Parts can be put in groups 1–5 and an Abort group in the hangar. Alt+1–5 fires a group, Backspace aborts:
   each part does its main thing (engines start or stop, decouplers fire, parachutes open, lights and gear
   toggle, and so on). Abort also cuts the throttle. */
const GROUP_KEYS = ['1', '2', '3', '4', '5', 'abort'];
function groupAct(c, p) {
  const d = p.def;
  if (d.decoupler) fireDecoupler(c, p);
  else if (isEngine(d)) { if (!d.solid || !p.ignited) p.ignited = !p.ignited; }
  else if (d.chute) { if (!p.open && !p.torn) { p.open = true; c.chuteOpen = true; } }
  else if (d.fairing) { if (p.shell) { p.shell = false; jettisonFairing(c, p); } }
  else if (d.inflate) p.inflated = true;
  else if (d.brakeArea) p.brake = !p.brake;
  else if (d.retract) p.gearUp = !p.gearUp;
  else if (d.light) p.lit = !p.lit;
  else if (d.drill) p.drilling = !p.drilling;
  else if (d.convert) p.converting = p.converting ? null : 'fuel';
  else if (d.cellEC) p.cellOff = !p.cellOff;
  else if (d.claw) p.disarmed = !p.disarmed;
  else if (d.exp && isCareer()) scienceAction('run', p.uid);
}
function fireGroup(key) {
  const c = F.craft;
  if (!c || c.dead) return;
  if (!hasControl(c)) { flash('No control', 2); return; }
  if (key === 'abort') c.throttle = 0;
  const parts = ((c.actionGroups && c.actionGroups[key]) || []).map((u) => c.byUid.get(u)).filter(Boolean);
  if (!parts.length) { flash(key === 'abort' ? 'ABORT: throttle cut (put parts in the Abort group in the hangar)' : `Action group ${key} is empty. Add parts to it in the hangar.`, 2.5); return; }
  for (const p of parts) if (c.byUid.get(p.uid) === p) groupAct(c, p);
  c.recompute();
  F.dvTick = 0;
  playSound(key === 'abort' ? 'stage' : 'chute');
  flash(key === 'abort' ? 'ABORT!' : `Action group ${key}`, 2);
}

/* Fire one decoupler on its own (not as part of a stage). */
function fireDecoupler(c, p) {
  const present = new Set(c.parts.map((q) => q.uid));
  const det = new Set(c.detachedFrom(p.uid, present));
  if (!det.size) return;
  for (const comp of components(c.parts.filter((q) => det.has(q.uid)))) separatePiece(c, comp, p);
  c.parts = c.parts.filter((q) => !det.has(q.uid));
  c.recompute();
  playSound('stage');
  flash('Decoupled', 2);
}

function wirePartMenu() {
  const game = document.getElementById('game'), el = document.getElementById('partMenu');
  game.addEventListener('pointermove', (e) => {
    if (!F.running || F.map || PM.pinned || F.handleDrag) return;
    const p = partAt(F.craft, e.clientX, e.clientY);
    PM.uid = p ? p.uid : null;
    PM.x = e.clientX; PM.y = e.clientY;
    renderPartMenu();
  });
  game.addEventListener('pointerleave', () => { if (!PM.pinned) { PM.uid = null; renderPartMenu(); } });
  game.addEventListener('pointerdown', (e) => {
    if (!F.running || F.map || F.paused) return;
    const p = partAt(F.craft, e.clientX, e.clientY);
    if (p) { PM.uid = p.uid; PM.pinned = true; PM.x = e.clientX; PM.y = e.clientY; PM.sig = ''; }
    else { PM.uid = null; PM.pinned = false; }
    renderPartMenu();
  });
  el.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') e.preventDefault(); });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pm) partMenuAction(b.dataset.pm);
    else if (b.id === 'pmClose') { PM.uid = null; PM.pinned = false; renderPartMenu(); }
    b.blur();
  });
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.pmset, c = F.craft, p = c && c.byUid.get(PM.uid);
    if (!k || !p) return;
    p.cfg = { ...(p.cfg || {}), [k]: +e.target.value };
    if (p.sym) for (const q of c.parts) if (q.sym === p.sym) q.cfg = { ...(q.cfg || {}), [k]: +e.target.value };
    e.target.nextElementSibling.textContent = SETTING_DEFS[k].fmt(+e.target.value);
    if (k === 'deployAlt') c.chuteAlt = Math.max(0, ...c.parts.filter((q) => q.def.chute).map((q) => cfgVal(q, 'deployAlt')));
    if (k === 'fairH') c.recompute();
    F.dvTick = 0;
  });
  el.addEventListener('change', (e) => e.target.blur());
}

/* Brakes (K): air brakes swing out and wheels grip. */
function toggleBrakes() {
  const c = F.craft;
  if (!c || c.dead || (!c.brakes.length && !c.wheels.length)) return;
  const on = !(c.wheelBrake || c.brakes.some((p) => p.brake));
  for (const p of c.brakes) p.brake = on;
  c.wheelBrake = on;
  flash(on ? 'Brakes on' : 'Brakes off', 1.5);
}
/* Landing gear up or down (G). */
function toggleGear() {
  const c = F.craft;
  const g = c && !c.dead ? c.wheels.filter((p) => p.def.retract) : [];
  if (!g.length) { if (c && !c.dead) flash('No folding landing gear on this craft', 2); return; }
  const up = !g.some((p) => p.gearUp);
  for (const p of g) p.gearUp = up;
  if (c.landed && c.landed.wheels && up) c.landed.wheels = false;
  flash(up ? 'Gear up' : 'Gear down', 1.5);
}
