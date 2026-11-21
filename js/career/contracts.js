'use strict';
/* Rocketwright — contracts. Offers are generated from templates with the save's seeded RNG, scale with
   how far you've got, pay an advance on accepting, a reward on completion, and a penalty if they expire. */

const OFFER_COUNT = 4;
const OFFER_LIFETIME = 30 * DAY;
const r100 = (x) => Math.round(x / 100) * 100;

/* Which worlds contracts may send you to, based on what you've achieved. */
function reachableBodies(s) {
  const m = s.milestones, has = (ids) => ids.some((k) => m[k]);
  const out = [HOME];
  if (m.orbit) out.push(MOON);
  if (has(['orbit_pallid', 'land_pallid'])) out.push(CINDER, OCHRE, PIP, SHARD);
  if (has(['soi_ochre', 'soi_cinder', 'soi_pip', 'soi_shard'])) out.push(TEMPEST, GALE, EMBER, FROST, GLACIS);
  if (has(['soi_tempest', 'soi_glacis', 'soi_gale', 'soi_ember', 'soi_frost'])) out.push(UMBRA);
  return out;
}
const maxActive = (s) => Math.min(8, 3 + Math.floor(Math.max(0, s.rep) / 50));

function validSits(b, s) {
  const out = [];
  if (b.atmo) out.push('flyingLow', 'flyingHigh');
  if (b !== HOME || s.milestones.space) out.push('spaceLow', 'spaceHigh');
  if (b !== HOME && !b.gas) out.push('landed');
  return out;
}

