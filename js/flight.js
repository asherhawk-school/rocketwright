'use strict';
/* Rocketwright — flight scene: physics, time warp, camera, map view, HUD. */

const WARPS = [1, 2, 3, 4, 10, 50, 100, 1000, 10000, 100000, 1000000];
const PHYS_DT = 0.02;
const SAS_MODES = ['off', 'stab', 'pro', 'retro', 'radout', 'radin', 'node', 'tgt', 'kill'];
const PATH_COLORS = ['#4fd1ff', '#ffb347', '#c792ff', '#7dffa8'];

const F = {
  running: false, paused: false, craft: null, debris: [], particles: [],
  t: 0, acc: 0, warp: 0, zoom: 6, mapZoom: 0, map: false, mapFocus: 'soi', mapPan: [0, 0], mapPress: null,
  rotOffset: 0, lastBody: null, sas: 'stab', hold: null, userRot: 0,
  keys: Object.create(null), pred: null, predTick: 0, orbit: null, encounter: null,
  flags: null, flightMilestones: [], deadTimer: 0, endShown: false,
  design: null, craftName: '', canvas: null, ctx: null, W: 0, H: 0, dpr: 1,
  stars: [], clouds: [], frame: 0, hud: {}, nav: null, navCtx: null,
};

function initFlightView() {
  F.canvas = document.getElementById('game');
  F.ctx = F.canvas.getContext('2d');
  F.nav = document.getElementById('navball');
  F.navCtx = F.nav.getContext('2d');
  for (let i = 0; i < 280; i++) F.stars.push([Math.random(), Math.random(), Math.random() * 1.3 + 0.3, 0.4 + Math.random() * 0.6]);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 80; i++) F.clouds.push({ phi: PAD_PHI + (rnd() - 0.5) * 0.5, alt: 1500 + rnd() * 5000, w: 250 + rnd() * 700, h: 60 + rnd() * 120 });
  for (const id of ['hBiome', 'hBiomeRow', 'hAlt', 'hSpd', 'hVs', 'hRadar', 'hRadarW', 'hBody', 'hAp', 'hPe', 'hTAp', 'hTPe', 'hPer', 'hEncRow', 'hEncLabel', 'hEnc', 'hEnc2Row', 'hEnc2Label', 'hEnc2',
    'hClock', 'hWarp', 'thrFill', 'thrPct', 'hDv', 'hDvT', 'hTwr', 'fLiq', 'fSol', 'fLiqRow', 'fSolRow', 'fMono', 'fMonoRow', 'fGas', 'fGasRow', 'bGear', 'bBrakes', 'bQSave', 'bQLoad', 'bRcs', 'hNext', 'hPitch',
    'bRecover', 'bMap', 'msg', 'mapHint', 'bSci', 'sciPanel', 'sciList', 'sciWhere', 'hudContracts', 'hG', 'hEcc', 'heatWarn', 'fEc', 'fEcRow', 'fEcRate', 'hudTarget', 'tName', 'tDist', 'tClose', 'tCloseLabel', 'tPhase', 'tPhaseRow', 'tWin', 'tWinRow', 'mapTools', 'bNodeAp', 'bNodePe', 'nodePanel', 'nInfo', 'nPro', 'nRad', 'nTime', 'nBurn', 'tRel', 'tRelRow', 'tDock', 'tDockRow', 'bUndock', 'bSwitch']) F.hud[id] = document.getElementById(id);
  resizeFlight();
  window.addEventListener('resize', resizeFlight);
}

function resizeFlight() {
  F.dpr = Math.min(2, window.devicePixelRatio || 1);
  F.W = window.innerWidth; F.H = window.innerHeight;
  F.canvas.width = Math.round(F.W * F.dpr); F.canvas.height = Math.round(F.H * F.dpr);
  F.nav.width = 150 * F.dpr; F.nav.height = 150 * F.dpr;
}

/* ---------------- flight lifecycle ---------------- */

function flightStart(design, name, opts = {}) {
  F.design = cloneDesign(design);
  F.craftName = name || 'Untitled';
  const parts = layoutDesign(F.design);
  const c = new Craft(parts, { stages: stageListFrom(resolveStages(F.design, parts)) });
  c.recompute();
  const lowest = Math.min(...c.contacts.map((p) => p[1]));
  const padTop = HOME.R + terrainH(HOME, PAD_PHI);
  c.angle = Math.PI / 2;
  c.pos = [c.xc, padTop - (lowest - c.yc) + 0.02];
  c.vel = [0, 0];
  c.landed = { body: HOME, rx: c.pos[0], ry: c.pos[1] };
  F.site = opts.site === 'runway' ? 'runway' : 'pad';
  if (typeof document !== 'undefined' && document.getElementById('flight')) document.getElementById('flight').classList.remove('map-on');
  if (F.site === 'runway') placeOnRunway(c);
  Object.assign(F, {
    craft: c, debris: [], others: [], particles: [], t: opts.t0 || 0, launchT: opts.t0 || 0, crew: opts.crew || [], crewLost: [],
    vid: opts.vid || newVesselId(), canRevert: true, kind: 'ship', dockedMeta: {},
    flightContracts: [], sciOpen: false, node: null, target: F.target && opts.keepTarget ? F.target : null, acc: 0, warp: 0, sas: 'stab', hold: null, map: false, mapZoom: 0, mapFocus: 'soi', mapPan: [0, 0], mapPress: null,
    deadTimer: 0, endShown: false, pred: null, encounter: null, orbit: null, lastBody: HOME, rotOffset: 0, paused: false,
    flags: { space: false, maxAlt: 0, visited: [], landedOn: [] }, flightMilestones: [], running: true,
    dvTick: 0, dvCache: null, rcsTx: 0, rcsTy: 0,
  });
  F.zoom = clamp((F.H * 0.42) / (c.length + 8), 2, 30);
  for (const k in F.keys) F.keys[k] = false;
  updateSasButtons();
  flash(F.site === 'runway' ? `${F.craftName} is on the runway. SPACE starts the engines, Z for full throttle, A/D to pull up.`
    : `${F.craftName} is on the pad. Press SPACE to launch!`, 5);
}

/* Lay a plane or rover on the runway, wheels down, nose pointing east along it. */
function placeOnRunway(c) {
  // the side with the most wheels is the underside; mirror the craft so that's +x (which points down)
  let side = 0;
  for (const w of c.wheels) side += Math.sign(wheelPoint(w)[0] - c.xc);
  if (side < 0) {
    for (const p of c.parts) { p.x = -p.x; p.flip = !p.flip; }
    c.xc = undefined;
    c.recompute();
  }
  let down = -Infinity;
  for (const w of c.wheels) if (!w.gearUp) down = Math.max(down, wheelPoint(w)[0] - c.xc);
  for (const [lx] of c.contacts) down = Math.max(down, lx - c.xc);
  const phi = PAD_PHI - RUNWAY_START - 30 / HOME.R;
  const r = HOME.R + terrainH(HOME, phi) + down + 0.01;
  c.angle = phi - Math.PI / 2;
  c.pos = [r * Math.cos(phi), r * Math.sin(phi)];
  c.vel = [0, 0];
  c.landed = { body: HOME, rx: c.pos[0], ry: c.pos[1], wheels: c.wheels.some((w) => !w.gearUp) };
}

function newVesselId() {
  const s = universe();
  return s ? s.vesselSeq++ : Math.floor(Math.random() * 1e9);
}
/* What we keep about the vessel being flown, besides its parts and motion. */
function activeMeta() {
  return { id: F.vid, name: F.craftName, crew: F.crew, launchT: F.launchT, flags: F.flags, kind: F.kind, docked: F.dockedMeta || {} };
}

/* Take control of a stored vessel. */
function flightLoadVessel(v, t) {
  advanceVessel(v, t);
  const s = universe();
  s.vessels = s.vessels.filter((x) => x !== v);
  const c = craftFromVessel(v);
  Object.assign(F, {
    craft: c, debris: [], others: [], particles: [], t, launchT: v.launchT, crew: v.crew || [], crewLost: [],
    vid: v.id, canRevert: false, kind: v.kind || 'ship', design: null, craftName: v.name, dockedMeta: v.docked || {},
    flightContracts: [], sciOpen: false, node: null, acc: 0, warp: 0, sas: 'stab', hold: null, map: false, mapZoom: 0, mapFocus: 'soi', mapPan: [0, 0], mapPress: null,
    deadTimer: 0, endShown: false, pred: null, encounter: null, orbit: null, lastBody: c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t),
    rotOffset: 0, paused: false, flags: v.flags || { space: true, maxAlt: 0, visited: [], landedOn: [] }, flightMilestones: [], running: true,
    dvTick: 0, dvCache: null, rcsTx: 0, rcsTy: 0, predTick: 0,
  });
  F.zoom = clamp((F.H * 0.42) / (c.length + 8), 2, 30);
  for (const k in F.keys) F.keys[k] = false;
  updateSasButtons();
  flash(`Now flying ${v.name}`, 3);
  saveCheckpoint();
}

/* Put loaded nearby vessels back into the save as records. */
function unloadOthers() {
  const s = universe();
  if (!s) { F.others = []; return; }
  for (const o of F.others) if (!o.dead) s.vessels.push(vesselFromCraft(o, F.t, o.meta));
  F.others = [];
}

/* Load stored vessels that come within physics range; unload those that drift away. */
function syncOthers() {
  const s = universe();
  if (!s || F.warp > 3) { if (F.others.length) unloadOthers(); return; }
  const c = F.craft;
  const lost = advanceAll(F.t);
  for (const v of lost) {
    toast(`${v.name} was lost${v.lostAt ? ' at ' + BODY_BY_ID[v.lostAt].name : ''}`);
    if (isCareer()) crewLost(v.crew);
  }
  for (const v of s.vessels.slice()) {
    if (Math.hypot(v.s[0] - c.pos[0], v.s[1] - c.pos[1]) < PHYSICS_RANGE) {
      const o = craftFromVessel(v);
      o.meta = { id: v.id, name: v.name, crew: v.crew, launchT: v.launchT, flags: v.flags, kind: v.kind };
      F.others.push(o);
      s.vessels = s.vessels.filter((x) => x !== v);
    }
  }
  for (const o of F.others.slice()) {
    if (o.dead) { F.others = F.others.filter((x) => x !== o); continue; }
    if (Math.hypot(o.pos[0] - c.pos[0], o.pos[1] - c.pos[1]) > UNLOAD_RANGE) {
      s.vessels.push(vesselFromCraft(o, F.t, o.meta));
      F.others = F.others.filter((x) => x !== o);
    }
  }
}

/* Swap control to another vessel (a loaded neighbour, or one stored anywhere). */
function switchToVessel(vid) {
  const s = universe();
  const near = F.others.find((o) => o.vid === vid);
  if (!F.craft.dead) {
    const rec = vesselFromCraft(F.craft, F.t, activeMeta());
    if (near) { const o = craftFromVessel(rec); o.meta = activeMeta(); F.others.push(o); }
    else s.vessels.push(rec);
  }
  if (near) {
    F.others = F.others.filter((o) => o !== near);
    const keepOthers = F.others, keepDebris = F.debris, t = F.t;
    flightLoadVessel(vesselFromCraft(near, t, near.meta), t);
    F.others = keepOthers;
    F.debris = keepDebris;
  } else {
    unloadOthers();
    const v = s.vessels.find((x) => x.id === vid);
    if (v) flightLoadVessel(v, F.t);
  }
  persist();
}

function doStage() {
  const c = F.craft;
  if (c.dead || c.stageIdx >= c.stages.length) return;
  if (!hasControl(c)) { flash('No control: the probe core has no power', 2); return; }
  const first = c.stageIdx === 0;
  const stageIds = (c.stages[c.stageIdx] || []).map((u) => c.byUid.get(u)).filter(Boolean).map((p) => p.id);
  const res = c.activateNext((comp, dec) => separatePiece(c, comp, dec));
  if (res) {
    const b = soiBody(c.pos[0], c.pos[1], F.t), bp = bodyPos(b, F.t), bv = bodyVel(b, F.t);
    flightEvent({ kind: 'stage', body: b, alt: Math.hypot(c.pos[0] - bp[0], c.pos[1] - bp[1]) - b.R,
      speed: Math.hypot(c.vel[0] - bv[0], c.vel[1] - bv[1]), partIds: stageIds });
  }
  if (!res) return;
  const msgs = [];
  if (res.separated) msgs.push(res.separated > 1 ? `${res.separated} pieces separated` : 'Stage separated');
  if (res.ignited.length) {
    const names = [...new Set(res.ignited.map((p) => shortName(p.def)))].join(', ');
    msgs.push(`Ignition: ${names}`);
    if (first && c.throttle === 0) c.throttle = 1;
  }
  if (res.fairings) { for (const f of res.fairings) jettisonFairing(c, f); msgs.push('Fairing open'); }
  if (res.inflated) msgs.push('Heat shield inflated');
  if (res.chute) { msgs.push('Parachute deployed'); playSound('chute'); }
  else playSound('stage');
  F.dvTick = 0;
  if (msgs.length) flash(msgs.join(' · '));
}

