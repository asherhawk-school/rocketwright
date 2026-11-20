'use strict';
/* Rocketwright — flight scene: physics, time warp, camera, map view, HUD. */

const WARPS = [1, 2, 3, 4, 10, 50, 100, 1000, 10000, 100000];
const WARP_ALT = [0, 0, 0, 0, 0, 2000, 5000, 15000, 40000, 100000];
const PHYS_DT = 0.02;
const SAS_MODES = ['off', 'stab', 'pro', 'retro', 'radout', 'radin'];
const PATH_COLORS = ['#4fd1ff', '#ffb347', '#c792ff', '#7dffa8'];

const F = {
  running: false, paused: false, craft: null, debris: [], particles: [],
  t: 0, acc: 0, warp: 0, zoom: 6, mapZoom: 0, map: false, mapFocus: 0,
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
  for (const id of ['hAlt', 'hSpd', 'hVs', 'hRadar', 'hRadarW', 'hBody', 'hAp', 'hPe', 'hTAp', 'hTPe', 'hPer', 'hEncRow', 'hEncLabel', 'hEnc',
    'hClock', 'hWarp', 'thrFill', 'thrPct', 'hDv', 'hDvT', 'hTwr', 'fLiq', 'fSol', 'fLiqRow', 'fSolRow', 'fMono', 'fMonoRow', 'bRcs', 'hNext', 'hPitch',
    'bRecover', 'bMap', 'msg', 'mapHint']) F.hud[id] = document.getElementById(id);
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

function flightStart(design, name) {
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
  Object.assign(F, {
    craft: c, debris: [], particles: [], t: 0, acc: 0, warp: 0, sas: 'stab', hold: null, map: false, mapZoom: 0, mapFocus: 0,
    deadTimer: 0, endShown: false, pred: null, encounter: null, orbit: null, lastBody: HOME, rotOffset: 0, paused: false,
    flags: { space: false, moon: false, landedMoon: false, maxAlt: 0 }, flightMilestones: [], running: true,
    dvTick: 0, dvCache: null, rcsTx: 0, rcsTy: 0,
  });
  F.zoom = clamp((F.H * 0.42) / (c.length + 8), 2, 30);
  for (const k in F.keys) F.keys[k] = false;
  updateSasButtons();
  flash(`${F.craftName} is on the pad. Press SPACE to launch!`, 5);
}

function doStage() {
  const c = F.craft;
  if (c.dead || c.stageIdx >= c.stages.length) return;
  const first = c.stageIdx === 0;
  const res = c.activateNext((comp, dec) => separatePiece(c, comp, dec));
  if (!res) return;
  const msgs = [];
  if (res.separated) msgs.push(res.separated > 1 ? `${res.separated} pieces separated` : 'Stage separated');
  if (res.ignited.length) {
    const names = [...new Set(res.ignited.map((p) => shortName(p.def)))].join(', ');
    msgs.push(`Ignition: ${names}`);
    if (first && c.throttle === 0) c.throttle = 1;
  }
  if (res.chute) msgs.push('Parachute deployed');
  F.dvTick = 0;
  if (msgs.length) flash(msgs.join(' · '));
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
  F.debris.push(d);
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
  return alt >= (b.atmo ? b.atmo.top : 5000) + WARP_ALT[idx];
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
  if (!c.dead) {
    if (k.ShiftLeft || k.ShiftRight || k.KeyW || k.ArrowUp || k.vThrUp) c.throttle = Math.min(1, c.throttle + dt * 0.8);
    if (k.KeyS || k.ArrowDown || k.vThrDn) c.throttle = Math.max(0, c.throttle - dt * 0.8);
    F.userRot = (k.KeyA || k.ArrowLeft || k.vRotL ? 1 : 0) - (k.KeyD || k.ArrowRight || k.vRotR ? 1 : 0);
    if (F.userRot) F.hold = null;
    F.rcsTx = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
    F.rcsTy = (k.KeyH ? 1 : 0) - (k.KeyN ? 1 : 0);
  } else { F.userRot = 0; F.rcsTx = F.rcsTy = 0; }

  enforceWarp();
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
    flash(b === MOON ? 'Entered Pallid\'s sphere of influence' : 'Left Pallid. Back in Verdan\'s sphere of influence', 4);
  }
  F.lastBody = b;
  F.rotOffset *= Math.exp(-dt * 1.5);

  F.orbit = c.landed || c.dead ? null : orbitElements(b, c.pos[0], c.pos[1], c.vel[0], c.vel[1], F.t);
  F.predTick--;
  if (c.landed || c.dead) { F.pred = null; F.encounter = null; }
  else if (F.predTick <= 0) {
    F.pred = predictPath(c.pos[0], c.pos[1], c.vel[0], c.vel[1], F.t);
    F.encounter = findEncounter(F.pred, b);
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
  F.debris = F.debris.filter((d) => !d.dead && Math.hypot(d.pos[0] - c.pos[0], d.pos[1] - c.pos[1]) < 80000);
  F.t += dt;
  for (const k of [c, ...F.debris]) syncLanded(k);
}

/* Landed craft ride along with their (possibly moving) body. */
function syncLanded(c) {
  if (!c.landed) return;
  const bp = bodyPos(c.landed.body, F.t), bv = bodyVel(c.landed.body, F.t);
  c.pos[0] = bp[0] + c.landed.rx; c.pos[1] = bp[1] + c.landed.ry;
  c.vel[0] = bv[0]; c.vel[1] = bv[1];
}

function stepCraft(c, dt, player) {
  const t = F.t;
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  const bp = bodyPos(b, t), bv = bodyVel(b, t);
  if (c.landed) { c.pos[0] = bp[0] + c.landed.rx; c.pos[1] = bp[1] + c.landed.ry; }
  let rx = c.pos[0] - bp[0], ry = c.pos[1] - bp[1];
  const r = Math.hypot(rx, ry);
  const alt = r - b.R;
  const at = atmo(b, alt);
  c.radar = alt - groundAlt(b, Math.atan2(ry, rx));
  const T = c.engineStep(dt, at.p);
  c.updateMass();
  const ax = Math.cos(c.angle), ay = Math.sin(c.angle);
  const g = gravAcc(b, c.pos[0], c.pos[1], t);

  if (c.landed) {
    c.pos[0] = bp[0] + c.landed.rx; c.pos[1] = bp[1] + c.landed.ry;
    c.vel[0] = bv[0]; c.vel[1] = bv[1]; c.angVel = 0;
    rx = c.landed.rx; ry = c.landed.ry;
    const nx = g[0] + (ax * T) / c.M, ny = g[1] + (ay * T) / c.M;
    if ((nx * rx + ny * ry) / r > 0.02) {
      c.landed = null;
      if (player) flash('Liftoff!', 2);
    } else {
      if (T > 0) emitExhaust(c, dt, at.p, bv);
      return;
    }
  }

  c.vel[0] += (g[0] + (ax * T) / c.M) * dt;
  c.vel[1] += (g[1] + (ay * T) / c.M) * dt;
  const rcs = player ? c.rcsStep(dt, F.rcsTx || 0, F.rcsTy || 0, c.ctrl) : { fx: 0, fy: 0, k: 0 };
  if (rcs.fx || rcs.fy) {
    const f = c.rotLocal(rcs.fx, rcs.fy);
    c.vel[0] += (f[0] / c.M) * dt; c.vel[1] += (f[1] / c.M) * dt;
  }

  let tq = c.ctrl * (c.torque + c.gimbalCap + c.rcsTorqueCap * rcs.k) + c.thrustTorque;
  let kSpring = 0;
  const vrx = c.vel[0] - bv[0], vry = c.vel[1] - bv[1];
  const v = Math.hypot(vrx, vry);
  if (c.chuteOpen && c.hasChute && at.rho > 0) {
    const target = c.radar < 1500 ? 720 : 45;
    c.chuteArea += (target - c.chuteArea) * Math.min(1, dt * 0.8);
  }
  if (at.rho > 0 && v > 0.1) {
    const q = (0.5 * at.rho * v * v) / 1000; // kPa
    const vhx = vrx / v, vhy = vry / v;
    const sinA = Math.abs(ax * vhy - ay * vhx);
    const CdA = 0.55 * Math.PI * (c.width / 2) * (1 + 4 * sinA) + c.chuteArea;
    const dv = Math.min(((q * CdA) / c.M) * dt, v * 0.9);
    c.vel[0] -= vhx * dv; c.vel[1] -= vhy * dv;
    const flowAng = Math.atan2(vhy, vhx);
    // fins behind the centre of mass add stability; fins in front of it reduce it
    let stab = 0.12;
    for (const f of c.fins) stab += 0.3 * clamp(((c.yc - (f.top + f.bot) / 2) / Math.max(c.length, 1)) * 4, -1, 1);
    const kR = q * c.length * 2 * Math.max(stab, 0.02);
    tq -= kR * Math.sin(wrapPi(c.angle - flowAng));
    kSpring += kR;
    if (c.chuteArea > 1) {
      const kC = q * c.chuteArea * 0.4;
      tq -= kC * Math.sin(wrapPi(c.angle - flowAng - Math.PI));
      kSpring += kC;
    }
    c.heat = at.rho * v * v * v;
  } else c.heat = 0;
  kSpring = Math.min(kSpring, c.I * 800);
  tq -= 1.4 * Math.sqrt(kSpring * c.I) * c.angVel;
  c.angVel = clamp(c.angVel + (tq / c.I) * dt, -4, 4);
  c.angle += c.angVel * dt;

  c.pos[0] += c.vel[0] * dt;
  c.pos[1] += c.vel[1] * dt;
  if (T > 0) emitExhaust(c, dt, at.p, bv);
  contact(c, b, t + dt, player);
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

function explode(c, player, speed) {
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
  if (player) {
    F.deadTimer = 2.2;
    F.warp = 0;
    flash(`Vessel destroyed at ${speed.toFixed(1)} m/s`, 4);
  }
}

function railsStep(simDt) {
  const c = F.craft;
  F.debris = [];
  if (c.dead) { F.t += simDt; return; }
  c.angVel = 0;
  for (const p of c.parts) p.burn = 0;
  if (c.landed) {
    F.t += simDt;
    const bp = bodyPos(c.landed.body, F.t), bv = bodyVel(c.landed.body, F.t);
    c.pos = [bp[0] + c.landed.rx, bp[1] + c.landed.ry];
    c.vel = [bv[0], bv[1]];
    return;
  }
  const s = [c.pos[0], c.pos[1], c.vel[0], c.vel[1]];
  let rem = simDt, n = 0;
  while (rem > 1e-6 && n < 4000) {
    const b = soiBody(s[0], s[1], F.t);
    const bp = bodyPos(b, F.t);
    const r = Math.hypot(s[0] - bp[0], s[1] - bp[1]);
    const dt = Math.min(rem, clamp(0.002 * TAU * Math.sqrt((r * r * r) / b.mu), 0.05, 300));
    rk4Step(b, s, F.t, dt);
    F.t += dt; rem -= dt; n++;
    const nb = soiBody(s[0], s[1], F.t), np = bodyPos(nb, F.t);
    const alt = Math.hypot(s[0] - np[0], s[1] - np[1]) - nb.R;
    if (alt < (nb.atmo ? nb.atmo.top : 5000) + WARP_ALT[F.warp]) {
      c.pos = [s[0], s[1]]; c.vel = [s[2], s[3]];
      while (F.warp > 3 && !warpAllowed(F.warp)) F.warp--;
      break;
    }
  }
  c.pos = [s[0], s[1]];
  c.vel = [s[2], s[3]];
}

function controlInput(c) {
  if (F.userRot) return F.userRot;
  if (F.sas === 'off' || c.landed) return 0;
  const maxA = (c.torque + c.gimbalCap + (c.rcsOn && c.monoTotal() > 0 ? c.rcsTorqueCap : 0)) / c.I;
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
    if (F.sas === 'pro' || F.sas === 'retro') {
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
    let n = dt * 28 * e.burn * Math.min(1, pressure * 3) * Math.sqrt(e.def.thrust / 150);
    while (n > 0) {
      if (Math.random() < n) {
        const w = c.toWorld(e.x + (Math.random() - 0.5) * 1.2, e.bot - 1.5);
        const sp = 25 + Math.random() * 25, jx = (Math.random() - 0.5) * 6, jy = (Math.random() - 0.5) * 6;
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

function findEncounter(pred, cur) {
  if (!pred) return null;
  const ev = pred.events.find((e) => e.type === 'soi');
  if (cur === HOME && ev && ev.to === MOON) {
    let minD = Infinity;
    for (let i = ev.idx; i < pred.pts.length; i++) {
      const p = pred.pts[i];
      if (p.b !== MOON) break;
      const m = bodyPos(MOON, p.t);
      minD = Math.min(minD, Math.hypot(p.x - m[0], p.y - m[1]));
    }
    return { kind: 'enc', t: ev.t, pe: minD - MOON.R };
  }
  if (cur === MOON && ev && ev.to === HOME) return { kind: 'exit', t: ev.t };
  const imp = pred.events.find((e) => e.type === 'impact');
  if (imp) return { kind: 'impact', t: imp.t, body: imp.b };
  return null;
}

/* ---------------- milestones ---------------- */

function award(id) {
  const got = Store.get('milestones', {});
  if (!F.flightMilestones.includes(id)) F.flightMilestones.push(id);
  if (got[id]) return;
  got[id] = Date.now();
  Store.set('milestones', got);
  const m = MILESTONES.find((x) => x.id === id);
  if (m) toast(`Milestone reached: ${m.name}`);
}

function checkMilestones(b) {
  const c = F.craft;
  if (c.dead) return;
  const bp = bodyPos(b, F.t);
  const alt = Math.hypot(c.pos[0] - bp[0], c.pos[1] - bp[1]) - b.R;
  if (b === HOME) {
    F.flags.maxAlt = Math.max(F.flags.maxAlt, alt);
    if (!c.landed && alt > 40) award('liftoff');
    if (alt > 10000) award('alt10k');
    if (alt > 70000) { award('space'); F.flags.space = true; }
  }
  const o = F.orbit;
  if (o && !c.landed && o.e < 1) {
    const pe = o.rp - b.R;
    if (b === HOME && pe > 70000) award('orbit');
    if (b === MOON && pe > 3000) award('moonOrbit');
  }
  if (b === MOON) { award('moonSoi'); F.flags.moon = true; }
}

function onTouchdown(b, water, speed) {
  flash(`${water ? 'Splashdown' : 'Touchdown'} on ${b.name} at ${speed.toFixed(1)} m/s`, 4);
  if (b === MOON) { award('moonLand'); F.flags.landedMoon = true; }
  if (b === HOME && F.flags.space) award('splash');
  if (b === HOME && F.flags.landedMoon) award('roundTrip');
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
  const ctx = F.ctx, W = F.W, H = F.H, c = F.craft, t = F.t;
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  const bp = bodyPos(b, t);
  const up = Math.atan2(c.pos[1] - bp[1], c.pos[0] - bp[0]);
  const rot = Math.PI / 2 - up + F.rotOffset;
  const alt = Math.hypot(c.pos[0] - bp[0], c.pos[1] - bp[1]) - b.R;
  const sk = b === HOME ? Math.pow(Math.max(0, 1 - Math.max(0, alt) / 62000), 1.6) : 0;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mixColor('#000006', '#3f84dc', sk));
  g.addColorStop(1, mixColor('#03040c', '#a8d4ff', sk));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  drawStars(1 - sk * 1.5, -rot);

  const cam = c.pos, z = F.zoom;
  const viewR = Math.hypot(W, H) / 2 / z;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(z, -z);
  ctx.rotate(rot);

  // atmosphere halo when zoomed far out
  const hp = bodyPos(HOME, t);
  if (HOME.R * z < 3000) {
    const hx = hp[0] - cam[0], hy = hp[1] - cam[1];
    const gr = ctx.createRadialGradient(hx, hy, HOME.R * 0.98, hx, hy, HOME.R + HOME.atmo.top * 1.3);
    gr.addColorStop(0, 'rgba(110,170,255,0.55)'); gr.addColorStop(1, 'rgba(110,170,255,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(hx, hy, HOME.R + HOME.atmo.top * 1.3, 0, TAU); ctx.fill();
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
  drawBodyWorld(ctx, HOME, t, cam, viewR, z);
  drawBodyWorld(ctx, MOON, t, cam, viewR, z);
  drawPad(ctx, cam, viewR);

  const pressure = atmo(b, alt).p;
  for (const d of F.debris) drawCraft(ctx, d, cam, z, pressure);
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

function mapFocusPos(sb) {
  const c = F.craft;
  switch (F.mapFocus) {
    case 1: return c.pos;
    case 2: return bodyPos(HOME, F.t);
    case 3: return bodyPos(MOON, F.t);
    default: return bodyPos(sb, F.t);
  }
}
function mapFocusName(sb) {
  return ['Current body (' + sb.name + ')', 'Vessel', 'Verdan', 'Pallid'][F.mapFocus];
}

function renderMap() {
  const ctx = F.ctx, W = F.W, H = F.H, c = F.craft, t = F.t;
  ctx.fillStyle = '#03050c';
  ctx.fillRect(0, 0, W, H);
  drawStars(0.55, 0);
  const sb = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  const foc = mapFocusPos(sb);
  if (!F.mapZoom) F.mapZoom = Math.min(W, H) / (sb.R * 8);
  const z = F.mapZoom;
  const S = (x, y) => [W / 2 + (x - foc[0]) * z, H / 2 - (y - foc[1]) * z];
  const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, Math.max(r, 0.5), 0, TAU); };
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';

  // moon orbit
  const [hx, hy] = S(0, 0);
  ctx.strokeStyle = 'rgba(180,190,210,0.18)'; ctx.lineWidth = 1;
  circle(hx, hy, MOON.orbitR * z); ctx.stroke();
  // home
  const atmR = (HOME.R + HOME.atmo.top) * z;
  const ga = ctx.createRadialGradient(hx, hy, HOME.R * z, hx, hy, atmR);
  ga.addColorStop(0, 'rgba(100,170,255,0.45)'); ga.addColorStop(1, 'rgba(100,170,255,0.05)');
  ctx.fillStyle = ga; circle(hx, hy, atmR); ctx.fill();
  const gh = ctx.createRadialGradient(hx - HOME.R * z * 0.3, hy - HOME.R * z * 0.3, 0, hx, hy, HOME.R * z);
  gh.addColorStop(0, '#5aa0e0'); gh.addColorStop(0.6, '#3b7a3a'); gh.addColorStop(1, '#22456e');
  ctx.fillStyle = gh; circle(hx, hy, Math.max(HOME.R * z, 3)); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const bodyLabel = (name, x, y, rpx) => ctx.fillText(name, x, rpx > 40 ? y + 4 : y - Math.max(rpx, 3) - 8);
  bodyLabel('Verdan', hx, hy, HOME.R * z);
  // moon
  const mp = bodyPos(MOON, t);
  const [mx, my] = S(mp[0], mp[1]);
  ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(255,200,120,0.25)';
  circle(mx, my, MOON.soi * z); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = MOON.colMap; circle(mx, my, Math.max(MOON.R * z, 2.5)); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  bodyLabel('Pallid', mx, my, MOON.R * z);

  // predicted path
  if (F.pred) {
    const pts = F.pred.pts;
    let seg = -1, ref = null, curB = null, first = true;
    const ghosts = [];
    ctx.lineWidth = 2;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.b !== curB) {
        if (i > 0) ctx.stroke();
        seg++; curB = p.b; first = true;
        ref = p.b === MOON ? bodyPos(MOON, i === 0 ? t : p.t) : null;
        if (ref && i > 0) ghosts.push(ref);
        ctx.strokeStyle = PATH_COLORS[seg % PATH_COLORS.length];
        ctx.beginPath();
      }
      let x = p.x, y = p.y;
      if (ref) { const m = bodyPos(MOON, p.t); x = p.x - m[0] + ref[0]; y = p.y - m[1] + ref[1]; }
      const s = S(x, y);
      if (first) { ctx.moveTo(s[0], s[1]); first = false; } else ctx.lineTo(s[0], s[1]);
    }
    ctx.stroke();
    for (const gp of ghosts) {
      const [gx, gy] = S(gp[0], gp[1]);
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,179,71,0.8)'; ctx.lineWidth = 1;
      circle(gx, gy, Math.max(MOON.R * z, 3)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffb347'; ctx.fillText('Pallid at encounter', gx, gy + Math.max(MOON.R * z, 3) + 16);
    }
    const imp = F.pred.events.find((e) => e.type === 'impact');
    if (imp) {
      const p = pts[imp.idx];
      let x = p.x, y = p.y;
      if (p.b === MOON && pts[0].b === MOON) { const m = bodyPos(MOON, p.t); x = p.x - m[0] + mp[0]; y = p.y - m[1] + mp[1]; }
      const [ix, iy] = S(x, y);
      ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ix - 6, iy - 6); ctx.lineTo(ix + 6, iy + 6); ctx.moveTo(ix + 6, iy - 6); ctx.lineTo(ix - 6, iy + 6); ctx.stroke();
      ctx.fillStyle = '#ff8080'; ctx.fillText('Impact', ix, iy - 12);
    }
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
  if (enc) {
    h.hEncRow.classList.remove('hidden');
    if (enc.kind === 'enc') { h.hEncLabel.textContent = 'Pallid encounter'; h.hEnc.textContent = `in ${fmtDur(enc.t - t)} · Pe ${fmtDist(enc.pe)}`; }
    else if (enc.kind === 'exit') { h.hEncLabel.textContent = 'Leaving Pallid'; h.hEnc.textContent = `in ${fmtDur(enc.t - t)}`; }
    else { h.hEncLabel.textContent = 'Impact'; h.hEnc.textContent = `in ${fmtDur(enc.t - t)}`; }
  } else h.hEncRow.classList.add('hidden');

  h.hClock.textContent = fmtClock(t);
  h.hWarp.textContent = WARPS[F.warp] + '×' + (F.warp > 3 ? '' : F.warp > 0 ? ' (physics)' : '');
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
  h.fMonoRow.style.display = monoMax > 0 && c.rcsParts.length ? '' : 'none';
  h.fLiq.style.width = (liqMax ? (100 * liq) / liqMax : 0) + '%';
  h.fSol.style.width = (solMax ? (100 * sol) / solMax : 0) + '%';
  h.fMono.style.width = (monoMax ? (100 * mono) / monoMax : 0) + '%';
  h.hNext.textContent = c.stageIdx < c.stages.length ? 'Next: ' + stageLabel(c.stages[c.stageIdx], (u) => c.byUid.get(u)) : 'No stages left';
  h.bRcs.classList.toggle('on', c.rcsOn);
  h.bRcs.classList.toggle('hidden', !c.rcsParts.length);
  const rel = wrapPi(c.angle - Math.atan2(ry, rx));
  const pitch = 90 - (Math.abs(rel) * 180) / Math.PI;
  const side = Math.abs(rel) < 0.01 || Math.abs(rel) > Math.PI - 0.01 ? '' : rel > 0 ? '◀ ' : '▶ ';
  h.hPitch.textContent = `${side}PITCH ${pitch.toFixed(0)}°`;
  h.bRecover.classList.toggle('hidden', !(c.landed && c.landed.body === HOME && !c.dead && (F.flags.maxAlt > 100)));
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