function contractBuilders(s) {
  const m = s.milestones, bodies = reachableBodies(s).filter((b) => !b.star);
  const away = bodies.filter((b) => b !== HOME);
  const f = (b) => BODY_SCI[b.id] || 1;
  const B = [];
  if (!m.space) B.push([3, () => {
    const km = pick(s, [5, 10, 20, 35, 50, 70].filter((k) => k >= (m.alt10k ? 20 : 5)));
    return { type: 'altitude', title: `Reach ${km} km`, desc: `Fly a craft above ${km} km over Verdan.`, p: { km },
      reward: r100(2000 + km * 180), sci: Math.round(2 + km / 10), rep: 2, days: 30 };
  }]);
  const testable = Object.keys(PART_DEFS).filter((id) => partUnlocked(id) && activatable(PART_DEFS[id]));
  if (testable.length) B.push([2, () => {
    const id = pick(s, testable), def = PART_DEFS[id];
    let w;
    if (def.chute) w = { altMin: 200, altMax: 4000, maxSpeed: 250, label: 'below 4 km over Verdan, slower than 250 m/s' };
    else {
      const ws = [{ altMin: 2000, altMax: 12000, label: 'between 2 and 12 km over Verdan' },
        { altMin: 15000, altMax: 40000, label: 'between 15 and 40 km over Verdan' }];
      if (m.space) ws.push({ altMin: 70000, altMax: 250000, label: 'in space near Verdan (70 to 250 km)' });
      w = pick(s, ws);
    }
    return { type: 'test', title: `Test the ${def.name}`, desc: `Stage the ${def.name} ${w.label}.`, p: { part: id, ...w },
      reward: r100(3500 + rand(s) * 3500 + (w.altMin / 1000) * 50), sci: 4, rep: 2, days: 40 };
  }]);
  B.push([2, () => {
    const b = pick(s, bodies), sits = validSits(b, s);
    if (!sits.length) return null;
    const sit = pick(s, sits);
    return { type: 'science', title: `Science ${SITUATIONS[sit].label.toLowerCase()} ${b.name}`,
      desc: `Transmit or recover any experiment result taken ${SITUATIONS[sit].label.toLowerCase()} ${b.name}.`, p: { body: b.id, sit },
      reward: r100(5000 * (1 + f(b) * 0.7)), sci: Math.round(6 + 3 * f(b)), rep: 3 + f(b), days: 30 + 60 * f(b) };
  }]);
  const orbitable = bodies.filter((b) => b !== HOME || !m.orbit);
  if (orbitable.length) B.push([2, () => {
    const b = pick(s, orbitable);
    return { type: 'orbit', title: `Orbit ${b.name}`, desc: `Reach a stable orbit around ${b.name}${b.atmo ? ', above its atmosphere' : ''}.`, p: { body: b.id },
      reward: r100(12000 * (1 + f(b))), sci: Math.round(8 + 4 * f(b)), rep: 5 + 2 * f(b), days: 30 + 60 * f(b) };
  }]);
  if (away.length) {
    B.push([1.5, () => {
      const b = pick(s, away);
      return { type: 'flyby', title: `Fly by ${b.name}`, desc: `Enter ${b.name}'s sphere of influence.`, p: { body: b.id },
        reward: r100(7000 * (1 + f(b))), sci: Math.round(5 + 3 * f(b)), rep: 3 + f(b), days: 40 + 60 * f(b) };
    }]);
    const landable = away.filter((b) => !b.gas);
    if (landable.length) B.push([1.5, () => {
      const b = pick(s, landable);
      return { type: 'land', title: `Land on ${b.name}`, desc: `Touch down safely on ${b.name}.`, p: { body: b.id },
        reward: r100(16000 * (1 + f(b))), sci: Math.round(10 + 5 * f(b)), rep: 6 + 2 * f(b), days: 40 + 70 * f(b) };
    }]);
  }
  if (m.orbit) B.push([1.2, () => {
    const used = new Set(s.crew.map((c) => c.name).concat((s.vessels || []).flatMap((v) => (v.crew || []).map((x) => x.name)),
      s.contracts.filter((c) => c.type === 'rescue').map((c) => c.p.crewName)));
    const name = CREW_POOL.find((n) => !used.has(n) && rand(s) < 0.5) || CREW_POOL.find((n) => !used.has(n));
    if (!name) return null;
    const b = reachableBodies(s).includes(MOON) && rand(s) < 0.35 ? MOON : HOME;
    const alt = Math.round(((b.atmo ? b.atmo.top + 15000 : 15000) + rand(s) * b.R * 0.3) / 1000) * 1000;
    return { type: 'rescue', title: `Rescue ${name}`,
      desc: `${name} is stuck in a capsule orbiting ${b.name} at ${fmtNum(alt / 1000)} km. Dock with it using a docking port, then bring them home and recover them.`,
      p: { crewName: name, body: b.id, alt }, reward: r100(25000 * (1 + (BODY_SCI[b.id] || 1) * 0.6)), sci: 10, rep: 10, days: 60 + 60 * (BODY_SCI[b.id] || 1) };
  }]);
  if (m.orbit) B.push([1, () => {
    const b = pick(s, bodies);
    const lo = Math.round(((b.atmo ? b.atmo.top : b.R * 0.05) + rand(s) * b.R * 0.4) / 10000) * 10;
    const hi = lo + Math.round((b.R * (0.25 + rand(s) * 0.4)) / 10000) * 10;
    return { type: 'satellite', title: `Satellite around ${b.name}`,
      desc: `Put a craft with an antenna into orbit around ${b.name} with periapsis above ${fmtNum(lo)} km and apoapsis below ${fmtNum(hi)} km.`,
      p: { body: b.id, lo: lo * 1000, hi: hi * 1000 }, reward: r100(10000 * (1 + f(b))), sci: 5, rep: 4 + f(b), days: 40 + 60 * f(b) };
  }]);
  return B;
}

function genContract(s) {
  const B = contractBuilders(s);
  const taken = new Set(s.contracts.filter((c) => c.state === 'offered' || c.state === 'active').map((c) => c.title));
  for (let tries = 0; tries < 12; tries++) {
    const total = B.reduce((a, b) => a + b[0], 0);
    let r = rand(s) * total, mk = B[0][1];
    for (const [w, fn] of B) { if ((r -= w) <= 0) { mk = fn; break; } }
    const c = mk();
    if (!c || taken.has(c.title)) continue;
    c.id = s.contractSeq++;
    c.state = 'offered';
    c.advance = r100(c.reward * 0.15);
    c.penalty = r100(c.reward * 0.3);
    c.offeredAt = s.ut;
    c.expires = s.ut + OFFER_LIFETIME;
    return c;
  }
  return null;
}