/* The two halves of a fairing shell, thrown off sideways as debris. */
function jettisonFairing(c, f) {
  const H = shellH(f), hw = f.def.shellW / 2;
  for (const s of [-1, 1]) {
    const def = { kind: 'fairHalf', name: 'Fairing half', mass: SHELL_MASS_PER_M * f.def.shellW * H / 2, h: H, w: hw, maxTemp: 2000 };
    const part = { uid: 1, id: 'fairHalf', def, x: f.x + s * hw / 2, top: f.top + H, bot: f.top, flip: s < 0, inv: false, links: [], cfg: {},
      fuel: 0, solid: 0, mono: 0, gas: 0, ec: 0, ablator: 0, temp: f.temp, burn: 0, m: 0, side: s };
    const d = new Craft([part]);
    d.angle = c.angle;
    d.xc = undefined;
    d.recompute();
    d.pos = c.toWorld(part.x, (part.top + part.bot) / 2);
    const wv = c.rotLocal(s * 4, 0.5);
    d.vel = [c.vel[0] + wv[0], c.vel[1] + wv[1]];
    d.angVel = c.angVel - s * 0.6;
    F.debris.push(d);
  }
  c.recompute();
  F.dvTick = 0;
}

/* Join a neighbouring vessel at the docking ports found by findDock. */
function dockWith(o, dk) {
  const c = F.craft;
  const off = dockCrafts(c, dk.pa, o, dk.pb);
  if (o.meta) F.dockedMeta[dk.pb.uid + off] = { id: o.meta.id, name: o.meta.name, kind: o.meta.kind, launchT: o.meta.launchT };
  const crew = ((o.meta && o.meta.crew) || []).map((x) => ({ ...x, pod: x.pod + off }));
  F.crew = F.crew.concat(crew);
  if (o.meta && o.meta.flags) for (const w of o.meta.flags.visited || []) if (!F.flags.visited.includes(w)) F.flags.visited.push(w);
  F.others = F.others.filter((x) => x !== o);
  if (F.target && F.target.vid === o.vid) F.target = null;
  F.predTick = 0;
  F.dvTick = 0;
  playSound('dock');
  flash(`Docked with ${o.meta ? o.meta.name : 'vessel'}${crew.length ? ` · ${crewNames(crew).join(', ')} aboard` : ''}`, 4);
}
function undock(at) {
  const c = F.craft;
  const pairs = dockedPairs(c);
  if (!pairs.length || c.dead) return;
  const [p, q] = (at && pairs.find((pr) => pr.includes(at))) || pairs[pairs.length - 1];
  const leaving = undockParts(c, p, q);
  if (!leaving.length) return;
  const port = leaving.includes(p) ? p : q;
  F.sepMeta = F.dockedMeta[port.uid] || null;
  delete F.dockedMeta[port.uid];
  separatePiece(c, leaving, port);
  F.sepMeta = null;
  c.parts = c.parts.filter((x) => !leaving.includes(x));
  c.recompute();
  F.dvTick = 0;
  playSound('stage');
  flash('Undocked', 2);
}

/* Turn a piece that just separated into its own falling craft and push the two apart. */
function separatePiece(c, comp, dec) {
  let m = 0, mx = 0, my = 0;
  for (const p of comp) { m += p.m; mx += p.m * p.x; my += (p.m * (p.top + p.bot)) / 2; }
  const cx = mx / m, cy = my / m;
  const d = new Craft(comp);
  d.angle = c.angle;
  d.xc = undefined;
  d.recompute();
  d.pos = c.toWorld(d.xc, d.yc);
  // side pieces get pushed sideways, stacked pieces along the axis
  const dx = cx - c.xc, dy = cy - c.yc;
  const side = dec.def.radial || Math.abs(dx) > 0.6;
  const dir = side ? [Math.sign(dx) || 1, -0.15] : [0, Math.sign(dy) || -1];
  const push = side ? 3 : 1.5;
  const wv = c.rotLocal(dir[0] * push, dir[1] * push);
  const share = m / (m + c.M);
  d.vel = [c.vel[0] + wv[0] * (1 - share), c.vel[1] + wv[1] * (1 - share)];
  if (!c.landed) { c.vel[0] -= wv[0] * share; c.vel[1] -= wv[1] * share; }
  d.angVel = c.angVel + (side ? -(Math.sign(dx) || 1) * 0.25 : (Math.random() - 0.5) * 0.06);
  d.throttle = 0;
  d.landed = null;
  if (comp.some((p) => p.def.pod || p.def.probe)) {
    const uids = new Set(comp.map((p) => p.uid));
    const crew = F.crew.filter((x) => uids.has(x.pod));
    F.crew = F.crew.filter((x) => !uids.has(x.pod));
    const named = comp.some((p) => p.def.pod) ? 'Capsule' : 'Probe', was = F.sepMeta;
    d.vid = was ? was.id : newVesselId();
    d.meta = { id: d.vid, name: was ? was.name : `${F.craftName} ${named}`, crew, launchT: was ? was.launchT : F.launchT,
      flags: JSON.parse(JSON.stringify(F.flags)), kind: was && was.kind !== 'stranded' ? was.kind : 'ship' };
    F.others.push(d);
  } else F.debris.push(d);
  const sp = c.toWorld(dec.x, (dec.top + dec.bot) / 2);
  for (let i = 0; i < 14; i++) {
    F.particles.push({ x: sp[0], y: sp[1], vx: c.vel[0] + (Math.random() - 0.5) * 8, vy: c.vel[1] + (Math.random() - 0.5) * 8,
      fx: c.vel[0], fy: c.vel[1], life: 1.2, max: 1.2, size: 0.6, grow: 2, kind: 'smoke', drag: 0.3 });
  }
}

function setSas(mode) {
  F.sas = mode;
  F.hold = null;
  updateSasButtons();
}
function updateSasButtons() {
  document.querySelectorAll('#sasBtns button').forEach((b) => b.classList.toggle('on', b.dataset.sas === F.sas));
}

function changeWarp(dir) {
  if (dir > 0) {
    const n = F.warp + 1;
    if (n >= WARPS.length) return;
    if (!warpAllowed(n)) {
      const c = F.craft;
      flash(c.isThrusting() ? 'Cut the throttle (X) before time warping' : `Too low for ${WARPS[n]}× warp`, 2);
      return;
    }
    F.warp = n;
  } else {
    F.warp = Math.max(0, F.warp - 1);
  }
  F.acc = 0;
}

function warpAllowed(idx) {
  if (idx <= 3) return true;
  const c = F.craft;
  if (c.dead) return true;
  if (c.isThrusting()) return false;
  if (c.landed) return true;
  const b = soiBody(c.pos[0], c.pos[1], F.t);
  const bp = bodyPos(b, F.t);
  const alt = Math.hypot(c.pos[0] - bp[0], c.pos[1] - bp[1]) - b.R;
  return alt >= warpMinAlt(b, idx);
}

function enforceWarp() {
  if (F.warp <= 3) return;
  if (!F.craft.dead && F.craft.isThrusting()) { F.warp = 0; return; }
  while (F.warp > 3 && !warpAllowed(F.warp)) F.warp--;
}

/* ---------------- simulation ---------------- */

function flightUpdate(dt) {
  const c = F.craft, k = F.keys;
  F.frame++;
  if (!c.dead && hasControl(c)) {
    const driving = c.motors && c.motors.length && (c.isRolling() || (c.airT || 0) < 0.6); // short hops don't count
    F.drive = driving ? (k.ArrowUp ? 1 : 0) - (k.ArrowDown ? 1 : 0) : 0;
    if (k.ShiftLeft || k.ShiftRight || k.KeyW || (k.ArrowUp && !driving) || k.vThrUp) c.throttle = Math.min(1, c.throttle + dt * 0.8);
    if (k.KeyS || (k.ArrowDown && !driving) || k.vThrDn) c.throttle = Math.max(0, c.throttle - dt * 0.8);
    F.userRot = (k.KeyA || k.ArrowLeft || k.vRotL ? 1 : 0) - (k.KeyD || k.ArrowRight || k.vRotR ? 1 : 0);
    if (F.userRot) F.hold = null;
    F.rcsTx = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
    F.rcsTy = (k.KeyH ? 1 : 0) - (k.KeyN ? 1 : 0);
  } else { F.userRot = 0; F.drive = 0; F.rcsTx = F.rcsTy = 0; }

  enforceWarp();
  syncOthers();
  const w = WARPS[F.warp];
  if (F.warp <= 3) {
    F.acc += dt * w;
    let n = 0;
    while (F.acc >= PHYS_DT && n < 24) { physStep(PHYS_DT); F.acc -= PHYS_DT; n++; }
    if (n >= 24) F.acc = 0;
  } else {
    railsStep(dt * w);
  }

  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], F.t);
  if (F.lastBody && b !== F.lastBody) {
    const po = bodyPos(F.lastBody, F.t), pn = bodyPos(b, F.t);
    const oldUp = Math.atan2(c.pos[1] - po[1], c.pos[0] - po[0]);
    const newUp = Math.atan2(c.pos[1] - pn[1], c.pos[0] - pn[0]);
    F.rotOffset = wrapPi(F.rotOffset + newUp - oldUp);
    flash(b.parent === F.lastBody ? `Entered ${b.name}'s sphere of influence` : `Left ${F.lastBody.name}. Now orbiting ${b.name}`, 4);
  }
  F.lastBody = b;
  F.rotOffset *= Math.exp(-dt * 1.5);

  F.orbit = c.landed || c.dead ? null : orbitElements(b, c.pos[0], c.pos[1], c.vel[0], c.vel[1], F.t);
  F.predTick--;
  if (c.landed || c.dead) { F.pred = null; F.encounter = null; F.closest = null; if (c.dead) F.node = null; }
  else if (F.predTick <= 0) {
    F.pred = predictPath(c.pos[0], c.pos[1], c.vel[0], c.vel[1], F.t);
    if (F.node) updateNode(F.node, c, F.t);
    F.encounter = findEncounter(F.node && F.node.pred ? F.node.pred : F.pred);
    const cp = F.node && F.node.pred ? F.node.pred : F.pred;
    if (F.target && F.target.vid !== undefined) {
      const ts = targetState(F.target);
      F.closest = ts ? closestApproachVessel(cp, [ts.pos[0], ts.pos[1], ts.vel[0], ts.vel[1]], F.t) : null;
    } else F.closest = F.target ? closestApproach(cp, F.target) : null;
    F.predTick = F.map ? 3 : 15;
  }
  updateParticles(dt * Math.min(w, 4));
  checkMilestones(b);
  if (c.dead && !F.endShown) {
    F.deadTimer -= dt;
    if (F.deadTimer <= 0) { F.endShown = true; showCrashModal(); }
  }
}

function physStep(dt) {
  const c = F.craft;
  if (!c.dead) { c.ctrl = controlInput(c); stepCraft(c, dt, true); }
  for (const d of F.debris) if (!d.dead) { d.ctrl = 0; stepCraft(d, dt, false); }
  for (const o of F.others) if (!o.dead) { o.ctrl = 0; o.throttle = 0; stepCraft(o, dt, false); }
  for (const o of F.others) if (o.dead && !o.counted) { o.counted = true; if (isCareer() && o.meta) crewLost(o.meta.crew); toast(`${o.meta ? o.meta.name : 'A vessel'} was destroyed`); }
  F.debris = F.debris.filter((d) => !d.dead && Math.hypot(d.pos[0] - c.pos[0], d.pos[1] - c.pos[1]) < 80000);
  F.t += dt;
  for (const k of [c, ...F.debris, ...F.others]) syncLanded(k);
  if (!c.dead) for (const o of F.others) {
    if (o.dead) continue;
    const dk = findDock(c, o);
    if (dk) { dockWith(o, dk); break; }
  }
}

/* Landed craft ride along with their (possibly moving) body. */
function syncLanded(c) {
  if (!c.landed) return;
  const bp = bodyPos(c.landed.body, F.t), bv = bodyVel(c.landed.body, F.t);
  c.pos[0] = bp[0] + c.landed.rx; c.pos[1] = bp[1] + c.landed.ry;
  c.vel[0] = bv[0]; c.vel[1] = bv[1];
}

const CHUTE_TEAR_Q = 40; // kPa

