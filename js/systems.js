'use strict';
/* Rocketwright — spacecraft systems: electricity and reentry heating. */

/* ---------------- electricity ---------------- */

const EC_PROBE_DRAIN = 0.03;     // per second, per probe core
const EC_WHEEL_DRAIN = 0.08;     // per second, per kN·m of reaction-wheel torque in use
const EC_ALTERNATOR = 0.5;       // per second, per liquid engine at full thrust
const EC_TRANSMIT = 20;          // to send one science result home

function ecTotal(c) { let e = 0; for (const p of c.parts) e += p.ec; return e; }
function ecAdd(c, amount) {
  if (amount <= 0) return;
  for (const p of c.parts) {
    if (!p.def.ec) continue;
    const room = p.def.ec - p.ec;
    const put = Math.min(room, amount);
    p.ec += put;
    amount -= put;
    if (amount <= 0) return;
  }
}
/* Take charge evenly from every store. Returns the fraction of the request that was available. */
function ecDrain(c, amount) {
  if (amount <= 0) return 1;
  const have = ecTotal(c);
  if (have <= 1e-9) return 0;
  const take = Math.min(have, amount);
  for (const p of c.parts) if (p.ec > 0) p.ec = Math.max(0, p.ec - (p.ec / have) * take);
  return take / amount;
}

/* Is the craft in the shadow of the body it orbits (or that body's planet)? */
function inShadow(c, t) {
  const sun = bodyPos(SUN, t);
  const sx = sun[0] - c.pos[0], sy = sun[1] - c.pos[1], sl = Math.hypot(sx, sy);
  const ux = sx / sl, uy = sy / sl;
  let b = soiBody(c.pos[0], c.pos[1], t);
  for (let k = 0; k < 2 && b && !b.star; k++, b = b.parent) {
    const bp = bodyPos(b, t);
    const dx = bp[0] - c.pos[0], dy = bp[1] - c.pos[1];
    const along = dx * ux + dy * uy;
    if (along > 0 && along < sl && Math.abs(dx * uy - dy * ux) < b.R) return true;
  }
  return false;
}

/* Power from solar panels right now (charge per second). Panels face outward from where they're mounted. */
function solarInput(c, t) {
  if (!c.solarParts.length || inShadow(c, t)) return 0;
  const sun = bodyPos(SUN, t);
  const sx = sun[0] - c.pos[0], sy = sun[1] - c.pos[1], d = Math.hypot(sx, sy);
  const flux = Math.pow(HOME.orbitR / d, 2);
  let p = 0;
  for (const s of c.solarParts) {
    const n = c.rotLocal(s.flip ? -1 : 1, 0);
    p += s.def.solar * flux * Math.max(0, (n[0] * sx + n[1] * sy) / d);
  }
  return p;
}

/* One step of the power budget. wheelUse = kN·m of reaction-wheel torque being used. */
function electricStep(c, dt, t, wheelUse) {
  let gain = solarInput(c, t);
  for (const e of c.engines) if (e.burn > 0 && !e.def.solid) gain += EC_ALTERNATOR * e.burn;
  c.ecRate = gain;
  ecAdd(c, gain * dt);
  const probes = c.parts.filter((p) => p.def.probe).length;
  const demand = (probes * EC_PROBE_DRAIN + wheelUse * EC_WHEEL_DRAIN) * dt;
  c.ecRate -= demand / Math.max(dt, 1e-9);
  ecDrain(c, demand);
  c.powered = ecTotal(c) > 0.01;
}

/* Can anyone fly this craft right now? A crew can; a probe core needs power. */
function hasControl(c) { return c.hasPod || (c.hasProbe && c.powered !== false && ecTotal(c) > 0.01); }

/* ---------------- heating ---------------- */

const T_AMBIENT = 290;
const HEAT_K = 2.5e-4;             // how strongly air friction heats parts
const MAX_TEMP_BY_KIND = {
  nose: 2400, engine: 2000, srb: 1800, fins: 1500, legs: 1500, sensor: 1200, antenna: 1200, solar: 1100, chute: 1300,
  jar: 1500, spike: 1400, sniffer: 1200, rcs: 1500, probe: 1400, battery: 1300, pod: 2200, shield: 3300,
};
function partMaxTemp(def) { return def.maxTemp || MAX_TEMP_BY_KIND[def.kind] || 1800; }

/* Heat flux from moving fast through air (a rough Sutton–Graves form). */
function heatFlux(rho, v) { return rho > 0 ? 1.8e-4 * Math.sqrt(rho) * v * v * v : 0; }

/* Heat and cool every part. The part furthest forward along the airflow takes the full flux; parts
   behind it are partly sheltered. Ablative shields soak up most of their heat while ablator lasts.
   Returns the parts that went over their limit. */
function heatStep(c, dt, rho, vx, vy) {
  const v = Math.hypot(vx, vy);
  const F = heatFlux(rho, v);
  const hot = [];
  let smin = Infinity, smax = -Infinity;
  let lx = 0, ly = 0;
  if (F > 0) {
    // airflow direction in craft-local coordinates
    const ax = Math.cos(c.angle), ay = Math.sin(c.angle);
    ly = (vx * ax + vy * ay) / v;
    lx = (vx * ay - vy * ax) / v;
    for (const p of c.parts) {
      const s = (p.x - c.xc) * lx + ((p.top + p.bot) / 2 - c.yc) * ly;
      p._s = s;
      smin = Math.min(smin, s); smax = Math.max(smax, s);
    }
  }
  const span = smax - smin;
  for (const p of c.parts) {
    let heatIn = 0;
    if (F > 0) {
      const norm = span > 1e-6 ? (p._s - smin) / span : 1;
      const exposure = 0.04 + 0.96 * norm * norm * norm;
      heatIn = (exposure * F * maxWidth(p.def) * HEAT_K) / Math.max(p.m, 0.25);
      if (p.def.kind === 'shield' && p.ablator > 0) {
        heatIn *= 0.3;
        if (p.temp > 700) p.ablator = Math.max(0, p.ablator - 0.0006 * ((p.temp - 700) / 1000) * dt);
      }
    }
    p.temp += (heatIn - 0.025 * (p.temp - T_AMBIENT)) * dt;
    if (p.temp > partMaxTemp(p.def)) hot.push(p);
  }
  let worst = null;
  for (const p of c.parts) if (!worst || p.temp / partMaxTemp(p.def) > worst.temp / partMaxTemp(worst.def)) worst = p;
  c.hottest = worst;
  return hot;
}
