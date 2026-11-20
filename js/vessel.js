'use strict';
/* Rocketwright — craft model: parts, segments (stages), fuel flow, mass properties, delta-v. */

/* A design is a list of part ids from top to bottom. Each decoupler starts a new segment;
   segment 0 is the top. Engines only draw fuel from tanks in their own segment. */
function makeParts(design) {
  let seg = 0;
  return design.map((id, i) => {
    const def = PART_DEFS[id];
    if (def.decoupler && i > 0) seg++;
    return { id, def, seg, fuel: def.fuel || 0, solid: def.solid || 0, ignited: false, burn: 0, m: 0, top: 0, bot: 0 };
  });
}

function segRange(parts) {
  let lo = Infinity, hi = -Infinity;
  for (const p of parts) { lo = Math.min(lo, p.seg); hi = Math.max(hi, p.seg); }
  return [lo, hi];
}

/* Staging sequence: ignite the bottom segment, then for each decoupler separate the bottom
   segment and ignite the next one up, then deploy parachutes. */
function stageActions(parts) {
  if (!parts.length) return [];
  const [lo, hi] = segRange(parts);
  const acts = [];
  const hasEng = (s) => parts.some((p) => p.seg === s && p.def.thrust);
  if (hasEng(hi)) acts.push({ ignite: hi });
  for (let s = hi; s > lo; s--) acts.push({ decouple: s, ignite: hasEng(s - 1) ? s - 1 : -1 });
  if (parts.some((p) => p.def.chute)) acts.push({ chute: true });
  return acts;
}

function engineNames(parts, s) {
  const names = [];
  for (const p of parts) if (p.seg === s && p.def.thrust) {
    const n = p.def.name.split(' ')[0];
    if (!names.includes(n)) names.push(n);
  }
  return names.join(' + ');
}

function stageLabel(act, parts) {
  if (act.chute) return 'Deploy parachute';
  if (act.decouple !== undefined) return act.ignite >= 0 ? `Separate, ignite ${engineNames(parts, act.ignite)}` : 'Separate stage';
  return `Ignite ${engineNames(parts, act.ignite)}`;
}

function segInfo(parts, s) {
  const o = { mass: 0, thrustVac: 0, thrustSL: 0, flow: 0, liquid: 0, liquidMax: 0, solid: 0, solidMax: 0, liquidEng: false, engines: 0 };
  for (const p of parts) {
    if (p.seg !== s) continue;
    const d = p.def;
    o.mass += d.mass + p.fuel + p.solid;
    if (d.fuel) { o.liquid += p.fuel; o.liquidMax += d.fuel; }
    if (d.solid) { o.solid += p.solid; o.solidMax += d.solid; }
    if (d.thrust) {
      o.engines++;
      o.thrustVac += d.thrust;
      o.thrustSL += (d.thrust * d.ispSL) / d.ispVac;
      o.flow += d.thrust / (d.ispVac * G0);
      if (!d.solid) o.liquidEng = true;
    }
  }
  o.usable = o.solid + (o.liquidEng ? o.liquid : 0);
  o.isp = o.flow > 0 ? o.thrustVac / (o.flow * G0) : 0;
  return o;
}

/* Delta-v per segment, bottom segment first (the order they fire in). */
function deltaVTable(parts) {
  const rows = [];
  let total = 0;
  if (!parts.length) return { rows, total };
  const [lo, hi] = segRange(parts);
  const info = {};
  for (let s = lo; s <= hi; s++) info[s] = segInfo(parts, s);
  for (let s = hi; s >= lo; s--) {
    let m0 = 0;
    for (let k = lo; k <= s; k++) m0 += info[k].mass;
    const I = info[s];
    const dv = I.flow > 0 && I.usable > 0 ? I.isp * G0 * Math.log(m0 / (m0 - I.usable)) : 0;
    const burn = I.flow > 0 ? I.usable / I.flow : 0;
    rows.push({ seg: s, m0, dv, twr: I.thrustSL / (m0 * 9.81), twrVac: I.thrustVac / (m0 * 9.81), burn, info: I });
    total += dv;
  }
  return { rows, total };
}

function analyzeDesign(design) {
  const out = { valid: false, warnings: [], mass: 0, height: 0, rows: [], total: 0, actions: [], parts: [] };
  if (!design.length) { out.warnings.push({ lvl: 'info', text: 'Click parts on the left to start building.' }); return out; }
  const parts = makeParts(design);
  out.parts = parts;
  for (const p of parts) { out.mass += p.def.mass + p.fuel + p.solid; out.height += p.def.h; }
  const dv = deltaVTable(parts);
  out.rows = dv.rows;
  out.total = dv.total;
  out.actions = stageActions(parts);
  const hasPod = design.includes('pod');
  if (!hasPod) out.warnings.push({ lvl: 'err', text: 'Add a Lark Capsule. Every craft needs a command pod.' });
  const first = dv.rows[0];
  if (first && first.info.engines === 0) out.warnings.push({ lvl: 'warn', text: 'The bottom stage has no engine.' });
  else if (first && first.twr < 1) out.warnings.push({ lvl: 'warn', text: `Liftoff thrust-to-weight is ${first.twr.toFixed(2)}. Below 1.00 the rocket can't leave the pad.` });
  for (const r of dv.rows) {
    if (r.info.engines > 0 && r.info.usable === 0) out.warnings.push({ lvl: 'warn', text: `A stage with ${engineNames(parts, r.seg)} has no fuel in its own stage.` });
    else if (r.info.liquid > 0 && !r.info.liquidEng && r.seg !== 0) out.warnings.push({ lvl: 'warn', text: 'A stage has fuel tanks but no liquid engine. Engines only use fuel from their own stage.' });
  }
  const ci = design.indexOf('chute');
  if (ci > design.indexOf('pod') && hasPod) out.warnings.push({ lvl: 'info', text: 'Tip: the parachute belongs on top of the capsule.' });
  out.valid = hasPod;
  return out;
}