function stepCraft(c, dt, player) {
  const t = F.t;
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  const bp = bodyPos(b, t), bv = bodyVel(b, t);
  if (c.landed) { c.pos[0] = bp[0] + c.landed.rx; c.pos[1] = bp[1] + c.landed.ry; }
  let rx = c.pos[0] - bp[0], ry = c.pos[1] - bp[1];
  const r = Math.hypot(rx, ry);
  const alt = r - b.R;
  const at = atmo(b, alt);
  c.pressure = at.p;
  c.radar = alt - groundAlt(b, Math.atan2(ry, rx));
  c.air = { rho: at.rho, v: Math.hypot(c.vel[0] - bv[0], c.vel[1] - bv[1]), oxygen: !!b.oxygen };
  const T = c.engineStep(dt, at.p);
  c.updateMass();
  const ax = Math.cos(c.angle), ay = Math.sin(c.angle);
  const g = gravAcc(b, c.pos[0], c.pos[1], t);

  if (c.landed) {
    c.pos[0] = bp[0] + c.landed.rx; c.pos[1] = bp[1] + c.landed.ry;
    c.vel[0] = bv[0]; c.vel[1] = bv[1]; c.angVel = 0;
    rx = c.landed.rx; ry = c.landed.ry;
    const nx = g[0] + (ax * T) / c.M, ny = g[1] + (ay * T) / c.M;
    const drive = player ? F.drive || 0 : 0;
    if ((nx * rx + ny * ry) / r > 0.02) {
      c.landed = null;
      if (player) flash('Liftoff!', 2);
    } else if (c.landed.wheels && (Math.abs(T) > 0 || drive)) {
      // on wheels: start rolling
      c.landed = null;
      c.rolling = b;
      c.settle = 0;
    } else {
      if (T > 0) emitExhaust(c, dt, at.p, bv);
      if (player) { electricStep(c, dt, t, 0); c.gforce = Math.hypot(g[0], g[1]) / G0; }
      heatStep(c, dt, 0, 0, 0);
      return;
    }
  }

  c.vel[0] += (g[0] + (ax * T) / c.M) * dt;
  c.vel[1] += (g[1] + (ay * T) / c.M) * dt;
  const rcs = player ? c.rcsStep(dt, F.rcsTx || 0, F.rcsTy || 0, c.ctrl) : { fx: 0, fy: 0, k: 0 };
  let ngx = (ax * T) / c.M, ngy = (ay * T) / c.M; // non-gravitational acceleration, for g-force and nodes
  if (rcs.fx || rcs.fy) {
    const f = c.rotLocal(rcs.fx, rcs.fy);
    c.vel[0] += (f[0] / c.M) * dt; c.vel[1] += (f[1] / c.M) * dt;
    ngx += f[0] / c.M; ngy += f[1] / c.M;
  }
  if (player && F.node && nodeApply(F.node, ngx, ngy, dt)) {
    F.node = null;
    if (c.throttle > 0) { c.throttle = 0; flash('Manoeuvre complete. Throttle cut.', 3); } else flash('Manoeuvre complete', 3);
    if (F.sas === 'node') setSas('stab');
  }

  // reaction wheels need power
  const wheels = player && !(ecTotal(c) > 0.01) ? 0 : c.torque;
  let tq = c.ctrl * (wheels + c.gimbalCap + c.rcsTorqueCap * rcs.k) + c.thrustTorque;
  if (player) electricStep(c, dt, t, Math.abs(c.ctrl) * wheels);
  let kSpring = 0;
  const vrx = c.vel[0] - bv[0], vry = c.vel[1] - bv[1];
  const v = Math.hypot(vrx, vry);
  c.q = (0.5 * at.rho * v * v) / 1000;
  if (c.hasChute && at.rho > 0) {
    let A = 0;
    for (const p of c.chutes) {
      if (!p.open) continue;
      const full = c.radar < cfgVal(p, p.def.drogue ? 'drogueAlt' : 'deployAlt');
      const target = full ? p.def.chuteFull : p.def.chuteSemi;
      // a main canopy opening fully while the air rushes past too fast rips off; drogues are built for it
      if (full && !p.def.drogue && c.q > CHUTE_TEAR_Q && p.area < p.def.chuteFull * 0.9) {
        p.open = false; p.torn = true; p.area = 0;
        if (player) flash(`${p.def.name} tore off! Too fast: open a drogue first or wait to slow down.`, 4);
        continue;
      }
      p.area += (target - p.area) * Math.min(1, dt * 0.8);
      A += p.area;
    }
    c.chuteArea = A;
    c.chuteOpen = c.chutes.some((p) => p.open);
  }
  if (at.rho > 0 && v > 0.1) {
    const q = (0.5 * at.rho * v * v) / 1000; // kPa
    const vhx = vrx / v, vhy = vry / v;
    const sinA = Math.abs(ax * vhy - ay * vhx);
    let CdA = 0.55 * Math.PI * (c.aeroWidth / 2) * (1 + 4 * sinA) + c.chuteArea;
    for (const p of c.brakes) if (p.brake) CdA += p.def.brakeArea;
    for (const p of c.parts) if (p.inflated) CdA += 0.9 * Math.PI * (p.def.wOpen / 2) ** 2 * Math.abs(ax * vhx + ay * vhy);
    const dv = Math.min(((q * CdA) / c.M) * dt, v * 0.9);
    c.vel[0] -= vhx * dv; c.vel[1] -= vhy * dv;
    ngx -= (vhx * dv) / dt; ngy -= (vhy * dv) / dt;
    const flowAng = Math.atan2(vhy, vhx);
    // fins behind the centre of mass add stability; fins in front of it reduce it
    let stab = 0.12;
    for (const f of c.fins) stab += 0.3 * clamp(((c.yc - (f.top + f.bot) / 2) / Math.max(c.length, 1)) * 4, -1, 1);
    for (const f of c.brakes) if (f.brake) stab += 0.4 * clamp(((c.yc - (f.top + f.bot) / 2) / Math.max(c.length, 1)) * 4, -1, 1);
    const kR = q * c.length * 2 * Math.max(stab, 0.02);
    tq -= kR * Math.sin(wrapPi(c.angle - flowAng));
    kSpring += kR;
    // a big inflated shield acts like a shuttlecock: the craft swings round to fly shield first
    for (const f of c.parts) if (f.inflated) {
      const arm = c.yc - (f.top + f.bot) / 2;
      const kS = q * f.def.wOpen * f.def.wOpen * 0.5 * Math.min(Math.abs(arm) + 0.3, 3);
      tq -= kS * Math.sin(wrapPi(c.angle - flowAng - (arm > 0 ? Math.PI : 0)));
      kSpring += kS;
    }
    // wings lift across the airflow; control surfaces tilt with the controls
    let aeroCap = 0;
    if (c.wings.length) {
      const lnx = -vhy, lny = vhx; // lift direction for a positive angle of attack
      const alpha0 = wrapPi(c.angle - flowAng);
      for (const w of c.wings) {
        const S = w.def.wing, ly = (w.top + w.bot) / 2 - c.yc;
        const rw = c.rotLocal(0, ly);
        let a = alpha0;
        const cr = rw[0] * lny - rw[1] * lnx; // torque per unit of lift
        if (w.def.ctrlSurf) {
          a += 0.3 * c.ctrl * (cr >= 0 ? 1 : -1);
          aeroCap += q * S * 1.2 * Math.abs(cr);
        }
        const CL = liftCoef(a);
        const L = q * S * CL, D = q * S * (0.015 + 0.06 * CL * CL);
        let fx = lnx * L - vhx * D, fy = lny * L - vhy * D;
        // don't let one step's lift reverse the motion across the flow
        const fl = Math.hypot(fx, fy), cap = (c.M * v) / dt * 0.5;
        if (fl > cap) { fx *= cap / fl; fy *= cap / fl; }
        c.vel[0] += (fx / c.M) * dt; c.vel[1] += (fy / c.M) * dt;
        ngx += fx / c.M; ngy += fy / c.M;
        tq += rw[0] * fy - rw[1] * fx;
        kSpring += q * S * 3 * Math.abs(ly);
      }
    }
    c.aeroCap = aeroCap;
    for (const p of c.wheels) if (!p.gearUp) {
      const dg = q * 0.25;
      c.vel[0] -= (vhx * dg / c.M) * dt; c.vel[1] -= (vhy * dg / c.M) * dt;
    }
    if (c.chuteArea > 1) {
      const kC = q * c.chuteArea * 0.4;
      tq -= kC * Math.sin(wrapPi(c.angle - flowAng - Math.PI));
      kSpring += kC;
    }
    c.heat = at.rho * v * v * v;
  } else { c.heat = 0; c.aeroCap = 0; }
  if (player) c.gforce = lerp(c.gforce || 0, Math.hypot(ngx, ngy) / G0, Math.min(1, dt * 4));
  const hot = heatStep(c, dt, at.rho, vrx, vry);
  if (hot.length) {
    if (!player) { explode(c, false, 0); return; }
    hot.sort((p, q) => q.temp / partMaxTemp(q.def) - p.temp / partMaxTemp(p.def));
    for (const p of hot) {
      if (c.dead) return;
      if (c.byUid.has(p.uid)) destroyPart(c, p);
    }
    if (c.dead) return;
  }
  // wheels on the ground
  const wh = c.wheels.length ? wheelStep(c, b, bp, bv, dt, player) : null;
  if (wh && wh.n) {
    c.vel[0] += (wh.fx / c.M) * dt; c.vel[1] += (wh.fy / c.M) * dt;
    ngx += wh.fx / c.M; ngy += wh.fy / c.M;
    tq += wh.tq;
    if (!c.rolling && player && !c.dead && (c.airT || 0) > 1) onTouchdown(b, false, wh.impact);
    c.rolling = b;
    c.airT = 0;
  } else { c.rolling = null; c.airT = (c.airT || 0) + dt; }
  if (c.dead) return;
  if (player) c.gforce = lerp(c.gforce || 0, Math.hypot(ngx, ngy) / G0, Math.min(1, dt * 4));
  kSpring = Math.min(kSpring, c.I * 800);
  tq -= 1.4 * Math.sqrt(kSpring * c.I) * c.angVel;
  c.angVel = clamp(c.angVel + (tq / c.I) * dt, -4, 4);
  c.angle += c.angVel * dt;

  c.pos[0] += c.vel[0] * dt;
  c.pos[1] += c.vel[1] * dt;
  if (T > 0) emitExhaust(c, dt, at.p, bv);
  // a craft resting on its wheels settles: it stops jiggling and can time warp
  if (wh && wh.n && !(Math.abs(T) > 0) && !(player && F.drive)) {
    const sp = Math.hypot(c.vel[0] - bv[0], c.vel[1] - bv[1]);
    c.settle = sp < 0.08 && Math.abs(c.angVel) < 0.01 ? (c.settle || 0) + dt : 0;
    if (c.settle > 0.6) {
      c.landed = { body: b, rx: c.pos[0] - bp[0], ry: c.pos[1] - bp[1], wheels: true };
      c.vel = [bv[0], bv[1]]; c.angVel = 0; c.settle = 0;
      return;
    }
  } else c.settle = 0;
  contact(c, b, t + dt, player);
}

/* Lift coefficient of a thin wing at angle of attack a: rises steeply, stalls past about 14°, and acts like a flat plate beyond. */
function liftCoef(a) {
  if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
  const s = Math.sign(a), x = Math.abs(a), STALL = 0.24, plate = 0.9 * Math.sin(2 * x);
  if (x <= STALL) return s * 2 * Math.PI * x;
  const peak = 2 * Math.PI * STALL;
  if (x < STALL + 0.25) return s * lerp(peak, Math.max(plate, 0.75), (x - STALL) / 0.25);
  return s * Math.max(plate, 0);
}

/* Spring-and-damper wheels: push the craft off the ground, roll along it, brake, and drive (rover motors). */
const WHEEL_W = 15;                 // suspension stiffness, as a natural frequency (rad/s)
function wheelStep(c, b, bp, bv, dt, player) {
  const out = { fx: 0, fy: 0, tq: 0, n: 0, impact: 0 };
  const live = c.wheels.filter((w) => !w.gearUp);
  if (!live.length) return out;
  const me = c.M / Math.max(2, live.length), k = me * WHEEL_W * WHEEL_W, cd = 2 * 0.9 * me * WHEEL_W;
  const drive = player ? F.drive || 0 : 0;
  let motorK = 0;
  if (drive && c.motors.length) motorK = typeof ecDrain === 'function' ? ecDrain(c, 0.6 * c.motors.length * Math.abs(drive) * dt) : 1;
  const nose = [Math.cos(c.angle), Math.sin(c.angle)];
  const broken = [];
  for (const w of live) {
    const [lx, ly] = wheelPoint(w);
    const P = c.toWorld(lx, ly);
    const dx = P[0] - bp[0], dy = P[1] - bp[1], r = Math.hypot(dx, dy), phi = Math.atan2(dy, dx);
    const h = terrainH(b, phi);
    const pen = b.R + h - r;
    if (pen <= 0 || (b.ocean && h < 0) || b.gas || b.star) { w.touch = false; continue; }
    // ground slope
    const dp = 1 / b.R, h1 = terrainH(b, phi - dp), h2 = terrainH(b, phi + dp);
    let tx = (b.R + h2) * Math.cos(phi + dp) - (b.R + h1) * Math.cos(phi - dp);
    let ty = (b.R + h2) * Math.sin(phi + dp) - (b.R + h1) * Math.sin(phi - dp);
    const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl;
    let nx = ty, ny = -tx;
    if (nx * dx + ny * dy < 0) { nx = -nx; ny = -ny; }
    const rx = P[0] - c.pos[0], ry = P[1] - c.pos[1];
    const vx = c.vel[0] - c.angVel * ry - bv[0], vy = c.vel[1] + c.angVel * rx - bv[1];
    const vn = vx * nx + vy * ny, vt = vx * tx + vy * ty;
    if (!w.touch) {
      out.impact = Math.max(out.impact, -vn);
      if (-vn > w.def.maxImpact) { broken.push(w); continue; }
    }
    w.touch = true;
    const Fn = clamp(k * pen - cd * vn, 0, me * 80);
    // rolling resistance, or brakes that grip (smooth near a standstill, so the craft doesn't chatter)
    const mu = (c.wheelBrake ? 0.45 : 0.02) * Fn;
    const Ft = -clamp((vt * me) / dt * 0.5, -mu, mu);
    const fx = nx * Fn + tx * Ft, fy = ny * Fn + ty * Ft;
    out.fx += fx; out.fy += fy; out.tq += rx * fy - ry * fx; out.n++;
    if (w.def.motor && drive && motorK > 0) {
      // the motor pushes at the axle, limited by how well the tyre grips
      const fwd = Math.sign(nose[0] * tx + nose[1] * ty) || 1;
      const fade = Math.max(0, 1 - Math.abs(vt) / 22);
      const Fd = clamp(drive * fwd * w.def.motor * motorK * fade, -0.5 * Fn, 0.5 * Fn);
      const ax = rx + nx * w.def.wheelR, ay = ry + ny * w.def.wheelR;
      out.fx += tx * Fd; out.fy += ty * Fd; out.tq += ax * ty * Fd - ay * tx * Fd;
    }
  }
  if (player) for (const w of broken) if (c.byUid.has(w.uid)) { flash(`${w.def.name} broke off: landed too hard`, 3); destroyPart(c, w); }
  return out;
}