/* Fail overdue contracts, drop stale offers and top the offer board back up. Returns failed contracts. */
function refreshContracts(s) {
  const failed = [];
  for (const c of s.contracts) {
    if (c.state === 'active' && s.ut > c.deadline) { failContract(s, c); failed.push(c); }
    if (c.state === 'offered' && s.ut > c.expires) c.state = 'expired';
  }
  s.contracts = s.contracts.filter((c) => c.state !== 'expired' && c.state !== 'declined');
  while (s.contracts.filter((c) => c.state === 'offered').length < OFFER_COUNT) {
    const c = genContract(s);
    if (!c) break;
    s.contracts.push(c);
  }
  // keep the history short
  const old = s.contracts.filter((c) => c.state === 'done' || c.state === 'failed');
  if (old.length > 30) { const drop = new Set(old.slice(0, old.length - 30)); s.contracts = s.contracts.filter((c) => !drop.has(c)); }
  return failed;
}

function acceptContract(s, id) {
  const c = s.contracts.find((x) => x.id === id && x.state === 'offered');
  if (!c) return 'No such offer';
  if (s.contracts.filter((x) => x.state === 'active').length >= maxActive(s)) return `You can run ${maxActive(s)} contracts at once. Earn reputation for more.`;
  c.state = 'active';
  c.deadline = s.ut + c.days * DAY;
  s.funds += c.advance;
  if (c.type === 'rescue') c.p.vid = spawnStranded(s, BODY_BY_ID[c.p.body], c.p.alt, c.p.crewName, rand(s) * TAU).id;
  return null;
}
function declineContract(s, id) {
  const c = s.contracts.find((x) => x.id === id && x.state === 'offered');
  if (c) c.state = 'declined';
}
function completeContract(s, c) {
  c.state = 'done';
  c.doneAt = s.ut;
  s.funds += c.reward;
  s.science = Math.round((s.science + c.sci) * 10) / 10;
  s.rep = clamp(s.rep + c.rep, -100, 1000);
}
function failContract(s, c) {
  c.state = 'failed';
  if (c.type === 'rescue' && s.vessels) s.vessels = s.vessels.filter((v) => !(v.crew || []).some((x) => x.name === c.p.crewName && x.stranded));
  s.funds -= c.penalty;
  s.rep = clamp(s.rep - c.rep, -100, 1000);
}

/* Check active contracts against something that just happened in flight. Returns the ones completed.
   ev: { kind: 'tick'|'stage'|'land'|'science', body, alt, speed, orbit, landed, hasAntenna, partIds, sit } */
function checkContracts(s, ev) {
  const done = [];
  for (const c of s.contracts) {
    if (c.state !== 'active') continue;
    const p = c.p, b = ev.body;
    let ok = false;
    switch (c.type) {
      case 'altitude': ok = ev.kind === 'tick' && b === HOME && ev.alt >= p.km * 1000; break;
      case 'test': ok = ev.kind === 'stage' && b === HOME && ev.alt >= p.altMin && ev.alt <= p.altMax &&
        (!p.maxSpeed || ev.speed <= p.maxSpeed) && ev.partIds.includes(p.part); break;
      case 'flyby': ok = ev.kind === 'tick' && b.id === p.body; break;
      case 'orbit': ok = ev.kind === 'tick' && b.id === p.body && stableOrbit(ev, b); break;
      case 'land': ok = ev.kind === 'land' && b.id === p.body; break;
      case 'science': ok = ev.kind === 'science' && b.id === p.body && ev.sit === p.sit; break;
      case 'rescue': ok = ev.kind === 'recover' && (ev.crew || []).includes(p.crewName); break;
      case 'satellite': ok = ev.kind === 'tick' && b.id === p.body && ev.hasAntenna && stableOrbit(ev, b) &&
        ev.orbit.rp - b.R >= p.lo && ev.orbit.ra - b.R <= p.hi; break;
    }
    if (ok) { completeContract(s, c); done.push(c); }
  }
  return done;
}
function stableOrbit(ev, b) {
  const o = ev.orbit;
  return !!o && !ev.landed && o.e < 1 && o.rp - b.R > (b.atmo ? b.atmo.top : 3000);
}