class Craft {
  constructor(parts) {
    this.parts = parts;
    this.pos = [0, 0];
    this.vel = [0, 0];
    this.angle = Math.PI / 2; // direction the nose points (world radians)
    this.angVel = 0;
    this.throttle = 0;
    this.ctrl = 0;
    this.landed = null;
    this.dead = false;
    this.chuteOpen = false;
    this.chuteArea = 0;
    this.gimbalCap = 0;
    this.thrust = 0;
    this.heat = 0;
    this.radar = Infinity;
    this.yc = undefined;
    this.stages = [];
    this.stageIdx = 0;
    this.layout();
    this.updateMass();
  }

  layout() {
    let y = 0;
    for (const p of this.parts) { p.top = y; p.bot = y - p.def.h; y = p.bot; }
    this.length = -y;
    this.hasLegs = this.parts.some((p) => p.def.legs);
    this.hasFins = this.parts.some((p) => p.def.fins);
    this.hasChute = this.parts.some((p) => p.def.chute);
    this.torque = this.parts.reduce((a, p) => a + (p.def.torque || 0), 0);
    const bot = -this.length;
    this.contacts = [[0, 0], [-0.8, bot], [0.8, bot]];
    this.footY = undefined;
    if (this.hasLegs) {
      let lp = null;
      for (const p of this.parts) if (p.def.legs) lp = p;
      let segBot = lp.bot;
      for (const p of this.parts) if (p.seg === lp.seg) segBot = Math.min(segBot, p.bot);
      this.footY = Math.min(lp.bot - 0.6, segBot - 0.25);
      this.contacts.push([-2.3, this.footY], [2.3, this.footY]);
    }
  }

  updateMass() {
    let M = 0, my = 0;
    for (const p of this.parts) {
      p.m = p.def.mass + p.fuel + p.solid;
      M += p.m;
      my += (p.m * (p.top + p.bot)) / 2;
    }
    const yc = my / M;
    let I = 0;
    for (const p of this.parts) {
      const d = (p.top + p.bot) / 2 - yc;
      I += p.m * (d * d + (p.def.h * p.def.h) / 12 + 0.25);
    }
    this.M = M;
    this.I = Math.max(I, 0.3);
    if (this.yc !== undefined && yc !== this.yc) {
      // keep the parts fixed in the world while the centre of mass moves
      const dy = yc - this.yc, ax = Math.cos(this.angle), ay = Math.sin(this.angle);
      this.pos[0] += ax * dy; this.pos[1] += ay * dy;
      if (this.landed) { this.landed.rx += ax * dy; this.landed.ry += ay * dy; }
    }
    this.yc = yc;
  }

  /* local (x lateral, y along the stack, 0 = nose) -> world */
  toWorld(lx, ly) {
    const ax = Math.cos(this.angle), ay = Math.sin(this.angle), d = ly - this.yc;
    return [this.pos[0] + ax * d + ay * lx, this.pos[1] + ay * d - ax * lx];
  }

  segLiquid(s) {
    let f = 0;
    for (const p of this.parts) if (p.seg === s && p.def.fuel) f += p.fuel;
    return f;
  }

  isThrusting() {
    for (const p of this.parts) {
      if (!p.ignited || !p.def.thrust) continue;
      if (p.def.solid) { if (p.solid > 0) return true; } else if (this.throttle > 0 && this.segLiquid(p.seg) > 0) return true;
    }
    return false;
  }

  /* Burn fuel for dt seconds at atmospheric pressure p (atm). Returns thrust in kN. */
  engineStep(dt, pressure) {
    let T = 0, gim = 0;
    const thr = this.throttle;
    const demand = new Map();
    for (const e of this.parts) {
      e.burn = 0;
      if (!e.def.thrust || !e.ignited || e.def.solid || thr <= 0) continue;
      demand.set(e.seg, (demand.get(e.seg) || 0) + (e.def.thrust / (e.def.ispVac * G0)) * thr * dt);
    }
    const ratio = new Map();
    for (const [seg, need] of demand) {
      let avail = 0;
      for (const p of this.parts) if (p.seg === seg && p.def.fuel) avail += p.fuel;
      if (avail <= 1e-9) { ratio.set(seg, 0); continue; }
      const take = Math.min(need, avail), f = take / avail;
      for (const p of this.parts) if (p.seg === seg && p.def.fuel) p.fuel = Math.max(0, p.fuel - p.fuel * f);
      ratio.set(seg, take / need);
    }
    const pr = clamp(pressure, 0, 1);
    for (const e of this.parts) {
      const d = e.def;
      if (!d.thrust || !e.ignited) continue;
      const isp = d.ispVac + (d.ispSL - d.ispVac) * pr;
      let frac;
      if (d.solid) {
        if (e.solid <= 0) continue;
        const flow = d.thrust / (d.ispVac * G0);
        const use = Math.min(e.solid, flow * dt);
        e.solid -= use;
        frac = use / (flow * dt);
      } else {
        frac = thr * (ratio.get(e.seg) || 0);
      }
      if (frac <= 0) continue;
      const f = ((d.thrust * isp) / d.ispVac) * frac;
      e.burn = frac;
      T += f;
      gim += f * Math.sin((d.gimbal * Math.PI) / 180) * Math.abs(e.bot - this.yc);
    }
    this.thrust = T;
    this.gimbalCap = gim;
    return T;
  }

  activeSeg() { return segRange(this.parts)[1]; }
}