/* A single part overheats: it explodes, and anything no longer connected to the command part falls away. */
function destroyPart(c, p) {
  const aboard = F.crew.filter((x) => x.pod === p.uid);
  if (aboard.length) {
    F.crew = F.crew.filter((x) => x.pod !== p.uid);
    F.crewLost.push(...(isCareer() ? crewLost(aboard) : crewNames(aboard)));
    persist();
  }
  const w = c.toWorld(p.x, (p.top + p.bot) / 2);
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * TAU, sp = Math.random() * 12;
    F.particles.push({ x: w[0], y: w[1], vx: c.vel[0] + Math.cos(a) * sp, vy: c.vel[1] + Math.sin(a) * sp, fx: c.vel[0], fy: c.vel[1],
      life: 1 + Math.random(), max: 2, size: 0.8, grow: 2, kind: i % 2 ? 'fire' : 'smoke', drag: 0.5 });
  }
  if (p.uid === c.rootUid) { explode(c, true, 0, `${p.def.name} overheated`); return; }
  const present = new Set(c.parts.map((q) => q.uid));
  present.delete(p.uid);
  const seen = new Set([c.rootUid]), q = [c.rootUid];
  while (q.length) { const u = q.pop(); for (const l of c.byUid.get(u).links) if (present.has(l) && !seen.has(l)) { seen.add(l); q.push(l); } }
  const lost = c.parts.filter((x) => x.uid !== p.uid && !seen.has(x.uid));
  for (const comp of components(lost)) separatePiece(c, comp, p);
  c.parts = c.parts.filter((x) => seen.has(x.uid));
  c.recompute();
  flash(`${p.def.name} overheated and exploded!`, 3);
}

function penetration(c, b, bp) {
  let maxPen = -Infinity, water = false;
  for (const [lx, ly] of c.contacts) {
    const w = c.toWorld(lx, ly);
    const dx = w[0] - bp[0], dy = w[1] - bp[1];
    const r = Math.hypot(dx, dy), phi = Math.atan2(dy, dx);
    const h = terrainH(b, phi);
    const pen = b.R + (b.ocean ? Math.max(h, 0) : h) - r;
    if (pen > maxPen) { maxPen = pen; water = b.ocean && h < 0; }
  }
  return { maxPen, water };
}

function contact(c, b, t, player) {
  const bp = bodyPos(b, t), bv = bodyVel(b, t);
  const pen = penetration(c, b, bp);
  if (pen.maxPen <= 0) return;
  if (b.gas || b.star) { explode(c, player, 0, b.star ? `Burned up in ${b.name}` : `Crushed in the depths of ${b.name}`); return; }
  const rx = c.pos[0] - bp[0], ry = c.pos[1] - bp[1], r = Math.hypot(rx, ry);
  const ux = rx / r, uy = ry / r;
  const speed = Math.hypot(c.vel[0] - bv[0], c.vel[1] - bv[1]);
  const upright = Math.cos(c.angle) * ux + Math.sin(c.angle) * uy;
  let limit = c.hasLegs ? 12 : 6;
  if (pen.water) limit = Math.max(limit, 10);
  if (speed > limit || (upright < 0.75 && speed > 3)) { explode(c, player, speed); return; }
  c.pos[0] += ux * pen.maxPen; c.pos[1] += uy * pen.maxPen;
  if (upright > 0.75) {
    c.angle = Math.atan2(uy, ux);
    const p2 = penetration(c, b, bp);
    c.pos[0] += ux * p2.maxPen; c.pos[1] += uy * p2.maxPen;
  }
  c.landed = { body: b, rx: c.pos[0] - bp[0], ry: c.pos[1] - bp[1] };
  c.vel = [bv[0], bv[1]];
  c.angVel = 0;
  if (player) onTouchdown(b, pen.water, speed);
}

function explode(c, player, speed, why) {
  c.dead = true;
  const n = player ? 70 : 35;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = Math.random() * (player ? 30 : 18);
    const fire = i % 2 === 0;
    F.particles.push({ x: c.pos[0] + (Math.random() - 0.5) * 4, y: c.pos[1] + (Math.random() - 0.5) * 4,
      vx: c.vel[0] * 0.1 + Math.cos(a) * s, vy: c.vel[1] * 0.1 + Math.sin(a) * s, fx: 0, fy: 0,
      life: fire ? 1 + Math.random() : 3 + Math.random() * 3, max: fire ? 2 : 6, size: fire ? 1.5 : 2, grow: fire ? 3 : 4,
      kind: fire ? 'fire' : 'smoke', drag: 1.2 });
  }
  playSound('boom');
  if (player) {
    F.deadTimer = 2.2;
    if (F.crew.length) {
      F.crewLost = isCareer() ? crewLost(F.crew) : crewNames(F.crew);
      F.crew = [];
      persist();
    }
    F.warp = 0;
    F.deathReason = why || `Hit the ground at ${speed.toFixed(1)} m/s`;
    flash(why || `Vessel destroyed at ${speed.toFixed(1)} m/s`, 4);
  }
}

function railsStep(simDt) {
  const c = F.craft;
  F.debris = [];
  if (F.others.length) unloadOthers();
  if (c.dead) { F.t += simDt; return; }
  c.angVel = 0;
  for (const p of c.parts) p.burn = 0;
  electricStep(c, simDt, F.t, 0);
  for (const p of c.parts) p.temp = T_AMBIENT + (p.temp - T_AMBIENT) * Math.exp(-0.025 * simDt);
  if (c.landed) {
    F.t += simDt;
    const bp = bodyPos(c.landed.body, F.t), bv = bodyVel(c.landed.body, F.t);
    c.pos = [bp[0] + c.landed.rx, bp[1] + c.landed.ry];
    c.vel = [bv[0], bv[1]];
    return;
  }
  // drop out of warp shortly before a manoeuvre node's burn should start
  let stopAt = Infinity;
  if (F.node && !F.node.frozen) {
    const bt = burnTime(c, Math.hypot(F.node.pro, F.node.rad));
    stopAt = F.node.t - (isFinite(bt) ? bt / 2 : 0) - 15;
    if (F.t < stopAt && F.t + simDt >= stopAt) { simDt = stopAt - F.t; F.warpStop = true; }
  }
  const s = [c.pos[0], c.pos[1], c.vel[0], c.vel[1]];
  let rem = simDt, n = 0;
  while (rem > 1e-6 && n < 4000) {
    const b = soiBody(s[0], s[1], F.t);
    const dt = Math.min(rem, stepLimit(b, s[0], s[1], s[2], s[3], F.t, 0.002, 2e4));
    rk4Step(b, s, F.t, dt);
    F.t += dt; rem -= dt; n++;
    const nb = soiBody(s[0], s[1], F.t), np = bodyPos(nb, F.t);
    const alt = Math.hypot(s[0] - np[0], s[1] - np[1]) - nb.R;
    if (alt < warpMinAlt(nb, F.warp)) {
      c.pos = [s[0], s[1]]; c.vel = [s[2], s[3]];
      while (F.warp > 3 && !warpAllowed(F.warp)) F.warp--;
      break;
    }
  }
  c.pos = [s[0], s[1]];
  c.vel = [s[2], s[3]];
  if (F.warpStop) { F.warpStop = false; F.warp = 0; F.predTick = 0; flash('Approaching manoeuvre node', 3); }
}

function controlInput(c) {
  if (!hasControl(c)) return 0;
  if (F.userRot) return F.userRot;
  if (F.sas === 'off' || c.landed) return 0;
  const maxA = (c.torque + c.gimbalCap + (c.aeroCap || 0) + (c.rcsOn && c.monoTotal() > 0 ? c.rcsTorqueCap : 0)) / c.I;
  if (maxA <= 1e-6) return 0;
  const damp = () => clamp((-c.angVel * 6) / maxA, -1, 1);
  let target;
  if (F.sas === 'stab') {
    if (F.hold === null) {
      if (Math.abs(c.angVel) < 0.01) F.hold = c.angle;
      return damp();
    }
    target = F.hold;
  } else {
    const b = soiBody(c.pos[0], c.pos[1], F.t);
    const bp = bodyPos(b, F.t), bv = bodyVel(b, F.t);
    const vx = c.vel[0] - bv[0], vy = c.vel[1] - bv[1];
    const rx = c.pos[0] - bp[0], ry = c.pos[1] - bp[1];
    if (F.sas === 'tgt' || F.sas === 'kill') {
      const ts = targetState(F.target);
      if (!ts) return damp();
      // close to a ship with a free docking port, line up face to face with that port
      const di = F.sas === 'tgt' && ts.craft && Math.hypot(ts.pos[0] - c.pos[0], ts.pos[1] - c.pos[1]) < 500 ? dockingInfo(c, ts.craft) : null;
      if (di) target = di.heading;
      else if (F.sas === 'tgt') target = Math.atan2(ts.pos[1] - c.pos[1], ts.pos[0] - c.pos[0]);
      else {
        const rvx = c.vel[0] - ts.vel[0], rvy = c.vel[1] - ts.vel[1];
        if (Math.hypot(rvx, rvy) < 0.05) return damp();
        target = Math.atan2(-rvy, -rvx);
      }
    } else if (F.sas === 'node') {
      const n = F.node;
      if (!n || Math.hypot(n.remaining[0], n.remaining[1]) < 0.01) return damp();
      target = Math.atan2(n.remaining[1], n.remaining[0]);
    } else if (F.sas === 'pro' || F.sas === 'retro') {
      if (Math.hypot(vx, vy) < 1) return damp();
      target = Math.atan2(vy, vx) + (F.sas === 'retro' ? Math.PI : 0);
    } else {
      target = Math.atan2(ry, rx) + (F.sas === 'radin' ? Math.PI : 0);
    }
  }
  const err = wrapPi(target - c.angle);
  const wantW = Math.sign(err) * Math.min(Math.sqrt(2 * maxA * 0.6 * Math.abs(err)), 3 * Math.abs(err), 2);
  return clamp(((wantW - c.angVel) * 6) / maxA, -1, 1);
}

function emitExhaust(c, dt, pressure, bv) {
  if (pressure < 0.01 || F.particles.length > 650) return;
  const ax = Math.cos(c.angle), ay = Math.sin(c.angle);
  for (const e of c.parts) {
    if (e.burn <= 0) continue;
    let n = dt * 28 * e.burn * Math.min(1, pressure * 3) * Math.sqrt(e.def.thrust / 150) * (e.def.jet ? 0.12 : 1);
    while (n > 0) {
      if (Math.random() < n) {
        const dir = e.inv ? -1 : 1;
        const w = c.toWorld(e.x + (Math.random() - 0.5) * 1.2, e.inv ? e.top + 1.5 : e.bot - 1.5);
        const sp = (25 + Math.random() * 25) * dir, jx = (Math.random() - 0.5) * 6, jy = (Math.random() - 0.5) * 6;
        F.particles.push({ x: w[0], y: w[1], vx: c.vel[0] - ax * sp + jx, vy: c.vel[1] - ay * sp + jy, fx: bv[0] + jx, fy: bv[1] + jy,
          life: 3 + Math.random() * 3, max: 6, size: 1.4, grow: 2.5 + Math.random() * 2, kind: 'smoke', drag: 1.5 });
      }
      n -= 1;
    }
  }
}

function updateParticles(dt) {
  for (const p of F.particles) {
    p.life -= dt;
    const k = Math.min(1, dt * p.drag);
    p.vx += (p.fx - p.vx) * k; p.vy += (p.fy - p.vy) * k;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.size += p.grow * dt;
  }
  F.particles = F.particles.filter((p) => p.life > 0);
}

/* The next couple of things that will happen on the predicted path. */
function findEncounter(pred) {
  if (!pred) return null;
  const out = [];
  for (const ev of pred.events) {
    if (ev.type === 'soi') {
      if (ev.to.parent === ev.from) {
        let minD = Infinity;
        for (let i = ev.idx; i < pred.pts.length && pred.pts[i].b === ev.to; i++) {
          const p = pred.pts[i], m = bodyPos(ev.to, p.t);
          minD = Math.min(minD, Math.hypot(p.x - m[0], p.y - m[1]));
        }
        out.push({ kind: 'enc', body: ev.to, t: ev.t, pe: minD - ev.to.R });
      } else out.push({ kind: 'exit', body: ev.from, t: ev.t });
    } else if (ev.type === 'impact') out.push({ kind: 'impact', body: ev.b, t: ev.t });
    if (out.length >= 2) break;
  }
  return out.length ? out : null;
}

