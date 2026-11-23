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
  for (const e of c.engines) if (e.burn > 0 && !e.def.solid && !e.def.prop) gain += EC_ALTERNATOR * e.burn;
  // fuel cells top the batteries up from rocket fuel in their own stage
  for (const p of c.cells || []) {
    p.cellRun = 0;
    if (p.cellOff || ecTotal(c) >= c.ecMax - 0.01) continue;
    const got = c.takeFuel(c.groups.get(p.uid), p.def.cellEC * dt * CELL_FUEL_PER_EC) / CELL_FUEL_PER_EC;
    p.cellRun = dt > 0 ? got / dt : 0;
    gain += p.cellRun;
  }
  c.ecRate = gain;
  ecAdd(c, gain * dt);
  const probes = c.parts.filter((p) => p.def.probe).length;
  let lights = 0;
  for (const p of c.lights || []) if (p.lit) lights += p.def.lightEC;
  const demand = (probes * EC_PROBE_DRAIN + wheelUse * EC_WHEEL_DRAIN + lights) * dt;
  c.ecRate -= demand / Math.max(dt, 1e-9);
  ecDrain(c, demand);
  c.powered = ecTotal(c) > 0.01;
}

/* ---------------- mining and refining ---------------- */

const ORE_YIELD = 0.9;        // tonnes of fuel or monopropellant from a tonne of ore
const ORE_NOMINAL = 0.05;     // drills dig at their rated speed in ground that is 5% ore

/* Room left for a resource (part key k, capacity in def[cap]) across the craft. */
function propRoom(c, k, cap) { let r = 0; for (const p of c.parts) if (p.def[cap]) r += Math.max(0, p.def[cap] - (p[k] || 0)); return r; }
/* Pour a resource into the parts that hold it, in proportion to the room each has left. */
function propFill(c, k, cap, amount) {
  const room = propRoom(c, k, cap);
  if (room <= 1e-12 || amount <= 0) return 0;
  const put = Math.min(room, amount);
  for (const p of c.parts) if (p.def[cap]) p[k] = (p[k] || 0) + (Math.max(0, p.def[cap] - (p[k] || 0)) / room) * put;
  return put;
}
/* Where a drill's tip is, and whether it touches the ground. */
function drillOnGround(c, d, t) {
  if (!c.landed) return false;
  const b = c.landed.body, bp = bodyPos(b, t);
  const tip = c.toWorld(d.x, d.bot);
  const dx = tip[0] - bp[0], dy = tip[1] - bp[1];
  return Math.hypot(dx, dy) - b.R - groundAlt(b, Math.atan2(dy, dx)) < 1.5;
}
/* Ore share in the ground below a craft. */
function oreBelow(c, t) {
  const b = c.landed ? c.landed.body : soiBody(c.pos[0], c.pos[1], t);
  if (b.star || b.gas) return 0;
  const bp = bodyPos(b, t);
  return oreAt(b, Math.atan2(c.pos[1] - bp[1], c.pos[0] - bp[0]));
}

/* One step of digging and refining. `skill` speeds both up (an engineer aboard). */
function miningStep(c, dt, t, skill = 1) {
  if (!(c.drills && c.drills.length) && !(c.converters && c.converters.length)) return;
  let changed = false;
  // a craft holding an asteroid digs from the rock (rich in ore) instead of the ground
  const rock = typeof heldRock === 'function' ? heldRock(c) : null;
  for (const d of c.drills) {
    d.drillRate = 0;
    if (!d.drilling || (!rock && !drillOnGround(c, d, t))) continue;
    const conc = rock ? 0.08 : oreBelow(c, t);
    let want = Math.min((d.def.drill * conc / ORE_NOMINAL) * skill * dt, propRoom(c, 'ore', 'oreCap'), rock ? rock.ore : Infinity);
    if (want <= 1e-12) continue;
    want *= ecDrain(c, d.def.drillEC * dt);
    const got = propFill(c, 'ore', 'oreCap', want);
    if (rock) rock.ore = Math.max(0, rock.ore - got);
    d.drillRate = got / dt;
    changed = changed || got > 0;
  }
  for (const v of c.converters) {
    v.convRate = 0;
    if (!v.converting) continue;
    const k = v.converting === 'mono' ? 'mono' : 'fuel';
    let ore = Math.min(v.def.convert * skill * dt, c.propTotal('ore'), propRoom(c, k, k) / ORE_YIELD);
    if (ore <= 1e-12) continue;
    ore *= ecDrain(c, v.def.convEC * dt);
    c.takeProp('ore', ore);
    propFill(c, k, k, ore * ORE_YIELD);
    v.convRate = ore / dt;
    changed = changed || ore > 0;
  }
  if (changed) c.updateMass();
}