function describeEvent(e, now) {
  const when = fmtDur(e.t - now);
  if (e.kind === 'enc') return [`${e.body.name} encounter`, `in ${when} · Pe ${e.pe > 0 ? fmtDist(e.pe) : 'impact'}`];
  if (e.kind === 'exit') return [`Leaving ${e.body.name}`, `in ${when}`];
  return [`Impact on ${e.body.name}`, `in ${when}`];
}

/* ---------------- career hooks ---------------- */

/* Let active contracts look at what just happened. */
function flightEvent(ev) {
  if (!isCareer()) return;
  const done = checkContracts(Career.s, ev);
  for (const c of done) {
    toast(`Contract complete: ${c.title} · +${fmtFunds(c.reward)}`);
    F.flightContracts.push(c.title);
  }
  if (done.length) persist();
}

function toggleScience() {
  if (!isCareer()) return;
  F.sciOpen = !F.sciOpen;
  F.hud.sciPanel.classList.toggle('hidden', !F.sciOpen);
  F.sciSig = '';
  if (F.sciOpen) renderSciencePanel();
}

/* The panel is rebuilt only when its set of buttons changes; otherwise only the text is updated in place.
   (Rebuilding it on a timer replaced buttons between mouse-down and mouse-up, so clicks were lost.) */
function renderSciencePanel() {
  const c = F.craft, s = Career.s, el = F.hud.sciList;
  if (!F.sciOpen || !s) return;
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], F.t);
  const sit = situationOf(c, b, F.t), bio = sciBiome(c, b, F.t, sit);
  const antenna = c.parts.some((p) => p.def.antenna);
  F.hud.sciWhere.textContent = sitText(sit, b, bio);
  const rows = [];
  for (const p of c.parts) {
    if (!p.def.exp || c.dead) continue;
    const e = EXPERIMENTS[p.def.exp];
    let status;
    const btns = []; // [kind, label, disabled]
    if (p.result) {
      const left = subjectLeft(s, p.result.id, p.result.cap);
      status = `Holding: ${sitText(p.result.sit, BODY_BY_ID[p.result.body], p.result.biome).replace(/^./, (x) => x.toLowerCase())} · ${left.toFixed(1)} ⚗ if recovered`;
      if (antenna) btns.push(['tx', `Transmit ${(left * TRANSMIT_FRACTION).toFixed(1)}`, false]);
      btns.push(['drop', 'Discard', false]);
    } else if (p.spent) status = 'Used. Recover it to reset.';
    else if (canRun(p, b, sit)) {
      const v = subjectLeft(s, subjectId(p.def.exp, b, sit, bio), subjectCap(p.def.exp, b, sit));
      status = v < 0.05 ? 'Nothing new to learn here' : `Worth ${v.toFixed(1)} ⚗ here`;
      btns.push(['run', 'Run', v < 0.05]);
    } else status = 'Does not work here';
    rows.push({ uid: p.uid, name: e.name, status, btns });
  }
  const sig = `${antenna}|` + rows.map((r) => `${r.uid}:${r.btns.map((x) => x[0]).join(',')}`).join('|');
  if (sig !== F.sciSig) {
    F.sciSig = sig;
    el.innerHTML = rows.map((r) => `<div class="sci-row" data-row="${r.uid}"><div><b>${r.name}</b><div class="muted sci-status"></div></div>
      <div class="sci-btns">${r.btns.map(([k]) => `<button data-sci="${k}" data-uid="${r.uid}"></button>`).join('')}</div></div>`).join('') +
      (!antenna && rows.length ? '<div class="muted small-note">Add a Whip Antenna to transmit results without coming home.</div>' : '') ||
      '<div class="muted">No experiments on this craft. Add science parts in the hangar.</div>';
  }
  for (const r of rows) {
    const row = el.querySelector(`[data-row="${r.uid}"]`);
    if (!row) continue;
    const st = row.querySelector('.sci-status');
    if (st.textContent !== r.status) st.textContent = r.status;
    const buttons = row.querySelectorAll('button');
    r.btns.forEach(([, label, disabled], i) => {
      const bt = buttons[i];
      if (!bt) return;
      if (bt.textContent !== label) bt.textContent = label;
      if (bt.disabled !== disabled) bt.disabled = disabled;
    });
  }
}

function scienceAction(kind, uid) {
  const c = F.craft, s = Career.s, p = c.byUid.get(uid);
  if (!p || !s) return;
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], F.t);
  if (kind === 'run') {
    const sit = situationOf(c, b, F.t);
    if (!canRun(p, b, sit)) return;
    const r = runExperiment(s, p, b, sit, sciBiome(c, b, F.t, sit));
    flash(`${EXPERIMENTS[p.def.exp].name}: result stored (${r.value.toFixed(1)} ⚗ if recovered)`, 3);
  } else if (kind === 'tx') {
    const r = transmit(s, p);
    if (r) {
      toast(`Transmitted ${EXPERIMENTS[r.result.exp].name}: +${r.gain.toFixed(1)} science`);
      flightEvent({ kind: 'science', body: BODY_BY_ID[r.result.body], sit: r.result.sit, biome: r.result.biome });
      persist();
    }
  } else if (kind === 'drop') {
    if (p.result && EXPERIMENTS[p.result.exp].oneShot) p.spent = true;
    p.result = null;
  }
  F.sciSig = '';
  renderSciencePanel();
}

function renderContractHud() {
  const el = F.hud.hudContracts;
  if (!isCareer()) { el.classList.add('hidden'); return; }
  const act = Career.s.contracts.filter((x) => x.state === 'active' || (x.state === 'done' && F.flightContracts.includes(x.title)));
  el.classList.toggle('hidden', !act.length);
  el.innerHTML = '<div class="card-title">Contracts</div>' + act.map((x) =>
    `<div class="ct ${x.state === 'done' ? 'done' : ''}">${x.state === 'done' ? '✓' : '○'} ${x.title}</div>`).join('');
}

/* Power, heat, target and node readouts. */
function updateSystemsHud(c, b, o, t) {
  const h = F.hud;
  h.hG.textContent = (c.gforce || 0).toFixed(1);
  h.hEcc.textContent = o ? o.e.toFixed(3) : '—';
  h.fEcRow.style.display = c.ecMax > 0 ? '' : 'none';
  if (c.ecMax > 0) {
    h.fEc.style.width = (100 * ecTotal(c)) / c.ecMax + '%';
    const r = c.ecRate || 0;
    h.fEcRate.textContent = (r >= 0 ? '+' : '') + r.toFixed(2) + '/s';
  }
  // heat or power trouble
  let warn = '', danger = false;
  if (!c.dead && !hasControl(c)) { warn = '⚡ No power: the probe core cannot steer, throttle or stage'; danger = true; }
  else if (!c.dead && c.hottest) {
    const p = c.hottest, mt = partMaxTemp(p.def), f = p.temp / mt;
    if (f > 0.6) { warn = `🔥 ${p.def.name} ${fmtNum(p.temp)} / ${fmtNum(mt)} K`; danger = f > 0.85; }
  }
  h.heatWarn.textContent = warn;
  h.heatWarn.classList.toggle('hidden', !warn);
  h.heatWarn.classList.toggle('danger', danger);
  // target
  const tg = F.target, ts = targetState(tg);
  if (tg && !ts) F.target = null;
  h.hudTarget.classList.toggle('hidden', !ts);
  if (ts) {
    const ship = tg.vid !== undefined;
    h.tName.textContent = ts.name;
    const dist = Math.hypot(c.pos[0] - ts.pos[0], c.pos[1] - ts.pos[1]) - ts.R;
    h.tDist.textContent = fmtDist(dist);
    h.tRelRow.style.display = ship ? '' : 'none';
    if (ship) h.tRel.textContent = fmtNum(Math.hypot(c.vel[0] - ts.vel[0], c.vel[1] - ts.vel[1]), 2) + ' m/s';
    const di = ship && ts.craft && dist < 400 ? dockingInfo(c, ts.craft) : null;
    h.tDockRow.style.display = di ? '' : 'none';
    if (di) h.tDock.textContent = `${fmtNum(di.along, 1)} m ahead · ${fmtNum(Math.abs(di.lateral), 1)} m ${di.lateral >= 0 ? 'right' : 'left'} · ${Math.round((di.angle * 180) / Math.PI)}°`;
    const ca = F.closest;
    h.tCloseLabel.textContent = ca && ca.inside ? 'Encounter' : 'Closest approach';
    h.tClose.textContent = !ca ? '—' : ca.inside ? `in ${fmtDur(ca.t - t)}` : `${fmtDist(ca.d - ts.R)} in ${fmtDur(ca.t - t)}`;
    const w = ship || b === tg || c.landed ? null : transferWindow(c, tg, t);
    h.tPhaseRow.style.display = w ? '' : 'none';
    h.tWinRow.style.display = w ? '' : 'none';
    if (w) {
      const deg = (a2) => Math.round((a2 * 180) / Math.PI);
      h.tPhase.textContent = `${deg(w.phase)}° (best ${deg(w.ideal)}°)`;
      h.tWin.textContent = isFinite(w.wait) ? (w.wait < 60 ? 'now' : `in ${fmtDur(w.wait)}`) + (w.via ? ` (${w.via.name})` : '') : '—';
    }
  }
  h.bSwitch.classList.toggle('hidden', !(ts && tg.vid !== undefined));
  h.bUndock.classList.toggle('hidden', !dockedPairs(c).length || c.dead);
  // map tools and the node editor
  h.mapTools.classList.toggle('hidden', !F.map);
  const ell = o && o.e < 1 && !c.landed;
  h.bNodeAp.disabled = !ell;
  h.bNodePe.disabled = !(o && !c.landed && isFinite(o.tPe));
  const n = F.node;
  h.nodePanel.classList.toggle('hidden', !n);
  if (n) {
    const dvLeft = Math.hypot(n.remaining[0], n.remaining[1]);
    const bt = burnTime(c, n.frozen ? dvLeft : Math.hypot(n.pro, n.rad));
    h.nPro.textContent = fmtNum(n.pro, 1) + ' m/s';
    h.nRad.textContent = fmtNum(n.rad, 1) + ' m/s';
    h.nTime.textContent = n.t > t ? 'in ' + fmtDur(n.t - t) : 'now';
    h.nInfo.textContent = `· Δv ${fmtNum(dvLeft, 1)} m/s${n.frozen ? ' left' : ''}`;
    h.nBurn.textContent = !isFinite(bt) ? 'No engine to burn with' : n.frozen ? `Burning · about ${fmtDur(bt)} to go` :
      `Burn ${fmtDur(bt)} · start ${n.t - bt / 2 > t ? 'in ' + fmtDur(n.t - bt / 2 - t) : 'now'} (SAS Node points you)`;
  }
}

/* ---------------- node & target controls ---------------- */

function addNodeAt(which) {
  const o = F.orbit;
  if (!o) return;
  const dt = which === 'ap' ? o.tAp : o.tPe;
  if (!isFinite(dt)) return;
  F.node = makeNode(F.t + Math.max(dt, 5));
  F.predTick = 0;
  if (!F.map) F.map = true;
}
function nodeAdjust(spec) {
  const n = F.node;
  if (!n) return;
  const [axis, v] = spec.split(':');
  n[axis] = Math.round((n[axis] + +v) * 10) / 10;
  nodeTouched(n);
  F.predTick = 0;
}
function nodeShift(spec) {
  const n = F.node;
  if (!n) return;
  let d = +spec;
  if (spec.endsWith('orbit')) { const per = F.orbit && isFinite(F.orbit.period) ? F.orbit.period : 0; d = spec[0] === '-' ? -per : per; }
  n.t = Math.max(F.t + 2, n.t + d);
  nodeTouched(n);
  F.predTick = 0;
}
function setTarget(id) {
  if (id && id[0] === 'v') {
    const vid = +id.slice(1), ts = targetState({ vid });
    F.target = ts ? { vid, name: ts.name } : null;
  } else F.target = BODY_BY_ID[id] || null;
  F.predTick = 0;
}
function fillTargetSelect() {
  const sel = document.getElementById('targetSelect');
  const s = universe();
  const ships = (s ? s.vessels.map((v) => [v.id, v.name]) : []).concat(F.others.filter((o) => !o.dead).map((o) => [o.vid, o.meta.name]));
  sel.innerHTML = '<option value="">None</option>' + BODIES.filter((b) => !b.star).map((b) =>
    `<option value="${b.id}" ${F.target === b ? 'selected' : ''}>${b.parent && !b.parent.star ? '· ' : ''}${b.name}</option>`).join('') +
    (ships.length ? '<optgroup label="Vessels">' + ships.map(([id, n]) =>
      `<option value="v${id}" ${F.target && F.target.vid === id ? 'selected' : ''}>${esc(n)}</option>`).join('') + '</optgroup>' : '');
}

/* Map pointer: press a node handle to drag it; press anywhere else to pan the map. Clicking (pressing and
   letting go without moving) adds a node on the path, targets a vessel or focuses a planet. */
function mapPointerDown(sx, sy) {
  for (const hd of F.nodeHandles || []) {
    if (Math.hypot(sx - hd.x, sy - hd.y) < 13) { F.handleDrag = { ...hd, lx: sx, ly: sy }; return true; }
  }
  F.mapPress = { x: sx, y: sy, pan: F.mapPan.slice(), moved: false };
  return false;
}
function mapPanMove(sx, sy) {
  const p = F.mapPress;
  if (!p) return;
  const dx = sx - p.x, dy = sy - p.y;
  if (!p.moved && Math.hypot(dx, dy) < 5) return;
  p.moved = true;
  const z = F.mapZoom || 1;
  F.mapPan = [p.pan[0] - dx / z, p.pan[1] + dy / z];
}
function mapPointerUp(sx, sy) {
  const p = F.mapPress;
  F.mapPress = null;
  if (p && !p.moved && F.map) mapTap(sx, sy);
}
function mapTap(sx, sy) {
  let best = null, bd = 9;
  for (const p of F.pathScreen || []) {
    const d = Math.hypot(sx - p.x, sy - p.y);
    if (d < bd && p.t > F.t + 5) { bd = d; best = p; }
  }
  if (best && !F.craft.dead && !F.craft.landed) {
    F.node = makeNode(best.t);
    F.predTick = 0;
    flash('Node added: drag its handles or use the panel to plan the burn', 3);
    return true;
  }
  for (const v of F.mapVessels || []) {
    if (Math.hypot(sx - v.x, sy - v.y) < 12) { setTarget('v' + v.vid); fillTargetSelect(); flash(`Target: ${v.name}`, 2); return true; }
  }
  mapClick(sx, sy);
  return false;
}
function mapPointerMove(sx, sy, fine) {
  const d = F.handleDrag;
  if (!d || !F.node) return;
  const proj = (sx - d.lx) * d.dir[0] + (sy - d.ly) * d.dir[1];
  d.lx = sx; d.ly = sy;
  F.node[d.axis] = Math.round((F.node[d.axis] + d.sign * proj * (fine ? 0.05 : 0.6)) * 10) / 10;
  nodeTouched(F.node);
  F.predTick = Math.min(F.predTick, 2);
}

/* ---------------- milestones ---------------- */

function award(id) {
  const got = loadMilestones();
  if (got[id]) return;
  if (!F.flightMilestones.includes(id)) F.flightMilestones.push(id);
  got[id] = Date.now();
  if (isCareer()) {
    const r = milestoneReward(id);
    addFunds(r.funds);
    addRep(r.rep);
    toast(`Milestone reached: ${milestoneName(id)} · +${fmtFunds(r.funds)}`);
  } else toast(`Milestone reached: ${milestoneName(id)}`);
  saveMilestones(got);
}

function checkMilestones(b) {
  const c = F.craft;
  if (c.dead) return;
  const bp = bodyPos(b, F.t);
  const alt = Math.hypot(c.pos[0] - bp[0], c.pos[1] - bp[1]) - b.R;
  flightEvent({ kind: 'tick', body: b, alt, orbit: F.orbit, landed: !!c.landed, hasAntenna: c.parts.some((p) => p.def.antenna) });
  if (b === HOME) {
    F.flags.maxAlt = Math.max(F.flags.maxAlt, alt);
    if (!c.landed && alt > 40) award('liftoff');
    if (alt > 10000) award('alt10k');
    if (alt > 70000) { award('space'); F.flags.space = true; }
  } else if (!b.star) {
    F.flags.space = true;
    award('soi_' + b.id);
    if (!F.flags.visited.includes(b.id)) F.flags.visited.push(b.id);
  }
  const o = F.orbit;
  if (o && !c.landed && o.e < 1 && !b.star) {
    const pe = o.rp - b.R;
    if (pe > (b.atmo ? b.atmo.top : 3000)) award(b === HOME ? 'orbit' : 'orbit_' + b.id);
  }
}

function onTouchdown(b, water, speed) {
  const c0 = F.craft, bp0 = bodyPos(b, F.t), bio = biomeAt(b, Math.atan2(c0.pos[1] - bp0[1], c0.pos[0] - bp0[0]));
  flash(`${water ? 'Splashdown' : 'Touchdown'} on ${b.name}${bio ? ` (${bio})` : ''} at ${speed.toFixed(1)} m/s`, 4);
  flightEvent({ kind: 'land', body: b, biome: bio });
  if (b !== HOME) {
    award('land_' + b.id);
    if (!F.flags.landedOn.includes(b.id)) F.flags.landedOn.push(b.id);
    return;
  }
  if (F.flags.space) award('splash');
  for (const id of F.flags.landedOn) award('return_' + id);
}

/* ---------------- rendering ---------------- */

function flightRender() {
  const ctx = F.ctx;
  ctx.setTransform(F.dpr, 0, 0, F.dpr, 0, 0);
  if (F.map) renderMap(); else renderWorld();
  drawNavball();
  updateHud();
}

function drawStars(alpha, rot) {
  if (alpha <= 0.01) return;
  const ctx = F.ctx, W = F.W, H = F.H, cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (const s of F.stars) {
    const x0 = (s[0] - 0.5) * 2 * R, y0 = (s[1] - 0.5) * 2 * R;
    const x = cx + x0 * cr - y0 * sr, y = cy + x0 * sr + y0 * cr;
    if (x < 0 || y < 0 || x > W || y > H) continue;
    ctx.fillStyle = `rgba(255,255,255,${(alpha * s[3]).toFixed(3)})`;
    ctx.fillRect(x, y, s[2], s[2]);
  }
}

function renderWorld() {
  if (typeof gfx3d === 'function' && gfx3d()) { renderWorld3d(); return; }
  const ctx = F.ctx, W = F.W, H = F.H, c = F.craft, t = F.t;
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  const bp = bodyPos(b, t);
  const up = Math.atan2(c.pos[1] - bp[1], c.pos[0] - bp[0]);
  const rot = Math.PI / 2 - up + F.rotOffset;
  F.viewRot = rot;
  const alt = Math.hypot(c.pos[0] - bp[0], c.pos[1] - bp[1]) - b.R;
  const sky = b.sky || ['#000006', '#03040c'];
  const sk = b.atmo && b.sky ? Math.pow(Math.max(0, 1 - Math.max(0, alt) / (b.atmo.top * 0.9)), 1.6) * Math.min(1, 0.45 + b.atmo.rho0) : 0;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mixColor('#000006', sky[0], sk));
  g.addColorStop(1, mixColor('#03040c', sky[1], sk));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  F.daylight = daylight(c, b, t);
  if (F.daylight < 1) { ctx.fillStyle = `rgba(0,0,8,${((1 - F.daylight) * sk * 0.92).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  drawStars(1 - sk * 1.5 * F.daylight, -rot);

  const cam = c.pos, z = F.zoom;
  const viewR = Math.hypot(W, H) / 2 / z;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(z, -z);
  ctx.rotate(rot);

  // atmosphere halos when zoomed far out
  for (const ab of BODIES) {
    if (!ab.atmo || ab.R * z >= 3000) continue;
    const ap = bodyPos(ab, t), hx = ap[0] - cam[0], hy = ap[1] - cam[1], ro = ab.R + ab.atmo.top * 1.3;
    if (Math.hypot(hx, hy) - ro > viewR) continue;
    const [cr, cg, cb] = hexToRgb(ab.sky ? ab.sky[1] : '#6eaaff');
    const gr = ctx.createRadialGradient(hx, hy, ab.R * 0.98, hx, hy, ro);
    gr.addColorStop(0, `rgba(${cr},${cg},${cb},0.55)`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(hx, hy, ro, 0, TAU); ctx.fill();
  }
  // clouds
  if (b === HOME && alt < 30000 && z > 0.02) {
    for (const cl of F.clouds) {
      const r = HOME.R + cl.alt;
      const x = r * Math.cos(cl.phi) - cam[0], y = r * Math.sin(cl.phi) - cam[1];
      if (Math.hypot(x, y) > viewR + cl.w) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(cl.phi - Math.PI / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(0, 0, cl.w, cl.h, 0, 0, TAU);
      ctx.ellipse(cl.w * 0.35, cl.h * 0.5, cl.w * 0.5, cl.h * 0.9, 0, 0, TAU);
      ctx.ellipse(-cl.w * 0.4, cl.h * 0.3, cl.w * 0.45, cl.h * 0.7, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  for (const wb of BODIES) {
    if (wb.star) drawStarWorld(ctx, wb, t, cam, viewR);
    else drawBodyWorld(ctx, wb, t, cam, viewR, z);
  }
  drawPad(ctx, cam, viewR);

  const pressure = atmo(b, alt).p;
  for (const d of F.debris) drawCraft(ctx, d, cam, z, pressure);
  for (const o of F.others) if (!o.dead) drawCraft(ctx, o, cam, z, pressure);
  if (!c.dead) {
    if (c.heat > 3e7) {
      const bv = bodyVel(b, t);
      const vx = c.vel[0] - bv[0], vy = c.vel[1] - bv[1], v = Math.hypot(vx, vy) || 1;
      const a = Math.min(0.85, (c.heat - 3e7) / 1.2e8);
      const fx = (vx / v) * c.length * 0.35, fy = (vy / v) * c.length * 0.35;
      const gr = ctx.createRadialGradient(fx, fy, 0, fx, fy, c.length * 0.9 + 4);
      gr.addColorStop(0, `rgba(255,170,80,${a})`); gr.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(fx, fy, c.length * 0.9 + 4, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    drawCraft(ctx, c, cam, z, pressure);
  }
  // particles
  for (const p of F.particles) {
    if (p.kind !== 'smoke') continue;
    ctx.fillStyle = `rgba(215,215,220,${((p.life / p.max) * 0.35).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(p.x - cam[0], p.y - cam[1], p.size, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const p of F.particles) {
    if (p.kind !== 'fire') continue;
    const a = p.life / p.max;
    ctx.fillStyle = `rgba(255,${Math.round(100 + 120 * a)},40,${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(p.x - cam[0], p.y - cam[1], p.size, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  // night falls over everything except the HUD
  if (F.daylight < 0.98) { ctx.fillStyle = `rgba(0,0,15,${((1 - F.daylight) * 0.5).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }

  if (!c.dead && c.length * z < 5) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-(c.angle + rot) + Math.PI / 2);
    ctx.fillStyle = '#ffd34d';
    ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

/* Map focus is 'soi' (the body you're orbiting), 'vessel', or a body. */
function mapFocusBody(sb) { return F.mapFocus === 'soi' ? sb : F.mapFocus === 'vessel' ? null : F.mapFocus; }
function mapFocusPos(sb) {
  const fb = mapFocusBody(sb);
  return fb ? bodyPos(fb, F.t) : F.craft.pos;
}
function mapFocusName(sb) {
  const fb = mapFocusBody(sb);
  return F.mapFocus === 'soi' ? `${sb.name} (current)` : fb ? fb.name : 'vessel';
}
function fitZoom(b) {
  const m = Math.min(F.W, F.H);
  return b.star ? m / (OCHRE.orbitR * 2.6) : m / (b.R * 8);
}
function cycleMapFocus() {
  const order = ['soi', 'vessel', ...BODIES];
  F.mapFocus = order[(order.indexOf(F.mapFocus) + 1) % order.length];
  const c = F.craft, sb = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], F.t);
  const fb = mapFocusBody(sb);
  if (fb) F.mapZoom = fitZoom(fb);
  F.mapPan = [0, 0];
}
/* Click a planet on the map to focus it. */
function mapClick(sx, sy) {
  if (!F.mapScreen) return;
  let best = null, bd = Infinity;
  for (const m of F.mapScreen) {
    const d = Math.hypot(sx - m.x, sy - m.y);
    if (d < Math.max(14, m.r) && d < bd) { bd = d; best = m.b; }
  }
  // a new focus centres on that planet; clicking the one already in focus just re-centres it
  if (best) {
    const c = F.craft, sb = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], F.t);
    if (mapFocusBody(sb) !== best) F.mapZoom = fitZoom(best);
    F.mapFocus = best;
    F.mapPan = [0, 0];
  }
}

/* A ring round a world in map view, coloured by biome, with the names written along it when there's room. */
function drawBiomeRing(ctx, b, x, y, rr) {
  const N = 720, w = clamp(rr * 0.05, 4, 10), runs = [];
  for (let i = 0; i < N; i++) {
    const name = biomeAt(b, (i / N) * TAU), last = runs[runs.length - 1];
    if (last && last.name === name) last.n++; else runs.push({ name, i, n: 1 });
  }
  if (runs.length > 1 && runs[0].name === runs[runs.length - 1].name) { const l = runs.pop(); runs[0].i = l.i - N; runs[0].n += l.n; }
  ctx.save();
  ctx.lineWidth = w;
  for (const r of runs) {
    ctx.strokeStyle = biomeColor(r.name);
    ctx.beginPath();
    // the map's y axis points down, so angles run clockwise on screen
    ctx.arc(x, y, rr + w / 2 + 1, -((r.i + r.n) / N) * TAU, -(r.i / N) * TAU);
    ctx.stroke();
  }
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const seen = new Set();
  for (const r of runs.slice().sort((p, q) => q.n - p.n)) {
    if (seen.has(r.name) || (r.n / N) * TAU * rr < ctx.measureText(r.name).width + 6) continue;
    seen.add(r.name);
    const a = ((r.i + r.n / 2) / N) * TAU, R = rr + w + 12;
    ctx.fillStyle = biomeColor(r.name);
    ctx.fillText(r.name, x + Math.cos(a) * R, y - Math.sin(a) * R + 4);
  }
  ctx.restore();
}