/* Move fuel (or ore) between this part and the rest of the craft. Returns tonnes moved. */
function transferProp(c, p, k, cap, pull) {
  const others = c.parts.filter((q) => q !== p && q.def[cap]);
  if (!others.length || !p.def[cap]) return 0;
  let moved;
  if (pull) {
    const avail = others.reduce((a, q) => a + (q[k] || 0), 0);
    moved = Math.min(p.def[cap] - (p[k] || 0), avail);
    if (moved <= 1e-12) return 0;
    for (const q of others) q[k] = Math.max(0, (q[k] || 0) - ((q[k] || 0) / avail) * moved);
    p[k] = (p[k] || 0) + moved;
  } else {
    const room = others.reduce((a, q) => a + Math.max(0, q.def[cap] - (q[k] || 0)), 0);
    moved = Math.min(p[k] || 0, room);
    if (moved <= 1e-12) return 0;
    for (const q of others) q[k] = (q[k] || 0) + (Math.max(0, q.def[cap] - (q[k] || 0)) / room) * moved;
    p[k] -= moved;
  }
  c.updateMass();
  return moved;
}

/* Can anyone fly this craft right now? A crew can; a probe core needs power. */
function hasControl(c) {
  if (c.hasPod) return true;
  if (!c.hasProbe || c.powered === false || !(ecTotal(c) > 0.01)) return false;
  // with the comms network on, the probe being flown also needs a signal
  return !(typeof F !== 'undefined' && c === F.craft && typeof commnetOn === 'function' && commnetOn() && F.comm && !F.comm.ok);
}

/* ---------------- heating ---------------- */

const T_AMBIENT = 290;
const HEAT_K = 2.5e-4;             // how strongly air friction heats parts
const MAX_TEMP_BY_KIND = {
  nose: 2400, engine: 2000, srb: 1800, fins: 1500, legs: 1500, sensor: 1200, antenna: 1200, solar: 1100, chute: 1300,
  jar: 1500, spike: 1400, sniffer: 1200, rcs: 1500, probe: 1400, battery: 1300, pod: 2200, shield: 3300, fairing: 2000, ion: 1300,
  aerospike: 2000, airbrake: 2400, strut: 1600, cabin: 2000, fuelcell: 1300, fuelcellL: 1300, batbank: 1300, gastank: 1300, gasdrum: 1300,
};
function partMaxTemp(def) { return def.maxTemp || MAX_TEMP_BY_KIND[def.kind] || 1800; }

/* Heat flux from moving fast through air (a rough Sutton–Graves form). */
function heatFlux(rho, v) { return rho > 0 ? 1.8e-4 * Math.sqrt(rho) * v * v * v : 0; }

/* Heat and cool every part. The part furthest forward along the airflow takes the full flux; parts
   behind it are partly sheltered. Ablative shields soak up most of their heat while ablator lasts.
   Returns the parts that went over their limit. */
function heatStep(c, dt, rho, vx, vy) {
  const v = Math.hypot(vx, vy);
  const F = heatFlux(rho, v) * (typeof diff === 'function' ? diff('heat') : 1);
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
      heatIn = (exposure * F * Math.min(partWidth(p), 3) * HEAT_K) / Math.max(p.m, 0.25);
      if (p.enclosed) heatIn *= 0.03;        // inside a fairing
      if (p.inflated) heatIn *= 0.35;        // the inflated shield spreads its heat over a huge area
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