function renderMap() {
  const ctx = F.ctx, W = F.W, H = F.H, c = F.craft, t = F.t;
  ctx.fillStyle = '#03050c';
  ctx.fillRect(0, 0, W, H);
  drawStars(0.55, 0);
  const sb = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  const f0 = mapFocusPos(sb), foc = [f0[0] + F.mapPan[0], f0[1] + F.mapPan[1]];
  if (!F.mapZoom) F.mapZoom = fitZoom(sb);
  const z = F.mapZoom;
  const S = (x, y) => [W / 2 + (x - foc[0]) * z, H / 2 - (y - foc[1]) * z];
  const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, Math.max(r, 0.5), 0, TAU); };
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const bodyLabel = (name, x, y, rpx) => ctx.fillText(name, x, rpx > 40 ? y + 4 : y - Math.max(rpx, 3) - 8);
  const onScreen = (x, y, r) => x + r > -50 && x - r < W + 50 && y + r > -50 && y - r < H + 50;

  // orbits
  ctx.lineWidth = 1;
  for (const b of BODIES) {
    if (!b.parent) continue;
    const pp = bodyPos(b.parent, t), [px, py] = S(pp[0], pp[1]), r = b.orbitR * z;
    if (r < 4 || r > 2e7) continue;
    ctx.strokeStyle = b === sb || b === sb.parent || b.parent === sb ? 'rgba(160,200,255,0.32)' : 'rgba(180,190,210,0.14)';
    circle(px, py, r); ctx.stroke();
  }
  // bodies
  F.mapScreen = [];
  for (const b of BODIES) {
    const bp = bodyPos(b, t), [x, y] = S(bp[0], bp[1]);
    const rpx = b.R * z;
    // only label moons when their planet's system is big enough on screen
    const visible = b.star || !b.parent || b.parent.star || b.orbitR * z > 18;
    if (!visible || !onScreen(x, y, Math.max(rpx, b.soi * z))) continue;
    F.mapScreen.push({ b, x, y, r: Math.max(rpx, 6) });
    if (b.star) {
      const gr = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rpx * 2.5, 18));
      gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.4, 'rgba(255,200,80,0.6)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
      ctx.fillStyle = gr; circle(x, y, Math.max(rpx * 2.5, 18)); ctx.fill();
      ctx.fillStyle = '#fff3c4'; circle(x, y, Math.max(rpx, 5)); ctx.fill();
    } else {
      if (b.atmo && rpx > 2) {
        const atmR = (b.R + b.atmo.top) * z;
        const [cr, cg, cb] = hexToRgb(b.sky ? b.sky[1] : '#6eaaff');
        const ga = ctx.createRadialGradient(x, y, rpx, x, y, atmR);
        ga.addColorStop(0, `rgba(${cr},${cg},${cb},0.45)`); ga.addColorStop(1, `rgba(${cr},${cg},${cb},0.05)`);
        ctx.fillStyle = ga; circle(x, y, atmR); ctx.fill();
      }
      const rr = Math.max(rpx, b.parent && b.parent.star ? 3.5 : 2.5);
      const gh = ctx.createRadialGradient(x - rr * 0.35, y - rr * 0.35, 0, x, y, rr);
      gh.addColorStop(0, mixColor(b.colMap, '#ffffff', 0.35)); gh.addColorStop(0.7, b.colMap); gh.addColorStop(1, mixColor(b.colMap, '#000000', 0.45));
      ctx.fillStyle = gh; circle(x, y, rr); ctx.fill();
      if (rr > 3) { circle(x, y, rr); shadeNightSide(ctx, b, t, x, y, rr, true); }
      if (b === HOME && rpx > 6) { // a hint of land on the home world
        ctx.fillStyle = 'rgba(80,150,70,0.55)';
        ctx.beginPath(); ctx.ellipse(x - rr * 0.2, y - rr * 0.1, rr * 0.45, rr * 0.3, 0.6, 0, TAU); ctx.fill();
      }
      if (b.gas && rpx > 4) {
        ctx.save(); circle(x, y, rr); ctx.clip();
        ctx.fillStyle = 'rgba(140,90,50,0.35)';
        for (const f of [-0.5, -0.15, 0.25, 0.6]) ctx.fillRect(x - rr, y + f * rr, 2 * rr, rr * 0.14);
        ctx.restore();
      }
      if (BIOMES[b.id] && rpx > 40) drawBiomeRing(ctx, b, x, y, rr);
      const sp = b.soi * z;
      if (sp > 14 && sp < 6000) {
        ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(255,200,120,0.22)';
        circle(x, y, sp); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.fillStyle = b === sb ? '#ffffff' : 'rgba(255,255,255,0.7)';
    bodyLabel(b.name, x, y, rpx);
  }

  // predicted paths. Each segment is drawn in the frame of the body it is in, anchored where that body
  // will be when the craft arrives (a "ghost"). With a manoeuvre node, the current path stops at the node
  // and the planned path continues from it.
  const node = F.node;
  const preds = [F.pred, node && node.pred].filter(Boolean);
  const anchor = preds.every((pr) => pr.pts.every((p) => inHomeSystem(p.b))) ? HOME : SUN;
  const an = bodyPos(anchor, t);
  const place = (b, tau) => { const p = bodyPos(b, tau), a = bodyPos(anchor, tau); return [p[0] - a[0] + an[0], p[1] - a[1] + an[1]]; };
  const drawPred = (pred, colorOffset, untilT, dashed) => {
    const pts = pred.pts, screen = [], ghosts = [];
    let seg = -1, ref = null, curB = null, first = true;
    ctx.lineWidth = 2;
    ctx.setLineDash(dashed ? [8, 5] : []);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.t > untilT) break;
      if (p.b !== curB) {
        if (i > 0) ctx.stroke();
        seg++; curB = p.b; first = true;
        ref = place(p.b, i === 0 || p.b === anchor ? t : p.t);
        if (i > 0 && !p.b.star && p.b !== anchor) ghosts.push({ b: p.b, ref });
        ctx.strokeStyle = PATH_COLORS[(seg + colorOffset) % PATH_COLORS.length];
        ctx.beginPath();
      }
      const bpos = bodyPos(p.b, p.t);
      const s2 = S(p.x - bpos[0] + ref[0], p.y - bpos[1] + ref[1]);
      screen.push({ x: s2[0], y: s2[1], t: p.t, i });
      if (first) { ctx.moveTo(s2[0], s2[1]); first = false; } else ctx.lineTo(s2[0], s2[1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const g of ghosts) {
      const [gx, gy] = S(g.ref[0], g.ref[1]), rr = Math.max(g.b.R * z, 4);
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,179,71,0.85)'; ctx.lineWidth = 1;
      circle(gx, gy, rr); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffb347'; ctx.fillText(`${g.b.name} at encounter`, gx, gy + rr + 16);
    }
    const imp = pred.events.find((e) => e.type === 'impact');
    const last = screen[screen.length - 1];
    if (imp && last && last.i === pts.length - 1) {
      ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(last.x - 6, last.y - 6); ctx.lineTo(last.x + 6, last.y + 6); ctx.moveTo(last.x + 6, last.y - 6); ctx.lineTo(last.x - 6, last.y + 6); ctx.stroke();
      ctx.fillStyle = '#ff8080'; ctx.fillText('Impact', last.x, last.y - 12);
    }
    return screen;
  };
  F.pathScreen = F.pred ? drawPred(F.pred, 0, node && !node.frozen ? node.t : Infinity, false) : [];
  F.nodeHandles = [];
  let nodeScreen = null;
  if (node && node.pred) {
    const ns = drawPred(node.pred, 1, Infinity, true);
    if (node.frozen) { const v = S(c.pos[0], c.pos[1]); nodeScreen = { x: v[0], y: v[1] }; }
    else if (ns.length) nodeScreen = ns[0];
    if (nodeScreen) {
      // node marker and its drag handles
      ctx.fillStyle = '#5aa8ff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      circle(nodeScreen.x, nodeScreen.y, 7); ctx.fill(); ctx.stroke();
      if (!node.frozen && node.frame) {
        const hs = [['pro', 1, node.frame.pro, '#c8ff3c'], ['pro', -1, node.frame.pro, '#c8ff3c'], ['rad', 1, node.frame.rad, '#4fd1ff'], ['rad', -1, node.frame.rad, '#4fd1ff']];
        for (const [axis, sign, d, col] of hs) {
          const dx = d[0] * sign, dy = -d[1] * sign;
          const hx = nodeScreen.x + dx * 40, hy = nodeScreen.y + dy * 40;
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(nodeScreen.x + dx * 9, nodeScreen.y + dy * 9); ctx.lineTo(hx - dx * 8, hy - dy * 8); ctx.stroke();
          ctx.fillStyle = 'rgba(10,14,22,0.85)';
          circle(hx, hy, 8); ctx.fill(); ctx.stroke();
          if (sign < 0) { ctx.beginPath(); ctx.moveTo(hx - 4, hy - 4); ctx.lineTo(hx + 4, hy + 4); ctx.moveTo(hx + 4, hy - 4); ctx.lineTo(hx - 4, hy + 4); ctx.stroke(); }
          else { ctx.fillStyle = col; circle(hx, hy, 3); ctx.fill(); }
          F.nodeHandles.push({ x: hx, y: hy, axis, sign, dir: [dx, dy] });
        }
      }
    }
  }
  // target: where we pass closest
  const ca = F.closest;
  if (F.target && ca && !ca.inside) {
    const src = node && node.pred ? node.pred : F.pred;
    const p = src && src.pts[ca.i];
    if (p) {
      const ap = bodyPos(anchor, ca.t), [gx, gy] = S(ca.tpos[0] - ap[0] + an[0], ca.tpos[1] - ap[1] + an[1]);
      const bpos = bodyPos(p.b, p.t), ref = place(p.b, p.b === anchor ? t : p.t);
      const [cx2, cy2] = S(p.x - bpos[0] + ref[0], p.y - bpos[1] + ref[1]);
      ctx.strokeStyle = '#e070ff'; ctx.fillStyle = '#e070ff'; ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(cx2, cy2); ctx.lineTo(gx, gy); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(cx2, cy2 - 6); ctx.lineTo(cx2 + 6, cy2); ctx.lineTo(cx2, cy2 + 6); ctx.lineTo(cx2 - 6, cy2); ctx.closePath(); ctx.fill();
      circle(gx, gy, Math.max((F.target.R || 0) * z, 5)); ctx.stroke();
      ctx.fillText(`Closest ${fmtDist(ca.d - (F.target.R || 0))}`, cx2, cy2 - 12);
    }
  }
  // other vessels
  F.mapVessels = [];
  const s0 = universe();
  const ships = (s0 ? s0.vessels.map((v) => ({ vid: v.id, name: v.name, pos: v.s })) : [])
    .concat(F.others.filter((o2) => !o2.dead).map((o2) => ({ vid: o2.vid, name: o2.meta.name, pos: o2.pos })));
  for (const v of ships) {
    const [vx, vy] = S(v.pos[0], v.pos[1]);
    if (vx < -20 || vy < -20 || vx > W + 20 || vy > H + 20) continue;
    const isT = F.target && F.target.vid === v.vid;
    ctx.fillStyle = isT ? '#e070ff' : '#9fb3d1';
    ctx.beginPath(); ctx.moveTo(vx, vy - 6); ctx.lineTo(vx + 6, vy); ctx.lineTo(vx, vy + 6); ctx.lineTo(vx - 6, vy); ctx.closePath(); ctx.fill();
    ctx.fillText(v.name, vx, vy + 18);
    F.mapVessels.push({ vid: v.vid, name: v.name, x: vx, y: vy });
  }
  // apsis markers
  const o = F.orbit;
  if (o && o.e > 0.002) {
    const sp = bodyPos(sb, t);
    const dx = o.ex / o.e, dy = o.ey / o.e;
    const marker = (x, y, label, col) => {
      const [px, py] = S(x, y);
      ctx.fillStyle = col; circle(px, py, 5); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = col; ctx.fillText(label, px, py - 10);
    };
    if (o.rp > sb.R) marker(sp[0] + dx * o.rp, sp[1] + dy * o.rp, 'Pe ' + fmtDist(o.rp - sb.R), '#7dffa8');
    if (isFinite(o.ra)) marker(sp[0] - dx * o.ra, sp[1] - dy * o.ra, 'Ap ' + fmtDist(o.ra - sb.R), '#4fd1ff');
  }
  // vessel
  if (!c.dead) {
    const [vx, vy] = S(c.pos[0], c.pos[1]);
    ctx.save();
    ctx.translate(vx, vy);
    ctx.rotate(-c.angle);
    ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, 6); ctx.lineTo(-3, 0); ctx.lineTo(-6, -6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffd34d'; ctx.fillText(F.craftName, vx, vy + 22);
  }
}

function drawNavball() {
  const x = F.navCtx, c = F.craft;
  x.setTransform(F.dpr, 0, 0, F.dpr, 0, 0);
  x.clearRect(0, 0, 150, 150);
  const cx = 75, cy = 75, R = 68;
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], F.t);
  const bp = bodyPos(b, F.t);
  const up = Math.atan2(c.pos[1] - bp[1], c.pos[0] - bp[0]);
  x.save();
  x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.clip();
  const sky = x.createLinearGradient(0, 0, 0, cy);
  sky.addColorStop(0, '#2f6bb8'); sky.addColorStop(1, '#5f9be0');
  x.fillStyle = sky; x.fillRect(0, 0, 150, cy);
  const gnd = x.createLinearGradient(0, cy, 0, 150);
  gnd.addColorStop(0, '#9a6a3c'); gnd.addColorStop(1, '#5e3c1e');
  x.fillStyle = gnd; x.fillRect(0, cy, 150, 150 - cy);
  x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = 1;
  for (let a = 0; a < 360; a += 15) {
    const r0 = a % 45 === 0 ? R - 12 : R - 6, ar = (a * Math.PI) / 180;
    x.beginPath(); x.moveTo(cx + Math.cos(ar) * r0, cy - Math.sin(ar) * r0); x.lineTo(cx + Math.cos(ar) * R, cy - Math.sin(ar) * R); x.stroke();
  }
  x.strokeStyle = '#fff'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.stroke();
  x.restore();
  x.strokeStyle = '#0d121c'; x.lineWidth = 4;
  x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke();

  const bv = bodyVel(b, F.t);
  const vx = c.vel[0] - bv[0], vy = c.vel[1] - bv[1];
  if (!c.landed && Math.hypot(vx, vy) > 0.5) {
    const pa = Math.atan2(vy, vx) - up + Math.PI / 2;
    for (const [ang, retro] of [[pa, false], [pa + Math.PI, true]]) {
      const mx = cx + Math.cos(ang) * R * 0.74, my = cy - Math.sin(ang) * R * 0.74;
      x.strokeStyle = '#c8ff3c'; x.lineWidth = 2;
      x.beginPath(); x.arc(mx, my, 6, 0, TAU); x.stroke();
      x.beginPath();
      if (retro) { x.moveTo(mx - 4, my - 4); x.lineTo(mx + 4, my + 4); x.moveTo(mx + 4, my - 4); x.lineTo(mx - 4, my + 4); }
      else {
        const ux = Math.cos(ang), uy = -Math.sin(ang);
        x.moveTo(mx + ux * 6, my + uy * 6); x.lineTo(mx + ux * 11, my + uy * 11);
        x.moveTo(mx - uy * 6, my + ux * 6); x.lineTo(mx - uy * 11, my + ux * 11);
        x.moveTo(mx + uy * 6, my - ux * 6); x.lineTo(mx + uy * 11, my - ux * 11);
      }
      x.stroke();
    }
  }
  if (F.node && Math.hypot(F.node.remaining[0], F.node.remaining[1]) > 0.05) {
    const na = Math.atan2(F.node.remaining[1], F.node.remaining[0]) - up + Math.PI / 2;
    const mx = cx + Math.cos(na) * R * 0.6, my = cy - Math.sin(na) * R * 0.6;
    x.strokeStyle = '#5aa8ff'; x.lineWidth = 2.5;
    x.beginPath(); x.arc(mx, my, 7, 0, TAU); x.stroke();
    x.beginPath(); x.moveTo(mx - 11, my); x.lineTo(mx - 4, my); x.moveTo(mx + 4, my); x.lineTo(mx + 11, my); x.moveTo(mx, my - 11); x.lineTo(mx, my - 4); x.stroke();
  }
  const tsn = targetState(F.target);
  if (tsn) {
    const ta = Math.atan2(tsn.pos[1] - c.pos[1], tsn.pos[0] - c.pos[0]) - up + Math.PI / 2;
    const mx = cx + Math.cos(ta) * R * 0.86, my = cy - Math.sin(ta) * R * 0.86;
    x.strokeStyle = '#e070ff'; x.lineWidth = 2;
    x.beginPath(); x.arc(mx, my, 6, 0, TAU); x.stroke();
    x.fillStyle = '#e070ff'; x.beginPath(); x.arc(mx, my, 2, 0, TAU); x.fill();
  }
  const ha = c.angle - up + Math.PI / 2;
  const hx = Math.cos(ha), hy = -Math.sin(ha);
  x.strokeStyle = '#ffd34d'; x.lineWidth = 3; x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx - hx * 14, cy - hy * 14); x.lineTo(cx + hx * R * 0.9, cy + hy * R * 0.9); x.stroke();
  x.fillStyle = '#ffd34d';
  x.beginPath();
  x.moveTo(cx + hx * R * 0.95, cy + hy * R * 0.95);
  x.lineTo(cx + hx * R * 0.72 - hy * 7, cy + hy * R * 0.72 + hx * 7);
  x.lineTo(cx + hx * R * 0.72 + hy * 7, cy + hy * R * 0.72 - hx * 7);
  x.closePath(); x.fill();
  x.fillStyle = '#111'; x.beginPath(); x.arc(cx, cy, 4, 0, TAU); x.fill();
}

function updateHud() {
  const c = F.craft, h = F.hud, t = F.t;
  if (F.frame % 3 !== 0 && !F.paused) return;
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  const bp = bodyPos(b, t), bv = bodyVel(b, t);
  const rx = c.pos[0] - bp[0], ry = c.pos[1] - bp[1], r = Math.hypot(rx, ry);
  const vx = c.vel[0] - bv[0], vy = c.vel[1] - bv[1];
  const alt = r - b.R;
  h.hAlt.textContent = fmtDist(alt);
  h.hSpd.textContent = fmtNum(Math.hypot(vx, vy), 1) + ' m/s';
  h.hVs.textContent = fmtNum((vx * rx + vy * ry) / r, 1) + ' m/s';
  const radar = alt - groundAlt(b, Math.atan2(ry, rx));
  h.hRadarW.style.visibility = radar < 15000 ? 'visible' : 'hidden';
  h.hRadar.textContent = fmtDist(radar);
  const o = F.orbit;
  h.hBody.textContent = (c.landed ? 'Landed on ' : 'Orbiting ') + b.name;
  // the biome below, while close enough to the ground for it to matter
  const bio = alt < spaceHighAlt(b) ? biomeAt(b, Math.atan2(ry, rx)) : null;
  h.hBiomeRow.classList.toggle('hidden', !bio);
  if (bio && h.hBiome.textContent !== bio) h.hBiome.textContent = bio;
  if (o) {
    h.hAp.textContent = isFinite(o.ra) ? fmtDist(o.ra - b.R) : 'Escaping';
    const sub = o.rp < b.R;
    h.hPe.textContent = sub ? 'Suborbital' : fmtDist(o.rp - b.R);
    h.hTAp.textContent = o.e < 1 ? fmtDur(o.tAp) : '—';
    h.hTPe.textContent = sub ? '—' : fmtDur(o.tPe);
    h.hPer.textContent = o.e < 1 && !sub ? fmtDur(o.period) : '—';
  } else {
    for (const k of ['hAp', 'hPe', 'hTAp', 'hTPe', 'hPer']) h[k].textContent = '—';
  }
  const enc = F.encounter;
  const rows = [[h.hEncRow, h.hEncLabel, h.hEnc], [h.hEnc2Row, h.hEnc2Label, h.hEnc2]];
  rows.forEach(([row, lab, val], i) => {
    const e = enc && enc[i];
    row.classList.toggle('hidden', !e);
    if (e) { const [l, v] = describeEvent(e, t); lab.textContent = l; val.textContent = v; }
  });

  h.hClock.textContent = fmtClock(t);
  h.hWarp.textContent = fmtNum(WARPS[F.warp]) + '×' + (F.warp > 3 ? '' : F.warp > 0 ? ' (physics)' : '');
  h.thrFill.style.height = Math.round(c.throttle * 100) + '%';
  h.thrPct.textContent = Math.round(c.throttle * 100) + '%';

  // delta-v is simulated, so refresh it only now and then
  if (!(F.dvTick > 0) && !c.dead) {
    const rows = simulateStages(c, true);
    F.dvCache = { stage: rows.length ? rows[0].dv : 0, total: rows.reduce((a, x) => a + x.dv, 0) };
    F.dvTick = 10;
  }
  F.dvTick--;
  if (F.dvCache) {
    h.hDv.textContent = fmtNum(F.dvCache.stage) + ' m/s';
    h.hDvT.textContent = fmtNum(F.dvCache.total) + ' m/s';
  }
  const gl = b.mu / (r * r);
  h.hTwr.textContent = (c.thrust / (c.M * gl)).toFixed(2);
  // fuel feeding the lit engines (or the ones the next stage lights)
  let feeding = c.engines.filter((e) => e.ignited);
  if (!feeding.length && c.stageIdx < c.stages.length) feeding = c.engines.filter((e) => c.stages[c.stageIdx].includes(e.uid));
  const gids = new Set(feeding.filter((e) => !e.def.solid).map((e) => c.groups.get(e.uid)));
  let liq = 0, liqMax = 0, sol = 0, solMax = 0;
  for (const p of c.tanks) if (gids.has(c.groups.get(p.uid))) { liq += p.fuel; liqMax += p.def.fuel; }
  for (const e of feeding) if (e.def.solid) { sol += e.solid; solMax += e.def.solid; }
  let mono = 0, monoMax = 0;
  for (const p of c.parts) if (p.def.mono) { mono += p.mono; monoMax += p.def.mono; }
  h.fLiqRow.style.display = liqMax > 0 ? '' : 'none';
  h.fSolRow.style.display = solMax > 0 ? '' : 'none';
  h.fMonoRow.style.display = monoMax > 0 && (c.rcsParts.length || c.engines.some((e) => e.def.prop === 'mono')) ? '' : 'none';
  let gas = 0, gasMax = 0;
  for (const p of c.parts) if (p.def.gas) { gas += p.gas; gasMax += p.def.gas; }
  h.fGasRow.style.display = gasMax > 0 ? '' : 'none';
  h.fGas.style.width = (gasMax ? (100 * gas) / gasMax : 0) + '%';
  h.fLiq.style.width = (liqMax ? (100 * liq) / liqMax : 0) + '%';
  h.fSol.style.width = (solMax ? (100 * sol) / solMax : 0) + '%';
  h.fMono.style.width = (monoMax ? (100 * mono) / monoMax : 0) + '%';
  if (F.frame % 15 === 0 || F.paused) { renderContractHud(); renderSciencePanel(); }
  if (PM.uid != null && F.frame % 6 === 0) renderPartMenu();
  h.bSci.classList.toggle('hidden', !isCareer());
  updateSystemsHud(c, b, o, t);
  h.hNext.textContent = c.stageIdx < c.stages.length ? 'Next: ' + stageLabel(c.stages[c.stageIdx], (u) => c.byUid.get(u)) : 'No stages left';
  h.bRcs.classList.toggle('on', c.rcsOn);
  h.bRcs.classList.toggle('hidden', !c.rcsParts.length);
  h.bGear.classList.toggle('hidden', !c.wheels.some((p) => p.def.retract));
  h.bGear.classList.toggle('on', c.wheels.some((p) => p.def.retract && !p.gearUp));
  h.bBrakes.classList.toggle('hidden', !c.wheels.length && !c.brakes.length);
  h.bBrakes.classList.toggle('on', !!(c.wheelBrake || c.brakes.some((p) => p.brake)));
  const rel = wrapPi(c.angle - Math.atan2(ry, rx));
  const pitch = 90 - (Math.abs(rel) * 180) / Math.PI;
  const side = Math.abs(rel) < 0.01 || Math.abs(rel) > Math.PI - 0.01 ? '' : rel > 0 ? '◀ ' : '▶ ';
  h.hPitch.textContent = `${side}PITCH ${pitch.toFixed(0)}°`;
  h.bRecover.classList.toggle('hidden', !(c.landed && c.landed.body === HOME && !c.dead && (F.flags.maxAlt > 100)));
  h.bQSave.parentElement.classList.toggle('hidden', !!F.tutorial);
  h.bQSave.disabled = !canQuickSave();
  h.bQLoad.disabled = !quickSaveInfo();
  h.bMap.classList.toggle('on', F.map);
  h.mapHint.classList.toggle('hidden', !F.map);
  if (F.map) {
    const sb = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
    h.mapHint.textContent = `MAP · scroll to zoom · F: focus on ${mapFocusName(sb)} · M: back to flight`;
  }
}

let flashTimer = null;
function flash(text, secs = 3) {
  const el = F.hud.msg;
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
}

function toast(text) {
  const el = document.getElementById('toast');
  const d = document.createElement('div');
  d.className = 'toast-item';
  d.textContent = '★ ' + text;
  el.appendChild(d);
  setTimeout(() => d.classList.add('out'), 3800);
  setTimeout(() => d.remove(), 4500);
}
